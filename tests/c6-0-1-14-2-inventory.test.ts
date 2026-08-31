import { describe, expect, it } from "vitest";
import type { AcousticFeatures142, ScoreTracks142 } from "@mvl/shared";
import {
  partition142,
  classifyMasked142,
  uncoveredSpeech142,
} from "../packages/video-subtitler/src/review/c601142-inventory.js";
import { policy142 } from "../packages/video-subtitler/src/review/c601142-policy.js";
import { hash141 } from "../packages/video-subtitler/src/review/c601141-policy.js";
import { fixture142 } from "./fixtures/c601142-review-fixture.js";
const policy = policy142(),
  h = hash141("synthetic");
const features: AcousticFeatures142 = {
  rms: 0.02,
  levelDbfsProxy: -30,
  dynamicRangeDb: 10,
  voiceBandRatio: 0.8,
  lowBandRatio: 0.1,
  highBandRatio: 0.1,
  spectralFlatness: 0.3,
  modulation2To16HzRatio: 0.4,
  harmonicityProxy: 0.3,
  pitchContinuityProxy: 0.4,
  onsetDensityPerSecond: 4,
  centerSideEnergyRatio: null,
};
function classify(
  rows: {
    id: string;
    family: "SILERO" | "PYANNOTE" | "WEBRTC";
    view: string;
    main: boolean;
  }[],
  overrides: Partial<AcousticFeatures142> = {},
) {
  const tracks = rows.map((r) => ({
    runId: r.id,
    family: r.family,
    pcmSha256: hash141(r.view),
    semanticHash: hash141(r),
  }));
  return classifyMasked142(
    {
      id: "synthetic",
      nativeInterval: { startSample: 0, endSample: 48000 },
      mainRunIds: rows.filter((r) => r.main).map((r) => r.id),
      auditRunIds: rows.filter((r) => !r.main).map((r) => r.id),
    },
    { ...features, ...overrides },
    { tracks } as ScoreTracks142,
    policy,
  );
}
describe("C601142 exact native inventory and masked-speech ontology", () => {
  it("does not turn disjoint observations into a speech envelope", () => {
    const cells = partition142(
      [
        { nativeInterval: { startSample: 1, endSample: 3 }, key: "a" },
        { nativeInterval: { startSample: 5, endSample: 7 }, key: "b" },
      ],
      8,
    );
    expect(
      cells.filter((c) => c.supports.length).map((c) => c.nativeInterval),
    ).toEqual([
      { startSample: 1, endSample: 3 },
      { startSample: 5, endSample: 7 },
    ]);
    expect(
      cells.find((c) => c.nativeInterval.startSample === 3)?.supports,
    ).toEqual([]);
  });
  it("removes ending evidence before adding evidence at an equal boundary", () => {
    const cells = partition142(
      [
        { nativeInterval: { startSample: 0, endSample: 4 }, key: "a" },
        { nativeInterval: { startSample: 4, endSample: 8 }, key: "b" },
      ],
      8,
    );
    expect(cells.map((c) => c.supports.map((r) => r.key))).toEqual([
      ["a"],
      ["b"],
    ]);
  });
  it("rejects fractional, negative and out-of-source sample evidence", () => {
    for (const v of [
      { startSample: -1, endSample: 4 },
      { startSample: 1.2, endSample: 4 },
      { startSample: 2, endSample: 11 },
      { startSample: 4, endSample: 4 },
    ])
      expect(() => partition142([{ nativeInterval: v }], 10)).toThrow(
        /NATIVE_INTERVAL_INVALID/u,
      );
  });
  it("never promotes energy-only speech-like modulation", () => {
    expect(classify([])).toMatchObject({
      evidenceClass: "ENERGY_ONLY_UNSUPPORTED",
      eligibleSafetyCandidate: false,
      independentFamilyCount: 0,
    });
  });
  it("records silence without invented speech", () => {
    expect(classify([], { rms: 0 })).toMatchObject({
      evidenceClass: "NO_SPEECH_SUPPORT",
      eligibleSafetyCandidate: false,
    });
  });
  it("counts two views of one detector as one family", () => {
    expect(
      classify([
        { id: "one", family: "SILERO", view: "a", main: false },
        { id: "two", family: "SILERO", view: "b", main: false },
      ]),
    ).toMatchObject({
      evidenceClass: "SUBTHRESHOLD_MULTI_VIEW_CANDIDATE",
      independentFamilyCount: 1,
      eligibleSafetyCandidate: true,
    });
  });
  it("does not count duplicate PCM views as multiview evidence", () => {
    expect(
      classify([
        { id: "one", family: "SILERO", view: "same", main: false },
        { id: "two", family: "SILERO", view: "same", main: false },
      ]).evidenceClass,
    ).not.toBe("SUBTHRESHOLD_MULTI_VIEW_CANDIDATE");
  });
  it("retains independent WebRTC-only candidates without hallucinated transcript truth", () => {
    expect(
      classify([{ id: "w", family: "WEBRTC", view: "a", main: true }]),
    ).toMatchObject({
      evidenceClass: "WEBRTC_EXCLUSIVE_SPEECH_CANDIDATE",
      independentFamilyCount: 1,
      eligibleSafetyCandidate: true,
    });
  });
  it("separates cross-detector posterior support from two MAIN detectors", () => {
    const pair = [
      { id: "s", family: "SILERO" as const, view: "a", main: false },
      { id: "p", family: "PYANNOTE" as const, view: "a", main: false },
    ];
    expect(classify(pair).evidenceClass).toBe(
      "CROSS_DETECTOR_SUBTHRESHOLD_CANDIDATE",
    );
    expect(
      classify(pair.map((p) => ({ ...p, main: true }))).evidenceClass,
    ).toBe("VERIFIED_INDEPENDENT_DETECTOR_SPEECH");
  });
  it("leaves steady harmonic music unresolved, not lexical speech", () => {
    expect(
      classify([{ id: "s", family: "SILERO", view: "a", main: false }], {
        harmonicityProxy: 0.99,
        pitchContinuityProxy: 0.99,
        modulation2To16HzRatio: 0.01,
      }),
    ).toMatchObject({
      evidenceClass: "MUSIC_DOMINATED_UNRESOLVED",
      eligibleSafetyCandidate: false,
      acousticContradiction: true,
    });
  });
  it("subtracts cues, prior non-safety targets and active safety independently", () => {
    const f = fixture142(),
      native = (start: number, end: number) => ({
        startSample: start * 48000,
        endSample: end * 48000,
      });
    const result = uncoveredSpeech142({
      inventory: f.inventory,
      policy: f.policy,
      cueMasks: [native(12, 12.5)],
      previousTargetMasks: [native(12.5, 13)],
      activeSafetyMasks: [native(13, 14)],
      activeSafetyHash: h,
      finalCueHash: h,
      previousTargetsHash: h,
      sceneSamples: [],
    });
    expect(result.candidates.every((c) => c.sourceInterval.start >= 23)).toBe(
      true,
    );
    expect(result.subtractedActiveSafetyHash).toBe(h);
    expect(f.inventory.summary.parentEnvelopeAsSpeechCount).toBe(0);
  });
});
