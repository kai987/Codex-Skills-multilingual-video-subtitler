import { z } from "zod";
function requireValue<T>(v: T | null | undefined): T {
  if (v === null || v === undefined)
    throw Error("Missing stored source binding");
  return v;
}
import { parseWhisperFullJson } from "@mvl/transcription-core";
import type { SubtitleCue } from "@mvl/shared";
import {
  acousticCaseSchema,
  lexical,
  type AcousticCase,
  type AcousticObservation,
} from "./bounded-acoustic.js";
import { objectHash } from "./experimental-profile.js";
export const STORED_TOKEN_POLICY = {
  version: "stored-token-span-local-recovery-v1",
  normalization:
    "NFKC; remove Unicode punctuation/separators/whitespace; lowercase",
  span: "single request continuous lexical records; no boundary clipping or string search",
  binding:
    "isolated full stage input only; exact object hash and occurrence identity",
  support:
    "two independently localized Whisper windows with distinct audio hashes; same normalized text",
  selection: "narrowest qualified window then request ID then span ID",
  zeroTime:
    "internal order-bracketed groups only; no invented member intervals",
  reazon:
    "points are optional window-level diagnostics; not complete intervals or votes",
  lexicalTruthValidated: false,
  timingMutation: false,
  inferenceAuthorized: false,
  defaultPromotionAuthorized: false,
} as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const bounds = z.object({ start: z.number(), end: z.number() }).strict();
const parsedToken = z
  .object({
    text: z.string(),
    start: z.number(),
    end: z.number(),
    probability: z.number().nullable(),
  })
  .strict();
const tokenSchema = z
  .object({
    segmentIndex: z.number().int(),
    tokenIndex: z.number().int(),
    sequenceIndex: z.number().int(),
    original: z.unknown(),
    originalText: z.string(),
    tokenId: z.number().int().nullable(),
    characterStart: z.number().int(),
    characterEnd: z.number().int(),
    parsed: parsedToken.nullable(),
    global: bounds.nullable(),
    kind: z.enum(["LEXICAL", "CONTROL", "UNVERIFIED_CONTROL"]),
    timeStatus: z.enum(["INTERVAL", "ZERO_DURATION", "MISSING", "INVALID"]),
    flags: z.array(z.string()),
  })
  .strict();
const parentSchema = z
  .object({
    segmentIndex: z.number().int(),
    original: z.unknown(),
    originalText: z.string(),
    reconstructedText: z.string(),
    sourceTextComplete: z.boolean(),
    bounds: bounds.nullable(),
    tokens: z.array(tokenSchema),
  })
  .strict();
export const storedObservationSchema = z
  .object({
    version: z.literal("c601163-stored-observation-v1"),
    requestId: z.string(),
    caseBindingHash: digest,
    windowId: z.string(),
    audioHash: digest,
    window: bounds,
    rawFileHash: digest,
    rawResultHash: digest,
    rawResponse: z.unknown(),
    sourceRequestIds: z.array(z.string()),
    occurrenceIds: z.array(z.string()),
    vocabularyVerified: z.boolean(),
    adapterParser: z.literal("parseWhisperFullJson"),
    serializedRecordSemantics: z.literal(
      "CLI_MAY_MERGE_UTF8_TOKEN_BYTES_FIRST_ID_RETAINED",
    ),
    rawRecordCount: z.number().int(),
    adapterParsedCount: z.number().int(),
    parents: z.array(parentSchema),
  })
  .strict();
export type StoredObservation = z.infer<typeof storedObservationSchema>;
type Token = z.infer<typeof tokenSchema>;
const record = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const validUnicode = (s: string) =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\uFFFD/u.test(
    s,
  );
const offsets = (v: unknown) => {
  const r = record(v),
    a = number(r.from),
    b = number(r.to);
  return a === null || b === null ? null : { start: a / 1000, end: b / 1000 };
};
/** Fixed verified large-v3 multilingual vocabulary contract, not a prefix heuristic.
 * whisper.cpp v1.9.1 vocab=51866: EOT=50257, SOT=50258, BEG=50365.
 * CLI full JSON merges incomplete UTF-8 byte pieces before emitting a record.
 */
