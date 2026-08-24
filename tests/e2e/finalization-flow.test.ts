import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ConsoleLogger,
  humanReviewResolutionsSchema,
  subtitlePackageSchema,
  subtitleReviewPackageSchema,
  type FinalizationCandidate,
} from "@mvl/shared";
import { calculateCandidateCoverage } from "@mvl/transcription-core";
import { loadGrammarInput } from "@mvl/grammar-report-core";
import { parseAss, parseSrt, parseVtt } from "@mvl/subtitle-core";
import {
  burnValidatedFinalSubtitle,
  finalizeSubtitleTask,
} from "@mvl/video-subtitler";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

async function fixture(
  validationStatus: "validated" | "needs-review" = "validated",
) {
  const root = await mkdtemp(path.join(tmpdir(), "mvl-finalization-"));
  temporaryDirectories.push(root);
  const subtitleDirectory = path.join(root, "subtitle-sample");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(subtitleDirectory, { recursive: true });
  const subtitlePackage = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "sample.mkv",
      container: "matroska",
      durationSeconds: 10,
    },
    identity: { title: "Sample", season: null, episode: 1, year: 2026 },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus,
      streamIndex: 1,
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
        id: "cue-a",
        start: 1,
        end: 2,
        language: "ja",
        languages: ["ja"],
        text: "古い文",
        speaker: null,
        confidence: 0.9,
      },
      {
        id: "cue-b",
        start: 3,
        end: 4,
        language: "ja",
        languages: ["ja"],
        text: "次の文。",
        speaker: null,
        confidence: 0.9,
      },
    ],
    warnings: [],
  });
  await writeFile(
    path.join(subtitleDirectory, "subtitle-package.json"),
    `${JSON.stringify(subtitlePackage, null, 2)}\n`,
  );
  await writeFile(
    path.join(subtitleDirectory, "subtitle-sample.srt"),
    "DRAFT\n",
  );
  return { root, subtitleDirectory, subtitlePackage };
}

function broadCandidate(): FinalizationCandidate {
  return {
    candidateId: "candidate-broad",
    targetCueIds: ["cue-a"],
    candidateText: "正しい文",
    candidateInterval: { start: 0, end: 5 },
    localInterval: null,
    associationType: "BROAD_WINDOW_ASSOCIATION",
    associationScore: null,
    associationMargin: null,
    sourceEvidenceIds: ["broad-window"],
    sourceRequestIds: ["request-one"],
    sourceProfileIds: ["profile-one"],
    independentSupportCount: 1,
    coverageMetrics: calculateCandidateCoverage({
      currentText: "古い文",
      candidateText: "正しい文",
    }),
    directAcousticSupport: false,
    partialFragment: false,
    timingResolved: false,
    languageIntegrityPassed: true,
    hallucinationQaPassed: true,
    repetitionQaPassed: true,
    presentationQaPassed: true,
    requestedAction: "REPLACE",
    automaticMutationEligible: false,
    requiresHumanReview: true,
    blockers: ["BROAD_WINDOW_ASSOCIATION", "LOCAL_INTERVAL_MISSING"],
  };
}

async function writeCandidates(directory: string) {
  await writeFile(
    path.join(directory, "subtitle-finalization-candidates.json"),
    `${JSON.stringify({ candidates: [broadCandidate()] }, null, 2)}\n`,
  );
}

