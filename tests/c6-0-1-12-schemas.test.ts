import { z } from "zod";

import {
  c60112IdealReviewUpperBoundSchema,
  c60112PolicyVersion,
  c60112ReviewAssistanceValidationSchema,
  c60112ReviewPackageFreezeSchema,
  c60112ReviewQualityEvaluationSchema,
  c60112RouteDecisionSchema,
  c60112ShareableSummarySchema,
  correctionDatasetSummarySchema,
  humanCorrectionRecordSchema,
  humanReviewManifestSchema,
  machineReviewAudioManifestSchema,
  machineReviewCandidateBundlesSchema,
  machineReviewItemsSchema,
  machineReviewPrioritySchema,
  machineReviewRegionsSchema,
  reviewAuditRecordSchema,
  reviewDecisionSchema,
  reviewSessionSchema,
} from "../packages/shared/src/c6-0-1-12-review-assistance-schemas.js";
import { buildC60112ReviewPolicy } from "../packages/video-subtitler/src/review/c60112-policy.js";
import { buildC60112ReviewCandidateBundles } from "../packages/video-subtitler/src/review/review-candidate-bundle.js";
import { buildC60112ReviewItems } from "../packages/video-subtitler/src/review/review-item-builder.js";
import { buildC60112ReviewPackageFreeze } from "../packages/video-subtitler/src/review/review-package-freeze.js";
import { buildC60112ReviewPriority } from "../packages/video-subtitler/src/review/review-priority.js";
import { clusterC60112ReviewRegions } from "../packages/video-subtitler/src/review/review-region-clustering.js";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T12:00:00.000Z";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const artifactHeader = {
  schemaVersion: "1.0.0",
  policyVersion: c60112PolicyVersion,
  generatedAt: GENERATED_AT,
};

const deterministicArtifactHeader = {
  schemaVersion: "1.0.0",
  policyVersion: c60112PolicyVersion,
};

const sourceMediaIdentity = {
  sourceMediaSha256: HASH,
  durationSeconds: 120,
};

const machineDraftIdentity = {
  subtitlePackageSha256: HASH,
  canonicalCueHash: HASH,
  canonicalTextHash: HASH,
  canonicalTimingHash: HASH,
  cueCount: 1,
};

function reviewItem() {
  return {
    reviewItemId: "review-item-1",
    eventIds: ["event-1"],
    finalCueIds: ["cue-1"],
    itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
    sourceInterval: { start: 1, end: 2 },
    coreInterval: { start: 1.1, end: 1.9 },
    currentText: "現在字幕",
    candidateIds: ["candidate-current", "candidate-reazon"],
    evidenceIds: ["evidence-1"],
    reviewReasons: ["WHISPER_REAZON_LEXICAL_CONFLICT"],
    priorityTier: "HIGH",
    priorityScore: 70,
    requiredLevel: "REQUIRED",
    suggestedActions: ["KEEP_CURRENT", "USE_REAZON", "UNRESOLVED"],
    sceneIds: [],
    speakerGroupIds: [],
    semanticHash: HASH,
  };
}

function reviewDecision(decisionType = "KEEP_CURRENT") {
  return {
    decisionType,
    selectedCandidateId: null,
    manualText: null,
    timing: null,
    newCue: null,
    reviewerNote: null,
    candidateSetHash: HASH,
    evidenceSnapshotHash: HASH,
    decidedAt: GENERATED_AT,
  };
}

function decisionCounts() {
  return {
    KEEP_CURRENT: 0,
    USE_REAZON: 0,
    USE_WHISPER_ALTERNATE: 0,
    MANUAL_EDIT: 0,
    TIMING_EDIT: 0,
    ADD_NEW_CUE: 0,
    MARK_FALSE_POSITIVE: 0,
    UNRESOLVED: 0,
    WAIVE_REVIEW: 0,
  };
}

const REVIEW_BUDGETS = [
  "TOP_10_PERCENT",
  "TOP_20_PERCENT",
  "TOP_30_PERCENT",
  "TOP_40_PERCENT",
  "TOP_50_PERCENT",
  "ALL_REQUIRED",
] as const;

