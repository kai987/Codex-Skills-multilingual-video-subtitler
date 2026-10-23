import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  pathExists,
  readJson,
  type LanguageTag,
  type Logger,
  type ProcessRunner,
  type SubtitleCue,
} from "@mvl/shared";

import {
  canonicalizeAsrSegments,
  canonicalUtterancesToCues,
  rawEvidenceFromResult,
} from "./canonical.js";
import {
  evaluateFinalSubtitleIntegrity,
  evaluateLyricsRepetition,
  type VocalRegion,
} from "./integrity.js";
import { compareTranscripts, evaluateHypothesisQuality } from "./quality.js";
import type {
  MissingDialogueRecoveryArtifact,
  MissingDialogueRecoveryUnit,
} from "./recovery.js";
import type {
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

const MINIMUM_SCENE_LYRICS_REGION_SECONDS = 15;

export type LyricsTranscriptionProfile =
  "phrase-window-15" | "context-window-25" | "offset-window-20";

export interface LyricsTranscriptionAttempt {
  id: string;
  profile: LyricsTranscriptionProfile;
  interval: Interval;
  asrRequestId: string;
  model: string;
  coreML: boolean;
  vadEnabled: false;
  promptMode: "prompt-free";
  cacheKey: string;
  cacheHit: boolean;
  text: string;
  canonicalCues: SubtitleCue[];
  quality: ReturnType<typeof evaluateHypothesisQuality>;
}

export interface LyricsRegionResult {
  region: VocalRegion;
  attempts: LyricsTranscriptionAttempt[];
  decision: "lyrics-accepted" | "missing-lyrics";
  acceptedMusicCues: SubtitleCue[];
  supportedCueIds: string[];
  independentSupportProfiles: LyricsTranscriptionProfile[];
  reasons: string[];
}

export interface LyricsTranscriptionArtifact {
  schemaVersion: "1.0.0";
  generatedAt: string;
  maximumWindowSeconds: number;
  summary: {
    detectedSongRegions: number;
    lyricsAcceptedRegions: number;
    missingLyricsRegions: number;
    musicCueCount: number;
    lyricsAsrRequests: number;
    cacheHits: number;
  };
  regions: LyricsRegionResult[];
}

function overlapSeconds(left: Interval, right: Interval): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function groupContiguousUnits(
  units: readonly MissingDialogueRecoveryUnit[],
  maximumGapSeconds = 1.5,
): MissingDialogueRecoveryUnit[][] {
  const groups: MissingDialogueRecoveryUnit[][] = [];
  for (const unit of [...units].toSorted(
    (left, right) =>
      left.interval.start - right.interval.start ||
      left.interval.end - right.interval.end,
  )) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    if (
      current !== undefined &&
      previous !== undefined &&
      unit.interval.start - previous.interval.end <= maximumGapSeconds
    ) {
      current.push(unit);
    } else {
      groups.push([unit]);
    }
  }
  return groups;
}

function noVadVocalCandidates(
  units: readonly MissingDialogueRecoveryUnit[],
): LyricsTranscriptionAttempt["text"][] {
  return units.flatMap((unit) =>
    unit.attempts.flatMap((attempt) =>
      attempt.profile === "no-vad" &&
      attempt.text.trim() !== "" &&
      attempt.text.normalize("NFKC").replace(/\s/gu, "").length >= 12
        ? [attempt.text]
        : [],
    ),
  );
}

