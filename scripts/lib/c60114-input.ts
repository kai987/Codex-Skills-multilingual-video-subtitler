import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  c60113ReviewItemsV3Schema,
  c60113ReviewRegionsV2Schema,
  c60113MissingSpeechEvidenceSchema,
  c60113EvidenceFamilyGraphSchema,
  c60113RegionReviewPrioritySchema,
  c60113ReviewPlaybackTimelineSchema,
  c60113ReviewBurdenPlansSchema,
  c60112ReviewPackageFreezeSchema,
  machineReviewItemsSchema,
  machineReviewRegionsSchema,
  machineReviewPrioritySchema,
  machineReviewCandidateBundlesSchema,
  machineReviewAudioManifestSchema,
  c60114SourceIdentitySchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import {
  assertC60112ReviewWorkspaceData,
  verifyC60112ReviewPackageFreeze,
  type C60112ReviewWorkspaceData,
  machineQualitySemanticHash,
  inspectReviewWav,
} from "@mvl/video-subtitler";
import { buildC60113MachineReview } from "../../packages/video-subtitler/src/review/structured-review-priority.js";
import { loadC60113ReplayInput } from "./c60113-replay-input.js";
import {
  c60113ContainedFile,
  c60113FileHash,
  c60113OnlySubtitleDirectory,
  readC60113Json,
} from "./c60113-acceptance-io.js";

const execute = promisify(execFile);
export interface C60114InputOptions {
  artifactRoot: string;
  upstreamPrefix: string;
  upstreamDate: string;
  evidencePrefix: string;
  evidenceDate: string;
  previousPrefix: string;
  previousDate: string;
  source: string;
  audioStreamIndex?: number;
  ffprobePath?: string;
}

