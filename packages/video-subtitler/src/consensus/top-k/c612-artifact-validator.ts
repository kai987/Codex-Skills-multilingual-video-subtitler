import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import * as s from "@mvl/shared";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../../blind-acceptance/gold-isolation.js";
import { hash, ratio, c612Defined } from "./c612-policy.js";
import { fileHash } from "./c612-acoustic-io.js";
import {
  safeC612ArtifactPath,
  treeFiles,
  verifyRerankingFreeze,
  fileManifest,
} from "./c612-delivery-io.js";
import { c612RequiredSourceFiles } from "./c612-machine-stage.js";
import { readC612FrozenInputs } from "./c612-frozen-inputs.js";
import { fullCandidateRankAudit } from "./full-candidate-rank-audit.js";
import { buildTopK } from "./top-k-candidate-builder.js";
import { reconcileIdentities } from "./correlation-identity.js";
import {
  buildFixedMappingV2,
  buildC612Folds,
} from "./fixed-cue-group-mapping-v2.js";
import { buildTopKFeatures } from "./top-k-feature-table.js";
import { buildContractionAudit } from "./contraction-audit.js";
import { runC612Oof } from "./top-k-oof-reranking.js";
import {
  buildGroupConfigurations,
  renderC612Shadow,
} from "./group-shadow-configurations.js";
import { evaluateRetrieval } from "./fixed-group-evaluation.js";
export function c612Require(
  condition: unknown,
  code: string,
): asserts condition {
  if (!condition) throw new Error(code);
}
export function sameC612(a: unknown, b: unknown, code: string) {
  c612Require(hash(a) === hash(b), code);
}
export function verifyC612SelfHash(value: { semanticHash: string }) {
  const { semanticHash, ...body } = value;
  sameC612(semanticHash, hash(body), "C612_INVALID_ARTIFACT_SELF_HASH");
}
export async function c612Json<T>(
  root: string,
  name: string,
  schema: z.ZodType<T>,
): Promise<T> {
  return schema.parse(
    JSON.parse(await readFile(await safeC612ArtifactPath(root, name), "utf8")),
  );
}
export async function validateC612StrictTree(root: string) {
  c612Require(
    !(await lstat(root)).isSymbolicLink(),
    "C612_SYMLINK_ARTIFACT_ROOT",
  );
  let count = 0;
  for (const relative of await treeFiles(root)) {
    if (!relative.endsWith(".json")) continue;
    const value: unknown = JSON.parse(
      await readFile(await safeC612ArtifactPath(root, relative), "utf8"),
    );
    c612Require(
      value && typeof value === "object",
      "C612_JSON_OBJECT_REQUIRED",
    );
    if (relative === "machine/machine-input-lattice-provenance.json") {
      verifyC612LatticeArray(value);
    } else if (
      "packageType" in value &&
      value.packageType === "multilingual-subtitle-package"
    )
      s.subtitlePackageSchema.parse(value);
    else {
      const type = "artifactType" in value ? value.artifactType : null,
        entry = [
          ...s.c612GeneratedSchemas,
          ...s.c611GeneratedSchemas,
          ...s.c61GeneratedSchemas,
        ].find(([n]) => n === type);
      c612Require(entry, `C612_UNREGISTERED_JSON_ARTIFACT:${relative}`);
      const parsed = entry[1].parse(value);
      c612Require(
        typeof parsed.semanticHash === "string",
        "C612_ARTIFACT_HASH_MISSING",
      );
      verifyC612SelfHash(
        parsed as {
          semanticHash: string;
        },
      );
    }
    count++;
  }
  return count;
}
/** Historical frozen lattice input is a strict array of row contracts, not an
 * artifact object. Validate each row and its self-hash without rewriting it. */
export function verifyC612LatticeArray(value: unknown) {
  const rows = z.array(s.c61TokenLatticeSchema).min(1).parse(value);
  for (const row of rows) verifyC612SelfHash(row);
  c612Require(
    new Set(rows.map((r) => r.eventId)).size === rows.length,
    "C612_DUPLICATE_LATTICE_EVENT",
  );
  return rows.length;
}
/** CTC occupancy is measured on the actual sample-rounded PCM buffer. This is
 * not an extra time tolerance and never changes any stored token/cue boundary. */
export function verifyC612CtcOccupancy(row: s.C612CtcScore) {
  if (!row.supportedTokens.length) return;
  const interval = c612Defined(row.scoredInterval),
    samples =
      Math.round(interval.end * 16000) - Math.round(interval.start * 16000),
    pcmSeconds = samples / 16000;
  c612Require(
    samples > 0 &&
      row.supportedTokens.every(
        (t) =>
          t.index < row.tokenCount &&
          t.start >= 0 &&
          t.end > t.start &&
          t.end <= pcmSeconds + 1e-9,
      ) &&
      new Set(row.supportedTokens.map((t) => t.index)).size ===
        row.supportedTokens.length,
    "C612_CTC_OCCUPANCY_RANGE",
  );
}
const C612_ACCEPTANCE_ONLY_FILES = new Set([
  "packages/video-subtitler/src/consensus/top-k/c612-artifact-validator.ts",
  "scripts/validate-c6-1-2-top-k-reranking.ts",
  "scripts/report-c6-1-2-top-k-reranking.ts",
  "tests/c6-1-2-acceptance-contracts.test.ts",
]);
/** An acceptance repair may inspect a frozen generation checkout, but cannot
 * waive changes to retrieval, evidence, thresholds, models, evaluation or data. */
