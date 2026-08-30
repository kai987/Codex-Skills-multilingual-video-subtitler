import { describe, expect, it } from "vitest";

import {
  c60113EvidenceFamilyGraphSchema,
  c60113MissingSpeechEvidenceSchema,
  c60113ReviewBurdenPlansSchema,
  c60113ReviewItemsV3Schema,
  c60113ReviewPlaybackTimelineSchema,
  type C60113EvidenceFamily,
  type C60113RegionPriorityEntry,
} from "@mvl/shared";

import {
  buildC60112ReviewPolicy,
  type C60112ReviewItem,
} from "../packages/video-subtitler/src/review/c60112-policy.js";
import {
  buildC60113ReviewPolicy,
  withC60113SemanticHash,
} from "../packages/video-subtitler/src/review/c60113-policy.js";
import {
  buildC60113MissingSpeechEvidence,
  reconcileC60113MissingGap,
} from "../packages/video-subtitler/src/review/missing-speech-evidence-v2.js";
import { buildC60113RegionPriority } from "../packages/video-subtitler/src/review/region-review-priority.js";
import {
  buildC60113BurdenPlans,
  c60113MarginalRegionUtility,
  selectC60113Regions,
} from "../packages/video-subtitler/src/review/review-burden-planner.js";
import {
  buildC60113EvidenceFamilyGraph,
  c60113IndependentFamilies,
  c60113Observation,
} from "../packages/video-subtitler/src/review/review-evidence-family-graph.js";
import {
  buildC60113PlaybackTimeline,
  c60113IncrementalAudioSeconds,
  c60113UniqueAudioSeconds,
  c60113UnplayedIntervals,
  unionC60113Intervals,
} from "../packages/video-subtitler/src/review/review-playback-timeline.js";
import { buildC60112ReviewItems } from "../packages/video-subtitler/src/review/review-item-builder.js";
import { clusterC60112ReviewRegions } from "../packages/video-subtitler/src/review/review-region-clustering.js";
import { clusterC60113ReviewRegions } from "../packages/video-subtitler/src/review/review-region-clustering-v2.js";
import {
  buildC60113MachineReview,
  buildC60113ReviewItems,
  compareC60113StructuredRanks,
} from "../packages/video-subtitler/src/review/structured-review-priority.js";

const policy = buildC60113ReviewPolicy();
const legacyPolicy = buildC60112ReviewPolicy({
  policyFrozenAt: "2026-01-01T00:00:00.000Z",
});

function item(index = 0, start = index * 10): C60112ReviewItem {
  const first = buildC60112ReviewItems({
    policy: legacyPolicy,
    signals: [
      {
        eventIds: [`event-${index}`],
        finalCueIds: [`cue-${index}`],
        itemTypes: ["GENERAL_UNCERTAINTY"],
        sourceInterval: { start, end: start + 4 },
        currentText: "synthetic fixture",
        candidateIds: [],
        evidenceIds: [`evidence-${index}`],
        reviewReasons: ["MACHINE_EVIDENCE_INCOMPLETE"],
      },
    ],
  }).items[0];
  if (first === undefined) throw new Error("Synthetic item fixture missing");
  return first;
}

function observation(
  id: string,
  family: C60113EvidenceFamily,
  root = id,
  strength = 0.9,
  itemIds: string[] = [],
) {
  return c60113Observation({
    evidenceId: id,
    rootLineageIds: [root],
    family,
    provider: `fixture-provider-${root}`,
    correlationGroup: root,
    itemIds,
    gapIds: ["gap"],
    sourceInterval: { start: 10, end: 12 },
    positiveRisk: family !== "SPEECH_ACTIVITY",
    evidenceAbsence: false,
    contradiction: false,
    strength,
    validatedSourceGlobal: true,
    detailCode: `FIXTURE_${family}`,
  });
}

const gap = {
  gapId: "gap",
  sourceInterval: { start: 10, end: 12 },
  itemIds: ["item"],
  legacySignal: true,
  validatedSourceGlobal: true,
  cueCoveredRatio: 0,
};

function missingEmpty() {
  return buildC60113MissingSpeechEvidence({
    gaps: [],
    evidenceFamilies: buildC60113EvidenceFamilyGraph({
      observations: [],
      policy,
    }),
    legacyMissingItemCount: 0,
    policy,
  });
}

