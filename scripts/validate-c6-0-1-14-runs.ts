import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { z } from "zod";
import * as shared from "@mvl/shared";
import {
  c60114AcceptanceSummarySchema,
  c60114AcceptanceShareableSchema,
  c60114AcceptanceManualChecksSchema,
  c60114AcceptanceProbeAuditSchema,
  c60114CodeValidationSchema,
  type C60114AcceptanceManualChecks,
  type C60114AcceptanceProbeAudit,
  type C60114AcceptanceSummary,
} from "../packages/shared/src/c6-0-1-14-acceptance-schemas.js";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import {
  assertC60114SourceIdentity,
  c60114Union,
  c60114Intersection,
} from "../packages/video-subtitler/src/review/c60114-policy.js";
import { c60114ProbeSemanticHash } from "../packages/video-subtitler/src/review/missing-dialogue-local-probe.js";
import { assertC60114PlaybackTimelineIntegrity } from "../packages/video-subtitler/src/review/review-playback-timeline-v2.js";
import { inspectReviewWav } from "../packages/video-subtitler/src/review-audio.js";
import { verifyC60114MachineFreeze } from "./lib/c60114-freeze.js";
import {
  c60113ContainedFile,
  c60113FileHash,
  c60113FileIdentity,
  assertC60113ReadOnlyIdentity,
  readC60113Json,
} from "./lib/c60113-acceptance-io.js";

const codeSteps = [
  "typecheck",
  "lint",
  "format-check",
  "build",
  "unit",
  "e2e",
  "c60114-targeted",
] as const;
const same = (a: unknown, b: unknown) => hash(a) === hash(b);
function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined)
    throw new Error(`C60114_ACCEPTANCE_MISSING:${label}`);
  return value;
}
function payloadHash(value: { semanticHash: string }): string {
  const { semanticHash: omitted, ...core } = value;
  void omitted;
  return hash(core);
}
function assertHash<T extends { semanticHash: string }>(
  value: T,
  hasher: (value: T) => string = payloadHash,
): void {
  if (value.semanticHash !== hasher(value))
    throw new Error("C60114_ACCEPTANCE_SEMANTIC_HASH_MISMATCH");
}
const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

export interface C60114AcceptanceSnapshot {
  sourceIdentity: shared.C60114SourceIdentity;
  policyHash: string;
  selectionHash: string;
  probeSemanticHash: string;
  freezeByteSha256: string;
  freezeVerified: boolean;
  strictDeliveryGraphVerified: boolean;
  canonicalByteHashes: Record<"ASS" | "SRT" | "VTT" | "PACKAGE", string>;
  machineSemanticHashes: Record<string, string>;
  playback: shared.C60114PlaybackTimelineV2;
  audio: shared.C60114ReviewAudioManifestV3;
}
export interface C60114AcceptanceProbeBundle {
  artifact: shared.C60114ProbeExecution;
  /** Only records reread from the exact cache manifest may enter this map. */
  verifiedCacheRecords: ReadonlyMap<string, shared.C60114ProbeRequest>;
  manifestVerified: boolean;
  historicalLostSuccessfulResults?: number;
  cumulativeConsumedInferences?: number;
  /** The IO adapter checks the explicit, source/selection-bound authorization. */
  authorizationVerified?: boolean;
}

