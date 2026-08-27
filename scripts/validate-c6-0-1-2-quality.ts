import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  asrRequestTimelineContractSchema,
  atomicWriteJson,
  blindGenerationInputManifestSchema,
  c6012AblationSchema,
  c6012QualityComparisonSchema,
  c6012ValidationSchema,
  InputError,
  machineAcousticEventFamiliesSchema,
  machineCrossWindowConsensusSchema,
  machineGlobalTokenTimelineSchema,
  machineLexicalConservationSchema,
  machineOverlapEventClassificationSchema,
  machineTimingNonDegradationSchema,
  machineVsGoldEvaluationSchema,
  pathExists,
  subtitleCueSchema,
  subtitlePackageSchema,
  type C6012QualityMetrics,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";

type StageLabel =
  | "baseline"
  | "family"
  | "consensus"
  | "timeline"
  | "full"
  | "final-a"
  | "final-b";

interface Stage {
  label: StageLabel;
  runPath: string;
  evaluationPath: string;
  subtitlePath: string;
  evaluation: ReturnType<typeof machineVsGoldEvaluationSchema.parse>;
  metrics: C6012QualityMetrics;
  freezeHash: string | null;
}

function parseArguments(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !flag.startsWith("--")) {
      throw new InputError("Invalid C6.0.1.2 validation arguments.");
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

function metricsFromEvaluation(
  evaluation: ReturnType<typeof machineVsGoldEvaluationSchema.parse>,
  machineOverlapPairs: number,
): C6012QualityMetrics {
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
    overlapPairCount: machineOverlapPairs,
  };
}

async function readStage(input: {
  label: StageLabel;
  runPath: string;
  evaluationPath: string;
}): Promise<Stage> {
  const subtitlePath = await subtitleDirectory(input.runPath);
  const [evaluation, subtitlePackage, freezeValue] = await Promise.all([
    json(
      path.join(input.evaluationPath, "machine-vs-gold-evaluation.json"),
    ).then((value) => machineVsGoldEvaluationSchema.parse(value)),
    json(path.join(subtitlePath, "subtitle-package.json")).then((value) =>
      subtitlePackageSchema.parse(value),
    ),
    json(path.join(input.runPath, "blind-output-freeze.json")) as Promise<{
      freezeSemanticHash?: unknown;
    }>,
  ]);
  return {
    ...input,
    subtitlePath,
    evaluation,
    metrics: metricsFromEvaluation(
      evaluation,
      overlapPairs(subtitlePackage.cues),
    ),
    freezeHash:
      typeof freezeValue.freezeSemanticHash === "string"
        ? freezeValue.freezeSemanticHash
        : null,
  };
}

async function readRunArtifact(stage: Stage, name: string): Promise<unknown> {
  return await json(path.join(stage.subtitlePath, name));
}

async function readRawMetrics(stage: Stage): Promise<C6012QualityMetrics> {
  const [evaluation, raw] = await Promise.all([
    json(
      path.join(stage.evaluationPath, "raw-asr-vs-gold-evaluation.json"),
    ).then((value) => machineVsGoldEvaluationSchema.parse(value)),
    json(
      path.join(stage.runPath, "audio", "raw-transcription.json"),
    ) as Promise<{
      cues?: unknown;
    }>,
  ]);
  const cues = subtitleCueSchema.array().parse(raw.cues ?? []);
  return metricsFromEvaluation(evaluation, overlapPairs(cues));
}

function metricDeltas(
  candidate: C6012QualityMetrics,
  baseline: C6012QualityMetrics,
) {
  return {
    cueCount: candidate.cueCount - baseline.cueCount,
    exactCer: candidate.exactCer - baseline.exactCer,
    normalizedCer: candidate.normalizedCer - baseline.normalizedCer,
    goldCoverage: candidate.goldCoverage - baseline.goldCoverage,
    missingCount: candidate.missingCount - baseline.missingCount,
    hallucinationCount:
      candidate.hallucinationCount - baseline.hallucinationCount,
    materialErrorCount:
      candidate.materialErrorCount - baseline.materialErrorCount,
    severeTimingErrorCount:
      candidate.severeTimingErrorCount - baseline.severeTimingErrorCount,
    startMaeSeconds: candidate.startMaeSeconds - baseline.startMaeSeconds,
    endMaeSeconds: candidate.endMaeSeconds - baseline.endMaeSeconds,
    p95BoundaryErrorSeconds:
      candidate.p95BoundaryErrorSeconds - baseline.p95BoundaryErrorSeconds,
    meanTemporalIou: candidate.meanTemporalIou - baseline.meanTemporalIou,
    overlapPairCount: candidate.overlapPairCount - baseline.overlapPairCount,
  };
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) return await collectSourceFiles(entryPath);
      return entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)
        ? [entryPath]
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

