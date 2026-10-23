import { describe, it, expect } from "vitest";
import {
  contribution142Schema,
  scoreTrack142Schema,
  scoreTracks142Schema,
  projections142Schema,
  type Evaluation142,
} from "@mvl/shared";
import { coverageInput142 } from "./fixtures/c601142-evaluation-fixture.js";
import { fixture142 } from "./fixtures/c601142-review-fixture.js";
import {
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import { evaluateC60114PlaybackCoverage } from "../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import {
  route142,
  officialBudget142,
  scoreDiagnostics142,
  evaluate142,
} from "../packages/video-subtitler/src/review/c601142-evaluation.js";
import { assembleProjections142 } from "../scripts/lib/c601142-coverage-projection.js";
import { header142 } from "../packages/video-subtitler/src/review/c601142-policy.js";
const h = "a".repeat(64);
function contribution(
  diagnosis: Evaluation142["sourceContribution"][number]["primaryDiagnosis"],
) {
  return contribution142Schema.parse(
    hashed141({
      errorComponentId: "synthetic-MISSING_DIALOGUE",
      errorIntervals: [{ start: 22, end: 24 }],
      baselineAudible: false,
      selectionOnlyAudible: false,
      detectorOnlyAudible: false,
      finalAudible: false,
      finalFull: false,
      candidateIds: [],
      clusterIds: [],
      selectedTargetIds: [],
      maskingCandidateIds: [],
      detectorFamilies: [],
      localizedAsrRequestIds: [],
      directCoverage: {
        oldInventory: 0,
        oldSafety: 0,
        selectionOnlySafety: 0,
        newSilero: 0,
        newPyannote: 0,
        webRtc: 0,
        subthresholdMasked: 0,
        combinedInventory: 0,
        finalSafety: 0,
        physicalAudio: 0,
        playback: 0,
        localizedLexical: 0,
      },
      primaryDiagnosis: diagnosis,
      scoreDiagnostics: [],
      acousticDiagnostics: [],
      maskingDiagnosis: "INSUFFICIENT_EVIDENCE",
      manualListeningClaim: "NOT_CLAIMED_BY_AUTOMATED_EVALUATOR",
    }),
  );
}
const routeFor = (
  data = coverageInput142(),
  contributions: Evaluation142["sourceContribution"] = [],
) =>
  route142({
    evaluation: evaluateC60114PlaybackCoverage(data),
    contributions,
    targetBudgetPassed: true,
    fullQueueBurdenPassed: true,
    independentRuntimeAvailable: true,
  });
