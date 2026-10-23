import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  atomicWriteJson,
  subtitleCanonicalForcedAlignmentSchema,
  subtitleCanonicalPronunciationSchema,
  subtitleFinalizationReportSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleReviewDeliveryIntegritySchema,
  subtitleReviewPackageSchema,
  subtitleTimestampEvidenceIntegritySchema,
  type ReviewAudioMode,
  type ReviewBoundaryEvidence,
  type ReviewDeliveryIntegrityMode,
  type ReviewEvidenceReconciliationMode,
  type SubtitleFinalizationReport,
  type SubtitleReviewDeliveryIntegrity,
  type SubtitleReviewPackage,
} from "@mvl/shared";

import { locateSubtitlePackage, sha256Value } from "./finalization-support.js";
import { inspectReviewWav, resolveReviewAudio } from "./review-audio.js";
import {
  reconcileReviewEvidence,
  type ReconciledReviewEvidence,
} from "./review-evidence.js";
import { writeSubtitleReviewPage } from "./review.js";
import {
  REVIEW_ACTION_POLICY_HASH,
  REVIEW_ACTION_POLICY_VERSION,
  bindReviewCandidates,
  candidateBindingDescriptors,
} from "./review-action-validation.js";

export const REVIEW_DELIVERY_POLICY_VERSION =
  "c5.17.2-review-delivery-integrity-v1" as const;

async function fileHash(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function relativePathInside(root: string, value: string): boolean {
  const relative = path.relative(root, value);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function intervalEqual(
  left: { start: number; end: number } | null | undefined,
  right: { start: number; end: number } | null | undefined,
): boolean {
  if (left == null || right == null) return left == null && right == null;
  return (
    Math.abs(left.start - right.start) <= 0.000_001 &&
    Math.abs(left.end - right.end) <= 0.000_001
  );
}

function collectArtifactObjectIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (current: unknown, key: string | null): void => {
    if (typeof current === "string") {
      if (key !== null && /(?:Id|Ids)$/u.test(key)) ids.add(current);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, key));
      return;
    }
    if (current !== null && typeof current === "object") {
      Object.entries(current).forEach(([entryKey, entryValue]) =>
        visit(entryValue, entryKey),
      );
    }
  };
  visit(value, null);
  return ids;
}

function semanticDeliveryHash(
  value: Omit<SubtitleReviewDeliveryIntegrity, "semanticHash">,
): string {
  return sha256Value({
    ...value,
    generatedAt: null,
    // These are byte hashes of JSON files that contain generatedAt. Keep the
    // real hashes in the artifact for delivery provenance, but exclude them
    // from the cross-run semantic identity.
    reviewPackageHash: null,
    finalizationReportHash: null,
  });
}

function reviewSummary(
  items: SubtitleReviewPackage["items"],
): SubtitleReviewPackage["summary"] {
  const unique = (sourceType: string) =>
    new Set(
      items.flatMap((item) =>
        [
          ...item.boundaryEvidence,
          ...item.componentRawVadIntervals,
          ...item.componentDecodedSegments,
          ...item.componentMappedTokenEvidence,
          ...item.componentPauseEvidence,
        ]
          .filter((value) => value.sourceType === sourceType)
          .map((value) => value.evidenceLineageId),
      ),
    ).size;
  const copiedCount = items.reduce((sum, item) => {
    const mappedByCue = new Map(
      item.boundaryEvidence
        .filter((value) =>
          ["trusted-mapped-token", "trusted-no-vad-token"].includes(
            value.sourceType,
          ),
        )
        .map((value) => [value.cueIds[0] ?? "", value]),
    );
    return (
      sum +
      (item.forcedAlignmentEvidence?.cues.filter((cue) => {
        if (
          cue.mappedTokenBoundary === null ||
          cue.evidenceDpBoundary === null ||
          !intervalEqual(cue.mappedTokenBoundary, cue.evidenceDpBoundary)
        ) {
          return false;
        }
        const mapped = mappedByCue.get(cue.cueId);
        return mapped === undefined || mapped.sourceType === "evidence-dp";
      }).length ?? 0)
    );
  }, 0);
  return {
    itemCount: items.length,
    mandatoryItemCount: items.filter((item) => item.requiresHumanReview).length,
    audioClipCount: items.filter((item) => item.audioClipPath !== null).length,
    audioFailureCount: items.filter((item) => item.audioError !== null).length,
    audioCoverageFailureCount: items.filter(
      (item) => !item.audioFullyCoversComponent,
    ).length,
    audioPhysicalFileCount: items.filter(
      (item) => item.audioValidationStatus === "validated",
    ).length,
    audioReferencedCount: items.filter((item) => item.audioClipPath !== null)
      .length,
    audioPlayableCount: items.filter(
      (item) =>
        item.audioClipPath !== null &&
        item.audioValidationStatus === "validated" &&
        item.audioFullyCoversComponent,
    ).length,
    audioReusedExistingCount: items.filter((item) =>
      [
        "reused-existing-review-audio",
        "inherited-verified-review-audio",
      ].includes(item.audioSource),
    ).length,
    audioReusedOverlapCount: items.filter(
      (item) => item.audioSource === "reused-overlap-audio",
    ).length,
    audioGeneratedCount: items.filter(
      (item) => item.audioSource === "generated-from-source-video",
    ).length,
    audioHashMismatchCount: items.filter(
      (item) => item.audioValidationStatus === "hash-mismatch",
    ).length,
    audioMetadataFailureCount: items.filter(
      (item) => item.audioValidationStatus === "invalid-wav",
    ).length,
    mappedTokenEvidenceCount:
      unique("trusted-mapped-token") + unique("trusted-no-vad-token"),
    rawVadEvidenceCount: unique("raw-vad"),
    decodedSegmentEvidenceCount: unique("decoded-segment"),
    mappedTokenBoundaryCopiedFromEvidenceDpCount: copiedCount,
    unresolvedEvidenceReferenceCount: new Set(
      items.flatMap((item) => item.unresolvedEvidenceReferences),
    ).size,
  };
}

