import {
  c60114CoverageProjectionsSchema,
  c60114CoverageProjectionVariantSchema,
  type C60114CoverageProjections,
  type C60114CoverageProjectionVariant,
  type C60114MachineCoverageProjection,
  type C60114ProbeExecution,
  type C60114LocalizedLexicalEvidence,
  type C60114MissingSpeechEvidenceV3,
  type C60114ReviewItemsV4,
  type C60114ReviewRegionsV3,
  type C60114ReviewAudioManifestV3,
  type C60114PlaybackTimelineV2,
  type C60114LineageReconciliation,
  type C60114ProbeRelocalization,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { c60113HashPayload } from "../../packages/video-subtitler/src/review/c60113-region-features.js";
import {
  assertC60114SourceIdentity,
  c60114Coverage,
  c60114Id,
  c60114Intersection,
  c60114Subtract,
  c60114Union,
  uniqueC60114,
} from "../../packages/video-subtitler/src/review/c60114-policy.js";
import { planC60113PlayableSegments } from "../../packages/video-subtitler/src/review/c60113-playback-planner.js";
import { c60114ProbeSemanticHash } from "../../packages/video-subtitler/src/review/missing-dialogue-local-probe.js";
import { isC60114ObservedOrphan } from "../../packages/video-subtitler/src/review/orphan-speech-sweep.js";
import type { C60114Input } from "./c60114-input.js";
import type { C60114PreparedMachine } from "./c60114-prepare-machine.js";

type Projection = C60114MachineCoverageProjection;
type Target = Projection["targets"][number];
type Interval = Target["sourceInterval"];
type Stage = C60114CoverageProjectionVariant["stage"];
export interface C60114CoverageProjectionInput {
  /** Must be the machine-only loader result, whose legacy WAV bytes were verified. */
  baseline: Pick<C60114Input, "sourceIdentity"> & {
    previous: Pick<
      C60114Input["previous"],
      "items" | "regions" | "missing" | "families" | "playback" | "burden"
    >;
    delivery: {
      audio: Pick<
        C60114Input["delivery"]["audio"],
        "sourceMediaSha256" | "semanticHash" | "clips"
      >;
      freeze: Pick<
        C60114Input["delivery"]["freeze"],
        "sourceMediaSha256" | "semanticHash"
      >;
    };
  };
  prepared: Pick<
    C60114PreparedMachine,
    | "policy"
    | "sourceIdentity"
    | "speechIslands"
    | "orphanSweep"
    | "reviewTargets"
    | "selection"
  >;
  probes: C60114ProbeExecution;
  lexical: C60114LocalizedLexicalEvidence;
  missingEvidenceV3: C60114MissingSpeechEvidenceV3;
  items: C60114ReviewItemsV4;
  regions: C60114ReviewRegionsV3;
  audio: C60114ReviewAudioManifestV3;
  playback: C60114PlaybackTimelineV2;
  lineage?: C60114LineageReconciliation | null;
  relocalization?: C60114ProbeRelocalization;
}
const stageDescriptions = [
  "C60113 legacy lineage diagnostic with independent direct playback projection",
  "Direct interval evaluator only over C60113 frozen items, regions, WAVs and actual playback planner",
  "A1 plus full-current-cue and candidate source review targets",
  "A2 plus child speech-island targets",
  "A3 plus orphan speech targets and review items",
  "A4 plus localized Whisper evidence from frozen requests only",
  "A5 plus localized Reazon evidence from the same frozen requests",
  "A6 plus Missing Evidence V3 classification diagnostics",
  "A7 plus final atomic regions, newly verified WAVs and final playback segments",
] as const;
const planIds = new Set(
  [10, 20, 30, 40, 50]
    .map((n) => `UNIQUE_AUDIO_${n}_PERCENT`)
    .concat(["ALL_MANDATORY", "FULL_QUEUE"]),
);
const uniqueSeconds = (rows: readonly Interval[]): number =>
  c60114Union(rows).reduce((sum, row) => sum + row.end - row.start, 0);
const hashed = <T extends object>(value: T): T & { semanticHash: string } => ({
  ...value,
  semanticHash: c60113HashPayload(value),
});
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined)
    throw new Error(`C60114_PROJECTION_LINEAGE_MISSING:${label}`);
  return value;
}

