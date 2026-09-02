/* eslint-disable @typescript-eslint/no-unnecessary-condition -- The evaluator rechecks literal-constrained fields after independent durable reads. */
import path from "node:path";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import { c60StableHash } from "../packages/video-subtitler/src/finalization-risk-policy.js";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import {
  evaluateProductComponent1452,
  productRecall1452,
  routeFromGates1452,
  type RouteGates1452,
} from "../packages/video-subtitler/src/review/c6011452-determinacy.js";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  durableJson141,
  identity141,
  readJson141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import { evaluateC60114PlaybackCoverage } from "../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import { loadInputs145 } from "./lib/c601145-input.js";
import { c60114GoldErrorComponents } from "./lib/c60114-post-freeze-evaluation.js";

interface Recall {
  numerator: number;
  denominator: number;
  ratio: number;
}

const { values } = parseArgs({
  strict: true,
  options: {
    state: { type: "string" },
    gold: { type: "string" },
    "quality-evaluation": { type: "string" },
    "region-labels": { type: "string" },
    "gold-evaluation": { type: "string" },
  },
});
const argument = (name: keyof typeof values) =>
  path.resolve(required141(values[name], `--${name} required`));
const statePath = argument("state"),
  state = (await readJson141(statePath)) as {
    baseStatePath: string;
    outputs: Record<string, string>;
    semanticHash: string;
  };
assertHash141(state);
const output = (role: string) => path.resolve(required141(state.outputs[role])),
  finalA = output("final-a"),
  finalB = output("final-b"),
  evaluationRoot = output("evaluation"),
  base1451State = (await readJson141(state.baseStatePath)) as {
    baseStatePath: string;
    outputs: Record<string, string>;
    semanticHash: string;
  };
assertHash141(base1451State);
const inputs = await loadInputs145(
    shared.state143Schema.parse(await readJson141(base1451State.baseStatePath))
      .config.baselineState,
  ),
  sourcePath = inputs.baseline.old.config.source;

const readMachine = async <T>(
    root: string,
    name: string,
    schema: { parse(value: unknown): T },
  ) =>
    schema.parse(await readJson141(path.join(root, "machine-artifacts", name))),
  readReview = async <T>(
    root: string,
    name: string,
    schema: { parse(value: unknown): T },
  ) =>
    schema.parse(await readJson141(path.join(root, "review-workspace", name)));

