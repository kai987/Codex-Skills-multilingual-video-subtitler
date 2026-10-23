import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  analyzeJapaneseBoundary,
  analyzeJapaneseText,
} from "@mvl/subtitle-core";
import {
  atomicWriteJson,
  pathExists,
  readJson,
  transcriptionQualitySchema,
  type FinalReviewQueue,
  type LanguageTag,
  type Logger,
  type ProcessRunner,
  type SubtitleCue,
  type TranscriptionQuality,
} from "@mvl/shared";

import {
  canonicalizeAsrSegments,
  canonicalUtterancesToCues,
  rawEvidenceFromResult,
} from "./canonical.js";
import {
  compareTranscripts,
  evaluateHypothesisQuality,
  evaluateTranscriptConsensus,
  evaluateTranscriptionQuality,
  finalizeQualityWithoutRefinement,
} from "./quality.js";
import type {
  AcousticSceneLabel,
  AcousticSceneSegment,
  AudioChunk,
  TranscriptionAdapter,
  TranscriptionChunkResult,
} from "./types.js";
import {
  buildPortableAsrCacheIdentityV2,
  type PortableAsrCache,
} from "./asr-cache.js";
import { portableTranscriptionChunkResultSchema } from "@mvl/shared";

interface Interval {
  start: number;
  end: number;
}

export type MissingDialogueRecoveryProfile =
  "current-sensitive-vad" | "extra-sensitive-vad" | "no-vad";

export interface MissingDialogueRecoveryAttempt {
  id: string;
  profile: MissingDialogueRecoveryProfile;
  asrRequestId: string;
  model: string;
  coreML: boolean;
  vadEnabled: boolean;
  prompt: {
    confirmedNames: string[];
    adjacentOriginalLanguageText: string[];
    translatedReferenceUsedAsTarget: false;
  };
  cacheKey: string;
  cacheHit: boolean;
  text: string;
  canonicalCues: SubtitleCue[];
  quality: ReturnType<typeof evaluateHypothesisQuality>;
  qualityFindingCount: number;
  timingValid: boolean;
  decision:
    | "candidate-valid"
    | "invalid-hallucination"
    | "invalid-empty"
    | "invalid-timing"
    | "invalid-language"
    | "weak";
}

export interface MissingDialogueRecoveryUnit {
  id: string;
  parentReviewGroupId: string;
  interval: Interval;
  extractedInterval: Interval;
  speechIslandIds: string[];
  contextBeforeSeconds: number;
  contextAfterSeconds: number;
  sourceReasons: string[];
  maximumUnitSeconds?: number | undefined;
  preferredContextSeconds?: number | undefined;
  referenceAnchorIds?: string[] | undefined;
  referenceUnitId?: string | undefined;
  expectedCueCount?: number | undefined;
  sceneId?: string | undefined;
  sceneLabel?: AcousticSceneLabel | undefined;
  requestedProfiles?: MissingDialogueRecoveryProfile[] | undefined;
  routingReasons?: string[] | undefined;
  attempts: MissingDialogueRecoveryAttempt[];
  decision:
    | "recovered"
    | "probable-non-speech"
    | "suspected-hallucination"
    | "needs-human-review";
  selectedAttemptId: string | null;
  decisionReasons: string[];
}

export interface MissingDialogueRecoveryArtifact {
  schemaVersion: "1.0.0";
  generatedAt: string;
  maximumActualWavSeconds: number;
  summary: {
    inputReviewGroups: number;
    recoveryUnits: number;
    recoveredUnits: number;
    probableNonSpeechUnits: number;
    suspectedHallucinationUnits: number;
    stillNeedsReviewUnits: number;
    autoCreatedFinalCues: number;
    closedMissingDialogueReviews: number;
    recoveryAsrRequests: number;
    cacheHits: number;
    profileAttempts: Record<MissingDialogueRecoveryProfile, number>;
  };
  units: MissingDialogueRecoveryUnit[];
}

