import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  blindEvaluationPolicySchema,
  blindGenerationInputManifestSchema,
  dualBlindFreezeBarrierSchema,
  InputError,
  machineVsGoldEvaluationSchema,
  subtitlePackageSchema,
  type BlindEvaluationPolicy,
  type BlindOutputFreeze,
  type MachineVsGoldEvaluation,
  type SubtitleCue,
} from "@mvl/shared";
import { parseAss } from "@mvl/subtitle-core";

import { locateSubtitlePackage } from "../finalization-support.js";
import { c60SemanticHash, c60StableHash } from "../finalization-risk-policy.js";
import { verifyBlindOutputFreeze } from "./output-freeze.js";

interface EvaluationCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

interface CueGroup {
  indexes: number[];
  cues: EvaluationCue[];
  text: string;
  start: number;
  end: number;
}

interface AlignmentGroup {
  machine: CueGroup | null;
  gold: CueGroup | null;
  classification: "matched" | "unmatched-machine" | "unmatched-gold";
  score: number;
}

interface EditMetrics {
  machineCharacterCount: number;
  goldCharacterCount: number;
  editDistance: number;
  insertionCharacters: number;
  deletionCharacters: number;
  substitutionCharacters: number;
  cer: number;
}

interface DualEvaluationResult {
  goldFirstReadAt: string;
  goldIdentity: MachineVsGoldEvaluation["goldIdentity"];
  runA: MachineVsGoldEvaluation;
  runB: MachineVsGoldEvaluation;
  replaySemanticHashes: {
    runA: string;
    runB: string;
  };
  outputHashesAfterGold: {
    runA: string;
    runB: string;
  };
}

export interface FrozenRunEvaluationResult {
  goldFirstReadAt: string;
  goldIdentity: MachineVsGoldEvaluation["goldIdentity"];
  evaluation: MachineVsGoldEvaluation;
  rawAsrEvaluation: MachineVsGoldEvaluation | null;
  replaySemanticHash: string;
  outputHashAfterGold: string;
}

function rawAsrCuesFrom(value: unknown): EvaluationCue[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const segments = (value as { rawSegments?: unknown }).rawSegments;
  if (!Array.isArray(segments)) return [];
  return segments.flatMap((segment, index) => {
    if (
      typeof segment !== "object" ||
      segment === null ||
      Array.isArray(segment)
    ) {
      return [];
    }
    const item = segment as Record<string, unknown>;
    if (
      typeof item.start !== "number" ||
      typeof item.end !== "number" ||
      typeof item.text !== "string" ||
      item.end <= item.start ||
      item.text.trim().length === 0
    ) {
      return [];
    }
    return [
      {
        id:
          typeof item.id === "string"
            ? item.id
            : `raw-asr-${String(index + 1).padStart(5, "0")}`,
        start: item.start,
        end: item.end,
        text: item.text,
      },
    ];
  });
}

function normalizedText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\p{P}\p{Z}\s]/gu, "")
    .toLowerCase();
}

function exactText(text: string): string {
  return text.normalize("NFC");
}

export function normalizeC601GoldAssTimestamps(content: string): {
  content: string;
  replacementCount: number;
} {
  let replacementCount = 0;
  const replace = (
    _match: string,
    prefix: string,
    fraction: string,
    delimiter: string,
  ): string => {
    replacementCount += 1;
    return `${prefix}.${fraction}${delimiter}`;
  };
  let normalized = content.replace(
    /^(\s*Dialogue:\s*[^,\r\n]*,\s*\d+:\d{2}:\d{2}),(\d{1,2})(,)/gimu,
    replace,
  );
  normalized = normalized.replace(
    /^(\s*Dialogue:\s*[^,\r\n]*,\s*\d+:\d{2}:\d{2}(?:\.\d{1,2})?\s*,\s*\d+:\d{2}:\d{2}),(\d{1,2})(,)/gimu,
    replace,
  );
  return { content: normalized, replacementCount };
}

function joinCueText(
  cues: readonly EvaluationCue[],
  normalize: boolean,
): string {
  const joined = cues.map((cue) => cue.text).join("");
  return normalize ? normalizedText(joined) : exactText(joined);
}

