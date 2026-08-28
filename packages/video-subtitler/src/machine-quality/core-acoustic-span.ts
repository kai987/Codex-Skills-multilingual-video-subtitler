import {
  c6018PolicyVersion,
  machineCoreAcousticSpanSchema,
  type C6018Mode,
  type CoreAcousticSpanEvent,
  type CoreSpanAmbiguityReason,
  type MachineCoreAcousticSpan,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface CoreSpanInterval {
  start: number;
  end: number;
}

export interface CoreSpanEventInput {
  eventId: string;
  acousticInterval: CoreSpanInterval;
  trustedTokenSpan: CoreSpanInterval | null;
  eventType:
    | "SINGLE_UTTERANCE"
    | "RAPID_TURN"
    | "MULTI_SPEAKER_OVERLAP"
    | "BACKGROUND_FOREGROUND"
    | "CHANT_OR_CROWD"
    | "CONTINUATION_CANDIDATE"
    | "AMBIGUOUS_EVENT";
  semanticHash: string;
}

export interface CoreSpanVadInput {
  interval: CoreSpanInterval;
  evidenceId: string;
}

export interface CoreSpanFreshTokenInput {
  eventId: string;
  requestId: string;
  windowType: "near-exact" | "small-context" | "expanded-context";
  tokenId: string;
  interval: CoreSpanInterval | null;
  mappingVerified: boolean;
  lexical: boolean;
}

function finiteInterval(
  value: CoreSpanInterval | null,
): value is CoreSpanInterval {
  return (
    value !== null &&
    Number.isFinite(value.start) &&
    Number.isFinite(value.end) &&
    value.start >= 0 &&
    value.end > value.start
  );
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

function near(left: CoreSpanInterval, right: CoreSpanInterval): boolean {
  if (overlapSeconds(left, right) > 0) return true;
  const gap = Math.max(left.start, right.start) - Math.min(left.end, right.end);
  return gap <= 0.25;
}

function clampInterval(
  value: CoreSpanInterval,
  durationSeconds: number,
): { interval: CoreSpanInterval; clamped: boolean } {
  const start = Math.max(0, Math.min(durationSeconds - 0.001, value.start));
  const end = Math.max(start + 0.001, Math.min(durationSeconds, value.end));
  return {
    interval: { start, end },
    clamped: start !== value.start || end !== value.end,
  };
}

function tokenEnvelope(
  values: readonly CoreSpanFreshTokenInput[],
): CoreSpanInterval | null {
  const intervals = values.flatMap((value) =>
    value.mappingVerified && value.lexical && finiteInterval(value.interval)
      ? [value.interval]
      : [],
  );
  if (intervals.length === 0) return null;
  return {
    start: Math.min(...intervals.map((value) => value.start)),
    end: Math.max(...intervals.map((value) => value.end)),
  };
}

function uniqueIntervals(
  values: readonly CoreSpanVadInput[],
): CoreSpanVadInput[] {
  const byKey = new Map<string, CoreSpanVadInput>();
  for (const value of values) {
    const key = `${value.interval.start.toFixed(6)}:${value.interval.end.toFixed(6)}`;
    const previous = byKey.get(key);
    if (
      previous === undefined ||
      value.evidenceId.localeCompare(previous.evidenceId) < 0
    ) {
      byKey.set(key, value);
    }
  }
  return [...byKey.values()].toSorted(
    (left, right) =>
      left.interval.start - right.interval.start ||
      left.interval.end - right.interval.end ||
      left.evidenceId.localeCompare(right.evidenceId),
  );
}

function neighboringIntervals(
  events: readonly CoreSpanEventInput[],
  index: number,
): { previous: CoreSpanInterval | null; next: CoreSpanInterval | null } {
  return {
    previous: events[index - 1]?.acousticInterval ?? null,
    next: events[index + 1]?.acousticInterval ?? null,
  };
}

function hasMaterialOverlap(
  core: CoreSpanInterval,
  neighbor: CoreSpanInterval | null,
): boolean {
  if (neighbor === null) return false;
  const overlap = overlapSeconds(core, neighbor);
  return overlap >= Math.min(0.2, (core.end - core.start) * 0.35);
}

export function buildMachineCoreAcousticSpan(input: {
  mode: C6018Mode;
  sourceMediaSha256: string;
  sourceDurationSeconds: number;
  sourceReadOnlyVerified: boolean;
  selectionSemanticHash: string;
  selectedEventIds: ReadonlySet<string>;
  events: readonly CoreSpanEventInput[];
  vadSegments: readonly CoreSpanVadInput[];
  freshTokens: readonly CoreSpanFreshTokenInput[];
  ctcIntervals?: ReadonlyMap<string, CoreSpanInterval>;
  generatedAt?: string;
}): MachineCoreAcousticSpan {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sortedEvents = [...input.events].toSorted(
    (left, right) =>
      left.acousticInterval.start - right.acousticInterval.start ||
      left.acousticInterval.end - right.acousticInterval.end ||
      left.eventId.localeCompare(right.eventId),
  );
  const emitted: CoreAcousticSpanEvent[] = [];
  let unavailableCount = 0;

  for (const [eventIndex, event] of sortedEvents.entries()) {
    if (!input.selectedEventIds.has(event.eventId)) continue;
    if (!finiteInterval(event.acousticInterval)) {
      unavailableCount += 1;
      continue;
    }
    const neighbors = neighboringIntervals(sortedEvents, eventIndex);
    const relevantVad = uniqueIntervals(
      input.vadSegments.filter((value) =>
        near(value.interval, event.acousticInterval),
      ),
    );
    const trusted = finiteInterval(event.trustedTokenSpan)
      ? event.trustedTokenSpan
      : null;
    const nearExactTokens = input.freshTokens.filter(
      (value) =>
        value.eventId === event.eventId && value.windowType === "near-exact",
    );
    const freshEnvelope = tokenEnvelope(nearExactTokens);
    const ctcInterval = input.ctcIntervals?.get(event.eventId) ?? null;
    const eventDuration =
      event.acousticInterval.end - event.acousticInterval.start;
    let proposed = trusted ?? event.acousticInterval;
    let freshTokenFallbackUsed = false;
    if (
      trusted === null &&
      eventDuration < 0.35 &&
      freshEnvelope !== null &&
      overlapSeconds(freshEnvelope, event.acousticInterval) > 0 &&
      freshEnvelope.end - freshEnvelope.start <= 6
    ) {
      proposed = freshEnvelope;
      freshTokenFallbackUsed = true;
    }
    const clamped = clampInterval(proposed, input.sourceDurationSeconds);
    proposed = clamped.interval;

    const reasons = new Set<CoreSpanAmbiguityReason>();
    if (trusted === null) reasons.add("TRUSTED_TOKEN_SPAN_UNAVAILABLE");
    if (relevantVad.length === 0) reasons.add("VAD_SPAN_UNAVAILABLE");
    if (ctcInterval === null) reasons.add("CTC_SPAN_UNAVAILABLE");
    if (freshTokenFallbackUsed) reasons.add("FRESH_TOKEN_FALLBACK_USED");
    if (clamped.clamped) reasons.add("SOURCE_BOUNDARY_CLAMPED");
    if (event.eventType === "CHANT_OR_CROWD") {
      reasons.add("CHANT_OR_CROWD_CORE");
    }
    if (proposed.end - proposed.start < 0.2) {
      reasons.add("CORE_DURATION_TOO_SHORT");
    }
    const previousOverlap = hasMaterialOverlap(proposed, neighbors.previous);
    const nextOverlap = hasMaterialOverlap(proposed, neighbors.next);
    if (previousOverlap || nextOverlap) {
      reasons.add("NEIGHBORING_EVENT_OVERLAP");
      reasons.add("CROSS_EVENT_CORE_AMBIGUITY");
    }
    const speakerOverlap =
      event.eventType === "MULTI_SPEAKER_OVERLAP" ||
      event.eventType === "BACKGROUND_FOREGROUND";
    if (speakerOverlap) reasons.add("OVERLAP_CORE_AMBIGUITY");
    if (
      trusted === null &&
      relevantVad.length === 0 &&
      freshEnvelope === null
    ) {
      reasons.add("NO_LOCALIZED_ACOUSTIC_EVIDENCE");
    }
    if (reasons.size === 0) reasons.add("NO_AMBIGUITY");

    const coreSpanStatus = speakerOverlap
      ? ("AMBIGUOUS" as const)
      : reasons.has("CROSS_EVENT_CORE_AMBIGUITY")
        ? ("AMBIGUOUS" as const)
        : reasons.size === 1 && reasons.has("NO_AMBIGUITY")
          ? ("VERIFIED" as const)
          : ("VERIFIED_WITH_CAUTION" as const);
    const evidenceIds = [
      `canonical-event:${event.semanticHash}`,
      ...relevantVad.map((value) => value.evidenceId),
      ...nearExactTokens
        .filter((value) => value.mappingVerified && value.interval !== null)
        .map((value) => value.tokenId),
      ...(ctcInterval === null
        ? []
        : [`ctc-interval:${machineQualitySemanticHash(ctcInterval)}`]),
    ].toSorted();
    const core = {
      eventId: event.eventId,
      sourceMediaIdentity: input.sourceMediaSha256,
      machineEventInterval: event.acousticInterval,
      trustedTokenInterval: trusted,
      vadIntervals: relevantVad.map((value) => value.interval),
      ctcInterval,
      neighboringEventIntervals: neighbors,
      proposedCoreStart: proposed.start,
      proposedCoreEnd: proposed.end,
      evidenceIds,
      coreSpanStatus,
      ambiguityReasons: [...reasons].toSorted(),
      goldUsed: false as const,
    };
    emitted.push({ ...core, semanticHash: machineQualitySemanticHash(core) });
  }

  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6018PolicyVersion,
    generatedAt,
    artifactType: "machine-core-acoustic-span" as const,
    mode: input.mode,
    sourceIdentity: {
      sourceMediaSha256: input.sourceMediaSha256,
      durationSeconds: input.sourceDurationSeconds,
      sourceReadOnlyVerified: input.sourceReadOnlyVerified,
    },
    selectionSemanticHash: input.selectionSemanticHash,
    corePolicy:
      "trusted-token-then-acoustic-vad-with-fresh-token-fallback-no-gold" as const,
    events: emitted.toSorted((left, right) =>
      left.eventId.localeCompare(right.eventId),
    ),
    summary: {
      selectedEventCount: input.selectedEventIds.size,
      emittedEventCount: emitted.length,
      verifiedCount: emitted.filter(
        (event) => event.coreSpanStatus === "VERIFIED",
      ).length,
      verifiedWithCautionCount: emitted.filter(
        (event) => event.coreSpanStatus === "VERIFIED_WITH_CAUTION",
      ).length,
      ambiguousCount: emitted.filter(
        (event) => event.coreSpanStatus === "AMBIGUOUS",
      ).length,
      unavailableCount,
      overlapAmbiguityCount: emitted.filter((event) =>
        event.ambiguityReasons.includes("OVERLAP_CORE_AMBIGUITY"),
      ).length,
      freshTokenFallbackCount: emitted.filter((event) =>
        event.ambiguityReasons.includes("FRESH_TOKEN_FALLBACK_USED"),
      ).length,
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineCoreAcousticSpanSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
