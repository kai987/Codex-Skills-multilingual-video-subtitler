import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  read,
  write,
  hashFile,
  objectHash,
  walk,
  checkFiles,
  repo,
  freeze,
  isolated,
  oldInputs,
  verify,
} from "./c6011642-common.mjs";
const [phase, ...args] = process.argv.slice(2);
if (phase === "prepare") {
  const [previous, output, python, testReceipt] = args.map((p) =>
    path.resolve(p),
  );
  const old = read(path.join(previous, "boundary-plan.json"));
  checkFiles(
    previous,
    read(path.join(previous, "boundary-evidence-freeze.json")).files,
  );
  checkFiles(
    previous,
    read(path.join(previous, "generation-freeze.json")).files,
  );
  const proposals = read(path.join(previous, "boundary-proposals.json"))["W+4"];
  const targets = old.targets
    .filter((t) =>
      proposals.some(
        (p) =>
          p.cueId === t.cueId &&
          p.risks.includes("NEIGHBOR_OR_OCCURRENCE_CONFLICT"),
      ),
    )
    .sort(
      (a, b) =>
        a.oldFirstTokenStart - b.oldFirstTokenStart ||
        a.cueId.localeCompare(b.cueId),
    );
  if (!targets.length) throw Error("NO_MACHINE_OCCURRENCE_CONFLICT_TARGET");
  const target = targets[0];
  if (
    target.firstTokenIndex !== old.requests[0].prefixTokenCount ||
    target.lastTokenIndex !== old.requests[0].anchors.length - 1
  )
    throw Error("UNSUPPORTED_NON_TERMINAL_TARGET");
  fs.mkdirSync(output);
  const copy = (from, to) => {
    fs.mkdirSync(path.dirname(path.join(output, to)), { recursive: true });
    fs.copyFileSync(from, path.join(output, to), fs.constants.COPYFILE_EXCL);
  };
  for (const f of oldInputs)
    copy(path.join(previous, "previous", f), path.join("previous", f));
  copy(
    path.join(previous, "boundary-plan.json"),
    "previous/boundary-plan.json",
  );
  copy(
    path.join(
      previous,
      "run-a/U2-extended-window-boundary/subtitle-package.needs-review.json",
    ),
    "inputs/baseline.json",
  );
  copy(testReceipt, "neutral-tests.log");
  const baseline = read(path.join(output, "inputs/baseline.json"));
  const cue = baseline.cues.find((c) => c.id === target.cueId);
  if (!cue || objectHash(cue) !== target.cueHash) throw Error("STALE_TARGET");
  const requests = old.requests.map((r) => {
    const raw = read(
      path.join(previous, "boundary-evidence", r.requestId + ".json"),
    );
    if (raw.status !== "SUCCESS") throw Error("INPUT_EVIDENCE_INCOMPLETE");
    const wavFile = "inputs/" + r.requestId + ".wav",
      rawFile = "inputs/" + r.requestId + ".json",
      npzFile = "inputs/" + r.requestId + ".npz";
    if (
      hashFile(r.audioPath) !== r.audioHash ||
      hashFile(
        path.join(previous, "boundary-evidence", raw.frameEvidence.file),
      ) !== raw.frameEvidence.sha256
    )
      throw Error("FROZEN_AUDIO_FRAME_HASH_MISMATCH");
    copy(r.audioPath, wavFile);
    copy(
      path.join(previous, "boundary-evidence", r.requestId + ".json"),
      rawFile,
    );
    copy(
      path.join(previous, "boundary-evidence", raw.frameEvidence.file),
      npzFile,
    );
    return { ...r, wavFile, rawFile, npzFile };
  });
  // Read only tokenizer/configuration metadata, never weights or a model loader.
  const modelMetadata = {};
  for (const n of ["vocab.json", "tokenizer_config.json", "config.json"]) {
    const f = path.join(old.model.snapshotDirectory, n),
      m = old.model.modelFiles.find((f) => f.relativePath === n);
    if (!m || hashFile(f) !== m.sha256)
      throw Error("TOKENIZER_IDENTITY_MISMATCH");
    copy(f, "inputs/" + n);
    modelMetadata[n] = m.sha256;
  }
  const protocol = JSON.parse(
    execFileSync(
      python,
      [path.join(repo, "scripts/replay-c6011642.py"), "--policy"],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
      },
    ),
  );
  const tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repo, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const generated = walk(path.join(repo, "packages")).filter((f) =>
    f.includes("/dist/"),
  );
  const codeHashes = Object.fromEntries(
    [...tracked.map((f) => path.join(repo, f)), ...generated].map((f) => [
      path.relative(repo, f),
      hashFile(f),
    ]),
  );
  const inputs = Object.fromEntries(
    walk(output).map((f) => [path.relative(output, f), hashFile(f)]),
  );
  const next = baseline.cues
    .filter((c) => c.start > cue.start && c.id !== cue.id)
    .sort((a, b) => a.start - b.start)[0];
  write(output, "plan.json", {
    version: "c6011642-plan-v1",
    protocol,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim(),
    previous,
    target,
    requests,
    inputs,
    codeHashes,
    python,
    modelMetadata,
    modelSnapshotHash: old.model.modelSnapshotHash,
    runtimeIdentityHash: old.runtime.runtimeIdentityHash,
    source: old.source,
    sourceLineage: {
      group: old.appliedGroup.id,
      candidateRequestId: old.appliedGroup.candidateRequestId,
      candidateCharacterSpan: old.appliedGroup.candidateCharacterSpan,
    },
    protectedNextStart: next?.start ?? baseline.source.durationSeconds,
    evaluationPolicy:
      "unchanged formal evaluator; fixed I0 bindings; local adjacent reference spans of 1-3 cues with edit similarity >=0.25 or containment, intersecting fixed W+4; ordering relative to neighboring fixed matches; target excluded from confirmed gain without independent occurrence confirmation",
    dataset: "development-known",
    priorDeveloperExposure: true,
  });
  freeze(output, "protocol-freeze.json", walk(output));
  console.log("PROTOCOL_FROZEN", output);
} else if (phase === "solve") {
  const output = path.resolve(args[0]),
    p = verify(output);
  if (fs.existsSync(path.join(output, "solve-clock.json")))
    throw Error("EXISTING_ATTEMPT_INSPECT_ONLY");
  const started = new Date().toISOString();
  write(output, "solve-clock.json", { started });
  const quote = (s) => JSON.stringify(s);
  const policy = `(version 1)(allow default)(deny network*)(deny file-read* (subpath ${quote(path.join(process.env.HOME, "Documents"))}) (subpath ${quote(path.join(process.env.HOME, "Downloads"))}) (subpath ${quote(path.join(process.env.HOME, ".cache/huggingface"))})) (allow file-read* (subpath ${quote(repo)}) (subpath ${quote(output)}))`;
  const log = execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      policy,
      p.python,
      path.join(repo, "scripts/replay-c6011642.py"),
      output,
    ],
    {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        PYTHONDONTWRITEBYTECODE: "1",
        OPENBLAS_NUM_THREADS: "1",
      },
    },
  );
  write(output, "solve.log", log);
  freeze(output, "evidence-freeze.json", walk(output));
  console.log(log.trim());
} else if (phase === "generate") {
  const output = path.resolve(args[0]),
    p = verify(output);
  checkFiles(output, read(path.join(output, "evidence-freeze.json")).files);
  for (const run of ["run-a", "run-b"]) {
    const a = path.join(output, run + "-source-replay"),
      b = path.join(output, run + "-legacy-replay");
    isolated(
      "scripts/generate-c601164.mjs",
      oldInputs.map((f) => path.join(output, "previous", f)),
      a,
    );
    isolated(
      "scripts/generate-c6011641.mjs",
      [
        path.join(a, "T2-aligned-group/subtitle-package.needs-review.json"),
        path.join(output, "previous/boundary-plan.json"),
        ...p.requests.map((r) => path.join(output, r.rawFile)),
      ],
      b,
    );
    isolated(
      "scripts/generate-c6011642.mjs",
      [
        path.join(
          b,
          "U2-extended-window-boundary/subtitle-package.needs-review.json",
        ),
        path.join(output, "plan.json"),
        path.join(output, "tail-identifiability.json"),
      ],
      path.join(output, run),
    );
  }
  const payload = (r) =>
    walk(path.join(output, r)).map((f) => [
      path.relative(path.join(output, r), f),
      hashFile(f),
    ]);
  if (objectHash(payload("run-a")) !== objectHash(payload("run-b")))
    throw Error("AB_PARITY_FAILURE");
  write(
    output,
    "boundary-proposals.json",
    read(path.join(output, "run-a/boundary-proposals.json")),
  );
  freeze(output, "generation-freeze.json", walk(output));
  write(output, "experiment-manifest.json", {
    version: "c6011642-experiment-v1",
    abParity: true,
    ...read(path.join(output, "tail-identifiability.json")).counts,
    status: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    defaultPromotionAuthorized: false,
    machineOnlyReleaseAuthorized: false,
  });
  console.log("AB_FROZEN_ZERO_MODEL_REPLAY");
} else
  throw Error(
    "Expected prepare, solve or generate; no model execution option exists",
  );
