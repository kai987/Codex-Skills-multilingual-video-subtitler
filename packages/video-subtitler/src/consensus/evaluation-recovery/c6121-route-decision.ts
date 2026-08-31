import {
  c6121CompletenessSchema,
  c6121RouteSchema,
  type C6121ProfileMetric,
  type C6121Coverage,
  type C6121Integrity,
  type C6121Completeness,
  type C6121Labels,
  type C612Ranking,
} from "@mvl/shared";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import { C6121_POLICY, c6121Artifact, fraction } from "./c6121-policy.js";
import { C612_RERANKERS } from "../top-k/linear-reranker.js";

export function c6121SafeProfile(profile: C6121ProfileMetric) {
  const gate = C6121_POLICY.safeProfile;
  return (
    profile.catastrophicDeletionCount === 0 &&
    profile.selectionPrecision !== null &&
    profile.selectionPrecision >= gate.minimumPrecision &&
    profile.harmRate !== null &&
    profile.harmRate <= gate.maximumHarmRate &&
    profile.normalizedJointGain !== null &&
    profile.normalizedJointGain > 0 &&
    profile.materialDelta !== null &&
    profile.materialDelta <= 0 &&
    profile.activeFoldCount >= gate.minimumActiveFolds &&
    profile.negativeGainFoldCount === 0 &&
    profile.evaluableChangedSupergroups >= gate.minimumEvaluableChanges &&
    profile.changedSupergroupCoverage.ratio !== null &&
    profile.changedSupergroupCoverage.ratio >= gate.minimumChangedCoverage &&
    profile.changedMachineGroupCoverage.ratio !== null &&
    profile.changedMachineGroupCoverage.ratio >= gate.minimumChangedCoverage
  );
}
export const c6121SafeProfileSort = (
  a: C6121ProfileMetric,
  b: C6121ProfileMetric,
) =>
  (a.harmRate ?? Infinity) - (b.harmRate ?? Infinity) ||
  (b.selectionPrecision ?? -1) - (a.selectionPrecision ?? -1) ||
  a.catastrophicDeletionCount - b.catastrophicDeletionCount ||
  (b.normalizedJointGain ?? -Infinity) - (a.normalizedJointGain ?? -Infinity) ||
  (a.materialDelta ?? Infinity) - (b.materialDelta ?? Infinity) ||
  b.activeFoldCount - a.activeFoldCount ||
  a.profileId.localeCompare(b.profileId);