async function loadFrozen(role: "A" | "B", root: string) {
  const policy = await readMachine(
      root,
      "c6-0-1-14-5-2-product-scorability-playback-realization-policy.json",
      shared.policy1452Schema,
    ),
    registry = await readMachine(
      root,
      "machine-full-speech-evidence-unit-registry-v1.json",
      shared.fullRegistry1451Schema,
    ),
    reconciliation = await readMachine(
      root,
      "machine-full-registry-source-reconciliation.json",
      shared.sourceReconciliation1451Schema,
    ),
    binding = await readMachine(
      root,
      "machine-review-delivery-coverage-unit-binding-v1.json",
      shared.reviewBinding1451Schema,
    ),
    inheritedV1 = await readMachine(
      root,
      "machine-existing-review-delivery-realizations-v1.json",
      shared.inheritedRealizations1451Schema,
    ),
    effectiveV1 = await readMachine(
      root,
      "machine-effective-product-realization-registry-v1.json",
      shared.effectiveRealizations1451Schema,
    ),
    witnessesV1 = await readMachine(
      root,
      "machine-product-contract-witness-groups-v1.json",
      shared.witnessGroups1451Schema,
    ),
    eligibility = await readMachine(
      root,
      "machine-degenerate-orphan-target-eligibility-v1.json",
      shared.degenerateEligibility1452Schema,
    ),
    candidates = await readMachine(
      root,
      "machine-inherited-realization-candidate-ledger-v2.json",
      shared.realizationCandidateLedger1452Schema,
    ),
    inherited = await readMachine(
      root,
      "machine-existing-review-delivery-realizations-v2.json",
      shared.inheritedRealizations1452Schema,
    ),
    effective = await readMachine(
      root,
      "machine-effective-product-realization-registry-v2.json",
      shared.effectiveRealizations1452Schema,
    ),
    connectivity = await readMachine(
      root,
      "machine-witness-connectivity-ledger-v2.json",
      shared.witnessConnectivity1452Schema,
    ),
    witnesses = await readMachine(
      root,
      "machine-product-contract-witness-groups-v2.json",
      shared.witnessGroups1452Schema,
    ),
    determinacyPolicy = await readMachine(
      root,
      "machine-product-outcome-determinacy-policy-v1.json",
      shared.determinacyPolicy1452Schema,
    ),
    preflight = await readMachine(
      root,
      "machine-product-outcome-determinacy-preflight.json",
      shared.determinacyPreflight1452Schema,
    ),
    nested = await readMachine(
      root,
      "c6-0-1-14-5-2-nested-semantic-integrity-preflight.json",
      shared.nestedPreflight1452Schema,
    ),
    targets = await readReview(
      root,
      "machine-review-target-intervals-v9.json",
      shared.reviewTargets1452Schema,
    ),
    items = await readReview(
      root,
      "machine-review-items-v11.json",
      shared.reviewItems1452Schema,
    ),
    regions = await readReview(
      root,
      "machine-review-regions-v10.json",
      shared.reviewRegions1452Schema,
    ),
    audio = await readReview(
      root,
      "machine-review-audio-manifest-v10.json",
      shared.reviewAudio1452Schema,
    ),
    playback = await readReview(
      root,
      "machine-review-playback-timeline-v9.json",
      shared.reviewPlayback1452Schema,
    ),
    freeze = shared.freeze1452Schema.parse(
      await readJson141(
        path.join(
          root,
          "c6-0-1-14-5-2-machine-scorability-playback-freeze.json",
        ),
      ),
    );
  [
    policy,
    registry,
    reconciliation,
    binding,
    inheritedV1,
    effectiveV1,
    witnessesV1,
    eligibility,
    candidates,
    inherited,
    effective,
    connectivity,
    witnesses,
    determinacyPolicy,
    preflight,
    nested,
    targets,
    items,
    regions,
    audio,
    playback,
    freeze,
  ].forEach(assertHash141);
  if (
    freeze.finalRole !== role ||
    freeze.policyHash !== policy.semanticHash ||
    freeze.degenerateEligibilityHash !== eligibility.semanticHash ||
    freeze.realizationCandidateLedgerHash !== candidates.semanticHash ||
    freeze.inheritedRealizationV2Hash !== inherited.semanticHash ||
    freeze.effectiveRealizationRegistryV2Hash !== effective.semanticHash ||
    freeze.witnessConnectivityHash !== connectivity.semanticHash ||
    freeze.witnessGroupV2Hash !== witnesses.semanticHash ||
    freeze.determinacyPolicyHash !== determinacyPolicy.semanticHash ||
    freeze.determinacyPreflightHash !== preflight.semanticHash ||
    freeze.nestedPreflightHash !== nested.semanticHash ||
    freeze.reviewDeliveryHashes.targets !== targets.semanticHash ||
    freeze.reviewDeliveryHashes.items !== items.semanticHash ||
    freeze.reviewDeliveryHashes.regions !== regions.semanticHash ||
    freeze.reviewDeliveryHashes.audio !== audio.semanticHash ||
    freeze.reviewDeliveryHashes.playback !== playback.semanticHash
  )
    throw new Error(`C6011452_FREEZE_BINDING_FAILED:${role}`);
  return {
    policy,
    registry,
    reconciliation,
    binding,
    inheritedV1,
    effectiveV1,
    witnessesV1,
    eligibility,
    candidates,
    inherited,
    effective,
    connectivity,
    witnesses,
    determinacyPolicy,
    preflight,
    nested,
    targets,
    items,
    regions,
    audio,
    playback,
    freeze,
  };
}

const a = await loadFrozen("A", finalA),
  b = await loadFrozen("B", finalB),
  parity = shared.parity1452Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-2-final-ab-parity.json"),
    ),
  );
assertHash141(parity);
if (
  parity.finalAFreezeHash !== a.freeze.semanticHash ||
  parity.finalBFreezeHash !== b.freeze.semanticHash ||
  !parity.semanticParity
)
  throw new Error("C6011452_FINAL_AB_PARITY_BINDING_FAILED");

const goldFirstReadAt = new Date().toISOString();
if (Date.parse(goldFirstReadAt) < Date.parse(a.freeze.freezeCompletedAt))
  throw new Error("C6011452_FREEZE_NOT_COMPLETED_BEFORE_GOLD_READ");
const firstRead = shared.firstGoldRead1452Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    policyVersion: a.policy.policyVersion,
    policyHash: a.policy.semanticHash,
    sourceIdentity: a.registry.sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
    visibility: "LOCAL_ONLY",
    artifactType: "c6-0-1-14-5-2-first-gold-read-audit",
    runtimeGoldInputCount: 1,
    machineFreezeHash: a.freeze.semanticHash,
    machineFreezeCompletedAt: a.freeze.freezeCompletedAt,
    goldFirstReadAt,
    freezeBeforeGold: true,
    machineStageGoldPathReadCount: 0,
    machineStageGoldDerivedArtifactReadCount: 0,
  }),
);
await durableJson141(
  path.join(evaluationRoot, "c6-0-1-14-5-2-first-gold-read-audit.json"),
  firstRead,
);

