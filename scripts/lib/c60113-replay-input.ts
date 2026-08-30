import path from "node:path";

import {
  c60112ReviewPackageFreezeSchema,
  machineReviewAudioManifestSchema,
  machineReviewCandidateBundlesSchema,
  machineReviewItemsSchema,
  machineReviewPrioritySchema,
  machineReviewRegionsSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import {
  adaptC60112MachineArtifacts,
  adaptC60112ReviewCandidates,
  assertC60112MachineOnlyInput,
  assertC60112ReviewPolicy,
  assertC60112ReviewWorkspaceData,
  buildC60112ReviewCandidateBundles,
  buildC60112ReviewItems,
  buildC60112ReviewPriority,
  clusterC60112ReviewRegions,
  inspectReviewWav,
  machineQualitySemanticHash,
  verifyC60112ReviewPackageFreeze,
  type C60112ReviewPolicy,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";
import { readFile } from "node:fs/promises";

import {
  c60113ContainedFile,
  c60113FileHash,
  c60113FileIdentity,
  c60113IntervalUnionSeconds,
  c60113OnlySubtitleDirectory,
  c60113ScoreDiagnostics,
  readC60113Json,
} from "./c60113-acceptance-io.js";

export async function loadC60113ReplayInput(input: {
  artifactRoot: string;
  upstreamPrefix: string;
  upstreamDate: string;
  evidencePrefix: string;
  evidenceDate: string;
  source: string;
}) {
  const directory = (suffix: string) =>
    path.join(
      input.artifactRoot,
      `${input.upstreamPrefix}-${suffix}-${input.upstreamDate}`,
    );
  const evidenceDirectory = (suffix: string) =>
    path.join(
      input.artifactRoot,
      `${input.evidencePrefix}-${suffix}-${input.evidenceDate}`,
    );
  const read = (suffix: string, name: string) =>
    readC60113Json(path.join(directory(suffix), name));
  const subtitleRoot = await c60113OnlySubtitleDirectory(directory("final-a"));
  const subtitleRootB = await c60113OnlySubtitleDirectory(directory("final-b"));
  const packagePath = path.join(
    subtitleRoot,
    "subtitle-package.needs-review.json",
  );
  const machineDraftHash = await c60113FileHash(packagePath);
  if (
    machineDraftHash !==
    (await c60113FileHash(
      path.join(subtitleRootB, "subtitle-package.needs-review.json"),
    ))
  )
    throw new Error("UPSTREAM_MACHINE_FINAL_AB_MISMATCH");
  const subtitlePackage = subtitlePackageSchema.parse(
    await readC60113Json(packagePath),
  );
  const policy = (await read(
    "review-items",
    "c6-0-1-12-review-assistance-policy.json",
  )) as C60112ReviewPolicy;
  assertC60112ReviewPolicy(policy);
  const items = machineReviewItemsSchema.parse(
    await read("review-items", "machine-review-items.json"),
  );
  const priority = machineReviewPrioritySchema.parse(
    await read("review-priority", "machine-review-priority.json"),
  );
  const regions = machineReviewRegionsSchema.parse(
    await read("review-regions", "machine-review-regions.json"),
  );
  const candidates = machineReviewCandidateBundlesSchema.parse(
    await read("review-candidates", "machine-review-candidate-bundles.json"),
  );
  const audio = machineReviewAudioManifestSchema.parse(
    await read("review-audio", "machine-review-audio-manifest.json"),
  );
  const freeze = c60112ReviewPackageFreezeSchema.parse(
    await read("review-package-freeze", "c6-0-1-12-review-package-freeze.json"),
  );
  const workspaceData = (await read(
    "review-workspace",
    "review-data.json",
  )) as C60112ReviewWorkspaceData;
  assertC60112ReviewWorkspaceData(workspaceData);
  const sourceIdentity = await c60113FileIdentity(input.source);
  if (
    sourceIdentity.sha256 !== freeze.sourceMediaSha256 ||
    machineDraftHash !== freeze.machineDraftHash
  )
    throw new Error("UPSTREAM_SOURCE_OR_DRAFT_IDENTITY_MISMATCH");
  if (
    !verifyC60112ReviewPackageFreeze({
      freeze,
      packageInput: {
        sourceMediaSha256: sourceIdentity.sha256,
        machineDraftHash,
        policy,
        items,
        priority,
        regions,
        candidates,
        audioManifest: audio,
        workspaceData,
      },
    })
  )
    throw new Error("UPSTREAM_FREEZE_RECOMPUTATION_FAILED");
  for (const clip of audio.clips) {
    const audioPath = await c60113ContainedFile(
      directory("review-workspace"),
      clip.relativePath,
    );
    if ((await c60113FileHash(audioPath)) !== clip.sha256)
      throw new Error("UPSTREAM_REVIEW_AUDIO_HASH_MISMATCH");
    inspectReviewWav(await readFile(audioPath));
  }
  const machine = (name: string) =>
    readC60113Json(path.join(subtitleRoot, name));
  const evidence = {
    finalReviewQueue: await machine("final-review-queue.json"),
    arbitrationEvidence: await machine(
      "machine-cross-model-arbitration-evidence.json",
    ),
    calibrationCorpus: await readC60113Json(
      path.join(
        evidenceDirectory("calibration-corpus"),
        "machine-cross-model-calibration-corpus.json",
      ),
    ),
    independentAcoustic: await readC60113Json(
      path.join(
        evidenceDirectory("independent-acoustic-scores"),
        "machine-independent-acoustic-discriminator.json",
      ),
    ),
    pairedWhisper: await readC60113Json(
      path.join(
        evidenceDirectory("paired-whisper"),
        "machine-paired-whisper-evidence.json",
      ),
    ),
    acousticRisk: await machine("machine-acoustic-risk-vector.json"),
    overlapClassification: await machine(
      "machine-overlap-event-classification.json",
    ),
    speechCoverage: await machine("machine-speech-coverage-gap.json"),
  };
  const extendedEvidence = {
    vadTimebase: await machine("machine-vad-global-timebase.json"),
    acousticScenes: await machine("acoustic-scenes.json"),
    speakerEvidence: await machine("machine-speaker-overlap-recovery.json"),
  };
  const signals = adaptC60112MachineArtifacts({ subtitlePackage, ...evidence });
  // The explicit machine-artifact allowlist above includes historical audit
  // descriptions such as "without-gold". Check the actual adapter projection,
  // not those descriptive strings; no label/evaluator artifact is opened.
  assertC60112MachineOnlyInput(signals, "c60113-baseline-replay.signals");
  const rebuiltItems = buildC60112ReviewItems({ signals, policy });
  const rebuiltPriority = buildC60112ReviewPriority({
    items: rebuiltItems.items,
    policy,
  });
  const rebuiltRegions = clusterC60112ReviewRegions({
    items: rebuiltItems.items,
    policy,
    sourceDurationSeconds: subtitlePackage.source.durationSeconds,
  });
  const candidateInputs = adaptC60112ReviewCandidates(evidence);
  const rebuiltCandidates = buildC60112ReviewCandidateBundles({
    items: rebuiltItems.items,
    candidates: candidateInputs,
    policy,
  });
  const replayParity = {
    items: rebuiltItems.semanticHash === items.semanticHash,
    priority: rebuiltPriority.semanticHash === priority.semanticHash,
    regions: rebuiltRegions.semanticHash === regions.semanticHash,
    candidates: rebuiltCandidates.semanticHash === candidates.semanticHash,
  };
  if (Object.values(replayParity).some((value) => !value))
    throw new Error(`BASELINE_REPLAY_MISMATCH:${JSON.stringify(replayParity)}`);
  const contextIntervals = regions.regions.map((region) => ({
    start: region.contextStart,
    end: region.contextEnd,
  }));
  const requiredIntervals = regions.regions
    .filter((region) => region.requiredLevel === "REQUIRED")
    .map((region) => ({ start: region.contextStart, end: region.contextEnd }));
  const uniqueAudio = c60113IntervalUnionSeconds(contextIntervals);
  const requiredAudio = c60113IntervalUnionSeconds(requiredIntervals);
  const clipSum = audio.clips.reduce(
    (sum, clip) => sum + clip.actualDurationSeconds,
    0,
  );
  const baseline = {
    schemaVersion: "1.0.0" as const,
    artifactType: "c6-0-1-13-baseline-replay" as const,
    sourceIdentity,
    sourceDurationSeconds: subtitlePackage.source.durationSeconds,
    machineDraftHash,
    canonicalIdentities: workspaceData.machineDraftIdentity,
    upstreamFreezeHash: freeze.semanticHash,
    replayParity,
    itemCount: items.items.length,
    regionCount: regions.regions.length,
    requiredItemCount: items.summary.requiredItemCount,
    requiredRegionCount: regions.summary.requiredRegionCount,
    criticalItemCount: items.items.filter(
      (item) => item.priorityTier === "CRITICAL",
    ).length,
    legacyMissingRiskCount: items.items.filter((item) =>
      item.itemTypes.includes("MISSING_SPEECH_RISK"),
    ).length,
    scoreDiagnostics: c60113ScoreDiagnostics(
      items.items.map((item) => item.priorityScore),
    ),
    totalClipSeconds: clipSum,
    totalUniqueAudioSeconds: uniqueAudio,
    duplicateAudioSeconds: clipSum - uniqueAudio,
    requiredUniqueAudioSeconds: requiredAudio,
    requiredUniqueAudioRatio:
      requiredAudio / subtitlePackage.source.durationSeconds,
    runtimeGoldInputCount: 0 as const,
    asrInferenceCount: 0 as const,
    networkUsed: false as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
  };
  return {
    directory,
    subtitleRoot,
    subtitleRootB,
    packagePath,
    subtitlePackage,
    policy,
    items,
    priority,
    regions,
    candidates,
    audio,
    freeze,
    workspaceData,
    sourceIdentity,
    machineDraftHash,
    evidence,
    extendedEvidence,
    candidateInputs,
    baseline: {
      ...baseline,
      semanticHash: machineQualitySemanticHash(baseline),
    },
  };
}
