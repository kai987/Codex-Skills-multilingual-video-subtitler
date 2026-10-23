import { describe, expect, it } from "vitest";

import { decoderEvidenceSchema, type DecoderEvidence } from "@mvl/shared";
import {
  buildEventFinalCueLineage,
  buildVariantEvidenceBundle,
  type PipelineLineageEdge,
  type VariantEvidenceInput,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-28T00:00:00.000Z";
const HASH = "a".repeat(64);

function availableDecoder(
  overrides: Partial<DecoderEvidence> = {},
): DecoderEvidence {
  return decoderEvidenceSchema.parse({
    status: "available",
    averageLogProbability: 0,
    noSpeechProbability: 0,
    compressionRatio: 0,
    repetitionRatio: 0,
    tokenTimingQuality: 0,
    textDensity: 0,
    edgePosition: "inside",
    fallbackLevel: 0,
    temperature: 0,
    requestDurationSeconds: 1,
    decoderEvidenceHash: HASH,
    unavailableReasons: [],
    ...overrides,
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
    unavailableReasons: ["legacy-response-did-not-persist-decoder-metrics"],
  });
}

function lineageFixture(
  edgesOverride?: readonly PipelineLineageEdge[] | "reverse",
) {
  const edges: PipelineLineageEdge[] = [
    {
      sourceIds: ["canonical-1"],
      targetIds: ["assembled-1"],
      relationType: "CANONICAL_ASSEMBLY",
      operationArtifact: "01-assembly.json",
      reason: "canonical cue entered assembly",
    },
    {
      sourceIds: ["assembled-1"],
      targetIds: ["final-1"],
      relationType: "FINAL_SURVIVAL",
      operationArtifact: "02-survival.json",
      reason: "assembled cue survived",
    },
    {
      sourceIds: ["canonical-2"],
      targetIds: ["split-2a", "split-2b"],
      relationType: "SPLIT",
      operationArtifact: "03-split.json",
      reason: "one canonical cue split at a pause",
    },
    {
      sourceIds: ["split-2a"],
      targetIds: ["final-2"],
      relationType: "FINAL_SURVIVAL",
      operationArtifact: "04-survival.json",
      reason: "first split survived",
    },
    {
      sourceIds: ["split-2b"],
      targetIds: ["final-3"],
      relationType: "FINAL_SURVIVAL",
      operationArtifact: "04-survival.json",
      reason: "second split survived",
    },
    {
      sourceIds: ["canonical-3", "canonical-4"],
      targetIds: ["merged-34"],
      relationType: "MERGE",
      operationArtifact: "05-merge.json",
      reason: "adjacent event cues merged",
    },
    {
      sourceIds: ["merged-34"],
      targetIds: ["final-4"],
      relationType: "FINAL_SURVIVAL",
      operationArtifact: "06-survival.json",
      reason: "merged cue survived",
    },
    {
      sourceIds: ["canonical-5"],
      targetIds: ["deduped-5"],
      relationType: "DEDUPE",
      operationArtifact: "07-dedupe.json",
      reason: "duplicate text removed with identity retained",
    },
    {
      sourceIds: ["deduped-5"],
      targetIds: ["final-5"],
      relationType: "FINAL_SURVIVAL",
      operationArtifact: "08-survival.json",
      reason: "deduped cue survived",
    },
    {
      sourceIds: ["canonical-7"],
      targetIds: ["orphan-7a", "orphan-7b"],
      relationType: "SPLIT",
      operationArtifact: "09-orphan-split.json",
      reason: "two terminal identities lack final survival",
    },
  ];
  return buildEventFinalCueLineage({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    events: Array.from({ length: 8 }, (_value, index) => ({
      eventId: `event-${index + 1}`,
      candidateIds: [`candidate-${index + 1}`],
      canonicalCueIds: [`canonical-${index + 1}`],
    })),
    finalCueIds: ["final-1", "final-2", "final-3", "final-4", "final-5"],
    edges:
      edgesOverride === "reverse"
        ? edges.toReversed()
        : (edgesOverride ?? edges),
    dropped: [
      {
        sourceId: "canonical-6",
        operationArtifact: "10-drop.json",
        reason: "explicit machine hallucination drop",
      },
    ],
  });
}

function variant(input: {
  variantId: string;
  eventId?: string;
  text?: string;
  decoder?: DecoderEvidence;
  reAsr?: boolean;
}): VariantEvidenceInput {
  return {
    variantId: input.variantId,
    eventId: input.eventId ?? "event-1",
    candidateId: `candidate:${input.variantId}`,
    text: input.text ?? "はい",
    interval: { start: 10.2, end: 11.8 },
    eventInterval: { start: 10, end: 12 },
    requestIds: [`request:${input.variantId}`],
    sourceWindowIds: [`window:${input.variantId}`],
    independentSupportGroups: [`independent:${input.variantId}`],
    correlatedSupportGroups: [`correlated:${input.variantId}`],
    speechCoverage: 0.9,
    reAsrOrigin: {
      isReAsr: input.reAsr ?? false,
      requestFamilyIds: input.reAsr ? [`family:${input.variantId}`] : [],
      sourceGlobalVerified: true,
      promptIsolated: true,
    },
    decoderEvidence: input.decoder ?? availableDecoder(),
  };
}

describe("C6.0.1.5 event to final cue lineage", () => {
  it("records full one-to-one, split, merge, dedupe, drop, ambiguous, and unresolved histories", () => {
    const artifact = lineageFixture();
    const byId = new Map(
      artifact.events.map((event) => [event.eventId, event] as const),
    );

    expect(byId.get("event-1")).toMatchObject({
      finalCueIds: ["final-1"],
      lineageStatus: "EXACT_ONE_TO_ONE",
      modifiable: true,
    });
    expect(byId.get("event-1")?.lineageOperations).toHaveLength(2);
    expect(byId.get("event-2")).toMatchObject({
      finalCueIds: ["final-2", "final-3"],
      lineageStatus: "ONE_TO_MANY",
      modifiable: false,
    });
    expect(byId.get("event-2")?.splitRelations).toHaveLength(1);
    expect(byId.get("event-3")).toMatchObject({
      finalCueIds: ["final-4"],
      lineageStatus: "MANY_TO_ONE",
      modifiable: false,
    });
    expect(byId.get("event-4")?.mergeRelations).toHaveLength(1);
    expect(byId.get("event-5")?.dedupeRelations).toHaveLength(1);
    expect(byId.get("event-6")).toMatchObject({
      lineageStatus: "DROPPED",
      finalCueIds: [],
      modifiable: false,
    });
    expect(byId.get("event-7")?.lineageStatus).toBe("AMBIGUOUS");
    expect(byId.get("event-8")?.lineageStatus).toBe("UNRESOLVED");
    expect(artifact.summary.timeNearestIdentityCount).toBe(0);
    expect(artifact.identityPolicy).toBe(
      "operation-history-only-no-time-nearest",
    );
  });

  it("has an order-independent deterministic semantic hash", () => {
    const first = lineageFixture();
    const second = lineageFixture("reverse");
    expect(second.semanticHash).toBe(first.semanticHash);
    expect(second.events.map((event) => event.semanticHash)).toEqual(
      first.events.map((event) => event.semanticHash),
    );
  });
});

describe("C6.0.1.5 variant-specific evidence bundle", () => {
  it("keeps representative, duplicate, and re-ASR tokens isolated by exact variant id", () => {
    const artifact = buildVariantEvidenceBundle({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      variants: [
        variant({ variantId: "representative", text: "はい" }),
        variant({ variantId: "duplicate", text: "はい" }),
        variant({
          variantId: "targeted-reasr:new",
          text: "いいえ",
          reAsr: true,
        }),
      ],
      tokens: [
        {
          tokenId: "token-representative",
          variantId: "representative",
          text: "はい",
          lexical: true,
          trusted: true,
        },
        {
          tokenId: "token-reasr",
          variantId: "targeted-reasr:new",
          text: "いいえ",
          lexical: true,
          trusted: true,
        },
        {
          tokenId: "unassigned-token",
          variantId: null,
          text: "はい",
          lexical: true,
          trusted: true,
        },
      ],
      ctcEvidence: [
        {
          variantId: "representative",
          evidenceId: "ctc-representative",
          score: 0.8,
          edgePinned: false,
        },
        {
          variantId: "duplicate",
          evidenceId: "ctc-duplicate",
          score: 0.7,
          edgePinned: false,
        },
        {
          variantId: "targeted-reasr:new",
          evidenceId: "ctc-reasr",
          score: 0.9,
          edgePinned: false,
        },
      ],
    });
    const byId = new Map(
      artifact.variants.map((entry) => [entry.variantId, entry] as const),
    );

    expect(byId.get("representative")?.trustedGlobalTokenIds).toEqual([
      "token-representative",
    ]);
    expect(byId.get("duplicate")?.trustedGlobalTokenIds).toEqual([]);
    expect(byId.get("duplicate")?.tokenCoverage.coverageRatio).toBe(0);
    expect(byId.get("targeted-reasr:new")).toMatchObject({
      trustedGlobalTokenIds: ["token-reasr"],
      reAsrOrigin: {
        isReAsr: true,
        sourceGlobalVerified: true,
        promptIsolated: true,
      },
      independentSupportGroups: ["independent:targeted-reasr:new"],
      correlatedSupportGroups: ["correlated:targeted-reasr:new"],
    });
    expect(artifact.summary.representativeTokenLeakCount).toBe(0);
    expect(artifact.summary.fabricatedDecoderZeroCount).toBe(0);
  });

  it("distinguishes real decoder zeros from unavailable evidence", () => {
    const artifact = buildVariantEvidenceBundle({
      mode: "observe",
      generatedAt: GENERATED_AT,
      variants: [
        variant({ variantId: "real-zero", decoder: availableDecoder() }),
        variant({
          variantId: "unavailable",
          decoder: unavailableDecoder(),
        }),
      ],
      tokens: [],
      ctcEvidence: [],
    });
    expect(
      artifact.variants.find((entry) => entry.variantId === "real-zero")
        ?.decoderEvidence,
    ).toMatchObject({
      status: "available",
      averageLogProbability: 0,
      noSpeechProbability: 0,
    });
    expect(
      artifact.variants.find((entry) => entry.variantId === "unavailable")
        ?.decoderEvidence,
    ).toMatchObject({
      status: "unavailable",
      averageLogProbability: null,
      noSpeechProbability: null,
    });
    expect(() =>
      decoderEvidenceSchema.parse({
        ...unavailableDecoder(),
        averageLogProbability: 0,
      }),
    ).toThrow(/fabricated values/u);
  });
});
