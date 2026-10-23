/** Pure word-span proposals. No inference, reference reads, or automatic selection. */
/* global structuredClone */
import { z } from "zod";
import { identity } from "./content-review-plan.mjs";
import { compareStreams, textStream } from "./historical-reference-text.mjs";
import {
  REVIEW_ACTION_REGISTRY,
  portableValidateReviewAction,
} from "../../packages/video-subtitler/dist/review-action-validation.js";
import { buildSubtitleSeriesMemoryEvidence } from "../../packages/transcription-core/dist/series-memory.js";

export const wordPolicy = Object.freeze({
  version: "word-repair-review-v1",
  maxSpanCharacters: 12,
  maxChangedFraction: 0.5,
  maxCandidatesPerCue: 12,
  autoApply: false,
  boundaryToleranceSeconds: 0.12,
  minimumPosterior: 0.1,
  priorIsAcousticProof: false,
  fullVideoAcceptance: false,
});
const white = (t) => t.replace(/\s/gu, "");
const lexical = (t) => t.replace(/[\s\p{P}\p{S}]/gu, "");
export function distance(a, b) {
  return compareStreams(
    textStream([{ recordId: "r", text: a }], "A"),
    textStream([{ recordId: "m", text: b }], "B"),
    "whitespace-only-v1",
  ).distance;
}
export function completeUnits(baseline, reference, count = 24, seeds = []) {
  if (!Number.isInteger(count) || count < 2 || count > 30)
    throw Error("UNIT_COUNT");
  const rows = [
    ...baseline.map((r) => ({
      start: r.sourceStart,
      end: r.sourceEnd,
      id: r.recordId,
      kind: "machine",
      text: r.text,
    })),
    ...reference.map((r) => ({
      start: r.start,
      end: r.end,
      id: r.refId,
      kind: r.style === "Default" ? "reference" : "other",
      text: r.visibleText,
    })),
  ];
  if (
    rows.some(
      (r) =>
        !Number.isFinite(r.start) ||
        !Number.isFinite(r.end) ||
        r.start < 0 ||
        r.end <= r.start ||
        typeof r.text !== "string",
    )
  )
    throw Error("UNIT_INPUT_INVALID");
  const groups = [];
  for (const r of rows.sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  )) {
    const last = groups.at(-1);
    if (last && r.start < last.end) {
      last.end = Math.max(last.end, r.end);
      last.rows.push(r);
    } else groups.push({ start: r.start, end: r.end, rows: [r] });
  }
  const eligible = groups
    .filter(
      (g) =>
        g.end - g.start <= 90 &&
        !g.rows.some((r) => r.kind === "other") &&
        g.rows.some((r) => r.kind === "reference"),
    )
    .map((g) => {
      const machine = g.rows.filter((r) => r.kind === "machine"),
        refs = g.rows.filter((r) => r.kind === "reference");
      const a = machine.map((r) => r.text).join(""),
        b = refs.map((r) => r.text).join("");
      return {
        id:
          "unit-" +
          identity({
            start: g.start,
            end: g.end,
            ids: g.rows.map((r) => r.id),
          }).slice(0, 16),
        start: g.start,
        end: g.end,
        baselineIds: machine.map((r) => r.id),
        referenceIds: refs.map((r) => r.id),
        category: !a
          ? "missing"
          : white(a) === white(b)
            ? "exact-control"
            : lexical(a) === lexical(b)
              ? "surface-control"
              : g.end - g.start < 3
                ? "short-dialogue"
                : "text-difference",
        baselineText: a,
        referenceText: b,
        referenceDistance: distance(b, a),
        structurallyComplete: true,
        acousticallyReverified: false,
      };
    });
  const chosen = [];
  const add = (u) => {
    if (u && !chosen.includes(u) && chosen.length < count) chosen.push(u);
  };
  eligible.filter((u) => u.category.endsWith("control")).forEach(add);
  for (const s of seeds) {
    const mid = (s.start + s.end) / 2;
    add(eligible.find((u) => u.start <= mid && u.end >= mid));
  }
  for (const kind of ["missing", "short-dialogue"])
    eligible
      .filter((u) => u.category === kind)
      .slice(0, 4)
      .forEach(add);
  // Deterministic temporal spread; no selection based on proposed repair results.
  for (let i = 0; i < count && chosen.length < count; i++)
    add(eligible[Math.floor((i * (eligible.length - 1)) / (count - 1))]);
  eligible.forEach(add);
  if (chosen.length !== count) throw Error("INSUFFICIENT_COMPLETE_UNITS");
  return {
    units: chosen.sort((a, b) => a.start - b.start),
    excluded: groups.length - eligible.length,
    policy:
      "complete-temporal-component-with-all-original-records; reference-assisted development selection; max90s review-only, not ASR windows",
  };
}

