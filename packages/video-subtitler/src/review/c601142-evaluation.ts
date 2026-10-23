import {
  evaluation142Schema,
  route142Schema,
  contribution142Schema,
  type C60114ErrorComponent,
  type C60114PlaybackCoverageInput,
  type C60114PlaybackCoverageEvaluation,
  type Policy142,
  type Projections142,
  type Inventory142,
  type Safety142,
  type C601141Inventory,
  type C601141Safety,
  type Masked142,
  type ScoreTracks142,
  type Sweeps142,
  type Lexical142,
  type Uncovered142,
  type Clusters142,
  type Evaluation142,
  type Route142,
} from "@mvl/shared";
import {
  evaluateC60114PlaybackCoverage,
  c60114CoverageLayer,
  c60114IntersectIntervals,
  c60114UnionIntervals,
} from "./playback-grounded-coverage-evaluator.js";
import { header142 } from "./c601142-policy.js";
import {
  hashed141,
  assertHash141,
  required141,
  seconds141,
} from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
interface Interval {
  start: number;
  end: number;
}
const duration = (values: Interval[]) =>
  c60114UnionIntervals(values).reduce((n, v) => n + v.end - v.start, 0);
const overlaps = (a: Interval[], b: Interval[]) =>
  c60114IntersectIntervals(a, b).length > 0;
