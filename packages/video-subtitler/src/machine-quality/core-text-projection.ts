import {
  c6018PolicyVersion,
  machineCoreTextProjectionSchema,
  type C6018Mode,
  type CoreProjectionOrigin,
  type CoreProjectionStatus,
  type CoreTextProjectionCandidate,
  type MachineCoreAcousticSpan,
  type MachineCoreTextProjection,
} from "@mvl/shared";

import type { CoreSpanInterval } from "./core-acoustic-span.js";
import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";
import {
  candidateIntervalWholeGroup,
  groupProjectableTokens,
  type ProjectableTokenInput,
} from "./grouped-word-projection.js";

export interface CoreProjectionCandidateInput {
  eventId: string;
  candidateId: string;
  origin: CoreProjectionOrigin;
  requestId: string | null;
  sourceGlobalInterval: CoreSpanInterval | null;
  text: string;
  tokens: readonly ProjectableTokenInput[];
  ctcSupport: number | null;
  pronunciationSupport: number | null;
  evidenceIds: readonly string[];
}

function overlapSeconds(
  left: CoreSpanInterval,
  right: CoreSpanInterval,
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function projectedByIntervalWhole(input: {
  candidate: CoreProjectionCandidateInput;
  core: CoreSpanInterval;
}) {
  const candidateInterval = input.candidate.sourceGlobalInterval;
  if (candidateInterval === null) {
    return {
      text: "",
      preText: "",
      postText: "",
      groups: [],
      status: "UNTIMED_UNPROJECTABLE" as const,
      projectedIds: [],
      unprojectableIds: [`candidate-interval:${input.candidate.candidateId}`],
      coverage: 0,
    };
  }
  const overlap = overlapSeconds(candidateInterval, input.core);
  if (overlap <= 0) {
    return {
      text: "",
      preText:
        candidateInterval.end <= input.core.start ? input.candidate.text : "",
      postText:
        candidateInterval.start >= input.core.end ? input.candidate.text : "",
      groups: [],
      status: "NO_CORE_CONTENT" as const,
      projectedIds: [],
      unprojectableIds: [],
      coverage: 0,
    };
  }
  const candidateDuration = candidateInterval.end - candidateInterval.start;
  const coreDuration = input.core.end - input.core.start;
  const minimumCoverage =
    overlap / Math.max(0.001, Math.min(candidateDuration, coreDuration));
  const durationRatio =
    Math.max(candidateDuration, coreDuration) /
    Math.max(0.001, Math.min(candidateDuration, coreDuration));
  if (minimumCoverage >= 0.8 && durationRatio <= 1.35) {
    const group = candidateIntervalWholeGroup({
      candidateId: input.candidate.candidateId,
      text: input.candidate.text,
      interval: candidateInterval,
    });
    return {
      text: input.candidate.text,
      preText: "",
      postText: "",
      groups: [group],
      status: "PARTIAL_TOKEN_PROJECTED" as const,
      projectedIds: group.childTokenIds,
      unprojectableIds: [],
      coverage: bounded(overlap / Math.max(0.001, coreDuration)),
    };
  }
  return {
    text: "",
    preText:
      candidateInterval.start < input.core.start ? input.candidate.text : "",
    postText:
      candidateInterval.end > input.core.end ? input.candidate.text : "",
    groups: [],
    status: "UNTIMED_UNPROJECTABLE" as const,
    projectedIds: [],
    unprojectableIds: [`candidate-interval:${input.candidate.candidateId}`],
    coverage: bounded(overlap / Math.max(0.001, coreDuration)),
  };
}

function projectCandidate(input: {
  candidate: CoreProjectionCandidateInput;
  core: CoreSpanInterval;
  coreAmbiguous: boolean;
  overlapAmbiguous: boolean;
}): CoreTextProjectionCandidate {
  const groups = groupProjectableTokens(input.candidate.tokens);
  const mapped = groups.filter((group) => group.interval !== null);
  const unprojectable = groups.filter((group) => group.interval === null);
  const inCore = mapped.filter((group) => {
    const interval = group.interval;
    if (interval === null) return false;
    const midpoint = (interval.start + interval.end) / 2;
    return (
      (midpoint >= input.core.start && midpoint <= input.core.end) ||
      overlapSeconds(interval, input.core) /
        Math.max(0.001, interval.end - interval.start) >=
        0.5
    );
  });
  const pre = mapped.filter(
    (group) =>
      group.interval !== null && group.interval.end <= input.core.start,
  );
  const post = mapped.filter(
    (group) =>
      group.interval !== null && group.interval.start >= input.core.end,
  );
  const intervalFallback =
    groups.length === 0
      ? projectedByIntervalWhole({
          candidate: input.candidate,
          core: input.core,
        })
      : null;
  let coreText =
    intervalFallback?.text ?? inCore.map((group) => group.text).join("");
  const preText =
    intervalFallback?.preText ?? pre.map((group) => group.text).join("");
  const postText =
    intervalFallback?.postText ?? post.map((group) => group.text).join("");
  let projectionStatus: CoreProjectionStatus;
  if (intervalFallback !== null) {
    projectionStatus = intervalFallback.status;
  } else if (inCore.length === 0 && mapped.length > 0) {
    projectionStatus = "CONTEXT_ONLY_EXCESS";
  } else if (inCore.length === 0) {
    projectionStatus = "NO_CORE_CONTENT";
  } else if (
    unprojectable.length === 0 &&
    pre.length === 0 &&
    post.length === 0 &&
    normalizeCandidateText(coreText) ===
      normalizeCandidateText(input.candidate.text)
  ) {
    projectionStatus = "EXACT_TOKEN_PROJECTED";
  } else {
    projectionStatus = "PARTIAL_TOKEN_PROJECTED";
  }
  if (input.overlapAmbiguous) projectionStatus = "OVERLAP_AMBIGUOUS";
  else if (input.coreAmbiguous) projectionStatus = "CROSS_EVENT_AMBIGUOUS";

  const projectedGroups = intervalFallback?.groups ?? inCore;
  const projectedIds =
    intervalFallback?.projectedIds ??
    projectedGroups.flatMap((group) => group.childTokenIds);
  const unprojectableIds =
    intervalFallback?.unprojectableIds ??
    unprojectable.flatMap((group) => group.childTokenIds);
  const coreDuration = input.core.end - input.core.start;
  const coveredSeconds = projectedGroups.reduce((total, group) => {
    if (group.interval === null) return total;
    return total + overlapSeconds(group.interval, input.core);
  }, 0);
  const coreCoverage =
    intervalFallback?.coverage ??
    bounded(coveredSeconds / Math.max(0.001, coreDuration));
  const probabilities = input.candidate.tokens.flatMap((token) =>
    token.probability === null ? [] : [token.probability],
  );
  const fullWindowText = input.candidate.text.trim();
  coreText = coreText.trim();
  const partialBoundaryToken = mapped.some((group) => {
    const interval = group.interval;
    return (
      interval !== null &&
      overlapSeconds(interval, input.core) > 0 &&
      (interval.start < input.core.start || interval.end > input.core.end)
    );
  });
  const boundaryAmbiguity = input.overlapAmbiguous
    ? ("OVERLAP_AMBIGUITY" as const)
    : input.coreAmbiguous
      ? ("CROSS_EVENT_AMBIGUITY" as const)
      : partialBoundaryToken
        ? ("PARTIAL_BOUNDARY_TOKEN" as const)
        : unprojectableIds.length > 0
          ? ("UNPROJECTABLE_TOKEN" as const)
          : ("NONE" as const);
  const projectionCore = {
    eventId: input.candidate.eventId,
    candidateId: input.candidate.candidateId,
    origin: input.candidate.origin,
    requestId: input.candidate.requestId,
    sourceGlobalInterval: input.candidate.sourceGlobalInterval,
    fullWindowText,
    fullWindowTextHash: machineQualitySemanticHash(fullWindowText),
    normalizedFullWindowTextHash: machineQualitySemanticHash(
      normalizeCandidateText(fullWindowText),
    ),
    coreProjectedText: coreText,
    coreProjectedTextHash: machineQualitySemanticHash(coreText),
    normalizedCoreProjectedTextHash: machineQualitySemanticHash(
      normalizeCandidateText(coreText),
    ),
    preCoreText: preText.trim(),
    postCoreText: postText.trim(),
    groupedTokens:
      groups.length === 0 ? (intervalFallback?.groups ?? []) : groups,
    coreTokenIds: [...new Set(projectedIds)].toSorted(),
    projectedTokenIds: [...new Set(projectedIds)].toSorted(),
    unprojectableTokenIds: [...new Set(unprojectableIds)].toSorted(),
    projectionCoverage: coreCoverage,
    coreCoverage,
    boundaryAmbiguity,
    ctcSupport: input.candidate.ctcSupport,
    pronunciationSupport: input.candidate.pronunciationSupport,
    averageTokenProbability:
      probabilities.length === 0
        ? null
        : probabilities.reduce((sum, value) => sum + value, 0) /
          probabilities.length,
    projectionStatus,
    evidenceIds: [...new Set(input.candidate.evidenceIds)].toSorted(),
  };
  return {
    ...projectionCore,
    semanticHash: machineQualitySemanticHash(projectionCore),
  };
}

export function buildMachineCoreTextProjection(input: {
  mode: C6018Mode;
  coreSpans: MachineCoreAcousticSpan;
  candidates: readonly CoreProjectionCandidateInput[];
  generatedAt?: string;
}): MachineCoreTextProjection {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const spanByEvent = new Map(
    input.coreSpans.events.map((event) => [event.eventId, event] as const),
  );
  const candidates = input.candidates
    .flatMap((candidate) => {
      const span = spanByEvent.get(candidate.eventId);
      if (span === undefined) return [];
      const ambiguity = new Set(span.ambiguityReasons);
      return [
        projectCandidate({
          candidate,
          core: {
            start: span.proposedCoreStart,
            end: span.proposedCoreEnd,
          },
          coreAmbiguous: ambiguity.has("CROSS_EVENT_CORE_AMBIGUITY"),
          overlapAmbiguous: ambiguity.has("OVERLAP_CORE_AMBIGUITY"),
        }),
      ];
    })
    .toSorted(
      (left, right) =>
        left.eventId.localeCompare(right.eventId) ||
        left.origin.localeCompare(right.origin) ||
        left.candidateId.localeCompare(right.candidateId),
    );
  const counts = (status: CoreProjectionStatus) =>
    candidates.filter((candidate) => candidate.projectionStatus === status)
      .length;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6018PolicyVersion,
    generatedAt,
    artifactType: "machine-core-text-projection" as const,
    mode: input.mode,
    coreSpanSemanticHash: input.coreSpans.semanticHash,
    groupedWordPolicy:
      "preserve-child-token-identities-and-intervals-no-character-ratio-timing" as const,
    candidates,
    summary: {
      eventCount: new Set(candidates.map((candidate) => candidate.eventId))
        .size,
      candidateCount: candidates.length,
      exactTokenProjectedCount: counts("EXACT_TOKEN_PROJECTED"),
      partialTokenProjectedCount: counts("PARTIAL_TOKEN_PROJECTED"),
      contextOnlyExcessCount: counts("CONTEXT_ONLY_EXCESS"),
      untimeableCount: counts("UNTIMED_UNPROJECTABLE"),
      crossEventAmbiguousCount: counts("CROSS_EVENT_AMBIGUOUS"),
      overlapAmbiguousCount: counts("OVERLAP_AMBIGUOUS"),
      noCoreContentCount: counts("NO_CORE_CONTENT"),
      groupedTokenCount: candidates.reduce(
        (sum, candidate) => sum + candidate.groupedTokens.length,
        0,
      ),
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineCoreTextProjectionSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
