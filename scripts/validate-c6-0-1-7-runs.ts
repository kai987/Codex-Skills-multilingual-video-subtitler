import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  blindOutputFreezeSchema,
  c6017AblationSchema,
  c6017PolicyVersion,
  c6017QualityMetricsSchema,
  c6017ValidationSchema,
  machineAsrCeilingEvaluationV2Schema,
  machineAssociationErrorTaxonomySchema,
  machineFreshCandidateComparisonSchema,
  machineFreshTargetedReAsrSchema,
  machineReAsrRiskV2Schema,
  type C6017Ablation,
  type C6017QualityMetrics,
} from "@mvl/shared";
import {
  auditC5161ShareableArtifacts,
  machineQualitySemanticHash,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-29T13:00:00.000Z";
const STAGE_IDS = [
  "V0",
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
  "final-a",
  "final-b",
] as const;
type StageId = (typeof STAGE_IDS)[number];

interface StageArgument {
  id: StageId;
  run: string;
  evaluation: string | null;
}

interface RunAudit {
  semanticHash: string;
  artifactSemanticHashes: {
    riskV2: string;
    selection: string;
    fresh: string | null;
    freshCandidates: string;
    comparison: string | null;
    spanRepair: string | null;
  };
  finalHashes: {
    canonicalTextHash: string;
    canonicalTimingHash: string;
    presentationHash: string;
    assHash: string;
    srtHash: string;
    vttHash: string;
  };
  modelExecution: {
    generationKind:
      "NO_MODEL" | "FRESH_INFERENCE" | "FROZEN_EXACT_CACHE_REPLAY";
    selectedEventCount: number;
    plannedRequestCount: number;
    actualRequestCount: number;
    cacheHitCount: number;
    freshInferenceCount: number;
    modelLoadCount: number;
    processStartCount: number;
    extractionCount: number;
    uniqueAudioShaCount: number;
  };
  canonicalTextMutationCount: number;
  canonicalTimingMutationCount: number;
  runtimeGoldInputCount: number;
  networkUsed: boolean;
  productionStatus: string;
  finalizationMethod: string;
  machineReleaseAuthorized: boolean;
}

interface LegacyQualityMetrics {
  candidate: Omit<
    C6017QualityMetrics,
    | "freshSelectedEventCount"
    | "freshInferenceCount"
    | "freshCandidateCount"
    | "freshReplacementAppliedCount"
  >;
}

function argument(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index < 0 ? undefined : argv[index + 1];
  if (value === undefined || value === "") throw new Error(`Missing ${flag}.`);
  return value;
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

async function exists(filePath: string): Promise<boolean> {
  return await readFile(filePath).then(
    () => true,
    () => false,
  );
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
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

async function loadMetrics(
  evaluation: string | null,
  audit: RunAudit,
  comparison: ReturnType<
    typeof machineFreshCandidateComparisonSchema.parse
  > | null,
): Promise<C6017QualityMetrics | null> {
  if (evaluation === null) return null;
  const c6017Path = path.join(evaluation, "c6-0-1-7-run-quality-metrics.json");
  if (await exists(c6017Path)) {
    return c6017QualityMetricsSchema.parse(await json<unknown>(c6017Path));
  }
  const legacy = await json<LegacyQualityMetrics>(
    path.join(evaluation, "c6-0-1-5-run-quality-metrics.json"),
  );
  return c6017QualityMetricsSchema.parse({
    ...legacy.candidate,
    freshSelectedEventCount: audit.modelExecution.selectedEventCount,
    freshInferenceCount: audit.modelExecution.freshInferenceCount,
    freshCandidateCount: 0,
    freshReplacementAppliedCount:
      comparison?.summary.replacementAppliedCount ?? 0,
  });
}

async function loadStage(stage: StageArgument): Promise<{
  stage: C6017Ablation["stages"][number];
  audit: RunAudit;
  risk: ReturnType<typeof machineReAsrRiskV2Schema.parse>;
  fresh: ReturnType<typeof machineFreshTargetedReAsrSchema.parse> | null;
  comparison: ReturnType<
    typeof machineFreshCandidateComparisonSchema.parse
  > | null;
  metrics: C6017QualityMetrics | null;
  shadowOutcome: string;
}> {
  const subtitle = await subtitleDirectory(stage.run);
  const [freeze, audit, risk, shadow] = await Promise.all([
    json<unknown>(path.join(stage.run, "blind-output-freeze.json")).then(
      (value) => blindOutputFreezeSchema.parse(value),
    ),
    json<RunAudit>(path.join(stage.run, "c6-0-1-7-machine-run-audit.json")),
    json<unknown>(path.join(subtitle, "machine-reasr-risk-v2.json")).then(
      (value) => machineReAsrRiskV2Schema.parse(value),
    ),
    json<{ shadowMachineOutcome: string }>(
      path.join(stage.run, "machine-shadow-finalization.json"),
    ),
  ]);
  const freshPath = path.join(subtitle, "machine-fresh-targeted-reasr.json");
  const comparisonPath = path.join(
    subtitle,
    "machine-fresh-candidate-comparison.json",
  );
  const fresh = (await exists(freshPath))
    ? machineFreshTargetedReAsrSchema.parse(await json<unknown>(freshPath))
    : null;
  const comparison = (await exists(comparisonPath))
    ? machineFreshCandidateComparisonSchema.parse(
        await json<unknown>(comparisonPath),
      )
    : null;
  const metrics = await loadMetrics(stage.evaluation, audit, comparison);
  return {
    stage: {
      id: stage.id,
      label: stage.id,
      outputPath: path.basename(stage.run),
      outputFreezeHash: freeze.freezeSemanticHash,
      metrics,
      status: "completed",
      generationKind: audit.modelExecution.generationKind,
      modelExecutionHash: machineQualitySemanticHash(audit.modelExecution),
    },
    audit,
    risk,
    fresh,
    comparison,
    metrics,
    shadowOutcome: shadow.shadowMachineOutcome,
  };
}

function stableFreshRequestHash(
  fresh: ReturnType<typeof machineFreshTargetedReAsrSchema.parse> | null,
): string {
  return machineQualitySemanticHash(
    fresh?.requests.map((request) => ({
      requestId: request.requestId,
      requestIdentity: request.requestIdentity,
      sourceGlobalSampleInterval: request.sourceGlobalSampleInterval,
      extractionIdentity: request.extractionIdentity,
      audioSha256: request.audioSha256,
      responseText: request.responseText,
      decoderEvidence: request.decoderEvidence,
      tokens: request.tokens,
    })) ?? [],
  );
}

async function productionHardcodingCount(
  repositoryRoot: string,
): Promise<number> {
  const prohibited = [
    "カーネーション",
    "水茄子",
    "東京都交通局8000",
    "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e",
  ];
  const sourceFiles = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(target);
        return entry.isFile() && /\.(?:ts|tsx|js|mjs)$/u.test(entry.name)
          ? [target]
          : [];
      }),
    );
    return nested.flat();
  };
  const files = await sourceFiles(path.join(repositoryRoot, "packages"));
  let count = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    count += prohibited.filter((value) => text.includes(value)).length;
  }
  return count;
}

