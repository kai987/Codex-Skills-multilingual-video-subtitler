import { z } from "zod";
import {
  hash142Schema as h,
  id142Schema as id,
  count142Schema as n,
  header142Shape,
  policy142Schema,
} from "./c6-0-1-14-2-selection-detector-schemas.js";
import {
  acousticFeatures142Schema,
  detectorRuntime142Schema,
  detectorRun142Schema,
  scoreTrack142Schema,
  viewRole142Schema,
} from "./c6-0-1-14-2-acoustic-schemas.js";
import { asrRequest142Schema } from "./c6-0-1-14-2-review-schemas.js";
import {
  c601141MachineFreezeSchema,
  c601141SweepsSchema,
  c601141AsrProbesSchema,
  c601141InventorySchema,
  c601141SafetySchema,
  c601141UncoveredSchema,
  c601141IntervalSchema,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
import { c60114ProbeRawResultSchema } from "./c6-0-1-14-probe-schemas.js";
const identity = c601141MachineFreezeSchema.shape.sourceReadOnlyIdentity;
const nativeMetadata = z
  .object({ file: id, size: n, mtimeMs: z.number().nonnegative(), inode: n })
  .strict();
export const baselineReplay142Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-2-baseline-replay"),
    visibility: z.literal("LOCAL_ONLY"),
    baselineCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceIdentity: header142Shape.sourceIdentity,
    sourceReadOnlyIdentity: identity,
    previousFinalAHash: h,
    previousFinalBHash: h,
    canonicalTextHash: h,
    canonicalTimingHash: h,
    presentationHash: h,
    machineCueCount: n,
    detector: c601141SweepsSchema.shape.accounting,
    asr: c601141AsrProbesSchema.shape.accounting,
    viewCount: n,
    uniquePcmViewCount: n,
    inventory: c601141InventorySchema.shape.summary,
    safety: c601141SafetySchema.shape.summary,
    uncovered: c601141UncoveredSchema.shape.summary,
    targetCount: n,
    itemCount: n,
    requiredItemCount: n,
    regionCount: n,
    physicalWavCount: n,
    playableWavCount: n,
    playbackSegmentCount: n,
    fullQueueSeconds: z.number().nonnegative(),
    baseline14FullQueueSeconds: z.number().nonnegative(),
    priorOutputMetadata: z.array(nativeMetadata),
    runtimeGoldInputCount: z.literal(0),
    baselineGoldMetricsDeferredUntilPostFreezeEvaluator: z.literal(true),
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    semanticHash: h,
  })
  .strict();
export const dispatch142Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("machine-c601142-dispatch-ticket"),
    requestId: id,
    kind: z.enum(["DETECTOR", "ASR"]),
    family: z.enum([
      "WEBRTC",
      "SILERO",
      "PYANNOTE",
      "whisper-large-v3",
      "reazonspeech-k2-v2",
    ]),
    planHash: h,
    identityHash: h,
    reservedAt: z.iso.datetime(),
    retryAllowed: z.literal(false),
    inferenceReserved: z.literal(true),
    visibility: z.literal("LOCAL_ONLY"),
  })
  .strict();
const localConfig = z
  .object({
    baselineState: id,
    outputRoot: id,
    prefix: z.string().regex(/^[a-zA-Z0-9-]+$/u),
    date: z.string().regex(/^\d{8}$/u),
    webrtcRuntimeDirectory: id,
  })
  .strict();
export const state142Schema = z
  .object({
    config: localConfig,
    configHash: h,
    outputs: z.record(z.string().regex(/^[a-z0-9-]+$/u), id),
    policyPath: id,
    baselineSourceIdentityHash: h,
    createdAt: z.iso.datetime(),
  })
  .strict();
const sileroProfile = z
  .object({
    profileId: id,
    threshold: z.literal(0.2),
    minSpeechMs: z.literal(96),
    minSilenceMs: z.literal(80),
    maxSpeechSeconds: z.literal(12),
    speechPadMs: z.literal(0),
    samplesOverlap: z.literal(0),
  })
  .strict();
const pyannoteProfile = z
  .object({
    anonymousUnionOnly: z.literal(true),
    posteriorCaptureBeforeHardPowersetConversion: z.literal(true),
    threshold: z.literal(0.5),
  })
  .strict();
const profile = z.union([
  policy142Schema.shape.detectors.shape.webrtc,
  sileroProfile,
  pyannoteProfile,
]);
export const detectorRequest142Schema = z
  .object({
    runId: id,
    family: z.enum(["SILERO", "PYANNOTE", "WEBRTC"]),
    audioPath: id,
    model: id.nullable(),
    library: id.nullable(),
    profile,
    scoreDirectory: id,
    authorized: z.literal(true),
    dispatchReserved: z.literal(true),
  })
  .strict();
const detectorResult = z
  .object({
    rawUnit: z.enum(["SECONDS", "CENTISECONDS"]),
    rawIntervals: z.array(c601141IntervalSchema),
    exclusiveRawIntervals: z.array(c601141IntervalSchema),
    inputFrames: n,
    sampleRate: z.literal(16000),
    device: id,
    frameHopSamples16k: n.positive(),
    frameWindowSamples16k: n.positive(),
    frameOffsetSamples16k: z.number().int(),
    scoreKind: scoreTrack142Schema.shape.scoreKind,
    originalChunkScores: scoreTrack142Schema.shape.originalChunkScores,
    scoreSource: id,
    modelLoadCount: n,
    scoreRelativePath: id,
    scoreSha256: h,
    scoreFrameCount: n,
    stateIsolation: id.optional(),
    speakerIdentityPersisted: z.literal(false).optional(),
    embeddingPersisted: z.literal(false).optional(),
    extraModelForwardCount: z.literal(0).optional(),
  })
  .strict();
