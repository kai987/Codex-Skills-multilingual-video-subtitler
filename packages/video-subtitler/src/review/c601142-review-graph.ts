import {
  c60114ReviewTargetSchema,
  c60114ReviewTargetsSchema,
  c60114ReviewItemV4Schema,
  c60114ReviewItemsV4Schema,
  c60114ReviewRegionsV3Schema,
  reviewTargets142Schema,
  reviewItems142Schema,
  reviewRegions142Schema,
  type Policy142,
  type Inventory142,
  type Safety142,
  type Lexical142,
  type Missing142,
  type C60114Policy,
  type C60114ReviewTargets,
  type C60114ReviewItemsV4,
  type C60114ReviewRegionsV3,
  type C60113EvidenceFamilyGraph,
} from "@mvl/shared";
import {
  hash141,
  hashed141,
  assertHash141,
  id141,
  required141,
  seconds141,
  union141,
} from "./c601141-policy.js";
import { header142 } from "./c601142-policy.js";
import { unique142 } from "./c601142-selection.js";
import { buildC60112ReviewPolicy } from "./c60112-policy.js";
import { buildC60113ReviewPolicy } from "./c60113-policy.js";
import { buildC60112ReviewItems } from "./review-item-builder.js";
import { buildC60113ReviewItems } from "./structured-review-priority.js";
import { buildC60113MissingSpeechEvidence } from "./missing-speech-evidence-v2.js";
import {
  c60113Observation,
  buildC60113EvidenceFamilyGraph,
} from "./review-evidence-family-graph.js";
import { clusterC60114ReviewRegions } from "./review-region-clustering-v3.js";
/** The graph consumes positive cores, not C142 cluster-eligibility decisions.
 * Keeping this structural boundary explicit lets later bundle delivery reuse
 * the unchanged R3/transaction projection without falsely claiming that a
 * bundle envelope satisfies C142's no-cue-crossing cluster contract. */