function targetProjection(
  row: C60114PreparedMachine["reviewTargets"]["targets"][number],
): Target {
  return {
    reviewTargetId: row.reviewTargetId,
    parentReviewItemId: row.parentReviewItemId,
    sourceInterval: row.sourceInterval,
    mandatoryForAudio: row.mandatoryForAudio,
    ...(row.audioRequired !== undefined
      ? { audioRequired: row.audioRequired }
      : {}),
    sourceIdentity: row.sourceIdentity,
  };
}

/** Use the actual legacy UI planner independently for each frozen budget. */
function baselineDelivery(
  input: C60114CoverageProjectionInput,
  targets: Target[],
) {
  const { baseline } = input;
  const sourceIdentity = baseline.sourceIdentity;
  const physicalAudio: Projection["physicalAudio"] =
    baseline.delivery.audio.clips.map((clip) =>
      hashed({
        audioId: c60114Id("baseline-physical-audio", {
          regionId: clip.regionId,
          sha256: clip.sha256,
        }),
        relativePath: clip.relativePath,
        sourceMediaSha256: clip.sourceMediaSha256,
        sourceIdentity,
        sourceInterval: clip.extractedInterval,
        requestedInterval: clip.requestedInterval,
        sampleRate: clip.sampleRate,
        channels: clip.channelCount,
        bitDepth: clip.bitsPerSample,
        codec: "pcm_s16le",
        frameCount: clip.frameCount,
        actualDuration: clip.actualDurationSeconds,
        sha256: clip.sha256,
        playable: clip.playable,
        hashVerified: true,
        physicalMetadataVerified: true,
        coveredReviewTargetIds: targets
          .filter(
            (target) =>
              c60114Coverage(target.sourceInterval, [clip.extractedInterval]) >=
              0.8,
          )
          .map((target) => target.reviewTargetId),
        regionIds: [clip.regionId],
      }),
    );
  const regions: Projection["regions"] = baseline.previous.regions.regions.map(
    (region) => ({
      regionId: region.regionId,
      reviewItemIds: region.reviewItemIds,
      reviewTargetIds: targets
        .filter(
          (target) =>
            target.parentReviewItemId !== null &&
            region.reviewItemIds.includes(target.parentReviewItemId),
        )
        .map((target) => target.reviewTargetId),
      sourceIntervals: [region.sourceInterval],
      contextIntervals: [region.contextInterval],
      sourceIdentity,
    }),
  );
  const playbackSegments: Projection["playbackSegments"] = [];
  const uncovered: Interval[] = [];
  const plans: Projection["plans"] = baseline.previous.burden.plans
    .filter((plan) => planIds.has(plan.planId))
    .map((plan) => {
      const selected = plan.regionIds.flatMap((id) => {
        const region = required(
          baseline.previous.regions.regions.find((row) => row.regionId === id),
          id,
        );
        const audio = physicalAudio.find((row) => row.regionIds.includes(id));
        if (!audio) {
          uncovered.push(region.contextInterval);
          return [];
        }
        const intersection = c60114Intersection(
          region.contextInterval,
          audio.sourceInterval,
        );
        uncovered.push(
          ...c60114Subtract(
            region.contextInterval,
            intersection ? [intersection] : [],
          ),
        );
        return intersection
          ? [
              {
                regionId: id,
                itemIds: region.reviewItemIds,
                contextInterval: intersection,
                audioSourceInterval: audio.sourceInterval,
              },
            ]
          : [];
      });
      const actual = planC60113PlayableSegments({ regions: selected });
      const actualIds: string[] = [];
      for (const segment of actual) {
        const audio = required(
          physicalAudio.find((row) =>
            row.regionIds.includes(segment.playbackRegionId),
          ),
          segment.playbackRegionId,
        );
        const playbackSegmentId = c60114Id("baseline-actual-playback", {
          planId: plan.planId,
          segment,
        });
        actualIds.push(playbackSegmentId);
        playbackSegments.push(
          hashed({
            playbackSegmentId,
            audioId: audio.audioId,
            sourceInterval: segment.sourceInterval,
            audioLocalInterval: {
              start: segment.audioSeekStart,
              end: segment.audioSeekEnd,
            },
            reviewTargetIds: targets
              .filter(
                (target) =>
                  target.parentReviewItemId !== null &&
                  segment.itemIds.includes(target.parentReviewItemId) &&
                  c60114Intersection(
                    target.sourceInterval,
                    segment.sourceInterval,
                  ) !== null,
              )
              .map((target) => target.reviewTargetId),
            reviewItemIds: segment.itemIds,
            regionIds: segment.regionIds,
            sourceIdentity,
          }),
        );
      }
      const regionTargets = new Set(
        regions
          .filter((region) => plan.regionIds.includes(region.regionId))
          .flatMap((region) => region.reviewTargetIds),
      );
      const selectedTargets =
        plan.planId === "FULL_QUEUE"
          ? targets
          : plan.planId === "ALL_MANDATORY"
            ? targets.filter(
                (target) =>
                  target.mandatoryForAudio ||
                  regionTargets.has(target.reviewTargetId),
              )
            : targets.filter((target) =>
                regionTargets.has(target.reviewTargetId),
              );
      return {
        planId: plan.planId,
        budgetSeconds: plan.budgetSeconds,
        regionIds: plan.regionIds,
        reviewTargetIds: selectedTargets.map((target) => target.reviewTargetId),
        playbackSegmentIds: actualIds,
      };
    });
  return {
    regions,
    physicalAudio,
    playbackSegments,
    plans,
    uncovered: c60114Union(uncovered),
  };
}

