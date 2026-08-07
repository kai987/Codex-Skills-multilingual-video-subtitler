import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  acousticSceneWindowsArtifactSchema,
  acousticScenesArtifactSchema,
  atomicWriteJson,
  pathExists,
  readJson,
  type ProcessRunner,
} from "@mvl/shared";

import { routeSceneToAsrStrategy } from "./scene-routing.js";
import type {
  AcousticEventClassifier,
  AcousticEventClassifierInput,
  AcousticSceneAnalysisConfig,
  AcousticSceneFeatures,
  AcousticSceneLabel,
  AcousticSceneProbabilities,
  AcousticSceneSegment,
  AcousticSceneWindow,
  AcousticSceneWindowsArtifact,
  AcousticScenesArtifact,
  TranscriptionInterval,
} from "./types.js";

export const ACOUSTIC_SCENE_ANALYSIS_VERSION = "acoustic-scenes-v5";
export const DEFAULT_ACOUSTIC_SCENE_CONFIG: Readonly<AcousticSceneAnalysisConfig> =
  {
    sceneWindowSeconds: 3,
    sceneHopSeconds: 1,
    sceneMinimumDurationSeconds: 2,
    sceneConfidenceThreshold: 0.75,
    nonSpeechSkipConfidence: 0.97,
  };

const ANALYSIS_SAMPLE_RATE = 8_000;
const SPECTRAL_SAMPLE_COUNT = 256;
const SPECTRAL_BIN_COUNT = 48;
const SPECTRAL_COSINE_BASIS = Array.from(
  { length: SPECTRAL_BIN_COUNT },
  (_, bin) =>
    Float64Array.from({ length: SPECTRAL_SAMPLE_COUNT }, (_unused, sample) =>
      Math.cos((2 * Math.PI * (bin + 1) * sample) / SPECTRAL_SAMPLE_COUNT),
    ),
);
const SPECTRAL_SINE_BASIS = Array.from(
  { length: SPECTRAL_BIN_COUNT },
  (_, bin) =>
    Float64Array.from({ length: SPECTRAL_SAMPLE_COUNT }, (_unused, sample) =>
      Math.sin((2 * Math.PI * (bin + 1) * sample) / SPECTRAL_SAMPLE_COUNT),
    ),
);

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rounded(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function overlapSeconds(
  left: TranscriptionInterval,
  right: TranscriptionInterval,
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function averageProbabilities(
  probabilities: readonly AcousticSceneProbabilities[],
): AcousticSceneProbabilities {
  return {
    speech: rounded(average(probabilities.map((item) => item.speech))),
    vocal: rounded(average(probabilities.map((item) => item.vocal))),
    music: rounded(average(probabilities.map((item) => item.music))),
    drums: rounded(average(probabilities.map((item) => item.drums))),
    crowd: rounded(average(probabilities.map((item) => item.crowd))),
    overlap: rounded(average(probabilities.map((item) => item.overlap))),
    silence: rounded(average(probabilities.map((item) => item.silence))),
  };
}

function rmsDb(samples: Int16Array): number | null {
  if (samples.length === 0) return null;
  let squares = 0;
  for (const sample of samples) {
    const normalized = sample / 32_768;
    squares += normalized * normalized;
  }
  const rms = Math.sqrt(squares / samples.length);
  return rms <= 1e-9 ? -120 : 20 * Math.log10(rms);
}

function zeroCrossingRate(samples: Int16Array): number | null {
  if (samples.length < 2) return null;
  let crossings = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1] ?? 0;
    const current = samples[index] ?? 0;
    if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0)) {
      crossings += 1;
    }
  }
  return crossings / (samples.length - 1);
}

function frameSilenceRatio(samples: Int16Array, sampleRate: number): number {
  if (samples.length === 0) return 1;
  const frameSamples = Math.max(1, Math.round(sampleRate * 0.02));
  let silentFrames = 0;
  let frameCount = 0;
  for (let start = 0; start < samples.length; start += frameSamples) {
    const end = Math.min(samples.length, start + frameSamples);
    let squares = 0;
    for (let index = start; index < end; index += 1) {
      const normalized = (samples[index] ?? 0) / 32_768;
      squares += normalized * normalized;
    }
    const rms = Math.sqrt(squares / Math.max(1, end - start));
    const db = rms <= 1e-9 ? -120 : 20 * Math.log10(rms);
    if (db <= -45) silentFrames += 1;
    frameCount += 1;
  }
  return silentFrames / Math.max(1, frameCount);
}

