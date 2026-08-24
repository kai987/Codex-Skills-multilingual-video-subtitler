import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  overlapAcousticAttemptSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePackageSchema,
  subtitleReviewPackageSchema,
  type OverlapAcousticAttempt,
  type OverlapAcousticProfile,
  type WhisperExecutionMetrics,
} from "@mvl/shared";
import {
  buildSubtitleOverlapAcousticResolution,
  classifyOverlapAcousticComponent,
  planOverlapAcousticComponents,
  presentationResolutionHash,
} from "@mvl/transcription-core";
import {
  parseAss,
  parseSrt,
  parseVtt,
  presentationLexicalHash,
} from "@mvl/subtitle-core";
import {
  finalizeSubtitleTask,
  type TargetedOverlapAcousticOptions,
  type TargetedOverlapAcousticResult,
} from "@mvl/video-subtitler";

const HASH = "a".repeat(64);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

interface Span {
  text: string;
  start: number;
  end: number;
}

function attempt(
  componentId: string,
  profile: OverlapAcousticProfile,
  spans: readonly Span[],
): OverlapAcousticAttempt {
  return overlapAcousticAttemptSchema.parse({
    attemptId: `attempt-${componentId}-${profile}`,
    componentId,
    profile,
    requestId: `request-${componentId}-${profile}`,
    requestType: "overlap-evidence",
    useVad: profile !== "no-vad",
    vadProfile: profile === "no-vad" ? "no-vad" : profile,
    model: "ggml-large-v3.bin",
    modelHash: HASH,
    modelFamily: "large-v3",
    coreML: false,
    whisperCppVersion: "mock-1.0",
    cacheHit: false,
    promptSha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    targetCueTextUsedAsPrompt: false,
    referenceTranslationUsedAsPrompt: false,
    humanReviewedSentenceUsedAsPrompt: false,
    rawText: spans.map((span) => span.text).join(""),
    segments: [],
    tokens: spans.map((span, index) => ({
      tokenId: `token-${componentId}-${profile}-${index}`,
      text: span.text,
      start: span.start,
      end: span.end,
      probability: 0.95,
    })),
    speechIntervals: spans.map(({ start, end }) => ({ start, end })),
    metrics: {
      durationSeconds: 5,
      segmentCount: 0,
      tokenCount: spans.length,
      speechIntervalCount: spans.length,
      tokenTimestampsRequested: true,
      tokenTimestampsUsed: true,
    },
    language: "ja",
    failure: null,
  });
}

function mockMetrics(requestCount: number): WhisperExecutionMetrics {
  return {
    schemaVersion: "1.0.0",
    requestedMode: "persistent",
    executionMode: "persistent",
    backend: "cpu",
    asrRequestCount: requestCount,
    cacheHitCount: 0,
    workerStartCount: 1,
    modelLoadCount: 1,
    initializationSeconds: 0.1,
    modelLoadSeconds: 0.1,
    coreMLWarmupSeconds: 0,
    transcriptionSeconds: 0.2,
    totalWorkerSeconds: 0.3,
    fallbackProcessCount: 0,
    requests: [],
    workers: [],
    fallbackReason: null,
  };
}

function evidenceFor(texts: readonly string[]): Span[] {
  const joined = texts.join("|");
  const first = texts[0] ?? "";
  const second = texts[1] ?? "";
  const third = texts[2] ?? "";
  if (joined.includes("さきのことば")) {
    return [
      { text: first, start: 10.1, end: 10.9 },
      { text: second, start: 11.1, end: 12.2 },
    ];
  }
  if (joined.includes("はいどうぞ")) {
    return [
      { text: first, start: 20.1, end: 21.05 },
      { text: second, start: 21, end: 22.2 },
    ];
  }
  if (joined.includes("そーりゃ")) {
    return [
      { text: first, start: 30.1, end: 32.9 },
      { text: second, start: 31.05, end: 31.95 },
    ];
  }
  if (joined.includes("ながいうたごえ")) {
    return [
      { text: first, start: 40.1, end: 42.9 },
      { text: second, start: 41.05, end: 41.95 },
    ];
  }
  if (joined.includes("みぎへいく")) {
    return [
      { text: first, start: 50.1, end: 51.8 },
      { text: second, start: 50.6, end: 52.3 },
    ];
  }
  if (joined.includes("ひとつめ")) {
    return [
      { text: first, start: 60.1, end: 60.9 },
      { text: second, start: 61.1, end: 61.9 },
      { text: third, start: 62.1, end: 63.2 },
    ];
  }
  return [];
}

