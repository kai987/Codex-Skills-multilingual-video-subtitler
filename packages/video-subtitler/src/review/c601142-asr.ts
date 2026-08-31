import path from "node:path";
import { access } from "node:fs/promises";
import {
  NodeProcessRunner,
  asrSelection142Schema,
  asrPlan142Schema,
  asrRequest142Schema,
  asrProbes142Schema,
  c60114ProbeRequestSchema,
  c60114ProbeRawResultSchema,
  type Policy142,
  type Safety142,
  type AsrSelection142,
  type AsrTarget142,
  type AsrPlan142,
  type AsrRequest142,
  type C601141AsrProbes,
  type C60114ProbeRequest,
  type C60114ProbeRuntime,
} from "@mvl/shared";
import { header142, assertBudget142 } from "./c601142-policy.js";
import { reserve142 } from "./c601142-detectors.js";
import { coverageSamples142 } from "./c601142-selection.js";
import {
  hashed141,
  hash141,
  id141,
  assertHash141,
  seconds141,
  required141,
} from "./c601141-policy.js";
import {
  readJson141,
  durableJson141,
  fileHash141,
  safeRelative141,
} from "./c601141-io.js";
import { localizeAsr141, contextReasons141 } from "./c601141-local-asr.js";
import {
  createC60114LocalProbeRuntime,
  type C60114LocalRuntimeInput,
} from "./c60114-probe-runtime.js";
import type {
  C60114ProbeRuntimeAdapter,
  C60114ProbeRawResult,
} from "./missing-dialogue-local-probe.js";
import {
  normalizeIndependentAsrDisplay,
  normalizeIndependentAsrLexical,
  normalizeJapanesePronunciation,
  genericHallucinationRisk,
} from "../machine-quality/cross-model-normalization.js";
import { loadSudachiRuntimeCapability } from "../sudachi-runtime.js";
import { runSudachiMorphemeAnalysis } from "../sudachi-analysis.js";
export interface ReadingRuntime142 {
  manifest: string;
  python: string;
  helper: string;
  requirements: string;
}
export function selectAsr142(
  safety: Safety142,
  previous: C601141AsrProbes,
  policy: Policy142,
  frozenAt: string,
): AsrSelection142 {
  [safety, previous].forEach(assertHash141);
  const rejected: AsrSelection142["rejected"] = [],
    pool: AsrTarget142[] = [];
  const oldIntervals = previous.requests.map((r) => r.nativeInterval),
    rate = safety.sourceIdentity.sampleRate;
  for (const cluster of safety.targets) {
    const cores = cluster.targetCoreUnion.filter(
      (v) =>
        !coverageSamples142(v, oldIntervals) &&
        v.endSample - v.startSample >= policy.cluster.minimumCoreSeconds * rate,
    );
    if (!cores.length) {
      rejected.push({
        clusterTargetId: cluster.targetId,
        reason: "ALL_CORES_PREVIOUSLY_PROBED_OR_BELOW_MINIMUM",
      });
      continue;
    }
    if (cluster.strongContradiction || !cluster.verifiedTimebase) {
      rejected.push({
        clusterTargetId: cluster.targetId,
        reason: "CONTRADICTED_OR_TIMEBASE_INVALID",
      });
      continue;
    }
    const core = required141(
      [...cores].sort(
        (a, b) =>
          b.endSample - b.startSample - (a.endSample - a.startSample) ||
          a.startSample - b.startSample,
      )[0],
    );
    pool.push(
      hashed141({
        probeTargetId: id141("local-asr-core-v2", {
          cluster: cluster.targetId,
          core,
        }),
        clusterTargetId: cluster.targetId,
        clusterId: cluster.clusterId,
        nativeInterval: core,
        sourceInterval: seconds141(core, rate),
        targetCoreUnion: cluster.targetCoreUnion,
        evidenceStrata: cluster.evidenceStrata,
        selectionReasons: [
          "UNPROBED_SOURCE_LOCALIZED_CORE",
          "NO_PREVIOUS_REQUEST_INTERVAL_OVERLAP",
          "NO_CANONICAL_INSERT",
        ],
        contextPreselected: false,
      }),
    );
  }
  // Selection order is already the frozen dynamic utility order. One localized
  // core per cluster; do not expand a multi-part cluster into a wide ASR hull.
  const selected = pool.slice(0, policy.asr.maximumTargets);
  for (const p of pool.slice(policy.asr.maximumTargets))
    rejected.push({
      clusterTargetId: p.clusterTargetId,
      reason: "FOUR_TARGET_HARD_BUDGET",
    });
  const contexts = [...selected]
    .sort(
      (a, b) =>
        a.sourceInterval.end -
          a.sourceInterval.start -
          (b.sourceInterval.end - b.sourceInterval.start) ||
        a.probeTargetId.localeCompare(b.probeTargetId),
    )
    .slice(0, policy.asr.maximumContextTargets)
    .map((t) => t.probeTargetId);
  const targets = selected.map((t) =>
    hashed141({ ...t, contextPreselected: contexts.includes(t.probeTargetId) }),
  );
  return asrSelection142Schema.parse(
    hashed141({
      ...header142(policy, safety.sourceIdentity),
      artifactType: "machine-c6-0-1-14-2-asr-probe-selection",
      safetyHash: safety.semanticHash,
      previousAsrEvidenceHash: previous.evidenceSemanticHash,
      targets,
      contextEligibleTargetIds: contexts,
      maximumAuthorizedRequests: 2 * (targets.length + contexts.length),
      selectionFrozenAt: frozenAt,
      targetBackfillAllowed: false,
      goldBlind: true,
      repeatedPreviousRequestCount: 0,
      rejected,
    }),
  );
}
export function asrRequest142(
  selection: AsrSelection142,
  policy: Policy142,
  target: AsrTarget142,
  runtime: C60114ProbeRuntime,
  windowType: "CORE_EXACT" | "CORE_CONTEXT",
): C60114ProbeRequest {
  const guard = windowType === "CORE_CONTEXT" ? policy.asr.contextSeconds : 0;
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
    targetId: target.probeTargetId,
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
      requestId: id141("c601142-asr", core),
      targetId: target.probeTargetId,
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
export async function planAsr142(input: {
  selection: AsrSelection142;
  policy: Policy142;
  runtimeInput: C60114LocalRuntimeInput;
  outputDirectory: string;
  reading?: ReadingRuntime142;
  runtimeFactory?: () => Promise<C60114ProbeRuntimeAdapter>;
}) {
  assertHash141(input.selection);
  const adapter = await (input.runtimeFactory?.() ??
    createC60114LocalProbeRuntime({
      ...input.runtimeInput,
      retryOnFailure: false,
      exactSampleExtraction: true,
    }));
  try {
    if (adapter.counts().modelLoadCount || adapter.counts().processStartCount)
      throw new Error("C601142_ASR_PREFLIGHT_STARTED_PROVIDER");
    let readingRuntimeHash: string | null = null;
    if (input.reading)
      readingRuntimeHash = (
        await loadSudachiRuntimeCapability({
          manifestPath: input.reading.manifest,
          pythonExecutable: input.reading.python,
          helperPath: input.reading.helper,
          requirementsPath: input.reading.requirements,
          runner: new NodeProcessRunner(),
        })
      ).runtimeIdentityHash;
    const requests = input.selection.targets.flatMap((target) =>
      adapter.identities.flatMap((runtime) => [
        asrRequest142(
          input.selection,
          input.policy,
          target,
          runtime,
          "CORE_EXACT",
        ),
        ...(target.contextPreselected
          ? [
              asrRequest142(
                input.selection,
                input.policy,
                target,
                runtime,
                "CORE_CONTEXT",
              ),
            ]
          : []),
      ]),
    );
    assertBudget142("ASR", requests.length);
    const plan = asrPlan142Schema.parse(
      hashed141({
        ...header142(input.policy, input.selection.sourceIdentity),
        artifactType: "machine-c601142-asr-execution-plan",
        selectionHash: input.selection.semanticHash,
        frozenAt: new Date().toISOString(),
        identities: adapter.identities,
        identitiesHash: hash141(adapter.identities),
        readingRuntimeHash,
        requests,
        modelLoadCountBeforeFreeze: 0,
        providerProcessStartCountBeforeFreeze: 0,
        retryAllowed: false,
        backfillAllowed: false,
      }),
    );
    await durableJson141(
      path.join(
        input.outputDirectory,
        "machine-c601142-asr-execution-plan.json",
      ),
      plan,
    );
    return plan;
  } finally {
    await adapter.close();
  }
}
export async function runAsr142(input: {
  selection: AsrSelection142;
  policy: Policy142;
  plan: AsrPlan142;
  runtimeInput: C60114LocalRuntimeInput;
  mode: "FRESH" | "EXACT_CACHE_ONLY";
  authorized: boolean;
  cacheDirectory: string;
  outputDirectory: string;
  freshDirectory: string;
  reading?: ReadingRuntime142;
  runtimeFactory?: () => Promise<C60114ProbeRuntimeAdapter>;
  onProgress?: (message: string) => void;
}) {
  const { selection, plan, policy } = input;
  [selection, plan, policy].forEach(assertHash141);
  if (
    plan.selectionHash !== selection.semanticHash ||
    selection.policyHash !== policy.semanticHash ||
    plan.policyHash !== policy.semanticHash
  )
    throw new Error("C601142_ASR_FROZEN_IDENTITY_MISMATCH");
  if (input.mode === "FRESH" && !input.authorized)
    throw new Error("C601142_ASR_AUTHORIZATION_REQUIRED");
  assertBudget142("ASR", plan.requests.length);
  let adapter: C60114ProbeRuntimeAdapter | undefined;
  if (input.mode === "FRESH") {
    adapter = await (input.runtimeFactory?.() ??
      createC60114LocalProbeRuntime({
        ...input.runtimeInput,
        retryOnFailure: false,
        exactSampleExtraction: true,
      }));
    if (
      hash141(adapter.identities) !== plan.identitiesHash ||
      adapter.counts().modelLoadCount ||
      adapter.counts().processStartCount
    ) {
      await adapter.close();
      throw new Error("C601142_ASR_RUNTIME_CHANGED_OR_STARTED");
    }
  }
  const requests: AsrRequest142[] = [],
    contextDecisions: {
      targetId: string;
      executed: boolean;
      reasons: string[];
    }[] = [];
  let inferenceCount = 0,
    cacheHits = 0,
    modelLoads = 0,
    processStarts = 0;
  async function execute(request: C60114ProbeRequest) {
    const target = required141(
        selection.targets.find((t) => t.probeTargetId === request.targetId),
      ),
      cacheFile = path.join(
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
      const row = asrRequest142Schema.parse(await readJson141(cacheFile));
      assertHash141(row);
      if (
        row.requestIdentityHash !== hash141(request) ||
        row.rawResultHash !== hash141(await readJson141(rawFile)) ||
        !row.resultPersisted ||
        (row.relativeAudioPath &&
          (await fileHash141(
            path.join(input.freshDirectory, row.relativeAudioPath),
          )) !== row.audioSha256)
      )
        throw new Error("C601142_ASR_CACHE_INTEGRITY");
      cacheHits++;
      requests.push(row);
      return;
    }
    if (!adapter) throw new Error("C601142_ASR_ADAPTER_MISSING");
    try {
      await access(cacheFile);
      throw new Error("C601142_FRESH_ASR_CACHE_ALREADY_EXISTS");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const audio = await adapter.extract(request);
    if ((await fileHash141(audio.audioPath)) !== audio.audioSha256)
      throw new Error("C601142_ASR_AUDIO_HASH_MISMATCH");
    const before = adapter.counts();
    await reserve142({
      directory: input.cacheDirectory,
      kind: "ASR",
      requestId: request.requestId,
      family: request.provider,
      planHash: plan.semanticHash,
      identity: {
        requestHash: hash141(request),
        audioSha256: audio.audioSha256,
      },
    });
    inferenceCount++;
    assertBudget142("ASR", inferenceCount);
    input.onProgress?.(
      `ASR ${inferenceCount}/${plan.requests.length}: ${request.provider} ${request.windowType}`,
    );
    let raw: C60114ProbeRawResult,
      errorCode: string | null = null;
    try {
      raw = await adapter.transcribe(request, audio);
    } catch (error) {
      errorCode = error instanceof Error ? error.message : "ASR_FAILED";
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
    if (input.reading && plan.readingRuntimeHash && localized.localizedText) {
      const readings = await runSudachiMorphemeAnalysis({
        pythonExecutable: input.reading.python,
        helperPath: input.reading.helper,
        items: [{ id: request.requestId, text: localized.localizedText }],
      });
      const reading = readings.readingsById.get(request.requestId);
      readingText = reading ? normalizeJapanesePronunciation(reading) : null;
    }
    const after = adapter.counts(),
      modelLoadDelta = after.modelLoadCount - before.modelLoadCount,
      providerProcessDelta = after.processStartCount - before.processStartCount;
    modelLoads += modelLoadDelta;
    processStarts += providerProcessDelta;
    const row = asrRequest142Schema.parse(
      hashed141({
        requestId: request.requestId,
        targetId: request.targetId,
        clusterTargetId: target.clusterTargetId,
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
        readingRuntimeHash: plan.readingRuntimeHash,
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
  }
  try {
    for (const request of plan.requests.filter(
      (r) => r.windowType === "CORE_EXACT",
    ))
      await execute(request);
    for (const targetId of selection.contextEligibleTargetIds) {
      const reasons = contextReasons141(
          requests.filter(
            (r) => r.targetId === targetId && r.windowType === "CORE_EXACT",
          ),
        ),
        executed = reasons.length > 0;
      contextDecisions.push({ targetId, executed, reasons });
      if (executed)
        for (const request of plan.requests.filter(
          (r) => r.targetId === targetId && r.windowType === "CORE_CONTEXT",
        ))
          await execute(request);
    }
  } finally {
    await adapter?.close();
  }
  const artifact = asrProbes142Schema.parse(
    hashed141({
      ...header142(policy, selection.sourceIdentity),
      artifactType: "machine-c6-0-1-14-2-local-asr-probes",
      mode: input.mode,
      selectionHash: selection.semanticHash,
      planHash: plan.semanticHash,
      requests,
      contextDecisions,
      accounting: {
        inferenceCount,
        exactCount:
          input.mode === "FRESH"
            ? requests.filter((r) => r.windowType === "CORE_EXACT").length
            : 0,
        contextCount:
          input.mode === "FRESH"
            ? requests.filter((r) => r.windowType === "CORE_CONTEXT").length
            : 0,
        cacheHits,
        cacheMisses: 0,
        modelLoadCount: modelLoads,
        providerProcessStartCount: processStarts,
        resultPersistedCount: requests.filter((r) => r.resultPersisted).length,
        failedCount: requests.filter((r) => r.status === "FAILED").length,
        hiddenRetryCount: 0,
        fullMediaAsrCount: 0,
        repeatedPreviousRequestCount: 0,
        targetBackfillCount: 0,
      },
      evidenceSemanticHash: hash141({ requests, contextDecisions }),
    }),
  );
  await durableJson141(
    path.join(
      input.outputDirectory,
      "machine-c6-0-1-14-2-local-asr-probes.json",
    ),
    artifact,
  );
  return artifact;
}
