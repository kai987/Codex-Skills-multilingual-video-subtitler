import path from "node:path";
import { parseArgs } from "node:util";
import { atomicWriteJson } from "@mvl/shared";

import { createC60113OutputDirectory } from "./lib/c60113-acceptance-io.js";
import { loadC60113ReplayInput } from "./lib/c60113-replay-input.js";

const { values } = parseArgs({
  options: {
    "artifact-root": { type: "string" },
    "upstream-prefix": { type: "string" },
    "upstream-date": { type: "string" },
    "evidence-prefix": { type: "string" },
    "evidence-date": { type: "string" },
    source: { type: "string" },
    output: { type: "string" },
  },
});
function required(name: keyof typeof values): string {
  const value = values[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}
const replay = await loadC60113ReplayInput({
  artifactRoot: path.resolve(required("artifact-root")),
  upstreamPrefix: required("upstream-prefix"),
  upstreamDate: required("upstream-date"),
  evidencePrefix: required("evidence-prefix"),
  evidenceDate: required("evidence-date"),
  source: path.resolve(required("source")),
});
const output = path.resolve(required("output"));
await createC60113OutputDirectory(output);
await atomicWriteJson(
  path.join(output, "c6-0-1-13-baseline-replay.json"),
  replay.baseline,
);
process.stdout.write(`${JSON.stringify(replay.baseline, null, 2)}\n`);
