import path from "node:path";

import {
  acousticSceneWindowsArtifactSchema,
  acousticScenesArtifactSchema,
  asrRoutingPlanArtifactSchema,
  asrCacheManifestArtifactSchema,
  asrCacheMigrationArtifactSchema,
  anchorCoverageIntegrityArtifactSchema,
  anchorTextCoverageArtifactSchema,
  atomicHypothesisClustersArtifactSchema,
  atomicWriteFile,
  blindGenerationProofArtifactSchema,
  canonicalAsrSegmentsArtifactSchema,
  c4FinalOutputAuditArtifactSchema,
  c4PersistentWorkerVerificationArtifactSchema,
  c4ReplayReportArtifactSchema,
  cueCandidateEvidenceArtifactSchema,
  candidateAtomizationArtifactSchema,
  cueSegmentationPlanArtifactSchema,
  deviceProfileSchema,
  discoveredSpeechAnchorsArtifactSchema,
  falseQuarantineReportArtifactSchema,
  finalSubtitleRepairArtifactSchema,
  intraCueRepetitionRepairArtifactSchema,
  finalTextIntegrityArtifactSchema,
  textIntegrityRepairArtifactSchema,
  grammarReportSchema,
  mediaProfileSchema,
  mediaIdentitySchema,
  hypothesisClustersArtifactSchema,
  hypothesisResolutionArtifactSchema,
  topScoreResolutionArtifactSchema,
  topScoreWinnersArtifactSchema,
  winnerDeduplicationArtifactSchema,
  fragmentRepairArtifactSchema,
  winnerTimingRepairArtifactSchema,
  japaneseLexicalNormalizationArtifactSchema,
  lineLayoutIntegrityArtifactSchema,
  presentationConstraintIntegrityArtifactSchema,
  japaneseTextAnalysisArtifactSchema,
  lyricsTextValidityArtifactSchema,
  referenceCoverageIntegrityArtifactSchema,
  referenceCueAlignmentArtifactSchema,
  referenceCueClassificationArtifactSchema,
  referenceClassificationReviewArtifactSchema,
  referenceSemanticValidationArtifactSchema,
  referenceOriginalLyricsResolutionArtifactSchema,
  referenceSubtitleAnalysisArtifactSchema,
  referenceTimelineArtifactSchema,
  referenceTranscriptionPlanArtifactSchema,
  finalReviewQueueSchema,
  finalSubtitleIntegrityArtifactSchema,
  lyricsTranscriptionArtifactSchema,
  missingDialogueRecoveryArtifactSchema,
  subtitlePackageSchema,
  subtitleEvaluationArtifactSchema,
  semanticCandidateValidationArtifactSchema,
  terminologyEvidenceArtifactSchema,
  transcriptionPlanSchema,
  transcriptionQualitySchema,
  transcriptionRefinementSchema,
  transcriptionTimingFindingsSchema,
  portableAsrCacheEntryV2Schema,
  coverageRecoveryPlanArtifactSchema,
  coverageRecoveryResultsArtifactSchema,
  whisperExecutionMetricsSchema,
  whisperBenchmarkSchema,
} from "@mvl/shared";
import { format } from "prettier";
import { z } from "zod";

