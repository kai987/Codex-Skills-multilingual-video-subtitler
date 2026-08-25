import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  InputError,
  atomicWriteFile,
  atomicWriteJson,
  forcedAlignmentAttemptSchema,
  forcedAlignmentCacheIdentitySchema,
  type EvidenceDpUnit,
  type ForcedAlignmentAttempt,
  type ForcedAlignmentBackend,
  type ForcedAlignmentCacheManifest,
  type ForcedAlignmentConfiguration,
  type ForcedAlignmentCueDecision,
  type ForcedAlignmentMode,
  type ForcedAlignmentRuntimeCapability,
  type Logger,
  type ProcessRunner,
  type SourceFingerprint,
  type SubtitleCanonicalAlignmentInput,
  type SubtitleCanonicalForcedAlignment,
  type SubtitleCanonicalPronunciation,
  type SubtitleCue,
  type SubtitleOverlapAcousticResolution,
  type SudachiRuntimeCapability,
} from "@mvl/shared";
import {
  ANTI_FORCE_POLICY_VERSION,
  DEFAULT_FORCED_ALIGNMENT_CONFIGURATION,
  FORCED_ALIGNMENT_OUTPUT_PARSER_VERSION,
  JOINT_ASSIGNMENT_POLICY_VERSION,
  alignCanonicalReadingWithEvidence,
  applyCanonicalForcedAlignment,
  buildForcedAlignmentCueDecision,
  buildSubtitleCanonicalAlignmentInput,
  buildSubtitleCanonicalForcedAlignment,
  forcedAlignmentSha256,
  jointlyAssignForcedAlignmentComponent,
  normalizeCanonicalAlignmentText,
  type SudachiMorphemeAnalysis,
} from "@mvl/transcription-core";

import {
  ForcedAlignmentCache,
  type ForcedAlignmentCacheMode,
} from "./forced-alignment-cache.js";
import { sha256LocalFile } from "./finalization-support.js";
import {
  CANONICAL_PRONUNCIATION_POLICY_VERSION,
  G2P_PREPARATION_POLICY_VERSION,
  prepareCanonicalPronunciation,
} from "./canonical-pronunciation.js";
import {
  parseMfaAlignmentOutput,
  type ParsedMfaAlignment,
} from "./mfa-output.js";
import { verifyMfaRuntimeCapability } from "./mfa-runtime.js";
import { measureWavDurationFromBuffer } from "./overlap-acoustic.js";
import { runSudachiMorphemeAnalysis } from "./sudachi-analysis.js";
import { loadSudachiRuntimeCapability } from "./sudachi-runtime.js";

const MAXIMUM_COMPONENTS = 7;
const MAXIMUM_CUES = 16;

function requiredValue<T>(value: T | undefined, context: string): T {
  if (value === undefined) {
    throw new InputError(`Missing ${context}.`);
  }
  return value;
}

interface AlignmentWindow {
  type: "narrow" | "expanded";
  mediaStart: number;
  mediaEnd: number;
  componentAudioStart: number;
  componentAudioEnd: number;
}

export interface MfaAlignmentExecutorInput {
  attemptId: string;
  componentId: string;
  cueId: string;
  windowType: "narrow" | "expanded";
  windowAudioPath: string;
  transcriptPath: string;
  outputPath: string;
  temporaryDirectory: string;
  mediaOffsetSeconds: number;
  expectedUnitIds: readonly string[];
  canonicalUnits: readonly {
    unitId: string;
    surface: string;
    normalizedSurface: string;
    reading: string | null;
    phones: readonly string[];
    punctuation: boolean;
    criticalOov: boolean;
  }[];
  expectedPhones: readonly string[];
  capability: ForcedAlignmentRuntimeCapability;
  mfaExecutable: string;
  pythonExecutable: string;
  acousticModel: string;
  dictionaryModel: string;
  g2pModel: string;
  runner: ProcessRunner;
  parserHelperPath: string;
}

export interface MfaAlignmentExecutorResult {
  parsed: ParsedMfaAlignment | null;
  exitCode: number;
  wallClockSeconds: number;
  failure: string | null;
  warnings: string[];
}

export type MfaAlignmentExecutor = (
  input: MfaAlignmentExecutorInput,
) => Promise<MfaAlignmentExecutorResult>;

export interface CanonicalForcedAlignmentOptions {
  mode: ForcedAlignmentMode;
  backend: ForcedAlignmentBackend;
  subtitleDirectory: string;
  sourceVideoPath: string;
  sourceFingerprint: SourceFingerprint;
  cues: readonly SubtitleCue[];
  overlapArtifact: SubtitleOverlapAcousticResolution;
  baseTimingHash?: string;
  configuration?: Partial<ForcedAlignmentConfiguration>;
  runner: ProcessRunner;
  logger?: Logger;
  ffmpegPath?: string;
  mfaExecutable?: string;
  pythonExecutable?: string;
  mfaRuntimeManifestPath?: string;
  mfaAcousticModel?: string;
  mfaDictionaryModel?: string;
  mfaG2pModel?: string;
  mfaTemporaryDirectory?: string;
  sudachiRuntimeManifestPath?: string;
  sudachiPythonExecutable?: string;
  sudachiRequirementsPath?: string;
  sudachiHelperPath?: string;
  parserHelperPath?: string;
  forcedAlignmentCacheDirectory?: string;
  forcedAlignmentCacheImportPaths?: readonly string[];
  forcedAlignmentCacheMode?: ForcedAlignmentCacheMode;
  generatedAt?: string;
  targetComponentIds?: readonly string[];
  morphemeAnalyzer?: (
    cues: readonly SubtitleCue[],
  ) => Promise<ReadonlyMap<string, readonly SudachiMorphemeAnalysis[]>>;
  mfaExecutor?: MfaAlignmentExecutor;
}

export interface CanonicalForcedAlignmentResult {
  artifact: SubtitleCanonicalForcedAlignment;
  canonicalInput: SubtitleCanonicalAlignmentInput;
  pronunciation: SubtitleCanonicalPronunciation | null;
  cacheManifest: ForcedAlignmentCacheManifest;
  cues: SubtitleCue[];
  runtimeCapability: ForcedAlignmentRuntimeCapability | null;
  sudachiRuntimeCapability: SudachiRuntimeCapability | null;
  dependencyFailure: string | null;
  wallClockSeconds: number;
  outputPaths: {
    canonicalInput: string;
    alignment: string;
    pronunciation: string | null;
    pronunciationDictionary: string | null;
    runtimeCapability: string | null;
    sudachiRuntimeCapability: string | null;
    cacheManifest: string;
  };
}

