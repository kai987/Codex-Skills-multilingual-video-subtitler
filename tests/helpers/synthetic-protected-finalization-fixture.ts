/**
 * Entirely manufactured orchestration inputs. No person reviewed these lines,
 * no speech is recorded, and no provider/cache/model supplied the evidence.
 * Passing this fixture establishes only the simulated authority/gate contract.
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  c519MemoryReplaySummarySchema,
  subtitleCanonicalForcedAlignmentSchema,
  ctcAlignmentAttemptSchema,
  ctcTargetEncodingSchema,
  subtitleFinalizationReportSchema,
  subtitleMemoryPronunciationProjectionSchema,
  subtitlePackageSchema,
  subtitleReviewPackageSchema,
  type CtcAlignmentAttempt,
  type SubtitleCue,
} from "@mvl/shared";
import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  buildMemoryAssistedCtcTargetAudit,
  buildSeriesIdentity,
  buildSubtitleCanonicalAlignmentInput,
  buildSubtitleCanonicalForcedAlignment,
  stableMemoryHash,
} from "@mvl/transcription-core";
import {
  analyzeLocalSpeakerEvidence,
  buildLocalCtcBoundaryEvidence,
  buildSubtitleCtcAlignmentInput,
  canonicalTimingHash,
  loadHumanReviewedSubtitle,
  loadReviewDeliveryArtifacts,
  normalizeCtcAlignmentText,
  repairReviewPackageDelivery,
  sha256LocalFile,
  sha256Value,
  writeReviewDeliveryIntegrity,
  writeSubtitleReviewPage,
  type CtcCueEvidenceInput,
  type RawSpeakerAttemptInput,
} from "@mvl/video-subtitler";

import { createSyntheticReviewDeliveryTask } from "./synthetic-review-delivery-fixture.js";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";
const SYNTHETIC_IDENTITY = sha256Value(
  "test-only, not an installed runtime or model",
);
const digestText = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function wav(seconds: number): Buffer {
  const frames = Math.round(seconds * 16_000);
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++)
    bytes.writeInt16LE((frame % 257) - 128, 44 + frame * 2);
  return bytes;
}

function encoding(text: string, representable: boolean) {
  return ctcTargetEncodingSchema.parse({
    targetText: text,
    targetTextSha256: digestText(text),
    tokenIds: [representable ? 1 : 2],
    tokenPieces: [text],
    unknownTokenCount: representable ? 0 : 1,
    specialTokenCount: 0,
    targetEncodable: representable,
    blockers: representable ? [] : ["CTC_TARGET_UNREPRESENTABLE"],
  });
}

/** Make input-side saved attempt hypotheses, not a real model-run receipt. */
async function ctcAttempt(input: {
  directory: string;
  cue: SubtitleCue;
  componentId: string;
  windowType: "narrow" | "expanded";
  representable: boolean;
  boundary: { start: number; end: number };
}): Promise<CtcAlignmentAttempt> {
  const pad = input.windowType === "narrow" ? 0.5 : 0.75;
  const interval = { start: input.cue.start - pad, end: input.cue.end + pad };
  const audio = wav(interval.end - interval.start);
  const attemptId = `synthetic-${input.cue.id}-${input.windowType}`;
  await writeFile(path.join(input.directory, `${attemptId}.wav`), audio);
  const frames = (audio.length - 44) / 2;
  const logits = Math.floor((frames - 400) / 320) + 1;
  const target = encoding(
    normalizeCtcAlignmentText(input.cue.text).text,
    input.representable,
  );
  return ctcAlignmentAttemptSchema.parse({
    attemptId,
    cueId: input.cue.id,
    componentId: input.componentId,
    windowType: input.windowType,
    audioSha256: createHash("sha256").update(audio).digest("hex"),
    audioSampleRate: 16_000,
    audioFrameCount: frames,
    audioDurationSeconds: frames / 16_000,
    audioLocalInterval: { start: 0, end: frames / 16_000 },
    mediaGlobalInterval: interval,
    target,
    targetTokenCount: target.tokenIds.length,
    cacheHit: false,
    inferenceExecuted: false,
    modelLoadCount: 0,
    pathStatus: input.representable ? "success" : "target-unrepresentable",
    pathExists: input.representable,
    predictedFrameCount: logits,
    logitsFrameCount: logits,
    expectedFrameCount: logits,
    frameCountVerified: true,
    tokenSpans: [],
    selectedBoundary: input.representable ? input.boundary : null,
    startPinnedToWindowEdge: false,
    endPinnedToWindowEdge: false,
    meanTokenPosterior: null,
    minimumTokenPosterior: null,
    alignedTokenMeanLogPosterior: null,
    alignedTokenMinLogPosterior: null,
    pathScore: null,
    normalizedPathLogScore: null,
    blankFrameRatio: null,
    targetSpanDurationSeconds: null,
    targetSpanToWindowRatio: null,
    scoreCalibrationStatus: "uncalibrated-ctc-score",
    greedyText: "",
    greedyTextMatchesTarget: false,
    greedyNormalizedSimilarity: 0,
    greedyEditRatio: 1,
    greedyDiagnosticOnly: true,
    workerRequestVerified: true,
    viterbiPolicy: "mvl-ctc-viterbi-v1",
    frameMapping: {
      sampleRate: 16_000,
      convKernel: [10, 3, 3, 3, 3, 2, 2],
      convStride: [5, 2, 2, 2, 2, 2, 2],
      totalStrideSamples: 320,
      receptiveFieldSamples: 400,
      frameCountFormula: "iterated-valid-convolution-v1",
      frameIntervalPolicy: "receptive-field-clipped-v1",
    },
    deviceRequested: "cpu",
    deviceUsed: "cpu",
    wallClockSeconds: 0,
    warnings: ["Manufactured test hypothesis; no actual worker or inference."],
    blockers: target.blockers,
  });
}

