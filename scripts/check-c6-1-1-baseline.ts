import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { atomicWriteJson } from "@mvl/shared";
import { replayC611Baseline } from "../packages/video-subtitler/src/consensus/c611-baseline.js";
const { values } = parseArgs({
  options: Object.fromEntries(
    [
      "previous-a",
      "previous-b",
      "task",
      "source",
      "quality",
      "oracle",
      "validation",
      "output",
      "acceptance-commit",
      "baseline-branch",
    ].map((name) => [name, { type: "string" as const }]),
  ),
});
function required(name: string) {
  const value = values[name];
  if (typeof value !== "string" || !value) throw new Error(`Missing --${name}`);
  return value;
}
const result = await replayC611Baseline({
  previousA: required("previous-a"),
  previousB: required("previous-b"),
  upstreamTask: required("task"),
  source: required("source"),
  quality: required("quality"),
  oracle: required("oracle"),
  validation: required("validation"),
  acceptanceCommit: required("acceptance-commit"),
  baselineBranch: required("baseline-branch"),
});
const output = path.resolve(required("output"));
await mkdir(output, { recursive: false });
await atomicWriteJson(path.join(output, "c6-1-1-baseline.json"), result);
console.log(
  JSON.stringify(
    {
      baselineReplayPassed: result.baselineReplayPassed,
      checks: result.checks.length,
      failed: result.checks.filter((c) => !c.passed),
      counts: result.candidateCounts,
      semanticHash: result.semanticHash,
    },
    null,
    2,
  ),
);
if (!result.baselineReplayPassed) process.exitCode = 1;
