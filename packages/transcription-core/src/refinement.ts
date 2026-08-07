import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  adaptiveRefinementRecordSchema,
  atomicWriteJson,
  pathExists,
  readJson,
  subtitleCueSchema,
  transcriptionQualitySchema,
  type AdaptiveRefinementRecord,
  type LanguageTag,
  type Logger,
  type ProcessRunner,
  type SubtitleCue,
  type TranscriptionPlan,
  type TranscriptionQuality,
  type TimingQaConfig,
  type VadNoVadComparison,
} from "@mvl/shared";
import { z } from "zod";

import {
  canonicalizeAsrSegments,
  canonicalUtterancesToCues,
  rawEvidenceFromResult,
} from "./canonical.js";
import { ACOUSTIC_SCENE_ANALYSIS_VERSION } from "./scene.js";
import {
  arbitrateHypotheses,
  compareTranscripts,
  evaluateHypothesisQuality,
  evaluateLocalConsensus,
  evaluateTranscriptConsensus,
  evaluateTranscriptionQuality,
  finalizeQualityWithoutRefinement,
  HARD_MAX_MERGED_REFINEMENT_SECONDS,
  normalizeHypothesisText,
  refinementIntervals,
} from "./quality.js";
import type {
  AcousticSceneSegment,
  AudioChunk,
  SceneAwareRefinementInterval,
  TranscriptionAdapter,
  TranscriptionChunkResult,
} from "./types.js";
import {
  buildPortableAsrCacheIdentityV2,
  type PortableAsrCache,
} from "./asr-cache.js";

