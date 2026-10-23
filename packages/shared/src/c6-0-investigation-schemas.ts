import { z } from "zod";

import { schemaVersionSchema } from "./schemas.js";

export const c60HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const nonEmptyStringSchema = z.string().min(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/])(?!\\\\).+/u, "Path must be relative.");

export const c60BlockerScopeSchema = z.enum([
  "current-output-safety",
  "automatic-mutation-safety",
  "evidence-availability",
  "evidence-consistency",
  "delivery-integrity",
  "format-compatibility",
  "diagnostic-only",
]);

export const c60ProposedDispositionSchema = z.enum([
  "FINAL_BLOCKER",
  "MUTATION_GUARD",
  "REVIEW_ADVISORY",
  "DIAGNOSTIC_ONLY",
  "CONTEXT_DEPENDENT",
  "SUPERSEDED",
  "UNKNOWN",
]);

export const c60EvidencePolaritySchema = z.enum([
  "positive-risk-evidence",
  "absence-of-support",
  "contradictory-evidence",
  "execution-diagnostic",
  "format-advisory",
]);

export const c60RiskLevelSchema = z.enum([
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
  "UNKNOWN",
]);

export const c60HumanReviewNecessitySchema = z.enum([
  "mandatory-current-output-risk",
  "recommended-advisory",
  "not-required-for-preservation",
]);

const sourceSnapshotSchema = z
  .object({
    sourceTaskName: nonEmptyStringSchema,
    sourceTaskHash: c60HashSchema,
    canonicalCueHash: c60HashSchema,
    timingHash: c60HashSchema,
    outputCueHash: c60HashSchema,
    sourceStatus: z.literal("needs-review"),
    sourceFinalizationMethod: z.literal("none"),
    sourceReviewItemCount: z.literal(7),
    sourceFinalArtifactPresent: z.literal(false),
    causalReplayParity: z.boolean(),
    frozenReplayParity: z.boolean(),
  })
  .strict();

const commonFields = {
  schemaVersion: schemaVersionSchema,
  investigationVersion: z.literal("C6.0"),
  generatedAt: z.iso.datetime(),
  sourceSnapshot: sourceSnapshotSchema,
  semanticHash: c60HashSchema,
} as const;

export const c60BlockerProducerSchema = z
  .object({
    producerPath: relativePathSchema,
    producerFunction: nonEmptyStringSchema,
    line: z.number().int().positive(),
    conditionSummary: nonEmptyStringSchema,
  })
  .strict();

export const c60BlockerInventoryEntrySchema = z
  .object({
    code: nonEmptyStringSchema,
    producers: z.array(c60BlockerProducerSchema),
    declaredInCode: z.boolean(),
    observedInCurrentRun: z.boolean(),
    artifactOccurrenceCount: nonNegativeIntegerSchema,
    componentOccurrenceCount: nonNegativeIntegerSchema,
    layers: z.array(nonEmptyStringSchema),
    deadOrLegacyCandidate: z.boolean(),
  })
  .strict();

export const c60BlockerInventorySchema = z
  .object({
    ...commonFields,
    artifactType: z.literal("c6-0-blocker-inventory"),
    sourceFilesScanned: z.array(relativePathSchema).min(1),
    entries: z.array(c60BlockerInventoryEntrySchema).min(1),
    summary: z
      .object({
        codeCount: nonNegativeIntegerSchema,
        declaredCodeCount: nonNegativeIntegerSchema,
        observedCodeCount: nonNegativeIntegerSchema,
        deadOrLegacyCandidateCount: nonNegativeIntegerSchema,
      })
      .strict(),
  })
  .strict();

export const c60BlockerOntologyEntrySchema = z
  .object({
    code: nonEmptyStringSchema,
    canonicalRiskFamily: nonEmptyStringSchema,
    currentScope: c60BlockerScopeSchema,
    evidencePolarity: c60EvidencePolaritySchema,
    proposedDisposition: c60ProposedDispositionSchema,
    currentOutputRisk: c60RiskLevelSchema,
    proposedMutationRisk: c60RiskLevelSchema,
    providerSpecific: z.boolean(),
    contextRule: nonEmptyStringSchema,
    rationale: nonEmptyStringSchema,
  })
  .strict();