function budgetMetrics(budget: (typeof REVIEW_BUDGETS)[number]) {
  return {
    budget,
    selectedReviewItemCount: 1,
    selectedRegionCount: 1,
    selectedAudioSeconds: 4,
    coveredUniqueErrors: {
      materialText: 1,
      severeTiming: 0,
      hallucination: 0,
      missingDialogue: 0,
      overlap: 0,
    },
    materialRecall: 1,
    severeTimingRecall: 0,
    hallucinationRecall: 0,
    missingDialogueRecall: 0,
    reviewItemPrecision: 1,
    regionErrorRecall: 1,
    unreviewedResidualErrorRate: 0,
    residualExactCer: 0,
    residualNormalizedCer: 0,
    residualMaterialErrors: 0,
    residualSevereTiming: 0,
    residualMissing: 0,
    residualHallucination: 0,
  };
}

function allBudgetMetrics() {
  return REVIEW_BUDGETS.map((budget) => budgetMetrics(budget));
}

function allArtifacts() {
  const items = {
    ...deterministicArtifactHeader,
    artifactType: "c6-0-1-12-machine-review-items",
    policyHash: HASH,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS",
    runtimeGoldInputCount: 0,
    items: [reviewItem()],
    summary: {
      itemCount: 1,
      signalCount: 1,
      orphanItemCount: 0,
      multiLabelItemCount: 0,
      requiredItemCount: 1,
    },
    semanticHash: HASH,
  };
  const priority = {
    ...deterministicArtifactHeader,
    artifactType: "c6-0-1-12-machine-review-priority",
    policyHash: HASH,
    entries: [
      {
        reviewItemId: "review-item-1",
        sourceStart: 1,
        itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
        reviewReasons: ["WHISPER_REAZON_LEXICAL_CONFLICT"],
        priorityTier: "HIGH",
        priorityScore: 70,
        requiredLevel: "REQUIRED",
        scoreComponents: {
          taxonomyRisk: 70,
          multiLabelBoost: 0,
          compoundRiskBoost: 0,
          evidenceBreadthBoost: 0,
        },
        explanationCodes: ["TAXONOMY_MAX_70"],
        semanticHash: HASH,
      },
    ],
    semanticHash: HASH,
  };
  const regions = {
    ...deterministicArtifactHeader,
    artifactType: "c6-0-1-12-machine-review-regions",
    policyHash: HASH,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS",
    runtimeGoldInputCount: 0,
    regions: [
      {
        regionId: "region-1",
        reviewItemIds: ["review-item-1"],
        eventIds: ["event-1"],
        finalCueIds: ["cue-1"],
        contextStart: 0,
        contextEnd: 4,
        coreIntervals: [
          { reviewItemId: "review-item-1", start: 1.1, end: 1.9 },
        ],
        maxPriority: { tier: "HIGH", score: 70 },
        aggregateReasons: ["WHISPER_REAZON_LEXICAL_CONFLICT"],
        itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
        requiredLevel: "REQUIRED",
        sceneIds: [],
        speakerGroupIds: [],
        semanticHash: HASH,
      },
    ],
    summary: {
      regionCount: 1,
      itemCount: 1,
      mergedItemCount: 0,
      requiredRegionCount: 1,
      totalContextAudioSeconds: 4,
    },
    semanticHash: HASH,
  };
  const candidates = {
    ...deterministicArtifactHeader,
    artifactType: "c6-0-1-12-machine-review-candidate-bundles",
    policyHash: HASH,
    runtimeGoldInputCount: 0,
    bundles: [
      {
        reviewItemId: "review-item-1",
        displayCandidates: [
          {
            displayCandidateId: "candidate-current",
            displayText: "現在字幕",
            normalizedTextHash: HASH,
            labels: ["CURRENT", "WHISPER"],
            evidenceBadges: ["STABLE"],
            provenance: [
              {
                candidateId: "raw-current",
                label: "CURRENT",
                sourceInterval: { start: 1, end: 2 },
                evidenceIds: ["evidence-1"],
                provenanceIds: ["final-cue:cue-1"],
                evidenceBadges: ["STABLE"],
              },
            ],
            semanticHash: HASH,
          },
        ],
        missingCandidateIds: [],
        availableActions: ["KEEP_CURRENT", "MANUAL_EDIT", "UNRESOLVED"],
        selectionAuthority: "HUMAN_ONLY",
        calibratedConfidencePercentageDisplayed: false,
        semanticHash: HASH,
      },
    ],
    summary: {
      reviewItemCount: 1,
      displayCandidateCount: 1,
      collapsedDuplicateCount: 0,
      missingCandidateReferenceCount: 0,
      candidateActionableItemCount: 0,
    },
    semanticHash: HASH,
  };
  const audio = {
    ...artifactHeader,
    artifactType: "c6-0-1-12-review-audio-manifest",
    sourceMediaSha256: HASH,
    extractionPolicy:
      "region-core-plus-two-second-context-pcm-s16le-16khz-mono-v1",
    ffmpegIdentity: "ffmpeg version fixture",
    clips: [
      {
        regionId: "region-1",
        itemIds: ["review-item-1"],
        relativePath: "audio/region-1.wav",
        requestedInterval: { start: 0, end: 4 },
        extractedInterval: { start: 0, end: 4 },
        coreInterval: { start: 1.1, end: 1.9 },
        coreOffsetSeconds: 1.1,
        coreDurationSeconds: 0.8,
        actualDurationSeconds: 4,
        sampleRate: 16000,
        channelCount: 1,
        bitsPerSample: 16,
        frameCount: 64000,
        sha256: HASH,
        playable: true,
        sourceMediaSha256: HASH,
      },
    ],
    summary: {
      regionCount: 1,
      generatedCount: 1,
      playableCount: 1,
      failedCount: 0,
      totalAudioSeconds: 4,
      asrInferenceCount: 0,
      networkUsed: false,
    },
    semanticHash: HASH,
  };
  const freeze = {
    ...deterministicArtifactHeader,
    artifactType: "c6-0-1-12-review-package-freeze",
    frozenAt: GENERATED_AT,
    sourceMediaSha256: HASH,
    machineDraftHash: HASH,
    itemHash: HASH,
    priorityHash: HASH,
    regionHash: HASH,
    candidateHash: HASH,
    audioManifestHash: HASH,
    workspaceDataHash: HASH,
    policyHash: HASH,
    aggregateHash: HASH,
    runtimeGoldInputCount: 0,
    goldAccessBeforeFreezeCount: 0,
    frozenBeforeGoldEvaluation: true,
    semanticHash: HASH,
  };
  const session = {
    schemaVersion: "1.0.0",
    sessionId: "session-1",
    sourceMediaIdentity,
    machineDraftIdentity,
    machineDraftHash: HASH,
    reviewPolicyVersion: c60112PolicyVersion,
    reviewPackageSemanticHash: HASH,
    createdAt: GENERATED_AT,
    updatedAt: GENERATED_AT,
    itemStates: {},
    regionStates: {
      "region-1": {
        requiredItemCount: 1,
        completedRequiredCount: 0,
        unresolvedRequiredCount: 1,
        complete: false,
      },
    },
    completedRequiredCount: 0,
    unresolvedRequiredCount: 1,
    reviewComplete: false,
  };
  const audit = {
    schemaVersion: "1.0.0",
    auditId: "audit-1",
    operation: "DECISION",
    timestamp: GENERATED_AT,
    sessionId: "session-1",
    reviewItemId: "review-item-1",
    previousDecision: null,
    newDecision: "correction-1",
    undoneRecordId: null,
    beforeHash: HASH,
    afterHash: OTHER_HASH,
  };
  const correction = {
    schemaVersion: "1.0.0",
    recordId: "correction-1",
    decisionId: "decision-1",
    sessionId: "session-1",
    reviewItemId: "review-item-1",
    regionId: "region-1",
    eventIds: ["event-1"],
    cueIds: ["cue-1"],
    sourceInterval: { start: 1, end: 2 },
    machineDraftHash: HASH,
    evidenceSnapshotHash: HASH,
    candidateSetHash: HASH,
    decisionType: "KEEP_CURRENT",
    selectedCandidateId: null,
    beforeText: "現在字幕",
    afterText: "現在字幕",
    beforeStart: 1,
    beforeEnd: 2,
    afterStart: 1,
    afterEnd: 2,
    itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
    priorityAtDecision: {
      tier: "HIGH",
      score: 70,
      requiredLevel: "REQUIRED",
    },
    reviewerNote: null,
    createdAt: GENERATED_AT,
  };
  const manifest = {
    ...artifactHeader,
    artifactType: "human-review-manifest",
    sessionId: "session-1",
    machineDraftHash: HASH,
    reviewSessionHash: HASH,
    correctionLogHash: HASH,
    reviewedSubtitlePackageHash: HASH,
    reviewedAssHash: HASH,
    reviewedSrtHash: HASH,
    reviewedVttHash: HASH,
    textChangedCueCount: 0,
    timingChangedCueCount: 0,
    newCueCount: 0,
    decisionCounts: { ...decisionCounts(), KEEP_CURRENT: 1 },
    unresolvedCount: 0,
    strictSubtitlePackageValidated: true,
    machineOnlyReleaseAuthorized: false,
    semanticHash: HASH,
  };
  const dataset = {
    ...artifactHeader,
    artifactType: "correction-dataset-summary",
    locality: "LOCAL_ONLY",
    shareable: false,
    sourceCorrectionLogHash: HASH,
    sourceReviewSessionHash: HASH,
    sourceAuditLogHash: HASH,
    sourceReviewDataHash: HASH,
    reviewPackageFreezeHash: HASH,
    lifecycleAuditHash: HASH,
    datasetJsonlHash: HASH,
    sourceRecordCount: 1,
    activeRecordCount: 1,
    undoneRecordCount: 0,
    supersededRecordCount: 0,
    orphanRecordCount: 0,
    recordCount: 1,
    uniqueSessionCount: 1,
    uniqueReviewItemCount: 1,
    decisionCounts: { ...decisionCounts(), KEEP_CURRENT: 1 },
    containsFullDialogueText: true,
    trainingPerformed: false,
    semanticHash: HASH,
  };
  const quality = {
    ...artifactHeader,
    artifactType: "c6-0-1-12-review-quality-evaluation",
    reviewPackageFreezeHash: HASH,
    reviewPackageFreezeVerifiedBeforeGoldRead: true,
    reviewPackageFrozenBeforeGoldRead: true,
    machineReviewBuildGoldInputCount: 0,
    evaluatorGoldInputCount: 1,
    goldReadAfterFreeze: true,
    sourceSha256Before: HASH,
    sourceSha256After: HASH,
    goldSha256Before: OTHER_HASH,
    goldSha256After: OTHER_HASH,
    goldEvaluationArtifactSha256: HASH,
    machineDraftHash: HASH,
    machineFinalMutated: false,
    idealSimulationMethod:
      "GLOBAL_TEXT_RECOMPUTATION_WITH_SELECTED_GOLD_ALIGNMENTS",
    rankingInputHashes: {
      oldSingleAsrRiskArtifactSha256: HASH,
    },
    overlapEvaluation: {
      status: "UNEVALUABLE_GLOBAL_ONLY",
      machineOverlapCount: 37,
      goldOverlapCount: 9,
      reason: "Only global overlap counts are available.",
    },
    uniqueErrorCounts: {
      materialText: 1,
      severeTiming: 0,
      hallucination: 0,
      missingDialogue: 0,
      overlap: 0,
    },
    errorComponents: [
      {
        errorComponentId: "error-1",
        labels: ["MATERIAL_TEXT_ERROR"],
        coveredReviewItemIds: ["review-item-1"],
        coveredRegionIds: ["region-1"],
        semanticHash: HASH,
      },
    ],
    itemLabels: [
      {
        reviewItemId: "review-item-1",
        labels: ["MATERIAL_TEXT_ERROR"],
        errorComponentIds: ["error-1"],
      },
    ],
    budgetMetrics: allBudgetMetrics(),
    rankingBaselines: [
      "R0_CHRONOLOGICAL",
      "R1_OLD_SINGLE_ASR_RISK",
      "R2_CROSS_MODEL_DISAGREEMENT_ONLY",
      "R3_FULL_EVIDENCE_RANK",
    ].map((baseline) => ({
      baseline,
      budgetMetrics: allBudgetMetrics(),
      audioMatchedBudgetMetrics: allBudgetMetrics(),
      utilityScore: 1,
    })),
    rankingResult: "REVIEW_PRIORITY_EFFECTIVE",
    candidateFixability: [
      {
        reviewItemId: "review-item-1",
        errorComponentIds: ["error-1"],
        classification: "REAZON_FIXABLE",
        fullFixCandidateIds: ["candidate-reazon"],
        partialFixCandidateIds: [],
        semanticHash: HASH,
      },
    ],
    materialErrorFixability: [
      {
        errorComponentId: "error-1",
        reviewItemIds: ["review-item-1"],
        classification: "REAZON_FIXABLE",
        fullFixCandidateIds: ["candidate-reazon"],
        partialFixCandidateIds: [],
        semanticHash: HASH,
      },
    ],
    candidateFixabilitySummary: {
      materialErrorCount: 1,
      candidateFixableMaterialErrorCount: 1,
      candidateFixRate: 1,
      whisperAlternateFixableCount: 0,
      reazonFixableCount: 1,
      bothCandidateFixableCount: 0,
      partialFixCount: 0,
      manualEditRequiredCount: 0,
      manualEditRate: 0,
      unevaluableCount: 0,
    },
    specialErrorRanks: [],
    burden: {
      totalReviewItems: 1,
      requiredItems: 1,
      totalReviewRegions: 1,
      requiredRegions: 1,
      totalReviewAudioSeconds: 4,
      requiredReviewAudioSeconds: 4,
      reviewAudioEpisodeRatio: 4 / 120,
      candidateActionableItems: 1,
      manualEditLikelyItems: 0,
      humanReviewTimeStatus: "NOT_MEASURED_IN_C6_0_1_12",
    },
    containsFullGoldText: false,
    semanticHash: HASH,
  };
  const ideal = {
    ...artifactHeader,
    artifactType: "c6-0-1-12-ideal-review-upper-bound",
    simulationType: "IDEAL_REVIEWER_SIMULATION",
    simulationMethod: "GLOBAL_TEXT_RECOMPUTATION_WITH_SELECTED_GOLD_ALIGNMENTS",
    reviewPackageFreezeHash: HASH,
    qualityEvaluationHash: HASH,
    reviewPackageFreezeVerifiedBeforeGoldRead: true,
    evaluatorGoldInputCount: 1,
    budgetResults: REVIEW_BUDGETS.map((budget) => ({
      budget,
      selectedReviewItems: 1,
      selectedRegions: 1,
      audioSeconds: 4,
      residualExactCer: 0,
      residualNormalizedCer: 0,
      residualMaterialErrors: 0,
      residualSevereTiming: 0,
      residualMissing: 0,
      residualHallucination: 0,
    })),
    humanReviewSessionCreated: false,
    humanCorrectionLogCreated: false,
    humanReviewedProductionOutputCreated: false,
    machineFinalMutated: false,
    semanticHash: HASH,
  };
  const validation = {
    ...artifactHeader,
    artifactType: "c6-0-1-12-review-assistance-validation",
    validationVersion: "c6.0.1.12-review-assistance-validation-v2",
    inputArtifactHashes: { baseline: HASH },
    outputArtifactHashes: { freeze: HASH },
    checks: [
      {
        checkId: "freeze-before-gold",
        status: "PASSED",
        evidenceHashes: [HASH],
        detail: "Review package was frozen before Gold evaluation.",
      },
    ],
    machineFinalParity: {
      canonicalTextParity: true,
      canonicalTimingParity: true,
      assParity: true,
      srtParity: true,
      vttParity: true,
      textMutationCount: 0,
      timingMutationCount: 0,
    },
    goldIsolation: {
      reviewPackageFrozenBeforeGold: true,
      machineReviewBuildGoldInputCount: 0,
      workspaceGoldInputCount: 0,
      syntheticWorkflowGoldInputCount: 0,
      evaluatorGoldInputCount: 1,
    },
    reviewWorkspaceOffline: true,
    reviewWorkspaceLocalOnly: true,
    reviewAudioLocalOnly: true,
    realCarnationHumanSessionCreated: false,
    sourceReadOnlyVerified: true,
    goldReadOnlyVerified: true,
    networkUsed: false,
    shareableAuditPassed: true,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    c602Status: "HOLD",
    regressions: [{ suite: "C6.0.1.11", status: "PASSED" }],
    passed: true,
    semanticHash: HASH,
  };
  const route = {
    ...artifactHeader,
    artifactType: "c6-0-1-12-route-decision",
    route: "HUMAN_ON_EXCEPTION",
    nextStage: "REAL_HUMAN_TRIAL_ON_UNSEEN_EPISODE",
    result: "REVIEW_ASSISTANCE_PRODUCT_READY_FOR_REAL_HUMAN_TRIAL",
    engineeringComplete: true,
    rankingEffective: true,
    realHumanTrialAuthorized: true,
    workloadReductionClaimAllowed: true,
    automaticProviderSwitching: false,
    carnationHumanSessionCreated: false,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    c602Status: "HOLD",
    reasons: ["Workflow and Gold barrier passed."],
    semanticHash: HASH,
  };
  const shareable = {
    ...artifactHeader,
    artifactType: "c6-0-1-12-shareable-summary",
    shareable: true,
    reviewPackageFreezeHash: HASH,
    reviewQualityEvaluationHash: HASH,
    routeDecisionHash: HASH,
    counts: {
      reviewItems: 1,
      reviewRegions: 1,
      requiredItems: 1,
      requiredRegions: 1,
      candidateActionableItems: 1,
      correctionRecords: 0,
    },
    decisionCounts: decisionCounts(),
    qualityMetrics: {
      rankingResult: "REVIEW_PRIORITY_EFFECTIVE",
      candidateFixRate: 1,
      manualEditRate: 0,
      materialRecallAt10: 1,
      materialRecallAt50: 1,
    },
    localReviewAudioIncluded: false,
    localReviewWorkspaceIncluded: false,
    localCorrectionDatasetIncluded: false,
    containsRawAudio: false,
    containsFullDialogueText: false,
    containsFullGoldText: false,
    containsAbsolutePaths: false,
    secretCount: 0,
    brokenRelativeReferenceCount: 0,
    semanticHash: HASH,
  };

  return [
    [machineReviewItemsSchema, items],
    [machineReviewPrioritySchema, priority],
    [machineReviewRegionsSchema, regions],
    [machineReviewCandidateBundlesSchema, candidates],
    [machineReviewAudioManifestSchema, audio],
    [c60112ReviewPackageFreezeSchema, freeze],
    [reviewSessionSchema, session],
    [reviewAuditRecordSchema, audit],
    [humanCorrectionRecordSchema, correction],
    [humanReviewManifestSchema, manifest],
    [correctionDatasetSummarySchema, dataset],
    [c60112ReviewQualityEvaluationSchema, quality],
    [c60112IdealReviewUpperBoundSchema, ideal],
    [c60112ReviewAssistanceValidationSchema, validation],
    [c60112RouteDecisionSchema, route],
    [c60112ShareableSummarySchema, shareable],
  ] as const;
}