function intervalIntersects(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function componentEvidence(input: {
  artifact: SubtitleOverlapAcousticResolution;
  componentId: string;
  cue: SubtitleCue;
  window: { start: number; end: number };
}): {
  evidenceUnits: EvidenceDpUnit[];
  mappedTokenIntervals: { evidenceId: string; start: number; end: number }[];
  rawVadIntervals: { evidenceId: string; start: number; end: number }[];
  decodedSegmentIntervals: { evidenceId: string; start: number; end: number }[];
} {
  const attempts = input.artifact.attempts.filter(
    (attempt) => attempt.componentId === input.componentId,
  );
  const mappedTokenIntervals = uniqueBy(
    attempts.flatMap((attempt) =>
      attempt.tokens.flatMap((token) => {
        if (
          token.timingUsable !== true ||
          token.mappedCoordinateSystem !== "original-media-global" ||
          token.mappedStart === null ||
          token.mappedStart === undefined ||
          token.mappedEnd === null ||
          token.mappedEnd === undefined ||
          !token.tokenTimelineStatus?.startsWith("trusted") ||
          !intervalIntersects(
            { start: token.mappedStart, end: token.mappedEnd },
            input.window,
          )
        ) {
          return [];
        }
        return [
          {
            evidenceId: token.tokenId,
            start: token.mappedStart,
            end: token.mappedEnd,
            text: token.text,
          },
        ];
      }),
    ),
    (item) =>
      `${item.evidenceId}:${item.start.toFixed(3)}:${item.end.toFixed(3)}`,
  ).toSorted(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.evidenceId.localeCompare(right.evidenceId),
  );
  const rawVadIntervals = uniqueBy(
    attempts.flatMap((attempt) =>
      (attempt.rawVadIntervals ?? []).flatMap((interval) =>
        interval.timingUsable &&
        interval.coordinateSystem === "original-media-global" &&
        intervalIntersects(interval, input.window)
          ? [
              {
                evidenceId: interval.intervalId,
                start: interval.start,
                end: interval.end,
              },
            ]
          : [],
      ),
    ),
    (item) =>
      `${item.evidenceId}:${item.start.toFixed(3)}:${item.end.toFixed(3)}`,
  );
  const decodedSegmentIntervals = uniqueBy(
    attempts.flatMap((attempt) =>
      attempt.segments.flatMap((segment) =>
        segment.timingUsable !== false &&
        intervalIntersects(segment, input.window)
          ? [
              {
                evidenceId: segment.segmentId,
                start: segment.start,
                end: segment.end,
                text: segment.text,
              },
            ]
          : [],
      ),
    ),
    (item) =>
      `${item.evidenceId}:${item.start.toFixed(3)}:${item.end.toFixed(3)}`,
  );
  const evidenceUnits: EvidenceDpUnit[] = [
    ...mappedTokenIntervals.map((interval) => ({
      evidenceId: interval.evidenceId,
      text: interval.text,
      reading: interval.text,
      interval: {
        start: interval.start,
        end: interval.end,
        coordinateSystem: "original-media-global" as const,
      },
      source: "trusted-mapped-token" as const,
      timingUsable: true,
    })),
    ...decodedSegmentIntervals.map((interval) => ({
      evidenceId: interval.evidenceId,
      text: interval.text,
      reading: interval.text,
      interval: {
        start: interval.start,
        end: interval.end,
        coordinateSystem: "original-media-global" as const,
      },
      source: "decoded-segment" as const,
      timingUsable: true,
    })),
    ...rawVadIntervals.map((interval) => ({
      evidenceId: interval.evidenceId,
      text: "",
      reading: null,
      interval: {
        start: interval.start,
        end: interval.end,
        coordinateSystem: "original-media-global" as const,
      },
      source: "raw-vad" as const,
      timingUsable: true,
    })),
    {
      evidenceId: `source-cue-prior-${input.cue.id}`,
      text: input.cue.text,
      reading: null,
      interval: {
        start: input.cue.start,
        end: input.cue.end,
        coordinateSystem: "original-media-global",
      },
      source: "source-cue-prior",
      timingUsable: false,
    },
  ];
  return {
    evidenceUnits,
    mappedTokenIntervals: mappedTokenIntervals.map(
      ({ evidenceId, start, end }) => ({ evidenceId, start, end }),
    ),
    rawVadIntervals,
    decodedSegmentIntervals: decodedSegmentIntervals.map(
      ({ evidenceId, start, end }) => ({ evidenceId, start, end }),
    ),
  };
}

function alignmentWindows(input: {
  cue: SubtitleCue;
  extractionInterval: { start: number; end: number };
  configuration: ForcedAlignmentConfiguration;
}): AlignmentWindow[] {
  return [
    {
      type: "narrow" as const,
      context: input.configuration.narrowContextSeconds,
    },
    {
      type: "expanded" as const,
      context: input.configuration.expandedContextSeconds,
    },
  ].map(({ type, context }) => {
    const mediaStart = Math.max(
      input.extractionInterval.start,
      input.cue.start - context,
    );
    const mediaEnd = Math.min(
      input.extractionInterval.end,
      input.cue.end + context,
    );
    return {
      type,
      mediaStart,
      mediaEnd,
      componentAudioStart: mediaStart - input.extractionInterval.start,
      componentAudioEnd: mediaEnd - input.extractionInterval.start,
    };
  });
}

async function resolveComponentAudio(input: {
  component: SubtitleOverlapAcousticResolution["components"][number];
  subtitleDirectory: string;
  sourceVideoPath: string;
  runner: ProcessRunner;
  ffmpegPath: string;
}): Promise<{ path: string; sha256: string; durationSeconds: number }> {
  if (
    input.component.audioPath !== null &&
    input.component.audioSha256 !== null &&
    input.component.audioFullyCoversComponent
  ) {
    const existing = path.resolve(
      input.subtitleDirectory,
      input.component.audioPath,
    );
    try {
      const sha256 = await sha256LocalFile(existing);
      if (sha256 !== input.component.audioSha256) {
        throw new InputError(
          `Existing component WAV hash mismatch for ${input.component.componentId}.`,
        );
      }
      const measured = measureWavDurationFromBuffer(await readFile(existing));
      if (
        measured.durationSeconds + 0.001 <
        input.component.extractionInterval.end -
          input.component.extractionInterval.start
      ) {
        throw new InputError(
          `Existing component WAV does not fully cover ${input.component.componentId}.`,
        );
      }
      return {
        path: existing,
        sha256,
        durationSeconds: measured.durationSeconds,
      };
    } catch (error) {
      if (error instanceof InputError) throw error;
      // Missing files are regenerated below without touching the source media.
    }
  }
  const output = path.join(
    input.subtitleDirectory,
    "audio",
    "forced-alignment",
    `${input.component.componentId}.wav`,
  );
  await mkdir(path.dirname(output), { recursive: true });
  await input.runner.run(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    input.component.extractionInterval.start.toFixed(3),
    "-i",
    input.sourceVideoPath,
    "-t",
    (
      input.component.extractionInterval.end -
      input.component.extractionInterval.start
    ).toFixed(3),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    output,
  ]);
  const measured = measureWavDurationFromBuffer(await readFile(output));
  return {
    path: output,
    sha256: await sha256LocalFile(output),
    durationSeconds: measured.durationSeconds,
  };
}

