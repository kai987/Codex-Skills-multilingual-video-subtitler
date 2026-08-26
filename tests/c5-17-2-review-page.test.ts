import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  subtitlePackageSchema,
  subtitleReviewPackageSchema,
  type ReviewBoundaryEvidence,
} from "@mvl/shared";
import {
  applyHumanReviewResolutions,
  writeSubtitleReviewPage,
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

function boundary(
  sourceType: ReviewBoundaryEvidence["sourceType"],
  scope: ReviewBoundaryEvidence["scope"],
  index: number,
): ReviewBoundaryEvidence {
  return {
    evidenceId: `${sourceType}-${index}`,
    evidenceLineageId: `${sourceType}-lineage-${index}`,
    sourceType,
    scope,
    cueIds: ["cue-a"],
    componentId: "component-a",
    interval: { start: 10 + index / 10, end: 11 + index / 10 },
    sideSupport: scope === "cue" ? "both" : "none",
    timingUsable: true,
    acousticEvidence: sourceType !== "source-cue-prior",
    trustScore: 0.9,
    alignmentScore: 0.8,
    boundaryConfidence: 0.7,
    neighborIntrusionRatio: 0.1,
    profile: sourceType === "raw-vad" ? "sensitive-vad" : null,
    attemptId: sourceType === "source-cue-prior" ? null : `attempt-${index}`,
    parentSegmentId: null,
    selectedBoundarySource: null,
    windowType: null,
    wordInterval: null,
    phoneInterval: null,
    startPinnedToWindowEdge: null,
    endPinnedToWindowEdge: null,
    wordCoverageRatio: null,
    phoneCoverageRatio: null,
    readingCoverageRatio: null,
    rawInterval: null,
    normalizedInterval: null,
    healthStatus: null,
    normalizationApplied: null,
    normalizationDeltaStart: null,
    normalizationDeltaEnd: null,
    sourceArtifactType: `artifact-${sourceType}`,
    sourceArtifactHash: HASH,
    sourceObjectId: `${sourceType}-${index}`,
    blockers: index === 1 ? ["MACHINE_EVIDENCE_ONLY"] : [],
    notes: ["test evidence"],
  };
}

function reviewPackage() {
  const cueEvidence = [
    boundary("source-cue-prior", "cue", 0),
    boundary("mfa-narrow", "cue", 1),
    boundary("mfa-expanded", "cue", 2),
    boundary("forced-alignment-selected", "cue", 3),
    boundary("evidence-dp", "cue", 4),
    boundary("trusted-mapped-token", "cue", 5),
    boundary("decoded-segment", "cue", 6),
  ];
  const mappedEvidence = cueEvidence.find(
    (value) => value.sourceType === "trusted-mapped-token",
  );
  if (mappedEvidence === undefined) throw new Error("mapped fixture missing");
  return subtitleReviewPackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-review-package",
    reviewVersion: "review-v2-page-test",
    generatedAt: "2026-08-26T00:00:00.000Z",
    sourceFingerprint: {
      fileName: "sample.mkv",
      size: 1,
      durationSeconds: 30,
      sha256: HASH,
    },
    baseSubtitlePackagePath: "./subtitle-package.json",
    baseSubtitlePackageHash: HASH,
    baseCueHash: HASH,
    inputEvidenceHash: HASH,
    evidenceReconciliationHash: HASH,
    evidenceReconciliationStatus: "enforced",
    deliveryIntegrityPolicyVersion: "c5.17.2-review-delivery-integrity-v1",
    items: [
      {
        reviewId: "review-a",
        targetCueIds: ["cue-a"],
        interval: { start: 10, end: 12 },
        currentText: "テスト",
        currentStart: 10,
        currentEnd: 12,
        currentStyle: "default",
        currentSpeaker: null,
        previousCue: null,
        nextCue: null,
        machineDecision: {
          decisionId: "decision-a",
          targetCueIds: ["cue-a"],
          action: "REVIEW_ONLY",
          currentText: "テスト",
          proposedText: null,
          proposedCues: [],
          selectedCandidateId: null,
          alternativeCandidateIds: [],
          evidenceIds: [],
          blockers: ["MACHINE_EVIDENCE_ONLY"],
          automaticMutationEligible: false,
          requiresHumanReview: true,
          decisionReasons: ["MACHINE_EVIDENCE_ONLY"],
        },
        candidateSuggestions: [],
        findingIds: [],
        blockers: ["MACHINE_EVIDENCE_ONLY"],
        allowedHumanActions: ["KEEP", "MARK_UNRESOLVED"],
        audioClipPath: "../audio/review/review-a.wav",
        audioError: null,
        audioSource: "reused-overlap-audio",
        audioValidationStatus: "validated",
        audioSourceArtifact: "subtitle-overlap-acoustic-resolution.json",
        audioSourceAudioPath: "audio/overlap/component-a.wav",
        audioSourceComponentId: "component-a",
        audioSourceEvidenceLineageIds: ["mapped-lineage-5"],
        audioHandoffMethod: "copy",
        componentUnionInterval: { start: 10, end: 12 },
        audioRequestedInterval: { start: 8.5, end: 13.5 },
        audioExtractedInterval: { start: 8.5, end: 13.5 },
        audioDurationSeconds: 5,
        audioActualDurationSeconds: 5,
        audioSampleRate: 16_000,
        audioChannelCount: 1,
        audioBitsPerSample: 16,
        audioFrameCount: 80_000,
        audioInspectionMethod: "riff-wave-fmt-data-frame-count-v1",
        audioSha256: HASH,
        audioContextSeconds: 1.5,
        audioContextBeforeSeconds: 1.5,
        audioContextAfterSeconds: 1.5,
        audioFullyCoversComponent: true,
        boundaryEvidence: cueEvidence,
        componentRawVadIntervals: [boundary("raw-vad", "component", 7)],
        componentDecodedSegments: [boundary("decoded-segment", "component", 8)],
        componentMappedTokenEvidence: [mappedEvidence],
        componentPauseEvidence: [boundary("pause", "pair", 9)],
        evidenceReconciliationHash: HASH,
        evidenceSourceResolutionStatus: "resolved",
        unresolvedEvidenceReferences: ["missing-evidence-test"],
        forcedAlignmentEvidence: {
          disclaimer:
            "MFA boundaries are machine evidence, not confirmed ground truth.",
          componentId: "component-a",
          cues: [
            {
              cueId: "cue-a",
              canonicalText: "テスト",
              alignmentText: "テスト",
              normalizedReading: "てすと",
              unresolvedOov: [],
              originalTiming: { start: 10, end: 12 },
              suggestedTiming: null,
              mfaNarrowBoundary: { start: 10.1, end: 11.9 },
              mfaExpandedBoundary: { start: 9.9, end: 12.1 },
              evidenceDpBoundary: { start: 10.2, end: 11.8 },
              mappedTokenBoundary: { start: 10.3, end: 11.7 },
              rawVadBoundary: null,
              windowStabilityScore: 0.9,
              wordCoverageRatio: 1,
              phoneCoverageRatio: 1,
              readingCoverageRatio: 1,
              antiForcingBlockers: ["MACHINE_EVIDENCE_ONLY"],
            },
          ],
          bestHypothesis: "ordered-no-overlap",
          runnerUpHypothesis: "partial-alignment",
          decisionMargin: 0.1,
          duplicateOccurrenceConflictCount: 1,
          blocking: true,
        },
        requiresHumanReview: true,
      },
    ],
    summary: {
      itemCount: 1,
      mandatoryItemCount: 1,
      audioClipCount: 1,
      audioFailureCount: 0,
      audioCoverageFailureCount: 0,
      audioPhysicalFileCount: 1,
      audioReferencedCount: 1,
      audioPlayableCount: 1,
      audioReusedExistingCount: 0,
      audioReusedOverlapCount: 1,
      audioGeneratedCount: 0,
      audioHashMismatchCount: 0,
      audioMetadataFailureCount: 0,
      mappedTokenEvidenceCount: 1,
      rawVadEvidenceCount: 1,
      decodedSegmentEvidenceCount: 2,
      mappedTokenBoundaryCopiedFromEvidenceDpCount: 0,
      unresolvedEvidenceReferenceCount: 1,
    },
  });
}

