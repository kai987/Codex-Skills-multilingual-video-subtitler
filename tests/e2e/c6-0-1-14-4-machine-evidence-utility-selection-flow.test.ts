import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  c60114MachineCoverageProjectionSchema,
  type Audio143,
} from "@mvl/shared";
import { fixture144 } from "../fixtures/c601144-fixture.js";
import { candidateFixture142 as candidate } from "../fixtures/c601142-fixture.js";
import { buildContinuity143 } from "../../packages/video-subtitler/src/review/c601143-monotonicity.js";
import { materializeSafety143 } from "../../packages/video-subtitler/src/review/c601143-final-planner.js";
import { compatibilityPlanner144 } from "../../packages/video-subtitler/src/review/c601144-planner.js";
import { buildReviewGraph143 } from "../../packages/video-subtitler/src/review/c601143-review-graph.js";
import {
  buildReviewDelivery143,
  verifyPhysicalAudio143,
} from "../../packages/video-subtitler/src/review/c601143-review-delivery.js";
import { projectReviewDelivery144 } from "../../packages/video-subtitler/src/review/c601144-review-delivery.js";
import { buildC60114ReviewAudio } from "../../packages/video-subtitler/src/review/review-audio-manifest-v3.js";
import { buildC60114PlaybackTimeline } from "../../packages/video-subtitler/src/review/review-playback-timeline-v2.js";
import {
  audioManifest142,
  playback142,
} from "../../packages/video-subtitler/src/review/c601142-review-delivery.js";
import { evaluateC60114PlaybackCoverage } from "../../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import { coverageAudio143 } from "../../scripts/lib/c601143-projections.js";
import {
  bytesHash141,
  wav141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

let root: string;
let sourcePath: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "c601144-e2e-"));
  sourcePath = path.join(root, "source.wav");
  await writeFile(sourcePath, wav141(Buffer.alloc(40 * 48000 * 2), 48000));
});
afterAll(async () => rm(root, { recursive: true, force: true }));

async function flow() {
  const sourceBytes = await readFile(sourcePath),
    source = {
      sourceMediaSha256: bytesHash141(sourceBytes),
      durationSeconds: 40,
      sampleRate: 48000,
      audioStreamIndex: 0,
      audioTimebase: "1/48000",
      sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
    },
    fixture = fixture144(
      [
        candidate("required-a", 20, 21, { priority: 0 }),
        candidate("required-b", 21.4, 22.4, { priority: 0 }),
        candidate("optional-high", 30, 31, { priority: 0 }),
      ],
      [0, 1],
      source,
    ),
    compatibilityPlanner = compatibilityPlanner144({
      legacyPlanner: fixture.legacy,
      selected: fixture.planned.selected,
      newPlanner: fixture.planner,
      legacyPolicy: fixture.policy,
    }),
    continuity = buildContinuity143({
      obligations: fixture.obligations,
      selected: fixture.planned.selected,
      hierarchy: fixture.hierarchy,
      policy: fixture.policy,
    }),
    compatibilitySafety = materializeSafety143({
      policy: fixture.policy,
      obligations: fixture.obligations,
      hierarchy: fixture.hierarchy,
      bundles: fixture.bundles,
      certificate: compatibilityPlanner,
      selected: fixture.planned.selected,
      continuity: continuity.ledger,
      monotonicity: continuity.monotonicity,
    }),
    graph = buildReviewGraph143({
      policy: fixture.policy,
      compatibilityPolicy: fixture.compatibilityPolicy,
      legacyPolicy: fixture.base.old.compatibilityPolicy,
      inventory: fixture.inventory,
      safety: compatibilitySafety,
      hierarchy: fixture.hierarchy,
      obligations: fixture.obligations,
      planner: compatibilityPlanner,
      continuity: continuity.ledger,
      frozenLexical: fixture.base.lexical,
      baselineTargets: fixture.base.old.baselineTargets,
      baselineItems: fixture.base.old.baselineItems,
      baselineRegions: fixture.base.old.baselineRegions,
      frozenR3Families: fixture.base.old.frozenR3Families,
    }),
    workspaceRoot = path.join(root, `workspace-${Date.now()}-${Math.random()}`),
    physical = await buildC60114ReviewAudio({
      sourcePath,
      sourceIdentity: source,
      policy: fixture.base.old.compatibilityPolicy,
      targets: graph.compatibility.compatibleTargets,
      regions: graph.compatibility.compatibleRegions,
      outputDirectory: workspaceRoot,
      generatedAt: "2026-01-01T00:00:00.000Z",
    }),
    legacyPlayback = buildC60114PlaybackTimeline({
      sourceIdentity: source,
      policy: fixture.base.old.compatibilityPolicy,
      targets: graph.compatibility.compatibleTargets,
      regions: graph.compatibility.compatibleRegions,
      audio: physical.manifest,
    }),
    audio = audioManifest142(
      physical.manifest,
      graph.compatibility.regions,
      fixture.compatibilityPolicy,
    ),
    playback = playback142({
      legacy: legacyPlayback,
      audio,
      regions: graph.compatibility.regions,
      targets: graph.compatibility.targets,
      policy: fixture.compatibilityPolicy,
    }),
    selectedChildren = fixture.hierarchy.children.filter((child) =>
      fixture.planner.selectedChildIds.includes(child.childUnitId),
    ),
    delivery = buildReviewDelivery143({
      legacyAudio: audio,
      legacyPlayback: playback,
      targets: graph.targets,
      regions: graph.regions,
      safety: compatibilitySafety,
      selectedChildren,
      policy: fixture.policy,
      planner: compatibilityPlanner,
    }),
    projected = projectReviewDelivery144({
      policy: fixture.utilityPolicy,
      safety: fixture.safety,
      planner: fixture.planner,
      targets: graph.targets,
      items: graph.items,
      regions: graph.regions,
      audio: delivery.audio,
      playback: delivery.playback,
    });
  return {
    source,
    fixture,
    continuity,
    graph,
    workspaceRoot,
    delivery,
    projected,
  };
}

