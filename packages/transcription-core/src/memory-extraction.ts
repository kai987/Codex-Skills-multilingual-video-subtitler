import {
  episodeLanguageCandidateSchema,
  episodeLanguageObservationsSchema,
  type CorrectionFeedback,
  type EpisodeIdentity,
  type EpisodeLanguageCandidate,
  type EpisodeLanguageObservations,
  type SeriesIdentity,
  type SeriesMemoryEvidence,
  type SubtitleCanonicalAlignmentInput,
  type SubtitleCanonicalPronunciation,
  type SubtitleCue,
} from "@mvl/shared";

import { stableMemoryHash } from "./series-memory.js";

const COMMON_WORDS = new Set([
  "今日",
  "昨日",
  "毎日",
  "一番",
  "一人",
  "今度",
  "今年",
  "自分",
  "名前",
  "子供",
  "学校",
  "大丈夫",
  "普通",
  "本当",
  "これ",
  "それ",
  "そこ",
  "この",
  "あんた",
  "です",
  "ない",
  "もっと",
  "いい",
  "うまい",
  "奥さん",
  "調子",
  "上手",
  "下手",
]);

const EXCLUDED_POS = new Set([
  "助詞",
  "助動詞",
  "空白",
  "補助記号",
  "記号",
  "連体詞",
  "代名詞",
]);

const DIALECT_PATTERNS = [
  { expression: /あきまへん/gu, name: "kansai-mahen" },
  { expression: /買うた/gu, name: "kansai-u-onbin" },
  { expression: /まへん/gu, name: "kansai-mahen-suffix" },
  { expression: /へん/gu, name: "kansai-hen-suffix" },
  { expression: /せんと/gu, name: "kansai-sento-suffix" },
  { expression: /やろ/gu, name: "kansai-yaro-suffix" },
] as const;

interface RawOccurrence {
  cueId: string;
  cueStart: number;
  startCharacter: number;
  endCharacter: number;
  surface: string;
  reading: string | null;
  pronunciationPhones: string[];
  dictionaryForm: string | null;
  normalizedForm: string | null;
  partOfSpeech: string[];
  entryType: EpisodeLanguageCandidate["entryType"];
  dialectPattern: string | null;
  sourceTypes: SeriesMemoryEvidence["sourceType"][];
  observedWrongForms: string[];
}

function hiraganaToKatakana(value: string | null): string | null {
  if (value === null) return null;
  return value.replace(/[ぁ-ゖ]/gu, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return String.fromCodePoint(code + 0x60);
  });
}

function makeEvidence(input: {
  occurrence: RawOccurrence;
  seriesKey: string;
  episodeId: string;
  sourceArtifactHash: string;
  sourceType: SeriesMemoryEvidence["sourceType"];
}): SeriesMemoryEvidence {
  const occurrenceId = `memory-occurrence-${stableMemoryHash({
    seriesKey: input.seriesKey,
    episodeId: input.episodeId,
    cueId: input.occurrence.cueId,
    startCharacter: input.occurrence.startCharacter,
    endCharacter: input.occurrence.endCharacter,
    surface: input.occurrence.surface,
  }).slice(0, 24)}`;
  const seed = {
    episodeId: input.episodeId,
    cueId: input.occurrence.cueId,
    sourceType: input.sourceType,
    sourceArtifactHash: input.sourceArtifactHash,
    occurrenceId,
    observedAtSeconds: input.occurrence.cueStart,
    surface: input.occurrence.surface,
    reading: input.occurrence.reading,
  };
  const evidenceLineageId = `memory-lineage-${stableMemoryHash(seed).slice(0, 24)}`;
  const base = {
    evidenceId: `memory-evidence-${stableMemoryHash({ seed, evidenceLineageId }).slice(0, 24)}`,
    evidenceLineageId,
    ...seed,
  };
  return {
    ...base,
    semanticHash: stableMemoryHash(base),
  };
}

function pronunciationByCueAndSurface(
  pronunciation: SubtitleCanonicalPronunciation | null,
): Map<string, { phones: string[] }> {
  const result = new Map<string, { phones: string[] }>();
  for (const cue of pronunciation?.cues ?? []) {
    for (const unit of cue.wordUnits) {
      if (unit.punctuation) continue;
      result.set(`${cue.cueId}\u0000${unit.surface}`, {
        phones: [...unit.phones],
      });
    }
  }
  return result;
}

