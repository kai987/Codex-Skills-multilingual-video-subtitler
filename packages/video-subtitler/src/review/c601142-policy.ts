import {
  policy142Schema,
  type Policy142,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { assertHash141, hashed141 } from "./c601141-policy.js";

export function policy142(): Policy142 {
  return policy142Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: "c6.0.1.14.2-safety-selection-detector-ceiling-v1",
      cluster: {
        maximumGapSeconds: 0.3,
        maximumEnvelopeSeconds: 12,
        minimumCoreSeconds: 0.12,
        silenceBridgingAllowed: false,
        cueCrossingAllowed: false,
        targetCrossingAllowed: false,
        sceneCrossingAllowed: false,
        speakerCrossingAllowed: false,
      },
      selection: {
        maximumTargets: 24,
        maximumCoreUnionSeconds: 60,
        reservedExclusiveSlots: 4,
        binSeconds: 60,
        localWindowSeconds: 15,
        maximumLocalTargets: 3,
        preserveOldCoverage: true,
        sourceTimeTieBreakOnly: true,
        weights: {
          evidence: 6,
          newSeconds: 4,
          newFamily: 8,
          newStratum: 12,
          newBin: 10,
          newScene: 6,
          independent: 3,
          redundancy: 20,
          density: 8,
          slotCost: 1,
          unionCost: 0.2,
        },
      },
      detectors: {
        maximumRuns: 8,
        maximumWebrtc: 4,
        maximumSilero: 2,
        maximumPyannote: 2,
        retryCount: 0,
        backfillAllowed: false,
        sileroMainThreshold: 0.2,
        sileroAuditThreshold: 0.1,
        pyannoteMainThreshold: 0.5,
        pyannoteAuditThreshold: 0.25,
        subthresholdMinimumSeconds: 0.12,
        webrtc: {
          sampleRate: 16000,
          channels: 1,
          bitDepth: 16,
          frameMs: 20,
          aggressiveness: 0,
          mergeGapMs: 160,
          minimumSpeechMs: 100,
          paddingMs: 40,
          maximumIntervalSeconds: 12,
        },
      },
      masked: {
        minimumVoiceBandRatio: 0.25,
        minimumModulationRatio: 0.08,
        maximumFlatness: 0.75,
        minimumRms: 0.0005,
        energyAloneAllowed: false,
        sameFamilyVotesIndependent: false,
      },
      asr: {
        maximumTargets: 4,
        maximumContextTargets: 2,
        maximumRequests: 12,
        contextSeconds: 0.75,
        prompt: "",
        vadEnabled: false,
        retryCount: 0,
        backfillAllowed: false,
        fullMediaAllowed: false,
      },
      coverage: {
        majority: 0.5,
        audible: 0.8,
        full: 0.95,
        maximumEpisodeBurden: 0.95,
      },
      goldBlind: true,
      rankerRetrained: false,
      canonicalMutationAllowed: false,
    }),
  );
}
export function header142(
  policy: Policy142,
  sourceIdentity: C60114SourceIdentity,
) {
  assertHash141(policy);
  return {
    schemaVersion: "1.0.0" as const,
    policyVersion: policy.policyVersion,
    policyHash: policy.semanticHash,
    sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES" as const,
    runtimeGoldInputCount: 0 as const,
    visibility: "LOCAL_ONLY" as const,
  };
}
export function assertBudget142(
  kind: "DETECTOR" | "ASR",
  planned: number,
  consumed = 0,
) {
  const limit = kind === "DETECTOR" ? 8 : 12;
  if (
    ![planned, consumed].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    planned + consumed > limit
  )
    throw new Error(`C601142_${kind}_BUDGET_EXCEEDED`);
}
export function authorized142(kind: "DETECTOR" | "ASR", explicit: boolean) {
  return (
    explicit ||
    process.env[
      `MVL_C601142_${kind === "DETECTOR" ? "DETECTOR_CEILING" : "LOCAL_ASR"}_AUTHORIZED`
    ] === "1"
  );
}
