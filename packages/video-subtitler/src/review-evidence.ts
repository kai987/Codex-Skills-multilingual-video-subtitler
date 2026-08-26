import {
  reviewBoundaryEvidenceSchema,
  type ReviewBoundaryEvidence,
  type SubtitleCanonicalForcedAlignment,
  type SubtitleCanonicalPronunciation,
  type SubtitleOverlapAcousticResolution,
  type SubtitlePresentationResolution,
  type SubtitleTimestampEvidenceIntegrity,
} from "@mvl/shared";
import type { z } from "zod";

import { sha256Value } from "./finalization-support.js";

const TRUSTED_TOKEN_STATUSES = new Set([
  "trusted-original-timeline",
  "trusted-mapped-original-timeline",
  "trusted-segment-relative-remap",
]);

export interface ReviewEvidenceArtifactHashes {
  canonicalForcedAlignment: string;
  overlapAcousticResolution: string;
  timestampEvidenceIntegrity: string;
  presentationResolution: string;
  canonicalPronunciation: string;
}

export interface ReconciledReviewEvidence {
  componentId: string;
  cueEvidence: Map<string, ReviewBoundaryEvidence[]>;
  componentRawVadIntervals: ReviewBoundaryEvidence[];
  componentDecodedSegments: ReviewBoundaryEvidence[];
  componentMappedTokenEvidence: ReviewBoundaryEvidence[];
  componentPauseEvidence: ReviewBoundaryEvidence[];
  mappedTokenBoundaryByCue: Map<string, { start: number; end: number } | null>;
  rawVadBoundaryByCue: Map<string, { start: number; end: number } | null>;
  unresolvedEvidenceReferences: string[];
  resolutionStatus: "resolved" | "partial" | "unresolved";
  reconciliationHash: string;
}

function nullableInterval(
  value:
    | { start: number; end: number }
    | { start: number; end: number; coordinateSystem?: string }
    | null
    | undefined,
): { start: number; end: number } | null {
  return value === null || value === undefined || value.end <= value.start
    ? null
    : { start: value.start, end: value.end };
}

function evidence(
  value: z.input<typeof reviewBoundaryEvidenceSchema>,
): ReviewBoundaryEvidence {
  return reviewBoundaryEvidenceSchema.parse({
    acousticEvidence: true,
    ...value,
  });
}

function uniqueEvidence(
  values: readonly ReviewBoundaryEvidence[],
): ReviewBoundaryEvidence[] {
  const byLineage = new Map<string, ReviewBoundaryEvidence>();
  for (const value of values) {
    const previous = byLineage.get(value.evidenceLineageId);
    if (
      previous === undefined ||
      value.evidenceId.localeCompare(previous.evidenceId) < 0
    ) {
      byLineage.set(value.evidenceLineageId, value);
    }
  }
  return [...byLineage.values()].toSorted((left, right) =>
    [left.scope, left.sourceType, left.evidenceId]
      .join(":")
      .localeCompare(
        [right.scope, right.sourceType, right.evidenceId].join(":"),
      ),
  );
}

export function selectRepresentativeMappedInterval(
  values: readonly {
    interval: { start: number; end: number };
    timingTrustScore: number;
    alignmentScore: number;
    profileConsensusScore: number;
    boundaryConfidence: number;
    neighborIntrusionRatio: number;
    sourceTypeSupportCount: number;
    evidenceId: string;
    evidenceLineageId?: string;
  }[],
): { start: number; end: number } | null {
  const compare = (
    left: (typeof values)[number],
    right: (typeof values)[number],
  ) =>
    right.timingTrustScore - left.timingTrustScore ||
    right.alignmentScore - left.alignmentScore ||
    right.profileConsensusScore - left.profileConsensusScore ||
    right.boundaryConfidence - left.boundaryConfidence ||
    left.neighborIntrusionRatio - right.neighborIntrusionRatio ||
    right.sourceTypeSupportCount - left.sourceTypeSupportCount ||
    left.evidenceId.localeCompare(right.evidenceId);
  const byLineage = new Map<string, (typeof values)[number]>();
  for (const value of values) {
    const key = value.evidenceLineageId ?? value.evidenceId;
    const previous = byLineage.get(key);
    if (previous === undefined || compare(value, previous) < 0) {
      byLineage.set(key, value);
    }
  }
  const sorted = [...byLineage.values()].toSorted(compare);
  return sorted[0]?.interval ?? null;
}