function region(
  id: string,
  start: number,
  end: number,
  mandatory = false,
): C60113RegionPriorityEntry {
  return withC60113SemanticHash({
    regionId: id,
    itemIds: [`item-${id}`],
    sourceInterval: { start, end },
    contextInterval: { start, end },
    itemRiskSummary: {
      uniqueAffectedCueCount: 1,
      uniqueEventCount: 1,
      independentRiskGroupCount: 1,
      mandatoryItemCount: mandatory ? 1 : 0,
      missingClassifications: [],
    },
    independentEvidenceFamilies: ["TIMING_BOUNDARY" as const],
    mandatoryReasons: mandatory ? [`STRONG_TIMING:event-${id}`] : [],
    candidateActionableCount: 0,
    estimatedUniqueAudioSeconds: end - start,
    priorityVector: {
      mandatorySafetyClass: mandatory
        ? ("STRONG_TIMING" as const)
        : ("NONE" as const),
      positiveEvidenceStrength: 0.9,
      independentEvidenceFamilyCount: 1,
      errorTypeSeverity: 0.9,
      crossModelConflictStrength: 0,
      hallucinationStrength: 0,
      missingStrength: 0,
      timingStrength: 0.9,
      candidateActionability: 0,
      localizationQuality: 1,
      estimatedReviewCost: 8 + end - start,
      sourceTime: start,
    },
    rankScore: 1,
    rankPosition: 1,
    riskCoverageKeys: [`risk-${id}`],
    actionableCoverageKeys: [],
  });
}