function computeEditMetrics(machine: string, gold: string): EditMetrics {
  const left = Array.from(machine);
  const right = Array.from(gold);
  const width = right.length + 1;
  let previousCost = new Uint32Array(width);
  let previousInsertions = new Uint32Array(width);
  let previousDeletions = new Uint32Array(width);
  let previousSubstitutions = new Uint32Array(width);
  for (let column = 0; column < width; column += 1) {
    previousCost[column] = column;
    previousInsertions[column] = column;
  }
  const choose = (
    candidates: [number, number, number, number][],
  ): [number, number, number, number] =>
    candidates.toSorted(
      (a, b) => a[0] - b[0] || a[3] - b[3] || a[1] - b[1] || a[2] - b[2],
    )[0] ?? [0, 0, 0, 0];
  for (let row = 1; row <= left.length; row += 1) {
    const currentCost = new Uint32Array(width);
    const currentInsertions = new Uint32Array(width);
    const currentDeletions = new Uint32Array(width);
    const currentSubstitutions = new Uint32Array(width);
    currentCost[0] = row;
    currentDeletions[0] = row;
    for (let column = 1; column < width; column += 1) {
      if (left[row - 1] === right[column - 1]) {
        currentCost[column] = previousCost[column - 1] ?? 0;
        currentInsertions[column] = previousInsertions[column - 1] ?? 0;
        currentDeletions[column] = previousDeletions[column - 1] ?? 0;
        currentSubstitutions[column] = previousSubstitutions[column - 1] ?? 0;
        continue;
      }
      const selected = choose([
        [
          (currentCost[column - 1] ?? 0) + 1,
          (currentInsertions[column - 1] ?? 0) + 1,
          currentDeletions[column - 1] ?? 0,
          currentSubstitutions[column - 1] ?? 0,
        ],
        [
          (previousCost[column] ?? 0) + 1,
          previousInsertions[column] ?? 0,
          (previousDeletions[column] ?? 0) + 1,
          previousSubstitutions[column] ?? 0,
        ],
        [
          (previousCost[column - 1] ?? 0) + 1,
          previousInsertions[column - 1] ?? 0,
          previousDeletions[column - 1] ?? 0,
          (previousSubstitutions[column - 1] ?? 0) + 1,
        ],
      ]);
      currentCost[column] = selected[0];
      currentInsertions[column] = selected[1];
      currentDeletions[column] = selected[2];
      currentSubstitutions[column] = selected[3];
    }
    previousCost = currentCost;
    previousInsertions = currentInsertions;
    previousDeletions = currentDeletions;
    previousSubstitutions = currentSubstitutions;
  }
  const index = right.length;
  const editDistance = previousCost[index] ?? 0;
  return {
    machineCharacterCount: left.length,
    goldCharacterCount: right.length,
    editDistance,
    insertionCharacters: previousInsertions[index] ?? 0,
    deletionCharacters: previousDeletions[index] ?? 0,
    substitutionCharacters: previousSubstitutions[index] ?? 0,
    cer: editDistance / Math.max(1, right.length),
  };
}

function makeGroup(
  cues: readonly EvaluationCue[],
  start: number,
  count: number,
): CueGroup {
  const selected = cues.slice(start, start + count);
  const first = selected[0];
  const last = selected.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("Cannot create an empty cue group.");
  }
  return {
    indexes: selected.map((_cue, index) => start + index),
    cues: selected,
    text: selected.map((cue) => cue.text).join(""),
    start: first.start,
    end: last.end,
  };
}

function temporalIoU(left: CueGroup, right: CueGroup): number {
  const intersection = Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  const union =
    Math.max(left.end, right.end) - Math.min(left.start, right.start);
  return union <= 0 ? 0 : intersection / union;
}

function centerDistance(left: CueGroup, right: CueGroup): number {
  return Math.abs((left.start + left.end) / 2 - (right.start + right.end) / 2);
}

function textSimilarity(left: string, right: string): number {
  const metrics = computeEditMetrics(
    normalizedText(left),
    normalizedText(right),
  );
  return Math.max(
    0,
    1 -
      metrics.editDistance /
        Math.max(1, metrics.machineCharacterCount, metrics.goldCharacterCount),
  );
}

function pairScore(
  machine: CueGroup,
  gold: CueGroup,
  policy: BlindEvaluationPolicy,
): { score: number; eligible: boolean } {
  const text = textSimilarity(machine.text, gold.text);
  const iou = temporalIoU(machine, gold);
  const center = centerDistance(machine, gold);
  const centerScore = Math.max(
    0,
    1 -
      center /
        Math.max(0.001, policy.thresholds.maximumMatchCenterDistanceSeconds),
  );
  const score =
    policy.alignmentWeights.textSimilarity * text +
    policy.alignmentWeights.temporalIoU * iou +
    policy.alignmentWeights.centerDistance * centerScore -
    0.035 * (machine.cues.length + gold.cues.length - 2);
  const eligible =
    center <= policy.thresholds.maximumMatchCenterDistanceSeconds &&
    (text >= policy.thresholds.minimumMatchTextSimilarity ||
      iou >= policy.thresholds.minimumMatchTemporalIoU);
  return { score, eligible };
}

