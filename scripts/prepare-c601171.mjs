import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseAss } from "../packages/subtitle-core/dist/index.js";
import { normalizeC601GoldAssTimestamps } from "../packages/video-subtitler/dist/blind-acceptance/gold-evaluation.js";
import {
  COMPLETE_POLICY,
  prepareUnits,
  dataGate,
  closure,
  generationManifestSchema,
} from "../packages/video-subtitler/dist/machine-quality/reference-complete.js";
import {
  read,
  write,
  hash,
  oh,
  digest,
  repo,
  freeze,
  verify,
  wavInfo,
  childEnv,
} from "./c60117-common.mjs";
const [phase, configPath, rootArg] = process.argv.slice(2);
const root = path.resolve(rootArg);
if (phase === "prepare-reference-complete-units") {
  const config = read(configPath);
  fs.mkdirSync(root);
  if (!fs.existsSync(config.media) || !fs.existsSync(config.reference)) {
    write(path.join(root, "dataset/reference-complete-preflight.json"), {
      status: "DATA_PREFLIGHT_FAILED",
      issues: ["SOURCE_OR_REFERENCE_INCOMPLETE"],
      newInference: 0,
    });
    throw Error("SOURCE_OR_REFERENCE_INCOMPLETE");
  }
  const baseline = "43f736f206937ad9253a0bd913d0aeceeb4541b1";
  const tracked = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", baseline],
    { cwd: repo, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  const code = Object.fromEntries(
    tracked
      .filter(
        (p) =>
          p.startsWith("packages/") ||
          p.startsWith(".agents/") ||
          p === "package-lock.json" ||
          /^scripts\/(generate-c60117|c60117-common|evaluate-c60117)\.mjs$/.test(
            p,
          ),
      )
      .map((p) => {
        const actual = digest(fs.readFileSync(path.join(repo, p))),
          prior = digest(
            execFileSync("git", ["show", baseline + ":" + p], {
              cwd: repo,
              maxBuffer: 16 * 1024 * 1024,
            }),
          );
        if (actual !== prior) throw Error("Frozen source changed: " + p);
        return [p, actual];
      }),
  );
  const oldPlan = read(path.join(config.oldRun, "evidence-plan.json"));
  if (
    (await hash(config.whisper)) !== oldPlan.models.whisper.binaryHash ||
    (await hash(config.whisperModel)) !== oldPlan.models.whisper.modelHash
  )
    throw Error("FROZEN_MODEL_DRIFT");
  write(path.join(root, "frozen-repair-identity.json"), {
    baseline,
    code,
    model: oldPlan.models.whisper,
    policy: COMPLETE_POLICY,
    profiles: {
      P0: "primaryMinimal",
      P1: "legacy",
      P2: "occurrence-overlap-required",
      off: "legacy",
    },
    frozenAt: new Date().toISOString(),
    referenceReads: 0,
  });
  const frozenRepairHash = await hash(
    path.join(root, "frozen-repair-identity.json"),
  );
  write(path.join(root, "runtime.local-only.json"), {
    whisper: config.whisper,
    whisperModel: config.whisperModel,
  });
  if ((await hash(config.media)) !== oldPlan.source.sha256)
    throw Error("SOURCE_VERSION_MISMATCH");
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
  const audio = probe.streams.find(
    (s) => s.index === oldPlan.source.audioStream && s.codec_type === "audio",
  );
  if (
    !audio ||
    Number(audio.sample_rate) !== oldPlan.source.sourceSampleRate ||
    Number(audio.start_time ?? 0) !== 0
  )
    throw Error("SOURCE_TIMEBASE_MISMATCH");
  const firstRead = new Date().toISOString(),
    bytes = fs.readFileSync(config.reference);
  const normalized = normalizeC601GoldAssTimestamps(bytes.toString());
  const reference = parseAss(normalized.content).map((c, i) => ({
    ...c,
    id: "reference-" + i,
  }));
  const rawRows = normalized.content
    .split(/\r?\n/)
    .filter((l) => /^Dialogue:/i.test(l));
  if (rawRows.length !== reference.length)
    throw Error("REFERENCE_PARSER_DROPPED_ROWS");
  const old = read(path.join(config.oldRun, "dataset-selection.json"));
  const prepared = prepareUnits({
    reference,
    rate: Number(audio.sample_rate),
    duration: oldPlan.source.durationSeconds,
    old: old.clips,
    candidates: old.candidates,
    replacementOrder: old.replacementOrder,
    exclusions: old.exclusions,
  });
  const evalDir = path.join(root, "dataset/evaluation-only");
  write(path.join(evalDir, "reference-manifest.json"), {
    ...prepared,
    source: oldPlan.source,
    referenceHash: digest(bytes),
    fullReference: reference,
    referenceIntervalClosure:
      "strict positive intersection; all full rows; native sample outward rounding",
    referenceTextAuthority:
      "user-provided human review; not independently revalidated",
    referenceContentScope:
      "all styles including lyrics and title-like annotations; unchanged .17 scope",
    acousticBoundaryConfirmed: false,
    dataPreparationReferenceReads: 1,
    dataPreparationReferenceFirstRead: firstRead,
    normalization: {
      name: "existing .17 ASS decimal comma parsing",
      count: normalized.replacementCount,
    },
    BENCHMARK_REFERENCE_SEGMENTED: true,
    UNSEGMENTED_END_TO_END_VALIDATION: "NOT_RUN",
    oldScopeAudit: old.clips.map((c) => ({
      id: c.id,
      partition: c.partition,
      complete: closure(c, reference).complete,
      crossingIds: closure(c, reference).crossing.map((r) => r.id),
    })),
  });
  write(
    path.join(root, "dataset/selection-and-exclusion-ledger.json"),
    prepared.ledger,
  );
  const units = [];
  for (const u of prepared.units) {
    const f = path.join(root, "audio", u.id + ".wav");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    // Native-sample crop BEFORE resampling. Bounds share the native/16k grid.
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
      `atrim=start_sample=${u.startSample}:end_sample=${u.endSample},asetpts=PTS-STARTPTS,aresample=16000`,
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      f,
    ];
    execFileSync(config.ffmpeg, args, { env: childEnv });
    const wav = wavInfo(f);
    if (
      wav.sampleCount !==
      ((u.endSample - u.startSample) * 16000) / Number(audio.sample_rate)
    )
      throw Error("PHYSICAL_WAV_MAPPING_MISMATCH");
    units.push({
      id: u.id,
      audio: "audio/" + u.id + ".wav",
      audioHash: await hash(f),
      ...wav,
      sourceOffset: u.start,
    });
    write(path.join(root, "dataset/mapping", u.id + ".json"), {
      sourceHash: oldPlan.source.sha256,
      audioStream: audio.index,
      sourceSampleRate: Number(audio.sample_rate),
      startSample: u.startSample,
      endSample: u.endSample,
      sourceOffset: u.start,
      localToGlobal: "global=local+sourceOffset",
      extraction: args.slice(0, -1),
      wav,
    });
  }
  const manifest = generationManifestSchema.parse({
    version: "c601171-generation-v1",
    frozenRepairHash,
    units,
  });
  write(path.join(root, "dataset/generation-manifest.json"), manifest);
  const preflight = dataGate(prepared.units, true);
  write(path.join(root, "dataset/reference-complete-preflight.json"), {
    ...preflight,
    policy: COMPLETE_POLICY,
    physicalAudioVerified: true,
    generationManifestHash: oh(manifest),
    frozenRepairHash,
    completedAt: new Date().toISOString(),
  });
  const receipt = {
    status: preflight.status,
    preflightHash: await hash(
      path.join(root, "dataset/reference-complete-preflight.json"),
    ),
    generationManifestHash: oh(manifest),
    frozenRepairHash,
  };
  write(path.join(root, "dataset/model-gate.json"), receipt);
  freeze(
    root,
    "model-input-freeze.json",
    [
      "frozen-repair-identity.json",
      "runtime.local-only.json",
      "dataset/generation-manifest.json",
      "dataset/model-gate.json",
      ...units.map((u) => u.audio),
    ].map((p) => path.join(root, p)),
  );
  freeze(
    root,
    "dataset-freeze.json",
    [
      "dataset/evaluation-only/reference-manifest.json",
      "dataset/reference-complete-preflight.json",
      "dataset/selection-and-exclusion-ledger.json",
    ].map((p) => path.join(root, p)),
  );
  console.log(JSON.stringify(preflight, null, 2));
} else if (phase === "validate-dataset") {
  verify(root, "dataset-freeze.json");
  verify(root, "model-input-freeze.json");
  const ref = read(
    path.join(root, "dataset/evaluation-only/reference-manifest.json"),
  );
  const manifest = generationManifestSchema.parse(
    read(path.join(root, "dataset/generation-manifest.json")),
  );
  const valid = manifest.units.every(
    (u) =>
      oh(wavInfo(path.join(root, u.audio))) ===
      oh({
        sampleRate: u.sampleRate,
        sampleCount: u.sampleCount,
        seconds: u.seconds,
      }),
  );
  const gate = dataGate(ref.units, valid);
  if (gate.status !== read(path.join(root, "dataset/model-gate.json")).status)
    throw Error("Preflight drift");
  console.log(JSON.stringify(gate, null, 2));
} else
  throw Error(
    "prepare-reference-complete-units CONFIG NEW_ROOT | validate-dataset UNUSED ROOT",
  );
