import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  MachineIndependentAsrCandidates,
  MachineIndependentAsrRuntime,
  MachineSecondAsrDiagnosticSet,
  MachineSecondAsrStability,
} from "@mvl/shared";
import { machineCrossModelShadowCandidateSchema } from "@mvl/shared";
import { parseAss } from "@mvl/subtitle-core";
import {
  buildC6019RouteDecision,
  buildGoldCrossModelComplementarityEvaluation,
  buildGoldSecondAsrControlRegression,
  buildMachineCrossModelComparison,
  buildMachineCrossModelCtcArbitration,
  buildMachineCrossModelUnionOracleEvaluation,
  genericHallucinationRisk,
  loadAndVerifyCtcRuntime,
  LocalCtcWorker,
  machineQualitySemanticHash,
  normalizeC601GoldAssTimestamps,
  normalizeIndependentAsrDisplay,
  normalizeIndependentAsrLexical,
  normalizeJapanesePronunciation,
  normalizedEditSimilarity,
  runSudachiMorphemeAnalysis,
  type CrossModelCtcEvidenceInput,
  type IndependentAsrFrozenRecord,
  type LocalCrossModelGoldInput,
  type WhisperComparisonCandidate,
} from "@mvl/video-subtitler";

const GOLD_SHA256 =
  "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e";
const GENERATED_AT = "2026-08-29T06:00:00.000Z";

interface Arguments {
  baseline: string;
  gold: string;
  cacheFile: string;
  audioDirectory: string;
  outputRoot: string;
  sudachiPython: string;
  sudachiHelper: string;
  ctcRuntimeManifest: string;
  ctcModelManifest: string;
}

interface FrozenCache {
  schemaVersion: string;
  policyVersion: string;
  artifactType: string;
  generatedAt: string;
  diagnosticSet: MachineSecondAsrDiagnosticSet;
  modelIdentityHash: string;
  runtime: MachineIndependentAsrRuntime;
  records: IndependentAsrFrozenRecord[];
  candidates: MachineIndependentAsrCandidates;
  stability: MachineSecondAsrStability;
  qualityPolicy: unknown;
  [key: string]: unknown;
}

interface ProjectionArtifact {
  candidates: {
    eventId: string;
    candidateId: string;
    coreProjectedText: string;
    projectionStatus: string;
  }[];
}

interface RiskArtifact {
  events: { eventId: string; candidateId: string }[];
}

interface PoolArtifact {
  candidates: {
    eventId: string;
    candidateId: string;
    text: string;
  }[];
}

