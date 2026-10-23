/** Pure, bounded local checks. No media I/O, reference input, or subtitle edits. */
import { createHash } from "node:crypto";

export const localAcousticPolicy = Object.freeze({
  version: "local-acoustic-checks-v1",
  sampleRate: 16000,
  maximumTargets: 3,
  maximumRequests: 6,
  maximumRequestSeconds: 30,
  maximumTotalSeconds: 120,
  retries: 0,
  boundaryToleranceSeconds: 0.12,
  subtitleMutationAuthorized: false,
});

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const identifier = (s) =>
  typeof s === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(s);
const targetText = (text) =>
  text.normalize("NFC").replace(/[\p{P}\p{Z}\s]/gu, "");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function planLocalChecks(targets) {
  if (
    !Array.isArray(targets) ||
    targets.length < 1 ||
    targets.length > localAcousticPolicy.maximumTargets
  )
    throw Error("LOCAL_TARGET_BUDGET");
  const ids = new Set();
  const recordIds = new Set();
  const frozenTargets = [];
  const requests = [];
  for (const target of targets) {
    if (
      !target ||
      !identifier(target.id) ||
      ids.has(target.id) ||
      !["timing", "seam"].includes(target.kind) ||
      !finite(target.sourceEnd) ||
      target.sourceEnd <= 0 ||
      !Number.isSafeInteger(Math.floor(target.sourceEnd * 16000)) ||
      !Array.isArray(target.records) ||
      target.records.length !== (target.kind === "timing" ? 1 : 2)
    )
      throw Error("INVALID_LOCAL_TARGET");
    ids.add(target.id);
    const records = target.records.map((r) => {
      if (
        !r ||
        !identifier(r.recordId) ||
        recordIds.has(r.recordId) ||
        !finite(r.sourceStart) ||
        !finite(r.sourceEnd) ||
        r.sourceStart < 0 ||
        r.sourceEnd <= r.sourceStart ||
        r.sourceEnd > target.sourceEnd ||
        typeof r.text !== "string" ||
        !r.text.trim()
      )
        throw Error("INVALID_LOCAL_RECORD");
      recordIds.add(r.recordId);
      return {
        recordId: r.recordId,
        sourceStart: r.sourceStart,
        sourceEnd: r.sourceEnd,
        text: r.text,
      };
    });
    const start = Math.min(...records.map((r) => r.sourceStart));
    const end = Math.max(...records.map((r) => r.sourceEnd));
    const pads = target.kind === "timing" ? [0.5, 1] : [5, 6];
    const text = target.kind === "timing" ? targetText(records[0].text) : null;
    if (target.kind === "timing" && !text) throw Error("EMPTY_CTC_TARGET");
    frozenTargets.push({
      id: target.id,
      kind: target.kind,
      records,
      sourceEnd: target.sourceEnd,
    });
    const pair = pads.map((pad, i) => {
      // Expand to integer PCM frames, then map to source time exactly once.
      const first = Math.max(0, Math.floor((start - pad) * 16000));
      const last = Math.min(
        Math.floor(target.sourceEnd * 16000),
        Math.ceil((end + pad) * 16000),
      );
      const frames = last - first;
      if (
        !Number.isSafeInteger(frames) ||
        frames <= 0 ||
        frames > localAcousticPolicy.maximumRequestSeconds * 16000
      )
        throw Error("LOCAL_REQUEST_AUDIO_BUDGET");
      return {
        id: `${target.id}-${i === 0 ? "narrow" : "wide"}`,
        targetId: target.id,
        kind: target.kind,
        backend: target.kind === "timing" ? "ctc" : "whisper",
        start: first / 16000,
        end: last / 16000,
        frames,
        ...(text !== null ? { targetText: text } : {}),
      };
    });
    if (pair[0].start === pair[1].start && pair[0].end === pair[1].end)
      throw Error("IDENTICAL_LOCAL_WINDOWS");
    requests.push(...pair);
  }
  const totalFrames = requests.reduce((sum, r) => sum + r.frames, 0);
  if (
    requests.length > localAcousticPolicy.maximumRequests ||
    totalFrames > localAcousticPolicy.maximumTotalSeconds * 16000
  )
    throw Error("LOCAL_TOTAL_AUDIO_BUDGET");
  return {
    policy: { ...localAcousticPolicy },
    targets: frozenTargets,
    requests,
    totalFrames,
    totalSeconds: totalFrames / 16000,
    referenceUsed: false,
  };
}

function validRequest(r) {
  return (
    r &&
    identifier(r.targetId) &&
    ["narrow", "wide"].some((view) => r.id === `${r.targetId}-${view}`) &&
    r.kind === "timing" &&
    r.backend === "ctc" &&
    finite(r.start) &&
    finite(r.end) &&
    r.start >= 0 &&
    r.end > r.start &&
    Number.isSafeInteger(r.frames) &&
    r.frames > 0 &&
    r.frames <= localAcousticPolicy.maximumRequestSeconds * 16000 &&
    Math.abs((r.end - r.start) * 16000 - r.frames) < 0.000001 &&
    typeof r.targetText === "string" &&
    r.targetText !== "" &&
    targetText(r.targetText) === r.targetText
  );
}

