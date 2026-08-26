import { readFileSync } from "node:fs";
import path from "node:path";

import {
  c60ProtectedFinalizationReplaySummarySchema,
  c60ProtectedFinalizationValidationSchema,
  c60ProtectedRiskPolicySchema,
  humanBaselineAuthoritySchema,
  subtitleBaselinePreservationAssessmentSchema,
  subtitleFinalizationEvidenceFreshnessSchema,
  subtitleFinalizationRiskAssessmentSchema,
  subtitleReviewEffectiveDispositionSchema,
} from "@mvl/shared";
import {
  C60_PROTECTED_RISK_POLICY,
  c60SemanticHash,
  evaluateProtectedFinalizationRisk,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import {
  C60_TEST_HASH,
  protectedAuthority,
  protectedFreshness,
  protectedRiskInput,
} from "./helpers/c6-0-protected-fixture.js";

describe("C6.0 protected strict schemas and CLI", () => {
  it("rejects unknown top-level fields in every new artifact contract", () => {
    const assessed = evaluateProtectedFinalizationRisk(protectedRiskInput());
    const replayBase = {
      schemaVersion: "1.0.0" as const,
      artifactType: "c6-0-protected-finalization-replay-summary" as const,
      runId: "fixture-run",
      generatedAt: "2026-08-27T00:00:00.000Z",
      mode: "protected-enforce" as const,
      sourceTask: "fixture-task",
      authorityType: "user-confirmed-human-reviewed" as const,
      authorityVerified: true,
      riskPolicyHash: C60_PROTECTED_RISK_POLICY.policyHash,
      freshnessHash: protectedFreshness().semanticHash,
      rootRiskHash: "1".repeat(64),
      riskAssessmentHash: assessed.riskAssessment.semanticHash,
      reviewDispositionHash: assessed.reviewDisposition.semanticHash,
      legacyStatus: "needs-review",
      protectedOutcome: "FINAL_SAFE_WITH_ADVISORIES" as const,
      effectiveStatus: "human-validated",
      effectiveFinalizationMethod: "human",
      legacyBlockingFindingCount: 14,
      effectiveFinalBlockerCount: 0,
      advisoryCount: 6,
      canonicalCueHashBefore: C60_TEST_HASH.cue,
      canonicalCueHashAfter: C60_TEST_HASH.cue,
      canonicalTimingHashBefore: C60_TEST_HASH.timing,
      canonicalTimingHashAfter: C60_TEST_HASH.timing,
      presentationHash: C60_TEST_HASH.presentation,
      outputFiles: ["subtitle-package.final.json"],
      strictFinalPackageExists: true,
      reviewDeliveryIntegrityPassed: true,
      reviewAudioPlayableCount: 7,
      reviewAudioItemCount: 7,
      modelExecutionCounts: {
        whisper: 0 as const,
        mfa: 0 as const,
        speaker: 0 as const,
        ctc: 0 as const,
        separation: 0 as const,
        openai: 0 as const,
        onlineSubtitleSearch: 0 as const,
        wholeMediaAsr: 0 as const,
        modelInferenceCount: 0 as const,
        modelLoadCount: 0 as const,
      },
      networkUsed: false as const,
    };
    const replay = {
      ...replayBase,
      semanticHash: c60SemanticHash(replayBase),
    };
    const run = {
      runLabel: "legacy" as const,
      taskName: "fixture-task",
      mode: "legacy" as const,
      protectedOutcome: null,
      status: "needs-review",
      finalizationMethod: "none",
      canonicalCueHash: C60_TEST_HASH.cue,
      canonicalTimingHash: C60_TEST_HASH.timing,
      presentationHash: C60_TEST_HASH.presentation,
      riskAssessmentHash: null,
      finalPackageExists: false,
    };
    const validationBase = {
      schemaVersion: "1.0.0" as const,
      artifactType: "c6-0-protected-finalization-validation" as const,
      validationVersion:
        "c6.0-protected-finalization-validation-v1" as const,
      generatedAt: "2026-08-27T00:00:00.000Z",
      runs: [
        run,
        { ...run, runLabel: "default" as const },
        {
          ...run,
          runLabel: "observe" as const,
          mode: "protected-observe" as const,
          protectedOutcome: "FINAL_SAFE_WITH_ADVISORIES" as const,
          riskAssessmentHash: assessed.riskAssessment.semanticHash,
        },
        {
          ...run,
          runLabel: "enforce-a" as const,
          mode: "protected-enforce" as const,
          protectedOutcome: "FINAL_SAFE_WITH_ADVISORIES" as const,
          status: "human-validated",
          finalizationMethod: "human",
          riskAssessmentHash: assessed.riskAssessment.semanticHash,
          finalPackageExists: true,
        },
        {
          ...run,
          runLabel: "enforce-b" as const,
          mode: "protected-enforce" as const,
          protectedOutcome: "FINAL_SAFE_WITH_ADVISORIES" as const,
          status: "human-validated",
          finalizationMethod: "human",
          riskAssessmentHash: assessed.riskAssessment.semanticHash,
          finalPackageExists: true,
        },
        {
          ...run,
          runLabel: "negative-control" as const,
          mode: "protected-enforce" as const,
          protectedOutcome: "MACHINE_ONLY_NOT_AUTHORIZED" as const,
          riskAssessmentHash: "2".repeat(64),
        },
      ],
      legacyDefaultParity: true,
      enforceSemanticParity: true,
      canonicalCueParity: true,
      canonicalTimingParity: true,
      presentationParity: true,
      machineNegativeControlBlocked: true,
      unknownFailClosed: true,
      integrityFailClosed: true,
      policyIntegrityPassed: true,
      freshnessIntegrityPassed: true,
      shareableAuditPassed: true,
      inputReadOnlyVerified: true,
      modelInferenceCount: 0 as const,
      modelLoadCount: 0 as const,
      networkUsed: false as const,
      passed: true,
    };
    const validation = {
      ...validationBase,
      semanticHash: c60SemanticHash(validationBase),
    };
    const artifacts = [
      [c60ProtectedRiskPolicySchema, C60_PROTECTED_RISK_POLICY],
      [humanBaselineAuthoritySchema, protectedAuthority()],
      [subtitleFinalizationEvidenceFreshnessSchema, protectedFreshness()],
      [
        subtitleBaselinePreservationAssessmentSchema,
        assessed.riskAssessment.baselinePreservation,
      ],
      [subtitleFinalizationRiskAssessmentSchema, assessed.riskAssessment],
      [subtitleReviewEffectiveDispositionSchema, assessed.reviewDisposition],
      [c60ProtectedFinalizationReplaySummarySchema, replay],
      [c60ProtectedFinalizationValidationSchema, validation],
    ] as const;
    for (const [schema, artifact] of artifacts) {
      expect(schema.safeParse(artifact).success).toBe(true);
      expect(schema.safeParse({ ...artifact, unexpected: true }).success).toBe(
        false,
      );
    }
  });

  it("defaults the CLI to legacy and exposes no unsafe escape hatch", () => {
    const cli = readFileSync(
      path.resolve("apps/cli/src/index.ts"),
      "utf8",
    );
    expect(cli).toContain('"--c6-finalization-policy <mode>"');
    expect(cli).toContain('.default("legacy")');
    for (const forbidden of [
      "--force-finalize",
      "--unsafe-finalize",
      "--ignore-risk",
      "--ignore-blind-proof",
      "--disable-integrity",
      "--force-machine-zero-touch",
    ]) {
      expect(cli).not.toContain(forbidden);
    }
  });
});
