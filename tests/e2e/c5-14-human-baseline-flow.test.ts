import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
} from "@mvl/shared";
import { parseSrt, presentationLexicalHash } from "@mvl/subtitle-core";
import { finalizeSubtitleTask, sha256LocalFile } from "@mvl/video-subtitler";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

async function fixture(): Promise<{
  root: string;
  subtitleDirectory: string;
  reviewedPath: string;
  canonicalTexts: string[];
}> {
  const root = await mkdtemp(path.join(tmpdir(), "mvl-c5-14-e2e-"));
  temporaryDirectories.push(root);
  const subtitleDirectory = path.join(root, "subtitle-sample");
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(subtitleDirectory, { recursive: true }),
  );
  const packageValue = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "sample.mkv",
      container: "matroska",
      durationSeconds: 20,
    },
    identity: {
      title: "sample",
      season: null,
      episode: null,
      year: null,
    },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      srt: "./subtitle-sample.srt",
      vtt: "./subtitle-sample.vtt",
      ass: "./subtitle-sample.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues: [
      {
        id: "machine-cue",
        start: 1,
        end: 2,
        language: "ja",
        languages: ["ja"],
        text: "machine draft",
        speaker: null,
        confidence: 0.5,
      },
    ],
    warnings: [],
  });
  await writeFile(
    path.join(subtitleDirectory, "subtitle-package.json"),
    `${JSON.stringify(packageValue, null, 2)}\n`,
  );
  const canonicalTexts = [
    "女の子やからって 乗らせてもらえませんでした",
    "待てー!",
    "待てー!",
    "前の台詞",
    "次の台詞",
  ];
  const reviewedPath = path.join(root, "human-reviewed.ass");
  await writeFile(
    reviewedPath,
    `[Script Info]
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,${canonicalTexts[0]}
Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,${canonicalTexts[1]}
Dialogue: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,${canonicalTexts[2]}
Dialogue: 0,0:00:08.00,0:00:10.00,Default,,0,0,0,,${canonicalTexts[3]}
Dialogue: 0,0:00:09.00,0:00:11.00,Default,,0,0,0,,${canonicalTexts[4]}
`,
  );
  return { root, subtitleDirectory, reviewedPath, canonicalTexts };
}

describe("C5.14 offline human-baseline finalization", () => {
  it("separates canonical and presentation data and reviews only unresolved overlap", async () => {
    const input = await fixture();
    const reviewedHash = await sha256LocalFile(input.reviewedPath);
    const result = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "review-fallback",
      humanReviewedSubtitlePath: input.reviewedPath,
      presentationResolution: "enforce",
      overlapResolution: "conservative",
      prepareReview: true,
      generateReviewAudio: false,
    });

    expect(result.report.status).toBe("needs-review");
    expect(result.report.finalizationMethod).toBe("none");
    expect(result.report.metrics.finalCueCount).toBe(5);
    expect(result.report.metrics.reviewItemCount).toBe(1);
    expect(result.report.metrics.presentationAutoResolvedCueRate).toBe(0.2);
    expect(result.report.metrics.intentionalRepetitionResolvedCueRate).toBe(
      0.4,
    );
    expect(result.report.metrics.autoMutationCueRate).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- verifies the C5.14 compatibility alias
    expect(result.report.metrics.automaticCueRate).toBe(
      result.report.metrics.autoResolvedCueRate,
    );
    expect(result.report.qualityGate.canonicalParityPassed).toBe(true);
    expect(result.report.qualityGate.presentationParityPassed).toBe(true);
    expect(await sha256LocalFile(input.reviewedPath)).toBe(reviewedHash);

    const finalPackage = subtitlePackageSchema.parse(
      JSON.parse(
        await readFile(result.outputPaths.subtitlePackage, "utf8"),
      ) as unknown,
    );
    expect(finalPackage.cues.map((cue) => cue.text)).toEqual(
      input.canonicalTexts,
    );
    expect(finalPackage.cues).toHaveLength(5);
    expect(
      finalPackage.cues.some(
        (cue) => "displayText" in cue || "assLayer" in cue,
      ),
    ).toBe(false);

    const presentation = subtitlePresentationResolutionSchema.parse(
      JSON.parse(
        await readFile(result.outputPaths.presentationResolution, "utf8"),
      ) as unknown,
    );
    expect(presentation.summary).toMatchObject({
      canonicalCueCount: 5,
      presentationCueCount: 5,
      layoutChangedCount: 1,
      layoutResolvedCount: 1,
      repetitionDecisionCount: 1,
      repetitionResolvedCount: 1,
      overlapPairCount: 1,
      overlapComponentCount: 1,
      overlapBlockingCount: 1,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      presentationCreatedTemporalCueCount: 0,
      reviewGroupCount: 1,
    });
    expect(presentation.overlapDecisions[0]?.relationship).toBe("unresolved");

    const parsedSrt = parseSrt(await readFile(result.outputPaths.srt, "utf8"));
    expect(parsedSrt).toHaveLength(5);
    expect(parsedSrt[0]?.text.split("\n")).toHaveLength(2);
    expect(
      parsedSrt[0]?.text
        .split("\n")
        .every((line) => Array.from(line).length <= 16),
    ).toBe(true);
    expect(presentationLexicalHash(parsedSrt[0]?.text ?? "")).toBe(
      presentationLexicalHash(input.canonicalTexts[0] ?? ""),
    );
  });
});
