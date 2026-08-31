import path from "node:path";
import { firstGoldRead143Schema, type MachineFreeze143 } from "@mvl/shared";
import { durableJson141 } from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
export async function persistFirstRead143(input: {
  directory: string;
  a: MachineFreeze143;
  b: MachineFreeze143;
  codeSnapshotHash: string;
  codeValidationHash: string;
  browserAuditHash: string;
  parityHash: string;
}) {
  const firstGoldReadAt = new Date().toISOString(),
    completed = required141(
      [input.a.freezeCompletedAt, input.b.freezeCompletedAt].sort().at(-1),
    );
  if (Date.parse(completed) >= Date.parse(firstGoldReadAt))
    throw new Error("C601143_FREEZE_NOT_BEFORE_GOLD");
  const receipt = firstGoldRead143Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-3-durable-first-gold-read-intent",
      visibility: "LOCAL_ONLY",
      firstGoldReadAt,
      machineFreezeCompletedAt: completed,
      freezeBeforeGold: true,
      finalAFreezeHash: input.a.semanticHash,
      finalBFreezeHash: input.b.semanticHash,
      codeSnapshotHash: input.codeSnapshotHash,
      codeValidationHash: input.codeValidationHash,
      browserAuditHash: input.browserAuditHash,
      parityHash: input.parityHash,
      writtenAndFsyncedBeforeGoldOpen: true,
      evaluatorOnly: true,
      runtimeGoldInputCount: 0,
    }),
  );
  await durableJson141(
    path.join(input.directory, "c6-0-1-14-3-first-gold-read-intent.json"),
    receipt,
  );
  return receipt;
}
