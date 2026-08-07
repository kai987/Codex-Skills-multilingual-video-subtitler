import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  buildFinalReviewQueue,
  canonicalUtterancesToCues,
  detectSongRegions,
  evaluateCanonicalUtteranceQuality,
  evaluateFinalSubtitleIntegrity,
  evaluateTranscriptionQuality,
  runFinalSubtitleIntegrityGate,
  type MissingDialogueRecoveryArtifact,
} from "@mvl/transcription-core";
import {
  adaptiveRefinementRecordSchema,
  atomicWriteFile,
  atomicWriteJson,
  canonicalAsrSegmentsArtifactSchema,
  finalSubtitleIntegrityArtifactSchema,
  missingDialogueRecoveryArtifactSchema,
  readJson,
  subtitlePackageSchema,
  transcriptionQualitySchema,
} from "@mvl/shared";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "@mvl/subtitle-core";
import { z } from "zod";

const intervalSchema = z
  .object({ start: z.number(), end: z.number() })
  .strict();

const timingRepairsSchema = z
  .object({
    repairs: z.array(
      z
        .object({
          cueId: z.string(),
          before: intervalSchema,
          after: intervalSchema,
          method: z.string(),
          reasons: z.array(z.string()),
        })
        .loose(),
    ),
  })
  .loose();

const presentationTimingSchema = z
  .object({
    records: z.array(
      z
        .object({
          sourceCueId: z.string(),
          originalInterval: intervalSchema,
          outputIntervals: z.array(intervalSchema),
          splitCount: z.number().int().positive(),
          timingMethod: z.string(),
          characterRatioFallback: z.boolean(),
          reasons: z.array(z.string()),
        })
        .loose(),
    ),
  })
  .loose();

const mediaProfileReplaySchema = z
  .object({
    durationSeconds: z.number().positive(),
    musicHeavy: z.boolean(),
    speechIntervals: z.array(intervalSchema),
  })
  .loose();

