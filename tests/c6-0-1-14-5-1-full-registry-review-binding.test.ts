import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type * as shared from "@mvl/shared";
import { shareableAudit1451Schema } from "@mvl/shared";
import { fixture145 } from "./fixtures/c601145-fixture.js";
import {
  hash141,
  hashed141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import { policy1451 } from "../packages/video-subtitler/src/review/c6011451-policy.js";
import { buildFullRegistry1451 } from "../packages/video-subtitler/src/review/c6011451-registry.js";
import { buildReviewDeliveryBinding1451 } from "../packages/video-subtitler/src/review/c6011451-review-delivery-binding.js";
import {
  evaluateProductComponent1451,
  routeFromGates1451,
  type RouteGates1451,
} from "../packages/video-subtitler/src/review/c6011451-contract-evaluation.js";
import { buildSafetyTargetsV5 } from "../packages/video-subtitler/src/review/c601145-unit-aware-planner.js";

const source = {
  sourceMediaSha256: "a".repeat(64),
  durationSeconds: 10,
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

function productFixture() {
  const unitRows = [
      { id: "unit-a", start: 0, end: 0.55, legacy: "legacy-a" },
      { id: "unit-b", start: 0.55, end: 1, legacy: "legacy-b" },
    ],
    registry = {
      sourceIdentity: source,
      units: unitRows.map((row) => ({
        fullCoverageUnitId: row.id,
        legacyPlanningCoverageUnitIds: [row.legacy],
        atomicNativeIntervals: [native(row.start, row.end)],
        atomicSourceIntervals: [seconds(row.start, row.end)],
        coreUnionSamples: Math.round((row.end - row.start) * source.sampleRate),
        envelopeInterval: native(row.start, row.end),
      })),
      semanticHash: hash141({ synthetic: "full-registry" }),
    } as unknown as shared.FullRegistry1451,
    targetBindings = unitRows.map((row) => ({
      bindingLedgerId: `target-binding-${row.id}`,
      targetId: `target-${row.id}`,
      productBindingEligible: true,
      fullCoverageUnitId: row.id,
      targetCoreIntervals: [native(row.start, row.end)],
    })),
    audioBindings = unitRows.map((row) => ({
      bindingLedgerId: `audio-binding-${row.id}`,
      audioId: `audio-${row.id}`,
      targetIds: [`target-${row.id}`],
      productBindingEligible: true,
      fullCoverageUnitId: row.id,
      actualSourceInterval: native(row.start, row.end),
    })),
    playbackBindings = unitRows.map((row) => ({
      bindingLedgerId: `playback-binding-${row.id}`,
      playbackSegmentId: `playback-${row.id}`,
      audioId: `audio-${row.id}`,
      targetIds: [`target-${row.id}`],
      productBindingEligible: true,
      fullCoverageUnitId: row.id,
      playbackSourceInterval: native(row.start, row.end),
    })),
    binding = {
      targetBindings,
      audioBindings,
      playbackBindings,
    } as unknown as shared.ReviewBinding1451,
    realizations = unitRows.map((row) => ({
      effectiveRealizationId: `realization-${row.id}`,
      fullCoverageUnitIds: [row.id],
      realizationOrigins: [
        "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION" as const,
      ],
      targetIds: [`target-${row.id}`],
      audioIds: [`audio-${row.id}`],
      playbackSegmentIds: [`playback-${row.id}`],
      atomicAnchorIntervals: [native(row.start, row.end)],
      anchorCoverageRatios: [1],
    })),
    effective = {
      realizations,
    } as unknown as shared.EffectiveRealizations1451,
    groups = [
      ...realizations.map((row) => ({
        witnessGroupId: `group-${row.effectiveRealizationId}`,
        realizationIds: [row.effectiveRealizationId],
        witnessEligibility: true,
      })),
      {
        witnessGroupId: "group-multi",
        realizationIds: realizations.map((row) => row.effectiveRealizationId),
        witnessEligibility: true,
      },
    ],
    witnesses = {
      groups,
      witnessSearchComplete: true,
    } as unknown as shared.WitnessGroups1451,
    component = {
      errorComponentId: "missing-synthetic",
      sourceIdentity: source,
      labels: ["MISSING_DIALOGUE" as const],
      defectIds: [],
      alignmentIds: [],
      coveredItemIds: [],
      coveredRegionIds: [],
      errorIntervals: [seconds(0, 1)],
      mappingStatus: "RESOLVED" as const,
      mappingReasons: [],
    };
  return { registry, binding, effective, witnesses, component };
}

describe("C6.0.1.14.5.1 full registry and product contract", () => {
  it("refreshes and freeze-binds the guarded review workspace asset", async () => {
    const runner = await readFile(
      path.resolve("scripts/run-c6-0-1-14-5-1-machine.ts"),
      "utf8",
    );
    expect(runner).toContain("refreshGuardedReviewJavascript");
    expect(runner).toContain("reviewJavascriptHash");
    expect(runner).toContain("if(state.data)render()");
  });

  it("keeps verified observations in the Full Registry even without an island row", () => {
    const fixture = fixture145(),
      emptyTargets = hashed141({
        targets: [],
      }) as unknown as shared.ReviewTargets145,
      emptyAudio = hashed141({ audio: [] }) as unknown as shared.ReviewAudio145,
      result = buildFullRegistry1451({
        policy: policy1451(),
        inventory: fixture.inventory,
        hierarchy: fixture.hierarchy,
        planningUnits: fixture.units145,
        planner: fixture.planner145,
        reviewTargets: emptyTargets,
        reviewAudio: emptyAudio,
      });
    expect(fixture.inventory.islands).toHaveLength(0);
    expect(result.registry.registeredVerifiedSpeechCoverageRatio).toBe(1);
    expect(result.registry.unregisteredVerifiedSpeechSamples).toBe(0);
    expect(result.reconciliation.unmappedVerifiedSpeechRowCount).toBe(0);
    expect(result.compatibility.unresolvedPlannerSelectedUnitMappings).toBe(0);
    expect(result.planningProjection.plannerObjectiveParity).toBe(true);
  });

  it("passes a deterministic two-Unit witness when neither Unit reaches 80 percent alone", () => {
    const fixture = productFixture(),
      result = evaluateProductComponent1451({
        policy: policy1451(),
        ...fixture,
        mode: "FULL",
      });
    expect(result.status).toBe("SCORABLE_MULTI_UNIT_PASS");
    expect(result.fullCoverageUnitIds).toEqual(["unit-a", "unit-b"]);
    expect(result.unitToGoldCoverageRatio).toBe(1);
    expect(result.playbackToGoldCoverageRatio).toBe(1);
    expect(result.minimumPlaybackCoverageOfUnitRatio).toBe(1);
  });

  it("does not mislabel a complete single-Unit threshold failure as unscorable", () => {
    const fixture = productFixture(),
      result = evaluateProductComponent1451({
        policy: policy1451(),
        ...fixture,
        mode: "SINGLE_UNIT_ONLY",
      });
    expect(result.status).toBe("SCORABLE_FAIL");
    expect(result.productContractPassed).toBe(false);
  });

  it("uses explicit no-target-binding scorability instead of numeric product failure", () => {
    const fixture = productFixture(),
      result = evaluateProductComponent1451({
        policy: policy1451(),
        ...fixture,
        binding: {
          ...fixture.binding,
          targetBindings: [],
        },
        mode: "FULL",
      });
    expect(result.status).toBe("NOT_SCORABLE_NO_TARGET_BINDING");
    expect(result.productContractPassed).toBe(false);
  });

  it("rejects a boundary-only speech Target rather than assigning a Unit ID", () => {
    const fixture = productFixture(),
      target = {
        reviewTargetId: "boundary-target",
        targetType: "ORPHAN_SPEECH_TARGET",
        atomicTargetCoreIntervals: [native(1, 1.1)],
        nativeInterval: native(1, 1.1),
        evidenceIds: ["evidence-boundary"],
        inventoryIntervalIds: [],
        childUnitIds: [],
        sourceIdentity: source,
      },
      result = buildReviewDeliveryBinding1451({
        policy: policy1451(),
        registry: fixture.registry,
        targets: hashed141({
          targets: [target],
        }) as unknown as shared.ReviewTargets145,
        regions: hashed141({
          regions: [],
        }) as unknown as shared.ReviewRegions145,
        audio: hashed141({ audio: [] }) as unknown as shared.ReviewAudio145,
        playback: hashed141({
          segments: [],
        }) as unknown as shared.ReviewPlayback145,
      });
    expect(result.targetBindings).toHaveLength(1);
    expect(result.targetBindings[0]?.bindingStatus).toBe(
      "REJECTED_ZERO_OVERLAP",
    );
    expect(result.targetBindings[0]?.fullCoverageUnitId).toBeNull();
    expect(result.targetUnitZeroOverlapRejectedCount).toBe(1);
  });

  it("fails closed when a selected Bundle has no Planner-selected Realization", () => {
    const fixture = fixture145(),
      planner = hashed141({
        ...fixture.planner145,
        selectedRealizationIds: [],
      });
    expect(() =>
      buildSafetyTargetsV5({
        policy: fixture.policy145,
        units: fixture.units145,
        unitUtility: fixture.unitUtility145,
        realizations: fixture.realizations145,
        planner,
        selected: fixture.selected145,
        contractLedgerHash: fixture.ledger145.semanticHash,
        sourceSafetyTargetsHash: hash141([]),
      }),
    ).toThrow("PLANNER_SELECTED_BUNDLE_WITHOUT_SELECTED_REALIZATION");
  });

  it("routes a Target-binding failure before later scorability and budget failures", () => {
    const gates: RouteGates1451 = {
      integrity: true,
      registry: true,
      compatibility: true,
      requiredTargetBinding: false,
      audioPlaybackBinding: true,
      plannerRealization: true,
      inheritedRealization: true,
      witnessGroups: true,
      witnessSearch: true,
      scorability: false,
      finalTargetCoverage: false,
      physicalAudioPlayback: false,
      safetyBudgets: false,
      productQuality: false,
    };
    expect(routeFromGates1451(gates)).toBe(
      "HOLD_FOR_REVIEW_DELIVERY_UNIT_BINDING_REPAIR",
    );
  });

  it("routes a fully complete 6-of-6 contract to ranker recalibration", () => {
    const gates = Object.fromEntries(
      [
        "integrity",
        "registry",
        "compatibility",
        "requiredTargetBinding",
        "audioPlaybackBinding",
        "plannerRealization",
        "inheritedRealization",
        "witnessGroups",
        "witnessSearch",
        "scorability",
        "finalTargetCoverage",
        "physicalAudioPlayback",
        "safetyBudgets",
        "productQuality",
      ].map((name) => [name, true]),
    ) as unknown as RouteGates1451;
    expect(routeFromGates1451(gates)).toBe(
      "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
    );
  });

  it("keeps the shareable audit aggregate-only and fail-closed", () => {
    const safe = hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-5-1-shareable-audit",
      visibility: "SHAREABLE_AUDIT",
      summaryHash: "b".repeat(64),
      pathPolicy: "NO_ABSOLUTE_OR_LOCAL_PATHS",
      aggregateOnly: true,
      absolutePathLeakCount: 0,
      secretFindingCount: 0,
      rawAudioReferenceCount: 0,
      dialogueTextFindingCount: 0,
      goldContentFindingCount: 0,
      credentialFindingCount: 0,
      passed: true,
    });
    expect(shareableAudit1451Schema.parse(safe).passed).toBe(true);
    expect(() =>
      shareableAudit1451Schema.parse({
        ...safe,
        sourcePath: "/Users/example/private.wav",
      }),
    ).toThrow();
    expect(() =>
      shareableAudit1451Schema.parse({
        ...safe,
        absolutePathLeakCount: 1,
        passed: false,
      }),
    ).toThrow();
  });
});
