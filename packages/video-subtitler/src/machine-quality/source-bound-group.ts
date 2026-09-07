import { z } from "zod";
import { subtitleCueSchema, type SubtitleCue } from "@mvl/shared";
import { layoutSubtitleCuesWithDiagnostics } from "@mvl/subtitle-core";
import { objectHash } from "./experimental-profile.js";
import { lexical, type AcousticCase } from "./bounded-acoustic.js";
import {
  storedObservationSchema,
  type StoredObservation,
} from "./stored-token-span.js";

export const GROUP_POLICY = {
  version: "c601164-source-bound-group-v1",
  representative: "W2_ONLY_PREDECLARED",
  selection:
    "complete consecutive original parents intersecting occurrence seed; no substring search",
  closure:
    "only predeclared wholly enclosed source-related neighbors; no protected overlap",
  timing:
    "native lexical token outer anchors or conditional CTC symbol intervals; no proportional timing",
  splitting:
    "original parent boundaries only when also Japanese word boundaries; otherwise merge complete adjacent parents",
  downstream: "freeze approved word order and boundaries; display-only layout",
  independentLexicalVotes: 0,
  lexicalTruthValidated: false,
  mainResearchCandidate: "T2-aligned-group",
  defaultPromotionAuthorized: false,
} as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const bounds = z.object({ start: z.number(), end: z.number() }).strict();
const boundCue = z.object({ cue: subtitleCueSchema, hash }).strict();
export const sourceGroupSchema = z
  .object({
    version: z.literal("c601164-source-group-v1"),
    id: z.string(),
    inputStageHash: hash,
    caseBindingHash: hash,
    sourceRequestIds: z.array(z.string()),
    occurrenceIds: z.array(z.string()),
    seed: bounds,
    readEnvelope: bounds,
    initialEditableCueIds: z.array(z.string()),
    eligibleNeighborCueIds: z.array(z.string()),
    protectedNeighborCueIds: z.array(z.string()),
    stageCues: z.array(boundCue),
    representativeRequestId: z.string(),
    selectedParentIndices: z.array(z.number().int()),
    candidateCharacterSpan: z
      .object({ start: z.number().int(), end: z.number().int() })
      .strict(),
    sourceTextHash: hash,
    sourceObservationHash: hash,
    reasons: z.array(z.string()),
  })
  .strict();
export type SourceGroup = z.infer<typeof sourceGroupSchema>;
export const alignmentSchema = z
  .object({
    version: z.literal("c601164-alignment-v1"),
    requestId: z.string(),
    sourceObservationHash: hash,
    audioHash: hash,
    rawResultHash: hash,
    evidenceKind: z.literal("ALIGNER_ESTIMATED_INTERVAL"),
    status: z.enum(["SUCCESS", "FAILED", "UNREPRESENTABLE", "UNAVAILABLE"]),
    targetText: z.string(),
    sourceText: z.string(),
    symbols: z.array(
      z
        .object({
          text: z.string(),
          characterStart: z.number().int(),
          characterEnd: z.number().int(),
          tokenId: z.number().int(),
          start: z.number(),
          end: z.number(),
          startFrame: z.number().int(),
          endFrameExclusive: z.number().int(),
        })
        .strict(),
    ),
    mappingComplete: z.boolean(),
    reasons: z.array(z.string()),
    lexicalTruthValidated: z.literal(false),
  })
  .strict();
export type GroupAlignment = z.infer<typeof alignmentSchema>;
export const groupPatchSchema = z
  .object({
    version: z.literal("c601164-group-patch-v1"),
    id: z.string(),
    group: sourceGroupSchema,
    mode: z.enum(["native", "aligned"]),
    action: z.enum([
      "REPLACE_SOURCE_BOUND_UTTERANCE_GROUP",
      "ABSTAIN_KEEP_STAGE_INPUT",
    ]),
    candidateRequestId: z.string(),
    candidateCharacterSpan: sourceGroupSchema.shape.candidateCharacterSpan,
    evidenceKind: z.enum([
      "STORED_ASR_INTERVAL_ESTIMATE",
      "ALIGNER_ESTIMATED_INTERVAL",
    ]),
    timingEvidenceHash: hash,
    oldCues: z.array(boundCue),
    newCues: z.array(subtitleCueSchema),
    protectedNeighbors: z.array(boundCue),
    includedNeighborReasons: z.array(z.string()),
    reasons: z.array(z.string()),
    risks: z.array(z.string()),
    normalizedTextChanged: z.boolean(),
    timingChanged: z.boolean(),
    lexicalTruthValidated: z.literal(false),
  })
  .strict();
