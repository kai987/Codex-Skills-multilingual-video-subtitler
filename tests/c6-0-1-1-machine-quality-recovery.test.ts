import {
  machineQualityRecoveryPolicySchema,
  whisperRuntimeExecutionAuditSchema,
  type SubtitleCue,
} from "@mvl/shared";
import {
  allowBaselineCarryPromptForMachineQuality,
  allowRefinementContextPromptForMachineQuality,
  machineQualityTargetChunkSeconds,
  machineQualityProfileUsesVad,
  recoveryPromptCuesForMachineQuality,
} from "@mvl/video-subtitler";
import { buildCanonicalHallucinationIntegrityFindings } from "@mvl/transcription-core";
import { describe, expect, it } from "vitest";

const hash = (character: string): string => character.repeat(64);
const cue: SubtitleCue = {
  id: "provisional-1",
  start: 0,
  end: 1,
  language: "ja",
  languages: ["ja"],
  text: "未検証の仮説",
  speaker: null,
  confidence: 0.5,
};

describe("C6.0.1.1 machine-only quality recovery", () => {
  it("blocks provisional cue text from enforce-mode refinement prompts", () => {
    expect(allowRefinementContextPromptForMachineQuality("off")).toBe(true);
    expect(allowRefinementContextPromptForMachineQuality("observe")).toBe(true);
    expect(allowRefinementContextPromptForMachineQuality("enforce")).toBe(
      false,
    );
  });
  it("blocks cross-chunk machine text carry in enforce mode", () => {
    expect(allowBaselineCarryPromptForMachineQuality("off")).toBe(true);
    expect(allowBaselineCarryPromptForMachineQuality("observe")).toBe(true);
    expect(allowBaselineCarryPromptForMachineQuality("enforce")).toBe(false);
  });
  it("uses VAD for timing and combined full recovery only", () => {
    expect(machineQualityProfileUsesVad("legacy")).toBe(false);
    expect(machineQualityProfileUsesVad("diagnostics")).toBe(false);
    expect(machineQualityProfileUsesVad("coverage")).toBe(false);
    expect(machineQualityProfileUsesVad("timing")).toBe(true);
    expect(machineQualityProfileUsesVad("full")).toBe(true);
  });
  it("keeps off and observe compatible while enforce isolates provisional prompt text", () => {
    expect(
      recoveryPromptCuesForMachineQuality({
        mode: "off",
        provisionalCues: [cue],
      }),
    ).toEqual([cue]);
    expect(
      recoveryPromptCuesForMachineQuality({
        mode: "observe",
        provisionalCues: [cue],
      }),
    ).toEqual([cue]);
    expect(
      recoveryPromptCuesForMachineQuality({
        mode: "enforce",
        provisionalCues: [cue],
      }),
    ).toEqual([]);
  });

  it("uses short chunks only for enforce unless the operator configures a value", () => {
    expect(
      machineQualityTargetChunkSeconds({ mode: "off", configured: undefined }),
    ).toBeUndefined();
    expect(
      machineQualityTargetChunkSeconds({
        mode: "observe",
        configured: undefined,
      }),
    ).toBeUndefined();
    expect(
      machineQualityTargetChunkSeconds({
        mode: "enforce",
        configured: undefined,
      }),
    ).toBe(30);
    expect(
      machineQualityTargetChunkSeconds({ mode: "enforce", configured: 24 }),
    ).toBe(24);
  });

  it("keeps production release and human-derived runtime inputs closed", () => {
    const parsed = machineQualityRecoveryPolicySchema.parse({
      schemaVersion: "1.0.0",
      policyVersion: "c6.0.1.1-machine-quality-recovery-v1",
      generatedAt: "2026-08-27T00:00:00.000Z",
      mode: "enforce",
      profile: "full",
      artifactType: "machine-quality-recovery-policy",
      run: {
        runId: "fixture",
        repositoryCommit: "a".repeat(40),
        sourceMediaSha256: hash("b"),
        goldRuntimeInputCount: 0,
      },
      defaultMode: "off",
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      humanDerivedRuntimeInputAllowed: false,
      strategies: {
        targetChunkSeconds: 30,
        vadMode: "off",
        sceneRouting: "aggressive",
        adjacentPromptPolicy: "disabled-unverified-context",
      },
      milestone: {
        normalizedCerMaximum: 0.65,
        coverageMinimum: 0.8,
        missingDialogueMaximum: 35,
        materialTextDefectMaximum: 30,
        startMaeSecondsMaximum: 1.75,
        endMaeSecondsMaximum: 1.75,
        p95BoundaryErrorSecondsMaximum: 4.5,
        severeTimingDefectMaximum: 25,
        hallucinationMaximum: 2,
      },
    });
    expect(parsed.machineOnlyReleaseAuthorized).toBe(false);
    expect(parsed.productionStatus).toBe("needs-review");
    expect(() =>
      machineQualityRecoveryPolicySchema.parse({ ...parsed, extra: true }),
    ).toThrow();
  });

  it("requires execution counts to come from a concrete runtime audit", () => {
    const parsed = whisperRuntimeExecutionAuditSchema.parse({
      schemaVersion: "1.0.0",
      policyVersion: "c6.0.1.1-machine-quality-recovery-v1",
      generatedAt: "2026-08-27T00:00:00.000Z",
      mode: "enforce",
      profile: "coverage",
      artifactType: "whisper-runtime-execution-audit",
      run: {
        runId: "fixture",
        repositoryCommit: "a".repeat(40),
        sourceMediaSha256: hash("b"),
        goldRuntimeInputCount: 0,
      },
      runtime: {
        intendedVersion: "1.9.1",
        actualVersion: "whisper.cpp version: 1.9.1",
        whisperCppVersion: "1.9.1",
        modelName: "large-v3",
        modelSha256: hash("c"),
        binarySha256: hash("d"),
        runtimeManifest: "blind-generation-input-manifest.json",
        compatibilityReason: "pinned-runtime-matched",
        device: "Apple M1 Pro",
        requestedMode: "process",
        actualMode: "process",
      },
      execution: {
        asrRequestCount: 31,
        cacheHitCount: 1,
        inferenceCount: 30,
        processCount: 30,
        workerStartCount: 30,
        modelLoadCount: 30,
        transcriptionSeconds: 120,
        fallbackProcessCount: 0,
        uniqueAudioIntervalCount: 30,
        duplicateIntervalCount: 1,
        narrowRequestCount: 30,
        broadRequestCount: 1,
        recoveryRequestCount: 1,
        primaryGenerationRequestCount: 30,
        averageAudioSeconds: 30,
        totalAudioSecondsProcessed: 930,
        duplicateAudioSecondsProcessed: 30,
      },
      evidenceQuality: {
        status: "verified",
        inspectedArtifactCount: 1,
        schemaValidatedArtifactCount: 1,
        semanticEvidenceCount: 31,
        reasons: ["request-level-execution-records-inspected"],
      },
    });
    expect(parsed.execution.inferenceCount).toBe(30);
    expect(parsed.execution.modelLoadCount).toBe(30);
  });

  it("does not fabricate one-occurrence cross-utterance repetition evidence", () => {
    const findings = buildCanonicalHallucinationIntegrityFindings([
      {
        id: "canonical-1",
        start: 1,
        end: 3,
        text: "同じ長い句を同じ長い句を同じ長い句を繰り返す",
        qualityStatus: "suspected-hallucination",
        qualityReasons: ["LONG_PHRASE_LOOP"],
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.repetitionEvidence).toBeUndefined();
    expect(findings[0]?.reasons).toContain("LONG_PHRASE_LOOP");
  });
});
