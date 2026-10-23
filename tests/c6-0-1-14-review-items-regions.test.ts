import { describe, expect, it } from "vitest";
import {
  c60114MissingSpeechEvidenceV3Schema,
  c60114ReviewItemsV4Schema,
  type C60114SourceIdentity,
  type C60114SourceEvidence,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { buildC60112ReviewPolicy } from "../packages/video-subtitler/src/review/c60112-policy.js";
import { buildC60113ReviewPolicy } from "../packages/video-subtitler/src/review/c60113-policy.js";
import { buildC60114Policy } from "../packages/video-subtitler/src/review/c60114-policy.js";
import { buildC60112ReviewItems } from "../packages/video-subtitler/src/review/review-item-builder.js";
import { buildC60113ReviewItems } from "../packages/video-subtitler/src/review/structured-review-priority.js";
import {
  buildC60113EvidenceFamilyGraph,
  c60113Observation,
} from "../packages/video-subtitler/src/review/review-evidence-family-graph.js";
import { buildC60113MissingSpeechEvidence } from "../packages/video-subtitler/src/review/missing-speech-evidence-v2.js";
import {
  buildC60114SourceGlobalSpeechIslands,
  createC60114SourceEvidence,
} from "../packages/video-subtitler/src/review/source-global-speech-islands.js";
import { buildC60114ReviewTargetIntervalsV2 } from "../packages/video-subtitler/src/review/review-target-intervals-v2.js";
import { buildC60114OrphanSpeechSweep } from "../packages/video-subtitler/src/review/orphan-speech-sweep.js";
import {
  buildC60114ReviewItems,
  buildC60114R3EvidenceProjection,
} from "../packages/video-subtitler/src/review/review-items-v4.js";
import { clusterC60114ReviewRegions } from "../packages/video-subtitler/src/review/review-region-clustering-v3.js";
import {
  C60113_MANDATORY_ORDER,
  c60113RegionInitialUtility,
} from "../packages/video-subtitler/src/review/region-review-priority.js";

function required<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("FIXTURE_ROW_MISSING");
  return row;
}
function sign<T extends object>(value: T): T & { semanticHash: string } {
  return {
    ...value,
    semanticHash: machineQualitySemanticHash(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "semanticHash"),
      ),
    ),
  };
}
const policy = buildC60114Policy();
const r3Policy = buildC60113ReviewPolicy();
const sourceIdentity: C60114SourceIdentity = {
  sourceMediaSha256: "a".repeat(64),
  durationSeconds: 100,
  sampleRate: 48000,
  audioStreamIndex: 1,
  audioTimebase: "1/48000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS",
};
function sourceEvidence(
  id: string,
  start: number,
  end: number,
  extra: Partial<Omit<C60114SourceEvidence, "semanticHash">> = {},
) {
  return createC60114SourceEvidence({
    evidenceId: id,
    family: "MAPPED_VAD",
    sourceInterval: { start, end },
    mappingStatus: "VERIFIED",
    speechPositive: true,
    lexicalPositive: false,
    reliableLocalizedLexical: false,
    contradiction: false,
    strength: 0.9,
    rootLineageIds: [`root-${id}`],
    correlationGroup: `group-${id}`,
    providerFamily: "vad",
    artifactId: "synthetic",
    artifactSemanticHash: "b".repeat(64),
    sourceIdentityHash: machineQualitySemanticHash(sourceIdentity),
    sceneIds: [],
    speakerIds: [],
    reasons: ["SYNTHETIC_DIRECT_ACOUSTIC_OBSERVATION"],
    ...extra,
  });
}

