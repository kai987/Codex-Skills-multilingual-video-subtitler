import { createHash } from "node:crypto";

import {
  japaneseLexicalNormalizationArtifactSchema,
  type AtomicHypothesisClustersArtifact,
  type JapaneseLexicalNormalizationArtifact,
  type JapaneseNormalizationMode,
  type JapaneseTerminologyEntry,
  type SubtitleCue,
} from "@mvl/shared";
import { analyzeJapaneseText } from "@mvl/subtitle-core";

export interface ContextualJapaneseNormalizationInput {
  cues: readonly SubtitleCue[];
  allCandidates?: readonly SubtitleCue[];
  atomicClusters?: AtomicHypothesisClustersArtifact;
  terminologyEntries?: readonly JapaneseTerminologyEntry[];
  terminologySha256?: string | null;
  mode?: JapaneseNormalizationMode;
  readingAnalyzer?: JapaneseReadingAnalyzer;
}

export interface ContextualJapaneseNormalizationResult {
  cues: SubtitleCue[];
  artifact: JapaneseLexicalNormalizationArtifact;
}

interface LexicalCandidate {
  text: string;
  score: number;
  replacements: JapaneseLexicalNormalizationArtifact["cues"][number]["replacements"];
  reasons: string[];
  readingEvidence: string[];
  sameClusterSupport: string[];
  properNounEvidence: string[];
  dialectProtection: string[];
}

export interface JapaneseReadingResult {
  reading: string | null;
  oov: boolean;
  evidence: string[];
}

export interface JapaneseReadingAnalyzer {
  readonly id: string;
  analyze(text: string): JapaneseReadingResult;
}

const BUILTIN_READINGS = new Map([
  ["着物", "きもの"],
  ["小原", "おはら"],
  ["糸子", "いとこ"],
  ["奈津", "なつ"],
  ["善作", "ぜんさく"],
  ["神戸", "こうべ"],
  ["岸和田", "きしわだ"],
  ["大正", "たいしょう"],
]);

const DIALECT_FORMS = [
  "うち",
  "なんや",
  "せえへん",
  "あんじょう",
  "やけど",
  "よって",
  "あこ",
  "だんじり",
];

function katakanaToHiragana(value: string): string {
  return Array.from(value)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x30a1 && code <= 0x30f6
        ? String.fromCodePoint(code - 0x60)
        : character;
    })
    .join("");
}

export const builtinJapaneseReadingAnalyzer: JapaneseReadingAnalyzer = {
  id: "builtin-kana-and-confirmed-lexeme-readings-v1",
  analyze(text) {
    let reading = normalizeSurface(text);
    let matched = false;
    for (const [surface, value] of BUILTIN_READINGS) {
      if (reading.includes(surface)) {
        reading = reading.split(surface).join(value);
        matched = true;
      }
    }
    reading = katakanaToHiragana(reading).replace(
      /[^\p{Script=Hiragana}\p{Script=Han}\p{L}\p{N}]/gu,
      "",
    );
    const oov = /[\p{Script=Han}]/u.test(reading);
    return {
      reading: oov ? null : reading,
      oov,
      evidence: [
        "katakana-normalized-to-hiragana",
        ...(matched ? ["confirmed-builtin-lexeme-reading"] : []),
        ...(oov ? ["unresolved-kanji-oov"] : []),
      ],
    };
  },
};

function readingSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const a = new Set(Array.from(left));
  const b = new Set(Array.from(right));
  const common = [...a].filter((value) => b.has(value)).length;
  return (2 * common) / Math.max(1, a.size + b.size);
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeSurface(value: string): string {
  return value.normalize("NFKC");
}

function containsKatakana(value: string): boolean {
  return /[\p{Script=Katakana}]/u.test(value);
}

function containsHan(value: string): boolean {
  return /[\p{Script=Han}]/u.test(value);
}

