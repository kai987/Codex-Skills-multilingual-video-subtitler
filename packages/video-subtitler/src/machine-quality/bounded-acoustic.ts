import { z } from "zod";
import { subtitleCueSchema, type SubtitleCue } from "@mvl/shared";
import type { StageTrace } from "./matched-replay.js";
import { objectHash } from "./experimental-profile.js";

export const ACOUSTIC_POLICY = {
  version: "c601162-bounded-v1",
  maximumAttempts: 12,
  maximumDecodedSeconds: 360,
  maximumWindowSeconds: 30,
  contexts: [0.5, 2],
  replacement:
    "two families, both windows, exact normalized core agreement, complete interval localization, unchanged stage boundaries",
  collapse: "disabled without independently validated same-event identity",
  pointTimestamps:
    "local lexical observations only, never complete word intervals",
  uncertainty: "ABSTAIN_KEEP_STAGE_INPUT",
  referenceScope:
    "fixed machine core; boundary-crossing reference stays ambiguous",
  qualityGate:
    "report every CER/S/D/I/timing/display tradeoff; no release or default promotion",
  heldout: "HELDOUT_VALIDATION_NOT_RUN",
} as const;
export const ACOUSTIC_CLASSES = [
  "REAL_REPEATED_SPEECH_SUPPORTED",
  "SAME_EVENT_DUPLICATE_REPRESENTATION_SUPPORTED",
  "DECODER_LOOP_SUSPECTED",
  "WHOLE_HYPOTHESIS_UNSUPPORTED_BY_NEW_ASR",
  "ADJACENT_DISTINCT_UTTERANCES_SUPPORTED",
  "MIXED_REPETITION_AND_LEXICAL_ERROR",
  "UNKNOWN",
] as const;
export function accountAttempt(
  previous: readonly { requestId: string; decodedSeconds: number }[],
  next: { requestId: string; decodedSeconds: number },
) {
  if (previous.some((r) => r.requestId === next.requestId))
    throw Error("Already attempted; reconcile instead of hidden retry");
  if (
    !Number.isFinite(next.decodedSeconds) ||
    next.decodedSeconds <= 0 ||
    next.decodedSeconds > 30 ||
    previous.length >= 12 ||
    previous.reduce((n, r) => n + r.decodedSeconds, 0) + next.decodedSeconds >
      360
  )
    throw Error("Recognition budget exhausted");
  return [...previous, next];
}
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((x) => x.end > x.start);
export const acousticCaseSchema = z
  .object({
    id: z.string(),
    bindingHash: digest,
    before: subtitleCueSchema,
    sourceRequestIds: z.array(z.string()).min(1),
    occurrenceIds: z.array(z.string()).min(1),
    occurrences: z.array(subtitleCueSchema).min(1),
    neighbors: z.array(subtitleCueSchema),
    legacyAfter: z.array(subtitleCueSchema),
    preservedAfter: z.array(subtitleCueSchema),
    core: interval,
    sourceSamples: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        rate: z.number().positive(),
      })
      .strict(),
    dedupLineage: z.array(
      z
        .object({
          inputId: z.string(),
          outputIds: z.array(z.string()),
          reason: z.string(),
        })
        .strict(),
    ),
    selectionReason: z.literal("LEGACY_DESTRUCTIVE_SOURCE_PRESERVING_ABSTAIN"),
  })
  .strict();
