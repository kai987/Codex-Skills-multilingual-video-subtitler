import { cp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { atomicWriteJson, ConsoleLogger, InputError } from "@mvl/shared";
import {
  finalizeSubtitleTask,
  locateSubtitlePackage,
  sha256LocalFile,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    "human-reviewed-subtitle": { type: "string" },
    "source-video": { type: "string" },
    output: { type: "string" },
    "presentation-resolution": { type: "string", default: "enforce" },
    "overlap-resolution": { type: "string", default: "conservative" },
    "no-review-audio": { type: "boolean", default: false },
  },
  strict: true,
});

if (
  values.task === undefined ||
  values["human-reviewed-subtitle"] === undefined
) {
  throw new InputError(
    "Usage: npm run replay:c5-14-presentation -- --task <C5.13R.3 task> --human-reviewed-subtitle <reviewed.ass> [--source-video <video>] [--output <new task>]",
  );
}
if (
  !(["off", "observe", "enforce"] as const).includes(
    values["presentation-resolution"] as "off" | "observe" | "enforce",
  )
) {
  throw new InputError("Invalid --presentation-resolution value.");
}
if (
  !(["conservative", "balanced"] as const).includes(
    values["overlap-resolution"] as "conservative" | "balanced",
  )
) {
  throw new InputError("Invalid --overlap-resolution value.");
}

const sourceTask = path.resolve(values.task);
const humanReviewedSubtitle = path.resolve(values["human-reviewed-subtitle"]);

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function collisionSafeTarget(): Promise<string> {
  if (values.output !== undefined) {
    const explicit = path.resolve(values.output);
    if (await exists(explicit)) {
      throw new InputError(
        `Replay output already exists and will not be overwritten: ${explicit}`,
      );
    }
    return explicit;
  }
  const sourceName = path.basename(sourceTask);
  const preferredName = sourceName.includes("c5-13r-3-human-reviewed-baseline")
    ? sourceName.replace(
        "c5-13r-3-human-reviewed-baseline",
        "c5-14-presentation-safe-auto-resolution",
      )
    : `${sourceName}-c5-14-presentation-safe-auto-resolution`;
  const parent = path.dirname(sourceTask);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const target = path.join(
      parent,
      suffix === 0
        ? preferredName
        : `${preferredName}-${String(suffix).padStart(2, "0")}`,
    );
    if (!(await exists(target))) return target;
  }
  throw new InputError(
    "Unable to allocate a collision-safe C5.14 output path.",
  );
}

async function optionalJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

const beforeHuman = {
  sha256: await sha256LocalFile(humanReviewedSubtitle),
  stat: await stat(humanReviewedSubtitle),
};
const sourceVideo =
  values["source-video"] === undefined
    ? null
    : path.resolve(values["source-video"]);
const beforeVideo =
  sourceVideo === null
    ? null
    : {
        sha256: await sha256LocalFile(sourceVideo),
        stat: await stat(sourceVideo),
      };
const beforeLocated = await locateSubtitlePackage(sourceTask);
const beforeReport = await optionalJson(
  path.join(
    beforeLocated.subtitleDirectory,
    "subtitle-finalization-report.json",
  ),
);
const outputTask = await collisionSafeTarget();
await cp(sourceTask, outputTask, {
  recursive: true,
  errorOnExist: true,
  force: false,
  preserveTimestamps: true,
});

// The source task can contain a historical review queue and its audio clips.
// They are derived artifacts, so remove them only from the collision-safe copy
// before finalization; otherwise stale C5.13R.3 clips would coexist with the
// seven (or fewer) C5.14 unresolved groups and make the output misleading.
const copiedTask = await locateSubtitlePackage(outputTask);
await Promise.all(
  [
    path.join(copiedTask.subtitleDirectory, "audio", "review"),
    path.join(copiedTask.subtitleDirectory, "review"),
    path.join(copiedTask.subtitleDirectory, "subtitle-review-package.json"),
    path.join(
      copiedTask.subtitleDirectory,
      "human-review-resolutions.template.json",
    ),
  ].map(async (derivedPath) => {
    await rm(derivedPath, { recursive: true, force: true });
  }),
);

