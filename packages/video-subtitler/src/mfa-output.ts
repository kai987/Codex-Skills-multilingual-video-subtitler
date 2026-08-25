import {
  InputError,
  type ForcedAlignmentPhoneInterval,
  type ForcedAlignmentWordInterval,
} from "@mvl/shared";
import {
  FORCED_ALIGNMENT_OUTPUT_PARSER_VERSION,
  forcedAlignmentSha256,
} from "@mvl/transcription-core";

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
  expectedUnitIds: readonly string[];
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
  if (rawWords === null || rawPhones === null) {
    throw new InputError(
      `MFA ${input.outputFormat} output does not expose both word and phone tiers.`,
    );
  }
  const words = rawWords.map((value) => parseInterval(value, "word"));
  const phones = rawPhones.map((value) => parseInterval(value, "phone"));
  const lexicalWords = words.filter((word) => !isSilence(word.label));
  const lexicalPhones = phones.filter((phone) => !isSilence(phone.label));
  if (lexicalWords.length === 0 || lexicalPhones.length === 0) {
    throw new InputError(
      "MFA word or phone tier is empty after silence removal.",
    );
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
      expectedUnitIds:
        input.expectedUnitIds[index] === undefined
          ? []
          : [input.expectedUnitIds[index]],
      rawInterval: localInterval(word),
      mappedInterval: globalInterval(word, input.mediaOffsetSeconds),
      oov: /(?:<unk>|\[oov\]|<oov>|\*unknown\*)/iu.test(word.label),
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
  const rootUtterance = input.value.utteranceInterval ?? input.value.utterance;
  const parsedUtterance =
    rootUtterance === undefined || rootUtterance === null
      ? null
      : parseInterval(rootUtterance, "utterance");
  const utteranceInterval =
    parsedUtterance === null
      ? {
          start: Math.min(
            ...wordAlignments.map((word) => word.mappedInterval.start),
          ),
          end: Math.max(
            ...wordAlignments.map((word) => word.mappedInterval.end),
          ),
          coordinateSystem: "original-media-global" as const,
        }
      : globalInterval(parsedUtterance, input.mediaOffsetSeconds);
  return {
    wordAlignments,
    phoneAlignments,
    silenceIntervals,
    utteranceInterval,
    warnings: [
      ...(lexicalWords.length !== input.expectedUnitIds.length
        ? [
            `MFA_ALIGNED_WORD_COUNT_${String(lexicalWords.length)}_EXPECTED_${String(input.expectedUnitIds.length)}`,
          ]
        : []),
    ],
  };
}
