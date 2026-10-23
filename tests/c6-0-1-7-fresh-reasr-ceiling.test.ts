import {
  mvlWhisperServerResponseSchema,
  type MvlWhisperServerResponse,
} from "@mvl/shared";
import {
  buildAsrCeilingEvaluationV2,
  buildAssociationErrorTaxonomy,
  buildFreshCandidateComparison,
  buildFreshCandidateDrafts,
  buildMachineAcousticRiskVector,
  buildMachineFreshTargetedReAsr,
  buildMachineReAsrRiskV2,
  buildReAsrCausalEvaluation,
  freshCandidateInputs,
  machineQualitySemanticHash,
  planFreshTargetedReAsr,
  type ExecutedFreshReAsrRequest,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T12:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function utf8Hex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function response(text: string): MvlWhisperServerResponse {
  return mvlWhisperServerResponseSchema.parse({
    schema_version: "mvl-whisper-server-response/1.0.0",
    runtime: {
      whisper_cpp_version: "1.9.3",
      upstream_commit: "371b5a7561823ab2bb32142d2751e35e7534727b",
      patch_id: "mvl-mapped-token-raw-vad-json-v1",
      patch_sha256: HASH_A,
      binary_sha256: null,
      response_schema: "mvl-whisper-server-response/1.0.0",
      capabilities: {
        mapped_token_getter_available: true,
        mapped_token_getter_used: true,
        raw_vad_getter_available: true,
        raw_vad_getter_used: false,
        raw_and_mapped_token_times_emitted: true,
        raw_vad_segments_emitted: false,
        time_unit: "centiseconds",
      },
    },
    request: {
      response_format: "mvl_verbose_json_v1",
      language: "ja",
      translate: false,
      vad: false,
      token_timestamps: true,
      suppress_nst: true,
      max_len: 64,
      split_on_word: true,
      prompt_present: false,
    },
    task: "transcribe",
    language: "japanese",
    durationSeconds: 2,
    text,
    transcription: [
      {
        id: 0,
        text,
        startCentiseconds: 10,
        endCentiseconds: 100,
        startSeconds: 0.1,
        endSeconds: 1,
        coordinateSystem: "original-audio-local",
        tokens: [
          {
            index: 0,
            id: 100,
            text,
            textBytesHex: utf8Hex(text),
            special: false,
            probability: 0.95,
            raw: {
              startCentiseconds: 20,
              endCentiseconds: 80,
              coordinateSystem: "original-audio-local",
            },
            mapped: {
              startCentiseconds: 20,
              endCentiseconds: 80,
              coordinateSystem: "original-audio-local",
              method: "whisper_full_get_token_t0_t1",
            },
            dtwCentiseconds: null,
          },
        ],
        words: [
          {
            word: text,
            wordBytesHex: utf8Hex(text),
            memberTokenIndices: [0],
            probability: 0.95,
            rawStartCentiseconds: 20,
            rawEndCentiseconds: 80,
            mappedStartCentiseconds: 20,
            mappedEndCentiseconds: 80,
          },
        ],
        temperature: 0,
        avgLogProbability: -0.1,
        noSpeechProbability: 0.01,
      },
    ],
    vad_segments: [],
  });
}

function oldRiskInput(input: {
  eventId: string;
  tokenCoverage: number;
  requestEdgeRisk?: "NONE" | "WEAK" | "STRONG";
  ctcScore?: number;
  averageLogProbability?: number;
}) {
  return {
    eventId: input.eventId,
    candidateId: `candidate:${input.eventId}`,
    requestEdgeRisk: input.requestEdgeRisk ?? "NONE",
    ctcScore: input.ctcScore ?? 0.9,
    tokenCoverage: input.tokenCoverage,
    tokenConflict: false,
    speechCoverage: 1,
    decoderAvailability: "available" as const,
    averageLogProbability: input.averageLogProbability ?? -0.1,
    noSpeechProbability: 0.01,
    independentWindowDisagreement: "NONE" as const,
    repetitionRisk: 0,
    durationTextAnomaly: "NONE" as const,
    pronunciationCoverage: input.ctcScore ?? 0.9,
    associationAmbiguity: "NONE" as const,
    overlapRisk: "NONE" as const,
  };
}

function fixtureRisk() {
  const old = buildMachineAcousticRiskVector({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    events: [
      oldRiskInput({ eventId: "absence", tokenCoverage: 0 }),
      oldRiskInput({
        eventId: "positive",
        tokenCoverage: 1,
        requestEdgeRisk: "STRONG",
      }),
      oldRiskInput({
        eventId: "multi-support",
        tokenCoverage: 1,
        ctcScore: 0.3,
        averageLogProbability: -1.7,
      }),
    ],
  });
  return buildMachineReAsrRiskV2({
    mode: "enforce",
    riskVector: old.events,
    generatedAt: GENERATED_AT,
  });
}

describe("C6.0.1.7 corrected Re-ASR risk semantics", () => {
  it("treats low trusted-token coverage as evidence absence, not strong error", () => {
    const risk = fixtureRisk();
    const absence = risk.events.find((event) => event.eventId === "absence");
    expect(absence).toMatchObject({
      absenceOnly: true,
      eligibility: false,
      recommendedAction: "VERIFY",
      budgetSelected: false,
    });
    expect(
      absence?.riskFacts.find((fact) => fact.factType === "tokenWeak"),
    ).toMatchObject({
      evidenceClass: "EVIDENCE_ABSENCE",
      evidenceMissing: true,
      positiveErrorEvidence: false,
    });
    expect(risk.summary.selectedAbsenceOnlyEventCount).toBe(0);
  });

  it("selects positive error evidence and independent provider support only", () => {
    const risk = fixtureRisk();
    expect(
      risk.events.find((event) => event.eventId === "positive")?.budgetSelected,
    ).toBe(true);
    expect(
      risk.events.find((event) => event.eventId === "multi-support")
        ?.supportingEvidenceFamilies,
    ).toEqual(expect.arrayContaining(["CTC", "DECODER"]));
    expect(risk.summary.selectedEventCount).toBe(2);
  });

  it("does not select anything when the corrected risk mode is off", () => {
    const old = buildMachineAcousticRiskVector({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      events: [
        oldRiskInput({
          eventId: "positive",
          tokenCoverage: 1,
          requestEdgeRisk: "STRONG",
        }),
      ],
    });
    const risk = buildMachineReAsrRiskV2({
      mode: "off",
      riskVector: old.events,
      generatedAt: GENERATED_AT,
    });
    expect(risk.summary.selectedEventCount).toBe(0);
    expect(risk.events[0]?.budgetSelected).toBe(false);
  });
});

describe("C6.0.1.7 Fresh candidates and ceiling taxonomy", () => {
  it("keeps null-prompt Fresh request lineage through comparison and evaluation", () => {
    const risk = fixtureRisk();
    const plan = planFreshTargetedReAsr({
      risk: {
        ...risk,
        events: risk.events.filter((event) => event.eventId === "positive"),
        summary: {
          ...risk.summary,
          eventCount: 1,
          eligibleCount: 1,
          positiveErrorEvidenceEventCount: 1,
          supportingMultiFamilyEventCount: 0,
          evidenceAbsenceOnlyEventCount: 0,
          selectedEventCount: 1,
          selectedAbsenceOnlyEventCount: 0,
          plannedRequestCount: 3,
        },
      },
      eventIntervals: new Map([["positive", { start: 10, end: 12 }]]),
      sourceTotalSamples: 30 * 16_000,
      generationId: "fixture-generation",
    });
    const executions: ExecutedFreshReAsrRequest[] =
      plan[0]?.requests.map((request, index) => ({
        plan: request,
        extractionIdentity: machineQualitySemanticHash({
          request,
          kind: "wav",
        }),
        requestIdentity: machineQualitySemanticHash({ request, kind: "fresh" }),
        audioSha256: machineQualitySemanticHash({ request, kind: "audio" }),
        sampleCount:
          request.sourceGlobalSampleInterval.endSample -
          request.sourceGlobalSampleInterval.startSample,
        cacheHit: false,
        inferenceExecuted: true,
        modelLoadCount: index === 0 ? 1 : 0,
        processStartCount: index === 0 ? 1 : 0,
        transcriptionSeconds: 0.2,
        response: response("正しい文"),
      })) ?? [];
    const draft = buildFreshCandidateDrafts(executions)[0];
    if (draft === undefined)
      throw new Error("Fresh candidate fixture missing.");
    const fresh = buildMachineFreshTargetedReAsr({
      mode: "enforce",
      generationKind: "FRESH_INFERENCE",
      sourceMediaSha256: HASH_A,
      sourceTotalSamples: 30 * 16_000,
      plannedEvents: plan,
      executedRequests: executions,
      ctcEvidenceByCandidateId: new Map([
        [
          draft.candidateId,
          {
            status: "SCORABLE",
            score: 0.9,
            evidenceId: "ctc:fixture",
            runtimeIdentityHash: HASH_A,
            modelSnapshotHash: HASH_B,
            edgePinned: false,
            pronunciationStatus: "PROJECTED",
            projectionTextHash: HASH_A,
            unresolvedUnits: [],
          },
        ],
      ]),
      runtime: {
        whisperCppVersion: "v1.9.3",
        runtimeBinarySha256: HASH_A,
        runtimePatchSha256: HASH_B,
        modelSha256: HASH_A,
        modelBasename: "fixture-model.bin",
        device: "cpu",
      },
      generatedAt: GENERATED_AT,
    });
    expect(fresh.summary).toMatchObject({
      actualRequestCount: 3,
      freshInferenceCount: 3,
      modelLoadCount: 1,
      processStartCount: 1,
      promptIsolationPassed: true,
      freshReasrValidationPassed: true,
    });
    expect(fresh.candidates[0]).toMatchObject({
      text: "正しい文",
      windowSupportCount: 3,
      evidenceComplete: true,
    });

    const comparison = buildFreshCandidateComparison({
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "positive",
          originalCandidateId: "original",
          candidates: [
            {
              candidateId: "original",
              eventId: "positive",
              origin: "ORIGINAL",
              text: "誤り文",
              ctcSupport: 0.2,
              averageLogProbability: -1.5,
              noSpeechProbability: 0.2,
              independentWindowSupport: 1,
              trustedTokenCoverage: 0.1,
              speechCompleteness: 0.7,
              requestEdgeRisk: "WEAK",
              pronunciationSupport: 0.2,
              repetitionRisk: 0,
              hallucinationRisk: 0.3,
              evidenceComplete: false,
            },
            ...freshCandidateInputs(fresh.candidates),
          ],
          spanLineageSafe: true,
          associationSafe: true,
          safetyGatePass: true,
          applyReplacement: false,
        },
      ],
    });
    expect(comparison.events[0]).toMatchObject({
      outcome: "NEW_CANDIDATE_DOMINATES",
      replacementProposed: true,
      replacementApplied: false,
      applicationBlocker: "SELECTOR",
    });

    const causal = buildReAsrCausalEvaluation({
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "positive",
          baselineDistance: 0.8,
          oldPoolBestDistance: 0.8,
          freshPoolBestDistance: 0,
          runtimeSelectedDistance: 0.8,
          freshWindowUnstable: false,
          replacementApplied: false,
          evidenceIds: [fresh.semanticHash],
        },
      ],
    });
    const ceiling = buildAsrCeilingEvaluationV2({
      fresh,
      comparison,
      causal,
      generatedAt: GENERATED_AT,
    });
    expect(ceiling.summary).toMatchObject({
      selectorApplicationBlocker: 1,
      pipelineVsAsrDecision: "PIPELINE_STILL_PRIMARY",
      ceilingValidationPassed: true,
    });
  });

  it("separates expected many-to-one mappings from true association mismatch", () => {
    const taxonomy = buildAssociationErrorTaxonomy({
      generatedAt: GENERATED_AT,
      oldAssociationErrorCount: 2,
      errors: [
        {
          errorId: "many-to-one",
          eventIds: ["event-a", "event-b"],
          finalCueIds: ["cue-a"],
          trueWrongUtteranceAssignment: false,
          segmentationAmbiguity: false,
          eventBoundaryAmbiguity: false,
          spanLineageAmbiguity: false,
          evidenceIds: ["alignment:a"],
        },
        {
          errorId: "true-mismatch",
          eventIds: ["event-c"],
          finalCueIds: ["cue-c"],
          trueWrongUtteranceAssignment: true,
          segmentationAmbiguity: false,
          eventBoundaryAmbiguity: false,
          spanLineageAmbiguity: false,
          evidenceIds: ["assignment:c"],
        },
      ],
    });
    expect(taxonomy.summary).toMatchObject({
      manyToOneExpectedCount: 1,
      trueAssociationMismatchCount: 1,
    });
  });
});
