import {
  mediaProfileSchema,
  type C60114Policy,
  type C60114ProbeSelection,
} from "@mvl/shared";
import { reconcileC60114SourceGlobalLineage } from "../../packages/video-subtitler/src/review/c60114-source-lineage-reconciliation.js";
import { machineQualitySemanticHash } from "../../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import {
  buildC60114Policy,
  uniqueC60114,
} from "../../packages/video-subtitler/src/review/c60114-policy.js";
import {
  adaptC60114MachineEvidence,
  buildC60114SourceGlobalSpeechIslands,
  type C60114ArtifactBindings,
  type C60114MachineEvidenceArtifacts,
} from "../../packages/video-subtitler/src/review/source-global-speech-islands.js";
import {
  buildC60114ReviewTargetIntervalsV2,
  type C60114ReviewAnchor,
} from "../../packages/video-subtitler/src/review/review-target-intervals-v2.js";
import { buildC60114OrphanSpeechSweep } from "../../packages/video-subtitler/src/review/orphan-speech-sweep.js";
import { selectC60114MissingDialogueProbes } from "../../packages/video-subtitler/src/review/missing-dialogue-probe-selection.js";
import { type C60114Input } from "./c60114-input.js";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Pure machine preparation: no file writes, evaluator inputs, model execution,
 * network, subtitle mutation, or source-directory-based trust inheritance. */