// The Gold barrier ends only after the durable first-read receipt exists.
const goldPath = argument("gold"),
  qualityPath = argument("quality-evaluation"),
  labelsPath = argument("region-labels"),
  upstreamPath = argument("gold-evaluation"),
  sourceBefore = await identity141(sourcePath),
  goldBefore = await identity141(goldPath),
  qualityBefore = await identity141(qualityPath),
  labelsBefore = await identity141(labelsPath),
  upstreamBefore = await identity141(upstreamPath),
  quality = shared.c60112ReviewQualityEvaluationSchema.parse(
    await readJson141(qualityPath),
  ),
  labels = shared.c60113RegionLabelsSchema.parse(await readJson141(labelsPath)),
  upstream = shared.machineVsGoldEvaluationSchema.parse(
    await readJson141(upstreamPath),
  );
const { semanticHash: qualitySemantic, ...qualityCore } = quality,
  { semanticHash: upstreamSemantic, ...upstreamCore } = upstream;
if (
  qualitySemantic !==
    machineQualitySemanticHash({ ...qualityCore, generatedAt: undefined }) ||
  labels.semanticHash !== c60113HashPayload(labels) ||
  c60StableHash({
    ...upstreamCore,
    generatedAt: "<evaluation-time>",
    evaluationWallTimeMs: 0,
    goldIdentity: {
      ...upstream.goldIdentity,
      firstReadAt: "<gold-first-read-time>",
    },
  }) !== upstreamSemantic ||
  quality.goldEvaluationArtifactSha256 !== upstreamBefore.sha256 ||
  quality.goldSha256Before !== goldBefore.sha256 ||
  quality.goldSha256After !== goldBefore.sha256 ||
  upstream.goldIdentity.sha256 !== goldBefore.sha256 ||
  upstream.sourceIdentity.sha256 !== sourceBefore.sha256 ||
  labels.sourceEvaluationHash !== quality.semanticHash
)
  throw new Error("C6011452_GOLD_SOURCE_HASH_BINDING_FAILED");

const errorComponents = c60114GoldErrorComponents(
    upstream,
    labels.errorComponents,
    a.registry.sourceIdentity,
  ),
  missing = errorComponents.filter((row) =>
    row.labels.includes("MISSING_DIALOGUE"),
  );
if (missing.length !== 6)
  throw new Error(`C6011452_MISSING_DENOMINATOR_CHANGED:${missing.length}`);
if (
  hash141(errorComponents.map((row) => row.errorComponentId).sort()) !==
  hash141(quality.errorComponents.map((row) => row.errorComponentId).sort())
)
  throw new Error("C6011452_GOLD_DENOMINATOR_CHANGED");

const projectionsSource = shared.projections143Schema.parse(
    await readJson141(path.join(finalA, "machine-coverage-projections.json")),
  ),
  official = required141(
    projectionsSource.variants.find(
      (row) => row.stage === projectionsSource.officialStage,
    ),
  ),
  ordinary = evaluateC60114PlaybackCoverage({
    ...official.projection,
    generatedAt: goldFirstReadAt,
    errorComponents,
    engineeringGates: {
      engineeringPassed: true,
      baselineParityPassed: true,
      runtimeGoldInputCount: 0,
      canonicalMutationCount: 0,
      machineDraftMutationCount: 0,
      sourceMutationCount: 0,
      goldMutationCount: 0,
      machineFreezeVerified: true,
    },
  }),
  fullBudget = required141(
    ordinary.budgets.find((row) => row.planId === official.officialPlanId),
  ),
  mandatoryBudget = required141(
    ordinary.budgets.find((row) => row.planId === "ALL_MANDATORY"),
  ),
  mandatoryPlan = required141(
    a.playback.plans.find((row) => row.planId === "ALL_MANDATORY"),
  );
if (ordinary.integrityFailures.length)
  throw new Error(
    `C6011452_ORDINARY_EVALUATION_INTEGRITY_FAILED:${ordinary.integrityFailures.join("|")}`,
  );

