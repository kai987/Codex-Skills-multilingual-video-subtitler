import path from "node:path";
import {
  c6121FreezeSchema,
  type C6121Baseline,
  type C6121Map,
} from "@mvl/shared";
import { c6121Artifact, demand } from "./c6121-policy.js";
import {
  fingerprintC6121,
  readC6121Artifact,
} from "./baseline-freeze-verification.js";
export const C6121_FROZEN_EVALUATOR_FILES = [
  "c6-1-2-1-evaluator-supergroup-map.json",
  "c6-1-2-1-bipartite-edge-ledger.json",
  "c6-1-2-1-policy-freeze.json",
  "gold-c6-1-2-1-timing-only-input.json",
  "c6-1-2-1-training-contract-parity.json",
  "c6-1-2-1-e1-historical-bipartite-replay.json",
] as const;
export async function freezeC6121Evaluator(
  directory: string,
  baseline: C6121Baseline,
  map: C6121Map,
  timingBarrierHash: string,
) {
  const frozenFiles = [];
  for (const relativePath of C6121_FROZEN_EVALUATOR_FILES) {
    await readC6121Artifact(path.join(directory, relativePath));
    frozenFiles.push({
      relativePath,
      sha256: (
        await fingerprintC6121(path.join(directory, relativePath), relativePath)
      ).sha256,
    });
  }
  const supergroupFrozenAt = new Date().toISOString();
  demand(
    supergroupFrozenAt >= baseline.machineFrozenAt,
    "C6121_SUPERGROUP_PRECEDES_BASELINE_FREEZE",
  );
  return c6121FreezeSchema.parse(
    c6121Artifact("c6-1-2-1-supergroup-freeze", {
      supergroupFrozenAt,
      baselineFreezeHash: baseline.semanticHash,
      timingBarrierHash,
      supergroupMapHash: map.semanticHash,
      edgeLedgerHash: map.edgeLedgerHash,
      primaryEvaluator: "E2_FROZEN_MACHINE_GROUP_GOLD_TIMING_SUPERGROUP",
      frozenFiles,
      rawGoldTextReadCount: 0,
    }),
  );
}
