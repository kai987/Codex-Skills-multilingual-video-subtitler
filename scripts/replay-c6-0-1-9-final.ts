import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  c6019QualityPolicySchema,
  c6019RouteDecisionSchema,
  goldCrossModelComplementarityEvaluationSchema,
  goldSecondAsrControlRegressionSchema,
  machineCrossModelComparisonSchema,
  machineCrossModelCtcArbitrationSchema,
  machineCrossModelShadowCandidateSchema,
  machineCrossModelUnionOracleEvaluationSchema,
  machineIndependentAsrRuntimeSchema,
  type MachineIndependentAsrCandidates,
  type MachineIndependentAsrRuntime,
  type MachineSecondAsrDiagnosticSet,
  type MachineSecondAsrStability,
} from "@mvl/shared";
import {
  buildMachineCrossModelComparison,
  buildMachineCrossModelCtcArbitration,
  buildMachineIndependentAsrCandidates,
  buildMachineSecondAsrStability,
  machineQualitySemanticHash,
  type IndependentAsrFrozenRecord,
  type WhisperComparisonCandidate,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-29T06:00:00.000Z";

interface Arguments {
  baseline: string;
  cacheFile: string;
  outputRoot: string;
  label: "final-a" | "final-b";
  repositoryCommit: string;
}

interface FrozenCache {
  diagnosticSet: MachineSecondAsrDiagnosticSet;
  runtime: MachineIndependentAsrRuntime;
  records: IndependentAsrFrozenRecord[];
  pronunciationByRequestId: Record<string, string>;
  candidates: MachineIndependentAsrCandidates;
  stability: MachineSecondAsrStability;
  whisperCandidates: WhisperComparisonCandidate[];
  comparison: unknown;
  ctcArbitration: unknown;
  ctcAttempts: unknown[];
  shadow: unknown;
  qualityPolicy: unknown;
  machineFreeze: { machineFreezeHash: string };
  localGoldArtifact: unknown;
  complementarity: unknown;
  oracle: unknown;
  controls: unknown;
  route: unknown;
}

function parseArguments(values: string[]): Arguments {
  const required = (name: string): string => {
    const index = values.indexOf(name);
    const result = index >= 0 ? values[index + 1] : undefined;
    if (result === undefined || result.startsWith("--"))
      throw new Error(`Missing ${name}.`);
    return result;
  };
  const label = required("--label");
  if (label !== "final-a" && label !== "final-b")
    throw new Error("Invalid --label.");
  const repositoryCommit = required("--repository-commit");
  if (!/^[a-f0-9]{40}$/u.test(repositoryCommit))
    throw new Error("Invalid commit SHA.");
  return {
    baseline: path.resolve(required("--baseline")),
    cacheFile: path.resolve(required("--cache-file")),
    outputRoot: path.resolve(required("--output-root")),
    label,
    repositoryCommit,
  };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function locateSubtitleDirectory(root: string): Promise<string> {
  const matches = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (matches.length !== 1)
    throw new Error(`Expected one subtitle directory under ${root}.`);
  return path.join(root, matches[0]?.name ?? "");
}

function candidatePayload(candidates: MachineIndependentAsrCandidates) {
  return candidates.candidates.map((candidate) => ({
    ...candidate,
    cacheHit: undefined,
    inferenceExecuted: undefined,
    semanticHash: undefined,
  }));
}

function stabilityPayload(stability: MachineSecondAsrStability) {
  return stability.events.map(
    ({ semanticHash: _semanticHash, ...event }) => event,
  );
}

const argumentsValue = parseArguments(process.argv.slice(2));
const cache = await readJson<FrozenCache>(argumentsValue.cacheFile);
const freshComparison = machineCrossModelComparisonSchema.parse(
  cache.comparison,
);
const freshCtc = machineCrossModelCtcArbitrationSchema.parse(
  cache.ctcArbitration,
);
const freshShadow = machineCrossModelShadowCandidateSchema.parse(cache.shadow);
const qualityPolicy = c6019QualityPolicySchema.parse(cache.qualityPolicy);
const complementarity = goldCrossModelComplementarityEvaluationSchema.parse(
  cache.complementarity,
);
const oracle = machineCrossModelUnionOracleEvaluationSchema.parse(cache.oracle);
const controls = goldSecondAsrControlRegressionSchema.parse(cache.controls);
const route = c6019RouteDecisionSchema.parse(cache.route);
const replayCandidates = buildMachineIndependentAsrCandidates({
  generatedAt: GENERATED_AT,
  executionKind: "FROZEN_EXACT_CACHE_REPLAY",
  diagnosticSet: cache.diagnosticSet,
  modelIdentityHash: cache.candidates.modelIdentityHash,
  records: cache.records,
  pronunciationByRequestId: new Map(
    Object.entries(cache.pronunciationByRequestId),
  ),
});
const replayStability = buildMachineSecondAsrStability({
  generatedAt: GENERATED_AT,
  candidates: replayCandidates,
});
const replayComparison = buildMachineCrossModelComparison({
  generatedAt: GENERATED_AT,
  diagnosticSet: cache.diagnosticSet,
  independentCandidates: replayCandidates,
  whisperCandidates: cache.whisperCandidates,
});
const replayCtc = buildMachineCrossModelCtcArbitration({
  generatedAt: GENERATED_AT,
  comparison: replayComparison,
  ctcRuntimeIdentityHash: freshCtc.ctcRuntimeIdentityHash,
  ctcModelSnapshotHash: freshCtc.ctcModelSnapshotHash,
  evidence: freshCtc.events.map((event) => ({
    eventId: event.eventId,
    whisperProjection: event.whisperProjection,
    reazonProjection: event.reazonProjection,
    ctcWhisperEvidence: event.ctcWhisperEvidence,
    ctcReazonEvidence: event.ctcReazonEvidence,
    evidenceIds: event.evidenceIds,
  })),
  inferenceCount: 0,
  modelLoadCount: 0,
});
const replayCtcById = new Map(
  replayCtc.events.map((event) => [event.eventId, event]),
);
const replayShadowCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.9-independent-asr-complementarity-v1" as const,
  generatedAt: GENERATED_AT,
  artifactType: "machine-cross-model-shadow-candidate" as const,
  comparisonSemanticHash: replayComparison.semanticHash,
  ctcArbitrationSemanticHash: replayCtc.semanticHash,
  winnerSelectionPolicyImplemented: false as const,
  productionMutationAllowed: false as const,
  events: replayComparison.events.map((event) => {
    const core = {
      eventId: event.eventId,
      agreementClass: event.disagreementClass,
      ctcOutcome: replayCtcById.get(event.eventId)?.outcome ?? null,
      ambiguityRetained: true,
      candidateWinnerId: null,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  }),
  runtimeGoldInputCount: 0 as const,
};
const replayShadow = machineCrossModelShadowCandidateSchema.parse({
  ...replayShadowCore,
  semanticHash: machineQualitySemanticHash(replayShadowCore),
});
const replayRuntimeCore = {
  ...cache.runtime,
  executionKind: "FROZEN_EXACT_CACHE_REPLAY" as const,
  counts: {
    requestCount: 48,
    successfulRequestCount: replayCandidates.summary.successfulRequestCount,
    failedRequestCount: replayCandidates.summary.failedRequestCount,
    emptyOutputCount: replayCandidates.summary.emptyOutputCount,
    cacheHitCount: 48,
    inferenceCount: 0,
    modelLoadCount: 0,
    processStartCount: 0,
  },
  performance: {
    modelLoadSeconds: 0,
    totalInferenceSeconds: 0,
    meanRequestSeconds: 0,
    p50RequestSeconds: 0,
    p95RequestSeconds: 0,
    realTimeFactor: 0,
    peakRssBytes: null,
  },
  semanticHash: undefined,
};
const replayRuntime = machineIndependentAsrRuntimeSchema.parse({
  ...replayRuntimeCore,
  semanticHash: machineQualitySemanticHash(replayRuntimeCore),
});

const comparePayload = (value: typeof freshComparison) =>
  value.events.map(({ semanticHash: _semanticHash, ...event }) => event);
const ctcPayload = (value: typeof freshCtc) =>
  value.events.map(({ semanticHash: _semanticHash, ...event }) => event);
const shadowPayload = (value: typeof freshShadow) =>
  value.events.map(({ semanticHash: _semanticHash, ...event }) => event);
const parity = {
  diagnosticSet: true,
  candidates:
    machineQualitySemanticHash(candidatePayload(cache.candidates)) ===
    machineQualitySemanticHash(candidatePayload(replayCandidates)),
  stability:
    machineQualitySemanticHash(stabilityPayload(cache.stability)) ===
    machineQualitySemanticHash(stabilityPayload(replayStability)),
  comparison:
    machineQualitySemanticHash(comparePayload(freshComparison)) ===
    machineQualitySemanticHash(comparePayload(replayComparison)),
  ctcArbitration:
    machineQualitySemanticHash(ctcPayload(freshCtc)) ===
    machineQualitySemanticHash(ctcPayload(replayCtc)),
  shadow:
    machineQualitySemanticHash(shadowPayload(freshShadow)) ===
    machineQualitySemanticHash(shadowPayload(replayShadow)),
  routeDecision:
    route.semanticHash ===
    c6019RouteDecisionSchema.parse(cache.route).semanticHash,
};
if (Object.values(parity).some((value) => !value)) {
  throw new Error(
    `Frozen result-cache replay parity failed: ${JSON.stringify(parity)}`,
  );
}
const machineSemanticPayloadHash = machineQualitySemanticHash({
  diagnosticSet: cache.diagnosticSet.semanticHash,
  candidates: candidatePayload(replayCandidates),
  stability: stabilityPayload(replayStability),
  comparison: comparePayload(replayComparison),
  ctc: ctcPayload(replayCtc),
  shadow: shadowPayload(replayShadow),
  route: route.semanticHash,
});
const baselineAudit = await readJson<{
  finalHashes: {
    canonicalTextHash: string;
    canonicalTimingHash: string;
    presentationHash: string;
    assHash: string;
    srtHash: string;
    vttHash: string;
  };
}>(path.join(argumentsValue.baseline, "c6-0-1-7-machine-run-audit.json"));
const runAuditCore = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-9-final-run-audit",
  policyVersion: "c6.0.1.9-independent-asr-complementarity-v1",
  generatedAt: GENERATED_AT,
  runLabel: argumentsValue.label,
  repositoryCommit: argumentsValue.repositoryCommit,
  executionKind: "FROZEN_EXACT_CACHE_REPLAY",
  resultCache: {
    plannedRequestCount: 48,
    actualRequestCount: 48,
    cacheHitCount: 48,
    inferenceCount: 0,
    modelLoadCount: 0,
    processStartCount: 0,
    networkUsed: false,
    runtimeGoldInputCount: 0,
  },
  ctcReplay: {
    eligibleCount: replayCtc.summary.eligibleCount,
    cacheHitCount: replayCtc.summary.eligibleCount * 2,
    inferenceCount: 0,
    modelLoadCount: 0,
  },
  parity,
  machineSemanticPayloadHash,
  productionHashes: baselineAudit.finalHashes,
  canonicalTextMutationCount: 0,
  canonicalTimingMutationCount: 0,
  productionStatus: "needs-review",
  finalizationMethod: "none",
  machineReleaseAuthorized: false,
  goC602: false,
};
const runAudit = {
  ...runAuditCore,
  semanticHash: machineQualitySemanticHash(runAuditCore),
};
const output = path.join(
  argumentsValue.outputRoot,
  `carnation-c6-0-1-9-${argumentsValue.label}-20260829`,
);
try {
  await (await import("node:fs/promises")).access(output);
  throw new Error(`Refusing to overwrite ${output}.`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Refusing"))
    throw error;
}
await cp(argumentsValue.baseline, output, {
  recursive: true,
  preserveTimestamps: true,
});
const subtitle = await locateSubtitleDirectory(output);
const artifacts = {
  "machine-second-asr-diagnostic-set.json": cache.diagnosticSet,
  "machine-independent-asr-runtime.json": replayRuntime,
  "machine-independent-asr-candidates.json": replayCandidates,
  "machine-second-asr-stability.json": replayStability,
  "machine-cross-model-comparison.json": replayComparison,
  "machine-cross-model-ctc-arbitration.json": replayCtc,
  "machine-cross-model-shadow-candidate.json": replayShadow,
  "c6-0-1-9-quality-policy.json": qualityPolicy,
  "c6-0-1-9-machine-freeze.json": cache.machineFreeze,
  "gold-local-second-asr-evaluation.json": cache.localGoldArtifact,
  "gold-cross-model-complementarity-evaluation.json": complementarity,
  "machine-cross-model-union-oracle-evaluation.json": oracle,
  "gold-second-asr-control-regression.json": controls,
  "c6-0-1-9-route-decision.json": route,
  "c6-0-1-9-final-run-audit.json": runAudit,
};
await Promise.all(
  Object.entries(artifacts).map(([name, value]) =>
    writeJson(path.join(subtitle, name), value),
  ),
);
process.stdout.write(`${JSON.stringify({ output, runAudit }, null, 2)}\n`);
