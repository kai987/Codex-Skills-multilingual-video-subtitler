import { describe, expect, it } from "vitest";

import {
  buildMachineDecoderEvidence,
  buildMachineRequestEdgeRisk,
  classifyRequestEdgeRisk,
  normalizeDecoderEvidence,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-28T00:00:00.000Z";

describe("C6.0.1.6 request-edge risk", () => {
  const base = {
    eventId: "event-1",
    candidateId: "candidate-1",
    requestId: "request-1",
    requestInterval: { start: 0, end: 10 },
    candidateInterval: { start: 4, end: 6 },
  };

  it("uses the ASR request edge rather than the event edge", () => {
    const centered = classifyRequestEdgeRisk(base);
    expect(centered.edgeRisk).toBe("NONE");
    expect(centered.leftDistance).toBe(4);
    expect(centered.rightDistance).toBe(4);

    const eventEdgeButRequestCenter = classifyRequestEdgeRisk({
      ...base,
      candidateInterval: { start: 4, end: 4.8 },
      speechContinuationRight: true,
    });
    expect(eventEdgeButRequestCenter.edgeRisk).toBe("NONE");
  });

  it("distinguishes weak proximity from strong corroborated truncation", () => {
    const weak = classifyRequestEdgeRisk({
      ...base,
      candidateInterval: { start: 0.2, end: 2 },
    });
    const strongLeft = classifyRequestEdgeRisk({
      ...base,
      candidateInterval: { start: 0.2, end: 2 },
      speechContinuationLeft: true,
    });
    const strongRight = classifyRequestEdgeRisk({
      ...base,
      candidateInterval: { start: 8, end: 9.8 },
      tokenEdgeContact: true,
    });
    const strongCrossWindow = classifyRequestEdgeRisk({
      ...base,
      candidateInterval: { start: 8, end: 9.8 },
      independentContinuation: true,
    });

    expect(weak.edgeRisk).toBe("WEAK");
    expect(weak.strongEdgeRisk).toBe(false);
    expect(strongLeft.edgeRisk).toBe("STRONG");
    expect(strongRight.edgeRisk).toBe("STRONG");
    expect(strongCrossWindow.edgeRisk).toBe("STRONG");
  });

  it("classifies deterministically and reports missing request identities", () => {
    const candidates = [
      { ...base, candidateId: "center" },
      {
        ...base,
        candidateId: "strong",
        candidateInterval: { start: 0, end: 1 },
        ctcIncomplete: true,
      },
      {
        ...base,
        candidateId: "missing",
        requestInterval: null,
      },
    ];
    const first = buildMachineRequestEdgeRisk({
      mode: "enforce",
      candidates,
      generatedAt: GENERATED_AT,
    });
    const second = buildMachineRequestEdgeRisk({
      mode: "enforce",
      candidates: candidates.toReversed(),
      generatedAt: GENERATED_AT,
    });
    expect(first.semanticHash).toBe(second.semanticHash);
    expect(first.summary).toMatchObject({
      candidateCount: 3,
      strongRiskCount: 1,
      noRiskCount: 1,
      unknownRiskCount: 1,
      legacyEventEdgeClassificationCount: 0,
    });
  });
});

describe("C6.0.1.6 decoder evidence", () => {
  const provenance = {
    sourceArtifact: "isolated-cache/response.json",
    sourceRequestId: "request-1",
    providerResponseRetained: true,
    sourceGlobalVerified: true,
  };

  it("preserves real zero values and keeps missing values explicitly null", () => {
    const evidence = normalizeDecoderEvidence({
      eventId: "event-1",
      candidateId: "candidate-primary",
      requestId: "request-1",
      candidateFamily: "PRIMARY",
      decoderProvider: "whisper.cpp-mvl",
      averageLogProbability: { value: 0 },
      noSpeechProbability: { value: 0 },
      temperature: { value: 0 },
      compressionRatio: {
        availability: "unsupported",
        reason: "provider-does-not-emit-field",
      },
      provenance,
    });
    expect(evidence.fields.averageLogProbability).toMatchObject({
      availability: "available",
      value: 0,
    });
    expect(evidence.fields.compressionRatio).toMatchObject({
      availability: "unsupported",
      value: null,
    });
    expect(evidence.fields.languageProbability.value).toBeNull();
  });

  it("uses one schema for primary, recovery, and re-ASR provenance", () => {
    const candidates = [
      { family: "PRIMARY" as const, suffix: "primary" },
      { family: "RECOVERY" as const, suffix: "recovery" },
      { family: "TARGETED_RE_ASR" as const, suffix: "targeted" },
      { family: "RAW_RE_ASR" as const, suffix: "raw" },
    ].map(({ family, suffix }) => ({
      eventId: `event-${suffix}`,
      candidateId: `candidate-${suffix}`,
      requestId: `request-${suffix}`,
      candidateFamily: family,
      decoderProvider: "whisper.cpp-mvl",
      averageLogProbability: { value: -0.4 },
      noSpeechProbability: { value: 0.02 },
      tokenTimestampAvailable: { value: true },
      tokenCount: { value: 4 },
      provenance: {
        ...provenance,
        sourceRequestId: `request-${suffix}`,
      },
    }));
    const artifact = buildMachineDecoderEvidence({
      mode: "enforce",
      candidates,
      generatedAt: GENERATED_AT,
    });
    expect(artifact.summary).toMatchObject({
      availableCount: 4,
      unknownCount: 0,
      primaryCoverage: 1,
      recoveryCoverage: 1,
      reAsrCoverage: 1,
    });
    expect(
      artifact.candidates.every(
        (candidate) => candidate.provenance.providerResponseRetained,
      ),
    ).toBe(true);
  });
});
