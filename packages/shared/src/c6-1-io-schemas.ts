import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const header = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal("c6.1-consensus-investigation-v1"),
  semanticHash: hash,
};
const fingerprint = z
  .object({ size: count, mtimeMs: z.number().nonnegative(), sha256: hash })
  .strict();
export const c61InputInventorySchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-input-inventory"),
    canonicalCueCount: count,
    canonicalEventCount: count,
    historicalRawCandidateCount: count,
    historicalDispositionCounts: z.record(z.string(), count),
    inputRowsByArtifact: z.record(z.string(), count),
    sourceMediaSha256: hash,
    sourceDurationSeconds: z.number().nonnegative(),
    newAsrInferenceCount: z.literal(0),
    networkUsed: z.literal(false),
    runtimeGoldInputCount: z.literal(0),
  })
  .strict();
export const c61ReadOnlyProofSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-read-only-proof"),
    sourceBefore: fingerprint,
    sourceAfter: fingerprint,
    goldBefore: fingerprint.nullable(),
    goldAfter: fingerprint.nullable(),
    sourceUnchanged: z.boolean(),
    goldUnchanged: z.boolean().nullable(),
    machineFreezeHash: hash,
    goldFirstReadAt: z.iso.datetime().nullable(),
    frozenAt: z.iso.datetime(),
  })
  .strict();
export const c61RegressionEvidenceSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-regression-evidence"),
    checks: z.array(
      z
        .object({
          name: z.string(),
          command: z.array(z.string()),
          exitCode: z.number().int(),
          passed: count,
          skipped: count,
          failed: count,
          durationMs: z.number().nonnegative(),
          logSha256: hash,
        })
        .strict(),
    ),
    allPassed: z.boolean(),
  })
  .strict();
export const c61ShareableSummarySchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-shareable-summary"),
    engineeringPassed: z.boolean(),
    route: z.string(),
    c602Status: z.literal("HOLD"),
    productionMutationCount: count,
    candidateCounts: z.record(z.string(), count),
    safetyCounts: z.record(z.string(), count),
    profiles: z.array(
      z
        .object({
          profileId: z.string(),
          normalizedCer: z.number().nonnegative(),
          exactCer: z.number().nonnegative(),
          materialErrors: count,
          hallucination: count,
          missing: count,
          coverage: z.number().min(0).max(1),
          improved: count,
          regressed: count,
        })
        .strict(),
    ),
    localTextIncluded: z.literal(false),
    rawAudioIncluded: z.literal(false),
    absolutePathsIncluded: z.literal(false),
  })
  .strict();
