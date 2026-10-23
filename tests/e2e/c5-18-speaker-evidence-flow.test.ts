import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  subtitleLocalSpeakerEvidenceSchema,
  type SubtitleReviewPackage,
} from "@mvl/shared";
import {
  analyzeLocalSpeakerEvidence,
  writeSubtitleReviewPage,
  type RawSpeakerAttemptInput,
} from "@mvl/video-subtitler";

const HASH = "a".repeat(64);
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function reviewPackage(): SubtitleReviewPackage {
  return {
    sourceFingerprint: {
      fileName: "mock-review.wav",
      size: 64_044,
      durationSeconds: 10,
      sha256: HASH,
    },
    baseCueHash: HASH,
    reviewVersion: "review-c5-18-mock-e2e",
    items: [
      {
        reviewId: "review-one",
        targetCueIds: ["cue-one"],
        interval: { start: 2, end: 4 },
        componentUnionInterval: { start: 2, end: 4 },
        currentText: "はい",
        currentStart: 2,
        currentEnd: 4,
        previousCue: null,
        nextCue: null,
        audioSourceComponentId: "component-one",
        speakerEvidenceComponentId: "component-one",
        audioExtractedInterval: { start: 1, end: 5 },
        audioClipPath: "../audio/review/review-one.wav",
        audioValidationStatus: "validated",
        audioSource: "inherited-verified-review-audio",
        audioSha256: HASH,
        audioFullyCoversComponent: true,
        boundaryEvidence: [
          {
            evidenceLineageId: "source-cue-one",
            sourceType: "source-cue-prior",
            cueIds: ["cue-one"],
            interval: { start: 2, end: 4 },
          },
        ],
        componentRawVadIntervals: [],
        componentDecodedSegments: [],
        componentMappedTokenEvidence: [],
        componentPauseEvidence: [],
        unresolvedEvidenceReferences: [],
        machineDecision: { proposedText: null },
        candidateSuggestions: [],
        allowedHumanActions: ["KEEP", "MARK_UNRESOLVED"],
        blockers: ["MACHINE_EVIDENCE_ONLY"],
      },
    ],
  } as unknown as SubtitleReviewPackage;
}

function attempts(): RawSpeakerAttemptInput[] {
  return (["context", "union"] as const).map((windowType) => ({
    componentId: "component-one",
    windowType,
    audioPath: `./audio/review/${windowType}.wav`,
    audioSha256: HASH,
    audioLocalInterval:
      windowType === "context" ? { start: 0, end: 4 } : { start: 1, end: 3 },
    mediaGlobalInterval:
      windowType === "context" ? { start: 1, end: 5 } : { start: 2, end: 4 },
    runtimeIdentityHash: HASH,
    modelSnapshotHash: HASH,
    device: "cpu",
    minSpeakers: 1,
    maxSpeakers: 3,
    cacheHit: false,
    inference: {
      standardTurns: [
        {
          speaker: windowType === "context" ? "raw-A" : "permuted-Z",
          start: windowType === "context" ? 1 : 0,
          end: windowType === "context" ? 3 : 2,
        },
      ],
      exclusiveTurns: [
        {
          speaker: windowType === "context" ? "raw-A" : "permuted-Z",
          start: windowType === "context" ? 1 : 0,
          end: windowType === "context" ? 3 : 2,
        },
      ],
      wallClockSeconds: 0.01,
      confidenceStatus: "unavailable",
      warnings: [],
    },
  }));
}

describe("C5.18 mock speaker-evidence end-to-end", () => {
  it("flows mock dual-window output through analysis, strict artifact, and local review UI", async () => {
    const review = reviewPackage();
    const artifact = analyzeLocalSpeakerEvidence({
      mode: "enforce",
      reviewPackage: review,
      baseTimingHash: HASH,
      runtimeCapabilityRef: { path: "./runtime.json", sha256: HASH },
      reviewPackageRef: { path: "./review.json", sha256: HASH },
      forcedAlignmentRef: { path: "./forced.json", sha256: HASH },
      overlapAcousticRef: { path: "./overlap.json", sha256: HASH },
      rawAttempts: attempts(),
      pipelineInferenceCount: 2,
      modelLoadCount: 1,
      deviceRequested: "auto",
    });
    expect(() =>
      subtitleLocalSpeakerEvidenceSchema.parse(artifact),
    ).not.toThrow();
    expect(artifact.components[0]).toMatchObject({
      selectedRelationship: "single-speaker-only",
      resolutionStatus: "resolved",
    });
    expect(JSON.stringify(artifact)).not.toMatch(/raw-A|permuted-Z/u);

    const root = await mkdtemp(path.join(tmpdir(), "mvl-c518-e2e-"));
    temporaryDirectories.push(root);
    await writeSubtitleReviewPage({
      subtitleDirectory: root,
      reviewPackage: review,
      speakerEvidence: artifact,
    });
    const [javascript, speakerData] = await Promise.all([
      readFile(path.join(root, "review", "assets", "review.js"), "utf8"),
      readFile(
        path.join(
          root,
          "review",
          "data",
          "subtitle-local-speaker-evidence.json",
        ),
        "utf8",
      ),
    ]);
    expect(javascript).toContain("Anonymous local speaker evidence");
    expect(javascript).toContain("data-speaker-start");
    expect(speakerData).toContain("component-component-one-speaker-01");
  });
});
