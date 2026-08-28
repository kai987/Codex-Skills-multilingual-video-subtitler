import { describe, expect, it } from "vitest";

import {
  decoderEvidenceSchema,
  subtitlePackageSchema,
  type DecoderEvidence,
  type SubtitleCue,
} from "@mvl/shared";
import {
  applyCanonicalMutations,
  buildCanonicalMutationProposals,
  buildEvidenceApplicationCoverage,
  buildEventFinalCueLineage,
  buildLocalAssociationRepairProposals,
  buildRawAsrEventRecoveryArtifact,
  buildSingleVariantAcousticAudit,
  buildTrustedTokenTimingProposals,
  buildVariantEvidenceBundle,
  C6015_RAW_ASR_EPISODE_REQUEST_BUDGET,
  planRawAsrEventRecovery,
  type VariantEvidenceInput,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-28T00:00:00.000Z";

function availableDecoder(input?: {
  averageLogProbability?: number;
  noSpeechProbability?: number;
}): DecoderEvidence {
  return decoderEvidenceSchema.parse({
    status: "available",
    averageLogProbability: input?.averageLogProbability ?? -0.2,
    noSpeechProbability: input?.noSpeechProbability ?? 0.01,
    compressionRatio: 1.1,
    repetitionRatio: 0,
    tokenTimingQuality: 0.9,
    textDensity: 2,
    edgePosition: "inside",
    fallbackLevel: 0,
    temperature: 0,
    requestDurationSeconds: 2,
    decoderEvidenceHash: "a".repeat(64),
    unavailableReasons: [],
  });
}

function unavailableDecoder(): DecoderEvidence {
  return decoderEvidenceSchema.parse({
    status: "unavailable",
    averageLogProbability: null,
    noSpeechProbability: null,
    compressionRatio: null,
    repetitionRatio: null,
    tokenTimingQuality: null,
    textDensity: null,
    edgePosition: null,
    fallbackLevel: null,
    temperature: null,
    requestDurationSeconds: null,
    decoderEvidenceHash: null,
    unavailableReasons: ["not-persisted"],
  });
}

interface AuditVariantFixture {
  id: string;
  eventId?: string;
  text?: string;
  ctcScore: number | null;
  tokenText?: string | null;
  speechCoverage?: number;
  edge?: "inside" | "left" | "right" | "both";
  decoder?: DecoderEvidence;
}

function auditBundle(fixtures: readonly AuditVariantFixture[]) {
  const variants: VariantEvidenceInput[] = fixtures.map((fixture) => {
    const edge = fixture.edge ?? "inside";
    return {
      variantId: fixture.id,
      eventId: fixture.eventId ?? `event:${fixture.id}`,
      candidateId: `candidate:${fixture.id}`,
      text: fixture.text ?? "はい",
      interval: {
        start: edge === "left" || edge === "both" ? 10 : 10.2,
        end: edge === "right" || edge === "both" ? 12 : 11.8,
      },
      eventInterval: { start: 10, end: 12 },
      requestIds: [`request:${fixture.id}`],
      sourceWindowIds: [`window:${fixture.id}`],
      independentSupportGroups: [`support:${fixture.id}`],
      correlatedSupportGroups: [],
      speechCoverage: fixture.speechCoverage ?? 0.9,
      reAsrOrigin: {
        isReAsr: false,
        requestFamilyIds: [],
        sourceGlobalVerified: true,
        promptIsolated: true,
      },
      decoderEvidence: fixture.decoder ?? availableDecoder(),
    };
  });
  return buildVariantEvidenceBundle({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    variants,
    tokens: fixtures.flatMap((fixture) =>
      fixture.tokenText === null
        ? []
        : [
            {
              tokenId: `token:${fixture.id}`,
              variantId: fixture.id,
              text: fixture.tokenText ?? fixture.text ?? "はい",
              lexical: true,
              trusted: true,
            },
          ],
    ),
    ctcEvidence: fixtures.flatMap((fixture) =>
      fixture.ctcScore === null
        ? []
        : [
            {
              variantId: fixture.id,
              evidenceId: `ctc:${fixture.id}`,
              score: fixture.ctcScore,
              edgePinned:
                fixture.edge !== undefined && fixture.edge !== "inside",
            },
          ],
    ),
  });
}

describe("C6.0.1.5 single-variant acoustic audit", () => {
  it("classifies strong, weak, edge, token, span, decoder, no-speech, and unknown evidence", () => {
    const fixtures: AuditVariantFixture[] = [
      { id: "strong", ctcScore: 0.8 },
      { id: "acceptable", ctcScore: 0.6 },
      { id: "low-ctc", ctcScore: 0.2 },
      { id: "edge", ctcScore: 0.8, edge: "left" },
      { id: "conflict", ctcScore: 0.8 },
      { id: "incomplete", ctcScore: 0.8, speechCoverage: 0.5 },
      {
        id: "decoder-low",
        ctcScore: 0.6,
        decoder: availableDecoder({ averageLogProbability: -1.5 }),
      },
      {
        id: "no-speech",
        ctcScore: 0.6,
        decoder: availableDecoder({ noSpeechProbability: 0.8 }),
      },
      {
        id: "unknown",
        ctcScore: null,
        tokenText: null,
        decoder: unavailableDecoder(),
      },
      { id: "acoustic-weak", ctcScore: 0.5, tokenText: "異" },
    ];
    const bundle = auditBundle(fixtures);
    const audit = buildSingleVariantAcousticAudit({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      singleVariantIds: fixtures.map((fixture) => fixture.id),
      variantEvidence: bundle,
      tokenConflictVariantIds: new Set(["conflict"]),
    });
    const status = new Map(
      audit.events.map((event) => [event.candidateId, event.auditStatus]),
    );
    expect(status.get("candidate:strong")).toBe("VERIFIED_STRONG");
    expect(status.get("candidate:acceptable")).toBe("ACCEPTABLE");
    expect(status.get("candidate:low-ctc")).toBe("LOW_CTC_SUPPORT");
    expect(status.get("candidate:edge")).toBe("EDGE_TRUNCATED");
    expect(status.get("candidate:conflict")).toBe("TOKEN_CONFLICT");
    expect(status.get("candidate:incomplete")).toBe("INCOMPLETE_SPEECH_SPAN");
    expect(status.get("candidate:decoder-low")).toBe("DECODER_LOW_CONFIDENCE");
    expect(status.get("candidate:no-speech")).toBe("DECODER_LOW_CONFIDENCE");
    expect(status.get("candidate:unknown")).toBe("UNKNOWN");
    expect(status.get("candidate:acoustic-weak")).toBe("ACOUSTICALLY_WEAK");
    expect(
      audit.events
        .filter((event) => event.auditStatus !== "VERIFIED_STRONG")
        .filter((event) => event.auditStatus !== "ACCEPTABLE")
        .every((event) => event.reAsrEligibility),
    ).toBe(true);
  });
});

describe("C6.0.1.5 bounded raw ASR recovery", () => {
  it("triggers only suspicious single variants with isolated prompts and source-global bounded windows", () => {
    const fixtures: AuditVariantFixture[] = [
      ...Array.from({ length: 14 }, (_value, index) => ({
        id: `weak-${String(index + 1).padStart(2, "0")}`,
        ctcScore: 0.2,
      })),
      { id: "strong", ctcScore: 0.9 },
    ];
    const bundle = auditBundle(fixtures);
    const audit = buildSingleVariantAcousticAudit({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      singleVariantIds: fixtures.map((fixture) => fixture.id),
      variantEvidence: bundle,
    });
    const intervals = new Map(
      audit.events.map((event, index) => [
        event.eventId,
        { start: index * 3, end: index * 3 + 2 },
      ]),
    );
    const plan = planRawAsrEventRecovery({
      audit,
      eventIntervals: intervals,
      sourceTotalSamples: 16_000 * 60,
    });
    const requests = plan.events.flatMap((event) => event.requests);

    expect(plan.events).toHaveLength(12);
    expect(requests).toHaveLength(C6015_RAW_ASR_EPISODE_REQUEST_BUDGET);
    expect(plan.budgetExhaustedCount).toBe(2);
    expect(plan.events.some((event) => event.eventId === "event:strong")).toBe(
      false,
    );
    expect(
      requests.every(
        (request) => (request as { prompt: unknown }).prompt === null,
      ),
    ).toBe(true);
    expect(
      requests.every(
        (request) =>
          request.sourceGlobalSampleInterval.startSample >= 0 &&
          request.sourceGlobalSampleInterval.endSample <= 16_000 * 60 &&
          request.sourceGlobalSampleInterval.endSample >
            request.sourceGlobalSampleInterval.startSample,
      ),
    ).toBe(true);
    expect(
      plan.events.every(
        (event) =>
          event.requests.length === 3 &&
          new Set(event.requests.map((request) => request.requestFamilyId))
            .size === 1,
      ),
    ).toBe(true);

    const recovery = buildRawAsrEventRecoveryArtifact({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      audit,
      plan: plan.events,
      executed: plan.events.map((event, index) => ({
        eventId: event.eventId,
        requestIds: event.requests.map((request) => request.requestId),
        requestFamilyIds: [event.requests[0]?.requestFamilyId ?? "missing"],
        sourceGlobalVerified: true,
        requestsExecuted: 3,
        cacheHitCount: 0,
        inferenceCount: 3,
        modelLoadCount: index === 0 ? 1 : 0,
        newCandidateIds: [`targeted-reasr:${event.eventId}`],
        evaluatedCandidateIds: [
          event.eventId.replace("event:", ""),
          `targeted-reasr:${event.eventId}`,
        ],
        selectedCandidateId:
          index === 0 ? `targeted-reasr:${event.eventId}` : null,
      })),
      multiVariantTriggeredCount: 0,
      workerStartCount: 1,
      improvedPoolRuntimeProxyCount: 1,
      replacedByReAsrCount: 1,
    });
    expect(
      recovery.events.map((event) => event.candidateTextPromptUsed),
    ).toEqual(Array.from({ length: recovery.events.length }, () => false));
    expect(recovery.summary).toMatchObject({
      requestCount: 36,
      newCandidateCount: 12,
      replacedByReAsrCount: 1,
    });
    expect(
      Object.keys(recovery.events[0] ?? {}).some((key) =>
        key.toLowerCase().includes("canonical"),
      ),
    ).toBe(false);
  });
});

function coverageFixture(input?: { consumeEvidence?: boolean }) {
  const consumeEvidence = input?.consumeEvidence ?? true;
  const cues: SubtitleCue[] = [
    {
      id: "cue-1",
      start: 10,
      end: 12,
      language: "ja",
      languages: ["ja"],
      text: "おはよ",
      textSource: "audio-asr",
      speaker: null,
      confidence: 0.8,
    },
  ];
  const lineage = buildEventFinalCueLineage({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    events: [
      {
        eventId: "event-1",
        candidateIds: ["current", "selected"],
        canonicalCueIds: ["canonical-1"],
      },
    ],
    finalCueIds: ["cue-1"],
    edges: [
      {
        sourceIds: ["canonical-1"],
        targetIds: ["cue-1"],
        relationType: "FINAL_SURVIVAL",
        operationArtifact: "final.json",
        reason: "exact final survival",
      },
    ],
    dropped: [],
  });
  const variants = buildVariantEvidenceBundle({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    variants: [
      {
        variantId: "current",
        eventId: "event-1",
        candidateId: "current",
        text: "おはよ",
        interval: { start: 10.1, end: 11.9 },
        eventInterval: { start: 10, end: 12 },
        requestIds: ["request-current"],
        sourceWindowIds: ["window-current"],
        independentSupportGroups: ["support-current"],
        correlatedSupportGroups: [],
        speechCoverage: 0.9,
        reAsrOrigin: {
          isReAsr: false,
          requestFamilyIds: [],
          sourceGlobalVerified: true,
          promptIsolated: true,
        },
        decoderEvidence: availableDecoder(),
      },
      {
        variantId: "selected",
        eventId: "event-1",
        candidateId: "selected",
        text: "おはよう",
        interval: { start: 10.1, end: 11.9 },
        eventInterval: { start: 10, end: 12 },
        requestIds: ["request-selected"],
        sourceWindowIds: ["window-selected"],
        independentSupportGroups: ["support-selected"],
        correlatedSupportGroups: [],
        speechCoverage: 0.9,
        reAsrOrigin: {
          isReAsr: false,
          requestFamilyIds: [],
          sourceGlobalVerified: true,
          promptIsolated: true,
        },
        decoderEvidence: availableDecoder(),
      },
    ],
    tokens: consumeEvidence
      ? [
          {
            tokenId: "trusted-selected",
            variantId: "selected",
            text: "おはよう",
            lexical: true,
            trusted: true,
          },
        ]
      : [],
    ctcEvidence: consumeEvidence
      ? [
          {
            variantId: "current",
            evidenceId: "ctc-current",
            score: 0.6,
            edgePinned: false,
          },
          {
            variantId: "selected",
            evidenceId: "ctc-selected",
            score: 0.8,
            edgePinned: false,
          },
        ]
      : [],
  });
  const timing = buildTrustedTokenTimingProposals({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    cues,
    lineage,
    variantEvidence: variants,
    selectedVariantByEvent: new Map([["event-1", "selected"]]),
    tokens: [],
    timingEligibleCueIds: new Set(),
  });
  const recoveryAudit = buildSingleVariantAcousticAudit({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    singleVariantIds: [],
    variantEvidence: variants,
  });
  const recovery = buildRawAsrEventRecoveryArtifact({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    audit: recoveryAudit,
    plan: [],
    executed: [],
    multiVariantTriggeredCount: 0,
    workerStartCount: 0,
    improvedPoolRuntimeProxyCount: 0,
    replacedByReAsrCount: 0,
  });
  const proposals = buildCanonicalMutationProposals({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    cues,
    lineage,
    variantEvidence: variants,
    selections: consumeEvidence
      ? [
          {
            eventId: "event-1",
            currentVariantId: "current",
            selectedVariantId: "selected",
          },
        ]
      : [],
    candidateTexts: [
      { variantId: "current", text: "おはよ", hallucinationRisk: 0.2 },
      { variantId: "selected", text: "おはよう", hallucinationRisk: 0.1 },
    ],
    timing,
  });
  const packageValue = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "fixture.mkv",
      container: "matroska",
      durationSeconds: 30,
    },
    identity: { title: "Fixture", season: null, episode: 1, year: 2026 },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      srt: "fixture.srt",
      vtt: "fixture.vtt",
      ass: "fixture.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues,
    warnings: [],
  });
  const ledger = applyCanonicalMutations({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    package: packageValue,
    proposals,
    lineage,
  }).ledger;
  return { lineage, variants, timing, recovery, proposals, ledger };
}

