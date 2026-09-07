import { describe, it, expect } from "vitest";
import {
  ACOUSTIC_POLICY,
  accountAttempt,
  caseWindows,
  deriveAcousticCases,
  decideAcoustic,
  localizeObservation,
  applyAcousticDecisions,
  exportDiff,
  type AcousticObservation,
  type AcousticCase,
} from "../packages/video-subtitler/src/machine-quality/bounded-acoustic.js";
import { objectHash } from "../packages/video-subtitler/src/machine-quality/experimental-profile.js";
import { replayPrimaryAssembly } from "../packages/video-subtitler/src/machine-quality/matched-replay.js";
import { formatSrt, parseSrt } from "@mvl/subtitle-core";
import type { SubtitleCue } from "@mvl/shared";
const h = "a".repeat(64);
const cue = (id: string, text: string, start = 5, end = 7): SubtitleCue => ({
  id,
  text,
  start,
  end,
  language: "ja",
  languages: ["ja"],
  speaker: null,
  confidence: null,
});
const before = cue("source", "行こう！行こう！");
const c: AcousticCase = {
  id: "synthetic",
  bindingHash: objectHash(before),
  before,
  sourceRequestIds: ["r"],
  occurrenceIds: ["source"],
  occurrences: [before],
  neighbors: [],
  legacyAfter: [cue("changed", "行こう！")],
  preservedAfter: [before],
  core: { start: 5, end: 7 },
  sourceSamples: { start: 240000, end: 336000, rate: 48000 },
  dedupLineage: [],
  selectionReason: "LEGACY_DESTRUCTIVE_SOURCE_PRESERVING_ABSTAIN",
};
const obs = (
  family: "whisper" | "reazon",
  windowId: string,
): AcousticObservation => ({
  requestId: family + windowId,
  caseBindingHash: c.bindingHash,
  family,
  windowId,
  audioHash: objectHash(windowId),
  window: { start: 3, end: 9 },
  status: "SUCCESS",
  text: "帰ります。",
  segments: [{ text: "帰ります。", start: 5.1, end: 6.9 }],
  points: [],
  timebase: "source-global-once",
  timingKind: "SEGMENT_INTERVALS",
  resultHash: h,
});
const four = () => [
  obs("whisper", "w1"),
  obs("whisper", "w2"),
  obs("reazon", "w1"),
  obs("reazon", "w2"),
];
describe("bounded acoustic evidence", () => {
  it("charges unsuccessful attempts and padding, and rejects hidden retries or over-budget work", () => {
    const ledger = Array.from({ length: 12 }, (_, i) => ({
      requestId: String(i),
      decodedSeconds: 30,
    }));
    expect(() =>
      accountAttempt(ledger, { requestId: "extra", decodedSeconds: 1 }),
    ).toThrow("budget");
    expect(() =>
      accountAttempt(ledger.slice(0, 1), {
        requestId: "0",
        decodedSeconds: 30,
      }),
    ).toThrow("Already attempted");
    expect(() =>
      accountAttempt([], { requestId: "oversize", decodedSeconds: 30.1 }),
    ).toThrow("budget");
    expect(
      accountAttempt([], { requestId: "failed-attempt", decodedSeconds: 8.8 }),
    ).toHaveLength(1);
  });
  it("constructs exact native-sample padded windows, deduplicates boundary-identical windows", () => {
    expect(caseWindows(c, 20).map((w) => [w.start, w.end])).toEqual([
      [4.5, 7.5],
      [3, 9],
    ]);
    expect(
      caseWindows(
        {
          ...c,
          core: { start: 0, end: 1 },
          sourceSamples: { start: 0, end: 48000, rate: 48000 },
        },
        1,
      ),
    ).toHaveLength(1);
  });
  it("never cuts a core to fit the budget", () => {
    expect(
      caseWindows(
        { ...c, sourceSamples: { start: 0, end: 31 * 48000, rate: 48000 } },
        60,
      )[0]?.status,
    ).toBe("WINDOW_BUDGET_UNSATISFIED");
  });
  it("failed/empty ASR never authorizes deletion", () => {
    for (const status of [
      "PROVIDER_ERROR",
      "EMPTY_OUTPUT",
      "MODEL_UNAVAILABLE",
    ] as const) {
      const d = decideAcoustic(
        c,
        four().map((o) => ({ ...o, status, text: "" })),
      );
      expect(d.action).toBe("ABSTAIN_KEEP_STAGE_INPUT");
      expect(d.after).toEqual(before);
    }
  });
  it("point times cannot masquerade as complete word intervals", () => {
    const o = {
      ...obs("reazon", "w1"),
      timingKind: "TOKEN_POINTS" as const,
      segments: [],
      points: [{ text: "帰", time: 5.4 }],
    };
    expect(localizeObservation(o, c.core)).toMatchObject({
      status: "PARTIAL_CORE",
      complete: false,
    });
    expect(decideAcoustic(c, [...four().slice(0, 2), o]).action).toBe(
      "ABSTAIN_KEEP_STAGE_INPUT",
    );
  });
  it("rejects context contamination and already shifted coordinates", () => {
    expect(
      localizeObservation(
        {
          ...obs("whisper", "w1"),
          segments: [{ text: "前後", start: 4, end: 8 }],
        },
        c.core,
      ).status,
    ).toBe("CONTEXT_CONTAMINATED");
    expect(
      localizeObservation(
        {
          ...obs("whisper", "w1"),
          segments: [{ text: "二重", start: 15, end: 17 }],
        },
        c.core,
      ).status,
    ).toBe("UNLOCALIZABLE");
  });
  it("same audio is not two stability observations", () => {
    expect(
      decideAcoustic(
        c,
        four().map((o) => ({ ...o, audioHash: h })),
      ).action,
    ).toBe("ABSTAIN_KEEP_STAGE_INPUT");
  });
  it("keeps even model agreement distinct from truth and same-event collapse", () => {
    const d = decideAcoustic(
      c,
      four().map((o) => ({
        ...o,
        text: before.text,
        segments: [{ text: before.text, start: 5.1, end: 6.9 }],
      })),
    );
    expect(d.action).toBe("KEEP_STAGE_INPUT");
    expect(d.audioConfirmed).toBe(false);
    expect(d.utteranceStructure).toBe("UNKNOWN");
  });
  it("ABSTRACT_FULL_INTERVAL_DECISION_UNIT_TEST: uses one complete source, not actual Reazon capability", () => {
    const d = decideAcoustic(c, four());
    expect(d.action).toBe("REPLACE_WITH_LOCALIZED_FRESH_CANDIDATE");
    expect(d.after.text).toBe("帰ります。");
    expect(d.after.start).toBe(5);
    expect(d.candidateSource).toBe("whisperw1");
    const conflicting = four();
    const segment = conflicting[3]?.segments[0];
    if (!segment) throw Error("Missing fixture");
    segment.text = "違います。";
    expect(decideAcoustic(c, conflicting).action).toBe(
      "ABSTAIN_KEEP_STAGE_INPUT",
    );
  });
  it("observe does not mutate; stale and duplicate attachments fail", () => {
    const d = decideAcoustic(c, four());
    expect(applyAcousticDecisions([before], [before], [d], false)).toEqual([
      before,
    ]);
    expect(() =>
      applyAcousticDecisions([cue("other", "他")], [before], [d], true),
    ).toThrow("Stale");
    expect(() =>
      applyAcousticDecisions([before], [before], [d, d], true),
    ).toThrow("Duplicate");
  });
  it("counts true serialized export changes, not repeated stage arrays", () => {
    const a = parseSrt(formatSrt([cue("one", "前"), cue("two", "後", 8, 9)]));
    const b = parseSrt(
      formatSrt([
        cue("one", "変更"),
        cue("two", "後", 8, 9),
        cue("three", "追加", 10, 11),
      ]),
    );
    const bind = (cs: ReturnType<typeof parseSrt>) =>
      cs.map((c) => cue(String(c.sourceId), c.text, c.start, c.end));
    expect(exportDiff(bind(a), bind(b))).toEqual({
      exportAddedCueCount: 1,
      exportRemovedCueCount: 0,
      exportChangedGroups: 1,
    });
  });
  it("derives only destructive/abstaining cases and carries adjacent dedup lineage", () => {
    const evidence = {
      version: "c601161-primary-evidence-v1",
      partition: "development-known",
      promptStatus: "HISTORICAL_TITLE_PROMPTED_EVIDENCE",
      source: {
        sha256: h,
        durationSeconds: 30,
        audioStream: 1,
        sourceSampleRate: 48000,
        mediaStart: 0,
        fileName: "neutral.mkv",
      },
      primaryRequests: [
        {
          id: "request",
          cacheKey: h,
          cacheFileHash: h,
          audioHash: h,
          resultHash: h,
          modelHash: h,
          model: "fixed",
          runtime: null,
          tokenizer: null,
          promptHash: h,
          decodeHash: h,
          sampleRate: 16000,
          interval: { start: 0, end: 30 },
          timebase: "original-audio-local",
          vadEnabled: false,
          segments: [
            {
              id: "a",
              start: 5,
              end: 7,
              text: "こちらへ来て！ こちらへ来て！",
            },
            {
              id: "b",
              start: 7,
              end: 9,
              text: "こちらへ来て！ こちらへ来て！",
            },
          ],
        },
      ],
    };
    const l = replayPrimaryAssembly(evidence, false),
      p = replayPrimaryAssembly(evidence, true);
    const derived = deriveAcousticCases(l.trace, p.trace, 48000);
    expect(derived).toHaveLength(1);
    expect(derived[0]?.occurrenceIds).toEqual(["a", "b"]);
    expect(derived[0]?.core.end).toBe(9);
    expect(ACOUSTIC_POLICY.maximumAttempts).toBe(12);
  });
});