describe("C6.0.1.13 missing-speech semantics and evidence independence", () => {
  it("does not turn one validated speech gap into strong dialogue proof", () => {
    const result = reconcileC60113MissingGap({
      gap,
      policy,
      observations: [observation("vad", "SPEECH_ACTIVITY")],
    });
    expect(result.classification).toBe("SPEECH_GAP_OBSERVED");
    expect(result.reviewLevel).toBe("INFORMATIONAL");
  });

  it("deduplicates raw VAD, mapped VAD and decoded text sharing one root", () => {
    const evidence = [
      observation("raw", "SPEECH_ACTIVITY", "same"),
      observation("mapped", "LOCALIZATION", "same"),
      observation("decoded", "ASR_LEXICAL_CONTENT", "same"),
    ];
    expect(c60113IndependentFamilies(evidence)).toHaveLength(1);
    expect(
      reconcileC60113MissingGap({ gap, policy, observations: evidence })
        .classification,
    ).toBe("SPEECH_GAP_OBSERVED");
  });

  it("admits possible missing with independently localized lexical evidence", () => {
    const result = reconcileC60113MissingGap({
      gap,
      policy,
      observations: [
        observation("vad", "SPEECH_ACTIVITY"),
        observation("words", "ASR_LEXICAL_CONTENT"),
      ],
    });
    expect(result.classification).toBe("MISSING_DIALOGUE_POSSIBLE");
    expect(result.reviewLevel).toBe("RECOMMENDED");
  });

  it("does not upgrade correlated activity and lexical proof using unrelated extra families", () => {
    const result = reconcileC60113MissingGap({
      gap,
      policy,
      observations: [
        observation("vad", "SPEECH_ACTIVITY", "same-root"),
        observation("words", "ASR_LEXICAL_CONTENT", "same-root"),
        observation("speaker", "SPEAKER_ACTIVITY", "speaker-root"),
        observation("neighbor", "NEIGHBOR_CONTINUITY", "neighbor-root"),
      ],
    });
    expect(result.independentFamilyCount).toBe(3);
    expect(result.classification).toBe("MISSING_DIALOGUE_POSSIBLE");
    expect(result.reasons).toContain(
      "INDEPENDENT_ACTIVITY_LEXICAL_SUPPORT_TRIPLE_UNAVAILABLE",
    );
  });

  it("preserves declared cross-provider correlation and same-provider breadth limits", () => {
    const a = observation("a", "ASR_LEXICAL_CONTENT", "root-a");
    const b = c60113Observation({
      ...observation("b", "TIMING_BOUNDARY", "root-b"),
      correlationGroup: a.correlationGroup,
    });
    expect(c60113IndependentFamilies([a, b])).toHaveLength(1);
    const c = c60113Observation({
      ...observation("c", "DECODER", "root-c"),
      provider: a.provider,
    });
    expect(c60113IndependentFamilies([a, c])).toHaveLength(1);
  });

  it("requires observed activity, lexical proof and a third independent family for strong", () => {
    const result = reconcileC60113MissingGap({
      gap,
      policy,
      observations: [
        observation("vad", "SPEECH_ACTIVITY"),
        observation("words", "ASR_LEXICAL_CONTENT"),
        observation("speaker", "SPEAKER_ACTIVITY"),
      ],
    });
    expect(result.classification).toBe("MISSING_DIALOGUE_STRONG");
    expect(result.independentFamilyCount).toBe(3);
    expect(result.reviewLevel).toBe("REQUIRED");
  });

  it("blocks strong music/noise contradiction and existing cue coverage", () => {
    const music = observation("music", "MUSIC_LYRICS_CONTRADICTION");
    const evidence = [
      observation("vad", "SPEECH_ACTIVITY"),
      observation("words", "ASR_LEXICAL_CONTENT"),
      observation("speaker", "SPEAKER_ACTIVITY"),
      c60113Observation({ ...music, positiveRisk: false, contradiction: true }),
    ];
    expect(
      reconcileC60113MissingGap({ gap, policy, observations: evidence })
        .classification,
    ).toBe("MISSING_DIALOGUE_CONTRADICTED");
    expect(
      reconcileC60113MissingGap({
        gap: { ...gap, cueCoveredRatio: 0.8 },
        policy,
        observations: evidence.slice(0, 3),
      }).reviewLevel,
    ).toBe("INFORMATIONAL");
  });

  it("records legacy observed migration then leaves unverified activity unresolved", () => {
    const result = reconcileC60113MissingGap({
      gap: { ...gap, validatedSourceGlobal: false },
      policy,
      observations: [],
    });
    expect(result.classification).toBe("MISSING_DIALOGUE_UNRESOLVED");
    expect(result.legacyMappedClassification).toBe("SPEECH_GAP_OBSERVED");
    expect(result.validatedSourceGlobal).toBe(false);
    expect(result.reasons).toContain(
      "LEGACY_SIGNAL_ONLY_VERIFIED_SOURCE_GLOBAL_ACTIVITY_UNAVAILABLE",
    );
  });

  it("rejects Gold payloads and conflicting evidence IDs", () => {
    const base = observation("same", "TIMING_BOUNDARY");
    expect(() =>
      buildC60113EvidenceFamilyGraph({
        policy,
        observations: [base, observation("same", "TIMING_BOUNDARY", "other")],
      }),
    ).toThrow("CONFLICTING_EVIDENCE_ID");
    expect(() =>
      buildC60113EvidenceFamilyGraph({
        policy,
        observations: [observation("gold-label", "TIMING_BOUNDARY")],
      }),
    ).toThrow("GOLD_INPUT_FORBIDDEN");
  });

  it("counts repeated input and correlated observations separately", () => {
    const base = observation("a", "ACOUSTIC_ALIGNMENT", "ctc");
    const artifact = buildC60113EvidenceFamilyGraph({
      policy,
      observations: [base, base, observation("b", "LOCALIZATION", "ctc")],
    });
    expect(artifact.summary.duplicateEvidenceInputCount).toBe(1);
    expect(artifact.summary.correlatedEvidenceDeduplicatedCount).toBe(1);
    expect(c60113EvidenceFamilyGraphSchema.safeParse(artifact).success).toBe(
      true,
    );
  });
});

