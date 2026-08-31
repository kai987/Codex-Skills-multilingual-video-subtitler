import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  c516StockPatchedRuntimeAbArtifactSchema,
  timestampIntegrityIntervalSchema,
} from "@mvl/shared";
import {
  auditTimestampEvidenceAttempt,
  WhisperCppWorkerPool,
  type WhisperWorker,
  type WhisperWorkerCapability,
  type WhisperWorkerFactory,
} from "@mvl/transcription-core";
import {
  measureWavDurationFromBuffer,
  migrateC516AbMetricSemantics,
  sanitizeShareableValue,
  scanShareableValue,
  shareablePathLeakReasons,
} from "@mvl/video-subtitler";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const COMMIT = "371b5a7561823ab2bb32142d2751e35e7534727b";
const PATCH_SHA =
  "bba39640e7005a1fdeb62c549d04ba76b6fc0d8aedae43daf9c9de1ab10a735d";

function rawVadAudit(input: {
  rawStart: number;
  rawEnd: number;
  nominalDuration?: number;
  actualDuration?: number;
  tolerance?: number;
}) {
  const nominalDuration = input.nominalDuration ?? 10;
  return auditTimestampEvidenceAttempt({
    attemptId: "boundary-attempt",
    profile: "current-sensitive-vad",
    useVad: true,
    extractionInterval: { start: 100, end: 100 + nominalDuration },
    segments: [],
    rawVadIntervals: [
      {
        intervalId: "raw-vad-1",
        start: input.rawStart,
        end: input.rawEnd,
        coordinateSystem: "original-audio-local",
      },
    ],
    tokenTimestampsRequested: true,
    tokenTimestampPolicy: "mapped-only",
    mappedTokenGetterActuallyUsed: true,
    actualAudioDurationSeconds: input.actualDuration ?? nominalDuration,
    durationMeasurementMethod: "wav-frame-count/sample-rate",
    configuration: {
      rawVadBoundaryNormalizationToleranceSeconds: input.tolerance ?? 0.05,
    },
  });
}

function rawVadEvaluation(result: ReturnType<typeof rawVadAudit>) {
  const evaluation = result.integrity.rawVadEvaluations?.[0];
  if (evaluation === undefined) throw new Error("missing Raw VAD evaluation");
  return evaluation;
}

function pcmWav(frameCount: number, sampleRate = 16_000): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const dataBytes = frameCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