export function detectSongRegions(input: {
  recovery: MissingDialogueRecoveryArtifact;
  speechIntervals: readonly Interval[];
  mediaDurationSeconds: number;
  musicHeavy?: boolean | undefined;
  acousticScenes?: readonly AcousticSceneSegment[] | undefined;
}): VocalRegion[] {
  const unresolved = input.recovery.units.filter((unit) =>
    ["needs-human-review", "suspected-hallucination"].includes(unit.decision),
  );
  const recoveryRegions: VocalRegion[] = groupContiguousUnits(
    unresolved,
  ).flatMap((units, index) => {
    const first = units[0];
    const last = units.at(-1);
    if (first === undefined || last === undefined) return [];
    const interval = {
      start: first.interval.start,
      end: last.interval.end,
    };
    const duration = interval.end - interval.start;
    const noVadCandidates = noVadVocalCandidates(units);
    const dialogueVadNonEmpty = units.flatMap((unit) =>
      unit.attempts.filter(
        (attempt) => attempt.profile !== "no-vad" && attempt.text.trim() !== "",
      ),
    ).length;
    const speechSeconds = input.speechIntervals.reduce(
      (total, speech) => total + overlapSeconds(interval, speech),
      0,
    );
    const speechCoverage = speechSeconds / Math.max(0.001, duration);
    const earlyProgrammeRegion =
      interval.start <= input.mediaDurationSeconds * 0.35;
    const likelySong =
      duration >= 30 &&
      noVadCandidates.length >= 2 &&
      dialogueVadNonEmpty === 0 &&
      speechCoverage >= 0.5 &&
      (earlyProgrammeRegion || input.musicHeavy === true);
    if (!likelySong) return [];
    const confidence = Math.min(
      0.95,
      0.7 +
        Math.min(0.15, noVadCandidates.length * 0.05) +
        (speechCoverage >= 0.8 ? 0.05 : 0),
    );
    return [
      {
        id: `vocal-region-${String(index + 1).padStart(4, "0")}`,
        interval,
        type: "music-with-possible-vocals" as const,
        vocalEvidence: true,
        vocalEvidenceConfidence: confidence,
        reasons: [
          "long-continuous-vocal-like-region",
          "dialogue-vad-mostly-empty",
          "multiple-no-vad-lyric-like-candidates",
          ...(earlyProgrammeRegion ? ["opening-position"] : []),
        ],
        sourceRecoveryUnitIds: units.map((unit) => unit.id),
      },
    ];
  });
  const sceneRegions: VocalRegion[] = (input.acousticScenes ?? []).flatMap(
    (scene, index) => {
      const duration = scene.interval.end - scene.interval.start;
      if (
        scene.label !== "singing" ||
        duration < MINIMUM_SCENE_LYRICS_REGION_SECONDS ||
        scene.probabilities.vocal < 0.6 ||
        scene.probabilities.music < 0.6
      ) {
        return [];
      }
      return [
        {
          id: `scene-vocal-region-${String(index + 1).padStart(4, "0")}`,
          interval: scene.interval,
          type: "music-with-possible-vocals" as const,
          vocalEvidence: true,
          vocalEvidenceConfidence: Math.min(
            0.95,
            Math.max(
              scene.confidence,
              Math.min(scene.probabilities.vocal, scene.probabilities.music),
            ),
          ),
          reasons: [
            "scene-label-singing",
            "scene-music-probability-supported",
            "scene-vocal-probability-supported",
            "minimum-singing-duration-satisfied",
          ],
          sourceSceneIds: [scene.id],
        },
      ];
    },
  );
  const combined = [...recoveryRegions, ...sceneRegions].toSorted(
    (left, right) =>
      left.interval.start - right.interval.start ||
      left.interval.end - right.interval.end,
  );
  const merged: VocalRegion[] = [];
  for (const region of combined) {
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      region.interval.start <= previous.interval.end + 1.5
    ) {
      previous.interval.end = Math.max(
        previous.interval.end,
        region.interval.end,
      );
      previous.vocalEvidenceConfidence = Math.max(
        previous.vocalEvidenceConfidence,
        region.vocalEvidenceConfidence,
      );
      previous.reasons = [...new Set([...previous.reasons, ...region.reasons])];
      previous.sourceRecoveryUnitIds = [
        ...new Set([
          ...(previous.sourceRecoveryUnitIds ?? []),
          ...(region.sourceRecoveryUnitIds ?? []),
        ]),
      ];
      previous.sourceSceneIds = [
        ...new Set([
          ...(previous.sourceSceneIds ?? []),
          ...(region.sourceSceneIds ?? []),
        ]),
      ];
    } else {
      merged.push({
        ...region,
        interval: { ...region.interval },
        reasons: [...region.reasons],
      });
    }
  }
  return merged.map((region, index) => ({
    ...region,
    id: `vocal-region-${String(index + 1).padStart(4, "0")}`,
  }));
}

