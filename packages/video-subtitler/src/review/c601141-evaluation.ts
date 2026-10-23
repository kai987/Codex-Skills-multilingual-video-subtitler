import {
  c601141EvaluationSchema,
  c601141RouteDecisionSchema,
  type C601141CoverageProjections,
  type C601141Inventory,
  type C601141Fingerprint,
  type C601141Safety,
  type C601141Policy,
  type C60114ErrorComponent,
  type C60114PlaybackCoverageInput,
  type C60114PlaybackCoverageEvaluation,
  type C601141RouteDecision,
} from "@mvl/shared";
import { evaluateC60114PlaybackCoverage } from "./playback-grounded-coverage-evaluator.js";
import {
  header141,
  hashed141,
  assertHash141,
  seconds141,
  duration141,
  unique141,
  required141,
} from "./c601141-policy.js";
import { c60114Intersection, c60114Union } from "./c60114-policy.js";

export function officialBudget141(value: C60114PlaybackCoverageEvaluation) {
  const row =
    value.budgets.find((v) => v.planId === "FULL_QUEUE_WITH_SAFETY_RESERVE") ??
    value.budgets.find((v) => v.planId === "FULL_QUEUE");
  if (!row) throw new Error("C601141_OFFICIAL_PLAYBACK_PLAN_MISSING");
  return row;
}
/** Route uses physical coverage, not the availability of an automatic transcript.
 * No threshold tuning, Gold-driven target creation or model execution lives here. */
