import {
  c6019PolicyVersion,
  machineCrossModelComparisonSchema,
  type MachineCrossModelComparison,
  type MachineIndependentAsrCandidates,
  type MachineSecondAsrDiagnosticSet,
} from "@mvl/shared";

import {
  compareCrossModelText,
  type CrossModelTextView,
} from "./cross-model-normalization.js";
import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface WhisperComparisonCandidate extends CrossModelTextView {
  candidateId: string;
  eventId: string;
}

export function buildMachineCrossModelComparison(input: {
  generatedAt: string;
  diagnosticSet: MachineSecondAsrDiagnosticSet;
  independentCandidates: MachineIndependentAsrCandidates;
  whisperCandidates: readonly WhisperComparisonCandidate[];
}): MachineCrossModelComparison {
  const events = input.diagnosticSet.events.map((diagnostic) => {
    const whisperCandidates = input.whisperCandidates.filter(
      (candidate) => candidate.eventId === diagnostic.eventId,
    );
    const reazon = input.independentCandidates.candidates.find(
      (candidate) =>
        candidate.eventId === diagnostic.eventId &&
        candidate.windowType === "CORE_EXACT",
    );
    if (reazon === undefined)
      throw new Error(`Missing Reazon CORE_EXACT for ${diagnostic.eventId}.`);
    const reazonCandidate = {
      candidateId: reazon.candidateId,
      displayText: reazon.displayText,
      normalizedDisplayText: reazon.normalizedDisplayText,
      pronunciationText: reazon.pronunciationText,
      hallucinationRisk: reazon.diagnostics.repetitionRisk,
    };
    const comparisons = whisperCandidates.map((candidate) =>
      compareCrossModelText(candidate, reazonCandidate),
    );
    const best = comparisons.toSorted(
      (left, right) =>
        right.pronunciationSimilarity - left.pronunciationSimilarity ||
        right.normalizedSimilarity - left.normalizedSimilarity,
    )[0];
    const core = {
      eventId: diagnostic.eventId,
      diagnosticRole: diagnostic.role,
      whisperCandidates: whisperCandidates.map(
        ({ eventId: _eventId, ...candidate }) => candidate,
      ),
      reazonCandidate,
      exactAgreement: comparisons.some(
        (comparison) => comparison.exactAgreement,
      ),
      normalizedAgreement: comparisons.some(
        (comparison) => comparison.normalizedAgreement,
      ),
      pronunciationAgreement: comparisons.some(
        (comparison) => comparison.pronunciationAgreement,
      ),
      bestNormalizedSimilarity: Math.max(
        0,
        ...comparisons.map((value) => value.normalizedSimilarity),
      ),
      bestPronunciationSimilarity: Math.max(
        0,
        ...comparisons.map((value) => value.pronunciationSimilarity),
      ),
      disagreementClass: best?.disagreementClass ?? ("WHISPER_EMPTY" as const),
      providerDiagnostics: [
        "Reazon CORE_EXACT is core-localized by extraction boundary.",
        "Reazon point timestamps are not interpreted as character intervals.",
        "CORE_CONTEXT remains diagnostic when reliable token intervals are unavailable.",
      ],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const count = (
    value: MachineCrossModelComparison["events"][number]["disagreementClass"],
  ) => events.filter((event) => event.disagreementClass === value).length;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6019PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-cross-model-comparison" as const,
    diagnosticSetSemanticHash: input.diagnosticSet.semanticHash,
    independentCandidatesSemanticHash: input.independentCandidates.semanticHash,
    events,
    summary: {
      eventCount: 24 as const,
      exactAgreementCount: count("EXACT_AGREEMENT"),
      normalizedAgreementCount: count("NORMALIZED_AGREEMENT"),
      pronunciationAgreementCount: count("PRONUNCIATION_AGREEMENT"),
      orthographyOnlyDifferenceCount: count("ORTHOGRAPHY_ONLY_DIFFERENCE"),
      lexicalDisagreementCount: count("LEXICAL_DISAGREEMENT"),
      whisperHallucinationRiskCount: count("WHISPER_HALLUCINATION_RISK"),
      reazonHallucinationRiskCount: count("REAZON_HALLUCINATION_RISK"),
      bothLowSupportCount: count("BOTH_LOW_SUPPORT"),
      reazonEmptyCount: count("REAZON_EMPTY"),
      whisperEmptyCount: count("WHISPER_EMPTY"),
      uncomparableCount: count("UNCOMPARABLE"),
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineCrossModelComparisonSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