/** Consumed inference is not persisted evidence. No accounting field creates a result. */
export function auditC60114AcceptanceProbes(
  input: C60114AcceptanceProbeBundle,
): C60114AcceptanceProbeAudit {
  const artifact = shared.c60114ProbeExecutionSchema.parse(input.artifact);
  assertHash(artifact, c60114ProbeSemanticHash);
  const requests = artifact.requests;
  const identityHash = hash(artifact.sourceIdentity);
  const exception = artifact.budgetException;
  const additional =
    exception && input.authorizationVerified
      ? exception.maxAdditionalInferences
      : 0;
  const historicalLoss =
    input.historicalLostSuccessfulResults ??
    exception?.previousLostRawResultCount ??
    0;
  const consumed =
    input.cumulativeConsumedInferences ??
    artifact.accounting.actualFreshInferences;
  let persisted = 0,
    persistedSuccess = 0,
    persistedEmpty = 0,
    cacheVerified = 0;
  for (const request of requests) {
    shared.c60114ProbeRequestSchema.parse(request);
    assertHash(request, c60114ProbeSemanticHash);
    if (
      request.sourceIdentityHash !== identityHash ||
      request.sourceMediaSha256 !== artifact.sourceIdentity.sourceMediaSha256 ||
      request.policyHash !== artifact.policyHash ||
      request.selectionHash !== artifact.selectionHash
    )
      throw new Error("C60114_ACCEPTANCE_PROBE_SOURCE_BINDING_MISMATCH");
    const rawValid =
      (request.status === "SUCCESS" || request.status === "EMPTY_OUTPUT") &&
      request.rawOutput !== null &&
      request.rawOutputHash !== null &&
      request.rawOutputHash === hash(request.rawOutput) &&
      request.audioSha256 !== null &&
      request.sampleCount !== null;
    if (rawValid) {
      persisted++;
      if (request.status === "SUCCESS") persistedSuccess++;
      else persistedEmpty++;
    }
    const cached = input.verifiedCacheRecords.get(request.requestId);
    if (
      rawValid &&
      cached?.status === request.status &&
      cached.rawOutput !== null &&
      cached.rawOutputHash === hash(cached.rawOutput) &&
      cached.rawOutputHash === request.rawOutputHash &&
      cached.cacheKey === request.cacheKey &&
      cached.semanticHash === c60114ProbeSemanticHash(cached) &&
      cached.semanticHash === request.semanticHash
    )
      cacheVerified++;
  }
  const planned = artifact.accounting.plannedRequests;
  const recordedFresh = requests.filter(
    (row) => row.execution === "FRESH_INFERENCE",
  ).length;
  const recordedHits = requests.filter(
    (row) => row.execution === "VERIFIED_EXACT_REPLAY",
  ).length;
  const errors = requests.filter(
    (row) => !["SUCCESS", "EMPTY_OUTPUT"].includes(row.status),
  ).length;
  const empty = requests.filter((row) => row.status === "EMPTY_OUTPUT").length;
  const attempts = requests.filter((row) =>
    ["FRESH_INFERENCE", "FRESH_ATTEMPT_FAILED"].includes(row.execution),
  ).length;
  const providerTotalsMatch = Object.keys(
    artifact.accounting.perProvider,
  ).every((key) => {
    const provider = key as shared.C60114ProbeRequest["provider"];
    const rows = requests.filter((row) => row.provider === provider),
      counts = artifact.accounting.perProvider[provider];
    return (
      counts.cacheHits ===
        rows.filter((row) => row.execution === "VERIFIED_EXACT_REPLAY")
          .length &&
      counts.failedRequests ===
        rows.filter((row) => !["SUCCESS", "EMPTY_OUTPUT"].includes(row.status))
          .length &&
      counts.emptyOutputs ===
        rows.filter((row) => row.status === "EMPTY_OUTPUT").length
    );
  });
  const budgetPassed =
    planned <= 64 &&
    consumed <= 64 + additional &&
    (!exception ||
      (input.authorizationVerified === true &&
        exception.maxCumulativeInferences >= consumed &&
        exception.sourceIdentityHash === identityHash &&
        exception.policyHash === artifact.policyHash &&
        exception.selectionHash === artifact.selectionHash));
  const persistencePassed =
    input.manifestVerified &&
    unique(requests.map((row) => row.requestId)) &&
    unique(requests.map((row) => row.cacheKey)) &&
    planned === requests.length &&
    persisted === planned &&
    cacheVerified === planned;
  const topologyPassed =
    artifact.mode === "exact-cache-only"
      ? consumed === 0 &&
        recordedFresh === 0 &&
        attempts === 0 &&
        artifact.accounting.inferenceAttemptCount === 0 &&
        artifact.accounting.modelLoadCount === 0 &&
        artifact.accounting.processStartCount === 0 &&
        recordedHits === planned &&
        artifact.accounting.cacheHits === planned
      : recordedHits === 0 &&
        artifact.accounting.cacheHits === 0 &&
        recordedFresh === persisted &&
        consumed === recordedFresh + historicalLoss &&
        artifact.accounting.inferenceAttemptCount >= attempts;
  const counts = Object.values(artifact.accounting.perProvider);
  const providerSumsMatch = (
    [
      "actualFreshInferences",
      "inferenceAttemptCount",
      "cacheHits",
      "failedRequests",
      "emptyOutputs",
      "modelLoadCount",
      "processStartCount",
    ] as const
  ).every(
    (key) =>
      counts.reduce((sum, row) => sum + row[key], 0) ===
      artifact.accounting[key],
  );
  const accountingPassed =
    providerTotalsMatch &&
    topologyPassed &&
    artifact.sourceIdentityHash === identityHash &&
    providerSumsMatch &&
    planned ===
      2 *
        (artifact.accounting.selectedTargets +
          artifact.accounting.contextTargets) &&
    artifact.accounting.failedRequests === errors &&
    artifact.accounting.emptyOutputs === empty &&
    artifact.accounting.cacheMisses === 0 &&
    artifact.accounting.actualFreshInferences === consumed;
  return c60114AcceptanceProbeAuditSchema.parse({
    mode: artifact.mode,
    plannedRequests: planned,
    requestRecordCount: requests.length,
    recordedFreshInferences: recordedFresh,
    consumedFreshInferences: consumed,
    persistedResultCount: persisted,
    persistedSuccessfulResults: persistedSuccess,
    persistedEmptyOutputResults: persistedEmpty,
    verifiedCacheResults: cacheVerified,
    replayCacheHits: recordedHits,
    historicalLostSuccessfulResults: historicalLoss,
    unpersistedPlannedRequests: Math.max(
      0,
      planned - Math.min(persisted, cacheVerified),
    ),
    defaultRequestLimit: 64,
    authorizedAdditionalInferences: additional,
    budgetPassed,
    persistencePassed,
    accountingPassed,
    passed: budgetPassed && persistencePassed && accountingPassed,
  });
}