export type GroupPatch = z.infer<typeof groupPatchSchema>;
export const overlap = (
  a: { start: number; end: number },
  b: { start: number; end: number },
) => a.end > b.start + 1e-8 && a.start < b.end - 1e-8;
const contains = (
  a: { start: number; end: number },
  b: { start: number; end: number },
) => b.start >= a.start - 1e-8 && b.end <= a.end + 1e-8;
const fullText = (o: StoredObservation) =>
  o.parents.map((p) => p.originalText).join("");
const bound = (c: SubtitleCue) => ({
  cue: structuredClone(c),
  hash: objectHash(c),
});
const need = <T>(v: T | null | undefined): T => {
  if (v === undefined || v === null)
    throw Error("Missing source-bound identity");
  return v;
};
export function prepareSourceGroup(
  c: AcousticCase,
  stage: readonly SubtitleCue[],
  observations: StoredObservation[],
): SourceGroup {
  const w2 = observations.filter(
    (o) => o.caseBindingHash === c.bindingHash && o.windowId === "w2",
  );
  if (w2.length !== 1)
    throw Error("W2 representative unavailable or ambiguous");
  const o = need(w2[0]);
  const initial = stage.filter(
    (s) =>
      c.occurrenceIds.includes(s.id) ||
      s.textAudit?.sourceWinnerCueIds.some((id) =>
        c.occurrenceIds.includes(id),
      ),
  );
  // One hash-verified Primary source-global timeline: a request boundary is
  // not a media discontinuity. Adjacent, wholly enclosed same-style cues may
  // be eligible across chunks. Human/final cues are excluded by the input schema.
  const sourceRelated = (s: SubtitleCue) =>
    initial.some(
      (i) =>
        (i.style ?? "default") === (s.style ?? "default") &&
        i.speaker === s.speaker,
    ) &&
    s.language === "ja" &&
    stage
      .filter(
        (n) =>
          n.start >= Math.min(s.start, c.core.start) &&
          n.end <= Math.max(s.end, c.core.end),
      )
      .every(
        (n) =>
          (n.style ?? "default") === (s.style ?? "default") &&
          n.speaker === s.speaker,
      );
  const eligible = stage.filter(
    (s) =>
      !initial.some((i) => i.id === s.id) &&
      contains(o.window, s) &&
      sourceRelated(s),
  );
  const indices = o.parents
    .filter((p) => p.bounds && overlap(p.bounds, c.core))
    .map((p) => p.segmentIndex);
  const all = Array.from(fullText(o));
  const first = indices[0],
    last = indices.at(-1);
  const start = o.parents
    .filter((p) => first !== undefined && p.segmentIndex < first)
    .reduce((n, p) => n + Array.from(p.originalText).length, 0);
  const end =
    start +
    o.parents
      .filter((p) => indices.includes(p.segmentIndex))
      .reduce((n, p) => n + Array.from(p.originalText).length, 0);
  const reasons: string[] = [];
  if (!initial.length) reasons.push("UNBOUND_SEED_OCCURRENCE");
  if (initial.some((i) => !contains(o.window, i)))
    reasons.push("INITIAL_GROUP_OUTSIDE_READ_ENVELOPE");
  if (
    first === undefined ||
    last === undefined ||
    last - first + 1 !== indices.length
  )
    reasons.push("DISCONNECTED_SOURCE_SELECTION");
  return sourceGroupSchema.parse({
    version: "c601164-source-group-v1",
    id: c.id,
    inputStageHash: objectHash(stage),
    caseBindingHash: c.bindingHash,
    sourceRequestIds: c.sourceRequestIds,
    occurrenceIds: c.occurrenceIds,
    seed: c.core,
    readEnvelope: o.window,
    initialEditableCueIds: initial.map((i) => i.id),
    eligibleNeighborCueIds: eligible.map((i) => i.id),
    protectedNeighborCueIds: stage
      .filter((s) => !initial.includes(s) && !eligible.includes(s))
      .map((s) => s.id),
    stageCues: stage.map(bound),
    representativeRequestId: o.requestId,
    selectedParentIndices: indices,
    candidateCharacterSpan: { start, end },
    sourceTextHash: objectHash(all.slice(start, end).join("")),
    sourceObservationHash: objectHash(o),
    reasons,
  });
}