function spectralMagnitudes(samples: Int16Array): Float64Array {
  const selected = new Float64Array(SPECTRAL_SAMPLE_COUNT);
  for (let index = 0; index < SPECTRAL_SAMPLE_COUNT; index += 1) {
    const sourceIndex = Math.min(
      samples.length - 1,
      Math.floor((index / SPECTRAL_SAMPLE_COUNT) * samples.length),
    );
    selected[index] =
      sourceIndex < 0 ? 0 : (samples[sourceIndex] ?? 0) / 32_768;
  }
  const magnitudes = new Float64Array(SPECTRAL_BIN_COUNT);
  for (let bin = 0; bin < SPECTRAL_BIN_COUNT; bin += 1) {
    const cosine = SPECTRAL_COSINE_BASIS[bin];
    const sine = SPECTRAL_SINE_BASIS[bin];
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < SPECTRAL_SAMPLE_COUNT; index += 1) {
      const value = selected[index] ?? 0;
      real += value * (cosine?.[index] ?? 0);
      imaginary -= value * (sine?.[index] ?? 0);
    }
    magnitudes[bin] = Math.max(
      1e-12,
      Math.sqrt(real * real + imaginary * imaginary),
    );
  }
  return magnitudes;
}

function spectralFlatness(magnitudes: Float64Array): number | null {
  if (magnitudes.length === 0) return null;
  const arithmetic =
    [...magnitudes].reduce((total, value) => total + value, 0) /
    magnitudes.length;
  if (arithmetic <= 1e-12) return 1;
  const geometric = Math.exp(
    [...magnitudes].reduce(
      (total, value) => total + Math.log(Math.max(1e-12, value)),
      0,
    ) / magnitudes.length,
  );
  return clamp(geometric / arithmetic);
}

function spectralFlux(
  current: Float64Array,
  previous: Float64Array | undefined,
): number | null {
  if (previous === undefined || current.length === 0) return 0;
  const currentTotal = [...current].reduce((total, value) => total + value, 0);
  const previousTotal = [...previous].reduce(
    (total, value) => total + value,
    0,
  );
  let positiveDifference = 0;
  for (let index = 0; index < current.length; index += 1) {
    const currentNormalized =
      (current[index] ?? 0) / Math.max(1e-12, currentTotal);
    const previousNormalized =
      (previous[index] ?? 0) / Math.max(1e-12, previousTotal);
    positiveDifference += Math.max(0, currentNormalized - previousNormalized);
  }
  return clamp(positiveDifference * 2);
}

function snrDb(samples: Int16Array): number | null {
  if (samples.length === 0) return null;
  const absolute = [...samples]
    .map((sample) => Math.abs(sample / 32_768))
    .toSorted((left, right) => left - right);
  const noiseCount = Math.max(1, Math.floor(absolute.length * 0.2));
  const noiseRms = Math.sqrt(
    absolute
      .slice(0, noiseCount)
      .reduce((total, value) => total + value * value, 0) / noiseCount,
  );
  const signalRms = Math.sqrt(
    absolute.reduce((total, value) => total + value * value, 0) /
      absolute.length,
  );
  if (signalRms <= 1e-9) return 0;
  return Math.min(
    60,
    Math.max(0, 20 * Math.log10(signalRms / Math.max(1e-6, noiseRms))),
  );
}

