import { describe, it, expect } from "vitest";
import {
  planChunks,
  validateChunks,
  silenceFromScores,
  mapRaw,
  boundaryDedup,
  serializeRecords,
  reserveAttempt,
  type Chunk,
} from "../packages/video-subtitler/src/standalone/bounded.js";
const full = (end = 60): Chunk => ({
  id: "chunk-0001",
  index: 0,
  coreStart: 0,
  coreEnd: end * 1000,
  inputStart: 0,
  inputEnd: end * 1000,
  boundary: "tail",
  candidateSamples: [],
});
const srt = (start: string, end: string, value = "neutral test text") =>
  `1\n00:00:${start} --> 00:00:${end}\n${value}\n\n`;
describe("bounded full-audio planning", () => {
  it.each([8000, 16000, 44100, 48000])(
    "complete integer sample coverage at %i Hz",
    (rate) => {
      for (const seconds of [0.01, 20, 25, 29.4, 30, 50, 59.4, 900.0106875]) {
        const frames = Math.floor(seconds * rate),
          chunks = planChunks(frames, rate, []);
        expect(validateChunks(chunks, frames, rate).coreCoverageSamples).toBe(
          frames,
        );
        expect(
          chunks.every((c) => c.inputEnd - c.inputStart <= rate * 30),
        ).toBe(true);
      }
    },
  );
  it("silence is only a cut hint; long silence and no detected speech remain covered", () => {
    const chunks = planChunks(900 * 16000, 16000, [
      { start: 0, end: 900 * 16000 },
    ]);
    expect(chunks.length).toBeGreaterThan(20);
    expect(validateChunks(chunks, 900 * 16000, 16000).coreCoverageSamples).toBe(
      14400000,
    );
  });
  it("chooses deterministic near-target silence and records hard cuts", () => {
    const gaps = [
      { start: 23900, end: 24100 },
      { start: 25900, end: 26100 },
    ];
    expect(planChunks(80000, 1000, gaps)[0]?.coreEnd).toBe(24000);
    expect(planChunks(80000, 1000, [])[0]?.boundary).toBe("hard-cut");
  });
  it("rejects empty, noninteger, overbudget and broken coverage", () => {
    expect(() => planChunks(0, 16000, [])).toThrow();
    expect(() => planChunks(1.5, 16000, [])).toThrow();
    expect(() => planChunks(2000 * 16000, 16000, [])).toThrow("BUDGET");
    const chunks = planChunks(80000, 1000, []);
    const first = chunks[0];
    if (!first) throw Error("fixture");
    first.coreStart++;
    expect(() => validateChunks(chunks, 80000, 1000)).toThrow();
  });
  it("validates exact Silero probability frame grid", () => {
    expect(silenceFromScores([0.1, 0.9, 0.2], 1200, 16000)).toEqual([
      { start: 0, end: 512 },
      { start: 1024, end: 1200 },
    ]);
    expect(() => silenceFromScores([0.1], 1200, 16000)).toThrow();
    expect(() => silenceFromScores([2], 512, 16000)).toThrow();
  });
});
describe("raw and single mapping integrity", () => {
  it("preserves duplicate display ids/text with distinct record identities", () => {
    const rs = mapRaw(
      srt("01,000", "02,000") + srt("03,000", "04,000"),
      "test",
      full(),
      1000,
      5,
      65,
    );
    expect(rs).toHaveLength(2);
    expect(rs[0]?.sourceStart).toBe(6);
    expect(rs[0]?.audioGlobalStart).toBe(1);
    expect(rs[0]?.recordId).not.toBe(rs[1]?.recordId);
    expect(boundaryDedup(rs, [full()], 1000).retained).toHaveLength(2);
  });
  it.each([
    ["02,000", "02,000", "ZERO_DURATION"],
    ["02,000", "01,000", "REVERSED_INTERVAL"],
    ["49,000", "51,000", "OUT_OF_REQUEST_RANGE"],
    ["01,001", "01,003", "SERIALIZATION_COLLAPSE"],
  ])("classifies %s - %s", (s, e, code) => {
    expect(
      mapRaw(srt(s, e), "test", full(50), 1000, 5, 65)[0]?.issues,
    ).toContain(code);
  });
  it("negative local time cannot be washed by a positive global offset", () => {
    const r = mapRaw(
      "1\n-00:00:01,000 --> 00:00:01,000\ntext\n",
      "test",
      full(),
      1000,
      5,
      65,
    )[0];
    expect(r?.issues).toContain("NEGATIVE_TIME");
    expect(r?.sourceStart).toBe(4);
  });
  it("maps request input offset exactly once, independently of core and container origin", () => {
    const c = {
      ...full(),
      inputStart: 10000,
      coreStart: 10300,
      coreEnd: 35000,
      inputEnd: 35300,
    };
    const r = mapRaw(srt("01,000", "02,000"), "test", c, 1000, 7, 70)[0];
    expect(r?.audioGlobalStart).toBe(11);
    expect(r?.sourceStart).toBe(18);
  });
  it("roundtrips all three unchanged primary formats", () => {
    const r = mapRaw(
      srt("01,010", "02,030") + srt("03,000", "04,000"),
      "test",
      full(),
      1000,
      0,
      60,
    );
    expect(Object.keys(serializeRecords(r, "en").files)).toEqual([
      "srt",
      "vtt",
      "ass",
    ]);
  });
  it("empty success differs from unknown nonempty response", () => {
    expect(mapRaw("", "test", full(), 1000, 0, 60)).toHaveLength(0);
    expect(
      mapRaw("unparsed response", "test", full(), 1000, 0, 60)[0]?.issues,
    ).toContain("NONFINITE_OR_UNPARSED_TIME");
  });
});
describe("conservative seam policy", () => {
  const chunks = planChunks(50000, 1000, []);
  const first = chunks[0],
    second = chunks[1];
  if (!first || !second) throw Error("fixture");
  const pair = (word: string) => [
    ...mapRaw(srt("24,900", "25,100", word), "left", first, 1000, 0, 50),
    ...mapRaw(srt("00,200", "00,400", word), "right", second, 1000, 0, 50),
  ];
  it("does not delete short answers or tied long matches", () => {
    const short = boundaryDedup(pair("yes"), chunks, 1000);
    expect(short.retained).toHaveLength(2);
    expect(short.decisions[0]?.status).toBe("BOUNDARY_AMBIGUITY");
  });
  it("aliases only uniquely matching long text in overlapping adjacent requests", () => {
    const rs = pair("a long exact matching sentence");
    const d = boundaryDedup(rs, chunks, 1000);
    expect(d.retained.length + Object.keys(d.aliases).length).toBe(2);
    expect(d.unresolved).toHaveLength(0);
  });
  it("partial text, multiple correspondences and invalid times do not disappear", () => {
    const rs = pair("a long exact matching sentence");
    const r = rs[1];
    if (!r) throw Error("fixture");
    r.text = (r.text ?? "") + " extra";
    expect(boundaryDedup(rs, chunks, 1000).retained).toHaveLength(2);
    r.issues.push("ZERO_DURATION");
    expect(boundaryDedup(rs, chunks, 1000).unresolved).toHaveLength(1);
  });
});
describe("cumulative request budget", () => {
  const chunks = planChunks(75000, 1000, []),
    id = "chunk-0001";
  it("blocks success retry and unresolved crash reservation", () => {
    expect(() =>
      reserveAttempt(
        chunks,
        1000,
        [{ chunkId: id, seconds: 25.3, state: "completed" }],
        id,
      ),
    ).toThrow("SUCCESS");
    expect(() =>
      reserveAttempt(
        chunks,
        1000,
        [{ chunkId: id, seconds: 25.3, state: "running" }],
        id,
      ),
    ).toThrow("INSPECTION");
  });
  it("only one global retry, not one per chunk", () => {
    const history = [{ chunkId: id, seconds: 25.3, state: "failed" }];
    expect(reserveAttempt(chunks, 1000, history, id).state).toBe("running");
    history.push(
      { chunkId: id, seconds: 25.3, state: "completed" },
      { chunkId: "chunk-0002", seconds: 25.6, state: "failed" },
    );
    expect(() => reserveAttempt(chunks, 1000, history, "chunk-0002")).toThrow(
      "BUDGET",
    );
  });
});
