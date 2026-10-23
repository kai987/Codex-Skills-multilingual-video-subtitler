/** Explicit reference-assisted delivery. Never imported by machine generation. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { formats } from "../../packages/video-subtitler/dist/standalone/bounded.js";

export const tuple = ({ start, end, text }) => [start, end, text];
export const recordHash = (records) =>
  createHash("sha256")
    .update(JSON.stringify(records.map(tuple)))
    .digest("hex");

export function readJapaneseReference(ass) {
  let events = false,
    format;
  const rows = [];
  const clock = (s) => {
    assert(/^\d+:[0-5]\d:[0-5]\d\.\d{2}$/u.test(s), "BAD_REFERENCE_TIME");
    return (
      Math.round(s.split(":").reduce((n, x) => n * 60 + Number(x), 0) * 100) /
      100
    );
  };
  for (const [i, raw] of ass
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .entries()) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      events = line === "[Events]";
      format = null;
    }
    if (!events) continue;
    if (line.startsWith("Format:"))
      format = line
        .slice(7)
        .split(",")
        .map((x) => x.trim());
    if (!line.startsWith("Dialogue:")) continue;
    assert(
      format?.at(-1) === "Text" &&
        ["Start", "End", "Style"].every((k) => format.includes(k)),
      "BAD_REFERENCE_FORMAT",
    );
    const fields = line.slice(9).trimStart().split(","),
      get = (k) => fields[format.indexOf(k)];
    if (!["Dialogue", "Song"].includes(get("Style"))) continue;
    const text = fields
      .slice(format.length - 1)
      .join(",")
      .replace(/\{[^}]*\}/gu, "")
      .split(/\\[Nn]/u)[0]
      .replace(/\\h/gu, " ")
      .trim();
    assert(
      text &&
        /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text),
      "NON_JAPANESE_REFERENCE",
    );
    const start = clock(get("Start")),
      end = clock(get("End"));
    assert(end > start, "BAD_REFERENCE_RANGE");
    rows.push({
      start,
      end,
      text,
      style: get("Style") === "Song" ? "music" : "dialogue",
      referenceLine: i + 1,
    });
  }
  return rows;
}

export function applyReferencePatches(records, plan) {
  assert.equal(recordHash(records), plan.baselineRecordHash, "STALE_BASELINE");
  const consumed = new Set(),
    added = [],
    ledger = [];
  for (const patch of plan.patches) {
    assert(
      ["user-reference-ass", "explicit-human-confirmed-utterance"].includes(
        patch.authority,
      ),
      "MISSING_AUTHORITY",
    );
    assert(patch.reason && patch.replacements.length, "EMPTY_PATCH");
    const removed = patch.remove.map((index) => {
      assert(
        Number.isInteger(index) &&
          index >= 0 &&
          index < records.length &&
          !consumed.has(index),
        "INVALID_OR_REUSED_INDEX",
      );
      consumed.add(index);
      return records[index];
    });
    for (const r of patch.replacements) {
      assert(
        Number.isFinite(r.start) &&
          Number.isFinite(r.end) &&
          r.start >= 0 &&
          r.end > r.start &&
          r.text?.trim(),
        "INVALID_REPLACEMENT",
      );
      if (patch.authority === "user-reference-ass")
        assert(
          Number.isInteger(r.referenceLine) && r.referenceLine > 0,
          "MISSING_REFERENCE_LINE",
        );
      assert(
        !added.some(
          (a) => JSON.stringify(tuple(a)) === JSON.stringify(tuple(r)),
        ),
        "DUPLICATE_ADDITION",
      );
      added.push({ ...r, provenance: patch.authority });
    }
    ledger.push({
      ...patch,
      removed: removed.map(tuple),
      timingAuthority:
        patch.authority === "user-reference-ass"
          ? "reference-timed; not acoustically-verified"
          : "explicit-user-source-global-interval",
    });
  }
  const retained = records
    .map((r, i) => ({ ...r, originalIndex: i }))
    .filter((r) => !consumed.has(r.originalIndex));
  const result = [...retained, ...added].sort((a, b) => a.start - b.start);
  for (const protectedCue of plan.requiredConfirmations) {
    assert.equal(
      result.filter(
        (r) => JSON.stringify(tuple(r)) === JSON.stringify(tuple(protectedCue)),
      ).length,
      1,
      "LOST_OR_DUPLICATED_HUMAN_CONFIRMATION",
    );
  }
  return { result, retained, added, ledger, consumed: [...consumed] };
}

export function renderReferencePatches(originalAss, change, ext) {
  let contents;
  if (ext === "ass") {
    const lines = originalAss.split(/\r?\n/u),
      events = lines.filter((l) => l.startsWith("Dialogue:"));
    assert(originalAss.includes("Style: Music,"), "MUSIC_STYLE_REQUIRED");
    const header = lines
      .slice(
        0,
        lines.findIndex((l) => l.startsWith("Dialogue:")),
      )
      .join("\n");
    contents =
      header +
      "\n" +
      change.result
        .map((r, i) =>
          Number.isInteger(r.originalIndex)
            ? events[r.originalIndex]
            : formats.ass
                .format([{ ...r, id: `reference-${i}` }])
                .split("\n")
                .find((l) => l.startsWith("Dialogue:")),
        )
        .join("\n") +
      "\n";
  } else {
    contents = formats[ext].format(
      change.result.map((r, i) => ({ ...r, id: `reviewed-${i + 1}` })),
    );
  }
  assert.deepEqual(
    formats[ext].parse(contents).map(tuple),
    change.result.map(tuple),
    "FORMAT_PARITY_FAILURE",
  );
  return contents;
}
