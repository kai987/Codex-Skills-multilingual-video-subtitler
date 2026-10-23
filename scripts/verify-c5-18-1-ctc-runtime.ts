import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { InputError, atomicWriteJson, ctcDeviceSchema } from "@mvl/shared";
import {
  LocalCtcWorker,
  buildCtcRuntimeCapability,
  inspectReviewWav,
  loadAndVerifyCtcRuntime,
  normalizeCtcAlignmentText,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    "runtime-manifest": { type: "string" },
    "model-manifest": { type: "string" },
    "probe-audio": { type: "string" },
    "target-text": { type: "string", default: "あきまへんって。" },
    "media-start": { type: "string", default: "0" },
    device: { type: "string", default: "auto" },
    output: { type: "string" },
  },
  strict: true,
});
if (
  values["runtime-manifest"] === undefined ||
  values["model-manifest"] === undefined ||
  values["probe-audio"] === undefined
) {
  throw new InputError(
    "Usage: npm run verify:c5-18-1-ctc-runtime -- --runtime-manifest <json> --model-manifest <json> --probe-audio <component-3-review.wav> [--target-text <alignment-text>]",
  );
}
const requested = ctcDeviceSchema.parse(values.device);
const runtimeManifestPath = path.resolve(values["runtime-manifest"]);
const modelManifestPath = path.resolve(values["model-manifest"]);
const audioPath = path.resolve(values["probe-audio"]);
const outputPath = path.resolve(
  values.output ??
    path.join(path.dirname(runtimeManifestPath), "ctc-runtime-capability.json"),
);
const mediaStart = Number(values["media-start"]);
if (!Number.isFinite(mediaStart) || mediaStart < 0) {
  throw new InputError("--media-start must be a non-negative number.");
}
const verified = await loadAndVerifyCtcRuntime({
  runtimeManifestPath,
  modelManifestPath,
});
const audio = await readFile(audioPath);
const metadata = inspectReviewWav(audio);
const audioSha256 = createHash("sha256").update(audio).digest("hex");
const targetText = normalizeCtcAlignmentText(values["target-text"]).text;

async function probe(device: "auto" | "mps" | "cpu", label: string) {
  const worker = new LocalCtcWorker({
    ...verified,
    device,
    workerScriptPath: path.resolve("scripts/runtime/ctc_worker.py"),
  });
  try {
    const ready = await worker.start();
    const attempt = await worker.align({
      attemptId: `ctc-runtime-probe-${label}`,
      cueId: "human-reviewed-0097-9457e119f3a1",
      componentId: "overlap-acoustic-de9815d25ae4c3a8e718",
      windowType: "expanded",
      audioPath,
      audioSha256,
      audioLocalInterval: { start: 0, end: metadata.actualDurationSeconds },
      mediaGlobalInterval: {
        start: mediaStart,
        end: mediaStart + metadata.actualDurationSeconds,
      },
      targetText,
    });
    return { ready, attempt };
  } finally {
    await worker.close();
  }
}

const primary = await probe(requested, "primary");
const cpu =
  primary.ready.deviceUsed === "cpu" && requested !== "mps"
    ? primary
    : await probe("cpu", "cpu");
const mps = primary.ready.deviceUsed === "mps" ? primary : null;
const cpuPassed =
  cpu.attempt.pathStatus === "success" &&
  cpu.attempt.target.targetEncodable &&
  cpu.attempt.frameCountVerified;
const mpsPassed =
  mps === null
    ? null
    : mps.attempt.pathStatus === "success" &&
      mps.attempt.target.targetEncodable &&
      mps.attempt.frameCountVerified;
const tokenPathParity =
  mps === null
    ? null
    : JSON.stringify(cpu.attempt.target.tokenIds) ===
        JSON.stringify(mps.attempt.target.tokenIds) &&
      cpu.attempt.pathStatus === mps.attempt.pathStatus;
const boundaryDelta =
  cpu.attempt.selectedBoundary === null ||
  mps?.attempt.selectedBoundary === null ||
  mps === null
    ? null
    : Math.max(
        Math.abs(
          cpu.attempt.selectedBoundary.start -
            mps.attempt.selectedBoundary.start,
        ),
        Math.abs(
          cpu.attempt.selectedBoundary.end - mps.attempt.selectedBoundary.end,
        ),
      );
const parityPassed =
  mps === null ||
  (mpsPassed === true &&
    tokenPathParity === true &&
    boundaryDelta !== null &&
    boundaryDelta <= 0.04 + 1e-9);
if (!cpuPassed) {
  throw new InputError("C5.18.1 CPU CTC probe failed closed.");
}
if (requested === "mps" && !parityPassed) {
  throw new InputError(
    "Explicit MPS CTC probe failed CPU parity or the 40 ms boundary tolerance.",
  );
}
const effectiveReady =
  requested === "auto" && !parityPassed
    ? {
        ...cpu.ready,
        deviceRequested: "auto" as const,
        fallback: {
          applied: true,
          from: "mps" as const,
          to: "cpu" as const,
          reason: "CPU_MPS_BOUNDARY_PARITY_FAILED",
        },
      }
    : primary.ready;
const effectiveProbe =
  requested === "auto" && !parityPassed ? cpu.attempt : primary.attempt;
const capability = buildCtcRuntimeCapability({
  ...verified,
  ready: effectiveReady,
  probe: effectiveProbe,
  cpuProbePassed: cpuPassed,
  mpsProbePassed: mpsPassed,
  cpuMpsTokenPathParity: tokenPathParity,
  cpuMpsMaximumBoundaryDeltaSeconds: boundaryDelta,
});
await atomicWriteJson(outputPath, capability, { overwrite: true });
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      capability: outputPath,
      runtimeIdentityHash: capability.runtimeIdentityHash,
      modelSnapshotHash: capability.modelSnapshotHash,
      deviceRequested: capability.deviceRequested,
      deviceUsed: capability.deviceUsed,
      fallback: capability.fallback,
      cpuProbePassed: capability.cpuProbePassed,
      mpsProbePassed: capability.mpsProbePassed,
      cpuMpsTokenPathParity: capability.cpuMpsTokenPathParity,
      cpuMpsMaximumBoundaryDeltaSeconds:
        capability.cpuMpsMaximumBoundaryDeltaSeconds,
      targetEncodable: capability.targetEncodable,
      frameCountVerified: capability.frameCountVerified,
      torchaudioForcedAlignUsed: capability.torchaudioForcedAlignUsed,
    },
    null,
    2,
  )}\n`,
);
