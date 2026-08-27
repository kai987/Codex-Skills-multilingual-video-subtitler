import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  atomicWriteFile,
  atomicWriteJson,
  InputError,
  pathExists,
} from "@mvl/shared";
import {
  auditBlindRunProvenance,
  buildMachineBaselineEvidenceCoverage,
  createBlindGenerationInputManifest,
  createBlindOutputFreeze,
  createC601EvaluationPolicy,
  createMachineShadowPolicy,
  evaluateMachineShadowFinalization,
  sha256BlindFile,
} from "@mvl/video-subtitler";

const execFileAsync = promisify(execFile);
const EXPECTED_SOURCE_SIZE = 847_774_958;
const EXPECTED_SOURCE_SHA256 =
  "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43";

function parseArguments(argv: readonly string[]): Map<string, string> {
  const allowed = new Set([
    "--video",
    "--output",
    "--model",
    "--model-name",
    "--whisper",
    "--whisper-version",
    "--device",
    "--run-label",
  ]);
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !allowed.has(flag)) {
      throw new InputError("Invalid C6.0.1 blind generation arguments.", {
        flag,
        allowed: [...allowed],
      });
    }
    result.set(flag, value);
  }
  return result;
}

function required(argumentsMap: Map<string, string>, flag: string): string {
  const value = argumentsMap.get(flag);
  if (value === undefined || value.length === 0) {
    throw new InputError(`Missing required argument ${flag}.`);
  }
  return value;
}

function isolatedEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /(?:API[_-]?KEY|TOKEN|SECRET|OPENAI|OPENSUBTITLE|ASSRT|SUBTITLE[_-]?SOURCE)/iu.test(
        key,
      )
    ) {
      environment[key] = undefined;
    }
  }
  environment.NO_PROXY = "*";
  environment.no_proxy = "*";
  return environment;
}

async function runProductionSubtitleCommand(input: {
  argumentsList: readonly string[];
  logPath: string;
}): Promise<number> {
  const chunks: string[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      "npm",
      ["run", "subtitle", "--", ...input.argumentsList],
      {
        cwd: process.cwd(),
        env: isolatedEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const record = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      chunks.push(text);
      process.stdout.write(text);
    };
    child.stdout.on("data", record);
    child.stderr.on("data", record);
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  await atomicWriteFile(input.logPath, chunks.join(""));
  return exitCode;
}

const args = parseArguments(process.argv.slice(2));
const videoPath = path.resolve(required(args, "--video"));
const outputPath = path.resolve(required(args, "--output"));
const modelPath = path.resolve(required(args, "--model"));
const whisperPath = path.resolve(required(args, "--whisper"));
const modelName = args.get("--model-name") ?? "large-v3";
const whisperVersion = args.get("--whisper-version") ?? "unknown";
const device = args.get("--device") ?? "local";
const runLabel = args.get("--run-label") ?? "blind";

if (await pathExists(outputPath)) {
  throw new InputError(
    "Blind generation output already exists; overwrite is forbidden.",
    {
      outputPath,
    },
  );
}
for (const [label, filePath] of [
  ["source video", videoPath],
  ["Whisper model", modelPath],
  ["Whisper executable", whisperPath],
] as const) {
  const info = await stat(filePath);
  if (!info.isFile())
    throw new InputError(`${label} must be a regular file.`, { filePath });
}
const sourceInfo = await stat(videoPath);
const sourceHashBefore = await sha256BlindFile(videoPath);
if (
  sourceInfo.size !== EXPECTED_SOURCE_SIZE ||
  sourceHashBefore !== EXPECTED_SOURCE_SHA256
) {
  throw new InputError(
    "Source video identity does not match the C6.0.1 contract.",
    {
      expectedSize: EXPECTED_SOURCE_SIZE,
      actualSize: sourceInfo.size,
      expectedSha256: EXPECTED_SOURCE_SHA256,
      actualSha256: sourceHashBefore,
    },
  );
}
const repositoryCommit = (
  await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })
).stdout.trim();
const asrCachePath = path.join(outputPath, "isolated-asr-cache");
const generationArguments = [
  "--input",
  videoPath,
  "--output",
  outputPath,
  "--language-mode",
  "ja",
  "--dialogue-language",
  "ja",
  "--primary-subtitle-language",
  "ja",
  "--guidance-mode",
  "reference-free",
  "--no-online-search",
  "--no-web-subtitle-fallback",
  "--regenerate-subtitles",
  "--transcription-provider",
  "whisper-cpp",
  "--transcription-strategy",
  "quality",
  "--coreml",
  "off",
  "--benchmark",
  "off",
  "--local-transcription-model",
  modelPath,
  "--whisper-cpp-path",
  whisperPath,
  "--whisper-execution-mode",
  "process",
  "--no-whisper-vad",
  "--asr-cache-dir",
  asrCachePath,
  "--asr-cache-mode",
  "read-write",
  "--scene-analysis",
  "observe",
  "--finalization",
  "human",
];

