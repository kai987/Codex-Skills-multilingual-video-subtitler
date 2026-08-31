import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  c60114PhysicalAudioSchema,
  c60114ReviewRegionsV3Schema,
  c60114ReviewTargetsSchema,
  c60114ReviewAudioManifestV3Schema,
  c60114LocalizedLexicalEvidenceSchema,
  c60114MissingSpeechEvidenceV3Schema,
  c60114PlaybackTimelineV2Schema,
  c60114WorkspaceExtensionSchema,
  type C60114SourceIdentity,
  type C60114PhysicalAudio,
  type C60114ReviewRegionV3,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import {
  buildC60114Policy,
  c60114ArtifactHeader,
  c60114Union,
  withC60114SemanticHash,
} from "../packages/video-subtitler/src/review/c60114-policy.js";
import { buildC60114ReviewAudio } from "../packages/video-subtitler/src/review/review-audio-manifest-v3.js";
import { buildC60114PlaybackTimeline } from "../packages/video-subtitler/src/review/review-playback-timeline-v2.js";
import {
  assertC60114WorkspaceExtension,
  buildC60114WorkspaceExtension,
  c60114TransactionActions,
} from "../packages/video-subtitler/src/review/c60114-review-workspace.js";
import { inspectReviewWav } from "../packages/video-subtitler/src/review-audio.js";
import { c60113SyntheticWorkspace } from "./fixtures/c60113-workspace-fixture.js";

const policy = buildC60114Policy(),
  hash = "b".repeat(64),
  generatedAt = "2026-01-01T00:00:00.000Z";
