/** Evaluation-only; cannot be imported by candidate generation. */
import { qualityText } from "./experimental-metrics.js";
import {
  transcriptMetric,
  aggregateTextMetrics,
} from "./representative-evaluation.js";
export function compareCandidate(
  primary: string,
  second: string | null,
  reference: string,
  normalized = true,
) {
  const w = transcriptMetric(primary, reference, normalized);
  if (second === null)
    return {
      primary: w,
      second: null,
      oracleDistance: null,
      category: "NOT_PAIRED_EVALUABLE",
    };
  const r = transcriptMetric(second, reference, normalized);
  const category =
    second === ""
      ? "SECOND_SUCCESS_EMPTY"
      : w.distance === 0 && r.distance === 0
        ? "BOTH_REFERENCE_EXACT"
        : w.distance === 0
          ? "PRIMARY_ONLY_REFERENCE_EXACT"
          : r.distance === 0
            ? "SECOND_ONLY_REFERENCE_EXACT"
            : r.distance < w.distance
              ? "BOTH_NONEXACT_SECOND_BETTER"
              : r.distance > w.distance
                ? "BOTH_NONEXACT_PRIMARY_BETTER"
                : qualityText(primary, normalized) ===
                    qualityText(second, normalized)
                  ? "EQUAL_ERROR_SAME_TEXT"
                  : "EQUAL_ERROR_DIFFERENT_TEXT";
  return {
    primary: w,
    second: r,
    oracleDistance: Math.min(w.distance, r.distance),
    category,
  };
}
export function aggregateCandidates(
  rows: readonly ReturnType<typeof compareCandidate>[],
) {
  const pairs = rows.filter((r) => r.second !== null);
  const w = aggregateTextMetrics(pairs.map((r) => r.primary));
  const r = aggregateTextMetrics(pairs.map((r) => r.second));
  const oracleDistance = pairs.reduce((n, r) => n + r.oracleDistance, 0);
  return {
    plannedUnits: rows.length,
    plannedN: rows.reduce((n, r) => n + r.primary.N, 0),
    pairedUnits: pairs.length,
    primary: w,
    second: r,
    delta: r.distance - w.distance,
    oracleDistance,
    oracleGain: w.distance - oracleDistance,
    improved: pairs.filter((r) => r.second.distance < r.primary.distance)
      .length,
    regressed: pairs.filter((r) => r.second.distance > r.primary.distance)
      .length,
    tied: pairs.filter((r) => r.second.distance === r.primary.distance).length,
    empty: pairs.filter((r) => r.category === "SECOND_SUCCESS_EMPTY").length,
    oracleRole: "REFERENCE_ONLY_WHOLE_UNIT_DIAGNOSTIC_NOT_MACHINE_SELECTION",
  };
}
