import { c611SelectiveProfileQualitySchema } from "@mvl/shared";
import { evaluateMachineCues } from "../blind-acceptance/gold-evaluation.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { evaluateC611FixedAlignment } from "./fixed-alignment-paired-evaluator.js";
import { C611_EVALUATION_HEADER } from "./fixed-baseline-alignment-map.js";
import {
  c61MetricsFromEvaluation,
  compareC61Timing,
} from "./consensus-quality-evaluator.js";

function countAllPairs(
  cues: readonly { start: number; end: number }[],
): number {
  let count = 0;
  for (const [index, left] of cues.entries())
    for (const right of cues.slice(index + 1))
      if (Math.max(left.start, right.start) < Math.min(left.end, right.end))
        count++;
  return count;
}
/** Evaluation-only dual readout. Fixed-map group errors create labels; legacy
 * global matching is preserved solely for comparable full-episode diagnostics.
 * Its matching-induced timing changes never imply an actual timestamp repair.
 */
export function evaluateC611SelectiveProfileQuality(
  input: Parameters<typeof evaluateC611FixedAlignment>[0] & {
    legacyInput: Omit<
      Parameters<typeof evaluateMachineCues>[0],
      "machineCues" | "goldCues" | "generationRunId"
    >;
  },
) {
  const fixed = evaluateC611FixedAlignment(input);
  if (!fixed.invariance.eligible)
    throw new Error("C611_QUALITY_STRUCTURE_OR_MAP_INCOMPATIBLE");
  if (
    input.legacyInput.freeze.freezeSemanticHash !==
      input.map.machineFreezeHash ||
    input.legacyInput.goldIdentity.firstReadAt !== input.map.goldFirstReadAt ||
    Date.parse(input.legacyInput.policy.frozenAt) >
      Date.parse(input.map.goldFirstReadAt)
  )
    throw new Error("C611_QUALITY_FREEZE_IDENTITY_MISMATCH");
  const baselineLegacy = evaluateMachineCues({
    ...input.legacyInput,
    machineCues: input.baselineCues,
    goldCues: input.goldCues,
    generationRunId: "c6-1-1-S0-legacy-diagnostic",
  });
  const legacy = evaluateMachineCues({
    ...input.legacyInput,
    machineCues: input.shadowCues,
    goldCues: input.goldCues,
    generationRunId: `c6-1-1-${input.profileId}-legacy-diagnostic`,
  });
  const baselineMetrics = c61MetricsFromEvaluation(baselineLegacy),
    shadowMetrics = c61MetricsFromEvaluation(legacy);
  const timing = compareC61Timing({
    cues: input.shadowCues,
    baselineCues: input.baselineCues,
    metrics: shadowMetrics,
    baseline: baselineMetrics,
  });
  const body = {
    ...C611_EVALUATION_HEADER,
    artifactType: "c6-1-1-selective-profile-quality" as const,
    profileId: input.profileId,
    fixedEvaluationHash: fixed.semanticHash,
    fixedMapHash: input.map.semanticHash,
    legacyEvaluationHash: legacy.semanticHash,
    baselineLegacyEvaluationHash: baselineLegacy.semanticHash,
    fixedEvaluationMethod: "FIXED_GROUP_EVALUATION" as const,
    fullEpisodeEvaluationMethod:
      "LEGACY_GLOBAL_CUE_GROUP_MATCHING_DIAGNOSTIC_ONLY" as const,
    legacyMetricsUsedForProposalLabels: false as const,
    baselineMetrics,
    shadowMetrics,
    ...timing,
    baselineAllPairOverlapCount: countAllPairs(input.baselineCues),
    shadowAllPairOverlapCount: countAllPairs(input.shadowCues),
  };
  return {
    fixed,
    baselineLegacy,
    legacy,
    quality: c611SelectiveProfileQualitySchema.parse({
      ...body,
      semanticHash: hash(body),
    }),
  };
}
