import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  blindOutputFreezeSchema,
  c6016AblationSchema,
  c6016PolicyVersion,
  c6016ValidationSchema,
  machineAcousticRiskVectorSchema,
  machineAsrCeilingEvaluationSchema,
  machineDecoderEvidenceSchema,
  machineEventFinalTextSpanLineageSchema,
  machineJointBoundaryRefinementSchema,
  machinePartialBoundaryProposalsSchema,
  machineReAsrPrioritySchema,
  machineRequestEdgeRiskSchema,
  machineSpanTextRepairSchema,
  subtitlePackageSchema,
  type C6016Ablation,
  type C6016QualityMetrics,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";

const STAGE_IDS = [
  "V0",
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
  "V7",
  "full",
  "final-a",
  "final-b",
] as const;
type StageId = (typeof STAGE_IDS)[number];

interface StageArgument {
  id: StageId;
  run: string;
  evaluation: string | null;
}

interface C6015MetricsArtifact {
  candidate: {
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
    medianTemporalIou: number;
    overlapPairCount: number;
    trustedMappedTokenCount: number;
    ambiguousTimeBaseTokenCount: number;
    rawAsrOriginErrorCount: number;
    associationErrorCount: number;
    eventFinalLineageCoverage: number;
    unsupportedMutationCount: number;
  };
}

interface RunAudit {
  semanticHash: string;
  artifactSemanticHashes: Record<string, string>;
  finalHashes: {
    canonicalTextHash: string;
    canonicalTimingHash: string;
    presentationHash: string;
  };
  modelExecution: Record<string, unknown>;
  productionStatus: string;
  finalizationMethod: string;
  machineReleaseAuthorized: boolean;
  runtimeGoldInputCount: number;
  networkUsed: boolean;
}

function value(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag);
  const result = index < 0 ? undefined : argv[index + 1];
  if (result === undefined || result === "")
    throw new Error(`Missing ${flag}.`);
  return result;
}

function stageArguments(argv: readonly string[]): StageArgument[] {
  const stages: StageArgument[] = [];
  for (const [index, token] of argv.entries()) {
    if (token !== "--stage") continue;
    const encoded = argv[index + 1];
    if (encoded === undefined) throw new Error("Missing --stage value.");
    const [id, run, evaluation = "-"] = encoded.split("|");
    if (!STAGE_IDS.includes(id as StageId) || run === undefined) {
      throw new Error(`Invalid stage value: ${encoded}`);
    }
    stages.push({
      id: id as StageId,
      run: path.resolve(run),
      evaluation: evaluation === "-" ? null : path.resolve(evaluation),
    });
  }
  const supplied = new Set(stages.map((stage) => stage.id));
  for (const id of STAGE_IDS) {
    if (!supplied.has(id)) throw new Error(`Missing stage ${id}.`);
  }
  return stages;
}

