import { describe, expect, it } from "vitest";
import * as shared from "@mvl/shared";
import type { Projections143 } from "@mvl/shared";
import {
  assertPreGoldIntegrity1431,
  buildProjectionRebindingLedger1431,
  preflightNestedSemanticIntegrity1431,
  rebindCoverageAudio1431,
  reproduceBaselineHashFailure1431,
  type NestedArtifact1431Input,
} from "../../packages/video-subtitler/src/review/c6011431-projection-integrity.js";
import {
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

const sourceIdentity = {
  sourceMediaSha256: "a".repeat(64),
  durationSeconds: 10,
  sampleRate: 48_000,
  audioStreamIndex: 1,
  audioTimebase: "1/1000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
};
const sourceAudio = () =>
  hashed141({
    audioId: "audio-1",
    relativePath: "audio/audio-1.wav",
    sourceMediaSha256: sourceIdentity.sourceMediaSha256,
    sourceInterval: { start: 1, end: 2 },
    requestedInterval: { start: 1, end: 2 },
    actualSourceInterval: { start: 1, end: 2 },
    requestedSourceInterval: { start: 1, end: 2 },
    sampleRate: 16_000,
    channels: 1,
    bitDepth: 16,
    codec: "pcm_s16le",
    frameCount: 16_000,
    actualDuration: 1,
    sha256: "b".repeat(64),
    playable: true,
    hashVerified: true,
    physicalMetadataVerified: true,
    coveredReviewTargetIds: ["target-1"],
    regionIds: ["region-1"],
    sourceIdentity,
    nativeSourceInterval: { startSample: 48_000, endSample: 96_000 },
  });
const playback = () =>
  hashed141({
    playbackSegmentId: "playback-1",
    audioId: "audio-1",
    sourceInterval: { start: 1, end: 2 },
    audioLocalInterval: { start: 0, end: 1 },
    reviewTargetIds: ["target-1"],
    reviewItemIds: ["item-1"],
    regionIds: ["region-1"],
    sourceIdentity,
  });

function projections(
  audio: ReturnType<typeof rebindCoverageAudio1431>,
  playbackRow = playback(),
) {
  return hashed141({
    sourceIdentity,
    variants: Array.from({ length: 8 }, (_, index) =>
      hashed141({
        stage: `A${index}`,
        projection: {
          sourceIdentity,
          physicalAudio: [audio],
          playbackSegments: [playbackRow],
          targets: [],
          regions: [],
        },
      }),
    ),
    officialStage: "A7",
  }) as unknown as Projections143;
}

function nestedArtifacts(
  ledger: shared.ProjectionRebindingLedger1431,
): NestedArtifact1431Input[] {
  const requiredArtifact = (
    artifactType: string,
    field: string,
    rowType: shared.NestedRowType1431,
    rows: readonly unknown[],
  ) => {
    const artifact = hashed141({ artifactType, [field]: rows });
    return {
      artifactPathRelative: `${artifactType}.json`,
      artifact,
      artifactRowType: rowType,
      rowGroups: [
        {
          rowType,
          rows,
          rowPath: (index: number) => `$.${field}[${index}]`,
          rowHashExpected: true,
        },
      ],
    } satisfies NestedArtifact1431Input;
  };
  const target = hashed141({ reviewTargetId: "target-1" }),
    region = hashed141({ regionId: "region-1" }),
    safety = hashed141({ targetId: "safety-1" }),
    atom = hashed141({ atomId: "atom-1" }),
    child = hashed141({ childUnitId: "child-1" }),
    bundle = hashed141({ bundleId: "bundle-1" }),
    obligation = hashed141({ obligationId: "obligation-1" }),
    hierarchy = hashed141({
      artifactType: "hierarchy",
      atoms: [atom],
      children: [child],
    }),
    continuity = hashed141({
      artifactType: "continuity",
      entries: [{ obligationId: "obligation-1" }],
    }),
    planner = hashed141({ artifactType: "planner", selected: ["bundle-1"] });
  return [
    requiredArtifact("targets", "targets", "REVIEW_TARGET_ROW", [target]),
    requiredArtifact("regions", "regions", "REVIEW_REGION_ROW", [region]),
    requiredArtifact("safety", "targets", "SAFETY_TARGET_ROW", [safety]),
    {
      artifactPathRelative: "hierarchy.json",
      artifact: hierarchy,
      artifactRowType: "SELECTABLE_CHILD_UNIT_ROW",
      rowGroups: [
        {
          rowType: "HIERARCHICAL_ATOM_ROW",
          rows: hierarchy.atoms,
          rowPath: (index) => `$.atoms[${index}]`,
          rowHashExpected: true,
        },
        {
          rowType: "SELECTABLE_CHILD_UNIT_ROW",
          rows: hierarchy.children,
          rowPath: (index) => `$.children[${index}]`,
          rowHashExpected: true,
        },
      ],
    },
    requiredArtifact("bundles", "candidates", "TARGET_BUNDLE_ROW", [bundle]),
    {
      artifactPathRelative: "continuity.json",
      artifact: continuity,
      artifactRowType: "CONTINUITY_LEDGER_ROW",
      rowGroups: [
        {
          rowType: "CONTINUITY_LEDGER_ROW",
          rows: continuity.entries,
          rowPath: (index) => `$.entries[${index}]`,
          rowHashExpected: false,
        },
      ],
    },
    requiredArtifact("obligations", "obligations", "PHASE_A_OBLIGATION_ROW", [
      obligation,
    ]),
    {
      artifactPathRelative: "planner.json",
      artifact: planner,
      artifactRowType: "PLANNER_CERTIFICATE",
      rowGroups: [
        {
          rowType: "PLANNER_CERTIFICATE",
          rows: [planner],
          rowPath: () => "$",
          rowHashExpected: true,
        },
      ],
    },
    {
      artifactPathRelative: "ledger.json",
      artifact: ledger,
      artifactRowType: "PROJECTION_REBINDING_LEDGER_ROW",
      rowGroups: [
        {
          rowType: "PROJECTION_REBINDING_LEDGER_ROW",
          rows: ledger.entries,
          rowPath: (index) => `$.entries[${index}]`,
          rowHashExpected: true,
        },
      ],
    },
  ];
}

function ledger() {
  const source = sourceAudio();
  return buildProjectionRebindingLedger1431({
    sourceRows: [source],
    projectedRows: [rebindCoverageAudio1431(source)],
    sourceIdentity,
    projectionId: "C601143_FINAL_REVIEW_DELIVERY",
    projectionStage: "A7",
    sourceArtifactType: "machine-review-audio-manifest-v6",
    sourceSchemaVersion: "1.0.0",
    projectedSchemaVersion: "1.0.0",
  });
}

describe("C6.0.1.14.3.1 strict projection integrity re-freeze flow", () => {
  it("reproduces the stale domain, rebinds rows, validates all nested types twice, then opens Gold", () => {
    const source = sourceAudio(),
      projected = rebindCoverageAudio1431(source),
      stale = { ...projected, semanticHash: source.semanticHash },
      reproduced = reproduceBaselineHashFailure1431({
        sourceRows: [source],
        projections: projections(stale),
      }),
      rebinding = ledger(),
      corrected = projections(projected),
      finalA = preflightNestedSemanticIntegrity1431(
        corrected,
        nestedArtifacts(rebinding),
      ),
      finalB = preflightNestedSemanticIntegrity1431(
        corrected,
        nestedArtifacts(rebinding),
      );
    expect(reproduced.staleProjectedAudioHashReuseCount).toBe(1);
    expect(rebinding.entries).toHaveLength(1);
    assertPreGoldIntegrity1431(finalA);
    assertPreGoldIntegrity1431(finalB);
    expect(finalA.semanticHash).toBe(finalB.semanticHash);
    expect(finalA.failures).toHaveLength(0);
    expect(finalA.nestedRowNotApplicableNoRowHashCounts).toMatchObject({
      CONTINUITY_LEDGER_ROW: 1,
    });

    let goldReadCount = 0;
    const openGoldAfterFreeze = () => {
      assertPreGoldIntegrity1431(finalA);
      assertPreGoldIntegrity1431(finalB);
      shared.machineRefreeze1431Schema.parse(
        hashed141({
          schemaVersion: "1.0.0",
          policyVersion: "c6.0.1.14.3.1-projection-hash-integrity-v1",
          visibility: "LOCAL_ONLY",
          artifactType: "c6-0-1-14-3-1-machine-refreeze",
          sourceIdentity,
          finalAFreezeHash: "c".repeat(64),
          finalBFreezeHash: "d".repeat(64),
          finalAProjectionHash: corrected.semanticHash,
          finalBProjectionHash: corrected.semanticHash,
          rebindingLedgerHash: rebinding.semanticHash,
          finalARebindingLedgerHash: rebinding.semanticHash,
          finalBRebindingLedgerHash: rebinding.semanticHash,
          changeAuditHash: "e".repeat(64),
          nestedPreflightHash: finalA.semanticHash,
          finalANestedPreflightHash: finalA.semanticHash,
          finalBNestedPreflightHash: finalB.semanticHash,
          preFreezePreflightCount: 2,
          finalABByteParity: true,
          finalABSemanticParity: true,
          wavHashParity: true,
          wavPcmParity: true,
          wavDurationParity: true,
          wavMappingParity: true,
          wavPlayableCount: 1,
          detectorReplayHits: 18,
          detectorReplayExpected: 18,
          asrReplayHits: 44,
          asrReplayExpected: 44,
          cacheMissCount: 0,
          inferenceCount: 0,
          modelLoadCount: 0,
          providerProcessStartCount: 0,
          canonicalTextHash: "f".repeat(64),
          canonicalTimingHash: "1".repeat(64),
          presentationHash: "2".repeat(64),
          canonicalTextMutationCount: 0,
          canonicalTimingMutationCount: 0,
          presentationMutationCount: 0,
          goldReadStarted: false,
          refreezePassed: true,
        }),
      );
      goldReadCount++;
    };
    expect(goldReadCount).toBe(0);
    openGoldAfterFreeze();
    expect(goldReadCount).toBe(1);
  });

  it("blocks Gold when a playback row is stale despite valid enclosing hashes", () => {
    const projected = rebindCoverageAudio1431(sourceAudio()),
      stalePlayback = { ...playback(), semanticHash: "9".repeat(64) },
      candidate = projections(projected, stalePlayback),
      preflight = preflightNestedSemanticIntegrity1431(
        candidate,
        nestedArtifacts(ledger()),
      );
    expect(preflight.failures.map((failure) => failure.code)).toContain(
      "NESTED_ROW_HASH_INVALID",
    );
    expect(() => assertPreGoldIntegrity1431(preflight)).toThrow(
      /PRE_GOLD_NESTED_INTEGRITY_FAILED/u,
    );
    expect(required141(preflight.failures[0]).pathWithinArtifact).toContain(
      "playbackSegments",
    );
  });
});
