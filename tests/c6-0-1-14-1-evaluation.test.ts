import { describe, it, expect } from "vitest";
import {
  c601141CoverageProjectionsSchema,
  c601141EvaluationAuditSchema,
  c601141FingerprintSchema,
  type C60114PlaybackCoverageInput,
} from "@mvl/shared";
import { fixture141 } from "./fixtures/c601141-fixture.js";
import {
  hashed141,
  header141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import { evaluateC60114PlaybackCoverage } from "../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import {
  route141,
  officialBudget141,
  evaluateInventory141,
} from "../packages/video-subtitler/src/review/c601141-evaluation.js";

function input141(): C60114PlaybackCoverageInput {
  const { source } = fixture141(),
    interval = { start: 10, end: 12 };
  return {
    sourceIdentity: source,
    generatedAt: "2026-01-01T00:00:00.000Z",
    items: [{ reviewItemId: "item", sourceIdentity: source }],
    targets: [
      {
        reviewTargetId: "target",
        parentReviewItemId: "item",
        sourceInterval: interval,
        mandatoryForAudio: false,
        audioRequired: true,
        sourceIdentity: source,
      },
    ],
    regions: [
      {
        regionId: "region",
        reviewTargetIds: ["target"],
        reviewItemIds: ["item"],
        sourceIntervals: [interval],
        contextIntervals: [interval],
        sourceIdentity: source,
      },
    ],
    physicalAudio: [
      hashed141({
        audioId: "audio",
        relativePath: "audio/synthetic.wav",
        sourceMediaSha256: source.sourceMediaSha256,
        sourceInterval: interval,
        requestedInterval: interval,
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        codec: "pcm_s16le",
        frameCount: 32000,
        actualDuration: 2,
        sha256: "b".repeat(64),
        playable: true,
        hashVerified: true,
        physicalMetadataVerified: true,
        coveredReviewTargetIds: ["target"],
        regionIds: ["region"],
        sourceIdentity: source,
      }),
    ],
    playbackSegments: [
      hashed141({
        playbackSegmentId: "segment",
        audioId: "audio",
        sourceInterval: interval,
        audioLocalInterval: { start: 0, end: 2 },
        reviewTargetIds: ["target"],
        reviewItemIds: ["item"],
        regionIds: ["region"],
        sourceIdentity: source,
      }),
    ],
    plans: [
      "FULL_QUEUE",
      "FULL_QUEUE_WITH_SAFETY_RESERVE",
      "FULL_QUEUE_CONSERVATIVE_SPEECH",
      "ALL_MANDATORY",
      ...[10, 20, 30, 40, 50].map((p) => `UNIQUE_AUDIO_${p}_PERCENT`),
    ].map((planId) => ({
      planId,
      budgetSeconds: null,
      regionIds: planId === "ALL_MANDATORY" ? [] : ["region"],
      reviewTargetIds: planId === "ALL_MANDATORY" ? [] : ["target"],
      playbackSegmentIds: planId === "ALL_MANDATORY" ? [] : ["segment"],
    })),
    speechIslands: [
      {
        islandId: "speech",
        sourceInterval: interval,
        speechPositive: true,
        localizationStatus: "VERIFIED",
        sourceIdentity: source,
      },
    ],
    lexicalEvidence: [],
    orphans: [],
    errorComponents: ["MISSING_DIALOGUE", "HALLUCINATION"].map((label) => ({
      errorComponentId: label,
      labels: [label as "MISSING_DIALOGUE" | "HALLUCINATION"],
      sourceIdentity: source,
      defectIds: [label],
      alignmentIds: [label],
      coveredItemIds: ["item"],
      coveredRegionIds: ["region"],
      errorIntervals: [interval],
      mappingStatus: "RESOLVED",
      mappingReasons: [],
    })),
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
  };
}
describe("C601141 frozen direct coverage and route semantics", () => {
  it("allows ranker-investigation GO with audible audio despite incomplete lexical and mandatory subsets", () => {
    const value = evaluateC60114PlaybackCoverage(input141()),
      route = route141({ evaluation: value, targetBudgetPassed: true });
    expect(officialBudget141(value).officialMissingRecall.covered).toBe(1);
    expect(route.primaryDecision).toBe(
      "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
    );
    expect(route.advisories.map((v) => v.diagnosis)).toContain(
      "LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE",
    );
    expect(route.machineOnlyReleaseAuthorized).toBe(false);
    expect(route.c602Status).toBe("HOLD");
    expect(route.humanTrialStarted).toBe(false);
  });
  it("never converts lineage or region membership into an audible coverage pass", () => {
    const data = input141();
    required141(data.errorComponents[0]).errorIntervals = [
      { start: 22, end: 24 },
    ];
    data.speechIslands = [];
    const evaluation = evaluateC60114PlaybackCoverage(data),
      full = officialBudget141(evaluation);
    expect(full.officialMissingRecall.covered).toBe(0);
    expect(
      full.componentCoverage.find((v) => v.labels.includes("MISSING_DIALOGUE"))
        ?.layers.itemLineage.covered,
    ).toBe(true);
    expect(
      route141({ evaluation, targetBudgetPassed: true }).primaryDecision,
    ).toBe("HOLD_FOR_MACHINE_SPEECH_DETECTION_MODEL_CEILING");
  });
  it("identifies selection rather than detector ceiling when detected speech is outside targets", () => {
    const data = input141();
    required141(data.errorComponents[0]).errorIntervals = [
      { start: 22, end: 24 },
    ];
    required141(data.speechIslands[0]).sourceInterval = { start: 22, end: 24 };
    expect(
      route141({
        evaluation: evaluateC60114PlaybackCoverage(data),
        targetBudgetPassed: true,
      }).primaryDecision,
    ).toBe("HOLD_FOR_SAFETY_RESERVE_SELECTION_REPAIR");
  });
  it("a plausible legacy or enhancement explanation needs explicit diagnostic evidence", () => {
    const data = input141();
    required141(data.errorComponents[0]).errorIntervals = [
      { start: 22, end: 24 },
    ];
    data.speechIslands = [];
    const evaluation = evaluateC60114PlaybackCoverage(data);
    expect(
      route141({
        evaluation,
        targetBudgetPassed: true,
        legacyUnresolvedComponentIds: ["MISSING_DIALOGUE"],
      }).primaryDecision,
    ).toBe("HOLD_FOR_LEGACY_PROVENANCE_RECOVERY");
    expect(
      route141({
        evaluation,
        targetBudgetPassed: true,
        enhancementSupportedComponentIds: ["MISSING_DIALOGUE"],
      }).primaryDecision,
    ).toBe("HOLD_FOR_DIALOGUE_ENHANCEMENT_SOURCE_SEPARATION_INVESTIGATION");
  });
  it("uses 80 percent physical playback, not one-frame overlap or missing audio metadata", () => {
    const data = input141();
    required141(data.errorComponents[0]).errorIntervals = [
      { start: 11.9, end: 13.9 },
    ];
    const value = evaluateC60114PlaybackCoverage(data);
    const layer = required141(
      officialBudget141(value).componentCoverage.find((v) =>
        v.labels.includes("MISSING_DIALOGUE"),
      ),
    ).layers.audibleReviewCoverage;
    expect(layer.any).toBe(true);
    expect(layer.audible).toBe(false);
    required141(data.physicalAudio[0]).hashVerified = false;
    expect(
      route141({
        evaluation: evaluateC60114PlaybackCoverage(data),
        targetBudgetPassed: true,
      }).evaluationIntegrityPassed,
    ).toBe(false);
  });
  it("over-budget or source mutation cannot pass even with perfect physical recall", () => {
    const data = input141();
    expect(
      route141({
        evaluation: evaluateC60114PlaybackCoverage(data),
        targetBudgetPassed: false,
      }).primaryDecision,
    ).toBe("HOLD_FOR_ENGINEERING_REPAIR");
    data.engineeringGates.sourceMutationCount = 1;
    expect(
      route141({
        evaluation: evaluateC60114PlaybackCoverage(data),
        targetBudgetPassed: true,
      }).primaryDecision,
    ).toBe("HOLD_FOR_EVALUATION_INTEGRITY_REPAIR");
  });
  it("strict pre-Gold projections reject labels, duplicate stages and omitted ablations", () => {
    const data = input141(),
      f = fixture141();
    const { generatedAt, errorComponents, engineeringGates, ...projection } =
      data;
    void generatedAt;
    void errorComponents;
    void engineeringGates;
    const artifact = hashed141({
      ...header141(f.policy, f.source),
      artifactType: "c6-0-1-14-1-machine-coverage-projections",
      variants: Array.from({ length: 10 }, (_, i) =>
        hashed141({
          stage: `A${i}`,
          description: "SYNTHETIC",
          projection,
          physicalAudioOrigin: "VERIFIED_C601141_FINAL",
        }),
      ),
      ablationChangesMachineSelection: false,
      newInferenceCount: 0,
      rankerRetrained: false,
    });
    expect(c601141CoverageProjectionsSchema.safeParse(artifact).success).toBe(
      true,
    );
    const result = evaluateInventory141({
      projections: c601141CoverageProjectionsSchema.parse(artifact),
      components: data.errorComponents,
      inventory: f.inventory,
      safety: f.safety,
      policy: f.policy,
      generatedAt: data.generatedAt,
      engineeringGates: data.engineeringGates,
      fingerprint: c601141FingerprintSchema.parse(
        hashed141({
          ...header141(f.policy, f.source),
          artifactType: "machine-legacy-audio-fingerprint-reconciliation",
          inputLineageHash: "a".repeat(64),
          viewsHash: "a".repeat(64),
          syntheticControlsHash: "a".repeat(64),
          entries: [],
          summary: {
            quarantinedEntryCount: 0,
            retainedClipCount: 0,
            uniqueSearchedClips: 0,
            searchedClipSeconds: 0,
            recoveredEntries: 0,
            ambiguousEntries: 0,
            noBytesEntries: 0,
            rejectedEntries: 0,
            lexicalEligibleEntries: 0,
          },
        }),
      ),
    });
    expect(result.variants).toHaveLength(10);
    expect(result.sourceContribution[0]?.directCoverage.physicalAudio).toBe(1);
    expect(result.sourceContribution[0]?.unresolvedHistoricalAttribution).toBe(
      "UNKNOWN_WITHOUT_VERIFIED_SOURCE_MAPPING",
    );
    expect(result.burden.nonOverlapMeansConfirmedFalsePositive).toBe(false);
    expect(
      c601141CoverageProjectionsSchema.safeParse({
        ...artifact,
        variants: artifact.variants.slice(1),
      }).success,
    ).toBe(false);
    expect(
      c601141CoverageProjectionsSchema.safeParse({
        ...artifact,
        variants: artifact.variants.map((v) => ({ ...v, stage: "A0" })),
      }).success,
    ).toBe(false);
    expect(
      c601141CoverageProjectionsSchema.safeParse({
        ...artifact,
        variants: artifact.variants.map((v) => ({
          ...v,
          projection: { ...projection, errorComponents: data.errorComponents },
        })),
      }).success,
    ).toBe(false);
    expect(
      c601141EvaluationAuditSchema.safeParse({ runtimeGoldInputCount: 1 })
        .success,
    ).toBe(false);
  });
});
