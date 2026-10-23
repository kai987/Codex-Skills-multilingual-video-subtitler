import { describe, expect, it } from "vitest";

import type { FinalizationCandidate, SubtitleCue } from "@mvl/shared";
import {
  aggregateCueDecisions,
  applyAutomaticCueDecisions,
  calculateCandidateCoverage,
  evaluateCandidateMutationSafety,
  repairSafeExactDuplicateCues,
} from "@mvl/transcription-core";

function cue(
  id: string,
  text = "お父ちゃんどこ行くんやろ",
  start = 1,
  end = 2,
): SubtitleCue {
  return {
    id,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    text,
    speaker: null,
    confidence: 0.9,
  };
}

function candidate(
  overrides: Partial<FinalizationCandidate> = {},
): FinalizationCandidate {
  const currentText = "お父ちゃんどこ行くんやろ";
  const candidateText = overrides.candidateText ?? `${currentText}。`;
  return {
    candidateId: "candidate-a",
    targetCueIds: ["cue-a"],
    candidateText,
    candidateInterval: { start: 1, end: 2 },
    localInterval: { start: 1, end: 2 },
    associationType: "EXACT_TARGET",
    associationScore: 0.95,
    associationMargin: 0.2,
    sourceEvidenceIds: ["evidence-a", "evidence-b"],
    sourceRequestIds: ["request-a", "request-b"],
    sourceProfileIds: ["profile-a", "profile-b"],
    independentSupportCount: 2,
    coverageMetrics: calculateCandidateCoverage({
      currentText,
      candidateText,
      localSpeechCoverageRatio: 1,
    }),
    directAcousticSupport: true,
    partialFragment: false,
    timingResolved: true,
    languageIntegrityPassed: true,
    hallucinationQaPassed: true,
    repetitionQaPassed: true,
    presentationQaPassed: true,
    requestedAction: "REPLACE",
    automaticMutationEligible: false,
    requiresHumanReview: false,
    blockers: [],
    ...overrides,
  };
}

