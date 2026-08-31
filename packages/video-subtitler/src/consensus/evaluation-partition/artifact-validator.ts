import path from "node:path";
import { readFile, stat, readdir } from "node:fs/promises";
import { z } from "zod";
import * as s from "@mvl/shared";
import { c612Defined } from "../top-k/c612-policy.js";
import { renderC612Shadow } from "../top-k/group-shadow-configurations.js";
import { auditC612ShareableValue } from "../top-k/c612-artifact-validator.js";
import {
  assertJsonSemanticHash,
  safeC612ArtifactPath,
} from "../top-k/c612-delivery-io.js";
import { normalize } from "../top-k/fixed-group-evaluation.js";
import { chars } from "../top-k/c612-structural.js";
import { fingerprintC6121 } from "../evaluation-recovery/baseline-freeze-verification.js";
import { verifyC6121Metrics } from "../evaluation-recovery/c6121-artifact-validator.js";
import { readAssTimingOnly } from "../evaluation-recovery/gold-timing-barrier.js";
import { prepareC61211Baseline, type C61211Paths } from "./baseline-freeze.js";
import {
  C61211_POLICY_HASH,
  c61211Artifact,
  demand,
  hash,
  validateC61211Artifact,
} from "./c61211-policy.js";
import {
  readC61211,
  c61211Files,
  snapshotC61211,
  shaBytes,
} from "./artifact-io.js";
import {
  verifyC61211PartitionFreeze,
  scoringC61211Gold,
} from "./gold-barriers.js";
import { partitionC61211 } from "./monotonic-partition-solver.js";
import {
  auditC61211Cuts,
  auditC61211Conservation,
  auditC61211Residuals,
} from "./partition-audits.js";
import {
  candidateC61211Scope,
  reachableC61211Scope,
  coverageC61211,
  coverageC61211Gate,
} from "./reachable-coverage.js";
import {
  rebindC61211Labels,
  stabilityC61211,
} from "./partition-label-rebinding.js";
import {
  trainingC61211Contract,
  retrainC61211,
} from "./same-feature-oof-retrainer.js";
import { scoringC61211Adapter } from "./scoring-adapter.js";
import {
  evaluateC61211Profiles,
  evidenceC61211Profiles,
} from "./partition-profile-evaluation.js";
import {
  wholeC61211,
  biasC61211,
  sensitivityC61211,
  attributionC61211,
} from "./whole-component-diagnostic.js";
import { completenessC61211 } from "./terminal-route.js";

export const sameC61211 = (a: unknown, b: unknown, code: string) =>
  demand(hash(a) === hash(b), code);