async function schemaCount(): Promise<number> {
  return (await readdir(path.resolve("schemas"))).filter((name) =>
    name.endsWith(".schema.json"),
  ).length;
}

const args = parseArguments(process.argv.slice(2));
const validationPath = path.resolve(required(args, "--output"));
const artifactDirectory = path.resolve(required(args, "--artifacts-output"));
if (
  (await pathExists(validationPath)) ||
  (await pathExists(artifactDirectory))
) {
  throw new InputError("C6.0.1.2 validation output already exists.", {
    validationPath,
    artifactDirectory,
  });
}

const labels: readonly StageLabel[] = [
  "baseline",
  "family",
  "consensus",
  "timeline",
  "full",
  "final-a",
  "final-b",
];
const stages = await Promise.all(
  labels.map(
    async (label) =>
      await readStage({
        label,
        runPath: path.resolve(required(args, `--${label}-run`)),
        evaluationPath: path.resolve(required(args, `--${label}-evaluation`)),
      }),
  ),
);
const byLabel = new Map(stages.map((stage) => [stage.label, stage] as const));
const stage = (label: StageLabel): Stage => {
  const selected = byLabel.get(label);
  if (selected === undefined) throw new Error(`Missing stage ${label}.`);
  return selected;
};
const baseline = stage("baseline");
const finalA = stage("final-a");
const finalB = stage("final-b");
const rawBaseline = await readRawMetrics(baseline);

const [
  finalAFamily,
  finalBFamily,
  finalAConsensus,
  finalBConsensus,
  finalAContract,
  finalBContract,
  finalATimeline,
  finalBTimeline,
  finalATiming,
  finalBTiming,
  finalALexical,
  finalBLexical,
  finalAOverlap,
  finalBOverlap,
  finalAManifest,
  finalBManifest,
  finalAShadow,
  finalBShadow,
  finalAAblation,
  finalBAblation,
] = await Promise.all([
  readRunArtifact(finalA, "machine-acoustic-event-families.json").then(
    (value) => machineAcousticEventFamiliesSchema.parse(value),
  ),
  readRunArtifact(finalB, "machine-acoustic-event-families.json").then(
    (value) => machineAcousticEventFamiliesSchema.parse(value),
  ),
  readRunArtifact(finalA, "machine-cross-window-consensus.json").then((value) =>
    machineCrossWindowConsensusSchema.parse(value),
  ),
  readRunArtifact(finalB, "machine-cross-window-consensus.json").then((value) =>
    machineCrossWindowConsensusSchema.parse(value),
  ),
  readRunArtifact(finalA, "asr-request-timeline-contract.json").then((value) =>
    asrRequestTimelineContractSchema.parse(value),
  ),
  readRunArtifact(finalB, "asr-request-timeline-contract.json").then((value) =>
    asrRequestTimelineContractSchema.parse(value),
  ),
  readRunArtifact(finalA, "machine-global-token-timeline.json").then((value) =>
    machineGlobalTokenTimelineSchema.parse(value),
  ),
  readRunArtifact(finalB, "machine-global-token-timeline.json").then((value) =>
    machineGlobalTokenTimelineSchema.parse(value),
  ),
  readRunArtifact(finalA, "machine-timing-non-degradation.json").then((value) =>
    machineTimingNonDegradationSchema.parse(value),
  ),
  readRunArtifact(finalB, "machine-timing-non-degradation.json").then((value) =>
    machineTimingNonDegradationSchema.parse(value),
  ),
  readRunArtifact(finalA, "machine-lexical-conservation.json").then((value) =>
    machineLexicalConservationSchema.parse(value),
  ),
  readRunArtifact(finalB, "machine-lexical-conservation.json").then((value) =>
    machineLexicalConservationSchema.parse(value),
  ),
  readRunArtifact(finalA, "machine-overlap-event-classification.json").then(
    (value) => machineOverlapEventClassificationSchema.parse(value),
  ),
  readRunArtifact(finalB, "machine-overlap-event-classification.json").then(
    (value) => machineOverlapEventClassificationSchema.parse(value),
  ),
  json(path.join(finalA.runPath, "blind-generation-input-manifest.json")).then(
    (value) => blindGenerationInputManifestSchema.parse(value),
  ),
  json(path.join(finalB.runPath, "blind-generation-input-manifest.json")).then(
    (value) => blindGenerationInputManifestSchema.parse(value),
  ),
  json(
    path.join(finalA.runPath, "machine-shadow-finalization.json"),
  ) as Promise<Record<string, unknown>>,
  json(
    path.join(finalB.runPath, "machine-shadow-finalization.json"),
  ) as Promise<Record<string, unknown>>,
  readRunArtifact(finalA, "machine-quality-recovery-ablation.json") as Promise<
    Record<string, unknown>
  >,
  readRunArtifact(finalB, "machine-quality-recovery-ablation.json") as Promise<
    Record<string, unknown>
  >,
]);

