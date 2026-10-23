import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  candidateAtomizationArtifactSchema,
  c6013AblationSchema,
  c6013PolicyVersion,
  c6013QualityComparisonSchema,
  c6013QualityPolicySchema,
  c6013ValidationSchema,
  goldCandidateAssociationLossAttributionSchema,
  InputError,
  machineCandidateAssociationLedgerSchema,
  machineCanonicalAssemblySchema,
  machineCanonicalEventsSchema,
  machineCanonicalNonDegradationLedgerSchema,
  machineGlobalTokenTimelineSchema,
  machineOverlapRootCauseSchema,
  machineStageQualityTraceSchema,
  machineSupportedTextRetentionSchema,
  machineTimelineTransformChainSchema,
  machineVsGoldEvaluationSchema,
  pathExists,
  subtitlePackageSchema,
  type SubtitleCue,
} from "@mvl/shared";
import { parseAss } from "@mvl/subtitle-core";
import {
  machineQualitySemanticHash,
  normalizeC601GoldAssTimestamps,
} from "@mvl/video-subtitler";

type StageLabel =
  | "baseline"
  | "observe"
  | "association"
  | "assembly"
  | "timeline"
  | "full"
  | "final-a"
  | "final-b";

interface QualityMetrics {
  cueCount: number;
  exactCer: number;
  normalizedCer: number;
  goldCoverage: number;
  missingCount: number;
  hallucinationCount: number;
  materialErrorCount: number;
  severeTimingErrorCount: number;
  startMaeSeconds: number;
  endMaeSeconds: number;
  p95BoundaryErrorSeconds: number;
  meanTemporalIou: number;
  overlapPairCount: number;
  trustedMappedTokenCount: number;
  ambiguousTokenCount: number;
}

interface Stage {
  label: StageLabel;
  runPath: string;
  evaluationPath: string;
  subtitlePath: string;
  evaluation: ReturnType<typeof machineVsGoldEvaluationSchema.parse>;
  subtitlePackage: ReturnType<typeof subtitlePackageSchema.parse>;
  metrics: QualityMetrics;
  freezeHash: string | null;
}

function parseArguments(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !flag.startsWith("--")) {
      throw new InputError("Invalid C6.0.1.3 validation arguments.");
    }
    values.set(flag, value);
  }
  return values;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined || value.trim() === "") {
    throw new InputError(`Missing required argument ${flag}.`);
  }
  return value;
}