export async function validateC61211Tree(root: string, repository: string) {
  const compiled = new Map<string, ReturnType<typeof s.compileJsonSchema>>();
  let count = 0;
  for (const relative of await c61211Files(root)) {
    if (!relative.endsWith(".json")) continue;
    const value: unknown = JSON.parse(
      await readFile(path.join(root, relative), "utf8"),
    );
    demand(
      !!value && typeof value === "object",
      "C61211_ARTIFACT_OBJECT_REQUIRED",
    );
    if ("packageType" in value) {
      s.subtitlePackageSchema.parse(value);
      count++;
      continue;
    }
    const parsed = validateC61211Artifact(value),
      name = String(parsed.artifactType);
    let validate = compiled.get(name);
    if (!validate) {
      const schema: unknown = JSON.parse(
        await readFile(
          path.join(repository, "schemas", name + ".schema.json"),
          "utf8",
        ),
      );
      demand(
        !!schema && typeof schema === "object",
        "C61211_SCHEMA_OBJECT_REQUIRED",
      );
      validate = s.compileJsonSchema(schema);
      compiled.set(name, validate);
    }
    s.assertJsonSchema(validate, parsed);
    count++;
  }
  return count;
}
export async function verifyC61211SchemaContracts(repository: string) {
  for (const [name, schema] of s.c61211GeneratedSchemas) {
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
    sameC61211(actual, expected, "C61211_GENERATED_SCHEMA_STALE:" + name);
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      const row = value as Record<string, unknown>;
      if (row.type === "object")
        demand(
          row.additionalProperties === false,
          "C61211_NONSTRICT_NESTED_SCHEMA:" + name,
        );
      Object.values(row).forEach(walk);
    };
    walk(actual);
  }
  return (await readdir(path.join(repository, "schemas"))).filter((n) =>
    n.endsWith(".schema.json"),
  ).length;
}
export function verifyC61211Metrics(
  profile: s.C61211Profile,
  map: s.C61211Map,
) {
  const {
    partitionMapHash,
    selectedCount,
    changedBlocks,
    evaluableChangedBlocks,
    changedBlockCoverage,
    groups,
    safeProfileEligible,
    ...rest
  } = profile;
  void selectedCount;
  void safeProfileEligible;
  demand(partitionMapHash === map.semanticHash, "C61211_PROFILE_MAP_DRIFT");
  const adapter = scoringC61211Adapter(map);
  verifyC6121Metrics(
    s.c6121ProfileMetricSchema.parse({
      ...rest,
      supergroupMapHash: adapter.semanticHash,
      changedSupergroups: changedBlocks,
      evaluableChangedSupergroups: evaluableChangedBlocks,
      changedSupergroupCoverage: changedBlockCoverage,
      zeroSelectionChangedCoverage: changedBlocks
        ? changedBlockCoverage.ratio
        : 0,
      groups: groups.map(({ partitionBlockId, ...g }) => ({
        ...g,
        supergroupId: partitionBlockId,
      })),
    }),
    adapter,
  );
  if (!profile.selectedCount)
    demand(
      profile.selectionPrecision === null &&
        profile.harmRate === null &&
        !profile.safeProfileEligible,
      "C61211_ZERO_SELECTION_FAKE_SAFETY",
    );
}
/** Read-only independent acceptance: recomputes both the geometry and every
 * numerical result; scoring is entered only after persisted-map verification. */
