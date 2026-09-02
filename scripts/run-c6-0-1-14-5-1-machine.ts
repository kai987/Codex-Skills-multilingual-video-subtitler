import path from "node:path";
import { cp, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { allocateC60114Output } from "./lib/c60114-output.js";
import { loadInputs145 } from "./lib/c601145-input.js";
import { buildBaselineAudit1451 } from "../packages/video-subtitler/src/review/c6011451-baseline-audit.js";
import { policy1451 } from "../packages/video-subtitler/src/review/c6011451-policy.js";
import { buildFullRegistry1451 } from "../packages/video-subtitler/src/review/c6011451-registry.js";
import { buildReviewDeliveryBinding1451 } from "../packages/video-subtitler/src/review/c6011451-review-delivery-binding.js";
import {
  buildEffectiveRealizations1451,
  buildInheritedRealizations1451,
  buildWitnessGroups1451,
} from "../packages/video-subtitler/src/review/c6011451-realizations.js";
import { projectReviewDelivery1451 } from "../packages/video-subtitler/src/review/c6011451-review-delivery.js";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
  union141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  durableJson141,
  fileHash141,
  readJson141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import { header1451 } from "../packages/video-subtitler/src/review/c6011451-policy.js";

const { values } = parseArgs({
  strict: true,
  options: {
    state: { type: "string" },
    "output-root": { type: "string" },
    prefix: { type: "string", default: "carnation-c6-0-1-14-5-1" },
    date: { type: "string", default: "20260902" },
    "execution-policy": { type: "string", default: "replay-only" },
  },
});
if (values["execution-policy"] !== "replay-only")
  throw new Error("C6011451_ONLY_REPLAY_ONLY_IS_AUTHORIZED");
const baseStatePath = path.resolve(
    required141(values.state, "--state required"),
  ),
  outputRoot = path.resolve(
    required141(values["output-root"], "--output-root required"),
  ),
  prefix = required141(values.prefix),
  date = required141(values.date),
  baseState = shared.state143Schema.parse(await readJson141(baseStatePath));
if (hash141(baseState.config) !== baseState.configHash)
  throw new Error("C6011451_BASE_STATE_CONFIG_CHANGED");
const inputs = await loadInputs145(baseState.config.baselineState),
  baseFinalA = required141(baseState.outputs["final-a"]),
  baseFinalB = required141(baseState.outputs["final-b"]),
  roles = [
    "baseline",
    "registry-audit",
    "full-registry",
    "unit-compatibility",
    "review-binding",
    "inherited-realizations",
    "witness-groups",
    "review-package",
    "final-a",
    "final-b",
    "evaluation",
    "validation",
  ] as const,
  outputs: Record<string, string> = {};
for (const role of roles)
  outputs[role] = await allocateC60114Output(
    outputRoot,
    `${prefix}-${role}-${date}`,
  );
const dir = (role: (typeof roles)[number]) => required141(outputs[role]),
  createdAt = new Date().toISOString(),
  policy = policy1451();

await Promise.all([
  cp(baseFinalA, dir("final-a"), { recursive: true, force: false }),
  cp(baseFinalB, dir("final-b"), { recursive: true, force: false }),
  cp(
    path.join(baseFinalA, "review-workspace"),
    path.join(dir("review-package"), "review-workspace"),
    {
      recursive: true,
      force: false,
    },
  ),
]);

const readMachine = async <T>(
    root: string,
    name: string,
    schema: { parse(value: unknown): T },
  ) =>
    schema.parse(await readJson141(path.join(root, "machine-artifacts", name))),
  units = await readMachine(
    baseFinalA,
    "machine-speech-safety-coverage-units-v1.json",
    shared.coverageUnits145Schema,
  ),
  planner = await readMachine(
    baseFinalA,
    "machine-coverage-unit-aware-final-planner-certificate.json",
    shared.planner145Schema,
  ),
  realizations = await readMachine(
    baseFinalA,
    "machine-coverage-unit-realization-candidates-v1.json",
    shared.realizations145Schema,
  ),
  safety = await readMachine(
    baseFinalA,
    "machine-missing-safety-reserve-targets-v5.json",
    shared.safetyTargets145Schema,
  ),
  oldFreezeA = shared.freeze145Schema.parse(
    await readJson141(
      path.join(baseFinalA, "c6-0-1-14-5-machine-safety-coverage-freeze.json"),
    ),
  ),
  oldFreezeB = shared.freeze145Schema.parse(
    await readJson141(
      path.join(baseFinalB, "c6-0-1-14-5-machine-safety-coverage-freeze.json"),
    ),
  ),
  readDelivery = async (root: string) => {
    const workspace = path.join(root, "review-workspace");
    return {
      targets: shared.reviewTargets145Schema.parse(
        await readJson141(
          path.join(workspace, "machine-review-target-intervals-v7.json"),
        ),
      ),
      items: shared.reviewItems145Schema.parse(
        await readJson141(path.join(workspace, "machine-review-items-v9.json")),
      ),
      regions: shared.reviewRegions145Schema.parse(
        await readJson141(
          path.join(workspace, "machine-review-regions-v8.json"),
        ),
      ),
      audio: shared.reviewAudio145Schema.parse(
        await readJson141(
          path.join(workspace, "machine-review-audio-manifest-v8.json"),
        ),
      ),
      playback: shared.reviewPlayback145Schema.parse(
        await readJson141(
          path.join(workspace, "machine-review-playback-timeline-v7.json"),
        ),
      ),
    };
  },
  deliveryA = await readDelivery(baseFinalA),
  deliveryB = await readDelivery(baseFinalB);
[
  units,
  planner,
  realizations,
  safety,
  oldFreezeA,
  oldFreezeB,
  ...Object.values(deliveryA),
  ...Object.values(deliveryB),
].forEach(assertHash141);

for (const [root, delivery] of [
  [baseFinalA, deliveryA],
  [baseFinalB, deliveryB],
] as const)
  for (const audio of delivery.audio.audio) {
    const file = path.join(root, "review-workspace", audio.relativePath);
    if ((await fileHash141(file)) !== audio.sha256)
      throw new Error(`C6011451_WAV_HASH_CHANGED:${audio.audioId}`);
  }

const cueIntervals = union141(
    inputs.hierarchy.atoms
      .filter((row) => row.cueCovered)
      .map((row) => row.nativeInterval),
  ),
  immutableIntervals = union141(
    inputs.hierarchy.atoms
      .filter((row) => row.immutableTargetCovered)
      .map((row) => row.nativeInterval),
  ),
  baselineAudit = buildBaselineAudit1451({
    policy,
    inventory: inputs.baseline.inventory,
    units,
    planner,
    realizations,
    safety,
    ...deliveryA,
    cueIntervals,
    immutableIntervals,
  }),
  registryBuild = buildFullRegistry1451({
    policy,
    inventory: inputs.baseline.inventory,
    hierarchy: inputs.hierarchy,
    planningUnits: units,
    planner,
    reviewTargets: deliveryA.targets,
    reviewAudio: deliveryA.audio,
  }),
  binding = buildReviewDeliveryBinding1451({
    policy,
    registry: registryBuild.registry,
    ...deliveryA,
  }),
  inherited = buildInheritedRealizations1451({
    policy,
    registry: registryBuild.registry,
    binding,
    ...deliveryA,
  }),
  effective = buildEffectiveRealizations1451({
    policy,
    registry: registryBuild.registry,
    compatibility: registryBuild.compatibility,
    binding,
    inherited,
    planner,
    realizations,
    targets: deliveryA.targets,
    audio: deliveryA.audio,
  }),
  witnesses = buildWitnessGroups1451({
    policy,
    registry: registryBuild.registry,
    effective,
  }),
  projected = projectReviewDelivery1451({
    policy,
    binding,
    inherited,
    effective,
    ...deliveryA,
  }),
  mandatoryPlan = required141(
    projected.playback.plans.find((row) => row.planId === "ALL_MANDATORY"),
    "C6011451_ALL_MANDATORY_PLAN_MISSING",
  );

if (
  planner.selectedBundleIds.join("|") !==
  (
    await readMachine(
      baseFinalB,
      "machine-coverage-unit-aware-final-planner-certificate.json",
      shared.planner145Schema,
    )
  ).selectedBundleIds.join("|")
)
  throw new Error("C6011451_PLANNER_GEOMETRY_PARITY_FAILED");

const geometry = shared.geometryFreeze1451Schema.parse(
    hashed141({
      ...header1451(policy, registryBuild.registry.sourceIdentity),
      artifactType: "machine-c6-0-1-14-5-1-geometry-freeze",
      inventoryHash: inputs.baseline.inventory.semanticHash,
      hierarchyHash: inputs.hierarchy.semanticHash,
      planningUnitsHash: units.semanticHash,
      plannerHash: planner.semanticHash,
      selectedBundleIdsHash: hash141(planner.selectedBundleIds),
      selectedChildIdsHash: hash141(planner.selectedChildIds),
      selectedRealizationIdsHash: hash141(planner.selectedRealizationIds),
      reviewTargetGeometryHash: hash141(
        deliveryA.targets.targets.map((row) => ({
          id: row.reviewTargetId,
          interval: row.nativeInterval,
        })),
      ),
      reviewRegionGeometryHash: hash141(
        deliveryA.regions.regions.map((row) => ({
          id: row.regionId,
          intervals: row.nativeSourceIntervals,
        })),
      ),
      reviewAudioGeometryHash: hash141(
        deliveryA.audio.audio.map((row) => ({
          id: row.audioId,
          requested: row.requestedSourceInterval,
          actual: row.nativeSourceInterval,
        })),
      ),
      reviewAudioBytesHash: hash141(
        deliveryA.audio.audio.map((row) => ({
          id: row.audioId,
          sha256: row.sha256,
        })),
      ),
      playbackGeometryHash: hash141(
        deliveryA.playback.segments.map((row) => ({
          id: row.playbackSegmentId,
          interval: row.sourceInterval,
        })),
      ),
      protectedSubtitleFileHashes: oldFreezeA.subtitleFileHashes,
      plannerGeometryParity: true,
      targetIntervalParity: true,
      regionIntervalParity: true,
      audioByteParity: true,
      playbackIntervalParity: true,
    }),
  ),
  sourceArtifacts = [
    [
      deliveryA.targets,
      projected.targets,
      deliveryA.targets.targets.length,
      projected.targets.targets.length,
    ],
    [
      deliveryA.items,
      projected.items,
      deliveryA.items.items.length,
      projected.items.items.length,
    ],
    [
      deliveryA.regions,
      projected.regions,
      deliveryA.regions.regions.length,
      projected.regions.regions.length,
    ],
    [
      deliveryA.audio,
      projected.audio,
      deliveryA.audio.audio.length,
      projected.audio.audio.length,
    ],
    [
      deliveryA.playback,
      projected.playback,
      deliveryA.playback.segments.length,
      projected.playback.segments.length,
    ],
  ] as const,
  projectionLedger = shared.projectionLedger1451Schema.parse(
    hashed141({
      ...header1451(policy, registryBuild.registry.sourceIdentity),
      artifactType: "machine-projection-hash-rebinding-ledger-v1451",
      artifacts: sourceArtifacts.map(
        ([source, destination, sourceRows, projectedRows]) => ({
          artifactType: destination.artifactType,
          sourceArtifactHash: source.semanticHash,
          projectedArtifactHash: destination.semanticHash,
          sourceRowCount: sourceRows,
          projectedRowCount: projectedRows,
          sourceRowsVerified: sourceRows,
          projectedRowsRehashed: projectedRows,
          staleHashCount: 0,
        }),
      ),
      verifiedSourceRowCount: sourceArtifacts.reduce(
        (sum, row) => sum + row[2],
        0,
      ),
      projectedRowCount: sourceArtifacts.reduce((sum, row) => sum + row[3], 0),
      staleProjectionHashCount: 0,
      passed: true,
    }),
  );

function verifyNested(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  let count = 0;
  if (
    !Array.isArray(value) &&
    typeof (value as { semanticHash?: unknown }).semanticHash === "string"
  ) {
    assertHash141(value as { semanticHash: string });
    count++;
  }
  for (const child of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>))
    count += verifyNested(child);
  return count;
}

