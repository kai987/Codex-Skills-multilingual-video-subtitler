import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  c60114ProbeBudgetExceptionSchema,
  c60114ProbeFailureAuditSchema,
  c60114ProbeCompletionCheckpointSchema,
  c60114ProbeExecutionSchema,
  c60114ProbeRequestSchema,
  c60114ProbeJournalSchema,
  c60114ProbeRawResultSchema,
  type C60114ProbeExecution,
  type C60114ProbeRequest,
  type C60114ProbeBudgetException,
  type C60114ProbeTarget,
  type C60114SourceIdentity,
  type C60114Policy,
} from "@mvl/shared";
import { sha256LocalFile } from "../finalization-support.js";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { genericHallucinationRisk } from "../machine-quality/cross-model-normalization.js";
import { assertC60114Policy } from "./c60114-policy.js";
import {
  assertC60114ProbePersistenceSchema,
  buildC60114ProbePersistence,
  writeC60114ProbeJournal,
  writeC60114ProbeCacheManifest,
  C60114ProbePersistenceError,
} from "./c60114-probe-persistence.js";
import {
  createC60114LocalProbeRuntime,
  type C60114LocalRuntimeInput,
} from "./c60114-probe-runtime.js";
import {
  assertC60114ProbeBudget,
  C60114_PROBE_CACHE_NAMESPACE,
  c60114ProbeSemanticHash,
  localizeC60114Probe,
  selectC60114ContextTargets,
  type C60114ProbePlanInput,
  type C60114ProbeAudio,
  type C60114ProbeRuntimeAdapter,
} from "./missing-dialogue-local-probe.js";

/** Engineering-only continuation: complete requests that never reached a model.
 * Selection/context policy and every already successful request stay frozen. */
