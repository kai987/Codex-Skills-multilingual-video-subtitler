import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  asrRequestTimelineContractV2Schema,
  c6014QualityComparisonSchema,
  machineCandidatePoolSufficiencySchema,
  machineGlobalTokenTimelineV2Schema,
  machineTargetedEventReasrSchema,
  machineTextReplacementContractSchema,
  machineTextVariantAcousticVerificationSchema,
  machineTextVariantDecisionSchema,
  machineVadGlobalTimebaseSchema,
} from "@mvl/shared";
import {
  assessCandidatePoolSufficiency,
  buildAcousticTextVariantVerification,
  buildC6014QualityComparison,
  buildGlobalTokenTimelineV2,
  buildRequestTimelineV2,
  buildTargetedEventReasrArtifact,
  buildTextReplacementContract,
  buildVadGlobalTimebase,
  createRequestTimelineV2Entry,
  createSampleTransform,
  machineQualitySemanticHash,
  planTargetedEventReasr,
  projectJapanesePronunciation,
  resolveTextVariants,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-28T00:00:00.000Z";
const SOURCE_HASH = "a".repeat(64);
const AUDIO_HASH = "b".repeat(64);
const CACHE_HASH = "c".repeat(64);
const MODEL_HASH = "d".repeat(64);

describe("C6.0.1.4 VAD, variant, and re-ASR artifact flow", () => {
  it("round-trips strict machine-only artifacts and keeps mutation fail-closed", async () => {
    const transform = createSampleTransform({
      transformId: "source-to-fresh-vad",
      parentArtifactId: "source-pcm",
      parentArtifactSha256: SOURCE_HASH,
      childArtifactId: "fresh-vad-audio",
      childArtifactSha256: AUDIO_HASH,
      parentSampleRate: 16_000,
      childSampleRate: 16_000,
      parentTotalSamples: 320_000,
      childTotalSamples: 32_000,
      childStartSampleInParent: 160_000,
      childEndSampleInParent: 192_000,
      extractionMethod: "direct-source-ffmpeg-sample-trim",
      ffmpeg: {
        inputSeekPlacement: "before-input",
        inputSeekSample: 160_000,
        outputTrimStartSample: 0,
        outputDurationSamples: 32_000,
        atrimUsed: true,
        asetptsReset: true,
        resampleUsed: true,
        paddingSamples: 0,
        commandIdentity: "e".repeat(64),
      },
      resamplingIdentity: "f".repeat(64),
      verificationReasons: ["sample-count-verified"],
    });
    const vad = buildVadGlobalTimebase({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      sourceIdentity: {
        sourceMediaSha256: SOURCE_HASH,
        sourceSampleRate: 16_000,
        sourceTotalSamples: 320_000,
        sourceReadOnlyVerified: true,
      },
      vadProviderIdentity: {
        provider: "whisper.cpp-silero-vad",
        whisperVersion: "1.9.3",
        whisperBinarySha256: "1".repeat(64),
        vadModelSha256: "2".repeat(64),
        capabilityHash: "3".repeat(64),
        mappedGetterUsed: true,
        rawVadGetterUsed: true,
        requestStateIsolation: "fresh-state-per-request",
      },
      legacyQuarantinedRequestIds: ["legacy-vad"],
      requests: [
        {
          requestId: "fresh-vad",
          extractedAudioId: "fresh-vad-audio",
          extractedAudioSha256: AUDIO_HASH,
          sourceClipTransform: transform,
          cacheIdentity: CACHE_HASH,
          providerSegments: [
            {
              index: 0,
              startCentiseconds: 10,
              endCentiseconds: 150,
              coordinateSystem: "original-audio-local",
            },
          ],
          mappedGetterUsed: true,
          rawVadGetterUsed: true,
          mappingVerified: true,
          failureReasons: [],
        },
      ],
    });
    const request = createRequestTimelineV2Entry({
      requestId: "fresh-vad",
      legacyRequestId: "legacy-vad",
      sourceMediaSha256: SOURCE_HASH,
      sourceClipTransform: transform,
      parentChain: ["fresh-vad-audio", "source-pcm"],
      extractedAudioSha256: AUDIO_HASH,
      extractedSampleRate: 16_000,
      extractedSampleCount: 32_000,
      tokenTimeBase: "mapped-original-audio-local",
      mappingStatus: "VERIFIED",
      mappingReason: "fresh-mapped-token-getter",
      cacheIdentity: CACHE_HASH,
      cacheEntrySha256: "4".repeat(64),
      modelIdentity: MODEL_HASH,
      vadEnabled: true,
      promptPresent: false,
      freshEvidence: true,
    });
    const timeline = buildRequestTimelineV2({
      sourceMediaSha256: SOURCE_HASH,
      vadGlobalTimebaseSemanticHash: vad.semanticHash,
      requests: [request],
      generatedAt: GENERATED_AT,
    });
    const tokens = buildGlobalTokenTimelineV2({
      requestTimeline: timeline,
      observations: [
        {
          tokenId: "fresh-token-1",
          requestId: "fresh-vad",
          cueId: "variant-a",
          text: "おはよう",
          probability: 0.9,
          localStartCentiseconds: 20,
          localEndCentiseconds: 80,
          coordinateSystem: "mapped-original-audio-local",
          associationStatus: "assigned",
          cacheIdentity: CACHE_HASH,
          freshEvidence: true,
        },
      ],
      generatedAt: GENERATED_AT,
    });
    const acoustic = buildAcousticTextVariantVerification({
      mode: "enforce",
      ctcRuntimeIdentityHash: "5".repeat(64),
      ctcModelSnapshotHash: "6".repeat(64),
      pronunciationRuntimeIdentityHash: "7".repeat(64),
      workerStartCount: 0,
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          audioEvidenceId: "event-audio-1",
          audioInterval: { start: 10, end: 12 },
          audioSha256: AUDIO_HASH,
          variants: [
            {
              variantId: "variant-a",
              displayText: "おはよう",
              projection: projectJapanesePronunciation({
                projectionId: "projection-a",
                displayText: "おはよう",
              }),
              attempts: [],
            },
            {
              variantId: "variant-b",
              displayText: "おはよ",
              projection: projectJapanesePronunciation({
                projectionId: "projection-b",
                displayText: "おはよ",
              }),
              attempts: [],
            },
          ],
        },
      ],
    });
    const decisions = resolveTextVariants({
      mode: "enforce",
      acousticVerification: acoustic,
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          currentSelectedVariantId: "variant-b",
          variants: ["variant-a", "variant-b"].map((variantId) => ({
            variantId,
            hardRejectReasons: [],
            independentSupportCount: 1,
            trustedTokenSupportCount: variantId === "variant-a" ? 1 : 0,
            trustedTokenConflict: false,
            decoderEvidence: "machine-only",
            edgeTruncationRisk: false,
            linguisticTieBreakRank: null,
            orthographicReadingGroup: null,
          })),
        },
      ],
    });
    const pool = assessCandidatePoolSufficiency({
      acousticVerification: acoustic,
      decisions,
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          candidateCount: 2,
          independentWindowDisagreement: true,
          trustedTokenConflict: false,
          fullSpeechSpanCovered: false,
        },
      ],
    });
    const plan = planTargetedEventReasr({
      events: [{ eventId: "event-1", interval: { start: 10, end: 12 } }],
      decisions,
      poolSufficiency: pool,
      sourceSampleRate: 16_000,
      sourceTotalSamples: 320_000,
    });
    const executed =
      plan.events[0]?.requests.map((planned, index) => ({
        plan: planned,
        extractedAudioSha256: machineQualitySemanticHash(planned),
        extractedSampleRate: 16_000,
        extractedSampleCount:
          planned.sourceGlobalSampleInterval.endSample -
          planned.sourceGlobalSampleInterval.startSample,
        cacheIdentity: machineQualitySemanticHash({ planned, index }),
        cacheHit: false,
        inferenceExecuted: true,
        modelLoadCount: index === 0 ? 1 : 0,
        workerStartCount: index === 0 ? 1 : 0,
        responseText: "おはよう",
        responseInterval: { start: 10.1, end: 11.8 },
        tokenEvidenceIds: [`targeted-token-${index}`],
        decoderEvidenceHash: machineQualitySemanticHash(index),
      })) ?? [];
    const reasr = buildTargetedEventReasrArtifact({
      mode: "enforce",
      eligibleEventCount: plan.eligibleEventCount,
      budgetExhaustedCount: plan.budgetExhaustedCount,
      plannedEvents: plan.events,
      executedRequests: executed,
      generatedAt: GENERATED_AT,
    });
    const replacement = buildTextReplacementContract({
      proposals: [
        {
          fromCandidateId: "variant-b",
          fromText: "おはよ",
          toCandidateId:
            reasr.events[0]?.candidateOutputs[0]?.candidateId ?? "missing",
          toText: "おはよう",
          eventId: "event-1",
          evidenceTierBefore: "WEAK",
          evidenceTierAfter: "STRONG",
          acousticComparison: "DOMINATES",
          tokenComparison: "MORE_SUPPORT",
          independentSupportBefore: 1,
          independentSupportAfter: 2,
          toCandidateIsRealMachineCandidate: true,
          timingProposalId: null,
          timingNonDegradationPassed: false,
        },
      ],
      beforeTextHash: "8".repeat(64),
      afterTextHash: "8".repeat(64),
      beforeTimingHash: "9".repeat(64),
      afterTimingHash: "9".repeat(64),
      presentationHash: "0".repeat(64),
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      presentationMutationCount: 0,
      generatedAt: GENERATED_AT,
    });
    const metrics = {
      cueCount: 161,
      exactCer: 0.66,
      normalizedCer: 0.6,
      goldCoverage: 0.96,
      missingCount: 6,
      hallucinationCount: 1,
      materialErrorCount: 76,
      severeTimingErrorCount: 53,
      startMaeSeconds: 1.63,
      endMaeSeconds: 1.65,
      p95BoundaryErrorSeconds: 6.44,
      medianTemporalIou: 0.58,
      overlapPairCount: 48,
      trustedMappedTokenCount: tokens.summary.trustedMappedTokenCount,
      ambiguousTimeBaseTokenCount: tokens.summary.ambiguousTimeBaseTokenCount,
    };
    const comparison = buildC6014QualityComparison({
      rawAsr: metrics,
      baseline: metrics,
      candidate: metrics,
      selectorRecoveryPassed: false,
      candidatePoolRecoveryPassed: false,
      vadTimebaseRecoveryPassed: true,
      tokenTimelineRecoveryPassed: true,
      reproducible: true,
      generatedAt: GENERATED_AT,
    });
    const root = await mkdtemp(path.join(tmpdir(), "c6-0-1-4-flow-"));
    const artifacts = [
      ["vad.json", vad, machineVadGlobalTimebaseSchema],
      ["request.json", timeline, asrRequestTimelineContractV2Schema],
      ["tokens.json", tokens, machineGlobalTokenTimelineV2Schema],
      ["acoustic.json", acoustic, machineTextVariantAcousticVerificationSchema],
      ["decision.json", decisions, machineTextVariantDecisionSchema],
      ["pool.json", pool, machineCandidatePoolSufficiencySchema],
      ["reasr.json", reasr, machineTargetedEventReasrSchema],
      ["replacement.json", replacement, machineTextReplacementContractSchema],
      ["comparison.json", comparison, c6014QualityComparisonSchema],
    ] as const;
    for (const [fileName, artifact, schema] of artifacts) {
      const target = path.join(root, fileName);
      await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
      expect(
        schema.safeParse(JSON.parse(await readFile(target, "utf8"))).success,
      ).toBe(true);
    }
    expect(vad.guessedOffsetCount).toBe(0);
    expect(tokens.summary.trustedMappedTokenCount).toBe(1);
    expect(plan.events[0]?.requests).toHaveLength(3);
    expect(reasr.summary.runtimeGoldInputCount).toBe(0);
    expect(replacement.summary.acceptedCount).toBe(0);
    expect(replacement.summary.canonicalTextMutationCount).toBe(0);
    expect(comparison.outcome).toBe("HOLD_FOR_MORE_ACOUSTIC_TEXT_RECOVERY");
  });
});
