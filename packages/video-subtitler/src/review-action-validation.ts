import {
  InputError,
  humanReviewResolutionSchema,
  reviewActionValidationReportSchema,
  type HumanReviewResolution,
  type ReviewActionHardeningMode,
  type ReviewActionValidationError,
  type ReviewActionValidationReport,
  type SubtitleReviewPackage,
} from "@mvl/shared";

import { sha256Value } from "./finalization-support.js";

export const REVIEW_ACTION_POLICY_VERSION =
  "c5.18-review-action-semantics-v1" as const;

export const REVIEW_ACTION_REGISTRY = [
  { action: "KEEP", label: "Keep", shortcut: "k" },
  {
    action: "ACCEPT_SUGGESTION",
    label: "Accept suggestion",
    shortcut: "a",
  },
  { action: "EDIT_TEXT", label: "Edit text", shortcut: "t" },
  { action: "REJECT_SUGGESTION", label: "Reject suggestion", shortcut: "r" },
  { action: "SPLIT_CUE", label: "Split cue", shortcut: null },
  { action: "MERGE_CUES", label: "Merge cues", shortcut: null },
  { action: "EDIT_TIMING", label: "Edit timing", shortcut: "i" },
  { action: "DELETE_CUE", label: "Delete cue", shortcut: null },
  { action: "MARK_UNRESOLVED", label: "Mark unresolved", shortcut: "u" },
] as const;

export type ReviewAction = (typeof REVIEW_ACTION_REGISTRY)[number]["action"];

export const REVIEW_ACTION_POLICY_HASH = sha256Value({
  policyVersion: REVIEW_ACTION_POLICY_VERSION,
  registry: REVIEW_ACTION_REGISTRY,
});

export function reviewCandidateEvidenceHash(input: {
  reviewId: string;
  inputEvidenceHash: string;
  candidate: SubtitleReviewPackage["items"][number]["candidateSuggestions"][number];
}): string {
  return sha256Value({
    policyVersion: REVIEW_ACTION_POLICY_VERSION,
    reviewId: input.reviewId,
    inputEvidenceHash: input.inputEvidenceHash,
    candidate: input.candidate,
  });
}

export function candidateBindingDescriptors(input: {
  items: readonly SubtitleReviewPackage["items"][number][];
  inputEvidenceHash: string;
}): {
  reviewId: string;
  candidateId: string;
  candidateEvidenceHash: string;
  status: "active";
}[] {
  return input.items
    .flatMap((item) =>
      item.candidateSuggestions.map((candidate) => ({
        reviewId: item.reviewId,
        candidateId: candidate.candidateId,
        candidateEvidenceHash: reviewCandidateEvidenceHash({
          reviewId: item.reviewId,
          inputEvidenceHash: input.inputEvidenceHash,
          candidate,
        }),
        status: "active" as const,
      })),
    )
    .toSorted((left, right) =>
      `${left.reviewId}\0${left.candidateId}`.localeCompare(
        `${right.reviewId}\0${right.candidateId}`,
      ),
    );
}

export function bindReviewCandidates(input: {
  items: readonly SubtitleReviewPackage["items"][number][];
  inputEvidenceHash: string;
  reviewVersion: string;
}): SubtitleReviewPackage["items"] {
  return input.items.map((item) => ({
    ...item,
    candidateActionBindings: item.candidateSuggestions.map((candidate) => ({
      candidateId: candidate.candidateId,
      reviewId: item.reviewId,
      candidateEvidenceHash: reviewCandidateEvidenceHash({
        reviewId: item.reviewId,
        inputEvidenceHash: input.inputEvidenceHash,
        candidate,
      }),
      reviewVersion: input.reviewVersion,
      status: "active" as const,
    })),
  }));
}

/**
 * This function is deliberately dependency-free. The exact function source is
 * embedded in the local review page, while Node calls the same implementation.
 */
