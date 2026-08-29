import { createHash } from "node:crypto";

import {
  humanCorrectionRecordSchema,
  subtitlePackageSchema,
  type HumanCorrectionRecord,
  type SubtitleCue,
  type SubtitlePackage,
} from "@mvl/shared";
import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";

export const C60112_DECISION_TYPES = [
  "KEEP_CURRENT",
  "USE_REAZON",
  "USE_WHISPER_ALTERNATE",
  "MANUAL_EDIT",
  "TIMING_EDIT",
  "ADD_NEW_CUE",
  "MARK_FALSE_POSITIVE",
  "UNRESOLVED",
  "WAIVE_REVIEW",
] as const;

export type C60112DecisionType = (typeof C60112_DECISION_TYPES)[number];

export interface C60112CandidateChoice {
  candidateId: string;
  provider: "CURRENT_FINAL" | "WHISPER" | "REAZON" | "INDEPENDENT";
  providers?: readonly (
    "CURRENT_FINAL" | "WHISPER" | "REAZON" | "INDEPENDENT"
  )[];
  text: string;
  start: number | null;
  end: number | null;
}

export interface C60112ReviewDecision {
  decisionId: string;
  sessionId: string;
  itemId: string;
  sequence: number;
  decidedAt: string;
  action: C60112DecisionType;
  targetCueIds: string[];
  selectedCandidateId: string | null;
  manualText: string | null;
  manualStart: number | null;
  manualEnd: number | null;
  newCue: {
    id: string;
    text: string;
    start: number;
    end: number;
  } | null;
  note: string | null;
}

export interface C60112AppliedDecision {
  decisionId: string;
  action: C60112DecisionType;
  targetCueIds: string[];
  outcome: "MUTATED" | "RECORDED_ONLY" | "REJECTED";
  reason: string;
  beforeCueHash: string;
  afterCueHash: string;
}

export interface C60112CorrectionApplyResult {
  package: SubtitlePackage;
  ass: string;
  srt: string;
  vtt: string;
  applied: C60112AppliedDecision[];
  summary: {
    decisionCount: number;
    mutatedDecisionCount: number;
    recordedOnlyDecisionCount: number;
    rejectedDecisionCount: number;
    addedCueCount: number;
    deletedCueCount: number;
    baseCueHash: string;
    correctedCueHash: string;
  };
}

function decisionFromCorrectionSnapshot(input: {
  record: HumanCorrectionRecord;
  action: C60112DecisionType;
  suffix: string;
  selectedCandidateId?: string | null;
  manualText?: string | null;
  manualStart?: number | null;
  manualEnd?: number | null;
  newCue?: C60112ReviewDecision["newCue"];
}): C60112ReviewDecision {
  return {
    decisionId: `${input.record.decisionId}:${input.suffix}`,
    sessionId: input.record.sessionId,
    itemId: input.record.reviewItemId,
    sequence: 0,
    decidedAt: input.record.createdAt,
    action: input.action,
    targetCueIds: input.record.cueIds,
    selectedCandidateId: input.selectedCandidateId ?? null,
    manualText: input.manualText ?? null,
    manualStart: input.manualStart ?? null,
    manualEnd: input.manualEnd ?? null,
    newCue: input.newCue ?? null,
    note: input.record.reviewerNote,
  };
}