export async function completeC60114ExtractionFailures(
  input: Omit<C60114ProbePlanInput, "adapter"> &
    C60114LocalRuntimeInput & {
      resumeIncompleteExtraction: string;
      budgetException?: C60114ProbeBudgetException;
      budgetExceptionPath?: string;
      lossAuditPath?: string;
      adapterForTest?: C60114ProbeRuntimeAdapter;
      afterCompletionCheckpointForTest?: () => void;
      afterNormalizedResultForTest?: () => void;
    },
): Promise<C60114ProbeExecution> {
  assertC60114ProbePersistenceSchema();
  assertC60114ProbeBudget(input);
  if (input.mode !== "fresh")
    throw new Error("C60114_COMPLETION_REQUIRES_FRESH_MODE");
  const original = c60114ProbeExecutionSchema.parse(
    JSON.parse(await readFile(input.resumeIncompleteExtraction, "utf8")),
  );
  if (
    original.semanticHash !== c60114ProbeSemanticHash(original) ||
    original.policyHash !== input.policyHash ||
    original.selectionHash !== input.selectionHash ||
    original.sourceIdentityHash !==
      machineQualitySemanticHash(input.sourceIdentity) ||
    original.mode !== "fresh" ||
    original.completion !== undefined
  )
    throw new Error("C60114_COMPLETION_LINEAGE_MISMATCH");
  const pending = original.requests.filter(
    (request) =>
      request.status === "EXTRACTION_ERROR" &&
      request.execution === "NOT_EXECUTED" &&
      request.rawOutput === null &&
      request.audioSha256 === null &&
      request.windowType === "CORE_EXACT",
  );
  if (
    !pending.length ||
    original.requests.some(
      (request) =>
        !pending.includes(request) &&
        request.status !== "SUCCESS" &&
        request.status !== "EMPTY_OUTPUT",
    )
  )
    throw new Error("C60114_COMPLETION_UNSAFE_OR_BUDGET_EXCEEDED");
  for (const request of original.requests) {
    if (
      request.semanticHash !== c60114ProbeSemanticHash(request) ||
      request.rawOutputHash !==
        (request.rawOutput === null
          ? null
          : machineQualitySemanticHash(request.rawOutput))
    )
      throw new Error("C60114_COMPLETION_ORIGINAL_RESULT_HASH_INVALID");
  }
  const originalProbeByteHash = await sha256LocalFile(
    input.resumeIncompleteExtraction,
  );
  let lossAudit: ReturnType<typeof c60114ProbeFailureAuditSchema.parse> | null =
    null;
  let reservationDirectory: string | null = null;
  if (input.budgetException) {
    const exception = c60114ProbeBudgetExceptionSchema.parse(
      input.budgetException,
    );
    const { semanticHash, ...exceptionCore } = exception;
    if (!input.lossAuditPath)
      throw new Error("C60114_EXCEPTION_LOSS_AUDIT_REQUIRED");
    if (!input.budgetExceptionPath)
      throw new Error("C60114_EXCEPTION_FILE_REQUIRED");
    const exceptionPath = await realpath(input.budgetExceptionPath);
    if (
      machineQualitySemanticHash(
        JSON.parse(await readFile(exceptionPath, "utf8")),
      ) !== machineQualitySemanticHash(exception)
    )
      throw new Error("C60114_EXCEPTION_FILE_IDENTITY_MISMATCH");
    reservationDirectory = path.join(
      path.dirname(exceptionPath),
      ".c60114-inference-reservations",
      exception.semanticHash,
    );
    lossAudit = c60114ProbeFailureAuditSchema.parse(
      JSON.parse(await readFile(input.lossAuditPath, "utf8")),
    );
    if (
      machineQualitySemanticHash(exceptionCore) !== semanticHash ||
      exception.sourceIdentityHash !== original.sourceIdentityHash ||
      exception.policyHash !== original.policyHash ||
      exception.selectionHash !== original.selectionHash ||
      exception.originalProbeByteHash !== originalProbeByteHash ||
      lossAudit.originalProbeByteSha256 !== originalProbeByteHash ||
      lossAudit.originalProbeSemanticHash !== original.semanticHash ||
      lossAudit.policyHash !== original.policyHash ||
      lossAudit.selectionHash !== original.selectionHash ||
      machineQualitySemanticHash(lossAudit.sourceIdentity) !==
        original.sourceIdentityHash ||
      exception.lossAuditByteHash !==
        (await sha256LocalFile(input.lossAuditPath)) ||
      exception.previousPersistedSuccessCount !==
        original.accounting.actualFreshInferences ||
      exception.previousConsumedInferences !==
        lossAudit.accounting.cumulativeActualFreshInferences ||
      exception.previousLostRawResultCount !==
        lossAudit.accounting.supplementalRawResultsLost ||
      Object.values(
        lossAudit.accounting.perProviderCumulativeActualFreshInferences,
      ).reduce((sum, count) => sum + count, 0) !==
        lossAudit.accounting.cumulativeActualFreshInferences ||
      Object.values(
        lossAudit.accounting.perProviderCumulativeModelLoadCount,
      ).reduce((sum, count) => sum + count, 0) !==
        lossAudit.accounting.cumulativeModelLoadCount ||
      Object.values(
        lossAudit.accounting.perProviderCumulativeProcessStartCount,
      ).reduce((sum, count) => sum + count, 0) !==
        lossAudit.accounting.cumulativeProcessStartCount ||
      exception.previousConsumedInferences !==
        exception.previousPersistedSuccessCount +
          exception.previousLostRawResultCount ||
      exception.maxAdditionalInferences !== pending.length ||
      exception.previousConsumedInferences + pending.length >
        exception.maxCumulativeInferences ||
      machineQualitySemanticHash([...exception.affectedRequestIds].sort()) !==
        machineQualitySemanticHash(
          pending.map((row) => row.requestId).sort(),
        ) ||
      machineQualitySemanticHash(
        lossAudit.unpersistedRequests.map((row) => row.requestId).sort(),
      ) !== machineQualitySemanticHash([...exception.affectedRequestIds].sort())
    )
      throw new Error("C60114_BUDGET_EXCEPTION_IDENTITY_OR_LIMIT_MISMATCH");
  } else if (original.accounting.actualFreshInferences + pending.length > 64) {
    throw new Error("C60114_COMPLETION_BUDGET_EXCEEDED");
  }
  if (reservationDirectory) {
    for (const request of pending) {
      try {
        await readFile(
          path.join(reservationDirectory, `${request.cacheKey}.json`),
        );
        throw new Error("C60114_EXCEPTION_REQUEST_ALREADY_RESERVED");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  // Validate the complete expected wrapper with the actually imported schema
  // before model construction (Vitest/source aliases may differ from CLI dist).
  c60114ProbeExecutionSchema.parse({
    ...original,
    mode: "completion-inherited-fresh",
    ...(input.budgetException
      ? { budgetException: input.budgetException }
      : {}),
    completion: {
      originalProbeByteHash,
      originalProbeSemanticHash: original.semanticHash,
      inheritedFreshCount: original.accounting.actualFreshInferences,
      supplementalFreshCount: 0,
      originalFailedRequestCount: original.accounting.failedRequests,
      completedRequestIds: [],
      extractionRepair: "SOURCE_VIDEO_EXACT_SAMPLE_TRIM_NO_PADDING",
      policyUnchanged: true,
      selectionUnchanged: true,
      successfulRequestsRerun: 0,
      originalContextSelection: original.contextSelection,
      repairs: [],
    },
  });
  // New cache is populated from verified records, never by rewriting old cache.
  await mkdir(input.cacheDirectory);
  // Inherited records are committed before any supplemental inference and
  // before aggregate validation; wrapper failures still leave a replayable set.
  for (const request of original.requests.filter(
    (row) => !pending.includes(row),
  )) {
    const file = path.join(
      input.cacheDirectory,
      C60114_PROBE_CACHE_NAMESPACE,
      request.provider,
      `${request.cacheKey}.json`,
    );
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWriteJson(file, request);
  }
  const adapter =
    input.adapterForTest ??
    (await createC60114LocalProbeRuntime({
      ...input,
      exactSampleExtraction: true,
    }));
  if (
    machineQualitySemanticHash(adapter.identities) !==
    machineQualitySemanticHash(original.runtime)
  ) {
    await adapter.close();
    throw new Error("C60114_COMPLETION_RUNTIME_DRIFT");
  }
  const requests = structuredClone(original.requests);
  const accounting = structuredClone(original.accounting);
  if (lossAudit) {
    accounting.actualFreshInferences =
      lossAudit.accounting.cumulativeActualFreshInferences;
    accounting.inferenceAttemptCount =
      lossAudit.accounting.cumulativeActualFreshInferences;
    accounting.modelLoadCount = lossAudit.accounting.cumulativeModelLoadCount;
    accounting.processStartCount =
      lossAudit.accounting.cumulativeProcessStartCount;
    for (const provider of [
      "whisper-large-v3",
      "reazonspeech-k2-v2",
    ] as const) {
      accounting.perProvider[provider].actualFreshInferences =
        lossAudit.accounting.perProviderCumulativeActualFreshInferences[
          provider
        ];
      accounting.perProvider[provider].inferenceAttemptCount =
        lossAudit.accounting.perProviderCumulativeActualFreshInferences[
          provider
        ];
      accounting.perProvider[provider].modelLoadCount =
        lossAudit.accounting.perProviderCumulativeModelLoadCount[provider];
      accounting.perProvider[provider].processStartCount =
        lossAudit.accounting.perProviderCumulativeProcessStartCount[provider];
    }
  }
  const audioByIdentity = new Map<string, C60114ProbeAudio>();
  const repairs: NonNullable<C60114ProbeExecution["completion"]>["repairs"] =
    [];
  const completedRequestIds: string[] = [];
  let supplementalFreshCount = 0;
  try {
    for (const old of pending) {
      const target = input.targets.find(
        (target) => target.targetId === old.targetId,
      );
      if (
        target?.sourceInterval.start !== old.coreInterval.start ||
        target.sourceInterval.end !== old.coreInterval.end
      )
        throw new Error("C60114_COMPLETION_TARGET_DRIFT");
      let request: C60114ProbeRequest = structuredClone(old);
      let audio = audioByIdentity.get(old.extractionIdentityHash);
      try {
        if (!audio) {
          audio = await adapter.extract(old);
          audioByIdentity.set(old.extractionIdentityHash, audio);
          accounting.extractionCount++;
        }
        const expectedSampleCount = Math.round(
          (old.extractionInterval.end - old.extractionInterval.start) * 16000,
        );
        if (audio.sampleCount !== expectedSampleCount)
          throw new Error("C60114_COMPLETION_SAMPLE_COUNT_MISMATCH");
        request.audioSha256 = audio.audioSha256;
        request.sampleCount = audio.sampleCount;
        if (reservationDirectory) {
          try {
            await atomicWriteJson(
              path.join(reservationDirectory, `${request.cacheKey}.json`),
              {
                schemaVersion: "1.0.0",
                artifactType: "c6-0-1-14-inference-budget-reservation",
                sourceIdentity: input.sourceIdentity,
                sourceTimebase: "SOURCE_GLOBAL_SECONDS",
                runtimeGoldInputCount: 0,
                budgetExceptionHash: input.budgetException?.semanticHash,
                requestId: request.requestId,
                cacheKey: request.cacheKey,
                reservedInferenceCount: 1,
                reservedBeforeProviderDispatch: true,
              },
            );
          } catch (error) {
            throw new C60114ProbePersistenceError(
              "C60114_EXCEPTION_RESERVATION_FAILED",
              { cause: error },
            );
          }
        }
        request.execution = "FRESH_ATTEMPT_FAILED";
        accounting.inferenceAttemptCount++;
        accounting.perProvider[old.provider].inferenceAttemptCount++;
        await writeC60114ProbeJournal({
          directory: input.outputDirectory,
          sourceIdentity: input.sourceIdentity,
          request,
          phase: "INFERENCE_DISPATCH",
          payload: { prompt: "", audioSha256: audio.audioSha256 },
        });
        const result = await adapter.transcribe(request, audio);
        const executed =
          result.inferenceExecuted ?? result.status !== "PROVIDER_ERROR";
        if (executed) {
          request.execution = "FRESH_INFERENCE";
          supplementalFreshCount++;
          accounting.actualFreshInferences++;
          accounting.perProvider[old.provider].actualFreshInferences++;
        }
        await writeC60114ProbeJournal({
          directory: input.outputDirectory,
          sourceIdentity: input.sourceIdentity,
          request,
          phase: "NORMALIZED_RESULT",
          payload: result,
        });
        try {
          input.afterNormalizedResultForTest?.();
        } catch (error) {
          throw new C60114ProbePersistenceError(
            "C60114_INTERRUPTED_AFTER_NORMALIZED_RESULT",
            { cause: error },
          );
        }
        request = {
          ...request,
          status: result.status,
          rawText: result.text,
          rawOutput: result.rawOutput,
          rawOutputHash:
            result.rawOutput === null
              ? null
              : machineQualitySemanticHash(result.rawOutput),
          tokens: result.tokens,
          decoder: result.decoder,
          warnings: result.warnings,
          wallClockSeconds: result.wallClockSeconds,
          localization: localizeC60114Probe({
            target,
            request,
            result,
            guardSeconds: input.policy.exactGuardSeconds,
          }),
          hallucinationRisk: genericHallucinationRisk({
            text: result.text,
            durationSeconds:
              old.extractionInterval.end - old.extractionInterval.start,
          }),
          errorCode:
            result.status === "PROVIDER_ERROR"
              ? "COMPLETION_PROVIDER_FAILURE"
              : null,
        };
        repairs.push({
          requestId: request.requestId,
          sourceInterval: old.extractionInterval,
          expectedSampleCount,
          actualSampleCount: audio.sampleCount,
          audioSha256: audio.audioSha256,
        });
        if (result.status !== "PROVIDER_ERROR")
          completedRequestIds.push(request.requestId);
      } catch (error) {
        if (error instanceof C60114ProbePersistenceError) throw error;
        request.status = audio ? "PROVIDER_ERROR" : "EXTRACTION_ERROR";
        request.errorCode =
          error instanceof Error ? error.message : "COMPLETION_FAILED";
      }
      request.semanticHash = c60114ProbeSemanticHash(request);
      const index = requests.findIndex(
        (row) => row.requestId === request.requestId,
      );
      requests[index] = c60114ProbeRequestSchema.parse(request);
      await writeC60114ProbeJournal({
        directory: input.outputDirectory,
        sourceIdentity: input.sourceIdentity,
        request,
        phase: "FINAL_REQUEST",
        payload: requests[index],
      });
      const cacheFile = path.join(
        input.cacheDirectory,
        C60114_PROBE_CACHE_NAMESPACE,
        request.provider,
        `${request.cacheKey}.json`,
      );
      await mkdir(path.dirname(cacheFile), { recursive: true });
      await atomicWriteJson(cacheFile, requests[index]);
      input.onProgress?.({
        requestId: request.requestId,
        completed: completedRequestIds.length,
        status: request.status,
        execution: request.execution,
      });
    }
  } finally {
    const counts = adapter.counts();
    accounting.modelLoadCount += counts.modelLoadCount;
    accounting.processStartCount += counts.processStartCount;
    for (const provider of [
      "whisper-large-v3",
      "reazonspeech-k2-v2",
    ] as const) {
      accounting.perProvider[provider].modelLoadCount +=
        counts.perProvider?.[provider]?.modelLoadCount ?? 0;
      accounting.perProvider[provider].processStartCount +=
        counts.perProvider?.[provider]?.processStartCount ?? 0;
    }
    await adapter.close();
  }
  accounting.failedRequests = requests.filter(
    (row) => row.status !== "SUCCESS" && row.status !== "EMPTY_OUTPUT",
  ).length;
  accounting.emptyOutputs = requests.filter(
    (row) => row.status === "EMPTY_OUTPUT",
  ).length;
  for (const provider of ["whisper-large-v3", "reazonspeech-k2-v2"] as const) {
    accounting.perProvider[provider].failedRequests = requests.filter(
      (row) =>
        row.provider === provider &&
        row.status !== "SUCCESS" &&
        row.status !== "EMPTY_OUTPUT",
    ).length;
    accounting.perProvider[provider].emptyOutputs = requests.filter(
      (row) => row.provider === provider && row.status === "EMPTY_OUTPUT",
    ).length;
  }
  const value = {
    ...original,
    mode: "completion-inherited-fresh" as const,
    generatedAt: input.generatedAt,
    requests,
    accounting,
    ...(input.budgetException
      ? { budgetException: input.budgetException }
      : {}),
    persistence: await buildC60114ProbePersistence({
      requests,
      cacheDirectory: input.cacheDirectory,
      cacheNamespace: C60114_PROBE_CACHE_NAMESPACE,
    }),
    // Reconcile explanatory reasons against completed evidence without
    // changing a single frozen context request. Original reasons remain below.
    contextSelection: selectC60114ContextTargets(
      input.targets,
      requests,
      input.policy.probes.maxContextTargets,
    ),
    completion: {
      originalProbeByteHash,
      originalProbeSemanticHash: original.semanticHash,
      inheritedFreshCount: original.accounting.actualFreshInferences,
      supplementalFreshCount,
      originalFailedRequestCount: original.accounting.failedRequests,
      completedRequestIds,
      extractionRepair: "SOURCE_VIDEO_EXACT_SAMPLE_TRIM_NO_PADDING" as const,
      policyUnchanged: true as const,
      selectionUnchanged: true as const,
      successfulRequestsRerun: 0 as const,
      originalContextSelection: original.contextSelection,
      repairs,
    },
  };
  // An unvalidated checkpoint preserves all completed requests and counts even
  // if a future aggregate schema rejects the final wrapper.
  await atomicWriteJson(
    path.join(input.outputDirectory, "probe-completion-checkpoint.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-probe-completion-checkpoint",
      sourceIdentity: input.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_SECONDS",
      runtimeGoldInputCount: 0,
      payload: value,
      checkpointHash: machineQualitySemanticHash(value),
    },
  );
  input.afterCompletionCheckpointForTest?.();
  const artifact = c60114ProbeExecutionSchema.parse({
    ...value,
    semanticHash: c60114ProbeSemanticHash(value),
  });
  if (
    machineQualitySemanticHash(
      artifact.contextSelection
        .filter((row) => row.selected)
        .map((row) => row.targetId),
    ) !==
    machineQualitySemanticHash(
      original.contextSelection
        .filter((row) => row.selected)
        .map((row) => row.targetId),
    )
  ) {
    await atomicWriteJson(
      path.join(input.outputDirectory, "missing-dialogue-local-probe.json"),
      artifact,
    );
    throw new Error("C60114_COMPLETION_CONTEXT_SELECTION_DRIFT");
  }
  await atomicWriteJson(
    path.join(input.outputDirectory, "missing-dialogue-local-probe.json"),
    artifact,
  );
  await writeC60114ProbeCacheManifest({
    artifact,
    cacheDirectory: input.cacheDirectory,
    outputDirectory: input.outputDirectory,
  });
  return artifact;
}

/** Pure recovery from the write-ahead completion checkpoint and request
 * journals. No runtime object, model, extraction, or inference is reachable. */
export async function restoreC60114CompletionCheckpoint(input: {
  checkpointPath: string;
  cacheDirectory: string;
  outputDirectory: string;
}): Promise<C60114ProbeExecution> {
  assertC60114ProbePersistenceSchema();
  const envelope = c60114ProbeCompletionCheckpointSchema.parse(
    JSON.parse(await readFile(input.checkpointPath, "utf8")),
  );
  const checkpoint = envelope.payload;
  if (
    checkpoint === null ||
    typeof checkpoint !== "object" ||
    Array.isArray(checkpoint) ||
    envelope.checkpointHash !== machineQualitySemanticHash(checkpoint)
  )
    throw new Error("C60114_RECOVERY_CHECKPOINT_HASH_INVALID");
  const artifact = c60114ProbeExecutionSchema.parse({
    ...checkpoint,
    semanticHash: c60114ProbeSemanticHash(checkpoint),
  });
  if (artifact.mode !== "completion-inherited-fresh" || !artifact.completion)
    throw new Error("C60114_RECOVERY_CHECKPOINT_NOT_COMPLETION");
  if (
    machineQualitySemanticHash(envelope.sourceIdentity) !==
      artifact.sourceIdentityHash ||
    artifact.accounting.plannedRequests !== artifact.requests.length ||
    artifact.accounting.actualFreshInferences !==
      artifact.completion.inheritedFreshCount +
        artifact.completion.supplementalFreshCount +
        (artifact.budgetException?.previousLostRawResultCount ?? 0)
  )
    throw new Error("C60114_RECOVERY_ACCOUNTING_OR_IDENTITY_INVALID");
  if (artifact.budgetException) {
    const { semanticHash, ...core } = artifact.budgetException;
    if (
      semanticHash !== machineQualitySemanticHash(core) ||
      core.sourceIdentityHash !== artifact.sourceIdentityHash ||
      core.policyHash !== artifact.policyHash ||
      core.selectionHash !== artifact.selectionHash ||
      core.originalProbeByteHash !==
        artifact.completion.originalProbeByteHash ||
      core.previousConsumedInferences !==
        core.previousPersistedSuccessCount + core.previousLostRawResultCount ||
      core.previousPersistedSuccessCount !==
        artifact.completion.inheritedFreshCount ||
      artifact.completion.supplementalFreshCount >
        core.maxAdditionalInferences ||
      artifact.accounting.actualFreshInferences >
        core.maxCumulativeInferences ||
      machineQualitySemanticHash([...core.affectedRequestIds].sort()) !==
        machineQualitySemanticHash(
          [...artifact.completion.completedRequestIds].sort(),
        )
    )
      throw new Error("C60114_RECOVERY_BUDGET_EXCEPTION_INVALID");
  } else if (artifact.accounting.actualFreshInferences > 64) {
    throw new Error("C60114_RECOVERY_BUDGET_EXCEEDED");
  }
  if (
    machineQualitySemanticHash(
      artifact.contextSelection
        .filter((row) => row.selected)
        .map((row) => row.targetId),
    ) !==
    machineQualitySemanticHash(
      artifact.completion.originalContextSelection
        .filter((row) => row.selected)
        .map((row) => row.targetId),
    )
  )
    throw new Error("C60114_RECOVERY_CONTEXT_SELECTION_DRIFT");
  for (const request of artifact.requests) {
    if (request.semanticHash !== c60114ProbeSemanticHash(request))
      throw new Error("C60114_RECOVERY_REQUEST_HASH_INVALID");
    if (!artifact.completion.completedRequestIds.includes(request.requestId))
      continue;
    const journal = JSON.parse(
      await readFile(
        path.join(
          path.dirname(input.checkpointPath),
          "request-journal",
          `${request.cacheKey}.FINAL_REQUEST.json`,
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const { journalHash, ...core } = journal;
    if (
      journalHash !== machineQualitySemanticHash(core) ||
      core.requestId !== request.requestId ||
      machineQualitySemanticHash(core.payload) !==
        machineQualitySemanticHash(request)
    )
      throw new Error("C60114_RECOVERY_JOURNAL_HASH_INVALID");
  }
  const persistence = await buildC60114ProbePersistence({
    requests: artifact.requests,
    cacheDirectory: input.cacheDirectory,
    cacheNamespace: artifact.cacheNamespace,
  });
  if (artifact.persistence?.semanticHash !== persistence.semanticHash)
    throw new Error("C60114_RECOVERY_CACHE_PROOF_MISMATCH");
  await mkdir(input.outputDirectory);
  await atomicWriteJson(
    path.join(input.outputDirectory, "missing-dialogue-local-probe.json"),
    artifact,
  );
  await writeC60114ProbeCacheManifest({
    artifact,
    cacheDirectory: input.cacheDirectory,
    outputDirectory: input.outputDirectory,
  });
  await atomicWriteJson(
    path.join(input.outputDirectory, "probe-checkpoint-recovery.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-probe-checkpoint-recovery",
      sourceIdentity: artifact.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_SECONDS",
      runtimeGoldInputCount: 0,
      checkpointByteSha256: await sha256LocalFile(input.checkpointPath),
      inheritedProbeSemanticHash: artifact.semanticHash,
      recoveryActualFreshInferences: 0,
      recoveryModelLoadCount: 0,
      recoveryProcessStartCount: 0,
      recoveryExtractionCount: 0,
    },
  );
  return artifact;
}

/** Restore a provider result even when interruption preceded localization or
 * per-request validation. The target must come from the hash-verified frozen
 * selection named by expectedRequest.selectionHash. No model is reachable. */
export async function restoreC60114NormalizedRequest(input: {
  journalPath: string;
  expectedRequest: C60114ProbeRequest;
  target: C60114ProbeTarget;
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  cacheDirectory: string;
  outputDirectory: string;
}): Promise<C60114ProbeRequest> {
  assertC60114ProbePersistenceSchema();
  assertC60114Policy(input.policy);
  const journal = c60114ProbeJournalSchema.parse(
    JSON.parse(await readFile(input.journalPath, "utf8")),
  );
  const { journalHash, ...core } = journal;
  const expected = c60114ProbeRequestSchema.parse(input.expectedRequest);
  if (
    journalHash !== machineQualitySemanticHash(core) ||
    journal.phase !== "NORMALIZED_RESULT" ||
    machineQualitySemanticHash(input.sourceIdentity) !==
      journal.sourceIdentityHash ||
    machineQualitySemanticHash(journal.sourceIdentity) !==
      journal.sourceIdentityHash ||
    journal.policyHash !== input.policy.semanticHash ||
    expected.semanticHash !== c60114ProbeSemanticHash(expected) ||
    expected.sourceIdentityHash !==
      machineQualitySemanticHash(input.sourceIdentity) ||
    expected.sourceMediaSha256 !== input.sourceIdentity.sourceMediaSha256 ||
    expected.policyHash !== input.policy.semanticHash ||
    journal.requestId !== expected.requestId ||
    input.target.targetId !== expected.targetId ||
    machineQualitySemanticHash(input.target.sourceInterval) !==
      machineQualitySemanticHash(expected.coreInterval)
  )
    throw new Error("C60114_NORMALIZED_JOURNAL_IDENTITY_INVALID");
  for (const key of [
    "requestId",
    "targetId",
    "provider",
    "windowType",
    "coreInterval",
    "extractionInterval",
    "sourceMediaSha256",
    "sourceIdentityHash",
    "policyHash",
    "selectionHash",
    "extractionIdentityHash",
    "cacheKey",
    "runtimeIdentityHash",
    "modelIdentityHash",
    "prompt",
    "vadEnabled",
  ] as const) {
    if (
      machineQualitySemanticHash(journal.request[key]) !==
      machineQualitySemanticHash(expected[key])
    )
      throw new Error("C60114_NORMALIZED_JOURNAL_REQUEST_BINDING_INVALID");
  }
  const { inferenceExecuted, ...parsedResult } =
    c60114ProbeRawResultSchema.parse(journal.payload);
  const result = {
    ...parsedResult,
    ...(inferenceExecuted === undefined ? {} : { inferenceExecuted }),
  };
  const base = {
    ...journal.request,
    status: result.status,
    rawText: result.text,
    rawOutput: result.rawOutput,
    rawOutputHash:
      result.rawOutput === null
        ? null
        : machineQualitySemanticHash(result.rawOutput),
    tokens: result.tokens,
    decoder: result.decoder,
    warnings: result.warnings,
    wallClockSeconds: result.wallClockSeconds,
    localization: localizeC60114Probe({
      target: input.target,
      request: journal.request,
      result,
      guardSeconds:
        journal.request.windowType === "CORE_EXACT"
          ? input.policy.exactGuardSeconds
          : 0,
    }),
    hallucinationRisk: genericHallucinationRisk({
      text: result.text,
      durationSeconds:
        journal.request.extractionInterval.end -
        journal.request.extractionInterval.start,
    }),
    errorCode:
      result.status === "PROVIDER_ERROR" ? "COMPLETION_PROVIDER_FAILURE" : null,
  };
  const restored = c60114ProbeRequestSchema.parse({
    ...base,
    semanticHash: c60114ProbeSemanticHash(base),
  });
  if (restored.audioSha256 === null || restored.sampleCount === null)
    throw new Error("C60114_NORMALIZED_JOURNAL_AUDIO_IDENTITY_MISSING");
  await mkdir(input.outputDirectory);
  const cacheFile = path.join(
    input.cacheDirectory,
    C60114_PROBE_CACHE_NAMESPACE,
    restored.provider,
    `${restored.cacheKey}.json`,
  );
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await atomicWriteJson(cacheFile, restored);
  await atomicWriteJson(
    path.join(input.outputDirectory, "restored-probe-request.json"),
    restored,
  );
  await atomicWriteJson(
    path.join(input.outputDirectory, "normalized-request-recovery.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-normalized-request-recovery",
      sourceIdentity: input.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_SECONDS",
      runtimeGoldInputCount: 0,
      journalByteSha256: await sha256LocalFile(input.journalPath),
      journalHash,
      requestId: restored.requestId,
      requestSemanticHash: restored.semanticHash,
      recoveryActualFreshInferences: 0,
      recoveryModelLoadCount: 0,
      recoveryProcessStartCount: 0,
      recoveryExtractionCount: 0,
    },
  );
  return restored;
}