export function diagnoseC6121Completeness(
  frozen: C612FrozenInputs,
  labels: C6121Labels,
  rankings: readonly C612Ranking[],
  profiles: readonly C6121ProfileMetric[],
  coverageGate: boolean,
): C6121Completeness {
  const unknown = new Set(["INSUFFICIENT_EVIDENCE", "UNSCORABLE"]);
  const nonUnknownCompletenessCoverage = fraction(
    frozen.completeness.rows.filter(
      (r) => !unknown.has(r.acousticCompletenessStatus),
    ).length,
    frozen.completeness.rows.length,
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
  const blockedIds = new Set(blocked.map((r) => r.candidateId));
  const safe = labels.labels.filter(
    (r) =>
      r.label.eligible &&
      !r.label.current &&
      !r.label.catastrophicDeletion &&
      r.label.normalizedGain !== null &&
      r.label.normalizedGain > 0 &&
      r.label.materialDelta !== null &&
      r.label.materialDelta <= 0,
  );
  const safeCandidatesBlocked = safe.filter((r) =>
    blockedIds.has(r.candidateId),
  ).length;
  const zero = profiles
    .filter(
      (p) =>
        C612_RERANKERS.find((r) => r.id === p.profileId)?.completenessGate &&
        p.changedSupergroups === 0 &&
        rankings.some(
          (r) =>
            r.profileId === p.profileId &&
            r.proposedCandidateId !== r.currentCandidateId &&
            r.ranked
              .find((c) => c.candidateId === r.proposedCandidateId)
              ?.gateReasons.includes("ACOUSTIC_COMPLETENESS_NOT_VERIFIED"),
        ),
    )
    .map((p) => p.profileId);
  const nonGatedProfilePositiveButUnsafeCount = profiles.filter(
    (p) =>
      !C612_RERANKERS.find((r) => r.id === p.profileId)?.completenessGate &&
      p.normalizedJointGain !== null &&
      p.normalizedJointGain > 0 &&
      !c6121SafeProfile(p),
  ).length;
  const diagnosticMainBlocker =
    ((nonUnknownCompletenessCoverage.ratio !== null &&
      nonUnknownCompletenessCoverage.ratio <
        C6121_POLICY.completenessDiagnosis.insufficientNonUnknownCoverage) ||
      zero.length > 0) &&
    nonGatedProfilePositiveButUnsafeCount > 0;
  return c6121CompletenessSchema.parse(
    c6121Artifact("c6-1-2-1-completeness-blocker-diagnosis", {
      nonUnknownCompletenessCoverage,
      candidateSelectionsBlockedByCompleteness: blocked.length,
      retrainedProfileZeroSelectionDueToCompleteness: zero,
      nonGatedProfilePositiveButUnsafeCount,
      catastrophicCandidatesBlocked: labels.labels.filter(
        (r) => r.label.catastrophicDeletion && blockedIds.has(r.candidateId),
      ).length,
      safeCandidatesBlocked,
      safeCandidateFalseBlockRate: fraction(safeCandidatesBlocked, safe.length),
      diagnosticMainBlocker,
      coverageQualifiedMainBlocker: coverageGate && diagnosticMainBlocker,
      noThresholdChange: true,
      reasons: [
        "BLOCKED_CANDIDATE_COUNT_IS_PROFILE_EVENT_CANDIDATE_OCCURRENCES",
        "SAFE_FALSE_BLOCK_RATE_USES_UNIQUE_EVALUABLE_CANDIDATES",
        ...(coverageGate
          ? []
          : ["COVERAGE_GATE_NOT_MET_DIAGNOSIS_CANNOT_AUTHORIZE_ROUTE"]),
      ],
    }),
  );
}

export function decideC6121Route(input: {
  engineering: boolean;
  aBParity: boolean;
  productionMutation: number;
  coverage: C6121Coverage;
  integrity: C6121Integrity;
  frozen: readonly C6121ProfileMetric[];
  retrained: readonly C6121ProfileMetric[];
  completeness: C6121Completeness;
}) {
  const checks: {
    name: string;
    passed: boolean;
    observed: string;
    expected: string;
  }[] = [];
  for (const key of [
    "evaluableMachineGroupCoverage",
    "evaluableProductionCueCoverage",
    "evaluableGoldCueCoverage",
    "candidateEventLabelCoverage",
  ] as const) {
    const value = input.coverage[key];
    checks.push({
      name: key,
      passed: value.ratio !== null && value.ratio >= 0.8,
      observed: JSON.stringify(value),
      expected: ">=0.80 with nonzero denominator",
    });
  }
  // The primary profile was L6 in C6.1.2 and is fixed before reading Gold text.
  // Zero selection cannot be used to claim covered changed-group evidence.
  const primary = input.retrained.find(
    (p) => p.profileId === C6121_POLICY.primaryProfile,
  );
  for (const key of [
    "changedSupergroupCoverage",
    "changedMachineGroupCoverage",
  ] as const) {
    const value = primary?.[key];
    checks.push({
      name: "primary-L6-" + key,
      passed:
        value?.ratio !== null &&
        value?.ratio !== undefined &&
        value.ratio >= 0.8,
      observed: JSON.stringify(value ?? null),
      expected: ">=0.80; zero selection utility coverage=0",
    });
  }
  for (const key of [
    "crossFoldComponentCount",
    "goldTextUsedForGroupingCount",
    "profileRematchingCount",
  ] as const)
    checks.push({
      name: key,
      passed: input.integrity[key] === 0,
      observed: String(input.integrity[key]),
      expected: "0",
    });
  const evaluationCoverageGate = checks.every((c) => c.passed);
  const safe = input.retrained
      .filter(c6121SafeProfile)
      .sort(c6121SafeProfileSort),
    selected = safe[0];
  const strong = [
    {
      name: "predeclared-safe-profile",
      passed: !!selected,
      observed: selected?.profileId ?? "null",
      expected: "non-null fixed safety rule winner",
    },
    {
      name: "unknown-gain-folds",
      passed: selected?.unknownGainFoldCount === 0,
      observed: String(selected?.unknownGainFoldCount ?? null),
      expected: "0",
    },
    {
      name: "production-mutation",
      passed: input.productionMutation === 0,
      observed: String(input.productionMutation),
      expected: "0",
    },
    {
      name: "independent-a-b-parity",
      passed: input.aBParity,
      observed: String(input.aBParity),
      expected: "true",
    },
  ];
  const engineeringGate =
    input.engineering && input.aBParity && input.productionMutation === 0;
  const rerankerStrongSupportGate = strong.every((c) => c.passed);
  const route = !engineeringGate
    ? "C6_1_2_1_ENGINEERING_INVALID"
    : !evaluationCoverageGate
      ? "EVALUATION_COVERAGE_STILL_INSUFFICIENT"
      : rerankerStrongSupportGate
        ? "GO_C6_1_3_FROZEN_TOP_K_RERANKER_PROSPECTIVE_SHADOW"
        : input.completeness.diagnosticMainBlocker
          ? "GO_C6_1_2_2_ACOUSTIC_COMPLETENESS_CALIBRATION"
          : "STOP_EXISTING_CANDIDATE_AUTOMATIC_RERANKING";
  const descriptive = (profiles: readonly C6121ProfileMetric[]) =>
    profiles
      .filter(
        (p) =>
          p.normalizedJointGain !== null && p.evaluableChangedSupergroups > 0,
      )
      .toSorted(
        (a, b) =>
          (b.normalizedJointGain ?? -Infinity) -
            (a.normalizedJointGain ?? -Infinity) ||
          a.profileId.localeCompare(b.profileId),
      )[0]?.profileId ?? null;
  return c6121RouteSchema.parse(
    c6121Artifact("c6-1-2-1-route-decision", {
      route,
      engineeringGate,
      evaluationCoverageGate,
      rerankerStrongSupportGate,
      coverageChecks: checks,
      strongSupportChecks: strong,
      selectedSafeProfile: selected?.profileId ?? null,
      safeProfileCandidates: safe.map((p) => p.profileId),
      descriptiveBestFrozenProfile: descriptive(input.frozen),
      descriptiveBestRetrainedProfile: descriptive(input.retrained),
      c6122:
        route === "GO_C6_1_2_2_ACOUSTIC_COMPLETENESS_CALIBRATION"
          ? "GO"
          : "HOLD",
      c613:
        route === "GO_C6_1_3_FROZEN_TOP_K_RERANKER_PROSPECTIVE_SHADOW"
          ? "GO"
          : "HOLD",
      productionStatus: "needs-review",
      finalizationMethod: "none",
      productionMutation: 0,
      prospectiveShadowOnly: true,
    }),
  );
}
