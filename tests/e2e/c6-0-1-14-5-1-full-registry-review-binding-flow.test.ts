import { describe, expect, it } from "vitest";
import type * as shared from "@mvl/shared";
import { fixture145 } from "../fixtures/c601145-fixture.js";
import {
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { policy1451 } from "../../packages/video-subtitler/src/review/c6011451-policy.js";
import { buildFullRegistry1451 } from "../../packages/video-subtitler/src/review/c6011451-registry.js";
import { buildReviewDeliveryBinding1451 } from "../../packages/video-subtitler/src/review/c6011451-review-delivery-binding.js";
import {
  buildEffectiveRealizations1451,
  buildInheritedRealizations1451,
  buildWitnessGroups1451,
} from "../../packages/video-subtitler/src/review/c6011451-realizations.js";
import { evaluateProductComponent1451 } from "../../packages/video-subtitler/src/review/c6011451-contract-evaluation.js";

describe("C6.0.1.14.5.1 replay-only Full Registry flow", () => {
  it("binds an existing review delivery through Unit, realization, witness, and product evaluation", () => {
    const fixture = fixture145(),
      policy = policy1451(),
      emptyTargets = hashed141({
        targets: [],
      }) as unknown as shared.ReviewTargets145,
      emptyAudio = hashed141({
        audio: [],
      }) as unknown as shared.ReviewAudio145,
      registryBuild = buildFullRegistry1451({
        policy,
        inventory: fixture.inventory,
        hierarchy: fixture.hierarchy,
        planningUnits: fixture.units145,
        planner: fixture.planner145,
        reviewTargets: emptyTargets,
        reviewAudio: emptyAudio,
      }),
      unit = required141(
        registryBuild.registry.units.find(
          (row) =>
            row.coreUnionSeconds >= policy.machineAnchorMinimumOverlapSeconds,
        ),
        "C6011451_E2E_REQUIRES_ANCHORABLE_FULL_UNIT",
      ),
      interval = unit.envelopeInterval,
      sourceInterval = {
        start: interval.startSample / unit.sourceIdentity.sampleRate,
        end: interval.endSample / unit.sourceIdentity.sampleRate,
      },
      targetId = "e2e-required-speech-target",
      regionId = "e2e-review-region",
      audioId = "e2e-review-audio",
      playbackSegmentId = "e2e-playback-segment",
      targets = hashed141({
        targets: [
          {
            reviewTargetId: targetId,
            targetType: "ORPHAN_SPEECH_TARGET",
            atomicTargetCoreIntervals: unit.atomicNativeIntervals,
            nativeInterval: interval,
            evidenceIds: unit.evidenceObservationIds,
            inventoryIntervalIds: unit.evidenceObservationIds,
            childUnitIds: unit.childUnitIds,
            sourceIdentity: unit.sourceIdentity,
          },
        ],
      }) as unknown as shared.ReviewTargets145,
      regions = hashed141({
        regions: [
          {
            regionId,
            reviewTargetIds: [targetId],
            nativeSourceIntervals: unit.atomicNativeIntervals,
            playbackIntervals: [sourceInterval],
            sourceIdentity: unit.sourceIdentity,
          },
        ],
      }) as unknown as shared.ReviewRegions145,
      audio = hashed141({
        audio: [
          {
            audioId,
            coveredReviewTargetIds: [targetId],
            regionIds: [regionId],
            nativeSourceInterval: interval,
            playable: true,
            physicalMetadataVerified: true,
            hashVerified: true,
            sourceIdentity: unit.sourceIdentity,
          },
        ],
      }) as unknown as shared.ReviewAudio145,
      playback = hashed141({
        segments: [
          {
            playbackSegmentId,
            reviewTargetIds: [targetId],
            audioId,
            sourceInterval,
            sourceIdentity: unit.sourceIdentity,
          },
        ],
      }) as unknown as shared.ReviewPlayback145,
      binding = buildReviewDeliveryBinding1451({
        policy,
        registry: registryBuild.registry,
        targets,
        regions,
        audio,
        playback,
      }),
      inherited = buildInheritedRealizations1451({
        policy,
        registry: registryBuild.registry,
        binding,
        targets,
        regions,
        audio,
        playback,
      }),
      effective = buildEffectiveRealizations1451({
        policy,
        registry: registryBuild.registry,
        compatibility: registryBuild.compatibility,
        binding,
        inherited,
        planner: fixture.planner145,
        realizations: fixture.realizations145,
        targets,
        audio,
      }),
      witnesses = buildWitnessGroups1451({
        policy,
        registry: registryBuild.registry,
        effective,
      }),
      evaluation = evaluateProductComponent1451({
        policy,
        registry: registryBuild.registry,
        binding,
        effective,
        witnesses,
        component: {
          errorComponentId: "e2e-missing-dialogue",
          sourceIdentity: unit.sourceIdentity,
          labels: ["MISSING_DIALOGUE"],
          defectIds: [],
          alignmentIds: [],
          coveredItemIds: [],
          coveredRegionIds: [],
          errorIntervals: unit.atomicSourceIntervals,
          mappingStatus: "RESOLVED",
          mappingReasons: [],
        },
        mode: "FULL",
      });

    expect(registryBuild.registry.runtimeGoldInputCount).toBe(0);
    expect(registryBuild.registry.registeredVerifiedSpeechCoverageRatio).toBe(
      1,
    );
    expect(binding.unitBindingRequiredTargetCount).toBe(1);
    expect(binding.requiredTargetBoundCount).toBe(1);
    expect(binding.requiredTargetUnboundCount).toBe(0);
    expect(inherited.inheritedTargetRealizationCount).toBeGreaterThan(0);
    expect(effective.effectiveProductRealizationCount).toBeGreaterThan(0);
    expect(witnesses.witnessGroupCount).toBeGreaterThan(0);
    expect(evaluation.status).toBe("SCORABLE_SINGLE_UNIT_PASS");
    expect(evaluation.productContractPassed).toBe(true);
  });
});