export function verifyC612AcceptanceOnlySourceChanges(
  frozen: Awaited<ReturnType<typeof fileManifest>>,
  current: Awaited<ReturnType<typeof fileManifest>>,
) {
  const before = new Map(frozen.map((f) => [f.relativePath, f])),
    after = new Map(current.map((f) => [f.relativePath, f]));
  const changedPaths = [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((n) => hash(before.get(n) ?? null) !== hash(after.get(n) ?? null));
  c612Require(
    changedPaths.every((n) => C612_ACCEPTANCE_ONLY_FILES.has(n)),
    "C612_GENERATION_SOURCE_CHANGED_AFTER_FREEZE",
  );
  return {
    frozenCodeHash: hash(frozen),
    acceptanceCodeHash: hash(current),
    changedPaths,
  };
}
export function verifyC612OofIsolation(
  folds: s.C612Folds,
  models: z.infer<typeof s.c612ModelsSchema>,
  thresholds: z.infer<typeof s.c612ThresholdsSchema>,
  rankings: z.infer<typeof s.c612RankingsSchema>,
  eligibleEvents: readonly string[],
) {
  c612Require(
    folds.folds.length === 5 &&
      folds.audioLeakageCount === 0 &&
      folds.correlationLeakageCount === 0 &&
      folds.cueGroupLeakageCount === 0,
    "C612_UNSAFE_FOLD_TOPOLOGY",
  );
  c612Require(
    new Set(folds.folds.flatMap((f) => f.eventIds)).size ===
      folds.folds.flatMap((f) => f.eventIds).length &&
      new Set(folds.folds.flatMap((f) => f.groupIds)).size ===
        folds.folds.flatMap((f) => f.groupIds).length,
    "C612_DUPLICATE_FOLD_MEMBERSHIP",
  );
  for (const model of models.models) {
    const { modelHash, ...body } = model;
    sameC612(modelHash, hash(body), "C612_MODEL_SELF_HASH");
    const fold = folds.folds.find((f) => f.foldId === model.outerFoldId);
    c612Require(fold, "C612_MODEL_UNKNOWN_FOLD");
    c612Require(
      model.trainingEventIds.every((id) => !fold.eventIds.includes(id)) &&
        model.trainingGroupIds.every((id) => !fold.groupIds.includes(id)) &&
        model.trainingCandidateIds.every(
          (id) => !fold.candidateIds.includes(id),
        ),
      "C612_MODEL_TRAIN_TEST_LEAKAGE",
    );
    const threshold = thresholds.rows.find(
      (t) =>
        t.profileId === model.profileId && t.outerFoldId === model.outerFoldId,
    );
    c612Require(threshold, "C612_MODEL_THRESHOLD_MISSING");
    sameC612(
      threshold.trainingFoldIds.toSorted(),
      folds.folds
        .filter((f) => f.foldId !== model.outerFoldId)
        .map((f) => f.foldId)
        .sort(),
      "C612_THRESHOLD_OUTER_TEST_LEAKAGE",
    );
    for (const t of threshold.candidateThresholds)
      sameC612(
        [t.precision, t.harm],
        [
          ratio(t.improved, t.improved + t.regressed),
          ratio(t.regressed, t.improved + t.regressed + t.neutral),
        ],
        "C612_INNER_THRESHOLD_DENOMINATOR_MISMATCH",
      );
  }
  for (const profile of [
    ...s.C612_PROFILES,
    ...[
      "A0_H2_BASELINE",
      "A1_TOP_K_TEXT_STRUCTURAL_ONLY",
      "A2_TOP_K_PLUS_CORRELATION",
      "A3_TOP_K_PLUS_ACOUSTIC_COMPLETENESS",
      "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
      "A5_WITHOUT_PROVIDER_IDENTITY",
      "A6_WITHOUT_CTC",
      "A7_WITHOUT_CONTRACTION_GATE",
      "A8_ABSTENTION_FIRST_FULL",
    ],
  ]) {
    const rows = rankings.rows.filter((r) => r.profileId === profile);
    sameC612(
      rows.map((r) => r.eventId).sort(),
      [...eligibleEvents].sort(),
      "C612_OOF_EVENT_CONSERVATION",
    );
    for (const r of rows) {
      c612Require(
        folds.folds
          .find((f) => f.foldId === r.foldId)
          ?.eventIds.includes(r.eventId),
        "C612_PREDICTION_NOT_OUTER_TEST",
      );
      c612Require(
        models.models.find(
          (m) => m.profileId === profile && m.outerFoldId === r.foldId,
        )?.modelHash === r.modelHash,
        "C612_PREDICTION_MODEL_BINDING",
      );
      c612Require(
        r.ranked.some(
          (c) => c.candidateId === r.currentCandidateId && c.current,
        ),
        "C612_CURRENT_NOT_IN_RANKING",
      );
    }
  }
}
export function verifyC612MetricArithmetic(cv: z.infer<typeof s.c612CvSchema>) {
  for (const m of [...cv.profiles, ...cv.folds]) {
    const groups = cv.groupResults.filter(
        (g) =>
          g.profileId === m.profileId &&
          (m.foldId === null || g.foldId === m.foldId),
      ),
      changed = groups.filter((g) => g.changed),
      known = changed.filter((g) => g.evaluated),
      improved = known.filter((g) => c612Defined(g.normalizedGain) > 0).length,
      regressed = known.filter((g) => c612Defined(g.normalizedGain) < 0).length;
    c612Require(
      new Set(groups.map((g) => g.groupId)).size === groups.length,
      "C612_GROUP_COUNTED_TWICE",
    );
    sameC612(
      [
        m.selectedGroups,
        m.evaluatedChangedGroups,
        m.improved,
        m.regressed,
        m.neutral,
        m.unknown,
      ],
      [
        changed.length,
        known.length,
        improved,
        regressed,
        known.length - improved - regressed,
        changed.length - known.length,
      ],
      "C612_GROUP_METRIC_COUNT_MISMATCH",
    );
    sameC612(
      [m.precision, m.harm, m.coverage],
      [
        ratio(improved, improved + regressed),
        ratio(regressed, known.length),
        ratio(known.length, m.eligibleGroupCount),
      ],
      "C612_GROUP_METRIC_DENOMINATOR_MISMATCH",
    );
    sameC612(
      m.normalizedJointGain,
      !changed.length
        ? 0
        : known.length
          ? known.reduce((n, g) => n + c612Defined(g.normalizedGain), 0)
          : null,
      "C612_JOINT_GAIN_NOT_UNIQUE_GROUP_SUM",
    );
    c612Require(
      groups.every(
        (g) =>
          g.evaluated ||
          (g.normalizedGain === null &&
            g.exactGain === null &&
            g.materialDelta === null),
      ),
      "C612_UNKNOWN_IMPUTED_AS_ZERO_GAIN",
    );
  }
}
/** Drops only documented per-process barrier identities; never quality values. */
export function c612SemanticComparison(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(c612SemanticComparison);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([k]) =>
          ![
            "semanticHash",
            "machineFreezeHash",
            "goldFirstReadAt",
            "frozenAt",
          ].includes(k),
      )
      .map(([k, v]) => [k, c612SemanticComparison(v)]),
  );
}
export function auditC612ShareableValue(value: unknown) {
  const serialized = JSON.stringify(value),
    absolutePathLeakCount = (
      serialized.match(/(?:\/Users\/|\/home\/|\/private\/|[A-Z]:\\\\)/gu) ?? []
    ).length,
    secretCount = (
      serialized.match(
        /(?:hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/gu,
      ) ?? []
    ).length;
  let rawTextFieldCount = 0;
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    for (const [key, child] of Object.entries(v)) {
      if (
        /^(?:text|candidateText|goldText|rawText|sourcePath|audioPath|absolutePath|transcript)$/iu.test(
          key,
        )
      )
        rawTextFieldCount++;
      visit(child);
    }
  };
  visit(value);
  return {
    absolutePathLeakCount,
    secretCount,
    rawTextFieldCount,
    brokenRelativeReferenceCount: 0,
    passed: absolutePathLeakCount + secretCount + rawTextFieldCount === 0,
  };
}
export async function validateC612Artifacts(input: {
  a: string;
  b: string;
  repository: string;
  qa: string;
  source: string;
  productionDirectory: string;
  freshRuntime: string;
  frozenRepository?: string;
  generationQa?: string;
  progress?: (message: string) => void;
}) {
  const checks: {
    name: string;
    passed: boolean;
    observed: string;
    expected: string;
  }[] = [];
  async function check(
    name: string,
    action: () => Promise<string> | string,
    expected = "verified",
  ) {
    try {
      const observed = await action();
      checks.push({ name, passed: true, observed, expected });
      input.progress?.(`PASS ${name}: ${observed}`);
    } catch (e) {
      checks.push({ name, passed: false, observed: String(e), expected });
      input.progress?.(`FAIL ${name}: ${String(e)}`);
    }
  }
  const generationRepository = input.frozenRepository ?? input.repository;
  const a = await readC612FrozenInputs(input.a, generationRepository),
    b = await readC612FrozenInputs(input.b, generationRepository);
  const qa = s.c612RegressionSchema.parse(
    JSON.parse(await readFile(input.qa, "utf8")),
  );
  verifyC612SelfHash(qa);
  const currentCodeFiles = await fileManifest(
    input.repository,
    await c612RequiredSourceFiles(input.repository),
  );
  const generationQa = s.c612RegressionSchema.parse(
    JSON.parse(await readFile(input.generationQa ?? input.qa, "utf8")),
  );
  verifyC612SelfHash(generationQa);
  const fresh = s.c612RuntimeSchema.parse(
    JSON.parse(await readFile(input.freshRuntime, "utf8")),
  );
  verifyC612SelfHash(fresh);
  let validatedArtifactCount = 0;
  await check("frozen-generation-vs-acceptance-only-source", () => {
    const proof = verifyC612AcceptanceOnlySourceChanges(
      a.freeze.codeFiles,
      currentCodeFiles,
    );
    c612Require(
      proof.frozenCodeHash === a.freeze.codeAggregateHash &&
        proof.acceptanceCodeHash === qa.sourceCodeAggregateHash,
      "C612_ACCEPTANCE_SOURCE_QA_BINDING",
    );
    return JSON.stringify(proof);
  });
  await check("generation-QA-before-acceptance-repair", async () => {
    c612Require(
      generationQa.sourceCodeAggregateHash === a.freeze.codeAggregateHash,
      "C612_GENERATION_QA_NOT_FROZEN_SOURCE",
    );
    sameC612(
      generationQa.checks.map((c) => c.stage).sort(),
      [...s.C612_QA_STAGES].sort(),
      "C612_GENERATION_QA_STAGE_MISSING",
    );
    for (const stage of generationQa.checks) {
      c612Require(
        stage.exitCode === 0 && (!stage.tests || stage.tests.failed === 0),
        "C612_GENERATION_QA_FAILED",
      );
      c612Require(
        (await fileHash(
          await safeC612ArtifactPath(
            path.dirname(input.generationQa ?? input.qa),
            stage.logRelativePath,
          ),
        )) === stage.logSha256,
        "C612_GENERATION_QA_LOG_CHANGED",
      );
    }
    return `14 generation QA stages passed; ${generationQa.semanticHash}`;
  });
  await check("strict-artifact-schemas-A-B", async () => {
    validatedArtifactCount =
      (await validateC612StrictTree(input.a)) +
      (await validateC612StrictTree(input.b));
    return String(validatedArtifactCount);
  });
  await check("machine-freeze-A-B", () => {
    sameC612(a.freeze.codeFiles, b.freeze.codeFiles, "C612_CODE_A_B");
    sameC612(
      a.freeze.files.filter(
        (f) => !f.relativePath.endsWith("acoustic-completeness-runtime.json"),
      ),
      b.freeze.files.filter(
        (f) => !f.relativePath.endsWith("acoustic-completeness-runtime.json"),
      ),
      "C612_MACHINE_A_B",
    );
    c612Require(
      a.freeze.inputOrderParity && b.freeze.inputOrderParity,
      "C612_MACHINE_ORDER_PARITY",
    );
    return "source/files/policy/order hashes equal; only verifier mode differs";
  });
  await check("baseline-replay", () => {
    c612Require(
      a.baseline.passed &&
        b.baseline.passed &&
        a.baseline.checks.every((c) => c.passed) &&
        b.baseline.checks.every((c) => c.passed),
      "C612_BASELINE_FAILED",
    );
    c612Require(
      a.legacyProposals.semanticHash === a.baseline.proposalHash,
      "C612_LEGACY_PROPOSAL_BASELINE",
    );
    return `${a.baseline.cueCount} cues; ${a.baseline.eventCount} events; ${a.baseline.eligibleEventCount} eligible`;
  });
  await check("full-rank-recomputation", () => {
    sameC612(
      fullCandidateRankAudit(a.universe, a.legacyProposals, a.legacyRisks),
      a.ranks,
      "C612_FULL_RANK_REPLAY",
    );
    return String(a.ranks.rows.length);
  });
  await check("top-k-conservation-recomputation", async () => {
    const top = buildTopK(a.ranks, a.universe, a.fullIdentities.rows);
    sameC612(top.topK, a.topK, "C612_TOPK_REPLAY");
    const conservation = await c612Json(
      input.a,
      "machine/machine-c6-1-2-top-k-conservation-ledger.json",
      s.c612ConservationSchema,
    );
    sameC612(top.conservation, conservation, "C612_CONSERVATION_REPLAY");
    c612Require(
      conservation.passed && conservation.silentDropCount === 0,
      "C612_SILENT_DROP",
    );
    return `${conservation.accountedCount}/${conservation.expectedCount}`;
  });
  await check("correlation-recomputation-no-double-votes", async () => {
    const r = reconcileIdentities(
      a.fullIdentities.rows,
      a.topK.uniqueCandidateIds,
    );
    sameC612(r.identity, a.identities, "C612_IDENTITY_REPLAY");
    sameC612(r.audit, a.correlation, "C612_CORRELATION_REPLAY");
    sameC612(
      r.reconciliation,
      await c612Json(
        input.a,
        "machine/machine-c6-1-2-same-audio-reconciliation.json",
        s.c612ReconciliationSchema,
      ),
      "C612_RECONCILIATION_REPLAY",
    );
    // The strict literal schema checks the reconstructed duplicate-vote count.
    s.c612ReconciliationSchema.parse(r.reconciliation);
    return `prevented ${r.reconciliation.duplicateVotesPrevented}; double count 0`;
  });
  await check("mapping-and-fold-recomputation", () => {
    const mapped = buildFixedMappingV2(a.universe, a.production);
    sameC612(mapped.mapping, a.mapping, "C612_MAPPING_REPLAY");
    sameC612(
      buildC612Folds(a.mapping, a.fullIdentities.rows, a.universe),
      a.folds,
      "C612_FOLD_REPLAY",
    );
    return `${a.mapping.groups.length} machine groups; 5 time-blocked folds`;
  });
  await check("feature-and-contraction-recomputation", () => {
    sameC612(
      buildTopKFeatures({
        universe: a.universe,
        identities: a.identities.rows,
        ranks: a.ranks.rows,
        completeness: a.completeness.rows,
        groups: a.mapping.groups,
        scores: a.scores.rows,
      }),
      a.features,
      "C612_FEATURE_REPLAY",
    );
    sameC612(
      buildContractionAudit(
        a.universe,
        a.completeness.rows,
        a.contraction.rows
          .filter((r) => r.priorStrongContraction)
          .map((r) => r.candidateId),
      ),
      a.contraction,
      "C612_CONTRACTION_REPLAY",
    );
    c612Require(
      a.features.rawTextFeatureCount +
        a.features.goldFeatureCount +
        a.features.datasetSpecificFeatureCount ===
        0,
      "C612_FEATURE_LEAKAGE",
    );
    return `${a.features.featureNames.length} numeric fields plus missing flags`;
  });
  await check("candidate-provenance-and-CTC-scope", () => {
    sameC612(
      a.topK.uniqueCandidateIds.toSorted(),
      a.scores.rows.map((r) => r.candidateId).sort(),
      "C612_CTC_SCOPE",
    );
    for (const row of a.scores.rows) {
      const candidate = a.universe.candidates.find(
          (c) => c.candidateId === row.candidateId,
        ),
        identity = a.identities.rows.find(
          (i) => i.candidateId === row.candidateId,
        );
      c612Require(
        candidate &&
          identity &&
          candidate.inclusionStatus === "INCLUDED" &&
          candidate.provenanceHash &&
          row.eventId === candidate.eventId,
        "C612_CTC_CANDIDATE_PROVENANCE",
      );
      verifyC612CtcOccupancy(row);
      c612Require(
        row.modelSnapshotHash === fresh.modelSnapshotHash &&
          row.runtimeIdentityHash === fresh.runtimeIdentityHash,
        "C612_RUNTIME_SNAPSHOT_IDENTITY",
      );
    }
    return `${a.scores.rows.length} existing targets; no transcript generation`;
  });
  await check("verifier-accounting", async () => {
    const ar = await c612Json(
        input.a,
        "machine/machine-c6-1-2-acoustic-completeness-runtime.json",
        s.c612RuntimeSchema,
      ),
      br = await c612Json(
        input.b,
        "machine/machine-c6-1-2-acoustic-completeness-runtime.json",
        s.c612RuntimeSchema,
      );
    c612Require(
      ar.freshVerifierInference === 0 &&
        ar.verifierModelLoads === 0 &&
        br.freshVerifierInference === 0 &&
        br.verifierModelLoads === 0 &&
        br.mode === "CACHE_REPLAY" &&
        ar.verifierCacheHits === ar.plannedRequests &&
        br.verifierCacheHits === br.plannedRequests &&
        fresh.freshVerifierInference <= fresh.requestBudget &&
        fresh.freshVerifierInference ===
          fresh.actualRequests - fresh.verifierCacheHits,
      "C612_UNDECLARED_VERIFIER_EXECUTION",
    );
    sameC612(
      [ar.modelSnapshotHash, ar.runtimeIdentityHash, ar.candidateScores],
      [br.modelSnapshotHash, br.runtimeIdentityHash, br.candidateScores],
      "C612_RUNTIME_CACHE_PARITY",
    );
    return `fresh ${fresh.freshVerifierInference}; A/B cache ${ar.verifierCacheHits}/${br.verifierCacheHits}; ASR 0`;
  });
  await check("verifier-runtime-manifest", async () => {
    const identity = await c612Json(
      input.a,
      "machine/machine-c6-1-2-verifier-runtime-identity.json",
      s.c612VerifierIdentitySchema,
    );
    const files = new Map(identity.modelFiles.map((f) => [f.name, f.sha256]));
    sameC612(
      identity.modelFiles.map((f) => f.name).sort(),
      [
        "config.json",
        "preprocessor_config.json",
        "vocab.json",
        "pytorch_model.bin",
        "special_tokens_map.json",
      ].sort(),
      "C612_MODEL_MANIFEST_FILE_SET",
    );
    sameC612(
      hash({
        revision: identity.modelRevision,
        configSha256: files.get("config.json"),
        preprocessorSha256: files.get("preprocessor_config.json"),
        vocabularySha256: files.get("vocab.json"),
        modelWeightSha256: files.get("pytorch_model.bin"),
        specialTokensSha256: files.get("special_tokens_map.json"),
      }),
      identity.modelSnapshotHash,
      "C612_MODEL_MANIFEST_SNAPSHOT",
    );
    sameC612(
      hash({
        runtime: identity.runtime,
        workerHash: identity.workerHash,
        importedWorkerHash: identity.importedWorkerHash,
        modelSnapshotHash: identity.modelSnapshotHash,
      }),
      identity.runtimeIdentityHash,
      "C612_RUNTIME_MANIFEST_IDENTITY",
    );
    sameC612(
      [identity.modelSnapshotHash, identity.runtimeIdentityHash],
      [fresh.modelSnapshotHash, fresh.runtimeIdentityHash],
      "C612_FRESH_MANIFEST_IDENTITY",
    );
    sameC612(
      [identity.workerHash, identity.importedWorkerHash],
      await Promise.all(
        [
          "c612_candidate_ctc_worker.py",
          "independent_ctc_discriminator_worker.py",
        ].map((n) =>
          fileHash(path.join(input.repository, "scripts/runtime", n)),
        ),
      ),
      "C612_RUNTIME_WORKER_SOURCE_BINDING",
    );
    return JSON.stringify(identity.runtime);
  });
  const evaluated: {
    root: string;
    frozen: Awaited<ReturnType<typeof readC612FrozenInputs>>;
    labels: z.infer<typeof s.c612CandidateLabelsSchema>;
    groups: z.infer<typeof s.c612GroupLabelsSchema>;
    models: z.infer<typeof s.c612ModelsSchema>;
    thresholds: z.infer<typeof s.c612ThresholdsSchema>;
    rankings: z.infer<typeof s.c612RankingsSchema>;
    configurations: z.infer<typeof s.c612ConfigurationsSchema>;
    decisions: z.infer<typeof s.c612GroupDecisionsSchema>;
    shadows: z.infer<typeof s.c612ShadowSchema>;
    cv: z.infer<typeof s.c612CvSchema>;
    retrieval: z.infer<typeof s.c612RetrievalMetricsSchema>;
    material: z.infer<typeof s.c612LegacyMaterialSchema>;
    proof: z.infer<typeof s.c612ReadOnlySchema>;
  }[] = [];
  for (const [name, root, f] of [
    ["A", input.a, a],
    ["B", input.b, b],
  ] as const) {
    const labels = await c612Json(
        root,
        "evaluation/gold-c6-1-2-top-k-candidate-labels.json",
        s.c612CandidateLabelsSchema,
      ),
      groups = await c612Json(
        root,
        "evaluation/gold-c6-1-2-fixed-group-labels.json",
        s.c612GroupLabelsSchema,
      ),
      models = await c612Json(
        root,
        "reranking/machine-c6-1-2-reranker-models.json",
        s.c612ModelsSchema,
      ),
      thresholds = await c612Json(
        root,
        "reranking/machine-c6-1-2-thresholds.json",
        s.c612ThresholdsSchema,
      ),
      rankings = await c612Json(
        root,
        "reranking/c6-1-2-oof-candidate-rankings.json",
        s.c612RankingsSchema,
      ),
      configurations = await c612Json(
        root,
        "reranking/machine-c6-1-2-group-shadow-configurations.json",
        s.c612ConfigurationsSchema,
      ),
      decisions = await c612Json(
        root,
        "reranking/c6-1-2-oof-group-decisions.json",
        s.c612GroupDecisionsSchema,
      ),
      shadows = await c612Json(
        root,
        "reranking/machine-c6-1-2-shadow-output.json",
        s.c612ShadowSchema,
      ),
      cv = await c612Json(
        root,
        "evaluation/c6-1-2-cv-results.json",
        s.c612CvSchema,
      ),
      retrieval = await c612Json(
        root,
        "evaluation/c6-1-2-retrieval-evaluation.json",
        s.c612RetrievalMetricsSchema,
      ),
      material = await c612Json(
        root,
        "evaluation/c6-1-2-fixed-legacy-material-evaluation.json",
        s.c612LegacyMaterialSchema,
      ),
      proof = await c612Json(
        root,
        "evaluation/c6-1-2-read-only-proof.json",
        s.c612ReadOnlySchema,
      );
    evaluated.push({
      root,
      frozen: f,
      labels,
      groups,
      models,
      thresholds,
      rankings,
      configurations,
      decisions,
      shadows,
      cv,
      retrieval,
      material,
      proof,
    });
    await check(`barrier-and-chronology-${name}`, async () => {
      const freeze = await verifyRerankingFreeze(root);
      c612Require(
        labels.machineFreezeHash === f.freeze.semanticHash &&
          groups.machineFreezeHash === f.freeze.semanticHash &&
          groups.goldFirstReadAt >= f.freeze.frozenAt &&
          freeze.frozenAt >= groups.goldFirstReadAt &&
          freeze.machineFreezeHash === f.freeze.semanticHash &&
          hash(groups.rows) === groups.goldBindingHash &&
          labels.goldBindingHash === groups.goldBindingHash &&
          labels.goldIdentityHash === groups.goldIdentityHash,
        "C612_GOLD_BARRIER_BINDING",
      );
      return "machine/profile freeze < evaluator numeric labels < OOF shadow freeze";
    });
    await check(`oof-isolation-${name}`, () => {
      verifyC612OofIsolation(
        f.folds,
        models,
        thresholds,
        rankings,
        f.ranks.eligibleEventIds,
      );
      return `${models.models.length} models; ${rankings.rows.length} OOF predictions`;
    });
    await check(`linear-training-threshold-replay-${name}`, () => {
      const replay = runC612Oof({
        features: f.features.rows,
        sets: f.topK.sets,
        completeness: f.completeness.rows,
        contractions: f.contraction.rows,
        labels: labels.labels,
        folds: f.folds,
        featureHash: f.features.semanticHash,
      });
      sameC612(replay.models, models, "C612_MODEL_REPLAY");
      sameC612(replay.thresholds, thresholds, "C612_THRESHOLD_REPLAY");
      sameC612(replay.rankings, rankings, "C612_OOF_REPLAY");
      return "numeric-label-only replay; zero raw Gold reads";
    });
    await check(`bounded-joint-configuration-replay-${name}`, () => {
      const group = buildGroupConfigurations({
        rankings: rankings.rows,
        rankingHash: rankings.semanticHash,
        groups: f.mapping.groups,
        mappingHash: f.mapping.semanticHash,
        production: f.production,
        universe: f.universe,
      });
      sameC612(group.configurations, configurations, "C612_CONFIG_REPLAY");
      sameC612(group.groupDecisions, decisions, "C612_GROUP_DECISION_REPLAY");
      return "CURRENT retained; max16 configurations/max2 changed events";
    });
    await check(`shadow-byte-replay-and-relative-files-${name}`, async () => {
      for (const p of shadows.profiles) {
        const shadow = renderC612Shadow(
          f.production,
          f.universe,
          decisions.rows
            .filter((d) => d.profileId === p.profileId)
            .flatMap((d) => d.selections),
          p.profileId,
        );
        const pkg = await c612Json(
          root,
          p.subtitlePackagePath,
          s.subtitlePackageSchema,
        );
        sameC612(pkg, shadow.subtitlePackage, "C612_SHADOW_PACKAGE_REPLAY");
        for (const [relative, content] of [
          [p.assPath, shadow.ass],
          [p.srtPath, shadow.srt],
          [p.vttPath, shadow.vtt],
        ] as const)
          c612Require(
            (await readFile(
              await safeC612ArtifactPath(root, relative),
              "utf8",
            )) === content,
            "C612_SHADOW_BYTES_REPLAY",
          );
        for (const file of Object.values(pkg.subtitleFiles))
          if (file)
            await safeC612ArtifactPath(
              root,
              path.join(path.dirname(p.subtitlePackagePath), file),
            );
        c612Require(
          c601CanonicalTimingHash(shadow.cues) ===
            f.baseline.canonicalTimingHash &&
            shadow.cues.length === f.production.cues.length,
          "C612_SHADOW_TIMING_COUNT_MUTATION",
        );
      }
      return `${shadows.profiles.length} ASS/SRT/VTT/package replays`;
    });
    await check(`metric-arithmetic-and-retrieval-${name}`, () => {
      verifyC612MetricArithmetic(cv);
      sameC612(
        evaluateRetrieval({
          labels: labels.labels,
          ranks: f.ranks.rows,
          sets: f.topK.sets,
          freezeHash: f.freeze.semanticHash,
        }),
        retrieval,
        "C612_RETRIEVAL_REPLAY",
      );
      c612Require(
        material.baselineExpectedParity &&
          material.baselineMaterialErrors === 77,
        "C612_MATERIAL_BASELINE",
      );
      return "unique fixed-group joint gain; precision excludes neutral; unknown stays null";
    });
    await check(`read-only-proof-${name}`, () => {
      c612Require(
        proof.sourceMediaHashBefore === proof.sourceMediaHashAfter &&
          proof.sourceMediaHashAfter === f.freeze.sourceIdentity &&
          proof.goldHashBefore === proof.goldHashAfter &&
          proof.goldHashAfter === groups.goldIdentityHash,
        "C612_READONLY_HASH_MISMATCH",
      );
      sameC612(
        proof.productionFiles,
        f.baseline.productionFiles,
        "C612_PRODUCTION_PROOF",
      );
      return "source/Gold/production before-after equal; validator did not reopen Gold";
    });
  }
  await check("reranking-shadow-and-evaluation-A-B", async () => {
    const ea = c612Defined(evaluated[0]),
      eb = c612Defined(evaluated[1]);
    for (const key of [
      "labels",
      "groups",
      "models",
      "thresholds",
      "rankings",
      "configurations",
      "decisions",
      "shadows",
      "cv",
      "retrieval",
      "material",
      "proof",
    ] as const)
      sameC612(
        c612SemanticComparison(ea[key]),
        c612SemanticComparison(eb[key]),
        `C612_AB_${key}`,
      );
    const filesA = (
        await treeFiles(path.join(input.a, "research-shadow"))
      ).sort(),
      filesB = (await treeFiles(path.join(input.b, "research-shadow"))).sort();
    sameC612(filesA, filesB, "C612_SHADOW_FILESET_A_B");
    for (const file of filesA)
      c612Require(
        (await fileHash(path.join(input.a, "research-shadow", file))) ===
          (await fileHash(path.join(input.b, "research-shadow", file))),
        "C612_SHADOW_BYTE_A_B",
      );
    return "model/threshold/OOF/joint metrics equal; every shadow file byte-identical";
  });
  await check("source-and-production-live-parity", async () => {
    c612Require(
      (await fileHash(input.source)) === a.freeze.sourceIdentity,
      "C612_SOURCE_CHANGED",
    );
    for (const file of a.baseline.productionFiles)
      c612Require(
        (await fileHash(
          await safeC612ArtifactPath(
            input.productionDirectory,
            file.relativePath,
          ),
        )) === file.sha256,
        "C612_PRODUCTION_FILE_CHANGED",
      );
    c612Require(
      c601CanonicalTextHash(a.production.cues) ===
        a.baseline.canonicalTextHash &&
        c601CanonicalTimingHash(a.production.cues) ===
          a.baseline.canonicalTimingHash,
      "C612_CANONICAL_HASH_CHANGED",
    );
    return `canonical/timing unchanged; ${a.baseline.productionFiles.length} production files byte-identical`;
  });
  await check("full-QA-evidence-and-logs", async () => {
    c612Require(
      qa.sourceCodeAggregateHash === hash(currentCodeFiles),
      "C612_QA_SOURCE_BINDING",
    );
    sameC612(
      qa.checks.map((c) => c.stage).sort(),
      [...s.C612_QA_STAGES].sort(),
      "C612_QA_STAGE_MISSING",
    );
    for (const check of qa.checks) {
      c612Require(
        check.exitCode === 0 && (!check.tests || check.tests.failed === 0),
        `C612_QA_STAGE_FAILED:${check.stage}`,
      );
      c612Require(
        (await fileHash(
          await safeC612ArtifactPath(
            path.dirname(input.qa),
            check.logRelativePath,
          ),
        )) === check.logSha256,
        "C612_QA_LOG_CHANGED",
      );
    }
    c612Require(
      (qa.checks.find((c) => c.stage === "unit")?.tests?.passed ?? 0) >= 1133 &&
        (qa.checks.find((c) => c.stage === "e2e")?.tests?.passed ?? 0) >= 49 &&
        (qa.checks.find((c) => c.stage === "historical-targeted")?.tests
          ?.passed ?? 0) >= 1008,
      "C612_TEST_COUNT_BASELINE_REGRESSION",
    );
    return `${qa.checks.length} stages passed, immutable console logs`;
  });
  await check("Skill2-Skill3-and-canonical-contracts-unchanged", async () => {
    const protectedPaths = [
      ".agents/skills/multilingual-grammar-report-generator",
      ".agents/skills/multilingual-grammar-learning-site-builder",
      "packages/grammar-report-core",
      "packages/site-builder-core",
      "apps/grammar-learning-site-template",
      "packages/shared/src/schemas.ts",
      "schemas/subtitle-package.schema.json",
    ];
    await promisify(execFile)(
      "git",
      ["diff", "--quiet", a.baseline.acceptanceCommit, "--", ...protectedPaths],
      { cwd: input.repository },
    );
    return "protected source and original SubtitleCue/SubtitlePackage unchanged";
  });
  await check("generated-JSON-schemas", async () => {
    for (const [name, schema] of s.c612GeneratedSchemas) {
      const value = z
        .object({
          additionalProperties: z.literal(false),
          required: z.array(z.string()),
        })
        .parse(
          JSON.parse(
            await readFile(
              path.join(input.repository, "schemas", name + ".schema.json"),
              "utf8",
            ),
          ),
        );
      c612Require(
        value.required.includes("semanticHash"),
        `C612_SCHEMA_NOT_STRICT:${name}`,
      );
      c612Require(
        !schema.safeParse({}).success,
        "C612_EMPTY_ARTIFACT_ACCEPTED",
      );
    }
    return String(s.c612GeneratedSchemas.length);
  });
  return {
    checks,
    a: c612Defined(evaluated[0]),
    b: c612Defined(evaluated[1]),
    qa,
    fresh,
    validatedArtifactCount,
  };
}
