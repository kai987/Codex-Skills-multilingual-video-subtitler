import { describe, expect, it } from "vitest";
import type {
  C60114PlaybackCoverageInput,
  MachineVsGoldEvaluation,
} from "@mvl/shared";
import { c60114PlaybackCoverageEvaluationSchema } from "@mvl/shared";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import {
  c60114CoverageLayer,
  c60114UnionIntervals,
  evaluateC60114PlaybackCoverage,
} from "../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import {
  c60114GoldErrorComponents,
  withC60114PostFreezeGold,
} from "../scripts/lib/c60114-post-freeze-evaluation.js";

type Input = C60114PlaybackCoverageInput;
const interval = (start = 10, end = 12) => ({ start, end });
const hash = "a".repeat(64);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("SYNTHETIC_FIXTURE_ROW_MISSING");
  return value;
}
const signed = <T extends object>(value: T): T & { semanticHash: string } => ({
  ...value,
  semanticHash: c60113HashPayload(value),
});

function fixture(): Input {
  const sourceIdentity: Input["sourceIdentity"] = {
    sourceMediaSha256: hash,
    durationSeconds: 100,
    sampleRate: 48000,
    audioStreamIndex: 1,
    audioTimebase: "1/48000",
    sourceTimebase: "SOURCE_GLOBAL_SECONDS",
  };
  return {
    sourceIdentity,
    generatedAt: "2026-08-30T00:00:00.000Z",
    items: [{ reviewItemId: "item", sourceIdentity }],
    targets: [
      {
        reviewTargetId: "target",
        parentReviewItemId: "item",
        sourceInterval: interval(),
        mandatoryForAudio: true,
        sourceIdentity,
      },
    ],
    regions: [
      {
        regionId: "region",
        reviewTargetIds: ["target"],
        reviewItemIds: ["item"],
        sourceIntervals: [interval()],
        contextIntervals: [interval()],
        sourceIdentity,
      },
    ],
    physicalAudio: [
      signed({
        audioId: "audio",
        relativePath: "audio/fixture.wav",
        sourceMediaSha256: hash,
        sourceInterval: interval(),
        requestedInterval: interval(),
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        codec: "pcm_s16le",
        frameCount: 32000,
        actualDuration: 2,
        sha256: "b".repeat(64),
        playable: true,
        hashVerified: true,
        physicalMetadataVerified: true,
        coveredReviewTargetIds: ["target"],
        regionIds: ["region"],
        sourceIdentity,
      }),
    ],
    playbackSegments: [
      signed({
        playbackSegmentId: "segment",
        audioId: "audio",
        sourceInterval: interval(),
        audioLocalInterval: interval(0, 2),
        reviewTargetIds: ["target"],
        reviewItemIds: ["item"],
        regionIds: ["region"],
        sourceIdentity,
      }),
    ],
    plans: [
      ...[10, 20, 30, 40, 50].map((percent) => ({
        planId: `UNIQUE_AUDIO_${percent}_PERCENT`,
        budgetSeconds: percent,
        regionIds: ["region"],
        reviewTargetIds: ["target"],
        playbackSegmentIds: ["segment"],
      })),
      {
        planId: "ALL_MANDATORY",
        budgetSeconds: null,
        regionIds: ["region"],
        reviewTargetIds: ["target"],
        playbackSegmentIds: ["segment"],
      },
      {
        planId: "FULL_QUEUE",
        budgetSeconds: null,
        regionIds: ["region"],
        reviewTargetIds: ["target"],
        playbackSegmentIds: ["segment"],
      },
    ],
    speechIslands: [
      {
        islandId: "island",
        sourceInterval: interval(),
        speechPositive: true,
        localizationStatus: "VERIFIED",
        sourceIdentity,
      },
    ],
    lexicalEvidence: [
      {
        evidenceId: "lexical",
        sourceInterval: interval(),
        reliableLocalizedLexical: true,
        mappingStatus: "VERIFIED",
        providerFamily: "model-a",
        rootLineageIds: ["root-a"],
        correlationGroup: "root-a",
        sourceIdentity,
      },
    ],
    orphans: [
      {
        orphanId: "orphan",
        sourceInterval: interval(),
        speechPositive: true,
        localizationStatus: "VERIFIED",
        sourceIdentity,
      },
    ],
    errorComponents: ["MISSING_DIALOGUE", "HALLUCINATION"].map((label) => ({
      errorComponentId: label,
      sourceIdentity,
      labels: [label as "MISSING_DIALOGUE" | "HALLUCINATION"],
      defectIds: [label],
      alignmentIds: ["alignment"],
      coveredItemIds: ["item"],
      coveredRegionIds: ["region"],
      errorIntervals: [interval()],
      mappingStatus: "RESOLVED",
      mappingReasons: [],
    })),
    engineeringGates: {
      engineeringPassed: true,
      baselineParityPassed: true,
      runtimeGoldInputCount: 0,
      canonicalMutationCount: 0,
      machineDraftMutationCount: 0,
      sourceMutationCount: 0,
      goldMutationCount: 0,
      machineFreezeVerified: true,
    },
  };
}

