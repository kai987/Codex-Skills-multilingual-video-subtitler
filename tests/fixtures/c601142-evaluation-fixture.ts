import { type C60114PlaybackCoverageInput } from "@mvl/shared";
import { fixture141 } from "./c601141-fixture.js";
import { hashed141 } from "../../packages/video-subtitler/src/review/c601141-policy.js";
/** Synthetic evidence only. No filesystem or Gold inputs. */
export function coverageInput142(): C60114PlaybackCoverageInput {
  const { source } = fixture141(),
    interval = { start: 10, end: 12 };
  return {
    sourceIdentity: source,
    generatedAt: "2026-01-01T00:00:00.000Z",
    items: [{ reviewItemId: "synthetic-item", sourceIdentity: source }],
    targets: [
      {
        reviewTargetId: "synthetic-target",
        parentReviewItemId: "synthetic-item",
        sourceInterval: interval,
        mandatoryForAudio: false,
        audioRequired: true,
        sourceIdentity: source,
      },
    ],
    regions: [
      {
        regionId: "synthetic-region",
        reviewTargetIds: ["synthetic-target"],
        reviewItemIds: ["synthetic-item"],
        sourceIntervals: [interval],
        contextIntervals: [interval],
        sourceIdentity: source,
      },
    ],
    physicalAudio: [
      hashed141({
        audioId: "synthetic-audio",
        relativePath: "audio/synthetic.wav",
        sourceMediaSha256: source.sourceMediaSha256,
        sourceInterval: interval,
        requestedInterval: interval,
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        codec: "pcm_s16le",
        frameCount: 32000,
        actualDuration: 2,
        sha256: "b".repeat(64),
        playable: true,
        hashVerified: true,
        physicalMetadataVerified: true,
        coveredReviewTargetIds: ["synthetic-target"],
        regionIds: ["synthetic-region"],
        sourceIdentity: source,
      }),
    ],
    playbackSegments: [
      hashed141({
        playbackSegmentId: "synthetic-segment",
        audioId: "synthetic-audio",
        sourceInterval: interval,
        audioLocalInterval: { start: 0, end: 2 },
        reviewTargetIds: ["synthetic-target"],
        reviewItemIds: ["synthetic-item"],
        regionIds: ["synthetic-region"],
        sourceIdentity: source,
      }),
    ],
    plans: [
      "FULL_QUEUE",
      "FULL_QUEUE_WITH_SAFETY_RESERVE",
      "C601142_FINAL_FULL_QUEUE",
      "ALL_MANDATORY",
      ...[10, 20, 30, 40, 50].map((p) => `UNIQUE_AUDIO_${p}_PERCENT`),
    ].map((planId) => ({
      planId,
      budgetSeconds: null,
      regionIds: planId === "ALL_MANDATORY" ? [] : ["synthetic-region"],
      reviewTargetIds: planId === "ALL_MANDATORY" ? [] : ["synthetic-target"],
      playbackSegmentIds:
        planId === "ALL_MANDATORY" ? [] : ["synthetic-segment"],
    })),
    speechIslands: [
      {
        islandId: "synthetic-speech",
        sourceInterval: interval,
        speechPositive: true,
        localizationStatus: "VERIFIED",
        sourceIdentity: source,
      },
    ],
    lexicalEvidence: [],
    orphans: [],
    errorComponents: ["MISSING_DIALOGUE", "HALLUCINATION"].map((label) => ({
      errorComponentId: `synthetic-${label}`,
      labels: [label as "MISSING_DIALOGUE" | "HALLUCINATION"],
      sourceIdentity: source,
      defectIds: [label],
      alignmentIds: [label],
      coveredItemIds: ["synthetic-item"],
      coveredRegionIds: ["synthetic-region"],
      errorIntervals: [interval],
      mappingStatus: "RESOLVED",
      mappingReasons: [],
    })),
    engineeringGates: {
      engineeringPassed: true,
      baselineParityPassed: true,
      runtimeGoldInputCount: 0,
      canonicalMutationCount: 0,
      machineDraftMutationCount: 0,
      sourceMutationCount: 0,
      goldMutationCount: 0,
      machineFreezeVerified: true,
    },
  };
}
