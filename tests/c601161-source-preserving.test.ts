function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required fixture value absent");
  return value;
}
import { describe, it, expect } from "vitest";
import { repairIntraCueHypothesisRepetition } from "../packages/transcription-core/src/intra-cue-repetition.js";
import {
  matchedEvidenceSchema,
  replayPrimaryAssembly,
} from "../packages/video-subtitler/src/machine-quality/matched-replay.js";
import { primaryMinimal } from "../packages/video-subtitler/src/machine-quality/experimental-profile.js";
import { evidence } from "./helpers/c60116-quality-fixture.js";
const fixture = () => {
  const e = evidence();
  return matchedEvidenceSchema.parse({
    version: "c601161-primary-evidence-v1",
    partition: e.partition,
    source: e.source,
    primaryRequests: e.primaryRequests,
    promptStatus: "HISTORICAL_TITLE_PROMPTED_EVIDENCE",
  });
};
const cue = (text = "こちらへ来て!こちらへ来て!") => ({
  id: "source",
  text,
  start: 10,
  end: 14,
  language: "ja" as const,
  languages: ["ja" as const],
  speaker: null,
  confidence: null,
});
describe("C601161 actual intra-cue policy", () => {
  it("reproduces legacy deletion then abstains at its source", () => {
    const c = cue();
    const old = repairIntraCueHypothesisRepetition({ cues: [c] });
    const now = repairIntraCueHypothesisRepetition({
      cues: [c],
      repetitionPolicy: "source-preserving",
    });
    expect(old.cues[0]?.text).not.toBe(c.text);
    expect(now.cues[0]?.text).toBe(c.text);
    expect(now.artifact.summary.removedSpanCount).toBe(0);
    expect(now.artifact.summary.repairedCueCount).toBe(0);
    expect(now.artifact.records[0]?.selectedReason).toContain("ABSTAIN");
  });
  it("leaves production default identical to explicit legacy", () => {
    const c = cue();
    expect(repairIntraCueHypothesisRepetition({ cues: [c] }).cues).toEqual(
      repairIntraCueHypothesisRepetition({
        cues: [c],
        repetitionPolicy: "legacy",
      }).cues,
    );
  });
  it("preserves the current input instead of an earlier raw version", () => {
    const c = {
      ...cue(),
      textAudit: {
        rawAsrText: "old incorrect raw",
        repairedText: cue().text,
        normalizedText: cue().text,
        winnerClusterIds: [],
        sourceWinnerCueIds: ["source"],
        replacements: [],
        deduplicationActions: [],
      },
    };
    expect(
      repairIntraCueHypothesisRepetition({
        cues: [c],
        repetitionPolicy: "source-preserving",
      }).cues[0]?.text,
    ).toBe(c.text);
  });
  it.each(["あ!あ!", "待って!待って!", "こちらへ来て!こちらへ来て!"])(
    "does not mechanically clean short calls or repeated speech: %s",
    (text) => {
      const cs = [
        cue(text),
        { ...cue(text), id: "other", start: 11, end: 15, speaker: "local-2" },
      ];
      expect(
        repairIntraCueHypothesisRepetition({
          cues: cs,
          repetitionPolicy: "source-preserving",
        }).cues.map((c) => c.text),
      ).toEqual([text, text]);
    },
  );
  it("does not label source preservation as confirmed acoustic speech", () => {
    const r = repairIntraCueHypothesisRepetition({
      cues: [cue()],
      repetitionPolicy: "source-preserving",
    });
    expect(r.artifact.summary.trueSpokenRepetitionCount).toBe(0);
    expect(r.artifact.records[0]?.reviewRecommended).toBe(true);
    expect(r.artifact.records[0]?.audioRepetitionEvidence).toContain(
      "source-preservation-is-not-acoustic-confirmation",
    );
  });
  it("retains matching timing attachments without inventing new support", () => {
    const c = cue();
    const r = repairIntraCueHypothesisRepetition({
      cues: [c],
      repetitionPolicy: "source-preserving",
    });
    expect(r.cues[0]?.timingEvidence).toBeUndefined();
    expect([r.cues[0]?.start, r.cues[0]?.end]).toEqual([10, 14]);
  });
});
describe("C601161 strict primary-only matched replay", () => {
  it("binds legacy merge ID collisions without changing text or time", () => {
    const e = fixture();
    requireValue(e.primaryRequests[0]).segments = [
      { id: "a-0001", start: 0, end: 1, text: "これは" },
      { id: "a-0002", start: 1, end: 2, text: "テストです。" },
      { id: "a-0003", start: 5, end: 6, text: "それは" },
      { id: "a-0004", start: 6, end: 7, text: "別の文です。" },
    ];
    const r = replayPrimaryAssembly(e, false);
    expect(new Set(r.cues.map((c) => c.id)).size).toBe(r.cues.length);
    const s = requireValue(r.trace[3]);
    const ev = s.evidence as { rawOutput: typeof r.cues };
    const semantic = (cs: typeof r.cues) =>
      cs.map(({ id, ...c }) => {
        void id;
        return c;
      });
    expect(semantic(s.output as typeof r.cues)).toEqual(semantic(ev.rawOutput));
  });
  it.each([
    "stableCues",
    "gold",
    "canonicalLineage",
    "unprovenRepetition",
    "humanAnswers",
  ])("rejects historical or human input %s", (key) => {
    expect(() =>
      matchedEvidenceSchema.parse({ ...fixture(), [key]: [] }),
    ).toThrow();
  });
  it("rejects stale alignment attachments in the evidence projection", () => {
    const e = fixture(),
      r = e.primaryRequests[0];
    expect(() =>
      matchedEvidenceSchema.parse({
        ...e,
        primaryRequests: [{ ...r, alignment: { supported: true } }],
      }),
    ).toThrow();
  });
  it("deduplicates same request import, not distinct occurrence IDs", () => {
    const e = fixture(),
      r = e.primaryRequests[0];
    if (!r) throw new Error("fixture");
    e.primaryRequests.push(structuredClone(r));
    expect(primaryMinimal(e)).toHaveLength(2);
    requireValue(requireValue(e.primaryRequests[1]).segments[0]).text =
      "conflict";
    expect(() => primaryMinimal(e)).toThrow(/Conflicting/u);
  });
  it("maps source-global extraction offset only once", () => {
    expect(primaryMinimal(fixture()).map((c) => [c.start, c.end])).toEqual([
      [10, 12],
      [12, 14],
    ]);
  });
  it("rejects unverified VAD and overflowing coordinates", () => {
    const e = fixture();
    requireValue(requireValue(e.primaryRequests[0]).segments[0]).end = 30;
    expect(() => replayPrimaryAssembly(e, true)).toThrow(/timebase/u);
    expect(() =>
      matchedEvidenceSchema.parse({
        ...fixture(),
        primaryRequests: [
          { ...fixture().primaryRequests[0], vadEnabled: true },
        ],
      }),
    ).toThrow();
  });
  it("really executes old business stages with matched disabled parity and without mutating evidence", () => {
    const e = fixture();
    requireValue(e.primaryRequests[0]).segments = [
      { id: "raw", start: 0, end: 4, text: cue().text },
    ];
    const before = JSON.stringify(e),
      a = replayPrimaryAssembly(e, false),
      b = replayPrimaryAssembly(e, true),
      disabled = replayPrimaryAssembly(e, false);
    expect(a.cues).toEqual(disabled.cues);
    expect(a.cues.map((c) => c.text)).not.toEqual(b.cues.map((c) => c.text));
    expect(a.trace.map((t) => t.stageName)).toEqual([
      "primaryMinimal",
      "deduplicateTopScoreWinners",
      "repairIntraCueHypothesisRepetition",
      "buildAcousticSemanticCueSegments",
      "layoutSubtitleCuesWithDiagnostics",
    ]);
    expect(a.trace[2]?.inputHash).toEqual(b.trace[2]?.inputHash);
    expect(JSON.stringify(e)).toBe(before);
  });
});
