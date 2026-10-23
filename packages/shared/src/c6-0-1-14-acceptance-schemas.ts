import { z } from "zod";
import {
  c60114CountSchema as count,
  c60114RatioSchema as ratio,
  c60114Sha256Schema as hash,
} from "./c6-0-1-14-evidence-schemas.js";
import { c60114EvaluationRouteSchema } from "./c6-0-1-14-evaluation-schemas.js";

export const c60114CodeValidationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-code-validation"),
    generatedAt: z.iso.datetime(),
    nodeVersion: z.string().min(1),
    packageManager: z.string().min(1),
    results: z.array(
      z
        .object({
          id: z.enum([
            "typecheck",
            "lint",
            "format-check",
            "build",
            "unit",
            "e2e",
            "c60114-targeted",
          ]),
          command: z.array(z.string()).min(1),
          exitCode: z.number().int(),
          passed: z.boolean(),
          elapsedSeconds: z.number().nonnegative(),
          logRelativePath: z.string().min(1),
          logSha256: hash,
          testSummary: z.array(z.string()),
        })
        .strict(),
    ),
    passed: z.boolean(),
    realAsrExecutedByValidation: z.literal(false),
    goldEvaluationExecutedByValidation: z.literal(false),
    rankerTrainingExecutedByValidation: z.literal(false),
  })
  .strict();
export const c60114AcceptanceManualChecksSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-acceptance-manual-checks"),
    codeValidationByteSha256: hash,
    datasetSpecificHardcoding: z
      .object({
        status: z.enum(["PASS", "FAIL", "NOT_CHECKED"]),
        method: z.enum([
          "EXPLICIT_MANUAL_CODE_REVIEW",
          "STATIC_AUDIT",
          "NOT_PERFORMED",
        ]),
        evidenceSha256: hash.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.datasetSpecificHardcoding.status !== "NOT_CHECKED" &&
      (value.datasetSpecificHardcoding.method === "NOT_PERFORMED" ||
        value.datasetSpecificHardcoding.evidenceSha256 === null)
    )
      context.addIssue({
        code: "custom",
        message:
          "Completed code audit requires an explicit method and evidence hash",
      });
  });
export const c60114AcceptanceProbeAuditSchema = z
  .object({
    mode: z.enum(["fresh", "exact-cache-only", "completion-inherited-fresh"]),
    plannedRequests: count,
    requestRecordCount: count,
    recordedFreshInferences: count,
    consumedFreshInferences: count,
    persistedResultCount: count,
    persistedSuccessfulResults: count,
    persistedEmptyOutputResults: count,
    verifiedCacheResults: count,
    replayCacheHits: count,
    historicalLostSuccessfulResults: count,
    unpersistedPlannedRequests: count,
    defaultRequestLimit: z.literal(64),
    authorizedAdditionalInferences: count,
    budgetPassed: z.boolean(),
    persistencePassed: z.boolean(),
    accountingPassed: z.boolean(),
    passed: z.boolean(),
  })
  .strict();
const gate = z.enum(["PASS", "BLOCKED", "NOT_EVALUATED"]);
const coverage = z
  .object({
    errorComponentCount: count,
    audibleCoveredCount: count,
    audibleRecall: ratio,
    speechCoveredCount: count,
    localizedLexicalCoveredCount: count,
    crossSourceLocalizedCount: count,
    lineageOnlyCount: count,
  })
  .strict();
const category = z
  .object({
    status: gate,
    fullQueue: coverage.nullable(),
    allMandatory: coverage.nullable(),
  })
  .strict();
export const c60114AcceptanceCheckIdSchema = z.enum([
  "FINAL_FREEZES_AND_READ_ONLY_SOURCE",
  "CANONICAL_BYTE_PARITY",
  "MACHINE_SEMANTIC_PARITY",
  "STRICT_MACHINE_DELIVERY_GRAPH",
  "FRESH_RESULTS_PERSISTED",
  "EXACT_CACHE_REPLAY_COMPLETE",
  "FRESH_REPLAY_SEMANTIC_PARITY",
  "CODE_VALIDATION",
  "DATASET_HARDCODING_AUDIT",
]);
const checks = z.array(
  z
    .object({
      id: c60114AcceptanceCheckIdSchema,
      status: z.enum(["PASS", "FAIL", "NOT_CHECKED"]),
    })
    .strict(),
);
const route = z
  .object({
    decision: c60114EvaluationRouteSchema,
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
    humanTrialStarted: z.literal(false),
    realHumanTrialExecuted: z.literal(false),
  })
  .strict();
const common = {
  schemaVersion: z.literal("1.0.0"),
  engineering: z.object({ status: gate, checks }).strict(),
  evaluation: z
    .object({
      status: gate,
      integrityFailureCount: count,
      evaluatedBudgetCount: count,
      playbackPlanBindingsVerified: z.boolean(),
      officialRecallMetric: z.literal(
        "PHYSICAL_PLAYABLE_AUDIO_INTERSECT_ACTUAL_PLAYBACK_AUDIBLE_0_8",
      ),
      lineageMetricStatus: z.literal("NOT_A_PLAYBACK_RECALL_METRIC"),
    })
    .strict(),
  missing: category,
  hallucination: category,
  probes: z
    .object({
      fresh: c60114AcceptanceProbeAuditSchema,
      replay: c60114AcceptanceProbeAuditSchema,
      semanticParityPassed: z.boolean(),
    })
    .strict(),
  route,
  privacy: z
    .object({
      fullArtifacts: z.literal("LOCAL_ONLY"),
      shareableContents: z.literal("AGGREGATE_ONLY"),
      rawTextIncluded: z.literal(false),
      rawAudioIncluded: z.literal(false),
      localPathsIncluded: z.literal(false),
      sessionDataIncluded: z.literal(false),
      goldDetailsIncluded: z.literal(false),
    })
    .strict(),
};
export const c60114AcceptanceSummarySchema = z
  .object({
    ...common,
    artifactType: z.literal("c6-0-1-14-run-validation"),
    visibility: z.literal("LOCAL_ONLY"),
    generatedAt: z.iso.datetime(),
    sourceIdentityHash: hash,
    inputHashes: z
      .object({
        finalAFreeze: hash,
        finalBFreeze: hash,
        freshProbes: hash,
        replayProbes: hash,
        codeValidation: hash,
        playbackEvaluation: hash,
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();
export const c60114AcceptanceShareableSchema = z
  .object({
    ...common,
    artifactType: z.literal("c6-0-1-14-shareable-validation-summary"),
    visibility: z.literal("SHAREABLE_AGGREGATE_ONLY"),
    semanticHash: hash,
  })
  .strict();
export type C60114CodeValidation = z.infer<typeof c60114CodeValidationSchema>;
export type C60114AcceptanceManualChecks = z.infer<
  typeof c60114AcceptanceManualChecksSchema
>;
export type C60114AcceptanceProbeAudit = z.infer<
  typeof c60114AcceptanceProbeAuditSchema
>;
export type C60114AcceptanceSummary = z.infer<
  typeof c60114AcceptanceSummarySchema
>;
export type C60114AcceptanceShareable = z.infer<
  typeof c60114AcceptanceShareableSchema
>;
