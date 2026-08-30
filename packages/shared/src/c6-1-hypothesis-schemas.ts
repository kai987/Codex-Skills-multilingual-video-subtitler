import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().min(1);
const count = z.number().int().nonnegative();
export const c61HypothesisPolicyVersion =
  "c6.1-hypothesis-universe-v1" as const;

export const c61HypothesisIntervalSchema = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((value) => value.end > value.start);

export const c61HypothesisInputSchema = z
  .object({
    inputRecordId: id,
    sourceCandidateId: id,
    eventId: id.nullable(),
    providerFamily: z.enum(["WHISPER", "REAZON", "CURRENT"]),
    modelIdentity: id.nullable(),
    requestId: id.nullable(),
    windowType: id,
    sourceInterval: c61HypothesisIntervalSchema.nullable(),
    displayText: z.string(),
    pronunciationText: z.string().nullable(),
    pronunciationEvidenceId: id.nullable(),
    candidateRole: id,
    correlationLineage: z.array(id),
    provenanceHashes: z.array(hash),
    lineageVerified: z.boolean(),
    sourceGlobalVerified: z.boolean(),
    hardRejectionReasons: z.array(id),
    localizationBlockers: z.array(id),
    runtimeGoldInputCount: z.literal(0),
    humanDerived: z.literal(false),
  })
  .strict();

export const c61HypothesisSchema = z
  .object({
    inputRecordId: id,
    candidateId: id,
    sourceCandidateId: id,
    eventId: id.nullable(),
    providerFamily: z.enum(["WHISPER", "REAZON", "CURRENT"]),
    modelIdentity: id.nullable(),
    requestId: id.nullable(),
    windowType: id,
    sourceInterval: c61HypothesisIntervalSchema.nullable(),
    displayText: z.string(),
    normalizedText: z.string(),
    pronunciationText: z.string().nullable(),
    pronunciationEvidenceId: id.nullable(),
    candidateRole: id,
    inclusionStatus: z.enum([
      "INCLUDED",
      "NORMALIZED_DUPLICATE",
      "PRONUNCIATION_EQUIVALENT",
      "HARD_REJECTED",
      "UNLOCALIZABLE",
      "UNSUPPORTED_PROVENANCE",
    ]),
    inclusionReasons: z.array(id).min(1),
    representativeCandidateId: id.nullable(),
    correlationGroupId: id,
    independentVoteEligible: z.boolean(),
    provenanceHash: hash,
    semanticHash: hash,
  })
  .strict();

export const c61HypothesisEventSchema = z
  .object({
    eventId: id,
    sourceInterval: c61HypothesisIntervalSchema,
    sourceCandidateIds: z.array(id),
    finalCueIds: z.array(id),
    currentText: z.string().nullable(),
    finalSpan: z
      .object({
        finalCueId: id,
        spanStart: count,
        spanEnd: count,
        spanText: z.string(),
        lineageStatus: id,
        modifiable: z.boolean(),
        evidenceHash: hash,
      })
      .strict()
      .nullable(),
    semanticHash: hash,
  })
  .strict();

export const machineMultiAsrHypothesisUniverseSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("machine-multi-asr-hypothesis-universe"),
    policyVersion: z.literal(c61HypothesisPolicyVersion),
    runtimeGoldInputCount: z.literal(0),
    humanMemoryInputCount: z.literal(0),
    sourceArtifactHashes: z.record(id, hash),
    events: z.array(c61HypothesisEventSchema),
    candidates: z.array(c61HypothesisSchema),
    eventScopes: z.array(
      z
        .object({
          eventId: id,
          scope: z.enum([
            "WHISPER_ONLY_MULTI_HYPOTHESIS",
            "WHISPER_REAZON_MULTI_PROVIDER",
            "SINGLE_HYPOTHESIS_CONTROL",
            "UNLOCALIZABLE",
          ]),
          includedCandidateIds: z.array(id),
          independentCandidateCount: count,
          normalizedDistinctCount: count,
          providerFamilies: z.array(z.enum(["WHISPER", "REAZON"])),
          semanticHash: hash,
        })
        .strict(),
    ),
    summary: z
      .object({
        inputCandidateCount: count,
        includedCandidateCount: count,
        normalizedDuplicateCount: count,
        pronunciationEquivalentCount: count,
        hardRejectedCount: count,
        unlocalizableCandidateCount: count,
        unsupportedProvenanceCount: count,
        unaccountedCandidateCount: z.literal(0),
        canonicalEventCount: count,
        multiHypothesisEventCount: count,
        multiProviderEventCount: count,
        whisperOnlyMultiHypothesisEventCount: count,
        singleHypothesisControlCount: count,
        unlocalizableEventCount: count,
        whisperInputCount: count,
        reazonInputCount: count,
        currentInputCount: count,
        includedWhisperCount: count,
        includedReazonCount: count,
        correlationGroupCount: count,
        trustedPronunciationCount: count,
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();

export type C61HypothesisInput = z.infer<typeof c61HypothesisInputSchema>;
export type C61Hypothesis = z.infer<typeof c61HypothesisSchema>;
export type C61HypothesisEvent = z.infer<typeof c61HypothesisEventSchema>;
export type C61HypothesisUniverse = z.infer<
  typeof machineMultiAsrHypothesisUniverseSchema
>;