export const detectorReceipt142Schema = z
  .object({
    status: z.literal("SUCCESS"),
    runId: id,
    result: detectorResult,
    inferenceConsumed: z.literal(true),
    modelLoadCount: n,
    wallClockSeconds: z.number().nonnegative(),
  })
  .strict();
export const detectorExecution142Schema = z
  .array(
    z
      .object({
        runId: id,
        audioPath: id,
        backend: z
          .object({
            identity: detectorRuntime142Schema,
            worker: id,
            python: id,
            model: id.nullable(),
            library: id.nullable(),
          })
          .strict(),
      })
      .strict(),
  )
  .max(8);
export const detectorTransport142Schema = z
  .object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int(),
  })
  .strict();
export const detectorStarted142Schema = z
  .object({
    runId: id,
    dispatchReserved: z.literal(true),
    retryAllowed: z.literal(false),
  })
  .strict();
export const detectorCacheBinding142Schema = z
  .object({ planHash: h, jobHash: h, receiptHash: h })
  .strict();
export const asrRaw142Schema = c60114ProbeRawResultSchema;
const rawMetrics = z
  .object({
    role: viewRole142Schema,
    pcmSha256: h,
    parentPcmSha256: h,
    frameCount: n,
    durationDeltaSamples: z.number().int(),
    parentCorrelation: z.number().min(-1).max(1),
    maximumCrossCorrelation: z.number().min(-1).max(1),
    maximumCrossCorrelationLagSamples16k: z.number().int(),
    spectralShapeDifference: z.number().nonnegative(),
    features: acousticFeatures142Schema,
    amplitudeOnlyNoOp: z.boolean(),
  })
  .strict();
export const dspMeasurements142Schema = z
  .object({
    controls: z.array(
      z
        .object({
          role: viewRole142Schema,
          inputFrames: n,
          outputFrames: n,
          impulseOffsets16k: z.array(n).length(3),
          measuredDelayNativeSamples: z.array(z.number().int()).length(3),
          firGroupDelaySamples16k: n,
          firCompensatedSamples16k: n,
          controlPcmHash: h,
          passed: z.literal(true),
        })
        .strict(),
    ),
    oldAudit: z.array(rawMetrics.extend({ viewId: id }).strict()),
    generated: z.array(
      rawMetrics
        .extend({
          relativePath: id,
          audioSha256: h,
          parentViewId: id,
          recipe: z
            .object({
              firTaps: n,
              bandHz: z.array(z.number().nonnegative()).length(2),
              preemphasis: z.number(),
              preemphasisMode: z.literal("ZERO_PHASE_SYMMETRIC"),
              compressionThreshold: z.number(),
              compressionRatio: z.number(),
              peakNormalize: z.number(),
            })
            .strict(),
        })
        .strict(),
    ),
    modelInferenceCount: z.literal(0),
    networkUsed: z.literal(false),
  })
  .strict();
export const dspRequest142Schema = z
  .object({
    views: z.array(
      z
        .object({ viewId: id, role: viewRole142Schema, pcmSha256: h, path: id })
        .strict(),
    ),
    nativeSampleRate: n.positive(),
    outputDirectory: id,
  })
  .strict();
export const featuresRequest142Schema = z
  .object({
    audioPath: id,
    intervals: z.array(
      z.object({ id, startSample16k: n, endSample16k: n.positive() }).strict(),
    ),
  })
  .strict();
export const deliveryReceipt142Schema = z
  .object({
    directoryName: id,
    semanticHash: h,
    physical: z
      .object({
        actualAudioCount: n,
        playableCount: n,
        hashVerifiedCount: n,
        allPassed: z.literal(true),
      })
      .strict(),
  })
  .strict();
export const c601142LocalSchemas = {
  "c6-0-1-14-2-baseline-replay": baselineReplay142Schema,
  "machine-c601142-dispatch-ticket": dispatch142Schema,
  "c6-0-1-14-2-run-paths": state142Schema,
  "c6-0-1-14-2-detector-request": detectorRequest142Schema,
  "c6-0-1-14-2-detector-result-receipt": detectorReceipt142Schema,
  "c6-0-1-14-2-detector-execution": detectorExecution142Schema,
  "c6-0-1-14-2-detector-transport": detectorTransport142Schema,
  "c6-0-1-14-2-detector-execution-started": detectorStarted142Schema,
  "c6-0-1-14-2-detector-cache-binding": detectorCacheBinding142Schema,
  "c6-0-1-14-2-detector-run": detectorRun142Schema,
  "c6-0-1-14-2-asr-request-result": asrRequest142Schema,
  "c6-0-1-14-2-asr-raw-result": asrRaw142Schema,
  "c6-0-1-14-2-dsp-measurements": dspMeasurements142Schema,
  "c6-0-1-14-2-dsp-request": dspRequest142Schema,
  "c6-0-1-14-2-acoustic-features-request": featuresRequest142Schema,
  "c6-0-1-14-2-delivery-selection": deliveryReceipt142Schema,
};