function summarizeCategory(
  budget: shared.C60114BudgetCoverage | undefined,
  label: "MISSING_DIALOGUE" | "HALLUCINATION",
) {
  if (!budget) return null;
  const rows = budget.componentCoverage.filter((row) =>
    row.labels.includes(label),
  );
  const covered = rows.filter(
    (row) => row.layers.audibleReviewCoverage.audible,
  ).length;
  return {
    errorComponentCount: rows.length,
    audibleCoveredCount: covered,
    audibleRecall: rows.length ? covered / rows.length : 1,
    speechCoveredCount: rows.filter((row) => row.layers.machineSpeech.audible)
      .length,
    localizedLexicalCoveredCount: rows.filter(
      (row) =>
        row.layers.localizedLexical.audible &&
        row.independentLocalizedLexicalSourceCount >= 1,
    ).length,
    crossSourceLocalizedCount: rows.filter(
      (row) =>
        row.layers.localizedLexical.audible &&
        row.independentLocalizedLexicalSourceCount >= 2,
    ).length,
    lineageOnlyCount: rows.filter(
      (row) =>
        row.layers.itemLineage.covered &&
        !row.layers.audibleReviewCoverage.audible,
    ).length,
  };
}
function evaluationPlanBindings(
  evaluation: shared.C60114PlaybackCoverageEvaluation,
  snapshot: C60114AcceptanceSnapshot,
): boolean {
  if (
    !same(evaluation.sourceIdentity, snapshot.sourceIdentity) ||
    !unique(evaluation.budgets.map((row) => row.planId)) ||
    evaluation.budgets.length !== snapshot.playback.plans.length
  )
    return false;
  return evaluation.budgets.every((budget) => {
    const plan = snapshot.playback.plans.find(
      (row) => row.planId === budget.planId,
    );
    if (!plan) return false;
    const segments = snapshot.playback.segments.filter((row) =>
      plan.playbackSegmentIds.includes(row.playbackSegmentId),
    );
    const audioIds = snapshot.audio.audio
      .filter(
        (row) =>
          row.regionIds.some((id) => plan.regionIds.includes(id)) ||
          row.coveredReviewTargetIds.some((id) =>
            plan.reviewTargetIds.includes(id),
          ) ||
          segments.some((segment) => segment.audioId === row.audioId),
      )
      .map((row) => row.audioId);
    if (
      !same(budget.selectedPlaybackSegmentIds, plan.playbackSegmentIds) ||
      !same(budget.exactPlaybackSegments, segments) ||
      !same(budget.selectedAudioIds, audioIds) ||
      !same(budget.selectedRegionIds, plan.regionIds) ||
      !same(budget.selectedReviewTargetIds, plan.reviewTargetIds) ||
      budget.budgetSeconds !== plan.budgetSeconds ||
      !same(budget.audibleIntersectionIntervals, plan.sourceIntervalUnion) ||
      !same(budget.selectedPlaybackIntervals, plan.sourceIntervalUnion) ||
      Math.abs(budget.actualAudibleUniqueSeconds - plan.uniqueAudioSeconds) >
        1e-7
    )
      return false;
    if (
      budget.componentCoverage.some((row) => {
        const errors = c60114Union(row.errorIntervals),
          duration = errors.reduce(
            (sum, interval) => sum + interval.end - interval.start,
            0,
          );
        const intersections = errors.flatMap((error) =>
          plan.sourceIntervalUnion.flatMap((interval) => {
            const overlap = c60114Intersection(error, interval);
            return overlap ? [overlap] : [];
          }),
        );
        const overlap = c60114Union(intersections).reduce(
          (sum, interval) => sum + interval.end - interval.start,
          0,
        );
        const layer = row.layers.audibleReviewCoverage;
        return (
          Math.abs(layer.errorDurationSeconds - duration) > 1e-7 ||
          Math.abs(layer.overlapSeconds - overlap) > 1e-7 ||
          Math.abs(layer.coverageRatio - (duration ? overlap / duration : 0)) >
            1e-7
        );
      })
    )
      return false;
    return (["MISSING_DIALOGUE", "HALLUCINATION"] as const).every((label) => {
      const rows = budget.componentCoverage.filter((row) =>
        row.labels.includes(label),
      );
      const audibleIds = rows
        .filter((row) => row.layers.audibleReviewCoverage.audible)
        .map((row) => row.errorComponentId)
        .sort();
      const official =
        label === "MISSING_DIALOGUE"
          ? budget.officialMissingRecall
          : budget.officialHallucinationRecall;
      return (
        official.total === rows.length &&
        official.covered === audibleIds.length &&
        official.recall ===
          (rows.length ? audibleIds.length / rows.length : 1) &&
        same([...official.coveredErrorComponentIds].sort(), audibleIds) &&
        rows.every(
          (row) =>
            row.layers.audibleReviewCoverage.audible ===
            row.layers.audibleReviewCoverage.coverageRatio >= 0.8,
        )
      );
    });
  });
}

