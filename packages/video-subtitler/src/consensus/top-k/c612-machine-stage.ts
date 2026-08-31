import { readdir, mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  c612BaselineSchema,
  c612FeatureFreezeSchema,
  c612FreezeSchema,
  c612ProfileFreezeSchema,
  c612PolicySchema,
  c612FullIdentitySchema,
  type C612Identity,
} from "@mvl/shared";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../../blind-acceptance/gold-isolation.js";
import { buildC611MachineStage } from "../c611-machine-stage.js";
import { c611RequiredSourceFiles } from "../c611-artifact-io.js";
import { loadC61MachineArtifacts } from "../c61-artifact-adapter.js";
import { c61Json } from "../c61-artifact-io.js";
import {
  artifact,
  hash,
  C612_POLICY,
  C612_POLICY_HASH,
  c612Defined,
} from "./c612-policy.js";
import { fullCandidateRankAudit } from "./full-candidate-rank-audit.js";
import { buildTopK } from "./top-k-candidate-builder.js";
import {
  recoverIdentity,
  reconcileIdentities,
} from "./correlation-identity.js";
import {
  readAcousticInputs,
  recoverDecodeMetadata,
  recoverMappedSupport,
  readSourcePcm,
  scoreExistingCandidates,
  fileHash,
  obj,
} from "./c612-acoustic-io.js";
import { buildCompleteness } from "./candidate-acoustic-completeness.js";
import { buildContractionAudit } from "./contraction-audit.js";
import {
  buildFixedMappingV2,
  buildC612Folds,
} from "./fixed-cue-group-mapping-v2.js";
import { buildTopKFeatures } from "./top-k-feature-table.js";
import {
  C612_RERANKERS,
  C612_RERANKER_PROFILE_HASH,
} from "./linear-reranker.js";
import { safeC612ArtifactPath } from "./c612-delivery-io.js";
export interface C612MachineInput {
  task: string;
  previous: string;
  baselineRun: string;
  repository: string;
  source: string;
  asrCache: string;
  verifierCache: string;
  modelDirectory: string;
  python: string;
  allowFresh: boolean;
  replay: boolean;
  progress?: (value: string) => void;
}
export async function c612RequiredSourceFiles(repository: string) {
  return [
    ...(await c611RequiredSourceFiles(repository)),
    "scripts/runtime/c612_candidate_ctc_worker.py",
    "scripts/runtime/independent_ctc_discriminator_worker.py",
    "tests/runtime/c612_candidate_ctc_test.py",
  ].sort();
}
async function fingerprint(root: string, relativePath: string) {
  const file = path.join(root, relativePath);
  return {
    relativePath,
    sha256: await fileHash(file),
    size: (await stat(file)).size,
  };
}
export async function replayC612Baseline(
  input: C612MachineInput,
  stage: Awaited<ReturnType<typeof buildC611MachineStage>>,
  taskDirectory: string,
) {
  const files = [
    "machine/c6-1-1-policy-freeze.json",
    "machine/machine-selective-existing-candidate-proposals.json",
    "machine/machine-selective-mbr-features.json",
    "machine/c6-1-1-calibration-folds.json",
    "evaluation/c6-1-1-fixed-baseline-alignment-map.json",
    "evaluation/c6-1-1-out-of-fold-selective-decisions.json",
    "evaluation/c6-1-1-route-decision.json",
  ];
  const artifacts = await Promise.all(
    files.map(async (f) => obj(await c61Json(path.join(input.baselineRun, f)))),
  );
  const [policy, proposal, features, folds, mapping, oof, route] = artifacts;
  const checks = [
    {
      name: "policy",
      observed: stage.policy.semanticHash,
      expected: String(c612Defined(policy).semanticHash),
    },
    {
      name: "proposal",
      observed: stage.proposals.semanticHash,
      expected: String(c612Defined(proposal).semanticHash),
    },
    {
      name: "features",
      observed: stage.features.semanticHash,
      expected: String(c612Defined(features).semanticHash),
    },
    {
      name: "folds",
      observed: stage.folds.semanticHash,
      expected: String(c612Defined(folds).semanticHash),
    },
    {
      name: "productionText",
      observed: c601CanonicalTextHash(stage.production.cues),
      expected: stage.baseline.canonicalTextHash,
    },
    {
      name: "productionTiming",
      observed: c601CanonicalTimingHash(stage.production.cues),
      expected: stage.baseline.canonicalTimingHash,
    },
    {
      name: "candidateUniverse",
      observed: stage.universe.semanticHash,
      expected: stage.baseline.candidateUniverseHash,
    },
    {
      name: "baselineCueCount",
      observed: String(stage.production.cues.length),
      expected: "161",
    },
    {
      name: "baselineEventCount",
      observed: String(stage.universe.events.length),
      expected: "199",
    },
    {
      name: "baselineInputCandidateCount",
      observed: String(stage.universe.candidates.length),
      expected: "1496",
    },
    {
      name: "baselineRoute",
      observed: String(c612Defined(route).outcome),
      expected: "SELECTIVE_MBR_NOT_SUPPORTED",
    },
  ].map((c) => ({ ...c, passed: c.observed === c.expected }));
  for (const [index, value] of artifacts.entries()) {
    const { semanticHash, ...body } = value;
    checks.push({
      name: `frozenArtifactHash:${files[index]}`,
      observed: hash(body),
      expected: String(semanticHash),
      passed: hash(body) === semanticHash,
    });
  }
  const included = stage.universe.candidates.filter(
    (c) => c.inclusionStatus === "INCLUDED" && c.providerFamily !== "CURRENT",
  );
  const productionNames = (await readdir(taskDirectory))
    .filter((n) => /\.(ass|srt|vtt)$/.test(n))
    .sort();
  const baseline = c612BaselineSchema.parse(
    artifact("c6-1-2-baseline-replay", {
      acceptanceCommit: "c371fd86cabc64e534da39987b786da7375a49dd",
      baselineBranch: "codex/c6-1-1-fixed-alignment-selective-existing-mbr",
      checks,
      passed: checks.every((c) => c.passed),
      policyHash: c612Defined(policy).semanticHash,
      proposalHash: c612Defined(proposal).semanticHash,
      fixedMappingHash: c612Defined(mapping).mappingSemanticHash,
      featureHash: c612Defined(features).semanticHash,
      foldHash: c612Defined(folds).semanticHash,
      oofHash: c612Defined(oof).semanticHash,
      universeHash: stage.universe.semanticHash,
      canonicalTextHash: stage.baseline.canonicalTextHash,
      canonicalTimingHash: stage.baseline.canonicalTimingHash,
      productionFiles: await Promise.all(
        productionNames.map((n) => fingerprint(taskDirectory, n)),
      ),
      inputFiles: await Promise.all(
        [...files, "evaluation/evaluation-S0.local-only.json"].map((f) =>
          fingerprint(input.baselineRun, f),
        ),
      ),
      cueCount: stage.production.cues.length,
      eventCount: stage.universe.events.length,
      eligibleEventCount: stage.proposals.records.filter(
        (p) => p.eligibilityStatus === "ELIGIBLE",
      ).length,
      inputCandidateCount: stage.universe.candidates.length,
      includedAsrCount: included.length,
      whisperCount: included.filter((c) => c.providerFamily === "WHISPER")
        .length,
      reazonCount: included.filter((c) => c.providerFamily === "REAZON").length,
      strongContractionCount: stage.completeness.rows.filter((r) =>
        r.riskClasses.includes("STRONG_CONTRACTION_RISK"),
      ).length,
      runtimeGoldInputCount: 0,
      newAsrInferenceCount: 0,
      networkUsed: false,
    }),
  );
  if (!baseline.passed)
    throw new Error(
      `C612_BASELINE_REPLAY_FAILED:${JSON.stringify(checks.filter((c) => !c.passed))}`,
    );
  return baseline;
}
export async function buildC612MachineStage(input: C612MachineInput) {
  const stage = await buildC611MachineStage({
    task: input.task,
    previous: input.previous,
    baselineFile: path.join(input.baselineRun, "machine/c6-1-1-baseline.json"),
  });
  const loaded = await loadC61MachineArtifacts(input.task);
  const baseline = await replayC612Baseline(input, stage, loaded.taskDirectory);
  input.progress?.("C6.1.1 baseline replay verified; zero ASR inference");
  const evidence = await readAcousticInputs(loaded.taskDirectory);
  const sourceHash = evidence.vad.sourceIdentity;
  const metadata = await recoverDecodeMetadata(
    stage.correlationGroups.observations,
    evidence.paired,
    input.asrCache,
  );
  const pcm = await readSourcePcm(input.source, sourceHash);
  const ranks = fullCandidateRankAudit(
    stage.universe,
    stage.proposals,
    stage.riskLedger,
  );
  const allIdentities: C612Identity[] = stage.universe.candidates
    .filter((c) => c.eventId && c.inclusionStatus === "INCLUDED")
    .map((c) =>
      recoverIdentity(
        c,
        sourceHash,
        metadata.find((m) => m.candidateId === c.candidateId),
        pcm,
      ),
    )
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const top = buildTopK(ranks, stage.universe, allIdentities);
  const correlation = reconcileIdentities(
    allIdentities,
    top.topK.uniqueCandidateIds,
  );
  input.progress?.(
    `Top-K frozen candidate scope: ${correlation.identity.rows.length}; verified PCM identities: ${correlation.audit.verified}`,
  );
  const scored = await scoreExistingCandidates({
    universe: stage.universe,
    identities: correlation.identity.rows,
    pcm,
    modelDirectory: input.modelDirectory,
    python: input.python,
    repository: input.repository,
    historical: evidence.model,
    cache: input.verifierCache,
    allowFresh: input.allowFresh,
    replay: input.replay,
    ...(input.progress ? { onProgress: input.progress } : {}),
  });
  const mappedSupport = recoverMappedSupport(
    stage.universe,
    correlation.identity.rows,
    evidence.tokens,
    evidence.tokensHash,
  );
  const complete = buildCompleteness(
    correlation.identity.rows,
    scored.scores.rows,
    evidence.vad,
    mappedSupport,
  );
  const priorStrongIds = stage.completeness.rows
    .filter((r) => r.riskClasses.includes("STRONG_CONTRACTION_RISK"))
    .flatMap((r) => {
      const id = stage.proposals.records.find(
        (p) => p.proposalId === r.proposalId,
      )?.proposedCandidateId;
      return id ? [id] : [];
    });
  const contraction = buildContractionAudit(
    stage.universe,
    complete.completeness.rows,
    priorStrongIds,
  );
  const mapped = buildFixedMappingV2(stage.universe, stage.production);
  const folds = buildC612Folds(mapped.mapping, allIdentities, stage.universe);
  const features = buildTopKFeatures({
    universe: stage.universe,
    identities: correlation.identity.rows,
    ranks: ranks.rows,
    completeness: complete.completeness.rows,
    groups: mapped.mapping.groups,
    scores: scored.scores.rows,
  });
  const featureFreeze = c612FeatureFreezeSchema.parse(
    artifact("c6-1-2-feature-freeze", {
      featureHash: features.semanticHash,
      mappingHash: mapped.mapping.semanticHash,
      foldHash: folds.semanticHash,
      topKHash: top.topK.semanticHash,
      policyHash: C612_POLICY_HASH,
      goldRead: false,
    }),
  );
  const reversedTop = buildTopK(
    { ...ranks, rows: [...ranks.rows].reverse() },
    stage.universe,
    [...allIdentities].reverse(),
  );
  const reversedFeatures = buildTopKFeatures({
    universe: {
      ...stage.universe,
      candidates: [...stage.universe.candidates].reverse(),
      events: [...stage.universe.events].reverse(),
    },
    identities: [...correlation.identity.rows].reverse(),
    ranks: [...ranks.rows].reverse(),
    completeness: [...complete.completeness.rows].reverse(),
    groups: mapped.mapping.groups,
    scores: [...scored.scores.rows].reverse(),
  });
  const reversedUniverse = {
    ...stage.universe,
    candidates: [...stage.universe.candidates].reverse(),
    events: [...stage.universe.events].reverse(),
  };
  const reversedMapped = buildFixedMappingV2(
      reversedUniverse,
      stage.production,
    ),
    reversedCorrelation = reconcileIdentities(
      [...allIdentities].reverse(),
      [...top.topK.uniqueCandidateIds].reverse(),
    ),
    reversedComplete = buildCompleteness(
      [...correlation.identity.rows].reverse(),
      [...scored.scores.rows].reverse(),
      evidence.vad,
      [...mappedSupport].reverse(),
    );
  const reversedFolds = buildC612Folds(
    reversedMapped.mapping,
    [...allIdentities].reverse(),
    reversedUniverse,
  );
  const inputOrderParity =
    hash(top) === hash(reversedTop) &&
    hash(correlation) === hash(reversedCorrelation) &&
    hash(complete) === hash(reversedComplete) &&
    hash(mapped) === hash(reversedMapped) &&
    hash(folds) === hash(reversedFolds) &&
    features.semanticHash === reversedFeatures.semanticHash;
  if (!inputOrderParity) throw new Error("C612_INPUT_ORDER_PARITY_FAILED");
  return {
    baseline,
    legacy: stage,
    taskDirectory: loaded.taskDirectory,
    sourceHash,
    ranks,
    fullIdentity: c612FullIdentitySchema.parse(
      artifact("machine-c6-1-2-full-correlation-identity", {
        rows: allIdentities,
        universeHash: stage.universe.semanticHash,
        runtimeGoldInputCount: 0,
      }),
    ),
    ...top,
    ...correlation,
    ...scored,
    ...complete,
    contraction,
    ...mapped,
    correlationAudit: correlation.audit,
    mappingAudit: mapped.audit,
    folds,
    features,
    featureFreeze,
    inputOrderParity,
  };
}
export async function writeC612MachineStage(
  output: string,
  repository: string,
  stage: Awaited<ReturnType<typeof buildC612MachineStage>>,
) {
  await mkdir(output, { recursive: false });
  const machine = path.join(output, "machine");
  await mkdir(machine);
  const artifacts = [
    stage.baseline,
    stage.ranks,
    stage.fullIdentity,
    stage.topK,
    stage.conservation,
    stage.comparison,
    stage.identity,
    stage.reconciliation,
    stage.correlationAudit,
    stage.mappingAudit,
    stage.scores,
    stage.runtime,
    stage.runtimeIdentity,
    stage.completeness,
    stage.edge,
    stage.contraction,
    stage.mapping,
    stage.folds,
    stage.features,
    stage.featureFreeze,
  ];
  // correlation audit and mapping audit use distinct properties in the object below.
  const data = new Map<string, unknown>(
    artifacts.map((a) => [a.artifactType + ".json", a]),
  );
  data.set(
    "c6-1-2-reranker-profile-freeze.json",
    c612ProfileFreezeSchema.parse(
      artifact("c6-1-2-reranker-profile-freeze", {
        profileHash: C612_RERANKER_PROFILE_HASH,
        policyHash: C612_POLICY_HASH,
        profiles: C612_RERANKERS,
        primaryProfile: "L6",
        supervisedModelsFitAfterTrainLabels: true,
      }),
    ),
  );
  data.set(
    "c6-1-2-policy.json",
    c612PolicySchema.parse(
      artifact("c6-1-2-policy", {
        policyHash: C612_POLICY_HASH,
        policy: C612_POLICY,
      }),
    ),
  );
  data.set("machine-input-hypothesis-universe.json", stage.legacy.universe);
  data.set("subtitle-package.production.json", stage.legacy.production);
  data.set("machine-input-lattice-provenance.json", stage.legacy.lattices);
  data.set("machine-input-c611-risk-ledger.json", stage.legacy.riskLedger);
  data.set("machine-input-c611-proposals.json", stage.legacy.proposals);
  for (const [name, value] of data)
    await writeFile(
      path.join(machine, name),
      JSON.stringify(value, null, 2) + "\n",
      { flag: "wx" },
    );
  const files = await Promise.all(
    [...data.keys()].sort().map((n) => fingerprint(machine, n)),
  );
  const codeFiles = await Promise.all(
    (await c612RequiredSourceFiles(repository)).map((n) =>
      fingerprint(repository, n),
    ),
  );
  const freeze = c612FreezeSchema.parse(
    artifact("c6-1-2-machine-freeze-manifest", {
      frozenAt: new Date().toISOString(),
      files,
      codeFiles,
      machineAggregateHash: hash(files),
      codeAggregateHash: hash(codeFiles),
      policyHash: C612_POLICY_HASH,
      sourceIdentity: stage.sourceHash,
      productionTextHash: stage.baseline.canonicalTextHash,
      productionTimingHash: stage.baseline.canonicalTimingHash,
      goldRead: false,
      oofShadowsFrozenBeforeGold: false,
      modelProfilesFrozenBeforeGold: true,
      inputOrderParity: stage.inputOrderParity,
    }),
  );
  await writeFile(
    path.join(machine, "c6-1-2-machine-freeze-manifest.json"),
    JSON.stringify(freeze, null, 2) + "\n",
    { flag: "wx" },
  );
  return freeze;
}
export async function verifyC612MachineFreeze(
  output: string,
  repository: string,
) {
  const machine = path.join(output, "machine"),
    freeze = c612FreezeSchema.parse(
      await c61Json(path.join(machine, "c6-1-2-machine-freeze-manifest.json")),
    );
  const { semanticHash, ...body } = freeze;
  if (hash(body) !== semanticHash || freeze.policyHash !== C612_POLICY_HASH)
    throw new Error("C612_FREEZE_HASH_INVALID");
  const requiredMachine = [
    "c6-1-2-baseline-replay",
    "c6-1-2-reranker-profile-freeze",
    "c6-1-2-policy",
    "c6-1-2-feature-freeze",
    "c6-1-2-mapping-recovery-audit",
    "machine-c6-1-2-full-candidate-rank-audit",
    "machine-c6-1-2-top-k-conservation-ledger",
    "machine-c6-1-2-top-k-profile-comparison",
    "machine-c6-1-2-full-correlation-identity",
    "machine-c6-1-2-top-k-features",
    "machine-c6-1-2-candidate-correlation-identity",
    "machine-c6-1-2-same-audio-reconciliation",
    "machine-c6-1-2-correlation-audit",
    "machine-c6-1-2-candidate-acoustic-completeness",
    "machine-c6-1-2-candidate-edge-risk",
    "machine-c6-1-2-candidate-ctc-scores",
    "machine-c6-1-2-acoustic-completeness-runtime",
    "machine-c6-1-2-verifier-runtime-identity",
    "machine-c6-1-2-contraction-audit",
    "machine-c6-1-2-top-k-candidate-set",
    "c6-1-2-folds",
    "c6-1-2-fixed-cue-group-mapping-v2",
    "subtitle-package.production",
    "machine-input-hypothesis-universe",
    "machine-input-lattice-provenance",
    "machine-input-c611-risk-ledger",
    "machine-input-c611-proposals",
  ]
    .map((n) => n + ".json")
    .sort();
  if (
    hash(freeze.files.map((f) => f.relativePath).sort()) !==
      hash(requiredMachine) ||
    hash(freeze.codeFiles.map((f) => f.relativePath)) !==
      hash(await c612RequiredSourceFiles(repository))
  )
    throw new Error("C612_FREEZE_REQUIRED_FILE_SET_MISSING");
  for (const [root, files] of [
    [machine, freeze.files],
    [repository, freeze.codeFiles],
  ] as const)
    for (const f of files) {
      await safeC612ArtifactPath(root, f.relativePath);
      if (hash(await fingerprint(root, f.relativePath)) !== hash(f))
        throw new Error(`C612_FROZEN_INPUT_CHANGED:${f.relativePath}`);
    }
  if (
    hash(freeze.files) !== freeze.machineAggregateHash ||
    hash(freeze.codeFiles) !== freeze.codeAggregateHash
  )
    throw new Error("C612_FREEZE_AGGREGATE_INVALID");
  return freeze;
}
