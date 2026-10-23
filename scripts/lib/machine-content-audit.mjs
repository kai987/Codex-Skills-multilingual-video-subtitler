/** Pure machine-output diagnostics. No reference, provider, filesystem or repair. */
export const contentAuditPolicy = Object.freeze({
  version: "machine-content-risk-v2",
  normalization:
    "NFKC; remove whitespace, punctuation and symbols for comparison only",
  characterUnit: "Unicode code points after comparison normalization",
  timeComparison:
    "exact decimal values of serialized numbers; no boundary epsilon",
  minimumDurationSeconds: 0.2,
  japaneseCharactersPerSecond: 25,
  longSpanSeconds: 10,
  neighboringRepeatCount: 3,
  neighboringMaximumGapSeconds: 2,
  commonSubstringCharacters: 8,
  intraCueMinimumPatternCharacters: 2,
  intraCueMaximumPatternCharacters: 32,
  intraCueRepeatCount: 3,
  intraCueMinimumRepeatedCharacters: 12,
  crossCueMinimumPatternCharacters: 8,
  crossCueMaximumPatternCharacters: 64,
  crossCueMinimumOccurrences: 3,
  crossCueMaximumWindowSeconds: 20,
  maximumAnalyzedCharactersPerCue: 8192,
  decision:
    "warning-only; retain all records; no acoustic truth or automatic repair",
});

const thresholdNames = [
  "minimumDurationSeconds",
  "japaneseCharactersPerSecond",
  "longSpanSeconds",
  "neighboringRepeatCount",
  "neighboringMaximumGapSeconds",
  "commonSubstringCharacters",
  "intraCueMinimumPatternCharacters",
  "intraCueMaximumPatternCharacters",
  "intraCueRepeatCount",
  "intraCueMinimumRepeatedCharacters",
  "crossCueMinimumPatternCharacters",
  "crossCueMaximumPatternCharacters",
  "crossCueMinimumOccurrences",
  "crossCueMaximumWindowSeconds",
];
const integerThresholds = thresholdNames.filter(
  (name) =>
    /Count|Characters|Occurrences/u.test(name) &&
    name !== "japaneseCharactersPerSecond",
);
const normalize = (text) =>
  text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const japanese = (text) =>
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text);

