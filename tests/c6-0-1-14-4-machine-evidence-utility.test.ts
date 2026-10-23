import { describe, expect, it } from "vitest";
import {
  atomUtility144Schema,
  planner144Schema,
  safetyTargets144Schema,
  utilityPolicy144Schema,
  type ReviewAudio144,
  type ReviewPlayback144,
} from "@mvl/shared";
import { fixture144 } from "./fixtures/c601144-fixture.js";
import { candidateFixture142 as candidate } from "./fixtures/c601142-fixture.js";
import { policy144 } from "../packages/video-subtitler/src/review/c601144-policy.js";
import { auditLegacyPriority144 } from "../packages/video-subtitler/src/review/c601144-utility.js";
import { decideRoute144 } from "../scripts/lib/c601144-post-freeze-evaluation.js";
import {
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";

function precisionFixture() {
  const required = Array.from({ length: 23 }, (_, index) =>
    candidate(`required-${index}`, 20 + index * 20, 21 + index * 20, {
      priority: 0,
    }),
  );
  const longSingleFamily = candidate("long-single", 600, 605, {
    priority: 0,
  });
  const shortPyannote = candidate("short-pyannote", 700, 700.5, {
    priority: 0,
  });
  const shortSilero = candidate("short-silero", 700, 700.5, {
    priority: 0,
    detectorFamilies: ["SILERO"],
    independentFamilies: ["SILERO"],
    evidenceStratum: "SILERO_EXCLUSIVE",
    observationIds: ["observation-short-silero"],
    evidenceIds: ["evidence-short-silero"],
    requestIds: ["request-short-silero"],
  });
  return fixture144(
    [...required, longSingleFamily, shortPyannote, shortSilero],
    required.map((_, index) => index),
  );
}

describe("C6.0.1.14.4 machine evidence utility", () => {
  it("keeps every utility feature machine-only and Gold-free", () => {
    const policy = policy144();
    expect(policy.executionPolicy).toBe("replay-only");
    expect(policy.maximumInferenceCount).toBe(0);
    expect(policy.rawRecognizedTextAllowed).toBe(false);
    expect(policy.goldFeaturesAllowed).toBe(false);
    expect(() =>
      utilityPolicy144Schema.parse({ ...policy, goldFeaturesAllowed: true }),
    ).toThrow();
  });

  it("reproduces all-zero legacy priority but creates nonzero speech utility", () => {
    const parts = [
        candidate("zero-a", 20, 21, { priority: 0 }),
        candidate("zero-b", 40, 41, { priority: 0 }),
      ],
      fixture = fixture144(parts, [0]),
      audit = auditLegacyPriority144({
        policy: fixture.utilityPolicy,
        candidates: parts,
        hierarchy: fixture.hierarchy,
        bundles: fixture.bundles,
        planner: fixture.legacy,
      });
    expect(audit.candidatePriorityNonzeroCount).toBe(0);
    expect(audit.atomMachinePriorityNonzeroCount).toBe(0);
    expect(audit.allZeroPriorityAtAtomLayer).toBe(true);
    expect(fixture.atoms.positiveEvidenceZeroUtilityCount).toBe(0);
    expect(
      fixture.atoms.rows
        .filter((row) => row.utilityEligibility)
        .every((row) => row.speechEvidenceUtilityVector.some(Boolean)),
    ).toBe(true);
    expect(
      fixture.atoms.rows.every(
        (row) => row.textCandidateUtilityVector[0] === 0,
      ),
    ).toBe(true);
  });

  it("counts independent detector families, not profiles of one detector", () => {
    const pyannoteA = candidate("same-a", 20, 20.5, {
        distinctPcmViewIds: ["view-a", "view-b"],
      }),
      pyannoteB = candidate("same-b", 20, 20.5, {
        observationIds: ["observation-same-b"],
        evidenceIds: ["evidence-same-b"],
        requestIds: ["request-same-b"],
        distinctPcmViewIds: ["view-c"],
      }),
      same = fixture144([pyannoteA, pyannoteB], []),
      row = required141(
        same.atoms.rows.find((atom) => atom.utilityEligibility),
      );
    expect(row.independentEvidenceFamilies).toEqual(["PYANNOTE"]);
    expect(row.speechEvidenceTier).not.toBe(
      "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
    );
  });

  it("assigns multi-family localized speech a higher tier than a long single-family child", () => {
    const fixture = precisionFixture(),
      optional = fixture.children.rows
        .filter(
          (row) =>
            !required141(
              fixture.hierarchy.children.find(
                (child) => child.childUnitId === row.childUnitId,
              ),
            ).obligationIds.length,
        )
        .sort(
          (a, b) =>
            a.verifiedSpeechCoreUnionSeconds - b.verifiedSpeechCoreUnionSeconds,
        );
    expect(required141(optional[0]).highestSpeechEvidenceTier).toBe(
      "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
    );
    expect(required141(optional[1]).highestSpeechEvidenceTier).toBe(
      "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
    );
    expect(required141(optional[1]).cappedDurationUtility).toBe(5);
  });

  it("selects short Tier-5 evidence over the longer lower-tier alternative at the 24-slot boundary", () => {
    const fixture = precisionFixture(),
      optional = fixture.children.rows.filter(
        (row) =>
          !required141(
            fixture.hierarchy.children.find(
              (child) => child.childUnitId === row.childUnitId,
            ),
          ).obligationIds.length,
      ),
      short = required141(
        optional.find(
          (row) =>
            row.highestSpeechEvidenceTier ===
            "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
        ),
      ),
      long = required141(
        optional.find(
          (row) =>
            row.highestSpeechEvidenceTier ===
            "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
        ),
      );
    expect(fixture.legacy.selectedChildIds).toContain(long.childUnitId);
    expect(fixture.legacy.selectedChildIds).not.toContain(short.childUnitId);
    expect(fixture.planner.selectedOptionalChildIds).toEqual([
      short.childUnitId,
    ]);
    expect(fixture.planner.activeBundleCount).toBe(24);
    expect(fixture.planner.coreUnionSeconds).toBeLessThanOrEqual(60);
    expect(fixture.planner.predictedFullQueueEpisodeRatio).toBeLessThanOrEqual(
      0.95,
    );
    expect(fixture.planner.objectiveNonDegradation).toBe(true);
  });

  it("records exact forced inclusion witnesses and explicit optional-child reasons", () => {
    const fixture = precisionFixture();
    expect(fixture.forced.searchIncompleteCount).toBe(0);
    expect(fixture.forced.evaluatedChildren).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          searchComplete: true,
          feasibility: "FEASIBLE",
          obligationCoveragePreserved: true,
          hardConstraintsPreserved: true,
        }),
      ]),
    );
    const unselected = required141(
      fixture.optional.entries.find((entry) => !entry.utilityPlannerSelected),
    );
    expect(unselected.minimumTargetSlotCost).toBe(1);
    expect(unselected.minimumCoreCostSamples).toBeGreaterThan(0);
    expect(unselected.minimumAudioCostSamples).toBeGreaterThan(0);
    expect(unselected.utilityRank).toBeGreaterThan(0);
    expect(unselected.unselectedReason).toBe(
      "UTILITY_PLANNER_SELECTED_HIGHER_LEXICOGRAPHIC_PLAN",
    );
    expect(
      unselected.counterfactualReplacementBundleIds.length,
    ).toBeGreaterThan(0);
  });

  it("propagates every positive evidence row without a silent drop", () => {
    const fixture = fixture144();
    expect(fixture.propagation.positiveEvidenceRows).toBe(
      fixture.atoms.positiveEvidenceAtomCount,
    );
    expect(fixture.propagation.silentUtilityLossCount).toBe(0);
    expect(fixture.propagation.droppedBetweenEvidenceAndAtom).toBe(0);
    expect(fixture.propagation.droppedBetweenAtomAndChild).toBe(0);
    expect(fixture.propagation.droppedBetweenChildAndBundle).toBe(0);
  });

  it("fails closed when an eligible positive atom is manually zeroed", () => {
    const fixture = fixture144(),
      index = fixture.atoms.rows.findIndex((row) => row.utilityEligibility),
      source = required141(fixture.atoms.rows[index]),
      zero = hashed141({
        ...source,
        speechEvidenceUtilityVector: Array(8).fill(0),
        reviewSafetyUtilityVector: Array(10).fill(0),
      });
    expect(() =>
      atomUtility144Schema.parse({
        ...fixture.atoms,
        rows: fixture.atoms.rows.map((row, rowIndex) =>
          rowIndex === index ? zero : row,
        ),
      }),
    ).toThrow(/nonzero/u);
  });

  it("rejects over-budget planner and Safety V4 shapes", () => {
    const fixture = fixture144();
    expect(() =>
      planner144Schema.parse({
        ...fixture.planner,
        activeBundleCount: 25,
      }),
    ).toThrow();
    expect(() =>
      safetyTargets144Schema.parse({
        ...fixture.safety,
        targets: Array.from({ length: 25 }, () => fixture.safety.targets[0]),
      }),
    ).toThrow();
  });
});