function probabilitiesFromFeatures(
  features: AcousticSceneFeatures,
  interval: TranscriptionInterval,
  mediaDurationSeconds: number,
): AcousticSceneProbabilities {
  const energy = clamp(((features.rmsDb ?? -60) + 55) / 45);
  const flatness = clamp(features.spectralFlatness ?? 0.5);
  const flux = clamp(features.spectralFlux ?? 0);
  const rawZcr = clamp(features.zeroCrossingRate ?? 0);
  const zcr = clamp(rawZcr / 0.3);
  const snr = clamp((features.snrDb ?? 0) / 35);
  const activity = clamp(features.speechActivityRatio);
  const silence = clamp(Math.max(features.silenceRatio, (1 - energy) * 0.9));
  const speechShape = clamp(1 - Math.abs(zcr - 0.38) / 0.5);
  const speech = clamp(
    activity * 0.55 + energy * 0.2 + speechShape * 0.15 + snr * 0.1,
  );
  const vocal = clamp(
    speech * 0.58 + activity * 0.2 + (1 - silence) * 0.12 + snr * 0.1,
  );
  const tonal = clamp((0.24 - rawZcr) / 0.14);
  const quietTransient = clamp(-((features.rmsDb ?? -28) + 28) / 12);
  const music = clamp(
    tonal * 0.5 +
      energy * 0.15 +
      (1 - silence) * 0.2 +
      (1 - Math.min(1, flux)) * 0.05 +
      (interval.start <= mediaDurationSeconds * 0.3 ? 0.1 : 0),
  );
  const drums = clamp(
    flux * 0.35 + zcr * 0.25 + quietTransient * 0.3 + activity * 0.1,
  );
  const crowd = clamp(
    flatness * 0.15 +
      speech * 0.15 +
      (1 - snr) * 0.25 +
      flux * 0.1 +
      zcr * 0.15,
  );
  const overlap = clamp(crowd * 0.35 + speech * 0.25 + flux * 0.15);
  return {
    speech: rounded(speech),
    vocal: rounded(vocal),
    music: rounded(music),
    drums: rounded(drums),
    crowd: rounded(crowd),
    overlap: rounded(overlap),
    silence: rounded(silence),
  };
}

export class HeuristicAcousticEventClassifier implements AcousticEventClassifier {
  readonly id = "existing-evidence-heuristic";
  readonly version = "1.2.0";

  classifyWindow(
    input: AcousticEventClassifierInput,
  ): Promise<AcousticSceneProbabilities> {
    return Promise.resolve(
      probabilitiesFromFeatures(
        input.features,
        input.interval,
        input.mediaDurationSeconds,
      ),
    );
  }
}

