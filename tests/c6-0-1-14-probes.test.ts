/* eslint-disable @typescript-eslint/no-non-null-assertion -- Test fixtures assert their exact cardinality. */
/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Assert runtime safety literals as invariants. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  c60114ProbeExecutionSchema,
  c60114ProbeRequestSchema,
  c60114ProbeFailureAuditSchema,
  c60114ProbeBudgetExceptionSchema,
  c60114ProbeSelectionSchema,
  type C60114ProbeExecution,
  type C60114ProbeRuntime,
  type C60114ProbeTarget,
  type C60114SourceIdentity,
  type C60114SpeechIslands,
  type C60114OrphanSpeechSweep,
} from "@mvl/shared";
import {
  assertC60114ProbeBudget,
  c60114ProbeSemanticHash,
  c60114ProbeWindow,
  executeC60114ProbePlan,
  localizeC60114Probe,
  C60114_PROBE_CACHE_NAMESPACE,
  C60114ProbeReplayError,
  type C60114ProbeRawResult,
  type C60114ProbeRuntimeAdapter,
} from "../packages/video-subtitler/src/review/missing-dialogue-local-probe.js";
import { buildLocalizedMissingLexicalEvidence } from "../packages/video-subtitler/src/review/localized-missing-lexical-evidence.js";
import { buildMissingSpeechEvidenceV3 } from "../packages/video-subtitler/src/review/missing-speech-evidence-v3.js";
import { buildC60114Policy } from "../packages/video-subtitler/src/review/c60114-policy.js";
import { machineQualitySemanticHash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import {
  completeC60114ExtractionFailures,
  restoreC60114CompletionCheckpoint,
  restoreC60114NormalizedRequest,
} from "../packages/video-subtitler/src/review/c60114-probe-completion.js";
import { sha256LocalFile } from "../packages/video-subtitler/src/finalization-support.js";
import {
  c60114ArtifactHeader,
  withC60114SemanticHash,
} from "../packages/video-subtitler/src/review/c60114-policy.js";
import {
  relocalizeC60114Probe,
  relocalizeC60114ExistingProbes,
} from "../packages/video-subtitler/src/review/c60114-probe-relocalization.js";
import { replayC60114ExistingProbes } from "../packages/video-subtitler/src/review/c60114-existing-probe-replay.js";
import { buildC60114ProbeSelectionV2Shadow } from "../packages/video-subtitler/src/review/c60114-probe-selection-shadow.js";
import {
  buildC60114SourceGlobalSpeechIslands,
  createC60114SourceEvidence,
} from "../packages/video-subtitler/src/review/source-global-speech-islands.js";
import { buildC60114OrphanSpeechSweep } from "../packages/video-subtitler/src/review/orphan-speech-sweep.js";
import { buildC60114ReviewTargetIntervalsV2 } from "../packages/video-subtitler/src/review/review-target-intervals-v2.js";
import { selectC60114MissingDialogueProbes } from "../packages/video-subtitler/src/review/missing-dialogue-probe-selection.js";

const hash = "a".repeat(64);
const policy = buildC60114Policy();
const sourceIdentity: C60114SourceIdentity = {
  sourceMediaSha256: hash,
  durationSeconds: 300,
  sampleRate: 48000,
  audioStreamIndex: 1,
  audioTimebase: "1/48000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS",
};
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function temp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "c60114-probe-test-"));
  directories.push(directory);
  return directory;
}
function target(index = 0): C60114ProbeTarget {
  return {
    targetId: `target-${index}`,
    sourceIslandId: `island-${index}`,
    sourceInterval: { start: 5 + index * 10, end: 7 + index * 10 },
    itemIds: [],
    evidenceIds: [`ev-${index}`],
    rootLineageIds: [`root-${index}`],
    correlationGroups: [`group-${index}`],
    priorityClass: "UNCOVERED_VERIFIED_SPEECH",
    speechPositive: true,
    validTimebase: true,
    cueCoveredRatio: 0,
    targetCoveredRatio: 0,
    strongContradiction: false,
    reliableLocalizedLexical: false,
    neighborCueIntervals: [],
    reasons: ["SYNTHETIC_VERIFIED_UNCOVERED"],
  };
}
function runtime(provider: C60114ProbeRuntime["provider"]): C60114ProbeRuntime {
  return {
    provider,
    modelId: provider,
    modelRevision: hash,
    modelIdentityHash: hash,
    runtimeIdentityHash: machineQualitySemanticHash(provider),
    modelFileHashes: { model: hash },
    manifestSha256: hash,
    binarySha256: hash,
    workerSha256: null,
    precision: "test",
    device: "test",
    verified: true,
  };
}
function raw(text = "短い声"): C60114ProbeRawResult {
  return {
    status: text ? "SUCCESS" : "EMPTY_OUTPUT",
    text,
    rawOutput: { text, tokenPoints: [], wallClockSeconds: 1 },
    tokens: [],
    decoder: {
      averageLogProbability: null,
      noSpeechProbability: null,
      temperature: null,
    },
    warnings: [],
    wallClockSeconds: 1,
  };
}
function adapter(
  result: (
    request: Parameters<C60114ProbeRuntimeAdapter["transcribe"]>[0],
  ) => C60114ProbeRawResult = () => raw(),
): C60114ProbeRuntimeAdapter & { extracted: number; inferred: number } {
  const state = { extracted: 0, inferred: 0 };
  return {
    get extracted() {
      return state.extracted;
    },
    get inferred() {
      return state.inferred;
    },
    identities: [runtime("whisper-large-v3"), runtime("reazonspeech-k2-v2")],
    extract() {
      state.extracted++;
      return Promise.resolve({
        audioPath: "synthetic.wav",
        audioSha256: hash,
        sampleCount: 33600,
      });
    },
    transcribe(request) {
      expect(request.prompt).toBe("");
      expect(request.vadEnabled).toBe(false);
      state.inferred++;
      return Promise.resolve(result(request));
    },
    counts() {
      return {
        modelLoadCount: state.inferred ? 2 : 0,
        processStartCount: state.inferred ? 2 : 0,
      };
    },
    close() {
      return Promise.resolve();
    },
  };
}
async function run(
  input: {
    targets?: C60114ProbeTarget[];
    provider?: C60114ProbeRuntimeAdapter;
    cache?: string;
    mode?: "fresh" | "exact-cache-only";
  } = {},
) {
  return executeC60114ProbePlan({
    targets: input.targets ?? [target()],
    sourceIdentity,
    policy,
    policyHash: policy.semanticHash,
    selectionHash: hash,
    cacheDirectory: input.cache ?? (await temp()),
    mode: input.mode ?? "fresh",
    generatedAt: "2026-08-30T00:00:00.000Z",
    adapter: input.provider ?? adapter(),
  });
}

