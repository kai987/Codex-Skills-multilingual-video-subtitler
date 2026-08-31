import { z } from "zod";
import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  c60114MachineFreezeSchema,
  c60114ReviewTargetsSchema,
  c60114ReviewItemsV4Schema,
  c60114ReviewRegionsV3Schema,
  c60114ReviewAudioManifestV3Schema,
  c60114PlaybackTimelineV2Schema,
  c60114SpeechIslandsSchema,
  c60114LineageReconciliationSchema,
  c60114PolicySchema,
  c60114ProbeSelectionSchema,
  c60114LocalizedLexicalEvidenceSchema,
  c60114MissingSpeechEvidenceV3Schema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { loadC60114Input, type C60114InputOptions } from "./c60114-input.js";
import { verifyC60114MachineFreeze } from "./c60114-freeze.js";
import { prepareC60114Machine } from "./c60114-prepare-machine.js";
import {
  fileHash141,
  readJson141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

const file = z.string().min(1);
export const config141Schema = z
  .object({
    source: file,
    previousRunPaths: file,
    baselineFinalA: file,
    baselineFinalB: file,
    outputRoot: file,
    prefix: z.string().regex(/^[a-zA-Z0-9-]+$/u),
    date: z.string().regex(/^\d{8}$/u),
    legacyAudioRoots: z.array(file).min(1),
    speechRuntime: z
      .object({
        python: file,
        worker: file,
        sileroModel: file,
        sileroLibrary: file,
        speakerRuntimeManifest: file,
        speakerModelManifest: file,
      })
      .strict(),
    asrRuntime: z
      .object({
        whisperRuntimeManifestPath: file,
        whisperModelPath: file,
        whisperModelSha256: z.string().regex(/^[a-f0-9]{64}$/u),
        reazonModelDirectory: file,
        reazonPython: file,
        reazonWorkerPath: file,
      })
      .strict(),
    sudachiRuntimeManifestPath: file,
  })
  .strict()
  .refine(
    (v) =>
      Object.values(v)
        .filter((x) => typeof x === "string")
        .every((x) => !/(?:^|[/_-])gold(?:[/_.-]|$)/iu.test(x)),
    "Gold path forbidden in machine config",
  );
export type Config141 = z.infer<typeof config141Schema>;
export async function loadBaseline141(config: Config141) {
  const frozen = await Promise.all(
    [config.baselineFinalA, config.baselineFinalB].map((root) =>
      verifyC60114MachineFreeze({ root, sourcePath: config.source }),
    ),
  );
  const freeze = c60114MachineFreezeSchema.parse(
    await readJson141(
      path.join(
        config.baselineFinalA,
        "c6-0-1-14-machine-localization-freeze.json",
      ),
    ),
  );
  const previousRun = (await readJson141(config.previousRunPaths)) as {
    options: C60114InputOptions;
  };
  if (previousRun.options.source !== config.source)
    throw new Error("C601141_BASELINE_SOURCE_PATH_MISMATCH");
  const input = await loadC60114Input(previousRun.options);
  const read = (name: string) =>
    readJson141(path.join(config.baselineFinalA, name));
  const previous = {
    policy: c60114PolicySchema.parse(await read("c6-0-1-14-policy.json")),
    selection: c60114ProbeSelectionSchema.parse(
      await read("machine-missing-dialogue-probe-selection.json"),
    ),
    targets: c60114ReviewTargetsSchema.parse(
      await read("machine-review-target-intervals-v2.json"),
    ),
    items: c60114ReviewItemsV4Schema.parse(
      await read("machine-review-items-v4.json"),
    ),
    regions: c60114ReviewRegionsV3Schema.parse(
      await read("machine-review-regions-v3.json"),
    ),
    audio: c60114ReviewAudioManifestV3Schema.parse(
      await read("machine-review-audio-manifest-v3.json"),
    ),
    playback: c60114PlaybackTimelineV2Schema.parse(
      await read("machine-review-playback-timeline-v2.json"),
    ),
    islands: c60114SpeechIslandsSchema.parse(
      await read("machine-source-global-speech-islands.json"),
    ),
    lineage: c60114LineageReconciliationSchema.parse(
      await read("machine-source-global-lineage-reconciliation.json"),
    ),
    lexical: c60114LocalizedLexicalEvidenceSchema.parse(
      await read("machine-localized-missing-lexical-evidence.json"),
    ),
    missing: c60114MissingSpeechEvidenceV3Schema.parse(
      await read("machine-missing-speech-evidence-v3.json"),
    ),
  };
  const prepared = prepareC60114Machine(input, previous.policy, {
    reconcileLineage: true,
    frozenSelection: previous.selection,
  });
  // The completed C60114 delivery distinguishes REQUIRED from audioRequired.
  // Replay that final projection before comparing the immutable official graph.
  const requiredItems = new Set(
    previous.items.items
      .filter((v) => v.requiredLevel === "REQUIRED")
      .map((v) => v.reviewItemId),
  );
  prepared.reviewTargets = c60114ReviewTargetsSchema.parse(
    hashed141({
      ...prepared.reviewTargets,
      targets: prepared.reviewTargets.targets.map((v) =>
        hashed141({
          ...v,
          mandatoryForAudio: requiredItems.has(v.parentReviewItemId),
          audioRequired: true,
        }),
      ),
    }),
  );
  if (
    prepared.speechIslands.semanticHash !== previous.islands.semanticHash ||
    prepared.reviewTargets.semanticHash !== previous.targets.semanticHash ||
    prepared.lineage?.semanticHash !== previous.lineage.semanticHash
  )
    throw new Error("C601141_BASELINE_MACHINE_REPLAY_MISMATCH");
  const directory = (await readdir(config.baselineFinalA)).filter((name) =>
    name.startsWith("subtitle-"),
  );
  if (directory.length !== 1)
    throw new Error("C601141_BASELINE_SUBTITLE_DIRECTORY_AMBIGUOUS");
  const subtitleRelative = required141(directory[0]);
  const subtitlePackage = subtitlePackageSchema.parse(
    await read(
      path.join(subtitleRelative, "subtitle-package.needs-review.json"),
    ),
  );
  const protectedFiles = freeze.protectedMachineFiles.filter((v) =>
    v.relativePath.startsWith(`${subtitleRelative}/`),
  );
  for (const file of protectedFiles)
    if (
      (await fileHash141(
        path.join(config.baselineFinalB, file.relativePath),
      )) !== file.byteHash
    )
      throw new Error("C601141_BASELINE_CANONICAL_AB_MISMATCH");
  const canonicalTextHash = hash141(
    subtitlePackage.cues.map((c) => ({ id: c.id, text: c.text })),
  );
  const canonicalTimingHash = hash141(
    subtitlePackage.cues.map((c) => ({ id: c.id, start: c.start, end: c.end })),
  );
  const presentationHash = hash141(
    protectedFiles
      .filter((v) => /\.(ass|srt|vtt)$/iu.test(v.relativePath))
      .map((v) => v.byteHash),
  );
  return {
    input,
    prepared,
    previous,
    freeze,
    source: previous.targets.sourceIdentity,
    sourceBefore: freeze.sourceReadOnlyIdentity,
    subtitlePackage,
    subtitleRelative,
    protectedFiles,
    canonicalTextHash,
    canonicalTimingHash,
    presentationHash,
    baseline: {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-1-baseline-replay",
      sourceIdentity: previous.targets.sourceIdentity,
      inputFreezes: frozen,
      baselineSourceCommit: "d42f7b3fed8b811efbe11d163cbec1a38eeb519a",
      machineCueCount: subtitlePackage.cues.length,
      canonicalTextHash,
      canonicalTimingHash,
      presentationHash,
      targetCount: previous.targets.targets.length,
      itemCount: previous.items.items.length,
      regionCount: previous.regions.regions.length,
      physicalWavCount: previous.audio.audio.length,
      playableWavCount: previous.audio.audio.length,
      playbackSegmentCount: previous.playback.segments.length,
      allTargetAudioCoverage: previous.audio.summary,
      lineage: previous.lineage.summary,
      speechIslands: previous.islands.summary,
      fullQueueUniqueAudioSeconds: previous.playback.plans.find(
        (v) => v.planId === "FULL_QUEUE",
      )?.uniqueAudioSeconds,
      mandatoryUniqueAudioSeconds: previous.playback.plans.find(
        (v) => v.planId === "ALL_MANDATORY",
      )?.uniqueAudioSeconds,
      runtimeGoldInputCount: 0,
      asrInferenceCount: 0,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      productionStatus: "needs-review",
      finalizationMethod: "none",
    },
  };
}
export type Baseline141 = Awaited<ReturnType<typeof loadBaseline141>>;
