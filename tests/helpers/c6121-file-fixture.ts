import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatAss } from "@mvl/subtitle-core";
import {
  c6121BaselineSchema,
  c6121PolicyFreezeSchema,
  c6121TimingInputSchema,
} from "@mvl/shared";
import { c6121Fixture } from "./c6121-fixture.js";
import { buildC611FixedBaselineAlignmentMap } from "../../packages/video-subtitler/src/consensus/fixed-baseline-alignment-map.js";
import {
  c6121Artifact,
  C6121_POLICY,
  C6121_POLICY_HASH,
  hash,
} from "../../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
import {
  fingerprintC6121,
  writeC6121Artifact,
} from "../../packages/video-subtitler/src/consensus/evaluation-recovery/baseline-freeze-verification.js";
import { readC6121GoldTiming } from "../../packages/video-subtitler/src/consensus/evaluation-recovery/gold-timing-barrier.js";
import { replayC6121E1Timing } from "../../packages/video-subtitler/src/consensus/evaluation-recovery/evaluator-mode-comparison.js";
import { freezeC6121Evaluator } from "../../packages/video-subtitler/src/consensus/evaluation-recovery/supergroup-freeze.js";
import { c6121TrainingContract } from "../../packages/video-subtitler/src/consensus/evaluation-recovery/same-profile-oof-retrainer.js";
export async function c6121FileFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "c6121-test-")),
    directory = path.join(root, "output");
  await mkdir(directory);
  const f = c6121Fixture(),
    machinePath = path.join(root, "synthetic-machine.json"),
    goldPath = path.join(root, "synthetic-gold.ass");
  await writeFile(machinePath, JSON.stringify(f.frozen));
  await writeFile(
    goldPath,
    formatAss(f.production.cues.map((c) => ({ ...c, text: "明日は晴れ" }))),
  );
  const files = [await fingerprintC6121(machinePath, "synthetic-machine")];
  const old = Object.fromEntries(
    Object.entries(f.baseline).filter(([key]) => key !== "semanticHash"),
  );
  const baseline = c6121BaselineSchema.parse(
    c6121Artifact("c6-1-2-1-baseline-freeze-verification", {
      ...old,
      files,
      inputAggregateHash: hash(files),
    }),
  );
  await writeC6121Artifact(directory, baseline);
  const contract = await c6121TrainingContract(
    f.frozen,
    process.cwd(),
    process.cwd(),
  );
  await writeC6121Artifact(directory, contract);
  await writeC6121Artifact(
    directory,
    c6121PolicyFreezeSchema.parse(
      c6121Artifact("c6-1-2-1-policy-freeze", {
        serializedDefinition: JSON.stringify(C6121_POLICY),
        definitionHash: C6121_POLICY_HASH,
        primaryEvaluator: C6121_POLICY.primaryEvaluator,
        frozenBeforeGoldText: true,
      }),
    ),
  );
  const timing = await readC6121GoldTiming(baseline, goldPath);
  await writeC6121Artifact(directory, timing.barrier);
  await writeC6121Artifact(
    directory,
    c6121TimingInputSchema.parse(
      c6121Artifact("gold-c6-1-2-1-timing-only-input", {
        timingBarrierHash: timing.barrier.semanticHash,
        rows: timing.timing,
        rawGoldTextIncluded: false,
      }),
    ),
  );
  const historical = buildC611FixedBaselineAlignmentMap({
    baselineCues: f.production.cues,
    goldCues: timing.timing.map((c) => ({ ...c, text: "" })),
    eventBindings: f.universe.events,
    barrier: {
      machineFreezeHash: f.frozen.freeze.semanticHash,
      machineFrozenAt: "2000-01-01T00:00:00.000Z",
      goldFirstReadAt: "2000-01-02T00:00:00.000Z",
    },
  });
  const e1 = replayC6121E1Timing(f.frozen, timing.timing, historical);
  await writeC6121Artifact(directory, e1);
  const graph = f.graph(timing.timing);
  for (const value of Object.values(graph))
    await writeC6121Artifact(directory, value);
  const freeze = await freezeC6121Evaluator(
    directory,
    baseline,
    graph.map,
    timing.barrier.semanticHash,
  );
  await writeC6121Artifact(directory, freeze);
  return {
    root,
    directory,
    f,
    baseline,
    machinePath,
    goldPath,
    timing,
    graph,
    e1,
    freeze,
    contract,
  };
}