export interface LoadedReviewDeliveryArtifacts {
  reviewPackage: SubtitleReviewPackage;
  finalizationReport: SubtitleFinalizationReport;
  subtitlePackage: ReturnType<typeof subtitlePackageSchema.parse>;
  forcedAlignment: ReturnType<
    typeof subtitleCanonicalForcedAlignmentSchema.parse
  >;
  overlapAcoustic: ReturnType<
    typeof subtitleOverlapAcousticResolutionSchema.parse
  >;
  timestampIntegrity: ReturnType<
    typeof subtitleTimestampEvidenceIntegritySchema.parse
  >;
  presentation: ReturnType<typeof subtitlePresentationResolutionSchema.parse>;
  pronunciation: ReturnType<typeof subtitleCanonicalPronunciationSchema.parse>;
  paths: {
    reviewPackage: string;
    finalizationReport: string;
    subtitlePackage: string;
    forcedAlignment: string;
    overlapAcoustic: string;
    timestampIntegrity: string;
    presentation: string;
    pronunciation: string;
  };
  hashes: {
    reviewPackage: string;
    finalizationReport: string;
    forcedAlignment: string;
    overlapAcoustic: string;
    timestampIntegrity: string;
    presentation: string;
    pronunciation: string;
  };
}

export async function loadReviewDeliveryArtifacts(
  subtitleDirectory: string,
): Promise<LoadedReviewDeliveryArtifacts> {
  const paths = {
    reviewPackage: path.join(subtitleDirectory, "subtitle-review-package.json"),
    finalizationReport: path.join(
      subtitleDirectory,
      "subtitle-finalization-report.json",
    ),
    subtitlePackage: path.join(
      subtitleDirectory,
      "subtitle-package.needs-review.json",
    ),
    forcedAlignment: path.join(
      subtitleDirectory,
      "subtitle-canonical-forced-alignment.json",
    ),
    overlapAcoustic: path.join(
      subtitleDirectory,
      "subtitle-overlap-acoustic-resolution.json",
    ),
    timestampIntegrity: path.join(
      subtitleDirectory,
      "subtitle-timestamp-evidence-integrity.json",
    ),
    presentation: path.join(
      subtitleDirectory,
      "subtitle-presentation-resolution.json",
    ),
    pronunciation: path.join(
      subtitleDirectory,
      "subtitle-canonical-pronunciation.json",
    ),
  };
  const parsed = await Promise.all(
    Object.values(paths).map(
      async (filePath) =>
        JSON.parse(await readFile(filePath, "utf8")) as unknown,
    ),
  );
  const [
    reviewPackage,
    finalizationReport,
    subtitlePackage,
    forcedAlignment,
    overlapAcoustic,
    timestampIntegrity,
    presentation,
    pronunciation,
  ] = parsed;
  return {
    reviewPackage: subtitleReviewPackageSchema.parse(reviewPackage),
    finalizationReport:
      subtitleFinalizationReportSchema.parse(finalizationReport),
    subtitlePackage: subtitlePackageSchema.parse(subtitlePackage),
    forcedAlignment:
      subtitleCanonicalForcedAlignmentSchema.parse(forcedAlignment),
    overlapAcoustic:
      subtitleOverlapAcousticResolutionSchema.parse(overlapAcoustic),
    timestampIntegrity:
      subtitleTimestampEvidenceIntegritySchema.parse(timestampIntegrity),
    presentation: subtitlePresentationResolutionSchema.parse(presentation),
    pronunciation: subtitleCanonicalPronunciationSchema.parse(pronunciation),
    paths,
    hashes: {
      reviewPackage: await fileHash(paths.reviewPackage),
      finalizationReport: await fileHash(paths.finalizationReport),
      forcedAlignment: await fileHash(paths.forcedAlignment),
      overlapAcoustic: await fileHash(paths.overlapAcoustic),
      timestampIntegrity: await fileHash(paths.timestampIntegrity),
      presentation: await fileHash(paths.presentation),
      pronunciation: await fileHash(paths.pronunciation),
    },
  };
}

