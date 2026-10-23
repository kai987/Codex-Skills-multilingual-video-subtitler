import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { freeze1452Schema, shareableAudit1452Schema } from "@mvl/shared";
import { hashed141 } from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { policy1452 } from "../../packages/video-subtitler/src/review/c6011452-policy.js";
import {
  routeFromGates1452,
  type RouteGates1452,
} from "../../packages/video-subtitler/src/review/c6011452-determinacy.js";

const source = {
  sourceMediaSha256: "a".repeat(64),
  durationSeconds: 30,
  sampleRate: 48_000,
  audioStreamIndex: 0,
  audioTimebase: "1/48000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
};
const hash = "b".repeat(64);

describe("C6.0.1.14.5.2 replay-only product-scorability flow", () => {
  it("orders the machine stages before freeze without a model execution path", async () => {
    const runner = await readFile(
      path.resolve("scripts/run-c6-0-1-14-5-2-machine.ts"),
      "utf8",
    );
    const stages = [
      "const orphanAudit = auditDegenerateOrphans1452",
      "eligibility = reconcileDegenerateEligibility1452",
      "candidateLedger = buildRealizationCandidates1452",
      "inheritedV2 = buildInheritedRealizations1452",
      "effectiveV2 = buildEffectiveRealizations1452",
      "connectivity = buildWitnessConnectivity1452",
      "witnessesV2 = buildWitnessGroups1452",
      "determinacyPreflight = buildDeterminacyPreflight1452",
      "freezeA = buildFreeze",
    ];
    const positions = stages.map((stage) => runner.indexOf(stage));
    expect(positions.every((position) => position >= 0)).toBe(true);
    for (let index = 1; index < positions.length; index++)
      expect(positions[index]).toBeGreaterThan(positions[index - 1] ?? -1);
    expect(runner).toContain("C6011452_ONLY_REPLAY_ONLY_IS_AUTHORIZED");
    expect(runner).toContain("inferenceCount: 0");
    expect(runner).toContain("modelLoadCount: 0");
    expect(runner).toContain("providerProcessStartCount: 0");
  });

  it("durably records the Gold barrier before any Gold identity read", async () => {
    const evaluator = await readFile(
      path.resolve("scripts/evaluate-c6-0-1-14-5-2.ts"),
      "utf8",
    );
    const receiptWrite = evaluator.indexOf(
        '"c6-0-1-14-5-2-first-gold-read-audit.json"',
      ),
      goldIdentityRead = evaluator.indexOf(
        "goldBefore = await identity141(goldPath)",
      );
    expect(receiptWrite).toBeGreaterThan(0);
    expect(goldIdentityRead).toBeGreaterThan(receiptWrite);
    expect(evaluator).toContain("machineStageGoldPathReadCount: 0");
    expect(evaluator).toContain("machineStageGoldDerivedArtifactReadCount: 0");
  });

  it("fails schema validation if a machine freeze reports new inference", () => {
    const policy = policy1452(),
      valid = hashed141({
        schemaVersion: "1.0.0",
        policyVersion: policy.policyVersion,
        policyHash: policy.semanticHash,
        sourceIdentity: source,
        sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
        runtimeGoldInputCount: 0,
        visibility: "LOCAL_ONLY",
        artifactType: "c6-0-1-14-5-2-machine-scorability-playback-freeze",
        baselineReplayHash: hash,
        geometryFreezeHash: hash,
        degenerateAuditHash: hash,
        degenerateEligibilityHash: hash,
        realizationCandidateLedgerHash: hash,
        inheritedRealizationV2Hash: hash,
        realizationComparisonHash: hash,
        effectiveRealizationRegistryV2Hash: hash,
        witnessConnectivityHash: hash,
        witnessGroupV2Hash: hash,
        determinacyPolicyHash: hash,
        determinacyPreflightHash: hash,
        reviewDeliveryHashes: { targets: hash },
        mandatoryPlanHash: hash,
        projectionHashes: { reviewDelivery: hash },
        nestedPreflightHash: hash,
        detectorReplaySummary: { expected: 18, hits: 18, misses: 0 },
        asrReplaySummary: { expected: 44, hits: 44, misses: 0 },
        runtimeGoldInputBeforeFreeze: 0,
        inferenceCount: 0,
        modelLoadCount: 0,
        providerProcessStartCount: 0,
        canonicalTextHash: hash,
        canonicalTimingHash: hash,
        presentationHash: hash,
        freezeCompletedAt: "2026-09-02T00:00:00.000Z",
        finalRole: "A",
      });
    expect(freeze1452Schema.parse(valid).inferenceCount).toBe(0);
    expect(() =>
      freeze1452Schema.parse({
        ...valid,
        inferenceCount: 1,
      }),
    ).toThrow();
  });

  it("keeps quality on HOLD even after the determinacy engineering gate passes", () => {
    const gates: RouteGates1452 = {
      integrity: true,
      degenerateEligibility: true,
      remainingRequiredTargetBinding: true,
      candidateEnumeration: true,
      inheritedPlaybackRealization: true,
      effectiveRealizationRegistry: true,
      witnessGroupConnectivity: true,
      witnessSearch: true,
      productOutcomeDeterminacy: true,
      finalInventoryTargetCoverage: false,
      physicalAudioPlaybackCoverage: false,
      safetyBudgets: true,
      productQuality: false,
    };
    expect(routeFromGates1452(gates)).toBe(
      "HOLD_FOR_REMAINING_INVENTORY_TO_TARGET_COVERAGE_REPAIR",
    );
  });

  it("routes a fully satisfied product graph only to ranker recalibration", () => {
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
      ].map((name) => [name, true]),
    ) as unknown as RouteGates1452;
    expect(routeFromGates1452(gates)).toBe(
      "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
    );
  });

  it("keeps the shareable audit fail-closed", () => {
    const safe = hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-5-2-shareable-audit",
      auditedFileCount: 1,
      absolutePathLeakCount: 0,
      secretLeakCount: 0,
      goldLeakCount: 0,
      brokenRelativeReferenceCount: 0,
      passed: true,
    });
    expect(shareableAudit1452Schema.parse(safe).passed).toBe(true);
    expect(() =>
      shareableAudit1452Schema.parse({
        ...safe,
        absolutePathLeakCount: 1,
        passed: false,
      }),
    ).toThrow();
  });
});
