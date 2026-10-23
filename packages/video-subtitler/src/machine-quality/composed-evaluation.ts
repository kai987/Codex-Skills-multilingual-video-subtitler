/** Evaluation only. Never imported by the matrix generator. */
import { qualityText, type QualityCue } from "./experimental-metrics.js";
export function factorialEffects(scores: {
  E00: number;
  E10: number;
  E01: number;
  E11: number;
  P0: number;
}) {
  const { E00, E10, E01, E11, P0 } = scores;
  return {
    crossUnderLegacy: E10 - E00,
    crossUnderPreserving: E11 - E01,
    intraUnderLegacy: E01 - E00,
    intraUnderOverlap: E11 - E10,
    composedVsLegacy: E11 - E00,
    composedVsCurrent: E11 - E10,
    composedVsMinimal: E11 - P0,
    interaction: E11 - E10 - E01 + E00,
  };
}
export function primarySequenceStatus(
  primary: string,
  composed: string,
  primaryDistance: number,
  composedDistance: number,
) {
  if (qualityText(primary) === qualityText(composed))
    return "SEQUENCE_EQUAL_TO_PRIMARY";
  if (composedDistance === primaryDistance)
    return "SEQUENCE_DIFFERENT_BUT_EDIT_DISTANCE_TIED";
  return composedDistance < primaryDistance
    ? "BETTER_THAN_PRIMARY_UNDER_REFERENCE"
    : "WORSE_THAN_PRIMARY_UNDER_REFERENCE";
}
export function actualExportDiff(
  before: readonly QualityCue[],
  after: readonly QualityCue[],
) {
  const changed = (b: QualityCue, a: QualityCue) =>
    b.text !== a.text || b.start !== a.start || b.end !== a.end;
  return {
    added: after.filter((a) => !before.some((b) => b.id === a.id)),
    removed: before.filter((b) => !after.some((a) => a.id === b.id)),
    modified: after.flatMap((a) => {
      const b = before.find((b) => b.id === a.id);
      return b && changed(b, a) ? [{ before: b, after: a }] : [];
    }),
    scope: "actual reparsed exports; not sum of stage operations",
  };
}
