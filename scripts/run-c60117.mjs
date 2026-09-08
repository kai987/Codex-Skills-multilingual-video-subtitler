import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { NodeProcessRunner } from "../packages/shared/dist/index.js";
import { WhisperCppTranscriptionAdapter } from "../packages/transcription-core/dist/index.js";
import { primaryMinimal } from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
import { freshMatchedEvidenceSchema } from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import {
  selectRepresentativeClips,
  singlePhysicalClip,
  reserveAttempt,
  REPRESENTATIVE_POLICY,
} from "../packages/video-subtitler/dist/machine-quality/representative-clips.js";
import {
  ReazonSpeechK2Provider,
  loadReazonK2ModelIdentity,
} from "../packages/video-subtitler/dist/machine-quality/reazonspeech-k2-provider.js";
import {
  read,
  write,
  hash,
  digest,
  oh,
  repo,
  freeze,
  verify,
  walk,
  wavInfo,
  childEnv,
  isolated,
} from "./c60117-common.mjs";
const [phase, arg, dest] = process.argv.slice(2);
const DECODE = {
  language: "ja",
  prompt: "",
  vad: false,
  previousContext: false,
  temperature: 0,
  noFallback: true,
  beamSize: 5,
  bestOf: 5,
  threads: 8,
  coreML: false,
  tokenTimestamps: true,
};
if (phase === "prepare-dataset" || phase === "prepare-clip") {
  const config = read(arg),
    root = path.resolve(dest);
  fs.mkdirSync(root);
  const mediaHash = await hash(config.media);
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
      { encoding: "utf8", env: childEnv },
    ),
  );
  const suppliedAudio = probe.streams.find(
    (s) => s.index === config.audioStream && s.codec_type === "audio",
  );
  if (
    phase === "prepare-clip" &&
    (!suppliedAudio || Number(suppliedAudio.start_time ?? 0) !== 0)
  )
    throw Error(
      "Explicit zero-origin audio stream required for standalone clip",
    );
  const old =
      phase === "prepare-dataset"
        ? read(config.primary)
        : {
            source: {
              sha256: mediaHash,
              durationSeconds: Number(probe.format.duration),
              audioStream: config.audioStream,
              sourceSampleRate: Number(suppliedAudio.sample_rate),
              mediaStart: 0,
              fileName: "source-media",
            },
          },
    exclusion =
      phase === "prepare-dataset"
        ? read(config.exclusionPlan)
        : { requests: [] };
  if (mediaHash !== old.source.sha256) throw Error("Media identity mismatch");
  const audio = probe.streams.find((s) => s.index === old.source.audioStream);
  if (
    !audio ||
    Number(audio.sample_rate) !== old.source.sourceSampleRate ||
    Number(audio.start_time ?? 0) !== old.source.mediaStart
  )
    throw Error("Source timebase mismatch");
  const standalone =
    phase === "prepare-clip"
      ? singlePhysicalClip(mediaHash, config.clip.start, config.clip.end)
      : null;
  if (standalone && standalone.end > old.source.durationSeconds)
    throw Error("Clip exceeds media");
  const selection = standalone
    ? {
        clips: [standalone],
        candidates: [standalone],
        replacementOrder: [standalone.id],
        exclusions: [],
        policy: REPRESENTATIVE_POLICY,
      }
    : selectRepresentativeClips(
        primaryMinimal(old),
        old.source.durationSeconds,
        exclusion.requests.map((r) => r.window),
      );
  write(path.join(root, "dataset-selection.json"), {
    ...selection,
    source: { ...old.source, fileName: "source-media" },
    selectionEvidenceHash: standalone
      ? oh(config.clip)
      : await hash(config.primary),
    exclusionEvidenceHash: standalone ? null : await hash(config.exclusionPlan),
    heldout: "HELDOUT_VALIDATION_NOT_RUN",
    heldoutReason:
      "No separate eligible media/reference pair placed in scope; no broad personal-file search",
    confirmationClaim: "IN_EPISODE_FROZEN_CONFIRMATION",
  });
  freeze(root, "dataset-freeze.json", [
    path.join(root, "dataset-selection.json"),
  ]);
  if (!standalone && selection.clips.length !== 12)
    throw Error(
      "Insufficient independent clips; frozen reduced selection retained, investigate without Gold",
    );
  console.log(
    JSON.stringify({
      stage: "dataset-frozen",
      clips: selection.clips.map((c) => ({
        id: c.id,
        stratum: c.stratum,
        partition: c.partition,
        start: c.start,
        end: c.end,
        risk: c.machineRisk,
      })),
    }),
  );
  const models = {
    whisper: {
      modelHash: await hash(config.whisperModel),
      binaryHash: await hash(config.whisper),
      helpHash: digest(
        execFileSync(config.whisper, ["--help"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ),
      model: "large-v3",
      device: "Metal GPU",
      decode: DECODE,
      tokenizer: "embedded-in-model",
    },
    reazon: {
      identity: await loadReazonK2ModelIdentity(config.reazonModel),
      workerHash: await hash(
        path.join(repo, "scripts/runtime/reazonspeech_k2_worker.py"),
      ),
      runtime: execFileSync(
        config.reazonPython,
        [
          "-c",
          "import sys,importlib.metadata,json; print(json.dumps({'python':sys.version,'sherpa':importlib.metadata.version('sherpa-onnx'),'numpy':importlib.metadata.version('numpy')}))",
        ],
        { encoding: "utf8", env: childEnv },
      ).trim(),
      decode: {
        language: "ja",
        prompt: "",
        method: "greedy_search",
        threads: 1,
        padSecondsPerSide: 0.9,
        state: "new stream per request",
      },
    },
  };
  const requests = [];
  for (const c of selection.clips) {
    const file = path.join(root, "audio", c.id + ".wav");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Decode from the original origin; crop on the resampled integer grid.
    // Input seeking plus output -t can otherwise truncate resampler flush samples.
    const args = [
      "-v",
      "error",
      "-n",
      "-i",
      config.media,
      "-map",
      "0:" + audio.index,
      "-vn",
      "-ac",
      "1",
      "-af",
      "aresample=16000,atrim=start_sample=" +
        Math.round(c.start * 16000) +
        ":end_sample=" +
        Math.round(c.end * 16000) +
        ",asetpts=PTS-STARTPTS",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      file,
    ];
    execFileSync(config.ffmpeg, args, { env: childEnv });
    const wav = wavInfo(file),
      audioHash = await hash(file);
    if (Math.abs(wav.seconds - (c.end - c.start)) > 1 / 16000)
      throw Error("Extracted duration mismatch");
    for (const provider of ["whisper", "reazon"]) {
      const key = {
        sourceHash: old.source.sha256,
        interval: { start: c.start, end: c.end },
        audioHash,
        sampleRate: wav.sampleRate,
        sampleCount: wav.sampleCount,
        provider,
        modelIdentity: models[provider],
        timebase: "original-audio-local",
        prompt: "",
        decoder: models[provider].decode,
        adapterHash: await hash(
          path.join(
            repo,
            provider === "whisper"
              ? "packages/transcription-core/dist/local.js"
              : "scripts/runtime/reazonspeech_k2_worker.py",
          ),
        ),
      };
      requests.push({
        id: c.id + "-" + provider,
        clipId: c.id,
        partition: c.partition,
        provider,
        audio: "audio/" + c.id + ".wav",
        ...wav,
        audioHash,
        interval: key.interval,
        key,
        cacheKey: oh(key),
        inputSeconds: provider === "whisper" ? 30 : wav.seconds + 1.8,
      });
    }
  }
  write(path.join(root, "runtime.local-only.json"), config);
  write(path.join(root, "evidence-plan.json"), {
    version: "c60117-evidence-plan-v1",
    source: { ...old.source, fileName: "source-media" },
    models,
    requests,
    policy: REPRESENTATIVE_POLICY,
    paddingAccounting:
      "Whisper charged full 30-second encoder block; Reazon physical + 1.8 seconds",
    newModelFamilies: 2,
  });
  freeze(root, "pre-inference-freeze.json", [
    path.join(root, "evidence-plan.json"),
    path.join(root, "dataset-selection.json"),
    ...walk(path.join(root, "audio")),
  ]);
  console.log(
    "PREPARED " + requests.length + " logical tasks; no inference yet",
  );
} else if (phase === "generate-evidence") {
  process.env.PYTHONDONTWRITEBYTECODE = "1";
  const root = path.resolve(arg),
    partition = dest ?? "D";
  if (!["D", "C"].includes(partition)) throw Error("Partition required");
  verify(root, "dataset-freeze.json");
  verify(root, "pre-inference-freeze.json");
  const plan = read(path.join(root, "evidence-plan.json")),
    config = read(path.join(root, "runtime.local-only.json"));
  const executionCode = Object.fromEntries(
    [
      "scripts/run-c60117.mjs",
      "scripts/runtime/reazonspeech_k2_worker.py",
      "packages/transcription-core/dist/local.js",
      "packages/video-subtitler/dist/machine-quality/representative-clips.js",
    ].map((p) => [p, digest(fs.readFileSync(path.join(repo, p)))]),
  );
  const executionFreeze = path.join(root, "execution-code-freeze.json");
  if (fs.existsSync(executionFreeze)) {
    if (oh(read(executionFreeze).code) !== oh(executionCode))
      throw Error("Execution code changed after freeze");
  } else
    write(executionFreeze, {
      code: executionCode,
      frozenAt: new Date().toISOString(),
    });
  if (
    (await hash(config.whisper)) !== plan.models.whisper.binaryHash ||
    (await hash(config.whisperModel)) !== plan.models.whisper.modelHash ||
    oh(await loadReazonK2ModelIdentity(config.reazonModel)) !==
      oh(plan.models.reazon.identity) ||
    (await hash(
      path.join(repo, "scripts/runtime/reazonspeech_k2_worker.py"),
    )) !== plan.models.reazon.workerHash
  )
    throw Error("Runtime identity drift");
  fs.mkdirSync(path.join(root, "attempts"), { recursive: true });
  const reservations = () =>
    fs
      .readdirSync(path.join(root, "attempts"))
      .filter((f) => f.endsWith(".reserved.json"))
      .map((f) => read(path.join(root, "attempts", f)));
  let provider;
  try {
    for (const req of plan.requests.filter((r) => r.partition === partition)) {
      const target = path.join(root, "evidence", req.id + ".json");
      if (fs.existsSync(target)) {
        const old = read(target);
        if (old.cacheKey !== req.cacheKey || oh(old.raw) !== old.rawHash)
          throw Error("Invalid exact cache");
        console.log("CACHE " + req.id);
        continue;
      }
      // A reserved, incomplete task is never silently retried, including after a crash.
      if (reservations().some((r) => r.requestId === req.id))
        throw Error(
          "Prior incomplete attempt requires explicit execution-failure reconciliation: " +
            req.id,
        );
      const reservation = {
        ...reserveAttempt(reservations(), req.inputSeconds),
        requestId: req.id,
        cacheKey: req.cacheKey,
        reservedAt: new Date().toISOString(),
      };
      write(
        path.join(root, "attempts", req.id + ".reserved.json"),
        reservation,
      );
      console.log("START " + req.id);
      const begin = Date.now();
      let raw;
      try {
        if (req.provider === "whisper") {
          const runner = {
            run: async (exe, args, opts) => {
              if (
                args.some((a) =>
                  ["--prompt", "--vad", "--translate"].includes(a),
                )
              )
                throw Error("Prompt/VAD policy violation");
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
              write(path.join(root, "attempts", req.id + ".args.json"), {
                executableHash: plan.models.whisper.binaryHash,
                args: actual,
                promptAbsent: true,
                previousContext: false,
              });
              const result = await new NodeProcessRunner().run(exe, actual, {
                ...opts,
                allowNonZero: true,
                environment: childEnv,
              });
              write(
                path.join(root, "attempts", req.id + ".process.json"),
                result,
              );
              const prefix = args[args.indexOf("--output-file") + 1];
              for (const ext of ["json", "srt"])
                if (fs.existsSync(prefix + "." + ext))
                  fs.copyFileSync(
                    prefix + "." + ext,
                    path.join(root, "attempts", req.id + ".raw." + ext),
                    fs.constants.COPYFILE_EXCL,
                  );
              if (result.exitCode !== 0) throw Error("Whisper process failed");
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
            audioPath: path.join(root, req.audio),
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
        } else {
          if (!provider) {
            provider = new ReazonSpeechK2Provider({
              pythonExecutable: config.reazonPython,
              workerScriptPath: path.join(
                repo,
                "scripts/runtime/reazonspeech_k2_worker.py",
              ),
              modelDirectory: config.reazonModel,
            });
            const ready = await provider.start();
            write(
              path.join(
                root,
                "attempts",
                "reazon-" + partition + ".ready.json",
              ),
              ready,
            );
          }
          raw = await provider.transcribeBatch([
            {
              requestId: req.id,
              eventId: req.id,
              diagnosticRole: "TARGETED",
              windowType: "CORE_CONTEXT",
              sourceInterval: req.interval,
              sourceMediaSha256: plan.source.sha256,
              audioPath: path.join(root, req.audio),
              audioSha256: req.audioHash,
              sampleRate: req.sampleRate,
              sampleCount: req.sampleCount,
              extractionConfigHash: oh(req.interval),
            },
          ]);
          if (!["SUCCESS", "EMPTY_OUTPUT"].includes(raw.results[0].status))
            throw Error("Reazon execution failure: " + raw.results[0].status);
        }
        write(target, {
          cacheKey: req.cacheKey,
          raw,
          rawHash: oh(raw),
          execution: "FRESH",
          completedAt: new Date().toISOString(),
          wallSeconds: (Date.now() - begin) / 1000,
        });
      } catch (e) {
        write(path.join(root, "attempts", req.id + ".failure.json"), {
          error: String(e),
          wallSeconds: (Date.now() - begin) / 1000,
          automaticRetry: false,
        });
        throw e;
      }
      console.log(
        "DONE " + req.id + " " + ((Date.now() - begin) / 1000).toFixed(1) + "s",
      );
    }
  } finally {
    await provider?.close();
  }
  for (const c of read(path.join(root, "dataset-selection.json")).clips.filter(
    (c) => c.partition === partition,
  )) {
    const req = plan.requests.find(
        (r) => r.clipId === c.id && r.provider === "whisper",
      ),
      result = read(path.join(root, "evidence", req.id + ".json"));
    const payload = freshMatchedEvidenceSchema.parse({
      version: "c60117-fresh-primary-v1",
      partition: "development-known",
      promptStatus: "FRESH_PROMPT_FREE",
      source: plan.source,
      primaryRequests: [
        {
          id: req.id,
          cacheKey: req.cacheKey,
          cacheFileHash: await hash(
            path.join(root, "evidence", req.id + ".json"),
          ),
          audioHash: req.audioHash,
          resultHash: result.rawHash,
          modelHash: plan.models.whisper.modelHash,
          model: "large-v3",
          runtime: oh(plan.models.whisper),
          tokenizer: "embedded-in-model",
          promptHash: oh(""),
          decodeHash: oh(DECODE),
          sampleRate: 16000,
          interval: req.interval,
          timebase: "original-audio-local",
          vadEnabled: false,
          segments: result.raw.segments.map((s, i) => ({
            id: c.id + "-s" + i,
            start: s.start,
            end: s.end,
            text: s.text,
          })),
        },
      ],
    });
    const f = path.join(root, "generator-input", c.id + ".json");
    if (!fs.existsSync(f)) write(f, payload);
  }
  freeze(root, "evidence-" + partition + "-freeze.json", [
    ...walk(path.join(root, "evidence")).filter((p) =>
      plan.requests.some(
        (r) => r.partition === partition && p.endsWith(r.id + ".json"),
      ),
    ),
    ...walk(path.join(root, "generator-input")).filter((p) =>
      read(path.join(root, "dataset-selection.json")).clips.some(
        (c) => c.partition === partition && p.endsWith(c.id + ".json"),
      ),
    ),
  ]);
} else if (phase === "generate-subtitles") {
  const root = path.resolve(arg),
    config = read(dest);
  verify(root, "dataset-freeze.json");
  verify(root, "evidence-" + config.partition + "-freeze.json");
  const output = path.join(root, config.runName);
  fs.mkdirSync(output);
  for (const c of read(path.join(root, "dataset-selection.json")).clips.filter(
    (c) => c.partition === config.partition,
  )) {
    const input = path.join(root, "generator-input", c.id + ".json"),
      target = path.join(output, c.id);
    fs.mkdirSync(target);
    isolated(
      "generate-c60117.mjs",
      [input, dest, target],
      [input, path.resolve(dest)],
      target,
    );
  }
  freeze(root, config.runName + "-freeze.json", walk(output));
} else
  throw Error(
    "Usage: run-c60117.mjs prepare-dataset config output | generate-evidence output D|C | generate-subtitles output config",
  );
