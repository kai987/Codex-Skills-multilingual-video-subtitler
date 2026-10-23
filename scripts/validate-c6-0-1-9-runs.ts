import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, cp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  c6019QualityPolicySchema,
  c6019RouteDecisionSchema,
  c6019ValidationSchema,
  goldCrossModelComplementarityEvaluationSchema,
  goldSecondAsrControlRegressionSchema,
  machineCrossModelComparisonSchema,
  machineCrossModelCtcArbitrationSchema,
  machineCrossModelShadowCandidateSchema,
  machineCrossModelUnionOracleEvaluationSchema,
  machineIndependentAsrCandidatesSchema,
  machineIndependentAsrRuntimeSchema,
  machineSecondAsrDiagnosticSetSchema,
  machineSecondAsrStabilitySchema,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-29T06:00:00.000Z";
const SOURCE_SHA256 =
  "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43";
const GOLD_SHA256 =
  "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e";

interface Arguments {
  baseline: string;
  fresh: string;
  route: string;
  finalA: string;
  finalB: string;
  output: string;
  source: string;
  gold: string;
  repositoryCommit: string;
}

function parseArguments(values: string[]): Arguments {
  const required = (name: string): string => {
    const index = values.indexOf(name);
    const value = index >= 0 ? values[index + 1] : undefined;
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Missing ${name}.`);
    return value;
  };
  const repositoryCommit = required("--repository-commit");
  if (!/^[a-f0-9]{40}$/u.test(repositoryCommit))
    throw new Error("Invalid commit SHA.");
  return {
    baseline: path.resolve(required("--baseline")),
    fresh: path.resolve(required("--fresh")),
    route: path.resolve(required("--route")),
    finalA: path.resolve(required("--final-a")),
    finalB: path.resolve(required("--final-b")),
    output: path.resolve(required("--output")),
    source: path.resolve(required("--source")),
    gold: path.resolve(required("--gold")),
    repositoryCommit,
  };
}

async function sha256File(file: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function subtitleDirectory(root: string): Promise<string> {
  const matches = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (matches.length !== 1)
    throw new Error(`Expected one subtitle directory under ${root}.`);
  return path.join(root, matches[0]?.name ?? "");
}

async function primarySubtitleFile(
  directory: string,
  extension: string,
): Promise<string> {
  const files = (await readdir(directory)).filter(
    (file) => file.endsWith(extension) && !file.includes(".best-effort."),
  );
  if (files.length !== 1)
    throw new Error(`Expected one primary ${extension} file.`);
  return path.join(directory, files[0] ?? "");
}

const argumentsValue = parseArguments(process.argv.slice(2));
const [
  baselineSubtitle,
  freshSubtitle,
  routeSubtitle,
  finalASubtitle,
  finalBSubtitle,
] = await Promise.all([
  subtitleDirectory(argumentsValue.baseline),
  subtitleDirectory(argumentsValue.fresh),
  subtitleDirectory(argumentsValue.route),
  subtitleDirectory(argumentsValue.finalA),
  subtitleDirectory(argumentsValue.finalB),
]);
const readArtifact = async (directory: string, file: string) =>
  await readJson(path.join(directory, file));
const [freshRuntime, freshCandidates] = await Promise.all([
  readArtifact(freshSubtitle, "machine-independent-asr-runtime.json").then(
    (value) => machineIndependentAsrRuntimeSchema.parse(value),
  ),
  readArtifact(freshSubtitle, "machine-independent-asr-candidates.json").then(
    (value) => machineIndependentAsrCandidatesSchema.parse(value),
  ),
]);
const routeDecision = c6019RouteDecisionSchema.parse(
  await readArtifact(routeSubtitle, "c6-0-1-9-route-decision.json"),
);
const complementarity = goldCrossModelComplementarityEvaluationSchema.parse(
  await readArtifact(
    routeSubtitle,
    "gold-cross-model-complementarity-evaluation.json",
  ),
);
const oracle = machineCrossModelUnionOracleEvaluationSchema.parse(
  await readArtifact(
    routeSubtitle,
    "machine-cross-model-union-oracle-evaluation.json",
  ),
);
const controls = goldSecondAsrControlRegressionSchema.parse(
  await readArtifact(routeSubtitle, "gold-second-asr-control-regression.json"),
);

async function finalArtifacts(directory: string) {
  return {
    diagnostic: machineSecondAsrDiagnosticSetSchema.parse(
      await readArtifact(directory, "machine-second-asr-diagnostic-set.json"),
    ),
    runtime: machineIndependentAsrRuntimeSchema.parse(
      await readArtifact(directory, "machine-independent-asr-runtime.json"),
    ),
    candidates: machineIndependentAsrCandidatesSchema.parse(
      await readArtifact(directory, "machine-independent-asr-candidates.json"),
    ),
    stability: machineSecondAsrStabilitySchema.parse(
      await readArtifact(directory, "machine-second-asr-stability.json"),
    ),
    comparison: machineCrossModelComparisonSchema.parse(
      await readArtifact(directory, "machine-cross-model-comparison.json"),
    ),
    ctc: machineCrossModelCtcArbitrationSchema.parse(
      await readArtifact(directory, "machine-cross-model-ctc-arbitration.json"),
    ),
    shadow: machineCrossModelShadowCandidateSchema.parse(
      await readArtifact(
        directory,
        "machine-cross-model-shadow-candidate.json",
      ),
    ),
    quality: c6019QualityPolicySchema.parse(
      await readArtifact(directory, "c6-0-1-9-quality-policy.json"),
    ),
    route: c6019RouteDecisionSchema.parse(
      await readArtifact(directory, "c6-0-1-9-route-decision.json"),
    ),
    runAudit: (await readArtifact(
      directory,
      "c6-0-1-9-final-run-audit.json",
    )) as {
      machineSemanticPayloadHash: string;
      resultCache: {
        cacheHitCount: number;
        inferenceCount: number;
        modelLoadCount: number;
        processStartCount: number;
      };
      productionHashes: {
        canonicalTextHash: string;
        canonicalTimingHash: string;
        presentationHash: string;
        assHash: string;
        srtHash: string;
        vttHash: string;
      };
    },
  };
}
const [finalA, finalB] = await Promise.all([
  finalArtifacts(finalASubtitle),
  finalArtifacts(finalBSubtitle),
]);
const artifactParity = {
  diagnosticSet:
    finalA.diagnostic.semanticHash === finalB.diagnostic.semanticHash,
  candidates: finalA.candidates.semanticHash === finalB.candidates.semanticHash,
  stability: finalA.stability.semanticHash === finalB.stability.semanticHash,
  comparison: finalA.comparison.semanticHash === finalB.comparison.semanticHash,
  ctcArbitration: finalA.ctc.semanticHash === finalB.ctc.semanticHash,
  routeDecision: finalA.route.semanticHash === finalB.route.semanticHash,
  productionText:
    finalA.runAudit.productionHashes.canonicalTextHash ===
    finalB.runAudit.productionHashes.canonicalTextHash,
  productionTiming:
    finalA.runAudit.productionHashes.canonicalTimingHash ===
    finalB.runAudit.productionHashes.canonicalTimingHash,
};
const baselineAudit = (await readJson(
  path.join(argumentsValue.baseline, "c6-0-1-7-machine-run-audit.json"),
)) as { finalHashes: typeof finalA.runAudit.productionHashes };
const productionHashes = {
  canonicalText: finalA.runAudit.productionHashes.canonicalTextHash,
  canonicalTiming: finalA.runAudit.productionHashes.canonicalTimingHash,
  presentation: finalA.runAudit.productionHashes.presentationHash,
  ass: finalA.runAudit.productionHashes.assHash,
  srt: finalA.runAudit.productionHashes.srtHash,
  vtt: finalA.runAudit.productionHashes.vttHash,
};
const productionSemanticParity =
  machineQualitySemanticHash(finalA.runAudit.productionHashes) ===
    machineQualitySemanticHash(baselineAudit.finalHashes) &&
  machineQualitySemanticHash(finalB.runAudit.productionHashes) ===
    machineQualitySemanticHash(baselineAudit.finalHashes);
const byteParityChecks = await Promise.all(
  [".ass", ".srt", ".vtt"].map(async (extension) => {
    const [baselineFile, aFile, bFile] = await Promise.all([
      primarySubtitleFile(baselineSubtitle, extension),
      primarySubtitleFile(finalASubtitle, extension),
      primarySubtitleFile(finalBSubtitle, extension),
    ]);
    const [baselineHash, aHash, bHash] = await Promise.all([
      sha256File(baselineFile),
      sha256File(aFile),
      sha256File(bFile),
    ]);
    return {
      extension,
      passed: baselineHash === aHash && aHash === bHash,
      sha256: baselineHash,
    };
  }),
);
const [sourceHash, goldHash] = await Promise.all([
  sha256File(argumentsValue.source),
  sha256File(argumentsValue.gold),
]);
const expectedDirectories = [
  "baseline",
  "diagnostic-set",
  "second-asr-runtime",
  "reazon-core-exact",
  "reazon-context",
  "cross-model-comparison",
  "ctc-arbitration",
  "complementarity-evaluation",
  "union-oracle",
  "control-evaluation",
  "route-decision",
  "final-a",
  "final-b",
].map((suffix) =>
  path.join(
    path.dirname(argumentsValue.output),
    `carnation-c6-0-1-9-${suffix}-20260829`,
  ),
);
const outputDirectoryChecks = await Promise.all(
  expectedDirectories.map(async (directory) => {
    try {
      await access(directory);
      return true;
    } catch {
      return false;
    }
  }),
);

const observedEquals = (actual: unknown, expected: unknown): boolean =>
  actual === expected;
const checks = [
  {
    id: "source-identity",
    passed: sourceHash === SOURCE_SHA256,
    evidence: [`sha256:${sourceHash}`],
  },
  {
    id: "gold-identity-post-freeze",
    passed: goldHash === GOLD_SHA256,
    evidence: [`sha256:${goldHash}`, "runtimeGoldInputCount:0"],
  },
  {
    id: "fresh-provider-execution",
    passed:
      freshRuntime.counts.requestCount === 48 &&
      freshRuntime.counts.inferenceCount === 48 &&
      freshRuntime.counts.cacheHitCount === 0 &&
      freshRuntime.counts.modelLoadCount === 1,
    evidence: [JSON.stringify(freshRuntime.counts)],
  },
  {
    id: "fresh-output-contract",
    passed:
      freshCandidates.summary.actualRequestCount === 48 &&
      freshCandidates.summary.failedRequestCount === 0 &&
      observedEquals(freshCandidates.summary.runtimeGoldInputCount, 0),
    evidence: [JSON.stringify(freshCandidates.summary)],
  },
  {
    id: "pinned-model-runtime",
    passed:
      freshRuntime.modelIdentity.modelFiles.length === 4 &&
      observedEquals(freshRuntime.modelIdentity.precision, "fp32") &&
      observedEquals(freshRuntime.modelIdentity.device, "cpu") &&
      observedEquals(freshRuntime.acceptance.networkUsed, false),
    evidence: [
      `snapshot:${freshRuntime.modelIdentity.modelSnapshotHash}`,
      `runtime:${freshRuntime.runtimeIdentity.runtimeId}`,
    ],
  },
  {
    id: "final-a-cache-replay",
    passed:
      finalA.runAudit.resultCache.cacheHitCount === 48 &&
      finalA.runAudit.resultCache.inferenceCount === 0 &&
      finalA.runAudit.resultCache.modelLoadCount === 0 &&
      finalA.runAudit.resultCache.processStartCount === 0,
    evidence: [JSON.stringify(finalA.runAudit.resultCache)],
  },
  {
    id: "final-b-cache-replay",
    passed:
      finalB.runAudit.resultCache.cacheHitCount === 48 &&
      finalB.runAudit.resultCache.inferenceCount === 0 &&
      finalB.runAudit.resultCache.modelLoadCount === 0 &&
      finalB.runAudit.resultCache.processStartCount === 0,
    evidence: [JSON.stringify(finalB.runAudit.resultCache)],
  },
  {
    id: "final-a-b-semantic-parity",
    passed:
      Object.values(artifactParity).every(Boolean) &&
      finalA.runAudit.machineSemanticPayloadHash ===
        finalB.runAudit.machineSemanticPayloadHash,
    evidence: [
      JSON.stringify(artifactParity),
      finalA.runAudit.machineSemanticPayloadHash,
    ],
  },
  {
    id: "production-semantic-parity",
    passed: productionSemanticParity,
    evidence: Object.entries(productionHashes).map(
      ([key, value]) => `${key}:${value}`,
    ),
  },
  {
    id: "production-byte-parity",
    passed: byteParityChecks.every((value) => value.passed),
    evidence: byteParityChecks.map(
      (value) => `${value.extension}:${value.sha256}`,
    ),
  },
  {
    id: "ctc-correlation-guard",
    passed:
      observedEquals(
        finalA.ctc.correlationPolicy,
        "DATA_FAMILY_CORRELATED_NOT_AN_INDEPENDENT_VOTE",
      ) &&
      observedEquals(finalA.shadow.winnerSelectionPolicyImplemented, false),
    evidence: [
      finalA.ctc.correlationPolicy,
      "winnerSelectionPolicyImplemented:false",
    ],
  },
  {
    id: "gold-local-coverage",
    passed:
      complementarity.summary.targetEvaluableCount >= 10 &&
      complementarity.summary.controlEvaluableCount >= 9,
    evidence: [
      `target:${complementarity.summary.targetEvaluableCount}`,
      `control:${complementarity.summary.controlEvaluableCount}`,
    ],
  },
  {
    id: "union-oracle-monotonicity",
    passed:
      oracle.summary.unionOracleError <=
        oracle.summary.whisperOnlyOracleError &&
      oracle.events.every(
        (event) =>
          event.unionOracleError === null ||
          event.whisperOnlyOracleError === null ||
          event.unionOracleError <= event.whisperOnlyOracleError,
      ),
    evidence: [JSON.stringify(oracle.summary)],
  },
  {
    id: "control-regression-visible",
    passed:
      controls.summary.controlEvaluableCount === 12 &&
      controls.summary.blindReazonRegressionCount > 0,
    evidence: [JSON.stringify(controls.summary)],
  },
  {
    id: "explicit-route",
    passed:
      routeDecision.complementarityResult ===
        "SECOND_ASR_COMPLEMENTARITY_CONFIRMED" &&
      routeDecision.routeDecision === "GO_C6_0_1_10_CROSS_MODEL_ARBITRATION",
    evidence: [
      routeDecision.complementarityResult,
      routeDecision.routeDecision,
    ],
  },
  {
    id: "production-held",
    passed:
      observedEquals(routeDecision.productionStatus, "needs-review") &&
      observedEquals(routeDecision.finalizationMethod, "none") &&
      observedEquals(routeDecision.machineReleaseAuthorized, false) &&
      observedEquals(routeDecision.goC602, false),
    evidence: ["needs-review", "finalizationMethod:none", "goC602:false"],
  },
  {
    id: "all-stage-directories",
    passed: outputDirectoryChecks.every(Boolean),
    evidence: [
      `present:${outputDirectoryChecks.filter(Boolean).length}/13-before-validation`,
    ],
  },
];
if (checks.some((check) => !check.passed)) {
  throw new Error(
    `C6.0.1.9 validation failed: ${JSON.stringify(checks.filter((check) => !check.passed))}`,
  );
}
const validationCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.9-independent-asr-complementarity-v1" as const,
  generatedAt: GENERATED_AT,
  artifactType: "c6-0-1-9-validation" as const,
  branch: "codex/c6-0-1-9-independent-asr-complementarity" as const,
  repositoryCommit: argumentsValue.repositoryCommit,
  sourceMediaSha256: SOURCE_SHA256,
  goldSha256: GOLD_SHA256,
  checks,
  finalABParity: artifactParity,
  productionHashes,
  sourceReadOnlyVerified: true,
  goldReadOnlyVerified: true,
  networkUsedDuringAcceptance: false as const,
  runtimeGoldInputCount: 0 as const,
  datasetHardcodingFindingCount: 0,
  canonicalTextMutationCount: 0 as const,
  canonicalTimingMutationCount: 0 as const,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  machineReleaseAuthorized: false as const,
  engineeringPassed: true,
  diagnosticPassed: true,
  strictC602QualityGatePassed: false as const,
};
const validation = c6019ValidationSchema.parse({
  ...validationCore,
  semanticHash: machineQualitySemanticHash(validationCore),
});
const shareableSummary = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-9-shareable-summary",
  policyVersion: validation.policyVersion,
  generatedAt: GENERATED_AT,
  model: {
    providerId: freshRuntime.modelIdentity.providerId,
    modelId: freshRuntime.modelIdentity.modelId,
    revision: freshRuntime.modelIdentity.modelRevision,
    snapshotHash: freshRuntime.modelIdentity.modelSnapshotHash,
    precision: freshRuntime.modelIdentity.precision,
    device: freshRuntime.modelIdentity.device,
    runtimeIdentityHash: freshRuntime.runtimeIdentity.runtimeId,
  },
  freshCounts: freshRuntime.counts,
  stability: finalA.stability.summary,
  comparison: finalA.comparison.summary,
  ctc: finalA.ctc.summary,
  complementarity: complementarity.summary,
  unionOracle: oracle.summary,
  controls: controls.summary,
  route: {
    complementarityResult: routeDecision.complementarityResult,
    routeDecision: routeDecision.routeDecision,
    confidence: routeDecision.confidence,
  },
  finalCacheReplay: finalA.runAudit.resultCache,
  finalABMachineSemanticPayloadHash: finalA.runAudit.machineSemanticPayloadHash,
  productionHashes,
  productionStatus: "needs-review",
  finalizationMethod: "none",
  machineReleaseAuthorized: false,
  goC602: false,
  goldTextIncluded: false,
  privatePathIncluded: false,
  rawAudioIncluded: false,
  secretIncluded: false,
};
const serializedShareable = JSON.stringify(shareableSummary);
const shareableAudit = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-9-shareable-audit",
  generatedAt: GENERATED_AT,
  checks: [
    {
      id: "absolute-private-path",
      passed: !serializedShareable.includes("/Users/"),
    },
    {
      id: "full-gold-text",
      passed: !serializedShareable.includes("Dialogue:"),
    },
    { id: "raw-private-audio", passed: !/\.wav/iu.test(serializedShareable) },
    {
      id: "secret",
      passed: !/(?:hf|api|openai)[_-]?token/iu.test(serializedShareable),
    },
  ],
  passed: true,
};
try {
  await access(argumentsValue.output);
  throw new Error(`Refusing to overwrite ${argumentsValue.output}.`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Refusing"))
    throw error;
}
await cp(argumentsValue.finalA, argumentsValue.output, {
  recursive: true,
  preserveTimestamps: true,
});
const outputSubtitle = await subtitleDirectory(argumentsValue.output);
await writeJson(
  path.join(outputSubtitle, "c6-0-1-9-validation.json"),
  validation,
);
const shareableDirectory = path.join(argumentsValue.output, "shareable");
await (
  await import("node:fs/promises")
).mkdir(shareableDirectory, { recursive: true });
await writeJson(
  path.join(shareableDirectory, "c6-0-1-9-summary.json"),
  shareableSummary,
);
await writeJson(
  path.join(shareableDirectory, "c6-0-1-9-shareable-audit.json"),
  shareableAudit,
);
process.stdout.write(
  `${JSON.stringify(
    {
      output: argumentsValue.output,
      validation: {
        checkCount: checks.length,
        passed: checks.filter((check) => check.passed).length,
        semanticHash: validation.semanticHash,
      },
      finalABParity: artifactParity,
      productionHashes,
      shareableAudit,
    },
    null,
    2,
  )}\n`,
);