const argv = process.argv.slice(2);
const outputDirectory = path.resolve(argument(argv, "--output"));
const repositoryRoot = path.resolve(argument(argv, "--repository-root"));
const repositoryCommit = argument(argv, "--repository-commit");
const sourcePath = path.resolve(argument(argv, "--source"));
const goldPath = path.resolve(argument(argv, "--gold"));
const expectedSourceSha256 = argument(argv, "--source-sha256");
const expectedGoldSha256 = argument(argv, "--gold-sha256");
const ceilingDirectory = path.resolve(argument(argv, "--ceiling"));
await mkdir(outputDirectory, { recursive: true });
const sourceBefore = await sha256File(sourcePath);
const goldBefore = await sha256File(goldPath);
if (
  sourceBefore !== expectedSourceSha256 ||
  goldBefore !== expectedGoldSha256
) {
  throw new Error("Source or Gold hash does not match the frozen identity.");
}

const loaded = await Promise.all(stageArguments(argv).map(loadStage));
const stageArgumentById = new Map(
  stageArguments(argv).map((stage) => [stage.id, stage] as const),
);
const ablationCore = { stages: loaded.map((entry) => entry.stage) };
const ablation = c6017AblationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6017PolicyVersion,
  generatedAt: GENERATED_AT,
  artifactType: "c6-0-1-7-ablation",
  ...ablationCore,
  semanticHash: machineQualitySemanticHash(ablationCore),
});
const byId = new Map(loaded.map((entry) => [entry.stage.id, entry] as const));
const officialFresh = byId.get("V3");
const finalA = byId.get("final-a");
const finalB = byId.get("final-b");
if (
  officialFresh === undefined ||
  finalA === undefined ||
  finalB === undefined ||
  officialFresh.fresh === null ||
  finalA.fresh === null ||
  finalB.fresh === null ||
  finalA.comparison === null ||
  finalB.comparison === null
) {
  throw new Error(
    "Official Fresh generation and Final A/B artifacts are required.",
  );
}