const cachedRefinementSchema = z
  .object({
    text: z.string(),
    segments: z.array(
      z
        .object({
          start: z.number().nonnegative(),
          end: z.number().positive(),
          text: z.string(),
          speaker: z.string().min(1).nullable(),
          confidence: z.number().min(0).max(1).nullable(),
          tokens: z
            .array(
              z
                .object({
                  text: z.string(),
                  start: z.number().nonnegative(),
                  end: z.number().nonnegative(),
                  probability: z.number().min(0).max(1).nullable().optional(),
                })
                .strict(),
            )
            .optional(),
          metrics: z
            .object({
              averageLogProbability: z.number().nullable().optional(),
              noSpeechProbability: z
                .number()
                .min(0)
                .max(1)
                .nullable()
                .optional(),
              tokenProbability: z.number().min(0).max(1).nullable().optional(),
              entropy: z.number().nonnegative().nullable().optional(),
              decoderFallback: z.boolean().nullable().optional(),
              detectedLanguage: z
                .enum(["zh", "zh-Hans", "zh-Hant", "ja", "en", "mixed", "und"])
                .nullable()
                .optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    raw: z.unknown(),
  })
  .strict();

interface Interval {
  start: number;
  end: number;
}

function isTimingOnlyReason(reason: string): boolean {
  return /TIMING|TIMESTAMP|BOUNDARY|OVERMERGE|OVERLAP|DURATION|SILENCE|SPEECH_RATIO|TEXT_DENSITY|CPS|characters-per-second|leading|trailing/iu.test(
    reason,
  );
}

export function isTextStableButTimingUnstable(input: {
  textSimilarity: number;
  timingConsistency: number | null;
  empty: boolean;
  hardReject: boolean;
  hallucinated: boolean;
  languageConflict: boolean;
  validCandidateTextConflict: boolean;
  qualityReasons: readonly string[];
}): boolean {
  return (
    input.textSimilarity >= 0.75 &&
    input.timingConsistency !== null &&
    input.timingConsistency < 0.5 &&
    !input.empty &&
    !input.hardReject &&
    !input.hallucinated &&
    !input.languageConflict &&
    !input.validCandidateTextConflict &&
    input.qualityReasons.every(isTimingOnlyReason)
  );
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function overlaps(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

function overlapSeconds(left: Interval, right: Interval): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function intervalText(
  cues: readonly SubtitleCue[],
  interval: Interval,
): string {
  return cues
    .filter((cue) => overlaps(cue, interval))
    .map((cue) => cue.text.trim())
    .filter(Boolean)
    .reduce((text, next) => {
      if (text === "") return next;
      const needsSpace =
        /[A-Za-z0-9]$/u.test(text) && /^[A-Za-z0-9]/u.test(next);
      return `${text}${needsSpace ? " " : ""}${next}`;
    }, "");
}

function coverageInterval(
  cues: readonly SubtitleCue[],
  interval: Interval,
): Interval | undefined {
  const overlapping = cues.filter((cue) => overlaps(cue, interval));
  if (overlapping.length === 0) return undefined;
  return {
    start: Math.max(
      interval.start,
      Math.min(...overlapping.map((cue) => cue.start)),
    ),
    end: Math.min(interval.end, Math.max(...overlapping.map((cue) => cue.end))),
  };
}

function timingOnlyAlignedCues(input: {
  baselineCues: readonly SubtitleCue[];
  refinedCues: readonly SubtitleCue[];
  interval: Interval;
}): SubtitleCue[] {
  const baseline = input.baselineCues.filter((cue) =>
    overlaps(cue, input.interval),
  );
  const refined = input.refinedCues.filter((cue) =>
    overlaps(cue, input.interval),
  );
  if (baseline.length === 0 || refined.length === 0) return baseline;
  if (baseline.length === refined.length) {
    return baseline.map((cue, index) => {
      const timing = refined[index];
      return timing === undefined
        ? cue
        : {
            ...cue,
            start: Math.max(input.interval.start, timing.start),
            end: Math.min(input.interval.end, timing.end),
            timingEvidence: timing.timingEvidence,
          };
    });
  }
  const start = Math.max(
    input.interval.start,
    Math.min(...refined.map((cue) => cue.start)),
  );
  const end = Math.min(
    input.interval.end,
    Math.max(...refined.map((cue) => cue.end)),
  );
  const totalWeight = baseline.reduce(
    (sum, cue) => sum + Math.max(0.001, cue.end - cue.start),
    0,
  );
  let cursor = start;
  return baseline.map((cue, index) => {
    const isLast = index === baseline.length - 1;
    const share = Math.max(0.001, cue.end - cue.start) / totalWeight;
    const cueEnd = isLast ? end : cursor + (end - start) * share;
    const aligned = {
      ...cue,
      start: cursor,
      end: Math.max(cursor + 0.001, cueEnd),
      timingEvidence: refined[0]?.timingEvidence ?? cue.timingEvidence,
    };
    cursor = aligned.end;
    return aligned;
  });
}

function hypothesisCues(
  conflicts: readonly VadNoVadComparison[],
  side: "vad" | "noVad",
): SubtitleCue[] {
  return conflicts
    .flatMap((conflict) => conflict[side].segments ?? [])
    .map((segment, index) =>
      subtitleCueSchema.parse({
        id: `${side}-hypothesis-${String(index + 1).padStart(4, "0")}`,
        start: segment.start,
        end: segment.end,
        text: segment.text,
        language: segment.language,
        languages: [segment.language],
        speaker: null,
        confidence: segment.confidence,
      }),
    )
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
}

function boundedExpandedInterval(input: {
  interval: Interval;
  contextSeconds: number;
  durationSeconds: number;
  hardMaximumSeconds: number;
}): Interval {
  const intervalDuration = input.interval.end - input.interval.start;
  if (intervalDuration >= input.hardMaximumSeconds) {
    return { ...input.interval };
  }
  const availableContext = input.hardMaximumSeconds - intervalDuration;
  const leading = Math.min(input.contextSeconds, availableContext / 2);
  let start = Math.max(0, input.interval.start - leading);
  let end = Math.min(
    input.durationSeconds,
    start +
      Math.min(
        input.hardMaximumSeconds,
        intervalDuration + input.contextSeconds * 2,
      ),
  );
  if (end < input.interval.end) {
    end = input.interval.end;
    start = Math.max(0, end - input.hardMaximumSeconds);
  }
  return { start, end };
}

function promptForRefinement(input: {
  names: readonly string[];
  cues: readonly SubtitleCue[];
  interval: Interval;
}): string {
  const before = input.cues
    .filter((cue) => cue.end <= input.interval.start)
    .at(-1)?.text;
  const after = input.cues.find((cue) => cue.start >= input.interval.end)?.text;
  return [
    input.names.length === 0
      ? ""
      : `Confirmed names and terms: ${[...new Set(input.names)].join(", ")}.`,
    before === undefined
      ? ""
      : `Previous confirmed speech: ${before.slice(-300)}`,
    after === undefined ? "" : `Next confirmed speech: ${after.slice(0, 300)}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function cacheKey(input: {
  audioHash: string;
  interval: Interval;
  round: number;
  adapter: TranscriptionAdapter;
  prompt: string;
  sceneContext?: SceneAwareRefinementInterval | undefined;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        audioContentHash: input.audioHash,
        expandedInterval: input.interval,
        refinementRound: input.round,
        adapter: input.adapter.id,
        model: input.adapter.model,
        modelHash: input.adapter.runtime?.modelHash ?? null,
        modelFamily: input.adapter.runtime?.modelFamily ?? null,
        coreML: input.adapter.runtime?.coreML ?? null,
        whisperCppVersion: input.adapter.runtime?.whisperCppVersion ?? null,
        contextTextHash: createHash("sha256")
          .update(input.prompt)
          .digest("hex"),
        vadConfiguration: input.adapter.model,
        timestampStrategy: "segment",
        scene:
          input.sceneContext?.sceneLabel === undefined
            ? null
            : {
                label: input.sceneContext.sceneLabel,
                confidenceBucket:
                  Math.floor((input.sceneContext.sceneConfidence ?? 0) * 10) /
                  10,
                routingStrategy:
                  input.sceneContext.sceneRoutingReasons?.find((reason) =>
                    reason.includes("routing"),
                  ) ?? input.sceneContext.sceneLabel,
                analysisVersion: ACOUSTIC_SCENE_ANALYSIS_VERSION,
              },
        referenceAnchorIds: input.sceneContext?.referenceAnchorIds ?? [],
      }),
    )
    .digest("hex");
}

async function extractInterval(input: {
  mediaPath: string;
  audioStreamIndex: number;
  interval: Interval;
  outputPath: string;
  runner: ProcessRunner;
  ffmpegPath: string;
}): Promise<AudioChunk> {
  await input.runner.run(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(input.interval.start),
    "-i",
    input.mediaPath,
    "-map",
    `0:${input.audioStreamIndex}`,
    "-t",
    String(input.interval.end - input.interval.start),
    "-vn",
    "-c:a",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    input.outputPath,
  ]);
  return {
    id: path.basename(input.outputPath, ".wav"),
    relativePath: path.basename(input.outputPath),
    start: input.interval.start,
    end: input.interval.end,
    duration: input.interval.end - input.interval.start,
    sha256: await sha256File(input.outputPath),
  };
}

async function transcribeInterval(input: {
  mediaPath: string;
  audioStreamIndex: number;
  interval: Interval;
  round: number;
  adapter: TranscriptionAdapter;
  outputDirectory: string;
  runner: ProcessRunner;
  ffmpegPath: string;
  language?: LanguageTag;
  prompt: string;
  sceneContext?: SceneAwareRefinementInterval | undefined;
  asrCache?: PortableAsrCache | undefined;
}): Promise<{ result: TranscriptionChunkResult; cacheHit: boolean }> {
  const roundDirectory = path.join(
    input.outputDirectory,
    "audio",
    "refinement",
    `round-${input.round}`,
  );
  await mkdir(roundDirectory, { recursive: true });
  const intervalName = [
    String(Math.round(input.interval.start * 1000)).padStart(10, "0"),
    String(Math.round(input.interval.end * 1000)).padStart(10, "0"),
  ].join("-");
  const audioPath = path.join(roundDirectory, `${intervalName}.wav`);
  const chunk = await extractInterval({
    mediaPath: input.mediaPath,
    audioStreamIndex: input.audioStreamIndex,
    interval: input.interval,
    outputPath: audioPath,
    runner: input.runner,
    ffmpegPath: input.ffmpegPath,
  });
  const key = cacheKey({
    audioHash: chunk.sha256,
    interval: input.interval,
    round: input.round,
    adapter: input.adapter,
    prompt: input.prompt,
    sceneContext: input.sceneContext,
  });
  const cachePath = path.join(
    input.outputDirectory,
    "audio",
    "transcription-cache",
    `refinement-${key}.json`,
  );
  const identity = buildPortableAsrCacheIdentityV2({
    audioContentSha256: chunk.sha256,
    interval: input.interval,
    sampleRate: 16000,
    channels: 1,
    codec: "pcm_s16le",
    adapterId: input.adapter.id,
    model: input.adapter.model,
    modelHash: input.adapter.runtime?.modelHash ?? null,
    modelFamily: input.adapter.runtime?.modelFamily ?? null,
    coreML: input.adapter.runtime?.coreML ?? null,
    whisperCppVersion: input.adapter.runtime?.whisperCppVersion ?? null,
    language: input.language ?? null,
    vadMode: input.adapter.id.includes("no-vad") ? "no-vad" : "adapter-default",
    timestampStrategy: "segment",
    tokenTimestamps: true,
    prompt: input.prompt,
    decodeConfiguration: {
      language: input.language ?? null,
      timestampStrategy: "segment",
      tokenTimestamps: true,
    },
  });
  const portable = await input.asrCache?.lookup({
    requestId: `refinement:r${String(input.round)}:${intervalName}`,
    requestType: "refinement",
    identity,
    legacyKeys: [key],
  });
  if (portable?.hit === true && portable.result !== null) {
    return { result: portable.result, cacheHit: true };
  }
  if (await pathExists(cachePath)) {
    const result = cachedRefinementSchema.parse(await readJson(cachePath));
    await input.asrCache?.store({
      requestId: `refinement:r${String(input.round)}:${intervalName}`,
      requestType: "refinement",
      identity,
      legacyKeys: [key],
      result,
    });
    return {
      result,
      cacheHit: true,
    };
  }
  const result = cachedRefinementSchema.parse(
    await input.adapter.transcribe({
      audioPath,
      chunk: {
        ...chunk,
        start: 0,
        end: chunk.duration,
      },
      timestampStrategy: "segment",
      tokenTimestamps: true,
      prompt: input.prompt,
      ...(input.language === undefined ? {} : { language: input.language }),
    }),
  );
  await atomicWriteJson(cachePath, result);
  await input.asrCache?.store({
    requestId: `refinement:r${String(input.round)}:${intervalName}`,
    requestType: "refinement",
    identity,
    legacyKeys: [key],
    result,
  });
  return { result, cacheHit: false };
}

function resultCues(input: {
  result: TranscriptionChunkResult;
  expandedInterval: Interval;
  selectedInterval: Interval;
  adapterId: string;
  language?: LanguageTag;
  idPrefix: string;
}): SubtitleCue[] {
  const rawSegments = rawEvidenceFromResult({
    result: input.result,
    adapterId: input.adapterId,
    chunkId: input.idPrefix,
    globalStart: input.expandedInterval.start,
    ...(input.language === undefined ? {} : { language: input.language }),
  });
  const utterances = canonicalizeAsrSegments({
    segments: rawSegments,
    speechIntervals: [input.selectedInterval],
  });
  return canonicalUtterancesToCues(utterances).flatMap((cue, index) => {
    const start = Math.max(input.selectedInterval.start, cue.start);
    const speechEnd = Math.min(input.selectedInterval.end, cue.end);
    const end = Math.min(input.selectedInterval.end, speechEnd + 0.2);
    if (cue.text.trim() === "" || speechEnd <= start || end <= start) return [];
    return [
      subtitleCueSchema.parse({
        ...cue,
        id: `${input.idPrefix}-${String(index + 1).padStart(3, "0")}`,
        start,
        end,
        timingEvidence: {
          ...cue.timingEvidence,
          sourceTrusted: false,
          speechStart: start,
          speechEnd,
          tokenTimestampsAvailable:
            cue.timingEvidence?.tokenTimestampsAvailable ?? false,
          tokenTimestampsUsed: cue.timingEvidence?.tokenTimestampsUsed ?? false,
          tokens: cue.timingEvidence?.tokens ?? [],
          alignmentSource: cue.timingEvidence?.alignmentSource ?? "segment",
          presentationTimingMethod: null,
          speechIntervals: [{ start, end: speechEnd }],
          speechBoundarySource: "segment",
        },
      }),
    ];
  });
}

function replaceInterval(
  cues: readonly SubtitleCue[],
  interval: Interval,
  replacements: readonly SubtitleCue[],
): SubtitleCue[] {
  return [
    ...cues.filter((cue) => !overlaps(cue, interval)),
    ...replacements,
  ].toSorted((left, right) => left.start - right.start || left.end - right.end);
}

export async function transcribeIntervalsForComparison(input: {
  mediaPath: string;
  outputDirectory: string;
  audioStreamIndex: number;
  intervals: readonly {
    interval: Interval;
    expandedInterval: Interval;
    sceneId?: string | undefined;
    sceneLabel?: SceneAwareRefinementInterval["sceneLabel"];
    sceneConfidence?: number | undefined;
    sceneProbabilities?: SceneAwareRefinementInterval["sceneProbabilities"];
    sceneRoutingReasons?: string[] | undefined;
  }[];
  adapter: TranscriptionAdapter;
  runner: ProcessRunner;
  ffmpegPath: string;
  language?: LanguageTag;
  promptNames?: readonly string[];
  contextCues?: readonly SubtitleCue[];
  asrCache?: PortableAsrCache | undefined;
}): Promise<{
  cues: SubtitleCue[];
  cacheHits: number;
  transcribedIntervals: number;
}> {
  const cues: SubtitleCue[] = [];
  let cacheHits = 0;
  let transcribedIntervals = 0;
  for (const [index, planned] of input.intervals.entries()) {
    const prompt = promptForRefinement({
      names: input.promptNames ?? [],
      cues: input.contextCues ?? [],
      interval: planned.expandedInterval,
    });
    const transcribed = await transcribeInterval({
      mediaPath: input.mediaPath,
      audioStreamIndex: input.audioStreamIndex,
      interval: planned.expandedInterval,
      round: 0,
      adapter: input.adapter,
      outputDirectory: input.outputDirectory,
      runner: input.runner,
      ffmpegPath: input.ffmpegPath,
      prompt,
      sceneContext: planned,
      ...(input.asrCache === undefined ? {} : { asrCache: input.asrCache }),
      ...(input.language === undefined ? {} : { language: input.language }),
    });
    if (transcribed.cacheHit) cacheHits += 1;
    else transcribedIntervals += 1;
    cues.push(
      ...resultCues({
        result: transcribed.result,
        expandedInterval: planned.expandedInterval,
        selectedInterval: planned.interval,
        adapterId: input.adapter.id,
        idPrefix: `comparison-${String(index + 1).padStart(4, "0")}`,
        ...(input.language === undefined ? {} : { language: input.language }),
      }),
    );
  }
  return {
    cues: cues.toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    ),
    cacheHits,
    transcribedIntervals,
  };
}

function markHumanReview(input: {
  quality: TranscriptionQuality;
  intervals: readonly { start: number; end: number; reasons: string[] }[];
}): TranscriptionQuality {
  const segments = [...input.quality.segments];
  for (const interval of input.intervals) {
    const matching = segments.filter((segment) =>
      overlaps(segment.interval, interval),
    );
    if (matching.length === 0) {
      segments.push({
        id: `human-review-${String(segments.length + 1).padStart(5, "0")}`,
        cueId: null,
        interval: { start: interval.start, end: interval.end },
        text: "",
        status: "needs-human-review",
        classification: "ambiguous-speech",
        signals: {
          confidence: "unavailable",
          lowTokenProbability: null,
          averageLogProbabilityLow: null,
          noSpeechConflict: false,
          decoderFallback: null,
          highEntropy: null,
          repeatedPhrase: false,
          repeatedCharacters: false,
          hallucinationPattern: false,
          vadSpeechButEmpty: false,
          speechTextMismatch: false,
          charactersPerSecond: null,
          charactersPerSecondStatus: "unknown",
          languageConflict: false,
          referenceConflict: null,
          timestampAnomaly: false,
          timestampAnomalyScore: 80,
          timestampAnomalyBand: "mandatory-refine",
          timestampAnomalyReasons: interval.reasons,
          overlapAnomaly: false,
          continuityConcern: false,
          vadNoVadConflict: false,
          largeV3Conflict: false,
          highBackgroundNoise: false,
          stableConsensus: false,
        },
        reasons: interval.reasons,
        refinementRounds: 0,
      });
      continue;
    }
    for (const segment of matching) {
      segment.status = "needs-human-review";
      segment.reasons = [...new Set([...segment.reasons, ...interval.reasons])];
    }
  }
  const summary = {
    ...input.quality.summary,
    accepted: segments.filter((segment) =>
      ["accepted", "accepted-after-refinement"].includes(segment.status),
    ).length,
    needsRefinement: segments.filter(
      (segment) => segment.status === "needs-refinement",
    ).length,
    needsHumanReview: segments.filter(
      (segment) => segment.status === "needs-human-review",
    ).length,
  };
  return transcriptionQualitySchema.parse({
    ...input.quality,
    segments,
    summary,
    needsHumanReviewCount: input.intervals.length,
    needsHumanReviewIntervals: input.intervals,
  });
}

export interface TargetedRefinementResult {
  cues: SubtitleCue[];
  quality: TranscriptionQuality;
  record: AdaptiveRefinementRecord;
  corrections: {
    schemaVersion: "1.0.0";
    baselineModel: string;
    replacements: {
      interval: Interval;
      before: string;
      after: string;
      reason: string[];
      reviewStatus: "accepted" | "needs-human-review";
    }[];
  };
  cacheHits: number;
  transcribedIntervals: number;
  timingOnlyRepairCount: number;
  round2SkippedTextStableCount: number;
}

export async function runTargetedRefinement(input: {
  mediaPath: string;
  outputDirectory: string;
  audioStreamIndex: number;
  durationSeconds: number;
  baselineCues: readonly SubtitleCue[];
  baselineAdapter: TranscriptionAdapter;
  refinementAdapter: TranscriptionAdapter;
  plan: TranscriptionPlan;
  runner: ProcessRunner;
  logger: Logger;
  ffmpegPath: string;
  speechIntervals?: readonly Interval[];
  language?: LanguageTag;
  promptNames?: readonly string[];
  originalLanguageReferences?: readonly SubtitleCue[];
  vadNoVadComparisons?: readonly VadNoVadComparison[];
  acousticScenes?: readonly AcousticSceneSegment[] | undefined;
  timingConfig?: Partial<TimingQaConfig> | undefined;
  asrCache?: PortableAsrCache | undefined;
}): Promise<TargetedRefinementResult> {
  const initialQuality = evaluateTranscriptionQuality({
    cues: input.baselineCues,
    speechIntervals: input.speechIntervals ?? [],
    expectedLanguages: input.language === undefined ? [] : [input.language],
    originalLanguageReferences: input.originalLanguageReferences ?? [],
    vadNoVadComparisons: input.vadNoVadComparisons ?? [],
    timingConfig: input.timingConfig,
  });
  const refinementPlan = input.plan.refinement;
  const maximumRefinementSeconds = Math.min(
    HARD_MAX_MERGED_REFINEMENT_SECONDS,
    Math.max(1, refinementPlan?.maxMergedRefinementSeconds ?? 30),
  );
  const acceptedContextCueIds = new Set(
    initialQuality.segments.flatMap((segment) =>
      segment.status === "accepted" && segment.cueId !== null
        ? [segment.cueId]
        : [],
    ),
  );
  const acceptedContextCues = input.baselineCues.filter((cue) =>
    acceptedContextCueIds.has(cue.id),
  );
  const plannedIntervals =
    input.plan.fullSecondPass && refinementPlan !== null
      ? [
          {
            interval: { start: 0, end: input.durationSeconds },
            expandedInterval: { start: 0, end: input.durationSeconds },
          },
        ]
      : refinementIntervals({
          quality: initialQuality,
          durationSeconds: input.durationSeconds,
          contextSeconds: Math.max(5, refinementPlan?.contextSeconds ?? 5),
          mergeGapSeconds: refinementPlan?.mergeGapSeconds ?? 1.5,
          speechIntervals: input.speechIntervals ?? [],
          maxMergedRefinementSeconds:
            refinementPlan?.maxMergedRefinementSeconds ?? 30,
        });
  if (refinementPlan === null || refinementPlan.maxRounds === 0) {
    const unresolved = plannedIntervals.map((item) => ({
      ...item.interval,
      reasons: ["refinement-disabled-or-unavailable"],
    }));
    const quality = markHumanReview({
      quality: initialQuality,
      intervals: unresolved,
    });
    return {
      cues: [...input.baselineCues],
      quality,
      record: adaptiveRefinementRecordSchema.parse({
        schemaVersion: "1.0.0",
        strategy: "adaptive",
        basePass: {
          adapter: "whisper-cpp",
          model: input.baselineAdapter.model,
          coreML: input.baselineAdapter.runtime?.coreML ?? false,
          timestampStrategy: "segment",
        },
        replacements: [],
        maxRounds: refinementPlan?.maxRounds ?? 0,
        roundsExecuted: 0,
        qualitySummary: {
          accepted: quality.summary.accepted,
          refined: 0,
          needsHumanReview: quality.needsHumanReviewCount,
        },
        needsHumanReviewCount: quality.needsHumanReviewCount,
        needsHumanReviewIntervals: quality.needsHumanReviewIntervals,
      }),
      corrections: {
        schemaVersion: "1.0.0",
        baselineModel: input.baselineAdapter.model,
        replacements: [],
      },
      cacheHits: 0,
      transcribedIntervals: 0,
      timingOnlyRepairCount: 0,
      round2SkippedTextStableCount: 0,
    };
  }

  let cues = [...input.baselineCues];
  let cacheHits = 0;
  let transcribedIntervals = 0;
  let roundsExecuted = 0;
  let timingOnlyRepairCount = 0;
  let round2SkippedTextStableCount = 0;
  const records: AdaptiveRefinementRecord["replacements"] = [];
  const corrections: TargetedRefinementResult["corrections"]["replacements"] =
    [];
  const humanReview: {
    start: number;
    end: number;
    reasons: string[];
  }[] = [];
  const finalComparisons = [...(input.vadNoVadComparisons ?? [])];

  for (const planned of plannedIntervals) {
    const scene = (input.acousticScenes ?? [])
      .filter((candidate) => overlaps(candidate.interval, planned.interval))
      .toSorted(
        (left, right) =>
          overlapSeconds(right.interval, planned.interval) -
          overlapSeconds(left.interval, planned.interval),
      )[0];
    const sceneContext: SceneAwareRefinementInterval | undefined =
      scene === undefined
        ? undefined
        : {
            ...planned,
            sceneId: scene.id,
            sceneLabel: scene.label,
            sceneConfidence: scene.confidence,
            sceneProbabilities: scene.probabilities,
            sceneRoutingReasons: scene.routingDecision.reasons,
          };
    const baselineText = intervalText(input.baselineCues, planned.interval);
    const conflicts = finalComparisons.filter(
      (comparison) =>
        comparison.vadNoVadConflict &&
        overlaps(comparison.interval, planned.interval),
    );
    const primaryConflict = conflicts.toSorted(
      (left, right) =>
        left.metrics.normalizedSimilarity - right.metrics.normalizedSimilarity,
    )[0];
    const hasVadNoVadConflict = primaryConflict !== undefined;
    const vadCandidateCues = hypothesisCues(conflicts, "vad");
    const noVadCandidateCues = hypothesisCues(conflicts, "noVad");
    const vadText =
      vadCandidateCues.length > 0
        ? intervalText(vadCandidateCues, planned.interval)
        : conflicts
            .map((conflict) => conflict.vad.text.trim())
            .filter(Boolean)
            .join(" ");
    const noVadText =
      noVadCandidateCues.length > 0
        ? intervalText(noVadCandidateCues, planned.interval)
        : conflicts
            .map((conflict) => conflict.noVad.text.trim())
            .filter(Boolean)
            .join(" ");
    const highBackgroundNoise =
      scene?.label === "noisy-dialogue" ||
      conflicts.some((conflict) => conflict.highBackgroundNoise);
    const speechEvidence = conflicts.some(
      (conflict) => conflict.speechEvidence === "strong",
    )
      ? ("strong" as const)
      : conflicts.some((conflict) => conflict.speechEvidence === "weak")
        ? ("weak" as const)
        : ("unknown" as const);
    const referenceText = intervalText(
      input.originalLanguageReferences ?? [],
      planned.interval,
    );
    let selected = false;
    let expanded = planned.expandedInterval;
    for (let round = 1; round <= refinementPlan.maxRounds; round += 1) {
      roundsExecuted = Math.max(roundsExecuted, round);
      if (round > 1) {
        const widerContext =
          Math.max(5, refinementPlan.contextSeconds) * 2 ** (round - 1);
        expanded = input.plan.fullSecondPass
          ? {
              start: Math.max(0, planned.interval.start - widerContext),
              end: Math.min(
                input.durationSeconds,
                planned.interval.end + widerContext,
              ),
            }
          : boundedExpandedInterval({
              interval: planned.interval,
              contextSeconds: widerContext,
              durationSeconds: input.durationSeconds,
              hardMaximumSeconds: maximumRefinementSeconds,
            });
      }
      const prompt = promptForRefinement({
        names: input.promptNames ?? [],
        cues: acceptedContextCues,
        interval: expanded,
      });
      const transcribed = await transcribeInterval({
        mediaPath: input.mediaPath,
        audioStreamIndex: input.audioStreamIndex,
        interval: expanded,
        round,
        adapter: input.refinementAdapter,
        outputDirectory: input.outputDirectory,
        runner: input.runner,
        ffmpegPath: input.ffmpegPath,
        prompt,
        sceneContext,
        ...(input.asrCache === undefined ? {} : { asrCache: input.asrCache }),
        ...(input.language === undefined ? {} : { language: input.language }),
      });
      if (transcribed.cacheHit) cacheHits += 1;
      else transcribedIntervals += 1;
      const refinedCues = resultCues({
        result: transcribed.result,
        expandedInterval: expanded,
        selectedInterval: planned.interval,
        adapterId: input.refinementAdapter.id,
        ...(input.language === undefined ? {} : { language: input.language }),
        idPrefix: `refined-r${round}-${String(records.length + 1).padStart(4, "0")}`,
      });
      const refinementText = intervalText(refinedCues, planned.interval);
      const refinementQuality = evaluateTranscriptionQuality({
        cues: refinedCues,
        expectedLanguages: input.language === undefined ? [] : [input.language],
        originalLanguageReferences: input.originalLanguageReferences ?? [],
        timingConfig: input.timingConfig,
      });
      const comparison = compareTranscripts({
        baselineText,
        refinementText,
        baselineInterval:
          coverageInterval(input.baselineCues, planned.interval) ??
          planned.interval,
        refinementInterval:
          coverageInterval(refinedCues, planned.interval) ?? planned.interval,
      });
      const refinementConfidence =
        refinedCues.length === 0 ||
        refinedCues.every((cue) => cue.confidence === null)
          ? null
          : Math.min(
              ...refinedCues.flatMap((cue) =>
                cue.confidence === null ? [] : [cue.confidence],
              ),
            );
      const empty = refinementText.trim() === "";
      const refinementHasQualityWarning =
        refinementQuality.summary.needsRefinement > 0;
      const lastRound = round === refinementPlan.maxRounds;
      const evaluatedVadQuality = hasVadNoVadConflict
        ? evaluateHypothesisQuality({
            text: vadText,
            cues: vadCandidateCues,
            interval: planned.interval,
            detectedSpeech: primaryConflict.vad.detectedSpeech,
            language: primaryConflict.vad.language,
            expectedLanguages:
              input.language === undefined ? [] : [input.language],
          })
        : null;
      const evaluatedNoVadQuality = hasVadNoVadConflict
        ? evaluateHypothesisQuality({
            text: noVadText,
            cues: noVadCandidateCues,
            interval: planned.interval,
            detectedSpeech: primaryConflict.noVad.detectedSpeech,
            language: primaryConflict.noVad.language,
            expectedLanguages:
              input.language === undefined ? [] : [input.language],
          })
        : null;
      const vadQuality =
        conflicts.find((conflict) => conflict.vad.quality?.hardReject === true)
          ?.vad.quality ?? evaluatedVadQuality;
      const noVadQuality =
        conflicts.find(
          (conflict) => conflict.noVad.quality?.hardReject === true,
        )?.noVad.quality ?? evaluatedNoVadQuality;
      const refinementHypothesisQuality = evaluateHypothesisQuality({
        text: refinementText,
        cues: refinedCues,
        interval: planned.interval,
        detectedSpeech: refinedCues.length > 0,
        expectedLanguages: input.language === undefined ? [] : [input.language],
      });
      const localConsensus =
        vadQuality === null || noVadQuality === null
          ? null
          : evaluateLocalConsensus({
              interval: planned.interval,
              vadText,
              noVadText,
              refinementText,
              vadQuality,
              noVadQuality,
              refinementQuality: refinementHypothesisQuality,
              vadCues: vadCandidateCues,
              noVadCues: noVadCandidateCues,
              refinementCues: refinedCues,
              speechIntervals: input.speechIntervals ?? [],
              speechEvidence,
              highBackgroundNoise,
              noVadTieBreakBonus: refinementPlan.noVadTieBreakBonus ?? 0.04,
            });
      const arbitration =
        vadQuality === null || noVadQuality === null || localConsensus === null
          ? null
          : arbitrateHypotheses({
              vadQuality,
              noVadQuality,
              refinementQuality: refinementHypothesisQuality,
              consensus: localConsensus,
              highBackgroundNoise,
              speechEvidence,
              lastRound,
            });
      const legacyConsensus = hasVadNoVadConflict
        ? null
        : evaluateTranscriptConsensus({
            vadText: baselineText,
            noVadText: baselineText,
            refinementText,
            refinementConfidence,
            timingConsistency: comparison.timingConsistency,
            ...(referenceText === "" ? {} : { referenceText }),
            highBackgroundNoise,
            speechEvidence,
          });
      const rawDisagreement =
        (arbitration === null
          ? comparison.significantDisagreement
          : !arbitration.stableConsensus) ||
        empty ||
        refinementHasQualityWarning;
      const refinementQualityReasons = [
        ...new Set(
          refinementQuality.segments.flatMap((segment) => segment.reasons),
        ),
      ];
      const timingOnlyRepairSelected =
        round === 1 &&
        arbitration === null &&
        isTextStableButTimingUnstable({
          textSimilarity: comparison.similarity,
          timingConsistency: comparison.timingConsistency,
          empty,
          hardReject: refinementHypothesisQuality.hardReject,
          hallucinated:
            refinementHypothesisQuality.repetitionHallucination ||
            refinementQuality.summary.suspectedHallucinations > 0,
          languageConflict: refinementQuality.segments.some(
            (segment) => segment.signals.languageConflict,
          ),
          validCandidateTextConflict: hasVadNoVadConflict,
          qualityReasons: refinementQualityReasons,
        });
      const disagreement = rawDisagreement && !timingOnlyRepairSelected;
      const classification =
        arbitration?.classification ??
        legacyConsensus?.classification ??
        (disagreement ? "ambiguous-speech" : "normal");
      const stableConsensus =
        (arbitration === null ? !disagreement : arbitration.stableConsensus) &&
        !empty &&
        !refinementHasQualityWarning;
      records.push({
        interval: planned.interval,
        expandedInterval: expanded,
        ...(scene === undefined
          ? {}
          : {
              sceneId: scene.id,
              sceneLabel: scene.label,
              sceneConfidence: scene.confidence,
              sceneProbabilities: scene.probabilities,
              sceneRoutingReasons: scene.routingDecision.reasons,
            }),
        baseline: {
          model: input.baselineAdapter.model,
          coreML: input.baselineAdapter.runtime?.coreML ?? false,
          text: baselineText,
        },
        ...(primaryConflict === undefined
          ? {}
          : {
              baselineHypotheses: {
                vad: {
                  text: vadText,
                  model: primaryConflict.vad.model,
                  detectedSpeech: primaryConflict.vad.detectedSpeech,
                  language: primaryConflict.vad.language,
                  ...(vadQuality === null ? {} : { quality: vadQuality }),
                  segments: vadCandidateCues.map((cue) => ({
                    start: cue.start,
                    end: cue.end,
                    text: cue.text,
                    confidence: cue.confidence,
                    language: cue.language,
                  })),
                },
                noVad: {
                  text: noVadText,
                  model: primaryConflict.noVad.model,
                  detectedSpeech: primaryConflict.noVad.detectedSpeech,
                  language: primaryConflict.noVad.language,
                  ...(noVadQuality === null ? {} : { quality: noVadQuality }),
                  segments: noVadCandidateCues.map((cue) => ({
                    start: cue.start,
                    end: cue.end,
                    text: cue.text,
                    confidence: cue.confidence,
                    language: cue.language,
                  })),
                },
              },
              conflict: {
                vadNoVadConflict: true,
                ...primaryConflict.metrics,
                oneSideEmpty:
                  (normalizeHypothesisText(vadText) === "") !==
                  (normalizeHypothesisText(noVadText) === ""),
                repetitionConflict:
                  (vadQuality?.repetitionHallucination ?? false) !==
                  (noVadQuality?.repetitionHallucination ?? false),
                validCandidateConflict:
                  vadQuality !== null &&
                  noVadQuality !== null &&
                  !vadQuality.hardReject &&
                  !noVadQuality.hardReject,
                conflictCodes: primaryConflict.conflictCodes ?? [],
                highBackgroundNoise,
                speechEvidence,
              },
            }),
        refinement: {
          model: input.refinementAdapter.model,
          coreML: input.refinementAdapter.runtime?.coreML ?? false,
          round,
          text: refinementText,
          tokenTimestampsAvailable: refinedCues.some(
            (cue) => cue.timingEvidence?.tokenTimestampsAvailable === true,
          ),
          tokenTimestampsUsed: refinedCues.some(
            (cue) => cue.timingEvidence?.tokenTimestampsUsed === true,
          ),
          quality: refinementHypothesisQuality,
        },
        ...(localConsensus === null
          ? {}
          : {
              consensus: {
                localComparison: localConsensus.localComparison,
                alignmentMode: localConsensus.alignmentMode,
                localInterval: localConsensus.localInterval,
                vadSupport: localConsensus.support.vad.total,
                noVadSupport: localConsensus.support.noVad.total,
                refinementSupport: localConsensus.support.refinement,
                tieBreakApplied: localConsensus.tieBreakApplied,
              },
            }),
        timingRepair: {
          attempted: true,
          method: refinedCues.some(
            (cue) => cue.timingEvidence?.tokenTimestampsUsed === true,
          )
            ? "timing-only-token"
            : timingOnlyRepairSelected
              ? "timing-only-speech"
              : "retranscription",
          before:
            coverageInterval(input.baselineCues, planned.interval) ??
            planned.interval,
          after: coverageInterval(refinedCues, planned.interval) ?? null,
          reasons:
            initialQuality.segments
              .filter((segment) => overlaps(segment.interval, planned.interval))
              .flatMap((segment) => segment.reasons)
              .filter(
                (reason, reasonIndex, values) =>
                  values.indexOf(reason) === reasonIndex,
              ).length > 0
              ? initialQuality.segments
                  .filter((segment) =>
                    overlaps(segment.interval, planned.interval),
                  )
                  .flatMap((segment) => segment.reasons)
                  .filter(
                    (reason, reasonIndex, values) =>
                      values.indexOf(reason) === reasonIndex,
                  )
              : ["INSUFFICIENT_CONTEXT"],
          ...(timingOnlyRepairSelected
            ? {
                repairType: "timing-only" as const,
                textChanged: false,
                asrRerun: false,
              }
            : {}),
        },
        decision: {
          selected: timingOnlyRepairSelected
            ? "baseline"
            : disagreement
              ? lastRound
                ? "needs-human-review"
                : hasVadNoVadConflict
                  ? "none"
                  : "baseline"
              : (arbitration?.selected ?? "refinement"),
          reason: timingOnlyRepairSelected
            ? [
                "ROUND_2_SKIPPED_TEXT_ALREADY_STABLE",
                "timing-only-repair-selected",
              ]
            : empty
              ? lastRound
                ? ["empty-refinement", "maximum-rounds-reached"]
                : ["empty-refinement", "retry-wider-context"]
              : refinementHasQualityWarning
                ? lastRound
                  ? ["refinement-quality-warning", "maximum-rounds-reached"]
                  : ["refinement-quality-warning", "retry-wider-context"]
                : arbitration !== null
                  ? arbitration.reasons
                  : comparison.significantDisagreement
                    ? lastRound
                      ? ["model-disagreement", "maximum-rounds-reached"]
                      : ["model-disagreement", "retry-wider-context"]
                    : ["model-consensus", "higher-quality-model"],
          similarity:
            localConsensus === null
              ? comparison.similarity
              : Math.max(
                  localConsensus.support.vad.total,
                  localConsensus.support.noVad.total,
                ),
          status: disagreement
            ? lastRound
              ? "needs-human-review"
              : "needs-refinement"
            : arbitration === null
              ? "accepted"
              : "accepted-after-refinement",
          classification,
          stableConsensus,
        },
      });
      if (!disagreement) {
        const selectedHypothesis = timingOnlyRepairSelected
          ? ("baseline" as const)
          : arbitration?.selected === "vad" ||
              arbitration?.selected === "no-vad" ||
              arbitration?.selected === "refinement"
            ? arbitration.selected
            : "refinement";
        for (const conflict of conflicts) {
          const index = finalComparisons.indexOf(conflict);
          finalComparisons[index] = {
            ...conflict,
            stableConsensus: true,
            largeV3Conflict: false,
            ...(selectedHypothesis === "baseline"
              ? {}
              : { selectedHypothesis }),
            resolutionStatus: "accepted-after-refinement",
            classification: "normal",
          };
        }
        if (selectedHypothesis === "no-vad") {
          cues = replaceInterval(
            cues,
            planned.interval,
            noVadCandidateCues.filter((cue) => overlaps(cue, planned.interval)),
          );
        } else if (selectedHypothesis === "refinement") {
          cues = replaceInterval(cues, planned.interval, refinedCues);
        } else if (timingOnlyRepairSelected) {
          cues = replaceInterval(
            cues,
            planned.interval,
            timingOnlyAlignedCues({
              baselineCues: cues,
              refinedCues,
              interval: planned.interval,
            }),
          );
          timingOnlyRepairCount += 1;
          round2SkippedTextStableCount += 1;
        }
        const after = timingOnlyRepairSelected
          ? baselineText
          : selectedHypothesis === "vad"
            ? intervalText(cues, planned.interval)
            : selectedHypothesis === "no-vad"
              ? intervalText(noVadCandidateCues, planned.interval)
              : refinementText;
        corrections.push({
          interval: planned.interval,
          before: baselineText,
          after,
          reason: timingOnlyRepairSelected
            ? [
                "ROUND_2_SKIPPED_TEXT_ALREADY_STABLE",
                "timing-only-repair-selected",
              ]
            : (arbitration?.reasons ?? [
                "model-consensus",
                "higher-quality-model",
              ]),
          reviewStatus: "accepted",
        });
        selected = true;
        break;
      }
      if (lastRound) {
        for (const conflict of conflicts) {
          const index = finalComparisons.indexOf(conflict);
          finalComparisons[index] = {
            ...conflict,
            stableConsensus: false,
            largeV3Conflict: true,
            classification,
          };
        }
        if (hasVadNoVadConflict) {
          cues = replaceInterval(cues, planned.interval, []);
        }
        humanReview.push({
          ...planned.interval,
          reasons: [
            ...(empty
              ? ["empty-refinement"]
              : refinementHasQualityWarning
                ? ["refinement-quality-warning"]
                : hasVadNoVadConflict
                  ? ["vad-no-vad-conflict", "large-v3-conflict", classification]
                  : ["model-disagreement"]),
            "maximum-rounds-reached",
          ],
        });
        corrections.push({
          interval: planned.interval,
          before: baselineText,
          after: hasVadNoVadConflict ? "" : baselineText,
          reason: humanReview.at(-1)?.reasons ?? ["maximum-rounds-reached"],
          reviewStatus: "needs-human-review",
        });
      }
    }
    if (!selected) {
      input.logger.log(
        "warning",
        "Targeted transcription interval still needs human review.",
        { interval: planned.interval },
      );
    }
  }

  const evaluated = evaluateTranscriptionQuality({
    cues,
    speechIntervals: input.speechIntervals ?? [],
    expectedLanguages: input.language === undefined ? [] : [input.language],
    originalLanguageReferences: input.originalLanguageReferences ?? [],
    vadNoVadComparisons: finalComparisons,
    timingConfig: input.timingConfig,
  });
  const quality = finalizeQualityWithoutRefinement(
    markHumanReview({
      quality: evaluated,
      intervals: humanReview,
    }),
  );
  const record = adaptiveRefinementRecordSchema.parse({
    schemaVersion: "1.0.0",
    strategy: "adaptive",
    basePass: {
      adapter: "whisper-cpp",
      model: input.baselineAdapter.model,
      coreML: input.baselineAdapter.runtime?.coreML ?? false,
      timestampStrategy: "segment",
    },
    replacements: records,
    maxRounds: refinementPlan.maxRounds,
    roundsExecuted,
    qualitySummary: {
      accepted: quality.summary.accepted,
      refined: corrections.filter(
        (correction) => correction.reviewStatus === "accepted",
      ).length,
      needsHumanReview: quality.needsHumanReviewCount,
      vadNoVadConflicts: quality.summary.vadNoVadConflicts,
      resolvedByLargeV3: quality.summary.resolvedByLargeV3,
      suspectedHallucinations: quality.summary.suspectedHallucinations,
      probableNonSpeech: quality.summary.probableNonSpeech,
      autoResolvedVad: quality.summary.autoResolvedVad,
      autoResolvedNoVad: quality.summary.autoResolvedNoVad,
      autoResolvedLargeV3: quality.summary.autoResolvedLargeV3,
      rejectedVadHallucinations: quality.summary.rejectedVadHallucinations,
      rejectedNoVadHallucinations: quality.summary.rejectedNoVadHallucinations,
      trueUnresolvedConflicts: quality.summary.trueUnresolvedConflicts,
    },
    needsHumanReviewCount: quality.needsHumanReviewCount,
    needsHumanReviewIntervals: quality.needsHumanReviewIntervals,
  });
  return {
    cues,
    quality,
    record,
    corrections: {
      schemaVersion: "1.0.0",
      baselineModel: input.baselineAdapter.model,
      replacements: corrections,
    },
    cacheHits,
    transcribedIntervals,
    timingOnlyRepairCount,
    round2SkippedTextStableCount,
  };
}
