import path from "node:path";
import { access, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { NodeProcessRunner, webrtcRuntime142Schema } from "@mvl/shared";
import { z } from "zod";
import {
  durableJson141,
  fileHash141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";

const { values } = parseArgs({
  strict: true,
  options: {
    python: { type: "string" },
    directory: { type: "string" },
    "authorize-network-bootstrap": { type: "boolean", default: false },
  },
});
const directory = path.resolve(required141(values.directory)),
  basePython = path.resolve(required141(values.python));
const runner = new NodeProcessRunner();
let networkUsed = false;
try {
  await access(path.join(directory, "runtime-manifest.json"));
  throw new Error("C601142_WEBRTC_RUNTIME_ALREADY_PREPARED");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (!values["authorize-network-bootstrap"]) {
  console.log(
    JSON.stringify({
      status: "WEBRTC_BOOTSTRAP_AUTHORIZATION_REQUIRED",
      inferenceCount: 0,
    }),
  );
  process.exit(0);
}
await mkdir(path.dirname(directory), { recursive: true });
await mkdir(directory, { recursive: false });
const workerHash = await fileHash141(
  path.resolve("scripts/runtime/c601142_speech_detector.py"),
);
try {
  await runner.run(basePython, ["-m", "venv", path.join(directory, "venv")], {
    timeoutMs: 120000,
  });
  const python = path.join(directory, "venv/bin/python");
  const install = await runner.run(
    python,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-deps",
      "--only-binary=:all:",
      "--requirement",
      path.resolve("scripts/runtime/requirements-c601142-webrtc.txt"),
    ],
    { timeoutMs: 180000 },
  );
  networkUsed = true;
  await durableJson141(
    path.join(directory, "bootstrap-receipt.local-only.json"),
    {
      commandType: "ISOLATED_PINNED_WEBRTC_WHEEL_INSTALL",
      stdout: install.stdout,
      stderr: install.stderr,
      inferenceCount: 0,
      modelDownloadCount: 0,
    },
  );
  const metadata = await runner.run(
    python,
    [
      "-c",
      "import json,sys,platform,importlib.metadata as m,webrtcvad,_webrtcvad; d=m.distribution('webrtcvad-wheels'); print(json.dumps({'version':d.version,'pythonVersion':sys.version.split()[0],'platform':platform.platform(),'module':webrtcvad.__file__,'implementation':_webrtcvad.__file__,'record':str(d.locate_file(next(f for f in d.files if str(f).endswith('.dist-info/RECORD'))))}))",
    ],
    { timeoutMs: 30000 },
  );
  const m = z
    .object({
      version: z.literal("2.0.14"),
      pythonVersion: z.string(),
      platform: z.string(),
      module: z.string(),
      implementation: z.string(),
      record: z.string(),
    })
    .strict()
    .parse(JSON.parse(metadata.stdout));
  const files = {
    python,
    module: m.module,
    implementation: m.implementation,
    record: m.record,
  };
  const identity = {
    implementationHash: await fileHash141(m.implementation),
    pythonBinaryHash: await fileHash141(python),
    moduleHash: await fileHash141(m.module),
    packageRecordHash: await fileHash141(m.record),
    pythonVersion: m.pythonVersion,
    platform: m.platform,
  };
  const manifest = webrtcRuntime142Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "machine-independent-speech-presence-runtime",
      visibility: "LOCAL_ONLY",
      status: "AVAILABLE",
      detectorFamily: "WEBRTC",
      packageName: "webrtcvad-wheels",
      packageVersion: "2.0.14",
      implementation: "WEBRTC_GMM_VAD_NO_ASR_NO_NEURAL_MODEL",
      ...identity,
      workerHash,
      runtimeIdentityHash: hash141({
        ...identity,
        workerHash,
        packageVersion: m.version,
      }),
      modelLoadCount: 0,
      inferenceCount: 0,
      networkUsedForBootstrap: networkUsed,
      inferenceNetworkAllowed: false,
      errorCode: null,
    }),
  );
  await durableJson141(
    path.join(directory, "runtime-files.local-only.json"),
    files,
  );
  await durableJson141(path.join(directory, "runtime-manifest.json"), manifest);
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  const errorCode = "WEBRTC_RUNTIME_UNAVAILABLE";
  await durableJson141(
    path.join(directory, "bootstrap-failure.local-only.json"),
    {
      errorCode,
      message: String(error),
      inferenceCount: 0,
      automaticRetryAllowed: false,
    },
  );
  const identity = {
    implementationHash: null,
    pythonVersion: null,
    pythonBinaryHash: null,
    platform: null,
    moduleHash: null,
    packageRecordHash: null,
    workerHash,
  };
  const manifest = webrtcRuntime142Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "machine-independent-speech-presence-runtime",
      visibility: "LOCAL_ONLY",
      status: errorCode,
      detectorFamily: "WEBRTC",
      packageName: "webrtcvad-wheels",
      packageVersion: "2.0.14",
      implementation: "WEBRTC_GMM_VAD_NO_ASR_NO_NEURAL_MODEL",
      ...identity,
      runtimeIdentityHash: hash141({ ...identity, errorCode }),
      modelLoadCount: 0,
      inferenceCount: 0,
      networkUsedForBootstrap: networkUsed,
      inferenceNetworkAllowed: false,
      errorCode,
    }),
  );
  await durableJson141(path.join(directory, "runtime-manifest.json"), manifest);
  console.log(JSON.stringify(manifest, null, 2));
}
