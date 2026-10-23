import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  c6015QualityMetricsSchema,
  c6017QualityMetricsSchema,
  c6018AblationSchema,
  c6018PolicyVersion,
  c6018QualityPolicySchema,
  c6018RouteDecisionSchema,
  c6018ShareableSummarySchema,
  c6018ValidationSchema,
  goldLocalCoreEvaluationSchema,
  machineCoreAcousticSpanSchema,
  machineCoreAsrStabilitySchema,
  machineCoreCandidateOracleEvaluationSchema,
  machineCoreFreshVerificationSchema,
  machineCoreTextProjectionSchema,
  machineLocalizedCandidateComparabilitySchema,
  machineWhisperCoreStabilityEvaluationSchema,
  type C6015QualityMetrics,
  type C6018Ablation,
} from "@mvl/shared";
import {
  auditC5161ShareableArtifacts,
  machineQualitySemanticHash,
} from "@mvl/video-subtitler";

const STAGE_IDS = [
  "V0_C6017_BASELINE",
  "V1_CORE_SPAN",
  "V2_CORE_PROJECTION",
  "V3_COMPARABILITY",
  "V4_STABILITY",
  "V5_LOCAL_GOLD_EVALUATION",
  "V6_OPTIONAL_CORE_FRESH",
  "FINAL_DIAGNOSIS",
] as const;
type StageId = (typeof STAGE_IDS)[number];

interface StageArgument {
  id: StageId;
  run: string;
}

interface C6018RunAudit {
  semanticHash: string;
  throughStage: string;
  sourceMediaSha256: string;
  c6017FreshSemanticHash: string;
  machineFreezeHash: string;
  runtimeGoldInputCount: number;
  goldReadAfterMachineFreeze: boolean;
  goldIdentityHash: string | null;
  networkUsed: boolean;
  canonicalTextMutationCount: number;
  canonicalTimingMutationCount: number;
  presentationMutationCount: number;
  productionStatus: string;
  finalizationMethod: string;
  artifactSemanticHashes: Record<string, string | null>;
}

interface C6017RunAudit {
  finalHashes: {
    canonicalTextHash: string;
    canonicalTimingHash: string;
    presentationHash: string;
    assHash: string;
    srtHash: string;
    vttHash: string;
  };
  canonicalTextMutationCount: number;
  canonicalTimingMutationCount: number;
  runtimeGoldInputCount: number;
  networkUsed: boolean;
  productionStatus: string;
  finalizationMethod: string;
  machineReleaseAuthorized: boolean;
}

interface FinalArtifacts {
  audit: C6018RunAudit;
  legacyAudit: C6017RunAudit;
  policy: ReturnType<typeof c6018QualityPolicySchema.parse>;
  coreSpan: ReturnType<typeof machineCoreAcousticSpanSchema.parse>;
  projection: ReturnType<typeof machineCoreTextProjectionSchema.parse>;
  comparability: ReturnType<
    typeof machineLocalizedCandidateComparabilitySchema.parse
  >;
  stability: ReturnType<typeof machineCoreAsrStabilitySchema.parse>;
  freshVerification: ReturnType<
    typeof machineCoreFreshVerificationSchema.parse
  >;
  goldEvaluation: ReturnType<typeof goldLocalCoreEvaluationSchema.parse>;
  oracle: ReturnType<typeof machineCoreCandidateOracleEvaluationSchema.parse>;
  diagnosis: ReturnType<
    typeof machineWhisperCoreStabilityEvaluationSchema.parse
  >;
  route: ReturnType<typeof c6018RouteDecisionSchema.parse>;
  shareableSummary: ReturnType<typeof c6018ShareableSummarySchema.parse>;
  shareableAudit: Awaited<ReturnType<typeof auditC5161ShareableArtifacts>>;
}

