import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  subtitlePackageSchema,
  subtitleReviewPackageSchema,
  type CueDecision,
  type ProcessRunner,
  type SubtitleCue,
} from "@mvl/shared";
import { summarizeSrtOverlapStatus } from "@mvl/transcription-core";
import { formatSrt, parseSrt } from "@mvl/subtitle-core";
import {
  prepareSubtitleReviewPackage,
  reviewAudioBounds,
  reviewComponentUnionInterval,
} from "@mvl/video-subtitler";

const temporaryDirectories: string[] = [];
const HASH = "a".repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function cue(id: string, start: number, end: number, text = id): SubtitleCue {
  return {
    id,
    start,
    end,
    text,
    language: "ja",
    languages: ["ja"],
    speaker: null,
    confidence: 1,
  };
}

function decision(targetCueIds: string[]): CueDecision {
  return {
    decisionId: `decision-${targetCueIds.join("-")}`,
    targetCueIds,
    action: "REVIEW_ONLY",
    currentText: "review",
    proposedText: null,
    proposedCues: [],
    selectedCandidateId: null,
    alternativeCandidateIds: [],
    evidenceIds: [],
    blockers: ["UNRESOLVED_OVERLAP"],
    automaticMutationEligible: false,
    requiresHumanReview: true,
    decisionReasons: ["UNRESOLVED_OVERLAP"],
  };
}

describe("C5.15 review component union", () => {
  it("uses the full union for two ordinary adjacent cues", () => {
    expect(
      reviewComponentUnionInterval([cue("a", 1, 2), cue("b", 2, 4)]),
    ).toEqual({ start: 1, end: 4 });
  });

  it("does not truncate a containing cue to the nested cue end", () => {
    expect(
      reviewComponentUnionInterval([cue("outer", 1, 8), cue("inner", 3, 4)]),
    ).toEqual({ start: 1, end: 8 });
  });

  it("uses min start and max end for a three-cue component", () => {
    expect(
      reviewComponentUnionInterval([
        cue("middle", 3, 6),
        cue("left", 1, 4),
        cue("right", 5, 9),
      ]),
    ).toEqual({ start: 1, end: 9 });
  });

  it("clips context at media start without clipping the component", () => {
    expect(
      reviewAudioBounds({
        start: 0.2,
        end: 2,
        duration: 20,
        contextSeconds: 1.5,
        maximumSeconds: 4,
      }),
    ).toEqual({ start: 0, end: 3.5 });
  });

  it("clips context at media end without clipping the component", () => {
    expect(
      reviewAudioBounds({
        start: 18,
        end: 19.8,
        duration: 20,
        contextSeconds: 1.5,
        maximumSeconds: 4,
      }),
    ).toEqual({ start: 16.5, end: 20 });
  });

  it("treats the maximum as soft when the component itself is longer", () => {
    expect(
      reviewAudioBounds({
        start: 5,
        end: 20,
        duration: 30,
        contextSeconds: 2,
        maximumSeconds: 10,
      }),
    ).toEqual({ start: 5, end: 20 });
  });

  it("writes current bounds and extracted audio bounds from the union", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "c5-15-review-"));
    temporaryDirectories.push(root);
    const subtitleDirectory = path.join(root, "subtitle-sample");
    await mkdir(subtitleDirectory, { recursive: true });
    const cues = [cue("outer", 2, 9), cue("inner", 4, 5)];
    const subtitlePackage = subtitlePackageSchema.parse({
      schemaVersion: "1.0.0",
      packageType: "multilingual-subtitle-package",
      status: "ready",
      sourceLanguage: "ja",
      detectedLanguages: ["ja"],
      source: {
        fileName: "sample.mkv",
        container: "matroska",
        durationSeconds: 12,
      },
      identity: { title: "Sample", season: null, episode: null, year: null },
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
      cues,
      warnings: [],
    });
    const runner: ProcessRunner = {
      async run(_executable, args) {
        const output = args.at(-1);
        if (output === undefined) throw new Error("missing output");
        await writeFile(output, "fixture-audio");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    const result = await prepareSubtitleReviewPackage({
      subtitleDirectory,
      baseSubtitlePackagePath: path.join(
        subtitleDirectory,
        "subtitle-package.json",
      ),
      baseSubtitlePackageHash: HASH,
      baseCueHash: HASH,
      inputEvidenceHash: HASH,
      sourceFingerprint: {
        fileName: "sample.mkv",
        size: 10,
        durationSeconds: 12,
        sha256: HASH,
      },
      sourceVideoPath: path.join(root, "sample.mkv"),
      subtitlePackage,
      cues,
      candidates: [],
      decisions: [decision(["outer", "inner"])],
      findings: [],
      runner,
      ffmpegPath: "ffmpeg",
      generateAudio: true,
      reviewAllCues: false,
      contextSeconds: 1.5,
      maximumClipSeconds: 30,
    });
    const item = result.reviewPackage.items[0];
    expect(item).toMatchObject({
      interval: { start: 2, end: 9 },
      componentUnionInterval: { start: 2, end: 9 },
      currentStart: 2,
      currentEnd: 9,
      audioRequestedInterval: { start: 0.5, end: 10.5 },
      audioExtractedInterval: { start: 0.5, end: 10.5 },
      audioFullyCoversComponent: true,
    });
    expect(result.reviewPackage.summary.audioCoverageFailureCount).toBe(0);
  });

  it("continues to parse an old C5.14 review package", () => {
    const parsed = subtitleReviewPackageSchema.parse({
      schemaVersion: "1.0.0",
      packageType: "multilingual-subtitle-review-package",
      reviewVersion: "review-v1-c5-14",
      generatedAt: "2026-08-25T00:00:00.000Z",
      sourceFingerprint: {
        fileName: "sample.mkv",
        size: 1,
        durationSeconds: 10,
        sha256: HASH,
      },
      baseSubtitlePackagePath: "./subtitle-package.json",
      baseSubtitlePackageHash: HASH,
      baseCueHash: HASH,
      inputEvidenceHash: HASH,
      items: [
        {
          reviewId: "review-old",
          targetCueIds: ["cue-old"],
          interval: { start: 1, end: 2 },
          currentText: "旧形式",
          currentStart: 1,
          currentEnd: 2,
          currentStyle: "default",
          currentSpeaker: null,
          previousCue: null,
          nextCue: null,
          machineDecision: decision(["cue-old"]),
          candidateSuggestions: [],
          findingIds: [],
          blockers: ["UNRESOLVED_OVERLAP"],
          allowedHumanActions: ["KEEP", "MARK_UNRESOLVED"],
          audioClipPath: null,
          audioError: "SOURCE_VIDEO_UNAVAILABLE",
          requiresHumanReview: true,
        },
      ],
      summary: {
        itemCount: 1,
        mandatoryItemCount: 1,
        audioClipCount: 0,
        audioFailureCount: 1,
      },
    });
    expect(parsed.items[0]?.audioRequestedInterval).toBeNull();
    expect(parsed.summary.audioCoverageFailureCount).toBe(0);
  });
});

