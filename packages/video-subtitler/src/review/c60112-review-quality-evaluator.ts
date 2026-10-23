import { createHash } from "node:crypto";

import type { SubtitleCue } from "@mvl/shared";

function normalizeC60112DialogueForIsolation(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\{[^}]*\}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Reject synthetic review text that reproduces a Gold subtitle line.  This is
 * intentionally content based: a fixture can remove every Gold filename and
 * hash while still leaking the answer text itself.
 */
export function assertC60112NoGoldDialogueLeak(input: {
  syntheticTexts: readonly string[];
  goldTexts: readonly string[];
}): void {
  const syntheticTexts = input.syntheticTexts
    .map(normalizeC60112DialogueForIsolation)
    .filter((text) => text.length >= 6);
  const goldTexts = input.goldTexts
    .map(normalizeC60112DialogueForIsolation)
    .filter((text) => text.length >= 6);
  const leak = syntheticTexts.find((syntheticText) =>
    goldTexts.some(
      (goldText) =>
        syntheticText === goldText ||
        (goldText.length >= 12 && syntheticText.includes(goldText)) ||
        (syntheticText.length >= 12 && goldText.includes(syntheticText)),
    ),
  );
  if (leak !== undefined) {
    throw new Error("SYNTHETIC_FIXTURE_CONTAINS_GOLD_DIALOGUE_TEXT");
  }
}

export type C60112ReviewBudget =
  | "TOP_10_PERCENT"
  | "TOP_20_PERCENT"
  | "TOP_30_PERCENT"
  | "TOP_40_PERCENT"
  | "TOP_50_PERCENT"
  | "ALL_REQUIRED";

export type C60112ReviewRanking =
  | "R0_CHRONOLOGICAL"
  | "R1_OLD_SINGLE_ASR_RISK"
  | "R2_CROSS_MODEL_DISAGREEMENT_ONLY"
  | "R3_FULL_EVIDENCE_RANK";

export type C60112GoldErrorLabel =
  | "MATERIAL_TEXT_ERROR"
  | "HALLUCINATION"
  | "MISSING_DIALOGUE"
  | "SEVERE_TIMING_ERROR"
  | "OVERLAP_ERROR";

export type C60112CandidateFixability =
  | "CURRENT_ALREADY_CORRECT"
  | "WHISPER_ALT_FIXABLE"
  | "REAZON_FIXABLE"
  | "BOTH_CANDIDATE_FIXABLE"
  | "CANDIDATE_PARTIAL_FIX"
  | "MANUAL_EDIT_REQUIRED"
  | "UNEVALUABLE";

export interface C60112EvaluableReviewItem {
  itemId: string;
  interval: { start: number; end: number };
  targetCueIds: string[];
  labels: string[];
  priorityScore: number;
  chronologicalIndex: number;
  regionId: string;
  audioDurationSeconds: number;
  currentText: string;
  candidateTexts: {
    candidateId: string;
    providers: string[];
    text: string;
  }[];
  singleAsrRiskScore: number;
  crossModelDisagreement: boolean;
  required: boolean;
}

interface GoldAlignment {
  alignmentId: string;
  machineCueIndexes: number[];
  goldCueIndexes: number[];
  machineExcerpt: string;
  goldExcerpt: string;
  machineStart: number | null;
  machineEnd: number | null;
  goldStart: number | null;
  goldEnd: number | null;
}

interface GoldDefect {
  defectId: string;
  code: string;
  severity: string;
  alignmentIds: string[];
}

interface GoldOverlapComparison {
  comparisonId: string;
  machineOverlapCount: number;
  goldOverlapCount: number;
  preservedSimultaneousContent: boolean;
}

export interface C60112GoldEvaluationInput {
  alignments: GoldAlignment[];
  missingDialogueCandidates: GoldDefect[];
  hallucinationCandidates: GoldDefect[];
  materialTextErrors: GoldDefect[];
  severeTimingErrors: GoldDefect[];
  overlapComparisons: GoldOverlapComparison[];
  globalTextMetrics: {
    exact: { editDistance: number; goldCharacterCount: number; cer: number };
    normalized: {
      editDistance: number;
      goldCharacterCount: number;
      cer: number;
    };
  };
  coverageMetrics: { goldTextCoverageRatio: number };
}

export interface C60112BudgetMetrics {
  budget: C60112ReviewBudget;
  selectedReviewItemCount: number;
  selectedRegionCount: number;
  selectedAudioSeconds: number;
  coveredUniqueErrors: {
    materialText: number;
    severeTiming: number;
    hallucination: number;
    missingDialogue: number;
    overlap: number;
  };
  materialRecall: number;
  severeTimingRecall: number;
  hallucinationRecall: number;
  missingDialogueRecall: number;
  reviewItemPrecision: number;
  regionErrorRecall: number;
  unreviewedResidualErrorRate: number;
  residualExactCer: number;
  residualNormalizedCer: number;
  residualMaterialErrors: number;
  residualSevereTiming: number;
  residualMissing: number;
  residualHallucination: number;
}

