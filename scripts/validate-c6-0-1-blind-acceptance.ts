import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  atomicWriteJson,
  InputError,
  machineVsGoldEvaluationSchema,
} from "@mvl/shared";
import { createBlindAcceptanceValidation } from "@mvl/video-subtitler";

const execFileAsync = promisify(execFile);

function parseArguments(argv: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined)
      throw new InputError("Invalid validation arguments.");
    result.set(flag, value);
  }
  return result;
}

function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined) throw new InputError(`Missing ${flag}.`);
  return value;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function shareableSummary(
  label: "A" | "B",
  evaluation: ReturnType<typeof machineVsGoldEvaluationSchema.parse>,
) {
  return {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-shareable-evaluation-summary",
    label,
    benchmarkStatus: evaluation.benchmarkStatus,
    generationRunId: evaluation.generationRunId,
    sourceVideo: evaluation.sourceIdentity,
    machineFreezeHash: evaluation.machineFreezeHash,
    goldIdentity: {
      size: evaluation.goldIdentity.size,
      sha256: evaluation.goldIdentity.sha256,
      cueCount: evaluation.goldIdentity.cueCount,
      readOnlyVerified: evaluation.goldIdentity.readOnlyVerified,
    },
    evaluationPolicyVersion: evaluation.evaluationPolicyVersion,
    evaluationPolicyHash: evaluation.evaluationPolicyHash,
    globalTextMetrics: evaluation.globalTextMetrics,
    alignmentMetrics: evaluation.alignmentMetrics,
    timingMetrics: evaluation.timingMetrics,
    coverageMetrics: evaluation.coverageMetrics,
    defectCounts: {
      p0: evaluation.p0Defects.length,
      p1: evaluation.p1Defects.length,
      p2: evaluation.p2Defects.length,
      missingDialogue: evaluation.missingDialogueCandidates.length,
      hallucination: evaluation.hallucinationCandidates.length,
      materialText: evaluation.materialTextErrors.length,
      severeTiming: evaluation.severeTimingErrors.length,
    },
    modelInferenceCount: evaluation.modelInferenceCount,
    outputHashUnchangedAfterGold: evaluation.outputHashUnchangedAfterGold,
    goldMutationCount: evaluation.goldMutationCount,
    semanticHash: evaluation.semanticHash,
  };
}

function auditShareable(value: unknown): {
  absolutePathLeakCount: number;
  secretCount: number;
  goldTextLeakCount: number;
  passed: boolean;
} {
  const serialized = JSON.stringify(value);
  const absolutePathLeakCount = (
    serialized.match(/(?:\/Users\/|[A-Za-z]:\\\\)/gu) ?? []
  ).length;
  const secretCount = (
    serialized.match(
      /(?:sk-[A-Za-z0-9_-]{16,}|api[_-]?key|bearer\s+[A-Za-z0-9._-]{12,})/giu,
    ) ?? []
  ).length;
  const goldTextLeakCount = (
    serialized.match(/(?:goldExcerpt|machineExcerpt|alignments)/gu) ?? []
  ).length;
  return {
    absolutePathLeakCount,
    secretCount,
    goldTextLeakCount,
    passed:
      absolutePathLeakCount === 0 &&
      secretCount === 0 &&
      goldTextLeakCount === 0,
  };
}

const args = parseArguments(process.argv.slice(2));
const barrierPath = path.resolve(required(args, "--barrier"));
const evaluationAPath = path.resolve(required(args, "--evaluation-a"));
const evaluationBPath = path.resolve(required(args, "--evaluation-b"));
const outputPath = path.resolve(required(args, "--output"));
const c60RegressionPassed = required(args, "--c6-regression-passed") === "true";
const [evaluationA, evaluationB] = await Promise.all([
  readJson(path.join(evaluationAPath, "machine-vs-gold-evaluation.json")).then(
    (value) => machineVsGoldEvaluationSchema.parse(value),
  ),
  readJson(path.join(evaluationBPath, "machine-vs-gold-evaluation.json")).then(
    (value) => machineVsGoldEvaluationSchema.parse(value),
  ),
]);
const shareableA = shareableSummary("A", evaluationA);
const shareableB = shareableSummary("B", evaluationB);
const auditA = auditShareable(shareableA);
const auditB = auditShareable(shareableB);
const shareableAudit = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-shareable-audit",
  generatedAt: new Date().toISOString(),
  artifactCount: 2,
  absolutePathLeakCount:
    auditA.absolutePathLeakCount + auditB.absolutePathLeakCount,
  secretCount: auditA.secretCount + auditB.secretCount,
  goldTextLeakCount: auditA.goldTextLeakCount + auditB.goldTextLeakCount,
  brokenRelativeReferenceCount: 0,
  passed: auditA.passed && auditB.passed,
};
await mkdir(path.join(outputPath, "shareable", "A"), { recursive: true });
await mkdir(path.join(outputPath, "shareable", "B"), { recursive: true });
await Promise.all([
  atomicWriteJson(
    path.join(outputPath, "shareable", "A", "c6-0-1-shareable-summary.json"),
    shareableA,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(outputPath, "shareable", "B", "c6-0-1-shareable-summary.json"),
    shareableB,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(outputPath, "c6-0-1-shareable-audit.json"),
    shareableAudit,
    { overwrite: true },
  ),
]);
const repositoryCommit = (
  await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })
).stdout.trim();
const validation = await createBlindAcceptanceValidation({
  generatedAt: new Date().toISOString(),
  repositoryCommit,
  barrierPath,
  evaluationAPath,
  evaluationBPath,
  shareableAuditPassed: shareableAudit.passed,
  c60RegressionPassed,
});
await Promise.all([
  atomicWriteJson(
    path.join(outputPath, "c6-0-1-blind-acceptance-decision.json"),
    validation.decision,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(outputPath, "c6-0-1-blind-acceptance-validation.json"),
    validation,
    { overwrite: true },
  ),
]);
if (!validation.passed) {
  throw new InputError("C6.0.1 blind acceptance validation did not pass.", {
    decision: validation.decision.finalRecommendation,
    c60RegressionPassed,
    shareableAuditPassed: shareableAudit.passed,
  });
}
console.log(JSON.stringify(validation, null, 2));
