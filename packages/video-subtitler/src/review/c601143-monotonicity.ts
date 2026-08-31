import {
  monotonicity143Schema,
  continuity143Schema,
  bundle143Schema,
  type Policy143,
  type Obligations143,
  type Bundle143,
  type Hierarchy143,
  type Continuity143,
  type Monotonicity143,
} from "@mvl/shared";
import {
  hashed141,
  hash141,
  union141,
  assertHash141,
  required141,
} from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import {
  header143,
  assertSource143,
  assertNative143,
  intersection143,
  difference143,
  sampleCount143,
} from "./c601143-policy.js";

export function validateCrossStageCoverageMonotonicity(input: {
  obligations: Obligations143;
  selected: Bundle143[];
  policy: Policy143;
  hierarchy?: Hierarchy143;
}): { monotonicity: Monotonicity143; entries: Continuity143["entries"] } {
  const { obligations, selected, policy, hierarchy } = input;
  assertHash141(obligations);
  if (hierarchy) {
    assertHash141(hierarchy);
    if (hierarchy.obligationsHash !== obligations.semanticHash)
      throw new Error("C601143_HIERARCHY_OBLIGATION_BINDING_MISMATCH");
  }
  const source = obligations.sourceIdentity;
  for (const target of selected) {
    bundle143Schema.parse(target);
    assertHash141(target);
    assertSource143(target.sourceIdentity, source);
    assertNative143(target.atomicNativeIntervals, source);
    if (
      !target.eligible ||
      !target.verifiedTimebase ||
      target.strongContradiction ||
      hash141(union141(target.atomicNativeIntervals)) !==
        hash141(target.nativeIntervalUnion)
    )
      throw new Error("C601143_INVALID_BUNDLE_CORE_OR_TIMEBASE");
    if (hierarchy) {
      const children = target.childUnitIds.map((id) =>
        required141(
          hierarchy.children.find((c) => c.childUnitId === id),
          "C601143_BUNDLE_CHILD_UNBOUND",
        ),
      );
      if (
        hash141(union141(children.flatMap((c) => c.nativeIntervalUnion))) !==
          hash141(target.nativeIntervalUnion) ||
        children.some((c) => !c.eligible)
      )
        throw new Error("C601143_ENVELOPE_OR_UNSUPPORTED_CORE_AS_SPEECH");
    }
  }
  const all = union141(selected.flatMap((t) => t.nativeIntervalUnion));
  const entries: Continuity143["entries"] = obligations.obligations.map((o) => {
    const related = selected.filter(
      (t) =>
        intersection143(t.nativeIntervalUnion, o.nativeIntervalUnion).length,
    );
    const finalCoveredIntervals = intersection143(o.nativeIntervalUnion, all);
    const uncoveredIntervals = difference143(o.nativeIntervalUnion, all);
    const requiredNativeSamples = sampleCount143(o.nativeIntervalUnion),
      coveredNativeSamples = sampleCount143(finalCoveredIntervals);
    const regression = uncoveredIntervals.length > 0;
    const exact = related.some(
      (t) =>
        o.originTargetIds.includes(t.bundleId) &&
        hash141(t.nativeIntervalUnion) === hash141(o.nativeIntervalUnion),
    );
    const superset =
      difference143(
        related.flatMap((t) => t.nativeIntervalUnion),
        o.nativeIntervalUnion,
      ).length > 0;
    const preservationMethod = regression
      ? "REGRESSED_NOT_COVERED"
      : exact
        ? "EXACT_TARGET_RETAINED"
        : related.some((t) => t.childUnitIds.length > 1)
          ? "EQUIVALENT_TARGET_BUNDLE"
          : superset
            ? "SUPERSET_CORE_COVERAGE"
            : "EQUIVALENT_CHILD_TARGET";
    return {
      obligationId: o.obligationId,
      originalTargetIds: o.originTargetIds,
      originalNativeIntervals: o.nativeIntervalUnion,
      finalChildIds: unique142(related.flatMap((t) => t.childUnitIds)),
      finalTargetBundleIds: related.map((t) => t.bundleId),
      finalCoveredIntervals,
      uncoveredIntervals,
      requiredNativeSamples,
      coveredNativeSamples,
      coverageRatio: requiredNativeSamples
        ? coveredNativeSamples / requiredNativeSamples
        : 1,
      preservationMethod,
      reason: regression
        ? "ACTUAL_NATIVE_CORE_SAMPLES_DROPPED"
        : "COMPLETE_NATIVE_CORE_COVERAGE",
      regression,
    };
  });
  const uncovered = difference143(obligations.nativeIntervalUnion, all);
  const total = sampleCount143(obligations.nativeIntervalUnion),
    missing = sampleCount143(uncovered);
  const count = (
    method: Continuity143["entries"][number]["preservationMethod"],
  ) => entries.filter((e) => e.preservationMethod === method).length;
  const monotonicity = monotonicity143Schema.parse(
    hashed141({
      ...header143(policy, source),
      artifactType: "machine-cross-stage-coverage-monotonicity",
      obligationsHash: obligations.semanticHash,
      finalSelectionHash: hash141(selected),
      obligationCount: entries.length,
      obligationNativeSamples: total,
      finalCoveredNativeSamples: total - missing,
      uncoveredNativeSamples: missing,
      obligationCoverageRatio: total ? (total - missing) / total : 1,
      exactTargetRetainedCount: count("EXACT_TARGET_RETAINED"),
      equivalentChildTargetCount: count("EQUIVALENT_CHILD_TARGET"),
      equivalentBundleReplacementCount: count("EQUIVALENT_TARGET_BUNDLE"),
      supersetCoreCoverageCount: count("SUPERSET_CORE_COVERAGE"),
      droppedObligationCount: entries.filter((e) => e.regression).length,
      regressedObligationIds: entries
        .filter((e) => e.regression)
        .map((e) => e.obligationId),
      uncoveredNativeIntervals: uncovered,
      roundingCorrectionsApplied: 0,
      monotonicityPassed: missing === 0 && entries.every((e) => !e.regression),
    }),
  );
  return { monotonicity, entries };
}
export function assertMonotonicity143(result: Monotonicity143) {
  assertHash141(result);
  if (
    !result.monotonicityPassed ||
    result.droppedObligationCount ||
    result.uncoveredNativeSamples ||
    result.obligationCoverageRatio !== 1
  )
    throw new Error("CROSS_STAGE_MONOTONICITY_VIOLATION");
}
export function buildContinuity143(input: {
  obligations: Obligations143;
  selected: Bundle143[];
  hierarchy: Hierarchy143;
  policy: Policy143;
}) {
  const { monotonicity, entries } =
    validateCrossStageCoverageMonotonicity(input);
  const selectedCore = input.selected.flatMap((t) => t.nativeIntervalUnion);
  const ledger = continuity143Schema.parse(
    hashed141({
      ...header143(input.policy, input.obligations.sourceIdentity),
      artifactType: "machine-cross-stage-selection-continuity-ledger",
      obligationsHash: input.obligations.semanticHash,
      finalSelectionHash: hash141(input.selected),
      entries,
      candidateDecisions: input.hierarchy.children.map((c) => {
        const bundles = input.selected.filter((t) =>
          t.childUnitIds.includes(c.childUnitId),
        );
        const added = sampleCount143(
          difference143(
            c.nativeIntervalUnion,
            input.obligations.nativeIntervalUnion,
          ),
        );
        return {
          childUnitId: c.childUnitId,
          newDetectorEvidence: added > 0,
          selected: bundles.length > 0,
          finalBundleIds: bundles.map((t) => t.bundleId),
          reason: bundles.length
            ? "FINAL_PLANNER_SELECTED"
            : !c.eligible
              ? c.eligibilityReasons.join(";")
              : !difference143(c.nativeIntervalUnion, selectedCore).length
                ? "REDUNDANT_CORE_COVERAGE"
                : "NOT_SELECTED_FROZEN_LEXICOGRAPHIC_BUDGET",
          coreSeconds: c.coreUnionSeconds,
          addedNativeSamples: added,
        };
      }),
      monotonicityHash: monotonicity.semanticHash,
    }),
  );
  return { monotonicity, ledger };
}
