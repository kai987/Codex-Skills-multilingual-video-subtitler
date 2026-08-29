import {
  c60111PolicyVersion,
  machineCrossModelDiscriminatorFeaturesSchema,
  type MachineCrossModelArbitrationEvidence,
  type MachineCrossModelCalibrationCorpus,
  type MachineCrossModelDiscriminatorFeatures,
  type MachineIndependentAcousticDiscriminator,
  type MachinePairedWhisperEvidence,
} from "@mvl/shared";

import {
  normalizeIndependentAsrLexical,
  normalizedEditSimilarity,
} from "./cross-model-normalization.js";
import { machineQualitySemanticHash } from "./evidence-correlation.js";

export const C60111_FEATURE_GROUPS = {
  M0: [
    "relationLexicalDisagreement",
    "relationWhisperHallucinationRisk",
    "whisperNegativeEvidence",
    "whisperDecoderStrongError",
    "whisperTokenStrongError",
    "requestEdgeStrongError",
    "speechCompletenessStrongError",
    "reazonCoreStable",
    "reazonContextExtensionOnly",
    "reazonLexicallyUnstable",
    "normalizedDistance",
    "pronunciationDistance",
    "whisperHallucinationRisk",
    "reazonHallucinationRisk",
    "oldCtcMargin",
    "oldCtcScorable",
  ],
  PAIRED_WHISPER: [
    "whisperCoreStable",
    "whisperContextExtensionOnly",
    "whisperLexicallyUnstable",
    "whisperHallucinationUnstable",
    "whisperEmptyUnstable",
    "whisperPartialAgreement",
    "whisperPairedMissing",
  ],
  INDEPENDENT: ["independentMargin", "independentScorable"],
  GENERIC: [
    "coreDurationSeconds",
    "whisperTextDensity",
    "reazonTextDensity",
    "machineLocalizationQuality",
  ],
} as const;

function evidenceStrongError(value: {
  status: string;
  strong: boolean;
}): number {
  return value.strong && value.status === "POSITIVE_ERROR_EVIDENCE" ? 1 : 0;
}

export function c60111FeatureSets(): Record<
  "M0" | "M1" | "M2" | "M3" | "M4" | "M5",
  string[]
> {
  const old = [...C60111_FEATURE_GROUPS.M0];
  const paired = [...C60111_FEATURE_GROUPS.PAIRED_WHISPER];
  const independent = [...C60111_FEATURE_GROUPS.INDEPENDENT];
  const generic = [...C60111_FEATURE_GROUPS.GENERIC];
  const withoutOldCtc = old.filter(
    (name) => !["oldCtcMargin", "oldCtcScorable"].includes(name),
  );
  return {
    M0: old,
    M1: [...old, ...paired],
    M2: [...old, ...independent],
    M3: [...old, ...paired, ...independent, ...generic],
    M4: [...withoutOldCtc, ...paired, ...independent, ...generic],
    M5: independent,
  };
}

