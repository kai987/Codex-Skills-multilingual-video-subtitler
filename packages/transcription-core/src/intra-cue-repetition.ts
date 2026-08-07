import { createHash } from "node:crypto";

import {
  intraCueRepetitionRepairArtifactSchema,
  type IntraCueRepetitionRepairArtifact,
  type JapaneseTerminologyEntry,
  type SubtitleCue,
} from "@mvl/shared";
import {
  analyzeJapaneseText,
  normalizeJapaneseSubtitleWhitespace,
} from "@mvl/subtitle-core";

import { builtinJapaneseReadingAnalyzer } from "./japanese-normalization.js";
import {
  isHighContainmentRepetition,
  longestCommonSubstring,
  normalizeForExactCueComparison,
} from "./repetition.js";

type Relationship =
  IntraCueRepetitionRepairArtifact["records"][number]["relationship"];
type Span =
  IntraCueRepetitionRepairArtifact["records"][number]["detectedRepeatedSpans"][number];

interface CandidateUnit {
  cue: SubtitleCue | null;
  span: Span;
}

export interface IntraCueHypothesisRepetitionDetection {
  relationship: Relationship;
  units: CandidateUnit[];
  readingEvidence: string[];
  audioRepetitionEvidence: string[];
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalized(value: string): string {
  return normalizeForExactCueComparison(
    normalizeJapaneseSubtitleWhitespace(value),
  );
}

function bigramSimilarity(left: string, right: string): number {
  const a = Array.from(normalized(left));
  const b = Array.from(normalized(right));
  if (a.join("") === b.join("")) return 1;
  const pairs = (value: readonly string[]) =>
    new Set(
      value.length < 2
        ? value
        : value
            .slice(0, -1)
            .map((entry, index) => `${entry}${value[index + 1] ?? ""}`),
    );
  const leftPairs = pairs(a);
  const rightPairs = pairs(b);
  const common = [...leftPairs].filter((entry) => rightPairs.has(entry)).length;
  return (2 * common) / Math.max(1, leftPairs.size + rightPairs.size);
}

function shared(left: readonly string[], right: readonly string[]): boolean {
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
}

function interval(cue: SubtitleCue): Span["interval"] {
  return cue.end > cue.start ? { start: cue.start, end: cue.end } : null;
}

function spanFromCue(cue: SubtitleCue): Span {
  return {
    text: cue.text,
    normalizedText: normalized(cue.text),
    sourceCueIds: [cue.id],
    interval: interval(cue),
  };
}

function textUnits(cue: SubtitleCue): CandidateUnit[] {
  const parts = cue.text
    .split(/(?:\r?\n)+|(?<=[。！？!?])/u)
    .map((text) => text.trim())
    .filter(Boolean);
  return parts.map((text, index) => ({
    cue: null,
    span: {
      text,
      normalizedText: normalized(text),
      sourceCueIds: [
        `${cue.id}:text-span-${String(index + 1).padStart(2, "0")}`,
      ],
      interval: null,
    },
  }));
}

function candidateUnits(
  cue: SubtitleCue,
  sourceById: ReadonlyMap<string, SubtitleCue>,
): CandidateUnit[] {
  const parentText = normalized(cue.text);
  const sourceUnits = (source: SubtitleCue): CandidateUnit[] => {
    const parts = source.text
      .split(/(?:\r?\n)+|(?<=[。！？!?])|\s+/u)
      .map((text) => text.trim())
      .filter(Boolean);
    const meaningfulParts =
      parts.length >= 2 &&
      parts.filter((part) => Array.from(normalized(part)).length >= 6).length >=
        2
        ? parts.filter((part) => Array.from(normalized(part)).length >= 4)
        : [source.text];
    return meaningfulParts.map((text) => ({
      cue: source,
      span: {
        text,
        normalizedText: normalized(text),
        sourceCueIds: [source.id],
        interval: interval(source),
      },
    }));
  };
  const sourceIds = cue.textAudit?.sourceWinnerCueIds ?? [];
  const sources = sourceIds
    .map((id) => sourceById.get(id))
    .filter((candidate): candidate is SubtitleCue => candidate !== undefined)
    .filter(
      (candidate, index, candidates) =>
        candidates.findIndex((other) => other.id === candidate.id) === index,
    )
    .flatMap(sourceUnits)
    .filter(
      (candidate) =>
        candidate.span.normalizedText !== "" &&
        parentText.includes(candidate.span.normalizedText),
    );
  return sources.length >= 2 ? sources : textUnits(cue);
}

function tokenBackedSpokenRepetition(
  cue: SubtitleCue,
  left: CandidateUnit,
  right: CandidateUnit,
): string[] {
  const core = longestCommonSubstring(
    left.span.normalizedText,
    right.span.normalizedText,
  );
  const matchingTokens = (cue.timingEvidence?.tokens ?? []).filter((token) => {
    const value = normalized(token.text);
    return value !== "" && (core.includes(value) || value.includes(core));
  });
  if (
    core.length >= 2 &&
    matchingTokens.length >= 2 &&
    matchingTokens.some(
      (token, index) =>
        index > 0 &&
        token.start >= (matchingTokens[index - 1]?.end ?? token.start),
    )
  ) {
    return [
      "two-independent-token-timestamp-occurrences",
      `matching-token-count:${String(matchingTokens.length)}`,
    ];
  }
  const leftCue = left.cue;
  const rightCue = right.cue;
  if (
    leftCue !== null &&
    rightCue !== null &&
    leftCue.timingEvidence?.tokenTimestampsUsed === true &&
    rightCue.timingEvidence?.tokenTimestampsUsed === true &&
    leftCue.timingEvidence.tokens.length > 0 &&
    rightCue.timingEvidence.tokens.length > 0 &&
    shared(
      leftCue.provenance?.sourceRequestIds ?? [],
      rightCue.provenance?.sourceRequestIds ?? [],
    ) &&
    (leftCue.end <= rightCue.start || rightCue.end <= leftCue.start)
  ) {
    return [
      "same-profile-independent-token-intervals",
      `left-interval:${leftCue.start.toFixed(3)}-${leftCue.end.toFixed(3)}`,
      `right-interval:${rightCue.start.toFixed(3)}-${rightCue.end.toFixed(3)}`,
    ];
  }
  return [];
}

function relationship(
  cue: SubtitleCue,
  left: CandidateUnit,
  right: CandidateUnit,
): {
  relationship: Relationship | null;
  readingEvidence: string[];
  audioRepetitionEvidence: string[];
} {
  const a = left.span.normalizedText;
  const b = right.span.normalizedText;
  const parent = normalized(cue.text);
  const occurrences = (needle: string): { start: number; end: number }[] => {
    if (needle === "") return [];
    const output: { start: number; end: number }[] = [];
    let cursor = 0;
    while (cursor <= parent.length - needle.length) {
      const start = parent.indexOf(needle, cursor);
      if (start < 0) break;
      output.push({ start, end: start + needle.length });
      cursor = start + Math.max(1, needle.length);
    }
    return output;
  };
  const leftOccurrences = occurrences(a);
  const rightOccurrences = occurrences(b);
  const representedByDistinctTextSpans =
    (a === b && leftOccurrences.length >= 2) ||
    (a !== b &&
      leftOccurrences.some((leftInterval) =>
        rightOccurrences.some(
          (rightInterval) =>
            leftInterval.end <= rightInterval.start ||
            rightInterval.end <= leftInterval.start,
        ),
      )) ||
    (a.includes(b) && rightOccurrences.length >= 2) ||
    (b.includes(a) && leftOccurrences.length >= 2);
  if (!representedByDistinctTextSpans) {
    return {
      relationship: null,
      readingEvidence: [],
      audioRepetitionEvidence: [],
    };
  }
  const audioRepetitionEvidence = tokenBackedSpokenRepetition(cue, left, right);
  if (Math.min(Array.from(a).length, Array.from(b).length) < 4) {
    return audioRepetitionEvidence.length > 0
      ? {
          relationship: "true-spoken-repetition",
          readingEvidence: [],
          audioRepetitionEvidence,
        }
      : {
          relationship: null,
          readingEvidence: [],
          audioRepetitionEvidence: [],
        };
  }
  const leftReading = builtinJapaneseReadingAnalyzer.analyze(left.span.text);
  const rightReading = builtinJapaneseReadingAnalyzer.analyze(right.span.text);
  const readingEquivalent =
    leftReading.reading !== null &&
    rightReading.reading !== null &&
    leftReading.reading === rightReading.reading;
  const similarity = bigramSimilarity(left.span.text, right.span.text);
  const containment = isHighContainmentRepetition(
    left.span.text,
    right.span.text,
    6,
    0.72,
  );
  if (a !== b && !readingEquivalent && similarity < 0.76 && !containment) {
    return {
      relationship: null,
      readingEvidence: [],
      audioRepetitionEvidence: [],
    };
  }
  if (audioRepetitionEvidence.length > 0) {
    return {
      relationship: "true-spoken-repetition",
      readingEvidence: [...leftReading.evidence, ...rightReading.evidence],
      audioRepetitionEvidence,
    };
  }
  const leftCue = left.cue;
  const rightCue = right.cue;
  const mergedRepair = /(?:text-integrity|overlap|segmentation-restored)/u.test(
    cue.textAudit?.repairType ?? cue.id,
  );
  const sharedAnchor =
    leftCue !== null &&
    rightCue !== null &&
    shared(
      leftCue.provenance?.referenceAnchorIds ?? [],
      rightCue.provenance?.referenceAnchorIds ?? [],
    );
  const alternateRequests =
    leftCue !== null &&
    rightCue !== null &&
    !shared(
      leftCue.provenance?.sourceRequestIds ?? [],
      rightCue.provenance?.sourceRequestIds ?? [],
    );
  if (
    !mergedRepair &&
    !sharedAnchor &&
    !alternateRequests &&
    left.cue !== null
  ) {
    return {
      relationship: null,
      readingEvidence: [],
      audioRepetitionEvidence: [],
    };
  }
  return {
    relationship:
      a === b
        ? "exact-duplicate"
        : readingEquivalent
          ? "kana-kanji-equivalent"
          : containment
            ? "containment-alternative"
            : "near-duplicate",
    readingEvidence: [
      ...leftReading.evidence,
      ...rightReading.evidence,
      ...(readingEquivalent
        ? ["reading-equivalent"]
        : ["reading-equivalence-unavailable-or-inexact"]),
      `bigram-similarity:${similarity.toFixed(3)}`,
    ],
    audioRepetitionEvidence: [
      "no-independent-token-timestamps-for-second-utterance",
      ...(sharedAnchor ? ["shared-reference-anchor"] : []),
      ...(alternateRequests ? ["alternative-source-requests"] : []),
      ...(mergedRepair ? ["created-by-text-or-overlap-repair"] : []),
    ],
  };
}

export function detectIntraCueHypothesisRepetition(input: {
  cue: SubtitleCue;
  sourceCues?: readonly SubtitleCue[];
}): IntraCueHypothesisRepetitionDetection | null {
  const sourceById = new Map(
    (input.sourceCues ?? []).map((cue) => [cue.id, cue] as const),
  );
  const units = candidateUnits(input.cue, sourceById);
  const matches: {
    left: CandidateUnit;
    right: CandidateUnit;
    relationship: Relationship;
    readingEvidence: string[];
    audioRepetitionEvidence: string[];
    similarity: number;
  }[] = [];
  for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < units.length;
      rightIndex += 1
    ) {
      const left = units[leftIndex];
      const right = units[rightIndex];
      if (left === undefined || right === undefined) continue;
      const analysis = relationship(input.cue, left, right);
      if (analysis.relationship === null) continue;
      matches.push({
        left,
        right,
        relationship: analysis.relationship,
        readingEvidence: analysis.readingEvidence,
        audioRepetitionEvidence: analysis.audioRepetitionEvidence,
        similarity: bigramSimilarity(left.span.text, right.span.text),
      });
    }
  }
  const selected = matches.toSorted(
    (left, right) =>
      Number(right.relationship !== "true-spoken-repetition") -
        Number(left.relationship !== "true-spoken-repetition") ||
      right.similarity - left.similarity,
  )[0];
  if (selected === undefined) return null;
  const related = units.filter(
    (unit) =>
      unit === selected.left ||
      unit === selected.right ||
      relationship(input.cue, selected.left, unit).relationship !== null,
  );
  return {
    relationship: selected.relationship,
    units: related,
    readingEvidence: selected.readingEvidence,
    audioRepetitionEvidence: selected.audioRepetitionEvidence,
  };
}

