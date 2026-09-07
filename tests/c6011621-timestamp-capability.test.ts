import { describe, it, expect } from "vitest";
import {
  ACOUSTIC_POLICY,
  localizeObservation,
  decideAcoustic,
  type AcousticCase,
  type AcousticObservation,
} from "../packages/video-subtitler/src/machine-quality/bounded-acoustic.js";
import {
  providerCapabilities,
  checkActionCapabilities,
  replayNormalization,
  auditPoints,
  auditWhisper,
  auditDecision,
} from "../packages/video-subtitler/src/machine-quality/timestamp-capability-audit.js";
const h = "a".repeat(64);
const before = {
  id: "neutral",
  text: "確認。",
  start: 5,
  end: 7,
  language: "ja" as const,
  languages: ["ja" as const],
  speaker: null,
  confidence: null,
};
const c: AcousticCase = {
  id: "neutral",
  bindingHash: h,
  before,
  sourceRequestIds: ["request"],
  occurrenceIds: ["neutral"],
  occurrences: [before],
  neighbors: [],
  legacyAfter: [],
  preservedAfter: [before],
  core: { start: 5, end: 7 },
  sourceSamples: { start: 240000, end: 336000, rate: 48000 },
  dedupLineage: [],
  selectionReason: "LEGACY_DESTRUCTIVE_SOURCE_PRESERVING_ABSTAIN",
};
const identity = {
  adapterHash: h,
  runtime: "fixture",
  model: "fixed",
  config: {},
};
const caps = () =>
  providerCapabilities({ whisper: identity, reazon: identity });
const obs = (
  family: "whisper" | "reazon",
  windowId: string,
): AcousticObservation => ({
  requestId: family + windowId,
  caseBindingHash: h,
  family,
  windowId,
  audioHash: (windowId === "w1" ? "a" : "b").repeat(64),
  window: { start: 3, end: 9 },
  status: "SUCCESS",
  text: "確認。",
  segments: [{ text: "確認。", start: 5.1, end: 6.9 }],
  points: [],
  timebase: "source-global-once",
  timingKind: "SEGMENT_INTERVALS",
  resultHash: h,
});
const actual = () =>
  ["w1", "w2"].flatMap((w) => [
    replayNormalization(obs("whisper", w), {
      text: "確認。",
      segments: [{ text: "確認。", start: 2.1, end: 3.9 }],
    }),
    replayNormalization(obs("reazon", w), {
      results: [
        {
          status: "SUCCESS",
          text: "確認。",
          tokenPoints: [
            { token: "確", paddedAudioSeconds: 3.1 },
            { token: "認", paddedAudioSeconds: 3.8 },
          ],
        },
      ],
    }),
  ]);
