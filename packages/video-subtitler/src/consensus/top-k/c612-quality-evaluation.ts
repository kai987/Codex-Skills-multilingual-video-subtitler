import {
  c612CvSchema,
  c612FailureSchema,
  c612ContractionEvaluationSchema,
  c612AblationsSchema,
  c612GroupConfigurationLabelsSchema,
  type C612Label,
  type C612GoldBinding,
  type C612Ranking,
  type C612GroupDecision,
  type C612Configuration,
  type C612GroupEvaluation,
  type C612Metrics,
} from "@mvl/shared";
import type { C612FrozenInputs } from "./c612-frozen-inputs.js";
import {
  evaluateGroupText,
  rankingQuality,
  outcome,
  type C612EvaluationCue,
} from "./fixed-group-evaluation.js";
import { artifact, ratio, c612Defined } from "./c612-policy.js";
import { assembleC612WholeCandidates } from "./group-shadow-configurations.js";
export function evaluateC612Quality(input: {
  frozen: C612FrozenInputs;
  gold: readonly C612EvaluationCue[];
  bindings: readonly C612GoldBinding[];
  goldBindingHash: string;
  labels: readonly C612Label[];
  rankings: readonly C612Ranking[];
  rankingsHash: string;
  decisions: readonly C612GroupDecision[];
  decisionsHash: string;
  configurations: readonly C612Configuration[];
  configurationsHash: string;
}) {
  const s = input.frozen,
    local = {
      evaluationOnly: true as const,
      privacy: "LOCAL_ONLY" as const,
      machineFreezeHash: s.freeze.semanticHash,
    };
  const groupResults: C612GroupEvaluation[] = [];
  const profiles = [...new Set(input.rankings.map((r) => r.profileId))].sort();
  const configurationLabels = input.configurations.map((config) => {
    const group = c612Defined(
        s.mapping.groups.find((g) => g.groupId === config.groupId),
      ),
      binding = c612Defined(
        input.bindings.find((b) => b.groupId === config.groupId),
      );
    const assembled = assembleC612WholeCandidates(
        s.production,
        s.universe,
        config.selections,
      ),
      result = evaluateGroupText(
        group,
        binding,
        assembled.cues,
        s.production.cues,
        input.gold,
      );
    const eligible = assembled.eligible && result.normalizedGain !== null;
    return {
      configurationId: config.configurationId,
      groupId: config.groupId,
      profileId: config.profileId,
      eligible,
      exactGain: eligible ? result.exactGain : null,
      normalizedGain: eligible ? result.normalizedGain : null,
      materialDelta: eligible ? result.materialDelta : null,
      catastrophicDeletion: eligible ? result.catastrophic : null,
      labelRole: "GROUP_JOINT_COUNTERFACTUAL" as const,
    };
  });
  for (const profileId of profiles) {
    const decisions = input.decisions.filter((d) => d.profileId === profileId),
      selections = decisions.flatMap((d) => d.selections);
    const assembled = assembleC612WholeCandidates(
      s.production,
      s.universe,
      selections,
    );
    if (!assembled.eligible)
      throw new Error("C612_JOINT_SELECTED_ASSEMBLY_FAILED");
    for (const group of s.mapping.groups) {
      const binding = c612Defined(
          input.bindings.find((b) => b.groupId === group.groupId),
        ),
        decision = decisions.find((d) => d.groupId === group.groupId);
      const evaluated = evaluateGroupText(
        group,
        binding,
        assembled.cues,
        s.production.cues,
        input.gold,
      );
      groupResults.push({
        profileId,
        foldId:
          decision?.foldId ??
          s.folds.folds.find((f) => f.groupIds.includes(group.groupId))
            ?.foldId ??
          null,
        groupId: group.groupId,
        changed: decision?.changed ?? false,
        evaluated: evaluated.normalizedGain !== null,
        selectedEvents: decision?.selections.length ?? 0,
        exactGain: evaluated.exactGain,
        normalizedGain: evaluated.normalizedGain,
        materialDelta: evaluated.materialDelta,
        catastrophicDeletion: evaluated.catastrophic,
        classification: outcome(evaluated.normalizedGain),
        reasons: binding.reasons,
      });
    }
  }
  function metrics(profileId: string, foldId: string | null): C612Metrics {
    const ranks = input.rankings.filter(
        (r) =>
          r.profileId === profileId && (foldId === null || r.foldId === foldId),
      ),
      results = groupResults.filter(
        (g) =>
          g.profileId === profileId && (foldId === null || g.foldId === foldId),
      );
    const changed = results.filter((r) => r.changed),
      evaluatedChanged = changed.filter((r) => r.evaluated),
      improved = evaluatedChanged.filter(
        (r) => c612Defined(r.normalizedGain) > 0,
      ).length,
      regressed = evaluatedChanged.filter(
        (r) => c612Defined(r.normalizedGain) < 0,
      ).length,
      neutral = evaluatedChanged.filter((r) => r.normalizedGain === 0).length;
    const ranked = ranks.flatMap((r) => {
      const q = rankingQuality(
        r.ranked.map((c) => c.candidateId),
        input.labels,
      );
      return q ? [q] : [];
    });
    const ndcg = ranked.flatMap((q) => (q.ndcg4 === null ? [] : [q.ndcg4]));
    const active = s.folds.folds.filter((f) =>
        changed.some((c) => c.foldId === f.foldId),
      ),
      negative = active.filter(
        (f) =>
          evaluatedChanged
            .filter((c) => c.foldId === f.foldId)
            .reduce((n, r) => n + c612Defined(r.normalizedGain), 0) < 0,
      ),
      unknown = active.filter((f) =>
        changed.some((c) => c.foldId === f.foldId && !c.evaluated),
      );
    const oracle = s.mapping.groups
      .filter((g) => results.some((r) => r.groupId === g.groupId))
      .reduce(
        (n, g) =>
          n +
          Math.max(
            0,
            ...configurationLabels
              .filter((c) => c.groupId === g.groupId && c.eligible)
              .map((c) => c612Defined(c.normalizedGain)),
          ),
        0,
      );
    const joint = !changed.length
      ? 0
      : evaluatedChanged.length
        ? evaluatedChanged.reduce(
            (n, r) => n + c612Defined(r.normalizedGain),
            0,
          )
        : null;
    let localTop1PositiveGain = 0,
      localTopKOracleGain = 0,
      localFullExistingOracleGain = 0;
    for (const r of ranks) {
      const labels = input.labels.filter(
          (l) => l.eventId === r.eventId && l.eligible,
        ),
        current = labels.find((l) => l.current);
      if (!current) continue;
      const top = labels.find((l) => l.candidateId === r.proposedCandidateId),
        retrieved = labels.filter((l) =>
          r.ranked.some((c) => c.candidateId === l.candidateId),
        );
      localTop1PositiveGain += Math.max(0, top?.normalizedGain ?? 0);
      localTopKOracleGain += Math.max(
        0,
        ...retrieved.map((l) => c612Defined(l.normalizedGain)),
      );
      localFullExistingOracleGain += Math.max(
        0,
        ...labels.map((l) => c612Defined(l.normalizedGain)),
      );
    }
    const eligibleGroupCount = results.filter(
      (r) =>
        r.evaluated &&
        c612Defined(
          s.mapping.groups.find((g) => g.groupId === r.groupId),
        ).eventIds.some((id) => ranks.some((r) => r.eventId === id)),
    ).length;
    const top1Accuracy = ranked.length
      ? ranked.reduce((n, q) => n + q.accuracy, 0) / ranked.length
      : null;
    return {
      profileId,
      foldId,
      eligibleEvents: ranks.length,
      evaluatedRankings: ranked.length,
      top1Accuracy,
      top1OracleHitRate: top1Accuracy,
      mrr: ranked.length
        ? ranked.reduce((n, q) => n + q.reciprocalRank, 0) / ranked.length
        : null,
      ndcg4: ndcg.length ? ndcg.reduce((a, b) => a + b, 0) / ndcg.length : null,
      selectedEvents: results.reduce((n, r) => n + r.selectedEvents, 0),
      selectedGroups: changed.length,
      evaluatedChangedGroups: evaluatedChanged.length,
      improved,
      regressed,
      neutral,
      unknown: changed.length - evaluatedChanged.length,
      precision: ratio(improved, improved + regressed),
      harm: ratio(regressed, evaluatedChanged.length),
      coverage: ratio(evaluatedChanged.length, eligibleGroupCount),
      eventSelectionCoverage: ratio(
        results.reduce((n, r) => n + r.selectedEvents, 0),
        ranks.length,
      ),
      allGroupEvaluationCoverage: ratio(
        results.filter((r) => r.evaluated).length,
        results.length,
      ),
      changedGroupEvaluationCoverage: ratio(
        evaluatedChanged.length,
        changed.length,
      ),
      selectedGroupEvaluationCoverage: ratio(
        evaluatedChanged.length,
        changed.length,
      ),
      exactJointGain: !changed.length
        ? 0
        : evaluatedChanged.length
          ? evaluatedChanged.reduce((n, r) => n + c612Defined(r.exactGain), 0)
          : null,
      normalizedJointGain: joint,
      materialDelta: !changed.length
        ? 0
        : evaluatedChanged.length
          ? evaluatedChanged.reduce(
              (n, r) => n + c612Defined(r.materialDelta),
              0,
            )
          : null,
      catastrophicDeletions: evaluatedChanged.filter(
        (r) => r.catastrophicDeletion,
      ).length,
      activeFolds: active.length,
      negativeGainFolds: negative.length,
      unknownGainFolds: unknown.length,
      oracleCapture: joint !== null && oracle > 0 ? joint / oracle : null,
      top1OracleCapture: ratio(localTop1PositiveGain, localTopKOracleGain),
      top1FullPoolOracleCapture: ratio(
        localTop1PositiveGain,
        localFullExistingOracleGain,
      ),
      candidateOracleCapture: ratio(
        localTopKOracleGain,
        localFullExistingOracleGain,
      ),
      localTop1PositiveGain,
      localTopKOracleGain,
      localFullExistingOracleGain,
      localOracleUnit: "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
      eligibleGroupCount,
    };
  }
  const profileMetrics = profiles.map((p) => metrics(p, null)),
    foldMetrics = profiles.flatMap((p) =>
      s.folds.folds.map((f) => metrics(p, f.foldId)),
    );
  const bestObserved =
    profileMetrics
      .filter(
        (p) => /^L[0-8]$/.test(p.profileId) && p.normalizedJointGain !== null,
      )
      .sort(
        (a, b) =>
          c612Defined(b.normalizedJointGain) -
            c612Defined(a.normalizedJointGain) ||
          a.regressed - b.regressed ||
          a.profileId.localeCompare(b.profileId),
      )[0]?.profileId ?? null;
  const cv = c612CvSchema.parse(
    artifact("c6-1-2-cv-results", {
      ...local,
      foldHash: s.folds.semanticHash,
      mappingHash: s.mapping.semanticHash,
      rankingsHash: input.rankingsHash,
      groupDecisionsHash: input.decisionsHash,
      profiles: profileMetrics.filter((p) => /^L[0-8]$/.test(p.profileId)),
      folds: foldMetrics,
      groupResults,
      metricAuthority: "UNIQUE_FIXED_CUE_GROUP_JOINT_ASSEMBLED_SHADOW",
      eventCounterfactualSumIsJointGain: false,
      bestGoldFreeProfile: "L6",
      bestProfileSelectedBeforeGold: true,
      bestObservedProfilePostHoc: bestObserved,
    }),
  );
  const failureRows = input.rankings
    .filter((r) => /^L[0-8]$/.test(r.profileId))
    .map((r) => {
      const labels = input.labels.filter(
          (l) => l.eventId === r.eventId && l.eligible,
        ),
        current = labels.find((l) => l.current),
        oracle = labels.toSorted(
          (a, b) =>
            c612Defined(a.candidateNormalizedError) -
              c612Defined(b.candidateNormalizedError) ||
            Number(b.current) - Number(a.current) ||
            a.candidateId.localeCompare(b.candidateId),
        )[0];
      const chosen =
        input.decisions
          .find(
            (d) =>
              d.profileId === r.profileId &&
              d.selections.some((s) => s.eventId === r.eventId),
          )
          ?.selections.find((s) => s.eventId === r.eventId)?.candidateId ??
        r.currentCandidateId;
      const proposed = labels.find(
          (l) => l.candidateId === r.proposedCandidateId,
        ),
        selected = labels.find((l) => l.candidateId === chosen),
        retrievable = labels.some(
          (l) =>
            r.ranked.some((c) => c.candidateId === l.candidateId) &&
            l.candidateNormalizedError === oracle?.candidateNormalizedError,
        );
      const category =
        !current || !oracle
          ? "EVALUATION_UNAVAILABLE"
          : c612Defined(oracle.candidateNormalizedError) >=
              c612Defined(current.candidateNormalizedError)
            ? "NO_ERROR_TO_RECOVER"
            : !retrievable
              ? "RETRIEVAL_FAILURE"
              : !proposed ||
                  c612Defined(proposed.candidateNormalizedError) >
                    c612Defined(oracle.candidateNormalizedError)
                ? "RERANKING_FAILURE"
                : !selected ||
                    c612Defined(selected.candidateNormalizedError) >
                      c612Defined(oracle.candidateNormalizedError)
                  ? "APPLICATION_GATE_FAILURE"
                  : "RECOVERED";
      return {
        profileId: r.profileId,
        eventId: r.eventId,
        category,
        oracleCandidateId: oracle?.candidateId ?? null,
        proposedCandidateId: r.proposedCandidateId,
        selectedCandidateId: chosen,
        reason: category,
      };
    });
  const failures = c612FailureSchema.parse(
    artifact("c6-1-2-failure-attribution", { ...local, rows: failureRows }),
  );
  const contractions = s.contraction.rows
    .filter((r) => r.strong || r.priorStrongContraction)
    .map((r) => {
      const label = input.labels.find((l) => l.candidateId === r.candidateId),
        group = s.mapping.groups.find((g) => g.groupId === label?.groupId),
        binding = input.bindings.find((b) => b.groupId === label?.groupId);
      let goldClass:
        | "TRUE_HALLUCINATION_REMOVAL"
        | "VALID_SHORTENING"
        | "LEADING_DIALOGUE_DELETION"
        | "TRAILING_DIALOGUE_DELETION"
        | "INTERNAL_DIALOGUE_DELETION"
        | "TEXT_SUBSTITUTION_NOT_CONTRACTION"
        | "UNEVALUABLE" = "UNEVALUABLE";
      if (label?.eligible && group && binding) {
        if (!r.strong) goldClass = "TEXT_SUBSTITUTION_NOT_CONTRACTION";
        else if (c612Defined(label.normalizedGain) >= 0)
          goldClass = "VALID_SHORTENING"; // Gold alignment alone does not prove an acoustic hallucination.
        else
          goldClass =
            r.leadingDeletionLength > 0
              ? "LEADING_DIALOGUE_DELETION"
              : r.trailingDeletionLength > 0
                ? "TRAILING_DIALOGUE_DELETION"
                : "INTERNAL_DIALOGUE_DELETION";
      }
      return {
        candidateId: r.candidateId,
        eventId: r.eventId,
        priorStrong: r.priorStrongContraction,
        strong: r.strong,
        machineClass: r.classification,
        goldClass,
        normalizedGain: label?.normalizedGain ?? null,
        blocked: !r.selectable,
        catastrophic: label?.catastrophicDeletion ?? null,
      };
    });
  const utilities = ["completeness", "edgeRisk", "tokenSupport", "ctcLoss"].map(
    (feature) => {
      const items = contractions.flatMap((c) => {
        const evidence = c612Defined(
            s.completeness.rows.find((e) => e.candidateId === c.candidateId),
          ),
          risk =
            feature === "completeness"
              ? ["VERIFIED_COMPLETE", "LIKELY_COMPLETE"].includes(
                  evidence.acousticCompletenessStatus,
                )
                ? 0
                : ["INSUFFICIENT_EVIDENCE", "UNSCORABLE"].includes(
                      evidence.acousticCompletenessStatus,
                    )
                  ? null
                  : 1
              : feature === "edgeRisk"
                ? evidence.requestLeftEdgeDistance === null ||
                  evidence.requestRightEdgeDistance === null
                  ? null
                  : Number(
                      Math.min(
                        evidence.requestLeftEdgeDistance,
                        evidence.requestRightEdgeDistance,
                      ) < 0.04,
                    )
                : feature === "tokenSupport"
                  ? evidence.candidateTokenSupportCoverage === null
                    ? null
                    : 1 - evidence.candidateTokenSupportCoverage
                  : evidence.candidateCtcLossPerToken;
        return c.normalizedGain === null || risk === null
          ? []
          : [
              {
                risk,
                destructive: c.normalizedGain < 0,
                blocked: c.blocked,
                catastrophic: c.catastrophic === true,
              },
            ];
      });
      const positive = items.filter((i) => i.destructive),
        negative = items.filter((i) => !i.destructive);
      let correct = 0,
        wrong = 0,
        tied = 0;
      for (const a of positive)
        for (const b of negative) {
          if (a.risk > b.risk) correct++;
          else if (a.risk < b.risk) wrong++;
          else tied++;
        }
      const blocked = items.filter((i) => i.blocked),
        catastrophic = items.filter((i) => i.catastrophic);
      return {
        feature,
        scorableCount: items.length,
        positiveCount: positive.length,
        negativeCount: negative.length,
        correctDirection: correct,
        wrongDirection: wrong,
        auc: ratio(correct + tied / 2, positive.length * negative.length),
        precisionBlocked: ratio(
          blocked.filter((i) => i.destructive).length,
          blocked.length,
        ),
        catastrophicRecall: ratio(
          catastrophic.filter((i) => i.blocked).length,
          catastrophic.length,
        ),
        safeFalseBlockRate: ratio(
          negative.filter((i) => i.blocked).length,
          negative.length,
        ),
      };
    },
  );
  const contractionEvaluation = c612ContractionEvaluationSchema.parse(
    artifact("gold-c6-1-2-contraction-evaluation", {
      ...local,
      rows: contractions,
      utilities,
      causalClaim: false,
    }),
  );
  const pairs = [
    [
      "A1_TOP_K_TEXT_STRUCTURAL_ONLY",
      "A2_TOP_K_PLUS_CORRELATION",
      "CORRELATION",
    ],
    [
      "A1_TOP_K_TEXT_STRUCTURAL_ONLY",
      "A3_TOP_K_PLUS_ACOUSTIC_COMPLETENESS",
      "ACOUSTIC_FEATURES_AND_GATE_NOT_SINGLE_FAMILY_CAUSAL",
    ],
    [
      "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
      "A5_WITHOUT_PROVIDER_IDENTITY",
      "PROVIDER_IDENTITY",
    ],
    [
      "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
      "A6_WITHOUT_CTC",
      "CTC_LOSS_FEATURES",
    ],
    [
      "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
      "A7_WITHOUT_CONTRACTION_GATE",
      "CONTRACTION_GATE",
    ],
    [
      "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
      "A8_ABSTENTION_FIRST_FULL",
      "ABSTENTION_THRESHOLD",
    ],
  ];
  const comparisons = pairs.map(([left, right, changedFamily]) => {
    const a = c612Defined(profileMetrics.find((p) => p.profileId === left)),
      b = c612Defined(profileMetrics.find((p) => p.profileId === right));
    return {
      left: c612Defined(left),
      right: c612Defined(right),
      changedFamily: c612Defined(changedFamily),
      normalizedJointGainDifference:
        a.normalizedJointGain !== null && b.normalizedJointGain !== null
          ? b.normalizedJointGain - a.normalizedJointGain
          : null,
      top1AccuracyDifference:
        a.top1Accuracy !== null && b.top1Accuracy !== null
          ? b.top1Accuracy - a.top1Accuracy
          : null,
      catastrophicDifference: b.catastrophicDeletions - a.catastrophicDeletions,
      causal: false,
    };
  });
  return {
    cv,
    failures,
    contractionEvaluation,
    ablations: c612AblationsSchema.parse(
      artifact("c6-1-2-feature-ablations", {
        ...local,
        profiles: profileMetrics.filter((p) => p.profileId.startsWith("A")),
        comparisons,
      }),
    ),
    configurationLabels: c612GroupConfigurationLabelsSchema.parse(
      artifact("gold-c6-1-2-group-configuration-labels", {
        ...local,
        goldBindingHash: input.goldBindingHash,
        configurationHash: input.configurationsHash,
        rows: configurationLabels,
      }),
    ),
  };
}