describe("C6.0.1.13 structured priority", () => {
  it("does not boost risk for evidence absence or duplicated reason counts", () => {
    const legacy = item();
    const risk = observation("risk", "WHISPER_STABILITY", "model", 0.6, [
      legacy.reviewItemId,
    ]);
    const absent = c60113Observation({
      ...risk,
      evidenceId: "ctc-absent",
      rootLineageIds: ["ctc"],
      correlationGroup: "ctc",
      family: "ACOUSTIC_ALIGNMENT",
      evidenceAbsence: true,
      detailCode: "CTC_NOT_RUN",
    });
    const build = (observations: (typeof risk)[]) =>
      buildC60113ReviewItems({
        items: [legacy],
        policy,
        candidateBundles: [],
        evidenceFamilies: buildC60113EvidenceFamilyGraph({
          policy,
          observations,
        }),
        missingEvidence: missingEmpty(),
      });
    const before = build([risk]);
    const after = build([risk, absent]);
    expect(after.items[0]?.displayPriorityScore).toBe(
      before.items[0]?.displayPriorityScore,
    );
    expect(after.items[0]?.uncertaintyReasons).toContain("CTC_NOT_RUN");
    expect(after.items[0]?.requiredLevel).toBe("RECOMMENDED");
  });

  it("separates 61 previously saturated items with real strength differences", () => {
    const items = Array.from({ length: 61 }, (_, index) => item(index));
    const observations = items.map((entry, index) =>
      observation(
        `hall-${index}`,
        "HALLUCINATION",
        `root-${index}`,
        0.81 + index * 0.003,
        [entry.reviewItemId],
      ),
    );
    const output = buildC60113ReviewItems({
      items,
      policy,
      candidateBundles: [],
      evidenceFamilies: buildC60113EvidenceFamilyGraph({
        policy,
        observations,
      }),
      missingEvidence: missingEmpty(),
    });
    expect(output.summary.scoreDistribution.uniqueScoreCount).toBe(61);
    expect(output.summary.scoreDistribution.maxScoreItemCount).toBe(1);
    expect(output.summary.requiredItemCount).toBe(61);
    expect(output.items[0]?.priorityVector.hallucinationStrength).toBeCloseTo(
      0.99,
    );
    expect(c60113ReviewItemsV3Schema.safeParse(output).success).toBe(true);
  });

  it("does not make a high display score mandatory without a mandatory proof", () => {
    const legacy = item();
    const evidence = [
      observation("w", "WHISPER_STABILITY", "w", 0.79, [legacy.reviewItemId]),
      observation("r", "REAZON_STABILITY", "r", 0.79, [legacy.reviewItemId]),
      observation("cross", "CROSS_MODEL_CONTENT", "cross", 0.79, [
        legacy.reviewItemId,
      ]),
    ];
    const result = buildC60113ReviewItems({
      items: [legacy],
      policy,
      candidateBundles: [],
      evidenceFamilies: buildC60113EvidenceFamilyGraph({
        policy,
        observations: evidence,
      }),
      missingEvidence: missingEmpty(),
    });
    expect(result.items[0]?.displayPriorityScore).toBeGreaterThan(50);
    expect(result.items[0]?.mandatoryReasons).toEqual([]);
    expect(result.items[0]?.requiredLevel).toBe("RECOMMENDED");
  });

  it("uses structured safety ordering instead of display tie order", () => {
    expect(
      compareC60113StructuredRanks([4, 0.8, 0.7], [0, 0.95, 0.95]),
    ).toBeLessThan(0);
  });
});

