import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  alignReferenceTimeline,
  buildFinalReviewQueue,
  deduplicateNormalizedWinners,
  deduplicateTopScoreWinners,
  evaluateAnchorTextCoverage,
  normalizeJapaneseLexicalForm,
  repairTopScoreFragments,
  repairTopScoreWinnerTiming,
  resolveCompetingHypotheses,
  runFinalSubtitleIntegrityGate,
  runFinalTextIntegrityGate,
  validateLyricsText,
} from "@mvl/transcription-core";
import {
  buildAcousticSemanticCueSegments,
  evaluateLineLayoutIntegrity,
  formatAss,
  formatSrt,
  formatVtt,
  layoutSubtitleCuesWithDiagnostics,
  parseSrt,
} from "@mvl/subtitle-core";
import {
  atomicWriteFile,
  atomicWriteJson,
  cueCandidateEvidenceArtifactSchema,
  discoveredSpeechAnchorsArtifactSchema,
  finalReviewQueueSchema,
  hypothesisClustersArtifactSchema,
  pathExists,
  referenceTimelineArtifactSchema,
  semanticCandidateValidationArtifactSchema,
  subtitleCueSchema,
  terminologyEvidenceArtifactSchema,
  transcriptionQualitySchema,
  whisperExecutionMetricsSchema,
  type CueCandidateEvidence,
  type SubtitleCue,
} from "@mvl/shared";

const C2_ROOT = path.resolve(
  "output/carnation-reference-guided-c2-uncached-20260730",
);
const C3_ROOT = path.resolve(
  "output/carnation-reference-guided-c3-cached-20260801",
);
const VIDEO_PATH =
  "/Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv";
const SUBTITLE_DIRECTORY_NAME =
  "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]";
const C2_SUBTITLE_DIRECTORY = path.join(C2_ROOT, SUBTITLE_DIRECTORY_NAME);
const C3_SUBTITLE_DIRECTORY = path.join(C3_ROOT, SUBTITLE_DIRECTORY_NAME);
const SUBTITLE_BASE_NAME = SUBTITLE_DIRECTORY_NAME;

async function json(fileName: string): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(C2_SUBTITLE_DIRECTORY, fileName), "utf8"),
  );
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return digest.digest("hex");
}

function sourceLayer(
  candidate: CueCandidateEvidence,
): NonNullable<SubtitleCue["provenance"]>["sourceLayer"] {
  if (candidate.cueId.startsWith("reference-original")) {
    return "reference-original-language";
  }
  if (candidate.cueId.startsWith("large-v3-refinement:")) {
    return "large-v3-refinement";
  }
  if (candidate.cueId.startsWith("recovery:")) return "recovery";
  if (candidate.cueId.startsWith("lyrics:")) return "lyrics-asr";
  if (candidate.cueId.startsWith("no-vad:")) return "no-vad";
  if (candidate.cueId.startsWith("extra-sensitive-vad:")) {
    return "scene-extra-sensitive-vad";
  }
  return "baseline-vad";
}

function materializeCandidate(candidate: CueCandidateEvidence): SubtitleCue {
  const layer = sourceLayer(candidate);
  const speechSupported = candidate.speechCoverage >= 0.5;
  return subtitleCueSchema.parse({
    id: candidate.cueId,
    start: candidate.interval.start,
    end: candidate.interval.end,
    language: "ja",
    languages: ["ja"],
    text: candidate.text,
    ...(layer === "lyrics-asr" || layer === "reference-original-language"
      ? { style: "music" as const }
      : {}),
    textSource:
      layer === "reference-original-language"
        ? "reference-original-language"
        : "audio-asr",
    speaker: null,
    confidence: candidate.acousticSupport,
    provenance: {
      sourceLayer: layer,
      sourceRequestIds: candidate.sourceRequestIds,
      sourceProfileIds: candidate.sourceProfileIds,
      referenceAnchorIds: candidate.referenceAnchorIds,
      referenceUnitIds: candidate.referenceUnitIds,
      recoveryUnitId: candidate.recoveryUnitId,
      sceneId: candidate.sceneId,
      sceneLabel: candidate.sceneLabel,
      independentSupportCount:
        candidate.independentSupportCount ??
        Math.max(1, Math.round(candidate.profileConsensus * 2)),
      qualityScore: candidate.totalScore,
    },
    transcriptionMetrics: {
      noSpeechProbability: Math.min(1, candidate.hallucinationRisk),
    },
    timingEvidence: {
      sourceTrusted: layer === "reference-original-language",
      speechStart: speechSupported ? candidate.interval.start : null,
      speechEnd: speechSupported ? candidate.interval.end : null,
      tokenTimestampsAvailable: false,
      tokenTimestampsUsed: false,
      tokens: [],
      alignmentSource: speechSupported ? "speech" : "segment",
      presentationTimingMethod: null,
      ...(speechSupported ? { speechIntervals: [candidate.interval] } : {}),
    },
  });
}

