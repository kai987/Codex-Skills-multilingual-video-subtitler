import type {
  GoldCrossModelComplementarityEvaluation,
  GoldSecondAsrControlRegression,
} from "@mvl/shared";
import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  applyCrossModelTextMutationProposals,
  buildC60110Dev24Evaluation,
  buildC60110HoldoutSelection,
  buildC60110PolicyFreeze,
  buildC60110PolicyProfiles,
  buildCrossModelTextMutationProposals,
  buildMachineCrossModelArbitrationEvidence,
  buildMachineCrossModelArbitrationLedger,
  type C60110EvidenceEventInput,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T10:00:00.000Z";
const HASH = "c".repeat(64);

function evidenceEvent(
  eventId: string,
  role: "TARGET" | "CONTROL" | "HOLDOUT",
  cueId: string,
): C60110EvidenceEventInput {
  return {
    eventId,
    diagnosticRole: role,
    currentFinalCueIds: [cueId],
    currentFinalSpanLineage: {
      finalCueId: cueId,
      spanStart: 0,
      spanEnd: 2,
      lineageStatus: "EXACT",
      modifiable: true,
      blockers: [],
      semanticHash: HASH,
    },
    currentWhisperCandidate: {
      candidateId: `whisper:${eventId}`,
      providerFamily: "WHISPER",
      text: "誤り",
      pronunciationText: "あやまり",
      hallucinationRisk: 0,
      evidenceAvailability: "COMPLETE",
    },
    alternateWhisperCandidates: [
      {
        candidateId: `whisper-alt:${eventId}`,
        providerFamily: "WHISPER",
        text: "正解",
        pronunciationText: "せいかい",
        hallucinationRisk: 0,
        evidenceAvailability: "COMPLETE",
      },
    ],
    reazonCoreExactCandidate: {
      candidateId: `reazon-exact:${eventId}`,
      providerFamily: "REAZON",
      text: "正解",
      pronunciationText: "せいかい",
      hallucinationRisk: 0,
      evidenceAvailability: "COMPLETE",
    },
    reazonCoreContextCandidate: {
      candidateId: `reazon-context:${eventId}`,
      providerFamily: "REAZON",
      text: "正解",
      pronunciationText: "せいかい",
      hallucinationRisk: 0,
      evidenceAvailability: "COMPLETE",
    },
    whisperStability: {
      class: "HALLUCINATION_DISAGREEMENT",
      sourceEvidenceIds: [`whisper-stability:${eventId}`],
    },
    reazonStability: {
      class: "REAZON_CORE_STABLE",
      sourceEvidenceIds: [`reazon-stability:${eventId}`],
    },
    whisperDecoderEvidence: {
      status: "POSITIVE_ERROR_EVIDENCE",
      strong: true,
      evidenceMissing: false,
      sourceEvidenceIds: [`decoder:${eventId}`],
      reasonCodes: ["WHISPER_DECODER_INSTABILITY"],
    },
    whisperTokenEvidence: {
      status: "EVIDENCE_ABSENCE",
      strong: false,
      evidenceMissing: true,
      sourceEvidenceIds: [],
      reasonCodes: [],
    },
    requestEdgeEvidence: {
      status: "POSITIVE_CORRECTNESS_EVIDENCE",
      strong: false,
      evidenceMissing: false,
      sourceEvidenceIds: [`edge:${eventId}`],
      reasonCodes: [],
    },
    speechCompletenessEvidence: {
      status: "POSITIVE_ERROR_EVIDENCE",
      strong: true,
      evidenceMissing: false,
      sourceEvidenceIds: [`speech:${eventId}`],
      reasonCodes: ["WHISPER_INCOMPLETE_SPEECH_SUPPORT"],
    },
    ctc: {
      whisperSupport: null,
      reazonSupport: null,
      outcome: "CTC_UNSCORABLE",
      sourceEvidenceIds: [],
    },
    coreLocalizationStatus: "VERIFIED",
    crossEventAmbiguity: false,
    runtimeProvenanceComplete: true,
  };
}