describe("C5.16.1 Raw VAD boundary tolerance", () => {
  it("keeps an in-range interval fully trusted", () => {
    const evaluation = rawVadEvaluation(
      rawVadAudit({ rawStart: 0.2, rawEnd: 9.8 }),
    );
    expect(evaluation).toMatchObject({
      rawStart: 0.2,
      rawEnd: 9.8,
      normalizedStart: 0.2,
      normalizedEnd: 9.8,
      normalizationApplied: false,
      healthStatus: "trusted",
      timingTrustScore: 1,
      timingUsable: true,
    });
  });

  it.each([0.01, 0.03, 0.05])(
    "normalizes an end overrun of %ss and preserves the raw interval",
    (delta) => {
      const result = rawVadAudit({ rawStart: 1, rawEnd: 10 + delta });
      const evaluation = rawVadEvaluation(result);
      expect(evaluation.rawStart).toBe(1);
      expect(evaluation.rawEnd).toBeCloseTo(10 + delta, 8);
      expect(evaluation.normalizedStart).toBe(1);
      expect(evaluation.normalizedEnd).toBe(10);
      expect(evaluation.normalizationDeltaEnd).toBeCloseTo(delta, 8);
      expect(evaluation.healthStatus).toBe(
        "trusted-with-boundary-normalization",
      );
      expect(evaluation.timingTrustScore).toBeGreaterThanOrEqual(0.8);
      expect(evaluation.timingTrustScore).toBeLessThan(1);
      expect(result.rawVadIntervals[0]).toMatchObject({
        rawStart: 1,
        rawEnd: 10 + delta,
        normalizedStart: 1,
        normalizedEnd: 10,
        normalizationApplied: true,
        start: 101,
        end: 110,
        timingUsable: true,
      });
    },
  );

  it("quarantines an end overrun of 51ms", () => {
    const result = rawVadAudit({ rawStart: 1, rawEnd: 10.051 });
    expect(rawVadEvaluation(result).healthStatus).toBe("out-of-range");
    expect(result.rawVadIntervals).toEqual([]);
  });

  it.each([0.01, 0.03])("normalizes a start underrun of %ss", (delta) => {
    const evaluation = rawVadEvaluation(
      rawVadAudit({ rawStart: -delta, rawEnd: 2 }),
    );
    expect(evaluation.normalizedStart).toBe(0);
    expect(evaluation.normalizationDeltaStart).toBeCloseTo(delta, 8);
    expect(evaluation.healthStatus).toBe("trusted-with-boundary-normalization");
  });

  it("normalizes both boundaries when both overruns remain in tolerance", () => {
    const evaluation = rawVadEvaluation(
      rawVadAudit({ rawStart: -0.03, rawEnd: 10.02 }),
    );
    expect(evaluation).toMatchObject({
      normalizedStart: 0,
      normalizedEnd: 10,
      normalizationDeltaStart: 0.03,
      normalizationDeltaEnd: 0.02,
      normalizationReason:
        "RAW_VAD_BOTH_AUDIO_BOUNDARIES_EXCEEDED_WITHIN_TOLERANCE",
      healthStatus: "trusted-with-boundary-normalization",
    });
  });

  it("rejects tolerance above the 100ms hard maximum", () => {
    expect(() =>
      rawVadAudit({
        rawStart: 0,
        rawEnd: 10.05,
        tolerance: 0.101,
      }),
    ).toThrow(/cannot exceed 0\.1/u);
  });

  it.each([
    { label: "reverse", start: 2, end: 1, expected: "invalid" },
    { label: "non-finite", start: 1, end: Number.NaN, expected: "invalid" },
    { label: "outside", start: -0.01, end: 0, expected: "out-of-range" },
    { label: "large-overrun", start: 1, end: 10.2, expected: "out-of-range" },
  ])("quarantines $label intervals", ({ start, end, expected }) => {
    const result = rawVadAudit({ rawStart: start, rawEnd: end });
    expect(rawVadEvaluation(result).healthStatus).toBe(expected);
    expect(result.rawVadIntervals).toEqual([]);
    expect(result.integrity.attemptMetrics.rawVadInvalidIntervalCount).toBe(1);
  });

  it("uses actual WAV duration instead of nominal duration", () => {
    const result = rawVadAudit({
      rawStart: 1,
      rawEnd: 10,
      nominalDuration: 10,
      actualDuration: 9.98,
    });
    const evaluation = rawVadEvaluation(result);
    expect(result.integrity).toMatchObject({
      nominalDurationSeconds: 10,
      actualAudioDurationSeconds: 9.98,
      durationDifferenceSeconds: -0.02,
    });
    expect(evaluation.normalizedEnd).toBe(9.98);
    expect(evaluation.normalizationDeltaEnd).toBe(0.02);
  });

  it("derives exact duration from WAV frame count and sample rate", () => {
    const measurement = measureWavDurationFromBuffer(pcmWav(159_680));
    expect(measurement).toMatchObject({
      frameCount: 159_680,
      sampleRate: 16_000,
      channels: 1,
      blockAlign: 2,
      durationSeconds: 9.98,
    });
  });

  it("upgrades a parseable C5.16 Raw VAD interval with conservative defaults", () => {
    const parsed = timestampIntegrityIntervalSchema.parse({
      intervalId: "legacy-raw-vad",
      source: "raw-vad",
      coordinateSystem: "original-media-global",
      start: 101,
      end: 102,
      timingUsable: true,
      rawStart: 1,
      rawEnd: 2,
      rawCoordinateSystem: "original-audio-local",
      mappingMethod: "verified-original-audio-local-offset",
      rawVadIntervalHealthStatus: "trusted",
    });
    expect(parsed).toMatchObject({
      normalizedStart: 1,
      normalizedEnd: 2,
      normalizationApplied: false,
      normalizationDeltaStart: 0,
      normalizationDeltaEnd: 0,
      healthStatus: "trusted",
    });
  });
});

