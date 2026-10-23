import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evidenceDpResultSchema,
  overlapAcousticAttemptSchema,
  overlapAcousticComponentSchema,
  overlapCueAlignmentSchema,
  subtitleCanonicalPronunciationSchema,
  subtitleFinalizationReportSchema,
  subtitlePackageSchema,
  subtitleReviewPackageSchema,
  timestampRuntimeCapabilitySchema,
  type SourceFingerprint,
  type SubtitleCue,
} from "@mvl/shared";
import {
  DEFAULT_FINALIZATION_THRESHOLDS,
  auditTimestampEvidenceAttempt,
  buildCanonicalAlignmentCue,
  buildForcedAlignmentCueDecision,
  buildSubtitleCanonicalForcedAlignment,
  buildSubtitleOverlapAcousticResolution,
  buildSubtitlePresentationResolution,
  buildTimestampEvidenceIntegrityArtifact,
  jointlyAssignForcedAlignmentComponent,
} from "@mvl/transcription-core";
import { canonicalTimingHash, sha256Value } from "@mvl/video-subtitler";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";
const HASH = sha256Value("synthetic-only; no model, media, or private fixture");
const BLOCKER = "SYNTHETIC_UNRESOLVED_OVERLAP";

/** Deterministic PCM, deliberately not speech or a recording of any person. */
function syntheticWav(seed: number): Buffer {
  const frames = 24_000;
  const out = Buffer.alloc(44 + frames * 2);
  out.write("RIFF");
  out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16_000, 24);
  out.writeUInt32LE(32_000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    out.writeInt16LE(((i * (seed + 1)) % 511) - 255, 44 + i * 2);
  return out;
}

/** Byte inventory used to prove the entire source task stays immutable. */
export async function syntheticTaskSnapshot(root: string) {
  const entries: [string, string][] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile())
        entries.push([
          path.relative(root, file),
          createHash("sha256")
            .update(await readFile(file))
            .digest("hex"),
        ]);
      else throw new Error(`Unexpected synthetic fixture entry: ${entry.name}`);
    }
  }
  await visit(root);
  return Object.fromEntries(entries.toSorted(([a], [b]) => a.localeCompare(b)));
}

/**
 * A complete, schema-checked saved task with seven legacy delivery defects.
 * Evidence is manufactured test data, never a claim of real ASR/alignment.
 * Pure production builders populate contracts; no worker/process is started.
 * The first fourteen supplied cues form the seven review pairs; any remaining
 * cues are canonical context, not extra pronunciation/alignment targets.
 */