function candidateSupport(
  candidate: CandidateUnit,
  allSources: readonly SubtitleCue[],
  terminology: readonly JapaneseTerminologyEntry[],
): number {
  const cue = candidate.cue;
  const text = candidate.span.text;
  const duration =
    candidate.span.interval === null
      ? null
      : candidate.span.interval.end - candidate.span.interval.start;
  const cps =
    duration === null
      ? 0
      : Array.from(candidate.span.normalizedText).length /
        Math.max(0.001, duration);
  const equivalentSupport = allSources.filter(
    (source) => bigramSimilarity(source.text, text) >= 0.92,
  ).length;
  const terminologySupport = terminology
    .filter((entry) => text.includes(entry.canonical))
    .reduce((sum, entry) => sum + entry.confidence, 0);
  const analysis = analyzeJapaneseText(text);
  const completeness =
    Number(!analysis.startsMidWord) +
    Number(!analysis.endsMidWord) +
    Number(!analysis.likelyIncompleteClause);
  return (
    (cue?.textAudit?.winnerScore ?? cue?.confidence ?? 0.5) * 2 +
    Math.min(0.8, equivalentSupport * 0.2) +
    Math.min(0.6, terminologySupport * 0.4) +
    completeness * 0.1 +
    (cue?.timingEvidence?.tokenTimestampsUsed === true ? 0.35 : 0) +
    ((cue?.timingEvidence?.speechIntervals?.length ?? 0) > 0 ? 0.15 : 0) -
    (cps > 20 ? Math.min(1.5, (cps - 20) / 20) : 0)
  );
}