export async function validateC61211Run(
  directory: string,
  paths: C61211Paths,
  progress?: (message: string) => void,
) {
  const read = async <T>(name: string, schema: z.ZodType<T>, sub = "") =>
    schema.parse(await readC61211(path.join(directory, sub, name + ".json")));
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
      expected: "independently recomputed from immutable inputs",
    });
    progress?.(name + ": " + observed);
  };
  const baseline = await read(
    "c6-1-2-1-1-baseline-freeze-verification",
    s.c61211BaselineSchema,
  );
  await snapshotC61211(baseline);
  const prepared = await prepareC61211Baseline(paths);
  demand(
    prepared.baseline.semanticHash === baseline.semanticHash,
    "C61211_BASELINE_REPLAY_OR_SOURCE_DRIFT",
  );
  const frozen = prepared.frozen;
  passed(
    "baseline-exact-replay-and-source-snapshot",
    String(baseline.files.length) +
      " unchanged byte/mtime/inode inputs; original E0/E1/E2/OOF replay passed",
  );
  const policy = await read("c6-1-2-1-1-policy-freeze", s.c61211PolicySchema);
  demand(
    policy.definitionHash === C61211_POLICY_HASH &&
      hash(JSON.parse(policy.serializedDefinition)) === C61211_POLICY_HASH,
    "C61211_POLICY_NOT_PREFROZEN",
  );
  const map = await read(
    "c6-1-2-1-1-partitioned-supergroup-map",
    s.c61211MapSchema,
  );
  const { timing, freeze } = await verifyC61211PartitionFreeze(
    directory,
    map,
    baseline,
  );
  const textBarrier = await read(
    "c6-1-2-1-1-gold-text-scoring-barrier",
    s.c61211TextBarrierSchema,
  );
  demand(
    freeze.partitionFrozenAt <= textBarrier.goldTextFirstReadAt &&
      textBarrier.partitionFrozenAt === freeze.partitionFrozenAt &&
      textBarrier.partitionFreezeHash === freeze.semanticHash &&
      textBarrier.partitionMapHash === map.semanticHash &&
      textBarrier.goldByteHash === timing.goldByteHash,
    "C61211_TEXT_BARRIER_BINDING_OR_ORDER",
  );
  for (const file of freeze.frozenFiles)
    demand(
      (await stat(path.join(directory, file.relativePath))).mtimeMs <=
        Date.parse(textBarrier.goldTextFirstReadAt) + 2,
      "C61211_FILE_NOT_FROZEN_BEFORE_GOLD_TEXT",
    );
  const originalTiming = await readAssTimingOnly(timing.goldFile.path);
  sameC61211(originalTiming.cues, timing.rows, "C61211_GOLD_TIMING_REPLAY");
  demand(
    originalTiming.byteHash === timing.goldByteHash,
    "C61211_GOLD_BYTE_IDENTITY_CHANGED",
  );
  passed(
    "four-gold-isolation-barriers",
    "machine <= timing-only <= persisted partition freeze <= text scoring; live timing DTO exact",
  );
  const input = {
    groups: frozen.mapping.groups,
    mappingHash: frozen.mapping.semanticHash,
    baselineCueOrder: frozen.production.cues.map((c) => c.id),
    production: frozen.production,
    universe: frozen.universe,
    folds: frozen.folds,
    goldTiming: timing.rows,
    candidateReachableMachineGroupIds:
      candidateC61211Scope(frozen).candidateReachableMachineGroupIds,
  };
  const d0 = partitionC61211(input, "D0_NO_CUT"),
    d1 = partitionC61211(input),
    d2 = partitionC61211(input, "D2_RELAXED_DIAGNOSTIC_ONLY");
  sameC61211(d1.map, map, "C61211_PRIMARY_PARTITION_RECOMPUTATION");
  sameC61211(
    d1.graph.map,
    prepared.graphMap,
    "C61211_E2_BASELINE_GRAPH_CHANGED",
  );
  sameC61211(
    d1.inventory,
    await read(
      "c6-1-2-1-1-oversized-component-inventory",
      s.c61211InventorySchema,
    ),
    "C61211_COMPONENT_INVENTORY_RECOMPUTATION",
  );
  for (const [sub, result] of [
    ["d0", d0],
    ["", d1],
    ["d2", d2],
  ] as const) {
    const audit = auditC61211Conservation(input, result.map, result.graph);
    demand(audit.passed, "C61211_PARTITION_CONSERVATION_FAILED:" + sub);
    for (const value of [
      result.map,
      result.candidates,
      auditC61211Cuts(result.map, result.graph),
      auditC61211Residuals(result.map, sub === "d2" ? null : d2.map),
      audit,
    ])
      sameC61211(
        value,
        await readC61211(
          path.join(directory, sub, value.artifactType + ".json"),
        ),
        "C61211_PARTITION_OR_CUT_AUDIT_RECOMPUTATION:" + sub,
      );
  }
  const reordered = partitionC61211({
    ...input,
    groups: [...input.groups].reverse(),
    goldTiming: [...input.goldTiming].reverse(),
  });
  sameC61211(reordered.map, map, "C61211_PARTITION_INPUT_ORDER_NONDETERMINISM");
  const scope = reachableC61211Scope(frozen, d1.graph);
  sameC61211(
    scope,
    await read("c6-1-2-1-1-reachable-scope", s.c61211ScopeSchema),
    "C61211_FROZEN_REACHABILITY_SCOPE_DRIFT",
  );
  const preText = coverageC61211(frozen, map, scope, timing.rows);
  sameC61211(
    preText,
    await read(
      "c6-1-2-1-1-reachable-coverage-audit",
      s.c61211CoverageSchema,
      "pre-text",
    ),
    "C61211_PRE_TEXT_COVERAGE_DRIFT",
  );
  sameC61211(
    coverageC61211Gate(preText, auditC61211Conservation(input, map, d1.graph)),
    await read("c6-1-2-1-1-coverage-gate-v2", s.c61211GateSchema, "pre-text"),
    "C61211_PRE_TEXT_GATE_DRIFT",
  );
  passed(
    "exact-D0-D1-D2-partitions-cuts-residuals-and-conservation",
    String(d1.map.blocks.length) +
      " D1 blocks; input-order invariant; no missing/duplicated nodes or edges",
  );
  // Validation reads text only now. The numeric trainer below receives no Gold.
  const scored = await scoringC61211Gold({
    directory,
    gold: timing.goldFile.path,
    baseline,
    map,
  });
  demand(
    scored.barrier.semanticHash === textBarrier.semanticHash,
    "C61211_GOLD_SCORING_BARRIER_REPLAY",
  );
  const labels = rebindC61211Labels(
    frozen,
    map,
    scored.gold,
    timing.goldByteHash,
  );
  sameC61211(
    labels,
    await read(
      "gold-c6-1-2-1-1-partition-candidate-labels",
      s.c61211LabelsSchema,
    ),
    "C61211_NUMERIC_LABEL_RECOMPUTATION",
  );
  const stability = stabilityC61211(prepared.oldLabels, labels);
  sameC61211(
    stability,
    await read("c6-1-2-1-1-label-stability-audit", s.c61211StabilitySchema),
    "C61211_LABEL_STABILITY_RECOMPUTATION",
  );
  const contract = await trainingC61211Contract(
    frozen,
    paths.repository,
    paths.trainingBaselineRepository,
  );
  sameC61211(
    contract,
    await read("c6-1-2-1-1-training-contract-parity", s.c61211TrainingSchema),
    "C61211_TRAINING_CONTRACT_CHANGED",
  );
  const trained = retrainC61211(frozen, map, labels, contract.trainingCodeHash);
  for (const value of Object.values(trained))
    sameC61211(
      value,
      await readC61211(path.join(directory, value.artifactType + ".json")),
      "C61211_NUMERIC_OOF_RECOMPUTATION:" + value.artifactType,
    );
  for (const model of trained.models.models) {
    const outer = c612Defined(
      frozen.folds.folds.find((f) => f.foldId === model.outerFoldId),
    );
    demand(
      !model.trainingEventIds.some((id) => outer.eventIds.includes(id)),
      "C61211_OUTER_TEST_LABEL_LEAKAGE",
    );
  }
  passed(
    "joint-counterfactual-labels-and-independent-45-model-OOF",
    String(labels.labels.filter((l) => l.label.eligible).length) +
      " numeric labels; feature/fold/profile/grid/algorithm hashes fixed",
  );
  const originalRankings = s.c612RankingsSchema.parse(
    await assertJsonSemanticHash(
      path.join(prepared.taskA, "reranking/c6-1-2-oof-candidate-rankings.json"),
    ),
  );
  const originalDecisions = s.c612GroupDecisionsSchema.parse(
    await assertJsonSemanticHash(
      path.join(prepared.taskA, "reranking/c6-1-2-oof-group-decisions.json"),
    ),
  );
  const common = {
    frozen,
    map,
    gold: scored.gold,
    labels: labels.labels.map((l) => l.label),
  };
  const frozenProfiles = evaluateC61211Profiles({
    ...common,
    rankings: originalRankings.rows,
    decisions: originalDecisions.rows,
    track: "FROZEN_DECISION_REEVALUATION",
  });
  const retrainedProfiles = evaluateC61211Profiles({
    ...common,
    rankings: trained.rankings.rows,
    decisions: trained.decisions.rows,
    track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  });
  for (const [name, profiles] of [
    ["c6-1-2-1-1-frozen-decision-reevaluation", frozenProfiles],
    ["c6-1-2-1-1-oof-profile-evaluation", retrainedProfiles],
    [
      "gold-c6-1-2-1-1-partition-profile-labels",
      [...frozenProfiles, ...retrainedProfiles],
    ],
  ] as const)
    sameC61211(
      c61211Artifact(name, {
        partitionMapHash: map.semanticHash,
        scoringAdapterHash: labels.scoringAdapterHash,
        profiles,
      }),
      await readC61211(path.join(directory, name + ".json")),
      "C61211_JOINT_PROFILE_RECOMPUTATION:" + name,
    );
  for (const p of [...frozenProfiles, ...retrainedProfiles])
    verifyC61211Metrics(p, map);
  sameC61211(
    evidenceC61211Profiles(map, [...frozenProfiles, ...retrainedProfiles]),
    await read(
      "c6-1-2-1-1-profile-evidence-coverage",
      s.c61211ProfileEvidenceSchema,
    ),
    "C61211_PROFILE_EVIDENCE_COVERAGE",
  );
  const shadows = await read(
    "c6-1-2-1-1-research-shadow-manifest",
    s.c61211ShadowsSchema,
  );
  demand(shadows.rows.length === 18, "C61211_SHADOW_PROFILE_SET_INCOMPLETE");
  for (const row of shadows.rows) {
    const decisions =
      row.track === "FROZEN_DECISION_REEVALUATION"
        ? originalDecisions.rows
        : trained.decisions.rows;
    const selections = decisions
      .filter((d) => d.profileId === row.profileId)
      .flatMap((d) => d.selections);
    const shadow = renderC612Shadow(
      frozen.production,
      frozen.universe,
      selections,
      row.profileId,
    );
    sameC61211(
      row.selectedCandidateIds,
      selections.map((q) => q.candidateId),
      "C61211_SHADOW_SELECTION_DRIFT",
    );
    demand(
      shadow.textHash === row.textHash && shadow.timingHash === row.timingHash,
      "C61211_SHADOW_HASH_DRIFT",
    );
    for (const [name, expected] of Object.entries({
      "subtitle-package.json":
        JSON.stringify(shadow.subtitlePackage, null, 2) + "\n",
      "subtitle.ass": shadow.ass,
      "subtitle.srt": shadow.srt,
      "subtitle.vtt": shadow.vtt,
    })) {
      const relative = path.join(row.relativeDirectory, name),
        actual = await readFile(
          await safeC612ArtifactPath(directory, relative),
        );
      demand(
        actual.equals(Buffer.from(expected)),
        "C61211_SHADOW_BYTE_RECONSTRUCTION:" + relative,
      );
      demand(
        row.files.find((f) => f.relativePath === relative)?.sha256 ===
          shaBytes(actual),
        "C61211_SHADOW_MANIFEST_BYTES",
      );
      if (
        row.track === "FROZEN_DECISION_REEVALUATION" &&
        name !== "subtitle-package.json"
      )
        demand(
          actual.equals(
            await readFile(
              path.join(
                prepared.taskA,
                "research-shadow",
                row.profileId.toLowerCase(),
                name,
              ),
            ),
          ),
          "C61211_FROZEN_SHADOW_BYTES_CHANGED",
        );
    }
  }
  passed(
    "joint-metrics-and-18-original-assembly-shadow-bytes",
    "profile/rematching/unknown/fold arithmetic checked; original Track A ASS/SRT/VTT bytes exact; Track B original assembler",
  );
  const characters = new Map(
    scored.gold.map((g) => [g.id, chars(normalize(g.text)).length]),
  );
  for (const [sub, result] of [
    ["d0", d0],
    ["", d1],
    ["d2", d2],
  ] as const)
    sameC61211(
      coverageC61211(
        frozen,
        result.map,
        scope,
        timing.rows,
        sub ? null : labels.labels.map((l) => l.label),
        characters,
      ),
      await read(
        "c6-1-2-1-1-reachable-coverage-audit",
        s.c61211CoverageSchema,
        sub,
      ),
      "C61211_COVERAGE_DENOMINATOR_RECOMPUTATION:" + sub,
    );
  const coverage = await read(
      "c6-1-2-1-1-reachable-coverage-audit",
      s.c61211CoverageSchema,
    ),
    conservation = auditC61211Conservation(input, map, d1.graph),
    cuts = auditC61211Cuts(map, d1.graph),
    gate = coverageC61211Gate(coverage, conservation);
  sameC61211(
    gate,
    await read("c6-1-2-1-1-coverage-gate-v2", s.c61211GateSchema),
    "C61211_COVERAGE_GATE_NOT_PROFILE_INDEPENDENT",
  );
  const whole = wholeC61211({
    frozen,
    map,
    graph: d1.graph,
    gold: scored.gold,
    tracks: [
      { profiles: frozenProfiles, decisions: originalDecisions.rows },
      { profiles: retrainedProfiles, decisions: trained.decisions.rows },
    ],
  });
  const bias = biasC61211(map, whole, conservation, cuts, stability),
    completeness = completenessC61211(
      frozen,
      labels,
      trained.rankings.rows,
      retrainedProfiles,
      gate.passed,
    );
  for (const value of [
    whole,
    bias,
    completeness,
    sensitivityC61211(
      {
        e0: prepared.diagnostics.e0,
        e1: prepared.diagnostics.e1,
        e2: prepared.frozenMetrics,
      },
      [...frozenProfiles, ...retrainedProfiles],
      whole,
      prepared.modeComparison,
      coverage,
      scope,
      map,
    ),
    attributionC61211(d1.graph, map, stability, cuts),
  ])
    sameC61211(
      value,
      await readC61211(path.join(directory, value.artifactType + ".json")),
      "C61211_DIAGNOSTIC_RECOMPUTATION:" + value.artifactType,
    );
  passed(
    "reachable-denominators-E4-bias-sensitivity-and-completeness",
    "global Gold-only cues retained in global quality; D2/E4 never authorize route; joint rather than summed counterfactual gains",
  );
  const readOnly = await read(
    "c6-1-2-1-1-read-only-proof",
    s.c61211ReadOnlySchema,
  );
  demand(
    readOnly.passed &&
      readOnly.baselineFreezeHash === baseline.semanticHash &&
      readOnly.inputAggregateHashBefore === baseline.inputAggregateHash &&
      readOnly.inputAggregateHashAfter === (await snapshotC61211(baseline)),
    "C61211_INPUT_OR_PRODUCTION_MUTATION",
  );
  for (const f of [
    readOnly.sourceBefore,
    readOnly.sourceAfter,
    readOnly.goldBefore,
    readOnly.goldAfter,
  ])
    sameC61211(
      await fingerprintC6121(f.path, f.role),
      f,
      "C61211_LIVE_SOURCE_OR_GOLD_MUTATION",
    );
  demand(
    readOnly.goldTimingEvaluatorInputCount === timing.rows.length &&
      readOnly.goldTextScoringInputCount === scored.gold.length &&
      readOnly.trainingNumericLabelCount ===
        trained.models.trainingNumericLabelCount,
    "C61211_INPUT_ACCOUNTING_MISMATCH",
  );
  passed(
    "source-gold-production-and-all-frozen-inputs-read-only",
    "byte SHA, mtime and inode unchanged; zero acoustic inference and production mutation",
  );
  const checkedArtifacts = await validateC61211Tree(
    directory,
    paths.repository,
  );
  passed(
    "strict-zod-json-schema-and-semantic-hashes",
    String(checkedArtifacts),
  );
  return {
    directory,
    baseline,
    frozen,
    map,
    d0,
    d2,
    timing,
    freeze,
    textBarrier,
    scope,
    coverage,
    gate,
    conservation,
    cuts,
    labels,
    stability,
    contract,
    trained,
    frozenProfiles,
    retrainedProfiles,
    whole,
    bias,
    completeness,
    readOnly,
    shadows,
    checks,
    checkedArtifacts,
  };
}
export function shareableC61211(
  run: Awaited<ReturnType<typeof validateC61211Run>>,
  route: s.C61211Route,
) {
  const value = s.c61211ShareableSchema.parse(
    c61211Artifact("c6-1-2-1-1-shareable-summary", {
      baselineCommit: run.baseline.baselineCommit,
      partitionMapHash: run.map.semanticHash,
      reachableScopeHash: run.scope.semanticHash,
      route: route.route,
      engineeringGate: route.engineeringGate,
      coverageGate: route.evaluationCoverageGate,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      counts: {
        productionCues: run.frozen.production.cues.length,
        machineGroups: run.frozen.mapping.groups.length,
        goldCues: run.timing.rows.length,
        evaluationBlocks: run.map.blocks.filter(
          (b) => b.shadowEvaluationEligible,
        ).length,
        residualBlocks: run.map.blocks.filter(
          (b) => !b.shadowEvaluationEligible,
        ).length,
        cuts: run.cuts.rows.length,
        strongCuts: run.conservation.strongBridgeCutCount,
        acousticInference: 0,
        productionMutation: 0,
      },
      coverage: run.coverage.coverage,
      privacy: "AGGREGATES_AND_HASHES_ONLY",
      containsGoldText: false,
      containsCandidateText: false,
      absolutePrivatePathCount: 0,
      secretCount: 0,
    }),
  );
  demand(
    auditC612ShareableValue(value).passed,
    "C61211_SHAREABLE_PRIVACY_FAILED",
  );
  return value;
}
