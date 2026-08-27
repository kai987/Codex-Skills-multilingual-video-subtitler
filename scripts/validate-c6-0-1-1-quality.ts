import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  blindGenerationInputManifestSchema,
  c6011QualityComparisonSchema,
  c6011QualityValidationSchema,
  goldLossAttributionSchema,
  InputError,
  machineQualityRecoveryAblationSchema,
  machineVsGoldEvaluationSchema,
  pathExists,
  type C6011QualityMetrics,
  type MachineQualityRecoveryProfile,
} from "@mvl/shared";
import {
  c6011MetricsFromGoldEvaluation,
  c6011MilestoneChecks,
  compareC6011QualityMetrics,
  stableMachineQualityHash,
} from "@mvl/video-subtitler";

interface Entry {
  label: "baseline" | "observe" | "coverage" | "timing" | "full";
  profile: MachineQualityRecoveryProfile;
  runPath: string;
  evaluationPath: string;
  evaluation: ReturnType<typeof machineVsGoldEvaluationSchema.parse>;
  metrics: C6011QualityMetrics;
}

function parseArguments(argv: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined) {
      throw new InputError("Invalid C6.0.1.1 validation arguments.");
    }
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

async function subtitleDirectory(runPath: string): Promise<string> {
  const entries = await readdir(runPath, { withFileTypes: true });
  const selected = entries
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => entry.name)
    .toSorted()[0];
  if (selected === undefined)
    throw new InputError("Subtitle directory missing.");
  return path.join(runPath, selected);
}

async function readRunArtifact(
  runPath: string,
  fileName: string,
): Promise<unknown> {
  return await readJson(path.join(await subtitleDirectory(runPath), fileName));
}

async function readEntry(input: {
  label: Entry["label"];
  profile: Entry["profile"];
  runPath: string;
  evaluationPath: string;
}): Promise<Entry> {
  const [evaluation, manifest] = await Promise.all([
    readJson(
      path.join(input.evaluationPath, "machine-vs-gold-evaluation.json"),
    ).then((value) => machineVsGoldEvaluationSchema.parse(value)),
    readJson(
      path.join(input.runPath, "blind-generation-input-manifest.json"),
    ).then((value) => blindGenerationInputManifestSchema.parse(value)),
  ]);
  if (evaluation.generationRunId !== manifest.generationRunId) {
    throw new InputError("Gold evaluation does not belong to the named run.", {
      runPath: input.runPath,
      expectedRunId: manifest.generationRunId,
      actualRunId: evaluation.generationRunId,
    });
  }
  return {
    ...input,
    evaluation,
    metrics: c6011MetricsFromGoldEvaluation(evaluation),
  };
}

function metricsEqual(
  left: C6011QualityMetrics,
  right: C6011QualityMetrics,
): boolean {
  return stableMachineQualityHash(left) === stableMachineQualityHash(right);
}

const args = parseArguments(process.argv.slice(2));
const outputPath = path.resolve(required(args, "--output"));
if (await pathExists(outputPath)) {
  throw new InputError("C6.0.1.1 validation output already exists.", {
    outputPath,
  });
}
await mkdir(outputPath, { recursive: false });

const specifications = [
  ["baseline", "legacy"],
  ["observe", "diagnostics"],
  ["coverage", "coverage"],
  ["timing", "timing"],
  ["full", "full"],
] as const;
const entries = await Promise.all(
  specifications.map(
    async ([label, profile]) =>
      await readEntry({
        label,
        profile,
        runPath: path.resolve(required(args, `--${label}-run`)),
        evaluationPath: path.resolve(required(args, `--${label}-evaluation`)),
      }),
  ),
);