function alignCueGroups(
  machineCues: readonly EvaluationCue[],
  goldCues: readonly EvaluationCue[],
  policy: BlindEvaluationPolicy,
): AlignmentGroup[] {
  const rows = machineCues.length + 1;
  const columns = goldCues.length + 1;
  const scores = Array.from({ length: rows }, () =>
    new Float64Array(columns).fill(Number.NEGATIVE_INFINITY),
  );
  const back = new Map<
    string,
    { previousI: number; previousJ: number; group: AlignmentGroup }
  >();
  const key = (i: number, j: number): string => `${i}:${j}`;
  const firstRow = scores[0];
  if (firstRow === undefined) return [];
  firstRow[0] = 0;
  const update = (
    nextI: number,
    nextJ: number,
    score: number,
    previousI: number,
    previousJ: number,
    group: AlignmentGroup,
  ): void => {
    const row = scores[nextI];
    if (row === undefined) return;
    const prior = row[nextJ] ?? Number.NEGATIVE_INFINITY;
    if (score > prior + 1e-12) {
      row[nextJ] = score;
      back.set(key(nextI, nextJ), { previousI, previousJ, group });
    }
  };
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < columns; j += 1) {
      const current = scores[i]?.[j] ?? Number.NEGATIVE_INFINITY;
      if (!Number.isFinite(current)) continue;
      if (i < machineCues.length) {
        update(i + 1, j, current - 0.72, i, j, {
          machine: makeGroup(machineCues, i, 1),
          gold: null,
          classification: "unmatched-machine",
          score: -0.72,
        });
      }
      if (j < goldCues.length) {
        update(i, j + 1, current - 0.72, i, j, {
          machine: null,
          gold: makeGroup(goldCues, j, 1),
          classification: "unmatched-gold",
          score: -0.72,
        });
      }
      for (
        let machineCount = 1;
        machineCount <= policy.thresholds.maximumAlignmentGroupSize;
        machineCount += 1
      ) {
        if (i + machineCount > machineCues.length) break;
        const machine = makeGroup(machineCues, i, machineCount);
        for (
          let goldCount = 1;
          goldCount <= policy.thresholds.maximumAlignmentGroupSize;
          goldCount += 1
        ) {
          if (j + goldCount > goldCues.length) break;
          const gold = makeGroup(goldCues, j, goldCount);
          const pairing = pairScore(machine, gold, policy);
          if (!pairing.eligible) continue;
          update(
            i + machineCount,
            j + goldCount,
            current + pairing.score,
            i,
            j,
            { machine, gold, classification: "matched", score: pairing.score },
          );
        }
      }
    }
  }
  const result: AlignmentGroup[] = [];
  let i = machineCues.length;
  let j = goldCues.length;
  while (i > 0 || j > 0) {
    const step = back.get(key(i, j));
    if (step === undefined) {
      throw new InputError(
        "Gold alignment dynamic program could not be reconstructed.",
        { i, j },
      );
    }
    result.push(step.group);
    i = step.previousI;
    j = step.previousJ;
  }
  return result.reverse();
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].toSorted((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function countOverlaps(cues: readonly EvaluationCue[]): number {
  let count = 0;
  for (let index = 1; index < cues.length; index += 1) {
    const previous = cues[index - 1];
    const current = cues[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.start < previous.end
    )
      count += 1;
  }
  return count;
}

function evaluationSemanticHash(
  value: Omit<MachineVsGoldEvaluation, "semanticHash">,
): string {
  return c60StableHash({
    ...value,
    generatedAt: "<evaluation-time>",
    evaluationWallTimeMs: 0,
    goldIdentity: {
      ...value.goldIdentity,
      firstReadAt: "<gold-first-read-time>",
    },
  });
}

function evaluateMachineCues(input: {
  generatedAt: string;
  generationRunId: string;
  sourceIdentity: MachineVsGoldEvaluation["sourceIdentity"];
  freeze: BlindOutputFreeze;
  machineCues: readonly EvaluationCue[];
  goldCues: readonly EvaluationCue[];
  goldIdentity: MachineVsGoldEvaluation["goldIdentity"];
  policy: BlindEvaluationPolicy;
  evaluationWallTimeMs: number;
  outputHashAfterGold: string;
}): MachineVsGoldEvaluation {
  const alignments = alignCueGroups(
    input.machineCues,
    input.goldCues,
    input.policy,
  );
  const serializableAlignments = alignments.map((alignment, index) => {
    const machine = alignment.machine;
    const gold = alignment.gold;
    const text =
      machine === null || gold === null
        ? 0
        : textSimilarity(machine.text, gold.text);
    const iou =
      machine === null || gold === null ? 0 : temporalIoU(machine, gold);
    const center =
      machine === null || gold === null ? null : centerDistance(machine, gold);
    return {
      alignmentId: `alignment-${String(index + 1).padStart(4, "0")}`,
      machineCueIndexes: machine?.indexes ?? [],
      goldCueIndexes: gold?.indexes ?? [],
      machineTextHash:
        machine === null ? null : c60StableHash(normalizedText(machine.text)),
      goldTextHash:
        gold === null ? null : c60StableHash(normalizedText(gold.text)),
      machineExcerpt: machine?.text.slice(0, 96) ?? "",
      goldExcerpt: gold?.text.slice(0, 96) ?? "",
      machineStart: machine?.start ?? null,
      machineEnd: machine?.end ?? null,
      goldStart: gold?.start ?? null,
      goldEnd: gold?.end ?? null,
      textSimilarity: text,
      temporalIoU: iou,
      centerDistanceSeconds: center,
      startDeltaSeconds:
        machine === null || gold === null ? null : machine.start - gold.start,
      endDeltaSeconds:
        machine === null || gold === null ? null : machine.end - gold.end,
      centerDeltaSeconds:
        machine === null || gold === null
          ? null
          : (machine.start + machine.end) / 2 - (gold.start + gold.end) / 2,
      classification: alignment.classification,
    };
  });
  const matched = serializableAlignments.filter(
    (alignment) => alignment.classification === "matched",
  );
  const boundaryErrors = matched.flatMap((alignment) => [
    Math.abs(alignment.startDeltaSeconds ?? 0),
    Math.abs(alignment.endDeltaSeconds ?? 0),
  ]);
  const startErrors = matched.map((alignment) =>
    Math.abs(alignment.startDeltaSeconds ?? 0),
  );
  const endErrors = matched.map((alignment) =>
    Math.abs(alignment.endDeltaSeconds ?? 0),
  );
  const centerErrors = matched.map((alignment) =>
    Math.abs(alignment.centerDeltaSeconds ?? 0),
  );
  const average = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const ratioWithin = (limit: number): number =>
    boundaryErrors.filter((value) => value <= limit).length /
    Math.max(1, boundaryErrors.length);
  const makeDefect = (
    alignmentId: string,
    code: string,
    severity: "P0" | "P1" | "P2",
    rationale: string,
  ) => ({
    defectId: `${code.toLowerCase()}-${alignmentId}`,
    code,
    severity,
    alignmentIds: [alignmentId],
    rationale,
  });
  const missingDialogueCandidates = serializableAlignments
    .filter(
      (alignment) =>
        alignment.classification === "unmatched-gold" &&
        normalizedText(alignment.goldExcerpt).length >=
          input.policy.thresholds.materialMinimumCharacters,
    )
    .map((alignment) =>
      makeDefect(
        alignment.alignmentId,
        "MISSING_DIALOGUE_CANDIDATE",
        "P1",
        "A material Gold cue group was not supported by a monotonic machine match.",
      ),
    );
  const hallucinationCandidates = serializableAlignments
    .filter(
      (alignment) =>
        alignment.classification === "unmatched-machine" &&
        normalizedText(alignment.machineExcerpt).length >=
          input.policy.thresholds.materialMinimumCharacters,
    )
    .map((alignment) =>
      makeDefect(
        alignment.alignmentId,
        "HALLUCINATION_CANDIDATE",
        "P1",
        "A material machine cue group was not supported by a monotonic Gold match.",
      ),
    );
  const materialTextErrors = serializableAlignments
    .filter(
      (alignment) =>
        alignment.classification === "matched" &&
        1 - alignment.textSimilarity >=
          input.policy.thresholds.materialTextErrorCer &&
        Math.max(
          normalizedText(alignment.machineExcerpt).length,
          normalizedText(alignment.goldExcerpt).length,
        ) >= input.policy.thresholds.materialMinimumCharacters,
    )
    .map((alignment) =>
      makeDefect(
        alignment.alignmentId,
        "MATERIAL_TEXT_ERROR",
        "P1",
        "The aligned group has material normalized text disagreement.",
      ),
    );
  const severeTimingErrors = serializableAlignments
    .filter(
      (alignment) =>
        alignment.classification === "matched" &&
        Math.max(
          Math.abs(alignment.startDeltaSeconds ?? 0),
          Math.abs(alignment.endDeltaSeconds ?? 0),
        ) >= input.policy.thresholds.severeTimingBoundarySeconds,
    )
    .map((alignment) =>
      makeDefect(
        alignment.alignmentId,
        "SEVERE_TIMING_ERROR",
        "P1",
        "At least one aligned subtitle boundary exceeds the frozen severe threshold.",
      ),
    );
  const minorTimingErrors = serializableAlignments
    .filter(
      (alignment) =>
        alignment.classification === "matched" &&
        Math.max(
          Math.abs(alignment.startDeltaSeconds ?? 0),
          Math.abs(alignment.endDeltaSeconds ?? 0),
        ) >= input.policy.thresholds.minorTimingBoundarySeconds &&
        Math.max(
          Math.abs(alignment.startDeltaSeconds ?? 0),
          Math.abs(alignment.endDeltaSeconds ?? 0),
        ) < input.policy.thresholds.severeTimingBoundarySeconds,
    )
    .map((alignment) =>
      makeDefect(
        alignment.alignmentId,
        "MINOR_TIMING_ERROR",
        "P2",
        "At least one aligned subtitle boundary exceeds the frozen minor threshold.",
      ),
    );
  const p0Defects: ReturnType<typeof makeDefect>[] = [];
  const p1Defects = [
    ...missingDialogueCandidates,
    ...hallucinationCandidates,
    ...materialTextErrors,
    ...severeTimingErrors,
  ];
  const p2Defects = minorTimingErrors;
  const machineText = input.machineCues.map((cue) => cue.text).join("");
  const goldText = input.goldCues.map((cue) => cue.text).join("");
  const matchedRaw = alignments.filter(
    (alignment) => alignment.classification === "matched",
  );
  const matchedGoldCharacters = matchedRaw.reduce(
    (sum, alignment) => sum + normalizedText(alignment.gold?.text ?? "").length,
    0,
  );
  const matchedMachineCharacters = matchedRaw.reduce(
    (sum, alignment) =>
      sum + normalizedText(alignment.machine?.text ?? "").length,
    0,
  );
  const goldDuration = input.goldCues.reduce(
    (sum, cue) => sum + (cue.end - cue.start),
    0,
  );
  const matchedGoldDuration = matched.reduce(
    (sum, alignment) =>
      sum + Math.max(0, (alignment.goldEnd ?? 0) - (alignment.goldStart ?? 0)),
    0,
  );
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "machine-vs-gold-evaluation" as const,
    evaluationVersion: "c6.0.1-machine-vs-gold-v1" as const,
    generatedAt: input.generatedAt,
    benchmarkStatus: "development-known-runtime-blind" as const,
    generationRunId: input.generationRunId,
    sourceIdentity: input.sourceIdentity,
    machineFreezeHash: input.freeze.freezeSemanticHash,
    goldIdentity: input.goldIdentity,
    evaluationPolicyVersion: input.policy.policyVersion,
    evaluationPolicyHash: input.policy.policyHash,
    globalTextMetrics: {
      exact: computeEditMetrics(
        joinCueText(input.machineCues, false),
        joinCueText(input.goldCues, false),
      ),
      normalized: computeEditMetrics(
        joinCueText(input.machineCues, true),
        joinCueText(input.goldCues, true),
      ),
    },
    alignments: serializableAlignments,
    alignmentMetrics: {
      machineCueCount: input.machineCues.length,
      goldCueCount: input.goldCues.length,
      alignedGroupCount: serializableAlignments.length,
      matchedGroupCount: matched.length,
      unmatchedGoldGroupCount: serializableAlignments.filter(
        (item) => item.classification === "unmatched-gold",
      ).length,
      unmatchedMachineGroupCount: serializableAlignments.filter(
        (item) => item.classification === "unmatched-machine",
      ).length,
    },
    timingMetrics: {
      reliableAlignedGroupCount: matched.length,
      startMaeSeconds: average(startErrors),
      endMaeSeconds: average(endErrors),
      centerMaeSeconds: average(centerErrors),
      boundaryMedianSeconds: percentile(boundaryErrors, 0.5),
      boundaryP90Seconds: percentile(boundaryErrors, 0.9),
      boundaryP95Seconds: percentile(boundaryErrors, 0.95),
      boundaryMaxSeconds: Math.max(0, ...boundaryErrors),
      timingIoUMedian: percentile(
        matched.map((alignment) => alignment.temporalIoU),
        0.5,
      ),
      within100msRatio: ratioWithin(0.1),
      within250msRatio: ratioWithin(0.25),
      within500msRatio: ratioWithin(0.5),
      within1000msRatio: ratioWithin(1),
    },
    coverageMetrics: {
      goldGroupCount: input.goldCues.length,
      machineGroupCount: input.machineCues.length,
      matchedGoldGroupCount: matched.length,
      unmatchedGoldGroupCount: serializableAlignments.filter(
        (item) => item.classification === "unmatched-gold",
      ).length,
      matchedMachineGroupCount: matched.length,
      unmatchedMachineGroupCount: serializableAlignments.filter(
        (item) => item.classification === "unmatched-machine",
      ).length,
      goldTextCoverageRatio:
        matchedGoldCharacters / Math.max(1, normalizedText(goldText).length),
      machineSupportedTextRatio:
        matchedMachineCharacters /
        Math.max(1, normalizedText(machineText).length),
      goldTemporalCoverageRatio: Math.min(
        1,
        matchedGoldDuration / Math.max(1, goldDuration),
      ),
    },
    missingDialogueCandidates,
    hallucinationCandidates,
    materialTextErrors,
    severeTimingErrors,
    overlapComparisons: [
      {
        comparisonId: "global-overlap-count",
        machineOverlapCount: countOverlaps(input.machineCues),
        goldOverlapCount: countOverlaps(input.goldCues),
        preservedSimultaneousContent:
          countOverlaps(input.machineCues) >= countOverlaps(input.goldCues),
      },
    ],
    properNounMismatches: [],
    dialectMismatches: [],
    p0Defects,
    p1Defects,
    p2Defects,
    modelInferenceCount: 0 as const,
    outputHashBeforeGold: input.freeze.frozenArtifactAggregateHash,
    outputHashAfterGold: input.outputHashAfterGold,
    outputHashUnchangedAfterGold:
      input.freeze.frozenArtifactAggregateHash === input.outputHashAfterGold,
    goldMutationCount: 0 as const,
    evaluationWallTimeMs: input.evaluationWallTimeMs,
  };
  return machineVsGoldEvaluationSchema.parse({
    ...base,
    semanticHash: evaluationSemanticHash(base),
  });
}

async function loadMachineRun(taskDirectory: string): Promise<{
  manifest: ReturnType<typeof blindGenerationInputManifestSchema.parse>;
  freeze: BlindOutputFreeze;
  policy: BlindEvaluationPolicy;
  cues: EvaluationCue[];
  rawAsrCues: EvaluationCue[];
}> {
  const [manifest, freeze, policy, located] = await Promise.all([
    readFile(
      path.join(taskDirectory, "blind-generation-input-manifest.json"),
      "utf8",
    ).then((value) =>
      blindGenerationInputManifestSchema.parse(JSON.parse(value) as unknown),
    ),
    verifyBlindOutputFreeze({ taskDirectory }),
    readFile(
      path.join(taskDirectory, "blind-evaluation-policy.json"),
      "utf8",
    ).then((value) =>
      blindEvaluationPolicySchema.parse(JSON.parse(value) as unknown),
    ),
    locateSubtitlePackage(taskDirectory),
  ]);
  const packageValue = subtitlePackageSchema.parse(
    JSON.parse(await readFile(located.packagePath, "utf8")) as unknown,
  );
  const rawAsrValue = await readFile(
    path.join(located.subtitleDirectory, "canonical-asr-segments.json"),
    "utf8",
  )
    .then((value) => JSON.parse(value) as unknown)
    .catch(() => null);
  return {
    manifest,
    freeze,
    policy,
    cues: packageValue.cues.map((cue: SubtitleCue) => ({
      id: cue.id,
      start: cue.start,
      end: cue.end,
      text: cue.text,
    })),
    rawAsrCues: rawAsrCuesFrom(rawAsrValue),
  };
}

function validateBarrierSemanticHash(
  barrier: ReturnType<typeof dualBlindFreezeBarrierSchema.parse>,
): void {
  const { semanticHash, ...base } = barrier;
  if (c60SemanticHash(base) !== semanticHash) {
    throw new InputError("Dual blind freeze barrier semantic hash is invalid.");
  }
}

export async function evaluateDualBlindRunsAgainstGold(input: {
  barrierPath: string;
  goldPath: string;
  expectedGoldSize: number;
  expectedGoldSha256: string;
  generatedAt: string;
}): Promise<DualEvaluationResult> {
  const barrier = dualBlindFreezeBarrierSchema.parse(
    JSON.parse(await readFile(input.barrierPath, "utf8")) as unknown,
  );
  validateBarrierSemanticHash(barrier);
  if (!barrier.goldReadAuthorized || !barrier.bothFrozenBeforeGold) {
    throw new InputError(
      "Gold read is not authorized by the dual freeze barrier.",
    );
  }
  const [runA, runB] = await Promise.all([
    loadMachineRun(barrier.runAPath),
    loadMachineRun(barrier.runBPath),
  ]);
  if (
    runA.freeze.freezeSemanticHash !== barrier.runAFreezeHash ||
    runB.freeze.freezeSemanticHash !== barrier.runBFreezeHash ||
    runA.manifest.inputSemanticHash !== barrier.runAInputHash ||
    runB.manifest.inputSemanticHash !== barrier.runBInputHash
  ) {
    throw new InputError(
      "Dual freeze barrier no longer matches the frozen runs.",
    );
  }
  if (
    runA.policy.policyHash !== runB.policy.policyHash ||
    runA.policy.frozenAt > barrier.createdAt ||
    runB.policy.frozenAt > barrier.createdAt
  ) {
    throw new InputError(
      "Evaluation policy was not identically frozen before Gold authorization.",
    );
  }

  // This is intentionally the first filesystem operation against goldPath.
  const goldFirstReadAt = new Date().toISOString();
  const goldBuffer = await readFile(input.goldPath);
  const goldHash = createHash("sha256").update(goldBuffer).digest("hex");
  if (
    goldBuffer.byteLength !== input.expectedGoldSize ||
    goldHash !== input.expectedGoldSha256
  ) {
    throw new InputError(
      "Gold identity does not match the frozen acceptance contract.",
      {
        expectedSize: input.expectedGoldSize,
        actualSize: goldBuffer.byteLength,
        expectedSha256: input.expectedGoldSha256,
        actualSha256: goldHash,
      },
    );
  }
  const normalizedGoldAss = normalizeC601GoldAssTimestamps(
    goldBuffer.toString("utf8"),
  );
  const goldCues = parseAss(normalizedGoldAss.content).map((cue, index) => ({
    id: `gold-${String(index + 1).padStart(4, "0")}`,
    start: cue.start,
    end: cue.end,
    text: cue.text,
  }));
  const goldIdentity = {
    fileName: path.basename(input.goldPath),
    size: goldBuffer.byteLength,
    sha256: goldHash,
    cueCount: goldCues.length,
    timestampNormalizationCount: normalizedGoldAss.replacementCount,
    firstReadAt: goldFirstReadAt,
    readOnlyVerified: false,
  };
  const start = Date.now();
  const [freezeAfterA, freezeAfterB, goldAfter, goldInfo] = await Promise.all([
    verifyBlindOutputFreeze({ taskDirectory: barrier.runAPath }),
    verifyBlindOutputFreeze({ taskDirectory: barrier.runBPath }),
    readFile(input.goldPath),
    stat(input.goldPath),
  ]);
  const goldAfterHash = createHash("sha256").update(goldAfter).digest("hex");
  if (
    goldAfter.byteLength !== goldBuffer.byteLength ||
    goldAfterHash !== goldHash ||
    !goldInfo.isFile()
  ) {
    throw new InputError("Gold changed during read-only evaluation.");
  }
  const verifiedGoldIdentity = { ...goldIdentity, readOnlyVerified: true };
  const elapsed = Math.max(0, Date.now() - start);
  const runAEvaluation = evaluateMachineCues({
    generatedAt: input.generatedAt,
    generationRunId: runA.manifest.generationRunId,
    sourceIdentity: runA.manifest.sourceVideo,
    freeze: runA.freeze,
    machineCues: runA.cues,
    goldCues,
    goldIdentity: verifiedGoldIdentity,
    policy: runA.policy,
    evaluationWallTimeMs: elapsed,
    outputHashAfterGold: freezeAfterA.frozenArtifactAggregateHash,
  });
  const runBEvaluation = evaluateMachineCues({
    generatedAt: input.generatedAt,
    generationRunId: runB.manifest.generationRunId,
    sourceIdentity: runB.manifest.sourceVideo,
    freeze: runB.freeze,
    machineCues: runB.cues,
    goldCues,
    goldIdentity: verifiedGoldIdentity,
    policy: runB.policy,
    evaluationWallTimeMs: elapsed,
    outputHashAfterGold: freezeAfterB.frozenArtifactAggregateHash,
  });
  // Deterministic replay uses the already-loaded Gold bytes and performs no model inference.
  const replayA = evaluateMachineCues({
    generatedAt: input.generatedAt,
    generationRunId: runA.manifest.generationRunId,
    sourceIdentity: runA.manifest.sourceVideo,
    freeze: runA.freeze,
    machineCues: runA.cues,
    goldCues,
    goldIdentity: verifiedGoldIdentity,
    policy: runA.policy,
    evaluationWallTimeMs: elapsed + 1,
    outputHashAfterGold: freezeAfterA.frozenArtifactAggregateHash,
  });
  const replayB = evaluateMachineCues({
    generatedAt: input.generatedAt,
    generationRunId: runB.manifest.generationRunId,
    sourceIdentity: runB.manifest.sourceVideo,
    freeze: runB.freeze,
    machineCues: runB.cues,
    goldCues,
    goldIdentity: verifiedGoldIdentity,
    policy: runB.policy,
    evaluationWallTimeMs: elapsed + 1,
    outputHashAfterGold: freezeAfterB.frozenArtifactAggregateHash,
  });
  if (
    replayA.semanticHash !== runAEvaluation.semanticHash ||
    replayB.semanticHash !== runBEvaluation.semanticHash
  ) {
    throw new InputError("Gold evaluator deterministic replay failed.");
  }
  return {
    goldFirstReadAt,
    goldIdentity: verifiedGoldIdentity,
    runA: runAEvaluation,
    runB: runBEvaluation,
    replaySemanticHashes: {
      runA: replayA.semanticHash,
      runB: replayB.semanticHash,
    },
    outputHashesAfterGold: {
      runA: freezeAfterA.frozenArtifactAggregateHash,
      runB: freezeAfterB.frozenArtifactAggregateHash,
    },
  };
}

/**
 * Evaluate one already-frozen development ablation without weakening the
 * independent A/B barrier used for the final acceptance runs. The caller must
 * create its pre-Gold proof before invoking this function. Gold is first read
 * only after the machine manifest, output freeze, and evaluation policy have
 * all been loaded and verified.
 */
export async function evaluateFrozenBlindRunAgainstGold(input: {
  taskDirectory: string;
  goldPath: string;
  expectedGoldSize: number;
  expectedGoldSha256: string;
  generatedAt: string;
  frozenBeforeGoldAt: string;
}): Promise<FrozenRunEvaluationResult> {
  const taskDirectory = path.resolve(input.taskDirectory);
  const run = await loadMachineRun(taskDirectory);
  if (run.policy.frozenAt > input.frozenBeforeGoldAt) {
    throw new InputError(
      "Evaluation policy was not frozen before Gold authorization.",
    );
  }

  // This is intentionally the first filesystem operation against goldPath.
  const goldFirstReadAt = new Date().toISOString();
  const goldBuffer = await readFile(input.goldPath);
  const goldHash = createHash("sha256").update(goldBuffer).digest("hex");
  if (
    goldBuffer.byteLength !== input.expectedGoldSize ||
    goldHash !== input.expectedGoldSha256
  ) {
    throw new InputError(
      "Gold identity does not match the frozen evaluation contract.",
      {
        expectedSize: input.expectedGoldSize,
        actualSize: goldBuffer.byteLength,
        expectedSha256: input.expectedGoldSha256,
        actualSha256: goldHash,
      },
    );
  }
  const normalizedGoldAss = normalizeC601GoldAssTimestamps(
    goldBuffer.toString("utf8"),
  );
  const goldCues = parseAss(normalizedGoldAss.content).map((cue, index) => ({
    id: `gold-${String(index + 1).padStart(4, "0")}`,
    start: cue.start,
    end: cue.end,
    text: cue.text,
  }));
  const goldIdentity = {
    fileName: path.basename(input.goldPath),
    size: goldBuffer.byteLength,
    sha256: goldHash,
    cueCount: goldCues.length,
    timestampNormalizationCount: normalizedGoldAss.replacementCount,
    firstReadAt: goldFirstReadAt,
    readOnlyVerified: false,
  };
  const start = Date.now();
  const [freezeAfter, goldAfter, goldInfo] = await Promise.all([
    verifyBlindOutputFreeze({ taskDirectory }),
    readFile(input.goldPath),
    stat(input.goldPath),
  ]);
  const goldAfterHash = createHash("sha256").update(goldAfter).digest("hex");
  if (
    goldAfter.byteLength !== goldBuffer.byteLength ||
    goldAfterHash !== goldHash ||
    !goldInfo.isFile()
  ) {
    throw new InputError("Gold changed during read-only evaluation.");
  }
  if (freezeAfter.freezeSemanticHash !== run.freeze.freezeSemanticHash) {
    throw new InputError(
      "Frozen machine output changed during Gold evaluation.",
    );
  }
  const verifiedGoldIdentity = { ...goldIdentity, readOnlyVerified: true };
  const elapsed = Math.max(0, Date.now() - start);
  const evaluate = (evaluationWallTimeMs: number) =>
    evaluateMachineCues({
      generatedAt: input.generatedAt,
      generationRunId: run.manifest.generationRunId,
      sourceIdentity: run.manifest.sourceVideo,
      freeze: run.freeze,
      machineCues: run.cues,
      goldCues,
      goldIdentity: verifiedGoldIdentity,
      policy: run.policy,
      evaluationWallTimeMs,
      outputHashAfterGold: freezeAfter.frozenArtifactAggregateHash,
    });
  const evaluation = evaluate(elapsed);
  const replay = evaluate(elapsed + 1);
  if (evaluation.semanticHash !== replay.semanticHash) {
    throw new InputError("Gold evaluator deterministic replay failed.");
  }
  const rawAsrEvaluation =
    run.rawAsrCues.length === 0
      ? null
      : evaluateMachineCues({
          generatedAt: input.generatedAt,
          generationRunId: `${run.manifest.generationRunId}-raw-asr`,
          sourceIdentity: run.manifest.sourceVideo,
          freeze: run.freeze,
          machineCues: run.rawAsrCues,
          goldCues,
          goldIdentity: verifiedGoldIdentity,
          policy: run.policy,
          evaluationWallTimeMs: elapsed,
          outputHashAfterGold: freezeAfter.frozenArtifactAggregateHash,
        });
  return {
    goldFirstReadAt,
    goldIdentity: verifiedGoldIdentity,
    evaluation,
    rawAsrEvaluation,
    replaySemanticHash: replay.semanticHash,
    outputHashAfterGold: freezeAfter.frozenArtifactAggregateHash,
  };
}
