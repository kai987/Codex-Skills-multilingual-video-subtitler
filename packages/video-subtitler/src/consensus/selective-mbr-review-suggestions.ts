import {
  machineMultiAsrHypothesisUniverseSchema,
  type C61HypothesisUniverse,
} from "@mvl/shared";
import {
  c611ReviewSuggestionsSchema,
  type C611ReviewSuggestions,
} from "../../../shared/src/c6-1-1-diagnostic-schemas.js";
import {
  c611DecisionSchema,
  c611CalibrationProfileIdSchema,
  type C611Decision,
  type C611CalibrationProfileId,
} from "../../../shared/src/c6-1-1-calibration-schemas.js";
import {
  machineSelectiveExistingCandidateProposalsSchema,
  type C611Proposals,
} from "../../../shared/src/c6-1-1-machine-schemas.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { c611WithHash } from "./hierarchical-correlation-groups.js";

/** Presentation-only projection: the caller fixes the profile; this function
 * cannot inspect labels, choose a best profile, run models or write production.
 * OOF scores remain benchmark/train-label derived and are not blind confidence. */
export function buildC611ReviewSuggestions(input: {
  universe: C61HypothesisUniverse;
  proposals: C611Proposals;
  decisions: readonly C611Decision[];
  profileId: C611CalibrationProfileId;
  appliedEventIdsByProfile?: Readonly<Record<string, readonly string[]>>;
}): C611ReviewSuggestions {
  const universe = machineMultiAsrHypothesisUniverseSchema.parse(
    input.universe,
  );
  const proposals = machineSelectiveExistingCandidateProposalsSchema.parse(
    input.proposals,
  );
  const profileId = c611CalibrationProfileIdSchema.parse(input.profileId);
  const decisions = input.decisions
    .map((d) => c611DecisionSchema.parse(d))
    .filter((d) => d.profileId === profileId)
    .toSorted((a, b) => a.eventId.localeCompare(b.eventId));
  if (proposals.candidateUniverseHash !== universe.semanticHash)
    throw new Error("C611_REVIEW_UNIVERSE_MISMATCH");
  if (new Set(decisions.map((d) => d.eventId)).size !== decisions.length)
    throw new Error("C611_REVIEW_DUPLICATE_DECISION");
  if (decisions.length !== proposals.records.length)
    throw new Error("C611_REVIEW_INCOMPLETE_PROFILE_DECISIONS");
  const rows = decisions.map((decision) => {
    const proposal = proposals.records.find(
      (p) =>
        p.proposalId === decision.proposalId && p.eventId === decision.eventId,
    );
    const event = universe.events.find((e) => e.eventId === decision.eventId);
    if (!proposal || !event)
      throw new Error("C611_REVIEW_MISSING_EVENT_PROPOSAL");
    const candidate = universe.candidates.find(
      (c) =>
        c.candidateId === decision.proposedCandidateId &&
        c.eventId === decision.eventId &&
        c.inclusionStatus === "INCLUDED" &&
        c.providerFamily !== "CURRENT",
    );
    if (decision.proposedCandidateId !== null && !candidate)
      throw new Error("C611_REVIEW_NONEXISTING_CANDIDATE");
    const requested = decision.decision === "SELECT_EXISTING_CANDIDATE";
    if (
      requested &&
      (!candidate ||
        !proposal.eligibleCandidates.some(
          (c) => c.candidateId === candidate.candidateId,
        ))
    )
      throw new Error("C611_REVIEW_UNSAFE_SELECTED_CANDIDATE");
    const applied = input.appliedEventIdsByProfile?.[profileId];
    const applicationStatus = !requested
      ? "NOT_SELECTED"
      : applied === undefined
        ? "UNKNOWN"
        : applied.includes(event.eventId)
          ? "APPLIED"
          : "BLOCKED";
    const reviewDecision =
      applicationStatus === "BLOCKED"
        ? "ABSTAIN_REVIEW"
        : requested
          ? "SELECT_EXISTING_CANDIDATE"
          : decision.decision === "KEEP_CURRENT"
            ? "KEEP_CURRENT"
            : "ABSTAIN_REVIEW";
    const current = universe.candidates.find(
      (c) =>
        c.candidateId === proposal.currentCandidateId &&
        c.eventId === event.eventId &&
        c.providerFamily === "CURRENT",
    );
    if (current && current.displayText !== event.currentText)
      throw new Error("C611_REVIEW_CURRENT_TEXT_MISMATCH");
    return c611WithHash({
      eventId: event.eventId,
      proposalId: proposal.proposalId,
      currentCandidateId: proposal.currentCandidateId,
      currentText: event.currentText,
      candidateId: candidate?.candidateId ?? null,
      candidateText: candidate?.displayText ?? null,
      candidateProvenanceHash: candidate?.provenanceHash ?? null,
      decision: reviewDecision,
      score: decision.decisionScore,
      threshold: decision.threshold,
      applicationStatus,
      reasons: [
        ...new Set([
          ...proposal.eligibilityReasons,
          ...decision.machineReasons,
          ...(applicationStatus === "BLOCKED"
            ? ["RENDERER_BLOCKED_REQUESTED_SWITCH"]
            : []),
          "REVIEW_ASSISTANCE_ONLY_HUMAN_APPROVAL_REQUIRED",
          "BENCHMARK_OOF_SCORE_NOT_BLIND_PRODUCTION_CONFIDENCE",
        ]),
      ],
    });
  });
  return c611ReviewSuggestionsSchema.parse(
    c611WithHash({
      schemaVersion: "1.0.0",
      policyVersion: proposals.policyVersion,
      artifactType: "machine-c6-1-1-selective-mbr-review-suggestions",
      privacy: "LOCAL_ONLY",
      usage: "REVIEW_ASSISTANCE_ONLY",
      scoreAuthority: "BENCHMARK_OOF_TRAIN_LABEL_DERIVED_NOT_BLIND_NEW_MODEL",
      profileSelection: "CALLER_FIXED_NOT_CHOSEN_FROM_GOLD_BY_SUGGESTER",
      profileId,
      runtimeGoldInputCount: 0,
      goldLabelInputCount: 0,
      productionMutationCount: 0,
      humanApprovalRequired: true,
      candidateUniverseHash: universe.semanticHash,
      proposalHash: proposals.semanticHash,
      decisionHash: hash(decisions),
      applicationEvidenceHash: input.appliedEventIdsByProfile
        ? hash(input.appliedEventIdsByProfile)
        : null,
      rows,
    }),
  );
}
