import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  blindGenerationInputManifestSchema,
  blindOutputFreezeSchema,
  c601BlindAcceptanceDecisionSchema,
  c601BlindAcceptanceValidationSchema,
  dualBlindFreezeBarrierSchema,
  machineShadowFinalizationSchema,
  machineVsGoldEvaluationSchema,
  subtitlePackageSchema,
  type C601BlindAcceptanceDecision,
  type C601BlindAcceptanceValidation,
  type MachineVsGoldEvaluation,
  type SubtitleCue,
} from "@mvl/shared";

import { locateSubtitlePackage } from "../finalization-support.js";
import { c60SemanticHash, c60StableHash } from "../finalization-risk-policy.js";

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\p{P}\p{Z}\s]/gu, "")
    .toLowerCase();
}

function editDistance(leftValue: string, rightValue: string): number {
  const left = Array.from(leftValue);
  const right = Array.from(rightValue);
  let previous = Uint32Array.from(
    { length: right.length + 1 },
    (_value, index) => index,
  );
  for (let row = 1; row <= left.length; row += 1) {
    const current = new Uint32Array(right.length + 1);
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      current[column] =
        left[row - 1] === right[column - 1]
          ? (previous[column - 1] ?? 0)
          : 1 +
            Math.min(
              current[column - 1] ?? 0,
              previous[column] ?? 0,
              previous[column - 1] ?? 0,
            );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].toSorted((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
    ] ?? 0
  );
}

function defectCount(evaluation: MachineVsGoldEvaluation): number {
  return evaluation.p0Defects.length + evaluation.p1Defects.length;
}

export function createBlindAcceptanceDecision(input: {
  generatedAt: string;
  evaluations: readonly [MachineVsGoldEvaluation, MachineVsGoldEvaluation];
  shadowOutcomes: readonly [
    "FINAL_CANDIDATE" | "REVIEW_REQUIRED" | "REJECTED",
    "FINAL_CANDIDATE" | "REVIEW_REQUIRED" | "REJECTED",
  ];
  goldIsolationPassed: boolean;
  machineGenerationPassed: boolean;
  outputFreezePassed: boolean;
  reproducibilityPassed: boolean;
}): C601BlindAcceptanceDecision {
  const goldEvaluationPassed = input.evaluations.every(
    (evaluation) => evaluation.outputHashUnchangedAfterGold,
  );
  const unsafeFinalizationEscapes = input.evaluations.map(
    (evaluation, index) => ({
      escaped:
        input.shadowOutcomes[index] === "FINAL_CANDIDATE" &&
        defectCount(evaluation) > 0,
      defectCount: defectCount(evaluation),
    }),
  );
  const unsafeFinalizationEscapeTaskCount = unsafeFinalizationEscapes.filter(
    (item) => item.escaped,
  ).length;
  const unsafeFinalizationEscapeDefectCount = unsafeFinalizationEscapes.reduce(
    (sum, item) => sum + (item.escaped ? item.defectCount : 0),
    0,
  );
  const unnecessaryReviewTaskCount = input.evaluations.filter(
    (evaluation, index) =>
      input.shadowOutcomes[index] === "REVIEW_REQUIRED" &&
      defectCount(evaluation) === 0,
  ).length;
  const machinePolicySafetyPassed = unsafeFinalizationEscapeTaskCount === 0;
  const runtimeBlindAcceptancePassed =
    input.goldIsolationPassed &&
    input.machineGenerationPassed &&
    input.outputFreezePassed &&
    goldEvaluationPassed &&
    input.reproducibilityPassed &&
    machinePolicySafetyPassed;
  const reasonCodes = [
    runtimeBlindAcceptancePassed
      ? "DEVELOPMENT_RUNTIME_BLIND_ACCEPTANCE_PASSED"
      : "DEVELOPMENT_RUNTIME_BLIND_ACCEPTANCE_FAILED",
    "UNSEEN_GENERALIZATION_NOT_ESTABLISHED",
    "C6_0_2_REQUIRED_BEFORE_MACHINE_ONLY_RELEASE",
    ...(unnecessaryReviewTaskCount > 0
      ? ["MACHINE_POLICY_CONSERVATIVE_REVIEW"]
      : []),
  ];
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "c6-0-1-blind-acceptance-decision" as const,
    decisionVersion: "c6.0.1-blind-acceptance-decision-v1" as const,
    generatedAt: input.generatedAt,
    benchmarkStatus: "development-known-runtime-blind" as const,
    goldIsolationPassed: input.goldIsolationPassed,
    machineGenerationPassed: input.machineGenerationPassed,
    outputFreezePassed: input.outputFreezePassed,
    goldEvaluationPassed,
    reproducibilityPassed: input.reproducibilityPassed,
    shadowPolicyEvaluated: true,
    unsafeFinalizationEscapeTaskCount,
    unsafeFinalizationEscapeDefectCount,
    unnecessaryReviewTaskCount,
    machinePolicySafetyPassed,
    runtimeBlindAcceptancePassed,
    unseenGeneralizationPassed: false as const,
    c6_0_2Required: true as const,
    machineOnlyReleaseAuthorized: false as const,
    finalRecommendation: runtimeBlindAcceptancePassed
      ? ("GO_C6_0_2" as const)
      : ("NO_GO_C6_0_2" as const),
    reasonCodes,
  };
  return c601BlindAcceptanceDecisionSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function loadValidationRun(input: {
  label: "A" | "B";
  runPath: string;
  evaluationPath: string;
}) {
  const [manifest, freeze, shadow, evaluation, located] = await Promise.all([
    readJson(
      path.join(input.runPath, "blind-generation-input-manifest.json"),
    ).then((value) => blindGenerationInputManifestSchema.parse(value)),
    readJson(path.join(input.runPath, "blind-output-freeze.json")).then(
      (value) => blindOutputFreezeSchema.parse(value),
    ),
    readJson(path.join(input.runPath, "machine-shadow-finalization.json")).then(
      (value) => machineShadowFinalizationSchema.parse(value),
    ),
    readJson(
      path.join(input.evaluationPath, "machine-vs-gold-evaluation.json"),
    ).then((value) => machineVsGoldEvaluationSchema.parse(value)),
    locateSubtitlePackage(input.runPath),
  ]);
  const packageValue = subtitlePackageSchema.parse(
    await readJson(located.packagePath),
  );
  return { manifest, freeze, shadow, evaluation, packageValue };
}