export function officialBudget142(
  evaluation: C60114PlaybackCoverageEvaluation,
  planId = "C601142_FINAL_FULL_QUEUE",
) {
  return required141(evaluation.budgets.find((p) => p.planId === planId));
}
export function route142(input: {
  evaluation: C60114PlaybackCoverageEvaluation;
  contributions: Evaluation142["sourceContribution"];
  targetBudgetPassed: boolean;
  fullQueueBurdenPassed: boolean;
  independentRuntimeAvailable: boolean;
}): Route142 {
  const full = officialBudget142(input.evaluation),
    gates = input.evaluation.engineeringGates;
  const engineeringPassed =
    gates.engineeringPassed &&
    gates.baselineParityPassed &&
    gates.canonicalMutationCount === 0 &&
    gates.machineDraftMutationCount === 0 &&
    input.targetBudgetPassed;
  const evaluationIntegrityPassed =
    input.evaluation.integrityFailures.length === 0 &&
    full.integrityFailures.length === 0 &&
    gates.machineFreezeVerified &&
    gates.runtimeGoldInputCount === 0 &&
    gates.sourceMutationCount === 0 &&
    gates.goldMutationCount === 0;
  const fullQueueGatePassed =
    full.officialMissingRecall.total > 0 &&
    full.officialHallucinationRecall.total > 0 &&
    full.officialMissingRecall.covered === full.officialMissingRecall.total &&
    full.officialHallucinationRecall.covered ===
      full.officialHallucinationRecall.total &&
    input.fullQueueBurdenPassed;
  const blockers: Route142["blockers"] = [];
  const missing = input.contributions.filter((c) => !c.finalAudible);
  const add = (diagnosis: string, ids: string[], reason: string) => {
    if (ids.length)
      blockers.push({ diagnosis, errorComponentIds: ids, reasons: [reason] });
  };
  add(
    "DETECTOR_CEILING",
    missing
      .filter((c) => c.primaryDiagnosis === "DETECTOR_MISS")
      .map((c) => c.errorComponentId),
    "FROZEN_INVENTORY_COVERAGE_BELOW_0_8_NOT_REPAIRED_BY_LOWERING_THRESHOLD",
  );
  add(
    "SAFETY_SELECTION",
    missing
      .filter((c) => c.primaryDiagnosis === "SAFETY_TARGET_SELECTION_MISS")
      .map((c) => c.errorComponentId),
    "SOURCE_SPEECH_DETECTED_BUT_TARGET_CORE_COVERAGE_BELOW_0_8",
  );
  add(
    "REVIEW_AUDIO",
    missing
      .filter((c) => c.primaryDiagnosis === "REVIEW_AUDIO_OMISSION")
      .map((c) => c.errorComponentId),
    "TARGET_PRESENT_BUT_PHYSICAL_PLAYBACK_INTERSECTION_INCOMPLETE",
  );
  if (!input.fullQueueBurdenPassed)
    blockers.push({
      diagnosis: "FULL_QUEUE_BURDEN_DEGENERATE",
      errorComponentIds: [],
      reasons: ["ACTUAL_FULL_QUEUE_EXCEEDS_FROZEN_0_95_EPISODE_LIMIT"],
    });
  const hallucinationMissing = full.componentCoverage
    .filter(
      (c) =>
        c.labels.includes("HALLUCINATION") &&
        !c.layers.audibleReviewCoverage.audible,
    )
    .map((c) => c.errorComponentId);
  add(
    "HALLUCINATION_AUDIO_PRESERVATION",
    hallucinationMissing,
    "EXISTING_HALLUCINATION_REVIEW_MUST_REMAIN_PHYSICALLY_AUDIBLE",
  );
  let primaryDecision: Route142["primaryDecision"] =
    "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION";
  if (!engineeringPassed) primaryDecision = "HOLD_FOR_ENGINEERING_REPAIR";
  else if (!evaluationIntegrityPassed)
    primaryDecision = "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR";
  else if (!input.independentRuntimeAvailable)
    primaryDecision = "HOLD_FOR_INDEPENDENT_DETECTOR_RUNTIME";
  else if (blockers.some((b) => b.diagnosis === "DETECTOR_CEILING"))
    primaryDecision = "HOLD_FOR_MASKED_SPEECH_DETECTOR_CEILING";
  else if (
    blockers.some(
      (b) =>
        b.diagnosis === "SAFETY_SELECTION" ||
        b.diagnosis === "FULL_QUEUE_BURDEN_DEGENERATE",
    )
  )
    primaryDecision = "HOLD_FOR_SAFETY_TARGET_SELECTION_REPAIR";
  else if (!fullQueueGatePassed)
    primaryDecision = "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR";
  return route142Schema.parse(
    hashed141({
      primaryDecision,
      blockers,
      advisories: [
        "ALL_MANDATORY_IS_DIAGNOSTIC_NOT_THE_FULL_QUEUE_GATE",
        "LOCALIZED_ASR_WORD_CORRECTNESS_IS_NOT_IMPLIED_BY_AUDIO_COVERAGE",
        "NO_AUTOMATIC_SOURCE_SEPARATION_OR_RANKER_TRAINING",
        "ACOUSTIC_PROXIES_DO_NOT_PROVE_BACKGROUND_MUSIC_OR_SPEAKER_IDENTITY",
      ],
      fullQueueGatePassed,
      targetBudgetPassed: input.targetBudgetPassed,
      fullQueueBurdenPassed: input.fullQueueBurdenPassed,
      engineeringPassed,
      evaluationIntegrityPassed,
      mandatorySubsetRecallIsBlocking: false,
      lexicalIncompleteWhenAudibleIsBlocking: false,
      finalizationMethod: "none",
      productionStatus: "needs-review",
      c602Status: "HOLD",
      machineOnlyReleaseAuthorized: false,
      rankerRetrained: false,
      humanTrialStarted: false,
    }),
  );
}
export function scoreDiagnostics142(
  track: ScoreTracks142["tracks"][number],
  values: number[],
  errorIntervals: Interval[],
) {
  if (values.length !== track.frameCount)
    throw new Error("C601142_EVALUATION_SCORE_FRAME_MISMATCH");
  const rate = track.timeMapping.sourceSampleRate,
    ratio = track.timeMapping.numerator / track.timeMapping.denominator;
  const local: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const startSample = Math.min(
      track.maximumNativeSample,
      track.timeMapping.sourceStartSample +
        Math.round(
          Math.max(
            0,
            track.frameOffsetSamples16k + i * track.frameHopSamples16k,
          ) * ratio,
        ),
    );
    const endSample = Math.min(
      track.maximumNativeSample,
      track.timeMapping.sourceStartSample +
        Math.round(
          Math.max(
            0,
            track.frameOffsetSamples16k + (i + 1) * track.frameHopSamples16k,
          ) * ratio,
        ),
    );
    if (
      endSample > startSample &&
      overlaps(errorIntervals, [
        { start: startSample / rate, end: endSample / rate },
      ])
    )
      local.push(required141(values[i]));
  }
  const sorted = [...local].sort((a, b) => a - b),
    at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
  const statistics = local.length
    ? {
        minimum: at(0),
        maximum: at(1),
        mean: local.reduce((n, v) => n + v, 0) / local.length,
        q05: at(0.05),
        q25: at(0.25),
        q50: at(0.5),
        q75: at(0.75),
        q95: at(0.95),
        q99: at(0.99),
      }
    : null;
  const peaks = c60114IntersectIntervals(
    errorIntervals,
    track.subthresholdPeakNativeIntervals.map((v) => seconds141(v, rate)),
  );
  return {
    runId: track.runId,
    detectorFamily: track.family,
    viewId: track.viewId,
    scoreKind: track.scoreKind,
    frameCount: local.length,
    statistics,
    mainThreshold: track.mainThreshold,
    auditThreshold: track.auditThreshold,
    anyMainCrossing: local.some((v) => v >= track.mainThreshold),
    anySubthresholdCrossing:
      track.scoreKind === "PROBABILITY" &&
      local.some((v) => v >= track.auditThreshold && v < track.mainThreshold),
    maximumSubthresholdPeakSeconds: Math.max(
      0,
      ...peaks.map((v) => v.end - v.start),
    ),
    preciseSourceMapping: true as const,
    thresholdRetuned: false as const,
  };
}
export function evaluate142(input: {
  projections: Projections142;
  policy: Policy142;
  components: C60114ErrorComponent[];
  engineeringGates: C60114PlaybackCoverageInput["engineeringGates"];
  oldInventory: C601141Inventory;
  oldSafety: C601141Safety;
  selectionOnly: Safety142;
  inventory: Inventory142;
  safety: Safety142;
  uncovered: Uncovered142;
  clusters: Clusters142;
  masked: Masked142;
  scores: ScoreTracks142;
  sweeps: Sweeps142;
  valuesByRun: Map<string, number[]>;
  lexical: Lexical142;
  independentRuntimeAvailable: boolean;
  generatedAt: string;
}): Evaluation142 {
  const { projections, policy, inventory, safety, components } = input;
  [
    projections,
    policy,
    input.oldInventory,
    input.oldSafety,
    input.selectionOnly,
    inventory,
    safety,
    input.uncovered,
    input.clusters,
    input.masked,
    input.scores,
    input.sweeps,
    input.lexical,
  ].forEach(assertHash141);
  const variants = projections.variants.map((v) => ({
    stage: v.stage,
    evaluation: evaluateC60114PlaybackCoverage({
      ...v.projection,
      errorComponents: components,
      generatedAt: input.generatedAt,
      engineeringGates: input.engineeringGates,
    }),
  }));
  const comparisonPlans = projections.comparisonPlans.map((v) => ({
    planId: v.planId,
    evaluation: evaluateC60114PlaybackCoverage({
      ...v.projection,
      errorComponents: components,
      generatedAt: input.generatedAt,
      engineeringGates: input.engineeringGates,
    }),
  }));
  const comparison = (planId: string) =>
    officialBudget142(
      required141(comparisonPlans.find((v) => v.planId === planId)).evaluation,
      planId,
    );
  const baseline = comparison("C601141_BASELINE_FULL_QUEUE"),
    selected = comparison("C601142_SELECTION_REPAIR_ONLY"),
    detectorOnly = comparison("C601142_DETECTOR_CEILING_ONLY"),
    final = comparison("C601142_FINAL_FULL_QUEUE");
  const rate = inventory.sourceIdentity.sampleRate,
    native = (v: { startSample: number; endSample: number }) =>
      seconds141(v, rate);
  const sourceContribution = components
    .filter((c) => c.labels.includes("MISSING_DIALOGUE"))
    .map((component) => {
      const lookup = (budget: typeof final) =>
        required141(
          budget.componentCoverage.find(
            (c) => c.errorComponentId === component.errorComponentId,
          ),
        );
      const a0 = lookup(baseline),
        a3 = lookup(selected),
        b = lookup(detectorOnly),
        last = lookup(final),
        errorIntervals = component.errorIntervals;
      const coverage = (intervals: Interval[]) =>
        c60114CoverageLayer(
          errorIntervals,
          intervals.map((v, i) => ({ id: String(i), intervals: [v] })),
        ).coverageRatio;
      const byFamily = (family: string) =>
        input.sweeps.runs
          .filter((r) => r.family === family)
          .flatMap((r) => r.nativeIntervals.map(native));
      const obs = inventory.observations.filter(
        (o) =>
          o.verifiedTimebase &&
          o.speechPositive &&
          !o.strongContradiction &&
          overlaps(errorIntervals, [native(o.nativeInterval)]),
      );
      const candidates = input.uncovered.candidates.filter((c) =>
        overlaps(errorIntervals, [native(c.nativeInterval)]),
      );
      const clusters = input.clusters.clusters.filter((c) =>
        overlaps(errorIntervals, c.targetCoreUnion.map(native)),
      );
      const selectedTargets = safety.targets.filter((t) =>
        overlaps(errorIntervals, t.targetCoreUnion.map(native)),
      );
      const masked = input.masked.candidates.filter((c) =>
        overlaps(errorIntervals, [c.sourceInterval]),
      );
      const scores = input.scores.tracks.map((track) =>
        scoreDiagnostics142(
          track,
          required141(input.valuesByRun.get(track.runId)),
          errorIntervals,
        ),
      );
      const directCoverage = {
        oldInventory: coverage(
          input.oldInventory.observations
            .filter(
              (o) =>
                o.verifiedTimebase &&
                o.speechPositive &&
                !o.strongContradiction,
            )
            .map((o) => native(o.nativeInterval)),
        ),
        oldSafety: coverage(
          input.oldSafety.targets.map((t) => native(t.nativeInterval)),
        ),
        selectionOnlySafety: coverage(
          input.selectionOnly.targets.flatMap((t) =>
            t.targetCoreUnion.map(native),
          ),
        ),
        newSilero: coverage(byFamily("SILERO")),
        newPyannote: coverage(byFamily("PYANNOTE")),
        webRtc: coverage(byFamily("WEBRTC")),
        subthresholdMasked: coverage(
          inventory.observations
            .filter((o) => o.scoreLevel === "AUDIT_SUBTHRESHOLD")
            .map((o) => native(o.nativeInterval)),
        ),
        combinedInventory: last.layers.machineSpeech.coverageRatio,
        finalSafety: coverage(
          safety.targets.flatMap((t) => t.targetCoreUnion.map(native)),
        ),
        physicalAudio: last.layers.physicalAudio.coverageRatio,
        playback: last.layers.audibleReviewCoverage.coverageRatio,
        localizedLexical: last.layers.localizedLexical.coverageRatio,
      };
      const primaryDiagnosis =
        component.mappingStatus !== "RESOLVED"
          ? "GOLD_MAPPING_UNRESOLVED"
          : a0.layers.audibleReviewCoverage.audible
            ? "COVERED_BY_BASELINE"
            : a3.layers.audibleReviewCoverage.audible
              ? "RECOVERED_BY_SELECTION_REPAIR"
              : last.layers.audibleReviewCoverage.audible
                ? last.layers.localizedLexical.audible
                  ? "RECOVERED_WITH_LOCALIZED_LEXICAL_EVIDENCE"
                  : "AUDIBLE_WITHOUT_LEXICAL_EVIDENCE"
                : directCoverage.combinedInventory < policy.coverage.audible
                  ? "DETECTOR_MISS"
                  : !last.layers.targetInterval.audible
                    ? "SAFETY_TARGET_SELECTION_MISS"
                    : "REVIEW_AUDIO_OMISSION";
      const maskingDiagnosis = scores.some((s) => s.anyMainCrossing)
        ? "MAIN_THRESHOLD_CROSSING"
        : scores.some((s) => s.anySubthresholdCrossing)
          ? "SUBTHRESHOLD_ONLY"
          : masked.some((m) => m.acousticContradiction)
            ? "MUSIC_CONTRADICTION_PROXY"
            : masked.some((m) => m.acousticSupport)
              ? "ACOUSTIC_SPEECHLIKE_WITH_DETECTOR_MISS"
              : "INSUFFICIENT_EVIDENCE";
      return contribution142Schema.parse(
        hashed141({
          errorComponentId: component.errorComponentId,
          errorIntervals,
          baselineAudible: a0.layers.audibleReviewCoverage.audible,
          selectionOnlyAudible: a3.layers.audibleReviewCoverage.audible,
          detectorOnlyAudible: b.layers.audibleReviewCoverage.audible,
          finalAudible: last.layers.audibleReviewCoverage.audible,
          finalFull: last.layers.audibleReviewCoverage.full,
          candidateIds: candidates.map((c) => c.candidateId),
          clusterIds: clusters.map((c) => c.clusterId),
          selectedTargetIds: selectedTargets.map((t) => t.targetId),
          maskingCandidateIds: masked.map((m) => m.candidateId),
          detectorFamilies: unique142(obs.map((o) => o.family)),
          localizedAsrRequestIds: unique142(
            input.lexical.targets.flatMap((t) =>
              t.localizedTextCandidates
                .filter((c) => overlaps(errorIntervals, [c.sourceInterval]))
                .map((c) => c.requestId),
            ),
          ),
          directCoverage,
          primaryDiagnosis,
          scoreDiagnostics: scores,
          acousticDiagnostics: masked.map((m) => ({
            candidateId: m.candidateId,
            features: m.acousticFeatures,
            evidenceClass: m.evidenceClass,
            contradiction: m.acousticContradiction,
          })),
          maskingDiagnosis,
          manualListeningClaim: "NOT_CLAIMED_BY_AUTOMATED_EVALUATOR",
        }),
      );
    });
  const finalFullQueueSeconds = final.actualAudibleUniqueSeconds,
    baselineFullQueueSeconds = baseline.actualAudibleUniqueSeconds;
  const incrementalFullQueueSeconds = Math.max(
      0,
      finalFullQueueSeconds - baselineFullQueueSeconds,
    ),
    additionalRecoveredMissing = sourceContribution.filter(
      (c) => !c.baselineAudible && c.finalAudible,
    ).length;
  const missingIntervals = components
    .filter((c) => c.labels.includes("MISSING_DIALOGUE"))
    .flatMap((c) => c.errorIntervals);
  const nonOverlap = safety.targets.filter(
    (t) => !overlaps(missingIntervals, t.targetCoreUnion.map(native)),
  );
  const episodeRatio =
    finalFullQueueSeconds / inventory.sourceIdentity.durationSeconds;
  const route = route142({
    evaluation: required141(
      comparisonPlans.find((p) => p.planId === "C601142_FINAL_FULL_QUEUE"),
    ).evaluation,
    contributions: sourceContribution,
    targetBudgetPassed:
      safety.targets.length <= policy.selection.maximumTargets &&
      safety.summary.targetUnionSeconds <=
        policy.selection.maximumCoreUnionSeconds + 1e-9 &&
      safety.summary.oldCoveragePreserved,
    fullQueueBurdenPassed: episodeRatio <= policy.coverage.maximumEpisodeBurden,
    independentRuntimeAvailable: input.independentRuntimeAvailable,
  });
  return evaluation142Schema.parse(
    hashed141({
      ...header142(policy, inventory.sourceIdentity),
      artifactType: "c6-0-1-14-2-selection-detector-ceiling-evaluation",
      generatedAt: input.generatedAt,
      projectionHash: projections.semanticHash,
      variants,
      comparisonPlans,
      officialPlanId: "C601142_FINAL_FULL_QUEUE",
      route,
      sourceContribution,
      burden: {
        baselineSafetyCount: input.oldSafety.targets.length,
        finalSafetyCount: safety.targets.length,
        baselineSafetyUnionSeconds: input.oldSafety.summary.targetUnionSeconds,
        finalSafetyUnionSeconds: safety.summary.targetUnionSeconds,
        slotsRecovered:
          input.oldSafety.targets.length -
          input.selectionOnly.targets.filter((t) => t.oldTargetIds.length)
            .length,
        baselineFullQueueSeconds,
        selectionOnlyFullQueueSeconds: selected.actualAudibleUniqueSeconds,
        detectorOnlyFullQueueSeconds: detectorOnly.actualAudibleUniqueSeconds,
        finalFullQueueSeconds,
        incrementalFullQueueSeconds,
        episodeRatio,
        safetyTargetsNotOverlappingGoldMissing: nonOverlap.length,
        safetyTargetSecondsNotOverlappingGoldMissing: duration(
          nonOverlap.flatMap((t) => t.targetCoreUnion.map(native)),
        ),
        additionalRecoveredMissing,
        audioSecondsPerRecoveredMissing: additionalRecoveredMissing
          ? incrementalFullQueueSeconds / additionalRecoveredMissing
          : null,
        nonOverlapMeansConfirmedFalsePositive: false,
      },
      matchingRulesChanged: false,
      evaluatorInferenceCount: 0,
      canonicalMutationCount: 0,
    }),
  );
}
