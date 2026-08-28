import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  machineCanonicalEventsSchema,
  machineCandidatePoolC6015Schema,
  machineFreshTargetedReAsrSchema,
  machineReAsrRiskV2Schema,
  machineVadGlobalTimebaseSchema,
  machineVariantEvidenceBundleSchema,
} from "@mvl/shared";
import { parseAss } from "@mvl/subtitle-core";
import {
  buildC6018QualityPolicy,
  buildC6018RouteDecision,
  buildGoldLocalCoreEvaluation,
  buildMachineCoreAcousticSpan,
  buildMachineCoreAsrStability,
  buildMachineCoreCandidateOracleEvaluation,
  buildMachineCoreTextProjection,
  buildMachineLocalizedCandidateComparability,
  buildMachineWhisperCoreStabilityEvaluation,
  buildReusedFreshCoreVerification,
  machineQualitySemanticHash,
  normalizeC601GoldAssTimestamps,
  normalizeCandidateText,
  type CoreProjectionCandidateInput,
  type CoreSpanFreshTokenInput,
  type CoreSpanVadInput,
} from "@mvl/video-subtitler";

type ThroughStage =
  | "baseline"
  | "core-span"
  | "core-projection"
  | "comparability"
  | "stability"
  | "local-evaluation"
  | "core-fresh-verification"
  | "final-diagnosis"
  | "final";

interface Arguments {
  baseline: string;
  fresh: string;
  output: string;
  through: ThroughStage;
  generatedAt: string;
  gold: string | null;
  qualityMetrics: string | null;
}

const stageRank: Record<ThroughStage, number> = {
  baseline: 0,
  "core-span": 1,
  "core-projection": 2,
  comparability: 3,
  stability: 4,
  "local-evaluation": 5,
  "core-fresh-verification": 6,
  "final-diagnosis": 7,
  final: 8,
};

