import { describe, expect, it } from "vitest";
import {
  c612GeneratedSchemas,
  C612_RETRIEVAL,
  c612CompletenessRowSchema,
  c612CtcScoreSchema,
} from "@mvl/shared";
import { z } from "zod";
import {
  c612Fixture,
  acousticIdentity,
  acousticScore,
  SHA,
} from "./helpers/c612-fixture.js";
import { buildTopK } from "../packages/video-subtitler/src/consensus/top-k/top-k-candidate-builder.js";
import {
  identityRelationship,
  reconcileIdentities,
  recoverIdentity,
} from "../packages/video-subtitler/src/consensus/top-k/correlation-identity.js";
import { candidateCompleteness } from "../packages/video-subtitler/src/consensus/top-k/candidate-acoustic-completeness.js";
import { buildContractionAudit } from "../packages/video-subtitler/src/consensus/top-k/contraction-audit.js";
import {
  buildFixedMappingV2,
  buildC612Folds,
} from "../packages/video-subtitler/src/consensus/top-k/fixed-cue-group-mapping-v2.js";
import { textStructure } from "../packages/video-subtitler/src/consensus/top-k/c612-structural.js";
import {
  bindGoldToFixedGroups,
  catastrophicDeletion,
  evaluateGroupText,
  legacyMaterialText,
} from "../packages/video-subtitler/src/consensus/top-k/fixed-group-evaluation.js";
import {
  hash,
  c612Defined,
} from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
describe("C6.1.2 fixed legacy material counter", () => {
  it("retains the historical similarity-complement threshold at the boundary", () => {
    // Historical 1 - (1 - 9/20) is below 0.45 in binary floating point.
    expect(
      legacyMaterialText("a".repeat(20), "b".repeat(9) + "a".repeat(11)),
    ).toBe(0);
    expect(
      legacyMaterialText("a".repeat(20), "b".repeat(10) + "a".repeat(10)),
    ).toBe(1);
  });
  it("uses the original NFKC punctuation normalization and minimum length", () => {
    expect(legacyMaterialText("ＡＢＣＤ。", "abcd")).toBe(0);
    expect(legacyMaterialText("abc", "xyz")).toBe(0);
    expect(legacyMaterialText("abcd", "wxyz")).toBe(1);
  });
});
describe("C6.1.2 full Top-K conservation", () => {
  it("retains CURRENT outside four slots and excludes hard-rejected candidates", () => {
    const f = c612Fixture(1),
      t = buildTopK(f.ranks, f.universe, f.identities);
    expect(t.topK.sets).toHaveLength(4);
    expect(t.conservation.passed).toBe(true);
    expect(t.conservation.silentDropCount).toBe(0);
    for (const s of t.topK.sets) {
      expect(s.alternativeIds.length).toBeLessThanOrEqual(4);
      expect(s.alternativeIds).not.toContain(s.currentCandidateId);
      expect(
        f.universe.candidates.find(
          (c) => c.candidateId === s.currentCandidateId,
        )?.providerFamily,
      ).toBe("CURRENT");
      expect(
        s.alternativeIds.every(
          (id) =>
            f.universe.candidates.find((c) => c.candidateId === id)
              ?.inclusionStatus === "INCLUDED",
        ),
      ).toBe(true);
    }
  });
  it("preserves fewer-than-K and deterministic ranks under reversed inputs", () => {
    const f = c612Fixture(2),
      a = buildTopK(f.ranks, f.universe, f.identities),
      b = buildTopK(
        {
          ...f.ranks,
          rows: [...f.ranks.rows].reverse(),
          eligibleEventIds: [...f.ranks.eligibleEventIds].reverse(),
        },
        { ...f.universe, candidates: [...f.universe.candidates].reverse() },
        [...f.identities].reverse(),
      );
    expect(b).toEqual(a);
    const only = f.ranks.rows.filter(
        (r) => r.currentCandidate || r.hierarchicalMbrRank === 1,
      ),
      narrow = buildTopK({ ...f.ranks, rows: only }, f.universe, f.identities);
    expect(narrow.topK.sets.every((s) => s.alternativeIds.length === 1)).toBe(
      true,
    );
  });
  it("restores a Reazon slot when Whisper alternatives are correlated observations", () => {
    const f = c612Fixture(1),
      identities = f.identities.map((i) => ({
        ...i,
        observationIdentity:
          i.providerFamily === "WHISPER" ? SHA : i.observationIdentity,
      }));
    const t = buildTopK(f.ranks, f.universe, identities),
      t3 = c612Defined(
        t.topK.sets.find((s) => s.profile === C612_RETRIEVAL[3]),
      );
    const families = t3.alternativeIds.map(
      (id) =>
        c612Defined(identities.find((i) => i.candidateId === id))
          .providerFamily,
    );
    expect(families).toContain("REAZON");
    expect(families.filter((p) => p === "WHISPER")).toHaveLength(1);
    expect(
      t.conservation.rows.some((r) => r.reason === "SAME_ACOUSTIC_OBSERVATION"),
    ).toBe(true);
  });
});
describe("C6.1.2 acoustic identities", () => {
  it("does not certify PCM from an interval", () => {
    const f = c612Fixture(1),
      c = c612Defined(
        f.universe.candidates.find(
          (c) =>
            c.providerFamily === "WHISPER" && c.inclusionStatus === "INCLUDED",
        ),
      );
    const id = recoverIdentity(c, SHA, undefined);
    expect(id.identityStatus).toBe("PROVISIONAL_INTERVAL_IDENTITY");
    expect(id.coreAudioHash).toBeNull();
    expect(id.observationIdentity).toBeNull();
  });
  it.each([
    ["same", {}, "SAME_ACOUSTIC_OBSERVATION"],
    [
      "cross-provider",
      { providerFamily: "REAZON", observationIdentity: "b".repeat(64) },
      "SAME_CORE_DIFFERENT_PROVIDER",
    ],
    [
      "different decode",
      { observationIdentity: "b".repeat(64), decodeConfigHash: "c".repeat(64) },
      "SAME_PROVIDER_DIFFERENT_DECODE",
    ],
    [
      "overlap",
      {
        observationIdentity: null,
        coreAudioHash: "b".repeat(64),
        coreInterval: { start: 2, end: 4 },
      },
      "OVERLAPPING_AUDIO_OBSERVATION",
    ],
    [
      "different window",
      {
        observationIdentity: null,
        coreAudioHash: "b".repeat(64),
        coreInterval: { start: 8, end: 10 },
      },
      "SAME_PROVIDER_DIFFERENT_WINDOW",
    ],
    [
      "provisional",
      {
        observationIdentity: null,
        coreAudioHash: null,
        identityStatus: "PROVISIONAL_INTERVAL_IDENTITY",
      },
      "PROVISIONAL_IDENTITY",
    ],
    [
      "unknown",
      {
        observationIdentity: null,
        coreAudioHash: null,
        identityStatus: "UNKNOWN_IDENTITY",
      },
      "UNKNOWN_CORRELATION",
    ],
  ] as const)("classifies %s identity", (_name, changes, expected) => {
    expect(
      identityRelationship(
        acousticIdentity(),
        acousticIdentity({ candidateId: "other", ...changes }),
      ),
    ).toBe(expected);
  });
  it("gives a same-observation family one vote, CURRENT none", () => {
    const rows = [
      acousticIdentity(),
      acousticIdentity({ candidateId: "other" }),
      acousticIdentity({
        candidateId: "current",
        providerFamily: "CURRENT",
        observationIdentity: null,
      }),
    ];
    const r = reconcileIdentities(
      rows,
      rows.map((r) => r.candidateId),
    );
    expect(r.reconciliation.duplicateVotesPrevented).toBe(1);
    expect(r.reconciliation.observationGroups[0]?.voteWeight).toBe(1);
  });
});
const vad = {
  intervals: [{ start: 1.1, end: 2.9 }],
  sourceIdentity: SHA,
  verified: true,
  evidenceHash: SHA,
};
describe("C6.1.2 candidate-specific acoustic completeness", () => {
  it("requires VAD, identity and supported target tokens for complete speech", () => {
    expect(
      candidateCompleteness(acousticIdentity(), acousticScore(), vad)
        .acousticCompletenessStatus,
    ).toBe("VERIFIED_COMPLETE");
  });
  it.each([
    [
      "leading",
      [
        { index: 0, start: 0.9, end: 1.4, posterior: 0.99 },
        { index: 1, start: 1.4, end: 1.9, posterior: 0.99 },
      ],
      "PARTIAL_LEADING",
    ],
    [
      "trailing",
      [
        { index: 0, start: 0.1, end: 0.4, posterior: 0.99 },
        { index: 1, start: 0.4, end: 0.6, posterior: 0.99 },
      ],
      "PARTIAL_TRAILING",
    ],
    [
      "internal",
      [
        { index: 0, start: 0.1, end: 0.3, posterior: 0.99 },
        { index: 1, start: 1.7, end: 1.9, posterior: 0.99 },
      ],
      "PARTIAL_INTERNAL",
    ],
  ] as const)("detects %s missing speech", (_n, supportedTokens, expected) => {
    expect(
      candidateCompleteness(
        acousticIdentity(),
        acousticScore({ supportedTokens: [...supportedTokens] }),
        vad,
      ).acousticCompletenessStatus,
    ).toBe(expected);
  });
  it("detects request edge pinning", () =>
    expect(
      candidateCompleteness(
        acousticIdentity({ requestedInterval: { start: 1.08, end: 4 } }),
        acousticScore(),
        vad,
      ).acousticCompletenessStatus,
    ).toBe("EDGE_TRUNCATED"));
  it("detects observed context contamination", () => {
    const score = acousticScore({
      supportedTokens: [
        { index: 0, start: 0.1, end: 1.1, posterior: 0.99 },
        { index: 1, start: 1.1, end: 2.2, posterior: 0.99 },
      ],
    });
    expect(
      candidateCompleteness(acousticIdentity(), score, vad)
        .acousticCompletenessStatus,
    ).toBe("ADJACENT_CONTAMINATED");
  });
  it("does not make missing speech or missing tokens safe", () => {
    const missing = candidateCompleteness(
      acousticIdentity(),
      acousticScore({ supportedTokens: [] }),
      vad,
    );
    expect(missing.acousticCompletenessStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(missing.speechActivityCoverage).toBeNull();
    expect(missing.adjacentUtteranceContaminationRisk).toBeNull();
    const noVad = candidateCompleteness(acousticIdentity(), acousticScore(), {
      ...vad,
      verified: false,
    });
    expect(noVad.speechBeforeFirstSupportedToken).toBeNull();
    expect(noVad.acousticCompletenessStatus).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("keeps unscorable and unavailable CTC explicit", () => {
    expect(
      candidateCompleteness(
        acousticIdentity(),
        acousticScore({
          status: "UNSCORABLE",
          perTokenLoss: null,
          supportedTokens: [],
        }),
        vad,
      ).acousticCompletenessStatus,
    ).toBe("UNSCORABLE");
    expect(
      candidateCompleteness(
        acousticIdentity(),
        acousticScore({
          status: "UNAVAILABLE",
          perTokenLoss: null,
          supportedTokens: [],
        }),
        vad,
      ).candidateCtcLossPerToken,
    ).toBeNull();
  });
  it("rejects cross-candidate cached scores", () =>
    expect(() =>
      candidateCompleteness(
        acousticIdentity(),
        acousticScore({ candidateId: "unrelated" }),
        vad,
      ),
    ).toThrow("BINDING"));
  it("does not ban safe shortening solely by length", () => {
    const f = c612Fixture(1),
      short = c612Defined(
        f.universe.candidates.find(
          (c) => c.displayText === "曇り" && c.inclusionStatus === "INCLUDED",
        ),
      );
    const evidence = candidateCompleteness(
      acousticIdentity({
        eventId: c612Defined(short.eventId),
        candidateId: short.candidateId,
      }),
      acousticScore({
        eventId: c612Defined(short.eventId),
        candidateId: short.candidateId,
      }),
      vad,
    );
    const known = buildContractionAudit(
      f.universe,
      [evidence],
      [short.candidateId],
    );
    expect(known.rows[0]?.strong).toBe(true);
    expect(known.rows[0]?.selectable).toBe(true);
    const unknown = buildContractionAudit(
      f.universe,
      [{ ...evidence, acousticCompletenessStatus: "INSUFFICIENT_EVIDENCE" }],
      [],
    );
    expect(unknown.rows[0]?.selectable).toBe(false);
  });
  it("uses lower CTC loss as a feature, not a complete-speech override", () => {
    const result = candidateCompleteness(
      acousticIdentity(),
      acousticScore({
        rawLoss: 0.001,
        perTokenLoss: 0.0005,
        supportedTokens: [
          { index: 0, start: 1, end: 1.5, posterior: 0.99 },
          { index: 1, start: 1.5, end: 1.9, posterior: 0.99 },
        ],
      }),
      vad,
    );
    expect(result.acousticCompletenessStatus).toBe("PARTIAL_LEADING");
  });
});
describe("C6.1.2 fixed mapping and deletion evidence", () => {
  it("keeps split-derived exact spans and fixed chronological folds", () => {
    const f = c612Fixture(10),
      u = {
        ...f.universe,
        events: f.universe.events.map((e) => ({
          ...e,
          finalSpan: e.finalSpan
            ? { ...e.finalSpan, lineageStatus: "DERIVED_FROM_SPLIT" }
            : null,
        })),
      };
    const m = buildFixedMappingV2(u, f.production);
    expect(m.mapping.groups.every((g) => g.status === "FIXED_ONE_TO_ONE")).toBe(
      true,
    );
    const folds = buildC612Folds(m.mapping, f.identities, f.universe);
    expect(folds.folds).toHaveLength(5);
    expect(folds.audioLeakageCount).toBe(0);
    expect(folds.correlationLeakageCount).toBe(0);
    expect(new Set(folds.folds.flatMap((f) => f.groupIds)).size).toBe(
      m.mapping.groups.length,
    );
  });
  it("binds Gold once without Gold text deciding topology", () => {
    const f = c612Fixture(2),
      mapping = buildFixedMappingV2(f.universe, f.production).mapping;
    const a = bindGoldToFixedGroups(mapping.groups, f.production, f.gold),
      b = bindGoldToFixedGroups(
        mapping.groups,
        f.production,
        f.gold.map((g) => ({ ...g, text: "任意の別文章" })),
      );
    expect(a.map((g) => [g.groupId, g.goldCueIds, g.status])).toEqual(
      b.map((g) => [g.groupId, g.goldCueIds, g.status]),
    );
    expect(mapping.runtimeGoldInputCount).toBe(0);
  });
  it("marks spanning Gold ambiguous, never copies its text to recover mapping", () => {
    const f = c612Fixture(2),
      mapping = buildFixedMappingV2(f.universe, f.production).mapping;
    const bound = bindGoldToFixedGroups(mapping.groups, f.production, [
      { id: "g", start: 0, end: 14, text: "テスト" },
    ]);
    expect(bound.every((b) => b.status === "AMBIGUOUS")).toBe(true);
  });
  it("keeps missing mapping and unknown gains null", () => {
    const f = c612Fixture(1),
      mapping = buildFixedMappingV2(f.universe, f.production).mapping,
      bound = bindGoldToFixedGroups(mapping.groups, f.production, []);
    expect(bound[0]?.status).toBe("NO_MAPPING");
    expect(
      evaluateGroupText(
        c612Defined(mapping.groups[0]),
        c612Defined(bound[0]),
        f.production.cues,
        f.production.cues,
        [],
      ).normalizedGain,
    ).toBeNull();
  });
  it.each([
    ["本当の話です", "話です", "本当の話です"],
    ["本当の話です", "本当", "本当の話です"],
    ["明日は本当に良い天気になる", "明日晴れる", "明日は本当に良い天気になる"],
  ])(
    "recognizes destructive deletion of Gold-supported text",
    (before, after, gold) =>
      expect(catastrophicDeletion(before, after, gold)).toBe(true),
  );
  it("does not call removal of false text catastrophic", () =>
    expect(
      catastrophicDeletion("おはよう宇宙の幻の音声", "おはよう", "おはよう"),
    ).toBe(false));
  it("retains distinct leading/trailing/internal structural spans", () => {
    const s = textStructure("abcdefg", "bd");
    expect(s.leadingDeletionLength).toBe(1);
    expect(s.trailingDeletionLength).toBe(3);
    expect(s.internalDeletionSpans).toEqual([{ start: 2, end: 3 }]);
  });
});
describe("C6.1.2 strict contracts", () => {
  it("registers all 33 requested artifacts and rejects extra nested fields", () => {
    expect(c612GeneratedSchemas.length).toBeGreaterThanOrEqual(33);
    for (const [name, schema] of c612GeneratedSchemas) {
      const json = z.toJSONSchema(schema);
      expect(json.additionalProperties, name).toBe(false);
      expect(json.required).toContain("semanticHash");
    }
    const row = candidateCompleteness(acousticIdentity(), acousticScore(), vad);
    expect(
      c612CompletenessRowSchema.safeParse({ ...row, pretendSafe: true })
        .success,
    ).toBe(false);
    expect(
      c612CtcScoreSchema.safeParse({
        ...acousticScore(),
        supportedTokens: [
          { index: 0, start: 0, end: 1, posterior: 1, text: "forbidden" },
        ],
      }).success,
    ).toBe(false);
  });
  it("uses stable hashes, not iteration order as tie breakers", () =>
    expect(hash({ b: 2, a: 1 })).toBe(hash({ a: 1, b: 2 })));
});