/** Explicit machine-input allowlist. This loader never discovers arbitrary JSON. */
export async function loadC60114Input(options: C60114InputOptions) {
  const replay = await loadC60113ReplayInput(options);
  const directory = (suffix: string) =>
    path.join(
      options.artifactRoot,
      `${options.previousPrefix}-${suffix}-${options.previousDate}`,
    );
  const read = (suffix: string, name: string) =>
    readC60113Json(path.join(directory(suffix), name));
  const previous = {
    items: c60113ReviewItemsV3Schema.parse(
      await read("items-v3", "machine-review-items-v3.json"),
    ),
    regions: c60113ReviewRegionsV2Schema.parse(
      await read("regions-v2", "machine-review-regions-v2.json"),
    ),
    missing: c60113MissingSpeechEvidenceSchema.parse(
      await read(
        "missing-evidence-v2",
        "machine-missing-speech-evidence-v2.json",
      ),
    ),
    families: c60113EvidenceFamilyGraphSchema.parse(
      await read("evidence-families", "machine-review-evidence-families.json"),
    ),
    priority: c60113RegionReviewPrioritySchema.parse(
      await read("region-priority", "machine-region-review-priority.json"),
    ),
    playback: c60113ReviewPlaybackTimelineSchema.parse(
      await read("playback-timeline", "machine-review-playback-timeline.json"),
    ),
    burden: c60113ReviewBurdenPlansSchema.parse(
      await read("burden-plans", "machine-review-burden-plans.json"),
    ),
  };
  const rebuilt = buildC60113MachineReview({
    items: replay.items.items,
    regions: replay.regions.regions,
    candidateBundles: replay.candidates.bundles,
    sourceDurationSeconds: replay.subtitlePackage.source.durationSeconds,
    expectedSourceMediaSha256: replay.sourceIdentity.sha256,
    finalCues: replay.subtitlePackage.cues.map(({ id, start, end }) => ({
      id,
      start,
      end,
    })),
    rawArtifacts: { ...replay.evidence, ...replay.extendedEvidence },
  });
  const pairs = {
    items: [previous.items, rebuilt.itemsV3],
    regions: [previous.regions, rebuilt.regionsV2],
    missing: [previous.missing, rebuilt.missingEvidence],
    families: [previous.families, rebuilt.evidenceFamilies],
    priority: [previous.priority, rebuilt.regionPriority],
    playback: [previous.playback, rebuilt.playbackTimeline],
    burden: [previous.burden, rebuilt.burdenPlans],
  } as const;
  const replayParity = Object.entries(pairs).map(([artifact, pair]) => ({
    artifact,
    storedHash: machineQualitySemanticHash(pair[0]),
    rebuiltHash: machineQualitySemanticHash(pair[1]),
    equal:
      machineQualitySemanticHash(pair[0]) ===
      machineQualitySemanticHash(pair[1]),
  }));
  if (replayParity.some((entry) => !entry.equal))
    throw new Error("C60114_PREVIOUS_MACHINE_REPLAY_MISMATCH");
  const workspaceRoot = directory("workspace-v2");
  const workspace = (await read(
    "workspace-v2",
    "review-data.json",
  )) as C60112ReviewWorkspaceData;
  assertC60112ReviewWorkspaceData(workspace);
  const delivery = {
    items: machineReviewItemsSchema.parse(
      await read("workspace-v2", "machine-review-items.json"),
    ),
    regions: machineReviewRegionsSchema.parse(
      await read("workspace-v2", "machine-review-regions.json"),
    ),
    priority: machineReviewPrioritySchema.parse(
      await read("workspace-v2", "machine-review-priority.json"),
    ),
    candidates: machineReviewCandidateBundlesSchema.parse(
      await read("workspace-v2", "machine-review-candidate-bundles.json"),
    ),
    audio: machineReviewAudioManifestSchema.parse(
      await read("workspace-v2", "machine-review-audio-manifest.json"),
    ),
    freeze: c60112ReviewPackageFreezeSchema.parse(
      await read("workspace-v2", "c6-0-1-12-review-package-freeze.json"),
    ),
  };
  if (
    !verifyC60112ReviewPackageFreeze({
      freeze: delivery.freeze,
      packageInput: {
        sourceMediaSha256: replay.sourceIdentity.sha256,
        machineDraftHash: replay.machineDraftHash,
        policy: replay.policy,
        items: delivery.items,
        regions: delivery.regions,
        priority: delivery.priority,
        candidates: delivery.candidates,
        audioManifest: delivery.audio,
        workspaceData: workspace,
      },
    })
  )
    throw new Error("C60114_PREVIOUS_REVIEW_FREEZE_MISMATCH");
  for (const clip of delivery.audio.clips) {
    const file = await c60113ContainedFile(workspaceRoot, clip.relativePath);
    if ((await c60113FileHash(file)) !== clip.sha256)
      throw new Error("C60114_BASELINE_AUDIO_HASH_MISMATCH");
    const physical = inspectReviewWav(await readFile(file));
    if (
      physical.frameCount !== clip.frameCount ||
      physical.sampleRate !== clip.sampleRate ||
      physical.channelCount !== clip.channelCount ||
      physical.bitsPerSample !== clip.bitsPerSample ||
      Math.abs(physical.actualDurationSeconds - clip.actualDurationSeconds) >
        1e-8
    )
      throw new Error("C60114_BASELINE_AUDIO_FRAME_MISMATCH");
  }
  const { stdout } = await execute(options.ffprobePath ?? "ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    options.source,
  ]);
  const probe = JSON.parse(stdout) as {
    streams: {
      index: number;
      codec_type: string;
      sample_rate?: string;
      time_base?: string;
    }[];
    format: { duration: string };
  };
  const audioStreams = probe.streams.filter(
    (stream) => stream.codec_type === "audio",
  );
  const stream =
    options.audioStreamIndex === undefined
      ? audioStreams.length === 1
        ? audioStreams[0]
        : undefined
      : audioStreams.find(
          (candidate) => candidate.index === options.audioStreamIndex,
        );
  if (!stream)
    throw new Error("C60114_SOURCE_AUDIO_STREAM_AMBIGUOUS_OR_MISSING");
  const sourceIdentity = c60114SourceIdentitySchema.parse({
    sourceMediaSha256: replay.sourceIdentity.sha256,
    durationSeconds: replay.subtitlePackage.source.durationSeconds,
    sampleRate: Number(stream.sample_rate),
    audioStreamIndex: stream.index,
    audioTimebase: stream.time_base,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS",
  });
  if (
    Math.abs(Number(probe.format.duration) - sourceIdentity.durationSeconds) >
    0.05
  )
    throw new Error("C60114_SOURCE_DURATION_MISMATCH");
  const optionalMachineFiles = [
    "asr-request-timeline-contract-v2.json",
    "machine-global-token-timeline-v2.json",
    "canonical-asr-segments.json",
    "cue-candidate-evidence.json",
    "source-info.json",
    "media-profile.json",
    "audio/raw-transcription.json",
  ];
  const machineArtifacts: Record<string, unknown> = {
    ...replay.evidence,
    ...replay.extendedEvidence,
  };
  const machineInputFiles: { relativePath: string; sha256: string }[] = [];
  for (const name of optionalMachineFiles) {
    try {
      const file = await c60113ContainedFile(replay.subtitleRoot, name);
      machineArtifacts[name] = await readC60113Json(file);
      machineInputFiles.push({
        relativePath: name,
        sha256: await c60113FileHash(file),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const finalRootA = await c60113OnlySubtitleDirectory(directory("final-a"));
  const finalRootB = await c60113OnlySubtitleDirectory(directory("final-b"));
  const protectedFiles = [];
  for (const name of (await readdir(finalRootA)).toSorted()) {
    if (
      name !== "subtitle-package.needs-review.json" &&
      !/\.(ass|srt|vtt)$/u.test(name)
    )
      continue;
    const fileA = path.join(finalRootA, name),
      fileB = path.join(finalRootB, name);
    const sha256 = await c60113FileHash(fileA);
    if (sha256 !== (await c60113FileHash(fileB)))
      throw new Error("C60114_PREVIOUS_FINAL_AB_MISMATCH");
    protectedFiles.push({ relativePath: name, sha256 });
  }
  const currentPackage = subtitlePackageSchema.parse(
    await readC60113Json(
      path.join(finalRootA, "subtitle-package.needs-review.json"),
    ),
  );
  if (
    machineQualitySemanticHash(currentPackage) !==
    machineQualitySemanticHash(replay.subtitlePackage)
  )
    throw new Error("C60114_PREVIOUS_MACHINE_PACKAGE_CHANGED");
  return {
    replay,
    previous,
    rebuilt,
    workspace,
    workspaceRoot,
    delivery,
    sourceIdentity,
    machineArtifacts,
    machineInputFiles,
    finalRootA,
    finalRootB,
    protectedFiles,
    baseline: {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-baseline-replay",
      sourceIdentity,
      sourceReadOnlyIdentity: replay.sourceIdentity,
      replayParity,
      protectedFiles,
      machineDraftHash: replay.machineDraftHash,
      cueCount: currentPackage.cues.length,
      canonicalTextHash: machineQualitySemanticHash(
        currentPackage.cues.map((cue) => ({ id: cue.id, text: cue.text })),
      ),
      canonicalTimingHash: machineQualitySemanticHash(
        currentPackage.cues.map((cue) => ({
          id: cue.id,
          start: cue.start,
          end: cue.end,
        })),
      ),
      items: previous.items.summary,
      regions: previous.regions.summary,
      missing: previous.missing.summary,
      upstreamFreezeHash: delivery.freeze.semanticHash,
      runtimeGoldInputCount: 0,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      rankerRetrained: false,
      oofTrainingRun: false,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
    },
  };
}
export type C60114Input = Awaited<ReturnType<typeof loadC60114Input>>;