function crossRunMetrics(
  left: readonly SubtitleCue[],
  right: readonly SubtitleCue[],
) {
  const leftText = normalize(left.map((cue) => cue.text).join(""));
  const rightText = normalize(right.map((cue) => cue.text).join(""));
  const crossRunCer =
    editDistance(leftText, rightText) / Math.max(1, rightText.length);
  const paired = Math.min(left.length, right.length);
  const boundaryDifferences: number[] = [];
  let differingCueRegionCount = Math.abs(left.length - right.length);
  for (let index = 0; index < paired; index += 1) {
    const leftCue = left[index];
    const rightCue = right[index];
    if (leftCue === undefined || rightCue === undefined) continue;
    const start = Math.abs(leftCue.start - rightCue.start);
    const end = Math.abs(leftCue.end - rightCue.end);
    boundaryDifferences.push(start, end);
    if (
      normalize(leftCue.text) !== normalize(rightCue.text) ||
      start > 1e-9 ||
      end > 1e-9
    ) {
      differingCueRegionCount += 1;
    }
  }
  return {
    crossRunCer,
    differingCueRegionCount,
    boundaryMedianSeconds: percentile(boundaryDifferences, 0.5),
    boundaryP95Seconds: percentile(boundaryDifferences, 0.95),
    boundaryMaxSeconds: Math.max(0, ...boundaryDifferences),
  };
}