interface FixabilityRecord {
  classification: C60112CandidateFixability;
  fullFixCandidateIds: string[];
  partialFixCandidateIds: string[];
}

export interface C60112ReviewQualityEvaluation {
  schemaVersion: "1.0.0";
  policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2";
  artifactType: "c6-0-1-12-review-quality-evaluation";
  generatedAt: string;
  reviewPackageFreezeHash: string;
  machineFinalMutated: false;
  idealSimulationMethod: "GLOBAL_TEXT_RECOMPUTATION_WITH_SELECTED_GOLD_ALIGNMENTS";
  rankingInputHashes: {
    oldSingleAsrRiskArtifactSha256: string;
  };
  overlapEvaluation: {
    status: "UNEVALUABLE_GLOBAL_ONLY";
    machineOverlapCount: number;
    goldOverlapCount: number;
    reason: string;
  };
  uniqueErrorCounts: {
    materialText: number;
    severeTiming: number;
    hallucination: number;
    missingDialogue: number;
    overlap: number;
  };
  errorComponents: {
    errorComponentId: string;
    labels: C60112GoldErrorLabel[];
    coveredReviewItemIds: string[];
    coveredRegionIds: string[];
    semanticHash: string;
  }[];
  itemLabels: {
    reviewItemId: string;
    labels: (C60112GoldErrorLabel | "CLEAN_OR_MINOR")[];
    errorComponentIds: string[];
  }[];
  budgetMetrics: C60112BudgetMetrics[];
  rankingBaselines: {
    baseline: C60112ReviewRanking;
    budgetMetrics: C60112BudgetMetrics[];
    audioMatchedBudgetMetrics: C60112BudgetMetrics[];
    utilityScore: number;
  }[];
  rankingResult:
    | "REVIEW_PRIORITY_EFFECTIVE"
    | "REVIEW_PRIORITY_WEAK"
    | "REVIEW_PRIORITY_NOT_EFFECTIVE";
  candidateFixability: ({
    reviewItemId: string;
    errorComponentIds: string[];
  } & FixabilityRecord & {
      semanticHash: string;
    })[];
  materialErrorFixability: ({
    errorComponentId: string;
    reviewItemIds: string[];
  } & FixabilityRecord & {
      semanticHash: string;
    })[];
  candidateFixabilitySummary: {
    materialErrorCount: number;
    candidateFixableMaterialErrorCount: number;
    candidateFixRate: number;
    whisperAlternateFixableCount: number;
    reazonFixableCount: number;
    bothCandidateFixableCount: number;
    partialFixCount: number;
    manualEditRequiredCount: number;
    manualEditRate: number;
    unevaluableCount: number;
  };
  specialErrorRanks: {
    errorComponentId: string;
    label: "HALLUCINATION" | "MISSING_DIALOGUE";
    queueCaptured: boolean;
    rankPositions: Record<C60112ReviewRanking, number | null>;
  }[];
  burden: {
    totalReviewItems: number;
    requiredItems: number;
    totalReviewRegions: number;
    requiredRegions: number;
    totalReviewAudioSeconds: number;
    requiredReviewAudioSeconds: number;
    reviewAudioEpisodeRatio: number;
    candidateActionableItems: number;
    manualEditLikelyItems: number;
    humanReviewTimeStatus: "NOT_MEASURED_IN_C6_0_1_12";
  };
  containsFullGoldText: false;
  semanticHash: string;
}

interface WorkingComponent {
  errorComponentId: string;
  labels: Set<C60112GoldErrorLabel>;
  alignmentIds: Set<string>;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\p{P}\p{Z}\s]/gu, "")
    .toLowerCase();
}

function exact(value: string): string {
  return value.normalize("NFC");
}

