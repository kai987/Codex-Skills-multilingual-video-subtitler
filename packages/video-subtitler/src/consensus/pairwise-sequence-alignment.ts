import { c61Require } from "./japanese-text-representation.js";
import {
  c61PairwiseAlignmentSchema,
  type C61AlignedUnit,
  type C61PairwiseAlignment,
  type C61TextRepresentation,
  type C61TextUnit,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { c61Graphemes } from "./japanese-text-representation.js";
export const C61_ALIGNMENT_COSTS = Object.freeze({
  exact: 0,
  normalized: 0.05,
  pronunciation: 0.35,
  substitution: 1,
  insertion: 1,
  deletion: 1,
});
export function c61EditDistance(
  left: readonly string[],
  right: readonly string[],
): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i += 1) {
    const row = [i + 1];
    for (let j = 0; j < right.length; j += 1)
      row.push(
        Math.min(
          c61Require(row[j]) + 1,
          c61Require(previous[j + 1]) + 1,
          c61Require(previous[j]) + Number(left[i] !== right[j]),
        ),
      );
    previous = row;
  }
  return c61Require(previous[right.length]);
}
function substitution(
  left: C61TextUnit,
  right: C61TextUnit,
  pronunciationAware: boolean,
): Pick<C61AlignedUnit, "operation" | "cost"> {
  if (left.displaySurface === right.displaySurface)
    return { operation: "EXACT", cost: C61_ALIGNMENT_COSTS.exact };
  if (left.normalizedForm === right.normalizedForm)
    return {
      operation: "NORMALIZED_EQUIVALENT",
      cost: C61_ALIGNMENT_COSTS.normalized,
    };
  if (
    pronunciationAware &&
    left.pronunciationForm !== null &&
    left.pronunciationForm === right.pronunciationForm
  )
    return {
      operation: "PRONUNCIATION_EQUIVALENT",
      cost: C61_ALIGNMENT_COSTS.pronunciation,
    };
  return { operation: "SUBSTITUTION", cost: C61_ALIGNMENT_COSTS.substitution };
}
/** Center-star also uses this routine for insertion blocks; no UTF-16 slicing. */
export function alignC61Units(
  left: C61TextUnit[],
  right: C61TextUnit[],
  pronunciationAware = false,
): C61AlignedUnit[] {
  const width = right.length + 1;
  const costs = new Float64Array((left.length + 1) * width);
  const moves = new Uint8Array(costs.length);
  for (let i = 1; i <= left.length; i += 1) {
    costs[i * width] = i;
    moves[i * width] = 1;
  }
  for (let j = 1; j <= right.length; j += 1) {
    costs[j] = j;
    moves[j] = 2;
  }
  for (let i = 1; i <= left.length; i += 1)
    for (let j = 1; j <= right.length; j += 1) {
      const diagonal =
        c61Require(costs[(i - 1) * width + j - 1]) +
        substitution(
          c61Require(left[i - 1]),
          c61Require(right[j - 1]),
          pronunciationAware,
        ).cost;
      const deletion = c61Require(costs[(i - 1) * width + j]) + 1;
      const insertion = c61Require(costs[i * width + j - 1]) + 1;
      // Fixed diagonal/deletion/insertion tie order preserves repeated positions.
      const minimum = Math.min(diagonal, deletion, insertion);
      costs[i * width + j] = minimum;
      moves[i * width + j] =
        Math.abs(diagonal - minimum) < 1e-9
          ? 0
          : Math.abs(deletion - minimum) < 1e-9
            ? 1
            : 2;
    }
  const result: C61AlignedUnit[] = [];
  let i = left.length;
  let j = right.length;
  while (i > 0 || j > 0) {
    const move = moves[i * width + j];
    if (move === 0) {
      i -= 1;
      j -= 1;
      result.push({
        leftIndex: i,
        rightIndex: j,
        leftSurface: c61Require(left[i]).displaySurface,
        rightSurface: c61Require(right[j]).displaySurface,
        ...substitution(
          c61Require(left[i]),
          c61Require(right[j]),
          pronunciationAware,
        ),
      });
    } else if (move === 1) {
      i -= 1;
      result.push({
        leftIndex: i,
        rightIndex: null,
        leftSurface: c61Require(left[i]).displaySurface,
        rightSurface: null,
        operation: "DELETION",
        cost: 1,
      });
    } else {
      j -= 1;
      result.push({
        leftIndex: null,
        rightIndex: j,
        leftSurface: null,
        rightSurface: c61Require(right[j]).displaySurface,
        operation: "INSERTION",
        cost: 1,
      });
    }
  }
  return result.reverse();
}
export function alignC61Pair(
  left: C61TextRepresentation,
  right: C61TextRepresentation,
  options: {
    pronunciationAware?: boolean;
  } = {},
): C61PairwiseAlignment {
  if (left.candidate.eventId !== right.candidate.eventId)
    throw new Error("C61_CROSS_EVENT_ALIGNMENT_REJECTED");
  const pronunciationAware = options.pronunciationAware ?? false;
  const alignedUnits = alignC61Units(
    left.units,
    right.units,
    pronunciationAware,
  );
  const body = {
    eventId: left.candidate.eventId,
    leftCandidateId: left.candidate.candidateId,
    rightCandidateId: right.candidate.candidateId,
    alignedUnits,
    editOperations: alignedUnits.map((unit) => unit.operation),
    displayDistance: c61EditDistance(
      c61Graphemes(left.candidate.displayText),
      c61Graphemes(right.candidate.displayText),
    ),
    normalizedDistance: c61EditDistance(
      c61Graphemes(left.normalizedText),
      c61Graphemes(right.normalizedText),
    ),
    pronunciationDistance:
      left.pronunciationText === null || right.pronunciationText === null
        ? null
        : c61EditDistance(
            c61Graphemes(left.pronunciationText),
            c61Graphemes(right.pronunciationText),
          ),
    weightedCost:
      Math.round(alignedUnits.reduce((sum, unit) => sum + unit.cost, 0) * 1e9) /
      1e9,
    monotonic: true as const,
    alignmentStatus: "ALIGNED" as const,
    costPolicyVersion: "c6.1-alignment-cost-v1" as const,
    pronunciationAware,
  };
  return c61PairwiseAlignmentSchema.parse({
    ...body,
    semanticHash: machineQualitySemanticHash(body),
  });
}