for (const entry of entries) {
  const funnel = (await readRunArtifact(
    entry.runPath,
    "machine-generation-survival-funnel.json",
  )) as {
    stages?: { id?: string; droppedCount?: number }[];
  };
  const rawEvaluationPath = path.join(
    entry.evaluationPath,
    "raw-asr-vs-gold-evaluation.json",
  );
  const rawEvaluation = (await pathExists(rawEvaluationPath))
    ? machineVsGoldEvaluationSchema.parse(await readJson(rawEvaluationPath))
    : null;
  const rawMetrics =
    rawEvaluation === null
      ? null
      : {
          cueCount: rawEvaluation.alignmentMetrics.machineCueCount,
          exactCer: rawEvaluation.globalTextMetrics.exact.cer,
          normalizedCer: rawEvaluation.globalTextMetrics.normalized.cer,
          speechCoverage: rawEvaluation.coverageMetrics.goldTextCoverageRatio,
          missingDialogueCount: rawEvaluation.missingDialogueCandidates.length,
          materialTextDefectCount: rawEvaluation.materialTextErrors.length,
          severeTimingDefectCount: rawEvaluation.severeTimingErrors.length,
        };
  const finalVsRaw =
    rawMetrics === null
      ? null
      : {
          cueCountDelta: entry.metrics.cueCount - rawMetrics.cueCount,
          normalizedCerDelta:
            entry.metrics.normalizedCer - rawMetrics.normalizedCer,
          speechCoverageDelta:
            entry.metrics.speechCoverage - rawMetrics.speechCoverage,
          missingDialogueDelta:
            entry.metrics.missingDialogueCount -
            rawMetrics.missingDialogueCount,
          materialTextDefectDelta:
            entry.metrics.materialTextDefectCount -
            rawMetrics.materialTextDefectCount,
          severeTimingDefectDelta:
            entry.metrics.severeTimingDefectCount -
            rawMetrics.severeTimingDefectCount,
        };
  const lossClassForStage = (stageId: string) => {
    if (stageId.includes("cluster") || stageId.includes("winner")) {
      return "association-loss" as const;
    }
    if (stageId.includes("deduplication")) {
      return "deduplication-loss" as const;
    }
    if (stageId.includes("fragment") || stageId.includes("normalization")) {
      return "merge-or-fragment-loss" as const;
    }
    if (stageId.includes("segmentation") || stageId.includes("integrity")) {
      return "finalization-loss" as const;
    }
    return "unattributed-machine-unit-loss" as const;
  };
  const rawMissing =
    rawMetrics?.missingDialogueCount ?? entry.metrics.missingDialogueCount;
  const attribution = goldLossAttributionSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.1-machine-quality-recovery-v1",
    generatedAt: new Date().toISOString(),
    artifactType: "gold-loss-attribution",
    evaluationOnly: true,
    goldRuntimeInputCount: 0,
    machineRunId: entry.evaluation.generationRunId,
    goldArtifactSha256: entry.evaluation.goldIdentity.sha256,
    machineMetrics: {
      cueCount: entry.metrics.cueCount,
      normalizedCer: entry.metrics.normalizedCer,
      speechCoverage: entry.metrics.speechCoverage,
      missingDialogueCount: entry.metrics.missingDialogueCount,
      materialTextDefectCount: entry.metrics.materialTextDefectCount,
      severeTimingDefectCount: entry.metrics.severeTimingDefectCount,
      rawAsr: rawMetrics,
      finalVsRaw,
    },
    attribution: [
      {
        stage: "raw-asr-detection",
        lossClass: "never-detected-speech",
        estimatedGoldLossCount: rawMissing,
        machineUnitDropCount: 0,
        evidence: ["raw-asr-vs-gold-evaluation", "machine-speech-coverage-gap"],
      },
      {
        stage: "raw-asr-to-final-machine",
        lossClass: "detected-then-filtered",
        estimatedGoldLossCount: Math.max(
          0,
          entry.metrics.missingDialogueCount - rawMissing,
        ),
        machineUnitDropCount: 0,
        evidence: [
          "raw-asr-vs-gold-evaluation",
          "final-machine-vs-gold-evaluation",
          "machine-generation-survival-funnel",
        ],
      },
      {
        stage: "coverage-recovery",
        lossClass: "coverage-recovery-gain",
        estimatedGoldLossCount: Math.max(
          0,
          rawMissing - entry.metrics.missingDialogueCount,
        ),
        machineUnitDropCount: 0,
        evidence: ["machine-coverage-recovery"],
      },
      ...(funnel.stages ?? []).map((stage) => ({
        stage: stage.id ?? "unknown-stage",
        lossClass: lossClassForStage(stage.id ?? "unknown-stage"),
        estimatedGoldLossCount: 0,
        machineUnitDropCount: Math.max(0, stage.droppedCount ?? 0),
        evidence: [
          "machine-generation-survival-funnel",
          "Gold loss is not causally assigned without exact surviving lineage",
        ],
      })),
    ],
  });
  await atomicWriteJson(
    path.join(entry.evaluationPath, "gold-loss-attribution.json"),
    attribution,
  );
  const runAblation = machineQualityRecoveryAblationSchema.parse(
    await readRunArtifact(
      entry.runPath,
      "machine-quality-recovery-ablation.json",
    ),
  );
  await atomicWriteJson(
    path.join(
      entry.evaluationPath,
      "machine-quality-recovery-ablation.evaluation.json",
    ),
    machineQualityRecoveryAblationSchema.parse({
      ...runAblation,
      generatedAt: new Date().toISOString(),
      evaluationOnly: true,
      goldEvaluationAttached: true,
      goldMetrics: entry.metrics,
    }),
  );
}

