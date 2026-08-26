import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  NodeProcessRunner,
  atomicWriteFile,
  atomicWriteJson,
  speakerDeviceSchema,
  speakerModelManifestSchema,
  speakerRuntimeManifestSchema,
} from "@mvl/shared";
import {
  LocalSpeakerWorker,
  SPEAKER_MODEL_CITATIONS,
  SPEAKER_MODEL_LICENSE,
  SPEAKER_MODEL_REPO,
  SPEAKER_MODEL_REVISION,
  SPEAKER_RUNTIME_REQUIREMENTS,
  assertSpeakerPreparationAuthorization,
  dependencyModelSnapshotIdentity,
  loadAndVerifySpeakerRuntime,
  sha256Value,
  speakerModelSnapshotIdentity,
  speakerRuntimeIdentity,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    "create-runtime": { type: "boolean", default: false },
    "fetch-speaker-models": { type: "boolean", default: false },
    "speaker-model": { type: "string", default: SPEAKER_MODEL_REPO },
    "model-revision": { type: "string", default: SPEAKER_MODEL_REVISION },
    "hf-token-env": { type: "string", default: "HF_TOKEN" },
    "runtime-root": { type: "string" },
    "python-command": { type: "string", default: "python3" },
    device: { type: "string", default: "auto" },
  },
  strict: true,
});

if (!values["create-runtime"] && !values["fetch-speaker-models"]) {
  throw new InputError(
    "Pass --create-runtime and/or --fetch-speaker-models for C5.18 preparation.",
  );
}
if (
  values["speaker-model"] !== SPEAKER_MODEL_REPO ||
  values["model-revision"] !== SPEAKER_MODEL_REVISION
) {
  throw new InputError(
    `C5.18 requires ${SPEAKER_MODEL_REPO}@${SPEAKER_MODEL_REVISION}.`,
  );
}
const device = speakerDeviceSchema.parse(values.device);
assertSpeakerPreparationAuthorization({
  fetchSpeakerModels: values["fetch-speaker-models"],
  tokenEnvironmentName: values["hf-token-env"],
});

const runner = new NodeProcessRunner();
const systemPython = values["python-command"];
const pythonVersionResult = await runner.run(systemPython, [
  "-c",
  "import platform; print(platform.python_version())",
]);
const systemPythonVersion = pythonVersionResult.stdout.trim();
const dependencySpec = `${SPEAKER_RUNTIME_REQUIREMENTS.join("\n")}\n`;
const dependencySpecSha256 = createHash("sha256")
  .update(dependencySpec)
  .digest("hex");
const runtimeId = `c518-${sha256Value({
  systemPythonVersion,
  requirements: SPEAKER_RUNTIME_REQUIREMENTS,
}).slice(0, 16)}`;
const runtimeRoot = path.resolve(
  values["runtime-root"] ??
    path.join(homedir(), ".cache", "mvl", "speaker-runtime"),
);
const runtimeDirectory = path.join(runtimeRoot, runtimeId);
const runtimePython = path.join(runtimeDirectory, "bin", "python");
const manifestDirectory = path.join(runtimeDirectory, "manifests");
const explicitSpecPath = path.join(
  manifestDirectory,
  "requirements-explicit.txt",
);
const dependencySpecPath = path.join(
  manifestDirectory,
  "requirements-direct.txt",
);
await mkdir(manifestDirectory, { recursive: true });

if (values["create-runtime"]) {
  try {
    const runtimePythonInfo = await stat(runtimePython);
    if (!runtimePythonInfo.isFile()) throw new Error("not a file");
  } catch {
    await runner.run(systemPython, ["-m", "venv", runtimeDirectory], {
      timeoutMs: 120_000,
    });
  }
  await runner.run(
    runtimePython,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
      ...SPEAKER_RUNTIME_REQUIREMENTS,
    ],
    { timeoutMs: 1_800_000 },
  );
}

const packageProbe = await runner.run(runtimePython, [
  "-c",
  `import importlib.metadata,json; names=${JSON.stringify([
    "pyannote.audio",
    "torch",
    "torchaudio",
    "huggingface-hub",
    "numpy",
    "scipy",
    "soundfile",
  ])}; print(json.dumps([{"name":n,"version":importlib.metadata.version(n)} for n in names],separators=(",",":")))`,
]);
const packages = JSON.parse(packageProbe.stdout) as {
  name: string;
  version: string;
}[];
const runtimePythonVersion = (
  await runner.run(runtimePython, [
    "-c",
    "import platform; print(platform.python_version())",
  ])
).stdout.trim();
const explicitSpec = (
  await runner.run(runtimePython, ["-m", "pip", "freeze", "--all"])
).stdout;
await Promise.all([
  atomicWriteFile(explicitSpecPath, explicitSpec, { overwrite: true }),
  atomicWriteFile(dependencySpecPath, dependencySpec, { overwrite: true }),
]);
const explicitSpecSha256 = createHash("sha256")
  .update(await readFile(explicitSpecPath))
  .digest("hex");
const runtimeManifest = speakerRuntimeManifestSchema.parse({
  schemaVersion: "1.0.0",
  artifactType: "speaker-runtime-manifest",
  runtimeVersion: "C5.18",
  generatedAt: new Date().toISOString(),
  runtimeId,
  runtimeDirectory,
  pythonExecutable: runtimePython,
  pythonVersion: runtimePythonVersion,
  packages,
  explicitSpecPath,
  explicitSpecSha256,
  dependencySpecSha256,
  runtimeIdentityHash: speakerRuntimeIdentity({
    pythonVersion: runtimePythonVersion,
    packages,
    explicitSpecSha256,
    dependencySpecSha256,
  }),
});
const runtimeManifestPath = path.join(
  manifestDirectory,
  "speaker-runtime-manifest.json",
);
await atomicWriteJson(runtimeManifestPath, runtimeManifest, {
  overwrite: true,
});