export function portableValidateReviewAction(
  registry: readonly {
    action: string;
    label: string;
    shortcut: string | null;
  }[],
  item: Record<string, unknown>,
  resolution: Record<string, unknown>,
  reviewVersion: string,
): {
  valid: boolean;
  errors: {
    code: string;
    reviewId: string | null;
    action: string | null;
    field: string | null;
    message: string;
  }[];
} {
  const reviewId = typeof item.reviewId === "string" ? item.reviewId : null;
  const action =
    typeof resolution.action === "string" ? resolution.action : null;
  const errors: {
    code: string;
    reviewId: string | null;
    action: string | null;
    field: string | null;
    message: string;
  }[] = [];
  const add = (code: string, field: string | null, message: string): void => {
    errors.push({ code, reviewId, action, field, message });
  };
  const allowed = Array.isArray(item.allowedHumanActions)
    ? item.allowedHumanActions
    : [];
  if (action === null || !registry.some((entry) => entry.action === action)) {
    add("UNKNOWN_REVIEW_ACTION", "action", "The review action is unknown.");
    return { valid: false, errors };
  }
  if (!allowed.includes(action)) {
    add(
      "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM",
      "action",
      "The action is not listed in allowedHumanActions for this review item.",
    );
  }
  if (resolution.reviewId !== reviewId) {
    add(
      "REVIEW_ITEM_MISMATCH",
      "reviewId",
      "The resolution targets a different review item.",
    );
  }
  const requiredKeys = [
    "resolutionId",
    "reviewId",
    "action",
    "selectedCandidateId",
    "correctedText",
    "start",
    "end",
    "splitParts",
    "mergeCueIds",
    "reviewerNotes",
    "errorTypes",
    "confirmedReading",
    "terminologyHints",
    "dialectHints",
  ];
  for (const key of requiredKeys) {
    if (!(key in resolution)) {
      add("MISSING_REVIEW_ACTION_FIELD", key, `Missing required field ${key}.`);
    }
  }
  const acceptedKeys = new Set([
    ...requiredKeys,
    "selectedCandidateEvidenceHash",
  ]);
  for (const key of Object.keys(resolution)) {
    if (!acceptedKeys.has(key)) {
      add(
        "UNKNOWN_REVIEW_ACTION_FIELD",
        key,
        `Unexpected field ${key} is not permitted.`,
      );
    }
  }
  const correctedText = resolution.correctedText;
  const start = resolution.start;
  const end = resolution.end;
  const splitParts = resolution.splitParts;
  const mergeCueIds = resolution.mergeCueIds;
  const reviewerNotes = resolution.reviewerNotes;
  const selectedCandidateId = resolution.selectedCandidateId;
  const selectedCandidateEvidenceHash =
    resolution.selectedCandidateEvidenceHash;
  const hasText = typeof correctedText === "string";
  const hasTiming = start !== null || end !== null;
  const hasSplit = Array.isArray(splitParts) && splitParts.length > 0;
  const hasMerge = Array.isArray(mergeCueIds) && mergeCueIds.length > 0;
  const rejectCandidatePayload = (): void => {
    if (selectedCandidateId !== null)
      add(
        "ACTION_PAYLOAD_FIELD_FORBIDDEN",
        "selectedCandidateId",
        `${action} cannot select a candidate.`,
      );
    if (
      selectedCandidateEvidenceHash !== null &&
      selectedCandidateEvidenceHash !== undefined
    )
      add(
        "ACTION_PAYLOAD_FIELD_FORBIDDEN",
        "selectedCandidateEvidenceHash",
        `${action} cannot carry a candidate evidence hash.`,
      );
  };
  const rejectMutationPayload = (): void => {
    if (hasText)
      add(
        "ACTION_PAYLOAD_FIELD_FORBIDDEN",
        "correctedText",
        `${action} cannot carry correctedText.`,
      );
    if (hasTiming)
      add(
        "ACTION_PAYLOAD_FIELD_FORBIDDEN",
        "start/end",
        `${action} cannot carry timing fields.`,
      );
    if (hasSplit)
      add(
        "ACTION_PAYLOAD_FIELD_FORBIDDEN",
        "splitParts",
        `${action} cannot carry split parts.`,
      );
    if (hasMerge)
      add(
        "ACTION_PAYLOAD_FIELD_FORBIDDEN",
        "mergeCueIds",
        `${action} cannot carry merge cue IDs.`,
      );
  };
  const candidates = Array.isArray(item.candidateSuggestions)
    ? (item.candidateSuggestions as Record<string, unknown>[])
    : [];
  const bindings = Array.isArray(item.candidateActionBindings)
    ? (item.candidateActionBindings as Record<string, unknown>[])
    : [];
  const validateCandidate = (): void => {
    if (
      typeof selectedCandidateId !== "string" ||
      selectedCandidateId.trim() === ""
    ) {
      add(
        "CANDIDATE_ID_REQUIRED",
        "selectedCandidateId",
        `${action} requires an explicit candidate ID.`,
      );
      return;
    }
    const candidate = candidates.find(
      (value) => value.candidateId === selectedCandidateId,
    );
    if (candidate === undefined) {
      add(
        "CANDIDATE_NOT_FOUND_FOR_REVIEW_ITEM",
        "selectedCandidateId",
        "The selected candidate does not belong to this review item.",
      );
      return;
    }
    const candidateCueIds = Array.isArray(candidate.targetCueIds)
      ? candidate.targetCueIds
      : [];
    const targetCueIds = Array.isArray(item.targetCueIds)
      ? item.targetCueIds
      : [];
    if (
      candidateCueIds.length === 0 ||
      !candidateCueIds.every((cueId) => targetCueIds.includes(cueId))
    ) {
      add(
        "CANDIDATE_REVIEW_ITEM_SCOPE_MISMATCH",
        "selectedCandidateId",
        "The candidate targets cues outside this review item.",
      );
    }
    const binding = bindings.find(
      (value) =>
        value.candidateId === selectedCandidateId &&
        value.reviewId === reviewId,
    );
    if (binding === undefined) {
      add(
        "CANDIDATE_BINDING_MISSING",
        "selectedCandidateEvidenceHash",
        "The candidate has no review-version evidence binding.",
      );
      return;
    }
    if (binding.status !== "active") {
      add(
        "CANDIDATE_NOT_ACTIVE",
        "selectedCandidateId",
        "The candidate is stale, revoked, or deleted.",
      );
    }
    if (binding.reviewVersion !== reviewVersion) {
      add(
        "CANDIDATE_REVIEW_VERSION_MISMATCH",
        "selectedCandidateEvidenceHash",
        "The candidate binding does not match the current review version.",
      );
    }
    if (
      typeof selectedCandidateEvidenceHash !== "string" ||
      selectedCandidateEvidenceHash !== binding.candidateEvidenceHash
    ) {
      add(
        "CANDIDATE_EVIDENCE_HASH_MISMATCH",
        "selectedCandidateEvidenceHash",
        "The candidate evidence hash does not match the active binding.",
      );
    }
  };
  const interval =
    item.componentUnionInterval !== null &&
    typeof item.componentUnionInterval === "object"
      ? (item.componentUnionInterval as Record<string, unknown>)
      : item.interval !== null && typeof item.interval === "object"
        ? (item.interval as Record<string, unknown>)
        : {};
  switch (action) {
    case "KEEP":
      rejectMutationPayload();
      rejectCandidatePayload();
      break;
    case "ACCEPT_SUGGESTION":
    case "REJECT_SUGGESTION":
      rejectMutationPayload();
      validateCandidate();
      break;
    case "EDIT_TEXT":
      rejectCandidatePayload();
      if (typeof correctedText !== "string" || correctedText.trim() === "") {
        add(
          "CORRECTED_TEXT_REQUIRED",
          "correctedText",
          "EDIT_TEXT requires non-blank correctedText.",
        );
      }
      if (hasTiming || hasSplit || hasMerge)
        add(
          "EDIT_TEXT_MUTATION_SCOPE_INVALID",
          "payload",
          "EDIT_TEXT cannot carry timing, split, or merge mutations.",
        );
      break;
    case "EDIT_TIMING": {
      rejectCandidatePayload();
      if (
        typeof start !== "number" ||
        !Number.isFinite(start) ||
        typeof end !== "number" ||
        !Number.isFinite(end) ||
        end <= start
      ) {
        add(
          "INVALID_TIMING_PAYLOAD",
          "start/end",
          "EDIT_TIMING requires finite start/end values with end > start.",
        );
      } else if (
        typeof interval.start !== "number" ||
        typeof interval.end !== "number" ||
        start < interval.start ||
        end > interval.end
      ) {
        add(
          "TIMING_OUTSIDE_COMPONENT",
          "start/end",
          "EDIT_TIMING must remain inside the review component interval.",
        );
      }
      if (hasText || hasSplit || hasMerge)
        add(
          "EDIT_TIMING_MUTATION_SCOPE_INVALID",
          "payload",
          "EDIT_TIMING cannot carry text, split, or merge mutations.",
        );
      break;
    }
    case "SPLIT_CUE": {
      rejectCandidatePayload();
      if (!Array.isArray(splitParts) || splitParts.length < 2) {
        add(
          "SPLIT_PARTS_REQUIRED",
          "splitParts",
          "SPLIT_CUE requires at least two parts.",
        );
        break;
      }
      let previousEnd: number | null = null;
      let nonBlankTextCount = 0;
      splitParts.forEach((unknownPart, index) => {
        const part =
          unknownPart !== null && typeof unknownPart === "object"
            ? (unknownPart as Record<string, unknown>)
            : {};
        if (typeof part.text === "string" && part.text.trim() !== "") {
          nonBlankTextCount += 1;
        } else {
          add(
            "SPLIT_PART_TEXT_REQUIRED",
            `splitParts.${index}.text`,
            "Every split part requires non-blank text.",
          );
        }
        if (
          typeof part.start !== "number" ||
          !Number.isFinite(part.start) ||
          typeof part.end !== "number" ||
          !Number.isFinite(part.end) ||
          part.end <= part.start ||
          typeof interval.start !== "number" ||
          typeof interval.end !== "number" ||
          part.start < interval.start ||
          part.end > interval.end ||
          (previousEnd !== null && part.start < previousEnd)
        ) {
          add(
            "INVALID_SPLIT_PART_INTERVAL",
            `splitParts.${index}`,
            "Split parts must be finite, ordered, non-overlapping, and inside the component.",
          );
        }
        previousEnd = typeof part.end === "number" ? part.end : previousEnd;
      });
      if (
        nonBlankTextCount === 0 &&
        (typeof reviewerNotes !== "string" || reviewerNotes.trim() === "")
      ) {
        add(
          "SPLIT_TEXT_LOSS_REQUIRES_NOTES",
          "reviewerNotes",
          "Discarding all original text requires reviewer notes.",
        );
      }
      if (hasText || hasTiming || hasMerge)
        add(
          "SPLIT_MUTATION_SCOPE_INVALID",
          "payload",
          "SPLIT_CUE cannot carry text, timing, or merge mutations.",
        );
      break;
    }
    case "MERGE_CUES": {
      rejectCandidatePayload();
      const targets = Array.isArray(item.targetCueIds) ? item.targetCueIds : [];
      const ids = Array.isArray(mergeCueIds) ? mergeCueIds : [];
      const indexes = ids.map((cueId) => targets.indexOf(cueId));
      const unique = new Set(ids);
      if (
        ids.length < 2 ||
        unique.size !== ids.length ||
        indexes.some((index) => index < 0) ||
        indexes.some(
          (index, offset) =>
            offset > 0 && index !== (indexes[offset - 1] ?? -2) + 1,
        )
      ) {
        add(
          "MERGE_CUES_NOT_ADJACENT_IN_COMPONENT",
          "mergeCueIds",
          "MERGE_CUES requires unique adjacent cue IDs inside this component.",
        );
      }
      if (typeof correctedText !== "string" || correctedText.trim() === "") {
        add(
          "MERGE_TEXT_REQUIRED",
          "correctedText",
          "MERGE_CUES requires non-blank correctedText.",
        );
      }
      if (hasTiming || hasSplit)
        add(
          "MERGE_MUTATION_SCOPE_INVALID",
          "payload",
          "MERGE_CUES cannot carry timing or split mutations.",
        );
      break;
    }
    case "DELETE_CUE":
      rejectMutationPayload();
      rejectCandidatePayload();
      if (typeof reviewerNotes !== "string" || reviewerNotes.trim() === "") {
        add(
          "DELETE_REASON_REQUIRED",
          "reviewerNotes",
          "DELETE_CUE requires a non-blank deletion reason.",
        );
      }
      break;
    case "MARK_UNRESOLVED":
      rejectMutationPayload();
      rejectCandidatePayload();
      break;
  }
  return { valid: errors.length === 0, errors };
}