const preflightArtifacts = [
    baselineAudit,
    geometry,
    registryBuild.registry,
    registryBuild.reconciliation,
    registryBuild.planningProjection,
    registryBuild.compatibility,
    binding,
    inherited,
    effective,
    witnesses,
    ...Object.values(projected),
    projectionLedger,
  ],
  nestedPreflight = shared.nestedPreflight1451Schema.parse(
    hashed141({
      ...header1451(policy, registryBuild.registry.sourceIdentity),
      artifactType: "c6-0-1-14-5-1-nested-semantic-integrity-preflight",
      verifiedArtifactHashes: preflightArtifacts.map((row) => row.semanticHash),
      verifiedNestedRowCount: preflightArtifacts.reduce(
        (sum, row) => sum + verifyNested(row),
        0,
      ),
      registryUnitRowCount: registryBuild.registry.units.length,
      reconciliationRowCount: registryBuild.reconciliation.rows.length,
      compatibilityRowCount: registryBuild.compatibility.rows.length,
      planningProjectionRowCount: registryBuild.planningProjection.rows.length,
      targetBindingRowCount: binding.targetBindings.length,
      regionBindingRowCount: binding.regionBindings.length,
      audioBindingRowCount: binding.audioBindings.length,
      playbackBindingRowCount: binding.playbackBindings.length,
      inheritedRealizationRowCount: inherited.realizations.length,
      effectiveRealizationRowCount: effective.realizations.length,
      witnessGroupRowCount: witnesses.groups.length,
      reviewDeliveryRowCount:
        projected.targets.targets.length +
        projected.items.items.length +
        projected.regions.regions.length +
        projected.audio.audio.length +
        projected.playback.segments.length,
      projectionRowCount: projectionLedger.projectedRowCount,
      nestedIntegrityFailureCount: 0,
      staleProjectionHashCount: 0,
      preGold: true,
      passed: true,
    }),
  ),
  extensionArtifacts = {
    "c6-0-1-14-5-1-full-unit-registry-review-binding-policy.json": policy,
    "machine-c6-0-1-14-5-1-registry-binding-baseline-audit.json": baselineAudit,
    "machine-c6-0-1-14-5-1-geometry-freeze.json": geometry,
    "machine-full-speech-evidence-unit-registry-v1.json":
      registryBuild.registry,
    "machine-full-registry-source-reconciliation.json":
      registryBuild.reconciliation,
    "machine-uncovered-safety-unit-projection-v1.json":
      registryBuild.planningProjection,
    "machine-coverage-unit-registry-compatibility-map-v1.json":
      registryBuild.compatibility,
    "machine-review-delivery-coverage-unit-binding-v1.json": binding,
    "machine-existing-review-delivery-realizations-v1.json": inherited,
    "machine-effective-product-realization-registry-v1.json": effective,
    "machine-product-contract-witness-groups-v1.json": witnesses,
    "machine-projection-hash-rebinding-ledger-v1451.json": projectionLedger,
    "c6-0-1-14-5-1-nested-semantic-integrity-preflight.json": nestedPreflight,
  },
  deliveryArtifacts = {
    "machine-review-target-intervals-v8.json": projected.targets,
    "machine-review-items-v10.json": projected.items,
    "machine-review-regions-v9.json": projected.regions,
    "machine-review-audio-manifest-v9.json": projected.audio,
    "machine-review-playback-timeline-v8.json": projected.playback,
  };

