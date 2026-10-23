import {
  InputError,
  type ForcedAlignmentPhoneInterval,
  type ForcedAlignmentWordInterval,
} from "@mvl/shared";
import {
  FORCED_ALIGNMENT_OUTPUT_PARSER_VERSION,
  forcedAlignmentSha256,
} from "@mvl/transcription-core";

import {
  alignMfaWordsToCanonicalUnits,
  type MfaCanonicalUnitForMapping,
  type MfaWordUnitMapping,
} from "./mfa-word-unit-mapping.js";

export { FORCED_ALIGNMENT_OUTPUT_PARSER_VERSION };

interface RawTierInterval {
  label: string;
  start: number;
  end: number;
}

export interface ParsedMfaAlignment {
  wordAlignments: ForcedAlignmentWordInterval[];
  phoneAlignments: ForcedAlignmentPhoneInterval[];
  silenceIntervals: {
    start: number;
    end: number;
    coordinateSystem: "original-media-global";
  }[];
  utteranceInterval: {
    start: number;
    end: number;
    coordinateSystem: "original-media-global";
  } | null;
  fileInterval: {
    start: number;
    end: number;
    coordinateSystem: "original-media-global";
  };
  lexicalUtteranceInterval: {
    start: number;
    end: number;
    coordinateSystem: "original-media-global";
  } | null;
  phoneUtteranceInterval: {
    start: number;
    end: number;
    coordinateSystem: "original-media-global";
  } | null;
  selectedUtteranceInterval: {
    start: number;
    end: number;
    coordinateSystem: "original-media-global";
  } | null;
  selectedBoundarySource: "lexical-word-tier" | "phone-tier-fallback" | "none";
  wordUnitMappings: MfaWordUnitMapping[];
  canonicalUnitCoverageRatio: number;
  alignedWordCoverageRatio: number;
  pronunciationUnitCoverageRatio: number;
  expectedPhoneCoverageRatio: number;
  wordWithAnyPhoneRatio: number;
  alignedPhonePlausibilityRatio: number;
  expectedPhoneCount: number;
  alignedExpectedPhoneCount: number;
  unresolvedMappingCount: number;
  ambiguousMappingCount: number;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteTime(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new InputError(`MFA ${field} must be a finite non-negative number.`);
  }
  return value;
}

function parseInterval(value: unknown, tierName: string): RawTierInterval {
  if (!isRecord(value)) {
    throw new InputError(`MFA ${tierName} tier entry must be an object.`);
  }
  const labelValue = value.label ?? value.text ?? value.mark;
  const startValue = value.start ?? value.begin ?? value.xmin;
  const endValue = value.end ?? value.stop ?? value.xmax;
  const label = typeof labelValue === "string" ? labelValue : "";
  const start = finiteTime(startValue, `${tierName}.start`);
  const end = finiteTime(endValue, `${tierName}.end`);
  if (end <= start) {
    throw new InputError(
      `MFA ${tierName} interval is reversed or empty: ${String(start)}-${String(end)}.`,
    );
  }
  return { label, start, end };
}

function arrayFromTier(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return Array.from<unknown>(value);
  if (!isRecord(value)) return null;
  for (const key of ["entries", "intervals", "items"] as const) {
    const candidate: unknown = value[key];
    if (Array.isArray(candidate)) return Array.from<unknown>(candidate);
  }
  return null;
}

function namedTier(
  root: Record<string, unknown>,
  names: readonly string[],
): unknown[] | null {
  for (const name of names) {
    const direct = arrayFromTier(root[name]);
    if (direct !== null) return direct;
  }
  const tiers = root.tiers;
  if (isRecord(tiers)) {
    for (const name of names) {
      const direct = arrayFromTier(tiers[name]);
      if (direct !== null) return direct;
    }
  }
  if (Array.isArray(tiers)) {
    for (const tier of tiers) {
      if (!isRecord(tier)) continue;
      const name = tier.name ?? tier.tierName;
      if (
        typeof name === "string" &&
        names.some(
          (candidate) => candidate.toLowerCase() === name.toLowerCase(),
        )
      ) {
        const values = arrayFromTier(tier);
        if (values !== null) return values;
      }
    }
  }
  return null;
}

