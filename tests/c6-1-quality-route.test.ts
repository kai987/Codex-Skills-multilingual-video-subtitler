import { describe, expect, test } from "vitest";
import {
  subtitlePackageSchema,
  c61QualityEvaluationSchema,
  c61RouteDecisionSchema,
  type C61CandidateText,
  type C61HypothesisEvent,
  type C61HypothesisInput,
  type C61MachineFreeze,
  type C61ProfileQuality,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { buildC61HypothesisUniverse } from "../packages/video-subtitler/src/consensus/hypothesis-universe.js";
import {
  buildC61Representations,
  c61Require,
} from "../packages/video-subtitler/src/consensus/japanese-text-representation.js";
import { alignC61Multiple } from "../packages/video-subtitler/src/consensus/multiple-sequence-alignment.js";
import { buildC61TokenLattice } from "../packages/video-subtitler/src/consensus/token-lattice.js";
import { materializeC61Path } from "../packages/video-subtitler/src/consensus/lattice-mbr.js";
import { assembleC61Shadow } from "../packages/video-subtitler/src/consensus/consensus-shadow-assembly.js";
import {
  auditC61Consensus,
  type C61ProfilePath,
} from "../packages/video-subtitler/src/consensus/consensus-safety-audit.js";
import {
  compareC61Timing,
  evaluateC61Oracles,
  evaluateC61Profiles,
  mapC61EventsToGold,
} from "../packages/video-subtitler/src/consensus/consensus-quality-evaluator.js";
import { attributeC61ConsensusErrors } from "../packages/video-subtitler/src/consensus/consensus-error-attribution.js";
import { decideC61ResearchRoute } from "../packages/video-subtitler/src/consensus/c61-route-decision.js";
import { freezeC61Profiles } from "../packages/video-subtitler/src/consensus/c61-policy.js";

function fixture(
  specs = [{ current: "赤い空", chosen: "青い空", gold: "青い空" }],
  blocked = false,
) {
  const events: C61HypothesisEvent[] = specs.map((spec, index) => {
    const body = {
      eventId: `event-${index}`,
      sourceInterval: { start: index * 3, end: index * 3 + 2 },
      sourceCandidateIds: [`current-${index}`, `r-${index}`],
      finalCueIds: [`cue-${index}`],
      currentText: spec.current,
      finalSpan: {
        finalCueId: `cue-${index}`,
        spanStart: 0,
        spanEnd: Array.from(spec.current).length,
        spanText: spec.current,
        lineageStatus: "EXACT",
        modifiable: !blocked,
        evidenceHash: hash(index),
      },
    };
    return { ...body, semanticHash: hash(body) };
  });
  const candidates: C61HypothesisInput[] = specs.flatMap((spec, index) =>
    (["CURRENT", "REAZON"] as const).map((provider) => ({
      inputRecordId: `${provider}-${index}`,
      sourceCandidateId: `${provider}-${index}`,
      eventId: `event-${index}`,
      providerFamily: provider,
      modelIdentity: `${provider}-synthetic-model`,
      requestId: `${provider}-${index}`,
      windowType: "SYNTHETIC_CORE",
      sourceInterval: { start: index * 3, end: index * 3 + 2 },
      displayText: provider === "CURRENT" ? spec.current : spec.chosen,
      pronunciationText: null,
      pronunciationEvidenceId: null,
      candidateRole:
        provider === "CURRENT" ? "CURRENT_FINAL" : "REAZON_CORE_EXACT",
      correlationLineage: [`${provider}-group`],
      provenanceHashes: [hash({ index, provider })],
      lineageVerified: true,
      sourceGlobalVerified: true,
      hardRejectionReasons: [],
      localizationBlockers: [],
      runtimeGoldInputCount: 0,
      humanDerived: false,
    })),
  );
  const universe = buildC61HypothesisUniverse({
    events,
    candidates,
    sourceArtifactHashes: { synthetic: hash("input") },
  });
  const paths: C61ProfilePath[] = [];
  const lattices = events.map((event) => {
    const texts: C61CandidateText[] = universe.candidates
      .filter(
        (candidate) =>
          candidate.eventId === event.eventId &&
          candidate.inclusionStatus === "INCLUDED",
      )
      .map((candidate) => ({
        candidateId: candidate.candidateId,
        eventId: event.eventId,
        providerFamily: candidate.providerFamily,
        displayText: candidate.displayText,
        normalizedText: candidate.normalizedText,
        pronunciationText: candidate.pronunciationText,
        correlationGroupId: candidate.correlationGroupId,
        provenanceHash: candidate.provenanceHash,
        sourceInterval: c61Require(candidate.sourceInterval),
      }));
    const reps = buildC61Representations(texts),
      lattice = buildC61TokenLattice(alignC61Multiple(reps), reps);
    const current = c61Require(
      texts.find((candidate) => candidate.providerFamily === "CURRENT"),
    );
    for (const profileId of ["P0", "P1"]) {
      const selected =
        profileId === "P0"
          ? current
          : c61Require(
              texts.find((candidate) => candidate.providerFamily === "REAZON"),
            );
      const selectedNodes = c61Require(
        lattice.candidatePaths.find(
          (path) => path.candidateId === selected.candidateId,
        ),
      ).nodeIds;
      paths.push({
        profileId,
        eventId: event.eventId,
        path: materializeC61Path(
          lattice,
          selectedNodes,
          texts,
          current.candidateId,
          2,
          selected.candidateId,
        ),
        maxProviderSwitches: 2,
      });
    }
    return lattice;
  });
  const production = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "synthetic.mkv",
      container: "mkv",
      durationSeconds: 20,
    },
    identity: { title: "Synthetic", season: null, episode: null, year: 2026 },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      srt: "production.srt",
      vtt: "production.vtt",
      ass: "production.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues: specs.map((spec, index) => ({
      id: `cue-${index}`,
      text: spec.current,
      start: index * 3,
      end: index * 3 + 2,
      language: "ja",
      languages: ["ja"],
      speaker: null,
      confidence: 0.8,
    })),
    warnings: [],
  });
  const shadows = ["P0", "P1"].map((profileId) =>
    assembleC61Shadow({ profileId, production, events, paths, lattices }),
  );
  const profileFreeze = freezeC61Profiles(hash("alignment-policy"));
  const freeze: C61MachineFreeze = {
    schemaVersion: "1.0.0",
    policyVersion: "c6.1-consensus-investigation-v1",
    artifactType: "c6-1-machine-freeze",
    frozenAt: "2026-01-01T00:00:00.000Z",
    policyHash: profileFreeze.semanticHash,
    inputHashes: { synthetic: hash("input") },
    machineFiles: [],
    machineAggregateHash: hash("machine"),
    productionFiles: [],
    runtimeGoldInputCount: 0,
    newAsrInferenceCount: 0,
    networkUsed: false,
    benchmarkStatus: "KNOWN_DEVELOPMENT_BENCHMARK",
    semanticHash: hash("freeze"),
  };
  const gold = specs.map((spec, index) => ({
    id: `gold-${index}`,
    text: spec.gold,
    start: index * 3,
    end: index * 3 + 2,
  }));
  const oracle = evaluateC61Oracles({
    universe,
    lattices,
    gold,
    machineFreezeHash: freeze.semanticHash,
  });
  const input: Parameters<typeof evaluateC61Profiles>[0] = {
    universe,
    paths,
    shadows,
    gold,
    goldIdentity: {
      fileName: "synthetic-gold.srt",
      size: 123,
      sha256: hash("gold"),
      cueCount: gold.length,
      timestampNormalizationCount: 0,
      firstReadAt: "2026-01-01T00:00:01.000Z",
      readOnlyVerified: true,
    },
    sourceIdentity: {
      fileName: "synthetic.mkv",
      size: 456,
      sha256: hash("source"),
    },
    freeze,
    profileFreeze,
    oracle,
    profileEvidence: {
      P0: { acousticEvidenceUsed: 0, unsafeRejected: 0 },
      P1: { acousticEvidenceUsed: 2, unsafeRejected: 3 },
    },
  };
  const quality = evaluateC61Profiles(input).quality;
  const safety = auditC61Consensus({
    paths,
    lattices,
    productionTextMutation: 0,
    productionTimingMutation: 0,
    runtimeGoldInputCount: 0,
  }).safety;
  return { input, quality, safety, oracle, production };
}
function withPrimary(
  data: ReturnType<typeof fixture>,
  change: Partial<C61ProfileQuality>,
) {
  const original = c61Require(
    data.quality.profiles.find((profile) => profile.profileId === "P1"),
  );
  const primary = { ...original, ...change };
  return {
    ...data.quality,
    profiles: [
      c61Require(
        data.quality.profiles.find((profile) => profile.profileId === "P0"),
      ),
      primary,
    ],
  };
}

