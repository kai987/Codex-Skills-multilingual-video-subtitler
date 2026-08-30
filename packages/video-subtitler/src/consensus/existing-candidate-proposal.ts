import {
  c61HypothesisInputSchema,
  machineMultiAsrHypothesisUniverseSchema,
  subtitlePackageSchema,
  type C61HypothesisUniverse,
  type SubtitlePackage,
} from "@mvl/shared";
import {
  machineSelectiveExistingCandidateProposalsSchema,
  type C611CandidateMachineMetadata,
  type C611Proposal,
} from "../../../shared/src/c6-1-1-machine-schemas.js";
import type { C61MachineArtifactInput } from "./c61-artifact-adapter.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { buildC61HypothesisUniverse } from "./hypothesis-universe.js";
import {
  buildC611CorrelationGroups,
  extractC611CandidateMetadata,
  c611Header,
  c611WithHash,
  C611_CORRELATION_POLICY,
} from "./hierarchical-correlation-groups.js";
import {
  buildC611RiskLedger,
  C611_RISK_POLICY,
} from "./hierarchical-candidate-mbr.js";
import {
  checkC611SpanApplication,
  C611_PRESERVATION_POLICY,
} from "./current-preservation.js";
import {
  buildC611Completeness,
  C611_COMPLETENESS_POLICY,
} from "./candidate-completeness-risk.js";
import {
  buildC611Features,
  C611_FEATURE_POLICY,
} from "./selective-mbr-features.js";

export const C611_PROPOSAL_POLICY = {
  version: "c611-one-existing-alternative-v1",
  primaryVariant: "H2",
  diagnosticVariants: ["H0", "H1", "H2"],
  topK: 5,
  alternative: "full-existing-ASR-candidate-not-current-control",
  eligibility: "exact-provenance-and-applicable-final-span-before-ranking",
  equivalentCurrent: "identical-display-no-switch",
  tieBreak: "risk-then-provenanceHash-then-candidateId",
  negativeMargin: "allowed-as-calibration-proposal-not-a-switch",
  novelText: false,
} as const;
export const C611_MACHINE_POLICY_DESCRIPTOR = {
  correlation: C611_CORRELATION_POLICY,
  risk: C611_RISK_POLICY,
  proposal: C611_PROPOSAL_POLICY,
  preservation: C611_PRESERVATION_POLICY,
  completeness: C611_COMPLETENESS_POLICY,
  features: C611_FEATURE_POLICY,
} as const;
export const C611_MACHINE_POLICY_HASH = hash(C611_MACHINE_POLICY_DESCRIPTOR);