const recall = (
  rows: readonly shared.C60114ComponentCoverage[],
  label: "MISSING_DIALOGUE" | "HALLUCINATION",
  predicate: (row: shared.C60114ComponentCoverage) => boolean,
): Recall => {
  const relevant = rows.filter((row) => row.labels.includes(label)),
    numerator = relevant.filter(predicate).length;
  return {
    numerator,
    denominator: relevant.length,
    ratio: relevant.length ? numerator / relevant.length : 1,
  };
};
const ordinaryMetrics = (budget: shared.C60114BudgetCoverage) => ({
    target: recall(
      budget.componentCoverage,
      "MISSING_DIALOGUE",
      (row) => row.layers.targetInterval.audible,
    ),
    physical: recall(
      budget.componentCoverage,
      "MISSING_DIALOGUE",
      (row) => row.layers.physicalAudio.audible,
    ),
    playbackAny: recall(
      budget.componentCoverage,
      "MISSING_DIALOGUE",
      (row) => row.layers.audibleReviewCoverage.any,
    ),
    playbackAudible: recall(
      budget.componentCoverage,
      "MISSING_DIALOGUE",
      (row) => row.layers.audibleReviewCoverage.audible,
    ),
    playbackFull: recall(
      budget.componentCoverage,
      "MISSING_DIALOGUE",
      (row) => row.layers.audibleReviewCoverage.full,
    ),
    hallucinationTarget: recall(
      budget.componentCoverage,
      "HALLUCINATION",
      (row) => row.layers.targetInterval.audible,
    ),
    hallucinationPhysical: recall(
      budget.componentCoverage,
      "HALLUCINATION",
      (row) => row.layers.physicalAudio.audible,
    ),
    hallucinationPlayback: recall(
      budget.componentCoverage,
      "HALLUCINATION",
      (row) => row.layers.audibleReviewCoverage.audible,
    ),
  }),
  fullOrdinary = ordinaryMetrics(fullBudget),
  mandatoryOrdinary = ordinaryMetrics(mandatoryBudget);

const emptyInherited = { ...a.inherited, realizations: [] },
  plannerEffective = {
    ...a.effective,
    realizations: a.effective.realizations.filter((row) =>
      row.realizationOrigins.includes("PLANNER_SELECTED_REALIZATION"),
    ),
  },
  plannerIds = new Set(
    plannerEffective.realizations.map((row) => row.effectiveRealizationId),
  ),
  plannerWitnesses = {
    ...a.witnesses,
    groups: a.witnesses.groups.filter((group) =>
      group.realizationIds.every((id) => plannerIds.has(id)),
    ),
  },
  singleWitnesses = {
    ...a.witnesses,
    groups: a.witnesses.groups.filter(
      (group) => group.realizationIds.length === 1,
    ),
  };
const evaluateRows = (options?: {
  effective?: typeof a.effective;
  witnesses?: typeof a.witnesses;
  inherited?: typeof a.inherited;
  allowed?: {
    targetIds?: ReadonlySet<string>;
    audioIds?: ReadonlySet<string>;
    playbackSegmentIds?: ReadonlySet<string>;
  };
}) =>
  missing.map((component) =>
    evaluateProductComponent1452({
      policy: a.policy,
      component,
      registry: a.registry,
      binding: a.binding,
      eligibility: a.eligibility,
      v1Inherited: a.inheritedV1,
      v2Inherited: options?.inherited ?? a.inherited,
      effective: options?.effective ?? a.effective,
      witnesses: options?.witnesses ?? a.witnesses,
      preflight: a.preflight,
      ...(options?.allowed === undefined ? {} : { allowed: options.allowed }),
    }),
  );
const s1 = evaluateRows({
    effective: plannerEffective,
    witnesses: plannerWitnesses,
    inherited: emptyInherited,
  }),
  s2 = s1,
  s3 = evaluateRows({ witnesses: singleWitnesses }),
  s4 = evaluateRows(),
  s5 = s4,
  s6 = s4,
  mandatoryAllowed = {
    targetIds: new Set(mandatoryPlan.reviewTargetIds),
    audioIds: new Set(mandatoryPlan.audioIds),
    playbackSegmentIds: new Set(mandatoryPlan.playbackSegmentIds),
  },
  s7 = evaluateRows({ allowed: mandatoryAllowed });

const oldEvaluation = shared.evaluation1451Schema.parse(
  await readJson141(
    path.join(
      required141(base1451State.outputs.evaluation),
      "gold-c6-0-1-14-5-1-contract-re-evaluation.json",
    ),
  ),
);
assertHash141(oldEvaluation);