interface MockFactoryState {
  created: {
    worker: WhisperWorker;
    modes: ("vad" | "no-vad")[];
    closed: boolean;
  }[];
  unsafeExecuted: number;
  resetCalls: number;
}

function mockFactory(
  input: {
    verifiedReset?: boolean;
    resetResult?: boolean;
    failFirstRequest?: boolean;
    serverAvailable?: boolean;
  } = {},
): { factory: WhisperWorkerFactory; state: MockFactoryState } {
  const state: MockFactoryState = {
    created: [],
    unsafeExecuted: 0,
    resetCalls: 0,
  };
  let failFirstRequest = input.failFirstRequest ?? false;
  const factory: WhisperWorkerFactory = {
    supportsVerifiedStateReset: input.verifiedReset ?? false,
    serverPathFor() {
      return Promise.resolve(
        input.serverAvailable === false ? null : "/runtime/server",
      );
    },
    create({ batchKey, mode }) {
      let requestCount = 0;
      let seenVad = false;
      const record = {
        worker: null as unknown as WhisperWorker,
        modes: [] as ("vad" | "no-vad")[],
        closed: false,
      };
      const worker: WhisperWorker = {
        batchKey,
        mode,
        backend: "cpu",
        initialize() {
          return Promise.resolve();
        },
        transcribe(request) {
          const currentMode = request.capability.useVad ? "vad" : "no-vad";
          if (failFirstRequest) {
            failFirstRequest = false;
            if (currentMode === "vad") seenVad = true;
            throw new Error("synthetic first-request failure");
          }
          if (seenVad && currentMode === "no-vad") {
            state.unsafeExecuted += 1;
            throw new Error("unsafe VAD-to-no-VAD request reached worker");
          }
          seenVad ||= currentMode === "vad";
          requestCount += 1;
          record.modes.push(currentMode);
          return Promise.resolve({
            text: `${request.request.chunk.id}:${currentMode}`,
            segments: [],
            raw: { mode: currentMode },
          });
        },
        resetState() {
          state.resetCalls += 1;
          if (input.resetResult === false) return Promise.resolve(false);
          seenVad = false;
          return Promise.resolve(true);
        },
        healthCheck() {
          return Promise.resolve(true);
        },
        close() {
          record.closed = true;
          return Promise.resolve();
        },
        metrics() {
          return {
            requestCount,
            warmupCount: 0,
            initializationSeconds: 0,
            modelLoadSeconds: 0,
            coreMLWarmupSeconds: 0,
            transcriptionSeconds: 0,
            exitReason: null,
          };
        },
      };
      record.worker = worker;
      state.created.push(record);
      return worker;
    },
  };
  return { factory, state };
}

function capability(useVad: boolean): WhisperWorkerCapability {
  return {
    executablePath: "/runtime/server",
    serverPath: "/runtime/server",
    modelPath: "/models/large-v3.bin",
    modelHash: HASH_A,
    whisperCppVersion: "1.9.3",
    coreML: false,
    threads: 8,
    language: "ja",
    vadModelPath: "/models/silero.bin",
    useVad,
    vadProfile: "sensitive-v2",
    tokenTimestamps: true,
    promptConstraint: "none",
  };
}

function request(id: string) {
  return {
    audioPath: "/audio/component.wav",
    chunk: {
      id,
      relativePath: "audio/component.wav",
      start: 0,
      end: 1,
      duration: 1,
      sha256: HASH_A,
    },
    language: "ja" as const,
    timestampStrategy: "segment" as const,
    tokenTimestamps: true,
  };
}

async function runMode(
  pool: WhisperCppWorkerPool,
  id: string,
  useVad: boolean,
) {
  return await pool.transcribe({
    request: request(id),
    capability: capability(useVad),
    initialPrompt: null,
    processFallback: () =>
      Promise.resolve({
        text: "fallback",
        segments: [],
        raw: null,
      }),
  });
}

