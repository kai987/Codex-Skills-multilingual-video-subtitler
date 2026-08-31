import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import path from "node:path";
import {
  buildC612MachineStage,
  writeC612MachineStage,
} from "../packages/video-subtitler/src/consensus/top-k/c612-machine-stage.js";
const args = process.argv.slice(2);
const allowed = new Set([
  "--task",
  "--previous",
  "--baseline-run",
  "--source",
  "--asr-cache",
  "--verifier-cache",
  "--model-directory",
  "--python",
  "--output",
  "--network",
  "--production-mutation",
  "--verifier-mode",
]);
const flags = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = c612Defined(args[i]),
    value = args[i + 1];
  if (!allowed.has(key) || !value || value.startsWith("--") || flags.has(key))
    throw new Error(`C612_INVALID_ARGUMENT:${key}`);
  flags.set(key, value);
}
const required = (name: string) => {
  const value = flags.get(name);
  if (!value) throw new Error(`C612_REQUIRED_ARGUMENT:${name}`);
  return value;
};
if (
  required("--network") !== "off" ||
  required("--production-mutation") !== "off"
)
  throw new Error("C612_OFFLINE_SHADOW_ONLY");
const mode = required("--verifier-mode");
if (!["exact-cache", "bounded-fresh", "cache-replay"].includes(mode))
  throw new Error("C612_VERIFIER_MODE");
const repository = path.resolve(import.meta.dirname, ".."),
  output = path.resolve(required("--output"));
if (output === repository || output.startsWith(repository + path.sep))
  throw new Error("C612_OUTPUT_MUST_BE_EXTERNAL_RESEARCH_DIRECTORY");
const stage = await buildC612MachineStage({
  task: required("--task"),
  previous: required("--previous"),
  baselineRun: required("--baseline-run"),
  repository,
  source: required("--source"),
  asrCache: required("--asr-cache"),
  verifierCache: required("--verifier-cache"),
  modelDirectory: required("--model-directory"),
  python: required("--python"),
  allowFresh: mode === "bounded-fresh",
  replay: mode === "cache-replay",
  progress: (value) => process.stdout.write(`${value}\n`),
});
const freeze = await writeC612MachineStage(output, repository, stage);
process.stdout.write(
  JSON.stringify({
    output,
    freezeHash: freeze.semanticHash,
    candidates: stage.identity.rows.length,
    verifier: stage.runtime,
    folds: stage.folds.folds.map((f) => ({
      id: f.foldId,
      events: f.eventIds.length,
    })),
    goldRead: false,
  }) + "\n",
);
