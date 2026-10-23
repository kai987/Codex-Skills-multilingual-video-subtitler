import {
  c60114ReviewTargetSchema,
  c60114ReviewTargetsSchema,
  type C60114Interval,
  type C60114OrphanSpeechSweep,
  type C60114Policy,
  type C60114ReviewTarget,
  type C60114ReviewTargets,
  type C60114SourceIdentity,
  type C60114SpeechIslands,
} from "@mvl/shared";
import { type C60112ReviewItem } from "./c60112-policy.js";
import {
  assertC60114SourceIdentity,
  c60114ArtifactHeader,
  c60114Id,
  c60114Intersection,
  uniqueC60114,
  withC60114SemanticHash,
} from "./c60114-policy.js";

export interface C60114ReviewAnchor {
  itemIds: readonly string[];
  targetType: C60114ReviewTarget["targetType"];
  sourceInterval: C60114Interval;
  targetAnchorIds: readonly string[];
  finalCueIds?: readonly string[];
  eventIds?: readonly string[];
  evidenceIds?: readonly string[];
  sourceIdentity: C60114SourceIdentity;
  verified: boolean;
}

/** Review items are containers. Each actual current cue and each disjoint
 * localized concern retains its own target; item.coreInterval is never used. */
export function buildC60114ReviewTargetIntervalsV2(input: {
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  items: readonly C60112ReviewItem[];
  finalCues: readonly ({ id: string } & C60114Interval)[];
  speechIslands?: C60114SpeechIslands;
  orphanSweep?: C60114OrphanSpeechSweep;
  anchors?: readonly C60114ReviewAnchor[];
}): C60114ReviewTargets {
  const header = c60114ArtifactHeader(input.policy, input.sourceIdentity);
  if (input.speechIslands)
    assertC60114SourceIdentity(
      input.speechIslands.sourceIdentity,
      input.sourceIdentity,
    );
  if (input.orphanSweep)
    assertC60114SourceIdentity(
      input.orphanSweep.sourceIdentity,
      input.sourceIdentity,
    );
  const targets: C60114ReviewTarget[] = [];
  const itemMap = new Map(input.items.map((i) => [i.reviewItemId, i]));
  const add = (
    itemId: string,
    targetType: C60114ReviewTarget["targetType"],
    sourceInterval: C60114Interval,
    anchorIds: readonly string[],
    extra: Partial<
      Pick<
        C60114ReviewTarget,
        | "evidenceIds"
        | "finalCueIds"
        | "eventIds"
        | "localizationStatus"
        | "mandatoryForAudio"
        | "reasons"
      >
    > = {},
  ) => {
    const item = itemMap.get(itemId);
    const core = {
      reviewTargetId: c60114Id("review-target", {
        source: input.sourceIdentity,
        itemId,
        targetType,
        sourceInterval,
        targetAnchorIds: uniqueC60114(anchorIds),
      }),
      parentReviewItemId: itemId,
      targetType,
      sourceInterval,
      targetAnchorIds: uniqueC60114(anchorIds),
      finalCueIds: [],
      eventIds: uniqueC60114(item?.eventIds ?? []),
      evidenceIds: [],
      mandatoryForAudio: item?.requiredLevel === "REQUIRED",
      audioRequired: true,
      localizationStatus: "VERIFIED" as const,
      sourceIdentity: input.sourceIdentity,
      reasons: ["EXPLICIT_SOURCE_LOCALIZED_TARGET_NOT_ITEM_CORE"],
      ...extra,
    };
    targets.push(
      c60114ReviewTargetSchema.parse(
        withC60114SemanticHash({
          ...core,
          finalCueIds: uniqueC60114(core.finalCueIds),
          eventIds: uniqueC60114(core.eventIds),
          evidenceIds: uniqueC60114(core.evidenceIds),
          reasons: uniqueC60114(core.reasons),
        }),
      ),
    );
  };
  const cues = new Map(input.finalCues.map((c) => [c.id, c]));
  for (const item of input.items.toSorted((a, b) =>
    a.reviewItemId.localeCompare(b.reviewItemId),
  )) {
    const hallucination = item.itemTypes.includes("TEXT_HALLUCINATION_RISK");
    const cueConcern = item.itemTypes.some(
      (t) =>
        t.startsWith("TEXT_") ||
        t.startsWith("TIMING_") ||
        t === "OVERLAP_RISK" ||
        t === "MULTI_SPEAKER_RISK" ||
        t === "LOCALIZATION_RISK" ||
        t === "SPAN_LINEAGE_BLOCKED" ||
        t === "EVIDENCE_CONFLICT" ||
        t === "GENERAL_UNCERTAINTY",
    );
    if (cueConcern) {
      for (const id of uniqueC60114(item.finalCueIds)) {
        const cue = cues.get(id);
        if (cue === undefined) continue;
        const type = hallucination
          ? "CURRENT_CUE_HALLUCINATION_TARGET"
          : item.itemTypes.some((t) => t.startsWith("TEXT_"))
            ? "CURRENT_CUE_TEXT_TARGET"
            : item.itemTypes.some((t) => t.startsWith("TIMING_"))
              ? "TIMING_BOUNDARY_TARGET"
              : item.itemTypes.includes("OVERLAP_RISK")
                ? "OVERLAP_COMPONENT_TARGET"
                : item.itemTypes.includes("MULTI_SPEAKER_RISK")
                  ? "MULTI_SPEAKER_TARGET"
                  : "LOCALIZATION_TARGET";
        add(
          item.reviewItemId,
          type,
          { start: cue.start, end: cue.end },
          [cue.id],
          {
            finalCueIds: [cue.id],
            evidenceIds: item.evidenceIds,
            reasons: [
              hallucination
                ? "FULL_CURRENT_CUE_HALLUCINATION_INTERVAL"
                : "FULL_CURRENT_CUE_INTERVAL",
              "CURRENT_CUE_TEXT_AND_TIME_PRESERVED",
            ],
          },
        );
      }
    }
  }
  for (const island of input.speechIslands?.islands ?? []) {
    if (!island.speechPositive) continue;
    const itemIds = island.itemIds.length
      ? island.itemIds
      : [`c60114-item-${island.islandId}`];
    for (const itemId of itemIds)
      add(
        itemId,
        "MISSING_SPEECH_ISLAND_TARGET",
        island.sourceInterval,
        [island.islandId],
        {
          evidenceIds: island.evidenceIds,
          localizationStatus: island.localizationStatus,
          reasons: ["CHILD_SPEECH_ISLAND_NOT_PARENT_GAP", ...island.reasons],
        },
      );
  }
  for (const orphan of input.orphanSweep?.entries ?? []) {
    if (!orphan.classification.startsWith("ORPHAN_")) continue;
    add(
      `c60114-item-${orphan.orphanId}`,
      "ORPHAN_SPEECH_TARGET",
      orphan.sourceInterval,
      [orphan.orphanId, orphan.sourceIslandId],
      {
        evidenceIds: orphan.evidenceIds,
        localizationStatus:
          orphan.durationStatus === "BOUNDED" ? "VERIFIED" : "UNRESOLVED",
        reasons: [
          "GLOBAL_MACHINE_EVIDENCE_ORPHAN_NOT_PARENT_GAP",
          ...orphan.reasons,
        ],
      },
    );
  }
  for (const anchor of input.anchors ?? []) {
    assertC60114SourceIdentity(anchor.sourceIdentity, input.sourceIdentity);
    if (!anchor.verified) continue;
    for (const itemId of uniqueC60114(anchor.itemIds))
      add(
        itemId,
        anchor.targetType,
        anchor.sourceInterval,
        anchor.targetAnchorIds,
        {
          finalCueIds: [...(anchor.finalCueIds ?? [])],
          eventIds: [...(anchor.eventIds ?? [])],
          evidenceIds: [...(anchor.evidenceIds ?? [])],
        },
      );
  }
  const uniqueTargets = [
    ...new Map(targets.map((t) => [t.reviewTargetId, t])).values(),
  ].toSorted(
    (a, b) =>
      a.parentReviewItemId.localeCompare(b.parentReviewItemId) ||
      a.sourceInterval.start - b.sourceInterval.start ||
      a.reviewTargetId.localeCompare(b.reviewTargetId),
  );
  const unresolvedItems = input.items
    .filter(
      (i) =>
        !uniqueTargets.some((t) => t.parentReviewItemId === i.reviewItemId),
    )
    .map((i) => ({
      reviewItemId: i.reviewItemId,
      reasons: [
        "NO_VERIFIED_LOCALIZED_TARGET_ANCHOR",
        "ITEM_CORE_AND_PARENT_GAP_NOT_PROMOTED_TO_TARGET",
      ],
    }))
    .toSorted((a, b) => a.reviewItemId.localeCompare(b.reviewItemId));
  const itemIds = uniqueC60114(uniqueTargets.map((t) => t.parentReviewItemId));
  const disjointItemCount = itemIds.filter((id) => {
    const rows = uniqueTargets.filter((t) => t.parentReviewItemId === id);
    return rows.some((a, i) =>
      rows
        .slice(i + 1)
        .some(
          (b) =>
            c60114Intersection(a.sourceInterval, b.sourceInterval) === null,
        ),
    );
  }).length;
  return c60114ReviewTargetsSchema.parse(
    withC60114SemanticHash({
      ...header,
      artifactType: "review-target-intervals-v2",
      targets: uniqueTargets,
      unresolvedItems,
      summary: {
        targetCount: uniqueTargets.length,
        itemCount: itemIds.length,
        unresolvedItemCount: unresolvedItems.length,
        disjointItemCount,
        coreFallbackCount: 0,
      },
    }),
  );
}
