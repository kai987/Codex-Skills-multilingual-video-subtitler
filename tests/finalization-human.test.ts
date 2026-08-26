import { describe, expect, it } from "vitest";

import {
  humanReviewResolutionsSchema,
  subtitlePackageSchema,
  subtitleReviewPackageSchema,
  type FinalizationCandidate,
  type HumanReviewResolution,
  type SourceFingerprint,
  type SubtitleCue,
} from "@mvl/shared";
import { calculateCandidateCoverage } from "@mvl/transcription-core";
import {
  applyHumanReviewResolutions,
  reviewCandidateEvidenceHash,
} from "@mvl/video-subtitler";

const fingerprint: SourceFingerprint = {
  fileName: "sample.mkv",
  size: 123,
  durationSeconds: 10,
  sha256: "a".repeat(64),
};

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
): SubtitleCue {
  return {
    id,
    text,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    speaker: null,
    confidence: 0.8,
  };
}

const cues = [cue("cue-a", "古い文", 1, 2), cue("cue-b", "次の文", 2, 3)];

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

const candidate: FinalizationCandidate = {
  candidateId: "candidate-a",
  targetCueIds: ["cue-a"],
  candidateText: "正しい文",
  candidateInterval: { start: 1, end: 2 },
  localInterval: null,
  associationType: "BROAD_WINDOW_ASSOCIATION",
  associationScore: null,
  associationMargin: null,
  sourceEvidenceIds: ["evidence-a"],
  sourceRequestIds: ["request-a"],
  sourceProfileIds: ["profile-a"],
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

const decision = {
  decisionId: "decision-a",
  targetCueIds: ["cue-a"],
  action: "REVIEW_ONLY" as const,
  currentText: "古い文",
  proposedText: "正しい文",
  proposedCues: [],
  selectedCandidateId: "candidate-a",
  alternativeCandidateIds: [],
  evidenceIds: ["evidence-a"],
  blockers: ["BROAD_WINDOW_ASSOCIATION"],
  automaticMutationEligible: false,
  requiresHumanReview: true,
  decisionReasons: ["SUGGESTION_ONLY"],
};

const reviewVersion = "review-v3-test";
const candidateEvidenceHash = reviewCandidateEvidenceHash({
  reviewId: "review-a",
  inputEvidenceHash: "d".repeat(64),
  candidate,
});

const reviewPackage = subtitleReviewPackageSchema.parse({
  schemaVersion: "1.0.0",
  packageType: "multilingual-subtitle-review-package",
  reviewVersion,
  generatedAt: "1970-01-01T00:00:00.000Z",
  sourceFingerprint: fingerprint,
  baseSubtitlePackagePath: "./subtitle-package.json",
  baseSubtitlePackageHash: "b".repeat(64),
  baseCueHash: "c".repeat(64),
  inputEvidenceHash: "d".repeat(64),
  reviewActionPolicyVersion: "c5.18-review-action-semantics-v1",
  items: [
    {
      reviewId: "review-a",
      targetCueIds: ["cue-a"],
      interval: { start: 1, end: 2 },
      currentText: "古い文",
      currentStart: 1,
      currentEnd: 2,
      currentStyle: "default",
      currentSpeaker: null,
      previousCue: null,
      nextCue: { cueId: "cue-b", text: "次の文", start: 2, end: 3 },
      machineDecision: decision,
      candidateSuggestions: [candidate],
      candidateActionBindings: [
        {
          candidateId: candidate.candidateId,
          reviewId: "review-a",
          candidateEvidenceHash,
          reviewVersion,
          status: "active",
        },
      ],
      findingIds: ["finding-a"],
      blockers: ["BROAD_WINDOW_ASSOCIATION"],
      allowedHumanActions: [
        "KEEP",
        "ACCEPT_SUGGESTION",
        "EDIT_TEXT",
        "REJECT_SUGGESTION",
        "SPLIT_CUE",
        "MERGE_CUES",
        "EDIT_TIMING",
        "DELETE_CUE",
        "MARK_UNRESOLVED",
      ],
      audioClipPath: null,
      audioError: "fixture",
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

function resolution(overrides: Partial<HumanReviewResolution> = {}) {
  return {
    resolutionId: "resolution-a",
    reviewId: "review-a",
    action: "KEEP" as const,
    selectedCandidateId: null,
    correctedText: null,
    start: null,
    end: null,
    splitParts: [],
    mergeCueIds: [],
    reviewerNotes: null,
    errorTypes: [],
    confirmedReading: null,
    terminologyHints: [],
    dialectHints: [],
    ...overrides,
  };
}

function resolutions(
  entries: readonly ReturnType<typeof resolution>[],
  overrides: Record<string, unknown> = {},
) {
  return humanReviewResolutionsSchema.parse({
    schemaVersion: "1.0.0",
    resolutionType: "human-review-resolutions",
    reviewVersion: reviewPackage.reviewVersion,
    sourceFingerprint: fingerprint,
    baseSubtitlePackageHash: reviewPackage.baseSubtitlePackageHash,
    baseCueHash: reviewPackage.baseCueHash,
    inputEvidenceHash: reviewPackage.inputEvidenceHash,
    resolutions: entries,
    ...overrides,
  });
}

function apply(entries: readonly ReturnType<typeof resolution>[]) {
  return applyHumanReviewResolutions({
    cues,
    subtitlePackage,
    reviewPackage,
    resolutions: resolutions(entries),
    currentSourceFingerprint: fingerprint,
  });
}

describe("human review import validation", () => {
  it.each([
    ["reviewVersion", "stale-review"],
    ["inputEvidenceHash", "1".repeat(64)],
    ["baseCueHash", "2".repeat(64)],
    ["baseSubtitlePackageHash", "3".repeat(64)],
  ])("rejects stale %s", (field, value) => {
    const stale = resolutions([resolution()], { [field]: value });
    expect(() =>
      applyHumanReviewResolutions({
        cues,
        subtitlePackage,
        reviewPackage,
        resolutions: stale,
        currentSourceFingerprint: fingerprint,
      }),
    ).toThrow(/stale/u);
  });

  it("rejects unknown candidates and duplicate review decisions", () => {
    expect(() =>
      apply([
        resolution({
          action: "ACCEPT_SUGGESTION",
          selectedCandidateId: "missing",
        }),
      ]),
    ).toThrow(/CANDIDATE_NOT_FOUND_FOR_REVIEW_ITEM/u);
    expect(() =>
      apply([resolution(), resolution({ resolutionId: "other" })]),
    ).toThrow(/Duplicate resolution/u);
  });

  it("requires notes for deletion", () => {
    expect(() => apply([resolution({ action: "DELETE_CUE" })])).toThrow(
      /reviewerNotes/u,
    );
  });
});

describe("deterministic human actions and correction feedback", () => {
  it("KEEP preserves text and timing without false feedback", () => {
    const result = apply([resolution()]);
    expect(result.cues).toEqual(cues);
    expect(result.feedback.records).toHaveLength(0);
    expect(result.unresolvedCount).toBe(0);
  });

  it("accepts a review suggestion only by candidate ID", () => {
    const result = apply([
      resolution({
        action: "ACCEPT_SUGGESTION",
        selectedCandidateId: "candidate-a",
        selectedCandidateEvidenceHash: candidateEvidenceHash,
        errorTypes: ["KANJI_SELECTION_ERROR"],
      }),
    ]);
    expect(result.cues[0]?.text).toBe("正しい文");
    expect(result.feedback.records[0]?.selectedCandidate?.candidateId).toBe(
      "candidate-a",
    );
  });

  it("EDIT_TEXT changes only text and emits path-free feedback", () => {
    const result = apply([
      resolution({
        action: "EDIT_TEXT",
        correctedText: "人が直した文",
        errorTypes: ["DIALECT_ERROR"],
        reviewerNotes: "listened twice",
      }),
    ]);
    expect(result.cues[0]).toMatchObject({
      text: "人が直した文",
      start: 1,
      end: 2,
    });
    expect(JSON.stringify(result.feedback)).not.toMatch(/\/Users\//u);
    expect(result.feedback.records[0]?.errorTypes).toEqual(["DIALECT_ERROR"]);
  });

  it("EDIT_TIMING changes only timing", () => {
    const result = apply([
      resolution({ action: "EDIT_TIMING", start: 1.1, end: 1.8 }),
    ]);
    expect(result.cues[0]).toMatchObject({
      text: "古い文",
      start: 1.1,
      end: 1.8,
    });
  });

  it("SPLIT_CUE IDs and feedback IDs are deterministic", () => {
    const entry = resolution({
      action: "SPLIT_CUE",
      splitParts: [
        { text: "古い", start: 1, end: 1.5 },
        { text: "文", start: 1.5, end: 2 },
      ],
      errorTypes: ["SEGMENTATION_ERROR"],
    });
    const first = apply([entry]);
    const second = apply([entry]);
    expect(first.cues).toEqual(second.cues);
    expect(first.feedback).toEqual(second.feedback);
    expect(first.cues[0]?.id).toMatch(/^cue-human-/u);
  });

  it("MERGE_CUES uses a deterministic ID and rejects non-adjacent input", () => {
    const mergeReview = subtitleReviewPackageSchema.parse({
      ...reviewPackage,
      items: [
        {
          ...reviewPackage.items[0],
          targetCueIds: ["cue-a", "cue-b"],
          interval: { start: 1, end: 3 },
        },
      ],
    });
    const mergeResolutions = resolutions([
      resolution({
        action: "MERGE_CUES",
        mergeCueIds: ["cue-a", "cue-b"],
        correctedText: "結合した文",
      }),
    ]);
    const result = applyHumanReviewResolutions({
      cues,
      subtitlePackage,
      reviewPackage: mergeReview,
      resolutions: mergeResolutions,
      currentSourceFingerprint: fingerprint,
    });
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0]?.id).toMatch(/^cue-human-/u);
    expect(result.cues[0]?.text).toBe("結合した文");
  });

  it("DELETE_CUE works with notes and MARK_UNRESOLVED remains blocking", () => {
    const deleted = apply([
      resolution({
        action: "DELETE_CUE",
        reviewerNotes: "confirmed hallucination",
        errorTypes: ["HALLUCINATION"],
      }),
    ]);
    expect(deleted.cues.map((item) => item.id)).toEqual(["cue-b"]);
    expect(deleted.feedback.records[0]?.correctedText).toBe("");
    const unresolved = apply([resolution({ action: "MARK_UNRESOLVED" })]);
    expect(unresolved.unresolvedCount).toBe(1);
    expect(unresolved.feedback.records).toHaveLength(0);
  });
});