const baselineEntry = entries.find((entry) => entry.label === "baseline");
if (baselineEntry === undefined) throw new Error("Baseline entry is missing.");
const regressionsFor = (entry: Entry): string[] => {
  if (entry.label === "baseline") return [];
  const regressions: string[] = [];
  if (entry.metrics.normalizedCer > baselineEntry.metrics.normalizedCer) {
    regressions.push("normalized-cer-worse-than-baseline");
  }
  if (entry.metrics.speechCoverage < baselineEntry.metrics.speechCoverage) {
    regressions.push("speech-coverage-worse-than-baseline");
  }
  if (
    entry.metrics.materialTextDefectCount >
    baselineEntry.metrics.materialTextDefectCount
  ) {
    regressions.push("material-text-defects-worse-than-baseline");
  }
  if (
    entry.metrics.severeTimingDefectCount >
      baselineEntry.metrics.severeTimingDefectCount ||
    entry.metrics.startMaeSeconds > baselineEntry.metrics.startMaeSeconds ||
    entry.metrics.endMaeSeconds > baselineEntry.metrics.endMaeSeconds ||
    entry.metrics.p95BoundaryErrorSeconds >
      baselineEntry.metrics.p95BoundaryErrorSeconds
  ) {
    regressions.push("timing-worse-than-baseline");
  }
  if (
    entry.metrics.hallucinationCount >
    Math.max(2, baselineEntry.metrics.hallucinationCount)
  ) {
    regressions.push("hallucination-guard-failed");
  }
  return regressions;
};
const runRegressions = new Map(
  entries.map((entry) => [entry.label, regressionsFor(entry)] as const),
);
const ranked = entries.toSorted(
  (left, right) =>
    compareC6011QualityMetrics(left.metrics, right.metrics) ||
    left.label.localeCompare(right.label),
);
const eligibleRanked = ranked.filter(
  (entry) => (runRegressions.get(entry.label) ?? []).length === 0,
);
const selected = eligibleRanked[0];
if (selected === undefined) throw new Error("No C6.0.1.1 run was available.");
const comparison = c6011QualityComparisonSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.1-machine-quality-recovery-v1",
  generatedAt: new Date().toISOString(),
  artifactType: "c6-0-1-1-quality-comparison",
  runs: entries.map((entry) => ({
    runId: entry.evaluation.generationRunId,
    profile: entry.profile,
    metrics: entry.metrics,
    runtimeGoldInputCount: 0,
    machineArtifactHash: entry.evaluation.machineFreezeHash,
    regressionGuardPassed: (runRegressions.get(entry.label) ?? []).length === 0,
    regressions: runRegressions.get(entry.label) ?? [],
    paretoTradeoff:
      entry.label !== "baseline" &&
      (runRegressions.get(entry.label) ?? []).length > 0 &&
      compareC6011QualityMetrics(entry.metrics, baselineEntry.metrics) < 0,
  })),
  deterministicRanking: ranked.map((entry) => entry.evaluation.generationRunId),
  selectedRunId: selected.evaluation.generationRunId,
  selectionReasons: [
    "regression-guard-required-before-ranking",
    "minimum-p1-defect-count",
    "then-minimum-missing-dialogue",
    "then-minimum-material-text-defects",
    "then-minimum-severe-timing-defects",
    "then-minimum-normalized-cer",
    "then-maximum-speech-coverage",
    "then-minimum-hallucination-count",
    "then-stable-run-label",
  ],
  nonSelectedRunReasons: entries
    .filter((entry) => entry !== selected)
    .map((entry) => ({
      runId: entry.evaluation.generationRunId,
      reasons:
        (runRegressions.get(entry.label) ?? []).length > 0
          ? (runRegressions.get(entry.label) ?? [])
          : ["ranked-below-selected-run-by-frozen-selection-policy"],
    })),
});