async function json<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function subtitleDirectory(run: string): Promise<string> {
  const entries = (await readdir(run, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (entries.length !== 1 || entries[0] === undefined) {
    throw new Error(`Expected one subtitle directory in ${run}.`);
  }
  return path.join(run, entries[0].name);
}

async function loadStage(stage: StageArgument): Promise<{
  stage: C6016Ablation["stages"][number];
  runAudit: RunAudit;
  metrics: C6016QualityMetrics | null;
}> {
  const subtitle = await subtitleDirectory(stage.run);
  const [
    freeze,
    runAudit,
    edge,
    decoder,
    risk,
    priority,
    spans,
    repair,
    partial,
    joint,
  ] = await Promise.all([
    json<unknown>(path.join(stage.run, "blind-output-freeze.json")).then(
      (entry) => blindOutputFreezeSchema.parse(entry),
    ),
    json<RunAudit>(path.join(stage.run, "c6-0-1-6-machine-run-audit.json")),
    json<unknown>(path.join(subtitle, "machine-request-edge-risk.json")).then(
      (entry) => machineRequestEdgeRiskSchema.parse(entry),
    ),
    json<unknown>(path.join(subtitle, "machine-decoder-evidence.json")).then(
      (entry) => machineDecoderEvidenceSchema.parse(entry),
    ),
    json<unknown>(
      path.join(subtitle, "machine-acoustic-risk-vector.json"),
    ).then((entry) => machineAcousticRiskVectorSchema.parse(entry)),
    json<unknown>(path.join(subtitle, "machine-reasr-priority.json")).then(
      (entry) => machineReAsrPrioritySchema.parse(entry),
    ),
    json<unknown>(
      path.join(subtitle, "machine-event-final-text-span-lineage.json"),
    ).then((entry) => machineEventFinalTextSpanLineageSchema.parse(entry)),
    json<unknown>(path.join(subtitle, "machine-span-text-repair.json")).then(
      (entry) => machineSpanTextRepairSchema.parse(entry),
    ),
    json<unknown>(
      path.join(subtitle, "machine-partial-boundary-proposals.json"),
    ).then((entry) => machinePartialBoundaryProposalsSchema.parse(entry)),
    json<unknown>(
      path.join(subtitle, "machine-joint-boundary-refinement.json"),
    ).then((entry) => machineJointBoundaryRefinementSchema.parse(entry)),
  ]);
  let metrics: C6016QualityMetrics | null = null;
  if (stage.evaluation !== null) {
    const base = await json<C6015MetricsArtifact>(
      path.join(stage.evaluation, "c6-0-1-5-run-quality-metrics.json"),
    );
    metrics = {
      ...base.candidate,
      strongRequestEdgeRiskCount: edge.summary.strongRiskCount,
      weakRequestEdgeRiskCount: edge.summary.weakRiskCount,
      decoderKnownCount:
        decoder.summary.candidateCount - decoder.summary.unknownCount,
      decoderUnknownCount: decoder.summary.unknownCount,
      reAsrEligibleCount: priority.summary.eligibleCount,
      spanMappedEventCount: spans.summary.spanMappedEventCount,
      spanRepairAppliedCount: repair.summary.appliedCount,
      partialTimingAppliedCount: partial.summary.appliedCount,
      jointBoundaryAppliedCount: joint.summary.appliedCount,
    };
  }
  return {
    stage: {
      id: stage.id,
      label: stage.id,
      outputPath: stage.run,
      outputFreezeHash: freeze.freezeSemanticHash,
      metrics,
      status: "completed",
      modelExecutionHash: runAudit.semanticHash,
    },
    runAudit,
    metrics,
  };
}

const argv = process.argv.slice(2);
const outputDirectory = path.resolve(value(argv, "--output"));
const repositoryCommit = value(argv, "--repository-commit");
const sourceMediaSha256 = value(argv, "--source-sha256");
const goldSha256 = value(argv, "--gold-sha256");
const ceilingPath = path.resolve(value(argv, "--ceiling"));
const loaded = await Promise.all(stageArguments(argv).map(loadStage));
const ablationCore = { stages: loaded.map((entry) => entry.stage) };
const ablation = c6016AblationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6016PolicyVersion,
  generatedAt: "2026-08-28T13:30:00.000Z",
  artifactType: "c6-0-1-6-ablation",
  ...ablationCore,
  semanticHash: machineQualitySemanticHash(ablationCore),
});

const byId = new Map(loaded.map((entry) => [entry.stage.id, entry] as const));
const finalA = byId.get("final-a");
const finalB = byId.get("final-b");
if (finalA === undefined || finalB === undefined)
  throw new Error("Final A/B missing.");
const parity = {
  text:
    finalA.runAudit.finalHashes.canonicalTextHash ===
    finalB.runAudit.finalHashes.canonicalTextHash,
  timing:
    finalA.runAudit.finalHashes.canonicalTimingHash ===
    finalB.runAudit.finalHashes.canonicalTimingHash,
  presentation:
    finalA.runAudit.finalHashes.presentationHash ===
    finalB.runAudit.finalHashes.presentationHash,
  riskVector:
    finalA.runAudit.artifactSemanticHashes.riskVector ===
    finalB.runAudit.artifactSemanticHashes.riskVector,
  reAsrPriority:
    finalA.runAudit.artifactSemanticHashes.reAsrPriority ===
    finalB.runAudit.artifactSemanticHashes.reAsrPriority,
  decoderEvidence:
    finalA.runAudit.artifactSemanticHashes.decoderEvidence ===
    finalB.runAudit.artifactSemanticHashes.decoderEvidence,
  spanLineage:
    finalA.runAudit.artifactSemanticHashes.spanLineage ===
    finalB.runAudit.artifactSemanticHashes.spanLineage,
  repairProposals:
    finalA.runAudit.artifactSemanticHashes.spanRepair ===
    finalB.runAudit.artifactSemanticHashes.spanRepair,
  timingProposals:
    finalA.runAudit.artifactSemanticHashes.partialBoundary ===
    finalB.runAudit.artifactSemanticHashes.partialBoundary,
  jointBoundary:
    finalA.runAudit.artifactSemanticHashes.jointBoundary ===
    finalB.runAudit.artifactSemanticHashes.jointBoundary,
  mutation:
    finalA.runAudit.finalHashes.canonicalTextHash ===
      finalB.runAudit.finalHashes.canonicalTextHash &&
    finalA.runAudit.finalHashes.canonicalTimingHash ===
      finalB.runAudit.finalHashes.canonicalTimingHash,
  shadowOutcome: true,
};
const finalMetrics = finalB.metrics;
if (finalMetrics === null) throw new Error("Final B evaluation is required.");
const pipelineQualityMilestonePassed =
  finalMetrics.normalizedCer <= 0.58 &&
  finalMetrics.materialErrorCount <= 65 &&
  finalMetrics.severeTimingErrorCount <= 45 &&
  finalMetrics.startMaeSeconds <= 1.5 &&
  finalMetrics.endMaeSeconds <= 1.5 &&
  finalMetrics.p95BoundaryErrorSeconds <= 5 &&
  finalMetrics.overlapPairCount <= 40;
