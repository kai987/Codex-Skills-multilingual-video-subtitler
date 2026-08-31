import {
  c61211CompletenessSchema,
  c61211RouteSchema,
  type C61211Profile,
  type C61211Labels,
  type C612Ranking,
  c61211GateSchema,
  type c61211BiasSchema,
  type C61211Conservation,
} from "@mvl/shared";
import type { z } from "zod";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import { C612_RERANKERS } from "../top-k/linear-reranker.js";
import {
  c61211Artifact,
  C61211_ROUTE_POLICY,
  fraction,
} from "./c61211-policy.js";
import { unique } from "./component-inventory.js";
import { profileC61211Checks } from "./partition-profile-evaluation.js";
export const compareC61211SafeProfiles = (a: C61211Profile, b: C61211Profile) =>
  (a.harmRate ?? Infinity) - (b.harmRate ?? Infinity) ||
  (b.selectionPrecision ?? -1) - (a.selectionPrecision ?? -1) ||
  a.catastrophicDeletionCount - b.catastrophicDeletionCount ||
  (b.normalizedJointGain ?? -Infinity) - (a.normalizedJointGain ?? -Infinity) ||
  (a.materialDelta ?? Infinity) - (b.materialDelta ?? Infinity) ||
  b.activeFoldCount - a.activeFoldCount ||
  a.profileId.localeCompare(b.profileId);