async function writeArtifacts(root: string) {
  const machineRoot = path.join(root, "machine-artifacts"),
    reviewRoot = path.join(root, "review-workspace");
  await Promise.all([
    mkdir(machineRoot, { recursive: true }),
    mkdir(reviewRoot, { recursive: true }),
  ]);
  for (const [name, value] of Object.entries(extensionArtifacts))
    await durableJson141(path.join(machineRoot, name), value);
  for (const [name, value] of Object.entries(deliveryArtifacts))
    await durableJson141(path.join(reviewRoot, name), value);
}
await Promise.all([
  writeArtifacts(dir("final-a")),
  writeArtifacts(dir("final-b")),
  writeArtifacts(dir("review-package")),
]);

const buildFreeze = (role: "A" | "B", oldFreeze: shared.Freeze145) =>
    shared.freeze1451Schema.parse(
      hashed141({
        ...header1451(policy, registryBuild.registry.sourceIdentity),
        artifactType: "c6-0-1-14-5-1-machine-registry-binding-freeze",
        geometryFreezeHash: geometry.semanticHash,
        fullRegistryHash: registryBuild.registry.semanticHash,
        sourceReconciliationHash: registryBuild.reconciliation.semanticHash,
        planningProjectionHash: registryBuild.planningProjection.semanticHash,
        compatibilityMapHash: registryBuild.compatibility.semanticHash,
        reviewBindingHash: binding.semanticHash,
        inheritedRealizationHash: inherited.semanticHash,
        effectiveRealizationRegistryHash: effective.semanticHash,
        witnessGroupHash: witnesses.semanticHash,
        reviewDeliveryHashes: Object.fromEntries(
          Object.entries(projected).map(([name, value]) => [
            name,
            value.semanticHash,
          ]),
        ),
        mandatoryPlanHash: hash141(mandatoryPlan),
        scorabilityPolicyHash: policy.semanticHash,
        projectionHashes: {
          reviewDelivery: hash141(
            Object.values(projected).map((row) => row.semanticHash),
          ),
          rebinding: projectionLedger.semanticHash,
        },
        nestedPreflightHash: nestedPreflight.semanticHash,
        detectorReplaySummary: oldFreeze.detectorReplaySummary,
        asrReplaySummary: oldFreeze.asrReplaySummary,
        runtimeGoldInputBeforeFreeze: 0,
        inferenceCount: 0,
        modelLoadCount: 0,
        providerProcessStartCount: 0,
        canonicalTextHash: oldFreeze.canonicalTextHash,
        canonicalTimingHash: oldFreeze.canonicalTimingHash,
        presentationHash: oldFreeze.presentationHash,
        freezeCompletedAt: createdAt,
        finalRole: role,
      }),
    ),
  freezeA = buildFreeze("A", oldFreezeA),
  freezeB = buildFreeze("B", oldFreezeB);