function full(input: Input) {
  return required(
    evaluateC60114PlaybackCoverage(input).budgets.find(
      (row) => row.planId === "FULL_QUEUE",
    ),
  );
}
function relocateAudio(input: Input, start: number, end: number): void {
  const audio = required(input.physicalAudio[0]);
  const segment = required(input.playbackSegments[0]);
  input.physicalAudio[0] = signed({
    ...audio,
    sourceInterval: interval(start, end),
    requestedInterval: interval(start, end),
    actualDuration: end - start,
    frameCount: (end - start) * audio.sampleRate,
  });
  input.playbackSegments[0] = signed({
    ...segment,
    sourceInterval: interval(start, end),
    audioLocalInterval: interval(0, end - start),
  });
}

describe("C6.0.1.14 playback-grounded coverage (synthetic only)", () => {
  it("records strict layered coverage without mutating input or authorizing release", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const result = evaluateC60114PlaybackCoverage(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(
      c60114PlaybackCoverageEvaluationSchema.safeParse(result).success,
    ).toBe(true);
    expect(result.route).toBe("GO_C6_0_1_15_REGION_RANKER_RECALIBRATION");
    expect(result.c602Status).toBe("HOLD");
    expect(result.realHumanTrialExecuted).toBe(false);
    expect(result.machineOnlyReleaseAuthorized).toBe(false);
    expect(full(input).officialMissingRecall.recall).toBe(1);
    expect(required(full(input).componentCoverage[0]).missingDiagnosis).toBe(
      "FULLY_PLAYBACK_COVERED",
    );
    expect(
      required(full(input).componentCoverage[0]).layers.itemLineage.status,
    ).toBe("NOT_A_PLAYBACK_RECALL_METRIC");
    expect(full(input).exactPlaybackSegments).toEqual(input.playbackSegments);
  });

  it("shared item and region IDs with disjoint physical audio give zero audible recall", () => {
    const input = fixture();
    relocateAudio(input, 40, 42);
    required(input.targets[0]).sourceInterval = interval(40, 42);
    required(input.regions[0]).sourceIntervals = [interval(40, 42)];
    required(input.regions[0]).contextIntervals = [interval(40, 42)];
    const result = full(input);
    const row = required(result.componentCoverage[0]);
    expect(result.missingRecall.itemLineage.recall).toBe(1);
    expect(result.missingRecall.regionMembership.recall).toBe(1);
    expect(result.officialMissingRecall.recall).toBe(0);
    expect(row.layers.audibleReviewCoverage.coverageRatio).toBe(0);
    expect(row.findings).toContain("LINEAGE_ONLY_FALSE_COVERAGE");
    expect(row.findings).toContain(
      "REGION_MEMBERSHIP_WITHOUT_PLAYBACK_COVERAGE",
    );
    expect(required(result.componentCoverage[1]).hallucinationDiagnosis).toBe(
      "LINEAGE_ONLY",
    );
  });

  it("a selected parent gap is audio coverage, not a machine speech island", () => {
    const input = fixture();
    required(input.speechIslands[0]).sourceInterval = interval(40, 42);
    input.lexicalEvidence = [];
    input.orphans = [];
    const result = evaluateC60114PlaybackCoverage(input);
    const row = required(full(input).componentCoverage[0]);
    expect(row.layers.regionContext.audible).toBe(true);
    expect(row.layers.machineSpeech.covered).toBe(false);
    expect(row.missingDiagnosis).toBe("MACHINE_SPEECH_DETECTION_MISS");
    expect(row.diagnosisFlags).toContain("MACHINE_SPEECH_DETECTION_MISS");
    expect(result.route).toBe("HOLD_FOR_MACHINE_SPEECH_DETECTION_REPAIR");
  });

  it("does not fill the hole between disjoint atomic Gold intervals", () => {
    const input = fixture();
    input.errorComponents.forEach((row) => {
      row.errorIntervals = [
        interval(10, 11),
        interval(20, 21),
        interval(10, 11),
      ];
    });
    relocateAudio(input, 11, 20);
    const row = required(full(input).componentCoverage[0]);
    expect(row.errorIntervals).toEqual([interval(10, 11), interval(20, 21)]);
    expect(row.layers.physicalAudio.errorDurationSeconds).toBe(2);
    expect(row.layers.physicalAudio.overlapSeconds).toBe(0);
    expect(row.layers.audibleReviewCoverage.coverageRatio).toBe(0);
  });

  it("unions duplicates without inflating denominator or overlap", () => {
    const layer = c60114CoverageLayer(
      [interval(0, 2), interval(0, 2), interval(1, 3)],
      [
        { id: "same", intervals: [interval(0, 1), interval(0, 1)] },
        { id: "same", intervals: [interval(0, 1)] },
      ],
    );
    expect(layer.errorDurationSeconds).toBe(3);
    expect(layer.overlapSeconds).toBe(1);
    expect(layer.coveringIds).toEqual(["same"]);
    expect(c60114UnionIntervals([interval(0, 1), interval(2, 3)])).toHaveLength(
      2,
    );
  });

  it.each([0, 0.4999, 0.5, 0.7999, 0.8, 0.9499, 0.95, 1])(
    "enforces frozen any/majority/audible/full thresholds: %s",
    (ratio) => {
      const layer = c60114CoverageLayer(
        [interval(0, 100)],
        ratio ? [{ id: "audio", intervals: [interval(0, ratio * 100)] }] : [],
      );
      expect(layer.any).toBe(ratio > 0);
      expect(layer.majority).toBe(ratio >= 0.5);
      expect(layer.audible).toBe(ratio >= 0.8);
      expect(layer.full).toBe(ratio >= 0.95);
    },
  );

  it.each([
    "sourceMediaSha256",
    "durationSeconds",
    "sampleRate",
    "audioStreamIndex",
    "audioTimebase",
  ] as const)("fails closed on source identity %s mismatch", (key) => {
    const input = fixture();
    const changed = { ...required(input.targets[0]).sourceIdentity };
    if (key === "sourceMediaSha256") changed[key] = "c".repeat(64);
    else if (key === "audioTimebase") changed[key] = "1/16000";
    else changed[key] += 1;
    required(input.targets[0]).sourceIdentity = changed;
    const result = evaluateC60114PlaybackCoverage(input);
    expect(result.route).toBe("HOLD_FOR_EVALUATION_INTEGRITY_REPAIR");
    expect(full(input).officialMissingRecall.recall).toBe(0);
    expect(
      result.integrityFailures.some((failure) => failure.includes(key)),
    ).toBe(true);
  });

  it("rejects local-time coordinates masquerading as source-global seconds", () => {
    const input = fixture();
    input.playbackSegments[0] = signed({
      ...required(input.playbackSegments[0]),
      audioLocalInterval: interval(1, 3),
    });
    expect(evaluateC60114PlaybackCoverage(input).integrityFailures).toContain(
      "PLAYBACK_SOURCE_LOCAL_COORDINATE_MISMATCH:segment",
    );
    expect(full(input).officialMissingRecall.recall).toBe(0);
  });

  it("requires physical audio, checks metadata hashes and never credits planned intervals", () => {
    const missing = fixture();
    missing.physicalAudio = [];
    expect(evaluateC60114PlaybackCoverage(missing).route).toBe(
      "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
    );
    expect(full(missing).officialMissingRecall.recall).toBe(0);
    const corrupt = fixture();
    required(corrupt.physicalAudio[0]).sha256 = "d".repeat(64);
    expect(evaluateC60114PlaybackCoverage(corrupt).integrityFailures).toContain(
      "AUDIO_METADATA_HASH_MISMATCH:audio",
    );
    const noMetadata = fixture();
    delete (
      noMetadata.physicalAudio[0] as Partial<Input["physicalAudio"][number]>
    ).frameCount;
    expect(() => evaluateC60114PlaybackCoverage(noMetadata)).toThrow();
    const noProof = fixture();
    noProof.physicalAudio[0] = signed({
      ...required(noProof.physicalAudio[0]),
      hashVerified: false,
    });
    expect(evaluateC60114PlaybackCoverage(noProof).integrityFailures).toContain(
      "PHYSICAL_AUDIO_NOT_VERIFIED:audio",
    );
  });

  it("physical WAV coverage without selected playback does not count as review recall", () => {
    const input = fixture();
    input.playbackSegments = [];
    input.plans.forEach((row) => {
      row.playbackSegmentIds = [];
    });
    const result = full(input);
    expect(result.missingRecall.physicalAudio.recall).toBe(1);
    expect(result.officialMissingRecall.recall).toBe(0);
    expect(required(result.componentCoverage[0]).findings).toContain(
      "PLAYBACK_OMISSION",
    );
    expect(required(result.componentCoverage[1]).hallucinationDiagnosis).toBe(
      "REVIEW_AUDIO_OMISSION",
    );
    expect(evaluateC60114PlaybackCoverage(input).route).toBe(
      "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR",
    );
  });

  it("refuses duplicate components rather than changing the error denominator", () => {
    const input = fixture();
    input.errorComponents.push({ ...required(input.errorComponents[0]) });
    expect(() => evaluateC60114PlaybackCoverage(input)).toThrow(
      "DUPLICATE_ERROR_COMPONENT",
    );
  });

  it("distinguishes lexical independence from correlated profiles and disjoint evidence", () => {
    const input = fixture();
    input.lexicalEvidence.push({
      ...required(input.lexicalEvidence[0]),
      evidenceId: "second",
      providerFamily: "model-b",
    });
    expect(
      required(full(input).componentCoverage[0])
        .independentLocalizedLexicalSourceCount,
    ).toBe(1);
    required(input.lexicalEvidence[1]).rootLineageIds = ["root-b"];
    required(input.lexicalEvidence[1]).correlationGroup = "root-b";
    expect(required(full(input).componentCoverage[0]).missingDiagnosis).toBe(
      "FULLY_PLAYBACK_COVERED",
    );
    required(input.lexicalEvidence[1]).sourceInterval = interval(40, 42);
    expect(required(full(input).componentCoverage[0]).missingDiagnosis).toBe(
      "FULLY_PLAYBACK_COVERED",
    );
  });

  it("retains exact selected segment sets separately for every frozen budget", () => {
    const input = fixture();
    required(input.plans[0]).playbackSegmentIds = [];
    const result = evaluateC60114PlaybackCoverage(input);
    expect(required(result.budgets[0]).exactPlaybackSegments).toEqual([]);
    expect(required(result.budgets[0]).officialMissingRecall.recall).toBe(0);
    expect(
      required(result.budgets.at(-1)).exactPlaybackSegments.map(
        (row) => row.playbackSegmentId,
      ),
    ).toEqual(["segment"]);
    expect(required(result.budgets.at(-1)).officialMissingRecall.recall).toBe(
      1,
    );
  });

  it("physical coverage cannot replace the omitted half of a playback segment", () => {
    const input = fixture();
    input.playbackSegments[0] = signed({
      ...required(input.playbackSegments[0]),
      sourceInterval: interval(10, 11),
      audioLocalInterval: interval(0, 1),
    });
    const row = required(full(input).componentCoverage[0]);
    expect(row.layers.physicalAudio.coverageRatio).toBe(1);
    expect(row.layers.playbackSegments.coverageRatio).toBe(0.5);
    expect(row.layers.audibleReviewCoverage.coverageRatio).toBe(0.5);
    expect(row.layers.audibleReviewCoverage.covered).toBe(false);
  });

  it("separates full-target physical delivery from cross-region deduplicated playback", () => {
    const input = fixture();
    const audio = required(input.physicalAudio[0]);
    const segment = required(input.playbackSegments[0]);
    input.physicalAudio.push(
      signed({
        ...audio,
        audioId: "overlap-audio",
        relativePath: "audio/overlap.wav",
        sourceInterval: interval(10, 11),
        requestedInterval: interval(10, 11),
        frameCount: 16000,
        actualDuration: 1,
        coveredReviewTargetIds: [],
      }),
    );
    input.playbackSegments = [
      signed({
        ...segment,
        playbackSegmentId: "first-part",
        audioId: "overlap-audio",
        sourceInterval: interval(10, 11),
        audioLocalInterval: interval(0, 1),
      }),
      signed({
        ...segment,
        playbackSegmentId: "second-part",
        sourceInterval: interval(11, 12),
        audioLocalInterval: interval(1, 2),
      }),
    ];
    input.plans.forEach((plan) => {
      plan.playbackSegmentIds = ["first-part", "second-part"];
    });
    const before = JSON.stringify(input);
    const result = evaluateC60114PlaybackCoverage(input);
    expect(result.routeDecision.requiredTargetAudioGatePassed).toBe(true);
    expect(result.route).toBe("GO_C6_0_1_15_REGION_RANKER_RECALIBRATION");
    expect(result.thresholds.audible).toBe(0.8);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not accept unclaimed physical delivery merely because its audio is playing", () => {
    const input = fixture();
    input.physicalAudio[0] = signed({
      ...required(input.physicalAudio[0]),
      coveredReviewTargetIds: [],
    });
    const result = evaluateC60114PlaybackCoverage(input);
    expect(full(input).officialMissingRecall.recall).toBe(1);
    expect(result.routeDecision.requiredTargetAudioGatePassed).toBe(false);
  });

  it("does not accept a missing target binding in otherwise complete playback", () => {
    const input = fixture();
    input.playbackSegments[0] = signed({
      ...required(input.playbackSegments[0]),
      reviewTargetIds: [],
    });
    expect(
      evaluateC60114PlaybackCoverage(input).routeDecision
        .requiredTargetAudioGatePassed,
    ).toBe(false);
  });

  it("requires complete required-target playback even when Gold audible recall passes", () => {
    const input = fixture();
    input.playbackSegments[0] = signed({
      ...required(input.playbackSegments[0]),
      sourceInterval: interval(10, 11.8),
      audioLocalInterval: interval(0, 1.8),
    });
    expect(full(input).officialMissingRecall.recall).toBe(1);
    expect(
      evaluateC60114PlaybackCoverage(input).routeDecision
        .requiredTargetAudioGatePassed,
    ).toBe(false);
  });

  it("does not diagnose absent speech or lexical evidence as a miss for a hallucinated cue", () => {
    const input = fixture();
    input.speechIslands = [];
    input.orphans = [];
    input.lexicalEvidence = [];
    const row = required(
      full(input).componentCoverage.find((item) =>
        item.labels.includes("HALLUCINATION"),
      ),
    );
    expect(row.hallucinationDiagnosis).toBe("TARGET_AND_AUDIO_COVERED");
    expect(row.missingDiagnosis).toBeNull();
    expect(row.diagnosisFlags).toEqual(["FULLY_PLAYBACK_COVERED"]);
  });

  it("combines localized token fragments only within a proven source family", () => {
    const input = fixture();
    const token = required(input.lexicalEvidence[0]);
    input.lexicalEvidence = [
      { ...token, sourceInterval: interval(10, 11) },
      { ...token, evidenceId: "token-2", sourceInterval: interval(11, 12) },
    ];
    expect(required(full(input).componentCoverage[0]).missingDiagnosis).toBe(
      "FULLY_PLAYBACK_COVERED",
    );
    required(input.lexicalEvidence[1]).providerFamily = "other-family";
    required(input.lexicalEvidence[1]).rootLineageIds = ["other-root"];
    required(input.lexicalEvidence[1]).correlationGroup = "other-root";
    expect(
      required(full(input).componentCoverage[0])
        .independentLocalizedLexicalSourceCount,
    ).toBe(0);
    expect(evaluateC60114PlaybackCoverage(input).route).toBe(
      "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
    );
  });

  it("fails closed on forged frame metadata and out-of-bounds coordinates", () => {
    const input = fixture();
    input.physicalAudio[0] = signed({
      ...required(input.physicalAudio[0]),
      frameCount: 16000,
    });
    expect(evaluateC60114PlaybackCoverage(input).integrityFailures).toContain(
      "AUDIO_FRAME_DURATION_MISMATCH:audio",
    );
    const outOfBounds = fixture();
    required(outOfBounds.targets[0]).sourceInterval = interval(99, 101);
    expect(
      evaluateC60114PlaybackCoverage(outOfBounds).integrityFailures,
    ).toContain("SOURCE_COORDINATE_OUT_OF_BOUNDS:target");
  });

  it("rejects duplicate or missing selected segment IDs without inflating playback", () => {
    const input = fixture();
    required(input.plans[0]).playbackSegmentIds.push("segment");
    const result = evaluateC60114PlaybackCoverage(input);
    expect(result.route).toBe("HOLD_FOR_EVALUATION_INTEGRITY_REPAIR");
    expect(required(result.budgets[0]).integrityFailures).toContain(
      "DUPLICATE_PLAN_SEGMENT:segment",
    );
    const missing = fixture();
    required(missing.plans[0]).playbackSegmentIds = ["absent"];
    expect(
      required(evaluateC60114PlaybackCoverage(missing).budgets[0])
        .integrityFailures,
    ).toContain("PLAN_PLAYBACK_SEGMENT_NOT_FOUND:absent");
  });

  it("validates the Gold component source identity independently from machine artifacts", () => {
    const input = fixture();
    required(input.errorComponents[0]).sourceIdentity = {
      ...input.sourceIdentity,
      sourceMediaSha256: "e".repeat(64),
    };
    const result = evaluateC60114PlaybackCoverage(input);
    expect(result.route).toBe("HOLD_FOR_EVALUATION_INTEGRITY_REPAIR");
    expect(result.integrityFailures).toContain(
      "SOURCE_IDENTITY_MISMATCH:errorComponents:0:sourceMediaSha256",
    );
  });

  it("applies integrity/lineage/detection/localization/audio precedence with lexical advisories and keeps C602 held", () => {
    const input = fixture();
    input.lexicalEvidence = [];
    expect(evaluateC60114PlaybackCoverage(input).route).toBe(
      "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
    );
    input.speechIslands = [];
    input.orphans = [];
    expect(evaluateC60114PlaybackCoverage(input).route).toBe(
      "HOLD_FOR_MACHINE_SPEECH_DETECTION_REPAIR",
    );
    input.plans.forEach((row) => {
      row.playbackSegmentIds = [];
    });
    expect(evaluateC60114PlaybackCoverage(input).route).toBe(
      "HOLD_FOR_MACHINE_SPEECH_DETECTION_REPAIR",
    );
    input.engineeringGates.baselineParityPassed = false;
    const result = evaluateC60114PlaybackCoverage(input);
    expect(result.route).toBe("HOLD_FOR_ENGINEERING_REPAIR");
    expect(result.c602Status).toBe("HOLD");
  });

  it("makes an audible lexical deficit advisory, independent of the mandatory subset", () => {
    const input = fixture();
    input.lexicalEvidence = [];
    const mandatory = required(
      input.plans.find((row) => row.planId === "ALL_MANDATORY"),
    );
    mandatory.playbackSegmentIds = [];
    const result = evaluateC60114PlaybackCoverage(input);
    expect(result.route).toBe("GO_C6_0_1_15_REGION_RANKER_RECALIBRATION");
    expect(result.routeDecision.blockers).toEqual([]);
    expect(
      result.routeDecision.advisories.map((row) => row.diagnosis),
    ).toContain("LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE");
    expect(
      required(result.budgets.find((row) => row.planId === "ALL_MANDATORY"))
        .officialMissingRecall.recall,
    ).toBe(0);
    expect(result.routeDecision.mandatorySubsetRecallIsBlocking).toBe(false);
  });

  it("diagnoses unverified positive source hints before downstream playback omissions without granting coverage", () => {
    const input = fixture();
    input.speechIslands = [];
    input.lexicalEvidence = [];
    input.orphans = [];
    input.lineageEvidence = [
      {
        evidenceId: "unverified-speech",
        sourceIdentity: input.sourceIdentity,
        claimedInterval: interval(10, 12),
        status: "QUARANTINED_INSUFFICIENT_PROVENANCE",
        speechPositive: true,
      },
    ];
    input.plans.forEach((row) => {
      row.playbackSegmentIds = [];
    });
    const result = evaluateC60114PlaybackCoverage(input);
    expect(result.route).toBe("HOLD_FOR_SOURCE_GLOBAL_LINEAGE_REPAIR");
    expect(
      required(result.routeDecision.perComponentDiagnoses[0]).primaryDiagnosis,
    ).toBe("SOURCE_GLOBAL_LINEAGE_UNVERIFIED");
    expect(full(input).officialMissingRecall.recall).toBe(0);
    expect(
      required(full(input).componentCoverage[0]).layers.machineSpeech.any,
    ).toBe(false);
  });

  it("requires review localization when verified speech exists outside all targets and regions", () => {
    const input = fixture();
    required(input.errorComponents[0]).errorIntervals = [interval(50, 52)];
    required(input.speechIslands[0]).sourceInterval = interval(50, 52);
    input.lexicalEvidence = [];
    expect(evaluateC60114PlaybackCoverage(input).route).toBe(
      "HOLD_FOR_REVIEW_LOCALIZATION_REPAIR",
    );
  });
});