const geometry = {
  window: { start: 10, end: 14 },
  core: { start: 11, end: 13 },
  padding: 0.9,
  semantics: "VERIFIED" as const,
};
describe("shape-faithful zero-inference timestamp audit", () => {
  it("actual normalized intervals plus points cannot reach replacement", () => {
    expect(decideAcoustic(c, actual()).action).toBe("ABSTAIN_KEEP_STAGE_INPUT");
    expect(
      checkActionCapabilities(caps(), ACOUSTIC_POLICY, "ACTION_VALIDATION")
        .actions[0]?.status,
    ).toBe("UNREACHABLE_PROVIDER_CAPABILITY_MISMATCH");
  });
  it("legal monotonic core points still have complete=false", () => {
    const o = actual().find((o) => o.family === "reazon");
    if (!o) throw Error("Missing fixture");
    expect(localizeObservation(o, c.core)).toMatchObject({
      status: "PARTIAL_CORE",
      complete: false,
    });
  });
  it("four identical texts cannot replace evidence capability", () => {
    expect(new Set(actual().map((o) => o.text)).size).toBe(1);
    expect(auditDecision(c, actual()).conditions.allComparable).toBe(false);
  });
  it("synthetic Reazon intervals contradict actual adapter declaration", () => {
    expect(obs("reazon", "w1").timingKind).not.toBe(caps()[1]?.timingKind);
  });
  it("isolated-span failure is separate from capability", () => {
    const a = auditDecision({ ...c, occurrenceIds: ["a", "b"] }, actual());
    expect(a.conditions.isolated).toBe(false);
    expect(a.conditions.allComparable).toBe(false);
  });
  it("utterance structure is not implemented, not acoustic rejection", () => {
    expect(
      checkActionCapabilities(
        caps(),
        ACOUSTIC_POLICY,
        "OBSERVATION_ONLY",
      ).actions.at(-1)?.status,
    ).toBe("DECISION_PATH_NOT_IMPLEMENTED");
  });
  it("subtracts padding and adds source offset once", () => {
    const r = auditPoints([{ token: "a", paddedAudioSeconds: 2 }], geometry)
      .rows[0];
    if (!r) throw Error("Missing fixture");
    expect(r.raw).toBe(1.1);
    expect(r.global).toBe(11.1);
    expect(r.original).toBe(2);
  });
  it("classifies padding, core, context, contacts and true outside separately", () => {
    const r = auditPoints(
      [0.1, 1.1, 2.1, 4.1, 5.1, 5.9, 0.9, 1.9, 3.9, 4.9, 5.8].map((t) => ({
        token: "x",
        paddedAudioSeconds: t,
      })),
      geometry,
    );
    expect(r.rows.map((x) => x.region)).toEqual([
      "LEADING_PADDING",
      "PHYSICAL_CONTEXT_BEFORE_CORE",
      "PHYSICAL_CORE",
      "PHYSICAL_CONTEXT_AFTER_CORE",
      "TRAILING_PADDING",
      "OUTSIDE_DECODED_WAVEFORM",
      "BOUNDARY_CONTACT",
      "BOUNDARY_CONTACT",
      "BOUNDARY_CONTACT",
      "BOUNDARY_CONTACT",
      "BOUNDARY_CONTACT",
    ]);
  });
  it("never clamps, drops edge tokens or invents intervals", () => {
    const r = auditPoints(
      [
        { token: "a", paddedAudioSeconds: -1 },
        { token: "b", paddedAudioSeconds: 9 },
      ],
      geometry,
    );
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.raw).toBe(-1.9);
    expect(r.rows[1]?.global).toBe(18.1);
    expect(r.complete).toBe(false);
    expect(r.timingKind).toBe("TOKEN_POINTS");
  });
  it("retains internal fragments despite padding, without promoting completeness", () => {
    const r = auditPoints(
      [0.2, 2.1, 2.2, 5.1].map((t) => ({ token: "x", paddedAudioSeconds: t })),
      geometry,
    );
    expect(r.fragments).toEqual([{ indices: [1, 2], text: "xx" }]);
    expect(r.missingIndices).toEqual([0, 3]);
    expect(r.decisionEligible).toBe(false);
  });
  it("zip-only raw cardinality remains unverifiable", () => {
    expect(auditPoints([], geometry).cardinality).toBe(
      "RAW_CARDINALITY_UNVERIFIABLE",
    );
  });
  it("distinguishes requested missing tokens from returned unconsumed tokens", () => {
    expect(auditWhisper({}, 0, obs("whisper", "w1"), c.core).returned).toBe(0);
    const r = auditWhisper(
      {
        transcription: [
          {
            offsets: { from: 0, to: 6000 },
            tokens: [{ text: "x", offsets: { from: 2100, to: 2300 } }],
          },
        ],
      },
      1,
      obs("whisper", "w1"),
      c.core,
    );
    expect(r.returned).toBe(1);
    expect(r.parsed).toBe(1);
    expect(r.transportedToObservation).toBe(0);
    expect(r.consumedByLocalizer).toBe(0);
  });
  it("cross-core segments are geometric, not confirmed lexical contamination", () => {
    const o = {
      ...obs("whisper", "w1"),
      segments: [{ text: "x", start: 4, end: 8 }],
    };
    expect(auditWhisper({}, 0, o, c.core).legacy.status).toBe(
      "CONTEXT_CONTAMINATED",
    );
    expect(auditWhisper({}, 0, o, c.core).crossBoundaryMeaning).toContain(
      "NOT_CONFIRMED",
    );
  });
  it("shadow leaves observations and policy byte-identical", () => {
    const o = actual(),
      b = JSON.stringify({ o, c, p: ACOUSTIC_POLICY });
    auditDecision(c, o);
    auditPoints([], geometry);
    expect(JSON.stringify({ o, c, p: ACOUSTIC_POLICY })).toBe(b);
  });
  it("preflight stops action validation but allows explicitly observational study", () => {
    const a = checkActionCapabilities(
        caps(),
        ACOUSTIC_POLICY,
        "ACTION_VALIDATION",
      ),
      b = checkActionCapabilities(caps(), ACOUSTIC_POLICY, "OBSERVATION_ONLY");
    expect(a.actionValidationCompatible).toBe(false);
    expect(a.observationStudyPermitted).toBe(false);
    expect(b.observationStudyPermitted).toBe(true);
    expect(b.executeAuthorized).toBe(false);
    expect(a.stop).toBe("STOP_SAME_POLICY_REINFERENCE");
  });
  it("unknown policy is not given a fabricated compatibility proof", () => {
    expect(
      checkActionCapabilities(caps(), {}, "ACTION_VALIDATION").actions[0]
        ?.status,
    ).toBe("REACHABILITY_UNRESOLVED");
  });
  it("nonmonotonic/nonfinite or unverified semantics do not cherry-pick usable fragments", () => {
    expect(
      auditPoints(
        [
          { token: "x", paddedAudioSeconds: 2.2 },
          { token: "y", paddedAudioSeconds: 2.1 },
        ],
        geometry,
      ).fragments,
    ).toEqual([]);
    expect(
      auditPoints([{ token: "x", paddedAudioSeconds: NaN }], geometry).rows[0]
        ?.region,
    ).toBe("NONFINITE");
    expect(
      auditPoints([{ token: "x", paddedAudioSeconds: 2.2 }], {
        ...geometry,
        semantics: "UNVERIFIED",
      }).fragments,
    ).toEqual([]);
  });
  it("one interior segment complete=true only proves old geometry, not lexical coverage", () => {
    expect(
      localizeObservation(
        {
          ...obs("whisper", "w1"),
          segments: [{ text: "字", start: 5.1, end: 5.2 }],
        },
        c.core,
      ).complete,
    ).toBe(true);
    expect(auditDecision(c, actual()).completeMeaning).toContain("not proof");
  });
});
