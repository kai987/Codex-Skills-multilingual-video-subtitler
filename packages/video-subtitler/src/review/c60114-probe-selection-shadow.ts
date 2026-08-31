import {
  c60114ProbeSelectionV2ShadowSchema,
  type C60114ProbeSelectionV2Shadow,
  type C60114SpeechIslands,
  type C60114OrphanSpeechSweep,
  type C60114ProbeSelection,
  type C60114ProbeExecution,
  type C60114ProbeRelocalization,
  type C60114SourceIdentity,
  type C60114Policy,
} from "@mvl/shared";
import {
  c60114ArtifactHeader,
  c60114Coverage,
  c60114Id,
  c60114Subtract,
  withC60114SemanticHash,
} from "./c60114-policy.js";
import { c60114IslandForInterval } from "./source-global-speech-islands.js";
import { isC60114ObservedOrphan } from "./orphan-speech-sweep.js";
import { buildC60114CompletionPolicy } from "./c60114-completion-policy.js";
import { normalizeIndependentAsrLexical } from "../machine-quality/cross-model-normalization.js";

type Shadow = C60114ProbeSelectionV2Shadow;
/** One candidate per occupied time bin per round, quality-ranked within bins.
 * Empty bins never create synthetic evidence. This schedule is never executed. */
interface ShadowRankRow {
  targetId: string;
  timelineBin: number;
  score: number;
}
function diversified(
  rows: readonly ShadowRankRow[],
  maximum: number,
): Set<string> {
  const bins = new Map<number, ShadowRankRow[]>();
  for (const r of rows)
    bins.set(r.timelineBin, [...(bins.get(r.timelineBin) ?? []), r]);
  for (const list of bins.values())
    list.sort(
      (a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId),
    );
  const chosen = new Set<string>();
  while (chosen.size < maximum) {
    const round = [...bins.values()]
      .flatMap((v) => (v[0] ? [v[0]] : []))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.timelineBin - b.timelineBin ||
          a.targetId.localeCompare(b.targetId),
      );
    if (!round.length) break;
    for (const r of round) {
      if (chosen.size >= maximum) break;
      chosen.add(r.targetId);
      bins.get(r.timelineBin)?.shift();
    }
  }
  return chosen;
}
export function buildC60114ProbeSelectionV2Shadow(input: {
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  speechIslands: C60114SpeechIslands;
  orphanSweep: C60114OrphanSpeechSweep;
  executedSelection: C60114ProbeSelection;
  probes: C60114ProbeExecution;
  relocalization: C60114ProbeRelocalization;
  finalCues: readonly { id: string; start: number; end: number }[];
}) {
  const completion = buildC60114CompletionPolicy();
  const bin = (start: number) =>
    Math.min(
      completion.shadowTimeBinCount - 1,
      Math.floor(
        (start / input.sourceIdentity.durationSeconds) *
          completion.shadowTimeBinCount,
      ),
    );
  const loci = [
    ...input.speechIslands.islands.map((i) => ({
      id: i.islandId,
      interval: i.sourceInterval,
      origin: "CHILD" as const,
    })),
    ...input.speechIslands.globalIslands.map((i) => ({
      id: i.islandId,
      interval: i.sourceInterval,
      origin: "GLOBAL" as const,
    })),
    ...input.orphanSweep.entries.filter(isC60114ObservedOrphan).map((e) => ({
      id: e.sourceIslandId,
      interval: e.sourceInterval,
      origin: "ORPHAN" as const,
    })),
  ];
  const candidates = new Map<string, Shadow["targets"][number]>();
  for (const locus of loci) {
    for (const sourceInterval of c60114Subtract(
      locus.interval,
      input.finalCues,
    )) {
      const local = c60114IslandForInterval({
        sourceInterval,
        evidence: input.speechIslands.audit.evidence,
        sourceIdentity: input.sourceIdentity,
        policy: input.policy,
      });
      if (
        !local.speechPositive ||
        local.strongContradiction ||
        local.localizationStatus !== "VERIFIED" ||
        local.reliableLocalizedLexical
      )
        continue;
      const evidence = input.speechIslands.audit.evidence.filter(
        (e) =>
          local.evidenceIds.includes(e.evidenceId) &&
          e.mappingStatus === "VERIFIED" &&
          (e.speechPositive || e.lexicalPositive) &&
          !e.contradiction,
      );
      const familyCount = new Set(evidence.map((e) => e.family)).size;
      const speechStrength = Math.max(0, ...evidence.map((e) => e.strength));
      const durationSeconds = sourceInterval.end - sourceInterval.start;
      const uncoveredRatio =
        1 - c60114Coverage(sourceInterval, input.finalCues);
      const targetId = c60114Id("missing-probe", {
        source: input.sourceIdentity,
        sourceInterval,
      });
      // Shadow-only evidence-quality utility. The frozen R3 queue is untouched.
      const score =
        local.independentSourceCount * 100 +
        familyCount * 10 +
        speechStrength * 5 +
        uncoveredRatio * 3 +
        Math.min(durationSeconds, input.policy.speech.maxSeconds) /
          input.policy.speech.maxSeconds +
        (locus.origin === "ORPHAN" ? 1 : 0);
      const row: Shadow["targets"][number] = {
        targetId,
        sourceIslandId: locus.id,
        sourceInterval,
        evidenceIds: local.evidenceIds,
        familyCount,
        independentSourceCount: local.independentSourceCount,
        speechStrength,
        uncoveredRatio,
        durationSeconds,
        mappingQuality: 1,
        lexicalAbsence: true,
        parentOrGlobalOrigin: locus.origin,
        timelineBin: bin(sourceInterval.start),
        selected: false,
        score,
        reasonCodes: [
          "VERIFIED_UNCOVERED_MACHINE_SPEECH",
          "NO_RELIABLE_LOCALIZED_LEXICAL",
          "QUALITY_THEN_TIME_BIN_DIVERSITY",
        ],
        executionStatus: "PROBE_NOT_RUN_AUTHORIZATION_EXHAUSTED",
      };
      const prior = candidates.get(targetId);
      if (!prior || score > prior.score) candidates.set(targetId, row);
    }
  }
  const rows = [...candidates.values()].sort(
    (a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId),
  );
  const unique: typeof rows = [];
  for (const row of rows)
    if (
      !unique.some(
        (p) =>
          c60114Coverage(row.sourceInterval, [p.sourceInterval]) >=
            input.policy.orphanCoverageThreshold &&
          c60114Coverage(p.sourceInterval, [row.sourceInterval]) >=
            input.policy.orphanCoverageThreshold,
      )
    )
      unique.push(row);
  const chosen = diversified(unique, input.policy.probes.maxTargets);
  const targets = unique.map((r) => ({
    ...r,
    selected: chosen.has(r.targetId),
    reasonCodes: [
      ...r.reasonCodes,
      chosen.has(r.targetId)
        ? "SHADOW_SELECTED_WITHIN_FIXED_BUDGET"
        : "SHADOW_HIGH_VALUE_BUDGET_EXHAUSTED",
    ],
  }));
  const context: Shadow["context"] = input.executedSelection.targets.map(
    (target) => {
      const exact = input.probes.requests.filter(
        (r) => r.targetId === target.targetId && r.windowType === "CORE_EXACT",
      );
      const local = input.relocalization.requests.filter(
        (r) => r.targetId === target.targetId && r.windowType === "CORE_EXACT",
      );
      const reasons: string[] = [];
      let score = target.sourceInterval.end - target.sourceInterval.start;
      if (exact.some((r) => r.status === "EMPTY_OUTPUT")) {
        score += 40;
        reasons.push("EXACT_EMPTY");
      }
      if (
        new Set(exact.map((r) => normalizeIndependentAsrLexical(r.rawText)))
          .size > 1
      ) {
        score += 30;
        reasons.push("EXACT_CROSS_MODEL_DISAGREEMENT");
      }
      if (local.some((r) => r.guardContactCaution || !r.localizationVerified)) {
        score += 20;
        reasons.push("LOCALIZATION_RECOVERY_POTENTIAL");
      }
      if (exact.some((r) => r.hallucinationRisk >= 0.6)) {
        score += 10;
        reasons.push("EXACT_HALLUCINATION_RISK");
      }
      score += new Set(target.correlationGroups).size;
      return {
        targetId: target.targetId,
        score,
        selected: false,
        previouslySelected: input.probes.contextSelection.some(
          (r) => r.targetId === target.targetId && r.selected,
        ),
        timelineBin: bin(target.sourceInterval.start),
        reasonCodes: reasons.length
          ? reasons
          : ["STABLE_EXACT_NO_CONTEXT_NEEDED"],
        executionStatus: "PROBE_NOT_RUN_AUTHORIZATION_EXHAUSTED",
      };
    },
  );
  const contextChosen = diversified(
    context.filter(
      (r) => !r.reasonCodes.includes("STABLE_EXACT_NO_CONTEXT_NEEDED"),
    ),
    input.policy.probes.maxContextTargets,
  );
  for (const row of context) row.selected = contextChosen.has(row.targetId);
  const executedTargetIds = input.executedSelection.targets
      .map((t) => t.targetId)
      .sort(),
    proposedTargetIds = [...chosen].sort();
  return c60114ProbeSelectionV2ShadowSchema.parse(
    withC60114SemanticHash({
      ...c60114ArtifactHeader(input.policy, input.sourceIdentity),
      artifactType: "machine-missing-dialogue-probe-selection-v2-shadow",
      completionPolicyHash: completion.semanticHash,
      originalSelectionHash: input.executedSelection.semanticHash,
      executedTargetIds,
      proposedTargetIds,
      addedTargetIds: proposedTargetIds.filter(
        (id) => !executedTargetIds.includes(id),
      ),
      removedTargetIds: executedTargetIds.filter((id) => !chosen.has(id)),
      highValueBudgetExhaustedTargetIds: targets
        .filter((r) => !r.selected)
        .map((r) => r.targetId)
        .sort(),
      targets: targets.sort(
        (a, b) =>
          a.sourceInterval.start - b.sourceInterval.start ||
          a.targetId.localeCompare(b.targetId),
      ),
      context: context.sort((a, b) => a.targetId.localeCompare(b.targetId)),
      newInferenceCount: 0,
      goldUsed: false,
    }),
  );
}