export const c60BlockerOntologySchema = z
  .object({
    ...commonFields,
    artifactType: z.literal("c6-0-blocker-ontology"),
    entries: z.array(c60BlockerOntologyEntrySchema).min(1),
    summary: z
      .object({
        classifiedCodeCount: nonNegativeIntegerSchema,
        observedUnknownCodeCount: nonNegativeIntegerSchema,
        finalBlockerCodeCount: nonNegativeIntegerSchema,
        mutationGuardCodeCount: nonNegativeIntegerSchema,
        reviewAdvisoryCodeCount: nonNegativeIntegerSchema,
        diagnosticCodeCount: nonNegativeIntegerSchema,
        contextDependentCodeCount: nonNegativeIntegerSchema,
        supersededCodeCount: nonNegativeIntegerSchema,
      })
      .strict(),
  })
  .strict();

export const c60BlockerSupersessionEntrySchema = z
  .object({
    code: nonEmptyStringSchema,
    componentId: nonEmptyStringSchema.nullable(),
    cueIds: z.array(nonEmptyStringSchema),
    originalEvidenceRef: nonEmptyStringSchema,
    laterEvidenceRef: nonEmptyStringSchema,
    originalState: nonEmptyStringSchema,
    laterState: nonEmptyStringSchema,
    superseded: z.boolean(),
    supersessionReason: nonEmptyStringSchema,
    canonicalTextChanged: z.literal(false),
    timingChanged: z.literal(false),
  })
  .strict();

export const c60BlockerSupersessionAuditSchema = z
  .object({
    ...commonFields,
    artifactType: z.literal("c6-0-blocker-supersession-audit"),
    freshnessPolicyVersion: z.literal("c6-0-evidence-freshness-v1"),
    entries: z.array(c60BlockerSupersessionEntrySchema),
    unresolvedStaleBlockerCount: nonNegativeIntegerSchema,
  })
  .strict();

const graphNodeSchema = z
  .object({
    nodeId: nonEmptyStringSchema,
    nodeType: z.enum(["root-risk-family", "blocker-code", "evidence-state"]),
    label: nonEmptyStringSchema,
  })
  .strict();

const graphEdgeSchema = z
  .object({
    from: nonEmptyStringSchema,
    to: nonEmptyStringSchema,
    relation: z.enum(["causes", "manifests-as", "guards", "supersedes"]),
  })
  .strict();

export const c60BlockerRootCauseGraphSchema = z
  .object({
    ...commonFields,
    artifactType: z.literal("c6-0-blocker-root-cause-graph"),
    nodes: z.array(graphNodeSchema).min(1),
    edges: z.array(graphEdgeSchema),
    rootRiskFamilies: z.array(nonEmptyStringSchema).min(1),
    graphAcyclic: z.literal(true),
    rawObservedBlockerCodeCount: nonNegativeIntegerSchema,
    deduplicatedRootRiskFamilyCount: nonNegativeIntegerSchema,
  })
  .strict();

const evidenceDigestSchema = z
  .object({
    source: nonEmptyStringSchema,
    status: nonEmptyStringSchema,
    result: nonEmptyStringSchema,
    evidencePolarity: c60EvidencePolaritySchema,
    blockers: z.array(nonEmptyStringSchema),
    evidenceIds: z.array(nonEmptyStringSchema),
  })
  .strict();

