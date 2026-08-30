import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const header = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal("c6.1-consensus-investigation-v1"),
  semanticHash: hash,
};
const relativePath = z
  .string()
  .min(1)
  .refine(
    (s) =>
      !s.startsWith("/") &&
      !/^[A-Za-z]:/u.test(s) &&
      !s.split(/[\\/]/u).includes("..") &&
      !s.includes("\0"),
  );
export const c61FileIdentitySchema = z
  .object({ relativePath, sha256: hash, size: count })
  .strict();
export const c61MetricsSchema = z
  .object({
    exactCer: z.number().nonnegative(),
    normalizedCer: z.number().nonnegative(),
    coverage: ratio,
    missing: count,
    hallucination: count,
    materialErrors: count,
    cueCount: count,
    severeTiming: count,
    startMae: z.number().nonnegative(),
    endMae: z.number().nonnegative(),
    boundaryP95: z.number().nonnegative(),
    medianIoU: ratio,
    overlap: count,
  })
  .strict();
export const c61BaselineSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-baseline"),
    sourceMediaSha256: hash,
    machineDraftHash: hash,
    cueCount: count,
    canonicalTextHash: hash,
    canonicalTimingHash: hash,
    productionFiles: z.array(c61FileIdentitySchema),
    officialBaselineSemanticHash: hash,
    baselineReplayPassed: z.boolean(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
  })
  .strict();
