import { describe, expect, test } from "vitest";
import {
  c61CandidateMbrResultSchema,
  c61ConsensusProfileFreezeSchema,
  c61LatticeMbrResultSchema,
  c61RoverResultSchema,
  type C61CandidateText,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import {
  c61AcousticCacheMatches,
  c61HypothesisWeights,
  c61RequiredDecoderValue,
  type C61AcousticEvidence,
} from "../packages/video-subtitler/src/consensus/candidate-correlation.js";
import {
  candidateMbr,
  c61ExpectedRisk,
  c61NormalizedEditDistance,
} from "../packages/video-subtitler/src/consensus/candidate-mbr.js";
import { freezeC61Profiles } from "../packages/video-subtitler/src/consensus/c61-policy.js";
import { decodeRover } from "../packages/video-subtitler/src/consensus/rover-decoder.js";
import {
  enumerateLegalPaths,
  latticeMbr,
  materializeC61Path,
} from "../packages/video-subtitler/src/consensus/lattice-mbr.js";
import { buildC61Representation } from "../packages/video-subtitler/src/consensus/japanese-text-representation.js";
import { alignC61Multiple } from "../packages/video-subtitler/src/consensus/multiple-sequence-alignment.js";
import { buildC61TokenLattice } from "../packages/video-subtitler/src/consensus/token-lattice.js";
import { buildC61ConfusionNetwork } from "../packages/video-subtitler/src/consensus/confusion-network.js";
import { validateC61Path } from "../packages/video-subtitler/src/consensus/legal-path-validator.js";
function candidate(
  id: string,
  text: string,
  providerFamily: C61CandidateText["providerFamily"],
  group = providerFamily,
): C61CandidateText {
  return {
    candidateId: id,
    eventId: "synthetic-event",
    providerFamily,
    displayText: text,
    normalizedText: text,
    pronunciationText: null,
    correlationGroupId: group,
    provenanceHash: hash({ id, text }),
    sourceInterval: { start: 0, end: 2 },
  };
}
function event(candidates: C61CandidateText[]) {
  const representations = candidates.map(buildC61Representation);
  const alignment = alignC61Multiple(representations);
  const lattice = buildC61TokenLattice(alignment, representations);
  return {
    candidates,
    lattice,
    network: buildC61ConfusionNetwork(lattice),
    currentCandidateId:
      candidates.find((entry) => entry.providerFamily === "CURRENT")
        ?.candidateId ?? null,
  };
}
function acoustic(
  candidate: C61CandidateText,
  nll: number,
): C61AcousticEvidence {
  const identity = {
    modelIdentityHash: hash("synthetic-model"),
    audioSha256: hash("synthetic-audio"),
    representationHash: hash(candidate.normalizedText),
  };
  return {
    candidateId: candidate.candidateId,
    eventId: candidate.eventId,
    candidateProvenanceHash: candidate.provenanceHash,
    expectedIdentity: identity,
    cachedIdentity: { ...identity },
    nllPerTargetToken: nll,
    scorability: "SCORABLE",
    evidenceHash: hash({ candidateId: candidate.candidateId, nll }),
    cacheHit: true,
  };
}
const novelCandidates = () => [
  candidate("current", "いかえ", "CURRENT"),
  candidate("w1", "あかえ", "WHISPER"),
  candidate("w2", "あかお", "WHISPER"),
  candidate("r1", "いかう", "REAZON"),
  candidate("r2", "うかう", "REAZON"),
];
describe("C6.1 independent support and frozen decoder policies", () => {
  test("deduplicated raw-window identities retain R0 bias without affecting balanced weights", () => {
    const w = {
      ...candidate("w", "赤", "WHISPER"),
      rawVoteCandidateIds: Array.from(
        { length: 10 },
        (_, index) => `raw-${index}`,
      ),
    };
    const r = {
      ...candidate("r", "青", "REAZON"),
      rawVoteCandidateIds: ["reazon-raw"],
    };
    const fixture = event([w, r, candidate("current", "青", "CURRENT")]);
    const raw = decodeRover({ ...fixture, variant: "R0" });
    const balanced = decodeRover({ ...fixture, variant: "R1" });
    expect(
      raw.candidateSupport.find((row) => row.candidateId === "w")
        ?.rawCandidateSupport,
    ).toBe(10);
    expect(
      raw.candidateSupport.find((row) => row.candidateId === "w")
        ?.normalizedHypothesisWeight,
    ).toBeCloseTo(10 / 11);
    expect(
      raw.slotDecisions[0]?.alternatives.find(
        (row) => row.rawCandidateSupport === 10,
      ),
    ).toBeDefined();
    expect(raw.selectedPath?.displayText).toBe("赤");
    expect(balanced.outcome).toBe("ABSTAIN_AMBIGUOUS");
    expect(
      balanced.candidateSupport.find((row) => row.candidateId === "w")
        ?.normalizedHypothesisWeight,
    ).toBe(0.5);
  });
  test("ten Whisper windows are one provider, not ten independent providers", () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, index) =>
        candidate(`w${index}`, "赤", "WHISPER"),
      ),
      candidate("r", "青", "REAZON"),
      candidate("current", "青", "CURRENT"),
    ];
    const raw = c61HypothesisWeights(candidates, "R0"),
      balanced = c61HypothesisWeights(candidates, "R1");
    expect(
      raw
        .filter((entry) => entry.providerFamily === "WHISPER")
        .reduce((sum, entry) => sum + entry.normalizedHypothesisWeight, 0),
    ).toBeCloseTo(10 / 11);
    expect(
      balanced
        .filter((entry) => entry.providerFamily === "WHISPER")
        .reduce((sum, entry) => sum + entry.normalizedHypothesisWeight, 0),
    ).toBeCloseTo(0.5);
    expect(
      balanced.find((entry) => entry.providerFamily === "CURRENT")
        ?.normalizedHypothesisWeight,
    ).toBe(0);
  });
  test("same-group duplicated windows do not increase correlation-aware surface support", () => {
    const candidates = [
      candidate("a", "赤", "WHISPER", "primary"),
      candidate("b", "青", "WHISPER", "core"),
      candidate("r", "青", "REAZON"),
    ];
    const duplicated = [
      ...candidates,
      candidate("a-copy", "赤", "WHISPER", "primary"),
    ];
    const support = (rows: C61CandidateText[]) =>
      c61HypothesisWeights(rows, "R2")
        .filter((entry) => entry.correlationGroupId === "primary")
        .reduce((sum, entry) => sum + entry.normalizedHypothesisWeight, 0);
    expect(support(duplicated)).toBe(support(candidates));
  });
  test("Reazon exact/context windows retain one family mass", () => {
    const rows = c61HypothesisWeights(
      [
        candidate("w", "赤", "WHISPER"),
        candidate("r1", "青", "REAZON", "exact"),
        candidate("r2", "青", "REAZON", "context"),
      ],
      "R2",
    );
    expect(
      rows
        .filter((row) => row.providerFamily === "REAZON")
        .reduce((sum, row) => sum + row.normalizedHypothesisWeight, 0),
    ).toBeCloseTo(0.5);
  });
  test("stability multipliers are bounded and weights sum to one", () => {
    const rows = c61HypothesisWeights(novelCandidates(), "R3");
    expect(
      rows.every(
        (row) =>
          row.stabilityMultiplier >= 0.75 && row.stabilityMultiplier <= 1,
      ),
    ).toBe(true);
    expect(
      rows.reduce((sum, row) => sum + row.normalizedHypothesisWeight, 0),
    ).toBeCloseTo(1);
  });
  test("profile freeze is strict, deterministic and contains all requested profiles/ablations", () => {
    const freeze = freezeC61Profiles(hash("alignment"));
    expect(c61ConsensusProfileFreezeSchema.parse(freeze)).toEqual(freeze);
    expect(freeze.profiles.map((profile) => profile.profileId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `P${index}`),
    );
    expect(freeze.switchAblations).toEqual([0, 1, 2, 3, null]);
    expect(freeze.supplementalRoverVariants).toEqual(["R3"]);
    expect(freeze.alignmentAblations.map((entry) => entry.profileId)).toEqual([
      "ALIGN_PRONUNCIATION_R2",
      "ALIGN_CENTER_CURRENT_R2",
      "ALIGN_CENTER_MEDOID_R2",
    ]);
    expect(freeze.evaluationPolicy.thresholds.materialTextErrorCer).toBe(0.45);
    expect(freezeC61Profiles(hash("alignment"))).toEqual(freeze);
    expect(
      c61ConsensusProfileFreezeSchema.safeParse({ ...freeze, goldWeight: 1 })
        .success,
    ).toBe(false);
  });
});
describe("C6.1 ROVER slot voting with supported paths", () => {
  test("raw majority is biased while balanced tie explicitly preserves current", () => {
    const fixture = event([
      ...Array.from({ length: 10 }, (_, index) =>
        candidate(`w${index}`, "赤", "WHISPER"),
      ),
      candidate("r", "青", "REAZON"),
      candidate("current", "青", "CURRENT"),
    ]);
    expect(
      decodeRover({ ...fixture, variant: "R0" }).selectedPath?.displayText,
    ).toBe("赤");
    const balanced = decodeRover({ ...fixture, variant: "R1" });
    expect(balanced.outcome).toBe("ABSTAIN_AMBIGUOUS");
    expect(balanced.selectedPath?.displayText).toBe("青");
    expect(balanced.slotDecisions[0]?.status).toBe("TIE");
    expect(c61RoverResultSchema.parse(balanced)).toEqual(balanced);
  });
  test("Whisper prefix and Reazon suffix produce a genuinely supported novel span path", () => {
    const fixture = event(novelCandidates());
    const result = decodeRover({ ...fixture, variant: "R2" });
    expect(result.selectedPath?.displayText).toBe("あかう");
    expect(result.outcome).toBe("SELECT_LEGAL_CONSENSUS_PATH");
    expect(result.selectedPath?.pathKind).toBe("NOVEL_LEGAL_PATH");
    expect(result.selectedPath?.providerSwitchCount).toBe(1);
    expect(
      validateC61Path(
        fixture.lattice,
        c61RequiredDecoderValue(result.selectedPath).nodeIds,
      ).valid,
    ).toBe(true);
  });
  test("existing-only mode cannot emit a novel slot winner path", () => {
    const result = decodeRover({
      ...event(novelCandidates()),
      variant: "R2",
      outputMode: "EXISTING_CANDIDATE_ONLY",
    });
    expect(result.outcome).toBe("BLOCKED_UNSAFE");
    expect(result.selectedPath?.displayText).toBe("いかえ");
  });
  test("all ROVER variants have deterministic candidate input-order identity", () => {
    const fixture = event(novelCandidates());
    for (const variant of ["R0", "R1", "R2", "R3", "R4", "R5"] as const)
      expect(decodeRover({ ...fixture, variant }).semanticHash).toBe(
        decodeRover({
          ...fixture,
          candidates: [...fixture.candidates].reverse(),
          variant,
        }).semanticHash,
      );
  });
  test("equal pronunciation aggregates evidence without inventing Kanji or resolving surface ambiguity", () => {
    const w = {
      ...candidate("w", "橋", "WHISPER"),
      pronunciationText: "ハシ",
      pronunciationUnits: [
        { unitIndex: 0, reading: "ハシ", evidenceId: "machine-reading-w" },
      ],
    };
    const r = {
      ...candidate("r", "箸", "REAZON"),
      pronunciationText: "ハシ",
      pronunciationUnits: [
        { unitIndex: 0, reading: "ハシ", evidenceId: "machine-reading-r" },
      ],
    };
    const result = decodeRover({
      ...event([
        w,
        r,
        {
          ...candidate("current", "橋", "CURRENT"),
          pronunciationUnits: w.pronunciationUnits,
        },
      ]),
      variant: "R4",
    });
    expect(result.slotDecisions[0]?.winnerNodeIds).toHaveLength(2);
    expect(result.outcome).toBe("ABSTAIN_AMBIGUOUS");
    expect(["橋", "箸"]).toContain(result.selectedPath?.displayText);
  });
  test("cached CTC only boundedly reweights exact model/audio/candidate identities", () => {
    const w = candidate("w", "赤", "WHISPER"),
      r = candidate("r", "青", "REAZON");
    const evidence = [acoustic(w, 2), acoustic(r, 1)];
    const result = decodeRover({
      ...event([w, r, candidate("current", "赤", "CURRENT")]),
      variant: "R5",
      acousticEvidence: evidence,
    });
    expect(result.selectedPath?.displayText).toBe("青");
    expect(
      result.candidateSupport.filter(
        (row) => row.acousticStatus === "EXACT_CACHE_MATCH",
      ),
    ).toHaveLength(2);
    expect(
      result.candidateSupport.every(
        (row) => row.acousticMultiplier >= 0.9 && row.acousticMultiplier <= 1.1,
      ),
    ).toBe(true);
  });
  test("mismatched or absent CTC cache remains unknown rather than comparing raw ASR scores", () => {
    const w = candidate("w", "赤", "WHISPER"),
      r = candidate("r", "青", "REAZON");
    const wrong = acoustic(w, 0);
    wrong.cachedIdentity.audioSha256 = hash("other-audio");
    expect(c61AcousticCacheMatches(w, wrong)).toBe(false);
    const result = decodeRover({
      ...event([w, r, candidate("current", "赤", "CURRENT")]),
      variant: "R5",
      acousticEvidence: [wrong, acoustic(r, 1)],
    });
    expect(result.outcome).toBe("ABSTAIN_AMBIGUOUS");
    expect(
      result.candidateSupport.every((row) => row.acousticStatus === "UNKNOWN"),
    ).toBe(true);
  });
});
describe("C6.1 expected-risk MBR and bounded legal search", () => {
  test("normalized edit distance is grapheme-safe, symmetric and lower-is-better", () => {
    expect(c61NormalizedEditDistance("あか", "あか")).toBe(0);
    expect(c61NormalizedEditDistance("あか", "あう")).toBe(0.5);
    expect(c61NormalizedEditDistance("", "")).toBe(0);
    expect(c61NormalizedEditDistance("👩‍💻", "👩‍🔬")).toBe(1);
    expect(c61NormalizedEditDistance("はいはい", "はい")).toBe(0.5);
  });
  test("candidate risk equals the explicit weighted real-hypothesis distance", () => {
    const candidates = [
      candidate("w", "あか", "WHISPER"),
      candidate("r", "あう", "REAZON"),
    ];
    const weights = c61HypothesisWeights(candidates);
    expect(
      c61ExpectedRisk(
        c61RequiredDecoderValue(candidates[0]),
        candidates,
        weights,
        "GRAPHEME",
      ).expectedNormalizedDistance,
    ).toBe(0.25);
    expect(
      c61ExpectedRisk(
        c61RequiredDecoderValue(candidates[0]),
        candidates,
        weights,
        "PRONUNCIATION",
      ).pronunciationCoverage,
    ).toBe(0);
  });
  test("candidate MBR cannot invent a synthetic join and abstains on low margin", () => {
    const candidates = [
      candidate("w", "あか", "WHISPER"),
      candidate("r", "あう", "REAZON"),
      candidate("current", "あか", "CURRENT"),
    ];
    const result = candidateMbr({ candidates, currentCandidateId: "current" });
    expect(result.outcome).toBe("ABSTAIN_AMBIGUOUS");
    expect(result.selectedCandidateId).toBe("current");
    expect(c61CandidateMbrResultSchema.parse(result)).toEqual(result);
  });
  test("candidate MBR outperforms raw-window ROVER on a correlated-error synthetic control", () => {
    const w = {
      ...candidate("w", "誤", "WHISPER"),
      rawVoteCandidateIds: ["w1", "w2", "w3"],
    };
    const fixture = event([
      w,
      candidate("r", "正", "REAZON"),
      candidate("current", "正", "CURRENT"),
    ]);
    const raw = decodeRover({ ...fixture, variant: "R0" });
    const mbr = candidateMbr(fixture);
    expect(raw.selectedPath?.displayText).toBe("誤");
    const chosen = fixture.candidates.find(
      (entry) => entry.candidateId === mbr.selectedCandidateId,
    );
    expect(chosen?.displayText).toBe("正");
    expect(
      c61NormalizedEditDistance(chosen?.displayText ?? "", "正"),
    ).toBeLessThan(
      c61NormalizedEditDistance(raw.selectedPath?.displayText ?? "", "正"),
    );
  });
  test("preferred candidate surface is restored without relabelling it as Current", () => {
    const fixture = event([
      candidate("current", "Ａ", "CURRENT"),
      { ...candidate("w", "A", "WHISPER"), normalizedText: "A" },
    ]);
    const path = c61RequiredDecoderValue(
      fixture.lattice.candidatePaths.find((entry) => entry.candidateId === "w"),
    );
    const selected = materializeC61Path(
      fixture.lattice,
      path.nodeIds,
      fixture.candidates,
      "current",
      2,
      "w",
    );
    expect(selected?.displayText).toBe("A");
    expect(selected?.pathKind).toBe("EXISTING_CANDIDATE_PATH");
  });
  test("single-hypothesis controls without Current still return a supported no-action path", () => {
    const fixture = event([candidate("w", "はい", "WHISPER")]);
    const rover = decodeRover({ ...fixture, variant: "R2" });
    const mbr = latticeMbr(fixture);
    expect(rover.outcome).toBe("SINGLE_HYPOTHESIS_NO_ACTION");
    expect(rover.selectedPath?.displayText).toBe("はい");
    expect(mbr.selectedPath?.pathLegal).toBe(true);
  });
  test("candidate MBR chooses the existing medoid when repeated risks have a clear minimum", () => {
    const candidates = [
      candidate("w1", "あかう", "WHISPER"),
      candidate("w2", "あかえ", "WHISPER"),
      candidate("r1", "あかう", "REAZON"),
      candidate("r2", "いかう", "REAZON"),
      candidate("current", "いかえ", "CURRENT"),
    ];
    const result = candidateMbr({ candidates, currentCandidateId: "current" });
    expect(
      candidates.find(
        (entry) => entry.candidateId === result.selectedCandidateId,
      )?.displayText,
    ).toBe("あかう");
    expect(result.pathRiskMargin).toBeGreaterThan(0.01);
  });
  test("exact enumeration and MBR discover a novel legal path beyond all complete candidates", () => {
    const fixture = event(novelCandidates());
    const result = latticeMbr({
      ...fixture,
      searchOptions: { beamWidth: 512, maxPaths: 512 },
    });
    expect(result.search.algorithm).toBe("EXACT_LATTICE_MBR");
    expect(result.selectedPath?.displayText).toBe("あかう");
    expect(result.selectedPath?.pathKind).toBe("NOVEL_LEGAL_PATH");
    expect(
      c61RequiredDecoderValue(result.nBestPaths[0]).expectedNormalizedDistance,
    ).toBeLessThan(
      Math.min(
        ...candidateMbr({ ...fixture }).candidateRisks.map(
          (row) => row.expectedNormalizedDistance,
        ),
      ),
    );
    expect(c61LatticeMbrResultSchema.parse(result)).toEqual(result);
  });
  test("pruned beam is labelled approximate, never exact", () => {
    const result = latticeMbr({
      ...event(novelCandidates()),
      searchOptions: { beamWidth: 1, maxPaths: 2 },
    });
    expect(result.search.algorithm).toBe("APPROXIMATE_LATTICE_MBR");
    expect(result.search.exhaustiveWithinConstraints).toBe(false);
    expect(
      result.search.beamPrunedStateCount + result.search.maxPathsTruncatedCount,
    ).toBeGreaterThan(0);
  });
  test("switch-zero forbids cross-provider novel path but switch-one permits it", () => {
    const fixture = event(novelCandidates());
    const zero = enumerateLegalPaths(fixture.lattice, fixture.candidates, {
      maxProviderSwitches: 0,
      beamWidth: 512,
      maxPaths: 512,
    });
    const one = enumerateLegalPaths(fixture.lattice, fixture.candidates, {
      maxProviderSwitches: 1,
      beamWidth: 512,
      maxPaths: 512,
    });
    const text = (paths: string[][], limit: number) =>
      paths.map(
        (path) =>
          materializeC61Path(
            fixture.lattice,
            path,
            fixture.candidates,
            fixture.currentCandidateId,
            limit,
          )?.displayText,
      );
    expect(text(zero.paths, 0)).not.toContain("あかう");
    expect(text(one.paths, 1)).toContain("あかう");
    for (const limit of [0, 1, 2, 3, null])
      expect(
        enumerateLegalPaths(fixture.lattice, fixture.candidates, {
          maxProviderSwitches: limit,
        }).search.maxProviderSwitches,
      ).toBe(limit);
  });
  test("without a shared supported anchor search cannot form character soup", () => {
    const fixture = event([
      candidate("w", "あい", "WHISPER"),
      candidate("r", "うえ", "REAZON"),
    ]);
    const result = enumerateLegalPaths(fixture.lattice, fixture.candidates);
    const surfaces = result.paths.map(
      (path) =>
        materializeC61Path(fixture.lattice, path, fixture.candidates, null)
          ?.displayText,
    );
    expect(surfaces.sort()).toEqual(["あい", "うえ"]);
  });
  test("epsilon deletion and repeated tokens remain legal and retain provenance", () => {
    const fixture = event([
      candidate("w", "はいはい", "WHISPER"),
      candidate("r", "はい", "REAZON"),
      candidate("current", "はいはい", "CURRENT"),
    ]);
    expect(fixture.lattice.nodes.some((node) => node.kind === "EPSILON")).toBe(
      true,
    );
    for (const path of enumerateLegalPaths(fixture.lattice, fixture.candidates)
      .paths)
      expect(validateC61Path(fixture.lattice, path).valid).toBe(true);
    expect(
      decodeRover({ ...fixture, variant: "R2" }).selectedPath?.displayText,
    ).toBe("はいはい");
  });
  test("all MBR distances and results are candidate-order invariant", () => {
    const fixture = event(novelCandidates());
    for (const distanceMethod of [
      "GRAPHEME",
      "PRONUNCIATION",
      "COMBINED",
    ] as const) {
      expect(candidateMbr({ ...fixture, distanceMethod }).semanticHash).toBe(
        candidateMbr({
          ...fixture,
          distanceMethod,
          candidates: [...fixture.candidates].reverse(),
        }).semanticHash,
      );
      expect(latticeMbr({ ...fixture, distanceMethod }).semanticHash).toBe(
        latticeMbr({
          ...fixture,
          distanceMethod,
          candidates: [...fixture.candidates].reverse(),
        }).semanticHash,
      );
    }
  });
});
