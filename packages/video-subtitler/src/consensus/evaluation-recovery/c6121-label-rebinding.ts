/** Evaluation only. Raw Gold is confined to this module and joint scoring. */
import {
  c6121LabelsSchema,
  c6121StabilitySchema,
  type C6121Map,
  type C6121Supergroup,
  type C6121GroupScore,
  type C6121Labels,
  type C612Label,
  type SubtitlePackage,
} from "@mvl/shared";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import {
  normalize,
  materialText,
  legacyMaterialText,
  catastrophicDeletion,
  outcome,
  type C612EvaluationCue,
} from "../top-k/fixed-group-evaluation.js";
import { chars, editDistance } from "../top-k/c612-structural.js";
import { assembleC612WholeCandidates } from "../top-k/group-shadow-configurations.js";
import { c612Defined } from "../top-k/c612-policy.js";
import { c6121Artifact, demand, hash } from "./c6121-policy.js";

export function scoreC6121Supergroup(
  group: C6121Supergroup,
  production: SubtitlePackage,
  shadow: readonly C612EvaluationCue[],
  gold: readonly C612EvaluationCue[],
): C6121GroupScore {
  const select = (cues: readonly C612EvaluationCue[]) =>
    group.machineCueIds.map((id) => c612Defined(cues.find((c) => c.id === id)));
  const original = select(production.cues),
    selected = select(shadow);
  const timing = (cues: readonly C612EvaluationCue[]) =>
    cues.map((c) => [c.id, c.start, c.end]);
  demand(
    hash(timing(original)) === hash(timing(selected)) &&
      shadow.length === production.cues.length,
    "C6121_SHADOW_STRUCTURE_CHANGED",
  );
  const before = original
    .map((c) => c.text)
    .join("")
    .normalize("NFC");
  const text = selected
    .map((c) => c.text)
    .join("")
    .normalize("NFC");
  const targets = group.goldCueIds
    .map((id) => c612Defined(gold.find((c) => c.id === id)))
    .sort(
      (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
    );
  const target = targets
      .map((c) => c.text)
      .join("")
      .normalize("NFC"),
    eligible = group.shadowEvaluationEligible;
  const baselineExactError = eligible ? editDistance(before, target) : null;
  const baselineNormalizedError = eligible
    ? editDistance(normalize(before), normalize(target))
    : null;
  const exactError = eligible ? editDistance(text, target) : null;
  const normalizedError = eligible
    ? editDistance(normalize(text), normalize(target))
    : null;
  const exactGain = eligible
    ? c612Defined(baselineExactError) - c612Defined(exactError)
    : null;
  const normalizedGain = eligible
    ? c612Defined(baselineNormalizedError) - c612Defined(normalizedError)
    : null;
  return {
    supergroupId: group.supergroupId,
    machineGroupIds: group.machineGroupIds,
    goldCueIds: group.goldCueIds,
    foldId: group.foldId,
    changed: original.some((c, i) => c.text !== selected[i]?.text),
    evaluated: eligible,
    exactError,
    normalizedError,
    exactGain,
    normalizedGain,
    materialDelta: eligible
      ? materialText(text, target) - materialText(before, target)
      : null,
    legacyMaterialDelta: eligible
      ? legacyMaterialText(text, target) - legacyMaterialText(before, target)
      : null,
    catastrophicDeletion: eligible
      ? catastrophicDeletion(before, text, target)
      : null,
    baselineMaterial: eligible ? materialText(before, target) : null,
    baselineExactError,
    baselineNormalizedError,
    goldCharacterCount: eligible ? chars(normalize(target)).length : null,
    classification: outcome(normalizedGain),
    reasons: group.reasons,
  };
}

export function rebindC6121CandidateLabels(
  frozen: C612FrozenInputs,
  map: C6121Map,
  gold: readonly C612EvaluationCue[],
  goldByteHash: string,
): C6121Labels {
  const rows = frozen.ranks.rows.map((rank) => {
    const candidate = c612Defined(
      frozen.universe.candidates.find(
        (c) => c.candidateId === rank.candidateId,
      ),
    );
    const owners = frozen.mapping.groups.filter((g) =>
      g.eventIds.includes(rank.eventId),
    );
    const components = map.groups.filter((g) =>
      g.machineEventIds.includes(rank.eventId),
    );
    const group = components.length === 1 ? components[0] : undefined;
    const event = c612Defined(
      frozen.universe.events.find((e) => e.eventId === rank.eventId),
    );
    const fold = frozen.folds.folds.find((f) =>
      f.eventIds.includes(rank.eventId),
    );
    if (
      group?.oofTrainingEligible &&
      group.candidateEligibleEventIds.includes(rank.eventId)
    )
      demand(fold?.foldId === group.foldId, "C6121_SUPERGROUP_FOLD_MISMATCH");
    const current = rank.currentCandidate;
    const assembled =
      current || !rank.structuralEligible
        ? {
            cues: frozen.production.cues,
            eligible: current,
            reasons: current ? [] : ["STRUCTURAL_INELIGIBLE", ...rank.reasons],
          }
        : assembleC612WholeCandidates(frozen.production, frozen.universe, [
            { eventId: rank.eventId, candidateId: rank.candidateId },
          ]);
    const applicationEligible =
      assembled.eligible &&
      owners.length === 1 &&
      components.length === 1 &&
      !!group?.candidateEligibleEventIds.includes(rank.eventId) &&
      event.finalCueIds.every((id) => group.machineCueIds.includes(id));
    const eligible = applicationEligible && !!group?.candidateLabelEligible;
    const result = group
      ? scoreC6121Supergroup(group, frozen.production, assembled.cues, gold)
      : null;
    const known = eligible && result?.evaluated === true;
    const normalizedGain = known ? result.normalizedGain : null;
    const label: C612Label = {
      candidateId: rank.candidateId,
      eventId: rank.eventId,
      // The original trainer weights by machine group. Retaining this field is
      // essential to changing numeric labels only, not the training algorithm.
      groupId: owners.length === 1 ? c612Defined(owners[0]).groupId : null,
      foldId: fold?.foldId ?? null,
      current,
      eligible: known,
      reasons: known
        ? []
        : [
            ...new Set([
              ...assembled.reasons,
              ...(group?.reasons ?? ["NO_UNIQUE_EVALUATION_SUPERGROUP"]),
              ...(!applicationEligible ? ["CANDIDATE_LABEL_AMBIGUOUS"] : []),
              ...(components.length > 1 ||
              (group &&
                event.finalCueIds.some(
                  (id) => !group.machineCueIds.includes(id),
                ))
                ? ["CROSS_SUPERGROUP_CANDIDATE_APPLICATION"]
                : []),
              ...(owners.length !== 1
                ? ["EVENT_MACHINE_GROUP_OWNERSHIP_AMBIGUOUS"]
                : []),
            ]),
          ].sort(),
      baselineExactError: known ? result.baselineExactError : null,
      candidateExactError: known ? result.exactError : null,
      baselineNormalizedError: known ? result.baselineNormalizedError : null,
      candidateNormalizedError: known ? result.normalizedError : null,
      normalizedGain,
      exactGain: known ? result.exactGain : null,
      materialDelta: known ? result.materialDelta : null,
      catastrophicDeletion: known ? result.catastrophicDeletion : null,
      classification: outcome(normalizedGain),
      labelClass: !known
        ? "UNEVALUABLE"
        : result.catastrophicDeletion
          ? "CATASTROPHIC_REGRESSION"
          : c612Defined(normalizedGain) > 0
            ? "IMPROVES_CURRENT"
            : c612Defined(normalizedGain) < 0
              ? "REGRESSES_FROM_CURRENT"
              : "EQUIVALENT_TO_CURRENT",
      labelRole: "DIAGNOSTIC_LOCAL_COUNTERFACTUAL",
      topKProfiles: frozen.topK.sets
        .filter(
          (s) =>
            s.eventId === rank.eventId &&
            (s.currentCandidateId === rank.candidateId ||
              s.alternativeIds.includes(rank.candidateId)),
        )
        .map((s) => s.profile),
      oracleRank: null,
    };
    return {
      candidateId: candidate.candidateId,
      eventId: rank.eventId,
      machineGroupIds: owners.map((g) => g.groupId),
      supergroupId: group?.supergroupId ?? null,
      foldId: fold?.foldId ?? null,
      applicationCueIds: event.finalCueIds,
      applicationEligible,
      oofTrainingEligible:
        known && group.oofTrainingEligible && fold?.foldId === group.foldId,
      label,
    };
  });
  for (const eventId of [...new Set(rows.map((r) => r.eventId))]) {
    const ordered = rows
      .filter((r) => r.eventId === eventId && r.label.eligible)
      .map((r) => r.label)
      .sort(
        (a, b) =>
          c612Defined(a.candidateNormalizedError) -
            c612Defined(b.candidateNormalizedError) ||
          Number(b.current) - Number(a.current) ||
          a.candidateId.localeCompare(b.candidateId),
      );
    ordered.forEach((label, index) => {
      label.oracleRank = index + 1;
      if (
        label.candidateNormalizedError === ordered[0]?.candidateNormalizedError
      )
        label.labelClass = "ORACLE_BEST";
    });
  }
  return c6121LabelsSchema.parse(
    c6121Artifact("gold-c6-1-2-1-supergroup-candidate-labels", {
      supergroupMapHash: map.semanticHash,
      goldByteHash,
      labels: rows.sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
      rawGoldTextIncluded: false,
      labelsFedToRuntimeInference: false,
    }),
  );
}

export function auditC6121LabelStability(
  old: readonly C612Label[],
  fresh: C6121Labels,
) {
  const pairs = fresh.labels.map((row) => ({
    row,
    previous: c612Defined(old.find((l) => l.candidateId === row.candidateId)),
  }));
  const common = pairs.filter(
    (p) => p.previous.eligible && p.row.label.eligible,
  );
  const sign = (gain: number | null) =>
    gain === null ? null : Math.sign(gain);
  const disagreements = common.filter(
    ({ previous: a, row: { label: b } }) =>
      a.classification !== b.classification ||
      sign(a.exactGain) !== sign(b.exactGain) ||
      sign(a.normalizedGain) !== sign(b.normalizedGain) ||
      a.catastrophicDeletion !== b.catastrophicDeletion,
  );
  return c6121StabilitySchema.parse(
    c6121Artifact("c6-1-2-1-label-stability-audit", {
      oldEvaluableCandidateLabels: old.filter((l) => l.eligible).length,
      newEvaluableCandidateLabels: fresh.labels.filter((l) => l.label.eligible)
        .length,
      newlyRecoveredCandidateLabels: pairs.filter(
        (p) => !p.previous.eligible && p.row.label.eligible,
      ).length,
      previouslyEvaluableNowLost: pairs.filter(
        (p) => p.previous.eligible && !p.row.label.eligible,
      ).length,
      stillUnevaluableCandidateLabels: pairs.filter(
        (p) => !p.previous.eligible && !p.row.label.eligible,
      ).length,
      commonEvaluableCount: common.length,
      exactLabelAgreementCount: common.length - disagreements.length,
      gainDirectionAgreementCount: common.filter(
        (p) =>
          sign(p.previous.normalizedGain) === sign(p.row.label.normalizedGain),
      ).length,
      exactGainDirectionAgreementCount: common.filter(
        (p) => sign(p.previous.exactGain) === sign(p.row.label.exactGain),
      ).length,
      catastrophicAgreementCount: common.filter(
        (p) =>
          p.previous.catastrophicDeletion === p.row.label.catastrophicDeletion,
      ).length,
      disagreementCount: disagreements.length,
      disagreementRows: disagreements.map(({ previous, row }) => ({
        candidateId: row.candidateId,
        eventId: row.eventId,
        oldGroupId: previous.groupId,
        supergroupId: row.supergroupId,
        oldClass: previous.classification,
        newClass: row.label.classification,
        oldGain: previous.normalizedGain,
        newGain: row.label.normalizedGain,
        oldExactGain: previous.exactGain,
        newExactGain: row.label.exactGain,
        reason:
          c612Defined(previous.normalizedGain) *
            c612Defined(row.label.normalizedGain) <
          0
            ? "EVALUATOR_LABEL_DIRECTION_DISAGREEMENT"
            : "EVALUATOR_LABEL_SEMANTICS_CHANGED_NO_CANDIDATE_CHANGE",
      })),
    }),
  );
}
