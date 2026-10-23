/** Observation only: no recognizer, reference input, text replacement or retiming. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseSrt } from "../../packages/subtitle-core/dist/parse.js";

export const shortResponsePolicy = Object.freeze({
  version: "short-response-observation-v1",
  maximumCharacters: 8,
  longEnvelopeSeconds: 2,
  normalization: "NFKC-remove-whitespace-punctuation-symbols-comparison-only",
  mode: "observe-only",
  automaticReplacementAllowed: false,
  timingVerified: false,
  modelAgreementSufficient: false,
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const normalizeShortResponse = (text) =>
  text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const validTime = (r) =>
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start;
const projection = (r) => ({
  id: r.id,
  start: r.start,
  end: r.end,
  text: r.text,
});

export function observeShortResponses(records) {
  if (!Array.isArray(records)) throw Error("RECORD_ARRAY_REQUIRED");
  const ids = new Set();
  for (const r of records) {
    if (!r || typeof r.id !== "string" || !r.id || ids.has(r.id))
      throw Error("UNIQUE_RECORD_ID_REQUIRED");
    ids.add(r.id);
  }
  const invalid = records.filter(
    (r) => !validTime(r) || typeof r.text !== "string",
  );
  const ordered = records
    .filter((r) => !invalid.includes(r))
    .toSorted(
      (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
    );
  const entries = [];
  for (const [index, r] of ordered.entries()) {
    const normalized = normalizeShortResponse(r.text);
    const characters = Array.from(normalized).length;
    if (
      !characters ||
      characters > shortResponsePolicy.maximumCharacters ||
      !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(
        normalized,
      )
    )
      continue;
    const overlappingIds = ordered
      .filter((o) => o.id !== r.id && o.start < r.end && o.end > r.start)
      .map((o) => o.id);
    const reasons = ["SHORT_TEXT_CONTEXT_UNVERIFIED"];
    if (r.end - r.start > shortResponsePolicy.longEnvelopeSeconds)
      reasons.push("LONG_ENVELOPE_SHORT_TEXT");
    if (overlappingIds.length) reasons.push("OVERLAPPING_CUE_ENVELOPES");
    entries.push({
      ...projection(r),
      characters,
      reasons,
      overlappingIds,
      previous: index ? projection(ordered[index - 1]) : null,
      next: index + 1 < ordered.length ? projection(ordered[index + 1]) : null,
      decision: "OBSERVE_ONLY",
      automaticReplacementAllowed: false,
      timingVerified: false,
    });
  }
  return {
    policy: shortResponsePolicy,
    recordCount: records.length,
    observedCount: entries.length,
    invalidRecordIds: invalid.map((r) => r.id),
    textHash: hash(JSON.stringify(records.map((r) => [r.id, r.text]))),
    timingHash: hash(
      JSON.stringify(records.map((r) => [r.id, r.start, r.end])),
    ),
    entries,
    limitations: [
      "Selection is a short-cue heuristic, not error detection or acoustic verification.",
      "Cue envelopes and neighboring text do not locate words or prove silence.",
      "Missing speech with no cue and short responses inside long text can be missed.",
      "Repeated responses at different occurrences are retained, never deduplicated.",
      "No reference, model confidence, or related-model vote can authorize a replacement here.",
    ],
  };
}

const jsonBytes = (value) => JSON.stringify(value, null, 2) + "\n";
const md = (s) =>
  s.replace(/[\\`*_{}[\]<>|]/gu, "\\$&").replace(/\r?\n/gu, " ");

/** Explicit inputs only. Never discovers neighboring references or starts inference. */
export async function deliverShortResponseObservation({
  recordsPath,
  subtitlePath,
  outputRoot,
  signal,
}) {
  signal?.throwIfAborted();
  if (
    !recordsPath ||
    !subtitlePath ||
    path.extname(subtitlePath).toLowerCase() !== ".srt"
  )
    throw Error("EXPLICIT_MAPPED_RECORDS_AND_PREFERRED_SRT_REQUIRED");
  const files = [path.resolve(recordsPath), path.resolve(subtitlePath)];
  const before = await Promise.all(files.map((f) => fs.readFile(f)));
  const mapped = JSON.parse(before[0].toString("utf8"));
  if (
    mapped.timebase !== "source-global-relative-to-container-origin" ||
    !Array.isArray(mapped.records)
  )
    throw Error("SOURCE_GLOBAL_MAPPED_RECORDS_REQUIRED");
  const baseline = observeShortResponses(
    mapped.records.map((r) => ({
      id: r.recordId,
      start: r.sourceStart,
      end: r.sourceEnd,
      text: r.text,
    })),
  );
  const parsed = parseSrt(before[1].toString("utf8"));
  if (!parsed.length) throw Error("NO_PREFERRED_SUBTITLE_CUES");
  const preferred = observeShortResponses(
    parsed.map((r, i) => ({
      id: `preferred-${i + 1}`,
      start: r.start,
      end: r.end,
      text: r.text,
    })),
  );
  if (preferred.invalidRecordIds.length)
    throw Error("INVALID_PREFERRED_SUBTITLE_TIMING");
  const audit = {
    version: shortResponsePolicy.version,
    mode: "observe-only",
    coverageScope: mapped.coverageScope,
    inputs: files.map((file, i) => ({ file, sha256: hash(before[i]) })),
    baseline,
    preferred,
    newInference: 0,
    referenceUsed: false,
    subtitleTextMutations: 0,
    subtitleTimingMutations: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
  };
  const after = await Promise.all(files.map((f) => fs.readFile(f)));
  if (after.some((bytes, i) => !bytes.equals(before[i])))
    throw Error("OBSERVATION_INPUT_CHANGED");
  signal?.throwIfAborted();
  const artifact = path.join(outputRoot, "SHORT_RESPONSE_OBSERVATION.json");
  const index = path.join(outputRoot, "SHORT_RESPONSE_OBSERVATION.md");
  await fs.writeFile(artifact, jsonBytes(audit), { flag: "wx" });
  await fs.writeFile(
    index,
    [
      "# 短回应观察清单（不自动改稿）",
      "",
      `实际推荐 SRT：${preferred.recordCount} 条中 ${preferred.observedCount} 条短句待核对。`,
      `原始映射记录：${baseline.recordCount} 条中 ${baseline.observedCount} 条；非法记录 ${baseline.invalidRecordIds.length} 条另列。`,
      "",
      "这些是风险候选，不是已确认错误；零新增推理、零文本/时间改写。缺失对白及长句内短回应可能漏检，不能用清单数量代表准确率。",
      "",
      "以下时间是已有字幕跨度，不是经过验证的发声边界。完整前后句及原始记录见 [JSON](SHORT_RESPONSE_OBSERVATION.json)。",
      "",
      ...preferred.entries.flatMap((r) => [
        `- ${r.start.toFixed(2)}–${r.end.toFixed(2)} 秒：${md(r.text)}（${r.reasons.join(", ")}）`,
        `  前：${r.previous ? md(r.previous.text) : "无"}；后：${r.next ? md(r.next.text) : "无"}`,
      ]),
      "",
    ].join("\n"),
    { flag: "wx" },
  );
  signal?.throwIfAborted();
  return {
    status: "observed",
    artifact,
    index,
    observedCount: preferred.observedCount,
    baselineObservedCount: baseline.observedCount,
    newInference: 0,
    mode: "observe-only",
    automaticReplacementAllowed: false,
  };
}