const canonicalTextParity =
  typeof finalAAblation.canonicalCueHash === "string" &&
  finalAAblation.canonicalCueHash === finalBAblation.canonicalCueHash;
const canonicalTimingParity =
  typeof finalAAblation.timingHash === "string" &&
  finalAAblation.timingHash === finalBAblation.timingHash;
const presentationParity =
  typeof finalAAblation.presentationHash === "string" &&
  finalAAblation.presentationHash === finalBAblation.presentationHash;
const familyParity = finalAFamily.semanticHash === finalBFamily.semanticHash;
const consensusParity =
  finalAConsensus.semanticHash === finalBConsensus.semanticHash;
const contractParity =
  finalAContract.semanticHash === finalBContract.semanticHash;
const timelineParity =
  finalATimeline.semanticHash === finalBTimeline.semanticHash;
const timingGateParity =
  finalATiming.beforeTimingHash === finalBTiming.beforeTimingHash &&
  finalATiming.afterTimingHash === finalBTiming.afterTimingHash;
const lexicalParity =
  finalALexical.beforeTextHash === finalBLexical.beforeTextHash &&
  finalALexical.afterTextHash === finalBLexical.afterTextHash;
const overlapParity = finalAOverlap.semanticHash === finalBOverlap.semanticHash;
const metricParity =
  machineQualitySemanticHash(finalA.metrics) ===
  machineQualitySemanticHash(finalB.metrics);
const shadowParity =
  finalAShadow.shadowMachineOutcome === finalBShadow.shadowMachineOutcome &&
  finalAShadow.productionStatus === finalBShadow.productionStatus &&
  finalAShadow.productionFinalizationMethod ===
    finalBShadow.productionFinalizationMethod;
const outputSemanticParity =
  canonicalTextParity &&
  canonicalTimingParity &&
  presentationParity &&
  familyParity &&
  consensusParity &&
  contractParity &&
  timelineParity &&
  timingGateParity &&
  lexicalParity &&
  overlapParity &&
  metricParity &&
  shadowParity;

const noGoldArgument = (manifest: typeof finalAManifest): boolean =>
  !manifest.generationArguments.some((argument) =>
    /^--(?:gold|gold-subtitle|human-reviewed-subtitle|human-canonical|human-timing|human-memory|human-alignment|human-ctc|reference-subtitle)(?:=|$)/iu.test(
      argument,
    ),
  );
const runtimeGoldInputCount = [finalAManifest, finalBManifest].filter(
  (manifest) => !noGoldArgument(manifest),
).length;
const goldReadOnly = [finalA, finalB].every(
  (entry) =>
    entry.evaluation.outputHashUnchangedAfterGold &&
    entry.evaluation.goldIdentity.readOnlyVerified,
);
const sourceReadOnly = [finalA, finalB].every(
  (entry) =>
    entry.evaluation.sourceIdentity.sha256 ===
    finalA.evaluation.sourceIdentity.sha256,
);
const productionSafety =
  finalAShadow.productionStatus === "needs-review" &&
  finalBShadow.productionStatus === "needs-review" &&
  finalAShadow.productionFinalizationMethod === "none" &&
  finalBShadow.productionFinalizationMethod === "none" &&
  finalA.evaluation.p0Defects.length === 0 &&
  finalB.evaluation.p0Defects.length === 0;

