import path from "node:path";
import { access } from "node:fs/promises";
import {
  NodeProcessRunner,
  c60114ProbeRequestSchema,
  c60114ProbeRuntimeSchema,
  c60114ProbeRawResultSchema,
  c601141AsrRequestSchema,
  c601141AsrProbesSchema,
  type C601141AsrRequest,
  type C601141AsrSelection,
  type C601141SafetyTarget,
  type C601141Policy,
  type C60114ProbeRuntime,
  type C60114ProbeRequest,
} from "@mvl/shared";
import type {
  C60114ProbeRuntimeAdapter,
  C60114ProbeRawResult,
} from "./missing-dialogue-local-probe.js";
import {
  createC60114LocalProbeRuntime,
  type C60114LocalRuntimeInput,
} from "./c60114-probe-runtime.js";
import {
  normalizeIndependentAsrDisplay,
  normalizeIndependentAsrLexical,
  normalizeJapanesePronunciation,
  genericHallucinationRisk,
} from "../machine-quality/cross-model-normalization.js";
import { loadSudachiRuntimeCapability } from "../sudachi-runtime.js";
import { runSudachiMorphemeAnalysis } from "../sudachi-analysis.js";
import {
  hash141,
  hashed141,
  header141,
  assertHash141,
  id141,
  assertBudget141,
  required141,
} from "./c601141-policy.js";
import {
  durableJson141,
  reserveDispatch141,
  readJson141,
  fileHash141,
  safeRelative141,
} from "./c601141-io.js";