await mkdir(outputPath, { recursive: false });
const generatedAt = new Date().toISOString();
const manifest = await createBlindGenerationInputManifest({
  generatedAt,
  generationRunId: `c6-0-1-${runLabel.toLowerCase()}-${repositoryCommit.slice(0, 12)}`,
  sourceVideoPath: videoPath,
  repositoryCommit,
  model: { modelName, modelPath },
  runtimes: [
    {
      runtimeId: "whisper-cpp-production",
      name: "whisper.cpp",
      version: whisperVersion,
      executablePath: whisperPath,
      device,
    },
  ],
  generationArguments,
  machineMemoryStoreId: `c6-0-1-empty-memory-${runLabel.toLowerCase()}-${repositoryCommit.slice(0, 12)}`,
});
const evaluationPolicy = createC601EvaluationPolicy(generatedAt);
const machineMemoryBase = {
  schemaVersion: "1.0.0",
  artifactType: "machine-only-series-memory",
  storeId: manifest.machineMemoryInitialState.storeId,
  createdAt: generatedAt,
  entryCount: 0,
  humanDerived: false,
  entries: [],
};
await Promise.all([
  atomicWriteJson(
    path.join(outputPath, "blind-generation-input-manifest.json"),
    manifest,
  ),
  atomicWriteJson(
    path.join(outputPath, "blind-evaluation-policy.json"),
    evaluationPolicy,
  ),
  atomicWriteJson(path.join(outputPath, "machine-memory.json"), {
    ...machineMemoryBase,
    semanticHash: manifest.machineMemoryInitialState.storeHash,
  }),
]);

const generationStartedAt = new Date().toISOString();
const exitCode = await runProductionSubtitleCommand({
  argumentsList: generationArguments,
  logPath: path.join(outputPath, "blind-generation.log"),
});
const generationCompletedAt = new Date().toISOString();
if (exitCode !== 0) {
  throw new InputError("Production subtitle generation failed.", {
    exitCode,
    outputPath,
  });
}
const sourceHashAfter = await sha256BlindFile(videoPath);
if (sourceHashAfter !== sourceHashBefore) {
  throw new InputError("Source video changed during blind generation.", {
    sourceHashBefore,
    sourceHashAfter,
  });
}
await atomicWriteJson(
  path.join(outputPath, "blind-generation-execution.json"),
  {
    schemaVersion: "1.0.0",
    artifactType: "blind-generation-execution",
    generationRunId: manifest.generationRunId,
    generationStartedAt,
    generationCompletedAt,
    wallTimeMs:
      Date.parse(generationCompletedAt) - Date.parse(generationStartedAt),
    exitCode,
    sourceReadOnlyVerified: true,
    sourceHashBefore,
    sourceHashAfter,
    networkUsed: false,
    onlineSubtitleSearchUsed: false,
    cloudModelInferenceCount: 0,
  },
);
const provenance = await auditBlindRunProvenance({
  taskDirectory: outputPath,
  generatedAt: generationCompletedAt,
  manifest,
});
if (!provenance.passed) {
  throw new InputError("Blind provenance audit failed.", {
    violations: provenance.isolationViolations,
  });
}
await atomicWriteJson(
  path.join(outputPath, "blind-provenance-audit.json"),
  provenance,
);
const evidence = await buildMachineBaselineEvidenceCoverage({
  taskDirectory: outputPath,
  generatedAt: generationCompletedAt,
  manifest,
});
const shadowPolicy = createMachineShadowPolicy();
const shadow = evaluateMachineShadowFinalization({
  generatedAt: generationCompletedAt,
  manifest,
  provenance,
  evidence,
  policy: shadowPolicy,
});
await Promise.all([
  atomicWriteJson(
    path.join(outputPath, "machine-baseline-evidence-coverage.json"),
    evidence,
  ),
  atomicWriteJson(
    path.join(outputPath, "machine-shadow-finalization-policy.json"),
    shadowPolicy,
  ),
  atomicWriteJson(
    path.join(outputPath, "machine-shadow-finalization.json"),
    shadow,
  ),
]);
const freeze = await createBlindOutputFreeze({
  taskDirectory: outputPath,
  freezeTimestamp: new Date().toISOString(),
});
await atomicWriteJson(
  path.join(outputPath, "blind-output-freeze.json"),
  freeze,
);

console.log(
  JSON.stringify(
    {
      outputPath,
      generationRunId: manifest.generationRunId,
      repositoryCommit,
      sourceVideoSha256: manifest.sourceVideo.sha256,
      modelSnapshotSha256:
        manifest.genericModelSnapshots[0]?.snapshotSha256 ?? null,
      modelInferenceCount: evidence.modelExecutionCounts.modelInferenceCount,
      modelLoadCount: evidence.modelExecutionCounts.modelLoadCount,
      shadowMachineOutcome: shadow.shadowMachineOutcome,
      productionStatus: shadow.productionStatus,
      productionFinalizationMethod: shadow.productionFinalizationMethod,
      freezeHash: freeze.freezeSemanticHash,
    },
    null,
    2,
  ),
);