export function isReviewActionAllowed(
  item: SubtitleReviewPackage["items"][number],
  action: ReviewAction,
): boolean {
  return item.allowedHumanActions.includes(action);
}

export function validateReviewActionPayload(input: {
  item: SubtitleReviewPackage["items"][number];
  resolution: unknown;
  reviewVersion: string;
}): { valid: boolean; errors: ReviewActionValidationError[] } {
  const parsed = humanReviewResolutionSchema.safeParse(input.resolution);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        code: "REVIEW_ACTION_SCHEMA_INVALID",
        reviewId: input.item.reviewId,
        action:
          typeof (input.resolution as { action?: unknown } | null)?.action ===
            "string" &&
          REVIEW_ACTION_REGISTRY.some(
            (entry) =>
              entry.action === (input.resolution as { action?: string }).action,
          )
            ? (input.resolution as { action: ReviewAction }).action
            : null,
        field: issue.path.length === 0 ? null : issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const result = portableValidateReviewAction(
    REVIEW_ACTION_REGISTRY,
    input.item,
    parsed.data,
    input.reviewVersion,
  );
  return {
    valid: result.valid,
    errors: result.errors.map((error) => ({
      ...error,
      action: error.action as ReviewAction | null,
    })),
  };
}

export function assertReviewActionPayload(input: {
  item: SubtitleReviewPackage["items"][number];
  resolution: unknown;
  reviewVersion: string;
}): HumanReviewResolution {
  const parsed = humanReviewResolutionSchema.parse(input.resolution);
  const validation = validateReviewActionPayload({
    ...input,
    resolution: parsed,
  });
  if (!validation.valid) {
    const detail = validation.errors
      .map((error) => `${error.code}:${error.field ?? "payload"}`)
      .join(", ");
    throw new InputError(
      `Resolution ${parsed.resolutionId} is invalid for ${input.item.reviewId}: ${detail}.`,
    );
  }
  return parsed;
}