export function classifyAcousticSceneWindow(input: {
  interval: TranscriptionInterval;
  mediaDurationSeconds: number;
  probabilities: AcousticSceneProbabilities;
  features: AcousticSceneFeatures;
  config?: Partial<AcousticSceneAnalysisConfig> | undefined;
}): {
  label: AcousticSceneLabel;
  confidence: number;
  evidence: string[];
} {
  const probabilities = input.probabilities;
  const noise = Math.max(
    probabilities.music,
    probabilities.drums,
    probabilities.crowd,
    probabilities.overlap,
  );
  const earlyProgramme =
    input.interval.start <= input.mediaDurationSeconds * 0.3;
  const openingSongShape =
    earlyProgramme &&
    probabilities.vocal >= 0.7 &&
    probabilities.music >= 0.38 &&
    (input.features.zeroCrossingRate ?? 1) <= 0.22 &&
    (input.features.snrDb ?? 60) <= 20 &&
    (input.features.rmsDb ?? -120) >= -31 &&
    input.features.silenceRatio <= 0.15;
  let label: AcousticSceneLabel = "unknown";
  let confidence: number;
  const evidence: string[] = [];
  if (
    probabilities.speech <= 0.18 &&
    probabilities.vocal <= 0.2 &&
    (probabilities.silence >= 0.7 || probabilities.music >= 0.78)
  ) {
    label = "non-speech";
    confidence = Math.min(
      0.99,
      average([
        1 - probabilities.speech,
        1 - probabilities.vocal,
        Math.max(probabilities.silence, probabilities.music),
      ]),
    );
    evidence.push(
      probabilities.silence >= probabilities.music
        ? "high-silence-low-vocal"
        : "instrumental-music-low-vocal",
    );
  } else if (
    probabilities.vocal >= 0.64 &&
    (probabilities.music >= 0.8 ||
      (probabilities.music >= 0.62 &&
        (input.features.zeroCrossingRate ?? 1) <= 0.2 &&
        input.features.silenceRatio <= 0.25) ||
      openingSongShape)
  ) {
    label = "singing";
    confidence = Math.min(
      0.97,
      openingSongShape
        ? average([
            probabilities.vocal,
            clamp(1 - (input.features.zeroCrossingRate ?? 0.3) / 0.3),
            1 - input.features.silenceRatio,
          ]) + 0.05
        : Math.min(probabilities.vocal, probabilities.music) +
            0.12 +
            (earlyProgramme ? 0.05 : 0),
    );
    evidence.push(
      "music-and-vocal-evidence",
      ...(earlyProgramme ? ["opening-or-early-programme-position"] : []),
    );
  } else if (
    probabilities.speech >= 0.45 &&
    probabilities.vocal >= 0.45 &&
    noise >= 0.58
  ) {
    label = "noisy-dialogue";
    confidence = Math.min(
      0.97,
      average([probabilities.speech, probabilities.vocal, noise]) + 0.08,
    );
    evidence.push(
      "speech-and-vocal-present",
      ...(probabilities.drums >= 0.55 ? ["drum-evidence"] : []),
      ...(probabilities.crowd >= 0.55 ? ["crowd-evidence"] : []),
      ...(probabilities.music >= 0.55 ? ["music-under-dialogue-evidence"] : []),
      ...(probabilities.overlap >= 0.55 ? ["overlapping-speech-evidence"] : []),
    );
  } else if (
    probabilities.vocal >= 0.35 &&
    probabilities.speech >= 0.28 &&
    (input.features.rmsDb ?? -120) <= -31
  ) {
    label = "quiet-dialogue";
    confidence = Math.min(
      0.94,
      average([
        probabilities.vocal,
        probabilities.speech,
        clamp((-(input.features.rmsDb ?? -31) - 25) / 20),
      ]) + 0.15,
    );
    evidence.push("low-rms-vocal-evidence", "quiet-dialogue-recall-risk");
  } else if (
    probabilities.speech >= 0.62 &&
    probabilities.vocal >= 0.58 &&
    noise < 0.58 &&
    probabilities.silence < 0.5
  ) {
    label = "clean-dialogue";
    confidence = Math.min(
      0.98,
      average([probabilities.speech, probabilities.vocal, 1 - noise]) + 0.15,
    );
    evidence.push("stable-speech-and-vocal", "low-background-event-evidence");
  } else {
    const strongest = Math.max(
      probabilities.speech,
      probabilities.vocal,
      probabilities.music,
      probabilities.drums,
      probabilities.crowd,
      probabilities.overlap,
      probabilities.silence,
    );
    confidence = Math.min(0.7, Math.max(0.35, strongest * 0.7));
    evidence.push("conflicting-or-insufficient-scene-evidence");
  }
  return {
    label,
    confidence: rounded(confidence),
    evidence,
  };
}

function windowIntervals(
  durationSeconds: number,
  windowSeconds: number,
  hopSeconds: number,
): TranscriptionInterval[] {
  if (durationSeconds <= 0) return [];
  const intervals: TranscriptionInterval[] = [];
  for (let start = 0; start < durationSeconds; start += hopSeconds) {
    intervals.push({
      start: rounded(start),
      end: rounded(Math.min(durationSeconds, start + windowSeconds)),
    });
  }
  return intervals;
}

