import {
  c611ErrorAttributionSchema,
  type C611ErrorAttribution,
} from "../../../shared/src/c6-1-1-diagnostic-schemas.js";
import {
  c611DecisionSchema,
  type C611Decision,
} from "../../../shared/src/c6-1-1-calibration-schemas.js";
import {
  machineSelectiveExistingCandidateProposalsSchema,
  machineSelectiveMbrFeaturesSchema,
  machineExistingCandidateCompletenessRiskSchema,
  type C611Proposals,
  type C611Features,
  type C611Completeness,
} from "../../../shared/src/c6-1-1-machine-schemas.js";
import {
  c611ProposalLabelsSchema,
  c611SelectiveProfileQualitySchema,
  type C611ProposalLabels,
  type C611SelectiveProfileQuality,
} from "../../../shared/src/c6-1-1-evaluation-schemas.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { C611_COMPLETENESS_POLICY } from "./candidate-completeness-risk.js";
import { c611WithHash } from "./hierarchical-correlation-groups.js";

type Case = C611ErrorAttribution["cases"][number];
function summarize(rows: readonly Case[]) {
  const selected = rows.filter((r) => r.requestedSwitch);
  const applied = selected.filter((r) => r.applicationStatus === "APPLIED");
  const unknown = selected.filter(
    (r) => r.applicationStatus === "UNKNOWN",
  ).length;
  const total = (
    items: readonly Case[],
    outcome: Case["counterfactualOutcome"],
  ) => items.filter((r) => r.counterfactualOutcome === outcome).length;
  return {
    caseCount: rows.length,
    requestedSwitchCount: selected.length,
    requestedCorrectCount: total(selected, "SWITCH_IMPROVES"),
    requestedWrongCount: total(selected, "SWITCH_REGRESSES"),
    requestedNeutralCount: total(selected, "SWITCH_NEUTRAL"),
    requestedUnknownCount: total(selected, "SWITCH_UNEVALUABLE"),
    actualAppliedCount: unknown ? null : applied.length,
    actualAppliedCorrectCount: unknown
      ? null
      : total(applied, "SWITCH_IMPROVES"),
    actualAppliedWrongCount: unknown
      ? null
      : total(applied, "SWITCH_REGRESSES"),
    actualAppliedNeutralCount: unknown
      ? null
      : total(applied, "SWITCH_NEUTRAL"),
    actualAppliedUnknownCount: unknown
      ? null
      : total(applied, "SWITCH_UNEVALUABLE"),
    rendererBlockedCount: selected.filter(
      (r) => r.applicationStatus === "BLOCKED",
    ).length,
    applicationUnknownCount: unknown,
    notSelectedImprovingProposalCount: rows.filter(
      (r) =>
        !r.requestedSwitch && r.counterfactualOutcome === "SWITCH_IMPROVES",
    ).length,
  };
}

/** Post-freeze evaluation-only descriptive case attribution. No raw Gold input,
 * aggregate counterfactual edit summation, or feedback into proposal selection. */