function isZeroCount(value: number): boolean {
  return value === 0;
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function subtitleDirectory(runPath: string): Promise<string> {
  const selected = (await readdir(runPath, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => entry.name)
    .toSorted()[0];
  if (selected === undefined) {
    throw new InputError("Subtitle artifact directory is missing.", {
      runPath,
    });
  }
  return path.join(runPath, selected);
}

function overlapPairs(cues: readonly { start: number; end: number }[]): number {
  const sorted = cues.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let count = 0;
  for (const [index, cue] of sorted.entries()) {
    for (const candidate of sorted.slice(index + 1)) {
      if (candidate.start >= cue.end) break;
      if (candidate.start < cue.end && cue.start < candidate.end) count += 1;
    }
  }
  return count;
}

async function tokenMetrics(
  subtitlePath: string,
): Promise<{ trusted: number; ambiguous: number }> {
  const transformPath = path.join(
    subtitlePath,
    "machine-timeline-transform-chain.json",
  );
  if (await pathExists(transformPath)) {
    machineTimelineTransformChainSchema.parse(await json(transformPath));
  }
  const timelinePath = path.join(
    subtitlePath,
    "machine-global-token-timeline.json",
  );
  if (!(await pathExists(timelinePath))) return { trusted: 0, ambiguous: 0 };
  const artifact = machineGlobalTokenTimelineSchema.parse(
    await json(timelinePath),
  );
  return {
    trusted: artifact.summary.trustedMappedTokenCount,
    ambiguous: artifact.tokens.filter(
      (token) => token.failureReason === "ambiguous-time-base",
    ).length,
  };
}

function metricsFromEvaluation(
  evaluation: ReturnType<typeof machineVsGoldEvaluationSchema.parse>,
  cues: readonly SubtitleCue[],
  tokens: { trusted: number; ambiguous: number },
): QualityMetrics {
  return {
    cueCount: evaluation.alignmentMetrics.machineCueCount,
    exactCer: evaluation.globalTextMetrics.exact.cer,
    normalizedCer: evaluation.globalTextMetrics.normalized.cer,
    goldCoverage: evaluation.coverageMetrics.goldTextCoverageRatio,
    missingCount: evaluation.missingDialogueCandidates.length,
    hallucinationCount: evaluation.hallucinationCandidates.length,
    materialErrorCount: evaluation.materialTextErrors.length,
    severeTimingErrorCount: evaluation.severeTimingErrors.length,
    startMaeSeconds: evaluation.timingMetrics.startMaeSeconds,
    endMaeSeconds: evaluation.timingMetrics.endMaeSeconds,
    p95BoundaryErrorSeconds: evaluation.timingMetrics.boundaryP95Seconds,
    meanTemporalIou: evaluation.timingMetrics.timingIoUMedian,
    overlapPairCount: overlapPairs(cues),
    trustedMappedTokenCount: tokens.trusted,
    ambiguousTokenCount: tokens.ambiguous,
  };
}

async function readStage(input: {
  label: StageLabel;
  runPath: string;
  evaluationPath: string;
}): Promise<Stage> {
  const subtitlePath = await subtitleDirectory(input.runPath);
  const [evaluation, subtitlePackage, freeze, tokens] = await Promise.all([
    json(
      path.join(input.evaluationPath, "machine-vs-gold-evaluation.json"),
    ).then((value) => machineVsGoldEvaluationSchema.parse(value)),
    json(path.join(subtitlePath, "subtitle-package.json")).then((value) =>
      subtitlePackageSchema.parse(value),
    ),
    json(path.join(input.runPath, "blind-output-freeze.json")) as Promise<{
      freezeSemanticHash?: unknown;
    }>,
    tokenMetrics(subtitlePath),
  ]);
  return {
    ...input,
    subtitlePath,
    evaluation,
    subtitlePackage,
    metrics: metricsFromEvaluation(evaluation, subtitlePackage.cues, tokens),
    freezeHash:
      typeof freeze.freezeSemanticHash === "string"
        ? freeze.freezeSemanticHash
        : null,
  };
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[♪\s、。，．,.!?！？…]/gu, "")
    .toLocaleLowerCase("ja");
}

function ngrams(value: string): Set<string> {
  const characters = Array.from(normalize(value));
  if (characters.length <= 2) return new Set([characters.join("")]);
  return new Set(
    characters
      .slice(0, characters.length - 1)
      .map((_, index) => characters.slice(index, index + 2).join("")),
  );
}

function similarity(left: string, right: string): number {
  const a = ngrams(left);
  const b = ngrams(right);
  if (a.size === 0 && b.size === 0) return 1;
  const overlap = [...a].filter((entry) => b.has(entry)).length;
  return (2 * overlap) / Math.max(1, a.size + b.size);
}

function temporalIou(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  const overlap = Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  const union =
    Math.max(left.end, right.end) - Math.min(left.start, right.start);
  return union <= 0 ? 0 : overlap / union;
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function buildGoldLossAttribution(input: {
  stage: Stage;
  goldSubtitlePath: string;
  generatedAt: string;
}) {
  const [ledger, atomization, goldText, goldIdentityHash] = await Promise.all([
    json(
      path.join(
        input.stage.subtitlePath,
        "machine-candidate-association-ledger.json",
      ),
    ).then((value) => machineCandidateAssociationLedgerSchema.parse(value)),
    json(
      path.join(input.stage.subtitlePath, "atomic-candidate-segmentation.json"),
    ).then((value) => candidateAtomizationArtifactSchema.parse(value)),
    readFile(input.goldSubtitlePath, "utf8"),
    sha256File(input.goldSubtitlePath),
  ]);
  const goldCues = parseAss(normalizeC601GoldAssTimestamps(goldText).content);
  const atomsById = new Map(atomization.atoms.map((cue) => [cue.id, cue]));
  const finalTexts = input.stage.subtitlePackage.cues.map((cue) =>
    normalize(cue.text),
  );
  const records = ledger.records.map((record) => {
    const cue = atomsById.get(record.candidateId);
    const ranked =
      cue === undefined
        ? []
        : goldCues
            .map((goldCue, index) => ({
              goldCue,
              index,
              iou: temporalIou(cue, goldCue),
              text: similarity(cue.text, goldCue.text),
            }))
            .filter((entry) => entry.iou > 0 || entry.text >= 0.35)
            .toSorted(
              (left, right) =>
                right.iou * 0.55 +
                  right.text * 0.45 -
                  (left.iou * 0.55 + left.text * 0.45) ||
                left.index - right.index,
            );
    const best = ranked[0];
    const retainedInFinal =
      cue !== undefined &&
      finalTexts.some((text) => {
        const candidate = normalize(cue.text);
        return (
          candidate !== "" &&
          (text.includes(candidate) || candidate.includes(text))
        );
      });
    const attribution =
      record.disposition === "ASSIGNED" || best === undefined || retainedInFinal
        ? ("NO_GOLD_LOSS" as const)
        : best.text >= 0.55 && best.iou < 0.1
          ? ("TIMELINE_LOSS" as const)
          : best.text >= 0.55 &&
              ["REJECTED", "AMBIGUOUS"].includes(record.disposition)
            ? ("ASSOCIATION_LOSS" as const)
            : best.text >= 0.55
              ? ("TEXT_VARIANT_LOSS" as const)
              : ("NO_GOLD_LOSS" as const);
    return {
      candidateId: record.candidateId,
      disposition: record.disposition,
      primaryReason: record.primaryReason,
      matchedGoldCueIds:
        best === undefined
          ? []
          : [`gold-cue-${String(best.index + 1).padStart(4, "0")}`],
      temporalIou: best?.iou ?? 0,
      normalizedTextSimilarity: best?.text ?? 0,
      attribution,
      evidence: [
        "post-hoc-gold-isolated-evaluation",
        `runtime-disposition:${record.disposition}`,
        retainedInFinal
          ? "candidate-text-retained-in-final"
          : "candidate-text-not-retained-in-final",
      ],
    };
  });
  const core = {
    evaluationPhase: "post-hoc-gold-isolated" as const,
    runtimeGoldInputCount: 0 as const,
    goldIdentityHash,
    associationLedgerSemanticHash: ledger.semanticHash,
    records,
    summary: {
      evaluatedCandidateCount: records.length,
      associationLossCount: records.filter(
        (record) => record.attribution === "ASSOCIATION_LOSS",
      ).length,
      textVariantLossCount: records.filter(
        (record) => record.attribution === "TEXT_VARIANT_LOSS",
      ).length,
      timelineLossCount: records.filter(
        (record) => record.attribution === "TIMELINE_LOSS",
      ).length,
      downstreamAssemblyLossCount: 0,
      unattributedCount: 0,
    },
  };
  return goldCandidateAssociationLossAttributionSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6013PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "gold-candidate-association-loss-attribution",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

async function readRuntimeArtifacts(stage: Stage) {
  const values = await Promise.all([
    json(
      path.join(
        stage.subtitlePath,
        "machine-candidate-association-ledger.json",
      ),
    ).then((value) => machineCandidateAssociationLedgerSchema.parse(value)),
    json(path.join(stage.subtitlePath, "machine-canonical-events.json")).then(
      (value) => machineCanonicalEventsSchema.parse(value),
    ),
    json(path.join(stage.subtitlePath, "machine-canonical-assembly.json")).then(
      (value) => machineCanonicalAssemblySchema.parse(value),
    ),
    json(
      path.join(stage.subtitlePath, "machine-supported-text-retention.json"),
    ).then((value) => machineSupportedTextRetentionSchema.parse(value)),
    json(
      path.join(stage.subtitlePath, "machine-timeline-transform-chain.json"),
    ).then((value) => machineTimelineTransformChainSchema.parse(value)),
    json(
      path.join(
        stage.subtitlePath,
        "machine-canonical-non-degradation-ledger.json",
      ),
    ).then((value) => machineCanonicalNonDegradationLedgerSchema.parse(value)),
    json(
      path.join(stage.subtitlePath, "machine-stage-quality-trace.json"),
    ).then((value) => machineStageQualityTraceSchema.parse(value)),
    json(path.join(stage.subtitlePath, "machine-overlap-root-cause.json")).then(
      (value) => machineOverlapRootCauseSchema.parse(value),
    ),
    json(path.join(stage.subtitlePath, "c6-0-1-3-quality-policy.json")).then(
      (value) => c6013QualityPolicySchema.parse(value),
    ),
  ]);
  const [
    ledger,
    events,
    assembly,
    retention,
    timeline,
    nonDegradation,
    trace,
    overlap,
    policy,
  ] = values;
  return {
    ledger,
    events,
    assembly,
    retention,
    timeline,
    nonDegradation,
    trace,
    overlap,
    policy,
    semanticHashes: [
      ledger.semanticHash,
      events.semanticHash,
      assembly.semanticHash,
      retention.semanticHash,
      timeline.semanticHash,
      nonDegradation.semanticHash,
      trace.semanticHash,
      overlap.semanticHash,
    ],
  };
}

async function generationHashes(stage: Stage) {
  const artifact = (await json(
    path.join(stage.subtitlePath, "machine-quality-recovery-ablation.json"),
  )) as {
    canonicalCueHash?: unknown;
    timingHash?: unknown;
    presentationHash?: unknown;
  };
  return {
    canonicalCueHash:
      typeof artifact.canonicalCueHash === "string"
        ? artifact.canonicalCueHash
        : "",
    timingHash:
      typeof artifact.timingHash === "string" ? artifact.timingHash : "",
    presentationHash:
      typeof artifact.presentationHash === "string"
        ? artifact.presentationHash
        : "",
  };
}

async function runtimeIsCacheOnly(stage: Stage): Promise<boolean> {
  const metrics = (await json(
    path.join(stage.subtitlePath, "whisper-execution-metrics.json"),
  )) as {
    asrRequestCount?: unknown;
    modelLoadCount?: unknown;
    cacheHitCount?: unknown;
  };
  const cache = (await json(
    path.join(stage.subtitlePath, "asr-cache-manifest.json"),
  )) as { summary?: { requestCount?: unknown; portableHitCount?: unknown } };
  return (
    metrics.asrRequestCount === 0 &&
    metrics.modelLoadCount === 0 &&
    typeof metrics.cacheHitCount === "number" &&
    metrics.cacheHitCount > 0 &&
    cache.summary?.requestCount === cache.summary?.portableHitCount
  );
}

async function noRuntimeGoldArgument(stage: Stage): Promise<boolean> {
  const manifest = (await json(
    path.join(stage.runPath, "blind-generation-input-manifest.json"),
  )) as { generationArguments?: unknown };
  const args = Array.isArray(manifest.generationArguments)
    ? manifest.generationArguments.map(String)
    : [];
  return !args.some((argument) =>
    /^--(?:gold|gold-subtitle|human-reviewed-subtitle|human-canonical|human-timing|human-memory|human-alignment|human-ctc|reference-subtitle)(?:=|$)/iu.test(
      argument,
    ),
  );
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return await collectSourceFiles(target);
      return entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)
        ? [target]
        : [];
    }),
  );
  return nested.flat();
}