describe("C5.16.1 persistent worker state isolation", () => {
  it("C601141 honors an explicit no-retry budget without restart or fallback", async () => {
    const fixture = mockFactory({ failFirstRequest: true });
    const pool = new WhisperCppWorkerPool({
      mode: "persistent",
      stateIsolation: "require-safe",
      factory: fixture.factory,
      retryOnFailure: false,
    });
    await expect(runMode(pool, "bounded-no-retry", false)).rejects.toThrow(
      "retry explicitly disabled",
    );
    expect(fixture.state.created).toHaveLength(1);
    expect(pool.metrics().workerRestartCount).toBe(0);
    expect(pool.metrics().fallbackProcessCount).toBe(0);
    expect(pool.metrics().requests[0]?.retryCount).toBe(0);
    expect(fixture.state.created[0]?.closed).toBe(true);
    await pool.close();
  });
  it("keeps no-VAD to VAD, VAD to VAD, and no-VAD to no-VAD efficient", async () => {
    const fixture = mockFactory();
    const pool = new WhisperCppWorkerPool({
      mode: "persistent",
      stateIsolation: "require-safe",
      factory: fixture.factory,
    });
    await runMode(pool, "no-1", false);
    await runMode(pool, "no-2", false);
    await runMode(pool, "vad-1", true);
    await runMode(pool, "vad-2", true);
    const metrics = pool.metrics();
    expect(metrics.workerStartCount).toBe(1);
    expect(metrics.modelLoadCount).toBe(1);
    expect(metrics.workerRestartCount).toBe(0);
    expect(fixture.state.unsafeExecuted).toBe(0);
    await pool.close();
  });

  it("restarts before a VAD to no-VAD request reaches a stale context", async () => {
    const fixture = mockFactory();
    const pool = new WhisperCppWorkerPool({
      mode: "persistent",
      stateIsolation: "restart-on-transition",
      factory: fixture.factory,
    });
    await runMode(pool, "vad", true);
    await runMode(pool, "no-vad", false);
    const metrics = pool.metrics();
    expect(metrics).toMatchObject({
      requestStateIsolationStrategy: "restart-on-vad-to-no-vad",
      unsafeTransitionCount: 1,
      unsafeWorkerTransitionCount: 0,
      preventedUnsafeTransitionCount: 1,
      preventedUnsafeWorkerTransitionCount: 1,
      workerRestartCount: 1,
      workerStateResetCount: 0,
      workerStartCount: 2,
      modelLoadCount: 2,
    });
    expect(metrics.requestOrderPlan?.[1]).toMatchObject({
      vadMode: "no-vad",
      contextGeneration: 2,
      isolationAction: "restart",
    });
    expect(fixture.state.unsafeExecuted).toBe(0);
    await pool.close();
  });

  it("uses a verified reset without starting a second worker", async () => {
    const fixture = mockFactory({ verifiedReset: true });
    const pool = new WhisperCppWorkerPool({
      mode: "persistent",
      stateIsolation: "auto",
      factory: fixture.factory,
    });
    await runMode(pool, "vad", true);
    await runMode(pool, "no-vad", false);
    const metrics = pool.metrics();
    expect(metrics).toMatchObject({
      requestStateIsolationStrategy: "verified-per-request-reset",
      preventedUnsafeTransitionCount: 1,
      workerRestartCount: 0,
      workerStateResetCount: 2,
      workerStartCount: 1,
      modelLoadCount: 1,
    });
    expect(metrics.requestOrderPlan?.[0]?.isolationAction).toBe("reset");
    expect(metrics.requestOrderPlan?.[1]?.isolationAction).toBe("reset");
    expect(fixture.state.resetCalls).toBe(2);
    expect(fixture.state.unsafeExecuted).toBe(0);
    await pool.close();
  });

  it("fails closed when a claimed reset cannot prove state cleanup", async () => {
    const fixture = mockFactory({ verifiedReset: true, resetResult: false });
    const pool = new WhisperCppWorkerPool({
      mode: "persistent",
      stateIsolation: "require-safe",
      factory: fixture.factory,
    });
    await expect(runMode(pool, "vad", true)).rejects.toThrow(/did not prove/u);
    expect(fixture.state.unsafeExecuted).toBe(0);
    expect(pool.metrics().unsafeWorkerTransitionCount).toBe(0);
    await pool.close();
  });

  it("routes VAD and no-VAD through at most two segregated workers", async () => {
    const fixture = mockFactory();
    const pool = new WhisperCppWorkerPool({
      mode: "persistent",
      stateIsolation: "segregated",
      factory: fixture.factory,
    });
    await runMode(pool, "vad-1", true);
    await runMode(pool, "no-1", false);
    await runMode(pool, "vad-2", true);
    await runMode(pool, "no-2", false);
    const metrics = pool.metrics();
    expect(metrics).toMatchObject({
      requestStateIsolationStrategy: "mode-segregated-workers",
      workerStartCount: 2,
      modelLoadCount: 2,
      modeSegregatedWorkerCount: 2,
      workerRestartCount: 0,
      unsafeWorkerTransitionCount: 0,
    });
    expect(fixture.state.unsafeExecuted).toBe(0);
    await pool.close();
  });

  it("isolates a retry context before a later mode change", async () => {
    const fixture = mockFactory({ failFirstRequest: true });
    const pool = new WhisperCppWorkerPool({
      mode: "persistent",
      stateIsolation: "require-safe",
      factory: fixture.factory,
    });
    await runMode(pool, "vad", true);
    await runMode(pool, "no-vad", false);
    const metrics = pool.metrics();
    expect(metrics.workerRestartCount).toBe(2);
    expect(metrics.preventedUnsafeTransitionCount).toBe(1);
    expect(metrics.workerStartCount).toBe(3);
    expect(metrics.workers.map((worker) => worker.contextGeneration)).toEqual([
      1, 2, 3,
    ]);
    expect(fixture.state.unsafeExecuted).toBe(0);
    await pool.close();
  });

  it("produces order-independent results for interleaved components", async () => {
    async function execute(order: [string, boolean][]) {
      const fixture = mockFactory();
      const pool = new WhisperCppWorkerPool({
        mode: "persistent",
        stateIsolation: "require-safe",
        factory: fixture.factory,
      });
      const outputs = new Map<string, string>();
      for (const [id, useVad] of order) {
        const result = await runMode(pool, id, useVad);
        outputs.set(`${id}:${useVad ? "vad" : "no-vad"}`, result.text);
      }
      const metrics = pool.metrics();
      await pool.close();
      return { outputs: [...outputs].toSorted(), metrics, fixture };
    }
    const standard = await execute([
      ["component-a", false],
      ["component-b", false],
      ["component-a", true],
      ["component-b", true],
    ]);
    const adversarial = await execute([
      ["component-a", true],
      ["component-a", false],
      ["component-b", true],
      ["component-b", false],
    ]);
    expect(adversarial.outputs).toEqual(standard.outputs);
    expect(adversarial.metrics.preventedUnsafeTransitionCount).toBe(2);
    expect(adversarial.fixture.state.unsafeExecuted).toBe(0);
  });

  it("fails closed when persistent mode has no server", async () => {
    const fixture = mockFactory({ serverAvailable: false });
    const pool = new WhisperCppWorkerPool({
      mode: "persistent",
      stateIsolation: "require-safe",
      factory: fixture.factory,
    });
    await expect(runMode(pool, "no-server", false)).rejects.toThrow(
      /unavailable/u,
    );
    expect(fixture.state.created).toHaveLength(0);
  });

  it("records cache hits without starting or loading a worker", () => {
    const fixture = mockFactory();
    const pool = new WhisperCppWorkerPool({ factory: fixture.factory });
    pool.recordCacheHit({
      requestKey: "component:no-vad",
      useVad: false,
      profile: "no-vad",
    });
    expect(pool.metrics()).toMatchObject({
      asrRequestCount: 0,
      cacheHitCount: 1,
      workerStartCount: 0,
      modelLoadCount: 0,
      unsafeWorkerTransitionCount: 0,
    });
  });
});

