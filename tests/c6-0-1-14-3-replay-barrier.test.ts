import { describe, expect, it } from "vitest";
import { browserAudit143Schema, shareable143Schema } from "@mvl/shared";
import { config143Schema } from "../scripts/lib/c601143-input.js";
import {
  forbiddenProvider143,
  forbiddenRunner143,
} from "../scripts/lib/c601143-replay.js";
import { auditShareable143 } from "../scripts/lib/c601143-shareable-audit.js";
import { assertReplayOnly143 } from "../packages/video-subtitler/src/review/c601143-policy.js";
import { hashed141 } from "../packages/video-subtitler/src/review/c601141-policy.js";
const h = "a".repeat(64);
describe("C6.0.1.14.3 replay and Gold barriers", () => {
  it("accepts only replay-only machine configuration without a Gold-bearing path", () => {
    expect(
      config143Schema.safeParse({
        baselineState: "baseline/state.json",
        outputRoot: "output",
        prefix: "c601143",
        date: "20260901",
        executionPolicy: "replay-only",
      }).success,
    ).toBe(true);
    expect(
      config143Schema.safeParse({
        baselineState: "gold/state.json",
        outputRoot: "output",
        prefix: "c601143",
        date: "20260901",
        executionPolicy: "replay-only",
      }).success,
    ).toBe(false);
    expect(() => assertReplayOnly143("fresh")).toThrow();
  });
  it.each([
    "inferenceCount",
    "modelLoadCount",
    "providerProcessStartCount",
    "cacheMissCount",
  ] as const)("rejects nonzero %s", (key) => {
    expect(() =>
      assertReplayOnly143("replay-only", {
        inferenceCount: 0,
        modelLoadCount: 0,
        providerProcessStartCount: 0,
        cacheMissCount: 0,
        [key]: 1,
      }),
    ).toThrow();
  });
  it("uses construction and process sentinels that always fail", async () => {
    await expect(forbiddenProvider143()).rejects.toThrow(
      /PROVIDER_CONSTRUCTION_FORBIDDEN/u,
    );
    await expect(
      forbiddenRunner143.run({ command: "model", args: [] }),
    ).rejects.toThrow(/PROVIDER_CONSTRUCTION_FORBIDDEN/u);
  });
  it("cannot report a browser pass when an observed check failed", () => {
    const base = {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-3-browser-read-only-acceptance",
      visibility: "LOCAL_ONLY",
      checkedAt: "2026-01-01T00:00:00.000Z",
      workspaceDataByteHash: h,
      workspaceJavascriptByteHash: h,
      checks: [
        { id: "PAGE_IDENTITY", passed: false, detail: "synthetic failure" },
      ],
      consoleErrorCount: 0,
      sessionBefore: null,
      sessionAfter: null,
      savedHumanDecisionCount: 0,
      humanTrialStarted: false,
    };
    expect(
      browserAudit143Schema.safeParse({ ...base, passed: true }).success,
    ).toBe(false);
    expect(
      browserAudit143Schema.safeParse({ ...base, passed: false }).success,
    ).toBe(true);
  });
  it("keeps the shareable artifact aggregate-only and rejects a local-path extension", () => {
    const summary = shareable143Schema.parse(
      hashed141({
        schemaVersion: "1.0.0",
        artifactType: "c6-0-1-14-3-shareable-acceptance-summary",
        visibility: "SHAREABLE_AGGREGATE_ONLY",
        codeSnapshotHash: h,
        obligationHash: h,
        hierarchyHash: h,
        bundleCandidatesHash: h,
        plannerCertificateHash: h,
        finalEvidenceHash: h,
        canonicalTextHash: h,
        canonicalTimingHash: h,
        presentationHash: h,
        detectorReplayHits: 18,
        asrReplayHits: 44,
        finalAReplayInference: 0,
        finalBReplayInference: 0,
        phaseAObligationCount: 1,
        phaseAObligationCoverage: 1,
        phaseARegressionCount: 0,
        childCount: 2,
        bundleCandidateCount: 3,
        safetyTargetCount: 1,
        safetyUnionSeconds: 1,
        physicalWavCount: 1,
        targetCount: 1,
        regionCount: 1,
        missingComponents: 1,
        audibleMissingComponents: 1,
        hallucinationComponents: 1,
        audibleHallucinationComponents: 1,
        fullQueueSeconds: 2,
        fullQueueEpisodeRatio: 0.1,
        engineeringPassed: true,
        evaluationIntegrityPassed: true,
        route: "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
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
    expect(auditShareable143(summary).passed).toBe(true);
    expect(
      auditShareable143({
        ...summary,
        sourcePath: "/Users/example/private.mkv",
      }).passed,
    ).toBe(false);
  });
});
