import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, link, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  atomicWriteJson,
  c60112ReviewPackageFreezeSchema,
  machineReviewAudioManifestSchema,
  machineReviewCandidateBundlesSchema,
  machineReviewItemsSchema,
  machineReviewPrioritySchema,
  machineReviewRegionsSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  adaptC60112MachineArtifacts,
  adaptC60112ReviewCandidates,
  assertC60112MachineOnlyInput,
  buildC60112ReviewAudio,
  buildC60112ReviewCandidateBundles,
  buildC60112ReviewItems,
  buildC60112ReviewPackageFreeze,
  buildC60112ReviewPolicy,
  buildC60112ReviewPriority,
  clusterC60112ReviewRegions,
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
  machineQualitySemanticHash,
  verifyC60112ReviewPackageFreeze,
  writeC60112ReviewWorkspace,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-29T13:00:00.000Z";
const OUTPUT_DATE = "20260829";
const PREFIX = "carnation-c6-0-1-12";

function required(
  values: Record<string, string | undefined>,
  name: string,
): string {
  const value = values[name];
  if (value === undefined || value.trim() === "")
    throw new Error(`Missing --${name}.`);
  return path.resolve(value);
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function fileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath) as AsyncIterable<Buffer>)
    hash.update(chunk);
  return hash.digest("hex");
}

async function onlySubtitleDirectory(root: string): Promise<string> {
  const entries = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (entries.length !== 1)
    throw new Error(`Expected exactly one subtitle directory in ${root}.`);
  return path.join(root, entries[0]?.name ?? "");
}

interface OutputPaths {
  baseline: string;
  items: string;
  priority: string;
  regions: string;
  candidates: string;
  audio: string;
  workspace: string;
  freeze: string;
  finalA: string;
  finalB: string;
}

function outputPaths(root: string): OutputPaths {
  const output = (suffix: string) =>
    path.join(root, `${PREFIX}-${suffix}-${OUTPUT_DATE}`);
  return {
    baseline: output("baseline"),
    items: output("review-items"),
    priority: output("review-priority"),
    regions: output("review-regions"),
    candidates: output("review-candidates"),
    audio: output("review-audio"),
    workspace: output("review-workspace"),
    freeze: output("review-package-freeze"),
    finalA: output("final-a"),
    finalB: output("final-b"),
  };
}

async function copyWorkspaceAudio(input: {
  audioDirectory: string;
  workspaceDirectory: string;
  names: readonly string[];
}): Promise<void> {
  const targetDirectory = path.join(input.workspaceDirectory, "audio");
  await mkdir(targetDirectory, { recursive: true });
  for (const name of input.names) {
    const source = path.join(input.audioDirectory, name);
    const target = path.join(targetDirectory, name);
    try {
      await link(source, target);
    } catch {
      await cp(source, target, { force: false });
    }
  }
}

const { values } = parseArgs({
  options: {
    "c60111-final-a": { type: "string" },
    "c60111-final-b": { type: "string" },
    "c60111-baseline": { type: "string" },
    "c60111-calibration-corpus": { type: "string" },
    "c60111-paired-whisper": { type: "string" },
    "c60111-independent-acoustic": { type: "string" },
    source: { type: "string" },
    "output-root": { type: "string" },
    ffmpeg: { type: "string", default: "ffmpeg" },
  },
});
const options = values as Record<string, string | undefined>;
const upstreamFinalA = required(options, "c60111-final-a");
const upstreamFinalB = required(options, "c60111-final-b");
const upstreamBaseline = required(options, "c60111-baseline");
const calibrationRoot = required(options, "c60111-calibration-corpus");
const pairedRoot = required(options, "c60111-paired-whisper");
const independentRoot = required(options, "c60111-independent-acoustic");
const sourcePath = required(options, "source");
const outputRoot = required(options, "output-root");
const ffmpegPath = options.ffmpeg ?? "ffmpeg";
const outputs = outputPaths(outputRoot);
const outputDirectories: string[] = [
  outputs.baseline,
  outputs.items,
  outputs.priority,
  outputs.regions,
  outputs.candidates,
  outputs.audio,
  outputs.workspace,
  outputs.freeze,
  outputs.finalA,
  outputs.finalB,
];

const subtitleRoot = await onlySubtitleDirectory(upstreamFinalA);
const finalBSubtitleRoot = await onlySubtitleDirectory(upstreamFinalB);
const packagePath = path.join(
  subtitleRoot,
  "subtitle-package.needs-review.json",
);
const finalBPackagePath = path.join(
  finalBSubtitleRoot,
  "subtitle-package.needs-review.json",
);
if ((await fileHash(packagePath)) !== (await fileHash(finalBPackagePath))) {
  throw new Error(
    "C6.0.1.11 Final A/B machine packages are not byte-identical.",
  );
}
const subtitlePackage = subtitlePackageSchema.parse(await json(packagePath));
const sourceMediaSha256 = await fileHash(sourcePath);
if (
  sourceMediaSha256 !==
  "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43"
) {
  throw new Error(`Unexpected source media hash: ${sourceMediaSha256}`);
}