async function extractAttemptAudio(input: {
  componentAudioPath: string;
  outputPath: string;
  window: AlignmentWindow;
  runner: ProcessRunner;
  ffmpegPath: string;
}): Promise<{ sha256: string; durationSeconds: number }> {
  await input.runner.run(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    input.window.componentAudioStart.toFixed(3),
    "-i",
    input.componentAudioPath,
    "-t",
    (input.window.componentAudioEnd - input.window.componentAudioStart).toFixed(
      3,
    ),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    input.outputPath,
  ]);
  const bytes = await readFile(input.outputPath);
  const measured = measureWavDurationFromBuffer(bytes);
  return {
    sha256: await sha256LocalFile(input.outputPath),
    durationSeconds: measured.durationSeconds,
  };
}

export const defaultMfaAlignmentExecutor: MfaAlignmentExecutor = async (
  input,
) => {
  const started = performance.now();
  const command = input.capability.commandCapabilities.alignOneCommand;
  const outputFormat =
    input.capability.commandCapabilities.selectedOutputFormat;
  const mfaBinDirectory = path.dirname(input.mfaExecutable);
  const mfaModelRoot = path.dirname(path.dirname(path.dirname(input.g2pModel)));
  const result = await input.runner.run(
    input.mfaExecutable,
    [
      command,
      input.windowAudioPath,
      input.transcriptPath,
      input.dictionaryModel,
      input.acousticModel,
      input.outputPath,
      "--g2p_model_path",
      input.g2pModel,
      "--output_format",
      outputFormat,
      "--no_tokenization",
      "--clean",
      "--temporary_directory",
      input.temporaryDirectory,
    ],
    {
      allowNonZero: true,
      timeoutMs: 180_000,
      environment: {
        ...process.env,
        CONDA_PREFIX: path.dirname(mfaBinDirectory),
        MFA_ROOT_DIR: mfaModelRoot,
        PATH: `${mfaBinDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    },
  );
  if (result.exitCode !== 0) {
    return {
      parsed: null,
      exitCode: result.exitCode,
      wallClockSeconds: (performance.now() - started) / 1_000,
      failure: combinedFailure(result),
      warnings: [],
    };
  }
  let raw: unknown;
  if (outputFormat === "json") {
    raw = JSON.parse(await readFile(input.outputPath, "utf8")) as unknown;
  } else {
    const parsed = await input.runner.run(input.pythonExecutable, [
      input.parserHelperPath,
      input.outputPath,
    ]);
    raw = JSON.parse(parsed.stdout) as unknown;
  }
  return {
    parsed: parseMfaAlignmentOutput({
      value: raw,
      outputFormat,
      mediaOffsetSeconds: input.mediaOffsetSeconds,
      canonicalUnits: input.canonicalUnits,
      expectedPhones: input.expectedPhones,
    }),
    exitCode: 0,
    wallClockSeconds: (performance.now() - started) / 1_000,
    failure: null,
    warnings:
      result.stderr.trim() === "" ? [] : [result.stderr.trim().slice(-2_000)],
  };
};

function combinedFailure(result: { stdout: string; stderr: string }): string {
  const value = `${result.stderr}\n${result.stdout}`.trim();
  return value === ""
    ? "MFA_ALIGNMENT_FAILED_WITHOUT_DIAGNOSTIC"
    : value.slice(-2_000);
}

async function loadRuntimeCapability(input: {
  backend: ForcedAlignmentBackend;
  manifestPath?: string;
}): Promise<ForcedAlignmentRuntimeCapability | null> {
  if (input.backend === "evidence-dp") return null;
  if (input.manifestPath === undefined) {
    throw new InputError(
      "mfa-japanese/hybrid forced alignment requires --mfa-runtime-manifest.",
    );
  }
  const raw = JSON.parse(await readFile(input.manifestPath, "utf8")) as unknown;
  return verifyMfaRuntimeCapability(raw);
}

function assertMfaOptions(
  options: CanonicalForcedAlignmentOptions,
  capability: ForcedAlignmentRuntimeCapability | null,
): asserts options is CanonicalForcedAlignmentOptions & {
  mfaExecutable: string;
  pythonExecutable: string;
  mfaAcousticModel: string;
  mfaDictionaryModel: string;
  mfaG2pModel: string;
} {
  if (capability === null) return;
  for (const [name, value] of [
    ["mfaExecutable", options.mfaExecutable],
    ["pythonExecutable", options.pythonExecutable],
    ["mfaAcousticModel", options.mfaAcousticModel],
    ["mfaDictionaryModel", options.mfaDictionaryModel],
    ["mfaG2pModel", options.mfaG2pModel],
  ] as const) {
    if (value === undefined || value.trim() === "") {
      throw new InputError(`MFA forced alignment requires ${name}.`);
    }
  }
}

function attemptFailure(input: {
  attemptId: string;
  componentId: string;
  cueId: string;
  window: AlignmentWindow;
  audioSha256: string;
  audioDurationSeconds: number;
  canonicalTextSha256: string;
  alignmentTextSha256: string;
  readingManifestSha256: string;
  capability: ForcedAlignmentRuntimeCapability;
  commandMode: "align_one" | "align_one_legacy" | "mock";
  outputFormat: "json" | "long_textgrid" | "mock-json";
  cacheHit: boolean;
  exitCode: number;
  wallClockSeconds: number;
  failure: string;
  warnings?: readonly string[];
}): ForcedAlignmentAttempt {
  return forcedAlignmentAttemptSchema.parse({
    attemptId: input.attemptId,
    requestType: "canonical-forced-alignment",
    componentId: input.componentId,
    cueId: input.cueId,
    windowType: input.window.type,
    windowLocalInterval: {
      start: input.window.componentAudioStart,
      end: input.window.componentAudioEnd,
      coordinateSystem: "component-audio-local",
    },
    windowMediaInterval: {
      start: input.window.mediaStart,
      end: input.window.mediaEnd,
      coordinateSystem: "original-media-global",
    },
    audioSha256: input.audioSha256,
    audioDurationSeconds: input.audioDurationSeconds,
    canonicalTextSha256: input.canonicalTextSha256,
    alignmentTextSha256: input.alignmentTextSha256,
    readingManifestSha256: input.readingManifestSha256,
    runtimeIdentityHash: input.capability.runtimeIdentityHash,
    acousticModelHash: input.capability.acousticModel.sha256,
    dictionaryModelHash: input.capability.dictionaryModel.sha256,
    g2pModelHash: input.capability.g2pModel.sha256,
    commandMode: input.commandMode,
    outputFormat: input.outputFormat,
    parserVersion: FORCED_ALIGNMENT_OUTPUT_PARSER_VERSION,
    cacheHit: input.cacheHit,
    exitCode: input.exitCode,
    wallClockSeconds: input.wallClockSeconds,
    wordAlignments: [],
    phoneAlignments: [],
    silenceIntervals: [],
    utteranceInterval: null,
    lexicalUtteranceInterval: null,
    phoneUtteranceInterval: null,
    selectedUtteranceInterval: null,
    selectedBoundarySource: "none",
    wordUnitMappings: [],
    alignedWordCount: 0,
    expectedWordCount: 0,
    alignedPhoneCount: 0,
    oovCount: 0,
    wordCoverageRatio: 0,
    readingCoverageRatio: 0,
    phoneCoverageRatio: 0,
    canonicalUnitCoverageRatio: 0,
    alignedWordCoverageRatio: 0,
    pronunciationUnitCoverageRatio: 0,
    expectedPhoneCoverageRatio: 0,
    wordWithAnyPhoneRatio: 0,
    alignedPhonePlausibilityRatio: 0,
    expectedPhoneCount: 0,
    alignedExpectedPhoneCount: 0,
    unresolvedMappingCount: 0,
    ambiguousMappingCount: 0,
    boundaryStart: null,
    boundaryEnd: null,
    startPinnedToWindowEdge: false,
    endPinnedToWindowEdge: false,
    alignmentSucceeded: false,
    failure: input.failure,
    warnings: [...(input.warnings ?? [])],
  });
}

function successfulAttempt(input: {
  attemptId: string;
  componentId: string;
  cueId: string;
  window: AlignmentWindow;
  audioSha256: string;
  audioDurationSeconds: number;
  canonicalTextSha256: string;
  alignmentTextSha256: string;
  readingManifestSha256: string;
  expectedWordCount: number;
  capability: ForcedAlignmentRuntimeCapability;
  commandMode: "align_one" | "align_one_legacy" | "mock";
  outputFormat: "json" | "long_textgrid" | "mock-json";
  wallClockSeconds: number;
  parsed: ParsedMfaAlignment;
  warnings: readonly string[];
}): ForcedAlignmentAttempt {
  const boundaryStart = input.parsed.utteranceInterval?.start ?? null;
  const boundaryEnd = input.parsed.utteranceInterval?.end ?? null;
  const alignedWordCount = input.parsed.wordAlignments.filter(
    (word) => !word.oov,
  ).length;
  const edgeTolerance = 0.03;
  return forcedAlignmentAttemptSchema.parse({
    attemptId: input.attemptId,
    requestType: "canonical-forced-alignment",
    componentId: input.componentId,
    cueId: input.cueId,
    windowType: input.window.type,
    windowLocalInterval: {
      start: input.window.componentAudioStart,
      end: input.window.componentAudioEnd,
      coordinateSystem: "component-audio-local",
    },
    windowMediaInterval: {
      start: input.window.mediaStart,
      end: input.window.mediaEnd,
      coordinateSystem: "original-media-global",
    },
    audioSha256: input.audioSha256,
    audioDurationSeconds: input.audioDurationSeconds,
    canonicalTextSha256: input.canonicalTextSha256,
    alignmentTextSha256: input.alignmentTextSha256,
    readingManifestSha256: input.readingManifestSha256,
    runtimeIdentityHash: input.capability.runtimeIdentityHash,
    acousticModelHash: input.capability.acousticModel.sha256,
    dictionaryModelHash: input.capability.dictionaryModel.sha256,
    g2pModelHash: input.capability.g2pModel.sha256,
    commandMode: input.commandMode,
    outputFormat: input.outputFormat,
    parserVersion: FORCED_ALIGNMENT_OUTPUT_PARSER_VERSION,
    cacheHit: false,
    exitCode: 0,
    wallClockSeconds: input.wallClockSeconds,
    wordAlignments: input.parsed.wordAlignments,
    phoneAlignments: input.parsed.phoneAlignments,
    silenceIntervals: input.parsed.silenceIntervals,
    utteranceInterval: input.parsed.utteranceInterval,
    fileInterval: input.parsed.fileInterval,
    lexicalUtteranceInterval: input.parsed.lexicalUtteranceInterval,
    phoneUtteranceInterval: input.parsed.phoneUtteranceInterval,
    selectedUtteranceInterval: input.parsed.selectedUtteranceInterval,
    selectedBoundarySource: input.parsed.selectedBoundarySource,
    wordUnitMappings: input.parsed.wordUnitMappings,
    alignedWordCount,
    expectedWordCount: input.expectedWordCount,
    alignedPhoneCount: input.parsed.phoneAlignments.length,
    oovCount: input.parsed.wordAlignments.filter((word) => word.oov).length,
    wordCoverageRatio: input.parsed.canonicalUnitCoverageRatio,
    readingCoverageRatio: input.parsed.pronunciationUnitCoverageRatio,
    phoneCoverageRatio: input.parsed.expectedPhoneCoverageRatio,
    canonicalUnitCoverageRatio: input.parsed.canonicalUnitCoverageRatio,
    alignedWordCoverageRatio: input.parsed.alignedWordCoverageRatio,
    pronunciationUnitCoverageRatio: input.parsed.pronunciationUnitCoverageRatio,
    expectedPhoneCoverageRatio: input.parsed.expectedPhoneCoverageRatio,
    wordWithAnyPhoneRatio: input.parsed.wordWithAnyPhoneRatio,
    alignedPhonePlausibilityRatio: input.parsed.alignedPhonePlausibilityRatio,
    expectedPhoneCount: input.parsed.expectedPhoneCount,
    alignedExpectedPhoneCount: input.parsed.alignedExpectedPhoneCount,
    unresolvedMappingCount: input.parsed.unresolvedMappingCount,
    ambiguousMappingCount: input.parsed.ambiguousMappingCount,
    boundaryStart,
    boundaryEnd,
    startPinnedToWindowEdge:
      boundaryStart !== null &&
      Math.abs(boundaryStart - input.window.mediaStart) <= edgeTolerance,
    endPinnedToWindowEdge:
      boundaryEnd !== null &&
      Math.abs(boundaryEnd - input.window.mediaEnd) <= edgeTolerance,
    alignmentSucceeded: boundaryStart !== null && boundaryEnd !== null,
    failure: null,
    warnings: [...input.parsed.warnings, ...input.warnings],
  });
}

function cacheIdentity(input: {
  audioSha256: string;
  window: AlignmentWindow;
  cue: SubtitleCanonicalAlignmentInput["cues"][number];
  pronunciationCue: SubtitleCanonicalPronunciation["cues"][number] | null;
  backend: ForcedAlignmentBackend;
  capability: ForcedAlignmentRuntimeCapability;
  configuration: ForcedAlignmentConfiguration;
  commandMode: "align_one" | "align_one_legacy" | "mock";
}) {
  return forcedAlignmentCacheIdentitySchema.parse({
    requestType: "canonical-forced-alignment",
    audioSha256: input.audioSha256,
    windowMediaInterval: {
      start: input.window.mediaStart,
      end: input.window.mediaEnd,
    },
    windowAudioInterval: {
      start: input.window.componentAudioStart,
      end: input.window.componentAudioEnd,
    },
    canonicalTextSha256: input.cue.canonicalTextSha256,
    alignmentTextSha256: input.cue.alignmentTextSha256,
    readingManifestSha256: forcedAlignmentSha256(
      input.pronunciationCue ?? {
        morphemes: input.cue.morphemes,
        wordUnits: input.cue.wordUnits,
        normalizedReading: input.cue.normalizedReading,
      },
    ),
    backend: input.backend,
    runtimeIdentityHash: input.capability.runtimeIdentityHash,
    environmentExplicitSpecSha256:
      input.capability.environmentExplicitSpecSha256,
    acousticModelSha256: input.capability.acousticModel.sha256,
    dictionaryModelSha256: input.capability.dictionaryModel.sha256,
    g2pModelSha256: input.capability.g2pModel.sha256,
    commandMode: input.commandMode,
    mfaConfigurationHash: forcedAlignmentSha256({
      beam: "mfa-default",
      retryBeam: "mfa-default",
      numJobs: 1,
      clean: true,
      outputFormat: input.capability.commandCapabilities.selectedOutputFormat,
      tokenization: input.capability.commandCapabilities.tokenizationMode,
      g2p: input.capability.g2pModel.sha256,
    }),
    outputParserVersion: input.configuration.outputParserVersion,
    antiForcePolicyVersion: input.configuration.antiForcePolicyVersion,
    jointAssignmentPolicyVersion:
      input.configuration.jointAssignmentPolicyVersion,
    textGridLexicalBoundaryPolicyVersion:
      input.configuration.textGridLexicalBoundaryPolicyVersion,
    wordUnitMappingPolicyVersion:
      input.configuration.wordUnitMappingPolicyVersion,
    pronunciationCoveragePolicyVersion:
      input.configuration.pronunciationCoveragePolicyVersion,
    boundaryAgreementPolicyVersion:
      input.configuration.boundaryAgreementPolicyVersion,
    g2pPreparationPolicyVersion:
      input.configuration.g2pPreparationPolicyVersion,
    sudachiRuntimeIdentityHash: input.configuration.sudachiRuntimeIdentityHash,
  });
}

async function defaultMorphemeAnalysis(input: {
  options: CanonicalForcedAlignmentOptions;
  cues: readonly SubtitleCue[];
  sudachiCapability: SudachiRuntimeCapability | null;
}): Promise<ReadonlyMap<string, readonly SudachiMorphemeAnalysis[]>> {
  if (
    input.sudachiCapability === null ||
    input.options.sudachiPythonExecutable === undefined ||
    input.options.sudachiHelperPath === undefined
  ) {
    return new Map();
  }
  const result = await runSudachiMorphemeAnalysis({
    pythonExecutable: input.options.sudachiPythonExecutable,
    helperPath: input.options.sudachiHelperPath,
    items: input.cues.map((cue) => ({
      id: cue.id,
      text: normalizeCanonicalAlignmentText(cue.text).alignmentText,
    })),
  });
  return result.morphemesById;
}

export async function runCanonicalForcedAlignment(
  options: CanonicalForcedAlignmentOptions,
): Promise<CanonicalForcedAlignmentResult> {
  const started = performance.now();
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runtimeCapability = await loadRuntimeCapability({
    backend: options.backend,
    ...(options.mfaRuntimeManifestPath === undefined
      ? {}
      : { manifestPath: options.mfaRuntimeManifestPath }),
  });
  assertMfaOptions(options, runtimeCapability);
  let sudachiRuntimeCapability: SudachiRuntimeCapability | null = null;
  if (options.sudachiRuntimeManifestPath !== undefined) {
    if (
      options.sudachiPythonExecutable === undefined ||
      options.sudachiHelperPath === undefined
    ) {
      throw new InputError(
        "Sudachi runtime verification requires its Python executable and helper path.",
      );
    }
    sudachiRuntimeCapability = await loadSudachiRuntimeCapability({
      manifestPath: options.sudachiRuntimeManifestPath,
      pythonExecutable: options.sudachiPythonExecutable,
      helperPath: options.sudachiHelperPath,
      requirementsPath:
        options.sudachiRequirementsPath ??
        path.resolve("scripts/requirements-sudachi.txt"),
      runner: options.runner,
    });
  }
  if (
    runtimeCapability?.runtimeVersion === "C5.17.1" &&
    sudachiRuntimeCapability === null
  ) {
    throw new InputError(
      "C5.17.1 MFA replay requires an independently verified Sudachi runtime.",
    );
  }
  const configuration = {
    ...DEFAULT_FORCED_ALIGNMENT_CONFIGURATION,
    ...options.configuration,
    mode: options.mode,
    backend: options.backend,
    maximumAttemptsPerCue: 2,
    antiForcePolicyVersion: ANTI_FORCE_POLICY_VERSION,
    jointAssignmentPolicyVersion: JOINT_ASSIGNMENT_POLICY_VERSION,
    outputParserVersion: FORCED_ALIGNMENT_OUTPUT_PARSER_VERSION,
    textGridLexicalBoundaryPolicyVersion:
      "c5.17.1-lexical-utterance-boundary-v1",
    wordUnitMappingPolicyVersion: "c5.17.1-word-unit-sequence-mapping-v1",
    pronunciationCoveragePolicyVersion:
      "c5.17.1-pronunciation-phone-coverage-v1",
    boundaryAgreementPolicyVersion: "c5.17.1-two-sided-boundary-agreement-v1",
    g2pPreparationPolicyVersion: G2P_PREPARATION_POLICY_VERSION,
    ...(sudachiRuntimeCapability === null
      ? {}
      : {
          sudachiRuntimeIdentityHash:
            sudachiRuntimeCapability.runtimeIdentityHash,
        }),
    wholeMediaAsrAllowed: false,
    whisperPromptAllowed: false,
  } as ForcedAlignmentConfiguration;
  if (
    configuration.maximumTotalAlignmentAttempts > 40 ||
    configuration.concurrency > 2
  ) {
    throw new InputError(
      "Forced alignment exceeds the hard limits of 40 attempts, 2 attempts/cue, or concurrency 2.",
    );
  }
  const targetIds =
    options.targetComponentIds === undefined
      ? null
      : new Set(options.targetComponentIds);
  const targetComponents = options.overlapArtifact.components.filter(
    (component) =>
      component.blocking &&
      (targetIds === null || targetIds.has(component.componentId)),
  );
  const targetCueIds = new Set(
    targetComponents.flatMap((component) => component.cueIds),
  );
  const targetCues = options.cues.filter((cue) => targetCueIds.has(cue.id));
  if (
    targetComponents.length === 0 ||
    targetComponents.length > MAXIMUM_COMPONENTS ||
    targetCues.length === 0 ||
    targetCues.length > MAXIMUM_CUES
  ) {
    throw new InputError(
      `C5.17 is bounded to 1-${String(MAXIMUM_COMPONENTS)} unresolved components and 1-${String(MAXIMUM_CUES)} cues.`,
      { componentCount: targetComponents.length, cueCount: targetCues.length },
    );
  }
  if (targetCueIds.size !== targetCues.length) {
    throw new InputError("One or more unresolved component cues are missing.");
  }
  const maximumPlannedAttempts =
    options.backend === "evidence-dp" ? 0 : targetCues.length * 2;
  if (maximumPlannedAttempts > configuration.maximumTotalAlignmentAttempts) {
    throw new InputError(
      `Planned ${String(maximumPlannedAttempts)} MFA attempts exceed the configured maximum.`,
    );
  }
  const morphemesByCueId =
    options.morphemeAnalyzer === undefined
      ? await defaultMorphemeAnalysis({
          options,
          cues: targetCues,
          sudachiCapability: sudachiRuntimeCapability,
        })
      : await options.morphemeAnalyzer(targetCues);
  const baseTimingHash =
    options.baseTimingHash ??
    forcedAlignmentSha256(
      options.cues.map((cue) => ({
        id: cue.id,
        start: cue.start,
        end: cue.end,
      })),
    );
  const canonicalInput = buildSubtitleCanonicalAlignmentInput({
    components: targetComponents.map((component) => ({
      componentId: component.componentId,
      cues: component.cueIds.map((cueId) => {
        const cue = targetCues.find((item) => item.id === cueId);
        if (cue === undefined) throw new InputError(`Missing cue ${cueId}.`);
        return cue;
      }),
    })),
    baseCueHash: options.overlapArtifact.baseCueHash,
    baseTimingHash,
    generatedAt,
    alignmentVersion: runtimeCapability?.runtimeVersion ?? "C5.17",
    sudachiMorphemesByCueId: morphemesByCueId,
  });
  const outputPaths = {
    canonicalInput: path.join(
      options.subtitleDirectory,
      "subtitle-canonical-alignment-input.json",
    ),
    alignment: path.join(
      options.subtitleDirectory,
      "subtitle-canonical-forced-alignment.json",
    ),
    pronunciation:
      runtimeCapability === null
        ? null
        : path.join(
            options.subtitleDirectory,
            "subtitle-canonical-pronunciation.json",
          ),
    pronunciationDictionary:
      runtimeCapability === null
        ? null
        : path.join(
            options.subtitleDirectory,
            "subtitle-canonical-pronunciation.dict",
          ),
    runtimeCapability:
      runtimeCapability === null
        ? null
        : path.join(
            options.subtitleDirectory,
            "forced-alignment-runtime-capability.json",
          ),
    sudachiRuntimeCapability:
      sudachiRuntimeCapability === null
        ? null
        : path.join(
            options.subtitleDirectory,
            "sudachi-runtime-capability.json",
          ),
    cacheManifest: path.join(
      options.subtitleDirectory,
      "forced-alignment-cache-manifest.json",
    ),
  };
  const preparedPronunciation =
    runtimeCapability === null || sudachiRuntimeCapability === null
      ? null
      : await prepareCanonicalPronunciation({
          canonicalInput,
          mfaCapability: runtimeCapability,
          sudachiCapability: sudachiRuntimeCapability,
          dictionaryModelPath: options.mfaDictionaryModel,
          g2pModelPath: options.mfaG2pModel,
          mfaExecutable: options.mfaExecutable,
          runner: options.runner,
          cacheDirectory: path.join(
            options.forcedAlignmentCacheDirectory ??
              path.join(options.subtitleDirectory, ".forced-alignment-cache"),
            "canonical-pronunciation",
            CANONICAL_PRONUNCIATION_POLICY_VERSION,
          ),
          generatedAt,
        });
  if (
    preparedPronunciation !== null &&
    outputPaths.pronunciationDictionary !== null
  ) {
    await atomicWriteFile(
      outputPaths.pronunciationDictionary,
      preparedPronunciation.alignmentDictionary,
      { overwrite: true },
    );
  }
  const effectiveCanonicalCues = canonicalInput.cues.map((cue) => {
    const pronunciationCue = preparedPronunciation?.artifact.cues.find(
      (item) => item.cueId === cue.cueId,
    );
    if (pronunciationCue === undefined) return cue;
    const pronunciationByUnit = new Map(
      pronunciationCue.wordUnits.map((unit) => [unit.unitId, unit]),
    );
    const wordUnits = cue.wordUnits.map((unit) => ({
      ...unit,
      criticalOov:
        pronunciationByUnit.get(unit.unitId)?.isCriticalOov ?? unit.criticalOov,
    }));
    const lexical = wordUnits.filter((unit) => !unit.punctuation);
    const unresolvedOov = lexical
      .filter((unit) => unit.criticalOov)
      .map((unit) => unit.surface);
    const resolvedReading = lexical.filter((unit) => unit.reading !== null);
    return {
      ...cue,
      wordUnits,
      unresolvedOov,
      readingAvailable:
        unresolvedOov.length === 0 && resolvedReading.length > 0,
      readingCoverageRatio:
        lexical.length === 0 ? 0 : resolvedReading.length / lexical.length,
      blockers: [
        ...cue.blockers.filter(
          (blocker) => blocker !== "CRITICAL_OOV_READING_UNRESOLVED",
        ),
        ...(unresolvedOov.length === 0
          ? []
          : ["CRITICAL_OOV_PHONE_UNRESOLVED"]),
      ],
    };
  });
  const cache = new ForcedAlignmentCache({
    root:
      options.forcedAlignmentCacheDirectory ??
      path.join(options.subtitleDirectory, ".forced-alignment-cache"),
    importRoots: options.forcedAlignmentCacheImportPaths ?? [],
    mode: options.forcedAlignmentCacheMode ?? "read-write",
    version: runtimeCapability?.runtimeVersion ?? "C5.17",
  });
  const attempts: ForcedAlignmentAttempt[] = [];
  let mfaProcessCount = 0;
  const dependencyFailure: string | null = null;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "mvl-c5-17-forced-alignment-"),
  );
  try {
    if (runtimeCapability !== null) {
      for (const component of targetComponents) {
        const componentAudio = await resolveComponentAudio({
          component,
          subtitleDirectory: options.subtitleDirectory,
          sourceVideoPath: options.sourceVideoPath,
          runner: options.runner,
          ffmpegPath: options.ffmpegPath ?? "ffmpeg",
        });
        if (
          !component.audioFullyCoversComponent &&
          component.audioPath !== null
        ) {
          throw new InputError(
            `C5.17 refused an existing partial component WAV: ${component.componentId}.`,
          );
        }
        for (const cueId of component.cueIds) {
          const cue = requiredValue(
            targetCues.find((item) => item.id === cueId),
            `target cue ${cueId}`,
          );
          const canonicalCue = requiredValue(
            effectiveCanonicalCues.find((item) => item.cueId === cueId),
            `canonical cue ${cueId}`,
          );
          const pronunciationCue =
            preparedPronunciation?.artifact.cues.find(
              (item) => item.cueId === cueId,
            ) ?? null;
          if (
            runtimeCapability.runtimeVersion === "C5.17.1" &&
            pronunciationCue === null
          ) {
            throw new InputError(
              `Missing C5.17.1 canonical pronunciation cue ${cueId}.`,
            );
          }
          const pronunciationUnits =
            pronunciationCue?.wordUnits ??
            canonicalCue.wordUnits.map((unit) => ({
              ...unit,
              phones: [] as string[],
              isCriticalOov: unit.criticalOov,
            }));
          const windows = alignmentWindows({
            cue,
            extractionInterval: component.extractionInterval,
            configuration,
          });
          for (const window of windows) {
            const attemptId = `forced-alignment-attempt-${forcedAlignmentSha256(
              {
                componentId: component.componentId,
                cueId,
                window,
                canonicalTextSha256: canonicalCue.canonicalTextSha256,
                runtimeIdentityHash: runtimeCapability.runtimeIdentityHash,
              },
            ).slice(0, 20)}`;
            const attemptDirectory = path.join(temporaryRoot, attemptId);
            await mkdir(attemptDirectory, { recursive: true });
            const audioPath = path.join(attemptDirectory, "window.wav");
            const transcriptPath = path.join(
              attemptDirectory,
              "transcript.txt",
            );
            const outputFormat =
              runtimeCapability.commandCapabilities.selectedOutputFormat;
            const outputPath = path.join(
              attemptDirectory,
              outputFormat === "json" ? "alignment.json" : "alignment.TextGrid",
            );
            const audio = await extractAttemptAudio({
              componentAudioPath: componentAudio.path,
              outputPath: audioPath,
              window,
              runner: options.runner,
              ffmpegPath: options.ffmpegPath ?? "ffmpeg",
            });
            await atomicWriteFile(
              transcriptPath,
              `${pronunciationUnits
                .filter((unit) => !unit.punctuation)
                .map((unit) => unit.surface)
                .join(" ")}\n`,
              {
                overwrite: true,
              },
            );
            const commandMode =
              options.mfaExecutor === undefined
                ? runtimeCapability.commandCapabilities.alignOneCommand
                : "mock";
            const identity = cacheIdentity({
              audioSha256: audio.sha256,
              window,
              cue: canonicalCue,
              pronunciationCue,
              backend: options.backend,
              capability: runtimeCapability,
              configuration,
              commandMode,
            });
            const cached = await cache.get({
              identity,
              attemptId,
              cueId,
              componentId: component.componentId,
              windowType: window.type,
            });
            if (cached !== null) {
              attempts.push(cached);
              continue;
            }
            const executor = options.mfaExecutor ?? defaultMfaAlignmentExecutor;
            mfaProcessCount += 1;
            let execution: MfaAlignmentExecutorResult;
            try {
              execution = await executor({
                attemptId,
                componentId: component.componentId,
                cueId,
                windowType: window.type,
                windowAudioPath: audioPath,
                transcriptPath,
                outputPath,
                temporaryDirectory:
                  options.mfaTemporaryDirectory ??
                  path.join(attemptDirectory, "mfa-temp"),
                mediaOffsetSeconds: window.mediaStart,
                expectedUnitIds: pronunciationUnits
                  .filter((unit) => !unit.punctuation)
                  .map((unit) => unit.unitId),
                canonicalUnits: pronunciationUnits.map((unit) => ({
                  unitId: unit.unitId,
                  surface: unit.surface,
                  normalizedSurface: unit.normalizedSurface,
                  reading: unit.reading,
                  phones: unit.phones,
                  punctuation: unit.punctuation,
                  criticalOov: unit.isCriticalOov,
                })),
                expectedPhones: pronunciationCue?.expectedPhones ?? [],
                capability: runtimeCapability,
                mfaExecutable: options.mfaExecutable,
                pythonExecutable: options.pythonExecutable,
                acousticModel: options.mfaAcousticModel,
                dictionaryModel:
                  outputPaths.pronunciationDictionary ??
                  options.mfaDictionaryModel,
                g2pModel: options.mfaG2pModel,
                runner: options.runner,
                parserHelperPath:
                  options.parserHelperPath ??
                  path.resolve("scripts/parse-mfa-output.py"),
              });
            } catch (error) {
              execution = {
                parsed: null,
                exitCode: 1,
                wallClockSeconds: 0,
                failure: error instanceof Error ? error.message : String(error),
                warnings: [],
              };
            }
            const readingManifestSha256 = identity.readingManifestSha256;
            const attempt =
              execution.parsed === null || execution.failure !== null
                ? attemptFailure({
                    attemptId,
                    componentId: component.componentId,
                    cueId,
                    window,
                    audioSha256: audio.sha256,
                    audioDurationSeconds: audio.durationSeconds,
                    canonicalTextSha256: canonicalCue.canonicalTextSha256,
                    alignmentTextSha256: canonicalCue.alignmentTextSha256,
                    readingManifestSha256,
                    capability: runtimeCapability,
                    commandMode,
                    outputFormat:
                      commandMode === "mock" ? "mock-json" : outputFormat,
                    cacheHit: false,
                    exitCode: execution.exitCode,
                    wallClockSeconds: execution.wallClockSeconds,
                    failure:
                      execution.failure ?? "MFA_ALIGNMENT_OUTPUT_MISSING",
                    warnings: execution.warnings,
                  })
                : successfulAttempt({
                    attemptId,
                    componentId: component.componentId,
                    cueId,
                    window,
                    audioSha256: audio.sha256,
                    audioDurationSeconds: audio.durationSeconds,
                    canonicalTextSha256: canonicalCue.canonicalTextSha256,
                    alignmentTextSha256: canonicalCue.alignmentTextSha256,
                    readingManifestSha256,
                    expectedWordCount: canonicalCue.wordUnits.filter(
                      (unit) => !unit.punctuation,
                    ).length,
                    capability: runtimeCapability,
                    commandMode,
                    outputFormat:
                      commandMode === "mock" ? "mock-json" : outputFormat,
                    wallClockSeconds: execution.wallClockSeconds,
                    parsed: execution.parsed,
                    warnings: execution.warnings,
                  });
            attempts.push(attempt);
            await cache.put({ identity, attempt });
          }
        }
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  const cueAlignments: ForcedAlignmentCueDecision[] = [];
  for (const canonicalCue of effectiveCanonicalCues) {
    const cue = requiredValue(
      targetCues.find((item) => item.id === canonicalCue.cueId),
      `target cue ${canonicalCue.cueId}`,
    );
    const component = requiredValue(
      targetComponents.find(
        (item) => item.componentId === canonicalCue.componentId,
      ),
      `target component ${canonicalCue.componentId}`,
    );
    const evidence = componentEvidence({
      artifact: options.overlapArtifact,
      componentId: component.componentId,
      cue,
      window: component.extractionInterval,
    });
    const evidenceDp = alignCanonicalReadingWithEvidence({
      cue: canonicalCue,
      evidenceUnits:
        options.backend === "mfa-japanese" ? [] : evidence.evidenceUnits,
    });
    const narrow =
      attempts.find(
        (attempt) =>
          attempt.cueId === cue.id && attempt.windowType === "narrow",
      ) ?? null;
    const expanded =
      attempts.find(
        (attempt) =>
          attempt.cueId === cue.id && attempt.windowType === "expanded",
      ) ?? null;
    const orderedAllCues = [...options.cues].toSorted(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.id.localeCompare(right.id),
    );
    const componentCueIndexes = component.cueIds
      .map((cueId) => orderedAllCues.findIndex((item) => item.id === cueId))
      .filter((index) => index >= 0);
    const firstComponentCueIndex = Math.min(...componentCueIndexes);
    const lastComponentCueIndex = Math.max(...componentCueIndexes);
    const neighborCueIds = [
      orderedAllCues[firstComponentCueIndex - 1]?.id,
      orderedAllCues[lastComponentCueIndex + 1]?.id,
    ].filter((value): value is string => value !== undefined);
    const neighborIntervals = orderedAllCues
      .filter((item) => neighborCueIds.includes(item.id))
      .map((item) => ({ start: item.start, end: item.end }));
    cueAlignments.push(
      buildForcedAlignmentCueDecision({
        cue: canonicalCue,
        narrow,
        expanded,
        evidenceDp,
        mappedTokenIntervals: evidence.mappedTokenIntervals,
        rawVadIntervals: evidence.rawVadIntervals,
        decodedSegmentIntervals: evidence.decodedSegmentIntervals,
        neighborIntervals,
        configuration,
      }),
    );
  }
  const components = targetComponents.map((component) =>
    jointlyAssignForcedAlignmentComponent({
      componentId: component.componentId,
      componentInterval: component.unionInterval,
      canonicalCues: effectiveCanonicalCues.filter(
        (cue) => cue.componentId === component.componentId,
      ),
      cueAlignments: cueAlignments.filter((cue) =>
        component.cueIds.includes(cue.cueId),
      ),
      attempts: attempts.filter(
        (attempt) => attempt.componentId === component.componentId,
      ),
      mode: options.mode,
      configuration,
    }),
  );
  const applied = applyCanonicalForcedAlignment({
    cues: options.cues,
    components,
    mode: options.mode,
  });
  const baseOverlapArtifactHash = forcedAlignmentSha256({
    ...options.overlapArtifact,
    generatedAt: null,
    attempts: options.overlapArtifact.attempts.map((attempt) => ({
      ...attempt,
      cacheHit: false,
    })),
  });
  const artifact = buildSubtitleCanonicalForcedAlignment({
    generatedAt,
    sourceFingerprint: options.sourceFingerprint,
    baseCueHash: options.overlapArtifact.baseCueHash,
    baseTimingHash,
    baseOverlapArtifactHash,
    runtimeCapabilityRef:
      outputPaths.runtimeCapability === null
        ? null
        : path.basename(outputPaths.runtimeCapability),
    canonicalInputRef: path.basename(outputPaths.canonicalInput),
    configuration,
    attempts,
    cueAlignments,
    components,
    appliedMutations: applied.appliedMutations,
    eligibleCueCount: canonicalInput.summary.eligibleCueCount,
    ineligibleCueCount: canonicalInput.summary.ineligibleCueCount,
    mfaProcessCount,
  });
  const cacheManifest = cache.manifest({ generatedAt, mfaProcessCount });
  await Promise.all([
    atomicWriteJson(outputPaths.canonicalInput, canonicalInput, {
      overwrite: true,
    }),
    ...(preparedPronunciation === null || outputPaths.pronunciation === null
      ? []
      : [
          atomicWriteJson(
            outputPaths.pronunciation,
            preparedPronunciation.artifact,
            { overwrite: true },
          ),
        ]),
    atomicWriteJson(outputPaths.alignment, artifact, { overwrite: true }),
    atomicWriteJson(outputPaths.cacheManifest, cacheManifest, {
      overwrite: true,
    }),
    ...(runtimeCapability === null || outputPaths.runtimeCapability === null
      ? []
      : [
          atomicWriteJson(outputPaths.runtimeCapability, runtimeCapability, {
            overwrite: true,
          }),
        ]),
    ...(sudachiRuntimeCapability === null ||
    outputPaths.sudachiRuntimeCapability === null
      ? []
      : [
          atomicWriteJson(
            outputPaths.sudachiRuntimeCapability,
            sudachiRuntimeCapability,
            { overwrite: true },
          ),
        ]),
  ]);
  options.logger?.log("info", "Canonical forced alignment completed.", {
    componentCount: artifact.summary.componentCount,
    cueCount: artifact.summary.cueCount,
    attemptCount: artifact.summary.attemptCount,
    mfaProcessCount,
    cacheHitCount: artifact.summary.cacheHitCount,
    timingMutationCount: artifact.summary.timingMutationCount,
    unresolvedComponentCount: artifact.summary.unresolvedComponentCount,
  });
  return {
    artifact,
    canonicalInput,
    pronunciation: preparedPronunciation?.artifact ?? null,
    cacheManifest,
    cues: applied.cues,
    runtimeCapability,
    sudachiRuntimeCapability,
    dependencyFailure,
    wallClockSeconds: (performance.now() - started) / 1_000,
    outputPaths,
  };
}