function parseArguments(values: string[]): Arguments {
  const required = (name: string): string => {
    const index = values.indexOf(name);
    const result = index >= 0 ? values[index + 1] : undefined;
    if (result === undefined || result.startsWith("--"))
      throw new Error(`Missing ${name}.`);
    return path.resolve(result);
  };
  return {
    baseline: required("--baseline"),
    gold: required("--gold"),
    cacheFile: required("--cache-file"),
    audioDirectory: required("--audio-directory"),
    outputRoot: required("--output-root"),
    sudachiPython: required("--sudachi-python"),
    sudachiHelper: required("--sudachi-helper"),
    ctcRuntimeManifest: required("--ctc-runtime-manifest"),
    ctcModelManifest: required("--ctc-model-manifest"),
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

async function snapshot(
  baseline: string,
  destination: string,
  artifacts: Readonly<Record<string, unknown>>,
): Promise<void> {
  try {
    await (await import("node:fs/promises")).access(destination);
    throw new Error(`Refusing to overwrite existing output ${destination}.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing"))
      throw error;
  }
  await cp(baseline, destination, {
    recursive: true,
    preserveTimestamps: true,
  });
  const subtitle = await locateSubtitleDirectory(destination);
  await Promise.all(
    Object.entries(artifacts).map(([fileName, value]) =>
      writeJson(path.join(subtitle, fileName), value),
    ),
  );
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function overlapSeconds(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

const argumentsValue = parseArguments(process.argv.slice(2));
const cache = await readJson<FrozenCache>(argumentsValue.cacheFile);
const baselineSubtitle = await locateSubtitleDirectory(argumentsValue.baseline);
const projection = await readJson<ProjectionArtifact>(
  path.join(baselineSubtitle, "machine-core-text-projection.json"),
);
const risk = await readJson<RiskArtifact>(
  path.join(baselineSubtitle, "machine-reasr-risk-v2.json"),
);
const pool = await readJson<PoolArtifact>(
  path.join(baselineSubtitle, "machine-candidate-pool-c6-0-1-5.json"),
);

// Rebuild the Gold-free comparison from every frozen C6.0.1.8 core-projected
// candidate. Cross-event ambiguity remains visible in upstream provenance; it
// is not silently dropped from the candidate-pool complementarity question.
const whisperDrafts: {
  eventId: string;
  candidateId: string;
  text: string;
  duration: number;
}[] = [];
for (const event of cache.diagnosticSet.events) {
  if (event.role === "TARGET") {
    const seen = new Set<string>();
    for (const candidate of projection.candidates) {
      if (
        candidate.eventId !== event.eventId ||
        candidate.coreProjectedText.trim() === ""
      )
        continue;
      const normalized = normalizeIndependentAsrLexical(
        candidate.coreProjectedText,
      );
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      whisperDrafts.push({
        eventId: event.eventId,
        candidateId: candidate.candidateId,
        text: candidate.coreProjectedText,
        duration: event.coreInterval.end - event.coreInterval.start,
      });
    }
  } else {
    const current = risk.events.find(
      (candidate) => candidate.eventId === event.eventId,
    );
    const candidate = pool.candidates.find(
      (value) =>
        value.eventId === event.eventId &&
        value.candidateId === current?.candidateId,
    );
    if (candidate !== undefined) {
      whisperDrafts.push({
        eventId: event.eventId,
        candidateId: candidate.candidateId,
        text: candidate.text,
        duration: event.coreInterval.end - event.coreInterval.start,
      });
    }
  }
}
const readingIds = new Map(
  whisperDrafts.map((draft) => [
    `${draft.eventId}\u0000${draft.candidateId}`,
    `whisper:${machineQualitySemanticHash({ eventId: draft.eventId, candidateId: draft.candidateId })}`,
  ]),
);
const readings = await runSudachiMorphemeAnalysis({
  pythonExecutable: argumentsValue.sudachiPython,
  helperPath: argumentsValue.sudachiHelper,
  items: whisperDrafts.map((draft) => ({
    id:
      readingIds.get(`${draft.eventId}\u0000${draft.candidateId}`) ?? "missing",
    text: draft.text,
  })),
  timeoutMs: 120_000,
});
const whisperCandidates: WhisperComparisonCandidate[] = whisperDrafts.map(
  (draft) => {
    const displayText = normalizeIndependentAsrDisplay(draft.text);
    const readingId =
      readingIds.get(`${draft.eventId}\u0000${draft.candidateId}`) ?? "missing";
    return {
      eventId: draft.eventId,
      candidateId: draft.candidateId,
      displayText,
      normalizedDisplayText: normalizeIndependentAsrLexical(displayText),
      pronunciationText:
        readings.readingsById.get(readingId) ??
        normalizeJapanesePronunciation(displayText),
      hallucinationRisk: genericHallucinationRisk({
        text: displayText,
        durationSeconds: draft.duration,
      }),
    };
  },
);
const comparison = buildMachineCrossModelComparison({
  generatedAt: GENERATED_AT,
  diagnosticSet: cache.diagnosticSet,
  independentCandidates: cache.candidates,
  whisperCandidates,
});

const eligibleClasses = new Set([
  "LEXICAL_DISAGREEMENT",
  "WHISPER_HALLUCINATION_RISK",
  "REAZON_HALLUCINATION_RISK",
  "BOTH_LOW_SUPPORT",
]);
const verifiedCtc = await loadAndVerifyCtcRuntime({
  runtimeManifestPath: argumentsValue.ctcRuntimeManifest,
  modelManifestPath: argumentsValue.ctcModelManifest,
});
const worker = new LocalCtcWorker({
  ...verifiedCtc,
  device: "cpu",
  workerScriptPath: path.resolve("scripts/runtime/ctc_worker.py"),
});
const ctcEvidence: CrossModelCtcEvidenceInput[] = [];
const ctcAttempts: unknown[] = [];
let ctcInferenceCount = 0;
let ctcModelLoadCount = 0;
try {
  for (const event of comparison.events) {
    if (
      !eligibleClasses.has(event.disagreementClass) ||
      event.whisperCandidates.length === 0
    )
      continue;
    const whisper = event.whisperCandidates.toSorted(
      (left, right) =>
        normalizedEditSimilarity(
          right.pronunciationText,
          event.reazonCandidate.pronunciationText,
        ) -
          normalizedEditSimilarity(
            left.pronunciationText,
            event.reazonCandidate.pronunciationText,
          ) || left.candidateId.localeCompare(right.candidateId),
    )[0];
    if (
      whisper === undefined ||
      whisper.pronunciationText === "" ||
      event.reazonCandidate.pronunciationText === ""
    ) {
      continue;
    }
    const record = cache.records.find(
      (value) =>
        value.request.eventId === event.eventId &&
        value.request.windowType === "CORE_EXACT",
    );
    if (record === undefined)
      throw new Error(
        `Missing CORE_EXACT audio identity for ${event.eventId}.`,
      );
    const audioPath = path.join(
      argumentsValue.audioDirectory,
      `${record.request.requestId.replace(/:/gu, "-")}.wav`,
    );
    const common = {
      cueId: event.eventId,
      componentId: event.eventId,
      windowType: "narrow" as const,
      audioPath,
      audioSha256: record.request.audioSha256,
      audioLocalInterval: {
        start: 0,
        end: record.request.sampleCount / record.request.sampleRate,
      },
      mediaGlobalInterval: record.request.sourceInterval,
    };
    const whisperAttempt = await worker.align({
      ...common,
      attemptId: `ctc-c6019:${event.eventId}:whisper`,
      targetText: whisper.pronunciationText,
    });
    const reazonAttempt = await worker.align({
      ...common,
      attemptId: `ctc-c6019:${event.eventId}:reazon`,
      targetText: event.reazonCandidate.pronunciationText,
    });
    ctcInferenceCount += 2;
    ctcModelLoadCount +=
      whisperAttempt.modelLoadCount + reazonAttempt.modelLoadCount;
    ctcAttempts.push(whisperAttempt, reazonAttempt);
    ctcEvidence.push({
      eventId: event.eventId,
      whisperProjection: whisper.pronunciationText,
      reazonProjection: event.reazonCandidate.pronunciationText,
      ctcWhisperEvidence: whisperAttempt.normalizedPathLogScore,
      ctcReazonEvidence: reazonAttempt.normalizedPathLogScore,
      evidenceIds: [whisperAttempt.attemptId, reazonAttempt.attemptId],
    });
    process.stderr.write(
      `C6.0.1.9 CTC ${ctcEvidence.length}: ${event.eventId}\n`,
    );
  }
} finally {
  await worker.close();
}
const ctcArbitration = buildMachineCrossModelCtcArbitration({
  generatedAt: GENERATED_AT,
  comparison,
  ctcRuntimeIdentityHash: verifiedCtc.runtime.runtimeIdentityHash,
  ctcModelSnapshotHash: verifiedCtc.model.modelSnapshotHash,
  evidence: ctcEvidence,
  inferenceCount: ctcInferenceCount,
  modelLoadCount: ctcModelLoadCount,
});
const ctcById = new Map(
  ctcArbitration.events.map((event) => [event.eventId, event]),
);
const shadowCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.9-independent-asr-complementarity-v1" as const,
  generatedAt: GENERATED_AT,
  artifactType: "machine-cross-model-shadow-candidate" as const,
  comparisonSemanticHash: comparison.semanticHash,
  ctcArbitrationSemanticHash: ctcArbitration.semanticHash,
  winnerSelectionPolicyImplemented: false as const,
  productionMutationAllowed: false as const,
  events: comparison.events.map((event) => {
    const core = {
      eventId: event.eventId,
      agreementClass: event.disagreementClass,
      ctcOutcome: ctcById.get(event.eventId)?.outcome ?? null,
      ambiguityRetained: true,
      candidateWinnerId: null,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  }),
  runtimeGoldInputCount: 0 as const,
};
const shadow = machineCrossModelShadowCandidateSchema.parse({
  ...shadowCore,
  semanticHash: machineQualitySemanticHash(shadowCore),
});
const freezeCore = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.9-independent-asr-complementarity-v1",
  generatedAt: GENERATED_AT,
  artifactType: "c6-0-1-9-machine-freeze",
  runtimeGoldInputCount: 0,
  frozenBeforeGold: true,
  artifactSemanticHashes: {
    diagnosticSet: cache.diagnosticSet.semanticHash,
    runtime: cache.runtime.semanticHash,
    independentCandidates: cache.candidates.semanticHash,
    stability: cache.stability.semanticHash,
    comparison: comparison.semanticHash,
    ctcArbitration: ctcArbitration.semanticHash,
    shadow: shadow.semanticHash,
    qualityPolicy: machineQualitySemanticHash(cache.qualityPolicy),
  },
};
const machineFreeze = {
  ...freezeCore,
  machineFreezeHash: machineQualitySemanticHash({
    ...freezeCore,
    generatedAt: undefined,
  }),
};
const machineArtifacts = {
  "machine-second-asr-diagnostic-set.json": cache.diagnosticSet,
  "machine-independent-asr-runtime.json": cache.runtime,
  "machine-independent-asr-candidates.json": cache.candidates,
  "machine-second-asr-stability.json": cache.stability,
  "machine-cross-model-comparison.json": comparison,
  "machine-cross-model-ctc-arbitration.json": ctcArbitration,
  "machine-cross-model-ctc-attempts.json": {
    schemaVersion: "1.0.0",
    artifactType: "machine-cross-model-ctc-attempts",
    policyVersion: "c6.0.1.9-independent-asr-complementarity-v1",
    generatedAt: GENERATED_AT,
    correlationPolicy: "DATA_FAMILY_CORRELATED_NOT_AN_INDEPENDENT_VOTE",
    attempts: ctcAttempts,
    runtimeGoldInputCount: 0,
  },
  "machine-cross-model-shadow-candidate.json": shadow,
  "c6-0-1-9-quality-policy.json": cache.qualityPolicy,
  "c6-0-1-9-machine-freeze.json": machineFreeze,
};
const comparisonDirectory = path.join(
  argumentsValue.outputRoot,
  "carnation-c6-0-1-9-cross-model-comparison-20260829",
);
const comparisonSubtitle = await locateSubtitleDirectory(comparisonDirectory);
await Promise.all(
  Object.entries(machineArtifacts).map(([name, value]) =>
    writeJson(path.join(comparisonSubtitle, name), value),
  ),
);
await snapshot(
  argumentsValue.baseline,
  path.join(
    argumentsValue.outputRoot,
    "carnation-c6-0-1-9-ctc-arbitration-20260829",
  ),
  machineArtifacts,
);
Object.assign(cache, {
  whisperCandidates,
  comparison,
  ctcArbitration,
  ctcAttempts,
  shadow,
  machineFreeze,
});
await writeJson(argumentsValue.cacheFile, cache);

// Gold is first opened only after the complete machine freeze and CTC artifact
// have been persisted above.
const goldBuffer = await readFile(argumentsValue.gold);
if (sha256(goldBuffer) !== GOLD_SHA256)
  throw new Error("Gold identity mismatch.");
const goldCues = parseAss(
  normalizeC601GoldAssTimestamps(goldBuffer.toString("utf8")).content,
).map((cue, index) => ({
  cueId: `gold-cue-${String(index + 1).padStart(4, "0")}`,
  start: cue.start,
  end: cue.end,
  text: cue.text,
}));
const provisional = cache.diagnosticSet.events.map((event) => {
  const evaluationInterval = {
    start: Math.max(0, event.coreInterval.start - 0.35),
    end: event.coreInterval.end + 0.35,
  };
  const matched = goldCues.filter(
    (cue) => overlapSeconds(evaluationInterval, cue) > 0,
  );
  return { event, evaluationInterval, matched };
});
const machineCountByGold = new Map<string, number>();
for (const value of provisional) {
  for (const cue of value.matched) {
    machineCountByGold.set(
      cue.cueId,
      (machineCountByGold.get(cue.cueId) ?? 0) + 1,
    );
  }
}
const currentTextByEvent = new Map<string, string>();
for (const value of risk.events) {
  const current = pool.candidates.find(
    (candidate) =>
      candidate.eventId === value.eventId &&
      candidate.candidateId === value.candidateId,
  );
  if (current !== undefined)
    currentTextByEvent.set(value.eventId, current.text);
}
const localGold: LocalCrossModelGoldInput[] = provisional.map(
  ({ event, matched }) => ({
    eventId: event.eventId,
    diagnosticRole: event.role,
    evaluationStatus:
      matched.length === 0
        ? "UNEVALUABLE_INSUFFICIENT_REFERENCE"
        : matched.some((cue) => (machineCountByGold.get(cue.cueId) ?? 0) > 1)
          ? "EVALUABLE_WITH_AMBIGUITY"
          : matched.length === 1
            ? "EVALUABLE_EXACT_LOCAL"
            : "EVALUABLE_MONOTONIC_LOCAL",
    goldText:
      matched.length === 0 ? null : matched.map((cue) => cue.text).join(""),
    currentWhisperText: currentTextByEvent.get(event.eventId) ?? null,
  }),
);
const localGoldArtifact = {
  schemaVersion: "1.0.0",
  artifactType: "gold-local-second-asr-evaluation",
  policyVersion: "c6.0.1.9-independent-asr-complementarity-v1",
  generatedAt: GENERATED_AT,
  evaluationPhase: "post-freeze-gold-isolated",
  machineFreezeHash: machineFreeze.machineFreezeHash,
  goldIdentityHash: GOLD_SHA256,
  goldTextIncluded: false,
  evaluationMarginSeconds: 0.35,
  events: localGold.map((event) => ({
    eventId: event.eventId,
    diagnosticRole: event.diagnosticRole,
    evaluationStatus: event.evaluationStatus,
    goldTextHash:
      event.goldText === null
        ? null
        : machineQualitySemanticHash(
            normalizeIndependentAsrLexical(event.goldText),
          ),
  })),
  summary: {
    targetEvaluableCount: localGold.filter(
      (event) => event.diagnosticRole === "TARGET" && event.goldText !== null,
    ).length,
    controlEvaluableCount: localGold.filter(
      (event) => event.diagnosticRole === "CONTROL" && event.goldText !== null,
    ).length,
  },
  runtimeGoldInputCount: 0,
};
const complementarity = buildGoldCrossModelComplementarityEvaluation({
  generatedAt: GENERATED_AT,
  machineFreezeHash: machineFreeze.machineFreezeHash,
  goldIdentityHash: GOLD_SHA256,
  comparison,
  ctcArbitration,
  localGold,
});
const oracle = buildMachineCrossModelUnionOracleEvaluation({
  generatedAt: GENERATED_AT,
  complementarity,
});
const controls = buildGoldSecondAsrControlRegression({
  generatedAt: GENERATED_AT,
  complementarity,
  comparison,
});
const route = buildC6019RouteDecision({
  generatedAt: GENERATED_AT,
  complementarity,
  oracle,
  controls,
  stability: cache.stability,
});
const evaluationArtifacts = {
  ...machineArtifacts,
  "gold-local-second-asr-evaluation.json": localGoldArtifact,
  "gold-cross-model-complementarity-evaluation.json": complementarity,
  "machine-cross-model-union-oracle-evaluation.json": oracle,
  "gold-second-asr-control-regression.json": controls,
  "c6-0-1-9-route-decision.json": route,
};
await snapshot(
  argumentsValue.baseline,
  path.join(
    argumentsValue.outputRoot,
    "carnation-c6-0-1-9-complementarity-evaluation-20260829",
  ),
  evaluationArtifacts,
);
await snapshot(
  argumentsValue.baseline,
  path.join(
    argumentsValue.outputRoot,
    "carnation-c6-0-1-9-union-oracle-20260829",
  ),
  evaluationArtifacts,
);
await snapshot(
  argumentsValue.baseline,
  path.join(
    argumentsValue.outputRoot,
    "carnation-c6-0-1-9-control-evaluation-20260829",
  ),
  evaluationArtifacts,
);
await snapshot(
  argumentsValue.baseline,
  path.join(
    argumentsValue.outputRoot,
    "carnation-c6-0-1-9-route-decision-20260829",
  ),
  evaluationArtifacts,
);
Object.assign(cache, {
  localGoldArtifact,
  complementarity,
  oracle,
  controls,
  route,
});
await writeJson(argumentsValue.cacheFile, cache);

process.stdout.write(
  `${JSON.stringify(
    {
      comparison: comparison.summary,
      ctc: ctcArbitration.summary,
      localEvaluation: localGoldArtifact.summary,
      complementarity: complementarity.summary,
      oracle: oracle.summary,
      controls: controls.summary,
      route,
      machineFreezeHash: machineFreeze.machineFreezeHash,
    },
    null,
    2,
  )}\n`,
);
