import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  alignReferenceTimeline,
  evaluateAnchorTextCoverage,
  evaluateFinalSubtitleIntegrity,
  repairFinalSubtitleIntegrity,
  repairIntraCueHypothesisRepetition,
  repairTextIntegrityFailures,
  runFinalSubtitleIntegrityGate,
  runFinalTextIntegrityGate,
  validateLyricsText,
} from "@mvl/transcription-core";
import {
  buildAcousticSemanticCueSegments,
  evaluateLineLayoutIntegrity,
  evaluatePresentationConstraintIntegrity,
  formatAss,
  formatSrt,
  formatVtt,
  layoutSubtitleCuesWithDiagnostics,
} from "@mvl/subtitle-core";
import {
  atomicWriteFile,
  atomicWriteJson,
  atomicHypothesisClustersArtifactSchema,
  candidateAtomizationArtifactSchema,
  discoveredSpeechAnchorsArtifactSchema,
  finalReviewQueueSchema,
  intraCueRepetitionRepairArtifactSchema,
  japaneseTerminologyFileSchema,
  referenceTimelineArtifactSchema,
  subtitlePackageSchema,
  terminologyEvidenceArtifactSchema,
  topScoreResolutionArtifactSchema,
  topScoreWinnersArtifactSchema,
  winnerDeduplicationArtifactSchema,
  type IntraCueRepetitionRepairArtifact,
  type SubtitleCue,
} from "@mvl/shared";

const C2_ROOT = path.resolve(
  "output/carnation-reference-guided-c2-uncached-20260730",
);
const C4_ROOT = path.resolve(
  "output/carnation-reference-guided-c4-cached-20260801",
);
const C41_ROOT = path.resolve(
  "output/carnation-reference-guided-c4-1-presentation-fixed-20260801",
);
const A4_ROOT = path.resolve(
  "output/carnation-reference-free-a4-cached-20260801",
);
const B4_ROOT = path.resolve(
  "output/carnation-reference-assisted-b4-cached-20260801",
);

async function subtitleDirectory(root: string): Promise<string> {
  const name = (await readdir(root)).find((entry) =>
    entry.startsWith("subtitle-"),
  );
  if (name === undefined)
    throw new Error(`No subtitle artifact directory under ${root}`);
  return path.join(root, name);
}

