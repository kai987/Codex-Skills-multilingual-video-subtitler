import { describe, expect, it } from "vitest";
import {
  subtitlePackageSchema,
  type C61HypothesisEvent,
  type C61HypothesisInput,
} from "@mvl/shared";
import {
  c611DecisionSchema,
  type C611Decision,
} from "../packages/shared/src/c6-1-1-calibration-schemas.js";
import {
  c611ProposalLabelsSchema,
  type C611ProposalLabel,
} from "../packages/shared/src/c6-1-1-evaluation-schemas.js";
import {
  c611ErrorAttributionSchema,
  c611ReviewSuggestionsSchema,
} from "../packages/shared/src/c6-1-1-diagnostic-schemas.js";
import { buildC61HypothesisUniverse } from "../packages/video-subtitler/src/consensus/hypothesis-universe.js";
import { buildC611MachineProposals } from "../packages/video-subtitler/src/consensus/existing-candidate-proposal.js";
import { c611WithHash } from "../packages/video-subtitler/src/consensus/hierarchical-correlation-groups.js";
import { buildC611ErrorAttribution } from "../packages/video-subtitler/src/consensus/selective-mbr-error-attribution.js";
import { buildC611ReviewSuggestions } from "../packages/video-subtitler/src/consensus/selective-mbr-review-suggestions.js";
import type { C61MachineArtifactInput } from "../packages/video-subtitler/src/consensus/c61-artifact-adapter.js";
const SHA = "a".repeat(64);
function required<T>(v: T | null | undefined): T {
  if (v == null) throw new Error("fixture missing");
  return v;
}
function fixture(): C61MachineArtifactInput {
  const subtitlePackage = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "synthetic.wav",
      container: "wav",
      durationSeconds: 20,
    },
    identity: { title: "Synthetic", season: null, episode: null, year: null },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      ass: "synthetic.ass",
      srt: "synthetic.srt",
      vtt: "synthetic.vtt",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    warnings: [],
    cues: [
      {
        id: "cue-1",
        start: 2,
        end: 5,
        text: "明日は晴れる",
        language: "ja",
        languages: ["ja"],
        speaker: null,
        confidence: null,
      },
    ],
  });
  const event: C61HypothesisEvent = c611WithHash({
    eventId: "synthetic-event",
    sourceInterval: { start: 2, end: 5 },
    sourceCandidateIds: [
      "source-current",
      "source-w1",
      "source-w2",
      "source-r1",
    ],
    finalCueIds: ["cue-1"],
    currentText: "明日は晴れる",
    finalSpan: {
      finalCueId: "cue-1",
      spanStart: 0,
      spanEnd: 6,
      spanText: "明日は晴れる",
      lineageStatus: "EXACT",
      modifiable: true,
      evidenceHash: SHA,
    },
  });
  const make = (
    suffix: string,
    text: string,
    provider: C61HypothesisInput["providerFamily"],
  ): C61HypothesisInput => ({
    inputRecordId: `synthetic:${suffix}`,
    sourceCandidateId: `source-${suffix}`,
    eventId: event.eventId,
    providerFamily: provider,
    modelIdentity: `model-${provider}`,
    requestId: `request-${suffix}`,
    windowType: "CORE_EXACT",
    sourceInterval: { start: 2, end: 5 },
    displayText: text,
    pronunciationText: null,
    pronunciationEvidenceId: null,
    candidateRole: `${provider}_CORE_EXACT`,
    correlationLineage: [`decode-${suffix}`],
    provenanceHashes: [SHA],
    lineageVerified: true,
    sourceGlobalVerified: true,
    hardRejectionReasons: [],
    localizationBlockers: [],
    runtimeGoldInputCount: 0,
    humanDerived: false,
  });
  return {
    subtitlePackage,
    taskDirectory: "synthetic",
    events: [event],
    candidates: [
      make("current", "明日は晴れる", "CURRENT"),
      make("w1", "明日は晴れる", "WHISPER"),
      make("w2", "明日は曇り", "WHISPER"),
      make("r1", "明日は曇り", "REAZON"),
    ],
    sourceArtifactHashes: { "synthetic.json": SHA },
    acousticScores: [],
    baselineInventory: {
      canonicalCueCount: 1,
      canonicalEventCount: 1,
      historicalRawCandidateCount: 4,
      historicalDispositionCounts: {},
      inputRowsByArtifact: {},
      sourceMediaSha256: SHA,
      sourceDurationSeconds: 20,
      newAsrInferenceCount: 0,
      networkUsed: false,
      runtimeGoldInputCount: 0,
    },
  };
}
function setup(outcome: C611ProposalLabel["outcome"] = "SWITCH_REGRESSES") {
  const machine = fixture();
  const universe = buildC61HypothesisUniverse({
    events: machine.events,
    candidates: machine.candidates,
    sourceArtifactHashes: machine.sourceArtifactHashes,
  });
  const result = buildC611MachineProposals({ machine, universe });
  const proposal = required(result.proposals.records[0]);
  const known = outcome !== "SWITCH_UNEVALUABLE";
  const label = c611WithHash({
    proposalId: proposal.proposalId,
    eventId: proposal.eventId,
    candidateId: proposal.proposedCandidateId,
    groupIds: ["g"],
    groupIdentityHash: SHA,
    counterfactualHash: SHA,
    outcome,
    baselineError: known ? 2 : null,
    proposedError: known
      ? outcome === "SWITCH_IMPROVES"
        ? 1
        : outcome === "SWITCH_REGRESSES"
          ? 3
          : 2
      : null,
    exactGain: known
      ? outcome === "SWITCH_IMPROVES"
        ? 1
        : outcome === "SWITCH_REGRESSES"
          ? -1
          : 0
      : null,
    normalizedGain: known
      ? outcome === "SWITCH_IMPROVES"
        ? 1
        : outcome === "SWITCH_REGRESSES"
          ? -1
          : 0
      : null,
    reasons: [],
    groupResults: [],
  });
  const labels = c611ProposalLabelsSchema.parse(
    c611WithHash({
      schemaVersion: "1.0.0",
      policyVersion: result.proposals.policyVersion,
      evaluationOnly: true,
      privacy: "LOCAL_ONLY",
      artifactType: "gold-selective-existing-candidate-labels",
      proposalSetHash: result.proposals.semanticHash,
      fixedMapHash: SHA,
      foldMembershipHash: SHA,
      labels: [label],
      summary: {
        totalProposals: 1,
        improved: Number(outcome === "SWITCH_IMPROVES"),
        regressed: Number(outcome === "SWITCH_REGRESSES"),
        neutral: Number(outcome === "SWITCH_NEUTRAL"),
        unevaluable: Number(!known),
        fixedGroupCrossFoldCount: 0,
        uniqueEvaluableGroups: Number(known),
        groupErrorAggregation:
          "NO_SUMMATION_OF_CORRELATED_PROPOSAL_COUNTERFACTUAL_ERRORS",
      },
    }),
  );
  const decision = (
    profileId: C611Decision["profileId"],
    selected: boolean,
  ): C611Decision =>
    c611DecisionSchema.parse(
      c611WithHash({
        profileId,
        eventId: proposal.eventId,
        proposalId: proposal.proposalId,
        foldId: "fold-1",
        proposedCandidateId: proposal.proposedCandidateId,
        decisionScore: 0.7,
        threshold: 0.6,
        decision: selected ? "SELECT_EXISTING_CANDIDATE" : "KEEP_CURRENT",
        machineReasons: ["TRAIN_FOLD_MODEL"],
        modelHash: SHA,
        policyHash: SHA,
      }),
    );
  return { machine, universe, ...result, proposal, labels, decision };
}
describe("C6.1.1 descriptive attribution and review-only delivery", () => {
  it("counts wrong contraction/unknown CTC descriptively without inventing actual application", () => {
    const s = setup();
    const result = buildC611ErrorAttribution({
      ...s,
      decisions: [s.decision("S6", true)],
    });
    expect(result.profiles[0]?.counts.requestedWrongCount).toBe(1);
    expect(result.profiles[0]?.counts.actualAppliedCount).toBeNull();
    expect(result.cases[0]?.diagnosticErrorTypes).toContain(
      "WRONG_SWITCH_WITH_UNKNOWN_CTC",
    );
    expect(result.causalInterpretation).toBe(
      "DESCRIPTIVE_ASSOCIATION_NOT_UNIQUE_CAUSATION",
    );
    expect(result.correlatedGainsSummed).toBe(false);
  });
  it("uses explicit renderer receipts to separate blocked proposals from applied switches", () => {
    const s = setup();
    const decisions = [s.decision("S6", true)];
    const attribution = buildC611ErrorAttribution({
      ...s,
      decisions,
      appliedEventIdsByProfile: { S6: [] },
    });
    expect(attribution.profiles[0]?.counts.requestedWrongCount).toBe(1);
    expect(attribution.profiles[0]?.counts.actualAppliedWrongCount).toBe(0);
    expect(attribution.profiles[0]?.counts.rendererBlockedCount).toBe(1);
    const review = buildC611ReviewSuggestions({
      ...s,
      decisions,
      profileId: "S6",
      appliedEventIdsByProfile: { S6: [] },
    });
    expect(review.rows[0]?.decision).toBe("ABSTAIN_REVIEW");
    expect(review.rows[0]?.reasons).toContain(
      "RENDERER_BLOCKED_REQUESTED_SWITCH",
    );
  });
  it("S6 vs S5 reports prevented wrong requests as paired ablation, not unique CTC causation", () => {
    const s = setup();
    const result = buildC611ErrorAttribution({
      ...s,
      decisions: [s.decision("S5", true), s.decision("S6", false)],
    });
    expect(result.ctcUtility.available).toBe(true);
    expect(result.ctcUtility.selectionChangedCount).toBe(1);
    expect(result.ctcUtility.switchedOff.requestedWrongCount).toBe(1);
    expect(result.ctcUtility.ctcUnknownSelectionChangedCount).toBe(1);
    expect(result.ctcUtility.uniquelyCausedByCtcClaim).toBe(false);
  });
  it("S6 vs S5 counts a newly selected improving proposal separately", () => {
    const s = setup("SWITCH_IMPROVES");
    const result = buildC611ErrorAttribution({
      ...s,
      decisions: [s.decision("S5", false), s.decision("S6", true)],
      appliedEventIdsByProfile: { S5: [], S6: [s.proposal.eventId] },
    });
    expect(result.ctcUtility.switchedOn.actualAppliedCorrectCount).toBe(1);
    expect(result.ctcUtility.switchedOff.requestedSwitchCount).toBe(0);
  });
  it("a legacy candidate with a different label identity is unknown, never relabelled using H2", () => {
    const s = setup();
    const legacy = {
      ...s.decision("S1", true),
      proposedCandidateId: "different-existing-id",
    };
    const result = buildC611ErrorAttribution({ ...s, decisions: [legacy] });
    expect(result.cases[0]?.labelCandidateMatched).toBe(false);
    expect(result.profiles[0]?.counts.requestedWrongCount).toBe(0);
    expect(result.profiles[0]?.counts.requestedUnknownCount).toBe(1);
  });
  it("review suggestions preserve exact existing display strings and admit their OOF score authority", () => {
    const s = setup();
    const before = JSON.stringify(s.machine.subtitlePackage);
    const review = buildC611ReviewSuggestions({
      universe: s.universe,
      proposals: s.proposals,
      decisions: [s.decision("S6", true)],
      profileId: "S6",
    });
    expect(review.rows[0]?.candidateText).toBe(
      s.universe.candidates.find(
        (c) => c.candidateId === s.proposal.proposedCandidateId,
      )?.displayText,
    );
    expect(review.rows[0]?.currentText).toBe(s.universe.events[0]?.currentText);
    expect(review.scoreAuthority).toContain("OOF_TRAIN_LABEL_DERIVED");
    expect(review.goldLabelInputCount).toBe(0);
    expect(review.runtimeGoldInputCount).toBe(0);
    expect(review.productionMutationCount).toBe(0);
    expect(review.humanApprovalRequired).toBe(true);
    expect(JSON.stringify(s.machine.subtitlePackage)).toBe(before);
  });
  it("review rejects invented candidate IDs and incomplete decision sets", () => {
    const s = setup();
    expect(() =>
      buildC611ReviewSuggestions({
        ...s,
        profileId: "S6",
        decisions: [
          { ...s.decision("S6", true), proposedCandidateId: "invented" },
        ],
      }),
    ).toThrow("NONEXISTING");
    expect(() =>
      buildC611ReviewSuggestions({ ...s, profileId: "S6", decisions: [] }),
    ).toThrow("INCOMPLETE");
  });
  it("unknown quality is not neutral or a zero-error success", () => {
    const s = setup("SWITCH_UNEVALUABLE");
    const result = buildC611ErrorAttribution({
      ...s,
      decisions: [s.decision("S6", true)],
      appliedEventIdsByProfile: { S6: [s.proposal.eventId] },
    });
    expect(result.profiles[0]?.counts.actualAppliedUnknownCount).toBe(1);
    expect(result.profiles[0]?.counts.actualAppliedNeutralCount).toBe(0);
    expect(result.profiles[0]?.counts.actualAppliedCorrectCount).toBe(0);
  });
  it("strict diagnostic schemas reject unrecognized fields", () => {
    const s = setup();
    const decisions = [s.decision("S6", true)];
    const attribution = buildC611ErrorAttribution({ ...s, decisions });
    const review = buildC611ReviewSuggestions({
      ...s,
      decisions,
      profileId: "S6",
    });
    expect(
      c611ErrorAttributionSchema.safeParse({
        ...attribution,
        causedByCtc: true,
      }).success,
    ).toBe(false);
    expect(
      c611ReviewSuggestionsSchema.safeParse({
        ...review,
        goldText: "forbidden",
      }).success,
    ).toBe(false);
  });
  it("decision order cannot change attribution hash and duplicate decisions fail closed", () => {
    const s = setup();
    const decisions = [s.decision("S6", true), s.decision("S5", false)];
    expect(buildC611ErrorAttribution({ ...s, decisions }).semanticHash).toBe(
      buildC611ErrorAttribution({ ...s, decisions: decisions.toReversed() })
        .semanticHash,
    );
    expect(() =>
      buildC611ErrorAttribution({
        ...s,
        decisions: [decisions[0], decisions[0]].map(required),
      }),
    ).toThrow("DUPLICATE");
  });
  it("mismatched label-set identity fails before descriptive aggregation", () => {
    const s = setup();
    expect(() =>
      buildC611ErrorAttribution({
        ...s,
        labels: { ...s.labels, proposalSetHash: "b".repeat(64) },
        decisions: [s.decision("S6", true)],
      }),
    ).toThrow("IDENTITY");
  });
});
