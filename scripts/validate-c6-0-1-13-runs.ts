import { access, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

import {
  atomicWriteJson,
  c60112ReviewPackageFreezeSchema,
  c60113AblationEvaluationSchema,
  c60113AblationFreezeSchema,
  c60113BaselineReplaySchema,
  c60113DataQualityAuditSchema,
  c60113EvidenceFamilyGraphSchema,
  c60113MissingEvidenceEvaluationSchema,
  c60113MissingSpeechEvidenceSchema,
  c60113PostFreezeEvaluationAuditSchema,
  c60113ProspectiveTrialReadinessSchema,
  c60113RankerFoldsSchema,
  c60113RankerMachineFreezeSchema,
  c60113RankerOofSchema,
  c60113RegionFeaturesSchema,
  c60113RegionLabelsSchema,
  c60113RegionRankerFreezeSchema,
  c60113RegionRankingEvaluationSchema,
  c60113RegionReviewPrioritySchema,
  c60113ReviewBurdenPlansSchema,
  c60113ReviewBurdenValidationSchema,
  c60113ReviewItemsV3Schema,
  c60113ReviewPlaybackTimelineSchema,
  c60113ReviewPolicySchema,
  c60113ReviewRegionsV2Schema,
  c60113ShareableAuditSchema,
  c60113ShareableSummarySchema,
  c60113TrialEventTypeSchema,
  c60113UiAcceptanceResultsSchema,
  c60113ValidationSchema,
  machineReviewAudioManifestSchema,
  machineReviewCandidateBundlesSchema,
  machineReviewItemsSchema,
  machineReviewPrioritySchema,
  machineReviewRegionsSchema,
  subtitlePackageSchema,
  type C60113MissingSpeechEvidence,
  type C60113RegionRankingEvaluation,
} from "@mvl/shared";
import {
  assertC60112MachineOnlyInput,
  assertC60112ReviewWorkspaceData,
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
  inspectReviewWav,
  machineQualitySemanticHash,
  verifyC60112ReviewPackageFreeze,
  type C60112ReviewPolicy,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";
import { assertC60113MachineFreeze } from "../packages/video-subtitler/src/review/c60113-region-ranker-folds.js";
import { buildC60113MissingSpeechEvidence } from "../packages/video-subtitler/src/review/missing-speech-evidence-v2.js";
import {
  assertC60113Policy,
  withC60113SemanticHash,
} from "../packages/video-subtitler/src/review/c60113-policy.js";
import {
  buildC60113EvidenceFamilyGraph,
  c60113IndependentEvidenceGroups,
} from "../packages/video-subtitler/src/review/review-evidence-family-graph.js";
import { selectC60113Regions } from "../packages/video-subtitler/src/review/review-burden-planner.js";
import {
  c60113IncrementalAudioSeconds,
  c60113UniqueAudioSeconds,
} from "../packages/video-subtitler/src/review/review-playback-timeline.js";
import {
  c60113ContainedFile,
  c60113FileHash,
  c60113FileIdentity,
  c60113OnlySubtitleDirectory,
  c60113ScoreDiagnostics,
  createC60113OutputDirectory,
  readC60113Json,
} from "./lib/c60113-acceptance-io.js";

type Check = z.infer<typeof c60113ValidationSchema>["checks"][number];
type CheckStatus = Check["status"];
type UiResults = z.infer<typeof c60113UiAcceptanceResultsSchema>;
type Route = z.infer<typeof c60113ProspectiveTrialReadinessSchema>["route"];
type Readiness = z.infer<
  typeof c60113ProspectiveTrialReadinessSchema
>["readiness"];

export interface C60113ValidationOptions {
  outputRoot: string;
  outputPrefix: string;
  outputDate: string;
  upstreamPrefix: string;
  upstreamDate: string;
  source: string;
  gold: string;
  generatedAt: string;
  regressionResults?: string;
  uiResults?: string;
}

function semanticHashValid(value: unknown, omitGeneratedAt = false): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  const core = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) =>
        key !== "semanticHash" && (!omitGeneratedAt || key !== "generatedAt"),
    ),
  );
  return machineQualitySemanticHash(core) === record.semanticHash;
}
function equals(left: unknown, right: unknown): boolean {
  return machineQualitySemanticHash(left) === machineQualitySemanticHash(right);
}
function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-7;
}
async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function c60113AcceptanceRoute(input: {
  evaluation: Pick<
    C60113RegionRankingEvaluation,
    | "rankingResult"
    | "burdenResult"
    | "requiredSafetyRecall"
    | "requiredUniqueAudioRatio"
  >;
  workflowPassed: boolean;
  instrumentationStatus: CheckStatus;
}): { route: Route; readiness: Readiness; reasons: string[] } {
  if (!input.workflowPassed)
    return {
      route: "HOLD_FOR_WORKSPACE_V2_REPAIR",
      readiness: "PROSPECTIVE_HUMAN_TRIAL_NOT_READY_WORKFLOW",
      reasons: ["WORKSPACE_OR_STRUCTURAL_ACCEPTANCE_INCOMPLETE"],
    };
  if (input.instrumentationStatus !== "PASSED")
    return {
      route: "HOLD_FOR_WORKSPACE_V2_REPAIR",
      readiness: "PROSPECTIVE_HUMAN_TRIAL_NOT_READY_INSTRUMENTATION",
      reasons: ["INSTRUMENTATION_ACCEPTANCE_NOT_PASSED"],
    };
  if (input.evaluation.requiredSafetyRecall.missingDialogue < 1)
    return {
      route: "HOLD_FOR_MISSING_EVIDENCE_REPAIR",
      readiness: "PROSPECTIVE_HUMAN_TRIAL_NOT_READY_RANKER",
      reasons: ["MANDATORY_MISSING_DIALOGUE_RECALL_BELOW_ONE"],
    };
  if (
    input.evaluation.requiredSafetyRecall.hallucination < 1 ||
    input.evaluation.burdenResult === "REVIEW_BURDEN_REDUCTION_UNSAFE" ||
    input.evaluation.rankingResult === "REGION_RANKER_WEAK" ||
    input.evaluation.rankingResult === "REGION_RANKER_UNSUPPORTED"
  )
    return {
      route: "HOLD_FOR_REVIEW_RANKER_REDESIGN",
      readiness: "PROSPECTIVE_HUMAN_TRIAL_NOT_READY_RANKER",
      reasons: ["REGION_RANKING_OR_SAFETY_GATE_NOT_PASSED"],
    };
  if (
    input.evaluation.rankingResult === "REGION_RANKER_STRONG_PASS" &&
    input.evaluation.burdenResult === "REVIEW_BURDEN_STRONG_REDUCTION"
  )
    return {
      route: "GO_TO_NEW_EPISODE_PROSPECTIVE_HUMAN_TRIAL",
      readiness: "PROSPECTIVE_HUMAN_TRIAL_READY_NOT_EXECUTED",
      reasons: [
        "UNSEEN_EPISODE_TRIAL_PERMITTED_NOT_EXECUTED_ON_DEVELOPMENT_EPISODE",
      ],
    };
  if (
    input.evaluation.requiredUniqueAudioRatio <= 0.5 &&
    [
      "REVIEW_BURDEN_STRONG_REDUCTION",
      "REVIEW_BURDEN_PROMISING_REDUCTION",
    ].includes(input.evaluation.burdenResult)
  )
    return {
      route: "GO_TO_NEW_EPISODE_TRIAL_WITH_RANKING_CAVEAT",
      readiness: "PROSPECTIVE_HUMAN_TRIAL_READY_NOT_EXECUTED",
      reasons: ["UNSEEN_EPISODE_TRIAL_PERMITTED_WITH_FROZEN_RANKING_CAVEAT"],
    };
  return {
    route: "HOLD_FOR_REVIEW_RANKER_REDESIGN",
    readiness: "PROSPECTIVE_HUMAN_TRIAL_NOT_READY_RANKER",
    reasons: ["UNIQUE_AUDIO_BURDEN_REDUCTION_GATE_NOT_PASSED"],
  };
}