async function json(directory: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(directory, name), "utf8"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function combineIntraArtifacts(
  first: IntraCueRepetitionRepairArtifact,
  second: IntraCueRepetitionRepairArtifact,
): IntraCueRepetitionRepairArtifact {
  const records = [...first.records, ...second.records];
  return intraCueRepetitionRepairArtifactSchema.parse({
    ...second,
    inputHash: first.inputHash,
    records,
    summary: {
      inputCueCount: first.summary.inputCueCount,
      outputCueCount: second.summary.outputCueCount,
      detectedCueCount: records.length,
      repairedCueCount:
        first.summary.repairedCueCount + second.summary.repairedCueCount,
      trueSpokenRepetitionCount:
        first.summary.trueSpokenRepetitionCount +
        second.summary.trueSpokenRepetitionCount,
      removedSpanCount:
        first.summary.removedSpanCount + second.summary.removedSpanCount,
      preservedTailCount:
        first.summary.preservedTailCount + second.summary.preservedTailCount,
      japaneseSpacesRemoved:
        first.summary.japaneseSpacesRemoved +
        second.summary.japaneseSpacesRemoved,
    },
    fallback:
      records.length === 0 ? "no-intra-cue-hypothesis-repetition" : null,
  });
}

function overlappingCues(
  cues: readonly SubtitleCue[],
  start: number,
  end: number,
): SubtitleCue[] {
  return cues.filter((cue) => cue.start < end && cue.end > start);
}

async function blindRunHashes(root: string) {
  const directory = await subtitleDirectory(root);
  const proof = JSON.parse(
    await readFile(path.join(directory, "blind-generation-proof.json"), "utf8"),
  ) as {
    generatedSubtitleSha256: string;
    canonicalTranscriptSha256: string;
  };
  const names = await readdir(directory);
  const rendered = Object.fromEntries(
    await Promise.all(
      (["srt", "vtt", "ass"] as const).map(async (extension) => {
        const name = names.find(
          (candidate) =>
            candidate.endsWith(`.${extension}`) &&
            candidate !== "subtitle-diff.ass",
        );
        if (name === undefined)
          throw new Error(`Missing ${extension} under ${directory}`);
        return [
          extension,
          await sha256File(path.join(directory, name)),
        ] as const;
      }),
    ),
  );
  return { root, proof, rendered };
}

const started = performance.now();
const c4SubtitleDirectory = await subtitleDirectory(C4_ROOT);
const c2SubtitleDirectory = await subtitleDirectory(C2_ROOT);
const c41SubtitleDirectory = path.join(
  C41_ROOT,
  path.basename(c4SubtitleDirectory),
);
await mkdir(C41_ROOT, { recursive: true });
await cp(C4_ROOT, C41_ROOT, { recursive: true, force: true });
await mkdir(c41SubtitleDirectory, { recursive: true });

const topScoreWinners = topScoreWinnersArtifactSchema.parse(
  await json(c4SubtitleDirectory, "top-score-winners.json"),
);
const atomization = candidateAtomizationArtifactSchema.parse(
  await json(c4SubtitleDirectory, "atomic-candidate-segmentation.json"),
);
const atomicClusters = atomicHypothesisClustersArtifactSchema.parse(
  await json(c4SubtitleDirectory, "atomic-hypothesis-clusters.json"),
);
const topScoreResolution = topScoreResolutionArtifactSchema.parse(
  await json(c4SubtitleDirectory, "top-score-resolution.json"),
);
const winnerDeduplication = winnerDeduplicationArtifactSchema.parse(
  await json(c4SubtitleDirectory, "winner-deduplication.json"),
);
const timeline = referenceTimelineArtifactSchema.parse(
  await json(c4SubtitleDirectory, "reference-timeline.json"),
);
const speechAnchors = discoveredSpeechAnchorsArtifactSchema.parse(
  await json(c4SubtitleDirectory, "discovered-speech-anchors.json"),
);
const oldReview = finalReviewQueueSchema.parse(
  await json(c4SubtitleDirectory, "final-review-queue.json"),
);
const oldPackage = subtitlePackageSchema.parse(
  await json(c4SubtitleDirectory, "subtitle-package.json"),
);
const oldCoverage = (await json(
  c4SubtitleDirectory,
  "anchor-text-coverage.json",
)) as {
  summary: unknown;
};
const terminologyEvidence = terminologyEvidenceArtifactSchema.parse(
  await json(c2SubtitleDirectory, "terminology-evidence.json"),
);
const c4Terminology = japaneseTerminologyFileSchema.parse(
  JSON.parse(
    await readFile(
      path.resolve("examples/carnation-c4-terminology.json"),
      "utf8",
    ),
  ),
);
const terminologyEntries = [
  ...terminologyEvidence.entries,
  ...c4Terminology.entries,
];

const initialSegmentation = buildAcousticSemanticCueSegments(oldPackage.cues, {
  mode: "acoustic-semantic",
  japaneseTextAnalyzer: "auto",
  referenceTimeline: timeline,
  maximumCharactersPerLine: 128,
  maximumCueDurationSeconds: 20,
  maximumCharactersPerSecond: 100,
  maximumMergeGapSeconds: 0,
});
const lyricsValidity = validateLyricsText({ cues: initialSegmentation.cues });
const preliminaryTextIntegrity = runFinalTextIntegrityGate({
  cues: initialSegmentation.cues,
  mode: "observe",
  japaneseTextAnalysis: initialSegmentation.japaneseTextAnalysis,
  segmentationPlan: initialSegmentation.plan,
  lyricsValidity,
});
const textIntegrityRepair = repairTextIntegrityFailures({
  cues: initialSegmentation.cues,
  preliminary: preliminaryTextIntegrity.artifact,
  preSegmentationCues: oldPackage.cues,
  allCandidates: atomization.atoms,
  atomicClusters,
  topScoreResolution,
  winnerDeduplication,
  segmentationPlan: initialSegmentation.plan,
  maximumRepairRounds: 1,
});
const firstIntraRepair = repairIntraCueHypothesisRepetition({
  cues: textIntegrityRepair.cues,
  sourceCues: [
    ...atomization.atoms,
    ...topScoreWinners.winners,
    ...oldPackage.cues,
  ],
  terminologyEntries,
});
const postTextRepairSegmentation = buildAcousticSemanticCueSegments(
  firstIntraRepair.cues,
  {
    mode: "acoustic-semantic",
    japaneseTextAnalyzer: "auto",
    referenceTimeline: timeline,
  },
);
const postRepairLyricsValidity = validateLyricsText({
  cues: postTextRepairSegmentation.cues,
});
const textIntegrityGate = runFinalTextIntegrityGate({
  cues: postTextRepairSegmentation.cues,
  mode: "enforce",
  japaneseTextAnalysis: postTextRepairSegmentation.japaneseTextAnalysis,
  segmentationPlan: postTextRepairSegmentation.plan,
  lyricsValidity: postRepairLyricsValidity,
});

const supportedLyricsCueIds = textIntegrityGate.cues
  .filter(
    (cue) => cue.provenance?.sourceLayer === "reference-original-language",
  )
  .map((cue) => cue.id);
const preliminarySubtitleIntegrity = evaluateFinalSubtitleIntegrity({
  cues: textIntegrityGate.cues,
  supportedLyricsCueIds,
});
const finalSubtitleRepair = repairFinalSubtitleIntegrity({
  cues: textIntegrityGate.cues,
  findings: preliminarySubtitleIntegrity.findings,
});
const secondIntraRepair = repairIntraCueHypothesisRepetition({
  cues: finalSubtitleRepair.cues,
  sourceCues: [
    ...atomization.atoms,
    ...topScoreWinners.winners,
    ...oldPackage.cues,
  ],
  terminologyEntries,
});
const intraCueRepetitionRepair = combineIntraArtifacts(
  firstIntraRepair.artifact,
  secondIntraRepair.artifact,
);
const postSubtitleRepairSegmentation = buildAcousticSemanticCueSegments(
  secondIntraRepair.cues,
  {
    mode: "acoustic-semantic",
    japaneseTextAnalyzer: "auto",
    referenceTimeline: timeline,
  },
);
const presentation = layoutSubtitleCuesWithDiagnostics(
  postSubtitleRepairSegmentation.cues,
  {
    segmentationMode: "presegmented",
    allowTemporalCueSplitting: false,
    maxLines: 2,
    maxCharactersPerLine: 16,
  },
);
const candidateLineLayoutIntegrity = evaluateLineLayoutIntegrity(
  presentation.cues,
);
const unsafeCueIds = new Set(
  candidateLineLayoutIntegrity.findings.map((finding) => finding.cueId),
);
const strictLayoutCues = presentation.cues.filter(
  (cue) => !unsafeCueIds.has(cue.id),
);
const finalTextProjection = runFinalTextIntegrityGate({
  cues: strictLayoutCues,
  mode: "enforce",
  japaneseTextAnalysis: postSubtitleRepairSegmentation.japaneseTextAnalysis,
  segmentationPlan: postSubtitleRepairSegmentation.plan,
});
const finalSubtitleProjection = runFinalSubtitleIntegrityGate({
  cues: finalTextProjection.cues,
  supportedLyricsCueIds,
  supportedLongCueIds: finalSubtitleRepair.supportedLongCueIds,
  strictPresentationConstraints: true,
});
const finalSubtitleGate = runFinalSubtitleIntegrityGate({
  cues: finalSubtitleProjection.cues,
  supportedLyricsCueIds,
  supportedLongCueIds: finalSubtitleRepair.supportedLongCueIds,
  strictPresentationConstraints: true,
});
const finalSubtitleAudit = runFinalSubtitleIntegrityGate({
  cues: finalSubtitleGate.cues,
  supportedLyricsCueIds,
  supportedLongCueIds: finalSubtitleRepair.supportedLongCueIds,
  strictPresentationConstraints: true,
});
const finalCues = finalSubtitleAudit.cues;
const finalTextAudit = runFinalTextIntegrityGate({
  cues: finalCues,
  mode: "observe",
  segmentationPlan: postSubtitleRepairSegmentation.plan,
});
const lineLayoutIntegrity = evaluateLineLayoutIntegrity(finalCues);
const srt = formatSrt(finalCues);
const vtt = formatVtt(finalCues);
const ass = formatAss(finalCues);
const presentationConstraintIntegrity = evaluatePresentationConstraintIntegrity(
  {
    cues: finalCues,
    ass,
  },
);
const generatedSubtitleSha256 = sha256(srt);
const alignment = alignReferenceTimeline({
  timeline,
  generatedCues: finalCues,
  generatedSubtitleSha256,
  speechIntervals: speechAnchors.anchors.map((anchor) => anchor.interval),
});
const anchorCoverage = evaluateAnchorTextCoverage({
  timeline,
  alignment,
  generatedCues: finalCues,
  generatedSubtitleSha256,
  finalTextIntegrity: finalTextAudit.artifact,
  activeReviewIntervals: oldReview.groups.map((group) => group.interval),
});
const [a4Hashes, b4Hashes] = await Promise.all([
  blindRunHashes(A4_ROOT),
  blindRunHashes(B4_ROOT),
]);

const reusableArtifactNames = [
  "top-score-winners.json",
  "atomic-candidate-segmentation.json",
  "atomic-hypothesis-clusters.json",
  "top-score-resolution.json",
  "coverage-recovery-results.json",
  "asr-cache-manifest.json",
  "asr-cache-migration.json",
] as const;
const reusedArtifactHashes = Object.fromEntries(
  await Promise.all(
    reusableArtifactNames.map(
      async (name) =>
        [
          name,
          {
            source: await sha256File(path.join(c4SubtitleDirectory, name)),
            replay: await sha256File(path.join(c41SubtitleDirectory, name)),
          },
        ] as const,
    ),
  ),
);
const regressionWindows = [
  { id: "spacing", start: 134.757823, end: 141.869792 },
  { id: "single-cue-repeat", start: 241.81, end: 245.94 },
  { id: "complete-sentence-repeat", start: 320.69, end: 330 },
  { id: "overlap-alternative", start: 800.24, end: 805.09 },
].map((window) => ({
  ...window,
  cues: overlappingCues(finalCues, window.start, window.end).map((cue) => ({
    id: cue.id,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    reviewRecommended: cue.textAudit?.reviewRecommended ?? false,
    reviewReasons: cue.textAudit?.reviewReasons ?? [],
  })),
}));
const finalHardFindingCount =
  finalTextAudit.artifact.findings.filter(
    (finding) => finding.severity === "hard",
  ).length +
  finalSubtitleAudit.artifact.findings.filter(
    (finding) => finding.severity === "hard",
  ).length;
const report = {
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  runType: "C4.1 cached presentation-integrity replay",
  sourceC4: C4_ROOT,
  outputDirectory: C41_ROOT,
  wholeEpisodeWhisperExecuted: false,
  asrProcessCount: 0,
  reusedArtifactHashes,
  blindHashRegression: {
    a4: a4Hashes,
    b4: b4Hashes,
    generatedSubtitleHashesMatch:
      a4Hashes.proof.generatedSubtitleSha256 ===
        b4Hashes.proof.generatedSubtitleSha256 &&
      a4Hashes.rendered.srt === b4Hashes.rendered.srt &&
      a4Hashes.rendered.vtt === b4Hashes.rendered.vtt &&
      a4Hashes.rendered.ass === b4Hashes.rendered.ass,
    canonicalTranscriptHashesMatch:
      a4Hashes.proof.canonicalTranscriptSha256 ===
      b4Hashes.proof.canonicalTranscriptSha256,
  },
  before: {
    finalCueCount: oldPackage.cues.length,
    anchorCoverage: oldCoverage.summary,
    trueMissingDialogueGroupCount: oldReview.trueMissingDialogueGroupCount ?? 0,
  },
  after: {
    finalCueCount: finalCues.length,
    anchorCoverage: anchorCoverage.summary,
    trueMissingDialogueGroupCount: oldReview.trueMissingDialogueGroupCount ?? 0,
    lyricsCueCount: finalCues.filter((cue) => cue.style === "music").length,
    unsafePresentationCueCount: unsafeCueIds.size,
    finalHardFindingCount,
    lineLayoutIntegrity,
    presentationConstraintIntegrity,
    finalSubtitleMetrics: finalSubtitleAudit.artifact.metrics,
    characterRatioFallbackCount:
      initialSegmentation.plan.summary.characterFallbackSegmentationCount +
      postTextRepairSegmentation.plan.summary
        .characterFallbackSegmentationCount +
      postSubtitleRepairSegmentation.plan.summary
        .characterFallbackSegmentationCount +
      presentation.characterFallbackSegmentationCount,
  },
  repair: {
    textIntegrity: textIntegrityRepair.artifact.summary,
    intraCueRepetition: intraCueRepetitionRepair.summary,
    postTextRepairSegmentation: postTextRepairSegmentation.plan.summary,
    finalSubtitle: {
      repairedCount: finalSubtitleRepair.artifact.repairs.filter(
        (entry) => entry.result === "repaired",
      ).length,
      strategies: finalSubtitleRepair.artifact.repairs.map(
        (entry) => entry.strategy,
      ),
    },
    postSubtitleRepairSegmentation: postSubtitleRepairSegmentation.plan.summary,
    strictLayoutSplitCount: presentation.timingRecords.filter(
      (record) => record.splitCount > 1,
    ).length,
  },
  regressionWindows,
  subtitleHashes: {
    srt: generatedSubtitleSha256,
    vtt: sha256(vtt),
    ass: sha256(ass),
  },
  wallClockSeconds: (performance.now() - started) / 1000,
};

const packageWarnings = [
  ...oldPackage.warnings.filter((warning) => !warning.startsWith("C4.1")),
  "C4.1 reused C4 candidates, winners, coverage recovery, and ASR cache; Whisper was not executed.",
  `${unsafeCueIds.size} unresolved presentation-capacity cues were excluded and retained in audit artifacts for review.`,
];
const subtitlePackage = subtitlePackageSchema.parse({
  ...oldPackage,
  cues: finalCues,
  warnings: packageWarnings,
  transcription:
    oldPackage.transcription === undefined
      ? undefined
      : {
          ...oldPackage.transcription,
          finalSubtitleIntegrity:
            oldPackage.transcription.finalSubtitleIntegrity === undefined
              ? undefined
              : {
                  ...oldPackage.transcription.finalSubtitleIntegrity,
                  finalCueCount: finalCues.length,
                  quarantinedCueCount:
                    finalSubtitleAudit.artifact.quarantinedCueIds.length +
                    unsafeCueIds.size,
                  hardFindingCount: finalHardFindingCount,
                },
        },
});
const processingManifest = {
  ...((await json(c4SubtitleDirectory, "processing-manifest.json")) as object),
  taskId: "carnation-reference-guided-c4-1-presentation-fixed-20260801",
  startedAt: report.generatedAt,
  updatedAt: new Date().toISOString(),
  outputDirectory: C41_ROOT,
  status: "completed",
  completedStages: [
    "c4-candidates-cache-reuse",
    "text-integrity-repair",
    "intra-cue-repetition-repair",
    "post-text-repair-segmentation",
    "final-subtitle-repair",
    "post-subtitle-repair-segmentation",
    "strict-layout",
    "line-layout-integrity",
    "final-subtitle-integrity",
    "subtitle-formatting",
  ],
};
const reportMarkdown = `# C4.1 Cached Presentation Integrity Replay

- Whole-episode Whisper executed: **no**
- ASR process count: **0**
- Final cues: **${oldPackage.cues.length} → ${finalCues.length}**
- Japanese spaces removed: **${intraCueRepetitionRepair.summary.japaneseSpacesRemoved}**
- Intra-cue repetitions repaired: **${intraCueRepetitionRepair.summary.repairedCueCount}**
- Lines over 16 characters: **${lineLayoutIntegrity.lineTooLongCount}**
- Cues over 2 lines: **${lineLayoutIntegrity.tooManyLinesCount}**
- Unresolved presentation capacity in final output: **${lineLayoutIntegrity.unresolvedCapacityCount}**
- Character-ratio timing fallback: **${report.after.characterRatioFallbackCount}**
- Final hard findings: **${finalHardFindingCount}**
- ASS style audit: **${presentationConstraintIntegrity.validationStatus}**
- A4/B4 blind generation hashes unchanged and mutually equal: **${String(
  report.blindHashRegression.generatedSubtitleHashesMatch &&
    report.blindHashRegression.canonicalTranscriptHashesMatch,
)}**
`;

const subtitleBaseName = path.basename(c41SubtitleDirectory);
await Promise.all([
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "cue-segmentation-plan.json"),
    initialSegmentation.plan,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "preliminary-text-integrity.json"),
    preliminaryTextIntegrity.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "text-integrity-repair.json"),
    textIntegrityRepair.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "intra-cue-repetition-repair.json"),
    intraCueRepetitionRepair,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "pre-post-text-segmentation-cues.json"),
    firstIntraRepair.cues,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "post-text-repair-segmentation.json"),
    postTextRepairSegmentation.plan,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "post-text-repair-cues.json"),
    postTextRepairSegmentation.cues,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "post-text-repair-final-text-gate.json"),
    textIntegrityGate.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "post-text-gate-cues.json"),
    textIntegrityGate.cues,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "lyrics-text-validity.json"),
    postRepairLyricsValidity,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "preliminary-subtitle-integrity.json"),
    preliminarySubtitleIntegrity,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "final-subtitle-repair.json"),
    finalSubtitleRepair.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "post-subtitle-repair-cues.json"),
    finalSubtitleRepair.cues,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "post-second-intra-cues.json"),
    secondIntraRepair.cues,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "post-subtitle-repair-segmentation.json"),
    postSubtitleRepairSegmentation.plan,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "post-subtitle-segmentation-cues.json"),
    postSubtitleRepairSegmentation.cues,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "presentation-timing.json"),
    presentation.timingRecords,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "line-layout-integrity.json"),
    lineLayoutIntegrity,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "pre-strict-layout-audit.json"),
    {
      schemaVersion: "1.0.0",
      generatedAt: report.generatedAt,
      cues: presentation.cues,
      unsafeCueIds: [...unsafeCueIds],
      lineLayoutIntegrity: candidateLineLayoutIntegrity,
    },
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "presentation-constraint-integrity.json"),
    presentationConstraintIntegrity,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "final-text-integrity.json"),
    finalTextAudit.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "final-subtitle-integrity.json"),
    finalSubtitleAudit.artifact,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "reference-cue-alignment.json"),
    alignment,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "anchor-text-coverage.json"),
    anchorCoverage,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "subtitle-package.json"),
    subtitlePackage,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "processing-manifest.json"),
    processingManifest,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(c41SubtitleDirectory, "c4-1-presentation-replay-report.json"),
    report,
    { overwrite: true },
  ),
  atomicWriteFile(
    path.join(c41SubtitleDirectory, "c4-1-presentation-replay-report.md"),
    reportMarkdown,
    { overwrite: true },
  ),
  atomicWriteFile(
    path.join(c41SubtitleDirectory, `${subtitleBaseName}.srt`),
    srt,
    {
      overwrite: true,
    },
  ),
  atomicWriteFile(
    path.join(c41SubtitleDirectory, `${subtitleBaseName}.vtt`),
    vtt,
    {
      overwrite: true,
    },
  ),
  atomicWriteFile(
    path.join(c41SubtitleDirectory, `${subtitleBaseName}.ass`),
    ass,
    {
      overwrite: true,
    },
  ),
  copyFile(
    path.join(c4SubtitleDirectory, "asr-cache-manifest.json"),
    path.join(c41SubtitleDirectory, "asr-cache-manifest.json"),
  ),
]);

console.log(JSON.stringify(report, null, 2));
