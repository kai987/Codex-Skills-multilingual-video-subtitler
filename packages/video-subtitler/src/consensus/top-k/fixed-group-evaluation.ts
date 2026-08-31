/** Evaluation-only module. No machine feature or ranker imports this file. */
import {
  c612CandidateLabelsSchema,
  c612GroupLabelsSchema,
  c612RetrievalMetricsSchema,
  type C612GoldBinding,
  type C612Group,
  type C612Label,
  type C612Set,
  type C612RankRow,
  type C61HypothesisUniverse,
  type SubtitlePackage,
  type C612Folds,
} from "@mvl/shared";
import { normalizeC61EvaluationText as normalize } from "../consensus-oracle-evaluator.js";
import {
  artifact,
  hash,
  ratio,
  C612_POLICY,
  c612Defined,
} from "./c612-policy.js";
import {
  chars,
  editDistance,
  intersect,
  duration,
  overlap,
  textStructure,
} from "./c612-structural.js";
import { assembleC612WholeCandidates } from "./group-shadow-configurations.js";
export { normalize };
export interface C612EvaluationCue {
  id: string;
  start: number;
  end: number;
  text: string;
}
export function materialText(text: string, gold: string) {
  const a = normalize(text),
    b = normalize(gold);
  return Number(
    Math.max(a.length, b.length) >= 4 &&
      editDistance(a, b) / Math.max(1, chars(a).length, chars(b).length) >=
        0.45,
  );
}
/** Replay the historical material counter exactly, including its code-point and
 * floating-point semantics; this does not rematch any cue to Gold. */
export function legacyMaterialText(text: string, gold: string) {
  const legacyNormalize = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/[\p{P}\p{Z}\s]/gu, "")
      .toLowerCase();
  const a = legacyNormalize(text),
    b = legacyNormalize(gold),
    left = Array.from(a),
    right = Array.from(b);
  let row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (const c of left) {
    const next = [c612Defined(row[0]) + 1];
    for (let j = 1; j <= right.length; j++)
      next[j] = Math.min(
        c612Defined(row[j]) + 1,
        c612Defined(next[j - 1]) + 1,
        c612Defined(row[j - 1]) + Number(c !== right[j - 1]),
      );
    row = next;
  }
  const similarity = Math.max(
    0,
    1 - c612Defined(row[right.length]) / Math.max(1, left.length, right.length),
  );
  return Number(Math.max(a.length, b.length) >= 4 && 1 - similarity >= 0.45);
}
export const outcome = (gain: number | null) =>
  gain === null
    ? ("UNEVALUABLE" as const)
    : gain > 0
      ? ("IMPROVED" as const)
      : gain < 0
        ? ("REGRESSED" as const)
        : ("NEUTRAL" as const);