async function renderPage() {
  const root = await mkdtemp(path.join(tmpdir(), "mvl-c5172-page-"));
  temporaryDirectories.push(root);
  const review = reviewPackage();
  await writeSubtitleReviewPage({
    subtitleDirectory: root,
    reviewPackage: review,
  });
  const [html, css, javascript, data] = await Promise.all([
    readFile(path.join(root, "review", "index.html"), "utf8"),
    readFile(path.join(root, "review", "assets", "review.css"), "utf8"),
    readFile(path.join(root, "review", "assets", "review.js"), "utf8"),
    readFile(
      path.join(root, "review", "data", "subtitle-review-package.json"),
      "utf8",
    ),
  ]);
  return { root, review, html, css, javascript, data };
}

describe("C5.17.2 local review page", () => {
  it("keeps a strict local CSP and never references a network asset", async () => {
    const page = await renderPage();
    expect(page.html).toContain("default-src 'self'");
    expect(page.html).toContain("media-src 'self' blob:");
    expect(`${page.html}${page.css}${page.javascript}`).not.toMatch(
      /https?:\/\//u,
    );
  });

  it("renders a relative audio control and explicit delivery state", async () => {
    const page = await renderPage();
    expect(page.javascript).toContain('<audio id="review-audio" controls');
    expect(page.data).toContain("../audio/review/review-a.wav");
    expect(page.javascript).toContain("Audio source");
    expect(page.javascript).toContain("Audio metadata and coverage validated.");
    expect(page.javascript).toContain("AUDIO_PLAYBACK_ERROR");
  });

  it("converts global media time to audio-local time for all play ranges", async () => {
    const page = await renderPage();
    expect(page.javascript).toContain(
      "media-(item.audioExtractedInterval?.start??0)",
    );
    expect(page.javascript).toContain("Loop component");
    expect(page.javascript).toContain("Loop cue ");
    expect(page.javascript).toContain("state.loopStart");
    expect(page.javascript).toContain("a.currentTime=state.loopStart??0");
  });

  it("shows every required evidence track and separates scopes", async () => {
    const page = await renderPage();
    for (const label of [
      "Human Original Timing",
      "MFA Narrow",
      "MFA Expanded",
      "Forced Alignment Selected",
      "Evidence-DP",
      "Mapped Token",
      "Decoded Segment",
      "Raw VAD",
      "Component Union",
      "Audio Extraction Window",
      "Cue-specific evidence tracks",
      "Component acoustic tracks",
    ]) {
      expect(page.javascript).toContain(label);
    }
    expect(page.javascript).toContain("e.blockers.join(', ')");
    expect(page.data).toContain("MACHINE_EVIDENCE_ONLY");
    expect(page.javascript).toContain("EVIDENCE_REFERENCE_UNRESOLVED");
  });

  it("keeps keyboard navigation and schema-shaped resolution download", async () => {
    const page = await renderPage();
    expect(page.javascript).toContain("e.key==='ArrowLeft'");
    expect(page.javascript).toContain("e.key==='ArrowRight'");
    expect(page.javascript).toContain("e.key===' '");
    expect(page.javascript).toContain("e.key.toLowerCase()==='l'");
    expect(page.javascript).toContain(
      "resolutionType:'human-review-resolutions'",
    );
    expect(page.javascript).toContain("reviewVersion:d.reviewVersion");
  });

  it("rejects old human resolutions after the audio/evidence review version changes", () => {
    const review = reviewPackage();
    const subtitlePackage = subtitlePackageSchema.parse({
      schemaVersion: "1.0.0",
      packageType: "multilingual-subtitle-package",
      status: "ready",
      sourceLanguage: "ja",
      detectedLanguages: ["ja"],
      source: {
        fileName: "sample.mkv",
        container: "matroska",
        durationSeconds: 30,
      },
      identity: { title: "Sample", season: null, episode: null, year: null },
      primarySubtitle: {
        language: "ja",
        sourceType: "transcription",
        validationStatus: "needs-review",
        streamIndex: 0,
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
          id: "cue-a",
          start: 10,
          end: 12,
          text: "テスト",
          language: "ja",
          languages: ["ja"],
          speaker: null,
          confidence: 1,
        },
      ],
      warnings: [],
    });
    expect(() =>
      applyHumanReviewResolutions({
        cues: subtitlePackage.cues,
        subtitlePackage,
        reviewPackage: review,
        currentSourceFingerprint: review.sourceFingerprint,
        resolutions: {
          schemaVersion: "1.0.0",
          resolutionType: "human-review-resolutions",
          reviewVersion: "review-v1-stale",
          sourceFingerprint: review.sourceFingerprint,
          baseSubtitlePackageHash: review.baseSubtitlePackageHash,
          baseCueHash: review.baseCueHash,
          inputEvidenceHash: review.inputEvidenceHash,
          resolutions: [],
        },
      }),
    ).toThrow(/stale/u);
  });
});