function decimal(value) {
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e"),
    parts = mantissa.split("."),
    digits = BigInt(parts.join("")),
    scale = (parts[1]?.length ?? 0) - Number(exponent);
  return scale >= 0
    ? { n: digits, d: 10n ** BigInt(scale) }
    : { n: digits * 10n ** BigInt(-scale), d: 1n };
}
function durationFraction(start, end) {
  const s = decimal(start),
    e = decimal(end);
  return { n: e.n * s.d - s.n * e.d, d: e.d * s.d };
}
function compareDuration(start, end, seconds) {
  const difference = durationFraction(start, end),
    threshold = decimal(seconds),
    delta = difference.n * threshold.d - threshold.n * difference.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
function excessiveSpeed(row, limit) {
  const duration = durationFraction(row.start, row.end),
    threshold = decimal(limit);
  return (
    BigInt(row.characterCount) * duration.d * threshold.d >
    threshold.n * duration.n
  );
}

function selectedPolicy(options) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("CONTENT_AUDIT_INVALID_OPTIONS");
  if (
    Object.keys(options).some(
      (key) => !["language", "sourceEnd", "thresholds"].includes(key),
    )
  )
    throw new TypeError("CONTENT_AUDIT_UNKNOWN_OPTION");
  const language = options.language === undefined ? "auto" : options.language;
  if (
    typeof language !== "string" ||
    !/^(?:auto|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/iu.test(language)
  )
    throw new TypeError("CONTENT_AUDIT_INVALID_LANGUAGE");
  if (
    options.sourceEnd !== undefined &&
    (!finite(options.sourceEnd) || options.sourceEnd <= 0)
  )
    throw new TypeError("CONTENT_AUDIT_INVALID_SOURCE_END");
  const overrides = options.thresholds === undefined ? {} : options.thresholds;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
    throw new TypeError("CONTENT_AUDIT_INVALID_THRESHOLDS");
  for (const [key, value] of Object.entries(overrides)) {
    if (!thresholdNames.includes(key) || !finite(value) || value <= 0)
      throw new TypeError(`CONTENT_AUDIT_INVALID_THRESHOLD:${key}`);
    if (integerThresholds.includes(key) && !Number.isSafeInteger(value))
      throw new TypeError(`CONTENT_AUDIT_INVALID_INTEGER_THRESHOLD:${key}`);
  }
  const policy = {
    ...contentAuditPolicy,
    ...overrides,
    language: language.toLowerCase(),
    sourceEnd: options.sourceEnd ?? null,
  };
  if (
    policy.neighboringRepeatCount < 3 ||
    policy.intraCueRepeatCount < 3 ||
    policy.commonSubstringCharacters < 8 ||
    policy.commonSubstringCharacters > 64 ||
    policy.intraCueMinimumPatternCharacters < 2 ||
    policy.intraCueMaximumPatternCharacters > 64 ||
    policy.intraCueMaximumPatternCharacters <
      policy.intraCueMinimumPatternCharacters ||
    policy.crossCueMinimumPatternCharacters < 8 ||
    policy.crossCueMaximumPatternCharacters > 64 ||
    policy.crossCueMaximumPatternCharacters <
      policy.crossCueMinimumPatternCharacters ||
    policy.crossCueMinimumOccurrences < 3 ||
    policy.crossCueMaximumWindowSeconds > 20
  )
    throw new TypeError("CONTENT_AUDIT_UNSAFE_PATTERN_THRESHOLDS");
  return policy;
}

function prepare(record, cueIndex, policy) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    typeof record.text !== "string"
  )
    throw new TypeError(`CONTENT_AUDIT_INVALID_RECORD:${cueIndex}`);
  if (
    record.id !== undefined &&
    !(typeof record.id === "string" || Number.isSafeInteger(record.id))
  )
    throw new TypeError(`CONTENT_AUDIT_INVALID_ID:${cueIndex}`);
  if (
    record.index !== undefined &&
    (!Number.isSafeInteger(record.index) || record.index < 0)
  )
    throw new TypeError(`CONTENT_AUDIT_INVALID_INDEX:${cueIndex}`);
  const normalized = normalize(record.text),
    all = Array.from(normalized);
  const invalid = [];
  if (!finite(record.start) || !finite(record.end))
    invalid.push("NONFINITE_OR_NONNUMERIC_TIME");
  if (
    (finite(record.start) && record.start < 0) ||
    (finite(record.end) && record.end < 0)
  )
    invalid.push("NEGATIVE_TIME");
  if (finite(record.start) && finite(record.end)) {
    if (record.start === record.end) invalid.push("ZERO_DURATION");
    if (record.start > record.end) invalid.push("REVERSED_INTERVAL");
    if (
      policy.sourceEnd !== null &&
      (record.start > policy.sourceEnd || record.end > policy.sourceEnd)
    )
      invalid.push("OUT_OF_SOURCE_RANGE");
  }
  return {
    cueIndex,
    recordIndex: record.index ?? null,
    id: record.id ?? null,
    start: finite(record.start) ? record.start : null,
    end: finite(record.end) ? record.end : null,
    duration:
      finite(record.start) && finite(record.end)
        ? record.end - record.start
        : null,
    normalized,
    chars: all.slice(0, policy.maximumAnalyzedCharactersPerCue),
    characterCount: all.length,
    japanese:
      policy.language.toLowerCase().startsWith("ja") ||
      (policy.language === "auto" && japanese(record.text)),
    invalid,
  };
}

function adjacent(a, b, policy) {
  return (
    a &&
    b &&
    !a.invalid.length &&
    !b.invalid.length &&
    b.cueIndex === a.cueIndex + 1 &&
    b.start >= a.start &&
    compareDuration(a.end, b.start, policy.neighboringMaximumGapSeconds) <= 0
  );
}

function repeatedPattern(chars, policy) {
  let best = null;
  for (
    let width = policy.intraCueMinimumPatternCharacters;
    width <= policy.intraCueMaximumPatternCharacters;
    width++
  ) {
    for (
      let start = 0;
      start + width * policy.intraCueRepeatCount <= chars.length;
      start++
    ) {
      let end = start + width;
      while (
        end < chars.length &&
        chars[end] === chars[start + ((end - start) % width)]
      )
        end++;
      const repeats = Math.floor((end - start) / width),
        coverage = repeats * width;
      if (
        repeats >= policy.intraCueRepeatCount &&
        coverage >= policy.intraCueMinimumRepeatedCharacters &&
        (!best || coverage > best.repeatedCharacters)
      )
        best = {
          pattern: chars.slice(start, start + width).join(""),
          repeats,
          startCharacter: start,
          repeatedCharacters: coverage,
        };
      if (repeats >= policy.intraCueRepeatCount) start += coverage - 1;
    }
  }
  return best;
}

