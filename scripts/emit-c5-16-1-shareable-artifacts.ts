import path from "node:path";
import { parseArgs } from "node:util";

import { InputError } from "@mvl/shared";
import {
  auditC5161ShareableArtifacts,
  generateC5161ShareableArtifacts,
  locateSubtitlePackage,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    "stock-patched-ab": { type: "string" },
    "source-video": { type: "string" },
    "human-reviewed-subtitle": { type: "string" },
    model: { type: "string" },
    "vad-model": { type: "string" },
    "whisper-server": { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

if (
  values.task === undefined ||
  values["stock-patched-ab"] === undefined ||
  values["source-video"] === undefined ||
  values["human-reviewed-subtitle"] === undefined
) {
  throw new InputError(
    "Usage: npm run emit:c5-16-1-shareable-artifacts -- --task <task> --stock-patched-ab <A/B.json> --source-video <video> --human-reviewed-subtitle <ASS> [--model <large-v3> --vad-model <silero> --whisper-server <server> --output <shareable-directory>]",
  );
}

const taskRoot = path.resolve(values.task);
const located = await locateSubtitlePackage(taskRoot);
const summaryPath = path.join(
  taskRoot,
  "c5-16-1-runtime-stabilization-replay-summary.json",
);
const optionalExternalFiles = [
  values.model === undefined
    ? null
    : { role: "whisper-model", filePath: path.resolve(values.model) },
  values["vad-model"] === undefined
    ? null
    : { role: "vad-model", filePath: path.resolve(values["vad-model"]) },
  values["whisper-server"] === undefined
    ? null
    : {
        role: "whisper-server",
        filePath: path.resolve(values["whisper-server"]),
      },
].filter((item): item is { role: string; filePath: string } => item !== null);

const generated = await generateC5161ShareableArtifacts({
  taskRoot,
  subtitleDirectory: located.subtitleDirectory,
  localExecutionSummaryPath: summaryPath,
  stockPatchedRuntimeAbPath: path.resolve(values["stock-patched-ab"]),
  ...(values.output === undefined
    ? {}
    : { outputDirectory: path.resolve(values.output) }),
  externalFiles: [
    { role: "source-video", filePath: path.resolve(values["source-video"]) },
    {
      role: "human-reviewed-subtitle",
      filePath: path.resolve(values["human-reviewed-subtitle"]),
    },
    ...optionalExternalFiles,
  ],
});
const audit = await auditC5161ShareableArtifacts(generated.outputDirectory);
if (!audit.validationPassed) {
  throw new InputError("Generated shareable artifacts failed their audit.", {
    absolutePathLeakCount: audit.absolutePathLeakCount,
    prohibitedSecretCount: audit.prohibitedSecretCount,
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      taskRoot,
      shareableDirectory: generated.outputDirectory,
      manifestPath: generated.manifestPath,
      artifactCount: generated.manifest.summary.artifactCount,
      validationPassedCount: generated.manifest.summary.validationPassedCount,
      absolutePathLeakCount: audit.absolutePathLeakCount,
      prohibitedSecretCount: audit.prohibitedSecretCount,
    },
    null,
    2,
  ),
);
