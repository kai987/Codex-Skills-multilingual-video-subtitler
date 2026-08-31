import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import * as s from "@mvl/shared";
import { c612Defined } from "../top-k/c612-policy.js";
import { readC612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import { treeFiles, safeC612ArtifactPath } from "../top-k/c612-delivery-io.js";
import { renderC612Shadow } from "../top-k/group-shadow-configurations.js";
import { rankingQuality } from "../top-k/fixed-group-evaluation.js";
import {
  validateC612StrictTree,
  auditC612ShareableValue,
} from "../top-k/c612-artifact-validator.js";
import { buildC6121Supergroups } from "./frozen-group-gold-bipartite-graph.js";
import {
  fingerprintC6121,
  readC6121Artifact,
  verifyC6121Snapshot,
} from "./baseline-freeze-verification.js";
import {
  C6121_POLICY_HASH,
  c6121Artifact,
  demand,
  hash,
  fraction,
  validateC6121Artifact,
} from "./c6121-policy.js";
import {
  c6121TrainingContract,
  retrainC6121Oof,
} from "./same-profile-oof-retrainer.js";
import {
  c6121Coverage,
  c6121CoverageRecovery,
  compareC6121Modes,
} from "./supergroup-coverage.js";
import { auditC6121LabelStability } from "./c6121-label-rebinding.js";
import {
  replayC6121E1Timing,
  diagnosticC6121Map,
} from "./evaluator-mode-comparison.js";
import { auditC6121Sensitivity } from "./evaluator-sensitivity.js";
import { C6121_FROZEN_EVALUATOR_FILES } from "./supergroup-freeze.js";
import {
  diagnoseC6121Completeness,
  decideC6121Route,
} from "./c6121-route-decision.js";
export const sameC6121 = (a: unknown, b: unknown, code: string) =>
  demand(hash(a) === hash(b), code);

export async function validateC6121Tree(root: string, repository: string) {
  const compiled = new Map<string, ReturnType<typeof s.compileJsonSchema>>();
  let count = 0;
  for (const relative of await treeFiles(root)) {
    if (!relative.endsWith(".json")) continue;
    const value: unknown = JSON.parse(
      await readFile(await safeC612ArtifactPath(root, relative), "utf8"),
    );
    demand(
      value && typeof value === "object",
      "C6121_ARTIFACT_OBJECT_REQUIRED",
    );
    if ("packageType" in value) {
      s.subtitlePackageSchema.parse(value);
      count++;
      continue;
    }
    const type = "artifactType" in value ? value.artifactType : null;
    const entry = [...s.c6121GeneratedSchemas, ...s.c612GeneratedSchemas].find(
      ([name]) => name === type,
    );
    demand(entry, "C6121_UNREGISTERED_ARTIFACT:" + relative);
    const parsed = entry[1].parse(value);
    if (parsed.policyVersion === s.C6121_VERSION) validateC6121Artifact(parsed);
    else {
      const { semanticHash, ...body } = parsed;
      sameC6121(semanticHash, hash(body), "C6121_LEGACY_SELF_HASH");
    }
    let validate = compiled.get(entry[0]);
    if (!validate) {
      const schema: unknown = JSON.parse(
        await readFile(
          path.join(repository, "schemas", entry[0] + ".schema.json"),
          "utf8",
        ),
      );
      demand(
        schema && typeof schema === "object",
        "C6121_SCHEMA_OBJECT_REQUIRED",
      );
      validate = s.compileJsonSchema(schema);
      compiled.set(entry[0], validate);
    }
    s.assertJsonSchema(validate, parsed);
    count++;
  }
  return count;
}
export function verifyC6121Metrics(
  profile: s.C6121ProfileMetric,
  map: s.C6121Map,
) {
  sameC6121(
    profile.groups.map((g) => g.supergroupId),
    map.groups.map((g) => g.supergroupId),
    "C6121_PROFILE_REMATCHING",
  );
  demand(
    profile.supergroupMapHash === map.semanticHash,
    "C6121_PROFILE_MAP_HASH_CHANGED",
  );
  for (const row of profile.groups) {
    const group = c612Defined(
      map.groups.find((g) => g.supergroupId === row.supergroupId),
    );
    sameC6121(row.goldCueIds, group.goldCueIds, "C6121_PROFILE_GOLD_REMATCH");
    sameC6121(
      row.machineGroupIds,
      group.machineGroupIds,
      "C6121_PROFILE_MACHINE_REMATCH",
    );
    demand(
      row.evaluated === group.shadowEvaluationEligible,
      "C6121_EVALUATION_ELIGIBILITY_CHANGED",
    );
    if (!row.evaluated)
      demand(
        [
          row.exactGain,
          row.normalizedGain,
          row.materialDelta,
          row.catastrophicDeletion,
        ].every((x) => x === null),
        "C6121_UNKNOWN_GAIN_COERCED_TO_ZERO",
      );
    else {
      demand(
        row.exactGain ===
          c612Defined(row.baselineExactError) - c612Defined(row.exactError) &&
          row.normalizedGain ===
            c612Defined(row.baselineNormalizedError) -
              c612Defined(row.normalizedError),
        "C6121_GROUP_ERROR_ARITHMETIC",
      );
      const expected =
        row.normalizedGain === 0
          ? "NEUTRAL"
          : c612Defined(row.normalizedGain) > 0
            ? "IMPROVED"
            : "REGRESSED";
      demand(row.classification === expected, "C6121_GROUP_CLASSIFICATION");
    }
  }
  const changed = profile.groups.filter((g) => g.changed),
    known = changed.filter((g) => g.evaluated);
  const improved = known.filter(
    (g) => c612Defined(g.normalizedGain) > 0,
  ).length;
  const regressed = known.filter(
    (g) => c612Defined(g.normalizedGain) < 0,
  ).length;
  demand(
    profile.changedSupergroups === changed.length &&
      profile.evaluableChangedSupergroups === known.length &&
      profile.improved === improved &&
      profile.regressed === regressed &&
      profile.neutral === known.length - improved - regressed &&
      profile.unknown === changed.length - known.length,
    "C6121_PROFILE_CLASSIFICATION_COUNTS",
  );
  sameC6121(
    profile.selectionPrecision,
    fraction(improved, improved + regressed).ratio,
    "C6121_PRECISION_ARITHMETIC",
  );
  sameC6121(
    profile.harmRate,
    fraction(regressed, known.length).ratio,
    "C6121_HARM_ARITHMETIC",
  );
  sameC6121(
    profile.changedSupergroupCoverage,
    fraction(known.length, changed.length),
    "C6121_CHANGED_COVERAGE_ARITHMETIC",
  );
  demand(
    profile.zeroSelectionChangedCoverage ===
      (changed.length ? known.length / changed.length : 0),
    "C6121_ZERO_SELECTION_COVERAGE",
  );
  for (const [metric, rowKey] of [
    ["exactJointGain", "exactGain"],
    ["normalizedJointGain", "normalizedGain"],
    ["materialDelta", "materialDelta"],
    ["legacyMaterialDelta", "legacyMaterialDelta"],
  ] as const)
    sameC6121(
      profile[metric],
      !changed.length
        ? 0
        : !known.length
          ? null
          : known.reduce((n, g) => n + c612Defined(g[rowKey]), 0),
      "C6121_JOINT_GAIN_ARITHMETIC:" + metric,
    );
  demand(
    profile.catastrophicDeletionCount ===
      known.filter((g) => g.catastrophicDeletion).length,
    "C6121_CATASTROPHIC_ARITHMETIC",
  );
  for (const fold of profile.folds) {
    const rows = changed.filter(
      (r) =>
        r.foldId === fold.foldId ||
        (r.foldId === null &&
          map.groups
            .find((g) => g.supergroupId === r.supergroupId)
            ?.frozenFoldIds.includes(fold.foldId)),
    );
    const evaluated = rows.filter((g) => g.evaluated);
    sameC6121(
      fold,
      {
        foldId: fold.foldId,
        changed: rows.length,
        evaluated: evaluated.length,
        improved: rows.filter((g) => g.classification === "IMPROVED").length,
        regressed: rows.filter((g) => g.classification === "REGRESSED").length,
        neutral: rows.filter((g) => g.classification === "NEUTRAL").length,
        unknown: rows.length - evaluated.length,
        normalizedJointGain: !rows.length
          ? 0
          : !evaluated.length
            ? null
            : evaluated.reduce((n, g) => n + c612Defined(g.normalizedGain), 0),
      },
      "C6121_FOLD_METRIC_ARITHMETIC",
    );
  }
  demand(
    profile.activeFoldCount === profile.folds.filter((f) => f.changed).length &&
      profile.negativeGainFoldCount ===
        profile.folds.filter(
          (f) => f.normalizedJointGain !== null && f.normalizedJointGain < 0,
        ).length &&
      profile.unknownGainFoldCount ===
        profile.folds.filter((f) => f.unknown).length,
    "C6121_FOLD_SUMMARY_ARITHMETIC",
  );
}

export async function validateC6121Run(
  directory: string,
  repository: string,
  frozenRepository: string,
  baselineRepository: string,
  progress?: (message: string) => void,
) {
  const read = async <T>(name: string, schema: z.ZodType<T>) =>
    schema.parse(await readC6121Artifact(path.join(directory, name + ".json")));
  const baseline = await read(
    "c6-1-2-1-baseline-freeze-verification",
    s.c6121BaselineSchema,
  );
  const originalA = c612Defined(
    baseline.files.find(
      (f) => f.role === "frozen-a/machine/c6-1-2-machine-freeze-manifest.json",
    ),
  );
  const taskA = path.dirname(path.dirname(originalA.path));
  const originalB = c612Defined(
    baseline.files.find(
      (f) => f.role === "frozen-b/machine/c6-1-2-machine-freeze-manifest.json",
    ),
  );
  const taskB = path.dirname(path.dirname(originalB.path));
  const frozen = await readC612FrozenInputs(taskA, frozenRepository);
  const checks: {
    name: string;
    passed: boolean;
    observed: string;
    expected: string;
  }[] = [];
  const passed = (name: string, observed: string) => {
    checks.push({
      name,
      passed: true,
      observed,
      expected: "independently verified",
    });
    progress?.(name);
  };
  await verifyC6121Snapshot(baseline);
  passed(
    "frozen-input-snapshot",
    `${baseline.files.length} byte/metadata snapshots unchanged`,
  );
  const map = await read("c6-1-2-1-evaluator-supergroup-map", s.c6121MapSchema);
  const timing = await read(
    "gold-c6-1-2-1-timing-only-input",
    s.c6121TimingInputSchema,
  );
  const timingBarrier = await read(
    "c6-1-2-1-gold-timing-read-barrier",
    s.c6121TimingBarrierSchema,
  );
  const textBarrier = await read(
    "c6-1-2-1-gold-text-scoring-barrier",
    s.c6121TextBarrierSchema,
  );
  const freeze = await read("c6-1-2-1-supergroup-freeze", s.c6121FreezeSchema);
  const policy = await read(
    "c6-1-2-1-policy-freeze",
    s.c6121PolicyFreezeSchema,
  );
  demand(
    policy.definitionHash === C6121_POLICY_HASH &&
      hash(JSON.parse(policy.serializedDefinition)) === C6121_POLICY_HASH,
    "C6121_POLICY_NOT_PREDECLARED",
  );
  demand(
    baseline.machineFrozenAt <= timingBarrier.goldTimingFirstReadAt &&
      timingBarrier.goldTimingFirstReadAt <= freeze.supergroupFrozenAt &&
      freeze.supergroupFrozenAt <= textBarrier.goldTextFirstReadAt &&
      textBarrier.supergroupMapHash === map.semanticHash &&
      timingBarrier.baselineFreezeHash === baseline.semanticHash &&
      freeze.baselineFreezeHash === baseline.semanticHash &&
      timing.timingBarrierHash === timingBarrier.semanticHash &&
      textBarrier.timingBarrierHash === timingBarrier.semanticHash &&
      timingBarrier.goldTimingHash === hash(timing.rows) &&
      map.goldTimingHash === timingBarrier.goldTimingHash &&
      textBarrier.goldByteHash === timingBarrier.goldByteHash,
    "C6121_GOLD_BARRIER_OR_IDENTITY_INVALID",
  );
  demand(
    C6121_FROZEN_EVALUATOR_FILES.every((n) =>
      freeze.frozenFiles.some((f) => f.relativePath === n),
    ),
    "C6121_FROZEN_EVALUATOR_FILE_MISSING",
  );
  for (const file of freeze.frozenFiles) {
    const filename = await safeC612ArtifactPath(directory, file.relativePath);
    demand(
      (await fingerprintC6121(filename, file.relativePath)).sha256 ===
        file.sha256,
      "C6121_EVALUATOR_FREEZE_CHANGED",
    );
    demand(
      (await stat(filename)).mtimeMs <=
        Date.parse(textBarrier.goldTextFirstReadAt) + 2,
      "C6121_FILE_NOT_FROZEN_BEFORE_GOLD_TEXT",
    );
  }
  passed(
    "timing-and-text-read-barriers",
    "machine freeze <= timing-only read <= persisted map freeze <= text scoring; DTO rejects text",
  );
  const graph = buildC6121Supergroups({
    groups: frozen.mapping.groups,
    mappingHash: frozen.mapping.semanticHash,
    baselineCueOrder: frozen.production.cues.map((c) => c.id),
    production: frozen.production,
    universe: frozen.universe,
    folds: frozen.folds,
    goldTiming: timing.rows,
  });
  for (const artifact of Object.values(graph))
    sameC6121(
      artifact,
      await readC6121Artifact(
        path.join(directory, artifact.artifactType + ".json"),
      ),
      "C6121_GRAPH_RECOMPUTATION",
    );
  const reverse = buildC6121Supergroups({
    groups: [...frozen.mapping.groups].reverse(),
    mappingHash: frozen.mapping.semanticHash,
    baselineCueOrder: frozen.production.cues.map((c) => c.id),
    production: frozen.production,
    universe: frozen.universe,
    folds: frozen.folds,
    goldTiming: [...timing.rows].reverse(),
  });
  sameC6121(reverse, graph, "C6121_GRAPH_INPUT_ORDER_NONDETERMINISM");
  demand(
    map.groups
      .filter((g) => g.frozenFoldIds.length > 1)
      .every(
        (g) =>
          !g.shadowEvaluationEligible &&
          !g.candidateLabelEligible &&
          !g.oofTrainingEligible,
      ),
    "C6121_CROSS_FOLD_SUPERGROUP_USED",
  );
  passed(
    "graph-structure-determinism-and-fold-safety",
    `${graph.edgeLedger.rows.length} exact edges; no cross-fold group used`,
  );
  const historical = s.c611FixedBaselineAlignmentMapSchema.parse(
    JSON.parse(
      await readFile(
        c612Defined(baseline.files.find((f) => f.role === "historical-e1-map"))
          .path,
        "utf8",
      ),
    ),
  );
  sameC6121(
    replayC6121E1Timing(frozen, timing.rows, historical),
    await read("c6-1-2-1-e1-historical-bipartite-replay", s.c6121E1Schema),
    "C6121_E1_REPLAY_CHANGED",
  );
  const e0 = await read("c6-1-2-1-e0-legacy-replay", s.c6121E0Schema);
  demand(
    e0.passed &&
      e0.checks.every((c) => c.passed) &&
      e0.originalQualityHash === e0.recomputedQualityHash,
    "C6121_E0_PARITY_FAILED",
  );
  for (const relative of await treeFiles(path.join(directory, "replay-e0"))) {
    const a = JSON.parse(
      await readFile(path.join(directory, "replay-e0", relative), "utf8"),
    ) as unknown;
    const b = JSON.parse(
      await readFile(path.join(taskA, "evaluation", relative), "utf8"),
    ) as unknown;
    sameC6121(a, b, "C6121_FROZEN_E0_PAYLOAD_CHANGED");
  }
  passed(
    "E0-exact-numeric-replay-and-E1-historical-policy",
    "all original E0 replay payloads equal; E1 exact structural replay",
  );
  const labels = await read(
    "gold-c6-1-2-1-supergroup-candidate-labels",
    s.c6121LabelsSchema,
  );
  sameC6121(
    labels.labels.map((l) => l.candidateId).sort(),
    frozen.ranks.rows.map((r) => r.candidateId).sort(),
    "C6121_NEW_OR_MISSING_CANDIDATE",
  );
  for (const row of labels.labels) {
    const group = map.groups.find((g) => g.supergroupId === row.supergroupId),
      label = row.label;
    if (label.eligible) {
      demand(
        group?.candidateLabelEligible &&
          group.foldId === label.foldId &&
          row.oofTrainingEligible,
        "C6121_LABEL_ELIGIBILITY_OR_FOLD",
      );
      demand(
        label.exactGain ===
          c612Defined(label.baselineExactError) -
            c612Defined(label.candidateExactError) &&
          label.normalizedGain ===
            c612Defined(label.baselineNormalizedError) -
              c612Defined(label.candidateNormalizedError),
        "C6121_CANDIDATE_GAIN_ARITHMETIC",
      );
    } else
      demand(
        [
          label.normalizedGain,
          label.exactGain,
          label.catastrophicDeletion,
        ].every((v) => v === null),
        "C6121_CANDIDATE_UNKNOWN_COERCED",
      );
  }
  const oldLabels = s.c612CandidateLabelsSchema.parse(
    JSON.parse(
      await readFile(
        path.join(taskA, "evaluation/gold-c6-1-2-top-k-candidate-labels.json"),
        "utf8",
      ),
    ),
  );
  sameC6121(
    auditC6121LabelStability(oldLabels.labels, labels),
    await read("c6-1-2-1-label-stability-audit", s.c6121StabilitySchema),
    "C6121_LABEL_STABILITY_RECOMPUTATION",
  );
  const contract = await read(
    "c6-1-2-1-training-contract-parity",
    s.c6121TrainingParitySchema,
  );
  sameC6121(
    await c6121TrainingContract(frozen, repository, baselineRepository),
    contract,
    "C6121_TRAINING_CONTRACT_CHANGED",
  );
  const trained = retrainC6121Oof(
    frozen,
    map,
    labels,
    contract.trainingCodeHash,
  );
  for (const artifact of Object.values(trained))
    sameC6121(
      artifact,
      await readC6121Artifact(
        path.join(directory, artifact.artifactType + ".json"),
      ),
      "C6121_OOF_RECOMPUTATION",
    );
  passed(
    "same-feature-same-profile-OOF-independent-retraining",
    `${trained.models.models.length} exact models, thresholds, rankings and configurations; no Gold path in trainer`,
  );
  const frozenMetrics = await read(
    "c6-1-2-1-frozen-decision-reevaluation",
    s.c6121FrozenEvaluationSchema,
  );
  const retrainedMetrics = await read(
    "c6-1-2-1-oof-retrain-profile-evaluation",
    s.c6121RetrainedEvaluationSchema,
  );
  const frozenRankings = s.c612RankingsSchema.parse(
    JSON.parse(
      await readFile(
        path.join(taskA, "reranking/c6-1-2-oof-candidate-rankings.json"),
        "utf8",
      ),
    ),
  );
  const frozenDecisions = s.c612GroupDecisionsSchema.parse(
    JSON.parse(
      await readFile(
        path.join(taskA, "reranking/c6-1-2-oof-group-decisions.json"),
        "utf8",
      ),
    ),
  );
  for (const [metrics, rankings, decisions] of [
    [frozenMetrics, frozenRankings, frozenDecisions],
    [retrainedMetrics, trained.rankings, trained.decisions],
  ] as const) {
    for (const p of metrics.profiles) {
      verifyC6121Metrics(p, map);
      const assembly = renderC612Shadow(
        frozen.production,
        frozen.universe,
        decisions.rows
          .filter((d) => d.profileId === p.profileId)
          .flatMap((d) => d.selections),
        p.profileId,
      );
      const changed = frozen.mapping.groups.filter((g) =>
        g.cueIds.some(
          (id) =>
            frozen.production.cues.find((c) => c.id === id)?.text !==
            assembly.cues.find((c) => c.id === id)?.text,
        ),
      );
      const eligibleCues = new Set(
        map.groups
          .filter((g) => g.shadowEvaluationEligible)
          .flatMap((g) => g.machineCueIds),
      );
      demand(
        p.changedMachineGroups === changed.length,
        "C6121_CHANGED_MACHINE_GROUP_COUNT",
      );
      sameC6121(
        p.changedMachineGroupCoverage,
        fraction(
          changed.filter((g) => g.cueIds.every((id) => eligibleCues.has(id)))
            .length,
          changed.length,
        ),
        "C6121_CHANGED_MACHINE_COVERAGE",
      );
      for (const group of p.groups)
        demand(
          group.changed ===
            map.groups
              .find((g) => g.supergroupId === group.supergroupId)
              ?.machineCueIds.some(
                (id) =>
                  frozen.production.cues.find((c) => c.id === id)?.text !==
                  assembly.cues.find((c) => c.id === id)?.text,
              ),
          "C6121_CHANGED_SUPERGROUP_MISMATCH",
        );
      const ranks = rankings.rows
        .filter((r) => r.profileId === p.profileId)
        .flatMap((r) => {
          const q = rankingQuality(
            r.ranked.map((c) => c.candidateId),
            labels.labels.map((l) => l.label),
          );
          return q ? [q] : [];
        });
      sameC6121(
        p.top1Accuracy,
        fraction(
          ranks.reduce((n, q) => n + q.accuracy, 0),
          ranks.length,
        ),
        "C6121_RANKING_ACCURACY",
      );
      if (metrics === retrainedMetrics)
        for (const [ext, text] of [
          ["ass", assembly.ass],
          ["srt", assembly.srt],
          ["vtt", assembly.vtt],
        ] as const)
          demand(
            (await readFile(
              path.join(
                directory,
                "research-shadow/c6-1-2-1-retrained",
                p.profileId.toLowerCase(),
                "subtitle." + ext,
              ),
              "utf8",
            )) === text,
            "C6121_SHADOW_BYTE_RECONSTRUCTION",
          );
    }
  }
  passed(
    "joint-metrics-unknowns-folds-and-shadow-reconstruction",
    "18 profile results; original whole-candidate assembly; exact ASS/SRT/VTT bytes; no timing/cue edits",
  );
  const characterCounts = await read(
    "gold-c6-1-2-1-evaluation-character-counts",
    s.c6121GoldCountsSchema,
  );
  sameC6121(
    characterCounts.rows.map((r) => r.goldCueId),
    timing.rows.map((r) => r.id),
    "C6121_GOLD_LENGTH_ID_MISMATCH",
  );
  const coverage = c6121Coverage(
    frozen,
    map,
    timing.rows,
    labels.labels.map((l) => l.label),
    new Map(
      characterCounts.rows.map((r) => [r.goldCueId, r.normalizedGraphemes]),
    ),
  );
  const coverageAudit = await read(
    "c6-1-2-1-evaluation-coverage-recovery-audit",
    s.c6121CoverageAuditSchema,
  );
  sameC6121(
    c6121CoverageRecovery(frozen, map, coverage, e0.bindings),
    coverageAudit,
    "C6121_COVERAGE_DENOMINATORS",
  );
  const diagnostics = await read(
    "c6-1-2-1-diagnostic-mode-metrics",
    s.c6121DiagnosticsSchema,
  );
  const e1 = await read(
    "c6-1-2-1-e1-historical-bipartite-replay",
    s.c6121E1Schema,
  );
  const e0Map = diagnosticC6121Map(frozen, timing.rows, {
    kind: "E0",
    bindings: e0.bindings,
  });
  const e1Map = diagnosticC6121Map(frozen, timing.rows, {
    kind: "E1",
    map: e1.timingOnlyMap,
  });
  for (const [diagnosticMap, profiles] of [
    [e0Map, diagnostics.e0],
    [e1Map, diagnostics.e1],
  ] as const)
    for (const profile of profiles) verifyC6121Metrics(profile, diagnosticMap);
  sameC6121(
    compareC6121Modes({
      frozen,
      gold: timing.rows,
      goldCharacters: new Map(
        characterCounts.rows.map((r) => [r.goldCueId, r.normalizedGraphemes]),
      ),
      maps: [e0Map, e1Map, map],
      labels: [
        oldLabels.labels,
        diagnostics.e1CandidateLabels.map((l) => l.label),
        labels.labels.map((l) => l.label),
      ],
      metrics: [diagnostics.e0, diagnostics.e1, frozenMetrics.profiles],
    }),
    await read(
      "c6-1-2-1-evaluation-mode-comparison",
      s.c6121ModeComparisonSchema,
    ),
    "C6121_EVALUATOR_COMPARISON_RECOMPUTATION",
  );
  sameC6121(
    auditC6121Sensitivity(map, [
      diagnostics.e0,
      diagnostics.e1,
      frozenMetrics.profiles,
    ]),
    await read("c6-1-2-1-evaluator-sensitivity", s.c6121SensitivitySchema),
    "C6121_SENSITIVITY_RECOMPUTATION",
  );
  passed(
    "E0-E1-E2-mode-counts-and-error-unit-sensitivity",
    "isolated vertices are no-mapping; 27 profile-mode comparisons and catastrophic trace independently rebuilt",
  );
  const diagnosis = await read(
    "c6-1-2-1-completeness-blocker-diagnosis",
    s.c6121CompletenessSchema,
  );
  const initial = diagnoseC6121Completeness(
    frozen,
    labels,
    trained.rankings.rows,
    retrainedMetrics.profiles,
    false,
  );
  const preliminary = decideC6121Route({
    engineering: false,
    aBParity: false,
    productionMutation: 0,
    coverage,
    integrity: graph.integrity,
    frozen: frozenMetrics.profiles,
    retrained: retrainedMetrics.profiles,
    completeness: initial,
  });
  sameC6121(
    diagnoseC6121Completeness(
      frozen,
      labels,
      trained.rankings.rows,
      retrainedMetrics.profiles,
      preliminary.evaluationCoverageGate,
    ),
    diagnosis,
    "C6121_COMPLETENESS_DIAGNOSIS",
  );
  const readOnly = await read(
    "c6-1-2-1-read-only-proof",
    s.c6121ReadOnlySchema,
  );
  sameC6121(
    readOnly.inputAggregateHashAfter,
    baseline.inputAggregateHash,
    "C6121_INPUT_READ_ONLY_FAILED",
  );
  for (const file of [
    readOnly.goldBefore,
    readOnly.goldAfter,
    readOnly.sourceBefore,
    readOnly.sourceAfter,
  ])
    sameC6121(
      await fingerprintC6121(file.path, file.role),
      file,
      "C6121_LIVE_SOURCE_OR_GOLD_CHANGED",
    );
  passed(
    "coverage-recovery-completeness-and-live-read-only",
    "all denominators rebuilt; source and Gold byte/mtime equality; production original files unchanged",
  );
  const validatedArtifacts = await validateC6121Tree(directory, repository);
  passed(
    "strict-Zod-JSON-Schema-and-semantic-hash-validation",
    String(validatedArtifacts),
  );
  const oldArtifactCount =
    (await validateC612StrictTree(taskA)) +
    (await validateC612StrictTree(taskB));
  passed("original-C612-strict-artifact-regression", String(oldArtifactCount));
  return {
    directory,
    baseline,
    frozen,
    map,
    integrity: graph.integrity,
    coverage,
    labels,
    diagnosis,
    frozenMetrics,
    retrainedMetrics,
    readOnly,
    checks,
    validatedArtifacts,
    oldArtifactCount,
  };
}

export async function verifyC6121SchemaContracts(repository: string) {
  for (const [name, schema] of s.c6121GeneratedSchemas) {
    const expected = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id:
        "https://schemas.local/multilingual-video-learning/" +
        name +
        ".schema.json",
      title: name,
      ...z.toJSONSchema(schema, {
        target: "draft-2020-12",
        unrepresentable: "any",
      }),
    };
    const actual: unknown = JSON.parse(
      await readFile(
        path.join(repository, "schemas", name + ".schema.json"),
        "utf8",
      ),
    );
    sameC6121(actual, expected, "C6121_GENERATED_SCHEMA_STALE:" + name);
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      const object = value as Record<string, unknown>;
      if (object.type === "object")
        demand(
          object.additionalProperties === false,
          "C6121_NONSTRICT_NESTED_SCHEMA:" + name,
        );
      Object.values(object).forEach(walk);
    };
    walk(actual);
  }
  return (await readdir(path.join(repository, "schemas"))).filter((n) =>
    n.endsWith(".schema.json"),
  ).length;
}
export function c6121ShareableSummary(
  run: Awaited<ReturnType<typeof validateC6121Run>>,
  route: s.C6121Route,
) {
  const value = s.c6121ShareableSchema.parse(
    c6121Artifact("c6-1-2-1-shareable-summary", {
      baselineCommit: run.baseline.baselineCommit,
      sourceIdentity: run.baseline.sourceIdentity,
      supergroupMapHash: run.map.semanticHash,
      counts: {
        machineGroups: run.frozen.mapping.groups.length,
        productionCues: run.frozen.production.cues.length,
        goldCues: run.map.goldCueOrder.length,
        supergroups: run.map.groups.length,
        eligibleSupergroups: run.integrity.stableShadowEvaluationCount,
        crossFoldComponents: run.integrity.crossFoldComponentCount,
        newAsrInference: 0,
        newCtcInference: 0,
        productionMutations: 0,
      },
      coverage: run.coverage,
      route: route.route,
      engineeringGate: route.engineeringGate,
      evaluationCoverageGate: route.evaluationCoverageGate,
      selectedSafeProfile: route.selectedSafeProfile,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      privacy: "AGGREGATES_AND_HASHES_ONLY",
      containsGoldText: false,
      containsCandidateText: false,
      absolutePrivatePathCount: 0,
      secretCount: 0,
    }),
  );
  demand(
    auditC612ShareableValue(value).passed,
    "C6121_SHAREABLE_PRIVACY_FAILED",
  );
  return value;
}
