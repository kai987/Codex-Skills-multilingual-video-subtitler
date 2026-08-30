import type { C61TokenLattice } from "@mvl/shared";

import {
  advanceC61PathStates,
  validateC61Path,
  type C61PathState,
} from "./legal-path-validator.js";
import { c61Graphemes, c61Require } from "./japanese-text-representation.js";

/** Evaluation only. Never imported by a machine decoder or the machine runner. */
export function normalizeC61EvaluationText(text: string): string {
  if (typeof text !== "string")
    throw new Error("C61_ORACLE_GOLD_TEXT_REQUIRED");
  return text
    .replace(/\\[Nn]/gu, "\n")
    .normalize("NFKC")
    .replace(/[\p{P}\p{Z}\s]/gu, "")
    .toLowerCase();
}

export function c61EvaluationEditDistance(a: string, b: string): number {
  let row = Array.from({ length: c61Graphemes(b).length + 1 }, (_, i) => i);
  const right = c61Graphemes(b);
  for (const left of c61Graphemes(a)) {
    const next = [(row[0] ?? 0) + 1];
    for (let j = 1; j <= right.length; j++)
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + Number(left !== right[j - 1]),
      );
    row = next;
  }
  return row[right.length] ?? 0;
}

interface Cell {
  cost: number;
  nodeIds: string[];
}
function better(a: Cell | undefined, b: Cell): Cell {
  return a === undefined ||
    b.cost < a.cost ||
    (b.cost === a.cost && b.nodeIds.join("\0") < a.nodeIds.join("\0"))
    ? b
    : a;
}
function extendRow(
  row: Cell[],
  text: string,
  nodeId: string,
  target: string[],
): Cell[] {
  let result = row.map((cell) => ({
    cost: cell.cost,
    nodeIds: [...cell.nodeIds, nodeId],
  }));
  for (const char of c61Graphemes(normalizeC61EvaluationText(text))) {
    const next: Cell[] = [
      { cost: (result[0]?.cost ?? 0) + 1, nodeIds: result[0]?.nodeIds ?? [] },
    ];
    for (let j = 1; j <= target.length; j++) {
      const insertion = c61Require(result[j]);
      const deletion = c61Require(next[j - 1]);
      const diagonal = c61Require(result[j - 1]);
      next[j] = better(
        better(
          { cost: insertion.cost + 1, nodeIds: insertion.nodeIds },
          { cost: deletion.cost + 1, nodeIds: deletion.nodeIds },
        ),
        {
          cost: diagonal.cost + Number(char !== target[j - 1]),
          nodeIds: diagonal.nodeIds,
        },
      );
    }
    result = next;
  }
  return result;
}

/** Exact shortest edit path in DAG × candidate-continuity automaton × Gold.
 * No beam, N-best cap, current-text preference, or Gold-dependent lattice edit.
 * A candidate switch is legal only at a shared, unambiguous surface anchor.
 */
export function exactC61LegalPathOracle(
  lattice: C61TokenLattice,
  gold: string,
): {
  error: number;
  nodeIds: string[];
  algorithm: "EXACT_LEGAL_LATTICE";
  visitedStates: number;
} {
  const target = c61Graphemes(normalizeC61EvaluationText(gold));
  const nodes = new Map(lattice.nodes.map((n) => [n.nodeId, n]));
  const ordered = [...lattice.nodes].sort(
    (a, b) => a.slotIndex - b.slotIndex || a.nodeId.localeCompare(b.nodeId),
  );
  const states = new Map<string, Map<string, Cell[]>>();
  states.set(
    lattice.startNodeId,
    new Map([
      [
        "",
        target
          .map((_, j) => ({ cost: j, nodeIds: [lattice.startNodeId] }))
          .concat([{ cost: target.length, nodeIds: [lattice.startNodeId] }]),
      ],
    ]),
  );
  let visitedStates = 0;
  for (const node of ordered) {
    const currentStates = states.get(node.nodeId);
    if (!currentStates) continue;
    for (const edge of lattice.edges.filter(
      (e) => e.fromNode === node.nodeId,
    )) {
      const next = nodes.get(edge.toNode);
      if (
        next?.slotIndex !== node.slotIndex + 1 ||
        next.eventId !== lattice.eventId
      )
        throw new Error("C61_ORACLE_INVALID_DAG");
      for (const [active, row] of currentStates) {
        const activeProvenance = active
          ? node.candidateProvenance.find(
              (provenance) => provenance.candidateId === active,
            )
          : undefined;
        const prior: C61PathState[] =
          active && activeProvenance
            ? [
                {
                  candidateId: active,
                  providerFamily: activeProvenance.providerFamily,
                  candidateSwitchCount: 0,
                  providerSwitchCount: 0,
                  sourceCandidateIds: [],
                },
              ]
            : [];
        if (active && !activeProvenance)
          throw new Error("C61_ORACLE_MISSING_CANDIDATE_CHAIN");
        for (const legalState of advanceC61PathStates(
          lattice,
          node.nodeId,
          next.nodeId,
          prior,
        )) {
          const candidateId = legalState.candidateId;
          const surface =
            next.kind === "TOKEN"
              ? next.candidateProvenance.find(
                  (p) => p.candidateId === candidateId,
                )?.displaySurface
              : "";
          if (surface === undefined || surface === null)
            throw new Error("C61_ORACLE_MISSING_SURFACE_PROVENANCE");
          const extended = extendRow(row, surface, next.nodeId, target);
          const nextStates =
            states.get(next.nodeId) ?? new Map<string, Cell[]>();
          const previous = nextStates.get(candidateId);
          nextStates.set(
            candidateId,
            extended.map((c, j) => better(previous?.[j], c)),
          );
          states.set(next.nodeId, nextStates);
          visitedStates++;
        }
      }
    }
  }
  let best: Cell | undefined;
  for (const row of states.get(lattice.endNodeId)?.values() ?? [])
    if (row[target.length]) best = better(best, c61Require(row[target.length]));
  if (!best || !validateC61Path(lattice, best.nodeIds).valid)
    throw new Error("C61_ORACLE_NO_VALID_PATH");
  return {
    error: best.cost,
    nodeIds: best.nodeIds,
    algorithm: "EXACT_LEGAL_LATTICE",
    visitedStates,
  };
}

/** Deliberately unconstrained slot upper bound; not a valid decoder/path. */
export function unrestrictedC61SlotOracle(
  lattice: C61TokenLattice,
  gold: string,
): number {
  const target = c61Graphemes(normalizeC61EvaluationText(gold));
  let row = Array.from({ length: target.length + 1 }, (_, j) => ({
    cost: j,
    nodeIds: [] as string[],
  }));
  const slots = [
    ...new Set(
      lattice.nodes
        .filter((n) => n.kind === "TOKEN" || n.kind === "EPSILON")
        .map((n) => n.slotIndex),
    ),
  ].sort((a, b) => a - b);
  for (const slot of slots) {
    const merged: Cell[] = [];
    for (const node of lattice.nodes.filter((n) => n.slotIndex === slot)) {
      for (const surface of node.kind === "EPSILON"
        ? [""]
        : node.displaySurfaces) {
        const candidate = extendRow(row, surface, node.nodeId, target);
        candidate.forEach((cell, j) => {
          merged[j] = better(merged[j], cell);
        });
      }
    }
    row = merged;
  }
  return row[target.length]?.cost ?? target.length;
}
