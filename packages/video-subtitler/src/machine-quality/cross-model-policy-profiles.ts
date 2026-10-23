import {
  c60110PolicyProfilesSchema,
  c60110PolicyVersion,
  type C60110PolicyProfiles,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildC60110PolicyProfiles(input: {
  generatedAt: string;
}): C60110PolicyProfiles {
  const rawProfiles = [
    {
      profile: "CONSERVATIVE" as const,
      productionEligible: true,
      minimumIndependentSupportingFamilies: 2,
      requireStrongWhisperNegativeEvidence: true,
    },
    {
      profile: "BALANCED" as const,
      productionEligible: true,
      minimumIndependentSupportingFamilies: 1,
      requireStrongWhisperNegativeEvidence: false,
    },
    {
      profile: "AGGRESSIVE_SHADOW" as const,
      productionEligible: false,
      minimumIndependentSupportingFamilies: 1,
      requireStrongWhisperNegativeEvidence: false,
    },
  ];
  const profiles = rawProfiles.map((profile) => {
    const core = {
      ...profile,
      requireReazonStable: true as const,
      requireSafeExactSpan: true as const,
      allowOrthographyOnlySwitch: false as const,
      allowCtcToSelectWinner: false as const,
      allowCtcAsVeto: true as const,
      allowRawConfidenceComparison: false as const,
      allowCorrelatedVotesAsIndependent: false as const,
      allowUnresolvedCrossEventAmbiguity: false as const,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60110PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-10-policy-profiles" as const,
    defaultDecision: "KEEP_CURRENT_WHISPER" as const,
    profilesFrozenBeforeDevGold: true as const,
    profiles,
    runtimeGoldInputCount: 0 as const,
  };
  return c60110PolicyProfilesSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