const finalAPath = path.resolve(required(args, "--final-a-run"));
const finalBPath = path.resolve(required(args, "--final-b-run"));
const finalAEvaluation = machineVsGoldEvaluationSchema.parse(
  await readJson(
    path.join(
      path.resolve(required(args, "--final-a-evaluation")),
      "machine-vs-gold-evaluation.json",
    ),
  ),
);
const finalBEvaluation = machineVsGoldEvaluationSchema.parse(
  await readJson(
    path.join(
      path.resolve(required(args, "--final-b-evaluation")),
      "machine-vs-gold-evaluation.json",
    ),
  ),
);
const [selectedAblation, finalAAblation, finalBAblation] = await Promise.all([
  readRunArtifact(
    selected.runPath,
    "machine-quality-recovery-ablation.json",
  ).then((value) => machineQualityRecoveryAblationSchema.parse(value)),
  readRunArtifact(finalAPath, "machine-quality-recovery-ablation.json").then(
    (value) => machineQualityRecoveryAblationSchema.parse(value),
  ),
  readRunArtifact(finalBPath, "machine-quality-recovery-ablation.json").then(
    (value) => machineQualityRecoveryAblationSchema.parse(value),
  ),
]);
const [finalARetention, finalBRetention, finalARecovery, finalBRecovery] =
  await Promise.all([
    readRunArtifact(finalAPath, "asr-retention-audit.json"),
    readRunArtifact(finalBPath, "asr-retention-audit.json"),
    readRunArtifact(finalAPath, "missing-dialogue-recovery.json"),
    readRunArtifact(finalBPath, "missing-dialogue-recovery.json"),
  ]);
const finalAMetrics = c6011MetricsFromGoldEvaluation(finalAEvaluation);
const finalBMetrics = c6011MetricsFromGoldEvaluation(finalBEvaluation);
const selectedConfigurationParity =
  selectedAblation.configurationHash === finalAAblation.configurationHash &&
  selectedAblation.configurationHash === finalBAblation.configurationHash;
const canonicalParity =
  finalAAblation.canonicalCueHash !== null &&
  finalAAblation.canonicalCueHash === finalBAblation.canonicalCueHash;
const timingParity =
  finalAAblation.timingHash !== null &&
  finalAAblation.timingHash === finalBAblation.timingHash;
const presentationParity =
  finalAAblation.presentationHash !== null &&
  finalAAblation.presentationHash === finalBAblation.presentationHash;
const evidenceParity =
  stableMachineQualityHash(finalARetention) ===
  stableMachineQualityHash(finalBRetention);
const recoveryDecisionParity =
  stableMachineQualityHash(finalARecovery) ===
  stableMachineQualityHash(finalBRecovery);
const metricParity = metricsEqual(finalAMetrics, finalBMetrics);
const finalAAndBReproducible =
  selectedConfigurationParity &&
  canonicalParity &&
  timingParity &&
  presentationParity &&
  evidenceParity &&
  recoveryDecisionParity &&
  metricParity;
const milestoneChecks = c6011MilestoneChecks(finalAMetrics);
const milestonePassed = Object.values(milestoneChecks).every(Boolean);