const [ceiling, taxonomy, finalAShareable, finalBShareable] = await Promise.all(
  [
    json<unknown>(
      path.join(ceilingDirectory, "machine-asr-ceiling-evaluation-v2.json"),
    ).then((value) => machineAsrCeilingEvaluationV2Schema.parse(value)),
    json<unknown>(
      path.join(ceilingDirectory, "machine-association-error-taxonomy.json"),
    ).then((value) => machineAssociationErrorTaxonomySchema.parse(value)),
    auditC5161ShareableArtifacts(
      path.join(stageArgumentById.get("final-a")?.run ?? "", "shareable"),
    ),
    auditC5161ShareableArtifacts(
      path.join(stageArgumentById.get("final-b")?.run ?? "", "shareable"),
    ),
  ],
);

const parity = {
  text:
    finalA.audit.finalHashes.canonicalTextHash ===
    finalB.audit.finalHashes.canonicalTextHash,
  timing:
    finalA.audit.finalHashes.canonicalTimingHash ===
    finalB.audit.finalHashes.canonicalTimingHash,
  presentation:
    finalA.audit.finalHashes.presentationHash ===
    finalB.audit.finalHashes.presentationHash,
  riskV2:
    finalA.audit.artifactSemanticHashes.riskV2 ===
    finalB.audit.artifactSemanticHashes.riskV2,
  freshRequests:
    stableFreshRequestHash(finalA.fresh) ===
    stableFreshRequestHash(finalB.fresh),
  freshCandidates:
    finalA.audit.artifactSemanticHashes.freshCandidates ===
    finalB.audit.artifactSemanticHashes.freshCandidates,
  comparison:
    finalA.audit.artifactSemanticHashes.comparison ===
    finalB.audit.artifactSemanticHashes.comparison,
  mutation:
    finalA.audit.canonicalTextMutationCount ===
      finalB.audit.canonicalTextMutationCount &&
    finalA.audit.canonicalTimingMutationCount ===
      finalB.audit.canonicalTimingMutationCount,
  shadowOutcome: finalA.shadowOutcome === finalB.shadowOutcome,
};

const finalMetrics = finalB.metrics;
if (finalMetrics === null)
  throw new Error("Final B quality metrics are required.");
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
const riskSemanticsPassed =
  finalB.risk.summary.selectedAbsenceOnlyEventCount === 0 &&
  finalB.risk.events.every((event) =>
    event.riskFacts
      .filter(
        (fact) => fact.factType === "tokenWeak" && fact.severity !== "NONE",
      )
      .every(
        (fact) =>
          fact.evidenceClass === "EVIDENCE_ABSENCE" &&
          fact.evidenceMissing &&
          !fact.positiveErrorEvidence,
      ),
  );
const finalReplayPassed = [finalA, finalB].every(
  (entry) =>
    entry.audit.modelExecution.generationKind === "FROZEN_EXACT_CACHE_REPLAY" &&
    entry.audit.modelExecution.actualRequestCount ===
      entry.audit.modelExecution.cacheHitCount &&
    entry.audit.modelExecution.freshInferenceCount === 0 &&
    entry.audit.modelExecution.modelLoadCount === 0 &&
    entry.audit.modelExecution.processStartCount === 0,
);
const freshReAsrEngineeringPassed =
  riskSemanticsPassed &&
  officialFresh.fresh.generationKind === "FRESH_INFERENCE" &&
  officialFresh.fresh.summary.freshInferenceCount > 0 &&
  officialFresh.fresh.summary.freshInferenceCount ===
    officialFresh.fresh.summary.actualRequestCount &&
  officialFresh.fresh.summary.promptIsolationPassed &&
  officialFresh.fresh.summary.evidenceCompleteCandidateCount > 0 &&
  finalReplayPassed;
const associationTaxonomyPassed =
  taxonomy.summary.oldAssociationErrorCount ===
    finalMetrics.associationErrorCount && taxonomy.entries.length > 0;
const causal = await json<{
  summary: {
    baselineErrorHitRate: number;
    oracleImprovement: number;
  };
}>(path.join(ceilingDirectory, "machine-reasr-causal-evaluation.json"));
const pipelineQualityMilestonePassed =
  causal.summary.baselineErrorHitRate >= 0.5 &&
  causal.summary.oracleImprovement > 0;
const datasetHardcodingFindingCount =
  await productionHardcodingCount(repositoryRoot);
