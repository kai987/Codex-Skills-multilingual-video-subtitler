/** Explicit offline repair proposal, never a default deletion or speech-boundary rule. */
import { pcmEvidence } from "./recovery-evidence-guard.mjs";
const norm = (s) => s.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const occurrences = (s, t) => s.split(t).length - 1;
const valid = (r) =>
  r &&
  typeof r.text === "string" &&
  Number.isFinite(r.sourceStart) &&
  Number.isFinite(r.sourceEnd) &&
  r.sourceEnd > r.sourceStart;

export function proposeZeroGapBridge({
  left,
  bridge,
  right,
  leftSupport,
  rightSupport,
  pcm,
  sourceOffset = 0,
}) {
  const hold = (reason) => ({ status: "HOLD", reason, records: [] });
  if (
    !Number.isFinite(sourceOffset) ||
    ![left, bridge, right, leftSupport, rightSupport].every(valid)
  )
    return hold("INVALID_INPUT");
  if (
    new Set([left.recordId, bridge.recordId, right.recordId]).size !== 3 ||
    ![left, bridge, right].every((r) => r.recordId)
  )
    return hold("INVALID_IDENTITY");
  if (!(
    left.sourceStart < bridge.sourceStart &&
    bridge.sourceStart < left.sourceEnd &&
    left.sourceEnd < right.sourceStart &&
    right.sourceStart < bridge.sourceEnd &&
    bridge.sourceEnd <= right.sourceEnd
  ))
    return hold("NOT_OVERLAPPING_BRIDGE");
  const l = norm(left.text),
    b = norm(bridge.text),
    r = norm(right.text);
  const splits = [];
  for (let i = 3; i <= b.length - 3; i++) {
    const suffix = b.slice(0, i),
      prefix = b.slice(i);
    if (
      l.endsWith(suffix) &&
      r.startsWith(prefix) &&
      occurrences(l, suffix) === 1 &&
      occurrences(r, prefix) === 1
    )
      splits.push({ suffix, prefix });
  }
  if (splits.length !== 1) return hold("NO_UNIQUE_TEXT_OWNERS");
  for (const [record, support] of [
    [left, leftSupport],
    [right, rightSupport],
  ]) {
    const n = norm(record.text),
      s = norm(support.text);
    if (!n || occurrences(s, n) !== 1) return hold("CONTEXT_TEXT_NOT_UNIQUE");
    const covered = Math.max(
      0,
      Math.min(record.sourceEnd, support.sourceEnd) -
        Math.max(record.sourceStart, support.sourceStart),
    );
    if (covered / (record.sourceEnd - record.sourceStart) < 0.8)
      return hold("CONTEXT_NOT_SOURCE_BOUND");
  }
  const frame = (s) => Math.round((s - sourceOffset) * pcm.sampleRate);
  const evidence = pcmEvidence(
    pcm,
    frame(bridge.sourceStart),
    frame(bridge.sourceEnd),
  );
  const gaps = evidence.longZeroRuns.filter(
    ([a, b]) => a >= frame(left.sourceEnd) && b <= frame(right.sourceStart),
  );
  if (gaps.length !== 1) return hold("NO_SINGLE_EXACT_ZERO_SEPARATOR");
  const [a, z] = gaps[0];
  const leftEnd = Math.max(
    left.sourceEnd,
    Math.ceil((sourceOffset + a / pcm.sampleRate + 0.15) * 100) / 100,
  );
  const rightStart = Math.min(
    right.sourceStart,
    Math.floor((sourceOffset + z / pcm.sampleRate - 0.15) * 100) / 100,
  );
  if (leftEnd >= rightStart) return hold("NO_DISPLAY_GAP");
  const removed = pcmEvidence(pcm, frame(leftEnd), frame(rightStart));
  if (!removed.allSamplesExactlyZero) return hold("NONZERO_REMOVAL");
  return {
    status: "CANDIDATE",
    reason: "DUPLICATED_BRIDGE_PARTS_REASSIGNED_TO_SUPPORTED_NEIGHBORS",
    records: [
      { ...left, sourceEnd: leftEnd },
      { ...right, sourceStart: rightStart },
    ],
    replaceIds: [left.recordId, bridge.recordId, right.recordId],
    textOwners: splits[0],
    evidence,
    removed,
    acousticTimingVerified: false,
    humanValidated: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    timingPolicy:
      "extend-existing-display-to-cover-all-nonzero-samples-with-150ms-padding-not-speech-alignment",
  };
}
