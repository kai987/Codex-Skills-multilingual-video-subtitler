import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  configSchema,
  manifestSchema,
  atomic,
  fileHash,
} from "../../packages/video-subtitler/src/standalone/tool.js";
import { digest } from "../../packages/video-subtitler/src/standalone/assembly.js";
export const mixed =
  "7\n00:00:00,000 --> 00:00:01,000\n同じ言葉。\n\n7\n00:00:01,000 --> 00:00:01,000\n同じ言葉。\n\n99\n00:00:03,000 --> 00:00:04,000\n次の行。\n続き。\n";
export async function recoveryFixture(raw = mixed, offset = 2) {
  const task = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "offline-recovery-test-")),
  );
  await writeFile(path.join(task, "raw-primary.srt"), raw);
  const config = configSchema.parse({
    model: "/unavailable/model",
    runtime: "/unavailable/runtime",
  });
  const m = manifestSchema.parse({
    version: "subtitle-tool-v1",
    taskId: path.basename(task),
    createdAt: "synthetic",
    updatedAt: "synthetic",
    input: "/unavailable/source",
    inputHash: digest("input"),
    config,
    configHash: digest(config),
    modelHash: digest("model"),
    runtimeHash: digest("runtime"),
    ffmpegHash: digest("ffmpeg"),
    ffprobeHash: digest("ffprobe"),
    track: 0,
    duration: 10,
    origin: 900,
    audioOffset: offset,
    executionStatus: "failed",
    phase: "timing",
    artifactIntegrity: "failed",
    qualityStatus: "needs-review",
    contentQuality: "NOT_MEASURED",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
    audioHash: digest("saved-audio-identity"),
    rawHash: await fileHash(path.join(task, "raw-primary.srt")),
    evidenceHash: null,
    warnings: [],
    attempts: [
      {
        id: "primary-1",
        startedAt: "synthetic",
        endedAt: "synthetic",
        reservedAudioSeconds: 8,
        state: "completed",
        error: null,
      },
    ],
    budgetSeconds: 20,
    cacheHits: 0,
    modelLoads: null,
    outputs: {},
    ownedFiles: ["task.json", "raw-primary.srt"],
    error: "old failure",
  });
  await atomic(path.join(task, "task.json"), m);
  return { task, m };
}