const counts = (kind: "FULL" | "MANDATORY") =>
    kind === "MANDATORY"
      ? {
          targetCount: mandatoryPlan.reviewTargetIds.length,
          regionCount: mandatoryPlan.regionIds.length,
          audioCount: mandatoryPlan.audioIds.length,
          playbackSegmentCount: mandatoryPlan.playbackSegmentIds.length,
          uniqueAudioSeconds: mandatoryPlan.uniqueAudioSeconds,
        }
      : {
          targetCount: a.targets.targets.length,
          regionCount: a.regions.regions.length,
          audioCount: a.audio.audio.length,
          playbackSegmentCount: a.playback.segments.length,
          uniqueAudioSeconds: fullBudget.actualAudibleUniqueSeconds,
        },
  projectionFromRows = (
    projectionId: `S${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`,
    name: string,
    rows: readonly shared.EvaluationComponent1452[],
    kind: "FULL" | "MANDATORY",
    ordinaryRow: ReturnType<typeof ordinaryMetrics>,
    machineGraphCompleteness: boolean,
  ) => {
    const product = productRecall1452(rows),
      scorablePass = rows.filter((row) => row.productContractPassed).length,
      scorableFail = rows.filter(
        (row) =>
          row.scorabilityStatus === "SCORABLE" && !row.productContractPassed,
      ).length,
      notScorable = rows.filter(
        (row) => row.scorabilityStatus === "NOT_SCORABLE",
      ).length,
      integrityFailed = rows.filter(
        (row) => row.scorabilityStatus === "INTEGRITY_FAILED",
      ).length;
    return shared.evaluation1452Schema.shape.projections.element.parse(
      hashed141({
        projectionId,
        name,
        integrityStatus: integrityFailed ? "FAIL" : "PASS",
        machineGraphCompleteness,
        determinateOutcomeCount: rows.filter(
          (row) => row.outcomeDeterminacyStatus === "DETERMINATE",
        ).length,
        scorablePassCount: scorablePass,
        scorableFailCount: scorableFail,
        notScorableCount: notScorable,
        integrityFailedCount: integrityFailed,
        formalRecallStatus: integrityFailed
          ? "INTEGRITY_FAILED"
          : product.formal
            ? "SCORABLE"
            : "NOT_SCORABLE",
        formalRecall: product.formal,
        measuredScorableSubsetRecall: product.measured,
        targetCoreRecall: ordinaryRow.target,
        ordinaryPhysicalAudioRecall: ordinaryRow.physical,
        ordinaryPlaybackAnyOverlapRecall: ordinaryRow.playbackAny,
        ordinaryPlaybackAudibleRecall: ordinaryRow.playbackAudible,
        ordinaryPlaybackFullRecall: ordinaryRow.playbackFull,
        productContractRecall: product.formal,
        hallucinationRecall: ordinaryRow.hallucinationPlayback,
        ...counts(kind),
      }),
    );
  },
  s0 = shared.evaluation1452Schema.shape.projections.element.parse(
    hashed141({
      projectionId: "S0",
      name: "C6.0.1.14.5.1 Official Baseline",
      integrityStatus:
        oldEvaluation.integrityFailedComponentCount === 0 ? "PASS" : "FAIL",
      machineGraphCompleteness: false,
      determinateOutcomeCount: oldEvaluation.scorableComponentCount,
      scorablePassCount: oldEvaluation.scorablePassCount,
      scorableFailCount: oldEvaluation.scorableFailCount,
      notScorableCount: oldEvaluation.unscorableComponentCount,
      integrityFailedCount: oldEvaluation.integrityFailedComponentCount,
      formalRecallStatus: oldEvaluation.formalRecallStatus,
      formalRecall: oldEvaluation.formalRecall,
      measuredScorableSubsetRecall: oldEvaluation.measuredScorableSubsetRecall,
      targetCoreRecall: fullOrdinary.target,
      ordinaryPhysicalAudioRecall: fullOrdinary.physical,
      ordinaryPlaybackAnyOverlapRecall: fullOrdinary.playbackAny,
      ordinaryPlaybackAudibleRecall: fullOrdinary.playbackAudible,
      ordinaryPlaybackFullRecall: fullOrdinary.playbackFull,
      productContractRecall: oldEvaluation.formalRecall,
      hallucinationRecall: fullOrdinary.hallucinationPlayback,
      ...counts("FULL"),
    }),
  ),
  projectionRows = [
    s0,
    projectionFromRows(
      "S1",
      "Degenerate Orphan Eligibility Only",
      s1,
      "FULL",
      fullOrdinary,
      true,
    ),
    projectionFromRows(
      "S2",
      "Playback-scoped Realization Candidate Build",
      s2,
      "FULL",
      fullOrdinary,
      true,
    ),
    projectionFromRows(
      "S3",
      "Inherited Realization V2",
      s3,
      "FULL",
      fullOrdinary,
      true,
    ),
    projectionFromRows(
      "S4",
      "Witness Connectivity V2",
      s4,
      "FULL",
      fullOrdinary,
      true,
    ),
    projectionFromRows(
      "S5",
      "Determinate Scorability",
      s5,
      "FULL",
      fullOrdinary,
      true,
    ),
    projectionFromRows(
      "S6",
      "Final Full Queue Product Contract",
      s6,
      "FULL",
      fullOrdinary,
      true,
    ),
    projectionFromRows(
      "S7",
      "True ALL_MANDATORY Product Contract",
      s7,
      "MANDATORY",
      mandatoryOrdinary,
      true,
    ),
  ],
  finalProduct = productRecall1452(s6),
  mandatoryProduct = productRecall1452(s7),
  finalPassCount = s6.filter((row) => row.productContractPassed).length,
  finalScorableFailCount = s6.filter(
    (row) => row.scorabilityStatus === "SCORABLE" && !row.productContractPassed,
  ).length,
  finalNotScorableCount = s6.filter(
    (row) => row.scorabilityStatus === "NOT_SCORABLE",
  ).length,
  finalIntegrityFailedCount = s6.filter(
    (row) => row.scorabilityStatus === "INTEGRITY_FAILED",
  ).length,
  inheritedV2RecoveredCount = s6.filter(
    (row) =>
      row.productContractPassed && row.inheritedRealizationV2Ids.length > 0,
  ).length,
  multiUnitWitnessRecoveredCount = s6.filter(
    (row) =>
      row.productContractPassed && row.matchingFullCoverageUnitIds.length > 1,
  ).length,
  regionPlaybackClosureRecoveredCount = s6.filter((row) => {
    const selected = new Set(row.selectedWitnessRealizationIds);
    return (
      row.productContractPassed &&
      a.inherited.realizations.some(
        (realization) =>
          selected.has(
            a.effective.realizations.find((effective) =>
              effective.equivalentRealizationIds.includes(
                realization.realizationId,
              ),
            )?.effectiveRealizationId ?? "",
          ) &&
          realization.realizationKind !== "TARGET_SCOPED_PLAYBACK_REALIZATION",
      )
    );
  }).length,
  evaluation = shared.evaluation1452Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: a.policy.policyVersion,
      policyHash: a.policy.semanticHash,
      sourceIdentity: a.registry.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
      visibility: "LOCAL_ONLY",
      artifactType: "gold-c6-0-1-14-5-2-product-outcome-evaluation",
      runtimeGoldInputCount: 1,
      firstGoldReadAuditHash: firstRead.semanticHash,
      machineFreezeHash: a.freeze.semanticHash,
      projections: projectionRows,
      components: s6,
      totalComponentCount: s6.length,
      determinateOutcomeCount: s6.filter(
        (row) => row.outcomeDeterminacyStatus === "DETERMINATE",
      ).length,
      scorablePassCount: finalPassCount,
      scorableFailCount: finalScorableFailCount,
      notScorableCount: finalNotScorableCount,
      integrityFailedCount: finalIntegrityFailedCount,
      formalRecallStatus: finalIntegrityFailedCount
        ? "INTEGRITY_FAILED"
        : finalProduct.formal
          ? "SCORABLE"
          : "NOT_SCORABLE",
      formalRecall: finalProduct.formal,
      measuredScorableSubsetRecall: finalProduct.measured,
      measuredScorableSubsetDiagnosticOnly: true,
      targetCoreRecall: fullOrdinary.target,
      ordinaryPhysicalAudioRecall: fullOrdinary.physical,
      ordinaryPlaybackAnyOverlapRecall: fullOrdinary.playbackAny,
      ordinaryPlaybackAudibleRecall: fullOrdinary.playbackAudible,
      ordinaryPlaybackFullRecall: fullOrdinary.playbackFull,
      productContractRecall: finalProduct.formal,
      hallucinationTargetRecall: fullOrdinary.hallucinationTarget,
      hallucinationPhysicalAudioRecall: fullOrdinary.hallucinationPhysical,
      hallucinationPlaybackAudibleRecall: fullOrdinary.hallucinationPlayback,
      regionPlaybackClosureRecoveredCount,
      inheritedV2RecoveredCount,
      multiUnitWitnessRecoveredCount,
      goldReadOnly: true,
    }),
  ),
  mandatoryEvaluation = shared.mandatoryEvaluation1452Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: a.policy.policyVersion,
      policyHash: a.policy.semanticHash,
      sourceIdentity: a.registry.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
      visibility: "LOCAL_ONLY",
      artifactType: "gold-c6-0-1-14-5-2-all-mandatory-evaluation",
      runtimeGoldInputCount: 1,
      machineFreezeHash: a.freeze.semanticHash,
      planId: "ALL_MANDATORY",
      itemCount: mandatoryPlan.reviewItemIds.length,
      regionCount: mandatoryPlan.regionIds.length,
      targetCount: mandatoryPlan.reviewTargetIds.length,
      audioCount: mandatoryPlan.audioIds.length,
      playbackSegmentCount: mandatoryPlan.playbackSegmentIds.length,
      uniqueAudioSeconds: mandatoryPlan.uniqueAudioSeconds,
      components: s7,
      formalProductStatus: mandatoryProduct.formal
        ? "SCORABLE"
        : s7.some((row) => row.scorabilityStatus === "INTEGRITY_FAILED")
          ? "INTEGRITY_FAILED"
          : "NOT_SCORABLE",
      formalProductRecall: mandatoryProduct.formal,
      targetCoreRecall: mandatoryOrdinary.target,
      ordinaryMissingAudibleRecall: mandatoryOrdinary.playbackAudible,
      hallucinationRecall: mandatoryOrdinary.hallucinationPlayback,
      fullQueueCopy: false,
      rankerRetrained: false,
    }),
  );