function isSilence(label: string): boolean {
  return ["", "sil", "sp", "spn", "<eps>"].includes(label.trim().toLowerCase());
}

function localInterval(value: RawTierInterval) {
  return {
    start: value.start,
    end: value.end,
    coordinateSystem: "attempt-audio-local" as const,
  };
}

function globalInterval(value: RawTierInterval, mediaOffsetSeconds: number) {
  return {
    start: value.start + mediaOffsetSeconds,
    end: value.end + mediaOffsetSeconds,
    coordinateSystem: "original-media-global" as const,
  };
}

/**
 * Parses either MFA JSON or the normalized JSON emitted by the pinned praatio
 * helper. Unknown structures fail closed rather than guessing tier semantics.
 */
export function parseMfaAlignmentOutput(input: {
  value: unknown;
  outputFormat: "json" | "long_textgrid" | "mock-json";
  mediaOffsetSeconds: number;
  canonicalUnits: readonly MfaCanonicalUnitForMapping[];
  expectedPhones: readonly string[];
}): ParsedMfaAlignment {
  if (!["json", "long_textgrid", "mock-json"].includes(input.outputFormat)) {
    throw new InputError(
      `Unsupported MFA output format: ${input.outputFormat}.`,
    );
  }
  if (!isRecord(input.value)) {
    throw new InputError("MFA alignment output must be a JSON object.");
  }
  const rawWords = namedTier(input.value, [
    "words",
    "word",
    "word_tier",
    "wordTier",
  ]);
  const rawPhones = namedTier(input.value, [
    "phones",
    "phone",
    "phone_tier",
    "phoneTier",
  ]);
  if (rawWords === null && rawPhones === null) {
    throw new InputError(
      `MFA ${input.outputFormat} output exposes neither a word nor phone tier.`,
    );
  }
  const words = (rawWords ?? []).map((value) => parseInterval(value, "word"));
  const phones = (rawPhones ?? []).map((value) =>
    parseInterval(value, "phone"),
  );
  const lexicalWords = words.filter((word) => !isSilence(word.label));
  const lexicalPhones = phones.filter((phone) => !isSilence(phone.label));
  if (lexicalWords.length === 0 && lexicalPhones.length === 0) {
    throw new InputError("NO_NON_SILENCE_ALIGNMENT_INTERVAL");
  }
  const wordAlignments = lexicalWords.map(
    (word, index): ForcedAlignmentWordInterval => ({
      alignmentId: `mfa-word-${forcedAlignmentSha256({
        index,
        label: word.label,
        start: word.start,
        end: word.end,
      }).slice(0, 20)}`,
      label: word.label,
      expectedUnitIds: [],
      rawInterval: localInterval(word),
      mappedInterval: globalInterval(word, input.mediaOffsetSeconds),
      oov: /(?:<unk>|\[oov\]|<oov>|\*unknown\*)/iu.test(word.label),
      mappingIds: [],
    }),
  );
  const phoneAlignments = lexicalPhones.map(
    (phone, index): ForcedAlignmentPhoneInterval => {
      const parent = wordAlignments.find(
        (word) =>
          phone.start >= word.rawInterval.start - 1e-6 &&
          phone.end <= word.rawInterval.end + 1e-6,
      );
      return {
        alignmentId: `mfa-phone-${forcedAlignmentSha256({
          index,
          label: phone.label,
          start: phone.start,
          end: phone.end,
        }).slice(0, 20)}`,
        label: phone.label,
        wordAlignmentId: parent?.alignmentId ?? null,
        rawInterval: localInterval(phone),
        mappedInterval: globalInterval(phone, input.mediaOffsetSeconds),
      };
    },
  );
  const silenceIntervals = [...words, ...phones]
    .filter((interval) => isSilence(interval.label))
    .map((interval) => globalInterval(interval, input.mediaOffsetSeconds))
    .filter(
      (interval, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.start === interval.start &&
            candidate.end === interval.end,
        ) === index,
    );
  const rootFileInterval =
    input.value.fileInterval ??
    input.value.file_interval ??
    input.value.utteranceInterval ??
    input.value.utterance;
  const parsedFileInterval =
    rootFileInterval === undefined || rootFileInterval === null
      ? {
          label: "file",
          start: 0,
          end: Math.max(
            ...words.map((value) => value.end),
            ...phones.map((value) => value.end),
          ),
        }
      : parseInterval(rootFileInterval, "fileInterval");
  const fileInterval = globalInterval(
    parsedFileInterval,
    input.mediaOffsetSeconds,
  );
  const tierInterval = (
    items: readonly { mappedInterval: { start: number; end: number } }[],
  ) =>
    items.length === 0
      ? null
      : {
          start: Math.min(...items.map((item) => item.mappedInterval.start)),
          end: Math.max(...items.map((item) => item.mappedInterval.end)),
          coordinateSystem: "original-media-global" as const,
        };
  const lexicalUtteranceInterval = tierInterval(wordAlignments);
  const phoneUtteranceInterval = tierInterval(phoneAlignments);
  const selectedUtteranceInterval =
    lexicalUtteranceInterval ?? phoneUtteranceInterval;
  const selectedBoundarySource =
    lexicalUtteranceInterval !== null
      ? ("lexical-word-tier" as const)
      : phoneUtteranceInterval !== null
        ? ("phone-tier-fallback" as const)
        : ("none" as const);

  const mappingResult = alignMfaWordsToCanonicalUnits({
    canonicalUnits: input.canonicalUnits.filter((unit) => !unit.punctuation),
    words: wordAlignments.map((word) => ({
      alignmentId: word.alignmentId,
      label: word.label,
      phones: phoneAlignments
        .filter((phone) => phone.wordAlignmentId === word.alignmentId)
        .map((phone) => phone.label),
      oov: word.oov,
    })),
  });
  const mappingsByWord = new Map<string, MfaWordUnitMapping[]>();
  for (const mapping of mappingResult.mappings) {
    for (const wordId of mapping.mfaWordIds) {
      const current = mappingsByWord.get(wordId) ?? [];
      current.push(mapping);
      mappingsByWord.set(wordId, current);
    }
  }
  const mappedWordAlignments = wordAlignments.map((word) => {
    const mappings = mappingsByWord.get(word.alignmentId) ?? [];
    return {
      ...word,
      expectedUnitIds: mappings.flatMap((mapping) => mapping.canonicalUnitIds),
      mappingIds: mappings.map((mapping) => mapping.mappingId),
    };
  });
  const successfulMappings = mappingResult.mappings.filter((mapping) =>
    ["MATCH_1_TO_1", "MATCH_1_TO_MANY", "MATCH_MANY_TO_1"].includes(
      mapping.mappingType,
    ),
  );
  const mappedUnitIds = new Set(
    successfulMappings.flatMap((mapping) => mapping.canonicalUnitIds),
  );
  const mappedWordIds = new Set(
    successfulMappings.flatMap((mapping) => mapping.mfaWordIds),
  );
  const lexicalUnits = input.canonicalUnits.filter((unit) => !unit.punctuation);
  const pronunciationUnits = lexicalUnits.filter(
    (unit) => unit.phones.length > 0,
  );
  const pronunciationCoveredUnits = pronunciationUnits.filter((unit) => {
    const mapping = successfulMappings.find((item) =>
      item.canonicalUnitIds.includes(unit.unitId),
    );
    return (
      mapping !== undefined &&
      phoneAlignments.some((phone) =>
        mapping.mfaWordIds.includes(phone.wordAlignmentId ?? ""),
      )
    );
  });
  const normalizedPhone = (value: string) =>
    value.normalize("NFKC").trim().toLowerCase();
  const expectedPhoneCounts = new Map<string, number>();
  for (const phone of input.expectedPhones
    .map(normalizedPhone)
    .filter(Boolean)) {
    expectedPhoneCounts.set(phone, (expectedPhoneCounts.get(phone) ?? 0) + 1);
  }
  let alignedExpectedPhoneCount = 0;
  for (const phone of phoneAlignments.map((item) =>
    normalizedPhone(item.label),
  )) {
    const remaining = expectedPhoneCounts.get(phone) ?? 0;
    if (remaining > 0) {
      alignedExpectedPhoneCount += 1;
      expectedPhoneCounts.set(phone, remaining - 1);
    }
  }
  const mappedWordsWithPhones = new Set(
    phoneAlignments.flatMap((phone) =>
      phone.wordAlignmentId !== null && mappedWordIds.has(phone.wordAlignmentId)
        ? [phone.wordAlignmentId]
        : [],
    ),
  );
  let previousPhoneEnd = -Infinity;
  const plausiblePhoneCount = phoneAlignments.filter((phone) => {
    const duration = phone.mappedInterval.end - phone.mappedInterval.start;
    const parent = mappedWordAlignments.find(
      (word) => word.alignmentId === phone.wordAlignmentId,
    );
    const ordered = phone.mappedInterval.start >= previousPhoneEnd - 1e-6;
    previousPhoneEnd = Math.max(previousPhoneEnd, phone.mappedInterval.end);
    return (
      phone.label.trim() !== "" &&
      duration >= 0.015 &&
      duration <= 0.5 &&
      ordered &&
      parent !== undefined &&
      phone.mappedInterval.start >= parent.mappedInterval.start - 1e-6 &&
      phone.mappedInterval.end <= parent.mappedInterval.end + 1e-6
    );
  }).length;
  const ratio = (numerator: number, denominator: number) =>
    denominator === 0 ? 0 : Math.min(1, numerator / denominator);
  const canonicalUnitCoverageRatio = ratio(
    mappedUnitIds.size,
    lexicalUnits.length,
  );
  const alignedWordCoverageRatio = ratio(
    mappedWordIds.size,
    mappedWordAlignments.length,
  );
  const pronunciationUnitCoverageRatio = ratio(
    pronunciationCoveredUnits.length,
    pronunciationUnits.length,
  );
  const expectedPhoneCoverageRatio = ratio(
    alignedExpectedPhoneCount,
    input.expectedPhones.length,
  );
  const wordWithAnyPhoneRatio = ratio(
    mappedWordsWithPhones.size,
    mappedWordIds.size,
  );
  const alignedPhonePlausibilityRatio = ratio(
    plausiblePhoneCount,
    phoneAlignments.length,
  );
  const utteranceInterval = selectedUtteranceInterval;
  return {
    wordAlignments: mappedWordAlignments,
    phoneAlignments,
    silenceIntervals,
    utteranceInterval,
    fileInterval,
    lexicalUtteranceInterval,
    phoneUtteranceInterval,
    selectedUtteranceInterval,
    selectedBoundarySource,
    wordUnitMappings: mappingResult.mappings,
    canonicalUnitCoverageRatio,
    alignedWordCoverageRatio,
    pronunciationUnitCoverageRatio,
    expectedPhoneCoverageRatio,
    wordWithAnyPhoneRatio,
    alignedPhonePlausibilityRatio,
    expectedPhoneCount: input.expectedPhones.length,
    alignedExpectedPhoneCount,
    unresolvedMappingCount: mappingResult.unresolvedCount,
    ambiguousMappingCount: mappingResult.ambiguousCount,
    warnings: [
      ...(lexicalWords.length !== lexicalUnits.length
        ? [
            `MFA_ALIGNED_WORD_COUNT_${String(lexicalWords.length)}_EXPECTED_${String(lexicalUnits.length)}`,
          ]
        : []),
      ...(rawWords === null ? ["MFA_WORD_TIER_UNAVAILABLE"] : []),
      ...(rawPhones === null ? ["MFA_PHONE_TIER_UNAVAILABLE"] : []),
      ...(mappingResult.ambiguousCount > 0
        ? ["WORD_UNIT_MAPPING_AMBIGUOUS"]
        : []),
      ...(mappingResult.unresolvedCount > 0
        ? ["WORD_UNIT_MAPPING_INCOMPLETE"]
        : []),
    ],
  };
}
