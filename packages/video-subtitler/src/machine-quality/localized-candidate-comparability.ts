import {
  c6018PolicyVersion,
  machineLocalizedCandidateComparabilitySchema,
  type C6018ObserveMode,
  type CoreTextProjectionCandidate,
  type LocalizedCandidateComparabilityEvent,
  type LocalizedComparabilityStatus,
  type MachineCoreAcousticSpan,
  type MachineCoreTextProjection,
  type MachineLocalizedCandidateComparability,
} from "@mvl/shared";

import {
  candidateTextSimilarity,
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function lexicalEditDistance(left: string, right: string): number {
  const leftValues = Array.from(normalizeCandidateText(left));
  const rightValues = Array.from(normalizeCandidateText(right));
  const previous = rightValues.map((_, index) => index + 1);
  previous.unshift(0);
  for (const [leftIndex, leftValue] of leftValues.entries()) {
    const current = [leftIndex + 1];
    for (const [rightIndex, rightValue] of rightValues.entries()) {
      current.push(
        Math.min(
          (current[rightIndex] ?? 0) + 1,
          (previous[rightIndex + 1] ?? 0) + 1,
          (previous[rightIndex] ?? 0) + (leftValue === rightValue ? 0 : 1),
        ),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous.at(-1) ?? 0;
}

function lexicalSimilarity(left: string, right: string): number {
  const maximum = Math.max(
    Array.from(normalizeCandidateText(left)).length,
    Array.from(normalizeCandidateText(right)).length,
  );
  if (maximum === 0) return 0;
  return bounded(1 - lexicalEditDistance(left, right) / maximum);
}

function projectedTokenCount(candidate: CoreTextProjectionCandidate): number {
  const projected = new Set(candidate.projectedTokenIds);
  return candidate.groupedTokens.reduce(
    (sum, group) =>
      sum +
      group.childTokenIds.filter((tokenId) => projected.has(tokenId)).length,
    0,
  );
}

function candidateSummary(candidate: CoreTextProjectionCandidate) {
  return {
    candidateId: candidate.candidateId,
    origin: candidate.origin,
    normalizedCoreTextHash: candidate.normalizedCoreProjectedTextHash,
    normalizedCoreTextLength: Array.from(
      normalizeCandidateText(candidate.coreProjectedText),
    ).length,
    projectionStatus: candidate.projectionStatus,
    tokenCount: projectedTokenCount(candidate),
    ctcSupport: candidate.ctcSupport,
    pronunciationSupport: candidate.pronunciationSupport,
    timingCoverage: candidate.coreCoverage,
  };
}

function pairwise(
  left: CoreTextProjectionCandidate,
  right: CoreTextProjectionCandidate,
) {
  const distance = lexicalEditDistance(
    left.coreProjectedText,
    right.coreProjectedText,
  );
  const similarity = lexicalSimilarity(
    left.coreProjectedText,
    right.coreProjectedText,
  );
  const pronunciationAgreement =
    left.pronunciationSupport === null || right.pronunciationSupport === null
      ? null
      : bounded(
          1 - Math.abs(left.pronunciationSupport - right.pronunciationSupport),
        );
  const ctcAgreement =
    left.ctcSupport === null || right.ctcSupport === null
      ? null
      : bounded(1 - Math.abs(left.ctcSupport - right.ctcSupport));
  const leftHasTiming = left.projectedTokenIds.length > 0;
  const rightHasTiming = right.projectedTokenIds.length > 0;
  const timingAgreement =
    leftHasTiming && rightHasTiming
      ? bounded(1 - Math.abs(left.coreCoverage - right.coreCoverage))
      : null;
  const sameCoreText =
    normalizeCandidateText(left.coreProjectedText) !== "" &&
    normalizeCandidateText(left.coreProjectedText) ===
      normalizeCandidateText(right.coreProjectedText);
  const core = {
    leftCandidateId: left.candidateId,
    rightCandidateId: right.candidateId,
    lexicalEditDistance: distance,
    lexicalSimilarity: similarity,
    tokenAgreement: candidateTextSimilarity(
      left.coreProjectedText,
      right.coreProjectedText,
    ),
    pronunciationAgreement,
    ctcAgreement,
    timingAgreement,
    sameCoreText,
    fullWindowOnlyDifference:
      sameCoreText &&
      normalizeCandidateText(left.fullWindowText) !==
        normalizeCandidateText(right.fullWindowText),
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

function comparisonStatus(input: {
  candidates: readonly CoreTextProjectionCandidate[];
  coreAmbiguous: boolean;
  overlapAmbiguous: boolean;
}): { status: LocalizedComparabilityStatus; blockers: string[] } {
  if (input.overlapAmbiguous) {
    return {
      status: "OVERLAP_AMBIGUOUS",
      blockers: ["machine-overlap-core-cannot-be-forcibly-separated"],
    };
  }
  const comparable = input.candidates.filter(
    (candidate) =>
      normalizeCandidateText(candidate.coreProjectedText) !== "" &&
      (candidate.projectionStatus === "EXACT_TOKEN_PROJECTED" ||
        candidate.projectionStatus === "PARTIAL_TOKEN_PROJECTED" ||
        candidate.projectionStatus === "CROSS_EVENT_AMBIGUOUS"),
  );
  if (comparable.length >= 2 && !input.coreAmbiguous) {
    return { status: "CORE_COMPARABLE", blockers: [] };
  }
  if (comparable.length >= 1) {
    return {
      status: "PARTIALLY_COMPARABLE",
      blockers: input.coreAmbiguous
        ? ["cross-event-core-ambiguity"]
        : ["only-one-localized-candidate"],
    };
  }
  if (
    input.candidates.filter(
      (candidate) => candidate.fullWindowText.trim() !== "",
    ).length >= 2
  ) {
    return {
      status: "CONTEXT_ONLY_COMPARABLE",
      blockers: ["candidate-text-exists-only-outside-localized-core"],
    };
  }
  return {
    status: "UNLOCALIZABLE",
    blockers: ["insufficient-token-or-whole-candidate-core-projection"],
  };
}

export function buildMachineLocalizedCandidateComparability(input: {
  mode: C6018ObserveMode;
  coreSpans: MachineCoreAcousticSpan;
  projection: MachineCoreTextProjection;
  generatedAt?: string;
}): MachineLocalizedCandidateComparability {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const candidatesByEvent = new Map<string, CoreTextProjectionCandidate[]>();
  for (const candidate of input.projection.candidates) {
    const values = candidatesByEvent.get(candidate.eventId) ?? [];
    values.push(candidate);
    candidatesByEvent.set(candidate.eventId, values);
  }
  const events: LocalizedCandidateComparabilityEvent[] = input.coreSpans.events
    .map((span) => {
      const candidates = (candidatesByEvent.get(span.eventId) ?? []).toSorted(
        (left, right) =>
          left.origin.localeCompare(right.origin) ||
          left.candidateId.localeCompare(right.candidateId),
      );
      const pairwiseComparisons = candidates.flatMap((left, leftIndex) =>
        candidates.slice(leftIndex + 1).map((right) => pairwise(left, right)),
      );
      const comparable = candidates.filter(
        (candidate) =>
          normalizeCandidateText(candidate.coreProjectedText) !== "",
      );
      const distinctCoreTextCount = new Set(
        comparable.map((candidate) =>
          normalizeCandidateText(candidate.coreProjectedText),
        ),
      ).size;
      const reasons = new Set(span.ambiguityReasons);
      const status = comparisonStatus({
        candidates,
        coreAmbiguous: reasons.has("CROSS_EVENT_CORE_AMBIGUITY"),
        overlapAmbiguous: reasons.has("OVERLAP_CORE_AMBIGUITY"),
      });
      const core = {
        eventId: span.eventId,
        coreInterval: {
          start: span.proposedCoreStart,
          end: span.proposedCoreEnd,
        },
        candidateIds: candidates
          .map((candidate) => candidate.candidateId)
          .toSorted(),
        comparableCandidateIds: comparable
          .map((candidate) => candidate.candidateId)
          .toSorted(),
        unprojectableCandidateIds: candidates
          .filter((candidate) =>
            [
              "UNTIMED_UNPROJECTABLE",
              "NO_CORE_CONTENT",
              "CONTEXT_ONLY_EXCESS",
            ].includes(candidate.projectionStatus),
          )
          .map((candidate) => candidate.candidateId)
          .toSorted(),
        coreTexts: comparable.map((candidate) => ({
          candidateId: candidate.candidateId,
          text: candidate.coreProjectedText,
          normalizedTextHash: candidate.normalizedCoreProjectedTextHash,
        })),
        candidates: candidates.map(candidateSummary),
        pairwiseRelations: pairwiseComparisons,
        pairwiseComparisons,
        comparableCandidateCount: comparable.length,
        distinctCoreTextCount,
        comparabilityStatus: status.status,
        status: status.status,
        blockers: status.blockers,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    })
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId));
  const countStatus = (status: LocalizedComparabilityStatus) =>
    events.filter((event) => event.status === status).length;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6018PolicyVersion,
    generatedAt,
    artifactType: "machine-localized-candidate-comparability" as const,
    mode: input.mode,
    coreSpanSemanticHash: input.coreSpans.semanticHash,
    projectionSemanticHash: input.projection.semanticHash,
    comparisonLocus: "same-source-global-core-span" as const,
    events,
    summary: {
      eventCount: events.length,
      coreComparableCount: countStatus("CORE_COMPARABLE"),
      partiallyComparableCount: countStatus("PARTIALLY_COMPARABLE"),
      contextOnlyComparableCount: countStatus("CONTEXT_ONLY_COMPARABLE"),
      unlocalizableCount: countStatus("UNLOCALIZABLE"),
      overlapAmbiguousCount: countStatus("OVERLAP_AMBIGUOUS"),
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineLocalizedCandidateComparabilitySchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