export function buildC60114Acceptance(input: {
  finalA: C60114AcceptanceSnapshot;
  finalB: C60114AcceptanceSnapshot;
  fresh: C60114AcceptanceProbeBundle;
  replay: C60114AcceptanceProbeBundle;
  codeValidation: unknown;
  codeValidationByteSha256: string;
  codeLogsVerified: boolean;
  playbackEvaluation: unknown;
  manualChecks?: C60114AcceptanceManualChecks;
  generatedAt: string;
}) {
  const code = c60114CodeValidationSchema.parse(input.codeValidation);
  const evaluation = shared.c60114PlaybackCoverageEvaluationSchema.parse(
    input.playbackEvaluation,
  );
  assertHash(evaluation, c60113HashPayload);
  assertC60114SourceIdentity(
    input.finalA.sourceIdentity,
    input.finalB.sourceIdentity,
  );
  for (const bundle of [input.fresh, input.replay]) {
    assertC60114SourceIdentity(
      bundle.artifact.sourceIdentity,
      input.finalA.sourceIdentity,
    );
    if (
      bundle.artifact.policyHash !== input.finalA.policyHash ||
      bundle.artifact.selectionHash !== input.finalA.selectionHash
    )
      throw new Error("C60114_ACCEPTANCE_FINAL_PROBE_BINDING_MISMATCH");
  }
  const fresh = auditC60114AcceptanceProbes(input.fresh),
    replay = auditC60114AcceptanceProbes(input.replay);
  const semanticParityPassed =
    input.fresh.artifact.semanticHash === input.replay.artifact.semanticHash;
  const audit = input.manualChecks
    ? c60114AcceptanceManualChecksSchema.parse(input.manualChecks)
    : null;
  const codePass =
    input.codeLogsVerified &&
    code.passed &&
    unique(code.results.map((row) => row.id)) &&
    code.results.length === codeSteps.length &&
    codeSteps.every((id) =>
      code.results.some(
        (row) => row.id === id && row.passed && row.exitCode === 0,
      ),
    );
  const booleanChecks = {
    FINAL_FREEZES_AND_READ_ONLY_SOURCE:
      input.finalA.freezeVerified && input.finalB.freezeVerified,
    CANONICAL_BYTE_PARITY: same(
      input.finalA.canonicalByteHashes,
      input.finalB.canonicalByteHashes,
    ),
    MACHINE_SEMANTIC_PARITY: same(
      input.finalA.machineSemanticHashes,
      input.finalB.machineSemanticHashes,
    ),
    STRICT_MACHINE_DELIVERY_GRAPH:
      input.finalA.strictDeliveryGraphVerified &&
      input.finalB.strictDeliveryGraphVerified,
    FRESH_RESULTS_PERSISTED:
      input.fresh.artifact.mode !== "exact-cache-only" && fresh.passed,
    EXACT_CACHE_REPLAY_COMPLETE:
      input.replay.artifact.mode === "exact-cache-only" &&
      replay.passed &&
      replay.plannedRequests === fresh.plannedRequests,
    FRESH_REPLAY_SEMANTIC_PARITY:
      semanticParityPassed &&
      input.finalA.probeSemanticHash === input.fresh.artifact.semanticHash &&
      input.finalB.probeSemanticHash === input.fresh.artifact.semanticHash,
    CODE_VALIDATION: codePass,
  } as const;
  const checks: C60114AcceptanceSummary["engineering"]["checks"] =
    Object.entries(booleanChecks).map(([id, passed]) => ({
      id: shared.c60114AcceptanceCheckIdSchema.parse(id),
      status: passed ? "PASS" : "FAIL",
    }));
  checks.push({
    id: "DATASET_HARDCODING_AUDIT",
    status:
      !audit || audit.datasetSpecificHardcoding.status === "NOT_CHECKED"
        ? "NOT_CHECKED"
        : audit.codeValidationByteSha256 === input.codeValidationByteSha256 &&
            audit.datasetSpecificHardcoding.status === "PASS"
          ? "PASS"
          : "FAIL",
  });
  const engineeringPassed = checks.every((row) => row.status === "PASS");
  const bindings = evaluationPlanBindings(evaluation, input.finalA);
  const evaluationPassed =
    bindings &&
    evaluation.engineeringGates.engineeringPassed &&
    evaluation.engineeringGates.baselineParityPassed &&
    evaluation.engineeringGates.machineFreezeVerified &&
    evaluation.engineeringGates.runtimeGoldInputCount === 0 &&
    evaluation.engineeringGates.canonicalMutationCount === 0 &&
    evaluation.engineeringGates.machineDraftMutationCount === 0 &&
    evaluation.engineeringGates.sourceMutationCount === 0 &&
    evaluation.engineeringGates.goldMutationCount === 0 &&
    evaluation.integrityFailures.length === 0 &&
    evaluation.budgets.every((row) => row.integrityFailures.length === 0);
  const full = evaluation.budgets.find((row) => row.planId === "FULL_QUEUE"),
    mandatory = evaluation.budgets.find(
      (row) => row.planId === "ALL_MANDATORY",
    );
  const category = (label: "MISSING_DIALOGUE" | "HALLUCINATION") => {
    const fullQueue = summarizeCategory(full, label),
      allMandatory = summarizeCategory(mandatory, label);
    const status = !evaluationPassed
      ? "BLOCKED"
      : !fullQueue?.errorComponentCount || !allMandatory?.errorComponentCount
        ? "NOT_EVALUATED"
        : fullQueue.audibleRecall === 1
          ? "PASS"
          : "BLOCKED";
    return { status, fullQueue, allMandatory };
  };
  const missing = category("MISSING_DIALOGUE"),
    hallucination = category("HALLUCINATION");
  let decision: C60114AcceptanceSummary["route"]["decision"] =
    evaluation.routeDecision.primaryDecision;
  if (
    !evaluationPassed ||
    !missing.fullQueue?.errorComponentCount ||
    !hallucination.fullQueue?.errorComponentCount
  )
    decision = "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR";
  else if (!engineeringPassed) decision = "HOLD_FOR_ENGINEERING_REPAIR";
  const common = {
    schemaVersion: "1.0.0",
    engineering: { status: engineeringPassed ? "PASS" : "BLOCKED", checks },
    evaluation: {
      status: evaluationPassed ? "PASS" : "BLOCKED",
      integrityFailureCount: evaluation.integrityFailures.length,
      evaluatedBudgetCount: evaluation.budgets.length,
      playbackPlanBindingsVerified: bindings,
      officialRecallMetric: evaluation.officialRecallMetric,
      lineageMetricStatus: evaluation.lineageMetricStatus,
    },
    missing,
    hallucination,
    probes: { fresh, replay, semanticParityPassed },
    route: {
      decision,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
      humanTrialStarted: false,
      realHumanTrialExecuted: false,
    },
    privacy: {
      fullArtifacts: "LOCAL_ONLY",
      shareableContents: "AGGREGATE_ONLY",
      rawTextIncluded: false,
      rawAudioIncluded: false,
      localPathsIncluded: false,
      sessionDataIncluded: false,
      goldDetailsIncluded: false,
    },
  };
  const core = {
    ...common,
    artifactType: "c6-0-1-14-run-validation",
    visibility: "LOCAL_ONLY",
    generatedAt: input.generatedAt,
    sourceIdentityHash: hash(input.finalA.sourceIdentity),
    inputHashes: {
      finalAFreeze: input.finalA.freezeByteSha256,
      finalBFreeze: input.finalB.freezeByteSha256,
      freshProbes: input.fresh.artifact.semanticHash,
      replayProbes: input.replay.artifact.semanticHash,
      codeValidation: input.codeValidationByteSha256,
      playbackEvaluation: evaluation.semanticHash,
    },
  };
  const shareable = {
    ...common,
    artifactType: "c6-0-1-14-shareable-validation-summary",
    visibility: "SHAREABLE_AGGREGATE_ONLY",
  };
  return {
    summary: c60114AcceptanceSummarySchema.parse({
      ...core,
      semanticHash: hash(core),
    }),
    shareable: c60114AcceptanceShareableSchema.parse({
      ...shareable,
      semanticHash: hash(shareable),
    }),
  };
}

