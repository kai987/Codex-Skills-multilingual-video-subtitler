import { describe, expect, it } from "vitest";
import {
  c61CandidateTextSchema,
  c61TokenLatticeSchema,
  type C61CandidateText,
  type C61TokenLattice,
} from "../packages/shared/src/c6-1-alignment-schemas.js";
import {
  buildC61Representation,
  buildC61Representations,
  c61Graphemes,
  c61Require,
  normalizeC61Japanese,
  normalizeC61Pronunciation,
} from "../packages/video-subtitler/src/consensus/japanese-text-representation.js";
import { alignC61Pair } from "../packages/video-subtitler/src/consensus/pairwise-sequence-alignment.js";
import { alignC61Multiple } from "../packages/video-subtitler/src/consensus/multiple-sequence-alignment.js";
import { buildC61TokenLattice } from "../packages/video-subtitler/src/consensus/token-lattice.js";
import { buildC61ConfusionNetwork } from "../packages/video-subtitler/src/consensus/confusion-network.js";
import { buildC61ConsensusSpans } from "../packages/video-subtitler/src/consensus/consensus-span.js";
import {
  advanceC61PathStates,
  validateC61Path,
} from "../packages/video-subtitler/src/consensus/legal-path-validator.js";
import { restoreC61Surface } from "../packages/video-subtitler/src/consensus/surface-restoration.js";

function candidate(
  candidateId: string,
  displayText: string,
  providerFamily: C61CandidateText["providerFamily"] = "WHISPER",
  extra: Partial<C61CandidateText> = {},
): C61CandidateText {
  return {
    candidateId,
    eventId: "event-1",
    providerFamily,
    displayText,
    normalizedText: normalizeC61Japanese(displayText),
    pronunciationText: null,
    correlationGroupId: `${providerFamily}-family`,
    provenanceHash: "a".repeat(64),
    sourceInterval: { start: 1, end: 5 },
    ...extra,
  };
}

function lattice(candidates: C61CandidateText[]): C61TokenLattice {
  const representations = buildC61Representations(candidates);
  return buildC61TokenLattice(
    alignC61Multiple(representations),
    representations,
  );
}

function pathFor(graph: C61TokenLattice, candidateId: string): string[] {
  return c61Require(
    graph.candidatePaths.find((path) => path.candidateId === candidateId),
  ).nodeIds;
}

function switchedPath(
  graph: C61TokenLattice,
  left: string,
  right: string,
  sharedSurface: string,
): string[] {
  const leftPath = pathFor(graph, left);
  const rightPath = pathFor(graph, right);
  const anchor = leftPath.findIndex((nodeId) =>
    graph.nodes
      .find((node) => node.nodeId === nodeId)
      ?.displaySurfaces.includes(sharedSurface),
  );
  expect(anchor).toBeGreaterThan(0);
  expect(leftPath[anchor]).toBe(rightPath[anchor]);
  return [...leftPath.slice(0, anchor + 1), ...rightPath.slice(anchor + 1)];
}

