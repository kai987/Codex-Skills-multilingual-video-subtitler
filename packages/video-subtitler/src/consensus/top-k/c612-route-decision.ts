import {
  c612RouteSchema,
  type c612CvSchema,
  type c612RetrievalMetricsSchema,
  type c612LegacyMaterialSchema,
} from "@mvl/shared";
import type { z } from "zod";
import type { C612FrozenInputs } from "./c612-frozen-inputs.js";
import { artifact, C612_POLICY, c612Defined } from "./c612-policy.js";
export function decideC612Route(input: {
  frozen: C612FrozenInputs;
  cv: z.infer<typeof c612CvSchema>;
  retrieval: z.infer<typeof c612RetrievalMetricsSchema>;
  material: z.infer<typeof c612LegacyMaterialSchema>;
  engineeringChecks: {
    name: string;
    passed: boolean;
    observed: string;
    expected: string;
  }[];
}) {
  const f = input.frozen,
    primary = input.cv.profiles.find((p) => p.profileId === "L6");
  if (!primary) throw new Error("C612_PRIMARY_PROFILE_MISSING");
  const retrieval = c612Defined(
    input.retrieval.profiles.find(
      (p) => p.profile === C612_POLICY.retrieval.primary,
    ),
  );
  const completenessCoverage =
    f.completeness.rows.filter(
      (r) =>
        !["INSUFFICIENT_EVIDENCE", "UNSCORABLE"].includes(
          r.acousticCompletenessStatus,
        ),
    ).length / Math.max(1, f.completeness.rows.length);
  const fullMaterial = c612Defined(
    input.material.profiles.find((p) => p.profileId === "L6"),
  );
  const items: [string, number | null, string, boolean][] = [
    [
      "correlationCoverage",
      f.correlation.coverage,
      ">=0.90",
      (f.correlation.coverage ?? 0) >= 0.9,
    ],
    [
      "completenessCoverage",
      completenessCoverage,
      ">=0.90",
      completenessCoverage >= 0.9,
    ],
    [
      "changedGroupEvaluationCoverage",
      primary.changedGroupEvaluationCoverage,
      ">=0.80 with actual selections",
      (primary.changedGroupEvaluationCoverage ?? 0) >= 0.8,
    ],
    [
      "oracleRecall4",
      retrieval.recall4,
      ">=0.90",
      (retrieval.recall4 ?? 0) >= 0.9,
    ],
    [
      "normalizedJointGain",
      primary.normalizedJointGain,
      ">0",
      (primary.normalizedJointGain ?? 0) > 0,
    ],
    [
      "materialErrors",
      fullMaterial.materialErrors,
      "<=77",
      fullMaterial.materialErrors <= 77 && fullMaterial.materialDelta <= 0,
    ],
    [
      "fixedGroupMaterialDelta",
      primary.materialDelta,
      "<=0",
      primary.materialDelta !== null && primary.materialDelta <= 0,
    ],
    [
      "catastrophicDeletions",
      primary.catastrophicDeletions,
      "0",
      primary.catastrophicDeletions === 0,
    ],
    [
      "precision",
      primary.precision,
      ">=0.85",
      (primary.precision ?? 0) >= 0.85,
    ],
    [
      "harm",
      primary.harm,
      "<=0.10 with evaluated selections",
      primary.harm !== null && primary.harm <= 0.1,
    ],
    [
      "evaluatedChangedGroups",
      primary.evaluatedChangedGroups,
      ">=5",
      primary.evaluatedChangedGroups >= 5,
    ],
    ["activeFolds", primary.activeFolds, ">=3", primary.activeFolds >= 3],
    [
      "negativeGainFolds",
      primary.negativeGainFolds,
      "0",
      primary.negativeGainFolds === 0,
    ],
    [
      "unknownGainFolds",
      primary.unknownGainFolds,
      "0",
      primary.unknownGainFolds === 0,
    ],
    [
      "top1FullPoolOracleCapture",
      primary.top1FullPoolOracleCapture,
      ">0.4627 historical ceiling; mapping denominator disclosed separately",
      (primary.top1FullPoolOracleCapture ?? 0) > 0.4627,
    ],
    [
      "top1OracleCaptureOverReplayedH2",
      primary.top1FullPoolOracleCapture,
      ">replayed L0 capture on identical V2 labels",
      primary.top1FullPoolOracleCapture !== null &&
        primary.top1FullPoolOracleCapture >
          (input.cv.profiles.find((p) => p.profileId === "L0")
            ?.top1FullPoolOracleCapture ?? 1),
    ],
  ];
  const checks = [
    ...input.engineeringChecks,
    ...items.map(([name, value, expected, passed]) => ({
      name,
      observed: value === null ? "unknown" : String(value),
      expected,
      passed,
    })),
  ];
  const engineeringPassed =
      input.engineeringChecks.length > 0 &&
      input.engineeringChecks.every((c) => c.passed),
    strongSupportPassed = engineeringPassed && checks.every((c) => c.passed);
  const evaluationCoverage =
    primary.evaluatedRankings / Math.max(1, primary.eligibleEvents);
  const route = !engineeringPassed
    ? "C6_1_2_ENGINEERING_INVALID"
    : strongSupportPassed
      ? "GO_C6_1_3_FROZEN_TOP_K_RERANKER_PROSPECTIVE_SHADOW"
      : evaluationCoverage < 0.8 || retrieval.evaluableEvents < 5
        ? "EVALUATION_COVERAGE_INSUFFICIENT"
        : (retrieval.recall4 ?? 0) >= 0.9
          ? "TOP_K_RETRIEVAL_CONFIRMED_RERANKING_NOT_SUPPORTED"
          : "EXISTING_CANDIDATE_POOL_INSUFFICIENT";
  return c612RouteSchema.parse(
    artifact("c6-1-2-route-decision", {
      evaluationOnly: true,
      privacy: "LOCAL_ONLY",
      machineFreezeHash: f.freeze.semanticHash,
      engineeringPassed,
      strongSupportPassed,
      checks,
      route,
      c613: strongSupportPassed ? "GO" : "HOLD",
      selectedProfile: "L6",
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      reasons: checks.filter((c) => !c.passed).map((c) => c.name),
    }),
  );
}
