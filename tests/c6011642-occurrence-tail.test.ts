import { it, expect } from "vitest";
import { subtitleCueSchema } from "@mvl/shared";
import {
  applyOccurrenceTail,
  occurrenceTailProposalSchema,
} from "../packages/video-subtitler/src/machine-quality/occurrence-tail.js";
import { objectHash } from "../packages/video-subtitler/src/machine-quality/experimental-profile.js";
const cue = subtitleCueSchema.parse({
  id: "neutral",
  text: "例。",
  language: "ja",
  languages: ["ja"],
  start: 1,
  end: 2,
  speaker: null,
  confidence: null,
});
const p = {
  version: "c6011642-original-tail-proposal-v1",
  cueId: cue.id,
  cueHash: objectHash(cue),
  evidenceHash: "synthetic",
  mathematicalPathExists: true,
  originalSupportEstablished: true,
  occurrenceDistinguished: true,
  tailIdentifiable: true,
  proposedEnd: 2.3,
  sourceRange: { start: 0, end: 5 },
  configuredStabilityTolerance: 0.12,
  candidateEndRange: [2.28, 2.3],
  reasons: [],
  audioConfirmed: false,
  listener: null,
};
it("new protocol preserves all but the explicitly allowed end", () => {
  const r = applyOccurrenceTail([cue], p, cue.id, true);
  expect(r.changes).toHaveLength(1);
  expect(r.cues).toEqual([{ ...cue, end: 2.3 }]);
});
it("observe does not apply a supported proposal", () =>
  expect(applyOccurrenceTail([cue], p, cue.id, false).cues).toEqual([cue]));
it("finite path alone cannot authorize an end", () =>
  expect(() =>
    occurrenceTailProposalSchema.parse({
      ...p,
      originalSupportEstablished: false,
    }),
  ).toThrow());
it("schema does not accept legacy version or invented confidence", () => {
  expect(() =>
    occurrenceTailProposalSchema.parse({
      ...p,
      version: "c6011641-boundary-support-v1",
    }),
  ).toThrow();
  expect(() =>
    occurrenceTailProposalSchema.parse({ ...p, confidence: 0.95 }),
  ).toThrow();
});
it("stale cue binding fails closed", () =>
  expect(() =>
    applyOccurrenceTail([{ ...cue, text: "別。" }], p, cue.id, true),
  ).toThrow());
it("foreign allowed identity fails closed", () =>
  expect(() => applyOccurrenceTail([cue], p, "other", true)).toThrow());
it("neighbor conflict is atomic and not clipped", () => {
  const next = { ...cue, id: "next", start: 2.1, end: 3 };
  const r = applyOccurrenceTail([cue, next], p, cue.id, true);
  expect(r.changes).toHaveLength(0);
  expect(r.cues).toEqual([cue, next]);
  expect(r.rejectedReason).not.toBeNull();
});
it("unsupported end remains null, not a zero-width certainty", () => {
  const r = applyOccurrenceTail(
    [cue],
    {
      ...p,
      tailIdentifiable: false,
      proposedEnd: null,
      candidateEndRange: [2.3, 2.3],
      reasons: ["TAIL_UNRESOLVED"],
    },
    cue.id,
    true,
  );
  expect(r.changes).toHaveLength(0);
});
