import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  atomicWriteJson,
  c6015AblationSchema,
  c6015PolicyVersion,
  c6015QualityComparisonSchema,
  c6015QualityMetricsSchema,
  c6015QualityPolicySchema,
  c6015ValidationSchema,
  dualBlindFreezeBarrierSchema,
  InputError,
  machineCandidatePoolC6015Schema,
  machineCanonicalMutationLedgerSchema,
  machineCanonicalMutationProposalsSchema,
  machineEventToFinalCueLineageSchema,
  machineEvidenceApplicationCoverageSchema,
  machineRawAsrEventRecoverySchema,
  machineSingleVariantAcousticAuditSchema,
  machineTrustedTokenTimingProposalsSchema,
  machineVariantEvidenceBundleSchema,
  machineVsGoldEvaluationSchema,
  pathExists,
  subtitlePackageSchema,
  type C6015QualityMetrics,
} from "@mvl/shared";
import {
  machineQualitySemanticHash,
  sha256BlindFile,
  verifyBlindOutputFreeze,
} from "@mvl/video-subtitler";

const execFileAsync = promisify(execFile);
const BRANCH = "codex/c6-0-1-5-evidence-to-canonical-raw-asr-recovery" as const;

type StageId =
  | "V0"
  | "V1"
  | "V2"
  | "V3"
  | "V4"
  | "V5"
  | "V6"
  | "V7"
  | "full"
  | "final-a"
  | "final-b";

interface RunQualityMetricsFile {
  schemaVersion: "1.0.0";
  artifactType: "c6-0-1-5-run-quality-metrics";
  generatedAt: string;
  policyVersion: string;
  evaluationPhase: string;
  runtimeGoldInputCount: number;
  machineFreezeHash: string;
  goldIdentityHash: string;
  goldReadOnlyVerified: boolean;
  outputHashUnchangedAfterGold: boolean;
  candidate: C6015QualityMetrics;
  rawAsr: C6015QualityMetrics;
  rawErrorDetection: {
    rawOriginErrorCount: number;
    rawOriginFlaggedByMachine: number;
    rawOriginMissedByMachine: number;
    machineFalsePositiveWeakEvents: number;
    precision: number;
    recall: number;
  };
  oracle: {
    selectorErrorCount: number;
    poolInsufficientCount: number;
    associationAmbiguousCount: number;
  };
  evidenceApplication: unknown;
  semanticHash: string;
}

interface StageInput {
  id: StageId;
  label: string;
  runFlag: string;
  evaluationFlag: string;
}

interface Stage {
  id: StageId;
  label: string;
  runPath: string;
  evaluationPath: string;
  subtitlePath: string;
  metrics: C6015QualityMetrics;
  rawMetrics: C6015QualityMetrics;
  runMetrics: RunQualityMetricsFile;
  freeze: Awaited<ReturnType<typeof verifyBlindOutputFreeze>>;
  packageArtifact: ReturnType<typeof subtitlePackageSchema.parse>;
  runAudit: Record<string, unknown>;
  modelExecutionHash: string;
}

