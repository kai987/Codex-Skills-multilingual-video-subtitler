import { describe, expect, it } from "vitest";

import {
  buildAcousticRiskVectorEntry,
  buildMachineAcousticRiskVector,
  buildMachineReAsrPriority,
  type AcousticRiskInput,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-28T00:00:00.000Z";

function base(overrides: Partial<AcousticRiskInput> = {}): AcousticRiskInput {
  return {
    eventId: "event-1",
    candidateId: "candidate-1",
    requestEdgeRisk: "NONE",
    ctcScore: 0.8,
    tokenCoverage: 0.9,
    speechCoverage: 0.95,
    decoderAvailability: "available",
    averageLogProbability: -0.3,
    noSpeechProbability: 0.02,
    independentWindowDisagreement: "NONE",
    repetitionRisk: 0,
    durationTextAnomaly: "NONE",
    pronunciationCoverage: 0.9,
    associationAmbiguity: "NONE",
    overlapRisk: "NONE",
    ...overrides,
  };
}

function severityMap(input: AcousticRiskInput) {
  return new Map(
    buildAcousticRiskVectorEntry(input).facts.map((fact) => [
      fact.name,
      fact.severity,
    ]),
  );
}

describe("C6.0.1.6 multi-label acoustic risk", () => {
  it("preserves edge, CTC, decoder, token, and speech facts independently", () => {
    const entry = buildAcousticRiskVectorEntry(
      base({
        requestEdgeRisk: "STRONG",
        ctcScore: 0.1,
        tokenCoverage: 0.1,
        speechCoverage: 0.6,
        averageLogProbability: -1.7,
      }),
    );
    const facts = new Map(
      entry.facts.map((fact) => [fact.name, fact.severity]),
    );
    expect(facts.get("requestEdgeRisk")).toBe("STRONG");
    expect(facts.get("ctcWeak")).toBe("STRONG");
    expect(facts.get("tokenWeak")).toBe("STRONG");
    expect(facts.get("speechIncomplete")).toBe("STRONG");
    expect(facts.get("decoderWeak")).toBe("STRONG");
    expect(entry.strongRiskCount).toBeGreaterThanOrEqual(5);
    expect(entry.recommendedAction).toBe("RE_ASR");
  });

  it("does not count correlated CTC weaknesses as independent signals", () => {
    const ctcOnly = buildAcousticRiskVectorEntry(
      base({ ctcScore: 0.4, pronunciationCoverage: 0.4 }),
    );
    expect(
      ctcOnly.facts.find((fact) => fact.name === "ctcWeak")?.severity,
    ).toBe("WEAK");
    expect(
      ctcOnly.facts.find((fact) => fact.name === "pronunciationCoverageWeak")
        ?.severity,
    ).toBe("WEAK");
    expect(ctcOnly.independentWeakRiskCount).toBe(1);
    expect(ctcOnly.recommendedAction).toBe("VERIFY");

    const independent = buildAcousticRiskVectorEntry(
      base({ ctcScore: 0.4, tokenCoverage: 0.3 }),
    );
    expect(independent.independentWeakRiskCount).toBe(2);
    expect(independent.recommendedAction).toBe("RE_ASR");
  });

  it("produces KEEP, VERIFY, RE_ASR, and REVIEW without hiding unknowns", () => {
    expect(buildAcousticRiskVectorEntry(base()).recommendedAction).toBe("KEEP");
    expect(
      buildAcousticRiskVectorEntry(base({ ctcScore: 0.4 })).recommendedAction,
    ).toBe("VERIFY");
    expect(
      buildAcousticRiskVectorEntry(base({ tokenConflict: true }))
        .recommendedAction,
    ).toBe("RE_ASR");
    expect(
      buildAcousticRiskVectorEntry(base({ associationAmbiguity: "STRONG" }))
        .recommendedAction,
    ).toBe("REVIEW");
    expect(
      severityMap(
        base({
          decoderAvailability: "unknown",
          averageLogProbability: null,
          noSpeechProbability: null,
          ctcScore: null,
          pronunciationCoverage: null,
        }),
      ).get("decoderUnknown"),
    ).toBe("UNKNOWN");
  });

  it("retains no-speech conflict separately from decoder weakness", () => {
    const facts = severityMap(base({ noSpeechProbability: 0.9 }));
    expect(facts.get("decoderWeak")).toBe("WEAK");
    expect(facts.get("noSpeechConflict")).toBe("STRONG");
  });
});

describe("C6.0.1.6 risk-driven Re-ASR priority", () => {
  it("selects one strong or two independent weak risks but not correlated weak risks", () => {
    const vector = buildMachineAcousticRiskVector({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      events: [
        base({
          eventId: "strong",
          candidateId: "candidate-strong",
          tokenConflict: true,
        }),
        base({
          eventId: "independent",
          candidateId: "candidate-independent",
          ctcScore: 0.4,
          tokenCoverage: 0.3,
        }),
        base({
          eventId: "correlated",
          candidateId: "candidate-correlated",
          ctcScore: 0.4,
          pronunciationCoverage: 0.4,
        }),
        base({ eventId: "low", candidateId: "candidate-low" }),
      ],
    });
    const priority = buildMachineReAsrPriority({
      mode: "enforce",
      riskVector: vector.events,
      generatedAt: GENERATED_AT,
    });
    expect(priority.summary.eligibleCount).toBe(2);
    expect(
      priority.events.find((event) => event.eventId === "strong")
        ?.budgetSelected,
    ).toBe(true);
    expect(
      priority.events.find((event) => event.eventId === "independent")
        ?.budgetSelected,
    ).toBe(true);
    expect(
      priority.events.find((event) => event.eventId === "correlated")
        ?.budgetSelected,
    ).toBe(false);
  });

  it("uses bounded budget and deterministic non-eventId tie breaking", () => {
    const events = Array.from({ length: 14 }, (_value, index) =>
      base({
        eventId: `event-${String(index + 1).padStart(2, "0")}`,
        candidateId: `candidate-${String(14 - index).padStart(2, "0")}`,
        tokenConflict: true,
      }),
    );
    const vector = buildMachineAcousticRiskVector({
      mode: "enforce",
      events,
      generatedAt: GENERATED_AT,
    });
    const first = buildMachineReAsrPriority({
      mode: "enforce",
      riskVector: vector.events,
      generatedAt: GENERATED_AT,
    });
    const second = buildMachineReAsrPriority({
      mode: "enforce",
      riskVector: vector.events.toReversed(),
      generatedAt: GENERATED_AT,
    });
    expect(first.semanticHash).toBe(second.semanticHash);
    expect(first.summary).toMatchObject({
      eligibleCount: 14,
      budgetSelectedCount: 12,
      budgetExhaustedCount: 2,
      requestBudgetUsed: 36,
    });
    const selectedOrder = first.events
      .filter((event) => event.budgetSelected)
      .map((event) => event.stableTieBreakHash);
    expect(selectedOrder).toEqual(selectedOrder.toSorted());
    expect(first.orderingPolicy).toContain("no-event-id");
  });
});