function overlaps(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end;
}

async function blindHashes() {
  const files = {
    a3Equivalent: path.resolve(
      "output/carnation-reference-free-a2-cached-20260730",
      "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]",
      "blind-generation-proof.json",
    ),
    b3Equivalent: path.resolve(
      "output/carnation-reference-assisted-b2-cached-20260730",
      "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]",
      "blind-generation-proof.json",
    ),
  };
  const a = JSON.parse(await readFile(files.a3Equivalent, "utf8")) as {
    generatedSubtitleSha256: string;
    canonicalTranscriptSha256: string;
  };
  const b = JSON.parse(await readFile(files.b3Equivalent, "utf8")) as {
    generatedSubtitleSha256: string;
    canonicalTranscriptSha256: string;
  };
  async function renderedHashes(proofPath: string) {
    const directory = path.dirname(proofPath);
    const names = await readdir(directory);
    const hashFor = async (extension: ".srt" | ".vtt" | ".ass") => {
      const name = names.find(
        (candidate) =>
          candidate.endsWith(extension) && candidate !== "subtitle-diff.ass",
      );
      if (name === undefined) {
        throw new Error(
          `Blind isolation output is missing ${extension}: ${directory}`,
        );
      }
      return sha256File(path.join(directory, name));
    };
    return {
      srt: await hashFor(".srt"),
      vtt: await hashFor(".vtt"),
      ass: await hashFor(".ass"),
    };
  }
  const [aRendered, bRendered] = await Promise.all([
    renderedHashes(files.a3Equivalent),
    renderedHashes(files.b3Equivalent),
  ]);
  return {
    sourceRuns: files,
    a3EquivalentRenderedHashes: aRendered,
    b3EquivalentRenderedHashes: bRendered,
    srtEquivalentHashA: aRendered.srt,
    srtEquivalentHashB: bRendered.srt,
    canonicalHashA: a.canonicalTranscriptSha256,
    canonicalHashB: b.canonicalTranscriptSha256,
    generationHashesMatch:
      aRendered.srt === bRendered.srt &&
      aRendered.vtt === bRendered.vtt &&
      aRendered.ass === bRendered.ass &&
      a.generatedSubtitleSha256 === b.generatedSubtitleSha256,
    canonicalHashesMatch:
      a.canonicalTranscriptSha256 === b.canonicalTranscriptSha256,
  };
}

