import { describe, expect, it } from "vitest";
import {
  c611FixedBaselineAlignmentMapSchema,
  c611FixedAlignmentEvaluationSchema,
  c611ProposalLabelsSchema,
  type C611EvaluationCue,
  type C611FixedBaselineAlignmentMap,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import {
  buildC611FixedBaselineAlignmentMap,
  C611_FIXED_ALIGNMENT_POLICY,
  c611MappingContent,
  c611EventFixedGroups,
} from "../packages/video-subtitler/src/consensus/fixed-baseline-alignment-map.js";
import {
  evaluateC611FixedAlignment,
  evaluateC611ProposalCounterfactuals,
  c611FixedGroupFoldMembership,
} from "../packages/video-subtitler/src/consensus/fixed-alignment-paired-evaluator.js";
import { evaluateC611SelectiveProfileQuality } from "../packages/video-subtitler/src/consensus/selective-mbr-quality-evaluator.js";
import { freezeC61Profiles } from "../packages/video-subtitler/src/consensus/c61-policy.js";

const barrier = {
  machineFreezeHash: hash("synthetic-freeze"),
  machineFrozenAt: "2026-01-01T00:00:00.000Z",
  goldFirstReadAt: "2026-01-01T00:00:01.000Z",
};
function cue(
  id: string,
  start: number,
  end: number,
  text = "あ",
): C611EvaluationCue {
  return { id, start, end, text };
}
function fixture(
  baselineCues = [cue("m1", 0, 2, "赤い空")],
  goldCues = [cue("g1", 0, 2, "青い空")],
) {
  const eventBindings = baselineCues.map((c, i) => ({
    eventId: `event-${i}`,
    finalCueIds: [c.id],
  }));
  const map = buildC611FixedBaselineAlignmentMap({
    baselineCues,
    goldCues,
    eventBindings,
    barrier,
  });
  return { map, baselineCues, goldCues, eventBindings };
}
function evaluate(
  data: ReturnType<typeof fixture>,
  shadowCues = data.baselineCues,
  profileId = "synthetic-profile",
) {
  return evaluateC611FixedAlignment({ ...data, shadowCues, profileId });
}
function rehashMap(
  map: C611FixedBaselineAlignmentMap,
): C611FixedBaselineAlignmentMap {
  const { semanticHash, ...body } = map;
  void semanticHash;
  const updated = {
    ...body,
    mappingSemanticHash: hash(c611MappingContent(body)),
  };
  return { ...updated, semanticHash: hash(updated) };
}
describe("C6.1.1 fixed baseline temporal cue-group map", () => {
  it("builds one-to-one and records post-freeze identity without source text", () => {
    const { map } = fixture();
    expect(map.groups[0]?.mappingStatus).toBe("FIXED_ONE_TO_ONE");
    expect(map.summary).toMatchObject({
      totalCueGroups: 1,
      stableMappedGroups: 1,
      oneToOne: 1,
    });
    expect(map.machineArtifactsFrozenBeforeGold).toBe(true);
    expect(JSON.stringify(map)).not.toContain("青い空");
    expect(c611FixedBaselineAlignmentMapSchema.parse(map)).toEqual(map);
  });
  it("supports one machine cue to many Gold cues", () => {
    const { map } = fixture(
      [cue("m", 0, 4, "あいうえ")],
      [cue("g1", 0, 2, "あい"), cue("g2", 2, 4, "うえ")],
    );
    expect(map.groups[0]?.mappingStatus).toBe("FIXED_ONE_TO_MANY");
    expect(map.groups[0]?.goldCueIds).toEqual(["g1", "g2"]);
  });
  it("supports many machine cues to one Gold cue and counts Gold once", () => {
    const data = fixture(
      [cue("m1", 0, 2, "あい"), cue("m2", 2, 4, "うえ")],
      [cue("g", 0, 4, "あいうえ")],
    );
    expect(data.map.groups[0]?.mappingStatus).toBe("FIXED_MANY_TO_ONE");
    const result = evaluate(data);
    expect(result.summary.goldNormalizedGraphemeCount).toBe(4);
    expect(result.summary.baselineNormalizedError).toBe(0);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.eventIds).toHaveLength(2);
  });
  it("supports connected many-to-many while preserving ordered membership", () => {
    const data = fixture(
      [cue("m1", 0, 2.5, "あい"), cue("m2", 2, 4, "うえ")],
      [cue("g1", 0, 2, "あい"), cue("g2", 1.5, 4, "うえ")],
    );
    expect(data.map.groups[0]?.mappingStatus).toBe("FIXED_MANY_TO_MANY");
    expect(evaluate(data).summary.shadowNormalizedError).toBe(0);
    expect(c611EventFixedGroups(data.map).get("event-0")).toEqual(
      c611EventFixedGroups(data.map).get("event-1"),
    );
  });
  it("weak partial overlap is ambiguous, not an invented one-to-one", () => {
    const data = fixture([cue("m", 0, 1)], [cue("g", 0.9, 2)]);
    expect(data.map.groups[0]?.mappingStatus).toBe(
      "AMBIGUOUS_BASELINE_MAPPING",
    );
    expect(evaluate(data).groups[0]?.baselineNormalizedError).toBeNull();
  });
  it("nonoverlap and boundary touching remain unmapped", () => {
    const data = fixture([cue("m", 0, 1)], [cue("g", 1, 2)]);
    expect(data.map.groups[0]?.mappingStatus).toBe("NO_BASELINE_MAPPING");
    expect(data.map.unmappedGoldCueIds).toEqual(["g"]);
    expect(evaluate(data).summary.fixedEvaluationCoverage).toBe(0);
  });
  it("does not split a broad bridge into favorable subgroups to raise coverage", () => {
    const data = fixture(
      [cue("m", 0, 100)],
      [cue("g1", 0, 2), cue("g2", 50, 52)],
    );
    expect(data.map.groups).toHaveLength(1);
    expect(data.map.groups[0]?.ambiguityReasons).toContain(
      "TEMPORAL_COMPONENT_DURATION_LIMIT",
    );
    expect(data.map.groups[0]?.ambiguityReasons).toContain(
      "TEMPORAL_BRIDGE_GAP_LIMIT",
    );
    expect(data.map.groups[0]?.mappingStatus).toBe(
      "AMBIGUOUS_BASELINE_MAPPING",
    );
  });
  it("rejects dense oversized components without relaxing the frozen policy", () => {
    const data = fixture(
      [cue("m", 0, 9)],
      Array.from({ length: 9 }, (_, i) => cue(`g${i}`, i, i + 1)),
    );
    expect(data.map.groups[0]?.ambiguityReasons).toContain(
      "TEMPORAL_COMPONENT_CUE_LIMIT",
    );
    expect(data.map.mappingPolicyHash).toBe(hash(C611_FIXED_ALIGNMENT_POLICY));
  });
  it("detects non-contiguous cue membership rather than reordering production", () => {
    const data = fixture(
      [cue("m0", 0, 10), cue("m1", 1, 2), cue("m2", 5, 6)],
      [cue("g", 5, 6)],
    );
    expect(data.map.groups[0]?.mappingStatus).toBe("STRUCTURE_INCOMPATIBLE");
    expect(evaluate(data).invariance.groupStructureParity).toBe(false);
  });
  it("marks invalid intervals and nonmonotonic P0 order structurally incompatible", () => {
    expect(fixture([cue("m", 1, 1)], []).map.groups[0]?.mappingStatus).toBe(
      "STRUCTURE_INCOMPATIBLE",
    );
    const data = fixture(
      [cue("m2", 3, 4), cue("m1", 0, 1)],
      [cue("g1", 0, 1), cue("g2", 3, 4)],
    );
    expect(
      data.map.groups.every(
        (g) => g.mappingStatus === "STRUCTURE_INCOMPATIBLE",
      ),
    ).toBe(true);
  });
  it("canonicalizes Gold input and binding order deterministically", () => {
    const data = fixture(
      [cue("m1", 0, 1), cue("m2", 3, 4)],
      [cue("g1", 0, 1), cue("g2", 3, 4)],
    );
    expect(
      buildC611FixedBaselineAlignmentMap({
        ...data,
        barrier,
        goldCues: data.goldCues.toReversed(),
        eventBindings: data.eventBindings.toReversed(),
      }),
    ).toEqual(data.map);
  });
  it("rejects pre-freeze Gold, duplicate IDs and unknown event cue bindings", () => {
    const data = fixture();
    expect(() =>
      buildC611FixedBaselineAlignmentMap({
        ...data,
        barrier: { ...barrier, goldFirstReadAt: "2025-01-01T00:00:00.000Z" },
      }),
    ).toThrow("GOLD_PRECEDES");
    expect(() => fixture([cue("same", 0, 1), cue("same", 1, 2)])).toThrow(
      "DUPLICATE_CUE",
    );
    expect(() =>
      buildC611FixedBaselineAlignmentMap({
        ...data,
        barrier,
        eventBindings: [{ eventId: "event", finalCueIds: ["unknown"] }],
      }),
    ).toThrow("UNKNOWN_EVENT_CUE");
  });
  it("empty inputs have no fabricated perfect coverage", () => {
    const data = fixture([], []),
      result = evaluate(data);
    expect(result.summary.fixedEvaluationCoverage).toBeNull();
    expect(result.summary.changedGroupCoverage).toBeNull();
    expect(result.summary.baselineNormalizedCer).toBeNull();
  });
});
describe("C6.1.1 fixed paired evaluator and invariance", () => {
  it("reuses the identical map across profiles and measures only changed text", () => {
    const data = fixture(),
      snapshot = structuredClone(data);
    const before = evaluate(data),
      after = evaluate(data, [cue("m1", 0, 2, "青い空")], "alternative");
    expect(before.mappingSemanticHash).toBe(after.mappingSemanticHash);
    expect(after.groups[0]?.outcome).toBe("IMPROVED");
    expect(after.summary.normalizedGain).toBe(1);
    expect(after.summary.changedGroupCoverage).toBe(1);
    expect(data).toEqual(snapshot);
    expect(c611FixedAlignmentEvaluationSchema.parse(after)).toEqual(after);
  });
  it("forbids profile-specific rematching even when swapped Gold text would improve", () => {
    const data = fixture(
      [cue("m1", 0, 1, "甲"), cue("m2", 3, 4, "乙")],
      [cue("g1", 0, 1, "甲"), cue("g2", 3, 4, "乙")],
    );
    const result = evaluate(data, [
      cue("m1", 0, 1, "乙"),
      cue("m2", 3, 4, "甲"),
    ]);
    expect(result.summary.regressedGroups).toBe(2);
    expect(result.summary.normalizedGain).toBe(-2);
    expect(result.groups.map((g) => g.goldCueIds)).toEqual([["g1"], ["g2"]]);
  });
  it("does not cancel one group's regression merely because total gain is zero", () => {
    const data = fixture(
      [cue("m1", 0, 1, "甲"), cue("m2", 3, 4, "乙")],
      [cue("g1", 0, 1, "乙"), cue("g2", 3, 4, "乙")],
    );
    const result = evaluate(data, [
      cue("m1", 0, 1, "乙"),
      cue("m2", 3, 4, "甲"),
    ]);
    expect(result.summary).toMatchObject({
      improvedGroups: 1,
      regressedGroups: 1,
      normalizedGain: 0,
    });
  });
  it("cue IDs, order, times, and count fail closed for every group", () => {
    const data = fixture(
      [cue("m1", 0, 1), cue("m2", 3, 4)],
      [cue("g1", 0, 1), cue("g2", 3, 4)],
    );
    for (const shadow of [
      data.baselineCues.toReversed(),
      [cue("unknown", 0, 1), cue("m2", 3, 4)],
      [cue("m1", 0, 1.1), cue("m2", 3, 4)],
      data.baselineCues.slice(0, 1),
      [cue("m1", 0, 1), cue("m1", 3, 4)],
    ]) {
      const result = evaluate(data, shadow);
      expect(result.invariance.eligible).toBe(false);
      expect(result.summary.evaluableGroups).toBe(0);
      expect(
        result.groups.every(
          (g) =>
            g.outcome === "UNEVALUABLE" && g.shadowNormalizedError === null,
        ),
      ).toBe(true);
    }
  });
  it("changed P0 or Gold identities do not silently build a replacement mapping", () => {
    const data = fixture();
    expect(
      evaluateC611FixedAlignment({
        ...data,
        profileId: "changed",
        shadowCues: data.baselineCues,
        baselineCues: [cue("m1", 0, 2, "別")],
      }).invariance.baselineIdentityParity,
    ).toBe(false);
    expect(
      evaluateC611FixedAlignment({
        ...data,
        profileId: "changed",
        shadowCues: data.baselineCues,
        goldCues: [cue("g1", 0, 2, "別")],
      }).invariance.goldIdentityParity,
    ).toBe(false);
  });
  it("rehashing forged fixed groups cannot authorize profile-specific topology", () => {
    const data = fixture(
      [cue("m1", 0, 1), cue("m2", 3, 4)],
      [cue("g1", 0, 1), cue("g2", 3, 4)],
    );
    const map = structuredClone(data.map),
      first = map.groups[0];
    if (!first) throw new Error("synthetic fixture");
    const { semanticHash, ...body } = first;
    void semanticHash;
    const forged = { ...body, goldCueIds: ["g2"], goldCueIndexes: [1] };
    map.groups[0] = { ...forged, semanticHash: hash(forged) };
    expect(
      evaluate({ ...data, map: rehashMap(map) }).invariance
        .mappingIntegrityParity,
    ).toBe(false);
  });
  it("separates exact NFC grapheme errors from normalized punctuation/width errors", () => {
    const data = fixture([cue("m", 0, 1, "Ａ！")], [cue("g", 0, 1, "a")]);
    const result = evaluate(data, [cue("m", 0, 1, "a")]);
    expect(result.groups[0]?.normalizedGain).toBe(0);
    expect(result.groups[0]?.exactGain).toBe(2);
    expect(result.groups[0]?.outcome).toBe("NEUTRAL");
  });
  it("counts combined emoji and surrogate pairs as graphemes", () => {
    const result = evaluate(
      fixture([cue("m", 0, 1, "👩‍💻")], [cue("g", 0, 1, "👩‍🔬")]),
    );
    expect(result.groups[0]?.baselineExactError).toBe(1);
    expect(result.summary.goldExactGraphemeCount).toBe(1);
  });
  it("empty Gold text retains valid zero counts but never divides by zero", () => {
    const result = evaluate(
      fixture([cue("m", 0, 1, "")], [cue("g", 0, 1, "")]),
    );
    expect(result.groups[0]?.outcome).toBe("NEUTRAL");
    expect(result.summary.shadowNormalizedCer).toBeNull();
  });
  it("all new artifacts reject unexpected fields", () => {
    const data = fixture();
    expect(
      c611FixedBaselineAlignmentMapSchema.safeParse({
        ...data.map,
        goldText: "forbidden",
      }).success,
    ).toBe(false);
    expect(
      c611FixedAlignmentEvaluationSchema.safeParse({
        ...evaluate(data),
        profileRematching: true,
      }).success,
    ).toBe(false);
  });
});
describe("C6.1.1 frozen proposal counterfactual labels", () => {
  function proposalData() {
    const data = fixture(
      [cue("m1", 0, 2, "赤"), cue("m2", 2, 4, "空")],
      [cue("g1", 0, 4, "青空")],
    );
    const proposals = [
      {
        proposalId: "p1",
        eventId: "event-0",
        candidateId: "candidate-1",
        shadowCues: [cue("m1", 0, 2, "青"), cue("m2", 2, 4, "空")],
      },
      {
        proposalId: "p2",
        eventId: "event-1",
        candidateId: "candidate-2",
        shadowCues: [cue("m1", 0, 2, "赤"), cue("m2", 2, 4, "海")],
      },
    ];
    return {
      ...data,
      proposals,
      proposalFolds: [
        { proposalId: "p1", foldId: "fold-1" },
        { proposalId: "p2", foldId: "fold-1" },
      ],
      proposalSetHash: hash(proposals),
    };
  }
  it("labels each proposal against unchanged same-group P0, not other proposals", () => {
    const input = proposalData(),
      result = evaluateC611ProposalCounterfactuals(input);
    expect(result.labels.map((l) => l.outcome)).toEqual([
      "SWITCH_IMPROVES",
      "SWITCH_REGRESSES",
    ]);
    expect(result.labels.map((l) => l.baselineError)).toEqual([1, 1]);
    expect(result.labels.map((l) => l.proposedError)).toEqual([0, 2]);
    expect(result.labels[0]?.groupIdentityHash).toBe(
      result.labels[1]?.groupIdentityHash,
    );
    expect(result.summary.uniqueEvaluableGroups).toBe(1);
    expect(result.summary.groupErrorAggregation).toContain("NO_SUMMATION");
    expect(c611ProposalLabelsSchema.parse(result)).toEqual(result);
  });
  it("marks all proposals in a fixed group crossing frozen folds UNEVALUABLE", () => {
    const input = proposalData();
    input.proposalFolds[1] = { proposalId: "p2", foldId: "fold-2" };
    const result = evaluateC611ProposalCounterfactuals(input);
    expect(result.summary.fixedGroupCrossFoldCount).toBe(1);
    expect(
      result.labels.every(
        (l) =>
          l.outcome === "SWITCH_UNEVALUABLE" &&
          l.normalizedGain === null &&
          l.reasons.includes("FIXED_GROUP_CROSSES_FOLDS"),
      ),
    ).toBe(true);
    expect([...c611FixedGroupFoldMembership(input).values()]).toEqual([
      ["fold-1", "fold-2"],
    ]);
  });
  it("refuses changes outside the proposal event's fixed group", () => {
    const data = fixture(
      [cue("m1", 0, 1), cue("m2", 3, 4)],
      [cue("g1", 0, 1), cue("g2", 3, 4)],
    );
    const proposals = [
      {
        proposalId: "p",
        eventId: "event-0",
        candidateId: "c",
        shadowCues: [cue("m1", 0, 1, "い"), cue("m2", 3, 4, "う")],
      },
    ];
    const result = evaluateC611ProposalCounterfactuals({
      ...data,
      proposals,
      proposalSetHash: hash(proposals),
      proposalFolds: [{ proposalId: "p", foldId: "f" }],
    });
    expect(result.labels[0]?.reasons).toContain(
      "COUNTERFACTUAL_CHANGED_UNRELATED_GROUP",
    );
  });
  it("missing folds, candidate identity, structure, or map cannot become a positive label", () => {
    const input = proposalData();
    expect(
      evaluateC611ProposalCounterfactuals({
        ...input,
        proposalFolds: [],
      }).labels.every((l) => l.outcome === "SWITCH_UNEVALUABLE"),
    ).toBe(true);
    expect(
      evaluateC611ProposalCounterfactuals({
        ...input,
        proposals: input.proposals.map((p) => ({ ...p, candidateId: null })),
      }).labels.every((l) => l.outcome === "SWITCH_UNEVALUABLE"),
    ).toBe(true);
    expect(
      evaluateC611ProposalCounterfactuals({
        ...input,
        proposals: input.proposals.map((p) => ({
          ...p,
          eventId: "unknown-event",
        })),
      }).labels.every((l) => l.outcome === "SWITCH_UNEVALUABLE"),
    ).toBe(true);
  });
  it("neutral switches remain a separate negative calibration class", () => {
    const input = proposalData(),
      proposals = input.proposals.map((p) => ({
        ...p,
        shadowCues: input.baselineCues,
      }));
    expect(
      evaluateC611ProposalCounterfactuals({ ...input, proposals }).labels.every(
        (l) => l.outcome === "SWITCH_NEUTRAL",
      ),
    ).toBe(true);
  });
  it("proposal and fold input ordering cannot change labels or fold hash", () => {
    const input = proposalData();
    expect(
      evaluateC611ProposalCounterfactuals({
        ...input,
        proposals: input.proposals.toReversed(),
        proposalFolds: input.proposalFolds.toReversed(),
      }),
    ).toEqual(evaluateC611ProposalCounterfactuals(input));
  });
  it("a missing peer fold makes every same-group proposal unevaluable", () => {
    const input = proposalData();
    const result = evaluateC611ProposalCounterfactuals({
      ...input,
      proposalFolds: input.proposalFolds.slice(0, 1),
    });
    expect(
      result.labels.every(
        (label) =>
          label.outcome === "SWITCH_UNEVALUABLE" &&
          label.reasons.includes("FIXED_GROUP_MISSING_FOLD_MEMBERSHIP"),
      ),
    ).toBe(true);
  });
});