/** Complete source mapping; ignores only documented non-spoken typography.
 * CTC pieces may span multiple Japanese characters, but never get time-divided.
 */
export function alignmentTarget(source: string) {
  const symbols = Array.from(source).flatMap((s, i) =>
    /^[\p{P}\p{Z}\s]$/u.test(s)
      ? []
      : [{ text: s.normalize("NFC"), characterStart: i, characterEnd: i + 1 }],
  );
  return {
    sourceText: source,
    targetText: symbols.map((s) => s.text).join(""),
    characters: symbols,
  };
}
export function consumeGroupAlignment(
  o: StoredObservation,
  raw: unknown,
): GroupAlignment {
  const r = z
    .object({
      requestId: z.string(),
      status: z.string(),
      targetText: z.string(),
      pieces: z.array(
        z
          .object({
            text: z.string(),
            tokenId: z.number().int(),
            start: z.number(),
            end: z.number(),
            startFrame: z.number().int(),
            endFrameExclusive: z.number().int(),
          })
          .strict(),
      ),
      reasons: z.array(z.string()),
    })
    .strict()
    .parse(raw);
  const target = alignmentTarget(fullText(o));
  const reasons = [...r.reasons];
  if (r.requestId !== o.requestId || r.targetText !== target.targetText)
    reasons.push("ALIGNMENT_SOURCE_IDENTITY_MISMATCH");
  let offset = 0;
  const symbols = r.pieces.map((p) => {
    const size = Array.from(p.text).length;
    const chars = target.characters.slice(offset, offset + size);
    offset += size;
    if (
      chars.map((c) => c.text).join("") !== p.text ||
      !contains(o.window, p) ||
      p.end <= p.start
    )
      reasons.push("ALIGNMENT_SYMBOL_MAPPING_INVALID");
    return {
      ...p,
      characterStart: chars[0]?.characterStart ?? -1,
      characterEnd: chars.at(-1)?.characterEnd ?? -1,
    };
  });
  if (
    offset !== target.characters.length ||
    symbols.some((s, i) => i > 0 && s.start < need(symbols[i - 1]).start)
  )
    reasons.push("ALIGNMENT_MAPPING_INCOMPLETE");
  const status =
    r.status === "SUCCESS"
      ? "SUCCESS"
      : r.status === "UNREPRESENTABLE"
        ? "UNREPRESENTABLE"
        : "FAILED";
  return alignmentSchema.parse({
    version: "c601164-alignment-v1",
    requestId: o.requestId,
    sourceObservationHash: objectHash(o),
    audioHash: o.audioHash,
    rawResultHash: objectHash(raw),
    evidenceKind: "ALIGNER_ESTIMATED_INTERVAL",
    status,
    targetText: target.targetText,
    sourceText: target.sourceText,
    symbols,
    mappingComplete: status === "SUCCESS" && reasons.length === 0,
    reasons: [...new Set(reasons)],
    lexicalTruthValidated: false,
  });
}

