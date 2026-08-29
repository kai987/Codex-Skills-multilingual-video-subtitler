import { existsSync, readdirSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  c60ProtectedFinalizationReplaySummarySchema,
  subtitleFinalizationRiskAssessmentSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import {
  canonicalTimingHash,
  finalizeProtectedExistingTask,
  sha256Value,
} from "@mvl/video-subtitler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sourceTask =
  process.env.MVL_C6_C519_TASK ??
  "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-19-series-memory-bootstrap-20260827";
const sourceVideo =
  process.env.MVL_C6_SOURCE_VIDEO ??
  "/Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv";
const sourceSubtitleDirectory = existsSync(sourceTask)
  ? path.join(sourceTask, requireSingleSubtitleDirectory(sourceTask))
  : sourceTask;
const humanSubtitle = path.join(
  sourceSubtitleDirectory,
  "machine-review-draft-contradiction-audited",
  "machine-review-draft-contradiction-audited.ass",
);
const realFixtureAvailable =
  existsSync(sourceTask) &&
  existsSync(sourceVideo) &&
  existsSync(humanSubtitle);

function requireSingleSubtitleDirectory(taskRoot: string): string {
  const matches = readdirSync(taskRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => entry.name);
  return matches.length === 1
    ? (matches.at(0) ?? "missing-subtitle-directory")
    : "missing-subtitle-directory";
}

describe.skipIf(!realFixtureAvailable)(
  "C6.0 protected finalization real-artifact flow",
  () => {
    let root = "";
    let humanTask = "";
    let negativeTask = "";

    beforeAll(async () => {
      root = await mkdtemp(path.join(tmpdir(), "mvl-c60-e2e-"));
      humanTask = path.join(root, "human");
      negativeTask = path.join(root, "negative");
      await cp(sourceTask, humanTask, { recursive: true });
      await cp(sourceTask, negativeTask, { recursive: true });
    });

    afterAll(async () => {
      if (root !== "") await rm(root, { recursive: true, force: true });
    });

    it("observes legacy output, then materializes only verified-human preservation", async () => {
      const observed = await finalizeProtectedExistingTask({
        taskDirectory: humanTask,
        mode: "protected-observe",
        generatedAt: "2026-08-27T01:00:00.000Z",
        humanReviewedSubtitlePath: humanSubtitle,
        sourceVideoPath: sourceVideo,
      });
      expect(observed.report).toMatchObject({
        status: "needs-review",
        finalizationMethod: "none",
        metrics: { blockingFindingCount: 14, reviewItemCount: 7 },
      });
      expect(
        existsSync(
          path.join(observed.subtitleDirectory, "subtitle-package.final.json"),
        ),
      ).toBe(false);

      const enforced = await finalizeProtectedExistingTask({
        taskDirectory: humanTask,
        mode: "protected-enforce",
        generatedAt: "2026-08-27T01:01:00.000Z",
        humanReviewedSubtitlePath: humanSubtitle,
        sourceVideoPath: sourceVideo,
      });
      expect(enforced.report).toMatchObject({
        status: "human-validated",
        finalizationMethod: "human",
        metrics: { blockingFindingCount: 14, reviewItemCount: 7 },
        qualityGate: { passed: true },
      });
      const strictPackage = subtitlePackageSchema.parse(
        JSON.parse(
          await readFile(enforced.outputPaths.subtitlePackage, "utf8"),
        ),
      );
      expect(strictPackage.primarySubtitle?.validationStatus).toBe("validated");
      expect(sha256Value(strictPackage.cues)).toBe(
        "8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83",
      );
      expect(canonicalTimingHash(strictPackage.cues)).toBe(
        "510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02",
      );
      const risk = subtitleFinalizationRiskAssessmentSchema.parse(
        JSON.parse(
          await readFile(
            path.join(
              enforced.subtitleDirectory,
              "subtitle-finalization-risk-assessment.json",
            ),
            "utf8",
          ),
        ),
      );
      expect(risk.protectedOutcome).toBe("FINAL_SAFE_WITH_ADVISORIES");
      expect(risk.summary).toMatchObject({
        effectiveMandatoryReviewCount: 0,
        effectiveAdvisoryReviewCount: 6,
        preservationSupportedReviewCount: 1,
        speakerRelationshipResolvedComponentCount: 1,
        subtitleOverlapResolvedComponentCount: 0,
      });
    }, 15_000);

    it("keeps the authority-negative control fail closed without a final package", async () => {
      const result = await finalizeProtectedExistingTask({
        taskDirectory: negativeTask,
        mode: "protected-enforce",
        generatedAt: "2026-08-27T01:02:00.000Z",
        sourceVideoPath: sourceVideo,
      });
      expect(result.report).toMatchObject({
        status: "needs-review",
        finalizationMethod: "none",
      });
      expect(
        existsSync(
          path.join(result.subtitleDirectory, "subtitle-package.final.json"),
        ),
      ).toBe(false);
      const replay = c60ProtectedFinalizationReplaySummarySchema.parse(
        JSON.parse(
          await readFile(
            path.join(
              negativeTask,
              "c6-0-protected-finalization-replay-summary.json",
            ),
            "utf8",
          ),
        ),
      );
      expect(replay).toMatchObject({
        protectedOutcome: "MACHINE_ONLY_NOT_AUTHORIZED",
        authorityVerified: false,
        strictFinalPackageExists: false,
        modelExecutionCounts: {
          modelInferenceCount: 0,
          modelLoadCount: 0,
        },
        networkUsed: false,
      });
    }, 15_000);
  },
);