export async function createSyntheticReviewDeliveryTask(
  root: string,
  options: {
    cues?: readonly SubtitleCue[];
    sourceFingerprint?: SourceFingerprint;
  } = {},
) {
  const task = path.join(root, "synthetic-source-task");
  const directory = path.join(task, "subtitle-synthetic");
  await mkdir(path.join(directory, "audio", "review"), { recursive: true });
  async function json(name: string, value: unknown): Promise<void> {
    await writeFile(
      path.join(directory, name),
      `${JSON.stringify(value, null, 2)}\n`,
    );
  }
  const groups = Array.from({ length: 7 }, (_, index) => {
    const start = 2 + index * 4;
    const componentId = `synthetic-component-${index + 1}`;
    const cues: SubtitleCue[] = [0, 1].map(
      (part) =>
        options.cues?.[index * 2 + part] ?? {
          id: `synthetic-cue-${index + 1}-${part + 1}`,
          start: start + part * 0.4,
          end: start + 0.6 + part * 0.4,
          text: part === 0 ? "テスト" : "サンプル",
          language: "ja",
          languages: ["ja"],
          speaker: null,
          confidence: null,
        },
    );
    return {
      componentId,
      reviewId: `synthetic-review-${index + 1}`,
      attemptId: `synthetic-attempt-${index + 1}`,
      start,
      cues,
      wav: syntheticWav(index),
    };
  });
  const cues =
    options.cues === undefined
      ? groups.flatMap((group) => group.cues)
      : [...options.cues];
  const baseCueHash = sha256Value(cues);
  const sourceFingerprint = options.sourceFingerprint ?? {
    fileName: "synthetic-not-recorded.wav",
    size: 0,
    durationSeconds: 30,
    sha256: HASH,
  };
  const subtitlePackage = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: sourceFingerprint.fileName,
      container: "wav",
      durationSeconds: 30,
    },
    identity: {
      title: "Synthetic review delivery",
      season: null,
      episode: null,
      year: null,
    },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      srt: "synthetic.srt",
      vtt: "synthetic.vtt",
      ass: "synthetic.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues,
    warnings: ["SYNTHETIC_TEST_DATA_NOT_REAL_MODEL_EVIDENCE"],
  });
  const presentation = buildSubtitlePresentationResolution({
    cues,
    baseCueHash,
    presentationResolution: "observe",
    overlapResolution: "conservative",
    generatedAt: GENERATED_AT,
  }).artifact;
  const canonicalGroups = groups.map((group) => {
    const canonicalCues = group.cues.map((cue) =>
      buildCanonicalAlignmentCue({ cue, componentId: group.componentId }),
    );
    const decisions = canonicalCues.map((cue) =>
      buildForcedAlignmentCueDecision({
        cue,
        narrow: null,
        expanded: null,
        evidenceDp: evidenceDpResultSchema.parse({
          cueId: cue.cueId,
          matchedCanonicalUnits: [],
          unmatchedCanonicalUnits: cue.wordUnits.map((unit) => unit.unitId),
          matchedEvidenceUnits: [`synthetic-dp-${cue.cueId}`],
          unusedEvidenceUnits: [],
          pathScore: 0.5,
          lexicalScore: 0,
          readingScore: 0,
          temporalScore: 0.5,
          coverageRatio: 0,
          startBoundary: cue.originalInterval.start,
          endBoundary: cue.originalInterval.end,
          boundaryEvidenceIds: [`synthetic-dp-${cue.cueId}`],
          blockers: [BLOCKER],
          fabricatedBoundaryCount: 0,
        }),
        mappedTokenIntervals: [],
        rawVadIntervals: [],
        decodedSegmentIntervals: [],
      }),
    );
    return {
      ...group,
      canonicalCues,
      decisions,
      component: jointlyAssignForcedAlignmentComponent({
        componentId: group.componentId,
        componentInterval: { start: group.start, end: group.start + 1 },
        canonicalCues,
        cueAlignments: decisions,
        attempts: [],
        mode: "observe",
      }),
    };
  });
  const forcedAlignment = buildSubtitleCanonicalForcedAlignment({
    generatedAt: GENERATED_AT,
    sourceFingerprint,
    baseCueHash,
    baseTimingHash: canonicalTimingHash(cues),
    baseOverlapArtifactHash: HASH,
    runtimeCapabilityRef: null,
    canonicalInputRef: "synthetic-canonical-input.json",
    attempts: [],
    cueAlignments: canonicalGroups.flatMap((group) => group.decisions),
    components: canonicalGroups.map((group) => group.component),
    appliedMutations: [],
    eligibleCueCount: 0,
    ineligibleCueCount: cues.length,
    mfaProcessCount: 0,
  });
  const audits = groups.map((group) =>
    auditTimestampEvidenceAttempt({
      attemptId: group.attemptId,
      profile: "no-vad",
      useVad: false,
      extractionInterval: {
        start: group.start - 0.25,
        end: group.start + 1.25,
      },
      segments: group.cues.map((cue) => ({
        segmentId: `synthetic-segment-${cue.id}`,
        text: cue.text,
        rawStart: cue.start - group.start + 0.25,
        rawEnd: cue.end - group.start + 0.25,
        confidence: 1,
        tokens: [
          {
            tokenId: `synthetic-token-${cue.id}`,
            text: cue.text,
            rawStart: cue.start - group.start + 0.27,
            rawEnd: cue.end - group.start + 0.23,
            rawCoordinateSystem: "original-audio-local",
            probability: 1,
          },
        ],
      })),
      tokenTimestampsRequested: true,
      tokenTimestampPolicy: "auto",
      mappedTokenGetterActuallyUsed: false,
    }),
  );
  const attempts = groups.map((group, index) => {
    const audit = audits[index];
    if (audit === undefined) throw new Error("Missing synthetic audit");
    return overlapAcousticAttemptSchema.parse({
      attemptId: group.attemptId,
      componentId: group.componentId,
      profile: "no-vad",
      requestId: `synthetic-request-${index + 1}`,
      requestType: "overlap-evidence",
      useVad: false,
      vadProfile: "synthetic-none",
      model: "synthetic-not-a-model",
      modelHash: HASH,
      modelFamily: "synthetic",
      coreML: false,
      whisperCppVersion: "synthetic-no-runtime",
      cacheHit: true,
      promptSha256: sha256Value(""),
      targetCueTextUsedAsPrompt: false,
      referenceTranslationUsedAsPrompt: false,
      humanReviewedSentenceUsedAsPrompt: false,
      rawText: group.cues.map((cue) => cue.text).join(" "),
      segments: audit.segments,
      tokens: audit.tokens,
      speechIntervals: [],
      decodedSegmentIntervals: audit.decodedSegmentIntervals,
      mappedTrustedTokenIntervals: audit.mappedTrustedTokenIntervals,
      rawVadIntervals: [],
      metrics: {
        durationSeconds: 1.5,
        segmentCount: 2,
        tokenCount: 2,
        speechIntervalCount: 0,
        tokenTimestampsRequested: true,
        tokenTimestampsUsed: true,
      },
      language: "ja",
      failure: null,
    });
  });
  const components = groups.map((group) =>
    overlapAcousticComponentSchema.parse({
      componentId: group.componentId,
      sourceOverlapDecisionId: presentation.overlapDecisions.find((decision) =>
        group.cues.every((cue) => decision.cueIds.includes(cue.id)),
      )?.decisionId,
      cueIds: group.cues.map((cue) => cue.id),
      unionInterval: { start: group.start, end: group.start + 1 },
      extractionInterval: {
        start: group.start - 0.25,
        end: group.start + 1.25,
      },
      audioPath: null,
      audioSha256: createHash("sha256").update(group.wav).digest("hex"),
      audioDurationSeconds: 1.5,
      audioFullyCoversComponent: true,
      profileAttemptIds: [group.attemptId],
      cueAlignments: group.cues.map((cue) =>
        overlapCueAlignmentSchema.parse({
          cueId: cue.id,
          canonicalText: cue.text,
          normalizedSurface: cue.text,
          normalizedReading: null,
          readingAvailable: false,
          surfaceAlignmentScore: 1,
          readingAlignmentScore: null,
          tokenCoverageScore: 1,
          temporalCoverageRatio: 1,
          localSpeechCoverageRatio: 0,
          neighborIntrusionRatio: 0,
          profileConsensusScore: 1,
          boundarySupportScore: 1,
          boundaryConfidence: 1,
          independentProfileSupportCount: 1,
          independentModelSupportCount: 0,
          matchedAttemptIds: [group.attemptId],
          matchedSegmentIds: [`synthetic-segment-${cue.id}`],
          matchedTokenIds: [`synthetic-token-${cue.id}`],
          matchedIntervals: [
            {
              attemptId: group.attemptId,
              source: "trusted-mapped-token",
              start: cue.start + 0.02,
              end: cue.end - 0.02,
              evidenceId: `synthetic-token-${cue.id}`,
              evidenceLineageId: `synthetic-lineage-${cue.id}`,
              timingUsable: true,
              parentSegmentContainmentPassed: true,
              timestampTrustStatus: "trusted-original-timeline",
              timingTrustScore: 1,
              alignmentScore: 1,
              profileConsensusScore: 1,
              boundaryConfidence: 1,
              neighborIntrusionRatio: 0,
              sourceTypeSupportCount: 1,
            },
          ],
          alignmentMethod: "surface-token-sequence",
          alignmentConfidence: 1,
          blockers: [BLOCKER],
          evidence: ["Deterministic synthetic fixture; never real inference."],
        }),
      ),
      pairAssessments: [],
      counterfactuals: [],
      finalRelationship: "unresolved",
      classificationConfidence: 0,
      recommendedAction: "review",
      safeAutomaticAction: "none",
      timingMutations: [],
      assEventOverrides: [],
      vttCueSettings: [],
      blocking: true,
      reasons: [BLOCKER],
    }),
  );
  const overlap = buildSubtitleOverlapAcousticResolution({
    generatedAt: GENERATED_AT,
    sourceFingerprint,
    baseCueHash,
    basePresentationResolutionHash: sha256Value(presentation),
    mode: "observe",
    audioStreamIndex: 0,
    attempts,
    components,
  });
  const timestamp = buildTimestampEvidenceIntegrityArtifact({
    generatedAt: GENERATED_AT,
    sourceOverlapArtifactHash: sha256Value(overlap),
    runtimeCapability: timestampRuntimeCapabilitySchema.parse({
      whisperCppVersion: "synthetic-no-runtime",
      runtimeBinaryPathRecordedAsBasenameOnly: "not-executable",
      runtimeBinarySha256: HASH,
      runtimeSourceCommit: null,
      serverResponseFormat: "synthetic",
      mappedTokenGetterAvailable: false,
      mappedTokenGetterActuallyUsed: false,
      rawVadGetterAvailable: false,
      rawVadGetterActuallyUsed: false,
      tokenTimestampControlAvailable: false,
      timestampCapabilityProbeMethod: "synthetic",
      timestampCapabilityStatus: "unverified",
      runtimeTimestampCapabilityHash: HASH,
      evidence: ["Synthetic; no provider started."],
    }),
    mode: "observe",
    tokenTimestampPolicy: "auto",
    legacyOverlapCachePolicy: "reject",
    attempts: audits.map((audit) => audit.integrity),
  });
  const pronunciation = subtitleCanonicalPronunciationSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "subtitle-canonical-pronunciation",
    pronunciationVersion: "C5.17.1",
    generatedAt: GENERATED_AT,
    baseCueHash,
    canonicalAlignmentInputHash: HASH,
    sudachiRuntimeIdentityHash: HASH,
    mfaRuntimeIdentityHash: HASH,
    g2pModelIdentityHash: HASH,
    g2pCommand: "g2p",
    pronunciationPolicyVersion: "c5.17.1-canonical-pronunciation-v1",
    canonicalTextMutationCount: 0,
    cues: canonicalGroups.flatMap((group) =>
      group.canonicalCues.map((cue) => ({
        cueId: cue.cueId,
        componentId: group.componentId,
        canonicalText: cue.canonicalText,
        canonicalTextSha256: cue.canonicalTextSha256,
        alignmentText: cue.alignmentText,
        alignmentTextSha256: cue.alignmentTextSha256,
        morphemeCount: 0,
        wordUnits: [],
        readingUnits: [],
        pronunciationUnits: [],
        expectedPhones: [],
        readingCoverageBeforeG2p: 0,
        readingCoverageAfterG2p: 0,
        pronunciationCoverageRatio: 0,
        criticalOovBefore: 0,
        criticalOovAfter: 0,
        pronunciationEligibility: false,
        blockers: [BLOCKER],
      })),
    ),
    summary: {
      cueCount: canonicalGroups.reduce(
        (count, group) => count + group.canonicalCues.length,
        0,
      ),
      unitCount: 0,
      sudachiResolvedCount: 0,
      dictionaryResolvedCount: 0,
      g2pResolvedCount: 0,
      kanaLiteralCount: 0,
      unresolvedCount: 0,
      criticalOovBefore: 0,
      criticalOovAfter: 0,
      g2pProcessCount: 0,
      g2pCacheHitCount: 0,
      canonicalTextMutationCount: 0,
    },
  });
  const review = subtitleReviewPackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-review-package",
    reviewVersion: "synthetic-legacy",
    generatedAt: GENERATED_AT,
    sourceFingerprint,
    baseSubtitlePackagePath: "subtitle-package.json",
    baseSubtitlePackageHash: sha256Value(subtitlePackage),
    baseCueHash,
    inputEvidenceHash: HASH,
    items: canonicalGroups.map((group) => ({
      reviewId: group.reviewId,
      targetCueIds: group.cues.map((cue) => cue.id),
      interval: { start: group.start, end: group.start + 1 },
      currentText: group.cues.map((cue) => cue.text).join("\n"),
      currentStart: group.start,
      currentEnd: group.start + 1,
      currentStyle: "default",
      currentSpeaker: null,
      previousCue: null,
      nextCue: null,
      machineDecision: {
        decisionId: `synthetic-decision-${group.componentId}`,
        targetCueIds: group.cues.map((cue) => cue.id),
        action: "REVIEW_ONLY",
        currentText: group.cues.map((cue) => cue.text).join("\n"),
        proposedText: null,
        proposedCues: [],
        selectedCandidateId: null,
        alternativeCandidateIds: [],
        evidenceIds: [],
        blockers: [BLOCKER],
        automaticMutationEligible: false,
        requiresHumanReview: true,
        decisionReasons: [BLOCKER],
      },
      candidateSuggestions: [],
      findingIds: [],
      blockers: [BLOCKER],
      allowedHumanActions: ["KEEP", "MARK_UNRESOLVED"],
      audioClipPath: null,
      audioError: "SYNTHETIC_LEGACY_AUDIO_METADATA_MISSING",
      requiresHumanReview: true,
      forcedAlignmentEvidence: {
        disclaimer:
          "MFA boundaries are machine evidence, not confirmed ground truth.",
        componentId: group.componentId,
        cues: group.cues.map((cue) => ({
          cueId: cue.id,
          canonicalText: cue.text,
          alignmentText: cue.text,
          normalizedReading: null,
          unresolvedOov: [],
          originalTiming: { start: cue.start, end: cue.end },
          suggestedTiming: null,
          mfaNarrowBoundary: null,
          mfaExpandedBoundary: null,
          // Deliberate historical bug: copied DP must be replaced from independent mapped evidence.
          evidenceDpBoundary: { start: cue.start, end: cue.end },
          mappedTokenBoundary: { start: cue.start, end: cue.end },
          rawVadBoundary: null,
          windowStabilityScore: 0,
          wordCoverageRatio: 0,
          phoneCoverageRatio: 0,
          readingCoverageRatio: 0,
          antiForcingBlockers: [BLOCKER],
        })),
        bestHypothesis: "unresolved",
        runnerUpHypothesis: "partial-alignment",
        decisionMargin: 0,
        duplicateOccurrenceConflictCount: 0,
        blocking: true,
      },
    })),
    summary: {
      itemCount: 7,
      mandatoryItemCount: 7,
      audioClipCount: 0,
      audioFailureCount: 7,
      audioCoverageFailureCount: 7,
    },
  });
  const report = subtitleFinalizationReportSchema.parse({
    schemaVersion: "1.0.0",
    reportType: "subtitle-finalization-report",
    finalizationVersion: "synthetic-legacy",
    generatedAt: GENERATED_AT,
    mode: "review-fallback",
    status: "needs-review",
    finalizationMethod: "none",
    baseSubtitlePackageHash: sha256Value(subtitlePackage),
    baseCueHash,
    inputEvidenceHash: HASH,
    outputCueHash: baseCueHash,
    outputHash: sha256Value(subtitlePackage),
    thresholds: DEFAULT_FINALIZATION_THRESHOLDS,
    decisions: review.items.map((item) => item.machineDecision),
    findings: [],
    metrics: {
      machineCueCount: cues.length,
      automaticDecisionCount: 0,
      safeAutomaticMutationCount: 0,
      suggestionOnlyCount: 0,
      blockingFindingCount: 0,
      unresolvedCount: 7,
      reviewItemCount: 7,
      humanDecisionCount: 0,
      finalCueCount: cues.length,
      unsafeMutationCount: 0,
      multiDecisionConflictCount: 0,
      substringReplacementViolationCount: 0,
      broadWindowVisibleMutationCount: 0,
      ambiguousVisibleMutationCount: 0,
      localIntervalMissingVisibleMutationCount: 0,
      fullCueFragmentReplacementCount: 0,
      formatParityErrorCount: 0,
      automaticCueRate: 0,
      manualReviewCueRate: 1,
      blockingCueRate: 1,
      characterCorrectionRate: 0,
      timingCorrectionRate: 0,
      terminologyCorrectionRate: 0,
      dialectCorrectionRate: 0,
      hallucinationRejectionCount: 0,
    },
    qualityGate: {
      passed: false,
      finalIntegrityPassed: false,
      serializationRoundTripPassed: true,
      formatSemanticParityPassed: true,
      rollbackApplied: false,
      sourceReadOnlyVerified: true,
      blockingCodes: [BLOCKER],
      warningCodes: [],
    },
    outputPaths: {
      srt: "synthetic.srt",
      ass: "synthetic.ass",
      vtt: "synthetic.vtt",
      subtitlePackage: "subtitle-package.needs-review.json",
      reviewPackage: "subtitle-review-package.json",
      reviewPage: "review/index.html",
      correctionFeedback: null,
      subtitledVideo: null,
    },
  });
  await Promise.all([
    json("subtitle-package.json", subtitlePackage),
    json("subtitle-package.needs-review.json", subtitlePackage),
    json("subtitle-canonical-forced-alignment.json", forcedAlignment),
    json("subtitle-overlap-acoustic-resolution.json", overlap),
    json("subtitle-timestamp-evidence-integrity.json", timestamp),
    json("subtitle-presentation-resolution.json", presentation),
    json("subtitle-canonical-pronunciation.json", pronunciation),
    json("subtitle-review-package.json", review),
    json("subtitle-finalization-report.json", report),
    ...groups.map((group) =>
      writeFile(
        path.join(directory, "audio", "review", `${group.reviewId}.wav`),
        group.wav,
      ),
    ),
  ]);
  return task;
}