const alignment = (
  alignmentId: string,
  start: number,
  end: number,
): MachineVsGoldEvaluation["alignments"][number] => ({
  alignmentId,
  machineCueIndexes: [],
  goldCueIndexes: [0],
  machineTextHash: null,
  goldTextHash: hash,
  machineExcerpt: "",
  goldExcerpt: "synthetic",
  machineStart: null,
  machineEnd: null,
  goldStart: start,
  goldEnd: end,
  textSimilarity: 0,
  temporalIoU: 0,
  centerDistanceSeconds: null,
  startDeltaSeconds: null,
  endDeltaSeconds: null,
  centerDeltaSeconds: null,
  classification: "unmatched-gold",
});

describe("C6.0.1.14 post-freeze evaluation adapter", () => {
  it("preserves defect IDs and atomic intervals with no rematching or envelope flattening", () => {
    const evaluation = {
      sourceIdentity: { fileName: "synthetic.mkv", size: 1, sha256: hash },
      alignments: [alignment("a", 10, 11), alignment("b", 20, 21)],
      missingDialogueCandidates: [
        {
          defectId: "defect",
          code: "MISSING_DIALOGUE",
          severity: "P0" as const,
          alignmentIds: ["a", "b", "a"],
          rationale: "synthetic",
        },
      ],
      hallucinationCandidates: [],
      materialTextErrors: [],
      severeTimingErrors: [],
    };
    const before = JSON.stringify(evaluation);
    const result = c60114GoldErrorComponents(
      evaluation,
      [
        {
          errorComponentId: "defect",
          coveredItemIds: ["item"],
          coveredRegionIds: ["region"],
        },
      ],
      fixture().sourceIdentity,
    );
    expect(required(result[0]).errorComponentId).toBe("defect");
    expect(required(result[0]).errorIntervals).toEqual([
      interval(10, 11),
      interval(20, 21),
    ]);
    expect(required(result[0]).alignmentIds).toEqual(["a", "b"]);
    expect(JSON.stringify(evaluation)).toBe(before);
  });

  it("retains unresolved mapping rather than silently removing the defect", () => {
    const result = c60114GoldErrorComponents(
      {
        sourceIdentity: { fileName: "synthetic.mkv", size: 1, sha256: hash },
        alignments: [],
        missingDialogueCandidates: [
          {
            defectId: "defect",
            code: "MISSING_DIALOGUE",
            severity: "P0",
            alignmentIds: ["missing"],
            rationale: "synthetic",
          },
        ],
        hallucinationCandidates: [],
        materialTextErrors: [],
        severeTimingErrors: [],
      },
      [],
      fixture().sourceIdentity,
    );
    expect(result).toHaveLength(1);
    expect(required(result[0]).mappingStatus).toBe("GOLD_MAPPING_UNRESOLVED");
    expect(required(result[0]).errorIntervals).toEqual([]);
  });

  it("rejects upstream Gold evaluation from a different source media", () => {
    expect(() =>
      c60114GoldErrorComponents(
        {
          sourceIdentity: {
            fileName: "synthetic.mkv",
            size: 1,
            sha256: "e".repeat(64),
          },
          alignments: [],
          missingDialogueCandidates: [],
          hallucinationCandidates: [],
          materialTextErrors: [],
          severeTimingErrors: [],
        },
        [],
        fixture().sourceIdentity,
      ),
    ).toThrow("GOLD_EVALUATION_SOURCE_IDENTITY_MISMATCH");
  });

  it("does not invoke the Gold loader until every frozen hash and source check passes", async () => {
    const calls: string[] = [];
    const verify = {
      freezeSha256: hash,
      verifiedArtifactCount: 2,
      expectedArtifactCount: 2,
      allHashesMatch: true,
      sourceIdentityVerified: true,
      runtimeGoldInputCount: 0,
    };
    await expect(
      withC60114PostFreezeGold({
        verifyMachineFreeze: () => {
          calls.push("verify");
          return Promise.resolve({ ...verify, allHashesMatch: false });
        },
        loadGoldAfterVerifiedFreeze: () => {
          calls.push("gold");
          return Promise.resolve("unexpected");
        },
      }),
    ).rejects.toThrow("NOT_VERIFIED_BEFORE_GOLD_READ");
    expect(calls).toEqual(["verify"]);
    await expect(
      withC60114PostFreezeGold({
        verifyMachineFreeze: () => {
          calls.push("verify-ok");
          return Promise.resolve(verify);
        },
        loadGoldAfterVerifiedFreeze: () => {
          calls.push("gold-ok");
          return Promise.resolve("synthetic");
        },
      }),
    ).resolves.toBe("synthetic");
    expect(calls).toEqual(["verify", "verify-ok", "gold-ok"]);
  });
});
