import {
  c611GroupedOracleSchema,
  type C611EvaluationCue,
  type C611FixedBaselineAlignmentMap,
  type C611FixedGroupEvaluation,
  type C611GroupedOracle,
  type C611GroupedOracleGroup,
  type C611GroupedOraclePolicy,
  type C611GroupedOracleSearch,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import {
  C611_EVALUATION_HEADER,
  c611CueViews,
  c611EventFixedGroups,
  c611OrderedGold,
  c611TimingHash,
} from "./fixed-baseline-alignment-map.js";
import { evaluateC611FixedAlignment } from "./fixed-alignment-paired-evaluator.js";
import {
  c61EvaluationEditDistance as distance,
  normalizeC61EvaluationText as normalize,
} from "./consensus-oracle-evaluator.js";
import { c61Require } from "./japanese-text-representation.js";

/** Frozen before Gold: the search never learns a cap or a tie policy from labels. */
export const C611_GROUPED_ORACLE_POLICY: C611GroupedOraclePolicy =
  Object.freeze({
    oraclePolicyVersion: "c6.1.1-fixed-group-existing-oracles-v1",
    maxCombinationsPerGroup: 65536,
    objective:
      "NORMALIZED_ERROR_THEN_FEWER_SWITCHES_THEN_EXACT_ERROR_THEN_SELECTION_HASH",
    searchMethod: "EXHAUSTIVE_COMPLETE_GROUP_ASSIGNMENTS",
    searchLimitAction: "SKIP_SEARCH_EXACT_VALUE_UNKNOWN",
    crossGroupEventAction: "UNEVALUABLE_COUPLED_ASSIGNMENT",
    individualProposalGainsSummed: false,
    newTextGenerationAllowed: false,
  });

export interface C611FrozenAlternativeOption {
  eventId: string;
  alternatives: readonly { candidateId: string }[];
}
export interface C611OraclePrimaryProposal {
  proposalId: string;
  eventId: string;
  candidateId: string | null;
  eligible: boolean;
}
export interface C611OracleSelection {
  eventId: string;
  candidateId: string;
}
export interface C611OracleAssembly {
  cues: readonly C611EvaluationCue[];
  blockedEventIds: readonly string[];
}
export interface C611GroupedOracleInput {
  fixedMap: C611FixedBaselineAlignmentMap;
  baselineCues: readonly C611EvaluationCue[];
  goldCues: readonly C611EvaluationCue[];
  frozenAlternativeOptions: readonly C611FrozenAlternativeOption[];
  primaryProposals: readonly C611OraclePrimaryProposal[];
  /** Must use the already frozen renderer and candidate identity validation. */
  assemble: (selections: readonly C611OracleSelection[]) => C611OracleAssembly;
}
interface BestObserved {
  exactError: number;
  normalizedError: number;
  selections: C611OracleSelection[];
  cueHash: string;
}
type SearchKind = "proposalOracle" | "bestExistingCandidateOracle";

function sortedInputs(input: C611GroupedOracleInput) {
  const options = input.frozenAlternativeOptions
    .map((row) => ({
      eventId: row.eventId,
      alternatives: row.alternatives
        .map(({ candidateId }) => ({ candidateId }))
        .sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
    }))
    .sort((a, b) => a.eventId.localeCompare(b.eventId));
  const proposals = input.primaryProposals
    .map(({ proposalId, eventId, candidateId, eligible }) => ({
      proposalId,
      eventId,
      candidateId,
      eligible,
    }))
    .sort((a, b) => a.eventId.localeCompare(b.eventId));
  if (
    new Set(options.map((row) => row.eventId)).size !== options.length ||
    new Set(proposals.map((row) => row.eventId)).size !== proposals.length ||
    new Set(proposals.map((row) => row.proposalId)).size !== proposals.length ||
    options.some(
      (row) =>
        !row.eventId ||
        row.alternatives.some((candidate) => !candidate.candidateId) ||
        new Set(row.alternatives.map((candidate) => candidate.candidateId))
          .size !== row.alternatives.length,
    ) ||
    proposals.some((row) => !row.eventId || !row.proposalId)
  )
    throw new Error("C611_ORACLE_DUPLICATE_OR_EMPTY_INPUT_ID");
  for (const proposal of proposals) {
    if (
      proposal.eligible &&
      (!proposal.candidateId ||
        !options
          .find((row) => row.eventId === proposal.eventId)
          ?.alternatives.some(
            (candidate) => candidate.candidateId === proposal.candidateId,
          ))
    )
      throw new Error("C611_ORACLE_PRIMARY_NOT_IN_FROZEN_ELIGIBLE_OPTIONS");
  }
  return { options, proposals };
}
function better(candidate: BestObserved, best: BestObserved): boolean {
  return (
    candidate.normalizedError < best.normalizedError ||
    (candidate.normalizedError === best.normalizedError &&
      (candidate.selections.length < best.selections.length ||
        (candidate.selections.length === best.selections.length &&
          (candidate.exactError < best.exactError ||
            (candidate.exactError === best.exactError &&
              hash(candidate.selections) < hash(best.selections))))))
  );
}
function searchGroup(input: {
  row: C611FixedGroupEvaluation;
  choices: { eventId: string; candidateIds: string[] }[];
  baseline: C611EvaluationCue[];
  gold: C611EvaluationCue[];
  crossGroupEvents: string[];
  assemble: C611GroupedOracleInput["assemble"];
  assertInputsUnchanged: () => void;
}): C611GroupedOracleSearch {
  const { row, baseline } = input;
  const combinations = input.choices.reduce(
    (total, choice) => total * BigInt(choice.candidateIds.length + 1),
    1n,
  );
  const reasons = [...row.reasons];
  let status: C611GroupedOracleSearch["status"] = "EXACT";
  if (row.outcome === "UNEVALUABLE") status = "UNEVALUABLE";
  if (input.crossGroupEvents.length) {
    status = "UNEVALUABLE";
    reasons.push("CROSS_GROUP_EVENT_COUPLING");
  }
  if (
    status === "EXACT" &&
    combinations > BigInt(C611_GROUPED_ORACLE_POLICY.maxCombinationsPerGroup)
  ) {
    status = "SEARCH_LIMIT";
    reasons.push("PRE_FROZEN_COMBINATION_LIMIT_EXCEEDED");
  }
  let searchedCombinations = 0,
    validCombinations = 0,
    rejectedCombinations = 0,
    assemblyErrorCombinations = 0;
  const rejectionReasons: Record<string, number> = {};
  const baselineGroup = baseline.filter((cue) => row.cueIds.includes(cue.id));
  const outsideGroup = baseline.filter((cue) => !row.cueIds.includes(cue.id));
  const goldText = row.goldCueIds
    .flatMap((id) => input.gold.filter((cue) => cue.id === id))
    .map((cue) => cue.text)
    .join("")
    .normalize("NFC");
  const normalizedGold = normalize(goldText);
  let best: BestObserved | null =
    row.baselineExactError === null || row.baselineNormalizedError === null
      ? null
      : {
          exactError: row.baselineExactError,
          normalizedError: row.baselineNormalizedError,
          selections: [],
          cueHash: hash(baselineGroup),
        };
  function reject(reason: string) {
    rejectedCombinations += 1;
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  }
  function evaluateSelection(selections: C611OracleSelection[]) {
    searchedCombinations += 1;
    if (!selections.length) {
      // KEEP_CURRENT is the frozen P0 itself; it cannot depend on a callback.
      validCombinations += 1;
      return;
    }
    let assembly: C611OracleAssembly;
    try {
      assembly = input.assemble(structuredClone(selections));
    } catch {
      input.assertInputsUnchanged();
      assemblyErrorCombinations += 1;
      return;
    }
    input.assertInputsUnchanged();
    if (assembly.blockedEventIds.length) {
      reject("RENDERER_BLOCKED_ASSIGNMENT");
      return;
    }
    let cues: C611EvaluationCue[];
    try {
      cues = c611CueViews(assembly.cues);
    } catch {
      reject("INVALID_CUE_STRUCTURE");
      return;
    }
    if (
      hash(cues.map((cue) => cue.id)) !== hash(baseline.map((cue) => cue.id)) ||
      c611TimingHash(cues) !== c611TimingHash(baseline)
    ) {
      reject("CUE_ID_ORDER_OR_TIMING_MUTATION");
      return;
    }
    if (
      hash(cues.filter((cue) => !row.cueIds.includes(cue.id))) !==
      hash(outsideGroup)
    ) {
      reject("OUTSIDE_FIXED_GROUP_MUTATION");
      return;
    }
    const groupCues = cues.filter((cue) => row.cueIds.includes(cue.id));
    const text = groupCues
      .map((cue) => cue.text)
      .join("")
      .normalize("NFC");
    const candidate = {
      exactError: distance(text, goldText),
      normalizedError: distance(normalize(text), normalizedGold),
      selections: structuredClone(selections),
      cueHash: hash(groupCues),
    };
    validCombinations += 1;
    if (!best || better(candidate, best)) best = candidate;
  }
  function enumerate(index: number, selections: C611OracleSelection[]) {
    if (index === input.choices.length) {
      evaluateSelection(selections);
      return;
    }
    const choice = c61Require(input.choices[index]);
    enumerate(index + 1, selections);
    for (const candidateId of choice.candidateIds) {
      selections.push({ eventId: choice.eventId, candidateId });
      enumerate(index + 1, selections);
      selections.pop();
    }
  }
  if (status === "EXACT") enumerate(0, []);
  if (assemblyErrorCombinations > 0) {
    status = "ASSEMBLY_ERROR";
    reasons.push("ASSEMBLY_EXCEPTION_LEAVES_OPTIMUM_UNKNOWN");
  }
  const exactBest = status === "EXACT" ? best : null;
  const body = {
    status,
    theoreticalCombinations: combinations.toString(),
    searchedCombinations,
    validCombinations,
    rejectedCombinations,
    assemblyErrorCombinations,
    rejectionReasons,
    bestExactError: exactBest?.exactError ?? null,
    bestNormalizedError: exactBest?.normalizedError ?? null,
    exactGain:
      exactBest && row.baselineExactError !== null
        ? row.baselineExactError - exactBest.exactError
        : null,
    normalizedGain:
      exactBest && row.baselineNormalizedError !== null
        ? row.baselineNormalizedError - exactBest.normalizedError
        : null,
    bestObservedExactError: best?.exactError ?? null,
    bestObservedNormalizedError: best?.normalizedError ?? null,
    bestObservedSelections: best?.selections ?? [],
    bestObservedCueHash: best?.cueHash ?? null,
    optimumBounds: exactBest ? ("EXACT_VALUE" as const) : ("UNKNOWN" as const),
    reasons: [...new Set(reasons)].sort(),
  };
  return { ...body, semanticHash: hash(body) };
}
function summarize(groups: C611GroupedOracleGroup[], kind: SearchKind) {
  const exact = groups.filter((group) => group[kind].status === "EXACT");
  const total = (getter: (row: C611GroupedOracleGroup) => number | null) =>
    exact.reduce((value, row) => value + (getter(row) ?? 0), 0);
  const baselineExactError = total((row) => row.currentExactError),
    baselineNormalizedError = total((row) => row.currentNormalizedError),
    bestExactError = total((row) => row[kind].bestExactError),
    bestNormalizedError = total((row) => row[kind].bestNormalizedError),
    goldExactGraphemeCount = total((row) => row.goldExactGraphemeCount),
    goldNormalizedGraphemeCount = total(
      (row) => row.goldNormalizedGraphemeCount,
    );
  return {
    exactGroups: exact.length,
    searchLimitGroups: groups.filter(
      (row) => row[kind].status === "SEARCH_LIMIT",
    ).length,
    unevaluableGroups: groups.filter(
      (row) => row[kind].status === "UNEVALUABLE",
    ).length,
    assemblyErrorGroups: groups.filter(
      (row) => row[kind].status === "ASSEMBLY_ERROR",
    ).length,
    entireFixedMapExact: groups.length > 0 && exact.length === groups.length,
    exactGroupCoverage: groups.length ? exact.length / groups.length : null,
    baselineExactError,
    baselineNormalizedError,
    bestExactError,
    bestNormalizedError,
    exactGain: baselineExactError - bestExactError,
    normalizedGain: baselineNormalizedError - bestNormalizedError,
    goldExactGraphemeCount,
    goldNormalizedGraphemeCount,
    baselineExactCer: goldExactGraphemeCount
      ? baselineExactError / goldExactGraphemeCount
      : null,
    baselineNormalizedCer: goldNormalizedGraphemeCount
      ? baselineNormalizedError / goldNormalizedGraphemeCount
      : null,
    bestExactCer: goldExactGraphemeCount
      ? bestExactError / goldExactGraphemeCount
      : null,
    bestNormalizedCer: goldNormalizedGraphemeCount
      ? bestNormalizedError / goldNormalizedGraphemeCount
      : null,
    searchedCombinations: groups.reduce(
      (value, row) => value + row[kind].searchedCombinations,
      0,
    ),
    validCombinations: groups.reduce(
      (value, row) => value + row[kind].validCombinations,
      0,
    ),
    rejectedCombinations: groups.reduce(
      (value, row) => value + row[kind].rejectedCombinations,
      0,
    ),
    errorAggregation: "UNIQUE_EXACT_FIXED_GROUPS_ONLY" as const,
  };
}

/** Gold-local diagnostic only. Joint assignments, never a sum of proposal gains. */
export function evaluateC611GroupedOracles(
  input: C611GroupedOracleInput,
): C611GroupedOracle {
  const { options, proposals } = sortedInputs(input);
  const baseline = c611CueViews(input.baselineCues),
    gold = c611OrderedGold(input.goldCues);
  const originalBaselineHash = hash(input.baselineCues),
    originalGoldHash = hash(input.goldCues);
  const assertInputsUnchanged = () => {
    if (
      hash(input.baselineCues) !== originalBaselineHash ||
      hash(input.goldCues) !== originalGoldHash
    )
      throw new Error("C611_ORACLE_INPUT_MUTATION");
  };
  const fixed = evaluateC611FixedAlignment({
    map: input.fixedMap,
    baselineCues: baseline,
    shadowCues: baseline,
    goldCues: gold,
    profileId: "ORACLE_KEEP_CURRENT",
  });
  if (!fixed.invariance.eligible)
    throw new Error("C611_ORACLE_FIXED_MAP_IDENTITY_INVALID");
  const eventGroups = c611EventFixedGroups(input.fixedMap);
  const groups: C611GroupedOracleGroup[] = fixed.groups.map((row) => {
    const choices = options
      .filter((option) => row.eventIds.includes(option.eventId))
      .map((option) => ({
        eventId: option.eventId,
        candidateIds: option.alternatives.map(
          (candidate) => candidate.candidateId,
        ),
      }));
    const primaryChoices = choices.map((choice) => ({
      eventId: choice.eventId,
      candidateIds: proposals.flatMap((proposal) =>
        proposal.eventId === choice.eventId &&
        proposal.eligible &&
        proposal.candidateId
          ? [proposal.candidateId]
          : [],
      ),
    }));
    const shared = {
      row,
      baseline,
      gold,
      assemble: input.assemble,
      assertInputsUnchanged,
    };
    const crossing = (values: typeof choices) =>
      values
        .filter(
          (choice) =>
            choice.candidateIds.length &&
            (eventGroups.get(choice.eventId)?.length ?? 0) > 1,
        )
        .map((choice) => choice.eventId);
    const body = {
      groupId: row.groupId,
      eventIds: row.eventIds,
      cueIds: row.cueIds,
      mappingStatus: row.mappingStatus,
      currentExactError: row.baselineExactError,
      currentNormalizedError: row.baselineNormalizedError,
      goldExactGraphemeCount: row.goldExactGraphemeCount,
      goldNormalizedGraphemeCount: row.goldNormalizedGraphemeCount,
      proposalOracle: searchGroup({
        ...shared,
        choices: primaryChoices,
        crossGroupEvents: crossing(primaryChoices),
      }),
      bestExistingCandidateOracle: searchGroup({
        ...shared,
        choices,
        crossGroupEvents: crossing(choices),
      }),
    };
    return { ...body, semanticHash: hash(body) };
  });
  assertInputsUnchanged();
  const body = {
    ...C611_EVALUATION_HEADER,
    artifactType: "c6-1-1-grouped-existing-candidate-oracles" as const,
    fixedMapHash: input.fixedMap.semanticHash,
    mappingSemanticHash: input.fixedMap.mappingSemanticHash,
    baselineCueHash: input.fixedMap.baselineCueHash,
    frozenAlternativeOptionsHash: hash(options),
    primaryProposalsHash: hash(proposals),
    oraclePolicy: C611_GROUPED_ORACLE_POLICY,
    oraclePolicyHash: hash(C611_GROUPED_ORACLE_POLICY),
    productionMutationCount: 0 as const,
    evaluationMethod: "FIXED_GROUP_JOINT_COMPLETE_CANDIDATE_SEARCH" as const,
    groups,
    summary: {
      totalCueGroups: groups.length,
      unmappedAlternativeEventIds: options
        .filter(
          (option) =>
            option.alternatives.length && !eventGroups.has(option.eventId),
        )
        .map((option) => option.eventId),
      unmappedPrimaryEventIds: proposals
        .filter(
          (proposal) => proposal.eligible && !eventGroups.has(proposal.eventId),
        )
        .map((proposal) => proposal.eventId),
      proposalOracle: summarize(groups, "proposalOracle"),
      bestExistingCandidateOracle: summarize(
        groups,
        "bestExistingCandidateOracle",
      ),
    },
  };
  return c611GroupedOracleSchema.parse({ ...body, semanticHash: hash(body) });
}