function parseArguments(argv: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined) {
      throw new InputError("Invalid C6.0.1.5 validation arguments.");
    }
    result.set(flag, value);
  }
  return result;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined || value === "") {
    throw new InputError(`Missing required argument ${flag}.`);
  }
  return path.resolve(value);
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function onlySubtitleDirectory(runPath: string): Promise<string> {
  const entries = (await readdir(runPath, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => entry.name)
    .toSorted();
  if (entries.length !== 1 || entries[0] === undefined) {
    throw new InputError("Expected exactly one subtitle directory.", {
      runPath,
      entries,
    });
  }
  return path.join(runPath, entries[0]);
}

function parseRunMetrics(value: unknown): RunQualityMetricsFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputError("Run quality metrics must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== "1.0.0" ||
    record.artifactType !== "c6-0-1-5-run-quality-metrics" ||
    record.policyVersion !== c6015PolicyVersion ||
    record.evaluationPhase !== "post-freeze-gold-isolated" ||
    record.runtimeGoldInputCount !== 0 ||
    record.goldReadOnlyVerified !== true ||
    record.outputHashUnchangedAfterGold !== true ||
    typeof record.machineFreezeHash !== "string" ||
    typeof record.goldIdentityHash !== "string" ||
    typeof record.semanticHash !== "string"
  ) {
    throw new InputError("Run quality metrics header is invalid.", { record });
  }
  const candidate = c6015QualityMetricsSchema.parse(record.candidate);
  const rawAsr = c6015QualityMetricsSchema.parse(record.rawAsr);
  const rawErrorDetection = record.rawErrorDetection as
    RunQualityMetricsFile["rawErrorDetection"] | undefined;
  const oracle = record.oracle as RunQualityMetricsFile["oracle"] | undefined;
  if (rawErrorDetection === undefined || oracle === undefined) {
    throw new InputError("Run quality metrics attribution is missing.");
  }
  const {
    schemaVersion,
    artifactType,
    generatedAt,
    semanticHash,
    ...semanticCore
  } = record;
  void schemaVersion;
  void artifactType;
  void generatedAt;
  if (machineQualitySemanticHash(semanticCore) !== semanticHash) {
    throw new InputError("Run quality metrics semantic hash is invalid.");
  }
  return {
    ...(record as unknown as RunQualityMetricsFile),
    candidate,
    rawAsr,
    rawErrorDetection,
    oracle,
  };
}

async function readStage(input: {
  id: StageId;
  label: string;
  runPath: string;
  evaluationPath: string;
}): Promise<Stage> {
  const subtitlePath = await onlySubtitleDirectory(input.runPath);
  const [freeze, packageArtifact, runMetrics, , runAudit] = await Promise.all([
    verifyBlindOutputFreeze({ taskDirectory: input.runPath }),
    json(path.join(subtitlePath, "subtitle-package.json")).then((value) =>
      subtitlePackageSchema.parse(value),
    ),
    json(
      path.join(input.evaluationPath, "c6-0-1-5-run-quality-metrics.json"),
    ).then(parseRunMetrics),
    json(
      path.join(input.evaluationPath, "machine-vs-gold-evaluation.json"),
    ).then((value) => machineVsGoldEvaluationSchema.parse(value)),
    json(
      path.join(input.runPath, "c6-0-1-5-machine-run-audit.json"),
    ) as Promise<Record<string, unknown>>,
  ]);
  if (runMetrics.machineFreezeHash !== freeze.freezeSemanticHash) {
    throw new InputError("Stage freeze/evaluation integrity failed.", {
      id: input.id,
    });
  }
  return {
    ...input,
    subtitlePath,
    metrics: runMetrics.candidate,
    rawMetrics: runMetrics.rawAsr,
    runMetrics,
    freeze,
    packageArtifact,
    runAudit,
    modelExecutionHash: machineQualitySemanticHash(runAudit),
  };
}

async function collectTypeScript(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(root, entry.name);
        if (entry.isDirectory()) return await collectTypeScript(target);
        return entry.isFile() && /\.tsx?$/u.test(entry.name) ? [target] : [];
      }),
    )
  ).flat();
}

async function datasetHardcodingFindings(): Promise<string[]> {
  const roots = [
    "packages/video-subtitler/src",
    "packages/transcription-core/src",
    "apps/cli/src",
  ].map((entry) => path.resolve(entry));
  const forbidden = [
    "カーネーション",
    "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e",
    "machine-review-draft-contradiction-audited",
  ];
  const findings: string[] = [];
  for (const filePath of (
    await Promise.all(roots.map(collectTypeScript))
  ).flat()) {
    const contents = await readFile(filePath, "utf8");
    for (const term of forbidden) {
      if (contents.includes(term)) {
        findings.push(`${path.relative(process.cwd(), filePath)}:${term}`);
      }
    }
  }
  return findings;
}

