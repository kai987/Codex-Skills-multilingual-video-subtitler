import {
  c6016PolicyVersion,
  machineAsrCeilingEvaluationSchema,
  type AsrCeilingClass,
  type MachineAsrCeilingEvaluation,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface AsrCeilingErrorInput {
  errorId: string;
  cueId: string | null;
  machineCandidateIds: readonly string[];
  evidenceIds: readonly string[];
  associationRemaining?: boolean;
  spanLineageBlocked?: boolean;
  pipelineDecisionRecoverable?: boolean;
  existingVariantRecoverable?: boolean;
  reAsrRecoverable?: boolean;
  multipleWhisperWindowsEvaluated?: boolean;
  candidateTextAgreement?: "CONSISTENT" | "MIXED" | "UNKNOWN";
}

function classify(input: AsrCeilingErrorInput): AsrCeilingClass {
  if (input.associationRemaining) return "ASSOCIATION_REMAINING";
  if (input.spanLineageBlocked) return "SPAN_LINEAGE_BLOCKED";
  if (input.pipelineDecisionRecoverable) return "PIPELINE_DECISION_RECOVERABLE";
  if (input.existingVariantRecoverable) return "EXISTING_VARIANT_RECOVERABLE";
  if (input.reAsrRecoverable) return "REASR_RECOVERABLE";
  if (
    input.multipleWhisperWindowsEvaluated &&
    input.candidateTextAgreement === "CONSISTENT" &&
    input.machineCandidateIds.length >= 2
  ) {
    return "CURRENT_WHISPER_CONSISTENTLY_WRONG";
  }
  return "UNKNOWN";
}

/** Gold-derived error membership is accepted only in this post-freeze API. */
export function buildAsrCeilingEvaluation(input: {
  errors: readonly AsrCeilingErrorInput[];
  generatedAt?: string;
}): MachineAsrCeilingEvaluation {
  const errors = input.errors
    .map((error) => {
      const classification = classify(error);
      const reasons = [
        `classification:${classification}`,
        ...(error.associationRemaining ? ["association-remains"] : []),
        ...(error.spanLineageBlocked ? ["span-lineage-blocked"] : []),
        ...(error.pipelineDecisionRecoverable
          ? ["machine-pool-contained-better-selection"]
          : []),
        ...(error.existingVariantRecoverable
          ? ["existing-variant-could-recover"]
          : []),
        ...(error.reAsrRecoverable ? ["re-asr-variant-could-recover"] : []),
        ...(error.multipleWhisperWindowsEvaluated
          ? ["multiple-whisper-windows-evaluated"]
          : []),
        `candidate-text-agreement:${error.candidateTextAgreement ?? "UNKNOWN"}`,
      ];
      const core = {
        errorId: error.errorId,
        cueId: error.cueId,
        classification,
        machineCandidateIds: [...new Set(error.machineCandidateIds)].toSorted(),
        evidenceIds: [...new Set(error.evidenceIds)].toSorted(),
        reasons,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    })
    .toSorted((left, right) => left.errorId.localeCompare(right.errorId));
  const countClass = (classification: AsrCeilingClass) =>
    errors.filter((error) => error.classification === classification).length;
  const recoverableByPipeline = countClass("PIPELINE_DECISION_RECOVERABLE");
  const recoverableByExistingVariant = countClass(
    "EXISTING_VARIANT_RECOVERABLE",
  );
  const recoverableByReAsr = countClass("REASR_RECOVERABLE");
  const currentWhisperConsistentlyWrong = countClass(
    "CURRENT_WHISPER_CONSISTENTLY_WRONG",
  );
  const associationRemaining = countClass("ASSOCIATION_REMAINING");
  const spanLineageBlocked = countClass("SPAN_LINEAGE_BLOCKED");
  const unknown = countClass("UNKNOWN");
  const recoverable =
    recoverableByPipeline + recoverableByExistingVariant + recoverableByReAsr;
  const recommendation =
    errors.length === 0
      ? ("INSUFFICIENT_EVIDENCE" as const)
      : currentWhisperConsistentlyWrong >
          Math.max(recoverable, associationRemaining + spanLineageBlocked)
        ? ("RECOMMEND_ASR_ENSEMBLE_NEXT" as const)
        : recoverable > 0
          ? ("CONTINUE_PIPELINE_RECOVERY" as const)
          : ("INSUFFICIENT_EVIDENCE" as const);
  const summary = {
    materialErrorCount: errors.length,
    recoverableByPipeline,
    recoverableByExistingVariant,
    recoverableByReAsr,
    currentWhisperConsistentlyWrong,
    associationRemaining,
    spanLineageBlocked,
    unknown,
    aggregatePotential: errors.length === 0 ? 0 : recoverable / errors.length,
    recommendation,
  };
  const core = {
    zone: "evaluation-only-gold-isolated" as const,
    runtimeGoldInputCount: 0 as const,
    errors,
    summary,
  };
  return machineAsrCeilingEvaluationSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6016PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-asr-ceiling-evaluation",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