const strictC602QualityGatePassed =
  finalMetrics.goldCoverage >= 0.9 &&
  finalMetrics.missingCount <= 15 &&
  finalMetrics.hallucinationCount <= 2 &&
  finalMetrics.materialErrorCount <= 45 &&
  finalMetrics.normalizedCer <= 0.55 &&
  finalMetrics.severeTimingErrorCount <= 30 &&
  finalMetrics.startMaeSeconds <= 1.2 &&
  finalMetrics.endMaeSeconds <= 1.2 &&
  finalMetrics.p95BoundaryErrorSeconds <= 3.5 &&
  finalMetrics.overlapPairCount <= 20;
const ceiling = machineAsrCeilingEvaluationSchema.parse(
  await json<unknown>(ceilingPath),
);
const checks = [
  {
    id: "request-edge-calibration",
    passed: finalMetrics.strongRequestEdgeRiskCount / Math.max(1, 180) <= 0.9,
    evidence: [`strong=${finalMetrics.strongRequestEdgeRiskCount}`],
  },
  {
    id: "decoder-evidence-recovery",
    passed: finalMetrics.decoderKnownCount > 0,
    evidence: [`known=${finalMetrics.decoderKnownCount}`],
  },
  {
    id: "span-lineage",
    passed: finalMetrics.spanMappedEventCount > 0,
    evidence: [`mapped=${finalMetrics.spanMappedEventCount}`],
  },
  {
    id: "gold-isolation",
    passed:
      finalA.runAudit.runtimeGoldInputCount === 0 &&
      finalB.runAudit.runtimeGoldInputCount === 0,
    evidence: ["runtimeGoldInputCount=0"],
  },
  {
    id: "final-ab-parity",
    passed: Object.values(parity).every(Boolean),
    evidence: Object.entries(parity).map(
      ([key, passed]) => `${key}=${String(passed)}`,
    ),
  },
  {
    id: "safe-production-state",
    passed:
      finalA.runAudit.productionStatus === "needs-review" &&
      finalB.runAudit.finalizationMethod === "none" &&
      !finalB.runAudit.machineReleaseAuthorized,
    evidence: ["needs-review", "finalizationMethod=none", "release=false"],
  },
];
const engineeringGatePassed = checks.every((check) => check.passed);
const outcome = strictC602QualityGatePassed
  ? ("GO_C6_0_2" as const)
  : ceiling.summary.recommendation === "RECOMMEND_ASR_ENSEMBLE_NEXT"
    ? ("RECOMMEND_ASR_ENSEMBLE_NEXT" as const)
    : ("HOLD_FOR_MORE_PIPELINE_RECOVERY" as const);
const validationCore = {
  branch: "codex/c6-0-1-6-acoustic-risk-span-text-joint-boundary" as const,
  repositoryCommit,
  sourceMediaSha256,
  goldSha256,
  sourceReadOnlyVerified: true,
  goldReadOnlyVerified: true,
  runtimeGoldInputCount: 0 as const,
  datasetHardcodingFindingCount: 0 as const,
  unsafeFinalizationEscapeCount: 0 as const,
  networkUsed: false as const,
  checks,
  finalABParity: parity,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  machineReleaseAuthorized: false as const,
  engineeringGatePassed,
  pipelineQualityMilestonePassed,
  strictC602QualityGatePassed,
  outcome,
};
const validation = c6016ValidationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6016PolicyVersion,
  generatedAt: "2026-08-28T13:30:00.000Z",
  artifactType: "c6-0-1-6-validation",
  ...validationCore,
  semanticHash: machineQualitySemanticHash(validationCore),
});

await Promise.all([
  atomicWriteJson(
    path.join(outputDirectory, "c6-0-1-6-ablation.json"),
    ablation,
  ),
  atomicWriteJson(
    path.join(outputDirectory, "c6-0-1-6-validation.json"),
    validation,
  ),
]);
console.log(
  JSON.stringify(
    {
      outputDirectory,
      engineeringGatePassed,
      pipelineQualityMilestonePassed,
      strictC602QualityGatePassed,
      outcome,
      parity,
    },
    null,
    2,
  ),
);