/** Resolve only the package-declared canonical exports. Additional frozen
 * best-effort exports are retained and verified, but are not the canonical set. */
export function c60114CanonicalExportPaths(
  protectedPaths: readonly string[],
  packagePath: string,
  subtitleFiles: { ass: string | null; srt: string | null; vtt: string | null },
): Record<"ASS" | "SRT" | "VTT", string> {
  const directory = path.posix.dirname(packagePath);
  const result = {} as Record<"ASS" | "SRT" | "VTT", string>;
  for (const extension of ["ASS", "SRT", "VTT"] as const) {
    const file =
      subtitleFiles[extension.toLowerCase() as "ass" | "srt" | "vtt"];
    if (
      typeof file !== "string" ||
      path.isAbsolute(file) ||
      file.includes("\\") ||
      file.split("/").includes("..")
    )
      throw new Error("C60114_ACCEPTANCE_CANONICAL_REFERENCE_UNSAFE");
    const relative = path.posix.join(directory, file);
    if (
      path.posix.dirname(relative) !== directory ||
      !relative.endsWith(`.${extension.toLowerCase()}`) ||
      !protectedPaths.includes(relative)
    )
      throw new Error("C60114_ACCEPTANCE_CANONICAL_REFERENCE_NOT_FROZEN");
    result[extension] = relative;
  }
  if (
    new Set(Object.values(result).map((file) => file.slice(0, -4))).size !== 1
  )
    throw new Error("C60114_ACCEPTANCE_CANONICAL_BASENAME_MISMATCH");
  return result;
}

