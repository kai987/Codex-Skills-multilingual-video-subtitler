import {
  c61OracleSchema,
  c61ProfileQualitySchema,
  c61QualityEvaluationSchema,
  c61ConsensusProfileFreezeSchema,
  blindEvaluationPolicySchema,
  type C61HypothesisUniverse,
  type C61Metrics,
  type C61Oracle,
  type C61QualityEvaluation,
  type C61TokenLattice,
  type C61MachineFreeze,
  type MachineVsGoldEvaluation,
  type C61ConsensusProfileFreeze,
} from "@mvl/shared";
import { evaluateMachineCues } from "../blind-acceptance/gold-evaluation.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import {
  c61EvaluationEditDistance as distance,
  exactC61LegalPathOracle,
  normalizeC61EvaluationText as normalize,
  unrestrictedC61SlotOracle,
} from "./consensus-oracle-evaluator.js";
import type { C61ProfilePath } from "./consensus-safety-audit.js";
import type { C61AssembledShadow } from "./consensus-shadow-assembly.js";
import { c61Require, c61Graphemes } from "./japanese-text-representation.js";
import { C61_EVENT_EVALUATION_POLICY } from "./c61-policy.js";
export interface C61GoldCue {
  id: string;
  start: number;
  end: number;
  text: string;
}
interface GoldMapping {
  status: "EVALUABLE" | "AMBIGUOUS_GOLD_MAPPING" | "NO_GOLD_MAPPING";
  text: string;
  ids: string[];
}
/** Fixed, text-independent event mapping. Ambiguous local matches are excluded,
 * never resolved by choosing the Gold phrase that makes a decoder look best. */
