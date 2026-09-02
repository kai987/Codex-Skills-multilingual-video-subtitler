import { describe, expect, it } from "vitest";
import type * as shared from "@mvl/shared";
import { shareableSummary1452Schema } from "@mvl/shared";
import {
  hash141,
  hashed141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import { policy1452 } from "../packages/video-subtitler/src/review/c6011452-policy.js";
import {
  assertNoDegenerateFakeBinding1452,
  auditDegenerateOrphans1452,
  reconcileDegenerateEligibility1452,
} from "../packages/video-subtitler/src/review/c6011452-degenerate-orphans.js";
import {
  buildEffectiveRealizations1452,
  buildInheritedRealizations1452,
  buildRealizationCandidates1452,
} from "../packages/video-subtitler/src/review/c6011452-realizations.js";
import {
  buildWitnessConnectivity1452,
  buildWitnessGroups1452,
} from "../packages/video-subtitler/src/review/c6011452-witness-connectivity.js";
import {
  buildDeterminacyPolicy1452,
  buildDeterminacyPreflight1452,
  evaluateProductComponent1452,
  routeFromGates1452,
  type RouteGates1452,
} from "../packages/video-subtitler/src/review/c6011452-determinacy.js";

const source = {
  sourceMediaSha256: "a".repeat(64),
  durationSeconds: 30,
  sampleRate: 48_000,
  audioStreamIndex: 0,
  audioTimebase: "1/48000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
};
const native = (start: number, end: number) => ({
  startSample: Math.round(start * source.sampleRate),
  endSample: Math.round(end * source.sampleRate),
});
const seconds = (start: number, end: number) => ({ start, end });

function oneUnitFixture() {
  const unit = {
      fullCoverageUnitId: "unit-a",
      legacyPlanningCoverageUnitIds: ["legacy-a"],
      atomicNativeIntervals: [native(0, 1)],
      atomicSourceIntervals: [seconds(0, 1)],
      coreUnionSamples: source.sampleRate,
      coreUnionSeconds: 1,
      envelopeInterval: native(0, 1),
      parentClusterIds: ["parent-a"],
      evidenceObservationIds: ["evidence-a"],
      childUnitIds: ["child-a"],
      sourceIdentity: source,
    },
    registry = {
      sourceIdentity: source,
      units: [unit],
      fullRegistryUnitCount: 1,
      registeredVerifiedSpeechCoverageRatio: 1,
      unregisteredVerifiedSpeechSamples: 0,
      complete: true,
      semanticHash: hash141({ registry: "one-unit" }),
    } as unknown as shared.FullRegistry1451,
    targetId = "target-a",
    regionId = "region-a",
    audioId = "audio-a",
    target = {
      reviewTargetId: targetId,
      targetType: "ORPHAN_SPEECH_TARGET",
      sourceInterval: seconds(0, 1),
      nativeInterval: native(0, 1),
      targetCoreIntervals: [native(0, 1)],
      atomicTargetCoreIntervals: [native(0, 1)],
      evidenceIds: ["evidence-a"],
      childUnitIds: ["child-a"],
      atomicMemberCandidateIds: ["candidate-a"],
      localizationStatus: "RESOLVED",
      sourceIdentity: source,
    },
    targets = {
      targets: [target],
      semanticHash: hash141({ targets: [targetId] }),
    } as unknown as shared.ReviewTargets1451,
    targetBinding = {
      bindingLedgerId: "target-binding-a",
      targetId,
      bindingRequirement: "UNIT_BINDING_REQUIRED",
      bindingStatus: "BOUND_SINGLE_UNIT",
      productBindingEligible: true,
      fullCoverageUnitId: unit.fullCoverageUnitId,
      legacyPlanningCoverageUnitIds: unit.legacyPlanningCoverageUnitIds,
      targetCoreIntervals: [native(0, 1)],
      coreDerivationMethod: "ATOMIC_TARGET_CORE",
    },
    audio = {
      audioId,
      coveredReviewTargetIds: [targetId],
      regionIds: [regionId],
      nativeSourceInterval: native(0, 20),
      playable: true,
      physicalMetadataVerified: true,
      hashVerified: true,
      sourceIdentity: source,
    },
    segmentA = {
      playbackSegmentId: "segment-a",
      reviewTargetIds: [targetId],
      audioId,
      sourceInterval: seconds(0, 0.5),
      sourceIdentity: source,
    },
    segmentB = {
      playbackSegmentId: "segment-b",
      reviewTargetIds: [],
      audioId,
      sourceInterval: seconds(0.5, 1),
      sourceIdentity: source,
    },
    playbackBindings = [
      {
        bindingLedgerId: "playback-binding-a",
        playbackSegmentId: segmentA.playbackSegmentId,
        audioId,
        targetIds: [targetId],
        productBindingEligible: true,
        fullCoverageUnitId: unit.fullCoverageUnitId,
        playbackSourceInterval: native(0, 0.5),
        overlapSamples: native(0, 0.5).endSample,
        unitCoreCoverageRatio: 0.5,
      },
      {
        bindingLedgerId: "playback-binding-b",
        playbackSegmentId: segmentB.playbackSegmentId,
        audioId,
        targetIds: [targetId],
        productBindingEligible: true,
        fullCoverageUnitId: unit.fullCoverageUnitId,
        playbackSourceInterval: native(0.5, 1),
        overlapSamples: native(0.5, 1).endSample - native(0.5, 1).startSample,
        unitCoreCoverageRatio: 0.5,
      },
    ],
    binding = {
      targetCount: 1,
      targetBindings: [targetBinding],
      regionBindings: [],
      audioBindings: [],
      playbackBindings,
      productEligibleTargetUnitZeroOverlapCount: 0,
      productEligibleAudioUnitZeroOverlapCount: 0,
      productEligiblePlaybackUnitZeroOverlapCount: 0,
      semanticHash: hash141({ binding: "one-unit" }),
    } as unknown as shared.ReviewBinding1451,
    regions = {
      regions: [
        {
          regionId,
          reviewTargetIds: [targetId],
          nativeSourceIntervals: [native(0, 1)],
          sourceIdentity: source,
        },
      ],
      semanticHash: hash141({ regions: [regionId] }),
    } as unknown as shared.ReviewRegions1451,
    audioManifest = {
      audio: [audio],
      semanticHash: hash141({ audio: [audioId] }),
    } as unknown as shared.ReviewAudio1451,
    playback = {
      segments: [segmentA, segmentB],
      plans: [
        {
          planId: "FULL_QUEUE",
          playbackSegmentIds: [
            segmentA.playbackSegmentId,
            segmentB.playbackSegmentId,
          ],
        },
        {
          planId: "ALL_MANDATORY",
          playbackSegmentIds: [segmentA.playbackSegmentId],
        },
      ],
      semanticHash: hash141({ playback: "two-segment" }),
    } as unknown as shared.ReviewPlayback1451;
  return {
    unit,
    registry,
    targetId,
    regionId,
    audioId,
    target,
    targets,
    binding,
    regions,
    audioManifest,
    playback,
  };
}

describe("C6.0.1.14.5.2 product scorability and playback realization", () => {
  it("freezes the generic thresholds and replay-only authority", () => {
    const policy = policy1452();
    expect(policy.minimumSpeechAnchorSeconds).toBe(0.12);
    expect(policy.machineAnchorMinimumOverlapSeconds).toBe(0.2);
    expect(policy.playbackToUnitCoverageThreshold).toBe(0.95);
    expect(policy.maximumReviewEnvelopeSeconds).toBe(12);
    expect(policy.maximumOneSideContextSeconds).toBe(3);
    expect(policy.maximumInferenceCount).toBe(0);
    expect(policy.canonicalMutationAllowed).toBe(false);
  });

  it("reclassifies a generic 3 ms boundary-only orphan as retained audit-only evidence", () => {
    const fixture = oneUnitFixture(),
      sliver = {
        ...fixture.target,
        reviewTargetId: "sliver",
        sourceInterval: seconds(1, 1.003),
        nativeInterval: native(1, 1.003),
        targetCoreIntervals: [native(1, 1.003)],
        atomicTargetCoreIntervals: [],
        childUnitIds: [],
        atomicMemberCandidateIds: [],
        localizationStatus: "UNRESOLVED",
      },
      targets = {
        targets: [sliver],
        semanticHash: hash141({ targets: ["sliver"] }),
      } as unknown as shared.ReviewTargets1451,
      binding = {
        ...fixture.binding,
        targetBindings: [
          {
            ...fixture.binding.targetBindings[0],
            targetId: "sliver",
            bindingStatus: "REJECTED_ZERO_OVERLAP",
            productBindingEligible: false,
            fullCoverageUnitId: null,
            targetCoreIntervals: [native(1, 1.003)],
          },
        ],
      } as unknown as shared.ReviewBinding1451,
      audio = {
        ...fixture.audioManifest,
        audio: [
          {
            ...fixture.audioManifest.audio[0],
            coveredReviewTargetIds: ["sliver"],
            nativeSourceInterval: native(0, 2),
          },
        ],
      } as unknown as shared.ReviewAudio1451,
      policy = policy1452(),
      audit = auditDegenerateOrphans1452({
        policy,
        registry: fixture.registry,
        binding,
        targets,
        audio,
      }),
      eligibility = reconcileDegenerateEligibility1452({
        policy,
        registry: fixture.registry,
        binding,
        targets,
        audit,
      });
    expect(audit.rows[0]?.durationSamples).toBe(144);
    expect(audit.rows[0]?.fullRegistryPositiveOverlapSamples).toBe(0);
    expect(audit.rows[0]?.degenerateSliverCandidate).toBe(true);
    expect(eligibility.rows[0]?.classification).toBe(
      "DEGENERATE_ORPHAN_BOUNDARY_SLIVER",
    );
    expect(eligibility.rows[0]?.finalBindingRequirement).toBe(
      "UNIT_BINDING_OPTIONAL_AUDIT_ONLY",
    );
    expect(eligibility.rows[0]?.finalProductEligibility).toBe(false);
    expect(eligibility.reviewTargetCountAfter).toBe(1);
    expect(eligibility.targetIntervalMutationCount).toBe(0);
  });

  it("rejects attempts to fake-bind a degenerate audit-only sliver", () => {
    const fixture = oneUnitFixture(),
      eligibility = {
        rows: [
          {
            targetId: fixture.targetId,
            classification: "DEGENERATE_ORPHAN_BOUNDARY_SLIVER",
          },
        ],
      } as unknown as shared.DegenerateEligibility1452;
    expect(() =>
      assertNoDegenerateFakeBinding1452({
        eligibility,
        binding: fixture.binding,
      }),
    ).toThrow("C6011452_DEGENERATE_FAKE_BINDING");
  });

  it("accepts the exact region playback union while rejecting the half-unit target segment", () => {
    const fixture = oneUnitFixture(),
      policy = policy1452(),
      audit = auditDegenerateOrphans1452({
        policy,
        registry: fixture.registry,
        binding: fixture.binding,
        targets: fixture.targets,
        audio: fixture.audioManifest,
      }),
      eligibility = reconcileDegenerateEligibility1452({
        policy,
        registry: fixture.registry,
        binding: fixture.binding,
        targets: fixture.targets,
        audit,
      }),
      ledger = buildRealizationCandidates1452({
        policy,
        registry: fixture.registry,
        binding: fixture.binding,
        eligibility,
        targets: fixture.targets,
        regions: fixture.regions,
        audio: fixture.audioManifest,
        playback: fixture.playback,
      }),
      targetCandidate = ledger.candidates.find(
        (row) => row.realizationKind === "TARGET_SCOPED_PLAYBACK_REALIZATION",
      ),
      regionCandidate = ledger.candidates.find(
        (row) => row.realizationKind === "REGION_SCOPED_PLAYBACK_REALIZATION",
      );
    expect(targetCandidate?.accepted).toBe(false);
    expect(targetCandidate?.rejectionReasons).toContain(
      "PLAYBACK_UNIT_COVERAGE_BELOW_0_95",
    );
    expect(regionCandidate?.accepted).toBe(true);
    expect(regionCandidate?.playbackSegmentIds).toEqual([
      "segment-a",
      "segment-b",
    ]);
    expect(regionCandidate?.searchedSubsetCount).toBe(3);
    expect(regionCandidate?.reviewPlaybackEnvelopeSeconds).toBe(1);
    expect(
      (regionCandidate?.physicalAudioContainerInterval.endSample ?? 0) /
        source.sampleRate,
    ).toBe(20);
  });

  it("builds a complete inherited-to-witness product path without Gold", () => {
    const fixture = oneUnitFixture(),
      policy = policy1452(),
      audit = auditDegenerateOrphans1452({
        policy,
        registry: fixture.registry,
        binding: fixture.binding,
        targets: fixture.targets,
        audio: fixture.audioManifest,
      }),
      eligibility = reconcileDegenerateEligibility1452({
        policy,
        registry: fixture.registry,
        binding: fixture.binding,
        targets: fixture.targets,
        audit,
      }),
      candidates = buildRealizationCandidates1452({
        policy,
        registry: fixture.registry,
        binding: fixture.binding,
        eligibility,
        targets: fixture.targets,
        regions: fixture.regions,
        audio: fixture.audioManifest,
        playback: fixture.playback,
      }),
      inherited = buildInheritedRealizations1452({
        policy,
        registry: fixture.registry,
        candidates,
      }),
      effective = buildEffectiveRealizations1452({
        policy,
        registry: fixture.registry,
        planner: {
          selectedRealizationIds: [],
          semanticHash: hash141({ planner: "empty" }),
        } as unknown as shared.Planner145,
        v1Effective: {
          realizations: [],
        } as unknown as shared.EffectiveRealizations1451,
        inherited,
      }),
      connectivity = buildWitnessConnectivity1452({
        policy,
        registry: fixture.registry,
        effective,
        playback: fixture.playback,
      }),
      witnesses = buildWitnessGroups1452({
        policy,
        registry: fixture.registry,
        effective,
        connectivity,
      }),
      determinacyPolicy = buildDeterminacyPolicy1452({
        policy,
        registry: fixture.registry,
      }),
      preflight = buildDeterminacyPreflight1452({
        policy,
        registry: fixture.registry,
        reconciliation: {
          unmappedVerifiedSpeechRowCount: 0,
          registeredUnionParity: true,
        } as unknown as shared.SourceReconciliation1451,
        binding: fixture.binding,
        eligibility,
        candidates,
        effective,
        witnesses,
        audio: fixture.audioManifest as unknown as shared.ReviewAudio1452,
        playback: fixture.playback as unknown as shared.ReviewPlayback1452,
        determinacyPolicyHash: determinacyPolicy.semanticHash,
      }),
      result = evaluateProductComponent1452({
        policy,
        component: {
          errorComponentId: "missing-synthetic",
          sourceIdentity: source,
          labels: ["MISSING_DIALOGUE"],
          defectIds: [],
          alignmentIds: [],
          coveredItemIds: [],
          coveredRegionIds: [],
          errorIntervals: [seconds(0, 1)],
          mappingStatus: "RESOLVED",
          mappingReasons: [],
        },
        registry: fixture.registry,
        binding: fixture.binding,
        eligibility,
        v1Inherited: {
          realizations: [],
        } as unknown as shared.InheritedRealizations1451,
        v2Inherited: inherited,
        effective,
        witnesses,
        preflight,
      });
    expect(candidates.searchComplete).toBe(true);
    expect(inherited.realizations.length).toBeGreaterThan(0);
    expect(effective.effectiveProductRealizationCount).toBeGreaterThan(0);
    expect(connectivity.timeProximityOnlyConnectionCount).toBe(0);
    expect(witnesses.witnessGroupCount).toBeGreaterThan(0);
    expect(result.productContractStatus).toBe("SCORABLE_PASS_PRODUCT_CONTRACT");
    expect(result.outcomeDeterminacyStatus).toBe("DETERMINATE");
  });

  it("treats graph absence as a determinate scorable failure", () => {
    const fixture = oneUnitFixture(),
      flags = {
        fullRegistryComplete: true,
        sourceReconciliationComplete: true,
        targetBindingEnumerationComplete: true,
        audioBindingEnumerationComplete: true,
        playbackBindingEnumerationComplete: true,
        inheritedCandidateEnumerationComplete: true,
        inheritedCandidateSearchComplete: true,
        effectiveRealizationRegistryComplete: true,
        witnessGroupBuildComplete: true,
        witnessSearchComplete: true,
        physicalManifestComplete: true,
        playbackManifestComplete: true,
        nestedIntegrityComplete: true,
      },
      result = evaluateProductComponent1452({
        policy: policy1452(),
        component: {
          errorComponentId: "missing-no-target",
          errorIntervals: [seconds(0, 1)],
        } as unknown as shared.C60114ErrorComponent,
        registry: fixture.registry,
        binding: {
          targetBindings: [],
        } as unknown as shared.ReviewBinding1451,
        eligibility: {
          rows: [],
        } as unknown as shared.DegenerateEligibility1452,
        v1Inherited: {
          realizations: [],
        } as unknown as shared.InheritedRealizations1451,
        v2Inherited: {
          realizations: [],
        } as unknown as shared.InheritedRealizations1452,
        effective: {
          realizations: [],
        } as unknown as shared.EffectiveRealizations1452,
        witnesses: {
          groups: [],
        } as unknown as shared.WitnessGroups1452,
        preflight: {
          globalCompletenessFlags: flags,
        } as unknown as shared.DeterminacyPreflight1452,
      });
    expect(result.productContractStatus).toBe("SCORABLE_FAIL_TARGET_ABSENT");
    expect(result.scorabilityStatus).toBe("SCORABLE");
    expect(result.outcomeDeterminacyStatus).toBe("DETERMINATE");
  });

  it("routes an eligibility failure before later quality failures", () => {
    const gates = Object.fromEntries(
      [
        "integrity",
        "degenerateEligibility",
        "remainingRequiredTargetBinding",
        "candidateEnumeration",
        "inheritedPlaybackRealization",
        "effectiveRealizationRegistry",
        "witnessGroupConnectivity",
        "witnessSearch",
        "productOutcomeDeterminacy",
        "finalInventoryTargetCoverage",
        "physicalAudioPlaybackCoverage",
        "safetyBudgets",
        "productQuality",
      ].map((name) => [name, name !== "degenerateEligibility"]),
    ) as unknown as RouteGates1452;
    expect(routeFromGates1452(gates)).toBe(
      "HOLD_FOR_DEGENERATE_ORPHAN_ELIGIBILITY_REPAIR",
    );
  });

  it("keeps shareable summaries strict and aggregate-only", () => {
    const safe = hashed141({
      schemaVersion: "1.0.0",
      policyVersion:
        "c6.0.1.14.5.2-product-scorability-playback-realization-v1",
      artifactType: "c6-0-1-14-5-2-aggregate-shareable-summary",
      visibility: "SHAREABLE_AGGREGATE_ONLY",
      policyHash: "b".repeat(64),
      orphanClassificationCounts: {},
      candidateCounts: {},
      realizationCounts: {},
      determinacyCounts: {},
      recallRatios: {},
      mandatoryMetrics: {},
      artifactHashes: {},
      route: "HOLD",
      containsRawAudio: false,
      containsDialogueText: false,
      containsGoldRows: false,
      containsAbsolutePaths: false,
    });
    expect(shareableSummary1452Schema.parse(safe).containsRawAudio).toBe(false);
    expect(() =>
      shareableSummary1452Schema.parse({
        ...safe,
        localPath: "/Users/example/private.wav",
      }),
    ).toThrow();
  });
});