const started = performance.now();
const c2Candidates = cueCandidateEvidenceArtifactSchema.parse(
  await json("cue-candidate-evidence.json"),
);
const c2Clusters = hypothesisClustersArtifactSchema.parse(
  await json("hypothesis-clusters.json"),
);
const timeline = referenceTimelineArtifactSchema.parse(
  await json("reference-timeline.json"),
);
const semantic = semanticCandidateValidationArtifactSchema.parse(
  await json("semantic-candidate-validation.json"),
);
const terminology = terminologyEvidenceArtifactSchema.parse(
  await json("terminology-evidence.json"),
);
const historicalQuality = transcriptionQualitySchema.parse(
  await json("transcription-quality-pre-presentation.json"),
);
const postPresentationQuality = transcriptionQualitySchema.parse(
  await json("transcription-quality-post-presentation.json"),
);
const speechAnchors = discoveredSpeechAnchorsArtifactSchema.parse(
  await json("discovered-speech-anchors.json"),
);
const c2Execution = whisperExecutionMetricsSchema.parse(
  await json("whisper-execution-metrics.json"),
);
const c2Package = (await json("subtitle-package.json")) as {
  transcription?: { coreML?: { status: string; fallback: string | null } };
};
const candidates = c2Candidates.candidates.map(materializeCandidate);
const targetedResultsPath = path.join(C3_ROOT, "targeted-asr-results.json");
const targetedDecisionsPath = path.join(
  C3_ROOT,
  "c3-targeted-asr-decisions.json",
);
const targetedMetricsPath = path.join(
  C3_ROOT,
  "targeted-whisper-execution-metrics.json",
);
interface TargetedResults {
  windows: {
    id: string;
    referenceAnchorIds: string[];
    segments: {
      start: number;
      end: number;
      text: string;
      confidence: number | null;
      tokens?: {
        text: string;
        start: number;
        end: number;
        probability?: number | null;
      }[];
    }[];
  }[];
}
interface TargetedDecisions {
  acceptedSegmentIds: string[];
  rejectedSegments: { segmentId: string; reason: string }[];
}
const targetedResults: TargetedResults | null =
  (await pathExists(targetedResultsPath)) &&
  (await pathExists(targetedDecisionsPath))
    ? (JSON.parse(
        await readFile(targetedResultsPath, "utf8"),
      ) as TargetedResults)
    : null;
const targetedDecisions: TargetedDecisions | null =
  targetedResults === null
    ? null
    : (JSON.parse(
        await readFile(targetedDecisionsPath, "utf8"),
      ) as TargetedDecisions);
const targetedExecution =
  targetedResults === null
    ? null
    : whisperExecutionMetricsSchema.parse(
        JSON.parse(await readFile(targetedMetricsPath, "utf8")),
      );
const acceptedTargetedIds = new Set(
  targetedDecisions?.acceptedSegmentIds ?? [],
);
const targetedCues =
  targetedResults?.windows.flatMap((window) =>
    window.segments.flatMap((segment, index) => {
      const id = `${window.id}:segment-${String(index + 1).padStart(4, "0")}`;
      if (!acceptedTargetedIds.has(id)) return [];
      const probabilities = (segment.tokens ?? []).flatMap((token) =>
        token.probability === undefined || token.probability === null
          ? []
          : [token.probability],
      );
      const confidence =
        segment.confidence ??
        (probabilities.length === 0
          ? 0.65
          : probabilities.reduce((sum, value) => sum + value, 0) /
            probabilities.length);
      return [
        subtitleCueSchema.parse({
          id,
          start: segment.start,
          end: segment.end,
          language: "ja",
          languages: ["ja"],
          text: segment.text,
          textSource: "audio-asr",
          speaker: null,
          confidence,
          provenance: {
            sourceLayer: "large-v3-refinement",
            sourceRequestIds: [window.id],
            sourceProfileIds: ["large-v3-targeted-coreml"],
            referenceAnchorIds: window.referenceAnchorIds,
            referenceUnitIds: [],
            recoveryUnitId: null,
            sceneId: null,
            sceneLabel: "quiet-dialogue",
            independentSupportCount: 1,
            qualityScore: confidence,
          },
          timingEvidence: {
            sourceTrusted: false,
            speechStart: segment.start,
            speechEnd: segment.end,
            tokenTimestampsAvailable: (segment.tokens?.length ?? 0) > 0,
            tokenTimestampsUsed: (segment.tokens?.length ?? 0) > 0,
            tokens: segment.tokens ?? [],
            alignmentSource:
              (segment.tokens?.length ?? 0) > 0 ? "token" : "speech",
            presentationTimingMethod: null,
            speechIntervals: [{ start: segment.start, end: segment.end }],
          },
        }),
      ];
    }),
  ) ?? [];
const allCandidates = [...candidates, ...targetedCues];

