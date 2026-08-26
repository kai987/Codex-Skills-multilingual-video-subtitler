import { cp, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { InputError, c60FinalizationPolicyModeSchema } from "@mvl/shared";
import {
  finalizeProtectedExistingTask,
  generateC60ProtectedShareableArtifacts,
  locateSubtitlePackage,
  sha256LocalFile,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    output: { type: "string" },
    "c6-finalization-policy": { type: "string" },
    "human-reviewed-subtitle": { type: "string" },
    "source-video": { type: "string" },
    "generated-at": { type: "string" },
    "authority-negative-control": { type: "boolean" },
  },
  strict: true,
});

if (values.task === undefined || values.output === undefined) {
  throw new InputError(
    "Usage: npm run replay:c6-0-protected-finalization -- --task <C5.19 task> --output <new task> [--c6-finalization-policy legacy|protected-observe|protected-enforce] [--human-reviewed-subtitle <ASS>] [--source-video <video>]",
  );
}

const sourceTask = path.resolve(values.task);
const outputTask = path.resolve(values.output);
const mode = c60FinalizationPolicyModeSchema.parse(
  values["c6-finalization-policy"] ?? "legacy",
);
if (
  mode !== "legacy" &&
  (values["source-video"] === undefined ||
    (mode === "protected-enforce" &&
      values["human-reviewed-subtitle"] === undefined &&
      values["authority-negative-control"] !== true))
) {
  if (mode === "protected-enforce") {
    throw new InputError(
      "protected-enforce currently requires a verified human-reviewed baseline and source video. Machine-only zero-touch is not authorized in C6.0; omit --human-reviewed-subtitle only for the explicit authority negative control.",
    );
  }
  throw new InputError("protected-observe requires the source video.");
}
try {
  await stat(outputTask);
  throw new InputError(`Replay output already exists: ${outputTask}`);
} catch (error) {
  if (error instanceof InputError) throw error;
}

const sourceVideoPath =
  values["source-video"] === undefined
    ? null
    : path.resolve(values["source-video"]);
const humanSubtitlePath =
  values["human-reviewed-subtitle"] === undefined
    ? null
    : path.resolve(values["human-reviewed-subtitle"]);
const before = {
  sourceVideo:
    sourceVideoPath === null ? null : await sha256LocalFile(sourceVideoPath),
  humanSubtitle:
    humanSubtitlePath === null
      ? null
      : await sha256LocalFile(humanSubtitlePath),
};

await cp(sourceTask, outputTask, { recursive: true, errorOnExist: true });
let result = null;
let shareable = null;
if (mode !== "legacy") {
  result = await finalizeProtectedExistingTask({
    taskDirectory: outputTask,
    mode,
    ...(values["generated-at"] === undefined
      ? {}
      : { generatedAt: values["generated-at"] }),
    ...(humanSubtitlePath === null
      ? {}
      : { humanReviewedSubtitlePath: humanSubtitlePath }),
    ...(sourceVideoPath === null ? {} : { sourceVideoPath }),
  });
  shareable = await generateC60ProtectedShareableArtifacts({
    taskRoot: outputTask,
    subtitleDirectory: result.subtitleDirectory,
  });
}
const located = await locateSubtitlePackage(outputTask);
const protectedOutcome =
  result === null
    ? null
    : (
        JSON.parse(
          await readFile(
            path.join(
              located.subtitleDirectory,
              "subtitle-finalization-risk-assessment.json",
            ),
            "utf8",
          ),
        ) as { protectedOutcome?: unknown }
      ).protectedOutcome;
const after = {
  sourceVideo:
    sourceVideoPath === null ? null : await sha256LocalFile(sourceVideoPath),
  humanSubtitle:
    humanSubtitlePath === null
      ? null
      : await sha256LocalFile(humanSubtitlePath),
};
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      mode,
      defaultNoFlag: values["c6-finalization-policy"] === undefined,
      sourceTask,
      outputTask,
      subtitleDirectory: located.subtitleDirectory,
      status: result?.report.status ?? "needs-review",
      finalizationMethod: result?.report.finalizationMethod ?? "none",
      protectedOutcome,
      shareableDirectory: shareable?.outputDirectory ?? null,
      sourceVideoReadOnly:
        before.sourceVideo === null
          ? null
          : before.sourceVideo === after.sourceVideo,
      humanSubtitleReadOnly:
        before.humanSubtitle === null
          ? null
          : before.humanSubtitle === after.humanSubtitle,
      modelInferenceCount: 0,
      modelLoadCount: 0,
      networkUsed: false,
    },
    null,
    2,
  )}\n`,
);
