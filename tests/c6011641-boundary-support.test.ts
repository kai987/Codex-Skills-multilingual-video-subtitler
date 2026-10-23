import { describe, it, expect } from "vitest";
import type { SubtitleCue } from "@mvl/shared";
import {
  BOUNDARY_POLICY,
  proposeBoundary,
  applyBoundaryEnds,
  type BoundaryObservation,
} from "../packages/video-subtitler/src/machine-quality/boundary-support.js";
const cue: SubtitleCue = {
  id: "neutral",
  start: 1,
  end: 2,
  text: "待って。",
  language: "ja",
  languages: ["ja"],
  speaker: null,
  confidence: null,
};
const spans = [0, 1, 2].map((i) => ({
  targetIndex: i,
  tokenId: 10 + i,
  startFrame: 50 + i * 10,
  endFrameExclusive: 60 + i * 10,
  meanPosterior: 0.8,
  meanLogPosterior: -0.22,
  minLogPosterior: -0.3,
}));
const o: BoundaryObservation = {
  windowId: "W0",
  window: { start: 0, end: 4 },
  status: "SUCCESS",
  mappingComplete: true,
  spans,
  ambiguous: false,
  frameSeconds: 0.02,
  transitionSeconds: 1.9,
  unassignedSuffix: [80, 200],
  evidenceHash: "evidence",
};
const old = {
  meanPosterior: [0.1, 0.2],
  normalizedPathLogScore: -2,
  firstTokenStart: 1,
};
describe("boundary support, not forced-alignability", () => {
  it("preserves old scores without calling them lexical accuracy", () => {
    const p = proposeBoundary(cue, 0, 2, o, old);
    expect(p.oldMeanPosterior).toEqual([0.1, 0.2]);
    expect(p.lexicalTruthValidated).toBe(false);
    expect(p.oldFrameEvidenceStatus).toBe("FULL_FRAME_EVIDENCE_NOT_PERSISTED");
  });
  it("one-frame peaks do not define sustained pronunciation", () => {
    const p = proposeBoundary(
      cue,
      0,
      2,
      {
        ...o,
        spans: spans.map((s) => ({
          ...s,
          endFrameExclusive: s.startFrame + 1,
        })),
      },
      old,
    );
    expect(p.risks).toContain("WEAK_TAIL_SUPPORT");
    expect(p.proposedSubtitleEnd).toBeNull();
  });
  it("SUCCESS without a transition abstains", () => {
    expect(
      proposeBoundary(cue, 0, 2, { ...o, transitionSeconds: null }, old)
        .proposedSubtitleEnd,
    ).toBeNull();
  });
  it("missing frame evidence cannot be reconstructed from summaries", () => {
    const p = proposeBoundary(
      cue,
      0,
      2,
      { ...o, spans: [], status: "UNAVAILABLE" },
      old,
    );
    expect(p.pathExists).toBe(false);
    expect(p.proposedSubtitleEnd).toBeNull();
  });
  it("reports censoring at physical edge without adding time", () => {
    expect(
      proposeBoundary(cue, 0, 2, { ...o, window: { start: 0, end: 1.8 } }, old)
        .risks,
    ).toContain("POSSIBLY_RIGHT_CENSORED");
  });
  it("keeps ambiguous repeated occurrences", () => {
    const p = proposeBoundary(cue, 0, 2, { ...o, ambiguous: true }, old);
    expect(p.risks).toContain("OCCURRENCE_AMBIGUOUS");
    expect(p.proposedSubtitleEnd).toBeNull();
  });
  it("does not steal a later same-text occurrence", () => {
    const p = proposeBoundary(
      cue,
      0,
      2,
      {
        ...o,
        spans: spans.map((s) => ({
          ...s,
          startFrame: s.startFrame + 100,
          endFrameExclusive: s.endFrameExclusive + 100,
        })),
      },
      old,
    );
    expect(p.risks).toContain("NEIGHBOR_OR_OCCURRENCE_CONFLICT");
  });
  it("requires fixed W+4 and W+2 stability", () => {
    expect(BOUNDARY_POLICY.mainWindow).toBe("W+4");
    expect(
      proposeBoundary(cue, 0, 2, { ...o, windowId: "W+4" }, old)
        .proposedSubtitleEnd,
    ).toBeNull();
    expect(
      proposeBoundary(cue, 0, 2, { ...o, windowId: "W+4" }, old, {
        ...o,
        windowId: "W+2",
      }).proposedSubtitleEnd,
    ).toBe(1.9);
  });
  it("applies end only and preserves off", () => {
    const p = proposeBoundary(cue, 0, 2, o, old);
    expect(applyBoundaryEnds([cue], [p], [cue.id], true).cues).toEqual([
      { ...cue, end: 1.9 },
    ]);
    expect(applyBoundaryEnds([cue], [p], [cue.id], false).cues).toEqual([cue]);
  });
  it("rejects neighbor conflicts atomically, never clips to next.start", () => {
    const p = proposeBoundary(cue, 0, 2, { ...o, transitionSeconds: 2.8 }, old);
    const n = { ...cue, id: "neighbor", start: 2.5, end: 3 };
    const r = applyBoundaryEnds([cue, n], [p], [cue.id], true);
    expect(r.cues).toEqual([cue, n]);
    expect(r.rejectedReason).toBe("NEIGHBOR_OR_OCCURRENCE_CONFLICT");
  });
  it("rejects stale or foreign proposal identity", () => {
    const p = proposeBoundary(cue, 0, 2, o, old);
    expect(() =>
      applyBoundaryEnds([{ ...cue, text: "別" }], [p], [cue.id], true),
    ).toThrow();
    expect(() => applyBoundaryEnds([cue], [p], [], true)).toThrow();
  });
});