function legacyAb(equal = true) {
  const failures = equal ? [] : ["RAW_GROUPED_WORD_MISMATCH"];
  return {
    schemaVersion: "1.0.0",
    artifactType: "c5-16-stock-patched-runtime-ab",
    generatedAt: "2026-08-25T00:00:00.000Z",
    upstream: {
      repository: "ggml-org/whisper.cpp",
      tag: "v1.9.3",
      commit: COMMIT,
      sourceTree: "d".repeat(40),
    },
    build: {
      buildIdentityHash: HASH_A,
      buildFlagsHash: HASH_A,
      stockBinarySha256: HASH_A,
      patchedBinarySha256: HASH_B,
      patchSha256: PATCH_SHA,
      sameSource: true,
      sameBuildConfiguration: true,
    },
    modelSha256: HASH_A,
    vadModelSha256: HASH_B,
    requestPairs: [
      {
        componentId: "component-1",
        profile: "current-sensitive-vad",
        audioSha256: HASH_A,
        requestConfigHash: HASH_A,
        stockTextHash: HASH_A,
        patchedTextHash: HASH_A,
        textEqual: true,
        stockSegmentHash: HASH_A,
        patchedSegmentHash: HASH_A,
        segmentsEqual: true,
        stockRawTokenHash: HASH_A,
        patchedRawTokenHash: equal ? HASH_A : HASH_B,
        rawTokensComparable: equal,
        patchedMappedTokenCount: 1,
        patchedRawVadIntervalCount: 1,
        languageEqual: true,
        requestConfigurationEqual: true,
        promptEqual: true,
        stockResponseBytes: 10,
        patchedResponseBytes: 20,
        stockDurationSeconds: 1,
        patchedDurationSeconds: 1,
        failures,
      },
    ],
    perProfile: [
      {
        profile: "current-sensitive-vad",
        pairCount: 1,
        textParityCount: 1,
        segmentParityCount: 1,
        rawTokenParityCount: Number(equal),
        languageParityCount: 1,
        patchedMappedTokenCount: 1,
        patchedRawVadIntervalCount: 1,
      },
    ],
    summary: {
      pairCount: 1,
      freshRequestCount: 2,
      textParityPassed: true,
      segmentParityPassed: true,
      rawTokenParityPassed: equal,
      languageParityPassed: true,
      requestConfigurationParityPassed: true,
      promptParityPassed: true,
      stockMappedTokenCount: 0,
      patchedMappedTokenCount: 1,
      stockRawVadIntervalCount: 0,
      patchedRawVadIntervalCount: 1,
      stockWallClockSeconds: 1,
      patchedWallClockSeconds: 1,
      stockWorkerStartCount: 1,
      patchedWorkerStartCount: 1,
      stockModelLoadCount: 1,
      patchedModelLoadCount: 1,
      stockPeakResidentBytes: null,
      patchedPeakResidentBytes: null,
      stockResponseBytes: 10,
      patchedResponseBytes: 20,
      accepted: equal,
      failures,
    },
  } as const;
}

