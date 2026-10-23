import { describe, expect, it } from "vitest";

import type { SubtitleCue } from "@mvl/shared";
import {
  classifyAdjacentRepetitions,
  classifyRepetitionRelationship,
} from "@mvl/transcription-core";

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
  options: {
    requestIds?: string[];
    tokens?: { text: string; start: number; end: number }[];
    speaker?: string | null;
  } = {},
): SubtitleCue {
  return {
    id,
    text,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    speaker: options.speaker ?? null,
    confidence: 1,
    ...(options.requestIds === undefined
      ? {}
      : {
          provenance: {
            sourceLayer: "baseline-vad" as const,
            sourceRequestIds: options.requestIds,
            sourceProfileIds: [],
            referenceAnchorIds: [],
            referenceUnitIds: [],
            recoveryUnitId: null,
            sceneId: null,
            sceneLabel: null,
            independentSupportCount: new Set(options.requestIds).size,
            qualityScore: 1,
          },
        }),
    ...(options.tokens === undefined
      ? {}
      : {
          timingEvidence: {
            sourceTrusted: false,
            speechStart: options.tokens[0]?.start ?? start,
            speechEnd: options.tokens.at(-1)?.end ?? end,
            tokenTimestampsAvailable: true,
            tokenTimestampsUsed: true,
            tokens: options.tokens,
            alignmentSource: "token" as const,
            presentationTimingMethod: null,
          },
        }),
  };
}

describe("C5.14 adjacent repetition classification", () => {
  it("preserves distinct non-overlapping human-reviewed utterances", () => {
    const decision = classifyRepetitionRelationship({
      left: cue("a", "待てー!", 1, 2),
      right: cue("b", "待てー!", 3, 4),
      humanReviewedAuthority: true,
    });
    expect(decision.relationship).toBe("separate-utterance-repetition");
    expect(decision.recommendedAction).toBe("preserve-both");
    expect(decision.blocking).toBe(false);
  });

  it("classifies all five real human repetition pairs as non-blocking", () => {
    const pairs = [
      ["今日…", 39.4, 40.88, 41.66, 43.11],
      ["いってらっしゃい!", 77.59, 79.09, 79.09, 80.68],
      ["おはようさん。", 291.58, 292.54, 292.54, 294.04],
      ["待てー!", 825.96, 827.39, 828.89, 830.09],
      ["待てー!", 843.24, 844.84, 845.81, 847.2],
    ] as const;
    const decisions = pairs.flatMap(
      ([text, leftStart, leftEnd, rightStart, rightEnd], index) =>
        classifyAdjacentRepetitions({
          cues: [
            cue(`left-${index}`, text, leftStart, leftEnd),
            cue(`right-${index}`, text, rightStart, rightEnd),
          ],
          humanReviewedAuthority: true,
        }),
    );
    expect(decisions).toHaveLength(5);
    expect(decisions.every((decision) => !decision.blocking)).toBe(true);
    expect(
      decisions.every(
        (decision) => decision.recommendedAction === "preserve-both",
      ),
    ).toBe(true);
  });

  it("keeps same-bound machine copies eligible for duplicate removal", () => {
    const decision = classifyRepetitionRelationship({
      left: cue("a", "はい", 1, 2),
      right: cue("b", "はい", 1, 2),
    });
    expect(decision.relationship).toBe("duplicate-cue");
    expect(decision.recommendedAction).toBe("delete-duplicate");
    expect(decision.blocking).toBe(true);
  });

  it("treats identical text with over 90 percent overlap as duplicate-like", () => {
    const decision = classifyRepetitionRelationship({
      left: cue("a", "同じ文", 1, 3),
      right: cue("b", "同じ文", 1.05, 3.05),
    });
    expect(decision.temporalOverlapRatio).toBeGreaterThan(0.9);
    expect(decision.relationship).toBe("duplicate-cue");
  });

  it("does not count two cues from one request as independent speech", () => {
    const decision = classifyRepetitionRelationship({
      left: cue("a", "はい", 1, 2, { requestIds: ["same"] }),
      right: cue("b", "はい", 3, 4, { requestIds: ["same"] }),
    });
    expect(decision.sameSourceRequest).toBe(true);
    expect(decision.relationship).toBe("unresolved");
    expect(decision.blocking).toBe(true);
  });

  it("uses independent localized token occurrences as positive evidence", () => {
    const decision = classifyRepetitionRelationship({
      left: cue("a", "はい", 1, 2, {
        requestIds: ["same"],
        tokens: [{ text: "はい", start: 1.1, end: 1.8 }],
      }),
      right: cue("b", "はい", 3, 4, {
        requestIds: ["same"],
        tokens: [{ text: "はい", start: 3.1, end: 3.8 }],
      }),
    });
    expect(decision.relationship).toBe("confirmed-intentional-repetition");
    expect(decision.blocking).toBe(false);
  });

  it("keeps machine repetition unresolved without authority or acoustic evidence", () => {
    const decision = classifyRepetitionRelationship({
      left: cue("a", "もう一度", 1, 2),
      right: cue("b", "もう一度", 3, 4),
    });
    expect(decision.relationship).toBe("unresolved");
    expect(decision.recommendedAction).toBe("review");
  });

  it("is deterministic when pair input order is reversed", () => {
    const left = cue("a", "おはよう", 1, 2);
    const right = cue("b", "おはよう", 3, 4);
    const forward = classifyRepetitionRelationship({
      left,
      right,
      humanReviewedAuthority: true,
    });
    const reverse = classifyRepetitionRelationship({
      left: right,
      right: left,
      humanReviewedAuthority: true,
    });
    expect(reverse).toEqual(forward);
  });

  it("never modifies either input cue", () => {
    const left = cue("a", "繰り返し", 1, 2);
    const right = cue("b", "繰り返し", 3, 4);
    const before = structuredClone([left, right]);
    classifyRepetitionRelationship({
      left,
      right,
      humanReviewedAuthority: true,
    });
    expect([left, right]).toEqual(before);
  });
});
