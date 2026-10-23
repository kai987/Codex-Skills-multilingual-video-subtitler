import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  childEnv,
  isolated,
} from "./c60117-common.mjs";
const [phase, rootArg] = process.argv.slice(2),
  root = path.resolve(rootArg);
verify(root, "model-input-freeze.json");
const m = read(path.join(root, "dataset/generation-manifest.json")),
  gate = read(path.join(root, "dataset/model-gate.json")),
  fixed = read(path.join(root, "frozen-repair-identity.json"));
if (
  gate.status !== "DATA_READY_FOR_FROZEN_REPAIR_CHECK" ||
  gate.generationManifestHash !== oh(m)
)
  throw Error("DATA_PREFLIGHT_FAILED");
// Coordinator verifies the preparation credential; the model child never
// receives the full preflight (denominators) or evaluator manifest.
if (
  (await hash(path.join(root, "dataset/reference-complete-preflight.json"))) !==
  gate.preflightHash
)
  throw Error("PREFLIGHT_HASH_MISMATCH");
for (const [p, h] of Object.entries(fixed.code))
  if (digest(fs.readFileSync(path.join(repo, p))) !== h)
    throw Error("Frozen algorithm drift: " + p);
if (phase === "generate-primary") {
  const retry = process.argv[4] === "--retry-execution-failure";
  if (
    fs.existsSync(path.join(root, "model-execution-summary.json")) ||
    (fs.existsSync(path.join(root, "model-execution-start.json")) && !retry)
  )
    throw Error("Model phase already attempted");
  const rt = read(path.join(root, "runtime.local-only.json"));
  // OS read deny protects all private references, not just omitted arguments.
  const literal = (s) => JSON.stringify(s);
  const allow = [
    repo,
    root + "/audio",
    root + "/attempts",
    root + "/evidence",
    root + "/generator-input",
    path.dirname(path.dirname(rt.whisper)),
    rt.whisperModel,
    path.dirname(path.dirname(process.execPath)),
    "/System",
    "/usr",
    "/Library",
    "/opt/homebrew",
    "/dev",
    "/private/var/db",
    "/private/var/folders",
  ];
  const exact = [
    "model-input-freeze.json",
    "frozen-repair-identity.json",
    "runtime.local-only.json",
    "dataset/generation-manifest.json",
    "dataset/model-gate.json",
  ].map((p) => path.join(root, p));
  fs.mkdirSync(path.join(root, "attempts"), { recursive: true });
  const policy = `(version 1)(allow default)(deny network*)(deny file-read-data (subpath ${literal(path.resolve(repo, ".."))}) (subpath ${literal(path.resolve(repo, "../../Downloads"))}))(allow file-read-data ${allow.map((p) => "(subpath " + literal(p) + ")").join(" ")} ${[...exact, process.execPath].map((p) => "(literal " + literal(p) + ")").join(" ")})`;
  const pf = path.join(
    root,
    "model-sandbox-policy-" + digest(policy).slice(0, 12) + ".local-only.txt",
  );
  if (!fs.existsSync(pf)) write(pf, policy);
  execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      policy,
      process.execPath,
      "-e",
      "try { require('fs').readFileSync(process.argv[1]); process.exit(3); } catch(e) { if (!['EPERM','EACCES'].includes(e.code)) throw e; }",
      path.join(root, "dataset/evaluation-only/reference-manifest.json"),
    ],
    { env: childEnv },
  );
  execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      policy,
      process.execPath,
      path.join(repo, "scripts/execute-c601171.mjs"),
      root,
      ...(retry ? ["--retry-execution-failure"] : []),
    ],
    { stdio: "inherit", env: childEnv },
  );
  freeze(root, "evidence-freeze.json", [
    ...walk(path.join(root, "evidence")),
    ...walk(path.join(root, "generator-input")),
  ]);
} else if (phase === "generate-frozen-variants") {
  verify(root, "evidence-freeze.json");
  const cfg = path.join(root, "frozen-generator-config.json");
  write(cfg, {
    partition: "D",
    runName: "frozen",
    repair: "occurrence-overlap-required",
  });
  for (const run of ["run-a", "run-b"]) {
    for (const u of m.units) {
      const input = path.join(root, "generator-input", u.id + ".json"),
        out = path.join(root, run, u.id);
      fs.mkdirSync(out, { recursive: true });
      isolated("generate-c60117.mjs", [input, cfg, out], [input, cfg], out);
      // The frozen generator keeps its legacy internal name; path alias only.
      fs.renameSync(
        path.join(out, "P2-one-family-recovery"),
        path.join(out, "P2-frozen-overlap-required"),
      );
      for (const ext of ["ass", "srt", "vtt", "json"]) {
        const f =
          ext === "json"
            ? "subtitle-package.needs-review.json"
            : "machine-candidate." + ext;
        if (
          (await hash(path.join(out, "P1-current-matched", f))) !==
          (await hash(path.join(out, "P2-repair-disabled", f)))
        )
          throw Error("OFF_P1_INVALID_CONTROL");
      }
    }
    freeze(root, run + "-freeze.json", walk(path.join(root, run)));
  }
  execFileSync("diff", [
    "-qr",
    path.join(root, "run-a"),
    path.join(root, "run-b"),
  ]);
  write(path.join(root, "generation-freeze.json"), {
    frozenAt: new Date().toISOString(),
    runAHash: await hash(path.join(root, "run-a-freeze.json")),
    runBHash: await hash(path.join(root, "run-b-freeze.json")),
    generationReferenceReads: 0,
    AUX: "NOT_RERUN_THIS_EXPERIMENT",
    BENCHMARK_REFERENCE_SEGMENTED: true,
  });
} else throw Error("generate-primary ROOT | generate-frozen-variants ROOT");