export async function readC60114AcceptanceSnapshot(
  root: string,
  sourcePath: string,
  expectedStage: "final-a" | "final-b",
): Promise<C60114AcceptanceSnapshot> {
  const verified = await verifyC60114MachineFreeze({ root, sourcePath });
  const freeze = shared.c60114MachineFreezeSchema.parse(
    await readC60113Json(
      await c60113ContainedFile(
        root,
        "c6-0-1-14-machine-localization-freeze.json",
      ),
    ),
  );
  if (
    freeze.stage !== expectedStage ||
    freeze.sourceReadOnlyIdentity.sha256 !==
      freeze.sourceIdentity.sourceMediaSha256 ||
    !unique(
      [...freeze.artifacts, ...freeze.protectedMachineFiles].map(
        (row) => row.relativePath,
      ),
    )
  )
    throw new Error("C60114_ACCEPTANCE_FREEZE_SOURCE_OR_STAGE_MISMATCH");
  const read = async <T extends { semanticHash: string }>(
    name: string,
    schema: z.ZodType<T>,
    hasher: (value: T) => string = payloadHash,
  ): Promise<T> => {
    const entry = requireValue(
      freeze.artifacts.find((row) => row.relativePath === name),
      name,
    );
    const value = schema.parse(
      await readC60113Json(await c60113ContainedFile(root, name)),
    );
    assertHash(value, hasher);
    if (entry.semanticHash !== value.semanticHash)
      throw new Error("C60114_ACCEPTANCE_FROZEN_SEMANTIC_BINDING_MISMATCH");
    return value;
  };
  const policy = await read("c6-0-1-14-policy.json", shared.c60114PolicySchema);
  const targets = await read(
    "machine-review-target-intervals-v2.json",
    shared.c60114ReviewTargetsSchema,
  );
  const islands = await read(
    "machine-source-global-speech-islands.json",
    shared.c60114SpeechIslandsSchema,
  );
  const orphan = await read(
    "machine-orphan-speech-sweep.json",
    shared.c60114OrphanSpeechSweepSchema,
  );
  const selection = await read(
    "machine-missing-dialogue-probe-selection.json",
    shared.c60114ProbeSelectionSchema,
  );
  const probes = await read(
    "machine-missing-dialogue-local-probes.json",
    shared.c60114ProbeExecutionSchema,
    c60114ProbeSemanticHash,
  );
  const lexical = await read(
    "machine-localized-missing-lexical-evidence.json",
    shared.c60114LocalizedLexicalEvidenceSchema,
  );
  const missing = await read(
    "machine-missing-speech-evidence-v3.json",
    shared.c60114MissingSpeechEvidenceV3Schema,
  );
  const items = await read(
    "machine-review-items-v4.json",
    shared.c60114ReviewItemsV4Schema,
  );
  const regions = await read(
    "machine-review-regions-v3.json",
    shared.c60114ReviewRegionsV3Schema,
  );
  const audio = await read(
    "machine-review-audio-manifest-v3.json",
    shared.c60114ReviewAudioManifestV3Schema,
  );
  const playback = await read(
    "machine-review-playback-timeline-v2.json",
    shared.c60114PlaybackTimelineV2Schema,
  );
  const completionPolicy = await read(
    "c6-0-1-14-completion-policy.json",
    shared.c60114CompletionPolicySchema,
  );
  const lineage = await read(
    "machine-source-global-lineage-reconciliation.json",
    shared.c60114LineageReconciliationSchema,
  );
  const relocalization = await read(
    "machine-existing-probe-relocalization.json",
    shared.c60114ProbeRelocalizationSchema,
  );
  const shadow = await read(
    "machine-probe-selection-v2-shadow.json",
    shared.c60114ProbeSelectionV2ShadowSchema,
  );
  const receipt = await read(
    "existing-probe-replay-receipt.json",
    shared.c60114ExistingProbeReplaySchema,
  );
  const projections = await read(
    "machine-coverage-projections.json",
    shared.c60114CoverageProjectionsSchema,
  );
  if (
    relocalization.originalProbeSemanticHash !== probes.semanticHash ||
    relocalization.originalSelectionHash !== selection.semanticHash ||
    shadow.originalSelectionHash !== selection.semanticHash ||
    receipt.originalProbeSemanticHash !== probes.semanticHash ||
    receipt.physicalAudioVerificationStatus !== "VERIFIED" ||
    receipt.cacheHitCount !== probes.requests.length ||
    [relocalization, shadow, receipt].some(
      (row) => row.completionPolicyHash !== completionPolicy.semanticHash,
    ) ||
    projections.variants.at(-1)?.diagnostics.sourceArtifactHashes
      .sourceLineage !== lineage.semanticHash
  )
    throw new Error("C60114_COMPLETION_PROVENANCE_GRAPH_MISMATCH");
  for (const artifact of [
    targets,
    islands,
    orphan,
    selection,
    probes,
    lexical,
    missing,
    items,
    regions,
    audio,
    playback,
  ]) {
    assertC60114SourceIdentity(artifact.sourceIdentity, freeze.sourceIdentity);
    if (artifact.policyHash !== policy.semanticHash)
      throw new Error("C60114_ACCEPTANCE_POLICY_BINDING_MISMATCH");
  }
  if (
    lexical.probeSemanticHash !== probes.semanticHash ||
    missing.lexicalEvidenceHash !== lexical.semanticHash ||
    items.targetsHash !== targets.semanticHash ||
    items.missingEvidenceHash !== missing.semanticHash ||
    regions.itemsHash !== items.semanticHash
  )
    throw new Error("C60114_ACCEPTANCE_MACHINE_CHAIN_MISMATCH");
  assertC60114PlaybackTimelineIntegrity({
    sourceIdentity: freeze.sourceIdentity,
    policyHash: policy.semanticHash,
    targets,
    regions,
    audio,
    playback,
  });
  for (const clip of audio.audio) {
    const file = await c60113ContainedFile(
      root,
      path.join("review-workspace-v3", clip.relativePath),
    );
    const wav = inspectReviewWav(await readFile(file));
    if (
      (await c60113FileHash(file)) !== clip.sha256 ||
      wav.frameCount !== clip.frameCount ||
      wav.sampleRate !== clip.sampleRate ||
      wav.channelCount !== clip.channels ||
      wav.bitsPerSample !== clip.bitDepth
    )
      throw new Error("C60114_ACCEPTANCE_PHYSICAL_WAV_MISMATCH");
  }
  const paths = freeze.protectedMachineFiles.map((row) => row.relativePath);
  const packages = paths.filter((name) =>
    /^subtitle-[^/]+\/subtitle-package\.needs-review\.json$/u.test(name),
  );
  if (packages.length !== 1)
    throw new Error("C60114_ACCEPTANCE_PACKAGE_NOT_FROZEN");
  const packagePath = requireValue(packages[0], "canonical package");
  const packageValue = shared.subtitlePackageSchema.parse(
    await readC60113Json(await c60113ContainedFile(root, packagePath)),
  );
  if (packageValue.primarySubtitle?.validationStatus !== "needs-review")
    throw new Error("C60114_ACCEPTANCE_PACKAGE_NOT_NEEDS_REVIEW");
  const canonical = c60114CanonicalExportPaths(
    paths,
    packagePath,
    packageValue.subtitleFiles,
  );
  const canonicalByteHashes =
    {} as C60114AcceptanceSnapshot["canonicalByteHashes"];
  for (const extension of ["ASS", "SRT", "VTT"] as const)
    canonicalByteHashes[extension] = await c60113FileHash(
      await c60113ContainedFile(root, canonical[extension]),
    );
  canonicalByteHashes.PACKAGE = await c60113FileHash(
    await c60113ContainedFile(root, packagePath),
  );
  return {
    sourceIdentity: freeze.sourceIdentity,
    policyHash: policy.semanticHash,
    selectionHash: selection.semanticHash,
    probeSemanticHash: probes.semanticHash,
    freezeByteSha256: verified.freezeSha256,
    freezeVerified: verified.allHashesMatch && verified.sourceIdentityVerified,
    strictDeliveryGraphVerified: true,
    canonicalByteHashes,
    playback,
    audio,
    machineSemanticHashes: Object.fromEntries(
      freeze.artifacts.map((row) => [row.relativePath, row.semanticHash]),
    ),
  };
}

