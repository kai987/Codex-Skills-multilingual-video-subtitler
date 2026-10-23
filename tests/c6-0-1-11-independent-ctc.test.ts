import {
  buildIndependentDiscriminatorEvent,
  classifyIndependentAcousticMargin,
  independentCtcCacheKey,
  independentCtcRepresentations,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const HASH = "b".repeat(64);

function projected(nllPerTargetToken: number | null) {
  return {
    representation: "NORMALIZED_DISPLAY" as const,
    representationHash: HASH,
    encodedTokenCount: 4,
    unknownTokenCount: 0,
    coverageRatio: 1,
    rawNll: nllPerTargetToken === null ? null : nllPerTargetToken * 4,
    nllPerTargetToken,
    acousticFrameCount: 100,
    targetCoverage: 1,
    blockers: nllPerTargetToken === null ? ["UNSCORABLE"] : [],
  };
}

describe("C6.0.1.11 independent candidate-conditioned CTC", () => {
  it("projects display and pronunciation forms without raw-text features", () => {
    expect(
      independentCtcRepresentations({
        displayText: "カーネーション",
        pronunciationText: "かーねーしょん",
      }),
    ).toEqual([
      { type: "NORMALIZED_DISPLAY", text: "カーネーション" },
      { type: "PRONUNCIATION", text: "かーねーしょん" },
    ]);
  });

  it("defines positive margin as acoustically favoring Reazon", () => {
    expect(
      classifyIndependentAcousticMargin({
        whisperNllPerTargetToken: 7,
        reazonNllPerTargetToken: 4,
      }),
    ).toEqual({ margin: 3, outcome: "INDEPENDENT_FAVORS_REAZON" });
    expect(
      classifyIndependentAcousticMargin({
        whisperNllPerTargetToken: 2,
        reazonNllPerTargetToken: 5,
      }),
    ).toEqual({ margin: -3, outcome: "INDEPENDENT_FAVORS_WHISPER" });
    expect(
      classifyIndependentAcousticMargin({
        whisperNllPerTargetToken: null,
        reazonNllPerTargetToken: 5,
      }).outcome,
    ).toBe("INDEPENDENT_UNSCORABLE");
  });

  it("freezes cache identity across audio, representations, model, and runtime", () => {
    const input = {
      audioSha256: HASH,
      whisperRepresentations: independentCtcRepresentations({
        displayText: "うん",
      }),
      reazonRepresentations: independentCtcRepresentations({
        displayText: "はい",
      }),
      modelSnapshotHash: "c".repeat(64),
      runtimeId: "d".repeat(64),
    };
    expect(independentCtcCacheKey(input)).toBe(independentCtcCacheKey(input));
    expect(independentCtcCacheKey(input)).not.toBe(
      independentCtcCacheKey({
        ...input,
        audioSha256: "e".repeat(64),
      }),
    );
  });

  it("materializes pairwise scores without producing a third transcript", () => {
    const event = buildIndependentDiscriminatorEvent({
      eventId: "event-1",
      audioSha256: HASH,
      whisperCandidateId: "whisper-1",
      reazonCandidateId: "reazon-1",
      result: { whisper: projected(8), reazon: projected(5) },
    });
    expect(event).toMatchObject({
      pairwiseMargin: 3,
      outcome: "INDEPENDENT_FAVORS_REAZON",
      scorability: "SCORABLE",
    });
    expect(event).not.toHaveProperty("thirdCandidate");
    expect(event).not.toHaveProperty("greedyTranscript");
  });
});
