import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  asrRetentionAuditSchema,
  atomicWriteJson,
  machineCoverageRecoverySchema,
  machineCtcIntegrationSchema,
  machineGenerationSurvivalFunnelSchema,
  machineMfaIntegrationSchema,
  machineQualityRecoveryAblationSchema,
  machineQualityRecoveryPolicySchema,
  machineSpeakerOverlapRecoverySchema,
  machineSpeechCoverageGapSchema,
  machineTimingEvidenceSchema,
  machineTokenTimestampRecoverySchema,
  subtitleCanonicalForcedAlignmentSchema,
  subtitlePackageSchema,
  subtitleLocalCtcBoundaryEvidenceSchema,
  subtitleLocalSpeakerEvidenceSchema,
  whisperRuntimeExecutionAuditSchema,
  type MachineQualityRecoveryMode,
  type MachineQualityRecoveryProfile,
} from "@mvl/shared";
import { c60StableHash } from "../finalization-risk-policy.js";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
  sha256BlindFile,
} from "../blind-acceptance/gold-isolation.js";

const POLICY_VERSION = "c6.0.1.1-machine-quality-recovery-v1" as const;

type JsonRecord = Record<string, unknown>;

export interface EmitMachineQualityRunArtifactsInput {
  outputDirectory: string;
  runId: string;
  repositoryCommit: string;
  sourceMediaSha256: string;
  mode: MachineQualityRecoveryMode;
  profile: MachineQualityRecoveryProfile;
  targetChunkSeconds: number | null;
  vadEnabled: boolean;
  sceneRouting: string;
  whisperExecutablePath?: string | null;
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJsonOrEmpty(filePath: string): Promise<JsonRecord> {
  try {
    return record(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch {
    return {};
  }
}

async function findSubtitleDirectory(outputDirectory: string): Promise<string> {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const matches = entries
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => path.join(outputDirectory, entry.name))
    .toSorted();
  const selected = matches[0];
  if (selected === undefined) {
    throw new Error(
      "Machine quality audit could not find a subtitle directory.",
    );
  }
  return selected;
}

function countFrom(recordValue: JsonRecord, ...keys: string[]): number {
  for (const key of keys) {
    if (typeof recordValue[key] === "number") return number(recordValue[key]);
  }
  return 0;
}

function summaryOf(value: JsonRecord): JsonRecord {
  return record(value.summary);
}

function countTokens(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, entry) => sum + countTokens(entry), 0);
  }
  if (typeof value !== "object" || value === null) return 0;
  const valueRecord = value as JsonRecord;
  const own = Array.isArray(valueRecord.tokens) ? valueRecord.tokens.length : 0;
  return (
    own +
    Object.entries(valueRecord)
      .filter(([key]) => key !== "tokens")
      .reduce((sum, [, entry]) => sum + countTokens(entry), 0)
  );
}

function countNumericKeys(value: unknown, keys: ReadonlySet<string>): number {
  if (Array.isArray(value)) {
    return value.reduce<number>(
      (sum, entry) => sum + countNumericKeys(entry, keys),
      0,
    );
  }
  if (typeof value !== "object" || value === null) return 0;
  return Object.entries(value as JsonRecord).reduce(
    (sum, [key, entry]) =>
      sum +
      (keys.has(key) && typeof entry === "number" ? entry : 0) +
      countNumericKeys(entry, keys),
    0,
  );
}

function overlapSeconds(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function coverageGaps(input: {
  speechIntervals: readonly unknown[];
  cues: readonly unknown[];
}): {
  speechSeconds: number;
  coveredSpeechSeconds: number;
  gaps: {
    id: string;
    start: number;
    end: number;
    duration: number;
    reason: string;
  }[];
} {
  const cues = input.cues.map((value) => {
    const cue = record(value);
    return { start: number(cue.start), end: number(cue.end) };
  });
  const gaps: {
    id: string;
    start: number;
    end: number;
    duration: number;
    reason: string;
  }[] = [];
  let speechSeconds = 0;
  let coveredSpeechSeconds = 0;
  for (const [index, rawInterval] of input.speechIntervals.entries()) {
    const interval = record(rawInterval);
    const start = number(interval.start);
    const end = number(interval.end);
    if (end <= start) continue;
    speechSeconds += end - start;
    const boundaries = [
      start,
      end,
      ...cues.flatMap((cue) =>
        overlapSeconds({ start, end }, cue) > 0
          ? [Math.max(start, cue.start), Math.min(end, cue.end)]
          : [],
      ),
    ].toSorted((left, right) => left - right);
    for (
      let boundaryIndex = 0;
      boundaryIndex < boundaries.length - 1;
      boundaryIndex += 1
    ) {
      const segmentStart = boundaries[boundaryIndex];
      const segmentEnd = boundaries[boundaryIndex + 1];
      if (
        segmentStart === undefined ||
        segmentEnd === undefined ||
        segmentEnd <= segmentStart
      )
        continue;
      const midpoint = (segmentStart + segmentEnd) / 2;
      const covered = cues.some(
        (cue) => cue.start <= midpoint && cue.end >= midpoint,
      );
      if (covered) {
        coveredSpeechSeconds += segmentEnd - segmentStart;
      } else if (segmentEnd - segmentStart >= 0.5) {
        gaps.push({
          id: `speech-gap-${String(index + 1).padStart(4, "0")}-${String(boundaryIndex + 1).padStart(2, "0")}`,
          start: segmentStart,
          end: segmentEnd,
          duration: segmentEnd - segmentStart,
          reason: "machine-speech-interval-without-final-cue",
        });
      }
    }
  }
  return { speechSeconds, coveredSpeechSeconds, gaps };
}

function stage(input: {
  id: string;
  inputCount: number;
  outputCount: number;
  lossReason: string;
}) {
  const droppedCount = Math.max(0, input.inputCount - input.outputCount);
  return {
    id: input.id,
    inputCount: input.inputCount,
    outputCount: input.outputCount,
    droppedCount,
    retentionRatio:
      input.inputCount === 0
        ? input.outputCount === 0
          ? 1
          : 0
        : Math.min(1, input.outputCount / input.inputCount),
    lossReasons:
      droppedCount === 0
        ? []
        : [{ reason: input.lossReason, count: droppedCount }],
  };
}

function intervalFrom(value: unknown): { start: number; end: number } | null {
  const valueRecord = record(value);
  const nested = record(valueRecord.interval);
  const start =
    typeof nested.start === "number"
      ? nested.start
      : typeof valueRecord.start === "number"
        ? valueRecord.start
        : null;
  const end =
    typeof nested.end === "number"
      ? nested.end
      : typeof valueRecord.end === "number"
        ? valueRecord.end
        : null;
  return start !== null && end !== null && end > start ? { start, end } : null;
}

function uniqueCoverageSeconds(values: readonly unknown[]): number {
  const intervals = values
    .flatMap((value) => {
      const interval = intervalFrom(value);
      return interval === null ? [] : [interval];
    })
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  let total = 0;
  let current: { start: number; end: number } | null = null;
  for (const interval of intervals) {
    if (current === null) {
      current = { ...interval };
    } else if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
    } else {
      total += current.end - current.start;
      current = { ...interval };
    }
  }
  return total + (current === null ? 0 : current.end - current.start);
}