function kind(
  id: number | null,
  text: string,
  verified: boolean,
): Token["kind"] {
  if (!verified || id === null || id < 0 || id >= 51866)
    return "UNVERIFIED_CONTROL";
  if (id < 50257) return "LEXICAL";
  const known: Record<number, string> = {
    50257: "[_EOT_]",
    50258: "[_SOT_]",
    50359: "[_TRANSLATE_]",
    50360: "[_TRANSCRIBE_]",
    50361: "[_SOLM_]",
    50362: "[_PREV_]",
    50363: "[_NOSP_]",
    50364: "[_NOT_]",
    50365: "[_BEG_]",
  };
  const expected = id > 50365 ? `[_TT_${id - 50365}]` : known[id];
  return expected === text ? "CONTROL" : "UNVERIFIED_CONTROL";
}
export function consumeStoredWhisper(
  full: unknown,
  input: {
    requestId: string;
    caseBindingHash: string;
    windowId: string;
    audioHash: string;
    window: {
      start: number;
      end: number;
    };
    rawFileHash: string;
    sourceRequestIds: string[];
    occurrenceIds: string[];
  },
): StoredObservation {
  const root = record(full),
    model = record(root.model);
  const vocabularyVerified =
    model.vocab === 51866 && model.multilingual === true;
  const actual = parseWhisperFullJson(full);
  let sequenceIndex = 0;
  const parents = array(root.transcription).map((value, segmentIndex) => {
    const parent = record(value),
      parentBounds = offsets(parent.offsets);
    let character = 0;
    const tokens = array(parent.tokens).map((original, tokenIndex): Token => {
      const raw = record(original),
        text = str(raw.text),
        id = number(raw.id);
      // Call the actual adapter parser for each original record as well: invalid
      // records are retained in our envelope even when the legacy parser drops them.
      const parsed =
        parseWhisperFullJson({ transcription: [{ tokens: [original] }] })
          .tokensBySegment[0]?.[0] ?? null;
      const rawOffsets = offsets(raw.offsets ?? record(raw.timestamps).offsets);
      const tokenKind = kind(id, text, vocabularyVerified);
      const from = character;
      if (tokenKind !== "CONTROL") character += Array.from(text).length;
      const flags: string[] = [];
      if (!validUnicode(text)) flags.push("INVALID_UNICODE");
      if (typeof raw.text !== "string") flags.push("MISSING_TEXT");
      if (tokenKind === "UNVERIFIED_CONTROL")
        flags.push("UNVERIFIED_TOKEN_VOCABULARY");
      if (
        parsed &&
        (parsed.end > input.window.end - input.window.start + 1e-9 ||
          parsed.start < 0)
      )
        flags.push("OUTSIDE_PHYSICAL_WINDOW");
      if (
        parsed &&
        parentBounds &&
        (parsed.start < parentBounds.start || parsed.end > parentBounds.end)
      )
        flags.push("OUTSIDE_PARENT");
      return {
        segmentIndex,
        tokenIndex,
        sequenceIndex: sequenceIndex++,
        original,
        originalText: text,
        tokenId: id,
        characterStart: from,
        characterEnd: character,
        parsed,
        global: parsed
          ? {
              start: parsed.start + input.window.start,
              end: parsed.end + input.window.start,
            }
          : null,
        kind: tokenKind,
        timeStatus: parsed
          ? parsed.start === parsed.end
            ? "ZERO_DURATION"
            : "INTERVAL"
          : rawOffsets ||
              raw.offsets !== undefined ||
              record(raw.timestamps).offsets !== undefined
            ? "INVALID"
            : "MISSING",
        flags,
      };
    });
    const reconstructedText = tokens
      .filter((t) => t.kind !== "CONTROL")
      .map((t) => t.originalText)
      .join("");
    return {
      segmentIndex,
      original: value,
      originalText: str(parent.text),
      reconstructedText,
      sourceTextComplete:
        typeof parent.text === "string" &&
        reconstructedText === parent.text &&
        tokens.every(
          (t) =>
            t.kind !== "UNVERIFIED_CONTROL" &&
            !t.flags.includes("INVALID_UNICODE") &&
            !t.flags.includes("MISSING_TEXT"),
        ),
      bounds: parentBounds
        ? {
            start: parentBounds.start + input.window.start,
            end: parentBounds.end + input.window.start,
          }
        : null,
      tokens,
    };
  });
  const parsed = parents.flatMap((p) =>
    p.tokens.flatMap((t) => (t.parsed ? [t.parsed] : [])),
  );
  if (objectHash(parsed) !== objectHash(actual.tokensBySegment.flat()))
    throw Error("Adapter parser mapping mismatch");
  return storedObservationSchema.parse({
    version: "c601163-stored-observation-v1",
    ...input,
    rawResultHash: objectHash(full),
    rawResponse: full,
    vocabularyVerified,
    adapterParser: "parseWhisperFullJson",
    serializedRecordSemantics:
      "CLI_MAY_MERGE_UTF8_TOKEN_BYTES_FIRST_ID_RETAINED",
    rawRecordCount: sequenceIndex,
    adapterParsedCount: parsed.length,
    parents,
  });
}
export interface StoredCandidate {
  spanId: string;
  requestId: string;
  windowId: string;
  audioHash: string;
  bindingHash: string;
  window: {
    start: number;
    end: number;
  };
  rawText: string;
  normalizedText: string;
  tokenCoordinates: number[][];
  sourceInterval: {
    start: number;
    end: number;
  } | null;
  characterSpans: {
    segmentIndex: number;
    start: number;
    end: number;
  }[];
  orderBracketedGroups: {
    memberIndices: number[];
    anchorIndices: number[];
    envelope: {
      start: number;
      end: number;
    };
    memberIntervalsInvented: false;
  }[];
  sourceTextComplete: boolean;
  boundarySeparable: boolean;
  timebaseValid: boolean;
  sourceSpanBindingUnique: boolean;
  crossWindowSupport: boolean;
  lexicalTruthValidated: false;
  qualified: boolean;
  consumedRecords: number;
  reasons: string[];
}
/** Independently builds one maximal continuous source span per window. No target
 * text, counterpart text, or Gold is searched to manufacture agreement. */