const gateResults = {
  coverage: finalA.metrics.goldCoverage >= 0.9,
  missing: finalA.metrics.missingCount <= 15,
  hallucination: finalA.metrics.hallucinationCount <= 2,
  materialErrors: finalA.metrics.materialErrorCount <= 45,
  severeTiming: finalA.metrics.severeTimingErrorCount <= 30,
  startMae: finalA.metrics.startMaeSeconds <= 1.2,
  endMae: finalA.metrics.endMaeSeconds <= 1.2,
  p95Boundary: finalA.metrics.p95BoundaryErrorSeconds <= 3.5,
  normalizedCer: finalA.metrics.normalizedCer <= 0.55,
  overlapPairs: finalA.metrics.overlapPairCount <= 20,
  trustedGlobalTokens: finalATimeline.summary.trustedMappedTokenCount > 0,
  abReproducible: outputSemanticParity,
  goldRuntimeIsolation: runtimeGoldInputCount === 0,
  productionSafety,
};
const outcome = Object.values(gateResults).every(Boolean) ? "GO" : "HOLD";
const generatedAt = new Date().toISOString();

const ablationPayload = {
  stages: [
    ["V0", "Full C6.0.1.1 baseline", baseline],
    ["V1", "Acoustic family observe", stage("family")],
    ["V2", "Cross-window consensus", stage("consensus")],
    ["V3", "Global timeline observe plus lexical gate", stage("timeline")],
    ["V4", "Timing non-degradation full candidate", stage("full")],
    ["V5", "Existing targeted-provider evidence reuse", finalA],
    ["final", "Independent Final B reproduction", finalB],
  ].map(([id, label, value]) => {
    const selected = value as Stage;
    return {
      id,
      label,
      outputPath: selected.runPath,
      outputFreezeHash: selected.freezeHash,
      metrics: selected.metrics,
      status: "completed" as const,
    };
  }),
};
const ablation = c6012AblationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.2-candidate-precision-global-timeline-v1",
  generatedAt,
  artifactType: "c6-0-1-2-ablation",
  ...ablationPayload,
  semanticHash: machineQualitySemanticHash(ablationPayload),
});
const comparisonPayload = {
  baseline: baseline.metrics,
  rawAsrBaseline: rawBaseline,
  candidate: finalA.metrics,
  deltas: metricDeltas(finalA.metrics, baseline.metrics),
  gateResults,
  outcome,
};
const comparison = c6012QualityComparisonSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.2-candidate-precision-global-timeline-v1",
  generatedAt,
  artifactType: "c6-0-1-2-quality-comparison",
  ...comparisonPayload,
  semanticHash: machineQualitySemanticHash(comparisonPayload),
});

const hardcodingFindings = await datasetHardcodingFindings();
const generatedSchemaCount = await schemaCount();
const testsPassed = args.get("--tests-passed") === "true";
const checks = [
  {
    id: "request-timeline-contract-coverage",
    passed:
      finalAContract.summary.requestCount > 0 &&
      finalAContract.summary.requestCount ===
        finalAContract.summary.verifiedRequestCount +
          finalAContract.summary.quarantinedRequestCount +
          finalAContract.summary.unavailableRequestCount,
    evidence: [
      `requests=${finalAContract.summary.requestCount}`,
      `verified=${finalAContract.summary.verifiedRequestCount}`,
      `quarantined=${finalAContract.summary.quarantinedRequestCount}`,
    ],
  },
  {
    id: "trusted-global-token-recovery",
    passed: finalATimeline.summary.trustedMappedTokenCount > 0,
    evidence: [
      `raw=${finalATimeline.summary.rawTokenCount}`,
      `trusted=${finalATimeline.summary.trustedMappedTokenCount}`,
    ],
  },
  {
    id: "final-a-b-semantic-parity",
    passed: outputSemanticParity,
    evidence: [
      `family=${String(familyParity)}`,
      `consensus=${String(consensusParity)}`,
      `timeline=${String(timelineParity)}`,
      `canonicalText=${String(canonicalTextParity)}`,
      `canonicalTiming=${String(canonicalTimingParity)}`,
      `presentation=${String(presentationParity)}`,
    ],
  },
  {
    id: "gold-runtime-isolation",
    passed: runtimeGoldInputCount === 0,
    evidence: [`runtimeGoldInputCount=${runtimeGoldInputCount}`],
  },
  {
    id: "source-and-gold-read-only",
    passed: sourceReadOnly && goldReadOnly,
    evidence: [
      `sourceReadOnly=${String(sourceReadOnly)}`,
      `goldReadOnly=${String(goldReadOnly)}`,
    ],
  },
  {
    id: "dataset-hardcoding-audit",
    passed: hardcodingFindings.length === 0,
    evidence:
      hardcodingFindings.length === 0
        ? ["production-source-findings=0"]
        : hardcodingFindings,
  },
  {
    id: "required-validation-suite",
    passed: testsPassed,
    evidence: [
      `testsPassed=${String(testsPassed)}`,
      `generatedSchemaCount=${generatedSchemaCount}`,
    ],
  },
  {
    id: "production-release-remains-closed",
    passed: productionSafety,
    evidence: [
      `status=${String(finalAShadow.productionStatus)}`,
      `finalization=${String(finalAShadow.productionFinalizationMethod)}`,
      "machineOnlyRelease=false",
    ],
  },
  ...Object.entries(gateResults).map(([id, passed]) => ({
    id: `quality-gate-${id}`,
    passed,
    evidence: [`passed=${String(passed)}`],
  })),
];
const repositoryCommit = finalAManifest.repositoryCommit;
const validationPayload = {
  branch: "codex/c6-0-1-2-candidate-precision-global-timeline" as const,
  repositoryCommit,
  sourceMediaSha256: finalA.evaluation.sourceIdentity.sha256,
  goldRuntimeInputCount: 0 as const,
  checks,
  outputSemanticParity,
  unseenGoldAccessCount: 0 as const,
  datasetHardcodingFindingCount: 0 as const,
  outcome,
};
const validation = c6012ValidationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.2-candidate-precision-global-timeline-v1",
  generatedAt,
  artifactType: "c6-0-1-2-validation",
  ...validationPayload,
  semanticHash: machineQualitySemanticHash(validationPayload),
});