export async function analyzeAcousticSceneWindows(input: {
  samples: Int16Array;
  sampleRate: number;
  mediaDurationSeconds: number;
  speechIntervals: readonly TranscriptionInterval[];
  classifier?: AcousticEventClassifier | undefined;
  config?: Partial<AcousticSceneAnalysisConfig> | undefined;
}): Promise<AcousticSceneWindow[]> {
  const config = {
    ...DEFAULT_ACOUSTIC_SCENE_CONFIG,
    ...input.config,
  };
  const classifier = input.classifier ?? new HeuristicAcousticEventClassifier();
  const intervals = windowIntervals(
    input.mediaDurationSeconds,
    config.sceneWindowSeconds,
    config.sceneHopSeconds,
  );
  const windows: AcousticSceneWindow[] = [];
  let previousSpectrum: Float64Array | undefined;
  for (const [index, interval] of intervals.entries()) {
    const startSample = Math.max(
      0,
      Math.floor(interval.start * input.sampleRate),
    );
    const endSample = Math.min(
      input.samples.length,
      Math.ceil(interval.end * input.sampleRate),
    );
    const samples = input.samples.subarray(startSample, endSample);
    const magnitudes = spectralMagnitudes(samples);
    const duration = Math.max(0.001, interval.end - interval.start);
    const speechActivityRatio = clamp(
      input.speechIntervals.reduce(
        (total, speech) => total + overlapSeconds(interval, speech),
        0,
      ) / duration,
    );
    const features: AcousticSceneFeatures = {
      rmsDb: rounded(rmsDb(samples) ?? -120),
      snrDb: rounded(snrDb(samples) ?? 0),
      spectralFlatness: rounded(spectralFlatness(magnitudes) ?? 1),
      spectralFlux: rounded(spectralFlux(magnitudes, previousSpectrum) ?? 0),
      zeroCrossingRate: rounded(zeroCrossingRate(samples) ?? 0),
      speechActivityRatio: rounded(speechActivityRatio),
      silenceRatio: rounded(frameSilenceRatio(samples, input.sampleRate)),
    };
    const probabilities = await classifier.classifyWindow({
      interval,
      features,
      mediaDurationSeconds: input.mediaDurationSeconds,
      ...(windows.at(-1) === undefined
        ? {}
        : { previousProbabilities: windows.at(-1)?.probabilities }),
    });
    const classification = classifyAcousticSceneWindow({
      interval,
      mediaDurationSeconds: input.mediaDurationSeconds,
      probabilities,
      features,
      config,
    });
    windows.push({
      id: `scene-window-${String(index + 1).padStart(5, "0")}`,
      interval,
      probabilities,
      features,
      proposedLabel: classification.label,
      smoothedLabel: classification.label,
      confidence: classification.confidence,
      evidence: classification.evidence,
    });
    previousSpectrum = magnitudes;
  }
  return windows;
}

function minimumDurationFor(
  label: AcousticSceneLabel,
  config: AcousticSceneAnalysisConfig,
): number {
  return label === "singing"
    ? Math.max(5, config.sceneMinimumDurationSeconds)
    : config.sceneMinimumDurationSeconds;
}

function windowCellEnd(
  windows: readonly AcousticSceneWindow[],
  index: number,
): number {
  return (
    windows[index + 1]?.interval.start ?? windows[index]?.interval.end ?? 0
  );
}

export function smoothAcousticSceneWindows(
  windows: readonly AcousticSceneWindow[],
  config: AcousticSceneAnalysisConfig = DEFAULT_ACOUSTIC_SCENE_CONFIG,
): AcousticSceneWindow[] {
  const smoothed = windows.map((window) => ({
    ...window,
    evidence: [...window.evidence],
  }));
  for (let index = 1; index < smoothed.length - 1; index += 1) {
    const previous = smoothed[index - 1];
    const current = smoothed[index];
    const next = smoothed[index + 1];
    if (previous === undefined || current === undefined || next === undefined) {
      continue;
    }
    if (
      current.smoothedLabel === "unknown" &&
      previous.smoothedLabel === next.smoothedLabel &&
      previous.smoothedLabel !== "non-speech"
    ) {
      current.smoothedLabel = previous.smoothedLabel;
      current.evidence.push("short-unknown-window-absorbed-by-neighbors");
      current.confidence = rounded(
        Math.min(previous.confidence, next.confidence),
      );
      continue;
    }
    if (
      ["singing", "noisy-dialogue"].includes(previous.smoothedLabel) &&
      current.smoothedLabel !== previous.smoothedLabel &&
      next.smoothedLabel === previous.smoothedLabel &&
      current.confidence < config.sceneConfidenceThreshold + 0.08
    ) {
      current.smoothedLabel = previous.smoothedLabel;
      current.evidence.push("hysteresis-retained-stable-scene");
      current.confidence = rounded(
        Math.max(
          current.confidence,
          Math.min(previous.confidence, next.confidence) - 0.05,
        ),
      );
    }
  }
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    let runStart = 0;
    while (runStart < smoothed.length) {
      const label = smoothed[runStart]?.smoothedLabel ?? "unknown";
      let runEnd = runStart + 1;
      while (smoothed[runEnd]?.smoothedLabel === label) runEnd += 1;
      const start = smoothed[runStart]?.interval.start ?? 0;
      const end = windowCellEnd(smoothed, runEnd - 1);
      const minimum = minimumDurationFor(label, config);
      if (end - start < minimum) {
        const left = smoothed[runStart - 1];
        const right = smoothed[runEnd];
        const replacement =
          left !== undefined && right?.smoothedLabel === left.smoothedLabel
            ? left.smoothedLabel
            : (left?.confidence ?? 0) >= (right?.confidence ?? 0)
              ? left?.smoothedLabel
              : right?.smoothedLabel;
        for (let index = runStart; index < runEnd; index += 1) {
          const window = smoothed[index];
          if (window === undefined || replacement === undefined) continue;
          const strongVocal =
            window.probabilities.speech >= 0.72 ||
            window.probabilities.vocal >= 0.72;
          const nextLabel =
            replacement === "non-speech" && strongVocal
              ? "unknown"
              : replacement;
          if (window.smoothedLabel === nextLabel) continue;
          window.smoothedLabel = nextLabel;
          changed = true;
          window.evidence.push(
            nextLabel === "unknown"
              ? "short-high-vocal-window-protected-from-non-speech-absorption"
              : "minimum-duration-short-scene-absorbed",
          );
        }
      }
      runStart = runEnd;
    }
    if (!changed) break;
  }
  return smoothed;
}

