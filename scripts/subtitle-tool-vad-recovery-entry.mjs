/** Existing recovery entry with a pre-dispatch observe-only context sidecar. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import * as legacy from "./subtitle-tool-vad-local-recovery.mjs";
import { observeLocalRecoveryPlan } from "./lib/local-recovery-context-plan.mjs";

const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const files = ["planning.json", "provenance.json"];
const sidecar = "context-planning";
const codeFiles = [
  import.meta.filename,
  ...[
    "lib/local-recovery-context-plan.mjs",
    "lib/vad-local-recovery.mjs",
    "lib/recovery-context-routing.mjs",
    "lib/source-occurrence-routing.mjs",
    "lib/speech-support-policy.mjs",
  ].map((p) => path.join(import.meta.dirname, p)),
];

async function compute(source) {
  const p = await json(path.join(source, "plan.json"));
  assert(
    p.labelsUsed === false && p.referenceUsed === false,
    "MACHINE_PLAN_REQUIRED",
  );
  const triage = await json(path.join(p.spec.triage, "triage.json"));
  const result = observeLocalRecoveryPlan({
    triage,
    baseline: p.baseline,
    duration: p.duration,
    observations: p.vadObservations,
  });
  assert.deepEqual(result.selected, p.selected, "LEGACY_SELECTION_CHANGED");
  return { result, triageRoot: p.spec.triage };
}

export async function writePlanning(source, root) {
  source = await fs.realpath(source);
  const { result, triageRoot } = await compute(source);
  const bindings = await Promise.all(
    [
      path.join(source, "plan.json"),
      path.join(source, "plan-freeze.json"),
      path.join(triageRoot, "triage.json"),
      path.join(triageRoot, "triage-freeze.json"),
      ...codeFiles,
    ].map(async (file) => ({ file, sha256: await fileHash(file) })),
  );
  await safePath(root, true);
  await fs.mkdir(root); // exclusive; never replace an existing observation
  await put(path.join(root, "planning.json"), result);
  await put(path.join(root, "provenance.json"), {
    source,
    bindings,
    labelsRead: false,
    referenceRead: false,
    asrViewsRead: false,
    scope:
      "existing-local-recovery-planner-observation-not-generation-acceptance",
  });
  for (const b of bindings)
    assert.equal(await fileHash(b.file), b.sha256, "INPUT_CHANGED");
  await put(path.join(root, "freeze.json"), {
    files: Object.fromEntries(
      await Promise.all(
        files.map(async (n) => [n, await fileHash(path.join(root, n))]),
      ),
    ),
  });
  return { root, ...(await verifyPlanning(root)) };
}

export async function verifyPlanning(root) {
  await safePath(root);
  const freeze = await json(path.join(root, "freeze.json"));
  assert.deepEqual(
    Object.keys(freeze.files).sort(),
    files,
    "PAYLOAD_INVENTORY",
  );
  for (const [n, hash] of Object.entries(freeze.files)) {
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), hash, "OUTPUT_CHANGED");
  }
  const p = await json(path.join(root, "provenance.json"));
  for (const b of p.bindings)
    assert.equal(await fileHash(b.file), b.sha256, "SOURCE_CHANGED");
  const { result } = await compute(p.source);
  assert.deepEqual(
    await json(path.join(root, "planning.json")),
    result,
    "PLANNING_CHANGED",
  );
  return {
    integrity: "passed",
    retained: result.rows.length,
    selected: result.selectedTargets,
    deferred: result.deferredTargets,
    plannedRequests: result.plannedRequests,
    plannedAudioSeconds: result.plannedAudioSeconds,
    actualNewRequests: 0,
    requestsSaved: 0,
    schedulingChanged: false,
  };
}

async function optionalSidecar(root) {
  const dest = path.join(root, sidecar);
  try {
    await fs.lstat(dest);
  } catch (e) {
    if (e.code === "ENOENT")
      return { mode: "legacy-without-context-observation" };
    throw e;
  }
  return verifyPlanning(dest); // a present but incomplete/changed sidecar fails closed
}

export async function recoveryEntry(args, api = legacy) {
  const [cmd, a, b] = args;
  if (cmd === "--help" && args.length === 1)
    return {
      usage:
        "prepare SPEC OUTPUT | run ROOT --authorize-local | finish ROOT | verify ROOT | observe ROOT OUTPUT | verify-observation ROOT",
      observe:
        "Zero inference. Replays existing planning; does not change selection or subtitle decisions.",
      prepare:
        "New preparations automatically include a context-planning sidecar. No extra model budget.",
    };
  if (cmd === "prepare" && a && b && args.length === 3) {
    const result = await api.prepareRecovery(await json(a), b);
    // Only the newly created task is extended; immutable historical tasks are not.
    const context = await writePlanning(
      result.root,
      path.join(result.root, sidecar),
    );
    return { ...result, context };
  }
  if (cmd === "observe" && a && b && args.length === 3) {
    const source = await fs.realpath(a),
      output = path.resolve(b);
    await safePath(output, true);
    assert(
      output !== source && !output.startsWith(source + path.sep),
      "OUTPUT_INSIDE_SOURCE",
    );
    const parent = await api.verifyRecovery(source); // offline, no dispatch
    const { result } = await compute(source); // fail before creating outputs
    await fs.mkdir(output, { recursive: true });
    const container = await fs.mkdtemp(path.join(output, "recovery-plan-"));
    const context = await writePlanning(source, path.join(container, sidecar));
    return { ...context, parentIntegrity: parent.integrity, rows: result.rows };
  }
  if (cmd === "verify-observation" && a && args.length === 2)
    return verifyPlanning(a);
  if (cmd === "run" && a && b === "--authorize-local" && args.length === 3) {
    await optionalSidecar(a);
    return api.runRecovery(a, true);
  }
  if ((cmd === "finish" || cmd === "verify") && a && args.length === 2) {
    const context = await optionalSidecar(a);
    const result = await (cmd === "finish"
      ? api.finishRecovery(a)
      : api.verifyRecovery(a));
    return { ...result, context };
  }
  throw Error("Invalid arguments; run requires --authorize-local. Use --help.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(await recoveryEntry(process.argv.slice(2)), null, 2),
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
