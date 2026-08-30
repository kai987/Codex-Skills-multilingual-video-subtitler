import { c61Defined, c61Require } from "./japanese-text-representation.js";
import {
  c61MultipleAlignmentSchema,
  type C61AlignmentProfile,
  type C61MultipleAlignment,
  type C61TextRepresentation,
  type C61TextUnit,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { alignC61Pair, alignC61Units } from "./pairwise-sequence-alignment.js";
interface StarRow {
  candidateId: string;
  anchors: (number | null)[];
  gaps: number[][];
}
function starRow(
  center: C61TextUnit[],
  right: C61TextUnit[],
  candidateId: string,
  pronunciationAware: boolean,
): StarRow {
  const anchors: (number | null)[] = center.map(() => null);
  const gaps: number[][] = Array.from({ length: center.length + 1 }, () => []);
  let position = 0;
  for (const unit of alignC61Units(center, right, pronunciationAware)) {
    if (unit.leftIndex === null) {
      if (unit.rightIndex !== null)
        c61Require(gaps[position]).push(unit.rightIndex);
    } else {
      anchors[unit.leftIndex] = unit.rightIndex;
      position = unit.leftIndex + 1;
    }
  }
  return { candidateId, anchors, gaps };
}
/** Insertion runs have their own deterministic longest center, not naive left padding. */
function alignInsertionBlock(
  sequences: {
    candidateId: string;
    units: C61TextUnit[];
    originalIndices: number[];
    hash: string;
  }[],
  pronunciationAware: boolean,
): Map<string, (number | null)[]> {
  const center = c61Require(
    sequences.toSorted(
      (a, b) => b.units.length - a.units.length || a.hash.localeCompare(b.hash),
    )[0],
  );
  const rows = sequences.map((sequence) => ({
    sequence,
    row: starRow(
      center.units,
      sequence.units,
      sequence.candidateId,
      pronunciationAware,
    ),
  }));
  const widths = Array.from(
    { length: center.units.length + 1 },
    (_, position) =>
      Math.max(...rows.map(({ row }) => c61Require(row.gaps[position]).length)),
  );
  const result = new Map<string, (number | null)[]>();
  for (const { sequence, row } of rows) {
    const output: (number | null)[] = [];
    for (let position = 0; position <= center.units.length; position += 1) {
      for (let offset = 0; offset < c61Require(widths[position]); offset += 1) {
        const localIndex = c61Require(row.gaps[position])[offset];
        output.push(
          localIndex === undefined
            ? null
            : c61Require(sequence.originalIndices[localIndex]),
        );
      }
      if (position < center.units.length) {
        const localIndex = row.anchors[position];
        output.push(
          localIndex === null || localIndex === undefined
            ? null
            : c61Require(sequence.originalIndices[localIndex]),
        );
      }
    }
    result.set(sequence.candidateId, output);
  }
  return result;
}
export function alignC61Multiple(
  input: C61TextRepresentation[],
  profile: C61AlignmentProfile = "CENTER_PROVIDER_BALANCED_MEDOID",
  options: {
    pronunciationAware?: boolean;
  } = {},
): C61MultipleAlignment {
  if (input.length === 0) throw new Error("C61_EMPTY_EVENT_CANDIDATES");
  const representations = input.toSorted((a, b) =>
    a.semanticHash.localeCompare(b.semanticHash),
  );
  if (new Set(representations.map((x) => x.candidate.eventId)).size !== 1)
    throw new Error("C61_CROSS_EVENT_ALIGNMENT_REJECTED");
  if (
    new Set(representations.map((x) => x.candidate.candidateId)).size !==
    representations.length
  )
    throw new Error("C61_DUPLICATE_CANDIDATE_ID");
  const pronunciationAware = options.pronunciationAware ?? false;
  const pairwiseAlignments = representations.flatMap((left, index) =>
    representations
      .slice(index + 1)
      .map((right) => alignC61Pair(left, right, { pronunciationAware })),
  );
  const distance = (
    left: C61TextRepresentation,
    right: C61TextRepresentation,
  ): number => {
    if (left === right) return 0;
    const pair = c61Require(
      pairwiseAlignments.find(
        (x) =>
          (x.leftCandidateId === left.candidate.candidateId &&
            x.rightCandidateId === right.candidate.candidateId) ||
          (x.rightCandidateId === left.candidate.candidateId &&
            x.leftCandidateId === right.candidate.candidateId),
      ),
    );
    return (
      pair.weightedCost / Math.max(1, left.units.length, right.units.length)
    );
  };
  const providerCounts = new Map<string, number>();
  for (const representation of representations)
    providerCounts.set(
      representation.candidate.providerFamily,
      (providerCounts.get(representation.candidate.providerFamily) ?? 0) + 1,
    );
  // CURRENT is a control, not a third independent provider in the main profile.
  const weight = (representation: C61TextRepresentation): number =>
    profile !== "CENTER_PROVIDER_BALANCED_MEDOID"
      ? 1
      : representation.candidate.providerFamily === "CURRENT" &&
          providerCounts.size > 1
        ? 0
        : 1 /
          c61Require(
            providerCounts.get(representation.candidate.providerFamily),
          );
  const score = (representation: C61TextRepresentation): number =>
    representations.reduce(
      (sum, other) => sum + distance(representation, other) * weight(other),
      0,
    );
  const center =
    (profile === "CENTER_CURRENT"
      ? representations.find((x) => x.candidate.providerFamily === "CURRENT")
      : undefined) ??
    c61Require(
      representations.toSorted(
        (a, b) =>
          score(a) - score(b) || a.semanticHash.localeCompare(b.semanticHash),
      )[0],
    );
  const stars = representations.map((representation) => ({
    representation,
    row: starRow(
      center.units,
      representation.units,
      representation.candidate.candidateId,
      pronunciationAware,
    ),
  }));
  const blocks = Array.from(
    { length: center.units.length + 1 },
    (_, position) =>
      alignInsertionBlock(
        stars.map(({ representation, row }) => ({
          candidateId: representation.candidate.candidateId,
          units: c61Require(row.gaps[position]).map((index) =>
            c61Require(representation.units[index]),
          ),
          originalIndices: c61Require(row.gaps[position]),
          hash: representation.semanticHash,
        })),
        pronunciationAware,
      ),
  );
  const rows = stars.map(({ row }) => {
    const unitIndices: (number | null)[] = [];
    for (let position = 0; position <= center.units.length; position += 1) {
      unitIndices.push(
        ...c61Require(c61Require(blocks[position]).get(row.candidateId)),
      );
      if (position < center.units.length)
        unitIndices.push(c61Defined(row.anchors[position]));
    }
    return { candidateId: row.candidateId, unitIndices };
  });
  const body = {
    eventId: center.candidate.eventId,
    profile,
    centerCandidateId: center.candidate.candidateId,
    candidateOrder: representations.map((x) => x.candidate.candidateId),
    slotCount: c61Require(rows[0]).unitIndices.length,
    rows,
    pairwiseAlignments,
    pronunciationAware,
  };
  return c61MultipleAlignmentSchema.parse({
    ...body,
    semanticHash: machineQualitySemanticHash(body),
  });
}