/** Results are raw CTC worker rows with their frozen planned `request` attached. */
export function summarizeTimingPair(results) {
  const blockers = new Set();
  let narrow = null,
    wide = null;
  if (!Array.isArray(results) || results.length !== 2)
    blockers.add("TWO_CTC_RESULTS_REQUIRED");
  else {
    for (const r of results) {
      const q = r?.request;
      if (!validRequest(q) || r.requestId !== q.id) {
        blockers.add("CTC_REQUEST_BINDING_INVALID");
        continue;
      }
      if (q.id.endsWith("-narrow")) narrow = r;
      else wide = r;
      if (
        r.pathStatus !== "success" ||
        r.frameCountVerified !== true ||
        r.workerRequestVerified !== true ||
        !Number.isSafeInteger(r.predictedFrameCount) ||
        r.predictedFrameCount <= 0 ||
        r.expectedFrameCount !== r.predictedFrameCount
      )
        blockers.add("CTC_PATH_OR_FRAME_VERIFICATION_FAILED");
      const t = r.target;
      const complete =
        t?.targetText === q.targetText &&
        t?.targetTextSha256 === sha256(q.targetText) &&
        t?.targetEncodable === true &&
        t?.unknownTokenCount === 0 &&
        t?.specialTokenCount === 0 &&
        Array.isArray(t?.blockers) &&
        t.blockers.length === 0 &&
        Array.isArray(t?.tokenPieces) &&
        t.tokenPieces.every((p) => typeof p === "string" && p !== "") &&
        t.tokenPieces.join("") === q.targetText &&
        Array.isArray(t.tokenIds) &&
        t.tokenIds.length === t.tokenPieces.length &&
        t.tokenIds.every((id) => Number.isSafeInteger(id) && id >= 0) &&
        Array.isArray(r.tokenSpans) &&
        r.tokenSpans.length === t.tokenIds.length &&
        r.tokenSpans.every(
          (span, i) =>
            span !== null &&
            typeof span === "object" &&
            span.targetIndex === i &&
            span.tokenId === t.tokenIds[i] &&
            Number.isSafeInteger(span.startFrame) &&
            Number.isSafeInteger(span.endFrameExclusive) &&
            span.startFrame >= 0 &&
            span.endFrameExclusive > span.startFrame &&
            span.endFrameExclusive <= r.predictedFrameCount &&
            (i === 0 ||
              span.startFrame >= r.tokenSpans[i - 1].endFrameExclusive),
        );
      if (!complete) blockers.add("CTC_TARGET_NOT_FULLY_BOUND");
      const b = r.selectedBoundary;
      if (
        !finite(b?.start) ||
        !finite(b?.end) ||
        b.start < q.start ||
        b.end > q.end ||
        b.end <= b.start ||
        b.start !== r.tokenSpans?.[0]?.startMediaGlobal ||
        b.end !== r.tokenSpans?.at(-1)?.endMediaGlobal
      )
        blockers.add("CTC_BOUNDARY_INVALID");
      if (
        r.startPinnedToWindowEdge !== false ||
        r.endPinnedToWindowEdge !== false ||
        b?.start === q.start ||
        b?.end === q.end
      )
        blockers.add("CTC_BOUNDARY_PINNED_OR_UNKNOWN");
      if (!Array.isArray(r.blockers) || r.blockers.length)
        blockers.add("CTC_WORKER_BLOCKER");
    }
    if (
      !narrow ||
      !wide ||
      narrow.request.targetId !== wide.request.targetId ||
      narrow.request.targetText !== wide.request.targetText ||
      narrow.request.start < wide.request.start ||
      narrow.request.end > wide.request.end ||
      narrow.request.frames >= wide.request.frames
    )
      blockers.add("CTC_WINDOW_PAIR_INVALID");
  }
  const validDualAlignment = blockers.size === 0;
  const delta = validDualAlignment
    ? {
        start: Math.abs(
          narrow.selectedBoundary.start - wide.selectedBoundary.start,
        ),
        end: Math.abs(narrow.selectedBoundary.end - wide.selectedBoundary.end),
      }
    : null;
  const stable =
    delta !== null &&
    delta.start <= localAcousticPolicy.boundaryToleranceSeconds + 1e-9 &&
    delta.end <= localAcousticPolicy.boundaryToleranceSeconds + 1e-9;
  if (validDualAlignment && !stable) blockers.add("CTC_WINDOWS_DISAGREE");
  return {
    version: "local-acoustic-timing-summary-v1",
    status: stable ? "SUPPORTED_CONDITIONAL_TIMING" : "ABSTAIN",
    validDualAlignment,
    stableWithin120ms: stable,
    boundaryDeltaSeconds: delta,
    boundaryCandidate: stable ? { ...narrow.selectedBoundary } : null,
    selectedRequestId: stable ? narrow.requestId : null,
    selectionRule:
      "narrow-window-observed-boundary; never-average-or-character-retime",
    blockers: [...blockers].sort(),
    independentLexicalVerification: false,
    subtitleMutationAuthorized: false,
    reason:
      "Same-family CTC checks are conditional on supplied machine text, not independent lexical verification or permission to edit subtitles.",
  };
}
