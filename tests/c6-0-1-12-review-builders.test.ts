import { describe, expect, it } from "vitest";

import { buildC60112ReviewPolicy } from "../packages/video-subtitler/src/review/c60112-policy.js";
import {
  buildC60112ReviewCandidateBundles,
  type C60112ReviewCandidateInput,
} from "../packages/video-subtitler/src/review/review-candidate-bundle.js";
import {
  buildC60112ReviewItems,
  type C60112MachineReviewSignal,
} from "../packages/video-subtitler/src/review/review-item-builder.js";
import {
  buildC60112ReviewPackageFreeze,
  assertC60112FrozenWorkspaceData,
  verifyC60112ReviewPackageFreeze,
} from "../packages/video-subtitler/src/review/review-package-freeze.js";
import { buildC60112ReviewPriority } from "../packages/video-subtitler/src/review/review-priority.js";
import { clusterC60112ReviewRegions } from "../packages/video-subtitler/src/review/review-region-clustering.js";

const FROZEN_AT = "2026-08-29T12:00:00.000Z";
const SHA = "a".repeat(64);
const MACHINE_DRAFT_HASH = "b".repeat(64);
const policy = buildC60112ReviewPolicy({ policyFrozenAt: FROZEN_AT });

function signal(
  overrides: Partial<C60112MachineReviewSignal> = {},
): C60112MachineReviewSignal {
  return {
    eventIds: ["event-1"],
    finalCueIds: ["cue-1"],
    itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
    sourceInterval: { start: 10, end: 13 },
    coreInterval: { start: 10.5, end: 12.5 },
    currentText: "現在の字幕",
    candidateIds: ["reazon-1", "whisper-alt-1"],
    evidenceIds: ["evidence-cross-model"],
    reviewReasons: ["WHISPER_REAZON_LEXICAL_CONFLICT"],
    sceneIds: ["scene-1"],
    speakerGroupIds: ["speaker-a"],
    ...overrides,
  };
}

function candidates(): C60112ReviewCandidateInput[] {
  return [
    {
      candidateId: "reazon-1",
      label: "REAZON",
      displayText: "正しい字幕",
      sourceInterval: { start: 10.5, end: 12.5 },
      evidenceIds: ["reazon-exact"],
      provenanceIds: ["request-reazon-1"],
      evidenceBadges: ["STABLE", "ACOUSTIC_FAVORED"],
    },
    {
      candidateId: "whisper-alt-1",
      label: "WHISPER_ALT",
      displayText: "正しい 字幕。",
      sourceInterval: { start: 10.5, end: 12.5 },
      evidenceIds: ["whisper-context"],
      provenanceIds: ["request-whisper-1"],
      evidenceBadges: ["CONTEXT_EXTENSION_ONLY"],
    },
  ];
}