function overlapRatio(left: SubtitleCue, right: SubtitleCue): number {
  const overlap = Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  return (
    overlap /
    Math.max(0.001, Math.min(left.end - left.start, right.end - right.start))
  );
}

/**
 * Older repair artifacts can already contain a complete winner with short,
 * overlapping fragments appended to it. This is not necessarily a repeated
 * sentence, so the ordinary pair detector cannot see it. Recover the complete
 * source candidate only when the parent records a merge, the candidate covers
 * most of the parent, and every omitted source is temporally overlapping rather
 * than an independently timed continuation.
 */
function unsupportedMergedExpansion(input: {
  cue: SubtitleCue;
  sourceById: ReadonlyMap<string, SubtitleCue>;
  allSources: readonly SubtitleCue[];
  terminology: readonly JapaneseTerminologyEntry[];
}): {
  selected: { cue: SubtitleCue; span: Span };
  omitted: { cue: SubtitleCue; span: Span }[];
} | null {
  if (
    !/(?:text-integrity-(?:previous|next|three-way)|overlap-merge|segmentation-restored)/u.test(
      input.cue.textAudit?.repairType ?? input.cue.id,
    )
  ) {
    return null;
  }
  const parent = normalized(input.cue.text);
  const sources = (input.cue.textAudit?.sourceWinnerCueIds ?? [])
    .map((id) => input.sourceById.get(id))
    .filter((source): source is SubtitleCue => source !== undefined)
    .filter(
      (source, index, values) =>
        values.findIndex((other) => other.id === source.id) === index,
    );
  const candidates = sources
    .map((source) => ({ cue: source, span: spanFromCue(source) }))
    .filter((candidate) => {
      const value = candidate.span.normalizedText;
      if (
        value.length < 8 ||
        !parent.includes(value) ||
        value.length / Math.max(1, parent.length) < 0.65 ||
        overlapRatio(input.cue, candidate.cue) < 0.6
      ) {
        return false;
      }
      const analysis = analyzeJapaneseText(candidate.span.text);
      return (
        !analysis.startsMidWord &&
        !analysis.endsMidWord &&
        !analysis.likelyIncompleteClause
      );
    })
    .toSorted(
      (left, right) =>
        candidateSupport(right, input.allSources, input.terminology) -
          candidateSupport(left, input.allSources, input.terminology) ||
        right.span.normalizedText.length - left.span.normalizedText.length,
    );
  const selected = candidates[0];
  if (selected === undefined) return null;
  const remainderLength = parent.length - selected.span.normalizedText.length;
  if (
    remainderLength <= 0 ||
    remainderLength > Math.max(12, parent.length * 0.35)
  ) {
    return null;
  }
  const omitted = sources
    .filter((source) => source.id !== selected.cue.id)
    .filter((source) => {
      const value = normalized(source.text);
      return (
        value !== "" &&
        parent.includes(value) &&
        !selected.span.normalizedText.includes(value)
      );
    })
    .map((source) => ({ cue: source, span: spanFromCue(source) }));
  if (
    omitted.length === 0 ||
    omitted.some((unit) => overlapRatio(selected.cue, unit.cue) < 0.6)
  ) {
    return null;
  }
  return { selected, omitted };
}

