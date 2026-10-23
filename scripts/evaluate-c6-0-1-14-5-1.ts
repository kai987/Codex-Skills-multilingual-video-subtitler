/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Strict artifact schemas intentionally narrow several fields to literals; this evaluator still rechecks their runtime relationships across independently loaded files. */
import path from "node:path";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import { c60StableHash } from "../packages/video-subtitler/src/finalization-risk-policy.js";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import {
  evaluateProductComponent1451,
  routeFromGates1451,
  type RouteGates1451,
} from "../packages/video-subtitler/src/review/c6011451-contract-evaluation.js";
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

type Component = shared.Evaluation1451["components"][number];
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
  inputs = await loadInputs145(
    shared.state143Schema.parse(await readJson141(state.baseStatePath)).config
      .baselineState,
  ),
  sourcePath = inputs.baseline.old.config.source;

const readMachine = async <T>(
  root: string,
  name: string,
  schema: { parse(value: unknown): T },
) =>
  schema.parse(await readJson141(path.join(root, "machine-artifacts", name)));
const readReview = async <T>(
  root: string,
  name: string,
  schema: { parse(value: unknown): T },
) => schema.parse(await readJson141(path.join(root, "review-workspace", name)));

async function loadFrozen(role: "A" | "B", root: string) {
  const policy = await readMachine(
      root,
      "c6-0-1-14-5-1-full-unit-registry-review-binding-policy.json",
      shared.policy1451Schema,
    ),
    baseline = await readMachine(
      root,
      "machine-c6-0-1-14-5-1-registry-binding-baseline-audit.json",
      shared.baselineAudit1451Schema,
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
    planning = await readMachine(
      root,
      "machine-uncovered-safety-unit-projection-v1.json",
      shared.planningProjection1451Schema,
    ),
    compatibility = await readMachine(
      root,
      "machine-coverage-unit-registry-compatibility-map-v1.json",
      shared.compatibilityMap1451Schema,
    ),
    binding = await readMachine(
      root,
      "machine-review-delivery-coverage-unit-binding-v1.json",
      shared.reviewBinding1451Schema,
    ),
    inherited = await readMachine(
      root,
      "machine-existing-review-delivery-realizations-v1.json",
      shared.inheritedRealizations1451Schema,
    ),
    effective = await readMachine(
      root,
      "machine-effective-product-realization-registry-v1.json",
      shared.effectiveRealizations1451Schema,
    ),
    witnesses = await readMachine(
      root,
      "machine-product-contract-witness-groups-v1.json",
      shared.witnessGroups1451Schema,
    ),
    preflight = await readMachine(
      root,
      "c6-0-1-14-5-1-nested-semantic-integrity-preflight.json",
      shared.nestedPreflight1451Schema,
    ),
    targets = await readReview(
      root,
      "machine-review-target-intervals-v8.json",
      shared.reviewTargets1451Schema,
    ),
    items = await readReview(
      root,
      "machine-review-items-v10.json",
      shared.reviewItems1451Schema,
    ),
    regions = await readReview(
      root,
      "machine-review-regions-v9.json",
      shared.reviewRegions1451Schema,
    ),
    audio = await readReview(
      root,
      "machine-review-audio-manifest-v9.json",
      shared.reviewAudio1451Schema,
    ),
    playback = await readReview(
      root,
      "machine-review-playback-timeline-v8.json",
      shared.reviewPlayback1451Schema,
    ),
    freeze = shared.freeze1451Schema.parse(
      await readJson141(
        path.join(root, "c6-0-1-14-5-1-machine-registry-binding-freeze.json"),
      ),
    );
  [
    policy,
    baseline,
    registry,
    reconciliation,
    planning,
    compatibility,
    binding,
    inherited,
    effective,
    witnesses,
    preflight,
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
    freeze.fullRegistryHash !== registry.semanticHash ||
    freeze.sourceReconciliationHash !== reconciliation.semanticHash ||
    freeze.planningProjectionHash !== planning.semanticHash ||
    freeze.compatibilityMapHash !== compatibility.semanticHash ||
    freeze.reviewBindingHash !== binding.semanticHash ||
    freeze.inheritedRealizationHash !== inherited.semanticHash ||
    freeze.effectiveRealizationRegistryHash !== effective.semanticHash ||
    freeze.witnessGroupHash !== witnesses.semanticHash ||
    freeze.nestedPreflightHash !== preflight.semanticHash ||
    freeze.reviewDeliveryHashes.targets !== targets.semanticHash ||
    freeze.reviewDeliveryHashes.items !== items.semanticHash ||
    freeze.reviewDeliveryHashes.regions !== regions.semanticHash ||
    freeze.reviewDeliveryHashes.audio !== audio.semanticHash ||
    freeze.reviewDeliveryHashes.playback !== playback.semanticHash
  )
    throw new Error(`C6011451_FREEZE_BINDING_FAILED:${role}`);
  return {
    policy,
    baseline,
    registry,
    reconciliation,
    planning,
    compatibility,
    binding,
    inherited,
    effective,
    witnesses,
    preflight,
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
  parity = shared.parity1451Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-1-final-ab-parity.json"),
    ),
  );
assertHash141(parity);
if (
  parity.finalAFreezeHash !== a.freeze.semanticHash ||
  parity.finalBFreezeHash !== b.freeze.semanticHash ||
  !parity.semanticParity
)
  throw new Error("C6011451_FINAL_AB_PARITY_BINDING_FAILED");

const goldFirstReadAt = new Date().toISOString();
if (Date.parse(goldFirstReadAt) < Date.parse(a.freeze.freezeCompletedAt))
  throw new Error("C6011451_FREEZE_NOT_COMPLETED_BEFORE_GOLD_READ");
const firstRead = shared.firstGoldRead1451Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    policyVersion: a.policy.policyVersion,
    policyHash: a.policy.semanticHash,
    sourceIdentity: a.registry.sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
    visibility: "LOCAL_ONLY",
    artifactType: "c6-0-1-14-5-1-first-gold-read-audit",
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
  path.join(evaluationRoot, "c6-0-1-14-5-1-first-gold-read-audit.json"),
  firstRead,
);

