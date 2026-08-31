/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Revalidate literals at runtime trust boundaries. */
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  atomicWriteJson,
  c60114ProbeExecutionSchema,
  c60114ProbeRequestSchema,
  c60114ProbeTargetSchema,
  c60114PolicySchema,
  c60114SourceIdentitySchema,
  type C60114Policy,
  type C60114ProbeTarget,
  type C60114SourceIdentity,
  type C60114ProbeExecution,
  type C60114ProbeProvider,
  type C60114ProbeRequest,
  type C60114ProbeRuntime,
  type C60114ProbeToken,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  assertC60114ProbePersistenceSchema,
  buildC60114ProbePersistence,
  writeC60114ProbeJournal,
  C60114ProbePersistenceError,
} from "./c60114-probe-persistence.js";
import {
  genericHallucinationRisk,
  normalizeIndependentAsrLexical,
} from "../machine-quality/cross-model-normalization.js";
import { assertC60112MachineOnlyInput } from "./c60112-policy.js";

export const C60114_PROBE_CACHE_NAMESPACE =
  "c6.0.1.14-missing-local-probes-v1" as const;
export class C60114ProbeReplayError extends Error {
  constructor(readonly artifact: C60114ProbeExecution) {
    super("C60114_EXACT_CACHE_REPLAY_FAILED_CLOSED");
    this.name = "C60114ProbeReplayError";
  }
}
interface C60114Interval {
  start: number;
  end: number;
}
export interface C60114ProbeAudio {
  audioPath: string;
  audioSha256: string;
  sampleCount: number;
}
export interface C60114ProbeRawResult {
  status: "SUCCESS" | "EMPTY_OUTPUT" | "PROVIDER_ERROR";
  text: string;
  rawOutput: C60114ProbeRequest["rawOutput"];
  tokens: C60114ProbeToken[];
  decoder: C60114ProbeRequest["decoder"];
  warnings: string[];
  wallClockSeconds: number;
  inferenceExecuted?: boolean;
}
export interface C60114ProbeRuntimeAdapter {
  identities: C60114ProbeRuntime[];
  extract(request: C60114ProbeRequest): Promise<C60114ProbeAudio>;
  transcribe(
    request: C60114ProbeRequest,
    audio: C60114ProbeAudio,
  ): Promise<C60114ProbeRawResult>;
  counts(): {
    modelLoadCount: number;
    processStartCount: number;
    perProvider?: Partial<
      Record<
        C60114ProbeProvider,
        { modelLoadCount: number; processStartCount: number }
      >
    >;
  };
  close(): Promise<void>;
}
export interface C60114ProbePlanInput {
  targets: readonly C60114ProbeTarget[];
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  policyHash: string;
  selectionHash: string;
  cacheDirectory: string;
  mode: "fresh" | "exact-cache-only";
  generatedAt: string;
  adapter: C60114ProbeRuntimeAdapter;
  onProgress?: (progress: {
    requestId: string;
    completed: number;
    status: string;
    execution: string;
  }) => void;
}

// Execution topology and elapsed time are provenance, never evidence. Raw token,
// decoder, model, source, selection, and window identities remain hash-bound.
const nonsemantic = new Set([
  "semanticHash",
  "rawOutputHash",
  "manifestSha256",
  "generatedAt",
  "execution",
  "mode",
  "accounting",
  "completion",
  "persistence",
  "budgetException",
  "wallClockSeconds",
  "modelLoadSeconds",
  "peakRssBytes",
  "processStartCount",
  "modelLoadCount",
  "audioPath",
  "outputDirectory",
  "cacheDirectory",
]);
export function c60114ProbeSemanticPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(c60114ProbeSemanticPayload);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !nonsemantic.has(key))
        .map(([key, child]) => [key, c60114ProbeSemanticPayload(child)]),
    );
  return value;
}
export function c60114ProbeSemanticHash(value: unknown): string {
  return machineQualitySemanticHash(c60114ProbeSemanticPayload(value));
}
function overlap(a: C60114Interval, b: C60114Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}
function valid(interval: C60114Interval): boolean {
  return (
    Number.isFinite(interval.start) &&
    Number.isFinite(interval.end) &&
    interval.start >= 0 &&
    interval.end > interval.start
  );
}

