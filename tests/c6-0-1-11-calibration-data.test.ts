import type {
  MachineCrossModelArbitrationEvidence,
  MachineCrossModelCalibrationCorpus,
  MachineIndependentAcousticDiscriminator,
  MachinePairedWhisperEvidence,
} from "@mvl/shared";
import {
  buildC60111CalibrationFolds,
  buildCrossModelDiscriminatorFeatures,
  buildGoldCrossModelCalibrationLabels,
  c60111FeatureSets,
  machineQualitySemanticHash,
  overlappingAudioAcrossFolds,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const HASH = "c".repeat(64);
const GENERATED_AT = "2026-08-29T12:00:00.000Z";

function corpus(): MachineCrossModelCalibrationCorpus {
  const events = Array.from({ length: 10 }, (_, index) => {
    const start = index * 2;
    return {
      eventId: `event-${index + 1}`,
      role: index < 8 ? ("DISAGREEMENT" as const) : ("CONTROL" as const),
      sourceInterval: { start, end: start + 1.5 },
      coreInterval: { start: start + 0.25, end: start + 1.25 },
      crossModelRelation: "LEXICAL_DISAGREEMENT" as const,
      selectionReasons: ["machine-only"],
      audioGroupId: `group-${index}`,
      goldSeenAtSelection: false as const,
      semanticHash: machineQualitySemanticHash({ index }),
    };
  });
  return {
    semanticHash: HASH,
    events,
  } as unknown as MachineCrossModelCalibrationCorpus;
}

describe("C6.0.1.11 Gold-isolated calibration data", () => {
  it("constructs contiguous grouped folds before labels with zero overlap", () => {
    const folds = buildC60111CalibrationFolds({
      generatedAt: GENERATED_AT,
      corpus: corpus(),
    });
    expect(folds.foldCount).toBe(5);
    expect(folds.constructedBeforeLabels).toBe(true);
    expect(folds.randomSplitUsed).toBe(false);
    expect(new Set(folds.assignments.map((value) => value.fold)).size).toBe(5);
    expect(overlappingAudioAcrossFolds(folds)).toBe(0);
  });

  it("labels local errors only after feature and fold freeze", () => {
    const calibration = corpus();
    const folds = buildC60111CalibrationFolds({
      generatedAt: GENERATED_AT,
      corpus: calibration,
    });
    const features = {
      featuresFrozenBeforeGold: true,
      semanticHash: "d".repeat(64),
    } as never;
    const labels = buildGoldCrossModelCalibrationLabels({
      generatedAt: GENERATED_AT,
      corpus: calibration,
      features,
      folds,
      goldEvaluation: {
        goldIdentityHash: "e".repeat(64),
        events: calibration.events.map((event, index) => ({
          eventId: event.eventId,
          evaluationStatus: "EVALUABLE_LOCAL",
          baselineWhisperPoolError: index % 3 === 0 ? 5 : 2,
          reazonCoreExactError: index % 3 === 0 ? 1 : index % 3 === 1 ? 4 : 2,
          semanticHash: machineQualitySemanticHash({ gold: index }),
        })),
      },
    });
    expect(labels.datasetRole).toBe("CALIBRATION_DATASET");
    expect(labels.fullGoldTextIncluded).toBe(false);
    expect(labels.summary).toMatchObject({
      reazonBetterCount: 4,
      whisperBetterCount: 3,
      equivalentCount: 3,
      unevaluableCount: 0,
    });
  });

  it("builds generic numeric features and keeps text, Gold, and IDs out", () => {
    const calibration = {
      ...corpus(),
      events: corpus().events.slice(0, 1),
    } as MachineCrossModelCalibrationCorpus;
    const baseline = {
      semanticHash: "f".repeat(64),
      events: [
        {
          eventId: "event-1",
          crossModelRelation: "LEXICAL_DISAGREEMENT",
          currentWhisperCandidate: {
            displayText: "字幕候補",
            normalizedDisplayText: "字幕候補",
            pronunciationText: "じまくこうほ",
          },
          reazonCoreExactCandidate: {
            displayText: "別候補",
            normalizedDisplayText: "別候補",
            pronunciationText: "べつこうほ",
          },
          whisperHallucinationRisk: 0.1,
          reazonHallucinationRisk: 0.2,
          whisperStability: { negativeEvidence: false },
          reazonStability: { class: "REAZON_CORE_STABLE" },
          whisperDecoderEvidence: { status: "UNKNOWN", strong: false },
          whisperTokenEvidence: { status: "UNKNOWN", strong: false },
          requestEdgeEvidence: { status: "UNKNOWN", strong: false },
          speechCompletenessEvidence: { status: "UNKNOWN", strong: false },
          ctcWhisperSupport: null,
          ctcReazonSupport: null,
          coreLocalizationStatus: "MACHINE_LOCALIZABLE",
          mutationSafetyStatus: "BLOCKED",
          textSpanLineageStatus: "UNRESOLVED",
        },
      ],
    } as unknown as MachineCrossModelArbitrationEvidence;
    const paired = {
      semanticHash: "1".repeat(64),
      events: [
        {
          eventId: "event-1",
          stabilityClass: "WHISPER_LEXICALLY_UNSTABLE",
        },
      ],
    } as unknown as MachinePairedWhisperEvidence;
    const independent = {
      semanticHash: "2".repeat(64),
      events: [
        {
          eventId: "event-1",
          pairwiseMargin: 0.7,
          scorability: "SCORABLE",
        },
      ],
    } as unknown as MachineIndependentAcousticDiscriminator;
    const features = buildCrossModelDiscriminatorFeatures({
      generatedAt: GENERATED_AT,
      corpus: calibration,
      baselineEvidence: baseline,
      pairedWhisper: paired,
      independentDiscriminator: independent,
    });
    expect(features.audit).toEqual({
      rawTextFeatureCount: 0,
      datasetSpecificFeatureCount: 0,
      eventIdSemanticFeatureCount: 0,
      goldFeatureCount: 0,
      fullDataImputationCount: 0,
      fullDataStandardizationCount: 0,
    });
    expect(features.events[0]?.featureValues.independentMargin).toBe(0.7);
    expect(Object.values(c60111FeatureSets()).every((set) => set.length > 0)).toBe(
      true,
    );
  });
});