export function completenessC61211(
  frozen: C612FrozenInputs,
  labels: C61211Labels,
  rankings: readonly C612Ranking[],
  profiles: readonly C61211Profile[],
  coveragePassed: boolean,
) {
  const known = frozen.completeness.rows.filter(
    (r) =>
      !["INSUFFICIENT_EVIDENCE", "UNSCORABLE"].includes(
        r.acousticCompletenessStatus,
      ),
  );
  const blocked = rankings.flatMap((r) =>
    r.ranked
      .filter(
        (c) =>
          !c.current &&
          c.gateReasons.includes("ACOUSTIC_COMPLETENESS_NOT_VERIFIED"),
      )
      .map((c) => ({
        profileId: r.profileId,
        eventId: r.eventId,
        candidateId: c.candidateId,
      })),
  );
  const blockedCandidateIds = unique(blocked.map((c) => c.candidateId));
  const safe = labels.labels.filter(
    (r) =>
      r.label.eligible &&
      !r.label.current &&
      r.label.catastrophicDeletion === false &&
      (r.label.normalizedGain ?? 0) > 0 &&
      r.label.materialDelta !== null &&
      r.label.materialDelta <= 0,
  );
  const safeCandidatesBlocked = safe.filter((r) =>
    blockedCandidateIds.includes(r.candidateId),
  ).length;
  const safeCandidateFalseBlockRate = fraction(
    safeCandidatesBlocked,
    safe.length,
  );
  const nonUnknownCompletenessCoverage = fraction(
    known.length,
    frozen.completeness.rows.length,
  );
  const gated = (id: string) =>
    C612_RERANKERS.find((p) => p.id === id)?.completenessGate === true;
  const nonGatedPositiveUnsafeProfiles = profiles
    .filter(
      (p) =>
        !gated(p.profileId) &&
        (p.normalizedJointGain ?? 0) > 0 &&
        p.materialDelta !== null &&
        p.materialDelta <= 0 &&
        p.catastrophicDeletionCount > 0,
    )
    .map((p) => p.profileId);
  const nonGatedNegativeGainProfiles = profiles
    .filter(
      (p) =>
        !gated(p.profileId) &&
        p.normalizedJointGain !== null &&
        p.normalizedJointGain < 0,
    )
    .map((p) => p.profileId);
  const gatedZeroSelectionProfiles = profiles
    .filter(
      (p) =>
        gated(p.profileId) &&
        p.selectedCount === 0 &&
        blocked.some((b) => b.profileId === p.profileId),
    )
    .map((p) => p.profileId);
  const diagnosticMainBlocker =
    nonGatedPositiveUnsafeProfiles.length > 0 &&
    ((nonUnknownCompletenessCoverage.ratio ?? 0) <
      C61211_ROUTE_POLICY.completenessKnownMinimum ||
      (safeCandidateFalseBlockRate.ratio ?? 0) >=
        C61211_ROUTE_POLICY.manySafeFalseBlockRate);
  return c61211CompletenessSchema.parse(
    c61211Artifact("c6-1-2-1-1-completeness-diagnosis-v2", {
      nonUnknownCompletenessCoverage,
      blockedSelectionOccurrences: blocked.length,
      blockedUniqueCandidates: blockedCandidateIds.length,
      blockedCandidateIds,
      catastrophicCandidatesBlocked: labels.labels.filter(
        (r) =>
          r.label.eligible &&
          r.label.catastrophicDeletion &&
          blockedCandidateIds.includes(r.candidateId),
      ).length,
      safeCandidatesBlocked,
      safeCandidateFalseBlockRate,
      gatedZeroSelectionProfiles,
      nonGatedPositiveUnsafeProfiles,
      nonGatedNegativeGainProfiles,
      diagnosticMainBlocker,
      coverageQualifiedMainBlocker: coveragePassed && diagnosticMainBlocker,
      noThresholdChange: true,
      reasons: [
        "OCCURRENCES_AND_UNIQUE_CANDIDATES_HAVE_SEPARATE_DENOMINATORS",
        "POSITIVE_NON_GATED_GAIN_AND_NONPOSITIVE_MATERIAL_AND_CATASTROPHIC_RISK_REQUIRED",
        ...(!coveragePassed ? ["EVALUATION_COVERAGE_NOT_QUALIFIED"] : []),
        ...(!nonGatedPositiveUnsafeProfiles.length
          ? ["NO_POSITIVE_NON_GATED_DELETION_RISK_PROFILE"]
          : []),
      ],
    }),
  );
}
export function decideC61211Route(input: {
  engineering: boolean;
  aBParity: boolean;
  productionMutation: number;
  conservation: C61211Conservation;
  coverage: z.infer<typeof c61211GateSchema>;
  bias: z.infer<typeof c61211BiasSchema>;
  frozen: readonly C61211Profile[];
  retrained: readonly C61211Profile[];
  completeness: z.infer<typeof c61211CompletenessSchema>;
}) {
  // An untyped caller must not pass the relaxed diagnostic as the primary gate.
  c61211GateSchema.parse(input.coverage);
  const engineeringGate =
    input.engineering &&
    input.aBParity &&
    input.productionMutation === 0 &&
    input.conservation.passed &&
    input.conservation.unsafeCutCount === 0 &&
    input.conservation.crossFoldPartitionCount === 0 &&
    input.bias.passed;
  const profileChecks = input.retrained.map((p) => {
    const checks = [
      ...profileC61211Checks(p),
      {
        name: "productionMutation",
        observed: String(input.productionMutation),
        expected: "0",
        passed: input.productionMutation === 0,
      },
      {
        name: "A-B-parity",
        observed: String(input.aBParity),
        expected: "true",
        passed: input.aBParity,
      },
    ];
    return {
      profileId: p.profileId,
      checks,
      passed: checks.every((c) => c.passed),
    };
  });
  const safe = input.retrained
    .filter(
      (p) => profileChecks.find((c) => c.profileId === p.profileId)?.passed,
    )
    .toSorted(compareC61211SafeProfiles);
  const supported =
    engineeringGate &&
    input.coverage.passed &&
    input.bias.passed &&
    safe.length > 0;
  const route = !engineeringGate
    ? ("C6_1_2_1_1_ENGINEERING_INVALID" as const)
    : !input.coverage.passed
      ? ("EVALUATION_PARTITION_UNRECOVERABLE_WITHOUT_UNSAFE_CUTS" as const)
      : supported
        ? ("GO_C6_1_3_FROZEN_TOP_K_RERANKER_PROSPECTIVE_SHADOW" as const)
        : input.completeness.coverageQualifiedMainBlocker
          ? ("GO_C6_1_2_2_ACOUSTIC_COMPLETENESS_CALIBRATION" as const)
          : ("STOP_EXISTING_CANDIDATE_AUTOMATIC_RERANKING" as const);
  const best = (profiles: readonly C61211Profile[]) =>
    profiles
      .filter((p) => p.selectedCount > 0)
      .toSorted(compareC61211SafeProfiles)[0]?.profileId ?? null;
  return c61211RouteSchema.parse(
    c61211Artifact("c6-1-2-1-1-route-decision", {
      route,
      engineeringGate,
      evaluationCoverageGate: input.coverage.passed,
      partitionBiasGate: input.bias.passed,
      rerankerStrongSupportGate: supported,
      safeProfileCandidates: safe.map((p) => p.profileId),
      selectedSafeProfile: supported ? (safe[0]?.profileId ?? null) : null,
      descriptiveBestFrozenProfile: best(input.frozen),
      descriptiveBestRetrainedProfile: best(input.retrained),
      profileChecks,
      reasons: [
        route,
        "D1_IS_THE_ONLY_ROUTE_EVALUATOR",
        "E4_AND_D2_ARE_DIAGNOSTIC_ONLY",
        "NO_FURTHER_EVALUATOR_LOOSENING_ITERATION",
        ...(!input.coverage.passed
          ? ["EXACT_D1_PARTITION_OPTIMUM_REMAINS_BELOW_REACHABLE_COVERAGE_GATE"]
          : []),
        ...(!safe.length
          ? ["NO_PROFILE_PASSES_ALL_PREFROZEN_SAFETY_REQUIREMENTS"]
          : []),
      ],
      c6122:
        route === "GO_C6_1_2_2_ACOUSTIC_COMPLETENESS_CALIBRATION"
          ? "GO"
          : "HOLD",
      c613: supported ? "GO" : "HOLD",
      productionStatus: "needs-review",
      finalizationMethod: "none",
      productionMutation: 0,
      primaryMode: "D1_CONSERVATIVE_MONOTONIC",
      relaxedDiagnosticUsedForRoute: false,
    }),
  );
}