export function route141(input: {
  evaluation: C60114PlaybackCoverageEvaluation;
  targetBudgetPassed: boolean;
  legacyUnresolvedComponentIds?: string[];
  enhancementSupportedComponentIds?: string[];
}): C601141RouteDecision {
  const value = input.evaluation,
    full = officialBudget141(value),
    g = value.engineeringGates;
  const engineeringPassed =
    g.engineeringPassed &&
    g.baselineParityPassed &&
    input.targetBudgetPassed &&
    g.canonicalMutationCount === 0 &&
    g.machineDraftMutationCount === 0;
  const evaluationIntegrityPassed =
    value.integrityFailures.length === 0 &&
    full.integrityFailures.length === 0 &&
    g.machineFreezeVerified &&
    g.runtimeGoldInputCount === 0 &&
    g.sourceMutationCount === 0 &&
    g.goldMutationCount === 0;
  const fullQueueGatePassed =
    full.officialMissingRecall.total > 0 &&
    full.officialMissingRecall.covered === full.officialMissingRecall.total &&
    full.officialHallucinationRecall.covered ===
      full.officialHallucinationRecall.total;
  const missing = full.componentCoverage.filter(
    (v) =>
      v.labels.includes("MISSING_DIALOGUE") &&
      !v.layers.audibleReviewCoverage.audible,
  );
  const blockers: C601141RouteDecision["blockers"] = [],
    advisories: C601141RouteDecision["advisories"] = [];
  const add = (diagnosis: string, ids: string[], reason: string) => {
    if (ids.length)
      blockers.push({ diagnosis, errorComponentIds: ids, reasons: [reason] });
  };
  const detectorMiss = missing
    .filter((v) => !v.layers.machineSpeech.any)
    .map((v) => v.errorComponentId);
  add(
    "MACHINE_SPEECH_DETECTION_MISS",
    detectorMiss,
    "NO_DIRECT_VERIFIED_SPEECH_INTERVAL_OVERLAP",
  );
  add(
    "SAFETY_RESERVE_SELECTION_INCOMPLETE",
    missing
      .filter(
        (v) => v.layers.machineSpeech.any && !v.layers.targetInterval.audible,
      )
      .map((v) => v.errorComponentId),
    "DETECTED_SPEECH_NOT_SUFFICIENTLY_SELECTED_AS_AUDIBLE_REVIEW_TARGET",
  );
  add(
    "REVIEW_AUDIO_COVERAGE_INCOMPLETE",
    missing
      .filter((v) => v.layers.targetInterval.audible)
      .map((v) => v.errorComponentId),
    "TARGET_EXISTS_BUT_PHYSICAL_PLAYBACK_INTERSECTION_BELOW_FROZEN_0_8",
  );
  add(
    "HALLUCINATION_PLAYBACK_OMISSION",
    full.componentCoverage
      .filter(
        (v) =>
          v.labels.includes("HALLUCINATION") &&
          !v.layers.audibleReviewCoverage.audible,
      )
      .map((v) => v.errorComponentId),
    "HALLUCINATION_REMAINS_AN_AUDIBLE_COVERAGE_GATE",
  );
  const incomplete = full.componentCoverage
    .filter(
      (v) =>
        v.labels.includes("MISSING_DIALOGUE") &&
        v.layers.audibleReviewCoverage.audible &&
        !v.layers.localizedLexical.audible,
    )
    .map((v) => v.errorComponentId);
  if (incomplete.length)
    advisories.push({
      diagnosis: "LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE",
      errorComponentIds: incomplete,
      reasons: [
        "HUMAN_CAN_REVIEW_PLAYABLE_AUDIO_WITHOUT_AUTOMATIC_TEXT_INSERTION",
      ],
    });
  const mandatory = value.budgets.find((v) => v.planId === "ALL_MANDATORY");
  if (
    mandatory &&
    mandatory.officialMissingRecall.covered <
      mandatory.officialMissingRecall.total
  )
    advisories.push({
      diagnosis: "MANDATORY_SUBSET_RECALL_DIAGNOSTIC_ONLY",
      errorComponentIds: [],
      reasons: [
        "FROZEN_R3_RANKER_NOT_RETRAINED_NEW_TARGETS_REMAIN_RECOMMENDED",
      ],
    });
  let primaryDecision: C601141RouteDecision["primaryDecision"] =
    "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION";
  if (!engineeringPassed) primaryDecision = "HOLD_FOR_ENGINEERING_REPAIR";
  else if (!evaluationIntegrityPassed)
    primaryDecision = "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR";
  else if (!fullQueueGatePassed) {
    if (
      missing.some((v) =>
        input.legacyUnresolvedComponentIds?.includes(v.errorComponentId),
      )
    )
      primaryDecision = "HOLD_FOR_LEGACY_PROVENANCE_RECOVERY";
    else if (
      detectorMiss.length &&
      detectorMiss.every((id) =>
        input.enhancementSupportedComponentIds?.includes(id),
      )
    )
      primaryDecision =
        "HOLD_FOR_DIALOGUE_ENHANCEMENT_SOURCE_SEPARATION_INVESTIGATION";
    else if (detectorMiss.length)
      primaryDecision = "HOLD_FOR_MACHINE_SPEECH_DETECTION_MODEL_CEILING";
    else if (
      blockers.some(
        (v) => v.diagnosis === "SAFETY_RESERVE_SELECTION_INCOMPLETE",
      )
    )
      primaryDecision = "HOLD_FOR_SAFETY_RESERVE_SELECTION_REPAIR";
    else primaryDecision = "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR";
  }
  if (!engineeringPassed)
    blockers.unshift({
      diagnosis: "ENGINEERING_GATE_FAILED",
      errorComponentIds: [],
      reasons: ["VALIDATION_BASELINE_MUTATION_OR_TARGET_BUDGET_GATE_FAILED"],
    });
  if (!evaluationIntegrityPassed)
    blockers.unshift({
      diagnosis: "EVALUATION_INTEGRITY_FAILED",
      errorComponentIds: [],
      reasons: [...value.integrityFailures, ...full.integrityFailures],
    });
  return c601141RouteDecisionSchema.parse(
    hashed141({
      primaryDecision,
      blockers,
      advisories,
      fullQueueGatePassed,
      targetBudgetPassed: input.targetBudgetPassed,
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
export function evaluateInventory141(input: {
  projections: C601141CoverageProjections;
  components: C60114ErrorComponent[];
  inventory: C601141Inventory;
  fingerprint: C601141Fingerprint;
  safety: C601141Safety;
  policy: C601141Policy;
  generatedAt: string;
  engineeringGates: C60114PlaybackCoverageInput["engineeringGates"];
}) {
  [input.projections, input.inventory, input.fingerprint, input.safety].forEach(
    assertHash141,
  );
  const variants = input.projections.variants.map((v) => ({
    stage: v.stage,
    evaluation: evaluateC60114PlaybackCoverage({
      ...v.projection,
      errorComponents: input.components,
      generatedAt: input.generatedAt,
      engineeringGates: input.engineeringGates,
    }),
  }));
  const first = variants[0],
    last = variants.at(-1);
  if (!first || !last) throw new Error("C601141_ABLATION_SET_EMPTY");
  const before = officialBudget141(first.evaluation),
    after = officialBudget141(last.evaluation),
    rate = input.inventory.sourceIdentity.sampleRate;
  const overlap = (
    interval: { start: number; end: number },
    component: C60114ErrorComponent,
  ) =>
    component.errorIntervals.some(
      (v) => c60114Intersection(v, interval) !== null,
    );
  const missing = input.components.filter((v) =>
    v.labels.includes("MISSING_DIALOGUE"),
  );
  const nativeObservationIds = new Set(
    input.projections.variants
      .find((v) => v.stage === "A3")
      ?.projection.speechIslands.map((v) => v.islandId),
  );
  const sourceContribution = missing.map((component) => {
    const prior = required141(
        before.componentCoverage.find(
          (v) => v.errorComponentId === component.errorComponentId,
        ),
      ),
      final = required141(
        after.componentCoverage.find(
          (v) => v.errorComponentId === component.errorComponentId,
        ),
      );
    const obs = input.inventory.observations.filter(
      (v) =>
        v.verifiedTimebase &&
        v.speechPositive &&
        !v.strongContradiction &&
        overlap(seconds141(v.nativeInterval, rate), component),
    );
    const fp = input.fingerprint.entries.filter(
      (v) =>
        v.nativeInterval &&
        overlap(seconds141(v.nativeInterval, rate), component),
    );
    const ids = (family: string, native?: boolean) =>
      unique141(
        obs
          .filter(
            (v) =>
              v.family === family &&
              (native === undefined ||
                nativeObservationIds.has(v.observationId) === native),
          )
          .flatMap((v) => v.evidenceIds),
      );
    const coverage = (intervals: { start: number; end: number }[]) => {
      const errors = c60114Union(component.errorIntervals);
      const duration = (values: { start: number; end: number }[]) =>
        c60114Union(values).reduce((sum, v) => sum + v.end - v.start, 0);
      const denominator = duration(errors);
      const intersections = intervals.flatMap((interval) =>
        errors.flatMap((error) => {
          const value = c60114Intersection(interval, error);
          return value ? [value] : [];
        }),
      );
      return denominator
        ? Math.min(1, duration(intersections) / denominator)
        : 0;
    };
    const evidenceCoverage = (include: (v: (typeof obs)[number]) => boolean) =>
      coverage(
        obs.filter(include).map((v) => seconds141(v.nativeInterval, rate)),
      );
    const directCoverage = {
      existingSpeech: prior.layers.machineSpeech.coverageRatio,
      fingerprintRecovered: evidenceCoverage(
        (v) => v.family === "LEGACY_FINGERPRINT",
      ),
      sileroNative: evidenceCoverage(
        (v) =>
          v.family === "SILERO" && nativeObservationIds.has(v.observationId),
      ),
      sileroAllViews: evidenceCoverage((v) => v.family === "SILERO"),
      pyannote: evidenceCoverage((v) => v.family === "PYANNOTE"),
      multiDetector: coverage(
        input.inventory.islands
          .filter((v) => v.evidenceClass === "MULTI_DETECTOR_CONFIRMED")
          .map((v) => v.sourceInterval),
      ),
      combinedInventory: final.layers.machineSpeech.coverageRatio,
      safetyTarget: coverage(input.safety.targets.map((v) => v.sourceInterval)),
      physicalAudio: final.layers.physicalAudio.coverageRatio,
      playback: final.layers.audibleReviewCoverage.coverageRatio,
      localizedLexical: final.layers.localizedLexical.coverageRatio,
    };
    const newlyAudible =
      !prior.layers.audibleReviewCoverage.audible &&
      final.layers.audibleReviewCoverage.audible;
    const primaryDiagnosis =
      component.mappingStatus !== "RESOLVED"
        ? "GOLD_MAPPING_UNRESOLVED"
        : newlyAudible && directCoverage.fingerprintRecovered >= 0.8
          ? "RECOVERED_BY_LEGACY_FINGERPRINT"
          : newlyAudible && directCoverage.multiDetector >= 0.8
            ? "RECOVERED_BY_MULTI_DETECTOR_SPEECH"
            : newlyAudible &&
                directCoverage.sileroAllViews >= 0.8 &&
                directCoverage.sileroNative < 0.8
              ? "RECOVERED_BY_MULTI_VIEW_SILERO"
              : newlyAudible &&
                  directCoverage.pyannote >= 0.8 &&
                  directCoverage.sileroAllViews < 0.8
                ? "RECOVERED_BY_PYANNOTE_ONLY"
                : newlyAudible && directCoverage.safetyTarget >= 0.8
                  ? "RECOVERED_BY_SAFETY_RESERVE_TARGET"
                  : final.layers.audibleReviewCoverage.audible
                    ? final.layers.localizedLexical.audible
                      ? "RECOVERED_WITH_LOCALIZED_LEXICAL_EVIDENCE"
                      : "AUDIBLE_WITHOUT_LEXICAL_EVIDENCE"
                    : !final.layers.machineSpeech.any
                      ? "SPEECH_DETECTOR_MISS"
                      : !final.layers.targetInterval.audible
                        ? "SAFETY_TARGET_SELECTION_MISS"
                        : "REVIEW_AUDIO_OMISSION";
    return {
      errorComponentId: component.errorComponentId,
      baselineSpeechCovered: prior.layers.machineSpeech.any,
      baselineAudible: prior.layers.audibleReviewCoverage.audible,
      fingerprintEvidenceIds: ids("LEGACY_FINGERPRINT"),
      sileroNativeEvidenceIds: ids("SILERO", true),
      sileroMultiViewEvidenceIds: ids("SILERO", false),
      pyannoteEvidenceIds: ids("PYANNOTE"),
      multiDetectorIslandIds: input.inventory.islands
        .filter(
          (v) =>
            v.evidenceClass === "MULTI_DETECTOR_CONFIRMED" &&
            overlap(v.sourceInterval, component),
        )
        .map((v) => v.islandId),
      safetyTargetIds: input.safety.targets
        .filter((v) => overlap(v.sourceInterval, component))
        .map((v) => v.targetId),
      finalSpeechCovered: final.layers.machineSpeech.any,
      finalAudible: final.layers.audibleReviewCoverage.audible,
      retainedHistoricalAudioEvidenceIds: fp
        .filter((v) => v.retainedAudioSha256 !== null)
        .map((v) => v.evidenceId),
      historicalAmbiguousEvidenceIds: fp
        .filter((v) => !v.uniquenessPassed)
        .map((v) => v.evidenceId),
      directCoverage,
      primaryDiagnosis,
      unresolvedHistoricalAttribution:
        "UNKNOWN_WITHOUT_VERIFIED_SOURCE_MAPPING",
    };
  });
  const notGoldMissing = input.safety.targets.filter(
    (v) => !missing.some((c) => overlap(v.sourceInterval, c)),
  );
  const additionalRecoveredMissing = sourceContribution.filter(
    (v) => !v.baselineAudible && v.finalAudible,
  ).length;
  const incrementalFullQueueSeconds = Math.max(
    0,
    after.actualAudibleUniqueSeconds - before.actualAudibleUniqueSeconds,
  );
  return c601141EvaluationSchema.parse(
    hashed141({
      ...header141(input.policy, input.inventory.sourceIdentity),
      artifactType: "c6-0-1-14-1-speech-inventory-evaluation",
      generatedAt: input.generatedAt,
      projectionHash: input.projections.semanticHash,
      variants,
      officialPlanId: "FULL_QUEUE_WITH_SAFETY_RESERVE",
      route: route141({
        evaluation: last.evaluation,
        targetBudgetPassed:
          input.safety.summary.targetCount <= 24 &&
          input.safety.summary.targetUnionSeconds <= 60,
      }),
      sourceContribution,
      burden: {
        baselineFullQueueSeconds: before.actualAudibleUniqueSeconds,
        finalFullQueueSeconds: after.actualAudibleUniqueSeconds,
        incrementalFullQueueSeconds,
        episodeRatio:
          after.actualAudibleUniqueSeconds /
          input.inventory.sourceIdentity.durationSeconds,
        newTargetCount: input.safety.targets.length,
        safetyTargetsNotOverlappingGoldMissing: notGoldMissing.length,
        safetyTargetSecondsNotOverlappingGoldMissing: duration141(
          notGoldMissing.map((v) => v.nativeInterval),
          rate,
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
