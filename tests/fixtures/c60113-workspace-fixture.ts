import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  c60113FeatureNames,
  type C60113RegionPriorityEntry,
} from "@mvl/shared";
import { buildC60113RegionFeatures } from "../../packages/video-subtitler/src/review/c60113-region-features.js";
import { buildC60113ReviewPolicy } from "../../packages/video-subtitler/src/review/c60113-policy.js";
import { c60113DeploymentRanker } from "../../packages/video-subtitler/src/review/c60113-prospective-trial-package.js";
import { selectC60113DeploymentRegions } from "../../packages/video-subtitler/src/review/c60113-region-ranker-deployment.js";
import {
  buildC60113WorkspaceExtension,
  c60113WorkspaceHash,
} from "../../packages/video-subtitler/src/review/c60113-review-workspace.js";
import {
  writeC60112ReviewWorkspace,
  C60112_REVIEW_WORKSPACE_VERSION,
  type C60112ReviewWorkspaceData,
} from "../../packages/video-subtitler/src/review/c60112-review-workspace.js";

export function c60113SyntheticWorkspace(): C60112ReviewWorkspaceData {
  const data: C60112ReviewWorkspaceData = {
    schemaVersion: "1.0.0",
    workspaceVersion: C60112_REVIEW_WORKSPACE_VERSION,
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2",
    policyHash: "a".repeat(64),
    reviewPackageSemanticHash: "b".repeat(64),
    machineDraftHash: "c".repeat(64),
    sourceMediaIdentity: { sha256: "d".repeat(64), sourceDurationMs: 30000 },
    machineDraftIdentity: { cueHash: "c".repeat(64), cueCount: 2 },
    items: [0, 1].map((i) => ({
      reviewItemId: `item-${i}`,
      eventIds: [`event-${i}`],
      finalCueIds: [`cue-${i}`],
      itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
      sourceInterval: { start: 4 + 2 * i, end: 8 + 2 * i },
      coreInterval: { start: 5 + 2 * i, end: 7 + 2 * i },
      currentText: `合成テスト${i}`,
      currentStart: 5 + 2 * i,
      currentEnd: 7 + 2 * i,
      candidateIds: [`candidate-${i}`],
      evidenceIds: [`evidence-${i}`],
      reviewReasons: ["WHISPER_REAZON_LEXICAL_CONFLICT"],
      priorityTier: "HIGH",
      priorityScore: 60 - i,
      requiredLevel: i === 0 ? "REQUIRED" : "RECOMMENDED",
      suggestedActions: [
        "KEEP_CURRENT",
        "MANUAL_EDIT",
        "USE_REAZON",
        "TIMING_EDIT",
        "UNRESOLVED",
        "WAIVE_REVIEW",
      ],
      regionId: `region-${i}`,
      previousCue: null,
      nextCue: null,
      semanticHash: "e".repeat(64),
    })),
    regions: [0, 1].map((i) => ({
      regionId: `region-${i}`,
      reviewItemIds: [`item-${i}`],
      contextStart: 4 + 2 * i,
      contextEnd: 8 + 2 * i,
      coreIntervals: [{ start: 5 + 2 * i, end: 7 + 2 * i }],
      audioPath: `audio/region-${i}.wav`,
      audioSha256: null,
    })),
    candidateBundles: [0, 1].map((i) => ({
      reviewItemId: `item-${i}`,
      candidates: [
        {
          candidateId: `candidate-${i}`,
          labels: ["REAZON"],
          text: `編集用の合成候補${i}`,
          evidenceBadges: ["PARTIAL_CANDIDATE_ONLY"],
          provenance: ["synthetic"],
        },
      ],
    })),
  };
  data.regionReviewV2 = buildC60113WorkspaceExtension({
    policyHash: "f".repeat(64),
    regions: data.regions.map((r, i) => ({
      regionId: r.regionId,
      itemIds: r.reviewItemIds,
      rankPosition: i + 1,
      rankScore: 60 - i,
      contextInterval: { start: r.contextStart, end: r.contextEnd },
      mandatoryReasons: i ? [] : ["STRUCTURAL_CORRUPTION"],
      independentEvidenceFamilies: ["CROSS_MODEL_CONTENT"],
      candidateActionableCount: 1,
      estimatedUniqueAudioSeconds: 4,
      missingSpeechStates: ["SPEECH_GAP_OBSERVED"],
    })),
    plans: [
      "UNIQUE_AUDIO_10_PERCENT",
      "UNIQUE_AUDIO_20_PERCENT",
      "UNIQUE_AUDIO_30_PERCENT",
      "UNIQUE_AUDIO_40_PERCENT",
      "UNIQUE_AUDIO_50_PERCENT",
      "ALL_MANDATORY",
      "FULL_QUEUE",
    ].map((planId) => ({
      planId: planId as "FULL_QUEUE",
      budgetSeconds: null,
      regionIds: ["region-0", "region-1"],
      uniqueUnionSeconds: 6,
    })),
    segments: [
      {
        segmentId: "segment-a",
        sourceInterval: { start: 4, end: 6 },
        regionIds: ["region-0"],
        itemIds: ["item-0"],
      },
      {
        segmentId: "segment-b",
        sourceInterval: { start: 6, end: 8 },
        regionIds: ["region-0", "region-1"],
        itemIds: ["item-0", "item-1"],
      },
      {
        segmentId: "segment-c",
        sourceInterval: { start: 8, end: 10 },
        regionIds: ["region-1"],
        itemIds: ["item-1"],
      },
    ],
  });
  return data;
}
export async function writeC60113SyntheticWorkspace(
  root: string,
): Promise<C60112ReviewWorkspaceData> {
  const data = c60113SyntheticWorkspace();
  const audio = Buffer.alloc(44 + 8000 * 2 * 4);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  for (const region of data.regions)
    region.audioSha256 = createHash("sha256").update(audio).digest("hex");
  await writeC60112ReviewWorkspace({
    workspaceDirectory: root,
    reviewData: data,
  });
  for (const region of data.regions)
    await writeFile(path.join(root, region.audioPath), audio);
  return data;
}

