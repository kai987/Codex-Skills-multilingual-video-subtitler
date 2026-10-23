import { describe, it, expect } from "vitest";
import {
  freshMatchedEvidenceSchema,
  replayPrimaryAssembly,
} from "../../packages/video-subtitler/src/machine-quality/matched-replay.js";
import { primaryMinimal } from "../../packages/video-subtitler/src/machine-quality/experimental-profile.js";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "@mvl/subtitle-core";
const hash = "a".repeat(64);
function evidence(overlap = false) {
  return freshMatchedEvidenceSchema.parse({
    version: "c60117-fresh-primary-v1",
    partition: "development-known",
    promptStatus: "FRESH_PROMPT_FREE",
    source: {
      sha256: hash,
      durationSeconds: 100,
      audioStream: 1,
      sourceSampleRate: 48000,
      mediaStart: 0,
      fileName: "neutral",
    },
    primaryRequests: [
      {
        id: "req",
        cacheKey: hash,
        cacheFileHash: hash,
        audioHash: hash,
        resultHash: hash,
        modelHash: hash,
        model: "fixture-no-model",
        runtime: "synthetic",
        tokenizer: "synthetic",
        promptHash: hash,
        decodeHash: hash,
        sampleRate: 16000,
        interval: { start: 30, end: 55 },
        timebase: "original-audio-local",
        vadEnabled: false,
        segments: [
          { id: "first", start: 2, end: 3, text: "そうです" },
          {
            id: "second",
            start: overlap ? 2.1 : 3.4,
            end: overlap ? 3.1 : 4.4,
            text: "そうです",
          },
        ],
      },
    ],
  });
}
describe("C60117 real fresh matched chain", () => {
  it("retains empty model output as an empty clip instead of synthesizing text", () => {
    const e = evidence();
    const request = e.primaryRequests[0];
    if (!request) throw Error("fixture missing");
    request.segments = [];
    expect(replayPrimaryAssembly(e, false).cues).toEqual([]);
  });
  it("fails closed on a source-global interval mismatch", () => {
    const e = evidence();
    const request = e.primaryRequests[0];
    if (!request) throw Error("fixture missing");
    request.interval = { start: 99, end: 124 };
    expect(() => replayPrimaryAssembly(e, false)).toThrow();
  });
  it("retains nonoverlapping occurrences through actual exports, off is P1", () => {
    const e = evidence(),
      before = replayPrimaryAssembly(e, false),
      on = replayPrimaryAssembly(
        e,
        false,
        {},
        undefined,
        undefined,
        undefined,
        { deduplication: "overlap-required" },
      ),
      off = replayPrimaryAssembly(
        e,
        false,
        {},
        undefined,
        undefined,
        undefined,
        { deduplication: "legacy" },
      );
    expect(off.cues).toEqual(before.cues);
    expect(before.trace[1]?.outputCueCount).toBe(1);
    expect(on.trace[1]?.outputCueCount).toBe(2);
    expect(primaryMinimal(e)[0]?.start).toBe(32);
    for (const [formatter, parser] of [
      [formatAss, parseAss],
      [formatSrt, parseSrt],
      [formatVtt, parseVtt],
    ] as const) {
      const back = parser(formatter(on.cues));
      expect(back.map((c) => c.text.replace(/\s/gu, "")).join("")).toBe(
        "そうですそうです",
      );
    }
  });
  it("does not disable genuine overlapping duplicate handling", () => {
    const on = replayPrimaryAssembly(
      evidence(true),
      false,
      {},
      undefined,
      undefined,
      undefined,
      { deduplication: "overlap-required" },
    );
    expect(on.trace[1]?.outputCueCount).toBe(1);
  });
  it("does not enable the second intra-cue repair family", () => {
    const e = evidence();
    e.primaryRequests[0]?.segments.splice(0, 2, {
      id: "one",
      start: 1,
      end: 5,
      text: "こんにちはこんにちは",
    });
    const a = replayPrimaryAssembly(e, false),
      b = replayPrimaryAssembly(e, false, {}, undefined, undefined, undefined, {
        deduplication: "overlap-required",
      });
    expect(a.cues).toEqual(b.cues);
  });
  it("rejects extra Gold/old-final fields and wrong prompt semantics", () => {
    expect(
      freshMatchedEvidenceSchema.safeParse({ ...evidence(), gold: "answer" })
        .success,
    ).toBe(false);
    expect(
      freshMatchedEvidenceSchema.safeParse({
        ...evidence(),
        promptStatus: "HISTORICAL_TITLE_PROMPTED_EVIDENCE",
      }).success,
    ).toBe(false);
    expect(() =>
      replayPrimaryAssembly(
        {
          ...evidence(),
          version: "c601161-primary-evidence-v1",
          promptStatus: "HISTORICAL_TITLE_PROMPTED_EVIDENCE",
        },
        false,
        {},
        undefined,
        undefined,
        undefined,
        { deduplication: "overlap-required" },
      ),
    ).toThrow();
  });
  it("rejects conflicting duplicate request IDs", () => {
    const e = evidence();
    const copy = structuredClone(e.primaryRequests[0]);
    if (!copy) throw Error("fixture missing");
    copy.resultHash = "b".repeat(64);
    e.primaryRequests.push(copy);
    expect(() => primaryMinimal(e)).toThrow();
  });
});