const schemas = [
  {
    fileName: "media-identity.schema.json",
    id: "https://schemas.local/multilingual-video-learning/media-identity.schema.json",
    schema: mediaIdentitySchema,
  },
  {
    fileName: "subtitle-package.schema.json",
    id: "https://schemas.local/multilingual-video-learning/subtitle-package.schema.json",
    schema: subtitlePackageSchema,
  },
  {
    fileName: "grammar-report.schema.json",
    id: "https://schemas.local/multilingual-video-learning/grammar-report.schema.json",
    schema: grammarReportSchema,
  },
  {
    fileName: "device-profile.schema.json",
    id: "https://schemas.local/multilingual-video-learning/device-profile.schema.json",
    schema: deviceProfileSchema,
  },
  {
    fileName: "media-profile.schema.json",
    id: "https://schemas.local/multilingual-video-learning/media-profile.schema.json",
    schema: mediaProfileSchema,
  },
  {
    fileName: "acoustic-scene-windows.schema.json",
    id: "https://schemas.local/multilingual-video-learning/acoustic-scene-windows.schema.json",
    schema: acousticSceneWindowsArtifactSchema,
  },
  {
    fileName: "acoustic-scenes.schema.json",
    id: "https://schemas.local/multilingual-video-learning/acoustic-scenes.schema.json",
    schema: acousticScenesArtifactSchema,
  },
  {
    fileName: "asr-routing-plan.schema.json",
    id: "https://schemas.local/multilingual-video-learning/asr-routing-plan.schema.json",
    schema: asrRoutingPlanArtifactSchema,
  },
  {
    fileName: "whisper-benchmark.schema.json",
    id: "https://schemas.local/multilingual-video-learning/whisper-benchmark.schema.json",
    schema: whisperBenchmarkSchema,
  },
  {
    fileName: "transcription-plan.schema.json",
    id: "https://schemas.local/multilingual-video-learning/transcription-plan.schema.json",
    schema: transcriptionPlanSchema,
  },
  {
    fileName: "transcription-quality.schema.json",
    id: "https://schemas.local/multilingual-video-learning/transcription-quality.schema.json",
    schema: transcriptionQualitySchema,
  },
  {
    fileName: "transcription-refinement.schema.json",
    id: "https://schemas.local/multilingual-video-learning/transcription-refinement.schema.json",
    schema: transcriptionRefinementSchema,
  },
  {
    fileName: "transcription-timing-findings.schema.json",
    id: "https://schemas.local/multilingual-video-learning/transcription-timing-findings.schema.json",
    schema: transcriptionTimingFindingsSchema,
  },
  {
    fileName: "final-review-queue.schema.json",
    id: "https://schemas.local/multilingual-video-learning/final-review-queue.schema.json",
    schema: finalReviewQueueSchema,
  },
  {
    fileName: "canonical-asr-segments.schema.json",
    id: "https://schemas.local/multilingual-video-learning/canonical-asr-segments.schema.json",
    schema: canonicalAsrSegmentsArtifactSchema,
  },
  {
    fileName: "missing-dialogue-recovery.schema.json",
    id: "https://schemas.local/multilingual-video-learning/missing-dialogue-recovery.schema.json",
    schema: missingDialogueRecoveryArtifactSchema,
  },
  {
    fileName: "whisper-execution-metrics.schema.json",
    id: "https://schemas.local/multilingual-video-learning/whisper-execution-metrics.schema.json",
    schema: whisperExecutionMetricsSchema,
  },
  {
    fileName: "lyrics-transcription.schema.json",
    id: "https://schemas.local/multilingual-video-learning/lyrics-transcription.schema.json",
    schema: lyricsTranscriptionArtifactSchema,
  },
  {
    fileName: "final-subtitle-integrity.schema.json",
    id: "https://schemas.local/multilingual-video-learning/final-subtitle-integrity.schema.json",
    schema: finalSubtitleIntegrityArtifactSchema,
  },
  {
    fileName: "final-subtitle-repair.schema.json",
    id: "https://schemas.local/multilingual-video-learning/final-subtitle-repair.schema.json",
    schema: finalSubtitleRepairArtifactSchema,
  },
  {
    fileName: "text-integrity-repair.schema.json",
    id: "https://schemas.local/multilingual-video-learning/text-integrity-repair.schema.json",
    schema: textIntegrityRepairArtifactSchema,
  },
  {
    fileName: "intra-cue-repetition-repair.schema.json",
    id: "https://schemas.local/multilingual-video-learning/intra-cue-repetition-repair.schema.json",
    schema: intraCueRepetitionRepairArtifactSchema,
  },
  {
    fileName: "blind-generation-proof.schema.json",
    id: "https://schemas.local/multilingual-video-learning/blind-generation-proof.schema.json",
    schema: blindGenerationProofArtifactSchema,
  },
  {
    fileName: "reference-subtitle-analysis.schema.json",
    id: "https://schemas.local/multilingual-video-learning/reference-subtitle-analysis.schema.json",
    schema: referenceSubtitleAnalysisArtifactSchema,
  },
  {
    fileName: "reference-cue-classification.schema.json",
    id: "https://schemas.local/multilingual-video-learning/reference-cue-classification.schema.json",
    schema: referenceCueClassificationArtifactSchema,
  },
  {
    fileName: "reference-classification-review.schema.json",
    id: "https://schemas.local/multilingual-video-learning/reference-classification-review.schema.json",
    schema: referenceClassificationReviewArtifactSchema,
  },
  {
    fileName: "reference-timeline.schema.json",
    id: "https://schemas.local/multilingual-video-learning/reference-timeline.schema.json",
    schema: referenceTimelineArtifactSchema,
  },
  {
    fileName: "reference-transcription-plan.schema.json",
    id: "https://schemas.local/multilingual-video-learning/reference-transcription-plan.schema.json",
    schema: referenceTranscriptionPlanArtifactSchema,
  },
  {
    fileName: "reference-cue-alignment.schema.json",
    id: "https://schemas.local/multilingual-video-learning/reference-cue-alignment.schema.json",
    schema: referenceCueAlignmentArtifactSchema,
  },
  {
    fileName: "reference-semantic-validation.schema.json",
    id: "https://schemas.local/multilingual-video-learning/reference-semantic-validation.schema.json",
    schema: referenceSemanticValidationArtifactSchema,
  },
  {
    fileName: "reference-coverage-integrity.schema.json",
    id: "https://schemas.local/multilingual-video-learning/reference-coverage-integrity.schema.json",
    schema: referenceCoverageIntegrityArtifactSchema,
  },
  {
    fileName: "subtitle-evaluation.schema.json",
    id: "https://schemas.local/multilingual-video-learning/subtitle-evaluation.schema.json",
    schema: subtitleEvaluationArtifactSchema,
  },
  {
    fileName: "false-quarantine-report.schema.json",
    id: "https://schemas.local/multilingual-video-learning/false-quarantine-report.schema.json",
    schema: falseQuarantineReportArtifactSchema,
  },
  {
    fileName: "discovered-speech-anchors.schema.json",
    id: "https://schemas.local/multilingual-video-learning/discovered-speech-anchors.schema.json",
    schema: discoveredSpeechAnchorsArtifactSchema,
  },
  {
    fileName: "anchor-coverage-integrity.schema.json",
    id: "https://schemas.local/multilingual-video-learning/anchor-coverage-integrity.schema.json",
    schema: anchorCoverageIntegrityArtifactSchema,
  },
  {
    fileName: "cue-candidate-evidence.schema.json",
    id: "https://schemas.local/multilingual-video-learning/cue-candidate-evidence.schema.json",
    schema: cueCandidateEvidenceArtifactSchema,
  },
  {
    fileName: "hypothesis-clusters.schema.json",
    id: "https://schemas.local/multilingual-video-learning/hypothesis-clusters.schema.json",
    schema: hypothesisClustersArtifactSchema,
  },
  {
    fileName: "hypothesis-resolution.schema.json",
    id: "https://schemas.local/multilingual-video-learning/hypothesis-resolution.schema.json",
    schema: hypothesisResolutionArtifactSchema,
  },
  {
    fileName: "atomic-candidate-segmentation.schema.json",
    id: "https://schemas.local/multilingual-video-learning/atomic-candidate-segmentation.schema.json",
    schema: candidateAtomizationArtifactSchema,
  },
  {
    fileName: "atomic-hypothesis-clusters.schema.json",
    id: "https://schemas.local/multilingual-video-learning/atomic-hypothesis-clusters.schema.json",
    schema: atomicHypothesisClustersArtifactSchema,
  },
  {
    fileName: "top-score-resolution.schema.json",
    id: "https://schemas.local/multilingual-video-learning/top-score-resolution.schema.json",
    schema: topScoreResolutionArtifactSchema,
  },
  {
    fileName: "top-score-winners.schema.json",
    id: "https://schemas.local/multilingual-video-learning/top-score-winners.schema.json",
    schema: topScoreWinnersArtifactSchema,
  },
  {
    fileName: "winner-deduplication.schema.json",
    id: "https://schemas.local/multilingual-video-learning/winner-deduplication.schema.json",
    schema: winnerDeduplicationArtifactSchema,
  },
  {
    fileName: "fragment-repair.schema.json",
    id: "https://schemas.local/multilingual-video-learning/fragment-repair.schema.json",
    schema: fragmentRepairArtifactSchema,
  },
  {
    fileName: "winner-timing-repair.schema.json",
    id: "https://schemas.local/multilingual-video-learning/winner-timing-repair.schema.json",
    schema: winnerTimingRepairArtifactSchema,
  },
  {
    fileName: "japanese-lexical-normalization.schema.json",
    id: "https://schemas.local/multilingual-video-learning/japanese-lexical-normalization.schema.json",
    schema: japaneseLexicalNormalizationArtifactSchema,
  },
  {
    fileName: "post-normalization-deduplication.schema.json",
    id: "https://schemas.local/multilingual-video-learning/post-normalization-deduplication.schema.json",
    schema: winnerDeduplicationArtifactSchema,
  },
  {
    fileName: "line-layout-integrity.schema.json",
    id: "https://schemas.local/multilingual-video-learning/line-layout-integrity.schema.json",
    schema: lineLayoutIntegrityArtifactSchema,
  },
  {
    fileName: "presentation-constraint-integrity.schema.json",
    id: "https://schemas.local/multilingual-video-learning/presentation-constraint-integrity.schema.json",
    schema: presentationConstraintIntegrityArtifactSchema,
  },
  {
    fileName: "japanese-text-analysis.schema.json",
    id: "https://schemas.local/multilingual-video-learning/japanese-text-analysis.schema.json",
    schema: japaneseTextAnalysisArtifactSchema,
  },
  {
    fileName: "cue-segmentation-plan.schema.json",
    id: "https://schemas.local/multilingual-video-learning/cue-segmentation-plan.schema.json",
    schema: cueSegmentationPlanArtifactSchema,
  },
  {
    fileName: "final-text-integrity.schema.json",
    id: "https://schemas.local/multilingual-video-learning/final-text-integrity.schema.json",
    schema: finalTextIntegrityArtifactSchema,
  },
  {
    fileName: "lyrics-text-validity.schema.json",
    id: "https://schemas.local/multilingual-video-learning/lyrics-text-validity.schema.json",
    schema: lyricsTextValidityArtifactSchema,
  },
  {
    fileName: "reference-original-lyrics-resolution.schema.json",
    id: "https://schemas.local/multilingual-video-learning/reference-original-lyrics-resolution.schema.json",
    schema: referenceOriginalLyricsResolutionArtifactSchema,
  },
  {
    fileName: "semantic-candidate-validation.schema.json",
    id: "https://schemas.local/multilingual-video-learning/semantic-candidate-validation.schema.json",
    schema: semanticCandidateValidationArtifactSchema,
  },
  {
    fileName: "terminology-evidence.schema.json",
    id: "https://schemas.local/multilingual-video-learning/terminology-evidence.schema.json",
    schema: terminologyEvidenceArtifactSchema,
  },
  {
    fileName: "anchor-text-coverage.schema.json",
    id: "https://schemas.local/multilingual-video-learning/anchor-text-coverage.schema.json",
    schema: anchorTextCoverageArtifactSchema,
  },
  {
    fileName: "coverage-recovery-plan.schema.json",
    id: "https://schemas.local/multilingual-video-learning/coverage-recovery-plan.schema.json",
    schema: coverageRecoveryPlanArtifactSchema,
  },
  {
    fileName: "coverage-recovery-results.schema.json",
    id: "https://schemas.local/multilingual-video-learning/coverage-recovery-results.schema.json",
    schema: coverageRecoveryResultsArtifactSchema,
  },
  {
    fileName: "portable-asr-cache-entry-v2.schema.json",
    id: "https://schemas.local/multilingual-video-learning/portable-asr-cache-entry-v2.schema.json",
    schema: portableAsrCacheEntryV2Schema,
  },
  {
    fileName: "asr-cache-manifest.schema.json",
    id: "https://schemas.local/multilingual-video-learning/asr-cache-manifest.schema.json",
    schema: asrCacheManifestArtifactSchema,
  },
  {
    fileName: "asr-cache-migration.schema.json",
    id: "https://schemas.local/multilingual-video-learning/asr-cache-migration.schema.json",
    schema: asrCacheMigrationArtifactSchema,
  },
  {
    fileName: "c4-replay-report.schema.json",
    id: "https://schemas.local/multilingual-video-learning/c4-replay-report.schema.json",
    schema: c4ReplayReportArtifactSchema,
  },
  {
    fileName: "c4-final-output-audit.schema.json",
    id: "https://schemas.local/multilingual-video-learning/c4-final-output-audit.schema.json",
    schema: c4FinalOutputAuditArtifactSchema,
  },
  {
    fileName: "c4-persistent-worker-verification.schema.json",
    id: "https://schemas.local/multilingual-video-learning/c4-persistent-worker-verification.schema.json",
    schema: c4PersistentWorkerVerificationArtifactSchema,
  },
] as const;

for (const entry of schemas) {
  const generated = z.toJSONSchema(entry.schema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  });
  const output = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: entry.id,
    title: entry.fileName.replace(".schema.json", ""),
    ...generated,
  };
  await atomicWriteFile(
    path.resolve("schemas", entry.fileName),
    await format(JSON.stringify(output), { parser: "json" }),
    {
      overwrite: true,
    },
  );
}

console.log(
  `Generated ${schemas.length} JSON Schemas in ${path.resolve("schemas")}.`,
);
