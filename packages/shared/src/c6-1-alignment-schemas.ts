import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const id = z.string().min(1);
export const c61ProviderFamilySchema = z.enum(["WHISPER", "REAZON", "CURRENT"]);
export const c61IntervalSchema = z
  .object({ start: z.number().nonnegative(), end: z.number().nonnegative() })
  .strict()
  .refine((x) => x.end >= x.start);
export const c61CandidateTextSchema = z
  .object({
    candidateId: id,
    eventId: id,
    providerFamily: c61ProviderFamilySchema,
    displayText: z.string(),
    normalizedText: z.string(),
    pronunciationText: z.string().nullable(),
    correlationGroupId: id,
    provenanceHash: hash,
    sourceInterval: c61IntervalSchema,
    pronunciationUnits: z
      .array(
        z
          .object({
            unitIndex: count,
            reading: z.string().min(1),
            evidenceId: id,
          })
          .strict(),
      )
      .optional(),
    rawVoteCandidateIds: z.array(id).min(1).optional(),
  })
  .strict();
export const c61TextUnitSchema = z
  .object({
    unitIndex: count,
    displaySurface: z.string().min(1),
    normalizedForm: z.string().min(1),
    pronunciationForm: z.string().nullable(),
    pronunciationEvidenceId: z.string().nullable(),
    kind: z.enum(["LEXICAL", "PUNCTUATION", "WHITESPACE"]),
  })
  .strict();
export const c61TextRepresentationSchema = z
  .object({
    candidate: c61CandidateTextSchema,
    units: z.array(c61TextUnitSchema),
    normalizedText: z.string(),
    pronunciationText: z.string().nullable(),
    normalizationVersion: z.literal("c6.1-japanese-nfkc-grapheme-v1"),
    semanticHash: hash,
  })
  .strict();
export const c61AlignmentOperationSchema = z.enum([
  "EXACT",
  "NORMALIZED_EQUIVALENT",
  "PRONUNCIATION_EQUIVALENT",
  "SUBSTITUTION",
  "INSERTION",
  "DELETION",
]);
export const c61AlignedUnitSchema = z
  .object({
    leftIndex: count.nullable(),
    rightIndex: count.nullable(),
    leftSurface: z.string().nullable(),
    rightSurface: z.string().nullable(),
    operation: c61AlignmentOperationSchema,
    cost: z.number().nonnegative(),
  })
  .strict();
export const c61PairwiseAlignmentSchema = z
  .object({
    eventId: id,
    leftCandidateId: id,
    rightCandidateId: id,
    alignedUnits: z.array(c61AlignedUnitSchema),
    editOperations: z.array(c61AlignmentOperationSchema),
    displayDistance: count,
    normalizedDistance: count,
    pronunciationDistance: count.nullable(),
    weightedCost: z.number().nonnegative(),
    monotonic: z.literal(true),
    alignmentStatus: z.literal("ALIGNED"),
    costPolicyVersion: z.literal("c6.1-alignment-cost-v1"),
    pronunciationAware: z.boolean(),
    semanticHash: hash,
  })
  .strict();
export const c61AlignmentProfileSchema = z.enum([
  "CENTER_CURRENT",
  "CENTER_MEDOID",
  "CENTER_PROVIDER_BALANCED_MEDOID",
]);
export const c61MultipleAlignmentSchema = z
  .object({
    eventId: id,
    profile: c61AlignmentProfileSchema,
    centerCandidateId: id,
    candidateOrder: z.array(id),
    slotCount: count,
    rows: z.array(
      z
        .object({ candidateId: id, unitIndices: z.array(count.nullable()) })
        .strict(),
    ),
    pairwiseAlignments: z.array(c61PairwiseAlignmentSchema),
    pronunciationAware: z.boolean(),
    semanticHash: hash,
  })
  .strict();
export const c61NodeProvenanceSchema = z
  .object({
    candidateId: id,
    unitIndex: count.nullable(),
    displaySurface: z.string().nullable(),
    providerFamily: c61ProviderFamilySchema,
    correlationGroupId: id,
    provenanceHash: hash,
  })
  .strict();
export const c61LatticeNodeSchema = z
  .object({
    nodeId: id,
    eventId: id,
    slotIndex: z.number().int(),
    kind: z.enum(["TOKEN", "EPSILON", "START", "END"]),
    displaySurfaces: z.array(z.string().min(1)),
    normalizedForm: z.string().nullable(),
    pronunciationForm: z.string().nullable(),
    candidateProvenance: z.array(c61NodeProvenanceSchema).min(1),
    providerFamilies: z.array(c61ProviderFamilySchema),
    correlationGroups: z.array(id),
    epsilonAllowed: z.boolean(),
    switchAllowed: z.boolean(),
    semanticHash: hash,
  })
  .strict();
export const c61LatticeEdgeSchema = z
  .object({
    edgeId: id,
    fromNode: id,
    toNode: id,
    supportingCandidateIds: z.array(id).min(1),
    providerFamilies: z.array(c61ProviderFamilySchema),
    correlationGroups: z.array(id),
    observedAdjacency: z.literal(true),
    semanticHash: hash,
  })
  .strict();
export const c61TokenLatticeSchema = z
  .object({
    eventId: id,
    sourceInterval: c61IntervalSchema,
    alignmentHash: hash,
    nodes: z.array(c61LatticeNodeSchema),
    edges: z.array(c61LatticeEdgeSchema),
    candidatePaths: z.array(
      z.object({ candidateId: id, nodeIds: z.array(id) }).strict(),
    ),
    startNodeId: id,
    endNodeId: id,
    semanticHash: hash,
  })
  .strict();
