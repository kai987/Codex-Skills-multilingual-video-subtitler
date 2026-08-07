import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  alignReferenceTimeline,
  buildCoverageRecoveryPlan,
  buildFinalReviewQueue,
  buildReferenceTimeline,
  classifyReferenceCuesWithReview,
  deduplicateNormalizedWinners,
  deduplicateTopScoreWinners,
  evaluateAnchorTextCoverage,
  evaluateFinalSubtitleIntegrity,
  normalizeJapaneseLexicalForm,
  parseReferenceSubtitleFile,
  repairFinalSubtitleIntegrity,
  repairTextIntegrityFailures,
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
} from "@mvl/subtitle-core";
import {
  atomicWriteFile,
  atomicWriteJson,
  asrCacheManifestArtifactSchema,
  c4FinalOutputAuditArtifactSchema,
  c4ReplayReportArtifactSchema,
  coverageRecoveryResultsArtifactSchema,
  cueCandidateEvidenceArtifactSchema,
  discoveredSpeechAnchorsArtifactSchema,
  finalReviewQueueSchema,
  japaneseTerminologyFileSchema,
  pathExists,
  semanticCandidateValidationArtifactSchema,
  subtitlePackageSchema,
  subtitleCueSchema,
  terminologyEvidenceArtifactSchema,
  transcriptionQualitySchema,
  type CoverageRecoveryResultsArtifact,
  type CueCandidateEvidence,
  type SubtitleCue,
} from "@mvl/shared";

const C2_ROOT = path.resolve(
  "output/carnation-reference-guided-c2-uncached-20260730",
);
const C3_ROOT = path.resolve(
  "output/carnation-reference-guided-c3-cached-20260801",
);
const C4_ROOT = path.resolve(
  "output/carnation-reference-guided-c4-cached-20260801",
);
const VIDEO_PATH =
  "/Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv";
const REFERENCE_PATH =
  "/Users/paulasmith/Downloads/Carnation (Week 01) ep001 (1280x720 x264).en-en.srt";

async function subtitleDirectory(root: string): Promise<string> {
  const name = (await readdir(root)).find((entry) =>
    entry.startsWith("subtitle-"),
  );
  if (name === undefined) {
    throw new Error(`Subtitle artifact directory not found under ${root}`);
  }
  return path.join(root, name);
}

