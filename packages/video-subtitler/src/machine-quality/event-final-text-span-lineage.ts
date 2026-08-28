import {
  c6016PolicyVersion,
  machineEventFinalTextSpanLineageSchema,
  type C6016Mode,
  type EventFinalTextSpan,
  type MachineEventFinalTextSpanLineage,
  type MachineEventToFinalCueLineage,
  type SubtitleCue,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface EventTextSourceInput {
  eventId: string;
  currentCandidateId: string;
  sourceCandidates: readonly { candidateId: string; text: string }[];
}

interface NormalizedWithMap {
  text: string;
  originalIndexes: number[];
}

function normalizeWithCodePointMap(value: string): NormalizedWithMap {
  const text: string[] = [];
  const originalIndexes: number[] = [];
  for (const [index, character] of Array.from(value).entries()) {
    const normalized = character.normalize("NFKC").toLocaleLowerCase("ja");
    for (const normalizedCharacter of Array.from(normalized)) {
      if (/^[\p{Z}\p{P}\p{S}\p{C}_]$/u.test(normalizedCharacter)) continue;
      text.push(normalizedCharacter);
      originalIndexes.push(index);
    }
  }
  return { text: text.join(""), originalIndexes };
}

function allCodePointIndexes(haystack: string, needle: string): number[] {
  const haystackCodePoints = Array.from(haystack);
  const needleCodePoints = Array.from(needle);
  if (needleCodePoints.length === 0) return [];
  const output: number[] = [];
  for (
    let start = 0;
    start <= haystackCodePoints.length - needleCodePoints.length;
    start += 1
  ) {
    if (
      needleCodePoints.every(
        (character, offset) => haystackCodePoints[start + offset] === character,
      )
    ) {
      output.push(start);
    }
  }
  return output;
}

function exactCodePointMatches(finalText: string, sourceText: string) {
  const finalCodePoints = Array.from(finalText);
  const sourceCodePoints = Array.from(sourceText);
  if (sourceCodePoints.length === 0) return [];
  const matches: { start: number; end: number; normalized: false }[] = [];
  for (
    let start = 0;
    start <= finalCodePoints.length - sourceCodePoints.length;
    start += 1
  ) {
    if (
      sourceCodePoints.every(
        (character, offset) => finalCodePoints[start + offset] === character,
      )
    ) {
      matches.push({
        start,
        end: start + sourceCodePoints.length,
        normalized: false,
      });
    }
  }
  return matches;
}

function normalizedCodePointMatches(finalText: string, sourceText: string) {
  const finalNormalized = normalizeWithCodePointMap(finalText);
  const sourceNormalized = normalizeWithCodePointMap(sourceText);
  return allCodePointIndexes(
    finalNormalized.text,
    sourceNormalized.text,
  ).flatMap((normalizedStart) => {
    const normalizedEnd =
      normalizedStart + Array.from(sourceNormalized.text).length - 1;
    const start = finalNormalized.originalIndexes[normalizedStart];
    const last = finalNormalized.originalIndexes[normalizedEnd];
    if (start === undefined || last === undefined) return [];
    return [{ start, end: last + 1, normalized: true as const }];
  });
}

function mappedCoverage(
  cues: readonly SubtitleCue[],
  events: readonly EventFinalTextSpan[],
): number {
  const total = cues.reduce((sum, cue) => sum + Array.from(cue.text).length, 0);
  if (total === 0) return 1;
  let covered = 0;
  for (const cue of cues) {
    const coveredIndexes = new Set<number>();
    for (const event of events) {
      if (
        event.finalCueId !== cue.id ||
        event.spanStart === null ||
        event.spanEnd === null
      ) {
        continue;
      }
      for (let index = event.spanStart; index < event.spanEnd; index += 1) {
        coveredIndexes.add(index);
      }
    }
    covered += coveredIndexes.size;
  }
  return covered / total;
}

/**
 * Maps event identity to a final cue span using operation-history lineage and
 * exact/normalized-exact candidate provenance. Fuzzy similarity and nearest
 * timing are intentionally absent from this API.
 */
export function buildEventFinalTextSpanLineage(input: {
  mode: C6016Mode;
  cueLineage: MachineEventToFinalCueLineage;
  finalCues: readonly SubtitleCue[];
  eventTextSources: readonly EventTextSourceInput[];
  generatedAt?: string;
}): MachineEventFinalTextSpanLineage {
  const cueById = new Map(input.finalCues.map((cue) => [cue.id, cue] as const));
  const sourceByEvent = new Map(
    input.eventTextSources.map((source) => [source.eventId, source] as const),
  );
  const events = input.cueLineage.events
    .map((cueLineage): EventFinalTextSpan => {
      const source = sourceByEvent.get(cueLineage.eventId);
      const current = source?.sourceCandidates.find(
        (candidate) => candidate.candidateId === source.currentCandidateId,
      );
      const targetCues = cueLineage.finalCueIds.flatMap((cueId) => {
        const cue = cueById.get(cueId);
        return cue === undefined ? [] : [cue];
      });
      const blockers: string[] = [];
      if (source === undefined) blockers.push("event-text-source-unavailable");
      if (current === undefined)
        blockers.push("current-candidate-text-provenance-unavailable");
      if (targetCues.length === 0)
        blockers.push("final-cue-lineage-target-unavailable");
      const exactMatches =
        current === undefined
          ? []
          : targetCues.flatMap((cue) =>
              exactCodePointMatches(cue.text, current.text).map((match) => ({
                cue,
                ...match,
              })),
            );
      const normalizedMatches =
        exactMatches.length > 0 || current === undefined
          ? []
          : targetCues.flatMap((cue) =>
              normalizedCodePointMatches(cue.text, current.text).map(
                (match) => ({ cue, ...match }),
              ),
            );
      const matches =
        exactMatches.length > 0 ? exactMatches : normalizedMatches;
      if (matches.length > 1)
        blockers.push("multiple-provenance-compatible-text-spans");
      if (matches.length === 0 && current !== undefined)
        blockers.push("candidate-text-not-present-in-lineage-target");
      const match = matches.length === 1 ? matches[0] : undefined;
      const hasSplit = cueLineage.splitRelations.length > 0;
      const hasMerge = cueLineage.mergeRelations.length > 0;
      const lineageStatus =
        matches.length > 1
          ? ("AMBIGUOUS" as const)
          : match === undefined
            ? ("UNRESOLVED" as const)
            : hasMerge || cueLineage.lineageStatus === "MANY_TO_ONE"
              ? ("DERIVED_FROM_MERGE" as const)
              : hasSplit || cueLineage.lineageStatus === "ONE_TO_MANY"
                ? ("DERIVED_FROM_SPLIT" as const)
                : match.normalized
                  ? ("NORMALIZED_EXACT" as const)
                  : ("EXACT" as const);
      const alignmentMethod =
        lineageStatus === "DERIVED_FROM_MERGE"
          ? ("SEGMENTATION_MERGE_HISTORY" as const)
          : lineageStatus === "DERIVED_FROM_SPLIT"
            ? ("SEGMENTATION_SPLIT_HISTORY" as const)
            : lineageStatus === "NORMALIZED_EXACT"
              ? ("PROVENANCE_NORMALIZATION_MAP" as const)
              : lineageStatus === "EXACT"
                ? ("PROVENANCE_EXACT_SUBSTRING" as const)
                : ("UNRESOLVED" as const);
      const confidenceClass =
        lineageStatus === "EXACT" || lineageStatus === "NORMALIZED_EXACT"
          ? ("STRONG" as const)
          : lineageStatus === "DERIVED_FROM_SPLIT" ||
              lineageStatus === "DERIVED_FROM_MERGE"
            ? ("MODERATE" as const)
            : lineageStatus === "AMBIGUOUS"
              ? ("AMBIGUOUS" as const)
              : ("UNRESOLVED" as const);
      const finalText = match?.cue.text ?? targetCues[0]?.text ?? "";
      const spanStart = match?.start ?? null;
      const spanEnd = match?.end ?? null;
      const spanText =
        match === undefined
          ? null
          : Array.from(match.cue.text).slice(match.start, match.end).join("");
      const core = {
        eventId: cueLineage.eventId,
        finalCueId: match?.cue.id ?? targetCues[0]?.id ?? null,
        finalText,
        spanStart,
        spanEnd,
        spanText,
        sourceCandidateIds: cueLineage.sourceCandidateIds,
        alignmentMethod,
        alignmentEvidence: [
          `cue-lineage:${cueLineage.semanticHash}`,
          ...(current === undefined
            ? []
            : [`candidate-text:${current.candidateId}`]),
        ],
        lineageStatus,
        confidenceClass,
        indexingPolicy: "unicode-code-point-half-open" as const,
        modifiable:
          match !== undefined &&
          !["AMBIGUOUS", "UNRESOLVED"].includes(lineageStatus),
        blockers,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    })
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId));
  const mapped = events.filter(
    (event) => event.spanStart !== null && event.spanEnd !== null,
  );
  const summary = {
    eventCount: events.length,
    spanMappedEventCount: mapped.length,
    exactSpanCount: events.filter((event) => event.lineageStatus === "EXACT")
      .length,
    normalizedExactSpanCount: events.filter(
      (event) => event.lineageStatus === "NORMALIZED_EXACT",
    ).length,
    splitDerivedSpanCount: events.filter(
      (event) => event.lineageStatus === "DERIVED_FROM_SPLIT",
    ).length,
    mergeDerivedSpanCount: events.filter(
      (event) => event.lineageStatus === "DERIVED_FROM_MERGE",
    ).length,
    ambiguousSpanCount: events.filter(
      (event) => event.lineageStatus === "AMBIGUOUS",
    ).length,
    unresolvedSpanCount: events.filter(
      (event) => event.lineageStatus === "UNRESOLVED",
    ).length,
    modifiableEventCount: events.filter((event) => event.modifiable).length,
    finalCueTextCoverage: mappedCoverage(input.finalCues, events),
  };
  const core = {
    mode: input.mode,
    indexingPolicy: "unicode-code-point-half-open" as const,
    identityPolicy:
      "pipeline-provenance-required-no-fuzzy-production-match" as const,
    events,
    summary,
  };
  return machineEventFinalTextSpanLineageSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6016PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-event-final-text-span-lineage",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