export const c61ShadowManifestSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-shadow-manifest"),
    outputRole: z.literal("RESEARCH_SHADOW_OUTPUT"),
    privacy: z.literal("LOCAL_ONLY"),
    profiles: z.array(
      z
        .object({
          profileId: z.string(),
          files: z.array(c61FileIdentitySchema),
          cueCount: count,
          changedCueIds: z.array(z.string()),
          canonicalTextHash: hash,
          canonicalTimingHash: hash,
          assemblyDecisions: z.array(
            z
              .object({
                eventId: z.string(),
                cueId: z.string().nullable(),
                status: z.enum([
                  "APPLIED_SHADOW_ONLY",
                  "KEEP_CURRENT",
                  "BLOCKED_UNSAFE",
                  "UNMAPPABLE_LINEAGE",
                  "CONFLICTING_REPLACEMENT",
                  "PRESENTATION_CAPACITY",
                ]),
                reason: z.string(),
                inputTextHash: hash,
                outputTextHash: hash,
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    productionMutationCount: count,
  })
  .strict();
export const c61MachineFreezeSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-machine-freeze"),
    frozenAt: z.iso.datetime(),
    policyHash: hash,
    inputHashes: z.record(z.string(), hash),
    machineFiles: z.array(c61FileIdentitySchema),
    machineAggregateHash: hash,
    productionFiles: z.array(c61FileIdentitySchema),
    runtimeGoldInputCount: z.literal(0),
    newAsrInferenceCount: z.literal(0),
    networkUsed: z.literal(false),
    benchmarkStatus: z.literal("KNOWN_DEVELOPMENT_BENCHMARK"),
  })
  .strict();
const provenanceToken = z
  .object({
    outputPosition: count,
    outputSurface: z.string(),
    sourceCandidateIds: z.array(z.string()).min(1),
    sourceCandidateSpans: z
      .array(
        z
          .object({ candidateId: z.string(), start: count, end: count })
          .strict(),
      )
      .min(1),
    providerFamilies: z.array(z.enum(["WHISPER", "REAZON", "CURRENT"])),
    latticeNodeIds: z.array(z.string()),
    latticeEdgeIds: z.array(z.string()),
    selectionMethod: z.string(),
    evidenceIds: z.array(z.string()),
  })
  .strict();
export const c61ConsensusProvenanceSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-multi-asr-consensus-path-provenance"),
    paths: z.array(
      z
        .object({
          profileId: z.string(),
          eventId: z.string(),
          pathHash: hash,
          outputText: z.string(),
          pathClass: z.enum([
            "EXISTING_CANDIDATE",
            "NOVEL_LEGAL_PATH",
            "PRESERVED_CURRENT",
            "REJECTED",
          ]),
          tokens: z.array(provenanceToken),
          provenanceComplete: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export const c61SafetyCountsSchema = z
  .object({
    unsupportedTokenCount: count,
    unsupportedAdjacencyCount: count,
    crossEventTokenCount: count,
    unprovenSurfaceRestorationCount: count,
    nonMonotonicPathCount: count,
    pathCycleCount: count,
    providerSwitchLimitViolationCount: count,
    candidateProvenanceMissingCount: count,
    GoldRuntimeLeakCount: count,
    syntheticKanjiGenerationCount: count,
    timingMutationCount: count,
    productionMutationCount: count,
  })
  .strict();
export const c61ConsensusSafetySchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-multi-asr-consensus-safety-audit"),
    counts: c61SafetyCountsSchema,
    auditedPathCount: count,
    rejectedPathCount: count,
    paths: z.array(
      z
        .object({
          profileId: z.string(),
          eventId: z.string(),
          safe: z.boolean(),
          reasons: z.array(z.string()),
          semanticHash: hash,
        })
        .strict(),
    ),
    engineeringPassed: z.boolean(),
  })
  .strict();
const oracleEvent = z
  .object({
    eventId: z.string(),
    evaluationStatus: z.enum([
      "EVALUABLE",
      "AMBIGUOUS_GOLD_MAPPING",
      "NO_GOLD_MAPPING",
      "NO_INCLUDED_CANDIDATE",
    ]),
    currentError: count.nullable(),
    goldCharacterCount: count,
    bestExistingCandidateId: z.string().nullable(),
    bestExistingCandidateError: count.nullable(),
    bestLegalPathError: count.nullable(),
    unrestrictedSlotError: count.nullable(),
    candidateOracleGain: z.number().nullable(),
    consensusOracleGain: z.number().nullable(),
    bestLegalNodeIds: z.array(z.string()),
    oracleSearchStatus: z.enum(["EXACT_LEGAL_LATTICE", "UNAVAILABLE"]),
    goldMappingIds: z.array(z.string()),
    semanticHash: hash,
  })
  .strict();
export const c61OracleSchema = z
  .object({
    ...header,
    artifactType: z.enum([
      "c6-1-existing-candidate-oracle",
      "c6-1-legal-path-oracle",
    ]),
    evaluationOnly: z.literal(true),
    machineFreezeHash: hash,
    events: z.array(oracleEvent),
    currentError: count,
    bestExistingCandidateError: count,
    bestLegalPathError: count,
    unrestrictedSlotError: count,
    goldCharacterCount: count,
    candidateOracleGain: z.number(),
    legalPathOracleGain: z.number(),
    consensusSpecificOracleGain: z.number(),
    evaluableEventCount: count,
    unevaluableEventCount: count,
  })
  .strict();
const eventQuality = z
  .object({
    eventId: z.string(),
    evaluationStatus: z.enum([
      "EVALUABLE",
      "AMBIGUOUS_GOLD_MAPPING",
      "NO_GOLD_MAPPING",
    ]),
    changed: z.boolean(),
    currentError: count.nullable(),
    outputError: count.nullable(),
    exactCorrect: z.boolean().nullable(),
    normalizedCorrect: z.boolean().nullable(),
    outcome: z.enum(["IMPROVED", "REGRESSED", "NEUTRAL", "UNEVALUABLE"]),
    novelLegal: z.boolean(),
    beatsAllExisting: z.boolean().nullable(),
    equalsBestExisting: z.boolean().nullable(),
    providerSwitchCount: count,
    outputTextHash: hash,
    semanticHash: hash,
  })
  .strict();
export const c61ProfileQualitySchema = z
  .object({
    profileId: z.string(),
    metrics: c61MetricsSchema,
    changedEvents: count,
    improved: count,
    regressed: count,
    neutral: count,
    unevaluable: count,
    renderedChangedCueCount: count,
    shadowBlockedChangeCount: count,
    exactCorrect: count,
    normalizedCorrect: count,
    beatsAllExisting: count,
    equalsBestExisting: count,
    worseThanBestExisting: count,
    novelPaths: count,
    novelImproved: count,
    novelExactCorrect: count,
    novelRegressed: count,
    consensusPrecision: ratio.nullable(),
    consensusHarmRate: ratio.nullable(),
    consensusCoverage: ratio,
    realizedGain: z.number(),
    oracleCapture: z.number().nullable(),
    providerSwitchCount: count,
    meanProviderSwitches: z.number().nonnegative(),
    maxProviderSwitches: count,
    acousticEvidenceUsed: count,
    unsafeRejected: count,
    timingHashUnchanged: z.boolean(),
    matchingInducedTimingDelta: z.boolean(),
    fixedBaselineTimingMetrics: c61MetricsSchema,
    eventResults: z.array(eventQuality),
    semanticHash: hash,
  })
  .strict();
export const c61QualityEvaluationSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-consensus-quality-evaluation"),
    benchmarkStatus: z.literal("KNOWN_DEVELOPMENT_BENCHMARK"),
    evaluationOnly: z.literal(true),
    machineFreezeHash: hash,
    goldIdentityHash: hash,
    baseline: c61MetricsSchema,
    profiles: z.array(c61ProfileQualitySchema),
    bestGoldFreeProfile: z.string().regex(/^P[0-9]$/u),
    profileSelection: z.literal(
      "POST_HOC_REPORTING_ONLY_NOT_RUNTIME_SELECTION",
    ),
  })
  .strict();
export const c61AttributionSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-consensus-error-attribution"),
    evaluationOnly: z.literal(true),
    regressions: z.array(
      z
        .object({
          profileId: z.string(),
          eventId: z.string(),
          attribution: z.enum([
            "ALIGNMENT_ERROR",
            "SLOT_VOTE_ERROR",
            "CORRELATION_DOUBLE_COUNT",
            "PRONUNCIATION_COLLAPSE_ERROR",
            "SURFACE_RESTORATION_ERROR",
            "EPSILON_ERROR",
            "UNSUPPORTED_PATH_ATTEMPT",
            "PATH_SWITCH_ERROR",
            "CANDIDATE_POOL_INSUFFICIENT",
            "GOLD_ALIGNMENT_UNCERTAIN",
            "UNKNOWN",
          ]),
          evidenceIds: z.array(z.string()),
          rationale: z.string(),
        })
        .strict(),
    ),
    counts: z.record(z.string(), count),
  })
  .strict();