describe("C6.0.1.12 strict review-assistance schemas", () => {
  it("parses the real deterministic machine review builders", () => {
    const policy = buildC60112ReviewPolicy({
      policyFrozenAt: GENERATED_AT,
    });
    const items = buildC60112ReviewItems({
      policy,
      signals: [
        {
          eventIds: ["event-1"],
          finalCueIds: ["cue-1"],
          itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
          sourceInterval: { start: 1, end: 2 },
          coreInterval: { start: 1.1, end: 1.9 },
          currentText: "現在字幕",
          candidateIds: ["reazon-1"],
          evidenceIds: ["evidence-1"],
          reviewReasons: ["WHISPER_REAZON_LEXICAL_CONFLICT"],
        },
      ],
    });
    const priority = buildC60112ReviewPriority({
      items: items.items,
      policy,
    });
    const regions = clusterC60112ReviewRegions({
      items: items.items,
      policy,
      sourceDurationSeconds: 120,
    });
    const candidates = buildC60112ReviewCandidateBundles({
      items: items.items,
      policy,
      candidates: [
        {
          candidateId: "reazon-1",
          label: "REAZON",
          displayText: "候補字幕",
          sourceInterval: { start: 1.1, end: 1.9 },
          evidenceIds: ["evidence-1"],
          provenanceIds: ["event-1"],
          evidenceBadges: ["STABLE"],
        },
      ],
    });
    const freeze = buildC60112ReviewPackageFreeze({
      frozenAt: GENERATED_AT,
      sourceMediaSha256: HASH,
      machineDraftHash: OTHER_HASH,
      policy,
      items,
      priority,
      regions,
      candidates,
      audioManifest: { semanticHash: HASH },
      workspaceData: { semanticHash: OTHER_HASH },
    });
    expect(machineReviewItemsSchema.safeParse(items).success).toBe(true);
    expect(machineReviewPrioritySchema.safeParse(priority).success).toBe(true);
    expect(machineReviewRegionsSchema.safeParse(regions).success).toBe(true);
    expect(
      machineReviewCandidateBundlesSchema.safeParse(candidates).success,
    ).toBe(true);
    expect(c60112ReviewPackageFreezeSchema.safeParse(freeze).success).toBe(
      true,
    );
  });

  it("pins the v2 policy and rejects unknown top-level fields", () => {
    expect(c60112PolicyVersion).toBe(
      "c6.0.1.12-multi-asr-review-assistance-v2",
    );
    for (const [schema, artifact] of allArtifacts()) {
      expect(schema.safeParse(artifact).success).toBe(true);
      expect(
        schema.safeParse({ ...artifact, unexpectedGoldHint: true }).success,
      ).toBe(false);
    }
  });

  it("keeps every contract JSON-Schema-generatable", () => {
    for (const [schema] of allArtifacts()) {
      expect(() =>
        z.toJSONSchema(schema, {
          target: "draft-2020-12",
          unrepresentable: "any",
        }),
      ).not.toThrow();
    }
  });

  it("supports cue-less missing-dialogue items but rejects cue-less normal items", () => {
    const base = allArtifacts()[0][1];
    const missingItem = {
      ...reviewItem(),
      finalCueIds: [],
      currentText: null,
      itemTypes: ["MISSING_SPEECH_RISK"],
      reviewReasons: ["MISSING_DIALOGUE_SUSPECTED"],
      suggestedActions: ["ADD_NEW_CUE", "MARK_FALSE_POSITIVE", "UNRESOLVED"],
    };
    expect(
      machineReviewItemsSchema.safeParse({
        ...base,
        items: [missingItem],
      }).success,
    ).toBe(true);
    expect(
      machineReviewItemsSchema.safeParse({
        ...base,
        items: [{ ...reviewItem(), finalCueIds: [] }],
      }).success,
    ).toBe(false);
    expect(
      machineReviewItemsSchema.safeParse({
        ...base,
        items: [
          {
            ...missingItem,
            suggestedActions: ["MARK_FALSE_POSITIVE", "UNRESOLVED"],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("binds action-specific decision payloads and explicit waivers", () => {
    expect(reviewDecisionSchema.safeParse(reviewDecision()).success).toBe(true);
    expect(
      reviewDecisionSchema.safeParse({
        ...reviewDecision("USE_REAZON"),
        selectedCandidateId: null,
      }).success,
    ).toBe(false);
    expect(
      reviewDecisionSchema.safeParse({
        ...reviewDecision("USE_WHISPER_ALTERNATE"),
        selectedCandidateId: "candidate-whisper-alt",
      }).success,
    ).toBe(true);
    expect(
      reviewDecisionSchema.safeParse(reviewDecision("WAIVE_REVIEW")).success,
    ).toBe(false);
    expect(
      reviewDecisionSchema.safeParse({
        ...reviewDecision("WAIVE_REVIEW"),
        reviewerNote: "Reviewer explicitly accepts this residual risk.",
      }).success,
    ).toBe(true);
  });

  it("does not count UNRESOLVED as REQUIRED completion", () => {
    const base = allArtifacts()[6][1];
    const unresolved = {
      ...base,
      itemStates: {
        "review-item-1": {
          recordId: "correction-unresolved",
          decisionId: "decision-unresolved",
          decisionType: "UNRESOLVED",
          selectedCandidateId: null,
          afterText: "現在字幕",
          afterStart: 1,
          afterEnd: 2,
          reviewerNote: null,
          updatedAt: GENERATED_AT,
        },
      },
    };
    expect(reviewSessionSchema.safeParse(unresolved).success).toBe(true);
    expect(
      reviewSessionSchema.safeParse({
        ...unresolved,
        completedRequiredCount: 1,
        unresolvedRequiredCount: 0,
        reviewComplete: true,
      }).success,
    ).toBe(false);

    const waived = {
      ...base,
      itemStates: {
        "review-item-1": {
          recordId: "correction-waived",
          decisionId: "decision-waived",
          decisionType: "WAIVE_REVIEW",
          selectedCandidateId: null,
          afterText: "現在字幕",
          afterStart: 1,
          afterEnd: 2,
          reviewerNote: "Explicitly waived after listening.",
          updatedAt: GENERATED_AT,
        },
      },
      regionStates: {
        "region-1": {
          requiredItemCount: 1,
          completedRequiredCount: 1,
          unresolvedRequiredCount: 0,
          complete: true,
        },
      },
      completedRequiredCount: 1,
      unresolvedRequiredCount: 0,
      reviewComplete: true,
    };
    expect(reviewSessionSchema.safeParse(waived).success).toBe(true);
  });

  it("rejects unsafe audio paths and incomplete available-audio records", () => {
    const base = allArtifacts()[4][1];
    expect(
      machineReviewAudioManifestSchema.safeParse({
        ...base,
        clips: [
          {
            ...base.clips[0],
            relativePath: "../../private.wav",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      machineReviewAudioManifestSchema.safeParse({
        ...base,
        clips: [
          {
            ...base.clips[0],
            sha256: null,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("enforces freeze-before-Gold, unique error identities, and read-only inputs", () => {
    const quality = allArtifacts()[11][1];
    expect(
      c60112ReviewQualityEvaluationSchema.safeParse({
        ...quality,
        goldReadAfterFreeze: false,
      }).success,
    ).toBe(false);
    expect(
      c60112ReviewQualityEvaluationSchema.safeParse({
        ...quality,
        sourceSha256After: OTHER_HASH,
      }).success,
    ).toBe(false);
    expect(
      c60112ReviewQualityEvaluationSchema.safeParse({
        ...quality,
        errorComponents: [
          quality.errorComponents[0],
          quality.errorComponents[0],
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps simulated review, machine production, and shareable data boundaries explicit", () => {
    const ideal = allArtifacts()[12][1];
    expect(
      c60112IdealReviewUpperBoundSchema.safeParse({
        ...ideal,
        humanReviewSessionCreated: true,
      }).success,
    ).toBe(false);

    const route = allArtifacts()[14][1];
    expect(
      c60112RouteDecisionSchema.safeParse({
        ...route,
        machineOnlyReleaseAuthorized: true,
      }).success,
    ).toBe(false);

    const shareable = allArtifacts()[15][1];
    expect(
      c60112ShareableSummarySchema.safeParse({
        ...shareable,
        containsFullDialogueText: true,
      }).success,
    ).toBe(false);
    expect(
      c60112ShareableSummarySchema.safeParse({
        ...shareable,
        absolutePrivatePath: "/Users/example/review-audio.wav",
      }).success,
    ).toBe(false);
  });
});