describe("C6.1 Japanese multi-view representation", () => {
  it("normalizes NFKC and half-width kana while retaining the exact candidate surface", () => {
    const representation = buildC61Representation(
      candidate("a", "Ａ ｶﾞｯﾂ…「東京」、１２"),
    );
    expect(representation.normalizedText).toBe("A ガッツ...「東京」、12");
    expect(
      representation.units.map((unit) => unit.displaySurface).join(""),
    ).toBe(representation.candidate.displayText);
    expect(
      representation.units.find((unit) => unit.displaySurface === "ｶﾞ")
        ?.normalizedForm,
    ).toBe("ガ");
  });
  it("separates ASS newline, whitespace and punctuation without lexical stripping", () => {
    const representation = buildC61Representation(
      candidate("a", "はい\\N  はい\n「々」"),
    );
    expect(representation.normalizedText).toBe("はい はい 「々」");
    expect(
      representation.units.filter((unit) => unit.kind === "WHITESPACE").length,
    ).toBe(3);
    expect(
      representation.units.map((unit) => unit.displaySurface).join(""),
    ).toBe("はい\\N  はい\n「々」");
  });
  it("retains small kana, sokuon, long vowel and iteration marks", () => {
    expect(normalizeC61Pronunciation("キャット・コーヒー・時々")).toBe(
      "きゃっと・こーひー・時々",
    );
    expect(normalizeC61Pronunciation("きや")).not.toBe(
      normalizeC61Pronunciation("きゃ"),
    );
    expect(normalizeC61Pronunciation("コー")).not.toBe(
      normalizeC61Pronunciation("コ"),
    );
  });
  it("keeps astral and combining graphemes whole", () => {
    const representation = buildC61Representation(
      candidate("a", "𠮷か\u3099👩‍🔬"),
    );
    expect(representation.units).toHaveLength(3);
    expect(c61Graphemes("👩‍🔬")).toHaveLength(1);
    expect(representation.units[1]?.normalizedForm).toBe("が");
  });
  it("does not manufacture kanji pronunciation from whole-string reading", () => {
    const representation = buildC61Representation(
      candidate("a", "橋", "WHISPER", { pronunciationText: "ハシ" }),
    );
    expect(representation.pronunciationText).toBe("はし");
    expect(representation.units[0]?.pronunciationForm).toBeNull();
  });
  it("accepts exact machine reading projection and rejects invalid or duplicated offsets", () => {
    expect(
      buildC61Representation(
        candidate("a", "橋", "WHISPER", {
          pronunciationUnits: [
            { unitIndex: 0, reading: "ハシ", evidenceId: "machine-projection" },
          ],
        }),
      ).units[0]?.pronunciationForm,
    ).toBe("はし");
    expect(() =>
      buildC61Representation(
        candidate("a", "橋", "WHISPER", {
          pronunciationUnits: [
            { unitIndex: 1, reading: "ハシ", evidenceId: "machine-projection" },
          ],
        }),
      ),
    ).toThrow("PROJECTION");
    expect(() =>
      buildC61Representation(
        candidate("a", "橋", "WHISPER", {
          pronunciationUnits: [
            { unitIndex: 0, reading: "ハシ", evidenceId: "a" },
            { unitIndex: 0, reading: "ハシ", evidenceId: "b" },
          ],
        }),
      ),
    ).toThrow("PROJECTION");
  });
  it("has strict candidate schemas and no hidden Gold fields", () => {
    expect(
      c61CandidateTextSchema.safeParse({
        ...candidate("a", "音"),
        goldText: "音",
      }).success,
    ).toBe(false);
    expect(() =>
      buildC61Representations([candidate("a", "音"), candidate("a", "声")]),
    ).toThrow("DUPLICATE");
  });
});

