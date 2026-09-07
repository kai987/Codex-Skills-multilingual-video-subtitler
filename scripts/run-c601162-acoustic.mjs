import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { NodeProcessRunner } from "../packages/shared/dist/index.js";
import { WhisperCppTranscriptionAdapter } from "../packages/transcription-core/dist/index.js";
import {
  ReazonSpeechK2Provider,
  loadReazonK2ModelIdentity,
} from "../packages/video-subtitler/dist/machine-quality/reazonspeech-k2-provider.js";
import {
  matchedEvidenceSchema,
  replayPrimaryAssembly,
} from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import {
  ACOUSTIC_POLICY,
  deriveAcousticCases,
  caseWindows,
  acousticBundleSchema,
  accountAttempt,
} from "../packages/video-subtitler/dist/machine-quality/bounded-acoustic.js";
import {
  objectHash,
  sha256,
} from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
import { QUALITY_EVALUATION_POLICY } from "../packages/video-subtitler/dist/machine-quality/experimental-metrics.js";
const [phase, arg, dest] = process.argv.slice(2);
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const write = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2), { flag: "wx", flush: true });
};
async function hash(p) {
  const h = createHash("sha256");
  for await (const b of fs.createReadStream(p)) h.update(b);
  return h.digest("hex");
}
const repo = path.resolve(import.meta.dirname, "..");
const childEnv = {
  PATH: process.env.PATH,
  LANG: "en_US.UTF-8",
  TZ: "UTC",
  HF_HUB_OFFLINE: "1",
  TRANSFORMERS_OFFLINE: "1",
};
const wavInfo = (p) => {
  const b = fs.readFileSync(p);
  if (
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE"
  )
    throw Error("Not PCM WAV");
  let offset = 12,
    rate = 0,
    align = 0,
    size = 0;
  while (offset + 8 <= b.length) {
    let n = b.readUInt32LE(offset + 4),
      tag = b.toString("ascii", offset, offset + 4);
    if (tag === "fmt ") {
      if (
        b.readUInt16LE(offset + 8) !== 1 ||
        b.readUInt16LE(offset + 10) !== 1 ||
        b.readUInt16LE(offset + 22) !== 16
      )
        throw Error("Not mono s16");
      rate = b.readUInt32LE(offset + 12);
      align = b.readUInt16LE(offset + 20);
    }
    if (tag === "data") size = n;
    offset += 8 + n + (n % 2);
  }
  if (rate !== 16000 || !align || !size || size % align)
    throw Error("Invalid WAV frames");
  return {
    sampleRate: rate,
    sampleCount: size / align,
    seconds: size / align / rate,
  };
};
if (phase === "prepare") {
  const config = read(arg);
  const output = path.resolve(dest);
  fs.mkdirSync(output);
  const input = matchedEvidenceSchema.parse(read(config.primary));
  if ((await hash(config.media)) !== input.source.sha256)
    throw Error("Source media mismatch");
  const probe = JSON.parse(
    execFileSync(
      config.ffprobe,
      [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        config.media,
      ],
      { encoding: "utf8" },
    ),
  );
  const stream = probe.streams.find(
    (s) => s.index === input.source.audioStream,
  );
  if (
    !stream ||
    Number(stream.sample_rate) !== input.source.sourceSampleRate ||
    Number(stream.start_time ?? 0) !== input.source.mediaStart
  )
    throw Error("Unverified source sample mapping");
  const legacy = replayPrimaryAssembly(input, false),
    preserved = replayPrimaryAssembly(input, true);
  const cases = deriveAcousticCases(
    legacy.trace,
    preserved.trace,
    input.source.sourceSampleRate,
  );
  if (cases.length !== 3)
    throw Error("Unexpected case count; investigate, never truncate");
  write(path.join(output, "cases.machine.json"), cases);
  fs.copyFileSync(
    config.primary,
    path.join(output, "machine-evidence.json"),
    fs.constants.COPYFILE_EXCL,
  );
  const model = {};
  try {
    model.reazon = {
      status: "AVAILABLE",
      identity: await loadReazonK2ModelIdentity(config.reazonModel),
      runtime: execFileSync(
        config.reazonPython,
        [
          "-c",
          "import sys,importlib.metadata,json; print(json.dumps({'python':sys.version,'sherpa':importlib.metadata.version('sherpa-onnx'),'numpy':importlib.metadata.version('numpy')}))",
        ],
        { encoding: "utf8", env: childEnv },
      ).trim(),
      workerHash: await hash(
        path.join(repo, "scripts/runtime/reazonspeech_k2_worker.py"),
      ),
    };
  } catch (e) {
    model.reazon = { status: "MODEL_UNAVAILABLE", error: String(e) };
  }
  try {
    const help = execFileSync(config.whisper, ["--help"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const version = execFileSync(config.whisper, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    model.whisper = {
      status: "AVAILABLE",
      modelHash: await hash(config.whisperModel),
      binaryHash: await hash(config.whisper),
      version: version.trim(),
      helpHash: sha256(help),
      device: "Metal",
      coreML: false,
    };
  } catch (e) {
    model.whisper = { status: "MODEL_UNAVAILABLE", error: String(e) };
  }
  const requests = [];
  for (const c of cases)
    for (const w of caseWindows(c, input.source.durationSeconds)) {
      const rel = `audio-clips/${c.id}/${w.id}.wav`,
        audio = path.join(output, rel);
      if (w.status !== "PLANNED") continue;
      fs.mkdirSync(path.dirname(audio), { recursive: true });
      execFileSync(
        config.ffmpeg,
        [
          "-nostdin",
          "-v",
          "error",
          "-i",
          config.media,
          "-map",
          `0:${input.source.audioStream}`,
          "-af",
          `atrim=start_sample=${w.startSample}:end_sample=${w.endSample},asetpts=PTS-STARTPTS`,
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          audio,
        ],
        { env: childEnv },
      );
      const frames = wavInfo(audio);
      if (Math.abs(frames.seconds - w.seconds) > 1 / 16000)
        throw Error("Clip source mapping mismatch");
      const audioHash = await hash(audio);
      for (const family of ["whisper", "reazon"]) {
        const padded = frames.seconds + (family === "reazon" ? 1.8 : 0);
        requests.push({
          id: `${c.id}-${w.id}-${family}`,
          family,
          caseBindingHash: c.bindingHash,
          windowId: w.id,
          window: w,
          audio: rel,
          audioHash,
          ...frames,
          decodedSeconds: padded,
          status:
            padded > 30
              ? "WINDOW_BUDGET_UNSATISFIED"
              : model[family].status === "AVAILABLE"
                ? "PLANNED"
                : "MODEL_UNAVAILABLE",
        });
      }
    }
  const planned = requests.filter((r) => r.status === "PLANNED");
  if (
    planned.length > 12 ||
    planned.reduce((n, r) => n + r.decodedSeconds, 0) > 360
  )
    throw Error("Plan exceeds budget");
  write(path.join(output, "processing.local-only.json"), { config, probe });
  const plan = {
    version: "c601162-plan-v1",
    base: "98aea57f686d1dc2fb6be723daab66d931cf5420",
    primaryHash: await hash(config.primary),
    casesHash: objectHash(cases),
    source: input.source,
    models: model,
    requests,
    policy: ACOUSTIC_POLICY,
    policyHash: objectHash(ACOUSTIC_POLICY),
    evaluationPolicy: QUALITY_EVALUATION_POLICY,
    decode: {
      whisper: {
        language: "ja",
        prompt: null,
        hotwords: null,
        maxContext: 0,
        freshProcessPerRequest: true,
        vad: false,
        temperature: 0,
        noFallback: true,
        bestOf: 5,
        beamSize: 5,
        threads: 8,
        tokenTimestamps: true,
      },
      reazon: {
        language: "ja",
        prompt: null,
        hotwords: null,
        decoding: "greedy_search",
        freshStreamPerRequest: true,
        paddingSecondsEachSide: 0.9,
        threads: 1,
      },
    },
    createdAt: new Date().toISOString(),
    dataset: "KNOWN_DEVELOPMENT_SET",
    defaultPromotionAuthorized: false,
  };
  write(path.join(output, "experiment-plan.json"), plan);
  console.log(
    JSON.stringify({
      output,
      caseCount: cases.length,
      requests: requests.map((r) => ({
        id: r.id,
        seconds: r.seconds,
        status: r.status,
      })),
      totalDecodedSeconds: planned.reduce((n, r) => n + r.decodedSeconds, 0),
    }),
  );
} else if (phase === "execute") {
  const output = path.resolve(arg),
    planFile = path.join(output, "experiment-plan.json"),
    plan = read(planFile),
    planHash = await hash(planFile);
  const { config } = read(path.join(output, "processing.local-only.json")),
    cases = read(path.join(output, "cases.machine.json"));
  if (
    plan.policyHash !== objectHash(ACOUSTIC_POLICY) ||
    plan.casesHash !== objectHash(cases) ||
    (await hash(path.join(output, "machine-evidence.json"))) !==
      plan.primaryHash
  )
    throw Error("Freeze changed");
  if (fs.existsSync(path.join(output, "evidence/frozen.json")))
    throw Error(
      "Experiment already frozen; use generation replay, not new inference",
    );
  const lock = path.join(output, "execution.lock");
  const fd = fs.openSync(lock, "wx");
  fs.closeSync(fd);
  const journal = path.join(output, "requests/attempts.jsonl");
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  const ledger = fs.existsSync(journal)
    ? fs
        .readFileSync(journal, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
  const observations = [],
    replayed = [];
  let provider;
  if (ledger.some((e) => e.planHash !== planHash))
    throw Error("Foreign execution ledger");
  const snapshotPath = path.join(output, "pre-inference-freeze.json");
  const helpProbe = spawnSync(config.whisper, ["--help"], {
    encoding: "utf8",
    env: childEnv,
  });
  const helpText = (helpProbe.stdout ?? "") + (helpProbe.stderr ?? "");
  const requiredFlags = [
    "--max-context",
    "--temperature",
    "--no-fallback",
    "--beam-size",
    "--best-of",
    "--output-json-full",
  ];
  if (
    plan.models.whisper.status === "AVAILABLE" &&
    (helpProbe.status !== 0 || requiredFlags.some((f) => !helpText.includes(f)))
  )
    throw Error("Whisper isolation/decode flags unavailable");
  const sourceFiles = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repo },
  )
    .toString()
    .split("\0")
    .filter((p) => p && /^(packages\/|scripts\/|package.*json)/u.test(p));
  const codeSnapshot = [];
  for (const p of sourceFiles)
    codeSnapshot.push({ path: p, sha256: await hash(path.join(repo, p)) });
  if (fs.existsSync(snapshotPath)) {
    if (
      objectHash(read(snapshotPath).codeSnapshot) !== objectHash(codeSnapshot)
    )
      throw Error("Code changed since first inference");
  } else
    write(snapshotPath, {
      planHash,
      codeSnapshot,
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
      }).trim(),
      frozenAt: new Date().toISOString(),
      goldRead: false,
      helpProbe: {
        sha256: sha256(helpText),
        requiredFlags,
        verified: true,
        planHelpHashScope:
          "stdout-only; complete stdout/stderr help verified here",
      },
    });
  try {
    for (const req of plan.requests) {
      const target = path.join(output, `requests/${req.id}.json`);
      if (fs.existsSync(target)) {
        const old = read(target);
        if (
          old.planHash !== planHash ||
          old.requestHash !== objectHash(req) ||
          objectHash(old.observation) !== old.observationHash ||
          objectHash(old.raw) !== old.observation.resultHash
        )
          throw Error("Stale/incomplete replay");
        observations.push(old.observation);
        replayed.push(req.id);
        continue;
      }
      const base = {
        requestId: req.id,
        caseBindingHash: req.caseBindingHash,
        family: req.family,
        windowId: req.windowId,
        audioHash: req.audioHash,
        window: { start: req.window.start, end: req.window.end },
        text: "",
        segments: [],
        points: [],
        timebase: "source-global-once",
        timingKind: "WINDOW_LEVEL_ONLY",
      };
      if (req.status !== "PLANNED") {
        const raw = { unavailable: req.status };
        const o = {
          ...base,
          status: "MODEL_UNAVAILABLE",
          resultHash: objectHash(raw),
        };
        write(target, {
          planHash,
          requestHash: objectHash(req),
          observation: o,
          observationHash: objectHash(o),
          raw,
        });
        observations.push(o);
        continue;
      }
      if (ledger.some((x) => x.requestId === req.id))
        throw Error(
          "Unfinished attempt: do not silently rerun; reconcile retained raw response first",
        );
      if ((await hash(path.join(output, req.audio))) !== req.audioHash)
        throw Error("Audio changed");
      if (
        req.family === "whisper" &&
        ((await hash(config.whisperModel)) !== plan.models.whisper.modelHash ||
          (await hash(config.whisper)) !== plan.models.whisper.binaryHash)
      )
        throw Error("Whisper identity changed");
      if (req.family === "reazon" && !provider) {
        if (
          objectHash(await loadReazonK2ModelIdentity(config.reazonModel)) !==
            objectHash(plan.models.reazon.identity) ||
          (await hash(
            path.join(repo, "scripts/runtime/reazonspeech_k2_worker.py"),
          )) !== plan.models.reazon.workerHash
        )
          throw Error("Reazon identity changed");
        provider = new ReazonSpeechK2Provider({
          pythonExecutable: config.reazonPython,
          workerScriptPath: path.join(
            repo,
            "scripts/runtime/reazonspeech_k2_worker.py",
          ),
          modelDirectory: config.reazonModel,
        });
      }
      accountAttempt(ledger, {
        requestId: req.id,
        decodedSeconds: req.decodedSeconds,
      });
      const entry = {
        requestId: req.id,
        planHash,
        decodedSeconds: req.decodedSeconds,
        audioSeconds: req.seconds,
        startedAt: new Date().toISOString(),
      };
      fs.appendFileSync(journal, JSON.stringify(entry) + "\n", { flush: true });
      ledger.push(entry);
      let raw, observation;
      const started = Date.now();
      try {
        if (req.family === "whisper") {
          const runner = {
            run: async (exe, args, opts) => {
              if (
                args.includes("--prompt") ||
                args.includes("--vad") ||
                args.includes("--translate")
              )
                throw Error("Prompt/model policy violation");
              const actual = [
                ...args,
                "--max-context",
                "0",
                "--temperature",
                "0",
                "--no-fallback",
                "--beam-size",
                "5",
                "--best-of",
                "5",
              ];
              const result = await new NodeProcessRunner().run(exe, actual, {
                ...opts,
                allowNonZero: true,
                environment: childEnv,
              });
              write(path.join(output, `requests/${req.id}.process.json`), {
                args: actual,
                ...result,
              });
              const prefix = args[args.indexOf("--output-file") + 1];
              for (const ext of ["json", "srt"])
                if (fs.existsSync(prefix + "." + ext))
                  fs.copyFileSync(
                    prefix + "." + ext,
                    path.join(output, `requests/${req.id}.raw.${ext}`),
                    fs.constants.COPYFILE_EXCL,
                  );
              if (result.exitCode !== 0)
                throw Error(`Whisper exited ${result.exitCode}`);
              return result;
            },
          };
          const adapter = new WhisperCppTranscriptionAdapter({
            executablePath: config.whisper,
            modelPath: config.whisperModel,
            runner,
            threads: 8,
            useVad: false,
            coreML: false,
            fullJsonAvailable: true,
            tokenTimestampsAvailable: true,
          });
          raw = await adapter.transcribe({
            audioPath: path.join(output, req.audio),
            chunk: {
              id: req.id,
              start: 0,
              end: req.seconds,
              duration: req.seconds,
              path: req.audio,
            },
            language: "ja",
            timestampStrategy: "segment",
            tokenTimestamps: true,
          });
          observation = {
            ...base,
            status: raw.text ? "SUCCESS" : "EMPTY_OUTPUT",
            text: raw.text,
            segments: raw.segments.map((s) => ({
              text: s.text,
              start: s.start + req.window.start,
              end: s.end + req.window.start,
            })),
            timingKind: "SEGMENT_INTERVALS",
            resultHash: objectHash(raw),
          };
        } else {
          raw = await provider.transcribeBatch([
            {
              requestId: req.id,
              eventId: req.id,
              diagnosticRole: "TARGETED",
              windowType: "CORE_CONTEXT",
              sourceInterval: { start: req.window.start, end: req.window.end },
              sourceMediaSha256: plan.source.sha256,
              audioPath: path.join(output, req.audio),
              audioSha256: req.audioHash,
              sampleRate: 16000,
              sampleCount: req.sampleCount,
              extractionConfigHash: objectHash(req.window),
            },
          ]);
          const r = raw.results[0];
          observation = {
            ...base,
            status:
              r.status === "SUCCESS"
                ? "SUCCESS"
                : r.status === "EMPTY_OUTPUT"
                  ? "EMPTY_OUTPUT"
                  : "PROVIDER_ERROR",
            text: r.text,
            points: r.tokenPoints.map((p) => ({
              text: p.token,
              time: p.paddedAudioSeconds - 0.9 + req.window.start,
            })),
            timingKind: "TOKEN_POINTS",
            resultHash: objectHash(raw),
          };
        }
      } catch (e) {
        raw = { error: String(e) };
        observation = {
          ...base,
          status: "PROVIDER_ERROR",
          resultHash: objectHash(raw),
        };
      }
      write(target, {
        planHash,
        requestHash: objectHash(req),
        execution: "FRESH_EXECUTED",
        wallClockSeconds: (Date.now() - started) / 1000,
        completedAt: new Date().toISOString(),
        observation,
        observationHash: objectHash(observation),
        raw,
      });
      observations.push(observation);
      console.log(req.id, observation.status, `${ledger.length}/12`);
    }
    const bundle = acousticBundleSchema.parse({
      version: "c601162-evidence-v1",
      primaryHash: plan.primaryHash,
      planHash,
      policyHash: plan.policyHash,
      cases,
      observations,
      frozenAt: new Date().toISOString(),
    });
    write(path.join(output, "evidence/frozen.json"), bundle);
    write(path.join(output, "execution-summary.json"), {
      attempts: ledger.length,
      decodedSeconds: ledger.reduce((n, r) => n + r.decodedSeconds, 0),
      audioSeconds: ledger.reduce((n, r) => n + r.audioSeconds, 0),
      verifiedReplay: replayed,
      failures: observations.filter((o) => o.status === "PROVIDER_ERROR")
        .length,
      retries: 0,
      planHash,
      evidenceHash: await hash(path.join(output, "evidence/frozen.json")),
      noNewCTC_MFA_VAD_Speaker_Separation: true,
    });
  } finally {
    await provider?.close();
    fs.unlinkSync(lock);
  }
} else
  throw Error(
    "Usage: prepare config.local-only.json new-output | execute output",
  );