export async function repairReviewPackageDelivery(input: {
  sourceTaskDirectory: string;
  targetTaskDirectory: string;
  audioMode: ReviewAudioMode;
  evidenceMode: ReviewEvidenceReconciliationMode;
  sourceVideoPath?: string | null;
  contextSeconds?: number;
  maximumSeconds?: number;
  reviewPageTimeline?: boolean;
}): Promise<{
  sourceSubtitleDirectory: string;
  targetSubtitleDirectory: string;
  source: LoadedReviewDeliveryArtifacts;
  target: LoadedReviewDeliveryArtifacts;
  reviewPackage: SubtitleReviewPackage;
  finalizationReport: SubtitleFinalizationReport;
}> {
  const sourceLocated = await locateSubtitlePackage(input.sourceTaskDirectory);
  const targetLocated = await locateSubtitlePackage(input.targetTaskDirectory);
  const source = await loadReviewDeliveryArtifacts(
    sourceLocated.subtitleDirectory,
  );
  const targetBefore = await loadReviewDeliveryArtifacts(
    targetLocated.subtitleDirectory,
  );
  const cueIntervalById = new Map(
    targetBefore.subtitlePackage.cues.map((cue) => [
      cue.id,
      { start: cue.start, end: cue.end },
    ]),
  );
  const items: SubtitleReviewPackage["items"] = [];
  const reconciliationHashes: string[] = [];
  const reconciliationItems: {
    reviewId: string;
    componentId: string;
    reconciliationHash: string;
    resolutionStatus: ReconciledReviewEvidence["resolutionStatus"];
    unresolvedEvidenceReferences: string[];
    boundaryEvidence: ReviewBoundaryEvidence[];
    componentRawVadIntervals: ReviewBoundaryEvidence[];
    componentDecodedSegments: ReviewBoundaryEvidence[];
    componentMappedTokenEvidence: ReviewBoundaryEvidence[];
    componentPauseEvidence: ReviewBoundaryEvidence[];
  }[] = [];
  for (const oldItem of source.reviewPackage.items) {
    const componentId =
      oldItem.forcedAlignmentEvidence?.componentId ??
      source.overlapAcoustic.components.find((component) =>
        component.cueIds.some((cueId) => oldItem.targetCueIds.includes(cueId)),
      )?.componentId;
    if (componentId === undefined) {
      throw new InputError(
        `Review item ${oldItem.reviewId} has no resolvable component.`,
      );
    }
    const reconciled = reconcileReviewEvidence({
      componentId,
      cueIds: oldItem.targetCueIds,
      sourceCueIntervals: cueIntervalById,
      forcedAlignment: source.forcedAlignment,
      overlapAcoustic: source.overlapAcoustic,
      timestampIntegrity: source.timestampIntegrity,
      presentation: source.presentation,
      pronunciation: source.pronunciation,
      artifactHashes: {
        canonicalForcedAlignment: source.hashes.forcedAlignment,
        overlapAcousticResolution: source.hashes.overlapAcoustic,
        timestampEvidenceIntegrity: source.hashes.timestampIntegrity,
        presentationResolution: source.hashes.presentation,
        canonicalPronunciation: source.hashes.pronunciation,
      },
    });
    reconciliationHashes.push(reconciled.reconciliationHash);
    reconciliationItems.push({
      reviewId: oldItem.reviewId,
      componentId,
      reconciliationHash: reconciled.reconciliationHash,
      resolutionStatus: reconciled.resolutionStatus,
      unresolvedEvidenceReferences: reconciled.unresolvedEvidenceReferences,
      boundaryEvidence: oldItem.targetCueIds.flatMap(
        (cueId) => reconciled.cueEvidence.get(cueId) ?? [],
      ),
      componentRawVadIntervals: reconciled.componentRawVadIntervals,
      componentDecodedSegments: reconciled.componentDecodedSegments,
      componentMappedTokenEvidence: reconciled.componentMappedTokenEvidence,
      componentPauseEvidence: reconciled.componentPauseEvidence,
    });
    const audio = await resolveReviewAudio({
      mode: input.audioMode,
      reviewId: oldItem.reviewId,
      componentId,
      componentUnionInterval:
        oldItem.componentUnionInterval ?? oldItem.interval,
      mediaDurationSeconds:
        source.reviewPackage.sourceFingerprint.durationSeconds,
      targetSubtitleDirectory: targetLocated.subtitleDirectory,
      sourceSubtitleDirectory: sourceLocated.subtitleDirectory,
      sourceVideoPath: input.sourceVideoPath ?? null,
      overlapArtifact: source.overlapAcoustic,
      contextSeconds: input.contextSeconds ?? 1.5,
      maximumSeconds: input.maximumSeconds ?? 30,
    });
    const boundaryEvidence = oldItem.targetCueIds.flatMap(
      (cueId) => reconciled.cueEvidence.get(cueId) ?? [],
    );
    const reconciledForcedAlignmentEvidence =
      oldItem.forcedAlignmentEvidence === undefined
        ? undefined
        : {
            ...oldItem.forcedAlignmentEvidence,
            cues: oldItem.forcedAlignmentEvidence.cues.map((cue) => {
              const mapped =
                reconciled.mappedTokenBoundaryByCue.get(cue.cueId) ?? null;
              return {
                ...cue,
                mappedTokenBoundary: mapped,
                rawVadBoundary:
                  reconciled.rawVadBoundaryByCue.get(cue.cueId) ?? null,
                antiForcingBlockers: [
                  ...new Set([
                    ...cue.antiForcingBlockers,
                    ...(mapped === null
                      ? ["MAPPED_TOKEN_EVIDENCE_UNAVAILABLE"]
                      : []),
                  ]),
                ].toSorted(),
              };
            }),
          };
    items.push({
      ...oldItem,
      audioClipPath: audio.path,
      audioError: audio.error,
      audioSource: audio.source,
      audioValidationStatus: audio.validationStatus,
      audioSourceArtifact: audio.sourceArtifact,
      audioSourceAudioPath: audio.sourceAudioPath,
      audioSourceComponentId: audio.sourceComponentId,
      audioSourceEvidenceLineageIds: audio.sourceEvidenceLineageIds,
      audioHandoffMethod: audio.handoffMethod,
      audioRequestedInterval: audio.requestedInterval,
      audioExtractedInterval: audio.extractedInterval,
      audioDurationSeconds: audio.durationSeconds,
      audioActualDurationSeconds: audio.actualDurationSeconds,
      audioSampleRate: audio.sampleRate,
      audioChannelCount: audio.channelCount,
      audioBitsPerSample: audio.bitsPerSample,
      audioFrameCount: audio.frameCount,
      audioInspectionMethod: audio.inspectionMethod,
      audioSha256: audio.sha256,
      audioContextBeforeSeconds: audio.contextBeforeSeconds,
      audioContextAfterSeconds: audio.contextAfterSeconds,
      audioFullyCoversComponent: audio.fullyCoversComponent,
      boundaryEvidence:
        input.evidenceMode === "enforce"
          ? boundaryEvidence
          : oldItem.boundaryEvidence,
      componentRawVadIntervals:
        input.evidenceMode === "enforce"
          ? reconciled.componentRawVadIntervals
          : oldItem.componentRawVadIntervals,
      componentDecodedSegments:
        input.evidenceMode === "enforce"
          ? reconciled.componentDecodedSegments
          : oldItem.componentDecodedSegments,
      componentMappedTokenEvidence:
        input.evidenceMode === "enforce"
          ? reconciled.componentMappedTokenEvidence
          : oldItem.componentMappedTokenEvidence,
      componentPauseEvidence:
        input.evidenceMode === "enforce"
          ? reconciled.componentPauseEvidence
          : oldItem.componentPauseEvidence,
      evidenceReconciliationHash:
        input.evidenceMode === "enforce"
          ? reconciled.reconciliationHash
          : oldItem.evidenceReconciliationHash,
      evidenceSourceResolutionStatus:
        input.evidenceMode === "enforce"
          ? reconciled.resolutionStatus
          : oldItem.evidenceSourceResolutionStatus,
      unresolvedEvidenceReferences:
        input.evidenceMode === "enforce"
          ? reconciled.unresolvedEvidenceReferences
          : oldItem.unresolvedEvidenceReferences,
      ...(input.evidenceMode !== "enforce" ||
      reconciledForcedAlignmentEvidence === undefined
        ? {}
        : { forcedAlignmentEvidence: reconciledForcedAlignmentEvidence }),
    });
  }
  const observedEvidenceReconciliationHash = sha256Value(
    reconciliationHashes.toSorted(),
  );
  if (input.evidenceMode !== "off") {
    const generatedAt = new Date().toISOString();
    const reconciliationBase = {
      schemaVersion: "1.0.0",
      artifactType: "subtitle-review-evidence-reconciliation",
      reconciliationVersion: "C5.17.2",
      generatedAt,
      mode: input.evidenceMode,
      sourceArtifactHashes: {
        canonicalForcedAlignment: source.hashes.forcedAlignment,
        overlapAcousticResolution: source.hashes.overlapAcoustic,
        timestampEvidenceIntegrity: source.hashes.timestampIntegrity,
        presentationResolution: source.hashes.presentation,
        canonicalPronunciation: source.hashes.pronunciation,
      },
      items: reconciliationItems.toSorted((left, right) =>
        left.reviewId.localeCompare(right.reviewId),
      ),
      reconciliationHash: observedEvidenceReconciliationHash,
    };
    await atomicWriteJson(
      path.join(
        targetLocated.subtitleDirectory,
        "subtitle-review-evidence-reconciliation.json",
      ),
      {
        ...reconciliationBase,
        semanticHash: sha256Value({ ...reconciliationBase, generatedAt: null }),
      },
      { overwrite: true },
    );
  }
  const evidenceReconciliationHash =
    input.evidenceMode === "off"
      ? (source.reviewPackage.evidenceReconciliationHash ?? sha256Value([]))
      : observedEvidenceReconciliationHash;
  const summary = reviewSummary(items);
  const bindingDescriptors = candidateBindingDescriptors({
    items,
    inputEvidenceHash: source.reviewPackage.inputEvidenceHash,
  });
  const reviewVersion = `review-v3-${sha256Value({
    baseSubtitlePackageHash: source.reviewPackage.baseSubtitlePackageHash,
    baseCueHash: source.reviewPackage.baseCueHash,
    inputEvidenceHash: source.reviewPackage.inputEvidenceHash,
    evidenceReconciliationHash,
    deliveryIntegrityPolicyVersion: REVIEW_DELIVERY_POLICY_VERSION,
    reviewActionPolicyVersion: REVIEW_ACTION_POLICY_VERSION,
    reviewActionPolicyHash: REVIEW_ACTION_POLICY_HASH,
    candidateBindingDescriptors: bindingDescriptors,
    items: items.map((item) => ({
      reviewId: item.reviewId,
      audioClipPath: item.audioClipPath,
      audioSha256: item.audioSha256,
      audioSource: item.audioSource,
      audioExtractedInterval: item.audioExtractedInterval,
      audioFullyCoversComponent: item.audioFullyCoversComponent,
      audioValidationStatus: item.audioValidationStatus,
      evidenceReconciliationHash: item.evidenceReconciliationHash,
    })),
  }).slice(0, 24)}`;
  const boundItems = bindReviewCandidates({
    items,
    inputEvidenceHash: source.reviewPackage.inputEvidenceHash,
    reviewVersion,
  });
  const reviewPackage = subtitleReviewPackageSchema.parse({
    ...source.reviewPackage,
    generatedAt: new Date().toISOString(),
    reviewVersion,
    evidenceReconciliationHash,
    evidenceReconciliationStatus:
      input.evidenceMode === "off"
        ? "legacy"
        : input.evidenceMode === "observe"
          ? "observed"
          : "enforced",
    deliveryIntegrityPolicyVersion: REVIEW_DELIVERY_POLICY_VERSION,
    reviewActionPolicyVersion: REVIEW_ACTION_POLICY_VERSION,
    items: boundItems,
    summary,
  });
  const reviewPackagePath = path.join(
    targetLocated.subtitleDirectory,
    "subtitle-review-package.json",
  );
  await atomicWriteJson(reviewPackagePath, reviewPackage, { overwrite: true });
  await writeSubtitleReviewPage({
    subtitleDirectory: targetLocated.subtitleDirectory,
    reviewPackage,
    timelineEnabled: input.reviewPageTimeline ?? true,
  });
  const previousReport = source.finalizationReport;
  const finalizationReport = subtitleFinalizationReportSchema.parse({
    ...previousReport,
    finalizationVersion: "C5.17.2-review-evidence-audio-handoff-v1",
    generatedAt: new Date().toISOString(),
    metrics: {
      ...previousReport.metrics,
      reviewItemCount: summary.itemCount,
      reviewAudioCoverageFailureCount: summary.audioCoverageFailureCount,
      reviewAudioPhysicalFileCount: summary.audioPhysicalFileCount,
      reviewAudioReferencedCount: summary.audioReferencedCount,
      reviewAudioPlayableCount: summary.audioPlayableCount,
      reviewAudioReusedExistingCount: summary.audioReusedExistingCount,
      reviewAudioReusedOverlapCount: summary.audioReusedOverlapCount,
      reviewAudioGeneratedCount: summary.audioGeneratedCount,
      reviewAudioHashMismatchCount: summary.audioHashMismatchCount,
      reviewAudioMetadataFailureCount: summary.audioMetadataFailureCount,
      mappedTokenEvidenceCount: summary.mappedTokenEvidenceCount,
      rawVadEvidenceCount: summary.rawVadEvidenceCount,
      decodedSegmentEvidenceCount: summary.decodedSegmentEvidenceCount,
      mappedTokenBoundaryCopiedFromEvidenceDpCount:
        summary.mappedTokenBoundaryCopiedFromEvidenceDpCount,
      unresolvedEvidenceReferenceCount:
        summary.unresolvedEvidenceReferenceCount,
      rootReviewDataMismatchCount: 0,
      finalizationReviewMetricMismatchCount: 0,
      reviewPageBrokenAudioReferenceCount: 0,
      reviewDeliveryIntegrityPassed:
        summary.audioFailureCount === 0 &&
        summary.audioCoverageFailureCount === 0 &&
        summary.unresolvedEvidenceReferenceCount === 0 &&
        summary.mappedTokenBoundaryCopiedFromEvidenceDpCount === 0,
      forcedAlignmentMfaProcessCount: 0,
    },
    qualityGate: {
      ...previousReport.qualityGate,
      reviewDeliveryIntegrityPassed:
        summary.audioFailureCount === 0 &&
        summary.audioCoverageFailureCount === 0 &&
        summary.unresolvedEvidenceReferenceCount === 0 &&
        summary.mappedTokenBoundaryCopiedFromEvidenceDpCount === 0,
    },
    outputPaths: {
      ...previousReport.outputPaths,
      reviewDeliveryIntegrity: "subtitle-review-delivery-integrity.json",
    },
  });
  await atomicWriteJson(
    path.join(
      targetLocated.subtitleDirectory,
      "subtitle-finalization-report.json",
    ),
    finalizationReport,
    { overwrite: true },
  );
  const target = await loadReviewDeliveryArtifacts(
    targetLocated.subtitleDirectory,
  );
  return {
    sourceSubtitleDirectory: sourceLocated.subtitleDirectory,
    targetSubtitleDirectory: targetLocated.subtitleDirectory,
    source,
    target,
    reviewPackage,
    finalizationReport,
  };
}