function fixture() {
  const base = buildC60112ReviewItems({
    policy: buildC60112ReviewPolicy({
      policyFrozenAt: "1970-01-01T00:00:00.000Z",
    }),
    signals: [
      {
        reviewGroupId: "current",
        eventIds: ["current-event"],
        finalCueIds: ["cue-1", "cue-2"],
        itemTypes: ["TEXT_HALLUCINATION_RISK"],
        sourceInterval: { start: 3, end: 29 },
        coreInterval: { start: 5, end: 7 },
        currentText: "保存するCURRENT字幕",
        candidateIds: ["candidate"],
        evidenceIds: ["hall"],
        reviewReasons: ["WHISPER_HALLUCINATION_SIGNAL"],
      },
      {
        reviewGroupId: "missing-parent",
        eventIds: ["missing-event"],
        finalCueIds: [],
        itemTypes: ["MISSING_SPEECH_RISK"],
        sourceInterval: { start: 0, end: 30 },
        currentText: null,
        candidateIds: [],
        evidenceIds: [],
        reviewReasons: ["MISSING_DIALOGUE_SUSPECTED"],
      },
      {
        reviewGroupId: "unresolved-parent",
        eventIds: ["unresolved-event"],
        finalCueIds: [],
        itemTypes: ["GENERAL_UNCERTAINTY"],
        sourceInterval: { start: 80, end: 95 },
        currentText: "未処理のCURRENT",
        candidateIds: [],
        evidenceIds: [],
        reviewReasons: ["MACHINE_EVIDENCE_INCOMPLETE"],
      },
    ],
  }).items;
  const current = required(
    base.find((item) => item.currentText === "保存するCURRENT字幕"),
  );
  const missingParent = required(
    base.find((item) => item.itemTypes.includes("MISSING_SPEECH_RISK")),
  );
  const previousEvidenceFamilies = buildC60113EvidenceFamilyGraph({
    policy: r3Policy,
    observations: [
      c60113Observation({
        evidenceId: "hall",
        rootLineageIds: ["hall-root"],
        family: "HALLUCINATION",
        provider: "whisper",
        correlationGroup: "hall-root",
        itemIds: [current.reviewItemId],
        gapIds: [],
        sourceInterval: { start: 5, end: 7 },
        positiveRisk: true,
        evidenceAbsence: false,
        contradiction: false,
        strength: 0.9,
        validatedSourceGlobal: true,
        detailCode: "SYNTHETIC_HALLUCINATION_RISK",
      }),
    ],
  });
  const missing = buildC60113MissingSpeechEvidence({
    gaps: [],
    evidenceFamilies: previousEvidenceFamilies,
    legacyMissingItemCount: 1,
    policy: r3Policy,
  });
  const previousItems = buildC60113ReviewItems({
    items: base,
    evidenceFamilies: previousEvidenceFamilies,
    missingEvidence: missing,
    candidateBundles: [],
    policy: r3Policy,
  });
  const speechIslands = buildC60114SourceGlobalSpeechIslands({
    sourceIdentity,
    policy,
    parentGaps: [
      {
        gapId: "gap-parent",
        sourceInterval: { start: 0, end: 30 },
        itemIds: [missingParent.reviewItemId],
        searchEnvelopeOnly: true,
      },
      {
        gapId: "gap-without-parent",
        sourceInterval: { start: 40, end: 50 },
        itemIds: [],
        searchEnvelopeOnly: true,
      },
    ],
    evidence: [
      sourceEvidence("speech-a", 10, 12),
      sourceEvidence("speech-b", 20, 22),
      sourceEvidence("speech-new", 45, 47),
      sourceEvidence("speech-orphan", 65, 67),
    ],
  });
  const finalCues = [
    { id: "cue-1", start: 5, end: 7 },
    { id: "cue-2", start: 25, end: 27 },
  ];
  const beforeOrphans = buildC60114ReviewTargetIntervalsV2({
    sourceIdentity,
    policy,
    items: base,
    finalCues,
    speechIslands,
  });
  const orphanSweep = buildC60114OrphanSpeechSweep({
    sourceIdentity,
    policy,
    speechIslands,
    finalCues,
    reviewTargets: beforeOrphans,
  });
  const targets = buildC60114ReviewTargetIntervalsV2({
    sourceIdentity,
    policy,
    items: base,
    finalCues,
    speechIslands,
    orphanSweep,
  });
  const allIslands = [
    ...new Map(
      [...speechIslands.islands, ...speechIslands.globalIslands].map(
        (island) => [island.islandId, island],
      ),
    ).values(),
  ];
  const missingEvidenceV3 = c60114MissingSpeechEvidenceV3Schema.parse(
    sign({
      schemaVersion: "1.0.0",
      policyVersion: "c6.0.1.14-missing-localization-playback-integrity-v1",
      artifactType: "missing-speech-evidence-v3",
      sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_SECONDS",
      runtimeGoldInputCount: 0,
      sourceIdentityHash: machineQualitySemanticHash(sourceIdentity),
      policyHash: policy.semanticHash,
      lexicalEvidenceHash: "e".repeat(64),
      targets: allIslands.map((island) => ({
        targetId: island.islandId,
        sourceInterval: island.sourceInterval,
        classification: "SPEECH_ISLAND_OBSERVED",
        validSourceIdentity: true,
        verifiedUncovered: false,
        cueCoveredRatio: 0,
        crossModelLocalizedAgreement: false,
        singleProviderStable: false,
        evidenceRequestIds: [],
        reasons: ["SYNTHETIC_ACTIVITY_ONLY"],
        requiresHumanReview: true,
        canonicalCoverageCredit: false,
        autoCueGenerationAllowed: false,
      })),
      parentGaps: speechIslands.parentGaps,
      migratedV2GapIds: [],
      deprecatedEnvelopeOnlyEvidenceCount: 2,
      parentGapNotUsedAsSpeechEvidenceCount: 2,
      canonicalMutationCount: 0,
    }),
  );
  return {
    sourceIdentity,
    policy,
    previousItems,
    previousEvidenceFamilies,
    targets,
    speechIslands,
    orphanSweep,
    missingEvidenceV3,
    current,
    missingParent,
  };
}

