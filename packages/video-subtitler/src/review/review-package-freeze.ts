import { readFile } from "node:fs/promises";
import path from "node:path";

import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  assertC60112MachineOnlyInput,
  assertC60112ReviewPolicy,
  type C60112ReviewPolicy,
} from "./c60112-policy.js";
import {
  assertC60112ReviewWorkspaceData,
  startC60112ReviewWorkspaceServer,
  type C60112ReviewWorkspaceData,
} from "./c60112-review-workspace.js";
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

function sourceMediaHash(
  workspaceData: C60112ReviewWorkspaceData,
): string | null {
  const identity = workspaceData.sourceMediaIdentity;
  const value = identity.sourceMediaSha256 ?? identity.sha256;
  return typeof value === "string" ? value : null;
}

/**
 * Validate a persisted freeze record without trusting any self-reported hash.
 * The aggregate covers every frozen component hash; the semantic hash covers
 * the complete freeze record except itself.
 */
export function assertC60112ReviewPackageFreezeIntegrity(
  freeze: C60112ReviewPackageFreeze,
): void {
  for (const [label, value] of Object.entries({
    sourceMediaSha256: freeze.sourceMediaSha256,
    machineDraftHash: freeze.machineDraftHash,
    itemHash: freeze.itemHash,
    priorityHash: freeze.priorityHash,
    regionHash: freeze.regionHash,
    candidateHash: freeze.candidateHash,
    audioManifestHash: freeze.audioManifestHash,
    workspaceDataHash: freeze.workspaceDataHash,
    policyHash: freeze.policyHash,
    aggregateHash: freeze.aggregateHash,
    semanticHash: freeze.semanticHash,
  })) {
    assertSha256(value, label);
  }
  const expectedAggregateHash = machineQualitySemanticHash({
    sourceMediaSha256: freeze.sourceMediaSha256,
    machineDraftHash: freeze.machineDraftHash,
    itemHash: freeze.itemHash,
    priorityHash: freeze.priorityHash,
    regionHash: freeze.regionHash,
    candidateHash: freeze.candidateHash,
    audioManifestHash: freeze.audioManifestHash,
    workspaceDataHash: freeze.workspaceDataHash,
    policyHash: freeze.policyHash,
  });
  if (freeze.aggregateHash !== expectedAggregateHash) {
    throw new Error("REVIEW_PACKAGE_FREEZE_AGGREGATE_HASH_MISMATCH");
  }
  const { semanticHash, ...core } = freeze;
  if (semanticHash !== machineQualitySemanticHash(core)) {
    throw new Error("REVIEW_PACKAGE_FREEZE_SEMANTIC_HASH_MISMATCH");
  }
}

/**
 * Bind a parsed review-data object to the pre-Gold package freeze. This hashes
 * the complete object rather than trusting review-data's embedded identities.
 */
export function assertC60112FrozenWorkspaceData(input: {
  freeze: C60112ReviewPackageFreeze;
  workspaceData: C60112ReviewWorkspaceData;
}): string {
  assertC60112ReviewPackageFreezeIntegrity(input.freeze);
  assertC60112ReviewWorkspaceData(input.workspaceData);
  const actualWorkspaceDataHash = machineQualitySemanticHash(
    input.workspaceData,
  );
  if (actualWorkspaceDataHash !== input.freeze.workspaceDataHash) {
    throw new Error(
      `REVIEW_WORKSPACE_DATA_FREEZE_HASH_MISMATCH: expected ${input.freeze.workspaceDataHash}, received ${actualWorkspaceDataHash}`,
    );
  }
  if (
    input.workspaceData.machineDraftHash !== input.freeze.machineDraftHash ||
    input.workspaceData.policyHash !== input.freeze.policyHash ||
    input.workspaceData.policyVersion !== input.freeze.policyVersion
  ) {
    throw new Error("REVIEW_WORKSPACE_DATA_FREEZE_IDENTITY_MISMATCH");
  }
  const workspaceSourceMediaHash = sourceMediaHash(input.workspaceData);
  if (
    workspaceSourceMediaHash === null ||
    workspaceSourceMediaHash !== input.freeze.sourceMediaSha256
  ) {
    throw new Error("REVIEW_WORKSPACE_SOURCE_FREEZE_IDENTITY_MISMATCH");
  }
  return actualWorkspaceDataHash;
}

export interface C60112FrozenReviewWorkspaceServerInput {
  workspaceDirectory: string;
  freeze: C60112ReviewPackageFreeze;
  host?: string;
  port?: number;
}

/**
 * Production server entrypoint. The lower-level server remains available only
 * from its internal module for tests; package consumers must cross this freeze
 * gate. A second read closes the narrow startup TOCTOU window.
 */
export async function startC60112FrozenReviewWorkspaceServer(
  input: C60112FrozenReviewWorkspaceServerInput,
): Promise<{
  host: "127.0.0.1";
  port: number;
  url: string;
  freezeSemanticHash: string;
  workspaceDataHash: string;
  close: () => Promise<void>;
}> {
  const reviewDataPath = path.join(
    path.resolve(input.workspaceDirectory),
    "review-data.json",
  );
  const loadAndVerify = async (): Promise<C60112ReviewWorkspaceData> => {
    const parsed = JSON.parse(
      await readFile(reviewDataPath, "utf8"),
    ) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("REVIEW_WORKSPACE_DATA_MUST_BE_OBJECT");
    }
    const workspaceData = parsed as C60112ReviewWorkspaceData;
    assertC60112FrozenWorkspaceData({
      freeze: input.freeze,
      workspaceData,
    });
    return workspaceData;
  };
  const before = await loadAndVerify();
  const running = await startC60112ReviewWorkspaceServer({
    workspaceDirectory: input.workspaceDirectory,
    ...(input.host === undefined ? {} : { host: input.host }),
    ...(input.port === undefined ? {} : { port: input.port }),
    expectedWorkspaceDataHash: input.freeze.workspaceDataHash,
  });
  try {
    const after = await loadAndVerify();
    if (
      machineQualitySemanticHash(before) !== machineQualitySemanticHash(after)
    ) {
      throw new Error("REVIEW_WORKSPACE_DATA_CHANGED_DURING_SERVER_START");
    }
  } catch (error) {
    await running.close();
    throw error;
  }
  return {
    ...running,
    freezeSemanticHash: input.freeze.semanticHash,
    workspaceDataHash: input.freeze.workspaceDataHash,
  };
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