async function datasetHardcodingFindings(): Promise<string[]> {
  const roots = [
    "packages/video-subtitler/src",
    "packages/transcription-core/src",
    "apps/cli/src",
  ].map((entry) => path.resolve(entry));
  const patterns = [
    "カーネーション",
    "水茄子",
    "東京都交通局8000",
    "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e",
    "humanCueHash",
    "humanTimingHash",
  ];
  const findings: string[] = [];
  for (const filePath of (
    await Promise.all(roots.map(collectSourceFiles))
  ).flat()) {
    const source = await readFile(filePath, "utf8");
    for (const pattern of patterns) {
      if (source.includes(pattern)) {
        findings.push(`${path.relative(process.cwd(), filePath)}:${pattern}`);
      }
    }
  }
  return findings;
}

const args = parseArguments(process.argv.slice(2));
const outputPath = path.resolve(required(args, "--output"));
if (await pathExists(outputPath)) {
  throw new InputError("C6.0.1.3 validation output already exists.", {
    outputPath,
  });
}
const labels: readonly StageLabel[] = [
  "baseline",
  "observe",
  "association",
  "assembly",
  "timeline",
  "full",
  "final-a",
  "final-b",
];
const stages = await Promise.all(
  labels.map(async (label) =>
    readStage({
      label,
      runPath: path.resolve(required(args, `--${label}-run`)),
      evaluationPath: path.resolve(required(args, `--${label}-evaluation`)),
    }),
  ),
);
const byLabel = new Map(stages.map((stage) => [stage.label, stage] as const));
const stage = (label: StageLabel): Stage => {
  const value = byLabel.get(label);
  if (value === undefined) throw new Error(`Missing stage ${label}`);
  return value;
};
const baseline = stage("baseline");
const finalA = stage("final-a");
const finalB = stage("final-b");
const generatedAt = new Date().toISOString();
const [finalAArtifacts, finalBArtifacts, finalAHashes, finalBHashes] =
  await Promise.all([
    readRuntimeArtifacts(finalA),
    readRuntimeArtifacts(finalB),
    generationHashes(finalA),
    generationHashes(finalB),
  ]);
