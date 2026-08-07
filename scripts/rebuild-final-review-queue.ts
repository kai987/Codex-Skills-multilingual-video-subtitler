import path from "node:path";

import {
  buildFinalReviewQueue,
  canonicalizeAsrSegments,
  canonicalUtterancesToCues,
  evaluateTranscriptionQuality,
  planMissingDialogueRecovery,
  rawEvidenceFromResult,
  type ReviewQueueBuildResult,
} from "@mvl/transcription-core";
import {
  adaptiveRefinementRecordSchema,
  atomicWriteJson,
  canonicalAsrSegmentsArtifactSchema,
  missingDialogueRecoveryArtifactSchema,
  pathExists,
  readJson,
  subtitleCueSchema,
  transcriptionQualitySchema,
} from "@mvl/shared";
import { layoutSubtitleCuesWithDiagnostics } from "@mvl/subtitle-core";
import { z } from "zod";

const timingRepairsSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    repairs: z.array(
      z
        .object({
          cueId: z.string(),
          before: z.object({ start: z.number(), end: z.number() }),
          after: z.object({ start: z.number(), end: z.number() }),
          method: z.string(),
          reasons: z.array(z.string()),
        })
        .loose(),
    ),
  })
  .loose();

const presentationTimingSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    records: z.array(
      z
        .object({
          sourceCueId: z.string(),
          originalInterval: z.object({ start: z.number(), end: z.number() }),
          outputIntervals: z.array(
            z.object({ start: z.number(), end: z.number() }),
          ),
          splitCount: z.number().int().positive(),
          timingMethod: z.string(),
          characterRatioFallback: z.boolean(),
          reasons: z.array(z.string()),
        })
        .loose(),
    ),
  })
  .loose();

const mediaProfileSchema = z
  .object({
    speechIntervals: z.array(
      z.object({ start: z.number(), end: z.number() }).loose(),
    ),
  })
  .loose();

const rawTranscriptionSchema = z
  .object({
    adapter: z.string().optional(),
    chunks: z
      .array(
        z
          .object({
            chunkId: z.string(),
            start: z.number(),
            result: z
              .object({
                text: z.string(),
                segments: z.array(
                  z
                    .object({
                      start: z.number(),
                      end: z.number(),
                      text: z.string(),
                      speaker: z.string().nullable(),
                      confidence: z.number().nullable(),
                      tokens: z
                        .array(
                          z
                            .object({
                              text: z.string(),
                              start: z.number(),
                              end: z.number(),
                              probability: z.number().nullable().optional(),
                            })
                            .loose(),
                        )
                        .optional(),
                      metrics: z
                        .object({
                          averageLogProbability: z
                            .number()
                            .nullable()
                            .optional(),
                          noSpeechProbability: z.number().nullable().optional(),
                          tokenProbability: z.number().nullable().optional(),
                          entropy: z.number().nullable().optional(),
                          decoderFallback: z.boolean().nullable().optional(),
                          detectedLanguage: z
                            .enum([
                              "zh",
                              "zh-Hans",
                              "zh-Hant",
                              "ja",
                              "en",
                              "mixed",
                              "und",
                            ])
                            .nullable()
                            .optional(),
                        })
                        .loose()
                        .optional(),
                    })
                    .loose(),
                ),
                raw: z.unknown(),
              })
              .loose(),
          })
          .loose(),
      )
      .optional(),
    cues: z.array(subtitleCueSchema).optional(),
    baselineCues: z.array(subtitleCueSchema).optional(),
  })
  .loose();

function overlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function focusSummary(input: {
  name: string;
  interval: { start: number; end: number };
  result: ReviewQueueBuildResult;
  finalCues: readonly z.infer<typeof subtitleCueSchema>[];
  oldReviewIntervals: readonly { start: number; end: number }[];
}) {
  const findings = input.result.findings.allFindings.filter((finding) =>
    overlap(finding.interval, input.interval),
  );
  const statusCount = (status: string): number =>
    findings.filter((finding) => finding.status === status).length;
  return {
    name: input.name,
    interval: input.interval,
    originalReviewItemCount: input.oldReviewIntervals.filter((item) =>
      overlap(item, input.interval),
    ).length,
    diagnosticFindingCount: findings.length,
    finalCueCount: input.finalCues.filter((cue) => overlap(cue, input.interval))
      .length,
    repairedFindingCount: statusCount("repaired"),
    supersededFindingCount: statusCount("superseded"),
    resolvedFindingCount: statusCount("resolved"),
    needsHumanReviewFindingCount: statusCount("needs-human-review"),
    finalReviewGroupCount: input.result.queue.groups.filter((group) =>
      overlap(group.interval, input.interval),
    ).length,
  };
}

