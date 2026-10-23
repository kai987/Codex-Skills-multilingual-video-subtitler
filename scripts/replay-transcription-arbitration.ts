import path from "node:path";

import { replayAdaptiveRefinementArbitration } from "@mvl/transcription-core";
import { atomicWriteJson, readJson } from "@mvl/shared";

const inputPath = process.argv[2];
if (inputPath === undefined) {
  throw new Error(
    "Usage: npm run replay:arbitration -- <transcription-refinement.json> [output.json]",
  );
}

const resolvedInput = path.resolve(inputPath);
const outputPath = path.resolve(
  process.argv[3] ??
    path.join(
      path.dirname(resolvedInput),
      "transcription-refinement-replay.json",
    ),
);
const replay = replayAdaptiveRefinementArbitration(
  await readJson(resolvedInput),
);
await atomicWriteJson(outputPath, replay, { overwrite: true });
process.stdout.write(
  `${JSON.stringify({ outputPath, summary: replay.summary }, null, 2)}\n`,
);
