import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  c60113ShareableSummarySchema,
  c60113UiAcceptanceResultsSchema,
  type C60113MissingSpeechEvidence,
  type C60113RegionRankingEvaluation,
} from "@mvl/shared";
import { buildC60113ReviewPolicy } from "../packages/video-subtitler/src/review/c60113-policy.js";
import { machineQualitySemanticHash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { buildC60113MissingSpeechEvidence } from "../packages/video-subtitler/src/review/missing-speech-evidence-v2.js";
import {
  buildC60113EvidenceFamilyGraph,
  c60113Observation,
} from "../packages/video-subtitler/src/review/review-evidence-family-graph.js";
import {
  c60113AcceptanceRoute,
  c60113AudioBurdenAccounting,
  c60113LegacyAudioFreezeProvenance,
  c60113MissingMandatoryValid,
  c60113ShareableLeakCounts,
  validateC60113Runs,
} from "../scripts/validate-c6-0-1-13-runs.js";

const policy = buildC60113ReviewPolicy();
const hash = "1".repeat(64);
const nonmatchingGoldHash = "2".repeat(64);
const temporaryDirectories: string[] = [];
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

type RoutingEvaluation = Pick<
  C60113RegionRankingEvaluation,
  | "rankingResult"
  | "burdenResult"
  | "requiredSafetyRecall"
  | "requiredUniqueAudioRatio"
>;
function evaluation(
  overrides: Partial<RoutingEvaluation> = {},
): RoutingEvaluation {
  return {
    rankingResult: "REGION_RANKER_STRONG_PASS",
    burdenResult: "REVIEW_BURDEN_STRONG_REDUCTION",
    requiredSafetyRecall: { hallucination: 1, missingDialogue: 1 },
    requiredUniqueAudioRatio: 0.3,
    ...overrides,
  };
}
function route(overrides: Partial<RoutingEvaluation> = {}) {
  return c60113AcceptanceRoute({
    evaluation: evaluation(overrides),
    workflowPassed: true,
    instrumentationStatus: "PASSED",
  });
}
function shareable() {
  return c60113ShareableSummarySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: policy.policyVersion,
    generatedAt: "2026-01-01T00:00:00.000Z",
    artifactType: "c6-0-1-13-shareable-review-burden-summary",
    audience: "AGGREGATE_AUDIT_ONLY",
    itemCount: 3,
    regionCount: 2,
    requiredItemCount: 1,
    requiredRegionCount: 1,
    clipSumSeconds: 14,
    actualClipSumSeconds: 14,
    clipSumMeaning: "ACTUAL_EXTRACTED_WAV_DURATION_SUM",
    plannedContextSumSeconds: 12,
    extractedClipUnionSeconds: 12,
    uniqueUnionSeconds: 10,
    uniqueUnionMeaning: "PLANNED_REVIEW_PLAYBACK_UNION",
    duplicateContextSeconds: 2,
    duplicateContextMeaning: "PLANNED_CONTEXT_SUM_MINUS_PLANNED_UNION",
    requiredUniqueSeconds: 5,
    requiredUniqueRatio: 0.1,
    maxScoreShare: 1 / 3,
    maximumTieCount: 1,
    absenceRiskBoostCount: 0,
    canonicalTextMutationCount: 0,
    canonicalTimingMutationCount: 0,
    rankingResult: "REGION_RANKER_WEAK",
    burdenResult: "REVIEW_BURDEN_REDUCTION_UNSAFE",
    route: "HOLD_FOR_REVIEW_RANKER_REDESIGN",
    humanReviewTimeMeasured: false,
    realHumanSessionExecuted: false,
    sourceAudioIncluded: false,
    dialogueIncluded: false,
    privateEventsIncluded: false,
    approvedHashes: {
      policy: hash,
      machineFreeze: hash,
      rankerFreeze: hash,
      items: hash,
      regions: hash,
      playback: hash,
      plans: hash,
    },
    semanticHash: hash,
  });
}
function strongMissing(): C60113MissingSpeechEvidence {
  const observations = [
    "SPEECH_ACTIVITY",
    "ASR_LEXICAL_CONTENT",
    "ACOUSTIC_ALIGNMENT",
  ].map((family, index) =>
    c60113Observation({
      evidenceId: `evidence-${index}`,
      rootLineageIds: [`independent-root-${index}`],
      family: family as
        "SPEECH_ACTIVITY" | "ASR_LEXICAL_CONTENT" | "ACOUSTIC_ALIGNMENT",
      provider: `synthetic-independent-provider-${index}`,
      correlationGroup: `group-${index}`,
      itemIds: ["item"],
      gapIds: ["gap"],
      sourceInterval: { start: 2, end: 4 },
      positiveRisk: family !== "SPEECH_ACTIVITY",
      evidenceAbsence: false,
      contradiction: false,
      strength: 0.95,
      validatedSourceGlobal: true,
      detailCode: "SYNTHETIC_LOCALIZED_EVIDENCE",
    }),
  );
  return buildC60113MissingSpeechEvidence({
    gaps: [
      {
        gapId: "gap",
        sourceInterval: { start: 2, end: 4 },
        itemIds: ["item"],
        legacySignal: true,
        validatedSourceGlobal: true,
        cueCoveredRatio: 0,
      },
    ],
    evidenceFamilies: buildC60113EvidenceFamilyGraph({ observations, policy }),
    legacyMissingItemCount: 1,
    policy,
  });
}

