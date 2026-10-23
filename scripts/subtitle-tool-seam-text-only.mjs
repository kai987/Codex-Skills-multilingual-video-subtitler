/** Offline companion: a separate candidate, no models, no reference lookup. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { verifySeams } from "./subtitle-tool-refine-seams.mjs";
import {
  proposeSeamTextOnly,
  seamTextOnlyPolicy,
} from "./lib/seam-text-only.mjs";
import { assembleSeams } from "./lib/seam-refinement.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import {
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import { durable } from "./lib/bounded-asr-ab.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
export async function assembleTextOnly(input, outputRoot) {
  input = path.resolve(input);
  outputRoot = path.resolve(outputRoot);
  if (outputRoot === input || outputRoot.startsWith(input + path.sep))
    throw Error("OUTPUT_INSIDE_FROZEN_RUN");
  await verifySeams(input);
  const plan = await json(path.join(input, "plan.json")),
    rows = await json(path.join(input, "baseline-records.json")),
    views = await json(path.join(input, "views.json"));
  const decisions = plan.planned.targets.map((t) =>
    proposeSeamTextOnly(
      t,
      rows,
      views.filter((v) => v.targetId === t.id),
    ),
  );
  const candidate = assembleSeams(rows, decisions);
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputRoot, "text-only-"));
  for (const [name, value] of Object.entries({
    "baseline-records.json": rows,
    "candidate-records.json": candidate,
    "decisions.json": decisions,
    "policy.json": seamTextOnlyPolicy,
  }))
    await durable(path.join(root, name), value, true);
  const serialized = serializeRecords(candidate, plan.config.language);
  for (const [ext, content] of Object.entries(serialized.files)) {
    const p = path.join(root, `seam-text-only.machine-candidate.${ext}`);
    await fs.writeFile(p, content, { flag: "wx" });
    assert.deepEqual(
      formats[ext]
        .parse(await fs.readFile(p, "utf8"))
        .map((r) => [r.start, r.end, r.text]),
      serialized.cues.map((r) => [r.start, r.end, r.text]),
    );
  }
  const files = Object.fromEntries(
    await Promise.all(
      (await fs.readdir(root)).map(async (n) => [
        n,
        await fileHash(path.join(root, n)),
      ]),
    ),
  );
  await durable(
    path.join(root, "machine-freeze.json"),
    {
      version: seamTextOnlyPolicy.version,
      createdAt: new Date().toISOString(),
      input,
      inputFreezeHash: await fileHash(path.join(input, "machine-freeze.json")),
      files,
      code: {
        runner: await fileHash(fileURLToPath(import.meta.url)),
        policy: await fileHash(
          fileURLToPath(new URL("./lib/seam-text-only.mjs", import.meta.url)),
        ),
      },
      newInference: 0,
      qualityStatus: "needs-review",
      finalizationMethod: "none",
      humanValidated: false,
      acousticTimingVerified: false,
    },
    true,
  );
  await verifySeams(input);
  return {
    root,
    changedTargets: decisions.filter((d) => d.status === "CANDIDATE").length,
    newInference: 0,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [input, output, ...extra] = process.argv.slice(2);
    if (!input || !output || extra.length)
      throw Error("Usage: FROZEN_SEAM_RUN OUTPUT_ROOT");
    console.log(JSON.stringify(await assembleTextOnly(input, output), null, 2));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