describe("C6.0.1.12 machine-only review builders", () => {
  it("builds deterministic multi-label items instead of a precedence status", () => {
    const signals = [
      signal(),
      signal({
        itemTypes: ["TEXT_WHISPER_INSTABILITY", "TEXT_REAZON_INSTABILITY"],
        evidenceIds: ["whisper-stability", "reazon-stability"],
        reviewReasons: ["WHISPER_CORE_UNSTABLE", "REAZON_CORE_UNSTABLE"],
      }),
    ];
    const first = buildC60112ReviewItems({ signals, policy });
    const second = buildC60112ReviewItems({
      signals: [...signals].reverse(),
      policy,
    });

    expect(first.semanticHash).toBe(second.semanticHash);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      itemTypes: [
        "TEXT_CROSS_MODEL_DISAGREEMENT",
        "TEXT_REAZON_INSTABILITY",
        "TEXT_WHISPER_INSTABILITY",
      ],
      priorityTier: "CRITICAL",
      requiredLevel: "REQUIRED",
    });
    expect(first.summary.multiLabelItemCount).toBe(1);
  });

  it("keeps missing-speech items without a final cue reviewable", () => {
    const artifact = buildC60112ReviewItems({
      policy,
      signals: [
        signal({
          eventIds: ["speech-gap-1"],
          finalCueIds: [],
          itemTypes: ["MISSING_SPEECH_RISK", "SPAN_LINEAGE_BLOCKED"],
          sourceInterval: { start: 50, end: 52 },
          coreInterval: { start: 50.2, end: 51.8 },
          currentText: null,
          candidateIds: [],
          reviewReasons: [
            "MISSING_DIALOGUE_SUSPECTED",
            "SPAN_LINEAGE_UNAVAILABLE",
          ],
        }),
      ],
    });

    expect(artifact.summary.orphanItemCount).toBe(1);
    expect(artifact.items[0]?.suggestedActions).toEqual(
      expect.arrayContaining(["ADD_NEW_CUE", "MARK_FALSE_POSITIVE"]),
    );
    expect(artifact.items[0]?.requiredLevel).toBe("REQUIRED");
  });

  it("ranks risk for review without representing the score as error probability", () => {
    const itemsArtifact = buildC60112ReviewItems({
      policy,
      signals: [
        signal(),
        signal({
          eventIds: ["event-2"],
          finalCueIds: ["cue-2"],
          itemTypes: ["TEXT_HALLUCINATION_RISK"],
          sourceInterval: { start: 20, end: 22 },
          coreInterval: { start: 20, end: 22 },
          reviewReasons: ["WHISPER_HALLUCINATION_SIGNAL"],
        }),
      ],
    });
    const priority = buildC60112ReviewPriority({
      items: itemsArtifact.items,
      policy,
    });

    expect(priority.entries[0]).toMatchObject({
      itemTypes: ["TEXT_HALLUCINATION_RISK"],
      priorityTier: "CRITICAL",
      requiredLevel: "REQUIRED",
    });
    expect(policy.priorityScoreMeaning).toBe(
      "EXPLAINABLE_RISK_RANK_NOT_ERROR_PROBABILITY",
    );
    expect(priority.entries[0]).not.toHaveProperty("probability");
  });

  it("clusters nearby same-category items but preserves category and scene boundaries", () => {
    const itemsArtifact = buildC60112ReviewItems({
      policy,
      signals: [
        signal(),
        signal({
          eventIds: ["event-2"],
          finalCueIds: ["cue-2"],
          sourceInterval: { start: 13.1, end: 15 },
          coreInterval: { start: 13.1, end: 14.5 },
          currentText: "次の字幕",
        }),
        signal({
          eventIds: ["event-3"],
          finalCueIds: ["cue-3"],
          itemTypes: ["TIMING_BOUNDARY_RISK"],
          sourceInterval: { start: 14.6, end: 16 },
          coreInterval: { start: 14.6, end: 16 },
          currentText: "時間字幕",
          reviewReasons: ["TIMING_EVIDENCE_CONFLICT"],
        }),
        signal({
          eventIds: ["event-4"],
          finalCueIds: ["cue-4"],
          sourceInterval: { start: 16.1, end: 18 },
          coreInterval: { start: 16.1, end: 18 },
          currentText: "別場面",
          sceneIds: ["scene-2"],
        }),
      ],
    });
    const regions = clusterC60112ReviewRegions({
      items: itemsArtifact.items,
      policy,
      sourceDurationSeconds: 900.01,
    });

    expect(regions.regions).toHaveLength(3);
    expect(regions.regions[0]?.reviewItemIds).toHaveLength(2);
    expect(regions.regions[0]).toMatchObject({
      contextStart: 8.5,
      contextEnd: 16.5,
    });
    expect(regions.summary.totalContextAudioSeconds).toBeGreaterThan(0);
  });

  it("collapses normalized duplicate display text while retaining every provenance", () => {
    const items = buildC60112ReviewItems({ signals: [signal()], policy });
    const artifact = buildC60112ReviewCandidateBundles({
      items: items.items,
      candidates: candidates(),
      policy,
    });
    const bundle = artifact.bundles[0];
    const collapsed = bundle?.displayCandidates.find(
      (candidate) => candidate.labels.length === 2,
    );

    expect(bundle).toMatchObject({
      selectionAuthority: "HUMAN_ONLY",
      calibratedConfidencePercentageDisplayed: false,
    });
    expect(bundle?.displayCandidates).toHaveLength(2);
    expect(collapsed?.labels).toEqual(["WHISPER_ALT", "REAZON"]);
    expect(collapsed?.provenance).toHaveLength(2);
    expect(artifact.summary.collapsedDuplicateCount).toBe(1);
  });

  it("scopes display candidate IDs to one review item while preserving provider labels", () => {
    const itemArtifact = buildC60112ReviewItems({
      policy,
      signals: [
        signal(),
        signal({
          eventIds: ["event-2"],
          finalCueIds: ["cue-2"],
          sourceInterval: { start: 20, end: 23 },
          coreInterval: { start: 20.5, end: 22.5 },
          currentText: "現在の字幕",
          candidateIds: ["reazon-2", "whisper-alt-2"],
        }),
      ],
    });
    const artifact = buildC60112ReviewCandidateBundles({
      items: itemArtifact.items,
      candidates: [
        ...candidates(),
        ...candidates().map((candidate) => ({
          ...candidate,
          candidateId: candidate.candidateId.replace("-1", "-2"),
        })),
      ],
      policy,
    });
    const candidateIds = artifact.bundles.flatMap((bundle) =>
      bundle.displayCandidates.map((candidate) => candidate.displayCandidateId),
    );

    expect(candidateIds).toHaveLength(new Set(candidateIds).size);
    expect(
      artifact.bundles
        .flatMap((bundle) => bundle.displayCandidates)
        .some(
          (candidate) =>
            candidate.labels.includes("REAZON") &&
            candidate.labels.includes("WHISPER_ALT"),
        ),
    ).toBe(true);
  });

  it("rejects Gold-derived input and uncalibrated candidate confidence", () => {
    const contaminatedSignal = {
      ...signal(),
      goldText: "人工终稿",
    };
    expect(() =>
      buildC60112ReviewItems({
        signals: [contaminatedSignal],
        policy,
      }),
    ).toThrow(/GOLD_INPUT_FORBIDDEN/u);
    const roleContaminatedSignal = {
      ...signal(),
      datasetRole: "GOLD",
    };
    expect(() =>
      buildC60112ReviewItems({
        signals: [roleContaminatedSignal],
        policy,
      }),
    ).toThrow(/GOLD_INPUT_FORBIDDEN/u);

    const contaminatedCandidate = {
      ...candidates()[0],
      confidence: 0.92,
    };
    expect(() =>
      buildC60112ReviewCandidateBundles({
        items: buildC60112ReviewItems({ signals: [signal()], policy }).items,
        candidates: [contaminatedCandidate as C60112ReviewCandidateInput],
        policy,
      }),
    ).toThrow(/UNCALIBRATED_CANDIDATE_CONFIDENCE_FORBIDDEN/u);
  });

  it("freezes every machine review component before Gold evaluation", () => {
    const items = buildC60112ReviewItems({ signals: [signal()], policy });
    const priority = buildC60112ReviewPriority({ items: items.items, policy });
    const regions = clusterC60112ReviewRegions({
      items: items.items,
      policy,
      sourceDurationSeconds: 900.01,
    });
    const candidateBundles = buildC60112ReviewCandidateBundles({
      items: items.items,
      candidates: candidates(),
      policy,
    });
    const packageInput = {
      sourceMediaSha256: SHA,
      machineDraftHash: MACHINE_DRAFT_HASH,
      policy,
      items,
      priority,
      regions,
      candidates: candidateBundles,
      audioManifest: {
        clips: [{ regionId: regions.regions[0]?.regionId, sha256: SHA }],
      },
      workspaceData: {
        reviewItemIds: items.items.map((item) => item.reviewItemId),
      },
    };
    const freeze = buildC60112ReviewPackageFreeze({
      frozenAt: FROZEN_AT,
      ...packageInput,
    });

    expect(freeze).toMatchObject({
      runtimeGoldInputCount: 0,
      goldAccessBeforeFreezeCount: 0,
      frozenBeforeGoldEvaluation: true,
    });
    expect(verifyC60112ReviewPackageFreeze({ freeze, packageInput })).toBe(
      true,
    );
    expect(() =>
      buildC60112ReviewPackageFreeze({
        frozenAt: FROZEN_AT,
        ...packageInput,
        workspaceData: { goldPath: "/tmp/human-final.ass" },
      }),
    ).toThrow(/GOLD_INPUT_FORBIDDEN/u);
  });

  it("changes a freeze when a frozen machine artifact changes", () => {
    const items = buildC60112ReviewItems({ signals: [signal()], policy });
    const priority = buildC60112ReviewPriority({ items: items.items, policy });
    const regions = clusterC60112ReviewRegions({ items: items.items, policy });
    const candidateBundles = buildC60112ReviewCandidateBundles({
      items: items.items,
      candidates: candidates(),
      policy,
    });
    const base = {
      frozenAt: FROZEN_AT,
      sourceMediaSha256: SHA,
      machineDraftHash: MACHINE_DRAFT_HASH,
      policy,
      items,
      priority,
      regions,
      candidates: candidateBundles,
      audioManifest: { clips: [] },
      workspaceData: { version: 1 },
    };
    const first = buildC60112ReviewPackageFreeze(base);
    const second = buildC60112ReviewPackageFreeze({
      ...base,
      workspaceData: { version: 2 },
    });

    expect(first.workspaceDataHash).not.toBe(second.workspaceDataHash);
    expect(first.aggregateHash).not.toBe(second.aggregateHash);
  });

  it("rejects post-freeze review-data tampering even when embedded hashes stay unchanged", () => {
    const items = buildC60112ReviewItems({ signals: [signal()], policy });
    const priority = buildC60112ReviewPriority({ items: items.items, policy });
    const regions = clusterC60112ReviewRegions({ items: items.items, policy });
    const candidateBundles = buildC60112ReviewCandidateBundles({
      items: items.items,
      candidates: candidates(),
      policy,
    });
    const workspaceData = {
      schemaVersion: "1.0.0",
      workspaceVersion: "c6.0.1.12-review-workspace-v1",
      policyVersion: policy.policyVersion,
      policyHash: policy.semanticHash,
      reviewPackageSemanticHash: SHA,
      machineDraftHash: MACHINE_DRAFT_HASH,
      sourceMediaIdentity: { sourceMediaSha256: SHA, sourceDurationMs: 3_000 },
      machineDraftIdentity: { cueCount: 1 },
      items: [],
      regions: [],
      candidateBundles: [],
    };
    const freeze = buildC60112ReviewPackageFreeze({
      frozenAt: FROZEN_AT,
      sourceMediaSha256: SHA,
      machineDraftHash: MACHINE_DRAFT_HASH,
      policy,
      items,
      priority,
      regions,
      candidates: candidateBundles,
      audioManifest: { clips: [] },
      workspaceData,
    });

    expect(() =>
      assertC60112FrozenWorkspaceData({ freeze, workspaceData }),
    ).not.toThrow();
    expect(() =>
      assertC60112FrozenWorkspaceData({
        freeze,
        workspaceData: {
          ...workspaceData,
          machineDraftIdentity: { cueCount: 2 },
        },
      }),
    ).toThrow(/REVIEW_WORKSPACE_DATA_FREEZE_HASH_MISMATCH/u);
  });
});
