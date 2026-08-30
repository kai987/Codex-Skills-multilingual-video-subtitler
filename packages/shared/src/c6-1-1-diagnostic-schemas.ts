import { z } from "zod";
import { c611CalibrationProfileIdSchema } from "./c6-1-1-calibration-schemas.js";

const id = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const outcome = z.enum([
  "SWITCH_IMPROVES",
  "SWITCH_REGRESSES",
  "SWITCH_NEUTRAL",
  "SWITCH_UNEVALUABLE",
]);
const application = z.enum(["APPLIED", "BLOCKED", "NOT_SELECTED", "UNKNOWN"]);
const counts = z
  .object({
    caseCount: count,
    requestedSwitchCount: count,
    requestedCorrectCount: count,
    requestedWrongCount: count,
    requestedNeutralCount: count,
    requestedUnknownCount: count,
    actualAppliedCount: count.nullable(),
    actualAppliedCorrectCount: count.nullable(),
    actualAppliedWrongCount: count.nullable(),
    actualAppliedNeutralCount: count.nullable(),
    actualAppliedUnknownCount: count.nullable(),
    rendererBlockedCount: count,
    applicationUnknownCount: count,
    notSelectedImprovingProposalCount: count,
  })
  .strict();
export const c611ErrorAttributionSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: z.literal(
      "c6.1.1-fixed-alignment-selective-existing-mbr-v1",
    ),
    artifactType: z.literal("c6-1-1-selective-mbr-error-attribution"),
    evaluationOnly: z.literal(true),
    privacy: z.literal("LOCAL_ONLY"),
    metricUnit: z.literal("FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL_CASE"),
    causalInterpretation: z.literal(
      "DESCRIPTIVE_ASSOCIATION_NOT_UNIQUE_CAUSATION",
    ),
    correlatedGainsSummed: z.literal(false),
    proposalHash: hash,
    featureHash: hash,
    completenessHash: hash,
    labelHash: hash,
    decisionHash: hash,
    applicationEvidenceHash: hash.nullable(),
    profileQualityHashes: z.record(z.string(), hash),
    cases: z.array(
      z
        .object({
          profileId: c611CalibrationProfileIdSchema,
          eventId: id,
          proposalId: id,
          candidateId: id.nullable(),
          labelCandidateMatched: z.boolean(),
          requestedSwitch: z.boolean(),
          applicationStatus: application,
          counterfactualOutcome: outcome,
          provider: z.enum(["WHISPER", "REAZON", "UNKNOWN"]),
          lengthBucket: z.enum([
            "STRONG_CONTRACTION",
            "MILD_CONTRACTION",
            "SAME_LENGTH",
            "EXPANSION",
            "UNKNOWN",
          ]),
          ctcEvidence: z.enum(["SUPPORT", "VETO", "TIED", "UNKNOWN"]),
          riskClasses: z.array(id),
          diagnosticErrorTypes: z.array(id),
          semanticHash: hash,
        })
        .strict(),
    ),
    profiles: z.array(
      z.object({ profileId: c611CalibrationProfileIdSchema, counts }).strict(),
    ),
    strata: z.array(
      z
        .object({
          profileId: c611CalibrationProfileIdSchema,
          dimension: z.enum(["PROVIDER", "LENGTH", "CTC", "RISK"]),
          value: id,
          counts,
        })
        .strict(),
    ),
    ctcUtility: z
      .object({
        comparison: z.literal("S6_VS_S5_PAIRED_PROFILE_ABLATION"),
        available: z.boolean(),
        pairedCaseCount: count,
        selectionChangedCount: count,
        ctcKnownSelectionChangedCount: count,
        ctcUnknownSelectionChangedCount: count,
        switchedOn: counts,
        switchedOff: counts,
        changedSelectedCandidateCount: count,
        uniquelyCausedByCtcClaim: z.literal(false),
      })
      .strict(),
    limitations: z.array(id),
    semanticHash: hash,
  })
  .strict();

export const c611ReviewSuggestionsSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: z.literal(
      "c6.1.1-fixed-alignment-selective-existing-mbr-v1",
    ),
    artifactType: z.literal("machine-c6-1-1-selective-mbr-review-suggestions"),
    privacy: z.literal("LOCAL_ONLY"),
    usage: z.literal("REVIEW_ASSISTANCE_ONLY"),
    scoreAuthority: z.literal(
      "BENCHMARK_OOF_TRAIN_LABEL_DERIVED_NOT_BLIND_NEW_MODEL",
    ),
    profileSelection: z.literal(
      "CALLER_FIXED_NOT_CHOSEN_FROM_GOLD_BY_SUGGESTER",
    ),
    profileId: c611CalibrationProfileIdSchema,
    runtimeGoldInputCount: z.literal(0),
    goldLabelInputCount: z.literal(0),
    productionMutationCount: z.literal(0),
    humanApprovalRequired: z.literal(true),
    candidateUniverseHash: hash,
    proposalHash: hash,
    decisionHash: hash,
    applicationEvidenceHash: hash.nullable(),
    rows: z.array(
      z
        .object({
          eventId: id,
          proposalId: id,
          currentCandidateId: id.nullable(),
          currentText: z.string().nullable(),
          candidateId: id.nullable(),
          candidateText: z.string().nullable(),
          candidateProvenanceHash: hash.nullable(),
          decision: z.enum([
            "KEEP_CURRENT",
            "SELECT_EXISTING_CANDIDATE",
            "ABSTAIN_REVIEW",
          ]),
          score: z.number().nullable(),
          threshold: z.number().nullable(),
          applicationStatus: application,
          reasons: z.array(id),
          semanticHash: hash,
        })
        .strict(),
    ),
    semanticHash: hash,
  })
  .strict();

export type C611ErrorAttribution = z.infer<typeof c611ErrorAttributionSchema>;
export type C611ReviewSuggestions = z.infer<typeof c611ReviewSuggestionsSchema>;