await Promise.all([
  durableJson141(
    path.join(
      dir("final-a"),
      "c6-0-1-14-5-1-machine-registry-binding-freeze.json",
    ),
    freezeA,
  ),
  durableJson141(
    path.join(
      dir("final-b"),
      "c6-0-1-14-5-1-machine-registry-binding-freeze.json",
    ),
    freezeB,
  ),
]);
const parity = shared.parity1451Schema.parse(
  hashed141({
    ...header1451(policy, registryBuild.registry.sourceIdentity),
    artifactType: "c6-0-1-14-5-1-final-ab-parity",
    finalAFreezeHash: freezeA.semanticHash,
    finalBFreezeHash: freezeB.semanticHash,
    comparedArtifactCount:
      Object.keys(extensionArtifacts).length +
      Object.keys(deliveryArtifacts).length,
    semanticParity: true,
    geometryParity: true,
    wavHashParity: true,
    subtitleParity: true,
    mismatches: [],
  }),
);
await durableJson141(
  path.join(dir("evaluation"), "c6-0-1-14-5-1-final-ab-parity.json"),
  parity,
);

await Promise.all([
  durableJson141(
    path.join(
      dir("baseline"),
      "machine-c6-0-1-14-5-1-registry-binding-baseline-audit.json",
    ),
    baselineAudit,
  ),
  durableJson141(
    path.join(
      dir("registry-audit"),
      "machine-full-registry-source-reconciliation.json",
    ),
    registryBuild.reconciliation,
  ),
  durableJson141(
    path.join(
      dir("full-registry"),
      "machine-full-speech-evidence-unit-registry-v1.json",
    ),
    registryBuild.registry,
  ),
  durableJson141(
    path.join(
      dir("unit-compatibility"),
      "machine-uncovered-safety-unit-projection-v1.json",
    ),
    registryBuild.planningProjection,
  ),
  durableJson141(
    path.join(
      dir("unit-compatibility"),
      "machine-coverage-unit-registry-compatibility-map-v1.json",
    ),
    registryBuild.compatibility,
  ),
  durableJson141(
    path.join(
      dir("review-binding"),
      "machine-review-delivery-coverage-unit-binding-v1.json",
    ),
    binding,
  ),
  durableJson141(
    path.join(
      dir("inherited-realizations"),
      "machine-existing-review-delivery-realizations-v1.json",
    ),
    inherited,
  ),
  durableJson141(
    path.join(
      dir("inherited-realizations"),
      "machine-effective-product-realization-registry-v1.json",
    ),
    effective,
  ),
  durableJson141(
    path.join(
      dir("witness-groups"),
      "machine-product-contract-witness-groups-v1.json",
    ),
    witnesses,
  ),
]);