// The Gold barrier ends only after the durable receipt above exists.
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
  throw new Error("C6011451_GOLD_SOURCE_HASH_BINDING_FAILED");
const errorComponents = c60114GoldErrorComponents(
    upstream,
    labels.errorComponents,
    a.registry.sourceIdentity,
  ),
  missing = errorComponents.filter((row) =>
    row.labels.includes("MISSING_DIALOGUE"),
  );
if (missing.length !== 6)
  throw new Error(`C6011451_MISSING_DENOMINATOR_CHANGED:${missing.length}`);
if (
  hash141(errorComponents.map((row) => row.errorComponentId).sort()) !==
  hash141(quality.errorComponents.map((row) => row.errorComponentId).sort())
)
  throw new Error("C6011451_GOLD_DENOMINATOR_CHANGED");

const projections = shared.projections143Schema.parse(
    await readJson141(path.join(finalA, "machine-coverage-projections.json")),
  ),
  official = required141(
    projections.variants.find((row) => row.stage === projections.officialStage),
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
    `C6011451_ORDINARY_EVALUATION_INTEGRITY_FAILED:${ordinary.integrityFailures.join("|")}`,
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
});
const fullOrdinary = ordinaryMetrics(fullBudget),
  mandatoryOrdinary = ordinaryMetrics(mandatoryBudget),
  zeroRecall = { numerator: 0, denominator: missing.length, ratio: 0 };

const isScorable = (row: Component) => row.status.startsWith("SCORABLE_"),
  isPass = (row: Component) => row.productContractPassed,
  productRecall = (rows: readonly Component[]): Recall | null => {
    const scorable = rows.filter(isScorable);
    return scorable.length === rows.length
      ? {
          numerator: scorable.filter(isPass).length,
          denominator: rows.length,
          ratio: rows.length ? scorable.filter(isPass).length / rows.length : 1,
        }
      : null;
  },
  measuredRecall = (rows: readonly Component[]): Recall | null => {
    const scorable = rows.filter(isScorable);
    return scorable.length
      ? {
          numerator: scorable.filter(isPass).length,
          denominator: scorable.length,
          ratio: scorable.filter(isPass).length / scorable.length,
        }
      : null;
  };
