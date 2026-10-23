import {
  c601141CoverageProjectionsSchema,
  c60114MachineCoverageProjectionSchema,
  type C60114MachineCoverageProjection,
  type C601141Inventory,
  type C601141Policy,
  type C601141CoverageProjections,
  type C601141AsrProbes,
  type C601141AudioViews,
} from "@mvl/shared";
import type { C60112ReviewWorkspaceData } from "../../packages/video-subtitler/src/review/c60112-review-workspace.js";
import { assertInventoryWorkspace141 } from "../../packages/video-subtitler/src/review/c601141-review-delivery.js";
import {
  header141,
  hashed141,
  seconds141,
  unique141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

/** No labels, Gold paths, text matching or inference. Projections are frozen with
 * the final machine graph and evaluated later using the unchanged C60114 logic. */
export function coverageProjections141(input: {
  baseline: C60114MachineCoverageProjection;
  workspace: C60112ReviewWorkspaceData;
  inventory: C601141Inventory;
  views: C601141AudioViews;
  probes: C601141AsrProbes;
  policy: C601141Policy;
}): C601141CoverageProjections {
  assertInventoryWorkspace141(input.workspace);
  const data = input.workspace.speechInventoryReviewV1,
    compat = input.workspace.sourceTargetReviewV3;
  if (!data || !compat)
    throw new Error("C601141_COVERAGE_REQUIRES_PHYSICAL_DELIVERY");
  const sourceIdentity = data.sourceIdentity,
    old = c60114MachineCoverageProjectionSchema.parse(input.baseline);
  const newLexical: C60114MachineCoverageProjection["lexicalEvidence"] = [];
  for (const target of data.lexical.targets)
    for (const candidate of target.localizedTextCandidates) {
      const request = input.probes.requests.find(
        (row) => row.requestId === candidate.requestId,
      );
      if (
        !request?.localizedText ||
        request.strongContradiction ||
        request.hallucinationRisk >= 0.6
      )
        continue;
      // A localized single-model candidate is available for human comparison,
      // not a claim of transcript truth. Strong Missing still requires agreement.
      newLexical.push({
        evidenceId: candidate.requestId,
        sourceInterval: target.sourceInterval,
        reliableLocalizedLexical: true,
        mappingStatus: "VERIFIED",
        providerFamily: request.provider,
        rootLineageIds: [request.requestId],
        correlationGroup: request.provider,
        sourceIdentity,
      });
    }
  const history = data.lexical.historicalFingerprintCandidates.map((row) => ({
    evidenceId: row.evidenceId,
    sourceInterval: row.sourceInterval,
    reliableLocalizedLexical: true,
    mappingStatus: "VERIFIED" as const,
    providerFamily: "LEGACY_WHISPER",
    rootLineageIds: row.requestIds,
    correlationGroup: "LEGACY_WHISPER",
    sourceIdentity,
  }));
  const observations = (
    include: (row: C601141Inventory["observations"][number]) => boolean,
  ) =>
    input.inventory.observations.filter(include).map((row) => ({
      islandId: row.observationId,
      sourceInterval: seconds141(row.nativeInterval, sourceIdentity.sampleRate),
      speechPositive: row.speechPositive && !row.strongContradiction,
      localizationStatus: row.verifiedTimebase
        ? ("VERIFIED" as const)
        : ("UNRESOLVED" as const),
      sourceIdentity,
    }));
  const final: C60114MachineCoverageProjection =
    c60114MachineCoverageProjectionSchema.parse({
      sourceIdentity,
      items: data.items.items.map((row) => ({
        reviewItemId: row.reviewItemId,
        sourceIdentity,
      })),
      targets: data.targets.targets.map((row) => ({
        reviewTargetId: row.reviewTargetId,
        parentReviewItemId: row.parentReviewItemId,
        sourceInterval: row.sourceInterval,
        mandatoryForAudio: row.mandatoryForAudio,
        audioRequired: row.audioRequired,
        sourceIdentity,
      })),
      regions: data.regions.regions.map((row) => ({
        regionId: row.regionId,
        reviewTargetIds: row.reviewTargetIds,
        reviewItemIds: row.reviewItemIds,
        sourceIntervals: row.sourceIntervals,
        contextIntervals: row.contextIntervals,
        sourceIdentity,
      })),
      physicalAudio: compat.audio.audio,
      playbackSegments: compat.playback.segments,
      plans: data.playback.plans.map((row) => ({
        planId: row.planId,
        budgetSeconds: row.budgetSeconds,
        regionIds: row.regionIds,
        reviewTargetIds: row.reviewTargetIds,
        playbackSegmentIds: row.playbackSegmentIds,
      })),
      speechIslands: input.inventory.islands.map((row) => ({
        islandId: row.islandId,
        sourceInterval: row.sourceInterval,
        speechPositive: row.verifiedTimebase && !row.strongContradiction,
        localizationStatus: row.verifiedTimebase ? "VERIFIED" : "UNRESOLVED",
        sourceIdentity,
      })),
      lexicalEvidence: [...old.lexicalEvidence, ...history, ...newLexical],
      orphans: old.orphans,
      lineageEvidence: old.lineageEvidence,
    });
  const native = input.views.views.find(
    (row) => row.role === "NATIVE_MONO",
  )?.viewId;
  if (!native) throw new Error("C601141_NATIVE_VIEW_MISSING");
  const descriptions = [
    "C60114 unchanged baseline",
    "Legacy fingerprint only",
    "Existing plus native Silero sensitive-v2",
    "Existing plus native Silero two frozen profiles",
    "Existing plus all distinct PCM Silero views and profiles",
    "Existing plus Pyannote anonymous activity",
    "Combined source-global inventory with baseline review delivery",
    "Combined inventory plus frozen safety targets and verified audio",
    "A7 plus bounded localized ASR evidence",
    "Final review package with all nine physical playback plans",
  ];
  const stageSpeech = [
    old.speechIslands,
    observations((v) => v.family === "LEGACY_FINGERPRINT"),
    [
      ...old.speechIslands,
      ...observations(
        (v) =>
          v.family === "SILERO" &&
          v.viewId === native &&
          v.profileId === "sensitive-v2",
      ),
    ],
    [
      ...old.speechIslands,
      ...observations((v) => v.family === "SILERO" && v.viewId === native),
    ],
    [...old.speechIslands, ...observations((v) => v.family === "SILERO")],
    [...old.speechIslands, ...observations((v) => v.family === "PYANNOTE")],
    final.speechIslands,
    final.speechIslands,
    final.speechIslands,
    final.speechIslands,
  ];
  const variants = descriptions.map((description, index) => {
    const projection = c60114MachineCoverageProjectionSchema.parse({
      ...(index >= 7 ? final : old),
      speechIslands: stageSpeech[index],
      lexicalEvidence:
        index >= 8
          ? final.lexicalEvidence
          : index === 1
            ? history
            : old.lexicalEvidence,
    });
    // The 9 named plans are present in final stages only. Earlier ablations use
    // the unchanged baseline FULL_QUEUE; they never synthesize extra audio.
    if (
      unique141(projection.physicalAudio.map((row) => row.audioId)).length !==
      projection.physicalAudio.length
    )
      throw new Error("C601141_DUPLICATE_PHYSICAL_AUDIO_PROJECTION");
    return hashed141({
      stage: `A${index}`,
      description,
      projection,
      physicalAudioOrigin:
        index >= 7 ? "VERIFIED_C601141_FINAL" : "VERIFIED_C60114_BASELINE",
    });
  });
  return c601141CoverageProjectionsSchema.parse(
    hashed141({
      ...header141(input.policy, sourceIdentity),
      artifactType: "c6-0-1-14-1-machine-coverage-projections",
      variants,
      ablationChangesMachineSelection: false,
      newInferenceCount: 0,
      rankerRetrained: false,
    }),
  );
}