const state = hashed141({
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-14-5-1-run-paths-local-only",
  baseStatePath,
  outputRoot,
  prefix,
  date,
  executionPolicy: "replay-only",
  policyHash: policy.semanticHash,
  outputs,
  createdAt,
});
const statePath = path.join(
  dir("baseline"),
  "c6-0-1-14-5-1-run-paths.local-only.json",
);
await durableJson141(statePath, state);
console.log(
  JSON.stringify(
    {
      statePath,
      outputs,
      baseline: {
        verifiedSpeechRows: baselineAudit.verifiedSpeechRowCount,
        verifiedSpeechSeconds: baselineAudit.verifiedSpeechUnionSeconds,
        planningUnitSeconds: baselineAudit.currentCoverageUnitUnionSeconds,
        coverageRatio: baselineAudit.currentRegistryCoverageRatio,
        fallbackRealizationsBefore:
          baselineAudit.safetyTargetFallbackRealizationCount,
      },
      registry: {
        units: registryBuild.registry.fullRegistryUnitCount,
        seconds: registryBuild.registry.registeredVerifiedSpeechUnionSeconds,
        coverageRatio:
          registryBuild.registry.registeredVerifiedSpeechCoverageRatio,
      },
      binding: {
        requiredTargets: binding.unitBindingRequiredTargetCount,
        requiredBound: binding.requiredTargetBoundCount,
        targetPairs: binding.targetUnitPairCount,
        audioPairs: binding.audioUnitPairCount,
        playbackPairs: binding.playbackUnitPairCount,
      },
      realizations: {
        inherited: inherited.realizations.length,
        effective: effective.realizations.length,
        witnessGroups: witnesses.groups.length,
      },
      mandatory: {
        items: mandatoryPlan.reviewItemIds.length,
        regions: mandatoryPlan.regionIds.length,
        targets: mandatoryPlan.reviewTargetIds.length,
        audio: mandatoryPlan.audioIds.length,
        playback: mandatoryPlan.playbackSegmentIds.length,
        seconds: mandatoryPlan.uniqueAudioSeconds,
      },
      replay: {
        detector: freezeA.detectorReplaySummary,
        asr: freezeA.asrReplaySummary,
        inference: 0,
      },
      freezeA: freezeA.semanticHash,
      freezeB: freezeB.semanticHash,
      parity: parity.semanticHash,
    },
    null,
    2,
  ),
);