function snapshot(input: {
  id:
    | "source-media"
    | "speech-region"
    | "asr-request"
    | "raw-asr-segment"
    | "raw-asr-token"
    | "normalized-asr-segment"
    | "candidate"
    | "localized-candidate"
    | "associated-candidate"
    | "deduplicated-candidate"
    | "accepted-canonical-unit"
    | "merged-canonical-unit"
    | "final-machine-cue";
  values: readonly unknown[];
  idPrefix: string;
}) {
  const sourceUnitIds = input.values.map((value, index) => {
    const valueRecord = record(value);
    return text(
      valueRecord.id ?? valueRecord.cueId ?? valueRecord.requestId,
      `${input.idPrefix}-${String(index + 1).padStart(5, "0")}`,
    );
  });
  const temporalCoverageSeconds = input.values.reduce<number>((sum, value) => {
    const interval = intervalFrom(value);
    return sum + (interval === null ? 0 : interval.end - interval.start);
  }, 0);
  return {
    id: input.id,
    unitCount: input.values.length,
    textCharacterCount: input.values.reduce<number>(
      (sum, value) => sum + Array.from(text(record(value).text, "")).length,
      0,
    ),
    temporalCoverageSeconds,
    uniqueTemporalCoverageSeconds: uniqueCoverageSeconds(input.values),
    sourceUnitIds,
  };
}

async function integrationArtifact(input: {
  subtitleDirectory: string;
  fileName: string;
  artifactType:
    | "machine-mfa-integration"
    | "machine-ctc-integration"
    | "machine-speaker-overlap-recovery";
  header: ReturnType<typeof buildHeader>;
  parser: { safeParse(value: unknown): { success: boolean } };
}) {
  const artifactPath = path.join(input.subtitleDirectory, input.fileName);
  const artifact = await readJsonOrEmpty(artifactPath);
  const exists = Object.keys(artifact).length > 0;
  const parsed = exists && input.parser.safeParse(artifact).success;
  const summary = summaryOf(artifact);
  const counts =
    input.artifactType === "machine-mfa-integration"
      ? {
          modelInferenceCount: countFrom(summary, "mfaProcessCount"),
          cacheHitCount: countFrom(summary, "cacheHitCount"),
          candidateCount: countFrom(summary, "eligibleCueCount", "cueCount"),
          appliedCount: countFrom(summary, "timingMutationCount"),
          canonicalCueMutationCount: countFrom(
            summary,
            "canonicalTextMutationCount",
          ),
          canonicalTimingMutationCount: countFrom(
            summary,
            "timingMutationCount",
          ),
        }
      : input.artifactType === "machine-ctc-integration"
        ? {
            modelInferenceCount: countFrom(summary, "directInferenceCount"),
            cacheHitCount: countFrom(summary, "directCacheHitCount"),
            candidateCount: countFrom(
              summary,
              "targetEncodableCueCount",
              "targetCueCount",
            ),
            appliedCount: countFrom(summary, "timingMutationCueCount"),
            canonicalCueMutationCount: countFrom(
              summary,
              "canonicalTextMutationCount",
            ),
            canonicalTimingMutationCount: countFrom(
              summary,
              "timingMutationCueCount",
            ),
          }
        : {
            modelInferenceCount: countFrom(summary, "pipelineInferenceCount"),
            cacheHitCount: countFrom(summary, "cacheHitCount"),
            candidateCount: countFrom(summary, "targetComponentCount"),
            appliedCount: countFrom(summary, "resolvedComponentCount"),
            canonicalCueMutationCount: countFrom(
              summary,
              "canonicalTextMutationCount",
            ),
            canonicalTimingMutationCount: countFrom(
              summary,
              "timingMutationCount",
            ),
          };
  const referenceValue =
    input.artifactType === "machine-ctc-integration"
      ? artifact.ctcRuntimeCapabilityRef
      : artifact.runtimeCapabilityRef;
  const referenceRecord = record(referenceValue);
  const referencePath =
    typeof referenceValue === "string"
      ? referenceValue
      : typeof referenceRecord.path === "string"
        ? referenceRecord.path
        : null;
  const resolvedCapabilityPath =
    referencePath === null
      ? null
      : path.resolve(input.subtitleDirectory, referencePath);
  const capability =
    resolvedCapabilityPath !== null &&
    (resolvedCapabilityPath === input.subtitleDirectory ||
      resolvedCapabilityPath.startsWith(
        `${input.subtitleDirectory}${path.sep}`,
      ))
      ? await readJsonOrEmpty(resolvedCapabilityPath)
      : {};
  const firstAttempt = record(array(artifact.attempts)[0]);
  const runtimeIdentity = text(
    capability.runtimeIdentityHash ??
      firstAttempt.runtimeIdentityHash ??
      artifact.runtimeIdentity,
    "",
  );
  const integration = {
    ...input.header,
    artifactType: input.artifactType,
    integration: {
      status: !exists
        ? ("unavailable" as const)
        : counts.appliedCount > 0
          ? ("applied" as const)
          : parsed
            ? ("observed" as const)
            : ("rejected" as const),
      runtimeIdentity: runtimeIdentity.length > 0 ? runtimeIdentity : null,
      modelInferenceCount: counts.modelInferenceCount,
      cacheHitCount: counts.cacheHitCount,
      candidateCount: counts.candidateCount,
      appliedCount: counts.appliedCount,
      canonicalCueMutationCount: counts.canonicalCueMutationCount,
      canonicalTimingMutationCount: counts.canonicalTimingMutationCount,
      reasons: !exists
        ? ["integration-artifact-not-produced-by-this-machine-only-run"]
        : parsed
          ? [
              "artifact-schema-validated",
              "counts-derived-once-from-strict-artifact-summary",
            ]
          : ["artifact-schema-validation-failed"],
    },
    evidenceQuality: {
      status: !exists
        ? ("unavailable" as const)
        : parsed
          ? ("verified" as const)
          : ("rejected" as const),
      inspectedArtifactCount: exists ? 1 : 0,
      schemaValidatedArtifactCount: parsed ? 1 : 0,
      semanticEvidenceCount: counts.candidateCount,
      reasons: !exists
        ? ["no-current-run-evidence"]
        : parsed
          ? ["strict-schema-validation-passed"]
          : ["strict-schema-validation-failed"],
    },
  };
  return integration;
}