function mergeTiming(
  parent: SubtitleCue,
  units: readonly CandidateUnit[],
): Pick<SubtitleCue, "start" | "end" | "timingEvidence"> {
  const sources = units
    .map((unit) => unit.cue)
    .filter((cue): cue is SubtitleCue => cue !== null);
  const intervals = units
    .map((unit) => unit.span.interval)
    .filter((value): value is NonNullable<Span["interval"]> => value !== null);
  if (intervals.length === 0) {
    return {
      start: parent.start,
      end: parent.end,
      timingEvidence: parent.timingEvidence,
    };
  }
  const start = Math.max(
    parent.start,
    Math.min(...intervals.map((value) => value.start)),
  );
  const end = Math.min(
    parent.end,
    Math.max(...intervals.map((value) => value.end)),
  );
  const speechIntervals = sources.flatMap(
    (source) => source.timingEvidence?.speechIntervals ?? [],
  );
  const tokens = sources.flatMap(
    (source) => source.timingEvidence?.tokens ?? [],
  );
  return {
    start,
    end: Math.max(start + 0.001, end),
    timingEvidence: {
      sourceTrusted: sources.every(
        (source) => source.timingEvidence?.sourceTrusted === true,
      ),
      speechStart:
        speechIntervals.length === 0
          ? start
          : Math.min(...speechIntervals.map((value) => value.start)),
      speechEnd:
        speechIntervals.length === 0
          ? end
          : Math.max(...speechIntervals.map((value) => value.end)),
      tokenTimestampsAvailable: tokens.length > 0,
      tokenTimestampsUsed: tokens.length > 0,
      tokens,
      alignmentSource: tokens.length > 0 ? "token" : "semantic",
      presentationTimingMethod: tokens.length > 0 ? "token" : "semantic",
      ...(speechIntervals.length === 0 ? {} : { speechIntervals }),
    },
  };
}

