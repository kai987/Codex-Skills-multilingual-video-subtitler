import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { readPcm } from "./lib/bounded-asr-ab.mjs";
import {
  renderBoundaryReview,
  validateTailAnnotation,
} from "./lib/tail-boundary-review.mjs";

const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
async function checkFreeze(root) {
  await safePath(root);
  const frozen = await json(path.join(root, "machine-freeze.json"));
  for (const [name, hash] of Object.entries(frozen.files)) {
    assert.equal(path.basename(name), name);
    await safePath(path.join(root, name));
    assert.equal(
      await fileHash(path.join(root, name)),
      hash,
      `CHANGED:${name}`,
    );
  }
  return frozen;
}
export async function prepareTailReview(parent, output) {
  parent = await fs.realpath(parent);
  output = path.resolve(output);
  await safePath(output, true);
  assert(
    output !== parent && !output.startsWith(parent + path.sep),
    "OUTPUT_INSIDE_EVIDENCE",
  );
  const frozen = await checkFreeze(parent);
  for (const n of ["listening-clips.json", "context.wav", "post-mfa-tail.wav"])
    assert(frozen.files[n], `UNBOUND:${n}`);
  const delivery = await json(path.join(parent, "listening-clips.json"));
  const c = delivery.clips.find((v) => v.file === "context.wav"),
    tail = delivery.clips.find((v) => v.file === "post-mfa-tail.wav");
  assert(
    c &&
      tail &&
      c.start <= tail.start &&
      tail.start < tail.end &&
      tail.end <= c.end,
    "INVALID_CONTEXT",
  );
  assert.equal(c.sha256, frozen.files["context.wav"]);
  const audio = await fs.readFile(path.join(parent, "context.wav")),
    pcm = readPcm(audio);
  assert.equal(pcm.sampleRate, 16000);
  assert.equal(pcm.frames, c.endFrame - c.startFrame);
  assert.equal(c.startFrame, Math.round(c.start * 16000));
  assert.equal(c.endFrame, Math.round(c.end * 16000));
  const manifest = {
    version: "tail-boundary-review-v1",
    evidenceHash: await fileHash(path.join(parent, "machine-freeze.json")),
    audioSha256: c.sha256,
    start: c.start,
    end: c.end,
    minimum: tail.start,
    timebase: "source-global-seconds",
    automaticMutation: false,
  };
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "boundary-"));
  await fs.writeFile(path.join(root, "context.wav"), audio, { flag: "wx" });
  await put(path.join(root, "manifest.json"), manifest);
  await fs.writeFile(
    path.join(root, "index.html"),
    renderBoundaryReview(manifest),
    { flag: "wx" },
  );
  const files = {};
  for (const n of ["context.wav", "manifest.json", "index.html"])
    files[n] = await fileHash(path.join(root, n));
  await put(path.join(root, "machine-freeze.json"), { files });
  return {
    root,
    newModelCalls: 0,
    subtitleMutations: 0,
    pendingHumanBoundary: true,
  };
}
export async function validateTailReview(root, annotationFile) {
  await checkFreeze(root);
  const manifest = await json(path.join(root, "manifest.json"));
  assert.equal(
    await fileHash(path.join(root, "context.wav")),
    manifest.audioSha256,
  );
  return validateTailAnnotation(manifest, await json(annotationFile));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "prepare")
    console.log(JSON.stringify(await prepareTailReview(...args), null, 2));
  else if (cmd === "check")
    console.log(JSON.stringify(await validateTailReview(...args), null, 2));
  else
    throw Error(
      "prepare TAIL_OUTPUT OUTPUT_BASE | check REVIEW_ROOT ANNOTATION_JSON",
    );
}