function baselineSpeech(
  input: C60114CoverageProjectionInput,
): Projection["speechIslands"] {
  const sourceHash = machineQualitySemanticHash(input.baseline.sourceIdentity);
  const direct = input.prepared.speechIslands.audit.evidence
    .filter(
      (row) =>
        row.mappingStatus === "VERIFIED" &&
        row.sourceIdentityHash === sourceHash &&
        row.speechPositive &&
        !row.contradiction &&
        row.sourceInterval !== null,
    )
    .flatMap((row) => (row.sourceInterval ? [row.sourceInterval] : []));
  return input.baseline.previous.families.evidence
    .filter(
      (row) =>
        row.family === "SPEECH_ACTIVITY" &&
        row.validatedSourceGlobal &&
        row.positiveRisk &&
        !row.evidenceAbsence &&
        !row.contradiction &&
        row.sourceInterval !== null,
    )
    .flatMap((row) =>
      row.sourceInterval && c60114Coverage(row.sourceInterval, direct) >= 0.95
        ? [
            {
              islandId: `baseline-source-speech:${row.evidenceId}`,
              sourceInterval: row.sourceInterval,
              speechPositive: true,
              localizationStatus: "VERIFIED" as const,
              sourceIdentity: input.baseline.sourceIdentity,
            },
          ]
        : [],
    );
}