async function mockAcousticExecutor(
  options: TargetedOverlapAcousticOptions,
): Promise<TargetedOverlapAcousticResult> {
  const plans = planOverlapAcousticComponents({
    cues: options.cues,
    presentation: options.presentation.artifact,
    mediaDurationSeconds: 90,
    configuration: options.configuration,
  });
  const cueById = new Map(options.cues.map((item) => [item.id, item]));
  const decisionById = new Map(
    options.presentation.artifact.overlapDecisions.map((item) => [
      item.decisionId,
      item,
    ]),
  );
  const profiles = [
    "current-sensitive-vad",
    "no-vad",
    "extra-sensitive-vad",
  ] as const;
  const attempts = plans.flatMap((componentPlan) => {
    const texts = componentPlan.cueIds.map(
      (cueId) => cueById.get(cueId)?.text ?? "",
    );
    const spans = evidenceFor(texts);
    return spans.length === 0
      ? []
      : profiles.map((profile) =>
          attempt(componentPlan.componentId, profile, spans),
        );
  });
  const components = plans.map((componentPlan) => {
    const sourceDecision = decisionById.get(
      componentPlan.sourceOverlapDecisionId,
    );
    if (sourceDecision === undefined)
      throw new Error("missing source decision");
    return classifyOverlapAcousticComponent({
      plan: componentPlan,
      allCues: options.cues,
      sourceDecision,
      attempts,
      mode: options.mode,
      configuration: options.configuration,
      audioPath: `audio/overlap/${componentPlan.componentId}.wav`,
      audioSha256: HASH,
      audioDurationSeconds:
        componentPlan.extractionInterval.end -
        componentPlan.extractionInterval.start,
      audioFullyCoversComponent: true,
    });
  });
  const artifact = buildSubtitleOverlapAcousticResolution({
    generatedAt: "2026-08-25T00:00:00.000Z",
    sourceFingerprint: options.sourceFingerprint,
    baseCueHash: options.baseCueHash,
    basePresentationResolutionHash: presentationResolutionHash({
      ...options.presentation.artifact,
      generatedAt: null,
    }),
    mode: options.mode,
    audioStreamIndex: options.audioStreamIndex ?? 1,
    configuration: options.configuration,
    attempts,
    components,
  });
  const outputPaths = {
    resolution: path.join(
      options.subtitleDirectory,
      "subtitle-overlap-acoustic-resolution.json",
    ),
    executionMetrics: path.join(
      options.subtitleDirectory,
      "overlap-whisper-execution-metrics.json",
    ),
    cacheManifest: path.join(
      options.subtitleDirectory,
      "overlap-asr-cache-manifest.json",
    ),
  };
  const executionMetrics = mockMetrics(attempts.length);
  await Promise.all([
    writeFile(outputPaths.resolution, `${JSON.stringify(artifact, null, 2)}\n`),
    writeFile(
      outputPaths.executionMetrics,
      `${JSON.stringify(executionMetrics, null, 2)}\n`,
    ),
    writeFile(
      outputPaths.cacheManifest,
      `${JSON.stringify({ requestType: "overlap-evidence" }, null, 2)}\n`,
    ),
  ]);
  return {
    artifact,
    executionMetrics,
    audioStreamIndex: options.audioStreamIndex ?? 1,
    dependencyFailure: null,
    wallClockSeconds: 0.3,
    outputPaths,
  };
}

function assDialogue(start: string, end: string, text: string): string {
  return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
}