const signed = withC60114SemanticHash;
describe("C60114 legacy transaction action projection", () => {
  it("does not expose single-cue or insertion actions for a migrated multi-cue item", () => {
    expect(
      c60114TransactionActions({
        finalCueIds: ["cue-a", "cue-b", "cue-c"],
        suggestedActions: [
          "ADD_NEW_CUE",
          "KEEP_CURRENT",
          "MANUAL_EDIT",
          "MARK_FALSE_POSITIVE",
          "UNRESOLVED",
          "USE_REAZON",
          "USE_WHISPER_ALTERNATE",
        ],
        previousUiActions: ["KEEP_CURRENT", "UNRESOLVED"],
      }),
    ).toEqual(["KEEP_CURRENT", "UNRESOLVED"]);
  });
  it("does not re-enable an action filtered by the previous transaction UI", () => {
    expect(
      c60114TransactionActions({
        finalCueIds: ["cue-a"],
        suggestedActions: ["KEEP_CURRENT", "USE_REAZON", "UNRESOLVED"],
        previousUiActions: ["KEEP_CURRENT", "UNRESOLVED"],
      }),
    ).toEqual(["KEEP_CURRENT", "UNRESOLVED"]);
  });
  it("retains zero-cue human actions without inventing current cue mutation", () => {
    expect(
      c60114TransactionActions({
        finalCueIds: [],
        suggestedActions: [
          "ADD_NEW_CUE",
          "MARK_FALSE_POSITIVE",
          "UNRESOLVED",
          "WAIVE_REVIEW",
          "MANUAL_EDIT",
        ],
      }),
    ).toEqual([
      "ADD_NEW_CUE",
      "MARK_FALSE_POSITIVE",
      "UNRESOLVED",
      "WAIVE_REVIEW",
    ]);
  });
});
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("SYNTHETIC_FIXTURE_ROW_MISSING");
  return value;
}
function rehash<T extends { semanticHash: string }>(value: T): T {
  const { semanticHash: old, ...core } = value;
  void old;
  return { ...core, semanticHash: machineQualitySemanticHash(core) } as T;
}
function wav(seconds: number, sampleRate = 16000): Buffer {
  const frames = Math.round(seconds * sampleRate),
    bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 2048),
      44 + i * 2,
    );
  return bytes;
}
let root: string, sourcePath: string, source: C60114SourceIdentity;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "c60114-review-delivery-"));
  sourcePath = path.join(root, "synthetic-source.wav");
  const bytes = wav(40, 48000);
  await writeFile(sourcePath, bytes);
  source = {
    sourceMediaSha256: createHash("sha256").update(bytes).digest("hex"),
    durationSeconds: 40,
    sampleRate: 48000,
    audioStreamIndex: 0,
    audioTimebase: "1/48000",
    sourceTimebase: "SOURCE_GLOBAL_SECONDS",
  };
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
function fixture(starts = [4, 24]) {
  const header = c60114ArtifactHeader(policy, source);
  const targets = c60114ReviewTargetsSchema.parse(
    signed({
      ...header,
      artifactType: "review-target-intervals-v2",
      targets: starts.map((start, i) =>
        signed({
          reviewTargetId: `target-${i}`,
          parentReviewItemId: "item-0",
          targetType: "CURRENT_CUE_HALLUCINATION_TARGET",
          sourceInterval: { start, end: start + 2 },
          targetAnchorIds: [`cue-${i}`],
          finalCueIds: [`cue-${i}`],
          eventIds: ["event"],
          evidenceIds: ["synthetic-evidence"],
          mandatoryForAudio: true,
          localizationStatus: "VERIFIED",
          sourceIdentity: source,
          reasons: ["SYNTHETIC_DISJOINT_CURRENT_CUE"],
        }),
      ),
      unresolvedItems: [],
      summary: {
        targetCount: starts.length,
        itemCount: 1,
        unresolvedItemCount: 0,
        disjointItemCount: 1,
        coreFallbackCount: 0,
      },
    }),
  );
  const regionRows: C60114ReviewRegionV3[] = starts.map((start, i) =>
    signed({
      regionId: `region-${i}`,
      reviewTargetIds: [`target-${i}`],
      reviewItemIds: ["item-0"],
      sourceIntervals: [{ start, end: start + 2 }],
      contextIntervals: [{ start: start - 2, end: start + 4 }],
      playbackIntervals: [{ start: start - 2, end: start + 4 }],
      targetCoverageChecks: [
        {
          reviewTargetId: `target-${i}`,
          mandatoryForAudio: true,
          coverageRatio: 1,
          fullyCovered: true,
        },
      ],
      requiredLevel: "REQUIRED" as const,
      priorityMetadata: {
        rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14" as const,
        rankPosition: i + 1,
        inheritedItemScore: 80,
        safetyClass: "REQUIRED" as const,
        legacyItemRank: i + 1,
        r3PolicyHash: hash,
        r3EvidenceFamiliesHash: hash,
        r3Ranker: "REGION_RISK_DENSITY_V3" as const,
        inputDerivation:
          "EXISTING_R3_EVIDENCE_GRAPH_AND_ATOMIC_TARGET_REGION_PROJECTION" as const,
        scoreMeaning: "EXPLAINABLE_RANKING_SCORE_NOT_PROBABILITY" as const,
        utility: 4,
        uniqueAudioCostSeconds: 6,
        reviewCostSeconds: 8,
        rankScore: 1,
        riskCoverageKeys: [`risk-${i}`],
        actionableCoverageKeys: [],
        mandatoryReasons: ["SYNTHETIC_REQUIRED"],
        priorityVector: {
          mandatorySafetyClass: "STRONG_HALLUCINATION" as const,
          positiveEvidenceStrength: 0.9,
          independentEvidenceFamilyCount: 2,
          errorTypeSeverity: 0.8,
          crossModelConflictStrength: 0,
          hallucinationStrength: 0.9,
          missingStrength: 0,
          timingStrength: 0,
          candidateActionability: 0,
          localizationQuality: 1,
          estimatedReviewCost: 8,
          sourceTime: start,
        },
      },
      sourceIdentity: source,
    }),
  );
  const regions = c60114ReviewRegionsV3Schema.parse(
    signed({
      ...header,
      artifactType: "machine-review-regions-v3",
      targetsHash: targets.semanticHash,
      itemsHash: hash,
      regions: regionRows,
      summary: {
        regionCount: starts.length,
        targetCount: starts.length,
        mappedTargetCount: starts.length,
        disjointItemCount: 1,
        disjointRegionSplitCount: 1,
        requiredRegionCount: starts.length,
        targetCoverageRatio: 1,
      },
    }),
  );
  const audioRows: C60114PhysicalAudio[] = starts.map((start, i) =>
    c60114PhysicalAudioSchema.parse(
      signed({
        audioId: `audio-${i}`,
        relativePath: `audio/region-${i}.wav`,
        sourceMediaSha256: source.sourceMediaSha256,
        sourceIdentity: source,
        sourceInterval: { start: start - 2, end: start + 4 },
        requestedInterval: { start: start - 2, end: start + 4 },
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        codec: "pcm_s16le",
        frameCount: 96000,
        actualDuration: 6,
        sha256: createHash("sha256").update(wav(6)).digest("hex"),
        playable: true,
        hashVerified: true,
        physicalMetadataVerified: true,
        coveredReviewTargetIds: [`target-${i}`],
        regionIds: [`region-${i}`],
      }),
    ),
  );
  const audio = c60114ReviewAudioManifestV3Schema.parse(
    signed({
      ...header,
      artifactType: "machine-review-audio-manifest-v3",
      regionsHash: regions.semanticHash,
      deliverySubsystemVersion: "C6.0.1.12_REVIEW_AUDIO",
      extractionPolicy: "existing-deterministic-pcm16k-source-extraction",
      audio: audioRows,
      targetCoverageChecks: targets.targets.map((t) => ({
        reviewTargetId: t.reviewTargetId,
        mandatoryForAudio: true,
        coverageRatio: 1,
        fullyCovered: true,
      })),
      summary: {
        plannedAudioCount: starts.length,
        actualAudioCount: starts.length,
        extractionFailureCount: 0,
        playableCount: starts.length,
        hashVerifiedCount: starts.length,
        mandatoryTargetCount: starts.length,
        coveredMandatoryTargetCount: starts.length,
        allTargetCount: starts.length,
        coveredTargetCount: starts.length,
        targetCoveragePassed: true,
        clipSumSeconds: starts.length * 6,
        networkUsed: false,
      },
    }),
  );
  return { sourceIdentity: source, policy, targets, regions, audio };
}
function workspace() {
  const f = fixture();
  const playback = buildC60114PlaybackTimeline(f);
  const header = c60114ArtifactHeader(policy, source);
  const lexical = c60114LocalizedLexicalEvidenceSchema.parse(
    signed({
      ...header,
      artifactType: "localized-missing-lexical-evidence",
      sourceIdentityHash: machineQualitySemanticHash(source),
      probeSemanticHash: hash,
      readingMechanism: {
        status: "UNAVAILABLE",
        runtimeIdentityHash: null,
        reason: "SYNTHETIC_NO_INFERENCE",
      },
      targets: [],
    }),
  );
  const missing = c60114MissingSpeechEvidenceV3Schema.parse(
    signed({
      ...header,
      artifactType: "missing-speech-evidence-v3",
      sourceIdentityHash: machineQualitySemanticHash(source),
      lexicalEvidenceHash: lexical.semanticHash,
      targets: [],
      parentGaps: [],
      migratedV2GapIds: [],
      deprecatedEnvelopeOnlyEvidenceCount: 0,
      parentGapNotUsedAsSpeechEvidenceCount: 0,
      canonicalMutationCount: 0,
    }),
  );
  const extension = buildC60114WorkspaceExtension({
    ...header,
    workspaceMode: "SOURCE_TARGET_PLAYBACK_V3",
    targets: f.targets,
    regions: f.regions,
    audio: f.audio,
    playback,
    lexical,
    missing,
    islands: [
      {
        islandId: "island",
        sourceInterval: { start: 4, end: 6 },
        speechPositive: true,
        sourceIdentity: source,
        parentGapIds: [],
      },
    ],
    orphans: [],
    unresolvedItemIds: ["item-1"],
    rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14",
    humanTrialStarted: false,
    canonicalMutationAllowed: false,
  });
  const data = c60113SyntheticWorkspace();
  delete data.regionReviewV2;
  data.sourceMediaIdentity = {
    sha256: source.sourceMediaSha256,
    sourceDurationMs: 40000,
  };
  data.sourceTargetReviewV3 = extension;
  data.regions = f.regions.regions.map((r, i) => {
    const a = required(f.audio.audio[i]);
    return {
      regionId: r.regionId,
      reviewItemIds: r.reviewItemIds,
      contextStart: a.sourceInterval.start,
      contextEnd: a.sourceInterval.end,
      coreIntervals: r.sourceIntervals,
      audioSourceInterval: a.sourceInterval,
      audioPath: a.relativePath,
      audioSha256: a.sha256,
    };
  });
  return data;
}