describe("C6.0.1.13 acceptance route truthfulness", () => {
  it("requires both strong ranking and strong reduction for the unrestricted future-trial route", () => {
    expect(route().route).toBe("GO_TO_NEW_EPISODE_PROSPECTIVE_HUMAN_TRIAL");
    expect(
      route({ burdenResult: "REVIEW_BURDEN_PROMISING_REDUCTION" }).route,
    ).toBe("GO_TO_NEW_EPISODE_TRIAL_WITH_RANKING_CAVEAT");
  });

  it("allows only a caveated future trial at the promising fifty-percent boundary", () => {
    expect(
      route({
        rankingResult: "REGION_RANKER_PROMISING",
        burdenResult: "REVIEW_BURDEN_PROMISING_REDUCTION",
        requiredUniqueAudioRatio: 0.5,
      }).route,
    ).toBe("GO_TO_NEW_EPISODE_TRIAL_WITH_RANKING_CAVEAT");
    expect(
      route({
        rankingResult: "REGION_RANKER_PROMISING",
        burdenResult: "REVIEW_BURDEN_PROMISING_REDUCTION",
        requiredUniqueAudioRatio: 0.500001,
      }).route,
    ).toBe("HOLD_FOR_REVIEW_RANKER_REDESIGN");
  });

  it("does not interpret a numerical burden reduction as recovered missing dialogue", () => {
    expect(
      route({
        requiredUniqueAudioRatio: 0.01,
        requiredSafetyRecall: { hallucination: 1, missingDialogue: 5 / 6 },
      }).route,
    ).toBe("HOLD_FOR_MISSING_EVIDENCE_REPAIR");
  });

  it.each(["REGION_RANKER_WEAK", "REGION_RANKER_UNSUPPORTED"] as const)(
    "holds unsafe ranking %s",
    (rankingResult) => {
      expect(route({ rankingResult }).route).toBe(
        "HOLD_FOR_REVIEW_RANKER_REDESIGN",
      );
    },
  );

  it("holds hallucination misses and unproven burden reduction", () => {
    expect(
      route({ requiredSafetyRecall: { hallucination: 0, missingDialogue: 1 } })
        .route,
    ).toBe("HOLD_FOR_REVIEW_RANKER_REDESIGN");
    expect(
      route({ burdenResult: "REVIEW_BURDEN_NO_MEANINGFUL_REDUCTION" }).route,
    ).toBe("HOLD_FOR_REVIEW_RANKER_REDESIGN");
  });

  it("does not report ready when an engineering or privacy check is incomplete", () => {
    expect(
      c60113AcceptanceRoute({
        evaluation: evaluation(),
        workflowPassed: false,
        instrumentationStatus: "PASSED",
      }).readiness,
    ).toBe("PROSPECTIVE_HUMAN_TRIAL_NOT_READY_WORKFLOW");
  });

  it("requires completed synthetic instrumentation without inventing a human session", () => {
    expect(
      c60113AcceptanceRoute({
        evaluation: evaluation(),
        workflowPassed: true,
        instrumentationStatus: "NOT_RUN",
      }).readiness,
    ).toBe("PROSPECTIVE_HUMAN_TRIAL_NOT_READY_INSTRUMENTATION");
    expect(route().readiness).toBe(
      "PROSPECTIVE_HUMAN_TRIAL_READY_NOT_EXECUTED",
    );
  });
});