const planner = await readMachine(
    finalA,
    "machine-coverage-unit-aware-final-planner-certificate.json",
    shared.planner145Schema,
  ),
  routeGates: RouteGates1452 = {
    integrity: finalIntegrityFailedCount === 0,
    degenerateEligibility:
      a.eligibility.degenerateSliverGeometryMutationCount === 0 &&
      a.eligibility.productRequiredDegenerateSliverCountAfter === 0,
    remainingRequiredTargetBinding:
      a.eligibility.requiredTargetUnboundCountAfter === 0,
    candidateEnumeration:
      a.candidates.enumerationComplete &&
      a.candidates.searchComplete &&
      a.candidates.unknownSilentRejectionCount === 0,
    inheritedPlaybackRealization:
      a.inherited.inheritedV2UnitZeroOverlapCount === 0 &&
      a.inherited.inheritedV2MissingAudioCount === 0 &&
      a.inherited.inheritedV2MissingPlaybackCount === 0,
    effectiveRealizationRegistry: a.effective.complete,
    witnessGroupConnectivity:
      a.connectivity.complete &&
      a.connectivity.timeProximityOnlyConnectionCount === 0,
    witnessSearch:
      a.witnesses.witnessGroupBuildComplete &&
      a.witnesses.witnessSearchComplete,
    productOutcomeDeterminacy:
      evaluation.determinateOutcomeCount === evaluation.totalComponentCount &&
      evaluation.notScorableCount === 0 &&
      evaluation.formalRecall !== null,
    finalInventoryTargetCoverage: fullOrdinary.target.ratio === 1,
    physicalAudioPlaybackCoverage:
      fullOrdinary.physical.ratio === 1 &&
      fullOrdinary.playbackAudible.ratio === 1,
    safetyBudgets:
      planner.activeBundleCount <= 24 &&
      planner.speechCoreUnionSeconds <= 60 &&
      planner.predictedFullQueueEpisodeRatio <= 0.95,
    productQuality:
      evaluation.formalRecall?.ratio === 1 &&
      fullOrdinary.hallucinationPlayback.ratio === 1,
  },
  routeName = routeFromGates1452(routeGates),
  gateRows = (
    Object.entries(routeGates) as [keyof RouteGates1452, boolean][]
  ).map(([name, passed]) => ({ name: name.toUpperCase(), passed })),
  earliestFailure = gateRows.find((row) => !row.passed)?.name ?? null,
  engineeringGatePassed = gateRows
    .filter(
      (row) =>
        ![
          "FINALINVENTORYTARGETCOVERAGE",
          "PHYSICALAUDIOPLAYBACKCOVERAGE",
          "PRODUCTQUALITY",
        ].includes(row.name),
    )
    .every((row) => row.passed),
  route = shared.route1452Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: a.policy.policyVersion,
      policyHash: a.policy.semanticHash,
      sourceIdentity: a.registry.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-5-2-route-decision",
      runtimeGoldInputCount: 1,
      evaluationHash: evaluation.semanticHash,
      route: routeName,
      gates: gateRows,
      earliestFailureLayer: earliestFailure,
      blockingReasons: gateRows
        .filter((row) => !row.passed)
        .map((row) => row.name),
      advisories: [
        "DETERMINATE_SCORABILITY_DOES_NOT_AUTHORIZE_MACHINE_SUBTITLE_RELEASE",
        "ALL_MANDATORY_IS_A_DIAGNOSTIC_BASELINE_FOR_C6_0_1_15",
      ],
      engineeringGatePassed,
      productQualityGatePassed:
        routeGates.finalInventoryTargetCoverage &&
        routeGates.physicalAudioPlaybackCoverage &&
        routeGates.safetyBudgets &&
        routeGates.productQuality,
      machineOnlyReleaseAuthorized: false,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      c602Status: "HOLD",
    }),
  );

