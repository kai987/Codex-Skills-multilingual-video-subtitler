import { c60114CoveragePhysicalAudioSchema } from "@mvl/shared";
import { describe, expect, it } from "vitest";
import { c601143WorkspaceJavascript } from "../packages/video-subtitler/src/review/c601143-review-workspace-ui.js";
import { representedPlaybackNativeIntervals143 } from "../packages/video-subtitler/src/review/c601143-review-delivery.js";
import { coverageAudio143 } from "../scripts/lib/c601143-projections.js";
describe("C6.0.1.14.3 additive review UI", () => {
  const js = c601143WorkspaceJavascript();
  it("exposes the frozen official plan and separate child/bundle playback", () => {
    expect(js).toContain("C601143_FINAL_REVIEW_DELIVERY");
    expect(js).toContain("Play child core");
    expect(js).toContain("Play bundle review envelope");
  });
  it("shows native cores, internal gaps, evidence strata and frozen lexical provenance", () => {
    for (const token of [
      "internal silence/gaps",
      "evidenceStrata",
      "Phase A obligation preserved",
      "frozen request",
      "No decision saved",
    ])
      expect(js).toContain(token);
  });
  it("does not create a save path, model request or automatic candidate insertion", () => {
    expect(js).not.toMatch(
      /fetch\(|XMLHttpRequest|WebSocket|\.save\(|canonicalInsertAllowed\s*=\s*true/u,
    );
  });
  it("counts frozen sub-sample compatibility segments as zero native audio", () => {
    expect(
      representedPlaybackNativeIntervals143(
        [
          { start: 1, end: 1 + 1 / 192000 },
          { start: 2, end: 2 + 1 / 48000 },
        ],
        48000,
      ),
    ).toEqual([{ startSample: 96000, endSample: 96001 }]);
  });

  it("keeps the final coverage projection compatible with strict legacy audio rows", () => {
    const nativeAudio = {
      audioId: "audio-1",
      relativePath: "audio/audio-1.wav",
      sourceMediaSha256: "a".repeat(64),
      sourceInterval: { start: 1, end: 2 },
      requestedInterval: { start: 1, end: 2 },
      sampleRate: 48_000,
      channels: 1,
      bitDepth: 16,
      codec: "pcm_s16le",
      frameCount: 48_000,
      actualDuration: 1,
      sha256: "b".repeat(64),
      playable: true,
      hashVerified: true,
      physicalMetadataVerified: true,
      coveredReviewTargetIds: ["target-1"],
      regionIds: ["region-1"],
      sourceIdentity: {
        sourceMediaSha256: "a".repeat(64),
        durationSeconds: 10,
        sampleRate: 48_000,
        audioStreamIndex: 1,
        audioTimebase: "1/1000",
        sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
      },
      semanticHash: "c".repeat(64),
      nativeSourceInterval: { startSample: 48_000, endSample: 96_000 },
    } satisfies Parameters<typeof coverageAudio143>[0];
    const coverageAudio = coverageAudio143(nativeAudio);
    expect(c60114CoveragePhysicalAudioSchema.parse(coverageAudio)).toEqual(
      coverageAudio,
    );
  });
});
