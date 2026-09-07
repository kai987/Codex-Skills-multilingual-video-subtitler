import {
  machineQualityEvidenceSchema,
  type MachineQualityEvidence,
} from "../../packages/video-subtitler/src/machine-quality/experimental-profile.js";
const hash = "a".repeat(64);
export function evidence(): MachineQualityEvidence {
  return machineQualityEvidenceSchema.parse({
    version: "c60116-evidence-v1",
    partition: "development-known",
    source: {
      sha256: hash,
      durationSeconds: 100,
      audioStream: 1,
      sourceSampleRate: 48000,
      mediaStart: 5,
      fileName: "synthetic.wav",
    },
    primaryRequests: [
      {
        id: "request",
        cacheKey: hash,
        cacheFileHash: hash,
        audioHash: hash,
        resultHash: hash,
        modelHash: null,
        model: "fixture",
        runtime: null,
        tokenizer: null,
        promptHash: hash,
        decodeHash: hash,
        sampleRate: 16000,
        interval: { start: 10, end: 20 },
        timebase: "original-audio-local",
        vadEnabled: false,
        segments: [
          { id: "raw-a", start: 0, end: 2, text: "走れ!走れ!" },
          { id: "raw-b", start: 2, end: 4, text: "走れ!走れ!" },
        ],
      },
    ],
    canonicalLineage: [
      { id: "c-a", rawSegmentIds: ["raw-a"] },
      { id: "c-b", rawSegmentIds: ["raw-b"] },
    ],
    stableCues: [
      {
        id: "damaged",
        text: "走れ!",
        start: 10,
        end: 12,
        language: "ja",
        languages: ["ja"],
        speaker: null,
        confidence: null,
        provenance: {
          sourceLayer: "baseline-vad",
          sourceRequestIds: ["c-a", "c-b"],
          sourceProfileIds: ["primary"],
          referenceAnchorIds: [],
          referenceUnitIds: [],
          recoveryUnitId: null,
          sceneId: null,
          sceneLabel: null,
          independentSupportCount: 1,
          qualityScore: null,
        },
      },
    ],
    unprovenRepetition: [
      {
        cueId: "old",
        outputCueIds: ["damaged"],
        removedText: ["走れ!"],
        reason: "no-independent-token-timestamps-for-second-utterance",
      },
    ],
    provenance: {
      baselineCommit: "b".repeat(40),
      stablePackageHash: hash,
      stableAssHash: hash,
      stableSrtHash: hash,
      stableVttHash: hash,
      primaryArtifactHash: hash,
      canonicalArtifactHash: hash,
      repetitionArtifactHash: hash,
      inputManifestHash: hash,
      stableReplay: "historical-canonical-verified-not-full-pipeline-replayed",
      humanInputCount: 0,
    },
  });
}
