// Coordinator: verifies frozen credentials; workers receive only one machine JSON.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseSrt } from "../packages/subtitle-core/dist/index.js";
import { actualExportDiff } from "../packages/video-subtitler/dist/machine-quality/composed-evaluation.js";
import { freshMatchedEvidenceSchema } from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import { generationManifestSchema } from "../packages/video-subtitler/dist/machine-quality/reference-complete.js";
import {
  COMPOSED_MATRIX,
  COMPOSED_STATE,
} from "../packages/video-subtitler/dist/machine-quality/composed-profile.js";
import {
  read,
  write,
  oh,
  hash,
  digest,
  repo,
  verify,
  freeze,
  walk,
  isolated,
} from "./c60117-common.mjs";
const [oldArg, parentArg] = process.argv.slice(2);
if (!oldArg || !parentArg)
  throw Error("Usage: replay-c601172.mjs OLD_17_1_RUN OUTPUT_PARENT");
const old = path.resolve(oldArg);
for (const f of [
  "model-input-freeze.json",
  "dataset-freeze.json",
  "evidence-freeze.json",
  "run-a-freeze.json",
  "run-b-freeze.json",
])
  verify(old, f);
const m = generationManifestSchema.parse(
  read(path.join(old, "dataset/generation-manifest.json")),
);
const gate = read(path.join(old, "dataset/model-gate.json"));
const fixed = read(path.join(old, "frozen-repair-identity.json"));
if (
  m.units.length !== 12 ||
  new Set(m.units.map((u) => u.id)).size !== 12 ||
  gate.status !== "DATA_READY_FOR_FROZEN_REPAIR_CHECK" ||
  gate.generationManifestHash !== oh(m) ||
  gate.preflightHash !==
    (await hash(path.join(old, "dataset/reference-complete-preflight.json"))) ||
  gate.frozenRepairHash !==
    (await hash(path.join(old, "frozen-repair-identity.json")))
)
  throw Error("OLD_DATA_IDENTITY_INVALID");
for (const [p, h] of Object.entries(fixed.code))
  if (digest(fs.readFileSync(path.join(repo, p))) !== h)
    throw Error("Protected algorithm drift: " + p);
const credentials = [];
for (const u of m.units) {
  const file = path.join(old, "generator-input", u.id + ".json");
  const e = freshMatchedEvidenceSchema.parse(read(file));
  const rawFile = path.join(old, "evidence", u.id + ".json"),
    raw = read(rawFile);
  const r = e.primaryRequests[0];
  const key = {
    audioHash: u.audioHash,
    sampleCount: u.sampleCount,
    model: fixed.model,
    preprocessing: "mono PCM16 16k",
    prompt: "",
    timebase: "clip-local",
  };
  if (
    e.primaryRequests.length !== 1 ||
    !r ||
    r.id !== u.id ||
    oh(raw.key) !== oh(key) ||
    raw.cacheKey !== oh(key) ||
    r.cacheKey !== raw.cacheKey ||
    r.cacheFileHash !== (await hash(rawFile)) ||
    r.resultHash !== oh(raw.raw) ||
    r.modelHash !== fixed.model.modelHash ||
    r.runtime !== oh(fixed.model) ||
    r.promptHash !== oh("") ||
    r.decodeHash !== oh(fixed.model.decode) ||
    e.source.sha256 !== u.audioHash ||
    e.source.durationSeconds !== u.seconds ||
    r.interval.start !== 0 ||
    r.interval.end !== u.seconds ||
    oh(r.segments) !==
      oh(
        raw.raw.segments.map((s, i) => ({
          id: u.id + "-s" + i,
          start: s.start,
          end: s.end,
          text: s.text,
        })),
      )
  )
    throw Error("PRIMARY_EVIDENCE_IDENTITY_INVALID: " + u.id);
  credentials.push({
    id: u.id,
    inputHash: await hash(file),
    responseHash: await hash(rawFile),
    originalPromptStatus: e.promptStatus,
    modelHash: r.modelHash,
    runtime: r.runtime,
    promptHash: r.promptHash,
    decodeHash: r.decodeHash,
    sourceOffset: u.sourceOffset,
    seconds: u.seconds,
    audioHash: u.audioHash,
    replayIdentity: "VERIFIED_EVIDENCE_REPLAY",
  });
}
fs.mkdirSync(path.resolve(parentArg), { recursive: true });
const date = new Date()
  .toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })
  .replaceAll("-", "");
const root = fs.mkdtempSync(
  path.join(
    path.resolve(parentArg),
    "machine-quality-c6-0-1-17-2-" + date + "-",
  ),
);
write(path.join(root, "input-receipt.local-only.json"), {
  oldRoot: old,
  credentials,
  oldGenerationManifest: m,
  model: fixed.model,
  oldFreezes: Object.fromEntries(
    [
      "dataset-freeze.json",
      "model-input-freeze.json",
      "evidence-freeze.json",
    ].map((f) => [f, digest(fs.readFileSync(path.join(old, f)))]),
  ),
  note: "Coordinator hashes sealed reference during credential verification; generator has no reference access. No data preparation or audio extraction.",
});
for (const u of m.units)
  write(
    path.join(root, "generator-input", u.id + ".json"),
    fs.readFileSync(path.join(old, "generator-input", u.id + ".json"), "utf8"),
  );