// Offsets describe normalized code points, never acoustic times or offsets in
// the unnormalized source text. Greedy ordered selection maximizes the number
// of equal-width nonoverlapping occurrences inside each cue independently.
function nonoverlappingOccurrences(positions, width) {
  const selected = [],
    next = [0, 0];
  for (const position of positions)
    if (position.startCharacter >= next[position.side]) {
      selected.push({
        ...position,
        endCharacter: position.startCharacter + width,
      });
      next[position.side] = position.startCharacter + width;
    }
  return selected;
}

function crossCuePattern(left, right, policy) {
  const rows = [left, right],
    seeds = new Map(),
    minimum = policy.crossCueMinimumPatternCharacters;
  for (const [side, row] of rows.entries())
    for (let start = 0; start + minimum <= row.chars.length; start++) {
      const pattern = row.chars.slice(start, start + minimum).join("");
      if (!seeds.has(pattern)) seeds.set(pattern, []);
      seeds.get(pattern).push({ side, startCharacter: start });
    }
  let frontier = [...seeds].map(([pattern, positions]) => ({
      pattern,
      positions,
    })),
    best = null;
  // Each bounded text position belongs to at most one prefix group at each
  // width. Extend only supported groups, retaining all overlapping positions
  // until after extension: discarding them early could hide a longer match.
  for (
    let width = minimum;
    width <= policy.crossCueMaximumPatternCharacters && frontier.length;
    width++
  ) {
    const next = [];
    for (const group of frontier) {
      const occurrences = nonoverlappingOccurrences(group.positions, width);
      if (
        occurrences.length < policy.crossCueMinimumOccurrences ||
        !occurrences.some((position) => position.side === 0) ||
        !occurrences.some((position) => position.side === 1)
      )
        continue;
      if (
        !best ||
        width > best.patternCharacters ||
        (width === best.patternCharacters &&
          occurrences.length > best.occurrences.length)
      )
        best = {
          pattern: group.pattern,
          patternCharacters: width,
          occurrences,
        };
      if (width === policy.crossCueMaximumPatternCharacters) continue;
      const extensions = new Map();
      for (const position of group.positions) {
        const character =
          rows[position.side].chars[position.startCharacter + width];
        if (character === undefined) continue;
        if (!extensions.has(character)) extensions.set(character, []);
        extensions.get(character).push(position);
      }
      for (const [character, positions] of extensions)
        next.push({ pattern: group.pattern + character, positions });
    }
    frontier = next;
  }
  return best;
}

/**
 * Records stay in original order and are never changed or removed. cueIndexes are
 * zero-based array positions; recordIndex/id separately preserve caller identity.
 * Thresholds are heuristics, never a claim that text was absent from the audio.
 */