export function mergeAcousticSceneSegments(
  windows: readonly AcousticSceneWindow[],
): AcousticSceneSegment[] {
  const groups: AcousticSceneWindow[][] = [];
  for (const window of windows) {
    const current = groups.at(-1);
    if (current?.at(-1)?.smoothedLabel === window.smoothedLabel) {
      current.push(window);
    } else {
      groups.push([window]);
    }
  }
  return groups.flatMap((group, index) => {
    const first = group[0];
    const last = group.at(-1);
    if (first === undefined || last === undefined) return [];
    const probabilities = averageProbabilities(
      group.map((window) => window.probabilities),
    );
    const confidence = rounded(
      average(group.map((window) => window.confidence)),
    );
    const routingDecision = routeSceneToAsrStrategy({
      label: first.smoothedLabel,
      confidence,
      vocalProbability: probabilities.vocal,
      sceneConfidenceThreshold:
        DEFAULT_ACOUSTIC_SCENE_CONFIG.sceneConfidenceThreshold,
      routingMode: "conservative",
    });
    const absorbed = group.some((window) =>
      window.evidence.some((item) => item.includes("absorbed")),
    );
    const hysteresis = group.some((window) =>
      window.evidence.some((item) => item.includes("hysteresis")),
    );
    return [
      {
        id: `acoustic-scene-${String(index + 1).padStart(5, "0")}`,
        interval: {
          start: first.interval.start,
          end: groups[index + 1]?.[0]?.interval.start ?? last.interval.end,
        },
        label: first.smoothedLabel,
        confidence,
        probabilities,
        sourceWindowIds: group.map((window) => window.id),
        evidence: [...new Set(group.flatMap((window) => window.evidence))],
        boundarySource: absorbed
          ? ("minimum-duration-absorption" as const)
          : hysteresis
            ? ("hysteresis" as const)
            : ("window-hop" as const),
        routingDecision,
      },
    ];
  });
}