const hypotheses = resolveCompetingHypotheses({
  cues: allCandidates,
  evidenceCues: allCandidates,
  mode: "top-score",
  terminology,
  semantic,
  referenceTimeline: timeline,
  precomputedEvidence: c2Candidates,
});
const deduplicated = deduplicateTopScoreWinners(hypotheses.cues);
const repaired = repairTopScoreFragments(deduplicated.cues);
const timing = repairTopScoreWinnerTiming({
  cues: repaired.cues,
  equivalentCandidates: hypotheses.atomization.atoms,
  referenceTimeline: timeline,
});
const normalized = normalizeJapaneseLexicalForm({
  cues: timing.cues,
  allCandidates: hypotheses.atomization.atoms,
  atomicClusters: hypotheses.atomicClusters,
  terminologyEntries: terminology.entries,
  terminologySha256: null,
  mode: "top-score",
});
const postDeduplicated = deduplicateNormalizedWinners(normalized.cues);
const segmentation = buildAcousticSemanticCueSegments(postDeduplicated.cues, {
  mode: "acoustic-semantic",
  japaneseTextAnalyzer: "auto",
});
const lyrics = validateLyricsText({ cues: segmentation.cues });
const textIntegrity = runFinalTextIntegrityGate({
  cues: segmentation.cues,
  mode: "enforce",
  japaneseTextAnalysis: segmentation.japaneseTextAnalysis,
  candidateEvidence: hypotheses.candidateEvidence,
  hypothesisResolution: hypotheses.resolution,
  segmentationPlan: segmentation.plan,
  lyricsValidity: lyrics,
});
const presentation = layoutSubtitleCuesWithDiagnostics(textIntegrity.cues, {
  segmentationMode: "presegmented",
  allowTemporalCueSplitting: false,
});
const lineIntegrity = evaluateLineLayoutIntegrity(presentation.cues);
const unsafeCueIds = new Set(
  lineIntegrity.findings.map((finding) => finding.cueId),
);
const finalIntegrity = runFinalSubtitleIntegrityGate({
  cues: presentation.cues.filter((cue) => !unsafeCueIds.has(cue.id)),
  supportedLyricsCueIds: presentation.cues
    .filter(
      (cue) => cue.provenance?.sourceLayer === "reference-original-language",
    )
    .map((cue) => cue.id),
});
let finalCues = finalIntegrity.cues;
let finalTextAudit = runFinalTextIntegrityGate({
  cues: finalCues,
  mode: "enforce",
});
let finalSubtitleAudit = runFinalSubtitleIntegrityGate({
  cues: finalTextAudit.cues,
  supportedLyricsCueIds: finalTextAudit.cues
    .filter(
      (cue) => cue.provenance?.sourceLayer === "reference-original-language",
    )
    .map((cue) => cue.id),
});
for (let pass = 0; pass < 2; pass += 1) {
  const next = finalSubtitleAudit.cues;
  if (
    next.length === finalCues.length &&
    next.every((cue, index) => cue.id === finalCues[index]?.id)
  ) {
    finalCues = next;
    break;
  }
  finalCues = next;
  finalTextAudit = runFinalTextIntegrityGate({
    cues: finalCues,
    mode: "enforce",
  });
  finalSubtitleAudit = runFinalSubtitleIntegrityGate({
    cues: finalTextAudit.cues,
  });
}
const generatedSrt = formatSrt(finalCues);
const generatedSubtitleSha256 = createHash("sha256")
  .update(generatedSrt)
  .digest("hex");
const alignment = alignReferenceTimeline({
  timeline,
  generatedCues: finalCues,
  generatedSubtitleSha256,
  speechIntervals: speechAnchors.anchors.map((anchor) => anchor.interval),
});
const review = buildFinalReviewQueue({
  historicalQuality,
  postPresentationQuality,
  finalCues,
  speechIntervals: speechAnchors.anchors.map((anchor) => anchor.interval),
  finalIntegrity: finalIntegrity.artifact,
});
const anchorCoverage = evaluateAnchorTextCoverage({
  timeline,
  alignment,
  generatedCues: finalCues,
  generatedSubtitleSha256,
  finalTextIntegrity: finalTextAudit.artifact,
  activeReviewIntervals: review.queue.groups.map((group) => group.interval),
});

