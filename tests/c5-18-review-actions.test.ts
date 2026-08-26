import { describe, expect, it } from "vitest";

import {
  reviewActionValidationReportSchema,
  subtitleReviewPackageSchema,
  type SubtitleReviewPackage,
} from "@mvl/shared";
import {
  REVIEW_ACTION_POLICY_HASH,
  REVIEW_ACTION_POLICY_VERSION,
  REVIEW_ACTION_REGISTRY,
  buildReviewActionValidationReport,
  portableValidateReviewAction,
  validateReviewActionPayload,
  validateReviewResolutionCollection,
} from "@mvl/video-subtitler";

const HASH = "a".repeat(64);
const CANDIDATE_HASH = "b".repeat(64);
const REVIEW_VERSION = "review-v3-action-test";

function actionItem(overrides: Record<string, unknown> = {}) {
  return {
    reviewId: "review-a",
    targetCueIds: ["cue-a", "cue-b", "cue-c"],
    interval: { start: 1, end: 4 },
    componentUnionInterval: { start: 1, end: 4 },
    allowedHumanActions: REVIEW_ACTION_REGISTRY.map((entry) => entry.action),
    machineDecision: { selectedCandidateId: "candidate-a" },
    candidateSuggestions: [
      { candidateId: "candidate-a", targetCueIds: ["cue-a"] },
    ],
    candidateActionBindings: [
      {
        candidateId: "candidate-a",
        reviewId: "review-a",
        candidateEvidenceHash: CANDIDATE_HASH,
        reviewVersion: REVIEW_VERSION,
        status: "active",
      },
    ],
    ...overrides,
  } as unknown as SubtitleReviewPackage["items"][number];
}