export async function buildReviewDeliveryIntegrity(input: {
  sourceTaskName: string;
  subtitleDirectory: string;
  sourceReviewPackageHash: string;
  sourceFinalizationReportHash: string;
  baseTimingHash: string;
  canonicalCueHashUnchanged: boolean;
  canonicalTimingHashUnchanged: boolean;
}): Promise<SubtitleReviewDeliveryIntegrity> {
  const loaded = await loadReviewDeliveryArtifacts(input.subtitleDirectory);
  const rootPackageBuffer = await readFile(loaded.paths.reviewPackage);
  const reviewDataPath = path.join(
    input.subtitleDirectory,
    "review",
    "data",
    "subtitle-review-package.json",
  );
  const reviewDataBuffer = await readFile(reviewDataPath);
  const rootMatchesData = rootPackageBuffer.equals(reviewDataBuffer);
  const allArtifactIds = collectArtifactObjectIds([
    loaded.forcedAlignment,
    loaded.overlapAcoustic,
    loaded.timestampIntegrity,
    loaded.presentation,
    loaded.pronunciation,
    loaded.subtitlePackage,
  ]);
  const pagePath = path.join(input.subtitleDirectory, "review", "index.html");
  const pageJsPath = path.join(
    input.subtitleDirectory,
    "review",
    "assets",
    "review.js",
  );
  const pageCssPath = path.join(
    input.subtitleDirectory,
    "review",
    "assets",
    "review.css",
  );
  const pageAssetsPresent =
    (await exists(pagePath)) &&
    (await exists(pageJsPath)) &&
    (await exists(pageCssPath));
  const reviewDirectory = path.join(input.subtitleDirectory, "review");
  const items: SubtitleReviewDeliveryIntegrity["items"] = [];
  for (const item of loaded.reviewPackage.items) {
    const componentId =
      item.audioSourceComponentId ?? item.forcedAlignmentEvidence?.componentId;
    if (componentId === undefined) {
      throw new InputError(`Review ${item.reviewId} has no component ID.`);
    }
    const audioPathIsRelative =
      item.audioClipPath !== null && !path.isAbsolute(item.audioClipPath);
    const resolvedAudioPath =
      item.audioClipPath === null
        ? null
        : path.resolve(reviewDirectory, item.audioClipPath);
    const audioPathWithinTaskRoot =
      resolvedAudioPath !== null &&
      relativePathInside(input.subtitleDirectory, resolvedAudioPath);
    const audioFileExists =
      resolvedAudioPath !== null &&
      audioPathWithinTaskRoot &&
      (await exists(resolvedAudioPath));
    const actualHash = audioFileExists
      ? await fileHash(resolvedAudioPath)
      : null;
    let audioMetadataValid = false;
    if (audioFileExists) {
      try {
        const metadata = inspectReviewWav(await readFile(resolvedAudioPath));
        audioMetadataValid =
          metadata.sampleRate === item.audioSampleRate &&
          metadata.channelCount === item.audioChannelCount &&
          metadata.bitsPerSample === item.audioBitsPerSample &&
          metadata.frameCount === item.audioFrameCount;
      } catch {
        audioMetadataValid = false;
      }
    }
    const evidenceValues = [
      ...item.boundaryEvidence,
      ...item.componentRawVadIntervals,
      ...item.componentDecodedSegments,
      ...item.componentMappedTokenEvidence,
      ...item.componentPauseEvidence,
    ];
    const resolved = (sourceTypes: readonly string[]) =>
      evidenceValues
        .filter((value) => sourceTypes.includes(value.sourceType))
        .every((value) => allArtifactIds.has(value.sourceObjectId));
    const mapped = item.boundaryEvidence.filter((value) =>
      ["trusted-mapped-token", "trusted-no-vad-token"].includes(
        value.sourceType,
      ),
    );
    const raw = item.componentRawVadIntervals;
    const decoded = [
      ...item.boundaryEvidence,
      ...item.componentDecodedSegments,
    ].filter((value) => value.sourceType === "decoded-segment");
    const mfa = item.boundaryEvidence.filter((value) =>
      ["mfa-narrow", "mfa-expanded", "forced-alignment-selected"].includes(
        value.sourceType,
      ),
    );
    const dp = item.boundaryEvidence.filter(
      (value) => value.sourceType === "evidence-dp",
    );
    const mappedTokenEvidenceResolved =
      mapped.length === 0 ||
      resolved(["trusted-mapped-token", "trusted-no-vad-token"]);
    const rawVadEvidenceResolved = raw.length === 0 || resolved(["raw-vad"]);
    const decodedSegmentEvidenceResolved =
      decoded.length === 0 || resolved(["decoded-segment"]);
    const mfaEvidenceResolved =
      mfa.length === 0 ||
      resolved(["mfa-narrow", "mfa-expanded", "forced-alignment-selected"]);
    const evidenceDpResolved = dp.length === 0 || resolved(["evidence-dp"]);
    const legacyProjectionConsistent =
      item.forcedAlignmentEvidence?.cues.every((cue) => {
        const mappedEvidence = item.boundaryEvidence.filter(
          (value) =>
            value.cueIds.includes(cue.cueId) &&
            ["trusted-mapped-token", "trusted-no-vad-token"].includes(
              value.sourceType,
            ),
        );
        const rawCueEvidence = item.boundaryEvidence.find(
          (value) =>
            value.cueIds.includes(cue.cueId) && value.sourceType === "raw-vad",
        );
        return (
          (cue.mappedTokenBoundary === null
            ? mappedEvidence.length === 0
            : mappedEvidence.some((value) =>
                intervalEqual(cue.mappedTokenBoundary, value.interval),
              )) && intervalEqual(cue.rawVadBoundary, rawCueEvidence?.interval)
        );
      }) !== false;
    const audioFullyCoversComponent = item.audioFullyCoversComponent;
    const audioHashMatches =
      item.audioSha256 !== null && actualHash === item.audioSha256;
    const reviewPageAudioResolvable =
      pageAssetsPresent && audioFileExists && audioPathWithinTaskRoot;
    const reviewPageEvidenceResolvable =
      pageAssetsPresent &&
      mappedTokenEvidenceResolved &&
      rawVadEvidenceResolved &&
      decodedSegmentEvidenceResolved &&
      mfaEvidenceResolved &&
      evidenceDpResolved &&
      item.unresolvedEvidenceReferences.length === 0;
    const checks = {
      audioFileExists,
      audioPathIsRelative,
      audioPathWithinTaskRoot,
      audioHashMatches,
      audioMetadataValid,
      audioFullyCoversComponent,
      rootReviewPackageMatchesReviewDataCopy: rootMatchesData,
      mappedTokenEvidenceResolved,
      rawVadEvidenceResolved,
      decodedSegmentEvidenceResolved,
      mfaEvidenceResolved,
      evidenceDpResolved,
      legacyProjectionConsistent,
      reviewPageAudioResolvable,
      reviewPageEvidenceResolvable,
    };
    const failures = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) =>
        name.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase(),
      )
      .toSorted();
    items.push({
      reviewId: item.reviewId,
      componentId,
      cueIds: item.targetCueIds,
      componentUnionInterval: item.componentUnionInterval ?? item.interval,
      audioClipPath: item.audioClipPath,
      audioIncludedInShareable: false,
      audioFileName:
        resolvedAudioPath === null ? null : path.basename(resolvedAudioPath),
      audioDurationSeconds: item.audioActualDurationSeconds,
      audioFileExists,
      audioPathIsRelative,
      audioPathWithinTaskRoot,
      audioHashExpected: item.audioSha256,
      audioHashActual: actualHash,
      audioHashMatches,
      audioMetadataValid,
      audioFullyCoversComponent,
      rootReviewPackageMatchesReviewDataCopy: rootMatchesData,
      mappedTokenEvidenceResolved,
      rawVadEvidenceResolved,
      decodedSegmentEvidenceResolved,
      mfaEvidenceResolved,
      evidenceDpResolved,
      legacyProjectionConsistent,
      reviewPageAudioResolvable,
      reviewPageEvidenceResolvable,
      deliveryPassed: failures.length === 0,
      failures,
    });
  }
  const expectedSummary = reviewSummary(loaded.reviewPackage.items);
  const reviewSummaryMatchesItems =
    sha256Value(expectedSummary) === sha256Value(loaded.reviewPackage.summary);
  const metrics = loaded.finalizationReport.metrics;
  const finalizationMetricsMatchReviewSummary =
    metrics.reviewItemCount === expectedSummary.itemCount &&
    metrics.reviewAudioCoverageFailureCount ===
      expectedSummary.audioCoverageFailureCount &&
    metrics.reviewAudioReferencedCount ===
      expectedSummary.audioReferencedCount &&
    metrics.reviewAudioPlayableCount === expectedSummary.audioPlayableCount;
  const mappedCopiedCount =
    expectedSummary.mappedTokenBoundaryCopiedFromEvidenceDpCount;
  const decodedMislabelledCount = loaded.reviewPackage.items.reduce(
    (sum, item) =>
      sum +
      item.componentRawVadIntervals.filter(
        (value) => value.sourceType === "decoded-segment",
      ).length,
    0,
  );
  const unresolvedCount =
    loaded.reviewPackage.summary.unresolvedEvidenceReferenceCount;
  const summaryWithoutPass = {
    itemCount: items.length,
    passedItemCount: items.filter((item) => item.deliveryPassed).length,
    failedItemCount: items.filter((item) => !item.deliveryPassed).length,
    reviewAudioPhysicalFileCount: items.filter((item) => item.audioFileExists)
      .length,
    reviewAudioReferencedCount: expectedSummary.audioReferencedCount,
    reviewAudioPlayableCount: items.filter(
      (item) => item.reviewPageAudioResolvable && item.audioHashMatches,
    ).length,
    reviewAudioReusedExistingCount: expectedSummary.audioReusedExistingCount,
    reviewAudioReusedOverlapCount: expectedSummary.audioReusedOverlapCount,
    reviewAudioGeneratedCount: expectedSummary.audioGeneratedCount,
    reviewAudioHashMismatchCount: items.filter(
      (item) => item.audioFileExists && !item.audioHashMatches,
    ).length,
    reviewAudioCoverageFailureCount: items.filter(
      (item) => !item.audioFullyCoversComponent,
    ).length,
    reviewAudioMetadataFailureCount: items.filter(
      (item) => !item.audioMetadataValid,
    ).length,
    mappedTokenEvidenceCount: expectedSummary.mappedTokenEvidenceCount,
    rawVadEvidenceCount: expectedSummary.rawVadEvidenceCount,
    decodedSegmentEvidenceCount: expectedSummary.decodedSegmentEvidenceCount,
    mappedTokenBoundaryCopiedFromEvidenceDpCount: mappedCopiedCount,
    decodedSegmentMislabelledAsRawVadCount: decodedMislabelledCount,
    unresolvedEvidenceReferenceCount: unresolvedCount,
    rootReviewDataMismatchCount: Number(!rootMatchesData),
    finalizationReviewMetricMismatchCount: Number(
      !finalizationMetricsMatchReviewSummary,
    ),
    reviewPageBrokenAudioReferenceCount: items.filter(
      (item) => !item.reviewPageAudioResolvable,
    ).length,
  };
  const reviewDeliveryIntegrityPassed =
    summaryWithoutPass.failedItemCount === 0 &&
    reviewSummaryMatchesItems &&
    finalizationMetricsMatchReviewSummary &&
    pageAssetsPresent &&
    mappedCopiedCount === 0 &&
    decodedMislabelledCount === 0 &&
    unresolvedCount === 0 &&
    input.canonicalCueHashUnchanged &&
    input.canonicalTimingHashUnchanged;
  const crossArtifactChecks = {
    rootReviewPackageMatchesReviewDataCopy: rootMatchesData,
    reviewSummaryMatchesItems,
    finalizationMetricsMatchReviewSummary,
    reviewPageAssetsPresent: pageAssetsPresent,
    reviewPageAudioReferencesResolvable: items.every(
      (item) => item.reviewPageAudioResolvable,
    ),
    reviewPageEvidenceReferencesResolvable: items.every(
      (item) => item.reviewPageEvidenceResolvable,
    ),
    shareableContainsNoAudio: true,
    shareableContainsNoBrokenAudioReference: true,
    canonicalCueHashUnchanged: input.canonicalCueHashUnchanged,
    canonicalTimingHashUnchanged: input.canonicalTimingHashUnchanged,
  };
  const failures = [
    ...items.flatMap((item) =>
      item.failures.map((failure) => `${item.reviewId}:${failure}`),
    ),
    ...Object.entries(crossArtifactChecks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
  ].toSorted();
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-review-delivery-integrity" as const,
    deliveryVersion: "C5.17.2" as const,
    policyVersion: REVIEW_DELIVERY_POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    sourceTaskIdentity: {
      taskName: input.sourceTaskName,
      sourceReviewPackageHash: input.sourceReviewPackageHash,
      sourceFinalizationReportHash: input.sourceFinalizationReportHash,
    },
    baseCueHash: loaded.reviewPackage.baseCueHash,
    baseTimingHash: input.baseTimingHash,
    reviewPackageHash: loaded.hashes.reviewPackage,
    finalizationReportHash: loaded.hashes.finalizationReport,
    evidenceReconciliationHash:
      loaded.reviewPackage.evidenceReconciliationHash ?? sha256Value([]),
    items,
    crossArtifactChecks,
    summary: {
      ...summaryWithoutPass,
      reviewDeliveryIntegrityPassed,
    },
    failures,
  };
  return subtitleReviewDeliveryIntegritySchema.parse({
    ...base,
    semanticHash: semanticDeliveryHash(base),
  });
}