describe("C60114 physical review audio (synthetic WAV only)", () => {
  it("extracts disjoint current-cue targets into separate frame-verified WAVs", async () => {
    const f = fixture();
    const outputDirectory = path.join(root, "complete");
    const result = await buildC60114ReviewAudio({
      ...f,
      outputDirectory,
      sourcePath,
      generatedAt,
    });
    expect(result.manifest.audio).toHaveLength(2);
    expect(result.manifest.summary.coveredMandatoryTargetCount).toBe(2);
    for (const clip of result.manifest.audio) {
      const bytes = await readFile(
        path.join(outputDirectory, clip.relativePath),
      );
      const physical = inspectReviewWav(bytes);
      expect(clip.frameCount).toBe(physical.frameCount);
      expect(clip.actualDuration).toBe(
        physical.frameCount / physical.sampleRate,
      );
      expect(clip.sourceInterval.end - clip.sourceInterval.start).toBe(
        clip.actualDuration,
      );
      expect(clip.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    }
    expect(result.manifest.audio.map((a) => a.sourceInterval)).toEqual([
      { start: 2, end: 8 },
      { start: 22, end: 28 },
    ]);
  });
  it("rejects a source file with a mismatched SHA before extracting", async () => {
    const f = fixture();
    await expect(
      buildC60114ReviewAudio({
        ...f,
        sourcePath,
        sourceIdentity: { ...source, sourceMediaSha256: hash },
        outputDirectory: path.join(root, "bad-source"),
        generatedAt,
      }),
    ).rejects.toThrow();
  });
  it("rejects a truncated WAV instead of trusting declared RIFF/data lengths", () => {
    const bytes = wav(1);
    expect(() =>
      inspectReviewWav(bytes.subarray(0, bytes.length - 200)),
    ).toThrow();
  });
  it("rejects frame/duration drift, source SHA disagreement and unsafe paths", () => {
    const clip = required(fixture().audio.audio[0]);
    for (const malformed of [
      { ...clip, frameCount: clip.frameCount - 1 },
      { ...clip, sourceInterval: { start: 2, end: 9 } },
      { ...clip, sourceMediaSha256: hash },
      { ...clip, relativePath: "../source.wav" },
    ])
      expect(c60114PhysicalAudioSchema.safeParse(malformed).success).toBe(
        false,
      );
  });
  it("fails mandatory delivery when a target has no physical clip", async () => {
    const f = fixture();
    f.regions = rehash({
      ...f.regions,
      regions: f.regions.regions.slice(0, 1),
    });
    await expect(
      buildC60114ReviewAudio({
        ...f,
        sourcePath,
        outputDirectory: path.join(root, "missing-target"),
        generatedAt,
      }),
    ).rejects.toThrow("MANDATORY_TARGET_PHYSICAL_AUDIO_OMISSION");
  });
});
describe("C60114 physical playback segments and plans", () => {
  it("does not assign sample-rounded padding outside a region context to that region", () => {
    const f = fixture([4, 7]);
    f.audio.audio[0] = rehash({
      ...required(f.audio.audio[0]),
      sourceInterval: { start: 2, end: 8.0000625 },
      frameCount: 96001,
      actualDuration: 6.0000625,
    });
    f.audio = rehash(f.audio);
    const timeline = buildC60114PlaybackTimeline(f);
    expect(
      timeline.segments
        .filter((segment) => segment.regionIds.includes("region-0"))
        .every((segment) => segment.sourceInterval.end <= 8),
    ).toBe(true);
    expect(
      timeline.plans.find((plan) => plan.planId === "FULL_QUEUE")
        ?.uniqueAudioSeconds,
    ).toBe(9);
  });
  it("keeps disjoint target playback separate and offsets reversible", () => {
    const f = fixture();
    const timeline = buildC60114PlaybackTimeline(f);
    expect(timeline.summary.targetCoveragePassed).toBe(true);
    for (const s of timeline.segments) {
      const a = required(f.audio.audio.find((a) => a.audioId === s.audioId));
      expect(s.sourceInterval.start).toBe(
        a.sourceInterval.start + s.audioLocalInterval.start,
      );
      expect(s.sourceInterval.end).toBe(
        a.sourceInterval.start + s.audioLocalInterval.end,
      );
      expect(s.sourceInterval.end <= 8 || s.sourceInterval.start >= 22).toBe(
        true,
      );
    }
    const full = required(
      timeline.plans.find((p) => p.planId === "FULL_QUEUE"),
    );
    expect(full.sourceIntervalUnion).toEqual([
      { start: 2, end: 8 },
      { start: 22, end: 28 },
    ]);
    expect(full.uniqueAudioSeconds).toBe(12);
    expect(full.reviewTargetIds).toEqual(["target-0", "target-1"]);
  });
  it("deduplicates overlapping physical clips into an exact waveform union", () => {
    const f = fixture([4, 7]);
    const timeline = buildC60114PlaybackTimeline(f);
    const full = required(
      timeline.plans.find((p) => p.planId === "FULL_QUEUE"),
    );
    expect(full.uniqueAudioSeconds).toBe(9);
    expect(full.sourceIntervalUnion).toEqual([{ start: 2, end: 11 }]);
    const selected = timeline.segments.filter((s) =>
      full.playbackSegmentIds.includes(s.playbackSegmentId),
    );
    expect(c60114Union(selected.map((s) => s.sourceInterval))).toEqual(
      full.sourceIntervalUnion,
    );
    expect(full.physicalAudioSha256s).toEqual(
      full.audioIds.map(
        (id) => required(f.audio.audio.find((a) => a.audioId === id)).sha256,
      ),
    );
  });
  it("fails closed on missing mandatory audio and altered physical frames", () => {
    const f = fixture();
    f.audio = rehash({
      ...f.audio,
      audio: f.audio.audio.slice(0, 1),
      targetCoverageChecks: f.audio.targetCoverageChecks.map((c, i) =>
        i ? { ...c, coverageRatio: 0, fullyCovered: false } : c,
      ),
    });
    expect(() => buildC60114PlaybackTimeline(f)).toThrow(
      "MANDATORY_TARGET_PLAYBACK_OMISSION",
    );
    const g = fixture();
    const a = required(g.audio.audio[0]);
    a.frameCount--;
    g.audio = rehash(g.audio);
    expect(() => buildC60114PlaybackTimeline(g)).toThrow();
  });
  it("rejects mismatched source identities and stale graph hashes", () => {
    const f = fixture();
    expect(() =>
      buildC60114PlaybackTimeline({
        ...f,
        sourceIdentity: { ...source, audioStreamIndex: 3 },
      }),
    ).toThrow("SOURCE_IDENTITY_MISMATCH");
    f.audio = rehash({ ...f.audio, regionsHash: hash });
    expect(() => buildC60114PlaybackTimeline(f)).toThrow(
      "AUDIO_REGION_HASH_MISMATCH",
    );
  });
});
describe("C60114 immutable workspace extension", () => {
  it("accepts the frozen legacy seconds/sourceMediaSha256 identity and rejects conflicting aliases", () => {
    const data = workspace();
    data.sourceMediaIdentity = {
      sourceMediaSha256: source.sourceMediaSha256,
      durationSeconds: source.durationSeconds,
    };
    expect(() => assertC60114WorkspaceExtension(data)).not.toThrow();
    data.sourceMediaIdentity.sha256 = hash;
    expect(() => assertC60114WorkspaceExtension(data)).toThrow(
      "SOURCE_IDENTITY_MISMATCH",
    );
    delete data.sourceMediaIdentity.sha256;
    data.sourceMediaIdentity.sourceDurationMs =
      source.durationSeconds * 1000 + 1;
    expect(() => assertC60114WorkspaceExtension(data)).toThrow(
      "SOURCE_IDENTITY_MISMATCH",
    );
  });
  it("validates the exact target, region, WAV and plan graph without modifying it", () => {
    const data = workspace();
    const before = JSON.stringify(data);
    expect(() => assertC60114WorkspaceExtension(data)).not.toThrow();
    expect(JSON.stringify(data)).toBe(before);
  });
  it("rejects outer hash changes and mismatched legacy audio offsets", () => {
    const data = workspace();
    required(data.sourceTargetReviewV3).semanticHash = hash;
    expect(() => assertC60114WorkspaceExtension(data)).toThrow(
      "EXTENSION_HASH_MISMATCH",
    );
    const other = workspace();
    required(required(other.regions[0]).audioSourceInterval).start++;
    expect(() => assertC60114WorkspaceExtension(other)).toThrow();
  });
  it("rejects rehashed segment-local time tampering", () => {
    const data = workspace(),
      ext = required(data.sourceTargetReviewV3);
    const segment = required(ext.playback.segments[0]);
    segment.audioLocalInterval.end += 0.1;
    ext.playback.segments[0] = rehash(segment);
    ext.playback = rehash(ext.playback);
    data.sourceTargetReviewV3 = rehash(ext);
    expect(() => assertC60114WorkspaceExtension(data)).toThrow(
      "PHYSICAL_OFFSET_MISMATCH",
    );
  });
  it("rejects rehashed physical waveform hashes and source unions in plans", () => {
    for (const mutation of ["hash", "union"]) {
      const data = workspace(),
        ext = required(data.sourceTargetReviewV3),
        p = required(ext.playback.plans.find((p) => p.planId === "FULL_QUEUE"));
      if (mutation === "hash")
        p.physicalAudioSha256s = p.physicalAudioSha256s.map(() => hash);
      else p.sourceIntervalUnion = [{ start: 0, end: 1 }];
      ext.playback.plans = ext.playback.plans.map((plan) =>
        plan.planId === p.planId ? rehash(p) : plan,
      );
      ext.playback = rehash(ext.playback);
      data.sourceTargetReviewV3 = rehash(ext);
      expect(() => assertC60114WorkspaceExtension(data)).toThrow(
        "PLAN_PHYSICAL_MAPPING_MISMATCH",
      );
    }
  });
  it("rejects a rehashed mandatory plan that omits one disjoint target", () => {
    const data = workspace(),
      ext = required(data.sourceTargetReviewV3),
      p = required(
        ext.playback.plans.find((p) => p.planId === "ALL_MANDATORY"),
      );
    p.playbackSegmentIds = p.playbackSegmentIds.slice(0, 1);
    ext.playback.plans = ext.playback.plans.map((plan) =>
      plan.planId === p.planId ? rehash(p) : plan,
    );
    ext.playback = rehash(ext.playback);
    data.sourceTargetReviewV3 = rehash(ext);
    expect(() => assertC60114WorkspaceExtension(data)).toThrow(
      "PLAN_PHYSICAL_MAPPING_MISMATCH",
    );
  });
  it("rejects cross-source islands and playback segments even after rehashing", () => {
    for (const mutation of ["island", "segment"]) {
      const data = workspace(),
        ext = required(data.sourceTargetReviewV3);
      if (mutation === "island")
        required(ext.islands[0]).sourceIdentity = {
          ...source,
          audioTimebase: "1/90000",
        };
      else {
        const s = required(ext.playback.segments[0]);
        s.sourceIdentity = { ...source, audioStreamIndex: 3 };
        ext.playback.segments[0] = rehash(s);
        ext.playback = rehash(ext.playback);
      }
      data.sourceTargetReviewV3 = rehash(ext);
      expect(() => assertC60114WorkspaceExtension(data)).toThrow(
        "SOURCE_IDENTITY_MISMATCH",
      );
    }
  });
  it("rejects stale lexical bindings and dangling plan-segment IDs", () => {
    const data = workspace(),
      ext = required(data.sourceTargetReviewV3);
    ext.missing = rehash({ ...ext.missing, lexicalEvidenceHash: hash });
    data.sourceTargetReviewV3 = rehash(ext);
    expect(() => assertC60114WorkspaceExtension(data)).toThrow(
      "MISSING_LEXICAL_HASH_MISMATCH",
    );
    const other = workspace(),
      e = required(other.sourceTargetReviewV3),
      p = required(e.playback.plans[0]);
    p.playbackSegmentIds = ["missing-segment"];
    e.playback.plans[0] = rehash(p);
    e.playback = rehash(e.playback);
    other.sourceTargetReviewV3 = rehash(e);
    expect(() => assertC60114WorkspaceExtension(other)).toThrow(
      "PLAN_REFERENCE_MISMATCH",
    );
  });
  it("exports strict JSON schemas while runtime guards validate cross-field identities", () => {
    for (const schema of [
      c60114ReviewTargetsSchema,
      c60114ReviewRegionsV3Schema,
      c60114ReviewAudioManifestV3Schema,
      c60114PlaybackTimelineV2Schema,
      c60114WorkspaceExtensionSchema,
    ]) {
      const json = z.toJSONSchema(schema, {
        target: "draft-2020-12",
        unrepresentable: "any",
      });
      expect(json.additionalProperties).toBe(false);
    }
    const data = workspace();
    expect(
      c60114WorkspaceExtensionSchema.safeParse({
        ...required(data.sourceTargetReviewV3),
        unapprovedField: true,
      }).success,
    ).toBe(false);
  });
});
