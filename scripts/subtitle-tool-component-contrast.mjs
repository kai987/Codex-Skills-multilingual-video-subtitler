import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  EvidenceRunner,
  readPcm,
  slicePcm,
  durable,
} from "./lib/bounded-asr-ab.mjs";
import { verifyRecovery } from "./subtitle-tool-vad-local-recovery.mjs";
import {
  planComponentCrops,
  compareComponentCrops,
} from "./lib/component-crop-contrast.mjs";

const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) => durable(p, v, true);
const bind = async (file) => ({
  file: await fs.realpath(file),
  sha256: await fileHash(file),
});
const worker = path.join(
  import.meta.dirname,
  "runtime/speech_support_kotoba.py",
);
async function inventory(root) {
  const out = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    assert(!e.isSymbolicLink(), "SYMLINK_OUTPUT");
    if (e.isDirectory())
      for (const [n, h] of Object.entries(
        await inventory(path.join(root, e.name)),
      ))
        out[`${e.name}/${n}`] = h;
    else out[e.name] = await fileHash(path.join(root, e.name));
  }
  return out;
}
export async function prepareComponentContrast(source, output, targetIds) {
  await safePath(source);
  await safePath(path.resolve(output), true);
  source = await fs.realpath(source);
  output = path.resolve(output);
  assert(
    output !== source && !output.startsWith(source + path.sep),
    "OUTPUT_INSIDE_SOURCE",
  );
  await verifyRecovery(source);
  const parent = await json(path.join(source, "plan.json")),
    oldViews = await json(path.join(source, "views.json"));
  const contrast = planComponentCrops(parent, oldViews, targetIds);
  const audio = path.join(parent.spec.task, "audio.wav"),
    pcm = readPcm(await fs.readFile(audio));
  assert.equal(pcm.sampleRate, 16000);
  const bindings = await Promise.all(
    [
      audio,
      path.join(source, "plan.json"),
      path.join(source, "views.json"),
      path.join(source, "machine-freeze.json"),
      parent.spec.subtitle,
      import.meta.filename,
      worker,
      path.join(import.meta.dirname, "lib/component-crop-contrast.mjs"),
      path.join(import.meta.dirname, "lib/source-occurrence-routing.mjs"),
      path.join(import.meta.dirname, "lib/speech-support-policy.mjs"),
      path.join(import.meta.dirname, "lib/bounded-asr-ab.mjs"),
    ].map(bind),
  );
  bindings.push(...parent.identities);
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "contrast-"));
  const crops = [];
  for (const c of contrast.crops) {
    assert(/^[a-zA-Z0-9._-]+$/u.test(c.id));
    const dir = path.join(root, c.id);
    await fs.mkdir(dir);
    const wav = path.join(dir, "input.wav");
    await fs.writeFile(
      wav,
      slicePcm(
        pcm,
        Math.round(c.start * 16000),
        Math.round(c.start * 16000) + c.frames,
      ),
      { flag: "wx" },
    );
    crops.push({ ...c, wavHash: await fileHash(wav) });
  }
  await put(path.join(root, "plan.json"), {
    source,
    contrast: { ...contrast, crops },
    bindings,
    parent,
    oldViews,
    decode: {
      prompt: null,
      vad: false,
      whisperFullJson: true,
      kotobaWordTimestamps: false,
      requestRetries: 0,
      engineOptions: "same-as-parent-plus-full-json-output",
      pairedModelFamilies: "both-whisper-family",
    },
  });
  await put(path.join(root, "asr-plan.json"), {
    probes: crops,
    model: parent.spec.kotobaModel,
    referenceUsed: false,
  });
  await put(path.join(root, "asr-plan-freeze.json"), {
    sha256: await fileHash(path.join(root, "asr-plan.json")),
  });
  await put(path.join(root, "plan-freeze.json"), {
    files: await inventory(root),
  });
  return {
    root,
    requests: contrast.requests,
    seconds: contrast.seconds,
    crops,
  };
}
async function load(root) {
  await safePath(root);
  for (const [n, h] of Object.entries(
    (await json(path.join(root, "plan-freeze.json"))).files,
  )) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
  const p = await json(path.join(root, "plan.json"));
  for (const b of p.bindings)
    assert.equal(await fileHash(b.file), b.sha256, `INPUT_CHANGED:${b.file}`);
  assert.deepEqual(
    p.contrast.crops.map(({ wavHash, ...r }) => {
      assert(/^[a-f0-9]{64}$/u.test(wavHash));
      return r;
    }),
    planComponentCrops(p.parent, p.oldViews, p.contrast.targetIds).crops,
  );
  for (const c of p.contrast.crops)
    assert.equal(await fileHash(path.join(root, c.id, "input.wav")), c.wavHash);
  return p;
}
export async function reserveComponentContrast(root, plan, authorize) {
  assert.equal(authorize, true, "AUTHORIZE_LOCAL_REQUIRED");
  assert(
    plan.crops.length > 0 &&
      plan.crops.length <= 4 &&
      plan.requests === plan.crops.length * 2 &&
      plan.requests <= 8 &&
      plan.seconds <= 64 &&
      plan.crops.every((c) => c.frames > 0 && c.frames <= 128000),
    "BUDGET",
  );
  assert.equal(
    plan.seconds,
    plan.crops.reduce((s, c) => s + (c.frames * 2) / 16000, 0),
  );
  await put(path.join(root, "execution-reservation.json"), {
    requests: plan.requests,
    seconds: plan.seconds,
    retries: 0,
    planHash: await fileHash(path.join(root, "plan.json")),
  });
}
async function dispatch(runner, exe, args, dir, name) {
  await put(path.join(dir, `${name}-dispatch.json`), { exe, args });
  const r = await runner.run(exe, args, { cwd: dir, timeoutMs: 300000 });
  await fs.writeFile(path.join(dir, `${name}.stdout.log`), r.stdout ?? "", {
    flag: "wx",
  });
  await fs.writeFile(path.join(dir, `${name}.stderr.log`), r.stderr ?? "", {
    flag: "wx",
  });
  await put(path.join(dir, `${name}-exit.json`), {
    code: r.exitCode,
    signal: r.signal ?? null,
  });
  assert.equal(r.exitCode, 0, `${name}_FAILED_NO_RETRY`);
}
export async function runComponentContrast(
  root,
  authorize,
  runner = new EvidenceRunner(),
) {
  assert.equal(authorize, true, "AUTHORIZE_LOCAL_REQUIRED");
  const p = await load(root);
  await reserveComponentContrast(root, p.contrast, authorize);
  try {
    for (const c of p.contrast.crops) {
      const dir = path.join(root, c.id);
      console.log(`Whisper ${c.id} ${c.start}-${c.end}`);
      await dispatch(
        runner,
        p.parent.config.runtime,
        [
          "--model",
          p.parent.config.model,
          "--file",
          path.join(dir, "input.wav"),
          "--language",
          "ja",
          "--threads",
          String(p.parent.config.threads),
          "--output-srt",
          "--output-json-full",
          "--output-file",
          path.join(dir, "whisper"),
          "--suppress-nst",
          "--no-prints",
        ],
        dir,
        "whisper",
      );
    }
    console.log(`Kotoba ${p.contrast.crops.length} requests`);
    await dispatch(
      runner,
      p.parent.spec.python,
      [worker, root],
      root,
      "kotoba",
    );
  } catch (e) {
    await put(path.join(root, "failure.json"), {
      error: e.message,
      noAutomaticRetry: true,
    });
    throw e;
  }
  return finishComponentContrast(root);
}
export async function finishComponentContrast(root) {
  const p = await load(root),
    views = [];
  const reservation = await json(path.join(root, "execution-reservation.json"));
  assert.equal(
    reservation.planHash,
    await fileHash(path.join(root, "plan.json")),
  );
  assert.equal((await json(path.join(root, "kotoba-exit.json"))).code, 0);
  for (const c of p.contrast.crops) {
    const dir = path.join(root, c.id);
    assert.equal((await json(path.join(dir, "whisper-exit.json"))).code, 0);
    assert.equal(
      (await json(path.join(dir, "kotoba-reserved.json"))).wavHash,
      c.wavHash,
    );
    const raw = await json(path.join(dir, "whisper.json"));
    assert(Array.isArray(raw.transcription), "WHISPER_JSON_CONTRACT");
    const paired = [
      {
        backend: "whisper",
        records: raw.transcription.map((r) => ({
          start: r.offsets.from / 1000,
          end: r.offsets.to / 1000,
          text: r.text,
        })),
      },
      {
        backend: "kotoba",
        records: (await json(path.join(dir, "kotoba-raw.json"))).segments,
      },
    ];
    for (const v of paired)
      views.push({
        targetId: c.id,
        backend: v.backend,
        records: v.records.map((r) => ({
          start: c.start + r.start,
          end: c.start + r.end,
          text: r.text.trim(),
        })),
      });
  }
  const result = compareComponentCrops(p.contrast, p.parent, p.oldViews, views);
  const same = async (n, v) => {
    const s = JSON.stringify(v) + "\n",
      file = path.join(root, n);
    try {
      assert.equal(
        await fs.readFile(file, "utf8"),
        s,
        "PARTIAL_OUTPUT_CHANGED",
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      await put(file, v);
    }
  };
  await same("views.json", views);
  await same("comparison.json", result);
  const runtime = await json(path.join(root, "kotoba-runtime.json"));
  assert.equal(runtime.modelLoadCount, 1);
  await same("execution-summary.json", {
    requests: p.contrast.requests,
    requestAudioSeconds: p.contrast.seconds,
    retries: 0,
    whisperProcesses: p.contrast.crops.length,
    kotobaModelLoads: 1,
    baselineChanged: false,
    defaultGenerationChanged: false,
  });
  const files = await inventory(root);
  delete files["machine-freeze.json"];
  await same("machine-freeze.json", {
    files,
    referenceUsed: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  });
  return { root, summary: result.summary, requests: p.contrast.requests };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, a, b, ...ids] = process.argv.slice(2);
  const result =
    cmd === "prepare"
      ? await prepareComponentContrast(a, b, ids)
      : cmd === "run"
        ? await runComponentContrast(a, b === "--authorize-local")
        : cmd === "finish"
          ? await finishComponentContrast(a)
          : null;
  assert(
    result,
    "prepare SOURCE OUTPUT ID... | run ROOT --authorize-local | finish ROOT",
  );
  console.log(JSON.stringify(result, null, 2));
}