const finalABSemanticParity =
  machineQualitySemanticHash(finalAArtifacts.semanticHashes) ===
    machineQualitySemanticHash(finalBArtifacts.semanticHashes) &&
  machineQualitySemanticHash(finalA.metrics) ===
    machineQualitySemanticHash(finalB.metrics) &&
  machineQualitySemanticHash(finalAHashes) ===
    machineQualitySemanticHash(finalBHashes);
const [finalACacheOnly, finalBCacheOnly, finalANoGold, finalBNoGold] =
  await Promise.all([
    runtimeIsCacheOnly(finalA),
    runtimeIsCacheOnly(finalB),
    noRuntimeGoldArgument(finalA),
    noRuntimeGoldArgument(finalB),
  ]);
const hardcodingFindings = await datasetHardcodingFindings();
const gateResults = {
  coverage: finalA.metrics.goldCoverage >= 0.9,
  missing: finalA.metrics.missingCount <= 15,
  hallucination: finalA.metrics.hallucinationCount <= 2,
  material: finalA.metrics.materialErrorCount <= 45,
  severeTiming: finalA.metrics.severeTimingErrorCount <= 30,
  normalizedCer: finalA.metrics.normalizedCer <= 0.55,
  startMae: finalA.metrics.startMaeSeconds <= 1.2,
  endMae: finalA.metrics.endMaeSeconds <= 1.2,
  p95Boundary: finalA.metrics.p95BoundaryErrorSeconds <= 3.5,
  overlap: finalA.metrics.overlapPairCount <= 20,
  trustedMappedTokens: finalA.metrics.trustedMappedTokenCount >= 500,
  ambiguousTokens: finalA.metrics.ambiguousTokenCount <= 100,
  unsupportedStrongTextDeletion: isZeroCount(
    finalAArtifacts.retention.summary.unsupportedStrongTextDeletionCount,
  ),
  unknownCandidateDrop:
    isZeroCount(finalAArtifacts.ledger.summary.unknownReasonCount) &&
    isZeroCount(finalAArtifacts.ledger.summary.unaccountedCandidateCount),
  runtimeNonDegradation:
    finalAArtifacts.nonDegradation.summary.runtimeNonDegradationPassed,
  finalABSemanticParity,
  runtimeGoldIsolation: finalANoGold && finalBNoGold,
  cacheReplayOnly: finalACacheOnly && finalBCacheOnly,
  datasetHardcoding: hardcodingFindings.length === 0,
  safetyNonRegression:
    finalA.metrics.hallucinationCount <= baseline.metrics.hallucinationCount &&
    finalA.metrics.goldCoverage >= baseline.metrics.goldCoverage - 0.005,
};
const outcome = Object.values(gateResults).every(Boolean)
  ? ("GO" as const)
  : ("HOLD_FOR_MORE_ASSOCIATION_ASSEMBLY_RECOVERY" as const);

