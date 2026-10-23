import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { insertConfirmedUtterance } from "./lib/confirmed-utterance.mjs";

const [specFile, outputBase] = process.argv.slice(2);
assert(specFile && outputBase, "usage: SPEC_JSON OUTPUT_BASE");
const spec = JSON.parse(await fs.readFile(specFile, "utf8"));
const parent = await fs.realpath(spec.parent),
  output = path.resolve(outputBase);
await safePath(parent);
await safePath(output, true);
assert(
  output !== parent && !output.startsWith(parent + path.sep),
  "OUTPUT_INSIDE_INPUT",
);
const frozenFile = path.join(parent, "machine-freeze.json");
assert.equal(await fileHash(frozenFile), spec.evidenceHash);
const frozen = JSON.parse(await fs.readFile(frozenFile, "utf8"));
for (const [name, hash] of Object.entries(frozen.files)) {
  assert.equal(path.basename(name), name);
  await safePath(path.join(parent, name));
  assert.equal(
    await fileHash(path.join(parent, name)),
    hash,
    `CHANGED:${name}`,
  );
}
assert.equal(
  frozen.files["preserved.machine-candidate.srt"],
  spec.baselineSha256,
);
assert.equal(frozen.files["context.wav"], spec.contextSha256);
assert(frozen.files["listening-clips.json"]);
const clips = JSON.parse(
  await fs.readFile(path.join(parent, "listening-clips.json"), "utf8"),
);
const context = clips.clips.find((c) => c.file === "context.wav");
assert.equal(context.sha256, spec.contextSha256);
const source = path.join(parent, "preserved.machine-candidate.srt");
const result = insertConfirmedUtterance(
  await fs.readFile(source, "utf8"),
  spec.confirmation,
  context,
);
assert.equal(result.inserted, 1, "ALREADY_PRESENT_NO_NEW_OUTPUT_NEEDED");
await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(path.join(output, "human-confirmed-"));
const put = (name, value) =>
  fs.writeFile(path.join(root, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
await put("human-confirmation.json", spec);
await put("records.json", result.records);
for (const [format, contents] of Object.entries(result.contents))
  await fs.writeFile(
    path.join(root, `subtitle.human-assisted.needs-review.${format}`),
    contents,
    { flag: "wx" },
  );
await put("changes.json", {
  operation: "INSERT_CONFIRMED_MISSING_UTTERANCE",
  cue: spec.confirmation,
  insertedIndex: result.insertedIndex,
  baselineCount: result.preserved,
  outputCount: result.records.length,
  existingTextChanges: 0,
  existingTimingChanges: 0,
  newModelCalls: 0,
  status: result.status,
  wholeFileHumanValidated: false,
  machineIndependent: false,
  finalizationMethod: "none",
});
assert.equal(await fileHash(source), spec.baselineSha256);
assert.equal(await fileHash(frozenFile), spec.evidenceHash);
const files = {};
for (const n of await fs.readdir(root))
  files[n] = await fileHash(path.join(root, n));
await put("human-assisted-freeze.json", {
  files,
  sourceFreezeHash: spec.evidenceHash,
});
console.log(
  JSON.stringify(
    {
      root,
      inserted: 1,
      preserved: result.preserved,
      outputCount: result.records.length,
      newModelCalls: 0,
      status: result.status,
    },
    null,
    2,
  ),
);
