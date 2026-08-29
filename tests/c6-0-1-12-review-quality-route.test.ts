import type { SubtitleCue } from "@mvl/shared";
import { describe, expect, it } from "vitest";

import {
  assertC60112NoGoldDialogueLeak,
  evaluateC60112ReviewQuality,
  type C60112EvaluableReviewItem,
  type C60112GoldEvaluationInput,
  type C60112ReviewQualityEvaluation,
} from "../packages/video-subtitler/src/review/c60112-review-quality-evaluator.js";
import { decideC60112Route } from "../packages/video-subtitler/src/review/c60112-route-decision.js";

const GENERATED_AT = "2026-08-29T12:00:00.000Z";
const SHA = "a".repeat(64);
const BUDGETS = [
  "TOP_10_PERCENT",
  "TOP_20_PERCENT",
  "TOP_30_PERCENT",
  "TOP_40_PERCENT",
  "TOP_50_PERCENT",
  "ALL_REQUIRED",
] as const;
const RANKINGS = [
  "R0_CHRONOLOGICAL",
  "R1_OLD_SINGLE_ASR_RISK",
  "R2_CROSS_MODEL_DISAGREEMENT_ONLY",
  "R3_FULL_EVIDENCE_RANK",
] as const;

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
): SubtitleCue {
  return {
    id,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    text,
    speaker: null,
    confidence: 0.9,
  };
}

function item(
  overrides: Partial<C60112EvaluableReviewItem> = {},
): C60112EvaluableReviewItem {
  return {
    itemId: "item-1",
    interval: { start: 0, end: 2 },
    targetCueIds: ["cue-1"],
    labels: ["TEXT_LOW_ACOUSTIC_SUPPORT"],
    priorityScore: 0.9,
    chronologicalIndex: 0,
    regionId: "region-1",
    audioDurationSeconds: 2,
    currentText: "x",
    candidateTexts: [],
    singleAsrRiskScore: 0.5,
    crossModelDisagreement: false,
    required: true,
    ...overrides,
  };
}

function evaluate(input: {
  baseCues: readonly SubtitleCue[];
  goldCues: readonly { start: number; end: number; text: string }[];
  items: readonly C60112EvaluableReviewItem[];
  goldEvaluation: C60112GoldEvaluationInput;
}): C60112ReviewQualityEvaluation {
  return evaluateC60112ReviewQuality({
    generatedAt: GENERATED_AT,
    reviewPackageFreezeHash: SHA,
    sourceMediaSha256: SHA,
    goldSha256: SHA,
    oldSingleAsrRiskArtifactSha256: SHA,
    episodeDurationSeconds: 120,
    ...input,
  });
}

function oneCueEvaluation(input?: {
  candidates?: C60112EvaluableReviewItem["candidateTexts"];
  overlapComparisons?: C60112GoldEvaluationInput["overlapComparisons"];
  targetCueIds?: string[];
}): C60112ReviewQualityEvaluation {
  return evaluate({
    baseCues: [cue("cue-1", "x", 0, 2)],
    goldCues: [{ start: 0, end: 2, text: "a" }],
    items: [
      item({
        candidateTexts: input?.candidates ?? [],
        targetCueIds: input?.targetCueIds ?? ["cue-1"],
      }),
    ],
    goldEvaluation: {
      alignments: [
        {
          alignmentId: "alignment-1",
          machineCueIndexes: [0],
          goldCueIndexes: [0],
          machineExcerpt: "x",
          goldExcerpt: "a",
          machineStart: 0,
          machineEnd: 2,
          goldStart: 0,
          goldEnd: 2,
        },
      ],
      missingDialogueCandidates: [],
      hallucinationCandidates: [],
      materialTextErrors: [
        {
          defectId: "material-1",
          code: "MATERIAL_TEXT_ERROR",
          severity: "material",
          alignmentIds: ["alignment-1"],
        },
      ],
      severeTimingErrors: [],
      overlapComparisons: input?.overlapComparisons ?? [],
      globalTextMetrics: {
        exact: { editDistance: 1, goldCharacterCount: 1, cer: 1 },
        normalized: { editDistance: 1, goldCharacterCount: 1, cer: 1 },
      },
      coverageMetrics: { goldTextCoverageRatio: 1 },
    },
  });
}

function routeInput(
  quality: C60112ReviewQualityEvaluation,
  overrides: Partial<Parameters<typeof decideC60112Route>[0]> = {},
): Parameters<typeof decideC60112Route>[0] {
  return {
    generatedAt: GENERATED_AT,
    quality,
    machineBuildGoldInputCount: 0,
    freezePassed: true,
    audioPlayableCount: 1,
    audioRegionCount: 1,
    reviewItemCount: 1,
    candidateBundleCount: 1,
    candidateActionableItemCount: 1,
    missingCandidateReferenceCount: 0,
    workspaceOfflinePassed: true,
    syntheticWorkflowPassed: true,
    validationPassed: true,
    ...overrides,
  };
}

