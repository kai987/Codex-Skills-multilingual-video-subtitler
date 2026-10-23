/** Content risk is a HOLD, never acoustic truth or permission to erase speech. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { formats } from "../../packages/video-subtitler/dist/standalone/bounded.js";

export const contentSafetyPolicy = Object.freeze({
  version: "content-safety-gate-v3",
  minimumSentenceLoopCues: 6,
  minimumSentenceLoopSeconds: 10,
  maximumShortTokenCharacters: 2,
  minimumLoopCues: 6,
  maximumLoopGapSeconds: 5,
  maximumLoopSpanSeconds: 40,
  minimumUniformCharacters: 8,
  minimumRepeatedLongSpanSeconds: 20,
  minimumEmbeddedKanaRun: 6,
  sparseDialogueMinimumSeconds: 12,
  sparseDialogueMaximumCps: 1,
  foreignTokenMinimumOccurrences: 3,
  foreignTokenMaximumWindowSeconds: 30,
  containmentMinimumCharacters: 2,
  containmentMinimumOverlapSeconds: 0.1,
  templatePhrases: Object.freeze([
    "ご視聴ありがとうございました",
    "ご視聴ありがとうございます",
    "チャンネル登録をお願いします",
    "チャンネル登録をお願いいたします",
    "最後までご視聴ありがとうございました",
  ]),
  decision: "review-hold-only; no automatic deletion, replacement or ASR",
});
const normalized = (text) =>
  text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function contentSafety(records, { language = null } = {}) {
  if (!Array.isArray(records)) throw Error("CONTENT_SAFETY_INVALID_RECORDS");
  const rows = records.map((r, i) => {
    if (typeof r.text !== "string") throw Error("CONTENT_SAFETY_INVALID_TEXT");
    return {
      ...r,
      i,
      n: normalized(r.text),
      music: r.style === "music" || /[♪♫]/u.test(r.text),
      valid:
        Number.isFinite(r.start) &&
        Number.isFinite(r.end) &&
        r.start >= 0 &&
        r.end > r.start,
    };
  });
  const issues = [];
  const add = (code, selected, scope = "subtitle-sequence") =>
    issues.push({
      code,
      scope,
      cueIndexes: selected.map((r) => r.i),
      recordIds: selected.map((r) => r.id ?? r.recordId ?? `cue-${r.i + 1}`),
      start: selected.every((r) => r.valid)
        ? Math.min(...selected.map((r) => r.start))
        : null,
      end: selected.every((r) => r.valid)
        ? Math.max(...selected.map((r) => r.end))
        : null,
      acousticVerdict: "unverified",
      automaticRemovalAllowed: false,
    });
  for (const r of rows) {
    if (!r.valid) add("INVALID_TIMING", [r]);
    if (contentSafetyPolicy.templatePhrases.includes(r.n))
      add("TEMPLATE_PHRASE_REQUIRES_AUDIO", [r]);
    if (
      Array.from(r.n).length >= contentSafetyPolicy.minimumUniformCharacters &&
      new Set(r.n).size === 1
    )
      add("SINGLE_CHARACTER_DECODER_LOOP", [r]);
    // Inspect a run embedded inside a longer sentence, without treating a
    // standalone stretched interjection as a word to erase.
    const run = new RegExp(
      `([\\p{Script=Hiragana}\\p{Script=Katakana}])\\1{${contentSafetyPolicy.minimumEmbeddedKanaRun - 1},}`,
      "u",
    ).exec(r.n);
    if (run && [...run[0]].length < [...r.n].length && !r.music)
      add("EMBEDDED_KANA_DECODER_RUN", [r]);
    if (
      r.valid &&
      !r.music &&
      r.n &&
      r.end - r.start > contentSafetyPolicy.sparseDialogueMinimumSeconds &&
      [...r.n].length / (r.end - r.start) <
        contentSafetyPolicy.sparseDialogueMaximumCps
    )
      add("SPARSE_LONG_DIALOGUE_REQUIRES_AUDIO", [r]);
  }
  // A declared Japanese run is required. This is recurring foreign-token risk,
  // not an English/name blacklist and not permission to delete code-switching.
  if (language === "ja") {
    const tokens = new Map();
    for (const r of rows)
      if (r.valid && !r.music && /^[a-z]{1,3}$/iu.test(r.n)) {
        const key = r.n.toLowerCase();
        if (!tokens.has(key)) tokens.set(key, []);
        tokens.get(key).push(r);
      }
    for (const group of tokens.values()) {
      group.sort((a, b) => a.start - b.start);
      const flagged = new Set();
      for (let first = 0; first < group.length; first++) {
        const selected = group
          .slice(first)
          .filter(
            (r) =>
              r.end - group[first].start <=
              contentSafetyPolicy.foreignTokenMaximumWindowSeconds,
          );
        if (
          selected.length >= contentSafetyPolicy.foreignTokenMinimumOccurrences
        )
          selected.forEach((r) => flagged.add(r));
      }
      if (flagged.size) add("RECURRING_FOREIGN_SHORT_TOKEN", [...flagged]);
    }
  }
  // Competing text over the same time span needs occurrence review. Touching
  // or non-overlapping repetitions are not duplicates; never flatten them.
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (
      !a.valid ||
      a.music ||
      [...a.n].length < contentSafetyPolicy.containmentMinimumCharacters
    )
      continue;
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j];
      if (
        !b.valid ||
        b.music ||
        [...b.n].length < contentSafetyPolicy.containmentMinimumCharacters
      )
        continue;
      const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
      if (
        overlap >= contentSafetyPolicy.containmentMinimumOverlapSeconds &&
        (a.n.includes(b.n) || b.n.includes(a.n))
      )
        add("OVERLAPPING_TEXT_CONTAINMENT_REQUIRES_AUDIO", [a, b]);
    }
  }
  // Bounded sequence groups catch loops spanning request seams, without treating
  // an isolated ん / ああ or a pair of real responses as a deletion candidate.
  for (let first = 0; first < rows.length;) {
    let end = first + 1;
    while (
      end < rows.length &&
      rows[first].n &&
      rows[end].n === rows[first].n &&
      rows[end].valid &&
      rows[end - 1].valid &&
      rows[first].valid &&
      rows[end].start >= rows[end - 1].start &&
      rows[end].start - rows[end - 1].end <=
        contentSafetyPolicy.maximumLoopGapSeconds &&
      rows[end].end - rows[first].start <=
        contentSafetyPolicy.maximumLoopSpanSeconds
    )
      end++;
    const group = rows.slice(first, end);
    if (
      group.length >= contentSafetyPolicy.minimumLoopCues &&
      Array.from(rows[first].n).length <=
        contentSafetyPolicy.maximumShortTokenCharacters
    )
      add("SHORT_TOKEN_DECODER_LOOP", group);
    if (
      group.length >= contentSafetyPolicy.minimumSentenceLoopCues &&
      [...rows[first].n].length >
        contentSafetyPolicy.maximumShortTokenCharacters &&
      group.every((r) => !r.music) &&
      group.at(-1).end - group[0].start >=
        contentSafetyPolicy.minimumSentenceLoopSeconds
    )
      add("SENTENCE_DECODER_LOOP", group);
    first = end;
  }
  // Audit raw request groups separately: VAD gaps must not conceal low-diversity
  // decoding. Request ids are caller-provided provenance, never inferred by time.
  const requests = new Map();
  for (const r of rows)
    if (typeof r.requestId === "string" && r.requestId) {
      if (!requests.has(r.requestId)) requests.set(r.requestId, []);
      requests.get(r.requestId).push(r);
    }
  for (const [requestId, group] of requests) {
    const sentences = new Map();
    for (const r of group)
      if (
        !r.music &&
        [...r.n].length > contentSafetyPolicy.maximumShortTokenCharacters
      ) {
        if (!sentences.has(r.n)) sentences.set(r.n, []);
        sentences.get(r.n).push(r);
      }
    for (const repeated of sentences.values())
      if (
        repeated.length >= contentSafetyPolicy.minimumSentenceLoopCues &&
        repeated.length / group.length >= 0.8
      )
        add("REQUEST_SENTENCE_LOW_DIVERSITY", repeated, `request:${requestId}`);
    const short = group.filter(
      (r) =>
        r.n &&
        Array.from(r.n).length <=
          contentSafetyPolicy.maximumShortTokenCharacters,
    );
    if (
      short.length >= contentSafetyPolicy.minimumLoopCues &&
      short.length / group.length >= 0.8 &&
      new Set(short.map((r) => r.n)).size === 1
    )
      add("REQUEST_LOW_DIVERSITY", short, `request:${requestId}`);
  }
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i];
    if (
      a.valid &&
      b.valid &&
      !a.music &&
      !b.music &&
      a.n &&
      a.n === b.n &&
      b.start >= a.start &&
      b.start - a.end <= contentSafetyPolicy.maximumLoopGapSeconds &&
      Math.min(a.end - a.start, b.end - b.start) >=
        contentSafetyPolicy.minimumRepeatedLongSpanSeconds
    )
      add("REPEATED_LONG_SPAN", [a, b]);
  }
  const reviewCueIndexes = [
    ...new Set(issues.flatMap((r) => r.cueIndexes)),
  ].sort((a, b) => a - b);
  return {
    version: contentSafetyPolicy.version,
    policy: contentSafetyPolicy,
    inputHash: hash(JSON.stringify(records)),
    language,
    recordCount: records.length,
    status: issues.length ? "HOLD" : "NO_DETECTED_HIGH_RISK",
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    acousticCorrectness: "NOT_VERIFIED",
    reviewCueIndexes,
    issues,
    automaticDeletionCount: 0,
    newASRRequests: 0,
  };
}

export async function inspectContentSafety(outputs, options = {}) {
  const file = outputs.find((p) => p.endsWith(".srt"));
  if (!file) throw Error("CONTENT_SAFETY_SRT_REQUIRED");
  const bytes = await fs.readFile(file, "utf8");
  if (!bytes.trim()) throw Error("CONTENT_SAFETY_EMPTY_SUBTITLES");
  const records = formats.srt.parse(bytes);
  if (!records.length) throw Error("CONTENT_SAFETY_EMPTY_SUBTITLES");
  return {
    ...contentSafety(records, options),
    subtitle: file,
    subtitleHash: hash(bytes),
  };
}