describe("C6.0.1.5 evidence application accounting", () => {
  it("distinguishes produced, consumed, applied, and rendered evidence deterministically", () => {
    const fixture = coverageFixture();
    const build = () =>
      buildEvidenceApplicationCoverage({
        trustedTokenCount: 1,
        timingEligibleCueCount: 0,
        ctcEvidenceCount: 2,
        variantDecisionCount: 1,
        generatedAt: GENERATED_AT,
        ...fixture,
      });
    const coverage = build();
    expect(coverage).toMatchObject({
      trustedTokenConsumedCount: 1,
      ctcEvidenceConsumedCount: 2,
      replacementProposalCount: 1,
      replacementAppliedCount: 1,
      finalArtifactMutationCount: 1,
      engineeringGatePassed: true,
    });
    expect(coverage.stages).toMatchObject({
      produced: 3,
      consumed: 3,
      proposalGenerated: 1,
      applied: 1,
      affectedFinalOutput: 1,
    });
    expect(build().semanticHash).toBe(coverage.semanticHash);
  });

  it("does not report produced evidence as used when nothing consumed it", () => {
    const fixture = coverageFixture({ consumeEvidence: false });
    const coverage = buildEvidenceApplicationCoverage({
      trustedTokenCount: 5,
      timingEligibleCueCount: 0,
      ctcEvidenceCount: 2,
      variantDecisionCount: 0,
      generatedAt: GENERATED_AT,
      ...fixture,
    });
    expect(coverage.trustedTokenConsumedCount).toBe(0);
    expect(coverage.ctcEvidenceConsumedCount).toBe(0);
    expect(coverage.replacementAppliedCount).toBe(0);
    expect(coverage.engineeringGatePassed).toBe(false);
    expect(coverage.blockerReasons).toEqual(
      expect.arrayContaining([
        "trusted-token-evidence-produced-but-not-consumed-or-proposed",
        "ctc-evidence-produced-but-not-consumed",
      ]),
    );
  });

  it("keeps local association repair observe-only", () => {
    const artifact = buildLocalAssociationRepairProposals({
      inspectedEventCount: 2,
      generatedAt: GENERATED_AT,
      risks: [
        {
          candidateId: "candidate-1",
          sourceEventId: "event-1",
          competingEventId: "event-2",
          currentScore: 0.4,
          competingScore: 0.7,
          evidenceIds: ["association-ledger:1"],
          hardCompatible: true,
        },
      ],
    });
    expect(artifact.mode).toBe("observe");
    expect(artifact.proposals[0]?.applyEligibility).toBe("observe-only");
    expect(artifact.summary.appliedCount).toBe(0);
  });
});
