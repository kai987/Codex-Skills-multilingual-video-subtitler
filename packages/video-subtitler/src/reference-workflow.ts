import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  alignReferenceTimeline,
  analyzeReferenceSubtitle,
  buildFalseQuarantineReport,
  buildReferenceSemanticValidation,
  buildReferenceTimeline,
  buildReferenceTranscriptionPlan,
  classifyReferenceCuesWithReview,
  evaluateReferenceCoverageIntegrity,
  evaluateAnchorTextCoverage,
  buildCoverageRecoveryPlan,
  evaluateSubtitleAgainstReference,
  formatSubtitleDiffAss,
  formatSubtitleEvaluationMarkdown,
  parseReferenceSubtitleFile,
  validateReferenceTimingAgainstAlignment,
  type ParsedReferenceSubtitle,
} from "@mvl/transcription-core";
import {
  atomicWriteFile,
  atomicWriteJson,
  blindGenerationProofArtifactSchema,
  type BlindGenerationProofArtifact,
  type LanguageTag,
  type ReferenceContentPolicy,
  type ReferenceCueClassificationArtifact,
  type ReferenceClassificationReviewArtifact,
  type ReferenceRepairMode,
  type ReferenceSemanticValidationMode,
  type ReferenceSubtitleAnalysisArtifact,
  type ReferenceTimelineArtifact,
  type ReferenceTimingMode,
  type ReferenceTranscriptionPlanArtifact,
  type FinalTextIntegrityArtifact,
  type FinalSubtitleIntegrityArtifact,
  coverageRecoveryResultsArtifactSchema,
  type CoverageRecoveryMode,
  type SubtitleCue,
  type TranscriptionGuidanceMode,
  pathExists,
  readJson,
  referenceCueClassificationArtifactSchema,
  referenceSubtitleAnalysisArtifactSchema,
  referenceTimelineArtifactSchema,
} from "@mvl/shared";
import { formatSrt } from "@mvl/subtitle-core";

interface Interval {
  start: number;
  end: number;
}

export interface PreparedReferenceSubtitle {
  parsed: ParsedReferenceSubtitle;
  classification: ReferenceCueClassificationArtifact;
  timeline: ReferenceTimelineArtifact;
  analysis: ReferenceSubtitleAnalysisArtifact;
  classificationReview: ReferenceClassificationReviewArtifact;
}

export async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256GeneratedCues(cues: readonly SubtitleCue[]): string {
  return createHash("sha256").update(formatSrt(cues)).digest("hex");
}