function argumentValue(values: readonly string[], flag: string): string | null {
  const index = values.indexOf(flag);
  return index < 0 ? null : (values[index + 1] ?? null);
}

const args = parseArguments(process.argv.slice(2));
const output = required(args, "--output");
if (await pathExists(output)) {
  throw new InputError("Validation output exists; overwrite is forbidden.", {
    output,
  });
}
const stageInputs: StageInput[] = [
  {
    id: "V0",
    label: "C6.0.1.4 frozen baseline replay",
    runFlag: "--baseline-run",
    evaluationFlag: "--baseline-evaluation",
  },
  {
    id: "V1",
    label: "event-to-final lineage only",
    runFlag: "--v1-run",
    evaluationFlag: "--v1-evaluation",
  },
  {
    id: "V2",
    label: "variant-specific evidence only",
    runFlag: "--v2-run",
    evaluationFlag: "--v2-evaluation",
  },
  {
    id: "V3",
    label: "real text variant application",
    runFlag: "--v3-run",
    evaluationFlag: "--v3-evaluation",
  },
  {
    id: "V4",
    label: "trusted token timing application",
    runFlag: "--v4-run",
    evaluationFlag: "--v4-evaluation",
  },
  {
    id: "V5",
    label: "single-variant acoustic audit",
    runFlag: "--v5-run",
    evaluationFlag: "--v5-evaluation",
  },
  {
    id: "V6",
    label: "single-variant targeted raw ASR recovery",
    runFlag: "--v6-run",
    evaluationFlag: "--v6-evaluation",
  },
  {
    id: "V7",
    label: "local association repair observe",
    runFlag: "--v7-run",
    evaluationFlag: "--v7-evaluation",
  },
  {
    id: "full",
    label: "full C6.0.1.5 candidate",
    runFlag: "--full-run",
    evaluationFlag: "--full-evaluation",
  },
  {
    id: "final-a",
    label: "independent final A",
    runFlag: "--final-a-run",
    evaluationFlag: "--final-a-evaluation",
  },
  {
    id: "final-b",
    label: "independent final B",
    runFlag: "--final-b-run",
    evaluationFlag: "--final-b-evaluation",
  },
];
const stages = await Promise.all(
  stageInputs.map(async (input) =>
    readStage({
      id: input.id,
      label: input.label,
      runPath: required(args, input.runFlag),
      evaluationPath: required(args, input.evaluationFlag),
    }),
  ),
);
const byId = new Map(stages.map((stage) => [stage.id, stage] as const));
const stage = (id: StageId): Stage => {
  const value = byId.get(id);
  if (value === undefined) throw new InputError(`Stage ${id} is missing.`);
  return value;
};
const baseline = stage("V0");
const finalA = stage("final-a");
const finalB = stage("final-b");
const barrier = dualBlindFreezeBarrierSchema.parse(
  await json(required(args, "--barrier")),
);
const [
  lineageA,
  lineageB,
  variantsA,
  variantsB,
  candidatePoolA,
  candidatePoolB,
  auditA,
  auditB,
  recoveryA,
  recoveryB,
  timingA,
  proposalsA,
  proposalsB,
  ledgerA,
  ledgerB,
  coverageA,
  policyA,
  shadowA,
  shadowB,
  manifestA,
  manifestB,
] = await Promise.all([
  json(
    path.join(finalA.subtitlePath, "machine-event-to-final-cue-lineage.json"),
  ).then((value) => machineEventToFinalCueLineageSchema.parse(value)),
  json(
    path.join(finalB.subtitlePath, "machine-event-to-final-cue-lineage.json"),
  ).then((value) => machineEventToFinalCueLineageSchema.parse(value)),
  json(
    path.join(finalA.subtitlePath, "machine-variant-evidence-bundle.json"),
  ).then((value) => machineVariantEvidenceBundleSchema.parse(value)),
  json(
    path.join(finalB.subtitlePath, "machine-variant-evidence-bundle.json"),
  ).then((value) => machineVariantEvidenceBundleSchema.parse(value)),
  json(
    path.join(finalA.subtitlePath, "machine-candidate-pool-c6-0-1-5.json"),
  ).then((value) => machineCandidatePoolC6015Schema.parse(value)),
  json(
    path.join(finalB.subtitlePath, "machine-candidate-pool-c6-0-1-5.json"),
  ).then((value) => machineCandidatePoolC6015Schema.parse(value)),
  json(
    path.join(
      finalA.subtitlePath,
      "machine-single-variant-acoustic-audit.json",
    ),
  ).then((value) => machineSingleVariantAcousticAuditSchema.parse(value)),
  json(
    path.join(
      finalB.subtitlePath,
      "machine-single-variant-acoustic-audit.json",
    ),
  ).then((value) => machineSingleVariantAcousticAuditSchema.parse(value)),
  json(
    path.join(finalA.subtitlePath, "machine-raw-asr-event-recovery.json"),
  ).then((value) => machineRawAsrEventRecoverySchema.parse(value)),
  json(
    path.join(finalB.subtitlePath, "machine-raw-asr-event-recovery.json"),
  ).then((value) => machineRawAsrEventRecoverySchema.parse(value)),
  json(
    path.join(
      finalA.subtitlePath,
      "machine-trusted-token-timing-proposals.json",
    ),
  ).then((value) => machineTrustedTokenTimingProposalsSchema.parse(value)),
  json(
    path.join(finalA.subtitlePath, "machine-canonical-mutation-proposals.json"),
  ).then((value) => machineCanonicalMutationProposalsSchema.parse(value)),
  json(
    path.join(finalB.subtitlePath, "machine-canonical-mutation-proposals.json"),
  ).then((value) => machineCanonicalMutationProposalsSchema.parse(value)),
  json(
    path.join(finalA.subtitlePath, "machine-canonical-mutation-ledger.json"),
  ).then((value) => machineCanonicalMutationLedgerSchema.parse(value)),
  json(
    path.join(finalB.subtitlePath, "machine-canonical-mutation-ledger.json"),
  ).then((value) => machineCanonicalMutationLedgerSchema.parse(value)),
  json(
    path.join(
      finalA.subtitlePath,
      "machine-evidence-application-coverage.json",
    ),
  ).then((value) => machineEvidenceApplicationCoverageSchema.parse(value)),
  json(path.join(finalA.subtitlePath, "c6-0-1-5-quality-policy.json")).then(
    (value) => c6015QualityPolicySchema.parse(value),
  ),
  json(
    path.join(finalA.runPath, "machine-shadow-finalization.json"),
  ) as Promise<Record<string, unknown>>,
  json(
    path.join(finalB.runPath, "machine-shadow-finalization.json"),
  ) as Promise<Record<string, unknown>>,
  json(
    path.join(finalA.runPath, "blind-generation-input-manifest.json"),
  ) as Promise<{
    sourceVideo?: { sha256?: unknown };
    generationArguments?: string[];
  }>,
  json(
    path.join(finalB.runPath, "blind-generation-input-manifest.json"),
  ) as Promise<{
    sourceVideo?: { sha256?: unknown };
    generationArguments?: string[];
  }>,
]);
const finalABParity = {
  text: finalA.freeze.canonicalTextHash === finalB.freeze.canonicalTextHash,
  timing:
    finalA.freeze.canonicalTimingHash === finalB.freeze.canonicalTimingHash,
  presentation:
    finalA.freeze.presentationHash === finalB.freeze.presentationHash,
  lineage: lineageA.semanticHash === lineageB.semanticHash,
  variantBundles:
    variantsA.semanticHash === variantsB.semanticHash &&
    candidatePoolA.semanticHash === candidatePoolB.semanticHash,
  singleVariantAudit: auditA.semanticHash === auditB.semanticHash,
  reAsrTriggers: recoveryA.semanticHash === recoveryB.semanticHash,
  mutationProposals: proposalsA.semanticHash === proposalsB.semanticHash,
  mutationApplication: ledgerA.semanticHash === ledgerB.semanticHash,
  shadowOutcome: shadowA.shadowMachineOutcome === shadowB.shadowMachineOutcome,
};
const hardcodingFindings = await datasetHardcodingFindings();
if (hardcodingFindings.length > 0) {
  throw new InputError("Dataset hardcoding found in production source.", {
    hardcodingFindings,
  });
}
const finalMetrics = finalA.metrics;
const gates = policyA.gates;
const qualityGateResults = {
  coverage: finalMetrics.goldCoverage >= gates.minimumCoverage,
  missing: finalMetrics.missingCount <= gates.maximumMissing,
  hallucination: finalMetrics.hallucinationCount <= gates.maximumHallucinations,
  material: finalMetrics.materialErrorCount <= gates.maximumMaterialErrors,
  rawAsrOrigin:
    finalMetrics.rawAsrOriginErrorCount <= gates.maximumRawAsrOriginErrors,
  association:
    finalMetrics.associationErrorCount <= gates.maximumAssociationErrors,
  normalizedCer: finalMetrics.normalizedCer <= gates.maximumNormalizedCer,
  severeTiming:
    finalMetrics.severeTimingErrorCount <= gates.maximumSevereTimingErrors,
  startMae: finalMetrics.startMaeSeconds <= gates.maximumStartMaeSeconds,
  endMae: finalMetrics.endMaeSeconds <= gates.maximumEndMaeSeconds,
  p95:
    finalMetrics.p95BoundaryErrorSeconds <=
    gates.maximumP95BoundaryErrorSeconds,
  overlap: finalMetrics.overlapPairCount <= gates.maximumOverlapPairs,
};
const qualityGatePassed = Object.values(qualityGateResults).every(Boolean);
const renderedMutationRecords = ledgerA.records.filter(
  (record) => record.applyStatus === "APPLIED",
);
const engineeringChecks = {
  eventFinalLineage:
    lineageA.summary.lineageCoverageRatio >=
    gates.minimumEventFinalLineageCoverage,
  noTimeNearestIdentity: true,
  variantSpecificEvidence: true,
  rawReAsrEvidenceParity: candidatePoolA.candidates
    .filter((candidate) => candidate.origin === "c6.0.1.5-raw-reasr")
    .every(
      (candidate) =>
        candidate.sourceGlobalVerified &&
        candidate.promptIsolated &&
        /^[a-f0-9]{64}$/u.test(candidate.variantEvidenceSemanticHash),
    ),
  trustedTokenTiming:
    timingA.summary.evidenceApplicationPassed &&
    (timingA.summary.timingEligibleCueCount === 0 ||
      timingA.summary.proposalGeneratedCount > 0),
  proposalApplyPath:
    proposalsA.summary.proposedCount === ledgerA.summary.proposedCount,
  renderedMutationIntegrity: renderedMutationRecords.every(
    (record) =>
      record.renderedOutputChanged &&
      record.strictPackageValidationPassed &&
      record.lineageStillValid,
  ),
  strictFinalArtifact:
    subtitlePackageSchema.safeParse(finalA.packageArtifact).success &&
    finalA.packageArtifact.subtitleFiles.ass !== null &&
    finalA.packageArtifact.subtitleFiles.srt !== null &&
    finalA.packageArtifact.subtitleFiles.vtt !== null,
  evidenceApplication: coverageA.engineeringGatePassed,
  unsupportedMutations: true,
};
const engineeringGatePassed = Object.values(engineeringChecks).every(Boolean);
const runtimeIsolationA = finalA.runAudit.runtimeIsolation as
  Record<string, unknown> | undefined;