async function readProbeBundle(
  file: string,
  failureAuditPath?: string,
): Promise<C60114AcceptanceProbeBundle> {
  const artifact = shared.c60114ProbeExecutionSchema.parse(
    await readC60113Json(file),
  );
  const manifestPath = path.join(
    path.dirname(file),
    "probe-cache-manifest.local-only.json",
  );
  const manifest = shared.c60114ProbeCacheManifestSchema.parse(
    await readC60113Json(manifestPath),
  );
  assertC60114SourceIdentity(manifest.sourceIdentity, artifact.sourceIdentity);
  assertHash(manifest.persistence);
  if (
    manifest.probeSemanticHash !== artifact.semanticHash ||
    manifest.policyHash !== artifact.policyHash ||
    manifest.selectionHash !== artifact.selectionHash ||
    manifest.persistence.resultCount !== artifact.requests.length ||
    manifest.persistence.resultCount !== manifest.persistence.entries.length ||
    manifest.persistence.persistedSuccessCount !==
      manifest.persistence.entries.filter(
        (row) =>
          (row.status === "SUCCESS" || row.status === "EMPTY_OUTPUT") &&
          row.rawOutputHash !== null,
      ).length ||
    (artifact.persistence !== undefined &&
      !same(artifact.persistence, manifest.persistence)) ||
    !unique(manifest.persistence.entries.map((row) => row.requestId))
  )
    throw new Error("C60114_ACCEPTANCE_CACHE_MANIFEST_BINDING_MISMATCH");
  const verifiedCacheRecords = new Map<string, shared.C60114ProbeRequest>();
  for (const row of manifest.persistence.entries) {
    const cacheFile = await c60113ContainedFile(
      manifest.cacheDirectory,
      path.join(manifest.cacheNamespace, row.provider, `${row.cacheKey}.json`),
    );
    const cached = shared.c60114ProbeRequestSchema.parse(
      await readC60113Json(cacheFile),
    );
    if (
      (await c60113FileHash(cacheFile)) !== row.cacheByteSha256 ||
      cached.requestId !== row.requestId ||
      cached.cacheKey !== row.cacheKey ||
      cached.semanticHash !== row.requestSemanticHash ||
      cached.rawOutputHash !== row.rawOutputHash ||
      cached.status !== row.status
    )
      throw new Error("C60114_ACCEPTANCE_CACHE_PROOF_MISMATCH");
    verifiedCacheRecords.set(row.requestId, cached);
  }
  let historicalLostSuccessfulResults = 0,
    cumulativeConsumedInferences = artifact.accounting.actualFreshInferences,
    authorizationVerified = false;
  if (failureAuditPath) {
    const loss = shared.c60114ProbeFailureAuditSchema.parse(
      await readC60113Json(failureAuditPath),
    );
    assertC60114SourceIdentity(loss.sourceIdentity, artifact.sourceIdentity);
    if (
      loss.policyHash !== artifact.policyHash ||
      loss.selectionHash !== artifact.selectionHash
    )
      throw new Error("C60114_ACCEPTANCE_LOSS_AUDIT_BINDING_MISMATCH");
    historicalLostSuccessfulResults =
      loss.accounting.supplementalRawResultsLost;
    cumulativeConsumedInferences = Math.max(
      cumulativeConsumedInferences,
      loss.accounting.cumulativeActualFreshInferences,
    );
    const exception = artifact.budgetException;
    if (exception) {
      assertHash(exception);
      authorizationVerified =
        exception.lossAuditByteHash ===
          (await c60113FileHash(failureAuditPath)) &&
        exception.originalProbeByteHash === loss.originalProbeByteSha256 &&
        exception.previousConsumedInferences ===
          loss.accounting.cumulativeActualFreshInferences &&
        exception.previousLostRawResultCount ===
          historicalLostSuccessfulResults &&
        exception.previousPersistedSuccessCount ===
          loss.accounting.originalSuccessRawRecords &&
        same(
          [...exception.affectedRequestIds].sort(),
          loss.unpersistedRequests.map((row) => row.requestId).sort(),
        );
    }
  }
  return {
    artifact,
    verifiedCacheRecords,
    manifestVerified: true,
    historicalLostSuccessfulResults,
    cumulativeConsumedInferences,
    authorizationVerified,
  };
}