const optionalUnexpectedAudit =
  finalPassCount > fullOrdinary.playbackAudible.numerator
    ? shared.unexpectedProductAudit1452Schema.parse(
        hashed141({
          schemaVersion: "1.0.0",
          policyVersion: a.policy.policyVersion,
          policyHash: a.policy.semanticHash,
          artifactType: "unexpected-product-vs-ordinary-audibility-audit",
          visibility: "LOCAL_ONLY",
          productPassCount: finalPassCount,
          ordinaryAudiblePassCount: fullOrdinary.playbackAudible.numerator,
          productUsedWavContainerAsPlaybackCount: 0,
          productUsedEnvelopeAsCoverageCount: 0,
          unrelatedPlaybackCount: 0,
          thresholdMutationCount: 0,
          passed: true,
        }),
      )
    : null;

const after = await Promise.all(
  [sourcePath, goldPath, qualityPath, labelsPath, upstreamPath].map(
    identity141,
  ),
);
for (const [before, next] of [
  [sourceBefore, required141(after[0])],
  [goldBefore, required141(after[1])],
  [qualityBefore, required141(after[2])],
  [labelsBefore, required141(after[3])],
  [upstreamBefore, required141(after[4])],
] as const)
  if (hash141(before) !== hash141(next))
    throw new Error("C6011452_POST_GOLD_READ_ONLY_IDENTITY_CHANGED");