export function c60113ShareableLeakCounts(value: unknown, goldSha256: string) {
  const summary = c60113ShareableSummarySchema.parse(value);
  const serialized = JSON.stringify(summary);
  return {
    absolutePathLeakCount: (
      serialized.match(/\/Users\/|\/home\/|file:\/\/|[A-Za-z]:\\/gu) ?? []
    ).length,
    secretCount: (
      serialized.match(/(?:sk-|ghp_|hf_)[A-Za-z0-9_-]{16,}/gu) ?? []
    ).length,
    goldIdentityLeakCount: serialized.includes(goldSha256) ? 1 : 0,
  };
}

export function c60113AudioBurdenAccounting(input: {
  plannedIntervals: readonly { start: number; end: number }[];
  clips: readonly {
    extractedInterval: { start: number; end: number };
    actualDurationSeconds: number;
  }[];
}) {
  for (const interval of [
    ...input.plannedIntervals,
    ...input.clips.map((clip) => clip.extractedInterval),
  ]) {
    if (
      !Number.isFinite(interval.start) ||
      !Number.isFinite(interval.end) ||
      interval.start < 0 ||
      interval.end <= interval.start
    )
      throw new Error("INVALID_AUDIO_ACCOUNTING_INTERVAL");
  }
  if (
    input.clips.some(
      (clip) =>
        !Number.isFinite(clip.actualDurationSeconds) ||
        clip.actualDurationSeconds <= 0,
    )
  )
    throw new Error("INVALID_ACTUAL_CLIP_DURATION");
  const actualClipSumSeconds = input.clips.reduce(
    (sum, clip) => sum + clip.actualDurationSeconds,
    0,
  );
  const plannedContextSumSeconds = input.plannedIntervals.reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  );
  const uniqueUnionSeconds = c60113UniqueAudioSeconds(input.plannedIntervals);
  return {
    clipSumSeconds: actualClipSumSeconds,
    actualClipSumSeconds,
    clipSumMeaning: "ACTUAL_EXTRACTED_WAV_DURATION_SUM" as const,
    plannedContextSumSeconds,
    extractedClipUnionSeconds: c60113UniqueAudioSeconds(
      input.clips.map((clip) => clip.extractedInterval),
    ),
    uniqueUnionSeconds,
    uniqueUnionMeaning: "PLANNED_REVIEW_PLAYBACK_UNION" as const,
    duplicateContextSeconds: Math.max(
      0,
      plannedContextSumSeconds - uniqueUnionSeconds,
    ),
    duplicateContextMeaning: "PLANNED_CONTEXT_SUM_MINUS_PLANNED_UNION" as const,
  };
}

export function c60113MissingMandatoryValid(
  missing: C60113MissingSpeechEvidence,
): boolean {
  return missing.gaps.every(
    (gap) =>
      gap.reviewLevel !== "REQUIRED" ||
      (gap.classification === "MISSING_DIALOGUE_STRONG" &&
        gap.validatedSourceGlobal &&
        gap.observedSpeechEvidence.length > 0 &&
        gap.lexicalEvidence.length > 0 &&
        gap.independentFamilyCount >= 3 &&
        gap.contradictionEvidence.length === 0),
  );
}