function parsePcm16Wav(buffer: Buffer): {
  sampleRate: number;
  channels: number;
  samples: Int16Array;
} {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Acoustic analysis expected a PCM WAV file.");
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && length >= 16 && body + length <= buffer.length) {
      audioFormat = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    }
    if (id === "data") {
      dataStart = body;
      dataLength = Math.min(length, buffer.length - body);
      break;
    }
    offset = body + length + (length % 2);
  }
  if (
    dataStart < 0 ||
    audioFormat !== 1 ||
    bitsPerSample !== 16 ||
    sampleRate <= 0 ||
    channels !== 1
  ) {
    throw new Error("Acoustic analysis requires mono 16-bit PCM WAV.");
  }
  const count = Math.floor(dataLength / 2);
  const samples = new Int16Array(count);
  for (let index = 0; index < count; index += 1) {
    samples[index] = buffer.readInt16LE(dataStart + index * 2);
  }
  return { sampleRate, channels, samples };
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function analyzeAcousticScenes(input: {
  mediaPath: string;
  audioStreamIndex: number;
  mediaDurationSeconds: number;
  speechIntervals: readonly TranscriptionInterval[];
  outputDirectory: string;
  artifactDirectory: string;
  runner: ProcessRunner;
  ffmpegPath: string;
  classifier?: AcousticEventClassifier | undefined;
  config?: Partial<AcousticSceneAnalysisConfig> | undefined;
  overwrite?: boolean | undefined;
  generatedAt?: string | undefined;
}): Promise<{
  windowsArtifact: AcousticSceneWindowsArtifact;
  scenesArtifact: AcousticScenesArtifact;
}> {
  const config = {
    ...DEFAULT_ACOUSTIC_SCENE_CONFIG,
    ...input.config,
  };
  const classifier = input.classifier ?? new HeuristicAcousticEventClassifier();
  const audioDirectory = path.join(input.outputDirectory, "audio");
  await mkdir(audioDirectory, { recursive: true });
  const audioPath = path.join(audioDirectory, "acoustic-scene-analysis.wav");
  if (!(await pathExists(audioPath)) || input.overwrite === true) {
    await input.runner.run(input.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input.mediaPath,
      "-map",
      `0:${input.audioStreamIndex}`,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(ANALYSIS_SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      audioPath,
    ]);
  }
  const buffer = await readFile(audioPath);
  const audioHash = sha256(buffer);
  const parsed = parsePcm16Wav(buffer);
  const actualDurationSeconds = parsed.samples.length / parsed.sampleRate;
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify({
        sourceAudioHash: audioHash,
        sampleRate: parsed.sampleRate,
        channels: parsed.channels,
        windowSeconds: config.sceneWindowSeconds,
        hopSeconds: config.sceneHopSeconds,
        classifierId: classifier.id,
        classifierVersion: classifier.version,
        thresholds: {
          minimumDurationSeconds: config.sceneMinimumDurationSeconds,
          confidence: config.sceneConfidenceThreshold,
          nonSpeechSkip: config.nonSpeechSkipConfidence,
        },
        analysisVersion: ACOUSTIC_SCENE_ANALYSIS_VERSION,
        schemaVersion: "1.0.0",
      }),
    )
    .digest("hex");
  const cachePath = path.join(
    audioDirectory,
    `acoustic-scene-cache-${cacheKey}.json`,
  );
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  let windows: AcousticSceneWindow[];
  let scenes: AcousticSceneSegment[];
  let cacheHit = false;
  if (await pathExists(cachePath)) {
    const cached = (await readJson(cachePath)) as {
      windows: AcousticSceneWindow[];
      scenes: AcousticSceneSegment[];
    };
    windows = cached.windows;
    scenes = cached.scenes;
    cacheHit = true;
  } else {
    const analyzed = await analyzeAcousticSceneWindows({
      samples: parsed.samples,
      sampleRate: parsed.sampleRate,
      mediaDurationSeconds: input.mediaDurationSeconds,
      speechIntervals: input.speechIntervals,
      classifier,
      config,
    });
    windows = smoothAcousticSceneWindows(analyzed, config);
    scenes = mergeAcousticSceneSegments(windows);
    await atomicWriteJson(cachePath, { windows, scenes });
  }
  const windowsArtifact = acousticSceneWindowsArtifactSchema.parse({
    schemaVersion: "1.0.0",
    status: "completed",
    generatedAt,
    analysisVersion: ACOUSTIC_SCENE_ANALYSIS_VERSION,
    classifier: {
      id: classifier.id,
      version: classifier.version,
      kind:
        classifier instanceof HeuristicAcousticEventClassifier
          ? "heuristic"
          : "local-model",
    },
    config,
    sourceAudio: {
      sha256: audioHash,
      sampleRate: parsed.sampleRate,
      channels: 1,
      durationSeconds: rounded(actualDurationSeconds),
    },
    cache: { key: cacheKey, hit: cacheHit },
    failure: null,
    windows,
  });
  const scenesArtifact = acousticScenesArtifactSchema.parse({
    schemaVersion: "1.0.0",
    status: "completed",
    generatedAt,
    analysisVersion: ACOUSTIC_SCENE_ANALYSIS_VERSION,
    config,
    failure: null,
    scenes,
  });
  await Promise.all([
    atomicWriteJson(
      path.join(input.artifactDirectory, "acoustic-scene-windows.json"),
      windowsArtifact,
      { overwrite: input.overwrite ?? false },
    ),
    atomicWriteJson(
      path.join(input.artifactDirectory, "acoustic-scenes.json"),
      scenesArtifact,
      { overwrite: input.overwrite ?? false },
    ),
  ]);
  return { windowsArtifact, scenesArtifact };
}