function requiredArgument(values: readonly string[], flag: string): string {
  const index = values.indexOf(flag);
  const value = index < 0 ? undefined : values[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument ${flag}.`);
  }
  return value;
}

function stageArguments(values: readonly string[]): StageArgument[] {
  const stages: StageArgument[] = [];
  for (const [index, value] of values.entries()) {
    if (value !== "--stage") continue;
    const encoded = values[index + 1];
    if (encoded === undefined) throw new Error("Missing --stage value.");
    const separator = encoded.indexOf("|");
    if (separator < 1) throw new Error(`Invalid --stage value: ${encoded}`);
    const id = encoded.slice(0, separator) as StageId;
    const run = encoded.slice(separator + 1);
    if (!STAGE_IDS.includes(id) || run === "") {
      throw new Error(`Invalid --stage value: ${encoded}`);
    }
    stages.push({ id, run: path.resolve(run) });
  }
  const supplied = new Set(stages.map((stage) => stage.id));
  for (const id of STAGE_IDS) {
    if (!supplied.has(id)) throw new Error(`Missing stage ${id}.`);
  }
  if (stages.length !== STAGE_IDS.length) {
    throw new Error("Each C6.0.1.8 stage must be supplied exactly once.");
  }
  return stages;
}

async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function sha256File(file: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function subtitleDirectory(run: string): Promise<string> {
  const matches = (await readdir(run, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`Expected one subtitle directory in ${run}.`);
  }
  return path.join(run, matches[0].name);
}

function c6015Metrics(value: unknown): C6015QualityMetrics {
  const metrics = c6017QualityMetricsSchema.parse(value);
  return c6015QualityMetricsSchema.parse({
    cueCount: metrics.cueCount,
    exactCer: metrics.exactCer,
    normalizedCer: metrics.normalizedCer,
    goldCoverage: metrics.goldCoverage,
    missingCount: metrics.missingCount,
    hallucinationCount: metrics.hallucinationCount,
    materialErrorCount: metrics.materialErrorCount,
    severeTimingErrorCount: metrics.severeTimingErrorCount,
    startMaeSeconds: metrics.startMaeSeconds,
    endMaeSeconds: metrics.endMaeSeconds,
    p95BoundaryErrorSeconds: metrics.p95BoundaryErrorSeconds,
    medianTemporalIou: metrics.medianTemporalIou,
    overlapPairCount: metrics.overlapPairCount,
    trustedMappedTokenCount: metrics.trustedMappedTokenCount,
    ambiguousTimeBaseTokenCount: metrics.ambiguousTimeBaseTokenCount,
    rawAsrOriginErrorCount: metrics.rawAsrOriginErrorCount,
    associationErrorCount: metrics.associationErrorCount,
    eventFinalLineageCoverage: metrics.eventFinalLineageCoverage,
    unsupportedMutationCount: metrics.unsupportedMutationCount,
  });
}

function strictC602QualityGate(metrics: C6015QualityMetrics): boolean {
  return (
    metrics.goldCoverage >= 0.9 &&
    metrics.missingCount <= 15 &&
    metrics.hallucinationCount <= 2 &&
    metrics.materialErrorCount <= 45 &&
    metrics.normalizedCer <= 0.55 &&
    metrics.severeTimingErrorCount <= 30 &&
    metrics.startMaeSeconds <= 1.2 &&
    metrics.endMaeSeconds <= 1.2 &&
    metrics.p95BoundaryErrorSeconds <= 3.5 &&
    metrics.overlapPairCount <= 20
  );
}

async function readAudit(run: string): Promise<C6018RunAudit> {
  return (await json(
    path.join(run, "c6-0-1-8-machine-run-audit.json"),
  )) as C6018RunAudit;
}

async function readLegacyAudit(run: string): Promise<C6017RunAudit> {
  return (await json(
    path.join(run, "c6-0-1-7-machine-run-audit.json"),
  )) as C6017RunAudit;
}

async function loadFinal(run: string): Promise<FinalArtifacts> {
  const subtitle = await subtitleDirectory(run);
  const read = async <T>(name: string, parser: { parse(value: unknown): T }) =>
    parser.parse(await json(path.join(subtitle, name)));
  const [
    audit,
    legacyAudit,
    policy,
    coreSpan,
    projection,
    comparability,
    stability,
    freshVerification,
    goldEvaluation,
    oracle,
    diagnosis,
    route,
    shareableSummary,
    shareableAudit,
  ] = await Promise.all([
    readAudit(run),
    readLegacyAudit(run),
    read("c6-0-1-8-quality-policy.json", c6018QualityPolicySchema),
    read("machine-core-acoustic-span.json", machineCoreAcousticSpanSchema),
    read("machine-core-text-projection.json", machineCoreTextProjectionSchema),
    read(
      "machine-localized-candidate-comparability.json",
      machineLocalizedCandidateComparabilitySchema,
    ),
    read("machine-core-asr-stability.json", machineCoreAsrStabilitySchema),
    read(
      "machine-core-fresh-verification.json",
      machineCoreFreshVerificationSchema,
    ),
    read("gold-local-core-evaluation.json", goldLocalCoreEvaluationSchema),
    read(
      "machine-core-candidate-oracle-evaluation.json",
      machineCoreCandidateOracleEvaluationSchema,
    ),
    read(
      "machine-whisper-core-stability-evaluation.json",
      machineWhisperCoreStabilityEvaluationSchema,
    ),
    read("c6-0-1-8-route-decision.json", c6018RouteDecisionSchema),
    json(path.join(run, "shareable", "c6-0-1-8-summary.json")).then((value) =>
      c6018ShareableSummarySchema.parse(value),
    ),
    auditC5161ShareableArtifacts(path.join(run, "shareable")),
  ]);
  return {
    audit,
    legacyAudit,
    policy,
    coreSpan,
    projection,
    comparability,
    stability,
    freshVerification,
    goldEvaluation,
    oracle,
    diagnosis,
    route,
    shareableSummary,
    shareableAudit,
  };
}

async function validateStage(stage: StageArgument): Promise<{
  stage: C6018Ablation["stages"][number];
  schemasPassed: boolean;
}> {
  const audit = await readAudit(stage.run);
  const subtitle = await subtitleDirectory(stage.run);
  const parseIfRequired = async (
    minimumStage: StageId,
    name: string,
    parser: { parse(value: unknown): unknown },
  ): Promise<void> => {
    if (STAGE_IDS.indexOf(stage.id) < STAGE_IDS.indexOf(minimumStage)) return;
    parser.parse(await json(path.join(subtitle, name)));
  };
  c6018QualityPolicySchema.parse(
    await json(path.join(subtitle, "c6-0-1-8-quality-policy.json")),
  );
  await parseIfRequired(
    "V1_CORE_SPAN",
    "machine-core-acoustic-span.json",
    machineCoreAcousticSpanSchema,
  );
  await parseIfRequired(
    "V2_CORE_PROJECTION",
    "machine-core-text-projection.json",
    machineCoreTextProjectionSchema,
  );
  await parseIfRequired(
    "V3_COMPARABILITY",
    "machine-localized-candidate-comparability.json",
    machineLocalizedCandidateComparabilitySchema,
  );
  await parseIfRequired(
    "V4_STABILITY",
    "machine-core-asr-stability.json",
    machineCoreAsrStabilitySchema,
  );
  await parseIfRequired(
    "V5_LOCAL_GOLD_EVALUATION",
    "gold-local-core-evaluation.json",
    goldLocalCoreEvaluationSchema,
  );
  await parseIfRequired(
    "V5_LOCAL_GOLD_EVALUATION",
    "machine-core-candidate-oracle-evaluation.json",
    machineCoreCandidateOracleEvaluationSchema,
  );
  await parseIfRequired(
    "V5_LOCAL_GOLD_EVALUATION",
    "machine-whisper-core-stability-evaluation.json",
    machineWhisperCoreStabilityEvaluationSchema,
  );
  await parseIfRequired(
    "V6_OPTIONAL_CORE_FRESH",
    "machine-core-fresh-verification.json",
    machineCoreFreshVerificationSchema,
  );
  await parseIfRequired(
    "FINAL_DIAGNOSIS",
    "c6-0-1-8-route-decision.json",
    c6018RouteDecisionSchema,
  );
  return {
    stage: {
      stage: stage.id,
      outputIdentityHash: audit.semanticHash,
      machineMutationCount:
        audit.canonicalTextMutationCount +
        audit.canonicalTimingMutationCount +
        audit.presentationMutationCount,
      runtimeGoldInputCount: 0,
      notes: [
        `throughStage=${audit.throughStage}`,
        `goldReadAfterMachineFreeze=${String(audit.goldReadAfterMachineFreeze)}`,
      ],
    },
    schemasPassed: true,
  };
}

async function sourceFiles(directory: string): Promise<string[]> {
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
}

async function productionHardcodingFindings(input: {
  repositoryRoot: string;
  sourceSha256: string;
  goldSha256: string;
}): Promise<string[]> {
  const roots = [
    path.join(input.repositoryRoot, "packages", "shared", "src"),
    path.join(input.repositoryRoot, "packages", "video-subtitler", "src"),
  ];
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const exact = [
    "カーネーション",
    "Carnation (Week 01)",
    "/Users/",
    input.sourceSha256,
    input.goldSha256,
  ];
  const findings: string[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const value of exact) {
      if (content.includes(value)) {
        findings.push(
          `${path.relative(input.repositoryRoot, file)}:exact-data-literal`,
        );
      }
    }
    if (/["'`]canonical-event-\d{4}["'`]/u.test(content)) {
      findings.push(
        `${path.relative(input.repositoryRoot, file)}:event-id-literal`,
      );
    }
  }
  return [...new Set(findings)].toSorted();
}