export function catastrophicDeletion(
  baseline: string,
  shadow: string,
  gold: string,
): boolean {
  const a = normalize(baseline),
    b = normalize(shadow),
    target = normalize(gold),
    shape = textStructure(a, b);
  const supportedBefore = new Set(textStructure(target, a).retained),
    supportedAfter = new Set(textStructure(target, b).retained);
  const lost = [...supportedBefore].filter(
    (i) => !supportedAfter.has(i),
  ).length;
  return (
    (shape.lengthRatio < C612_POLICY.contraction.strongLengthRatio ||
      shape.deletionRatio > C612_POLICY.contraction.strongDeletionRatio) &&
    lost >= 2 &&
    editDistance(b, target) - editDistance(a, target) >= 2
  );
}
export function bindGoldToFixedGroups(
  groups: readonly C612Group[],
  production: SubtitlePackage,
  gold: readonly C612EvaluationCue[],
): C612GoldBinding[] {
  const matches = new Map(
    groups.map((group) => [
      group.groupId,
      gold.filter((g) =>
        group.cueIds.some((id) => {
          const c = c612Defined(production.cues.find((c) => c.id === id));
          return overlap(c, g) > 0;
        }),
      ),
    ]),
  );
  const claimed = new Map<string, string[]>();
  for (const [id, rows] of matches)
    for (const row of rows)
      claimed.set(row.id, [...(claimed.get(row.id) ?? []), id]);
  return groups.map((group) => {
    const targets = c612Defined(matches.get(group.groupId)),
      cues = production.cues.filter((c) => group.cueIds.includes(c.id));
    const covered = duration(cues.flatMap((c) => intersect(targets, c))),
      machineDuration = duration(cues),
      goldDuration = duration(targets);
    const machineCoveredRatio = Math.min(
        1,
        covered / Math.max(machineDuration, 1e-9),
      ),
      goldCoveredRatio = Math.min(1, covered / Math.max(goldDuration, 1e-9));
    const reasons = [...group.reasons];
    if (!targets.length) reasons.push("NO_GOLD_TEMPORAL_OVERLAP");
    if (targets.some((t) => (claimed.get(t.id)?.length ?? 0) > 1))
      reasons.push("GOLD_CUE_SPANS_MULTIPLE_FROZEN_MACHINE_GROUPS");
    if (
      machineCoveredRatio < C612_POLICY.mapping.minimumGoldTemporalCoverage ||
      goldCoveredRatio < C612_POLICY.mapping.minimumGoldTemporalCoverage
    )
      reasons.push("INSUFFICIENT_MUTUAL_TEMPORAL_COVERAGE");
    const eligible = group.status.startsWith("FIXED_") && !reasons.length;
    const status = eligible
      ? cues.length === 1
        ? targets.length === 1
          ? "FIXED_ONE_TO_ONE"
          : "FIXED_ONE_TO_MANY"
        : targets.length === 1
          ? "FIXED_MANY_TO_ONE"
          : "FIXED_MANY_TO_MANY"
      : !targets.length
        ? "NO_MAPPING"
        : group.status === "STRUCTURE_INCOMPATIBLE"
          ? "STRUCTURE_INCOMPATIBLE"
          : "AMBIGUOUS";
    const baseline = cues
        .map((c) => c.text)
        .join("")
        .normalize("NFC"),
      text = targets
        .map((g) => g.text)
        .join("")
        .normalize("NFC");
    return {
      groupId: group.groupId,
      goldCueIds: targets.map((g) => g.id),
      status,
      reasons: [...new Set(reasons)].sort(),
      machineCoveredRatio,
      goldCoveredRatio,
      baselineExactError: eligible ? editDistance(baseline, text) : null,
      baselineNormalizedError: eligible
        ? editDistance(normalize(baseline), normalize(text))
        : null,
      goldCharacterCount: eligible ? chars(normalize(text)).length : null,
      baselineMaterial: eligible ? materialText(baseline, text) : null,
    };
  });
}
export function evaluateGroupText(
  group: C612Group,
  binding: C612GoldBinding,
  cues: readonly C612EvaluationCue[],
  baseline: readonly C612EvaluationCue[],
  gold: readonly C612EvaluationCue[],
) {
  const selected = cues.filter((c) => group.cueIds.includes(c.id)),
    original = baseline.filter((c) => group.cueIds.includes(c.id));
  if (
    hash(selected.map((c) => [c.id, c.start, c.end])) !==
    hash(original.map((c) => [c.id, c.start, c.end]))
  )
    throw new Error("C612_FIXED_MAPPING_STRUCTURE_MUTATED");
  const eligible = binding.status.startsWith("FIXED_");
  const text = selected
      .map((c) => c.text)
      .join("")
      .normalize("NFC"),
    before = original
      .map((c) => c.text)
      .join("")
      .normalize("NFC"),
    target = gold
      .filter((c) => binding.goldCueIds.includes(c.id))
      .map((c) => c.text)
      .join("")
      .normalize("NFC");
  const exactError = eligible ? editDistance(text, target) : null,
    normalizedError = eligible
      ? editDistance(normalize(text), normalize(target))
      : null;
  return {
    text,
    before,
    target,
    exactError,
    normalizedError,
    exactGain: eligible
      ? c612Defined(binding.baselineExactError) - c612Defined(exactError)
      : null,
    normalizedGain: eligible
      ? c612Defined(binding.baselineNormalizedError) -
        c612Defined(normalizedError)
      : null,
    materialDelta: eligible
      ? materialText(text, target) - c612Defined(binding.baselineMaterial)
      : null,
    catastrophic: eligible ? catastrophicDeletion(before, text, target) : null,
  };
}
export function createC612CandidateLabels(input: {
  groups: readonly C612Group[];
  production: SubtitlePackage;
  universe: C61HypothesisUniverse;
  ranks: readonly C612RankRow[];
  sets: readonly C612Set[];
  folds: C612Folds;
  gold: readonly C612EvaluationCue[];
  freezeHash: string;
  goldHash: string;
  goldFirstReadAt: string;
  mappingHash: string;
}) {
  const bindings = bindGoldToFixedGroups(
      input.groups,
      input.production,
      input.gold,
    ),
    goldBindingHash = hash(bindings);
  const rows: C612Label[] = input.ranks.map((rank) => {
    const candidate = c612Defined(
        input.universe.candidates.find(
          (c) => c.candidateId === rank.candidateId,
        ),
      ),
      group = input.groups.find((g) => g.eventIds.includes(rank.eventId));
    const binding = bindings.find((b) => b.groupId === group?.groupId),
      current = rank.currentCandidate;
    const assembled =
      current || !rank.structuralEligible
        ? {
            cues: input.production.cues,
            eligible: current,
            reasons: current ? [] : rank.reasons,
          }
        : assembleC612WholeCandidates(input.production, input.universe, [
            { eventId: rank.eventId, candidateId: candidate.candidateId },
          ]);
    const result =
      group && binding
        ? evaluateGroupText(
            group,
            binding,
            assembled.cues,
            input.production.cues,
            input.gold,
          )
        : null;
    const eligible =
      assembled.eligible &&
      result?.normalizedError !== null &&
      !!result &&
      !!binding;
    return {
      candidateId: candidate.candidateId,
      eventId: rank.eventId,
      groupId: group?.groupId ?? null,
      foldId:
        input.folds.folds.find((f) => f.eventIds.includes(rank.eventId))
          ?.foldId ?? null,
      current,
      eligible,
      reasons: eligible
        ? []
        : [
            ...new Set([
              ...assembled.reasons,
              ...(binding?.reasons ?? ["NO_MACHINE_GROUP"]),
              ...(!rank.structuralEligible && !current
                ? ["STRUCTURAL_INELIGIBLE"]
                : []),
            ]),
          ].sort(),
      baselineExactError: eligible ? binding.baselineExactError : null,
      candidateExactError: eligible ? result.exactError : null,
      baselineNormalizedError: eligible
        ? binding.baselineNormalizedError
        : null,
      candidateNormalizedError: eligible ? result.normalizedError : null,
      normalizedGain: eligible ? result.normalizedGain : null,
      exactGain: eligible ? result.exactGain : null,
      materialDelta: eligible ? result.materialDelta : null,
      catastrophicDeletion: eligible ? result.catastrophic : null,
      classification: outcome(eligible ? result.normalizedGain : null),
      labelClass: !eligible
        ? "UNEVALUABLE"
        : result.catastrophic
          ? "CATASTROPHIC_REGRESSION"
          : c612Defined(result.normalizedGain) > 0
            ? "IMPROVES_CURRENT"
            : c612Defined(result.normalizedGain) < 0
              ? "REGRESSES_FROM_CURRENT"
              : "EQUIVALENT_TO_CURRENT",
      labelRole: "DIAGNOSTIC_LOCAL_COUNTERFACTUAL",
      topKProfiles: input.sets
        .filter(
          (s) =>
            s.eventId === rank.eventId &&
            (s.currentCandidateId === candidate.candidateId ||
              s.alternativeIds.includes(candidate.candidateId)),
        )
        .map((s) => s.profile),
      oracleRank: null,
    };
  });
  for (const eventId of [...new Set(rows.map((r) => r.eventId))]) {
    const ordered = rows
      .filter((r) => r.eventId === eventId && r.eligible)
      .sort(
        (a, b) =>
          c612Defined(a.candidateNormalizedError) -
            c612Defined(b.candidateNormalizedError) ||
          Number(b.current) - Number(a.current) ||
          a.candidateId.localeCompare(b.candidateId),
      );
    ordered.forEach((r, i) => {
      r.oracleRank = i + 1;
      if (r.candidateNormalizedError === ordered[0]?.candidateNormalizedError)
        r.labelClass = "ORACLE_BEST";
    });
  }
  const groupLabels = c612GroupLabelsSchema.parse(
    artifact("gold-c6-1-2-fixed-group-labels", {
      evaluationOnly: true,
      privacy: "LOCAL_ONLY",
      machineFreezeHash: input.freezeHash,
      mappingHash: input.mappingHash,
      goldIdentityHash: input.goldHash,
      goldBindingHash,
      goldFirstReadAt: input.goldFirstReadAt,
      rows: bindings,
      unmappedGoldCueIds: input.gold
        .filter((g) => !bindings.some((b) => b.goldCueIds.includes(g.id)))
        .map((g) => g.id),
      profileRematchingCount: 0,
    }),
  );
  const labels = c612CandidateLabelsSchema.parse(
    artifact("gold-c6-1-2-top-k-candidate-labels", {
      evaluationOnly: true,
      privacy: "LOCAL_ONLY",
      machineFreezeHash: input.freezeHash,
      mappingHash: input.mappingHash,
      goldBindingHash,
      goldIdentityHash: input.goldHash,
      labels: rows.sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
      rawGoldTextIncluded: false,
      labelsFedToRuntimeInference: false,
    }),
  );
  return { groupLabels, labels };
}
export function rankingQuality(
  orderedIds: readonly string[],
  labels: readonly C612Label[],
) {
  if (
    !orderedIds.length ||
    orderedIds.some((id) => !labels.find((l) => l.candidateId === id)?.eligible)
  )
    return null;
  const available = orderedIds.map((id) =>
    c612Defined(labels.find((l) => l.candidateId === id)),
  );
  const fullPool = labels.filter(
    (l) => l.eventId === c612Defined(available[0]).eventId && l.eligible,
  );
  const minimum = Math.min(
    ...fullPool.map((l) => c612Defined(l.candidateNormalizedError)),
  );
  const rank =
    available.findIndex((l) => l.candidateNormalizedError === minimum) + 1;
  const relevance = available.map((l) =>
    Math.max(
      0,
      c612Defined(l.baselineNormalizedError) -
        c612Defined(l.candidateNormalizedError),
    ),
  );
  // Linear bounded gains avoid exponential overflow for long groups.
  const dcg = (r: readonly number[]) =>
      r.slice(0, 4).reduce((n, v, i) => n + v / Math.log2(i + 2), 0),
    ideal = dcg(
      fullPool
        .map((l) =>
          Math.max(
            0,
            c612Defined(l.baselineNormalizedError) -
              c612Defined(l.candidateNormalizedError),
          ),
        )
        .toSorted((a, b) => b - a),
    );
  return {
    accuracy: Number(rank === 1),
    reciprocalRank: rank > 0 ? 1 / rank : 0,
    ndcg4: ideal > 0 ? dcg(relevance) / ideal : null,
  };
}
export function evaluateRetrieval(input: {
  labels: readonly C612Label[];
  ranks: readonly C612RankRow[];
  sets: readonly C612Set[];
  freezeHash: string;
}) {
  const rows = input.sets.map((set) => {
    const labels = input.labels.filter(
        (l) => l.eventId === set.eventId && l.eligible,
      ),
      current = labels.find((l) => l.current);
    const best = labels.toSorted(
      (a, b) =>
        c612Defined(a.candidateNormalizedError) -
          c612Defined(b.candidateNormalizedError) ||
        Number(b.current) - Number(a.current) ||
        a.candidateId.localeCompare(b.candidateId),
    )[0];
    const ids = [set.currentCandidateId, ...set.alternativeIds],
      topLabels = labels.filter((l) => ids.includes(l.candidateId));
    const rank = best
      ? input.ranks.find((r) => r.candidateId === best.candidateId)
      : undefined;
    const bestAlternatives =
      best &&
      current &&
      c612Defined(best.candidateNormalizedError) <
        c612Defined(current.candidateNormalizedError)
        ? labels
            .filter(
              (l) =>
                !l.current &&
                l.candidateNormalizedError === best.candidateNormalizedError,
            )
            .map((l) => l.candidateId)
        : [];
    const index = set.alternativeIds.findIndex((id) =>
      bestAlternatives.includes(id),
    );
    return {
      profile: set.profile,
      eventId: set.eventId,
      oracleCandidateId: best?.candidateId ?? null,
      h2Rank: rank?.hierarchicalMbrRank ?? null,
      rawRank: rank?.rawMbrRank ?? null,
      retrievedRank: index >= 0 ? index + 1 : null,
      currentError: current?.candidateNormalizedError ?? null,
      oracleError: best?.candidateNormalizedError ?? null,
      topKOracleError: topLabels.length
        ? Math.min(
            ...topLabels.map((l) => c612Defined(l.candidateNormalizedError)),
          )
        : null,
      reason:
        !best || !current
          ? "EVALUATION_UNAVAILABLE"
          : !bestAlternatives.length
            ? "CURRENT_IS_ORACLE_OR_TIED"
            : index >= 0
              ? "ORACLE_RETRIEVED"
              : "ORACLE_OUTSIDE_TOP_K",
    };
  });
  const profiles = [...new Set(input.sets.map((s) => s.profile))].map(
    (profile) => {
      const selected = rows.filter((r) => r.profile === profile),
        evaluable = selected.filter(
          (r) => r.currentError !== null && r.oracleError !== null,
        ),
        improvable = evaluable.filter(
          (r) => c612Defined(r.oracleError) < c612Defined(r.currentError),
        );
      const quality = input.sets
        .filter(
          (s) =>
            s.profile === profile &&
            improvable.some((r) => r.eventId === s.eventId),
        )
        .flatMap((s) => {
          const q = rankingQuality(s.alternativeIds, input.labels);
          return q ? [q] : [];
        });
      const fullExistingOracleGain = evaluable.reduce(
          (n, r) =>
            n +
            Math.max(
              0,
              c612Defined(r.currentError) - c612Defined(r.oracleError),
            ),
          0,
        ),
        topKOracleGain = evaluable.reduce(
          (n, r) =>
            n +
            Math.max(
              0,
              c612Defined(r.currentError) - c612Defined(r.topKOracleError),
            ),
          0,
        );
      const rec = (k: number) =>
        ratio(
          improvable.filter(
            (r) => r.retrievedRank !== null && r.retrievedRank <= k,
          ).length,
          improvable.length,
        );
      return {
        profile,
        evaluableEvents: evaluable.length,
        oracleImprovementEvents: improvable.length,
        recall1: rec(1),
        recall2: rec(2),
        recall3: rec(3),
        recall4: rec(4),
        mrr: quality.length
          ? quality.reduce((n, q) => n + q.reciprocalRank, 0) / quality.length
          : null,
        ndcg4: quality.some((q) => q.ndcg4 !== null)
          ? quality
              .filter((q) => q.ndcg4 !== null)
              .reduce((n, q) => n + c612Defined(q.ndcg4), 0) /
            quality.filter((q) => q.ndcg4 !== null).length
          : null,
        topKOracleGain,
        fullExistingOracleGain,
        oracleCapture: ratio(topKOracleGain, fullExistingOracleGain),
      };
    },
  );
  return c612RetrievalMetricsSchema.parse(
    artifact("c6-1-2-retrieval-evaluation", {
      evaluationOnly: true,
      privacy: "LOCAL_ONLY",
      machineFreezeHash: input.freezeHash,
      profiles,
      rows,
    }),
  );
}