export function buildCrossModelDiscriminatorFeatures(input: {
  generatedAt: string;
  corpus: MachineCrossModelCalibrationCorpus;
  baselineEvidence: MachineCrossModelArbitrationEvidence;
  pairedWhisper: MachinePairedWhisperEvidence;
  independentDiscriminator: MachineIndependentAcousticDiscriminator;
}): MachineCrossModelDiscriminatorFeatures {
  const baselineByEvent = new Map(
    input.baselineEvidence.events.map((event) => [event.eventId, event]),
  );
  const pairedByEvent = new Map(
    input.pairedWhisper.events.map((event) => [event.eventId, event]),
  );
  const independentByEvent = new Map(
    input.independentDiscriminator.events.map((event) => [event.eventId, event]),
  );
  const featureNames = [
    ...new Set(Object.values(C60111_FEATURE_GROUPS).flat()),
  ].toSorted();
  const events = input.corpus.events.map((corpusEvent) => {
    const baseline = baselineByEvent.get(corpusEvent.eventId);
    const paired = pairedByEvent.get(corpusEvent.eventId);
    const independent = independentByEvent.get(corpusEvent.eventId);
    if (baseline === undefined || paired === undefined) {
      throw new Error(`Missing machine feature source for ${corpusEvent.eventId}.`);
    }
    const duration = corpusEvent.coreInterval.end - corpusEvent.coreInterval.start;
    const whisperTextLength = Array.from(
      normalizeIndependentAsrLexical(
        baseline.currentWhisperCandidate.displayText,
      ),
    ).length;
    const reazonText = baseline.reazonCoreExactCandidate?.displayText ?? "";
    const reazonTextLength = Array.from(
      normalizeIndependentAsrLexical(reazonText),
    ).length;
    const stability = paired.stabilityClass;
    const oldCtcMargin =
      baseline.ctcWhisperSupport === null || baseline.ctcReazonSupport === null
        ? null
        : baseline.ctcReazonSupport - baseline.ctcWhisperSupport;
    const featureValues: Record<string, number | null> = {
      relationLexicalDisagreement:
        baseline.crossModelRelation === "LEXICAL_DISAGREEMENT" ? 1 : 0,
      relationWhisperHallucinationRisk:
        baseline.crossModelRelation === "WHISPER_HALLUCINATION_RISK" ? 1 : 0,
      whisperNegativeEvidence: baseline.whisperStability.negativeEvidence ? 1 : 0,
      whisperDecoderStrongError: evidenceStrongError(
        baseline.whisperDecoderEvidence,
      ),
      whisperTokenStrongError: evidenceStrongError(baseline.whisperTokenEvidence),
      requestEdgeStrongError: evidenceStrongError(baseline.requestEdgeEvidence),
      speechCompletenessStrongError: evidenceStrongError(
        baseline.speechCompletenessEvidence,
      ),
      reazonCoreStable:
        baseline.reazonStability.class === "REAZON_CORE_STABLE" ? 1 : 0,
      reazonContextExtensionOnly:
        baseline.reazonStability.class === "REAZON_CONTEXT_EXTENSION_ONLY"
          ? 1
          : 0,
      reazonLexicallyUnstable:
        baseline.reazonStability.class === "REAZON_LEXICALLY_UNSTABLE" ? 1 : 0,
      normalizedDistance:
        1 -
        normalizedEditSimilarity(
          baseline.currentWhisperCandidate.normalizedDisplayText,
          baseline.reazonCoreExactCandidate?.normalizedDisplayText ?? "",
        ),
      pronunciationDistance:
        1 -
        normalizedEditSimilarity(
          baseline.currentWhisperCandidate.pronunciationText,
          baseline.reazonCoreExactCandidate?.pronunciationText ?? "",
        ),
      whisperHallucinationRisk: baseline.whisperHallucinationRisk,
      reazonHallucinationRisk: baseline.reazonHallucinationRisk,
      oldCtcMargin,
      oldCtcScorable: oldCtcMargin === null ? 0 : 1,
      whisperCoreStable: stability === "WHISPER_CORE_STABLE" ? 1 : 0,
      whisperContextExtensionOnly:
        stability === "WHISPER_CONTEXT_EXTENSION_ONLY" ? 1 : 0,
      whisperLexicallyUnstable:
        stability === "WHISPER_LEXICALLY_UNSTABLE" ? 1 : 0,
      whisperHallucinationUnstable:
        stability === "WHISPER_HALLUCINATION_UNSTABLE" ? 1 : 0,
      whisperEmptyUnstable:
        stability === "WHISPER_EMPTY_UNSTABLE" ? 1 : 0,
      whisperPartialAgreement:
        stability === "WHISPER_PARTIAL_AGREEMENT" ? 1 : 0,
      whisperPairedMissing: stability === "WHISPER_UNCOMPARABLE" ? 1 : 0,
      independentMargin: independent?.pairwiseMargin ?? null,
      independentScorable: independent?.scorability === "SCORABLE" ? 1 : 0,
      coreDurationSeconds: duration,
      whisperTextDensity: whisperTextLength / Math.max(0.1, duration),
      reazonTextDensity: reazonTextLength / Math.max(0.1, duration),
      machineLocalizationQuality:
        baseline.coreLocalizationStatus === "VERIFIED"
          ? 1
          : baseline.coreLocalizationStatus === "MACHINE_LOCALIZABLE"
            ? 0.75
            : 0.5,
    };
    const missingIndicators = Object.fromEntries(
      featureNames.map((name) => [name, featureValues[name] === null]),
    );
    const core = {
      eventId: corpusEvent.eventId,
      audioGroupId: corpusEvent.audioGroupId,
      featureValues,
      missingIndicators,
      metadata: {
        coreStart: corpusEvent.coreInterval.start,
        coreEnd: corpusEvent.coreInterval.end,
        mutationSafetyEligible: [
          "SAFE_EXACT_SPAN",
          "SAFE_NORMALIZED_EXACT_SPAN",
        ].includes(baseline.mutationSafetyStatus),
        spanLineageStatus: baseline.textSpanLineageStatus,
      },
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const featureSchemaHash = machineQualitySemanticHash({
    policyVersion: c60111PolicyVersion,
    featureNames,
    missingPolicy: "train-fold-median-plus-indicator-v1",
    scalingPolicy: "train-fold-standardization-v1",
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-cross-model-discriminator-features" as const,
    corpusSemanticHash: input.corpus.semanticHash,
    pairedWhisperSemanticHash: input.pairedWhisper.semanticHash,
    independentDiscriminatorSemanticHash:
      input.independentDiscriminator.semanticHash,
    featureSchemaHash,
    featureNames,
    featuresFrozenBeforeGold: true as const,
    events,
    audit: {
      rawTextFeatureCount: 0 as const,
      datasetSpecificFeatureCount: 0 as const,
      eventIdSemanticFeatureCount: 0 as const,
      goldFeatureCount: 0 as const,
      fullDataImputationCount: 0 as const,
      fullDataStandardizationCount: 0 as const,
    },
    runtimeGoldInputCount: 0 as const,
  };
  return machineCrossModelDiscriminatorFeaturesSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({ ...core, generatedAt: undefined }),
  });
}