export function wordBoundaries(text) {
  const boundaries = new Set([0, text.length]);
  for (const s of new Intl.Segmenter("ja", { granularity: "word" }).segment(
    text,
  )) {
    boundaries.add(s.index);
    boundaries.add(s.index + s.segment.length);
  }
  return boundaries;
}
export function localDiffs(original, alternate) {
  if (original.length > 1000 || alternate.length > 1000) return [];
  const c = compareStreams(
    textStream([{ recordId: "a", text: original }], "A"),
    textStream([{ recordId: "b", text: alternate }], "B"),
    "exact-visible-v1",
  );
  const edits = c.edits ?? [],
    out = [];
  let a = 0,
    b = 0,
    group = null;
  for (const e of edits) {
    if (e.op !== "M" && !group) group = { aStart: a, bStart: b };
    if (e.op === "M" && group) {
      out.push({ ...group, aEnd: a, bEnd: b });
      group = null;
    }
    if (e.op !== "I") a++;
    if (e.op !== "D") b++;
  }
  if (group) out.push({ ...group, aEnd: a, bEnd: b });
  const ac = [...original],
    bc = [...alternate],
    bound = wordBoundaries(original);
  return out
    .map((g) => {
      const rawStart = ac.slice(0, g.aStart).join("").length,
        rawEnd = ac.slice(0, g.aEnd).join("").length;
      if (g.aStart === g.aEnd || g.bStart === g.bEnd)
        return { before: "", after: "" };
      const start = Math.max(...[...bound].filter((i) => i <= rawStart));
      const end = Math.min(...[...bound].filter((i) => i >= rawEnd));
      return {
        start,
        end,
        before: original.slice(start, end),
        after:
          original.slice(start, rawStart) +
          bc.slice(g.bStart, g.bEnd).join("") +
          original.slice(rawEnd, end),
      };
    })
    .filter(
      (g) =>
        g.before &&
        g.after &&
        g.before.trim() &&
        g.after.trim() &&
        bound.has(g.start) &&
        bound.has(g.end) &&
        [...g.before].length <= wordPolicy.maxSpanCharacters &&
        [...g.after].length <= wordPolicy.maxSpanCharacters &&
        [...g.before].length / Math.max(ac.length, 1) <=
          wordPolicy.maxChangedFraction,
    );
}
export function proposeWords(record, alternates, memory) {
  const proposals = [];
  for (const alt of alternates) {
    if (!alt.targetCueIds?.includes(record.recordId)) continue;
    if (alt.start >= record.sourceEnd || alt.end <= record.sourceStart)
      continue;
    // Window overlap alone is not an occurrence association. Reject unrelated transcripts.
    if (
      distance(record.text, alt.text) /
        Math.max([...record.text].length, [...alt.text].length, 1) >
      0.45
    )
      continue;
    for (const d of localDiffs(record.text, alt.text)) {
      if (/\s/u.test(d.before) || /\s/u.test(d.after)) continue;
      const text =
        record.text.slice(0, d.start) + d.after + record.text.slice(d.end);
      const cue = {
        id: record.recordId,
        text,
        start: record.sourceStart,
        end: record.sourceEnd,
        language: "ja",
        languages: ["ja"],
        style: "default",
        speaker: null,
        confidence: null,
      };
      const context = buildSubtitleSeriesMemoryEvidence({
        cues: [cue],
        memory,
        baseCueHash: identity(record),
        generatedAt: "2000-01-01T00:00:00.000Z",
      });
      const key = identity({ record: record.recordId, ...d });
      const old = proposals.find((p) => p.candidateId === key);
      if (old) {
        old.sources.push(alt.id);
        continue;
      }
      proposals.push({
        candidateId: key,
        targetCueIds: [record.recordId],
        text,
        baseText: record.text,
        span: d,
        sources: [alt.id],
        memoryEntryIds: context.cues[0].matchedEntryIds,
        authority: "machine-word-proposal",
        automaticEligible: false,
        reason:
          "Whole word-span from same-window ASR; occurrence/timing and lexical correctness require explicit review",
      });
    }
  }
  return proposals
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId))
    .slice(0, wordPolicy.maxCandidatesPerCue);
}
export function memoryHints(record, memory) {
  // Only expose prior vocabulary, never invent an observed wrong-form mapping.
  return memory.entries
    .filter(
      (e) =>
        e.status === "active" &&
        ["ranking-only", "ranking-and-pronunciation"].includes(
          e.applicationEligibility,
        ) &&
        [e.canonicalSurface, ...e.observedWrongForms, ...e.variants].some(
          (t) => t && record.text.includes(t),
        ),
    )
    .map((e) => ({
      entryId: e.entryId,
      surface: e.canonicalSurface,
      readings: e.acousticAliases,
      trust: e.trustLevel,
      authority: "prior-only",
    }));
}
export function proposePriorWords(record, memory) {
  const points = [...wordBoundaries(record.text)].sort((a, b) => a - b),
    out = [];
  const kana = (s) =>
    s
      .normalize("NFKC")
      .replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  for (let i = 0; i < points.length - 1; i++)
    for (let j = i + 1; j < points.length && j <= i + 4; j++) {
      const start = points[i],
        end = points[j],
        before = record.text.slice(start, end);
      if (
        /[\s\p{P}\p{S}]/u.test(before) ||
        [...before].length > 12 ||
        [...before].length > [...record.text].length * 0.5
      )
        continue;
      for (const e of memory.entries.filter(
        (e) =>
          e.status === "active" &&
          ["human-reviewed", "repeated-verified"].includes(e.trustLevel) &&
          ["ranking-only", "ranking-and-pronunciation"].includes(
            e.applicationEligibility,
          ),
      )) {
        const after = e.canonicalSurface;
        if (
          before === after ||
          [...after].length > 12 ||
          !/\p{Script=Han}/u.test(after)
        )
          continue;
        const readings = [e.readingHiragana, ...e.acousticAliases].filter(
          Boolean,
        );
        const readingMatch =
          /^[ぁ-ゖァ-ヶー]+$/u.test(before) &&
          readings.some(
            (r) =>
              distance(kana(before), kana(r)) <= 1 &&
              distance(kana(before), kana(r)) /
                Math.max([...before].length, [...r].length) <=
                0.25,
          );
        let prefix = 0,
          suffix = 0;
        while (
          prefix < Math.min(before.length, after.length) &&
          before[prefix] === after[prefix]
        )
          prefix++;
        while (
          suffix < Math.min(before.length, after.length) - prefix &&
          before.at(-1 - suffix) === after.at(-1 - suffix)
        )
          suffix++;
        const surfaceMatch =
          before.length === after.length &&
          Math.max(prefix, suffix) >= 3 &&
          distance(before, after) <= 2;
        if (!readingMatch && !surfaceMatch) continue;
        const span = { start, end, before, after },
          candidateId = identity({
            recordId: record.recordId,
            entryId: e.entryId,
            span,
            authority: "prior-only",
          });
        out.push({
          candidateId,
          targetCueIds: [record.recordId],
          baseText: record.text,
          text: record.text.slice(0, start) + after + record.text.slice(end),
          span,
          sources: ["series-memory:" + e.entryId],
          memoryEntryIds: [e.entryId],
          authority: "prior-word-proposal",
          automaticEligible: false,
          reason:
            "Approximate stored reading/surface lookup; not an observed wrong-form or acoustic verification",
        });
      }
    }
  return out
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId))
    .slice(0, 12);
}
export function sideEvidence(raws, side) {
  if (!["start", "end"].includes(side)) throw Error("UNKNOWN_BOUNDARY_SIDE");
  const values = raws.map((r) => r.selectedBoundary?.[side]);
  const index = side === "start" ? 0 : -1;
  const usable =
    raws.length === 2 &&
    raws.every(
      (r, i) =>
        r.pathStatus === "success" &&
        r.frameCountVerified === true &&
        r.workerRequestVerified === true &&
        typeof r.target?.targetText === "string" &&
        r.target.targetText.length > 0 &&
        typeof values[i] === "number" &&
        Number.isFinite(values[i]) &&
        r.target?.targetText === raws[0].target?.targetText &&
        !(side === "start"
          ? r.startPinnedToWindowEdge
          : r.endPinnedToWindowEdge) &&
        r.tokenSpans?.at(index)?.meanPosterior >= wordPolicy.minimumPosterior,
    );
  return {
    side,
    values,
    stable:
      usable &&
      Math.abs(values[0] - values[1]) <= wordPolicy.boundaryToleranceSeconds,
    acousticConditionalOnly: true,
    lexicalVerified: false,
    automaticEligible: false,
    reason: usable
      ? "Single CTC family; conditional alignment only"
      : "Missing, pinned, mismatched or weak edge token",
  };
}

