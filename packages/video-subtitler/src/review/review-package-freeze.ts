import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  assertC60112MachineOnlyInput,
  assertC60112ReviewPolicy,
  type C60112ReviewPolicy,
} from "./c60112-policy.js";
import type { C60112ReviewCandidateBundlesArtifact } from "./review-candidate-bundle.js";
import type { C60112MachineReviewItemsArtifact } from "./review-item-builder.js";
import type { C60112ReviewPriorityArtifact } from "./review-priority.js";
import type { C60112ReviewRegionsArtifact } from "./review-region-clustering.js";

export interface C60112ReviewPackageFreeze {
  schemaVersion: "1.0.0";
  policyVersion: C60112ReviewPolicy["policyVersion"];
  artifactType: "c6-0-1-12-review-package-freeze";
  frozenAt: string;
  sourceMediaSha256: string;
  machineDraftHash: string;
  itemHash: string;
  priorityHash: string;
  regionHash: string;
  candidateHash: string;
  audioManifestHash: string;
  workspaceDataHash: string;
  policyHash: string;
  aggregateHash: string;
  runtimeGoldInputCount: 0;
  goldAccessBeforeFreezeCount: 0;
  frozenBeforeGoldEvaluation: true;
  semanticHash: string;
}

export interface C60112ReviewPackageFreezeInput {
  frozenAt: string;
  sourceMediaSha256: string;
  machineDraftHash: string;
  policy: C60112ReviewPolicy;
  items: C60112MachineReviewItemsArtifact;
  priority: C60112ReviewPriorityArtifact;
  regions: C60112ReviewRegionsArtifact;
  candidates: C60112ReviewCandidateBundlesArtifact;
  audioManifest: unknown;
  workspaceData: unknown;
}

function assertSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`INVALID_SHA256:${label}`);
  }
}

function assertPolicyBinding(
  artifact: { policyHash: string },
  expectedPolicyHash: string,
  label: string,
): void {
  if (artifact.policyHash !== expectedPolicyHash) {
    throw new Error(`REVIEW_POLICY_HASH_MISMATCH:${label}`);
  }
}

export function buildC60112ReviewPackageFreeze(
  input: C60112ReviewPackageFreezeInput,
): C60112ReviewPackageFreeze {
  assertC60112ReviewPolicy(input.policy);
  assertC60112MachineOnlyInput(
    {
      items: input.items,
      priority: input.priority,
      regions: input.regions,
      candidates: input.candidates,
      audioManifest: input.audioManifest,
      workspaceData: input.workspaceData,
    },
    "freeze-review-package",
  );
  assertSha256(input.sourceMediaSha256, "sourceMediaSha256");
  assertSha256(input.machineDraftHash, "machineDraftHash");
  assertPolicyBinding(input.items, input.policy.semanticHash, "items");
  assertPolicyBinding(input.priority, input.policy.semanticHash, "priority");
  assertPolicyBinding(input.regions, input.policy.semanticHash, "regions");
  assertPolicyBinding(
    input.candidates,
    input.policy.semanticHash,
    "candidates",
  );
  const componentHashes = {
    itemHash: machineQualitySemanticHash(input.items),
    priorityHash: machineQualitySemanticHash(input.priority),
    regionHash: machineQualitySemanticHash(input.regions),
    candidateHash: machineQualitySemanticHash(input.candidates),
    audioManifestHash: machineQualitySemanticHash(input.audioManifest),
    workspaceDataHash: machineQualitySemanticHash(input.workspaceData),
    policyHash: input.policy.semanticHash,
  };
  const aggregateHash = machineQualitySemanticHash({
    sourceMediaSha256: input.sourceMediaSha256,
    machineDraftHash: input.machineDraftHash,
    ...componentHashes,
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: input.policy.policyVersion,
    artifactType: "c6-0-1-12-review-package-freeze" as const,
    frozenAt: input.frozenAt,
    sourceMediaSha256: input.sourceMediaSha256,
    machineDraftHash: input.machineDraftHash,
    ...componentHashes,
    aggregateHash,
    runtimeGoldInputCount: 0 as const,
    goldAccessBeforeFreezeCount: 0 as const,
    frozenBeforeGoldEvaluation: true as const,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

export function verifyC60112ReviewPackageFreeze(input: {
  freeze: C60112ReviewPackageFreeze;
  packageInput: Omit<C60112ReviewPackageFreezeInput, "frozenAt">;
}): boolean {
  const rebuilt = buildC60112ReviewPackageFreeze({
    ...input.packageInput,
    frozenAt: input.freeze.frozenAt,
  });
  return (
    rebuilt.semanticHash === input.freeze.semanticHash &&
    rebuilt.aggregateHash === input.freeze.aggregateHash
  );
}
