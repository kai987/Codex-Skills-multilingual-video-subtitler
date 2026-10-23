/** Machine-only gates. No reference text, filesystem or provider access. */
import { z } from "zod";
import {
  decimal,
  add,
  clock,
  timingDiagnostics,
  textRisks,
} from "./bounded-diagnostics.mjs";
import { projectRecord } from "./representation-grid.mjs";
import { rawRecords } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import { identity, hash } from "./content-review-plan.mjs";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const authorizationSchema = z
  .object({
    version: z.literal("frozen-local-asr-authorization-v1"),
    recoveryIdentity: sha,
    recoveryFreezeSha256: sha,
    planSha256: sha,
    experimentSha256: sha,
    modelSha256: sha,
    runtimeSha256: sha,
    sourcePcmSha256: sha,
    sourceMediaSha256: sha,
    primaryWindows: z.number().int().positive(),
    primarySamples: z.number().int().positive(),
    sampleRate: z.literal(16000),
    sourceFrames: z.number().int().positive(),
    audioOffset: z.number().nonnegative(),
    baselineCount: z.number().int().positive(),
    maxRequestSeconds: z.number().positive().max(30),
    maxTechnicalRetries: z.literal(1),
  })
  .strict();
const interval = z.number().finite().nonnegative();
export const windowSchema = z
  .object({
    windowId: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
    regionId: z.string(),
    priority: z.enum(["P0", "P1"]),
    referenceIds: z.array(z.string()),
    coreStart: interval,
    coreEnd: interval,
    requestStart: interval,
    requestEnd: interval,
    seconds: z.number().positive(),
    prompt: z.null(),
    referenceTextUsedAsPrompt: z.literal(false),
    executionAuthorized: z.literal(false),
    status: z.literal("scheduled"),
  })
  .strict();
export const localPolicy = Object.freeze({
  version: "frozen-local-asr-insertion-v1",
  maxRequestSeconds: 30,
  maxTechnicalRetries: 1,
  coreOwnership: "exact-containment-no-crop",
  adjacentDuplicate: "immediate-temporal-neighbors-no-intervening-cue",
  collision: "exclude-all-members",
  referenceSelection: "frozen-metadata-only",
  prompt: "",
  tokenProjection: "not-used-with-segment-only-contract",
});
export function sampleAt(t, rate) {
  const r = decimal(t);
  const n = r.n * BigInt(rate);
  if (n % r.d) throw Error("NONINTEGER_SAMPLE");
  return Number(n / r.d);
}
export function bindPlan(bytes, authorization, flag) {
  const a = authorizationSchema.parse(authorization);
  if (flag !== true) throw Error("EXPLICIT_AUTHORIZATION_REQUIRED");
  if (hash(bytes) !== a.planSha256) throw Error("PLAN_HASH_CHANGED");
  const p = JSON.parse(bytes);
  if (
    p.policy !== "reference-guided-missing-localization-v1" ||
    p.plannedOnly !== true ||
    p.LOCAL_ASR_EXECUTED !== false ||
    p.selectionUsesA !== false ||
    p.deferred.length
  )
    throw Error("PLAN_CONTRACT");
  const windows = p.scheduled.map((w) => windowSchema.parse(w));
  if (
    windows.length !== a.primaryWindows ||
    new Set(windows.map((w) => w.windowId)).size !== windows.length
  )
    throw Error("WINDOW_SET");
  let samples = 0;
  for (const w of windows) {
    if (!(
      w.requestStart <= w.coreStart &&
      w.coreStart < w.coreEnd &&
      w.coreEnd <= w.requestEnd
    ))
      throw Error("CORE_BOUNDS");
    const s =
        sampleAt(w.requestStart, a.sampleRate) -
        sampleAt(a.audioOffset, a.sampleRate),
      e =
        sampleAt(w.requestEnd, a.sampleRate) -
        sampleAt(a.audioOffset, a.sampleRate);
    if (
      s < 0 ||
      e > a.sourceFrames ||
      e <= s ||
      e - s > a.sampleRate * a.maxRequestSeconds ||
      sampleAt(w.seconds, a.sampleRate) !== e - s
    )
      throw Error("REQUEST_BOUND");
    samples += e - s;
  }
  if (
    samples !== a.primarySamples ||
    p.plannedWindows !== windows.length ||
    sampleAt(p.plannedSeconds, a.sampleRate) !== samples
  )
    throw Error("PLAN_BUDGET");
  return {
    windows,
    primarySamples: samples,
    primarySeconds: samples / a.sampleRate,
    maxSamples: Math.max(
      ...windows.map((w) => sampleAt(w.seconds, a.sampleRate)),
    ),
  };
}
const overlap = (a, b) =>
  Math.min(a.sourceEnd, b.sourceEnd) > Math.max(a.sourceStart, b.sourceStart);
