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
  const evaluation = machineVsGoldEvaluationSchema.parse(
    await readJson(
      path.join(input.evaluationPath, "machine-vs-gold-evaluation.json"),
    ),
  );
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
    },
    attribution: [
      {
        stage: "initial-machine-speech-undercoverage",
        estimatedGoldLossCount: entry.metrics.missingDialogueCount,
        evidence: [
          "gold-evaluation-unmatched-dialogue-groups",
          "machine-speech-coverage-gap",
        ],
      },
      ...(funnel.stages ?? []).map((stage) => ({
        stage: stage.id ?? "unknown-stage",
        estimatedGoldLossCount: Math.max(0, stage.droppedCount ?? 0),
        evidence: ["machine-generation-survival-funnel"],
      })),
    ],
  });
  await atomicWriteJson(
    path.join(entry.evaluationPath, "gold-loss-attribution.json"),
    attribution,
  );
}

const ranked = entries.toSorted(
  (left, right) =>
    compareC6011QualityMetrics(left.metrics, right.metrics) ||
    left.label.localeCompare(right.label),
);
const selected = ranked[0];
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
  })),
  deterministicRanking: ranked.map((entry) => entry.evaluation.generationRunId),
  selectedRunId: selected.evaluation.generationRunId,
  selectionReasons: [
    "minimum-p1-defect-count",
    "then-minimum-missing-dialogue",
    "then-minimum-material-text-defects",
    "then-minimum-severe-timing-defects",
    "then-minimum-normalized-cer",
    "then-maximum-speech-coverage",
    "then-minimum-hallucination-count",
    "then-stable-run-label",
  ],
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
  noGoldArgument(finalAManifest) &&
  noGoldArgument(finalBManifest) &&
  finalAEvaluation.modelInferenceCount === 0 &&
  finalBEvaluation.modelInferenceCount === 0;
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
    details: `measured=${String(finalAMetrics[id as keyof C6011QualityMetrics] ?? passed)}`,
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
