import * as machine from "./c6-1-1-machine-schemas.js";
import * as calibration from "./c6-1-1-calibration-schemas.js";
import * as evaluation from "./c6-1-1-evaluation-schemas.js";
import * as io from "./c6-1-1-io-schemas.js";
import * as route from "./c6-1-1-route-schemas.js";
import * as diagnostic from "./c6-1-1-diagnostic-schemas.js";
import * as validation from "./c6-1-1-validation-schemas.js";

/** Standalone artifact contracts. Nested rows are covered by their parent schema. */
export const c611GeneratedSchemas = [
  [
    "machine-c6-1-1-hierarchical-correlation-groups",
    machine.machineC611HierarchicalCorrelationGroupsSchema,
  ],
  [
    "machine-c6-1-1-candidate-correlation-audit",
    machine.machineC611CandidateCorrelationAuditSchema,
  ],
  [
    "machine-existing-candidate-mbr-risk-ledger",
    machine.machineExistingCandidateMbrRiskLedgerSchema,
  ],
  [
    "machine-selective-existing-candidate-proposals",
    machine.machineSelectiveExistingCandidateProposalsSchema,
  ],
  [
    "machine-existing-candidate-completeness-risk",
    machine.machineExistingCandidateCompletenessRiskSchema,
  ],
  ["machine-selective-mbr-features", machine.machineSelectiveMbrFeaturesSchema],
  ["c6-1-1-calibration-policy", calibration.c611CalibrationPolicySchema],
  ["c6-1-1-calibration-folds", calibration.c611CalibrationFoldsSchema],
  [
    "c6-1-1-out-of-fold-selective-decisions",
    calibration.c611OofDecisionsSchema,
  ],
  [
    "c6-1-1-fixed-baseline-alignment-map",
    evaluation.c611FixedBaselineAlignmentMapSchema,
  ],
  [
    "c6-1-1-fixed-alignment-evaluation",
    evaluation.c611FixedAlignmentEvaluationSchema,
  ],
  [
    "gold-selective-existing-candidate-labels",
    evaluation.c611ProposalLabelsSchema,
  ],
  [
    "c6-1-1-selective-profile-quality",
    evaluation.c611SelectiveProfileQualitySchema,
  ],
  [
    "c6-1-1-grouped-existing-candidate-oracles",
    evaluation.c611GroupedOracleSchema,
  ],
  ["c6-1-1-baseline", io.c611BaselineSchema],
  ["c6-1-1-policy-freeze", io.c611PolicyFreezeSchema],
  ["c6-1-1-machine-feature-freeze", io.c611MachineFeatureFreezeSchema],
  ["c6-1-1-read-only-proof", io.c611ReadOnlyProofSchema],
  ["c6-1-1-validation", io.c611ValidationSchema],
  ["c6-1-1-legacy-p6-control", io.c611LegacyControlSchema],
  ["c6-1-1-shadow-manifest", io.c611ShadowManifestSchema],
  ["c6-1-1-selective-profile-results", io.c611SelectiveProfileResultsSchema],
  ["c6-1-1-shareable-summary", io.c611ShareableSummarySchema],
  ["c6-1-1-route-decision", route.c611RouteDecisionSchema],
  ["c6-1-1-selective-mbr-freeze", route.c611SelectiveMbrFreezeSchema],
  [
    "c6-1-1-selective-mbr-error-attribution",
    diagnostic.c611ErrorAttributionSchema,
  ],
  [
    "machine-c6-1-1-selective-mbr-review-suggestions",
    diagnostic.c611ReviewSuggestionsSchema,
  ],
  ["c6-1-1-regression-evidence", validation.c611RegressionEvidenceSchema],
] as const;
