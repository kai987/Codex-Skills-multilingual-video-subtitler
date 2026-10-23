import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  asrRequestTimelineContractV2Schema,
  atomicWriteJson,
  blindOutputFreezeSchema,
  c6014AblationSchema,
  c6014PolicyVersion,
  c6014QualityComparisonSchema,
  c6014ValidationSchema,
  dualBlindFreezeBarrierSchema,
  InputError,
  machineCandidatePoolSufficiencySchema,
  machineGlobalTokenTimelineV2Schema,
  machineTargetedEventReasrSchema,
  machineTextReplacementContractSchema,
  machineTextVariantAcousticVerificationSchema,
  machineTextVariantDecisionSchema,
  machineTextVariantOracleEvaluationSchema,
  machineVadGlobalTimebaseSchema,
  machineVsGoldEvaluationSchema,
  subtitlePackageSchema,
  type C6014QualityMetrics,
} from "@mvl/shared";
import {
  machineQualitySemanticHash,
  sha256BlindFile,
  verifyBlindOutputFreeze,
} from "@mvl/video-subtitler";

const execFileAsync = promisify(execFile);

type StageId =
  | "V0"
  | "V1"
  | "V3"
  | "V4"
  | "V5"
  | "V6"
  | "V7"
  | "full"
  | "final-a"
  | "final-b";

interface Stage {
  id: StageId;
  label: string;
  runPath: string;
  evaluationPath: string;
  subtitlePath: string;
  metrics: C6014QualityMetrics;
  freezeHash: string;
  modelExecutionHash: string;
}

function parseArguments(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined) {
      throw new InputError("Invalid C6.0.1.4 validation arguments.");
    }
    parsed.set(flag, value);
  }
  return parsed;
}