const evaluateRows = (
  mode:
    | "REGISTRY_ONLY"
    | "BINDING_ONLY"
    | "INHERITED_ONLY"
    | "SINGLE_UNIT_ONLY"
    | "FULL",
  allowed?: {
    targetIds?: ReadonlySet<string>;
    audioIds?: ReadonlySet<string>;
    playbackSegmentIds?: ReadonlySet<string>;
  },
) =>
  missing.map((component) =>
    evaluateProductComponent1451({
      policy: a.policy,
      component,
      registry: a.registry,
      binding: a.binding,
      effective: a.effective,
      witnesses: a.witnesses,
      mode,
      ...(allowed === undefined ? {} : { allowed }),
    }),
  );
const r1 = evaluateRows("REGISTRY_ONLY"),
  r2 = evaluateRows("BINDING_ONLY"),
  r3 = evaluateRows("INHERITED_ONLY"),
  r4 = evaluateRows("SINGLE_UNIT_ONLY"),
  r5 = evaluateRows("FULL"),
  r6 = r5,
  mandatoryAllowed = {
    targetIds: new Set(mandatoryPlan.reviewTargetIds),
    audioIds: new Set(mandatoryPlan.audioIds),
    playbackSegmentIds: new Set(mandatoryPlan.playbackSegmentIds),
  },
  r7 = evaluateRows("FULL", mandatoryAllowed);

const planCounts = (kind: "NONE" | "FULL" | "MANDATORY") => {
    if (kind === "NONE")
      return {
        reviewTargetCount: 0,
        reviewRegionCount: 0,
        physicalAudioCount: 0,
        playbackSegmentCount: 0,
        uniqueAudioSeconds: 0,
      };
    if (kind === "MANDATORY")
      return {
        reviewTargetCount: mandatoryPlan.reviewTargetIds.length,
        reviewRegionCount: mandatoryPlan.regionIds.length,
        physicalAudioCount: mandatoryPlan.audioIds.length,
        playbackSegmentCount: mandatoryPlan.playbackSegmentIds.length,
        uniqueAudioSeconds: mandatoryPlan.uniqueAudioSeconds,
      };
    return {
      reviewTargetCount: a.targets.targets.length,
      reviewRegionCount: a.regions.regions.length,
      physicalAudioCount: a.audio.audio.length,
      playbackSegmentCount: a.playback.segments.length,
      uniqueAudioSeconds: fullBudget.actualAudibleUniqueSeconds,
    };
  },
  projectionRow = (
    projectionId: `R${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`,
    name: string,
    rows: readonly Component[],
    kind: "NONE" | "FULL" | "MANDATORY",
    ordinaryRow: ReturnType<typeof ordinaryMetrics>,
    overrides: {
      fullRegistryUnitCount?: number;
      registryCoverageRatio?: number;
      targetBindingCount?: number;
      inheritedRealizationCount?: number;
      effectiveRealizationCount?: number;
      witnessGroupCount?: number;
    } = {},
  ) => {
    const counts = planCounts(kind),
      formal = productRecall(rows),
      scorable = rows.filter(isScorable).length,
      pass = rows.filter(isPass).length;
    return shared.evaluation1451Schema.shape.projections.element.parse(
      hashed141({
        projectionId,
        name,
        integrityStatus: "PASS",
        scorabilityStatus:
          scorable === rows.length ? "SCORABLE" : "NOT_SCORABLE",
        fullRegistryUnitCount:
          overrides.fullRegistryUnitCount ?? a.registry.fullRegistryUnitCount,
        registeredSpeechUnionSeconds:
          overrides.fullRegistryUnitCount === 0
            ? 0
            : a.registry.registeredVerifiedSpeechUnionSeconds,
        registryCoverageRatio: overrides.registryCoverageRatio ?? 1,
        targetBindingCount:
          overrides.targetBindingCount ?? a.binding.targetUnitPairCount,
        inheritedRealizationCount:
          overrides.inheritedRealizationCount ??
          a.inherited.realizations.length,
        effectiveRealizationCount:
          overrides.effectiveRealizationCount ??
          a.effective.realizations.length,
        witnessGroupCount:
          overrides.witnessGroupCount ?? a.witnesses.groups.length,
        singleUnitWitnessCount: rows.filter(
          (row) => row.status === "SCORABLE_SINGLE_UNIT_PASS",
        ).length,
        multiUnitWitnessCount: rows.filter(
          (row) => row.status === "SCORABLE_MULTI_UNIT_PASS",
        ).length,
        ...counts,
        scorableComponentCount: scorable,
        productPassCount: pass,
        productFailCount: rows.filter((row) => row.status === "SCORABLE_FAIL")
          .length,
        productUnscorableCount: rows.length - scorable,
        productRecall: formal,
        targetCoreRecall: ordinaryRow.target,
        ordinaryPhysicalAudioRecall: ordinaryRow.physical,
        ordinaryPlaybackAudibleRecall: ordinaryRow.playbackAudible,
        hallucinationRecall: ordinaryRow.hallucinationPlayback,
      }),
    );
  };
