import { readFile, stat, realpath, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  c60114ProbeExecutionSchema,
  c60114ProbeRequestSchema,
  c60114ExistingProbeReplaySchema,
  type C60114ProbeSelection,
  type C60114SourceIdentity,
  type C60114Policy,
  type C60114ProbeExecution,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { buildC60114CompletionPolicy } from "./c60114-completion-policy.js";
import {
  c60114ArtifactHeader,
  withC60114SemanticHash,
  assertC60114SourceIdentity,
} from "./c60114-policy.js";
import {
  buildC60114ProbeRequestIdentity,
  c60114ProbeSemanticHash,
  C60114_PROBE_CACHE_NAMESPACE,
} from "./missing-dialogue-local-probe.js";
import { inspectReviewWav } from "../review-audio.js";

const byteHash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function fail(reason: string): never {
  throw new Error(`C60114_EXISTING_REPLAY_FAIL_CLOSED:${reason}`);
}
const persisted = (s: string) => s === "SUCCESS" || s === "EMPTY_OUTPUT";

/** IO-only exact replay: there is deliberately no adapter, extraction, process,
 * runtime preparation, write, retry, provider fallback, or fresh execution hook. */
export async function replayC60114ExistingProbes(input: {
  freshProbePath: string;
  cacheDirectory: string;
  selection: C60114ProbeSelection;
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  probeAudioDirectories?: readonly string[];
}) {
  const bytes = await readFile(input.freshProbePath);
  const fresh = c60114ProbeExecutionSchema.parse(
    JSON.parse(bytes.toString("utf8")),
  );
  assertC60114SourceIdentity(fresh.sourceIdentity, input.sourceIdentity);
  const selection = input.selection;
  const { semanticHash: selectionHash, ...selectionCore } = selection;
  if (
    hash(selectionCore) !== selectionHash ||
    fresh.selectionHash !== selectionHash ||
    fresh.policyHash !== input.policy.semanticHash ||
    fresh.sourceIdentityHash !== hash(input.sourceIdentity) ||
    fresh.semanticHash !== c60114ProbeSemanticHash(fresh)
  )
    fail("FROZEN_IDENTITY");
  if (
    fresh.accounting.failedRequests ||
    fresh.accounting.cacheMisses ||
    fresh.requests.some((r) => !persisted(r.status))
  )
    fail("INCOMPLETE_PERSISTENCE");
  if (
    fresh.runtime.length !== 2 ||
    new Set(fresh.runtime.map((r) => r.provider)).size !== 2
  )
    fail("RUNTIME_IDENTITY_SET");
  const selected = new Map(selection.targets.map((t) => [t.targetId, t]));
  const context = new Set(
    fresh.contextSelection.filter((r) => r.selected).map((r) => r.targetId),
  );
  const expectedIds = new Set(
    selection.targets.flatMap((t) =>
      fresh.runtime.flatMap((runtime) =>
        [
          "CORE_EXACT" as const,
          ...(context.has(t.targetId) ? ["CORE_CONTEXT" as const] : []),
        ].map(
          (windowType) =>
            buildC60114ProbeRequestIdentity(
              {
                sourceIdentity: input.sourceIdentity,
                policy: input.policy,
                policyHash: input.policy.semanticHash,
                selectionHash,
              },
              t,
              runtime,
              windowType,
            ).requestId,
        ),
      ),
    ),
  );
  if (
    context.size > input.policy.probes.maxContextTargets ||
    [...context].some((id) => !selected.has(id)) ||
    expectedIds.size !== fresh.requests.length ||
    expectedIds.size > input.policy.probes.maxRequests ||
    new Set(fresh.requests.map((r) => r.requestId)).size !== expectedIds.size ||
    fresh.requests.some((r) => !expectedIds.has(r.requestId))
  )
    fail("REQUEST_SET_CHANGED");
  const root = await realpath(input.cacheDirectory);
  const proofs = [];
  const stamps = [];
  const physical = new Map<string, ReturnType<typeof inspectReviewWav>>();
  for (const directory of input.probeAudioDirectories ?? []) {
    const audioRoot = await realpath(directory);
    for (const entry of (
      await readdir(audioRoot, { withFileTypes: true })
    ).filter((entry) => entry.isFile() && entry.name.endsWith(".wav"))) {
      const file = await realpath(path.join(audioRoot, entry.name));
      if (!file.startsWith(audioRoot + path.sep)) fail("AUDIO_PATH_ESCAPE");
      const before = await stat(file),
        bytes = await readFile(file),
        cacheByteHash = byteHash(bytes);
      physical.set(cacheByteHash, inspectReviewWav(bytes));
      stamps.push({ file, before, cacheByteHash });
    }
  }
  const requests: C60114ProbeExecution["requests"] = [];
  for (const original of fresh.requests) {
    const target = selected.get(original.targetId),
      runtime = fresh.runtime.find((r) => r.provider === original.provider);
    if (!target || !runtime) fail("UNAUTHORIZED_TARGET_OR_PROVIDER");
    const expected = buildC60114ProbeRequestIdentity(
      {
        sourceIdentity: input.sourceIdentity,
        policy: input.policy,
        policyHash: input.policy.semanticHash,
        selectionHash,
      },
      target,
      runtime,
      original.windowType,
    );
    const file = await realpath(
      path.join(
        root,
        C60114_PROBE_CACHE_NAMESPACE,
        original.provider,
        `${expected.cacheKey}.json`,
      ),
    ).catch(() => fail("CACHE_MISS"));
    if (!file.startsWith(root + path.sep)) fail("CACHE_PATH_ESCAPE");
    const before = await stat(file),
      cachedBytes = await readFile(file);
    const row = c60114ProbeRequestSchema.parse(
      JSON.parse(cachedBytes.toString("utf8")),
    );
    const identityKeys = [
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
    ] as const;
    if (
      identityKeys.some((k) => hash(row[k]) !== hash(expected[k])) ||
      row.semanticHash !== original.semanticHash ||
      row.semanticHash !== c60114ProbeSemanticHash(row) ||
      row.rawOutput === null ||
      row.rawOutputHash !== hash(row.rawOutput) ||
      row.audioSha256 === null ||
      row.sampleCount === null ||
      !persisted(row.status) ||
      row.audioSha256 !== original.audioSha256 ||
      row.rawOutputHash !== original.rawOutputHash ||
      row.sampleCount !== original.sampleCount ||
      Math.abs(
        row.sampleCount -
          Math.round(
            (row.extractionInterval.end - row.extractionInterval.start) * 16000,
          ),
      ) >
        16000 * buildC60114CompletionPolicy().boundaryRoundingToleranceSeconds +
          1
    )
      fail("CACHE_IDENTITY_OR_RAW_EVIDENCE");
    const cacheByteHash = byteHash(cachedBytes);
    if (input.probeAudioDirectories) {
      const wav = physical.get(row.audioSha256);
      if (wav?.frameCount !== row.sampleCount || wav.sampleRate !== 16000)
        fail("PERSISTED_PHYSICAL_PROBE_AUDIO_MISMATCH");
    }
    stamps.push({ file, before, cacheByteHash });
    proofs.push({
      requestId: row.requestId,
      cacheKey: row.cacheKey,
      cacheByteHash,
      rawOutputHash: row.rawOutputHash,
      requestSemanticHash: row.semanticHash,
      provider: row.provider,
      audioSha256: row.audioSha256,
      runtimeIdentityHash: row.runtimeIdentityHash,
      modelIdentityHash: row.modelIdentityHash,
    });
    requests.push({
      ...row,
      execution: "VERIFIED_EXACT_REPLAY",
      wallClockSeconds: 0,
    });
  }
  for (const { file, before, cacheByteHash } of stamps) {
    const after = await stat(file);
    if (
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      cacheByteHash !== byteHash(await readFile(file))
    )
      fail("CACHE_CHANGED_DURING_REPLAY");
  }
  const providerCounts = (
    provider: "whisper-large-v3" | "reazonspeech-k2-v2",
  ) => ({
    inferenceAttemptCount: 0,
    actualFreshInferences: 0,
    cacheHits: requests.filter((r) => r.provider === provider).length,
    failedRequests: 0,
    emptyOutputs: requests.filter(
      (r) => r.provider === provider && r.status === "EMPTY_OUTPUT",
    ).length,
    modelLoadCount: 0,
    processStartCount: 0,
  });
  const replay = c60114ProbeExecutionSchema.parse({
    ...fresh,
    mode: "exact-cache-only",
    requests,
    accounting: {
      ...fresh.accounting,
      actualFreshInferences: 0,
      inferenceAttemptCount: 0,
      cacheHits: requests.length,
      cacheMisses: 0,
      extractionCount: 0,
      extractionFailures: 0,
      modelLoadCount: 0,
      processStartCount: 0,
      perProvider: {
        "whisper-large-v3": providerCounts("whisper-large-v3"),
        "reazonspeech-k2-v2": providerCounts("reazonspeech-k2-v2"),
      },
    },
  });
  if (c60114ProbeSemanticHash(replay) !== fresh.semanticHash)
    fail("SEMANTIC_PARITY");
  const receipt = c60114ExistingProbeReplaySchema.parse(
    withC60114SemanticHash({
      ...c60114ArtifactHeader(input.policy, input.sourceIdentity),
      artifactType: "c6-0-1-14-existing-probe-replay-receipt",
      completionPolicyHash: buildC60114CompletionPolicy().semanticHash,
      originalProbeByteHash: byteHash(bytes),
      originalProbeSemanticHash: fresh.semanticHash,
      selectionHash,
      requestSetHash: hash([...expectedIds].sort()),
      cacheInventoryHash: hash(
        proofs
          .map((p) => ({ cacheKey: p.cacheKey, sha256: p.cacheByteHash }))
          .sort((a, b) => a.cacheKey.localeCompare(b.cacheKey)),
      ),
      requestIds: requests.map((r) => r.requestId),
      cacheHitCount: requests.length,
      cacheMissCount: 0,
      newInferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      inferenceBudgetRemaining: 0,
      cacheReadOnlyVerified: true,
      rows: proofs,
      physicalAudioVerificationStatus: input.probeAudioDirectories
        ? "VERIFIED"
        : "NOT_REQUESTED",
      physicalAudioCount: input.probeAudioDirectories
        ? new Set(requests.map((row) => row.audioSha256)).size
        : 0,
    }),
  );
  return { fresh, replay, receipt };
}