function withTextAudit(
  cue: SubtitleCue,
  text: string,
  action: string,
  reviewRecommended: boolean,
): SubtitleCue {
  return {
    ...cue,
    text,
    textAudit: {
      rawAsrText: cue.textAudit?.rawAsrText ?? cue.text,
      repairedText: text,
      normalizedText: text,
      winnerClusterIds: cue.textAudit?.winnerClusterIds ?? [],
      sourceWinnerCueIds: cue.textAudit?.sourceWinnerCueIds ?? [cue.id],
      ...(cue.textAudit?.winnerScore === undefined
        ? {}
        : { winnerScore: cue.textAudit.winnerScore }),
      ...(cue.textAudit?.runnerUpCueId === undefined
        ? {}
        : { runnerUpCueId: cue.textAudit.runnerUpCueId }),
      ...(cue.textAudit?.runnerUpScore === undefined
        ? {}
        : { runnerUpScore: cue.textAudit.runnerUpScore }),
      ...(cue.textAudit?.scoreGap === undefined
        ? {}
        : { scoreGap: cue.textAudit.scoreGap }),
      replacements: cue.textAudit?.replacements ?? [],
      deduplicationActions: [
        ...(cue.textAudit?.deduplicationActions ?? []),
        action,
      ],
      repairType: "intra-cue-hypothesis-deduplication",
      ...(cue.textAudit?.timingDonorCueId === undefined
        ? {}
        : { timingDonorCueId: cue.textAudit.timingDonorCueId }),
      ...(cue.textAudit?.timingRepairMethod === undefined
        ? {}
        : { timingRepairMethod: cue.textAudit.timingRepairMethod }),
      reviewRecommended:
        reviewRecommended || (cue.textAudit?.reviewRecommended ?? false),
      reviewReasons: [
        ...new Set([
          ...(cue.textAudit?.reviewReasons ?? []),
          ...(reviewRecommended ? ["INTRA_CUE_HYPOTHESIS_DEDUPLICATED"] : []),
        ]),
      ],
    },
  };
}