const c2SrtPath = path.join(C2_SUBTITLE_DIRECTORY, `${SUBTITLE_BASE_NAME}.srt`);
const c2CueCount = parseSrt(await readFile(c2SrtPath, "utf8")).length;
const c2ReviewQueue = finalReviewQueueSchema.parse(
  await json("final-review-queue.json"),
);
const c2MissingDialogueGroupCount = c2ReviewQueue.groups.filter(
  (group) => group.missingDialogue === true,
).length;
const review0015 = { start: 93.216167, end: 135.885646 };
const review0015Clusters = hypotheses.atomicClusters.clusters.filter(
  (cluster) => overlaps(cluster.interval, review0015),
);
const review0015WinnerIds = new Set(
  hypotheses.topScoreResolution.resolutions
    .filter((record) =>
      review0015Clusters.some((cluster) => cluster.id === record.clusterId),
    )
    .flatMap((record) =>
      record.winnerCueId === null ? [] : [record.winnerCueId],
    ),
);
const lateCandidateId =
  "recovery:recovery-unit-0006-attempt-02:recovery-unit-0006-no-vad-001";
const sourceStat = await stat(VIDEO_PATH);
const videoSha256 = await sha256File(VIDEO_PATH);
const blind = await blindHashes();
const noCandidateAnchors = timeline.anchors.filter(
  (anchor) =>
    (anchor.expectedSpeech || anchor.expectedSinging) &&
    !allCandidates.some((candidate) => overlaps(candidate, anchor.interval)),
);
const hardErrorCount =
  finalTextAudit.artifact.findings.filter(
    (finding) => finding.severity === "hard",
  ).length +
  finalSubtitleAudit.artifact.findings.filter(
    (finding) => finding.severity === "hard",
  ).length +
  evaluateLineLayoutIntegrity(finalCues).visualLineWordBreakCount;