function alignmentOccurrences(input: {
  alignment: SubtitleCanonicalAlignmentInput | null;
  pronunciation: SubtitleCanonicalPronunciation | null;
  cueById: Map<string, SubtitleCue>;
}): RawOccurrence[] {
  const pronunciations = pronunciationByCueAndSurface(input.pronunciation);
  const result: RawOccurrence[] = [];
  for (const cue of input.alignment?.cues ?? []) {
    const canonicalCue = input.cueById.get(cue.cueId);
    if (canonicalCue === undefined) continue;
    for (const morpheme of cue.morphemes) {
      const pos = morpheme.partOfSpeech;
      const surface = morpheme.surface.normalize("NFC");
      if (
        surface.trim().length < 2 ||
        EXCLUDED_POS.has(pos[0] ?? "") ||
        COMMON_WORDS.has(surface)
      ) {
        continue;
      }
      const proper = pos.includes("固有名詞");
      const person = proper && pos.includes("人名");
      result.push({
        cueId: cue.cueId,
        cueStart: canonicalCue.start,
        startCharacter: morpheme.startCharacter,
        endCharacter: morpheme.endCharacter,
        surface,
        reading: morpheme.reading,
        pronunciationPhones:
          pronunciations.get(`${cue.cueId}\u0000${surface}`)?.phones ?? [],
        dictionaryForm: morpheme.dictionaryForm,
        normalizedForm: morpheme.normalizedSurface,
        partOfSpeech: pos,
        entryType: person
          ? "person-name"
          : proper
            ? "proper-noun"
            : "terminology",
        dialectPattern:
          morpheme.dialectSurface === null ? null : "sudachi-dialect",
        sourceTypes: [
          "human-reviewed-canonical",
          ...(morpheme.readingSource === "sudachi-dictionary"
            ? (["sudachi-dictionary"] as const)
            : []),
          ...(pronunciations.has(`${cue.cueId}\u0000${surface}`)
            ? (["mfa-dictionary"] as const)
            : []),
        ],
        observedWrongForms: [],
      });
    }
  }
  return result;
}

function compoundOccurrences(cues: readonly SubtitleCue[]): RawOccurrence[] {
  const result: RawOccurrence[] = [];
  for (const cue of cues) {
    const expression = /[一-龯々〆ヵヶ]{2,}|[ァ-ヶー]{2,}/gu;
    for (const match of cue.text.matchAll(expression)) {
      const surface = match[0].normalize("NFC");
      if (COMMON_WORDS.has(surface) || surface.length > 12) continue;
      result.push({
        cueId: cue.id,
        cueStart: cue.start,
        startCharacter: match.index,
        endCharacter: match.index + match[0].length,
        surface,
        reading: null,
        pronunciationPhones: [],
        dictionaryForm: surface,
        normalizedForm: surface,
        partOfSpeech: ["名詞", "複合語", "human-reviewed-canonical"],
        entryType: "terminology",
        dialectPattern: null,
        sourceTypes: ["human-reviewed-canonical"],
        observedWrongForms: [],
      });
    }
  }
  return result;
}

function dialectOccurrences(cues: readonly SubtitleCue[]): RawOccurrence[] {
  const result: RawOccurrence[] = [];
  for (const cue of cues) {
    for (const pattern of DIALECT_PATTERNS) {
      for (const match of cue.text.matchAll(pattern.expression)) {
        const surface = match[0].normalize("NFC");
        result.push({
          cueId: cue.id,
          cueStart: cue.start,
          startCharacter: match.index,
          endCharacter: match.index + match[0].length,
          surface,
          reading: /^[ぁ-んー]+$/u.test(surface) ? surface : null,
          pronunciationPhones: [],
          dictionaryForm: surface,
          normalizedForm: surface,
          partOfSpeech: ["dialect-surface", pattern.name],
          entryType: "dialect-form",
          dialectPattern: pattern.name,
          sourceTypes: ["human-reviewed-canonical"],
          observedWrongForms: [],
        });
      }
    }
  }
  return result;
}