describe("C5.16.1 A/B metric semantics", () => {
  it.each([true, false])(
    "migrates deprecated raw-token equality into grouped-word parity (%s)",
    (equal) => {
      const migrated = migrateC516AbMetricSemantics(legacyAb(equal));
      expect(migrated.requestPairs[0]).toMatchObject({
        rawGroupedWordsComparable: true,
        rawGroupedWordsEqual: equal,
        individualRawTokenParityStatus: "not-observable-on-stock-server",
        individualRawTokensComparable: false,
        individualRawTokensEqual: null,
      });
      expect(migrated.summary).toMatchObject({
        rawTokenParityPassed: equal,
        rawGroupedWordParityPassed: equal,
        rawGroupedWordComparablePairCount: 1,
        individualRawTokenParityStatus: "not-observable-on-stock-server",
        individualRawTokenComparablePairCount: 0,
        individualRawTokenParityPassed: null,
      });
    },
  );

  it.each([
    { status: "passed", equal: true, summary: true },
    { status: "failed", equal: false, summary: false },
  ] as const)(
    "parses observable individual-token parity as $status",
    (item) => {
      const migrated = migrateC516AbMetricSemantics(legacyAb(true));
      const parsed = c516StockPatchedRuntimeAbArtifactSchema.parse({
        ...migrated,
        requestPairs: migrated.requestPairs.map((pair) => ({
          ...pair,
          individualRawTokenParityStatus: item.status,
          individualRawTokensComparable: true,
          individualRawTokensEqual: item.equal,
        })),
        perProfile: migrated.perProfile.map((profile) => ({
          ...profile,
          individualRawTokenComparablePairCount: 1,
        })),
        summary: {
          ...migrated.summary,
          individualRawTokenParityStatus: item.status,
          individualRawTokenComparablePairCount: 1,
          individualRawTokenParityPassed: item.summary,
        },
      });
      expect(parsed.summary.individualRawTokenParityPassed).toBe(item.summary);
    },
  );
});

