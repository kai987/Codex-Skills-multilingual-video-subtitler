import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import {
  c611BaselineSchema,
  c611CalibrationFoldsSchema,
  c611CalibrationPolicySchema,
  c611FixedBaselineAlignmentMapSchema,
  c611GeneratedSchemas,
  c611LegacyControlSchema,
  c611MachineFeatureFreezeSchema,
  c611OofDecisionsSchema,
  c611PolicyFreezeSchema,
  c611ProposalLabelsSchema,
  c611ReadOnlyProofSchema,
  c611ShareableSummarySchema,
  c611RouteDecisionSchema,
  c611SelectiveMbrFreezeSchema,
  c611SelectiveProfileResultsSchema,
  c611ShadowManifestSchema,
  c611ValidationSchema,
  c61GeneratedSchemas,
  machineSelectiveExistingCandidateProposalsSchema,
  machineSelectiveMbrFeaturesSchema,
  machineVsGoldEvaluationSchema,
  subtitlePackageSchema,
  type C611Decision,
  type C611FixedAlignmentEvaluation,
  type C611OofDecisions,
  type C611Validation,
  type C611CalibrationFolds,
} from "@mvl/shared";
import {
  C611_REGRESSION_STAGES,
  c611RegressionEvidenceSchema,
} from "../../../shared/src/c6-1-1-validation-schemas.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../blind-acceptance/gold-isolation.js";
import { c61FileHash, c61Json, c61TreeFiles } from "./c61-artifact-io.js";
import { verifyC611MachineFreeze } from "./c611-artifact-io.js";
import {
  c611CueViews,
  c611MappingContent,
  c611StableMapping,
  c611TextHash,
} from "./fixed-baseline-alignment-map.js";
import {
  c61MetricsFromEvaluation,
  compareC61Timing,
} from "./consensus-quality-evaluator.js";
import { prepareC611CalibrationSamples } from "./selective-mbr-calibration.js";
import { buildC611Folds, verifyC611Folds } from "./selective-mbr-folds.js";
import {
  calculateC611SelectiveMetrics,
  c611CalibrationLabels,
  runC611Oof,
} from "./selective-mbr-oof.js";
import {
  createC611FutureModelFreeze,
  decideC611SelectiveRoute,
} from "./selective-mbr-route-decision.js";
import { C611_POLICY_VERSION } from "./c611-policy.js";

