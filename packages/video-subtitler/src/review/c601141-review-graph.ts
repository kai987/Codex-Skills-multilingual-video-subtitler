import {
  c60114ReviewTargetSchema,
  c60114ReviewTargetsSchema,
  c60114ReviewItemsV4Schema,
  c60114ReviewItemV4Schema,
  c60114ReviewRegionsV3Schema,
  c601141ReviewTargetsSchema,
  c601141ReviewItemsSchema,
  c601141ReviewRegionsSchema,
  type C60114ReviewTargets,
  type C60114ReviewItemsV4,
  type C60114ReviewRegionsV3,
  type C60114Policy,
  type C601141Policy,
  type C601141Inventory,
  type C601141Safety,
  type C601141Lexical,
  type C601141MissingEvidence,
  type C601141ReviewItem,
  type C60113EvidenceFamilyGraph,
} from "@mvl/shared";
import {
  hashed141,
  hash141,
  header141,
  id141,
  unique141,
  assertHash141,
  required141,
} from "./c601141-policy.js";
import { c60114Intersection } from "./c60114-policy.js";
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

export function sourceSamples141(
  interval: { start: number; end: number },
  rate: number,
) {
  return {
    startSample: Math.round(interval.start * rate),
    endSample: Math.round(interval.end * rate),
  };
}
export function buildReviewGraph141(input: {
  policy: C601141Policy;
  compatibilityPolicy: C60114Policy;
  inventory: C601141Inventory;
  safety: C601141Safety;
  lexical: C601141Lexical;
  missing: C601141MissingEvidence;
  baselineTargets: C60114ReviewTargets;
  baselineItems: C60114ReviewItemsV4;
  baselineRegions: C60114ReviewRegionsV3;
  frozenR3Families: C60113EvidenceFamilyGraph;
}) {
  const { policy, inventory, safety, lexical, missing } = input;
  [
    inventory,
    safety,
    lexical,
    missing,
    input.baselineTargets,
    input.baselineItems,
    input.baselineRegions,
  ].forEach(assertHash141);
  const source = safety.sourceIdentity,
    rate = source.sampleRate;
  if (
    hash141(source) !== hash141(input.baselineTargets.sourceIdentity) ||
    input.baselineRegions.targetsHash !== input.baselineTargets.semanticHash
  )
    throw new Error("C601141_BASELINE_REVIEW_BINDING_MISMATCH");
  const itemId = (targetId: string) =>
    id141("inventory-review-item", { source, targetId });
  const additions = safety.targets.map((target) =>
    c60114ReviewTargetSchema.parse(
      hashed141({
        reviewTargetId: target.targetId,
        parentReviewItemId: itemId(target.targetId),
        targetType: "ORPHAN_SPEECH_TARGET",
        sourceInterval: target.sourceInterval,
        targetAnchorIds: [target.targetId, target.parentIslandId],
        finalCueIds: [],
        eventIds: [target.candidateId],
        evidenceIds: target.evidenceIds,
        mandatoryForAudio: false,
        audioRequired: true,
        localizationStatus: "VERIFIED",
        sourceIdentity: source,
        reasons: [
          "C601141_NATIVE_SAMPLE_SPEECH_INVENTORY",
          target.evidenceClass,
          "HUMAN_ONLY_NO_CANONICAL_INSERT",
        ],
      }),
    ),
  );
  const compatibleTargets = c60114ReviewTargetsSchema.parse(
    hashed141({
      ...input.baselineTargets,
      targets: [...input.baselineTargets.targets, ...additions],
      summary: {
        ...input.baselineTargets.summary,
        targetCount: input.baselineTargets.targets.length + additions.length,
        itemCount: input.baselineItems.items.length + additions.length,
      },
    }),
  );
  const r3Policy = buildC60113ReviewPolicy();
  const observations = safety.targets.flatMap((target) =>
    inventory.observations
      .filter((v) => target.observationIds.includes(v.observationId))
      .flatMap((observation) => {
        const interval = c60114Intersection(target.sourceInterval, {
          start: observation.nativeInterval.startSample / rate,
          end: observation.nativeInterval.endSample / rate,
        });
        if (!interval || !observation.verifiedTimebase) return [];
        return [
          c60113Observation({
            evidenceId: id141("inventory-r3-evidence", {
              target: target.targetId,
              observation: observation.observationId,
            }),
            rootLineageIds: [observation.correlationGroup],
            family:
              observation.family === "PYANNOTE"
                ? "SPEAKER_ACTIVITY"
                : "SPEECH_ACTIVITY",
            provider: observation.family,
            correlationGroup: observation.correlationGroup,
            itemIds: [itemId(target.targetId)],
            gapIds: [target.targetId],
            sourceInterval: interval,
            positiveRisk:
              observation.speechPositive && !observation.strongContradiction,
            evidenceAbsence:
              !observation.speechPositive && !observation.strongContradiction,
            contradiction: observation.strongContradiction,
            strength:
              observation.speechPositive || observation.strongContradiction
                ? 1
                : 0,
            validatedSourceGlobal: true,
            detailCode: "NATIVE_SAMPLE_SPEECH_PRESENT_NOT_LEXICAL_CORRECTNESS",
          }),
        ];
      }),
  );
  const families = buildC60113EvidenceFamilyGraph({
    observations: [...input.frozenR3Families.evidence, ...observations],
    policy: r3Policy,
  });
  const newItems = additions.map((target, index) => {
    const safetyTarget = required141(safety.targets[index]);
    const base = required141(
      buildC60112ReviewItems({
        policy: buildC60112ReviewPolicy({
          policyFrozenAt: "1970-01-01T00:00:00.000Z",
        }),
        signals: [
          {
            reviewGroupId: target.parentReviewItemId,
            eventIds: target.eventIds,
            finalCueIds: [],
            itemTypes: ["MISSING_SPEECH_RISK"],
            sourceInterval: target.sourceInterval,
            coreInterval: target.sourceInterval,
            currentText: null,
            candidateIds: [],
            evidenceIds: target.evidenceIds,
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
            sceneIds: [],
            speakerGroupIds: [],
          },
        ],
      }).items[0],
    );
    const identified = hashed141({
      ...base,
      reviewItemId: target.parentReviewItemId,
    });
    const missingEvidence = buildC60113MissingSpeechEvidence({
      gaps: [
        {
          gapId: target.reviewTargetId,
          sourceInterval: target.sourceInterval,
          itemIds: [target.parentReviewItemId],
          legacySignal: false,
          validatedSourceGlobal: true,
          cueCoveredRatio: 0,
        },
      ],
      evidenceFamilies: families,
      legacyMissingItemCount: 0,
      policy: r3Policy,
    });
    const scored = required141(
      buildC60113ReviewItems({
        items: [identified],
        evidenceFamilies: families,
        missingEvidence,
        candidateBundles: [],
        policy: r3Policy,
      }).items[0],
    );
    return c60114ReviewItemV4Schema.parse(
      hashed141({
        ...scored,
        reviewTargetIds: [target.reviewTargetId],
        sourceIntervals: [target.sourceInterval],
        itemTypes: [...scored.itemTypes, "ORPHAN_SPEECH_REVIEW"],
        requiredLevel: "RECOMMENDED",
        mandatoryReasons: [],
        rankPosition: input.baselineItems.items.length + index + 1,
        origin: "ORPHAN_SPEECH",
        speechIslandIds: [safetyTarget.parentIslandId],
        orphanIds: [],
        missingClassificationV3:
          missing.targets.find((v) => v.targetId === target.reviewTargetId)
            ?.missingEvidenceClass ?? null,
        legacyItemIds: [],
        canonicalMutationAllowed: false,
        uncertaintyReasons: unique141([
          ...scored.uncertaintyReasons,
          "C601141_SAFETY_LAYER_NOT_MANDATORY_RECALIBRATION",
          "FROZEN_R3_WEIGHTS_NO_NEW_OOF",
          "SPEECH_PRESENCE_NOT_TRANSCRIPT_TRUTH",
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
      input.baselineItems.items.filter((v) => v.finalCueIds.length === 0)
        .length + newItems.length,
    requiredItemCount: input.baselineItems.items.filter(
      (v) => v.requiredLevel === "REQUIRED",
    ).length,
    previousItemsDeleted: 0 as const,
    canonicalTextMutationCount: 0 as const,
    canonicalTimingMutationCount: 0 as const,
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
  // Run the unchanged ranker only for new subjects. Preserve every original
  // region/rank and every REQUIRED order; append the fixed safety layer.
  const onlyNewTargets = c60114ReviewTargetsSchema.parse(
    hashed141({
      ...compatibleTargets,
      targets: additions,
      unresolvedItems: [],
      summary: {
        targetCount: additions.length,
        itemCount: newItems.length,
        unresolvedItemCount: 0,
        disjointItemCount: 0,
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
  const extraRegions = clusterC60114ReviewRegions({
    targets: onlyNewTargets,
    items: onlyNewItems,
    sourceIdentity: source,
    policy: input.compatibilityPolicy,
    evidenceFamilies: families,
    frozenR3Policy: r3Policy,
  });
  const regions = [
    ...input.baselineRegions.regions,
    ...extraRegions.regions.map((region, index) =>
      hashed141({
        ...region,
        priorityMetadata: {
          ...region.priorityMetadata,
          rankPosition: input.baselineRegions.regions.length + index + 1,
        },
      }),
    ),
  ];
  const summary = {
    ...input.baselineRegions.summary,
    regionCount: regions.length,
    targetCount: compatibleTargets.targets.length,
    mappedTargetCount: compatibleTargets.targets.length,
    targetCoverageRatio: 1,
  };
  const compatibleRegions = c60114ReviewRegionsV3Schema.parse(
    hashed141({
      ...input.baselineRegions,
      targetsHash: compatibleTargets.semanticHash,
      itemsHash: compatibleItems.semanticHash,
      regions,
      summary,
    }),
  );
  const header = header141(policy, source);
  const targets = c601141ReviewTargetsSchema.parse(
    hashed141({
      ...header,
      artifactType: "machine-review-target-intervals-v3",
      baselineTargetsHash: input.baselineTargets.semanticHash,
      compatibilityTargetsHash: compatibleTargets.semanticHash,
      inventoryHash: inventory.semanticHash,
      safetyHash: safety.semanticHash,
      unresolvedItems: compatibleTargets.unresolvedItems,
      targets: compatibleTargets.targets.map((target) => {
        const selected = safety.targets.find(
          (v) => v.targetId === target.reviewTargetId,
        );
        const observationsForTarget = inventory.observations.filter((v) =>
          selected?.observationIds.includes(v.observationId),
        );
        return hashed141({
          ...target,
          nativeInterval:
            selected?.nativeInterval ??
            sourceSamples141(target.sourceInterval, rate),
          targetSource: !selected
            ? "PRESERVED_BASELINE"
            : selected.targetType === "SPEECH_INVENTORY_STRONG_UNCOVERED"
              ? "STRONG_SPEECH_INVENTORY"
              : "MISSING_SAFETY_RESERVE",
          inventoryIntervalIds: selected ? [selected.parentIslandId] : [],
          detectorRunIds: unique141(
            observationsForTarget
              .filter((v) => v.family === "SILERO" || v.family === "PYANNOTE")
              .flatMap((v) => v.requestIds),
          ),
          fingerprintEntryIds: unique141(
            observationsForTarget
              .filter((v) => v.family === "LEGACY_FINGERPRINT")
              .flatMap((v) => v.evidenceIds),
          ),
          asrProbeIds:
            lexical.targets.find((v) => v.targetId === target.reviewTargetId)
              ?.requestIds ?? [],
          suggestedReviewLevel:
            input.baselineItems.items.find(
              (v) => v.reviewItemId === target.parentReviewItemId,
            )?.requiredLevel ?? "RECOMMENDED",
          baselineSemanticHash: selected ? null : target.semanticHash,
        });
      }),
      summary: {
        preservedBaselineTargetCount: input.baselineTargets.targets.length,
        newTargetCount: additions.length,
        targetCount: compatibleTargets.targets.length,
        newTargetUnionSeconds: safety.summary.targetUnionSeconds,
        allAudioRequired: compatibleTargets.targets.every(
          (v) => v.audioRequired,
        ),
        previousTargetsDeleted: 0,
        canonicalMutationCount: 0,
      },
    }),
  );
  const items = c601141ReviewItemsSchema.parse(
    hashed141({
      ...header,
      artifactType: "machine-review-items-v5",
      baselineItemsHash: input.baselineItems.semanticHash,
      compatibilityItemsHash: compatibleItems.semanticHash,
      targetsHash: targets.semanticHash,
      missingEvidenceHash: missing.semanticHash,
      items: compatibleItems.items.map((item) => {
        const target = targets.targets.find(
            (v) => v.parentReviewItemId === item.reviewItemId,
          ),
          selected = safety.targets.find(
            (v) => v.targetId === target?.reviewTargetId,
          );
        const row = lexical.targets.find(
          (v) => v.targetId === selected?.targetId,
        );
        const types: C601141ReviewItem["itemTypes"] = [...item.itemTypes];
        if (selected) {
          types.push("MISSING_SAFETY_RESERVE");
          if (selected.evidenceClass === "MULTI_DETECTOR_CONFIRMED")
            types.push("MULTI_DETECTOR_UNCOVERED_SPEECH");
          if (selected.evidenceClass === "LEGACY_FINGERPRINT_CONFIRMED")
            types.push("LEGACY_FINGERPRINT_RECOVERED_SPEECH");
          if (selected.evidenceClass === "DETECTOR_DISAGREEMENT")
            types.push("DETECTOR_DISAGREEMENT_REVIEW");
          if (row?.localizedTextCandidates.length)
            types.push("NEW_LOCAL_ASR_CANDIDATE");
          if (row?.evidenceClass === "CROSS_MODEL_DISAGREEMENT")
            types.push("NEW_LOCAL_ASR_DISAGREEMENT");
        }
        return hashed141({
          ...item,
          itemTypes: types,
          reviewLayer: target?.targetSource ?? "PRESERVED_BASELINE",
          inventoryTargetIds: selected ? [selected.targetId] : [],
          baselineSemanticHash: selected ? null : item.semanticHash,
        });
      }),
      summary: itemSummary,
      rankerRetrained: false,
      newOofRun: false,
      mandatoryOrderChanged: false,
    }),
  );
  const resultRegions = c601141ReviewRegionsSchema.parse(
    hashed141({
      ...header,
      artifactType: "machine-review-regions-v4",
      targetsHash: targets.semanticHash,
      itemsHash: items.semanticHash,
      compatibilityRegionsHash: compatibleRegions.semanticHash,
      regions: regions.map((region) => {
        const old = input.baselineRegions.regions.some(
          (v) => v.regionId === region.regionId,
        );
        const layers = targets.targets
          .filter((v) => region.reviewTargetIds.includes(v.reviewTargetId))
          .map((v) => v.targetSource);
        return hashed141({
          ...region,
          reviewLayer: old
            ? "PRESERVED_BASELINE"
            : layers.every((v) => v === "STRONG_SPEECH_INVENTORY")
              ? "STRONG_SPEECH_INVENTORY"
              : "MISSING_SAFETY_RESERVE",
          nativeSourceIntervals: region.sourceIntervals.map((v) =>
            sourceSamples141(v, rate),
          ),
          baselineSemanticHash: old ? region.semanticHash : null,
        });
      }),
      summary,
      orderingPolicy:
        "PRESERVE_BASELINE_R3_ORDER_APPEND_FROZEN_R3_SAFETY_LAYER",
      rankerRetrained: false,
      newOofRun: false,
    }),
  );
  if (
    hash141(
      compatibleTargets.targets.slice(0, input.baselineTargets.targets.length),
    ) !== hash141(input.baselineTargets.targets) ||
    hash141(
      compatibleItems.items.slice(0, input.baselineItems.items.length),
    ) !== hash141(input.baselineItems.items) ||
    hash141(
      compatibleRegions.regions.slice(0, input.baselineRegions.regions.length),
    ) !== hash141(input.baselineRegions.regions)
  )
    throw new Error("C601141_BASELINE_REVIEW_MUTATION");
  return {
    targets,
    items,
    regions: resultRegions,
    compatibleTargets,
    compatibleItems,
    compatibleRegions,
    families,
  };
}