const r0Rows = r1,
  projectionRows = [
    projectionRow(
      "R0",
      "C6.0.1.14.5 Official Result",
      r0Rows,
      "FULL",
      fullOrdinary,
      {
        fullRegistryUnitCount: 0,
        registryCoverageRatio: a.baseline.currentRegistryCoverageRatio,
        targetBindingCount: 0,
        inheritedRealizationCount: 0,
        effectiveRealizationCount: 0,
        witnessGroupCount: 0,
      },
    ),
    projectionRow("R1", "Full Registry Annotation Only", r1, "NONE", {
      ...fullOrdinary,
      target: zeroRecall,
      physical: zeroRecall,
      playbackAny: zeroRecall,
      playbackAudible: zeroRecall,
      playbackFull: zeroRecall,
    }),
    projectionRow(
      "R2",
      "Existing Target to Unit Binding",
      r2,
      "FULL",
      fullOrdinary,
      {
        inheritedRealizationCount: 0,
        effectiveRealizationCount: 0,
        witnessGroupCount: 0,
      },
    ),
    projectionRow(
      "R3",
      "Inherited Existing Delivery Realizations",
      r3,
      "FULL",
      fullOrdinary,
    ),
    projectionRow(
      "R4",
      "Single-Unit Product Contract",
      r4,
      "FULL",
      fullOrdinary,
    ),
    projectionRow(
      "R5",
      "Multi-Unit Product Witness Contract",
      r5,
      "FULL",
      fullOrdinary,
    ),
    projectionRow(
      "R6",
      "Final Full Queue Contract Result",
      r6,
      "FULL",
      fullOrdinary,
    ),
    projectionRow(
      "R7",
      "True ALL_MANDATORY Contract Result",
      r7,
      "MANDATORY",
      mandatoryOrdinary,
    ),
  ];