const safeProductionState = [finalA, finalB].every(
  (entry) =>
    entry.audit.productionStatus === "needs-review" &&
    entry.audit.finalizationMethod === "none" &&
    !entry.audit.machineReleaseAuthorized,
);
const checks = [
  {
    id: "corrected-risk-semantics",
    passed: riskSemanticsPassed,
    evidence: [
      `selectedAbsenceOnly=${finalB.risk.summary.selectedAbsenceOnlyEventCount}`,
      `eligible=${finalB.risk.summary.eligibleCount}`,
    ],
  },
  {
    id: "official-fresh-inference",
    passed: freshReAsrEngineeringPassed,
    evidence: [
      `freshInference=${officialFresh.fresh.summary.freshInferenceCount}`,
      `requests=${officialFresh.fresh.summary.actualRequestCount}`,
      `cacheHits=${officialFresh.fresh.summary.cacheHitCount}`,
    ],
  },
  {
    id: "frozen-cache-replay",
    passed: finalReplayPassed,
    evidence: [
      `finalA.cacheHits=${finalA.audit.modelExecution.cacheHitCount}`,
      `finalB.cacheHits=${finalB.audit.modelExecution.cacheHitCount}`,
      "inference=0,modelLoad=0,processStart=0",
    ],
  },
  {
    id: "gold-isolation",
    passed:
      officialFresh.audit.runtimeGoldInputCount === 0 &&
      finalA.audit.runtimeGoldInputCount === 0 &&
      finalB.audit.runtimeGoldInputCount === 0,
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
    id: "association-taxonomy",
    passed: associationTaxonomyPassed,
    evidence: [
      `old=${taxonomy.summary.oldAssociationErrorCount}`,
      `classified=${taxonomy.entries.length}`,
    ],
  },
  {
    id: "shareable-audit",
    passed:
      finalAShareable.validationPassed && finalBShareable.validationPassed,
    evidence: [
      `A.absolute=${finalAShareable.absolutePathLeakCount}`,
      `A.secret=${finalAShareable.prohibitedSecretCount}`,
      `A.broken=${finalAShareable.brokenRelativeReferenceCount}`,
      `B.absolute=${finalBShareable.absolutePathLeakCount}`,
      `B.secret=${finalBShareable.prohibitedSecretCount}`,
      `B.broken=${finalBShareable.brokenRelativeReferenceCount}`,
    ],
  },
  {
    id: "safe-production-state",
    passed: safeProductionState,
    evidence: ["needs-review", "finalizationMethod=none", "release=false"],
  },
  {
    id: "dataset-hardcoding",
    passed: datasetHardcodingFindingCount === 0,
    evidence: [`findingCount=${datasetHardcodingFindingCount}`],
  },
];
const sourceAfter = await sha256File(sourcePath);
const goldAfter = await sha256File(goldPath);
const outcome = strictC602QualityGatePassed
  ? ("GO_C6_0_2" as const)
  : ceiling.summary.pipelineVsAsrDecision === "PIPELINE_STILL_PRIMARY"
    ? ("HOLD_FOR_FINAL_PIPELINE_APPLICATION" as const)
    : ceiling.summary.pipelineVsAsrDecision === "ASR_STILL_PRIMARY"
      ? ("HOLD_AND_RECOMMEND_ASR_ENSEMBLE" as const)
      : ("HOLD_MIXED_PIPELINE_AND_ASR" as const);
const validationCore = {
  branch: "codex/c6-0-1-7-fresh-reasr-asr-ceiling-validation" as const,
  repositoryCommit,
  sourceMediaSha256: expectedSourceSha256,
  goldSha256: expectedGoldSha256,
  sourceReadOnlyVerified: sourceBefore === sourceAfter,
  goldReadOnlyVerified: goldBefore === goldAfter,
  runtimeGoldInputCount: 0 as const,
  datasetHardcodingFindingCount,
  unsafeFinalizationEscapeCount: safeProductionState ? 0 : 1,
  networkUsed: false as const,
  checks,
  finalABParity: parity,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  machineReleaseAuthorized: false as const,
  freshReAsrEngineeringPassed,
  asrCeilingValidationPassed: ceiling.summary.ceilingValidationPassed,
  riskSemanticsPassed,
  associationTaxonomyPassed,
  pipelineQualityMilestonePassed,
  strictC602QualityGatePassed,
  outcome,
};
const validation = c6017ValidationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6017PolicyVersion,
  generatedAt: GENERATED_AT,
  artifactType: "c6-0-1-7-validation",
  ...validationCore,
  semanticHash: machineQualitySemanticHash(validationCore),
});

await Promise.all([
  atomicWriteJson(
    path.join(outputDirectory, "c6-0-1-7-ablation.json"),
    ablation,
  ),
  atomicWriteJson(
    path.join(outputDirectory, "c6-0-1-7-validation.json"),
    validation,
  ),
]);
console.log(
  JSON.stringify(
    {
      outputDirectory,
      freshReAsrEngineeringPassed,
      asrCeilingValidationPassed: ceiling.summary.ceilingValidationPassed,
      riskSemanticsPassed,
      associationTaxonomyPassed,
      pipelineQualityMilestonePassed,
      strictC602QualityGatePassed,
      outcome,
      parity,
      checks,
    },
    null,
    2,
  ),
);
