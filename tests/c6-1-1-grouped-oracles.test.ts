import { describe, expect, it } from "vitest";
import { c611GroupedOracleSchema, type C611EvaluationCue } from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { buildC611FixedBaselineAlignmentMap } from "../packages/video-subtitler/src/consensus/fixed-baseline-alignment-map.js";
import {
  C611_GROUPED_ORACLE_POLICY,
  evaluateC611GroupedOracles,
  type C611GroupedOracleInput,
  type C611OracleSelection,
} from "../packages/video-subtitler/src/consensus/selective-mbr-oracles.js";

const barrier = {
  machineFreezeHash: hash("synthetic-oracle-freeze"),
  machineFrozenAt: "2026-01-01T00:00:00.000Z",
  goldFirstReadAt: "2026-01-01T00:00:01.000Z",
};
const cue = (id: string, text: string, start = 0, end = 2) => ({
  id,
  text,
  start,
  end,
});
function fixture(
  baselineCues: C611EvaluationCue[] = [cue("m", "あい")],
  goldCues: C611EvaluationCue[] = [cue("g", "あう")],
  events = [{ eventId: "e", finalCueIds: ["m"] }],
): C611GroupedOracleInput {
  const fixedMap = buildC611FixedBaselineAlignmentMap({
    baselineCues,
    goldCues,
    eventBindings: events,
    barrier,
  });
  return {
    fixedMap,
    baselineCues,
    goldCues,
    frozenAlternativeOptions: events.map(({ eventId }) => ({
      eventId,
      alternatives: [{ candidateId: `${eventId}-candidate` }],
    })),
    primaryProposals: events.map(({ eventId }) => ({
      proposalId: `${eventId}-proposal`,
      eventId,
      candidateId: `${eventId}-candidate`,
      eligible: true,
    })),
    assemble: () => ({
      cues: structuredClone(baselineCues),
      blockedEventIds: [],
    }),
  };
}
const first = (value: ReturnType<typeof evaluateC611GroupedOracles>) => {
  const row = value.groups[0];
  if (!row) throw new Error("synthetic group missing");
  return row;
};
describe("C6.1.1 fixed-group joint existing-candidate oracles", () => {
  it("finds existing complete candidate gains and keeps Gold text out of artifacts", () => {
    const data = fixture();
    data.assemble = () => ({ cues: [cue("m", "あう")], blockedEventIds: [] });
    const before = structuredClone(data.baselineCues);
    const result = evaluateC611GroupedOracles(data);
    expect(first(result).proposalOracle).toMatchObject({
      status: "EXACT",
      theoreticalCombinations: "2",
      searchedCombinations: 2,
      bestNormalizedError: 0,
      normalizedGain: 1,
      optimumBounds: "EXACT_VALUE",
    });
    expect(result.summary.proposalOracle).toMatchObject({
      exactGroups: 1,
      baselineNormalizedError: 1,
      bestNormalizedError: 0,
      goldNormalizedGraphemeCount: 2,
      normalizedGain: 1,
    });
    expect(data.baselineCues).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("あう");
    expect(c611GroupedOracleSchema.parse(result)).toEqual(result);
  });
  it("does not sum individually improving conflicting event proposals in one group", () => {
    const data = fixture(undefined, undefined, [
      { eventId: "e1", finalCueIds: ["m"] },
      { eventId: "e2", finalCueIds: ["m"] },
    ]);
    data.assemble = (selections) => ({
      cues: [cue("m", "あう")],
      blockedEventIds: selections.length > 1 ? ["e1", "e2"] : [],
    });
    const result = evaluateC611GroupedOracles(data);
    expect(first(result).proposalOracle).toMatchObject({
      theoreticalCombinations: "4",
      searchedCombinations: 4,
      validCombinations: 3,
      rejectedCombinations: 1,
      normalizedGain: 1,
      rejectionReasons: { RENDERER_BLOCKED_ASSIGNMENT: 1 },
    });
    expect(first(result).proposalOracle.bestObservedSelections).toHaveLength(1);
    expect(result.summary.proposalOracle.normalizedGain).toBe(1);
    expect(result.summary.proposalOracle.goldNormalizedGraphemeCount).toBe(2);
  });
  it("evaluates a joint improvement unavailable to either single counterfactual", () => {
    const data = fixture(
      [cue("m", "あ")],
      [cue("g", "い")],
      [
        { eventId: "e1", finalCueIds: ["m"] },
        { eventId: "e2", finalCueIds: ["m"] },
      ],
    );
    data.assemble = (selections) => ({
      cues: [cue("m", selections.length === 2 ? "い" : "う")],
      blockedEventIds: [],
    });
    const result = evaluateC611GroupedOracles(data);
    expect(first(result).proposalOracle.bestObservedSelections).toHaveLength(2);
    expect(first(result).proposalOracle.normalizedGain).toBe(1);
    expect(first(result).proposalOracle.validCombinations).toBe(4);
  });
  it("keeps proposal oracle separate from all frozen existing alternatives", () => {
    const data = fixture();
    data.frozenAlternativeOptions = [
      {
        eventId: "e",
        alternatives: [
          { candidateId: "e-candidate" },
          { candidateId: "other-existing" },
        ],
      },
    ];
    data.assemble = (selections) => ({
      cues: [
        cue(
          "m",
          selections[0]?.candidateId === "other-existing" ? "あう" : "あえ",
        ),
      ],
      blockedEventIds: [],
    });
    const row = first(evaluateC611GroupedOracles(data));
    expect(row.proposalOracle.normalizedGain).toBe(0);
    expect(row.proposalOracle.bestObservedSelections).toEqual([]);
    expect(row.bestExistingCandidateOracle.normalizedGain).toBe(1);
    expect(row.bestExistingCandidateOracle.theoreticalCombinations).toBe("3");
  });
  it("prefers KEEP_CURRENT on a normalized-error tie even if exact error differs", () => {
    const data = fixture([cue("m", "Ａ")], [cue("g", "A")]);
    data.assemble = () => ({ cues: [cue("m", "A")], blockedEventIds: [] });
    const row = first(evaluateC611GroupedOracles(data));
    expect(row.proposalOracle.bestNormalizedError).toBe(0);
    expect(row.proposalOracle.bestExactError).toBe(1);
    expect(row.proposalOracle.bestObservedSelections).toEqual([]);
  });
  it("rejects cue mutation and unrelated fixed-group mutation independently", () => {
    const baseline = [cue("m1", "あ", 0, 1), cue("m2", "い", 5, 6)];
    const data = fixture(
      baseline,
      [cue("g1", "う", 0, 1), cue("g2", "え", 5, 6)],
      [{ eventId: "e", finalCueIds: ["m1"] }],
    );
    data.frozenAlternativeOptions = [
      {
        eventId: "e",
        alternatives: [
          { candidateId: "e-candidate" },
          { candidateId: "timing" },
          { candidateId: "duplicate" },
          { candidateId: "reorder" },
        ],
      },
    ];
    data.assemble = (selections) => {
      const kind = selections[0]?.candidateId;
      if (kind === "timing")
        return {
          cues: [cue("m1", "う", 0, 2), baseline[1] as C611EvaluationCue],
          blockedEventIds: [],
        };
      if (kind === "duplicate")
        return {
          cues: [
            baseline[0] as C611EvaluationCue,
            baseline[0] as C611EvaluationCue,
          ],
          blockedEventIds: [],
        };
      if (kind === "reorder")
        return { cues: baseline.toReversed(), blockedEventIds: [] };
      return {
        cues: [cue("m1", "う", 0, 1), cue("m2", "え", 5, 6)],
        blockedEventIds: [],
      };
    };
    const row = first(evaluateC611GroupedOracles(data));
    expect(row.bestExistingCandidateOracle).toMatchObject({
      status: "EXACT",
      bestNormalizedError: 1,
      validCombinations: 1,
      rejectedCombinations: 4,
      rejectionReasons: {
        OUTSIDE_FIXED_GROUP_MUTATION: 1,
        INVALID_CUE_STRUCTURE: 1,
        CUE_ID_ORDER_OR_TIMING_MUTATION: 2,
      },
    });
  });
  it("reports unknown after an assembly exception rather than an exact partial minimum", () => {
    const data = fixture();
    data.assemble = () => {
      throw new Error("synthetic unavailable renderer");
    };
    const row = first(evaluateC611GroupedOracles(data));
    expect(row.proposalOracle).toMatchObject({
      status: "ASSEMBLY_ERROR",
      bestNormalizedError: null,
      bestObservedNormalizedError: 1,
      optimumBounds: "UNKNOWN",
      assemblyErrorCombinations: 1,
    });
  });
  it("freezes the 65536 cap and marks larger products unknown without partial search", () => {
    const events = Array.from({ length: 17 }, (_, i) => ({
      eventId: `e${String(i).padStart(2, "0")}`,
      finalCueIds: ["m"],
    }));
    const data = fixture(undefined, undefined, events);
    let calls = 0;
    data.assemble = () => {
      calls += 1;
      return { cues: data.baselineCues, blockedEventIds: [] };
    };
    const result = evaluateC611GroupedOracles(data);
    expect(C611_GROUPED_ORACLE_POLICY.maxCombinationsPerGroup).toBe(65536);
    expect(first(result).proposalOracle).toMatchObject({
      status: "SEARCH_LIMIT",
      theoreticalCombinations: "131072",
      searchedCombinations: 0,
      bestNormalizedError: null,
      normalizedGain: null,
      optimumBounds: "UNKNOWN",
    });
    expect(result.summary.proposalOracle).toMatchObject({
      exactGroups: 0,
      searchLimitGroups: 1,
      goldNormalizedGraphemeCount: 0,
      entireFixedMapExact: false,
      bestNormalizedCer: null,
    });
    expect(calls).toBe(0);
  });
  it("fails closed for a shared event coupling multiple fixed groups", () => {
    const data = fixture(
      [cue("m1", "あ", 0, 1), cue("m2", "い", 5, 6)],
      [cue("g1", "う", 0, 1), cue("g2", "え", 5, 6)],
      [{ eventId: "e", finalCueIds: ["m1", "m2"] }],
    );
    const result = evaluateC611GroupedOracles(data);
    for (const row of result.groups) {
      expect(row.proposalOracle.status).toBe("UNEVALUABLE");
      expect(row.proposalOracle.reasons).toContain(
        "CROSS_GROUP_EVENT_COUPLING",
      );
      expect(row.proposalOracle.bestNormalizedError).toBeNull();
    }
    expect(result.summary.proposalOracle.goldNormalizedGraphemeCount).toBe(0);
  });
  it("retains explicit ambiguous and unmapped Gold groups outside exact denominators", () => {
    const data = fixture([cue("m", "あ", 0, 10)], [cue("g", "い", 0, 1)]);
    const result = evaluateC611GroupedOracles(data);
    expect(first(result).mappingStatus).toBe("AMBIGUOUS_BASELINE_MAPPING");
    expect(first(result).proposalOracle.status).toBe("UNEVALUABLE");
    expect(result.summary.proposalOracle.bestNormalizedCer).toBeNull();
  });
  it("counts each fixed group's Gold denominator once and exposes unlocalized events", () => {
    const data = fixture(
      [cue("m1", "あ", 0, 1), cue("m2", "い", 5, 6)],
      [cue("g1", "う", 0, 1), cue("g2", "え", 5, 6)],
      [
        { eventId: "e1", finalCueIds: ["m1"] },
        { eventId: "e2", finalCueIds: ["m2"] },
      ],
    );
    data.frozenAlternativeOptions = [
      ...data.frozenAlternativeOptions,
      { eventId: "unlocalized", alternatives: [{ candidateId: "uc" }] },
    ];
    data.primaryProposals = [
      ...data.primaryProposals,
      {
        eventId: "unlocalized",
        proposalId: "up",
        candidateId: "uc",
        eligible: true,
      },
    ];
    data.assemble = (selections) => ({
      cues: data.baselineCues.map((item) => {
        if (selections.some((s) => s.eventId === "e1") && item.id === "m1")
          return { ...item, text: "う" };
        if (selections.some((s) => s.eventId === "e2") && item.id === "m2")
          return { ...item, text: "え" };
        return item;
      }),
      blockedEventIds: [],
    });
    const result = evaluateC611GroupedOracles(data);
    expect(result.summary.proposalOracle).toMatchObject({
      exactGroups: 2,
      baselineNormalizedError: 2,
      bestNormalizedError: 0,
      goldNormalizedGraphemeCount: 2,
      normalizedGain: 2,
    });
    expect(result.summary.unmappedAlternativeEventIds).toEqual(["unlocalized"]);
    expect(result.summary.unmappedPrimaryEventIds).toEqual(["unlocalized"]);
  });
  it("is deterministic under frozen option/proposal order and retains whole candidate identity", () => {
    const data = fixture(undefined, undefined, [
      { eventId: "e1", finalCueIds: ["m"] },
      { eventId: "e2", finalCueIds: ["m"] },
    ]);
    const seen: C611OracleSelection[][] = [];
    data.assemble = (selections) => {
      seen.push(structuredClone([...selections]));
      return {
        cues: [cue("m", "あう")],
        blockedEventIds: selections.length > 1 ? ["e1"] : [],
      };
    };
    const a = evaluateC611GroupedOracles(data);
    const b = evaluateC611GroupedOracles({
      ...data,
      frozenAlternativeOptions: data.frozenAlternativeOptions.toReversed(),
      primaryProposals: data.primaryProposals.toReversed(),
    });
    expect(a).toEqual(b);
    expect(
      seen
        .flat()
        .every(
          (selection) =>
            selection.candidateId === `${selection.eventId}-candidate`,
        ),
    ).toBe(true);
  });
  it("rejects non-frozen primary candidates and ambiguous duplicate event choices", () => {
    const data = fixture();
    expect(() =>
      evaluateC611GroupedOracles({
        ...data,
        primaryProposals: [
          {
            eventId: "e",
            proposalId: "p",
            candidateId: "not-frozen",
            eligible: true,
          },
        ],
      }),
    ).toThrow("C611_ORACLE_PRIMARY_NOT_IN_FROZEN_ELIGIBLE_OPTIONS");
    expect(() =>
      evaluateC611GroupedOracles({
        ...data,
        frozenAlternativeOptions: [
          ...data.frozenAlternativeOptions,
          ...data.frozenAlternativeOptions,
        ],
      }),
    ).toThrow("C611_ORACLE_DUPLICATE_OR_EMPTY_INPUT_ID");
  });
  it("detects callback mutation of source objects instead of reporting productionMutationCount zero", () => {
    const data = fixture();
    data.assemble = () => {
      const item = data.baselineCues[0];
      if (item) item.text = "mutated synthetic";
      return { cues: data.baselineCues, blockedEventIds: [] };
    };
    expect(() => evaluateC611GroupedOracles(data)).toThrow(
      "C611_ORACLE_INPUT_MUTATION",
    );
  });
  it("handles empty and zero-denominator inputs without fabricated coverage", () => {
    const empty = fixture([], [], []);
    const emptyResult = evaluateC611GroupedOracles(empty);
    expect(emptyResult.summary.proposalOracle.exactGroupCoverage).toBeNull();
    expect(emptyResult.summary.proposalOracle.entireFixedMapExact).toBe(false);
    const data = fixture([cue("m", "")], [cue("g", "")]);
    expect(
      first(evaluateC611GroupedOracles(data)).proposalOracle
        .bestNormalizedError,
    ).toBe(0);
    expect(
      evaluateC611GroupedOracles(data).summary.proposalOracle.bestNormalizedCer,
    ).toBeNull();
  });
  it("uses grapheme-safe errors and rejects extra schema fields", () => {
    const data = fixture([cue("m", "👩‍💻")], [cue("g", "👩‍🔬")]);
    const result = evaluateC611GroupedOracles(data);
    expect(first(result).currentExactError).toBe(1);
    expect(first(result).goldExactGraphemeCount).toBe(1);
    expect(
      c611GroupedOracleSchema.safeParse({ ...result, goldText: "synthetic" })
        .success,
    ).toBe(false);
  });
});