describe("C6.0.1.12 Gold-isolated review quality evaluation", () => {
  it("rejects content-derived Gold dialogue even when identity hashes are absent", () => {
    expect(() =>
      assertC60112NoGoldDialogueLeak({
        syntheticTexts: ["{\\an8}これはゴールド由来の長い字幕です。"],
        goldTexts: ["これはゴールド由来の長い字幕です"],
      }),
    ).toThrow(/GOLD_DIALOGUE_TEXT/u);
    expect(() =>
      assertC60112NoGoldDialogueLeak({
        syntheticTexts: ["完全に独立した合成会話です"],
        goldTexts: ["これはゴールド由来の長い字幕です"],
      }),
    ).not.toThrow();
  });

  it("associates Gold components through final-cue lineage, not arbitrary time overlap", () => {
    const quality = evaluate({
      baseCues: [cue("cue-a", "x", 0, 2), cue("cue-b", "y", 0.5, 2.5)],
      goldCues: [
        { start: 0, end: 2, text: "a" },
        { start: 0.5, end: 2.5, text: "b" },
      ],
      items: [
        item({
          interval: { start: 0, end: 3 },
          targetCueIds: ["cue-a"],
          currentText: "x",
        }),
      ],
      goldEvaluation: {
        alignments: [
          {
            alignmentId: "alignment-a",
            machineCueIndexes: [0],
            goldCueIndexes: [0],
            machineExcerpt: "x",
            goldExcerpt: "a",
            machineStart: 0,
            machineEnd: 2,
            goldStart: 0,
            goldEnd: 2,
          },
          {
            alignmentId: "alignment-b",
            machineCueIndexes: [1],
            goldCueIndexes: [1],
            machineExcerpt: "y",
            goldExcerpt: "b",
            machineStart: 0.5,
            machineEnd: 2.5,
            goldStart: 0.5,
            goldEnd: 2.5,
          },
        ],
        missingDialogueCandidates: [],
        hallucinationCandidates: [],
        materialTextErrors: [
          {
            defectId: "material-a",
            code: "MATERIAL_TEXT_ERROR",
            severity: "material",
            alignmentIds: ["alignment-a"],
          },
          {
            defectId: "material-b",
            code: "MATERIAL_TEXT_ERROR",
            severity: "material",
            alignmentIds: ["alignment-b"],
          },
        ],
        severeTimingErrors: [],
        overlapComparisons: [],
        globalTextMetrics: {
          exact: { editDistance: 2, goldCharacterCount: 2, cer: 1 },
          normalized: { editDistance: 2, goldCharacterCount: 2, cer: 1 },
        },
        coverageMetrics: { goldTextCoverageRatio: 1 },
      },
    });

    expect(quality.itemLabels).toEqual([
      {
        reviewItemId: "item-1",
        labels: ["MATERIAL_TEXT_ERROR"],
        errorComponentIds: ["material-a"],
      },
    ]);
    expect(
      quality.errorComponents.find(
        (component) => component.errorComponentId === "material-b",
      )?.coveredReviewItemIds,
    ).toEqual([]);
  });

  it("fails closed unless an item covers every machine cue in a Gold alignment", () => {
    const baseCues = [cue("cue-a", "x", 0, 1), cue("cue-b", "y", 1, 2)];
    const goldCues = [
      { start: 0, end: 1, text: "a" },
      { start: 1, end: 2, text: "b" },
    ];
    const goldEvaluation: C60112GoldEvaluationInput = {
      alignments: [
        {
          alignmentId: "alignment-multi-cue",
          machineCueIndexes: [0, 1],
          goldCueIndexes: [0, 1],
          machineExcerpt: "xy",
          goldExcerpt: "ab",
          machineStart: 0,
          machineEnd: 2,
          goldStart: 0,
          goldEnd: 2,
        },
      ],
      missingDialogueCandidates: [],
      hallucinationCandidates: [],
      materialTextErrors: [
        {
          defectId: "material-multi-cue",
          code: "MATERIAL_TEXT_ERROR",
          severity: "material",
          alignmentIds: ["alignment-multi-cue"],
        },
      ],
      severeTimingErrors: [],
      overlapComparisons: [],
      globalTextMetrics: {
        exact: { editDistance: 2, goldCharacterCount: 2, cer: 1 },
        normalized: { editDistance: 2, goldCharacterCount: 2, cer: 1 },
      },
      coverageMetrics: { goldTextCoverageRatio: 1 },
    };
    const evaluateTargets = (targetCueIds: string[]) =>
      evaluate({
        baseCues,
        goldCues,
        items: [
          item({
            interval: { start: 0, end: 2 },
            targetCueIds,
            currentText: targetCueIds.length === 1 ? "x" : "xy",
          }),
        ],
        goldEvaluation,
      });

    const partial = evaluateTargets(["cue-a"]);
    const complete = evaluateTargets(["cue-a", "cue-b"]);
    const partialAllRequired = partial.budgetMetrics.find(
      (metrics) => metrics.budget === "ALL_REQUIRED",
    );
    const completeAllRequired = complete.budgetMetrics.find(
      (metrics) => metrics.budget === "ALL_REQUIRED",
    );

    expect(partial.itemLabels[0]).toMatchObject({
      labels: ["CLEAN_OR_MINOR"],
      errorComponentIds: [],
    });
    expect(partial.errorComponents[0]?.coveredReviewItemIds).toEqual([]);
    expect(partialAllRequired).toMatchObject({
      materialRecall: 0,
      residualExactCer: 1,
      residualNormalizedCer: 1,
    });
    expect(complete.itemLabels[0]).toMatchObject({
      labels: ["MATERIAL_TEXT_ERROR"],
      errorComponentIds: ["material-multi-cue"],
    });
    expect(complete.errorComponents[0]?.coveredReviewItemIds).toEqual([
      "item-1",
    ]);
    expect(completeAllRequired).toMatchObject({
      materialRecall: 1,
      residualExactCer: 0,
      residualNormalizedCer: 0,
    });
  });

  it("rejects a non-empty target cue lineage that is absent from the machine draft", () => {
    expect(() => oneCueEvaluation({ targetCueIds: ["stale-cue-id"] })).toThrow(
      "REVIEW_ITEM_TARGET_CUE_NOT_FOUND:item-1:stale-cue-id",
    );
  });

  it("uses interval mapping only for a genuinely cue-less missing-dialogue item", () => {
    const quality = evaluate({
      baseCues: [cue("cue-1", "x", 0, 1)],
      goldCues: [
        { start: 0, end: 1, text: "a" },
        { start: 3, end: 4, text: "b" },
      ],
      items: [
        item({
          interval: { start: 2.5, end: 4.5 },
          targetCueIds: [],
          currentText: "",
        }),
      ],
      goldEvaluation: {
        alignments: [
          {
            alignmentId: "alignment-existing",
            machineCueIndexes: [0],
            goldCueIndexes: [0],
            machineExcerpt: "x",
            goldExcerpt: "a",
            machineStart: 0,
            machineEnd: 1,
            goldStart: 0,
            goldEnd: 1,
          },
          {
            alignmentId: "alignment-missing",
            machineCueIndexes: [],
            goldCueIndexes: [1],
            machineExcerpt: "",
            goldExcerpt: "b",
            machineStart: null,
            machineEnd: null,
            goldStart: 3,
            goldEnd: 4,
          },
        ],
        missingDialogueCandidates: [
          {
            defectId: "missing-1",
            code: "MISSING_DIALOGUE_CANDIDATE",
            severity: "material",
            alignmentIds: ["alignment-missing"],
          },
        ],
        hallucinationCandidates: [],
        materialTextErrors: [],
        severeTimingErrors: [],
        overlapComparisons: [],
        globalTextMetrics: {
          exact: { editDistance: 2, goldCharacterCount: 2, cer: 1 },
          normalized: { editDistance: 2, goldCharacterCount: 2, cer: 1 },
        },
        coverageMetrics: { goldTextCoverageRatio: 0.5 },
      },
    });
    const allRequired = quality.budgetMetrics.find(
      (metrics) => metrics.budget === "ALL_REQUIRED",
    );

    expect(quality.itemLabels[0]).toMatchObject({
      labels: ["MISSING_DIALOGUE"],
      errorComponentIds: ["missing-1"],
    });
    expect(allRequired?.missingDialogueRecall).toBe(1);
  });

  it("recomputes residual CER from the corrected global text", () => {
    const quality = evaluate({
      baseCues: [cue("cue-1", "ab", 0, 1), cue("cue-2", "c", 1, 2)],
      goldCues: [
        { start: 0, end: 1, text: "a" },
        { start: 1, end: 2, text: "bc" },
      ],
      items: [item({ interval: { start: 0, end: 1 }, currentText: "ab" })],
      goldEvaluation: {
        alignments: [
          {
            alignmentId: "alignment-1",
            machineCueIndexes: [0],
            goldCueIndexes: [0],
            machineExcerpt: "ab",
            goldExcerpt: "a",
            machineStart: 0,
            machineEnd: 1,
            goldStart: 0,
            goldEnd: 1,
          },
          {
            alignmentId: "alignment-2",
            machineCueIndexes: [1],
            goldCueIndexes: [1],
            machineExcerpt: "c",
            goldExcerpt: "bc",
            machineStart: 1,
            machineEnd: 2,
            goldStart: 1,
            goldEnd: 2,
          },
        ],
        missingDialogueCandidates: [],
        hallucinationCandidates: [],
        materialTextErrors: [
          {
            defectId: "material-1",
            code: "MATERIAL_TEXT_ERROR",
            severity: "material",
            alignmentIds: ["alignment-1"],
          },
        ],
        severeTimingErrors: [],
        overlapComparisons: [],
        globalTextMetrics: {
          exact: { editDistance: 0, goldCharacterCount: 3, cer: 0 },
          normalized: { editDistance: 0, goldCharacterCount: 3, cer: 0 },
        },
        coverageMetrics: { goldTextCoverageRatio: 1 },
      },
    });
    const allRequired = quality.budgetMetrics.find(
      (metrics) => metrics.budget === "ALL_REQUIRED",
    );

    expect(quality.idealSimulationMethod).toBe(
      "GLOBAL_TEXT_RECOMPUTATION_WITH_SELECTED_GOLD_ALIGNMENTS",
    );
    expect(allRequired?.residualExactCer).toBeCloseTo(1 / 3);
    expect(allRequired?.residualNormalizedCer).toBeCloseTo(1 / 3);
  });

  it("marks global-only overlap evidence UNEVALUABLE without inventing an error component", () => {
    const quality = oneCueEvaluation({
      overlapComparisons: [
        {
          comparisonId: "global-overlap",
          machineOverlapCount: 2,
          goldOverlapCount: 3,
          preservedSimultaneousContent: false,
        },
      ],
    });

    expect(quality.overlapEvaluation).toMatchObject({
      status: "UNEVALUABLE_GLOBAL_ONLY",
      machineOverlapCount: 2,
      goldOverlapCount: 3,
    });
    expect(quality.uniqueErrorCounts.overlap).toBe(0);
    expect(
      quality.errorComponents.some((component) =>
        component.labels.includes("OVERLAP_ERROR"),
      ),
    ).toBe(false);
  });

  it("does not classify the primary WHISPER provider as WHISPER_ALT fixability", () => {
    const quality = oneCueEvaluation({
      candidates: [
        {
          candidateId: "whisper-primary",
          providers: ["WHISPER"],
          text: "a",
        },
      ],
    });

    expect(quality.candidateFixability[0]?.classification).toBe(
      "MANUAL_EDIT_REQUIRED",
    );
    expect(
      quality.candidateFixabilitySummary.whisperAlternateFixableCount,
    ).toBe(0);
  });

  it("emits exactly six budgets for each of exactly four rankings", () => {
    const quality = oneCueEvaluation();

    expect(quality.budgetMetrics.map((metrics) => metrics.budget)).toEqual(
      BUDGETS,
    );
    expect(quality.rankingBaselines.map((ranking) => ranking.baseline)).toEqual(
      RANKINGS,
    );
    for (const ranking of quality.rankingBaselines) {
      expect(ranking.budgetMetrics.map((metrics) => metrics.budget)).toEqual(
        BUDGETS,
      );
      expect(
        ranking.audioMatchedBudgetMetrics.map((metrics) => metrics.budget),
      ).toEqual(BUDGETS);
    }
  });
});