async function main(): Promise<void> {
  const artifactDirectory = process.argv[2];
  if (artifactDirectory === undefined || artifactDirectory.trim() === "") {
    throw new Error(
      "Usage: npm run rebuild:final-review-queue -- <subtitle-artifact-directory> [output-directory] [--replace-primary]",
    );
  }
  const inputDirectory = path.resolve(artifactDirectory);
  const outputDirectory = path.resolve(process.argv[3] ?? inputDirectory);
  const replacePrimaryArtifacts = process.argv.includes("--replace-primary");
  const recoveryArtifactPath = path.join(
    inputDirectory,
    "missing-dialogue-recovery.json",
  );
  const [
    historicalQualityValue,
    postQualityValue,
    refinementValue,
    timingRepairValue,
    presentationValue,
    mediaProfileValue,
    rawValue,
    recoveryValue,
  ] = await Promise.all([
    readJson(path.join(inputDirectory, "transcription-quality.json")),
    readJson(
      path.join(inputDirectory, "transcription-quality-post-presentation.json"),
    ),
    readJson(path.join(inputDirectory, "transcription-refinement.json")),
    readJson(path.join(inputDirectory, "transcription-timing-repairs.json")),
    readJson(path.join(inputDirectory, "presentation-timing.json")),
    readJson(path.join(inputDirectory, "media-profile.json")),
    readJson(
      path.join(
        path.dirname(inputDirectory),
        "audio",
        "raw-transcription.json",
      ),
    ),
    (await pathExists(recoveryArtifactPath))
      ? readJson(recoveryArtifactPath)
      : Promise.resolve(null),
  ]);
  const historicalQuality = transcriptionQualitySchema.parse(
    historicalQualityValue,
  );
  const postPresentationQuality =
    transcriptionQualitySchema.parse(postQualityValue);
  const refinementRecord =
    adaptiveRefinementRecordSchema.parse(refinementValue);
  const timingRepairs = timingRepairsSchema.parse(timingRepairValue);
  const presentationTiming = presentationTimingSchema.parse(presentationValue);
  const mediaProfile = mediaProfileSchema.parse(mediaProfileValue);
  const raw = rawTranscriptionSchema.parse(rawValue);
  const existingRecovery =
    recoveryValue === null
      ? null
      : missingDialogueRecoveryArtifactSchema.parse(recoveryValue);
  const rawCues = raw.cues ?? raw.baselineCues ?? [];
  const finalCues = layoutSubtitleCuesWithDiagnostics(rawCues).cues;
  const rawSegments = (raw.chunks ?? []).flatMap((chunk) =>
    rawEvidenceFromResult({
      result: chunk.result,
      adapterId: raw.adapter ?? "whisper-cpp",
      chunkId: chunk.chunkId,
      globalStart: chunk.start,
    }),
  );
  const canonicalUtterances = canonicalizeAsrSegments({
    segments: rawSegments,
    speechIntervals: mediaProfile.speechIntervals,
  });
  const canonicalArtifact = canonicalAsrSegmentsArtifactSchema.parse({
    schemaVersion: "1.0.0",
    sourceAdapter:
      canonicalUtterances[0]?.sourceAdapter ??
      (raw.adapter === "openai" ? "openai" : "whisper-server"),
    rawSegmentCount: rawSegments.length,
    canonicalUtteranceCount: canonicalUtterances.length,
    rawSegments,
    utterances: canonicalUtterances,
  });
  const canonicalCues = canonicalUtterancesToCues(canonicalUtterances);
  const rawAdapterCues = raw.baselineCues ?? raw.cues ?? [];
  const rawAdapterQuality = evaluateTranscriptionQuality({
    cues: rawAdapterCues,
    speechIntervals: mediaProfile.speechIntervals,
  });
  const canonicalQuality = evaluateTranscriptionQuality({
    cues: canonicalCues,
    speechIntervals: mediaProfile.speechIntervals,
  });
  const initialResult = buildFinalReviewQueue({
    historicalQuality,
    postPresentationQuality,
    finalCues,
    refinementRecord,
    timingRepairs: timingRepairs.repairs,
    presentationTiming: presentationTiming.records,
    speechIntervals: mediaProfile.speechIntervals,
    reviewGroupGapSeconds: 0.75,
  });
  const plannedRecoveryUnits = planMissingDialogueRecovery({
    reviewQueue: initialResult.queue,
    speechIntervals: mediaProfile.speechIntervals,
    rawSegmentBoundaries: rawSegments.flatMap((segment) => [
      segment.start,
      segment.end,
    ]),
    reliableCues: finalCues,
    mediaDurationSeconds: Math.max(
      0,
      ...mediaProfile.speechIntervals.map((interval) => interval.end),
      ...finalCues.map((cue) => cue.end),
    ),
  });
  const recoveryUnits = existingRecovery?.units ?? plannedRecoveryUnits;
  const result = buildFinalReviewQueue({
    historicalQuality,
    postPresentationQuality,
    finalCues,
    refinementRecord,
    timingRepairs: timingRepairs.repairs,
    presentationTiming: presentationTiming.records,
    speechIntervals: mediaProfile.speechIntervals,
    recoveryUnits,
    reviewGroupGapSeconds: 0.75,
  });
  const statusCount = (status: string): number =>
    result.findings.allFindings.filter((finding) => finding.status === status)
      .length;
  const summary = {
    schemaVersion: "1.0.0",
    inputDirectory,
    oldReviewItemCount: historicalQuality.needsHumanReviewCount,
    diagnosticFindingCount: result.queue.diagnosticFindingCount,
    finalReviewFindingCount: result.queue.humanReviewFindingCount,
    uniqueReviewGroupCount: result.queue.uniqueReviewGroupCount,
    reviewEventCount:
      result.queue.reviewEventCount ?? result.queue.uniqueReviewGroupCount,
    reviewAudioDurationSeconds: result.queue.reviewAudioDurationSeconds ?? 0,
    maximumReviewEventSpanSeconds:
      result.queue.maximumReviewEventSpanSeconds ?? 0,
    maximumPlayableSubIntervalSeconds:
      result.queue.maximumPlayableSubIntervalSeconds ?? 0,
    reviewSummary: result.queue.reviewSummary,
    canonicalSegmentation: {
      sourceAdapter: canonicalArtifact.sourceAdapter,
      rawSegmentCount: canonicalArtifact.rawSegmentCount,
      canonicalUtteranceCount: canonicalArtifact.canonicalUtteranceCount,
      historicalQualitySegmentCount: historicalQuality.segments.length,
      rawAdapterQualitySegmentCount: rawAdapterQuality.segments.length,
      canonicalQualitySegmentCount: canonicalQuality.segments.length,
      historicalQualityFindingCount: historicalQuality.segments.filter(
        (segment) => segment.reasons.length > 0,
      ).length,
      rawAdapterQualityFindingCount: rawAdapterQuality.segments.filter(
        (segment) => segment.reasons.length > 0,
      ).length,
      canonicalQualityFindingCount: canonicalQuality.segments.filter(
        (segment) => segment.reasons.length > 0,
      ).length,
    },
    reviewEvents: {
      continuousHallucinationGroupsMerged:
        result.queue.events
          ?.filter((event) => event.category === "hallucination")
          .reduce(
            (sum, event) => sum + Math.max(0, event.reviewGroupIds.length - 1),
            0,
          ) ?? 0,
    },
    missingDialoguePlan: {
      source:
        existingRecovery === null
          ? "offline-planned"
          : "existing-real-run-recovery",
      inputReviewGroups: result.queue.groups.filter(
        (group) => group.missingDialogue === true,
      ).length,
      recoveryUnits: recoveryUnits.length,
      maximumUnitDurationSeconds: Math.max(
        0,
        ...recoveryUnits.map((unit) => unit.interval.end - unit.interval.start),
      ),
      maximumActualWavSeconds: Math.max(
        0,
        ...recoveryUnits.map(
          (unit) => unit.extractedInterval.end - unit.extractedInterval.start,
        ),
      ),
    },
    lifecycle: {
      repaired: statusCount("repaired"),
      resolved: statusCount("resolved"),
      superseded: statusCount("superseded"),
      informational: statusCount("informational"),
      open: statusCount("open"),
      needsHumanReview: statusCount("needs-human-review"),
    },
    focusRegions: [
      focusSummary({
        name: "04:19–05:28",
        interval: { start: 4 * 60 + 19, end: 5 * 60 + 28 },
        result,
        finalCues,
        oldReviewIntervals: historicalQuality.needsHumanReviewIntervals,
      }),
      focusSummary({
        name: "12:55–13:22",
        interval: { start: 12 * 60 + 55, end: 13 * 60 + 22 },
        result,
        finalCues,
        oldReviewIntervals: historicalQuality.needsHumanReviewIntervals,
      }),
    ],
  };
  await Promise.all([
    atomicWriteJson(
      path.join(outputDirectory, "canonical-asr-segments-rebuilt.json"),
      canonicalArtifact,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(
        outputDirectory,
        "transcription-quality-raw-adapter-rebuilt.json",
      ),
      rawAdapterQuality,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(
        outputDirectory,
        "transcription-quality-canonical-rebuilt.json",
      ),
      canonicalQuality,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(outputDirectory, "missing-dialogue-recovery-plan-rebuilt.json"),
      {
        schemaVersion: "1.0.0",
        maximumActualWavSeconds: 30,
        units: recoveryUnits,
      },
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(outputDirectory, "final-review-queue-rebuilt.json"),
      result.queue,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(outputDirectory, "transcription-timing-findings-rebuilt.json"),
      result.findings,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(outputDirectory, "final-review-queue-rebuild-summary.json"),
      summary,
      { overwrite: true },
    ),
    ...(replacePrimaryArtifacts
      ? [
          atomicWriteJson(
            path.join(outputDirectory, "final-review-queue.json"),
            result.queue,
            { overwrite: true },
          ),
          atomicWriteJson(
            path.join(outputDirectory, "transcription-timing-findings.json"),
            result.findings,
            { overwrite: true },
          ),
        ]
      : []),
  ]);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