describe("C6.1.1 fixed/legacy quality readout separation", () => {
  function qualityInput() {
    const data = fixture();
    const legacyInput = {
      generatedAt: barrier.machineFrozenAt,
      sourceIdentity: {
        fileName: "synthetic.mkv",
        size: 1,
        sha256: hash("synthetic-source"),
      },
      freeze: {
        freezeSemanticHash: barrier.machineFreezeHash,
        frozenArtifactAggregateHash: hash("synthetic-output"),
      },
      goldIdentity: {
        fileName: "synthetic.ass",
        size: 1,
        sha256: hash("synthetic-gold"),
        cueCount: data.goldCues.length,
        timestampNormalizationCount: 0,
        firstReadAt: barrier.goldFirstReadAt,
        readOnlyVerified: true,
      },
      policy: {
        ...freezeC61Profiles(hash("synthetic-alignment-policy"))
          .evaluationPolicy,
        frozenAt: barrier.machineFrozenAt,
      },
      evaluationWallTimeMs: 0,
      outputHashAfterGold: hash("synthetic-output"),
    };
    return {
      ...data,
      profileId: "S6",
      shadowCues: [cue("m1", 0, 2, "青い空")],
      legacyInput,
    };
  }
  it("keeps fixed labels independent from diagnostic legacy rematching", () => {
    const input = qualityInput(),
      snapshot = structuredClone(input);
    const result = evaluateC611SelectiveProfileQuality(input);
    expect(result.quality.fixedEvaluationMethod).toBe("FIXED_GROUP_EVALUATION");
    expect(result.quality.legacyMetricsUsedForProposalLabels).toBe(false);
    expect(result.fixed.summary.improvedGroups).toBe(1);
    expect(result.quality.shadowMetrics.normalizedCer).toBe(0);
    expect(result.quality.timingHashUnchanged).toBe(true);
    expect(result.quality.shadowAllPairOverlapCount).toBe(
      result.quality.baselineAllPairOverlapCount,
    );
    expect(input).toEqual(snapshot);
  });
  it("rejects inconsistent barrier identity and timing before legacy quality computation", () => {
    const input = qualityInput();
    expect(() =>
      evaluateC611SelectiveProfileQuality({
        ...input,
        legacyInput: {
          ...input.legacyInput,
          freeze: {
            ...input.legacyInput.freeze,
            freezeSemanticHash: hash("wrong"),
          },
        },
      }),
    ).toThrow("FREEZE_IDENTITY");
    expect(() =>
      evaluateC611SelectiveProfileQuality({
        ...input,
        shadowCues: [cue("m1", 0, 2.1, "青い空")],
      }),
    ).toThrow("STRUCTURE_OR_MAP");
  });
});