export async function createSyntheticProtectedFinalizationFixture(
  root: string,
) {
  const sourceVideo = path.join(root, "synthetic-not-speech.wav");
  const humanSubtitle = path.join(root, "synthetic-simulated-review.ass");
  await writeFile(sourceVideo, wav(30));
  const phrases = [
    "青い札を選びます",
    "丸い箱を運びます",
    "白い紙を折ります",
    "赤い線を引きます",
    "窓の横に置きます",
    "小さな鐘が鳴ります",
    "机の上を片付けます",
    "緑の旗を揚げます",
    "二つの輪を並べます",
    "右の扉を閉めます",
    "左の灯りを消します",
    "長い棒をしまいます",
    "透明な瓶を洗います",
    "四角い布を広げます",
    "ここで試験を終えます",
    "最後に札を戻します",
  ];
  const authored = phrases.map((text, index): SubtitleCue => {
    const start =
      index < 14
        ? 2 + Math.floor(index / 2) * 4 + (index % 2) * 0.4
        : 28 + index - 14;
    return {
      id: `authored-${index}`,
      start,
      end: start + 0.6,
      text,
      language: "ja",
      languages: ["ja"],
      speaker: null,
      confidence: null,
      style: "default",
    };
  });
  await writeFile(humanSubtitle, formatAss(authored));
  const human = await loadHumanReviewedSubtitle(humanSubtitle);
  const sourceFingerprint = {
    fileName: path.basename(sourceVideo),
    size: (await stat(sourceVideo)).size,
    durationSeconds: 30,
    sha256: await sha256LocalFile(sourceVideo),
  };
  const sourceTask = await createSyntheticReviewDeliveryTask(root, {
    cues: human.cues,
    sourceFingerprint,
  });
  const taskDirectory = path.join(root, "protected-synthetic-task");
  await cp(sourceTask, taskDirectory, { recursive: true });
  const subtitleDirectory = path.join(taskDirectory, "subtitle-synthetic");
  const json = async (name: string, value: unknown) =>
    writeFile(
      path.join(subtitleDirectory, name),
      `${JSON.stringify(value, null, 2)}\n`,
    );
  // The delivery fixture deliberately starts with a generic historical defect.
  // This scenario assigns its precise production policy code, never demotes it.
  for (const name of [
    "subtitle-review-package.json",
    "subtitle-finalization-report.json",
    "subtitle-canonical-forced-alignment.json",
    "subtitle-overlap-acoustic-resolution.json",
    "subtitle-canonical-pronunciation.json",
  ]) {
    const file = path.join(subtitleDirectory, name);
    await writeFile(
      file,
      (await readFile(file, "utf8")).replaceAll(
        "SYNTHETIC_UNRESOLVED_OVERLAP",
        "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
      ),
    );
  }
  // A saved, supported legacy *input* snapshot, not a current MFA execution.
  // Keep no attempts, zero coverage, failed anti-forcing and every unresolved
  // component. C6 exercises the known insufficient-evidence contract, not the
  // latest provider's diagnostic vocabulary or a simulated successful aligner.
  const originalForced = subtitleCanonicalForcedAlignmentSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          subtitleDirectory,
          "subtitle-canonical-forced-alignment.json",
        ),
        "utf8",
      ),
    ) as unknown,
  );
  const snapshotCues = originalForced.cueAlignments.map((cue) => ({
    ...cue,
    blockers: ["INSUFFICIENT_ACOUSTIC_ALIGNMENT"],
  }));
  const byCue = new Map(snapshotCues.map((cue) => [cue.cueId, cue]));
  const forcedSnapshot = buildSubtitleCanonicalForcedAlignment({
    generatedAt: GENERATED_AT,
    sourceFingerprint,
    baseCueHash: originalForced.baseCueHash,
    baseTimingHash: originalForced.baseTimingHash,
    baseOverlapArtifactHash: originalForced.baseOverlapArtifactHash,
    runtimeCapabilityRef: null,
    canonicalInputRef: originalForced.canonicalInputRef,
    configuration: { mode: "enforce" },
    attempts: [],
    cueAlignments: snapshotCues,
    components: originalForced.components.map((component) => ({
      ...component,
      cueAlignments: component.cueAlignments.map(
        (cue) => byCue.get(cue.cueId) ?? cue,
      ),
      blockers: [
        "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
        "INSUFFICIENT_ACOUSTIC_ALIGNMENT",
      ],
      unresolvedReasons: ["INSUFFICIENT_ACOUSTIC_ALIGNMENT"],
    })),
    appliedMutations: [],
    eligibleCueCount: 0,
    ineligibleCueCount: snapshotCues.length,
    mfaProcessCount: 0,
  });
  await json("subtitle-canonical-forced-alignment.json", forcedSnapshot);
  await repairReviewPackageDelivery({
    sourceTaskDirectory: taskDirectory,
    targetTaskDirectory: taskDirectory,
    audioMode: "reuse-only",
    evidenceMode: "enforce",
    sourceVideoPath: null,
    reviewPageTimeline: true,
  });
  const loaded = await loadReviewDeliveryArtifacts(subtitleDirectory);
  const cueHash = sha256Value(human.cues),
    timingHash = canonicalTimingHash(human.cues);
  const pkg = subtitlePackageSchema.parse({
    ...loaded.subtitlePackage,
    cues: human.cues,
  });
  const effectivePackagePath = "subtitle-package.human-reviewed-base.json";
  await json(effectivePackagePath, pkg);
  const effectivePackageHash = await sha256LocalFile(
    path.join(subtitleDirectory, effectivePackagePath),
  );
  const rescuedIds = new Set(human.cues.slice(0, 2).map((cue) => cue.id));
  const review = subtitleReviewPackageSchema.parse({
    ...loaded.reviewPackage,
    baseSubtitlePackagePath: effectivePackagePath,
    baseSubtitlePackageHash: effectivePackageHash,
    items: loaded.reviewPackage.items.map((item, index) => ({
      ...item,
      speakerEvidenceComponentId: item.audioSourceComponentId,
      blockers: [
        "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
        "ILLEGAL_SUBTITLE_OVERLAP",
        ...(index === 0 ? ["CTC_TARGET_UNREPRESENTABLE"] : []),
        ...(index === 2 ? ["CTC_LEGAL_OVERLAP_DELETED"] : []),
      ],
    })),
  });
  await json("subtitle-review-package.json", review);
  await writeSubtitleReviewPage({
    subtitleDirectory,
    reviewPackage: review,
    timelineEnabled: true,
  });
  const report = subtitleFinalizationReportSchema.parse({
    ...loaded.finalizationReport,
    baseSubtitlePackageHash: effectivePackageHash,
    baseCueHash: cueHash,
    outputCueHash: cueHash,
    humanReviewedBaseline: {
      authority: "user-confirmed-human-review",
      sourceFileName: human.sourceFileName,
      sourceFileSha256: human.sourceFileSha256,
      sourceFileSize: human.sourceFileSize,
      format: human.format,
      cueCount: human.cues.length,
      cueHash,
      timestampNormalizationCount: 0,
      effectivePackagePath,
      sourceReadOnlyVerified: true,
    },
    findings: review.items.flatMap((item) =>
      ["FORCED_ALIGNMENT_COMPONENT_UNRESOLVED", "ILLEGAL_SUBTITLE_OVERLAP"].map(
        (code) => ({
          findingId: `synthetic-${item.reviewId}-${code}`,
          severity: "blocking",
          code,
          cueIds: item.targetCueIds,
          message:
            "Manufactured saved legacy finding for synthetic gate coverage.",
        }),
      ),
    ),
    metrics: {
      ...loaded.finalizationReport.metrics,
      machineCueCount: 16,
      finalCueCount: 16,
      blockingFindingCount: 14,
      unresolvedCount: 14,
      reviewItemCount: 7,
    },
    qualityGate: {
      ...loaded.finalizationReport.qualityGate,
      canonicalParityPassed: true,
      presentationParityPassed: true,
      serializationRoundTripPassed: true,
      formatSemanticParityPassed: true,
      blockingCodes: [
        "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
        "ILLEGAL_SUBTITLE_OVERLAP",
      ],
    },
  });
  await json("subtitle-finalization-report.json", report);
  await writeFile(
    path.join(subtitleDirectory, report.outputPaths.srt),
    formatSrt(human.cues),
  );
  await writeFile(
    path.join(subtitleDirectory, report.outputPaths.vtt),
    formatVtt(human.cues),
  );
  await writeFile(
    path.join(subtitleDirectory, report.outputPaths.ass),
    formatAss(human.cues),
  );
  const delivery = await writeReviewDeliveryIntegrity({
    mode: "enforce",
    sourceTaskName: "synthetic",
    subtitleDirectory,
    sourceReviewPackageHash: await sha256LocalFile(
      path.join(subtitleDirectory, "subtitle-review-package.json"),
    ),
    sourceFinalizationReportHash: await sha256LocalFile(
      path.join(subtitleDirectory, "subtitle-finalization-report.json"),
    ),
    baseTimingHash: timingHash,
    canonicalCueHashUnchanged: true,
    canonicalTimingHashUnchanged: true,
  });
  if (!delivery.artifact?.summary.reviewDeliveryIntegrityPassed)
    throw new Error("Synthetic delivery did not verify");
  const componentOf = (item: (typeof review.items)[number]) =>
    item.audioSourceComponentId ?? item.reviewId;
  const resolvedItem = review.items[2];
  if (resolvedItem === undefined)
    throw new Error("Missing synthetic preservation component");
  const resolvedComponent = componentOf(resolvedItem);
  const rawSpeaker: RawSpeakerAttemptInput[] = review.items.flatMap(
    (item, index) => {
      const union = item.componentUnionInterval ?? item.interval;
      const duration = union.end - union.start;
      return (["context", "union"] as const).map((windowType) => {
        if (item.audioSha256 === null)
          throw new Error("Synthetic audio hash unavailable");
        const stable = index === 2 || windowType === "context";
        const exclusive = [{ speaker: "fixture-a", start: 0, end: duration }];
        const turns = stable
          ? exclusive
          : [...exclusive, { speaker: "fixture-b", start: 0, end: duration }];
        return {
          componentId: componentOf(item),
          windowType,
          audioPath: `audio/review/${item.reviewId}.wav`,
          audioSha256: item.audioSha256,
          audioLocalInterval: { start: 0, end: duration },
          mediaGlobalInterval: union,
          runtimeIdentityHash: SYNTHETIC_IDENTITY,
          modelSnapshotHash: SYNTHETIC_IDENTITY,
          device: "cpu" as const,
          minSpeakers: 1,
          maxSpeakers: 3,
          cacheHit: false,
          inference: {
            standardTurns: turns,
            exclusiveTurns: exclusive,
            wallClockSeconds: 0,
            confidenceStatus: "unavailable" as const,
            warnings: ["Manufactured non-provider test input."],
          },
        };
      });
    },
  );
  const speaker = analyzeLocalSpeakerEvidence({
    mode: "enforce",
    reviewPackage: review,
    baseTimingHash: timingHash,
    runtimeCapabilityRef: {
      path: "synthetic-speaker-runtime.json",
      sha256: SYNTHETIC_IDENTITY,
    },
    reviewPackageRef: {
      path: "subtitle-review-package.json",
      sha256: await sha256LocalFile(
        path.join(subtitleDirectory, "subtitle-review-package.json"),
      ),
    },
    forcedAlignmentRef: {
      path: "subtitle-canonical-forced-alignment.json",
      sha256: loaded.hashes.forcedAlignment,
    },
    overlapAcousticRef: {
      path: "subtitle-overlap-acoustic-resolution.json",
      sha256: loaded.hashes.overlapAcoustic,
    },
    rawAttempts: rawSpeaker,
    pipelineInferenceCount: 0,
    modelLoadCount: 0,
    deviceRequested: "cpu",
  });
  await json("subtitle-local-speaker-evidence.json", speaker);

  // Two isolated protected context cues are included in the fixed 16-cue CTC
  // input, but do not manufacture extra legacy Review Items.
  const components = review.items.map((item, index) => ({
    componentId: componentOf(item),
    cues: [
      ...human.cues.filter((cue) => item.targetCueIds.includes(cue.id)),
      ...(index === 6 ? human.cues.slice(14) : []),
    ],
  }));
  const alignment = buildSubtitleCanonicalAlignmentInput({
    components,
    baseCueHash: cueHash,
    baseTimingHash: timingHash,
    generatedAt: GENERATED_AT,
  });
  const ctcInput = buildSubtitleCtcAlignmentInput({
    source: alignment,
    sourceAlignmentInputHash: sha256Value(alignment),
    runtimeIdentityHash: SYNTHETIC_IDENTITY,
    modelSnapshotHash: SYNTHETIC_IDENTITY,
    tokenizerIdentityHash: SYNTHETIC_IDENTITY,
    generatedAt: GENERATED_AT,
    encodingByCueId: new Map(
      alignment.cues.map((cue) => [
        cue.cueId,
        encoding(
          normalizeCtcAlignmentText(cue.alignmentText).text,
          !rescuedIds.has(cue.cueId),
        ),
      ]),
    ),
  });
  const attemptDirectory = path.join(subtitleDirectory, "synthetic-ctc-inputs");
  await mkdir(attemptDirectory);
  const attempts: CtcAlignmentAttempt[] = [],
    cueEvidence: CtcCueEvidenceInput[] = [];
  for (const component of components)
    for (const [index, cue] of component.cues.entries()) {
      const boundary =
        component.componentId === resolvedComponent
          ? {
              start: cue.start + (index ? 0.12 : 0),
              end: cue.end - (index ? 0 : 0.12),
            }
          : { start: cue.start, end: cue.end };
      const pair = await Promise.all(
        (["narrow", "expanded"] as const).map((windowType) =>
          ctcAttempt({
            directory: attemptDirectory,
            cue,
            componentId: component.componentId,
            windowType,
            representable: !rescuedIds.has(cue.id),
            boundary,
          }),
        ),
      );
      attempts.push(...pair);
      const [narrow, expanded] = pair;
      if (narrow === undefined || expanded === undefined)
        throw new Error("Missing synthetic CTC pair");
      cueEvidence.push({
        cueId: cue.id,
        componentId: component.componentId,
        canonicalText: cue.text,
        alignmentText: cue.text,
        originalInterval: { start: cue.start, end: cue.end },
        narrow,
        expanded,
        independent: {
          mfaBoundary: null,
          mfaStartEvidenceIds: [],
          mfaEndEvidenceIds: [],
          mfaValid: false,
          mappedTokenBoundary: null,
          mappedTokenEvidenceIds: [],
          evidenceDpBoundary: null,
          rawVadBoundary: null,
          speakerBoundary: null,
          speakerEvidenceIds: [],
          speakerContradiction: false,
        },
        neighborIntrusion: false,
      });
    }
  const ctc = buildLocalCtcBoundaryEvidence({
    generatedAt: GENERATED_AT,
    sourceFingerprint,
    baseCueHash: cueHash,
    baseTimingHash: timingHash,
    alignmentInputRef: "subtitle-ctc-alignment-input.json",
    runtimeCapabilityRef: "synthetic-ctc-runtime.json",
    mode: "observe",
    deviceRequested: "cpu",
    deviceUsed: "cpu",
    attempts,
    cues: cueEvidence,
    speakerResolvedComponentIds: new Set([resolvedComponent]),
  });
  await json("subtitle-local-ctc-boundary-evidence.json", ctc);
  await json("subtitle-ctc-alignment-input.json", ctcInput);
  const projectionBase = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-memory-pronunciation-projection" as const,
    projectionVersion: "C5.19" as const,
    generatedAt: GENERATED_AT,
    memoryHash: SYNTHETIC_IDENTITY,
    baseCueHash: cueHash,
    cues: human.cues.map((cue) => ({
      cueId: cue.id,
      canonicalText: cue.text,
      canonicalTextHash: stableMemoryHash(cue.text),
      projectedAlignmentText: rescuedIds.has(cue.id)
        ? `あ${cue.text.slice(1)}`
        : cue.text,
      spans: rescuedIds.has(cue.id)
        ? [
            {
              occurrenceId: `synthetic-occurrence-${cue.id}`,
              originalStartChar: 0,
              originalEndChar: 1,
              canonicalSurface: cue.text.slice(0, 1),
              projectedAlias: "あ",
              entryId: `synthetic-memory-${cue.id}`,
            },
          ]
        : [],
      canonicalTextChanged: false,
    })),
    summary: {
      pronunciationProjectionCount: 2,
      projectedCueCount: 2,
      pronunciationProjectionCanonicalMutationCount: 0,
    },
  };
  const projection = subtitleMemoryPronunciationProjectionSchema.parse({
    ...projectionBase,
    semanticHash: stableMemoryHash({ ...projectionBase, generatedAt: null }),
  });
  const targetAudit = buildMemoryAssistedCtcTargetAudit({
    ctcInput,
    projection,
    generatedAt: GENERATED_AT,
    projectedEncodings: new Map(
      projection.cues
        .filter((cue) => rescuedIds.has(cue.cueId))
        .map((cue) => [cue.cueId, encoding(cue.projectedAlignmentText, true)]),
    ),
  });
  await json("memory-assisted-ctc-target-audit.json", targetAudit);
  await json("subtitle-memory-pronunciation-projection.json", projection);
  const replayBase = {
    schemaVersion: "1.0.0" as const,
    artifactType: "c5-19-memory-replay-summary" as const,
    replayVersion: "C5.19" as const,
    generatedAt: GENERATED_AT,
    runKind: "frozen" as const,
    networkUsed: false,
    sourceTaskHash: sha256Value(pkg),
    sourceCueCount: 16,
    seriesIdentity: buildSeriesIdentity({
      title: "Synthetic gate scenario",
      year: 2026,
      season: 1,
      episode: 1,
      mediaType: "series",
      explicitSeriesVerification: true,
    }),
    memoryHash: SYNTHETIC_IDENTITY,
    artifactPaths: {
      memory: "synthetic-memory.json",
      observations: "synthetic-observations.json",
      delta: "synthetic-delta.json",
      evidence: "synthetic-evidence.json",
      ranking: "synthetic-ranking.json",
      pronunciationProjection: "subtitle-memory-pronunciation-projection.json",
      ctcTargetAudit: "memory-assisted-ctc-target-audit.json",
      ctcObservation: "synthetic-observation.json",
      causalValidation: "synthetic-causal.json",
      qualityAudit: "synthetic-quality.json",
    },
    hashes: {
      canonicalCueHash: cueHash,
      canonicalTimingHash: timingHash,
      presentationHash: loaded.presentation.presentationCueHash,
      memoryHash: SYNTHETIC_IDENTITY,
      observationSemanticHash: SYNTHETIC_IDENTITY,
      deltaSemanticHash: SYNTHETIC_IDENTITY,
      evidenceSemanticHash: SYNTHETIC_IDENTITY,
      rankingSemanticHash: SYNTHETIC_IDENTITY,
      pronunciationProjectionSemanticHash: projection.semanticHash,
      ctcTargetAuditSemanticHash: targetAudit.semanticHash,
      causalValidationSemanticHash: SYNTHETIC_IDENTITY,
    },
    metrics: { syntheticFixture: 1, modelLoads: 0, inferenceCount: 0 },
    reviewItemCountBefore: 7,
    reviewItemCountAfter: 7,
    finalStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
  };
  await writeFile(
    path.join(taskDirectory, "c5-19-memory-replay-summary.json"),
    JSON.stringify(
      c519MemoryReplaySummarySchema.parse({
        ...replayBase,
        semanticHash: stableMemoryHash({ ...replayBase, generatedAt: null }),
      }),
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, "SYNTHETIC_ONLY.md"),
    "Manufactured unit/E2E fixture. Human authority is simulated for tests only; no real human, model, speech, cache, or quality validation is claimed.\n",
  );
  return {
    taskDirectory,
    subtitleDirectory,
    humanSubtitle,
    sourceVideo,
    cues: human.cues,
    cueHash,
    timingHash,
    sourceHash: sourceFingerprint.sha256,
    humanHash: human.sourceFileSha256,
  };
}