export async function writeReviewDeliveryIntegrity(input: {
  mode: ReviewDeliveryIntegrityMode;
  sourceTaskName: string;
  subtitleDirectory: string;
  sourceReviewPackageHash: string;
  sourceFinalizationReportHash: string;
  baseTimingHash: string;
  canonicalCueHashUnchanged: boolean;
  canonicalTimingHashUnchanged: boolean;
}): Promise<{
  artifact: SubtitleReviewDeliveryIntegrity | null;
  path: string | null;
}> {
  if (input.mode === "off") return { artifact: null, path: null };
  const preliminary = await buildReviewDeliveryIntegrity(input);
  const updateFinalizationDeliveryState = async (
    summary: SubtitleReviewDeliveryIntegrity["summary"],
    passed: boolean,
  ): Promise<void> => {
    const loaded = await loadReviewDeliveryArtifacts(input.subtitleDirectory);
    const report = subtitleFinalizationReportSchema.parse({
      ...loaded.finalizationReport,
      generatedAt: new Date().toISOString(),
      metrics: {
        ...loaded.finalizationReport.metrics,
        reviewItemCount: summary.itemCount,
        reviewAudioCoverageFailureCount:
          summary.reviewAudioCoverageFailureCount,
        reviewAudioPhysicalFileCount: summary.reviewAudioPhysicalFileCount,
        reviewAudioReferencedCount: summary.reviewAudioReferencedCount,
        reviewAudioPlayableCount: summary.reviewAudioPlayableCount,
        reviewAudioReusedExistingCount: summary.reviewAudioReusedExistingCount,
        reviewAudioReusedOverlapCount: summary.reviewAudioReusedOverlapCount,
        reviewAudioGeneratedCount: summary.reviewAudioGeneratedCount,
        reviewAudioHashMismatchCount: summary.reviewAudioHashMismatchCount,
        reviewAudioMetadataFailureCount:
          summary.reviewAudioMetadataFailureCount,
        mappedTokenEvidenceCount: summary.mappedTokenEvidenceCount,
        rawVadEvidenceCount: summary.rawVadEvidenceCount,
        decodedSegmentEvidenceCount: summary.decodedSegmentEvidenceCount,
        mappedTokenBoundaryCopiedFromEvidenceDpCount:
          summary.mappedTokenBoundaryCopiedFromEvidenceDpCount,
        unresolvedEvidenceReferenceCount:
          summary.unresolvedEvidenceReferenceCount,
        rootReviewDataMismatchCount: summary.rootReviewDataMismatchCount,
        finalizationReviewMetricMismatchCount:
          summary.finalizationReviewMetricMismatchCount,
        reviewPageBrokenAudioReferenceCount:
          summary.reviewPageBrokenAudioReferenceCount,
        reviewDeliveryIntegrityPassed: passed,
      },
      qualityGate: {
        ...loaded.finalizationReport.qualityGate,
        reviewDeliveryIntegrityPassed: passed,
      },
    });
    await atomicWriteJson(loaded.paths.finalizationReport, report, {
      overwrite: true,
    });
  };

  // First reconcile every report metric with the package/physical delivery,
  // then evaluate again. A failing gate is recorded as false and never changes
  // canonical cues or timings.
  await updateFinalizationDeliveryState(preliminary.summary, false);
  const evaluated = await buildReviewDeliveryIntegrity(input);
  await updateFinalizationDeliveryState(
    evaluated.summary,
    evaluated.summary.reviewDeliveryIntegrityPassed,
  );
  const artifact = await buildReviewDeliveryIntegrity(input);
  const outputPath = path.join(
    input.subtitleDirectory,
    "subtitle-review-delivery-integrity.json",
  );
  await atomicWriteJson(outputPath, artifact, { overwrite: true });
  if (
    input.mode === "enforce" &&
    !artifact.summary.reviewDeliveryIntegrityPassed
  ) {
    throw new InputError(
      `Review delivery integrity failed: ${artifact.failures.join(", ")}`,
    );
  }
  return { artifact, path: outputPath };
}

