import { describe, expect, it } from "vitest";
import { planner145Schema, policy145Schema, route145Schema } from "@mvl/shared";
import { fixture145 } from "./fixtures/c601145-fixture.js";
import { hashed141 } from "../packages/video-subtitler/src/review/c601141-policy.js";

describe("C6.0.1.14.5 safety coverage units and review contract", () => {
  it("freezes a replay-only, Gold-free product contract", () => {
    const fixture = fixture145();
    expect(fixture.policy145.maximumInferenceCount).toBe(0);
    expect(fixture.policy145.maximumModelLoadCount).toBe(0);
    expect(fixture.policy145.goldFeaturesAllowed).toBe(false);
    expect(fixture.contractPolicy145.frozenPreGold).toBe(true);
    expect(fixture.contractPolicy145.productGoContract).toBe(
      "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
    );
    expect(() =>
      policy145Schema.parse({
        ...fixture.policy145,
        maximumInferenceCount: 1,
      }),
    ).toThrow();
  });

  it("uses stable source-native connected components as coverage units", () => {
    const fixture = fixture145();
    expect(fixture.units145.sourceOrdered).toBe(true);
    expect(fixture.units145.intervalIntegrityPassed).toBe(true);
    expect(fixture.units145.childPartitionIndependent).toBe(true);
    expect(
      fixture.units145.units.every((row) => row.coreUnionSamples > 0),
    ).toBe(true);
    expect(
      new Set(fixture.units145.units.map((row) => row.coverageUnitId)).size,
    ).toBe(fixture.units145.coverageUnitCount);
  });

  it("proves 1/3/10 child segmentation invariance", () => {
    const probe = fixture145().segmentation145.syntheticProbe;
    expect(probe.childPartitionCounts).toEqual([1, 3, 10]);
    expect(new Set(probe.coverageUnitIds).size).toBe(1);
    expect(new Set(probe.unitUtilityVectors.map(JSON.stringify)).size).toBe(1);
    expect(
      new Set(probe.plannerContributionVectors.map(JSON.stringify)).size,
    ).toBe(1);
    expect(probe.newUnitIdInvariant).toBe(true);
    expect(probe.newUnitUtilityInvariant).toBe(true);
    expect(probe.newPlannerContributionInvariant).toBe(true);
  });

  it("does not use Atom, Child, Bundle, Gold, raw text, or exact timestamp counts as utility", () => {
    const fixture = fixture145();
    expect(fixture.unitUtility145.atomCountFeatureCount).toBe(0);
    expect(fixture.unitUtility145.childCountFeatureCount).toBe(0);
    expect(fixture.unitUtility145.bundleCountFeatureCount).toBe(0);
    expect(fixture.unitUtility145.goldFeatureCount).toBe(0);
    expect(fixture.unitUtility145.segmentationDependentUnitUtilityCount).toBe(
      0,
    );
    expect(fixture.unitUtility145.utilityGatePassed).toBe(true);
  });

  it("materializes both core-complete and anchored-playback realizations with Pareto pruning", () => {
    const fixture = fixture145();
    expect(fixture.realizations145.candidateCount).toBeGreaterThan(0);
    expect(fixture.realizations145.coreCompleteCandidateCount).toBeGreaterThan(
      0,
    );
    expect(
      fixture.realizations145.anchoredPlaybackCandidateCount,
    ).toBeGreaterThan(0);
    expect(
      fixture.realizationDominance145.retainedCount +
        fixture.realizationDominance145.dominatedCount,
    ).toBe(fixture.realizationDominance145.candidateCount);
    expect(fixture.realizationDominance145.strictCostDominanceOnly).toBe(true);
  });

  it("returns a complete exact plan within all 24/60/95 percent budgets", () => {
    const fixture = fixture145();
    expect(fixture.planner145.searchComplete).toBe(true);
    expect(fixture.planner145.feasibilityStatus).toBe("FEASIBLE");
    expect(fixture.planner145.objectiveNonDegradation).toBe(true);
    expect(fixture.planner145.activeBundleCount).toBeLessThanOrEqual(24);
    expect(fixture.planner145.speechCoreUnionSeconds).toBeLessThanOrEqual(60);
    expect(
      fixture.planner145.predictedFullQueueEpisodeRatio,
    ).toBeLessThanOrEqual(0.95);
    expect(fixture.planner145.phaseAObligationCoverage).toBe(1);
    expect(fixture.planner145.phaseARegressionCount).toBe(0);
  });

  it("rejects an over-budget planner certificate", () => {
    const fixture = fixture145();
    expect(() =>
      planner145Schema.parse({ ...fixture.planner145, activeBundleCount: 25 }),
    ).toThrow();
    expect(() =>
      planner145Schema.parse({
        ...fixture.planner145,
        speechCoreUnionSeconds: 60.01,
      }),
    ).toThrow();
  });

  it("binds selected safety targets to Unit and realization provenance", () => {
    const fixture = fixture145(),
      selected = new Set(fixture.planner145.selectedCoverageUnitIds),
      projected = new Set(
        fixture.safety145.targets.flatMap((target) => target.coverageUnitIds),
      );
    expect([...selected].every((unitId) => projected.has(unitId))).toBe(true);
    expect(fixture.safety145.targets.length).toBeGreaterThan(0);
    expect(fixture.safety145.wholeEpisodeCatchAllCount).toBe(0);
  });

  it("keeps individually-feasible Child count diagnostic-only in the route schema", () => {
    const fixture = fixture145(),
      route = route145Schema.parse(
        hashed141({
          schemaVersion: "1.0.0",
          policyVersion: fixture.policy145.policyVersion,
          policyHash: fixture.policy145.semanticHash,
          sourceIdentity: fixture.units145.sourceIdentity,
          sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
          visibility: "LOCAL_ONLY",
          artifactType: "c6-0-1-14-5-route-decision",
          runtimeGoldInputCount: 1,
          evaluationHash: "a".repeat(64),
          productGoContract: fixture.policy145.productGoContract,
          route: "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
          gates: [{ name: "PRODUCT_CONTRACT", passed: true }],
          advisories: [],
          blockingReasons: [],
          individuallyFeasibleUnselectedChildCount: 99,
          individuallyFeasibleChildDiagnosticOnly: true,
          forcedFeasibleUnselectedGateRemoved: true,
          machineOnlyReleaseAuthorized: false,
          productionStatus: "needs-review",
          finalizationMethod: "none",
          c602Status: "HOLD",
        }),
      );
    expect(route.route).toBe("GO_C6_0_1_15_REGION_RANKER_RECALIBRATION");
    expect(route.individuallyFeasibleUnselectedChildCount).toBe(99);
  });
});
