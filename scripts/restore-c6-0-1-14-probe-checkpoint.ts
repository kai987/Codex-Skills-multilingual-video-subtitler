import path from "node:path";
import { parseArgs } from "node:util";
import { restoreC60114CompletionCheckpoint } from "../packages/video-subtitler/src/review/c60114-probe-completion.js";

const { values } = parseArgs({
  strict: true,
  allowPositionals: false,
  options: {
    checkpoint: { type: "string" },
    "cache-directory": { type: "string" },
    "output-directory": { type: "string" },
  },
});
function required(name: keyof typeof values): string {
  const value = values[name];
  if (!value) throw new Error(`C60114_RECOVERY_REQUIRED_ARGUMENT:${name}`);
  return path.resolve(value);
}
const artifact = await restoreC60114CompletionCheckpoint({
  checkpointPath: required("checkpoint"),
  cacheDirectory: required("cache-directory"),
  outputDirectory: required("output-directory"),
});
process.stdout.write(
  `${JSON.stringify({
    status: "CHECKPOINT_RESTORED",
    probeSemanticHash: artifact.semanticHash,
    persistedSuccessCount: artifact.persistence?.persistedSuccessCount,
    recoveryActualFreshInferences: 0,
    recoveryModelLoadCount: 0,
  })}\n`,
);