const result = await finalizeSubtitleTask({
  taskDirectory: outputTask,
  mode: "review-fallback",
  humanReviewedSubtitlePath: humanReviewedSubtitle,
  ...(sourceVideo === null ? {} : { sourceVideoPath: sourceVideo }),
  prepareReview: true,
  generateReviewAudio: !values["no-review-audio"],
  presentationResolution: values["presentation-resolution"] as
    "off" | "observe" | "enforce",
  overlapResolution: values["overlap-resolution"] as
    "conservative" | "balanced",
  logger: new ConsoleLogger(false, "info"),
});

const afterHumanStat = await stat(humanReviewedSubtitle);
const afterHumanSha256 = await sha256LocalFile(humanReviewedSubtitle);
const afterVideo =
  sourceVideo === null
    ? null
    : {
        sha256: await sha256LocalFile(sourceVideo),
        stat: await stat(sourceVideo),
      };
const inputReport =
  typeof beforeReport === "object" && beforeReport !== null
    ? (beforeReport as { metrics?: unknown; status?: unknown })
    : null;
const replaySummaryPath = path.join(outputTask, "c5-14-replay-summary.json");
await atomicWriteJson(
  replaySummaryPath,
  {
    schemaVersion: "1.0.0",
    runType: "C5.14 offline presentation replay",
    generatedAt: new Date().toISOString(),
    inputTaskName: path.basename(sourceTask),
    outputTaskName: path.basename(outputTask),
    humanReviewedSubtitle: {
      fileName: path.basename(humanReviewedSubtitle),
      beforeSha256: beforeHuman.sha256,
      afterSha256: afterHumanSha256,
      beforeSize: beforeHuman.stat.size,
      afterSize: afterHumanStat.size,
      readOnlyVerified:
        beforeHuman.sha256 === afterHumanSha256 &&
        beforeHuman.stat.size === afterHumanStat.size &&
        beforeHuman.stat.mtimeMs === afterHumanStat.mtimeMs,
    },
    sourceVideo:
      sourceVideo === null || beforeVideo === null || afterVideo === null
        ? null
        : {
            fileName: path.basename(sourceVideo),
            beforeSha256: beforeVideo.sha256,
            afterSha256: afterVideo.sha256,
            beforeSize: beforeVideo.stat.size,
            afterSize: afterVideo.stat.size,
            beforeMtimeMs: beforeVideo.stat.mtimeMs,
            afterMtimeMs: afterVideo.stat.mtimeMs,
            readOnlyVerified:
              beforeVideo.sha256 === afterVideo.sha256 &&
              beforeVideo.stat.size === afterVideo.stat.size &&
              beforeVideo.stat.mtimeMs === afterVideo.stat.mtimeMs,
          },
    before: {
      status: inputReport?.status ?? null,
      metrics: inputReport?.metrics ?? null,
    },
    after: {
      status: result.report.status,
      finalizationMethod: result.report.finalizationMethod,
      metrics: result.report.metrics,
      qualityGate: result.report.qualityGate,
      presentationSummary:
        (await optionalJson(result.outputPaths.presentationResolution)) ?? null,
    },
    execution: {
      asrExecuted: false,
      networkAccessed: false,
      modelOrApiCalled: false,
      machineCandidatesImported: result.report.decisions.some(
        (decision) => decision.selectedCandidateId !== null,
      ),
    },
    outputPaths: {
      subtitleDirectory:
        path.relative(outputTask, result.subtitleDirectory) || ".",
      report: path.relative(outputTask, result.outputPaths.report),
      presentationResolution: path.relative(
        outputTask,
        result.outputPaths.presentationResolution,
      ),
      subtitlePackage: path.relative(
        outputTask,
        result.outputPaths.subtitlePackage,
      ),
      reviewPackage:
        result.outputPaths.reviewPackage === null
          ? null
          : path.relative(outputTask, result.outputPaths.reviewPackage),
    },
  },
  { overwrite: false },
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      outputTask,
      replaySummaryPath,
      status: result.report.status,
      finalizationMethod: result.report.finalizationMethod,
      metrics: result.report.metrics,
      presentationResolution: result.outputPaths.presentationResolution,
    },
    null,
    2,
  )}\n`,
);
