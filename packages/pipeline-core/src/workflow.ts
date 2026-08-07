import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { generateGrammarReport } from "@mvl/grammar-report-core";
import {
  AppError,
  assertRegularFile,
  atomicWriteJson,
  defaultTaskDirectory,
  grammarReportSchema,
  pathExists,
  readJson,
  subtitlePackageSchema,
  toAppError,
} from "@mvl/shared";
import { buildLearningSite } from "@mvl/site-builder-core";
import {
  runVideoSubtitler,
  subtitleArtifactDirectory,
} from "@mvl/video-subtitler";
import { z } from "zod";

import type {
  PipelineDependencies,
  PipelineManifest,
  PipelineOptions,
  PipelineResult,
  PipelineStageName,
  PipelineStageState,
} from "./types.js";

const stageStateSchema = z
  .object({
    status: z.enum(["pending", "running", "completed", "failed"]),
    attempts: z.number().int().nonnegative(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    outputs: z.array(z.string().min(1)),
    error: z
      .object({ code: z.string().min(1), message: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict();

const pipelineManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    taskId: z.string().min(1),
    sourcePath: z.string().min(1),
    outputDirectory: z.string().min(1),
    status: z.enum(["running", "completed", "failed"]),
    startedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    stages: z
      .object({
        subtitle: stageStateSchema,
        "grammar-report": stageStateSchema,
        "learning-site": stageStateSchema,
      })
      .strict(),
    continuation: z
      .object({ command: z.literal("npm"), args: z.array(z.string()) })
      .strict()
      .nullable(),
  })
  .strict();

function pendingStage(): PipelineStageState {
  return {
    status: "pending",
    attempts: 0,
    startedAt: null,
    completedAt: null,
    outputs: [],
    error: null,
  };
}

async function validateStage(
  stage: PipelineStageName,
  outputDirectory: string,
  inputPath: string,
): Promise<boolean> {
  try {
    if (stage === "subtitle") {
      const value = subtitlePackageSchema.parse(
        await readJson(
          path.join(
            subtitleArtifactDirectory(outputDirectory, inputPath),
            "subtitle-package.json",
          ),
        ),
      );
      return value.status === "ready" && value.cues.length > 0;
    }
    if (stage === "grammar-report") {
      grammarReportSchema.parse(
        await readJson(
          path.join(outputDirectory, "analysis/grammar-report.json"),
        ),
      );
      return true;
    }
    await Promise.all([
      assertRegularFile(path.join(outputDirectory, "site/index.html")),
      assertRegularFile(
        path.join(outputDirectory, "site/data/grammar-report.json"),
      ),
      assertRegularFile(
        path.join(outputDirectory, "site/data/build-manifest.json"),
      ),
    ]);
    grammarReportSchema.parse(
      await readJson(
        path.join(outputDirectory, "site/data/grammar-report.json"),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

function continuation(
  inputPath: string,
  outputDirectory: string,
  options: PipelineOptions,
): PipelineManifest["continuation"] {
  return {
    command: "npm",
    args: [
      "run",
      "pipeline",
      "--",
      "--input",
      inputPath,
      "--output",
      outputDirectory,
      "--analysis-provider",
      options.analyzer.provider,
      "--explanation-language",
      options.explanationLanguage ?? "zh-CN",
      ...(options.copyVideoToSite === true ? ["--copy-video"] : []),
    ],
  };
}

export async function runPipeline(
  options: PipelineOptions,
  dependencies: PipelineDependencies,
): Promise<PipelineResult> {
  const now = options.now ?? (() => new Date());
  const inputPath = path.resolve(options.inputVideo);
  await assertRegularFile(inputPath);
  const outputDirectory = path.resolve(
    options.outputDirectory ?? defaultTaskDirectory(inputPath, now()),
  );
  const manifestPath = path.join(outputDirectory, "pipeline-manifest.json");
  const existing = await pathExists(manifestPath);
  let manifest: PipelineManifest;
  if (existing) {
    manifest = pipelineManifestSchema.parse(await readJson(manifestPath));
    if (path.resolve(manifest.sourcePath) !== inputPath) {
      throw new AppError(
        "Existing pipeline manifest belongs to a different source video.",
        {
          code: "INVALID_INPUT",
          exitCode: 2,
          details: { manifestSourcePath: manifest.sourcePath, inputPath },
        },
      );
    }
    manifest.status = "running";
    manifest.continuation = null;
  } else {
    manifest = {
      schemaVersion: "1.0.0",
      taskId: randomUUID(),
      sourcePath: inputPath,
      outputDirectory,
      status: "running",
      startedAt: now().toISOString(),
      updatedAt: now().toISOString(),
      stages: {
        subtitle: pendingStage(),
        "grammar-report": pendingStage(),
        "learning-site": pendingStage(),
      },
      continuation: null,
    };
  }
  await mkdir(outputDirectory, { recursive: true });
  const persist = async (): Promise<void> => {
    manifest.updatedAt = now().toISOString();
    await atomicWriteJson(manifestPath, manifest, {
      overwrite: await pathExists(manifestPath),
    });
  };
  await persist();
  const skippedStages: PipelineStageName[] = [];
  const resumedStages: PipelineStageName[] = [];
  const stageOrder: PipelineStageName[] = [
    "subtitle",
    "grammar-report",
    "learning-site",
  ];
  for (const stageName of stageOrder) {
    const stage = manifest.stages[stageName];
    if (
      stage.status === "completed" &&
      (await validateStage(stageName, outputDirectory, inputPath))
    ) {
      skippedStages.push(stageName);
      continue;
    }
    if (existing || stage.attempts > 0) resumedStages.push(stageName);
    stage.status = "running";
    stage.attempts += 1;
    stage.startedAt = now().toISOString();
    stage.completedAt = null;
    stage.error = null;
    await persist();
    try {
      if (stageName === "subtitle") {
        const result = await runVideoSubtitler(
          {
            inputVideo: inputPath,
            outputDirectory,
            ...(options.subtitle ?? {}),
            transcribeWhenNeeded: true,
            overwrite: existing || stage.attempts > 1,
          },
          {
            runner: dependencies.runner,
            logger: dependencies.logger,
            subtitleSearchAdapters: dependencies.subtitleSearchAdapters ?? [],
            ...(dependencies.transcriptionAdapter === undefined
              ? {}
              : {
                  transcriptionAdapter: dependencies.transcriptionAdapter,
                }),
            now,
          },
        );
        if (result.subtitlePackage?.status !== "ready") {
          throw new AppError(
            "Subtitle stage did not produce a ready subtitle package.",
            {
              code: "USER_ACTION_REQUIRED",
              exitCode: 2,
              details: {
                status: result.subtitlePackage?.status ?? null,
                mediaIdentity:
                  "Confirm title/season/episode options or configure transcription.",
              },
            },
          );
        }
        const subtitleDirectory = subtitleArtifactDirectory(
          outputDirectory,
          inputPath,
        );
        stage.outputs = [
          path.relative(
            outputDirectory,
            path.join(subtitleDirectory, "subtitle-package.json"),
          ),
          path.relative(
            outputDirectory,
            path.join(subtitleDirectory, "processing-manifest.json"),
          ),
        ];
      } else if (stageName === "grammar-report") {
        await generateGrammarReport({
          inputPath: path.join(
            subtitleArtifactDirectory(outputDirectory, inputPath),
            "subtitle-package.json",
          ),
          outputDirectory: path.join(outputDirectory, "analysis"),
          analyzer: options.analyzer,
          logger: dependencies.logger,
          explanationLanguage: options.explanationLanguage ?? "zh-CN",
          batchSize: options.grammarBatchSize ?? 8,
          maxRetries: options.grammarMaxRetries ?? 2,
          overwrite: existing || stage.attempts > 1,
          now,
        });
        stage.outputs = [
          "analysis/grammar-report.json",
          "analysis/grammar-report.md",
          "analysis/analysis-manifest.json",
        ];
      } else {
        await buildLearningSite({
          inputReport: path.join(
            outputDirectory,
            "analysis/grammar-report.json",
          ),
          outputDirectory,
          overwrite: existing || stage.attempts > 1,
          ...(options.copyVideoToSite === true
            ? { copyVideoPath: inputPath }
            : {}),
          now,
        });
        stage.outputs = [
          "site/index.html",
          "site/data/grammar-report.json",
          "site/data/build-manifest.json",
        ];
      }
      if (!(await validateStage(stageName, outputDirectory, inputPath))) {
        throw new AppError(
          `Stage ${stageName} produced artifacts that failed validation.`,
          { code: "INVALID_OUTPUT" },
        );
      }
      stage.status = "completed";
      stage.completedAt = now().toISOString();
      await persist();
    } catch (error) {
      const appError = toAppError(error);
      stage.status = "failed";
      stage.error = { code: appError.code, message: appError.message };
      manifest.status = "failed";
      manifest.continuation = continuation(inputPath, outputDirectory, options);
      await persist();
      throw new AppError(
        `Pipeline stopped at ${stageName}: ${appError.message}`,
        {
          code: appError.code,
          exitCode: appError.exitCode,
          details: {
            ...appError.details,
            completedStages: stageOrder.filter(
              (name) => manifest.stages[name].status === "completed",
            ),
            continuation: manifest.continuation,
          },
          cause: appError,
        },
      );
    }
  }
  manifest.status = "completed";
  manifest.continuation = null;
  await persist();
  return {
    outputDirectory,
    manifest,
    subtitlePackagePath: path.join(
      subtitleArtifactDirectory(outputDirectory, inputPath),
      "subtitle-package.json",
    ),
    grammarReportPath: path.join(
      outputDirectory,
      "analysis/grammar-report.json",
    ),
    siteDirectory: path.join(outputDirectory, "site"),
    resumedStages,
    skippedStages,
  };
}
