import {
  InputError,
  machineTextVariantOracleEvaluationSchema,
  type MachineTextVariantOracleEvaluation,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

export interface OracleMachineVariant {
  candidateId: string;
  text: string;
}

export interface OracleEventInput {
  eventId: string;
  selectedCandidateId: string | null;
  variants: readonly OracleMachineVariant[];
  matchedGoldCues: readonly { cueId: string; text: string }[];
  associationAmbiguous: boolean;
}

function editDistance(leftValue: string, rightValue: string): number {
  const left = Array.from(normalizeCandidateText(leftValue));
  const right = Array.from(normalizeCandidateText(rightValue));
  let previous = Array.from(
    { length: right.length + 1 },
    (_value, index) => index,
  );
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + substitution,
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

export function normalizedTextDistance(left: string, right: string): number {
  const denominator = Math.max(
    1,
    Array.from(normalizeCandidateText(right)).length,
  );
  return editDistance(left, right) / denominator;
}

/** Evaluation-only oracle; Gold-derived input is rejected before freeze. */
export function evaluateTextVariantOracle(input: {
  generatedAt?: string;
  freezeVerifiedBeforeGold: boolean;
  machineFreezeHash: string;
  goldIdentityHash: string;
  events: readonly OracleEventInput[];
  poolInsufficientDistance?: number;
}): MachineTextVariantOracleEvaluation {
  if (!input.freezeVerifiedBeforeGold) {
    throw new InputError(
      "Text-variant Oracle requires a verified pre-Gold machine freeze.",
    );
  }
  const poolInsufficientDistance = input.poolInsufficientDistance ?? 0.5;
  const entries = [...input.events]
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId))
    .map((event) => {
      const candidateIds = event.variants
        .map((variant) => variant.candidateId)
        .toSorted();
      const goldText = event.matchedGoldCues.map((cue) => cue.text).join("");
      const selected = event.variants.find(
        (variant) => variant.candidateId === event.selectedCandidateId,
      );
      if (
        event.associationAmbiguous ||
        event.matchedGoldCues.length === 0 ||
        normalizeCandidateText(goldText) === ""
      ) {
        return {
          eventId: event.eventId,
          selectedCandidateId: event.selectedCandidateId,
          candidateIds,
          selectedDistance: null,
          oracleCandidateId: null,
          oracleDistance: null,
          oracleGain: null,
          oracleClass: event.associationAmbiguous
            ? ("ASSOCIATION_AMBIGUOUS" as const)
            : ("UNEVALUABLE" as const),
          matchedGoldCueIds: event.matchedGoldCues.map((cue) => cue.cueId),
          goldTextIncluded: false as const,
        };
      }
      const ranked = event.variants
        .map((variant) => ({
          candidateId: variant.candidateId,
          distance: normalizedTextDistance(variant.text, goldText),
        }))
        .toSorted(
          (left, right) =>
            left.distance - right.distance ||
            left.candidateId.localeCompare(right.candidateId),
        );
      const oracle = ranked[0];
      const selectedDistance =
        selected === undefined
          ? null
          : normalizedTextDistance(selected.text, goldText);
      const oracleDistance = oracle?.distance ?? null;
      const oracleGain =
        selectedDistance === null || oracleDistance === null
          ? null
          : Math.max(0, selectedDistance - oracleDistance);
      const oracleClass =
        oracle === undefined || oracleDistance === null
          ? ("UNEVALUABLE" as const)
          : oracleDistance > poolInsufficientDistance
            ? ("POOL_INSUFFICIENT" as const)
            : oracle.candidateId === event.selectedCandidateId
              ? ("SELECTED_ALREADY_ORACLE" as const)
              : ("SELECTOR_ERROR" as const);
      return {
        eventId: event.eventId,
        selectedCandidateId: event.selectedCandidateId,
        candidateIds,
        selectedDistance,
        oracleCandidateId: oracle?.candidateId ?? null,
        oracleDistance,
        oracleGain,
        oracleClass,
        matchedGoldCueIds: event.matchedGoldCues.map((cue) => cue.cueId),
        goldTextIncluded: false as const,
      };
    });
  const evaluable = entries.filter(
    (entry) =>
      !["UNEVALUABLE", "ASSOCIATION_AMBIGUOUS"].includes(entry.oracleClass),
  );
  const selectedError = evaluable.reduce(
    (sum, entry) => sum + (entry.selectedDistance ?? 0),
    0,
  );
  const oracleError = evaluable.reduce(
    (sum, entry) => sum + (entry.oracleDistance ?? 0),
    0,
  );
  const selectorRegret = evaluable.reduce(
    (sum, entry) => sum + (entry.oracleGain ?? 0),
    0,
  );
  const core = {
    evaluationPhase: "post-freeze-gold-isolated" as const,
    runtimeGoldInputCount: 0 as const,
    machineFreezeHash: input.machineFreezeHash,
    goldIdentityHash: input.goldIdentityHash,
    evaluableEventCount: evaluable.length,
    unevaluableEventCount: entries.length - evaluable.length,
    selectedVariantError: selectedError,
    oracleExistingVariantError: oracleError,
    oracleImprovementPotential: selectorRegret,
    selectorRegret,
    eventEntries: entries,
    aggregateMetrics: {
      currentSelectedOracleHitCount: entries.filter(
        (entry) => entry.oracleClass === "SELECTED_ALREADY_ORACLE",
      ).length,
      selectorErrorCount: entries.filter(
        (entry) => entry.oracleClass === "SELECTOR_ERROR",
      ).length,
      poolInsufficientCount: entries.filter(
        (entry) => entry.oracleClass === "POOL_INSUFFICIENT",
      ).length,
      associationAmbiguousCount: entries.filter(
        (entry) => entry.oracleClass === "ASSOCIATION_AMBIGUOUS",
      ).length,
      selectedAlreadyOracleCount: entries.filter(
        (entry) => entry.oracleClass === "SELECTED_ALREADY_ORACLE",
      ).length,
      oracleNormalizedError:
        evaluable.length === 0 ? 0 : oracleError / evaluable.length,
      theoreticalCandidatePoolGain:
        evaluable.length === 0 ? 0 : selectorRegret / evaluable.length,
    },
  };
  return machineTextVariantOracleEvaluationSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-text-variant-oracle-evaluation",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