describe("safe automatic subtitle mutation gate", () => {
  it.each([
    "BROAD_WINDOW_ASSOCIATION",
    "AMBIGUOUS_ASSOCIATION",
    "UNASSOCIATED",
  ] as const)("keeps %s suggestion-only", (associationType) => {
    const evaluated = evaluateCandidateMutationSafety({
      candidate: candidate({ associationType }),
      currentText: cue("cue-a").text,
    });
    expect(evaluated.automaticMutationEligible).toBe(false);
    expect(evaluated.blockers).toContain(associationType);
  });

  it("blocks a missing local interval", () => {
    const evaluated = evaluateCandidateMutationSafety({
      candidate: candidate({ localInterval: null }),
      currentText: cue("cue-a").text,
    });
    expect(evaluated.blockers).toContain("LOCAL_INTERVAL_MISSING");
    expect(evaluated.automaticMutationEligible).toBe(false);
  });

  it.each([
    ["夢見て愛して駆け抜けたこれはそのお話", "駆け抜けた"],
    ["おばちゃん、こっちこっち！おばちゃん、ここ座り！", "おばちゃん"],
    ["おしゃもじどこやったかいな", "おしゃもじ"],
  ])("blocks strict substring replacement", (currentText, candidateText) => {
    const evaluated = evaluateCandidateMutationSafety({
      candidate: candidate({ candidateText }),
      currentText,
    });
    expect(evaluated.blockers).toEqual(
      expect.arrayContaining([
        "STRICT_SUBSTRING_REPLACEMENT_BLOCKED",
        "CONTENT_OMISSION_RISK",
        "INCOMPLETE_SEMANTIC_COVERAGE",
      ]),
    );
    expect(evaluated.automaticMutationEligible).toBe(false);
  });

  it("blocks partial fragments, neighbor intrusion, and missing support", () => {
    const current = cue("cue-a").text;
    const input = candidate({
      partialFragment: true,
      directAcousticSupport: false,
      coverageMetrics: calculateCandidateCoverage({
        currentText: current,
        candidateText: `${current}。`,
        neighborCueIntrusionRatio: 0.4,
        localSpeechCoverageRatio: 0.2,
      }),
    });
    const evaluated = evaluateCandidateMutationSafety({
      candidate: input,
      currentText: current,
    });
    expect(evaluated.blockers).toEqual(
      expect.arrayContaining([
        "PARTIAL_FRAGMENT",
        "NO_DIRECT_ACOUSTIC_SUPPORT",
        "NEIGHBOR_CUE_INTRUSION",
        "LOCAL_SPEECH_COVERAGE_INSUFFICIENT",
      ]),
    );
  });

  it("does not count duplicate copies of one request as independent support", () => {
    const evaluated = evaluateCandidateMutationSafety({
      candidate: candidate({
        independentSupportCount: 4,
        sourceRequestIds: ["same-request", "same-request"],
      }),
      currentText: cue("cue-a").text,
    });
    expect(evaluated.independentSupportCount).toBe(1);
    expect(evaluated.blockers).toContain("INSUFFICIENT_INDEPENDENT_SUPPORT");
  });

  it("allows evidence-backed timing-only repair without changing text", () => {
    const baseCue = cue("cue-a");
    const timing = candidate({
      candidateText: baseCue.text,
      requestedAction: "TIMING_ONLY",
      localInterval: { start: 1.1, end: 1.9 },
    });
    const aggregate = aggregateCueDecisions({
      cues: [baseCue],
      candidates: [timing],
    });
    const applied = applyAutomaticCueDecisions({
      cues: [baseCue],
      ...aggregate,
    });
    expect(aggregate.decisions).toHaveLength(1);
    expect(aggregate.decisions[0]?.action).toBe("TIMING_ONLY");
    expect(applied.cues[0]?.text).toBe(baseCue.text);
    expect(applied.cues[0]?.start).toBe(1.1);
    expect(applied.timingRepairCount).toBe(1);
  });

  it("safely removes an exact duplicate with equivalent timing", () => {
    const repaired = repairSafeExactDuplicateCues({
      cues: [cue("cue-a", "はい", 1, 2), cue("cue-b", "はい", 1.01, 2.01)],
    });
    expect(repaired.cues.map((item) => item.id)).toEqual(["cue-a"]);
    expect(repaired.decisions[0]?.action).toBe("DELETE_HALLUCINATION");
    expect(repaired.decisions[0]?.automaticMutationEligible).toBe(true);
  });
});

describe("one deterministic machine decision per cue", () => {
  it("keeps one winner and alternatives independent of input order", () => {
    const baseCue = cue("cue-a");
    const candidates = [
      candidate({ candidateId: "candidate-b", associationScore: 0.9 }),
      candidate({ candidateId: "candidate-a", associationScore: 0.95 }),
      candidate({
        candidateId: "candidate-c",
        candidateText: "お父ちゃんどこへ行くんやろ",
        associationScore: 0.91,
      }),
    ];
    const forward = aggregateCueDecisions({ cues: [baseCue], candidates });
    const reverse = aggregateCueDecisions({
      cues: [baseCue],
      candidates: [...candidates].reverse(),
    });
    expect(forward.decisions).toHaveLength(1);
    expect(forward.decisions).toEqual(reverse.decisions);
    expect(forward.decisions[0]?.selectedCandidateId).toBe("candidate-a");
    expect(forward.decisions[0]?.alternativeCandidateIds).toContain(
      "candidate-c",
    );
  });

  it("collapses overlapping cue groups instead of last-writer-wins", () => {
    const cues = [cue("cue-a"), cue("cue-b", "次の文", 2, 3)];
    const decisions = aggregateCueDecisions({
      cues,
      candidates: [
        candidate({ candidateId: "one", targetCueIds: ["cue-a"] }),
        candidate({
          candidateId: "two",
          targetCueIds: ["cue-a", "cue-b"],
        }),
      ],
    }).decisions;
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.targetCueIds).toEqual(["cue-a", "cue-b"]);
    expect(decisions[0]?.blockers).toContain("MULTI_DECISION_CONFLICT");
    expect(decisions[0]?.automaticMutationEligible).toBe(false);
  });
});