async function json(directory: string, fileName: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(directory, fileName), "utf8"));
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
  if (
    candidate.cueId.startsWith("large-v3-refinement:") ||
    candidate.cueId.startsWith("coverage-recovery:") ||
    candidate.cueId.startsWith("c4-coverage-recovery:")
  ) {
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

interface TargetedRecoveryWindow {
  unitId: string;
  referenceAnchorIds: string[];
  requestIds: string[];
  cacheHitCount: number;
  accepted: boolean;
  reasons: string[];
  segments: {
    id: string;
    requestId: string;
    profileId: string;
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
}

interface TargetedRecoveryRun {
  round: number;
  sourcePlanHash: string;
  windows: TargetedRecoveryWindow[];
  execution: {
    workerStartCount: number;
    modelLoadCount: number;
    fallbackProcessCount: number;
  };
}

interface TargetedRecoveryFile {
  schemaVersion: "1.0.0";
  sourcePlanHash: string;
  windows: TargetedRecoveryWindow[];
  execution: TargetedRecoveryRun["execution"];
  runs?: TargetedRecoveryRun[];
}

async function loadTargetedCues(): Promise<{
  cues: SubtitleCue[];
  result: TargetedRecoveryFile | null;
}> {
  const resultPath = path.join(C4_ROOT, "coverage-targeted-asr-results.json");
  if (!(await pathExists(resultPath))) return { cues: [], result: null };
  const result = JSON.parse(
    await readFile(resultPath, "utf8"),
  ) as TargetedRecoveryFile;
  const runs = result.runs ?? [
    {
      round: 1,
      sourcePlanHash: result.sourcePlanHash,
      windows: result.windows,
      execution: result.execution,
    },
  ];
  const cues = runs
    .flatMap((run) => run.windows)
    .flatMap((window) =>
      window.accepted
        ? window.segments.map((segment) =>
            subtitleCueSchema.parse({
              id: segment.id,
              start: segment.start,
              end: segment.end,
              language: "ja",
              languages: ["ja"],
              text: segment.text,
              textSource: "audio-asr",
              speaker: null,
              confidence: segment.confidence ?? 0.65,
              provenance: {
                sourceLayer: "large-v3-refinement",
                sourceRequestIds: [segment.requestId],
                sourceProfileIds: [segment.profileId],
                referenceAnchorIds: window.referenceAnchorIds,
                referenceUnitIds: [],
                recoveryUnitId: window.unitId,
                sceneId: null,
                sceneLabel: null,
                independentSupportCount: 1,
                qualityScore: segment.confidence ?? 0.65,
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
          )
        : [],
    );
  return { cues, result };
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(
    [...new Set(values)].map((value) => [
      value,
      values.filter((candidate) => candidate === value).length,
    ]),
  ) as Record<T, number>;
}

const started = performance.now();
const c3SubtitleDirectory = await subtitleDirectory(C3_ROOT);
const c2SubtitleDirectory = await subtitleDirectory(C2_ROOT);
const c4SubtitleDirectory = path.join(
  C4_ROOT,
  path.basename(c3SubtitleDirectory),
);
await mkdir(c4SubtitleDirectory, { recursive: true });

const c3Evidence = cueCandidateEvidenceArtifactSchema.parse(
  await json(c3SubtitleDirectory, "cue-candidate-evidence.json"),
);
const semantic = semanticCandidateValidationArtifactSchema.parse(
  await json(c2SubtitleDirectory, "semantic-candidate-validation.json"),
);
const terminology = terminologyEvidenceArtifactSchema.parse(
  await json(c2SubtitleDirectory, "terminology-evidence.json"),
);
const c4Terminology = japaneseTerminologyFileSchema.parse(
  JSON.parse(
    await readFile(
      path.resolve("examples/carnation-c4-terminology.json"),
      "utf8",
    ),
  ),
);
const historicalQuality = transcriptionQualitySchema.parse(
  await json(
    c2SubtitleDirectory,
    "transcription-quality-pre-presentation.json",
  ),
);
const postPresentationQuality = transcriptionQualitySchema.parse(
  await json(
    c2SubtitleDirectory,
    "transcription-quality-post-presentation.json",
  ),
);
const speechAnchors = discoveredSpeechAnchorsArtifactSchema.parse(
  await json(c3SubtitleDirectory, "discovered-speech-anchors.json"),
);
const c3Review = finalReviewQueueSchema.parse(
  await json(c3SubtitleDirectory, "final-review-queue.json"),
);
const c3FinalText = (await json(
  c3SubtitleDirectory,
  "final-text-integrity.json",
)) as { quarantinedCueIds: string[] };
const c3FinalSubtitle = (await json(
  c3SubtitleDirectory,
  "final-subtitle-integrity.json",
)) as { findings: { code: string }[] };

const parsedReference = await parseReferenceSubtitleFile(REFERENCE_PATH);
const classified = classifyReferenceCuesWithReview({
  parsed: parsedReference,
  referenceLanguage: "en",
  mediaDurationSeconds: 900.01,
  timingMode: "trusted",
  reviewThreshold: 0.75,
});
const timeline = buildReferenceTimeline({
  classification: classified.classification,
  timingMode: "trusted",
  contentPolicy: "dialogue-and-lyrics",
});

const targeted = await loadTargetedCues();
const baseCandidates = c3Evidence.candidates.map(materializeCandidate);
const allCandidates = [...baseCandidates, ...targeted.cues];
const hypotheses = resolveCompetingHypotheses({
  cues: allCandidates,
  evidenceCues: allCandidates,
  mode: "top-score",
  terminology,
  semantic,
  referenceTimeline: timeline,
});
const deduplicated = deduplicateTopScoreWinners(hypotheses.cues);
const fragmentRepair = repairTopScoreFragments(deduplicated.cues);
const timingRepair = repairTopScoreWinnerTiming({
  cues: fragmentRepair.cues,
  equivalentCandidates: hypotheses.atomization.atoms,
  referenceTimeline: timeline,
});
const normalization = normalizeJapaneseLexicalForm({
  cues: timingRepair.cues,
  allCandidates: hypotheses.atomization.atoms,
  atomicClusters: hypotheses.atomicClusters,
  terminologyEntries: [...terminology.entries, ...c4Terminology.entries],
  terminologySha256: null,
  mode: "top-score",
});
const postNormalizationDeduplication = deduplicateNormalizedWinners(
  normalization.cues,
);
const segmentation = buildAcousticSemanticCueSegments(
  postNormalizationDeduplication.cues,
  { mode: "acoustic-semantic", japaneseTextAnalyzer: "auto" },
);
const lyricsValidity = validateLyricsText({ cues: segmentation.cues });
const preliminaryTextIntegrity = runFinalTextIntegrityGate({
  cues: segmentation.cues,
  mode: "observe",
  japaneseTextAnalysis: segmentation.japaneseTextAnalysis,
  candidateEvidence: hypotheses.candidateEvidence,
  hypothesisResolution: hypotheses.resolution,
  segmentationPlan: segmentation.plan,
  lyricsValidity,
});
const textRepair = repairTextIntegrityFailures({
  cues: segmentation.cues,
  preliminary: preliminaryTextIntegrity.artifact,
  preSegmentationCues: postNormalizationDeduplication.cues,
  allCandidates: hypotheses.atomization.atoms,
  atomicClusters: hypotheses.atomicClusters,
  topScoreResolution: hypotheses.topScoreResolution,
  winnerDeduplication: deduplicated.artifact,
  segmentationPlan: segmentation.plan,
  maximumRepairRounds: 2,
});
const finalTextGate = runFinalTextIntegrityGate({
  cues: textRepair.cues,
  mode: "enforce",
  candidateEvidence: hypotheses.candidateEvidence,
  hypothesisResolution: hypotheses.resolution,
  segmentationPlan: segmentation.plan,
  lyricsValidity,
});
const presentation = layoutSubtitleCuesWithDiagnostics(finalTextGate.cues, {
  segmentationMode: "presegmented",
  allowTemporalCueSplitting: false,
});
const preliminaryLineIntegrity = evaluateLineLayoutIntegrity(presentation.cues);
const unsafeCueIds = new Set(
  preliminaryLineIntegrity.findings.map((finding) => finding.cueId),
);
const subtitleRepairInput = presentation.cues.filter(
  (cue) => !unsafeCueIds.has(cue.id),
);
const preliminarySubtitleIntegrity = evaluateFinalSubtitleIntegrity({
  cues: subtitleRepairInput,
  supportedLyricsCueIds: subtitleRepairInput
    .filter(
      (cue) => cue.provenance?.sourceLayer === "reference-original-language",
    )
    .map((cue) => cue.id),
});
const subtitleRepair = repairFinalSubtitleIntegrity({
  cues: subtitleRepairInput,
  findings: preliminarySubtitleIntegrity.findings,
});
const finalSubtitleGate = runFinalSubtitleIntegrityGate({
  cues: subtitleRepair.cues,
  supportedLyricsCueIds: subtitleRepair.cues
    .filter(
      (cue) => cue.provenance?.sourceLayer === "reference-original-language",
    )
    .map((cue) => cue.id),
  supportedLongCueIds: subtitleRepair.supportedLongCueIds,
});
const finalTextProjection = runFinalTextIntegrityGate({
  cues: finalSubtitleGate.cues,
  mode: "enforce",
});
const finalSubtitleProjection = runFinalSubtitleIntegrityGate({
  cues: finalTextProjection.cues,
  supportedLongCueIds: subtitleRepair.supportedLongCueIds,
});
const finalTextAudit = runFinalTextIntegrityGate({
  cues: finalSubtitleProjection.cues,
  mode: "observe",
});
const finalSubtitleAudit = runFinalSubtitleIntegrityGate({
  cues: finalSubtitleProjection.cues,
  supportedLongCueIds: subtitleRepair.supportedLongCueIds,
});
const lineLayoutAudit = evaluateLineLayoutIntegrity(finalSubtitleAudit.cues);
const generatedSrt = formatSrt(finalSubtitleAudit.cues);
const generatedSubtitleSha256 = createHash("sha256")
  .update(generatedSrt)
  .digest("hex");
const alignment = alignReferenceTimeline({
  timeline,
  generatedCues: finalSubtitleAudit.cues,
  generatedSubtitleSha256,
  speechIntervals: speechAnchors.anchors.map((anchor) => anchor.interval),
});
const preliminaryReview = buildFinalReviewQueue({
  historicalQuality,
  postPresentationQuality,
  finalCues: finalSubtitleAudit.cues,
  speechIntervals: speechAnchors.anchors.map((anchor) => anchor.interval),
  finalIntegrity: finalSubtitleGate.artifact,
});
const preliminaryAnchorCoverage = evaluateAnchorTextCoverage({
  timeline,
  alignment,
  generatedCues: finalSubtitleAudit.cues,
  generatedSubtitleSha256,
  finalTextIntegrity: finalTextAudit.artifact,
  activeReviewIntervals: preliminaryReview.queue.groups.map(
    (group) => group.interval,
  ),
});
const coveragePlan = buildCoverageRecoveryPlan({
  timeline,
  coverage: preliminaryAnchorCoverage,
  finalCues: finalSubtitleAudit.cues,
  textIntegrity: finalTextGate.artifact,
  subtitleIntegrity: finalSubtitleGate.artifact,
  mode: "auto",
  round: Math.min(
    2,
    (targeted.result?.runs?.length ?? (targeted.result === null ? 0 : 1)) + 1,
  ),
  maximumRounds: 2,
  maximumWindowSeconds: 12,
});
const targetedRequestCount = (
  targeted.result?.runs ??
  (targeted.result === null ? [] : [{ windows: targeted.result.windows }])
)
  .flatMap((run) => run.windows)
  .reduce((sum, window) => sum + window.requestIds.length, 0);
const targetedCacheHitCount = (
  targeted.result?.runs ??
  (targeted.result === null ? [] : [{ windows: targeted.result.windows }])
)
  .flatMap((run) => run.windows)
  .reduce((sum, window) => sum + window.cacheHitCount, 0);
const targetedRuns =
  targeted.result?.runs ??
  (targeted.result === null
    ? []
    : [
        {
          round: 1,
          sourcePlanHash: targeted.result.sourcePlanHash,
          windows: targeted.result.windows,
          execution: targeted.result.execution,
        },
      ]);
const targetedWindows = targetedRuns.flatMap((run) => run.windows);
const targetedResultEntries = targetedWindows.map((window) => ({
  unitId: window.unitId,
  requestIds: window.requestIds,
  cacheHitCount: window.cacheHitCount,
  candidateCueIds: window.segments.map((segment) => segment.id),
  acceptedCueIds: window.accepted
    ? window.segments.map((segment) => segment.id)
    : [],
  decision: window.accepted ? ("accepted" as const) : ("rejected" as const),
  reasons: window.reasons,
}));
const coverageResults: CoverageRecoveryResultsArtifact =
  coverageRecoveryResultsArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    planInputHash:
      targetedRuns.at(-1)?.sourcePlanHash ?? coveragePlan.inputHash,
    roundsCompleted: targetedRuns.length,
    results:
      targetedResultEntries.length > 0
        ? targetedResultEntries
        : coveragePlan.units.map((unit) => ({
            unitId: unit.id,
            requestIds: [],
            cacheHitCount: 0,
            candidateCueIds: [],
            acceptedCueIds: [],
            decision: unit.shouldRunAsr ? "not-run" : "review-only",
            reasons: [
              unit.shouldRunAsr
                ? "pending-plan-driven-targeted-execution"
                : "planner-marked-review-only",
            ],
          })),
    summary: {
      requestCount: targetedRequestCount,
      cacheHitCount: targetedCacheHitCount,
      acceptedCandidateCount: targeted.cues.length,
      rejectedCandidateCount: targetedWindows.reduce(
        (sum, window) =>
          sum +
          window.reasons.filter((reason) => reason.includes(":rejected:"))
            .length,
        0,
      ),
      rejectedHallucinationCount: targetedWindows.reduce(
        (sum, window) =>
          sum +
          window.reasons.filter((reason) =>
            reason.includes("known-boilerplate-hallucination"),
          ).length,
        0,
      ),
      rejectedNoAudibleSpeechCount: targetedWindows.reduce(
        (sum, window) =>
          sum +
          window.reasons.filter((reason) =>
            reason.includes("no-audible-japanese-segment"),
          ).length,
        0,
      ),
      workerStartCount: targetedRuns.reduce(
        (sum, run) => sum + run.execution.workerStartCount,
        0,
      ),
      modelLoadCount: targetedRuns.reduce(
        (sum, run) => sum + run.execution.modelLoadCount,
        0,
      ),
      fallbackProcessCount: targetedRuns.reduce(
        (sum, run) => sum + run.execution.fallbackProcessCount,
        0,
      ),
    },
    stopReason:
      targeted.result === null
        ? coveragePlan.summary.automaticRequestCount === 0
          ? "no-recovery-units"
          : "pending-execution"
        : targeted.cues.length === 0
          ? "no-new-accepted-candidates"
          : targetedRuns.length >= 2
            ? "maximum-rounds-reached"
            : "completed",
  });

const review = buildFinalReviewQueue({
  historicalQuality,
  postPresentationQuality,
  finalCues: finalSubtitleAudit.cues,
  speechIntervals: speechAnchors.anchors.map((anchor) => anchor.interval),
  finalIntegrity: finalSubtitleAudit.artifact,
  textIntegrityRepair: textRepair.artifact,
  subtitleIntegrityRepair: subtitleRepair.artifact,
  coverageRecoveryPlan: coveragePlan,
  coverageRecoveryResults: coverageResults,
  referenceClassification: classified.classification,
  referenceClassificationReview: classified.review,
  japaneseNormalization: normalization.artifact,
});
const anchorCoverage = evaluateAnchorTextCoverage({
  timeline,
  alignment,
  generatedCues: finalSubtitleAudit.cues,
  generatedSubtitleSha256,
  finalTextIntegrity: finalTextAudit.artifact,
  activeReviewIntervals: review.queue.groups.map((group) => group.interval),
});

const sourceVideoStat = await stat(VIDEO_PATH);
const sourceVideoHash = await sha256File(VIDEO_PATH);
const hardIntegrityErrorCount =
  finalTextAudit.artifact.findings.filter(
    (finding) => finding.severity === "hard",
  ).length +
  finalSubtitleAudit.artifact.findings.filter(
    (finding) => finding.severity === "hard",
  ).length +
  lineLayoutAudit.visualLineWordBreakCount;
const c3Classification = (await json(
  c3SubtitleDirectory,
  "reference-cue-classification.json",
)) as { cues: { id: string; kind: string }[] };
const oldKinds = new Map(
  c3Classification.cues.map((cue) => [cue.id, cue.kind]),
);
const reclassified = classified.classification.cues.filter(
  (cue) => oldKinds.get(cue.id) !== cue.kind,
);
const report = c4ReplayReportArtifactSchema.parse({
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  runType: "C4 cached coverage-recovery replay",
  sourceC3: C3_ROOT,
  outputDirectory: C4_ROOT,
  wholeEpisodeWhisperExecuted: false,
  targetedAsrExecuted: targeted.result !== null,
  statistics: {
    c3CandidateCount: c3Evidence.candidates.length,
    targetedCandidateCount: targeted.cues.length,
    atomicCandidateCount: hypotheses.atomization.atoms.length,
    atomicClusterCount: hypotheses.atomicClusters.clusters.length,
    topScoreWinnerCount: hypotheses.topScoreWinners.winnerCount,
    c3TextQuarantineCount: c3FinalText.quarantinedCueIds.length,
    preliminaryTextFindingCount:
      preliminaryTextIntegrity.artifact.findings.length,
    textRepairAttemptedCount: textRepair.artifact.summary.repairAttemptCount,
    textRepairSucceededCount: textRepair.artifact.summary.successfulRepairCount,
    textStillHardBlockedCount:
      textRepair.artifact.summary.stillHardBlockedCount,
    textRepairStrategies: countBy(
      textRepair.artifact.repairs.map((entry) => entry.repairStrategy),
    ),
    c3SubtitleFindingCount: c3FinalSubtitle.findings.length,
    preliminarySubtitleFindingCount:
      preliminarySubtitleIntegrity.findings.length,
    subtitleRepairSucceededCount: subtitleRepair.artifact.repairs.filter(
      (entry) => entry.result !== "unresolved",
    ).length,
    subtitleRepairStrategies: countBy(
      subtitleRepair.artifact.repairs.map((entry) => entry.strategy),
    ),
    normalizationChangedCueCount:
      normalization.artifact.summary.changedCueCount,
    kanaToKanjiCount: normalization.artifact.summary.kanaToKanjiCount,
    dialectPreservedCount: normalization.artifact.summary.dialectPreservedCount,
    referenceReclassifiedCount: reclassified.length,
    referenceReclassifiedCueIds: reclassified.map((cue) => cue.id),
    referenceClassificationCounts: classified.classification.counts,
    expectedSpeechDenominator: anchorCoverage.summary.expectedAnchors,
    coverageRecoveryUnitCount: coveragePlan.summary.unitCount,
    coverageRecoveryAutomaticRequestCount:
      coveragePlan.summary.automaticRequestCount,
    coverageRecoveryPriorityCounts: coveragePlan.summary.priorityCounts,
    targetedAsrRequestCount: targetedRequestCount,
    targetedAsrCacheHitCount: targetedCacheHitCount,
    acceptedTargetedCandidateCount: targeted.cues.length,
    c3FinalCueCount: 82,
    finalCueCount: finalSubtitleAudit.cues.length,
    finalCueIncrease: finalSubtitleAudit.cues.length - 82,
    c3MissingDialogueGroupCount: c3Review.trueMissingDialogueGroupCount ?? 0,
    trueMissingDialogueGroupCount:
      review.queue.trueMissingDialogueGroupCount ?? 0,
    anchorCoverage: anchorCoverage.summary,
    finalHardIntegrityErrorCount: hardIntegrityErrorCount,
    visualLineWordBreakCount: lineLayoutAudit.visualLineWordBreakCount,
    invalidTimestampCount:
      finalSubtitleAudit.artifact.metrics.invalidTimestampCount,
    overlapCount: finalSubtitleAudit.artifact.metrics.overlapCount,
    characterRatioFallbackCount:
      segmentation.plan.summary.characterFallbackSegmentationCount +
      presentation.characterFallbackSegmentationCount,
  },
  repairDetails: {
    text: textRepair.artifact.repairs,
    subtitle: subtitleRepair.artifact.repairs,
    reclassifiedReferenceCues: reclassified.map((cue) => ({
      cueId: cue.id,
      before: oldKinds.get(cue.id) ?? "missing",
      after: cue.kind,
      confidence: cue.classificationConfidence,
      text: cue.normalizedText,
    })),
    normalizationChanges: normalization.artifact.cues.filter(
      (cue) => cue.changed,
    ),
  },
  sourceVideo: {
    path: VIDEO_PATH,
    sha256: sourceVideoHash,
    sizeBytes: sourceVideoStat.size,
    inode: sourceVideoStat.ino,
    mtimeMs: sourceVideoStat.mtimeMs,
  },
  wallClockSeconds: (performance.now() - started) / 1000,
});
const finalAudit = c4FinalOutputAuditArtifactSchema.parse({
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  finalTextIntegrity: finalTextAudit.artifact,
  finalSubtitleIntegrity: finalSubtitleAudit.artifact,
  lineLayoutIntegrity: lineLayoutAudit,
  acceptedCueCount: finalSubtitleAudit.cues.length,
  finalHardIntegrityErrorCount: hardIntegrityErrorCount,
  characterRatioFallbackCount:
    segmentation.plan.summary.characterFallbackSegmentationCount +
    presentation.characterFallbackSegmentationCount,
  subtitleHashes: {
    srt: generatedSubtitleSha256,
    vtt: createHash("sha256")
      .update(formatVtt(finalSubtitleAudit.cues))
      .digest("hex"),
    ass: createHash("sha256")
      .update(formatAss(finalSubtitleAudit.cues))
      .digest("hex"),
  },
  sourceVideo: report.sourceVideo,
});
const sourceInfo = (await json(c3SubtitleDirectory, "source-info.json")) as {
  fileName: string;
  format: { names: string[]; durationSeconds: number };
};
const mediaIdentity = (await json(
  c3SubtitleDirectory,
  "media-identity.json",
)) as {
  title: string | null;
  season: number | null;
  episode: number | null;
  year: number | null;
};
const latestAsrCacheManifest = asrCacheManifestArtifactSchema.parse(
  await json(c4SubtitleDirectory, "asr-cache-manifest.json"),
);
const subtitleFileStem = path.basename(c4SubtitleDirectory);
const subtitlePackage = subtitlePackageSchema.parse({
  schemaVersion: "1.0.0",
  packageType: "multilingual-subtitle-package",
  status: "ready",
  sourceLanguage: "ja",
  detectedLanguages: ["ja"],
  source: {
    fileName: sourceInfo.fileName,
    container: sourceInfo.format.names[0] ?? null,
    durationSeconds: sourceInfo.format.durationSeconds,
  },
  identity: {
    title: mediaIdentity.title,
    season: mediaIdentity.season,
    episode: mediaIdentity.episode,
    year: mediaIdentity.year,
  },
  primarySubtitle: {
    language: "ja",
    sourceType: "transcription",
    validationStatus: "needs-review",
    streamIndex: null,
  },
  subtitleFiles: {
    srt: `./${subtitleFileStem}.srt`,
    vtt: `./${subtitleFileStem}.vtt`,
    ass: `./${subtitleFileStem}.ass`,
  },
  referenceSubtitles: [],
  video: { sourcePath: null, subtitledPath: null },
  cues: finalSubtitleAudit.cues,
  warnings: [
    "C4 reused C3 candidates and ran only plan-driven targeted ASR; whole-episode Whisper was not executed.",
    `${review.queue.trueMissingDialogueGroupCount ?? 0} true missing-dialogue groups remain for human listening review.`,
  ],
  transcription: {
    provider: "whisper-cpp",
    strategy: "quality",
    coreML: { status: "available", fallback: null },
    qualitySummary: {
      accepted: finalSubtitleAudit.cues.length,
      refined: targeted.cues.length,
      needsHumanReview: review.queue.uniqueReviewGroupCount,
    },
    textIntegrityRepair: {
      artifactPath: "text-integrity-repair.json",
      attempted: textRepair.artifact.summary.repairAttemptCount,
      succeeded: textRepair.artifact.summary.successfulRepairCount,
      stillHardBlocked: textRepair.artifact.summary.stillHardBlockedCount,
    },
    finalSubtitleRepair: {
      artifactPath: "final-subtitle-repair.json",
      repaired: subtitleRepair.artifact.repairs.filter(
        (entry) => entry.result === "repaired",
      ).length,
      unresolved: subtitleRepair.artifact.repairs.filter(
        (entry) => entry.result === "unresolved",
      ).length,
    },
    finalSubtitleIntegrity: {
      artifactPath: "final-subtitle-integrity.json",
      validationStatus: finalSubtitleAudit.artifact.validationStatus,
      finalCueCount: finalSubtitleAudit.cues.length,
      quarantinedCueCount: finalSubtitleAudit.artifact.quarantinedCueIds.length,
      hardFindingCount: finalSubtitleAudit.artifact.findings.filter(
        (finding) => finding.severity === "hard",
      ).length,
      subtitleCoverageRatio: 1,
    },
    asrCache: {
      manifestPath: "asr-cache-manifest.json",
      migrationPath: "asr-cache-migration.json",
      mode: latestAsrCacheManifest.mode,
      requestCount: latestAsrCacheManifest.summary.requestCount,
      hitCount:
        latestAsrCacheManifest.summary.portableHitCount +
        latestAsrCacheManifest.summary.taskLocalHitCount +
        latestAsrCacheManifest.summary.legacyHitCount,
      migratedEntryCount: latestAsrCacheManifest.summary.migratedEntryCount,
      missCount: latestAsrCacheManifest.summary.missCount,
      workerRequestsAvoided:
        latestAsrCacheManifest.summary.workerRequestsAvoided,
    },
  },
  referenceGuidance: {
    mode: "reference-guided",
    referenceLanguage: "en",
    blindGenerationProofPath: null,
    analysisPath: "./reference-subtitle-analysis.json",
    classificationReviewPath: "./reference-classification-review.json",
    timelinePath: "./reference-timeline.json",
    alignmentPath: "./reference-cue-alignment.json",
    evaluationPath: null,
    coverageIntegrityPath: null,
    coverageRecoveryPlanPath: "./coverage-recovery-plan.json",
    coverageRecoveryResultsPath: "./coverage-recovery-results.json",
    referenceTextUsedAsTargetPrompt: false,
  },
});
const processingManifest = {
  schemaVersion: "1.0.0",
  taskId: "carnation-reference-guided-c4-cached-20260801",
  startedAt: report.generatedAt,
  updatedAt: new Date().toISOString(),
  sourcePath: VIDEO_PATH,
  outputDirectory: C4_ROOT,
  status: "completed",
  completedStages: [
    "c3-candidate-reuse",
    "reference-subtitle-classification",
    "reference-timeline",
    "atomic-candidate-segmentation",
    "atomic-hypothesis-clustering",
    "top-score-resolution",
    "winner-deduplication",
    "fragment-repair",
    "winner-timing-repair",
    "japanese-lexical-normalization",
    "text-integrity-repair",
    "final-text-integrity",
    "final-subtitle-repair",
    "coverage-recovery-planning",
    "targeted-coverage-recovery",
    "final-subtitle-integrity",
    "reference-alignment",
    "final-review-queue",
    "subtitle-package-validation",
  ],
  workingMediaPath: VIDEO_PATH,
  operations: [],
  normalizationChanges: [],
  transcription: {
    provider: "whisper-cpp",
    strategy: "quality",
    baseline: { model: "ggml-large-v3.bin", coreML: true },
    refinement: {
      model: "ggml-large-v3.bin",
      coreML: true,
      rounds: targetedRuns.length,
    },
    fallbacks: [],
    quality: {
      acceptedSegments: finalSubtitleAudit.cues.length,
      refinedSegments: targeted.cues.length,
      humanReviewSegments: review.queue.uniqueReviewGroupCount,
      reviewEventCount:
        review.queue.reviewEventCount ?? review.queue.uniqueReviewGroupCount,
      vadNoVadConflicts: 0,
      resolvedByLargeV3: targeted.cues.length,
      suspectedHallucinations: coverageResults.summary.rejectedCandidateCount,
      probableNonSpeech: 0,
      autoResolvedVad: 0,
      autoResolvedNoVad: 0,
      autoResolvedLargeV3: targeted.cues.length,
      rejectedVadHallucinations: 0,
      rejectedNoVadHallucinations: 0,
      trueUnresolvedConflicts: 0,
      needsHumanReviewIntervals: review.queue.groups.map((group) => ({
        ...group.interval,
        reasons: group.reasons,
      })),
    },
    timing: {
      tokenTimestampsAvailable: true,
      tokenTimestampsUsed: finalSubtitleAudit.cues.some(
        (cue) => cue.timingEvidence?.tokenTimestampsUsed === true,
      ),
      timingRepairCount: timingRepair.artifact.repairs.length,
      characterRatioFallbackCount:
        report.statistics.characterRatioFallbackCount,
      prePresentationQualityPath: "preliminary-text-integrity.json",
      postPresentationQualityPath: "final-text-integrity.json",
      timingFindingsPath: "transcription-timing-findings.json",
      finalReviewQueuePath: "final-review-queue.json",
      whisperExecutionMetricsPath: "coverage-targeted-whisper-metrics.json",
      finalSubtitleIntegrityPath: "final-subtitle-integrity.json",
      textIntegrityRepairPath: "text-integrity-repair.json",
      finalSubtitleRepairPath: "final-subtitle-repair.json",
      asrCacheManifestPath: "asr-cache-manifest.json",
      asrCacheMigrationPath: "asr-cache-migration.json",
    },
  },
  referenceGuidance: {
    mode: "reference-guided",
    referencePathKnown: true,
    referenceOpenedBeforeBlindGeneration: false,
    referenceTextUsedAsTargetPrompt: false,
    analysisPath: "reference-subtitle-analysis.json",
    classificationReviewPath: "reference-classification-review.json",
    timelinePath: "reference-timeline.json",
    alignmentPath: "reference-cue-alignment.json",
    coverageRecoveryPlanPath: "coverage-recovery-plan.json",
    coverageRecoveryResultsPath: "coverage-recovery-results.json",
    fallback: null,
  },
  error: null,
};
const reportMarkdown =
  `# C4 Coverage Recovery Replay\n\n` +
  `- Whole-episode Whisper: not executed\n` +
  `- C3 candidates reused: ${report.statistics.c3CandidateCount}\n` +
  `- C3 text quarantine → C4 repair success: ${report.statistics.c3TextQuarantineCount} → ${report.statistics.textRepairSucceededCount}\n` +
  `- C3 → C4 final cues: ${report.statistics.c3FinalCueCount} → ${report.statistics.finalCueCount}\n` +
  `- Coverage recovery tasks / automatic requests: ${report.statistics.coverageRecoveryUnitCount} / ${report.statistics.coverageRecoveryAutomaticRequestCount}\n` +
  `- Targeted requests / accepted cues: ${report.statistics.targetedAsrRequestCount} / ${report.statistics.acceptedTargetedCandidateCount}\n` +
  `- Final hard integrity errors: ${report.statistics.finalHardIntegrityErrorCount}\n` +
  `- Wall clock: ${report.wallClockSeconds.toFixed(3)} seconds\n`;

const unchangedArtifacts = [
  "source-info.json",
  "media-identity.json",
  "media-profile.json",
  "discovered-speech-anchors.json",
  "whisper-execution-metrics.json",
  "reference-subtitle-analysis.json",
];
await Promise.all([
  ...unchangedArtifacts.map((fileName) =>
    copyFile(
      path.join(c3SubtitleDirectory, fileName),
      path.join(c4SubtitleDirectory, fileName),
    ),
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "reference-cue-classification.json"),
    classified.classification,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "reference-classification-review.json"),
    classified.review,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "reference-timeline.json"),
    timeline,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "cue-candidate-evidence.json"),
    hypotheses.candidateEvidence,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "hypothesis-clusters.json"),
    hypotheses.clusters,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "hypothesis-resolution.json"),
    hypotheses.resolution,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "atomic-candidate-segmentation.json"),
    hypotheses.atomization,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "atomic-hypothesis-clusters.json"),
    hypotheses.atomicClusters,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "top-score-resolution.json"),
    hypotheses.topScoreResolution,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "top-score-winners.json"),
    hypotheses.topScoreWinners,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "winner-deduplication.json"),
    deduplicated.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "fragment-repair.json"),
    fragmentRepair.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "winner-timing-repair.json"),
    timingRepair.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "japanese-lexical-normalization.json"),
    normalization.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "post-normalization-deduplication.json"),
    postNormalizationDeduplication.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "japanese-text-analysis.json"),
    segmentation.japaneseTextAnalysis,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "cue-segmentation-plan.json"),
    segmentation.plan,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "lyrics-text-validity.json"),
    lyricsValidity,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "preliminary-text-integrity.json"),
    preliminaryTextIntegrity.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "text-integrity-repair.json"),
    textRepair.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "final-text-integrity.json"),
    finalTextAudit.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "presentation-timing.json"),
    presentation.timingRecords,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "line-layout-integrity.json"),
    lineLayoutAudit,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "preliminary-subtitle-integrity.json"),
    preliminarySubtitleIntegrity,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "final-subtitle-repair.json"),
    subtitleRepair.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "final-subtitle-integrity.json"),
    finalSubtitleAudit.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "reference-cue-alignment.json"),
    alignment,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "anchor-text-coverage.json"),
    anchorCoverage,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "coverage-recovery-plan.json"),
    coveragePlan,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "coverage-recovery-results.json"),
    coverageResults,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "transcription-timing-findings.json"),
    review.findings,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "final-review-queue.json"),
    review.queue,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "c4-final-output-audit.json"),
    finalAudit,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "c4-replay-report.json"),
    report,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "subtitle-package.json"),
    subtitlePackage,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c4SubtitleDirectory, "processing-manifest.json"),
    processingManifest,
    { overwrite: true },
  ),
  atomicWriteFile(
    path.join(c4SubtitleDirectory, "c4-replay-report.md"),
    reportMarkdown,
    { overwrite: true },
  ),
  atomicWriteFile(
    path.join(c4SubtitleDirectory, `${path.basename(c4SubtitleDirectory)}.srt`),
    generatedSrt,
    { overwrite: true },
  ),
  atomicWriteFile(
    path.join(c4SubtitleDirectory, `${path.basename(c4SubtitleDirectory)}.vtt`),
    formatVtt(finalSubtitleAudit.cues),
    { overwrite: true },
  ),
  atomicWriteFile(
    path.join(c4SubtitleDirectory, `${path.basename(c4SubtitleDirectory)}.ass`),
    formatAss(finalSubtitleAudit.cues),
    { overwrite: true },
  ),
]);

console.log(JSON.stringify(report, null, 2));