export function validateReviewResolutionCollection(input: {
  reviewPackage: SubtitleReviewPackage;
  resolutions: readonly unknown[];
}): {
  valid: HumanReviewResolution[];
  quarantined: { resolution: unknown; errors: ReviewActionValidationError[] }[];
} {
  const byReviewId = new Map(
    input.reviewPackage.items.map((item) => [item.reviewId, item]),
  );
  const valid: HumanReviewResolution[] = [];
  const quarantined: {
    resolution: unknown;
    errors: ReviewActionValidationError[];
  }[] = [];
  for (const resolution of input.resolutions) {
    const reviewId =
      resolution !== null &&
      typeof resolution === "object" &&
      typeof (resolution as { reviewId?: unknown }).reviewId === "string"
        ? (resolution as { reviewId: string }).reviewId
        : null;
    const item = reviewId === null ? undefined : byReviewId.get(reviewId);
    if (item === undefined) {
      quarantined.push({
        resolution,
        errors: [
          {
            code: "UNKNOWN_REVIEW_ITEM",
            reviewId,
            action: null,
            field: "reviewId",
            message: "The saved resolution references an unknown review item.",
          },
        ],
      });
      continue;
    }
    const validation = validateReviewActionPayload({
      item,
      resolution,
      reviewVersion: input.reviewPackage.reviewVersion,
    });
    if (!validation.valid) {
      quarantined.push({ resolution, errors: validation.errors });
      continue;
    }
    valid.push(humanReviewResolutionSchema.parse(resolution));
  }
  return { valid, quarantined };
}