export async function validateC60113Runs(options: C60113ValidationOptions) {
  for (const prefix of [options.outputPrefix, options.upstreamPrefix])
    if (!/^[a-z0-9-]+$/u.test(prefix))
      throw new Error("UNSAFE_OUTPUT_RUN_PREFIX");
  for (const date of [options.outputDate, options.upstreamDate])
    if (!/^\d{8}$/u.test(date)) throw new Error("UNSAFE_OUTPUT_RUN_DATE");
  z.iso.datetime().parse(options.generatedAt);
  const root = path.resolve(options.outputRoot);
  const output = (suffix: string) =>
    path.join(root, `${options.outputPrefix}-${suffix}-${options.outputDate}`);
  const upstream = (suffix: string) =>
    path.join(
      root,
      `${options.upstreamPrefix}-${suffix}-${options.upstreamDate}`,
    );
  for (const suffix of ["trial-readiness", "validation"])
    if (await exists(output(suffix)))
      throw new Error(`EXISTING_ACCEPTANCE_NOT_OVERWRITTEN:${suffix}`);
  const read = (suffix: string, file: string) =>
    readC60113Json(path.join(output(suffix), file));
  const checks: Check[] = [];
  const check = (checkId: string, passed: boolean, evidence: string) =>
    checks.push({ checkId, status: passed ? "PASSED" : "FAILED", evidence });
  const baseline = c60113BaselineReplaySchema.parse(
    await read("baseline", "c6-0-1-13-baseline-replay.json"),
  );
  const policy = c60113ReviewPolicySchema.parse(
    await read("items-v3", "c6-0-1-13-review-rank-policy.json"),
  );
  assertC60113Policy(policy);
  const missing = c60113MissingSpeechEvidenceSchema.parse(
    await read(
      "missing-evidence-v2",
      "machine-missing-speech-evidence-v2.json",
    ),
  );
  const graph = c60113EvidenceFamilyGraphSchema.parse(
    await read("evidence-families", "machine-review-evidence-families.json"),
  );
  const items = c60113ReviewItemsV3Schema.parse(
    await read("items-v3", "machine-review-items-v3.json"),
  );
  const regions = c60113ReviewRegionsV2Schema.parse(
    await read("regions-v2", "machine-review-regions-v2.json"),
  );
  const priority = c60113RegionReviewPrioritySchema.parse(
    await read("region-priority", "machine-region-review-priority.json"),
  );
  const playback = c60113ReviewPlaybackTimelineSchema.parse(
    await read("playback-timeline", "machine-review-playback-timeline.json"),
  );
  const plans = c60113ReviewBurdenPlansSchema.parse(
    await read("burden-plans", "machine-review-burden-plans.json"),
  );
  const features = c60113RegionFeaturesSchema.parse(
    await read("ranker-features", "machine-review-region-features.json"),
  );
  const folds = c60113RankerFoldsSchema.parse(
    await read("ranker-features", "c6-0-1-13-review-ranker-folds.json"),
  );
  const freeze = c60113RankerMachineFreezeSchema.parse(
    await read(
      "ranker-features",
      "c6-0-1-13-review-ranker-machine-freeze.json",
    ),
  );
  const ablationFreeze = c60113AblationFreezeSchema.parse(
    await read("ranker-features", "c6-0-1-13-ablation-machine-freeze.json"),
  );
  assertC60113MachineFreeze({ features, folds, machineFreeze: freeze });
  const coreArtifacts = {
    "c6-0-1-13-review-rank-policy.json": policy,
    "machine-missing-speech-evidence-v2.json": missing,
    "machine-review-evidence-families.json": graph,
    "machine-review-items-v3.json": items,
    "machine-review-regions-v2.json": regions,
    "machine-region-review-priority.json": priority,
    "machine-review-playback-timeline.json": playback,
    "machine-review-burden-plans.json": plans,
  };
  if (
    !semanticHashValid(ablationFreeze) ||
    !Object.entries(coreArtifacts).every(
      ([name, artifact]) =>
        semanticHashValid(artifact) &&
        freeze.artifactHashes[name] === artifact.semanticHash,
    )
  )
    throw new Error("MACHINE_ARTIFACT_CHANGED_AFTER_FREEZE");
  // No Gold file is touched until the machine and fold barriers above verify.
  const labels = c60113RegionLabelsSchema.parse(
    await read("ranker-oof", "gold-review-region-labels.json"),
  );
  const oof = c60113RankerOofSchema.parse(
    await read("ranker-oof", "c6-0-1-13-review-ranker-oof.json"),
  );
  const evaluation = c60113RegionRankingEvaluationSchema.parse(
    await read("ranker-oof", "c6-0-1-13-region-ranking-evaluation.json"),
  );
  const dataQuality = c60113DataQualityAuditSchema.parse(
    await read("ranker-oof", "c6-0-1-13-data-quality-audit.json"),
  );
  const rankerFreeze = c60113RegionRankerFreezeSchema.parse(
    await read("ranker-freeze", "c6-0-1-13-region-ranker-freeze.json"),
  );
  const evaluatorAudit = c60113PostFreezeEvaluationAuditSchema.parse(
    await read("ranker-oof", "c6-0-1-13-post-freeze-evaluation-audit.json"),
  );
  const ablationEvaluation = c60113AblationEvaluationSchema.parse(
    await read("ranker-oof", "c6-0-1-13-ablation-evaluation.json"),
  );
  const missingEvaluation = c60113MissingEvidenceEvaluationSchema.parse(
    await read("ranker-oof", "c6-0-1-13-missing-evidence-evaluation.json"),
  );
  if (
    evaluatorAudit.machineFreezeHash !== freeze.semanticHash ||
    evaluatorAudit.ablationFreezeHash !== ablationFreeze.semanticHash
  )
    throw new Error("POST_FREEZE_EVALUATION_BARRIER_MISMATCH");
  const [sourceAfter, goldAfter] = await Promise.all([
    c60113FileIdentity(path.resolve(options.source)),
    c60113FileIdentity(path.resolve(options.gold)),
  ]);
  const ui: UiResults =
    options.uiResults === undefined
      ? { checks: [], instrumentationTestStatus: "NOT_RUN" }
      : c60113UiAcceptanceResultsSchema.parse(
          await readC60113Json(options.uiResults),
        );
  const suppliedRegressions =
    options.regressionResults === undefined
      ? []
      : c60113ValidationSchema.shape.regressionGroups.parse(
          await readC60113Json(options.regressionResults),
        );
  const regressions = [...suppliedRegressions];
  for (const groupId of [
    "typecheck",
    "lint",
    "format",
    "build",
    "unit",
    "e2e",
    "schema",
    "skill",
    "targeted",
  ]) {
    if (!regressions.some((group) => group.groupId === groupId))
      regressions.push({
        groupId,
        status: "NOT_RUN",
        command: "NOT_SUPPLIED",
        exitCode: null,
        outputHash: null,
      });
  }
  for (const group of regressions)
    if (
      group.status === "PASSED" &&
      (group.exitCode !== 0 || group.outputHash === null)
    )
      throw new Error(
        `REGRESSION_SUCCESS_WITHOUT_COMPLETION_PROOF:${group.groupId}`,
      );
  if (
    new Set(regressions.map((group) => group.groupId)).size !==
    regressions.length
  )
    throw new Error("DUPLICATE_REGRESSION_GROUP");

  check(
    "strict_core_artifacts_and_semantic_hashes",
    Object.values(coreArtifacts).every((artifact) =>
      semanticHashValid(artifact),
    ),
    `${Object.keys(coreArtifacts).length} strict machine artifacts`,
  );
  check(
    "frozen_artifact_identity_bindings",
    Object.entries(coreArtifacts).every(
      ([name, artifact]) =>
        freeze.artifactHashes[name] === artifact.semanticHash,
    ) &&
      freeze.machineFeaturesHash === features.semanticHash &&
      freeze.foldsHash === folds.semanticHash,
    "Core, feature and fold hashes bound to the pre-label freeze",
  );
  check(
    "calibration_hashes_and_causal_bindings",
    [
      features,
      folds,
      freeze,
      labels,
      oof,
      evaluation,
      dataQuality,
      rankerFreeze,
      evaluatorAudit,
      ablationEvaluation,
      missingEvaluation,
    ].every((artifact) => semanticHashValid(artifact, true)) &&
      evaluation.machineFreezeHash === freeze.semanticHash &&
      evaluation.labelsHash === labels.semanticHash &&
      evaluation.oofHash === oof.semanticHash &&
      rankerFreeze.evaluationHash === evaluation.semanticHash &&
      rankerFreeze.oofHash === oof.semanticHash &&
      evaluatorAudit.machineFeaturesHash === features.semanticHash &&
      evaluatorAudit.foldsHash === folds.semanticHash &&
      ablationEvaluation.ablationFreezeHash === ablationFreeze.semanticHash &&
      missingEvaluation.machineFreezeHash === freeze.semanticHash &&
      missingEvaluation.missingEvidenceHash === missing.semanticHash &&
      missingEvaluation.labelsHash === labels.semanticHash,
    "Evaluation refers only to the verified frozen machine inputs",
  );
  check(
    "baseline_replay_parity",
    Object.values(baseline.replayParity).every(Boolean) &&
      semanticHashValid(baseline),
    "C6.0.1.12 item, priority, region and candidate replay",
  );
  check(
    "missing_mandatory_requires_strong",
    c60113MissingMandatoryValid(missing),
    "Only validated strong missing evidence is REQUIRED",
  );
  const replayedMissing = buildC60113MissingSpeechEvidence({
    gaps: missing.gaps.map((gap) => ({
      gapId: gap.gapId,
      sourceInterval: gap.sourceInterval,
      itemIds: gap.itemIds,
      legacySignal: gap.legacySignal,
      validatedSourceGlobal: gap.validatedSourceGlobal,
      cueCoveredRatio: gap.cueCoveredRatio,
    })),
    evidenceFamilies: graph,
    legacyMissingItemCount: missing.summary.legacyMissingItemCount,
    policy,
  });
  check(
    "missing_classification_policy_replay",
    replayedMissing.semanticHash === missing.semanticHash,
    "Every missing-speech classification reproduces from the frozen gap, activity, lexical and contradiction evidence",
  );
  check(
    "missing_gap_and_item_denominators_separate",
    missingEvaluation.legacyMissingItemCount ===
      missing.summary.legacyMissingItemCount &&
      missingEvaluation.deduplicatedGapCount === missing.gaps.length &&
      missingEvaluation.classifications.reduce(
        (sum, row) => sum + row.gapCount,
        0,
      ) === missing.gaps.length &&
      missingEvaluation.classifications.every(
        (row) =>
          row.truePositiveGapCount + row.falsePositiveGapCount === row.gapCount,
      ) &&
      missingEvaluation.totalGoldMissingComponents ===
        missingEvaluation.components.length &&
      missingEvaluation.legacyTruePositiveItemCount +
        missingEvaluation.legacyFalsePositiveItemCount ===
        missingEvaluation.legacyMissingItemCount,
    "Legacy items, deduplicated gaps and Gold missing components use distinct explicitly reported denominators",
  );
  let independentTriplesValid = true;
  for (const gap of missing.gaps.filter(
    (entry) => entry.classification === "MISSING_DIALOGUE_STRONG",
  )) {
    const evidence = graph.evidence.filter(
      (entry) =>
        entry.gapIds.includes(gap.gapId) &&
        entry.validatedSourceGlobal &&
        !entry.evidenceAbsence &&
        !entry.contradiction &&
        entry.strength > 0,
    );
    const groups = c60113IndependentEvidenceGroups(evidence);
    independentTriplesValid &&= groups.some(
      (a) =>
        a.evidenceIds.some((id) => gap.observedSpeechEvidence.includes(id)) &&
        groups.some(
          (b) =>
            b.groupId !== a.groupId &&
            b.evidenceIds.some((id) => gap.lexicalEvidence.includes(id)) &&
            groups.some(
              (c) =>
                c.groupId !== a.groupId &&
                c.groupId !== b.groupId &&
                c.families.some(
                  (family) =>
                    family !== "SPEECH_ACTIVITY" &&
                    family !== "ASR_LEXICAL_CONTENT",
                ),
            ),
        ),
    );
  }
  check(
    "strong_missing_pairwise_independent_roots",
    independentTriplesValid,
    "Observed activity, localized lexical proof and third support use disjoint provider/root groups",
  );
  const rebuiltGraph = buildC60113EvidenceFamilyGraph({
    observations: graph.evidence,
    policy,
  });
  check(
    "evidence_family_graph_recomputation",
    equals(rebuiltGraph.evidence, graph.evidence) &&
      equals(rebuiltGraph.correlationGroups, graph.correlationGroups) &&
      rebuiltGraph.summary.correlatedEvidenceDeduplicatedCount ===
        graph.summary.correlatedEvidenceDeduplicatedCount &&
      rebuiltGraph.summary.evidenceAbsenceCount ===
        graph.summary.evidenceAbsenceCount,
    "Strict evidence hashes, transitive lineage correlations and absence counts recomputed",
  );
  check(
    "evidence_absence_risk_zero",
    equals(graph.summary.evidenceAbsenceRiskBoostCount, 0) &&
      graph.evidence.every(
        (entry) =>
          !entry.evidenceAbsence ||
          (!entry.positiveRisk && entry.strength === 0),
      ),
    `${graph.summary.evidenceAbsenceCount} absence observations; zero positive risk boost`,
  );
  check(
    "required_items_use_explicit_safety_policy",
    items.items.every(
      (item) =>
        (item.requiredLevel === "REQUIRED") ===
        item.mandatoryReasons.length > 0,
    ) &&
      items.items.every(
        (item) =>
          item.priorityVector.mandatorySafetyClass !== "STRONG_MISSING" ||
          item.missingClassification === "MISSING_DIALOGUE_STRONG",
      ),
    "Required level is independent of numeric display thresholds",
  );
  const maxShare = items.summary.scoreDistribution.maxScoreShare;
  check(
    "score_saturation_explained",
    maxShare <= 0.1 || items.summary.scoreDistribution.genuineMandatoryMaxTie,
    `Maximum-score share ${maxShare}; largest tie ${items.summary.scoreDistribution.largestTieGroupCount}; real mandatory tie ${items.summary.scoreDistribution.genuineMandatoryMaxTie}`,
  );
  const regionIds = new Set(regions.regions.map((region) => region.regionId));
  const itemIds = items.items.map((item) => item.reviewItemId).toSorted();
  const assignedIds = regions.regions
    .flatMap((region) => region.reviewItemIds)
    .toSorted();
  check(
    "region_item_partition_complete",
    equals(itemIds, assignedIds) &&
      new Set(assignedIds).size === assignedIds.length,
    "Every item belongs to exactly one region",
  );
  check(
    "playback_mapping_complete",
    playback.regionMappings.length === regions.regions.length &&
      playback.regionMappings.every(
        (mapping) =>
          regionIds.has(mapping.regionId) &&
          mapping.segmentIds.every((id) =>
            playback.segments.some(
              (segment) =>
                segment.segmentId === id &&
                segment.regionIds.includes(mapping.regionId),
            ),
          ),
      ),
    "Every region has a source-global non-overlapping playback mapping",
  );
  const regionIntervals = regions.regions.map(
    (region) => region.contextInterval,
  );
  check(
    "independent_audio_union",
    close(
      c60113UniqueAudioSeconds(regionIntervals),
      playback.uniqueUnionSeconds,
    ) &&
      close(
        playback.clipSumSeconds - playback.uniqueUnionSeconds,
        playback.duplicateContextSeconds,
      ) &&
      close(
        playback.segments.reduce(
          (sum, segment) =>
            sum + segment.sourceInterval.end - segment.sourceInterval.start,
          0,
        ),
        playback.uniqueUnionSeconds,
      ),
    "Clip sum, union and duplicate context recomputed separately",
  );
  let budgetConsistent = true;
  for (const plan of plans.plans) {
    const selected = plan.regionIds.map((id) => {
      const region = priority.regions.find((entry) => entry.regionId === id);
      if (region === undefined) throw new Error("BURDEN_PLAN_UNKNOWN_REGION");
      return region;
    });
    const played: { start: number; end: number }[] = [];
    let increments = 0;
    selected.forEach((region, index) => {
      const incremental = c60113IncrementalAudioSeconds(
        region.contextInterval,
        played,
      );
      budgetConsistent &&= close(
        incremental,
        plan.selectionSteps[index]?.incrementalPlaybackSeconds ?? -1,
      );
      increments += incremental;
      played.push(region.contextInterval);
    });
    const rerun = selectC60113Regions({
      regions: priority.regions,
      policy,
      budgetSeconds: plan.budgetSeconds,
      mandatoryOnly: plan.planId === "ALL_MANDATORY",
    });
    budgetConsistent &&=
      equals(
        rerun.regions.map((region) => region.regionId),
        plan.regionIds,
      ) &&
      close(c60113UniqueAudioSeconds(played), plan.uniqueUnionSeconds) &&
      close(increments, plan.uniqueUnionSeconds) &&
      (plan.budgetSeconds === null ||
        plan.uniqueUnionSeconds <= plan.budgetSeconds + 1e-7);
  }
  check(
    "burden_selection_and_incremental_cost_replay",
    budgetConsistent,
    `${plans.plans.length} plans independently replayed with marginal recomputation`,
  );
  check(
    "fold_audio_leakage_zero",
    folds.crossFoldAudioOverlapCount === 0 &&
      folds.folds.every((fold, index) =>
        folds.folds
          .slice(index + 1)
          .every((other) =>
            fold.audioIntervalUnion.every((left) =>
              other.audioIntervalUnion.every(
                (right) =>
                  Math.min(left.end, right.end) <=
                  Math.max(left.start, right.start),
              ),
            ),
          ),
      ),
    `${folds.actualFoldCount} pre-label contiguous/grouped folds`,
  );
  check(
    "feature_predictor_gold_text_identity_zero",
    equals(
      [
        features.goldInputCount,
        features.rawTextFeatureCount,
        features.identityPredictorCount,
        features.absoluteTimePredictorCount,
      ],
      [0, 0, 0, 0],
    ),
    "Closed structural feature vocabulary with separate unknown/unavailable states",
  );
  check(
    "oof_predictions_cover_heldout_only",
    oof.predictions.length === features.regions.length &&
      new Set(oof.predictions.map((prediction) => prediction.regionId)).size ===
        features.regions.length &&
      oof.models.every((model) =>
        model.testRegionIds.every((id) => !model.trainRegionIds.includes(id)),
      ) &&
      oof.predictions.every((prediction) =>
        oof.models.some(
          (model) =>
            model.outerFold === prediction.outerFold &&
            model.testRegionIds.includes(prediction.regionId),
        ),
      ),
    "Every formal learned prediction is held out from its model training set",
  );
  check(
    "machine_data_quality_audit",
    dataQuality.passed && dataQuality.checks.every((entry) => entry.passed),
    `${dataQuality.checks.length} data-quality checks`,
  );
  check(
    "ablation_freeze_before_labels",
    ablationFreeze.stages.length === 8 &&
      new Set(ablationFreeze.stages.map((stage) => stage.stage)).size === 8 &&
      evaluatorAudit.frozenMachineFilesUnchanged &&
      evaluatorAudit.upstreamEvaluationFilesUnchanged,
    "A0 through A7 machine features and folds were frozen before label access and remained unchanged",
  );
  check(
    "ablations_have_unique_error_denominators",
    ablationEvaluation.stages.every(
      (stage) =>
        stage.uniqueErrorComponentCount ===
          ablationEvaluation.uniqueErrorComponentCount &&
        stage.featuresHash ===
          ablationFreeze.stages.find((frozen) => frozen.stage === stage.stage)
            ?.featuresHash &&
        stage.foldsHash ===
          ablationFreeze.stages.find((frozen) => frozen.stage === stage.stage)
            ?.foldsHash,
    ),
    "All eight ablations evaluate one deduplicated error population and the corresponding frozen feature/fold identities",
  );

  const finalABArtifactParity: z.infer<
    typeof c60113ReviewBurdenValidationSchema
  >["finalABArtifactParity"] = [];
  for (const filename of [
    ...Object.keys(coreArtifacts),
    "machine-review-region-features.json",
    "c6-0-1-13-review-ranker-folds.json",
    "c6-0-1-13-review-ranker-machine-freeze.json",
  ]) {
    const aHash = await c60113FileHash(
      path.join(output("final-a"), "review-calibration-v13", filename),
    );
    const bHash = await c60113FileHash(
      path.join(output("final-b"), "review-calibration-v13", filename),
    );
    finalABArtifactParity.push({
      artifact: filename,
      aHash,
      bHash,
      equal: aHash === bHash,
    });
  }
  check(
    "fresh_independent_machine_ab_parity",
    finalABArtifactParity.every((entry) => entry.equal),
    `${finalABArtifactParity.length} independently constructed artifact files are byte-identical`,
  );
  const [sourceSubtitle, aSubtitle, bSubtitle] = await Promise.all([
    c60113OnlySubtitleDirectory(upstream("final-a")),
    c60113OnlySubtitleDirectory(output("final-a")),
    c60113OnlySubtitleDirectory(output("final-b")),
  ]);
  const sourceBase = path.basename(sourceSubtitle);
  const finalSubtitleByteParity: z.infer<
    typeof c60113ReviewBurdenValidationSchema
  >["finalSubtitleByteParity"] = [];
  for (const filename of [
    "subtitle-package.needs-review.json",
    ...["ass", "srt", "vtt"].flatMap((extension) => [
      `${sourceBase}.${extension}`,
      `${sourceBase}.best-effort.${extension}`,
    ]),
  ]) {
    const [sourceHash, aHash, bHash] = await Promise.all([
      c60113FileHash(path.join(sourceSubtitle, filename)),
      c60113FileHash(path.join(aSubtitle, filename)),
      c60113FileHash(path.join(bSubtitle, filename)),
    ]);
    finalSubtitleByteParity.push({
      filename,
      sourceHash,
      aHash,
      bHash,
      equal: sourceHash === aHash && aHash === bHash,
    });
  }
  check(
    "machine_final_package_and_six_exports_byte_parity",
    finalSubtitleByteParity.every((entry) => entry.equal),
    "Original package plus ASS/SRT/VTT primary and best-effort exports preserved byte-for-byte",
  );
  const finalPackage = subtitlePackageSchema.parse(
    await readC60113Json(
      path.join(aSubtitle, "subtitle-package.needs-review.json"),
    ),
  );
  check(
    "canonical_text_and_timing_hashes",
    c601CanonicalTextHash(finalPackage.cues) ===
      baseline.canonicalIdentities.canonicalTextHash &&
      c601CanonicalTimingHash(finalPackage.cues) ===
        baseline.canonicalIdentities.canonicalTimingHash &&
      finalPackage.cues.length === baseline.canonicalIdentities.cueCount,
    "Canonical content hashes match C6.0.1.12 without text or timing mutation",
  );
  check(
    "production_remains_needs_review",
    finalPackage.primarySubtitle?.validationStatus === "needs-review",
    "Machine-only release is not authorized; C6.0.2 stays HOLD",
  );

  const workspaces = [
    output("workspace-v2"),
    path.join(output("final-a"), "review-workspace-v2"),
    path.join(output("final-b"), "review-workspace-v2"),
  ];
  const workspaceHashes: string[] = [];
  const audioHashes: string[] = [];
  const assetHashes: Record<string, string[]> = {};
  let verifiedAudioAccounting: ReturnType<
    typeof c60113AudioBurdenAccounting
  > | null = null;
  let playableCount = 0;
  let workspaceIntegrity = true;
  let noRealTrialOrDecisions = true;
  for (const [workspaceIndex, directory] of workspaces.entries()) {
    const data = (await readC60113Json(
      path.join(directory, "review-data.json"),
    )) as C60112ReviewWorkspaceData;
    assertC60112ReviewWorkspaceData(data);
    assertC60112MachineOnlyInput(data);
    workspaceIntegrity &&= equals(
      data.machineDraftIdentity,
      baseline.canonicalIdentities,
    );
    for (const asset of [
      "index.html",
      "assets/review.js",
      "assets/review.css",
    ]) {
      (assetHashes[asset] ??= []).push(
        await c60113FileHash(await c60113ContainedFile(directory, asset)),
      );
    }
    const audio = machineReviewAudioManifestSchema.parse(
      await readC60113Json(
        path.join(directory, "machine-review-audio-manifest.json"),
      ),
    );
    if (workspaceIndex === 0)
      verifiedAudioAccounting = c60113AudioBurdenAccounting({
        plannedIntervals: regionIntervals,
        clips: audio.clips,
      });
    const oldFreeze = c60112ReviewPackageFreezeSchema.parse(
      await readC60113Json(
        path.join(directory, "c6-0-1-12-review-package-freeze.json"),
      ),
    );
    const oldPolicy = (await readC60113Json(
      path.join(directory, "c6-0-1-12-review-assistance-policy.json"),
    )) as C60112ReviewPolicy;
    workspaceIntegrity &&= verifyC60112ReviewPackageFreeze({
      freeze: oldFreeze,
      packageInput: {
        sourceMediaSha256: baseline.sourceIdentity.sha256,
        machineDraftHash: baseline.machineDraftHash,
        policy: oldPolicy,
        items: machineReviewItemsSchema.parse(
          await readC60113Json(
            path.join(directory, "machine-review-items.json"),
          ),
        ),
        priority: machineReviewPrioritySchema.parse(
          await readC60113Json(
            path.join(directory, "machine-review-priority.json"),
          ),
        ),
        regions: machineReviewRegionsSchema.parse(
          await readC60113Json(
            path.join(directory, "machine-review-regions.json"),
          ),
        ),
        candidates: machineReviewCandidateBundlesSchema.parse(
          await readC60113Json(
            path.join(directory, "machine-review-candidate-bundles.json"),
          ),
        ),
        audioManifest: audio,
        workspaceData: data,
      },
    });
    workspaceHashes.push(machineQualitySemanticHash(data));
    audioHashes.push(audio.semanticHash);
    for (const clip of audio.clips) {
      const file = await c60113ContainedFile(directory, clip.relativePath);
      const metadata = inspectReviewWav(await readFile(file));
      const workspaceRegion = data.regions.find(
        (region) => region.regionId === clip.regionId,
      );
      workspaceIntegrity &&=
        (await c60113FileHash(file)) === clip.sha256 &&
        metadata.frameCount === clip.frameCount &&
        close(metadata.actualDurationSeconds, clip.actualDurationSeconds) &&
        clip.sourceMediaSha256 === sourceAfter.sha256 &&
        workspaceRegion !== undefined &&
        equals(
          workspaceRegion.audioSourceInterval ?? {
            start: workspaceRegion.contextStart,
            end: workspaceRegion.contextEnd,
          },
          clip.extractedInterval,
        );
      if (workspaceIndex === 0) {
        playableCount += 1;
      }
    }
    for (const privateFile of [
      "trial-manifest.json",
      "review-session.json",
      "human-correction-log.jsonl",
      "review-audit.jsonl",
      "review-trial-events.jsonl",
      "pending-workspace-transaction.json",
      "pending-trial-event.json",
    ]) {
      const file = path.join(directory, "session", privateFile);
      if (await exists(file))
        noRealTrialOrDecisions &&=
          (await readFile(file, "utf8")).trim().length === 0;
    }
  }
  check(
    "review_delivery_integrity_audio_playable",
    workspaceIntegrity && playableCount === regions.regions.length,
    `${playableCount}/${regions.regions.length} local WAVs verified; source-to-clip offsets use actual extracted bounds`,
  );
  check(
    "workspace_audio_ab_parity",
    new Set(workspaceHashes).size === 1 &&
      new Set(audioHashes).size === 1 &&
      workspaceHashes[0] === freeze.artifactHashes.workspace &&
      audioHashes[0] === freeze.artifactHashes.audio,
    "Three immutable workspace snapshots and independently extracted A/B WAV hashes match",
  );
  check(
    "workspace_ui_asset_ab_parity",
    Object.values(assetHashes).every(
      (hashes) => hashes.length === 3 && new Set(hashes).size === 1,
    ),
    "HTML, JavaScript and CSS are byte-identical across all three workspace deliveries; UI-only fixes do not mutate frozen machine data",
  );
  check(
    "no_real_human_trial_or_decisions",
    noRealTrialOrDecisions,
    "No trial manifest, human correction record or private real-trial event log was created in the development package",
  );
  const sourceReadOnly =
    evaluatorAudit.sourceReadOnly &&
    equals(baseline.sourceIdentity, sourceAfter) &&
    equals(
      evaluatorAudit.sourceIdentityBefore,
      evaluatorAudit.sourceIdentityAfter,
    ) &&
    equals(sourceAfter, evaluatorAudit.sourceIdentityAfter);
  const goldReadOnly =
    equals(
      evaluatorAudit.goldIdentityBefore,
      evaluatorAudit.goldIdentityAfter,
    ) && equals(goldAfter, evaluatorAudit.goldIdentityAfter);
  check(
    "source_media_read_only",
    sourceReadOnly,
    "Source SHA-256, byte size, mtime and inode unchanged across replay, evaluation and acceptance",
  );
  check(
    "evaluation_gold_read_only",
    goldReadOnly && evaluatorAudit.goldReadOnly,
    "Post-freeze evaluator Gold SHA-256, byte size, mtime and inode unchanged",
  );
  check(
    "runtime_gold_models_network_zero",
    equals(
      [
        evaluatorAudit.runtimeGoldInputCount,
        evaluatorAudit.asrInferenceCount,
        evaluatorAudit.networkUsed,
        baseline.runtimeGoldInputCount,
        baseline.asrInferenceCount,
        baseline.networkUsed,
      ],
      [0, 0, false, 0, 0, false],
    ),
    "All machine construction is offline cached-artifact processing; Gold access is evaluator-only",
  );
  if (
    ui.datasetSpecificHardcodingCount === undefined ||
    ui.datasetSpecificHardcodingCount === null
  )
    checks.push({
      checkId: "dataset_specific_hardcoding_audit",
      status: "NOT_RUN",
      evidence: "No completed source hardcoding audit supplied",
    });
  else
    check(
      "dataset_specific_hardcoding_audit",
      ui.datasetSpecificHardcodingCount === 0,
      `${ui.datasetSpecificHardcodingCount} dataset-specific machine rules found in supplied source audit`,
    );
  checks.push(
    ...ui.checks.map((entry) => ({ ...entry, checkId: `ui:${entry.checkId}` })),
  );
  if (ui.checks.length === 0)
    checks.push({
      checkId: "ui:region_first_workflow",
      status: "NOT_RUN",
      evidence: "UI acceptance results not supplied",
    });
  checks.push({
    checkId: "ui:trial_instrumentation_acceptance",
    status: ui.instrumentationTestStatus,
    evidence:
      "Synthetic trial event, active-time and unique-audio instrumentation verification status",
  });
  const requiredPlan = plans.plans.find(
    (plan) => plan.planId === "ALL_MANDATORY",
  );
  if (requiredPlan === undefined) throw new Error("ALL_MANDATORY_PLAN_MISSING");
  const duration = regions.sourceDurationSeconds;
  if (verifiedAudioAccounting === null)
    throw new Error("VERIFIED_REVIEW_AUDIO_ACCOUNTING_MISSING");
  const upstreamRegions = machineReviewRegionsSchema.parse(
    await readC60113Json(
      path.join(upstream("review-regions"), "machine-review-regions.json"),
    ),
  );
  const upstreamAudio = machineReviewAudioManifestSchema.parse(
    await readC60113Json(
      path.join(upstream("review-audio"), "machine-review-audio-manifest.json"),
    ),
  );
  const upstreamFreeze = c60112ReviewPackageFreezeSchema.parse(
    await readC60113Json(
      path.join(
        upstream("review-package-freeze"),
        "c6-0-1-12-review-package-freeze.json",
      ),
    ),
  );
  const baselineAudioAccounting = c60113AudioBurdenAccounting({
    plannedIntervals: upstreamRegions.regions.map((region) => ({
      start: region.contextStart,
      end: region.contextEnd,
    })),
    clips: upstreamAudio.clips,
  });
  check(
    "baseline_audio_accounting_frozen_provenance",
    upstreamFreeze.semanticHash === baseline.upstreamFreezeHash &&
      upstreamFreeze.regionHash === upstreamRegions.semanticHash &&
      upstreamFreeze.audioManifestHash === upstreamAudio.semanticHash &&
      close(
        baselineAudioAccounting.actualClipSumSeconds,
        baseline.totalClipSeconds,
      ) &&
      close(
        baselineAudioAccounting.uniqueUnionSeconds,
        baseline.totalUniqueAudioSeconds,
      ),
    "Baseline planned intervals and actual extracted clips bind to the preserved C6.0.1.12 freeze; padding is not treated as repeated planned context",
  );
  check(
    "actual_and_planned_audio_accounting_distinct",
    close(
      verifiedAudioAccounting.plannedContextSumSeconds,
      playback.clipSumSeconds,
    ) &&
      close(
        verifiedAudioAccounting.uniqueUnionSeconds,
        playback.uniqueUnionSeconds,
      ) &&
      close(
        verifiedAudioAccounting.duplicateContextSeconds,
        playback.duplicateContextSeconds,
      ),
    "Actual WAV sum, extracted-clip union, planned-context sum and planned-playback union are reported separately; duplicate context uses only planned intervals",
  );
  const before = {
    itemCount: baseline.itemCount,
    regionCount: baseline.regionCount,
    requiredItemCount: baseline.requiredItemCount,
    requiredRegionCount: baseline.requiredRegionCount,
    ...baselineAudioAccounting,
    requiredUniqueSeconds: baseline.requiredUniqueAudioSeconds,
    requiredUniqueRatio:
      baseline.requiredUniqueAudioRatio ??
      baseline.requiredUniqueAudioSeconds / duration,
    scoreDiagnostics: baseline.scoreDiagnostics,
  };
  const after = {
    itemCount: items.items.length,
    regionCount: regions.regions.length,
    requiredItemCount: items.summary.requiredItemCount,
    requiredRegionCount: regions.summary.requiredRegionCount,
    ...verifiedAudioAccounting,
    requiredUniqueSeconds: requiredPlan.uniqueUnionSeconds,
    requiredUniqueRatio: requiredPlan.uniqueUnionSeconds / duration,
    scoreDiagnostics: c60113ScoreDiagnostics(
      items.items.map((item) => item.displayPriorityScore),
    ),
  };
  check(
    "required_burden_evaluation_consistency",
    close(evaluation.requiredUniqueAudioRatio, after.requiredUniqueRatio),
    "Required burden measured from the frozen unique playback intervals",
  );
  const header = {
    schemaVersion: "1.0.0" as const,
    policyVersion: policy.policyVersion,
    generatedAt: options.generatedAt,
  };
  const shareableFields = {
    ...header,
    artifactType: "c6-0-1-13-shareable-review-burden-summary" as const,
    audience: "AGGREGATE_AUDIT_ONLY" as const,
    itemCount: after.itemCount,
    regionCount: after.regionCount,
    requiredItemCount: after.requiredItemCount,
    requiredRegionCount: after.requiredRegionCount,
    ...verifiedAudioAccounting,
    requiredUniqueSeconds: after.requiredUniqueSeconds,
    requiredUniqueRatio: after.requiredUniqueRatio,
    maxScoreShare: maxShare,
    maximumTieCount: after.scoreDiagnostics.largestTieGroup,
    absenceRiskBoostCount: 0 as const,
    canonicalTextMutationCount: 0 as const,
    canonicalTimingMutationCount: 0 as const,
    rankingResult: evaluation.rankingResult,
    burdenResult: evaluation.burdenResult,
    humanReviewTimeMeasured: false as const,
    realHumanSessionExecuted: false as const,
    sourceAudioIncluded: false as const,
    dialogueIncluded: false as const,
    privateEventsIncluded: false as const,
    approvedHashes: {
      policy: policy.semanticHash,
      machineFreeze: freeze.semanticHash,
      rankerFreeze: rankerFreeze.semanticHash,
      items: items.semanticHash,
      regions: regions.semanticHash,
      playback: playback.semanticHash,
      plans: plans.semanticHash,
    },
  };
  // Privacy participates in routing. The only field filled after this audit is
  // a closed route enum, so a failing audit can never retain a GO conclusion.
  const prospectivePrivacy = c60113ShareableLeakCounts(
    withC60113SemanticHash({
      ...shareableFields,
      route: "HOLD_FOR_WORKSPACE_V2_REPAIR",
    }),
    goldAfter.sha256,
  );
  const privacyPassed = Object.values(prospectivePrivacy).every(
    (count) => count === 0,
  );
  check(
    "shareable_aggregate_privacy_audit",
    privacyPassed,
    "One strict aggregate-only JSON; zero paths, secrets, Gold identities, dialogue or private events",
  );
  const route = c60113AcceptanceRoute({
    evaluation,
    workflowPassed:
      checks.every((entry) => entry.status === "PASSED") &&
      regressions.every((entry) => entry.status === "PASSED"),
    instrumentationStatus: ui.instrumentationTestStatus,
  });
  const readiness = c60113ProspectiveTrialReadinessSchema.parse(
    withC60113SemanticHash({
      ...header,
      artifactType: "c6-0-1-13-prospective-trial-readiness",
      rankerFreezeHash: rankerFreeze.semanticHash,
      machineFreezeHash: freeze.semanticHash,
      workspaceHash: workspaceHashes[0],
      episodeEligibility: "NOT_ELIGIBLE_PRIOR_GOLD_EXPOSURE",
      episodeOneEligibleForBlindHumanTrial: false,
      realHumanSessionExecuted: false,
      humanReviewTimeMeasured: false,
      realHumanTrialNotExecutedIsExpected: true,
      readiness: route.readiness,
      route: route.route,
      commands: [
        "init",
        "start",
        "pause",
        "resume",
        "complete",
        "validate",
        "export",
        "serve",
        "package",
      ].map((action) => `npm run review:trial -- ${action}`),
      eventTypes: c60113TrialEventTypeSchema.options,
      instrumentationTestStatus: ui.instrumentationTestStatus,
      syntheticTrialOnly: true,
      activeTimePolicy: "visible-focused-interaction-or-playback-v1",
      idleTimeoutSeconds: 60,
      protocolVersion: "REAL_HUMAN_TRIAL_PROTOCOL_V2",
      reasons: route.reasons,
    }),
  );
  const missingClassificationCounts = {
    SPEECH_GAP_OBSERVED: 0,
    MISSING_DIALOGUE_POSSIBLE: 0,
    MISSING_DIALOGUE_STRONG: 0,
    MISSING_DIALOGUE_CONTRADICTED: 0,
    MISSING_DIALOGUE_UNRESOLVED: 0,
  };
  missing.gaps.forEach((gap) => {
    missingClassificationCounts[gap.classification] += 1;
  });
  const burden = c60113ReviewBurdenValidationSchema.parse(
    withC60113SemanticHash({
      ...header,
      artifactType: "c6-0-1-13-review-burden-validation",
      before,
      after,
      requiredAudioReductionSeconds:
        before.requiredUniqueSeconds - after.requiredUniqueSeconds,
      requiredAudioReductionRatio:
        before.requiredUniqueSeconds === 0
          ? 0
          : (before.requiredUniqueSeconds - after.requiredUniqueSeconds) /
            before.requiredUniqueSeconds,
      missingClassificationCounts,
      independentFamilyMean: missing.summary.independentFamilyMean,
      deduplicatedEvidenceCount:
        graph.summary.correlatedEvidenceDeduplicatedCount,
      absenceRiskBoostCount: 0,
      machineTextMutationCount: 0,
      machineTimingMutationCount: 0,
      finalABArtifactParity,
      finalSubtitleByteParity,
      canonicalIdentities: baseline.canonicalIdentities,
      sourceReadOnly,
      sourceIdentityBefore: baseline.sourceIdentity,
      sourceIdentityAfter: sourceAfter,
      goldReadOnly,
      goldIdentityBefore: evaluatorAudit.goldIdentityBefore,
      goldIdentityAfter: goldAfter,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
    }),
  );
  await createC60113OutputDirectory(output("validation"));
  await createC60113OutputDirectory(output("trial-readiness"));
  const shareableDirectory = path.join(output("validation"), "shareable");
  await mkdir(shareableDirectory);
  const shareable = c60113ShareableSummarySchema.parse(
    withC60113SemanticHash({
      ...shareableFields,
      route: route.route,
    }),
  );
  const shareableFile = path.join(
    shareableDirectory,
    "review-burden-summary.json",
  );
  await atomicWriteJson(shareableFile, shareable);
  const { absolutePathLeakCount, secretCount, goldIdentityLeakCount } =
    c60113ShareableLeakCounts(
      await readC60113Json(shareableFile),
      goldAfter.sha256,
    );
  const brokenRelativeReferenceCount =
    (await c60113ContainedFile(
      shareableDirectory,
      "review-burden-summary.json",
    )) === shareableFile
      ? 0
      : 1;
  if (
    brokenRelativeReferenceCount !== 0 ||
    !equals(prospectivePrivacy, {
      absolutePathLeakCount,
      secretCount,
      goldIdentityLeakCount,
    })
  )
    throw new Error("SHAREABLE_CHANGED_AFTER_PRIVACY_ROUTING_AUDIT");
  const shareablePassed =
    absolutePathLeakCount +
      secretCount +
      goldIdentityLeakCount +
      brokenRelativeReferenceCount ===
    0;
  const shareableAudit = c60113ShareableAuditSchema.parse(
    withC60113SemanticHash({
      ...header,
      artifactType: "c6-0-1-13-shareable-audit",
      status: shareablePassed ? "PASSED" : "FAILED",
      files: [
        {
          relativePath: "review-burden-summary.json",
          sha256: await c60113FileHash(shareableFile),
        },
      ],
      absolutePathLeakCount,
      secretCount,
      goldIdentityLeakCount,
      brokenRelativeReferenceCount,
      fullDialoguePayloadCount: 0,
      privateEventPayloadCount: 0,
    }),
  );
  check(
    "shareable_relative_reference_integrity",
    equals(brokenRelativeReferenceCount, 0),
    "Only the approved aggregate summary exists and resolves under its new shareable directory",
  );
  const failedChecks = checks.filter(
    (entry) => entry.status === "FAILED",
  ).length;
  const notRunChecks = checks.filter(
    (entry) => entry.status === "NOT_RUN",
  ).length;
  const failedRegressions = regressions.filter(
    (entry) => entry.status === "FAILED",
  ).length;
  const notRunRegressions = regressions.filter(
    (entry) => entry.status === "NOT_RUN",
  ).length;
  const acceptance = c60113ValidationSchema.parse(
    withC60113SemanticHash({
      ...header,
      artifactType: "c6-0-1-13-validation",
      policyHash: policy.semanticHash,
      machineFreezeHash: freeze.semanticHash,
      rankerFreezeHash: rankerFreeze.semanticHash,
      checks,
      regressionGroups: regressions,
      summary: {
        passedChecks: checks.length - failedChecks - notRunChecks,
        failedChecks,
        notRunChecks,
        passedRegressionGroups:
          regressions.length - failedRegressions - notRunRegressions,
        failedRegressionGroups: failedRegressions,
        notRunRegressionGroups: notRunRegressions,
      },
      engineeringAcceptance:
        failedChecks + failedRegressions > 0
          ? "FAILED"
          : notRunChecks + notRunRegressions > 0
            ? "INCOMPLETE"
            : "PASSED",
      rankingResult: evaluation.rankingResult,
      burdenResult: evaluation.burdenResult,
      trialReadiness: readiness.readiness,
      route: route.route,
      runtimeGoldInputCount: 0,
      asrInferenceCount: 0,
      networkUsedForAcceptance: false,
      datasetSpecificHardcodingCount: ui.datasetSpecificHardcodingCount ?? null,
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
    }),
  );
  await Promise.all([
    atomicWriteJson(
      path.join(
        output("validation"),
        "c6-0-1-13-review-burden-validation.json",
      ),
      burden,
    ),
    atomicWriteJson(
      path.join(output("validation"), "c6-0-1-13-validation.json"),
      acceptance,
    ),
    atomicWriteJson(
      path.join(output("validation"), "c6-0-1-13-shareable-audit.json"),
      shareableAudit,
    ),
    atomicWriteJson(
      path.join(
        output("trial-readiness"),
        "c6-0-1-13-prospective-trial-readiness.json",
      ),
      readiness,
    ),
  ]);
  const unexpectedShareable = (await readdir(shareableDirectory)).filter(
    (file) => file !== "review-burden-summary.json",
  );
  if (unexpectedShareable.length > 0)
    throw new Error("UNAPPROVED_SHAREABLE_ARTIFACT");
  return { acceptance, readiness, burden, shareableAudit };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "output-root": { type: "string" },
      "output-prefix": { type: "string" },
      "output-date": { type: "string" },
      "upstream-prefix": { type: "string" },
      "upstream-date": { type: "string" },
      source: { type: "string" },
      gold: { type: "string" },
      "generated-at": { type: "string" },
      "regression-results": { type: "string" },
      "ui-results": { type: "string" },
    },
  });
  const required = (key: keyof typeof values): string => {
    const value = values[key];
    if (value === undefined || value.trim() === "")
      throw new Error(`Missing --${key}`);
    return value;
  };
  const result = await validateC60113Runs({
    outputRoot: required("output-root"),
    outputPrefix: required("output-prefix"),
    outputDate: required("output-date"),
    upstreamPrefix: required("upstream-prefix"),
    upstreamDate: required("upstream-date"),
    source: required("source"),
    gold: required("gold"),
    generatedAt: required("generated-at"),
    ...(values["regression-results"] === undefined
      ? {}
      : { regressionResults: values["regression-results"] }),
    ...(values["ui-results"] === undefined
      ? {}
      : { uiResults: values["ui-results"] }),
  });
  process.stdout.write(
    `${JSON.stringify({ engineeringAcceptance: result.acceptance.engineeringAcceptance, checks: result.acceptance.summary, rankingResult: result.acceptance.rankingResult, burdenResult: result.acceptance.burdenResult, route: result.acceptance.route }, null, 2)}\n`,
  );
  if (result.acceptance.engineeringAcceptance !== "PASSED")
    process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
