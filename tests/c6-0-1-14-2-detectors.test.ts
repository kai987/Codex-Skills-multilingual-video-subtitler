import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import {
  detectorPlan142Schema,
  type DetectorJob142,
  type DetectorRuntime142,
  type ProcessRunner,
} from "@mvl/shared";
import {
  header142,
  policy142,
} from "../packages/video-subtitler/src/review/c601142-policy.js";
import {
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  bytesHash141,
  durableJson141,
  wav141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  detectorProfile142,
  reserve142,
  runDetectors142,
} from "../packages/video-subtitler/src/review/c601142-detectors.js";
import {
  decodeScores142,
  scoreIntervals142,
} from "../packages/video-subtitler/src/review/c601142-scores.js";
import { source142 } from "./fixtures/c601142-fixture.js";
const policy = policy142(),
  h = hash141("synthetic");
const mapping = {
  sourceSampleRate: 48000,
  outputSampleRate: 16000,
  numerator: 3,
  denominator: 1,
  sourceStartSample: 0,
  outputStartSample: 0,
  mappingStatus: "VERIFIED_INTEGER_RATIONAL",
  measuredImpulsePeakDelaySamples: 0,
  syntheticValidationHash: h,
};
async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mvl-c601142-detector-test-"),
  );
  const pcm = Buffer.alloc(32000),
    wav = wav141(pcm),
    worker = path.join(directory, "worker.py"),
    audioPath = path.join(directory, "synthetic.wav");
  await writeFile(worker, "# synthetic fake process\n");
  await writeFile(audioPath, wav);
  const identity: DetectorRuntime142 = {
    detectorFamily: "SILERO",
    modelId: "synthetic-silero",
    modelSnapshotHash: h,
    runtimeIdentityHash: h,
    workerSha256: bytesHash141(await readFile(worker)),
    binarySha256: h,
    implementationHash: h,
    device: "cpu",
    offline: true,
    modelDownloadCount: 0,
    versions: { test: "1" },
    posteriorCapture: "SILERO_VAD_PROBS",
  };
  const job = {
    runId: "synthetic-detector",
    cacheKey: h,
    family: "SILERO",
    viewId: "synthetic-view",
    viewRole: "DIALOGUE_COMPRESSED_MID_V2",
    pcmSha256: bytesHash141(pcm),
    audioSha256: bytesHash141(wav),
    frameCount: 16000,
    timeMapping: mapping,
    runtime: identity,
    profileId: "synthetic-profile",
    profileHash: hash141(detectorProfile142("SILERO", policy)),
    mainThreshold: 0.2,
    auditThreshold: 0.1,
  } as DetectorJob142;
  const plan = detectorPlan142Schema.parse(
    hashed141({
      ...header142(policy, source142),
      artifactType: "machine-c6-0-1-14-2-detector-plan",
      phaseAHash: h,
      audioViewsHash: h,
      viewAuditHash: h,
      independentRuntimeHash: h,
      frozenAt: "2020-01-01T00:00:00.000Z",
      jobs: [job],
      skippedViews: [],
      scorePolicyHash: hash141({
        detectors: policy.detectors,
        masked: policy.masked,
      }),
      runtimeUnavailable: false,
      maximumRuns: 8,
      maximumWebrtc: 4,
      maximumSilero: 2,
      maximumPyannote: 2,
      automaticRetryAllowed: false,
      backfillAllowed: false,
      goldBlind: true,
    }),
  );
  return {
    directory,
    plan,
    execution: [
      {
        runId: job.runId,
        audioPath,
        backend: {
          identity,
          worker,
          python: "synthetic-python",
          model: "synthetic-model",
          library: null,
        },
      },
    ],
  };
}
describe("C6.0.1.14.2 durable detector and posterior contracts", () => {
  it("maps frame cells to exact native samples and clips the final padded frame", () => {
    expect(
      scoreIntervals142({
        scores: [1, 1],
        hop: 320,
        offset: 0,
        threshold: 1,
        maximumOutputSample: 500,
        mapping: mapping as DetectorJob142["timeMapping"],
        maximumNativeSample: 1500,
        minimumSeconds: 0,
      }),
    ).toEqual([{ startSample: 0, endSample: 1500 }]);
  });
  it("rejects corrupt, NaN, and out-of-range compact tracks", () => {
    expect(() => decodeScores142(Buffer.alloc(3))).toThrow();
    const blob = Buffer.alloc(4);
    blob.writeFloatLE(Number.NaN);
    expect(() => decodeScores142(blob)).toThrow();
    blob.writeFloatLE(1.1);
    expect(() => decodeScores142(blob)).toThrow();
  });
  it("fails cache-only before constructing or starting any provider", async () => {
    const f = await fixture();
    let called = false;
    await expect(
      runDetectors142({
        ...f,
        mode: "EXACT_CACHE_ONLY",
        policy,
        cacheDirectory: path.join(f.directory, "cache"),
        outputDirectory: path.join(f.directory, "replay"),
        authorized: false,
        runner: {
          run: () => {
            called = true;
            return Promise.reject(new Error("forbidden"));
          },
        },
      }),
    ).rejects.toThrow(/CACHE_ONLY_MISS/u);
    expect(called).toBe(false);
  });
  it("persists raw scores and independently reconstructs exact replay with zero starts", async () => {
    const f = await fixture();
    let starts = 0;
    const runner: ProcessRunner = {
      run: async (_executable, args, options) => {
        starts++;
        expect(options?.environment?.HF_HUB_OFFLINE).toBe("1");
        const request = JSON.parse(
          await readFile(required141(args[2]), "utf8"),
        ) as {
          scoreDirectory: string;
          runId: string;
          authorized: boolean;
          dispatchReserved: boolean;
        };
        expect(request.authorized && request.dispatchReserved).toBe(true);
        const values = Buffer.alloc(32 * 4);
        for (let i = 0; i < 32; i++)
          values.writeFloatLE(i < 16 ? 0.3 : 0.15, i * 4);
        await writeFile(
          path.join(request.scoreDirectory, "scores.f32le"),
          values,
          { flag: "wx" },
        );
        await durableJson141(
          path.join(request.scoreDirectory, "result-receipt.json"),
          {
            status: "SUCCESS",
            runId: request.runId,
            inferenceConsumed: true,
            modelLoadCount: 1,
            wallClockSeconds: 1,
            result: {
              rawUnit: "SECONDS",
              rawIntervals: [{ start: 0, end: 0.512 }],
              exclusiveRawIntervals: [],
              inputFrames: 16000,
              sampleRate: 16000,
              device: "cpu",
              frameHopSamples16k: 512,
              frameWindowSamples16k: 512,
              frameOffsetSamples16k: 0,
              scoreKind: "PROBABILITY",
              originalChunkScores: null,
              scoreSource: "SYNTHETIC_TEST",
              modelLoadCount: 1,
              scoreRelativePath: "scores.f32le",
              scoreSha256: bytesHash141(values),
              scoreFrameCount: 32,
            },
          },
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    const common = {
      plan: f.plan,
      policy,
      cacheDirectory: path.join(f.directory, "cache"),
    };
    const fresh = await runDetectors142({
      ...common,
      execution: f.execution,
      mode: "FRESH",
      outputDirectory: path.join(f.directory, "fresh"),
      authorized: true,
      runner,
    });
    const replay = await runDetectors142({
      ...common,
      mode: "EXACT_CACHE_ONLY",
      outputDirectory: path.join(f.directory, "replay"),
      authorized: false,
      runner: {
        run: () =>
          Promise.reject(
            new Error("CACHE_REPLAY_PROVIDER_CONSTRUCTION_FORBIDDEN"),
          ),
      },
    });
    expect(starts).toBe(1);
    expect(fresh.sweeps.accounting.inferenceCount).toBe(1);
    expect(replay.sweeps.accounting).toMatchObject({
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      cacheHits: 1,
      cacheMisses: 0,
    });
    expect(replay.sweeps.evidenceSemanticHash).toBe(
      fresh.sweeps.evidenceSemanticHash,
    );
    expect(replay.scores.semanticHash).toBe(fresh.scores.semanticHash);
    expect(
      replay.scores.tracks[0]?.subthresholdPeakNativeIntervals,
    ).toHaveLength(1);
  });
  it("counts a lost result as consumed and never silently retries", async () => {
    const f = await fixture();
    let starts = 0;
    await expect(
      runDetectors142({
        ...f,
        policy,
        mode: "FRESH",
        cacheDirectory: path.join(f.directory, "cache"),
        outputDirectory: path.join(f.directory, "fresh"),
        authorized: true,
        runner: {
          run: () => {
            starts++;
            return Promise.reject(new Error("synthetic transport loss"));
          },
        },
      }),
    ).rejects.toThrow(/CONSUMED_RESULT_NOT_PERSISTED/u);
    expect(starts).toBe(1);
    expect(
      (await readdir(path.join(f.directory, "cache/dispatch/detector"))).filter(
        (v) => v.endsWith(".json"),
      ),
    ).toHaveLength(1);
  });
  it("uses an exclusive ticket and hard per-family budget", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "mvl-c601142-budget-test-"),
    );
    const reserve = (requestId: string) =>
      reserve142({
        directory,
        kind: "DETECTOR",
        requestId,
        planHash: h,
        family: "PYANNOTE",
        identity: requestId,
      });
    await reserve("one");
    await expect(reserve("one")).rejects.toThrow();
    await reserve("two");
    await expect(reserve("three")).rejects.toThrow(/FAMILY_BUDGET/u);
  });
});
