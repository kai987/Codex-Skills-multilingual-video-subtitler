import path from "node:path";
import { firstGoldRead142Schema } from "@mvl/shared";
import { durableJson141 } from "../../packages/video-subtitler/src/review/c601141-io.js";
import { hashed141 } from "../../packages/video-subtitler/src/review/c601141-policy.js";

/** Must be awaited before even hashing Gold. Exclusive fsync'd receipt also
 * prevents a failed evaluator from silently reopening/reselecting machine work. */
export async function persistFirstRead142(input: {
  directory: string;
  finalAFreezeHash: string;
  finalBFreezeHash: string;
  finalACompletedAt: string;
  finalBCompletedAt: string;
  codeSnapshotHash: string;
  codeValidationHash: string;
  browserAuditHash: string;
}) {
  const firstGoldReadAt = new Date().toISOString();
  if (
    [input.finalACompletedAt, input.finalBCompletedAt].some(
      (t) =>
        !Number.isFinite(Date.parse(t)) ||
        Date.parse(t) >= Date.parse(firstGoldReadAt),
    )
  )
    throw new Error("C601142_FREEZE_NOT_BEFORE_GOLD");
  const receipt = firstGoldRead142Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-2-durable-first-gold-read-intent",
      visibility: "LOCAL_ONLY",
      firstGoldReadAt,
      finalAFreezeHash: input.finalAFreezeHash,
      finalBFreezeHash: input.finalBFreezeHash,
      codeSnapshotHash: input.codeSnapshotHash,
      codeValidationHash: input.codeValidationHash,
      browserAuditHash: input.browserAuditHash,
      writtenAndFsyncedBeforeGoldOpen: true,
      evaluatorOnly: true,
      runtimeGoldInputCount: 0,
    }),
  );
  await durableJson141(
    path.join(input.directory, "c6-0-1-14-2-first-gold-read-intent.json"),
    receipt,
  );
  return receipt;
}