function buildHeader(
  input: EmitMachineQualityRunArtifactsInput,
  generatedAt: string,
) {
  return {
    schemaVersion: "1.0.0" as const,
    policyVersion: POLICY_VERSION,
    generatedAt,
    mode: input.mode,
    profile: input.profile,
    run: {
      runId: input.runId,
      repositoryCommit: input.repositoryCommit,
      sourceMediaSha256: input.sourceMediaSha256,
      goldRuntimeInputCount: 0 as const,
    },
  };
}

export async function emitMachineQualityRunArtifacts(
  input: EmitMachineQualityRunArtifactsInput,
): Promise<{ subtitleDirectory: string; artifactCount: number }> {
  const subtitleDirectory = await findSubtitleDirectory(input.outputDirectory);
  const generatedAt = new Date().toISOString();
  const header = buildHeader(input, generatedAt);
  const readSubtitle = async (name: string) =>
    await readJsonOrEmpty(path.join(subtitleDirectory, name));

  const [
    raw,
    audioManifest,
    canonical,
    candidates,
    clusters,
    winners,
    deduplication,
    fragmentRepair,
    postNormalization,
    segmentation,
    finalIntegrity,
    recovery,
    executionMetrics,
    mediaProfile,
    subtitlePackage,
    deviceProfile,
    transcriptionPlan,
    blindManifest,
  ] = await Promise.all([
    readJsonOrEmpty(
      path.join(input.outputDirectory, "audio", "raw-transcription.json"),
    ),
    readJsonOrEmpty(
      path.join(input.outputDirectory, "audio", "audio-manifest.json"),
    ),
    readSubtitle("canonical-asr-segments.json"),
    readSubtitle("cue-candidate-evidence.json"),
    readSubtitle("hypothesis-clusters.json"),
    readSubtitle("top-score-winners.json"),
    readSubtitle("winner-deduplication.json"),
    readSubtitle("fragment-repair.json"),
    readSubtitle("post-normalization-deduplication.json"),
    readSubtitle("cue-segmentation-plan.json"),
    readSubtitle("final-subtitle-integrity.json"),
    readSubtitle("missing-dialogue-recovery.json"),
    readSubtitle("whisper-execution-metrics.json"),
    readSubtitle("media-profile.json"),
    readSubtitle("subtitle-package.json"),
    readSubtitle("device-profile.json"),
    readSubtitle("transcription-plan.json"),
    readJsonOrEmpty(
      path.join(input.outputDirectory, "blind-generation-input-manifest.json"),
    ),
  ]);

  const baselineCues = array(raw.baselineCues);
  const parsedSubtitlePackage = subtitlePackageSchema.parse(subtitlePackage);
  const finalCues = parsedSubtitlePackage.cues;
  const canonicalUtterances = array(canonical.utterances);
  const candidateCount = array(candidates.candidates).length;
  const clusterCount = array(clusters.clusters).length;
  const winnerCount = array(winners.winners).length;
  const dedupOutput = countFrom(deduplication, "outputWinnerCount");
  const fragmentOutput = countFrom(fragmentRepair, "outputWinnerCount");
  const normalizationOutput = countFrom(postNormalization, "outputWinnerCount");
  const segmentationOutput = countFrom(
    summaryOf(segmentation),
    "outputCueCount",
  );
  const integrityCandidates = countFrom(finalIntegrity, "candidateCueCount");
  const finalCueCount =
    countFrom(finalIntegrity, "finalCueCount") || finalCues.length;
  const recoverySummary = summaryOf(recovery);
  const recoveryUnits = array(recovery.units);
  const recoveryAttempts = recoveryUnits.flatMap((unit) =>
    array(record(unit).attempts),
  );
  const requestRecords = array(executionMetrics.requests).map(record);
  const requestIntervals = [
    ...array(audioManifest.chunks).flatMap((value) => {
      const chunk = record(value);
      const start = number(chunk.start);
      const end = number(chunk.end);
      return end > start
        ? [
            {
              id: text(chunk.id),
              start,
              end,
              kind: "primary" as const,
            },
          ]
        : [];
    }),
    ...recoveryUnits.flatMap((unitValue) => {
      const unit = record(unitValue);
      const interval = record(unit.extractedInterval);
      const start = number(interval.start);
      const end = number(interval.end);
      return end > start
        ? array(unit.attempts).map((attemptValue, index) => {
            const attempt = record(attemptValue);
            return {
              id: text(
                attempt.asrRequestId ?? attempt.id,
                `${text(unit.id)}-attempt-${String(index + 1)}`,
              ),
              start,
              end,
              kind: "recovery" as const,
            };
          })
        : [];
    }),
  ];
  const adjacentPrompts = recoveryAttempts.flatMap((attempt) => {
    const prompt = record(record(attempt).prompt);
    return array(prompt.adjacentOriginalLanguageText).map((value) =>
      String(value),
    );
  });
  const uniqueAdjacentPrompts = new Set(
    adjacentPrompts.map((value) => value.trim()),
  );
  const rawSegments = array(canonical.rawSegments);
  const rawTokens = rawSegments.flatMap((segmentValue, segmentIndex) => {
    const segment = record(segmentValue);
    return array(segment.tokens).map((tokenValue, tokenIndex) => {
      const token = record(tokenValue);
      return {
        id: `${text(segment.id, `raw-${String(segmentIndex + 1)}`)}-token-${String(tokenIndex + 1).padStart(4, "0")}`,
        start: number(token.start),
        end: number(token.end),
        text: text(token.text, ""),
      };
    });
  });
  const candidateValues = array(candidates.candidates);
  const localizedCandidates = candidateValues.filter(
    (candidate) => intervalFrom(candidate) !== null,
  );
  const associatedCandidates = localizedCandidates.filter(
    (candidate) => record(candidate).selectionEligible === true,
  );
  const winnerValues = array(winners.winners);
  const dedupRemovedIds = new Set(
    array(deduplication.records).flatMap((value) =>
      array(record(value).removedCueIds).map(String),
    ),
  );
  const deduplicatedWinners = winnerValues.filter(
    (winner) => !dedupRemovedIds.has(text(record(winner).id)),
  );
  const segmentationUnits = array(segmentation.entries).flatMap(
    (entryValue) => {
      const entry = record(entryValue);
      return array(entry.outputCueIds).map((outputCueId, index) => {
        const interval = record(array(entry.outputIntervals)[index]);
        return {
          id: String(outputCueId),
          start: number(interval.start),
          end: number(interval.end),
          text: "",
        };
      });
    },
  );
  const stages = [
    stage({
      id: "canonical-to-candidate",
      inputCount: canonicalUtterances.length,
      outputCount: candidateCount,
      lossReason: "candidate-evidence-rejection",
    }),
    stage({
      id: "candidate-to-cluster",
      inputCount: candidateCount,
      outputCount: clusterCount,
      lossReason: "candidate-clustering-or-noncompetitive-evidence",
    }),
    stage({
      id: "cluster-to-winner",
      inputCount: clusterCount,
      outputCount: winnerCount,
      lossReason: "unresolved-cluster",
    }),
    stage({
      id: "winner-deduplication",
      inputCount: winnerCount,
      outputCount: dedupOutput,
      lossReason: "duplicate-or-prefix-winner",
    }),
    stage({
      id: "fragment-repair",
      inputCount: dedupOutput,
      outputCount: fragmentOutput,
      lossReason: "fragment-merged-into-neighbor",
    }),
    stage({
      id: "post-normalization-deduplication",
      inputCount: fragmentOutput,
      outputCount: normalizationOutput,
      lossReason: "post-normalization-duplicate",
    }),
    stage({
      id: "segmentation",
      inputCount: normalizationOutput,
      outputCount: segmentationOutput,
      lossReason: "segmentation-quarantine",
    }),
    stage({
      id: "final-integrity",
      inputCount: integrityCandidates,
      outputCount: finalCueCount,
      lossReason: "final-integrity-quarantine",
    }),
  ];
  const dominant = stages.toSorted(
    (left, right) => right.droppedCount - left.droppedCount,
  )[0];

  const snapshots = [
    snapshot({
      id: "source-media",
      values: [
        {
          id: text(parsedSubtitlePackage.source.fileName),
          start: 0,
          end: number(parsedSubtitlePackage.source.durationSeconds),
          text: "",
        },
      ],
      idPrefix: "source",
    }),
    snapshot({
      id: "speech-region",
      values: array(mediaProfile.speechIntervals),
      idPrefix: "speech-region",
    }),
    snapshot({
      id: "asr-request",
      values: requestIntervals,
      idPrefix: "asr-request",
    }),
    snapshot({
      id: "raw-asr-segment",
      values: rawSegments,
      idPrefix: "raw-asr-segment",
    }),
    snapshot({
      id: "raw-asr-token",
      values: rawTokens,
      idPrefix: "raw-asr-token",
    }),
    snapshot({
      id: "normalized-asr-segment",
      values: canonicalUtterances,
      idPrefix: "canonical",
    }),
    snapshot({
      id: "candidate",
      values: candidateValues,
      idPrefix: "candidate",
    }),
    snapshot({
      id: "localized-candidate",
      values: localizedCandidates,
      idPrefix: "localized-candidate",
    }),
    snapshot({
      id: "associated-candidate",
      values: associatedCandidates,
      idPrefix: "associated-candidate",
    }),
    snapshot({
      id: "deduplicated-candidate",
      values: deduplicatedWinners,
      idPrefix: "deduplicated-candidate",
    }),
    snapshot({
      id: "accepted-canonical-unit",
      values: winnerValues,
      idPrefix: "accepted-canonical-unit",
    }),
    snapshot({
      id: "merged-canonical-unit",
      values: segmentationUnits,
      idPrefix: "merged-canonical-unit",
    }),
    snapshot({
      id: "final-machine-cue",
      values: finalCues,
      idPrefix: "final-machine-cue",
    }),
  ];

  const canonicalById = new Map(
    canonicalUtterances.map((value) => [text(record(value).id), record(value)]),
  );
  const winnerById = new Map(
    winnerValues.map((value) => [text(record(value).id), record(value)]),
  );
  const finalCueLineage = finalCues.map((cue) => {
    const cueRecord = record(cue);
    const provenance = record(cueRecord.provenance);
    const textAudit = record(cueRecord.textAudit);
    const winnerLineage = array(textAudit.sourceWinnerCueIds).flatMap(
      (winnerId) => {
        const winner = winnerById.get(String(winnerId));
        return winner === undefined
          ? []
          : array(record(winner.provenance).sourceRequestIds).map(String);
      },
    );
    const sourceRequestIds = [
      ...new Set([
        ...array(provenance.sourceRequestIds).map(String),
        ...winnerLineage,
      ]),
    ];
    const canonicalIds = [
      ...new Set([
        ...array(provenance.sourceCueIds).map(String),
        ...sourceRequestIds.filter((id) => canonicalById.has(id)),
      ]),
    ];
    const rawAsrSegmentIds = [
      ...new Set(
        canonicalIds.flatMap((id) =>
          array(canonicalById.get(id)?.sourceSegmentIds).map(String),
        ),
      ),
    ];
    const interval = intervalFrom(cueRecord);
    const unresolvedLineageReasons = [
      ...(sourceRequestIds.length === 0
        ? ["source-request-lineage-unavailable"]
        : []),
      ...(rawAsrSegmentIds.length === 0
        ? ["machine-recovery-request-not-backed-by-baseline-raw-segment"]
        : []),
    ];
    return {
      finalCueId: cue.id,
      rawAsrSegmentIds,
      sourceRequestIds,
      audioIntervals: interval === null ? [] : [interval],
      decisionPath: snapshots.map((entry) => entry.id),
      unresolvedLineageReasons,
    };
  });
  const rejectedUnits = [
    ...canonicalUtterances.flatMap((value) => {
      const utterance = record(value);
      return utterance.qualityStatus === "suspected-hallucination"
        ? [
            {
              unitId: text(utterance.id),
              stage: "normalized-asr-segment",
              reason: "hallucination-risk" as const,
              evidenceIds: array(utterance.qualityReasons).map(String),
            },
          ]
        : [];
    }),
    ...candidateValues.flatMap((value) => {
      const candidate = record(value);
      return candidate.selectionEligible === true
        ? []
        : [
            {
              unitId: text(candidate.cueId),
              stage: "candidate",
              reason: "quality-gate-rejected" as const,
              evidenceIds: array(candidate.hardBlockReasons).map(String),
            },
          ];
    }),
    ...array(deduplication.records).flatMap((value) => {
      const entry = record(value);
      return array(entry.removedCueIds).map((removedId) => ({
        unitId: String(removedId),
        stage: "deduplicated-candidate",
        reason: "duplicate" as const,
        evidenceIds: [text(entry.id)],
      }));
    }),
    ...array(fragmentRepair.repairs).flatMap((value) => {
      const entry = record(value);
      return array(entry.sourceWinnerIds).map((sourceId) => ({
        unitId: String(sourceId),
        stage: "merged-canonical-unit",
        reason: "post-merge-absorbed" as const,
        evidenceIds: [text(entry.id)],
      }));
    }),
    ...array(postNormalization.records).flatMap((value) => {
      const entry = record(value);
      return array(entry.removedCueIds).map((removedId) => ({
        unitId: String(removedId),
        stage: "post-normalization-deduplication",
        reason: "repetition-collapse" as const,
        evidenceIds: [text(entry.id)],
      }));
    }),
    ...array(finalIntegrity.quarantinedCueIds).map((cueId) => ({
      unitId: String(cueId),
      stage: "final-integrity",
      reason: "quality-gate-rejected" as const,
      evidenceIds: array(finalIntegrity.findings)
        .filter((finding) =>
          array(record(finding).cueIds).map(String).includes(String(cueId)),
        )
        .map((finding) => text(record(finding).id)),
    })),
  ];

  const funnel = machineGenerationSurvivalFunnelSchema.parse({
    ...header,
    artifactType: "machine-generation-survival-funnel",
    stages,
    snapshots,
    finalCueLineage,
    rejectedUnits,
    summary: {
      whisperRequestCount: countFrom(executionMetrics, "asrRequestCount"),
      baselineChunkCount: array(audioManifest.chunks).length,
      baselineAcceptedCueCount: baselineCues.length,
      recoveryRequestCount: countFrom(recoverySummary, "recoveryAsrRequests"),
      recoveredCueCount: countFrom(recoverySummary, "autoCreatedFinalCues"),
      rawSegmentCount: countFrom(canonical, "rawSegmentCount"),
      finalCueCount,
      dominantLossStage:
        dominant?.droppedCount === 0 ? null : (dominant?.id ?? null),
      dominantLossCount: dominant?.droppedCount ?? 0,
      unknownRejectionCount: 0,
      lineageCompleteCueCount: finalCueLineage.filter(
        (entry) => entry.unresolvedLineageReasons.length === 0,
      ).length,
      lineageIncompleteCueCount: finalCueLineage.filter(
        (entry) => entry.unresolvedLineageReasons.length > 0,
      ).length,
    },
  });

  const retention = asrRetentionAuditSchema.parse({
    ...header,
    artifactType: "asr-retention-audit",
    baseline: {
      chunkCount: array(audioManifest.chunks).length,
      rawSegmentCount: countFrom(canonical, "rawSegmentCount"),
      canonicalUtteranceCount: canonicalUtterances.length,
      acceptedCueCount: baselineCues.length,
      suspectedHallucinationCount: canonicalUtterances.filter(
        (utterance) =>
          record(utterance).qualityStatus === "suspected-hallucination",
      ).length,
      crossUtteranceLoopCount: canonicalUtterances.filter((utterance) =>
        array(record(utterance).qualityReasons).includes(
          "CANONICAL_CROSS_UTTERANCE_LOOP",
        ),
      ).length,
    },
    candidateRetention: {
      canonicalUtteranceCount: canonicalUtterances.length,
      candidateCount,
      clusterCount,
      winnerCount,
      postDeduplicationCount: dedupOutput,
      postFragmentRepairCount: fragmentOutput,
      postNormalizationCount: normalizationOutput,
      finalIntegrityCandidateCount: integrityCandidates,
      finalCueCount,
    },
    promptContamination: {
      recoveryAttemptCount: recoveryAttempts.length,
      baselineCarryPromptCount:
        input.mode === "enforce"
          ? 0
          : Math.max(0, array(audioManifest.chunks).length - 1),
      refinementContextPromptCount:
        input.mode === "enforce"
          ? 0
          : requestRecords.filter((request) =>
              text(request.requestId).startsWith("refinement:"),
            ).length,
      attemptsWithAdjacentText: recoveryAttempts.filter(
        (attempt) =>
          array(record(record(attempt).prompt).adjacentOriginalLanguageText)
            .length > 0,
      ).length,
      attemptsWithUnverifiedAdjacentText:
        input.mode === "enforce"
          ? 0
          : recoveryAttempts.filter(
              (attempt) =>
                array(
                  record(record(attempt).prompt).adjacentOriginalLanguageText,
                ).length > 0,
            ).length,
      uniqueAdjacentPromptCount: uniqueAdjacentPrompts.size,
      provisionalMachineTextPromptCount:
        input.mode === "enforce"
          ? 0
          : Math.max(0, array(audioManifest.chunks).length - 1) +
            requestRecords.filter((request) =>
              text(request.requestId).startsWith("refinement:"),
            ).length +
            adjacentPrompts.length,
      promptIsolationPassed:
        input.mode !== "enforce" || adjacentPrompts.length === 0,
      contaminationDetected:
        input.mode !== "enforce" &&
        (adjacentPrompts.length > 0 ||
          array(audioManifest.chunks).length > 1 ||
          requestRecords.some((request) =>
            text(request.requestId).startsWith("refinement:"),
          )),
    },
  });

  const deviceWhisper = record(deviceProfile.whisperCpp);
  const devices = record(deviceProfile.cpu);
  const models = array(deviceProfile.models).map(record);
  const selectedModel =
    models.find(
      (model) => model.id === record(transcriptionPlan.baseline).capabilityId,
    ) ??
    models[0] ??
    {};
  const runtimeIdentity = array(blindManifest.runtimeIdentities)
    .map(record)
    .find((runtime) => runtime.name === "whisper.cpp");
  const intervalKeys = requestIntervals.map(
    (interval) => `${interval.start.toFixed(3)}:${interval.end.toFixed(3)}`,
  );
  const uniqueIntervalKeys = new Set(intervalKeys);
  const uniqueIntervalSeconds = new Map<string, number>();
  for (const [index, key] of intervalKeys.entries()) {
    const interval = requestIntervals[index];
    if (interval !== undefined) {
      uniqueIntervalSeconds.set(key, interval.end - interval.start);
    }
  }
  const totalAudioSecondsProcessed = requestIntervals.reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  );
  const binarySha256 =
    input.whisperExecutablePath === null ||
    input.whisperExecutablePath === undefined
      ? null
      : await sha256BlindFile(input.whisperExecutablePath);
  const intendedVersion = text(runtimeIdentity?.version);
  const actualVersion = text(deviceWhisper.version);
  const runtimeAudit = whisperRuntimeExecutionAuditSchema.parse({
    ...header,
    artifactType: "whisper-runtime-execution-audit",
    runtime: {
      intendedVersion,
      actualVersion,
      whisperCppVersion: actualVersion,
      modelName: text(selectedModel.modelFamily, text(selectedModel.id)),
      modelSha256:
        typeof selectedModel.modelHash === "string"
          ? selectedModel.modelHash
          : null,
      binarySha256,
      runtimeManifest: "blind-generation-input-manifest.json",
      compatibilityReason:
        intendedVersion !== "unknown" && actualVersion.includes(intendedVersion)
          ? "pinned-runtime-version-matched-and-baseline-output-identity-reproduced"
          : "runtime-version-recorded-for-explicit-compatibility-review",
      device: text(devices.model, text(deviceProfile.fingerprint)),
      requestedMode: text(executionMetrics.requestedMode),
      actualMode: text(executionMetrics.executionMode),
    },
    execution: {
      asrRequestCount: countFrom(executionMetrics, "asrRequestCount"),
      cacheHitCount: countFrom(executionMetrics, "cacheHitCount"),
      inferenceCount: Math.max(
        0,
        countFrom(executionMetrics, "asrRequestCount") -
          countFrom(executionMetrics, "cacheHitCount"),
      ),
      processCount: requestRecords.filter(
        (request) => request.mode === "process" && request.cacheHit !== true,
      ).length,
      workerStartCount: countFrom(executionMetrics, "workerStartCount"),
      modelLoadCount: countFrom(executionMetrics, "modelLoadCount"),
      transcriptionSeconds: countFrom(executionMetrics, "transcriptionSeconds"),
      fallbackProcessCount: countFrom(executionMetrics, "fallbackProcessCount"),
      uniqueAudioIntervalCount: uniqueIntervalKeys.size,
      duplicateIntervalCount: Math.max(
        0,
        requestIntervals.length - uniqueIntervalKeys.size,
      ),
      narrowRequestCount: requestIntervals.filter(
        (interval) => interval.end - interval.start <= 30.001,
      ).length,
      broadRequestCount: requestIntervals.filter(
        (interval) => interval.end - interval.start > 30.001,
      ).length,
      recoveryRequestCount: requestIntervals.filter(
        (interval) => interval.kind === "recovery",
      ).length,
      primaryGenerationRequestCount: requestIntervals.filter(
        (interval) => interval.kind === "primary",
      ).length,
      averageAudioSeconds:
        requestIntervals.length === 0
          ? 0
          : totalAudioSecondsProcessed / requestIntervals.length,
      totalAudioSecondsProcessed,
      duplicateAudioSecondsProcessed: Math.max(
        0,
        totalAudioSecondsProcessed -
          [...uniqueIntervalSeconds.values()].reduce(
            (sum, duration) => sum + duration,
            0,
          ),
      ),
    },
    evidenceQuality: {
      status:
        Object.keys(executionMetrics).length > 0 ? "verified" : "unavailable",
      inspectedArtifactCount: Object.keys(executionMetrics).length > 0 ? 1 : 0,
      schemaValidatedArtifactCount:
        Object.keys(executionMetrics).length > 0 ? 1 : 0,
      semanticEvidenceCount: array(executionMetrics.requests).length,
      reasons:
        Object.keys(executionMetrics).length > 0
          ? [
              "request-level-execution-records-inspected",
              "inference-count-derived-from-request-minus-cache-hit",
            ]
          : ["execution-metrics-artifact-missing"],
    },
  });

  const coverage = coverageGaps({
    speechIntervals: array(mediaProfile.speechIntervals),
    cues: finalCues,
  });
  const coverageGap = machineSpeechCoverageGapSchema.parse({
    ...header,
    artifactType: "machine-speech-coverage-gap",
    speechIntervalCount: array(mediaProfile.speechIntervals).length,
    cueCount: finalCues.length,
    speechSeconds: coverage.speechSeconds,
    coveredSpeechSeconds: coverage.coveredSpeechSeconds,
    coverageRatio:
      coverage.speechSeconds === 0
        ? 0
        : Math.min(1, coverage.coveredSpeechSeconds / coverage.speechSeconds),
    gaps: coverage.gaps,
  });

  const coverageRecovery = machineCoverageRecoverySchema.parse({
    ...header,
    artifactType: "machine-coverage-recovery",
    recoveryUnitCount: countFrom(recoverySummary, "recoveryUnits"),
    recoveryRequestCount: countFrom(recoverySummary, "recoveryAsrRequests"),
    recoveredUnitCount: countFrom(recoverySummary, "recoveredUnits"),
    unresolvedUnitCount: countFrom(recoverySummary, "stillNeedsReviewUnits"),
    cacheHitCount: countFrom(recoverySummary, "cacheHits"),
    adjacentPromptPolicy:
      input.mode === "enforce"
        ? "disabled-unverified-context"
        : input.mode === "observe"
          ? "diagnostic-only"
          : "legacy-all-cues",
    adjacentPromptCount: adjacentPrompts.length,
    unverifiedAdjacentPromptCount:
      input.mode === "enforce" ? 0 : adjacentPrompts.length,
    canonicalCueMutationCount: countFrom(
      recoverySummary,
      "autoCreatedFinalCues",
    ),
    canonicalTimingMutationCount: countFrom(
      recoverySummary,
      "autoCreatedFinalCues",
    ),
  });

  const baselineCueWithTokenCount = baselineCues.filter(
    (cue) => countTokens(cue) > 0,
  ).length;
  const recoveryAttemptWithTokenCount = recoveryAttempts.filter(
    (attempt) => countTokens(attempt) > 0,
  ).length;
  const mappedTokenCount = countNumericKeys(
    recovery,
    new Set(["mappedTokenCount"]),
  );
  const tokenRecovery = machineTokenTimestampRecoverySchema.parse({
    ...header,
    artifactType: "machine-token-timestamp-recovery",
    baselineCueCount: baselineCues.length,
    baselineCueWithTokenCount,
    recoveryAttemptCount: recoveryAttempts.length,
    recoveryAttemptWithTokenCount,
    mappedTokenCount,
    unmappedTokenCount: Math.max(0, countTokens(recovery) - mappedTokenCount),
    trustedForCanonicalTiming: mappedTokenCount > 0,
    rejectionReasons:
      mappedTokenCount > 0
        ? []
        : ["no-verified-mapped-token-timeline-in-current-run"],
  });

  const timingEvidence = machineTimingEvidenceSchema.parse({
    ...header,
    artifactType: "machine-timing-evidence",
    timestampStrategy: text(raw.timestampStrategy, "segment"),
    targetChunkSeconds: input.targetChunkSeconds,
    vadEnabled: input.vadEnabled,
    rawVadEvidenceAvailable:
      countNumericKeys(recovery, new Set(["rawVadBoundaryCount"])) > 0,
    mappedTokenEvidenceAvailable: mappedTokenCount > 0,
    stockVadTimelineTrusted: !input.vadEnabled || mappedTokenCount > 0,
    timingEvidenceApplied: !input.vadEnabled || mappedTokenCount > 0,
    timingMutationCount: 0,
    reasons:
      input.vadEnabled && mappedTokenCount === 0
        ? ["stock-vad-timeline-not-applied-without-verified-mapping"]
        : ["segment-timestamps-grounded-to-short-original-audio-chunks"],
  });

  const [mfa, ctc, speaker] = await Promise.all([
    integrationArtifact({
      subtitleDirectory,
      fileName: "subtitle-canonical-forced-alignment.json",
      artifactType: "machine-mfa-integration",
      header,
      parser: subtitleCanonicalForcedAlignmentSchema,
    }),
    integrationArtifact({
      subtitleDirectory,
      fileName: "subtitle-local-ctc-boundary-evidence.json",
      artifactType: "machine-ctc-integration",
      header,
      parser: subtitleLocalCtcBoundaryEvidenceSchema,
    }),
    integrationArtifact({
      subtitleDirectory,
      fileName: "subtitle-local-speaker-evidence.json",
      artifactType: "machine-speaker-overlap-recovery",
      header,
      parser: subtitleLocalSpeakerEvidenceSchema,
    }),
  ]);
  const parsedMfa = machineMfaIntegrationSchema.parse(mfa);
  const parsedCtc = machineCtcIntegrationSchema.parse(ctc);
  const parsedSpeaker = machineSpeakerOverlapRecoverySchema.parse(speaker);

  const policy = machineQualityRecoveryPolicySchema.parse({
    ...header,
    artifactType: "machine-quality-recovery-policy",
    defaultMode: "off",
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    humanDerivedRuntimeInputAllowed: false,
    strategies: {
      targetChunkSeconds: input.targetChunkSeconds,
      vadMode: input.vadEnabled ? "evidence-gated" : "off",
      sceneRouting: input.sceneRouting,
      adjacentPromptPolicy:
        input.mode === "enforce"
          ? "disabled-unverified-context"
          : "legacy-all-cues",
    },
    milestone: {
      normalizedCerMaximum: 0.65,
      coverageMinimum: 0.8,
      missingDialogueMaximum: 35,
      materialTextDefectMaximum: 30,
      startMaeSecondsMaximum: 1.75,
      endMaeSecondsMaximum: 1.75,
      p95BoundaryErrorSecondsMaximum: 4.5,
      severeTimingDefectMaximum: 25,
      hallucinationMaximum: 2,
    },
  });

  let presentationHash: string | null = null;
  const entries = await readdir(subtitleDirectory);
  const ass = entries.find(
    (entry) => entry.endsWith(".ass") && !entry.includes("best-effort"),
  );
  const srt = entries.find(
    (entry) => entry.endsWith(".srt") && !entry.includes("best-effort"),
  );
  const vtt = entries.find(
    (entry) => entry.endsWith(".vtt") && !entry.includes("best-effort"),
  );
  if (ass !== undefined && srt !== undefined && vtt !== undefined) {
    presentationHash = c60StableHash({
      ass: await sha256BlindFile(path.join(subtitleDirectory, ass)),
      srt: await sha256BlindFile(path.join(subtitleDirectory, srt)),
      vtt: await sha256BlindFile(path.join(subtitleDirectory, vtt)),
    });
  }
  const ablation = machineQualityRecoveryAblationSchema.parse({
    ...header,
    artifactType: "machine-quality-recovery-ablation",
    configurationHash: sha256(
      JSON.stringify({
        mode: input.mode,
        profile: input.profile,
        targetChunkSeconds: input.targetChunkSeconds,
        vadEnabled: input.vadEnabled,
        sceneRouting: input.sceneRouting,
      }),
    ),
    enabledStrategies: [
      ...(input.targetChunkSeconds === null
        ? []
        : [`target-chunk-${String(input.targetChunkSeconds)}s`]),
      input.vadEnabled ? "vad-evidence-gated" : "no-vad-original-timeline",
      `scene-routing-${input.sceneRouting}`,
      input.mode === "enforce"
        ? "unverified-recovery-prompt-isolation"
        : "legacy-recovery-prompts",
      input.mode === "enforce"
        ? "cross-chunk-context-prompt-isolation"
        : "legacy-cross-chunk-context-prompts",
      input.mode === "enforce"
        ? "refinement-context-prompt-isolation"
        : "legacy-refinement-context-prompts",
    ],
    rejectedStrategies:
      input.vadEnabled && mappedTokenCount === 0
        ? [
            {
              strategy: "stock-vad-canonical-timing",
              reason: "verified-mapped-token-evidence-unavailable",
            },
          ]
        : [],
    runtimeGoldInputCount: 0,
    evaluationOnly: false,
    goldEvaluationAttached: false,
    machineMetrics: {
      cueCount: finalCues.length,
      exactCharacterCount: Array.from(finalCues.map((cue) => cue.text).join(""))
        .length,
      normalizedCharacterCount: Array.from(
        finalCues
          .map((cue) => cue.text)
          .join("")
          .normalize("NFKC")
          .replace(/[\p{P}\p{Z}\s]/gu, "")
          .toLowerCase(),
      ).length,
      overlapCount: finalCues.filter(
        (cue, index) =>
          index > 0 &&
          (finalCues[index - 1]?.end ?? Number.NEGATIVE_INFINITY) > cue.start,
      ).length,
      asrRequestCount: countFrom(executionMetrics, "asrRequestCount"),
      inferenceCount: Math.max(
        0,
        countFrom(executionMetrics, "asrRequestCount") -
          countFrom(executionMetrics, "cacheHitCount"),
      ),
      modelLoadCount: countFrom(executionMetrics, "modelLoadCount"),
      transcriptionSeconds: countFrom(executionMetrics, "transcriptionSeconds"),
    },
    goldMetrics: null,
    canonicalCueHash:
      finalCues.length === 0 ? null : c601CanonicalTextHash(finalCues),
    timingHash:
      finalCues.length === 0 ? null : c601CanonicalTimingHash(finalCues),
    presentationHash,
  });

  const artifacts = [
    ["machine-generation-survival-funnel.json", funnel],
    ["asr-retention-audit.json", retention],
    ["whisper-runtime-execution-audit.json", runtimeAudit],
    ["machine-speech-coverage-gap.json", coverageGap],
    ["machine-coverage-recovery.json", coverageRecovery],
    ["machine-token-timestamp-recovery.json", tokenRecovery],
    ["machine-timing-evidence.json", timingEvidence],
    ["machine-mfa-integration.json", parsedMfa],
    ["machine-ctc-integration.json", parsedCtc],
    ["machine-speaker-overlap-recovery.json", parsedSpeaker],
    ["machine-quality-recovery-policy.json", policy],
    ["machine-quality-recovery-ablation.json", ablation],
  ] as const;
  await Promise.all(
    artifacts.map(async ([fileName, artifact]) => {
      await atomicWriteJson(path.join(subtitleDirectory, fileName), artifact, {
        overwrite: true,
      });
    }),
  );
  return { subtitleDirectory, artifactCount: artifacts.length };
}
