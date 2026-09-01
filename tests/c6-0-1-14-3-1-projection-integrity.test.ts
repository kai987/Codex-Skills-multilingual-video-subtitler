import { describe, expect, it } from "vitest";
import type { Projections143 } from "@mvl/shared";
import {
  assertPreGoldIntegrity1431,
  auditProjectionChanges1431,
  buildProjectionRebindingLedger1431,
  preflightNestedSemanticIntegrity1431,
  projectionIntegrityPolicy1431,
  rebindCoverageAudio1431,
  rehashProjectionSet1431,
  reproduceBaselineHashFailure1431,
} from "../packages/video-subtitler/src/review/c6011431-projection-integrity.js";
import {
  hash141,
  hashed141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";

const sourceIdentity = {
  sourceMediaSha256: "a".repeat(64),
  durationSeconds: 10,
  sampleRate: 48_000,
  audioStreamIndex: 1,
  audioTimebase: "1/1000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
};
const sourceAudio = () =>
  hashed141({
    audioId: "audio-1",
    relativePath: "audio/audio-1.wav",
    sourceMediaSha256: sourceIdentity.sourceMediaSha256,
    sourceInterval: { start: 1, end: 2 },
    requestedInterval: { start: 1, end: 2 },
    actualSourceInterval: { start: 1, end: 2 },
    requestedSourceInterval: { start: 1, end: 2 },
    sampleRate: 16_000,
    channels: 1,
    bitDepth: 16,
    codec: "pcm_s16le",
    frameCount: 16_000,
    actualDuration: 1,
    sha256: "b".repeat(64),
    playable: true,
    hashVerified: true,
    physicalMetadataVerified: true,
    coveredReviewTargetIds: ["target-1"],
    regionIds: ["region-1"],
    sourceIdentity,
    nativeSourceInterval: { startSample: 48_000, endSample: 96_000 },
  });
const playback = () =>
  hashed141({
    playbackSegmentId: "playback-1",
    audioId: "audio-1",
    sourceInterval: { start: 1, end: 2 },
    audioLocalInterval: { start: 0, end: 1 },
    reviewTargetIds: ["target-1"],
    reviewItemIds: ["item-1"],
    regionIds: ["region-1"],
    sourceIdentity,
  });

function projections(audio: ReturnType<typeof rebindCoverageAudio1431>) {
  const variants = Array.from({ length: 8 }, (_, index) =>
    hashed141({
      stage: `A${index}`,
      projection: {
        sourceIdentity,
        physicalAudio: [audio],
        playbackSegments: [playback()],
        targets: [],
        regions: [],
      },
    }),
  );
  return hashed141({
    sourceIdentity,
    variants,
    officialStage: "A7",
  }) as unknown as Projections143;
}

describe("C6.0.1.14.3.1 projection hash integrity", () => {
  it("publishes the one canonical hash-rebinding operation order", () => {
    const policy = projectionIntegrityPolicy1431();
    expect(policy.canonicalHashHelper).toBe("hashed141");
    expect(policy.requiredOperationOrder).toEqual([
      "ASSERT_SOURCE_HASH",
      "PROJECT_FIELDS",
      "REMOVE_OLD_SEMANTIC_HASH",
      "COMPUTE_CANONICAL_PROJECTED_HASH",
      "STRICT_SCHEMA_PARSE",
      "ASSERT_PROJECTED_HASH",
    ]);
  });

  it("rebinds a valid source row into the strict projected domain", () => {
    const source = sourceAudio();
    const projected = rebindCoverageAudio1431(source);
    expect(projected.semanticHash).not.toBe(source.semanticHash);
    expect(projected.semanticHash).toBe(
      hash141(
        Object.fromEntries(
          Object.entries(projected).filter(([key]) => key !== "semanticHash"),
        ),
      ),
    );
    expect("nativeSourceInterval" in projected).toBe(false);
    expect(projected.sha256).toBe(source.sha256);
  });

  it("rejects a corrupted source row before projecting it", () => {
    expect(() =>
      rebindCoverageAudio1431({
        ...sourceAudio(),
        semanticHash: "c".repeat(64),
      }),
    ).toThrow(/SEMANTIC_HASH_MISMATCH/u);
  });

  it("reproduces stale source-domain hash reuse without opening Gold", () => {
    const source = sourceAudio();
    const correct = rebindCoverageAudio1431(source);
    const stale = { ...correct, semanticHash: source.semanticHash };
    const old = projections(stale);
    const result = reproduceBaselineHashFailure1431({
      sourceRows: [source],
      projections: old,
    });
    expect(result.reproduced).toBe(true);
    expect(result.staleProjectedAudioHashReuseCount).toBe(1);
    expect(result.strictProjectedAudioHashesValid).toBe(0);
    expect(result.goldReadAttempted).toBe(false);
  });

  it("persists one source-to-projection ledger row with byte identity", () => {
    const source = sourceAudio();
    const projected = rebindCoverageAudio1431(source);
    const ledger = buildProjectionRebindingLedger1431({
      sourceRows: [source],
      projectedRows: [projected],
      sourceIdentity,
    });
    expect(ledger.reboundRowCount).toBe(1);
    expect(ledger.entries[0]?.sourceSemanticHash).not.toBe(
      ledger.entries[0]?.projectedSemanticHash,
    );
    expect(ledger.entries[0]?.audioByteHashPreserved).toBe(true);
  });

  it("detects nested stale hashes even when every outer hash is valid", () => {
    const source = sourceAudio();
    const correct = rebindCoverageAudio1431(source);
    const stale = { ...correct, semanticHash: source.semanticHash };
    const old = projections(stale);
    const preflight = preflightNestedSemanticIntegrity1431(old);
    expect(preflight.integrityPassed).toBe(false);
    expect(preflight.failures.map((row) => row.code)).toContain(
      "OUTER_HASH_VALID_NESTED_HASH_INVALID",
    );
    expect(() => assertPreGoldIntegrity1431(preflight)).toThrow(
      /PRE_GOLD_NESTED_INTEGRITY_FAILED/u,
    );
  });

  it("passes a strict rehashed projection and rejects unknown hashable rows", () => {
    const fixed = projections(rebindCoverageAudio1431(sourceAudio()));
    expect(preflightNestedSemanticIntegrity1431(fixed).integrityPassed).toBe(
      true,
    );
    const unknown = structuredClone(fixed) as unknown as {
      variants: Array<{
        projection: Record<string, unknown>;
        semanticHash: string;
      }>;
      semanticHash: string;
    };
    unknown.variants[7]!.projection.unexpected = {
      semanticHash: "d".repeat(64),
    };
    unknown.variants[7] = hashed141(unknown.variants[7]!);
    unknown.semanticHash = hash141(
      Object.fromEntries(
        Object.entries(unknown).filter(([key]) => key !== "semanticHash"),
      ),
    );
    const result = preflightNestedSemanticIntegrity1431(
      unknown as unknown as Projections143,
    );
    expect(result.failures.map((row) => row.code)).toContain(
      "UNKNOWN_HASHABLE_ROW_TYPE",
    );
  });

  it("allows only projected and enclosing hash changes", () => {
    const source = sourceAudio();
    const stale = {
      ...rebindCoverageAudio1431(source),
      semanticHash: source.semanticHash,
    };
    const before = projections(stale);
    const after = rehashProjectionSet1431(before);
    const audit = auditProjectionChanges1431({
      before,
      after,
      plannerEquivalent: true,
      canonicalTextEquivalent: true,
      canonicalTimingEquivalent: true,
      presentationEquivalent: true,
    });
    expect(audit.passed).toBe(true);
    expect(audit.changedProjectedAudioHashCount).toBe(1);
    expect(audit.playbackRowsByteEquivalent).toBe(true);
  });

  it("fails the change audit on a playback interval mutation", () => {
    const before = projections(rebindCoverageAudio1431(sourceAudio()));
    const after = structuredClone(before);
    after.variants[7]!.projection.playbackSegments[0]!.sourceInterval.end = 3;
    after.variants[7]!.projection.playbackSegments[0] = hashed141(
      after.variants[7]!.projection.playbackSegments[0]!,
    );
    after.variants[7] = hashed141(after.variants[7]!);
    const rebuilt = hashed141(after) as Projections143;
    const audit = auditProjectionChanges1431({
      before,
      after: rebuilt,
      plannerEquivalent: true,
      canonicalTextEquivalent: true,
      canonicalTimingEquivalent: true,
      presentationEquivalent: true,
    });
    expect(audit.passed).toBe(false);
    expect(audit.forbiddenChanges).toContain("PLAYBACK_INTERVALS_CHANGED");
  });
});