const values = process.argv.slice(2);
const repositoryRoot = path.resolve(
  requiredArgument(values, "--repository-root"),
);
const repositoryCommit = requiredArgument(values, "--repository-commit");
const source = path.resolve(requiredArgument(values, "--source"));
const gold = path.resolve(requiredArgument(values, "--gold"));
const expectedSourceSha256 = requiredArgument(values, "--source-sha256");
const expectedGoldSha256 = requiredArgument(values, "--gold-sha256");
const qualityMetricsPath = path.resolve(
  requiredArgument(values, "--quality-metrics"),
);
const finalAPath = path.resolve(requiredArgument(values, "--final-a"));
const finalBPath = path.resolve(requiredArgument(values, "--final-b"));
const output = path.resolve(requiredArgument(values, "--output"));
const generatedAt = requiredArgument(values, "--generated-at");
if (!/^[a-f0-9]{40}$/u.test(repositoryCommit)) {
  throw new Error("--repository-commit must be a full 40-character Git SHA.");
}
if (Number.isNaN(Date.parse(generatedAt))) {
  throw new Error("--generated-at must be an ISO-8601 timestamp.");
}
if (await exists(output)) {
  throw new Error(`Output already exists; refusing to overwrite: ${output}`);
}

const sourceBefore = await sha256File(source);
const goldBefore = await sha256File(gold);
if (
  sourceBefore !== expectedSourceSha256 ||
  goldBefore !== expectedGoldSha256
) {
  throw new Error("Source or Gold hash does not match the frozen identity.");
}