if (!values["fetch-speaker-models"]) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, runtimeManifest: runtimeManifestPath }, null, 2)}\n`,
  );
  process.exit(0);
}

const fetchCode = [
  "import json,os,sys",
  "from huggingface_hub import snapshot_download",
  "repo,revision,token_name=sys.argv[1:4]",
  "token=os.environ.get(token_name)",
  "assert token, f'{token_name} is missing'",
  "target=snapshot_download(repo_id=repo,revision=revision,token=token)",
  "print(json.dumps({'snapshotDirectory':target},separators=(',',':')))",
].join(";");
const fetched = await runner.run(
  runtimePython,
  [
    "-c",
    fetchCode,
    SPEAKER_MODEL_REPO,
    SPEAKER_MODEL_REVISION,
    values["hf-token-env"],
  ],
  { timeoutMs: 1_800_000 },
);
const snapshotDirectory = path.resolve(
  (JSON.parse(fetched.stdout) as { snapshotDirectory: string })
    .snapshotDirectory,
);

async function collectFiles(
  directory: string,
  root = directory,
): Promise<{ relativePath: string; size: number; sha256: string }[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected: { relativePath: string; size: number; sha256: string }[] =
    [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await collectFiles(entryPath, root)));
      continue;
    }
    const info = await stat(entryPath);
    if (!info.isFile()) continue;
    collected.push({
      relativePath: path.relative(root, entryPath).split(path.sep).join("/"),
      size: info.size,
      sha256: createHash("sha256")
        .update(await readFile(entryPath))
        .digest("hex"),
    });
  }
  return collected.toSorted((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

const modelFiles = await collectFiles(snapshotDirectory);
const dependencyModelSnapshots = ["embedding", "plda", "segmentation"].map(
  (snapshotSubdirectory) => {
    const prefix = `${snapshotSubdirectory}/`;
    const files = modelFiles
      .filter((file) => file.relativePath.startsWith(prefix))
      .map((file) => ({
        ...file,
        relativePath: file.relativePath.slice(prefix.length),
      }));
    if (files.length === 0) {
      throw new InputError(
        `Official Community-1 snapshot lacks bundled ${snapshotSubdirectory} files.`,
      );
    }
    const base = {
      modelRepo: SPEAKER_MODEL_REPO,
      modelRevision: SPEAKER_MODEL_REVISION,
      snapshotSubdirectory,
      files,
    };
    return {
      ...base,
      modelSnapshotHash: dependencyModelSnapshotIdentity(base),
    };
  },
);
const modelSnapshotHash = speakerModelSnapshotIdentity({
  modelRepo: SPEAKER_MODEL_REPO,
  modelRevision: SPEAKER_MODEL_REVISION,
  modelFiles,
  dependencyModelSnapshots,
});
const modelManifest = speakerModelManifestSchema.parse({
  schemaVersion: "1.0.0",
  artifactType: "speaker-model-manifest",
  modelVersion: "C5.18",
  generatedAt: new Date().toISOString(),
  backend: "pyannote-community-1",
  modelRepo: SPEAKER_MODEL_REPO,
  requestedRevision: SPEAKER_MODEL_REVISION,
  resolvedRevision: SPEAKER_MODEL_REVISION,
  snapshotDirectory,
  modelSnapshotHash,
  modelFiles,
  dependencyModelSnapshots,
  license: SPEAKER_MODEL_LICENSE,
  citations: SPEAKER_MODEL_CITATIONS,
  networkUsedDuringPreparation: true,
  hfTokenEnvName: values["hf-token-env"],
  hfTokenStored: false,
});
const modelManifestPath = path.join(
  manifestDirectory,
  "speaker-model-manifest.json",
);
await atomicWriteJson(modelManifestPath, modelManifest, { overwrite: true });
await loadAndVerifySpeakerRuntime({ runtimeManifestPath, modelManifestPath });

const probeDirectory = await mkdtemp(path.join(tmpdir(), "mvl-speaker-probe-"));
try {
  const probeWav = path.join(probeDirectory, "probe.wav");
  const frames = 16_000 * 5;
  const pcm = Buffer.alloc(frames * 2);
  for (let index = 0; index < frames; index += 1) {
    pcm.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 220 * index) / 16_000) * 2_000),
      index * 2,
    );
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  await writeFile(probeWav, Buffer.concat([header, pcm]), { flag: "wx" });
  const worker = new LocalSpeakerWorker({
    runtime: runtimeManifest,
    model: modelManifest,
    device,
    workerScriptPath: path.resolve("scripts/runtime/speaker_worker.py"),
  });
  const ready = await worker.start();
  const inference = await worker.infer({
    audioPath: probeWav,
    minSpeakers: 1,
    maxSpeakers: 1,
  });
  await worker.close();
  if (
    inference.standardTurns.some(
      (turn) => !Number.isFinite(turn.start) || !Number.isFinite(turn.end),
    ) ||
    inference.exclusiveTurns.some(
      (turn) => !Number.isFinite(turn.start) || !Number.isFinite(turn.end),
    )
  ) {
    throw new InputError(
      "Offline speaker runtime probe produced non-finite output.",
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        runtimeManifest: runtimeManifestPath,
        modelManifest: modelManifestPath,
        runtimeIdentityHash: runtimeManifest.runtimeIdentityHash,
        modelSnapshotHash,
        offlineProbe: {
          deviceUsed: ready.deviceUsed,
          standardDiarizationAvailable: true,
          exclusiveDiarizationAvailable: true,
          confidenceStatus: inference.confidenceStatus,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(probeDirectory, { recursive: true, force: true });
}