describe("C6.0.1.13 strict aggregate privacy and evidence acceptance", () => {
  it("verifies legacy freeze hashes against complete artifacts rather than their nested semantic hashes", () => {
    const regions = { semanticHash: hash, regions: [{ regionId: "fixture" }] };
    const audioManifest = { semanticHash: nonmatchingGoldHash, clips: [] };
    const freeze = {
      semanticHash: hash,
      regionHash: machineQualitySemanticHash(regions),
      audioManifestHash: machineQualitySemanticHash(audioManifest),
    };
    const input = { expectedFreezeHash: hash, freeze, regions, audioManifest };
    expect(c60113LegacyAudioFreezeProvenance(input)).toBe(true);
    expect(
      c60113LegacyAudioFreezeProvenance({
        ...input,
        freeze: { ...freeze, regionHash: regions.semanticHash },
      }),
    ).toBe(false);
    expect(
      c60113LegacyAudioFreezeProvenance({
        ...input,
        freeze: { ...freeze, audioManifestHash: audioManifest.semanticHash },
      }),
    ).toBe(false);
    expect(
      c60113LegacyAudioFreezeProvenance({
        ...input,
        regions: { ...regions, unexpected: "tampering" },
      }),
    ).toBe(false);
  });

  it("does not count unused extraction padding as duplicated planned playback", () => {
    const accounting = c60113AudioBurdenAccounting({
      plannedIntervals: [
        { start: 1.5, end: 5.5 },
        { start: 5, end: 9 },
      ],
      clips: [
        { extractedInterval: { start: 1, end: 6 }, actualDurationSeconds: 5 },
        {
          extractedInterval: { start: 4.5, end: 9.5 },
          actualDurationSeconds: 5,
        },
      ],
    });
    expect(accounting.actualClipSumSeconds).toBe(10);
    expect(accounting.clipSumSeconds).toBe(10);
    expect(accounting.plannedContextSumSeconds).toBe(8);
    expect(accounting.uniqueUnionSeconds).toBe(7.5);
    expect(accounting.extractedClipUnionSeconds).toBe(8.5);
    expect(accounting.duplicateContextSeconds).toBe(0.5);
    expect(accounting.duplicateContextSeconds).not.toBe(
      accounting.actualClipSumSeconds - accounting.uniqueUnionSeconds,
    );
  });

  it("rejects invalid or fabricated negative audio accounting", () => {
    expect(() =>
      c60113AudioBurdenAccounting({
        plannedIntervals: [{ start: 2, end: 1 }],
        clips: [],
      }),
    ).toThrow("INVALID_AUDIO_ACCOUNTING_INTERVAL");
    expect(() =>
      c60113AudioBurdenAccounting({
        plannedIntervals: [],
        clips: [
          {
            extractedInterval: { start: 1, end: 2 },
            actualDurationSeconds: -1,
          },
        ],
      }),
    ).toThrow("INVALID_ACTUAL_CLIP_DURATION");
  });

  it("permits only anonymous aggregates and an explicit approved hash vocabulary", () => {
    expect(c60113ShareableLeakCounts(shareable(), nonmatchingGoldHash)).toEqual(
      { absolutePathLeakCount: 0, secretCount: 0, goldIdentityLeakCount: 0 },
    );
    expect(() =>
      c60113ShareableLeakCounts(
        { ...shareable(), dialogue: "private content" },
        nonmatchingGoldHash,
      ),
    ).toThrow();
    expect(() =>
      c60113ShareableLeakCounts(
        { ...shareable(), reviewerNotes: "private notes" },
        nonmatchingGoldHash,
      ),
    ).toThrow();
    expect(() =>
      c60113ShareableLeakCounts(
        { ...shareable(), sourcePath: "/private/source.wav" },
        nonmatchingGoldHash,
      ),
    ).toThrow();
    expect(() =>
      c60113ShareableLeakCounts(
        { ...shareable(), sourceAudioIncluded: true },
        nonmatchingGoldHash,
      ),
    ).toThrow();
  });

  it("catches a Gold identity even if accidentally put into an otherwise approved hash field", () => {
    const value = shareable();
    value.approvedHashes.policy = nonmatchingGoldHash;
    expect(
      c60113ShareableLeakCounts(value, nonmatchingGoldHash)
        .goldIdentityLeakCount,
    ).toBe(1);
  });

  it("requires verified strong missing proof for REQUIRED and rejects faked promotions", () => {
    const missing = strongMissing();
    expect(missing.gaps[0]?.classification).toBe("MISSING_DIALOGUE_STRONG");
    expect(c60113MissingMandatoryValid(missing)).toBe(true);
    const gap = missing.gaps[0];
    if (gap === undefined)
      throw new Error("Synthetic strong missing gap missing");
    expect(
      c60113MissingMandatoryValid({
        ...missing,
        gaps: [{ ...gap, classification: "SPEECH_GAP_OBSERVED" }],
      }),
    ).toBe(false);
    expect(
      c60113MissingMandatoryValid({
        ...missing,
        gaps: [{ ...gap, validatedSourceGlobal: false }],
      }),
    ).toBe(false);
    expect(
      c60113MissingMandatoryValid({
        ...missing,
        gaps: [{ ...gap, lexicalEvidence: [] }],
      }),
    ).toBe(false);
    expect(
      c60113MissingMandatoryValid({
        ...missing,
        gaps: [{ ...gap, independentFamilyCount: 2 }],
      }),
    ).toBe(false);
  });

  it("can record unknown hardcoding audit results without inventing zero", () => {
    expect(
      c60113UiAcceptanceResultsSchema.parse({
        checks: [],
        instrumentationTestStatus: "NOT_RUN",
        datasetSpecificHardcodingCount: null,
      }).datasetSpecificHardcodingCount,
    ).toBeNull();
  });

  it("refuses to overwrite acceptance before touching missing source or Gold files", async () => {
    const outputRoot = await mkdtemp(
      path.join(os.tmpdir(), "c60113-acceptance-test-"),
    );
    temporaryDirectories.push(outputRoot);
    await mkdir(path.join(outputRoot, "fixture-validation-20260101"));
    await expect(
      validateC60113Runs({
        outputRoot,
        outputPrefix: "fixture",
        outputDate: "20260101",
        upstreamPrefix: "prior",
        upstreamDate: "20260101",
        source: path.join(outputRoot, "nonexistent-source"),
        gold: path.join(outputRoot, "nonexistent-gold"),
        generatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("EXISTING_ACCEPTANCE_NOT_OVERWRITTEN");
    expect(await readdir(outputRoot)).toEqual(["fixture-validation-20260101"]);
  });

  it("rejects output path traversal before loading artifacts", async () => {
    await expect(
      validateC60113Runs({
        outputRoot: os.tmpdir(),
        outputPrefix: "../escape",
        outputDate: "20260101",
        upstreamPrefix: "prior",
        upstreamDate: "20260101",
        source: "/nonexistent-source",
        gold: "/nonexistent-gold",
        generatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("UNSAFE_OUTPUT_RUN_PREFIX");
  });
});