describe("C5.15 mock overlap finalization flow", () => {
  it("resolves six evidence-backed components and reviews only the unresolved component", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "c5-15-e2e-"));
    temporaryDirectories.push(root);
    const subtitleDirectory = path.join(root, "subtitle-sample");
    await mkdir(subtitleDirectory, { recursive: true });
    const sourceVideoPath = path.join(root, "sample.mkv");
    await writeFile(sourceVideoPath, "read-only-source-fixture");
    const base = subtitlePackageSchema.parse({
      schemaVersion: "1.0.0",
      packageType: "multilingual-subtitle-package",
      status: "ready",
      sourceLanguage: "ja",
      detectedLanguages: ["ja"],
      source: {
        fileName: "sample.mkv",
        container: "matroska",
        durationSeconds: 90,
      },
      identity: { title: "Sample", season: null, episode: 1, year: 2026 },
      primarySubtitle: {
        language: "ja",
        sourceType: "transcription",
        validationStatus: "needs-review",
        streamIndex: 1,
      },
      subtitleFiles: {
        srt: "./sample.srt",
        vtt: "./sample.vtt",
        ass: "./sample.ass",
      },
      referenceSubtitles: [],
      video: { sourcePath: null, subtitledPath: null },
      cues: [
        {
          id: "placeholder",
          start: 1,
          end: 2,
          text: "仮",
          language: "ja",
          languages: ["ja"],
          speaker: null,
          confidence: 1,
        },
      ],
      warnings: [],
    });
    await writeFile(
      path.join(subtitleDirectory, "subtitle-package.json"),
      `${JSON.stringify(base, null, 2)}\n`,
    );
    const humanPath = path.join(root, "human-reviewed.ass");
    const dialogues = [
      assDialogue("0:00:10.00", "0:00:11.40", "さきのことば"),
      assDialogue("0:00:11.00", "0:00:12.40", "つぎのことば"),
      assDialogue("0:00:20.00", "0:00:21.40", "はいどうぞ"),
      assDialogue("0:00:21.00", "0:00:22.40", "ありがとう"),
      assDialogue("0:00:30.00", "0:00:33.00", "そーりゃ!そーりゃ!"),
      assDialogue("0:00:31.00", "0:00:32.00", "みちをあけて"),
      assDialogue("0:00:40.00", "0:00:43.00", "ながいうたごえ"),
      assDialogue("0:00:41.00", "0:00:42.00", "こっちへ"),
      assDialogue("0:00:50.00", "0:00:52.00", "みぎへいく"),
      assDialogue("0:00:50.50", "0:00:52.50", "ひだりへいく"),
      assDialogue("0:01:00.00", "0:01:01.40", "ひとつめ"),
      assDialogue("0:01:01.00", "0:01:02.40", "ふたつめ"),
      assDialogue("0:01:02.00", "0:01:03.40", "みっつめ"),
      assDialogue("0:01:10.00", "0:01:12.00", "きこえない"),
      assDialogue("0:01:11.00", "0:01:13.00", "ふめい"),
    ];
    await writeFile(
      humanPath,
      `[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${dialogues.join("\n")}\n`,
    );
    const originalHuman = await readFile(humanPath, "utf8");
    const originalSource = await readFile(sourceVideoPath, "utf8");

    const result = await finalizeSubtitleTask({
      taskDirectory: root,
      mode: "review-fallback",
      humanReviewedSubtitlePath: humanPath,
      sourceVideoPath,
      presentationResolution: "enforce",
      overlapResolution: "conservative",
      overlapAcousticResolution: "enforce",
      audioTrack: 1,
      prepareReview: true,
      generateReviewAudio: false,
      overlapAcousticExecutor: mockAcousticExecutor,
    });

    expect(result.report.finalizationVersion).toBe("1.3.0-C5.15");
    expect(result.report.status).toBe("needs-review");
    expect(result.subtitlePackage.primarySubtitle?.validationStatus).toBe(
      "needs-review",
    );
    expect(result.subtitlePackage.cues).toHaveLength(15);
    expect(result.subtitlePackage.cues.map((item) => item.text)).toEqual(
      dialogues.map((line) => line.split(",").at(-1)),
    );
    expect(result.report.metrics).toMatchObject({
      overlapComponentCount: 7,
      overlapAcousticAnalyzedCount: 7,
      overlapAcousticResolvedCount: 6,
      overlapTimingOnlyResolvedCount: 2,
      unresolvedOverlapCount: 1,
      wholeMediaAsrRequestCount: 0,
      finalCueCount: 15,
      reviewItemCount: 1,
    });
    expect(result.report.qualityGate).toMatchObject({
      canonicalParityPassed: true,
      presentationParityPassed: true,
      serializedSrtContainsOverlap: true,
      legalSrtOverlapRenderingMayVary: true,
      unresolvedSrtOverlapPresent: true,
    });

    const acoustic = subtitleOverlapAcousticResolutionSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            subtitleDirectory,
            "subtitle-overlap-acoustic-resolution.json",
          ),
          "utf8",
        ),
      ) as unknown,
    );
    expect(acoustic.summary.canonicalTextMutationCount).toBe(0);
    expect(
      new Set(acoustic.components.map((item) => item.finalRelationship)),
    ).toEqual(
      new Set([
        "different-dialogue-boundary-error",
        "rapid-turn-taking",
        "crowd-call-plus-dialogue",
        "nested-background-speech",
        "true-simultaneous-speech",
        "unresolved",
      ]),
    );
    const timingMutations = acoustic.components.flatMap(
      (item) => item.timingMutations,
    );
    expect(timingMutations).toEqual(
      timingMutations.map((item) => ({ ...item, textChanged: false })),
    );

    if (result.outputPaths.reviewPackage === null)
      throw new Error("review package missing");
    const review = subtitleReviewPackageSchema.parse(
      JSON.parse(
        await readFile(result.outputPaths.reviewPackage, "utf8"),
      ) as unknown,
    );
    expect(review.items).toHaveLength(1);
    expect(review.items[0]?.currentText).toContain("きこえない");
    expect(review.items[0]?.currentText).toContain("ふめい");

    const serialized = await Promise.all([
      readFile(result.outputPaths.srt, "utf8").then(parseSrt),
      readFile(result.outputPaths.vtt, "utf8").then(parseVtt),
      readFile(result.outputPaths.ass, "utf8").then(parseAss),
    ]);
    const lexical = (items: ReturnType<typeof parseSrt>) =>
      items.map((item) => presentationLexicalHash(item.text));
    expect(serialized.map(lexical)).toEqual([
      lexical(serialized[0]),
      lexical(serialized[0]),
      lexical(serialized[0]),
    ]);
    expect(subtitlePackageSchema.parse(result.subtitlePackage)).toEqual(
      result.subtitlePackage,
    );
    expect(await readFile(humanPath, "utf8")).toBe(originalHuman);
    expect(await readFile(sourceVideoPath, "utf8")).toBe(originalSource);
  });
});