export async function auditReviewDeliveryIntegrity(
  taskDirectory: string,
): Promise<{
  artifact: SubtitleReviewDeliveryIntegrity;
  current: SubtitleReviewDeliveryIntegrity;
  semanticHashMatches: boolean;
  passed: boolean;
}> {
  const located = await locateSubtitlePackage(taskDirectory);
  const artifactPath = path.join(
    located.subtitleDirectory,
    "subtitle-review-delivery-integrity.json",
  );
  const artifact = subtitleReviewDeliveryIntegritySchema.parse(
    JSON.parse(await readFile(artifactPath, "utf8")),
  );
  const current = await buildReviewDeliveryIntegrity({
    sourceTaskName: artifact.sourceTaskIdentity.taskName,
    subtitleDirectory: located.subtitleDirectory,
    sourceReviewPackageHash:
      artifact.sourceTaskIdentity.sourceReviewPackageHash,
    sourceFinalizationReportHash:
      artifact.sourceTaskIdentity.sourceFinalizationReportHash,
    baseTimingHash: artifact.baseTimingHash,
    canonicalCueHashUnchanged:
      artifact.crossArtifactChecks.canonicalCueHashUnchanged,
    canonicalTimingHashUnchanged:
      artifact.crossArtifactChecks.canonicalTimingHashUnchanged,
  });
  return {
    artifact,
    current,
    semanticHashMatches: artifact.semanticHash === current.semanticHash,
    passed:
      artifact.summary.reviewDeliveryIntegrityPassed &&
      current.summary.reviewDeliveryIntegrityPassed &&
      artifact.semanticHash === current.semanticHash,
  };
}
