import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatAss } from "@mvl/subtitle-core";
import { c61211BaselineSchema, c61211PolicySchema } from "@mvl/shared";
import { c61211Fixture } from "./c61211-fixture.js";
import { SHA } from "./c612-fixture.js";
import {
  c61211Artifact,
  C61211_POLICY,
  C61211_POLICY_HASH,
  C61211_PARTITION_POLICY,
  C61211_COVERAGE_POLICY,
  C61211_ROUTE_POLICY,
  hash,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
import {
  writeC61211,
  fingerprintsC61211,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/artifact-io.js";
import {
  timingC61211,
  freezeC61211,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/gold-barriers.js";
import { partitionC61211 } from "../../packages/video-subtitler/src/consensus/evaluation-partition/monotonic-partition-solver.js";
import {
  auditC61211Conservation,
  auditC61211Cuts,
  auditC61211Residuals,
} from "../../packages/video-subtitler/src/consensus/evaluation-partition/partition-audits.js";
import { reachableC61211Scope } from "../../packages/video-subtitler/src/consensus/evaluation-partition/reachable-coverage.js";
import { trainingC61211Contract } from "../../packages/video-subtitler/src/consensus/evaluation-partition/same-feature-oof-retrainer.js";
export async function c61211FileFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "c61211-test-")),
    directory = path.join(root, "output");
  await mkdir(directory);
  const f = c61211Fixture(),
    machinePath = path.join(root, "machine.json"),
    goldPath = path.join(root, "gold.ass");
  await writeFile(machinePath, JSON.stringify(f.frozen));
  await writeFile(
    goldPath,
    formatAss(f.production.cues.map((c) => ({ ...c, text: "明日は晴れ" }))),
  );
  const files = await fingerprintsC61211([
    { role: "synthetic-machine", path: machinePath },
  ]);
  const baseline = c61211BaselineSchema.parse(
    c61211Artifact("c6-1-2-1-1-baseline-freeze-verification", {
      machineFrozenAt: new Date().toISOString(),
      baselineCommit: "synthetic",
      baselinePolicyHash: SHA,
      baselineAHash: SHA,
      baselineBHash: SHA,
      originalMachineFreezeHash: SHA,
      originalRerankingFreezeHash: SHA,
      files,
      inputAggregateHash: hash(files),
      checks: [
        {
          name: "synthetic-fixture",
          passed: true,
          observed: "synthetic",
          expected: "synthetic",
        },
      ],
      passed: true,
      rawGoldReadCount: 0,
      productionTextHash: SHA,
      productionTimingHash: SHA,
      productionPresentationHash: SHA,
      baselineReplayHashes: [],
    }),
  );
  const contract = await trainingC61211Contract(
    f.frozen,
    process.cwd(),
    process.cwd(),
  );
  const policy = c61211PolicySchema.parse(
    c61211Artifact("c6-1-2-1-1-policy-freeze", {
      serializedDefinition: JSON.stringify(C61211_POLICY),
      definitionHash: C61211_POLICY_HASH,
      partitionPolicyHash: hash(C61211_PARTITION_POLICY),
      coveragePolicyHash: hash(C61211_COVERAGE_POLICY),
      routePolicyHash: hash(C61211_ROUTE_POLICY),
      frozenBeforeGoldText: true,
      primaryEvaluator: C61211_POLICY.primaryEvaluator,
    }),
  );
  for (const value of [baseline, contract, policy])
    await writeC61211(directory, value);
  const timing = await timingC61211(baseline, goldPath);
  await writeC61211(directory, timing);
  f.input.goldTiming = timing.rows;
  const p = partitionC61211(f.input),
    scope = reachableC61211Scope(f.frozen, p.graph);
  const integrity = auditC61211Conservation(f.input, p.map, p.graph),
    cuts = auditC61211Cuts(p.map, p.graph);
  for (const value of [
    p.inventory,
    p.candidates,
    p.map,
    scope,
    integrity,
    cuts,
    auditC61211Residuals(p.map),
  ])
    await writeC61211(directory, value);
  const freeze = await freezeC61211(directory, baseline, timing, p.map);
  await writeC61211(directory, freeze);
  return {
    root,
    directory,
    f,
    p,
    baseline,
    contract,
    timing,
    freeze,
    machinePath,
    goldPath,
    integrity,
    cuts,
    scope,
  };
}
