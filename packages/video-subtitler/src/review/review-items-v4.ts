import {
  c60113ReviewItemV3Schema,
  c60113ReviewItemsV3Schema,
  c60114ReviewItemsV4Schema,
  c60114ReviewTargetsSchema,
  c60114SpeechIslandsSchema,
  c60114OrphanSpeechSweepSchema,
  c60114MissingSpeechEvidenceV3Schema,
  reviewItemTypeSchema,
  type C60113EvidenceFamily,
  type C60113EvidenceFamilyGraph,
  type C60113ReviewPolicy,
  type C60113ReviewItemV3,
  type C60113ReviewItemsV3,
  type C60114ReviewItemsV4,
  type C60114ReviewTargets,
  type C60114SpeechIslands,
  type C60114OrphanSpeechSweep,
  type C60114MissingSpeechEvidenceV3,
  type C60114Policy,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { buildC60112ReviewPolicy } from "./c60112-policy.js";
import {
  assertC60113Policy,
  buildC60113ReviewPolicy,
} from "./c60113-policy.js";
import {
  assertC60114SourceIdentity,
  c60114ArtifactHeader,
  c60114Intersection,
  c60114Union,
  uniqueC60114,
} from "./c60114-policy.js";
import { buildC60112ReviewItems } from "./review-item-builder.js";
import { buildC60113ReviewItems } from "./structured-review-priority.js";
import { buildC60113MissingSpeechEvidence } from "./missing-speech-evidence-v2.js";
import {
  buildC60113EvidenceFamilyGraph,
  c60113Observation,
} from "./review-evidence-family-graph.js";

type Item = C60114ReviewItemsV4["items"][number];
const zeroCueActions = [
  "ADD_NEW_CUE",
  "MARK_FALSE_POSITIVE",
  "UNRESOLVED",
  "WAIVE_REVIEW",
] as const;
function rehash<T extends object>(value: T): T & { semanticHash: string } {
  const core = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "semanticHash"),
  );
  return { ...value, semanticHash: machineQualitySemanticHash(core) };
}
function requireRow<T>(row: T | undefined): T {
  if (row === undefined)
    throw new Error("C60114_REVIEW_ITEM_SOURCE_ROW_MISSING");
  return row;
}
function assertHash(value: { semanticHash: string }, label: string): void {
  const { semanticHash, ...core } = value;
  if (machineQualitySemanticHash(core) !== semanticHash)
    throw new Error(`C60114_REVIEW_ITEM_ARTIFACT_HASH_MISMATCH:${label}`);
}

/** Explicit R3 family adaptation; source strengths/roots are copied, not estimated. */
export function buildC60114R3EvidenceProjection(input: {
  previousEvidenceFamilies?: C60113EvidenceFamilyGraph;
  targets: C60114ReviewTargets;
  speechIslands: C60114SpeechIslands;
  frozenR3Policy?: C60113ReviewPolicy;
}): C60113EvidenceFamilyGraph {
  const policy = input.frozenR3Policy ?? buildC60113ReviewPolicy();
  assertC60113Policy(policy);
  assertC60114SourceIdentity(
    input.targets.sourceIdentity,
    input.speechIslands.sourceIdentity,
  );
  if (
    input.previousEvidenceFamilies &&
    input.previousEvidenceFamilies.policyHash !== policy.semanticHash
  )
    throw new Error("C60114_FROZEN_R3_EVIDENCE_POLICY_MISMATCH");
  const sourceHash = machineQualitySemanticHash(
    input.speechIslands.sourceIdentity,
  );
  const familyMap: Record<
    C60114SpeechIslands["audit"]["evidence"][number]["family"],
    C60113EvidenceFamily
  > = {
    MAPPED_VAD: "SPEECH_ACTIVITY",
    DECODED_SEGMENT: "SPEECH_ACTIVITY",
    TRUSTED_MAPPED_TOKEN: "LOCALIZATION",
    RAW_ASR_SEGMENT: "LOCALIZATION",
    SPEAKER_ACTIVITY: "SPEAKER_ACTIVITY",
    ACOUSTIC_SCENE: "SPEECH_ACTIVITY",
    CANDIDATE_PROVENANCE: "LOCALIZATION",
    SILENCE: "MUSIC_LYRICS_CONTRADICTION",
  };
  const projected = input.speechIslands.audit.evidence.flatMap((source) => {
    const targets = input.targets.targets.filter(
      (target) =>
        target.evidenceIds.includes(source.evidenceId) &&
        source.sourceInterval &&
        c60114Intersection(target.sourceInterval, source.sourceInterval) !==
          null,
    );
    if (
      !targets.length ||
      source.mappingStatus !== "VERIFIED" ||
      source.sourceIdentityHash !== sourceHash ||
      source.sourceInterval === null
    )
      return [];
    const active = source.speechPositive || source.reliableLocalizedLexical;
    return [
      c60113Observation({
        evidenceId: `c60114-r3-${source.evidenceId}`,
        rootLineageIds: source.rootLineageIds,
        family: source.reliableLocalizedLexical
          ? "ASR_LEXICAL_CONTENT"
          : familyMap[source.family],
        provider: source.providerFamily,
        correlationGroup: source.correlationGroup,
        itemIds: uniqueC60114(
          targets.map((target) => target.parentReviewItemId),
        ),
        gapIds: uniqueC60114(targets.map((target) => target.reviewTargetId)),
        sourceInterval: source.sourceInterval,
        positiveRisk: active && !source.contradiction,
        evidenceAbsence: !active && !source.contradiction,
        contradiction: source.contradiction,
        strength: source.strength,
        validatedSourceGlobal: true,
        detailCode: `C60114_SOURCE_${source.family}_EXACT_R3_FAMILY_PROJECTION`,
      }),
    ];
  });
  return buildC60113EvidenceFamilyGraph({
    observations: [
      ...(input.previousEvidenceFamilies?.evidence ?? []),
      ...projected,
    ],
    policy,
  });
}