export interface SafetyCoreGraphProjection142 {
  sourceIdentity: Safety142["sourceIdentity"];
  semanticHash: string;
  targets: (Pick<
    Safety142["targets"][number],
    | "targetId"
    | "clusterId"
    | "targetCoreUnion"
    | "reviewEnvelope"
    | "parentIslandIds"
    | "memberCandidateIds"
    | "observationIds"
    | "evidenceIds"
    | "sceneIds"
    | "evidenceStrata"
    | "detectorFamilies"
  > & { reviewEventIds?: string[] })[];
  summary: { targetUnionSeconds: number };
}
export function buildReviewGraph142(input: {
  policy: Policy142;
  compatibilityPolicy: C60114Policy;
  inventory: Inventory142;
  safety: SafetyCoreGraphProjection142;
  lexical: Lexical142;
  missing: Missing142;
  supersessionHash: string;
  baselineTargets: C60114ReviewTargets;
  baselineItems: C60114ReviewItemsV4;
  baselineRegions: C60114ReviewRegionsV3;
  frozenR3Families: C60113EvidenceFamilyGraph;
}) {
  const { policy, inventory, safety, lexical, missing } = input;
  [
    policy,
    inventory,
    safety,
    lexical,
    missing,
    input.baselineTargets,
    input.baselineItems,
    input.baselineRegions,
  ].forEach(assertHash141);
  const source = safety.sourceIdentity,
    rate = source.sampleRate,
    r3 = buildC60113ReviewPolicy();
  if (
    hash141(source) !== hash141(input.baselineTargets.sourceIdentity) ||
    input.baselineRegions.targetsHash !== input.baselineTargets.semanticHash
  )
    throw new Error("C601142_BASELINE_REVIEW_BINDING_MISMATCH");
  const itemId = (targetId: string) =>
    id141("safety-v2-review-item", { source, targetId });
  const additions = safety.targets.flatMap((cluster) =>
    cluster.targetCoreUnion.map((nativeInterval) =>
      c60114ReviewTargetSchema.parse(
        hashed141({
          reviewTargetId: id141("safety-v2-atomic-review-target", {
            clusterId: cluster.clusterId,
            nativeInterval,
          }),
          parentReviewItemId: itemId(cluster.targetId),
          targetType: "ORPHAN_SPEECH_TARGET",
          sourceInterval: seconds141(nativeInterval, rate),
          targetAnchorIds: [
            cluster.targetId,
            cluster.clusterId,
            ...cluster.parentIslandIds,
          ],
          finalCueIds: [],
          eventIds: cluster.reviewEventIds ?? cluster.memberCandidateIds,
          evidenceIds: cluster.evidenceIds,
          mandatoryForAudio: false,
          audioRequired: true,
          localizationStatus: "VERIFIED",
          sourceIdentity: source,
          reasons: [
            "C601142_ATOMIC_CORE_UNION_NOT_REVIEW_ENVELOPE",
            ...cluster.evidenceStrata,
            "HUMAN_ONLY_NO_CANONICAL_INSERT",
          ],
        }),
      ),
    ),
  );
  const targetCluster = (targetId: string) =>
    safety.targets.find((cluster) =>
      additions.some(
        (t) =>
          t.reviewTargetId === targetId &&
          t.parentReviewItemId === itemId(cluster.targetId),
      ),
    );
  const compatibleTargets = c60114ReviewTargetsSchema.parse(
    hashed141({
      ...input.baselineTargets,
      targets: [...input.baselineTargets.targets, ...additions],
      summary: {
        ...input.baselineTargets.summary,
        targetCount: input.baselineTargets.targets.length + additions.length,
        itemCount: input.baselineItems.items.length + safety.targets.length,
      },
    }),
  );
  const observations = safety.targets.flatMap((cluster) =>
    inventory.observations
      .filter((o) => cluster.observationIds.includes(o.observationId))
      .flatMap((o) =>
        cluster.targetCoreUnion.flatMap((core) => {
          const startSample = Math.max(
              core.startSample,
              o.nativeInterval.startSample,
            ),
            endSample = Math.min(core.endSample, o.nativeInterval.endSample);
          if (endSample <= startSample || !o.verifiedTimebase) return [];
          return [
            c60113Observation({
              evidenceId: id141("safety-v2-r3-evidence", [
                cluster.targetId,
                o.observationId,
                startSample,
                endSample,
              ]),
              rootLineageIds: [o.correlationGroup],
              family:
                o.family === "PYANNOTE"
                  ? "SPEAKER_ACTIVITY"
                  : "SPEECH_ACTIVITY",
              provider: o.family,
              correlationGroup: o.correlationGroup,
              itemIds: [itemId(cluster.targetId)],
              gapIds: additions
                .filter(
                  (t) => t.parentReviewItemId === itemId(cluster.targetId),
                )
                .map((t) => t.reviewTargetId),
              sourceInterval: seconds141({ startSample, endSample }, rate),
              positiveRisk: o.speechPositive && !o.strongContradiction,
              evidenceAbsence: !o.speechPositive && !o.strongContradiction,
              contradiction: o.strongContradiction,
              strength: o.speechPositive
                ? o.scoreLevel === "AUDIT_SUBTHRESHOLD"
                  ? 0.5
                  : 1
                : 0,
              validatedSourceGlobal: true,
              detailCode:
                o.scoreLevel === "AUDIT_SUBTHRESHOLD"
                  ? "SUBTHRESHOLD_REVIEW_SAFETY_NOT_SPEECH_TRUTH"
                  : "NATIVE_SPEECH_PRESENCE_NOT_TRANSCRIPT_TRUTH",
            }),
          ];
        }),
      ),
  );
  const families = buildC60113EvidenceFamilyGraph({
    observations: [...input.frozenR3Families.evidence, ...observations],
    policy: r3,
  });
  const newItems = safety.targets.map((cluster, index) => {
    const related = additions.filter(
        (t) => t.parentReviewItemId === itemId(cluster.targetId),
      ),
      first = required141(related[0]);
    const base = required141(
      buildC60112ReviewItems({
        policy: buildC60112ReviewPolicy({
          policyFrozenAt: "1970-01-01T00:00:00.000Z",
        }),
        signals: [
          {
            reviewGroupId: first.parentReviewItemId,
            eventIds: cluster.reviewEventIds ?? cluster.memberCandidateIds,
            finalCueIds: [],
            itemTypes: ["MISSING_SPEECH_RISK"],
            sourceInterval: seconds141(cluster.reviewEnvelope, rate),
            coreInterval: first.sourceInterval,
            currentText: null,
            candidateIds: [],
            evidenceIds: cluster.evidenceIds,
            reviewReasons: [
              "MISSING_DIALOGUE_SUSPECTED",
              "MACHINE_EVIDENCE_INCOMPLETE",
            ],
            suggestedActions: [
              "ADD_NEW_CUE",
              "MARK_FALSE_POSITIVE",
              "UNRESOLVED",
              "WAIVE_REVIEW",
            ],
            sceneIds: cluster.sceneIds,
            speakerGroupIds: [],
          },
        ],
      }).items[0],
    );
    const identified = hashed141({
      ...base,
      reviewItemId: first.parentReviewItemId,
    });
    const missingEvidence = buildC60113MissingSpeechEvidence({
      gaps: related.map((t) => ({
        gapId: t.reviewTargetId,
        sourceInterval: t.sourceInterval,
        itemIds: [t.parentReviewItemId],
        legacySignal: false,
        validatedSourceGlobal: true,
        cueCoveredRatio: 0,
      })),
      evidenceFamilies: families,
      legacyMissingItemCount: 0,
      policy: r3,
    });
    const scored = required141(
      buildC60113ReviewItems({
        items: [identified],
        evidenceFamilies: families,
        missingEvidence,
        candidateBundles: [],
        policy: r3,
      }).items[0],
    );
    return c60114ReviewItemV4Schema.parse(
      hashed141({
        ...scored,
        reviewTargetIds: related.map((t) => t.reviewTargetId),
        sourceIntervals: related.map((t) => t.sourceInterval),
        itemTypes: [...scored.itemTypes, "ORPHAN_SPEECH_REVIEW"],
        requiredLevel: "RECOMMENDED",
        mandatoryReasons: [],
        rankPosition: input.baselineItems.items.length + index + 1,
        origin: "ORPHAN_SPEECH",
        speechIslandIds: cluster.parentIslandIds,
        orphanIds: [],
        missingClassificationV3:
          missing.targets.find((t) => t.targetId === cluster.targetId)
            ?.missingEvidenceClass ?? null,
        legacyItemIds: [],
        canonicalMutationAllowed: false,
        uncertaintyReasons: unique142([
          ...scored.uncertaintyReasons,
          "C601142_SAFETY_NOT_MANDATORY_RECALIBRATION",
          "FROZEN_R3_NO_NEW_OOF",
          "ASR_EMPTY_DOES_NOT_DELETE_SPEECH_TARGET",
        ]),
      }),
    );
  });
  const itemSummary = {
    previousItemCount: input.baselineItems.items.length,
    itemCount: input.baselineItems.items.length + newItems.length,
    migratedItemCount: input.baselineItems.items.length,
    createdItemCount: newItems.length,
    orphanItemCount:
      input.baselineItems.items.filter((i) => !i.finalCueIds.length).length +
      newItems.length,
    requiredItemCount: input.baselineItems.items.filter(
      (i) => i.requiredLevel === "REQUIRED",
    ).length,
    previousItemsDeleted: 0,
    canonicalTextMutationCount: 0,
    canonicalTimingMutationCount: 0,
  };
  const compatibleItems = c60114ReviewItemsV4Schema.parse(
    hashed141({
      ...input.baselineItems,
      previousItemsHash: input.baselineItems.semanticHash,
      targetsHash: compatibleTargets.semanticHash,
      missingEvidenceHash: missing.semanticHash,
      items: [...input.baselineItems.items, ...newItems],
      summary: itemSummary,
    }),
  );
  const onlyNewTargets = c60114ReviewTargetsSchema.parse(
    hashed141({
      ...compatibleTargets,
      targets: additions,
      unresolvedItems: [],
      summary: {
        targetCount: additions.length,
        itemCount: newItems.length,
        unresolvedItemCount: 0,
        disjointItemCount: newItems.filter((i) => i.sourceIntervals.length > 1)
          .length,
        coreFallbackCount: 0,
      },
    }),
  );
  const onlyNewItems = c60114ReviewItemsV4Schema.parse(
    hashed141({
      ...compatibleItems,
      targetsHash: onlyNewTargets.semanticHash,
      items: newItems,
      summary: {
        ...itemSummary,
        previousItemCount: 0,
        itemCount: newItems.length,
        migratedItemCount: 0,
        requiredItemCount: 0,
      },
    }),
  );
  const extra = clusterC60114ReviewRegions({
    targets: onlyNewTargets,
    items: onlyNewItems,
    sourceIdentity: source,
    policy: input.compatibilityPolicy,
    evidenceFamilies: families,
    frozenR3Policy: r3,
  });
  const regions = [
    ...input.baselineRegions.regions,
    ...extra.regions.map((r, i) =>
      hashed141({
        ...r,
        priorityMetadata: {
          ...r.priorityMetadata,
          rankPosition: input.baselineRegions.regions.length + i + 1,
        },
      }),
    ),
  ];
  const compatibleRegions = c60114ReviewRegionsV3Schema.parse(
    hashed141({
      ...input.baselineRegions,
      targetsHash: compatibleTargets.semanticHash,
      itemsHash: compatibleItems.semanticHash,
      regions,
      summary: {
        ...input.baselineRegions.summary,
        regionCount: regions.length,
        targetCount: compatibleTargets.targets.length,
        mappedTargetCount: compatibleTargets.targets.length,
        targetCoverageRatio: 1,
      },
    }),
  );
  const header = header142(policy, source);
  const targets = reviewTargets142Schema.parse(
    hashed141({
      ...header,
      artifactType: "machine-review-target-intervals-v4",
      baselineTargetsHash: input.baselineTargets.semanticHash,
      compatibilityTargetsHash: compatibleTargets.semanticHash,
      inventoryHash: inventory.semanticHash,
      safetyHash: safety.semanticHash,
      supersessionHash: input.supersessionHash,
      activeSafetyClusterCount: safety.targets.length,
      envelopeAsSpeechCount: 0,
      unresolvedItems: compatibleTargets.unresolvedItems,
      targets: compatibleTargets.targets.map((target) => {
        const cluster = targetCluster(target.reviewTargetId),
          obs = inventory.observations.filter((o) =>
            cluster?.observationIds.includes(o.observationId),
          );
        return hashed141({
          ...target,
          nativeInterval: {
            startSample: Math.round(target.sourceInterval.start * rate),
            endSample: Math.round(target.sourceInterval.end * rate),
          },
          targetSource: cluster
            ? "MISSING_SAFETY_RESERVE"
            : "PRESERVED_BASELINE",
          inventoryIntervalIds: cluster?.parentIslandIds ?? [],
          detectorRunIds: unique142(
            obs
              .filter((o) =>
                ["SILERO", "PYANNOTE", "WEBRTC"].includes(o.family),
              )
              .flatMap((o) => o.requestIds),
          ),
          fingerprintEntryIds: unique142(
            obs
              .filter((o) => o.family === "LEGACY_FINGERPRINT")
              .flatMap((o) => o.evidenceIds),
          ),
          asrProbeIds:
            lexical.targets.find((t) => t.targetId === cluster?.targetId)
              ?.requestIds ?? [],
          suggestedReviewLevel:
            input.baselineItems.items.find(
              (i) => i.reviewItemId === target.parentReviewItemId,
            )?.requiredLevel ?? "RECOMMENDED",
          baselineSemanticHash: cluster ? null : target.semanticHash,
          safetyClusterId: cluster?.clusterId ?? null,
          safetyClusterTargetId: cluster?.targetId ?? null,
          atomicMemberCandidateIds: cluster?.memberCandidateIds ?? [],
          evidenceStrata: cluster?.evidenceStrata ?? [],
          detectorFamilies: cluster?.detectorFamilies ?? [],
        });
      }),
      summary: {
        preservedBaselineTargetCount: input.baselineTargets.targets.length,
        newTargetCount: additions.length,
        targetCount: compatibleTargets.targets.length,
        newTargetUnionSeconds: safety.summary.targetUnionSeconds,
        allAudioRequired: compatibleTargets.targets.every(
          (t) => t.audioRequired,
        ),
        previousTargetsDeleted: 0,
        canonicalMutationCount: 0,
      },
    }),
  );
  const items = reviewItems142Schema.parse(
    hashed141({
      ...header,
      artifactType: "machine-review-items-v6",
      baselineItemsHash: input.baselineItems.semanticHash,
      compatibilityItemsHash: compatibleItems.semanticHash,
      targetsHash: targets.semanticHash,
      missingEvidenceHash: missing.semanticHash,
      items: compatibleItems.items.map((item) => {
        const cluster = safety.targets.find(
          (c) => itemId(c.targetId) === item.reviewItemId,
        );
        return hashed141({
          ...item,
          itemTypes: cluster
            ? [...item.itemTypes, "MISSING_SAFETY_RESERVE"]
            : item.itemTypes,
          reviewLayer: cluster
            ? "MISSING_SAFETY_RESERVE"
            : "PRESERVED_BASELINE",
          inventoryTargetIds: cluster ? [cluster.targetId] : [],
          baselineSemanticHash: cluster ? null : item.semanticHash,
          safetyClusterIds: cluster ? [cluster.clusterId] : [],
          targetCoreUnion:
            cluster?.targetCoreUnion ??
            union141(
              item.sourceIntervals.map((v) => ({
                startSample: Math.round(v.start * rate),
                endSample: Math.round(v.end * rate),
              })),
            ),
          evidenceStrata: cluster?.evidenceStrata ?? [],
        });
      }),
      summary: compatibleItems.summary,
      rankerRetrained: false,
      newOofRun: false,
      mandatoryOrderChanged: false,
    }),
  );
  const v5Regions = reviewRegions142Schema.parse(
    hashed141({
      ...header,
      artifactType: "machine-review-regions-v5",
      targetsHash: targets.semanticHash,
      itemsHash: items.semanticHash,
      compatibilityRegionsHash: compatibleRegions.semanticHash,
      regions: compatibleRegions.regions.map((region) => {
        const old = input.baselineRegions.regions.find(
          (r) => r.regionId === region.regionId,
        );
        const selected = targets.targets.filter((t) =>
          region.reviewTargetIds.includes(t.reviewTargetId),
        );
        return hashed141({
          ...region,
          reviewLayer: old ? "PRESERVED_BASELINE" : "MISSING_SAFETY_RESERVE",
          nativeSourceIntervals: selected.map((t) => t.nativeInterval),
          baselineSemanticHash: old?.semanticHash ?? null,
          safetyClusterIds: unique142(
            selected.flatMap((t) =>
              t.safetyClusterId ? [t.safetyClusterId] : [],
            ),
          ),
        });
      }),
      summary: compatibleRegions.summary,
      orderingPolicy:
        "PRESERVE_BASELINE_R3_ORDER_APPEND_FROZEN_R3_SAFETY_LAYER",
      rankerRetrained: false,
      newOofRun: false,
    }),
  );
  return {
    compatibleTargets,
    compatibleItems,
    compatibleRegions,
    targets,
    items,
    regions: v5Regions,
    families,
  };
}
