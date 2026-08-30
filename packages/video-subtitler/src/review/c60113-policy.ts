import {
  c60113PolicyVersion,
  c60113ReviewPolicySchema,
  type C60113ReviewPolicy,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";

export const C60113_POLICY_VERSION = c60113PolicyVersion;

export function withC60113SemanticHash<T extends object>(
  value: T,
): T & { semanticHash: string } {
  return { ...value, semanticHash: machineQualitySemanticHash(value) };
}

export function c60113ArtifactHeader(policy: C60113ReviewPolicy) {
  return {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60113_POLICY_VERSION,
    policyHash: policy.semanticHash,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
    runtimeGoldInputCount: 0 as const,
  };
}

export function buildC60113ReviewPolicy(): C60113ReviewPolicy {
  return c60113ReviewPolicySchema.parse(
    withC60113SemanticHash({
      schemaVersion: "1.0.0",
      policyVersion: C60113_POLICY_VERSION,
      artifactType: "c6-0-1-13-review-rank-policy",
      productRoute: "HUMAN_ON_EXCEPTION",
      missingSpeech: {
        minimumIndependentStrongFamilies: 3,
        maximumCoveredRatioForMissing: 0.1,
        lexicalMinimumIntervalCoverage: 0.5,
        strongContradictionThreshold: 0.8,
        legacyDefault: "SPEECH_GAP_OBSERVED",
      },
      evidenceCorrelation: {
        sharedRootIsCorrelated: true,
        sameProviderFamilyIsCorrelated: true,
        absenceRiskWeight: 0,
        independentBreadth: "DISTINCT_FAMILY_DISJOINT_ROOT_MATCHING",
      },
      mandatoryRules: {
        strongEvidenceThreshold: 0.8,
        minimumTimingFamilies: 2,
        requiredSeparatedFromDisplayScore: true,
      },
      itemPriority: {
        mainOrder: "STRUCTURED_VECTOR",
        displayMeaning: "NOT_PROBABILITY",
        reasonCountBoost: 0,
      },
      regionMerge: {
        maximumCoreSeconds: 30,
        maximumGapSeconds: 0.75,
        minimumContextOverlapRatio: 0.4,
        maximumIncrementalSeconds: 12,
        preContextSeconds: 1.5,
        postContextSeconds: 1.5,
        preserveScene: true,
        preserveSpeaker: true,
        preserveCategory: true,
      },
      regionAggregation: "DEDUPLICATED_RISK_FAMILIES_CUES_EVENTS_COST",
      playbackUnion: "SOURCE_GLOBAL_HALF_OPEN_SORTED_MERGED",
      marginalUtility: {
        riskWeight: 1,
        mandatoryWeight: 4,
        actionableWeight: 0.5,
        redundancyPenaltyWeight: 0.15,
        fixedReviewOverheadSeconds: 8,
        minimumAudioCostSeconds: 1,
      },
      percentBudgets: [10, 20, 30, 40, 50],
      fixedSecondsBudgets: [90, 180, 270, 360, 450],
      fallbackRanker: "REGION_RISK_DENSITY_V3",
      goldBarrier: {
        runtimeGoldInputAllowed: false,
        freezeBeforeLabels: true,
        foldsBeforeLabels: true,
        sameVersionRetuneAllowed: false,
      },
      prospectiveTrial: {
        priorGoldExposureDisqualifies: true,
        realHumanEpisodeOneTrialAllowed: false,
        instrumentationIsNotMeasuredHumanTime: true,
      },
    }),
  );
}

export function assertC60113Policy(policy: C60113ReviewPolicy): void {
  c60113ReviewPolicySchema.parse(policy);
  const { semanticHash, ...core } = policy;
  if (machineQualitySemanticHash(core) !== semanticHash) {
    throw new Error("C60113_POLICY_HASH_MISMATCH");
  }
  if (semanticHash !== buildC60113ReviewPolicy().semanticHash) {
    throw new Error("C60113_POLICY_VERSION_REQUIRES_FROZEN_CONSTANTS");
  }
}

export function uniqueC60113(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted();
}
