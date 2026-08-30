import type {
  C61CandidateMbrResult,
  C61CandidateText,
  C61DistanceMethod,
  C61HypothesisWeight,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  c61CandidateOrder,
  c61HypothesisWeights,
  c61RequiredDecoderValue,
} from "./candidate-correlation.js";
import { C61_DECODER_LIMITS } from "./c61-policy.js";
function c61RiskGraphemes(value: string): string[] {
  return [
    ...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(value),
  ].map((part) => part.segment);
}
export function c61NormalizedEditDistance(left: string, right: string): number {
  const a = c61RiskGraphemes(left),
    b = c61RiskGraphemes(right);
  if (!a.length && !b.length) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row.push(
        Math.min(
          c61RequiredDecoderValue(row[j - 1]) + 1,
          c61RequiredDecoderValue(previous[j]) + 1,
          c61RequiredDecoderValue(previous[j - 1]) +
            (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      );
    previous = row;
  }
  return (
    c61RequiredDecoderValue(previous[b.length]) / Math.max(a.length, b.length)
  );
}
export function c61ExpectedRisk(
  hypothesis: {
    normalizedText: string;
    pronunciationText: string | null;
  },
  candidates: readonly C61CandidateText[],
  weights: readonly C61HypothesisWeight[],
  method: C61DistanceMethod,
): {
  expectedNormalizedDistance: number;
  pronunciationCoverage: number;
} {
  let risk = 0,
    coverage = 0;
  const byId = new Map(
    weights.map((entry) => [
      entry.candidateId,
      entry.normalizedHypothesisWeight,
    ]),
  );
  for (const candidate of c61CandidateOrder(candidates)) {
    const weight = byId.get(candidate.candidateId) ?? 0;
    const grapheme = c61NormalizedEditDistance(
      hypothesis.normalizedText,
      candidate.normalizedText,
    );
    const hasReading = Boolean(
      hypothesis.pronunciationText && candidate.pronunciationText,
    );
    const pronunciation = hasReading
      ? c61NormalizedEditDistance(
          c61RequiredDecoderValue(hypothesis.pronunciationText),
          c61RequiredDecoderValue(candidate.pronunciationText),
        )
      : grapheme;
    const distance =
      method === "GRAPHEME"
        ? grapheme
        : method === "PRONUNCIATION"
          ? pronunciation
          : C61_DECODER_LIMITS.combinedGraphemeWeight * grapheme +
            (1 - C61_DECODER_LIMITS.combinedGraphemeWeight) * pronunciation;
    risk += weight * distance;
    if (hasReading) coverage += weight;
  }
  return {
    expectedNormalizedDistance: risk,
    pronunciationCoverage: Math.min(1, coverage),
  };
}
export function candidateMbr(input: {
  candidates: readonly C61CandidateText[];
  currentCandidateId: string | null;
  distanceMethod?: C61DistanceMethod;
  minimumMargin?: number;
}): C61CandidateMbrResult {
  const { candidates, currentCandidateId } = input;
  if (!candidates.length)
    throw new Error(
      "Candidate MBR requires an event hypothesis; preserve current outside the decoder when none exists.",
    );
  if (new Set(candidates.map((candidate) => candidate.eventId)).size !== 1)
    throw new Error("Candidate MBR cannot cross events.");
  const distanceMethod = input.distanceMethod ?? "COMBINED";
  const weights = c61HypothesisWeights(candidates, "R3");
  const ordered = c61CandidateOrder(candidates);
  const candidateRisks = ordered
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      ...c61ExpectedRisk(candidate, candidates, weights, distanceMethod),
    }))
    .sort(
      (a, b) =>
        a.expectedNormalizedDistance - b.expectedNormalizedDistance ||
        a.candidateId.localeCompare(b.candidateId),
    );
  const best = c61RequiredDecoderValue(candidateRisks[0]);
  const bestCandidate = c61RequiredDecoderValue(
    candidates.find((candidate) => candidate.candidateId === best.candidateId),
  );
  // Equivalent surface forms do not create artificial zero margins, but homophones remain distinct.
  const runner = candidateRisks.find(
    (entry) =>
      c61RequiredDecoderValue(
        candidates.find(
          (candidate) => candidate.candidateId === entry.candidateId,
        ),
      ).normalizedText !== bestCandidate.normalizedText,
  );
  const margin = runner
    ? Math.max(
        0,
        runner.expectedNormalizedDistance - best.expectedNormalizedDistance,
      )
    : null;
  const single =
    new Set(candidates.map((candidate) => candidate.normalizedText)).size <= 1;
  const ambiguous =
    !single &&
    margin !== null &&
    margin <= (input.minimumMargin ?? C61_DECODER_LIMITS.pathMinimumRiskMargin);
  const selectedCandidateId =
    ambiguous || (single && currentCandidateId !== null)
      ? currentCandidateId
      : best.candidateId;
  const outcome = single
    ? "SINGLE_HYPOTHESIS_NO_ACTION"
    : ambiguous
      ? "ABSTAIN_AMBIGUOUS"
      : selectedCandidateId === currentCandidateId
        ? "KEEP_CURRENT"
        : "SELECT_EXISTING_CANDIDATE";
  const value = {
    eventId: c61RequiredDecoderValue(candidates[0]).eventId,
    distanceMethod,
    outcome,
    selectedCandidateId,
    candidateRisks,
    weights,
    pathRiskMargin: margin,
    reasons: [
      single
        ? "ONE_NORMALIZED_HYPOTHESIS"
        : ambiguous
          ? "LOW_EXPECTED_DISTANCE_MARGIN_PRESERVE_CURRENT"
          : "MINIMUM_WEIGHTED_EXPECTED_DISTANCE",
      "WEIGHTS_ARE_NOT_CALIBRATED_POSTERIORS",
      ...(candidateRisks.some((entry) => entry.pronunciationCoverage < 1) &&
      distanceMethod !== "GRAPHEME"
        ? ["MISSING_PRONUNCIATION_FALLS_BACK_TO_GRAPHEMES"]
        : []),
    ],
  } as const;
  return {
    ...value,
    reasons: [...value.reasons],
    semanticHash: machineQualitySemanticHash(value),
  };
}
