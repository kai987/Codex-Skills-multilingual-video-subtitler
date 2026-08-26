import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { subtitleReviewPackageSchema } from "@mvl/shared";
import {
  buildReviewDeliveryIntegrity,
  loadReviewDeliveryArtifacts,
  locateSubtitlePackage,
  repairReviewPackageDelivery,
  sha256Value,
  writeReviewDeliveryIntegrity,
} from "@mvl/video-subtitler";

const DEFAULT_FRESH_TASK =
  "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-1-mfa-runtime-alignment-semantics-metadata-verified-fresh-20260826";
const freshTask = process.env.MVL_C5171_FRESH_TASK ?? DEFAULT_FRESH_TASK;
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fileHash(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

describe("C5.17.2 offline review-delivery end-to-end", () => {
  it.skipIf(!existsSync(freshTask))(
    "repairs a C5.17.1-like seven-item task and fails closed on delivery corruption",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "mvl-c5172-e2e-"));
      temporaryDirectories.push(root);
      const targetTask = path.join(root, "target-task");
      const sourceLocated = await locateSubtitlePackage(freshTask);
      const source = await loadReviewDeliveryArtifacts(
        sourceLocated.subtitleDirectory,
      );
      const sourceReviewHashBefore = await fileHash(source.paths.reviewPackage);
      const sourceForcedHashBefore = await fileHash(
        source.paths.forcedAlignment,
      );
      const physicalBefore = (
        await readdir(
          path.join(sourceLocated.subtitleDirectory, "audio", "review"),
        )
      ).filter((name) => name.endsWith(".wav")).length;
      const copiedFromDpBefore = source.reviewPackage.items.reduce(
        (count, item) =>
          count +
          (item.forcedAlignmentEvidence?.cues.filter(
            (cue) =>
              cue.mappedTokenBoundary !== null &&
              cue.evidenceDpBoundary !== null &&
              cue.mappedTokenBoundary.start === cue.evidenceDpBoundary.start &&
              cue.mappedTokenBoundary.end === cue.evidenceDpBoundary.end,
          ).length ?? 0),
        0,
      );
      expect({
        physicalBefore,
        audioClipCount: source.reviewPackage.summary.audioClipCount,
        audioFailureCount: source.reviewPackage.summary.audioFailureCount,
        audioCoverageFailureCount:
          source.reviewPackage.summary.audioCoverageFailureCount,
      }).toEqual({
        physicalBefore: 7,
        audioClipCount: 0,
        audioFailureCount: 7,
        audioCoverageFailureCount: 7,
      });
      expect(copiedFromDpBefore).toBeGreaterThan(0);

      await cp(freshTask, targetTask, {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      });
      const targetLocated = await locateSubtitlePackage(targetTask);
      await rm(path.join(targetLocated.subtitleDirectory, "audio", "review"), {
        recursive: true,
        force: true,
      });
      const cueHashBefore = sha256Value(
        source.subtitlePackage.cues.map((cue) => ({
          id: cue.id,
          text: cue.text,
        })),
      );
      const timingHashBefore = sha256Value(
        source.subtitlePackage.cues.map((cue) => ({
          id: cue.id,
          start: cue.start,
          end: cue.end,
        })),
      );
      const repaired = await repairReviewPackageDelivery({
        sourceTaskDirectory: freshTask,
        targetTaskDirectory: targetTask,
        audioMode: "reuse-only",
        evidenceMode: "enforce",
        sourceVideoPath: null,
        reviewPageTimeline: true,
      });
      const cueHashAfter = sha256Value(
        repaired.target.subtitlePackage.cues.map((cue) => ({
          id: cue.id,
          text: cue.text,
        })),
      );
      const timingHashAfter = sha256Value(
        repaired.target.subtitlePackage.cues.map((cue) => ({
          id: cue.id,
          start: cue.start,
          end: cue.end,
        })),
      );
      const delivery = await writeReviewDeliveryIntegrity({
        mode: "enforce",
        sourceTaskName: path.basename(freshTask),
        subtitleDirectory: repaired.targetSubtitleDirectory,
        sourceReviewPackageHash: source.hashes.reviewPackage,
        sourceFinalizationReportHash: source.hashes.finalizationReport,
        baseTimingHash: timingHashBefore,
        canonicalCueHashUnchanged: cueHashBefore === cueHashAfter,
        canonicalTimingHashUnchanged: timingHashBefore === timingHashAfter,
      });
      expect(delivery.artifact?.summary).toMatchObject({
        itemCount: 7,
        passedItemCount: 7,
        reviewAudioPhysicalFileCount: 7,
        reviewAudioReferencedCount: 7,
        reviewAudioPlayableCount: 7,
        reviewAudioHashMismatchCount: 0,
        reviewAudioCoverageFailureCount: 0,
        reviewAudioMetadataFailureCount: 0,
        mappedTokenBoundaryCopiedFromEvidenceDpCount: 0,
        decodedSegmentMislabelledAsRawVadCount: 0,
        unresolvedEvidenceReferenceCount: 0,
        reviewDeliveryIntegrityPassed: true,
      });
      expect(repaired.reviewPackage.summary).toMatchObject({
        audioClipCount: 7,
        audioFailureCount: 0,
        audioCoverageFailureCount: 0,
      });
      expect(repaired.reviewPackage.items).toHaveLength(7);
      expect(cueHashAfter).toBe(cueHashBefore);
      expect(timingHashAfter).toBe(timingHashBefore);
      expect(repaired.finalizationReport.status).toBe("needs-review");
      expect(repaired.finalizationReport.finalizationMethod).toBe("none");
      expect(
        await readFile(
          path.join(
            repaired.targetSubtitleDirectory,
            "review",
            "data",
            "subtitle-review-package.json",
          ),
        ),
      ).toEqual(await readFile(repaired.target.paths.reviewPackage));

      const reviewDataPath = path.join(
        repaired.targetSubtitleDirectory,
        "review",
        "data",
        "subtitle-review-package.json",
      );
      const rootReview = await readFile(repaired.target.paths.reviewPackage);
      await writeFile(
        reviewDataPath,
        Buffer.concat([rootReview, Buffer.from("\n")]),
      );
      const rootMismatch = await buildReviewDeliveryIntegrity({
        sourceTaskName: path.basename(freshTask),
        subtitleDirectory: repaired.targetSubtitleDirectory,
        sourceReviewPackageHash: source.hashes.reviewPackage,
        sourceFinalizationReportHash: source.hashes.finalizationReport,
        baseTimingHash: timingHashBefore,
        canonicalCueHashUnchanged: true,
        canonicalTimingHashUnchanged: true,
      });
      expect(rootMismatch.summary.rootReviewDataMismatchCount).toBe(1);
      expect(rootMismatch.summary.reviewDeliveryIntegrityPassed).toBe(false);
      await writeFile(reviewDataPath, rootReview);

      const firstItem = repaired.reviewPackage.items[0];
      if (firstItem?.audioClipPath === null || firstItem === undefined) {
        throw new Error("repaired audio fixture missing");
      }
      const missingAudioPath = path.resolve(
        repaired.targetSubtitleDirectory,
        "review",
        firstItem.audioClipPath,
      );
      await rm(missingAudioPath);
      const missingAudio = await buildReviewDeliveryIntegrity({
        sourceTaskName: path.basename(freshTask),
        subtitleDirectory: repaired.targetSubtitleDirectory,
        sourceReviewPackageHash: source.hashes.reviewPackage,
        sourceFinalizationReportHash: source.hashes.finalizationReport,
        baseTimingHash: timingHashBefore,
        canonicalCueHashUnchanged: true,
        canonicalTimingHashUnchanged: true,
      });
      expect(missingAudio.items[0]?.failures).toContain("AUDIO_FILE_EXISTS");
      expect(missingAudio.summary.reviewDeliveryIntegrityPassed).toBe(false);

      const sourceAudioPath = path.join(
        sourceLocated.subtitleDirectory,
        "audio",
        "review",
        path.basename(missingAudioPath),
      );
      await cp(sourceAudioPath, missingAudioPath);
      const packageValue = subtitleReviewPackageSchema.parse(
        JSON.parse(rootReview.toString("utf8")) as unknown,
      );
      const mapped = packageValue.items
        .flatMap((item) => item.boundaryEvidence)
        .find((value) => value.sourceType === "trusted-mapped-token");
      if (mapped === undefined) throw new Error("mapped fixture missing");
      mapped.sourceObjectId = "missing-evidence-object";
      const brokenEvidence = Buffer.from(
        `${JSON.stringify(packageValue, null, 2)}\n`,
        "utf8",
      );
      await Promise.all([
        writeFile(repaired.target.paths.reviewPackage, brokenEvidence),
        writeFile(reviewDataPath, brokenEvidence),
      ]);
      const evidenceFailure = await buildReviewDeliveryIntegrity({
        sourceTaskName: path.basename(freshTask),
        subtitleDirectory: repaired.targetSubtitleDirectory,
        sourceReviewPackageHash: source.hashes.reviewPackage,
        sourceFinalizationReportHash: source.hashes.finalizationReport,
        baseTimingHash: timingHashBefore,
        canonicalCueHashUnchanged: true,
        canonicalTimingHashUnchanged: true,
      });
      expect(
        evidenceFailure.items.some((item) => !item.mappedTokenEvidenceResolved),
      ).toBe(true);
      expect(evidenceFailure.summary.reviewDeliveryIntegrityPassed).toBe(false);

      expect(await fileHash(source.paths.reviewPackage)).toBe(
        sourceReviewHashBefore,
      );
      expect(await fileHash(source.paths.forcedAlignment)).toBe(
        sourceForcedHashBefore,
      );
      const targetAfterFailures = await loadReviewDeliveryArtifacts(
        repaired.targetSubtitleDirectory,
      );
      expect(
        sha256Value(
          targetAfterFailures.subtitlePackage.cues.map((cue) => ({
            id: cue.id,
            text: cue.text,
            start: cue.start,
            end: cue.end,
          })),
        ),
      ).toBe(
        sha256Value(
          source.subtitlePackage.cues.map((cue) => ({
            id: cue.id,
            text: cue.text,
            start: cue.start,
            end: cue.end,
          })),
        ),
      );
    },
    30_000,
  );
});
