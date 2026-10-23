import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import {
  firstGoldRead142Schema,
  codeValidation142Schema,
  codeCheckIds142,
  policyBinding142Schema,
  shareable142Schema,
} from "@mvl/shared";
import { persistFirstRead142 } from "../scripts/lib/c601142-first-read.js";
import { auditShareable142 } from "../scripts/lib/c601142-shareable-audit.js";
import { assertMachineFreezePath142 } from "../scripts/lib/c601142-final.js";
import {
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
const h = "a".repeat(64);
function summary() {
  return shareable142Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-2-shareable-acceptance-summary",
      visibility: "SHAREABLE_AGGREGATE_ONLY",
      codeSnapshotHash: h,
      detectorEvidenceHash: h,
      asrEvidenceHash: h,
      finalEvidenceHash: h,
      canonicalTextHash: h,
      canonicalTimingHash: h,
      presentationHash: h,
      detectorFreshCount: 0,
      detectorReplayHits: 0,
      asrFreshCount: 0,
      asrReplayHits: 0,
      finalAReplayInference: 0,
      finalBReplayInference: 0,
      safetyTargetCount: 1,
      safetyUnionSeconds: 2,
      physicalWavCount: 1,
      targetCount: 1,
      regionCount: 1,
      missingComponents: 1,
      audibleMissingComponents: 0,
      fullMissingComponents: 0,
      hallucinationComponents: 1,
      audibleHallucinationComponents: 1,
      fullQueueSeconds: 2,
      engineeringPassed: true,
      evaluationIntegrityPassed: true,
      fullQueueGatePassed: false,
      route: "HOLD_FOR_MASKED_SPEECH_DETECTOR_CEILING",
      productionStatus: "needs-review",
      finalizationMethod: "none",
      c602Status: "HOLD",
      canonicalMutationCount: 0,
      rawDialogueIncluded: false,
      goldIncluded: false,
      nativeScoresIncluded: false,
      localPathsIncluded: false,
    }),
  );
}
describe("C601142 durable first-read and aggregate export boundaries", () => {
  it("accepts only the zero-byte browser OS mutex, not human state or Gold", () => {
    const mutex = "machine/review-workspace/session/workspace-mutation.sqlite";
    expect(assertMachineFreezePath142(mutex, 0)).toBe(true);
    expect(() => assertMachineFreezePath142(mutex, 1)).toThrow();
    for (const file of [
      "machine/review-workspace/session/human-correction-log.json",
      "machine/review-workspace/session/session.json",
      "machine/gold/evaluation.json",
      "machine/human-correction.json",
      "gold/review-workspace/session/workspace-mutation.sqlite",
    ]) {
      expect(() => assertMachineFreezePath142(file, 0)).toThrow();
    }
    expect(assertMachineFreezePath142("machine/review-data.json", 20)).toBe(
      false,
    );
  });
  it("persists an exclusive fsynced intent before any synthetic evaluation read", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "mvl-c601142-first-read-"),
    );
    const input = {
      directory,
      finalAFreezeHash: h,
      finalBFreezeHash: h,
      finalACompletedAt: "2020-01-01T00:00:00.000Z",
      finalBCompletedAt: "2020-01-01T00:00:00.000Z",
      codeSnapshotHash: h,
      codeValidationHash: h,
      browserAuditHash: h,
    };
    const receipt = await persistFirstRead142(input);
    const bytes = await readFile(
      path.join(directory, "c6-0-1-14-2-first-gold-read-intent.json"),
      "utf8",
    );
    expect(firstGoldRead142Schema.parse(JSON.parse(bytes))).toEqual(receipt);
    await expect(persistFirstRead142(input)).rejects.toThrow();
    expect(
      await readFile(
        path.join(directory, "c6-0-1-14-2-first-gold-read-intent.json"),
        "utf8",
      ),
    ).toBe(bytes);
  });
  it.each(["invalid", "9999-01-01T00:00:00.000Z"])(
    "does not write a first-read receipt for invalid or incomplete freeze %s",
    async (completed) => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "mvl-c601142-unfrozen-"),
      );
      await expect(
        persistFirstRead142({
          directory,
          finalAFreezeHash: h,
          finalBFreezeHash: h,
          finalACompletedAt: completed,
          finalBCompletedAt: completed,
          codeSnapshotHash: h,
          codeValidationHash: h,
          browserAuditHash: h,
        }),
      ).rejects.toThrow(/FREEZE_NOT_BEFORE_GOLD/u);
      expect(await readdir(directory)).toEqual([]);
    },
  );
  it("requires every real code check exactly once and rejects fabricated pass status", () => {
    const value = {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-2-code-validation",
      generatedAt: "2020-01-01T00:00:00.000Z",
      nodeVersion: "v24.0.0",
      packageManager: "npm@11.0.0",
      results: codeCheckIds142.map((id) => ({
        id,
        command: ["synthetic-test"],
        exitCode: 0,
        passed: true,
        elapsedSeconds: 0,
        logRelativePath: `${id}.log`,
        logSha256: h,
        testSummary: [],
      })),
      passed: true,
      realAsrExecutedByValidation: false,
      goldEvaluationExecutedByValidation: false,
      rankerTrainingExecutedByValidation: false,
    };
    expect(codeValidation142Schema.safeParse(value).success).toBe(true);
    expect(
      codeValidation142Schema.safeParse({
        ...value,
        results: value.results.slice(1),
      }).success,
    ).toBe(false);
    const bad = structuredClone(value);
    required141(bad.results[0]).exitCode = 1;
    expect(codeValidation142Schema.safeParse(bad).success).toBe(false);
  });
  it("binds the requested policy name without changing the already-frozen execution policy", () => {
    const binding = hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-2-policy-name-binding",
      requestedPolicyVersion:
        "c6.0.1.14.2-detector-exclusive-selection-masked-speech-ceiling-v1",
      frozenExecutionPolicyVersion:
        "c6.0.1.14.2-safety-selection-detector-ceiling-v1",
      executionPolicyHash: h,
      aliasOnly: true,
      thresholdsChanged: false,
      cacheKeysChanged: false,
      inferenceCount: 0,
    });
    expect(policyBinding142Schema.safeParse(binding).success).toBe(true);
    expect(
      policyBinding142Schema.safeParse({ ...binding, thresholdsChanged: true })
        .success,
    ).toBe(false);
  });
  it("allows only aggregate metadata and never claims raw local outputs are public", () => {
    expect(auditShareable142(summary()).passed).toBe(true);
    for (const extra of [
      { candidateText: "synthetic text" },
      { sourceInterval: { start: 1, end: 2 } },
      { scores: [0.2] },
      { localPath: "/Users/synthetic/data" },
      { secret: "hf_" + "x".repeat(30) },
    ])
      expect(auditShareable142({ ...summary(), ...extra }).passed).toBe(false);
  });
});
