import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  NodeProcessRunner,
  atomicWriteJson,
  mvlWhisperServerResponseSchema,
  subtitleOverlapAcousticResolutionSchema,
  whisperExecutionMetricsSchema,
  whisperRuntimeBuildManifestSchema,
  type OverlapAcousticAttempt,
  type OverlapAcousticProfile,
  type WhisperModelCapability,
} from "@mvl/shared";
import {
  WhisperCppWorkerPool,
  createWhisperCppAdapterForCapability,
} from "@mvl/transcription-core";
import { locateSubtitlePackage, sha256LocalFile } from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    standard: { type: "string" },
    adversarial: { type: "string" },
    output: { type: "string" },
    "whisper-server-path": { type: "string" },
    "runtime-capability-manifest": { type: "string" },
    model: { type: "string" },
    "vad-model": { type: "string" },
  },
  strict: true,
});

if (values.standard === undefined || values.adversarial === undefined) {
  throw new InputError(
    "Usage: npm run verify:c5-16-1-worker-state-isolation -- --standard <standard-task> --adversarial <adversarial-task> [--whisper-server-path <patched-server> --runtime-capability-manifest <manifest> --model <large-v3> --vad-model <silero>]",
  );
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function attemptView(attempt: OverlapAcousticAttempt) {
  return {
    normalizedText: normalizedText(attempt.rawText),
    decodedSegments: attempt.segments.map((segment) => ({
      text: normalizedText(segment.text),
      start: rounded(segment.start),
      end: rounded(segment.end),
    })),
    rawGroupedWords: (attempt.rawTokens ?? []).map((token) => ({
      text: token.text,
      start: rounded(token.start),
      end: rounded(token.end),
      coordinateSystem: token.coordinateSystem,
    })),
    mappedTokens: (attempt.mappedTokens ?? []).map((token) => ({
      text: token.text,
      start: rounded(token.start),
      end: rounded(token.end),
      coordinateSystem: token.coordinateSystem,
      mappingMethod: token.mappingMethod,
    })),
    rawVadIntervals: (attempt.rawVadIntervals ?? []).map((interval) => ({
      rawStart: rounded(interval.rawStart ?? interval.start),
      rawEnd: rounded(interval.rawEnd ?? interval.end),
      normalizedStart: rounded(
        interval.normalizedStart ?? interval.rawStart ?? interval.start,
      ),
      normalizedEnd: rounded(
        interval.normalizedEnd ?? interval.rawEnd ?? interval.end,
      ),
      normalizationApplied: interval.normalizationApplied ?? false,
      healthStatus:
        interval.healthStatus ??
        interval.rawVadIntervalHealthStatus ??
        "unavailable",
    })),
    language: attempt.language,
    requestConfiguration: {
      useVad: attempt.useVad,
      vadProfile: attempt.vadProfile,
      model: attempt.model,
      modelHash: attempt.modelHash,
      coreML: attempt.coreML,
      responseSchemaVersion: attempt.responseSchemaVersion ?? null,
      targetCueTextUsedAsPrompt: attempt.targetCueTextUsedAsPrompt,
      referenceTranslationUsedAsPrompt:
        attempt.referenceTranslationUsedAsPrompt,
      humanReviewedSentenceUsedAsPrompt:
        attempt.humanReviewedSentenceUsedAsPrompt,
    },
    promptHash: attempt.promptSha256,
  };
}

async function loadRun(task: string) {
  const located = await locateSubtitlePackage(path.resolve(task));
  const overlapPath = path.join(
    located.subtitleDirectory,
    "subtitle-overlap-acoustic-resolution.json",
  );
  const metricsPath = path.join(
    located.subtitleDirectory,
    "overlap-whisper-execution-metrics.json",
  );
  return {
    taskRoot: path.resolve(task),
    subtitleDirectory: located.subtitleDirectory,
    overlapPath,
    metricsPath,
    overlap: subtitleOverlapAcousticResolutionSchema.parse(
      JSON.parse(await readFile(overlapPath, "utf8")) as unknown,
    ),
    metrics: whisperExecutionMetricsSchema.parse(
      JSON.parse(await readFile(metricsPath, "utf8")) as unknown,
    ),
  };
}

const [standard, adversarial] = await Promise.all([
  loadRun(values.standard),
  loadRun(values.adversarial),
]);
const standardByKey = new Map(
  standard.overlap.attempts.map((attempt) => [
    `${attempt.componentId}:${attempt.profile}`,
    attempt,
  ]),
);
const adversarialByKey = new Map(
  adversarial.overlap.attempts.map((attempt) => [
    `${attempt.componentId}:${attempt.profile}`,
    attempt,
  ]),
);
const keys = [
  ...new Set([...standardByKey.keys(), ...adversarialByKey.keys()]),
].toSorted();
const pairs = keys.map((key) => {
  const baseline = standardByKey.get(key);
  const challenged = adversarialByKey.get(key);
  if (baseline === undefined || challenged === undefined) {
    return {
      key,
      presentInBoth: false,
      normalizedTextParity: false,
      decodedSegmentParity: false,
      rawGroupedWordParity: false,
      mappedTokenSemanticParity: false,
      rawVadSemanticParity: false,
      languageParity: false,
      requestConfigurationParity: false,
      promptParity: false,
    };
  }
  const left = attemptView(baseline);
  const right = attemptView(challenged);
  return {
    key,
    presentInBoth: true,
    normalizedTextParity: left.normalizedText === right.normalizedText,
    decodedSegmentParity:
      stable(left.decodedSegments) === stable(right.decodedSegments),
    rawGroupedWordParity:
      stable(left.rawGroupedWords) === stable(right.rawGroupedWords),
    mappedTokenSemanticParity:
      stable(left.mappedTokens) === stable(right.mappedTokens),
    rawVadSemanticParity:
      stable(left.rawVadIntervals) === stable(right.rawVadIntervals),
    languageParity: left.language === right.language,
    requestConfigurationParity:
      stable(left.requestConfiguration) === stable(right.requestConfiguration),
    promptParity: left.promptHash === right.promptHash,
  };
});

const runtimeInputs = [
  values["whisper-server-path"],
  values["runtime-capability-manifest"],
  values.model,
  values["vad-model"],
];
if (
  runtimeInputs.some((value) => value !== undefined) &&
  runtimeInputs.some((value) => value === undefined)
) {
  throw new InputError(
    "Clean-context verification requires server, runtime manifest, model, and VAD model together.",
  );
}

async function runCleanSpotCheck(): Promise<{
  passed: boolean | null;
  checks: {
    key: string;
    parityPassed: boolean;
    workerStartCount: number;
    modelLoadCount: number;
  }[];
}> {
  const [serverInput, manifestInput, modelInput, vadModelInput] = runtimeInputs;
  if (serverInput === undefined) return { passed: null, checks: [] };
  if (
    manifestInput === undefined ||
    modelInput === undefined ||
    vadModelInput === undefined
  ) {
    throw new InputError("Clean-context runtime inputs are incomplete.");
  }
  const serverPath = path.resolve(serverInput);
  const manifestPath = path.resolve(manifestInput);
  const modelPath = path.resolve(modelInput);
  const vadModelPath = path.resolve(vadModelInput);
  const manifest = whisperRuntimeBuildManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  const [serverHash, modelHash] = await Promise.all([
    sha256LocalFile(serverPath),
    sha256LocalFile(modelPath),
  ]);
  if (serverHash !== manifest.patched.binarySha256) {
    throw new InputError("Clean-context server does not match the manifest.");
  }
  const capability: WhisperModelCapability = {
    id: `large-v3-cpu-${modelHash.slice(0, 12)}`,
    modelPath,
    modelHash,
    modelFamily: "large-v3",
    runtime: "cpu",
    qualityTier: "maximum",
    quantization: null,
    coreML: {
      supported: false,
      status: "disabled-by-user",
      deviceCapable: process.platform === "darwin",
      whisperCppCompiledWithCoreML: false,
      encoderAvailable: false,
      encoderPath: null,
      runtimeValidated: false,
      reason: "Clean-context parity intentionally uses the CPU runtime.",
    },
    estimatedMemoryBytes: null,
    roles: ["refinement"],
  };
  const expectedRuntime = {
    upstreamCommit: manifest.upstream.commit,
    patchId: manifest.patch.patchId,
    patchSha256: manifest.patch.patchSha256,
    binarySha256: manifest.patched.binarySha256,
    buildFlagsHash: manifest.build.flagsHash,
  };
  const targetProfiles: OverlapAcousticProfile[] = [
    "no-vad",
    "current-sensitive-vad",
  ];
  const checks = [];
  for (const profile of targetProfiles) {
    const expected = standard.overlap.attempts.find(
      (attempt) => attempt.profile === profile,
    );
    if (expected === undefined) {
      throw new InputError(`Missing clean spot-check profile ${profile}.`);
    }
    const component = standard.overlap.components.find(
      (item) => item.componentId === expected.componentId,
    );
    if (component?.audioPath === null || component?.audioPath === undefined) {
      throw new InputError(`Missing component audio for ${profile}.`);
    }
    const useVad = profile !== "no-vad";
    const workerPool = new WhisperCppWorkerPool({
      mode: "persistent",
      stateIsolation: "require-safe",
    });
    const adapter = await createWhisperCppAdapterForCapability({
      capability,
      executablePath: serverPath,
      runner: new NodeProcessRunner(),
      whisperCppVersion: "1.9.3",
      vadModelPath,
      useVad,
      vadProfile:
        profile === "extra-sensitive-vad"
          ? "extra-sensitive-v1"
          : "sensitive-v2",
      logicalCores: 8,
      tokenTimestampsAvailable: true,
      fullJsonAvailable: true,
      workerPool,
      serverPath,
      timestampRuntimePolicy: "require-mapped",
      rawVadPolicy: "required",
      mvlResponseSchemaVersion: "mvl-whisper-server-response/1.0.0",
      expectedMvlRuntime: expectedRuntime,
    });
    const duration =
      component.actualAudioDurationSeconds ?? component.audioDurationSeconds;
    if (duration === null) {
      throw new InputError(`Missing measured audio duration for ${profile}.`);
    }
    const result = await adapter.transcribe({
      audioPath: path.join(standard.subtitleDirectory, component.audioPath),
      chunk: {
        id: `clean-${component.componentId}-${profile}`,
        relativePath: component.audioPath,
        start: component.extractionInterval.start,
        end: component.extractionInterval.end,
        duration,
        sha256: component.audioSha256 ?? "0".repeat(64),
      },
      language: "ja",
      timestampStrategy: "segment",
      tokenTimestamps: true,
    });
    await workerPool.close();
    const raw = result.raw as { mvlResponse?: unknown };
    const response = mvlWhisperServerResponseSchema.parse(raw.mvlResponse);
    const expectedView = attemptView(expected);
    const cleanView = {
      normalizedText: normalizedText(response.text),
      decodedSegments: response.transcription.map((segment) => ({
        text: normalizedText(segment.text),
        start: rounded(
          component.extractionInterval.start + segment.startSeconds,
        ),
        end: rounded(component.extractionInterval.start + segment.endSeconds),
      })),
      rawGroupedWords: response.transcription.flatMap((segment) =>
        segment.words.flatMap((word) =>
          word.rawStartCentiseconds === null || word.rawEndCentiseconds === null
            ? []
            : [
                {
                  text: word.word,
                  start: rounded(word.rawStartCentiseconds * 0.01),
                  end: rounded(word.rawEndCentiseconds * 0.01),
                  coordinateSystem: useVad
                    ? "vad-processed-local"
                    : "original-audio-local",
                },
              ],
        ),
      ),
      mappedTokens: response.transcription.flatMap((segment) =>
        segment.words.flatMap((word) =>
          word.mappedStartCentiseconds === null ||
          word.mappedEndCentiseconds === null
            ? []
            : [
                {
                  text: word.word,
                  start: rounded(
                    component.extractionInterval.start +
                      word.mappedStartCentiseconds * 0.01,
                  ),
                  end: rounded(
                    component.extractionInterval.start +
                      word.mappedEndCentiseconds * 0.01,
                  ),
                  coordinateSystem: "original-media-global",
                  mappingMethod: "official-mapped-token-getter",
                },
              ],
        ),
      ),
      rawVadIntervals: response.vad_segments.map((interval) => ({
        rawStart: rounded(interval.startSeconds),
        rawEnd: rounded(interval.endSeconds),
      })),
    };
    const expectedRawVad = expectedView.rawVadIntervals.map((interval) => ({
      rawStart: interval.rawStart,
      rawEnd: interval.rawEnd,
    }));
    const parityPassed =
      cleanView.normalizedText === expectedView.normalizedText &&
      stable(cleanView.decodedSegments) ===
        stable(expectedView.decodedSegments) &&
      stable(cleanView.rawGroupedWords) ===
        stable(expectedView.rawGroupedWords) &&
      stable(cleanView.mappedTokens) === stable(expectedView.mappedTokens) &&
      stable(cleanView.rawVadIntervals) === stable(expectedRawVad);
    const metrics = workerPool.metrics();
    checks.push({
      key: `${component.componentId}:${profile}`,
      parityPassed,
      workerStartCount: metrics.workerStartCount,
      modelLoadCount: metrics.modelLoadCount,
    });
  }
  return { passed: checks.every((check) => check.parityPassed), checks };
}

const clean = await runCleanSpotCheck();
const allParityPassed =
  pairs.length === 21 &&
  pairs.every(
    (pair) =>
      pair.presentInBoth &&
      pair.normalizedTextParity &&
      pair.decodedSegmentParity &&
      pair.rawGroupedWordParity &&
      pair.mappedTokenSemanticParity &&
      pair.rawVadSemanticParity &&
      pair.languageParity &&
      pair.requestConfigurationParity &&
      pair.promptParity,
  );
const requestOrderIndependencePassed = allParityPassed;
const cleanProcessParityPassed = clean.passed;
const outputPath = path.resolve(
  values.output ??
    path.join(
      adversarial.taskRoot,
      "c5-16-1-worker-state-isolation-verification.json",
    ),
);
const artifact = {
  schemaVersion: "1.0.0",
  artifactType: "c5-16-1-worker-state-isolation-verification",
  generatedAt: new Date().toISOString(),
  policyVersion: "c5.16.1-worker-state-isolation-v1",
  standardTaskName: path.basename(standard.taskRoot),
  adversarialTaskName: path.basename(adversarial.taskRoot),
  standardRequestOrderHash: standard.metrics.requestOrderHash ?? null,
  adversarialRequestOrderHash: adversarial.metrics.requestOrderHash ?? null,
  pairs,
  cleanProcessChecks: clean.checks,
  summary: {
    pairCount: pairs.length,
    normalizedTextParityCount: pairs.filter((pair) => pair.normalizedTextParity)
      .length,
    decodedSegmentParityCount: pairs.filter((pair) => pair.decodedSegmentParity)
      .length,
    rawGroupedWordParityCount: pairs.filter((pair) => pair.rawGroupedWordParity)
      .length,
    mappedTokenSemanticParityCount: pairs.filter(
      (pair) => pair.mappedTokenSemanticParity,
    ).length,
    rawVadSemanticParityCount: pairs.filter((pair) => pair.rawVadSemanticParity)
      .length,
    requestConfigurationParityCount: pairs.filter(
      (pair) => pair.requestConfigurationParity,
    ).length,
    requestOrderIndependencePassed,
    cleanProcessParityPassed,
    unsafeWorkerTransitionCount:
      adversarial.metrics.unsafeWorkerTransitionCount ?? 0,
    preventedUnsafeTransitionCount:
      adversarial.metrics.preventedUnsafeTransitionCount ?? 0,
    workerRestartCount: adversarial.metrics.workerRestartCount ?? 0,
  },
  verificationHash: hash({ pairs, clean: clean.checks }),
};
await atomicWriteJson(outputPath, artifact, { overwrite: true });
for (const run of [standard, adversarial]) {
  const updatedMetrics = whisperExecutionMetricsSchema.parse({
    ...run.metrics,
    requestOrderIndependencePassed,
    cleanProcessParityPassed,
  });
  await atomicWriteJson(run.metricsPath, updatedMetrics, { overwrite: true });
  const localSummaryPath = path.join(
    run.taskRoot,
    "c5-16-1-runtime-stabilization-replay-summary.json",
  );
  const localSummary = JSON.parse(
    await readFile(localSummaryPath, "utf8"),
  ) as Record<string, unknown>;
  const execution =
    typeof localSummary.execution === "object" &&
    localSummary.execution !== null &&
    !Array.isArray(localSummary.execution)
      ? (localSummary.execution as Record<string, unknown>)
      : {};
  await atomicWriteJson(
    localSummaryPath,
    {
      ...localSummary,
      execution: { ...execution, executionMetrics: updatedMetrics },
    },
    { overwrite: true },
  );
}
process.stdout.write(
  `${JSON.stringify(
    {
      ok: requestOrderIndependencePassed && cleanProcessParityPassed === true,
      outputPath,
      summary: artifact.summary,
    },
    null,
    2,
  )}\n`,
);
if (!(requestOrderIndependencePassed && cleanProcessParityPassed === true)) {
  process.exitCode = 1;
}