function passingAudio(): ReviewAudio144 {
  return {
    audioExtractionFailureCount: 0,
    plannedAudioCount: 1,
    actualAudioCount: 1,
    playableAudioCount: 1,
    hashVerifiedAudioCount: 1,
  } as ReviewAudio144;
}
function passingPlayback(): ReviewPlayback144 {
  return {
    playbackToAudioCoverageRatio: 1,
    playbackToTargetCoverageRatio: 1,
  } as ReviewPlayback144;
}
function finalMetric() {
  const full = { numerator: 1, denominator: 1, ratio: 1 };
  return {
    missingInventory: full,
    missingTarget: full,
    missingPhysicalAudio: full,
    missingPlaybackAudible: full,
    hallucinationPlaybackAudible: full,
  } as never;
}

describe("C6.0.1.14.4 route semantics", () => {
  it("routes a forced-feasible unselected high-utility child to selection repair", () => {
    const fixture = precisionFixture(),
      route = decideRoute144({
        engineeringPassed: true,
        integrityPassed: true,
        propagation: fixture.propagation,
        childUtility: fixture.children,
        optional: fixture.optional,
        forced: fixture.forced,
        planner: fixture.planner,
        comparison: fixture.comparison,
        safety: fixture.safety,
        audio: passingAudio(),
        playback: passingPlayback(),
        finalMetric: finalMetric(),
      });
    expect(route.finalTargetSelectionGate).toBe(false);
    expect(route.route).toBe(
      "HOLD_FOR_MACHINE_EVIDENCE_UTILITY_SELECTION_REPAIR",
    );
  });

  it("never labels incomplete search as budget infeasibility", () => {
    const fixture = fixture144(),
      route = decideRoute144({
        engineeringPassed: true,
        integrityPassed: true,
        propagation: fixture.propagation,
        childUtility: fixture.children,
        optional: fixture.optional,
        forced: {
          ...fixture.forced,
          searchIncompleteCount: 1,
        },
        planner: { ...fixture.planner, searchComplete: false },
        comparison: fixture.comparison,
        safety: fixture.safety,
        audio: passingAudio(),
        playback: passingPlayback(),
        finalMetric: finalMetric(),
      });
    expect(route.route).toBe("HOLD_FOR_PLANNER_SEARCH_COMPLETENESS");
    expect(route.route).not.toBe("HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN");
  });

  it("holds review-audio delivery when targets lack playable output", () => {
    const fixture = fixture144(),
      selectedOptional = hashed141({
        ...fixture.optional,
        entries: fixture.optional.entries.map((entry) =>
          hashed141({
            ...entry,
            utilityPlannerSelected: true,
            selectedBundleId: entry.eligibleBundleIds[0] ?? "synthetic",
            unselectedReason: null,
          }),
        ),
        remainingHighUtilityUnselectedCount: 0,
      }),
      route = decideRoute144({
        engineeringPassed: true,
        integrityPassed: true,
        propagation: fixture.propagation,
        childUtility: fixture.children,
        optional: selectedOptional,
        forced: fixture.forced,
        planner: fixture.planner,
        comparison: fixture.comparison,
        safety: fixture.safety,
        audio: { ...passingAudio(), actualAudioCount: 0 },
        playback: passingPlayback(),
        finalMetric: finalMetric(),
      });
    expect(route.route).toBe("HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR");
  });
});