export function buildC611ErrorAttribution(input: {
  proposals: C611Proposals;
  features: C611Features;
  completeness: C611Completeness;
  labels: C611ProposalLabels;
  decisions: readonly C611Decision[];
  profileQuality?: readonly C611SelectiveProfileQuality[];
  appliedEventIdsByProfile?: Readonly<Record<string, readonly string[]>>;
}): C611ErrorAttribution {
  const proposals = machineSelectiveExistingCandidateProposalsSchema.parse(
    input.proposals,
  );
  const features = machineSelectiveMbrFeaturesSchema.parse(input.features);
  const completeness = machineExistingCandidateCompletenessRiskSchema.parse(
    input.completeness,
  );
  const labels = c611ProposalLabelsSchema.parse(input.labels);
  const decisions = input.decisions
    .map((d) => c611DecisionSchema.parse(d))
    .toSorted(
      (a, b) =>
        a.profileId.localeCompare(b.profileId) ||
        a.eventId.localeCompare(b.eventId),
    );
  if (
    features.proposalHash !== proposals.semanticHash ||
    completeness.proposalHash !== proposals.semanticHash ||
    labels.proposalSetHash !== proposals.semanticHash
  )
    throw new Error("C611_ATTRIBUTION_ARTIFACT_IDENTITY_MISMATCH");
  if (
    new Set(decisions.map((d) => `${d.profileId}:${d.eventId}`)).size !==
    decisions.length
  )
    throw new Error("C611_ATTRIBUTION_DUPLICATE_DECISION");
  const cases: Case[] = decisions.map((decision) => {
    const proposal = proposals.records.find(
      (p) =>
        p.proposalId === decision.proposalId && p.eventId === decision.eventId,
    );
    const feature = features.rows.find(
      (f) =>
        f.proposalId === decision.proposalId && f.eventId === decision.eventId,
    );
    const complete = completeness.rows.find(
      (r) =>
        r.proposalId === decision.proposalId && r.eventId === decision.eventId,
    );
    const label = labels.labels.find(
      (l) =>
        l.proposalId === decision.proposalId && l.eventId === decision.eventId,
    );
    if (!proposal || !feature || !complete || !label)
      throw new Error("C611_ATTRIBUTION_MISSING_JOIN");
    const requestedSwitch = decision.decision === "SELECT_EXISTING_CANDIDATE";
    const candidateId = decision.proposedCandidateId;
    const labelCandidateMatched =
      candidateId === label.candidateId &&
      candidateId === proposal.proposedCandidateId;
    const counterfactualOutcome = labelCandidateMatched
      ? label.outcome
      : "SWITCH_UNEVALUABLE";
    const verifiedCandidateMetadata =
      candidateId === proposal.proposedCandidateId;
    const lengthRatio = verifiedCandidateMetadata
      ? feature.values.characterLengthRatio
      : null;
    const ctc = verifiedCandidateMetadata ? feature.values.ctcDirection : null;
    const riskClasses = verifiedCandidateMetadata ? complete.riskClasses : [];
    const applied = input.appliedEventIdsByProfile?.[decision.profileId];
    const applicationStatus = !requestedSwitch
      ? "NOT_SELECTED"
      : applied === undefined
        ? "UNKNOWN"
        : applied.includes(decision.eventId)
          ? "APPLIED"
          : "BLOCKED";
    const diagnosticErrorTypes: string[] = [];
    if (requestedSwitch && counterfactualOutcome === "SWITCH_REGRESSES") {
      if (lengthRatio !== null && lengthRatio < 1)
        diagnosticErrorTypes.push("WRONG_SWITCH_WITH_CONTRACTION");
      if (riskClasses.includes("UNSUPPORTED_DELETION_RISK"))
        diagnosticErrorTypes.push(
          "WRONG_SWITCH_WITH_UNSUPPORTED_DELETION_RISK",
        );
      if (riskClasses.includes("EDGE_TRUNCATION_RISK"))
        diagnosticErrorTypes.push("WRONG_SWITCH_WITH_EDGE_TRUNCATION_RISK");
      if (ctc === null)
        diagnosticErrorTypes.push("WRONG_SWITCH_WITH_UNKNOWN_CTC");
      else if (ctc < 0) diagnosticErrorTypes.push("WRONG_SWITCH_WITH_CTC_VETO");
      else if (ctc > 0)
        diagnosticErrorTypes.push("WRONG_SWITCH_DESPITE_CTC_SUPPORT");
      diagnosticErrorTypes.push("EXISTING_CANDIDATE_COUNTERFACTUAL_REGRESSION");
    }
    if (requestedSwitch && counterfactualOutcome === "SWITCH_UNEVALUABLE")
      diagnosticErrorTypes.push("UNKNOWN_SWITCH_QUALITY");
    if (applicationStatus === "BLOCKED")
      diagnosticErrorTypes.push("REQUESTED_SWITCH_BLOCKED_BY_RENDERER");
    return c611WithHash({
      profileId: decision.profileId,
      eventId: decision.eventId,
      proposalId: decision.proposalId,
      candidateId,
      labelCandidateMatched,
      requestedSwitch,
      applicationStatus,
      counterfactualOutcome,
      provider: verifiedCandidateMetadata
        ? (proposal.proposedProvider ?? "UNKNOWN")
        : "UNKNOWN",
      lengthBucket:
        lengthRatio === null
          ? "UNKNOWN"
          : lengthRatio < C611_COMPLETENESS_POLICY.strongContractionBelow
            ? "STRONG_CONTRACTION"
            : lengthRatio < 1
              ? "MILD_CONTRACTION"
              : lengthRatio === 1
                ? "SAME_LENGTH"
                : "EXPANSION",
      ctcEvidence:
        ctc === null
          ? "UNKNOWN"
          : ctc > 0
            ? "SUPPORT"
            : ctc < 0
              ? "VETO"
              : "TIED",
      riskClasses,
      diagnosticErrorTypes,
    });
  });
  const profileIds = [...new Set(cases.map((c) => c.profileId))].sort();
  const strata: C611ErrorAttribution["strata"] = [];
  for (const profileId of profileIds) {
    const rows = cases.filter((c) => c.profileId === profileId);
    for (const dimension of ["PROVIDER", "LENGTH", "CTC", "RISK"] as const) {
      const get = (row: Case): string[] =>
        dimension === "PROVIDER"
          ? [row.provider]
          : dimension === "LENGTH"
            ? [row.lengthBucket]
            : dimension === "CTC"
              ? [row.ctcEvidence]
              : row.riskClasses.length
                ? row.riskClasses
                : ["NONE_OR_UNKNOWN"];
      for (const value of [...new Set(rows.flatMap(get))].sort())
        strata.push({
          profileId,
          dimension,
          value,
          counts: summarize(rows.filter((row) => get(row).includes(value))),
        });
    }
  }
  const s5 = cases.filter((c) => c.profileId === "S5");
  const s6 = cases.filter((c) => c.profileId === "S6");
  const pairs = s6.flatMap((after) => {
    const before = s5.find(
      (c) => c.proposalId === after.proposalId && c.eventId === after.eventId,
    );
    return before ? [{ before, after }] : [];
  });
  const changed = pairs.filter(
    ({ before, after }) =>
      before.requestedSwitch !== after.requestedSwitch ||
      (before.requestedSwitch &&
        after.requestedSwitch &&
        before.candidateId !== after.candidateId),
  );
  const quality = (input.profileQuality ?? []).map((q) =>
    c611SelectiveProfileQualitySchema.parse(q),
  );
  if (new Set(quality.map((q) => q.profileId)).size !== quality.length)
    throw new Error("C611_ATTRIBUTION_DUPLICATE_QUALITY");
  return c611ErrorAttributionSchema.parse(
    c611WithHash({
      schemaVersion: "1.0.0",
      policyVersion: proposals.policyVersion,
      artifactType: "c6-1-1-selective-mbr-error-attribution",
      evaluationOnly: true,
      privacy: "LOCAL_ONLY",
      metricUnit: "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL_CASE",
      causalInterpretation: "DESCRIPTIVE_ASSOCIATION_NOT_UNIQUE_CAUSATION",
      correlatedGainsSummed: false,
      proposalHash: proposals.semanticHash,
      featureHash: features.semanticHash,
      completenessHash: completeness.semanticHash,
      labelHash: labels.semanticHash,
      decisionHash: hash(decisions),
      applicationEvidenceHash: input.appliedEventIdsByProfile
        ? hash(input.appliedEventIdsByProfile)
        : null,
      profileQualityHashes: Object.fromEntries(
        quality.map((q) => [q.profileId, q.semanticHash]),
      ),
      cases,
      profiles: profileIds.map((profileId) => ({
        profileId,
        counts: summarize(cases.filter((r) => r.profileId === profileId)),
      })),
      strata,
      ctcUtility: {
        comparison: "S6_VS_S5_PAIRED_PROFILE_ABLATION",
        available:
          s5.length > 0 &&
          s6.length > 0 &&
          pairs.length === s5.length &&
          pairs.length === s6.length,
        pairedCaseCount: pairs.length,
        selectionChangedCount: changed.length,
        ctcKnownSelectionChangedCount: changed.filter(
          (p) => p.after.ctcEvidence !== "UNKNOWN",
        ).length,
        ctcUnknownSelectionChangedCount: changed.filter(
          (p) => p.after.ctcEvidence === "UNKNOWN",
        ).length,
        switchedOn: summarize(
          pairs
            .filter(
              ({ before, after }) =>
                !before.requestedSwitch && after.requestedSwitch,
            )
            .map((p) => p.after),
        ),
        switchedOff: summarize(
          pairs
            .filter(
              ({ before, after }) =>
                before.requestedSwitch && !after.requestedSwitch,
            )
            .map((p) => p.before),
        ),
        changedSelectedCandidateCount: changed.filter(
          (p) =>
            p.before.requestedSwitch &&
            p.after.requestedSwitch &&
            p.before.candidateId !== p.after.candidateId,
        ).length,
        uniquelyCausedByCtcClaim: false,
      },
      limitations: [
        "CASE_OUTCOMES_ARE_FROZEN_SINGLE_PROPOSAL_COUNTERFACTUALS_NOT_ADDITIVE_GROUP_GAINS",
        "ACTUAL_APPLIED_COUNTS_REQUIRE_EXPLICIT_RENDERER_EVENT_RECEIPTS",
        "RISK_STRATA_OVERLAP_AND_MUST_NOT_BE_SUMMED",
        "CTC_ABLATION_CAN_CHANGE_TRAINING_AND_THRESHOLDS_NOT_UNIQUE_CTC_CAUSATION",
        "UNMATCHED_CANDIDATE_LABEL_IS_UNKNOWN_NOT_NEUTRAL",
        "KNOWN_BENCHMARK_ONLY_NO_UNSEEN_GENERALIZATION_CLAIM",
      ],
    }),
  );
}