export function buildC611MachineProposals(input: {
  universe: C61HypothesisUniverse;
  machine: C61MachineArtifactInput;
  productionPackage?: SubtitlePackage;
  machineMetadata?: readonly C611CandidateMachineMetadata[];
  metadataArtifacts?: Readonly<Record<string, unknown>>;
}) {
  const universe = machineMultiAsrHypothesisUniverseSchema.parse(
    input.universe,
  );
  const production = subtitlePackageSchema.parse(
    input.productionPackage ?? input.machine.subtitlePackage,
  );
  const raw = input.machine.candidates.map((c) =>
    c61HypothesisInputSchema.parse(c),
  );
  const execution = input.machine.baselineInventory as unknown as Record<
    string,
    unknown
  >;
  if (
    execution.runtimeGoldInputCount !== 0 ||
    execution.newAsrInferenceCount !== 0 ||
    execution.networkUsed !== false
  )
    throw new Error("C611_MACHINE_ONLY_INPUT_REQUIRED");
  const rebuilt = buildC61HypothesisUniverse({
    events: input.machine.events,
    candidates: raw,
    sourceArtifactHashes: input.machine.sourceArtifactHashes,
  });
  if (hash(rebuilt) !== hash(universe))
    throw new Error("C611_CANDIDATE_UNIVERSE_REPLAY_MISMATCH");
  if (hash(production.cues) !== hash(input.machine.subtitlePackage.cues))
    throw new Error("C611_PRODUCTION_BASELINE_MISMATCH");
  const metadata = [
    ...(input.machineMetadata ?? []),
    ...(input.metadataArtifacts
      ? extractC611CandidateMetadata({
          artifacts: input.metadataArtifacts,
          sourceArtifactHashes: input.machine.sourceArtifactHashes,
        })
      : []),
  ];
  const { groups: correlationGroups, audit: correlationAudit } =
    buildC611CorrelationGroups({
      universe,
      sourceAudioIdentity: input.machine.baselineInventory.sourceMediaSha256,
      metadata,
    });
  const riskLedger = buildC611RiskLedger({ universe, correlationGroups });
  const records: C611Proposal[] = universe.events.map((event) => {
    const current = universe.candidates.find(
      (c) =>
        c.eventId === event.eventId &&
        c.providerFamily === "CURRENT" &&
        c.inclusionStatus === "INCLUDED",
    );
    const currentRisk = riskLedger.rows.find(
      (r) => r.eventId === event.eventId && r.role === "CURRENT_NO_SWITCH",
    );
    const rejectedCandidates: C611Proposal["rejectedCandidates"] = [];
    const allowed = universe.candidates
      .filter(
        (c) =>
          c.eventId === event.eventId &&
          c.providerFamily !== "CURRENT" &&
          c.inclusionStatus !== "NORMALIZED_DUPLICATE",
      )
      .flatMap((candidate) => {
        if (candidate.displayText === event.currentText) return [];
        const check = checkC611SpanApplication({
          event,
          candidate,
          events: universe.events,
          production,
        });
        if (!check.proof) {
          rejectedCandidates.push({
            candidateId: candidate.candidateId,
            reasons: check.reasons,
          });
          return [];
        }
        const risk = riskLedger.rows.find(
          (r) =>
            r.eventId === event.eventId &&
            r.candidateId === candidate.candidateId,
        );
        if (!risk) {
          rejectedCandidates.push({
            candidateId: candidate.candidateId,
            reasons: ["MISSING_PROVENANCE_RISK_JOIN"],
          });
          return [];
        }
        return [{ candidate, proof: check.proof, risk }];
      });
    const rank = (variant: "H0" | "H1" | "H2") => {
      const key: "legacyRisk" | "providerBalancedRisk" | "hierarchicalRisk" =
        variant === "H0"
          ? "legacyRisk"
          : variant === "H1"
            ? "providerBalancedRisk"
            : "hierarchicalRisk";
      return {
        key,
        ranked: allowed
          .filter((a) => a.risk[key] !== null)
          .toSorted(
            (a, b) =>
              (a.risk[key] ?? Infinity) - (b.risk[key] ?? Infinity) ||
              a.candidate.provenanceHash.localeCompare(
                b.candidate.provenanceHash,
              ) ||
              a.candidate.candidateId.localeCompare(b.candidate.candidateId),
          ),
      };
    };
    const selected = rank("H2"),
      best = selected.ranked[0],
      runner = selected.ranked.find(
        (a) => a.candidate.normalizedText !== best?.candidate.normalizedText,
      );
    const status: C611Proposal["eligibilityStatus"] = best
      ? "ELIGIBLE"
      : rejectedCandidates.length
        ? "BLOCKED_STRUCTURAL"
        : "NO_ALTERNATIVE";
    const diagnosticProposals = (["H0", "H1", "H2"] as const).map((variant) => {
      const { key, ranked } = rank(variant),
        proposed = ranked[0],
        before = currentRisk?.[key] ?? null,
        after = proposed?.risk[key] ?? null;
      return {
        variant,
        candidateId: proposed?.candidate.candidateId ?? null,
        currentRisk: before,
        proposedRisk: after,
        margin: before === null || after === null ? null : before - after,
        eligibilityStatus: status,
      };
    });
    const rawMbrMargin =
      currentRisk?.legacyRisk == null || best?.risk.legacyRisk == null
        ? null
        : currentRisk.legacyRisk - best.risk.legacyRisk;
    const hierarchicalMbrMargin =
      currentRisk?.hierarchicalRisk == null ||
      best?.risk.hierarchicalRisk == null
        ? null
        : currentRisk.hierarchicalRisk - best.risk.hierarchicalRisk;
    const intervals = correlationGroups.observations
      .filter((o) => o.eventId === event.eventId)
      .flatMap((o) => [
        o.sourceInterval,
        ...(o.coreInterval ? [o.coreInterval] : []),
        ...(o.requestInterval ? [o.requestInterval] : []),
      ]);
    const acousticIntervals = [
      ...new Map(
        [event.sourceInterval, ...intervals].map((v) => [hash(v), v]),
      ).values(),
    ].toSorted((a, b) => a.start - b.start || a.end - b.end);
    return c611WithHash({
      proposalId: `c611-proposal:${hash([universe.semanticHash, event.eventId, C611_PROPOSAL_POLICY]).slice(0, 24)}`,
      eventId: event.eventId,
      sourceAudioIdentity: input.machine.baselineInventory.sourceMediaSha256,
      sourceInterval: event.sourceInterval,
      acousticIntervals,
      finalCueIds: event.finalCueIds,
      currentCandidateId: current?.candidateId ?? null,
      proposedCandidateId: best?.candidate.candidateId ?? null,
      proposedProvider:
        best?.candidate.providerFamily === "WHISPER" ||
        best?.candidate.providerFamily === "REAZON"
          ? best.candidate.providerFamily
          : null,
      proposedRole: best?.candidate.candidateRole ?? null,
      currentMbrRisk: currentRisk?.legacyRisk ?? null,
      proposedMbrRisk: best?.risk.legacyRisk ?? null,
      rawMbrMargin,
      hierarchicalMbrMargin,
      runnerUpCandidateId: runner?.candidate.candidateId ?? null,
      runnerUpMargin:
        runner?.risk.hierarchicalRisk == null ||
        best?.risk.hierarchicalRisk == null
          ? null
          : Math.max(
              0,
              runner.risk.hierarchicalRisk - best.risk.hierarchicalRisk,
            ),
      topKCandidateIds: selected.ranked
        .slice(0, C611_PROPOSAL_POLICY.topK)
        .map((a) => a.candidate.candidateId),
      eligibilityStatus: status,
      eligibilityReasons: [
        status === "ELIGIBLE"
          ? "EXISTING_FULL_CANDIDATE_AND_EXACT_TEXT_SPAN_VALIDATED"
          : status === "BLOCKED_STRUCTURAL"
            ? "NO_STRUCTURALLY_APPLICABLE_ALTERNATIVE"
            : "NO_DISTINCT_EXISTING_ASR_ALTERNATIVE",
        "PROPOSAL_NOT_AUTOMATIC_SWITCH",
        "GOLD_UNAVAILABLE_AT_PROPOSAL",
      ],
      spanApplication: best?.proof ?? null,
      eligibleCandidates: allowed
        .map((a) => ({
          candidateId: a.candidate.candidateId,
          spanApplication: a.proof,
        }))
        .toSorted((a, b) => a.candidateId.localeCompare(b.candidateId)),
      diagnosticProposals,
      rejectedCandidates: rejectedCandidates.toSorted((a, b) =>
        a.candidateId.localeCompare(b.candidateId),
      ),
    });
  });
  const proposals = machineSelectiveExistingCandidateProposalsSchema.parse(
    c611WithHash({
      ...c611Header,
      artifactType: "machine-selective-existing-candidate-proposals",
      candidateUniverseHash: universe.semanticHash,
      correlationGroupsHash: correlationGroups.semanticHash,
      riskLedgerHash: riskLedger.semanticHash,
      proposalPolicyHash: hash(C611_PROPOSAL_POLICY),
      primaryVariant: "H2",
      novelApplicationCount: 0,
      records,
    }),
  );
  const completeness = buildC611Completeness({ universe, proposals, metadata });
  const features = buildC611Features({
    universe,
    proposals,
    completeness,
    correlationGroups,
    acousticScores: input.machine.acousticScores,
  });
  return {
    correlationGroups,
    correlationAudit,
    riskLedger,
    proposals,
    completeness,
    features,
  };
}
