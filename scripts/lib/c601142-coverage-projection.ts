import path from "node:path";
import { readFile, mkdir, copyFile, constants } from "node:fs/promises";
import {
  c60114MachineCoverageProjectionSchema,
  projection142Schema,
  projections142Schema,
  type C60114MachineCoverageProjection,
  type Inventory142,
  type Policy142,
  type Projection142,
  type Stage142,
  type Projections142,
} from "@mvl/shared";
import { assertWorkspace142 } from "../../packages/video-subtitler/src/review/c601142-review-delivery.js";
import type { C60112ReviewWorkspaceData } from "../../packages/video-subtitler/src/review/c60112-review-workspace.js";
import { header142 } from "../../packages/video-subtitler/src/review/c601142-policy.js";
import {
  hashed141,
  seconds141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import {
  pcm141,
  bytesHash141,
  safeRelative141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";

/** Projection-only logic: real physical segments and atomic intervals, never a
 * new inferred target, enlarged envelope, Gold label or synthesized recall. */
export function workspaceProjection142(input: {
  baseline: C60114MachineCoverageProjection;
  workspace: C60112ReviewWorkspaceData;
  inventory: Inventory142;
  includeNewLexical: boolean;
}): C60114MachineCoverageProjection {
  assertWorkspace142(input.workspace);
  const current = required141(input.workspace.detectorCeilingReviewV2),
    compatible = required141(input.workspace.sourceTargetReviewV3),
    sourceIdentity = current.sourceIdentity;
  const localized = input.includeNewLexical
    ? current.lexical.targets.flatMap((t) =>
        t.localizedTextCandidates.map((c, i) => ({
          evidenceId: `${c.requestId}:localized:${i}`,
          sourceInterval: c.sourceInterval,
          reliableLocalizedLexical: true,
          mappingStatus: "VERIFIED" as const,
          providerFamily: c.provider,
          rootLineageIds: [c.requestId],
          correlationGroup: c.provider,
          sourceIdentity,
        })),
      )
    : [];
  // Here "reliableLocalizedLexical" is the unchanged coverage evaluator's
  // localization-availability flag. It never asserts correctness of ASR words.
  return c60114MachineCoverageProjectionSchema.parse({
    sourceIdentity,
    items: current.items.items.map((i) => ({
      reviewItemId: i.reviewItemId,
      sourceIdentity,
    })),
    targets: current.targets.targets.map((t) => ({
      reviewTargetId: t.reviewTargetId,
      parentReviewItemId: t.parentReviewItemId,
      sourceInterval: t.sourceInterval,
      mandatoryForAudio: t.mandatoryForAudio,
      audioRequired: t.audioRequired,
      sourceIdentity,
    })),
    regions: current.regions.regions.map((r) => ({
      regionId: r.regionId,
      reviewTargetIds: r.reviewTargetIds,
      reviewItemIds: r.reviewItemIds,
      sourceIntervals: r.sourceIntervals,
      contextIntervals: r.contextIntervals,
      sourceIdentity,
    })),
    physicalAudio: compatible.audio.audio,
    playbackSegments: compatible.playback.segments,
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
export function inventorySpeech142(
  inventory: Inventory142,
  include: (row: Inventory142["observations"][number]) => boolean,
) {
  return inventory.observations.filter(include).map((o) => ({
    islandId: o.observationId,
    sourceInterval: seconds141(
      o.nativeInterval,
      inventory.sourceIdentity.sampleRate,
    ),
    speechPositive: o.speechPositive && !o.strongContradiction,
    localizationStatus: o.verifiedTimebase
      ? ("VERIFIED" as const)
      : ("UNRESOLVED" as const),
    sourceIdentity: inventory.sourceIdentity,
  }));
}
export async function verifyProjectionAudio142(
  directory: string,
  projection: C60114MachineCoverageProjection,
) {
  c60114MachineCoverageProjectionSchema.parse(projection);
  for (const audio of projection.physicalAudio) {
    const file = path.resolve(directory, audio.relativePath);
    safeRelative141(directory, file);
    const bytes = await readFile(file),
      parsed = pcm141(bytes);
    if (
      !audio.playable ||
      !audio.hashVerified ||
      !audio.physicalMetadataVerified ||
      bytesHash141(bytes) !== audio.sha256 ||
      parsed.frames !== audio.frameCount ||
      parsed.channels !== audio.channels ||
      parsed.sampleRate !== audio.sampleRate ||
      Math.abs(parsed.frames / parsed.sampleRate - audio.actualDuration) >
        1 / parsed.sampleRate
    )
      throw new Error("C601142_PROJECTION_PHYSICAL_WAV_MISMATCH");
  }
  for (const segment of projection.playbackSegments) {
    const audio = projection.physicalAudio.find(
      (a) => a.audioId === segment.audioId,
    );
    if (
      !audio ||
      segment.sourceInterval.start <
        audio.sourceInterval.start - 1 / audio.sampleRate ||
      segment.sourceInterval.end >
        audio.sourceInterval.end + 1 / audio.sampleRate ||
      Math.abs(
        audio.sourceInterval.start +
          segment.audioLocalInterval.start -
          segment.sourceInterval.start,
      ) >
        1 / audio.sampleRate ||
      Math.abs(
        audio.sourceInterval.start +
          segment.audioLocalInterval.end -
          segment.sourceInterval.end,
      ) >
        1 / audio.sampleRate
    )
      throw new Error("C601142_PROJECTION_PLAYBACK_MAPPING_INVALID");
  }
  return {
    wavCount: projection.physicalAudio.length,
    playbackSegmentCount: projection.playbackSegments.length,
    verified: true as const,
  };
}
export async function copyProjectionAudio142(
  from: string,
  to: string,
  projection: C60114MachineCoverageProjection,
) {
  await verifyProjectionAudio142(from, projection);
  for (const audio of projection.physicalAudio) {
    const source = path.resolve(from, audio.relativePath),
      destination = path.resolve(to, audio.relativePath);
    safeRelative141(from, source);
    safeRelative141(to, destination);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
  await verifyProjectionAudio142(to, projection);
}
export function namedProjection142(
  projection: C60114MachineCoverageProjection,
  alias: string,
  basePlan?: string,
) {
  const full = required141(
    projection.plans.find(
      (p) => p.planId === (basePlan ?? "C601142_FINAL_FULL_QUEUE"),
    ),
  );
  return c60114MachineCoverageProjectionSchema.parse({
    ...projection,
    plans: [
      ...projection.plans.filter((p) => p.planId !== alias),
      { ...full, planId: alias },
    ],
  });
}
export function assembleProjections142(input: {
  policy: Policy142;
  inventory: Inventory142;
  baseline: C60114MachineCoverageProjection;
  phaseA: [
    C60114MachineCoverageProjection,
    C60114MachineCoverageProjection,
    C60114MachineCoverageProjection,
  ];
  detectorOnly: C60114MachineCoverageProjection;
  final: C60114MachineCoverageProjection;
}): Projections142 {
  const old = namedProjection142(
    input.baseline,
    "C601141_BASELINE_FULL_QUEUE",
    "FULL_QUEUE_WITH_SAFETY_RESERVE",
  );
  const phaseA = input.phaseA.map((p) =>
    namedProjection142(p, "C601142_SELECTION_REPAIR_ONLY"),
  );
  const detectorOnly = namedProjection142(
    input.detectorOnly,
    "C601142_DETECTOR_CEILING_ONLY",
  );
  const final = namedProjection142(input.final, "C601142_FINAL_FULL_QUEUE");
  const oldSpeech = old.speechIslands;
  const newSpeech = (
    include: (row: Inventory142["observations"][number]) => boolean,
  ) => [
    ...oldSpeech,
    ...inventorySpeech142(
      input.inventory,
      (o) => o.scoreLevel !== "LEGACY" && include(o),
    ),
  ];
  const entries: {
    stage: Stage142;
    description: string;
    projection: C60114MachineCoverageProjection;
    workspaceRelativePath: string;
    officialPlanId: string;
  }[] = [
    {
      stage: "A0",
      description: "C601141 frozen baseline with actual physical playback",
      projection: old,
      workspaceRelativePath: "comparison-workspaces/baseline",
      officialPlanId: "C601141_BASELINE_FULL_QUEUE",
    },
    ...phaseA.map((projection, i) => ({
      stage: `A${i + 1}` as Stage142,
      description: required141(
        [
          "Atomic cluster-only preservation",
          "Cluster and evidence-stratum diversity",
          "Final selection V2 on old inventory; zero new inference",
        ][i],
      ),
      projection,
      workspaceRelativePath: `comparison-workspaces/A${i + 1}`,
      officialPlanId: "C601142_SELECTION_REPAIR_ONLY",
    })),
    {
      stage: "B1",
      description:
        "New deterministic PCM views only: no new speech claim without a detector",
      projection: old,
      workspaceRelativePath: "comparison-workspaces/baseline",
      officialPlanId: "C601141_BASELINE_FULL_QUEUE",
    },
    {
      stage: "B2",
      description:
        "Old inventory plus new-view Silero and Pyannote MAIN observations; unchanged physical baseline queue",
      projection: {
        ...old,
        speechIslands: newSpeech(
          (o) =>
            o.scoreLevel === "MAIN" &&
            (o.family === "SILERO" || o.family === "PYANNOTE"),
        ),
      },
      workspaceRelativePath: "comparison-workspaces/baseline",
      officialPlanId: "C601141_BASELINE_FULL_QUEUE",
    },
    {
      stage: "B3",
      description:
        "Old inventory plus independent WebRTC binary observations; unchanged physical baseline queue",
      projection: {
        ...old,
        speechIslands: newSpeech((o) => o.family === "WEBRTC"),
      },
      workspaceRelativePath: "comparison-workspaces/baseline",
      officialPlanId: "C601141_BASELINE_FULL_QUEUE",
    },
    {
      stage: "B4",
      description:
        "Old inventory plus frozen eligible subthreshold observations, not energy-only speech",
      projection: {
        ...old,
        speechIslands: newSpeech((o) => o.scoreLevel === "AUDIT_SUBTHRESHOLD"),
      },
      workspaceRelativePath: "comparison-workspaces/baseline",
      officialPlanId: "C601141_BASELINE_FULL_QUEUE",
    },
    {
      stage: "B5",
      description:
        "Combined inventory V5 without claiming that new detections were selected for baseline playback",
      projection: { ...old, speechIslands: final.speechIslands },
      workspaceRelativePath: "comparison-workspaces/baseline",
      officialPlanId: "C601141_BASELINE_FULL_QUEUE",
    },
    {
      stage: "B6",
      description:
        "Final safety selection with actual audio, before new local ASR lexical utility",
      projection: { ...final, lexicalEvidence: old.lexicalEvidence },
      workspaceRelativePath: "review-workspace",
      officialPlanId: "C601142_FINAL_FULL_QUEUE",
    },
    {
      stage: "B7",
      description:
        "Final selection plus bounded source-localized ASR candidates",
      projection: final,
      workspaceRelativePath: "review-workspace",
      officialPlanId: "C601142_FINAL_FULL_QUEUE",
    },
    {
      stage: "B8",
      description:
        "Final review delivery with all physical unique-audio budgets; ranker not retrained",
      projection: final,
      workspaceRelativePath: "review-workspace",
      officialPlanId: "C601142_FINAL_FULL_QUEUE",
    },
  ];
  const variants: Projection142[] = entries.map((v) =>
    projection142Schema.parse(
      hashed141({
        ...v,
        physicalAudioVerified: true,
        inferenceCount: 0,
        derivedFromFrozenEvidence: true,
      }),
    ),
  );
  const comparisonPlans = [
    {
      planId: "C601141_BASELINE_FULL_QUEUE",
      projection: old,
      workspaceRelativePath: "comparison-workspaces/baseline",
      officialPlanId: "C601141_BASELINE_FULL_QUEUE",
    },
    {
      planId: "C601142_SELECTION_REPAIR_ONLY",
      projection: required141(phaseA[2]),
      workspaceRelativePath: "comparison-workspaces/A3",
      officialPlanId: "C601142_SELECTION_REPAIR_ONLY",
    },
    {
      planId: "C601142_DETECTOR_CEILING_ONLY",
      projection: detectorOnly,
      workspaceRelativePath: "comparison-workspaces/detector-only",
      officialPlanId: "C601142_DETECTOR_CEILING_ONLY",
    },
    {
      planId: "C601142_FINAL_FULL_QUEUE",
      projection: final,
      workspaceRelativePath: "review-workspace",
      officialPlanId: "C601142_FINAL_FULL_QUEUE",
    },
  ].map(hashed141);
  return projections142Schema.parse(
    hashed141({
      ...header142(input.policy, input.inventory.sourceIdentity),
      artifactType: "c6-0-1-14-2-machine-coverage-projections",
      variants,
      comparisonPlans,
      newInferenceCount: 0,
      goldBlind: true,
      rankerRetrained: false,
      newOofRun: false,
    }),
  );
}