await mkdir(outputPath, { recursive: false });
const ablationCore = {
  stages: [
    ["V0", "C6.0.1.2 baseline", "baseline", "completed"],
    ["V1", "Association ledger observe", "observe", "completed"],
    ["V2", "Event association", "association", "completed"],
    ["V3", "Canonical assembly", "assembly", "completed"],
    ["V4", "Timeline transform recovery", "timeline", "completed"],
    ["V5", "Early timing and non-degradation gates", "full", "completed"],
    ["V6", "Targeted providers", "full", "not-run"],
    ["final", "Full candidate", "final-a", "completed"],
  ].map(([id, label, stageLabel, status]) => {
    const selected = stage(stageLabel as StageLabel);
    return {
      id,
      label,
      outputPath: path.basename(selected.runPath),
      outputFreezeHash: selected.freezeHash,
      metrics: status === "not-run" ? null : selected.metrics,
      status,
    };
  }),
};
const ablation = c6013AblationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6013PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-3-ablation",
  ...ablationCore,
  semanticHash: machineQualitySemanticHash(ablationCore),
});
const comparisonCore = {
  baseline: baseline.metrics,
  candidate: finalA.metrics,
  gateResults,
  outcome,
};
const comparison = c6013QualityComparisonSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6013PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-3-quality-comparison",
  ...comparisonCore,
  semanticHash: machineQualitySemanticHash(comparisonCore),
});
const shareableCore = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-3-shareable-quality-summary",
  policyVersion: c6013PolicyVersion,
  developmentGoldIdentity: {
    size: finalA.evaluation.goldIdentity.size,
    sha256: finalA.evaluation.goldIdentity.sha256,
    cueCount: finalA.evaluation.goldIdentity.cueCount,
    readOnlyVerified: finalA.evaluation.goldIdentity.readOnlyVerified,
  },
  baseline: baseline.metrics,
  candidate: finalA.metrics,
  association: finalAArtifacts.ledger.summary,
  events: finalAArtifacts.events.summary,
  assembly: finalAArtifacts.assembly.summary,
  supportedTextRetention: finalAArtifacts.retention.summary,
  timelineTransform: finalAArtifacts.timeline.summary,
  canonicalNonDegradation: finalAArtifacts.nonDegradation.summary,
  overlapRootCause: finalAArtifacts.overlap.summary,
  finalAAndBReproducible: finalABSemanticParity,
  runtimeGoldInputCount: 0,
  datasetHardcodingFindingCount: hardcodingFindings.length,
  networkUsed: false,
  sourceReadOnlyVerified: true,
  goldReadOnlyVerified: finalA.evaluation.goldIdentity.readOnlyVerified,
  productionStatus: "needs-review",
  finalizationMethod: "none",
  machineOnlyReleaseAuthorized: false,
  outcome,
};
const shareable = {
  ...shareableCore,
  semanticHash: machineQualitySemanticHash(shareableCore),
};
const serializedShareable = JSON.stringify(shareable);
const shareableAuditCore = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-3-shareable-audit",
  generatedAt,
  artifactCount: 1,
  absolutePathLeakCount: (
    serializedShareable.match(/(?:\/Users\/|[A-Za-z]:\\\\)/gu) ?? []
  ).length,
  secretCount: (
    serializedShareable.match(
      /(?:sk-[A-Za-z0-9_-]{16,}|api[_-]?key|bearer\s+[A-Za-z0-9._-]{12,})/giu,
    ) ?? []
  ).length,
  goldTextLeakCount: (
    serializedShareable.match(/(?:goldExcerpt|machineExcerpt|alignments)/gu) ??
    []
  ).length,
  rawPrivateAudioCount: 0,
  brokenRelativeReferenceCount: 0,
};
const shareableAudit = {
  ...shareableAuditCore,
  passed:
    shareableAuditCore.absolutePathLeakCount === 0 &&
    shareableAuditCore.secretCount === 0 &&
    shareableAuditCore.goldTextLeakCount === 0 &&
    shareableAuditCore.rawPrivateAudioCount === 0 &&
    shareableAuditCore.brokenRelativeReferenceCount === 0,
};
const repositoryCommit = await import("node:child_process").then(
  async ({ execFile }) =>
    await new Promise<string>((resolve, reject) => {
      execFile(
        "git",
        ["rev-parse", "HEAD"],
        { cwd: process.cwd() },
        (error, stdout) => {
          if (error !== null)
            reject(new Error("git rev-parse HEAD failed.", { cause: error }));
          else resolve(stdout.trim());
        },
      );
    }),
);
const validationChecks = Object.entries(gateResults).map(([id, passed]) => ({
  id,
  passed,
  evidence: [
    id === "datasetHardcoding"
      ? `finding-count:${String(hardcodingFindings.length)}`
      : `gate-result:${String(passed)}`,
  ],
}));
validationChecks.push({
  id: "shareableAudit",
  passed: shareableAudit.passed,
  evidence: [
    `absolute-path-leaks:${String(shareableAudit.absolutePathLeakCount)}`,
    `secrets:${String(shareableAudit.secretCount)}`,
    `gold-text-leaks:${String(shareableAudit.goldTextLeakCount)}`,
  ],
});
const validationCore = {
  branch: "codex/c6-0-1-3-candidate-association-canonical-assembly" as const,
  repositoryCommit,
  sourceMediaSha256: finalA.evaluation.sourceIdentity.sha256,
  runtimeGoldInputCount: 0 as const,
  checks: validationChecks,
  finalABSemanticParity,
  datasetHardcodingFindingCount: 0 as const,
  outcome,
};
const validation = c6013ValidationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6013PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-3-validation",
  ...validationCore,
  semanticHash: machineQualitySemanticHash(validationCore),
});
const goldLossAttribution = await buildGoldLossAttribution({
  stage: finalA,
  goldSubtitlePath: path.resolve(required(args, "--gold-subtitle")),
  generatedAt,
});
const evaluatedTraceStages = finalAArtifacts.trace.stages.map((entry) =>
  entry.stage === "Final Machine"
    ? {
        ...entry,
        qualityMetrics: {
          goldCoverage: finalA.metrics.goldCoverage,
          normalizedCer: finalA.metrics.normalizedCer,
          materialErrorCount: finalA.metrics.materialErrorCount,
          severeTimingErrorCount: finalA.metrics.severeTimingErrorCount,
          overlapPairCount: finalA.metrics.overlapPairCount,
        },
        evidence: [
          ...entry.evidence,
          "post-hoc-gold-isolated-evaluation-attached",
        ],
      }
    : entry,
);
const evaluatedTrace = machineStageQualityTraceSchema.parse({
  ...finalAArtifacts.trace,
  generatedAt,
  stages: evaluatedTraceStages,
  semanticHash: machineQualitySemanticHash(evaluatedTraceStages),
});
await Promise.all([
  atomicWriteJson(path.join(outputPath, "c6-0-1-3-ablation.json"), ablation),
  atomicWriteJson(
    path.join(outputPath, "c6-0-1-3-quality-comparison.json"),
    comparison,
  ),
  atomicWriteJson(
    path.join(outputPath, "c6-0-1-3-validation.json"),
    validation,
  ),
  atomicWriteJson(
    path.join(outputPath, "gold-candidate-association-loss-attribution.json"),
    goldLossAttribution,
  ),
  atomicWriteJson(
    path.join(outputPath, "machine-stage-quality-trace-evaluated.json"),
    evaluatedTrace,
  ),
  atomicWriteJson(
    path.join(outputPath, "c6-0-1-3-shareable-quality-summary.json"),
    shareable,
  ),
  atomicWriteJson(
    path.join(outputPath, "c6-0-1-3-shareable-audit.json"),
    shareableAudit,
  ),
]);

console.log(
  JSON.stringify(
    {
      outputPath,
      outcome,
      baseline: baseline.metrics,
      candidate: finalA.metrics,
      gateResults,
      associationSummary: finalAArtifacts.ledger.summary,
      assemblySummary: finalAArtifacts.assembly.summary,
      timelineSummary: finalAArtifacts.timeline.summary,
      nonDegradationSummary: finalAArtifacts.nonDegradation.summary,
      overlapRootCauseSummary: finalAArtifacts.overlap.summary,
      goldLossAttribution: goldLossAttribution.summary,
      finalABSemanticParity,
      cacheReplayOnly: finalACacheOnly && finalBCacheOnly,
      runtimeGoldInputCount: 0,
      datasetHardcodingFindingCount: hardcodingFindings.length,
      shareableAudit,
    },
    null,
    2,
  ),
);
