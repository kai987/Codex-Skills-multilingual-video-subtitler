import { describe, it, expect } from "vitest";
import { TextDecoder, TextEncoder } from "node:util";
import { objectHash } from "../packages/video-subtitler/src/machine-quality/experimental-profile.js";
import {
  fixturePrimary,
  observation,
  rawWindow,
  requireValue,
} from "./helpers/c601163-stored-fixture.js";
import {
  consumeStoredWhisper,
  buildStoredSpan,
  decideStoredSpan,
  applyStoredSpans,
  storedActionCapability,
  storedObservationSchema,
} from "../packages/video-subtitler/src/machine-quality/stored-token-span.js";
const { c } = fixturePrimary();
describe("complete stored token consumption", () => {
  it("preserves a CLI-merged UTF-8 record and rejects an incomplete byte sequence without replacement decoding", () => {
    const { full, input } = rawWindow(c);
    const bytes = new TextEncoder().encode(JSON.stringify(full));
    const decoded: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    expect(
      consumeStoredWhisper(decoded, input).parents[0]?.reconstructedText,
    ).toBe("そこで待って。");
    expect(() =>
      new TextDecoder("utf-8", { fatal: true }).decode(
        new Uint8Array([0xe3, 0x81]),
      ),
    ).toThrow();
    const p = requireValue(full.transcription[0]);
    requireValue(p.tokens[1]).text = "\uD83D";
    requireValue(p.tokens[2]).text = "\uDE00";
    p.text = "😀待って。";
    const o = consumeStoredWhisper(full, input);
    expect(o.parents[0]?.reconstructedText).toBe(p.text);
    expect(buildStoredSpan(o, c).qualified).toBe(false);
    // No bytes or IDs absent from the persisted record are invented.
  });
  it("rejects unanchored missing edge time and protected neighboring dialogue", () => {
    const { full, input } = rawWindow(c);
    Reflect.deleteProperty(
      requireValue(requireValue(full.transcription[0]).tokens[1]),
      "offsets",
    );
    expect(
      buildStoredSpan(consumeStoredWhisper(full, input), c).qualified,
    ).toBe(false);
    expect(
      buildStoredSpan(observation(c), {
        ...c,
        neighbors: [{ ...c.before, id: "protected-other" }],
      }).reasons,
    ).toContain("PROTECTED_NEIGHBOR_OVERLAPS_TARGET");
  });
  it("does not call a whitespace-only difference lexical recovery", () => {
    const before = { ...c.before, text: "そこ で待って。" };
    const same = { ...c, before, bindingHash: objectHash(before) };
    expect(
      decideStoredSpan(same, [observation(same), observation(same, "w2")])
        .action,
    ).toBe("KEEP_STAGE_INPUT");
  });
  it("rejects identical text observed at disjoint occurrences inside one target", () => {
    const a = rawWindow(c),
      b = rawWindow(c, "w2");
    for (const t of requireValue(b.full.transcription[0]).tokens.slice(1)) {
      t.offsets.from += 1800;
      t.offsets.to += 1800;
    }
    expect(
      decideStoredSpan(c, [
        consumeStoredWhisper(a.full, a.input),
        consumeStoredWhisper(b.full, b.input),
      ]).action,
    ).toBe("ABSTAIN_KEEP_STAGE_INPUT");
  });
  it("transports every raw record through the actual adapter, including zero time and original metadata", () => {
    const o = observation(c),
      s = buildStoredSpan(o, c);
    expect(o.rawRecordCount).toBe(5);
    expect(o.adapterParsedCount).toBe(5);
    expect(requireValue(requireValue(o.parents[0]).tokens[2]).timeStatus).toBe(
      "ZERO_DURATION",
    );
    expect(
      requireValue(requireValue(o.parents[0]).tokens[2]).original,
    ).toHaveProperty("t_dtw", -1);
    expect(s.rawText).toBe("そこで待って。");
    expect(s.qualified).toBe(true);
    expect(s.orderBracketedGroups).toHaveLength(1);
    expect(
      requireValue(s.orderBracketedGroups[0]).memberIntervalsInvented,
    ).toBe(false);
  });
  it("preserves missing interior timing without inventing member intervals", () => {
    const { full, input } = rawWindow(c);
    Reflect.deleteProperty(
      requireValue(requireValue(full.transcription[0]).tokens[2]),
      "offsets",
    );
    const o = consumeStoredWhisper(full, input),
      s = buildStoredSpan(o, c);
    expect(o.rawRecordCount).toBe(5);
    expect(o.adapterParsedCount).toBe(4);
    expect(s.qualified).toBe(true);
    expect(s.rawText).toBe("そこで待って。");
    expect(requireValue(requireValue(o.parents[0]).tokens[2]).global).toBe(
      null,
    );
  });
  it.each([
    "edge",
    "cross",
    "invalid",
    "nonmonotonic",
    "unicode",
    "mismatch",
    "vocab",
  ])("fails closed for %s while retaining original records", (failure) => {
    const { full, input } = rawWindow(c),
      p = requireValue(full.transcription[0]);
    if (failure === "edge")
      requireValue(p.tokens[1]).offsets.to = requireValue(
        p.tokens[1],
      ).offsets.from;
    if (failure === "cross") requireValue(p.tokens[1]).offsets.from = 0;
    if (failure === "invalid") requireValue(p.tokens[2]).offsets.to = -1;
    if (failure === "nonmonotonic")
      requireValue(p.tokens[3]).offsets.from = 100;
    if (failure === "unicode") requireValue(p.tokens[1]).text = "\uFFFD";
    if (failure === "mismatch") p.text += "失われた語";
    if (failure === "vocab") full.model.vocab = 999;
    const o = consumeStoredWhisper(full, input);
    expect(o.rawRecordCount).toBe(5);
    expect(buildStoredSpan(o, c).qualified).toBe(false);
  });
  it("does not discard literal lexical text solely because it looks like a control token", () => {
    const { full, input } = rawWindow(c);
    requireValue(requireValue(full.transcription[0]).tokens[1]).text =
      "[_literal]";
    requireValue(full.transcription[0]).text = "[_literal]で待って。";
    const o = consumeStoredWhisper(full, input);
    expect(requireValue(requireValue(o.parents[0]).tokens[1]).kind).toBe(
      "LEXICAL",
    );
    expect(buildStoredSpan(o, c).rawText).toContain("[_literal]");
  });
  it("keeps an unrelated outside-core parent mismatch local", () => {
    const { full, input } = rawWindow(c, "w2");
    full.transcription.push({
      text: "mismatch",
      offsets: { from: 0, to: 200 },
      tokens: [],
    });
    expect(
      buildStoredSpan(consumeStoredWhisper(full, input), c).qualified,
    ).toBe(true);
  });
  it("rejects disconnected lexical fragments and uncertain source binding", () => {
    const o = observation(c);
    requireValue(requireValue(o.parents[0]).tokens[2]).timeStatus = "INTERVAL";
    requireValue(requireValue(o.parents[0]).tokens[2]).global = {
      start: 100,
      end: 101,
    };
    expect(buildStoredSpan(o, c).qualified).toBe(false);
    expect(
      buildStoredSpan(observation(c), {
        ...c,
        occurrenceIds: [...c.occurrenceIds, "other"],
      }).qualified,
    ).toBe(false);
  });
  it("uses two independent windows, not two records from one audio or a normalized substring search", () => {
    const a = observation(c),
      b = observation(c, "w2");
    expect(decideStoredSpan(c, [a, b]).action).toBe(
      "REPLACE_BOUND_SOURCE_TEXT_SPAN",
    );
    expect(
      decideStoredSpan(c, [a, { ...b, audioHash: a.audioHash }]).action,
    ).toBe("ABSTAIN_KEEP_STAGE_INPUT");
    const raw = rawWindow(c, "w2");
    requireValue(requireValue(raw.full.transcription[0]).tokens[1]).text =
      "ここ";
    requireValue(raw.full.transcription[0]).text = "ここで待って。";
    expect(
      decideStoredSpan(c, [a, consumeStoredWhisper(raw.full, raw.input)])
        .action,
    ).toBe("ABSTAIN_KEEP_STAGE_INPUT");
  });
  it("selects narrower source text deterministically and cannot change time or consume stale bindings", () => {
    const d = decideStoredSpan(c, [observation(c, "w2"), observation(c)]);
    expect(d.chosenSpanId).toBe(
      requireValue(d.candidates.find((x) => x.windowId === "w1")).spanId,
    );
    expect(applyStoredSpans([c.before], [c.before], [d], false)).toEqual([
      c.before,
    ]);
    expect(applyStoredSpans([c.before], [c.before], [d], true)[0]).toEqual({
      ...c.before,
      text: "そこで待って。",
    });
    expect(() => applyStoredSpans([], [c.before], [d], true)).toThrow("Stale");
    expect(() =>
      applyStoredSpans(
        [c.before],
        [c.before],
        [{ ...d, after: { ...d.after, end: 999 } }],
        true,
      ),
    ).toThrow("Unsafe");
  });
  it("distinguishes capabilities from insufficient evidence, without requiring Reazon intervals", () => {
    expect(storedActionCapability([], false).status).toBe(
      "DECISION_PATH_NOT_IMPLEMENTED",
    );
    expect(storedActionCapability([]).status).toBe(
      "PROVIDER_CAPABILITY_UNSUPPORTED",
    );
    expect(decideStoredSpan(c, [observation(c)]).capability.status).toBe(
      "STRUCTURALLY_REACHABLE_OBSERVATION_INSUFFICIENT",
    );
    expect(
      decideStoredSpan(c, [observation(c), observation(c, "w2")]).capability
        .status,
    ).toBe("READY_FOR_EXPERIMENTAL_APPLICATION");
  });
  it("enforces strict envelope fields and lexicalTruth is never inferred", () => {
    expect(() =>
      storedObservationSchema.parse({ ...observation(c), gold: true }),
    ).toThrow();
    expect(
      decideStoredSpan(c, [observation(c), observation(c, "w2")]),
    ).toMatchObject({
      lexicalTruthValidated: false,
      audioConfirmed: false,
      humanValidated: false,
      listener: null,
      independentModelVoteCount: 0,
    });
  });
});
