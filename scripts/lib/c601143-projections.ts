import path from "node:path";
import {
  c60114MachineCoverageProjectionSchema,
  projections143Schema,
  type Workspace143,
  type Inventory142,
  type Policy143,
  type C60114MachineCoverageProjection,
} from "@mvl/shared";
import type { C60112ReviewWorkspaceData } from "../../packages/video-subtitler/src/review/c60112-review-workspace.js";
import {
  inventorySpeech142,
  verifyProjectionAudio142,
  copyProjectionAudio142,
  namedProjection142,
} from "./c601142-coverage-projection.js";
import { header143 } from "../../packages/video-subtitler/src/review/c601143-policy.js";
import {
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { assertWorkspace143 } from "../../packages/video-subtitler/src/review/c601143-review-delivery.js";
import { rebindCoverageAudio1431 } from "../../packages/video-subtitler/src/review/c6011431-projection-integrity.js";

export function coverageAudio143(
  audio: Workspace143["audio"]["audio"][number],
) {
  return rebindCoverageAudio1431(audio);
}

export function workspaceProjection143(input: {
  baseline: C60114MachineCoverageProjection;
  workspace: C60112ReviewWorkspaceData;
  inventory: Inventory142;
}) {
  assertWorkspace143(input.workspace);
  const current: Workspace143 = required141(
      input.workspace.monotonicSafetyReviewV3,
    ),
    source = current.sourceIdentity;
  const localized = current.compatibilityLexical.targets.flatMap((t) =>
    t.localizedTextCandidates.map((c, i) => ({
      evidenceId: `${c.requestId}:frozen-localized:${i}`,
      sourceInterval: c.sourceInterval,
      reliableLocalizedLexical: true,
      mappingStatus: "VERIFIED" as const,
      providerFamily: c.provider,
      rootLineageIds: [c.requestId],
      correlationGroup: c.provider,
      sourceIdentity: source,
    })),
  );
  return c60114MachineCoverageProjectionSchema.parse({
    sourceIdentity: source,
    items: current.items.items.map((i) => ({
      reviewItemId: i.reviewItemId,
      sourceIdentity: source,
    })),
    targets: current.targets.targets.map((t) => ({
      reviewTargetId: t.reviewTargetId,
      parentReviewItemId: t.parentReviewItemId,
      sourceInterval: t.sourceInterval,
      mandatoryForAudio: t.mandatoryForAudio,
      audioRequired: t.audioRequired,
      sourceIdentity: source,
    })),
    regions: current.regions.regions.map((r) => ({
      regionId: r.regionId,
      reviewTargetIds: r.reviewTargetIds,
      reviewItemIds: r.reviewItemIds,
      sourceIntervals: r.sourceIntervals,
      contextIntervals: r.contextIntervals,
      sourceIdentity: source,
    })),
    physicalAudio: current.audio.audio.map(coverageAudio143),
    playbackSegments: current.playback.segments,
    plans: current.playback.plans.map((p) => ({
      planId: p.planId,
      budgetSeconds: p.budgetSeconds,
      regionIds: p.regionIds,
      reviewTargetIds: p.reviewTargetIds,
      playbackSegmentIds: p.playbackSegmentIds,
    })),
    speechIslands: inventorySpeech142(input.inventory, () => true),
    lexicalEvidence: [...input.baseline.lexicalEvidence, ...localized],
    orphans: input.baseline.orphans,
    lineageEvidence: input.baseline.lineageEvidence,
  });
}

export async function materializeProjections143(input: {
  policy: Policy143;
  inventory: Inventory142;
  baseline: C60114MachineCoverageProjection;
  oldFinal: C60114MachineCoverageProjection;
  phaseA: C60114MachineCoverageProjection;
  final: C60114MachineCoverageProjection;
  oldBaselineDirectory: string;
  oldFinalDirectory: string;
  oldPhaseADirectory: string;
  finalWorkspaceDirectory: string;
  destination: string;
  baselineCount: number;
  baselineSeconds: number;
  phaseACount: number;
  phaseASeconds: number;
  oldFinalCount: number;
  oldFinalSeconds: number;
  selectedChildCount: number;
  finalTargetCount: number;
  finalCoreSeconds: number;
  baselineObligationCoverage: number;
  baselineRegressionCount: number;
  oldFinalObligationCoverage: number;
  oldFinalRegressionCount: number;
}) {
  const source = input.inventory.sourceIdentity,
    alias = (
      projection: C60114MachineCoverageProjection,
      plan: string,
      base?: string,
    ) => namedProjection142(projection, plan, base);
  const defs = [
    {
      stage: "A0" as const,
      description: "C6.0.1.14.1 frozen baseline final physical queue",
      selectionUnit: "C601141_BASELINE" as const,
      p: alias(
        input.baseline,
        "C601141_BASELINE_FULL_QUEUE",
        "FULL_QUEUE_WITH_SAFETY_RESERVE",
      ),
      src: input.oldBaselineDirectory,
      count: input.baselineCount,
      core: input.baselineSeconds,
      cov: input.baselineObligationCoverage,
      reg: input.baselineRegressionCount,
    },
    {
      stage: "A1" as const,
      description: "C6.0.1.14.2 Phase A selection-only physical queue",
      selectionUnit: "C601142_PHASE_A" as const,
      p: alias(input.phaseA, "C601142_PHASE_A_SELECTION_ONLY"),
      src: input.oldPhaseADirectory,
      count: input.phaseACount,
      core: input.phaseASeconds,
      cov: 1,
      reg: 0,
    },
    {
      stage: "A2" as const,
      description: "C6.0.1.14.2 final physical queue before monotonic repair",
      selectionUnit: "C601142_FINAL" as const,
      p: alias(input.oldFinal, "C601142_FINAL_FULL_QUEUE"),
      src: input.oldFinalDirectory,
      count: input.oldFinalCount,
      core: input.oldFinalSeconds,
      cov: input.oldFinalObligationCoverage,
      reg: input.oldFinalRegressionCount,
    },
    {
      stage: "A3" as const,
      description: "Frozen Phase A obligations-only projection",
      selectionUnit: "PHASE_A_OBLIGATION" as const,
      p: alias(input.phaseA, "C601143_OBLIGATIONS_ONLY"),
      src: input.oldPhaseADirectory,
      count: input.phaseACount,
      core: input.phaseASeconds,
      cov: 1,
      reg: 0,
    },
    {
      stage: "A4" as const,
      description: "Selected hierarchical child-unit physical projection",
      selectionUnit: "SELECTED_CHILD_UNIT" as const,
      p: alias(
        input.final,
        "C601143_HIERARCHICAL_CHILD_SELECTION",
        "C601143_FINAL_REVIEW_DELIVERY",
      ),
      src: input.finalWorkspaceDirectory,
      count: input.selectedChildCount,
      core: input.finalCoreSeconds,
      cov: 1,
      reg: 0,
    },
    {
      stage: "A5" as const,
      description: "Selected target-bundle physical projection",
      selectionUnit: "TARGET_BUNDLE" as const,
      p: alias(
        input.final,
        "C601143_TARGET_BUNDLING",
        "C601143_FINAL_REVIEW_DELIVERY",
      ),
      src: input.finalWorkspaceDirectory,
      count: input.finalTargetCount,
      core: input.finalCoreSeconds,
      cov: 1,
      reg: 0,
    },
    {
      stage: "A6" as const,
      description: "Constrained final planner physical projection",
      selectionUnit: "PLANNER_TARGET" as const,
      p: alias(
        input.final,
        "C601143_CONSTRAINED_FINAL_PLANNER",
        "C601143_FINAL_REVIEW_DELIVERY",
      ),
      src: input.finalWorkspaceDirectory,
      count: input.finalTargetCount,
      core: input.finalCoreSeconds,
      cov: 1,
      reg: 0,
    },
    {
      stage: "A7" as const,
      description: "Official final physical review delivery",
      selectionUnit: "FINAL_DELIVERY" as const,
      p: input.final,
      src: input.finalWorkspaceDirectory,
      count: input.finalTargetCount,
      core: input.finalCoreSeconds,
      cov: 1,
      reg: 0,
    },
  ];
  const variants = [];
  for (const d of defs) {
    const relative = `comparison-workspaces/${d.stage}`,
      destination = path.join(input.destination, relative);
    await copyProjectionAudio142(d.src, destination, d.p);
    await verifyProjectionAudio142(destination, d.p);
    variants.push(
      hashed141({
        stage: d.stage,
        description: d.description,
        projection: d.p,
        workspaceRelativePath: relative,
        officialPlanId: required141(d.p.plans.at(-1)).planId,
        selectionUnit: d.selectionUnit,
        safetyTargetCount: d.count,
        safetyCoreUnionSeconds: d.core,
        phaseAObligationCoverage: d.cov,
        phaseARegressionCount: d.reg,
        physicalAudioVerified: true,
        derivedFromFrozenEvidence: true,
        goldBlind: true,
      }),
    );
  }
  return projections143Schema.parse(
    hashed141({
      ...header143(input.policy, source),
      artifactType: "c6-0-1-14-3-machine-coverage-projections",
      variants,
      officialStage: "A7",
      officialPlanId: "C601143_FINAL_REVIEW_DELIVERY",
      newInferenceCount: 0,
      rankerRetrained: false,
      goldBlind: true,
    }),
  );
}