export function prepareC60114Machine(
  input: C60114Input,
  policy: C60114Policy = buildC60114Policy(),
  completion?: {
    reconcileLineage: boolean;
    frozenSelection: C60114ProbeSelection;
  },
) {
  const raw = input.machineArtifacts;
  const artifacts: C60114MachineEvidenceArtifacts = {
    vadTimebase: raw.vadTimebase,
    requestTimeline: raw["asr-request-timeline-contract-v2.json"],
    tokenTimeline: raw["machine-global-token-timeline-v2.json"],
    canonicalSegments: raw["canonical-asr-segments.json"],
    rawTranscription: raw["audio/raw-transcription.json"],
    candidateEvidence: raw["cue-candidate-evidence.json"],
    speakerEvidence: raw.speakerEvidence,
    acousticScenes: raw.acousticScenes,
  };
  const sourceInfo = record(raw["source-info.json"]);
  const audioStreams = (
    Array.isArray(sourceInfo.streams) ? sourceInfo.streams : []
  )
    .map(record)
    .filter((s) => s.type === "audio");
  const profile = mediaProfileSchema.safeParse(raw["media-profile.json"]);
  const sourceFormat = record(sourceInfo.format);
  const audioSourceBound =
    input.replay.sourceIdentity.sha256 ===
      input.sourceIdentity.sourceMediaSha256 &&
    input.replay.freeze.sourceMediaSha256 ===
      input.sourceIdentity.sourceMediaSha256 &&
    sourceInfo.fileSizeBytes === input.replay.sourceIdentity.size &&
    typeof sourceFormat.durationSeconds === "number" &&
    Math.abs(
      sourceFormat.durationSeconds - input.sourceIdentity.durationSeconds,
    ) <= policy.exactGuardSeconds &&
    audioStreams.length === 1 &&
    audioStreams[0]?.index === input.sourceIdentity.audioStreamIndex &&
    audioStreams[0].sampleRate === input.sourceIdentity.sampleRate &&
    profile.success &&
    profile.data.audioTrack.index === input.sourceIdentity.audioStreamIndex &&
    profile.data.audioTrack.sampleRate === input.sourceIdentity.sampleRate &&
    Math.abs(
      profile.data.durationSeconds - input.sourceIdentity.durationSeconds,
    ) <= policy.exactGuardSeconds;
  const bindings: C60114ArtifactBindings = {};
  // VAD/request/token containers have native source hashes and integer sample
  // mappings. The adapter separately recomputes those hashes and conversions.
  // Candidate *coordinates* are not inherited from this binding: only literal
  // token-localized candidate derivatives can become verified anchors.
  for (const key of [
    "vadTimebase",
    "requestTimeline",
    "tokenTimeline",
    "candidateEvidence",
  ] as const) {
    if (artifacts[key] === undefined) continue;
    bindings[key] = {
      sourceIdentity: input.sourceIdentity,
      artifactSemanticHash: machineQualitySemanticHash(artifacts[key]),
      coordinateSystem: "SOURCE_GLOBAL_SECONDS",
      verified: audioSourceBound,
      verificationEvidenceIds: audioSourceBound
        ? [
            `source-sha256:${input.replay.sourceIdentity.sha256}`,
            `upstream-machine-freeze:${input.replay.freeze.semanticHash}`,
            `source-info:${machineQualitySemanticHash(sourceInfo)}`,
            `selected-audio-profile:${machineQualitySemanticHash(profile.data)}`,
            `live-ffprobe-selection:${machineQualitySemanticHash(input.sourceIdentity)}`,
          ]
        : [],
    };
  }
  const adapted = adaptC60114MachineEvidence({
    sourceIdentity: input.sourceIdentity,
    artifacts,
    bindings,
  });
  const lineage = completion?.reconcileLineage
    ? reconcileC60114SourceGlobalLineage({
        sourceIdentity: input.sourceIdentity,
        policy,
        evidence: adapted.evidence,
        artifacts,
        sourceAudioBindingVerified: audioSourceBound,
      })
    : null;
  const finalCues = input.replay.subtitlePackage.cues.map(
    ({ id, start, end }) => ({ id, start, end }),
  );
  const items = input.previous.items.items;
  const parentGaps = input.previous.missing.gaps.map((g) => ({
    gapId: g.gapId,
    sourceInterval: g.sourceInterval,
    itemIds: g.itemIds,
    searchEnvelopeOnly: true as const,
  }));
  const speechIslands = buildC60114SourceGlobalSpeechIslands({
    sourceIdentity: input.sourceIdentity,
    policy,
    evidence: lineage?.evidence ?? adapted.evidence,
    parentGaps,
    finalCues,
    unavailableArtifactIds: adapted.unavailableArtifactIds,
  });
  const candidateAnchors: C60114ReviewAnchor[] =
    adapted.candidateLocalizations.flatMap((local) => {
      const itemIds = items
        .filter((item) => {
          const bundle = input.replay.candidates.bundles.find(
            (b) => b.reviewItemId === item.reviewItemId,
          );
          return uniqueC60114([
            ...item.candidateIds,
            ...item.finalCueIds,
            ...(bundle?.displayCandidates.flatMap((d) =>
              d.provenance.map((p) => p.candidateId),
            ) ?? []),
          ]).includes(local.candidateId);
        })
        .map((i) => i.reviewItemId);
      return itemIds.length
        ? [
            {
              itemIds,
              targetType: "CANDIDATE_SOURCE_TARGET" as const,
              sourceInterval: local.sourceInterval,
              targetAnchorIds: local.targetAnchorIds,
              evidenceIds: local.evidenceIds,
              sourceIdentity: input.sourceIdentity,
              verified: true,
            },
          ]
        : [];
    });
  const initialTargets = buildC60114ReviewTargetIntervalsV2({
    sourceIdentity: input.sourceIdentity,
    policy,
    items,
    finalCues,
    speechIslands,
    anchors: candidateAnchors,
  });
  const orphanSweep = buildC60114OrphanSpeechSweep({
    sourceIdentity: input.sourceIdentity,
    policy,
    speechIslands,
    finalCues,
    reviewTargets: initialTargets,
  });
  const reviewTargets = buildC60114ReviewTargetIntervalsV2({
    sourceIdentity: input.sourceIdentity,
    policy,
    items,
    finalCues,
    speechIslands,
    orphanSweep,
    anchors: candidateAnchors,
  });
  const computedSelection = selectC60114MissingDialogueProbes({
    sourceIdentity: input.sourceIdentity,
    policy,
    speechIslands,
    orphanSweep,
    finalCues,
  });
  // Frozen executed selection is immutable; recomputed targets are shadow-only.
  const selection = completion?.frozenSelection ?? computedSelection;
  return {
    policy,
    sourceIdentity: input.sourceIdentity,
    bindings,
    adapted,
    lineage: lineage?.artifact ?? null,
    computedSelection,
    speechIslands,
    initialTargets,
    orphanSweep,
    reviewTargets,
    selection,
    candidateAnchors,
    summary: {
      sourceAudioBindingVerified: audioSourceBound,
      verifiedEvidenceCount: speechIslands.audit.verifiedCount,
      quarantinedEvidenceCount: speechIslands.audit.quarantinedCount,
      childIslandCount: speechIslands.islands.length,
      globalIslandCount: speechIslands.globalIslands.length,
      candidateLocalizedSpanCount: adapted.candidateLocalizations.length,
      candidateReviewAnchorCount: candidateAnchors.length,
      initialTargetCount: initialTargets.targets.length,
      reviewTargetCount: reviewTargets.targets.length,
      orphanCount: orphanSweep.summary.orphanCount,
      probeTargetCount: selection.targets.length,
      asrInferenceCount: 0 as const,
      runtimeGoldInputCount: 0 as const,
      canonicalTextMutationCount: 0 as const,
      canonicalTimingMutationCount: 0 as const,
    },
  };
}
export type C60114PreparedMachine = ReturnType<typeof prepareC60114Machine>;