const finalFormal = productRecall(r6),
  finalMeasured = measuredRecall(r6),
  mandatoryFormal = productRecall(r7),
  scorableCount = r6.filter(isScorable).length,
  evaluation = shared.evaluation1451Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: a.policy.policyVersion,
      policyHash: a.policy.semanticHash,
      sourceIdentity: a.registry.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
      visibility: "LOCAL_ONLY",
      artifactType: "gold-c6-0-1-14-5-1-registry-binding-contract-evaluation",
      runtimeGoldInputCount: 1,
      firstGoldReadAuditHash: firstRead.semanticHash,
      machineFreezeHash: a.freeze.semanticHash,
      projections: projectionRows,
      components: r6,
      totalComponentCount: r6.length,
      scorableComponentCount: scorableCount,
      scorablePassCount: r6.filter(isPass).length,
      scorableFailCount: r6.filter((row) => row.status === "SCORABLE_FAIL")
        .length,
      unscorableComponentCount: r6.length - scorableCount,
      integrityFailedComponentCount: r6.filter(
        (row) => row.status === "INTEGRITY_FAILED",
      ).length,
      formalRecallStatus: r6.some((row) => row.status === "INTEGRITY_FAILED")
        ? "INTEGRITY_FAILED"
        : finalFormal
          ? "SCORABLE"
          : "NOT_SCORABLE",
      formalRecall: finalFormal,
      measuredScorableSubsetRecall: finalMeasured,
      targetCoreRecall: fullOrdinary.target,
      ordinaryPhysicalAudioRecall: fullOrdinary.physical,
      ordinaryPlaybackAnyOverlapRecall: fullOrdinary.playbackAny,
      ordinaryPlaybackAudibleRecall: fullOrdinary.playbackAudible,
      ordinaryPlaybackFullRecall: fullOrdinary.playbackFull,
      hallucinationTargetRecall: fullOrdinary.hallucinationTarget,
      hallucinationPhysicalAudioRecall: fullOrdinary.hallucinationPhysical,
      hallucinationPlaybackAudibleRecall: fullOrdinary.hallucinationPlayback,
      allMandatory: {
        planId: "ALL_MANDATORY",
        itemCount: mandatoryPlan.reviewItemIds.length,
        regionCount: mandatoryPlan.regionIds.length,
        targetCount: mandatoryPlan.reviewTargetIds.length,
        audioCount: mandatoryPlan.audioIds.length,
        playbackSegmentCount: mandatoryPlan.playbackSegmentIds.length,
        uniqueAudioSeconds: mandatoryPlan.uniqueAudioSeconds,
        productScorability: mandatoryFormal ? "SCORABLE" : "NOT_SCORABLE",
        productRecall: mandatoryFormal,
        targetCoreRecall: mandatoryOrdinary.target,
        ordinaryAudibleRecall: mandatoryOrdinary.playbackAudible,
        hallucinationRecall: mandatoryOrdinary.hallucinationPlayback,
      },
      safetyCompletionStatus:
        a.binding.requiredTargetUnboundCount === 0 &&
        finalFormal?.ratio === 1 &&
        fullOrdinary.hallucinationPlayback.ratio === 1
          ? "PASS"
          : "FAIL_CLOSED",
      goldReadOnly: true,
    }),
  ),
  witnessEvaluation = shared.witnessEvaluation1451Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: a.policy.policyVersion,
      policyHash: a.policy.semanticHash,
      sourceIdentity: a.registry.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
      visibility: "LOCAL_ONLY",
      artifactType: "gold-c6-0-1-14-5-1-multi-unit-witness-evaluation",
      runtimeGoldInputCount: 1,
      machineFreezeHash: a.freeze.semanticHash,
      witnessGroupHash: a.witnesses.semanticHash,
      witnessSearchComplete: a.witnesses.witnessSearchComplete,
      components: r6,
      singleUnitPassCount: r6.filter(
        (row) => row.status === "SCORABLE_SINGLE_UNIT_PASS",
      ).length,
      multiUnitPassCount: r6.filter(
        (row) => row.status === "SCORABLE_MULTI_UNIT_PASS",
      ).length,
      scorableFailCount: r6.filter((row) => row.status === "SCORABLE_FAIL")
        .length,
      unscorableCount: r6.filter((row) => !isScorable(row)).length,
    }),
  );

