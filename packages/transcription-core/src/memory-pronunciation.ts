import {
  memoryAssistedCtcTargetAuditSchema,
  subtitleMemoryPronunciationProjectionSchema,
  type CtcTargetEncoding,
  type MemoryAssistedCtcTargetAudit,
  type SeriesLanguageMemory,
  type SubtitleCanonicalAlignmentInput,
  type SubtitleCtcAlignmentInput,
  type SubtitleMemoryPronunciationProjection,
} from "@mvl/shared";

import { stableMemoryHash } from "./series-memory.js";

interface ProjectionSpan {
  occurrenceId: string;
  originalStartChar: number;
  originalEndChar: number;
  canonicalSurface: string;
  projectedAlias: string;
  entryId: string;
}

function nonOverlappingSpans(input: {
  text: string;
  memory: SeriesLanguageMemory;
  cueId: string;
}): ProjectionSpan[] {
  const candidates: ProjectionSpan[] = [];
  for (const entry of input.memory.entries) {
    if (
      entry.status !== "active" ||
      !["ranking-and-pronunciation", "pronunciation-only"].includes(
        entry.applicationEligibility,
      ) ||
      entry.acousticAliases.length !== 1
    ) {
      continue;
    }
    const projectedAlias = entry.acousticAliases[0];
    if (projectedAlias === undefined) continue;
    let offset = 0;
    while (offset < input.text.length) {
      const index = input.text.indexOf(entry.canonicalSurface, offset);
      if (index < 0) break;
      const end = index + entry.canonicalSurface.length;
      candidates.push({
        occurrenceId: `memory-projection-occurrence-${stableMemoryHash({
          cueId: input.cueId,
          entryId: entry.entryId,
          index,
          end,
        }).slice(0, 24)}`,
        originalStartChar: index,
        originalEndChar: end,
        canonicalSurface: entry.canonicalSurface,
        projectedAlias,
        entryId: entry.entryId,
      });
      offset = end;
    }
  }
  const accepted: ProjectionSpan[] = [];
  for (const candidate of candidates.toSorted(
    (left, right) =>
      left.originalStartChar - right.originalStartChar ||
      right.originalEndChar -
        right.originalStartChar -
        (left.originalEndChar - left.originalStartChar) ||
      left.entryId.localeCompare(right.entryId),
  )) {
    if (
      accepted.some(
        (value) =>
          candidate.originalStartChar < value.originalEndChar &&
          candidate.originalEndChar > value.originalStartChar,
      )
    ) {
      continue;
    }
    accepted.push(candidate);
  }
  return accepted.toSorted(
    (left, right) => left.originalStartChar - right.originalStartChar,
  );
}

function applySpans(text: string, spans: readonly ProjectionSpan[]): string {
  let result = text;
  for (const span of [...spans].toSorted(
    (left, right) => right.originalStartChar - left.originalStartChar,
  )) {
    const actual = result.slice(span.originalStartChar, span.originalEndChar);
    if (actual !== span.canonicalSurface) {
      throw new Error(
        "Pronunciation projection span no longer matches canonical text.",
      );
    }
    result =
      result.slice(0, span.originalStartChar) +
      span.projectedAlias +
      result.slice(span.originalEndChar);
  }
  return result.replace(/\s+/gu, " ").trim();
}

export function projectSeriesMemoryPronunciations(input: {
  alignment: SubtitleCanonicalAlignmentInput;
  memory: SeriesLanguageMemory;
  generatedAt?: string;
}): SubtitleMemoryPronunciationProjection {
  const cues = input.alignment.cues.map((cue) => {
    const spans = nonOverlappingSpans({
      text: cue.canonicalText,
      memory: input.memory,
      cueId: cue.cueId,
    });
    return {
      cueId: cue.cueId,
      canonicalText: cue.canonicalText,
      canonicalTextHash: stableMemoryHash(cue.canonicalText),
      projectedAlignmentText: applySpans(cue.canonicalText, spans),
      spans,
      canonicalTextChanged: false as const,
    };
  });
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-memory-pronunciation-projection" as const,
    projectionVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    memoryHash: input.memory.memoryHash,
    baseCueHash: input.alignment.baseCueHash,
    cues,
    summary: {
      pronunciationProjectionCount: cues.reduce(
        (sum, cue) => sum + cue.spans.length,
        0,
      ),
      projectedCueCount: cues.filter((cue) => cue.spans.length > 0).length,
      pronunciationProjectionCanonicalMutationCount: 0 as const,
    },
  };
  return subtitleMemoryPronunciationProjectionSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}

export function buildMemoryAssistedCtcTargetAudit(input: {
  ctcInput: SubtitleCtcAlignmentInput;
  projection: SubtitleMemoryPronunciationProjection;
  projectedEncodings: ReadonlyMap<string, CtcTargetEncoding>;
  generatedAt?: string;
}): MemoryAssistedCtcTargetAudit {
  const projectionByCue = new Map(
    input.projection.cues.map((cue) => [cue.cueId, cue]),
  );
  const cues = input.ctcInput.cues.map((cue) => {
    const projection = projectionByCue.get(cue.cueId);
    const after = input.projectedEncodings.get(cue.cueId) ?? cue.encoding;
    return {
      cueId: cue.cueId,
      beforeEncodable: cue.encoding.targetEncodable,
      afterProjectionEncodable: after.targetEncodable,
      beforeUnknownCount: cue.encoding.unknownTokenCount,
      afterUnknownCount: after.unknownTokenCount,
      projectionUsed: (projection?.spans.length ?? 0) > 0,
      memoryEntryIds: [
        ...new Set(projection?.spans.map((span) => span.entryId) ?? []),
      ].toSorted(),
      canonicalTextChanged: false as const,
    };
  });
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "memory-assisted-ctc-target-audit" as const,
    auditVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    ctcRuntimeIdentityHash: input.ctcInput.ctcRuntimeIdentityHash,
    ctcModelSnapshotHash: input.ctcInput.ctcModelSnapshotHash,
    cues,
    summary: {
      previousEncodableCueCount: cues.filter((cue) => cue.beforeEncodable)
        .length,
      memoryAssistedEncodableCueCount: cues.filter(
        (cue) => cue.afterProjectionEncodable,
      ).length,
      previousUnencodableCueCount: cues.filter((cue) => !cue.beforeEncodable)
        .length,
      previousUnencodableCueRescuedCount: cues.filter(
        (cue) => !cue.beforeEncodable && cue.afterProjectionEncodable,
      ).length,
      pronunciationProjectionCanonicalMutationCount: 0 as const,
    },
  };
  return memoryAssistedCtcTargetAuditSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}

export { applySpans as applyPronunciationProjectionSpans };
