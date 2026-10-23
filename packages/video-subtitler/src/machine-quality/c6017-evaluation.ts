import {
  associationErrorClassSchema,
  c6017PolicyVersion,
  machineAsrCeilingEvaluationV2Schema,
  machineAssociationErrorTaxonomySchema,
  machineReAsrCausalEvaluationSchema,
  type AssociationErrorClass,
  type MachineAsrCeilingEvaluationV2,
  type MachineAssociationErrorTaxonomy,
  type MachineFreshCandidateComparison,
  type MachineFreshTargetedReAsr,
  type MachineReAsrCausalEvaluation,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildReAsrCausalEvaluation(input: {
  events: readonly {
    eventId: string;
    baselineDistance: number | null;
    oldPoolBestDistance: number | null;
    freshPoolBestDistance: number | null;
    runtimeSelectedDistance: number | null;
    freshWindowUnstable: boolean;
    replacementApplied: boolean;
    evidenceIds: readonly string[];
  }[];
  generatedAt?: string;
}): MachineReAsrCausalEvaluation {
  const events = input.events.map((event) => {
    const evaluable =
      event.baselineDistance !== null &&
      event.oldPoolBestDistance !== null &&
      event.freshPoolBestDistance !== null;
    const baselineGoldError = evaluable
      ? (event.baselineDistance ?? 0) > 0.02
      : null;
    const poolImproved = evaluable
      ? (event.freshPoolBestDistance ?? 1) + 0.02 <
        (event.oldPoolBestDistance ?? 1)
      : null;
    const poolWorsened = evaluable
      ? (event.freshPoolBestDistance ?? 0) >
        (event.oldPoolBestDistance ?? 0) + 0.02
      : false;
    const safeReplacementGoldImproved =
      evaluable &&
      event.replacementApplied &&
      event.runtimeSelectedDistance !== null
        ? event.runtimeSelectedDistance + 0.02 < (event.baselineDistance ?? 0)
        : event.replacementApplied
          ? false
          : null;
    const classification = !evaluable
      ? ("UNEVALUABLE" as const)
      : !baselineGoldError
        ? ("BEFORE_CORRECT" as const)
        : event.freshWindowUnstable
          ? ("BEFORE_WRONG_AFTER_UNSTABLE" as const)
          : poolImproved
            ? ("BEFORE_WRONG_AFTER_IMPROVED" as const)
            : poolWorsened
              ? ("BEFORE_WRONG_AFTER_WORSE" as const)
              : ("BEFORE_WRONG_AFTER_SAME" as const);
    const core = {
      eventId: event.eventId,
      classification,
      baselineDistance: event.baselineDistance,
      oldPoolBestDistance: event.oldPoolBestDistance,
      freshPoolBestDistance: event.freshPoolBestDistance,
      runtimeSelectedDistance: event.runtimeSelectedDistance,
      baselineGoldError,
      poolImproved,
      safeReplacementGoldImproved,
      evidenceIds: [...new Set(event.evidenceIds)].toSorted(),
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const evaluable = events.filter(
    (event) => event.classification !== "UNEVALUABLE",
  );
  const baselineWrong = evaluable.filter(
    (event) => event.baselineGoldError === true,
  );
  const improved = events.filter(
    (event) => event.classification === "BEFORE_WRONG_AFTER_IMPROVED",
  );
  const appliedGoldImproved = events.filter(
    (event) => event.safeReplacementGoldImproved === true,
  );
  const oldDistances = evaluable.flatMap((event) =>
    event.oldPoolBestDistance === null ? [] : [event.oldPoolBestDistance],
  );
  const freshDistances = evaluable.flatMap((event) =>
    event.freshPoolBestDistance === null ? [] : [event.freshPoolBestDistance],
  );
  const selectedDistances = evaluable.flatMap((event) =>
    event.runtimeSelectedDistance === null
      ? []
      : [event.runtimeSelectedDistance],
  );
  const summary = {
    selectedEventCount: events.length,
    evaluableCount: evaluable.length,
    selectedEventGoldErrorHitCount: baselineWrong.length,
    baselineWrongSelectedCount: baselineWrong.length,
    beforeCorrectCount: events.filter(
      (event) => event.classification === "BEFORE_CORRECT",
    ).length,
    improvedCount: improved.length,
    noImprovementCount: events.filter(
      (event) => event.classification === "BEFORE_WRONG_AFTER_SAME",
    ).length,
    worsenedCount: events.filter(
      (event) => event.classification === "BEFORE_WRONG_AFTER_WORSE",
    ).length,
    unstableCount: events.filter(
      (event) => event.classification === "BEFORE_WRONG_AFTER_UNSTABLE",
    ).length,
    unevaluableCount: events.filter(
      (event) => event.classification === "UNEVALUABLE",
    ).length,
    baselineErrorHitRate:
      evaluable.length === 0 ? 0 : baselineWrong.length / evaluable.length,
    recoveryRate:
      baselineWrong.length === 0 ? 0 : improved.length / baselineWrong.length,
    safeReplacementRate:
      improved.length === 0 ? 0 : appliedGoldImproved.length / improved.length,
    oldPoolOracleQuality: bounded(1 - average(oldDistances)),
    freshPoolOracleQuality: bounded(1 - average(freshDistances)),
    oracleImprovement: average(oldDistances) - average(freshDistances),
    selectorRegretBefore: bounded(
      average(selectedDistances) - average(oldDistances),
    ),
    selectorRegretAfter: bounded(
      average(selectedDistances) - average(freshDistances),
    ),
  };
  const core = {
    zone: "evaluation-only-gold-isolated-post-freeze" as const,
    runtimeGoldInputCount: 0 as const,
    events,
    summary,
  };
  return machineReAsrCausalEvaluationSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6017PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-reasr-causal-evaluation",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

function ceilingClassification(input: {
  causal: MachineReAsrCausalEvaluation["events"][number] | undefined;
  comparison: MachineFreshCandidateComparison["events"][number] | undefined;
  inferenceVerified: boolean;
  stable: boolean;
  requestVerified: boolean;
}): MachineAsrCeilingEvaluationV2["perEventEntries"][number]["classification"] {
  if (!input.inferenceVerified) return "REASR_UNTESTED_POTENTIAL";
  if (!input.requestVerified || input.causal === undefined)
    return "UNEVALUABLE";
  if (input.causal.classification === "UNEVALUABLE") return "UNEVALUABLE";
  if (
    input.causal.classification === "BEFORE_WRONG_AFTER_UNSTABLE" ||
    !input.stable
  ) {
    return "WHISPER_WINDOW_INSTABILITY";
  }
  if (input.comparison?.replacementApplied === true) {
    return input.causal.safeReplacementGoldImproved === true
      ? "REASR_TESTED_SAFE_REPLACEMENT"
      : "REASR_TESTED_UNSAFE_REPLACEMENT";
  }
  if (input.causal.classification === "BEFORE_WRONG_AFTER_IMPROVED") {
    if (input.comparison?.applicationBlocker === "SPAN_LINEAGE")
      return "SPAN_APPLICATION_BLOCKER";
    if (
      input.comparison?.replacementProposed === true ||
      input.comparison?.applicationBlocker === "SELECTOR" ||
      input.comparison?.applicationBlocker === "SAFETY_GATE" ||
      input.comparison?.applicationBlocker === "ASSOCIATION"
    ) {
      return "SELECTOR_APPLICATION_BLOCKER";
    }
    return "REASR_TESTED_IMPROVED_POOL";
  }
  if (input.causal.classification === "BEFORE_WRONG_AFTER_WORSE")
    return "REASR_TESTED_WORSENED_POOL";
  if (
    input.causal.classification === "BEFORE_WRONG_AFTER_SAME" &&
    input.causal.baselineGoldError === true
  ) {
    return "WHISPER_MULTIWINDOW_CONSISTENT_ERROR";
  }
  return "REASR_TESTED_NO_IMPROVEMENT";
}

export function buildAsrCeilingEvaluationV2(input: {
  fresh: MachineFreshTargetedReAsr;
  comparison: MachineFreshCandidateComparison;
  causal: MachineReAsrCausalEvaluation;
  generatedAt?: string;
}): MachineAsrCeilingEvaluationV2 {
  const comparisonByEvent = new Map(
    input.comparison.events.map((event) => [event.eventId, event]),
  );
  const causalByEvent = new Map(
    input.causal.events.map((event) => [event.eventId, event]),
  );
  const requestsByEvent = new Map<string, typeof input.fresh.requests>();
  for (const request of input.fresh.requests) {
    const current = requestsByEvent.get(request.eventId) ?? [];
    current.push(request);
    requestsByEvent.set(request.eventId, current);
  }
  const stableFamilies = new Set(input.fresh.stableWindowFamilies);
  const entries = input.fresh.selectedEvents.map((selected) => {
    const requests = requestsByEvent.get(selected.eventId) ?? [];
    const family = requests[0]?.requestFamilyId;
    const inferenceVerified = requests.some(
      (request) => request.inferenceExecuted,
    );
    const audioIntervalVerified =
      requests.length > 0 &&
      requests.every(
        (request) =>
          request.sampleCount ===
          request.sourceGlobalSampleInterval.endSample -
            request.sourceGlobalSampleInterval.startSample,
      );
    const promptIsolationVerified = requests.length > 0;
    const decoderOutputValid = requests.every(
      (request) => request.decoderEvidence.decoderSegmentCount > 0,
    );
    const stable = family !== undefined && stableFamilies.has(family);
    const causal = causalByEvent.get(selected.eventId);
    const comparison = comparisonByEvent.get(selected.eventId);
    const classification = ceilingClassification({
      causal,
      comparison,
      inferenceVerified,
      stable,
      requestVerified:
        audioIntervalVerified && promptIsolationVerified && decoderOutputValid,
    });
    const core = {
      eventId: selected.eventId,
      classification,
      freshInferenceVerified: inferenceVerified,
      audioIntervalVerified,
      promptIsolationVerified,
      decoderOutputValid,
      freshWindowAgreement: stable
        ? ("CONSISTENT" as const)
        : requests.length > 1
          ? ("UNSTABLE" as const)
          : ("UNKNOWN" as const),
      runtimeReplacementApplied: comparison?.replacementApplied ?? false,
      goldImproved: causal?.safeReplacementGoldImproved ?? null,
      evidenceIds: [
        selected.semanticHash,
        ...requests.map((request) => request.semanticHash),
        ...(causal === undefined ? [] : [causal.semanticHash]),
        ...(comparison === undefined ? [] : [comparison.semanticHash]),
      ],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const countClass = (
    classification: (typeof entries)[number]["classification"],
  ) =>
    entries.filter((entry) => entry.classification === classification).length;
  const pipelineEvidence =
    countClass("REASR_TESTED_IMPROVED_POOL") +
    countClass("REASR_TESTED_SAFE_REPLACEMENT") +
    countClass("SELECTOR_APPLICATION_BLOCKER") +
    countClass("SPAN_APPLICATION_BLOCKER");
  const asrEvidence = countClass("WHISPER_MULTIWINDOW_CONSISTENT_ERROR");
  const pipelineVsAsrDecision =
    pipelineEvidence > 0 && asrEvidence > 0
      ? ("MIXED" as const)
      : pipelineEvidence > 0
        ? ("PIPELINE_STILL_PRIMARY" as const)
        : asrEvidence > 0
          ? ("ASR_STILL_PRIMARY" as const)
          : ("INSUFFICIENT_EVIDENCE" as const);
  const summary = {
    untestedPotential: countClass("REASR_UNTESTED_POTENTIAL"),
    testedImprovedPool: countClass("REASR_TESTED_IMPROVED_POOL"),
    testedNoImprovement: countClass("REASR_TESTED_NO_IMPROVEMENT"),
    testedWorsened: countClass("REASR_TESTED_WORSENED_POOL"),
    testedSafeReplacement: countClass("REASR_TESTED_SAFE_REPLACEMENT"),
    testedUnsafeReplacement: countClass("REASR_TESTED_UNSAFE_REPLACEMENT"),
    whisperMultiwindowConsistentError: asrEvidence,
    whisperWindowInstability: countClass("WHISPER_WINDOW_INSTABILITY"),
    selectorApplicationBlocker: countClass("SELECTOR_APPLICATION_BLOCKER"),
    spanApplicationBlocker: countClass("SPAN_APPLICATION_BLOCKER"),
    poolInsufficient: countClass("POOL_INSUFFICIENT"),
    unevaluable: countClass("UNEVALUABLE"),
    pipelineVsAsrDecision,
    recommendAsrEnsembleNext:
      pipelineVsAsrDecision === "ASR_STILL_PRIMARY" ||
      (pipelineVsAsrDecision === "MIXED" && asrEvidence >= pipelineEvidence),
    ceilingValidationPassed:
      input.fresh.summary.freshReasrValidationPassed &&
      entries.length > 0 &&
      entries.every(
        (entry) =>
          entry.freshInferenceVerified &&
          entry.audioIntervalVerified &&
          entry.promptIsolationVerified &&
          entry.decoderOutputValid,
      ),
  };
  const core = {
    zone: "evaluation-only-gold-isolated-post-freeze" as const,
    runtimeGoldInputCount: 0 as const,
    perEventEntries: entries,
    summary,
  };
  return machineAsrCeilingEvaluationV2Schema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6017PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-asr-ceiling-evaluation-v2",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

export interface AssociationTaxonomyInput {
  errorId: string;
  eventIds: readonly string[];
  finalCueIds: readonly string[];
  trueWrongUtteranceAssignment: boolean;
  segmentationAmbiguity: boolean;
  eventBoundaryAmbiguity: boolean;
  spanLineageAmbiguity: boolean;
  evidenceIds: readonly string[];
}

export function classifyAssociationError(
  input: AssociationTaxonomyInput,
): AssociationErrorClass {
  const classification = input.trueWrongUtteranceAssignment
    ? "TRUE_ASSOCIATION_MISMATCH"
    : input.eventIds.length > 1 && input.finalCueIds.length === 1
      ? "MANY_TO_ONE_EXPECTED"
      : input.eventIds.length === 1 && input.finalCueIds.length > 1
        ? "ONE_TO_MANY_EXPECTED"
        : input.segmentationAmbiguity
          ? "SEGMENTATION_AMBIGUITY"
          : input.eventIds.length > 1 || input.finalCueIds.length > 1
            ? "NON_UNIQUE_EVENT_TO_CUE_MAPPING"
            : input.eventBoundaryAmbiguity
              ? "EVENT_BOUNDARY_AMBIGUITY"
              : input.spanLineageAmbiguity
                ? "SPAN_LINEAGE_AMBIGUITY"
                : "UNKNOWN_ASSOCIATION";
  return associationErrorClassSchema.parse(classification);
}

export function buildAssociationErrorTaxonomy(input: {
  errors: readonly AssociationTaxonomyInput[];
  oldAssociationErrorCount: number;
  generatedAt?: string;
}): MachineAssociationErrorTaxonomy {
  const entries = input.errors.map((error) => {
    const classification = classifyAssociationError(error);
    const core = {
      errorId: error.errorId,
      eventIds: [...new Set(error.eventIds)].toSorted(),
      finalCueIds: [...new Set(error.finalCueIds)].toSorted(),
      classification,
      evidenceIds: [...new Set(error.evidenceIds)].toSorted(),
      reasons: [
        `classification:${classification}`,
        `event-count:${error.eventIds.length}`,
        `final-cue-count:${error.finalCueIds.length}`,
      ],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const classCount = (classification: AssociationErrorClass) =>
    entries.filter((entry) => entry.classification === classification).length;
  const summary = {
    oldAssociationErrorCount: input.oldAssociationErrorCount,
    trueAssociationMismatchCount: classCount("TRUE_ASSOCIATION_MISMATCH"),
    nonUniqueMappingCount: classCount("NON_UNIQUE_EVENT_TO_CUE_MAPPING"),
    segmentationAmbiguityCount: classCount("SEGMENTATION_AMBIGUITY"),
    manyToOneExpectedCount: classCount("MANY_TO_ONE_EXPECTED"),
    oneToManyExpectedCount: classCount("ONE_TO_MANY_EXPECTED"),
    eventBoundaryAmbiguityCount: classCount("EVENT_BOUNDARY_AMBIGUITY"),
    spanLineageAmbiguityCount: classCount("SPAN_LINEAGE_AMBIGUITY"),
    unknownAssociationCount: classCount("UNKNOWN_ASSOCIATION"),
  };
  const core = {
    zone: "evaluation-only-gold-isolated-post-freeze" as const,
    runtimeGoldInputCount: 0 as const,
    entries,
    summary,
  };
  return machineAssociationErrorTaxonomySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6017PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-association-error-taxonomy",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
