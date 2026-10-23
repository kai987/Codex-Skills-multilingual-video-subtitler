import { TextDecoder } from "node:util";
import { hash, identity } from "./content-review-plan.mjs";

export const textRules = Object.freeze({
  parser: "format-bound-ass-clock-v1",
  visible: "ass-controls-preserve-whitespace-v1",
  association: "source-overlap-whole-record-v1",
  concatenation: "original-record-order-empty-separator-v1",
  policies: ["exact-visible-v1", "whitespace-only-v1"],
  whitespace:
    "U+0009-000D,0020,0085,00A0,1680,2000-200A,2028-2029,202F,205F,3000",
  edit: "unicode-codepoint-levenshtein-v1",
  direction: "reference-to-machine",
  tracebackPriority: ["match", "substitution", "deletion", "insertion"],
  maximumCells: 25000000,
});
export const referenceFlags = Object.freeze({
  referenceRole: "historical-human-reviewed-reference",
  historicalAuthority: "user-confirmed-human-review",
  referenceCompleteness: "NOT_REVERIFIED",
  referenceAcousticCorrectness: "NOT_REVERIFIED",
  referenceIsValidatedGold: false,
  currentReviewCompletedByReferenceImport: false,
});
const white = (c) => {
  const n = c.codePointAt(0);
  return (
    (n >= 9 && n <= 13) ||
    (n >= 0x2000 && n <= 0x200a) ||
    [0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000].includes(
      n,
    )
  );
};

// Unlike the old canonical importer, this diagnostic never trims visible whitespace.
// The original raw span for each visible code point remains independently traceable.
export function visibleAss(raw) {
  const chars = Array.from(raw),
    points = [],
    warnings = [];
  for (let i = 0; i < chars.length;) {
    if (chars[i] === "{" && chars[i + 1] === "\\") {
      const end = chars.indexOf("}", i + 2);
      if (end < 0) {
        warnings.push("UNCLOSED_OVERRIDE");
      } else {
        const block = chars.slice(i + 1, end).join("");
        const tags = [...block.matchAll(/\\([a-z]+|[1-4][ac])/giu)].map((m) =>
          m[1].toLowerCase(),
        );
        const known = new Set([
          "i",
          "b",
          "u",
          "s",
          "fn",
          "fs",
          "fscx",
          "fscy",
          "fsp",
          "frx",
          "fry",
          "frz",
          "fr",
          "fax",
          "fay",
          "c",
          "1c",
          "2c",
          "3c",
          "4c",
          "alpha",
          "1a",
          "2a",
          "3a",
          "4a",
          "bord",
          "xbord",
          "ybord",
          "shad",
          "xshad",
          "yshad",
          "blur",
          "be",
          "an",
          "a",
          "pos",
          "move",
          "org",
          "fad",
          "fade",
          "clip",
          "iclip",
          "r",
          "k",
          "kf",
          "ko",
          "kt",
          "q",
        ]);
        if (!tags.length || tags.some((t) => !known.has(t)))
          warnings.push("UNSUPPORTED_OVERRIDE:" + block);
        else {
          i = end + 1;
          continue;
        }
      }
    }
    if (chars[i] === "\\" && ["N", "n", "h"].includes(chars[i + 1])) {
      points.push({
        character: chars[i + 1] === "h" ? " " : "\n",
        rawStart: i,
        rawEnd: i + 2,
      });
      i += 2;
    } else {
      if (
        chars[i] === "\\" ||
        (chars[i].codePointAt(0) < 32 &&
          ![9, 10, 13].includes(chars[i].codePointAt(0))) ||
        chars[i].codePointAt(0) === 127
      )
        warnings.push("UNSUPPORTED_VISIBLE_CONTROL");
      points.push({ character: chars[i], rawStart: i, rawEnd: i + 1 });
      i++;
    }
  }
  return {
    text: points.map((p) => p.character).join(""),
    points,
    warnings: [...new Set(warnings)],
  };
}