function windowsForProfile(
  region: VocalRegion,
  profile: LyricsTranscriptionProfile,
): Interval[] {
  const duration =
    profile === "phrase-window-15"
      ? 15
      : profile === "context-window-25"
        ? 25
        : 20;
  const step =
    profile === "phrase-window-15"
      ? 15
      : profile === "context-window-25"
        ? 20
        : 20;
  const offset = profile === "offset-window-20" ? 7.5 : 0;
  const windows: Interval[] = [];
  let start = Math.min(region.interval.end, region.interval.start + offset);
  if (offset > 0 && start > region.interval.start) {
    windows.push({
      start: region.interval.start,
      end: Math.min(region.interval.end, region.interval.start + duration),
    });
  }
  while (start < region.interval.end) {
    windows.push({
      start,
      end: Math.min(region.interval.end, start + duration),
    });
    start += step;
  }
  return windows.filter((window) => window.end - window.start >= 3);
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

async function extractLyricsAudio(input: {
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

function lyricsCacheKey(input: {
  chunk: AudioChunk;
  adapter: TranscriptionAdapter;
  profile: LyricsTranscriptionProfile;
  interval: Interval;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        audioHash: input.chunk.sha256,
        globalInterval: input.interval,
        modelHash: input.adapter.runtime?.modelHash ?? input.adapter.model,
        coreML: input.adapter.runtime?.coreML ?? false,
        profile: input.profile,
        promptMode: "prompt-free",
        vad: false,
        timestampMode: "segment+token",
        whisperCppVersion:
          input.adapter.runtime?.whisperCppVersion ?? "unknown",
      }),
    )
    .digest("hex");
}

async function transcribeLyricsWindow(input: {
  audioPath: string;
  chunk: AudioChunk;
  interval: Interval;
  adapter: TranscriptionAdapter;
  profile: LyricsTranscriptionProfile;
  cacheDirectory: string;
  language?: LanguageTag | undefined;
  asrCache?: PortableAsrCache | undefined;
  requestId: string;
}): Promise<{
  result: TranscriptionChunkResult;
  cacheKey: string;
  cacheHit: boolean;
}> {
  const cacheKey = lyricsCacheKey(input);
  const cachePath = path.join(input.cacheDirectory, `lyrics-${cacheKey}.json`);
  const identity = buildPortableAsrCacheIdentityV2({
    audioContentSha256: input.chunk.sha256,
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
    vadMode: "lyrics-no-vad",
    timestampStrategy: "segment",
    tokenTimestamps: true,
    prompt: "",
    decodeConfiguration: {
      language: input.language ?? null,
      lyricsProfile: input.profile,
      tokenTimestamps: true,
    },
  });
  const portable = await input.asrCache?.lookup({
    requestId: input.requestId,
    requestType: "lyrics",
    identity,
    legacyKeys: [cacheKey],
  });
  if (portable?.hit === true && portable.result !== null) {
    return { result: portable.result, cacheKey, cacheHit: true };
  }
  if (await pathExists(cachePath)) {
    const result = portableTranscriptionChunkResultSchema.parse(
      await readJson(cachePath),
    );
    await input.asrCache?.store({
      requestId: input.requestId,
      requestType: "lyrics",
      identity,
      legacyKeys: [cacheKey],
      result,
    });
    return {
      result,
      cacheKey,
      cacheHit: true,
    };
  }
  const result = await input.adapter.transcribe({
    audioPath: input.audioPath,
    chunk: {
      ...input.chunk,
      start: 0,
      end: input.chunk.duration,
    },
    timestampStrategy: "segment",
    tokenTimestamps: true,
    ...(input.language === undefined ? {} : { language: input.language }),
  });
  await atomicWriteJson(cachePath, result);
  await input.asrCache?.store({
    requestId: input.requestId,
    requestType: "lyrics",
    identity,
    legacyKeys: [cacheKey],
    result,
  });
  return { result, cacheKey, cacheHit: false };
}

function selectSupportedLyrics(input: {
  region: VocalRegion;
  attempts: readonly LyricsTranscriptionAttempt[];
}): {
  cues: SubtitleCue[];
  cueIds: string[];
  profiles: LyricsTranscriptionProfile[];
  rejectedReasons: string[];
} {
  const supported: {
    cue: SubtitleCue;
    profiles: LyricsTranscriptionProfile[];
  }[] = [];
  const rejectedReasons = new Set<string>();
  for (let leftIndex = 0; leftIndex < input.attempts.length; leftIndex += 1) {
    const left = input.attempts[leftIndex];
    if (left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < input.attempts.length;
      rightIndex += 1
    ) {
      const right = input.attempts[rightIndex];
      if (right === undefined || right.profile === left.profile) continue;
      if (!lyricsWindowsAreIndependent(left.interval, right.interval)) {
        rejectedReasons.add(
          "identical-audio-is-not-independent-window-support",
        );
        continue;
      }
      if (left.quality.hardReject || right.quality.hardReject) {
        rejectedReasons.add("lyrics-candidate-failed-quality-hard-reject");
        continue;
      }
      for (const leftCue of left.canonicalCues) {
        for (const rightCue of right.canonicalCues) {
          if (
            !isPlausibleLyricsCandidate(leftCue.text) ||
            !isPlausibleLyricsCandidate(rightCue.text)
          ) {
            rejectedReasons.add(
              "lyrics-candidate-empty-short-or-boilerplate-hallucination",
            );
            continue;
          }
          const overlap = overlapSeconds(leftCue, rightCue);
          if (
            overlap /
              Math.max(
                0.001,
                Math.min(
                  leftCue.end - leftCue.start,
                  rightCue.end - rightCue.start,
                ),
              ) <
            0.4
          ) {
            continue;
          }
          if (
            compareTranscripts({
              baselineText: leftCue.text,
              refinementText: rightCue.text,
            }).similarity < 0.75
          ) {
            continue;
          }
          const selected =
            (leftCue.transcriptionMetrics?.averageLogProbability ??
              Number.NEGATIVE_INFINITY) >=
            (rightCue.transcriptionMetrics?.averageLogProbability ??
              Number.NEGATIVE_INFINITY)
              ? leftCue
              : rightCue;
          supported.push({
            cue: {
              ...selected,
              start: Math.max(leftCue.start, rightCue.start),
              end: Math.min(leftCue.end, rightCue.end),
              style: "music",
            },
            profiles: [left.profile, right.profile],
          });
        }
      }
    }
  }
  const deduplicated: typeof supported = [];
  for (const candidate of supported.toSorted(
    (left, right) =>
      left.cue.start - right.cue.start || left.cue.end - right.cue.end,
  )) {
    const duplicate = deduplicated.some(
      (accepted) =>
        overlapSeconds(accepted.cue, candidate.cue) > 0 &&
        compareTranscripts({
          baselineText: accepted.cue.text,
          refinementText: candidate.cue.text,
        }).similarity >= 0.9,
    );
    if (!duplicate) deduplicated.push(candidate);
  }
  const cues = deduplicated
    .map((candidate, index) => ({
      ...candidate.cue,
      id: `${input.region.id}-lyrics-${String(index + 1).padStart(3, "0")}`,
    }))
    .filter((cue) => cue.end > cue.start);
  return {
    cues,
    cueIds: cues.map((cue) => cue.id),
    profiles: [
      ...new Set(deduplicated.flatMap((candidate) => candidate.profiles)),
    ],
    rejectedReasons: [...rejectedReasons],
  };
}

export function lyricsWindowsAreIndependent(
  left: Interval,
  right: Interval,
): boolean {
  return (
    Math.abs(left.start - right.start) + Math.abs(left.end - right.end) >= 1
  );
}

export function isPlausibleLyricsCandidate(text: string): boolean {
  const normalized = text.normalize("NFKC").toLocaleLowerCase().trim();
  const lexicalCharacters = Array.from(normalized).filter((character) =>
    /[\p{L}\p{N}]/u.test(character),
  );
  if (lexicalCharacters.length < 6) return false;
  return !(
    /\b(?:subscribe|subtitles? by|thanks? for watching|thank you for watching|the end)\b/iu.test(
      normalized,
    ) ||
    /(?:ご視聴ありがとうございました|ご覧いただきありがとうございました|チャンネル登録)/u.test(
      normalized,
    ) ||
    /(?:感谢|谢谢).{0,8}(?:观看|收看)|订阅.{0,8}频道/u.test(normalized) ||
    /시청.{0,8}감사|구독.{0,8}(?:부탁|감사)/u.test(normalized)
  );
}

export async function runLyricsTranscription(input: {
  mediaPath: string;
  audioStreamIndex: number;
  outputDirectory: string;
  regions: readonly VocalRegion[];
  adapter: TranscriptionAdapter;
  runner: ProcessRunner;
  logger: Logger;
  ffmpegPath: string;
  language?: LanguageTag | undefined;
  generatedAt?: string | undefined;
  asrCache?: PortableAsrCache | undefined;
}): Promise<{
  artifact: LyricsTranscriptionArtifact;
  musicCues: SubtitleCue[];
  supportedCueIds: string[];
  asrRequests: number;
  cacheHits: number;
}> {
  const audioDirectory = path.join(
    input.outputDirectory,
    "audio",
    "lyrics-transcription",
  );
  const cacheDirectory = path.join(
    input.outputDirectory,
    "audio",
    "transcription-cache",
  );
  await Promise.all([
    mkdir(audioDirectory, { recursive: true }),
    mkdir(cacheDirectory, { recursive: true }),
  ]);
  const results: LyricsRegionResult[] = [];
  let asrRequests = 0;
  let cacheHits = 0;
  for (const region of input.regions) {
    const attempts: LyricsTranscriptionAttempt[] = [];
    for (const profile of [
      "phrase-window-15",
      "context-window-25",
      "offset-window-20",
    ] as const) {
      const windows = windowsForProfile(region, profile);
      for (const [windowIndex, interval] of windows.entries()) {
        const attemptId = `${region.id}-${profile}-${String(windowIndex + 1).padStart(3, "0")}`;
        const audioPath = path.join(audioDirectory, `${attemptId}.wav`);
        const chunk = await extractLyricsAudio({
          mediaPath: input.mediaPath,
          audioStreamIndex: input.audioStreamIndex,
          interval,
          outputPath: audioPath,
          runner: input.runner,
          ffmpegPath: input.ffmpegPath,
        });
        const transcribed = await transcribeLyricsWindow({
          audioPath,
          chunk,
          interval,
          adapter: input.adapter,
          profile,
          cacheDirectory,
          requestId: attemptId,
          ...(input.asrCache === undefined ? {} : { asrCache: input.asrCache }),
          ...(input.language === undefined ? {} : { language: input.language }),
        });
        if (transcribed.cacheHit) cacheHits += 1;
        else asrRequests += 1;
        const raw = rawEvidenceFromResult({
          result: transcribed.result,
          adapterId: input.adapter.id,
          chunkId: attemptId,
          globalStart: interval.start,
          ...(input.language === undefined ? {} : { language: input.language }),
        }).map((segment) => ({ ...segment, style: "music" as const }));
        const canonical = canonicalizeAsrSegments({
          segments: raw,
          speechIntervals: [interval],
        });
        const canonicalCues = canonicalUtterancesToCues(canonical, {
          includeSuspectedHallucinations: true,
        })
          .map((cue, cueIndex) => ({
            ...cue,
            id: `${attemptId}-cue-${String(cueIndex + 1).padStart(3, "0")}`,
            start: Math.max(interval.start, cue.start),
            end: Math.min(interval.end, cue.end),
            style: "music" as const,
          }))
          .filter((cue) => cue.end > cue.start);
        const text = canonicalCues.map((cue) => cue.text).join(" ");
        attempts.push({
          id: attemptId,
          profile,
          interval,
          asrRequestId: `${attemptId}:${transcribed.cacheKey.slice(0, 16)}`,
          model: input.adapter.model,
          coreML: input.adapter.runtime?.coreML ?? false,
          vadEnabled: false,
          promptMode: "prompt-free",
          cacheKey: transcribed.cacheKey,
          cacheHit: transcribed.cacheHit,
          text,
          canonicalCues,
          quality: evaluateHypothesisQuality({
            text,
            cues: canonicalCues,
            interval,
            detectedSpeech: region.vocalEvidence,
            expectedLanguages:
              input.language === undefined ? [] : [input.language],
          }),
        });
      }
    }
    const supported = selectSupportedLyrics({ region, attempts });
    const chorus = evaluateLyricsRepetition({
      cues: supported.cues,
      vocalEvidenceConfidence: region.vocalEvidenceConfidence,
      independentWindowSupportCount: supported.profiles.length,
    });
    const integrity = evaluateFinalSubtitleIntegrity({
      cues: supported.cues,
      vocalRegions: [region],
      supportedLyricsCueIds: supported.cueIds,
    });
    const coverage =
      integrity.vocalRegions.find((candidate) => candidate.id === region.id)
        ?.coverageRatio ?? 0;
    const accepted =
      supported.cues.length > 0 &&
      coverage >= 0.4 &&
      (!chorus.hallucinationRisk || chorus.supportedChorus);
    if (!accepted) {
      input.logger.log(
        "warning",
        "Song region has vocal evidence but no stable multi-window lyrics.",
        { regionId: region.id, coverageRatio: coverage },
      );
    }
    results.push({
      region,
      attempts,
      decision: accepted ? "lyrics-accepted" : "missing-lyrics",
      acceptedMusicCues: accepted ? supported.cues : [],
      supportedCueIds: accepted ? supported.cueIds : [],
      independentSupportProfiles: supported.profiles,
      reasons: accepted
        ? [
            "independent-window-consensus",
            "vocal-evidence-supported",
            "lyrics-coverage-sufficient",
          ]
        : [
            "no-stable-independent-window-consensus",
            ...supported.rejectedReasons,
            "explicit-missing-lyrics-review-required",
          ],
    });
  }
  const musicCues = results.flatMap((region) => region.acceptedMusicCues);
  const supportedCueIds = results.flatMap((region) => region.supportedCueIds);
  const artifact: LyricsTranscriptionArtifact = {
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    maximumWindowSeconds: 25,
    summary: {
      detectedSongRegions: results.length,
      lyricsAcceptedRegions: results.filter(
        (region) => region.decision === "lyrics-accepted",
      ).length,
      missingLyricsRegions: results.filter(
        (region) => region.decision === "missing-lyrics",
      ).length,
      musicCueCount: musicCues.length,
      lyricsAsrRequests: asrRequests,
      cacheHits,
    },
    regions: results,
  };
  return { artifact, musicCues, supportedCueIds, asrRequests, cacheHits };
}