describe("C6.0.1.13 source-global audio burden", () => {
  it("unions nested, overlapping and adjacent intervals deterministically", () => {
    const intervals = [
      { start: 5, end: 10 },
      { start: 0, end: 8 },
      { start: 2, end: 3 },
      { start: 10, end: 12 },
    ];
    expect(unionC60113Intervals(intervals)).toEqual([{ start: 0, end: 12 }]);
    expect(c60113UniqueAudioSeconds(intervals)).toBe(12);
    expect(c60113UniqueAudioSeconds([...intervals].reverse())).toBe(12);
  });

  it("computes zero/full/partial incremental cost and playable unplayed spans", () => {
    expect(
      c60113IncrementalAudioSeconds({ start: 4, end: 8 }, [
        { start: 0, end: 10 },
      ]),
    ).toBe(0);
    expect(
      c60113IncrementalAudioSeconds({ start: 4, end: 12 }, [
        { start: 0, end: 10 },
      ]),
    ).toBe(2);
    expect(
      c60113UnplayedIntervals({ start: 0, end: 10 }, [
        { start: 2, end: 4 },
        { start: 6, end: 8 },
      ]),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
      { start: 8, end: 10 },
    ]);
    expect(() => unionC60113Intervals([{ start: -1, end: 2 }])).toThrow();
  });

  it("recomputes marginal audio after each selected region", () => {
    const a = region("a", 0, 20, true),
      b = region("b", 10, 25),
      c = region("c", 100, 110);
    const selection = selectC60113Regions({
      regions: [c, b, a],
      policy,
      budgetSeconds: 25,
    });
    expect(selection.regions.map((entry) => entry.regionId)).toEqual([
      "a",
      "b",
    ]);
    expect(selection.selectionSteps[1]?.incrementalPlaybackSeconds).toBe(5);
    expect(selection.uniqueUnionSeconds).toBe(25);
  });

  it("deduplicates repeated roots but preserves distinct mandatory events", () => {
    const a = region("a", 0, 10, true),
      b = region("b", 0, 10, true);
    b.riskCoverageKeys = a.riskCoverageKeys;
    const marginal = c60113MarginalRegionUtility({
      region: b,
      selectedRegions: [a],
      policy,
    });
    expect(marginal.newRiskCoverageCount).toBe(0);
    expect(marginal.newMandatoryCoverageCount).toBe(1);
    expect(marginal.incrementalPlaybackSeconds).toBe(0);
    expect(marginal.utilityPerCost).toBeLessThan(1);
  });

  it("prevents tiny regions from having unbounded cost advantage", () => {
    const value = c60113MarginalRegionUtility({
      region: region("tiny", 0, 0.001),
      selectedRegions: [],
      policy,
    });
    expect(value.utilityPerCost).toBeLessThan(1);
    expect(value.fixedReviewOverheadSeconds).toBe(8);
  });

  it("preserves category/scene/speaker boundaries and maps every region to non-overlapping playback", () => {
    const legacy = [item(0, 0), item(1, 4.5), item(2, 8.9)];
    legacy.forEach((entry, index) => {
      entry.sceneIds = [index === 0 ? "scene-a" : "scene-b"];
    });
    const graph = buildC60113EvidenceFamilyGraph({ observations: [], policy });
    const items = buildC60113ReviewItems({
      items: legacy,
      policy,
      candidateBundles: [],
      evidenceFamilies: graph,
      missingEvidence: missingEmpty(),
    });
    const regions = clusterC60113ReviewRegions({
      items: items.items,
      itemsHash: items.semanticHash,
      sourceDurationSeconds: 20,
      policy,
    });
    expect(regions.regions).toHaveLength(2);
    const playback = buildC60113PlaybackTimeline({ regions, policy });
    expect(playback.segments).toHaveLength(1);
    expect(playback.regionMappings).toHaveLength(2);
    expect(playback.duplicateContextSeconds).toBeGreaterThan(0);
    expect(c60113ReviewPlaybackTimelineSchema.safeParse(playback).success).toBe(
      true,
    );
    const priority = buildC60113RegionPriority({
      items: items.items,
      regions,
      evidenceFamilies: graph,
      policy,
    });
    const plans = buildC60113BurdenPlans({
      regionPriority: priority,
      sourceDurationSeconds: 20,
      policy,
    });
    expect(plans.plans).toHaveLength(12);
    expect(
      plans.plans.find((plan) => plan.planId === "UNIQUE_AUDIO_10_PERCENT")
        ?.budgetSeconds,
    ).toBe(2);
    expect(c60113ReviewBurdenPlansSchema.safeParse(plans).success).toBe(true);
  });

  it("builds all core artifacts reproducibly without modifying input cues", () => {
    const legacy = [item(0, 2)];
    legacy.forEach((entry) => {
      entry.itemTypes.push("MISSING_SPEECH_RISK");
      entry.reviewReasons.push("MISSING_DIALOGUE_SUSPECTED");
    });
    const finalCues = [{ id: "cue", start: 2, end: 6 }];
    const before = JSON.stringify(finalCues);
    const input = {
      items: legacy,
      candidateBundles: [],
      sourceDurationSeconds: 20,
      finalCues,
    };
    const a = buildC60113MachineReview(input),
      b = buildC60113MachineReview(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(finalCues)).toBe(before);
    expect(
      c60113MissingSpeechEvidenceSchema.safeParse(a.missingEvidence).success,
    ).toBe(true);
    expect(a.missingEvidence.gaps[0]?.classification).toBe(
      "MISSING_DIALOGUE_CONTRADICTED",
    );
    expect(a.itemsV3.summary.requiredItemCount).toBe(0);
    const legacyRegions = clusterC60112ReviewRegions({
      items: legacy,
      policy: legacyPolicy,
      sourceDurationSeconds: 20,
    });
    const ablated = buildC60113MachineReview({
      ...input,
      regions: legacyRegions.regions,
      ablationStage: "A1_MISSING_ONLY",
    });
    expect(ablated.regionsV2.regions[0]?.regionId).toBe(
      legacyRegions.regions[0]?.regionId,
    );
  });
});