describe("C6.1 deterministic pairwise and multiple sequence alignment", () => {
  const pair = (left: string, right: string, pronunciationAware = false) =>
    alignC61Pair(
      buildC61Representation(candidate("left", left)),
      buildC61Representation(candidate("right", right, "REAZON")),
      { pronunciationAware },
    );
  it.each([
    ["猫", "猫", "EXACT"],
    ["Ａ", "A", "NORMALIZED_EQUIVALENT"],
    ["猫", "犬", "SUBSTITUTION"],
    ["猫", "猫声", "INSERTION"],
    ["猫声", "猫", "DELETION"],
    ["ハ", "は", "PRONUNCIATION_EQUIVALENT"],
  ])("aligns %s and %s with %s", (left, right, operation) => {
    expect(pair(left, right, true).editOperations).toContain(operation);
  });
  it("only enables pronunciation equivalence under the explicit profile", () => {
    expect(pair("ハ", "は").editOperations).toEqual(["SUBSTITUTION"]);
    expect(pair("ハ", "は", true).weightedCost).toBeLessThan(
      pair("ハ", "は").weightedCost,
    );
  });
  it("keeps both copies of repeated phrases and monotonic input positions", () => {
    const aligned = pair("はいはい", "はい");
    expect(
      aligned.alignedUnits.flatMap((unit) =>
        unit.leftIndex === null ? [] : [unit.leftIndex],
      ),
    ).toEqual([0, 1, 2, 3]);
    expect(
      aligned.alignedUnits.flatMap((unit) =>
        unit.rightIndex === null ? [] : [unit.rightIndex],
      ),
    ).toEqual([0, 1]);
    expect(
      aligned.editOperations.filter((op) => op === "DELETION"),
    ).toHaveLength(2);
    expect(pair("はいはい", "はい").semanticHash).toBe(aligned.semanticHash);
  });
  it("does not align different events", () => {
    expect(() =>
      alignC61Pair(
        buildC61Representation(candidate("a", "猫")),
        buildC61Representation(
          candidate("b", "猫", "REAZON", { eventId: "elsewhere" }),
        ),
      ),
    ).toThrow("CROSS_EVENT");
  });
  it("is input-order invariant for all three center profiles, gaps and duplicate hypotheses", () => {
    const representations = buildC61Representations([
      candidate("c", "前共後", "CURRENT"),
      candidate("a", "前新共後"),
      candidate("b", "前共長後", "REAZON"),
      candidate("d", "前共長後", "REAZON"),
    ]);
    for (const profile of [
      "CENTER_CURRENT",
      "CENTER_MEDOID",
      "CENTER_PROVIDER_BALANCED_MEDOID",
    ] as const) {
      expect(alignC61Multiple(representations, profile).semanticHash).toBe(
        alignC61Multiple([...representations].reverse(), profile).semanticHash,
      );
      const aligned = alignC61Multiple(representations, profile);
      for (const row of aligned.rows) {
        expect(row.unitIndices.filter((index) => index !== null)).toEqual(
          c61Require(
            representations.find(
              (rep) => rep.candidate.candidateId === row.candidateId,
            ),
          ).units.map((unit) => unit.unitIndex),
        );
        expect(row.unitIndices).toHaveLength(aligned.slotCount);
      }
    }
  });
  it("provider-balanced medoid prevents same-provider windows deciding the center", () => {
    const representations = buildC61Representations([
      ...Array.from({ length: 10 }, (_, index) =>
        candidate(`wrong-${index}`, "誤誤"),
      ),
      candidate("right-w", "正解"),
      candidate("right-r", "正解", "REAZON"),
      candidate("current", "誤誤", "CURRENT"),
    ]);
    const unbalanced = alignC61Multiple(representations, "CENTER_MEDOID");
    const balanced = alignC61Multiple(representations);
    expect(
      c61Require(
        representations.find(
          (rep) => rep.candidate.candidateId === unbalanced.centerCandidateId,
        ),
      ).candidate.displayText,
    ).toBe("誤誤");
    expect(
      c61Require(
        representations.find(
          (rep) => rep.candidate.candidateId === balanced.centerCandidateId,
        ),
      ).candidate.displayText,
    ).toBe("正解");
    expect(
      alignC61Multiple(representations, "CENTER_CURRENT").centerCandidateId,
    ).toBe("current");
  });
  it("requires nonempty events and supports an empty text control safely", () => {
    expect(() => alignC61Multiple([])).toThrow("EMPTY_EVENT");
    const graph = lattice([candidate("blank", "", "CURRENT")]);
    expect(validateC61Path(graph, pathFor(graph, "blank")).valid).toBe(true);
    expect(
      restoreC61Surface(graph, pathFor(graph, "blank"), "blank").displayText,
    ).toBe("");
  });
});