export function assertC60114ProbeBudget(
  input: Pick<C60114ProbePlanInput, "targets" | "sourceIdentity" | "policy">,
): void {
  c60114PolicySchema.parse(input.policy);
  c60114SourceIdentitySchema.parse(input.sourceIdentity);
  for (const target of input.targets) c60114ProbeTargetSchema.parse(target);
  assertC60112MachineOnlyInput(input.targets);
  if (
    input.targets.length > Math.min(24, input.policy.probes.maxTargets) ||
    new Set(input.targets.map((t) => t.targetId)).size !== input.targets.length
  )
    throw new Error("C60114_TARGET_BUDGET_OR_DUPLICATE");
  if (
    input.policy.probes.maxRequests > 64 ||
    input.policy.probes.maxContextTargets > 8 ||
    input.policy.probes.providerCount !== 2
  )
    throw new Error("C60114_POLICY_BUDGET_EXCEEDS_HARD_CAP");
  for (const target of input.targets) {
    const span = target.sourceInterval;
    if (
      !valid(span) ||
      span.end > input.sourceIdentity.durationSeconds ||
      span.end - span.start > Math.min(12, input.policy.speech.maxSeconds) ||
      span.end - span.start >= input.sourceIdentity.durationSeconds ||
      !target.validTimebase ||
      !target.speechPositive
    )
      throw new Error(
        `C60114_INVALID_OR_WHOLE_MEDIA_TARGET:${target.targetId}`,
      );
  }
}
export function c60114ProbeWindow(
  target: C60114ProbeTarget,
  source: C60114SourceIdentity,
  policy: C60114Policy,
  windowType: C60114ProbeRequest["windowType"],
): C60114Interval {
  const margin =
    windowType === "CORE_EXACT"
      ? policy.exactGuardSeconds
      : policy.probes.contextMarginSeconds;
  if (margin < 0 || margin > (windowType === "CORE_EXACT" ? 0.05 : 1.5))
    throw new Error("C60114_EXCESSIVE_EXTRACTION_MARGIN");
  const interval = {
    start:
      Math.ceil(Math.max(0, target.sourceInterval.start - margin) * 1000) /
      1000,
    end:
      Math.floor(
        Math.min(source.durationSeconds, target.sourceInterval.end + margin) *
          1000,
      ) / 1000,
  };
  if (
    !valid(interval) ||
    interval.end - interval.start >
      Math.min(15, policy.probes.maxContextSeconds) + 1e-8 ||
    (interval.start <= 0 && interval.end >= source.durationSeconds)
  )
    throw new Error("C60114_UNBOUNDED_OR_WHOLE_MEDIA_PROBE");
  return interval;
}
export function localizeC60114Probe(input: {
  target: C60114ProbeTarget;
  request: Pick<
    C60114ProbeRequest,
    "windowType" | "coreInterval" | "extractionInterval"
  >;
  result: C60114ProbeRawResult;
  guardSeconds: number;
}): C60114ProbeRequest["localization"] {
  const { target, request, result } = input;
  const coreNeighborOverlapSeconds = target.neighborCueIntervals.reduce(
    (sum, neighbor) => sum + overlap(neighbor, request.coreInterval),
    0,
  );
  const guardNeighborOverlapSeconds = target.neighborCueIntervals.reduce(
    (sum, neighbor) =>
      sum +
      Math.max(
        0,
        overlap(neighbor, request.extractionInterval) -
          overlap(neighbor, request.coreInterval),
      ),
    0,
  );
  const base = {
    guardSeconds: input.guardSeconds,
    guardNeighborOverlapSeconds,
    coreNeighborOverlapSeconds,
    projectionTokenCount: 0,
  };
  if (result.status === "PROVIDER_ERROR")
    return {
      ...base,
      status: "FAILED",
      localizedText: null,
      completeness: "UNKNOWN",
      reasons: ["PROVIDER_FAILED_NOT_NEGATIVE_SPEECH_EVIDENCE"],
    };
  const lexical = normalizeIndependentAsrLexical(result.text);
  if (!lexical)
    return {
      ...base,
      status: "EMPTY",
      localizedText: null,
      completeness: "EMPTY",
      reasons: ["EMPTY_ASR_IS_NOT_NON_SPEECH_PROOF"],
    };
  if (
    request.windowType === "CORE_EXACT" &&
    guardNeighborOverlapSeconds <= 0.000001 &&
    coreNeighborOverlapSeconds <= 0.000001
  ) {
    return {
      ...base,
      status: "CORE_EXACT_ISLAND_LOCALIZED",
      localizedText: result.text,
      completeness: "WHOLE_EXACT_ISLAND",
      reasons: [
        "EXACT_SOURCE_ISLAND_WITH_BOUNDED_GUARD",
        "NO_NEIGHBOR_CUE_OVERLAP",
        "ISLAND_LOCALIZATION_NOT_WORD_OR_DISPLAY_TIMING",
      ],
    };
  }
  const textTokens = result.tokens.filter(
    (token) => normalizeIndependentAsrLexical(token.text) !== "",
  );
  const complete =
    textTokens.length > 0 &&
    textTokens.every(
      (token) => token.trusted && token.sourceInterval !== null,
    ) &&
    normalizeIndependentAsrLexical(
      textTokens.map((token) => token.text).join(""),
    ) === lexical;
  const monotonic =
    complete &&
    textTokens.every(
      (token, index) =>
        index === 0 ||
        (token.sourceInterval?.start ?? -1) >=
          (textTokens[index - 1]?.sourceInterval?.end ?? Infinity) - 0.05,
    );
  const selected = textTokens.filter(
    (token) =>
      token.trusted &&
      token.sourceInterval !== null &&
      token.sourceInterval.start >= request.coreInterval.start - 0.02 &&
      token.sourceInterval.end <= request.coreInterval.end + 0.02,
  );
  const crossing = textTokens.some(
    (token) =>
      token.sourceInterval !== null &&
      overlap(token.sourceInterval, request.coreInterval) > 0 &&
      !selected.includes(token),
  );
  const firstSelected = selected[0];
  const lastSelected = selected.at(-1);
  const contiguous =
    firstSelected !== undefined &&
    lastSelected !== undefined &&
    textTokens.indexOf(lastSelected) - textTokens.indexOf(firstSelected) + 1 ===
      selected.length;
  if (
    complete &&
    monotonic &&
    contiguous &&
    !crossing &&
    coreNeighborOverlapSeconds <= 0.000001
  )
    return {
      ...base,
      status: "TRUSTED_GLOBAL_TOKEN_PROJECTION",
      localizedText: selected.map((token) => token.text).join(""),
      completeness: "TOKEN_CHAIN_COMPLETE",
      projectionTokenCount: selected.length,
      reasons: [
        "ALL_LEXICAL_TOKENS_TRUSTED_MONOTONIC_AND_TEXT_COMPLETE",
        "NO_CORE_EDGE_TOKEN_CUT",
        "NO_CHARACTER_RATIO_TIMING",
      ],
    };
  return {
    ...base,
    status:
      request.windowType === "CORE_CONTEXT"
        ? "CONTEXT_TEXT_UNPROJECTABLE"
        : "CORE_GUARD_OR_NEIGHBOR_UNRESOLVED",
    localizedText: null,
    completeness: selected.length ? "PARTIAL" : "UNKNOWN",
    reasons: [
      "RAW_CONTEXT_TEXT_RETAINED_ONLY",
      !complete
        ? "FULL_LEXICAL_TOKEN_CHAIN_UNVERIFIED"
        : !monotonic
          ? "NON_MONOTONIC_TOKENS"
          : crossing
            ? "TOKEN_CROSSES_CORE_EDGE"
            : "NEIGHBOR_OR_LOCALIZATION_INCOMPLETE",
    ],
  };
}