export function materializeC60112ActiveCorrectionSnapshot(input: {
  record: HumanCorrectionRecord;
  basePackage: SubtitlePackage;
}): C60112ReviewDecision[] {
  const record = humanCorrectionRecordSchema.parse(input.record);
  const basePackage = subtitlePackageSchema.parse(input.basePackage);
  switch (record.decisionType) {
    case "ADD_NEW_CUE":
      if (
        record.afterText === null ||
        record.afterStart === null ||
        record.afterEnd === null
      ) {
        throw new Error(`INCOMPLETE_ADD_NEW_CUE:${record.recordId}`);
      }
      return [
        decisionFromCorrectionSnapshot({
          record,
          action: "ADD_NEW_CUE",
          suffix: "new-cue",
          newCue: {
            id: `human-added:${record.recordId}`,
            text: record.afterText,
            start: record.afterStart,
            end: record.afterEnd,
          },
        }),
      ];
    case "KEEP_CURRENT":
    case "MARK_FALSE_POSITIVE":
    case "UNRESOLVED":
    case "WAIVE_REVIEW":
      return [
        decisionFromCorrectionSnapshot({
          record,
          action: record.decisionType,
          suffix: "recorded",
        }),
      ];
    case "USE_REAZON":
    case "USE_WHISPER_ALTERNATE":
    case "MANUAL_EDIT":
    case "TIMING_EDIT":
      break;
  }
  if (record.cueIds.length !== 1) {
    throw new Error(`SINGLE_CUE_ACTION_REQUIRED:${record.recordId}`);
  }
  const targetCueId = record.cueIds[0];
  const baseCue = basePackage.cues.find((cue) => cue.id === targetCueId);
  if (baseCue === undefined) {
    throw new Error(`CORRECTION_TARGET_CUE_NOT_FOUND:${record.recordId}`);
  }
  if (
    record.afterText === null ||
    record.afterText.trim() === "" ||
    record.afterStart === null ||
    record.afterEnd === null
  ) {
    throw new Error(`INCOMPLETE_ACTIVE_CORRECTION_SNAPSHOT:${record.recordId}`);
  }
  const decisions: C60112ReviewDecision[] = [];
  if (record.decisionType === "USE_REAZON") {
    decisions.push(
      decisionFromCorrectionSnapshot({
        record,
        action: "USE_REAZON",
        suffix: "text",
        selectedCandidateId: record.selectedCandidateId,
      }),
    );
  } else if (record.decisionType === "USE_WHISPER_ALTERNATE") {
    decisions.push(
      decisionFromCorrectionSnapshot({
        record,
        action: "USE_WHISPER_ALTERNATE",
        suffix: "text",
        selectedCandidateId: record.selectedCandidateId,
      }),
    );
  } else if (
    record.decisionType === "MANUAL_EDIT" ||
    record.afterText !== baseCue.text
  ) {
    decisions.push(
      decisionFromCorrectionSnapshot({
        record,
        action: "MANUAL_EDIT",
        suffix: "text",
        manualText: record.afterText,
      }),
    );
  }
  if (
    record.decisionType === "TIMING_EDIT" ||
    record.afterStart !== baseCue.start ||
    record.afterEnd !== baseCue.end
  ) {
    decisions.push(
      decisionFromCorrectionSnapshot({
        record,
        action: "TIMING_EDIT",
        suffix: "timing",
        manualStart: record.afterStart,
        manualEnd: record.afterEnd,
      }),
    );
  }
  if (decisions.length === 0) {
    throw new Error(`CORRECTION_SNAPSHOT_HAS_NO_EFFECT:${record.recordId}`);
  }
  return decisions;
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

export function c60112CueHash(cues: readonly SubtitleCue[]): string {
  return createHash("sha256")
    .update(
      stable(
        cues.map(({ id, start, end, text, style, speaker }) => ({
          id,
          start,
          end,
          text,
          style: style ?? "default",
          speaker,
        })),
      ),
    )
    .digest("hex");
}

function candidateForDecision(
  decision: C60112ReviewDecision,
  candidates: ReadonlyMap<string, C60112CandidateChoice>,
): C60112CandidateChoice | null {
  if (decision.selectedCandidateId === null) return null;
  const candidate = candidates.get(decision.selectedCandidateId) ?? null;
  if (candidate === null) return null;
  const providers = new Set([
    candidate.provider,
    ...(candidate.providers ?? []),
  ]);
  if (decision.action === "USE_REAZON" && !providers.has("REAZON")) {
    return null;
  }
  if (
    decision.action === "USE_WHISPER_ALTERNATE" &&
    !providers.has("WHISPER")
  ) {
    return null;
  }
  return candidate;
}

function updateTargetCues(
  cues: readonly SubtitleCue[],
  targetCueIds: readonly string[],
  update: (cue: SubtitleCue) => SubtitleCue,
): { cues: SubtitleCue[]; matched: number } {
  const targets = new Set(targetCueIds);
  let matched = 0;
  return {
    cues: cues.map((cue) => {
      if (!targets.has(cue.id)) return cue;
      matched += 1;
      return update(cue);
    }),
    matched,
  };
}

function changedTextCue(cue: SubtitleCue, text: string): SubtitleCue {
  return {
    ...cue,
    text,
    textAudit:
      cue.textAudit === undefined
        ? undefined
        : {
            ...cue.textAudit,
            repairedText: text,
            normalizedText: text.normalize("NFKC"),
            reviewRecommended: false,
            reviewReasons: [],
          },
  };
}

function sortCues(cues: readonly SubtitleCue[]): SubtitleCue[] {
  return [...cues].toSorted(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.id.localeCompare(right.id),
  );
}

function assertCueStructure(
  cues: readonly SubtitleCue[],
  durationSeconds: number,
  label: string,
): void {
  const ids = new Set<string>();
  for (const cue of cues) {
    if (ids.has(cue.id)) throw new Error(`${label}:DUPLICATE_CUE_ID:${cue.id}`);
    ids.add(cue.id);
    if (
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < 0 ||
      cue.end <= cue.start ||
      cue.end > durationSeconds
    ) {
      throw new Error(`${label}:INVALID_CUE_INTERVAL:${cue.id}`);
    }
  }
  const sorted = sortCues(cues);
  if (sorted.some((cue, index) => cue.id !== cues[index]?.id)) {
    throw new Error(`${label}:CUES_NOT_SORTED`);
  }
}

function applyOne(
  current: readonly SubtitleCue[],
  decision: C60112ReviewDecision,
  candidates: ReadonlyMap<string, C60112CandidateChoice>,
): {
  cues: SubtitleCue[];
  outcome: C60112AppliedDecision["outcome"];
  reason: string;
} {
  if (
    decision.action === "KEEP_CURRENT" ||
    decision.action === "UNRESOLVED" ||
    decision.action === "WAIVE_REVIEW" ||
    decision.action === "MARK_FALSE_POSITIVE"
  ) {
    if (
      decision.action === "WAIVE_REVIEW" &&
      (decision.note?.trim() ?? "") === ""
    ) {
      return {
        cues: [...current],
        outcome: "REJECTED",
        reason: "waive-review-requires-note",
      };
    }
    return {
      cues: [...current],
      outcome: "RECORDED_ONLY",
      reason: `${decision.action.toLowerCase()}-recorded-without-canonical-mutation`,
    };
  }

  if (decision.action === "ADD_NEW_CUE") {
    const newCue = decision.newCue;
    if (
      newCue === null ||
      newCue.text.trim() === "" ||
      newCue.start < 0 ||
      newCue.end <= newCue.start ||
      current.some((cue) => cue.id === newCue.id)
    ) {
      return {
        cues: [...current],
        outcome: "REJECTED",
        reason: "invalid-new-cue",
      };
    }
    const template =
      current.find((cue) => cue.end >= newCue.start) ?? current[0];
    if (template === undefined) {
      return {
        cues: [...current],
        outcome: "REJECTED",
        reason: "missing-cue-template",
      };
    }
    const inserted: SubtitleCue = {
      ...template,
      id: newCue.id,
      start: newCue.start,
      end: newCue.end,
      text: newCue.text,
      speaker: null,
      confidence: null,
      textAudit: undefined,
      timingEvidence: undefined,
    };
    return {
      cues: [...current, inserted].toSorted(
        (left, right) =>
          left.start - right.start ||
          left.end - right.end ||
          left.id.localeCompare(right.id),
      ),
      outcome: "MUTATED",
      reason: "new-cue-added",
    };
  }

  if (decision.targetCueIds.length !== 1) {
    return {
      cues: [...current],
      outcome: "REJECTED",
      reason: "single-cue-target-required",
    };
  }

  if (decision.action === "TIMING_EDIT") {
    if (
      decision.manualStart === null ||
      decision.manualEnd === null ||
      decision.manualStart < 0 ||
      decision.manualEnd <= decision.manualStart
    ) {
      return {
        cues: [...current],
        outcome: "REJECTED",
        reason: "invalid-timing-edit",
      };
    }
    const targetCount = decision.targetCueIds.length;
    const result = updateTargetCues(current, decision.targetCueIds, (cue) => ({
      ...cue,
      start: decision.manualStart ?? cue.start,
      end: decision.manualEnd ?? cue.end,
      timingEvidence: undefined,
    }));
    if (result.matched !== targetCount) {
      return {
        cues: [...current],
        outcome: "REJECTED",
        reason: "target-cue-not-found",
      };
    }
    return {
      cues: sortCues(result.cues),
      outcome: "MUTATED",
      reason: "timing-edited",
    };
  }

  let replacement: string | null = null;
  if (decision.action === "MANUAL_EDIT") {
    replacement = decision.manualText;
  } else {
    replacement = candidateForDecision(decision, candidates)?.text ?? null;
  }
  if (replacement === null || replacement.trim() === "") {
    return {
      cues: [...current],
      outcome: "REJECTED",
      reason: "replacement-text-unavailable",
    };
  }
  const targetCount = decision.targetCueIds.length;
  const result = updateTargetCues(current, decision.targetCueIds, (cue) =>
    changedTextCue(cue, replacement),
  );
  if (result.matched !== targetCount) {
    return {
      cues: [...current],
      outcome: "REJECTED",
      reason: "target-cue-not-found",
    };
  }
  return { cues: result.cues, outcome: "MUTATED", reason: "text-replaced" };
}

export function applyC60112ReviewDecisions(input: {
  basePackage: SubtitlePackage;
  expectedBaseCueHash: string;
  decisions: readonly C60112ReviewDecision[];
  candidates: readonly C60112CandidateChoice[];
}): C60112CorrectionApplyResult {
  const parsedBase = subtitlePackageSchema.parse(input.basePackage);
  assertCueStructure(
    parsedBase.cues,
    parsedBase.source.durationSeconds,
    "BASE_PACKAGE",
  );
  const baseCueHash = c60112CueHash(parsedBase.cues);
  if (baseCueHash !== input.expectedBaseCueHash) {
    throw new Error(
      `STALE_BASE_CUE_HASH: expected ${input.expectedBaseCueHash}, received ${baseCueHash}`,
    );
  }
  const candidateMap = new Map(
    input.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  let cues = sortCues(parsedBase.cues);
  const applied: C60112AppliedDecision[] = [];
  for (const decision of [...input.decisions].toSorted(
    (left, right) =>
      left.sequence - right.sequence ||
      left.decisionId.localeCompare(right.decisionId),
  )) {
    const beforeCueHash = c60112CueHash(cues);
    const result = applyOne(cues, decision, candidateMap);
    cues = sortCues(result.cues);
    assertCueStructure(
      cues,
      parsedBase.source.durationSeconds,
      `DECISION_${decision.decisionId}`,
    );
    applied.push({
      decisionId: decision.decisionId,
      action: decision.action,
      targetCueIds: [...decision.targetCueIds],
      outcome: result.outcome,
      reason: result.reason,
      beforeCueHash,
      afterCueHash: c60112CueHash(cues),
    });
  }
  const correctedPackage = subtitlePackageSchema.parse({
    ...parsedBase,
    status: parsedBase.status,
    primarySubtitle:
      parsedBase.primarySubtitle === null
        ? null
        : {
            ...parsedBase.primarySubtitle,
            validationStatus: "needs-review" as const,
          },
    cues,
    warnings: [
      ...parsedBase.warnings,
      "C6.0.1.12 human correction workflow output; independent release validation remains required.",
    ],
  });
  const deletedCueCount = parsedBase.cues.filter(
    (cue) =>
      !correctedPackage.cues.some((candidate) => candidate.id === cue.id),
  ).length;
  const addedCueCount = correctedPackage.cues.filter(
    (cue) => !parsedBase.cues.some((candidate) => candidate.id === cue.id),
  ).length;
  return {
    package: correctedPackage,
    ass: formatAss(correctedPackage.cues),
    srt: formatSrt(correctedPackage.cues),
    vtt: formatVtt(correctedPackage.cues),
    applied,
    summary: {
      decisionCount: applied.length,
      mutatedDecisionCount: applied.filter((item) => item.outcome === "MUTATED")
        .length,
      recordedOnlyDecisionCount: applied.filter(
        (item) => item.outcome === "RECORDED_ONLY",
      ).length,
      rejectedDecisionCount: applied.filter(
        (item) => item.outcome === "REJECTED",
      ).length,
      addedCueCount,
      deletedCueCount,
      baseCueHash,
      correctedCueHash: c60112CueHash(correctedPackage.cues),
    },
  };
}