export function buildGroupPatch(
  groupValue: SourceGroup,
  observation: StoredObservation,
  mode: "native" | "aligned",
  alignment?: GroupAlignment,
  w1?: StoredObservation,
): GroupPatch {
  const g = sourceGroupSchema.parse(groupValue),
    o = storedObservationSchema.parse(observation);
  const reasons = [...g.reasons],
    risks = ["LEXICAL_CORRECTNESS_UNKNOWN", "REPETITION_COUNT_UNVERIFIED"];
  if (
    objectHash(o) !== g.sourceObservationHash ||
    o.requestId !== g.representativeRequestId ||
    o.windowId !== "w2"
  )
    reasons.push("W2_SOURCE_IDENTITY_MISMATCH");
  if (!w1 || lexical(fullText(w1)) !== lexical(fullText(o)))
    risks.push("CROSS_WINDOW_TEXT_DISAGREEMENT_DIAGNOSTIC");
  const selected = o.parents.filter((p) =>
    g.selectedParentIndices.includes(p.segmentIndex),
  );
  if (
    selected.some(
      (p) =>
        !p.sourceTextComplete ||
        p.tokens.some(
          (t) =>
            t.kind === "UNVERIFIED_CONTROL" ||
            t.flags.includes("INVALID_UNICODE"),
        ),
    )
  )
    reasons.push("SOURCE_TEXT_INCOMPLETE");
  const text = selected.map((p) => p.originalText).join("");
  if (!lexical(text) || objectHash(text) !== g.sourceTextHash)
    reasons.push("EMPTY_OR_MISMATCHED_CANDIDATE");
  const a = alignment ? alignmentSchema.parse(alignment) : undefined;
  if (
    mode === "aligned" &&
    (!a ||
      !a.mappingComplete ||
      a.status !== "SUCCESS" ||
      a.sourceObservationHash !== objectHash(o) ||
      a.audioHash !== o.audioHash)
  )
    reasons.push("ALIGNMENT_MAPPING_UNAVAILABLE");
  const wordBoundaries = new Set<number>([0, Array.from(fullText(o)).length]);
  for (const s of new Intl.Segmenter("ja", { granularity: "word" }).segment(
    fullText(o),
  )) {
    wordBoundaries.add(Array.from(fullText(o).slice(0, s.index)).length);
    wordBoundaries.add(
      Array.from(fullText(o).slice(0, s.index + s.segment.length)).length,
    );
  }
  if (
    !wordBoundaries.has(g.candidateCharacterSpan.start) ||
    !wordBoundaries.has(g.candidateCharacterSpan.end)
  )
    reasons.push("SOURCE_WORD_CUT");
  let cursor = 0;
  const units: {
    text: string;
    start: number;
    end: number;
    characterStart: number;
    characterEnd: number;
  }[] = [];
  for (const p of o.parents) {
    const from = cursor;
    cursor += Array.from(p.originalText).length;
    if (!g.selectedParentIndices.includes(p.segmentIndex)) continue;
    let start: number | undefined, end: number | undefined;
    if (mode === "native") {
      const tokens = p.tokens.filter(
        (t) => t.kind === "LEXICAL" && lexical(t.originalText),
      );
      const first = tokens[0],
        last = tokens.at(-1);
      if (first?.timeStatus === "INTERVAL" && last?.timeStatus === "INTERVAL") {
        start = first.global?.start;
        end = last.global?.end;
      } else reasons.push("NATIVE_UNANCHORED_LEXICAL_EDGE");
      if (
        tokens.some(
          (t, i) =>
            t.timeStatus === "INVALID" ||
            t.flags.includes("OUTSIDE_PHYSICAL_WINDOW") ||
            (i > 0 &&
              t.global &&
              tokens[i - 1]?.global &&
              t.global.start < need(tokens[i - 1]?.global).start),
        )
      )
        reasons.push("NATIVE_TIMEBASE_INVALID");
      // Missing internal members retain no individual times; only real outer anchors are used.
    } else if (a?.mappingComplete) {
      const ss = a.symbols.filter(
        (s) => s.characterEnd > from && s.characterStart < cursor,
      );
      if (ss.some((s) => s.characterStart < from || s.characterEnd > cursor))
        reasons.push("ALIGNED_SYMBOL_CUT_AT_PARENT");
      start = ss[0]?.start;
      end = ss.at(-1)?.end;
    }
    if (start === undefined || end === undefined || end <= start) {
      reasons.push("MISSING_GROUP_BOUNDARY_MAPPING");
      continue;
    }
    const prev = units.at(-1);
    if (prev && !wordBoundaries.has(from)) {
      prev.text += p.originalText;
      prev.end = end;
      prev.characterEnd = cursor;
    } else
      units.push({
        text: p.originalText,
        start,
        end,
        characterStart: from,
        characterEnd: cursor,
      });
  }
  if (units.map((u) => u.text).join("") !== text)
    reasons.push("PARTIAL_SOURCE_MATERIALIZATION");
  if (units.some((u) => !contains(g.readEnvelope, u)))
    reasons.push("PHYSICAL_ENVELOPE_ESCAPE");
  if (units.some((u, i) => i > 0 && overlap(u, need(units[i - 1]))))
    reasons.push("SIMULTANEOUS_OR_CONFLICTING_BOUNDARIES");
  const candidateRange = units.length
    ? { start: need(units[0]).start, end: need(units.at(-1)).end }
    : g.seed;
  const sourceRange = {
    start: selected[0]?.bounds?.start ?? g.seed.start,
    end: selected.at(-1)?.bounds?.end ?? g.seed.end,
  };
  const old = g.stageCues.filter((b) =>
    g.initialEditableCueIds.includes(b.cue.id),
  );
  const includedNeighborReasons: string[] = [];
  for (const n of g.stageCues.filter((b) =>
    g.eligibleNeighborCueIds.includes(b.cue.id),
  )) {
    if (!overlap(n.cue, candidateRange)) continue;
    // Temporal collision alone cannot absorb unrelated words. Complete original parents
    // must cover this already eligible neighbor's original scope, not just new times.
    if (!contains(sourceRange, n.cue))
      reasons.push("ELIGIBLE_NEIGHBOR_SOURCE_SCOPE_UNCLOSED");
    else {
      old.push(n);
      includedNeighborReasons.push(
        n.cue.id + ":complete-selected-source-parent-scope",
      );
    }
  }
  const protectedNeighbors = g.stageCues.filter(
    (b) => !old.some((c) => c.cue.id === b.cue.id),
  );
  if (protectedNeighbors.some((n) => overlap(n.cue, candidateRange)))
    reasons.push("PROTECTED_NEIGHBOR_CONFLICT");
  if (
    old.length > 1 &&
    old.some(
      (n) =>
        (n.cue.style ?? "default") !== (old[0]?.cue.style ?? "default") ||
        n.cue.speaker !== old[0]?.cue.speaker,
    )
  )
    reasons.push("INCOMPATIBLE_STYLE_OR_SPEAKER");
  const template = old[0]?.cue;
  const newCues: SubtitleCue[] = template
    ? units.map((u, i) => ({
        id:
          "source-group-v1-" +
          objectHash({
            group: g.id,
            source: g.sourceObservationHash,
            mode,
            index: i,
            unit: u,
          }).slice(0, 24),
        start: u.start,
        end: u.end,
        text: u.text,
        language: template.language,
        languages: template.languages,
        speaker: template.speaker,
        confidence: null,
        ...(template.style ? { style: template.style } : {}),
      }))
    : [];
  const display = layoutSubtitleCuesWithDiagnostics(newCues, {
    segmentationMode: "presegmented",
    allowTemporalCueSplitting: false,
  });
  if (
    display.cues.some(
      (c) =>
        c.text.split("\n").length > 2 ||
        c.text.split("\n").some((l) => Array.from(l).length > 16),
    ) ||
    newCues.some((c) => c.end - c.start > 12)
  )
    reasons.push("PRESENTATION_CAPACITY_UNRESOLVED");
  if (lexical(display.cues.map((c) => c.text).join("")) !== lexical(text))
    reasons.push("LAYOUT_LEXICAL_LOSS");
  const timingEvidenceHash =
    mode === "native" ? objectHash(o) : objectHash(a ?? null);
  return groupPatchSchema.parse({
    version: "c601164-group-patch-v1",
    id: objectHash({ group: g, mode, timingEvidenceHash }),
    group: g,
    mode,
    action: reasons.length
      ? "ABSTAIN_KEEP_STAGE_INPUT"
      : "REPLACE_SOURCE_BOUND_UTTERANCE_GROUP",
    candidateRequestId: o.requestId,
    candidateCharacterSpan: g.candidateCharacterSpan,
    evidenceKind:
      mode === "native"
        ? "STORED_ASR_INTERVAL_ESTIMATE"
        : "ALIGNER_ESTIMATED_INTERVAL",
    timingEvidenceHash,
    oldCues: old,
    newCues,
    protectedNeighbors,
    includedNeighborReasons,
    reasons: [...new Set(reasons)],
    risks,
    normalizedTextChanged:
      lexical(old.map((b) => b.cue.text).join("")) !== lexical(text),
    timingChanged:
      objectHash(old.map((b) => [b.cue.start, b.cue.end])) !==
      objectHash(newCues.map((c) => [c.start, c.end])),
    lexicalTruthValidated: false,
  });
}

