/** Zero-inference machine replay; human feedback is a separate post-freeze command. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { verifyRecovery } from "./subtitle-tool-vad-local-recovery.mjs";
import { sourceOccurrenceInputs } from "./lib/source-occurrence-routing.mjs";
import {
  planContextRecovery,
  boundActivityToCrop,
} from "./lib/recovery-context-routing.mjs";

const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });

async function loadMachine(source) {
  const plan = await json(path.join(source, "plan.json"));
  const views = await json(path.join(source, "views.json"));
  const supported = sourceOccurrenceInputs(plan, views);
  const triage = await json(path.join(plan.spec.triage, "triage.json"));
  assert.deepEqual(
    triage.rows.map((r) => r.id).sort(),
    plan.vadObservations.map((r) => r.id).sort(),
    "INVENTORY_CHANGED",
  );
  const targets = triage.rows.map((r) => {
    const prior = supported.find((t) => t.probe.id === r.id);
    const probe = prior?.probe ?? {
      id: r.id,
      start: r.playbackStart,
      end: r.playbackEnd,
      targetStart: r.targetStart,
      targetEnd: r.targetEnd,
    };
    assert(
      Math.abs(probe.targetStart - r.targetStart) < 1e-8 &&
        Math.abs(probe.targetEnd - r.targetEnd) < 1e-8,
      "TARGET_CHANGED",
    );
    const o = plan.vadObservations.find((x) => x.id === r.id);
    return {
      probe: {
        id: probe.id,
        start: probe.start,
        end: probe.end,
        targetStart: probe.targetStart,
        targetEnd: probe.targetEnd,
      },
      observation: {
        id: o.id,
        sourceIntervals: boundActivityToCrop(o.sourceIntervals, probe),
      },
      views: prior?.views ?? [],
    };
  });
  assert.deepEqual(
    await json(path.join(source, "candidate.json")),
    plan.baseline,
    "HISTORICAL_BASELINE_MUTATED",
  );
  return { input: { baseline: plan.baseline, targets }, plan };
}

export async function replayContext(source, output) {
  source = await fs.realpath(source);
  output = path.resolve(output);
  await safePath(output, true);
  assert(
    output !== source && !output.startsWith(source + path.sep),
    "OUTPUT_INSIDE_SOURCE",
  );
  const verification = await verifyRecovery(source);
  const { input, plan } = await loadMachine(source);
  const bindings = await Promise.all(
    [
      ...[
        "machine-freeze.json",
        "plan.json",
        "views.json",
        "candidate.json",
      ].map((n) => path.join(source, n)),
      path.join(plan.spec.triage, "triage-freeze.json"),
      path.join(plan.spec.triage, "triage.json"),
      import.meta.filename,
      path.join(import.meta.dirname, "lib/recovery-context-routing.mjs"),
      path.join(import.meta.dirname, "lib/source-occurrence-routing.mjs"),
      path.join(import.meta.dirname, "lib/speech-support-policy.mjs"),
    ].map(async (file) => ({ file, sha256: await fileHash(file) })),
  );
  const routing = planContextRecovery(input);
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "context-"));
  await put(path.join(root, "machine-inputs.json"), input);
  await put(path.join(root, "routing.json"), routing);
  await put(path.join(root, "provenance.json"), {
    source,
    bindings,
    verification,
    labelsRead: false,
    referenceRead: false,
    previouslyExposedDevelopmentEpisode: true,
    independentHoldout: false,
    scope: "offline-recovery-routing-not-default-generation",
    activityProjection:
      "crop-edge-floating-point-clamp-only-at-most-1e-8-seconds-raw-preserved",
  });
  for (const b of bindings)
    assert.equal(await fileHash(b.file), b.sha256, "INPUT_CHANGED");
  const files = {};
  for (const name of ["machine-inputs.json", "routing.json", "provenance.json"])
    files[name] = await fileHash(path.join(root, name));
  await put(path.join(root, "machine-freeze.json"), {
    files,
    newInference: 0,
    subtitleMutationAuthorized: false,
  });
  return { root, counts: routing.counts, ...(await verifyContext(root)) };
}

export async function verifyContext(root) {
  root = await fs.realpath(root);
  const f = await json(path.join(root, "machine-freeze.json"));
  assert.deepEqual(Object.keys(f.files).sort(), [
    "machine-inputs.json",
    "provenance.json",
    "routing.json",
  ]);
  for (const [name, digest] of Object.entries(f.files)) {
    await safePath(path.join(root, name));
    assert.equal(
      await fileHash(path.join(root, name)),
      digest,
      "OUTPUT_CHANGED",
    );
  }
  const p = await json(path.join(root, "provenance.json"));
  for (const b of p.bindings)
    assert.equal(await fileHash(b.file), b.sha256, "SOURCE_CHANGED");
  const input = (await loadMachine(p.source)).input;
  assert.deepEqual(
    await json(path.join(root, "machine-inputs.json")),
    input,
    "INPUT_REPLAY_CHANGED",
  );
  const r = planContextRecovery(input);
  assert.deepEqual(
    await json(path.join(root, "routing.json")),
    r,
    "ROUTING_REPLAY_CHANGED",
  );
  return {
    integrity: "passed",
    retained: r.retained,
    dropped: r.dropped,
    newInference: 0,
    subtitleMutations: 0,
  };
}

export async function evaluateContext(root, feedbackRoot) {
  const verification = await verifyContext(root); // Barrier before label import/read.
  const machineFreezeHash = await fileHash(
    path.join(root, "machine-freeze.json"),
  );
  const { verifyFragmentFeedback } =
    await import("./evaluate-short-response-fragments.mjs");
  await verifyFragmentFeedback(feedbackRoot);
  const feedbackFreezeHash = await fileHash(
    path.join(feedbackRoot, "evaluation-freeze.json"),
  );
  const feedback = await json(path.join(feedbackRoot, "comparison.json"));
  const routing = await json(path.join(root, "routing.json"));
  const inputs = await json(path.join(root, "machine-inputs.json"));
  const fp = await json(path.join(feedbackRoot, "provenance.json"));
  const old = await json(path.join(fp.parent, "evaluation-inputs.json"));
  assert.deepEqual(
    inputs.baseline,
    old.snapshot.baseline,
    "EVALUATION_BASELINE_CHANGED",
  );
  const sourceItems = old.snapshot.manifest.items;
  const rows = feedback.rows.map((f) => {
    const r = routing.rows.find((x) => x.id === f.id);
    const item = sourceItems.find((x) => x.id === f.id);
    assert(r && item?.audioHash === f.audioHash, "FEEDBACK_IDENTITY_CHANGED");
    assert(
      Math.abs(r.target.start - f.target.start) < 1e-8 &&
        Math.abs(r.target.end - f.target.end) < 1e-8,
      "EVALUATION_TARGET_CHANGED",
    );
    return {
      id: f.id,
      suppliedText: f.suppliedText,
      annotationKind: f.annotationKind,
      priorRelation: f.priorRelation,
      machineRoute: r.route,
      baselineGeometry: r.baselineGeometry.kind,
      asrStatus: r.asrStatus,
      retained: r.retained,
      reviewRequired: r.reviewRequired,
      safeToInsert: r.safeToInsert,
      automaticTextChange: false,
      interpretation:
        f.annotationKind === "interjection-type-only"
          ? "embedded-or-boundary-interjection-still-unresolved-not-filtered"
          : "fragment-feedback-not-complete-occurrence-truth",
      targetWordAccuracy: null,
      confirmedBoundary: null,
    };
  });
  const result = {
    verification,
    machineFreezeHash,
    feedbackFreezeHash,
    rows,
    comparisonScope:
      "post-freeze-exposed-development-diagnostics-not-classifier-accuracy",
    generatedSubtitlesImproved: null,
    newInference: 0,
    subtitleMutations: 0,
  };
  await verifyContext(root);
  assert.equal(
    await fileHash(path.join(feedbackRoot, "evaluation-freeze.json")),
    feedbackFreezeHash,
  );
  const out = path.join(root, "evaluation");
  await fs.mkdir(out);
  await put(path.join(out, "comparison.json"), result);
  await put(path.join(out, "freeze.json"), {
    machineFreezeHash,
    feedbackFreezeHash,
    resultHash: await fileHash(path.join(out, "comparison.json")),
    evaluatorHash: await fileHash(import.meta.filename),
  });
  return { output: out, rows, newInference: 0 };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [cmd, ...args] = process.argv.slice(2);
  assert(
    (cmd === "replay" && args.length === 2) ||
      (cmd === "verify" && args.length === 1) ||
      (cmd === "evaluate" && args.length === 2),
    "replay RECOVERY OUTPUT | verify ROOT | evaluate ROOT FEEDBACK_ROOT",
  );
  console.log(
    JSON.stringify(
      cmd === "replay"
        ? await replayContext(...args)
        : cmd === "verify"
          ? await verifyContext(...args)
          : await evaluateContext(...args),
      null,
      2,
    ),
  );
}
