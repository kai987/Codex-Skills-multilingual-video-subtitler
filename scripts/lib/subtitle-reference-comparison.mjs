/** Offline evaluation only. Do not import into generation or window selection. */
const timingRadius = 15;
const normalization = "NFKC-remove-punctuation-separators-whitespace-only-v1";
const normalize = (text) =>
  text.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");

function assTime(value) {
  const m = /^(\d+):([0-5]\d):([0-5]\d)\.(\d{1,3})$/u.exec(value.trim());
  if (!m) throw Error("INVALID_REFERENCE_ASS_TIME");
  return (
    Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`)
  );
}

function referenceRecords(ass) {
  if (typeof ass !== "string") throw Error("REFERENCE_ASS_MUST_BE_STRING");
  const records = [];
  const counts = {
    eventDialogueRows: 0,
    excludedOtherStyles: 0,
    excludedNonJapaneseFirstLines: 0,
    discardedAdditionalLines: 0,
    hanOnlyFirstLinesLanguageAmbiguous: 0,
  };
  let inEvents = false;
  let format = null;
  for (const [lineIndex, sourceLine] of ass
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .entries()) {
    const line = sourceLine.trim();
    if (/^\[.*\]$/u.test(line)) {
      inEvents = line.toLowerCase() === "[events]";
      format = null;
      continue;
    }
    if (!inEvents) continue;
    if (/^Format:/iu.test(line)) {
      format = line
        .slice(line.indexOf(":") + 1)
        .split(",")
        .map((x) => x.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/u.test(line)) continue;
    counts.eventDialogueRows++;
    if (
      !format ||
      new Set(format).size !== format.length ||
      format.at(-1) !== "text" ||
      ["start", "end", "style"].some((key) => !format.includes(key))
    )
      throw Error("INVALID_REFERENCE_ASS_EVENTS_FORMAT");
    const body = line.slice(line.indexOf(":") + 1).trimStart();
    const fields = [];
    let cursor = 0;
    for (let i = 0; i < format.length - 1; i++) {
      const comma = body.indexOf(",", cursor);
      if (comma < 0) throw Error("MALFORMED_REFERENCE_ASS_DIALOGUE");
      fields.push(body.slice(cursor, comma));
      cursor = comma + 1;
    }
    fields.push(body.slice(cursor));
    const get = (key) => fields[format.indexOf(key)];
    // Exact style, not substring matching: RubyDialogue is not Dialogue.
    if (get("style").trim() !== "Dialogue") {
      counts.excludedOtherStyles++;
      continue;
    }
    const lines = get("text")
      .replace(/\{[^}]*\}/gu, "")
      .split(/\\[Nn]/u)
      .map((text) => text.replace(/\\h/gu, " ").trim());
    counts.discardedAdditionalLines += Math.max(0, lines.length - 1);
    const text = lines[0];
    if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)) {
      counts.excludedNonJapaneseFirstLines++;
      continue;
    }
    // The declared first-line convention excludes bilingual Chinese lines.
    // Script alone cannot distinguish a kanji-only Japanese name from Chinese.
    const languageAmbiguous = !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
      text,
    );
    if (languageAmbiguous) counts.hanOnlyFirstLinesLanguageAmbiguous++;
    const start = assTime(get("start")),
      end = assTime(get("end"));
    if (end <= start) throw Error("INVALID_REFERENCE_ASS_INTERVAL");
    records.push({
      index: records.length,
      line: lineIndex + 1,
      start,
      end,
      text,
      normalizedText: normalize(text),
      languageAmbiguous,
    });
  }
  return { records: chronological(records), counts };
}

function machineRecords(values, label) {
  if (!Array.isArray(values)) throw Error(`${label}_RECORDS_MUST_BE_ARRAY`);
  return chronological(
    values.map((value, index) => {
      if (
        !value ||
        typeof value.text !== "string" ||
        !Number.isFinite(value.start) ||
        !Number.isFinite(value.end) ||
        value.start < 0 ||
        value.end < value.start
      )
        throw Error(`INVALID_${label}_RECORD:${index}`);
      return {
        index,
        start: value.start,
        end: value.end,
        text: value.text,
        normalizedText: normalize(value.text),
      };
    }),
  );
}

const chronological = (records) =>
  [...records].sort((a, b) => a.start - b.start || a.index - b.index);
const inWindow = (r, w) =>
  r.start === r.end
    ? r.start >= w.start && r.start < w.end
    : r.start < w.end && r.end > w.start;
const crossing = (r, w) => r.start < w.start || r.end > w.end;

/** Unit-cost codepoint Levenshtein; ties prefer substitution, deletion, insertion. */
function edits(reference, hypothesis) {
  const a = Array.from(reference),
    b = Array.from(hypothesis);
  let prev = Array.from({ length: 4 }, () => new Uint32Array(b.length + 1));
  let next = Array.from({ length: 4 }, () => new Uint32Array(b.length + 1));
  for (let j = 0; j <= b.length; j++) prev[0][j] = prev[3][j] = j;
  for (let i = 1; i <= a.length; i++) {
    next[0][0] = next[2][0] = i;
    next[1][0] = next[3][0] = 0;
    for (let j = 1; j <= b.length; j++) {
      const mismatch = a[i - 1] !== b[j - 1];
      let row = prev,
        column = j - 1,
        operation = mismatch ? 1 : 0;
      let distance = prev[0][j - 1] + Number(mismatch);
      if (prev[0][j] + 1 < distance) {
        row = prev;
        column = j;
        operation = 2;
        distance = prev[0][j] + 1;
      }
      if (next[0][j - 1] + 1 < distance) {
        row = next;
        column = j - 1;
        operation = 3;
        distance = next[0][j - 1] + 1;
      }
      next[0][j] = distance;
      for (let k = 1; k < 4; k++)
        next[k][j] = row[k][column] + Number(operation === k);
    }
    [prev, next] = [next, prev];
  }
  const [distance, S, D, I] = prev.map((row) => row[b.length]);
  return {
    N: a.length,
    hypothesisCharacters: b.length,
    S,
    D,
    I,
    distance,
    CER: a.length ? distance / a.length : null,
    matchedCharacters: a.length - S - D,
  };
}

function pairs(machine, reference) {
  const candidates = (r, list) =>
    list.filter(
      (x) =>
        r.normalizedText !== "" &&
        x.normalizedText === r.normalizedText &&
        Math.abs(x.start - r.start) <= timingRadius,
    );
  return new Map(
    machine.map((r) => {
      const refs = candidates(r, reference);
      const reverseCount =
        refs.length === 1 ? candidates(refs[0], machine).length : null;
      if (refs.length !== 1 || reverseCount !== 1)
        return [
          r.index,
          {
            machineIndex: r.index,
            status: refs.length
              ? "AMBIGUOUS_EXACT_TEXT"
              : "NO_EXACT_TEXT_MATCH",
            referenceCandidateCount: refs.length,
            reverseMachineCandidateCount: reverseCount,
          },
        ];
      const ref = refs[0];
      return [
        r.index,
        {
          machineIndex: r.index,
          referenceIndex: ref.index,
          status: "UNIQUE_EXACT_NORMALIZED_TEXT",
          referenceStart: ref.start,
          referenceEnd: ref.end,
          machineStart: r.start,
          machineEnd: r.end,
          startDeltaSeconds: r.start - ref.start,
          endDeltaSeconds: r.end - ref.end,
        },
      ];
    }),
  );
}

function stats(values) {
  if (!values.length)
    return {
      count: 0,
      meanSigned: null,
      meanAbsolute: null,
      medianAbsolute: null,
      maxAbsolute: null,
      greaterThan1Second: 0,
      greaterThan3Seconds: 0,
    };
  const absolute = values.map(Math.abs).sort((a, b) => a - b);
  const middle = Math.floor(absolute.length / 2);
  return {
    count: values.length,
    meanSigned: values.reduce((a, b) => a + b, 0) / values.length,
    meanAbsolute: absolute.reduce((a, b) => a + b, 0) / absolute.length,
    medianAbsolute:
      absolute.length % 2
        ? absolute[middle]
        : (absolute[middle - 1] + absolute[middle]) / 2,
    maxAbsolute: absolute.at(-1),
    greaterThan1Second: absolute.filter((x) => x > 1).length,
    greaterThan3Seconds: absolute.filter((x) => x > 3).length,
  };
}

function referenceGaps(records, window) {
  const gaps = [];
  let cursor = window.start;
  for (const r of records) {
    const start = Math.max(window.start, r.start),
      end = Math.min(window.end, r.end);
    if (start > cursor) gaps.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  return gaps;
}

/**
 * Caller must freeze machine decisions and windows BEFORE reading referenceAss.
 * This pure function cannot verify that external ordering or certify a Gold file.
 */
export function compareReference({
  referenceAss,
  baselineRecords,
  candidateRecords,
  windows,
}) {
  if (!Array.isArray(windows) || !windows.length)
    throw Error("FIXED_WINDOWS_REQUIRED");
  const ids = new Set();
  const fixedWindows = windows.map((w) => {
    if (
      !w ||
      typeof w.id !== "string" ||
      !w.id ||
      ids.has(w.id) ||
      typeof w.kind !== "string" ||
      !w.kind ||
      !Number.isFinite(w.start) ||
      !Number.isFinite(w.end) ||
      w.start < 0 ||
      w.end <= w.start
    )
      throw Error("INVALID_OR_DUPLICATE_WINDOW");
    ids.add(w.id);
    return { id: w.id, start: w.start, end: w.end, kind: w.kind };
  });
  const baseline = machineRecords(baselineRecords, "BASELINE");
  const candidate = machineRecords(candidateRecords, "CANDIDATE");
  const reference = referenceRecords(referenceAss);
  const pairing = {
    baseline: pairs(baseline, reference.records),
    candidate: pairs(candidate, reference.records),
  };
  const perWindow = fixedWindows.map((window) => {
    const refs = reference.records.filter((r) => inWindow(r, window));
    const referenceText = refs.map((r) => r.normalizedText).join("");
    const gaps = referenceGaps(refs, window);
    const cautions = [
      "WHOLE_OVERLAPPING_RECORDS_NOT_WORD_LOCALIZED",
      "TEXT_COMPARISON_NOT_LISTENING_VERIFICATION",
    ];
    if (!referenceText) cautions.push("EMPTY_REFERENCE_WINDOW_CER_UNDEFINED");
    if (gaps.length)
      cautions.push("REFERENCE_TIMELINE_GAPS_NOT_PROOF_OF_SILENCE");
    const refCross = refs
      .filter((r) => crossing(r, window))
      .map((r) => r.index);
    if (refCross.length) cautions.push("REFERENCE_BOUNDARY_CROSSING_INCLUDED");
    if (refs.some((r) => r.languageAmbiguous))
      cautions.push("HAN_ONLY_FIRST_LINE_LANGUAGE_UNVERIFIED");
    const result = {
      window,
      reference: {
        recordCount: refs.length,
        normalizedText: referenceText,
        records: refs,
        boundaryCrossingIndices: refCross,
        timelineGaps: gaps,
      },
      cautions,
    };
    for (const [side, all] of Object.entries({ baseline, candidate })) {
      const selected = all.filter((r) => inWindow(r, window));
      const boundaryCrossingIndices = selected
        .filter((r) => crossing(r, window))
        .map((r) => r.index);
      const zeroDurationIndices = selected
        .filter((r) => r.start === r.end)
        .map((r) => r.index);
      const referenceGapIndices = selected
        .filter((r) => !refs.some((ref) => inWindow(r, ref)))
        .map((r) => r.index);
      const timing = selected.map((r) => pairing[side].get(r.index));
      const matched = timing.filter(
        (r) => r.status === "UNIQUE_EXACT_NORMALIZED_TEXT",
      );
      const normalizedText = selected.map((r) => r.normalizedText).join("");
      result[side] = {
        recordCount: selected.length,
        records: selected,
        normalizedText,
        edit: edits(referenceText, normalizedText),
        boundaryCrossingIndices,
        zeroDurationIndices,
        referenceGapIndices,
        timing: {
          matchCount: matched.length,
          unmatchedCount: timing.length - matched.length,
          pairs: timing,
          start: stats(matched.map((r) => r.startDeltaSeconds)),
          end: stats(matched.map((r) => r.endDeltaSeconds)),
          scope: "unique-exact-normalized-text-subset-only",
          acousticAlignmentVerified: false,
        },
      };
      if (boundaryCrossingIndices.length)
        cautions.push(`${side.toUpperCase()}_BOUNDARY_CROSSING_INCLUDED`);
      if (zeroDurationIndices.length)
        cautions.push(`${side.toUpperCase()}_ZERO_DURATION_TEXT_INCLUDED`);
      if (referenceGapIndices.length)
        cautions.push(`${side.toUpperCase()}_RECORDS_IN_REFERENCE_GAPS`);
    }
    return result;
  });
  const cautions = [
    "SAMPLED_WINDOWS_DO_NOT_ESTIMATE_OVERALL_ACCURACY",
    "REFERENCE_NOT_INDEPENDENTLY_VALIDATED_GOLD",
    "NO_LISTENING_PERFORMED",
    "CALLER_MUST_FREEZE_MACHINE_WINDOWS_BEFORE_REFERENCE_EVALUATION",
    "CHINESE_TRANSLATION_LINES_EXCLUDED_BY_DECLARED_JAPANESE_FIRST_LINE_CONVENTION",
  ];
  if (
    fixedWindows.some((w, i) =>
      fixedWindows.slice(i + 1).some((x) => inWindow(w, x)),
    )
  )
    cautions.push("OVERLAPPING_WINDOWS_MAY_DOUBLE_COUNT_RECORDS");
  if (reference.counts.hanOnlyFirstLinesLanguageAmbiguous)
    cautions.push("HAN_ONLY_FIRST_LINES_RETAINED_LANGUAGE_AMBIGUOUS");
  return {
    version: "subtitle-reference-comparison-v1",
    normalization,
    scope: "fixed-sampled-windows-only",
    overallAccuracy: null,
    overallCER: null,
    machineWindowFreezeVerified: false,
    timingRadiusSeconds: timingRadius,
    timingCandidateRule:
      "exact-normalized-text-start-within-radius-unique-both-directions-over-full-inputs",
    recordSelection:
      "whole-record-positive-overlap-or-zero-duration-point-half-open-window",
    concatenationOrder: "start-then-original-input-index",
    referenceStyle: "Dialogue",
    referenceLanguagePolicy:
      "declared-Japanese-first-ASS-line-no-translation-or-ruby",
    qualityStatus: "needs-review",
    humanValidated: false,
    acousticCorrectness: "NOT_VERIFIED",
    counts: {
      reference: reference.records.length,
      baseline: baseline.length,
      candidate: candidate.length,
      windows: fixedWindows.length,
      referenceParsing: reference.counts,
    },
    perWindow,
    cautions,
  };
}