function lexicalProjection(
  input: C60114CoverageProjectionInput,
  stage: number,
): Projection["lexicalEvidence"] {
  if (stage < 2) return [];
  const sourceIdentity = input.baseline.sourceIdentity;
  const sourceHash = machineQualitySemanticHash(sourceIdentity);
  const rows: Projection["lexicalEvidence"] =
    input.prepared.speechIslands.audit.evidence
      .filter(
        (row) =>
          row.mappingStatus === "VERIFIED" &&
          row.sourceIdentityHash === sourceHash &&
          row.reliableLocalizedLexical &&
          !row.contradiction &&
          row.sourceInterval !== null,
      )
      .map((row) => ({
        evidenceId: `trusted-source-lexical:${row.evidenceId}`,
        sourceInterval: row.sourceInterval,
        reliableLocalizedLexical: true,
        mappingStatus: "VERIFIED",
        providerFamily: row.providerFamily,
        rootLineageIds: row.rootLineageIds,
        correlationGroup: row.correlationGroup,
        sourceIdentity,
      }));
  if (stage < 5) return rows;
  for (const request of input.probes.requests) {
    if (stage === 5 && request.provider !== "whisper-large-v3") continue;
    const target = input.lexical.targets.find(
      (target) => target.targetId === request.targetId,
    );
    const candidate = target?.candidates.find(
      (candidate) => candidate.requestId === request.requestId,
    );
    const derived = input.relocalization?.requests.find(
      (row) => row.requestId === request.requestId,
    );
    if (
      !target ||
      !candidate?.localized ||
      candidate.lexicalText === "" ||
      candidate.hallucinationRisk >= 0.6 ||
      request.status !== "SUCCESS" ||
      request.hallucinationRisk >= 0.6 ||
      (derived
        ? !derived.localizationVerified
        : request.localization.localizedText === null)
    )
      continue;
    if (
      request.sourceIdentityHash !== sourceHash ||
      request.sourceMediaSha256 !== sourceIdentity.sourceMediaSha256 ||
      request.policyHash !== input.prepared.policy.semanticHash ||
      request.selectionHash !== input.probes.selectionHash ||
      request.semanticHash !== c60114ProbeSemanticHash(request)
    )
      throw new Error(
        `C60114_PROJECTION_PROBE_IDENTITY_MISMATCH:${request.requestId}`,
      );
    let intervals: Interval[] = [];
    if (derived) {
      if (
        derived.originalRequestSemanticHash !== request.semanticHash ||
        derived.semanticHash !== c60113HashPayload(derived)
      )
        throw new Error("C60114_PROJECTION_RELOCALIZATION_MISMATCH");
      intervals = derived.projectedSourceIntervals;
    } else if (
      request.localization.status === "CORE_EXACT_ISLAND_LOCALIZED" &&
      request.localization.completeness === "WHOLE_EXACT_ISLAND" &&
      request.windowType === "CORE_EXACT"
    )
      intervals = [request.coreInterval];
    else if (
      request.localization.status === "TRUSTED_GLOBAL_TOKEN_PROJECTION" &&
      request.localization.completeness === "TOKEN_CHAIN_COMPLETE"
    ) {
      intervals = request.tokens.flatMap((token) => {
        if (!token.trusted || token.sourceInterval === null) return [];
        const local = c60114Intersection(
          token.sourceInterval,
          request.coreInterval,
        );
        return local ? [local] : [];
      });
    }
    const root = `c60114-probe-family:${request.provider}:${request.modelIdentityHash}:${request.targetId}`;
    c60114Union(intervals).forEach((sourceInterval, index) =>
      rows.push({
        evidenceId: `probe-localized:${request.requestId}:${index}`,
        sourceInterval,
        reliableLocalizedLexical: true,
        mappingStatus: "VERIFIED",
        providerFamily: request.provider,
        rootLineageIds: [root],
        correlationGroup: root,
        sourceIdentity,
      }),
    );
  }
  return rows;
}