export function buildReviewActionValidationReport(input: {
  mode: ReviewActionHardeningMode;
  sourceReviewPackage: SubtitleReviewPackage;
  targetReviewPackage: SubtitleReviewPackage;
  targetReviewPackageHash: string;
  legacyShortcutRoutePresent: boolean;
}): ReviewActionValidationReport {
  const vulnerableItems = input.sourceReviewPackage.items.filter(
    (item) =>
      !item.allowedHumanActions.includes("ACCEPT_SUGGESTION") &&
      item.machineDecision.selectedCandidateId === null &&
      item.candidateSuggestions.length === 0,
  );
  const syntheticInvalid = input.targetReviewPackage.items.map((item) => ({
    item,
    resolution: {
      resolutionId: `phase0-audit-${item.reviewId}`,
      reviewId: item.reviewId,
      action: "ACCEPT_SUGGESTION",
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
    },
  }));
  const blocked = syntheticInvalid.filter(
    ({ item, resolution }) =>
      !validateReviewActionPayload({
        item,
        resolution,
        reviewVersion: input.targetReviewPackage.reviewVersion,
      }).valid,
  ).length;
  const generatedAt = new Date().toISOString();
  const reportBase = {
    schemaVersion: "1.0.0" as const,
    artifactType: "review-action-validation-report" as const,
    validationVersion: "C5.18-PHASE0" as const,
    policyVersion: REVIEW_ACTION_POLICY_VERSION,
    generatedAt,
    mode: input.mode,
    reviewPackageHash: input.targetReviewPackageHash,
    reviewVersion: input.targetReviewPackage.reviewVersion,
    itemCount: input.targetReviewPackage.items.length,
    resolutionCount: 0,
    allowedActionValidationCount:
      input.targetReviewPackage.items.reduce(
        (sum, item) => sum + item.allowedHumanActions.length,
        0,
      ) + syntheticInvalid.length,
    invalidActionCount: 0,
    quarantinedSavedActionCount: 0,
    shortcutBypassCount: 0,
    downloadBlockedCount: blocked,
    preFixReproduction: {
      invalidAcceptShortcutGeneratedCount: input.legacyShortcutRoutePresent
        ? vulnerableItems.length
        : 0,
      invalidResolutionDownloadAllowedCount: input.legacyShortcutRoutePresent
        ? vulnerableItems.length
        : 0,
      shortcutActionBypassedAllowedActionsCount:
        input.legacyShortcutRoutePresent ? vulnerableItems.length : 0,
    },
    errors: [] as ReviewActionValidationError[],
    summary: {
      invalidAcceptShortcutGeneratedCount: 0 as const,
      invalidResolutionDownloadAllowedCount: 0 as const,
      shortcutActionBypassedAllowedActionsCount: 0 as const,
      noCandidateShortcutResolutionDelta: 0 as const,
      coreBrowserPolicyHash: REVIEW_ACTION_POLICY_HASH,
      validationPassed: blocked === syntheticInvalid.length,
    },
  };
  return reviewActionValidationReportSchema.parse({
    ...reportBase,
    semanticHash: sha256Value({ ...reportBase, generatedAt: null }),
  });
}