export const c60ComponentRiskEntrySchema = z
  .object({
    componentId: nonEmptyStringSchema,
    cueIds: z.array(nonEmptyStringSchema).min(2),
    interval: z
      .object({ start: z.number().nonnegative(), end: z.number().positive() })
      .strict(),
    overlapSeconds: z.number().positive(),
    currentText: nonEmptyStringSchema,
    currentBlockers: z.array(nonEmptyStringSchema).min(1),
    effectiveBlockersAfterFreshness: z.array(nonEmptyStringSchema),
    evidence: z
      .object({
        forcedAlignment: evidenceDigestSchema,
        ctc: evidenceDigestSchema,
        speaker: evidenceDigestSchema,
        separatedStreams: evidenceDigestSchema,
        mappedTokenAndVad: evidenceDigestSchema,
        overlapAcoustic: evidenceDigestSchema,
        presentation: evidenceDigestSchema,
        memoryPronunciation: evidenceDigestSchema,
      })
      .strict(),
    speakerRelationshipResolved: z.boolean(),
    subtitleOverlapResolved: z.literal(false),
    safeAutomaticMutationAvailable: z.literal(false),
    positiveCurrentOutputDefectEvidence: z.boolean(),
    currentOutputRisk: c60RiskLevelSchema,
    proposedMutationRisk: c60RiskLevelSchema,
    naturalConclusion: nonEmptyStringSchema,
    humanReviewNecessity: c60HumanReviewNecessitySchema,
    formatAssessment: z
      .object({
        srt: z.enum(["safe", "advisory", "unsafe", "unknown"]),
        vtt: z.enum(["safe", "advisory", "unsafe", "unknown"]),
        ass: z.enum(["safe", "advisory", "unsafe", "unknown"]),
      })
      .strict(),
  })
  .strict()
  .refine((entry) => entry.interval.end > entry.interval.start, {
    message: "Component interval must have positive duration.",
  });

export const c60ComponentRiskAuditSchema = z
  .object({
    ...commonFields,
    artifactType: z.enum([
      "c6-0-component-risk-audit",
      "c6-0-component-evidence-matrix",
    ]),
    components: z.array(c60ComponentRiskEntrySchema).length(7),
    summary: z
      .object({
        componentCount: z.literal(7),
        positiveCurrentOutputDefectComponentCount: nonNegativeIntegerSchema,
        safeRepairMissingComponentCount: nonNegativeIntegerSchema,
        speakerRelationshipResolvedComponentCount: nonNegativeIntegerSchema,
        subtitleOverlapResolvedComponentCount: z.literal(0),
        mandatoryCurrentOutputReviewCount: nonNegativeIntegerSchema,
        recommendedAdvisoryReviewCount: nonNegativeIntegerSchema,
        preservationReviewNotRequiredCount: nonNegativeIntegerSchema,
      })
      .strict(),
  })
  .strict();

const counterfactualScenarioSchema = z
  .object({
    scenarioId: z.enum(["A", "B", "C", "D", "E"]),
    name: nonEmptyStringSchema,
    includedDispositions: z.array(c60ProposedDispositionSchema),
    gateRule: nonEmptyStringSchema,
    retainedBlockerCodes: z.array(nonEmptyStringSchema),
    retainedBlockingFindingCount: nonNegativeIntegerSchema,
    wouldFinalize: z.boolean(),
    counterfactualOnly: z.literal(true),
    outputCueHash: c60HashSchema,
    timingHash: c60HashSchema,
    reviewItemCount: z.literal(7),
  })
  .strict();

export const c60FinalizationCounterfactualSchema = z
  .object({
    ...commonFields,
    artifactType: z.literal("c6-0-finalization-counterfactual"),
    scenarios: z.array(counterfactualScenarioSchema).length(5),
    subtitleMutationCount: z.literal(0),
    timingMutationCount: z.literal(0),
    finalSubtitleEmitted: z.literal(false),
  })
  .strict();

export const c60HumanAuthorityDependencyAuditSchema = z
  .object({
    ...commonFields,
    artifactType: z.literal("c6-0-human-authority-dependency-audit"),
    authority: z.literal("user-confirmed-human-review"),
    baselineCueCount: z.literal(192),
    baselineReadOnlyVerified: z.literal(true),
    humanAuthorityUsedForCanonicalText: z.literal(true),
    humanAuthorityUsedForCanonicalTiming: z.literal(true),
    machineOnlyBlindProofPresent: z.boolean(),
    humanBaselineCounterfactualReady: z.boolean(),
    machineOnlyZeroTouchReady: z.boolean(),
    dependencyRisks: z.array(nonEmptyStringSchema),
    blindDatasetMethodology: z.array(nonEmptyStringSchema).min(1),
  })
  .strict();