function requireCondition(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
function equal(a: unknown, b: unknown, code: string): void {
  requireCondition(hash(a) === hash(b), code);
}
export function verifyC611SelfHash(value: { semanticHash: string }): void {
  const { semanticHash, ...body } = value;
  requireCondition(hash(body) === semanticHash, "C611_INVALID_SELF_HASH");
}
export function verifyC611NestedSelfHashes(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if ("semanticHash" in value) {
    requireCondition(
      typeof value.semanticHash === "string",
      "C611_INVALID_NESTED_HASH_TYPE",
    );
    verifyC611SelfHash(value as { semanticHash: string });
  }
  for (const child of Object.values(value)) verifyC611NestedSelfHashes(child);
}
function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
/** Reject traversal and symlink escapes before opening a referenced artifact. */
export async function resolveC611ArtifactFile(
  root: string,
  relative: string,
): Promise<string> {
  requireCondition(
    relative.length > 0 &&
      !path.isAbsolute(relative) &&
      !relative.split(/[\\/]/u).includes(".."),
    "C611_UNSAFE_ARTIFACT_REFERENCE",
  );
  const target = path.resolve(root, relative);
  requireCondition(
    within(path.resolve(root), target),
    "C611_UNSAFE_ARTIFACT_REFERENCE",
  );
  requireCondition(
    !(await lstat(target)).isSymbolicLink(),
    "C611_SYMLINK_ARTIFACT_REJECTED",
  );
  requireCondition(
    within(await realpath(root), await realpath(target)),
    "C611_ARTIFACT_REFERENCE_ESCAPES_ROOT",
  );
  requireCondition(
    (await stat(target)).isFile(),
    "C611_ARTIFACT_REFERENCE_NOT_FILE",
  );
  return target;
}
async function json<T>(
  root: string,
  name: string,
  schema: z.ZodType<T>,
): Promise<T> {
  return schema.parse(await c61Json(await resolveC611ArtifactFile(root, name)));
}
export async function validateC611StrictTree(root: string): Promise<number> {
  requireCondition(
    !(await lstat(root)).isSymbolicLink(),
    "C611_SYMLINK_ROOT_REJECTED",
  );
  let count = 0;
  for (const file of await c61TreeFiles(root)) {
    if (!file.relativePath.endsWith(".json")) continue;
    const value: unknown = await c61Json(
      await resolveC611ArtifactFile(root, file.relativePath),
    );
    requireCondition(
      value && typeof value === "object",
      "C611_JSON_OBJECT_REQUIRED",
    );
    if (
      "packageType" in value &&
      value.packageType === "multilingual-subtitle-package"
    ) {
      subtitlePackageSchema.parse(value);
    } else if (file.relativePath.endsWith(".local-only.json")) {
      machineVsGoldEvaluationSchema.parse(value);
    } else {
      const artifactType = "artifactType" in value ? value.artifactType : null;
      const entry = [...c611GeneratedSchemas, ...c61GeneratedSchemas].find(
        ([name]) => name === artifactType,
      );
      requireCondition(
        entry,
        `C611_UNREGISTERED_ARTIFACT:${file.relativePath}`,
      );
      const parsed = entry[1].parse(value);
      verifyC611SelfHash(parsed);
      if (c611GeneratedSchemas.some(([name]) => name === artifactType))
        verifyC611NestedSelfHashes(parsed);
    }
    count++;
  }
  return count;
}

/** Validate nested split isolation independently of the deterministic rerun. */
export function validateC611OofIsolation(
  oof: C611OofDecisions,
  folds: C611CalibrationFolds,
): void {
  const all = new Set(folds.folds.flatMap((f) => f.proposalIds));
  for (const audit of oof.calibrationAudits) {
    verifyC611SelfHash(audit);
    verifyC611SelfHash(audit.model);
    const fold = folds.folds.find((f) => f.foldId === audit.outerFoldId);
    requireCondition(fold, "C611_UNKNOWN_OUTER_FOLD");
    equal(
      [...audit.outerTestEventIds].sort(),
      [...fold.eventIds].sort(),
      "C611_OUTER_TEST_EVENT_IDS_MISMATCH",
    );
    // S1 has separate proposal IDs; event membership still has to be identical.
    if (audit.profileId !== "S1") {
      equal(
        [...audit.outerTestProposalIds].sort(),
        [...fold.proposalIds].sort(),
        "C611_OUTER_TEST_PROPOSAL_IDS_MISMATCH",
      );
      equal(
        [...audit.outerTrainingProposalIds].sort(),
        [...all].filter((id) => !fold.proposalIds.includes(id)).sort(),
        "C611_OUTER_TRAIN_IDS_MISMATCH",
      );
    }
    const train = new Set(audit.outerTrainingProposalIds),
      test = new Set(audit.outerTestProposalIds);
    requireCondition(
      [...train].every((id) => !test.has(id)) &&
        audit.trainTestIntersectionCount === 0,
      "C611_OUTER_TRAIN_TEST_LEAKAGE",
    );
    requireCondition(
      audit.model.trainingProposalIds.every((id) => train.has(id)),
      "C611_OUTER_MODEL_TEST_LEAKAGE",
    );
    for (const split of audit.innerSplits) {
      verifyC611SelfHash(split.model);
      const innerTrain = new Set(split.trainingProposalIds),
        innerTest = new Set(split.testProposalIds);
      requireCondition(
        [...innerTrain, ...innerTest].every((id) => train.has(id)),
        "C611_INNER_SPLIT_ESCAPES_OUTER_TRAIN",
      );
      requireCondition(
        [...innerTrain].every((id) => !innerTest.has(id)),
        "C611_INNER_TRAIN_TEST_LEAKAGE",
      );
      requireCondition(
        split.model.trainingProposalIds.every((id) => innerTrain.has(id)),
        "C611_INNER_MODEL_TEST_LEAKAGE",
      );
      equal(
        split.modelHash,
        split.model.semanticHash,
        "C611_INNER_MODEL_HASH_MISMATCH",
      );
      equal(
        split.predictions.map((p) => p.proposalId).sort(),
        [...innerTest].sort(),
        "C611_INNER_TEST_PREDICTIONS_INCOMPLETE",
      );
    }
  }
  const expectedProfiles = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7"];
  for (const profileId of expectedProfiles) {
    const rows = oof.decisions.filter((d) => d.profileId === profileId);
    requireCondition(
      rows.length === all.size &&
        new Set(rows.map((d) => d.eventId)).size === rows.length,
      "C611_OOF_TEST_UNIVERSE_INCOMPLETE",
    );
    for (const row of rows) {
      verifyC611SelfHash(row);
      requireCondition(
        folds.folds.some(
          (f) => f.foldId === row.foldId && f.eventIds.includes(row.eventId),
        ),
        "C611_DECISION_NOT_OUTER_TEST",
      );
      const audit = oof.calibrationAudits.find(
        (a) => a.profileId === profileId && a.outerFoldId === row.foldId,
      );
      requireCondition(
        audit?.model.semanticHash === row.modelHash,
        "C611_DECISION_MODEL_AUDIT_MISSING",
      );
    }
  }
}

/** Arithmetic-only verification. This never opens Gold or rematches a profile. */
export function validateC611FixedArithmetic(
  fixed: C611FixedAlignmentEvaluation,
): void {
  verifyC611SelfHash(fixed);
  requireCondition(
    new Set(fixed.groups.map((g) => g.groupId)).size === fixed.groups.length,
    "C611_DUPLICATED_FIXED_GROUP_ERRORS",
  );
  for (const group of fixed.groups) {
    verifyC611SelfHash(group);
    if (group.outcome === "UNEVALUABLE") {
      requireCondition(
        [
          group.baselineExactError,
          group.baselineNormalizedError,
          group.shadowExactError,
          group.shadowNormalizedError,
          group.exactGain,
          group.normalizedGain,
          group.goldExactGraphemeCount,
          group.goldNormalizedGraphemeCount,
        ].every((v) => v === null),
        "C611_UNEVALUABLE_GROUP_HAS_ERROR_VALUE",
      );
    } else {
      requireCondition(
        group.baselineExactError !== null &&
          group.shadowExactError !== null &&
          group.baselineNormalizedError !== null &&
          group.shadowNormalizedError !== null,
        "C611_EVALUABLE_GROUP_MISSING_ERROR",
      );
      requireCondition(
        group.exactGain === group.baselineExactError - group.shadowExactError &&
          group.normalizedGain ===
            group.baselineNormalizedError - group.shadowNormalizedError,
        "C611_FIXED_GAIN_ARITHMETIC_MISMATCH",
      );
      const outcome =
        group.normalizedGain > 0
          ? "IMPROVED"
          : group.normalizedGain < 0
            ? "REGRESSED"
            : "NEUTRAL";
      requireCondition(
        group.outcome === outcome,
        "C611_FIXED_OUTCOME_MISMATCH",
      );
    }
  }
  const groups = fixed.groups;
  const sum = (
    key:
      | "baselineExactError"
      | "baselineNormalizedError"
      | "shadowExactError"
      | "shadowNormalizedError"
      | "exactGain"
      | "normalizedGain"
      | "goldExactGraphemeCount"
      | "goldNormalizedGraphemeCount",
  ) => groups.reduce((n, g) => n + (g[key] ?? 0), 0);
  const evaluable = groups.filter((g) => g.outcome !== "UNEVALUABLE").length;
  const changed = groups.filter((g) => g.changed).length;
  const mappedChanged = groups.filter(
    (g) => g.changed && g.outcome !== "UNEVALUABLE",
  ).length;
  const exact = sum("goldExactGraphemeCount"),
    normalized = sum("goldNormalizedGraphemeCount");
  equal(
    fixed.summary,
    {
      totalCueGroups: groups.length,
      changedCueGroups: changed,
      stableMappedGroups: groups.filter((g) =>
        c611StableMapping(g.mappingStatus),
      ).length,
      ambiguousGroups: groups.filter(
        (g) => g.mappingStatus === "AMBIGUOUS_BASELINE_MAPPING",
      ).length,
      unmappedGroups: groups.filter(
        (g) => g.mappingStatus === "NO_BASELINE_MAPPING",
      ).length,
      structureIncompatibleGroups: groups.filter(
        (g) => g.mappingStatus === "STRUCTURE_INCOMPATIBLE",
      ).length,
      fixedMappedChangedGroupCount: mappedChanged,
      evaluableGroups: evaluable,
      improvedGroups: groups.filter((g) => g.outcome === "IMPROVED").length,
      regressedGroups: groups.filter((g) => g.outcome === "REGRESSED").length,
      neutralGroups: groups.filter((g) => g.outcome === "NEUTRAL").length,
      unevaluableGroups: groups.length - evaluable,
      fixedEvaluationCoverage: groups.length ? evaluable / groups.length : null,
      changedGroupCoverage: changed ? mappedChanged / changed : null,
      baselineExactError: sum("baselineExactError"),
      baselineNormalizedError: sum("baselineNormalizedError"),
      shadowExactError: sum("shadowExactError"),
      shadowNormalizedError: sum("shadowNormalizedError"),
      exactGain: sum("exactGain"),
      normalizedGain: sum("normalizedGain"),
      goldExactGraphemeCount: exact,
      goldNormalizedGraphemeCount: normalized,
      baselineExactCer: exact ? sum("baselineExactError") / exact : null,
      baselineNormalizedCer: normalized
        ? sum("baselineNormalizedError") / normalized
        : null,
      shadowExactCer: exact ? sum("shadowExactError") / exact : null,
      shadowNormalizedCer: normalized
        ? sum("shadowNormalizedError") / normalized
        : null,
    },
    "C611_FIXED_SUMMARY_ARITHMETIC_MISMATCH",
  );
}

export function parseC611VitestCounts(
  log: string,
): { passed: number; failed: number; skipped: number } | null {
  const line = stripVTControlCharacters(log)
    .split(/\r?\n/u)
    .filter((l) => /^\s*Tests\s/u.test(l))
    .at(-1);
  if (!line) return null;
  const count = (kind: string) =>
    Number(new RegExp(`(\\d+) ${kind}`, "u").exec(line)?.[1] ?? 0);
  return {
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
  };
}
export async function validateC611RegressionEvidence(
  file: string,
  expectedSourceHash: string,
) {
  const evidence = c611RegressionEvidenceSchema.parse(await c61Json(file));
  verifyC611SelfHash(evidence);
  equal(
    evidence.sourceCodeAggregateHash,
    expectedSourceHash,
    "C611_QA_SOURCE_HASH_MISMATCH",
  );
  equal(
    evidence.checks.map((c) => c.stage).sort(),
    [...C611_REGRESSION_STAGES].sort(),
    "C611_QA_STAGE_COVERAGE_MISSING",
  );
  for (const check of evidence.checks) {
    const logFile = await resolveC611ArtifactFile(
      path.dirname(file),
      check.logRelativePath,
    );
    equal(
      await c61FileHash(logFile),
      check.logSha256,
      "C611_QA_LOG_HASH_MISMATCH",
    );
    requireCondition(
      check.exitCode === 0,
      `C611_QA_NONZERO_EXIT:${check.stage}`,
    );
    const log = await readFile(logFile, "utf8");
    requireCondition(log.trim().length > 0, "C611_QA_EMPTY_LOG");
    if (["unit", "e2e", "targeted"].includes(check.stage)) {
      const counts = parseC611VitestCounts(log);
      requireCondition(
        counts && counts.passed > 0 && counts.failed === 0,
        "C611_QA_TEST_COUNTS_MISSING_OR_FAILED",
      );
      equal(check.tests, counts, "C611_QA_REPORTED_TEST_COUNTS_MISMATCH");
      requireCondition(
        counts.skipped === 0 || check.skipReasons.length > 0,
        "C611_QA_UNEXPLAINED_SKIPS",
      );
    } else
      requireCondition(
        check.tests === null,
        "C611_QA_NONTTEST_HAS_TEST_COUNTS",
      );
  }
  return evidence;
}

async function loadSide(root: string, repository: string) {
  const machine = path.join(root, "machine"),
    evaluation = path.join(root, "evaluation"),
    shadow = path.join(root, "shadow");
  const claimed = await json(
    machine,
    "c6-1-1-machine-feature-freeze.json",
    c611MachineFeatureFreezeSchema,
  );
  for (const file of claimed.sourceCodeFiles)
    await resolveC611ArtifactFile(repository, file.relativePath);
  const freeze = await verifyC611MachineFreeze(machine, repository);
  const baseline = await json(
    machine,
    "c6-1-1-baseline.json",
    c611BaselineSchema,
  );
  const policy = await json(
    machine,
    "c6-1-1-policy-freeze.json",
    c611PolicyFreezeSchema,
  );
  const calibrationPolicy = await json(
    machine,
    "c6-1-1-calibration-policy.json",
    c611CalibrationPolicySchema,
  );
  const folds = await json(
    machine,
    "c6-1-1-calibration-folds.json",
    c611CalibrationFoldsSchema,
  );
  const legacy = await json(
    machine,
    "c6-1-1-legacy-p6-control.json",
    c611LegacyControlSchema,
  );
  const proposals = await json(
    machine,
    "machine-selective-existing-candidate-proposals.json",
    machineSelectiveExistingCandidateProposalsSchema,
  );
  const features = await json(
    machine,
    "machine-selective-mbr-features.json",
    machineSelectiveMbrFeaturesSchema,
  );
  const production = await json(
    machine,
    "subtitle-package.production.json",
    subtitlePackageSchema,
  );
  const map = await json(
    evaluation,
    "c6-1-1-fixed-baseline-alignment-map.json",
    c611FixedBaselineAlignmentMapSchema,
  );
  const labels = await json(
    evaluation,
    "gold-selective-existing-candidate-labels.json",
    c611ProposalLabelsSchema,
  );
  const legacyLabels = await json(
    evaluation,
    "gold-legacy-p6-labels.json",
    c611ProposalLabelsSchema,
  );
  const oof = await json(
    evaluation,
    "c6-1-1-out-of-fold-selective-decisions.json",
    c611OofDecisionsSchema,
  );
  const profiles = await json(
    evaluation,
    "c6-1-1-selective-profile-results.json",
    c611SelectiveProfileResultsSchema,
  );
  const proof = await json(
    evaluation,
    "c6-1-1-read-only-proof.json",
    c611ReadOnlyProofSchema,
  );
  const manifest = await json(
    shadow,
    "c6-1-1-shadow-manifest.json",
    c611ShadowManifestSchema,
  );
  const route = await json(
    evaluation,
    "c6-1-1-route-decision.json",
    c611RouteDecisionSchema,
  );
  const future = await json(
    evaluation,
    "c6-1-1-selective-mbr-freeze.json",
    c611SelectiveMbrFreezeSchema,
  );
  return {
    machine,
    evaluation,
    shadow,
    freeze,
    baseline,
    policy,
    calibrationPolicy,
    folds,
    legacy,
    proposals,
    features,
    production,
    map,
    labels,
    legacyLabels,
    oof,
    profiles,
    proof,
    manifest,
    route,
    future,
    samples: prepareC611CalibrationSamples(proposals.records, features.rows),
  };
}
type Side = Awaited<ReturnType<typeof loadSide>>;
function validateBindings(s: Side): void {
  equal(
    s.freeze.proposalHash,
    s.proposals.semanticHash,
    "C611_PROPOSAL_FREEZE_MISMATCH",
  );
  equal(
    s.freeze.featureTableHash,
    s.features.semanticHash,
    "C611_FEATURE_FREEZE_MISMATCH",
  );
  equal(
    s.freeze.featureSchemaHash,
    s.features.featureSchemaHash,
    "C611_FEATURE_SCHEMA_FREEZE_MISMATCH",
  );
  equal(
    s.features.proposalHash,
    s.proposals.semanticHash,
    "C611_FEATURE_PROPOSALS_MISMATCH",
  );
  equal(s.freeze.foldHash, s.folds.semanticHash, "C611_FOLD_FREEZE_MISMATCH");
  equal(
    s.freeze.policyHash,
    s.policy.semanticHash,
    "C611_POLICY_FREEZE_MISMATCH",
  );
  equal(
    s.freeze.baselineHash,
    s.baseline.semanticHash,
    "C611_BASELINE_FREEZE_MISMATCH",
  );
  equal(
    s.freeze.candidateUniverseHash,
    s.baseline.candidateUniverseHash,
    "C611_UNIVERSE_FREEZE_MISMATCH",
  );
  for (const [name, expected] of [
    ["fixedAlignment", s.policy.fixedAlignmentPolicyHash],
    ["machine", s.policy.machinePolicyHash],
    ["calibration", s.policy.calibrationPolicyHash],
    ["oracle", s.policy.oraclePolicyHash],
  ]) {
    const definition = s.policy.policyDefinitions[name ?? ""];
    requireCondition(definition, "C611_FROZEN_POLICY_DEFINITION_MISSING");
    equal(
      hash(JSON.parse(definition)),
      expected,
      "C611_FROZEN_POLICY_DEFINITION_MISMATCH",
    );
  }
  equal(
    hash(s.calibrationPolicy),
    s.policy.calibrationPolicyHash,
    "C611_CALIBRATION_POLICY_MISMATCH",
  );
  verifyC611Folds(s.folds, s.calibrationPolicy);
  const units = s.proposals.records.map((p) => ({
    eventId: p.eventId,
    proposalId: p.proposalId,
    sourceAudioIdentity: p.sourceAudioIdentity,
    sourceInterval: p.sourceInterval,
    acousticIntervals: p.acousticIntervals,
    cueIntervals: s.production.cues
      .filter((c) => p.finalCueIds.includes(c.id))
      .map((c) => ({ start: c.start, end: c.end })),
    finalCueIds: p.finalCueIds,
    sharedSpanKeys: p.spanApplication
      ? [
          `${p.spanApplication.finalCueId}:${p.spanApplication.spanStart}:${p.spanApplication.spanEnd}`,
        ]
      : [],
  }));
  equal(
    buildC611Folds(units, s.calibrationPolicy),
    s.folds,
    "C611_FOLD_UNITS_OMIT_MACHINE_AUDIO_OR_CUE_SPAN",
  );
  equal(
    s.map.mappingSemanticHash,
    hash(c611MappingContent(s.map)),
    "C611_FIXED_MAPPING_HASH_MISMATCH",
  );
  equal(
    s.map.mappingPolicyHash,
    hash(s.map.mappingPolicy),
    "C611_FIXED_MAPPING_POLICY_HASH_MISMATCH",
  );
  equal(
    s.map.mappingPolicyHash,
    s.policy.fixedAlignmentPolicyHash,
    "C611_FIXED_MAPPING_UNFROZEN_POLICY",
  );
  equal(
    s.map.baselineCueHash,
    hash(c611CueViews(s.production.cues)),
    "C611_FIXED_MAP_BASELINE_MISMATCH",
  );
  equal(
    s.map.machineFreezeHash,
    s.freeze.semanticHash,
    "C611_FIXED_MAP_FREEZE_MISMATCH",
  );
  equal(
    s.map.machineFrozenAt,
    s.freeze.frozenAt,
    "C611_FIXED_MAP_FREEZE_TIME_MISMATCH",
  );
  equal(
    s.profiles.machineFreezeHash,
    s.freeze.semanticHash,
    "C611_PROFILES_FREEZE_MISMATCH",
  );
  equal(
    s.profiles.fixedMapHash,
    s.map.semanticHash,
    "C611_PROFILES_MAP_MISMATCH",
  );
  equal(s.profiles.oofHash, s.oof.semanticHash, "C611_PROFILES_OOF_MISMATCH");
  equal(
    s.labels.proposalSetHash,
    s.proposals.semanticHash,
    "C611_LABEL_PROPOSAL_MISMATCH",
  );
  equal(
    s.legacyLabels.proposalSetHash,
    s.legacy.semanticHash,
    "C611_LEGACY_LABEL_PROPOSAL_MISMATCH",
  );
  for (const labelSet of [s.labels, s.legacyLabels]) {
    equal(
      labelSet.fixedMapHash,
      s.map.semanticHash,
      "C611_LABEL_FIXED_MAP_MISMATCH",
    );
    for (const label of labelSet.labels) verifyC611SelfHash(label);
  }
  // needs-review/none are required literals in the baseline/route schemas.
  equal(
    c601CanonicalTextHash(s.production.cues),
    s.baseline.canonicalTextHash,
    "C611_PRODUCTION_TEXT_MUTATION",
  );
  equal(
    c601CanonicalTimingHash(s.production.cues),
    s.baseline.canonicalTimingHash,
    "C611_PRODUCTION_TIMING_MUTATION",
  );
  requireCondition(
    s.baseline.baselineReplayPassed && s.baseline.checks.every((c) => c.passed),
    "C611_BASELINE_REPLAY_FAILED",
  );
}
function validateReadOnly(s: Side): void {
  const p = s.proof;
  equal(
    p.machineFreezeHash,
    s.freeze.semanticHash,
    "C611_READONLY_FREEZE_MISMATCH",
  );
  equal(p.frozenAt, s.freeze.frozenAt, "C611_READONLY_FREEZE_TIME_MISMATCH");
  equal(
    p.goldFirstReadAt,
    s.map.goldFirstReadAt,
    "C611_READONLY_GOLD_TIME_MISMATCH",
  );
  requireCondition(
    Date.parse(p.goldFirstReadAt) >= Date.parse(p.frozenAt),
    "C611_GOLD_READ_BEFORE_FREEZE",
  );
  equal(p.sourceBefore, p.sourceAfter, "C611_SOURCE_FINGERPRINT_CHANGED");
  equal(
    p.sourceBefore,
    s.baseline.sourceBefore,
    "C611_SOURCE_BASELINE_MISMATCH",
  );
  equal(p.goldBefore, p.goldAfter, "C611_GOLD_FINGERPRINT_CHANGED");
  equal(
    p.productionFiles,
    s.baseline.productionFiles,
    "C611_PRODUCTION_PROOF_FILE_MISMATCH",
  );
  requireCondition(
    p.sourceUnchanged &&
      p.goldUnchanged &&
      p.productionUnchanged &&
      p.runtimeCodeUnchanged,
    "C611_READONLY_PROOF_FAILED",
  );
}
function rerunOof(s: Side): void {
  const expected = runC611Oof({
    samples: s.samples,
    labels: c611CalibrationLabels(s.labels.labels),
    folds: s.folds,
    policy: s.calibrationPolicy,
    legacy: {
      samples: s.legacy.samples,
      labels: c611CalibrationLabels(s.legacyLabels.labels),
      selectedProposalIds: s.legacy.selectedProposalIds,
    },
  });
  equal(expected, s.oof, "C611_OOF_RECOMPUTATION_MISMATCH");
  validateC611OofIsolation(s.oof, s.folds);
}
function allPairs(cues: { start: number; end: number }[]): number {
  return cues.reduce(
    (n, left, i) =>
      n +
      cues
        .slice(i + 1)
        .filter(
          (right) =>
            Math.max(left.start, right.start) < Math.min(left.end, right.end),
        ).length,
    0,
  );
}
async function validateShadows(s: Side): Promise<string> {
  let foldGainRecomputed = 0,
    coupledFoldGainArtifactOnly = 0;
  equal(
    s.manifest.profiles.map((p) => p.profileId).sort(),
    s.calibrationPolicy.profiles.map((p) => p.profileId).sort(),
    "C611_SHADOW_PROFILE_COVERAGE_MISMATCH",
  );
  const identities = s.production.cues.map(({ id, start, end }) => ({
    id,
    start,
    end,
  }));
  const allManifestFiles: string[] = [];
  for (const result of s.profiles.profiles) {
    const manifest = s.manifest.profiles.find(
      (p) => p.profileId === result.profileId,
    );
    requireCondition(manifest, "C611_PROFILE_MANIFEST_MISSING");
    for (const file of manifest.files) {
      requireCondition(
        file.relativePath.startsWith(`${result.profileId.toLowerCase()}/`),
        "C611_CROSS_PROFILE_FILE_REFERENCE",
      );
      const name = await resolveC611ArtifactFile(s.shadow, file.relativePath);
      requireCondition(
        (await stat(name)).size === file.size &&
          (await c61FileHash(name)) === file.sha256,
        "C611_SHADOW_BYTE_HASH_MISMATCH",
      );
      allManifestFiles.push(file.relativePath);
    }
    const pkg = await json(
      s.shadow,
      `${result.profileId.toLowerCase()}/subtitle-package.research-shadow.json`,
      subtitlePackageSchema,
    );
    for (const ext of ["ass", "srt", "vtt"] as const)
      requireCondition(
        manifest.files.some(
          (f) =>
            f.relativePath ===
            `${result.profileId.toLowerCase()}/${pkg.subtitleFiles[ext]}`,
        ),
        "C611_SUBTITLE_DELIVERY_FILE_MISSING",
      );
    equal(
      pkg.cues.map(({ id, start, end }) => ({ id, start, end })),
      identities,
      "C611_SHADOW_ID_ORDER_TIMING_MUTATION",
    );
    // The older subtitle-package status describes extraction readiness, not
    // finalization. Preserve it; final needs-review/none lives in route/baseline.
    const {
      cues: shadowCues,
      subtitleFiles: shadowFiles,
      ...shadowMetadata
    } = pkg;
    const {
      cues: productionCues,
      subtitleFiles: productionFiles,
      ...productionMetadata
    } = s.production;
    void shadowCues;
    void shadowFiles;
    void productionCues;
    void productionFiles;
    equal(
      shadowMetadata,
      productionMetadata,
      "C611_SHADOW_PACKAGE_METADATA_MUTATION",
    );
    equal(
      manifest.cueCount,
      s.production.cues.length,
      "C611_SHADOW_CUE_COUNT_CHANGED",
    );
    equal(
      manifest.canonicalTextHash,
      c601CanonicalTextHash(pkg.cues),
      "C611_SHADOW_CANONICAL_TEXT_HASH_MISMATCH",
    );
    equal(
      manifest.canonicalTimingHash,
      s.baseline.canonicalTimingHash,
      "C611_SHADOW_TIMING_HASH_MISMATCH",
    );
    equal(
      result.canonicalTextHash,
      manifest.canonicalTextHash,
      "C611_PROFILE_TEXT_HASH_MISMATCH",
    );
    equal(
      result.canonicalTimingHash,
      manifest.canonicalTimingHash,
      "C611_PROFILE_TIMING_HASH_MISMATCH",
    );
    equal(
      manifest.changedCueIds,
      pkg.cues
        .filter((c, i) => c.text !== s.production.cues[i]?.text)
        .map((c) => c.id),
      "C611_CHANGED_CUE_IDS_MISMATCH",
    );
    if (result.profileId === "S0")
      equal(
        manifest.canonicalTextHash,
        s.baseline.canonicalTextHash,
        "C611_S0_NOT_PRODUCTION_BASELINE",
      );
    if (result.profileId === "S1")
      equal(
        manifest.canonicalTextHash,
        s.legacy.originalCanonicalTextHash,
        "C611_S1_NOT_LEGACY_P6",
      );
    const decisions = s.oof.decisions.filter(
      (d) => d.profileId === result.profileId,
    );
    const requested = decisions.filter(
      (d) => d.decision === "SELECT_EXISTING_CANDIDATE",
    );
    const applied = new Set(
      manifest.assemblyDecisions
        .filter((d) => d.status === "APPLIED_SHADOW_ONLY")
        .map((d) => d.eventId),
    );
    requireCondition(
      [...applied].every((id) => requested.some((d) => d.eventId === id)),
      "C611_UNREQUESTED_SHADOW_APPLICATION",
    );
    equal(
      result.requestedSelectionCount,
      requested.length,
      "C611_REQUESTED_COUNT_MISMATCH",
    );
    equal(
      result.appliedSelectionCount,
      applied.size,
      "C611_APPLIED_COUNT_MISMATCH",
    );
    equal(
      [...result.blockedRequestedEventIds].sort(),
      requested
        .filter((d) => !applied.has(d.eventId))
        .map((d) => d.eventId)
        .sort(),
      "C611_BLOCKED_REQUESTED_EVENTS_MISMATCH",
    );
    equal(
      result.requestedMetrics,
      s.oof.profileMetrics.find((m) => m.profileId === result.profileId),
      "C611_REQUESTED_METRICS_MISMATCH",
    );
    const actual: C611Decision[] = decisions.map((d) => {
      if (d.decision !== "SELECT_EXISTING_CANDIDATE" || applied.has(d.eventId))
        return d;
      const { semanticHash: ignored, ...body } = d;
      void ignored;
      const changed = {
        ...body,
        decision: "ABSTAIN_REVIEW" as const,
        machineReasons: [
          ...body.machineReasons,
          "JOINT_SHADOW_RENDERER_BLOCKED",
        ],
      };
      return { ...changed, semanticHash: hash(changed) };
    });
    const samples = result.profileId === "S1" ? s.legacy.samples : s.samples;
    const labels = c611CalibrationLabels(
      result.profileId === "S1" ? s.legacyLabels.labels : s.labels.labels,
    );
    equal(
      result.appliedMetrics,
      calculateC611SelectiveMetrics({
        profileId: result.profileId,
        samples,
        labels,
        decisions: actual,
        policy: s.calibrationPolicy,
      }),
      "C611_APPLIED_METRICS_RECOMPUTATION_MISMATCH",
    );
    equal(
      result.fixed.fixedMapHash,
      s.map.semanticHash,
      "C611_PROFILE_FIXED_MAP_CHANGED",
    );
    equal(
      result.fixed.mappingSemanticHash,
      s.map.mappingSemanticHash,
      "C611_PROFILE_MAPPING_CHANGED",
    );
    equal(
      result.fixed.shadowCueHash,
      hash(c611CueViews(pkg.cues)),
      "C611_FIXED_EVALUATION_SHADOW_MISMATCH",
    );
    validateC611FixedArithmetic(result.fixed);
    requireCondition(
      result.fixed.invariance.eligible,
      "C611_FIXED_INVARIANCE_FAILED",
    );
    equal(
      result.fixed.groups.map((g) => g.groupId),
      s.map.groups.map((g) => g.groupId),
      "C611_FIXED_GROUPS_INCOMPLETE",
    );
    for (const group of result.fixed.groups) {
      const mapped = s.map.groups.find((g) => g.groupId === group.groupId);
      requireCondition(mapped, "C611_FIXED_GROUP_NOT_IN_FROZEN_MAP");
      equal(
        group.cueIds,
        mapped.machineCueIds,
        "C611_FIXED_GROUP_CUE_MEMBERSHIP_CHANGED",
      );
      equal(
        group.goldCueIds,
        mapped.goldCueIds,
        "C611_FIXED_GROUP_GOLD_MEMBERSHIP_CHANGED",
      );
      equal(
        group.baselineTextHash,
        c611TextHash(
          s.production.cues.filter((c) => group.cueIds.includes(c.id)),
        ),
        "C611_FIXED_GROUP_BASELINE_TEXT_MISMATCH",
      );
      equal(
        group.shadowTextHash,
        c611TextHash(pkg.cues.filter((c) => group.cueIds.includes(c.id))),
        "C611_FIXED_GROUP_SHADOW_TEXT_MISMATCH",
      );
      equal(
        group.changed,
        group.baselineTextHash !== group.shadowTextHash,
        "C611_FIXED_GROUP_CHANGED_FLAG_MISMATCH",
      );
    }
    equal(
      result.quality.fixedEvaluationHash,
      result.fixed.semanticHash,
      "C611_QUALITY_FIXED_EVALUATION_MISMATCH",
    );
    const legacyEvaluation = await json(
      s.evaluation,
      `evaluation-${result.profileId}.local-only.json`,
      machineVsGoldEvaluationSchema,
    );
    equal(
      result.quality.legacyEvaluationHash,
      legacyEvaluation.semanticHash,
      "C611_QUALITY_LEGACY_EVALUATION_MISMATCH",
    );
    equal(
      result.quality.shadowMetrics,
      c61MetricsFromEvaluation(legacyEvaluation),
      "C611_QUALITY_METRICS_MISMATCH",
    );
    const timing = compareC61Timing({
      cues: pkg.cues,
      baselineCues: s.production.cues,
      metrics: result.quality.shadowMetrics,
      baseline: result.quality.baselineMetrics,
    });
    equal(
      timing.timingHashUnchanged,
      result.quality.timingHashUnchanged,
      "C611_QUALITY_TIMING_IDENTITY_MISMATCH",
    );
    equal(
      timing.matchingInducedTimingDelta,
      result.quality.matchingInducedTimingDelta,
      "C611_QUALITY_MATCHING_DELTA_MISMATCH",
    );
    equal(
      result.quality.shadowAllPairOverlapCount,
      allPairs(pkg.cues),
      "C611_OVERLAP_PAIR_COUNT_MISMATCH",
    );
    equal(
      result.quality.baselineAllPairOverlapCount,
      allPairs(s.production.cues),
      "C611_BASELINE_OVERLAP_PAIR_COUNT_MISMATCH",
    );
    for (const fold of result.foldJointGains) {
      const selected = actual.filter(
        (d) =>
          d.foldId === fold.foldId &&
          d.decision === "SELECT_EXISTING_CANDIDATE",
      );
      equal(
        fold.selectedCount,
        selected.length,
        "C611_FOLD_APPLIED_SELECTION_COUNT_MISMATCH",
      );
      equal(
        fold.evaluableSelectedCount,
        selected.filter((d) =>
          labels.some(
            (l) =>
              l.proposalId === d.proposalId &&
              l.outcome !== "SWITCH_UNEVALUABLE",
          ),
        ).length,
        "C611_FOLD_EVALUABLE_COUNT_MISMATCH",
      );
      const selectedEvents = new Set(selected.map((d) => d.eventId));
      const groups = result.fixed.groups.filter((g) =>
        g.eventIds.some((id) => selectedEvents.has(id)),
      );
      // Gold may join originally independent machine folds. A combined group
      // error is not the error of one fold's counterfactual shadow. Without
      // reopening Gold, retain that field as evaluator-provided evidence.
      const outsideFoldSelected = new Set(
        actual
          .filter(
            (d) =>
              d.foldId !== fold.foldId &&
              d.decision === "SELECT_EXISTING_CANDIDATE",
          )
          .map((d) => d.eventId),
      );
      if (
        groups.some((g) => g.eventIds.some((id) => outsideFoldSelected.has(id)))
      ) {
        coupledFoldGainArtifactOnly++;
        continue;
      }
      const gain = groups.some((g) => g.changed && g.outcome === "UNEVALUABLE")
        ? null
        : groups.reduce((n, g) => n + (g.normalizedGain ?? 0), 0);
      equal(fold.normalizedGain, gain, "C611_FOLD_JOINT_GAIN_MISMATCH");
      foldGainRecomputed++;
    }
  }
  equal(
    allManifestFiles.sort(),
    (await c61TreeFiles(s.shadow))
      .filter((f) => f.relativePath !== "c6-1-1-shadow-manifest.json")
      .map((f) => f.relativePath)
      .sort(),
    "C611_SHADOW_MANIFEST_FILE_COVERAGE_MISMATCH",
  );
  return `shadow hashes/structure, OOF-applied metrics and unique-group arithmetic verified; fold joint gains independently recomputed=${foldGainRecomputed}; Gold-coupled fold gains artifact-only=${coupledFoldGainArtifactOnly} (no raw Gold reopened)`;
}
function rerunRoute(s: Side, parity: boolean): void {
  const route = decideC611SelectiveRoute({
    policy: s.policy,
    baselineMetrics: s.baseline.baselineMetrics,
    baselineHash: s.baseline.semanticHash,
    expectedFoldIds: s.folds.folds.map((f) => f.foldId),
    profiles: s.profiles.profiles.map((p) => ({
      profileId: p.profileId,
      oof: p.appliedMetrics,
      changedGroupCount: p.fixed.summary.changedCueGroups,
      mappedChangedGroupCount: p.fixed.summary.fixedMappedChangedGroupCount,
      jointNormalizedGain: p.fixed.summary.normalizedGain,
      jointExactGain: p.fixed.summary.exactGain,
      quality: p.quality.shadowMetrics,
      foldJointGains: p.foldJointGains,
    })),
    engineering: {
      baselineReplayPassed: s.baseline.baselineReplayPassed,
      fixedMappingValid: s.profiles.profiles.every(
        (p) => p.fixed.invariance.eligible,
      ),
      featureFreezeValid: true,
      foldFreezeValid: s.folds.status === "READY",
      goldBarrierValid:
        Date.parse(s.map.goldFirstReadAt) >= Date.parse(s.freeze.frozenAt),
      oofIsolationValid: true,
      candidateProvenanceValid: true,
      aBDeterministic: parity,
      productionFilesUnchanged: s.proof.productionUnchanged,
      productionTextMutation: 0,
      productionTimingMutation: 0,
      unsupportedTokenCount: 0,
      unsupportedAdjacencyCount: 0,
      missingProvenanceCount: 0,
      novelApplicationCount: 0,
      sourceReadOnly: s.proof.sourceUnchanged,
      goldReadOnly: s.proof.goldUnchanged,
    },
  });
  equal(route, s.route, "C611_ROUTE_RECOMPUTATION_MISMATCH");
  requireCondition(
    route.engineeringPassed,
    "C611_ROUTE_ENGINEERING_GUARDS_FAILED",
  );
  const future = createC611FutureModelFreeze({
    route,
    policy: s.policy,
    calibrationPolicy: s.calibrationPolicy,
    samples: s.samples,
    labels: c611CalibrationLabels(s.labels.labels),
    folds: s.folds,
    machineFeatureFreezeHash: s.freeze.semanticHash,
    featureTableHash: s.features.semanticHash,
    proposalHash: s.proposals.semanticHash,
    sourceOofHash: s.oof.semanticHash,
  });
  equal(future, s.future, "C611_FUTURE_MODEL_FREEZE_RECOMPUTATION_MISMATCH");
}

export function validateC611ShareablePrivacy(value: unknown): void {
  c611ShareableSummarySchema.parse(value);
  const serialized = JSON.stringify(value);
  requireCondition(
    !/(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|[A-Z]:\\\\|Bearer\s+|sk-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,})/u.test(
      serialized,
    ),
    "C611_SHAREABLE_PATH_OR_SECRET_LEAK",
  );
}
async function validateShareable(s: Side, root: string): Promise<void> {
  const shareableRoot = path.join(root, "shareable");
  equal(
    (await c61TreeFiles(shareableRoot)).map((f) => f.relativePath),
    ["c6-1-1-shareable-summary.json"],
    "C611_SHAREABLE_UNEXPECTED_RAW_TEXT_OR_AUDIO_FILE",
  );
  const summary = await json(
    shareableRoot,
    "c6-1-1-shareable-summary.json",
    c611ShareableSummarySchema,
  );
  validateC611ShareablePrivacy(summary);
  equal(
    summary.machineFreezeHash,
    s.freeze.semanticHash,
    "C611_SHAREABLE_FREEZE_MISMATCH",
  );
  equal(
    summary.profileResultsHash,
    s.profiles.semanticHash,
    "C611_SHAREABLE_PROFILE_RESULTS_MISMATCH",
  );
  equal(
    summary.routeHash,
    s.route.semanticHash,
    "C611_SHAREABLE_ROUTE_MISMATCH",
  );
  equal(
    summary.readOnlyProofHash,
    s.proof.semanticHash,
    "C611_SHAREABLE_PROOF_MISMATCH",
  );
  equal(
    summary.baseline,
    s.baseline.baselineMetrics,
    "C611_SHAREABLE_BASELINE_MISMATCH",
  );
  equal(
    summary.profiles,
    s.profiles.profiles.map((p) => ({
      profileId: p.profileId,
      selected: p.appliedMetrics.selectedCount,
      evaluableSelected: p.appliedMetrics.evaluableSelectedCount,
      correct: p.appliedMetrics.correctSwitchCount,
      wrong: p.appliedMetrics.wrongSwitchCount,
      neutral: p.appliedMetrics.neutralSwitchCount,
      unknown: p.appliedMetrics.selectedUnevaluableCount,
      precision: p.appliedMetrics.precision,
      harm: p.appliedMetrics.harmRate,
      fixedCoverage: p.fixed.summary.changedGroupCoverage,
      jointNormalizedGain: p.fixed.summary.normalizedGain,
      metrics: p.quality.shadowMetrics,
      canonicalTextHash: p.canonicalTextHash,
      canonicalTimingHash: p.canonicalTimingHash,
    })),
    "C611_SHAREABLE_APPLIED_METRICS_MISMATCH",
  );
  equal(summary.route, s.route.outcome, "C611_SHAREABLE_QUALITY_GATE_MISMATCH");
  equal(
    summary.frozenModelCreated,
    s.future.frozenModelCreated,
    "C611_SHAREABLE_FUTURE_MODEL_MISMATCH",
  );
  requireCondition(
    summary.sourceReadOnly &&
      summary.goldReadOnly &&
      summary.productionUnchanged,
    "C611_SHAREABLE_READONLY_PROOF_FAILED",
  );
}