export function mapC61EventsToGold(
  universe: C61HypothesisUniverse,
  gold: C61GoldCue[],
): Map<string, GoldMapping> {
  if (new Set(gold.map((cue) => cue.id)).size !== gold.length)
    throw new Error("C61_DUPLICATE_GOLD_CUE_ID");
  const orderedGold = gold.toSorted(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );
  const mapping = new Map<string, GoldMapping>();
  for (const event of universe.events) {
    const interval = event.sourceInterval;
    const matches = orderedGold.filter(
      (cue) =>
        Math.min(cue.end, interval.end) - Math.max(cue.start, interval.start) >
        0,
    );
    const only = matches[0];
    const overlap = only
      ? Math.max(
          0,
          Math.min(only.end, interval.end) -
            Math.max(only.start, interval.start),
        )
      : 0;
    const enough =
      only !== undefined &&
      overlap / Math.max(0.001, only.end - only.start) >=
        C61_EVENT_EVALUATION_POLICY.minimumGoldOverlapRatio &&
      overlap / Math.max(0.001, interval.end - interval.start) >=
        C61_EVENT_EVALUATION_POLICY.minimumEventOverlapRatio;
    mapping.set(event.eventId, {
      status:
        matches.length === 0
          ? "NO_GOLD_MAPPING"
          : matches.length === 1 && enough
            ? "EVALUABLE"
            : "AMBIGUOUS_GOLD_MAPPING",
      text: matches.map((c) => c.text).join(""),
      ids: matches.map((c) => c.id),
    });
  }
  // A Gold cue is a complete text unit, not a label to duplicate across several
  // overlapping acoustic events. Without a verified text-span mapping abstain.
  const claims = new Map<string, number>();
  for (const row of mapping.values())
    if (row.status === "EVALUABLE")
      for (const id of row.ids) claims.set(id, (claims.get(id) ?? 0) + 1);
  for (const row of mapping.values())
    if (
      row.status === "EVALUABLE" &&
      row.ids.some((id) => (claims.get(id) ?? 0) > 1)
    )
      row.status = "AMBIGUOUS_GOLD_MAPPING";
  return mapping;
}
export function evaluateC61Oracles(input: {
  universe: C61HypothesisUniverse;
  lattices: C61TokenLattice[];
  gold: C61GoldCue[];
  machineFreezeHash: string;
}): C61Oracle {
  const mappings = mapC61EventsToGold(input.universe, input.gold);
  const events: C61Oracle["events"] = input.universe.events.map((event) => {
    const mapping = c61Require(mappings.get(event.eventId));
    const candidates = input.universe.candidates.filter(
      (c) => c.eventId === event.eventId && c.inclusionStatus === "INCLUDED",
    );
    const lattice = input.lattices.find((l) => l.eventId === event.eventId);
    const status =
      !lattice || candidates.length === 0
        ? ("NO_INCLUDED_CANDIDATE" as const)
        : mapping.status;
    const common = {
      eventId: event.eventId,
      evaluationStatus: status,
      goldCharacterCount: c61Graphemes(normalize(mapping.text)).length,
      goldMappingIds: mapping.ids,
    };
    if (status !== "EVALUABLE" || !lattice) {
      const row = {
        ...common,
        currentError: null,
        bestExistingCandidateId: null,
        bestExistingCandidateError: null,
        bestLegalPathError: null,
        unrestrictedSlotError: null,
        candidateOracleGain: null,
        consensusOracleGain: null,
        bestLegalNodeIds: [],
        oracleSearchStatus: "UNAVAILABLE" as const,
      };
      return { ...row, semanticHash: hash(row) };
    }
    const target = normalize(mapping.text);
    const ranked = candidates
      .map((c) => ({
        id: c.candidateId,
        error: distance(normalize(c.displayText), target),
      }))
      .sort((a, b) => a.error - b.error || a.id.localeCompare(b.id));
    const best = c61Require(ranked[0]);
    const legal = exactC61LegalPathOracle(lattice, mapping.text);
    const unrestricted = unrestrictedC61SlotOracle(lattice, mapping.text);
    if (legal.error > best.error || unrestricted > legal.error)
      throw new Error("C61_ORACLE_BOUND_VIOLATION");
    const currentError = distance(normalize(event.currentText ?? ""), target);
    const row = {
      ...common,
      currentError,
      bestExistingCandidateId: best.id,
      bestExistingCandidateError: best.error,
      bestLegalPathError: legal.error,
      unrestrictedSlotError: unrestricted,
      candidateOracleGain: currentError - best.error,
      consensusOracleGain: best.error - legal.error,
      bestLegalNodeIds: legal.nodeIds,
      oracleSearchStatus: legal.algorithm,
    };
    return { ...row, semanticHash: hash(row) };
  });
  const sum = (
    key:
      | "currentError"
      | "bestExistingCandidateError"
      | "bestLegalPathError"
      | "unrestrictedSlotError",
  ) => events.reduce((n, e) => n + (e[key] ?? 0), 0);
  const body = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.1-consensus-investigation-v1" as const,
    artifactType: "c6-1-legal-path-oracle" as const,
    evaluationOnly: true as const,
    machineFreezeHash: input.machineFreezeHash,
    events,
    currentError: sum("currentError"),
    bestExistingCandidateError: sum("bestExistingCandidateError"),
    bestLegalPathError: sum("bestLegalPathError"),
    unrestrictedSlotError: sum("unrestrictedSlotError"),
    goldCharacterCount: events
      .filter((e) => e.evaluationStatus === "EVALUABLE")
      .reduce((n, e) => n + e.goldCharacterCount, 0),
    candidateOracleGain:
      sum("currentError") - sum("bestExistingCandidateError"),
    legalPathOracleGain: sum("currentError") - sum("bestLegalPathError"),
    consensusSpecificOracleGain:
      sum("bestExistingCandidateError") - sum("bestLegalPathError"),
    evaluableEventCount: events.filter(
      (e) => e.evaluationStatus === "EVALUABLE",
    ).length,
    unevaluableEventCount: events.filter(
      (e) => e.evaluationStatus !== "EVALUABLE",
    ).length,
  };
  return c61OracleSchema.parse({ ...body, semanticHash: hash(body) });
}
export function c61MetricsFromEvaluation(
  e: MachineVsGoldEvaluation,
): C61Metrics {
  return {
    exactCer: e.globalTextMetrics.exact.cer,
    normalizedCer: e.globalTextMetrics.normalized.cer,
    coverage: e.coverageMetrics.goldTextCoverageRatio,
    missing: e.missingDialogueCandidates.length,
    hallucination: e.hallucinationCandidates.length,
    materialErrors: e.materialTextErrors.length,
    cueCount: e.alignmentMetrics.machineCueCount,
    severeTiming: e.severeTimingErrors.length,
    startMae: e.timingMetrics.startMaeSeconds,
    endMae: e.timingMetrics.endMaeSeconds,
    boundaryP95: e.timingMetrics.boundaryP95Seconds,
    medianIoU: e.timingMetrics.timingIoUMedian,
    overlap: e.overlapComparisons[0]?.machineOverlapCount ?? 0,
  };
}
export function compareC61Timing(input: {
  cues: readonly {
    id: string;
    start: number;
    end: number;
  }[];
  baselineCues: readonly {
    id: string;
    start: number;
    end: number;
  }[];
  metrics: C61Metrics;
  baseline: C61Metrics;
}): {
  timingHashUnchanged: boolean;
  matchingInducedTimingDelta: boolean;
} {
  const timingHashUnchanged =
    input.cues.length === input.baselineCues.length &&
    input.cues.every((cue, index) => {
      const base = input.baselineCues[index];
      return (
        cue.id === base?.id && cue.start === base.start && cue.end === base.end
      );
    });
  const changedMetric = (
    [
      "startMae",
      "endMae",
      "boundaryP95",
      "medianIoU",
      "severeTiming",
      "overlap",
    ] as const
  ).some((key) => input.metrics[key] !== input.baseline[key]);
  return {
    timingHashUnchanged,
    matchingInducedTimingDelta: timingHashUnchanged && changedMetric,
  };
}
export function evaluateC61Profiles(input: {
  universe: C61HypothesisUniverse;
  paths: C61ProfilePath[];
  shadows: C61AssembledShadow[];
  gold: C61GoldCue[];
  goldIdentity: MachineVsGoldEvaluation["goldIdentity"];
  sourceIdentity: MachineVsGoldEvaluation["sourceIdentity"];
  freeze: C61MachineFreeze;
  profileFreeze: C61ConsensusProfileFreeze;
  oracle: C61Oracle;
  profileEvidence: Record<
    string,
    {
      acousticEvidenceUsed: number;
      unsafeRejected: number;
    }
  >;
}): {
  quality: C61QualityEvaluation;
  fullEvaluations: MachineVsGoldEvaluation[];
} {
  if (input.oracle.machineFreezeHash !== input.freeze.semanticHash)
    throw new Error("C61_ORACLE_FREEZE_MISMATCH");
  const frozenProfile = c61ConsensusProfileFreezeSchema.parse(
    input.profileFreeze,
  );
  const { semanticHash: profileHash, ...profileBody } = frozenProfile;
  if (
    profileHash !== input.freeze.policyHash ||
    hash(profileBody) !== profileHash
  )
    throw new Error("C61_EVALUATION_PROFILE_FREEZE_MISMATCH");
  const { policyHash: evaluationPolicyHash, ...evaluationBody } =
    frozenProfile.evaluationPolicy;
  if (
    hash(evaluationBody) !== evaluationPolicyHash ||
    hash(frozenProfile.eventEvaluationPolicy) !==
      hash(C61_EVENT_EVALUATION_POLICY)
  )
    throw new Error("C61_FROZEN_EVALUATION_POLICY_MISMATCH");
  if (
    Date.parse(input.goldIdentity.firstReadAt) <
    Date.parse(input.freeze.frozenAt)
  )
    throw new Error("C61_GOLD_READ_PRECEDES_MACHINE_FREEZE");
  if (
    new Set(input.shadows.map((shadow) => shadow.profileId)).size !==
    input.shadows.length
  )
    throw new Error("C61_DUPLICATE_SHADOW_PROFILE");
  for (const shadow of input.shadows) {
    const evidence = input.profileEvidence[shadow.profileId];
    if (
      !evidence ||
      ![evidence.acousticEvidenceUsed, evidence.unsafeRejected].every(
        (count) => Number.isInteger(count) && count >= 0,
      )
    )
      throw new Error(
        `C61_MISSING_OR_INVALID_PROFILE_EVIDENCE:${shadow.profileId}`,
      );
  }
  const mappings = mapC61EventsToGold(input.universe, input.gold);
  const policy = blindEvaluationPolicySchema.parse({
    ...frozenProfile.evaluationPolicy,
    frozenAt: input.freeze.frozenAt,
  });
  const fullEvaluations = input.shadows.map((s) =>
    evaluateMachineCues({
      generatedAt: input.freeze.frozenAt,
      generationRunId: `c6-1-${s.profileId}`,
      sourceIdentity: input.sourceIdentity,
      freeze: {
        freezeSemanticHash: input.freeze.semanticHash,
        frozenArtifactAggregateHash: input.freeze.machineAggregateHash,
      },
      machineCues: s.subtitlePackage.cues,
      goldCues: input.gold,
      goldIdentity: input.goldIdentity,
      policy,
      evaluationWallTimeMs: 0,
      outputHashAfterGold: input.freeze.machineAggregateHash,
    }),
  );
  const baselineIndex = input.shadows.findIndex((s) => s.profileId === "P0");
  if (baselineIndex < 0) throw new Error("C61_MISSING_P0_CONTROL");
  const baseline = c61MetricsFromEvaluation(
    c61Require(fullEvaluations[baselineIndex]),
  );
  const baselineCues = c61Require(input.shadows[baselineIndex]).subtitlePackage
    .cues;
  const profiles = input.shadows.map((shadow, i) => {
    const metrics = c61MetricsFromEvaluation(c61Require(fullEvaluations[i]));
    const eventResults = input.universe.events.map((e) => {
      const selected = input.paths.find(
        (p) => p.profileId === shadow.profileId && p.eventId === e.eventId,
      )?.path;
      const assembly = shadow.decisions.filter(
        (decision) => decision.eventId === e.eventId,
      );
      if (assembly.length !== 1)
        throw new Error("C61_MISSING_OR_DUPLICATE_ASSEMBLY_DECISION");
      const applied = assembly[0]?.status === "APPLIED_SHADOW_ONLY";
      const output = applied
        ? c61Require(selected).displayText
        : (e.currentText ?? "");
      if (assembly[0]?.outputTextHash !== hash(output))
        throw new Error("C61_ASSEMBLY_OUTPUT_HASH_MISMATCH");
      const mapping = c61Require(mappings.get(e.eventId));
      const evaluable = mapping.status === "EVALUABLE";
      const currentError = evaluable
        ? distance(normalize(e.currentText ?? ""), normalize(mapping.text))
        : null;
      const outputError = evaluable
        ? distance(normalize(output), normalize(mapping.text))
        : null;
      const oracle = input.oracle.events.find((r) => r.eventId === e.eventId);
      const best = oracle?.bestExistingCandidateError;
      const outcome = !evaluable
        ? ("UNEVALUABLE" as const)
        : c61Require(outputError) < c61Require(currentError)
          ? ("IMPROVED" as const)
          : c61Require(outputError) > c61Require(currentError)
            ? ("REGRESSED" as const)
            : ("NEUTRAL" as const);
      const row = {
        eventId: e.eventId,
        evaluationStatus: mapping.status,
        changed: output !== (e.currentText ?? ""),
        currentError,
        outputError,
        exactCorrect: evaluable
          ? output.normalize("NFC") === mapping.text.normalize("NFC")
          : null,
        normalizedCorrect: evaluable ? outputError === 0 : null,
        outcome,
        novelLegal: applied && selected?.pathKind === "NOVEL_LEGAL_PATH",
        beatsAllExisting:
          evaluable && best !== null && best !== undefined
            ? c61Require(outputError) < best
            : null,
        equalsBestExisting:
          evaluable && best !== null && best !== undefined
            ? outputError === best
            : null,
        providerSwitchCount: applied ? (selected?.providerSwitchCount ?? 0) : 0,
        outputTextHash: hash(output),
      };
      return { ...row, semanticHash: hash(row) };
    });
    const changed = eventResults.filter((e) => e.changed);
    const evaluableChanged = changed.filter((e) => e.outcome !== "UNEVALUABLE");
    const improved = eventResults.filter(
      (e) => e.outcome === "IMPROVED",
    ).length;
    const regressed = eventResults.filter(
      (e) => e.outcome === "REGRESSED",
    ).length;
    const realizedGain = eventResults.reduce(
      (n, e) => n + (e.currentError ?? 0) - (e.outputError ?? 0),
      0,
    );
    const timing = compareC61Timing({
      cues: shadow.subtitlePackage.cues,
      baselineCues,
      metrics,
      baseline,
    });
    const evidence = c61Require(input.profileEvidence[shadow.profileId]);
    const data = {
      profileId: shadow.profileId,
      metrics,
      changedEvents: changed.length,
      improved,
      regressed,
      neutral: eventResults.filter((e) => e.outcome === "NEUTRAL").length,
      unevaluable: eventResults.filter((e) => e.outcome === "UNEVALUABLE")
        .length,
      renderedChangedCueCount: shadow.changedCueIds.length,
      shadowBlockedChangeCount: shadow.decisions.filter(
        (d) => !["KEEP_CURRENT", "APPLIED_SHADOW_ONLY"].includes(d.status),
      ).length,
      exactCorrect: eventResults.filter((e) => e.exactCorrect).length,
      normalizedCorrect: eventResults.filter((e) => e.normalizedCorrect).length,
      beatsAllExisting: eventResults.filter((e) => e.beatsAllExisting).length,
      equalsBestExisting: eventResults.filter((e) => e.equalsBestExisting)
        .length,
      worseThanBestExisting: eventResults.filter(
        (e) => e.beatsAllExisting === false && e.equalsBestExisting === false,
      ).length,
      novelPaths: eventResults.filter((e) => e.novelLegal).length,
      novelImproved: eventResults.filter(
        (e) => e.novelLegal && e.outcome === "IMPROVED",
      ).length,
      novelExactCorrect: eventResults.filter(
        (e) => e.novelLegal && e.exactCorrect,
      ).length,
      novelRegressed: eventResults.filter(
        (e) => e.novelLegal && e.outcome === "REGRESSED",
      ).length,
      consensusPrecision: evaluableChanged.length
        ? improved / evaluableChanged.length
        : null,
      consensusHarmRate: evaluableChanged.length
        ? regressed / evaluableChanged.length
        : null,
      consensusCoverage:
        changed.filter(
          (e) =>
            c61Require(
              input.universe.eventScopes.find((s) => s.eventId === e.eventId)
                ?.normalizedDistinctCount,
            ) >= 2,
        ).length /
        Math.max(1, input.universe.summary.multiHypothesisEventCount),
      realizedGain,
      oracleCapture:
        input.oracle.legalPathOracleGain > 0
          ? realizedGain / input.oracle.legalPathOracleGain
          : null,
      providerSwitchCount: changed.reduce(
        (n, e) => n + e.providerSwitchCount,
        0,
      ),
      meanProviderSwitches:
        changed.reduce((n, e) => n + e.providerSwitchCount, 0) /
        Math.max(1, changed.length),
      maxProviderSwitches: Math.max(
        0,
        ...changed.map((e) => e.providerSwitchCount),
      ),
      acousticEvidenceUsed: evidence.acousticEvidenceUsed,
      unsafeRejected: evidence.unsafeRejected,
      ...timing,
      fixedBaselineTimingMetrics: baseline,
      eventResults,
    };
    return c61ProfileQualitySchema.parse({ ...data, semanticHash: hash(data) });
  });
  const best = profiles
    .filter((p) => /^P[1-9]$/u.test(p.profileId))
    .toSorted(
      (a, b) =>
        a.metrics.normalizedCer - b.metrics.normalizedCer ||
        a.metrics.materialErrors - b.metrics.materialErrors ||
        a.regressed - b.regressed ||
        a.profileId.localeCompare(b.profileId),
    )[0];
  const body = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.1-consensus-investigation-v1" as const,
    artifactType: "c6-1-consensus-quality-evaluation" as const,
    benchmarkStatus: "KNOWN_DEVELOPMENT_BENCHMARK" as const,
    evaluationOnly: true as const,
    machineFreezeHash: input.freeze.semanticHash,
    goldIdentityHash: input.goldIdentity.sha256,
    baseline,
    profiles,
    bestGoldFreeProfile: best?.profileId ?? "P0",
    profileSelection: "POST_HOC_REPORTING_ONLY_NOT_RUNTIME_SELECTION" as const,
  };
  return {
    quality: c61QualityEvaluationSchema.parse({
      ...body,
      semanticHash: hash(body),
    }),
    fullEvaluations,
  };
}
