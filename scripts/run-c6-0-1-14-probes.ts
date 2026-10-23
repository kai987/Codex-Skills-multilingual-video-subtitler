import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  atomicWriteJson,
  c60114PolicySchema,
  c60114PreProbeFreezeSchema,
  c60114ProbeSelectionSchema,
  c60114ProbeBudgetExceptionSchema,
} from "@mvl/shared";
import { sha256LocalFile } from "../packages/video-subtitler/src/finalization-support.js";
import { machineQualitySemanticHash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { runMissingDialogueLocalProbes } from "../packages/video-subtitler/src/review/c60114-probe-runtime.js";
import { C60114ProbeReplayError } from "../packages/video-subtitler/src/review/missing-dialogue-local-probe.js";
import { completeC60114ExtractionFailures } from "../packages/video-subtitler/src/review/c60114-probe-completion.js";

const { values } = parseArgs({
  strict: true,
  allowPositionals: false,
  options: {
    policy: { type: "string" },
    selection: { type: "string" },
    "preflight-freeze": { type: "string" },
    source: { type: "string" },
    "whisper-runtime-manifest": { type: "string" },
    "whisper-model": { type: "string" },
    "whisper-model-sha256": { type: "string" },
    "reazon-model-directory": { type: "string" },
    "reazon-python": { type: "string" },
    "output-directory": { type: "string" },
    "cache-directory": { type: "string" },
    mode: { type: "string" },
    ffmpeg: { type: "string" },
    ffprobe: { type: "string" },
    "resume-incomplete-extraction": { type: "string" },
    "budget-exception": { type: "string" },
    "loss-audit": { type: "string" },
  },
});
function required(name: keyof typeof values): string {
  const value = values[name];
  if (!value?.trim()) throw new Error(`C60114_REQUIRED_ARGUMENT:${name}`);
  return value;
}
function file(name: keyof typeof values): string {
  return path.resolve(required(name));
}
function semantic(value: { semanticHash: string }): string {
  const { semanticHash: excluded, ...rest } = value;
  void excluded;
  return machineQualitySemanticHash(rest);
}
const mode = required("mode");
if (mode !== "fresh" && mode !== "exact-cache-only")
  throw new Error("C60114_INVALID_PROBE_MODE");
const policyPath = file("policy"),
  selectionPath = file("selection"),
  freezePath = file("preflight-freeze"),
  sourcePath = file("source");
const outputDirectory = file("output-directory");
// Exclusive allocation protects upstream and previous official results. No copy,
// recursive input discovery, deletion, directory reuse, or Gold argument exists.
await mkdir(outputDirectory);
let verifiedFreeze: ReturnType<typeof c60114PreProbeFreezeSchema.parse> | null =
  null;
try {
  const [policyRaw, selectionRaw, freezeRaw] = await Promise.all([
    readFile(policyPath, "utf8"),
    readFile(selectionPath, "utf8"),
    readFile(freezePath, "utf8"),
  ]);
  const policy = c60114PolicySchema.parse(JSON.parse(policyRaw));
  const selection = c60114ProbeSelectionSchema.parse(JSON.parse(selectionRaw));
  const freeze = c60114PreProbeFreezeSchema.parse(JSON.parse(freezeRaw));
  const [policyByteHash, selectionByteHash] = await Promise.all([
    sha256LocalFile(policyPath),
    sha256LocalFile(selectionPath),
  ]);
  if (
    semantic(policy) !== policy.semanticHash ||
    semantic(selection) !== selection.semanticHash ||
    semantic(freeze) !== freeze.semanticHash ||
    freeze.policyByteHash !== policyByteHash ||
    freeze.selectionByteHash !== selectionByteHash ||
    freeze.policyHash !== policy.semanticHash ||
    selection.policyHash !== policy.semanticHash ||
    freeze.selectionHash !== selection.semanticHash ||
    machineQualitySemanticHash(freeze.sourceIdentity) !==
      machineQualitySemanticHash(selection.sourceIdentity)
  )
    throw new Error("C60114_PRE_PROBE_FREEZE_IDENTITY_MISMATCH");
  verifiedFreeze = freeze;
  await atomicWriteJson(
    path.join(outputDirectory, "probe-preflight-verification.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-probe-preflight-verification",
      policyVersion: policy.policyVersion,
      sourceIdentity: freeze.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_SECONDS",
      runtimeGoldInputCount: 0,
      freezeSemanticHash: freeze.semanticHash,
      policyByteHash,
      selectionByteHash,
      selectedTargetCount: selection.targets.length,
      verified: true,
      verifiedAt: new Date().toISOString(),
      modelConstructionStarted: false,
    },
  );
  const runInput: Parameters<typeof runMissingDialogueLocalProbes>[0] = {
    targets: selection.targets,
    sourceIdentity: selection.sourceIdentity,
    policy,
    policyHash: policy.semanticHash,
    selectionHash: selection.semanticHash,
    sourcePath,
    whisperRuntimeManifestPath: file("whisper-runtime-manifest"),
    whisperModelPath: file("whisper-model"),
    whisperModelSha256: required("whisper-model-sha256"),
    reazonModelDirectory: file("reazon-model-directory"),
    reazonPython: file("reazon-python"),
    outputDirectory,
    cacheDirectory: file("cache-directory"),
    mode,
    generatedAt: new Date().toISOString(),
    ...(values.ffmpeg ? { ffmpegPath: path.resolve(values.ffmpeg) } : {}),
    ...(values.ffprobe ? { ffprobePath: path.resolve(values.ffprobe) } : {}),
    onProgress: (progress) =>
      process.stderr.write(
        `${JSON.stringify({ stage: "c60114-local-probes", ...progress })}\n`,
      ),
  };
  const artifact = values["resume-incomplete-extraction"]
    ? await completeC60114ExtractionFailures({
        ...runInput,
        resumeIncompleteExtraction: path.resolve(
          values["resume-incomplete-extraction"],
        ),
        ...(values["budget-exception"]
          ? {
              budgetException: c60114ProbeBudgetExceptionSchema.parse(
                JSON.parse(await readFile(file("budget-exception"), "utf8")),
              ),
              lossAuditPath: file("loss-audit"),
              budgetExceptionPath: file("budget-exception"),
            }
          : {}),
      })
    : await runMissingDialogueLocalProbes(runInput);
  if (artifact.accounting.failedRequests > 0)
    throw new Error(
      `C60114_PROBE_FAILURES:${artifact.accounting.failedRequests}`,
    );
  await atomicWriteJson(path.join(outputDirectory, "probe-run-status.json"), {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-probe-run-status",
    status: "COMPLETE",
    sourceIdentity: freeze.sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS",
    runtimeGoldInputCount: 0,
    freezeSemanticHash: freeze.semanticHash,
    probeSemanticHash: artifact.semanticHash,
    accounting: artifact.accounting,
    completionMode: artifact.mode,
    ...(artifact.completion ? { completion: artifact.completion } : {}),
  });
  process.stdout.write(
    `${JSON.stringify({ ok: true, artifact: "missing-dialogue-local-probe.json", semanticHash: artifact.semanticHash, accounting: artifact.accounting })}\n`,
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message : "C60114_UNKNOWN_PROBE_ERROR";
  // Failure metadata is deliberately not a success artifact or an empty-ASR claim.
  await atomicWriteJson(
    path.join(outputDirectory, "probe-run-status.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-probe-run-status",
      status: verifiedFreeze ? "PROBE_FAILED" : "PREFLIGHT_FAILED",
      sourceIdentity: verifiedFreeze?.sourceIdentity ?? null,
      sourceTimebase: "SOURCE_GLOBAL_SECONDS",
      runtimeGoldInputCount: 0,
      freezeSemanticHash: verifiedFreeze?.semanticHash ?? null,
      errorCode: message
        .replace(/\/(?:Users|private|tmp|opt)\/[^\s]+/gu, "LOCAL_PATH_REDACTED")
        .slice(0, 1000),
      ...(error instanceof C60114ProbeReplayError
        ? { accounting: error.artifact.accounting }
        : {}),
    },
    { overwrite: true },
  );
  throw error;
}
