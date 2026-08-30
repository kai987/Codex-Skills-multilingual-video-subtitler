import {
  c611EvaluationCueSchema,
  c611FixedAlignmentEvaluationSchema,
  c611FixedBaselineAlignmentMapSchema,
  c611ProposalLabelsSchema,
  type C611EvaluationCue,
  type C611FixedBaselineAlignmentMap,
  type C611FixedAlignmentEvaluation,
  type C611FixedGroupEvaluation,
  type C611FixedInvariance,
  type C611ProposalLabels,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { c61Graphemes } from "./japanese-text-representation.js";
import {
  c61EvaluationEditDistance as distance,
  normalizeC61EvaluationText as normalize,
} from "./consensus-oracle-evaluator.js";
import {
  buildC611FixedBaselineAlignmentMap,
  c611CueViews,
  c611OrderedGold,
  c611TimingHash,
  c611TextHash,
  c611StableMapping,
  c611MappingContent,
  c611EventFixedGroups,
  C611_EVALUATION_HEADER,
} from "./fixed-baseline-alignment-map.js";

function validHash(value: { semanticHash: string }): boolean {
  const { semanticHash, ...body } = value;
  return hash(body) === semanticHash;
}
function projectShadow(
  cues: readonly C611EvaluationCue[],
): C611EvaluationCue[] {
  return cues.map(({ id, start, end, text }) =>
    c611EvaluationCueSchema.parse({ id, start, end, text }),
  );
}
/** Rejects forged map topology even if its unkeyed semantic hashes were redone. */
export function verifyC611FixedMap(
  map: C611FixedBaselineAlignmentMap,
  baseline: readonly C611EvaluationCue[],
  gold: readonly C611EvaluationCue[],
): boolean {
  const rebuilt = buildC611FixedBaselineAlignmentMap({
    baselineCues: baseline,
    goldCues: gold,
    eventBindings: [],
    policy: map.mappingPolicy,
    barrier: {
      machineFreezeHash: map.machineFreezeHash,
      machineFrozenAt: map.machineFrozenAt,
      goldFirstReadAt: map.goldFirstReadAt,
    },
  });
  const topology = (value: C611FixedBaselineAlignmentMap) =>
    value.groups.map(({ machineEventIds, semanticHash, ...group }) => {
      void machineEventIds;
      void semanticHash;
      return group;
    });
  return (
    validHash(map) &&
    map.groups.every(validHash) &&
    map.mappingPolicyHash === hash(map.mappingPolicy) &&
    map.mappingSemanticHash === hash(c611MappingContent(map)) &&
    hash(topology(map)) === hash(topology(rebuilt)) &&
    hash(map.summary) === hash(rebuilt.summary) &&
    hash(map.unmappedGoldCueIds) === hash(rebuilt.unmappedGoldCueIds)
  );
}
export function evaluateC611FixedAlignment(input: {
  map: C611FixedBaselineAlignmentMap;
  baselineCues: readonly C611EvaluationCue[];
  shadowCues: readonly C611EvaluationCue[];
  goldCues: readonly C611EvaluationCue[];
  profileId: string;
}): C611FixedAlignmentEvaluation {
  const map = c611FixedBaselineAlignmentMapSchema.parse(input.map);
  const baseline = c611CueViews(input.baselineCues),
    gold = c611OrderedGold(input.goldCues),
    shadow = projectShadow(input.shadowCues);
  const baselineIds = baseline.map((c) => c.id),
    shadowIds = shadow.map((c) => c.id);
  const mappingIntegrityParity = verifyC611FixedMap(map, baseline, gold);
  const invarianceBody = {
    cueIdSetParity:
      new Set(shadowIds).size === shadowIds.length &&
      hash([...baselineIds].sort()) === hash([...shadowIds].sort()),
    cueOrderParity: hash(baselineIds) === hash(shadowIds),
    timingParity: c611TimingHash(shadow) === map.baselineTimingHash,
    groupStructureParity:
      hash(map.groups.flatMap((g) => g.machineCueIds)) === hash(baselineIds) &&
      map.groups.every((g) =>
        g.machineCueIndexes.every(
          (i, n) => shadowIds[i] === g.machineCueIds[n],
        ),
      ),
    baselineIdentityParity:
      hash(baseline) === map.baselineCueHash &&
      c611TimingHash(baseline) === map.baselineTimingHash &&
      hash(baselineIds) === hash(map.baselineCueOrder),
    goldIdentityParity:
      hash(gold) === map.goldCueHash &&
      hash(gold.map((c) => c.id)) === hash(map.goldCueOrder),
    mappingIntegrityParity,
  };
  const reasons = Object.entries(invarianceBody)
    .filter(([, passed]) => !passed)
    .map(([name]) => `INVARIANCE_${name.toUpperCase()}`);
  const invariance: C611FixedInvariance = {
    ...invarianceBody,
    eligible: reasons.length === 0,
    reasons,
  };
  const groups: C611FixedGroupEvaluation[] = map.groups.map((group) => {
    const baselineCues = group.machineCueIds.flatMap((id) =>
      baseline.filter((c) => c.id === id),
    );
    const shadowCues = group.machineCueIds.flatMap((id) =>
      shadow.filter((c) => c.id === id),
    );
    const goldCues = group.goldCueIds.flatMap((id) =>
      gold.filter((c) => c.id === id),
    );
    const baselineText = baselineCues
      .map((c) => c.text)
      .join("")
      .normalize("NFC");
    const shadowText = shadowCues
      .map((c) => c.text)
      .join("")
      .normalize("NFC");
    const goldText = goldCues
      .map((c) => c.text)
      .join("")
      .normalize("NFC");
    const eligible =
      invariance.eligible && c611StableMapping(group.mappingStatus);
    const baselineExactError = eligible
      ? distance(baselineText, goldText)
      : null;
    const shadowExactError = eligible ? distance(shadowText, goldText) : null;
    const baselineNormalizedError = eligible
      ? distance(normalize(baselineText), normalize(goldText))
      : null;
    const shadowNormalizedError = eligible
      ? distance(normalize(shadowText), normalize(goldText))
      : null;
    const normalizedGain =
      baselineNormalizedError === null || shadowNormalizedError === null
        ? null
        : baselineNormalizedError - shadowNormalizedError;
    const body = {
      groupId: group.groupId,
      eventIds: group.machineEventIds,
      cueIds: group.machineCueIds,
      goldCueIds: group.goldCueIds,
      mappingStatus: invariance.eligible
        ? group.mappingStatus
        : ("STRUCTURE_INCOMPATIBLE" as const),
      changed: c611TextHash(baselineCues) !== c611TextHash(shadowCues),
      baselineTextHash: c611TextHash(baselineCues),
      shadowTextHash: c611TextHash(shadowCues),
      baselineExactError,
      baselineNormalizedError,
      shadowExactError,
      shadowNormalizedError,
      goldExactGraphemeCount: eligible ? c61Graphemes(goldText).length : null,
      goldNormalizedGraphemeCount: eligible
        ? c61Graphemes(normalize(goldText)).length
        : null,
      exactGain:
        baselineExactError === null || shadowExactError === null
          ? null
          : baselineExactError - shadowExactError,
      normalizedGain,
      outcome:
        normalizedGain === null
          ? ("UNEVALUABLE" as const)
          : normalizedGain > 0
            ? ("IMPROVED" as const)
            : normalizedGain < 0
              ? ("REGRESSED" as const)
              : ("NEUTRAL" as const),
      reasons: eligible
        ? []
        : [...invariance.reasons, ...group.ambiguityReasons],
    };
    return { ...body, semanticHash: hash(body) };
  });
  const sum = (
    key:
      | "baselineExactError"
      | "baselineNormalizedError"
      | "shadowExactError"
      | "shadowNormalizedError"
      | "exactGain"
      | "normalizedGain"
      | "goldExactGraphemeCount"
      | "goldNormalizedGraphemeCount",
  ) => groups.reduce((total, row) => total + (row[key] ?? 0), 0);
  const evaluable = groups.filter((g) => g.outcome !== "UNEVALUABLE").length;
  const changed = groups.filter((g) => g.changed).length;
  const mappedChanged = groups.filter(
    (g) => g.changed && g.outcome !== "UNEVALUABLE",
  ).length;
  const exactCount = sum("goldExactGraphemeCount"),
    normalizedCount = sum("goldNormalizedGraphemeCount");
  const summary = {
    totalCueGroups: groups.length,
    changedCueGroups: changed,
    stableMappedGroups: groups.filter((g) => c611StableMapping(g.mappingStatus))
      .length,
    ambiguousGroups: groups.filter(
      (g) => g.mappingStatus === "AMBIGUOUS_BASELINE_MAPPING",
    ).length,
    unmappedGroups: groups.filter(
      (g) => g.mappingStatus === "NO_BASELINE_MAPPING",
    ).length,
    structureIncompatibleGroups: groups.filter(
      (g) => g.mappingStatus === "STRUCTURE_INCOMPATIBLE",
    ).length,
    fixedMappedChangedGroupCount: mappedChanged,
    evaluableGroups: evaluable,
    improvedGroups: groups.filter((g) => g.outcome === "IMPROVED").length,
    regressedGroups: groups.filter((g) => g.outcome === "REGRESSED").length,
    neutralGroups: groups.filter((g) => g.outcome === "NEUTRAL").length,
    unevaluableGroups: groups.length - evaluable,
    fixedEvaluationCoverage: groups.length ? evaluable / groups.length : null,
    changedGroupCoverage: changed ? mappedChanged / changed : null,
    baselineExactError: sum("baselineExactError"),
    baselineNormalizedError: sum("baselineNormalizedError"),
    shadowExactError: sum("shadowExactError"),
    shadowNormalizedError: sum("shadowNormalizedError"),
    exactGain: sum("exactGain"),
    normalizedGain: sum("normalizedGain"),
    goldExactGraphemeCount: exactCount,
    goldNormalizedGraphemeCount: normalizedCount,
    baselineExactCer: exactCount
      ? sum("baselineExactError") / exactCount
      : null,
    baselineNormalizedCer: normalizedCount
      ? sum("baselineNormalizedError") / normalizedCount
      : null,
    shadowExactCer: exactCount ? sum("shadowExactError") / exactCount : null,
    shadowNormalizedCer: normalizedCount
      ? sum("shadowNormalizedError") / normalizedCount
      : null,
  };
  const body = {
    ...C611_EVALUATION_HEADER,
    artifactType: "c6-1-1-fixed-alignment-evaluation" as const,
    evaluationMethod: "FIXED_GROUP_EVALUATION" as const,
    errorUnit: "GRAPHEME_EDIT_COUNT_UNIQUE_CUE_GROUP" as const,
    profileId: input.profileId,
    fixedMapHash: map.semanticHash,
    mappingSemanticHash: map.mappingSemanticHash,
    baselineCueHash: map.baselineCueHash,
    shadowCueHash: hash(shadow),
    invariance,
    groups,
    summary,
  };
  return c611FixedAlignmentEvaluationSchema.parse({
    ...body,
    semanticHash: hash(body),
  });
}

export interface C611ProposalCounterfactual {
  proposalId: string;
  eventId: string;
  candidateId: string | null;
  shadowCues: readonly C611EvaluationCue[];
  eligibilityReasons?: readonly string[];
}
export interface C611ProposalFold {
  proposalId: string;
  foldId: string;
}
export function c611FixedGroupFoldMembership(input: {
  map: C611FixedBaselineAlignmentMap;
  proposals: readonly Pick<
    C611ProposalCounterfactual,
    "proposalId" | "eventId"
  >[];
  proposalFolds: readonly C611ProposalFold[];
}): Map<string, string[]> {
  const folds = new Map(
    input.proposalFolds.map((row) => [row.proposalId, row.foldId]),
  );
  if (folds.size !== input.proposalFolds.length)
    throw new Error("C611_DUPLICATE_PROPOSAL_FOLD");
  return new Map(
    input.map.groups.map((group) => [
      group.groupId,
      [
        ...new Set(
          input.proposals
            .filter((p) => group.machineEventIds.includes(p.eventId))
            .flatMap((p) => {
              const fold = folds.get(p.proposalId);
              return fold ? [fold] : [];
            }),
        ),
      ].sort(),
    ]),
  );
}
/** Labels one frozen proposal at a time against unchanged P0 group context.
 * Several proposals in one group are correlated counterfactuals, not additive
 * error observations. Their group IDs must never straddle pre-frozen folds.
 */
export function evaluateC611ProposalCounterfactuals(input: {
  map: C611FixedBaselineAlignmentMap;
  baselineCues: readonly C611EvaluationCue[];
  goldCues: readonly C611EvaluationCue[];
  proposals: readonly C611ProposalCounterfactual[];
  proposalFolds: readonly C611ProposalFold[];
  proposalSetHash: string;
}): C611ProposalLabels {
  if (
    new Set(input.proposals.map((p) => p.proposalId)).size !==
    input.proposals.length
  )
    throw new Error("C611_DUPLICATE_PROPOSAL");
  const membership = c611FixedGroupFoldMembership(input),
    events = c611EventFixedGroups(input.map);
  const folds = new Map(
    input.proposalFolds.map((p) => [p.proposalId, p.foldId]),
  );
  const labels = input.proposals
    .toSorted((a, b) => a.proposalId.localeCompare(b.proposalId))
    .map((proposal) => {
      const result = evaluateC611FixedAlignment({
        ...input,
        shadowCues: proposal.shadowCues,
        profileId: `counterfactual:${proposal.proposalId}`,
      });
      const groupIds = events.get(proposal.eventId) ?? [];
      const groupResults = result.groups.filter((g) =>
        groupIds.includes(g.groupId),
      );
      const reasons = [...(proposal.eligibilityReasons ?? [])];
      if (!proposal.candidateId) reasons.push("NO_FROZEN_EXISTING_ALTERNATIVE");
      if (!folds.has(proposal.proposalId))
        reasons.push("MISSING_PRE_FROZEN_PROPOSAL_FOLD");
      if (
        input.proposals.some(
          (other) =>
            (events.get(other.eventId) ?? []).some((id) =>
              groupIds.includes(id),
            ) && !folds.has(other.proposalId),
        )
      )
        reasons.push("FIXED_GROUP_MISSING_FOLD_MEMBERSHIP");
      if (!groupIds.length) reasons.push("NO_FIXED_GROUP_FOR_EVENT");
      if (groupIds.some((id) => (membership.get(id)?.length ?? 0) > 1))
        reasons.push("FIXED_GROUP_CROSSES_FOLDS");
      if (result.groups.some((g) => g.changed && !groupIds.includes(g.groupId)))
        reasons.push("COUNTERFACTUAL_CHANGED_UNRELATED_GROUP");
      if (!result.invariance.eligible)
        reasons.push(...result.invariance.reasons);
      if (groupResults.some((g) => g.outcome === "UNEVALUABLE"))
        reasons.push("FIXED_GROUP_UNEVALUABLE");
      const eligible = reasons.length === 0;
      const sum = (
        key:
          | "baselineNormalizedError"
          | "shadowNormalizedError"
          | "exactGain"
          | "normalizedGain",
      ) =>
        eligible ? groupResults.reduce((n, g) => n + (g[key] ?? 0), 0) : null;
      const normalizedGain = sum("normalizedGain");
      const body = {
        proposalId: proposal.proposalId,
        eventId: proposal.eventId,
        candidateId: proposal.candidateId,
        groupIds,
        groupIdentityHash: hash(
          groupIds.map(
            (id) =>
              input.map.groups.find((g) => g.groupId === id)?.semanticHash,
          ),
        ),
        counterfactualHash: result.shadowCueHash,
        outcome:
          normalizedGain === null
            ? ("SWITCH_UNEVALUABLE" as const)
            : normalizedGain > 0
              ? ("SWITCH_IMPROVES" as const)
              : normalizedGain < 0
                ? ("SWITCH_REGRESSES" as const)
                : ("SWITCH_NEUTRAL" as const),
        baselineError: sum("baselineNormalizedError"),
        proposedError: sum("shadowNormalizedError"),
        exactGain: sum("exactGain"),
        normalizedGain,
        reasons: [...new Set(reasons)].sort(),
        groupResults,
      };
      return { ...body, semanticHash: hash(body) };
    });
  const body = {
    ...C611_EVALUATION_HEADER,
    artifactType: "gold-selective-existing-candidate-labels" as const,
    proposalSetHash: input.proposalSetHash,
    fixedMapHash: input.map.semanticHash,
    foldMembershipHash: hash([...membership]),
    labels,
    summary: {
      totalProposals: labels.length,
      improved: labels.filter((l) => l.outcome === "SWITCH_IMPROVES").length,
      regressed: labels.filter((l) => l.outcome === "SWITCH_REGRESSES").length,
      neutral: labels.filter((l) => l.outcome === "SWITCH_NEUTRAL").length,
      unevaluable: labels.filter((l) => l.outcome === "SWITCH_UNEVALUABLE")
        .length,
      fixedGroupCrossFoldCount: [...membership.values()].filter(
        (folds) => folds.length > 1,
      ).length,
      uniqueEvaluableGroups: new Set(
        labels
          .filter((l) => l.outcome !== "SWITCH_UNEVALUABLE")
          .flatMap((l) => l.groupIds),
      ).size,
      groupErrorAggregation:
        "NO_SUMMATION_OF_CORRELATED_PROPOSAL_COUNTERFACTUAL_ERRORS" as const,
    },
  };
  return c611ProposalLabelsSchema.parse({ ...body, semanticHash: hash(body) });
}