function editDistance(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function intervalForAlignment(
  alignment: GoldAlignment,
): { start: number; end: number } | null {
  const starts = [alignment.machineStart, alignment.goldStart].filter(
    (value): value is number => value !== null,
  );
  const ends = [alignment.machineEnd, alignment.goldEnd].filter(
    (value): value is number => value !== null,
  );
  if (starts.length === 0 || ends.length === 0) return null;
  return { start: Math.min(...starts), end: Math.max(...ends) };
}

function overlaps(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return Math.min(left.end, right.end) - Math.max(left.start, right.start) > 0;
}

function labelForCode(code: string): C60112GoldErrorLabel | null {
  if (code === "MATERIAL_TEXT_ERROR") return "MATERIAL_TEXT_ERROR";
  if (code === "HALLUCINATION_CANDIDATE") return "HALLUCINATION";
  if (code === "MISSING_DIALOGUE_CANDIDATE") return "MISSING_DIALOGUE";
  if (code === "SEVERE_TIMING_ERROR") return "SEVERE_TIMING_ERROR";
  return null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function rankingVariants(items: readonly C60112EvaluableReviewItem[]): {
  baseline: C60112ReviewRanking;
  items: C60112EvaluableReviewItem[];
}[] {
  const chronological = (list: readonly C60112EvaluableReviewItem[]) =>
    [...list].toSorted(
      (left, right) =>
        left.chronologicalIndex - right.chronologicalIndex ||
        left.itemId.localeCompare(right.itemId),
    );
  return [
    { baseline: "R0_CHRONOLOGICAL", items: chronological(items) },
    {
      baseline: "R1_OLD_SINGLE_ASR_RISK",
      items: [...items].toSorted(
        (left, right) =>
          right.singleAsrRiskScore - left.singleAsrRiskScore ||
          left.chronologicalIndex - right.chronologicalIndex,
      ),
    },
    {
      baseline: "R2_CROSS_MODEL_DISAGREEMENT_ONLY",
      items: [...items].toSorted(
        (left, right) =>
          Number(right.crossModelDisagreement) -
            Number(left.crossModelDisagreement) ||
          left.chronologicalIndex - right.chronologicalIndex,
      ),
    },
    {
      baseline: "R3_FULL_EVIDENCE_RANK",
      items: [...items].toSorted(
        (left, right) =>
          right.priorityScore - left.priorityScore ||
          left.chronologicalIndex - right.chronologicalIndex,
      ),
    },
  ];
}

function budgetPercent(budget: C60112ReviewBudget): number | null {
  const values: Partial<Record<C60112ReviewBudget, number>> = {
    TOP_10_PERCENT: 10,
    TOP_20_PERCENT: 20,
    TOP_30_PERCENT: 30,
    TOP_40_PERCENT: 40,
    TOP_50_PERCENT: 50,
  };
  return values[budget] ?? null;
}

function selectItemBudget(
  ranked: readonly C60112EvaluableReviewItem[],
  budget: C60112ReviewBudget,
): C60112EvaluableReviewItem[] {
  const percent = budgetPercent(budget);
  if (percent === null) return ranked.filter((item) => item.required);
  return ranked.slice(0, Math.ceil((ranked.length * percent) / 100));
}

function audioSeconds(items: readonly C60112EvaluableReviewItem[]): number {
  return [
    ...new Map(
      items.map((item) => [item.regionId, item.audioDurationSeconds]),
    ).values(),
  ].reduce((sum, duration) => sum + duration, 0);
}

function selectAudioBudget(
  ranked: readonly C60112EvaluableReviewItem[],
  targetSeconds: number,
): C60112EvaluableReviewItem[] {
  const selected: C60112EvaluableReviewItem[] = [];
  const regionSeconds = new Map<string, number>();
  let used = 0;
  for (const item of ranked) {
    const extra = regionSeconds.has(item.regionId)
      ? 0
      : item.audioDurationSeconds;
    if (selected.length > 0 && used + extra > targetSeconds) continue;
    selected.push(item);
    if (extra > 0) {
      regionSeconds.set(item.regionId, extra);
      used += extra;
    }
  }
  return selected;
}

function compareCandidates(input: {
  currentText: string;
  goldText: string;
  candidates: readonly C60112EvaluableReviewItem["candidateTexts"][number][];
  reviewItemAvailable: boolean;
}): FixabilityRecord {
  const normalizedGold = normalize(input.goldText);
  if (normalizedGold === "" || !input.reviewItemAvailable) {
    return {
      classification: "UNEVALUABLE",
      fullFixCandidateIds: [],
      partialFixCandidateIds: [],
    };
  }
  const normalizedCurrent = normalize(input.currentText);
  if (normalizedCurrent === normalizedGold) {
    return {
      classification: "CURRENT_ALREADY_CORRECT",
      fullFixCandidateIds: [],
      partialFixCandidateIds: [],
    };
  }
  const currentDistance = editDistance(normalizedCurrent, normalizedGold);
  const comparisons = input.candidates.map((candidate) => {
    const normalizedCandidate = normalize(candidate.text);
    return {
      ...candidate,
      distance: editDistance(normalizedCandidate, normalizedGold),
      exact: normalizedCandidate === normalizedGold,
    };
  });
  const full = comparisons.filter((candidate) => candidate.exact);
  const partial = comparisons.filter(
    (candidate) => !candidate.exact && candidate.distance < currentDistance,
  );
  const hasWhisper = full.some((candidate) =>
    candidate.providers.includes("WHISPER_ALT"),
  );
  const hasReazon = full.some((candidate) =>
    candidate.providers.includes("REAZON"),
  );
  const classification: C60112CandidateFixability =
    hasWhisper && hasReazon
      ? "BOTH_CANDIDATE_FIXABLE"
      : hasWhisper
        ? "WHISPER_ALT_FIXABLE"
        : hasReazon
          ? "REAZON_FIXABLE"
          : partial.length > 0
            ? "CANDIDATE_PARTIAL_FIX"
            : "MANUAL_EDIT_REQUIRED";
  return {
    classification,
    fullFixCandidateIds: [
      ...new Set(full.map((candidate) => candidate.candidateId)),
    ].toSorted(),
    partialFixCandidateIds: [
      ...new Set(partial.map((candidate) => candidate.candidateId)),
    ].toSorted(),
  };
}

function simulatePerfectGoldCorrections(input: {
  baseCues: readonly SubtitleCue[];
  goldCues: readonly { start: number; end: number; text: string }[];
  alignments: readonly GoldAlignment[];
  correctedAlignmentIds: ReadonlySet<string>;
}): { exactCer: number; normalizedCer: number } {
  const replacements = new Map<number, string>();
  const removedCueIndexes = new Set<number>();
  const insertions = new Map<number, { start: number; text: string }[]>();
  const selected = input.alignments
    .filter((alignment) =>
      input.correctedAlignmentIds.has(alignment.alignmentId),
    )
    .toSorted(
      (left, right) =>
        (left.goldStart ?? left.machineStart ?? Number.POSITIVE_INFINITY) -
          (right.goldStart ?? right.machineStart ?? Number.POSITIVE_INFINITY) ||
        left.alignmentId.localeCompare(right.alignmentId),
    );
  for (const alignment of selected) {
    const machineCueIndexes = [...new Set(alignment.machineCueIndexes)]
      .filter((index) => index >= 0 && index < input.baseCues.length)
      .toSorted((left, right) => left - right);
    if (machineCueIndexes.length > 0) {
      const first = machineCueIndexes[0];
      if (first === undefined) continue;
      if (!replacements.has(first)) {
        replacements.set(first, alignment.goldExcerpt);
        machineCueIndexes
          .slice(1)
          .forEach((index) => removedCueIndexes.add(index));
      }
      continue;
    }
    if (alignment.goldExcerpt === "") continue;
    const goldStart = alignment.goldStart ?? Number.POSITIVE_INFINITY;
    const insertionIndex = input.baseCues.findIndex(
      (cue) => cue.start >= goldStart,
    );
    const targetIndex =
      insertionIndex === -1 ? input.baseCues.length : insertionIndex;
    const entries = insertions.get(targetIndex) ?? [];
    entries.push({ start: goldStart, text: alignment.goldExcerpt });
    insertions.set(targetIndex, entries);
  }
  const correctedParts: string[] = [];
  for (let index = 0; index <= input.baseCues.length; index += 1) {
    const before = (insertions.get(index) ?? []).toSorted(
      (left, right) => left.start - right.start,
    );
    correctedParts.push(...before.map((entry) => entry.text));
    if (index === input.baseCues.length) break;
    if (removedCueIndexes.has(index)) continue;
    correctedParts.push(
      replacements.get(index) ?? input.baseCues[index]?.text ?? "",
    );
  }
  const correctedText = correctedParts.join("");
  const goldText = input.goldCues.map((cue) => cue.text).join("");
  const exactGold = exact(goldText);
  const normalizedGold = normalize(goldText);
  return {
    exactCer: ratio(
      editDistance(exact(correctedText), exactGold),
      Array.from(exactGold).length,
    ),
    normalizedCer: ratio(
      editDistance(normalize(correctedText), normalizedGold),
      Array.from(normalizedGold).length,
    ),
  };
}

export function evaluateC60112ReviewQuality(input: {
  generatedAt: string;
  reviewPackageFreezeHash: string;
  sourceMediaSha256: string;
  goldSha256: string;
  oldSingleAsrRiskArtifactSha256: string;
  baseCues: readonly SubtitleCue[];
  goldCues: readonly { start: number; end: number; text: string }[];
  items: readonly C60112EvaluableReviewItem[];
  goldEvaluation: C60112GoldEvaluationInput;
  episodeDurationSeconds: number;
}): C60112ReviewQualityEvaluation {
  const cueIndexById = new Map(
    input.baseCues.map((cue, index) => [cue.id, index]),
  );
  const working = new Map<string, WorkingComponent>();
  const addDefect = (defect: GoldDefect): void => {
    const label = labelForCode(defect.code);
    if (label === null) return;
    const component = working.get(defect.defectId) ?? {
      errorComponentId: defect.defectId,
      labels: new Set<C60112GoldErrorLabel>(),
      alignmentIds: new Set<string>(),
    };
    component.labels.add(label);
    defect.alignmentIds.forEach((id) => component.alignmentIds.add(id));
    working.set(defect.defectId, component);
  };
  [
    ...input.goldEvaluation.missingDialogueCandidates,
    ...input.goldEvaluation.hallucinationCandidates,
    ...input.goldEvaluation.materialTextErrors,
    ...input.goldEvaluation.severeTimingErrors,
  ].forEach(addDefect);
  const overlapEvaluation = input.goldEvaluation.overlapComparisons.reduce(
    (summary, comparison) => ({
      status: "UNEVALUABLE_GLOBAL_ONLY" as const,
      machineOverlapCount:
        summary.machineOverlapCount + comparison.machineOverlapCount,
      goldOverlapCount: summary.goldOverlapCount + comparison.goldOverlapCount,
      reason:
        "The upstream Gold artifact exposes only aggregate overlap counts, so unique overlap components, intervals, and queue recall cannot be inferred safely.",
    }),
    {
      status: "UNEVALUABLE_GLOBAL_ONLY" as const,
      machineOverlapCount: 0,
      goldOverlapCount: 0,
      reason:
        "The upstream Gold artifact exposes only aggregate overlap counts, so unique overlap components, intervals, and queue recall cannot be inferred safely.",
    },
  );

  const componentIdsByItem = new Map<string, Set<string>>();
  const alignmentIdsByItem = new Map<string, Set<string>>();
  for (const item of input.items) {
    const cueIndexes = new Set<number>();
    for (const cueId of item.targetCueIds) {
      const index = cueIndexById.get(cueId);
      if (index === undefined) {
        throw new Error(
          `REVIEW_ITEM_TARGET_CUE_NOT_FOUND:${item.itemId}:${cueId}`,
        );
      }
      cueIndexes.add(index);
    }
    const itemAlignmentIds = new Set<string>();
    for (const alignment of input.goldEvaluation.alignments) {
      const interval = intervalForAlignment(alignment);
      const cueLineageFullyCovered =
        item.targetCueIds.length > 0 &&
        alignment.machineCueIndexes.length > 0 &&
        alignment.machineCueIndexes.every((index) => cueIndexes.has(index));
      const missingLinked =
        item.targetCueIds.length === 0 &&
        alignment.machineCueIndexes.length === 0 &&
        alignment.goldCueIndexes.length > 0 &&
        interval !== null &&
        overlaps(item.interval, interval);
      if (cueLineageFullyCovered || missingLinked) {
        itemAlignmentIds.add(alignment.alignmentId);
      }
    }
    alignmentIdsByItem.set(item.itemId, itemAlignmentIds);
    const captured = new Set<string>();
    for (const component of working.values()) {
      if (
        [...component.alignmentIds].some((alignmentId) =>
          itemAlignmentIds.has(alignmentId),
        )
      ) {
        captured.add(component.errorComponentId);
      }
    }
    componentIdsByItem.set(item.itemId, captured);
  }

  const baselineSimulation = simulatePerfectGoldCorrections({
    baseCues: input.baseCues,
    goldCues: input.goldCues,
    alignments: input.goldEvaluation.alignments,
    correctedAlignmentIds: new Set(),
  });
  if (
    Math.abs(
      baselineSimulation.exactCer -
        input.goldEvaluation.globalTextMetrics.exact.cer,
    ) > 1e-12 ||
    Math.abs(
      baselineSimulation.normalizedCer -
        input.goldEvaluation.globalTextMetrics.normalized.cer,
    ) > 1e-12
  ) {
    throw new Error(
      "Gold simulation text reconstruction does not reproduce the frozen global CER baseline.",
    );
  }

  const errorComponents = [...working.values()]
    .map((component) => {
      const coveredReviewItemIds = input.items
        .filter((item) =>
          componentIdsByItem.get(item.itemId)?.has(component.errorComponentId),
        )
        .map((item) => item.itemId)
        .toSorted();
      const core = {
        errorComponentId: component.errorComponentId,
        labels: [...component.labels].toSorted(),
        coveredReviewItemIds,
        coveredRegionIds: [
          ...new Set(
            input.items
              .filter((item) => coveredReviewItemIds.includes(item.itemId))
              .map((item) => item.regionId),
          ),
        ].toSorted(),
      };
      return { ...core, semanticHash: hashValue(core) };
    })
    .toSorted((left, right) =>
      left.errorComponentId.localeCompare(right.errorComponentId),
    );
  const componentById = new Map(
    errorComponents.map((component) => [component.errorComponentId, component]),
  );
  const countLabel = (label: C60112GoldErrorLabel): number =>
    errorComponents.filter((component) => component.labels.includes(label))
      .length;
  const uniqueErrorCounts = {
    materialText: countLabel("MATERIAL_TEXT_ERROR"),
    severeTiming: countLabel("SEVERE_TIMING_ERROR"),
    hallucination: countLabel("HALLUCINATION"),
    missingDialogue: countLabel("MISSING_DIALOGUE"),
    overlap: countLabel("OVERLAP_ERROR"),
  };
  const itemLabels = input.items.map((item) => {
    const errorComponentIds = [
      ...(componentIdsByItem.get(item.itemId) ?? []),
    ].toSorted();
    const labels = [
      ...new Set(
        errorComponentIds.flatMap((id) => componentById.get(id)?.labels ?? []),
      ),
    ].toSorted();
    return {
      reviewItemId: item.itemId,
      labels:
        labels.length === 0
          ? (["CLEAN_OR_MINOR"] as (C60112GoldErrorLabel | "CLEAN_OR_MINOR")[])
          : labels,
      errorComponentIds,
    };
  });

  const metricsFor = (
    budget: C60112ReviewBudget,
    selected: readonly C60112EvaluableReviewItem[],
  ): C60112BudgetMetrics => {
    const capturedIds = new Set(
      selected.flatMap((item) => [
        ...(componentIdsByItem.get(item.itemId) ?? []),
      ]),
    );
    const selectedRegions = new Set(selected.map((item) => item.regionId));
    const regionCapturedIds = new Set(
      errorComponents
        .filter((component) =>
          component.coveredRegionIds.some((id) => selectedRegions.has(id)),
        )
        .map((component) => component.errorComponentId),
    );
    const covered = (label: C60112GoldErrorLabel): number =>
      [...capturedIds].filter((id) =>
        componentById.get(id)?.labels.includes(label),
      ).length;
    const material = covered("MATERIAL_TEXT_ERROR");
    const severe = covered("SEVERE_TIMING_ERROR");
    const hallucination = covered("HALLUCINATION");
    const missing = covered("MISSING_DIALOGUE");
    const overlapCount = covered("OVERLAP_ERROR");
    const relevantItemCount = selected.filter((item) =>
      [...(componentIdsByItem.get(item.itemId) ?? [])].some((id) =>
        componentById
          .get(id)
          ?.labels.some((label) => label !== "OVERLAP_ERROR"),
      ),
    ).length;
    const correctedAlignmentIds = new Set(
      selected.flatMap((item) => [
        ...(alignmentIdsByItem.get(item.itemId) ?? []),
      ]),
    );
    const simulated = simulatePerfectGoldCorrections({
      baseCues: input.baseCues,
      goldCues: input.goldCues,
      alignments: input.goldEvaluation.alignments,
      correctedAlignmentIds,
    });
    const totalErrors = errorComponents.length;
    return {
      budget,
      selectedReviewItemCount: selected.length,
      selectedRegionCount: selectedRegions.size,
      selectedAudioSeconds: audioSeconds(selected),
      coveredUniqueErrors: {
        materialText: material,
        severeTiming: severe,
        hallucination,
        missingDialogue: missing,
        overlap: overlapCount,
      },
      materialRecall: ratio(material, uniqueErrorCounts.materialText),
      severeTimingRecall: ratio(severe, uniqueErrorCounts.severeTiming),
      hallucinationRecall: ratio(
        hallucination,
        uniqueErrorCounts.hallucination,
      ),
      missingDialogueRecall: ratio(missing, uniqueErrorCounts.missingDialogue),
      reviewItemPrecision: ratio(relevantItemCount, selected.length),
      regionErrorRecall: ratio(regionCapturedIds.size, totalErrors),
      unreviewedResidualErrorRate: ratio(
        totalErrors - capturedIds.size,
        totalErrors,
      ),
      residualExactCer: simulated.exactCer,
      residualNormalizedCer: simulated.normalizedCer,
      residualMaterialErrors: uniqueErrorCounts.materialText - material,
      residualSevereTiming: uniqueErrorCounts.severeTiming - severe,
      residualMissing: uniqueErrorCounts.missingDialogue - missing,
      residualHallucination: uniqueErrorCounts.hallucination - hallucination,
    };
  };

  const budgets: C60112ReviewBudget[] = [
    "TOP_10_PERCENT",
    "TOP_20_PERCENT",
    "TOP_30_PERCENT",
    "TOP_40_PERCENT",
    "TOP_50_PERCENT",
    "ALL_REQUIRED",
  ];
  const rankings = rankingVariants(input.items);
  const r3 = rankings.find(
    (ranking) => ranking.baseline === "R3_FULL_EVIDENCE_RANK",
  );
  if (r3 === undefined) throw new Error("R3 ranking missing.");
  const r3AudioTargets = new Map(
    budgets.map((budget) => [
      budget,
      audioSeconds(selectItemBudget(r3.items, budget)),
    ]),
  );
  const rankingBaselines = rankings.map((ranking) => {
    const budgetMetrics = budgets.map((budget) =>
      metricsFor(budget, selectItemBudget(ranking.items, budget)),
    );
    const audioMatchedBudgetMetrics = budgets.map((budget) =>
      metricsFor(
        budget,
        budget === "ALL_REQUIRED"
          ? ranking.items.filter((item) => item.required)
          : selectAudioBudget(ranking.items, r3AudioTargets.get(budget) ?? 0),
      ),
    );
    return {
      baseline: ranking.baseline,
      budgetMetrics,
      audioMatchedBudgetMetrics,
      utilityScore:
        budgetMetrics
          .filter((metric) => metric.budget !== "ALL_REQUIRED")
          .reduce(
            (sum, metric) => sum + (1 - metric.unreviewedResidualErrorRate),
            0,
          ) / 5,
    };
  });
  const ranking = (baseline: C60112ReviewRanking) => {
    const result = rankingBaselines.find(
      (candidate) => candidate.baseline === baseline,
    );
    if (result === undefined) throw new Error(`Ranking missing: ${baseline}`);
    return result;
  };
  const top20 = (baseline: C60112ReviewRanking) => {
    const result = ranking(baseline).budgetMetrics.find(
      (metric) => metric.budget === "TOP_20_PERCENT",
    );
    if (result === undefined) throw new Error(`Top20 missing: ${baseline}`);
    return result;
  };
  const r3Metrics = ranking("R3_FULL_EVIDENCE_RANK");
  const r0Metrics = ranking("R0_CHRONOLOGICAL");
  const r3Top20 = top20("R3_FULL_EVIDENCE_RANK");
  const r0Top20 = top20("R0_CHRONOLOGICAL");
  const r2Top20 = top20("R2_CROSS_MODEL_DISAGREEMENT_ONLY");
  const rankingResult: C60112ReviewQualityEvaluation["rankingResult"] =
    r3Top20.unreviewedResidualErrorRate < r0Top20.unreviewedResidualErrorRate &&
    r3Top20.unreviewedResidualErrorRate <=
      r2Top20.unreviewedResidualErrorRate &&
    r3Top20.reviewItemPrecision >= r0Top20.reviewItemPrecision
      ? "REVIEW_PRIORITY_EFFECTIVE"
      : r3Metrics.utilityScore >= r0Metrics.utilityScore
        ? "REVIEW_PRIORITY_WEAK"
        : "REVIEW_PRIORITY_NOT_EFFECTIVE";

  const materialComponents = errorComponents.filter((component) =>
    component.labels.includes("MATERIAL_TEXT_ERROR"),
  );
  const workingById = new Map(
    [...working.values()].map((component) => [
      component.errorComponentId,
      component,
    ]),
  );
  const textForAlignments = (
    ids: readonly string[],
    side: "machine" | "gold",
  ): string =>
    input.goldEvaluation.alignments
      .filter((alignment) => ids.includes(alignment.alignmentId))
      .map((alignment) =>
        side === "machine" ? alignment.machineExcerpt : alignment.goldExcerpt,
      )
      .join("");
  const candidateFixability = input.items.flatMap((item) =>
    [...(componentIdsByItem.get(item.itemId) ?? [])]
      .filter((id) =>
        componentById.get(id)?.labels.includes("MATERIAL_TEXT_ERROR"),
      )
      .map((errorComponentId) => {
        const componentAlignmentIds = [
          ...(workingById.get(errorComponentId)?.alignmentIds ?? []),
        ];
        const localAlignmentIds = componentAlignmentIds.filter((id) =>
          alignmentIdsByItem.get(item.itemId)?.has(id),
        );
        const coversWholeComponent =
          localAlignmentIds.length > 0 &&
          localAlignmentIds.length === componentAlignmentIds.length;
        const rawComparison = compareCandidates({
          currentText: textForAlignments(localAlignmentIds, "machine"),
          goldText: textForAlignments(localAlignmentIds, "gold"),
          candidates: item.candidateTexts,
          reviewItemAvailable: localAlignmentIds.length > 0,
        });
        const comparison =
          coversWholeComponent ||
          ![
            "WHISPER_ALT_FIXABLE",
            "REAZON_FIXABLE",
            "BOTH_CANDIDATE_FIXABLE",
          ].includes(rawComparison.classification)
            ? rawComparison
            : {
                ...rawComparison,
                classification:
                  "CANDIDATE_PARTIAL_FIX" as C60112CandidateFixability,
                fullFixCandidateIds: [],
                partialFixCandidateIds: [
                  ...new Set([
                    ...rawComparison.partialFixCandidateIds,
                    ...rawComparison.fullFixCandidateIds,
                  ]),
                ].toSorted(),
              };
        const core = {
          reviewItemId: item.itemId,
          errorComponentIds: [errorComponentId],
          ...comparison,
        };
        return { ...core, semanticHash: hashValue(core) };
      }),
  );
  const materialErrorFixability = materialComponents.map((component) => {
    const pairRecords = candidateFixability.filter(
      (record) => record.errorComponentIds[0] === component.errorComponentId,
    );
    const classifications = new Set(
      pairRecords.map((record) => record.classification),
    );
    const hasWhisper =
      classifications.has("WHISPER_ALT_FIXABLE") ||
      classifications.has("BOTH_CANDIDATE_FIXABLE");
    const hasReazon =
      classifications.has("REAZON_FIXABLE") ||
      classifications.has("BOTH_CANDIDATE_FIXABLE");
    const classification: C60112CandidateFixability =
      hasWhisper && hasReazon
        ? "BOTH_CANDIDATE_FIXABLE"
        : hasWhisper
          ? "WHISPER_ALT_FIXABLE"
          : hasReazon
            ? "REAZON_FIXABLE"
            : classifications.has("CURRENT_ALREADY_CORRECT")
              ? "CURRENT_ALREADY_CORRECT"
              : classifications.has("CANDIDATE_PARTIAL_FIX")
                ? "CANDIDATE_PARTIAL_FIX"
                : pairRecords.length === 0 ||
                    pairRecords.every(
                      (record) => record.classification === "UNEVALUABLE",
                    )
                  ? "UNEVALUABLE"
                  : "MANUAL_EDIT_REQUIRED";
    const comparison = {
      classification,
      fullFixCandidateIds: [
        ...new Set(pairRecords.flatMap((record) => record.fullFixCandidateIds)),
      ].toSorted(),
      partialFixCandidateIds: [
        ...new Set(
          pairRecords.flatMap((record) => record.partialFixCandidateIds),
        ),
      ].toSorted(),
    };
    const core = {
      errorComponentId: component.errorComponentId,
      reviewItemIds: [
        ...new Set(pairRecords.map((record) => record.reviewItemId)),
      ].toSorted(),
      ...comparison,
    };
    return { ...core, semanticHash: hashValue(core) };
  });
  const classCount = (classification: C60112CandidateFixability): number =>
    materialErrorFixability.filter(
      (record) => record.classification === classification,
    ).length;
  const candidateFixableMaterialErrorCount =
    classCount("WHISPER_ALT_FIXABLE") +
    classCount("REAZON_FIXABLE") +
    classCount("BOTH_CANDIDATE_FIXABLE");
  const candidateFixabilitySummary = {
    materialErrorCount: materialComponents.length,
    candidateFixableMaterialErrorCount,
    candidateFixRate: ratio(
      candidateFixableMaterialErrorCount,
      materialComponents.length,
    ),
    whisperAlternateFixableCount: classCount("WHISPER_ALT_FIXABLE"),
    reazonFixableCount: classCount("REAZON_FIXABLE"),
    bothCandidateFixableCount: classCount("BOTH_CANDIDATE_FIXABLE"),
    partialFixCount: classCount("CANDIDATE_PARTIAL_FIX"),
    manualEditRequiredCount: classCount("MANUAL_EDIT_REQUIRED"),
    manualEditRate: ratio(
      classCount("MANUAL_EDIT_REQUIRED"),
      materialComponents.length,
    ),
    unevaluableCount: classCount("UNEVALUABLE"),
  };

  const rankPositions = new Map(
    rankings.map((candidate) => [
      candidate.baseline,
      new Map(candidate.items.map((item, index) => [item.itemId, index + 1])),
    ]),
  );
  const specialErrorRanks = errorComponents
    .flatMap((component) =>
      component.labels
        .filter(
          (label): label is "HALLUCINATION" | "MISSING_DIALOGUE" =>
            label === "HALLUCINATION" || label === "MISSING_DIALOGUE",
        )
        .map((label) => ({ component, label })),
    )
    .map(({ component, label }) => ({
      errorComponentId: component.errorComponentId,
      label,
      queueCaptured: component.coveredReviewItemIds.length > 0,
      rankPositions: Object.fromEntries(
        rankings.map((candidate) => {
          const positions = component.coveredReviewItemIds
            .map((id) => rankPositions.get(candidate.baseline)?.get(id))
            .filter((value): value is number => value !== undefined);
          return [
            candidate.baseline,
            positions.length === 0 ? null : Math.min(...positions),
          ];
        }),
      ) as Record<C60112ReviewRanking, number | null>,
    }));

  const requiredItems = input.items.filter((item) => item.required);
  const totalReviewAudioSeconds = audioSeconds(input.items);
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2" as const,
    artifactType: "c6-0-1-12-review-quality-evaluation" as const,
    generatedAt: input.generatedAt,
    reviewPackageFreezeHash: input.reviewPackageFreezeHash,
    machineFinalMutated: false as const,
    idealSimulationMethod:
      "GLOBAL_TEXT_RECOMPUTATION_WITH_SELECTED_GOLD_ALIGNMENTS" as const,
    rankingInputHashes: {
      oldSingleAsrRiskArtifactSha256: input.oldSingleAsrRiskArtifactSha256,
    },
    overlapEvaluation,
    uniqueErrorCounts,
    errorComponents,
    itemLabels,
    budgetMetrics: r3Metrics.budgetMetrics,
    rankingBaselines,
    rankingResult,
    candidateFixability,
    materialErrorFixability,
    candidateFixabilitySummary,
    specialErrorRanks,
    burden: {
      totalReviewItems: input.items.length,
      requiredItems: requiredItems.length,
      totalReviewRegions: new Set(input.items.map((item) => item.regionId))
        .size,
      requiredRegions: new Set(requiredItems.map((item) => item.regionId)).size,
      totalReviewAudioSeconds,
      requiredReviewAudioSeconds: audioSeconds(requiredItems),
      reviewAudioEpisodeRatio: ratio(
        totalReviewAudioSeconds,
        input.episodeDurationSeconds,
      ),
      candidateActionableItems: input.items.filter((item) =>
        item.candidateTexts.some((candidate) =>
          candidate.providers.some((provider) => provider !== "CURRENT"),
        ),
      ).length,
      manualEditLikelyItems: candidateFixability.filter((record) =>
        ["MANUAL_EDIT_REQUIRED", "UNEVALUABLE"].includes(record.classification),
      ).length,
      humanReviewTimeStatus: "NOT_MEASURED_IN_C6_0_1_12" as const,
    },
    containsFullGoldText: false as const,
  };
  return {
    ...core,
    semanticHash: hashValue({ ...core, generatedAt: undefined }),
  };
}