export async function prepareReferenceSubtitle(input: {
  referencePath: string;
  referenceLanguage: LanguageTag;
  mediaDurationSeconds: number;
  timingMode: ReferenceTimingMode;
  contentPolicy: ReferenceContentPolicy;
  classificationReviewThreshold?: number;
  subtitleDirectory: string;
  overwrite: boolean;
}): Promise<PreparedReferenceSubtitle> {
  const parsed = await parseReferenceSubtitleFile(input.referencePath);
  const classified = classifyReferenceCuesWithReview({
    parsed,
    referenceLanguage: input.referenceLanguage,
    mediaDurationSeconds: input.mediaDurationSeconds,
    timingMode: input.timingMode,
    reviewThreshold: input.classificationReviewThreshold ?? 0.75,
  });
  let classification = classified.classification;
  let classificationReview = classified.review;
  let timeline = buildReferenceTimeline({
    classification,
    timingMode: input.timingMode,
    contentPolicy: input.contentPolicy,
  });
  let analysis = analyzeReferenceSubtitle({
    parsed,
    referenceLanguage: input.referenceLanguage,
    mediaDurationSeconds: input.mediaDurationSeconds,
    timingMode: input.timingMode,
    contentPolicy: input.contentPolicy,
    classifiedCueCount: classification.cues.length,
    suspectTimingCueCount: classification.cues.filter(
      (cue) => cue.timingTrust === "suspect",
    ).length,
    duplicateEffectCueCount: timeline.summary.mergedEffectCueCount,
    multiTrackIntervalCount: timeline.lyricsGroups.length,
  });
  const cachePath = path.join(
    path.dirname(input.subtitleDirectory),
    "reference-cache",
    `reference-${analysis.cacheKey}.json`,
  );
  if (await pathExists(cachePath)) {
    const cached = (await readJson(cachePath)) as Record<string, unknown>;
    classification = referenceCueClassificationArtifactSchema.parse({
      ...(cached.classification as Record<string, unknown>),
      configuration: {
        timingMode: input.timingMode,
      },
      fallback:
        (cached.classification as Record<string, unknown> | undefined)
          ?.fallback ?? null,
    });
    timeline = referenceTimelineArtifactSchema.parse({
      ...(cached.timeline as Record<string, unknown>),
      configuration: {
        timingMode: input.timingMode,
        contentPolicy: input.contentPolicy,
      },
      fallback:
        (cached.timeline as Record<string, unknown> | undefined)?.fallback ??
        null,
    });
    analysis = referenceSubtitleAnalysisArtifactSchema.parse({
      ...referenceSubtitleAnalysisArtifactSchema.parse(cached.analysis),
      cacheHit: true,
    });
    classificationReview = classifyReferenceCuesWithReview({
      parsed,
      referenceLanguage: input.referenceLanguage,
      mediaDurationSeconds: input.mediaDurationSeconds,
      timingMode: input.timingMode,
      reviewThreshold: input.classificationReviewThreshold ?? 0.75,
    }).review;
  } else {
    await atomicWriteJson(
      cachePath,
      { analysis, classification, timeline },
      { overwrite: false },
    );
  }
  await Promise.all([
    atomicWriteJson(
      path.join(input.subtitleDirectory, "reference-subtitle-analysis.json"),
      analysis,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(
        input.subtitleDirectory,
        "reference-classification-review.json",
      ),
      classificationReview,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "reference-cue-classification.json"),
      classification,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "reference-timeline.json"),
      timeline,
      { overwrite: input.overwrite },
    ),
  ]);
  return { parsed, classification, timeline, analysis, classificationReview };
}

export async function writeBlindGenerationProof(input: {
  guidanceMode: "reference-free" | "reference-assisted";
  referencePathKnownBeforeGeneration: boolean;
  cues: readonly SubtitleCue[];
  canonicalTranscriptPath: string;
  subtitleDirectory: string;
  overwrite: boolean;
}): Promise<BlindGenerationProofArtifact> {
  const proof = blindGenerationProofArtifactSchema.parse({
    schemaVersion: "1.0.0",
    guidanceMode: input.guidanceMode,
    referencePathKnownBeforeGeneration:
      input.referencePathKnownBeforeGeneration,
    referenceOpenedBeforeGeneration: false,
    referenceTimingUsedByAsr: false,
    referenceTextUsedByAsr: false,
    referenceTextUsedAsPrompt: false,
    generatedSubtitleSha256: sha256GeneratedCues(input.cues),
    canonicalTranscriptSha256: await sha256File(input.canonicalTranscriptPath),
    configuration: {
      isolationPhase: "blind-generation",
    },
    fallback: null,
    completedAt: new Date().toISOString(),
  });
  await atomicWriteJson(
    path.join(input.subtitleDirectory, "blind-generation-proof.json"),
    proof,
    { overwrite: input.overwrite },
  );
  return proof;
}

export async function writeReferenceTranscriptionPlan(input: {
  prepared: PreparedReferenceSubtitle;
  scenes?: Parameters<typeof buildReferenceTranscriptionPlan>[0]["scenes"];
  subtitleDirectory: string;
  overwrite: boolean;
}): Promise<ReferenceTranscriptionPlanArtifact> {
  const plan = buildReferenceTranscriptionPlan({
    timeline: input.prepared.timeline,
    ...(input.scenes === undefined ? {} : { scenes: input.scenes }),
  });
  await atomicWriteJson(
    path.join(input.subtitleDirectory, "reference-transcription-plan.json"),
    plan,
    { overwrite: input.overwrite },
  );
  return plan;
}