describe("C6.0.1.10 cross-model arbitration E2E", () => {
  it("flows from frozen DEV24 profiles through holdout and safe three-format text application", () => {
    const profiles = buildC60110PolicyProfiles({ generatedAt: GENERATED_AT });
    const devInputs = Array.from({ length: 24 }, (_, index) =>
      evidenceEvent(
        `event-${String(index + 1).padStart(2, "0")}`,
        index < 12 ? "TARGET" : "CONTROL",
        `cue-${index + 1}`,
      ),
    );
    const devEvidence = buildMachineCrossModelArbitrationEvidence({
      generatedAt: GENERATED_AT,
      scope: "DEV24",
      sourceMediaSha256: HASH,
      upstreamSemanticHashes: { c6019Freeze: HASH },
      events: devInputs,
    });
    const devLedgers = profiles.profiles.map((profile) =>
      buildMachineCrossModelArbitrationLedger({
        generatedAt: GENERATED_AT,
        scope: "DEV24",
        evidence: devEvidence,
        profiles,
        profileName: profile.profile,
        arbitrationPolicyHash: profile.semanticHash,
        productionEnforcementEnabled: true,
      }),
    );
    // The complete machine decisions above are frozen before these post-hoc
    // Gold-local errors are supplied to the profile evaluator.
    const complementarity = {
      events: devInputs.map((event) => ({
        eventId: event.eventId,
        bestWhisperPoolError: 2,
        whisperCoreError: 2,
        reazonCoreError: 0,
      })),
    } as unknown as GoldCrossModelComplementarityEvaluation;
    const controls = {
      events: devInputs.slice(12).map((event) => ({
        eventId: event.eventId,
        result: "REAZON_BETTER",
        blindlySelectingReazonWouldRegress: false,
      })),
      summary: {
        reazonBetterCount: 12,
        whisperBetterCount: 0,
        equivalentCount: 0,
      },
    } as unknown as GoldSecondAsrControlRegression;
    const devEvaluation = buildC60110Dev24Evaluation({
      generatedAt: GENERATED_AT,
      profiles,
      ledgers: devLedgers,
      complementarity,
      controls,
      goldIdentityHash: HASH,
      availableOracleGain: 48,
    });
    const freeze = buildC60110PolicyFreeze({
      generatedAt: GENERATED_AT,
      profiles,
      dev24Evaluation: devEvaluation,
    });
    expect(freeze.selectedProductionProfile).toBe("CONSERVATIVE");
    expect(freeze.frozenBeforeHoldoutGold).toBe(true);

    const devIds = devInputs.map((event) => event.eventId);
    const selection = buildC60110HoldoutSelection({
      generatedAt: GENERATED_AT,
      sourceMediaSha256: HASH,
      policyFreezeSemanticHash: freeze.semanticHash,
      canonicalEvents: [
        ...devInputs.map((event, index) => ({
          eventId: event.eventId,
          acousticInterval: { start: index * 2, end: index * 2 + 1 },
          eventType: "SINGLE_UTTERANCE",
          representativeCandidateId: `dev-candidate-${index}`,
          semanticHash: HASH,
        })),
        {
          eventId: "holdout-event-01",
          acousticInterval: { start: 60, end: 62 },
          eventType: "SINGLE_UTTERANCE",
          representativeCandidateId: "holdout-whisper",
          semanticHash: HASH,
        },
      ],
      cueLineage: [
        {
          eventId: "holdout-event-01",
          finalCueIds: ["holdout-cue"],
          lineageStatus: "EXACT_ONE_TO_ONE",
          modifiable: true,
          semanticHash: HASH,
        },
      ],
      dev24EventIds: devIds,
      sourceGlobalVerifiedCandidateIds: new Set(["holdout-whisper"]),
    });
    expect(selection.summary.coreExactPlannedCount).toBe(1);

    const holdoutEvidence = buildMachineCrossModelArbitrationEvidence({
      generatedAt: GENERATED_AT,
      scope: "EPISODE_HOLDOUT",
      sourceMediaSha256: HASH,
      upstreamSemanticHashes: {
        policyFreeze: freeze.semanticHash,
        holdoutSelection: selection.semanticHash,
      },
      events: [evidenceEvent("holdout-event-01", "HOLDOUT", "holdout-cue")],
    });
    const holdoutLedger = buildMachineCrossModelArbitrationLedger({
      generatedAt: GENERATED_AT,
      scope: "EPISODE_HOLDOUT",
      evidence: holdoutEvidence,
      profiles,
      profileName: "CONSERVATIVE",
      arbitrationPolicyHash: freeze.arbitrationPolicyHash,
      productionEnforcementEnabled: freeze.enforcementEnabled,
    });
    const baselineCues = [
      {
        id: "holdout-cue",
        start: 60,
        end: 62,
        text: "誤り。",
        style: "dialogue" as const,
      },
    ];
    const proposals = buildCrossModelTextMutationProposals({
      generatedAt: GENERATED_AT,
      ledgers: [holdoutLedger],
      evidenceArtifacts: [holdoutEvidence],
      finalCues: baselineCues,
      productionEnforcementEnabled: freeze.enforcementEnabled,
    });
    const finalCues = applyCrossModelTextMutationProposals(
      baselineCues,
      proposals,
    );
    const ass = formatAss(finalCues);
    const srt = formatSrt(finalCues);
    const vtt = formatVtt(finalCues);
    expect(proposals.summary.appliedCount).toBe(1);
    expect(finalCues[0]).toMatchObject({
      text: "正解。",
      start: 60,
      end: 62,
    });
    expect(ass).toContain("正解。");
    expect(srt).toContain("正解。");
    expect(vtt).toContain("正解。");
    expect(proposals.reazonTimingUsed).toBe(false);
    expect(holdoutLedger.summary.selectReazonCount).toBe(1);
  });
});