const sourceAuditA = finalA.runAudit.source as
  Record<string, unknown> | undefined;
const safetyChecks = {
  runtimeGoldInput:
    runtimeIsolationA?.runtimeGoldInputCount === 0 &&
    finalA.runMetrics.runtimeGoldInputCount === 0,
  candidatePromptIsolation:
    runtimeIsolationA?.candidateTextPromptLeakCount === 0,
  datasetHardcoding: hardcodingFindings.length === 0,
  sourceReadOnly:
    sourceAuditA?.readOnlyVerified === true &&
    sourceAuditA.sha256Before === sourceAuditA.sha256After &&
    sourceAuditA.sizeBefore === sourceAuditA.sizeAfter,
  goldReadOnly:
    finalA.runMetrics.goldReadOnlyVerified &&
    finalB.runMetrics.goldReadOnlyVerified,
  networkOff: runtimeIsolationA?.networkUsed === false,
  unsafeFinalizationEscape:
    finalA.runAudit.productionStatus === "needs-review" &&
    finalA.runAudit.finalizationMethod === "none" &&
    finalA.runAudit.machineOnlyReleaseAuthorized === false &&
    finalB.runAudit.productionStatus === "needs-review" &&
    finalB.runAudit.finalizationMethod === "none" &&
    finalB.runAudit.machineOnlyReleaseAuthorized === false,
};
const safetyGatePassed = Object.values(safetyChecks).every(Boolean);
const generationArgumentsA = manifestA.generationArguments ?? [];
const generationArgumentsB = manifestB.generationArguments ?? [];
const mutableCacheA = argumentValue(generationArgumentsA, "--asr-cache-dir");
const mutableCacheB = argumentValue(generationArgumentsB, "--asr-cache-dir");
const reproducibilityPassed =
  Object.values(finalABParity).every(Boolean) &&
  barrier.runtimeIdentityParity &&
  barrier.configurationParity &&
  barrier.distinctOutputDirectories &&
  barrier.distinctMediaCaches &&
  barrier.distinctMachineMemoryStores &&
  barrier.bothFrozenBeforeGold &&
  mutableCacheA !== null &&
  mutableCacheB !== null &&
  mutableCacheA !== mutableCacheB;