export function selectC60114ContextTargets(
  targets: readonly C60114ProbeTarget[],
  requests: readonly C60114ProbeRequest[],
  maximum: number,
): C60114ProbeExecution["contextSelection"] {
  let selectedCount = 0;
  return targets.map((target) => {
    const exact = requests.filter(
      (request) =>
        request.targetId === target.targetId &&
        request.windowType === "CORE_EXACT",
    );
    const texts = exact.map((request) =>
      normalizeIndependentAsrLexical(request.localization.localizedText ?? ""),
    );
    const reasons: string[] = [];
    if (exact.some((request) => request.status === "EMPTY_OUTPUT"))
      reasons.push("EXACT_EMPTY");
    if (
      exact.some(
        (request) =>
          request.status !== "SUCCESS" && request.status !== "EMPTY_OUTPUT",
      )
    )
      reasons.push("EXACT_FAILED");
    if (texts.length === 2 && texts[0] !== texts[1])
      reasons.push("EXACT_CROSS_MODEL_DISAGREEMENT");
    if (exact.some((request) => request.hallucinationRisk >= 0.6))
      reasons.push("EXACT_HALLUCINATION_RISK");
    if (
      exact.some(
        (request) =>
          request.localization.status === "CORE_GUARD_OR_NEIGHBOR_UNRESOLVED",
      )
    )
      reasons.push("EXACT_LOCALIZATION_UNRESOLVED");
    if (
      exact.some(
        (request) =>
          request.decoder.temperature !== null &&
          request.decoder.temperature > 0,
      )
    )
      reasons.push("EXACT_DECODER_INSTABILITY");
    if (
      exact.some((request) =>
        request.tokens.some(
          (token) =>
            token.trusted &&
            token.sourceInterval !== null &&
            (Math.abs(
              token.sourceInterval.start - request.coreInterval.start,
            ) <= 0.02 ||
              Math.abs(token.sourceInterval.end - request.coreInterval.end) <=
                0.02),
        ),
      )
    )
      reasons.push("EXACT_TOKEN_EDGE_CONTACT");
    const selected = reasons.length > 0 && selectedCount < Math.min(8, maximum);
    if (selected) selectedCount++;
    if (reasons.length > 0 && !selected)
      reasons.push("CONTEXT_BUDGET_DEFERRED");
    return { targetId: target.targetId, selected, reasons };
  });
}