describe("C6.0.1.14.4 replay-only utility delivery E2E", () => {
  it("propagates selected utility bundles through real WAV and final playback", async () => {
    const result = await flow();
    expect(result.fixture.atoms.positiveEvidenceZeroUtilityCount).toBe(0);
    expect(result.fixture.propagation.silentUtilityLossCount).toBe(0);
    expect(result.fixture.planner.searchComplete).toBe(true);
    expect(result.fixture.planner.obligationCoverageRatio).toBe(1);
    expect(result.continuity.monotonicity.monotonicityPassed).toBe(true);
    expect(result.projected.targets.targets.length).toBeGreaterThan(0);
    expect(
      result.projected.regions.regions.every((region) =>
        region.reviewTargetIds.every((targetId) =>
          result.projected.targets.targets.some(
            (target) => target.reviewTargetId === targetId,
          ),
        ),
      ),
    ).toBe(true);
    expect(result.projected.audio.audioExtractionFailureCount).toBe(0);
    expect(result.projected.audio.playableAudioCount).toBe(
      result.projected.audio.actualAudioCount,
    );
    expect(result.projected.playback.playbackToAudioCoverageRatio).toBe(1);
    expect(result.projected.playback.playbackToTargetCoverageRatio).toBe(1);
    await expect(
      verifyPhysicalAudio143(result.workspaceRoot, result.delivery.audio),
    ).resolves.toMatchObject({ allPassed: true });

    const projection = c60114MachineCoverageProjectionSchema.parse({
        sourceIdentity: result.source,
        items: result.projected.items.items.map((item) => ({
          reviewItemId: item.reviewItemId,
          sourceIdentity: result.source,
        })),
        targets: result.projected.targets.targets.map((target) => ({
          reviewTargetId: target.reviewTargetId,
          parentReviewItemId: target.parentReviewItemId,
          sourceInterval: target.sourceInterval,
          mandatoryForAudio: target.mandatoryForAudio,
          audioRequired: target.audioRequired,
          sourceIdentity: result.source,
        })),
        regions: result.projected.regions.regions.map((region) => ({
          regionId: region.regionId,
          reviewTargetIds: region.reviewTargetIds,
          reviewItemIds: region.reviewItemIds,
          sourceIntervals: region.sourceIntervals,
          contextIntervals: region.contextIntervals,
          sourceIdentity: result.source,
        })),
        physicalAudio: result.projected.audio.audio.map(coverageAudio143),
        playbackSegments: result.projected.playback.segments,
        plans: result.projected.playback.plans.map((plan) => ({
          planId: plan.planId,
          budgetSeconds: plan.budgetSeconds,
          regionIds: plan.regionIds,
          reviewTargetIds: plan.reviewTargetIds,
          playbackSegmentIds: plan.playbackSegmentIds,
        })),
        speechIslands: result.fixture.inventory.observations.map(
          (observation) => ({
            islandId: observation.observationId,
            sourceInterval: {
              start:
                observation.nativeInterval.startSample /
                result.source.sampleRate,
              end:
                observation.nativeInterval.endSample / result.source.sampleRate,
            },
            speechPositive: observation.speechPositive,
            localizationStatus: "VERIFIED",
            sourceIdentity: result.source,
          }),
        ),
        lexicalEvidence: [],
        orphans: [],
        lineageEvidence: [],
      }),
      optional = required141(
        result.fixture.hierarchy.children.find(
          (child) => !child.obligationIds.length,
        ),
      ),
      errorInterval = required141(optional.atomicSourceIntervals[0]),
      evaluation = evaluateC60114PlaybackCoverage({
        ...projection,
        generatedAt: "2026-01-01T00:00:00.000Z",
        errorComponents: [
          {
            errorComponentId: "synthetic-missing",
            labels: ["MISSING_DIALOGUE"],
            sourceIdentity: result.source,
            defectIds: ["synthetic-defect"],
            alignmentIds: ["synthetic-alignment"],
            coveredItemIds: [],
            coveredRegionIds: [],
            errorIntervals: [errorInterval],
            mappingStatus: "RESOLVED",
            mappingReasons: [],
          },
        ],
        engineeringGates: {
          engineeringPassed: true,
          baselineParityPassed: true,
          runtimeGoldInputCount: 0,
          canonicalMutationCount: 0,
          machineDraftMutationCount: 0,
          sourceMutationCount: 0,
          goldMutationCount: 0,
          machineFreezeVerified: true,
        },
      }),
      full = required141(
        evaluation.budgets.find(
          (budget) =>
            budget.planId === result.projected.playback.officialFullQueuePlan,
        ),
      ),
      component = required141(full.componentCoverage[0]);
    expect(component.layers.targetInterval.audible).toBe(true);
    expect(component.layers.physicalAudio.audible).toBe(true);
    expect(component.layers.audibleReviewCoverage.audible).toBe(true);
    expect(evaluation.integrityFailures).toEqual([]);
  });

  it("rejects target-to-WAV and WAV-to-playback breaks", async () => {
    const result = await flow(),
      emptyAudio = hashed141({
        ...result.delivery.audio,
        audio: [],
        summary: {
          ...result.delivery.audio.summary,
          plannedAudioCount: 0,
          actualAudioCount: 0,
          playableCount: 0,
          hashVerifiedCount: 0,
        },
      }) as Audio143;
    expect(() =>
      projectReviewDelivery144({
        policy: result.fixture.utilityPolicy,
        safety: result.fixture.safety,
        planner: result.fixture.planner,
        targets: result.graph.targets,
        items: result.graph.items,
        regions: result.graph.regions,
        audio: emptyAudio,
        playback: result.delivery.playback,
      }),
    ).toThrow(/PLAYBACK_SOURCE_MAPPING_INCOMPLETE/u);
  });

  it("rejects stale nested projection hashes before any Gold evaluation", async () => {
    const result = await flow(),
      first = required141(result.graph.targets.targets[0]),
      staleTargets = hashed141({
        ...result.graph.targets,
        targets: [
          { ...first, reviewTargetId: `${first.reviewTargetId}-stale` },
          ...result.graph.targets.targets.slice(1),
        ],
      });
    expect(() =>
      projectReviewDelivery144({
        policy: result.fixture.utilityPolicy,
        safety: result.fixture.safety,
        planner: result.fixture.planner,
        targets: staleTargets,
        items: result.graph.items,
        regions: result.graph.regions,
        audio: result.delivery.audio,
        playback: result.delivery.playback,
      }),
    ).toThrow(/SEMANTIC_HASH/u);
    expect(hash141(result.fixture.utilityPolicy)).not.toContain("gold");
  });
});