const evidence = {
  finalReviewQueue: await json(
    path.join(subtitleRoot, "final-review-queue.json"),
  ),
  arbitrationEvidence: await json(
    path.join(subtitleRoot, "machine-cross-model-arbitration-evidence.json"),
  ),
  calibrationCorpus: await json(
    path.join(calibrationRoot, "machine-cross-model-calibration-corpus.json"),
  ),
  pairedWhisper: await json(
    path.join(pairedRoot, "machine-paired-whisper-evidence.json"),
  ),
  independentAcoustic: await json(
    path.join(
      independentRoot,
      "machine-independent-acoustic-discriminator.json",
    ),
  ),
  acousticRisk: await json(
    path.join(subtitleRoot, "machine-acoustic-risk-vector.json"),
  ),
  overlapClassification: await json(
    path.join(subtitleRoot, "machine-overlap-event-classification.json"),
  ),
  speechCoverage: await json(
    path.join(subtitleRoot, "machine-speech-coverage-gap.json"),
  ),
};
const policy = buildC60112ReviewPolicy({ policyFrozenAt: GENERATED_AT });
const signals = adaptC60112MachineArtifacts({ subtitlePackage, ...evidence });
const items = buildC60112ReviewItems({ signals, policy });
const priority = buildC60112ReviewPriority({ items: items.items, policy });
const regions = clusterC60112ReviewRegions({
  items: items.items,
  policy,
  sourceDurationSeconds: subtitlePackage.source.durationSeconds,
});
const candidateInputs = adaptC60112ReviewCandidates(evidence);
const candidates = buildC60112ReviewCandidateBundles({
  items: items.items,
  candidates: candidateInputs,
  policy,
});
machineReviewItemsSchema.parse(items);
machineReviewPrioritySchema.parse(priority);
machineReviewRegionsSchema.parse(regions);
machineReviewCandidateBundlesSchema.parse(candidates);

// Destructive replacement is delayed until every upstream input has been
// opened, identity-checked, adapted and strict-validated in memory.
for (const directory of outputDirectories)
  await rm(directory, { recursive: true, force: true });

for (const directory of [
  outputs.baseline,
  outputs.items,
  outputs.priority,
  outputs.regions,
  outputs.candidates,
  outputs.audio,
  outputs.workspace,
  outputs.freeze,
]) {
  await mkdir(directory, { recursive: true });
}
const machineDraftHash = await fileHash(packagePath);
await atomicWriteJson(
  path.join(outputs.baseline, "c6-0-1-12-baseline-replay.json"),
  {
    schemaVersion: "1.0.0",
    policyVersion: policy.policyVersion,
    artifactType: "c6-0-1-12-baseline-replay",
    generatedAt: GENERATED_AT,
    sourceMediaSha256,
    machineDraftHash,
    cueCount: subtitlePackage.cues.length,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    c602Status: "HOLD",
    sourceEvidence: {
      c60111BaselineSemanticHash: machineQualitySemanticHash(
        await json(
          path.join(upstreamBaseline, "c6-0-1-11-baseline-replay.json"),
        ),
      ),
      c60111FinalAHash: machineQualitySemanticHash(subtitlePackage),
    },
    goldDerivedQualityMetricsIncluded: false,
    semanticHash: machineQualitySemanticHash({
      machineDraftHash,
      sourceMediaSha256,
      cueCount: subtitlePackage.cues.length,
    }),
  },
);
await atomicWriteJson(
  path.join(outputs.items, "machine-review-items.json"),
  items,
);
await atomicWriteJson(
  path.join(outputs.items, "c6-0-1-12-review-assistance-policy.json"),
  policy,
);
await atomicWriteJson(
  path.join(outputs.priority, "machine-review-priority.json"),
  priority,
);
await atomicWriteJson(
  path.join(outputs.regions, "machine-review-regions.json"),
  regions,
);
await atomicWriteJson(
  path.join(outputs.candidates, "machine-review-candidate-bundles.json"),
  candidates,
);

const audioDirectory = path.join(outputs.audio, "audio");
const audio = await buildC60112ReviewAudio({
  sourcePath,
  expectedSourceMediaSha256: sourceMediaSha256,
  durationSeconds: subtitlePackage.source.durationSeconds,
  regions: regions.regions.map((region) => ({
    regionId: region.regionId,
    interval: {
      start: Math.min(
        ...region.coreIntervals.map((interval) => interval.start),
      ),
      end: Math.max(...region.coreIntervals.map((interval) => interval.end)),
    },
    itemIds: region.reviewItemIds,
  })),
  outputDirectory: audioDirectory,
  generatedAt: GENERATED_AT,
  ffmpegPath,
});
machineReviewAudioManifestSchema.parse(audio);
await atomicWriteJson(
  path.join(outputs.audio, "machine-review-audio-manifest.json"),
  audio,
);

