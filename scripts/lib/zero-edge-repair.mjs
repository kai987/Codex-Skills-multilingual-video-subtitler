/** Explicit offline revision only. Never infer speech or trim internal pauses. */
import { pcmEvidence } from "./recovery-evidence-guard.mjs";

export const ZERO_EDGE_POLICY = Object.freeze({
  version: "signal-preserving-zero-edge-v1",
  minimumZeroSeconds: 2,
  displayPaddingSeconds: 0.15,
  minimumDisplaySeconds: 0.5,
  newInference: 0,
  textMutationAllowed: false,
  acousticTimingVerified: false,
});

export function repairZeroEdges(records, pcm, sourceOffset = 0) {
  if (!Number.isFinite(sourceOffset)) throw Error("INVALID_SOURCE_OFFSET");
  const ids = new Set();
  for (const r of records) {
    if (!r.recordId || ids.has(r.recordId))
      throw Error("INVALID_RECORD_IDENTITY");
    ids.add(r.recordId);
  }
  const decisions = [];
  const result = records.map((r) => {
    const start = Math.round((r.sourceStart - sourceOffset) * pcm.sampleRate);
    const end = Math.round((r.sourceEnd - sourceOffset) * pcm.sampleRate);
    if (
      !Number.isFinite(r.sourceStart) ||
      !Number.isFinite(r.sourceEnd) ||
      r.sourceEnd <= r.sourceStart
    )
      throw Error("INVALID_RECORD_TIME");
    const evidence = pcmEvidence(pcm, start, end);
    if (evidence.allSamplesExactlyZero) {
      decisions.push({
        recordId: r.recordId,
        status: "held-all-zero",
        evidence,
      });
      return r; // No signal does not authorize removing the original text.
    }
    const lead = (evidence.firstNonzeroFrame - start) / pcm.sampleRate;
    const tail = (end - evidence.lastNonzeroFrame - 1) / pcm.sampleRate;
    let sourceStart = r.sourceStart,
      sourceEnd = r.sourceEnd;
    if (lead >= ZERO_EDGE_POLICY.minimumZeroSeconds)
      sourceStart = Math.max(
        sourceStart,
        Math.floor(
          (sourceOffset +
            evidence.firstNonzeroFrame / pcm.sampleRate -
            ZERO_EDGE_POLICY.displayPaddingSeconds) *
            100,
        ) / 100,
      );
    if (tail >= ZERO_EDGE_POLICY.minimumZeroSeconds)
      sourceEnd = Math.min(
        sourceEnd,
        Math.ceil(
          (sourceOffset +
            (evidence.lastNonzeroFrame + 1) / pcm.sampleRate +
            ZERO_EDGE_POLICY.displayPaddingSeconds) *
            100,
        ) / 100,
      );
    if (sourceStart === r.sourceStart && sourceEnd === r.sourceEnd) return r;
    if (sourceEnd - sourceStart < ZERO_EDGE_POLICY.minimumDisplaySeconds) {
      decisions.push({
        recordId: r.recordId,
        status: "held-too-short",
        evidence,
      });
      return r;
    }
    // Do not introduce a new ordering inversion with a neighboring cue.
    if (
      records.some(
        (n) =>
          n.recordId !== r.recordId &&
          n.sourceStart >= r.sourceStart &&
          n.sourceStart < sourceStart,
      )
    ) {
      decisions.push({
        recordId: r.recordId,
        status: "held-neighbor-order",
        evidence,
      });
      return r;
    }
    const removed = [];
    if (sourceStart > r.sourceStart)
      removed.push(
        pcmEvidence(
          pcm,
          start,
          Math.round((sourceStart - sourceOffset) * pcm.sampleRate),
        ),
      );
    if (sourceEnd < r.sourceEnd)
      removed.push(
        pcmEvidence(
          pcm,
          Math.round((sourceEnd - sourceOffset) * pcm.sampleRate),
          end,
        ),
      );
    if (!removed.every((e) => e.allSamplesExactlyZero))
      throw Error("NONZERO_SAMPLE_REMOVAL");
    const after = { ...r, sourceStart, sourceEnd };
    decisions.push({
      recordId: r.recordId,
      status: "applied-zero-edge-only",
      before: r,
      after,
      evidence,
      removed,
    });
    return after;
  });
  return {
    policy: ZERO_EDGE_POLICY,
    records: result,
    decisions,
    qualityStatus: "needs-review",
    humanValidated: false,
    finalizationMethod: "none",
  };
}