async function syntheticBudgetException(
  original: C60114ProbeExecution,
  originalPath: string,
  directory: string,
) {
  const lost = original.requests.filter(
    (request) => request.status === "EXTRACTION_ERROR",
  );
  const lossAuditPath = path.join(directory, "synthetic-loss-audit.json");
  const originalByteHash = await sha256LocalFile(originalPath);
  const audit = c60114ProbeFailureAuditSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-probe-bounded-failure-audit",
    policyVersion: policy.policyVersion,
    status: "BLOCKED_RAW_RESULTS_NOT_PERSISTED",
    sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS",
    runtimeGoldInputCount: 0,
    policyHash: policy.semanticHash,
    selectionHash: hash,
    freezeSemanticHash: hash,
    originalProbeByteSha256: originalByteHash,
    originalProbeSemanticHash: original.semanticHash,
    completionFailureStatusByteSha256: hash,
    accounting: {
      selectedTargets: 24,
      contextTargets: 8,
      plannedRequests: 64,
      originalActualFreshInferences: 62,
      supplementalActualFreshInferences: 2,
      cumulativeActualFreshInferences: 64,
      remainingAuthorizedInferences: 0,
      originalCacheJsonRecords: 64,
      originalSuccessRawRecords: 62,
      originalExtractionErrorRecords: 2,
      completedCacheJsonRecords: 0,
      supplementalRawResultsLost: 2,
      cumulativeModelLoadCount: 4,
      cumulativeProcessStartCount: 4,
      perProviderCumulativeActualFreshInferences: {
        "whisper-large-v3": 32,
        "reazonspeech-k2-v2": 32,
      },
      perProviderCumulativeModelLoadCount: {
        "whisper-large-v3": 2,
        "reazonspeech-k2-v2": 2,
      },
      perProviderCumulativeProcessStartCount: {
        "whisper-large-v3": 2,
        "reazonspeech-k2-v2": 2,
      },
      fullMediaInferenceCount: 0,
      canonicalMutationCount: 0,
      sourceMutationCount: 0,
    },
    repairedAudio: {
      sourceInterval: lost[0]!.extractionInterval,
      sampleRate: 16000,
      sampleCount: 33600,
      channels: 1,
      bitsPerSample: 16,
      audioSha256: hash,
      method: "SOURCE_VIDEO_EXACT_SAMPLE_TRIM_NO_PADDING",
      originalSampleCount: 33580,
      sourceDecodedPrefixMatchesOriginal: true,
    },
    unpersistedRequests: lost.map((request) => ({
      requestId: request.requestId,
      provider: request.provider,
      observedProviderStatus: "SUCCESS",
      observedExecution: "FRESH_INFERENCE",
      rawResultStatus: "NOT_PERSISTED",
      lexicalEvidenceAvailable: false,
    })),
    failure: {
      type: "SyntheticError",
      code: "TEST",
      path: [],
      keys: [],
      stage: "SYNTHETIC",
      cause: "Synthetic test",
      processExitCode: 1,
    },
    recoveryInspection: {
      scope: ["SYNTHETIC"],
      findings: ["SYNTHETIC"],
      rawRecoveryPossibleFromVerifiedArtifacts: false,
    },
    replayStatus: "NOT_RUN_RAW_RESULTS_MISSING",
    completionAccepted: false,
    additionalInferenceForbiddenWithoutExplicitNewAuthorization: true,
  });
  await writeFile(lossAuditPath, JSON.stringify(audit));
  const core = {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-probe-budget-exception",
    authorizationId: "synthetic-only",
    authorizationHash: hash,
    authorizedBy: "USER_EXPLICIT",
    authorizedAt: "2026-08-30T00:00:00.000Z",
    sourceIdentityHash: original.sourceIdentityHash,
    policyHash: original.policyHash,
    selectionHash: original.selectionHash,
    originalProbeByteHash: originalByteHash,
    lossAuditByteHash: await sha256LocalFile(lossAuditPath),
    previousConsumedInferences: 64,
    previousPersistedSuccessCount: 62,
    previousLostRawResultCount: 2,
    maxAdditionalInferences: 2,
    maxCumulativeInferences: 66,
    affectedRequestIds: lost.map((request) => request.requestId),
  };
  const budgetException = c60114ProbeBudgetExceptionSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
  const budgetExceptionPath = path.join(
    directory,
    "synthetic-budget-exception.json",
  );
  await writeFile(budgetExceptionPath, JSON.stringify(budgetException));
  return { budgetException, budgetExceptionPath, lossAuditPath };
}