write(path.join(root, "profile-matrix.json"), {
  ...COMPOSED_STATE,
  profiles: COMPOSED_MATRIX,
  disabledHooks: ["acoustic", "stored", "groups"],
});
const code = [
  ...walk(path.join(repo, "packages")).filter(
    (p) => p.includes("/dist/") && p.endsWith(".js"),
  ),
  ...walk(path.join(repo, "scripts")).filter((p) => /c60117/.test(p)),
  path.join(repo, "package.json"),
  path.join(repo, "package-lock.json"),
];
write(
  path.join(root, "implementation-identity.json"),
  Object.fromEntries(
    code.map((p) => [path.relative(repo, p), digest(fs.readFileSync(p))]),
  ),
);
freeze(root, "input-freeze.json", [
  ...walk(path.join(root, "generator-input")),
  path.join(root, "profile-matrix.json"),
  path.join(root, "implementation-identity.json"),
  path.join(root, "input-receipt.local-only.json"),
]);
const clocks = [],
  parity = [],
  pairs = [];
const oldVariants = {
  "P0-primary-minimal": "P0-primary-minimal",
  "G00-legacy": "P1-current-matched",
  "G10-cross-guard": "P2-frozen-overlap-required",
};
for (const run of ["run-a", "run-b"]) {
  for (const u of m.units) {
    const input = path.join(root, "generator-input", u.id + ".json"),
      out = path.join(root, run, u.id);
    fs.mkdirSync(out, { recursive: true });
    const startedAt = new Date().toISOString();
    isolated("generate-c601172.mjs", [input, out], [input], out);
    clocks.push({
      run,
      unit: u.id,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    const exported = Object.fromEntries(
      COMPOSED_MATRIX.map((v) => {
        const dir = path.join(out, v.id),
          pkg = read(path.join(dir, "subtitle-package.needs-review.json"));
        return [
          v.id,
          parseSrt(
            fs.readFileSync(path.join(dir, "machine-candidate.srt"), "utf8"),
          ).map((c, i) => ({ ...c, id: pkg.cues[i].id })),
        ];
      }),
    );
    write(path.join(out, "export-diff.json"), {
      G11vsG10: actualExportDiff(
        exported["G10-cross-guard"],
        exported["G11-composed"],
      ),
      G11vsP0: actualExportDiff(
        exported["P0-primary-minimal"],
        exported["G11-composed"],
      ),
      referenceRead: false,
      acousticTruth: "UNKNOWN",
    });
    for (const [v, ov] of Object.entries(oldVariants))
      for (const ext of ["ass", "srt", "vtt"]) {
        const file = "machine-candidate." + ext,
          actual = await hash(path.join(out, v, file)),
          expected = await hash(path.join(old, "run-a", u.id, ov, file));
        parity.push({
          run,
          unit: u.id,
          variant: v,
          format: ext,
          actual,
          expected,
          passed: actual === expected,
        });
      }
    for (const [a, b] of [
      ["G00-legacy", "G01-intra-guard"],
      ["G10-cross-guard", "G11-composed"],
    ]) {
      const ta = read(path.join(out, a, "stage-trace.json")),
        tb = read(path.join(out, b, "stage-trace.json"));
      if (
        oh(ta.slice(0, 2)) !== oh(tb.slice(0, 2)) ||
        ta[2].inputHash !== tb[2].inputHash
      )
        throw Error("PRE_INTRA_STAGE_MISMATCH");
      pairs.push({
        run,
        unit: u.id,
        a,
        b,
        preIntraEqual: true,
        firstDifferentStage:
          ta.find((t, i) => oh(t) !== oh(tb[i]))?.stageName ?? null,
      });
    }
  }
  freeze(root, run + "-freeze.json", walk(path.join(root, run)));
}
execFileSync("diff", [
  "-qr",
  path.join(root, "run-a"),
  path.join(root, "run-b"),
]);
write(path.join(root, "execution-clocks.json"), clocks);
write(path.join(root, "baseline-parity.json"), {
  passed: parity.every((p) => p.passed),
  comparisons: parity,
});
write(path.join(root, "stage-pair-parity.json"), pairs);
if (parity.some((p) => !p.passed))
  throw Error("BASELINE_REPLAY_MISMATCH: " + root);
freeze(
  root,
  "generation-freeze.json",
  [
    "input-freeze.json",
    "run-a-freeze.json",
    "run-b-freeze.json",
    "baseline-parity.json",
    "stage-pair-parity.json",
    "execution-clocks.json",
  ].map((p) => path.join(root, p)),
);
write(path.join(root, "experiment-manifest.json"), {
  ...COMPOSED_STATE,
  baseline: "49760ce269408dd3311059ce056e8f11e4d70974",
  units: m.units.length,
  allFiveUseSameEvidence: true,
  ABByteParity: true,
  baselineFormatsReproduced: true,
  generationReferenceReads: 0,
  referenceAccessEnforcement:
    "Node permission exact-input allowlist + no child/addon permission + sandbox-exec deny network",
  dataPreparation:
    "NOT_RUN; prior reference-segmented unit identity verified, not regenerated",
});
console.log(root);
