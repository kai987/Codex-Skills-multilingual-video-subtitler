import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { verifyRefresh } from "./subtitle-tool-vad-context-refresh.mjs";
import {
  planShortResponseDisplay,
  renderDisplayPreview,
} from "./lib/short-response-display.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const names = [
  "display-plan.json",
  "candidate-only.preview.needs-review.srt",
  "README.md",
  "provenance.json",
];
async function readVerified(source) {
  await verifyRefresh(source);
  return (await json(path.join(source, "boundary-review.json"))).input;
}
export async function createDisplayPreview(source, output) {
  source = path.resolve(source);
  output = path.resolve(output);
  await safePath(output, true);
  assert(
    output !== source && !output.startsWith(source + path.sep),
    "OUTPUT_INSIDE_SOURCE",
  );
  const input = await readVerified(source);
  const plan = planShortResponseDisplay(input),
    srt = renderDisplayPreview(input);
  assert(srt, "NO_ELIGIBLE_DISPLAY_PREVIEW");
  const bindings = await Promise.all(
    [
      import.meta.filename,
      path.join(import.meta.dirname, "lib/short-response-display.mjs"),
      path.join(import.meta.dirname, "lib/anchored-activity-review.mjs"),
      path.join(source, "boundary-review.json"),
      path.join(source, "boundary-review-freeze.json"),
    ].map(async (file) => ({ file, sha256: await fileHash(file) })),
  );
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "display-"));
  const write = (name, text) =>
    fs.writeFile(path.join(root, name), text, { flag: "wx" });
  await write(names[0], JSON.stringify(plan, null, 2) + "\n");
  await write(names[1], srt);
  await write(
    names[2],
    `# Short response: display preview only\n\nThis SRT contains ONE unconfirmed candidate, not the episode subtitles.\nSource-global time; preview against the original video, not a cropped WAV.\nDo not replace the primary subtitle file or count this as a recovered cue.\n\nAcoustic activity: ${plan.acousticActivity.start}–${plan.acousticActivity.end} s.\nDisplay: ${plan.displayInterval.start}–${plan.displayInterval.end} s.\nThe trailing hold is editorial reading time, NOT continued speech.\nThe 0.8 s preference is an experimental setting, not a verified utterance duration.\nUtterance boundaries remain unverified; needs-review / finalizationMethod=none.\nNo new inference, no reference input, no primary subtitle changes.\n`,
  );
  await write(
    names[3],
    JSON.stringify(
      {
        source,
        bindings,
        newInference: 0,
        referenceUsed: false,
        primarySubtitleMutations: 0,
      },
      null,
      2,
    ) + "\n",
  );
  const files = {};
  for (const name of names) files[name] = await fileHash(path.join(root, name));
  await write("freeze.json", JSON.stringify({ files }, null, 2) + "\n");
  await verifyDisplayPreview(root);
  return {
    root,
    acousticActivity: plan.acousticActivity,
    displayInterval: plan.displayInterval,
    newInference: 0,
    primarySubtitleMutations: 0,
  };
}
export async function verifyDisplayPreview(root) {
  await safePath(root);
  const frozen = await json(path.join(root, "freeze.json"));
  assert.deepEqual(Object.keys(frozen.files).sort(), [...names].sort());
  for (const name of names) {
    await safePath(path.join(root, name));
    assert.equal(await fileHash(path.join(root, name)), frozen.files[name]);
  }
  const provenance = await json(path.join(root, "provenance.json"));
  for (const b of provenance.bindings) {
    await safePath(b.file);
    assert.equal(await fileHash(b.file), b.sha256, "INPUT_CHANGED");
  }
  const input = await readVerified(provenance.source);
  assert.deepEqual(
    await json(path.join(root, names[0])),
    planShortResponseDisplay(input),
  );
  assert.equal(
    await fs.readFile(path.join(root, names[1]), "utf8"),
    renderDisplayPreview(input),
  );
  return { integrity: "passed", newInference: 0, primarySubtitleMutations: 0 };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, source, output] = process.argv.slice(2);
  assert(cmd === "create" || cmd === "verify", "USE_CREATE_OR_VERIFY");
  console.log(
    JSON.stringify(
      cmd === "create"
        ? await createDisplayPreview(source, output)
        : await verifyDisplayPreview(source),
      null,
      2,
    ),
  );
}
