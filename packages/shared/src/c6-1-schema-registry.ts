import * as c61 from "./c6-1-consensus-schemas.js";

export const c61GeneratedSchemas = [
  [
    "machine-multi-asr-hypothesis-universe",
    c61.machineMultiAsrHypothesisUniverseSchema,
  ],
  [
    "machine-multi-asr-text-representations",
    c61.machineMultiAsrTextRepresentationsSchema,
  ],
  [
    "machine-multi-asr-pairwise-alignments",
    c61.machineMultiAsrPairwiseAlignmentsSchema,
  ],
  [
    "machine-multi-asr-multiple-alignments",
    c61.machineMultiAsrMultipleAlignmentsSchema,
  ],
  ["machine-multi-asr-token-lattice", c61.machineMultiAsrTokenLatticeSchema],
  [
    "machine-multi-asr-confusion-network",
    c61.machineMultiAsrConfusionNetworkSchema,
  ],
  ["machine-multi-asr-span-consensus", c61.machineMultiAsrSpanConsensusSchema],
  [
    "machine-multi-asr-rover-consensus",
    c61.machineMultiAsrRoverConsensusSchema,
  ],
  ["machine-multi-asr-mbr-consensus", c61.machineMultiAsrMbrConsensusSchema],
  [
    "machine-multi-asr-consensus-path-provenance",
    c61.c61ConsensusProvenanceSchema,
  ],
  ["machine-multi-asr-consensus-safety-audit", c61.c61ConsensusSafetySchema],
  ["c6-1-consensus-profile-freeze", c61.c61ConsensusProfileFreezeSchema],
  ["c6-1-machine-freeze", c61.c61MachineFreezeSchema],
  ["c6-1-profile-selections", c61.c61ProfileSelectionsSchema],
  ["c6-1-baseline", c61.c61BaselineSchema],
  ["c6-1-shadow-manifest", c61.c61ShadowManifestSchema],
  ["c6-1-consensus-ablation", c61.c61AblationSchema],
  ["c6-1-existing-candidate-oracle", c61.c61OracleSchema],
  ["c6-1-legal-path-oracle", c61.c61OracleSchema],
  ["c6-1-consensus-quality-evaluation", c61.c61QualityEvaluationSchema],
  ["c6-1-consensus-error-attribution", c61.c61AttributionSchema],
  ["c6-1-route-decision", c61.c61RouteDecisionSchema],
  ["c6-1-validation", c61.c61ValidationSchema],
  ["c6-1-input-inventory", c61.c61InputInventorySchema],
  ["c6-1-read-only-proof", c61.c61ReadOnlyProofSchema],
  ["c6-1-regression-evidence", c61.c61RegressionEvidenceSchema],
  ["c6-1-shareable-summary", c61.c61ShareableSummarySchema],
] as const;