export function auditContent(records, options = {}) {
  if (!Array.isArray(records))
    throw new TypeError("CONTENT_AUDIT_RECORDS_NOT_ARRAY");
  const policy = selectedPolicy(options),
    rows = records.map((record, index) => prepare(record, index, policy));
  const issues = [];
  function issue(code, selected, reason, evidence, thresholds) {
    const cues = selected.map(({ cueIndex, recordIndex, id, start, end }) => ({
      cueIndex,
      recordIndex,
      id,
      start,
      end,
    }));
    issues.push({
      id: `content-risk-${String(issues.length + 1).padStart(5, "0")}`,
      code,
      severity: "warning",
      reason,
      cueIndexes: cues.map((cue) => cue.cueIndex),
      cues,
      start: cues.every((cue) => cue.start !== null)
        ? Math.min(...cues.map((cue) => cue.start))
        : null,
      end: cues.every((cue) => cue.end !== null)
        ? Math.max(...cues.map((cue) => cue.end))
        : null,
      evidence,
      thresholds,
    });
  }
  for (const row of rows) {
    if (row.invalid.length)
      issue(
        "INVALID_TIME",
        [row],
        "Raw time cannot safely represent this cue; retain it as unresolved evidence.",
        { reasons: row.invalid },
        { sourceEnd: policy.sourceEnd },
      );
    if (
      !row.invalid.length &&
      compareDuration(row.start, row.end, policy.minimumDurationSeconds) < 0
    )
      issue(
        "SHORT_POSITIVE_DURATION",
        [row],
        "Positive duration is unusually short; format validity does not establish readability.",
        { durationSeconds: row.duration, characterCount: row.characterCount },
        { minimumDurationSeconds: policy.minimumDurationSeconds },
      );
    if (
      !row.invalid.length &&
      row.japanese &&
      excessiveSpeed(row, policy.japaneseCharactersPerSecond)
    )
      issue(
        "EXCESSIVE_READING_SPEED",
        [row],
        "Japanese text density exceeds the diagnostic threshold; inspect text and boundaries.",
        {
          charactersPerSecond: Number.isFinite(
            row.characterCount / row.duration,
          )
            ? row.characterCount / row.duration
            : null,
          rateExceedsFiniteNumberRange: !Number.isFinite(
            row.characterCount / row.duration,
          ),
          characterCount: row.characterCount,
          durationSeconds: row.duration,
        },
        { japaneseCharactersPerSecond: policy.japaneseCharactersPerSecond },
      );
    if (
      !row.invalid.length &&
      compareDuration(row.start, row.end, policy.longSpanSeconds) >= 0
    )
      issue(
        "LONG_SPAN_WEAK_BOUNDARY",
        [row],
        "Long segment timing may include pauses; no acoustic boundary validation has been performed.",
        { durationSeconds: row.duration, characterCount: row.characterCount },
        { longSpanSeconds: policy.longSpanSeconds },
      );
    if (row.characterCount > policy.maximumAnalyzedCharactersPerCue)
      issue(
        "TEXT_ANALYSIS_TRUNCATED",
        [row],
        "Pattern analysis is bounded to a text prefix; the original record remains complete.",
        {
          characterCount: row.characterCount,
          analyzedCharacters: row.chars.length,
        },
        {
          maximumAnalyzedCharactersPerCue:
            policy.maximumAnalyzedCharactersPerCue,
        },
      );
    const pattern = repeatedPattern(row.chars, policy);
    if (pattern)
      issue(
        "INTRA_CUE_REPETITION",
        [row],
        "A repeated pattern needs review; legitimate repeated speech must not be automatically removed.",
        pattern,
        {
          minimumPatternCharacters: policy.intraCueMinimumPatternCharacters,
          maximumPatternCharacters: policy.intraCueMaximumPatternCharacters,
          minimumRepeats: policy.intraCueRepeatCount,
          minimumRepeatedCharacters: policy.intraCueMinimumRepeatedCharacters,
        },
      );
  }
  for (let first = 0; first < rows.length;) {
    let end = first + 1;
    while (
      end < rows.length &&
      rows[first].normalized &&
      rows[end].normalized === rows[first].normalized &&
      adjacent(rows[end - 1], rows[end], policy)
    )
      end++;
    if (end - first >= policy.neighboringRepeatCount)
      issue(
        "NEIGHBORING_EXACT_REPETITION",
        rows.slice(first, end),
        "Neighboring normalized text repeats; this is a warning, not proof of hallucination or authority to deduplicate.",
        {
          normalizedText: rows[first].chars.join(""),
          repeatCount: end - first,
        },
        {
          minimumRepeats: policy.neighboringRepeatCount,
          maximumGapSeconds: policy.neighboringMaximumGapSeconds,
        },
      );
    first = end;
  }
  // A short shared phrase still detects contamination when the surrounding text changes.
  const occurrences = new Map(),
    width = policy.commonSubstringCharacters;
  for (const row of rows) {
    const seen = new Set();
    for (let i = 0; i + width <= row.chars.length; i++)
      seen.add(row.chars.slice(i, i + width).join(""));
    for (const gram of seen) {
      if (!occurrences.has(gram)) occurrences.set(gram, []);
      occurrences.get(gram).push(row.cueIndex);
    }
  }
  const candidates = new Map();
  for (const [pattern, positions] of occurrences) {
    for (let first = 0; first < positions.length;) {
      let end = first + 1;
      while (
        end < positions.length &&
        adjacent(rows[positions[end - 1]], rows[positions[end]], policy)
      )
        end++;
      if (end - first >= policy.neighboringRepeatCount) {
        const indexes = positions.slice(first, end),
          key = indexes.join(",");
        if (!candidates.has(key)) candidates.set(key, { indexes, pattern });
      }
      first = end;
    }
  }
  const reported = [];
  for (const candidate of [...candidates.values()].sort(
    (a, b) =>
      b.indexes.length - a.indexes.length || a.indexes[0] - b.indexes[0],
  )) {
    if (
      reported.some((prior) =>
        candidate.indexes.every((index) => prior.includes(index)),
      )
    )
      continue;
    const selected = candidate.indexes.map((index) => rows[index]);
    if (selected.every((row) => row.normalized === selected[0].normalized))
      continue;
    reported.push(candidate.indexes);
    issue(
      "NEIGHBORING_SHARED_SUBSTRING",
      selected,
      "A common phrase persists across neighboring, otherwise different cues; inspect possible output-loop contamination without deleting speech.",
      {
        normalizedPattern: candidate.pattern,
        matchingCueCount: selected.length,
      },
      {
        minimumSubstringCharacters: width,
        minimumRepeats: policy.neighboringRepeatCount,
        maximumGapSeconds: policy.neighboringMaximumGapSeconds,
      },
    );
  }
  for (let first = 0; first + 1 < rows.length; first++) {
    const left = rows[first],
      right = rows[first + 1];
    if (
      !adjacent(left, right, policy) ||
      right.end < left.end ||
      compareDuration(
        left.start,
        right.end,
        policy.crossCueMaximumWindowSeconds,
      ) > 0 ||
      issues.some(
        (item) =>
          [
            "NEIGHBORING_EXACT_REPETITION",
            "NEIGHBORING_SHARED_SUBSTRING",
          ].includes(item.code) &&
          item.cueIndexes.includes(first) &&
          item.cueIndexes.includes(first + 1),
      )
    )
      continue;
    const pattern = crossCuePattern(left, right, policy);
    if (!pattern) continue;
    issue(
      "CROSS_CUE_PHRASE_REPETITION",
      [left, right],
      "A phrase repeats across two neighboring cues; review possible output-loop contamination, but preserve legitimate repeated speech. This warning does not authorize deletion or establish acoustic timing.",
      {
        normalizedPattern: pattern.pattern,
        patternCharacters: pattern.patternCharacters,
        totalOccurrences: pattern.occurrences.length,
        offsetBasis:
          "zero-based half-open Unicode code points after NFKC and removal of whitespace, punctuation and symbols; not original-text offsets or acoustic times",
        selection:
          "longest supported pattern, then most nonoverlapping occurrences, then first observed pattern",
        occurrences: [left, right].map((row, side) => ({
          cueIndex: row.cueIndex,
          recordIndex: row.recordIndex,
          id: row.id,
          ranges: pattern.occurrences
            .filter((position) => position.side === side)
            .map(({ startCharacter, endCharacter }) => ({
              startCharacter,
              endCharacter,
            })),
        })),
      },
      {
        minimumPatternCharacters: policy.crossCueMinimumPatternCharacters,
        maximumPatternCharacters: policy.crossCueMaximumPatternCharacters,
        minimumOccurrences: policy.crossCueMinimumOccurrences,
        maximumGapSeconds: policy.neighboringMaximumGapSeconds,
        maximumWindowSeconds: policy.crossCueMaximumWindowSeconds,
        maximumAnalyzedCharactersPerCue: policy.maximumAnalyzedCharactersPerCue,
      },
    );
  }
  const byCode = Object.fromEntries(
    [...new Set(issues.map((item) => item.code))]
      .sort()
      .map((code) => [
        code,
        issues.filter((item) => item.code === code).length,
      ]),
  );
  return {
    version: "machine-content-audit-v1",
    policy,
    status: "needs-review",
    summary: {
      recordCount: rows.length,
      issueCount: issues.length,
      flaggedCueCount: new Set(issues.flatMap((item) => item.cueIndexes)).size,
      invalidTimingCueCount: rows.filter((row) => row.invalid.length).length,
      byCode,
    },
    issues,
  };
}