describe("safe finalization integration", () => {
  it("creates an auto-validated final without human files when every gate passes", async () => {
    const input = await fixture();
    const result = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "auto",
    });
    expect(result.report.status).toBe("auto-validated");
    expect(result.report.finalizationMethod).toBe("automatic");
    expect(result.report.metrics.humanDecisionCount).toBe(0);
    expect(result.report.metrics.automaticCueRate).toBe(1);
    expect(result.report.qualityGate.passed).toBe(true);
    expect(result.outputPaths.reviewPage).toBeNull();
    expect(
      await readFile(
        path.join(input.subtitleDirectory, "subtitle-sample.srt"),
        "utf8",
      ),
    ).toBe("DRAFT\n");
    const finalPackage = subtitlePackageSchema.parse(
      JSON.parse(
        await readFile(result.outputPaths.subtitlePackage, "utf8"),
      ) as unknown,
    );
    expect(finalPackage.primarySubtitle?.validationStatus).toBe("validated");
    expect(
      parseSrt(await readFile(result.outputPaths.srt, "utf8")),
    ).toHaveLength(2);
    expect(
      parseVtt(await readFile(result.outputPaths.vtt, "utf8")),
    ).toHaveLength(2);
    expect(
      parseAss(await readFile(result.outputPaths.ass, "utf8")),
    ).toHaveLength(2);
    const grammarInput = await loadGrammarInput({
      inputPath: result.outputPaths.subtitlePackage,
    });
    expect(grammarInput.sourceType).toBe("subtitle-package");
    expect(grammarInput.cues).toHaveLength(2);
  });

  it("auto mode emits honest best-effort output without forcing a review page", async () => {
    const input = await fixture();
    await writeCandidates(input.subtitleDirectory);
    const result = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "auto",
    });
    expect(result.report.status).toBe("needs-review");
    expect(result.outputPaths.srt).toMatch(/best-effort\.srt$/u);
    expect(result.outputPaths.reviewPage).toBeNull();
    expect(result.subtitlePackage.primarySubtitle?.validationStatus).toBe(
      "needs-review",
    );
    expect(result.subtitlePackage.cues[0]?.text).toBe("古い文");
    expect(result.report.metrics.broadWindowVisibleMutationCount).toBe(0);
    expect(result.report.metrics.manualReviewCueRate).toBe(0.5);
  });

  it("review-fallback generates a strict local review package", async () => {
    const input = await fixture();
    await writeCandidates(input.subtitleDirectory);
    const result = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "review-fallback",
      generateReviewAudio: false,
    });
    expect(result.report.status).toBe("needs-review");
    expect(result.outputPaths.reviewPackage).not.toBeNull();
    expect(result.outputPaths.reviewPage).not.toBeNull();
    const reviewPath = result.outputPaths.reviewPackage;
    if (reviewPath === null)
      throw new Error("Review package was not generated.");
    const review = subtitleReviewPackageSchema.parse(
      JSON.parse(await readFile(reviewPath, "utf8")) as unknown,
    );
    expect(review.items).toHaveLength(1);
    expect(
      review.items[0]?.candidateSuggestions[0]?.automaticMutationEligible,
    ).toBe(false);
    expect(review.items[0]?.audioError).toBe("AUDIO_GENERATION_NOT_REQUESTED");
  });

  it("materializes final-integrity findings as resolvable review decisions", async () => {
    const input = await fixture();
    const duplicatePackage = {
      ...input.subtitlePackage,
      cues: input.subtitlePackage.cues.map((item, index) =>
        index === 1 ? { ...item, text: "古い文" } : item,
      ),
    };
    await writeFile(
      path.join(input.subtitleDirectory, "subtitle-package.json"),
      `${JSON.stringify(duplicatePackage, null, 2)}\n`,
    );
    const result = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "review-fallback",
      generateReviewAudio: false,
    });
    const reviewPath = result.outputPaths.reviewPackage;
    if (reviewPath === null)
      throw new Error("Review package was not generated.");
    const review = subtitleReviewPackageSchema.parse(
      JSON.parse(await readFile(reviewPath, "utf8")) as unknown,
    );
    expect(review.items).toHaveLength(1);
    expect(review.items[0]?.blockers).toContain(
      "UNRESOLVED_CROSS_CUE_REPETITION",
    );
    expect(review.items[0]?.allowedHumanActions).not.toContain(
      "ACCEPT_SUGGESTION",
    );
    expect(result.report.metrics.manualReviewCueRate).toBe(1);
  });

  it("human mode always prepares review and cannot masquerade as validated", async () => {
    const input = await fixture();
    const result = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "human",
      generateReviewAudio: false,
    });
    expect(result.report.status).toBe("needs-review");
    expect(result.report.metrics.reviewItemCount).toBe(2);
    expect(result.report.metrics.manualReviewCueRate).toBe(1);
    expect(result.outputPaths.reviewPage).not.toBeNull();
  });

  it("refuses burn-in for best-effort or needs-review subtitles", async () => {
    const input = await fixture();
    await writeCandidates(input.subtitleDirectory);
    const result = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "auto",
    });
    await expect(
      burnValidatedFinalSubtitle({
        result,
        mediaPath: path.join(input.root, "sample.mkv"),
        outputDirectory: input.root,
        logger: new ConsoleLogger(false, "error"),
      }),
    ).rejects.toThrow(/Burn-in requires/u);
  });

  it("imports human corrections, promotes one unified final, and is idempotent", async () => {
    const input = await fixture();
    await writeCandidates(input.subtitleDirectory);
    const prepared = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "review-fallback",
      generateReviewAudio: false,
    });
    const reviewPath = prepared.outputPaths.reviewPackage;
    if (reviewPath === null)
      throw new Error("Review package was not generated.");
    const review = subtitleReviewPackageSchema.parse(
      JSON.parse(await readFile(reviewPath, "utf8")) as unknown,
    );
    const item = review.items[0];
    if (item === undefined) throw new Error("Review fixture has no item.");
    const resolutions = humanReviewResolutionsSchema.parse({
      schemaVersion: "1.0.0",
      resolutionType: "human-review-resolutions",
      reviewVersion: review.reviewVersion,
      sourceFingerprint: review.sourceFingerprint,
      baseSubtitlePackageHash: review.baseSubtitlePackageHash,
      baseCueHash: review.baseCueHash,
      inputEvidenceHash: review.inputEvidenceHash,
      resolutions: [
        {
          resolutionId: "resolution-a",
          reviewId: item.reviewId,
          action: "EDIT_TEXT",
          selectedCandidateId: null,
          correctedText: "人が確認した文",
          start: null,
          end: null,
          splitParts: [],
          mergeCueIds: [],
          reviewerNotes: "audio checked",
          errorTypes: ["KANJI_SELECTION_ERROR"],
          confirmedReading: null,
          terminologyHints: [],
          dialectHints: [],
        },
      ],
    });
    const resolutionsPath = path.join(
      input.root,
      "human-review-resolutions.json",
    );
    await writeFile(
      resolutionsPath,
      `${JSON.stringify(resolutions, null, 2)}\n`,
    );
    const first = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "review-fallback",
      resolutionsPath,
    });
    const second = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "review-fallback",
      resolutionsPath,
    });
    expect(first.report.status).toBe("human-validated");
    expect(first.report.finalizationMethod).toBe("human");
    expect(first.subtitlePackage.cues[0]?.text).toBe("人が確認した文");
    expect(first.report.outputHash).toBe(second.report.outputHash);
    expect(first.report.outputCueHash).toBe(second.report.outputCueHash);
    expect(first.outputPaths.correctionFeedback).not.toBeNull();
    expect(first.outputPaths.subtitlePackage).toMatch(
      /subtitle-package\.final\.json$/u,
    );
  });
});