export function repairIntraCueHypothesisRepetition(input: {
  cues: readonly SubtitleCue[];
  sourceCues?: readonly SubtitleCue[];
  terminologyEntries?: readonly JapaneseTerminologyEntry[];
}): { cues: SubtitleCue[]; artifact: IntraCueRepetitionRepairArtifact } {
  const sourceCues = input.sourceCues ?? input.cues;
  const sourceById = new Map(sourceCues.map((cue) => [cue.id, cue] as const));
  const records: IntraCueRepetitionRepairArtifact["records"] = [];
  let japaneseSpacesRemoved = 0;
  const output = input.cues.flatMap((original) => {
    const rawAsrText = original.textAudit?.rawAsrText;
    const comparable = (value: string) =>
      normalizeJapaneseSubtitleWhitespace(value)
        .normalize("NFKC")
        .replace(/[♪\s、。，．,.!?！？…「」『』（）【】]/gu, "");
    const typographySource =
      original.language === "ja" &&
      rawAsrText !== undefined &&
      comparable(rawAsrText) === comparable(original.text)
        ? rawAsrText
        : original.text;
    const normalizedText =
      original.language === "ja"
        ? normalizeJapaneseSubtitleWhitespace(typographySource)
        : original.text.replace(/[\t\u3000 ]+/gu, " ").trim();
    japaneseSpacesRemoved += Math.max(
      0,
      Array.from(original.text).filter((character) =>
        /[ \t\u3000]/u.test(character),
      ).length -
        Array.from(normalizedText).filter((character) =>
          /[ \t\u3000]/u.test(character),
        ).length,
    );
    const cue =
      normalizedText === original.text
        ? original
        : withTextAudit(
            original,
            normalizedText,
            "japanese-interword-spacing-normalized",
            false,
          );
    const detected = detectIntraCueHypothesisRepetition({
      cue,
      sourceCues,
    });
    if (detected === null) {
      const expansion = unsupportedMergedExpansion({
        cue,
        sourceById,
        allSources: sourceCues,
        terminology: input.terminologyEntries ?? [],
      });
      if (expansion === null) return [cue];
      const timing = mergeTiming(cue, [expansion.selected]);
      const selectedText = normalizeJapaneseSubtitleWhitespace(
        expansion.selected.span.text,
      );
      const repaired = withTextAudit(
        {
          ...cue,
          id: `${cue.id}-intra-cue-dedup`,
          start: timing.start,
          end: timing.end,
          ...(timing.timingEvidence === undefined
            ? {}
            : { timingEvidence: timing.timingEvidence }),
        },
        selectedText,
        `unsupported-merged-expansion:${expansion.selected.span.sourceCueIds.join(",")}`,
        true,
      );
      records.push({
        cueId: cue.id,
        sourceCueIds: [
          ...new Set([
            ...expansion.selected.span.sourceCueIds,
            ...expansion.omitted.flatMap((unit) => unit.span.sourceCueIds),
          ]),
        ],
        detectedRepeatedSpans: [
          expansion.selected.span,
          ...expansion.omitted.map((unit) => unit.span),
        ],
        normalizedSpans: [
          expansion.selected.span.normalizedText,
          ...expansion.omitted.map((unit) => unit.span.normalizedText),
        ],
        readingEvidence: [
          "complete-source-candidate-contained-by-merged-output",
        ],
        relationship: "containment-alternative",
        keptSpan: {
          ...expansion.selected.span,
          text: selectedText,
          normalizedText: normalized(selectedText),
        },
        removedSpans: expansion.omitted.map((unit) => unit.span),
        preservedTail: [],
        selectedReason:
          "complete-high-support-source-with-only-overlapping-appended-fragments",
        audioRepetitionEvidence: [
          "omitted-fragments-overlap-selected-source-interval",
          "no-independent-timed-continuation",
        ],
        reviewRecommended: true,
        outputCueIds: [repaired.id],
      });
      return [repaired];
    }
    if (detected.relationship === "true-spoken-repetition") {
      const keptSpan: Span = {
        text: cue.text,
        normalizedText: normalized(cue.text),
        sourceCueIds: cue.textAudit?.sourceWinnerCueIds ?? [cue.id],
        interval: { start: cue.start, end: cue.end },
      };
      records.push({
        cueId: cue.id,
        sourceCueIds: keptSpan.sourceCueIds,
        detectedRepeatedSpans: detected.units.map((unit) => unit.span),
        normalizedSpans: detected.units.map((unit) => unit.span.normalizedText),
        readingEvidence: detected.readingEvidence,
        relationship: detected.relationship,
        keptSpan,
        removedSpans: [],
        preservedTail: [],
        selectedReason:
          "independent-audio-timestamps-preserve-spoken-repetition",
        audioRepetitionEvidence: detected.audioRepetitionEvidence,
        reviewRecommended: false,
        outputCueIds: [cue.id],
      });
      return [cue];
    }
    const ranked = detected.units.toSorted(
      (left, right) =>
        candidateSupport(right, sourceCues, input.terminologyEntries ?? []) -
          candidateSupport(left, sourceCues, input.terminologyEntries ?? []) ||
        right.span.normalizedText.length - left.span.normalizedText.length ||
        left.span.sourceCueIds
          .join()
          .localeCompare(right.span.sourceCueIds.join()),
    );
    const selected = ranked[0];
    if (selected === undefined) return [cue];
    const timing = mergeTiming(cue, detected.units);
    const selectedText = normalizeJapaneseSubtitleWhitespace(
      selected.span.text,
    );
    const repaired = withTextAudit(
      {
        ...cue,
        id: `${cue.id}-intra-cue-dedup`,
        start: timing.start,
        end: timing.end,
        ...(timing.timingEvidence === undefined
          ? {}
          : { timingEvidence: timing.timingEvidence }),
      },
      selectedText,
      `${detected.relationship}:${selected.span.sourceCueIds.join(",")}`,
      true,
    );
    const repeatedIds = new Set(
      detected.units.flatMap((unit) => unit.span.sourceCueIds),
    );
    const tails = candidateUnits(cue, sourceById)
      .filter(
        (unit) =>
          !unit.span.sourceCueIds.some((id) => repeatedIds.has(id)) &&
          unit.cue !== null &&
          unit.span.interval !== null &&
          unit.span.interval.end - unit.span.interval.start >= 0.25 &&
          bigramSimilarity(unit.span.text, selectedText) < 0.72 &&
          ((unit.cue.timingEvidence?.speechIntervals?.length ?? 0) > 0 ||
            (unit.cue.timingEvidence?.tokens.length ?? 0) > 0 ||
            unit.cue.timingEvidence?.sourceTrusted === true),
      )
      .toSorted(
        (left, right) =>
          candidateSupport(right, sourceCues, input.terminologyEntries ?? []) -
            candidateSupport(
              left,
              sourceCues,
              input.terminologyEntries ?? [],
            ) ||
          right.span.normalizedText.length - left.span.normalizedText.length,
      )
      .filter(
        (unit, index, units) =>
          units.findIndex(
            (other) =>
              other.span.normalizedText === unit.span.normalizedText ||
              isHighContainmentRepetition(
                other.span.text,
                unit.span.text,
                6,
                0.72,
              ),
          ) === index,
      )
      .map((unit, index) => {
        const source = unit.cue;
        if (source === null || unit.span.interval === null) {
          throw new Error("A preserved tail requires a timed source cue.");
        }
        return withTextAudit(
          {
            ...source,
            id: `${cue.id}-preserved-tail-${String(index + 1).padStart(2, "0")}`,
          },
          normalizeJapaneseSubtitleWhitespace(source.text),
          "preserved-nonduplicate-timed-tail",
          true,
        );
      });
    const outputs = [repaired, ...tails].toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
    records.push({
      cueId: cue.id,
      sourceCueIds: [
        ...new Set(detected.units.flatMap((unit) => unit.span.sourceCueIds)),
      ],
      detectedRepeatedSpans: detected.units.map((unit) => unit.span),
      normalizedSpans: detected.units.map((unit) => unit.span.normalizedText),
      readingEvidence: detected.readingEvidence,
      relationship: detected.relationship,
      keptSpan: {
        ...selected.span,
        text: selectedText,
        normalizedText: normalized(selectedText),
      },
      removedSpans: detected.units
        .filter((unit) => unit !== selected)
        .map((unit) => unit.span),
      preservedTail: tails.map(spanFromCue),
      selectedReason:
        "highest-terminology-independent-support-top-score-timing-and-completeness-evidence",
      audioRepetitionEvidence: detected.audioRepetitionEvidence,
      reviewRecommended: true,
      outputCueIds: outputs.map((outputCue) => outputCue.id),
    });
    return outputs;
  });
  const cues = output.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const repairedRecords = records.filter(
    (record) => record.relationship !== "true-spoken-repetition",
  );
  return {
    cues,
    artifact: intraCueRepetitionRepairArtifactSchema.parse({
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      inputHash: hash(input.cues),
      outputHash: hash(cues),
      records,
      summary: {
        inputCueCount: input.cues.length,
        outputCueCount: cues.length,
        detectedCueCount: records.length,
        repairedCueCount: repairedRecords.length,
        trueSpokenRepetitionCount: records.filter(
          (record) => record.relationship === "true-spoken-repetition",
        ).length,
        removedSpanCount: repairedRecords.reduce(
          (sum, record) => sum + record.removedSpans.length,
          0,
        ),
        preservedTailCount: repairedRecords.reduce(
          (sum, record) => sum + record.preservedTail.length,
          0,
        ),
        japaneseSpacesRemoved,
      },
      fallback:
        records.length === 0 ? "no-intra-cue-hypothesis-repetition" : null,
    }),
  };
}