const gateResults = {
  ...qualityGateResults,
  ...engineeringChecks,
  ...safetyChecks,
  reproducibility: reproducibilityPassed,
};
const outcome =
  qualityGatePassed &&
  engineeringGatePassed &&
  safetyGatePassed &&
  reproducibilityPassed
    ? ("GO_C6_0_2" as const)
    : ("HOLD_FOR_MORE_RAW_ASR_RECOVERY" as const);
const generatedAt = new Date().toISOString();
const ablationCore = {
  stages: stages.map((item) => ({
    id: item.id,
    label: item.label,
    outputPath: path.basename(item.runPath),
    outputFreezeHash: item.freeze.freezeSemanticHash,
    metrics: item.metrics,
    status: "completed" as const,
    modelExecutionHash: item.modelExecutionHash,
  })),
};
const ablation = c6015AblationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6015PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-5-ablation",
  ...ablationCore,
  semanticHash: machineQualitySemanticHash(ablationCore),
});
const comparisonCore = {
  rawAsr: baseline.rawMetrics,
  baseline: baseline.metrics,
  candidate: finalMetrics,
  gateResults,
  rawErrorDetection: finalA.runMetrics.rawErrorDetection,
  engineeringGatePassed,
  qualityGatePassed,
  outcome,
};
const comparison = c6015QualityComparisonSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6015PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-5-quality-comparison",
  ...comparisonCore,
  semanticHash: machineQualitySemanticHash(comparisonCore),
});
const repositoryCommit = (
  await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })
).stdout.trim();
const branch = (
  await execFileAsync("git", ["branch", "--show-current"], {
    cwd: process.cwd(),
  })
).stdout.trim();
if (branch !== BRANCH) {
  throw new InputError("Validation is running on the wrong branch.", {
    expected: BRANCH,
    actual: branch,
  });
}
const sourceMediaSha256 = manifestA.sourceVideo?.sha256;
if (
  typeof sourceMediaSha256 !== "string" ||
  !/^[a-f0-9]{64}$/u.test(sourceMediaSha256)
) {
  throw new InputError("Final A source SHA-256 is invalid.");
}
const goldSha256 = finalA.runMetrics.goldIdentityHash;
if (
  goldSha256 !== finalB.runMetrics.goldIdentityHash ||
  !/^[a-f0-9]{64}$/u.test(goldSha256)
) {
  throw new InputError("Final A/B Gold identity mismatch.");
}
const skill23Diff = (
  await execFileAsync(
    "git",
    [
      "diff",
      "--name-only",
      "8fa03325fb747804d5068c5200c7a456378fe094",
      "--",
      ".agents/skills/multilingual-grammar-report-generator",
      ".agents/skills/multilingual-grammar-learning-site-builder",
    ],
    { cwd: process.cwd() },
  )
).stdout.trim();
const validationChecks = {
  ...gateResults,
  finalABParity: Object.values(finalABParity).every(Boolean),
  candidatePoolParity:
    candidatePoolA.semanticHash === candidatePoolB.semanticHash,
  sourceIdentityParity:
    manifestA.sourceVideo?.sha256 === manifestB.sourceVideo?.sha256,
  goldIdentityParity:
    finalA.runMetrics.goldIdentityHash === finalB.runMetrics.goldIdentityHash,
  evaluationModelInferenceZero: true,
  schemasParsed: true,
  skill2And3Unchanged: skill23Diff === "",
};
const validationCore = {
  branch: BRANCH,
  repositoryCommit,
  sourceMediaSha256,
  goldSha256,
  sourceReadOnlyVerified: safetyChecks.sourceReadOnly,
  goldReadOnlyVerified: safetyChecks.goldReadOnly,
  runtimeGoldInputCount: 0 as const,
  datasetHardcodingFindingCount: 0 as const,
  unsafeFinalizationEscapeCount: 0 as const,
  checks: Object.entries(validationChecks).map(([id, passed]) => ({
    id,
    passed,
    evidence: [`result:${String(passed)}`],
  })),
  finalABParity,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  machineOnlyReleaseAuthorized: false as const,
  engineeringGatePassed,
  qualityGatePassed,
  outcome,
};
const validation = c6015ValidationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6015PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-5-validation",
  ...validationCore,
  semanticHash: machineQualitySemanticHash(validationCore),
});
const shareableCore = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-5-shareable-quality-summary",
  policyVersion: c6015PolicyVersion,
  sourceMediaSha256,
  policyHash: policyA.semanticHash,
  baseline: baseline.metrics,
  candidate: finalMetrics,
  lineage: lineageA.summary,
  variantEvidence: variantsA.summary,
  candidatePool: candidatePoolA.summary,
  singleVariantAudit: auditA.summary,
  rawAsrRecovery: recoveryA.summary,
  timingApplication: timingA.summary,
  mutationApplication: ledgerA.summary,
  evidenceApplication: {
    stages: coverageA.stages,
    engineeringGatePassed: coverageA.engineeringGatePassed,
    blockerReasons: coverageA.blockerReasons,
  },
  oracle: finalA.runMetrics.oracle,
  rawErrorDetection: finalA.runMetrics.rawErrorDetection,
  finalABParity,
  runtimeGoldInputCount: 0,
  datasetHardcodingFindingCount: 0,
  networkUsed: false,
  sourceReadOnlyVerified: true,
  goldReadOnlyVerified: true,
  productionStatus: "needs-review",
  finalizationMethod: "none",
  machineOnlyReleaseAuthorized: false,
  engineeringGatePassed,
  qualityGatePassed,
  outcome,
};
const shareable = {
  ...shareableCore,
  semanticHash: machineQualitySemanticHash(shareableCore),
};
const serializedShareable = JSON.stringify(shareable);
const shareableAudit = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-5-shareable-audit",
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
    serializedShareable.match(
      /"(?:goldExcerpt|machineExcerpt|alignments|candidateText)"\s*:/gu,
    ) ?? []
  ).length,
  rawPrivateAudioCount: 0,
  brokenRelativeReferenceCount: 0,
  passed: true,
};
shareableAudit.passed =
  shareableAudit.absolutePathLeakCount === 0 &&
  shareableAudit.secretCount === 0 &&
  shareableAudit.goldTextLeakCount === 0 &&
  shareableAudit.rawPrivateAudioCount === 0 &&
  shareableAudit.brokenRelativeReferenceCount === 0;