export type AcousticCase = z.infer<typeof acousticCaseSchema>;
export function deriveAcousticCases(
  legacy: StageTrace[],
  preserved: StageTrace[],
  rate: number,
): AcousticCase[] {
  const old = legacy.find(
    (s) => s.stageName === "repairIntraCueHypothesisRepetition",
  );
  const fresh = preserved.find(
    (s) => s.stageName === "repairIntraCueHypothesisRepetition",
  );
  const dedup = legacy.find(
    (s) => s.stageName === "deduplicateTopScoreWinners",
  );
  const mapping = legacy.find((s) => s.stageName === "primaryMinimal");
  if (!old || !fresh || !dedup || !mapping)
    throw Error("Missing machine stages");
  const compact = (t: string) =>
    t.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
  return old.operations
    .filter((o) => {
      const n = fresh.operations.find(
        (n) => n.affectedInput.id === o.affectedInput.id,
      );
      return (
        n?.reason.startsWith("ABSTAIN_") &&
        compact(o.affectedInput.text) !==
          compact(o.correspondingOutput.map((c) => c.text).join(""))
      );
    })
    .map((o, index) => {
      const ids = new Set(o.sourceOccurrenceIds);
      // Transitive *lineage*, not arbitrary neighboring text similarity.
      let changed = true;
      while (changed) {
        changed = false;
        for (const d of dedup.operations) {
          const linked = [
            d.affectedInput.id,
            ...d.correspondingOutput.map((c) => c.id),
          ];
          if (linked.some((id) => ids.has(id)))
            for (const id of linked)
              if (!ids.has(id)) {
                ids.add(id);
                changed = true;
              }
        }
      }
      const occurrences = dedup.input.filter((c) => ids.has(c.id));
      if (!occurrences.length) throw Error("No source occurrence");
      const requests = [
        ...new Set(
          mapping.operations
            .filter((r) => r.correspondingOutput.some((c) => ids.has(c.id)))
            .flatMap((r) => r.sourceRequestIds),
        ),
      ];
      const sourceIds = new Set(
        mapping.operations
          .filter((r) => r.sourceRequestIds.some((id) => requests.includes(id)))
          .flatMap((r) => r.correspondingOutput.map((c) => c.id)),
      );
      const candidates = dedup.input.filter((c) => sourceIds.has(c.id));
      const neighbors = candidates.filter(
        (c, i) =>
          !ids.has(c.id) &&
          (ids.has(candidates[i - 1]?.id ?? "") ||
            ids.has(candidates[i + 1]?.id ?? "")),
      );
      const start = Math.floor(
          Math.min(...occurrences.map((c) => c.start)) * rate,
        ),
        end = Math.ceil(Math.max(...occurrences.map((c) => c.end)) * rate);
      return acousticCaseSchema.parse({
        id: `case-${String(index + 1).padStart(2, "0")}`,
        bindingHash: objectHash(o.affectedInput),
        before: o.affectedInput,
        sourceRequestIds: requests,
        occurrenceIds: [...ids].sort(),
        occurrences,
        neighbors,
        legacyAfter: o.correspondingOutput,
        preservedAfter: fresh.operations.find(
          (n) => n.affectedInput.id === o.affectedInput.id,
        )?.correspondingOutput,
        core: { start: start / rate, end: end / rate },
        sourceSamples: { start, end, rate },
        dedupLineage: dedup.operations
          .filter((d) => ids.has(d.affectedInput.id))
          .map((d) => ({
            inputId: d.affectedInput.id,
            outputIds: d.correspondingOutput.map((c) => c.id),
            reason: d.reason,
          })),
        selectionReason: "LEGACY_DESTRUCTIVE_SOURCE_PRESERVING_ABSTAIN",
      });
    });
}
export function caseWindows(c: AcousticCase, duration: number) {
  const rate = c.sourceSamples.rate,
    total = Math.floor(duration * rate);
  const windows = ACOUSTIC_POLICY.contexts.map((pad, i) => {
    const start = Math.max(0, c.sourceSamples.start - pad * rate),
      end = Math.min(total, c.sourceSamples.end + pad * rate);
    return {
      id: `w${i + 1}`,
      startSample: start,
      endSample: end,
      sampleRate: rate,
      start: start / rate,
      end: end / rate,
      seconds: (end - start) / rate,
      clipped: start === 0 || end === total,
      status:
        (end - start) / rate > 30 ? "WINDOW_BUDGET_UNSATISFIED" : "PLANNED",
    };
  });
  return windows.filter(
    (w, i) =>
      windows.findIndex(
        (x) => x.startSample === w.startSample && x.endSample === w.endSample,
      ) === i,
  );
}
export const observationSchema = z
  .object({
    requestId: z.string(),
    caseBindingHash: digest,
    family: z.enum(["whisper", "reazon"]),
    windowId: z.string(),
    audioHash: digest,
    window: interval,
    status: z.enum([
      "SUCCESS",
      "EMPTY_OUTPUT",
      "PROVIDER_ERROR",
      "MODEL_UNAVAILABLE",
      "AUDIO_UNAVAILABLE",
    ]),
    text: z.string(),
    segments: z.array(
      z
        .object({
          text: z.string(),
          start: z.number().nonnegative(),
          end: z.number().positive(),
        })
        .strict(),
    ),
    points: z.array(z.object({ text: z.string(), time: z.number() }).strict()),
    timebase: z.literal("source-global-once"),
    timingKind: z.enum([
      "SEGMENT_INTERVALS",
      "TOKEN_POINTS",
      "WINDOW_LEVEL_ONLY",
    ]),
    resultHash: digest,
  })
  .strict();