const report = {
  schemaVersion: "1.0.0",
  runType: "C3 cached replay",
  sourceC2: C2_ROOT,
  wholeEpisodeWhisperExecuted: false,
  targetedAsrExecuted: targetedResults !== null,
  runtimeHypothesisResolutionMode: "top-score",
  legacyModesExecuted: false,
  statistics: {
    originalCandidateCount: c2Candidates.candidates.length,
    targetedCandidateAcceptedCount: targetedCues.length,
    targetedCandidateRejectedCount:
      targetedDecisions?.rejectedSegments.length ?? 0,
    atomizedCandidateCount: hypotheses.atomization.atoms.length,
    oldClusterCount: c2Clusters.clusters.length,
    atomicClusterCount: hypotheses.atomicClusters.clusters.length,
    splitLegacyClusterCount:
      hypotheses.atomicClusters.summary.splitLegacyClusterCount,
    clusterWithWinnerCount: hypotheses.topScoreResolution.summary.winnerCount,
    clusterWithoutWinnerCount:
      hypotheses.topScoreResolution.summary.noWinnerCount,
    topScoreWinnerCount: hypotheses.topScoreWinners.winnerCount,
    scoreGapBelow002WinnerCount:
      hypotheses.topScoreResolution.summary.lowScoreGapWinnerCount,
    reviewRecommendedWinnerCount:
      hypotheses.topScoreResolution.summary.reviewRecommendedWinnerCount,
    clusterSupersededCandidateCount:
      hypotheses.topScoreResolution.resolutions.reduce(
        (sum, record) => sum + record.rejectedCueIds.length,
        0,
      ),
    crossClusterDeduplicatedCount: deduplicated.artifact.summary.removedCount,
    prefixDuplicateRemovedCount:
      deduplicated.artifact.summary.prefixDuplicateCount,
    fragmentMergeCount: repaired.artifact.summary.fragmentMergeCount,
    mergedWithPreviousCount: repaired.artifact.summary.mergedWithPreviousCount,
    mergedWithNextCount: repaired.artifact.summary.mergedWithNextCount,
    timingRepairCount: timing.artifact.summary.repairCount,
    timingDonorCount: timing.artifact.summary.timingDonorCount,
    kanaToKanjiCount: normalized.artifact.summary.kanaToKanjiCount,
    katakanaNormalizationCount:
      normalized.artifact.summary.katakanaNormalizationCount,
    properNounRepairCount: normalized.artifact.summary.properNounRepairCount,
    terminologyRepairCount: normalized.artifact.summary.terminologyRepairCount,
    dialectPreservedCount: normalized.artifact.summary.dialectPreservedCount,
    postNormalizationDeduplicatedCount:
      postDeduplicated.artifact.summary.removedCount,
    visualLineWordBreakCount: lineIntegrity.visualLineWordBreakCount,
    c2FinalCueCount: c2CueCount,
    finalCueCount: finalCues.length,
    finalCueIncrease: finalCues.length - c2CueCount,
    trueMissingDialogueGroupCount:
      review.queue.trueMissingDialogueGroupCount ?? 0,
    c2MissingDialogueGroupCount,
    missingDialogueGroupReduction:
      c2MissingDialogueGroupCount -
      (review.queue.trueMissingDialogueGroupCount ?? 0),
    acceptedButReviewRecommendedCount:
      review.queue.acceptedButReviewRecommendedCount ?? 0,
    anchorTextRecall: anchorCoverage.summary,
    finalHardIntegrityErrorCount: hardErrorCount,
    characterRatioFallbackCount:
      hypotheses.atomization.summary.characterRatioSplitCount +
      segmentation.plan.summary.characterFallbackSegmentationCount +
      presentation.characterFallbackSegmentationCount,
  },
  reviewGroup0015: {
    interval: review0015,
    atomicClusterCount: review0015Clusters.length,
    clusters: review0015Clusters.map((cluster) => ({
      clusterId: cluster.id,
      interval: cluster.interval,
      candidateCueIds: cluster.candidateCueIds,
      winnerCueId:
        hypotheses.topScoreResolution.resolutions.find(
          (record) => record.clusterId === cluster.id,
        )?.winnerCueId ?? null,
      winnerText:
        hypotheses.topScoreWinners.winners.find(
          (cue) =>
            cue.id ===
            hypotheses.topScoreResolution.resolutions.find(
              (record) => record.clusterId === cluster.id,
            )?.winnerCueId,
        )?.text ?? null,
    })),
    late0845CandidateId: lateCandidateId,
    late0845CandidateSelected: review0015WinnerIds.has(lateCandidateId),
    lateCandidateSuppressedEarlierClusters: false,
  },
  unresolved: {
    hardBlockedAtomicClusters: hypotheses.topScoreResolution.resolutions.filter(
      (record) => record.winnerCueId === null,
    ),
    referenceAnchorsWithoutAnyC2Candidate: noCandidateAnchors.map((anchor) => ({
      anchorId: anchor.id,
      interval: anchor.interval,
      kind: anchor.kind,
    })),
    referenceAnchorsWithoutAnyUsableCandidate: noCandidateAnchors.map(
      (anchor) => ({
        anchorId: anchor.id,
        interval: anchor.interval,
        kind: anchor.kind,
      }),
    ),
  },
  blindIsolation: blind,
  execution: {
    c3AsrRequestCount: targetedExecution?.asrRequestCount ?? 0,
    c3WorkerStartCount: targetedExecution?.workerStartCount ?? 0,
    c3ModelLoadCount: targetedExecution?.modelLoadCount ?? 0,
    targetedExecution,
    sourceC2Execution: c2Execution,
    coreMLStatus: c2Package.transcription?.coreML?.status ?? "unknown",
    coreMLFallback: c2Package.transcription?.coreML?.fallback ?? null,
    fallback: hypotheses.topScoreResolution.fallback,
    wallClockSeconds: (performance.now() - started) / 1000,
  },
  sourceVideo: {
    path: VIDEO_PATH,
    sha256: videoSha256,
    sizeBytes: sourceStat.size,
    inode: sourceStat.ino,
    mtimeMs: sourceStat.mtimeMs,
  },
};