export function asrRequest141(input: {
  selection: C601141AsrSelection;
  policy: C601141Policy;
  target: C601141SafetyTarget;
  runtime: C60114ProbeRuntime;
  windowType: "CORE_EXACT" | "CORE_CONTEXT";
}): C60114ProbeRequest {
  const { selection, policy, target, runtime, windowType } = input;
  const guard =
    windowType === "CORE_EXACT"
      ? policy.asr.exactGuardSeconds
      : policy.asr.contextSeconds;
  // Quantize the extraction itself to the physical 16 kHz sample grid.
  const extractionInterval = {
    start: Math.max(
      0,
      Math.floor((target.sourceInterval.start - guard) * 16000) / 16000,
    ),
    end: Math.min(
      selection.sourceIdentity.durationSeconds,
      Math.ceil((target.sourceInterval.end + guard) * 16000) / 16000,
    ),
  };
  const extractionIdentityHash = hash141({
    namespace: policy.policyVersion,
    sourceIdentity: selection.sourceIdentity,
    extractionInterval,
    sampleRate: 16000,
    channels: 1,
    codec: "pcm_s16le",
    recipe: "source-exact-sample-trim-v1",
  });
  const core = {
    namespace: policy.policyVersion,
    targetId: target.targetId,
    windowType,
    extractionIdentityHash,
    policyHash: policy.semanticHash,
    selectionHash: selection.semanticHash,
    runtimeIdentityHash: runtime.runtimeIdentityHash,
    modelIdentityHash: runtime.modelIdentityHash,
    provider: runtime.provider,
    prompt: "",
    vadEnabled: false,
  };
  return c60114ProbeRequestSchema.parse(
    hashed141({
      requestId: id141("c601141-asr", core),
      targetId: target.targetId,
      provider: runtime.provider,
      windowType,
      coreInterval: target.sourceInterval,
      extractionInterval,
      sourceMediaSha256: selection.sourceIdentity.sourceMediaSha256,
      sourceIdentityHash: hash141(selection.sourceIdentity),
      policyHash: policy.semanticHash,
      selectionHash: selection.semanticHash,
      audioSha256: null,
      sampleCount: null,
      extractionIdentityHash,
      cacheKey: hash141(core),
      runtimeIdentityHash: runtime.runtimeIdentityHash,
      modelIdentityHash: runtime.modelIdentityHash,
      prompt: "",
      vadEnabled: false,
      status: "PROVIDER_ERROR",
      execution: "NOT_EXECUTED",
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
        status: "FAILED",
        localizedText: null,
        guardSeconds: guard,
        guardNeighborOverlapSeconds: 0,
        coreNeighborOverlapSeconds: 0,
        completeness: "UNKNOWN",
        projectionTokenCount: 0,
        reasons: ["NOT_EXECUTED"],
      },
      hallucinationRisk: 0,
      errorCode: null,
      warnings: [],
      wallClockSeconds: 0,
    }),
  );
}
export function localizeAsr141(
  request: C60114ProbeRequest,
  raw: C60114ProbeRawResult,
) {
  const text = normalizeIndependentAsrDisplay(raw.text);
  if (raw.status === "PROVIDER_ERROR")
    return { localizedText: "", localizationStatus: "FAILED" as const };
  if (!normalizeIndependentAsrLexical(text))
    return { localizedText: "", localizationStatus: "EMPTY" as const };
  if (request.windowType === "CORE_EXACT")
    return {
      localizedText: text,
      localizationStatus: "EXACT_SOURCE_WINDOW" as const,
    };
  const selected = raw.tokens.filter(
    (token) =>
      token.trusted &&
      token.sourceInterval !== null &&
      token.sourceInterval.start >= request.coreInterval.start - 1 / 16000 &&
      token.sourceInterval.end <= request.coreInterval.end + 1 / 16000,
  );
  let previous = -1;
  for (const token of selected) {
    const interval = required141(token.sourceInterval);
    if (interval.start < previous)
      return {
        localizedText: "",
        localizationStatus: "CONTEXT_UNPROJECTABLE" as const,
      };
    previous = interval.end;
  }
  const localized = normalizeIndependentAsrDisplay(
    selected.map((v) => v.text).join(""),
  );
  return localized
    ? {
        localizedText: localized,
        localizationStatus: "TRUSTED_TOKEN_PROJECTION" as const,
      }
    : {
        localizedText: "",
        localizationStatus: "CONTEXT_UNPROJECTABLE" as const,
      };
}
export function contextReasons141(
  exact: readonly C601141AsrRequest[],
): string[] {
  const reasons: string[] = [];
  if (
    exact.length !== 2 ||
    exact.some(
      (v) => v.status === "FAILED" || v.status === "RUNTIME_UNAVAILABLE",
    )
  )
    reasons.push("EXACT_PROVIDER_UNAVAILABLE_OR_FAILED");
  if (exact.some((v) => v.normalizedText === "")) reasons.push("EXACT_EMPTY");
  if (
    exact.length === 2 &&
    exact[0]?.normalizedText !== exact[1]?.normalizedText
  )
    reasons.push("EXACT_CROSS_MODEL_DISAGREEMENT");
  if (exact.some((v) => v.hallucinationRisk >= 0.6 || v.strongContradiction))
    reasons.push("EXACT_HALLUCINATION_OR_NO_SPEECH_RISK");
  if (
    exact.some(
      (v) =>
        v.localizationStatus === "FAILED" ||
        v.localizationStatus === "CONTEXT_UNPROJECTABLE",
    )
  )
    reasons.push("EXACT_LOCALIZATION_UNRESOLVED");
  if (
    exact.some((v) =>
      v.tokens.some(
        (t) =>
          t.trusted &&
          t.sourceInterval !== null &&
          (Math.abs(t.sourceInterval.start - v.targetInterval.start) <= 0.02 ||
            Math.abs(t.sourceInterval.end - v.targetInterval.end) <= 0.02),
      ),
    )
  )
    reasons.push("EXACT_TOKEN_EDGE_CONTACT");
  return reasons;
}
export async function runAsr141(input: {
  mode: "FRESH" | "EXACT_CACHE_ONLY";
  authorized: boolean;
  selection: C601141AsrSelection;
  policy: C601141Policy;
  runtimeInput: C60114LocalRuntimeInput;
  cacheDirectory: string;
  outputDirectory: string;
  freshDirectory: string;
  sudachi?: {
    manifest: string;
    python: string;
    helper: string;
    requirements: string;
  };
  runtimeFactory?: () => Promise<C60114ProbeRuntimeAdapter>;
  onProgress?: (message: string) => void;
}) {
  assertHash141(input.selection);
  assertBudget141("ASR", input.selection.maximumAuthorizedRequests);
  if (input.selection.policyHash !== input.policy.semanticHash)
    throw new Error("C601141_ASR_SELECTION_POLICY_MISMATCH");
  if (input.mode === "FRESH" && !input.authorized)
    throw new Error("C601141_ASR_AUTHORIZATION_REQUIRED_PLAN_ONLY");
  let adapter: C60114ProbeRuntimeAdapter | undefined;
  let identities: C60114ProbeRuntime[];
  const runtimeFile = path.join(
    input.freshDirectory,
    "asr-runtime-preflight.local-only.json",
  );
  if (input.mode === "FRESH") {
    adapter = await (input.runtimeFactory?.() ??
      createC60114LocalProbeRuntime({
        ...input.runtimeInput,
        retryOnFailure: false,
        exactSampleExtraction: true,
      }));
    identities = adapter.identities;
    if (
      adapter.counts().modelLoadCount !== 0 ||
      adapter.counts().processStartCount !== 0
    )
      throw new Error("C601141_ASR_PREFLIGHT_STARTED_PROVIDER");
    await durableJson141(runtimeFile, {
      identities,
      identitiesHash: hash141(identities),
      selectionHash: input.selection.semanticHash,
      providerProcessesStarted: 0,
    });
  } else {
    const frozen = (await readJson141(runtimeFile)) as {
      identities: unknown[];
      identitiesHash: string;
      selectionHash: string;
    };
    identities = frozen.identities.map((v) =>
      c60114ProbeRuntimeSchema.parse(v),
    );
    if (
      frozen.identitiesHash !== hash141(identities) ||
      frozen.selectionHash !== input.selection.semanticHash
    )
      throw new Error("C601141_ASR_FROZEN_RUNTIME_CHANGED");
  }
  let readingRuntimeHash: string | null = null;
  if (input.mode === "FRESH" && input.sudachi) {
    const capability = await loadSudachiRuntimeCapability({
      manifestPath: input.sudachi.manifest,
      pythonExecutable: input.sudachi.python,
      helperPath: input.sudachi.helper,
      requirementsPath: input.sudachi.requirements,
      runner: new NodeProcessRunner(),
    });
    readingRuntimeHash = capability.runtimeIdentityHash;
  }
  const planned = [];
  for (const target of input.selection.targets)
    for (const runtime of identities) {
      planned.push(
        asrRequest141({
          selection: input.selection,
          policy: input.policy,
          target,
          runtime,
          windowType: "CORE_EXACT",
        }),
      );
      if (input.selection.contextEligibleTargetIds.includes(target.targetId))
        planned.push(
          asrRequest141({
            selection: input.selection,
            policy: input.policy,
            target,
            runtime,
            windowType: "CORE_CONTEXT",
          }),
        );
    }
  assertBudget141("ASR", planned.length);
  const planFile = path.join(
    input.freshDirectory,
    "asr-execution-plan.local-only.json",
  );
  const plan = {
    selectionHash: input.selection.semanticHash,
    requests: planned,
    planHash: hash141(planned),
    modelLoadCount: 0,
    providerProcessStartCount: 0,
  };
  if (input.mode === "FRESH") await durableJson141(planFile, plan);
  else if (hash141(await readJson141(planFile)) !== hash141(plan))
    throw new Error("C601141_ASR_EXECUTION_PLAN_CHANGED");
  const requests: C601141AsrRequest[] = [],
    contextDecisions: {
      targetId: string;
      executed: boolean;
      reasons: string[];
    }[] = [];
  let inferenceCount = 0,
    cacheHits = 0,
    modelLoads = 0,
    processStarts = 0;
  const execute = async (request: C60114ProbeRequest) => {
    const target = required141(
      input.selection.targets.find((v) => v.targetId === request.targetId),
    );
    const cacheFile = path.join(
        input.cacheDirectory,
        "asr",
        `${request.cacheKey}.json`,
      ),
      rawFile = path.join(
        input.cacheDirectory,
        "asr-raw",
        `${request.cacheKey}.json`,
      );
    if (input.mode === "EXACT_CACHE_ONLY") {
      const row = c601141AsrRequestSchema.parse(await readJson141(cacheFile));
      assertHash141(row);
      if (
        row.requestIdentityHash !== hash141(request) ||
        row.cacheKey !== request.cacheKey ||
        row.rawResultHash !== hash141(await readJson141(rawFile)) ||
        !row.resultPersisted
      )
        throw new Error("C601141_EXACT_ASR_CACHE_IDENTITY_MISMATCH");
      if (
        row.relativeAudioPath &&
        (await fileHash141(
          path.join(input.freshDirectory, row.relativeAudioPath),
        )) !== row.audioSha256
      )
        throw new Error("C601141_ASR_REPLAY_AUDIO_BYTES_CHANGED");
      cacheHits++;
      requests.push(row);
      return;
    }
    if (!adapter) throw new Error("C601141_ASR_ADAPTER_UNAVAILABLE");
    try {
      await access(cacheFile);
      throw new Error("C601141_FRESH_ASR_CACHE_ALREADY_EXISTS");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Extraction is completed and hash verified before consuming a model slot.
    const audio = await adapter.extract(request);
    if ((await fileHash141(audio.audioPath)) !== audio.audioSha256)
      throw new Error("C601141_ASR_EXTRACTED_AUDIO_HASH_MISMATCH");
    const before = adapter.counts();
    await reserveDispatch141({
      cacheDirectory: input.cacheDirectory,
      kind: "ASR",
      requestId: request.requestId,
      identity: {
        cacheKey: request.cacheKey,
        audioSha256: audio.audioSha256,
        planHash: plan.planHash,
      },
    });
    inferenceCount++;
    assertBudget141("ASR", inferenceCount);
    input.onProgress?.(
      `Local ASR ${inferenceCount}/${planned.length}: ${request.provider} ${request.windowType}`,
    );
    let raw: C60114ProbeRawResult,
      errorCode: string | null = null;
    try {
      raw = await adapter.transcribe(request, audio);
    } catch (error) {
      errorCode =
        error instanceof Error ? error.message : "ASR_PROVIDER_FAILED";
      raw = {
        status: "PROVIDER_ERROR",
        text: "",
        rawOutput: null,
        tokens: [],
        decoder: {
          averageLogProbability: null,
          noSpeechProbability: null,
          temperature: null,
        },
        warnings: [errorCode],
        wallClockSeconds: 0,
        inferenceExecuted: true,
      };
    }
    try {
      await durableJson141(rawFile, raw);
    } catch (error) {
      throw new Error("INFERENCE_CONSUMED_RESULT_NOT_PERSISTED", {
        cause: error,
      });
    }
    c60114ProbeRawResultSchema.parse(raw);
    const localized = localizeAsr141(request, raw),
      displayText = normalizeIndependentAsrDisplay(raw.text),
      normalizedText = normalizeIndependentAsrLexical(displayText);
    const hallucinationRisk = Math.max(
      genericHallucinationRisk({
        text: displayText,
        durationSeconds:
          request.extractionInterval.end - request.extractionInterval.start,
      }),
      raw.decoder.noSpeechProbability ?? 0,
    );
    let readingText: string | null = null;
    if (input.sudachi && readingRuntimeHash && displayText) {
      const result = await runSudachiMorphemeAnalysis({
        pythonExecutable: input.sudachi.python,
        helperPath: input.sudachi.helper,
        items: [
          {
            id: request.requestId,
            text: localized.localizedText || displayText,
          },
        ],
      });
      const reading = result.readingsById.get(request.requestId);
      readingText = reading ? normalizeJapanesePronunciation(reading) : null;
    }
    const after = adapter.counts(),
      modelLoadDelta = after.modelLoadCount - before.modelLoadCount,
      providerProcessDelta = after.processStartCount - before.processStartCount;
    modelLoads += modelLoadDelta;
    processStarts += providerProcessDelta;
    const row = c601141AsrRequestSchema.parse(
      hashed141({
        requestId: request.requestId,
        targetId: target.targetId,
        provider: request.provider,
        windowType: request.windowType,
        targetInterval: target.sourceInterval,
        extractionInterval: request.extractionInterval,
        nativeInterval: target.nativeInterval,
        cacheKey: request.cacheKey,
        requestIdentityHash: hash141(request),
        runtimeIdentityHash: request.runtimeIdentityHash,
        modelSnapshotHash: request.modelIdentityHash,
        audioSha256: audio.audioSha256,
        relativeAudioPath: safeRelative141(
          input.freshDirectory,
          audio.audioPath,
        ),
        sampleCount: audio.sampleCount,
        prompt: "",
        vadEnabled: false,
        inferenceConsumed: true,
        resultPersisted: true,
        status:
          raw.status === "PROVIDER_ERROR"
            ? "FAILED"
            : normalizedText
              ? "SUCCESS"
              : "EMPTY_OUTPUT",
        rawResultHash: hash141(raw),
        displayText,
        normalizedText,
        readingText,
        readingRuntimeHash,
        tokens: raw.tokens,
        ...localized,
        hallucinationRisk,
        strongContradiction: (raw.decoder.noSpeechProbability ?? 0) >= 0.8,
        modelLoadDelta,
        providerProcessDelta,
        errorCode,
      }),
    );
    await durableJson141(cacheFile, row);
    await durableJson141(
      path.join(input.outputDirectory, `${row.requestId}.json`),
      row,
    );
    requests.push(row);
  };
  try {
    for (const request of planned.filter((v) => v.windowType === "CORE_EXACT"))
      await execute(request);
    for (const targetId of input.selection.contextEligibleTargetIds) {
      const reasons = contextReasons141(
        requests.filter(
          (v) => v.targetId === targetId && v.windowType === "CORE_EXACT",
        ),
      );
      const executed = reasons.length > 0;
      contextDecisions.push({ targetId, executed, reasons });
      if (executed)
        for (const request of planned.filter(
          (v) => v.targetId === targetId && v.windowType === "CORE_CONTEXT",
        ))
          await execute(request);
    }
  } finally {
    await adapter?.close();
  }
  const artifact = c601141AsrProbesSchema.parse(
    hashed141({
      ...header141(input.policy, input.selection.sourceIdentity),
      artifactType: "machine-c6-0-1-14-1-local-asr-probes",
      mode: input.mode,
      selectionHash: input.selection.semanticHash,
      requests,
      contextDecisions,
      accounting: {
        inferenceCount,
        exactCount:
          input.mode === "FRESH"
            ? requests.filter((v) => v.windowType === "CORE_EXACT").length
            : 0,
        contextCount:
          input.mode === "FRESH"
            ? requests.filter((v) => v.windowType === "CORE_CONTEXT").length
            : 0,
        cacheHits,
        cacheMisses: 0,
        modelLoadCount: modelLoads,
        providerProcessStartCount: processStarts,
        resultPersistedCount: requests.filter((v) => v.resultPersisted).length,
        failedCount: requests.filter((v) => v.status === "FAILED").length,
        hiddenRetryCount: 0,
        fullMediaAsrCount: 0,
      },
      evidenceSemanticHash: hash141({ requests, contextDecisions }),
    }),
  );
  await durableJson141(
    path.join(
      input.outputDirectory,
      "machine-c6-0-1-14-1-local-asr-probes.json",
    ),
    artifact,
  );
  return artifact;
}