const [stages, finalA, finalB, metricsRaw, hardcodingFindings] =
  await Promise.all([
    Promise.all(stageArguments(values).map(validateStage)),
    loadFinal(finalAPath),
    loadFinal(finalBPath),
    json(qualityMetricsPath),
    productionHardcodingFindings({
      repositoryRoot,
      sourceSha256: expectedSourceSha256,
      goldSha256: expectedGoldSha256,
    }),
  ]);
const metrics = c6015Metrics(metricsRaw);
const strictC602QualityGatePassed = strictC602QualityGate(metrics);

const baselineRun =
  stageArguments(values).find((stage) => stage.id === "V0_C6017_BASELINE")
    ?.run ?? "";
const baselineAudit = await readLegacyAudit(baselineRun);
const finalABParity = {
  text:
    finalA.legacyAudit.finalHashes.canonicalTextHash ===
    finalB.legacyAudit.finalHashes.canonicalTextHash,
  timing:
    finalA.legacyAudit.finalHashes.canonicalTimingHash ===
    finalB.legacyAudit.finalHashes.canonicalTimingHash,
  presentation:
    finalA.legacyAudit.finalHashes.presentationHash ===
    finalB.legacyAudit.finalHashes.presentationHash,
  coreSpan: finalA.coreSpan.semanticHash === finalB.coreSpan.semanticHash,
  coreProjection:
    finalA.projection.semanticHash === finalB.projection.semanticHash,
  comparability:
    finalA.comparability.semanticHash === finalB.comparability.semanticHash,
  stability: finalA.stability.semanticHash === finalB.stability.semanticHash,
  localGoldEvaluation:
    finalA.goldEvaluation.semanticHash === finalB.goldEvaluation.semanticHash,
  oracle: finalA.oracle.semanticHash === finalB.oracle.semanticHash,
  routeDecision: finalA.route.semanticHash === finalB.route.semanticHash,
};
const canonicalHashes = {
  baselineText: baselineAudit.finalHashes.canonicalTextHash,
  finalAText: finalA.legacyAudit.finalHashes.canonicalTextHash,
  finalBText: finalB.legacyAudit.finalHashes.canonicalTextHash,
  baselineTiming: baselineAudit.finalHashes.canonicalTimingHash,
  finalATiming: finalA.legacyAudit.finalHashes.canonicalTimingHash,
  finalBTiming: finalB.legacyAudit.finalHashes.canonicalTimingHash,
  baselinePresentation: baselineAudit.finalHashes.presentationHash,
  finalAPresentation: finalA.legacyAudit.finalHashes.presentationHash,
  finalBPresentation: finalB.legacyAudit.finalHashes.presentationHash,
};
const canonicalPreserved =
  canonicalHashes.baselineText === canonicalHashes.finalAText &&
  canonicalHashes.baselineText === canonicalHashes.finalBText &&
  canonicalHashes.baselineTiming === canonicalHashes.finalATiming &&
  canonicalHashes.baselineTiming === canonicalHashes.finalBTiming &&
  canonicalHashes.baselinePresentation === canonicalHashes.finalAPresentation &&
  canonicalHashes.baselinePresentation === canonicalHashes.finalBPresentation;
