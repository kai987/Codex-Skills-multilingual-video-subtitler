import {
  ctcVariantEvidenceSchema,
  machineTextVariantAcousticVerificationSchema,
  type AcousticProjection,
  type C6014Mode,
  type CtcAlignmentAttempt,
  type CtcVariantEvidence,
  type MachineTextVariantAcousticVerification,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface AcousticVariantInput {
  variantId: string;
  displayText: string;
  projection: AcousticProjection;
  attempts: readonly CtcAlignmentAttempt[];
}

export interface AcousticEventVerificationInput {
  eventId: string;
  audioEvidenceId: string;
  audioInterval: { start: number; end: number };
  audioSha256: string;
  variants: readonly AcousticVariantInput[];
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function attemptMonotonic(attempt: CtcAlignmentAttempt): boolean {
  return attempt.tokenSpans.every(
    (span, index, spans) =>
      span.endFrameExclusive > span.startFrame &&
      (index === 0 ||
        span.startFrame >= (spans[index - 1]?.endFrameExclusive ?? 0)),
  );
}

function bestAttempt(
  attempts: readonly CtcAlignmentAttempt[],
): CtcAlignmentAttempt | null {
  const valid = attempts.filter(
    (attempt) =>
      attempt.pathStatus === "success" &&
      attempt.pathExists &&
      attempt.target.targetEncodable,
  );
  return (
    valid.toSorted((left, right) => {
      const leftEdge =
        Number(left.startPinnedToWindowEdge) +
        Number(left.endPinnedToWindowEdge);
      const rightEdge =
        Number(right.startPinnedToWindowEdge) +
        Number(right.endPinnedToWindowEdge);
      if (leftEdge !== rightEdge) return leftEdge - rightEdge;
      const leftCost = -(left.normalizedPathLogScore ?? -Infinity);
      const rightCost = -(right.normalizedPathLogScore ?? -Infinity);
      if (leftCost !== rightCost) return leftCost - rightCost;
      return left.attemptId.localeCompare(right.attemptId);
    })[0] ?? null
  );
}

function buildEvidence(input: {
  variant: AcousticVariantInput;
  audioInterval: { start: number; end: number };
}): CtcVariantEvidence {
  const attempt = bestAttempt(input.variant.attempts);
  const targetUnitCount =
    attempt?.target.tokenIds.length ??
    Array.from(input.variant.projection.projectionText).length;
  const unknownCount = attempt?.target.unknownTokenCount ?? targetUnitCount;
  const unsupportedUnitRatio =
    targetUnitCount === 0 ? 1 : clampRatio(unknownCount / targetUnitCount);
  const alignmentCoverage =
    attempt === null || targetUnitCount === 0
      ? 0
      : clampRatio(attempt.tokenSpans.length / targetUnitCount);
  const audioDuration = input.audioInterval.end - input.audioInterval.start;
  const selected = attempt?.selectedBoundary;
  const spanDuration =
    selected === null || selected === undefined
      ? 0
      : Math.max(0, selected.end - selected.start);
  const acousticSpanCoverage = clampRatio(spanDuration / audioDuration);
  const unalignedPrefixRatio =
    selected === null || selected === undefined
      ? 1
      : clampRatio(
          (selected.start - input.audioInterval.start) / audioDuration,
        );
  const unalignedSuffixRatio =
    selected === null || selected === undefined
      ? 1
      : clampRatio((input.audioInterval.end - selected.end) / audioDuration);
  const edgePinned =
    attempt?.startPinnedToWindowEdge === true ||
    attempt?.endPinnedToWindowEdge === true;
  const normalizedAlignmentCost =
    attempt?.normalizedPathLogScore === null ||
    attempt?.normalizedPathLogScore === undefined ||
    !Number.isFinite(attempt.normalizedPathLogScore)
      ? null
      : Math.max(0, -attempt.normalizedPathLogScore);
  const monotonicity = attempt === null ? false : attemptMonotonic(attempt);
  const evidenceStatus =
    input.variant.projection.method === "unscorable" || targetUnitCount === 0
      ? ("CTC_UNSCORABLE" as const)
      : attempt === null
        ? ("CTC_NO_VALID_PATH" as const)
        : alignmentCoverage < 0.55 ||
            unsupportedUnitRatio > 0.25 ||
            !monotonicity
          ? ("CTC_WEAK" as const)
          : ("CTC_SCORABLE" as const);
  const core = {
    variantId: input.variant.variantId,
    projectionId: input.variant.projection.projectionId,
    evidenceStatus,
    alignmentCoverage,
    normalizedAlignmentCost,
    unsupportedUnitRatio,
    edgePinned,
    monotonicity,
    acousticSpanCoverage,
    unalignedPrefixRatio,
    unalignedSuffixRatio,
    projectionCoverage: input.variant.projection.projectionCoverage,
    durationCoverage: acousticSpanCoverage,
    targetUnitCount,
    meanTokenPosterior: attempt?.meanTokenPosterior ?? null,
    greedyNormalizedSimilarity:
      attempt === null ? null : clampRatio(attempt.greedyNormalizedSimilarity),
    attemptIds: input.variant.attempts.map((value) => value.attemptId),
    blockers: [
      ...new Set([
        ...(attempt?.blockers ?? []),
        ...(input.variant.projection.method === "unscorable"
          ? ["pronunciation-projection-unscorable"]
          : []),
        ...(edgePinned ? ["edge-pinned-alignment"] : []),
        ...(!monotonicity ? ["non-monotonic-token-path"] : []),
      ]),
    ],
  };
  return ctcVariantEvidenceSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

type DominanceRelation = "STRONG_DOMINANCE" | "WEAK_DOMINANCE" | "INCOMPARABLE";

function pairwiseDominance(
  left: CtcVariantEvidence,
  right: CtcVariantEvidence,
): { relation: DominanceRelation; reasons: string[] } {
  if (
    left.evidenceStatus !== "CTC_SCORABLE" ||
    right.evidenceStatus === "CTC_UNSCORABLE" ||
    left.normalizedAlignmentCost === null
  ) {
    return {
      relation:
        left.evidenceStatus === "CTC_SCORABLE" &&
        right.evidenceStatus !== "CTC_SCORABLE"
          ? "WEAK_DOMINANCE"
          : "INCOMPARABLE",
      reasons: ["evidence-status-not-directly-comparable"],
    };
  }
  if (right.normalizedAlignmentCost === null) {
    return {
      relation: "WEAK_DOMINANCE",
      reasons: ["right-variant-has-no-valid-ctc-path"],
    };
  }
  const shortPrefixRisk =
    left.targetUnitCount < right.targetUnitCount * 0.7 &&
    left.acousticSpanCoverage + 0.2 < right.acousticSpanCoverage;
  if (shortPrefixRisk) {
    return {
      relation: "INCOMPARABLE",
      reasons: ["short-prefix-bias-guard"],
    };
  }
  const costGain = right.normalizedAlignmentCost - left.normalizedAlignmentCost;
  const coverageNotWorse =
    left.alignmentCoverage + 0.05 >= right.alignmentCoverage &&
    left.acousticSpanCoverage + 0.1 >= right.acousticSpanCoverage;
  const supportNotWorse =
    left.unsupportedUnitRatio <= right.unsupportedUnitRatio + 0.05 &&
    (!left.edgePinned || right.edgePinned);
  if (costGain >= 0.18 && coverageNotWorse && supportNotWorse) {
    return {
      relation: "STRONG_DOMINANCE",
      reasons: [
        "normalized-ctc-cost-dominates",
        "span-and-unit-coverage-non-degrading",
        "length-bias-guard-passed",
      ],
    };
  }
  if (
    costGain >= 0.08 &&
    coverageNotWorse &&
    left.unsupportedUnitRatio <= right.unsupportedUnitRatio
  ) {
    return {
      relation: "WEAK_DOMINANCE",
      reasons: ["ctc-cost-separation-is-positive-but-not-strong"],
    };
  }
  return {
    relation: "INCOMPARABLE",
    reasons: ["ctc-evidence-margin-or-coverage-insufficient"],
  };
}

export function buildAcousticTextVariantVerification(input: {
  mode: C6014Mode;
  ctcRuntimeIdentityHash: string;
  ctcModelSnapshotHash: string;
  pronunciationRuntimeIdentityHash: string;
  events: readonly AcousticEventVerificationInput[];
  workerStartCount: number;
  generatedAt?: string;
}): MachineTextVariantAcousticVerification {
  const events = [...input.events]
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId))
    .map((event) => {
      const variants = [...event.variants].toSorted((left, right) =>
        left.variantId.localeCompare(right.variantId),
      );
      const evidence = variants.map((variant) =>
        buildEvidence({ variant, audioInterval: event.audioInterval }),
      );
      const relations = evidence.flatMap((left) =>
        evidence
          .filter((right) => right.variantId !== left.variantId)
          .map((right) => {
            const result = pairwiseDominance(left, right);
            return {
              dominantVariantId: left.variantId,
              dominatedVariantId: right.variantId,
              ...result,
            };
          }),
      );
      const strongDominators = evidence.filter((candidate) =>
        evidence
          .filter((other) => other.variantId !== candidate.variantId)
          .every((other) =>
            relations.some(
              (relation) =>
                relation.dominantVariantId === candidate.variantId &&
                relation.dominatedVariantId === other.variantId &&
                relation.relation === "STRONG_DOMINANCE",
            ),
          ),
      );
      const selectedByAcousticEvidence =
        strongDominators.length === 1
          ? (strongDominators[0]?.variantId ?? null)
          : null;
      const rejectedVariants = evidence
        .filter(
          (value) =>
            value.evidenceStatus === "CTC_NO_VALID_PATH" &&
            value.projectionCoverage >= 0.8,
        )
        .map((value) => value.variantId);
      const ambiguousVariants = evidence
        .filter(
          (value) =>
            value.variantId !== selectedByAcousticEvidence &&
            !rejectedVariants.includes(value.variantId),
        )
        .map((value) => value.variantId);
      const lengthBiasAuditPassed = !relations.some(
        (relation) =>
          relation.relation === "STRONG_DOMINANCE" &&
          (evidence.find(
            (value) => value.variantId === relation.dominantVariantId,
          )?.targetUnitCount ?? 0) <
            (evidence.find(
              (value) => value.variantId === relation.dominatedVariantId,
            )?.targetUnitCount ?? 0) *
              0.7 &&
          (evidence.find(
            (value) => value.variantId === relation.dominantVariantId,
          )?.acousticSpanCoverage ?? 0) +
            0.2 <
            (evidence.find(
              (value) => value.variantId === relation.dominatedVariantId,
            )?.acousticSpanCoverage ?? 0),
      );
      const prefixBiasAuditPassed = lengthBiasAuditPassed;
      const core = {
        eventId: event.eventId,
        audioEvidenceId: event.audioEvidenceId,
        audioInterval: event.audioInterval,
        audioSha256: event.audioSha256,
        variantIds: variants.map((variant) => variant.variantId),
        acousticProjections: variants.map((variant) => variant.projection),
        ctcEvidence: evidence,
        dominanceRelations: relations,
        rejectedVariants,
        ambiguousVariants,
        selectedByAcousticEvidence,
        lengthBiasAuditPassed,
        prefixBiasAuditPassed,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    });
  const allEvidence = events.flatMap((event) => event.ctcEvidence);
  const allAttempts = input.events.flatMap((event) =>
    event.variants.flatMap((variant) => variant.attempts),
  );
  const candidatePairComparisons = events.reduce(
    (sum, event) =>
      sum + event.variantIds.length * (event.variantIds.length - 1),
    0,
  );
  const core = {
    mode: input.mode,
    ctcRuntimeIdentityHash: input.ctcRuntimeIdentityHash,
    ctcModelSnapshotHash: input.ctcModelSnapshotHash,
    pronunciationRuntimeIdentityHash: input.pronunciationRuntimeIdentityHash,
    events,
    summary: {
      eventCount: events.length,
      requestCount: allAttempts.length,
      modelLoadCount: allAttempts.reduce(
        (sum, attempt) => sum + attempt.modelLoadCount,
        0,
      ),
      workerStartCount: input.workerStartCount,
      candidatePairComparisons,
      ctcScorableVariantCount: allEvidence.filter(
        (evidence) => evidence.evidenceStatus === "CTC_SCORABLE",
      ).length,
      ctcUnscorableVariantCount: allEvidence.filter(
        (evidence) => evidence.evidenceStatus === "CTC_UNSCORABLE",
      ).length,
      acousticDominanceCount: events.filter(
        (event) => event.selectedByAcousticEvidence !== null,
      ).length,
      weakSeparationCount: events.filter(
        (event) =>
          event.selectedByAcousticEvidence === null &&
          event.dominanceRelations.some(
            (relation) => relation.relation === "WEAK_DOMINANCE",
          ),
      ).length,
      edgePinnedCount: allEvidence.filter((evidence) => evidence.edgePinned)
        .length,
      projectionFailureCount: allEvidence.filter(
        (evidence) => evidence.projectionCoverage === 0,
      ).length,
      lengthBiasAuditPassed: events.every(
        (event) => event.lengthBiasAuditPassed,
      ),
      prefixBiasAuditPassed: events.every(
        (event) => event.prefixBiasAuditPassed,
      ),
      networkUsed: false as const,
    },
  };
  return machineTextVariantAcousticVerificationSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-text-variant-acoustic-verification",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