function sourceClusterAlternatives(input: {
  cue: SubtitleCue;
  allCandidates: readonly SubtitleCue[];
  atomicClusters?: AtomicHypothesisClustersArtifact;
}): SubtitleCue[] {
  const clusterIds = input.cue.textAudit?.winnerClusterIds ?? [];
  const candidateIds = new Set(
    input.atomicClusters?.clusters
      .filter((cluster) => clusterIds.includes(cluster.id))
      .flatMap((cluster) => cluster.candidateCueIds) ?? [],
  );
  return input.allCandidates.filter(
    (candidate) =>
      candidateIds.has(candidate.id) && candidate.id !== input.cue.id,
  );
}

function candidateForEntry(input: {
  text: string;
  entry: JapaneseTerminologyEntry;
  alternatives: readonly SubtitleCue[];
}): LexicalCandidate | null {
  const terms = [...new Set([...input.entry.variants, ...input.entry.readings])]
    .filter((value) => value !== input.entry.canonical)
    .toSorted(
      (left, right) => right.length - left.length || left.localeCompare(right),
    );
  const matched = terms.find((term) => input.text.includes(term));
  if (matched === undefined) return null;
  const evidence = [
    `terminology-source:${input.entry.source}`,
    `terminology-confidence:${input.entry.confidence.toFixed(3)}`,
    `terminology-category:${input.entry.category}`,
  ];
  const alternativeSupport = input.alternatives.filter((candidate) =>
    normalizeSurface(candidate.text).includes(input.entry.canonical),
  );
  if (alternativeSupport.length > 0) {
    evidence.push(
      `same-atomic-cluster-canonical-support:${alternativeSupport.map((cue) => cue.id).join(",")}`,
    );
  }
  return {
    text: input.text.split(matched).join(input.entry.canonical),
    score:
      0.55 +
      input.entry.confidence * 0.35 +
      Math.min(0.1, alternativeSupport.length * 0.05),
    replacements: [
      {
        original: matched,
        replacement: input.entry.canonical,
        category: input.entry.category,
        confidence: input.entry.confidence,
        evidence,
      },
    ],
    reasons: ["contextual-terminology-candidate", ...evidence],
    readingEvidence: input.entry.readings.map(
      (reading) => `terminology-reading:${reading}`,
    ),
    sameClusterSupport: alternativeSupport.map((cue) => cue.id),
    properNounEvidence: ["person", "place"].includes(input.entry.category)
      ? [`verified-terminology:${input.entry.canonical}`]
      : [],
    dialectProtection:
      input.entry.category === "dialect"
        ? [`registered-dialect:${input.entry.canonical}`]
        : [],
  };
}

function clusterLexicalCandidates(input: {
  currentText: string;
  alternatives: readonly SubtitleCue[];
  analyzer: JapaneseReadingAnalyzer;
}): LexicalCandidate[] {
  const currentReading = input.analyzer.analyze(input.currentText);
  if (currentReading.reading === null) return [];
  const currentReadingText = currentReading.reading;
  return input.alternatives.flatMap((alternative) => {
    const alternativeReading = input.analyzer.analyze(alternative.text);
    if (alternativeReading.reading === null) return [];
    const equivalence = readingSimilarity(
      currentReadingText,
      alternativeReading.reading,
    );
    if (equivalence < 0.96) return [];
    const currentHan = Array.from(input.currentText).filter((character) =>
      /\p{Script=Han}/u.test(character),
    ).length;
    const alternativeHan = Array.from(alternative.text).filter((character) =>
      /\p{Script=Han}/u.test(character),
    ).length;
    const independentSupport = new Set(
      input.alternatives
        .filter(
          (candidate) =>
            normalizeSurface(candidate.text) ===
            normalizeSurface(alternative.text),
        )
        .map((candidate) => candidate.provenance?.sourceLayer ?? candidate.id),
    ).size;
    if (alternativeHan <= currentHan || independentSupport < 1) return [];
    const evidence = [
      `reading-equivalence:${equivalence.toFixed(3)}`,
      `reading-analyzer:${input.analyzer.id}`,
      `same-cluster-candidate:${alternative.id}`,
      `independent-support:${String(independentSupport)}`,
      ...currentReading.evidence,
      ...alternativeReading.evidence,
    ];
    return [
      {
        text: alternative.text,
        score:
          0.58 +
          equivalence * 0.18 +
          Math.min(0.12, independentSupport * 0.06) +
          Math.min(0.08, (alternativeHan - currentHan) * 0.02),
        replacements: [
          {
            original: input.currentText,
            replacement: alternative.text,
            category: "same-cluster-orthography",
            confidence: Math.min(
              1,
              equivalence * 0.9 + independentSupport * 0.05,
            ),
            evidence,
          },
        ],
        reasons: [
          "same-cluster-reading-equivalent-canonical-form",
          ...evidence,
        ],
        readingEvidence: evidence.filter((value) => value.includes("reading")),
        sameClusterSupport: [alternative.id],
        properNounEvidence: [],
        dialectProtection: [],
      },
    ];
  });
}