export function buildC60114ProbeRequestIdentity(
  input: Pick<
    C60114ProbePlanInput,
    "sourceIdentity" | "policy" | "policyHash" | "selectionHash"
  >,
  target: C60114ProbeTarget,
  runtime: C60114ProbeRuntime,
  windowType: C60114ProbeRequest["windowType"],
): C60114ProbeRequest {
  const extractionInterval = c60114ProbeWindow(
    target,
    input.sourceIdentity,
    input.policy,
    windowType,
  );
  const sourceIdentityHash = machineQualitySemanticHash(input.sourceIdentity);
  const extractionIdentityHash = machineQualitySemanticHash({
    namespace: C60114_PROBE_CACHE_NAMESPACE,
    sourceIdentityHash,
    extractionInterval,
    sampleRate: 16000,
    channels: 1,
    codec: "pcm_s16le",
    policy: "existing-resolveReviewAudio-source-video-input-seek-v1",
  });
  const cacheKey = machineQualitySemanticHash({
    namespace: C60114_PROBE_CACHE_NAMESPACE,
    sourceIdentityHash,
    extractionIdentityHash,
    targetId: target.targetId,
    coreInterval: target.sourceInterval,
    windowType,
    provider: runtime.provider,
    modelIdentityHash: runtime.modelIdentityHash,
    runtimeIdentityHash: runtime.runtimeIdentityHash,
    policyHash: input.policyHash,
    selectionHash: input.selectionHash,
    prompt: "",
    vadEnabled: false,
    language: "ja",
    tokenTimestamps: true,
    reazonPaddingSeconds: 0.9,
  });
  const base = {
    requestId: `c60114:${target.targetId}:${runtime.provider}:${windowType}`,
    targetId: target.targetId,
    provider: runtime.provider,
    windowType,
    coreInterval: target.sourceInterval,
    extractionInterval,
    sourceMediaSha256: input.sourceIdentity.sourceMediaSha256,
    sourceIdentityHash,
    policyHash: input.policyHash,
    selectionHash: input.selectionHash,
    audioSha256: null,
    sampleCount: null,
    extractionIdentityHash,
    cacheKey,
    runtimeIdentityHash: runtime.runtimeIdentityHash,
    modelIdentityHash: runtime.modelIdentityHash,
    prompt: "" as const,
    vadEnabled: false as const,
    status: "PROVIDER_ERROR" as const,
    execution: "NOT_EXECUTED" as const,
    rawText: "",
    rawOutput: null,
    rawOutputHash: null,
    tokens: [],
    decoder: {
      averageLogProbability: null,
      noSpeechProbability: null,
      temperature: null,
    },
    localization: {
      status: "FAILED" as const,
      localizedText: null,
      guardSeconds:
        windowType === "CORE_EXACT" ? input.policy.exactGuardSeconds : 0,
      guardNeighborOverlapSeconds: 0,
      coreNeighborOverlapSeconds: 0,
      completeness: "UNKNOWN" as const,
      projectionTokenCount: 0,
      reasons: ["NOT_EXECUTED"],
    },
    hallucinationRisk: 0,
    errorCode: null,
    warnings: [],
    wallClockSeconds: 0,
  };
  return { ...base, semanticHash: c60114ProbeSemanticHash(base) };
}