/** Validate the entire patch set against one immutable input. Any overlapping
 * transactions are both blocked; no partial replacement and no implicit merge.
 */
export function applySourceGroups(
  input: readonly SubtitleCue[],
  values: GroupPatch[],
  enabled: boolean,
) {
  const patches = values.map((p) => groupPatchSchema.parse(p));
  if (!enabled)
    return {
      cues: structuredClone([...input]),
      applied: [] as GroupPatch[],
      blocked: [] as string[],
    };
  const inputHash = objectHash(input),
    blocked: string[] = [];
  const already = patches.filter(
    (p) =>
      p.action === "REPLACE_SOURCE_BOUND_UTTERANCE_GROUP" &&
      p.newCues.length > 0 &&
      p.newCues.every((n) =>
        input.some((c) => objectHash(c) === objectHash(n)),
      ) &&
      p.oldCues.every((b) => !input.some((c) => c.id === b.cue.id)),
  );
  const pending = patches.filter(
    (p) =>
      p.action === "REPLACE_SOURCE_BOUND_UTTERANCE_GROUP" &&
      !already.includes(p),
  );
  for (const p of pending) {
    if (
      p.group.inputStageHash !== inputHash ||
      !p.oldCues.length ||
      !p.newCues.length ||
      p.reasons.length
    )
      throw Error("Stale or invalid group transaction");
    if (
      p.oldCues.some(
        (b) =>
          b.hash !== objectHash(b.cue) ||
          !input.some((c) => c.id === b.cue.id && objectHash(c) === b.hash),
      ) ||
      p.protectedNeighbors.some(
        (b) =>
          !input.some((c) => c.id === b.cue.id && objectHash(c) === b.hash),
      )
    )
      throw Error("Stale group member or protected neighbor");
    if (
      p.newCues.some(
        (c) =>
          !contains(p.group.readEnvelope, c) ||
          p.protectedNeighbors.some((n) => overlap(n.cue, c)),
      ) ||
      lexical(p.newCues.map((c) => c.text).join("")) === ""
    )
      throw Error("Invalid atomic group bounds");
    for (const q of pending)
      if (
        q !== p &&
        (p.oldCues.some((b) => q.oldCues.some((d) => d.cue.id === b.cue.id)) ||
          p.newCues.some((c) => q.newCues.some((d) => overlap(c, d))))
      )
        blocked.push(p.id);
  }
  const applied = pending.filter((p) => !blocked.includes(p.id));
  const removed = new Set(
    applied.flatMap((p) => p.oldCues.map((b) => b.cue.id)),
  );
  const cues = [
    ...input.filter((c) => !removed.has(c.id)),
    ...applied.flatMap((p) => p.newCues),
  ].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );
  if (new Set(cues.map((c) => c.id)).size !== cues.length)
    throw Error("Group identity collision");
  for (const c of input.filter((c) => !removed.has(c.id)))
    if (!cues.some((n) => objectHash(n) === objectHash(c)))
      throw Error("Untouched cue mutation");
  return { cues, applied, blocked: [...new Set(blocked)] };
}
