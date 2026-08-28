import { describe, expect, it } from "vitest";

import {
  decoderEvidenceSchema,
  machineCanonicalMutationProposalsSchema,
  subtitlePackageSchema,
  type DecoderEvidence,
  type SubtitleCue,
} from "@mvl/shared";
import {
  applyCanonicalMutations,
  buildCanonicalMutationProposals,
  buildEventFinalCueLineage,
  buildTrustedTokenTimingProposals,
  buildVariantEvidenceBundle,
  machineQualitySemanticHash,
  type TrustedVariantToken,
  type VariantEvidenceInput,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-28T00:00:00.000Z";

function decoder(): DecoderEvidence {
  return decoderEvidenceSchema.parse({
    status: "available",
    averageLogProbability: -0.2,
    noSpeechProbability: 0.01,
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

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
): SubtitleCue {
  return {
    id,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    text,
    textSource: "audio-asr",
    speaker: null,
    confidence: 0.8,
  };
}

function packageFixture(cues: readonly SubtitleCue[]) {
  return subtitlePackageSchema.parse({
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
}

function exactLineage(cueIds: readonly string[] = ["cue-1", "cue-2"]) {
  return buildEventFinalCueLineage({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    events: cueIds.map((cueId, index) => ({
      eventId: `event-${index + 1}`,
      candidateIds: [`candidate-${index + 1}`],
      canonicalCueIds: [`canonical-${index + 1}`],
    })),
    finalCueIds: cueIds,
    edges: cueIds.map((cueId, index) => ({
      sourceIds: [`canonical-${index + 1}`],
      targetIds: [cueId],
      relationType: "FINAL_SURVIVAL" as const,
      operationArtifact: "final-survival.json",
      reason: "persistent operation id survived to final cue",
    })),
    dropped: [],
  });
}

function variant(input: {
  id: string;
  eventId?: string;
  text: string;
  speechCoverage?: number;
}): VariantEvidenceInput {
  return {
    variantId: input.id,
    eventId: input.eventId ?? "event-1",
    candidateId: `candidate:${input.id}`,
    text: input.text,
    interval: { start: 10.2, end: 11.7 },
    eventInterval: { start: 10, end: 12 },
    requestIds: [`request:${input.id}`],
    sourceWindowIds: [`window:${input.id}`],
    independentSupportGroups: [`support:${input.id}`],
    correlatedSupportGroups: [],
    speechCoverage: input.speechCoverage ?? 0.9,
    reAsrOrigin: {
      isReAsr: input.id.startsWith("targeted-reasr:"),
      requestFamilyIds: input.id.startsWith("targeted-reasr:")
        ? [`family:${input.id}`]
        : [],
      sourceGlobalVerified: true,
      promptIsolated: true,
    },
    decoderEvidence: decoder(),
  };
}

function evidenceFixture(input?: {
  selectedText?: string;
  selectedTokenText?: string;
  selectedCtc?: number;
  currentTokenText?: string | null;
}) {
  const selectedText = input?.selectedText ?? "おはよう";
  const selectedTokenText = input?.selectedTokenText ?? selectedText;
  const currentTokenText = input?.currentTokenText ?? null;
  return buildVariantEvidenceBundle({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    variants: [
      variant({ id: "current", text: "おはよ" }),
      variant({ id: "selected", text: selectedText }),
    ],
    tokens: [
      ...(currentTokenText === null
        ? []
        : [
            {
              tokenId: "token-current",
              variantId: "current",
              text: currentTokenText,
              lexical: true,
              trusted: true,
            },
          ]),
      {
        tokenId: "token-selected",
        variantId: "selected",
        text: selectedTokenText,
        lexical: true,
        trusted: true,
      },
    ],
    ctcEvidence: [
      {
        variantId: "current",
        evidenceId: "ctc-current",
        score: 0.6,
        edgePinned: false,
      },
      {
        variantId: "selected",
        evidenceId: "ctc-selected",
        score: input?.selectedCtc ?? 0.8,
        edgePinned: false,
      },
    ],
  });
}

function noTiming(input: {
  cues: readonly SubtitleCue[];
  lineage: ReturnType<typeof exactLineage>;
  variants: ReturnType<typeof evidenceFixture>;
}) {
  return buildTrustedTokenTimingProposals({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    cues: input.cues,
    lineage: input.lineage,
    variantEvidence: input.variants,
    selectedVariantByEvent: new Map([["event-1", "selected"]]),
    tokens: [],
    timingEligibleCueIds: new Set(),
  });
}

function acceptedTextProposal() {
  const cues = [cue("cue-1", "おはよ", 10, 12), cue("cue-2", "次です", 13, 15)];
  const lineage = exactLineage();
  const variants = evidenceFixture();
  const timing = noTiming({ cues, lineage, variants });
  const proposals = buildCanonicalMutationProposals({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    cues,
    lineage,
    variantEvidence: variants,
    selections: [
      {
        eventId: "event-1",
        currentVariantId: "current",
        selectedVariantId: "selected",
      },
    ],
    candidateTexts: [
      { variantId: "current", text: "おはよ", hallucinationRisk: 0.2 },
      { variantId: "selected", text: "おはよう", hallucinationRisk: 0.1 },
    ],
    timing,
  });
  return { cues, lineage, variants, timing, proposals };
}

describe("C6.0.1.5 canonical mutation proposals", () => {
  it("accepts a strictly stronger, lineage-verified text replacement deterministically", () => {
    const fixture = acceptedTextProposal();
    expect(fixture.proposals.proposals).toHaveLength(1);
    expect(fixture.proposals.proposals[0]).toMatchObject({
      proposalType: "TEXT_VARIANT_REPLACE",
      applyStatus: "ACCEPTED",
      lineageVerified: true,
      evidenceDominance: "STRICTLY_STRONGER",
      nonDegradationPassed: true,
      safetyPassed: true,
    });
    const repeated = acceptedTextProposal();
    expect(repeated.proposals.semanticHash).toBe(
      fixture.proposals.semanticHash,
    );
  });

  it("rejects weak evidence and converts identical normalized text to a no-op", () => {
    const cues = [
      cue("cue-1", "おはよ", 10, 12),
      cue("cue-2", "次です", 13, 15),
    ];
    const lineage = exactLineage();
    const weak = evidenceFixture({
      selectedCtc: 0.4,
      selectedTokenText: "異",
      currentTokenText: "おはよ",
    });
    const weakProposals = buildCanonicalMutationProposals({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      cues,
      lineage,
      variantEvidence: weak,
      selections: [
        {
          eventId: "event-1",
          currentVariantId: "current",
          selectedVariantId: "selected",
        },
      ],
      candidateTexts: [
        { variantId: "current", text: "おはよ", hallucinationRisk: 0.1 },
        { variantId: "selected", text: "おはよう", hallucinationRisk: 0.3 },
      ],
      timing: noTiming({ cues, lineage, variants: weak }),
    });
    expect(weakProposals.proposals[0]).toMatchObject({
      applyStatus: "REJECTED",
      safetyPassed: false,
    });
    expect(weakProposals.proposals[0]?.rejectionReasons).toEqual(
      expect.arrayContaining([
        "replacement-evidence-not-strictly-stronger",
        "replacement-acoustic-support-insufficient",
        "hallucination-risk-would-increase",
      ]),
    );

    const same = evidenceFixture({ selectedText: "お は よ" });
    const sameProposals = buildCanonicalMutationProposals({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      cues,
      lineage,
      variantEvidence: same,
      selections: [
        {
          eventId: "event-1",
          currentVariantId: "current",
          selectedVariantId: "selected",
        },
      ],
      candidateTexts: [
        { variantId: "current", text: "おはよ", hallucinationRisk: 0.1 },
        { variantId: "selected", text: "お は よ", hallucinationRisk: 0.1 },
      ],
      timing: noTiming({ cues, lineage, variants: same }),
    });
    expect(sameProposals.proposals[0]?.applyStatus).toBe("NO_OP");
  });

  it("emits an explicit rejection for a one-to-many final lineage", () => {
    const cues = [cue("cue-1", "おは", 10, 11), cue("cue-2", "よ", 11, 12)];
    const lineage = buildEventFinalCueLineage({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          candidateIds: ["candidate-1"],
          canonicalCueIds: ["canonical-1"],
        },
      ],
      finalCueIds: ["cue-1", "cue-2"],
      edges: [
        {
          sourceIds: ["canonical-1"],
          targetIds: ["cue-1", "cue-2"],
          relationType: "SPLIT",
          operationArtifact: "split.json",
          reason: "one event split into two final cues",
        },
      ],
      dropped: [],
    });
    const variants = evidenceFixture();
    const proposals = buildCanonicalMutationProposals({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      cues,
      lineage,
      variantEvidence: variants,
      selections: [
        {
          eventId: "event-1",
          currentVariantId: "current",
          selectedVariantId: "selected",
        },
      ],
      candidateTexts: [
        { variantId: "current", text: "おはよ", hallucinationRisk: 0.2 },
        { variantId: "selected", text: "おはよう", hallucinationRisk: 0.1 },
      ],
      timing: buildTrustedTokenTimingProposals({
        mode: "enforce",
        generatedAt: GENERATED_AT,
        cues,
        lineage,
        variantEvidence: variants,
        selectedVariantByEvent: new Map([["event-1", "selected"]]),
        tokens: [],
        timingEligibleCueIds: new Set(),
      }),
    });
    expect(proposals.proposals[0]).toMatchObject({
      finalCueIds: ["cue-1", "cue-2"],
      applyStatus: "REJECTED",
      lineageVerified: false,
    });
    expect(proposals.proposals[0]?.rejectionReasons).toContain(
      "event-final-lineage-not-single-target",
    );
  });
});

describe("C6.0.1.5 trusted token timing application", () => {
  function timingFixture(input?: {
    tokenIntervals?: readonly { start: number; end: number }[];
    tokenText?: string;
    overlapBlocked?: boolean;
    variants?: ReturnType<typeof evidenceFixture>;
    lineage?: ReturnType<typeof exactLineage>;
  }) {
    const cues = [
      cue("cue-1", "おはよ", 10, 12),
      cue("cue-2", "次です", 13, 15),
    ];
    const lineage = input?.lineage ?? exactLineage();
    const variants = input?.variants ?? evidenceFixture();
    const intervals = input?.tokenIntervals ?? [
      { start: 10.2, end: 10.9 },
      { start: 10.9, end: 11.7 },
    ];
    const tokens: TrustedVariantToken[] = intervals.map((interval, index) => ({
      tokenId: `trusted-${index + 1}`,
      variantId: "selected",
      trusted: true,
      lexical: true,
      sourceGlobalInterval: interval,
    }));
    const timing = buildTrustedTokenTimingProposals({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      cues,
      lineage,
      variantEvidence: variants,
      selectedVariantByEvent: new Map([["event-1", "selected"]]),
      tokens,
      timingEligibleCueIds: new Set(["cue-1"]),
      overlapBlockedCueIds: input?.overlapBlocked
        ? new Set(["cue-1"])
        : new Set(),
    });
    return { cues, lineage, variants, timing, tokens };
  }

  it("uses trusted start/end tokens with the fixed non-Gold padding", () => {
    const fixture = timingFixture();
    expect(fixture.timing.paddingPolicy).toEqual({
      policyVersion: "c6.0.1.5-fixed-token-padding-v1",
      startSeconds: 0.04,
      endSeconds: 0.08,
      goldTuned: false,
    });
    expect(fixture.timing.proposals[0]).toMatchObject({
      tokenSpan: { start: 10.2, end: 11.7 },
      proposedInterval: { start: 10.16, end: 11.78 },
      proposalStatus: "ACCEPTED",
      blockers: [],
    });
  });

  it("rejects insufficient lexical coverage, overlap, non-degradation, and non-unique lineage", () => {
    const lowCoverage = evidenceFixture({ selectedTokenText: "お" });
    expect(
      timingFixture({ variants: lowCoverage }).timing.proposals[0]?.blockers,
    ).toContain("lexical-token-coverage-below-0.8");
    expect(
      timingFixture({ overlapBlocked: true }).timing.proposals[0]?.blockers,
    ).toContain("speaker-or-overlap-contradiction");
    expect(
      timingFixture({
        tokenIntervals: [{ start: 10.8, end: 10.9 }],
      }).timing.proposals[0]?.blockers,
    ).toContain("duration-ratio-non-degradation-failed");

    const manyLineage = buildEventFinalCueLineage({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          candidateIds: ["candidate-1"],
          canonicalCueIds: ["canonical-1"],
        },
        {
          eventId: "event-2",
          candidateIds: ["candidate-2"],
          canonicalCueIds: ["canonical-2"],
        },
      ],
      finalCueIds: ["cue-1"],
      edges: [
        {
          sourceIds: ["canonical-1", "canonical-2"],
          targetIds: ["cue-1"],
          relationType: "MERGE",
          operationArtifact: "merge.json",
          reason: "two events merged",
        },
      ],
      dropped: [],
    });
    expect(
      timingFixture({ lineage: manyLineage }).timing.proposals[0]?.blockers,
    ).toContain("lineage-not-single-target-modifiable");
  });
});

describe("C6.0.1.5 canonical mutation application", () => {
  it("applies text and timing to the strict package and all three rendered formats", () => {
    const text = acceptedTextProposal();
    const timingBase = buildTrustedTokenTimingProposals({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      cues: text.cues,
      lineage: text.lineage,
      variantEvidence: text.variants,
      selectedVariantByEvent: new Map([["event-1", "selected"]]),
      tokens: [
        {
          tokenId: "trusted-1",
          variantId: "selected",
          trusted: true,
          lexical: true,
          sourceGlobalInterval: { start: 10.2, end: 11.7 },
        },
      ],
      timingEligibleCueIds: new Set(["cue-1"]),
    });
    const proposals = buildCanonicalMutationProposals({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      cues: text.cues,
      lineage: text.lineage,
      variantEvidence: text.variants,
      selections: [
        {
          eventId: "event-1",
          currentVariantId: "current",
          selectedVariantId: "selected",
        },
      ],
      candidateTexts: [
        { variantId: "current", text: "おはよ", hallucinationRisk: 0.2 },
        { variantId: "selected", text: "おはよう", hallucinationRisk: 0.1 },
      ],
      timing: timingBase,
    });
    const beforePackage = packageFixture(text.cues);
    const beforeHash = machineQualitySemanticHash(beforePackage);
    const result = applyCanonicalMutations({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      package: beforePackage,
      proposals,
      lineage: text.lineage,
    });

    expect(result.package.cues[0]).toMatchObject({
      text: "おはよう",
      start: 10.16,
      end: 11.78,
    });
    expect(result.package.cues[0]?.textAudit).toMatchObject({
      rawAsrText: "おはよ",
      repairedText: "おはよう",
      reviewRecommended: true,
    });
    expect(subtitlePackageSchema.parse(result.package)).toEqual(result.package);
    expect(result.ledger.summary).toMatchObject({
      appliedCount: 2,
      textMutationAppliedCount: 1,
      timingMutationAppliedCount: 1,
      finalArtifactMutationCount: 2,
    });
    expect(result.ledger.finalHashes.packageHash).not.toBe(beforeHash);
    expect(result.serialized.srt).toContain("おはよう");
    expect(result.serialized.vtt).toContain("おはよう");
    expect(result.serialized.ass).toContain("おはよう");
    for (const record of result.ledger.records) {
      expect(record.renderedSrtHashAfter).not.toBe(
        record.renderedSrtHashBefore,
      );
      expect(record.renderedVttHashAfter).not.toBe(
        record.renderedVttHashBefore,
      );
      expect(record.renderedAssHashAfter).not.toBe(
        record.renderedAssHashBefore,
      );
      expect(record.lineageStillValid).toBe(true);
      expect(record.strictPackageValidationPassed).toBe(true);
    }
  });

  it("does not mutate in observe mode and rolls back an invalid strict cue", () => {
    const fixture = acceptedTextProposal();
    const original = packageFixture(fixture.cues);
    const observed = applyCanonicalMutations({
      mode: "observe",
      generatedAt: GENERATED_AT,
      package: original,
      proposals: fixture.proposals,
      lineage: fixture.lineage,
    });
    expect(observed.package).toEqual(original);
    expect(observed.ledger.summary.appliedCount).toBe(0);

    const invalid = structuredClone(fixture.proposals);
    const proposal = invalid.proposals[0];
    if (proposal === undefined) throw new Error("fixture proposal missing");
    proposal.afterText = "";
    const reparsed = machineCanonicalMutationProposalsSchema.parse({
      ...invalid,
      semanticHash: machineQualitySemanticHash({
        mode: invalid.mode,
        proposals: invalid.proposals,
        summary: invalid.summary,
      }),
    });
    const rolledBack = applyCanonicalMutations({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      package: original,
      proposals: reparsed,
      lineage: fixture.lineage,
    });
    expect(rolledBack.package).toEqual(original);
    expect(rolledBack.ledger.records[0]).toMatchObject({
      applyStatus: "ROLLED_BACK",
      strictPackageValidationPassed: false,
      renderedOutputChanged: false,
    });
  });
});
