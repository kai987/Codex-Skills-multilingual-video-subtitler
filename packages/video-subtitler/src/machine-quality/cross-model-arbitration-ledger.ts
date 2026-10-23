import {
  c60110PolicyVersion,
  machineCrossModelArbitrationLedgerSchema,
  type C60110PolicyProfileName,
  type C60110PolicyProfiles,
  type C60110Scope,
  type MachineCrossModelArbitrationEvidence,
  type MachineCrossModelArbitrationLedger,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import { arbitrateCrossModelCandidate } from "./cross-model-arbitration-policy.js";

export function buildMachineCrossModelArbitrationLedger(input: {
  generatedAt: string;
  scope: C60110Scope;
  evidence: MachineCrossModelArbitrationEvidence;
  profiles: C60110PolicyProfiles;
  profileName: C60110PolicyProfileName;
  arbitrationPolicyHash: string;
  productionEnforcementEnabled: boolean;
}): MachineCrossModelArbitrationLedger {
  const events = input.evidence.events.map((bundle) =>
    arbitrateCrossModelCandidate({
      bundle,
      profiles: input.profiles,
      profileName: input.profileName,
      productionEnforcementEnabled: input.productionEnforcementEnabled,
    }),
  );
  const blocked = events.filter((event) =>
    event.decision.startsWith("BLOCKED_"),
  ).length;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60110PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-cross-model-arbitration-ledger" as const,
    scope: input.scope,
    evidenceSemanticHash: input.evidence.semanticHash,
    policyProfile: input.profileName,
    arbitrationPolicyHash: input.arbitrationPolicyHash,
    productionEnforcementEnabled: input.productionEnforcementEnabled,
    decisionsFrozenBeforeGold: true as const,
    events,
    summary: {
      eventCount: events.length,
      agreementNoChangeCount: events.filter(
        (event) => event.decision === "AGREEMENT_NO_CHANGE",
      ).length,
      selectReazonCount: events.filter(
        (event) => event.decision === "SELECT_REAZON",
      ).length,
      keepWhisperCount: events.filter(
        (event) => event.decision === "KEEP_CURRENT_WHISPER",
      ).length,
      abstainCount: events.filter(
        (event) => event.decision === "ABSTAIN_REVIEW",
      ).length,
      blockedCount: blocked,
      mutationEligibleCount: events.filter((event) => event.mutationEligible)
        .length,
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineCrossModelArbitrationLedgerSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