export interface RecoveryAdapterProfile {
  profile: MissingDialogueRecoveryProfile;
  adapter: TranscriptionAdapter;
  vadEnabled: boolean;
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

function speechIslandIds(
  interval: Interval,
  speechIntervals: readonly Interval[],
): string[] {
  return speechIntervals.flatMap((speech, index) =>
    overlaps(interval, speech)
      ? [`speech-island-${String(index + 1).padStart(4, "0")}`]
      : [],
  );
}

function boundedContext(
  interval: Interval,
  mediaDurationSeconds: number,
  maximumActualWavSeconds: number,
  preferredContextSeconds: number,
): Interval {
  const duration = interval.end - interval.start;
  const available = Math.max(0, maximumActualWavSeconds - duration);
  const before = Math.min(
    interval.start,
    preferredContextSeconds,
    available / 2,
  );
  let start = interval.start - before;
  let end = Math.min(
    mediaDurationSeconds,
    interval.end + Math.min(preferredContextSeconds, available - before),
  );
  if (end - start < maximumActualWavSeconds && start > 0) {
    start = Math.max(
      0,
      start - Math.min(start, maximumActualWavSeconds - (end - start)),
    );
  }
  if (end - start > maximumActualWavSeconds) {
    end = start + maximumActualWavSeconds;
  }
  return { start, end };
}

function splitBounded(input: {
  interval: Interval;
  preferredBoundaries: readonly number[];
  maximumUnitSeconds: number;
}): Interval[] {
  const output: Interval[] = [];
  let cursor = input.interval.start;
  while (input.interval.end - cursor > input.maximumUnitSeconds) {
    const limit = cursor + input.maximumUnitSeconds;
    const candidates = input.preferredBoundaries
      .filter(
        (boundary) =>
          boundary > cursor + 1 &&
          boundary <= limit &&
          boundary < input.interval.end,
      )
      .toSorted(
        (left, right) =>
          Math.abs(limit - left) - Math.abs(limit - right) || left - right,
      );
    const boundary = candidates[0] ?? limit;
    output.push({ start: cursor, end: boundary });
    cursor = boundary;
  }
  if (input.interval.end > cursor) {
    output.push({ start: cursor, end: input.interval.end });
  }
  return output;
}

export function planMissingDialogueRecovery(input: {
  reviewQueue: FinalReviewQueue;
  speechIntervals?: readonly Interval[] | undefined;
  sceneBoundaries?: readonly number[] | undefined;
  rawSegmentBoundaries?: readonly number[] | undefined;
  reliableCues?: readonly SubtitleCue[] | undefined;
  mediaDurationSeconds: number;
  maximumActualWavSeconds?: number | undefined;
  maximumUnitSeconds?: number | undefined;
  preferredContextSeconds?: number | undefined;
  acousticScenes?: readonly AcousticSceneSegment[] | undefined;
  requiredIntervals?:
    | readonly {
        id: string;
        interval: Interval;
        reasons: readonly string[];
        expectedContent: "dialogue" | "singing";
        maximumUnitSeconds?: number | undefined;
        preferredContextSeconds?: number | undefined;
        referenceAnchorIds?: readonly string[] | undefined;
        referenceUnitId?: string | undefined;
        expectedCueCount?: number | undefined;
      }[]
    | undefined;
}): MissingDialogueRecoveryUnit[] {
  const speechIntervals = input.speechIntervals ?? [];
  const maximumActualWavSeconds = Math.min(
    30,
    input.maximumActualWavSeconds ?? 30,
  );
  const maximumUnitSeconds = Math.min(
    maximumActualWavSeconds,
    input.maximumUnitSeconds ?? 20,
  );
  const preferredContextSeconds = input.preferredContextSeconds ?? 5;
  const missingGroups = input.reviewQueue.groups.filter(
    (group) => group.missingDialogue === true,
  );
  const requiredGroups = (input.requiredIntervals ?? []).flatMap((required) => {
    if (
      required.expectedContent === "singing" ||
      (input.reliableCues ?? []).some(
        (cue) => overlapSeconds(required.interval, cue) > 0,
      ) ||
      missingGroups.some(
        (group) =>
          overlapSeconds(required.interval, group.interval) /
            Math.max(
              0.001,
              Math.min(
                required.interval.end - required.interval.start,
                group.interval.end - group.interval.start,
              ),
            ) >=
          0.5,
      )
    ) {
      return [];
    }
    return [
      {
        id: `anchor-required:${required.id}`,
        interval: required.interval,
        reasons: [...required.reasons],
        ...(required.maximumUnitSeconds === undefined
          ? {}
          : { maximumUnitSeconds: required.maximumUnitSeconds }),
        ...(required.preferredContextSeconds === undefined
          ? {}
          : { preferredContextSeconds: required.preferredContextSeconds }),
        ...(required.referenceAnchorIds === undefined
          ? {}
          : { referenceAnchorIds: [...required.referenceAnchorIds] }),
        ...(required.referenceUnitId === undefined
          ? {}
          : { referenceUnitId: required.referenceUnitId }),
        ...(required.expectedCueCount === undefined
          ? {}
          : { expectedCueCount: required.expectedCueCount }),
      },
    ];
  });
  const units: MissingDialogueRecoveryUnit[] = [];
  for (const group of [...missingGroups, ...requiredGroups]) {
    const groupMaximumUnitSeconds =
      "maximumUnitSeconds" in group &&
      typeof group.maximumUnitSeconds === "number"
        ? Math.min(maximumActualWavSeconds, group.maximumUnitSeconds)
        : maximumUnitSeconds;
    const groupPreferredContextSeconds =
      "preferredContextSeconds" in group &&
      typeof group.preferredContextSeconds === "number"
        ? group.preferredContextSeconds
        : preferredContextSeconds;
    const clippedSpeech = speechIntervals
      .map((speech) => ({
        start: Math.max(group.interval.start, speech.start),
        end: Math.min(group.interval.end, speech.end),
      }))
      .filter((speech) => speech.end > speech.start);
    const sourceIntervals =
      clippedSpeech.length === 0 ? [group.interval] : clippedSpeech;
    const preferredBoundaries = [
      ...(input.sceneBoundaries ?? []),
      ...(input.rawSegmentBoundaries ?? []),
      ...(input.reliableCues ?? []).flatMap((cue) => [cue.start, cue.end]),
      ...(input.requiredIntervals ?? []).flatMap((required) => [
        required.interval.start,
        required.interval.end,
      ]),
      ...speechIntervals.flatMap((speech) => [speech.start, speech.end]),
    ];
    for (const source of sourceIntervals) {
      for (const interval of splitBounded({
        interval: source,
        preferredBoundaries,
        maximumUnitSeconds: groupMaximumUnitSeconds,
      })) {
        const extractedInterval = boundedContext(
          interval,
          input.mediaDurationSeconds,
          maximumActualWavSeconds,
          groupPreferredContextSeconds,
        );
        units.push({
          id: `recovery-unit-${String(units.length + 1).padStart(4, "0")}`,
          parentReviewGroupId: group.id,
          interval,
          extractedInterval,
          speechIslandIds: speechIslandIds(interval, speechIntervals),
          contextBeforeSeconds: interval.start - extractedInterval.start,
          contextAfterSeconds: extractedInterval.end - interval.end,
          sourceReasons: group.reasons,
          ...("maximumUnitSeconds" in group &&
          typeof group.maximumUnitSeconds === "number"
            ? { maximumUnitSeconds: group.maximumUnitSeconds }
            : {}),
          ...("preferredContextSeconds" in group &&
          typeof group.preferredContextSeconds === "number"
            ? { preferredContextSeconds: group.preferredContextSeconds }
            : {}),
          ...("referenceAnchorIds" in group &&
          Array.isArray(group.referenceAnchorIds)
            ? { referenceAnchorIds: [...group.referenceAnchorIds] }
            : {}),
          ...("referenceUnitId" in group &&
          typeof group.referenceUnitId === "string"
            ? { referenceUnitId: group.referenceUnitId }
            : {}),
          ...("expectedCueCount" in group &&
          typeof group.expectedCueCount === "number"
            ? { expectedCueCount: group.expectedCueCount }
            : {}),
          ...(() => {
            const scene = (input.acousticScenes ?? [])
              .filter(
                (candidate) => overlapSeconds(candidate.interval, interval) > 0,
              )
              .toSorted(
                (left, right) =>
                  overlapSeconds(right.interval, interval) -
                  overlapSeconds(left.interval, interval),
              )[0];
            if (scene === undefined) return {};
            const requestedProfiles: MissingDialogueRecoveryProfile[] =
              scene.label === "clean-dialogue"
                ? ["current-sensitive-vad", "no-vad"]
                : scene.label === "quiet-dialogue"
                  ? ["extra-sensitive-vad", "no-vad"]
                  : scene.label === "noisy-dialogue"
                    ? ["current-sensitive-vad", "no-vad"]
                    : scene.label === "singing"
                      ? []
                      : scene.label === "non-speech"
                        ? []
                        : [
                            "current-sensitive-vad",
                            "extra-sensitive-vad",
                            "no-vad",
                          ];
            return {
              sceneId: scene.id,
              sceneLabel: scene.label,
              requestedProfiles,
              routingReasons: scene.routingDecision.reasons,
            };
          })(),
          attempts: [],
          decision: "needs-human-review",
          selectedAttemptId: null,
          decisionReasons: ["recovery-not-run"],
        });
      }
    }
  }
  return units;
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

async function extractRecoveryAudio(input: {
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

function adjacentContext(input: {
  cues: readonly SubtitleCue[];
  interval: Interval;
  language?: LanguageTag | undefined;
}): string[] {
  const languageMatches = (cue: SubtitleCue): boolean =>
    input.language === undefined ||
    input.language === "und" ||
    cue.language === input.language ||
    (cue.language.startsWith("zh") && input.language.startsWith("zh"));
  const before = input.cues
    .filter((cue) => cue.end <= input.interval.start && languageMatches(cue))
    .at(-1)?.text;
  const after = input.cues.find(
    (cue) => cue.start >= input.interval.end && languageMatches(cue),
  )?.text;
  return [before, after].filter(
    (text): text is string => text !== undefined && text.trim() !== "",
  );
}

function recoveryPrompt(input: {
  names: readonly string[];
  adjacentText: readonly string[];
}): string {
  return [
    input.names.length === 0
      ? ""
      : `Confirmed names and terms: ${[...new Set(input.names)].join(", ")}.`,
    input.adjacentText[0] === undefined
      ? ""
      : `Previous confirmed speech: ${input.adjacentText[0].slice(-300)}`,
    input.adjacentText[1] === undefined
      ? ""
      : `Next confirmed speech: ${input.adjacentText[1].slice(0, 300)}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function recoveryCacheKey(input: {
  audioHash: string;
  unit: MissingDialogueRecoveryUnit;
  adapter: TranscriptionAdapter;
  profile: RecoveryAdapterProfile;
  prompt: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        audioHash: input.audioHash,
        globalInterval: input.unit.interval,
        extractedInterval: input.unit.extractedInterval,
        modelHash: input.adapter.runtime?.modelHash ?? input.adapter.model,
        coreML: input.adapter.runtime?.coreML ?? false,
        vadProfile: input.profile.profile,
        noVad: !input.profile.vadEnabled,
        promptContextHash: createHash("sha256")
          .update(input.prompt)
          .digest("hex"),
        recoveryProfile: input.profile.profile,
        timestampMode: "segment+token",
        whisperCppVersion:
          input.adapter.runtime?.whisperCppVersion ?? "unknown",
      }),
    )
    .digest("hex");
}

async function transcribeRecoveryAttempt(input: {
  unit: MissingDialogueRecoveryUnit;
  audioPath: string;
  chunk: AudioChunk;
  cacheDirectory: string;
  profile: RecoveryAdapterProfile;
  language?: LanguageTag | undefined;
  confirmedNames: readonly string[];
  adjacentText: readonly string[];
  asrCache?: PortableAsrCache | undefined;
}): Promise<{
  result: TranscriptionChunkResult;
  cacheHit: boolean;
  cacheKey: string;
  prompt: string;
}> {
  const prompt = recoveryPrompt({
    names: input.confirmedNames,
    adjacentText: input.adjacentText,
  });
  const cacheKey = recoveryCacheKey({
    audioHash: input.chunk.sha256,
    unit: input.unit,
    adapter: input.profile.adapter,
    profile: input.profile,
    prompt,
  });
  const cachePath = path.join(
    input.cacheDirectory,
    `recovery-${cacheKey}.json`,
  );
  const identity = buildPortableAsrCacheIdentityV2({
    audioContentSha256: input.chunk.sha256,
    interval: input.unit.extractedInterval,
    sampleRate: 16000,
    channels: 1,
    codec: "pcm_s16le",
    adapterId: input.profile.adapter.id,
    model: input.profile.adapter.model,
    modelHash: input.profile.adapter.runtime?.modelHash ?? null,
    modelFamily: input.profile.adapter.runtime?.modelFamily ?? null,
    coreML: input.profile.adapter.runtime?.coreML ?? null,
    whisperCppVersion: input.profile.adapter.runtime?.whisperCppVersion ?? null,
    language: input.language ?? null,
    vadMode: input.profile.profile,
    timestampStrategy: "segment",
    tokenTimestamps: true,
    prompt,
    decodeConfiguration: {
      language: input.language ?? null,
      vadProfile: input.profile.profile,
      tokenTimestamps: true,
    },
  });
  const requestId = `${input.unit.id}:${input.profile.profile}`;
  const portable = await input.asrCache?.lookup({
    requestId,
    requestType: "recovery",
    identity,
    legacyKeys: [cacheKey],
  });
  if (portable?.hit === true && portable.result !== null) {
    return { result: portable.result, cacheHit: true, cacheKey, prompt };
  }
  if (await pathExists(cachePath)) {
    const result = portableTranscriptionChunkResultSchema.parse(
      await readJson(cachePath),
    );
    await input.asrCache?.store({
      requestId,
      requestType: "recovery",
      identity,
      legacyKeys: [cacheKey],
      result,
    });
    return {
      result,
      cacheHit: true,
      cacheKey,
      prompt,
    };
  }
  const result = await input.profile.adapter.transcribe({
    audioPath: input.audioPath,
    chunk: {
      ...input.chunk,
      start: 0,
      end: input.chunk.duration,
    },
    timestampStrategy: "segment",
    tokenTimestamps: true,
    prompt,
    ...(input.language === undefined ? {} : { language: input.language }),
  });
  await atomicWriteJson(cachePath, result);
  await input.asrCache?.store({
    requestId,
    requestType: "recovery",
    identity,
    legacyKeys: [cacheKey],
    result,
  });
  return { result, cacheHit: false, cacheKey, prompt };
}

function attemptDecision(
  quality: ReturnType<typeof evaluateHypothesisQuality>,
  qualityFindingCount: number,
  timingValid: boolean,
): MissingDialogueRecoveryAttempt["decision"] {
  if (quality.validity === "invalid-hallucination") {
    return "invalid-hallucination";
  }
  if (quality.validity === "invalid-empty") return "invalid-empty";
  if (quality.validity === "invalid-timing" || !timingValid) {
    return "invalid-timing";
  }
  if (quality.validity === "invalid-language") return "invalid-language";
  return quality.validity === "valid" && qualityFindingCount === 0
    ? "candidate-valid"
    : "weak";
}

export function decideMissingDialogueRecoveryAttempts(input: {
  attempts: readonly MissingDialogueRecoveryAttempt[];
  speechCoverage: number;
  highBackgroundNoise: boolean;
  acousticallyCorroboratedSingleCandidate?: boolean | undefined;
}): {
  decision: MissingDialogueRecoveryUnit["decision"];
  selectedAttemptId: string | null;
  reasons: string[];
} {
  const textIntegrityValid = (
    attempt: MissingDialogueRecoveryAttempt,
  ): boolean => {
    const analysis = analyzeJapaneseText(attempt.text);
    if (
      analysis.normalizedText === "" ||
      analysis.startsMidWord ||
      analysis.endsMidWord ||
      analysis.likelyIncompleteClause
    ) {
      return false;
    }
    if (analysis.singleCharacter) {
      const duration = attempt.canonicalCues.reduce(
        (sum, cue) => sum + Math.max(0, cue.end - cue.start),
        0,
      );
      if (
        analysis.standaloneInterjectionLikelihood < 0.75 ||
        input.speechCoverage < 0.65 ||
        duration < 0.4
      ) {
        return false;
      }
    }
    return !attempt.canonicalCues.slice(0, -1).some((cue, index) => {
      const right = attempt.canonicalCues[index + 1];
      return (
        right !== undefined &&
        analyzeJapaneseBoundary(cue.text, right.text).boundarySplitsWord
      );
    });
  };
  const valid = input.attempts.filter(
    (attempt) =>
      attempt.decision === "candidate-valid" && textIntegrityValid(attempt),
  );
  const matchingPairs = valid.flatMap((left, leftIndex) =>
    valid.slice(leftIndex + 1).flatMap((right) => {
      const comparison = compareTranscripts({
        baselineText: left.text,
        refinementText: right.text,
      });
      return comparison.similarity >= 0.75 ? [{ left, right }] : [];
    }),
  );
  const pair = matchingPairs[0];
  if (pair !== undefined) {
    const consensus = evaluateTranscriptConsensus({
      vadText: pair.left.text,
      noVadText: pair.left.text,
      refinementText: pair.right.text,
      highBackgroundNoise: input.highBackgroundNoise,
      speechEvidence: input.speechCoverage >= 0.5 ? "strong" : "weak",
    });
    if (consensus.stable) {
      const selected =
        pair.left.quality.qualityScore >= pair.right.quality.qualityScore
          ? pair.left
          : pair.right;
      return {
        decision: "recovered",
        selectedAttemptId: selected.id,
        reasons: [
          "two-independent-profiles-agree",
          "candidate-validity-passed",
          "timing-acoustically-supported",
        ],
      };
    }
  }
  if (
    input.acousticallyCorroboratedSingleCandidate === true &&
    !input.highBackgroundNoise &&
    input.speechCoverage >= 0.65 &&
    valid.length === 1 &&
    !input.attempts.some(
      (attempt) => attempt.decision === "invalid-hallucination",
    )
  ) {
    const selected = valid[0];
    if (selected !== undefined) {
      return {
        decision: "recovered",
        selectedAttemptId: selected.id,
        reasons: [
          "single-candidate-supported-by-clean-scene-and-speech-island",
          "candidate-validity-passed",
          "no-competing-hallucination-candidate",
        ],
      };
    }
  }
  const allUnusable =
    input.attempts.length >= 2 &&
    input.attempts.every((attempt) =>
      [
        "invalid-empty",
        "invalid-hallucination",
        "invalid-timing",
        "weak",
      ].includes(attempt.decision),
    );
  if (input.highBackgroundNoise && input.speechCoverage < 0.3 && allUnusable) {
    return {
      decision: "probable-non-speech",
      selectedAttemptId: null,
      reasons: [
        "weak-acoustic-speech-evidence",
        "multiple-profiles-no-stable-text",
        "background-noise-dominant",
      ],
    };
  }
  if (
    input.attempts.some(
      (attempt) => attempt.decision === "invalid-hallucination",
    ) ||
    (input.highBackgroundNoise && valid.length > 1)
  ) {
    return {
      decision: "suspected-hallucination",
      selectedAttemptId: null,
      reasons: ["recovery-candidates-conflict", "hallucination-risk-remains"],
    };
  }
  return {
    decision: "needs-human-review",
    selectedAttemptId: null,
    reasons: [
      valid.length === 1
        ? "only-one-independent-valid-candidate"
        : "no-stable-two-source-consensus",
      "finite-recovery-budget-exhausted",
    ],
  };
}

export async function runMissingDialogueRecovery(input: {
  mediaPath: string;
  audioStreamIndex: number;
  outputDirectory: string;
  units: readonly MissingDialogueRecoveryUnit[];
  profiles: readonly RecoveryAdapterProfile[];
  existingCues: readonly SubtitleCue[];
  speechIntervals: readonly Interval[];
  mediaDurationSeconds: number;
  runner: ProcessRunner;
  logger: Logger;
  ffmpegPath: string;
  language?: LanguageTag | undefined;
  confirmedNames?: readonly string[] | undefined;
  highBackgroundNoise?: boolean | undefined;
  generatedAt?: string | undefined;
  asrCache?: PortableAsrCache | undefined;
}): Promise<{
  artifact: MissingDialogueRecoveryArtifact;
  recoveredCues: SubtitleCue[];
  cacheHits: number;
  asrRequests: number;
}> {
  const recoveryDirectory = path.join(
    input.outputDirectory,
    "audio",
    "missing-dialogue-recovery",
  );
  const cacheDirectory = path.join(
    input.outputDirectory,
    "audio",
    "transcription-cache",
  );
  await Promise.all([
    mkdir(recoveryDirectory, { recursive: true }),
    mkdir(cacheDirectory, { recursive: true }),
  ]);
  const completedUnits: MissingDialogueRecoveryUnit[] = [];
  const recoveredCues: SubtitleCue[] = [];
  let cacheHits = 0;
  let asrRequests = 0;
  for (const unit of input.units) {
    const audioPath = path.join(recoveryDirectory, `${unit.id}.wav`);
    const chunk = await extractRecoveryAudio({
      mediaPath: input.mediaPath,
      audioStreamIndex: input.audioStreamIndex,
      interval: unit.extractedInterval,
      outputPath: audioPath,
      runner: input.runner,
      ffmpegPath: input.ffmpegPath,
    });
    const adjacentText = adjacentContext({
      cues: input.existingCues,
      interval: unit.interval,
      ...(input.language === undefined ? {} : { language: input.language }),
    });
    const attempts: MissingDialogueRecoveryAttempt[] = [];
    const unitSpeechIntervals = input.speechIntervals
      .map((speech) => ({
        start: Math.max(unit.interval.start, speech.start),
        end: Math.min(unit.interval.end, speech.end),
      }))
      .filter((speech) => speech.end > speech.start);
    const unitSpeechSeconds = input.speechIntervals.reduce(
      (sum, speech) => sum + overlapSeconds(unit.interval, speech),
      0,
    );
    const unitDuration = Math.max(
      0.001,
      unit.interval.end - unit.interval.start,
    );
    const speechCoverage = Math.min(1, unitSpeechSeconds / unitDuration);
    for (const profile of input.profiles) {
      if (
        unit.requestedProfiles !== undefined &&
        !unit.requestedProfiles.includes(profile.profile)
      ) {
        continue;
      }
      if (profile.profile === "extra-sensitive-vad" && speechCoverage <= 0) {
        continue;
      }
      const transcribed = await transcribeRecoveryAttempt({
        unit,
        audioPath,
        chunk,
        cacheDirectory,
        profile,
        confirmedNames: input.confirmedNames ?? [],
        adjacentText,
        ...(input.asrCache === undefined ? {} : { asrCache: input.asrCache }),
        ...(input.language === undefined ? {} : { language: input.language }),
      });
      if (transcribed.cacheHit) cacheHits += 1;
      else asrRequests += 1;
      const rawSegments = rawEvidenceFromResult({
        result: transcribed.result,
        adapterId: profile.adapter.id,
        chunkId: `${unit.id}-${profile.profile}`,
        globalStart: unit.extractedInterval.start,
        ...(input.language === undefined ? {} : { language: input.language }),
      });
      const canonical = canonicalizeAsrSegments({
        segments: rawSegments,
        speechIntervals: unitSpeechIntervals,
      });
      const canonicalCues = canonicalUtterancesToCues(canonical)
        .filter((cue) => overlaps(cue, unit.interval))
        .map((cue, cueIndex) => ({
          ...cue,
          id: `${unit.id}-${profile.profile}-${String(cueIndex + 1).padStart(3, "0")}`,
          start: Math.max(unit.interval.start, cue.start),
          end: Math.min(unit.interval.end, cue.end),
        }))
        .filter((cue) => cue.end > cue.start);
      const text = canonicalCues
        .map((cue) => cue.text.trim())
        .filter(Boolean)
        .reduce((combined, next) => {
          if (combined === "") return next;
          const needsSpace =
            /[A-Za-z0-9]$/u.test(combined) && /^[A-Za-z0-9]/u.test(next);
          return `${combined}${needsSpace ? " " : ""}${next}`;
        }, "");
      const hypothesisQuality = evaluateHypothesisQuality({
        text,
        cues: canonicalCues,
        interval: unit.interval,
        detectedSpeech: speechCoverage > 0,
        expectedLanguages: input.language === undefined ? [] : [input.language],
      });
      const candidateQuality = evaluateTranscriptionQuality({
        cues: canonicalCues,
        speechIntervals: unitSpeechIntervals,
        expectedLanguages: input.language === undefined ? [] : [input.language],
      });
      const timingValid =
        canonicalCues.length > 0 &&
        canonicalCues.every(
          (cue) =>
            cue.end > cue.start &&
            cue.start >= unit.interval.start &&
            cue.end <= unit.interval.end,
        );
      const decision = attemptDecision(
        hypothesisQuality,
        candidateQuality.summary.needsRefinement,
        timingValid,
      );
      attempts.push({
        id: `${unit.id}-attempt-${String(attempts.length + 1).padStart(2, "0")}`,
        profile: profile.profile,
        asrRequestId: `${unit.id}:${profile.profile}:${transcribed.cacheKey.slice(0, 16)}`,
        model: profile.adapter.model,
        coreML: profile.adapter.runtime?.coreML ?? false,
        vadEnabled: profile.vadEnabled,
        prompt: {
          confirmedNames: [...new Set(input.confirmedNames ?? [])],
          adjacentOriginalLanguageText: adjacentText,
          translatedReferenceUsedAsTarget: false,
        },
        cacheKey: transcribed.cacheKey,
        cacheHit: transcribed.cacheHit,
        text,
        canonicalCues,
        quality: hypothesisQuality,
        qualityFindingCount: candidateQuality.summary.needsRefinement,
        timingValid,
        decision,
      });
    }
    const decided = decideMissingDialogueRecoveryAttempts({
      attempts,
      speechCoverage,
      highBackgroundNoise: input.highBackgroundNoise ?? false,
      acousticallyCorroboratedSingleCandidate:
        unit.sceneLabel === "clean-dialogue" &&
        !unit.sourceReasons.includes("suspected-hallucination"),
    });
    const selected = attempts.find(
      (attempt) => attempt.id === decided.selectedAttemptId,
    );
    if (decided.decision === "recovered" && selected !== undefined) {
      recoveredCues.push(
        ...selected.canonicalCues.map((cue, index) => ({
          ...cue,
          id: `${unit.id}-recovered-${String(index + 1).padStart(3, "0")}`,
        })),
      );
    } else {
      input.logger.log(
        "warning",
        "Missing-dialogue recovery unit remains unresolved.",
        { unitId: unit.id, decision: decided.decision },
      );
    }
    completedUnits.push({
      ...unit,
      attempts,
      decision: decided.decision,
      selectedAttemptId: decided.selectedAttemptId,
      decisionReasons: decided.reasons,
    });
  }
  const countDecision = (
    decision: MissingDialogueRecoveryUnit["decision"],
  ): number =>
    completedUnits.filter((unit) => unit.decision === decision).length;
  const profileAttempts = {
    "current-sensitive-vad": 0,
    "extra-sensitive-vad": 0,
    "no-vad": 0,
  } satisfies Record<MissingDialogueRecoveryProfile, number>;
  for (const attempt of completedUnits.flatMap((unit) => unit.attempts)) {
    profileAttempts[attempt.profile] += 1;
  }
  const artifact: MissingDialogueRecoveryArtifact = {
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    maximumActualWavSeconds: 30,
    summary: {
      inputReviewGroups: new Set(
        completedUnits.map((unit) => unit.parentReviewGroupId),
      ).size,
      recoveryUnits: completedUnits.length,
      recoveredUnits: countDecision("recovered"),
      probableNonSpeechUnits: countDecision("probable-non-speech"),
      suspectedHallucinationUnits: countDecision("suspected-hallucination"),
      stillNeedsReviewUnits:
        countDecision("needs-human-review") +
        countDecision("suspected-hallucination"),
      autoCreatedFinalCues: recoveredCues.length,
      closedMissingDialogueReviews: new Set(
        completedUnits
          .filter((unit) =>
            ["recovered", "probable-non-speech"].includes(unit.decision),
          )
          .map((unit) => unit.parentReviewGroupId),
      ).size,
      recoveryAsrRequests: asrRequests,
      cacheHits,
      profileAttempts,
    },
    units: completedUnits,
  };
  return { artifact, recoveredCues, cacheHits, asrRequests };
}

function reviewMarker(input: {
  id: string;
  interval: Interval;
  reasons: string[];
  classification: "ambiguous-speech" | "suspected-hallucination";
}): TranscriptionQuality["segments"][number] {
  return {
    id: input.id,
    cueId: null,
    interval: {
      start: input.interval.start,
      end: input.interval.end,
    },
    text: "",
    status: "needs-human-review",
    classification: input.classification,
    signals: {
      confidence: "unavailable",
      lowTokenProbability: null,
      averageLogProbabilityLow: null,
      noSpeechConflict: false,
      decoderFallback: null,
      highEntropy: null,
      repeatedPhrase: false,
      repeatedCharacters: false,
      hallucinationPattern: input.classification === "suspected-hallucination",
      vadSpeechButEmpty: true,
      speechTextMismatch: true,
      charactersPerSecond: null,
      charactersPerSecondStatus: "unknown",
      languageConflict: false,
      referenceConflict: null,
      timestampAnomaly: false,
      timestampAnomalyScore: 80,
      timestampAnomalyBand: "mandatory-refine",
      timestampAnomalyReasons: input.reasons,
      overlapAnomaly: false,
      continuityConcern: false,
      vadNoVadConflict: false,
      largeV3Conflict: false,
      highBackgroundNoise: input.classification === "suspected-hallucination",
      stableConsensus: false,
    },
    reasons: input.reasons,
    refinementRounds: 0,
  };
}

export function rebuildQualityAfterMissingDialogueRecovery(input: {
  previousQuality: TranscriptionQuality;
  cues: readonly SubtitleCue[];
  speechIntervals: readonly Interval[];
  expectedLanguages: readonly LanguageTag[];
  recovery: MissingDialogueRecoveryArtifact;
}): TranscriptionQuality {
  const evaluated = evaluateTranscriptionQuality({
    cues: input.cues,
    speechIntervals: input.speechIntervals,
    expectedLanguages: input.expectedLanguages,
  });
  const recoveryIntervals = input.recovery.units.map((unit) => unit.interval);
  const preservedReviews = input.previousQuality.needsHumanReviewIntervals
    .filter(
      (review) =>
        !recoveryIntervals.some(
          (interval) =>
            overlapSeconds(review, interval) /
              Math.max(0.001, review.end - review.start) >=
            0.8,
        ),
    )
    .map((review, index) =>
      reviewMarker({
        id: `preserved-review-${String(index + 1).padStart(4, "0")}`,
        interval: review,
        reasons: review.reasons,
        classification: "ambiguous-speech",
      }),
    );
  const recoveryReviews = input.recovery.units.flatMap((unit, index) =>
    unit.decision === "needs-human-review" ||
    unit.decision === "suspected-hallucination"
      ? [
          reviewMarker({
            id: `recovery-review-${String(index + 1).padStart(4, "0")}`,
            interval: unit.interval,
            reasons: [
              "missing-dialogue-recovery-unresolved",
              ...unit.decisionReasons,
            ],
            classification:
              unit.decision === "suspected-hallucination"
                ? "suspected-hallucination"
                : "ambiguous-speech",
          }),
        ]
      : [],
  );
  const segments = [
    ...evaluated.segments,
    ...preservedReviews,
    ...recoveryReviews,
  ];
  const needsHumanReviewIntervals = [...preservedReviews, ...recoveryReviews]
    .map((segment) => ({
      ...segment.interval,
      reasons: segment.reasons,
    }))
    .toSorted((left, right) => left.start - right.start);
  return finalizeQualityWithoutRefinement(
    transcriptionQualitySchema.parse({
      ...evaluated,
      segments,
      summary: {
        ...evaluated.summary,
        vadNoVadConflicts: input.previousQuality.summary.vadNoVadConflicts,
        resolvedByLargeV3: input.previousQuality.summary.resolvedByLargeV3,
        autoResolvedVad: input.previousQuality.summary.autoResolvedVad,
        autoResolvedNoVad: input.previousQuality.summary.autoResolvedNoVad,
        autoResolvedLargeV3: input.previousQuality.summary.autoResolvedLargeV3,
        rejectedVadHallucinations:
          input.previousQuality.summary.rejectedVadHallucinations,
        rejectedNoVadHallucinations:
          input.previousQuality.summary.rejectedNoVadHallucinations,
        trueUnresolvedConflicts:
          input.previousQuality.summary.trueUnresolvedConflicts,
        needsHumanReview: needsHumanReviewIntervals.length,
      },
      needsHumanReviewCount: needsHumanReviewIntervals.length,
      needsHumanReviewIntervals,
    }),
  );
}
