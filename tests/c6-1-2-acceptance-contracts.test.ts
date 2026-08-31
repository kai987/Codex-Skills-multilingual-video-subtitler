import { describe, expect, it } from "vitest";
import { c612CtcScoreSchema } from "@mvl/shared";
import {
  verifyC612LatticeArray,
  verifyC612CtcOccupancy,
  verifyC612AcceptanceOnlySourceChanges,
  countC612CatastrophicDeletionClasses,
} from "../packages/video-subtitler/src/consensus/top-k/c612-artifact-validator.js";
import { hash } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import { SHA } from "./helpers/c612-fixture.js";

describe("C6.1.2 independent acceptance contracts", () => {
  it("reports only explicitly catastrophic deletion classes, not every negative deletion", () => {
    expect(
      countC612CatastrophicDeletionClasses([
        { goldClass: "LEADING_DIALOGUE_DELETION", catastrophic: true },
        { goldClass: "LEADING_DIALOGUE_DELETION", catastrophic: false },
        { goldClass: "TRAILING_DIALOGUE_DELETION", catastrophic: true },
        { goldClass: "TRAILING_DIALOGUE_DELETION", catastrophic: null },
        { goldClass: "INTERNAL_DIALOGUE_DELETION", catastrophic: true },
        { goldClass: "VALID_SHORTENING", catastrophic: false },
        { goldClass: "UNEVALUABLE", catastrophic: null },
      ]),
    ).toEqual({ leading: 1, trailing: 1, internal: 1 });
  });
  it("keeps unknown catastrophic labels out of every confirmed count", () => {
    expect(
      countC612CatastrophicDeletionClasses([
        { goldClass: "LEADING_DIALOGUE_DELETION", catastrophic: null },
        { goldClass: "TRAILING_DIALOGUE_DELETION", catastrophic: null },
        { goldClass: "INTERNAL_DIALOGUE_DELETION", catastrophic: null },
      ]),
    ).toEqual({ leading: 0, trailing: 0, internal: 0 });
  });
  it("validates the exact historical array container and every row self-hash", () => {
    const body = {
      eventId: "synthetic-event",
      sourceInterval: { start: 1, end: 2 },
      alignmentHash: SHA,
      nodes: [],
      edges: [],
      candidatePaths: [],
      startNodeId: "start",
      endNodeId: "end",
    };
    const row = { ...body, semanticHash: hash(body) };
    expect(verifyC612LatticeArray([row])).toBe(1);
    expect(() => verifyC612LatticeArray({ lattices: [row] })).toThrow();
    expect(() =>
      verifyC612LatticeArray([{ ...row, unexpected: true }]),
    ).toThrow();
    expect(() =>
      verifyC612LatticeArray([{ ...row, eventId: "tampered" }]),
    ).toThrow("SELF_HASH");
    expect(() => verifyC612LatticeArray([row, row])).toThrow(
      "DUPLICATE_LATTICE_EVENT",
    );
  });
  it("uses exact sample-rounded PCM bounds and rejects even one extra sample", () => {
    const interval = { start: 1.00002, end: 1.01004 },
      duration =
        (Math.round(interval.end * 16000) -
          Math.round(interval.start * 16000)) /
        16000;
    const row = c612CtcScoreSchema.parse({
      candidateId: "synthetic-candidate",
      eventId: "synthetic-event",
      audioHash: SHA,
      scoredInterval: interval,
      modelSnapshotHash: SHA,
      runtimeIdentityHash: SHA,
      targetHash: SHA,
      representation: "NORMALIZED_DISPLAY",
      rawLoss: 1,
      perTokenLoss: 1,
      tokenCount: 1,
      vocabularyCoverage: 1,
      unknownTokenCount: 0,
      acousticFrameCount: 1,
      status: "SCORABLE",
      reasons: [],
      supportedTokens: [{ index: 0, start: 0, end: duration, posterior: 0.7 }],
      cacheIdentity: SHA,
    });
    const before = hash(row);
    expect(duration).toBeGreaterThan(interval.end - interval.start);
    expect(() => verifyC612CtcOccupancy(row)).not.toThrow();
    expect(hash(row)).toBe(before);
    expect(() =>
      verifyC612CtcOccupancy({
        ...row,
        supportedTokens: [
          { index: 0, start: 0, end: duration + 1 / 16000, posterior: 0.7 },
        ],
      }),
    ).toThrow("OCCUPANCY_RANGE");
    expect(() =>
      verifyC612CtcOccupancy({
        ...row,
        supportedTokens: [...row.supportedTokens, ...row.supportedTokens],
      }),
    ).toThrow("OCCUPANCY_RANGE");
  });
  it("accepts a separately hashed validator/test repair without changing frozen generation", () => {
    const frozen = [
      {
        relativePath:
          "packages/video-subtitler/src/consensus/top-k/c612-artifact-validator.ts",
        size: 1,
        sha256: SHA,
      },
    ];
    const current = [
      {
        ...frozen[0],
        relativePath:
          "packages/video-subtitler/src/consensus/top-k/c612-artifact-validator.ts",
        size: 2,
        sha256: hash("acceptance-repair"),
      },
      {
        relativePath: "tests/c6-1-2-acceptance-contracts.test.ts",
        size: 1,
        sha256: SHA,
      },
    ];
    const proof = verifyC612AcceptanceOnlySourceChanges(frozen, current);
    expect(proof.changedPaths).toHaveLength(2);
    expect(proof.frozenCodeHash).not.toBe(proof.acceptanceCodeHash);
  });
  it("rejects changes to machine policy, training, evidence, evaluator and arbitrary tests", () => {
    for (const name of [
      "c612-policy.ts",
      "linear-reranker.ts",
      "candidate-acoustic-completeness.ts",
      "fixed-group-evaluation.ts",
    ])
      expect(() =>
        verifyC612AcceptanceOnlySourceChanges(
          [],
          [
            {
              relativePath: `packages/video-subtitler/src/consensus/top-k/${name}`,
              size: 1,
              sha256: SHA,
            },
          ],
        ),
      ).toThrow("GENERATION_SOURCE_CHANGED");
    expect(() =>
      verifyC612AcceptanceOnlySourceChanges(
        [],
        [{ relativePath: "tests/c6-1-2-policy.test.ts", size: 1, sha256: SHA }],
      ),
    ).toThrow("GENERATION_SOURCE_CHANGED");
  });
});