describe("C60114 review items preserve parents and isolate new cue actions", () => {
  it("retains every legacy CURRENT, candidate, cue, priority and source interval", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const result = buildC60114ReviewItems(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(c60114ReviewItemsV4Schema.safeParse(result).success).toBe(true);
    for (const item of input.previousItems.items) {
      const migrated = required(
        result.items.find((row) => row.reviewItemId === item.reviewItemId),
      );
      for (const key of [
        "currentText",
        "finalCueIds",
        "candidateIds",
        "coreInterval",
        "sourceInterval",
        "priorityScore",
        "priorityVector",
        "structuredRankKey",
        "rankPosition",
        "requiredLevel",
      ] as const)
        expect(migrated[key]).toEqual(item[key]);
      expect(migrated.origin).toBe("MIGRATED_C60113");
    }
    expect(result.summary.previousItemsDeleted).toBe(0);
    expect(result.summary.createdItemCount).toBe(2);
    expect(buildC60114ReviewItems(input).semanticHash).toBe(
      result.semanticHash,
    );
  });

  it("creates atomic zero-cue island/orphan items with only explicit human actions", () => {
    const input = fixture();
    const result = buildC60114ReviewItems(input);
    const additions = result.items.filter(
      (row) => row.origin !== "MIGRATED_C60113",
    );
    expect(additions.map((row) => row.origin).sort()).toEqual([
      "ORPHAN_SPEECH",
      "SPEECH_ISLAND",
    ]);
    for (const row of additions) {
      expect(row.currentText).toBeNull();
      expect(row.finalCueIds).toEqual([]);
      expect(row.candidateIds).toEqual([]);
      expect(row.suggestedActions).toEqual([
        "ADD_NEW_CUE",
        "MARK_FALSE_POSITIVE",
        "UNRESOLVED",
        "WAIVE_REVIEW",
      ]);
      expect(row.requiredLevel).toBe("REQUIRED");
      expect(row.priorityVector.mandatorySafetyClass).toBe("NONE");
      expect(row.uncertaintyReasons).toContain(
        "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14",
      );
      expect(row.sourceIntervals).toHaveLength(1);
      expect(row.coreInterval.end - row.coreInterval.start).toBe(2);
    }
  });

  it("keeps a wide parent as a container of disjoint targets without inventing speech", () => {
    const input = fixture();
    const result = buildC60114ReviewItems(input);
    const parent = required(
      result.items.find(
        (row) => row.reviewItemId === input.missingParent.reviewItemId,
      ),
    );
    expect(parent.sourceInterval).toEqual({ start: 0, end: 30 });
    expect(parent.sourceIntervals).toEqual([
      { start: 10, end: 12 },
      { start: 20, end: 22 },
    ]);
    const unresolved = required(
      result.items.find((row) => row.currentText === "未処理のCURRENT"),
    );
    expect(unresolved.sourceIntervals).toEqual([]);
    expect(unresolved.reviewTargetIds).toEqual([]);
  });

  it("rejects mismatched source identity and tampered frozen item hashes", () => {
    const input = fixture();
    expect(() =>
      buildC60114ReviewItems({
        ...input,
        sourceIdentity: {
          ...sourceIdentity,
          sourceMediaSha256: "f".repeat(64),
        },
      }),
    ).toThrow("SOURCE_IDENTITY_MISMATCH");
    required(input.previousItems.items[0]).currentText = "tampered";
    expect(() => buildC60114ReviewItems(input)).toThrow(
      "ARTIFACT_HASH_MISMATCH",
    );
  });

  it("cannot create an unknown current-cue item from an unbound target", () => {
    const input = fixture();
    const target = required(
      input.targets.targets.find((row) => row.finalCueIds.length > 0),
    );
    target.parentReviewItemId = "unknown-item";
    input.targets = sign({
      ...input.targets,
      targets: input.targets.targets.map((row) =>
        row.reviewTargetId === target.reviewTargetId ? sign(row) : row,
      ),
    });
    expect(() => buildC60114ReviewItems(input)).toThrow(
      "UNKNOWN_ITEM_CANNOT_INVENT_CURRENT_CUE",
    );
  });
});

