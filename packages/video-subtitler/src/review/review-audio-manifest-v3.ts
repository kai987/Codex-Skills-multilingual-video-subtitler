import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  c60114ReviewAudioManifestV3Schema,
  type C60114Policy,
  type C60114SourceIdentity,
  type C60114ReviewTargets,
  type C60114ReviewRegionsV3,
  c60114PhysicalAudioSchema,
  type C60114PhysicalAudio,
} from "@mvl/shared";
import { buildC60112ReviewAudio } from "./c60112-review-audio.js";
import { inspectReviewWav } from "../review-audio.js";
import {
  c60114ArtifactHeader,
  c60114Coverage,
  c60114Id,
  withC60114SemanticHash,
} from "./c60114-policy.js";
import { assertC60114ReviewDeliveryInputs } from "./review-playback-timeline-v2.js";

/** Reuse the verified source extractor, then bind actual frame-derived WAV bounds. */
export async function buildC60114ReviewAudio(input: {
  sourcePath: string;
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  targets: C60114ReviewTargets;
  regions: C60114ReviewRegionsV3;
  outputDirectory: string;
  generatedAt: string;
  ffmpegPath?: string;
}) {
  assertC60114ReviewDeliveryInputs({
    sourceIdentity: input.sourceIdentity,
    targets: input.targets,
    regions: input.regions,
    policyHash: input.policy.semanticHash,
  });
  const legacy = await buildC60112ReviewAudio({
    sourcePath: input.sourcePath,
    expectedSourceMediaSha256: input.sourceIdentity.sourceMediaSha256,
    durationSeconds: input.sourceIdentity.durationSeconds,
    regions: input.regions.regions.map((region) => {
      const first = region.sourceIntervals[0],
        last = region.sourceIntervals.at(-1);
      if (!first || !last) throw new Error("C60114_AUDIO_REGION_NO_TARGETS");
      return {
        regionId: region.regionId,
        interval: { start: first.start, end: last.end },
        itemIds: region.reviewItemIds,
      };
    }),
    outputDirectory: path.join(input.outputDirectory, "audio"),
    generatedAt: input.generatedAt,
    audioStreamIndex: input.sourceIdentity.audioStreamIndex,
    ...(input.ffmpegPath ? { ffmpegPath: input.ffmpegPath } : {}),
  });
  const audio: C60114PhysicalAudio[] = [];
  for (const clip of legacy.clips) {
    const bytes = await readFile(
      path.join(input.outputDirectory, clip.relativePath),
    );
    const metadata = inspectReviewWav(bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== clip.sha256 || metadata.frameCount !== clip.frameCount)
      throw new Error("C60114_PHYSICAL_AUDIO_INTEGRITY_FAILED");
    const region = input.regions.regions.find(
      (row) => row.regionId === clip.regionId,
    );
    if (!region) throw new Error("C60114_AUDIO_REGION_BINDING_MISSING");
    const sourceInterval = {
      start: clip.extractedInterval.start,
      end:
        clip.extractedInterval.start +
        metadata.frameCount / metadata.sampleRate,
    };
    const coveredReviewTargetIds = input.targets.targets
      .filter(
        (target) =>
          region.reviewTargetIds.includes(target.reviewTargetId) &&
          c60114Coverage(target.sourceInterval, [sourceInterval]) >= 1 - 1e-7,
      )
      .map((target) => target.reviewTargetId)
      .sort();
    audio.push(
      c60114PhysicalAudioSchema.parse(
        withC60114SemanticHash({
          audioId: c60114Id("review-audio-v3", {
            regionId: region.regionId,
            sha256: hash,
          }),
          relativePath: clip.relativePath,
          sourceMediaSha256: input.sourceIdentity.sourceMediaSha256,
          sourceIdentity: input.sourceIdentity,
          sourceInterval,
          requestedInterval: clip.requestedInterval,
          actualSourceInterval: sourceInterval,
          requestedSourceInterval: clip.requestedInterval,
          sampleRate: 16000,
          channels: 1,
          bitDepth: 16,
          codec: "pcm_s16le",
          frameCount: metadata.frameCount,
          actualDuration: metadata.actualDurationSeconds,
          sha256: hash,
          playable: true,
          hashVerified: true,
          physicalMetadataVerified: true,
          coveredReviewTargetIds,
          regionIds: [region.regionId],
        }),
      ),
    );
  }
  const checks = input.targets.targets.map((target) => {
    const relevant = audio.filter((clip) =>
      clip.coveredReviewTargetIds.includes(target.reviewTargetId),
    );
    const coverageRatio = c60114Coverage(
      target.sourceInterval,
      relevant.map((clip) => clip.sourceInterval),
    );
    return {
      reviewTargetId: target.reviewTargetId,
      mandatoryForAudio: target.mandatoryForAudio,
      audioRequired: target.audioRequired ?? target.mandatoryForAudio,
      coverageRatio,
      fullyCovered: coverageRatio >= 1 - 1e-7,
    };
  });
  const passed = checks.every(
    (check) => !check.audioRequired || check.fullyCovered,
  );
  if (!passed)
    throw new Error("C60114_MANDATORY_TARGET_PHYSICAL_AUDIO_OMISSION");
  return {
    legacy,
    manifest: c60114ReviewAudioManifestV3Schema.parse(
      withC60114SemanticHash({
        ...c60114ArtifactHeader(input.policy, input.sourceIdentity),
        artifactType: "machine-review-audio-manifest-v3",
        regionsHash: input.regions.semanticHash,
        deliverySubsystemVersion: "C6.0.1.12_REVIEW_AUDIO",
        extractionPolicy: "existing-deterministic-pcm16k-source-extraction",
        audio,
        targetCoverageChecks: checks,
        summary: {
          plannedAudioCount: input.regions.regions.length,
          actualAudioCount: audio.length,
          extractionFailureCount: 0,
          playableCount: audio.length,
          hashVerifiedCount: audio.length,
          mandatoryTargetCount: checks.filter((check) => check.audioRequired)
            .length,
          coveredMandatoryTargetCount: checks.filter(
            (check) => check.audioRequired && check.fullyCovered,
          ).length,
          allTargetCount: checks.length,
          coveredTargetCount: checks.filter((check) => check.fullyCovered)
            .length,
          targetCoveragePassed: passed,
          clipSumSeconds: audio.reduce(
            (sum, clip) => sum + clip.actualDuration,
            0,
          ),
          networkUsed: false,
        },
      }),
    ),
  };
}