/** Deterministic A0-A8 machine variants. It cannot read Gold, fit a selector or run ASR. */
export function buildC60114CoverageProjections(
  input: C60114CoverageProjectionInput,
): C60114CoverageProjections {
  const sourceIdentity = input.baseline.sourceIdentity;
  for (const artifact of [
    input.prepared,
    input.prepared.speechIslands,
    input.prepared.orphanSweep,
    input.prepared.reviewTargets,
    input.probes,
    input.lexical,
    input.missingEvidenceV3,
    input.items,
    input.regions,
    input.audio,
    input.playback,
  ])
    assertC60114SourceIdentity(artifact.sourceIdentity, sourceIdentity);
  if (
    input.baseline.delivery.freeze.sourceMediaSha256 !==
      sourceIdentity.sourceMediaSha256 ||
    input.baseline.delivery.audio.sourceMediaSha256 !==
      sourceIdentity.sourceMediaSha256
  )
    throw new Error("C60114_PROJECTION_BASELINE_SOURCE_MISMATCH");
  if (
    input.lexical.probeSemanticHash !== input.probes.semanticHash ||
    input.missingEvidenceV3.lexicalEvidenceHash !==
      input.lexical.semanticHash ||
    input.probes.selectionHash !== input.prepared.selection.semanticHash
  )
    throw new Error("C60114_PROJECTION_MACHINE_EVIDENCE_LINEAGE_MISMATCH");
  const targetsHash = input.prepared.reviewTargets.semanticHash;
  if (
    input.items.targetsHash !== targetsHash ||
    input.regions.targetsHash !== targetsHash ||
    input.regions.itemsHash !== input.items.semanticHash ||
    input.audio.regionsHash !== input.regions.semanticHash ||
    input.playback.targetsHash !== targetsHash ||
    input.playback.regionsHash !== input.regions.semanticHash ||
    input.playback.audioManifestHash !== input.audio.semanticHash
  )
    throw new Error("C60114_PROJECTION_FINAL_DELIVERY_LINEAGE_MISMATCH");
  const baseSpeech = baselineSpeech(input);
  const variants = stageDescriptions.map((description, stage) => {
    const allTargets = input.prepared.reviewTargets.targets;
    const targets: Target[] =
      stage < 2
        ? input.baseline.previous.items.items.map((item) => ({
            reviewTargetId: `baseline-item-core:${item.reviewItemId}`,
            parentReviewItemId: item.reviewItemId,
            sourceInterval: item.coreInterval,
            mandatoryForAudio: item.requiredLevel === "REQUIRED",
            sourceIdentity,
          }))
        : allTargets
            .filter(
              (target) =>
                stage >= 4 || target.targetType !== "ORPHAN_SPEECH_TARGET",
            )
            .filter(
              (target) =>
                stage >= 3 ||
                target.targetType !== "MISSING_SPEECH_ISLAND_TARGET",
            )
            .map(targetProjection);
    const oldIds = new Set(
      input.baseline.previous.items.items.map((item) => item.reviewItemId),
    );
    const itemIds =
      stage < 3
        ? [...oldIds]
        : uniqueC60114([
            ...oldIds,
            ...targets.flatMap((target) =>
              target.parentReviewItemId ? [target.parentReviewItemId] : [],
            ),
          ]);
    const legacyDelivery = baselineDelivery(input, targets);
    const speech: Projection["speechIslands"] =
      stage < 3
        ? baseSpeech
        : uniqueC60114([
            ...input.prepared.speechIslands.islands.map((row) => row.islandId),
            ...(stage >= 4
              ? input.prepared.speechIslands.globalIslands.map(
                  (row) => row.islandId,
                )
              : []),
          ]).map((id) => {
            const row = required(
              [
                ...input.prepared.speechIslands.islands,
                ...input.prepared.speechIslands.globalIslands,
              ].find((row) => row.islandId === id),
              id,
            );
            return {
              islandId: row.islandId,
              sourceInterval: row.sourceInterval,
              speechPositive: row.speechPositive && !row.strongContradiction,
              localizationStatus: row.localizationStatus,
              sourceIdentity,
            };
          });
    const orphans: Projection["orphans"] =
      stage < 4
        ? []
        : input.prepared.orphanSweep.entries
            .filter(isC60114ObservedOrphan)
            .map((row) => ({
              orphanId: row.orphanId,
              sourceInterval: row.sourceInterval,
              speechPositive: row.speechPositive && !row.strongContradiction,
              localizationStatus:
                row.durationStatus === "BOUNDED" ? "VERIFIED" : "UNRESOLVED",
              sourceIdentity,
            }));
    const projection: Projection = {
      sourceIdentity,
      items: itemIds.map((reviewItemId) => ({ reviewItemId, sourceIdentity })),
      targets,
      regions:
        stage < 8
          ? legacyDelivery.regions
          : input.regions.regions.map((row) => ({
              regionId: row.regionId,
              reviewTargetIds: row.reviewTargetIds,
              reviewItemIds: row.reviewItemIds,
              sourceIntervals: row.sourceIntervals,
              contextIntervals: row.contextIntervals,
              sourceIdentity: row.sourceIdentity,
            })),
      physicalAudio:
        stage < 8 ? legacyDelivery.physicalAudio : input.audio.audio,
      playbackSegments:
        stage < 8 ? legacyDelivery.playbackSegments : input.playback.segments,
      plans:
        stage < 8
          ? legacyDelivery.plans
          : input.playback.plans.map((row) => ({
              planId: row.planId,
              budgetSeconds: row.budgetSeconds,
              regionIds: row.regionIds,
              reviewTargetIds: row.reviewTargetIds,
              playbackSegmentIds: row.playbackSegmentIds,
            })),
      speechIslands: speech,
      lexicalEvidence: lexicalProjection(input, stage),
      orphans,
      ...(stage >= 3 && input.lineage
        ? {
            lineageEvidence: input.lineage.entries.map((row) => ({
              evidenceId: row.evidenceId,
              sourceIdentity,
              claimedInterval: row.expectedSourceInterval,
              status: row.status,
              speechPositive: row.nativeSpeechObservation,
            })),
          }
        : {}),
    };
    const fullPlan = required(
      projection.plans.find((plan) => plan.planId === "FULL_QUEUE"),
      "FULL_QUEUE",
    );
    const audible = projection.playbackSegments
      .filter((segment) =>
        fullPlan.playbackSegmentIds.includes(segment.playbackSegmentId),
      )
      .flatMap((segment) => {
        const audio = projection.physicalAudio.find(
          (audio) => audio.audioId === segment.audioId,
        );
        const common = audio
          ? c60114Intersection(segment.sourceInterval, audio.sourceInterval)
          : null;
        return common ? [common] : [];
      });
    const uncoveredTargetIds = targets
      .filter((target) => c60114Coverage(target.sourceInterval, audible) < 0.8)
      .map((target) => target.reviewTargetId);
    const probeRequests =
      stage < 5
        ? []
        : input.probes.requests.filter(
            (request) => stage > 5 || request.provider === "whisper-large-v3",
          );
    const missingClassificationCounts: Record<string, number> = {};
    if (stage >= 7)
      for (const row of input.missingEvidenceV3.targets)
        missingClassificationCounts[row.classification] =
          (missingClassificationCounts[row.classification] ?? 0) + 1;
    const variant = {
      stage: `A${stage}` as Stage,
      description,
      projection,
      diagnostics: {
        comparisonRole:
          stage === 0
            ? "LEGACY_LINEAGE_DIAGNOSTIC_BASELINE"
            : "DIRECT_PLAYBACK_GROUNDED_COMPARISON",
        lineageRecallMeaning: "NOT_A_PLAYBACK_RECALL_METRIC",
        physicalAudioOrigin:
          stage < 8
            ? "BASELINE_C60113_VERIFIED_WAV"
            : "C60114_FINAL_VERIFIED_WAV",
        parentGapCount: input.baseline.previous.missing.gaps.length,
        speechIslandCount: stage < 3 ? 0 : speech.length,
        machineSpeechEvidenceIntervalCount: speech.length,
        orphanCount: orphans.length,
        probeTargetCount: new Set(
          probeRequests.map((request) => request.targetId),
        ).size,
        probeRequestCount: probeRequests.length,
        localizedLexicalCount: projection.lexicalEvidence.length,
        localizedLexicalRequestIds: uniqueC60114(
          probeRequests
            .filter((request) =>
              projection.lexicalEvidence.some((row) =>
                row.evidenceId.startsWith(
                  `probe-localized:${request.requestId}:`,
                ),
              ),
            )
            .map((request) => request.requestId),
        ),
        itemCount: projection.items.length,
        targetCount: targets.length,
        regionCount: projection.regions.length,
        audioCount: projection.physicalAudio.length,
        targetAudioCoverage: {
          threshold: 0.8,
          totalTargets: targets.length,
          coveredTargets: targets.length - uncoveredTargetIds.length,
          coverageRatio: targets.length
            ? (targets.length - uncoveredTargetIds.length) / targets.length
            : 1,
          uncoveredTargetIds,
        },
        audioBurden: {
          clipSumSeconds: projection.physicalAudio.reduce(
            (sum, audio) => sum + audio.actualDuration,
            0,
          ),
          uniquePhysicalAudioSeconds: uniqueSeconds(
            projection.physicalAudio.map((audio) => audio.sourceInterval),
          ),
          selectedFullQueueUniqueAudioSeconds: uniqueSeconds(audible),
        },
        missingClassificationCounts,
        unboundTargetIds: targets
          .filter(
            (target) =>
              !projection.regions.some((region) =>
                region.reviewTargetIds.includes(target.reviewTargetId),
              ),
          )
          .map((target) => target.reviewTargetId),
        baselinePlaybackIntervalsWithoutPhysicalAudio:
          stage < 8 ? legacyDelivery.uncovered : [],
        sourceArtifactHashes: {
          baselineItems: input.baseline.previous.items.semanticHash,
          baselineRegions: input.baseline.previous.regions.semanticHash,
          baselineBurden: input.baseline.previous.burden.semanticHash,
          baselinePlayback: input.baseline.previous.playback.semanticHash,
          baselineAudio: input.baseline.delivery.audio.semanticHash,
          baselineFreeze: input.baseline.delivery.freeze.semanticHash,
          policy: input.prepared.policy.semanticHash,
          ...(stage >= 3 && input.lineage
            ? { sourceLineage: input.lineage.semanticHash }
            : {}),
          ...(stage >= 5 && input.relocalization
            ? { probeRelocalization: input.relocalization.semanticHash }
            : {}),
          ...(stage >= 2
            ? { targets: input.prepared.reviewTargets.semanticHash }
            : {}),
          ...(stage >= 3
            ? { speechIslands: input.prepared.speechIslands.semanticHash }
            : {}),
          ...(stage >= 4
            ? {
                orphanSweep: input.prepared.orphanSweep.semanticHash,
                itemsV4: input.items.semanticHash,
              }
            : {}),
          ...(stage >= 5
            ? {
                selectedProbeRequestSubset: machineQualitySemanticHash(
                  probeRequests.map((request) => request.semanticHash),
                ),
                lexical: input.lexical.semanticHash,
              }
            : {}),
          ...(stage >= 7
            ? { missingEvidenceV3: input.missingEvidenceV3.semanticHash }
            : {}),
          ...(stage >= 8
            ? {
                regionsV3: input.regions.semanticHash,
                audioV3: input.audio.semanticHash,
                playbackV2: input.playback.semanticHash,
              }
            : {}),
        },
        runtimeGoldInputCount: 0,
        projectionInferenceCount: 0,
        canonicalTextMutationCount: 0,
        canonicalTimingMutationCount: 0,
        machineDraftMutationCount: 0,
        sourceMutationCount: 0,
        selectionRetunedFromGold: false,
      },
    };
    return c60114CoverageProjectionVariantSchema.parse(hashed(variant));
  });
  return c60114CoverageProjectionsSchema.parse(
    hashed({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-machine-coverage-projections",
      policyVersion: "c6.0.1.14-playback-grounded-coverage-v1",
      sourceIdentity,
      variants,
      runtimeGoldInputCount: 0,
    }),
  );
}