describe("C60114 completion derivation and IO-only replay", () => {
  it("proposes quality-first time-diverse shadow targets without changing the frozen executed set", async () => {
    const evidence = Array.from({ length: 40 }, (_, i) =>
      createC60114SourceEvidence({
        evidenceId: `speech-${i}`,
        family: "MAPPED_VAD",
        sourceInterval: { start: i * 7 + 1, end: i * 7 + 2 },
        mappingStatus: "VERIFIED",
        speechPositive: true,
        lexicalPositive: false,
        reliableLocalizedLexical: false,
        contradiction: false,
        strength: 0.9,
        rootLineageIds: [`root-${i}`],
        correlationGroup: `root-${i}`,
        providerFamily: "synthetic-vad",
        artifactId: "synthetic",
        artifactSemanticHash: hash,
        sourceIdentityHash: machineQualitySemanticHash(sourceIdentity),
        sceneIds: [],
        speakerIds: [],
        reasons: ["SYNTHETIC"],
      }),
    );
    const speechIslands = buildC60114SourceGlobalSpeechIslands({
      sourceIdentity,
      policy,
      evidence,
      parentGaps: [],
    });
    const reviewTargets = buildC60114ReviewTargetIntervalsV2({
      sourceIdentity,
      policy,
      items: [],
      finalCues: [],
    });
    const orphanSweep = buildC60114OrphanSpeechSweep({
      sourceIdentity,
      policy,
      speechIslands,
      reviewTargets,
      finalCues: [],
    });
    const executedSelection = selectC60114MissingDialogueProbes({
      sourceIdentity,
      policy,
      speechIslands,
      orphanSweep,
      finalCues: [],
    });
    const probes = await run({ targets: executedSelection.targets });
    const relocalization = relocalizeC60114ExistingProbes({
      probes,
      targets: executedSelection.targets,
      policy,
    });
    const input = {
      sourceIdentity,
      policy,
      speechIslands,
      orphanSweep,
      executedSelection,
      probes,
      relocalization,
      finalCues: [],
    };
    const before = JSON.stringify(input),
      shadow = buildC60114ProbeSelectionV2Shadow(input);
    expect(
      new Set(
        shadow.targets
          .filter((row) => row.selected)
          .map((row) => row.timelineBin),
      ).size,
    ).toBe(8);
    expect(shadow.proposedTargetIds).toHaveLength(24);
    expect(shadow.highValueBudgetExhaustedTargetIds).toHaveLength(16);
    expect(shadow.addedTargetIds.length).toBeGreaterThan(0);
    expect(
      shadow.context.filter((row) => row.selected).length,
    ).toBeLessThanOrEqual(8);
    expect(shadow.newInferenceCount).toBe(0);
    expect(shadow.goldUsed).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
    expect(
      buildC60114ProbeSelectionV2Shadow({
        ...input,
        orphanSweep: {
          ...orphanSweep,
          entries: [...orphanSweep.entries].reverse(),
        },
      }).semanticHash,
    ).toBe(shadow.semanticHash);
  });
  it("retains a clean core with 50ms guard contact without claiming strong cross-model text", async () => {
    const t = { ...target(), neighborCueIntervals: [{ start: 4, end: 5 }] };
    const probes = await run({ targets: [t] });
    const before = JSON.stringify(probes);
    const localized = relocalizeC60114ExistingProbes({
      probes,
      targets: [t],
      policy,
    });
    expect(
      localized.requests
        .filter((row) => row.windowType === "CORE_EXACT")
        .every((row) => row.status === "CORE_CLEAN_GUARD_CONTACT_ONLY"),
    ).toBe(true);
    const lexical = buildLocalizedMissingLexicalEvidence({
      targets: [t],
      probes,
      relocalization: localized,
    });
    expect(lexical.targets[0]).toMatchObject({
      classification: "GUARD_CONTACT_CROSS_MODEL_LEXICAL_SUPPORT",
      crossModelLocalizedAgreement: false,
    });
    expect(JSON.stringify(probes)).toBe(before);
    expect(localized.newInferenceCount).toBe(0);
  });
  it("rejects core invasion, crossing tokens, and unprojectable context without deleting original text", async () => {
    const t = target();
    const probes = await run();
    const request = probes.requests.find(
      (row) =>
        row.provider === "whisper-large-v3" && row.windowType === "CORE_EXACT",
    )!;
    expect(
      relocalizeC60114Probe(request, {
        ...t,
        neighborCueIntervals: [{ start: 4, end: 5.01 }],
      }).status,
    ).toBe("CORE_CONTAMINATED_BY_NEIGHBOR");
    const crossing = {
      ...request,
      tokens: [
        {
          text: "短い声",
          localInterval: { start: 0, end: 1 },
          sourceInterval: { start: 4.95, end: 5.95 },
          trusted: true,
        },
      ],
    };
    crossing.semanticHash = c60114ProbeSemanticHash(crossing);
    const result = relocalizeC60114Probe(crossing, t);
    expect(result.status).toBe("CORE_LOCALIZATION_UNRESOLVED");
    expect(result.candidateText).toBe(request.rawText);
    const context = probes.requests.find(
      (row) => row.windowType === "CORE_CONTEXT",
    );
    if (context)
      expect(relocalizeC60114Probe(context, t).status).toBe(
        "CONTEXT_TEXT_UNPROJECTABLE",
      );
  });
  it("replays only hash-bound persisted requests and fails closed on a miss without any provider hook", async () => {
    const targets = [target()],
      cache = await temp();
    const selection = c60114ProbeSelectionSchema.parse(
      withC60114SemanticHash({
        ...c60114ArtifactHeader(policy, sourceIdentity),
        artifactType: "missing-dialogue-probe-selection",
        targets,
        decisions: [],
        budget: {
          maximumTargets: 24,
          maximumLaterContextTargets: 8,
          maximumRequests: 64,
          selectedCoreRequestCount: 2,
          reservedContextRequestCount: 16,
        },
      }),
    );
    const provider = adapter();
    provider.extract = (request) =>
      Promise.resolve({
        audioPath: "synthetic.wav",
        audioSha256: hash,
        sampleCount: Math.round(
          (request.extractionInterval.end - request.extractionInterval.start) *
            16000,
        ),
      });
    const fresh = await executeC60114ProbePlan({
      targets,
      sourceIdentity,
      policy,
      policyHash: policy.semanticHash,
      selectionHash: selection.semanticHash,
      cacheDirectory: cache,
      mode: "fresh",
      generatedAt: "2026-08-30T00:00:00.000Z",
      adapter: provider,
    });
    const freshProbePath = path.join(cache, "synthetic-probes.json");
    await writeFile(freshProbePath, JSON.stringify(fresh));
    const input = {
      freshProbePath,
      cacheDirectory: cache,
      selection,
      sourceIdentity,
      policy,
    };
    const replay = await replayC60114ExistingProbes(input);
    expect(replay.replay.semanticHash).toBe(fresh.semanticHash);
    expect(replay.receipt).toMatchObject({
      newInferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      cacheReadOnlyVerified: true,
      cacheHitCount: fresh.requests.length,
    });
    const first = fresh.requests[0]!;
    const original = path.join(
      cache,
      C60114_PROBE_CACHE_NAMESPACE,
      first.provider,
      `${first.cacheKey}.json`,
    );
    const hashBefore = await sha256LocalFile(original);
    await replayC60114ExistingProbes(input);
    expect(await sha256LocalFile(original)).toBe(hashBefore);
    const count = provider.inferred;
    await rm(original);
    await expect(replayC60114ExistingProbes(input)).rejects.toThrow(
      "CACHE_MISS",
    );
    expect(provider.inferred).toBe(count);
  });
});