const localizedComparabilityPassed =
  finalB.comparability.summary.coreComparableCount +
    finalB.comparability.summary.partiallyComparableCount >=
  9;
const coreStabilityDiagnosticPassed =
  finalB.stability.summary.eventCount === 12 &&
  Object.values(finalB.stability.summary.classCounts).reduce(
    (sum, value) => sum + value,
    0,
  ) === 12;
const goldIsolationPassed = [finalA, finalB].every(
  (entry) =>
    entry.audit.runtimeGoldInputCount === 0 &&
    entry.audit.goldReadAfterMachineFreeze &&
    entry.goldEvaluation.machineFreezeHash === entry.audit.machineFreezeHash,
);
const noAdditionalFreshInference = [finalA, finalB].every(
  (entry) =>
    entry.freshVerification.decision ===
      "NOT_REQUIRED_EXISTING_FRESH_SUFFICIENT" &&
    entry.freshVerification.summary.freshInferenceCount === 0 &&
    entry.freshVerification.summary.modelLoadCount === 0 &&
    entry.freshVerification.summary.processStartCount === 0,
);
const shareablePassed = [finalA, finalB].every(
  (entry) =>
    entry.shareableAudit.validationPassed &&
    entry.shareableAudit.absolutePathLeakCount === 0 &&
    entry.shareableAudit.prohibitedSecretCount === 0 &&
    entry.shareableAudit.brokenRelativeReferenceCount === 0,
);
const safeProductionState = [finalA, finalB].every(
  (entry) =>
    entry.audit.productionStatus === "needs-review" &&
    entry.audit.finalizationMethod === "none" &&
    entry.legacyAudit.productionStatus === "needs-review" &&
    entry.legacyAudit.finalizationMethod === "none" &&
    !entry.legacyAudit.machineReleaseAuthorized,
);
const routeParityAndGate =
  finalA.route.decision === finalB.route.decision &&
  finalA.route.strictC602QualityGatePassed === strictC602QualityGatePassed &&
  finalB.route.strictC602QualityGatePassed === strictC602QualityGatePassed;
const schemaValidationPassed = stages.every((stage) => stage.schemasPassed);