describe("C6.1 Gold mapping and actual rendered quality", () => {
  test("maps by time without choosing Gold text for decoder advantage", () => {
    const { input } = fixture();
    const map = mapC61EventsToGold(input.universe, [
      ...input.gold,
      { id: "other", start: 1, end: 3, text: "別の文" },
    ]);
    expect(map.get("event-0")?.status).toBe("AMBIGUOUS_GOLD_MAPPING");
    expect(
      mapC61EventsToGold(input.universe, [
        { id: "none", start: 9, end: 10, text: "無関係" },
      ]).get("event-0")?.status,
    ).toBe("NO_GOLD_MAPPING");
    expect(() =>
      mapC61EventsToGold(input.universe, [...input.gold, ...input.gold]),
    ).toThrow("DUPLICATE_GOLD_CUE_ID");
  });
  test("one full Gold cue cannot be double-counted for two half events", () => {
    const { input } = fixture([
      { current: "甲", chosen: "乙", gold: "乙" },
      { current: "丙", chosen: "丁", gold: "丁" },
    ]);
    const universe = {
      ...input.universe,
      events: input.universe.events.map((event, index) => ({
        ...event,
        sourceInterval: { start: index * 2, end: index * 2 + 2 },
      })),
    };
    const map = mapC61EventsToGold(universe, [
      { id: "full", start: 0, end: 4, text: "乙丁" },
    ]);
    expect([...map.values()].map((row) => row.status)).toEqual([
      "AMBIGUOUS_GOLD_MAPPING",
      "AMBIGUOUS_GOLD_MAPPING",
    ]);
  });
  test("uncertain Gold mapping contributes no fabricated oracle gain", () => {
    const { input } = fixture();
    const oracle = evaluateC61Oracles({
      universe: input.universe,
      lattices: [],
      gold: input.gold,
      machineFreezeHash: input.freeze.semanticHash,
    });
    expect(oracle.evaluableEventCount).toBe(0);
    expect(oracle.legalPathOracleGain).toBe(0);
    expect(oracle.events[0]?.currentError).toBeNull();
  });
  test("preserves every local regression even when total CER is unchanged", () => {
    const data = fixture([
      { current: "赤い空", chosen: "青い空", gold: "青い空" },
      { current: "白い雲", chosen: "黒い雲", gold: "白い雲" },
      { current: "高い山", chosen: "高い山", gold: "高い山" },
    ]);
    const p = c61Require(
      data.quality.profiles.find((profile) => profile.profileId === "P1"),
    );
    expect([p.changedEvents, p.improved, p.regressed, p.neutral]).toEqual([
      2, 1, 1, 1,
    ]);
    expect(p.consensusPrecision).toBe(0.5);
    expect(p.consensusHarmRate).toBe(0.5);
    expect(p.realizedGain).toBe(0);
    expect(
      p.eventResults.filter((event) => event.outcome === "REGRESSED"),
    ).toHaveLength(1);
  });
  test("blocked proposal never counts as rendered improvement or novel output", () => {
    const data = fixture(undefined, true),
      p = c61Require(
        data.quality.profiles.find((profile) => profile.profileId === "P1"),
      );
    expect(p.shadowBlockedChangeCount).toBe(1);
    expect([
      p.changedEvents,
      p.improved,
      p.realizedGain,
      p.renderedChangedCueCount,
    ]).toEqual([0, 0, 0, 0]);
    expect(p.metrics.normalizedCer).toBe(data.quality.baseline.normalizedCer);
  });
  test("evidence counters come from the frozen caller records, not success placeholders", () => {
    const data = fixture();
    const p = c61Require(
      data.quality.profiles.find((profile) => profile.profileId === "P1"),
    );
    expect([p.acousticEvidenceUsed, p.unsafeRejected]).toEqual([2, 3]);
    expect(() =>
      evaluateC61Profiles({ ...data.input, profileEvidence: {} }),
    ).toThrow("PROFILE_EVIDENCE");
  });
  test("Gold after-freeze boundary and oracle identity fail closed", () => {
    const { input } = fixture();
    expect(() =>
      evaluateC61Profiles({
        ...input,
        goldIdentity: {
          ...input.goldIdentity,
          firstReadAt: "2025-12-31T23:59:59.000Z",
        },
      }),
    ).toThrow("GOLD_READ_PRECEDES");
    expect(() =>
      evaluateC61Profiles({
        ...input,
        oracle: { ...input.oracle, machineFreezeHash: hash("wrong") },
      }),
    ).toThrow("ORACLE_FREEZE_MISMATCH");
  });
  test("legacy evaluator consumes the frozen full configuration, not a newly created default", () => {
    const { input } = fixture();
    const { policyHash: originalPolicyHash, ...evaluationBody } =
      input.profileFreeze.evaluationPolicy;
    void originalPolicyHash;
    const changedEvaluation = {
      ...evaluationBody,
      thresholds: {
        ...evaluationBody.thresholds,
        severeTimingBoundarySeconds: 3,
      },
    };
    const { semanticHash: originalProfileHash, ...profileBody } =
      input.profileFreeze;
    void originalProfileHash;
    const changedProfile = {
      ...profileBody,
      evaluationPolicy: {
        ...changedEvaluation,
        policyHash: hash(changedEvaluation),
      },
    };
    const profileFreeze = {
      ...changedProfile,
      semanticHash: hash(changedProfile),
    };
    const result = evaluateC61Profiles({
      ...input,
      profileFreeze,
      freeze: { ...input.freeze, policyHash: profileFreeze.semanticHash },
    });
    expect(result.fullEvaluations[0]?.evaluationPolicyHash).toBe(
      hash(changedEvaluation),
    );
    expect(() => evaluateC61Profiles({ ...input, profileFreeze })).toThrow(
      "EVALUATION_PROFILE_FREEZE_MISMATCH",
    );
    expect("frozenAt" in input.profileFreeze.evaluationPolicy).toBe(false);
    expect(
      input.profileFreeze.eventEvaluationPolicy.sharedGoldClaimPolicy,
    ).toBe("EXCLUDE_ALL_MULTIPLE_EVENT_CLAIMS");
  });
  test("event oracle denominator uses the same grapheme unit as its edit distance", () => {
    const data = fixture([{ current: "👩‍💻", chosen: "👩‍🔬", gold: "👩‍🔬" }]);
    expect(data.oracle.goldCharacterCount).toBe(1);
    expect(data.oracle.events[0]?.currentError).toBe(1);
  });
  test("post-hoc best report cannot select supplementary switch ablations", () => {
    const { input } = fixture();
    const p0 = c61Require(
        input.shadows.find((shadow) => shadow.profileId === "P0"),
      ),
      p1 = c61Require(
        input.shadows.find((shadow) => shadow.profileId === "P1"),
      );
    const supplementary = { ...p1, profileId: "SWITCH-UNLIMITED" };
    const output = evaluateC61Profiles({
      ...input,
      shadows: [p0, { ...p0, profileId: "P1" }, supplementary],
      paths: [
        ...input.paths,
        ...input.paths
          .filter((path) => path.profileId === "P1")
          .map((path) => ({ ...path, profileId: "SWITCH-UNLIMITED" })),
      ],
      profileEvidence: {
        ...input.profileEvidence,
        "SWITCH-UNLIMITED": { acousticEvidenceUsed: 0, unsafeRejected: 0 },
      },
    }).quality;
    expect(output.bestGoldFreeProfile).toBe("P1");
    expect(
      c61QualityEvaluationSchema.safeParse({
        ...output,
        bestGoldFreeProfile: "SWITCH-UNLIMITED",
      }).success,
    ).toBe(false);
  });
  test("matching-induced metric changes are distinct from actual timestamp mutations", () => {
    const data = fixture(),
      baseline = data.quality.baseline,
      cues = data.production.cues;
    expect(
      compareC61Timing({
        cues,
        baselineCues: cues,
        baseline,
        metrics: { ...baseline, boundaryP95: baseline.boundaryP95 + 1 },
      }),
    ).toEqual({ timingHashUnchanged: true, matchingInducedTimingDelta: true });
    expect(
      compareC61Timing({
        cues: [],
        baselineCues: cues,
        baseline,
        metrics: baseline,
      }).timingHashUnchanged,
    ).toBe(false);
    expect(
      compareC61Timing({
        cues: cues.map((cue) => ({ ...cue, start: cue.start + 0.1 })),
        baselineCues: cues,
        baseline,
        metrics: { ...baseline, startMae: 2 },
      }),
    ).toEqual({
      timingHashUnchanged: false,
      matchingInducedTimingDelta: false,
    });
  });
});