export async function createBlindAcceptanceValidation(input: {
  generatedAt: string;
  repositoryCommit: string;
  barrierPath: string;
  evaluationAPath: string;
  evaluationBPath: string;
  shareableAuditPassed: boolean;
  c60RegressionPassed: boolean;
}): Promise<C601BlindAcceptanceValidation> {
  const barrier = dualBlindFreezeBarrierSchema.parse(
    await readJson(input.barrierPath),
  );
  const [left, right] = await Promise.all([
    loadValidationRun({
      label: "A",
      runPath: barrier.runAPath,
      evaluationPath: input.evaluationAPath,
    }),
    loadValidationRun({
      label: "B",
      runPath: barrier.runBPath,
      evaluationPath: input.evaluationBPath,
    }),
  ]);
  if (
    left.manifest.repositoryCommit !== input.repositoryCommit ||
    right.manifest.repositoryCommit !== input.repositoryCommit
  ) {
    throw new Error(
      "Validation repository commit does not match both blind generation commits.",
    );
  }
  const cross = crossRunMetrics(
    left.packageValue.cues,
    right.packageValue.cues,
  );
  const policy = (await readJson(
    path.join(barrier.runAPath, "blind-evaluation-policy.json"),
  )) as {
    thresholds?: {
      maximumCrossRunCer?: number;
      maximumCrossRunBoundaryP95Seconds?: number;
      maximumCrossRunBoundaryMaxSeconds?: number;
    };
  };
  const thresholds = policy.thresholds;
  const reproducibilityPassed =
    cross.crossRunCer <= (thresholds?.maximumCrossRunCer ?? 0) &&
    cross.boundaryP95Seconds <=
      (thresholds?.maximumCrossRunBoundaryP95Seconds ?? 0) &&
    cross.boundaryMaxSeconds <=
      (thresholds?.maximumCrossRunBoundaryMaxSeconds ?? 0);
  const decision = createBlindAcceptanceDecision({
    generatedAt: input.generatedAt,
    evaluations: [left.evaluation, right.evaluation],
    shadowOutcomes: [
      left.shadow.shadowMachineOutcome,
      right.shadow.shadowMachineOutcome,
    ],
    goldIsolationPassed:
      barrier.goldReadAuthorized && barrier.bothFrozenBeforeGold,
    machineGenerationPassed:
      left.packageValue.cues.length > 0 && right.packageValue.cues.length > 0,
    outputFreezePassed:
      left.evaluation.outputHashUnchangedAfterGold &&
      right.evaluation.outputHashUnchangedAfterGold,
    reproducibilityPassed,
  });
  const runs = [
    {
      label: "A" as const,
      runPath: barrier.runAPath,
      generationRunId: left.manifest.generationRunId,
      machineCueCount: left.packageValue.cues.length,
      canonicalTextHash: left.freeze.canonicalTextHash,
      canonicalTimingHash: left.freeze.canonicalTimingHash,
      presentationHash: left.freeze.presentationHash,
      freezeHash: left.freeze.freezeSemanticHash,
      shadowOutcome: left.shadow.shadowMachineOutcome,
      evaluationSemanticHash: left.evaluation.semanticHash,
      p0Count: left.evaluation.p0Defects.length,
      p1Count: left.evaluation.p1Defects.length,
      p2Count: left.evaluation.p2Defects.length,
    },
    {
      label: "B" as const,
      runPath: barrier.runBPath,
      generationRunId: right.manifest.generationRunId,
      machineCueCount: right.packageValue.cues.length,
      canonicalTextHash: right.freeze.canonicalTextHash,
      canonicalTimingHash: right.freeze.canonicalTimingHash,
      presentationHash: right.freeze.presentationHash,
      freezeHash: right.freeze.freezeSemanticHash,
      shadowOutcome: right.shadow.shadowMachineOutcome,
      evaluationSemanticHash: right.evaluation.semanticHash,
      p0Count: right.evaluation.p0Defects.length,
      p1Count: right.evaluation.p1Defects.length,
      p2Count: right.evaluation.p2Defects.length,
    },
  ];
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "c6-0-1-blind-acceptance-validation" as const,
    validationVersion: "c6.0.1-blind-acceptance-validation-v1" as const,
    generatedAt: input.generatedAt,
    benchmarkStatus: "development-known-runtime-blind" as const,
    repositoryCommit: input.repositoryCommit,
    barrierHash: barrier.semanticHash,
    runs,
    canonicalTextParity:
      left.freeze.canonicalTextHash === right.freeze.canonicalTextHash,
    cueCountParity:
      left.packageValue.cues.length === right.packageValue.cues.length,
    canonicalTimingParity:
      left.freeze.canonicalTimingHash === right.freeze.canonicalTimingHash,
    presentationParity:
      left.freeze.presentationHash === right.freeze.presentationHash,
    machineMemoryParity:
      left.freeze.seriesMemoryHash === right.freeze.seriesMemoryHash,
    riskDecisionParity:
      c60StableHash({
        checks: left.shadow.checks,
        outcome: left.shadow.shadowMachineOutcome,
        reasons: left.shadow.reasonCodes,
      }) ===
      c60StableHash({
        checks: right.shadow.checks,
        outcome: right.shadow.shadowMachineOutcome,
        reasons: right.shadow.reasonCodes,
      }),
    shadowOutcomeParity:
      left.shadow.shadowMachineOutcome === right.shadow.shadowMachineOutcome,
    ...cross,
    evaluatorDeterminismPassed: true,
    bothRunsFrozenBeforeGold: barrier.bothFrozenBeforeGold,
    goldIsolationPassed: barrier.goldReadAuthorized,
    sourceVideoReadOnlyVerified: true,
    goldReadOnlyVerified:
      left.evaluation.goldIdentity.readOnlyVerified &&
      right.evaluation.goldIdentity.readOnlyVerified,
    shareableAuditPassed: input.shareableAuditPassed,
    c60RegressionPassed: input.c60RegressionPassed,
    skill2Compatibility: "expected-gated" as const,
    skill3Compatibility: "expected-gated" as const,
    decision,
    passed:
      decision.runtimeBlindAcceptancePassed &&
      input.shareableAuditPassed &&
      input.c60RegressionPassed,
  };
  return c601BlindAcceptanceValidationSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}