export function parseReference(bytes) {
  const sourceHash = hash(bytes),
    records = [],
    normalizations = [];
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let section = "",
    format = [];
  for (const [n, line] of content.split(/\r\n|\r|\n/u).entries()) {
    const s = line.trim();
    if (s.startsWith("[")) {
      section = s.toLowerCase();
      continue;
    }
    if (section !== "[events]") continue;
    if (/^Format:/iu.test(s)) {
      format = s
        .slice(s.indexOf(":") + 1)
        .split(",")
        .map((x) => x.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/iu.test(s)) continue;
    const order = records.length,
      refId =
        "reference-" +
        identity({ sourceHash, order, line: n + 1 }).slice(0, 24);
    const record = {
      refId,
      order,
      sourceLine: n + 1,
      originalLine: line,
      format: [...format],
      parseStatus: "UNPARSEABLE",
      start: null,
      end: null,
      style: null,
      rawText: null,
      visibleText: null,
      visibleMap: [],
      warnings: [],
    };
    let rest = line.slice(line.indexOf(":") + 1).trimStart();
    const values = {},
      localAudit = [];
    let error =
      format.length < 4 ||
      format.at(-1) !== "text" ||
      new Set(format).size !== format.length ||
      ["start", "end", "style"].some((k) => !format.includes(k));
    for (const key of format) {
      if (error) break;
      if (key === "text") {
        values.text = rest;
        break;
      }
      if (["start", "end"].includes(key)) {
        const m = /^(\s*(\d+):([0-5]\d):([0-5]\d)([.,])(\d{2})\s*),/u.exec(
          rest,
        );
        if (!m) {
          error = true;
          break;
        }
        values[key] =
          Number(m[2]) * 3600 +
          Number(m[3]) * 60 +
          Number(m[4]) +
          Number(m[6]) / 100;
        if (m[5] === ",")
          localAudit.push({
            refId,
            sourceLine: n + 1,
            field: key,
            original: m[1],
            parsed: m[1].replace(",", "."),
            seconds: values[key],
            reason: "UNIQUE_FORMAT_BOUND_CLOCK_DECIMAL_COMMA",
          });
        rest = rest.slice(m[0].length);
      } else {
        const at = rest.indexOf(",");
        if (at < 0) {
          error = true;
          break;
        }
        values[key] = rest.slice(0, at);
        rest = rest.slice(at + 1);
      }
    }
    if (!error && typeof values.text === "string") {
      const visible = visibleAss(values.text);
      Object.assign(record, {
        parseStatus: visible.warnings.length
          ? "TEXT_INTERPRETATION_UNCERTAIN"
          : "PARSED",
        start: values.start,
        end: values.end,
        style: values.style.trim(),
        rawText: values.text,
        visibleText: visible.text,
        visibleMap: visible.points,
        warnings: visible.warnings,
      });
      if (values.end <= values.start)
        record.warnings.push("INVALID_REFERENCE_TIME_UNLOCATED");
      normalizations.push(...localAudit);
    } else
      record.warnings.push("NON_UNIQUE_OR_UNSUPPORTED_FORMAT_CLOCK_MAPPING");
    records.push(record);
  }
  return {
    records,
    audit: {
      parser: textRules.parser,
      visiblePolicy: textRules.visible,
      sourceHash,
      dialogueCount: records.length,
      styles: Object.fromEntries(
        [...new Set(records.map((r) => r.style))].map((s) => [
          s,
          records.filter((r) => r.style === s).length,
        ]),
      ),
      normalizations,
      textComplete: records.every((r) => r.parseStatus === "PARSED"),
      unparseable: records
        .filter((r) => r.parseStatus === "UNPARSEABLE")
        .map((r) => r.refId),
      originalBytesPreserved: true,
    },
  };
}

export function associateReference(items, records) {
  return items.map((item) => ({
    reviewId: item.reviewId,
    references: records.flatMap((r) => {
      if (r.start === null || r.end === null || r.end <= r.start) return [];
      const evaluation = r.start < item.end && r.end > item.start;
      const context =
        r.start < item.bounds.playbackEnd && r.end > item.bounds.playbackStart;
      return evaluation || context
        ? [
            {
              refId: r.refId,
              label: evaluation
                ? "EVALUATION_OVERLAP"
                : "PLAYBACK_CONTEXT_ONLY",
              wholeRecord: true,
              textLocalized: false,
            },
          ]
        : [];
    }),
  }));
}

export function textStream(records, side) {
  const points = [];
  const ids = new Set();
  for (const r of records) {
    const id = side === "R" ? r.refId : r.recordId;
    if (ids.has(id)) throw Error("DUPLICATE_STREAM_RECORD_ID");
    ids.add(id);
    const text = side === "R" ? r.visibleText : r.text;
    if (typeof text !== "string") continue;
    for (const [position, character] of Array.from(text).entries())
      points.push({ character, recordId: id, recordPosition: position });
  }
  const text = points.map((p) => p.character).join("");
  return {
    side,
    recordCount: records.length,
    recordIds: [...ids],
    text,
    sha256: hash(text),
    points,
    complete: records.every(
      (r) =>
        typeof (side === "R" ? r.visibleText : r.text) === "string" &&
        (side !== "R" || r.parseStatus === "PARSED"),
    ),
  };
}
export function compareStreams(
  reference,
  machine,
  policy,
  maximumCells = textRules.maximumCells,
) {
  if (!textRules.policies.includes(policy))
    throw Error("UNKNOWN_TEXT_COMPARISON_POLICY");
  const filter = (stream) =>
    stream.points
      .map((p, i) => ({ ...p, streamPosition: i }))
      .filter((p) => policy === "exact-visible-v1" || !white(p.character));
  const r = filter(reference),
    m = filter(machine),
    N = r.length,
    L = m.length,
    width = L + 1;
  const base = {
    policy,
    referenceSha256: reference.sha256,
    machineSha256: machine.sha256,
    N,
    machineLength: L,
    maximumCells,
    direction: textRules.direction,
    tracebackPriority: textRules.tracebackPriority,
  };
  const reason =
    !reference.complete || !machine.complete
      ? "INCOMPLETE_TEXT_INTERPRETATION"
      : N === 0
        ? "EMPTY_REFERENCE"
        : (N + 1) * width > maximumCells
          ? "DP_CELL_LIMIT"
          : null;
  if (reason)
    return {
      ...base,
      status: "NOT_COMPUTABLE",
      reason,
      rawReferenceEditRatio: null,
      M: null,
      S: null,
      D: null,
      I: null,
      distance: null,
      edits: [],
    };
  const dp = new Uint32Array((N + 1) * width);
  for (let i = 0; i <= N; i++) dp[i * width] = i;
  for (let j = 0; j <= L; j++) dp[j] = j;
  for (let i = 1; i <= N; i++)
    for (let j = 1; j <= L; j++)
      dp[i * width + j] = Math.min(
        dp[(i - 1) * width + j - 1] +
          Number(r[i - 1].character !== m[j - 1].character),
        dp[(i - 1) * width + j] + 1,
        dp[i * width + j - 1] + 1,
      );
  const edits = [],
    count = { M: 0, S: 0, D: 0, I: 0 };
  let i = N,
    j = L;
  while (i || j) {
    const d = dp[i * width + j];
    let op;
    if (
      i &&
      j &&
      r[i - 1].character === m[j - 1].character &&
      d === dp[(i - 1) * width + j - 1]
    )
      op = "M";
    else if (i && j && d === dp[(i - 1) * width + j - 1] + 1) op = "S";
    else if (i && d === dp[(i - 1) * width + j] + 1) op = "D";
    else op = "I";
    count[op]++;
    edits.push({
      op,
      reference: op === "I" ? null : r[--i],
      machine: op === "D" ? null : m[--j],
    });
  }
  edits.reverse();
  const distance = dp[N * width + L];
  if (
    count.M + count.S + count.D !== N ||
    count.M + count.S + count.I !== L ||
    count.S + count.D + count.I !== distance
  )
    throw Error("EDIT_ACCOUNTING_CONFLICT");
  return {
    ...base,
    status: "COMPUTED",
    ...count,
    distance,
    rawReferenceEditRatio: distance / N,
    edits,
  };
}

export function fullComparison(A, B, reference) {
  const streams = {
    A: textStream(A, "A"),
    B: textStream(B, "B"),
    R: textStream(reference, "R"),
  };
  const rows = [],
    diffs = [];
  for (const side of ["A", "B"])
    for (const policy of textRules.policies) {
      const { edits, ...row } = compareStreams(
        streams.R,
        streams[side],
        policy,
      );
      rows.push({ side, ...row });
      diffs.push({ side, policy, edits });
    }
  return {
    streams,
    diffs,
    comparison: {
      comparisonKind: "FULL_RAW_TO_HISTORICAL_REFERENCE",
      postHoc: true,
      ...referenceFlags,
      rules: textRules,
      status: rows.every((r) => r.status === "COMPUTED")
        ? "RAW_REFERENCE_COMPARISON_READY"
        : "NOT_COMPUTABLE",
      rows,
      limitations: [
        "Historical reference completeness/acoustic correctness not reverified; not validated Gold.",
        "B includes overlapping raw request context and real/ASR repetitions; not assembled subtitle CER.",
        "S/D/I are edit operations, not acoustic error categories. Repeated-text edit locations can be ambiguous.",
        "No per-item numerical CER, automatic winner, acceptance threshold or statistical significance.",
      ],
    },
  };
}