const planner = await readMachine(
    finalA,
    "machine-coverage-unit-aware-final-planner-certificate.json",
    shared.planner145Schema,
  ),
  routeGates: RouteGates1451 = {
    integrity: true,
    registry:
      a.registry.registeredVerifiedSpeechCoverageRatio === 1 &&
      a.registry.unregisteredVerifiedSpeechSamples === 0,
    compatibility:
      a.compatibility.unresolvedPlannerSelectedUnitMappings === 0 &&
      a.compatibility.plannerSelectedUnitMappingCoverageRatio === 1,
    requiredTargetBinding:
      a.binding.requiredTargetUnboundCount === 0 &&
      a.binding.productEligibleTargetUnitZeroOverlapCount === 0,
    audioPlaybackBinding:
      a.binding.productEligibleAudioUnitZeroOverlapCount === 0 &&
      a.binding.productEligiblePlaybackUnitZeroOverlapCount === 0 &&
      a.binding.playbackWithoutAudioBindingCount === 0 &&
      a.binding.playbackWithoutTargetBindingCount === 0,
    plannerRealization: planner.selectedRealizationIds.length === 19,
    inheritedRealization:
      a.inherited.inheritedRealizationUnitZeroOverlapCount === 0 &&
      a.inherited.inheritedRealizationMissingAudioCount === 0 &&
      a.inherited.inheritedRealizationMissingPlaybackCount === 0,
    witnessGroups: a.witnesses.witnessGroupCount > 0,
    witnessSearch: a.witnesses.witnessSearchComplete,
    scorability: finalFormal !== null,
    finalTargetCoverage: fullOrdinary.target.ratio === 1,
    physicalAudioPlayback:
      fullOrdinary.physical.ratio === 1 &&
      fullOrdinary.playbackAudible.ratio === 1,
    safetyBudgets:
      planner.activeBundleCount <= 24 &&
      planner.speechCoreUnionSeconds <= 60 &&
      planner.predictedFullQueueEpisodeRatio <= 0.95,
    productQuality:
      finalFormal?.ratio === 1 &&
      fullOrdinary.hallucinationPlayback.ratio === 1,
  },
  routeName = routeFromGates1451(routeGates),
  gateRows = (
    Object.entries(routeGates) as [keyof RouteGates1451, boolean][]
  ).map(([name, passed]) => ({
    name: name.toUpperCase(),
    passed,
  })),
  route = shared.route1451Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: a.policy.policyVersion,
      policyHash: a.policy.semanticHash,
      sourceIdentity: a.registry.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-5-1-route-decision",
      runtimeGoldInputCount: 1,
      evaluationHash: evaluation.semanticHash,
      route: routeName,
      gates: gateRows,
      blockingReasons: gateRows
        .filter((row) => !row.passed)
        .map((row) => row.name),
      advisories: [
        "PRODUCT_CONTRACT_AUDIBILITY_DOES_NOT_AUTHORIZE_MACHINE_SUBTITLE_RELEASE",
        "ALL_MANDATORY_IS_DIAGNOSTIC_UNTIL_RANKER_RECALIBRATION",
      ],
      machineOnlyReleaseAuthorized: false,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      c602Status: "HOLD",
    }),
  );

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
    throw new Error("C6011451_POST_GOLD_READ_ONLY_IDENTITY_CHANGED");

await Promise.all([
  durableJson141(
    path.join(evaluationRoot, "gold-c6-0-1-14-5-1-contract-re-evaluation.json"),
    evaluation,
  ),
  durableJson141(
    path.join(
      evaluationRoot,
      "gold-c6-0-1-14-5-1-multi-unit-witness-evaluation.json",
    ),
    witnessEvaluation,
  ),
  durableJson141(
    path.join(evaluationRoot, "c6-0-1-14-5-1-route-decision.json"),
    route,
  ),
  durableJson141(
    path.join(
      evaluationRoot,
      "c6-0-1-14-5-1-post-freeze-evaluation-audit.local-only.json",
    ),
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-5-1-post-freeze-evaluation-audit",
      firstGoldReadAuditHash: firstRead.semanticHash,
      evaluationHash: evaluation.semanticHash,
      witnessEvaluationHash: witnessEvaluation.semanticHash,
      routeHash: route.semanticHash,
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
      measuredScorableSubsetRecall: evaluation.measuredScorableSubsetRecall,
      componentStatuses: evaluation.components.map((row) => ({
        componentId: row.componentId,
        status: row.status,
        diagnosis: row.finalDiagnosis,
      })),
      ordinary: {
        target: evaluation.targetCoreRecall,
        physical: evaluation.ordinaryPhysicalAudioRecall,
        audible: evaluation.ordinaryPlaybackAudibleRecall,
        hallucination: evaluation.hallucinationPlaybackAudibleRecall,
      },
      mandatory: evaluation.allMandatory,
      route: route.route,
      blockingReasons: route.blockingReasons,
    },
    null,
    2,
  ),
);