describe("C5.15 SRT overlap status", () => {
  const status = (
    cues: SubtitleCue[],
    decisions: { cueIds: string[]; blocking: boolean }[],
  ) => summarizeSrtOverlapStatus({ cues, decisions });

  it("reports all fields false without overlap", () => {
    expect(status([cue("a", 1, 2), cue("b", 2, 3)], [])).toEqual({
      serializedSrtContainsOverlap: false,
      legalSrtOverlapRenderingMayVary: false,
      unresolvedSrtOverlapPresent: false,
      srtOverlapRenderingMayVary: false,
    });
  });

  it("distinguishes unresolved overlap", () => {
    expect(
      status(
        [cue("a", 1, 3), cue("b", 2, 4)],
        [{ cueIds: ["a", "b"], blocking: true }],
      ),
    ).toMatchObject({
      serializedSrtContainsOverlap: true,
      legalSrtOverlapRenderingMayVary: false,
      unresolvedSrtOverlapPresent: true,
      srtOverlapRenderingMayVary: true,
    });
  });

  it("distinguishes legal overlap", () => {
    expect(
      status(
        [cue("a", 1, 3), cue("b", 2, 4)],
        [{ cueIds: ["a", "b"], blocking: false }],
      ),
    ).toMatchObject({
      serializedSrtContainsOverlap: true,
      legalSrtOverlapRenderingMayVary: true,
      unresolvedSrtOverlapPresent: false,
    });
  });

  it("reports legal and unresolved overlap in a mixed sequence", () => {
    expect(
      status(
        [
          cue("legal-a", 1, 3),
          cue("legal-b", 2, 4),
          cue("open-a", 5, 7),
          cue("open-b", 6, 8),
        ],
        [
          { cueIds: ["legal-a", "legal-b"], blocking: false },
          { cueIds: ["open-a", "open-b"], blocking: true },
        ],
      ),
    ).toMatchObject({
      serializedSrtContainsOverlap: true,
      legalSrtOverlapRenderingMayVary: true,
      unresolvedSrtOverlapPresent: true,
    });
  });

  it("detects nested overlap beyond only the immediately previous cue", () => {
    const cues = [
      cue("outer", 1, 10),
      cue("inner-a", 2, 3),
      cue("inner-b", 4, 5),
    ];
    expect(
      status(cues, [{ cueIds: cues.map((item) => item.id), blocking: true }]),
    ).toMatchObject({
      serializedSrtContainsOverlap: true,
      unresolvedSrtOverlapPresent: true,
    });
  });

  it("matches the overlap actually serialized by SRT", () => {
    const source = [cue("a", 1, 3, "一"), cue("b", 2, 4, "二")];
    const serialized = parseSrt(formatSrt(source));
    const report = status(source, [{ cueIds: ["a", "b"], blocking: true }]);
    const actual = serialized.some((item, index) => {
      const previous = serialized[index - 1];
      return previous !== undefined && item.start < previous.end;
    });
    expect(report.serializedSrtContainsOverlap).toBe(actual);
    expect(report.srtOverlapRenderingMayVary).toBe(actual);
  });
});
