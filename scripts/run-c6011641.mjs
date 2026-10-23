import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { BOUNDARY_POLICY } from "../packages/video-subtitler/dist/machine-quality/boundary-support.js";
import {
  read,
  write,
  hashFile,
  objectHash,
  walk,
  checkFiles,
  repo,
  wavInfo,
  oldInputs,
  freeze,
  verify,
  isolated,
  payload,
} from "./c6011641-common.mjs";
const [phase, ...args] = process.argv.slice(2);
if (phase === "prepare") {
  const [oldArg, mediaArg, outArg] = args;
  if (!outArg)
    throw Error("prepare <previous-run> <original-media> <new-output>");
  const old = path.resolve(oldArg),
    output = path.resolve(outArg),
    media = path.resolve(mediaArg);
  if (fs.existsSync(output)) throw Error("Output collision");
  const plan = read(path.join(old, "alignment-plan.json"));
  checkFiles(old, read(path.join(old, "prealignment-freeze.json")).files);
  checkFiles(old, read(path.join(old, "alignment-freeze.json")).files);
  checkFiles(repo, plan.codeHashes);
  const frozen = read(path.join(old, "generation-freeze.json"));
  checkFiles(old, frozen.metadata);
  for (const [run, files] of Object.entries(frozen.runs))
    for (const f of files)
      if (hashFile(path.join(old, run, f.path)) !== f.sha256)
        throw Error("Historical output changed");
  const primary = read(path.join(old, "inputs/primary.json"));
  const mediaAvailable = fs.existsSync(media);
  if (mediaAvailable && hashFile(media) !== primary.source.sha256)
    throw Error("SOURCE_MEDIA_IDENTITY_MISMATCH");
  const patches = read(path.join(old, "patches/aligned.json"));
  const journal = read(
    path.join(old, "run-a/T2-aligned-group/mutation-journal.json"),
  );
  const events = fs
    .readFileSync(path.join(old, "alignment-evidence/events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  const eligible = patches
    .filter((p) => journal.appliedPatchIds.includes(p.id))
    .map((p) => ({
      patch: p,
      diagnostic: events.find(
        (e) =>
          e.type === "alignment-diagnostic" &&
          e.requestId === p.candidateRequestId,
      ),
    }))
    .filter(
      ({ diagnostic: d, patch: p }) =>
        (d &&
          d.tokenSpans.some(
            (s) =>
              s.endFrameExclusive - s.startFrame === 1 ||
              s.meanPosterior < BOUNDARY_POLICY.minimumTailPosterior,
          )) ||
        p.newCues.some(
          (c) =>
            p.group.readEnvelope.end - c.end <= BOUNDARY_POLICY.edgeBandSeconds,
        ),
    )
    .sort(
      (a, b) =>
        a.patch.group.readEnvelope.start - b.patch.group.readEnvelope.start,
    );
  if (!eligible.length)
    throw Error("NO_APPLIED_GROUP_WITH_MACHINE_BOUNDARY_RISK");
  const { patch, diagnostic } = eligible[0];
  const original = plan.requests.find(
    (r) => r.requestId === patch.candidateRequestId,
  );
  const alignment = read(path.join(old, "alignments.json")).find(
    (a) => a.requestId === patch.candidateRequestId,
  );
  const previousPkg = read(
    path.join(old, "run-a/T2-aligned-group/subtitle-package.needs-review.json"),
  );
  const targets = patch.newCues.map((c) => {
    const cue = previousPkg.cues.find((n) => n.id === c.id);
    const first = alignment.symbols.findIndex(
        (s) => Math.abs(s.start - c.start) < 1e-7,
      ),
      last = alignment.symbols.findIndex((s) => Math.abs(s.end - c.end) < 1e-7);
    if (!cue || first < 0 || last < first)
      throw Error("TARGET_SYMBOL_BINDING_MISSING");
    return {
      cueId: cue.id,
      cueHash: objectHash(cue),
      firstTokenIndex: first,
      lastTokenIndex: last,
      oldFirstTokenStart: alignment.symbols[first].start,
      oldTail: diagnostic.tokenSpans.slice(Math.max(first, last - 2), last + 1),
      oldNormalizedPathLogScore: diagnostic.normalizedPathLogScore,
    };
  });
  fs.mkdirSync(output);
  for (const f of oldInputs)
    write(output, "previous/" + f, fs.readFileSync(path.join(old, f), "utf8"));
  write(output, "previous/diagnostic.json", diagnostic);
  // Execute the real historical generator, not a copied subtitle snapshot.
  isolated(
    "scripts/generate-c601164.mjs",
    oldInputs.map((f) => path.join(output, "previous", f)),
    path.join(output, "baseline-verification"),
  );
  for (const ext of ["ass", "srt", "vtt"])
    if (
      hashFile(
        path.join(
          output,
          "baseline-verification/T2-aligned-group/machine-candidate." + ext,
        ),
      ) !==
      hashFile(
        path.join(old, "run-a/T2-aligned-group/machine-candidate." + ext),
      )
    )
      throw Error("U0_HISTORICAL_T2_REPLAY_MISMATCH");
  const requests = [];
  fs.mkdirSync(path.join(output, "audio"));
  for (const extension of BOUNDARY_POLICY.windowExtensions) {
    const id = extension === 0 ? "W0" : "W+" + extension;
    if (extension && !mediaAvailable) continue;
    const end = Math.min(
        original.window.end + extension,
        primary.source.durationSeconds,
      ),
      start = original.window.start;
    if (end - start > 30) throw Error("WINDOW_BUDGET_EXCEEDED_NO_CORE_CUT");
    if (requests.some((r) => r.window.end === end)) continue;
    const audio = path.join(output, "audio", id + ".wav");
    if (mediaAvailable)
      execFileSync("/opt/homebrew/bin/ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-i",
        media,
        "-map",
        `0:${primary.source.audioStream}`,
        "-af",
        `atrim=start_sample=${Math.round(start * primary.source.sourceSampleRate)}:end_sample=${Math.round(end * primary.source.sourceSampleRate)},asetpts=PTS-STARTPTS`,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        audio,
      ]);
    else fs.copyFileSync(original.audioPath, audio, fs.constants.COPYFILE_EXCL);
    const info = wavInfo(audio);
    if (Math.abs(info.durationSeconds - (end - start)) > 1 / 16000)
      throw Error("AUDIO_RANGE_MISMATCH");
    if (!extension && info.audioHash !== original.audioHash)
      throw Error("W0_PHYSICAL_REPRODUCTION_MISMATCH");
    requests.push({
      ...original,
      ...info,
      requestId: id,
      windowId: id,
      audioPath: audio,
      window: { start, end },
      mediaGlobalStart: start,
      transcriptStatus: "PARTIAL_WINDOW_TRANSCRIPT_WITH_UNASSIGNED_SUFFIX",
      mediaEndLimited: end < original.window.end + extension,
      anchors: diagnostic.tokenSpans,
      prefixTokenCount: targets.at(-1).firstTokenIndex,
      targets,
      modelSnapshotHash: plan.model.modelSnapshotHash,
    });
  }
  if (
    requests.length > 3 ||
    requests.reduce((s, r) => s + r.durationSeconds, 0) > 90
  )
    throw Error("PLAN_BUDGET_EXCEEDED");
  const sources = [
    ...walk(path.join(repo, "packages/video-subtitler/dist/machine-quality")),
    ...walk(path.join(repo, "packages/subtitle-core/dist")),
    ...walk(path.join(repo, "packages/shared/dist")),
    ...walk(path.join(repo, "scripts")).filter((p) =>
      /c601164|boundary_(support|ctc_worker)|source_group_ctc_worker|\/ctc_worker.py/.test(
        p,
      ),
    ),
    path.join(repo, "package-lock.json"),
  ].filter((p) => !p.includes("__pycache__"));
  write(output, "boundary-plan.json", {
    version: "c6011641-plan-v1",
    policy: BOUNDARY_POLICY,
    oldPlanHash: hashFile(path.join(old, "alignment-plan.json")),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim(),
    source: primary.source,
    sourceMediaAvailable: mediaAvailable,
    mediaPath: media,
    appliedGroup: patch,
    targets,
    requests,
    runtime: plan.runtime,
    model: plan.model,
    baselineHashes: Object.fromEntries(
      ["ass", "srt", "vtt"].map((e) => [
        e,
        hashFile(
          path.join(old, "run-a/T2-aligned-group/machine-candidate." + e),
        ),
      ]),
    ),
    selection:
      "APPLIED_THEN_SINGLE_FRAME_OR_WEAK_OR_EDGE_RISK_SOURCE_ORDER_MAX_ONE",
    dataset: "development-known",
    newASR: 0,
    mainWindow: "W+4",
    fallback: mediaAvailable ? null : "EXTENSION_UNAVAILABLE_KEEP_U0",
    codeHashes: Object.fromEntries(
      sources.map((p) => [path.relative(repo, p), hashFile(p)]),
    ),
  });
  freeze(output, "prealignment-freeze.json", walk(output));
  console.log(
    "PREALIGNMENT_FROZEN",
    requests.map((r) => [r.windowId, r.durationSeconds]),
  );
} else if (phase === "execute") {
  const output = path.resolve(args[0]),
    p = verify(output),
    dest = path.join(output, "boundary-evidence");
  for (const f of p.model.modelFiles)
    if (
      hashFile(path.join(p.model.snapshotDirectory, f.relativePath)) !==
      f.sha256
    )
      throw Error("MODEL_HASH_MISMATCH");
  if (fs.existsSync(dest))
    throw Error("EXECUTION_EXISTS_INSPECT_LEDGER_NO_AUTOMATIC_RETRY");
  fs.mkdirSync(dest);
  const events = [];
  const event = (v) => {
    events.push(v);
    fs.appendFileSync(
      path.join(dest, "events.jsonl"),
      JSON.stringify({ ...v, at: new Date().toISOString() }) + "\n",
      { flush: true },
    );
  };
  const sb = `(version 1)(allow default)(deny network*)(deny file-read* (subpath ${JSON.stringify(path.join(os.homedir(), "Documents"))}) (subpath ${JSON.stringify(path.join(os.homedir(), "Downloads"))}))(allow file-read* (subpath ${JSON.stringify(repo)}) ${p.requests.map((r) => `(literal ${JSON.stringify(r.audioPath)})`).join(" ")})(allow file-read* file-write* (subpath ${JSON.stringify(dest)}))`;
  event({ type: "provider-process-start" });
  const child = spawn(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      sb,
      p.runtime.pythonExecutable,
      "-u",
      path.join(repo, "scripts/runtime/boundary_ctc_worker.py"),
      p.model.snapshotDirectory,
      dest,
    ],
    {
      cwd: repo,
      env: {
        PATH: process.env.PATH,
        LANG: "en_US.UTF-8",
        PYTHONDONTWRITEBYTECODE: "1",
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
        OMP_NUM_THREADS: "8",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stderr.on("data", (b) =>
    fs.appendFileSync(path.join(dest, "stderr.log"), b),
  );
  const queue = [],
    waiting = [];
  let ended = false;
  const deliver = (v) => (waiting.length ? waiting.shift()(v) : queue.push(v));
  createInterface({ input: child.stdout }).on("line", (l) => {
    const v = JSON.parse(l);
    event(v);
    deliver(v);
  });
  child.on("close", (code) => {
    ended = true;
    event({ type: "closed", code });
    deliver({ type: "closed", code });
  });
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : ended
        ? Promise.reject(Error("Worker closed"))
        : new Promise((resolve) => waiting.push(resolve));
  let seconds = 0,
    attempts = 0;
  const results = [];
  try {
    let ready;
    while (!ready) {
      const v = await next();
      if (v.type === "closed") throw Error("MODEL_START_FAILED");
      if (v.type === "ready") ready = v;
    }
    for (const pkg of p.runtime.packages)
      if (
        ready.versions[pkg.name] !== undefined &&
        ready.versions[pkg.name] !== pkg.version
      )
        throw Error("RUNTIME_VERSION_MISMATCH");
    for (const r of p.requests) {
      attempts++;
      seconds += r.durationSeconds;
      if (attempts > 4 || seconds > 90) throw Error("BUDGET_EXCEEDED");
      write(dest, r.requestId + ".attempt.json", {
        attempts,
        seconds,
        request: r,
        status: "STARTED",
        requestHash: objectHash(r),
      });
      event({
        type: "logical-task-start",
        requestId: r.requestId,
        seconds: r.durationSeconds,
      });
      child.stdin.write(JSON.stringify(r) + "\n");
      while (true) {
        const v = await next();
        if (v.type === "closed") throw Error("INTERRUPTED_ATTEMPT_CONSUMED");
        if (v.type === "result") {
          if (v.result.requestId !== r.requestId)
            throw Error("CROSS_REQUEST_RESULT");
          write(dest, r.requestId + ".json", v.result);
          results.push(v.result);
          break;
        }
      }
    }
    child.stdin.end(JSON.stringify({ type: "shutdown" }) + "\n");
    while (!ended) {
      await next();
    }
  } finally {
    if (!ended) child.kill("SIGTERM");
    write(output, "boundary-execution.json", {
      logicalTasks: attempts,
      attempts,
      acousticForwards: events.filter(
        (e) => e.type === "acoustic-forward-start",
      ).length,
      modelLoadAttempts: events.filter((e) => e.type === "model-load-start")
        .length,
      modelLoads: events.filter((e) => e.type === "ready").length,
      providerStarts: 1,
      seconds,
      failures: results.filter((r) => r.status !== "SUCCESS").length,
      unfinishedAttempts: attempts - results.length,
      retries: 0,
      paddingSeconds: 0,
      newASRRequests: 0,
      newASRInference: 0,
      newASRModelLoads: 0,
      newASRProviderStarts: 0,
    });
  }
  freeze(output, "boundary-evidence-freeze.json", [
    ...walk(dest),
    path.join(output, "boundary-execution.json"),
  ]);
  console.log("BOUNDED_ALIGNMENT_COMPLETE", attempts, seconds);
} else if (phase === "generate") {
  const output = path.resolve(args[0]);
  verify(output);
  checkFiles(
    output,
    read(path.join(output, "boundary-evidence-freeze.json")).files,
  );
  const p = read(path.join(output, "boundary-plan.json"));
  for (const run of ["run-a", "run-b"]) {
    const prev = path.join(output, run + "-previous-replay");
    isolated(
      "scripts/generate-c601164.mjs",
      oldInputs.map((f) => path.join(output, "previous", f)),
      prev,
    );
    isolated(
      "scripts/generate-c6011641.mjs",
      [
        path.join(prev, "T2-aligned-group/subtitle-package.needs-review.json"),
        path.join(output, "boundary-plan.json"),
        ...p.requests.map((r) =>
          path.join(output, "boundary-evidence", r.requestId + ".json"),
        ),
      ],
      path.join(output, run),
    );
  }
  const a = payload(path.join(output, "run-a")).map((f) => [
      path.relative(path.join(output, "run-a"), f),
      hashFile(f),
    ]),
    b = payload(path.join(output, "run-b")).map((f) => [
      path.relative(path.join(output, "run-b"), f),
      hashFile(f),
    ]);
  if (objectHash(a) !== objectHash(b)) throw Error("AB_PARITY_FAILED");
  write(
    output,
    "boundary-proposals.json",
    read(path.join(output, "run-a/boundary-proposals.json")),
  );
  freeze(output, "generation-freeze.json", walk(output));
  write(output, "experiment-manifest.json", {
    version: "c6011641-experiment-v1",
    generationFreezeHash: hashFile(path.join(output, "generation-freeze.json")),
    status: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    defaultPromotionAuthorized: false,
    machineOnlyReleaseAuthorized: false,
    abParity: true,
    newInferenceDuringReplay: 0,
  });
  write(
    output,
    "OUTPUT_INDEX.md",
    "# Boundary support experiment\n\nMain research ASS: `run-a/U2-extended-window-boundary/machine-candidate.ass`.\nAll T2 text, starts, styles and cue identities preserved. See boundary-proposals.json and per-variant mutation-journal.json for actual end changes and unresolved risks.\nLocal research only; contains private paths and raw conditional evidence; not public-shareable.\n",
  );
  console.log("GENERATION_FROZEN_AB_PARITY");
} else throw Error("Expected prepare, execute or generate");