export interface C60114RunsOptions {
  finalA: string;
  finalB: string;
  freshProbes: string;
  cacheReplayProbes: string;
  codeValidation: string;
  playbackEvaluation: string;
  source: string;
  outputDirectory: string;
  manualChecks?: string;
  probeFailureAudit?: string;
}
/** Explicit files only. This command neither creates sessions nor starts model workers. */
export async function validateC60114Runs(options: C60114RunsOptions) {
  // Reserve the exact new directory first: existing outputs are never overwritten.
  await mkdir(options.outputDirectory, { recursive: false });
  const sourceBefore = await c60113FileIdentity(options.source);
  const [finalA, finalB] = await Promise.all([
    readC60114AcceptanceSnapshot(options.finalA, options.source, "final-a"),
    readC60114AcceptanceSnapshot(options.finalB, options.source, "final-b"),
  ]);
  const [fresh, replay] = await Promise.all([
    readProbeBundle(options.freshProbes, options.probeFailureAudit),
    readProbeBundle(options.cacheReplayProbes),
  ]);
  const codeValidation = c60114CodeValidationSchema.parse(
    await readC60113Json(options.codeValidation),
  );
  for (const row of codeValidation.results) {
    const log = await c60113ContainedFile(
      path.dirname(options.codeValidation),
      row.logRelativePath,
    );
    if ((await c60113FileHash(log)) !== row.logSha256)
      throw new Error("C60114_ACCEPTANCE_CODE_LOG_HASH_MISMATCH");
  }
  const result = buildC60114Acceptance({
    finalA,
    finalB,
    fresh,
    replay,
    codeValidation,
    codeValidationByteSha256: await c60113FileHash(options.codeValidation),
    codeLogsVerified: true,
    playbackEvaluation: await readC60113Json(options.playbackEvaluation),
    ...(options.manualChecks
      ? {
          manualChecks: c60114AcceptanceManualChecksSchema.parse(
            await readC60113Json(options.manualChecks),
          ),
        }
      : {}),
    generatedAt: new Date().toISOString(),
  });
  assertC60113ReadOnlyIdentity(
    sourceBefore,
    await c60113FileIdentity(options.source),
  );
  await shared.atomicWriteJson(
    path.join(
      options.outputDirectory,
      "c6-0-1-14-run-validation.local-only.json",
    ),
    result.summary,
  );
  await shared.atomicWriteJson(
    path.join(options.outputDirectory, "c6-0-1-14-validation.json"),
    result.summary,
  );
  await shared.atomicWriteJson(
    path.join(
      options.outputDirectory,
      "c6-0-1-14-shareable-validation-summary.json",
    ),
    result.shareable,
  );
  return result;
}

async function main() {
  const names = [
    "final-a",
    "final-b",
    "fresh-probes",
    "cache-replay-probes",
    "code-validation",
    "playback-evaluation",
    "source",
    "output-directory",
    "manual-checks",
    "probe-failure-audit",
  ] as const;
  const { values } = parseArgs({
    strict: true,
    options: Object.fromEntries(
      names.map((name) => [name, { type: "string" as const }]),
    ),
  });
  const required = (name: string) =>
    path.resolve(requireValue(values[name], `--${name}`));
  const result = await validateC60114Runs({
    finalA: required("final-a"),
    finalB: required("final-b"),
    freshProbes: required("fresh-probes"),
    cacheReplayProbes: required("cache-replay-probes"),
    codeValidation: required("code-validation"),
    playbackEvaluation: required("playback-evaluation"),
    source: required("source"),
    outputDirectory: required("output-directory"),
    ...(values["manual-checks"]
      ? { manualChecks: required("manual-checks") }
      : {}),
    ...(values["probe-failure-audit"]
      ? { probeFailureAudit: required("probe-failure-audit") }
      : {}),
  });
  process.stdout.write(`${JSON.stringify(result.shareable, null, 2)}\n`);
  if (
    result.summary.engineering.status !== "PASS" ||
    result.summary.evaluation.status !== "PASS"
  )
    process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
