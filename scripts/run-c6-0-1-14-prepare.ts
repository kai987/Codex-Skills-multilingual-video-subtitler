import path from "node:path";
import { parseArgs } from "node:util";
import { c60114PreProbeFreezeSchema } from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import { loadC60114Input } from "./lib/c60114-input.js";
import { prepareC60114Machine } from "./lib/c60114-prepare-machine.js";
import {
  allocateC60114Output,
  writeC60114Artifact,
} from "./lib/c60114-output.js";
import {
  assertC60113ReadOnlyIdentity,
  c60113FileHash,
  c60113FileIdentity,
} from "./lib/c60113-acceptance-io.js";

const { values } = parseArgs({
  options: {
    "artifact-root": { type: "string" },
    source: { type: "string" },
    "upstream-prefix": { type: "string" },
    "upstream-date": { type: "string" },
    "evidence-prefix": { type: "string" },
    "evidence-date": { type: "string" },
    "previous-prefix": { type: "string" },
    "previous-date": { type: "string" },
    "output-prefix": { type: "string" },
    "output-date": { type: "string" },
    "audio-stream-index": { type: "string" },
  },
  strict: true,
});
const required = (key: keyof typeof values): string => {
  const value = values[key];
  if (!value) throw new Error(`Missing --${key}`);
  return value;
};
const root = path.resolve(required("artifact-root"));
const options = {
  artifactRoot: root,
  source: path.resolve(required("source")),
  upstreamPrefix: required("upstream-prefix"),
  upstreamDate: required("upstream-date"),
  evidencePrefix: required("evidence-prefix"),
  evidenceDate: required("evidence-date"),
  previousPrefix: required("previous-prefix"),
  previousDate: required("previous-date"),
  ...(values["audio-stream-index"] === undefined
    ? {}
    : { audioStreamIndex: Number(values["audio-stream-index"]) }),
};
const input = await loadC60114Input(options);
const prepared = prepareC60114Machine(input);
const prefix = required("output-prefix"),
  date = required("output-date");
const outputs: Record<string, string> = {};
const put = async (
  suffix: string,
  name: string,
  artifact: unknown,
): Promise<string> => {
  const directory = await allocateC60114Output(
    root,
    `${prefix}-${suffix}-${date}`,
  );
  outputs[suffix] = directory;
  return writeC60114Artifact(directory, name, artifact);
};
await put("baseline", "c6-0-1-14-baseline.json", input.baseline);
await put(
  "review-targets",
  "machine-review-target-intervals-v2.json",
  prepared.reviewTargets,
);
await put(
  "speech-islands",
  "machine-source-global-speech-islands.json",
  prepared.speechIslands,
);
await put(
  "orphan-sweep",
  "machine-orphan-speech-sweep.json",
  prepared.orphanSweep,
);
const selectionPath = await put(
  "probe-selection",
  "machine-missing-dialogue-probe-selection.json",
  prepared.selection,
);
const selectionDirectory = path.dirname(selectionPath);
const policyPath = await writeC60114Artifact(
  selectionDirectory,
  "c6-0-1-14-policy.json",
  prepared.policy,
);
await writeC60114Artifact(
  selectionDirectory,
  "c6-0-1-14-machine-preparation-summary.json",
  prepared.summary,
);
await writeC60114Artifact(
  selectionDirectory,
  "c6-0-1-14-machine-input-bindings.json",
  { bindings: prepared.bindings, machineInputFiles: input.machineInputFiles },
);
const sourceAfter = await c60113FileIdentity(options.source);
assertC60113ReadOnlyIdentity(input.replay.sourceIdentity, sourceAfter);
const freezeCore = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-14-pre-probe-freeze",
  policyHash: prepared.policy.semanticHash,
  selectionHash: prepared.selection.semanticHash,
  policyByteHash: await c60113FileHash(policyPath),
  selectionByteHash: await c60113FileHash(selectionPath),
  sourceIdentity: input.sourceIdentity,
  runtimeGoldInputCount: 0,
  frozenAt: new Date().toISOString(),
};
const freeze = c60114PreProbeFreezeSchema.parse({
  ...freezeCore,
  semanticHash: machineQualitySemanticHash(freezeCore),
});
const freezePath = await writeC60114Artifact(
  selectionDirectory,
  "c6-0-1-14-pre-probe-freeze.json",
  freeze,
);
await writeC60114Artifact(
  selectionDirectory,
  "c6-0-1-14-run-paths.local-only.json",
  {
    options,
    prefix,
    date,
    outputs,
    policyPath,
    selectionPath,
    freezePath,
    sourceReadOnlyIdentity: sourceAfter,
  },
);
process.stdout.write(
  `${JSON.stringify({ outputs, policyPath, selectionPath, freezePath, summary: prepared.summary, policyHash: prepared.policy.semanticHash, selectionHash: prepared.selection.semanticHash }, null, 2)}\n`,
);
