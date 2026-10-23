import {
  c6018PolicyVersion,
  coreAsrStabilityClassSchema,
  machineCoreAsrStabilitySchema,
  type C6018ObserveMode,
  type CoreAsrStabilityClass,
  type CoreTextProjectionCandidate,
  type MachineCoreAsrStability,
  type MachineCoreTextProjection,
  type MachineLocalizedCandidateComparability,
} from "@mvl/shared";

import {
  candidateTextSimilarity,
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

function repeatedUnitRisk(text: string): boolean {
  const normalized = normalizeCandidateText(text);
  if (normalized.length < 6) return false;
  for (let unitLength = 1; unitLength <= 3; unitLength += 1) {
    const unit = normalized.slice(0, unitLength);
    if (
      unit.repeat(Math.floor(normalized.length / unitLength)) === normalized
    ) {
      return true;
    }
  }
  return false;
}

function genericHallucinationEvidence(
  candidate: CoreTextProjectionCandidate,
): boolean {
  const replacementCharacterCount = Array.from(candidate.fullWindowText).filter(
    (value) => value === "�",
  ).length;
  return (
    replacementCharacterCount >= 2 ||
    repeatedUnitRisk(candidate.fullWindowText) ||
    ((candidate.averageTokenProbability ?? 1) < 0.18 &&
      normalizeCandidateText(candidate.fullWindowText).length >= 4 &&
      candidate.coreCoverage >= 0.8)
  );
}

function classify(input: {
  comparabilityStatus: string;
  candidates: readonly CoreTextProjectionCandidate[];
  speakerMixed: boolean;
}): {
  value: CoreAsrStabilityClass;
  contextDifferenceObserved: boolean;
  adjacentContaminationObserved: boolean;
  hallucinationEvidenceObserved: boolean;
  blockers: string[];
} {
  if (input.comparabilityStatus === "UNLOCALIZABLE") {
    return {
      value: "UNLOCALIZABLE",
      contextDifferenceObserved: false,
      adjacentContaminationObserved: false,
      hallucinationEvidenceObserved: false,
      blockers: ["localized-candidate-comparability-unavailable"],
    };
  }
  if (input.comparabilityStatus === "OVERLAP_AMBIGUOUS") {
    return {
      value: input.speakerMixed ? "SPEAKER_CONTENT_MIX" : "UNEVALUABLE",
      contextDifferenceObserved: false,
      adjacentContaminationObserved: false,
      hallucinationEvidenceObserved: false,
      blockers: ["overlap-core-remains-machine-ambiguous"],
    };
  }
  const withCore = input.candidates.filter(
    (candidate) => normalizeCandidateText(candidate.coreProjectedText) !== "",
  );
  const distinctCoreTexts = new Set(
    withCore.map((candidate) =>
      normalizeCandidateText(candidate.coreProjectedText),
    ),
  );
  const distinctFullTexts = new Set(
    withCore.map((candidate) =>
      normalizeCandidateText(candidate.fullWindowText),
    ),
  );
  const contextDifferenceObserved =
    distinctFullTexts.size > distinctCoreTexts.size ||
    withCore.some(
      (candidate) =>
        normalizeCandidateText(candidate.preCoreText) !== "" ||
        normalizeCandidateText(candidate.postCoreText) !== "",
    );
  const adjacentContaminationObserved = withCore.some((candidate) => {
    const context = `${candidate.preCoreText}${candidate.postCoreText}`;
    return (
      normalizeCandidateText(context) !== "" &&
      candidateTextSimilarity(context, candidate.coreProjectedText) < 0.2
    );
  });
  const hallucinationEvidenceObserved = withCore.some(
    genericHallucinationEvidence,
  );
  if (input.speakerMixed) {
    return {
      value: "SPEAKER_CONTENT_MIX",
      contextDifferenceObserved,
      adjacentContaminationObserved,
      hallucinationEvidenceObserved,
      blockers: [],
    };
  }
  if (withCore.length === 0) {
    return {
      value: "UNLOCALIZABLE",
      contextDifferenceObserved,
      adjacentContaminationObserved,
      hallucinationEvidenceObserved,
      blockers: ["no-candidate-has-localized-core-text"],
    };
  }
  if (distinctCoreTexts.size === 1) {
    return {
      value: contextDifferenceObserved
        ? "CONTEXT_ONLY_DIFFERENCE"
        : "CORE_TEXT_CONSISTENT",
      contextDifferenceObserved,
      adjacentContaminationObserved,
      hallucinationEvidenceObserved,
      blockers: [],
    };
  }
  if (hallucinationEvidenceObserved) {
    return {
      value: "HALLUCINATION_DISAGREEMENT",
      contextDifferenceObserved,
      adjacentContaminationObserved,
      hallucinationEvidenceObserved,
      blockers: [],
    };
  }
  if (
    adjacentContaminationObserved &&
    input.comparabilityStatus === "PARTIALLY_COMPARABLE"
  ) {
    return {
      value: "ADJACENT_UTTERANCE_CONTAMINATION",
      contextDifferenceObserved,
      adjacentContaminationObserved,
      hallucinationEvidenceObserved,
      blockers: ["cross-event-localization-remains-partial"],
    };
  }
  const counts = new Map<string, number>();
  for (const candidate of withCore) {
    const normalized = normalizeCandidateText(candidate.coreProjectedText);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  if ([...counts.values()].some((value) => value >= 2)) {
    return {
      value: "PARTIAL_CORE_AGREEMENT",
      contextDifferenceObserved,
      adjacentContaminationObserved,
      hallucinationEvidenceObserved,
      blockers: [],
    };
  }
  return {
    value: "LEXICAL_CORE_DISAGREEMENT",
    contextDifferenceObserved,
    adjacentContaminationObserved,
    hallucinationEvidenceObserved,
    blockers: [],
  };
}

export function buildMachineCoreAsrStability(input: {
  mode: C6018ObserveMode;
  projection: MachineCoreTextProjection;
  comparability: MachineLocalizedCandidateComparability;
  machineSpeakerMixedEventIds?: ReadonlySet<string>;
  generatedAt?: string;
}): MachineCoreAsrStability {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const projectionByEvent = new Map<string, CoreTextProjectionCandidate[]>();
  for (const candidate of input.projection.candidates) {
    const values = projectionByEvent.get(candidate.eventId) ?? [];
    values.push(candidate);
    projectionByEvent.set(candidate.eventId, values);
  }
  const events = input.comparability.events.map((event) => {
    const candidates = projectionByEvent.get(event.eventId) ?? [];
    const classification = classify({
      comparabilityStatus: event.status,
      candidates,
      speakerMixed:
        input.machineSpeakerMixedEventIds?.has(event.eventId) ?? false,
    });
    const comparable = candidates.filter(
      (candidate) => normalizeCandidateText(candidate.coreProjectedText) !== "",
    );
    const comparableIds = comparable
      .map((candidate) => candidate.candidateId)
      .toSorted();
    const pairwise = event.pairwiseComparisons;
    const pronunciationValues = pairwise.flatMap((comparison) =>
      comparison.pronunciationAgreement === null
        ? []
        : [comparison.pronunciationAgreement],
    );
    const distinct = [
      ...new Set(
        comparable.map((candidate) =>
          machineQualitySemanticHash(
            normalizeCandidateText(candidate.coreProjectedText),
          ),
        ),
      ),
    ].toSorted();
    const core = {
      eventId: event.eventId,
      coreSpanId: `core-span:${event.eventId}`,
      candidateIds: candidates
        .map((candidate) => candidate.candidateId)
        .toSorted(),
      projectedTexts: comparable.map((candidate) => ({
        candidateId: candidate.candidateId,
        text: candidate.coreProjectedText,
        normalizedTextHash: candidate.normalizedCoreProjectedTextHash,
      })),
      fullTexts: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        text: candidate.fullWindowText,
        normalizedTextHash: candidate.normalizedFullWindowTextHash,
      })),
      stabilityClass: classification.value,
      class: classification.value,
      lexicalAgreement:
        pairwise.length === 0
          ? comparable.length <= 1
            ? 1
            : 0
          : pairwise.reduce(
              (sum, comparison) => sum + comparison.lexicalSimilarity,
              0,
            ) / pairwise.length,
      pronunciationAgreement:
        pronunciationValues.length === 0
          ? null
          : pronunciationValues.reduce((sum, value) => sum + value, 0) /
            pronunciationValues.length,
      localizationCoverage:
        candidates.length === 0 ? 0 : comparable.length / candidates.length,
      comparableCandidateIds: comparableIds,
      distinctCoreTextHashes: distinct,
      stableCoreTextHash: distinct.length === 1 ? (distinct[0] ?? null) : null,
      contextDifferenceObserved: classification.contextDifferenceObserved,
      adjacentContaminationObserved:
        classification.adjacentContaminationObserved,
      machineSpeakerMixObserved:
        input.machineSpeakerMixedEventIds?.has(event.eventId) ?? false,
      hallucinationEvidenceObserved:
        classification.hallucinationEvidenceObserved,
      supportingEvidenceIds: [event.semanticHash]
        .concat(comparable.map((candidate) => candidate.semanticHash))
        .toSorted(),
      blockers: classification.blockers,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const classCounts = Object.fromEntries(
    coreAsrStabilityClassSchema.options.map((value) => [
      value,
      events.filter((event) => event.class === value).length,
    ]),
  ) as Record<CoreAsrStabilityClass, number>;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6018PolicyVersion,
    generatedAt,
    artifactType: "machine-core-asr-stability" as const,
    mode: input.mode,
    comparabilitySemanticHash: input.comparability.semanticHash,
    speakerEvidencePolicy: "machine-evidence-only" as const,
    events,
    summary: {
      eventCount: events.length,
      classCounts,
      stableEventCount:
        classCounts.CORE_TEXT_CONSISTENT + classCounts.CONTEXT_ONLY_DIFFERENCE,
      lexicalInstabilityCount:
        classCounts.LEXICAL_CORE_DISAGREEMENT +
        classCounts.PARTIAL_CORE_AGREEMENT,
      hallucinationInstabilityCount: classCounts.HALLUCINATION_DISAGREEMENT,
      localizationBlockedCount:
        classCounts.UNLOCALIZABLE + classCounts.UNEVALUABLE,
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineCoreAsrStabilitySchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
