import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { verifyContextCtc } from "./subtitle-tool-context-ctc.mjs";
import { verifyRecovery } from "./subtitle-tool-vad-local-recovery.mjs";
import { verifyListeningVad } from "./subtitle-tool-listening-vad.mjs";
import { readPcm } from "./lib/bounded-asr-ab.mjs";
import { reviewAnchoredActivity } from "./lib/anchored-activity-review.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const norm = (t) => t.normalize("NFC").replace(/[\p{P}\p{Z}\s]/gu, "");
const [ctcRoot, vadRoot, outputArg] = process.argv.slice(2);
assert(ctcRoot && vadRoot && outputArg, "CTC_ROOT VAD_ROOT OUTPUT_PARENT");
await verifyContextCtc(ctcRoot);
const ctc = await json(path.join(ctcRoot, "plan.json")),
  result = await json(path.join(ctcRoot, "result.json"));
await verifyRecovery(ctc.source);
const parent = await json(path.join(ctc.source, "plan.json")),
  vad = await verifyListeningVad(vadRoot);
const output = path.resolve(outputArg);
await safePath(output, true);
for (const source of [ctcRoot, vadRoot, ctc.source])
  assert(
    output !== path.resolve(source) &&
      !output.startsWith(path.resolve(source) + path.sep),
    "OUTPUT_INSIDE_SOURCE",
  );
const paths = [
  import.meta.filename,
  path.join(import.meta.dirname, "lib/anchored-activity-review.mjs"),
  path.join(ctcRoot, "plan.json"),
  path.join(ctcRoot, "result.json"),
  path.join(ctcRoot, "machine-freeze.json"),
  path.join(ctc.source, "plan.json"),
  path.join(ctc.source, "machine-freeze.json"),
  path.join(vadRoot, "plan.json"),
  path.join(vadRoot, "observations.json"),
  path.join(vadRoot, "machine-freeze.json"),
  parent.spec.subtitle,
];
const selected = [];
for (const r of result.rows) {
  const q = ctc.requests.find((q) => q.id === r.id);
  assert(q, "REQUEST_MISSING");
  for (const [i, s] of (r.segments ?? []).entries()) {
    if (
      !s.conditionalCtcInterval ||
      !norm(s.text) ||
      norm(s.text) !== norm(r.greedyText)
    )
      continue;
    const item = vad.plan.items.find((v) => v.id === q.targetId),
      ob = vad.observations.find((v) => v.id === q.targetId);
    assert(item && ob, "VAD_ID_MISSING");
    assert.deepEqual(
      ob,
      parent.vadObservations.find((v) => v.id === q.targetId),
      "VAD_PARENT_BINDING",
    );
    assert.equal(s.text, q.records[i].text, "DONOR_TEXT_BINDING");
    const probe = parent.probes.find((p) => p.id === q.targetId);
    const input = {
      sourceWindow: { start: q.start, end: q.end },
      originalTarget: { start: probe.targetStart, end: probe.targetEnd },
      activityWindow: {
        start: item.start,
        end: item.start + item.frames / 16000,
      },
      anchor: s.conditionalCtcInterval,
      donor: q.records[i],
      greedyText: r.greedyText,
      vadIntervals: ob.sourceIntervals,
      baseline: parent.baseline,
    };
    selected.push({
      id: `${q.id}-segment-${i}`,
      requestId: q.id,
      targetId: q.targetId,
      input,
      review: reviewAnchoredActivity(input),
      audio: path.join(ctcRoot, q.id, "input.wav"),
      wavHash: q.wavHash,
    });
    paths.push(
      path.join(ctcRoot, q.id, "raw.json"),
      path.join(vadRoot, q.targetId, "raw.json"),
      path.join(ctcRoot, q.id, "input.wav"),
    );
  }
}
assert(selected.length > 0 && selected.length <= 4, "BOUNDED_SELECTION");
const bindings = await Promise.all(
  [...new Set(paths)].map(async (file) => ({
    file: await fs.realpath(file),
    sha256: await fileHash(file),
  })),
);
await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(path.join(output, "activity-"));
for (const s of selected) {
  assert(/^[a-zA-Z0-9._-]+$/u.test(s.id));
  const bytes = await fs.readFile(s.audio),
    pcm = readPcm(bytes);
  assert.equal(await fileHash(s.audio), s.wavHash);
  assert.equal(pcm.sampleRate, 16000);
  assert.equal(
    pcm.frames,
    Math.round((s.input.sourceWindow.end - s.input.sourceWindow.start) * 16000),
  );
  const audioName = `${s.id}.wav`;
  await fs.writeFile(path.join(root, audioName), bytes, { flag: "wx" });
  s.playback = {
    file: audioName,
    sourceStart: s.input.sourceWindow.start,
    sourceEnd: s.input.sourceWindow.end,
    anchorLocalStart: s.input.anchor.start - s.input.sourceWindow.start,
    anchorLocalEnd: s.input.anchor.end - s.input.sourceWindow.start,
    duration: pcm.frames / 16000,
    sha256: s.wavHash,
  };
  delete s.audio;
}
const put = (n, v) =>
  fs.writeFile(path.join(root, n), JSON.stringify(v, null, 2) + "\n", {
    flag: "wx",
  });
await put("activity-review.json", {
  selected,
  newInference: 0,
  textMutations: 0,
  timingMutations: 0,
  referenceUsed: false,
  labelsUsed: false,
  qualityStatus: "needs-review",
  finalizationMethod: "none",
});
await put("provenance.json", { bindings });
for (const b of bindings)
  assert.equal(await fileHash(b.file), b.sha256, "INPUT_CHANGED");
for (const s of selected)
  assert.deepEqual(s.review, reviewAnchoredActivity(s.input));
const files = {};
for (const name of await fs.readdir(root))
  files[name] = await fileHash(path.join(root, name));
await put("freeze.json", { files });
console.log(
  JSON.stringify(
    {
      root,
      selected: selected.map((s) => ({
        id: s.id,
        ...s.review,
        playback: s.playback,
      })),
      newInference: 0,
    },
    null,
    2,
  ),
);
