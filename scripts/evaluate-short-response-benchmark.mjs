/** Snapshot and evaluate existing evidence only; no provider run entry points. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { verifyTail } from "./subtitle-tool-vowel-tail.mjs";
import {
  verifyListening,
  evaluateListening,
} from "./lib/audio-coverage-calibration.mjs";
import { evaluateShortResponses } from "./lib/short-response-benchmark.mjs";

const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
if (process.argv[2] === "--batch") {
  await evaluateBatch(...process.argv.slice(3));
} else {
  const [specPath, outputBase] = process.argv.slice(2);
  assert(specPath && outputBase, "SPEC_JSON OUTPUT_BASE");
  const spec = await json(specPath),
    output = path.resolve(outputBase);
  await safePath(output, true);
  for (const input of [spec.tail, spec.human]) {
    const p = await fs.realpath(input);
    assert(output !== p && !output.startsWith(p + path.sep));
  }
  const verification = await verifyTail(spec.tail); // Offline PCM calculation, no neural imports/model loads.
  const tp = await json(path.join(spec.tail, "plan.json"));
  const ep = await json(path.join(tp.parent, "plan.json"));
  const ap = await json(path.join(ep.parent, "plan.json"));
  const recovery = ap.sourceRoot,
    rp = await json(path.join(recovery, "plan.json"));
  const tf = await json(path.join(rp.spec.triage, "triage-freeze.json"));
  const vp = await json(path.join(tf.sourceRoot, "plan.json"));
  const { manifest, manifestHash } = await verifyListening(vp.listeningRoot);
  const labels = await json(spec.labels);
  evaluateListening(manifest, manifestHash, labels);
  const hf = await json(path.join(spec.human, "human-assisted-freeze.json"));
  for (const [n, h] of Object.entries(hf.files)) {
    assert.equal(path.basename(n), n);
    await safePath(path.join(spec.human, n));
    assert.equal(await fileHash(path.join(spec.human, n)), h);
  }
  const human = await json(path.join(spec.human, "human-confirmation.json"));
  assert.equal(path.resolve(human.parent), path.resolve(spec.tail));
  assert.equal(
    human.evidenceHash,
    await fileHash(path.join(spec.tail, "machine-freeze.json")),
  );
  assert.equal(manifestHash, vp.manifestHash);
  assert.equal(manifest.items.length, 16);
  for (let i = 0; i < manifest.items.length; i++)
    for (let j = i + 1; j < manifest.items.length; j++) {
      const a = manifest.items[i],
        b = manifest.items[j];
      assert(a.end <= b.start || b.end <= a.start, "OVERLAPPING_SAMPLE_AUDIO");
    }
  const snapshot = {
    manifest,
    labels: labels.labels,
    observations: rp.vadObservations,
    decisions: await json(path.join(recovery, "decisions.json")),
    baseline: rp.baseline,
    candidate: await json(path.join(recovery, "candidate.json")),
    confirmedId: ep.targetId,
    confirmation: human.confirmation,
    extent: await json(path.join(tp.parent, "result.json")),
    tail: await json(path.join(spec.tail, "result.json")),
  };
  const result = evaluateShortResponses(snapshot);
  const inputPaths = [
    specPath,
    spec.labels,
    path.join(spec.human, "human-confirmation.json"),
    path.join(spec.human, "human-assisted-freeze.json"),
    path.join(spec.tail, "machine-freeze.json"),
    path.join(tp.parent, "machine-freeze.json"),
    path.join(recovery, "machine-freeze.json"),
    path.join(vp.listeningRoot, "listening-freeze.json"),
    path.join(tf.sourceRoot, "machine-freeze.json"),
    path.join(import.meta.dirname, "evaluate-short-response-benchmark.mjs"),
    path.join(import.meta.dirname, "lib/short-response-benchmark.mjs"),
  ];
  const inputs = await Promise.all(
    inputPaths.map(async (file) => ({ file, sha256: await fileHash(file) })),
  );
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "benchmark-"));
  const put = (name, value) =>
    fs.writeFile(path.join(root, name), JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
    });
  await fs.mkdir(path.join(root, "audio"));
  for (const item of manifest.items) {
    const bytes = await fs.readFile(path.join(vp.listeningRoot, item.audio));
    const dest = path.join(root, "audio", item.id + ".wav");
    await fs.writeFile(dest, bytes, { flag: "wx" });
    assert.equal(await fileHash(dest), item.audioHash);
  }
  await put("evaluation-inputs.json", snapshot);
  await put("results.json", result);
  await put("provenance.json", {
    inputs,
    verification,
    historicalAsrRequests: 8,
    newModelCalls: 0,
    role: "previously-exposed-development-evaluation-only",
  });
  const header = [
    "clip",
    "target_start",
    "target_end",
    "human_sound",
    "human_relation",
    "triage",
    "ASR",
    "reason",
    "baseline_overlap_ids",
    "whole_interval_label",
  ];
  const csv =
    [
      header,
      ...result.rows.map((r) => [
        r.id,
        r.target.start,
        r.target.end,
        r.soundLabel,
        r.relationLabel,
        r.triage,
        r.asrStatus,
        r.asrReason ?? "",
        r.baselineOverlappingCueIds.join(";"),
        r.independentUtteranceBoundaryLabel ? "human-confirmed" : "unavailable",
      ]),
    ]
      .map((r) =>
        r.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
      )
      .join("\n") + "\n";
  await fs.writeFile(path.join(root, "cases.csv"), csv, { flag: "wx" });
  for (const b of inputs)
    assert.equal(
      await fileHash(b.file),
      b.sha256,
      "INPUT_CHANGED_DURING_EVALUATION",
    );
  const files = {};
  for (const name of [
    "evaluation-inputs.json",
    "results.json",
    "provenance.json",
    "cases.csv",
    ...manifest.items.map((i) => `audio/${i.id}.wav`),
  ])
    files[name] = await fileHash(path.join(root, name));
  await put("evaluation-freeze.json", {
    files,
    machineIndependent: false,
    evaluationOnly: true,
  });
  console.log(
    JSON.stringify(
      {
        root,
        summary: result.summary,
        groups: result.groups,
        boundaries: result.boundaries,
      },
      null,
      2,
    ),
  );
}

async function evaluateBatch(root, benchmarkRoot, referencePath) {
  assert(
    root && benchmarkRoot && referencePath,
    "--batch RUN FROZEN_BENCHMARK REFERENCE_ASS",
  );
  const { verifyFrozenBatch } = await import("./replay-frozen-candidates.mjs");
  const { compareReference } =
    await import("./lib/subtitle-reference-comparison.mjs");
  const { includeSongs } = await import("./evaluate-seam-refinement.mjs");
  const integrity = await verifyFrozenBatch(root);
  const freezeHash = await fileHash(path.join(root, "machine-freeze.json"));
  const batch = await json(path.join(root, "batch.json"));
  const snapshot = await json(path.join(root, "snapshot.json"));
  // Machine freeze and replay barrier precedes ALL reference/label reads.
  const referenceFirstReadAt = new Date().toISOString();
  const annotationFreeze = await json(
    path.join(benchmarkRoot, "evaluation-freeze.json"),
  );
  const inputPath = path.join(benchmarkRoot, "evaluation-inputs.json");
  await safePath(inputPath);
  assert.equal(
    await fileHash(inputPath),
    annotationFreeze.files["evaluation-inputs.json"],
    "ANNOTATIONS_CHANGED",
  );
  const old = await json(inputPath);
  assert.deepEqual(
    old.baseline,
    batch.baseline,
    "EVALUATION_BASELINE_MISMATCH",
  );
  const shortResponses = evaluateShortResponses({
    ...old,
    mode: "candidate-gain",
    baseline: batch.baseline,
    candidate: batch.candidate,
    decisions: batch.decisions,
  });
  const referenceAss = await fs.readFile(referencePath, "utf8"),
    referenceHash = await fileHash(referencePath);
  const windows = [
    {
      id: "whole-episode",
      kind: "full-source-text",
      start: 0,
      end: snapshot.local.duration,
    },
  ];
  const compare = (ass) =>
    compareReference({
      referenceAss: ass,
      baselineRecords: batch.baseline,
      candidateRecords: batch.candidate,
      windows,
    }).perWindow[0];
  const episode = compare(includeSongs(referenceAss));
  // Pure Dialogue reference comparison is supplementary: machine rows still include
  // songs, so never call its insertion count dialogue-only ASR errors.
  const dialogueReferenceComparison = compare(referenceAss);
  const report = {
    version: "frozen-candidate-gain-evaluation-v1",
    integrity,
    freezeHash,
    referenceHash,
    annotationSnapshotHash: await fileHash(inputPath),
    referenceFirstReadAt,
    shortResponses,
    episode,
    dialogueReferenceComparison,
    decisions: batch.rows,
    limitations: [
      "Known development episode; not an unseen test",
      "Only one complete missing-utterance reference; other speech labels do not confirm omissions",
      "Unscored insertions excluded from precision; report scored fraction",
      "Dialogue reference comparison retains full machine text including songs; not dialogue-only accuracy",
      "Text edit distance and safe serialization do not prove acoustic correctness",
    ],
  };
  await verifyFrozenBatch(root);
  assert.equal(
    await fileHash(path.join(root, "machine-freeze.json")),
    freezeHash,
  );
  assert.equal(await fileHash(referencePath), referenceHash);
  assert.equal(
    await fileHash(inputPath),
    annotationFreeze.files["evaluation-inputs.json"],
  );
  const out = path.join(root, "evaluation");
  await fs.mkdir(out); // Exclusive: no overwriting an earlier evaluation.
  await fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(out, "freeze.json"),
    JSON.stringify(
      {
        resultHash: await fileHash(path.join(out, "results.json")),
        machineFreezeHash: freezeHash,
        evaluatorHash: await fileHash(import.meta.filename),
        policyHash: await fileHash(
          path.join(import.meta.dirname, "lib/short-response-benchmark.mjs"),
        ),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify(
      {
        output: out,
        gain: shortResponses.insertionEvaluation,
        episode: {
          baseline: episode.baseline.edit,
          candidate: episode.candidate.edit,
        },
        decisions: batch.rows,
      },
      null,
      2,
    ),
  );
}