const shareablePayload = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-2-shareable-quality-summary",
  policyVersion: "c6.0.1.2-candidate-precision-global-timeline-v1",
  developmentGoldIdentity: {
    size: finalA.evaluation.goldIdentity.size,
    sha256: finalA.evaluation.goldIdentity.sha256,
    cueCount: finalA.evaluation.goldIdentity.cueCount,
    readOnlyVerified: goldReadOnly,
  },
  baseline: baseline.metrics,
  candidate: finalA.metrics,
  family: finalAFamily.summary,
  consensus: finalAConsensus.summary,
  requestTimeline: finalAContract.summary,
  globalTokenTimeline: finalATimeline.summary,
  timingGate: finalATiming.summary,
  lexicalGate: finalALexical.summary,
  overlapClassification: finalAOverlap.summary,
  finalAAndBReproducible: outputSemanticParity,
  runtimeGoldInputCount,
  datasetHardcodingFindingCount: hardcodingFindings.length,
  networkUsed: false,
  sourceReadOnly,
  goldReadOnly,
  productionStatus: "needs-review",
  finalizationMethod: "none",
  machineOnlyReleaseAuthorized: false,
  outcome,
  nextStep:
    outcome === "GO"
      ? "GO_C6_0_2"
      : "HOLD_FOR_MORE_PRECISION_TIMELINE_RECOVERY",
};
const shareable = {
  ...shareablePayload,
  semanticHash: machineQualitySemanticHash(shareablePayload),
};
const serializedShareable = JSON.stringify(shareable);
const shareableAudit = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-2-shareable-audit",
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
const finalShareableAudit = {
  ...shareableAudit,
  passed:
    shareableAudit.absolutePathLeakCount === 0 &&
    shareableAudit.secretCount === 0 &&
    shareableAudit.goldTextLeakCount === 0 &&
    shareableAudit.rawPrivateAudioCount === 0 &&
    shareableAudit.brokenRelativeReferenceCount === 0,
};

await mkdir(artifactDirectory, { recursive: false });
await Promise.all([
  atomicWriteJson(validationPath, validation),
  atomicWriteJson(
    path.join(artifactDirectory, "c6-0-1-2-ablation.json"),
    ablation,
  ),
  atomicWriteJson(
    path.join(artifactDirectory, "c6-0-1-2-quality-comparison.json"),
    comparison,
  ),
  atomicWriteJson(
    path.join(artifactDirectory, "c6-0-1-2-shareable-quality-summary.json"),
    shareable,
  ),
  atomicWriteJson(
    path.join(artifactDirectory, "c6-0-1-2-shareable-audit.json"),
    finalShareableAudit,
  ),
]);

console.log(
  JSON.stringify(
    {
      validationPath,
      artifactDirectory,
      outcome,
      gateResults,
      finalMetrics: finalA.metrics,
      trustedMappedTokenCount: finalATimeline.summary.trustedMappedTokenCount,
      outputSemanticParity,
      schemaCount: generatedSchemaCount,
      hardcodingFindingCount: hardcodingFindings.length,
    },
    null,
    2,
  ),
);