const norm = (s) => (s ?? "").replace(/\r\n?/gu, "\n");
export function localRecords(bytes, w, m, provenance) {
  return rawRecords(
    bytes.toString("utf8"),
    identity({ windowId: w.windowId, rawHash: hash(bytes) }),
  ).map((r) => {
    const s = clock(r.rawStart),
      e = clock(r.rawEnd),
      number = (q) => Number(q.n) / Number(q.d);
    const record = {
      ...r,
      recordId: "local-recovery-" + r.recordId.slice(4),
      windowId: w.windowId,
      chunkId: w.windowId,
      chunkIndex: 0,
      requestId: provenance.requestId,
      source: "bounded-local-asr-recovery",
      sourceStart: s ? number(add(decimal(w.requestStart), s)) : null,
      sourceEnd: e ? number(add(decimal(w.requestStart), e)) : null,
      provenance,
    };
    const chunk = {
      id: w.windowId,
      inputStart:
        sampleAt(w.requestStart, m.pcm.sampleRate) -
        sampleAt(m.audioOffset, m.pcm.sampleRate),
      inputEnd:
        sampleAt(w.requestEnd, m.pcm.sampleRate) -
        sampleAt(m.audioOffset, m.pcm.sampleRate),
    };
    const timing = timingDiagnostics(record, chunk, m),
      projection = projectRecord(record, chunk, m),
      risk = textRisks(record, timing);
    const ownership =
      timing.rawIssues.length || timing.mappedIssues.length
        ? "INVALID_TIMING"
        : record.sourceStart >= w.coreStart && record.sourceEnd <= w.coreEnd
          ? "CORE_OWNED_EXACT"
          : Math.min(record.sourceEnd, w.coreEnd) >
              Math.max(record.sourceStart, w.coreStart)
            ? "CROSSES_CORE_BOUNDARY"
            : "CONTEXT_ONLY";
    return { record, timing, projection, risk, ownership };
  });
}
export function integrateRecords(baseline, locals) {
  const decisions = locals.map((x) => {
    const reasons = [];
    if (x.ownership === "INVALID_TIMING")
      reasons.push("BLOCKED_INVALID_TIMING");
    else if (x.ownership === "CONTEXT_ONLY")
      reasons.push("EVIDENCE_ONLY_CONTEXT");
    else if (x.ownership === "CROSSES_CORE_BOUNDARY")
      reasons.push("EVIDENCE_ONLY_CORE_BOUNDARY");
    if (
      x.risk.warnings.some((r) =>
        ["LONG_SAME_CODEPOINT_RUN", "SHORT_PATTERN_REPETITION"].includes(r),
      )
    )
      reasons.push("BLOCKED_REPETITION_RISK");
    if (x.projection.status === "UNRECOVERED")
      reasons.push("BLOCKED_SERIALIZATION");
    const projected = x.projection.recoveredSerialized
      ? {
          ...x.record,
          sourceStart: x.projection.recoveredSerialized.start.seconds,
          sourceEnd: x.projection.recoveredSerialized.end.seconds,
        }
      : null;
    const conflicts = baseline
      .filter(
        (b) =>
          overlap(x.record, b) ||
          (projected && overlap(projected, b)) ||
          x.record.sourceStart === b.sourceStart ||
          projected?.sourceStart === b.sourceStart,
      )
      .map((b) => b.recordId);
    if (conflicts.length) reasons.push("CONFLICT_WITH_EXISTING_B");
    return {
      decisionId: identity({ policy: localPolicy, record: x.record }),
      localRecordId: x.record.recordId,
      reasons,
      conflicts,
      projected,
      status: null,
    };
  });
  const eligible = decisions.filter((d) => !d.reasons.length);
  for (let i = 0; i < eligible.length; i++)
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i],
        b = eligible[j];
      const ar = locals.find(
          (x) => x.record.recordId === a.localRecordId,
        ).record,
        br = locals.find((x) => x.record.recordId === b.localRecordId).record;
      if (
        overlap(a.projected, b.projected) ||
        overlap(ar, br) ||
        a.projected.sourceStart === b.projected.sourceStart
      ) {
        for (const d of [a, b])
          if (!d.reasons.includes("LOCAL_CANDIDATE_COLLISION"))
            d.reasons.push("LOCAL_CANDIDATE_COLLISION");
      }
    }
  const neighbors = [...baseline, ...eligible.map((d) => d.projected)].sort(
    (a, b) =>
      a.sourceStart - b.sourceStart || a.recordId.localeCompare(b.recordId),
  );
  for (const d of eligible) {
    const i = neighbors.findIndex((r) => r.recordId === d.localRecordId);
    if (
      [neighbors[i - 1], neighbors[i + 1]].some(
        (n) => n && norm(n.text) === norm(d.projected.text),
      )
    )
      d.reasons.push("POTENTIAL_DUPLICATE_INSERTION");
  }
  for (const d of decisions) d.status = d.reasons[0] ?? "INSERTED_SAFE_GAP";
  const inserted = decisions
    .filter((d) => !d.reasons.length)
    .map((d) => ({ ...d.projected, integrationDecisionId: d.decisionId }));
  // Stable sort preserves the frozen baseline's order even for pre-existing ties.
  const records = [...baseline, ...inserted].sort(
    (a, b) => a.sourceStart - b.sourceStart,
  );
  if (
    JSON.stringify(
      records.filter((r) => baseline.some((b) => b.recordId === r.recordId)),
    ) !== JSON.stringify(baseline)
  )
    throw Error("BASELINE_MUTATED_OR_REORDERED");
  for (const a of inserted)
    for (const b of records)
      if (a !== b && overlap(a, b)) throw Error("INSERTION_OVERLAP");
  return {
    policy: localPolicy,
    decisions,
    inserted,
    records,
    existingTextMutations: 0,
    existingTimingMutations: 0,
  };
}