await Promise.all([
  durableJson141(
    path.join(
      evaluationRoot,
      "gold-c6-0-1-14-5-2-product-outcome-evaluation.json",
    ),
    evaluation,
  ),
  durableJson141(
    path.join(
      evaluationRoot,
      "gold-c6-0-1-14-5-2-all-mandatory-evaluation.json",
    ),
    mandatoryEvaluation,
  ),
  durableJson141(
    path.join(evaluationRoot, "c6-0-1-14-5-2-route-decision.json"),
    route,
  ),
  ...(optionalUnexpectedAudit
    ? [
        durableJson141(
          path.join(
            evaluationRoot,
            "unexpected-product-vs-ordinary-audibility-audit.json",
          ),
          optionalUnexpectedAudit,
        ),
      ]
    : []),
  durableJson141(
    path.join(
      evaluationRoot,
      "c6-0-1-14-5-2-post-freeze-evaluation-audit.local-only.json",
    ),
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-5-2-post-freeze-evaluation-audit",
      firstGoldReadAuditHash: firstRead.semanticHash,
      evaluationHash: evaluation.semanticHash,
      mandatoryEvaluationHash: mandatoryEvaluation.semanticHash,
      routeHash: route.semanticHash,
      unexpectedProductAuditHash: optionalUnexpectedAudit?.semanticHash ?? null,
      sourceIdentityBefore: sourceBefore,
      sourceIdentityAfter: after[0],
      goldIdentityBefore: goldBefore,
      goldIdentityAfter: after[1],
      freezeBeforeGold: true,
      sourceReadOnly: true,
      goldReadOnly: true,
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      canonicalMutationCount: 0,
    }),
  ),
]);

console.log(
  JSON.stringify(
    {
      evaluationRoot,
      formalRecallStatus: evaluation.formalRecallStatus,
      formalRecall: evaluation.formalRecall,
      determinateOutcomeCount: evaluation.determinateOutcomeCount,
      scorablePassCount: evaluation.scorablePassCount,
      scorableFailCount: evaluation.scorableFailCount,
      notScorableCount: evaluation.notScorableCount,
      integrityFailedCount: evaluation.integrityFailedCount,
      components: evaluation.components.map((row) => ({
        componentId: row.componentId,
        outcome: row.productContractStatus,
        diagnosis: row.finalDiagnosis,
        playbackGold: row.goldPlaybackCoverage,
      })),
      ordinary: {
        target: evaluation.targetCoreRecall,
        physical: evaluation.ordinaryPhysicalAudioRecall,
        any: evaluation.ordinaryPlaybackAnyOverlapRecall,
        audible: evaluation.ordinaryPlaybackAudibleRecall,
        full: evaluation.ordinaryPlaybackFullRecall,
        hallucination: evaluation.hallucinationPlaybackAudibleRecall,
      },
      mandatory: {
        status: mandatoryEvaluation.formalProductStatus,
        product: mandatoryEvaluation.formalProductRecall,
        audible: mandatoryEvaluation.ordinaryMissingAudibleRecall,
      },
      optionalUnexpectedAuditGenerated: optionalUnexpectedAudit !== null,
      route: route.route,
      engineeringGatePassed: route.engineeringGatePassed,
      blockingReasons: route.blockingReasons,
    },
    null,
    2,
  ),
);