export function c60113SyntheticRankerFreeze(): Record<string, unknown> {
  return {
    rankerType: "REGION_RISK_DENSITY_V3",
    featureSchemaVersion: "c60113-structural-features-v1",
    featureNames: [...c60113FeatureNames],
    rankingPolicy: "c6.0.1.13-region-burden-calibration-v1",
    mandatoryPolicy: "POSITIVE_SAFETY_EVIDENCE_ONLY",
    burdenSelectionPolicy: "MARGINAL_UNIQUE_AUDIO_GREEDY_FIXED_OVERHEAD_V1",
    fixedReviewOverheadSeconds: 8,
    model: null,
  };
}

export async function prepareC60113SyntheticTrialPackage(root: string) {
  const data = await writeC60113SyntheticWorkspace(root);
  const policy = buildC60113ReviewPolicy();
  const priorities: C60113RegionPriorityEntry[] = data.regions.map(
    (region, index) => ({
      regionId: region.regionId,
      itemIds: region.reviewItemIds,
      sourceInterval: {
        start: region.contextStart + 1,
        end: region.contextEnd - 1,
      },
      contextInterval: { start: region.contextStart, end: region.contextEnd },
      itemRiskSummary: {
        uniqueAffectedCueCount: 1,
        uniqueEventCount: 1,
        independentRiskGroupCount: 1,
        mandatoryItemCount: index === 0 ? 1 : 0,
        missingClassifications: [],
      },
      independentEvidenceFamilies: ["CROSS_MODEL_CONTENT"],
      mandatoryReasons: index === 0 ? ["STRUCTURAL_CORRUPTION"] : [],
      candidateActionableCount: 1,
      estimatedUniqueAudioSeconds: 4,
      priorityVector: {
        mandatorySafetyClass: index === 0 ? "STRUCTURAL_CORRUPTION" : "NONE",
        positiveEvidenceStrength: 0.5,
        independentEvidenceFamilyCount: 1,
        errorTypeSeverity: 0.5,
        crossModelConflictStrength: 0.5,
        hallucinationStrength: 0,
        missingStrength: 0,
        timingStrength: 0,
        candidateActionability: 1,
        localizationQuality: null,
        estimatedReviewCost: 12,
        sourceTime: region.contextStart + 1,
      },
      rankScore: 60 - index,
      rankPosition: index + 1,
      riskCoverageKeys: [`risk-${index}`],
      actionableCoverageKeys: [`candidate-${index}`],
      semanticHash: "a".repeat(64),
    }),
  );
  const features = buildC60113RegionFeatures({
    generatedAt: "2026-08-30T00:00:00.000Z",
    policyHash: policy.semanticHash,
    regions: priorities.map((region) => ({
      regionId: region.regionId,
      itemIds: region.itemIds,
      sourceInterval: region.sourceInterval,
      contextInterval: region.contextInterval,
      mandatory: region.mandatoryReasons.length > 0,
      legacyItemPriority: region.rankScore,
      legacyRegionPriority: region.rankScore,
      missingCalibratedPriority: region.rankScore,
      deterministicRiskUtility: 1,
      crossModelDisagreement: true,
      selectorEvidence: region,
      values: { crossModelConflictStrength: 0.5 },
    })),
  });
  const ranker = c60113SyntheticRankerFreeze(),
    deployment = c60113DeploymentRanker(ranker);
  const old = data.regionReviewV2;
  if (!old) throw new Error("Synthetic extension missing");
  data.regionReviewV2 = buildC60113WorkspaceExtension({
    policyHash: policy.semanticHash,
    regions: old.regions,
    segments: old.segments,
    plans: old.plans.map((plan) => {
      const percentage = /UNIQUE_AUDIO_(\d+)_PERCENT/u.exec(plan.planId)?.[1];
      const budgetSeconds = percentage ? (30 * Number(percentage)) / 100 : null;
      const selection = selectC60113DeploymentRegions({
        deployment,
        features,
        budgetSeconds,
        mandatoryOnly: plan.planId === "ALL_MANDATORY",
      });
      return {
        planId: plan.planId,
        budgetSeconds,
        regionIds: selection.regions.map((region) => region.regionId),
        uniqueUnionSeconds: selection.uniqueUnionSeconds,
      };
    }),
  });
  const machine = {
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "unseen-synthetic.mkv",
      container: "mkv",
      durationSeconds: 30,
    },
    identity: { title: null, season: null, episode: null, year: null },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: { srt: null, vtt: null, ass: null },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues: data.items.map((item) => ({
      id: item.finalCueIds[0],
      start: item.currentStart,
      end: item.currentEnd,
      language: "ja",
      languages: ["ja"],
      text: item.currentText,
      speaker: null,
      confidence: null,
    })),
    warnings: [],
  };
  const bytes = Buffer.from(`${JSON.stringify(machine)}\n`),
    machinePackageFile = path.join(root, "machine-fixture.json");
  await writeFile(machinePackageFile, bytes);
  data.machineDraftHash = createHash("sha256").update(bytes).digest("hex");
  await writeC60112ReviewWorkspace({
    workspaceDirectory: root,
    reviewData: data,
  });
  const components = {
    sourceMediaSha256: String(data.sourceMediaIdentity.sha256),
    machineDraftHash: data.machineDraftHash,
    itemHash: c60113WorkspaceHash(data.items),
    priorityHash: c60113WorkspaceHash(
      data.items.map((item) => ({
        id: item.reviewItemId,
        score: item.priorityScore,
      })),
    ),
    regionHash: c60113WorkspaceHash(data.regions),
    candidateHash: c60113WorkspaceHash(data.candidateBundles),
    audioManifestHash: c60113WorkspaceHash(
      data.regions.map((region) => ({
        path: region.audioPath,
        sha256: region.audioSha256,
      })),
    ),
    workspaceDataHash: c60113WorkspaceHash(data),
    policyHash: data.policyHash,
  };
  const freeze = {
    schemaVersion: "1.0.0",
    policyVersion: data.policyVersion,
    artifactType: "c6-0-1-12-review-package-freeze",
    frozenAt: "2026-08-30T00:00:00.000Z",
    ...components,
    aggregateHash: c60113WorkspaceHash(components),
    runtimeGoldInputCount: 0,
    goldAccessBeforeFreezeCount: 0,
    frozenBeforeGoldEvaluation: true,
  };
  const reviewPackageFreezeFile = path.join(
    root,
    "synthetic-review-package-freeze.json",
  );
  await writeFile(
    reviewPackageFreezeFile,
    JSON.stringify({ ...freeze, semanticHash: c60113WorkspaceHash(freeze) }),
  );
  return {
    data,
    regionFeatures: features,
    frozenRanker: ranker,
    machinePackageFile,
    reviewPackageFreezeFile,
  };
}