function requiredArgument(values: readonly string[], flag: string): string {
  const index = values.indexOf(flag);
  const value = index < 0 ? undefined : values[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument ${flag}.`);
  }
  return path.resolve(value);
}

function optionalArgument(
  values: readonly string[],
  flag: string,
): string | null {
  const index = values.indexOf(flag);
  const value = index < 0 ? undefined : values[index + 1];
  return value === undefined || value.startsWith("--")
    ? null
    : path.resolve(value);
}

function parseArguments(values: readonly string[]): Arguments {
  const throughIndex = values.indexOf("--through");
  const through = values[throughIndex + 1] as ThroughStage | undefined;
  if (through === undefined || !(through in stageRank)) {
    throw new Error(
      "--through must be baseline, core-span, core-projection, comparability, stability, local-evaluation, core-fresh-verification, final-diagnosis, or final.",
    );
  }
  const generatedAtIndex = values.indexOf("--generated-at");
  const generatedAt =
    generatedAtIndex < 0
      ? new Date().toISOString()
      : (values[generatedAtIndex + 1] ?? "");
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("--generated-at must be an ISO-8601 timestamp.");
  }
  const result = {
    baseline: requiredArgument(values, "--baseline"),
    fresh: requiredArgument(values, "--fresh"),
    output: requiredArgument(values, "--output"),
    through,
    generatedAt,
    gold: optionalArgument(values, "--gold"),
    qualityMetrics: optionalArgument(values, "--quality-metrics"),
  };
  if (
    stageRank[through] >= stageRank["local-evaluation"] &&
    result.gold === null
  ) {
    throw new Error(
      "--gold is required only for post-freeze local evaluation stages.",
    );
  }
  if (
    stageRank[through] >= stageRank["final-diagnosis"] &&
    result.qualityMetrics === null
  ) {
    throw new Error(
      "--quality-metrics is required for the final route decision.",
    );
  }
  return result;
}

async function json<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function outputAbsent(directory: string): Promise<void> {
  try {
    await access(directory);
  } catch {
    return;
  }
  throw new Error(`Output already exists; refusing to overwrite: ${directory}`);
}

async function locateSubtitleDirectory(taskDirectory: string): Promise<string> {
  const entries = await readdir(taskDirectory, { withFileTypes: true });
  const matches = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(
      `Expected exactly one subtitle directory under ${taskDirectory}; found ${matches.length}.`,
    );
  }
  return path.join(taskDirectory, matches[0].name);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function sourceForPoolCandidate(input: {
  candidateId: string;
  currentCandidateId: string;
  origin: string;
}): "ORIGINAL" | "RECOVERY" | "HISTORICAL_REASR" {
  if (input.candidateId === input.currentCandidateId) return "ORIGINAL";
  if (/re-?asr/iu.test(input.origin) || /c601[45]-/u.test(input.candidateId)) {
    return "HISTORICAL_REASR";
  }
  return "RECOVERY";
}

function strictC602QualityGate(metrics: Record<string, unknown>): boolean {
  const numberValue = (key: string) =>
    typeof metrics[key] === "number" ? metrics[key] : Number.POSITIVE_INFINITY;
  return (
    numberValue("goldCoverage") >= 0.9 &&
    numberValue("missingCount") <= 15 &&
    numberValue("hallucinationCount") <= 2 &&
    numberValue("materialErrorCount") <= 45 &&
    numberValue("normalizedCer") <= 0.55 &&
    numberValue("severeTimingErrorCount") <= 30 &&
    numberValue("startMaeSeconds") <= 1.2 &&
    numberValue("endMaeSeconds") <= 1.2 &&
    numberValue("p95BoundaryErrorSeconds") <= 3.5 &&
    numberValue("overlapPairCount") <= 20
  );
}

const argumentsValue = parseArguments(process.argv.slice(2));
await outputAbsent(argumentsValue.output);
const baselineSubtitle = await locateSubtitleDirectory(argumentsValue.baseline);
const freshSubtitle = await locateSubtitleDirectory(argumentsValue.fresh);

const [
  risk,
  canonicalEvents,
  candidatePool,
  evidenceBundle,
  vadTimebase,
  fresh,
] = await Promise.all([
  json(path.join(baselineSubtitle, "machine-reasr-risk-v2.json")).then(
    (value) => machineReAsrRiskV2Schema.parse(value),
  ),
  json(path.join(baselineSubtitle, "machine-canonical-events.json")).then(
    (value) => machineCanonicalEventsSchema.parse(value),
  ),
  json(
    path.join(baselineSubtitle, "machine-candidate-pool-c6-0-1-5.json"),
  ).then((value) => machineCandidatePoolC6015Schema.parse(value)),
  json(
    path.join(baselineSubtitle, "machine-variant-evidence-bundle.json"),
  ).then((value) => machineVariantEvidenceBundleSchema.parse(value)),
  json(path.join(baselineSubtitle, "machine-vad-global-timebase.json")).then(
    (value) => machineVadGlobalTimebaseSchema.parse(value),
  ),
  json(path.join(freshSubtitle, "machine-fresh-targeted-reasr.json")).then(
    (value) => machineFreshTargetedReAsrSchema.parse(value),
  ),
]);

if (
  fresh.generationKind !== "FRESH_INFERENCE" ||
  fresh.summary.freshInferenceCount !== 36 ||
  fresh.summary.cacheHitCount !== 0
) {
  throw new Error(
    "The supplied Fresh task is not the verified 36-inference C6.0.1.7 generation artifact.",
  );
}
if (
  fresh.sourceIdentity.sourceMediaSha256 !==
  vadTimebase.sourceIdentity.sourceMediaSha256
) {
  throw new Error("Fresh and baseline source identities do not match.");
}

const selectedRiskEvents = risk.events.filter((event) => event.budgetSelected);
const selectedEventIds = new Set(
  selectedRiskEvents.map((event) => event.eventId),
);
const currentCandidateIdsByEvent = new Map(
  selectedRiskEvents.map(
    (event) => [event.eventId, event.candidateId] as const,
  ),
);
const freshTokens: CoreSpanFreshTokenInput[] = fresh.requests.flatMap(
  (request) =>
    request.tokens.map((token) => ({
      eventId: request.eventId,
      requestId: request.requestId,
      windowType: request.windowType,
      tokenId: token.tokenId,
      interval: token.sourceGlobalInterval,
      mappingVerified: token.mappingVerified,
      lexical: !token.special && normalizeCandidateText(token.text) !== "",
    })),
);
const vadSegments: CoreSpanVadInput[] = vadTimebase.vadSegments.map(
  (segment) => ({
    interval: {
      start:
        segment.sourceGlobalStartSample /
        vadTimebase.sourceIdentity.sourceSampleRate,
      end:
        segment.sourceGlobalEndSample /
        vadTimebase.sourceIdentity.sourceSampleRate,
    },
    evidenceId: `${segment.vadSegmentId}:${segment.timebaseSemanticHash}`,
  }),
);

const coreSpans = buildMachineCoreAcousticSpan({
  mode: "observe",
  sourceMediaSha256: vadTimebase.sourceIdentity.sourceMediaSha256,
  sourceDurationSeconds:
    vadTimebase.sourceIdentity.sourceTotalSamples /
    vadTimebase.sourceIdentity.sourceSampleRate,
  sourceReadOnlyVerified: vadTimebase.sourceIdentity.sourceReadOnlyVerified,
  selectionSemanticHash: risk.semanticHash,
  selectedEventIds,
  events: canonicalEvents.events,
  vadSegments,
  freshTokens,
  generatedAt: argumentsValue.generatedAt,
});

const evidenceByVariant = new Map(
  evidenceBundle.variants.map(
    (variant) => [variant.variantId, variant] as const,
  ),
);
const poolProjectionInputs: CoreProjectionCandidateInput[] =
  candidatePool.candidates.flatMap((candidate) => {
    if (!selectedEventIds.has(candidate.eventId)) return [];
    const currentCandidateId = currentCandidateIdsByEvent.get(
      candidate.eventId,
    );
    if (currentCandidateId === undefined) return [];
    const isRelevant =
      candidate.candidateId === currentCandidateId ||
      /re-?asr/iu.test(candidate.origin) ||
      /recovery/iu.test(candidate.origin) ||
      /recovery/iu.test(candidate.candidateId);
    if (!isRelevant) return [];
    const evidence = evidenceByVariant.get(candidate.variantId);
    return [
      {
        eventId: candidate.eventId,
        candidateId: candidate.candidateId,
        origin: sourceForPoolCandidate({
          candidateId: candidate.candidateId,
          currentCandidateId,
          origin: candidate.origin,
        }),
        requestId: candidate.requestIds[0] ?? null,
        sourceGlobalInterval: candidate.interval,
        text: candidate.text,
        tokens: [],
        ctcSupport: evidence?.ctcScore ?? null,
        pronunciationSupport: evidence?.ctcScore ?? null,
        evidenceIds: [
          candidate.semanticHash,
          ...(evidence ? [evidence.semanticHash] : []),
        ],
      } satisfies CoreProjectionCandidateInput,
    ];
  });

const freshOrigin = {
  "near-exact": "FRESH_A",
  "small-context": "FRESH_B",
  "expanded-context": "FRESH_C",
} as const;
const freshProjectionInputs: CoreProjectionCandidateInput[] =
  fresh.requests.map((request) => {
    const matchingCandidates = fresh.candidates.filter(
      (candidate) =>
        candidate.eventId === request.eventId &&
        normalizeCandidateText(candidate.text) ===
          normalizeCandidateText(request.responseText),
    );
    const matchingCandidate = matchingCandidates.toSorted(
      (left, right) =>
        (right.ctcEvidence.score ?? -1) - (left.ctcEvidence.score ?? -1) ||
        left.candidateId.localeCompare(right.candidateId),
    )[0];
    return {
      eventId: request.eventId,
      candidateId: `c6017-fresh-window:${request.requestId}`,
      origin: freshOrigin[request.windowType],
      requestId: request.requestId,
      sourceGlobalInterval: request.sourceGlobalInterval,
      text: request.responseText,
      tokens: request.tokens.map((token) => ({
        tokenId: token.tokenId,
        text: token.text,
        interval: token.sourceGlobalInterval,
        mappingVerified: token.mappingVerified,
        lexical: !token.special && normalizeCandidateText(token.text) !== "",
        probability: token.probability,
      })),
      ctcSupport: matchingCandidate?.ctcEvidence.score ?? null,
      pronunciationSupport: matchingCandidate?.ctcEvidence.score ?? null,
      evidenceIds: [
        request.semanticHash,
        request.decoderEvidence.semanticHash,
        ...(matchingCandidate ? [matchingCandidate.semanticHash] : []),
      ],
    } satisfies CoreProjectionCandidateInput;
  });

const projection = buildMachineCoreTextProjection({
  mode: "observe",
  coreSpans,
  candidates: [...poolProjectionInputs, ...freshProjectionInputs],
  generatedAt: argumentsValue.generatedAt,
});
const comparability = buildMachineLocalizedCandidateComparability({
  mode: "observe",
  coreSpans,
  projection,
  generatedAt: argumentsValue.generatedAt,
});
const stability = buildMachineCoreAsrStability({
  mode: "observe",
  projection,
  comparability,
  generatedAt: argumentsValue.generatedAt,
});
const unresolvedEventIds = stability.events
  .filter(
    (event) =>
      event.class !== "CORE_TEXT_CONSISTENT" &&
      event.class !== "CONTEXT_ONLY_DIFFERENCE",
  )
  .map((event) => event.eventId);
const requestCountByEvent = new Map<string, number>();
for (const request of fresh.requests) {
  requestCountByEvent.set(
    request.eventId,
    (requestCountByEvent.get(request.eventId) ?? 0) + 1,
  );
}
const existingFreshSufficient = selectedRiskEvents.every(
  (event) => (requestCountByEvent.get(event.eventId) ?? 0) === 3,
);
const freshVerification = buildReusedFreshCoreVerification({
  c6017Fresh: fresh,
  unresolvedEventIds,
  existingFreshSufficient,
  generatedAt: argumentsValue.generatedAt,
});
const policy = buildC6018QualityPolicy(argumentsValue.generatedAt);
const machineFreezeCore = {
  artifactType: "c6-0-1-8-machine-freeze" as const,
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.8-core-span-asr-stability-v1" as const,
  generatedAt: argumentsValue.generatedAt,
  runtimeGoldInputCount: 0 as const,
  artifactSemanticHashes: {
    coreSpan: coreSpans.semanticHash,
    projection: projection.semanticHash,
    comparability: comparability.semanticHash,
    stability: stability.semanticHash,
    freshVerification: freshVerification.semanticHash,
    policy: policy.semanticHash,
  },
};
const machineFreeze = {
  ...machineFreezeCore,
  machineFreezeHash: machineQualitySemanticHash({
    ...machineFreezeCore,
    generatedAt: undefined,
  }),
};

await cp(argumentsValue.baseline, argumentsValue.output, {
  recursive: true,
  preserveTimestamps: true,
});
const outputSubtitle = await locateSubtitleDirectory(argumentsValue.output);
await writeJson(
  path.join(outputSubtitle, "c6-0-1-8-quality-policy.json"),
  policy,
);
if (stageRank[argumentsValue.through] >= stageRank["core-span"]) {
  await writeJson(
    path.join(outputSubtitle, "machine-core-acoustic-span.json"),
    coreSpans,
  );
}
if (stageRank[argumentsValue.through] >= stageRank["core-projection"]) {
  await writeJson(
    path.join(outputSubtitle, "machine-core-text-projection.json"),
    projection,
  );
}
if (stageRank[argumentsValue.through] >= stageRank.comparability) {
  await writeJson(
    path.join(outputSubtitle, "machine-localized-candidate-comparability.json"),
    comparability,
  );
}
if (stageRank[argumentsValue.through] >= stageRank.stability) {
  await writeJson(
    path.join(outputSubtitle, "machine-core-asr-stability.json"),
    stability,
  );
  await writeJson(
    path.join(outputSubtitle, "c6-0-1-8-machine-freeze.json"),
    machineFreeze,
  );
}
if (stageRank[argumentsValue.through] >= stageRank["core-fresh-verification"]) {
  await writeJson(
    path.join(outputSubtitle, "machine-core-fresh-verification.json"),
    freshVerification,
  );
}

let postFreezeArtifacts:
  | {
      goldEvaluation: ReturnType<
        typeof buildGoldLocalCoreEvaluation
      >["artifact"];
      oracle: ReturnType<typeof buildMachineCoreCandidateOracleEvaluation>;
      whisperEvaluation: ReturnType<
        typeof buildMachineWhisperCoreStabilityEvaluation
      >;
      routeDecision: ReturnType<typeof buildC6018RouteDecision> | null;
      goldSha256: string;
    }
  | undefined;

if (stageRank[argumentsValue.through] >= stageRank["local-evaluation"]) {
  // Gold is intentionally first opened only after all machine artifacts above
  // have been built, frozen, and persisted.
  const goldPath = argumentsValue.gold;
  if (goldPath === null) throw new Error("Gold path unexpectedly missing.");
  const goldBuffer = await readFile(goldPath);
  const goldSha256 = sha256(goldBuffer);
  const normalizedGold = normalizeC601GoldAssTimestamps(
    goldBuffer.toString("utf8"),
  ).content;
  const goldCues = parseAss(normalizedGold).map((cue, index) => ({
    cueId: `gold-cue-${String(index + 1).padStart(4, "0")}`,
    start: cue.start,
    end: cue.end,
    text: cue.text,
  }));
  const localGold = buildGoldLocalCoreEvaluation({
    coreSpans,
    goldCues,
    goldIdentityHash: goldSha256,
    machineFreezeHash: machineFreeze.machineFreezeHash,
    generatedAt: argumentsValue.generatedAt,
  });
  const oracle = buildMachineCoreCandidateOracleEvaluation({
    projection,
    goldEvaluation: localGold.artifact,
    goldTextByEvent: localGold.goldTextByEvent,
    currentCandidateIdsByEvent,
    machineFreezeHash: machineFreeze.machineFreezeHash,
    generatedAt: argumentsValue.generatedAt,
  });
  const whisperEvaluation = buildMachineWhisperCoreStabilityEvaluation({
    stability,
    goldEvaluation: localGold.artifact,
    oracle,
    generatedAt: argumentsValue.generatedAt,
  });
  let routeDecision: ReturnType<typeof buildC6018RouteDecision> | null = null;
  if (stageRank[argumentsValue.through] >= stageRank["final-diagnosis"]) {
    const metricsPath = argumentsValue.qualityMetrics;
    if (metricsPath === null)
      throw new Error("Quality metrics path unexpectedly missing.");
    const metrics = await json<Record<string, unknown>>(metricsPath);
    routeDecision = buildC6018RouteDecision({
      comparability,
      evaluation: whisperEvaluation,
      oracle,
      strictC602QualityGatePassed: strictC602QualityGate(metrics),
      generatedAt: argumentsValue.generatedAt,
    });
  }
  postFreezeArtifacts = {
    goldEvaluation: localGold.artifact,
    oracle,
    whisperEvaluation,
    routeDecision,
    goldSha256,
  };
  await writeJson(
    path.join(outputSubtitle, "gold-local-core-evaluation.json"),
    localGold.artifact,
  );
  await writeJson(
    path.join(outputSubtitle, "machine-core-candidate-oracle-evaluation.json"),
    oracle,
  );
  await writeJson(
    path.join(outputSubtitle, "machine-whisper-core-stability-evaluation.json"),
    whisperEvaluation,
  );
  if (routeDecision !== null) {
    await writeJson(
      path.join(outputSubtitle, "c6-0-1-8-route-decision.json"),
      routeDecision,
    );
  }
}

const baselineStats = await stat(argumentsValue.baseline);
const auditCore = {
  artifactType: "c6-0-1-8-machine-run-audit" as const,
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.8-core-span-asr-stability-v1" as const,
  generatedAt: argumentsValue.generatedAt,
  throughStage: argumentsValue.through,
  baselineDirectoryIdentity: machineQualitySemanticHash({
    basename: path.basename(argumentsValue.baseline),
    modifiedMilliseconds: baselineStats.mtimeMs,
  }),
  sourceMediaSha256: fresh.sourceIdentity.sourceMediaSha256,
  c6017FreshSemanticHash: fresh.semanticHash,
  machineFreezeHash: machineFreeze.machineFreezeHash,
  runtimeGoldInputCount: 0 as const,
  goldReadAfterMachineFreeze: postFreezeArtifacts !== undefined,
  goldIdentityHash: postFreezeArtifacts?.goldSha256 ?? null,
  networkUsed: false as const,
  canonicalTextMutationCount: 0 as const,
  canonicalTimingMutationCount: 0 as const,
  presentationMutationCount: 0 as const,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  artifactSemanticHashes: {
    policy: policy.semanticHash,
    coreSpan:
      stageRank[argumentsValue.through] >= stageRank["core-span"]
        ? coreSpans.semanticHash
        : null,
    projection:
      stageRank[argumentsValue.through] >= stageRank["core-projection"]
        ? projection.semanticHash
        : null,
    comparability:
      stageRank[argumentsValue.through] >= stageRank.comparability
        ? comparability.semanticHash
        : null,
    stability:
      stageRank[argumentsValue.through] >= stageRank.stability
        ? stability.semanticHash
        : null,
    freshVerification:
      stageRank[argumentsValue.through] >= stageRank["core-fresh-verification"]
        ? freshVerification.semanticHash
        : null,
    goldLocalEvaluation:
      postFreezeArtifacts?.goldEvaluation.semanticHash ?? null,
    oracle: postFreezeArtifacts?.oracle.semanticHash ?? null,
    whisperEvaluation:
      postFreezeArtifacts?.whisperEvaluation.semanticHash ?? null,
    routeDecision: postFreezeArtifacts?.routeDecision?.semanticHash ?? null,
  },
};
await writeJson(
  path.join(argumentsValue.output, "c6-0-1-8-machine-run-audit.json"),
  {
    ...auditCore,
    semanticHash: machineQualitySemanticHash({
      ...auditCore,
      generatedAt: undefined,
    }),
  },
);

console.log(
  JSON.stringify(
    {
      output: argumentsValue.output,
      through: argumentsValue.through,
      selectedEvents: selectedRiskEvents.length,
      coreSummary: coreSpans.summary,
      projectionSummary: projection.summary,
      comparabilitySummary: comparability.summary,
      stabilitySummary: stability.summary,
      freshVerificationDecision: freshVerification.decision,
      localGoldSummary: postFreezeArtifacts?.goldEvaluation.summary ?? null,
      oracleSummary: postFreezeArtifacts?.oracle.summary ?? null,
      diagnosisSummary: postFreezeArtifacts?.whisperEvaluation.summary ?? null,
      routeDecision: postFreezeArtifacts?.routeDecision ?? null,
    },
    null,
    2,
  ),
);