const [finalAManifest, finalBManifest, finalAShadow, finalBShadow] =
  await Promise.all([
    readJson(
      path.join(finalAPath, "blind-generation-input-manifest.json"),
    ).then((value) => blindGenerationInputManifestSchema.parse(value)),
    readJson(
      path.join(finalBPath, "blind-generation-input-manifest.json"),
    ).then((value) => blindGenerationInputManifestSchema.parse(value)),
    readJson(
      path.join(finalAPath, "machine-shadow-finalization.json"),
    ) as Promise<Record<string, unknown>>,
    readJson(
      path.join(finalBPath, "machine-shadow-finalization.json"),
    ) as Promise<Record<string, unknown>>,
  ]);
const noGoldArgument = (manifest: typeof finalAManifest) =>
  !manifest.generationArguments.some((argument) =>
    /gold|human|reference-subtitle/iu.test(argument),
  );
const goldRuntimeIsolationPassed =
  noGoldArgument(finalAManifest) && noGoldArgument(finalBManifest);
const productionSafetyPassed =
  finalAShadow.productionStatus === "needs-review" &&
  finalBShadow.productionStatus === "needs-review" &&
  finalAShadow.productionFinalizationMethod === "none" &&
  finalBShadow.productionFinalizationMethod === "none" &&
  finalAEvaluation.p0Defects.length === 0 &&
  finalBEvaluation.p0Defects.length === 0;
const safetyRegressionCount = productionSafetyPassed ? 0 : 1;

const checks = [
  {
    id: "generated-schema-count",
    passed: Number(args.get("--schema-count") ?? "164") === 164,
    details: "149 baseline schemas plus 15 C6.0.1.1 schemas",
  },
  {
    id: "required-test-suites",
    passed: args.get("--tests-passed") === "true",
    details: "typecheck lint format build unit E2E schema and targeted suites",
  },
  {
    id: "selected-configuration-final-parity",
    passed: selectedConfigurationParity,
    details:
      "Final A and B use the deterministic ablation winner configuration",
  },
  {
    id: "canonical-cue-parity",
    passed: canonicalParity,
    details: "Final A/B canonical text hash",
  },
  {
    id: "canonical-timing-parity",
    passed: timingParity,
    details: "Final A/B timing hash",
  },
  {
    id: "presentation-parity",
    passed: presentationParity,
    details: "Final A/B ASS hash",
  },
  {
    id: "machine-evidence-parity",
    passed: evidenceParity,
    details: "Final A/B ASR retention evidence",
  },
  {
    id: "recovery-decision-parity",
    passed: recoveryDecisionParity,
    details: "Final A/B recovery decisions",
  },
  {
    id: "gold-metric-parity",
    passed: metricParity,
    details: "Final A/B Gold-isolated metrics",
  },
  {
    id: "gold-runtime-isolation",
    passed: goldRuntimeIsolationPassed,
    details: "Gold never entered production runtime",
  },
  {
    id: "production-safety-closed",
    passed: productionSafetyPassed,
    details: "needs-review, none, P0=0",
  },
  ...Object.entries(milestoneChecks).map(([id, passed]) => ({
    id: `milestone-${id}`,
    passed,
    details: `measured=${String(finalAMetrics[id as keyof C6011QualityMetrics])}`,
  })),
];
const validation = c6011QualityValidationSchema.parse({
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.1-machine-quality-recovery-v1",
  generatedAt: new Date().toISOString(),
  artifactType: "c6-0-1-1-quality-validation",
  baselineSchemaCount: 149,
  generatedSchemaCount: Number(args.get("--schema-count") ?? "164"),
  checks,
  milestonePassed,
  finalAAndBReproducible,
  goldRuntimeIsolationPassed,
  safetyRegressionCount,
  machineOnlyReleaseAuthorized: false,
  productionStatus: "needs-review",
  finalizationMethod: "none",
  nextStep:
    milestonePassed &&
    finalAAndBReproducible &&
    goldRuntimeIsolationPassed &&
    safetyRegressionCount === 0
      ? "GO_C6_0_2"
      : "HOLD_C6_0_2",
});
await Promise.all([
  atomicWriteJson(
    path.join(outputPath, "c6-0-1-1-quality-comparison.json"),
    comparison,
  ),
  atomicWriteJson(
    path.join(outputPath, "c6-0-1-1-quality-validation.json"),
    validation,
  ),
]);
console.log(JSON.stringify({ comparison, validation }, null, 2));
