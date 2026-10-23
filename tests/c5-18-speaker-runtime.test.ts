import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  speakerModelManifestSchema,
  speakerRuntimeManifestSchema,
  type SpeakerModelManifest,
  type SpeakerRuntimeManifest,
} from "@mvl/shared";
import {
  LocalSpeakerWorker,
  SPEAKER_MODEL_CITATIONS,
  SPEAKER_MODEL_REPO,
  SPEAKER_MODEL_REVISION,
  assertSpeakerPreparationAuthorization,
  buildSpeakerRuntimeCapability,
  dependencyModelSnapshotIdentity,
  loadAndVerifySpeakerRuntime,
  speakerModelSnapshotIdentity,
  speakerRuntimeIdentity,
} from "@mvl/video-subtitler";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.HF_TOKEN;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function runtimeFixture(): Promise<{
  root: string;
  runtime: SpeakerRuntimeManifest;
  model: SpeakerModelManifest;
  runtimeManifestPath: string;
  modelManifestPath: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "mvl-c518-runtime-"));
  temporaryDirectories.push(root);
  const specPath = path.join(root, "requirements-explicit.txt");
  const spec = "pyannote.audio==4.0.7\ntorch==2.11.0\n";
  await writeFile(specPath, spec);
  const packages = [
    { name: "pyannote.audio", version: "4.0.7" },
    { name: "torch", version: "2.11.0" },
    { name: "torchaudio", version: "2.11.0" },
    { name: "huggingface-hub", version: "1.28.0" },
    { name: "numpy", version: "2.5.2" },
    { name: "scipy", version: "1.18.1" },
    { name: "soundfile", version: "0.14.0" },
  ];
  const explicitSpecSha256 = hash(spec);
  const dependencySpecSha256 = hash("direct requirements");
  const runtime = speakerRuntimeManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "speaker-runtime-manifest",
    runtimeVersion: "C5.18",
    generatedAt: "2026-08-26T00:00:00.000Z",
    runtimeId: "fixture-runtime",
    runtimeDirectory: root,
    pythonExecutable: process.execPath,
    pythonVersion: process.versions.node,
    packages,
    explicitSpecPath: specPath,
    explicitSpecSha256,
    dependencySpecSha256,
    runtimeIdentityHash: speakerRuntimeIdentity({
      pythonVersion: process.versions.node,
      packages,
      explicitSpecSha256,
      dependencySpecSha256,
    }),
  });

  const snapshotDirectory = path.join(root, "model");
  const sources = {
    "config.yaml": "pipeline: Community-1\n",
    "embedding/pytorch_model.bin": "embedding-fixture",
    "plda/plda.npz": "plda-fixture",
    "segmentation/pytorch_model.bin": "segmentation-fixture",
  };
  for (const [relativePath, content] of Object.entries(sources)) {
    const filePath = path.join(snapshotDirectory, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  const modelFiles = await Promise.all(
    Object.entries(sources).map(async ([relativePath]) => {
      const content = await readFile(
        path.join(snapshotDirectory, relativePath),
      );
      return { relativePath, size: content.length, sha256: hash(content) };
    }),
  );
  modelFiles.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  const dependencyModelSnapshots = ["embedding", "plda", "segmentation"].map(
    (snapshotSubdirectory) => {
      const prefix = `${snapshotSubdirectory}/`;
      const files = modelFiles
        .filter((file) => file.relativePath.startsWith(prefix))
        .map((file) => ({
          ...file,
          relativePath: file.relativePath.slice(prefix.length),
        }));
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
  const model = speakerModelManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "speaker-model-manifest",
    modelVersion: "C5.18",
    generatedAt: "2026-08-26T00:00:00.000Z",
    backend: "pyannote-community-1",
    modelRepo: SPEAKER_MODEL_REPO,
    requestedRevision: SPEAKER_MODEL_REVISION,
    resolvedRevision: SPEAKER_MODEL_REVISION,
    snapshotDirectory,
    modelSnapshotHash: speakerModelSnapshotIdentity({
      modelRepo: SPEAKER_MODEL_REPO,
      modelRevision: SPEAKER_MODEL_REVISION,
      modelFiles,
      dependencyModelSnapshots,
    }),
    modelFiles,
    dependencyModelSnapshots,
    license: "cc-by-4.0",
    citations: SPEAKER_MODEL_CITATIONS,
    networkUsedDuringPreparation: true,
    hfTokenEnvName: "HF_TOKEN",
    hfTokenStored: false,
  });
  const runtimeManifestPath = path.join(root, "speaker-runtime-manifest.json");
  const modelManifestPath = path.join(root, "speaker-model-manifest.json");
  await Promise.all([
    writeFile(runtimeManifestPath, `${JSON.stringify(runtime)}\n`),
    writeFile(modelManifestPath, `${JSON.stringify(model)}\n`),
  ]);
  return {
    root,
    runtime,
    model,
    runtimeManifestPath,
    modelManifestPath,
  };
}

async function workerFixture(root: string): Promise<string> {
  const workerPath = path.join(root, "speaker-worker-fixture.mjs");
  await writeFile(
    workerPath,
    String.raw`import readline from 'node:readline';
const requested=process.argv[process.argv.indexOf('--device')+1];
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(process.env.HF_TOKEN||process.env.HUGGING_FACE_HUB_TOKEN||process.env.HF_HUB_OFFLINE!=='1'||process.env.TRANSFORMERS_OFFLINE!=='1'){
  emit({type:'fatal',code:'ENVIRONMENT_NOT_OFFLINE',message:'worker environment leak'});
  process.exit(2);
}
if(requested==='mps'){
  emit({type:'fatal',code:'MPS_REQUESTED_BUT_UNAVAILABLE',message:'fixture has no MPS'});
  process.exit(3);
}
emit({type:'ready',deviceRequested:requested,deviceUsed:'cpu',fallback:requested==='auto'?{applied:true,from:'mps',to:'cpu',reason:'fixture'}:{applied:false,from:null,to:null,reason:null},mpsAvailable:false,allPipelineModulesOnDevice:true,modelLoadCount:1,versions:{python:'3.13.14','pyannote.audio':'4.0.7',torch:'2.11.0',torchaudio:'2.11.0',huggingface_hub:'1.28.0',numpy:'2.5.2',scipy:'1.18.1',soundfile:'0.14.0'}});
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{const request=JSON.parse(line);if(request.type==='shutdown'){process.exit(0)}if(request.type==='infer')emit({type:'result',requestId:request.requestId,standardTurns:[{speaker:'raw-0',start:0,end:1},{speaker:'raw-1',start:.5,end:1.5}],exclusiveTurns:[{speaker:'raw-0',start:0,end:.75},{speaker:'raw-1',start:.75,end:1.5}],wallClockSeconds:.1,confidenceStatus:'unavailable',warnings:[]})});
`,
  );
  return workerPath;
}

describe("C5.18 local speaker runtime", () => {
  it("strictly parses and verifies the fixed official model plus bundled dependencies", async () => {
    const fixture = await runtimeFixture();
    const verified = await loadAndVerifySpeakerRuntime({
      runtimeManifestPath: fixture.runtimeManifestPath,
      modelManifestPath: fixture.modelManifestPath,
    });
    expect(verified.model.modelRepo).toBe(SPEAKER_MODEL_REPO);
    expect(verified.model.resolvedRevision).toBe(SPEAKER_MODEL_REVISION);
    expect(
      verified.model.dependencyModelSnapshots.map(
        (snapshot) => snapshot.snapshotSubdirectory,
      ),
    ).toEqual(["embedding", "plda", "segmentation"]);
    expect(() =>
      speakerRuntimeManifestSchema.parse({ ...fixture.runtime, extra: true }),
    ).toThrow();
  });

  it("rejects floating, foreign, and merely commit-shaped model identities", async () => {
    const fixture = await runtimeFixture();
    expect(() =>
      speakerModelManifestSchema.parse({
        ...fixture.model,
        requestedRevision: "main",
      }),
    ).toThrow();
    expect(() =>
      speakerModelManifestSchema.parse({
        ...fixture.model,
        modelRepo: "foreign/cloud-diarization",
      }),
    ).toThrow();
    await writeFile(
      fixture.modelManifestPath,
      `${JSON.stringify({
        ...fixture.model,
        requestedRevision: "d".repeat(40),
        resolvedRevision: "d".repeat(40),
      })}\n`,
    );
    await expect(
      loadAndVerifySpeakerRuntime({
        runtimeManifestPath: fixture.runtimeManifestPath,
        modelManifestPath: fixture.modelManifestPath,
      }),
    ).rejects.toThrow(/fixed official Community-1 snapshot/u);
  });

  it("fails closed without preparation authorization and never returns the token", () => {
    expect(() =>
      assertSpeakerPreparationAuthorization({
        fetchSpeakerModels: true,
        tokenEnvironmentName: "HF_TOKEN",
        environment: {},
      }),
    ).toThrow(/HF_TOKEN is not set/u);
    const environment = { HF_TOKEN: "private-fixture-token" };
    expect(
      assertSpeakerPreparationAuthorization({
        fetchSpeakerModels: true,
        tokenEnvironmentName: "HF_TOKEN",
        environment,
      }),
    ).toBeUndefined();
    expect(() =>
      assertSpeakerPreparationAuthorization({
        fetchSpeakerModels: false,
        tokenEnvironmentName: "bad-name;echo",
        environment,
      }),
    ).toThrow(/environment variable/u);
  });

  it("runs a persistent offline worker with Standard and Exclusive output and auto CPU fallback", async () => {
    const fixture = await runtimeFixture();
    const workerPath = await workerFixture(fixture.root);
    process.env.HF_TOKEN = "must-not-reach-child";
    const worker = new LocalSpeakerWorker({
      runtime: { ...fixture.runtime, pythonExecutable: process.execPath },
      model: fixture.model,
      device: "auto",
      workerScriptPath: workerPath,
    });
    try {
      const ready = await worker.start();
      const output = await worker.infer({
        audioPath: path.join(fixture.root, "unused.wav"),
        minSpeakers: 1,
        maxSpeakers: 3,
      });
      expect(ready).toMatchObject({
        deviceRequested: "auto",
        deviceUsed: "cpu",
        fallback: { applied: true, from: "mps", to: "cpu" },
        allPipelineModulesOnDevice: true,
        modelLoadCount: 1,
      });
      expect(output.standardTurns).toHaveLength(2);
      expect(output.exclusiveTurns).toHaveLength(2);
      expect(output.confidenceStatus).toBe("unavailable");
    } finally {
      await worker.close();
    }
  });

  it("fails explicit MPS rather than silently falling back", async () => {
    const fixture = await runtimeFixture();
    const workerPath = await workerFixture(fixture.root);
    const worker = new LocalSpeakerWorker({
      runtime: { ...fixture.runtime, pythonExecutable: process.execPath },
      model: fixture.model,
      device: "mps",
      workerScriptPath: workerPath,
    });
    await expect(worker.start()).rejects.toThrow(
      /MPS_REQUESTED_BUT_UNAVAILABLE/u,
    );
    await worker.close();
  });

  it("emits a shareable capability with no runtime path, cache path, token, or invented confidence", async () => {
    const fixture = await runtimeFixture();
    const capability = buildSpeakerRuntimeCapability({
      runtime: fixture.runtime,
      model: fixture.model,
      ready: {
        deviceRequested: "auto",
        deviceUsed: "cpu",
        fallback: { applied: true, from: "mps", to: "cpu", reason: "probe" },
        mpsAvailable: true,
        allPipelineModulesOnDevice: true,
        modelLoadCount: 1,
        versions: {
          python: "3.13.14",
          "pyannote.audio": "4.0.7",
          torch: "2.11.0",
          torchaudio: "2.11.0",
          huggingface_hub: "1.28.0",
          numpy: "2.5.2",
          scipy: "1.18.1",
          soundfile: "0.14.0",
        },
      },
      inference: {
        standardTurns: [{ speaker: "raw", start: 0, end: 1 }],
        exclusiveTurns: [{ speaker: "raw", start: 0, end: 1 }],
        wallClockSeconds: 1,
        confidenceStatus: "unavailable",
        warnings: [],
      },
      mpsCpuSemanticComparable: null,
    });
    expect(capability).toMatchObject({
      runtimePath: null,
      modelCachePath: null,
      hfTokenStored: false,
      networkUsedDuringInference: false,
      speakerConfidenceAvailable: false,
      confidenceStatus: "unavailable",
      shareable: true,
    });
    expect(JSON.stringify(capability)).not.toContain(fixture.root);
    expect(JSON.stringify(capability)).not.toMatch(/private-fixture-token/u);
  });

  it.skipIf(process.env.MVL_SPEAKER_INTEGRATION_TEST !== "1")(
    "runs real Community-1 inference only when explicitly enabled",
    async () => {
      const runtimeManifestPath = process.env.MVL_SPEAKER_RUNTIME_MANIFEST;
      const modelManifestPath = process.env.MVL_SPEAKER_MODEL_MANIFEST;
      const probeAudioPath = process.env.MVL_SPEAKER_PROBE_AUDIO;
      if (
        runtimeManifestPath === undefined ||
        modelManifestPath === undefined ||
        probeAudioPath === undefined
      ) {
        throw new Error(
          "MVL_SPEAKER_INTEGRATION_TEST requires runtime, model, and probe-audio paths.",
        );
      }
      const verified = await loadAndVerifySpeakerRuntime({
        runtimeManifestPath,
        modelManifestPath,
      });
      const worker = new LocalSpeakerWorker({
        ...verified,
        device: "auto",
        workerScriptPath: path.resolve("scripts/runtime/speaker_worker.py"),
      });
      try {
        const ready = await worker.start();
        const output = await worker.infer({
          audioPath: probeAudioPath,
          minSpeakers: 1,
          maxSpeakers: 3,
        });
        expect(ready.allPipelineModulesOnDevice).toBe(true);
        expect(output.standardTurns.length).toBeGreaterThan(0);
        expect(output.exclusiveTurns.length).toBeGreaterThan(0);
      } finally {
        await worker.close();
      }
    },
  );
});