describe("C6.1 route hard gates and truthful attribution", () => {
  test("qualifying frozen primary profile confirms gain but never releases production", () => {
    const data = fixture();
    const route = decideC61ResearchRoute({ ...data, abParity: true });
    expect(route.decision).toBe("CONSENSUS_DECODING_GAIN_CONFIRMED");
    expect(route.c602Status).toBe("HOLD");
    expect(route.machineOnlyReleaseAuthorized).toBe(false);
    expect(c61RouteDecisionSchema.parse(route)).toEqual(route);
  });
  test("every quality guardrail uses actual baseline values", () => {
    const data = fixture(),
      base = data.quality.baseline;
    const p = c61Require(
      data.quality.profiles.find((profile) => profile.profileId === "P1"),
    );
    for (const metrics of [
      { ...p.metrics, hallucination: base.hallucination + 1 },
      { ...p.metrics, missing: base.missing + 1 },
      { ...p.metrics, coverage: 0 },
      { ...p.metrics, materialErrors: base.materialErrors + 1 },
    ]) {
      const route = decideC61ResearchRoute({
        ...data,
        quality: withPrimary(data, { metrics }),
        abParity: true,
      });
      expect(route.qualifyingProfiles).toEqual([]);
      expect(route.decision).not.toBe("CONSENSUS_DECODING_GAIN_CONFIRMED");
    }
  });
  test("A/B failure and nonzero safety counts override claimed engineering success", () => {
    const data = fixture();
    const quality = withPrimary(data, { novelImproved: 1 });
    expect(
      decideC61ResearchRoute({ ...data, quality, abParity: false }).decision,
    ).toBe("CONSENSUS_ENGINEERING_INVALID");
    const unsafe = decideC61ResearchRoute({
      ...data,
      quality,
      abParity: true,
      safety: {
        ...data.safety,
        engineeringPassed: true,
        counts: { ...data.safety.counts, unsupportedAdjacencyCount: 1 },
      },
    });
    expect(unsafe.decision).toBe("CONSENSUS_ENGINEERING_INVALID");
    expect(unsafe.strongerSignal).toBe("NOT_CONFIRMED");
    expect(unsafe.qualifyingProfiles).toEqual([]);
  });
  test("changed timing or cue structure is engineering-invalid, not an incidental quality gain", () => {
    const data = fixture();
    const route = decideC61ResearchRoute({
      ...data,
      quality: withPrimary(data, { timingHashUnchanged: false }),
      abParity: true,
    });
    expect(route.decision).toBe("CONSENSUS_ENGINEERING_INVALID");
  });
  test("oracle potential without a safe realized profile requests calibration, never release", () => {
    const data = fixture();
    const quality = withPrimary(data, { realizedGain: 0 });
    const route = decideC61ResearchRoute({
      ...data,
      quality,
      oracle: { ...data.oracle, consensusSpecificOracleGain: 2 },
      abParity: true,
    });
    expect(route.decision).toBe("CONSENSUS_ORACLE_POTENTIAL_DECODER_UNSAFE");
    expect(route.nextRoute).toBe("C6.1.1_DECODER_CALIBRATION_SHADOW_ONLY");
  });
  test("no oracle or decoder gain stops automatic expansion", () => {
    const data = fixture();
    const route = decideC61ResearchRoute({
      ...data,
      quality: withPrimary(data, { realizedGain: 0 }),
      oracle: { ...data.oracle, consensusSpecificOracleGain: 0 },
      abParity: true,
    });
    expect(route.decision).toBe("NO_CONSENSUS_ADVANTAGE_OVER_CANDIDATE_UNION");
    expect(route.c611Status).toBe("HOLD");
  });
  test("an imperfect oracle is not causal proof that pool insufficiency caused a regression", () => {
    const data = fixture([
      { current: "青い空", chosen: "赤い空", gold: "青い海" },
    ]);
    const attribution = attributeC61ConsensusErrors(data.quality, data.oracle);
    expect(attribution.regressions).toHaveLength(1);
    expect(attribution.regressions[0]?.attribution).toBe("UNKNOWN");
    expect(attribution.regressions[0]?.rationale).toContain("pool limitation");
    expect(attribution.counts.UNKNOWN).toBe(1);
  });
});