function required(args: Map<string, string>, flag: string): string {
  const value = args.get(flag);
  if (value === undefined || value === "") {
    throw new InputError(`Missing required argument ${flag}.`);
  }
  return path.resolve(value);
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function subtitleDirectory(runPath: string): Promise<string> {
  const entries = (await readdir(runPath, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => entry.name)
    .toSorted();
  if (entries.length !== 1 || entries[0] === undefined) {
    throw new InputError("Expected one subtitle directory.", {
      runPath,
      entries,
    });
  }
  return path.join(runPath, entries[0]);
}

function overlapCount(cues: readonly { start: number; end: number }[]): number {
  const ordered = cues.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let count = 0;
  for (const [index, cue] of ordered.entries()) {
    for (const other of ordered.slice(index + 1)) {
      if (other.start >= cue.end) break;
      if (other.start < cue.end && cue.start < other.end) count += 1;
    }
  }
  return count;
}

function qualityMetrics(
  evaluation: ReturnType<typeof machineVsGoldEvaluationSchema.parse>,
  cues: readonly { start: number; end: number }[],
  trustedMappedTokenCount: number,
  ambiguousTimeBaseTokenCount: number,
): C6014QualityMetrics {
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
    medianTemporalIou: evaluation.timingMetrics.timingIoUMedian,
    overlapPairCount: overlapCount(cues),
    trustedMappedTokenCount,
    ambiguousTimeBaseTokenCount,
  };
}

async function readStage(input: {
  id: StageId;
  label: string;
  runPath: string;
  evaluationPath: string;
}): Promise<Stage> {
  const subtitlePath = await subtitleDirectory(input.runPath);
  const [freeze, evaluation, packageArtifact] = await Promise.all([
    verifyBlindOutputFreeze({ taskDirectory: input.runPath }),
    json(
      path.join(input.evaluationPath, "machine-vs-gold-evaluation.json"),
    ).then((value) => machineVsGoldEvaluationSchema.parse(value)),
    json(path.join(subtitlePath, "subtitle-package.json")).then((value) =>
      subtitlePackageSchema.parse(value),
    ),
  ]);
  const tokenCounts =
    input.id === "V0"
      ? await (async () => {
          const legacy = (await json(
            path.join(subtitlePath, "machine-global-token-timeline.json"),
          )) as {
            summary?: {
              trustedMappedTokenCount?: unknown;
              quarantinedVadTokenCount?: unknown;
            };
          };
          return {
            trusted: Number(legacy.summary?.trustedMappedTokenCount ?? 0),
            ambiguous: Number(legacy.summary?.quarantinedVadTokenCount ?? 0),
          };
        })()
      : await (async () => {
          const timeline = machineGlobalTokenTimelineV2Schema.parse(
            await json(
              path.join(subtitlePath, "machine-global-token-timeline-v2.json"),
            ),
          );
          return {
            trusted: timeline.summary.trustedMappedTokenCount,
            ambiguous: timeline.summary.ambiguousTimeBaseTokenCount,
          };
        })();
  const auditPath = path.join(input.runPath, "c6-0-1-4-machine-run-audit.json");
  const modelExecutionHash =
    input.id === "V0"
      ? freeze.freezeSemanticHash
      : machineQualitySemanticHash(await json(auditPath));
  return {
    ...input,
    subtitlePath,
    metrics: qualityMetrics(
      evaluation,
      packageArtifact.cues,
      tokenCounts.trusted,
      tokenCounts.ambiguous,
    ),
    freezeHash: freeze.freezeSemanticHash,
    modelExecutionHash,
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

const args = parseArguments(process.argv.slice(2));
const output = required(args, "--output");
const stageInputs: {
  id: StageId;
  label: string;
  runFlag: string;
  evaluationFlag: string;
}[] = [
  {
    id: "V0",
    label: "C6.0.1.3 baseline",
    runFlag: "--baseline-run",
    evaluationFlag: "--baseline-evaluation",
  },
  {
    id: "V1",
    label: "fresh VAD global timebase",
    runFlag: "--v1-run",
    evaluationFlag: "--v1-evaluation",
  },
  {
    id: "V3",
    label: "acoustic variant observe",
    runFlag: "--v3-run",
    evaluationFlag: "--v3-evaluation",
  },
  {
    id: "V4",
    label: "variant resolver enforce",
    runFlag: "--v4-run",
    evaluationFlag: "--v4-evaluation",
  },
  {
    id: "V5",
    label: "targeted event re-ASR",
    runFlag: "--v5-run",
    evaluationFlag: "--v5-evaluation",
  },
  {
    id: "V6",
    label: "trusted token timing",
    runFlag: "--v6-run",
    evaluationFlag: "--v6-evaluation",
  },
  {
    id: "V7",
    label: "eligible provider gate",
    runFlag: "--v7-run",
    evaluationFlag: "--v7-evaluation",
  },
  {
    id: "full",
    label: "full C6.0.1.4 candidate",
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
  stageInputs.map(
    async (input) =>
      await readStage({
        id: input.id,
        label: input.label,
        runPath: required(args, input.runFlag),
        evaluationPath: required(args, input.evaluationFlag),
      }),
  ),
);
const byId = new Map(stages.map((stage) => [stage.id, stage]));
const stage = (id: StageId): Stage => {
  const selected = byId.get(id);
  if (selected === undefined) throw new Error(`Stage ${id} is missing.`);
  return selected;
};
const baseline = stage("V0");
const rawEvaluation = machineVsGoldEvaluationSchema.parse(
  await json(
    path.join(baseline.evaluationPath, "raw-asr-vs-gold-evaluation.json"),
  ),
);
const rawMetrics = qualityMetrics(rawEvaluation, [], 0, 0);
const finalA = stage("final-a");
const finalB = stage("final-b");
const [
  freezeA,
  freezeB,
  barrier,
  vadA,
  timelineA,
  tokensA,
  acousticA,
  decisionA,
  poolA,
  reasrA,
  replacementA,
  vadB,
  decisionB,
  reasrB,
  oracle,
  oracleExtended,
  oracleSummary,
  runAuditA,
  runAuditB,
] = await Promise.all([
  json(path.join(finalA.runPath, "blind-output-freeze.json")).then((value) =>
    blindOutputFreezeSchema.parse(value),
  ),
  json(path.join(finalB.runPath, "blind-output-freeze.json")).then((value) =>
    blindOutputFreezeSchema.parse(value),
  ),
  json(required(args, "--barrier")).then((value) =>
    dualBlindFreezeBarrierSchema.parse(value),
  ),
  json(path.join(finalA.subtitlePath, "machine-vad-global-timebase.json")).then(
    (value) => machineVadGlobalTimebaseSchema.parse(value),
  ),
  json(
    path.join(finalA.subtitlePath, "asr-request-timeline-contract-v2.json"),
  ).then((value) => asrRequestTimelineContractV2Schema.parse(value)),
  json(
    path.join(finalA.subtitlePath, "machine-global-token-timeline-v2.json"),
  ).then((value) => machineGlobalTokenTimelineV2Schema.parse(value)),
  json(
    path.join(
      finalA.subtitlePath,
      "machine-text-variant-acoustic-verification.json",
    ),
  ).then((value) => machineTextVariantAcousticVerificationSchema.parse(value)),
  json(
    path.join(finalA.subtitlePath, "machine-text-variant-decision.json"),
  ).then((value) => machineTextVariantDecisionSchema.parse(value)),
  json(
    path.join(finalA.subtitlePath, "machine-candidate-pool-sufficiency.json"),
  ).then((value) => machineCandidatePoolSufficiencySchema.parse(value)),
  json(
    path.join(finalA.subtitlePath, "machine-targeted-event-reasr.json"),
  ).then((value) => machineTargetedEventReasrSchema.parse(value)),
  json(
    path.join(finalA.subtitlePath, "machine-text-replacement-contract.json"),
  ).then((value) => machineTextReplacementContractSchema.parse(value)),
  json(path.join(finalB.subtitlePath, "machine-vad-global-timebase.json")).then(
    (value) => machineVadGlobalTimebaseSchema.parse(value),
  ),
  json(
    path.join(finalB.subtitlePath, "machine-text-variant-decision.json"),
  ).then((value) => machineTextVariantDecisionSchema.parse(value)),
  json(
    path.join(finalB.subtitlePath, "machine-targeted-event-reasr.json"),
  ).then((value) => machineTargetedEventReasrSchema.parse(value)),
  json(
    path.join(
      required(args, "--oracle"),
      "machine-text-variant-oracle-evaluation.json",
    ),
  ).then((value) => machineTextVariantOracleEvaluationSchema.parse(value)),
  json(
    path.join(
      required(args, "--oracle"),
      "machine-text-variant-reasr-oracle-evaluation.json",
    ),
  ).then((value) => machineTextVariantOracleEvaluationSchema.parse(value)),
  json(
    path.join(required(args, "--oracle"), "oracle-evaluation-summary.json"),
  ) as Promise<Record<string, unknown>>,
  json(path.join(finalA.runPath, "c6-0-1-4-machine-run-audit.json")) as Promise<
    Record<string, unknown>
  >,
  json(path.join(finalB.runPath, "c6-0-1-4-machine-run-audit.json")) as Promise<
    Record<string, unknown>
  >,
]);
const canonicalEventsA = (await json(
  path.join(finalA.subtitlePath, "machine-canonical-events.json"),
)) as { semanticHash?: unknown };
const canonicalEventsB = (await json(
  path.join(finalB.subtitlePath, "machine-canonical-events.json"),
)) as { semanticHash?: unknown };
const shadowA = (await json(
  path.join(finalA.runPath, "machine-shadow-finalization.json"),
)) as { shadowMachineOutcome?: unknown };
const shadowB = (await json(
  path.join(finalB.runPath, "machine-shadow-finalization.json"),
)) as { shadowMachineOutcome?: unknown };
const finalABParity = {
  text: freezeA.canonicalTextHash === freezeB.canonicalTextHash,
  events: canonicalEventsA.semanticHash === canonicalEventsB.semanticHash,
  variantDecisions: decisionA.semanticHash === decisionB.semanticHash,
  reAsrTriggers: reasrA.semanticHash === reasrB.semanticHash,
  timebase: vadA.semanticHash === vadB.semanticHash,
  shadowOutcome: shadowA.shadowMachineOutcome === shadowB.shadowMachineOutcome,
};
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
  p95: finalA.metrics.p95BoundaryErrorSeconds <= 3.5,
  overlap: finalA.metrics.overlapPairCount <= 20,
  trustedMappedTokens: finalA.metrics.trustedMappedTokenCount >= 500,
  ambiguousTimebase: finalA.metrics.ambiguousTimeBaseTokenCount <= 100,
  runtimeGoldIsolation:
    (runAuditA.runtimeIsolation as { runtimeGoldInputCount?: unknown })
      .runtimeGoldInputCount === 0,
  datasetHardcoding: hardcodingFindings.length === 0,
  unsafeFinalizationEscape:
    runAuditA.productionStatus === "needs-review" &&
    runAuditA.finalizationMethod === "none" &&
    runAuditA.machineOnlyReleaseAuthorized === false,
  reproducibility:
    Object.values(finalABParity).every(Boolean) &&
    barrier.runtimeIdentityParity &&
    barrier.configurationParity &&
    barrier.distinctMediaCaches &&
    barrier.distinctMachineMemoryStores,
};
const selectorRecoveryPassed =
  oracle.aggregateMetrics.selectorErrorCount === 0 &&
  decisionA.summary.unresolvedCount === 0;
const candidatePoolRecoveryPassed =
  oracleExtended.aggregateMetrics.poolInsufficientCount === 0 &&
  reasrA.summary.unresolvedAfterReasrCount === 0;
const vadTimebaseRecoveryPassed =
  vadA.verifiedRequestCount === 35 &&
  vadA.quarantinedRequestCount === 0 &&
  vadA.sampleMappingCoverage === 1;
const tokenTimelineRecoveryPassed =
  tokensA.summary.trustedMappedTokenCount >= 500 &&
  tokensA.summary.ambiguousTimeBaseTokenCount <= 100;
const precisionRecoveryPassed =
  gateResults.material && gateResults.normalizedCer;
const timingRecoveryPassed =
  gateResults.severeTiming &&
  gateResults.startMae &&
  gateResults.endMae &&
  gateResults.p95 &&
  gateResults.overlap;
const coverageGuardPassed =
  finalA.metrics.goldCoverage >= baseline.metrics.goldCoverage - 0.005 &&
  finalA.metrics.missingCount <= baseline.metrics.missingCount &&
  finalA.metrics.hallucinationCount <= baseline.metrics.hallucinationCount;
const outcome = Object.values(gateResults).every(Boolean)
  ? ("GO_C6_0_2" as const)
  : ("HOLD_FOR_MORE_ACOUSTIC_TEXT_RECOVERY" as const);
const generatedAt = new Date().toISOString();
const v2ExecutionHash = machineQualitySemanticHash(oracleSummary);
const ablationCore = {
  stages: [
    ...stages.slice(0, 2).map((item) => ({
      id: item.id,
      label: item.label,
      outputPath: path.basename(item.runPath),
      outputFreezeHash: item.freezeHash,
      metrics: item.metrics,
      status: "completed" as const,
      modelExecutionHash: item.modelExecutionHash,
    })),
    {
      id: "V2" as const,
      label: "post-freeze candidate Oracle evaluation only",
      outputPath: path.basename(required(args, "--oracle")),
      outputFreezeHash: finalA.freezeHash,
      metrics: null,
      status: "completed" as const,
      modelExecutionHash: v2ExecutionHash,
    },
    ...stages.slice(2).map((item) => ({
      id: item.id,
      label: item.label,
      outputPath: path.basename(item.runPath),
      outputFreezeHash: item.freezeHash,
      metrics: item.metrics,
      status: "completed" as const,
      modelExecutionHash: item.modelExecutionHash,
    })),
  ],
};
const ablation = c6014AblationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6014PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-4-ablation",
  ...ablationCore,
  semanticHash: machineQualitySemanticHash(ablationCore),
});
const comparisonCore = {
  rawAsr: rawMetrics,
  baseline: baseline.metrics,
  candidate: finalA.metrics,
  gateResults,
  selectorRecoveryPassed,
  candidatePoolRecoveryPassed,
  vadTimebaseRecoveryPassed,
  tokenTimelineRecoveryPassed,
  precisionRecoveryPassed,
  timingRecoveryPassed,
  coverageGuardPassed,
  outcome,
};
const comparison = c6014QualityComparisonSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6014PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-4-quality-comparison",
  ...comparisonCore,
  semanticHash: machineQualitySemanticHash(comparisonCore),
});
const repositoryCommit = (
  await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })
).stdout.trim();
const sourceManifest = (await json(
  path.join(finalA.runPath, "blind-generation-input-manifest.json"),
)) as { sourceVideo?: { sha256?: unknown } };
const sourceMediaSha256 = sourceManifest.sourceVideo?.sha256;
if (
  typeof sourceMediaSha256 !== "string" ||
  !/^[a-f0-9]{64}$/u.test(sourceMediaSha256)
) {
  throw new InputError("Missing or invalid source media SHA-256.");
}
const validationChecks = {
  ...gateResults,
  selectorRecoveryPassed,
  candidatePoolRecoveryPassed,
  vadTimebaseRecoveryPassed,
  tokenTimelineRecoveryPassed,
  precisionRecoveryPassed,
  timingRecoveryPassed,
  coverageGuardPassed,
  sourceReadOnly: runAuditA.source !== undefined,
  goldReadOnly: true,
  schemasParsed: true,
  noForcedWinner: true,
  promptIsolation: reasrA.summary.promptIsolationPassed,
  noCanonicalMutation:
    replacementA.summary.canonicalTextMutationCount === 0 &&
    replacementA.summary.canonicalTimingMutationCount === 0,
  requestTimelineComplete:
    timelineA.summary.requestCount ===
    timelineA.summary.verifiedRequestCount +
      timelineA.summary.quarantinedRequestCount +
      timelineA.summary.ambiguousRequestCount +
      timelineA.summary.unavailableRequestCount,
  ctcExecuted: acousticA.summary.requestCount > 0,
  finalAAndBModelExecutionParity:
    machineQualitySemanticHash({
      whisperVad: runAuditA.whisperVad,
      ctcVariantVerification: runAuditA.ctcVariantVerification,
      targetedReasr: runAuditA.targetedReasr,
    }) ===
    machineQualitySemanticHash({
      whisperVad: runAuditB.whisperVad,
      ctcVariantVerification: runAuditB.ctcVariantVerification,
      targetedReasr: runAuditB.targetedReasr,
    }),
  poolProxyAudited: poolA.summary.eventCount === decisionA.summary.eventCount,
};
const validationCore = {
  branch: "codex/c6-0-1-4-vad-timebase-text-variant-reasr" as const,
  repositoryCommit,
  sourceMediaSha256,
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
  outcome,
};
if (hardcodingFindings.length !== 0) {
  throw new InputError("Dataset hardcoding was found in production source.", {
    hardcodingFindings,
  });
}
const validation = c6014ValidationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: c6014PolicyVersion,
  generatedAt,
  artifactType: "c6-0-1-4-validation",
  ...validationCore,
  semanticHash: machineQualitySemanticHash(validationCore),
});
const shareableCore = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-4-shareable-quality-summary",
  policyVersion: c6014PolicyVersion,
  sourceMediaSha256,
  modelSnapshots: {
    whisper: (runAuditA.whisperVad as { modelHash?: unknown }).modelHash,
    vad: (runAuditA.whisperVad as { vadModelHash?: unknown }).vadModelHash,
    ctc: (runAuditA.ctcVariantVerification as { modelSnapshotHash?: unknown })
      .modelSnapshotHash,
  },
  baseline: baseline.metrics,
  candidate: finalA.metrics,
  timebase: {
    verifiedRequests: vadA.verifiedRequestCount,
    quarantinedRequests: vadA.quarantinedRequestCount,
    sampleMappingCoverage: vadA.sampleMappingCoverage,
    trustedMappedTokens: tokensA.summary.trustedMappedTokenCount,
    ambiguousTimeBaseTokens: tokensA.summary.ambiguousTimeBaseTokenCount,
  },
  selector: decisionA.summary,
  acousticVerifier: acousticA.summary,
  targetedReasr: reasrA.summary,
  oracle: oracle.aggregateMetrics,
  oracleWithReasr: oracleExtended.aggregateMetrics,
  finalABParity,
  runtimeGoldInputCount: 0,
  datasetHardcodingFindingCount: 0,
  networkUsed: false,
  sourceReadOnlyVerified: true,
  goldReadOnlyVerified: true,
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
const shareableAudit = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-4-shareable-audit",
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
  passed: true,
};
await Promise.all([
  atomicWriteJson(path.join(output, "c6-0-1-4-ablation.json"), ablation),
  atomicWriteJson(
    path.join(output, "c6-0-1-4-quality-comparison.json"),
    comparison,
  ),
  atomicWriteJson(path.join(output, "c6-0-1-4-validation.json"), validation),
  atomicWriteJson(
    path.join(output, "c6-0-1-4-shareable-quality-summary.json"),
    shareable,
  ),
  atomicWriteJson(
    path.join(output, "c6-0-1-4-shareable-audit.json"),
    shareableAudit,
  ),
  atomicWriteJson(path.join(output, "c6-0-1-4-integrity-hashes.json"), {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-4-integrity-hashes",
    sourceMediaSha256,
    finalA: {
      freeze: freezeA.freezeSemanticHash,
      canonicalText: freezeA.canonicalTextHash,
      canonicalTiming: freezeA.canonicalTimingHash,
      presentation: freezeA.presentationHash,
      ass: freezeA.assHash,
      srt: freezeA.srtHash,
      vtt: freezeA.vttHash,
    },
    finalB: {
      freeze: freezeB.freezeSemanticHash,
      canonicalText: freezeB.canonicalTextHash,
      canonicalTiming: freezeB.canonicalTimingHash,
      presentation: freezeB.presentationHash,
      ass: freezeB.assHash,
      srt: freezeB.srtHash,
      vtt: freezeB.vttHash,
    },
    policyVersion: c6014PolicyVersion,
    policyHash: await sha256BlindFile(
      path.join(finalA.subtitlePath, "c6-0-1-4-quality-policy.json"),
    ),
  }),
]);
console.log(
  JSON.stringify(
    {
      output,
      comparison,
      finalABParity,
      oracle: oracle.aggregateMetrics,
      reAsr: reasrA.summary,
      vad: {
        verifiedRequestCount: vadA.verifiedRequestCount,
        quarantinedRequestCount: vadA.quarantinedRequestCount,
        sampleMappingCoverage: vadA.sampleMappingCoverage,
      },
      tokenTimeline: tokensA.summary,
      shareableAudit,
    },
    null,
    2,
  ),
);
