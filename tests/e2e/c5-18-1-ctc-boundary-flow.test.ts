import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { CtcAlignmentAttempt, SubtitleReviewPackage } from "@mvl/shared";
import {
  CTC_VITERBI_POLICY,
  buildLocalCtcBoundaryEvidence,
  writeSubtitleReviewPage,
  type CtcCueEvidenceInput,
} from "@mvl/video-subtitler";

const HASH = "a".repeat(64);
const directories: string[] = [];

afterAll(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function attempt(input: {
  cueId: string;
  componentId: string;
  windowType: "narrow" | "expanded";
  interval: { start: number; end: number };
}): CtcAlignmentAttempt {
  return {
    attemptId: `${input.componentId}-${input.cueId}-${input.windowType}`,
    cueId: input.cueId,
    componentId: input.componentId,
    windowType: input.windowType,
    audioSha256: HASH,
    audioSampleRate: 16_000,
    audioFrameCount: 16_000,
    audioDurationSeconds: 1,
    audioLocalInterval: { start: 0, end: 1 },
    mediaGlobalInterval: input.interval,
    target: {
      targetText: "はい",
      targetTextSha256: HASH,
      tokenIds: [1, 2],
      tokenPieces: ["は", "い"],
      unknownTokenCount: 0,
      specialTokenCount: 0,
      targetEncodable: true,
      blockers: [],
    },
    targetTokenCount: 2,
    cacheHit: false,
    inferenceExecuted: true,
    modelLoadCount: 0,
    pathStatus: "success",
    pathExists: true,
    predictedFrameCount: 49,
    logitsFrameCount: 49,
    expectedFrameCount: 49,
    frameCountVerified: true,
    tokenSpans: [],
    selectedBoundary: input.interval,
    startPinnedToWindowEdge: false,
    endPinnedToWindowEdge: false,
    meanTokenPosterior: 0.9,
    minimumTokenPosterior: 0.8,
    alignedTokenMeanLogPosterior: -0.1,
    alignedTokenMinLogPosterior: -0.2,
    pathScore: -0.1,
    normalizedPathLogScore: -0.1,
    blankFrameRatio: 0.5,
    targetSpanDurationSeconds: 1,
    targetSpanToWindowRatio: 1,
    scoreCalibrationStatus: "uncalibrated-ctc-score",
    greedyText: "はい",
    greedyTextMatchesTarget: true,
    greedyNormalizedSimilarity: 1,
    greedyEditRatio: 0,
    greedyDiagnosticOnly: true,
    workerRequestVerified: true,
    viterbiPolicy: CTC_VITERBI_POLICY,
    frameMapping: {
      sampleRate: 16_000,
      convKernel: [10, 3, 3, 3, 3, 2, 2],
      convStride: [5, 2, 2, 2, 2, 2, 2],
      totalStrideSamples: 320,
      receptiveFieldSamples: 400,
      frameCountFormula: "iterated-valid-convolution-v1",
      frameIntervalPolicy: "receptive-field-clipped-v1",
    },
    deviceRequested: "cpu",
    deviceUsed: "cpu",
    wallClockSeconds: 0.01,
    warnings: [],
    blockers: [],
  };
}

describe("C5.18.1 mock CTC boundary end-to-end", () => {
  it("flows dual CTC through consensus, atomic component action, and review UI", async () => {
    const componentSizes = [3, 3, 2, 2, 2, 2, 2];
    const cues: CtcCueEvidenceInput[] = [];
    const attempts: CtcAlignmentAttempt[] = [];
    let cueIndex = 0;
    componentSizes.forEach((size, componentIndex) => {
      const componentId = `component-${String(componentIndex)}`;
      for (let localIndex = 0; localIndex < size; localIndex += 1) {
        const cueId = `cue-${String(cueIndex)}`;
        const original = {
          start: componentIndex * 20 + localIndex * 2,
          end: componentIndex * 20 + localIndex * 2 + 1.5,
        };
        const selected = {
          start: original.start + 0.05,
          end: original.end - 0.05,
        };
        const narrow = attempt({
          cueId,
          componentId,
          windowType: "narrow",
          interval: selected,
        });
        const expanded = attempt({
          cueId,
          componentId,
          windowType: "expanded",
          interval: { start: selected.start + 0.01, end: selected.end + 0.01 },
        });
        attempts.push(narrow, expanded);
        cues.push({
          cueId,
          componentId,
          canonicalText: "はい",
          alignmentText: "はい",
          originalInterval: original,
          narrow,
          expanded,
          independent: {
            mfaBoundary: selected,
            mfaStartEvidenceIds: [`mfa-${cueId}-start`],
            mfaEndEvidenceIds: [`mfa-${cueId}-end`],
            mfaValid: true,
            mappedTokenBoundary: selected,
            mappedTokenEvidenceIds: [`mapped-${cueId}`],
            evidenceDpBoundary: selected,
            rawVadBoundary: null,
            speakerBoundary: null,
            speakerEvidenceIds: [],
            speakerContradiction: false,
          },
          neighborIntrusion: false,
        });
        cueIndex += 1;
      }
    });
    const evidence = buildLocalCtcBoundaryEvidence({
      sourceFingerprint: {
        fileName: "mock.mkv",
        size: 1,
        durationSeconds: 200,
        sha256: HASH,
      },
      baseCueHash: HASH,
      baseTimingHash: HASH,
      alignmentInputRef: "./subtitle-ctc-alignment-input.json",
      runtimeCapabilityRef: "./ctc-runtime-capability.json",
      mode: "enforce",
      deviceRequested: "cpu",
      deviceUsed: "cpu",
      attempts,
      cues,
      speakerResolvedComponentIds: new Set(),
    });
    expect(evidence.summary.directAttemptCount).toBe(32);
    expect(evidence.summary.timingActionableComponentCount).toBe(7);
    expect(evidence.summary.timingMutationComponentCount).toBe(7);
    expect(evidence.mutations).toHaveLength(16);
    expect(JSON.stringify(evidence.mutations)).toContain('"textChanged":false');

    const root = await mkdtemp(path.join(tmpdir(), "mvl-c5181-e2e-"));
    directories.push(root);
    const reviewPackage = {
      reviewVersion: "review-c5-18-1-mock",
      items: evidence.components.map((component, index) => ({
        reviewId: `review-${String(index)}`,
        targetCueIds: component.cueIds,
        ctcBoundaryEvidenceComponentId: component.componentId,
        interval: component.componentUnion,
        currentText: "はい",
        currentStart: component.componentUnion.start,
        currentEnd: component.componentUnion.end,
        candidateSuggestions: [],
        allowedHumanActions: ["KEEP", "MARK_UNRESOLVED"],
        blockers: [],
        audioClipPath: null,
      })),
    } as unknown as SubtitleReviewPackage;
    await writeSubtitleReviewPage({
      subtitleDirectory: root,
      reviewPackage,
      ctcEvidence: evidence,
    });
    const javascript = await readFile(
      path.join(root, "review", "assets", "review.js"),
      "utf8",
    );
    expect(javascript).toContain("CTC Narrow");
    expect(javascript).toContain("CTC Expanded");
    expect(javascript).toContain("existing transcript as a target");
    expect(javascript).toContain("does not independently prove");
  });
});