describe("C6.0.1.12 route claim guard", () => {
  it("authorizes an unseen-episode trial for a weak ranking without authorizing a workload claim", () => {
    const weakQuality: C60112ReviewQualityEvaluation = {
      ...oneCueEvaluation(),
      rankingResult: "REVIEW_PRIORITY_WEAK",
    };
    const route = decideC60112Route(routeInput(weakQuality));

    expect(route).toMatchObject({
      result: "REVIEW_ASSISTANCE_ENGINEERING_READY_RANKING_WEAK",
      nextStage: "REAL_HUMAN_TRIAL_ON_UNSEEN_EPISODE",
      engineeringComplete: true,
      rankingEffective: false,
      realHumanTrialAuthorized: true,
      workloadReductionClaimAllowed: false,
    });
  });

  it("forbids a workload claim when engineering validation is NOT_READY", () => {
    const effectiveQuality: C60112ReviewQualityEvaluation = {
      ...oneCueEvaluation(),
      rankingResult: "REVIEW_PRIORITY_EFFECTIVE",
    };
    const route = decideC60112Route(
      routeInput(effectiveQuality, { validationPassed: false }),
    );

    expect(route).toMatchObject({
      result: "REVIEW_ASSISTANCE_NOT_READY",
      nextStage: "REPAIR_DATA_GAPS",
      engineeringComplete: false,
      rankingEffective: true,
      realHumanTrialAuthorized: false,
      workloadReductionClaimAllowed: false,
    });
  });
});