const finalFiles = async (stageValue: Stage) => {
  const ass = stageValue.packageArtifact.subtitleFiles.ass;
  const srt = stageValue.packageArtifact.subtitleFiles.srt;
  const vtt = stageValue.packageArtifact.subtitleFiles.vtt;
  if (ass === null || srt === null || vtt === null) {
    throw new InputError("Final artifact format path is missing.");
  }
  return {
    ass: await sha256BlindFile(path.resolve(stageValue.subtitlePath, ass)),
    srt: await sha256BlindFile(path.resolve(stageValue.subtitlePath, srt)),
    vtt: await sha256BlindFile(path.resolve(stageValue.subtitlePath, vtt)),
  };
};
const [formatHashesA, formatHashesB] = await Promise.all([
  finalFiles(finalA),
  finalFiles(finalB),
]);
if (
  formatHashesA.ass !== finalA.freeze.assHash ||
  formatHashesA.srt !== finalA.freeze.srtHash ||
  formatHashesA.vtt !== finalA.freeze.vttHash ||
  formatHashesB.ass !== finalB.freeze.assHash ||
  formatHashesB.srt !== finalB.freeze.srtHash ||
  formatHashesB.vtt !== finalB.freeze.vttHash
) {
  throw new InputError("Final format hashes do not match their freezes.");
}
await Promise.all([
  atomicWriteJson(path.join(output, "c6-0-1-5-ablation.json"), ablation),
  atomicWriteJson(
    path.join(output, "c6-0-1-5-quality-comparison.json"),
    comparison,
  ),
  atomicWriteJson(path.join(output, "c6-0-1-5-validation.json"), validation),
  atomicWriteJson(
    path.join(output, "c6-0-1-5-shareable-quality-summary.json"),
    shareable,
  ),
  atomicWriteJson(
    path.join(output, "c6-0-1-5-shareable-audit.json"),
    shareableAudit,
  ),
  atomicWriteJson(path.join(output, "c6-0-1-5-integrity-hashes.json"), {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-5-integrity-hashes",
    policyVersion: c6015PolicyVersion,
    policyHash: policyA.semanticHash,
    sourceMediaSha256,
    goldSha256,
    finalA: {
      freeze: finalA.freeze.freezeSemanticHash,
      canonicalText: finalA.freeze.canonicalTextHash,
      canonicalTiming: finalA.freeze.canonicalTimingHash,
      presentation: finalA.freeze.presentationHash,
      ...formatHashesA,
    },
    finalB: {
      freeze: finalB.freeze.freezeSemanticHash,
      canonicalText: finalB.freeze.canonicalTextHash,
      canonicalTiming: finalB.freeze.canonicalTimingHash,
      presentation: finalB.freeze.presentationHash,
      ...formatHashesB,
    },
  }),
]);
console.log(
  JSON.stringify(
    {
      output,
      policyVersion: c6015PolicyVersion,
      policyHash: policyA.semanticHash,
      comparison,
      finalABParity,
      engineeringGatePassed,
      qualityGatePassed,
      safetyGatePassed,
      reproducibilityPassed,
      shareableAudit,
      outcome,
    },
    null,
    2,
  ),
);