export function reconcileReviewEvidence(input: {
  componentId: string;
  cueIds: readonly string[];
  sourceCueIntervals: ReadonlyMap<string, { start: number; end: number }>;
  forcedAlignment: SubtitleCanonicalForcedAlignment;
  overlapAcoustic: SubtitleOverlapAcousticResolution;
  timestampIntegrity: SubtitleTimestampEvidenceIntegrity;
  presentation: SubtitlePresentationResolution;
  pronunciation: SubtitleCanonicalPronunciation;
  artifactHashes: ReviewEvidenceArtifactHashes;
}): ReconciledReviewEvidence {
  const component = input.overlapAcoustic.components.find(
    (value) => value.componentId === input.componentId,
  );
  const forcedComponent = input.forcedAlignment.components.find(
    (value) => value.componentId === input.componentId,
  );
  const unresolved = new Set<string>();
  if (component === undefined) unresolved.add(`component:${input.componentId}`);
  if (forcedComponent === undefined) {
    unresolved.add(`forced-component:${input.componentId}`);
  }
  const overlapAttemptById = new Map(
    input.overlapAcoustic.attempts.map((attempt) => [
      attempt.attemptId,
      attempt,
    ]),
  );
  const integrityAttemptById = new Map(
    input.timestampIntegrity.attempts.map((attempt) => [
      attempt.attemptId,
      attempt,
    ]),
  );
  const forcedAttemptById = new Map(
    input.forcedAlignment.attempts.map((attempt) => [
      attempt.attemptId,
      attempt,
    ]),
  );
  const cueEvidence = new Map<string, ReviewBoundaryEvidence[]>();
  const componentMapped: ReviewBoundaryEvidence[] = [];
  const mappedTokenBoundaryByCue = new Map<
    string,
    { start: number; end: number } | null
  >();
  const rawVadBoundaryByCue = new Map<
    string,
    { start: number; end: number } | null
  >();

  for (const cueId of [...input.cueIds].toSorted()) {
    const values: ReviewBoundaryEvidence[] = [];
    const sourceInterval = input.sourceCueIntervals.get(cueId);
    if (sourceInterval !== undefined) {
      values.push(
        evidence({
          evidenceId: cueId,
          evidenceLineageId: `source-cue-prior:${cueId}`,
          sourceType: "source-cue-prior",
          scope: "cue",
          cueIds: [cueId],
          componentId: input.componentId,
          interval: sourceInterval,
          sideSupport: "both",
          timingUsable: true,
          acousticEvidence: false,
          trustScore: 1,
          alignmentScore: null,
          boundaryConfidence: null,
          neighborIntrusionRatio: null,
          profile: null,
          attemptId: null,
          parentSegmentId: null,
          sourceArtifactType: "subtitle-canonical-forced-alignment",
          sourceArtifactHash: input.artifactHashes.canonicalForcedAlignment,
          sourceObjectId: cueId,
          blockers: [],
          notes: ["Baseline human timing; not independent acoustic evidence."],
        }),
      );
    } else {
      unresolved.add(`source-cue:${cueId}`);
    }
    const canonical = input.forcedAlignment.cueAlignments.find(
      (value) => value.cueId === cueId,
    );
    const forcedCue = forcedComponent?.cueAlignments.find(
      (value) => value.cueId === cueId,
    );
    if (canonical === undefined || forcedCue === undefined) {
      unresolved.add(`forced-cue:${cueId}`);
    } else {
      for (const [sourceType, attemptId] of [
        ["mfa-narrow", forcedCue.narrowAttemptId],
        ["mfa-expanded", forcedCue.expandedAttemptId],
      ] as const) {
        if (attemptId === null) continue;
        const attempt = forcedAttemptById.get(attemptId);
        const interval =
          attempt?.boundaryStart === null ||
          attempt?.boundaryStart === undefined ||
          attempt.boundaryEnd === null
            ? null
            : { start: attempt.boundaryStart, end: attempt.boundaryEnd };
        if (attempt === undefined || interval === null) {
          unresolved.add(attemptId);
          continue;
        }
        values.push(
          evidence({
            evidenceId: attempt.attemptId,
            evidenceLineageId: `mfa-attempt:${attempt.attemptId}`,
            sourceType,
            scope: "cue",
            cueIds: [cueId],
            componentId: input.componentId,
            interval,
            sideSupport: "both",
            timingUsable: attempt.alignmentSucceeded,
            trustScore: forcedCue.antiForcingMetrics.windowStabilityScore,
            alignmentScore:
              (attempt.wordCoverageRatio +
                attempt.phoneCoverageRatio +
                attempt.readingCoverageRatio) /
              3,
            boundaryConfidence: null,
            neighborIntrusionRatio:
              forcedCue.antiForcingMetrics.neighborCueIntrusionRatio,
            profile: null,
            attemptId: attempt.attemptId,
            parentSegmentId: null,
            selectedBoundarySource: attempt.selectedBoundarySource ?? null,
            windowType: attempt.windowType,
            wordInterval: nullableInterval(attempt.lexicalUtteranceInterval),
            phoneInterval: nullableInterval(attempt.phoneUtteranceInterval),
            startPinnedToWindowEdge: attempt.startPinnedToWindowEdge,
            endPinnedToWindowEdge: attempt.endPinnedToWindowEdge,
            wordCoverageRatio: attempt.wordCoverageRatio,
            phoneCoverageRatio: attempt.phoneCoverageRatio,
            readingCoverageRatio: attempt.readingCoverageRatio,
            sourceArtifactType: "subtitle-canonical-forced-alignment",
            sourceArtifactHash: input.artifactHashes.canonicalForcedAlignment,
            sourceObjectId: attempt.attemptId,
            blockers: forcedCue.blockers,
            notes: [
              `${sourceType} machine boundary`,
              "Machine evidence; not confirmed ground truth.",
            ],
          }),
        );
      }
      const dpInterval =
        canonical.evidenceDp.startBoundary === null ||
        canonical.evidenceDp.endBoundary === null
          ? null
          : {
              start: canonical.evidenceDp.startBoundary,
              end: canonical.evidenceDp.endBoundary,
            };
      if (dpInterval !== null) {
        const dpEvidenceId = canonical.evidenceDp.boundaryEvidenceIds[0];
        if (dpEvidenceId === undefined) {
          unresolved.add(`evidence-dp:${cueId}`);
        } else {
          values.push(
            evidence({
              evidenceId: dpEvidenceId,
              evidenceLineageId: `evidence-dp:${cueId}:${canonical.evidenceDp.boundaryEvidenceIds.toSorted().join("+")}`,
              sourceType: "evidence-dp",
              scope: "cue",
              cueIds: [cueId],
              componentId: input.componentId,
              interval: dpInterval,
              sideSupport: "both",
              timingUsable: true,
              trustScore: canonical.evidenceDp.pathScore,
              alignmentScore: canonical.evidenceDp.coverageRatio,
              boundaryConfidence: null,
              neighborIntrusionRatio:
                forcedCue.antiForcingMetrics.neighborCueIntrusionRatio,
              profile: null,
              attemptId: null,
              parentSegmentId: null,
              sourceArtifactType: "subtitle-canonical-forced-alignment",
              sourceArtifactHash: input.artifactHashes.canonicalForcedAlignment,
              sourceObjectId: cueId,
              blockers: canonical.evidenceDp.blockers,
              notes: [
                "Evidence-DP only; never projected as mapped-token evidence.",
              ],
            }),
          );
        }
      }
      if (forcedCue.selectedBoundary !== null) {
        const selectedId = forcedCue.boundaryEvidenceIds[0];
        if (selectedId === undefined) {
          unresolved.add(`forced-selected:${cueId}`);
        } else {
          values.push(
            evidence({
              evidenceId: selectedId,
              evidenceLineageId: `forced-selected:${cueId}:${forcedCue.boundaryEvidenceIds.toSorted().join("+")}`,
              sourceType: "forced-alignment-selected",
              scope: "cue",
              cueIds: [cueId],
              componentId: input.componentId,
              interval: forcedCue.selectedBoundary,
              sideSupport: "both",
              timingUsable: forcedCue.antiForcingPassed,
              trustScore: forcedCue.antiForcingMetrics.windowStabilityScore,
              alignmentScore: null,
              boundaryConfidence: null,
              neighborIntrusionRatio:
                forcedCue.antiForcingMetrics.neighborCueIntrusionRatio,
              profile: null,
              attemptId: null,
              parentSegmentId: null,
              sourceArtifactType: "subtitle-canonical-forced-alignment",
              sourceArtifactHash: input.artifactHashes.canonicalForcedAlignment,
              sourceObjectId: cueId,
              blockers: forcedCue.blockers,
              notes: [
                "Selected forced-alignment proposal; no automatic mutation.",
              ],
            }),
          );
        }
      }
    }

    const overlapCue = component?.cueAlignments.find(
      (value) => value.cueId === cueId,
    );
    const mappedCandidates: {
      interval: { start: number; end: number };
      timingTrustScore: number;
      alignmentScore: number;
      profileConsensusScore: number;
      boundaryConfidence: number;
      neighborIntrusionRatio: number;
      sourceTypeSupportCount: number;
      evidenceId: string;
      evidenceLineageId: string;
    }[] = [];
    let cueRawVadBoundary: { start: number; end: number } | null = null;
    for (const matched of overlapCue?.matchedIntervals ?? []) {
      const attempt = overlapAttemptById.get(matched.attemptId);
      const evidenceId = matched.evidenceId;
      const lineage = matched.evidenceLineageId;
      if (
        attempt === undefined ||
        evidenceId === undefined ||
        lineage === undefined
      ) {
        unresolved.add(evidenceId ?? matched.attemptId);
        continue;
      }
      const parentSegmentId =
        overlapCue?.sequenceParentSegmentIds?.length === 1
          ? (overlapCue.sequenceParentSegmentIds[0] ?? null)
          : null;
      if (
        ["trusted-mapped-token", "trusted-no-vad-token"].includes(
          matched.source,
        ) &&
        matched.timingUsable === true &&
        matched.parentSegmentContainmentPassed === true &&
        matched.timestampTrustStatus !== undefined &&
        TRUSTED_TOKEN_STATUSES.has(matched.timestampTrustStatus)
      ) {
        const value = evidence({
          evidenceId,
          evidenceLineageId: lineage,
          sourceType: matched.source as
            "trusted-mapped-token" | "trusted-no-vad-token",
          scope: "cue",
          cueIds: [cueId],
          componentId: input.componentId,
          interval: { start: matched.start, end: matched.end },
          sideSupport: "both",
          timingUsable: true,
          trustScore: matched.timingTrustScore ?? 0,
          alignmentScore: matched.alignmentScore ?? 0,
          boundaryConfidence: matched.boundaryConfidence ?? 0,
          neighborIntrusionRatio: matched.neighborIntrusionRatio ?? 1,
          profile: attempt.profile,
          attemptId: attempt.attemptId,
          parentSegmentId,
          sourceArtifactType: "subtitle-overlap-acoustic-resolution",
          sourceArtifactHash: input.artifactHashes.overlapAcousticResolution,
          sourceObjectId: evidenceId,
          blockers: overlapCue?.blockers ?? [],
          notes: ["Trusted matched-token interval with parent containment."],
        });
        values.push(value);
        componentMapped.push(value);
        mappedCandidates.push({
          interval: value.interval,
          timingTrustScore: matched.timingTrustScore ?? 0,
          alignmentScore: matched.alignmentScore ?? 0,
          profileConsensusScore: matched.profileConsensusScore ?? 0,
          boundaryConfidence: matched.boundaryConfidence ?? 0,
          neighborIntrusionRatio: matched.neighborIntrusionRatio ?? 1,
          sourceTypeSupportCount: matched.sourceTypeSupportCount ?? 0,
          evidenceId,
          evidenceLineageId: lineage,
        });
      } else if (matched.source === "decoded-segment") {
        values.push(
          evidence({
            evidenceId,
            evidenceLineageId: lineage,
            sourceType: "decoded-segment",
            scope: "cue",
            cueIds: [cueId],
            componentId: input.componentId,
            interval: { start: matched.start, end: matched.end },
            sideSupport: "both",
            timingUsable: matched.timingUsable === true,
            trustScore: matched.timingTrustScore ?? 0,
            alignmentScore: matched.alignmentScore ?? 0,
            boundaryConfidence: matched.boundaryConfidence ?? 0,
            neighborIntrusionRatio: matched.neighborIntrusionRatio ?? 1,
            profile: attempt.profile,
            attemptId: attempt.attemptId,
            parentSegmentId: evidenceId,
            sourceArtifactType: "subtitle-overlap-acoustic-resolution",
            sourceArtifactHash: input.artifactHashes.overlapAcousticResolution,
            sourceObjectId: evidenceId,
            blockers: overlapCue?.blockers ?? [],
            notes: ["Decoded segment timing; not Raw VAD evidence."],
          }),
        );
      } else if (
        matched.source === "raw-vad" &&
        (overlapCue?.trustedRawVadEvidenceIds ?? []).includes(evidenceId)
      ) {
        cueRawVadBoundary = { start: matched.start, end: matched.end };
      } else if (matched.source === "pause") {
        values.push(
          evidence({
            evidenceId,
            evidenceLineageId: lineage,
            sourceType: "pause",
            scope: "pair",
            cueIds: [...input.cueIds],
            componentId: input.componentId,
            interval: { start: matched.start, end: matched.end },
            sideSupport: "none",
            timingUsable: matched.timingUsable === true,
            trustScore: matched.timingTrustScore ?? 0,
            alignmentScore: matched.alignmentScore ?? null,
            boundaryConfidence: matched.boundaryConfidence ?? null,
            neighborIntrusionRatio: matched.neighborIntrusionRatio ?? null,
            profile: attempt.profile,
            attemptId: attempt.attemptId,
            parentSegmentId: null,
            sourceArtifactType: "subtitle-overlap-acoustic-resolution",
            sourceArtifactHash: input.artifactHashes.overlapAcousticResolution,
            sourceObjectId: evidenceId,
            blockers: [],
            notes: ["Pair/component pause evidence."],
          }),
        );
      }
    }
    mappedTokenBoundaryByCue.set(
      cueId,
      selectRepresentativeMappedInterval(mappedCandidates),
    );
    rawVadBoundaryByCue.set(cueId, cueRawVadBoundary);
    cueEvidence.set(cueId, uniqueEvidence(values));
  }

  const componentRaw: ReviewBoundaryEvidence[] = [];
  const componentDecoded: ReviewBoundaryEvidence[] = [];
  const componentPause: ReviewBoundaryEvidence[] = [];
  for (const attemptId of component?.profileAttemptIds ?? []) {
    const attempt = overlapAttemptById.get(attemptId);
    const integrity = integrityAttemptById.get(attemptId);
    if (attempt === undefined || integrity === undefined) {
      unresolved.add(attemptId);
      continue;
    }
    const integrityRawById = new Map(
      (integrity.rawVadEvaluations ?? []).map((value) => [
        value.intervalId,
        value,
      ]),
    );
    for (const raw of attempt.rawVadIntervals ?? []) {
      const health = integrityRawById.get(raw.intervalId);
      if (
        !raw.timingUsable ||
        !health?.timingUsable ||
        !["trusted", "trusted-with-boundary-normalization"].includes(
          health.healthStatus,
        )
      ) {
        if (health === undefined) unresolved.add(raw.intervalId);
        continue;
      }
      componentRaw.push(
        evidence({
          evidenceId: raw.intervalId,
          evidenceLineageId: health.evidenceLineageId,
          sourceType: "raw-vad",
          scope: "component",
          cueIds: [...input.cueIds],
          componentId: input.componentId,
          interval: { start: raw.start, end: raw.end },
          sideSupport: "none",
          timingUsable: true,
          trustScore: health.timingTrustScore,
          alignmentScore: null,
          boundaryConfidence: null,
          neighborIntrusionRatio: null,
          profile: attempt.profile,
          attemptId,
          parentSegmentId: null,
          rawInterval:
            health.rawStart === null || health.rawEnd === null
              ? null
              : { start: health.rawStart, end: health.rawEnd },
          normalizedInterval:
            health.normalizedStart === null || health.normalizedEnd === null
              ? null
              : { start: health.normalizedStart, end: health.normalizedEnd },
          healthStatus: health.healthStatus,
          normalizationApplied: health.normalizationApplied,
          normalizationDeltaStart: health.normalizationDeltaStart,
          normalizationDeltaEnd: health.normalizationDeltaEnd,
          sourceArtifactType: "subtitle-timestamp-evidence-integrity",
          sourceArtifactHash: input.artifactHashes.timestampEvidenceIntegrity,
          sourceObjectId: raw.intervalId,
          blockers: [],
          notes: [
            "Component-level speech activity; does not identify a cue or speaker.",
          ],
        }),
      );
    }
    for (const segment of attempt.decodedSegmentIntervals ?? []) {
      if (!segment.timingUsable) continue;
      componentDecoded.push(
        evidence({
          evidenceId: segment.intervalId,
          evidenceLineageId:
            segment.evidenceLineageId ??
            `decoded-segment:${segment.intervalId}`,
          sourceType: "decoded-segment",
          scope: "component",
          cueIds: [...input.cueIds],
          componentId: input.componentId,
          interval: { start: segment.start, end: segment.end },
          sideSupport: "none",
          timingUsable: true,
          trustScore: segment.timingTrustScore ?? 0.65,
          alignmentScore: null,
          boundaryConfidence: null,
          neighborIntrusionRatio: null,
          profile: attempt.profile,
          attemptId,
          parentSegmentId: segment.intervalId,
          sourceArtifactType: "subtitle-overlap-acoustic-resolution",
          sourceArtifactHash: input.artifactHashes.overlapAcousticResolution,
          sourceObjectId: segment.intervalId,
          blockers: [],
          notes: ["Decoded ASR segment; not Raw VAD."],
        }),
      );
    }
  }
  for (const values of cueEvidence.values()) {
    componentPause.push(
      ...values.filter((value) => value.sourceType === "pause"),
    );
  }
  if (
    !input.presentation.overlapDecisions.some((decision) =>
      input.cueIds.every((cueId) => decision.cueIds.includes(cueId)),
    )
  ) {
    unresolved.add(`presentation-component:${input.componentId}`);
  }
  for (const cueId of input.cueIds) {
    if (!input.pronunciation.cues.some((cue) => cue.cueId === cueId)) {
      unresolved.add(`pronunciation-cue:${cueId}`);
    }
  }
  const normalized = {
    componentId: input.componentId,
    cueEvidence: [...cueEvidence.entries()].toSorted(([left], [right]) =>
      left.localeCompare(right),
    ),
    componentRawVadIntervals: uniqueEvidence(componentRaw),
    componentDecodedSegments: uniqueEvidence(componentDecoded),
    componentMappedTokenEvidence: uniqueEvidence(componentMapped),
    componentPauseEvidence: uniqueEvidence(componentPause),
    mappedTokenBoundaryByCue: [...mappedTokenBoundaryByCue.entries()].toSorted(
      ([left], [right]) => left.localeCompare(right),
    ),
    rawVadBoundaryByCue: [...rawVadBoundaryByCue.entries()].toSorted(
      ([left], [right]) => left.localeCompare(right),
    ),
    unresolvedEvidenceReferences: [...unresolved].toSorted(),
  };
  return {
    componentId: input.componentId,
    cueEvidence,
    componentRawVadIntervals: normalized.componentRawVadIntervals,
    componentDecodedSegments: normalized.componentDecodedSegments,
    componentMappedTokenEvidence: normalized.componentMappedTokenEvidence,
    componentPauseEvidence: normalized.componentPauseEvidence,
    mappedTokenBoundaryByCue,
    rawVadBoundaryByCue,
    unresolvedEvidenceReferences: normalized.unresolvedEvidenceReferences,
    resolutionStatus:
      component === undefined || forcedComponent === undefined
        ? "unresolved"
        : unresolved.size === 0
          ? "resolved"
          : "partial",
    reconciliationHash: sha256Value(normalized),
  };
}
