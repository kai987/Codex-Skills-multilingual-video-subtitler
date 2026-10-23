import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  c601141PolicySchema,
  c601141AudioViewsSchema,
  c601141UncoveredSchema,
  type C60114SourceIdentity,
  type C601141Observation,
  type C601141AudioView,
  type C601141RuntimeIdentity,
} from "@mvl/shared";
import {
  policy141,
  hashed141,
  hash141,
  header141,
  union141,
  subtract141,
  assertBudget141,
  authorize141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  partitionSpeech141,
  uncoveredSpeech141,
  selectSafety141,
  selectAsr141,
} from "../packages/video-subtitler/src/review/c601141-inventory.js";
import {
  planSweeps141,
  normalizeDetectorIntervals141,
} from "../packages/video-subtitler/src/review/c601141-detectors.js";
import {
  reserveDispatch141,
  durableJson141,
  pcm141,
  wav141,
  bytesHash141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  viewRecipes141,
  validateAudioViews141,
} from "../packages/video-subtitler/src/review/c601141-audio-views.js";
import { config141Schema } from "../scripts/lib/c601141-input.js";

const h = "a".repeat(64),
  policy = policy141();
const source: C60114SourceIdentity = {
  sourceMediaSha256: h,
  durationSeconds: 180,
  sampleRate: 48000,
  audioStreamIndex: 1,
  audioTimebase: "1/1000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS",
};
const native = (a: number, b: number) => ({
  startSample: Math.round(a * source.sampleRate),
  endSample: Math.round(b * source.sampleRate),
});
function observation(
  id: string,
  a: number,
  b: number,
  family: C601141Observation["family"],
  viewId: string | null = null,
): C601141Observation {
  return {
    observationId: id,
    nativeInterval: native(a, b),
    family,
    correlationGroup: family,
    viewId,
    profileId: "sensitive-v2",
    evidenceIds: [id],
    requestIds: [id],
    verifiedTimebase: true,
    speechPositive: true,
    strongContradiction: false,
    reliableLexical: false,
  };
}
function view(
  role: C601141AudioView["role"],
  key = "b",
  duplicateOfViewId: string | null = null,
): C601141AudioView {
  return hashed141({
    viewId: role,
    role,
    sourceAudioStreamIndex: 1,
    nativeSampleRate: 48000,
    nativeChannelLayout: "stereo",
    sourcePtsStartSeconds: 0,
    filterGraph: "pan=mono|c0=c0",
    decodeCommandIdentity: h,
    ffmpegIdentity: h,
    relativePath: `${role}.wav`,
    sampleRate: 16000,
    channels: 1,
    bitDepth: 16,
    frameCount: 16000 * 180,
    durationSeconds: 180,
    audioSha256: h,
    pcmSha256: key.repeat(64),
    duplicateOfViewId,
    detectorEligible: duplicateOfViewId === null,
    timeMapping: {
      sourceStartSample: 0,
      sourceSampleRate: 48000,
      outputSampleRate: 16000,
      numerator: 3,
      denominator: 1,
      outputStartSample: 0,
      mappingStatus: "VERIFIED_INTEGER_RATIONAL",
      measuredImpulsePeakDelaySamples: 0,
      syntheticValidationHash: h,
    },
  });
}
function inventory(observations: C601141Observation[]) {
  const islands = partitionSpeech141({ observations, source, policy });
  return hashed141({
    ...header141(policy, source),
    artifactType: "machine-source-global-speech-inventory-v4" as const,
    viewsHash: h,
    fingerprintHash: h,
    sweepsEvidenceHash: h,
    previousIslandsHash: h,
    observations,
    islands,
    summary: {
      observationCount: observations.length,
      islandCount: islands.length,
      multiDetectorCount: 0,
      nativeUnionSeconds: 0,
      unresolvedCount: 0,
      parentEnvelopeAsSpeechCount: 0 as const,
      correlationInflationCount: 0 as const,
    },
  });
}
describe("C6.0.1.14.1 strict policy and inference boundaries", () => {
  it("rejects an extra Gold field instead of stripping it", () =>
    expect(() =>
      c601141PolicySchema.parse({ ...policy, goldPath: "private" }),
    ).toThrow());
  it("requires explicit authorization for fresh computation", () => {
    expect(authorize141("SPEECH", false, {})).toBe(false);
    expect(authorize141("ASR", false, {})).toBe(false);
    expect(
      authorize141("SPEECH", false, {
        MVL_C601141_SPEECH_SWEEP_AUTHORIZED: "1",
      }),
    ).toBe(true);
    expect(authorize141("ASR", true, {})).toBe(true);
  });
  it.each([
    ["SPEECH", 13],
    ["ASR", 33],
  ] as const)("rejects the over-budget %s request", (kind, count) =>
    expect(() => assertBudget141(kind, count)).toThrow(),
  );
  it("counts prior attempts, including failed ones", () =>
    expect(() => assertBudget141("ASR", 1, 32)).toThrow());
  it("rejects fractional and negative accounting", () => {
    expect(() => assertBudget141("ASR", 0.5)).toThrow();
    expect(() => assertBudget141("SPEECH", 1, -1)).toThrow();
  });
  it("persists a dispatch ticket and refuses a retry", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "c601141-ticket-"));
    try {
      const input = {
        cacheDirectory: directory,
        kind: "ASR" as const,
        requestId: "synthetic-request",
        identity: { h },
      };
      await reserveDispatch141(input);
      await expect(reserveDispatch141(input)).rejects.toThrow();
      expect(
        (await readdir(path.join(directory, "dispatch/asr"))).filter((n) =>
          n.endsWith(".json"),
        ),
      ).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("write-once raw persistence does not overwrite existing evidence", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "c601141-raw-"));
    try {
      const file = path.join(directory, "raw.json");
      await durableJson141(file, { value: 1 });
      await expect(durableJson141(file, { value: 2 })).rejects.toThrow();
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ value: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("requires a strict machine-only CLI configuration", () =>
    expect(config141Schema.safeParse({ goldPath: "private" }).success).toBe(
      false,
    ));
});
describe("C6.0.1.14.1 sample arithmetic and correlation", () => {
  it("preserves unsupported silence between speech intervals", () =>
    expect(union141([native(1, 2), native(3, 4)])).toHaveLength(2));
  it("subtracts cues and existing targets at integer boundaries", () => {
    const result = subtract141(native(1, 5), [native(2, 3), native(4, 6)]);
    expect(result).toEqual([native(1, 2), native(3, 4)]);
  });
  it("does not promote adjacent independent detectors without overlap", () => {
    const rows = partitionSpeech141({
      source,
      policy,
      observations: [
        observation("a", 1, 2, "SILERO", "a"),
        observation("b", 2, 3, "PYANNOTE", "b"),
      ],
    });
    expect(
      rows.every((v) => v.evidenceClass !== "MULTI_DETECTOR_CONFIRMED"),
    ).toBe(true);
  });
  it("correlates all Silero profiles/views as one family", () => {
    const rows = partitionSpeech141({
      source,
      policy,
      observations: [
        observation("a", 1, 2, "SILERO", "left"),
        observation("b", 1, 2, "SILERO", "right"),
      ],
    });
    expect(rows[0]?.evidenceClass).toBe("MULTI_VIEW_SPEECH_POSITIVE");
    expect(rows[0]?.independentFamilyCount).toBe(1);
  });
  it("promotes only the actual interval shared by independent detectors", () => {
    const rows = partitionSpeech141({
      source,
      policy,
      observations: [
        observation("a", 1, 3, "SILERO", "left"),
        observation("b", 2, 4, "PYANNOTE", "native"),
      ],
    });
    expect(
      rows
        .filter((v) => v.evidenceClass === "MULTI_DETECTOR_CONFIRMED")
        .map((v) => v.sourceInterval),
    ).toEqual([{ start: 2, end: 3 }]);
  });
  it("does not use strong contradiction or unverified coordinates for safety", () => {
    const bad = {
      ...observation("a", 1, 2, "SILERO", "left"),
      strongContradiction: true,
    };
    const rows = partitionSpeech141({
      source,
      policy,
      observations: [bad, observation("b", 1, 2, "PYANNOTE", "native")],
    });
    expect(rows[0]?.evidenceClass).toBe("STRONG_CONTRADICTION");
  });
  it("splits long observations and respects cue/scene boundaries", () => {
    const rows = partitionSpeech141({
      source,
      policy,
      observations: [observation("a", 1, 30, "SILERO", "left")],
      splitPoints: [5 * source.sampleRate],
    });
    expect(
      rows.every((v) => v.sourceInterval.end - v.sourceInterval.start <= 12),
    ).toBe(true);
    expect(rows.some((v) => v.sourceInterval.end === 5)).toBe(true);
  });
  it("retains an unreviewed fragment when a previous target covers only half", () => {
    const inv = inventory([observation("a", 1, 5, "PYANNOTE", "native")]);
    const uncovered = uncoveredSpeech141({
      inventory: inv,
      policy,
      cues: [{ start: 1, end: 2 }],
      previousTargets: [{ sourceInterval: { start: 3, end: 4 } }],
      finalCueHash: h,
      previousTargetsHash: h,
    });
    expect(uncovered.candidates.map((v) => v.sourceInterval)).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 5 },
    ]);
  });
  it("keeps low-support view-only islands in audit, not mandatory review", () => {
    const inv = inventory([
      {
        ...observation("a", 1, 2, "SILERO", "left"),
        profileId: "extra-sensitive-v1",
      },
    ]);
    const u = uncoveredSpeech141({
      inventory: inv,
      policy,
      cues: [],
      previousTargets: [],
      finalCueHash: h,
      previousTargetsHash: h,
    });
    const s = selectSafety141(u, policy);
    expect(s.targets).toHaveLength(0);
    expect(s.summary.auditOnlyCount).toBe(1);
  });
  it("freezes at most 24 safety targets, 60 seconds and 12 ASR targets", () => {
    const inv = inventory(
      Array.from({ length: 30 }, (_, i) =>
        observation(`a${i}`, i * 5, i * 5 + 4, "PYANNOTE", "native"),
      ),
    );
    const u = uncoveredSpeech141({
      inventory: inv,
      policy,
      cues: [],
      previousTargets: [],
      finalCueHash: h,
      previousTargetsHash: h,
    });
    const s = selectSafety141(u, policy),
      a = selectAsr141(s, policy, "2025-01-01T00:00:00.000Z");
    expect(s.targets.length).toBeLessThanOrEqual(24);
    expect(s.summary.targetUnionSeconds).toBeLessThanOrEqual(60);
    for (const target of s.targets) {
      expect(target.requiredLevel).toBe("RECOMMENDED");
      expect(target.canonicalInsertAllowed).toBe(false);
    }
    expect(a.targets).toHaveLength(12);
    expect(a.contextEligibleTargetIds).toHaveLength(4);
    expect(a.maximumAuthorizedRequests).toBe(32);
    expect(hash141(selectAsr141(s, policy, a.selectionFrozenAt))).toBe(
      hash141(a),
    );
  });
  it("rejects invented candidate fields at the schema boundary", () => {
    const u = uncoveredSpeech141({
      inventory: inventory([]),
      policy,
      cues: [],
      previousTargets: [],
      finalCueHash: h,
      previousTargetsHash: h,
    });
    expect(() =>
      c601141UncoveredSchema.parse({ ...u, goldCueIds: ["forbidden"] }),
    ).toThrow();
  });
});
describe("C6.0.1.14.1 audio views and native timebase", () => {
  it("provides stereo native, L, R, mid and deterministic voice-band recipes", () => {
    expect(viewRecipes141("stereo", 2)).toHaveLength(5);
    expect(viewRecipes141("mono", 1)).toHaveLength(3);
    expect(
      viewRecipes141("5.1", 6).find((v) => v.role === "CENTER_OR_MID")
        ?.filterGraph,
    ).toContain("FC");
  });
  it("round trips physical PCM frame counts and rejects truncation", () => {
    const bytes = wav141(Buffer.alloc(32000));
    expect(pcm141(bytes).frames).toBe(16000);
    expect(() => pcm141(bytes.subarray(0, bytes.length - 1))).toThrow();
    expect(bytesHash141(pcm141(bytes).pcm)).toHaveLength(64);
  });
  it("converts VAD centiseconds, not milliseconds, into native samples", () => {
    const intervals = normalizeDetectorIntervals141(
      {
        rawUnit: "CENTISECONDS",
        rawIntervals: [{ start: 123, end: 234 }],
        exclusiveRawIntervals: [],
        inputFrames: 180 * 16000,
        sampleRate: 16000,
        device: "cpu",
      },
      view("NATIVE_MONO"),
      180 * 48000,
    );
    expect(intervals).toEqual([native(1.23, 2.34)]);
  });
  it("does not count exclusive and standard pyannote as separate votes", () => {
    const intervals = normalizeDetectorIntervals141(
      {
        rawUnit: "SECONDS",
        rawIntervals: [{ start: 1, end: 2 }],
        exclusiveRawIntervals: [{ start: 1, end: 2 }],
        inputFrames: 180 * 16000,
        sampleRate: 16000,
        device: "cpu",
      },
      view("NATIVE_MONO"),
      180 * 48000,
    );
    expect(intervals).toHaveLength(1);
  });
  it("rejects unexplained detector timebase and frame identity", () => {
    expect(() =>
      normalizeDetectorIntervals141(
        {
          rawUnit: "SECONDS",
          rawIntervals: [{ start: 1, end: 999 }],
          exclusiveRawIntervals: [],
          inputFrames: 1,
          sampleRate: 16000,
          device: "cpu",
        },
        view("NATIVE_MONO"),
        180 * 48000,
      ),
    ).toThrow();
  });
  it("skips byte-identical mid audio before scheduling a model", () => {
    const views = c601141AudioViewsSchema.parse(
      hashed141({
        ...header141(policy, source),
        artifactType: "machine-source-audio-views-v1",
        views: [
          view("NATIVE_MONO"),
          view("CENTER_OR_MID", "b", "NATIVE_MONO"),
          view("VOICE_BAND_CENTER", "c"),
        ],
        summary: { viewCount: 3, uniquePcmViewCount: 2, rejectedCount: 0 },
      }),
    );
    const identity = (
      family: "SILERO" | "PYANNOTE",
    ): C601141RuntimeIdentity => ({
      detectorFamily: family,
      modelId: family,
      modelSnapshotHash: h,
      runtimeIdentityHash: h,
      workerSha256: h,
      binarySha256: h,
      device: "cpu",
      offline: true,
      modelDownloadCount: 0,
      versions: { test: "1" },
    });
    const jobs = planSweeps141(
      views,
      policy,
      ["SILERO", "PYANNOTE"].map((family) => ({
        identity: identity(family as "SILERO" | "PYANNOTE"),
        python: "unavailable",
        worker: "unavailable",
        model: "unavailable",
        library: null,
      })),
    );
    expect(jobs).toHaveLength(6);
    expect(jobs.every((v) => v.viewId !== "CENTER_OR_MID")).toBe(true);
  });
  it("checks real ffmpeg impulse, frame and resampling invariants without models", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "c601141-impulse-"));
    try {
      const result = await validateAudioViews141({
        directory,
        nativeSampleRate: 48000,
      });
      expect(result.passed).toBe(true);
      expect(result.results).toHaveLength(5);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