function resolution(overrides: Record<string, unknown> = {}) {
  return {
    resolutionId: "resolution-a",
    reviewId: "review-a",
    action: "KEEP",
    selectedCandidateId: null,
    selectedCandidateEvidenceHash: null,
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

function validate(overrides: Record<string, unknown>, item = actionItem()) {
  return validateReviewActionPayload({
    item,
    resolution: resolution(overrides),
    reviewVersion: REVIEW_VERSION,
  });
}

function codes(result: ReturnType<typeof validate>) {
  return result.errors.map((error) => error.code);
}

function reportPackage(): SubtitleReviewPackage {
  return subtitleReviewPackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-review-package",
    reviewVersion: REVIEW_VERSION,
    generatedAt: "2026-08-26T00:00:00.000Z",
    sourceFingerprint: {
      fileName: "fixture.mkv",
      size: 1,
      durationSeconds: 10,
      sha256: HASH,
    },
    baseSubtitlePackagePath: "./subtitle-package.json",
    baseSubtitlePackageHash: HASH,
    baseCueHash: HASH,
    inputEvidenceHash: HASH,
    reviewActionPolicyVersion: REVIEW_ACTION_POLICY_VERSION,
    items: [
      {
        reviewId: "review-a",
        targetCueIds: ["cue-a"],
        interval: { start: 1, end: 2 },
        currentText: "テスト",
        currentStart: 1,
        currentEnd: 2,
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
        candidateActionBindings: [],
        findingIds: [],
        blockers: ["MACHINE_EVIDENCE_ONLY"],
        allowedHumanActions: ["KEEP", "MARK_UNRESOLVED"],
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
}

describe("C5.18 Phase 0 review action semantics", () => {
  it("hard-gates button and shortcut actions through allowedHumanActions", () => {
    const item = actionItem({
      allowedHumanActions: ["KEEP", "MARK_UNRESOLVED"],
      candidateSuggestions: [],
      candidateActionBindings: [],
      machineDecision: { selectedCandidateId: null },
    });
    const before = 0;
    const result = validate(
      { action: "ACCEPT_SUGGESTION", selectedCandidateId: null },
      item,
    );
    const after = result.valid ? before + 1 : before;
    expect(after - before).toBe(0);
    expect(codes(result)).toContain("ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM");
  });

  it("accepts an explicitly bound active candidate", () => {
    expect(
      validate({
        action: "ACCEPT_SUGGESTION",
        selectedCandidateId: "candidate-a",
        selectedCandidateEvidenceHash: CANDIDATE_HASH,
      }),
    ).toMatchObject({ valid: true, errors: [] });
  });

  it("rejects missing, foreign, stale, and review-version-mismatched candidates", () => {
    expect(
      codes(
        validate({
          action: "ACCEPT_SUGGESTION",
          selectedCandidateId: "missing",
        }),
      ),
    ).toContain("CANDIDATE_NOT_FOUND_FOR_REVIEW_ITEM");
    expect(
      codes(
        validate(
          {
            action: "ACCEPT_SUGGESTION",
            selectedCandidateId: "candidate-a",
            selectedCandidateEvidenceHash: CANDIDATE_HASH,
          },
          actionItem({
            candidateSuggestions: [
              { candidateId: "candidate-a", targetCueIds: ["other-cue"] },
            ],
          }),
        ),
      ),
    ).toContain("CANDIDATE_REVIEW_ITEM_SCOPE_MISMATCH");
    expect(
      codes(
        validate(
          {
            action: "ACCEPT_SUGGESTION",
            selectedCandidateId: "candidate-a",
            selectedCandidateEvidenceHash: CANDIDATE_HASH,
          },
          actionItem({
            candidateActionBindings: [
              {
                candidateId: "candidate-a",
                reviewId: "review-a",
                candidateEvidenceHash: CANDIDATE_HASH,
                reviewVersion: REVIEW_VERSION,
                status: "stale",
              },
            ],
          }),
        ),
      ),
    ).toContain("CANDIDATE_NOT_ACTIVE");
    expect(
      codes(
        validate(
          {
            action: "ACCEPT_SUGGESTION",
            selectedCandidateId: "candidate-a",
            selectedCandidateEvidenceHash: CANDIDATE_HASH,
          },
          actionItem({
            candidateActionBindings: [
              {
                candidateId: "candidate-a",
                reviewId: "review-a",
                candidateEvidenceHash: CANDIDATE_HASH,
                reviewVersion: "stale-review",
                status: "active",
              },
            ],
          }),
        ),
      ),
    ).toContain("CANDIDATE_REVIEW_VERSION_MISMATCH");
  });

  it("requires REJECT_SUGGESTION to identify the bound candidate", () => {
    expect(codes(validate({ action: "REJECT_SUGGESTION" }))).toContain(
      "CANDIDATE_ID_REQUIRED",
    );
    expect(
      validate({
        action: "REJECT_SUGGESTION",
        selectedCandidateId: "candidate-a",
        selectedCandidateEvidenceHash: CANDIDATE_HASH,
      }).valid,
    ).toBe(true);
  });

  it("rejects mutation fields on KEEP", () => {
    expect(codes(validate({ correctedText: "changed" }))).toContain(
      "ACTION_PAYLOAD_FIELD_FORBIDDEN",
    );
  });

  it("rejects blank EDIT_TEXT", () => {
    expect(
      codes(validate({ action: "EDIT_TEXT", correctedText: "   " })),
    ).toContain("CORRECTED_TEXT_REQUIRED");
  });

  it("rejects non-finite, reversed, and out-of-component EDIT_TIMING", () => {
    expect(
      codes(validate({ action: "EDIT_TIMING", start: Number.NaN, end: 2 })),
    ).toContain("REVIEW_ACTION_SCHEMA_INVALID");
    expect(
      codes(validate({ action: "EDIT_TIMING", start: 2, end: 2 })),
    ).toContain("INVALID_TIMING_PAYLOAD");
    expect(
      codes(validate({ action: "EDIT_TIMING", start: 0, end: 2 })),
    ).toContain("TIMING_OUTSIDE_COMPONENT");
  });

  it("rejects incomplete, overlapping, and out-of-component SPLIT_CUE", () => {
    expect(codes(validate({ action: "SPLIT_CUE" }))).toContain(
      "SPLIT_PARTS_REQUIRED",
    );
    expect(
      codes(
        validate({
          action: "SPLIT_CUE",
          splitParts: [
            { text: "a", start: 0, end: 2 },
            { text: "b", start: 1.5, end: 3 },
          ],
        }),
      ),
    ).toContain("INVALID_SPLIT_PART_INTERVAL");
  });

  it("rejects non-adjacent and cross-component MERGE_CUES", () => {
    expect(
      codes(
        validate({
          action: "MERGE_CUES",
          mergeCueIds: ["cue-a", "cue-c"],
          correctedText: "merged",
        }),
      ),
    ).toContain("MERGE_CUES_NOT_ADJACENT_IN_COMPONENT");
    expect(
      codes(
        validate({
          action: "MERGE_CUES",
          mergeCueIds: ["cue-a", "outside"],
          correctedText: "merged",
        }),
      ),
    ).toContain("MERGE_CUES_NOT_ADJACENT_IN_COMPONENT");
  });

  it("requires a non-blank DELETE_CUE reason", () => {
    expect(
      codes(validate({ action: "DELETE_CUE", reviewerNotes: "            " })),
    ).toContain("DELETE_REASON_REQUIRED");
  });

  it("rejects a resolved marker on MARK_UNRESOLVED", () => {
    expect(
      codes(validate({ action: "MARK_UNRESOLVED", resolved: true })),
    ).toContain("REVIEW_ACTION_SCHEMA_INVALID");
  });

  it("quarantines invalid restored or imported state without correction", () => {
    const reviewPackage = reportPackage();
    const invalid = resolution({
      action: "ACCEPT_SUGGESTION",
      selectedCandidateId: null,
    });
    const partitioned = validateReviewResolutionCollection({
      reviewPackage,
      resolutions: [resolution(), invalid],
    });
    expect(partitioned.valid).toHaveLength(1);
    expect(partitioned.quarantined).toHaveLength(1);
    expect(
      (partitioned.quarantined[0]?.resolution as { selectedCandidateId: null })
        .selectedCandidateId,
    ).toBeNull();
  });

  it("uses one action registry and one portable validator in Core and Browser", () => {
    const matrix = [
      resolution(),
      resolution({ correctedText: "forbidden" }),
      resolution({
        action: "ACCEPT_SUGGESTION",
        selectedCandidateId: "candidate-a",
        selectedCandidateEvidenceHash: CANDIDATE_HASH,
      }),
    ];
    for (const entry of matrix) {
      const core = validateReviewActionPayload({
        item: actionItem(),
        resolution: entry,
        reviewVersion: REVIEW_VERSION,
      });
      const browser = portableValidateReviewAction(
        REVIEW_ACTION_REGISTRY,
        actionItem(),
        entry,
        REVIEW_VERSION,
      );
      expect(browser).toEqual(core);
    }
    expect(REVIEW_ACTION_POLICY_HASH).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("emits a strict pre/post validation report with blocked invalid downloads", () => {
    const source = reportPackage();
    const target = reportPackage();
    const report = buildReviewActionValidationReport({
      mode: "enforce",
      sourceReviewPackage: source,
      targetReviewPackage: target,
      targetReviewPackageHash: HASH,
      legacyShortcutRoutePresent: true,
    });
    expect(reviewActionValidationReportSchema.parse(report)).toEqual(report);
    expect(report.preFixReproduction).toEqual({
      invalidAcceptShortcutGeneratedCount: 1,
      invalidResolutionDownloadAllowedCount: 1,
      shortcutActionBypassedAllowedActionsCount: 1,
    });
    expect(report.downloadBlockedCount).toBe(1);
    expect(report.summary).toMatchObject({
      invalidAcceptShortcutGeneratedCount: 0,
      invalidResolutionDownloadAllowedCount: 0,
      shortcutActionBypassedAllowedActionsCount: 0,
      noCandidateShortcutResolutionDelta: 0,
      validationPassed: true,
    });
  });
});