function overlaps(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function focusRegion(input: {
  name: string;
  interval: { start: number; end: number };
  candidateCues: readonly { start: number; end: number }[];
  finalCues: readonly { start: number; end: number }[];
  findings: readonly {
    code: string;
    interval: { start: number; end: number };
  }[];
}) {
  return {
    name: input.name,
    interval: input.interval,
    candidateCueCount: input.candidateCues.filter((cue) =>
      overlaps(cue, input.interval),
    ).length,
    finalCueCount: input.finalCues.filter((cue) =>
      overlaps(cue, input.interval),
    ).length,
    findingCodes: [
      ...new Set(
        input.findings
          .filter((finding) => overlaps(finding.interval, input.interval))
          .map((finding) => finding.code),
      ),
    ],
  };
}

async function main(): Promise<void> {
  const artifactArgument = process.argv[2];
  if (artifactArgument === undefined || artifactArgument.trim() === "") {
    throw new Error(
      "Usage: npm run rebuild:final-subtitle-integrity -- <subtitle-artifact-directory> [output-directory]",
    );
  }
  const inputDirectory = path.resolve(artifactArgument);
  const outputDirectory = path.resolve(process.argv[3] ?? inputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const [
    packageValue,
    canonicalValue,
    recoveryValue,
    mediaValue,
    historicalValue,
    refinementValue,
    repairsValue,
    presentationValue,
  ] = await Promise.all([
    readJson(path.join(inputDirectory, "subtitle-package.json")),
    readJson(path.join(inputDirectory, "canonical-asr-segments.json")),
    readJson(path.join(inputDirectory, "missing-dialogue-recovery.json")),
    readJson(path.join(inputDirectory, "media-profile.json")),
    readJson(path.join(inputDirectory, "transcription-quality.json")),
    readJson(path.join(inputDirectory, "transcription-refinement.json")),
    readJson(path.join(inputDirectory, "transcription-timing-repairs.json")),
    readJson(path.join(inputDirectory, "presentation-timing.json")),
  ]);
  const subtitlePackage = subtitlePackageSchema.parse(packageValue);
  const canonical = canonicalAsrSegmentsArtifactSchema.parse(canonicalValue);
  const recovery = missingDialogueRecoveryArtifactSchema.parse(
    recoveryValue,
  ) as unknown as MissingDialogueRecoveryArtifact;
  const media = mediaProfileReplaySchema.parse(mediaValue);
  const historicalQuality = transcriptionQualitySchema.parse(historicalValue);
  const refinement = adaptiveRefinementRecordSchema.parse(refinementValue);
  const timingRepairs = timingRepairsSchema.parse(repairsValue);
  const presentation = presentationTimingSchema.parse(presentationValue);

  const rebuiltCanonicalUtterances = evaluateCanonicalUtteranceQuality({
    utterances: canonical.utterances,
    rawSegments: canonical.rawSegments,
  });
  const rebuiltCanonical = canonicalAsrSegmentsArtifactSchema.parse({
    ...canonical,
    utterances: rebuiltCanonicalUtterances,
  });
  const canonicalSafeCues = canonicalUtterancesToCues(
    rebuiltCanonicalUtterances,
  );
  const canonicalQuality = evaluateTranscriptionQuality({
    cues: canonicalSafeCues,
    speechIntervals: media.speechIntervals,
  });

  const vocalRegions = detectSongRegions({
    recovery,
    speechIntervals: media.speechIntervals,
    mediaDurationSeconds: media.durationSeconds,
    musicHeavy: media.musicHeavy,
  });
  const before = evaluateFinalSubtitleIntegrity({
    cues: subtitlePackage.cues,
    vocalRegions,
  });
  const gate = runFinalSubtitleIntegrityGate({
    cues: subtitlePackage.cues,
    vocalRegions,
  });
  const integrity = finalSubtitleIntegrityArtifactSchema.parse(gate.artifact);
  const postPresentationQuality = evaluateTranscriptionQuality({
    cues: gate.cues,
    speechIntervals: media.speechIntervals,
  });
  const finalReview = buildFinalReviewQueue({
    historicalQuality,
    postPresentationQuality,
    finalCues: gate.cues,
    refinementRecord: refinement,
    timingRepairs: timingRepairs.repairs,
    presentationTiming: presentation.records,
    speechIntervals: media.speechIntervals,
    recoveryUnits: recovery.units,
    finalIntegrity: integrity,
    reviewGroupGapSeconds: 0.75,
  });
  const srt = formatSrt(gate.cues);
  const vtt = formatVtt(gate.cues);
  const ass = formatAss(gate.cues);
  parseSrt(srt);
  parseVtt(vtt);
  parseAss(ass);

  const summary = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    mode: "offline-existing-artifact-replay",
    networkUsed: false,
    inputDirectory,
    outputDirectory,
    candidateCueCount: subtitlePackage.cues.length,
    finalCueCount: gate.cues.length,
    canonicalQa: {
      utteranceCount: rebuiltCanonicalUtterances.length,
      suspectedHallucinationCount: rebuiltCanonicalUtterances.filter(
        (utterance) => utterance.qualityStatus === "suspected-hallucination",
      ).length,
      excludedPresentationCueCount:
        rebuiltCanonicalUtterances.length - canonicalSafeCues.length,
    },
    beforeMetrics: before.metrics,
    candidateMetrics: integrity.candidateMetrics,
    finalMetrics: integrity.metrics,
    quarantinedCueCount: integrity.quarantinedCueIds.length,
    finalFindingCount: finalReview.queue.humanReviewFindingCount,
    reviewGroupCount: finalReview.queue.uniqueReviewGroupCount,
    reviewEventCount:
      finalReview.queue.reviewEventCount ??
      finalReview.queue.uniqueReviewGroupCount,
    songLyrics: {
      detectedVocalRegions: vocalRegions.length,
      musicCueCount: gate.cues.filter((cue) => cue.style === "music").length,
      missingLyricsReviewCount:
        integrity.candidateMetrics.missingLyricsRegionCount,
      vocalSubtitleCoverageRatio: integrity.vocalCoverage.subtitleCoverageRatio,
    },
    focusRegions: [
      focusRegion({
        name: "04:16.72–04:30.70",
        interval: { start: 256.72, end: 270.7 },
        candidateCues: subtitlePackage.cues,
        finalCues: gate.cues,
        findings: integrity.findings,
      }),
      focusRegion({
        name: "04:30.70–04:37.19",
        interval: { start: 270.7, end: 277.19 },
        candidateCues: subtitlePackage.cues,
        finalCues: gate.cues,
        findings: integrity.findings,
      }),
      focusRegion({
        name: "opening-song",
        interval: { start: 142.45, end: 231.88 },
        candidateCues: subtitlePackage.cues,
        finalCues: gate.cues,
        findings: integrity.findings,
      }),
    ],
  };

  await Promise.all([
    atomicWriteJson(
      path.join(
        outputDirectory,
        "canonical-asr-segments-integrity-replay.json",
      ),
      rebuiltCanonical,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(
        outputDirectory,
        "transcription-quality-canonical-integrity-replay.json",
      ),
      canonicalQuality,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(outputDirectory, "final-subtitle-integrity-replay.json"),
      integrity,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(
        outputDirectory,
        "transcription-quality-post-presentation-integrity-replay.json",
      ),
      postPresentationQuality,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(
        outputDirectory,
        "transcription-timing-findings-integrity-replay.json",
      ),
      finalReview.findings,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(outputDirectory, "final-review-queue-integrity-replay.json"),
      finalReview.queue,
      { overwrite: true },
    ),
    atomicWriteJson(
      path.join(
        outputDirectory,
        "final-subtitle-integrity-replay-summary.json",
      ),
      summary,
      { overwrite: true },
    ),
    atomicWriteFile(
      path.join(outputDirectory, "subtitle-final-integrity-replay.srt"),
      srt,
      { overwrite: true },
    ),
    atomicWriteFile(
      path.join(outputDirectory, "subtitle-final-integrity-replay.vtt"),
      vtt,
      { overwrite: true },
    ),
    atomicWriteFile(
      path.join(outputDirectory, "subtitle-final-integrity-replay.ass"),
      ass,
      { overwrite: true },
    ),
  ]);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
