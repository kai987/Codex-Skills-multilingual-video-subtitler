import { describe, expect, it } from "vitest";

import {
  buildAsrCeilingEvaluation,
  buildC6016QualityPolicy,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-28T00:00:00.000Z";

describe("C6.0.1.6 quality policy", () => {
  it("freezes machine-only thresholds without Gold authority", () => {
    const policy = buildC6016QualityPolicy({
      policyFrozenAt: GENERATED_AT,
      generatedAt: GENERATED_AT,
    });
    expect(policy.policyVersion).toBe(
      "c6.0.1.6-acoustic-risk-span-text-joint-boundary-v1",
    );
    expect(policy.goldAccessBeforeFreezeCount).toBe(0);
    expect(policy.goldRuntimeInputAllowed).toBe(false);
    expect(policy.productionStatus).toBe("needs-review");
    expect(policy.finalizationMethod).toBe("none");
    expect(policy.machineReleaseAuthorized).toBe(false);
  });
});

describe("C6.0.1.6 ASR ceiling evaluator", () => {
  it("classifies all evaluator-only recovery and ceiling outcomes", () => {
    const artifact = buildAsrCeilingEvaluation({
      generatedAt: GENERATED_AT,
      errors: [
        {
          errorId: "pipeline",
          cueId: "cue-1",
          machineCandidateIds: ["a", "b"],
          evidenceIds: ["oracle"],
          pipelineDecisionRecoverable: true,
        },
        {
          errorId: "existing",
          cueId: "cue-2",
          machineCandidateIds: ["a", "b"],
          evidenceIds: ["oracle"],
          existingVariantRecoverable: true,
        },
        {
          errorId: "reasr",
          cueId: "cue-3",
          machineCandidateIds: ["a", "reasr:b"],
          evidenceIds: ["oracle"],
          reAsrRecoverable: true,
        },
        {
          errorId: "whisper",
          cueId: "cue-4",
          machineCandidateIds: ["a", "b", "c"],
          evidenceIds: ["oracle"],
          multipleWhisperWindowsEvaluated: true,
          candidateTextAgreement: "CONSISTENT",
        },
        {
          errorId: "association",
          cueId: "cue-5",
          machineCandidateIds: [],
          evidenceIds: ["oracle"],
          associationRemaining: true,
        },
        {
          errorId: "span",
          cueId: "cue-6",
          machineCandidateIds: ["a"],
          evidenceIds: ["oracle"],
          spanLineageBlocked: true,
        },
        {
          errorId: "unknown",
          cueId: null,
          machineCandidateIds: ["a"],
          evidenceIds: ["oracle"],
        },
      ],
    });
    expect(artifact.summary).toMatchObject({
      materialErrorCount: 7,
      recoverableByPipeline: 1,
      recoverableByExistingVariant: 1,
      recoverableByReAsr: 1,
      currentWhisperConsistentlyWrong: 1,
      associationRemaining: 1,
      spanLineageBlocked: 1,
      unknown: 1,
    });
    expect(artifact.zone).toBe("evaluation-only-gold-isolated");
    expect(artifact.runtimeGoldInputCount).toBe(0);
  });

  it("recommends an ASR ensemble only when consistent Whisper errors dominate", () => {
    const artifact = buildAsrCeilingEvaluation({
      generatedAt: GENERATED_AT,
      errors: Array.from({ length: 4 }, (_value, index) => ({
        errorId: `whisper-${index}`,
        cueId: `cue-${index}`,
        machineCandidateIds: ["primary", "recovery", "reasr"],
        evidenceIds: ["post-freeze-oracle"],
        multipleWhisperWindowsEvaluated: true,
        candidateTextAgreement: "CONSISTENT" as const,
      })).concat([
        {
          errorId: "pipeline",
          cueId: "cue-pipeline",
          machineCandidateIds: ["a", "b"],
          evidenceIds: ["post-freeze-oracle"],
          pipelineDecisionRecoverable: true,
          multipleWhisperWindowsEvaluated: false,
          candidateTextAgreement: "UNKNOWN" as const,
        },
      ]),
    });
    expect(artifact.summary.recommendation).toBe("RECOMMEND_ASR_ENSEMBLE_NEXT");
  });
});