function chooseLexicalCandidate(
  candidates: readonly LexicalCandidate[],
): LexicalCandidate {
  const result = [...candidates].toSorted(
    (left, right) =>
      right.score - left.score ||
      Number(analyzeJapaneseText(left.text).likelyIncompleteClause) -
        Number(analyzeJapaneseText(right.text).likelyIncompleteClause) ||
      right.text.length - left.text.length ||
      left.text.localeCompare(right.text),
  )[0];
  if (result === undefined) {
    throw new Error("Cannot choose from an empty lexical candidate collection");
  }
  return result;
}

export function normalizeJapaneseLexicalForm(
  input: ContextualJapaneseNormalizationInput,
): ContextualJapaneseNormalizationResult {
  const mode = input.mode ?? "top-score";
  const entries = [...(input.terminologyEntries ?? [])];
  const allCandidates = input.allCandidates ?? input.cues;
  const readingAnalyzer =
    input.readingAnalyzer ?? builtinJapaneseReadingAnalyzer;
  const artifactEntries: JapaneseLexicalNormalizationArtifact["cues"] = [];
  let kanaToKanjiCount = 0;
  let katakanaNormalizationCount = 0;
  let properNounRepairCount = 0;
  let terminologyRepairCount = 0;
  let dialectPreservedCount = 0;
  const cues = input.cues.map((cue) => {
    const rawText = cue.textAudit?.rawAsrText ?? cue.text;
    const repairedText = cue.textAudit?.repairedText ?? cue.text;
    const alternatives = sourceClusterAlternatives({
      cue,
      allCandidates,
      ...(input.atomicClusters === undefined
        ? {}
        : { atomicClusters: input.atomicClusters }),
    });
    const original: LexicalCandidate = {
      text: repairedText,
      score: 0.6,
      replacements: [],
      reasons: ["original-repaired-text-preserved-as-candidate"],
      readingEvidence: readingAnalyzer.analyze(repairedText).evidence,
      sameClusterSupport: [],
      properNounEvidence: [],
      dialectProtection: DIALECT_FORMS.filter((form) =>
        repairedText.includes(form),
      ).map((form) => `natural-dialect-form:${form}`),
    };
    const dialectProtection = original.dialectProtection;
    const lexicalCandidates = [
      original,
      ...(mode === "off"
        ? []
        : entries.flatMap((entry) => {
            const candidate = candidateForEntry({
              text: repairedText,
              entry,
              alternatives,
            });
            return candidate === null ? [] : [candidate];
          })),
      ...(mode === "off" || dialectProtection.length > 0
        ? []
        : clusterLexicalCandidates({
            currentText: repairedText,
            alternatives,
            analyzer: readingAnalyzer,
          })),
    ];
    const winner = chooseLexicalCandidate(lexicalCandidates);
    const changed = winner.text !== repairedText;
    const reviewReasons = changed
      ? winner.replacements.flatMap((replacement) =>
          replacement.confidence < 0.9
            ? ["LEXICAL_NORMALIZATION_CONFIDENCE_BELOW_0_9"]
            : ["KANA_KANJI_ORTHOGRAPHY_NORMALIZED"],
        )
      : [];
    for (const replacement of winner.replacements) {
      terminologyRepairCount += 1;
      if (
        !containsHan(replacement.original) &&
        containsHan(replacement.replacement)
      ) {
        kanaToKanjiCount += 1;
      }
      if (containsKatakana(replacement.original))
        katakanaNormalizationCount += 1;
      if (["person", "place"].includes(replacement.category)) {
        properNounRepairCount += 1;
      }
    }
    const dialectMatched =
      dialectProtection.length > 0 ||
      entries.some(
        (entry) =>
          entry.category === "dialect" &&
          [entry.canonical, ...entry.variants, ...entry.readings].some((term) =>
            repairedText.includes(term),
          ),
      );
    if (dialectMatched && !changed) dialectPreservedCount += 1;
    artifactEntries.push({
      cueId: cue.id,
      rawText,
      repairedText,
      normalizedText: winner.text,
      changed,
      selectionScore: winner.score,
      replacements: winner.replacements,
      reviewRecommended: reviewReasons.length > 0,
      reasons: [
        ...winner.reasons,
        ...(dialectMatched && !changed
          ? ["registered-dialect-form-preserved"]
          : []),
      ],
      candidateForms: lexicalCandidates.map((candidate) => candidate.text),
      candidateScores: lexicalCandidates.map((candidate) => ({
        text: candidate.text,
        score: candidate.score,
        evidence: candidate.reasons,
      })),
      readingEvidence: winner.readingEvidence,
      sameClusterSupport: winner.sameClusterSupport,
      properNounEvidence: winner.properNounEvidence,
      dialectProtection: [
        ...new Set([...dialectProtection, ...winner.dialectProtection]),
      ],
      selectedReason: winner.reasons[0] ?? "original-stable-fallback",
    });
    return {
      ...cue,
      text: winner.text,
      textAudit: {
        rawAsrText: rawText,
        repairedText,
        normalizedText: winner.text,
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
        replacements: [
          ...(cue.textAudit?.replacements ?? []),
          ...winner.replacements,
        ],
        deduplicationActions: cue.textAudit?.deduplicationActions ?? [],
        ...(cue.textAudit?.repairType === undefined
          ? {}
          : { repairType: cue.textAudit.repairType }),
        ...(cue.textAudit?.timingDonorCueId === undefined
          ? {}
          : { timingDonorCueId: cue.textAudit.timingDonorCueId }),
        ...(cue.textAudit?.timingRepairMethod === undefined
          ? {}
          : { timingRepairMethod: cue.textAudit.timingRepairMethod }),
        reviewRecommended:
          (cue.textAudit?.reviewRecommended ?? false) ||
          reviewReasons.length > 0,
        reviewReasons: [
          ...new Set([
            ...(cue.textAudit?.reviewReasons ?? []),
            ...reviewReasons,
          ]),
        ],
      },
    };
  });
  const artifact = japaneseLexicalNormalizationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash({ cues: input.cues, entries }),
    terminologySha256: input.terminologySha256 ?? null,
    configuration: {
      mode,
      globalReplacementEnabled: false,
      dialectPreservationEnabled: true,
    },
    cues: artifactEntries,
    summary: {
      changedCueCount: artifactEntries.filter((entry) => entry.changed).length,
      kanaToKanjiCount,
      katakanaNormalizationCount,
      properNounRepairCount,
      terminologyRepairCount,
      dialectPreservedCount,
    },
    fallback:
      mode === "off"
        ? "japanese-normalization-disabled-by-user"
        : entries.length === 0 &&
            artifactEntries.every((entry) => entry.candidateForms.length <= 1)
          ? "no-terminology-dictionary-provided; no-safe-contextual-lexical-alternatives"
          : null,
  });
  return { cues, artifact };
}