export const c61AblationSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-consensus-ablation"),
    evaluationOnly: z.literal(true),
    machineFreezeHash: hash,
    rows: z.array(
      z
        .object({
          ablationId: z.string(),
          profileId: z.string(),
          evaluationOnly: z.boolean(),
          metrics: c61MetricsSchema.nullable(),
          normalizedEventError: z.number().nonnegative().nullable(),
          changedEvents: count,
          improved: count,
          regressed: count,
          novelPaths: count,
          semanticHash: hash,
        })
        .strict(),
    ),
  })
  .strict();
export const c61RouteDecisionSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-route-decision"),
    decision: z.enum([
      "CONSENSUS_DECODING_GAIN_CONFIRMED",
      "CONSENSUS_ORACLE_POTENTIAL_DECODER_UNSAFE",
      "CONSENSUS_EXISTING_CANDIDATE_ONLY_BETTER",
      "NO_CONSENSUS_ADVANTAGE_OVER_CANDIDATE_UNION",
      "CONSENSUS_ENGINEERING_INVALID",
    ]),
    strongerSignal: z.enum([
      "TOKEN_SPAN_COMBINATION_INFORMATION_GAIN_CONFIRMED",
      "NOT_CONFIRMED",
    ]),
    nextRoute: z.enum([
      "C6.1.1_FROZEN_PROSPECTIVE_SHADOW",
      "C6.1.1_DECODER_CALIBRATION_SHADOW_ONLY",
      "STOP_AUTOMATIC_CONSENSUS_CONTINUE_HUMAN_ON_EXCEPTION",
      "REPAIR_ENGINEERING_BEFORE_RESEARCH_CONCLUSION",
    ]),
    c611Status: z.enum(["GO", "HOLD"]),
    c602Status: z.literal("HOLD"),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    qualifyingProfiles: z.array(z.string()),
    evidenceHashes: z.array(hash),
    reasons: z.array(z.string()),
  })
  .strict();
export const c61ValidationSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-validation"),
    checks: z.array(
      z
        .object({
          checkId: z.string(),
          passed: z.boolean(),
          detail: z.string(),
          evidenceHashes: z.array(hash),
        })
        .strict(),
    ),
    semanticParity: z.record(z.string(), z.boolean()),
    byteParity: z.record(z.string(), z.boolean()),
    productionTextMutation: count,
    productionTimingMutation: count,
    runtimeGoldInputCount: count,
    newAsrInferenceCount: count,
    networkUsed: z.boolean(),
    sourceReadOnly: z.boolean(),
    goldReadOnly: z.boolean(),
    engineeringPassed: z.boolean(),
  })
  .strict();
export type C61Metrics = z.infer<typeof c61MetricsSchema>;
export type C61MachineFreeze = z.infer<typeof c61MachineFreezeSchema>;
export type C61ShadowManifest = z.infer<typeof c61ShadowManifestSchema>;
export type C61Oracle = z.infer<typeof c61OracleSchema>;
export type C61ProfileQuality = z.infer<typeof c61ProfileQualitySchema>;
export type C61QualityEvaluation = z.infer<typeof c61QualityEvaluationSchema>;
export type C61ConsensusSafety = z.infer<typeof c61ConsensusSafetySchema>;
export type C61ConsensusProvenance = z.infer<
  typeof c61ConsensusProvenanceSchema
>;
export type C61Validation = z.infer<typeof c61ValidationSchema>;
export type C61RouteDecision = z.infer<typeof c61RouteDecisionSchema>;
export type C61FileIdentity = z.infer<typeof c61FileIdentitySchema>;
