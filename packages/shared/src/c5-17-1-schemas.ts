import { z } from "zod";

import { subtitleIntervalSchema } from "./finalization-schemas.js";
import { schemaVersionSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/]).+/u, "Path must be relative.");

export const micromambaInstallationIdentitySchema = z
  .object({
    version: z.literal("2.8.1-0"),
    platformAsset: z.literal("micromamba-osx-arm64"),
    fileBasename: z.literal("micromamba"),
    size: z.number().int().positive(),
    sha256: hashSchema,
    expectedSha256: hashSchema,
    downloadUrl: z
      .url()
      .startsWith(
        "https://github.com/mamba-org/micromamba-releases/releases/download/2.8.1-0/",
      ),
    checksumUrl: z
      .url()
      .startsWith(
        "https://github.com/mamba-org/micromamba-releases/releases/download/2.8.1-0/",
      ),
    officialSource: z.literal("mamba-org/micromamba-releases"),
    shellProfileModified: z.literal(false),
    sudoUsed: z.literal(false),
  })
  .strict()
  .refine((value) => value.sha256 === value.expectedSha256, {
    path: ["sha256"],
    message: "Micromamba binary hash must match the pinned official hash.",
  });

export const sudachiRuntimeCapabilitySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("sudachi-runtime-capability"),
    runtimeVersion: z.literal("C5.17.1"),
    generatedAt: z.iso.datetime(),
    pythonVersion: z.string().regex(/^3\.(?:11|12)\./u),
    sudachiPyVersion: z.literal("0.6.11"),
    sudachiDictionaryVersion: z.literal("20260428"),
    dictionary: z.literal("core"),
    splitMode: z.literal("C"),
    requirementsSha256: hashSchema,
    helperSha256: hashSchema,
    executableBasename: z.enum(["python", "python3"]),
    runtimeIdentityHash: hashSchema,
    offlineVerificationPassed: z.boolean(),
    systemPythonModified: z.literal(false),
    mfaRuntimeDependency: z.literal(false),
    shareable: z.literal(true),
  })
  .strict();

export const pronunciationReadingSourceSchema = z.enum([
  "terminology-confirmed",
  "sudachi-dictionary",
  "mfa-dictionary",
  "mfa-g2p",
  "kana-literal",
  "fallback-tokenization",
  "unresolved",
]);

export const pronunciationSourceSchema = z.enum([
  "mfa-dictionary",
  "mfa-g2p",
  "terminology-phone-override",
  "unresolved",
]);

export const canonicalPronunciationUnitSchema = z
  .object({
    unitId: z.string().min(1),
    cueId: z.string().min(1),
    surface: z.string().min(1),
    normalizedSurface: z.string().min(1),
    reading: z.string().min(1).nullable(),
    readingSource: pronunciationReadingSourceSchema,
    pronunciation: z.string().min(1).nullable(),
    phones: z.array(z.string().min(1)),
    pronunciationSource: pronunciationSourceSchema,
    dictionaryLookupStatus: z.enum([
      "found",
      "not-found",
      "not-attempted",
      "failed",
    ]),
    g2pStatus: z.enum([
      "resolved",
      "not-needed",
      "not-attempted",
      "failed",
      "unresolved",
    ]),
    modelIdentityHash: hashSchema.nullable(),
    modelHash: hashSchema.nullable(),
    isOov: z.boolean(),
    isCriticalOov: z.boolean(),
    punctuation: z.boolean(),
    blockers: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.pronunciationSource !== "unresolved" &&
      (value.pronunciation === null || value.phones.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["pronunciation"],
        message: "Resolved pronunciation requires a pronunciation and phones.",
      });
    }
    if (value.isCriticalOov && value.pronunciationSource !== "unresolved") {
      context.addIssue({
        code: "custom",
        path: ["isCriticalOov"],
        message: "A resolved pronunciation cannot remain a critical OOV.",
      });
    }
  });

export const canonicalPronunciationCueSchema = z
  .object({
    cueId: z.string().min(1),
    componentId: z.string().min(1),
    canonicalText: z.string().min(1),
    canonicalTextSha256: hashSchema,
    alignmentText: z.string().min(1),
    alignmentTextSha256: hashSchema,
    morphemeCount: z.number().int().nonnegative(),
    wordUnits: z.array(canonicalPronunciationUnitSchema),
    readingUnits: z.array(z.string().min(1)),
    pronunciationUnits: z.array(z.string().min(1)),
    expectedPhones: z.array(z.string().min(1)),
    readingCoverageBeforeG2p: z.number().min(0).max(1),
    readingCoverageAfterG2p: z.number().min(0).max(1),
    pronunciationCoverageRatio: z.number().min(0).max(1),
    criticalOovBefore: z.number().int().nonnegative(),
    criticalOovAfter: z.number().int().nonnegative(),
    pronunciationEligibility: z.boolean(),
    blockers: z.array(z.string().min(1)),
  })
  .strict();

export const subtitleCanonicalPronunciationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-canonical-pronunciation"),
    pronunciationVersion: z.literal("C5.17.1"),
    generatedAt: z.iso.datetime(),
    baseCueHash: hashSchema,
    canonicalAlignmentInputHash: hashSchema,
    sudachiRuntimeIdentityHash: hashSchema,
    mfaRuntimeIdentityHash: hashSchema,
    g2pModelIdentityHash: hashSchema,
    g2pCommand: z.enum(["g2p", "g2p_one"]),
    pronunciationPolicyVersion: z.literal("c5.17.1-canonical-pronunciation-v1"),
    canonicalTextMutationCount: z.literal(0),
    cues: z.array(canonicalPronunciationCueSchema),
    summary: z
      .object({
        cueCount: z.number().int().nonnegative(),
        unitCount: z.number().int().nonnegative(),
        sudachiResolvedCount: z.number().int().nonnegative(),
        dictionaryResolvedCount: z.number().int().nonnegative(),
        g2pResolvedCount: z.number().int().nonnegative(),
        kanaLiteralCount: z.number().int().nonnegative(),
        unresolvedCount: z.number().int().nonnegative(),
        criticalOovBefore: z.number().int().nonnegative(),
        criticalOovAfter: z.number().int().nonnegative(),
        g2pProcessCount: z.number().int().nonnegative(),
        g2pCacheHitCount: z.number().int().nonnegative(),
        canonicalTextMutationCount: z.literal(0),
      })
      .strict(),
  })
  .strict();

export const mfaSampleProbeSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("mfa-sample-probe"),
    probeVersion: z.literal("C5.17.1"),
    generatedAt: z.iso.datetime(),
    componentId: z.string().min(1),
    cueId: z.string().min(1),
    runtimeIdentityHash: hashSchema,
    acousticModelIdentityHash: hashSchema,
    dictionaryModelIdentityHash: hashSchema,
    g2pModelIdentityHash: hashSchema,
    command: z.enum(["align_one", "align_one_legacy"]),
    g2pCommand: z.enum(["g2p", "g2p_one"]),
    outputFormat: z.enum(["json", "long_textgrid"]),
    wordTierObserved: z.boolean(),
    phoneTierObserved: z.boolean(),
    fileInterval: subtitleIntervalSchema,
    lexicalUtteranceInterval: subtitleIntervalSchema.nullable(),
    phoneUtteranceInterval: subtitleIntervalSchema.nullable(),
    selectedUtteranceInterval: subtitleIntervalSchema.nullable(),
    selectedBoundarySource: z.enum([
      "lexical-word-tier",
      "phone-tier-fallback",
      "none",
    ]),
    wordCount: z.number().int().nonnegative(),
    phoneCount: z.number().int().nonnegative(),
    oovCount: z.number().int().nonnegative(),
    timeUnit: z.literal("seconds"),
    parserVersion: z.string().min(1),
    alignmentSucceeded: z.boolean(),
    failure: z.string().min(1).nullable(),
  })
  .strict();

export const c5171RuntimePreparationSummarySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-17-1-runtime-preparation-summary"),
    generatedAt: z.iso.datetime(),
    micromamba: micromambaInstallationIdentitySchema,
    mfaRuntimeManifest: relativePathSchema,
    mfaRuntimeIdentityHash: hashSchema,
    mfaVersion: z.literal("3.4.2"),
    environmentExplicitSpecSha256: hashSchema,
    sudachiRuntimeManifest: relativePathSchema,
    sudachiRuntimeIdentityHash: hashSchema,
    acousticModelIdentityHash: hashSchema,
    dictionaryModelIdentityHash: hashSchema,
    g2pModelIdentityHash: hashSchema,
    networkUsedDuringPreparation: z.literal(true),
    offlineReplayRequired: z.literal(true),
    shellProfileModified: z.literal(false),
    systemPythonModified: z.literal(false),
  })
  .strict();

export const c5171FreshCacheObserveValidationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-17-1-fresh-cache-observe-validation"),
    generatedAt: z.iso.datetime(),
    freshTask: z.string().min(1),
    observeTask: z.string().min(1),
    cacheReplayTask: z.string().min(1),
    freshAttemptCount: z.number().int().positive(),
    freshMfaProcessCount: z.number().int().positive(),
    cacheHitCount: z.number().int().positive(),
    cacheReplayMfaProcessCount: z.literal(0),
    observeTimingMutationCount: z.literal(0),
    alignmentHashMatches: z.literal(true),
    componentDecisionHashMatches: z.literal(true),
    mutationHashMatches: z.literal(true),
    outputCueHashMatches: z.literal(true),
    shareableAuditPassed: z.literal(true),
    sourceVideoUnchanged: z.literal(true),
    humanSubtitleUnchanged: z.literal(true),
  })
  .strict();

export type MicromambaInstallationIdentity = z.infer<
  typeof micromambaInstallationIdentitySchema
>;
export type SudachiRuntimeCapability = z.infer<
  typeof sudachiRuntimeCapabilitySchema
>;
export type CanonicalPronunciationUnit = z.infer<
  typeof canonicalPronunciationUnitSchema
>;
export type CanonicalPronunciationCue = z.infer<
  typeof canonicalPronunciationCueSchema
>;
export type SubtitleCanonicalPronunciation = z.infer<
  typeof subtitleCanonicalPronunciationSchema
>;
export type MfaSampleProbe = z.infer<typeof mfaSampleProbeSchema>;
export type C5171RuntimePreparationSummary = z.infer<
  typeof c5171RuntimePreparationSummarySchema
>;
export type C5171FreshCacheObserveValidation = z.infer<
  typeof c5171FreshCacheObserveValidationSchema
>;