export const c60ZeroTouchReadinessSchema = z
  .object({
    ...commonFields,
    artifactType: z.literal("c6-0-zero-touch-readiness"),
    implementationGo: z.boolean(),
    defaultReleaseGo: z.boolean(),
    humanBaselinePathReady: z.boolean(),
    machineOnlyPathReady: z.boolean(),
    currentRunCanFinalizeUnderProposedPositiveRiskPolicy: z.boolean(),
    unknownBlockersFailClosed: z.literal(true),
    freshnessCheckedBeforeGate: z.literal(true),
    providerFailureSemantics: z
      .object({
        providerFailureBlocksCurrentOutput: z.literal(false),
        providerFailureBlocksDependentMutation: z.literal(true),
        contradictoryPositiveRiskRemainsBlocking: z.literal(true),
      })
      .strict(),
    evidenceConsensusPolicy: z.array(nonEmptyStringSchema).min(1),
    prerequisites: z.array(nonEmptyStringSchema),
    rationale: nonEmptyStringSchema,
  })
  .strict();

export const c60InvestigationSummarySchema = z
  .object({
    ...commonFields,
    artifactType: z.literal("c6-0-investigation-summary"),
    runLabel: nonEmptyStringSchema,
    execution: z
      .object({
        modelInferenceCount: z.literal(0),
        modelLoadCount: z.literal(0),
        networkUsed: z.literal(false),
        subtitleMutationCount: z.literal(0),
        timingMutationCount: z.literal(0),
        presentationMutationCount: z.literal(0),
      })
      .strict(),
    counts: z
      .object({
        inventoryCodeCount: nonNegativeIntegerSchema,
        observedBlockerCodeCount: nonNegativeIntegerSchema,
        observedUnknownBlockerCount: nonNegativeIntegerSchema,
        rawBlockingFindingCount: z.literal(14),
        rootRiskFamilyCount: nonNegativeIntegerSchema,
        componentCount: z.literal(7),
        positiveCurrentOutputDefectComponentCount: nonNegativeIntegerSchema,
        safeRepairMissingComponentCount: nonNegativeIntegerSchema,
        remainingReviewItemCount: z.literal(7),
      })
      .strict(),
    artifactFiles: z.array(relativePathSchema).min(9),
    semanticParityEligible: z.literal(true),
    currentStatus: z.literal("needs-review"),
    currentFinalizationMethod: z.literal("none"),
    finalSubtitleEmitted: z.literal(false),
    canonicalCueHash: c60HashSchema,
    timingHash: c60HashSchema,
    presentationHash: c60HashSchema,
    decision: z
      .object({
        implementation: z.enum(["GO", "NO-GO"]),
        defaultRelease: z.enum(["GO", "NO-GO"]),
        rationale: nonEmptyStringSchema,
      })
      .strict(),
    shareableAudit: z
      .object({
        fileCount: nonNegativeIntegerSchema,
        passedFileCount: nonNegativeIntegerSchema,
        absolutePathLeakCount: z.literal(0),
        secretFindingCount: z.literal(0),
        brokenRelativeReferenceCount: z.literal(0),
      })
      .strict(),
  })
  .strict();

export type C60BlockerInventory = z.infer<typeof c60BlockerInventorySchema>;
export type C60BlockerOntology = z.infer<typeof c60BlockerOntologySchema>;
export type C60BlockerOntologyEntry = z.infer<
  typeof c60BlockerOntologyEntrySchema
>;
export type C60BlockerSupersessionAudit = z.infer<
  typeof c60BlockerSupersessionAuditSchema
>;
export type C60BlockerRootCauseGraph = z.infer<
  typeof c60BlockerRootCauseGraphSchema
>;
export type C60ComponentRiskEntry = z.infer<typeof c60ComponentRiskEntrySchema>;
export type C60ComponentRiskAudit = z.infer<typeof c60ComponentRiskAuditSchema>;
export type C60FinalizationCounterfactual = z.infer<
  typeof c60FinalizationCounterfactualSchema
>;
export type C60HumanAuthorityDependencyAudit = z.infer<
  typeof c60HumanAuthorityDependencyAuditSchema
>;
export type C60ZeroTouchReadiness = z.infer<typeof c60ZeroTouchReadinessSchema>;
export type C60InvestigationSummary = z.infer<
  typeof c60InvestigationSummarySchema
>;
