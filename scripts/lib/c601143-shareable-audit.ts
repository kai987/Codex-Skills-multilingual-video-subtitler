import { shareable143Schema, shareableAudit143Schema } from "@mvl/shared";
import { bytesHash141 } from "../../packages/video-subtitler/src/review/c601141-io.js";

/** Enforce that only aggregate counts, hashes and fixed decisions cross the
 * shareable boundary. Native timing, dialogue, audio and local paths stay in
 * LOCAL_ONLY artifacts. */
export function auditShareable143(value: unknown) {
  let absolutePathLeakCount = 0;
  let secretPatternCount = 0;
  let rawDialogueOrAudioFieldCount = 0;
  let sourceOrGoldIntervalFieldCount = 0;
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      if (
        /(?:^|\s)(?:\/(?:Users|home|private|var|tmp|Volumes)\/|[A-Za-z]:\\|file:\/\/)/u.test(
          node,
        )
      )
        absolutePathLeakCount++;
      if (/(?:hf_|sk-|ghp_|github_pat_)[a-zA-Z0-9_-]{16,}/u.test(node))
        secretPatternCount++;
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (
        /^(?:text|rawText|goldText|machineText|candidateText|excerpt|audioPath|rawAudio|pcm|waveform|dataUrl|errorComponentIds|scores|posteriors|rawScores|nativeScoreTrack)$/iu.test(
          key,
        )
      )
        rawDialogueOrAudioFieldCount++;
      if (
        /^(?:sourceInterval|nativeInterval|goldInterval|errorIntervals|startSample|endSample|sourceStart|sourceEnd)$/iu.test(
          key,
        )
      )
        sourceOrGoldIntervalFieldCount++;
      walk(child);
    }
  };
  walk(value);
  const strictSchemaPassed = shareable143Schema.safeParse(value).success;
  return shareableAudit143Schema.parse({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-3-shareable-audit",
    summaryByteHash: bytesHash141(
      Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
    ),
    strictSchemaPassed,
    absolutePathLeakCount,
    secretPatternCount,
    rawDialogueOrAudioFieldCount,
    sourceOrGoldIntervalFieldCount,
    brokenRelativeReferenceCount: 0,
    passed:
      strictSchemaPassed &&
      absolutePathLeakCount === 0 &&
      secretPatternCount === 0 &&
      rawDialogueOrAudioFieldCount === 0 &&
      sourceOrGoldIntervalFieldCount === 0,
  });
}