describe("C60114 atomic regions use the unchanged frozen R3 implementation", () => {
  it("reports exact original utility/cost math and source graph identity", () => {
    const input = fixture();
    const items = buildC60114ReviewItems(input);
    const evidenceFamilies = buildC60114R3EvidenceProjection({
      previousEvidenceFamilies: input.previousEvidenceFamilies,
      targets: input.targets,
      speechIslands: input.speechIslands,
      frozenR3Policy: r3Policy,
    });
    const regions = clusterC60114ReviewRegions({
      ...input,
      items,
      evidenceFamilies,
      frozenR3Policy: r3Policy,
    });
    expect(regions.regions.length).toBe(6);
    for (const region of regions.regions) {
      const p = region.priorityMetadata;
      expect(p.r3PolicyHash).toBe(r3Policy.semanticHash);
      expect(p.r3EvidenceFamiliesHash).toBe(evidenceFamilies.semanticHash);
      expect(p.utility).toBe(
        c60113RegionInitialUtility({ ...p, policy: r3Policy }),
      );
      expect(p.reviewCostSeconds).toBe(
        r3Policy.marginalUtility.fixedReviewOverheadSeconds +
          Math.max(
            r3Policy.marginalUtility.minimumAudioCostSeconds,
            p.uniqueAudioCostSeconds,
          ),
      );
      expect(p.rankScore).toBe(p.utility / p.reviewCostSeconds);
      expect(p.inputDerivation).toBe(
        "EXISTING_R3_EVIDENCE_GRAPH_AND_ATOMIC_TARGET_REGION_PROJECTION",
      );
    }
    for (let index = 1; index < regions.regions.length; index++) {
      const before = required(regions.regions[index - 1]).priorityMetadata,
        after = required(regions.regions[index]).priorityMetadata;
      expect(
        C60113_MANDATORY_ORDER[before.priorityVector.mandatorySafetyClass],
      ).toBeGreaterThanOrEqual(
        C60113_MANDATORY_ORDER[after.priorityVector.mandatorySafetyClass],
      );
      if (
        before.priorityVector.mandatorySafetyClass ===
        after.priorityVector.mandatorySafetyClass
      )
        expect(before.rankScore).toBeGreaterThanOrEqual(after.rankScore);
    }
    expect(regions.summary.disjointItemCount).toBe(2);
  });

  it("copies source evidence strengths/roots and never counts raw provenance as lexical", () => {
    const input = fixture();
    const result = buildC60114R3EvidenceProjection({
      previousEvidenceFamilies: input.previousEvidenceFamilies,
      targets: input.targets,
      speechIslands: input.speechIslands,
    });
    for (const row of result.evidence.filter((row) =>
      row.evidenceId.startsWith("c60114-r3-"),
    )) {
      const source = required(
        input.speechIslands.audit.evidence.find(
          (source) => `c60114-r3-${source.evidenceId}` === row.evidenceId,
        ),
      );
      expect(row.strength).toBe(source.strength);
      expect(row.rootLineageIds).toEqual(source.rootLineageIds);
      expect(row.family).toBe("SPEECH_ACTIVITY");
    }
    expect(result.evidence.find((row) => row.evidenceId === "hall")).toEqual(
      input.previousEvidenceFamilies.evidence[0],
    );
  });

  it("preserves gaps and rejects unfrozen R3 weights", () => {
    const input = fixture();
    const items = buildC60114ReviewItems(input);
    const evidenceFamilies = buildC60114R3EvidenceProjection(input);
    const result = clusterC60114ReviewRegions({
      ...input,
      items,
      evidenceFamilies,
    });
    const parentRegions = result.regions.filter((row) =>
      row.reviewItemIds.includes(input.missingParent.reviewItemId),
    );
    expect(parentRegions.flatMap((row) => row.sourceIntervals)).toEqual([
      { start: 10, end: 12 },
      { start: 20, end: 22 },
    ]);
    expect(
      parentRegions.every((row) =>
        row.contextIntervals.every(
          (interval) => interval.end - interval.start <= 6,
        ),
      ),
    ).toBe(true);
    expect(() =>
      clusterC60114ReviewRegions({
        ...input,
        items,
        evidenceFamilies,
        frozenR3Policy: {
          ...r3Policy,
          marginalUtility: {
            ...r3Policy.marginalUtility,
            riskWeight: r3Policy.marginalUtility.riskWeight + 1,
          },
        },
      }),
    ).toThrow();
  });
});