export async function writeReferenceEvaluationArtifacts(input: {
  prepared: PreparedReferenceSubtitle;
  generatedCues: readonly SubtitleCue[];
  guidanceMode: TranscriptionGuidanceMode;
  semanticMode: ReferenceSemanticValidationMode;
  repairMode: ReferenceRepairMode;
  subtitleDirectory: string;
  activeReviewIntervals: readonly Interval[];
  speechIntervals?: readonly Interval[] | undefined;
  quarantinedCandidates?: Parameters<
    typeof buildFalseQuarantineReport
  >[0]["quarantinedCandidates"];
  finalTextIntegrity?: FinalTextIntegrityArtifact | undefined;
  finalSubtitleIntegrity?: FinalSubtitleIntegrityArtifact | undefined;
  coverageRecoveryMode?: CoverageRecoveryMode | undefined;
  coverageRecoveryRounds?: number | undefined;
  coverageRecoveryMaxWindowSeconds?: number | undefined;
  referenceDialogueUnitMaxSeconds?: number | undefined;
  referenceNarrationUnitMaxSeconds?: number | undefined;
  referenceLyricsUnitMaxSeconds?: number | undefined;
  referenceDenseAnchorLimit?: number | undefined;
  overwrite: boolean;
}): Promise<{
  generatedSubtitleSha256: string;
  dialogueAnchorRecall: number | null;
  plan: ReferenceTranscriptionPlanArtifact | null;
}> {
  const generatedSubtitleSha256 = sha256GeneratedCues(input.generatedCues);
  const alignment = alignReferenceTimeline({
    timeline: input.prepared.timeline,
    generatedCues: input.generatedCues,
    generatedSubtitleSha256,
    ...(input.speechIntervals === undefined
      ? {}
      : { speechIntervals: input.speechIntervals }),
  });
  const coverage = evaluateReferenceCoverageIntegrity({
    timeline: input.prepared.timeline,
    alignment,
    generatedCues: input.generatedCues,
    generatedSubtitleSha256,
    activeReviewIntervals: input.activeReviewIntervals,
    promoteUncoveredToActiveReview: input.guidanceMode === "reference-guided",
  });
  const anchorTextCoverage = evaluateAnchorTextCoverage({
    timeline: input.prepared.timeline,
    alignment,
    generatedCues: input.generatedCues,
    generatedSubtitleSha256,
    activeReviewIntervals: input.activeReviewIntervals,
    ...(input.finalTextIntegrity === undefined
      ? {}
      : { finalTextIntegrity: input.finalTextIntegrity }),
  });
  const falseQuarantine = buildFalseQuarantineReport({
    timeline: input.prepared.timeline,
    generatedCues: input.generatedCues,
    generatedSubtitleSha256,
    ...(input.quarantinedCandidates === undefined
      ? {}
      : { quarantinedCandidates: input.quarantinedCandidates }),
  });
  const evaluation = evaluateSubtitleAgainstReference({
    timeline: input.prepared.timeline,
    alignment,
    generatedCues: input.generatedCues,
    generatedSubtitleSha256,
    guidanceMode: input.guidanceMode,
    falseQuarantineCount: falseQuarantine.summary["false-quarantine"],
    falseAcceptanceCount: falseQuarantine.summary["false-acceptance"],
  });
  const semantic = buildReferenceSemanticValidation({
    timeline: input.prepared.timeline,
    generatedSubtitleSha256,
    mode: input.semanticMode,
  });
  const plan =
    input.guidanceMode === "reference-guided" || input.repairMode !== "off"
      ? buildReferenceTranscriptionPlan({
          timeline: input.prepared.timeline,
          ...(input.referenceDialogueUnitMaxSeconds === undefined
            ? {}
            : {
                dialogueUnitMaxSeconds: input.referenceDialogueUnitMaxSeconds,
              }),
          ...(input.referenceNarrationUnitMaxSeconds === undefined
            ? {}
            : {
                narrationUnitMaxSeconds: input.referenceNarrationUnitMaxSeconds,
              }),
          ...(input.referenceLyricsUnitMaxSeconds === undefined
            ? {}
            : {
                lyricsUnitMaxSeconds: input.referenceLyricsUnitMaxSeconds,
              }),
          ...(input.referenceDenseAnchorLimit === undefined
            ? {}
            : { denseAnchorLimit: input.referenceDenseAnchorLimit }),
        })
      : null;
  const timingValidatedAnalysis = validateReferenceTimingAgainstAlignment({
    analysis: input.prepared.analysis,
    alignment,
  });
  const coverageRecoveryPlan = buildCoverageRecoveryPlan({
    timeline: input.prepared.timeline,
    coverage: anchorTextCoverage,
    finalCues: input.generatedCues,
    ...(input.finalTextIntegrity === undefined
      ? {}
      : { textIntegrity: input.finalTextIntegrity }),
    ...(input.finalSubtitleIntegrity === undefined
      ? {}
      : { subtitleIntegrity: input.finalSubtitleIntegrity }),
    mode: input.coverageRecoveryMode ?? "auto",
    maximumRounds: input.coverageRecoveryRounds ?? 2,
    maximumWindowSeconds: input.coverageRecoveryMaxWindowSeconds ?? 12,
  });
  const coverageRecoveryResults = coverageRecoveryResultsArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    planInputHash: coverageRecoveryPlan.inputHash,
    roundsCompleted: 0,
    results: coverageRecoveryPlan.units.map((unit) => ({
      unitId: unit.id,
      requestIds: [],
      cacheHitCount: 0,
      candidateCueIds: [],
      acceptedCueIds: [],
      decision: unit.shouldRunAsr ? "not-run" : "review-only",
      reasons: [
        unit.shouldRunAsr
          ? "planned-for-coverage-recovery-executor"
          : "planner-marked-review-only",
      ],
    })),
    summary: {
      requestCount: 0,
      cacheHitCount: 0,
      acceptedCandidateCount: 0,
      rejectedCandidateCount: 0,
      rejectedHallucinationCount: 0,
      rejectedNoAudibleSpeechCount: 0,
      workerStartCount: 0,
      modelLoadCount: 0,
      fallbackProcessCount: 0,
    },
    stopReason:
      coverageRecoveryPlan.configuration.mode === "off"
        ? "disabled"
        : coverageRecoveryPlan.units.length === 0
          ? "no-recovery-units"
          : "pending-execution",
  });
  await Promise.all([
    atomicWriteJson(
      path.join(input.subtitleDirectory, "reference-subtitle-analysis.json"),
      timingValidatedAnalysis,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "reference-cue-alignment.json"),
      alignment,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "reference-semantic-validation.json"),
      semantic,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "reference-coverage-integrity.json"),
      coverage,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "anchor-text-coverage.json"),
      anchorTextCoverage,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "coverage-recovery-plan.json"),
      coverageRecoveryPlan,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "coverage-recovery-results.json"),
      coverageRecoveryResults,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "subtitle-evaluation.json"),
      evaluation,
      { overwrite: input.overwrite },
    ),
    atomicWriteFile(
      path.join(input.subtitleDirectory, "subtitle-evaluation.md"),
      formatSubtitleEvaluationMarkdown(evaluation),
      { overwrite: input.overwrite },
    ),
    atomicWriteFile(
      path.join(input.subtitleDirectory, "subtitle-diff.ass"),
      formatSubtitleDiffAss({
        timeline: input.prepared.timeline,
        alignment,
        generatedCues: input.generatedCues,
      }),
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "false-quarantine-report.json"),
      falseQuarantine,
      { overwrite: input.overwrite },
    ),
    ...(plan === null
      ? []
      : [
          atomicWriteJson(
            path.join(
              input.subtitleDirectory,
              "reference-transcription-plan.json",
            ),
            plan,
            { overwrite: input.overwrite },
          ),
        ]),
  ]);
  return {
    generatedSubtitleSha256,
    dialogueAnchorRecall: evaluation.metrics.dialogueAnchorRecall,
    plan,
  };
}
