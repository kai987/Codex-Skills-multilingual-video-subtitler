import {
  c60114WorkspaceExtensionSchema,
  type C60114WorkspaceExtension,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { assertC60114SourceIdentity, c60114Coverage } from "./c60114-policy.js";
import type {
  C60112ReviewWorkspaceData,
  C60112ReviewDecisionType,
} from "./c60112-review-workspace.js";
import { assertC60114PlaybackTimelineIntegrity } from "./review-playback-timeline-v2.js";

/** Legacy machine items can contain a union of actions from several signals.
 * Retain only actions authorized by the already-validated transaction UI and
 * the exact cue count. This does not change risk, priority, or canonical data. */
export function c60114TransactionActions(input: {
  finalCueIds: readonly string[];
  suggestedActions: readonly C60112ReviewDecisionType[];
  previousUiActions?: readonly C60112ReviewDecisionType[] | undefined;
}): C60112ReviewDecisionType[] {
  const allowed: readonly C60112ReviewDecisionType[] =
    input.finalCueIds.length === 0
      ? ["ADD_NEW_CUE", "MARK_FALSE_POSITIVE", "UNRESOLVED", "WAIVE_REVIEW"]
      : input.finalCueIds.length === 1
        ? [
            "KEEP_CURRENT",
            "USE_REAZON",
            "USE_WHISPER_ALTERNATE",
            "MANUAL_EDIT",
            "TIMING_EDIT",
            "UNRESOLVED",
            "WAIVE_REVIEW",
          ]
        : ["KEEP_CURRENT", "UNRESOLVED", "WAIVE_REVIEW"];
  return [...new Set(input.suggestedActions)].filter(
    (action) =>
      allowed.includes(action) &&
      (input.previousUiActions?.includes(action) ?? true),
  );
}

export function buildC60114WorkspaceExtension(
  input: Omit<C60114WorkspaceExtension, "semanticHash">,
): C60114WorkspaceExtension {
  return c60114WorkspaceExtensionSchema.parse({
    ...input,
    semanticHash: machineQualitySemanticHash(input),
  });
}

/** The old transaction envelope freezes this complete source-target extension.
 * No target, WAV, budget or provider text is accepted from a mutable UI payload. */
export function assertC60114WorkspaceExtension(
  data: C60112ReviewWorkspaceData,
): void {
  if (!data.sourceTargetReviewV3) return;
  const value = c60114WorkspaceExtensionSchema.parse(data.sourceTargetReviewV3);
  const { semanticHash, ...core } = value;
  if (machineQualitySemanticHash(core) !== semanticHash)
    throw new Error("C60114_WORKSPACE_EXTENSION_HASH_MISMATCH");
  const durationMs = data.sourceMediaIdentity.sourceDurationMs;
  const durationSeconds = data.sourceMediaIdentity.durationSeconds;
  const normalizedDuration =
    typeof durationMs === "number" ? durationMs / 1000 : durationSeconds;
  const sha256 = data.sourceMediaIdentity.sha256;
  const sourceMediaSha256 = data.sourceMediaIdentity.sourceMediaSha256;
  if (
    (sha256 ?? sourceMediaSha256) !== value.sourceIdentity.sourceMediaSha256 ||
    (typeof sha256 === "string" &&
      typeof sourceMediaSha256 === "string" &&
      sha256 !== sourceMediaSha256) ||
    typeof normalizedDuration !== "number" ||
    !Number.isFinite(normalizedDuration) ||
    Math.abs(normalizedDuration - value.sourceIdentity.durationSeconds) >
      1e-8 ||
    (typeof durationMs === "number" &&
      typeof durationSeconds === "number" &&
      Math.abs(durationMs / 1000 - durationSeconds) > 1e-8)
  )
    throw new Error("C60114_WORKSPACE_SOURCE_IDENTITY_MISMATCH");
  assertC60114PlaybackTimelineIntegrity({
    sourceIdentity: value.sourceIdentity,
    policyHash: value.policyHash,
    targets: value.targets,
    regions: value.regions,
    audio: value.audio,
    playback: value.playback,
  });
  for (const island of value.islands) {
    assertC60114SourceIdentity(island.sourceIdentity, value.sourceIdentity);
    if (island.sourceInterval.end > value.sourceIdentity.durationSeconds)
      throw new Error("C60114_WORKSPACE_ISLAND_OUT_OF_SOURCE");
  }
  for (const artifact of [value.lexical, value.missing]) {
    assertC60114SourceIdentity(artifact.sourceIdentity, value.sourceIdentity);
    const { semanticHash: artifactHash, ...artifactCore } = artifact;
    if (
      machineQualitySemanticHash(artifactCore) !== artifactHash ||
      artifact.sourceIdentityHash !==
        machineQualitySemanticHash(value.sourceIdentity) ||
      artifact.policyHash !== value.policyHash
    )
      throw new Error("C60114_WORKSPACE_LEXICAL_OR_MISSING_BINDING_MISMATCH");
  }
  if (value.missing.lexicalEvidenceHash !== value.lexical.semanticHash)
    throw new Error("C60114_WORKSPACE_MISSING_LEXICAL_HASH_MISMATCH");
  const items = new Set(data.items.map((item) => item.reviewItemId));
  const targetIds = new Set(
    value.targets.targets.map((target) => target.reviewTargetId),
  );
  const regionIds = new Set(
    value.regions.regions.map((region) => region.regionId),
  );
  const audio = new Map(value.audio.audio.map((clip) => [clip.audioId, clip]));
  for (const artifact of [
    value.targets,
    value.regions,
    value.audio,
    value.playback,
  ]) {
    assertC60114SourceIdentity(artifact.sourceIdentity, value.sourceIdentity);
    if (artifact.policyHash !== value.policyHash)
      throw new Error("C60114_WORKSPACE_POLICY_MISMATCH");
  }
  for (const target of value.targets.targets) {
    if (!items.has(target.parentReviewItemId))
      throw new Error("C60114_WORKSPACE_TARGET_ITEM_MISMATCH");
    assertC60114SourceIdentity(target.sourceIdentity, value.sourceIdentity);
  }
  for (const id of value.unresolvedItemIds) {
    if (
      !items.has(id) ||
      value.targets.targets.some((target) => target.parentReviewItemId === id)
    )
      throw new Error("C60114_WORKSPACE_UNRESOLVED_IDENTITY_MISMATCH");
  }
  for (const region of value.regions.regions) {
    const compatible = data.regions.find(
      (entry) => entry.regionId === region.regionId,
    );
    if (!compatible || region.reviewTargetIds.some((id) => !targetIds.has(id)))
      throw new Error("C60114_WORKSPACE_REGION_IDENTITY_MISMATCH");
    const clip = value.audio.audio.find((entry) =>
      entry.regionIds.includes(region.regionId),
    );
    if (!clip) throw new Error("C60114_WORKSPACE_PHYSICAL_AUDIO_MISMATCH");
    if (
      compatible.audioPath !== clip.relativePath ||
      compatible.audioSha256 !== clip.sha256
    )
      throw new Error("C60114_WORKSPACE_PHYSICAL_AUDIO_MISMATCH");
    if (
      compatible.audioSourceInterval?.start !== clip.sourceInterval.start ||
      compatible.audioSourceInterval.end !== clip.sourceInterval.end
    )
      throw new Error("C60114_WORKSPACE_AUDIO_OFFSET_MISMATCH");
  }
  for (const segment of value.playback.segments) {
    const clip = audio.get(segment.audioId);
    if (
      !clip ||
      segment.regionIds.some((id) => !regionIds.has(id)) ||
      segment.reviewTargetIds.some((id) => !targetIds.has(id))
    )
      throw new Error("C60114_WORKSPACE_PLAYBACK_REFERENCE_MISMATCH");
    if (
      c60114Coverage(segment.sourceInterval, [clip.sourceInterval]) <
        1 - 1e-8 ||
      Math.abs(
        segment.sourceInterval.start -
          clip.sourceInterval.start -
          segment.audioLocalInterval.start,
      ) > 1e-8 ||
      Math.abs(
        segment.sourceInterval.end -
          clip.sourceInterval.start -
          segment.audioLocalInterval.end,
      ) > 1e-8
    )
      throw new Error("C60114_WORKSPACE_PLAYBACK_OFFSET_MISMATCH");
  }
  const segments = new Set(
    value.playback.segments.map((segment) => segment.playbackSegmentId),
  );
  for (const plan of value.playback.plans)
    if (
      plan.playbackSegmentIds.some((id) => !segments.has(id)) ||
      plan.audioIds.some((id) => !audio.has(id))
    )
      throw new Error("C60114_WORKSPACE_PLAN_REFERENCE_MISMATCH");
}
