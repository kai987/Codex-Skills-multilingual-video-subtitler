import { stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { InputError } from "@mvl/shared";
import {
  generateC5161ShareableArtifacts,
  locateSubtitlePackage,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    "stock-patched-ab": { type: "string" },
    "source-video": { type: "string" },
    "human-reviewed-subtitle": { type: "string" },
    "mfa-runtime-manifest": { type: "string" },
    "mfa-acoustic-model": { type: "string" },
    "mfa-dictionary-model": { type: "string" },
    "mfa-g2p-model": { type: "string" },
    "mfa-sample-probe": { type: "string" },
    "runtime-preparation-summary": { type: "string" },
    "fresh-cache-observe-validation": { type: "string" },
  },
  strict: true,
});

if (
  values.task === undefined ||
  values["stock-patched-ab"] === undefined ||
  values["source-video"] === undefined ||
  values["human-reviewed-subtitle"] === undefined ||
  values["mfa-runtime-manifest"] === undefined ||
  values["mfa-acoustic-model"] === undefined ||
  values["mfa-dictionary-model"] === undefined ||
  values["mfa-g2p-model"] === undefined ||
  values["mfa-sample-probe"] === undefined ||
  values["runtime-preparation-summary"] === undefined
) {
  throw new InputError(
    "Usage: npm run emit:c5-17-1-shareable-artifacts -- --task <task> --stock-patched-ab <json> --source-video <video> --human-reviewed-subtitle <ass> --mfa-runtime-manifest <json> --mfa-acoustic-model <zip> --mfa-dictionary-model <dict> --mfa-g2p-model <zip> --mfa-sample-probe <json> --runtime-preparation-summary <json> [--fresh-cache-observe-validation <json>]",
  );
}

const taskRoot = path.resolve(values.task);
const located = await locateSubtitlePackage(taskRoot);
const externalFileInputs: [string, string][] = [
  ["source-video", values["source-video"]],
  ["human-reviewed-subtitle", values["human-reviewed-subtitle"]],
  ["mfa-runtime-capability-manifest", values["mfa-runtime-manifest"]],
  ["mfa-acoustic-model", values["mfa-acoustic-model"]],
  ["mfa-dictionary-model", values["mfa-dictionary-model"]],
  ["mfa-g2p-model", values["mfa-g2p-model"]],
];
const externalFiles = await Promise.all(
  externalFileInputs.map(async ([role, file]) => {
    const filePath = path.resolve(file);
    if (!(await stat(filePath)).isFile()) {
      throw new InputError(`External C5.17.1 input is not a file: ${filePath}`);
    }
    return { role, filePath };
  }),
);
const generated = await generateC5161ShareableArtifacts({
  taskRoot,
  subtitleDirectory: located.subtitleDirectory,
  localExecutionSummaryPath: path.join(
    taskRoot,
    "c5-17-forced-alignment-replay-summary.json",
  ),
  stockPatchedRuntimeAbPath: path.resolve(values["stock-patched-ab"]),
  outputDirectory: path.join(taskRoot, "shareable"),
  externalFiles,
  c517Artifacts: {
    runtimeCapabilityPath: path.join(
      located.subtitleDirectory,
      "forced-alignment-runtime-capability.json",
    ),
    canonicalInputPath: path.join(
      located.subtitleDirectory,
      "subtitle-canonical-alignment-input.json",
    ),
    forcedAlignmentPath: path.join(
      located.subtitleDirectory,
      "subtitle-canonical-forced-alignment.json",
    ),
    replaySummaryPath: path.join(
      taskRoot,
      "c5-17-forced-alignment-replay-summary.json",
    ),
    pronunciationPath: path.join(
      located.subtitleDirectory,
      "subtitle-canonical-pronunciation.json",
    ),
    sudachiRuntimeCapabilityPath: path.join(
      located.subtitleDirectory,
      "sudachi-runtime-capability.json",
    ),
    cacheManifestPath: path.join(
      located.subtitleDirectory,
      "forced-alignment-cache-manifest.json",
    ),
    sampleProbePath: path.resolve(values["mfa-sample-probe"]),
    runtimePreparationSummaryPath: path.resolve(
      values["runtime-preparation-summary"],
    ),
    ...(values["fresh-cache-observe-validation"] === undefined
      ? {}
      : {
          freshCacheObserveValidationPath: path.resolve(
            values["fresh-cache-observe-validation"],
          ),
        }),
  },
});
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      taskRoot,
      manifestPath: generated.manifestPath,
      artifactCount: generated.manifest.summary.artifactCount,
    },
    null,
    2,
  )}\n`,
);
