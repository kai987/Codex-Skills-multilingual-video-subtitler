import {
  c601141ShareableSchema,
  c601141ShareableAuditSchema,
} from "@mvl/shared";
import { bytesHash141 } from "../../packages/video-subtitler/src/review/c601141-io.js";

/** This is an allowlisted aggregate export, not a claim that local WAVs, model
 * outputs or Gold-linked diagnostics are suitable for public distribution. */
export function auditShareable141(value: unknown) {
  let absolutePathLeakCount = 0,
    secretPatternCount = 0,
    rawDialogueOrAudioFieldCount = 0,
    sourceOrGoldIntervalFieldCount = 0;
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      if (
        /(?:^|\s)(?:\/(?:Users|home|private|var|tmp|Volumes)\/|[A-Za-z]:\\)/u.test(
          node,
        )
      )
        absolutePathLeakCount++;
      if (/(?:hf_|sk-|ghp_|github_pat_)[a-zA-Z0-9_-]{16,}/u.test(node))
        secretPatternCount++;
    } else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object")
      for (const [key, child] of Object.entries(node)) {
        if (
          /^(?:text|rawText|goldText|machineText|candidateText|excerpt|audioPath|rawAudio|pcm|waveform|dataUrl|errorComponentIds)$/iu.test(
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
  const strictSchemaPassed = c601141ShareableSchema.safeParse(value).success;
  return c601141ShareableAuditSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-1-shareable-audit",
    summaryByteHash: bytesHash141(
      Buffer.from(JSON.stringify(value, null, 2) + "\n"),
    ),
    strictSchemaPassed,
    absolutePathLeakCount,
    secretPatternCount,
    rawDialogueOrAudioFieldCount,
    sourceOrGoldIntervalFieldCount,
    // The strict aggregate has no filesystem reference fields at all.
    brokenRelativeReferenceCount: 0,
    passed:
      strictSchemaPassed &&
      absolutePathLeakCount === 0 &&
      secretPatternCount === 0 &&
      rawDialogueOrAudioFieldCount === 0 &&
      sourceOrGoldIntervalFieldCount === 0,
  });
}
