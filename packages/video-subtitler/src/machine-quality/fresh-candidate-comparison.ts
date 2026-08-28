import {
  c6017PolicyVersion,
  machineFreshCandidateComparisonSchema,
  type C6017RiskSeverity,
  type FreshReAsrCandidate,
  type MachineFreshCandidateComparison,
} from "@mvl/shared";

import {
  candidateTextSimilarity,
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

export interface FreshComparisonCandidateInput {
  candidateId: string;
  eventId: string;
  origin: "ORIGINAL" | "RECOVERY" | "HISTORICAL_REASR" | "FRESH_REASR";
  text: string;
  ctcSupport: number | null;
  averageLogProbability: number | null;
  noSpeechProbability: number | null;
  independentWindowSupport: number;
  trustedTokenCoverage: number;
  speechCompleteness: number;
  requestEdgeRisk: C6017RiskSeverity;
  pronunciationSupport: number | null;
  repetitionRisk: number;
  hallucinationRisk: number;
  evidenceComplete: boolean;
}

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function decoderSupport(input: FreshComparisonCandidateInput): number | null {
  if (
    input.averageLogProbability === null ||
    input.noSpeechProbability === null
  ) {
    return null;
  }
  const probabilitySupport = bounded((input.averageLogProbability + 2) / 2);
  return bounded(
    probabilitySupport * 0.65 + (1 - input.noSpeechProbability) * 0.35,
  );
}

function evidencePassCount(input: FreshComparisonCandidateInput): number {
  return [
    input.ctcSupport !== null && input.ctcSupport >= 0.55,
    (decoderSupport(input) ?? 0) >= 0.5,
    input.independentWindowSupport >= 2,
    input.trustedTokenCoverage >= 0.65,
    input.speechCompleteness >= 0.85,
    input.requestEdgeRisk !== "STRONG",
    input.pronunciationSupport !== null && input.pronunciationSupport >= 0.55,
    input.repetitionRisk <= 0.2,
    input.hallucinationRisk <= 0.35,
  ].filter(Boolean).length;
}

function comparisonCandidate(input: FreshComparisonCandidateInput) {
  const core = {
    candidateId: input.candidateId,
    origin: input.origin,
    textHash: machineQualitySemanticHash(input.text),
    ctcSupport: input.ctcSupport,
    decoderSupport: decoderSupport(input),
    independentWindowSupport: input.independentWindowSupport,
    trustedTokenCoverage: bounded(input.trustedTokenCoverage),
    speechCompleteness: bounded(input.speechCompleteness),
    requestEdgeRisk: input.requestEdgeRisk,
    pronunciationSupport: input.pronunciationSupport,
    repetitionRisk: bounded(input.repetitionRisk),
    hallucinationRisk: bounded(input.hallucinationRisk),
    evidenceComplete: input.evidenceComplete,
    dominanceEvidenceCount: evidencePassCount(input),
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

function ranked(
  values: readonly ReturnType<typeof comparisonCandidate>[],
): ReturnType<typeof comparisonCandidate>[] {
  return values.toSorted(
    (left, right) =>
      Number(right.evidenceComplete) - Number(left.evidenceComplete) ||
      right.dominanceEvidenceCount - left.dominanceEvidenceCount ||
      (right.ctcSupport ?? -1) - (left.ctcSupport ?? -1) ||
      (right.decoderSupport ?? -1) - (left.decoderSupport ?? -1) ||
      right.independentWindowSupport - left.independentWindowSupport ||
      left.hallucinationRisk - right.hallucinationRisk ||
      left.repetitionRisk - right.repetitionRisk ||
      left.candidateId.localeCompare(right.candidateId),
  );
}

function freshStrictlyDominates(input: {
  fresh: ReturnType<typeof comparisonCandidate>;
  original: ReturnType<typeof comparisonCandidate>;
  textChanged: boolean;
}): boolean {
  const ctcGain =
    input.fresh.ctcSupport !== null &&
    (input.original.ctcSupport === null
      ? input.fresh.ctcSupport >= 0.55
      : input.fresh.ctcSupport >= input.original.ctcSupport + 0.08);
  const decoderNonDegrading =
    input.fresh.decoderSupport !== null &&
    (input.original.decoderSupport === null ||
      input.fresh.decoderSupport >= input.original.decoderSupport - 0.03);
  return (
    input.textChanged &&
    input.fresh.evidenceComplete &&
    input.fresh.independentWindowSupport >= 2 &&
    input.fresh.dominanceEvidenceCount >= 6 &&
    ctcGain &&
    decoderNonDegrading &&
    input.fresh.requestEdgeRisk !== "STRONG" &&
    input.fresh.hallucinationRisk <= 0.35
  );
}

export function freshCandidateInputs(
  candidates: readonly FreshReAsrCandidate[],
): FreshComparisonCandidateInput[] {
  return candidates.map((candidate) => {
    const lexicalTokens = candidate.tokenEvidenceIds.length;
    const mappedCoverage = candidate.globalTokenMappingVerified
      ? lexicalTokens === 0
        ? 0
        : 1
      : 0;
    const speechCompleteness = Math.min(
      1,
      Math.max(
        0,
        candidate.sourceGlobalInterval.end -
          candidate.sourceGlobalInterval.start >
          0
          ? 1
          : 0,
      ),
    );
    const noSpeech = candidate.decoderEvidence.noSpeechProbability ?? 1;
    const repetition = (() => {
      const text = Array.from(normalizeCandidateText(candidate.text));
      if (text.length < 2) return 0;
      const pairs = text
        .slice(0, -1)
        .map((value, index) => `${value}${text[index + 1] ?? ""}`);
      return 1 - new Set(pairs).size / pairs.length;
    })();
    return {
      candidateId: candidate.candidateId,
      eventId: candidate.eventId,
      origin: "FRESH_REASR" as const,
      text: candidate.text,
      ctcSupport: candidate.ctcEvidence.score,
      averageLogProbability: candidate.decoderEvidence.averageLogProbability,
      noSpeechProbability: candidate.decoderEvidence.noSpeechProbability,
      independentWindowSupport: candidate.windowSupportCount,
      trustedTokenCoverage: mappedCoverage,
      speechCompleteness,
      requestEdgeRisk: candidate.requestEdgeEvidence.severity,
      pronunciationSupport: candidate.ctcEvidence.score,
      repetitionRisk: repetition,
      hallucinationRisk: bounded(noSpeech * 0.7 + repetition * 0.3),
      evidenceComplete: candidate.evidenceComplete,
    };
  });
}

export function buildFreshCandidateComparison(input: {
  events: readonly {
    eventId: string;
    originalCandidateId: string;
    candidates: readonly FreshComparisonCandidateInput[];
    spanLineageSafe: boolean;
    associationSafe: boolean;
    safetyGatePass: boolean;
    applyReplacement: boolean;
    applicationResult?: {
      applied: boolean;
      blocker:
        "NONE" | "SELECTOR" | "SPAN_LINEAGE" | "SAFETY_GATE" | "ASSOCIATION";
    };
  }[];
  generatedAt?: string;
}): MachineFreshCandidateComparison {
  const events = input.events.map((event) => {
    const rawById = new Map(
      event.candidates.map((candidate) => [candidate.candidateId, candidate]),
    );
    const candidates = ranked(event.candidates.map(comparisonCandidate));
    const original = candidates.find(
      (candidate) => candidate.candidateId === event.originalCandidateId,
    );
    const fresh = candidates.filter(
      (candidate) => candidate.origin === "FRESH_REASR",
    );
    const freshTop = fresh[0] ?? null;
    const freshTexts = fresh.flatMap((candidate) => {
      const raw = rawById.get(candidate.candidateId);
      return raw === undefined ? [] : [raw.text];
    });
    const freshAgree =
      freshTexts.length >= 2 &&
      freshTexts.every(
        (text) => candidateTextSimilarity(freshTexts[0] ?? "", text) >= 0.82,
      );
    const freshDisagree =
      freshTexts.length >= 2 &&
      freshTexts.some(
        (text) => candidateTextSimilarity(freshTexts[0] ?? "", text) < 0.75,
      );
    const freshDominates =
      original !== undefined &&
      freshTop !== null &&
      freshStrictlyDominates({
        fresh: freshTop,
        original,
        textChanged:
          rawById.get(freshTop.candidateId)?.text !==
          rawById.get(original.candidateId)?.text,
      });
    const allWeak = candidates.every(
      (candidate) =>
        !candidate.evidenceComplete || candidate.dominanceEvidenceCount < 5,
    );
    const outcome = allWeak
      ? ("ALL_CANDIDATES_WEAK" as const)
      : freshDisagree
        ? ("FRESH_CANDIDATES_DISAGREE" as const)
        : freshDominates
          ? ("NEW_CANDIDATE_DOMINATES" as const)
          : candidates[0]?.candidateId === original?.candidateId
            ? ("ORIGINAL_DOMINATES" as const)
            : freshAgree
              ? ("FRESH_CANDIDATES_AGREE" as const)
              : ("AMBIGUOUS" as const);
    const replacementProposed = freshDominates;
    const defaultApplied =
      replacementProposed &&
      event.spanLineageSafe &&
      event.associationSafe &&
      event.safetyGatePass &&
      event.applyReplacement;
    const replacementApplied = replacementProposed
      ? (event.applicationResult?.applied ?? defaultApplied)
      : false;
    const applicationBlocker = !replacementProposed
      ? ("POOL_NOT_IMPROVED" as const)
      : event.applicationResult !== undefined
        ? event.applicationResult.blocker
        : !event.associationSafe
          ? ("ASSOCIATION" as const)
          : !event.spanLineageSafe
            ? ("SPAN_LINEAGE" as const)
            : !event.safetyGatePass
              ? ("SAFETY_GATE" as const)
              : !event.applyReplacement
                ? ("SELECTOR" as const)
                : ("NONE" as const);
    const core = {
      eventId: event.eventId,
      originalCandidateId: event.originalCandidateId,
      candidates,
      outcome,
      topCandidateId: candidates[0]?.candidateId ?? null,
      freshTopCandidateId: freshTop?.candidateId ?? null,
      replacementProposed,
      replacementApplied,
      applicationBlocker,
      reasons: [
        `outcome:${outcome}`,
        `fresh-agree:${String(freshAgree)}`,
        `fresh-disagree:${String(freshDisagree)}`,
        `application-blocker:${applicationBlocker}`,
      ],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const summary = {
    eventCount: events.length,
    newCandidateDominatesCount: events.filter(
      (event) => event.outcome === "NEW_CANDIDATE_DOMINATES",
    ).length,
    originalDominatesCount: events.filter(
      (event) => event.outcome === "ORIGINAL_DOMINATES",
    ).length,
    freshCandidatesAgreeCount: events.filter(
      (event) => event.outcome === "FRESH_CANDIDATES_AGREE",
    ).length,
    freshCandidatesDisagreeCount: events.filter(
      (event) => event.outcome === "FRESH_CANDIDATES_DISAGREE",
    ).length,
    allCandidatesWeakCount: events.filter(
      (event) => event.outcome === "ALL_CANDIDATES_WEAK",
    ).length,
    ambiguousCount: events.filter((event) => event.outcome === "AMBIGUOUS")
      .length,
    freshCandidateTop1Count: events.filter(
      (event) => event.topCandidateId === event.freshTopCandidateId,
    ).length,
    replacementProposalCount: events.filter(
      (event) => event.replacementProposed,
    ).length,
    replacementAppliedCount: events.filter((event) => event.replacementApplied)
      .length,
    freshPoolImprovedRuntimeProxyCount: events.filter(
      (event) => event.outcome === "NEW_CANDIDATE_DOMINATES",
    ).length,
  };
  const core = {
    zone: "runtime-machine-only" as const,
    runtimeGoldInputCount: 0 as const,
    events,
    summary,
  };
  return machineFreshCandidateComparisonSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6017PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-fresh-candidate-comparison",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
