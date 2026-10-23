import { existsSync } from "node:fs";
import type * as ChildProcess from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  c60ProtectedFinalizationReplaySummarySchema,
  humanBaselineAuthoritySchema,
  subtitleFinalizationEvidenceFreshnessSchema,
  subtitleFinalizationReportSchema,
  subtitleFinalizationRiskAssessmentSchema,
  subtitlePackageSchema,
  subtitleReviewPackageSchema,
} from "@mvl/shared";
import {
  canonicalTimingHash,
  finalizeProtectedExistingTask,
  sha256LocalFile,
  sha256Value,
} from "@mvl/video-subtitler";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createSyntheticProtectedFinalizationFixture } from "../helpers/synthetic-protected-finalization-fixture.js";

const forbiddenProcess = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error(
      "Synthetic protected finalization must never launch a process",
    );
  }),
);
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof ChildProcess>()),
  exec: forbiddenProcess,
  execSync: forbiddenProcess,
  execFile: forbiddenProcess,
  execFileSync: forbiddenProcess,
  spawn: forbiddenProcess,
  spawnSync: forbiddenProcess,
  fork: forbiddenProcess,
}));

// Simulated explicit authority over authored fixture text, never evidence of a
// real human review. The production orchestration entry is not mocked.
describe("C6.0 protected finalization synthetic orchestration", () => {
  let root = "";
  let fixture: Awaited<
    ReturnType<typeof createSyntheticProtectedFinalizationFixture>
  >;
  let negativeTask = "";
  const forbiddenFetch = vi.fn(() => {
    throw new Error("Synthetic test must stay offline");
  });
  beforeAll(async () => {
    vi.stubGlobal("fetch", forbiddenFetch);
    root = await mkdtemp(path.join(tmpdir(), "mvl-c60-synthetic-e2e-"));
    fixture = await createSyntheticProtectedFinalizationFixture(root);
    negativeTask = path.join(root, "negative-synthetic-task");
    await cp(fixture.taskDirectory, negativeTask, { recursive: true });
  }, 30_000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (root !== "" && path.basename(root).startsWith("mvl-c60-synthetic-e2e-"))
      await rm(root, { recursive: true, force: true });
  });
  const json = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(file, "utf8")) as unknown;
  const noFinal = (directory: string) => {
    expect(
      existsSync(path.join(directory, "subtitle-package.final.json")),
    ).toBe(false);
    for (const extension of ["srt", "vtt", "ass"])
      expect(
        existsSync(path.join(directory, `synthetic.final.${extension}`)),
      ).toBe(false);
  };

  it("observes legacy output, then materializes only verified-human preservation", async () => {
    const sourceHash = await sha256LocalFile(fixture.sourceVideo);
    const humanHash = await sha256LocalFile(fixture.humanSubtitle);
    const packagePath = path.join(
      fixture.subtitleDirectory,
      "subtitle-package.needs-review.json",
    );
    const packageBytes = await readFile(packagePath);
    const draftBytes = await Promise.all(
      ["srt", "vtt", "ass"].map((extension) =>
        readFile(
          path.join(fixture.subtitleDirectory, `synthetic.${extension}`),
        ),
      ),
    );
    const observed = await finalizeProtectedExistingTask({
      taskDirectory: fixture.taskDirectory,
      mode: "protected-observe",
      generatedAt: "2026-01-01T01:00:00.000Z",
      humanReviewedSubtitlePath: fixture.humanSubtitle,
      sourceVideoPath: fixture.sourceVideo,
    });
    expect(observed.report).toMatchObject({
      status: "needs-review",
      finalizationMethod: "none",
      metrics: { blockingFindingCount: 14, reviewItemCount: 7 },
    });
    noFinal(observed.subtitleDirectory);
    const authority = humanBaselineAuthoritySchema.parse(
      await json(
        path.join(observed.subtitleDirectory, "human-baseline-authority.json"),
      ),
    );
    expect(authority).toMatchObject({
      authorityVerified: true,
      readOnlyVerified: true,
      sourceVideoReadOnlyVerified: true,
      coverageVerified: true,
      lineageVerified: true,
      sourceFileSha256: humanHash,
      sourceVideoSha256: sourceHash,
      verificationFailures: [],
    });
    const freshness = subtitleFinalizationEvidenceFreshnessSchema.parse(
      await json(
        path.join(
          observed.subtitleDirectory,
          "subtitle-finalization-evidence-freshness.json",
        ),
      ),
    );
    expect(freshness).toMatchObject({
      integrityPassed: true,
      baseCueHash: fixture.cueHash,
      baseTimingHash: fixture.timingHash,
      summary: { assessedCount: 2, supersededCount: 2, failedCount: 0 },
    });
    expect(
      freshness.entries.every(
        (entry) =>
          entry.freshnessStatus === "superseded" && entry.lineageCompatible,
      ),
    ).toBe(true);
    // A reviewed label alone is insufficient: the entire disk and cue lineage
    // must verify. This is still simulated authority, not a real review.
    const foreignAss = path.join(root, "different-synthetic-review.ass");
    await writeFile(
      foreignAss,
      (await readFile(fixture.humanSubtitle, "utf8")).replace(
        "青い札",
        "青い丸札",
      ),
    );
    const rejected = await finalizeProtectedExistingTask({
      taskDirectory: fixture.taskDirectory,
      mode: "protected-enforce",
      humanReviewedSubtitlePath: foreignAss,
      sourceVideoPath: fixture.sourceVideo,
      generatedAt: "2026-01-01T01:00:30.000Z",
    });
    expect(rejected.report.status).toBe("needs-review");
    noFinal(rejected.subtitleDirectory);
    const rejectedAuthority = humanBaselineAuthoritySchema.parse(
      await json(
        path.join(rejected.subtitleDirectory, "human-baseline-authority.json"),
      ),
    );
    expect(rejectedAuthority.authorityVerified).toBe(false);
    expect(rejectedAuthority.verificationFailures).toContain(
      "HUMAN_SOURCE_IDENTITY_MISMATCH",
    );
    // An unsupported saved diagnostic must still fail closed; synthetic input
    // labels cannot silently expand the production exact-code policy.
    const unknownTask = path.join(root, "unknown-synthetic-task");
    await cp(fixture.taskDirectory, unknownTask, { recursive: true });
    const unknownReportPath = path.join(
      unknownTask,
      "subtitle-synthetic",
      "subtitle-finalization-report.json",
    );
    const savedReport = subtitleFinalizationReportSchema.parse(
      await json(unknownReportPath),
    );
    await writeFile(
      unknownReportPath,
      JSON.stringify(
        subtitleFinalizationReportSchema.parse({
          ...savedReport,
          qualityGate: {
            ...savedReport.qualityGate,
            blockingCodes: [
              ...savedReport.qualityGate.blockingCodes,
              "SYNTHETIC_UNKNOWN_FINALIZATION_CODE",
            ],
          },
        }),
      ),
    );
    const unknownResult = await finalizeProtectedExistingTask({
      taskDirectory: unknownTask,
      mode: "protected-enforce",
      humanReviewedSubtitlePath: fixture.humanSubtitle,
      sourceVideoPath: fixture.sourceVideo,
      generatedAt: "2026-01-01T01:00:45.000Z",
    });
    expect(unknownResult.report.status).toBe("needs-review");
    noFinal(unknownResult.subtitleDirectory);
    const unknownRisk = subtitleFinalizationRiskAssessmentSchema.parse(
      await json(
        path.join(
          unknownResult.subtitleDirectory,
          "subtitle-finalization-risk-assessment.json",
        ),
      ),
    );
    expect(unknownRisk.signalAssessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SYNTHETIC_UNKNOWN_FINALIZATION_CODE",
          policyMatched: false,
          finalBlocking: true,
        }),
      ]),
    );
    expect(unknownRisk.baselinePreservation.applied).toBe(false);
    expect(unknownRisk.baselinePreservation.checks).toMatchObject({
      noUnknownObservedSignals: false,
      humanAuthorityVerified: true,
      freshnessIntegrityPassed: true,
      serializationRoundTripPassed: true,
      formatSemanticParityPassed: true,
      presentationIntegrityPassed: true,
      reviewDeliveryIntegrityPassed: true,
    });
    const enforced = await finalizeProtectedExistingTask({
      taskDirectory: fixture.taskDirectory,
      mode: "protected-enforce",
      generatedAt: "2026-01-01T01:01:00.000Z",
      humanReviewedSubtitlePath: fixture.humanSubtitle,
      sourceVideoPath: fixture.sourceVideo,
    });
    const risk = subtitleFinalizationRiskAssessmentSchema.parse(
      await json(
        path.join(
          enforced.subtitleDirectory,
          "subtitle-finalization-risk-assessment.json",
        ),
      ),
    );
    expect(
      enforced.report,
      JSON.stringify({
        outcome: risk.protectedOutcome,
        preservation: risk.baselinePreservation,
        signals: risk.signalAssessments.filter(
          (signal) => signal.finalBlocking || !signal.policyMatched,
        ),
      }),
    ).toMatchObject({
      status: "human-validated",
      finalizationMethod: "human",
      metrics: { blockingFindingCount: 14, reviewItemCount: 7 },
      qualityGate: { passed: true },
    });
    const strictPackage = subtitlePackageSchema.parse(
      await json(enforced.outputPaths.subtitlePackage),
    );
    expect(strictPackage.primarySubtitle?.validationStatus).toBe("validated");
    expect(strictPackage.cues).toEqual(fixture.cues);
    expect(sha256Value(strictPackage.cues)).toBe(fixture.cueHash);
    expect(canonicalTimingHash(strictPackage.cues)).toBe(fixture.timingHash);
    expect(risk.protectedOutcome).toBe("FINAL_SAFE_WITH_ADVISORIES");
    expect(risk.summary).toMatchObject({
      effectiveMandatoryReviewCount: 0,
      effectiveAdvisoryReviewCount: 6,
      preservationSupportedReviewCount: 1,
      speakerRelationshipResolvedComponentCount: 1,
      subtitleOverlapResolvedComponentCount: 0,
    });
    expect(risk.baselinePreservation).toMatchObject({
      applied: true,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      canonicalCueHashBefore: fixture.cueHash,
      canonicalCueHashAfter: fixture.cueHash,
      canonicalTimingHashBefore: fixture.timingHash,
      canonicalTimingHashAfter: fixture.timingHash,
    });
    const review = subtitleReviewPackageSchema.parse(
      await json(
        path.join(enforced.subtitleDirectory, "subtitle-review-package.json"),
      ),
    );
    expect(review.items).toHaveLength(7);
    expect(await readFile(packagePath)).toEqual(packageBytes);
    for (const [index, output] of [
      enforced.outputPaths.srt,
      enforced.outputPaths.vtt,
      enforced.outputPaths.ass,
    ].entries())
      expect(await readFile(output)).toEqual(draftBytes[index]);
    expect(await sha256LocalFile(fixture.sourceVideo)).toBe(sourceHash);
    expect(await sha256LocalFile(fixture.humanSubtitle)).toBe(humanHash);
    const replay = c60ProtectedFinalizationReplaySummarySchema.parse(
      await json(
        path.join(
          fixture.taskDirectory,
          "c6-0-protected-finalization-replay-summary.json",
        ),
      ),
    );
    expect(replay).toMatchObject({
      authorityVerified: true,
      strictFinalPackageExists: true,
      networkUsed: false,
      modelExecutionCounts: { modelInferenceCount: 0, modelLoadCount: 0 },
      canonicalCueHashBefore: fixture.cueHash,
      canonicalCueHashAfter: fixture.cueHash,
      canonicalTimingHashBefore: fixture.timingHash,
      canonicalTimingHashAfter: fixture.timingHash,
    });
    expect(forbiddenProcess).not.toHaveBeenCalled();
    expect(forbiddenFetch).not.toHaveBeenCalled();
  }, 30_000);

  it("keeps the authority-negative control fail closed without a final package", async () => {
    const sourceBefore = await sha256LocalFile(fixture.sourceVideo);
    const result = await finalizeProtectedExistingTask({
      taskDirectory: negativeTask,
      mode: "protected-enforce",
      generatedAt: "2026-01-01T01:02:00.000Z",
      sourceVideoPath: fixture.sourceVideo,
    });
    expect(result.report).toMatchObject({
      status: "needs-review",
      finalizationMethod: "none",
    });
    noFinal(result.subtitleDirectory);
    const replay = c60ProtectedFinalizationReplaySummarySchema.parse(
      await json(
        path.join(
          negativeTask,
          "c6-0-protected-finalization-replay-summary.json",
        ),
      ),
    );
    expect(replay).toMatchObject({
      protectedOutcome: "MACHINE_ONLY_NOT_AUTHORIZED",
      authorityVerified: false,
      strictFinalPackageExists: false,
      networkUsed: false,
      modelExecutionCounts: {
        whisper: 0,
        mfa: 0,
        speaker: 0,
        ctc: 0,
        separation: 0,
        openai: 0,
        onlineSubtitleSearch: 0,
        wholeMediaAsr: 0,
        modelInferenceCount: 0,
        modelLoadCount: 0,
      },
    });
    const strictPackage = subtitlePackageSchema.parse(
      await json(result.outputPaths.subtitlePackage),
    );
    expect(strictPackage.primarySubtitle?.validationStatus).toBe(
      "needs-review",
    );
    expect(strictPackage.cues).toEqual(fixture.cues);
    expect(canonicalTimingHash(strictPackage.cues)).toBe(fixture.timingHash);
    expect(await sha256LocalFile(fixture.sourceVideo)).toBe(sourceBefore);
    expect(forbiddenProcess).not.toHaveBeenCalled();
    expect(forbiddenFetch).not.toHaveBeenCalled();
  }, 30_000);
});