export async function executeC60114ProbePlan(
  input: C60114ProbePlanInput,
): Promise<C60114ProbeExecution> {
  assertC60114ProbePersistenceSchema();
  assertC60114ProbeBudget(input);
  const journalDirectory = path.join(
    input.cacheDirectory,
    "journal-runs",
    randomUUID(),
  );
  if (input.policyHash !== input.policy.semanticHash)
    throw new Error("C60114_PROBE_POLICY_HASH_MISMATCH");
  if (
    input.adapter.identities.length !== 2 ||
    new Set(input.adapter.identities.map((runtime) => runtime.provider))
      .size !== 2 ||
    input.adapter.identities.some((runtime) => !runtime.verified)
  )
    throw new Error("C60114_DUAL_RUNTIME_NOT_VERIFIED");
  const providerCounts = () => ({
    inferenceAttemptCount: 0,
    actualFreshInferences: 0,
    cacheHits: 0,
    failedRequests: 0,
    emptyOutputs: 0,
    modelLoadCount: 0,
    processStartCount: 0,
  });
  const accounting: C60114ProbeExecution["accounting"] = {
    selectedTargets: input.targets.length,
    contextTargets: 0,
    plannedRequests: 0,
    actualFreshInferences: 0,
    inferenceAttemptCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    extractionCount: 0,
    extractionFailures: 0,
    modelLoadCount: 0,
    processStartCount: 0,
    failedRequests: 0,
    emptyOutputs: 0,
    fullMediaRequests: 0,
    sourceMutationCount: 0,
    promptLeakageCount: 0,
    canonicalMutationCount: 0,
    perProvider: {
      "whisper-large-v3": providerCounts(),
      "reazonspeech-k2-v2": providerCounts(),
    },
  };
  const requests: C60114ProbeRequest[] = [];
  const audioByIdentity = new Map<string, C60114ProbeAudio>();
  async function run(
    target: C60114ProbeTarget,
    provider: C60114ProbeRuntime,
    windowType: C60114ProbeRequest["windowType"],
  ): Promise<void> {
    if (
      ++accounting.plannedRequests >
      Math.min(64, input.policy.probes.maxRequests)
    )
      throw new Error("C60114_REQUEST_BUDGET_EXCEEDED");
    let request = buildC60114ProbeRequestIdentity(
      input,
      target,
      provider,
      windowType,
    );
    const cachePath = path.join(
      input.cacheDirectory,
      C60114_PROBE_CACHE_NAMESPACE,
      provider.provider,
      `${request.cacheKey}.json`,
    );
    if (input.mode === "exact-cache-only") {
      try {
        const cached = c60114ProbeRequestSchema.parse(
          JSON.parse(await readFile(cachePath, "utf8")),
        );
        if (
          cached.cacheKey !== request.cacheKey ||
          cached.requestId !== request.requestId ||
          cached.sourceIdentityHash !== request.sourceIdentityHash ||
          cached.runtimeIdentityHash !== request.runtimeIdentityHash ||
          cached.modelIdentityHash !== request.modelIdentityHash ||
          cached.prompt !== "" ||
          cached.rawOutputHash !==
            (cached.rawOutput === null
              ? null
              : machineQualitySemanticHash(cached.rawOutput)) ||
          cached.semanticHash !== c60114ProbeSemanticHash(cached)
        )
          throw new Error("C60114_CACHE_IDENTITY_MISMATCH");
        request = {
          ...cached,
          execution: "VERIFIED_EXACT_REPLAY",
          wallClockSeconds: 0,
        };
        accounting.cacheHits++;
      } catch (error) {
        accounting.cacheMisses++;
        request.status =
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "CACHE_MISS"
            : "CACHE_INVALID";
        request.errorCode = request.status;
      }
    } else {
      // Fresh is genuinely fresh even if an exact old record happens to exist.
      let audio = audioByIdentity.get(request.extractionIdentityHash);
      try {
        if (!audio) {
          audio = await input.adapter.extract(request);
          audioByIdentity.set(request.extractionIdentityHash, audio);
          accounting.extractionCount++;
        }
        request.audioSha256 = audio.audioSha256;
        request.sampleCount = audio.sampleCount;
      } catch {
        accounting.extractionFailures++;
        request.status = "EXTRACTION_ERROR";
        request.errorCode = "SOURCE_VIDEO_EXTRACTION_FAILED";
      }
      if (audio) {
        accounting.inferenceAttemptCount++;
        request.execution = "FRESH_ATTEMPT_FAILED";
        try {
          await writeC60114ProbeJournal({
            directory: journalDirectory,
            sourceIdentity: input.sourceIdentity,
            request,
            phase: "INFERENCE_DISPATCH",
            payload: { prompt: "", audioSha256: audio.audioSha256 },
          });
          const result = await input.adapter.transcribe(request, audio);
          if (result.inferenceExecuted ?? result.status !== "PROVIDER_ERROR") {
            accounting.actualFreshInferences++;
            request.execution = "FRESH_INFERENCE";
          }
          await writeC60114ProbeJournal({
            directory: journalDirectory,
            sourceIdentity: input.sourceIdentity,
            request,
            phase: "NORMALIZED_RESULT",
            payload: result,
          });
          request.status =
            result.status === "SUCCESS" &&
            normalizeIndependentAsrLexical(result.text) === ""
              ? "EMPTY_OUTPUT"
              : result.status;
          request.rawText = result.text;
          request.rawOutput = result.rawOutput;
          request.rawOutputHash =
            result.rawOutput === null
              ? null
              : machineQualitySemanticHash(result.rawOutput);
          request.tokens = result.tokens;
          request.decoder = result.decoder;
          request.warnings = result.warnings;
          request.wallClockSeconds = result.wallClockSeconds;
          request.localization = localizeC60114Probe({
            target,
            request,
            result: { ...result, status: request.status },
            guardSeconds:
              windowType === "CORE_EXACT" ? input.policy.exactGuardSeconds : 0,
          });
          request.hallucinationRisk = genericHallucinationRisk({
            text: result.text,
            durationSeconds:
              request.extractionInterval.end - request.extractionInterval.start,
          });
          if (result.status === "PROVIDER_ERROR")
            request.errorCode = "PROVIDER_REPORTED_FAILURE";
        } catch (error) {
          if (error instanceof C60114ProbePersistenceError) throw error;
          request.status = "PROVIDER_ERROR";
          request.errorCode = "PROVIDER_REQUEST_FAILED";
        }
      }
      request.semanticHash = c60114ProbeSemanticHash(request);
      await mkdir(path.dirname(cachePath), { recursive: true });
      await atomicWriteJson(
        cachePath,
        c60114ProbeRequestSchema.parse(request),
        { overwrite: true },
      );
    }
    request.semanticHash = c60114ProbeSemanticHash(request);
    if (request.status === "EMPTY_OUTPUT") accounting.emptyOutputs++;
    else if (request.status !== "SUCCESS") accounting.failedRequests++;
    const providerCount = accounting.perProvider[provider.provider];
    if (
      request.execution === "FRESH_INFERENCE" ||
      request.execution === "FRESH_ATTEMPT_FAILED"
    )
      providerCount.inferenceAttemptCount++;
    if (request.execution === "FRESH_INFERENCE")
      providerCount.actualFreshInferences++;
    if (request.execution === "VERIFIED_EXACT_REPLAY")
      providerCount.cacheHits++;
    if (request.status === "EMPTY_OUTPUT") providerCount.emptyOutputs++;
    else if (request.status !== "SUCCESS") providerCount.failedRequests++;
    requests.push(c60114ProbeRequestSchema.parse(request));
    input.onProgress?.({
      requestId: request.requestId,
      completed: requests.length,
      status: request.status,
      execution: request.execution,
    });
  }
  let contextSelection: C60114ProbeExecution["contextSelection"] = [];
  try {
    for (const target of input.targets)
      for (const runtime of input.adapter.identities)
        await run(target, runtime, "CORE_EXACT");
    contextSelection = selectC60114ContextTargets(
      input.targets,
      requests,
      input.policy.probes.maxContextTargets,
    );
    accounting.contextTargets = contextSelection.filter(
      (row) => row.selected,
    ).length;
    for (const target of input.targets.filter((target) =>
      contextSelection.some(
        (row) => row.targetId === target.targetId && row.selected,
      ),
    ))
      for (const runtime of input.adapter.identities)
        await run(target, runtime, "CORE_CONTEXT");
  } finally {
    const counts = input.adapter.counts();
    accounting.modelLoadCount = counts.modelLoadCount;
    accounting.processStartCount = counts.processStartCount;
    for (const provider of ["whisper-large-v3", "reazonspeech-k2-v2"] as const)
      Object.assign(
        accounting.perProvider[provider],
        counts.perProvider?.[provider],
      );
    await input.adapter.close();
  }
  const artifact = {
    schemaVersion: "1.0.0" as const,
    artifactType: "missing-dialogue-local-probe" as const,
    policyVersion:
      "c6.0.1.14-missing-localization-playback-integrity-v1" as const,
    generatedAt: input.generatedAt,
    policyHash: input.policyHash,
    selectionHash: input.selectionHash,
    sourceIdentityHash: machineQualitySemanticHash(input.sourceIdentity),
    sourceIdentity: input.sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
    runtimeGoldInputCount: 0 as const,
    cacheNamespace: C60114_PROBE_CACHE_NAMESPACE,
    mode: input.mode,
    runtime: input.adapter.identities,
    requests,
    contextSelection,
    accounting,
    persistence: await buildC60114ProbePersistence({
      requests,
      cacheDirectory: input.cacheDirectory,
      cacheNamespace: C60114_PROBE_CACHE_NAMESPACE,
    }),
  };
  const parsed = c60114ProbeExecutionSchema.parse({
    ...artifact,
    semanticHash: c60114ProbeSemanticHash(artifact),
  });
  if (
    input.mode === "exact-cache-only" &&
    parsed.requests.some(
      (request) =>
        request.status === "CACHE_MISS" || request.status === "CACHE_INVALID",
    )
  )
    throw new C60114ProbeReplayError(parsed);
  return parsed;
}