export function buildStoredSpan(
  o: StoredObservation,
  c: AcousticCase,
): StoredCandidate {
  storedObservationSchema.parse(o);
  const reasons = new Set<string>();
  const touches = (b: { start: number; end: number }) =>
    b.end > c.core.start && b.start < c.core.end;
  const relevant = o.parents.filter((p) => !p.bounds || touches(p.bounds));
  const sourceTextComplete =
    relevant.length > 0 && relevant.every((p) => p.sourceTextComplete);
  if (!sourceTextComplete)
    reasons.add("PARENT_TOKEN_TEXT_MISMATCH_OR_UNVERIFIED");
  const selected: Token[] = [],
    groups: StoredCandidate["orderBracketedGroups"] = [];
  let boundarySeparable = true,
    timebaseValid = true;
  for (const parent of relevant) {
    const ts = parent.tokens.filter((t) => t.kind !== "CONTROL");
    // Unknown parent location cannot be safely excluded, but unrelated located
    // mismatches never invalidate the entire request.
    if (!parent.bounds) {
      reasons.add("PARENT_TIME_UNKNOWN");
      timebaseValid = false;
    }
    let previousEnd = -Infinity;
    const envelopes = ts.map((t, i) => {
      if (t.timeStatus === "INTERVAL" && t.global) {
        if (t.global.start < previousEnd - 1e-9) {
          timebaseValid = false;
          reasons.add("LEXICAL_TIME_NONMONOTONIC");
        }
        previousEnd = t.global.end;
        return t.global;
      }
      if (t.timeStatus === "INVALID" || t.flags.length) {
        timebaseValid = false;
        reasons.add("INVALID_MEMBER_TIME_OR_TEXT");
      }
      const left = ts
        .slice(0, i)
        .findLast((x) => x.timeStatus === "INTERVAL" && !x.flags.length);
      const right = ts
        .slice(i + 1)
        .find((x) => x.timeStatus === "INTERVAL" && !x.flags.length);
      if (
        !left?.global ||
        !right?.global ||
        left.global.end > right.global.start
      ) {
        boundarySeparable = false;
        reasons.add("UNBRACKETED_LEXICAL_EDGE");
        return null;
      }
      const envelope = { start: left.global.start, end: right.global.end };
      groups.push({
        memberIndices: [t.sequenceIndex],
        anchorIndices: [left.sequenceIndex, right.sequenceIndex],
        envelope,
        memberIntervalsInvented: false,
      });
      return envelope;
    });
    ts.forEach((t, i) => {
      const b = envelopes[i];
      if (!b || touches(b)) {
        selected.push(t);
        if (t.flags.length) {
          timebaseValid = false;
          reasons.add("INVALID_MEMBER_TIME_OR_TEXT");
        }
        if (!b || b.start < c.core.start - 1e-9 || b.end > c.core.end + 1e-9) {
          boundarySeparable = false;
          reasons.add("TOKEN_OR_ORDER_GROUP_CROSSES_CORE");
        }
      }
    });
  }
  // Never concatenate disconnected selected fragments around an excluded token.
  const lexicalSequence = o.parents.flatMap((p) =>
    p.tokens.filter((t) => t.kind !== "CONTROL"),
  );
  const indices = selected.map((t) => lexicalSequence.indexOf(t));
  const timed = selected.filter((t) => t.timeStatus === "INTERVAL" && t.global);
  if (
    timed.some(
      (t, i) =>
        i > 0 &&
        requireValue(t.global).start <
          requireValue(requireValue(timed[i - 1]).global).end - 1e-9,
    )
  ) {
    timebaseValid = false;
    reasons.add("CROSS_PARENT_TIME_NONMONOTONIC");
  }
  if (indices.some((n, i) => i > 0 && n !== (indices[i - 1] ?? n) + 1)) {
    boundarySeparable = false;
    reasons.add("DISCONNECTED_SOURCE_SPAN");
  }
  const neighborConflict = c.neighbors.some(
    (n) => !c.occurrenceIds.includes(n.id) && touches(n),
  );
  if (neighborConflict) reasons.add("PROTECTED_NEIGHBOR_OVERLAPS_TARGET");
  const unique =
    !neighborConflict &&
    c.bindingHash === o.caseBindingHash &&
    objectHash(c.before) === c.bindingHash &&
    c.occurrenceIds.length === 1 &&
    c.core.start === c.before.start &&
    c.core.end === c.before.end &&
    objectHash(c.sourceRequestIds) === objectHash(o.sourceRequestIds) &&
    objectHash(c.occurrenceIds) === objectHash(o.occurrenceIds);
  if (!unique) reasons.add("ISOLATED_STAGE_SOURCE_BINDING_REQUIRED");
  const rawText = selected.map((t) => t.originalText).join("");
  if (!lexical(rawText)) reasons.add("EMPTY_LEXICAL_SPAN");
  const tokenCoordinates = selected.map((t) => [t.segmentIndex, t.tokenIndex]);
  return {
    spanId: objectHash({
      requestId: o.requestId,
      rawResultHash: o.rawResultHash,
      tokenCoordinates,
    }),
    requestId: o.requestId,
    windowId: o.windowId,
    audioHash: o.audioHash,
    bindingHash: c.bindingHash,
    window: o.window,
    rawText,
    normalizedText: lexical(rawText),
    tokenCoordinates,
    sourceInterval: timed.length
      ? {
          start: requireValue(requireValue(timed[0]).global).start,
          end: requireValue(requireValue(timed.at(-1)).global).end,
        }
      : null,
    characterSpans: relevant.flatMap((p) => {
      const rows = selected.filter((t) => t.segmentIndex === p.segmentIndex);
      return rows.length
        ? [
            {
              segmentIndex: p.segmentIndex,
              start: requireValue(rows[0]).characterStart,
              end: requireValue(rows.at(-1)).characterEnd,
            },
          ]
        : [];
    }),
    orderBracketedGroups: groups,
    sourceTextComplete,
    boundarySeparable,
    timebaseValid,
    sourceSpanBindingUnique: unique,
    crossWindowSupport: false,
    lexicalTruthValidated: false,
    qualified:
      sourceTextComplete &&
      boundarySeparable &&
      timebaseValid &&
      unique &&
      !!lexical(rawText),
    consumedRecords: relevant.reduce((n, p) => n + p.tokens.length, 0),
    reasons: [...reasons].sort(),
  };
}
export function storedActionCapability(
  observations: StoredObservation[],
  implemented = true,
) {
  const status = !implemented
    ? "DECISION_PATH_NOT_IMPLEMENTED"
    : !observations.some(
          (o) => o.vocabularyVerified && o.adapterParsedCount > 0,
        )
      ? "PROVIDER_CAPABILITY_UNSUPPORTED"
      : "STRUCTURALLY_REACHABLE_EVIDENCE_PENDING";
  return {
    strategy: STORED_TOKEN_POLICY.version,
    status,
    reazonIntervalsRequired: false,
    lexicalTruthValidated: false,
    inferenceAuthorized: false,
  };
}
export function decideStoredSpan(
  c: AcousticCase,
  observations: StoredObservation[],
  side: AcousticObservation[] = [],
) {
  const relevant = observations.filter(
    (o) => o.caseBindingHash === c.bindingHash,
  );
  const capability = storedActionCapability(relevant);
  const candidates = relevant.map((o) => buildStoredSpan(o, c));
  const good = candidates.filter((s) => s.qualified);
  const ranges = good.flatMap((s) =>
    s.sourceInterval ? [s.sourceInterval] : [],
  );
  const crossWindowSupport =
    good.length === 2 &&
    ranges.length === 2 &&
    Math.max(...ranges.map((r) => r.start)) <
      Math.min(...ranges.map((r) => r.end)) &&
    new Set(good.map((s) => s.windowId)).size === 2 &&
    new Set(good.map((s) => s.audioHash)).size === 2 &&
    new Set(good.map((s) => s.normalizedText)).size === 1;
  for (const s of candidates)
    s.crossWindowSupport = crossWindowSupport && s.qualified;
  const chosen = crossWindowSupport
    ? good.sort(
        (a, b) =>
          a.window.end - a.window.start - (b.window.end - b.window.start) ||
          a.requestId.localeCompare(b.requestId, "en") ||
          a.spanId.localeCompare(b.spanId, "en"),
      )[0]
    : undefined;
  const action = !chosen
    ? "ABSTAIN_KEEP_STAGE_INPUT"
    : chosen.normalizedText === lexical(c.before.text)
      ? "KEEP_STAGE_INPUT"
      : "REPLACE_BOUND_SOURCE_TEXT_SPAN";
  return {
    caseId: c.id,
    bindingHash: c.bindingHash,
    before: c.before,
    after: {
      ...c.before,
      text:
        action === "REPLACE_BOUND_SOURCE_TEXT_SPAN"
          ? requireValue(chosen).rawText
          : c.before.text,
    },
    action,
    candidates,
    chosenSpanId: chosen?.spanId ?? null,
    capability: {
      ...capability,
      status:
        capability.status === "STRUCTURALLY_REACHABLE_EVIDENCE_PENDING"
          ? chosen
            ? "READY_FOR_EXPERIMENTAL_APPLICATION"
            : "STRUCTURALLY_REACHABLE_OBSERVATION_INSUFFICIENT"
          : capability.status,
    },
    sideEvidence: side
      .filter(
        (s) => s.family === "reazon" && s.caseBindingHash === c.bindingHash,
      )
      .map((s) => ({
        requestId: s.requestId,
        state:
          s.status === "SUCCESS"
            ? "WINDOW_LEVEL_DIAGNOSTIC"
            : "NOT_APPLICABLE_SIDE_EVIDENCE",
        timingKind: s.timingKind,
        resultHash: s.resultHash,
        completeInterval: false,
        sideEvidenceVetoed: false,
      })),
    supportClass: chosen ? "SINGLE_FAMILY_WINDOW_SUPPORTED" : "INSUFFICIENT",
    independentModelVoteCount: 0,
    lexicalTruthValidated: false,
    audioConfirmed: false,
    humanValidated: false,
    listener: null,
    reason: chosen
      ? "SAME_MODEL_TWO_WINDOW_SOURCE_BOUND_STABILITY_NOT_LEXICAL_TRUTH"
      : "INSUFFICIENT_SOURCE_BOUND_SPAN_EVIDENCE",
  };
}
export type StoredDecision = ReturnType<typeof decideStoredSpan>;
export const storedBundleSchema = z
  .object({
    version: z.literal("c601163-token-span-evidence-v1"),
    strategy: z.literal("stored-token-span-local-recovery-v1"),
    primaryHash: digest,
    oldEvidenceHash: digest,
    policyHash: digest,
    cases: z.array(acousticCaseSchema),
    observations: z.array(storedObservationSchema),
  })
  .strict();
export function applyStoredSpans(
  inputs: readonly SubtitleCue[],
  preserved: SubtitleCue[],
  decisions: StoredDecision[],
  apply: boolean,
) {
  if (new Set(decisions.map((d) => d.bindingHash)).size !== decisions.length)
    throw Error("Duplicate stored span binding");
  for (const d of decisions)
    if (
      !inputs.some((c) => objectHash(c) === d.bindingHash) ||
      objectHash(d.before) !== d.bindingHash
    )
      throw Error("Stale stored span binding");
  return preserved.map((c) => {
    const d = decisions.find((d) => d.before.id === c.id);
    if (!d || !apply || d.action !== "REPLACE_BOUND_SOURCE_TEXT_SPAN") return c;
    const candidate = d.candidates.find((s) => s.spanId === d.chosenSpanId);
    if (
      objectHash(c) !== d.bindingHash ||
      !candidate?.qualified ||
      !candidate.crossWindowSupport ||
      d.after.text !== candidate.rawText ||
      d.after.start !== c.start ||
      d.after.end !== c.end ||
      !d.after.text.trim()
    )
      throw Error("Unsafe stored text application");
    return { ...c, text: d.after.text };
  });
}