const nullableText = z.string().max(1000).nullable();
export const resolutionSchema = z
  .object({
    resolutionId: z.string().min(1),
    reviewId: z.string().min(1),
    action: z.string(),
    selectedCandidateId: z.string().nullable(),
    selectedCandidateEvidenceHash: z.string().nullable(),
    correctedText: nullableText,
    start: z.number().finite().nullable(),
    end: z.number().finite().nullable(),
    splitParts: z.array(z.unknown()).max(0),
    mergeCueIds: z.array(z.string()).max(0),
    reviewerNotes: z.string().max(2000),
    errorTypes: z.array(z.string()).max(20),
    confirmedReading: z.string().nullable(),
    terminologyHints: z.array(z.string()).max(20),
    dialectHints: z.array(z.string()).max(20),
  })
  .strict();
export function emptyResolution(reviewId, action = "KEEP") {
  return {
    resolutionId: "action-" + reviewId,
    reviewId,
    action,
    selectedCandidateId: null,
    selectedCandidateEvidenceHash: null,
    correctedText: null,
    start: null,
    end: null,
    splitParts: [],
    mergeCueIds: [],
    reviewerNotes: "",
    errorTypes: [],
    confirmedReading: null,
    terminologyHints: [],
    dialectHints: [],
  };
}
export function applyActions(workspace, actions) {
  const records = structuredClone(workspace.baseline),
    changes = [];
  const seen = new Set();
  for (const value of actions) {
    const a = resolutionSchema.parse(value);
    if (
      ![
        "KEEP",
        "ACCEPT_SUGGESTION",
        "EDIT_TEXT",
        "EDIT_TIMING",
        "MARK_UNRESOLVED",
      ].includes(a.action)
    )
      throw Error("UNSUPPORTED_LOCAL_ACTION");
    if (seen.has(a.resolutionId)) throw Error("DUPLICATE_ACTION_ID");
    seen.add(a.resolutionId);
    const item = workspace.items.find((i) => i.reviewId === a.reviewId);
    if (!item) throw Error("UNKNOWN_REVIEW_ITEM");
    const checked = portableValidateReviewAction(
      REVIEW_ACTION_REGISTRY,
      item,
      a,
      workspace.reviewVersion,
    );
    if (!checked.valid)
      throw Error(checked.errors.map((e) => e.code).join(","));
    let rec = records.find((r) => r.recordId === item.targetCueIds[0]);
    if (!rec) {
      if (["KEEP", "MARK_UNRESOLVED"].includes(a.action)) continue;
      rec = {
        recordId: item.targetCueIds[0],
        text: "",
        sourceStart: null,
        sourceEnd: null,
        reviewInserted: true,
        unitId: item.unitId,
      };
      records.push(rec);
    }
    const before = structuredClone(rec);
    if (a.action === "ACCEPT_SUGGESTION") {
      const candidate = item.candidateSuggestions.find(
        (c) => c.candidateId === a.selectedCandidateId,
      );
      if (rec.text !== candidate.baseText)
        throw Error("STALE_CANDIDATE_BASE_TEXT");
      rec.text = candidate.text;
    }
    if (a.action === "EDIT_TEXT") rec.text = a.correctedText;
    if (a.action === "EDIT_TIMING") {
      if (
        [a.start, a.end].some(
          (t) => Math.abs(t * 100 - Math.round(t * 100)) > 1e-7,
        )
      )
        throw Error("CENTISECOND_GRID_REQUIRED");
      rec.sourceStart = a.start;
      rec.sourceEnd = a.end;
    }
    if (typeof rec.text !== "string" || /[{}<>\\\r]/u.test(rec.text))
      throw Error("UNSAFE_SUBTITLE_TEXT");
    if (identity(before) !== identity(rec))
      changes.push({
        resolutionId: a.resolutionId,
        reviewId: a.reviewId,
        action: a.action,
        before,
        after: structuredClone(rec),
        authority: "explicit-review-action-not-machine-inference",
      });
  }
  const incomplete = records.filter(
    (r) =>
      r.reviewInserted &&
      (!r.text.trim() || r.sourceStart === null || r.sourceEnd === null),
  );
  const active = records.filter((r) => !incomplete.includes(r));
  for (const r of active) {
    if (
      !Number.isFinite(r.sourceStart) ||
      !Number.isFinite(r.sourceEnd) ||
      r.sourceStart < 0 ||
      r.sourceEnd > workspace.sourceEnd ||
      r.sourceEnd <= r.sourceStart
    )
      throw Error("INVALID_EXPORT_TIME");
  }
  for (const c of changes) {
    if (
      c.before.sourceStart === c.after.sourceStart &&
      c.before.sourceEnd === c.after.sourceEnd
    )
      continue;
    const after = active.find((r) => r.recordId === c.after.recordId);
    if (!after) continue;
    for (const other of active) {
      if (other.recordId === after.recordId) continue;
      const overlap = (r, o) =>
        Math.max(
          0,
          Math.min(r.sourceEnd, o.sourceEnd) -
            Math.max(r.sourceStart, o.sourceStart),
        );
      const old = workspace.baseline.find((r) => r.recordId === after.recordId),
        oldOther = workspace.baseline.find(
          (r) => r.recordId === other.recordId,
        );
      if (
        overlap(after, other) >
        (old && oldOther ? overlap(old, oldOther) : 0) + 1e-7
      )
        throw Error("NEW_NEIGHBOR_OVERLAP");
    }
  }
  return {
    records: active.sort(
      (a, b) =>
        a.sourceStart - b.sourceStart || a.recordId.localeCompare(b.recordId),
    ),
    changes,
    incompleteInsertions: incomplete.map((r) => r.recordId),
    status: "needs-review",
    humanValidated: false,
    finalizationMethod: "none",
  };
}