export type AcousticObservation = z.infer<typeof observationSchema>;
export const acousticBundleSchema = z
  .object({
    version: z.literal("c601162-evidence-v1"),
    primaryHash: digest,
    planHash: digest,
    policyHash: digest,
    cases: z.array(acousticCaseSchema),
    observations: z.array(observationSchema),
    frozenAt: z.string(),
  })
  .strict();
export type AcousticBundle = z.infer<typeof acousticBundleSchema>;
export const lexical = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\p{P}\p{Z}\s]/gu, "")
    .toLowerCase();
export function localizeObservation(
  o: AcousticObservation,
  core: { start: number; end: number },
) {
  if (o.status !== "SUCCESS" || !o.text.trim())
    return { status: "UNLOCALIZABLE", text: "", complete: false };
  if (o.timingKind === "TOKEN_POINTS") {
    const points = o.points.filter(
      (p) => p.time >= core.start && p.time <= core.end,
    );
    const monotonic = o.points.every(
      (p, i) =>
        Number.isFinite(p.time) &&
        (i === 0 || p.time >= (o.points[i - 1]?.time ?? 0)) &&
        p.time >= o.window.start &&
        p.time <= o.window.end,
    );
    return {
      status: monotonic && points.length ? "PARTIAL_CORE" : "UNLOCALIZABLE",
      text: monotonic ? points.map((p) => p.text).join("") : "",
      complete: false,
    };
  }
  if (
    o.timingKind !== "SEGMENT_INTERVALS" ||
    o.segments.some(
      (s) =>
        s.end <= s.start || s.start < o.window.start || s.end > o.window.end,
    )
  )
    return { status: "UNLOCALIZABLE", text: "", complete: false };
  const touching = o.segments.filter(
    (s) => s.end > core.start && s.start < core.end,
  );
  const inside = touching.filter(
    (s) => s.start >= core.start && s.end <= core.end,
  );
  if (touching.length !== inside.length)
    return {
      status: "CONTEXT_CONTAMINATED",
      text: inside.map((s) => s.text).join(""),
      complete: false,
    };
  return {
    status: inside.length ? "CORE_COMPARABLE" : "UNLOCALIZABLE",
    text: inside.map((s) => s.text).join(""),
    complete: inside.length > 0,
  };
}
export function decideAcoustic(
  c: AcousticCase,
  observations: AcousticObservation[],
) {
  const relevant = observations.filter(
    (o) => o.caseBindingHash === c.bindingHash,
  );
  if (new Set(relevant.map((o) => o.requestId)).size !== relevant.length)
    throw Error("Duplicate evidence request");
  const localized = relevant.map((o) => ({
    requestId: o.requestId,
    family: o.family,
    windowId: o.windowId,
    resultHash: o.resultHash,
    ...localizeObservation(o, c.core),
  }));
  const supports = localized.filter((o) => o.complete && lexical(o.text));
  const families = ["whisper", "reazon"] as const;
  const allComparable =
    families.every(
      (f) =>
        new Set(supports.filter((o) => o.family === f).map((o) => o.windowId))
          .size === 2 &&
        new Set(relevant.filter((o) => o.family === f).map((o) => o.audioHash))
          .size === 2,
    ) && supports.length === 4;
  const agreed =
    allComparable && new Set(supports.map((o) => lexical(o.text))).size === 1;
  const old = lexical(c.before.text);
  const wholeConflict =
    agreed && supports.every((o) => lexical(o.text) !== old);
  const unchanged = agreed && supports.every((o) => lexical(o.text) === old);
  // Even perfect agreement does not establish same-event identity or word boundaries.
  // This first bounded policy only replaces an entirely localized single-stage span.
  const isolated =
    c.occurrenceIds.length === 1 &&
    c.core.start === c.before.start &&
    c.core.end === c.before.end;
  const candidate = supports[0];
  const replace = Boolean(
    wholeConflict &&
    isolated &&
    candidate &&
    /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u.test(
      candidate.text,
    ),
  );
  return {
    bindingHash: c.bindingHash,
    caseId: c.id,
    before: c.before,
    after:
      replace && candidate ? { ...c.before, text: candidate.text } : c.before,
    action: replace
      ? "REPLACE_WITH_LOCALIZED_FRESH_CANDIDATE"
      : unchanged
        ? "KEEP_STAGE_INPUT"
        : "ABSTAIN_KEEP_STAGE_INPUT",
    classification: wholeConflict
      ? "WHOLE_HYPOTHESIS_UNSUPPORTED_BY_NEW_ASR"
      : "UNKNOWN",
    utteranceStructure: "UNKNOWN",
    lexicalSupport: unchanged
      ? "MACHINE_SUPPORTED"
      : wholeConflict
        ? "MACHINE_CONFLICT"
        : "UNKNOWN",
    wholeWindowObservations: relevant.map((o) => ({
      requestId: o.requestId,
      status: o.status,
      containsCompleteStageInput: lexical(o.text).includes(old),
      notCoreComparison: true,
    })),
    localized,
    evidenceRequests: relevant.map((o) => o.requestId),
    candidateSource: replace ? candidate?.requestId : null,
    reason: replace
      ? "TWO_FAMILY_TWO_WINDOW_COMPLETE_CORE_SUPPORT"
      : unchanged
        ? "KEEP_IS_NOT_AUDIO_CONFIRMATION"
        : "INSUFFICIENT_COMPLETE_CORE_AND_EVENT_EVIDENCE",
    audioConfirmed: false,
    humanValidated: false,
    applied: false,
  };
}
export type AcousticDecision = ReturnType<typeof decideAcoustic>;
export function applyAcousticDecisions(
  inputs: readonly SubtitleCue[],
  preserved: readonly SubtitleCue[],
  decisions: AcousticDecision[],
  apply: boolean,
) {
  for (const d of decisions)
    if (!inputs.some((c) => objectHash(c) === d.bindingHash))
      throw Error("Stale acoustic input binding");
  if (new Set(decisions.map((d) => d.bindingHash)).size !== decisions.length)
    throw Error("Duplicate decision binding");
  return preserved.map((c) => {
    const d = decisions.find((d) => d.before.id === c.id);
    if (!d || !apply || d.action !== "REPLACE_WITH_LOCALIZED_FRESH_CANDIDATE")
      return c;
    if (
      !d.after.text.trim() ||
      d.after.start !== c.start ||
      d.after.end !== c.end
    )
      throw Error("Unsafe acoustic replacement");
    return { ...c, text: d.after.text };
  });
}
export function exportDiff(
  before: readonly SubtitleCue[],
  after: readonly SubtitleCue[],
) {
  for (const cues of [before, after])
    if (
      cues.some((c) => !c.id) ||
      new Set(cues.map((c) => c.id)).size !== cues.length
    )
      throw Error("Export diff requires unique bound cue IDs");
  const b = new Map(before.map((c) => [c.id, c])),
    a = new Map(after.map((c) => [c.id, c]));
  const visible = (c: SubtitleCue) => ({
    text: c.text,
    start: c.start,
    end: c.end,
    style: c.style ?? null,
    speaker: c.speaker,
  });
  return {
    exportAddedCueCount: after.filter((c) => !b.has(c.id)).length,
    exportRemovedCueCount: before.filter((c) => !a.has(c.id)).length,
    exportChangedGroups: after.filter((c) => {
      const old = b.get(c.id);
      return (
        old !== undefined && objectHash(visible(c)) !== objectHash(visible(old))
      );
    }).length,
  };
}