describe("C6.0.1.14 bounded prompt-free probes", () => {
  it.each(["none", "wrapper", "normalized", "exception"] as const)(
    "inherits62 and persists recovery across failure/budget mode=%s",
    async (failureMode) => {
      const injectWrapperFailure = failureMode === "wrapper";
      const targets = Array.from({ length: 24 }, (_, index) => target(index));
      const provider = adapter((request) =>
        raw(request.provider === "whisper-large-v3" ? "声" : "音"),
      );
      const ordinaryExtract = provider.extract.bind(provider);
      provider.extract = (request) =>
        request.targetId === target(13).targetId &&
        request.windowType === "CORE_EXACT"
          ? Promise.reject(new Error("SYNTHETIC_EXTRACTION_DRIFT"))
          : ordinaryExtract(request);
      const original = await run({ targets, provider });
      expect(original.accounting).toMatchObject({
        actualFreshInferences: 62,
        failedRequests: 2,
      });
      const directory = await temp(),
        originalPath = path.join(directory, "original.json"),
        outputDirectory = path.join(directory, "completed"),
        cacheDirectory = path.join(directory, "completed-cache");
      await writeFile(originalPath, JSON.stringify(original));
      await mkdir(outputDirectory);
      const budgetArgs =
        failureMode === "exception"
          ? await syntheticBudgetException(original, originalPath, directory)
          : {};
      const supplement = adapter((request) =>
        raw(request.provider === "whisper-large-v3" ? "声" : "音"),
      );
      supplement.extract = (request) =>
        Promise.resolve({
          audioPath: "synthetic.wav",
          audioSha256: hash,
          sampleCount: Math.round(
            (request.extractionInterval.end -
              request.extractionInterval.start) *
              16000,
          ),
        });
      const transcribe = supplement.transcribe.bind(supplement);
      supplement.transcribe = async (request, audio) => {
        if (supplement.inferred === 1) {
          const previous = original.requests.find(
            (row) =>
              row.targetId === target(13).targetId &&
              row.provider === "whisper-large-v3" &&
              row.windowType === "CORE_EXACT",
          )!;
          const persisted = c60114ProbeRequestSchema.parse(
            JSON.parse(
              await readFile(
                path.join(
                  cacheDirectory,
                  C60114_PROBE_CACHE_NAMESPACE,
                  previous.provider,
                  `${previous.cacheKey}.json`,
                ),
                "utf8",
              ),
            ),
          );
          expect(persisted.status).toBe("SUCCESS");
          expect(persisted.rawOutput).not.toBeNull();
          expect(
            await readFile(
              path.join(
                outputDirectory,
                "request-journal",
                `${previous.cacheKey}.NORMALIZED_RESULT.json`,
              ),
              "utf8",
            ),
          ).toContain("NORMALIZED_RESULT");
        }
        return transcribe(request, audio);
      };
      const completionInput: Parameters<
        typeof completeC60114ExtractionFailures
      >[0] = {
        targets,
        sourceIdentity,
        policy,
        policyHash: policy.semanticHash,
        selectionHash: hash,
        mode: "fresh",
        cacheDirectory,
        outputDirectory,
        generatedAt: "2026-08-30T00:00:00.000Z",
        resumeIncompleteExtraction: originalPath,
        sourcePath: "synthetic.mp4",
        whisperRuntimeManifestPath: "synthetic.json",
        whisperModelPath: "synthetic.bin",
        whisperModelSha256: hash,
        reazonModelDirectory: "synthetic-models",
        reazonPython: "synthetic-python",
        adapterForTest: supplement,
        ...budgetArgs,
        afterCompletionCheckpointForTest: () => {
          if (injectWrapperFailure)
            throw new Error("SYNTHETIC_WRAPPER_SCHEMA_FAILURE");
        },
        afterNormalizedResultForTest: () => {
          if (failureMode === "normalized")
            throw new Error("SYNTHETIC_BEFORE_LOCALIZATION");
        },
      };
      const completion = completeC60114ExtractionFailures(completionInput);
      if (failureMode === "normalized") {
        await expect(completion).rejects.toThrow(
          "C60114_INTERRUPTED_AFTER_NORMALIZED_RESULT",
        );
        expect(supplement.inferred).toBe(1);
        const expectedRequest = original.requests.find(
          (row) => row.status === "EXTRACTION_ERROR",
        )!;
        const restored = await restoreC60114NormalizedRequest({
          journalPath: path.join(
            outputDirectory,
            "request-journal",
            `${expectedRequest.cacheKey}.NORMALIZED_RESULT.json`,
          ),
          expectedRequest,
          target: targets.find(
            (row) => row.targetId === expectedRequest.targetId,
          )!,
          sourceIdentity,
          policy,
          cacheDirectory: path.join(directory, "normalized-restored-cache"),
          outputDirectory: path.join(directory, "normalized-restored-output"),
        });
        expect(restored.status).toBe("SUCCESS");
        expect(restored.rawOutput).not.toBeNull();
        expect(restored.semanticHash).toBe(c60114ProbeSemanticHash(restored));
        expect(supplement.inferred).toBe(1);
        return;
      }
      if (injectWrapperFailure)
        await expect(completion).rejects.toThrow(
          "SYNTHETIC_WRAPPER_SCHEMA_FAILURE",
        );
      const completed = injectWrapperFailure
        ? await restoreC60114CompletionCheckpoint({
            checkpointPath: path.join(
              outputDirectory,
              "probe-completion-checkpoint.json",
            ),
            cacheDirectory,
            outputDirectory: path.join(directory, "restored-with-zero-runtime"),
          })
        : await completion;
      expect(supplement.inferred).toBe(2);
      expect(completed.mode).toBe("completion-inherited-fresh");
      expect(completed.accounting).toMatchObject({
        actualFreshInferences: failureMode === "exception" ? 66 : 64,
        failedRequests: 0,
      });
      expect(completed.persistence).toMatchObject({
        resultCount: 64,
        persistedSuccessCount: 64,
      });
      expect(completed.completion).toMatchObject({
        inheritedFreshCount: 62,
        supplementalFreshCount: 2,
        originalFailedRequestCount: 2,
        successfulRequestsRerun: 0,
      });
      expect(await readFile(originalPath, "utf8")).toBe(
        JSON.stringify(original),
      );
      const replay = await run({
        targets,
        cache: cacheDirectory,
        mode: "exact-cache-only",
      });
      expect(replay.accounting.cacheHits).toBe(64);
      expect(replay.semanticHash).toBe(completed.semanticHash);
      if (failureMode === "exception") {
        const duplicate = adapter();
        await expect(
          completeC60114ExtractionFailures({
            ...completionInput,
            cacheDirectory: path.join(directory, "duplicate-cache"),
            outputDirectory: path.join(directory, "duplicate-output"),
            adapterForTest: duplicate,
          }),
        ).rejects.toThrow("C60114_EXCEPTION_REQUEST_ALREADY_RESERVED");
        expect(duplicate.inferred).toBe(0);
        expect(duplicate.extracted).toBe(0);
      }
    },
  );
  it("CLI refuses changed preflight bytes before any model runtime can start", async () => {
    const directory = await temp();
    const selectionCore = {
      schemaVersion: "1.0.0",
      policyVersion: policy.policyVersion,
      policyHash: policy.semanticHash,
      sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_SECONDS",
      runtimeGoldInputCount: 0,
      artifactType: "missing-dialogue-probe-selection",
      targets: [],
      decisions: [],
      budget: {
        maximumTargets: 24,
        maximumLaterContextTargets: 8,
        maximumRequests: 64,
        selectedCoreRequestCount: 0,
        reservedContextRequestCount: 16,
      },
    };
    const selection = {
      ...selectionCore,
      semanticHash: machineQualitySemanticHash(selectionCore),
    };
    const freezeCore = {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-pre-probe-freeze",
      policyHash: policy.semanticHash,
      selectionHash: selection.semanticHash,
      policyByteHash: "b".repeat(64),
      selectionByteHash: "b".repeat(64),
      sourceIdentity,
      runtimeGoldInputCount: 0,
      frozenAt: "2026-08-30T00:00:00.000Z",
    };
    await writeFile(
      path.join(directory, "policy.json"),
      JSON.stringify(policy),
    );
    await writeFile(
      path.join(directory, "selection.json"),
      JSON.stringify(selection),
    );
    await writeFile(
      path.join(directory, "freeze.json"),
      JSON.stringify({
        ...freezeCore,
        semanticHash: machineQualitySemanticHash(freezeCore),
      }),
    );
    await expect(
      promisify(execFile)(process.execPath, [
        "--import",
        "tsx",
        "scripts/run-c6-0-1-14-probes.ts",
        "--policy",
        path.join(directory, "policy.json"),
        "--selection",
        path.join(directory, "selection.json"),
        "--preflight-freeze",
        path.join(directory, "freeze.json"),
        "--source",
        path.join(directory, "no-source.mp4"),
        "--output-directory",
        path.join(directory, "result"),
        "--mode",
        "fresh",
      ]),
    ).rejects.toThrow("C60114_PRE_PROBE_FREEZE_IDENTITY_MISMATCH");
    const status = JSON.parse(
      await readFile(
        path.join(directory, "result", "probe-run-status.json"),
        "utf8",
      ),
    ) as { status: string; freezeSemanticHash: string | null };
    expect(status.status).toBe("PREFLIGHT_FAILED");
    expect(status.freezeSemanticHash).toBeNull();
  });
  it("enforces 24 exact targets and eight context escalations, at most64 requests", async () => {
    const provider = adapter(() => raw(""));
    const result = await run({
      targets: Array.from({ length: 24 }, (_, index) => target(index)),
      provider,
    });
    expect(result.accounting).toMatchObject({
      selectedTargets: 24,
      contextTargets: 8,
      plannedRequests: 64,
      actualFreshInferences: 64,
      extractionCount: 32,
      emptyOutputs: 64,
      fullMediaRequests: 0,
    });
    expect(result.contextSelection.filter((row) => row.selected)).toHaveLength(
      8,
    );
    expect(provider.inferred).toBe(64);
    expect(() =>
      assertC60114ProbeBudget({
        targets: Array.from({ length: 25 }, (_, index) => target(index)),
        sourceIdentity,
        policy,
      }),
    ).toThrow("BUDGET");
  });
  it("rejects whole media and overlong target requests before inference", () => {
    expect(() =>
      assertC60114ProbeBudget({
        targets: [{ ...target(), sourceInterval: { start: 0, end: 300 } }],
        sourceIdentity,
        policy,
      }),
    ).toThrow("WHOLE_MEDIA");
    expect(() =>
      c60114ProbeWindow(
        { ...target(), sourceInterval: { start: 0, end: 2 } },
        { ...sourceIdentity, durationSeconds: 2 },
        policy,
        "CORE_EXACT",
      ),
    ).toThrow("WHOLE_MEDIA");
  });
  it("does not escalate stable localized agreement and never changes input", async () => {
    const targets = [target()];
    const before = JSON.stringify(targets);
    const result = await run({ targets });
    expect(result.accounting.plannedRequests).toBe(2);
    expect(result.contextSelection[0]?.selected).toBe(false);
    expect(JSON.stringify(targets)).toBe(before);
    expect(c60114ProbeExecutionSchema.safeParse(result).success).toBe(true);
    expect(
      c60114ProbeRequestSchema.safeParse({
        ...result.requests[0],
        prompt: "subtitle seed",
      }).success,
    ).toBe(false);
  });
  it("fresh really infers and exact replay does not extract, infer or load models", async () => {
    const cache = await temp();
    const fresh = await run({ cache });
    const provider = adapter();
    const replay = await run({ cache, mode: "exact-cache-only", provider });
    expect(replay.semanticHash).toBe(fresh.semanticHash);
    expect(replay.accounting).toMatchObject({
      actualFreshInferences: 0,
      cacheHits: 2,
      extractionCount: 0,
      modelLoadCount: 0,
      processStartCount: 0,
    });
    expect(provider.extracted).toBe(0);
    expect(provider.inferred).toBe(0);
    const freshAgain = await run({
      cache,
      provider: adapter(() => raw("別の声")),
    });
    expect(freshAgain.accounting.actualFreshInferences).toBe(2);
    expect(freshAgain.requests[0]?.rawText).toBe("別の声");
  });
  it("fails closed on cache identity changes without calling ASR", async () => {
    const cache = await temp();
    const fresh = await run({ cache });
    const request = fresh.requests[0]!;
    const file = path.join(
      cache,
      C60114_PROBE_CACHE_NAMESPACE,
      request.provider,
      `${request.cacheKey}.json`,
    );
    const stored = JSON.parse(await readFile(file, "utf8")) as Record<
      string,
      unknown
    >;
    stored.sourceIdentityHash = "b".repeat(64);
    await writeFile(file, JSON.stringify(stored));
    const provider = adapter();
    const error = await run({
      cache,
      mode: "exact-cache-only",
      provider,
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(C60114ProbeReplayError);
    if (!(error instanceof C60114ProbeReplayError))
      throw new Error("Expected cache replay failure");
    const result = error.artifact;
    expect(result.requests[0]?.status).toBe("CACHE_INVALID");
    expect(result.accounting.failedRequests).toBeGreaterThan(0);
    expect(provider.inferred).toBe(0);
  });
  it("keeps failed provider and empty ASR separate", async () => {
    const result = await run({
      provider: adapter((request) =>
        request.provider === "whisper-large-v3"
          ? raw("")
          : { ...raw(""), status: "PROVIDER_ERROR" },
      ),
    });
    expect(result.accounting.failedRequests).toBe(2);
    expect(result.accounting.emptyOutputs).toBe(2);
    const lexical = buildLocalizedMissingLexicalEvidence({
      targets: [target()],
      probes: result,
    });
    expect(lexical.targets[0]?.classification).not.toBe("BOTH_EMPTY");
  });
  it("semantic hash excludes execution/path/time but preserves token evidence", () => {
    expect(
      c60114ProbeSemanticHash({
        text: "声",
        execution: "fresh",
        audioPath: "/a",
        wallClockSeconds: 1,
      }),
    ).toBe(
      c60114ProbeSemanticHash({
        text: "声",
        execution: "replay",
        audioPath: "/b",
        wallClockSeconds: 30,
      }),
    );
    expect(
      c60114ProbeSemanticHash({ tokens: [{ text: "声", trusted: true }] }),
    ).not.toBe(
      c60114ProbeSemanticHash({ tokens: [{ text: "声", trusted: false }] }),
    );
  });
});

describe("C6.0.1.14 exact/context island localization", () => {
  const core = { start: 5, end: 7 };
  const request = {
    windowType: "CORE_CONTEXT" as const,
    coreInterval: core,
    extractionInterval: { start: 3.5, end: 8.5 },
  };
  it("refuses context without complete trustworthy token spans", () => {
    expect(
      localizeC60114Probe({
        target: target(),
        request,
        result: raw("前短い声後"),
        guardSeconds: 0,
      }).status,
    ).toBe("CONTEXT_TEXT_UNPROJECTABLE");
  });
  it("projects only contiguous monotonic complete token chain inside core", () => {
    const result = {
      ...raw("前声後"),
      tokens: [
        {
          text: "前",
          sourceInterval: { start: 4, end: 4.5 },
          trusted: true,
          probability: 0.9,
          reason: "verified",
        },
        {
          text: "声",
          sourceInterval: { start: 5.2, end: 6.5 },
          trusted: true,
          probability: 0.9,
          reason: "verified",
        },
        {
          text: "後",
          sourceInterval: { start: 7.3, end: 8 },
          trusted: true,
          probability: 0.9,
          reason: "verified",
        },
      ],
    };
    expect(
      localizeC60114Probe({
        target: target(),
        request,
        result,
        guardSeconds: 0,
      }),
    ).toMatchObject({
      status: "TRUSTED_GLOBAL_TOKEN_PROJECTION",
      localizedText: "声",
      completeness: "TOKEN_CHAIN_COMPLETE",
    });
    result.tokens[1]!.sourceInterval = { start: 4.9, end: 6.5 };
    expect(
      localizeC60114Probe({
        target: target(),
        request,
        result,
        guardSeconds: 0,
      }).localizedText,
    ).toBeNull();
  });
  it("checks guard and neighbor overlap before treating whole exact text local", () => {
    const guarded = {
      ...request,
      windowType: "CORE_EXACT" as const,
      extractionInterval: { start: 4.95, end: 7.05 },
    };
    const result = localizeC60114Probe({
      target: {
        ...target(),
        neighborCueIntervals: [{ start: 4.8, end: 4.99 }],
      },
      request: guarded,
      result: raw(),
      guardSeconds: 0.05,
    });
    expect(result.status).toBe("CORE_GUARD_OR_NEIGHBOR_UNRESOLVED");
    expect(result.localizedText).toBeNull();
    expect(result.guardNeighborOverlapSeconds).toBeGreaterThan(0);
  });
});

describe("C6.0.1.14 lexical reconciliation and V3", () => {
  function evidence(probes: Awaited<ReturnType<typeof run>>) {
    const lexicalEvidence = buildLocalizedMissingLexicalEvidence({
      targets: [target()],
      probes,
    });
    const speechIslands = {
      sourceIdentity,
      policyHash: policy.semanticHash,
      parentGaps: [
        {
          gapId: "gap",
          sourceInterval: { start: 0, end: 30 },
          itemIds: [],
          searchEnvelopeOnly: true,
        },
      ],
      islands: [
        {
          islandId: "unprobed",
          sourceInterval: { start: 40, end: 41 },
          strongContradiction: false,
          localizationStatus: "VERIFIED",
          reliableLocalizedLexical: false,
          reasons: ["OBSERVED"],
        },
      ],
      globalIslands: [],
    } as unknown as C60114SpeechIslands;
    const orphanSweep = {
      sourceIdentity,
      entries: [],
    } as unknown as C60114OrphanSpeechSweep;
    return {
      sourceIdentity,
      policyHash: policy.semanticHash,
      targets: [target()],
      lexicalEvidence,
      speechIslands,
      orphanSweep,
    };
  }
  it("keeps pronunciation unavailable without verified reading mechanism", async () => {
    const probes = await run({
      provider: adapter((request) =>
        raw(request.provider === "whisper-large-v3" ? "橋" : "箸"),
      ),
    });
    const lexical = buildLocalizedMissingLexicalEvidence({
      targets: [target()],
      probes,
    });
    expect(lexical.targets[0]?.pronunciationAgreement).toBeNull();
    expect(lexical.targets[0]?.classification).toBe(
      "CROSS_MODEL_LEXICAL_DISAGREEMENT",
    );
    const read = buildLocalizedMissingLexicalEvidence({
      targets: [target()],
      probes,
      verifiedReadings: {
        runtimeIdentityHash: hash,
        readings: new Map(
          probes.requests.map((row) => [row.requestId, "はし"]),
        ),
      },
    });
    expect(read.targets[0]?.classification).toBe("PRONUNCIATION_AGREEMENT");
  });
  it("strong is review-only, requires uncovered identity, and retains unprobed islands", async () => {
    const input = evidence(await run());
    const before = JSON.stringify(input);
    const v3 = buildMissingSpeechEvidenceV3(input);
    expect(
      v3.targets.find((row) => row.targetId === target().targetId)
        ?.classification,
    ).toBe("MISSING_DIALOGUE_CROSS_MODEL_STRONG");
    expect(
      v3.targets.find((row) => row.targetId === "unprobed")?.classification,
    ).toBe("SPEECH_ISLAND_OBSERVED");
    expect(
      v3.targets.every(
        (row) =>
          row.requiresHumanReview &&
          !row.canonicalCoverageCredit &&
          !row.autoCueGenerationAllowed,
      ),
    ).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    input.targets[0]!.cueCoveredRatio = 0.1;
    expect(
      buildMissingSpeechEvidenceV3(input).targets.find(
        (row) => row.targetId === target().targetId,
      )?.classification,
    ).not.toBe("MISSING_DIALOGUE_CROSS_MODEL_STRONG");
    input.lexicalEvidence.sourceIdentityHash = "b".repeat(64);
    expect(
      buildMissingSpeechEvidenceV3(input).targets.find(
        (row) => row.targetId === target().targetId,
      )?.classification,
    ).toBe("LOCALIZATION_UNRESOLVED");
  });
});
