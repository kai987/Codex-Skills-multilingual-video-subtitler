import { mkdir } from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, InputError, pathExists } from "@mvl/shared";
import {
  createZeroTouchBlindGenerationProof,
  evaluateFrozenBlindRunAgainstGold,
} from "@mvl/video-subtitler";

const EXPECTED_GOLD_SIZE = 17_094;
const EXPECTED_GOLD_SHA256 =
  "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e";

function parseArguments(argv: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined) {
      throw new InputError("Invalid single-run Gold evaluation arguments.");
    }
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
const taskDirectory = path.resolve(required(args, "--run"));
const goldPath = path.resolve(required(args, "--gold"));
const outputPath = path.resolve(required(args, "--output"));
if (await pathExists(outputPath)) {
  throw new InputError(
    "Gold evaluation output exists; overwrite is forbidden.",
    {
      outputPath,
    },
  );
}
await mkdir(outputPath, { recursive: false });
const frozenBeforeGoldAt = new Date().toISOString();
const preGoldProof = await createZeroTouchBlindGenerationProof({
  taskDirectory,
  phase: "pre-gold",
  barrierReachedAt: frozenBeforeGoldAt,
  goldFirstReadAt: null,
  outputHashAfterGold: null,
});
await atomicWriteJson(
  path.join(taskDirectory, "zero-touch-blind-generation-proof.pre-gold.json"),
  preGoldProof,
  { overwrite: true },
);
const result = await evaluateFrozenBlindRunAgainstGold({
  taskDirectory,
  goldPath,
  expectedGoldSize: EXPECTED_GOLD_SIZE,
  expectedGoldSha256: EXPECTED_GOLD_SHA256,
  generatedAt: new Date().toISOString(),
  frozenBeforeGoldAt,
});
const postGoldProof = await createZeroTouchBlindGenerationProof({
  taskDirectory,
  phase: "post-gold",
  barrierReachedAt: frozenBeforeGoldAt,
  goldFirstReadAt: result.goldFirstReadAt,
  outputHashAfterGold: result.outputHashAfterGold,
});
await Promise.all([
  atomicWriteJson(
    path.join(outputPath, "machine-vs-gold-evaluation.json"),
    result.evaluation,
  ),
  atomicWriteJson(
    path.join(outputPath, "zero-touch-blind-generation-proof.json"),
    postGoldProof,
  ),
  atomicWriteJson(path.join(outputPath, "gold-evaluator-replay.json"), {
    schemaVersion: "1.0.0",
    artifactType: "gold-evaluator-replay",
    modelInferenceCount: 0,
    initialSemanticHash: result.evaluation.semanticHash,
    replaySemanticHash: result.replaySemanticHash,
    deterministic: result.evaluation.semanticHash === result.replaySemanticHash,
  }),
  ...(result.rawAsrEvaluation === null
    ? []
    : [
        atomicWriteJson(
          path.join(outputPath, "raw-asr-vs-gold-evaluation.json"),
          result.rawAsrEvaluation,
        ),
      ]),
]);
console.log(
  JSON.stringify(
    {
      generationRunId: result.evaluation.generationRunId,
      normalizedCer: result.evaluation.globalTextMetrics.normalized.cer,
      coverage: result.evaluation.coverageMetrics.goldTextCoverageRatio,
      missingDialogue: result.evaluation.missingDialogueCandidates.length,
      materialTextErrors: result.evaluation.materialTextErrors.length,
      severeTimingErrors: result.evaluation.severeTimingErrors.length,
      p1: result.evaluation.p1Defects.length,
      modelInferenceCount: result.evaluation.modelInferenceCount,
      deterministicReplay:
        result.evaluation.semanticHash === result.replaySemanticHash,
      rawAsr:
        result.rawAsrEvaluation === null
          ? null
          : {
              cueCount:
                result.rawAsrEvaluation.alignmentMetrics.machineCueCount,
              exactCer: result.rawAsrEvaluation.globalTextMetrics.exact.cer,
              normalizedCer:
                result.rawAsrEvaluation.globalTextMetrics.normalized.cer,
              coverage:
                result.rawAsrEvaluation.coverageMetrics.goldTextCoverageRatio,
              missingDialogue:
                result.rawAsrEvaluation.missingDialogueCandidates.length,
              materialTextErrors:
                result.rawAsrEvaluation.materialTextErrors.length,
              severeTimingErrors:
                result.rawAsrEvaluation.severeTimingErrors.length,
            },
    },
    null,
    2,
  ),
);
