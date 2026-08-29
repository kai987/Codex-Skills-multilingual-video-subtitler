import type {
  GoldCrossModelComplementarityEvaluation,
  GoldSecondAsrControlRegression,
} from "@mvl/shared";
import {
  applyCrossModelTextMutationProposals,
  arbitrateCrossModelCandidate,
  buildC60110Dev24Evaluation,
  buildC60110HoldoutSelection,
  buildC60110PolicyFreeze,
  buildC60110PolicyProfiles,
  buildCrossModelArbitrationEvidenceBundle,
  buildCrossModelTextMutationProposals,
  buildMachineCrossModelArbitrationEvidence,
  buildMachineCrossModelArbitrationLedger,
  independentSupportFamilyCount,
  type C60110EvidenceEventInput,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T10:00:00.000Z";
const HASH = "a".repeat(64);

function machineEvidence(
  status:
    | "POSITIVE_CORRECTNESS_EVIDENCE"
    | "POSITIVE_ERROR_EVIDENCE"
    | "SUPPORTING_ERROR_EVIDENCE"
    | "CONFLICTING_EVIDENCE"
    | "EVIDENCE_ABSENCE"
    | "UNKNOWN",
  input: {
    strong?: boolean;
    reasonCodes?: C60110EvidenceEventInput["whisperDecoderEvidence"]["reasonCodes"];
  } = {},
): C60110EvidenceEventInput["whisperDecoderEvidence"] {
  return {
    status,
    strong: input.strong ?? false,
    evidenceMissing: status === "EVIDENCE_ABSENCE",
    sourceEvidenceIds:
      status === "EVIDENCE_ABSENCE" ? [] : [`evidence:${status}`],
    reasonCodes: input.reasonCodes ?? [],
  };
}

function eventInput(
  overrides: Partial<C60110EvidenceEventInput> = {},
): C60110EvidenceEventInput {
  return {
    eventId: "canonical-event-0001",
    diagnosticRole: "TARGET",
    currentFinalCueIds: ["cue-1"],
    currentFinalSpanLineage: {
      finalCueId: "cue-1",
      spanStart: 0,
      spanEnd: 3,
      lineageStatus: "EXACT",
      modifiable: true,
      blockers: [],
      semanticHash: "1".repeat(64),
    },
    currentWhisperCandidate: {
      candidateId: "whisper-current",
      providerFamily: "WHISPER",
      text: "誤字幕",
      pronunciationText: "ごじまく",
      hallucinationRisk: 0.1,
      evidenceAvailability: "COMPLETE",
    },
    alternateWhisperCandidates: [
      {
        candidateId: "whisper-alternate",
        providerFamily: "WHISPER",
        text: "正字幕",
        pronunciationText: "せいじまく",
        hallucinationRisk: 0.1,
        evidenceAvailability: "COMPLETE",
      },
    ],
    reazonCoreExactCandidate: {
      candidateId: "reazon-exact",
      providerFamily: "REAZON",
      text: "正字幕",
      pronunciationText: "せいじまく",
      hallucinationRisk: 0.1,
      evidenceAvailability: "COMPLETE",
    },
    reazonCoreContextCandidate: {
      candidateId: "reazon-context",
      providerFamily: "REAZON",
      text: "正字幕",
      pronunciationText: "せいじまく",
      hallucinationRisk: 0.1,
      evidenceAvailability: "COMPLETE",
    },
    whisperStability: {
      class: "HALLUCINATION_DISAGREEMENT",
      sourceEvidenceIds: ["whisper-stability"],
    },
    reazonStability: {
      class: "REAZON_CORE_STABLE",
      sourceEvidenceIds: ["reazon-stability"],
    },
    whisperDecoderEvidence: machineEvidence("POSITIVE_ERROR_EVIDENCE", {
      strong: true,
      reasonCodes: ["WHISPER_DECODER_INSTABILITY"],
    }),
    whisperTokenEvidence: machineEvidence("EVIDENCE_ABSENCE"),
    requestEdgeEvidence: machineEvidence("POSITIVE_CORRECTNESS_EVIDENCE"),
    speechCompletenessEvidence: machineEvidence("POSITIVE_ERROR_EVIDENCE", {
      strong: true,
      reasonCodes: ["WHISPER_INCOMPLETE_SPEECH_SUPPORT"],
    }),
    ctc: {
      whisperSupport: null,
      reazonSupport: null,
      outcome: "CTC_UNSCORABLE",
      sourceEvidenceIds: [],
    },
    coreLocalizationStatus: "VERIFIED",
    crossEventAmbiguity: false,
    runtimeProvenanceComplete: true,
    ...overrides,
  };
}

describe("C6.0.1.10 abstention-first cross-model arbitration", () => {
  it("freezes three generic profiles and keeps aggressive shadow out of production", () => {
    const profiles = buildC60110PolicyProfiles({ generatedAt: GENERATED_AT });
    expect(profiles.profiles.map((profile) => profile.profile)).toEqual([
      "CONSERVATIVE",
      "BALANCED",
      "AGGRESSIVE_SHADOW",
    ]);
    expect(
      profiles.profiles.find(
        (profile) => profile.profile === "AGGRESSIVE_SHADOW",
      )?.productionEligible,
    ).toBe(false);
    expect(profiles.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          allowRawConfidenceComparison: false,
          allowCtcToSelectWinner: false,
          allowCorrelatedVotesAsIndependent: false,
        }),
      ]),
    );
  });

  it("selects a stable Reazon candidate only with a safe span and strong independent evidence", () => {
    const profiles = buildC60110PolicyProfiles({ generatedAt: GENERATED_AT });
    const bundle = buildCrossModelArbitrationEvidenceBundle(eventInput());
    const decision = arbitrateCrossModelCandidate({
      bundle,
      profiles,
      profileName: "CONSERVATIVE",
    });
    expect(bundle.currentWhisperCandidate).not.toHaveProperty(
      "averageLogProbability",
    );
    expect(
      independentSupportFamilyCount(bundle, [
        ...decision.strongSupports,
        ...decision.supports,
      ]),
    ).toBeGreaterThanOrEqual(2);
    expect(decision).toMatchObject({
      decision: "SELECT_REAZON",
      confidenceClass: "HIGH",
      mutationEligible: true,
    });
  });

  it("does not treat missing decoder or token evidence as proof that Whisper is wrong", () => {
    const profiles = buildC60110PolicyProfiles({ generatedAt: GENERATED_AT });
    const bundle = buildCrossModelArbitrationEvidenceBundle(
      eventInput({
        alternateWhisperCandidates: [],
        whisperStability: {
          class: "NOT_RUN",
          sourceEvidenceIds: [],
        },
        whisperDecoderEvidence: machineEvidence("EVIDENCE_ABSENCE"),
        whisperTokenEvidence: machineEvidence("EVIDENCE_ABSENCE"),
        requestEdgeEvidence: machineEvidence("EVIDENCE_ABSENCE"),
        speechCompletenessEvidence: machineEvidence("EVIDENCE_ABSENCE"),
      }),
    );
    const decision = arbitrateCrossModelCandidate({
      bundle,
      profiles,
      profileName: "BALANCED",
    });
    expect(bundle.whisperStability.negativeEvidence).toBe(false);
    expect(decision.decision).not.toBe("SELECT_REAZON");
    expect(decision.decisionReasons).toContain("EVIDENCE_ABSENCE_ONLY");
  });

  it("preserves weak supporting error evidence without promoting it to a Whisper-negative vote", () => {
    const bundle = buildCrossModelArbitrationEvidenceBundle(
      eventInput({
        alternateWhisperCandidates: [],
        whisperStability: { class: "NOT_RUN", sourceEvidenceIds: [] },
        whisperDecoderEvidence: machineEvidence("SUPPORTING_ERROR_EVIDENCE"),
        whisperTokenEvidence: machineEvidence("EVIDENCE_ABSENCE"),
        requestEdgeEvidence: machineEvidence("EVIDENCE_ABSENCE"),
        speechCompletenessEvidence: machineEvidence("EVIDENCE_ABSENCE"),
      }),
    );
    expect(bundle.whisperStability.negativeEvidence).toBe(false);
    expect(bundle.evidenceAtoms).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasonCode: "WHISPER_DECODER_INSTABILITY" }),
      ]),
    );
  });

  it("counts Reazon stability and CTC support as one correlated family", () => {
    const profiles = buildC60110PolicyProfiles({ generatedAt: GENERATED_AT });
    const bundle = buildCrossModelArbitrationEvidenceBundle(
      eventInput({
        alternateWhisperCandidates: [],
        speechCompletenessEvidence: machineEvidence(
          "POSITIVE_CORRECTNESS_EVIDENCE",
        ),
        ctc: {
          whisperSupport: 0.2,
          reazonSupport: 0.8,
          outcome: "CTC_FAVORS_REAZON",
          sourceEvidenceIds: ["ctc-a", "ctc-b"],
        },
      }),
    );
    const decision = arbitrateCrossModelCandidate({
      bundle,
      profiles,
      profileName: "CONSERVATIVE",
    });
    expect(
      bundle.evidenceCorrelationGroups.find((group) =>
        group.families.includes("CTC_REAZON_DATA_FAMILY"),
      )?.families,
    ).toContain("REAZON_STABILITY");
    expect(
      independentSupportFamilyCount(bundle, [
        "REAZON_STABLE",
        "CTC_SUPPORTS_REAZON",
      ]),
    ).toBe(1);
    expect(decision.ctcStatus).toBe("SUPPORT_REAZON");
  });

  it("uses high-quality CTC contradiction only as an abstention veto", () => {
    const profiles = buildC60110PolicyProfiles({ generatedAt: GENERATED_AT });
    const bundle = buildCrossModelArbitrationEvidenceBundle(
      eventInput({
        ctc: {
          whisperSupport: 0.9,
          reazonSupport: 0.1,
          outcome: "CTC_FAVORS_WHISPER",
          sourceEvidenceIds: ["ctc-a", "ctc-b"],
        },
      }),
    );
    const decision = arbitrateCrossModelCandidate({
      bundle,
      profiles,
      profileName: "CONSERVATIVE",
    });
    expect(decision.decision).toBe("ABSTAIN_REVIEW");
    expect(decision.decisionReasons).toContain("CTC_SUPPORTS_WHISPER");
  });

  it("hard-blocks unstable Reazon and unsafe split-derived spans", () => {
    const profiles = buildC60110PolicyProfiles({ generatedAt: GENERATED_AT });
    const unstable = buildCrossModelArbitrationEvidenceBundle(
      eventInput({
        reazonStability: {
          class: "REAZON_LEXICALLY_UNSTABLE",
          sourceEvidenceIds: ["unstable"],
        },
      }),
    );
    expect(
      arbitrateCrossModelCandidate({
        bundle: unstable,
        profiles,
        profileName: "BALANCED",
      }).decision,
    ).toBe("BLOCKED_REAZON_UNSTABLE");
    const split = buildCrossModelArbitrationEvidenceBundle(
      eventInput({
        currentFinalSpanLineage: {
          finalCueId: "cue-1",
          spanStart: 0,
          spanEnd: 3,
          lineageStatus: "DERIVED_FROM_SPLIT",
          modifiable: true,
          blockers: [],
          semanticHash: "2".repeat(64),
        },
      }),
    );
    expect(
      arbitrateCrossModelCandidate({
        bundle: split,
        profiles,
        profileName: "BALANCED",
      }).decision,
    ).toBe("BLOCKED_NO_SAFE_SPAN");
  });

  it("records agreement without mutation and retains orthography-only Whisper text", () => {
    const profiles = buildC60110PolicyProfiles({ generatedAt: GENERATED_AT });
    const agreement = buildCrossModelArbitrationEvidenceBundle(
      eventInput({
        reazonCoreExactCandidate: {
          candidateId: "same",
          providerFamily: "REAZON",
          text: "誤字幕",
          pronunciationText: "ごじまく",
          hallucinationRisk: 0,
          evidenceAvailability: "COMPLETE",
        },
      }),
    );
    expect(
      arbitrateCrossModelCandidate({
        bundle: agreement,
        profiles,
        profileName: "CONSERVATIVE",
      }).decision,
    ).toBe("AGREEMENT_NO_CHANGE");
    const orthography = buildCrossModelArbitrationEvidenceBundle(
      eventInput({
        currentWhisperCandidate: {
          candidateId: "whisper-current",
          providerFamily: "WHISPER",
          text: "カーネーション",
          pronunciationText: "かーねーしょん",
          hallucinationRisk: 0,
          evidenceAvailability: "COMPLETE",
        },
        reazonCoreExactCandidate: {
          candidateId: "reazon-exact",
          providerFamily: "REAZON",
          text: "かーねーしょん",
          pronunciationText: "かーねーしょん",
          hallucinationRisk: 0,
          evidenceAvailability: "COMPLETE",
        },
      }),
    );
    expect(
      arbitrateCrossModelCandidate({
        bundle: orthography,
        profiles,
        profileName: "BALANCED",
      }).decision,
    ).toBe("KEEP_CURRENT_WHISPER");
  });

  it("applies only a HIGH-confidence exact-span text replacement and preserves timing", () => {
    const profiles = buildC60110PolicyProfiles({ generatedAt: GENERATED_AT });
    const evidence = buildMachineCrossModelArbitrationEvidence({
      generatedAt: GENERATED_AT,
      scope: "DEV24",
      sourceMediaSha256: HASH,
      upstreamSemanticHashes: { baseline: HASH },
      events: [eventInput()],
    });
    const ledger = buildMachineCrossModelArbitrationLedger({
      generatedAt: GENERATED_AT,
      scope: "DEV24",
      evidence,
      profiles,
      profileName: "CONSERVATIVE",
      arbitrationPolicyHash: HASH,
      productionEnforcementEnabled: true,
    });
    const cues = [{ id: "cue-1", start: 1, end: 2, text: "誤字幕!" }];
    const proposals = buildCrossModelTextMutationProposals({
      generatedAt: GENERATED_AT,
      ledgers: [ledger],
      evidenceArtifacts: [evidence],
      finalCues: cues,
      productionEnforcementEnabled: true,
    });
    const applied = applyCrossModelTextMutationProposals(cues, proposals);
    expect(proposals.summary).toMatchObject({
      proposalCount: 1,
      acceptedCount: 1,
      appliedCount: 1,
      timingChangedFinalCueCount: 0,
    });
    expect(applied[0]).toMatchObject({
      text: "正字幕!",
      start: 1,
      end: 2,
    });
  });

  it("selects episode holdout events using only frozen machine-localizability facts", () => {
    const dev = Array.from(
      { length: 24 },
      (_, index) => `canonical-event-${String(index + 1).padStart(4, "0")}`,
    );
    const holdout = buildC60110HoldoutSelection({
      generatedAt: GENERATED_AT,
      sourceMediaSha256: HASH,
      policyFreezeSemanticHash: HASH,
      canonicalEvents: [
        ...dev.map((eventId, index) => ({
          eventId,
          acousticInterval: { start: index * 2, end: index * 2 + 1 },
          eventType: "SINGLE_UTTERANCE",
          representativeCandidateId: `candidate-${index}`,
          semanticHash: "3".repeat(64),
        })),
        {
          eventId: "canonical-event-0100",
          acousticInterval: { start: 100, end: 102 },
          eventType: "SINGLE_UTTERANCE",
          representativeCandidateId: "holdout-candidate",
          semanticHash: "4".repeat(64),
        },
      ],
      cueLineage: [
        {
          eventId: "canonical-event-0100",
          finalCueIds: ["cue-100"],
          lineageStatus: "EXACT_ONE_TO_ONE",
          modifiable: true,
          semanticHash: "5".repeat(64),
        },
      ],
      dev24EventIds: dev,
      sourceGlobalVerifiedCandidateIds: new Set(["holdout-candidate"]),
    });
    expect(holdout.summary).toMatchObject({
      candidateHoldoutEventCount: 1,
      machineLocalizableCount: 1,
      coreExactPlannedCount: 1,
    });
    expect(holdout.machineOnlySelection).toBe(true);
    expect(holdout.runtimeGoldInputCount).toBe(0);
  });
});