/** Independent artifact acceptance; no raw source/Gold file option exists. */
export async function validateC611Artifacts(input: {
  a: string;
  b: string;
  repository: string;
  regressionEvidence?: string;
  progress?: (check: C611Validation["checks"][number]) => void;
}): Promise<C611Validation> {
  const checks: C611Validation["checks"] = [];
  async function check(
    name: string,
    action: () => unknown,
    expected = "passed",
  ) {
    try {
      const result = await action();
      const row = {
        name,
        passed: true,
        observed: typeof result === "string" ? result : "passed",
        expected,
      };
      checks.push(row);
      input.progress?.(row);
      return true;
    } catch (error) {
      const row = {
        name,
        passed: false,
        observed: error instanceof Error ? error.message : String(error),
        expected,
      };
      checks.push(row);
      input.progress?.(row);
      return false;
    }
  }
  let schemaInstanceCount = 0,
    generatedSchemaCount = 0;
  const parity = {
    machine: false,
    evaluation: false,
    shadow: false,
    shareable: false,
  };
  for (const part of [
    "machine",
    "evaluation",
    "shadow",
    "shareable",
  ] as const) {
    parity[part] = await check(
      `AB_${part.toUpperCase()}_BYTE_PARITY`,
      async () =>
        equal(
          await c61TreeFiles(path.join(input.a, part)),
          await c61TreeFiles(path.join(input.b, part)),
          "C611_AB_FILE_HASH_MISMATCH",
        ),
    );
    for (const [name, root] of [
      ["A", input.a],
      ["B", input.b],
    ])
      await check(`${name}_${part.toUpperCase()}_STRICT_SCHEMAS`, async () => {
        schemaInstanceCount += await validateC611StrictTree(
          path.join(root ?? "", part),
        );
      });
  }
  await check("GENERATED_SCHEMA_CONTRACTS_CURRENT", async () => {
    const root = path.join(input.repository, "schemas");
    generatedSchemaCount = (await readdir(root)).filter((f) =>
      f.endsWith(".schema.json"),
    ).length;
    for (const [name, schema] of c611GeneratedSchemas) {
      const actual = await c61Json(
        await resolveC611ArtifactFile(root, `${name}.schema.json`),
      );
      const generated = z.toJSONSchema(schema, {
        target: "draft-2020-12",
        unrepresentable: "any",
      });
      equal(
        actual,
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: `https://schemas.local/multilingual-video-learning/${name}.schema.json`,
          title: name,
          ...generated,
        },
        "C611_GENERATED_SCHEMA_STALE",
      );
    }
  });
  const sides: Side[] = [];
  for (const [name, root] of [
    ["A", input.a],
    ["B", input.b],
  ]) {
    let side: Side | undefined;
    await check(`${name}_FREEZE_VERIFIED`, async () => {
      side = await loadSide(root ?? "", input.repository);
      sides.push(side);
    });
    if (!side) continue;
    const s = side;
    await check(`${name}_ARTIFACT_BINDINGS_AND_PRODUCTION`, () =>
      validateBindings(s),
    );
    await check(
      `${name}_READ_ONLY_FINGERPRINT_PROOF`,
      () => validateReadOnly(s),
      "runner fingerprints identical; validator does not reopen raw files",
    );
    await check(`${name}_NESTED_OOF_RECOMPUTATION`, () => rerunOof(s));
    await check(`${name}_SHADOW_AND_UNIQUE_GROUP_ARITHMETIC`, () =>
      validateShadows(s),
    );
    await check(`${name}_ROUTE_AND_FUTURE_FREEZE_RECOMPUTATION`, () =>
      rerunRoute(s, Object.values(parity).every(Boolean)),
    );
    await check(`${name}_SHAREABLE_AGGREGATES_AND_PRIVACY`, () =>
      validateShareable(s, root ?? ""),
    );
    await check(`${name}_FREEZE_UNCHANGED_AFTER_VALIDATION`, async () =>
      equal(
        await verifyC611MachineFreeze(s.machine, input.repository),
        s.freeze,
        "C611_FREEZE_CHANGED_DURING_VALIDATION",
      ),
    );
  }
  let regressionEvidenceHash: string | null = null;
  await check("REGRESSION_EVIDENCE_COMPLETE", async () => {
    requireCondition(
      input.regressionEvidence,
      "C611_REGRESSION_EVIDENCE_MISSING",
    );
    const first = sides[0];
    requireCondition(first, "C611_NO_VALID_MACHINE_FREEZE_FOR_QA");
    const evidence = await validateC611RegressionEvidence(
      input.regressionEvidence,
      first.freeze.sourceCodeAggregateHash,
    );
    regressionEvidenceHash = evidence.semanticHash;
    for (const stage of evidence.checks) {
      const row = {
        name: `REGRESSION_${stage.stage}`,
        passed: true,
        observed: `${stage.tests ? `${stage.tests.passed} passed/${stage.tests.skipped} skipped/${stage.tests.failed} failed; ` : ""}${stage.durationMs}ms; logSHA256=${stage.logSha256}`,
        expected: "exit 0; exact raw log counts; declared skips",
      };
      checks.push(row);
      input.progress?.(row);
    }
  });
  const passed = (suffix: string) =>
    ["A", "B"].every((name) =>
      checks.some((c) => c.name === `${name}_${suffix}` && c.passed),
    );
  const body: Omit<C611Validation, "semanticHash"> = {
    schemaVersion: "1.0.0",
    policyVersion: C611_POLICY_VERSION,
    artifactType: "c6-1-1-validation",
    checks,
    engineeringPassed: checks.every((c) => c.passed),
    schemaInstanceCount,
    generatedSchemaCount,
    aBMachineParity: parity.machine,
    aBEvaluationParity: parity.evaluation,
    aBOutputParity: parity.shadow,
    productionTextMutation: sides.filter(
      (s) =>
        c601CanonicalTextHash(s.production.cues) !==
        s.baseline.canonicalTextHash,
    ).length,
    productionTimingMutation: sides.filter(
      (s) =>
        c601CanonicalTimingHash(s.production.cues) !==
        s.baseline.canonicalTimingHash,
    ).length,
    regressionEvidenceHash,
    sourceReadOnly: passed("READ_ONLY_FINGERPRINT_PROOF"),
    goldReadOnly: passed("READ_ONLY_FINGERPRINT_PROOF"),
    validatorRawSourceRechecked: false,
    validatorRawGoldRechecked: false,
    qualityGateStatus:
      sides[0]?.route.outcome ?? "UNAVAILABLE_INVALID_OR_MISSING_ARTIFACTS",
    machineOnlyReleaseAuthorized: false,
    c602Status: "HOLD",
  };
  return c611ValidationSchema.parse({ ...body, semanticHash: hash(body) });
}