const cueIndex = new Map(
  subtitlePackage.cues.map((cue, index) => [cue.id, index]),
);
const regionByItem = new Map(
  regions.regions.flatMap((region) =>
    region.reviewItemIds.map((itemId) => [itemId, region] as const),
  ),
);
const audioByRegion = new Map(audio.clips.map((clip) => [clip.regionId, clip]));
const candidateBundleByItem = new Map(
  candidates.bundles.map((bundle) => [bundle.reviewItemId, bundle]),
);
const workspaceReviewHash = machineQualitySemanticHash({
  policy: policy.semanticHash,
  items: items.semanticHash,
  priority: priority.semanticHash,
  regions: regions.semanticHash,
  candidates: candidates.semanticHash,
  audio: audio.semanticHash,
});
const canonicalTextHash = c601CanonicalTextHash(subtitlePackage.cues);
const canonicalTimingHash = c601CanonicalTimingHash(subtitlePackage.cues);
const presentationHash = machineQualitySemanticHash({
  ass: formatAss(subtitlePackage.cues),
  srt: formatSrt(subtitlePackage.cues),
  vtt: formatVtt(subtitlePackage.cues),
});
const workspaceData: C60112ReviewWorkspaceData = {
  schemaVersion: "1.0.0",
  workspaceVersion: "c6.0.1.12-review-workspace-v1",
  policyVersion: policy.policyVersion,
  policyHash: policy.semanticHash,
  reviewPackageSemanticHash: workspaceReviewHash,
  machineDraftHash,
  sourceMediaIdentity: {
    sourceMediaSha256,
    durationSeconds: subtitlePackage.source.durationSeconds,
  },
  machineDraftIdentity: {
    machineDraftHash,
    cueCount: subtitlePackage.cues.length,
    canonicalTextHash,
    canonicalTimingHash,
    presentationHash,
  },
  items: items.items.map((item) => {
    const candidateBundle = candidateBundleByItem.get(item.reviewItemId);
    if (candidateBundle === undefined) {
      throw new Error(`Candidate bundle missing for ${item.reviewItemId}.`);
    }
    const indexes = item.finalCueIds
      .map((id) => cueIndex.get(id))
      .filter((index): index is number => index !== undefined)
      .toSorted((left, right) => left - right);
    const targetCues = indexes
      .map((index) => subtitlePackage.cues[index])
      .filter((cue) => cue !== undefined);
    const firstIndex = indexes[0];
    const lastIndex = indexes.at(-1);
    const previous =
      firstIndex === undefined
        ? undefined
        : subtitlePackage.cues[firstIndex - 1];
    const next =
      lastIndex === undefined ? undefined : subtitlePackage.cues[lastIndex + 1];
    const region = regionByItem.get(item.reviewItemId);
    if (region === undefined)
      throw new Error(`Review region missing for ${item.reviewItemId}.`);
    const actionIntersection = item.suggestedActions.filter((action) =>
      candidateBundle.availableActions.includes(action),
    );
    const cueSafeActions =
      item.finalCueIds.length === 0
        ? new Set([
            "ADD_NEW_CUE",
            "MARK_FALSE_POSITIVE",
            "UNRESOLVED",
            "WAIVE_REVIEW",
          ])
        : item.finalCueIds.length === 1
          ? new Set([
              "KEEP_CURRENT",
              "USE_REAZON",
              "USE_WHISPER_ALTERNATE",
              "MANUAL_EDIT",
              "TIMING_EDIT",
              "UNRESOLVED",
              "WAIVE_REVIEW",
            ])
          : new Set(["KEEP_CURRENT", "UNRESOLVED", "WAIVE_REVIEW"]);
    return {
      reviewItemId: item.reviewItemId,
      eventIds: item.eventIds,
      finalCueIds: item.finalCueIds,
      itemTypes: item.itemTypes,
      sourceInterval: item.sourceInterval,
      coreInterval: item.coreInterval,
      currentText: item.currentText ?? "",
      currentStart:
        targetCues.length === 0
          ? null
          : Math.min(...targetCues.map((cue) => cue.start)),
      currentEnd:
        targetCues.length === 0
          ? null
          : Math.max(...targetCues.map((cue) => cue.end)),
      candidateIds: item.candidateIds,
      evidenceIds: item.evidenceIds,
      reviewReasons: item.reviewReasons,
      priorityTier: item.priorityTier,
      priorityScore: item.priorityScore,
      requiredLevel: item.requiredLevel,
      suggestedActions: actionIntersection.filter((action) =>
        cueSafeActions.has(action),
      ),
      regionId: region.regionId,
      previousCue:
        previous === undefined
          ? null
          : {
              cueId: previous.id,
              text: previous.text,
              start: previous.start,
              end: previous.end,
            },
      nextCue:
        next === undefined
          ? null
          : {
              cueId: next.id,
              text: next.text,
              start: next.start,
              end: next.end,
            },
      semanticHash: item.semanticHash,
    };
  }),
  regions: regions.regions.map((region) => {
    const clip = audioByRegion.get(region.regionId);
    if (clip === undefined)
      throw new Error(`Review audio missing for ${region.regionId}.`);
    return {
      regionId: region.regionId,
      reviewItemIds: region.reviewItemIds,
      contextStart: region.contextStart,
      contextEnd: region.contextEnd,
      coreIntervals: region.coreIntervals.map(({ start, end }) => ({
        start,
        end,
      })),
      audioPath: clip.relativePath,
      audioSha256: clip.sha256,
    };
  }),
  candidateBundles: candidates.bundles.map((bundle) => ({
    reviewItemId: bundle.reviewItemId,
    candidates: bundle.displayCandidates.map((candidate) => ({
      candidateId: candidate.displayCandidateId,
      labels: candidate.labels,
      text: candidate.displayText,
      evidenceBadges: candidate.evidenceBadges,
      provenance: candidate.provenance.flatMap((entry) => [
        entry.candidateId,
        ...entry.provenanceIds,
      ]),
    })),
  })),
};
assertC60112MachineOnlyInput(workspaceData, "review-workspace-data");
await writeC60112ReviewWorkspace({
  workspaceDirectory: outputs.workspace,
  reviewData: workspaceData,
});
await copyWorkspaceAudio({
  audioDirectory,
  workspaceDirectory: outputs.workspace,
  names: audio.clips.map((clip) => path.basename(clip.relativePath)),
});
const freeze = buildC60112ReviewPackageFreeze({
  frozenAt: GENERATED_AT,
  sourceMediaSha256,
  machineDraftHash,
  policy,
  items,
  priority,
  regions,
  candidates,
  audioManifest: audio,
  workspaceData,
});
c60112ReviewPackageFreezeSchema.parse(freeze);
if (
  !verifyC60112ReviewPackageFreeze({
    freeze,
    packageInput: {
      sourceMediaSha256,
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
  throw new Error("C6.0.1.12 review package freeze verification failed.");
await atomicWriteJson(
  path.join(outputs.freeze, "c6-0-1-12-review-package-freeze.json"),
  freeze,
);
await atomicWriteJson(
  path.join(outputs.freeze, "c6-0-1-12-machine-build-manifest.json"),
  {
    schemaVersion: "1.0.0",
    policyVersion: policy.policyVersion,
    artifactType: "c6-0-1-12-machine-build-manifest",
    generatedAt: GENERATED_AT,
    goldReadBeforeFreeze: false,
    machineReviewBuildGoldInputCount: 0,
    asrInferenceCount: 0,
    networkUsed: false,
    reviewItemCount: items.summary.itemCount,
    regionCount: regions.summary.regionCount,
    candidateActionableItemCount:
      candidates.summary.candidateActionableItemCount,
    audioPlayableCount: audio.summary.playableCount,
    freezeSemanticHash: freeze.semanticHash,
    semanticHash: machineQualitySemanticHash({
      freeze: freeze.semanticHash,
      machineReviewBuildGoldInputCount: 0,
    }),
  },
);

await cp(upstreamFinalA, outputs.finalA, { recursive: true, force: false });
await cp(upstreamFinalB, outputs.finalB, { recursive: true, force: false });
const finalASubtitle = await onlySubtitleDirectory(outputs.finalA);
const finalBSubtitle = await onlySubtitleDirectory(outputs.finalB);
for (const name of (await readdir(subtitleRoot)).filter((name) =>
  /\.(?:ass|srt|vtt)$/u.test(name),
)) {
  const sourceHash = await fileHash(path.join(subtitleRoot, name));
  const aHash = await fileHash(path.join(finalASubtitle, name));
  const bHash = await fileHash(path.join(finalBSubtitle, name));
  if (sourceHash !== aHash || sourceHash !== bHash)
    throw new Error(`Machine Final parity failed for ${name}.`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      outputs,
      sourceMediaSha256,
      machineDraftHash,
      reviewItemCount: items.summary.itemCount,
      regionCount: regions.summary.regionCount,
      candidateActionableItemCount:
        candidates.summary.candidateActionableItemCount,
      audioPlayableCount: audio.summary.playableCount,
      freezeHash: freeze.semanticHash,
      goldReadBeforeFreeze: false,
      asrInferenceCount: 0,
      finalParity: true,
    },
    null,
    2,
  )}\n`,
);