describe("C601142 frozen evaluation and coverage route", () => {
  it("permits only ranker-investigation GO despite incomplete lexical and mandatory subsets", () => {
    const route = routeFor();
    expect(route.primaryDecision).toBe(
      "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
    );
    expect(route.fullQueueGatePassed).toBe(true);
    expect(route.machineOnlyReleaseAuthorized).toBe(false);
    expect(route.c602Status).toBe("HOLD");
    expect(route.humanTrialStarted).toBe(false);
  });
  it.each([
    ["DETECTOR_MISS", "HOLD_FOR_MASKED_SPEECH_DETECTOR_CEILING"],
    ["SAFETY_TARGET_SELECTION_MISS", "HOLD_FOR_SAFETY_TARGET_SELECTION_REPAIR"],
    ["REVIEW_AUDIO_OMISSION", "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR"],
  ] as const)("separates %s from ranker calibration", (diagnosis, expected) => {
    const input = coverageInput142();
    required141(input.errorComponents[0]).errorIntervals = [
      { start: 22, end: 24 },
    ];
    expect(routeFor(input, [contribution(diagnosis)]).primaryDecision).toBe(
      expected,
    );
  });
  it("a parent or lineage hit cannot replace 80 percent actual target playback", () => {
    const input = coverageInput142();
    required141(input.errorComponents[0]).errorIntervals = [
      { start: 11.9, end: 13.9 },
    ];
    const full = officialBudget142(evaluateC60114PlaybackCoverage(input));
    expect(full.officialMissingRecall.covered).toBe(0);
    const row = required141(
      full.componentCoverage.find((c) => c.labels.includes("MISSING_DIALOGUE")),
    );
    expect(row.layers.itemLineage.covered).toBe(true);
    expect(row.layers.audibleReviewCoverage.any).toBe(true);
    expect(row.layers.audibleReviewCoverage.audible).toBe(false);
    expect(routeFor(input).fullQueueGatePassed).toBe(false);
  });
  it("fails closed on unavailable independent runtime, burden, source mutation and fake WAV metadata", () => {
    const evaluation = evaluateC60114PlaybackCoverage(coverageInput142());
    const base = {
      evaluation,
      contributions: [],
      targetBudgetPassed: true,
      fullQueueBurdenPassed: true,
      independentRuntimeAvailable: true,
    };
    expect(
      route142({ ...base, independentRuntimeAvailable: false }).primaryDecision,
    ).toBe("HOLD_FOR_INDEPENDENT_DETECTOR_RUNTIME");
    expect(
      route142({ ...base, fullQueueBurdenPassed: false }).primaryDecision,
    ).toBe("HOLD_FOR_SAFETY_TARGET_SELECTION_REPAIR");
    expect(
      route142({ ...base, targetBudgetPassed: false }).primaryDecision,
    ).toBe("HOLD_FOR_ENGINEERING_REPAIR");
    const mutated = coverageInput142();
    mutated.engineeringGates.sourceMutationCount = 1;
    expect(routeFor(mutated).primaryDecision).toBe(
      "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
    );
    const badAudio = coverageInput142();
    required141(badAudio.physicalAudio[0]).hashVerified = false;
    expect(routeFor(badAudio).evaluationIntegrityPassed).toBe(false);
  });
  it("queries the exact native posterior cells without threshold retuning or padding inflation", () => {
    const track = scoreTrack142Schema.parse(
      hashed141({
        runId: "synthetic",
        family: "SILERO",
        viewId: "view",
        pcmSha256: h,
        scoreKind: "PROBABILITY",
        relativePath: "scores.f32le",
        scoreSha256: h,
        dtype: "FLOAT32_LITTLE_ENDIAN",
        frameCount: 3,
        frameHopSamples16k: 160,
        frameWindowSamples16k: 160,
        frameOffsetSamples16k: 0,
        timeMapping: {
          sourceSampleRate: 48000,
          outputSampleRate: 16000,
          numerator: 3,
          denominator: 1,
          sourceStartSample: 480000,
          outputStartSample: 0,
          mappingStatus: "VERIFIED_INTEGER_RATIONAL",
          measuredImpulsePeakDelaySamples: 0,
          syntheticValidationHash: h,
        },
        maximumNativeSample: 481200,
        mainThreshold: 0.5,
        auditThreshold: 0.1,
        statistics: {
          minimum: 0,
          maximum: 0.9,
          mean: 0.37,
          q05: 0,
          q25: 0,
          q50: 0.2,
          q75: 0.2,
          q95: 0.9,
          q99: 0.9,
        },
        mainCrossingNativeIntervals: [
          { startSample: 480960, endSample: 481200 },
        ],
        subthresholdPeakNativeIntervals: [
          { startSample: 480480, endSample: 480960 },
        ],
        originalChunkScores: null,
      }),
    );
    const result = scoreDiagnostics142(
      track,
      [0, 0.2, 0.9],
      [{ start: 10.01, end: 10.02 }],
    );
    expect(result.frameCount).toBe(1);
    expect(result.statistics?.mean).toBe(0.2);
    expect(result.anyMainCrossing).toBe(false);
    expect(result.anySubthresholdCrossing).toBe(true);
    expect(result.thresholdRetuned).toBe(false);
    expect(
      scoreDiagnostics142(track, [0, 0.2, 0.9], [{ start: 10.025, end: 10.03 }])
        .frameCount,
    ).toBe(0);
    expect(() => scoreDiagnostics142(track, [0], [])).toThrow(
      /FRAME_MISMATCH/u,
    );
  });
  it("requires 12 distinct frozen stages and four independent comparisons with no Gold fields", () => {
    const input = coverageInput142(),
      f = fixture142();
    const { generatedAt, engineeringGates, errorComponents, ...base } = input;
    const projections = assembleProjections142({
      policy: f.policy,
      inventory: f.inventory,
      baseline: base,
      phaseA: [base, base, base],
      detectorOnly: base,
      final: base,
    });
    expect(projections.variants).toHaveLength(12);
    expect(projections.comparisonPlans).toHaveLength(4);
    expect(
      projections142Schema.safeParse({
        ...projections,
        variants: projections.variants.slice(1),
      }).success,
    ).toBe(false);
    expect(
      projections142Schema.safeParse({ ...projections, goldLabels: [] })
        .success,
    ).toBe(false);
    const value = evaluate142({
      projections,
      policy: f.policy,
      components: errorComponents,
      engineeringGates,
      oldInventory: f.old.inventory,
      oldSafety: f.old.safety,
      selectionOnly: f.safety,
      inventory: f.inventory,
      safety: f.safety,
      uncovered: f.uncovered,
      clusters: f.phaseA.clusters,
      masked: f.masked,
      scores: scoreTracks142Schema.parse(
        hashed141({
          ...header142(f.policy, f.source),
          artifactType: "machine-speech-detector-score-tracks-v1",
          planHash: h,
          tracks: [],
          scorePolicyHash: h,
          rawScoresPreserved: true,
          postGoldThresholdChangeCount: 0,
        }),
      ),
      sweeps: f.sweeps,
      valuesByRun: new Map(),
      lexical: f.lexical,
      independentRuntimeAvailable: true,
      generatedAt,
    });
    expect(value.variants).toHaveLength(12);
    expect(value.matchingRulesChanged).toBe(false);
    expect(value.sourceContribution[0]?.manualListeningClaim).toBe(
      "NOT_CLAIMED_BY_AUTOMATED_EVALUATOR",
    );
    expect(value.burden.nonOverlapMeansConfirmedFalsePositive).toBe(false);
  });
});
