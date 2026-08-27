import path from "node:path";

import { atomicWriteJson, InputError } from "@mvl/shared";
import {
  createDualBlindFreezeBarrier,
  createZeroTouchBlindGenerationProof,
} from "@mvl/video-subtitler";

function parseArguments(argv: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined)
      throw new InputError("Invalid barrier arguments.");
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
const runAPath = path.resolve(required(args, "--run-a"));
const runBPath = path.resolve(required(args, "--run-b"));
const outputPath = path.resolve(required(args, "--output"));
const createdAt = new Date().toISOString();
const barrier = await createDualBlindFreezeBarrier({
  acceptanceId: required(args, "--acceptance-id"),
  createdAt,
  runAPath,
  runBPath,
});
await atomicWriteJson(outputPath, barrier);
const [proofA, proofB] = await Promise.all([
  createZeroTouchBlindGenerationProof({
    taskDirectory: runAPath,
    phase: "pre-gold",
    barrierReachedAt: createdAt,
    goldFirstReadAt: null,
    outputHashAfterGold: null,
  }),
  createZeroTouchBlindGenerationProof({
    taskDirectory: runBPath,
    phase: "pre-gold",
    barrierReachedAt: createdAt,
    goldFirstReadAt: null,
    outputHashAfterGold: null,
  }),
]);
await Promise.all([
  atomicWriteJson(
    path.join(runAPath, "zero-touch-blind-generation-proof.pre-gold.json"),
    proofA,
  ),
  atomicWriteJson(
    path.join(runBPath, "zero-touch-blind-generation-proof.pre-gold.json"),
    proofB,
  ),
]);
console.log(JSON.stringify(barrier, null, 2));