describe("C6.1 candidate-supported lattice, spans and surface restoration", () => {
  it("retains every candidate path, exact real surface, adjacency and provenance", () => {
    const input = [
      candidate("current", "前共後", "CURRENT"),
      candidate("w", "前新共後"),
      candidate("r", "前共長後", "REAZON"),
    ];
    const graph = lattice(input);
    expect(c61TokenLatticeSchema.safeParse(graph).success).toBe(true);
    for (const value of input) {
      expect(
        validateC61Path(graph, pathFor(graph, value.candidateId)).valid,
      ).toBe(true);
      expect(
        restoreC61Surface(
          graph,
          pathFor(graph, value.candidateId),
          value.candidateId,
        ).displayText,
      ).toBe(value.displayText);
    }
    expect(
      graph.nodes.every((node) => node.candidateProvenance.length > 0),
    ).toBe(true);
    expect(
      graph.edges.every((edge) => edge.supportingCandidateIds.length > 0),
    ).toBe(true);
    expect(
      graph.nodes
        .filter((node) => node.kind === "EPSILON")
        .every(
          (node) =>
            node.displaySurfaces.length === 0 &&
            node.normalizedForm === null &&
            !node.switchAllowed,
        ),
    ).toBe(true);
  });
  it("builds a novel supported correct prefix/suffix consensus at a common anchor", () => {
    const graph = lattice([
      candidate("w", "正前共誤後"),
      candidate("r", "誤前共正後", "REAZON"),
    ]);
    const nodes = switchedPath(graph, "w", "r", "共");
    const validation = validateC61Path(graph, nodes);
    expect(validation.valid).toBe(true);
    expect(validation.candidateSwitchCount).toBe(1);
    expect(validation.providerSwitchCount).toBe(1);
    expect(restoreC61Surface(graph, nodes).displayText).toBe("正前共正後");
    expect(
      validateC61Path(graph, nodes, { maxProviderSwitches: 0 }).valid,
    ).toBe(false);
    expect(
      validateC61Path(graph, nodes, { maxProviderSwitches: 1 }).valid,
    ).toBe(true);
  });
  it("records within-provider chain switches separately from independent provider transitions", () => {
    const graph = lattice([
      candidate("w1", "正前共誤後"),
      candidate("w2", "誤前共正後"),
    ]);
    const validation = validateC61Path(
      graph,
      switchedPath(graph, "w1", "w2", "共"),
    );
    expect(validation.valid).toBe(true);
    expect(validation.candidateSwitchCount).toBe(1);
    expect(validation.providerSwitchCount).toBe(0);
  });
  it("rejects a novel unsupported character soup adjacency", () => {
    const graph = lattice([
      candidate("w", "甲乙"),
      candidate("r", "丙丁", "REAZON"),
    ]);
    const left = pathFor(graph, "w");
    const right = pathFor(graph, "r");
    const bad = [
      c61Require(left[0]),
      c61Require(left[1]),
      c61Require(right[2]),
      c61Require(left[3]),
    ];
    expect(
      validateC61Path(graph, bad).violations.unsupportedAdjacencyCount,
    ).toBeGreaterThan(0);
    expect(() => restoreC61Surface(graph, bad)).toThrow(
      "UNSAFE_CONSENSUS_PATH_REJECTED",
    );
  });
  it("rejects normalized surface synthetic bridges and preserves actual candidate orthography", () => {
    const graph = lattice([
      candidate("w", "甲Ａ乙"),
      candidate("r", "丙A丁", "REAZON"),
    ]);
    const nodes = switchedPath(graph, "w", "r", "Ａ");
    expect(validateC61Path(graph, nodes).valid).toBe(false);
    expect(restoreC61Surface(graph, pathFor(graph, "w"), "w").displayText).toBe(
      "甲Ａ乙",
    );
  });
  it("does not synthesize kanji and marks normalization-only restoration separately", () => {
    const graph = lattice([
      candidate("current", "Ａ", "CURRENT"),
      candidate("r", "A", "REAZON"),
    ]);
    const restored = restoreC61Surface(graph, pathFor(graph, "r"), "r");
    expect(restored.displayText).toBe("A");
    expect(restored.orthographyOnly).toBe(true);
    expect(
      restored.tokenProvenance.every((token) =>
        graph.nodes.some((node) =>
          node.candidateProvenance.some(
            (p) => p.displaySurface === token.outputSurface,
          ),
        ),
      ),
    ).toBe(true);
    const kanaGraph = lattice([
      candidate("w", "はし"),
      candidate("r", "ハシ", "REAZON"),
    ]);
    expect(
      restoreC61Surface(kanaGraph, pathFor(kanaGraph, "w")).displayText,
    ).not.toMatch(/[橋箸]/u);
  });
  it("keeps pronunciation-equivalent homophones distinct lexical nodes", () => {
    const graph = lattice([
      candidate("w", "橋", "WHISPER", {
        pronunciationUnits: [
          { unitIndex: 0, reading: "ハシ", evidenceId: "machine-w" },
        ],
      }),
      candidate("r", "箸", "REAZON", {
        pronunciationUnits: [
          { unitIndex: 0, reading: "ハシ", evidenceId: "machine-r" },
        ],
      }),
    ]);
    const slot = buildC61ConfusionNetwork(graph).slots[0];
    expect(slot?.ambiguityStatus).toBe("PRONUNCIATION_EQUIVALENT");
    expect(slot?.alternatives).toHaveLength(2);
  });
  it("uses explicit epsilon alternatives and excludes CURRENT from independent support counts", () => {
    const graph = lattice([
      candidate("c", "前後", "CURRENT"),
      candidate("w", "前後"),
      candidate("r", "前声後", "REAZON"),
    ]);
    const network = buildC61ConfusionNetwork(graph);
    expect(network.slots.some((slot) => slot.epsilonAlternative !== null)).toBe(
      true,
    );
    expect(network.slots.every((slot) => slot.providerSupportCount === 2)).toBe(
      true,
    );
    expect(
      network.slots.every((slot) => slot.correlationGroupSupportCount === 2),
    ).toBe(true);
  });
  it("confusion slots retain all graph constraints and normalized entropy", () => {
    const graph = lattice([
      candidate("a", "共甲"),
      candidate("b", "共乙", "REAZON"),
    ]);
    const network = buildC61ConfusionNetwork(graph);
    expect(network.slots[0]?.normalizedEntropy).toBe(0);
    expect(network.slots[1]?.normalizedEntropy).toBe(1);
    expect(
      network.slots[1]?.alternatives.every(
        (alternative) =>
          alternative.incomingEdges.length > 0 &&
          alternative.outgoingEdges.length > 0,
      ),
    ).toBe(true);
  });
  it("aggregates contiguous ambiguity into actual candidate spans, not slot products", () => {
    const graph = lattice([
      candidate("c", "共甲乙末", "CURRENT"),
      candidate("r", "共丙丁末", "REAZON"),
    ]);
    const spans = buildC61ConsensusSpans(graph, "c");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.currentSurface).toBe("甲乙");
    expect(
      spans[0]?.alternatives
        .map((alternative) => alternative.displaySurface)
        .sort(),
    ).toEqual(["丙丁", "甲乙"].sort());
    expect(
      spans[0]?.alternatives.some(
        (alternative) => alternative.displaySurface === "甲丁",
      ),
    ).toBe(false);
  });
  it("rejects missing provenance, cycles, cross-events and non-monotonic paths", () => {
    const original = lattice([
      candidate("w", "前共後"),
      candidate("r", "前共長後", "REAZON"),
    ]);
    const path = pathFor(original, "w");
    const missing = structuredClone(original);
    c61Require(
      missing.nodes.find((node) => node.nodeId === path[1]),
    ).candidateProvenance = [];
    expect(
      validateC61Path(missing, path).violations.candidateProvenanceMissingCount,
    ).toBe(1);
    const other = structuredClone(original);
    c61Require(other.nodes.find((node) => node.nodeId === path[1])).eventId =
      "event-2";
    expect(validateC61Path(other, path).violations.crossEventTokenCount).toBe(
      1,
    );
    expect(
      validateC61Path(original, [
        c61Require(path[0]),
        c61Require(path[1]),
        c61Require(path[1]),
        ...path.slice(2),
      ]).violations.pathCycleCount,
    ).toBe(1);
    expect(
      validateC61Path(original, [c61Require(path[0]), ...path.slice(2)])
        .violations.nonMonotonicPathCount,
    ).toBe(1);
    expect(
      validateC61Path(original, [
        c61Require(path[0]),
        "invented",
        ...path.slice(2),
      ]).violations.unsupportedTokenCount,
    ).toBe(1);
  });
  it("uses the same legal automaton for candidate enumeration and validation", () => {
    const graph = lattice([
      candidate("w", "正前共誤後"),
      candidate("r", "誤前共正後", "REAZON"),
    ]);
    const path = switchedPath(graph, "w", "r", "共");
    let states: Parameters<typeof advanceC61PathStates>[3] = [];
    for (let index = 1; index < path.length; index += 1)
      states = advanceC61PathStates(
        graph,
        c61Require(path[index - 1]),
        c61Require(path[index]),
        states,
      );
    expect(states.length).toBeGreaterThan(0);
    expect(Math.min(...states.map((state) => state.providerSwitchCount))).toBe(
      validateC61Path(graph, path).providerSwitchCount,
    );
  });
  it("rejects unsupported fabricated edges even if their declared support is nonempty", () => {
    const graph = lattice([
      candidate("w", "甲乙"),
      candidate("r", "丙丁", "REAZON"),
    ]);
    const left = pathFor(graph, "w");
    const right = pathFor(graph, "r");
    graph.edges.push({
      edgeId: "fabricated",
      fromNode: c61Require(left[1]),
      toNode: c61Require(right[2]),
      supportingCandidateIds: ["w"],
      providerFamilies: ["WHISPER"],
      correlationGroups: ["WHISPER-family"],
      observedAdjacency: true,
      semanticHash: "b".repeat(64),
    });
    expect(
      validateC61Path(graph, [
        c61Require(left[0]),
        c61Require(left[1]),
        c61Require(right[2]),
        c61Require(left[3]),
      ]).valid,
    ).toBe(false);
  });
});
