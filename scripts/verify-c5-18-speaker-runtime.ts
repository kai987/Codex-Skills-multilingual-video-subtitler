import path from "node:path";
import { parseArgs } from "node:util";

import { InputError, speakerDeviceSchema } from "@mvl/shared";
import {
  LocalSpeakerWorker,
  loadAndVerifySpeakerRuntime,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    "runtime-manifest": { type: "string" },
    "model-manifest": { type: "string" },
    device: { type: "string", default: "auto" },
    "probe-audio": { type: "string" },
  },
  strict: true,
});

if (values["runtime-manifest"] === undefined) {
  throw new InputError(
    "Usage: npm run verify:c5-18-speaker-runtime -- --runtime-manifest <manifest> [--model-manifest <manifest>] [--probe-audio <wav>]",
  );
}
const runtimeManifestPath = path.resolve(values["runtime-manifest"]);
const modelManifestPath = path.resolve(
  values["model-manifest"] ??
    path.join(path.dirname(runtimeManifestPath), "speaker-model-manifest.json"),
);
const device = speakerDeviceSchema.parse(values.device);
const verified = await loadAndVerifySpeakerRuntime({
  runtimeManifestPath,
  modelManifestPath,
});
let probe: Record<string, unknown> | null = null;
if (values["probe-audio"] !== undefined) {
  const worker = new LocalSpeakerWorker({
    ...verified,
    device,
    workerScriptPath: path.resolve("scripts/runtime/speaker_worker.py"),
  });
  try {
    const ready = await worker.start();
    const inference = await worker.infer({
      audioPath: path.resolve(values["probe-audio"]),
      minSpeakers: 1,
      maxSpeakers: 3,
    });
    probe = {
      deviceRequested: ready.deviceRequested,
      deviceUsed: ready.deviceUsed,
      fallback: ready.fallback,
      mpsAvailable: ready.mpsAvailable,
      allPipelineModulesOnDevice: ready.allPipelineModulesOnDevice,
      standardDiarizationAvailable: true,
      exclusiveDiarizationAvailable: true,
      finiteOutputVerified: [
        ...inference.standardTurns,
        ...inference.exclusiveTurns,
      ].every(
        (turn) =>
          Number.isFinite(turn.start) &&
          Number.isFinite(turn.end) &&
          turn.end > turn.start,
      ),
      confidenceStatus: inference.confidenceStatus,
    };
  } finally {
    await worker.close();
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      runtimeIdentityHash: verified.runtime.runtimeIdentityHash,
      modelSnapshotHash: verified.model.modelSnapshotHash,
      modelRepo: verified.model.modelRepo,
      modelRevision: verified.model.resolvedRevision,
      fileCount: verified.model.modelFiles.length,
      probe,
    },
    null,
    2,
  )}\n`,
);
