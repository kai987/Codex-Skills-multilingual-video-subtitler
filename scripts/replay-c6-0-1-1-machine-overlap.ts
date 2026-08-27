import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  NodeProcessRunner,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleReviewPackageSchema,
  type OverlapDecision,
} from "@mvl/shared";
import {
  locateSubtitlePackage,
  runTargetedOverlapAcousticResolution,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    "source-video": { type: "string" },
    "whisper-cpp-path": { type: "string" },
    "local-transcription-model": { type: "string" },
    "whisper-vad-model": { type: "string" },
    "asr-cache-dir": { type: "string" },
    "target-components": { type: "string", default: "7" },
    "target-cues": { type: "string", default: "16" },
  },
  strict: true,
});

if (
  values.task === undefined ||
  values["source-video"] === undefined ||
  values["whisper-cpp-path"] === undefined ||
  values["local-transcription-model"] === undefined ||
  values["asr-cache-dir"] === undefined
) {
  throw new InputError(
    "Usage: npm run replay:c6-0-1-1-machine-overlap -- --task <task> --source-video <media> --whisper-cpp-path <binary> --local-transcription-model <model> --asr-cache-dir <cache>",
  );
}

const targetComponentCount = Number(values["target-components"]);
const targetCueCount = Number(values["target-cues"]);
if (
  !Number.isInteger(targetComponentCount) ||
  targetComponentCount < 1 ||
  targetComponentCount > 7 ||
  !Number.isInteger(targetCueCount) ||
  targetCueCount < targetComponentCount ||
  targetCueCount > 20
) {
  throw new InputError(
    "Machine overlap targets must be 1-7 components and no more than 20 cues.",
  );
}

function chooseBoundedComponents(
  decisions: readonly OverlapDecision[],
): OverlapDecision[] {
  const ordered = decisions
    .filter(
      (decision) => decision.blocking && decision.relationship === "unresolved",
    )
    .toSorted((left, right) => left.decisionId.localeCompare(right.decisionId));
  let selected: OverlapDecision[] | null = null;
  const visit = (start: number, current: OverlapDecision[], cues: number) => {
    if (selected !== null || cues > targetCueCount) return;
    if (current.length === targetComponentCount) {
      if (cues === targetCueCount) selected = [...current];
      return;
    }
    const remaining = targetComponentCount - current.length;
    for (let index = start; index <= ordered.length - remaining; index += 1) {
      const decision = ordered[index];
      if (decision === undefined) continue;
      current.push(decision);
      visit(index + 1, current, cues + decision.cueIds.length);
      current.pop();
      if (selected !== null) return;
    }
  };
  visit(0, [], 0);
  if (selected === null) {
    throw new InputError(
      `No deterministic ${String(targetComponentCount)}-component/${String(targetCueCount)}-cue overlap subset exists.`,
    );
  }
  return selected;
}

const located = await locateSubtitlePackage(path.resolve(values.task));
const packagePath = located.packagePath;
const presentationPath = path.join(
  located.subtitleDirectory,
  "subtitle-presentation-resolution.json",
);
const reviewPath = path.join(
  located.subtitleDirectory,
  "subtitle-review-package.json",
);
const [subtitlePackage, presentationArtifact, reviewPackage] =
  await Promise.all([
    readFile(packagePath, "utf8").then((value) =>
      subtitlePackageSchema.parse(JSON.parse(value) as unknown),
    ),
    readFile(presentationPath, "utf8").then((value) =>
      subtitlePresentationResolutionSchema.parse(JSON.parse(value) as unknown),
    ),
    readFile(reviewPath, "utf8").then((value) =>
      subtitleReviewPackageSchema.parse(JSON.parse(value) as unknown),
    ),
  ]);
const selected = chooseBoundedComponents(presentationArtifact.overlapDecisions);
const selectedCueIds = new Set(selected.flatMap((decision) => decision.cueIds));
const filteredArtifact = subtitlePresentationResolutionSchema.parse({
  ...presentationArtifact,
  overlapDecisions: selected,
  summary: {
    ...presentationArtifact.summary,
    overlapPairCount: selected.reduce(
      (sum, decision) => sum + decision.overlapPairs.length,
      0,
    ),
    overlapComponentCount: selected.length,
    overlapResolvedCount: 0,
    overlapBlockingCount: selected.length,
    reviewGroupCount: selected.length,
  },
});
const result = await runTargetedOverlapAcousticResolution({
  mode: "observe",
  sourceVideoPath: path.resolve(values["source-video"]),
  subtitleDirectory: located.subtitleDirectory,
  sourceFingerprint: reviewPackage.sourceFingerprint,
  cues: subtitlePackage.cues,
  presentation: {
    cues: subtitlePackage.cues,
    artifact: filteredArtifact,
    displayTextByCueId: new Map(),
    assEventOverridesByCueId: new Map(),
    vttCueSettingsByCueId: new Map(),
  },
  baseCueHash: presentationArtifact.baseCueHash,
  configuration: {
    maximumAsrRequests: 28,
  },
  runner: new NodeProcessRunner(),
  whisperCppPath: path.resolve(values["whisper-cpp-path"]),
  localModelPath: path.resolve(values["local-transcription-model"]),
  ...(values["whisper-vad-model"] === undefined
    ? {}
    : { vadModelPath: path.resolve(values["whisper-vad-model"]) }),
  coreML: "off",
  whisperExecutionMode: "process",
  asrCacheDirectory: path.resolve(values["asr-cache-dir"]),
  asrCacheMode: "read-write",
  timestampEvidenceIntegrity: "observe",
  tokenTimestampPolicy: "off",
  rawVadPolicy: "off",
});

process.stdout.write(
  `${JSON.stringify(
    {
      taskDirectory: located.taskDirectory,
      subtitleDirectory: located.subtitleDirectory,
      selectedDecisionIds: selected.map((decision) => decision.decisionId),
      selectedCueIds: [...selectedCueIds],
      componentCount: result.artifact.summary.componentCount,
      cueCount: selectedCueIds.size,
      asrRequestCount: result.artifact.summary.asrRequestCount,
      cacheHitCount: result.artifact.summary.cacheHitCount,
      modelLoadCount: result.executionMetrics.modelLoadCount,
      productionStatus: "needs-review",
      finalizationMethod: "none",
    },
    null,
    2,
  )}\n`,
);