describe("C6.0.1.10 DEV24 profile calibration", () => {
  it("disables production when no profile has both zero wrong switches and positive gain", () => {
    const profiles = buildC60110PolicyProfiles({ generatedAt: GENERATED_AT });
    const inputs = Array.from({ length: 24 }, (_, index) =>
      eventInput({
        eventId: `event-${String(index + 1).padStart(2, "0")}`,
        diagnosticRole: index < 12 ? "TARGET" : "CONTROL",
      }),
    );
    const evidence = buildMachineCrossModelArbitrationEvidence({
      generatedAt: GENERATED_AT,
      scope: "DEV24",
      sourceMediaSha256: HASH,
      upstreamSemanticHashes: { baseline: HASH },
      events: inputs,
    });
    const ledgers = profiles.profiles.map((profile) =>
      buildMachineCrossModelArbitrationLedger({
        generatedAt: GENERATED_AT,
        scope: "DEV24",
        evidence,
        profiles,
        profileName: profile.profile,
        arbitrationPolicyHash: profile.semanticHash,
        productionEnforcementEnabled: true,
      }),
    );
    const complementarity = {
      events: inputs.map((event) => ({
        eventId: event.eventId,
        bestWhisperPoolError: 1,
        whisperCoreError: 1,
        reazonCoreError: 2,
      })),
    } as unknown as GoldCrossModelComplementarityEvaluation;
    const controls = {
      events: inputs.slice(12).map((event) => ({
        eventId: event.eventId,
        result: "WHISPER_BETTER",
        blindlySelectingReazonWouldRegress: true,
      })),
      summary: {
        reazonBetterCount: 0,
        whisperBetterCount: 12,
        equivalentCount: 0,
      },
    } as unknown as GoldSecondAsrControlRegression;
    const evaluation = buildC60110Dev24Evaluation({
      generatedAt: GENERATED_AT,
      profiles,
      ledgers,
      complementarity,
      controls,
      goldIdentityHash: HASH,
      availableOracleGain: 22,
    });
    const freeze = buildC60110PolicyFreeze({
      generatedAt: GENERATED_AT,
      profiles,
      dev24Evaluation: evaluation,
    });
    expect(evaluation.selectedProductionProfile).toBe("DISABLED");
    expect(evaluation.selectionResult).toBe("HOLD_ARBITRATION_NOT_SAFE");
    expect(freeze.enforcementEnabled).toBe(false);
    expect(freeze.frozenBeforeHoldoutGold).toBe(true);
  });
});