describe("C5.16.1 shareable path and secret policy", () => {
  it.each([
    ["/opt/models/large-v3.bin", "POSIX_ABSOLUTE_PATH"],
    ["/Users/alice/task/report.json", "MACOS_USER_PATH"],
    ["/home/alice/task/report.json", "LINUX_HOME_PATH"],
    ["C:\\models\\large-v3.bin", "WINDOWS_DRIVE_PATH"],
    ["\\\\server\\share\\artifact.json", "UNC_PATH"],
    ["file:///tmp/artifact.json", "FILE_URI"],
    ["--model /Users/alice/.cache/model.bin", "MACOS_USER_PATH"],
  ])("detects %s", (value, reason) => {
    expect(shareablePathLeakReasons(value)).toContain(reason);
  });

  it.each([
    "https://github.com/kai987/repository",
    "http://example.test/schema.json",
    "git+https://github.com/kai987/repository.git",
  ])("does not flag an allowed URL: %s", (value) => {
    expect(shareablePathLeakReasons(value)).toEqual([]);
  });

  it("detects path and common secret classes recursively", () => {
    const scan = scanShareableValue({
      model: "/Users/alice/.cache/model.bin",
      authorization: "Bearer abcdefghijklmnop",
      openai: ["sk", "abcdefghijklmnop123456"].join("-"),
      github: ["ghp", "abcdefghijklmnopqrstuvwxyz123456"].join("_"),
    });
    expect(scan.absolutePathLeakCount).toBe(1);
    expect(scan.prohibitedSecretCount).toBe(3);
    expect(scan.findings.flatMap((finding) => finding.reasons)).toEqual(
      expect.arrayContaining([
        "OPENAI_API_KEY",
        "GITHUB_TOKEN",
        "BEARER_TOKEN",
        "SECRET_BEARING_FIELD",
      ]),
    );
  });

  it("relativizes internal paths and reduces external paths to basenames", () => {
    const sanitized = sanitizeShareableValue({
      taskRoot: "/workspace/task",
      value: {
        internal: "/workspace/task/subtitle/report.json",
        external: "/Users/alice/.cache/models/large-v3.bin",
        command: "--cache /Users/alice/.cache/mvl/asr",
        sourceVideo: "/Users/alice/Videos/episode.mkv",
        repository: "https://github.com/kai987/repository",
      },
    });
    expect(sanitized.value).toEqual({
      internal: "subtitle/report.json",
      external: "large-v3.bin",
      command: "[PATH_REDACTED]",
      sourceVideo: "episode.mkv",
      repository: "https://github.com/kai987/repository",
    });
    expect(sanitized.pathReplacementCount).toBe(4);
    expect(scanShareableValue(sanitized.value)).toMatchObject({
      absolutePathLeakCount: 0,
      prohibitedSecretCount: 0,
    });
  });
});
