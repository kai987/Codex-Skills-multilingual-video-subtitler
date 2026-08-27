import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  dualBlindFreezeBarrierSchema,
  InputError,
  pathExists,
} from "@mvl/shared";
import {
  createZeroTouchBlindGenerationProof,
  evaluateDualBlindRunsAgainstGold,
} from "@mvl/video-subtitler";

const EXPECTED_GOLD_SIZE = 17_094;
const EXPECTED_GOLD_SHA256 =
  "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e";

function parseArguments(argv: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined)
      throw new InputError("Invalid Gold evaluation arguments.");
    result.set(flag, value);
  }
  return result;
}

function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined) throw new InputError(`Missing ${flag}.`);
  return value;
}

const args = parseArguments(process.argv.slice(2));
const barrierPath = path.resolve(required(args, "--barrier"));
const goldPath = path.resolve(required(args, "--gold"));
const outputAPath = path.resolve(required(args, "--output-a"));
const outputBPath = path.resolve(required(args, "--output-b"));
if ((await pathExists(outputAPath)) || (await pathExists(outputBPath))) {
  throw new InputError(
    "Gold evaluation output exists; overwrite is forbidden.",
    {
      outputAPath,
      outputBPath,
    },
  );
}
await Promise.all([
  mkdir(outputAPath, { recursive: false }),
  mkdir(outputBPath, { recursive: false }),
]);
const result = await evaluateDualBlindRunsAgainstGold({
  barrierPath,
  goldPath,
  expectedGoldSize: EXPECTED_GOLD_SIZE,
  expectedGoldSha256: EXPECTED_GOLD_SHA256,
  generatedAt: new Date().toISOString(),
});
const barrier = dualBlindFreezeBarrierSchema.parse(
  JSON.parse(await readFile(barrierPath, "utf8")) as unknown,
);
const [proofA, proofB] = await Promise.all([
  createZeroTouchBlindGenerationProof({
    taskDirectory: barrier.runAPath,
    phase: "post-gold",
    barrierReachedAt: barrier.createdAt,
    goldFirstReadAt: result.goldFirstReadAt,
    outputHashAfterGold: result.outputHashesAfterGold.runA,
  }),
  createZeroTouchBlindGenerationProof({
    taskDirectory: barrier.runBPath,
    phase: "post-gold",
    barrierReachedAt: barrier.createdAt,
    goldFirstReadAt: result.goldFirstReadAt,
    outputHashAfterGold: result.outputHashesAfterGold.runB,
  }),
]);
await Promise.all([
  atomicWriteJson(
    path.join(outputAPath, "machine-vs-gold-evaluation.json"),
    result.runA,
  ),
  atomicWriteJson(
    path.join(outputBPath, "machine-vs-gold-evaluation.json"),
    result.runB,
  ),
  atomicWriteJson(
    path.join(outputAPath, "zero-touch-blind-generation-proof.json"),
    proofA,
  ),
  atomicWriteJson(
    path.join(outputBPath, "zero-touch-blind-generation-proof.json"),
    proofB,
  ),
  atomicWriteJson(path.join(outputAPath, "gold-evaluator-replay.json"), {
    schemaVersion: "1.0.0",
    artifactType: "gold-evaluator-replay",
    modelInferenceCount: 0,
    initialSemanticHash: result.runA.semanticHash,
    replaySemanticHash: result.replaySemanticHashes.runA,
    deterministic:
      result.runA.semanticHash === result.replaySemanticHashes.runA,
  }),
  atomicWriteJson(path.join(outputBPath, "gold-evaluator-replay.json"), {
    schemaVersion: "1.0.0",
    artifactType: "gold-evaluator-replay",
    modelInferenceCount: 0,
    initialSemanticHash: result.runB.semanticHash,
    replaySemanticHash: result.replaySemanticHashes.runB,
    deterministic:
      result.runB.semanticHash === result.replaySemanticHashes.runB,
  }),
]);
console.log(
  JSON.stringify(
    {
      goldIdentity: result.goldIdentity,
      runA: {
        semanticHash: result.runA.semanticHash,
        normalizedCer: result.runA.globalTextMetrics.normalized.cer,
        p0: result.runA.p0Defects.length,
        p1: result.runA.p1Defects.length,
        p2: result.runA.p2Defects.length,
      },
      runB: {
        semanticHash: result.runB.semanticHash,
        normalizedCer: result.runB.globalTextMetrics.normalized.cer,
        p0: result.runB.p0Defects.length,
        p1: result.runB.p1Defects.length,
        p2: result.runB.p2Defects.length,
      },
    },
    null,
    2,
  ),
);