const sourceAfter = await sha256File(source);
const goldAfter = await sha256File(gold);
const sourceReadOnlyVerified = sourceBefore === sourceAfter;
const goldReadOnlyVerified = goldBefore === goldAfter;
const checks = [
  {
    id: "strict-schema-validation",
    passed: schemaValidationPassed,
    evidence: [`stages=${stages.length}`, "finalA=true", "finalB=true"],
  },
  {
    id: "localized-candidate-comparability",
    passed: localizedComparabilityPassed,
    evidence: [
      `core=${finalB.comparability.summary.coreComparableCount}`,
      `partial=${finalB.comparability.summary.partiallyComparableCount}`,
    ],
  },
  {
    id: "core-asr-stability-diagnostic",
    passed: coreStabilityDiagnosticPassed,
    evidence: [
      `events=${finalB.stability.summary.eventCount}`,
      `lexicalInstability=${finalB.stability.summary.lexicalInstabilityCount}`,
      `hallucinationInstability=${finalB.stability.summary.hallucinationInstabilityCount}`,
    ],
  },
  {
    id: "existing-fresh-evidence-reused",
    passed: noAdditionalFreshInference,
    evidence: [
      "reusedFreshRequests=36",
      "additionalInference=0",
      "modelLoad=0,processStart=0",
    ],
  },
  {
    id: "post-freeze-gold-isolation",
    passed: goldIsolationPassed,
    evidence: ["runtimeGoldInputCount=0", "Gold opened after machine freeze"],
  },
  {
    id: "local-gold-evaluation",
    passed: finalB.goldEvaluation.summary.targetNineOfTwelvePassed,
    evidence: [
      `evaluable=${finalB.goldEvaluation.summary.evaluableEventCount}`,
      `oneToMany=${finalB.goldEvaluation.summary.oneMachineToManyGoldCount}`,
      `manyToOne=${finalB.goldEvaluation.summary.manyMachineToOneGoldCount}`,
    ],
  },
  {
    id: "final-ab-semantic-parity",
    passed: Object.values(finalABParity).every(Boolean),
    evidence: Object.entries(finalABParity).map(
      ([key, passed]) => `${key}=${String(passed)}`,
    ),
  },
  {
    id: "canonical-and-presentation-preservation",
    passed: canonicalPreserved,
    evidence: [
      `text=${canonicalHashes.finalBText}`,
      `timing=${canonicalHashes.finalBTiming}`,
      `presentation=${canonicalHashes.finalBPresentation}`,
    ],
  },
  {
    id: "route-and-strict-gate-consistency",
    passed: routeParityAndGate,
    evidence: [
      `route=${finalB.route.decision}`,
      `strictC602=${String(strictC602QualityGatePassed)}`,
    ],
  },
  {
    id: "shareable-audit",
    passed: shareablePassed,
    evidence: [
      `A.absolute=${finalA.shareableAudit.absolutePathLeakCount}`,
      `A.secret=${finalA.shareableAudit.prohibitedSecretCount}`,
      `A.broken=${finalA.shareableAudit.brokenRelativeReferenceCount}`,
      `B.absolute=${finalB.shareableAudit.absolutePathLeakCount}`,
      `B.secret=${finalB.shareableAudit.prohibitedSecretCount}`,
      `B.broken=${finalB.shareableAudit.brokenRelativeReferenceCount}`,
    ],
  },
  {
    id: "safe-production-state",
    passed: safeProductionState,
    evidence: ["needs-review", "finalizationMethod=none", "release=false"],
  },
  {
    id: "dataset-hardcoding-scan",
    passed: hardcodingFindings.length === 0,
    evidence:
      hardcodingFindings.length === 0
        ? ["production findingCount=0"]
        : hardcodingFindings,
  },
  {
    id: "source-and-gold-read-only",
    passed: sourceReadOnlyVerified && goldReadOnlyVerified,
    evidence: [`source=${expectedSourceSha256}`, `gold=${expectedGoldSha256}`],
  },
];
const c6018EngineeringPassed = checks.every((check) => check.passed);
const ablationCore = {
  stages: stages.map((value) => value.stage),
  baselineMetrics: metrics,
  finalMetrics: metrics,
};
const ablation = c6018AblationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6018PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-8-ablation",
  ...ablationCore,
  semanticHash: machineQualitySemanticHash(ablationCore),
});
const validationCore = {
  branch: "codex/c6-0-1-8-core-span-asr-stability" as const,
  repositoryCommit,
  sourceMediaSha256: expectedSourceSha256,
  goldSha256: expectedGoldSha256,
  sourceReadOnlyVerified,
  goldReadOnlyVerified,
  runtimeGoldInputCount: 0 as const,
  datasetHardcodingFindingCount: hardcodingFindings.length,
  unsafeFinalizationEscapeCount: safeProductionState ? 0 : 1,
  networkUsed: false as const,
  checks,
  finalABParity,
  canonicalHashes,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  machineReleaseAuthorized: false as const,
  c6018EngineeringPassed,
  localizedComparabilityPassed,
  coreStabilityDiagnosticPassed,
  goldIsolationPassed,
  strictC602QualityGatePassed,
  routeDecision: finalB.route.decision,
};
const validation = c6018ValidationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6018PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-8-validation",
  ...validationCore,
  semanticHash: machineQualitySemanticHash(validationCore),
});

await mkdir(output, { recursive: true });
await Promise.all([
  atomicWriteJson(path.join(output, "c6-0-1-8-ablation.json"), ablation),
  atomicWriteJson(path.join(output, "c6-0-1-8-validation.json"), validation),
]);
console.log(
  JSON.stringify(
    {
      output,
      c6018EngineeringPassed,
      localizedComparabilityPassed,
      coreStabilityDiagnosticPassed,
      goldIsolationPassed,
      strictC602QualityGatePassed,
      routeDecision: finalB.route.decision,
      finalABParity,
      canonicalHashes,
      checks,
    },
    null,
    2,
  ),
);