function changedCorrectionSpan(input: {
  machineText: string;
  correctedText: string;
}): { canonicalSurface: string; wrongSurface: string | null } | null {
  const machine = input.machineText.normalize("NFC");
  const corrected = input.correctedText.normalize("NFC");
  if (machine === corrected) return null;
  let prefix = 0;
  while (
    prefix < machine.length &&
    prefix < corrected.length &&
    machine[prefix] === corrected[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < machine.length - prefix &&
    suffix < corrected.length - prefix &&
    machine[machine.length - 1 - suffix] ===
      corrected[corrected.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const canonicalSurface = corrected
    .slice(prefix, corrected.length - suffix)
    .trim();
  const wrongSurface = machine.slice(prefix, machine.length - suffix).trim();
  if (canonicalSurface.length === 0) return null;
  return {
    canonicalSurface,
    wrongSurface: wrongSurface.length === 0 ? null : wrongSurface,
  };
}

function correctionOccurrences(input: {
  feedback: CorrectionFeedback | null;
  cues: readonly SubtitleCue[];
}): RawOccurrence[] {
  if (input.feedback === null) return [];
  return input.feedback.records.flatMap((record): RawOccurrence[] => {
    const changed = changedCorrectionSpan(record);
    if (changed === null) return [];
    const cue = [...input.cues].toSorted((left, right) => {
      const leftOverlap = Math.max(
        0,
        Math.min(left.end, record.audioInterval.end) -
          Math.max(left.start, record.audioInterval.start),
      );
      const rightOverlap = Math.max(
        0,
        Math.min(right.end, record.audioInterval.end) -
          Math.max(right.start, record.audioInterval.start),
      );
      return (
        rightOverlap - leftOverlap ||
        Math.abs(left.start - record.audioInterval.start) -
          Math.abs(right.start - record.audioInterval.start) ||
        left.id.localeCompare(right.id)
      );
    })[0];
    if (cue === undefined) return [];
    const startCharacter = Math.max(
      0,
      cue.text.indexOf(changed.canonicalSurface),
    );
    return [
      {
        cueId: cue.id,
        cueStart: record.audioInterval.start,
        startCharacter,
        endCharacter: startCharacter + changed.canonicalSurface.length,
        surface: changed.canonicalSurface,
        reading: record.confirmedReading,
        pronunciationPhones: [],
        dictionaryForm: changed.canonicalSurface,
        normalizedForm: changed.canonicalSurface.normalize("NFKC"),
        partOfSpeech: ["human-correction", ...record.errorTypes],
        entryType: "correction-pair",
        dialectPattern: record.dialectHints[0] ?? null,
        sourceTypes: ["human-correction"],
        observedWrongForms:
          changed.wrongSurface === null ? [] : [changed.wrongSurface],
      },
    ];
  });
}

function deduplicateOccurrences(
  values: readonly RawOccurrence[],
): RawOccurrence[] {
  const result = new Map<string, RawOccurrence>();
  for (const value of values) {
    const key = stableMemoryHash({
      cueId: value.cueId,
      startCharacter: value.startCharacter,
      endCharacter: value.endCharacter,
      surface: value.surface,
      entryType: value.entryType,
    });
    const prior = result.get(key);
    if (prior === undefined) {
      result.set(key, value);
    } else {
      result.set(key, {
        ...prior,
        reading: prior.reading ?? value.reading,
        pronunciationPhones:
          prior.pronunciationPhones.length > 0
            ? prior.pronunciationPhones
            : value.pronunciationPhones,
        partOfSpeech:
          prior.partOfSpeech[0] === "名詞" &&
          value.partOfSpeech.includes("固有名詞")
            ? value.partOfSpeech
            : prior.partOfSpeech,
        entryType:
          value.entryType === "person-name" || value.entryType === "proper-noun"
            ? value.entryType
            : prior.entryType,
        sourceTypes: [...new Set([...prior.sourceTypes, ...value.sourceTypes])],
        observedWrongForms: [
          ...new Set([
            ...prior.observedWrongForms,
            ...value.observedWrongForms,
          ]),
        ].toSorted(),
      });
    }
  }
  return [...result.values()];
}

function groupCandidates(input: {
  occurrences: readonly RawOccurrence[];
  seriesIdentity: SeriesIdentity;
  episodeIdentity: EpisodeIdentity;
  sourceHashes: Record<string, string>;
}): EpisodeLanguageCandidate[] {
  const canonicalHash = input.sourceHashes.canonical;
  if (canonicalHash === undefined) {
    throw new Error("Canonical source artifact hash is required.");
  }
  const correctionHash = input.sourceHashes.correction;
  const groups = Map.groupBy(
    input.occurrences,
    (value) => `${value.entryType}\u0000${value.surface.normalize("NFKC")}`,
  );
  return [...groups.entries()]
    .map(([key, occurrences]) => {
      const representative = occurrences[0];
      if (representative === undefined)
        throw new Error("Empty occurrence group.");
      const evidence = occurrences.flatMap((occurrence) =>
        occurrence.sourceTypes.map((sourceType) =>
          makeEvidence({
            occurrence,
            seriesKey: input.seriesIdentity.seriesKey,
            episodeId: input.episodeIdentity.episodeId,
            sourceArtifactHash:
              sourceType === "sudachi-dictionary" ||
              sourceType === "mfa-dictionary"
                ? (input.sourceHashes.pronunciation ?? canonicalHash)
                : sourceType === "human-correction"
                  ? (correctionHash ??
                    (() => {
                      throw new Error(
                        "Correction source artifact hash is required for correction feedback.",
                      );
                    })())
                  : canonicalHash,
            sourceType,
          }),
        ),
      );
      const uniqueEvidence = [
        ...new Map(
          evidence.map((value) => [value.evidenceLineageId, value]),
        ).values(),
      ].toSorted((left, right) =>
        left.evidenceLineageId.localeCompare(right.evidenceLineageId),
      );
      const occurrenceIds = [
        ...new Set(uniqueEvidence.map((value) => value.occurrenceId)),
      ].toSorted();
      const base = {
        candidateId: `memory-candidate-${stableMemoryHash({
          seriesKey: input.seriesIdentity.seriesKey,
          key,
        }).slice(0, 24)}`,
        entryType: representative.entryType,
        canonicalSurface: representative.surface,
        reading: representative.reading,
        pronunciationPhones: representative.pronunciationPhones,
        dictionaryForm: representative.dictionaryForm,
        normalizedForm: representative.normalizedForm,
        partOfSpeech: representative.partOfSpeech,
        observedWrongForms: [
          ...new Set(occurrences.flatMap((value) => value.observedWrongForms)),
        ].toSorted(),
        dialectMetadata: {
          isDialectCandidate: representative.entryType === "dialect-form",
          status:
            representative.entryType === "dialect-form"
              ? "verified"
              : "not-dialect",
          region: "unknown",
          surfaceForm:
            representative.entryType === "dialect-form"
              ? representative.surface
              : null,
          dialectPattern: representative.dialectPattern,
          standardEquivalent: null,
          equivalenceSource: null,
          markerType: representative.dialectPattern,
          preserveSurface: representative.entryType === "dialect-form",
          preservationRequired: representative.entryType === "dialect-form",
        },
        occurrenceIds,
        evidence: uniqueEvidence,
        occurrenceCount: occurrenceIds.length,
        humanReviewed: true,
        commonWord:
          representative.entryType !== "correction-pair" &&
          COMMON_WORDS.has(representative.surface),
        blockers: [],
      };
      return episodeLanguageCandidateSchema.parse({
        ...base,
        semanticHash: stableMemoryHash(base),
      });
    })
    .toSorted((left, right) =>
      left.canonicalSurface.localeCompare(right.canonicalSurface, "ja"),
    );
}

export function extractEpisodeLanguageObservations(input: {
  cues: readonly SubtitleCue[];
  alignment?: SubtitleCanonicalAlignmentInput | null;
  pronunciation?: SubtitleCanonicalPronunciation | null;
  seriesIdentity: SeriesIdentity;
  episodeIdentity: EpisodeIdentity;
  sourceArtifactHashes: Record<string, string>;
  correctionFeedback?: CorrectionFeedback | null;
  generatedAt?: string;
  maximumCandidateCount?: number;
}): EpisodeLanguageObservations {
  const cueById = new Map(input.cues.map((cue) => [cue.id, cue]));
  const raw = deduplicateOccurrences([
    ...alignmentOccurrences({
      alignment: input.alignment ?? null,
      pronunciation: input.pronunciation ?? null,
      cueById,
    }),
    ...compoundOccurrences(input.cues),
    ...dialectOccurrences(input.cues),
    ...correctionOccurrences({
      feedback: input.correctionFeedback ?? null,
      cues: input.cues,
    }),
  ]);
  const rawCandidates = groupCandidates({
    occurrences: raw,
    seriesIdentity: input.seriesIdentity,
    episodeIdentity: input.episodeIdentity,
    sourceHashes: input.sourceArtifactHashes,
  });
  const rejectedCommon = rawCandidates.filter((value) => value.commonWord);
  const maximum = input.maximumCandidateCount ?? 128;
  const candidates = rawCandidates
    .filter((value) => !value.commonWord)
    .toSorted((left, right) => {
      const leftScore =
        (left.entryType.includes("name") || left.entryType === "proper-noun"
          ? 4
          : 0) +
        (left.reading === null ? 0 : 2) +
        Math.min(3, left.occurrenceCount);
      const rightScore =
        (right.entryType.includes("name") || right.entryType === "proper-noun"
          ? 4
          : 0) +
        (right.reading === null ? 0 : 2) +
        Math.min(3, right.occurrenceCount);
      return (
        rightScore - leftScore ||
        left.canonicalSurface.localeCompare(right.canonicalSurface, "ja")
      );
    })
    .slice(0, maximum)
    .toSorted((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    );
  const candidateIdsByCue = new Map<string, string[]>();
  for (const candidate of candidates) {
    for (const cueId of new Set(
      candidate.evidence.map((value) => value.cueId),
    )) {
      candidateIdsByCue.set(cueId, [
        ...(candidateIdsByCue.get(cueId) ?? []),
        candidate.candidateId,
      ]);
    }
  }
  const cueObservations = input.cues.map((cue) => ({
    cueId: cue.id,
    start: cue.start,
    end: cue.end,
    canonicalTextHash: stableMemoryHash(cue.text),
    candidateIds: (candidateIdsByCue.get(cue.id) ?? []).toSorted(),
  }));
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "episode-language-observations" as const,
    observationVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    seriesIdentity: input.seriesIdentity,
    episodeIdentity: input.episodeIdentity,
    cueObservations,
    termCandidates: candidates.filter((value) =>
      [
        "terminology",
        "regional-term",
        "domain-term",
        "fixed-expression",
      ].includes(value.entryType),
    ),
    properNounCandidates: candidates.filter((value) =>
      [
        "proper-noun",
        "person-name",
        "place-name",
        "organization-name",
        "title-name",
      ].includes(value.entryType),
    ),
    dialectCandidates: candidates.filter(
      (value) => value.entryType === "dialect-form",
    ),
    correctionObservations: candidates.filter(
      (value) => value.entryType === "correction-pair",
    ),
    pronunciationObservations: candidates.filter(
      (value) => value.reading !== null || value.pronunciationPhones.length > 0,
    ),
    statistics: {
      sourceCueCount: input.cues.length,
      memoryCandidateCount: rawCandidates.length,
      memoryRejectedCommonWordCount: rejectedCommon.length,
      memoryRejectedLowEvidenceCount: Math.max(
        0,
        rawCandidates.length - rejectedCommon.length - candidates.length,
      ),
      duplicateMemoryEvidenceCount:
        raw.length -
        new Set(
          raw.map((value) =>
            stableMemoryHash({
              cueId: value.cueId,
              start: value.startCharacter,
              end: value.endCharacter,
              surface: value.surface,
            }),
          ),
        ).size,
    },
    sourceArtifactHashes: input.sourceArtifactHashes,
  };
  return episodeLanguageObservationsSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}

export { COMMON_WORDS, hiraganaToKatakana };