/** Remove only V4 metadata for the unchanged R3 implementation; never mutate CURRENT. */
export function c60114LegacyPriorityProjection(item: Item): C60113ReviewItemV3 {
  const legacy = Object.fromEntries(
    (
      Object.keys(
        c60113ReviewItemV3Schema.shape,
      ) as (keyof C60113ReviewItemV3)[]
    ).map((key) => [key, item[key]]),
  );
  return c60113ReviewItemV3Schema.parse({
    ...legacy,
    itemTypes: item.itemTypes.filter(
      (type) => reviewItemTypeSchema.safeParse(type).success,
    ),
  });
}

export function buildC60114ReviewItems(input: {
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  previousItems: C60113ReviewItemsV3;
  targets: C60114ReviewTargets;
  speechIslands: C60114SpeechIslands;
  orphanSweep: C60114OrphanSpeechSweep;
  missingEvidenceV3: C60114MissingSpeechEvidenceV3;
}): C60114ReviewItemsV4 {
  const header = c60114ArtifactHeader(input.policy, input.sourceIdentity);
  c60113ReviewItemsV3Schema.parse(input.previousItems);
  c60114ReviewTargetsSchema.parse(input.targets);
  c60114SpeechIslandsSchema.parse(input.speechIslands);
  c60114OrphanSpeechSweepSchema.parse(input.orphanSweep);
  c60114MissingSpeechEvidenceV3Schema.parse(input.missingEvidenceV3);
  for (const artifact of [
    input.targets,
    input.speechIslands,
    input.orphanSweep,
  ]) {
    assertC60114SourceIdentity(artifact.sourceIdentity, input.sourceIdentity);
    if (artifact.policyHash !== input.policy.semanticHash)
      throw new Error("C60114_REVIEW_ITEM_POLICY_MISMATCH");
    assertHash(artifact, artifact.artifactType);
  }
  assertHash(input.previousItems, "previousItems");
  assertHash(input.missingEvidenceV3, "missingEvidenceV3");
  if (
    input.missingEvidenceV3.sourceIdentityHash !==
      machineQualitySemanticHash(input.sourceIdentity) ||
    input.missingEvidenceV3.policyHash !== input.policy.semanticHash
  )
    throw new Error("C60114_MISSING_EVIDENCE_SOURCE_OR_POLICY_MISMATCH");
  const previousIds = new Set(
    input.previousItems.items.map((item) => item.reviewItemId),
  );
  if (previousIds.size !== input.previousItems.items.length)
    throw new Error("C60114_DUPLICATE_PREVIOUS_ITEM_ID");
  const islands = [
    ...new Map(
      [
        ...input.speechIslands.islands,
        ...input.speechIslands.globalIslands,
      ].map((island) => [island.islandId, island]),
    ).values(),
  ];
  const bindings = (itemId: string) => {
    const targets = input.targets.targets.filter(
      (target) => target.parentReviewItemId === itemId,
    );
    const anchors = new Set(
      targets.flatMap((target) => target.targetAnchorIds),
    );
    const itemIslands = islands.filter((island) =>
      anchors.has(island.islandId),
    );
    const orphans = input.orphanSweep.entries.filter((orphan) =>
      anchors.has(orphan.orphanId),
    );
    const classifications = input.missingEvidenceV3.targets.filter((row) =>
      anchors.has(row.targetId),
    );
    return { targets, itemIslands, orphans, classifications };
  };
  // This order only selects which classification to display. It never sets a score.
  const classificationOrder = [
    "MISSING_DIALOGUE_CROSS_MODEL_STRONG",
    "MISSING_DIALOGUE_ASR_DISAGREEMENT",
    "MISSING_DIALOGUE_ASR_EMPTY",
    "MISSING_DIALOGUE_SINGLE_MODEL_STABLE",
    "MISSING_DIALOGUE_LEXICAL_POSSIBLE",
    "MACHINE_DETECTION_ORPHAN",
    "LOCALIZATION_UNRESOLVED",
    "SPEECH_ISLAND_OBSERVED",
    "NON_SPEECH_CONTRADICTED",
  ];
  const classify = (rows: C60114MissingSpeechEvidenceV3["targets"]) =>
    [...rows].sort(
      (a, b) =>
        classificationOrder.indexOf(a.classification) -
          classificationOrder.indexOf(b.classification) ||
        a.targetId.localeCompare(b.targetId),
    )[0]?.classification ?? null;
  const legacy: Item[] = input.previousItems.items.map((item) => {
    const bound = bindings(item.reviewItemId);
    return rehash({
      ...item,
      reviewTargetIds: uniqueC60114(
        bound.targets.map((target) => target.reviewTargetId),
      ),
      sourceIntervals: c60114Union(
        bound.targets.map((target) => target.sourceInterval),
      ),
      origin: "MIGRATED_C60113" as const,
      speechIslandIds: uniqueC60114(
        bound.itemIslands.map((island) => island.islandId),
      ),
      orphanIds: uniqueC60114(bound.orphans.map((orphan) => orphan.orphanId)),
      missingClassificationV3: classify(bound.classifications),
      legacyItemIds: [item.reviewItemId],
      canonicalMutationAllowed: false as const,
    });
  });
  const newIds = uniqueC60114(
    input.targets.targets.map((target) => target.parentReviewItemId),
  ).filter((id) => !previousIds.has(id));
  const r3Policy = buildC60113ReviewPolicy();
  if (input.previousItems.policyHash !== r3Policy.semanticHash)
    throw new Error("C60114_PREVIOUS_ITEMS_FROZEN_R3_POLICY_MISMATCH");
  const evidenceFamilies = buildC60114R3EvidenceProjection({
    targets: input.targets,
    speechIslands: input.speechIslands,
    frozenR3Policy: r3Policy,
  });
  const additions = newIds.map((itemId): Item => {
    const bound = bindings(itemId);
    const first = requireRow(bound.targets[0]);
    if (
      bound.targets.some(
        (target) =>
          target.finalCueIds.length > 0 ||
          !["MISSING_SPEECH_ISLAND_TARGET", "ORPHAN_SPEECH_TARGET"].includes(
            target.targetType,
          ),
      )
    )
      throw new Error(
        `C60114_UNKNOWN_ITEM_CANNOT_INVENT_CURRENT_CUE:${itemId}`,
      );
    const sourceIntervals = c60114Union(
      bound.targets.map((target) => target.sourceInterval),
    );
    // A new item is one actual localized subject, not a multi-island search envelope.
    if (sourceIntervals.length !== 1)
      throw new Error(`C60114_NEW_ITEM_HAS_DISJOINT_SUBJECTS:${itemId}`);
    const sourceInterval = requireRow(sourceIntervals[0]);
    const classification = classify(bound.classifications);
    const base = requireRow(
      buildC60112ReviewItems({
        policy: buildC60112ReviewPolicy({
          policyFrozenAt: "1970-01-01T00:00:00.000Z",
        }),
        signals: [
          {
            reviewGroupId: itemId,
            eventIds: uniqueC60114(
              bound.targets.flatMap((target) => target.eventIds),
            ),
            finalCueIds: [],
            itemTypes: ["MISSING_SPEECH_RISK"],
            sourceInterval,
            coreInterval: sourceInterval,
            currentText: null,
            candidateIds: [],
            evidenceIds: uniqueC60114(
              bound.targets.flatMap((target) => target.evidenceIds),
            ),
            reviewReasons: [
              "MISSING_DIALOGUE_SUSPECTED",
              "MACHINE_EVIDENCE_INCOMPLETE",
            ],
            suggestedActions: zeroCueActions,
            sceneIds: uniqueC60114(
              bound.itemIslands.flatMap((island) => island.sceneIds),
            ),
            speakerGroupIds: uniqueC60114(
              bound.itemIslands.flatMap((island) => island.speakerIds),
            ),
          },
        ],
      }).items[0],
    );
    const identified = rehash({ ...base, reviewItemId: itemId });
    const missingEvidence = buildC60113MissingSpeechEvidence({
      gaps: bound.targets.map((target) => ({
        gapId: target.reviewTargetId,
        sourceInterval: target.sourceInterval,
        itemIds: [itemId],
        legacySignal: false,
        validatedSourceGlobal: target.localizationStatus === "VERIFIED",
        cueCoveredRatio:
          bound.classifications.find((row) =>
            target.targetAnchorIds.includes(row.targetId),
          )?.cueCoveredRatio ??
          bound.orphans[0]?.cueCoveredRatio ??
          1,
      })),
      evidenceFamilies,
      legacyMissingItemCount: 0,
      policy: r3Policy,
    });
    const scored = requireRow(
      buildC60113ReviewItems({
        items: [identified],
        evidenceFamilies,
        missingEvidence,
        candidateBundles: [],
        policy: r3Policy,
      }).items[0],
    );
    const orphan =
      bound.orphans.length > 0 || first.targetType === "ORPHAN_SPEECH_TARGET";
    const itemTypes: Item["itemTypes"] = [
      ...scored.itemTypes,
      orphan ? "ORPHAN_SPEECH_REVIEW" : "MISSING_SPEECH_ISLAND_REVIEW",
    ];
    if (classification === "MISSING_DIALOGUE_ASR_DISAGREEMENT")
      itemTypes.push("MISSING_LOCAL_ASR_DISAGREEMENT");
    if (classification === "MISSING_DIALOGUE_ASR_EMPTY")
      itemTypes.push("MISSING_LOCAL_ASR_EMPTY");
    return rehash({
      ...scored,
      itemTypes,
      requiredLevel: "REQUIRED" as const,
      mandatoryReasons: uniqueC60114([
        ...scored.mandatoryReasons,
        ...bound.targets.map(
          (target) =>
            `C60114_ATOMIC_AUDIO_REVIEW_REQUIRED:${target.reviewTargetId}`,
        ),
      ]),
      suggestedActions: [...zeroCueActions],
      currentText: null,
      finalCueIds: [],
      candidateIds: [],
      reviewTargetIds: uniqueC60114(
        bound.targets.map((target) => target.reviewTargetId),
      ),
      sourceIntervals,
      origin: orphan ? ("ORPHAN_SPEECH" as const) : ("SPEECH_ISLAND" as const),
      speechIslandIds: uniqueC60114([
        ...bound.itemIslands.map((island) => island.islandId),
        ...bound.orphans.map((entry) => entry.sourceIslandId),
      ]),
      orphanIds: uniqueC60114(bound.orphans.map((entry) => entry.orphanId)),
      missingClassificationV3: classification,
      legacyItemIds: [],
      canonicalMutationAllowed: false as const,
      uncertaintyReasons: uniqueC60114([
        ...scored.uncertaintyReasons,
        "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14",
        "EXISTING_R3_RULES_NO_NEW_WEIGHTS",
        "ATOMIC_AUDIO_REVIEW_REQUIRED_NOT_STRONG_MISSING_ASSERTION",
        "ZERO_CUE_HUMAN_ACTIONS_ONLY",
      ]),
    });
  });
  const items = [
    ...legacy,
    ...additions.map((item, index) =>
      rehash({
        ...item,
        rankPosition: input.previousItems.items.length + index + 1,
      }),
    ),
  ];
  return c60114ReviewItemsV4Schema.parse(
    rehash({
      ...header,
      artifactType: "machine-review-items-v4",
      previousItemsHash: input.previousItems.semanticHash,
      targetsHash: input.targets.semanticHash,
      missingEvidenceHash: input.missingEvidenceV3.semanticHash,
      items,
      summary: {
        previousItemCount: input.previousItems.items.length,
        itemCount: items.length,
        migratedItemCount: legacy.length,
        createdItemCount: additions.length,
        orphanItemCount: additions.filter(
          (item) => item.origin === "ORPHAN_SPEECH",
        ).length,
        requiredItemCount: items.filter(
          (item) => item.requiredLevel === "REQUIRED",
        ).length,
        previousItemsDeleted: 0,
        canonicalTextMutationCount: 0,
        canonicalTimingMutationCount: 0,
      },
    }),
  );
}