const reportMarkdown =
  `# C3 Cached Top-Score Replay\n\n` +
  `- C2 candidates: ${report.statistics.originalCandidateCount}\n` +
  `- Atomic candidates: ${report.statistics.atomizedCandidateCount}\n` +
  `- Old clusters → atomic clusters: ${report.statistics.oldClusterCount} → ${report.statistics.atomicClusterCount}\n` +
  `- Atomic winners / no winner: ${report.statistics.clusterWithWinnerCount} / ${report.statistics.clusterWithoutWinnerCount}\n` +
  `- C2 → C3 final cues: ${report.statistics.c2FinalCueCount} → ${report.statistics.finalCueCount} (${report.statistics.finalCueIncrease >= 0 ? "+" : ""}${report.statistics.finalCueIncrease})\n` +
  `- C2 → C3 missing-dialogue groups: ${report.statistics.c2MissingDialogueGroupCount} → ${report.statistics.trueMissingDialogueGroupCount}\n` +
  `- Review-group-0015 atomic clusters: ${report.reviewGroup0015.atomicClusterCount}\n` +
  `- Visual word-break findings: ${report.statistics.visualLineWordBreakCount}\n` +
  `- Final hard integrity errors: ${report.statistics.finalHardIntegrityErrorCount}\n` +
  `- Whole-episode Whisper: not executed\n` +
  `- Wall clock: ${report.execution.wallClockSeconds.toFixed(3)} seconds\n`;

const unchangedArtifacts = [
  "source-info.json",
  "media-identity.json",
  "media-profile.json",
  "reference-subtitle-analysis.json",
  "reference-cue-classification.json",
  "reference-timeline.json",
  "discovered-speech-anchors.json",
  "whisper-execution-metrics.json",
];
await Promise.all([
  ...unchangedArtifacts.map(async (fileName) =>
    atomicWriteJson(
      path.join(C3_SUBTITLE_DIRECTORY, fileName),
      await json(fileName),
      {
        overwrite: true,
      },
    ),
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "cue-candidate-evidence.json"),
    hypotheses.candidateEvidence,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "hypothesis-clusters.json"),
    hypotheses.clusters,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "hypothesis-resolution.json"),
    hypotheses.resolution,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "atomic-candidate-segmentation.json"),
    hypotheses.atomization,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "atomic-hypothesis-clusters.json"),
    hypotheses.atomicClusters,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "top-score-resolution.json"),
    hypotheses.topScoreResolution,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "top-score-winners.json"),
    hypotheses.topScoreWinners,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "winner-deduplication.json"),
    deduplicated.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "fragment-repair.json"),
    repaired.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "winner-timing-repair.json"),
    timing.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "japanese-lexical-normalization.json"),
    normalized.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "post-normalization-deduplication.json"),
    postDeduplicated.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "japanese-text-analysis.json"),
    segmentation.japaneseTextAnalysis,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "cue-segmentation-plan.json"),
    segmentation.plan,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "lyrics-text-validity.json"),
    lyrics,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "final-text-integrity.json"),
    textIntegrity.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "presentation-timing.json"),
    presentation.timingRecords,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "line-layout-integrity.json"),
    lineIntegrity,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "final-subtitle-integrity.json"),
    finalIntegrity.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "c3-final-output-audit.json"),
    {
      schemaVersion: "1.0.0",
      finalTextIntegrity: finalTextAudit.artifact,
      finalSubtitleIntegrity: finalSubtitleAudit.artifact,
      lineLayoutIntegrity: evaluateLineLayoutIntegrity(finalCues),
      finalHardIntegrityErrorCount: hardErrorCount,
    },
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "reference-cue-alignment.json"),
    alignment,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "anchor-text-coverage.json"),
    anchorCoverage,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "transcription-timing-findings.json"),
    review.findings,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "final-review-queue.json"),
    review.queue,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(C3_SUBTITLE_DIRECTORY, "c3-replay-report.json"),
    report,
    { overwrite: true },
  ),
  atomicWriteFile(
    path.join(C3_SUBTITLE_DIRECTORY, "c3-replay-report.md"),
    reportMarkdown,
    { overwrite: true },
  ),
  atomicWriteFile(
    path.join(C3_SUBTITLE_DIRECTORY, `${SUBTITLE_BASE_NAME}.srt`),
    generatedSrt,
    { overwrite: true },
  ),
  atomicWriteFile(
    path.join(C3_SUBTITLE_DIRECTORY, `${SUBTITLE_BASE_NAME}.vtt`),
    formatVtt(finalCues),
    { overwrite: true },
  ),
  atomicWriteFile(
    path.join(C3_SUBTITLE_DIRECTORY, `${SUBTITLE_BASE_NAME}.ass`),
    formatAss(finalCues),
    { overwrite: true },
  ),
]);

console.log(JSON.stringify(report, null, 2));