export const c61ConfusionAlternativeSchema = z
  .object({
    nodeId: id,
    displaySurface: z.string().nullable(),
    normalizedForm: z.string().nullable(),
    pronunciationForm: z.string().nullable(),
    candidateIds: z.array(id),
    providerFamilies: z.array(c61ProviderFamilySchema),
    correlationGroupIds: z.array(id),
    incomingEdges: z.array(id),
    outgoingEdges: z.array(id),
  })
  .strict();
export const c61ConfusionSlotSchema = z
  .object({
    slotId: id,
    eventId: id,
    position: count,
    alternatives: z.array(c61ConfusionAlternativeSchema),
    epsilonAlternative: c61ConfusionAlternativeSchema.nullable(),
    candidateSupportCount: count,
    providerSupportCount: count,
    correlationGroupSupportCount: count,
    surfaceVariants: z.array(z.string()),
    pronunciationVariants: z.array(z.string()),
    acousticEvidence: z.array(id),
    stabilityEvidence: z.array(id),
    normalizedEntropy: z.number().min(0).max(1),
    ambiguityStatus: z.enum([
      "EXACT_AGREEMENT",
      "NORMALIZED_AGREEMENT",
      "PRONUNCIATION_EQUIVALENT",
      "LEXICAL_DISAGREEMENT",
    ]),
    semanticHash: hash,
  })
  .strict();
export const c61ConfusionNetworkSchema = z
  .object({
    eventId: id,
    latticeHash: hash,
    slots: z.array(c61ConfusionSlotSchema),
    semanticHash: hash,
  })
  .strict();
export const c61ConsensusSpanSchema = z
  .object({
    spanId: id,
    eventId: id,
    slotStart: count,
    slotEnd: count,
    currentSurface: z.string().nullable(),
    alternatives: z.array(
      z
        .object({
          displaySurface: z.string(),
          nodeIds: z.array(id),
          supportingCandidates: z.array(id).min(1),
          providerFamilies: z.array(c61ProviderFamilySchema),
        })
        .strict(),
    ),
    supportingCandidates: z.array(id),
    providerFamilies: z.array(c61ProviderFamilySchema),
    pronunciationRelations: z.array(z.string()),
    legalEntryNodes: z.array(id),
    legalExitNodes: z.array(id),
    ambiguity: z.literal("CONTIGUOUS_CANDIDATE_SPAN_ONLY"),
    semanticHash: hash,
  })
  .strict();
export const c61PathValidationSchema = z
  .object({
    valid: z.boolean(),
    status: z.enum(["LEGAL_PATH", "UNSAFE_CONSENSUS_PATH_REJECTED"]),
    reasons: z.array(z.string()),
    providerSwitchCount: count,
    candidateSwitchCount: count,
    sourceCandidateIds: z.array(id),
    edgeIds: z.array(id),
    violations: z
      .object({
        unsupportedTokenCount: count,
        unsupportedAdjacencyCount: count,
        crossEventTokenCount: count,
        nonMonotonicPathCount: count,
        pathCycleCount: count,
        candidateProvenanceMissingCount: count,
        providerSwitchLimitViolationCount: count,
        spanSupportViolationCount: count,
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();
export const c61SurfaceRestorationSchema = z
  .object({
    displayText: z.string(),
    normalizedText: z.string(),
    sourceCandidateIds: z.array(id),
    orthographyOnly: z.boolean(),
    tokenProvenance: z.array(
      z
        .object({
          outputPosition: count,
          outputSurface: z.string(),
          sourceCandidateId: id,
          sourceUnitIndex: count,
          latticeNodeId: id,
          latticeEdgeIds: z.array(id),
          provenanceHash: hash,
        })
        .strict(),
    ),
    semanticHash: hash,
  })
  .strict();
export type C61ProviderFamily = z.infer<typeof c61ProviderFamilySchema>;
export type C61CandidateText = z.infer<typeof c61CandidateTextSchema>;
export type C61TextUnit = z.infer<typeof c61TextUnitSchema>;
export type C61TextRepresentation = z.infer<typeof c61TextRepresentationSchema>;
export type C61PairwiseAlignment = z.infer<typeof c61PairwiseAlignmentSchema>;
export type C61AlignedUnit = z.infer<typeof c61AlignedUnitSchema>;
export type C61AlignmentProfile = z.infer<typeof c61AlignmentProfileSchema>;
export type C61MultipleAlignment = z.infer<typeof c61MultipleAlignmentSchema>;
export type C61LatticeNode = z.infer<typeof c61LatticeNodeSchema>;
export type C61LatticeEdge = z.infer<typeof c61LatticeEdgeSchema>;
export type C61TokenLattice = z.infer<typeof c61TokenLatticeSchema>;
export type C61ConfusionAlternative = z.infer<
  typeof c61ConfusionAlternativeSchema
>;
export type C61ConfusionNetwork = z.infer<typeof c61ConfusionNetworkSchema>;
export type C61ConsensusSpan = z.infer<typeof c61ConsensusSpanSchema>;
export type C61PathValidation = z.infer<typeof c61PathValidationSchema>;
export type C61SurfaceRestoration = z.infer<typeof c61SurfaceRestorationSchema>;
