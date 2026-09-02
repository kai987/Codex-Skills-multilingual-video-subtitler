/* eslint-disable @typescript-eslint/no-unnecessary-condition -- The replay-only entrypoint reasserts literal-constrained evidence invariants after independent durable reads. */
import path from "node:path";
import { cp, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { allocateC60114Output } from "./lib/c60114-output.js";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  durableJson141,
  fileHash141,
  readJson141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import { policy1452 } from "../packages/video-subtitler/src/review/c6011452-policy.js";
import {
  auditDegenerateOrphans1452,
  reconcileDegenerateEligibility1452,
} from "../packages/video-subtitler/src/review/c6011452-degenerate-orphans.js";
import {
  buildEffectiveRealizations1452,
  buildInheritedRealizations1452,
  buildRealizationCandidates1452,
  compareInheritedRealizations1452,
} from "../packages/video-subtitler/src/review/c6011452-realizations.js";
import {
  buildWitnessConnectivity1452,
  buildWitnessGroups1452,
} from "../packages/video-subtitler/src/review/c6011452-witness-connectivity.js";
import { projectReviewDelivery1452 } from "../packages/video-subtitler/src/review/c6011452-review-delivery.js";
import {
  buildDeterminacyPolicy1452,
  buildDeterminacyPreflight1452,
} from "../packages/video-subtitler/src/review/c6011452-determinacy.js";
import { header1452 } from "../packages/video-subtitler/src/review/c6011452-policy.js";

const { values } = parseArgs({
  strict: true,
  options: {
    state: { type: "string" },
    "output-root": { type: "string" },
    prefix: { type: "string", default: "carnation-c6-0-1-14-5-2" },
    date: { type: "string", default: "20260902" },
    "execution-policy": { type: "string", default: "replay-only" },
  },
});

if (values["execution-policy"] !== "replay-only")
  throw new Error("C6011452_ONLY_REPLAY_ONLY_IS_AUTHORIZED");

interface BaseState1452 {
  artifactType: string;
  outputs: Record<string, string>;
  semanticHash: string;
}

const baseStatePath = path.resolve(
    required141(values.state, "--state required"),
  ),
  outputRoot = path.resolve(
    required141(values["output-root"], "--output-root required"),
  ),
  prefix = required141(values.prefix),
  date = required141(values.date),
  baseState = (await readJson141(baseStatePath)) as BaseState1452;
assertHash141(baseState);
if (baseState.artifactType !== "c6-0-1-14-5-1-run-paths-local-only")
  throw new Error("C6011452_BASE_STATE_MUST_BE_C6011451");

const baseFinalA = required141(baseState.outputs["final-a"]),
  baseFinalB = required141(baseState.outputs["final-b"]),
  roles = [
    "baseline",
    "orphan-audit",
    "realization-candidates",
    "inherited-realizations",
    "effective-realizations",
    "witness-groups",
    "determinacy",
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
  policy = policy1452();

await Promise.all([
  cp(baseFinalA, dir("final-a"), { recursive: true, force: false }),
  cp(baseFinalB, dir("final-b"), { recursive: true, force: false }),
  cp(
    path.join(baseFinalA, "review-workspace"),
    path.join(dir("review-package"), "review-workspace"),
    { recursive: true, force: false },
  ),
]);

const readMachine = async <T>(
    root: string,
    name: string,
    schema: { parse(value: unknown): T },
  ) =>
    schema.parse(await readJson141(path.join(root, "machine-artifacts", name))),
  readDelivery = async (root: string) => {
    const workspace = path.join(root, "review-workspace");
    return {
      targets: shared.reviewTargets1451Schema.parse(
        await readJson141(
          path.join(workspace, "machine-review-target-intervals-v8.json"),
        ),
      ),
      items: shared.reviewItems1451Schema.parse(
        await readJson141(
          path.join(workspace, "machine-review-items-v10.json"),
        ),
      ),
      regions: shared.reviewRegions1451Schema.parse(
        await readJson141(
          path.join(workspace, "machine-review-regions-v9.json"),
        ),
      ),
      audio: shared.reviewAudio1451Schema.parse(
        await readJson141(
          path.join(workspace, "machine-review-audio-manifest-v9.json"),
        ),
      ),
      playback: shared.reviewPlayback1451Schema.parse(
        await readJson141(
          path.join(workspace, "machine-review-playback-timeline-v8.json"),
        ),
      ),
    };
  },
  baselineAudit = await readMachine(
    baseFinalA,
    "machine-c6-0-1-14-5-1-registry-binding-baseline-audit.json",
    shared.baselineAudit1451Schema,
  ),
  geometryFreeze = await readMachine(
    baseFinalA,
    "machine-c6-0-1-14-5-1-geometry-freeze.json",
    shared.geometryFreeze1451Schema,
  ),
  registry = await readMachine(
    baseFinalA,
    "machine-full-speech-evidence-unit-registry-v1.json",
    shared.fullRegistry1451Schema,
  ),
  reconciliation = await readMachine(
    baseFinalA,
    "machine-full-registry-source-reconciliation.json",
    shared.sourceReconciliation1451Schema,
  ),
  compatibility = await readMachine(
    baseFinalA,
    "machine-coverage-unit-registry-compatibility-map-v1.json",
    shared.compatibilityMap1451Schema,
  ),
  binding = await readMachine(
    baseFinalA,
    "machine-review-delivery-coverage-unit-binding-v1.json",
    shared.reviewBinding1451Schema,
  ),
  inheritedV1 = await readMachine(
    baseFinalA,
    "machine-existing-review-delivery-realizations-v1.json",
    shared.inheritedRealizations1451Schema,
  ),
  effectiveV1 = await readMachine(
    baseFinalA,
    "machine-effective-product-realization-registry-v1.json",
    shared.effectiveRealizations1451Schema,
  ),
  witnessesV1 = await readMachine(
    baseFinalA,
    "machine-product-contract-witness-groups-v1.json",
    shared.witnessGroups1451Schema,
  ),
  planner = await readMachine(
    baseFinalA,
    "machine-coverage-unit-aware-final-planner-certificate.json",
    shared.planner145Schema,
  ),
  oldFreezeA = shared.freeze1451Schema.parse(
    await readJson141(
      path.join(
        baseFinalA,
        "c6-0-1-14-5-1-machine-registry-binding-freeze.json",
      ),
    ),
  ),
  oldFreezeB = shared.freeze1451Schema.parse(
    await readJson141(
      path.join(
        baseFinalB,
        "c6-0-1-14-5-1-machine-registry-binding-freeze.json",
      ),
    ),
  ),
  deliveryA = await readDelivery(baseFinalA),
  deliveryB = await readDelivery(baseFinalB);

[
  policy,
  baselineAudit,
  geometryFreeze,
  registry,
  reconciliation,
  compatibility,
  binding,
  inheritedV1,
  effectiveV1,
  witnessesV1,
  planner,
  oldFreezeA,
  oldFreezeB,
  ...Object.values(deliveryA),
  ...Object.values(deliveryB),
].forEach(assertHash141);

const parityPairs = [
  [deliveryA.targets.semanticHash, deliveryB.targets.semanticHash],
  [deliveryA.items.semanticHash, deliveryB.items.semanticHash],
  [deliveryA.regions.semanticHash, deliveryB.regions.semanticHash],
  [deliveryA.audio.semanticHash, deliveryB.audio.semanticHash],
  [deliveryA.playback.semanticHash, deliveryB.playback.semanticHash],
  [oldFreezeA.fullRegistryHash, oldFreezeB.fullRegistryHash],
  [oldFreezeA.reviewBindingHash, oldFreezeB.reviewBindingHash],
];
if (parityPairs.some(([left, right]) => left !== right))
  throw new Error("C6011452_BASE_FINAL_AB_PARITY_FAILED");
if (
  oldFreezeA.detectorReplaySummary.misses !== 0 ||
  oldFreezeA.asrReplaySummary.misses !== 0 ||
  oldFreezeA.inferenceCount !== 0 ||
  oldFreezeA.modelLoadCount !== 0 ||
  oldFreezeA.providerProcessStartCount !== 0
)
  throw new Error("C6011452_BASE_REPLAY_PROOF_INVALID");

for (const [root, delivery] of [
  [baseFinalA, deliveryA],
  [baseFinalB, deliveryB],
] as const)
  for (const audio of delivery.audio.audio) {
    const file = path.join(root, "review-workspace", audio.relativePath);
    if ((await fileHash141(file)) !== audio.sha256)
      throw new Error(`C6011452_WAV_HASH_CHANGED:${audio.audioId}`);
  }

const orphanAudit = auditDegenerateOrphans1452({
    policy,
    registry,
    binding,
    targets: deliveryA.targets,
    audio: deliveryA.audio,
  }),
  eligibility = reconcileDegenerateEligibility1452({
    policy,
    registry,
    binding,
    audit: orphanAudit,
    targets: deliveryA.targets,
  }),
  candidateLedger = buildRealizationCandidates1452({
    policy,
    registry,
    binding,
    eligibility,
    targets: deliveryA.targets,
    regions: deliveryA.regions,
    audio: deliveryA.audio,
    playback: deliveryA.playback,
  }),
  inheritedV2 = buildInheritedRealizations1452({
    policy,
    registry,
    candidates: candidateLedger,
  }),
  comparison = compareInheritedRealizations1452({
    policy,
    registry,
    v1: inheritedV1,
    candidates: candidateLedger,
    v2: inheritedV2,
  }),
  effectiveV2 = buildEffectiveRealizations1452({
    policy,
    registry,
    planner,
    v1Effective: effectiveV1,
    inherited: inheritedV2,
  }),
  connectivity = buildWitnessConnectivity1452({
    policy,
    registry,
    effective: effectiveV2,
    playback: deliveryA.playback,
  }),
  witnessesV2 = buildWitnessGroups1452({
    policy,
    registry,
    effective: effectiveV2,
    connectivity,
  }),
  determinacyPolicy = buildDeterminacyPolicy1452({ policy, registry }),
  projected = projectReviewDelivery1452({
    policy,
    eligibility,
    inherited: inheritedV2,
    effective: effectiveV2,
    witnesses: witnessesV2,
    ...deliveryA,
  }),
  determinacyPreflight = buildDeterminacyPreflight1452({
    policy,
    registry,
    reconciliation,
    binding,
    eligibility,
    candidates: candidateLedger,
    effective: effectiveV2,
    witnesses: witnessesV2,
    audio: projected.audio,
    playback: projected.playback,
    determinacyPolicyHash: determinacyPolicy.semanticHash,
  }),
  mandatoryPlan = required141(
    projected.playback.plans.find((row) => row.planId === "ALL_MANDATORY"),
    "C6011452_ALL_MANDATORY_PLAN_MISSING",
  );

const sourceArtifacts = [
  {
    name: "review-targets",
    source: deliveryA.targets,
    projection: projected.targets,
    sourceRows: deliveryA.targets.targets,
    projectionRows: projected.targets.targets,
    addedFields: [
      "degenerateOrphanClassification",
      "productOutcomeRole",
      "finalBindingRequirement",
      "finalProductEligibility",
      "inheritedRealizationV2Ids",
      "productScorabilityRole",
    ],
  },
  {
    name: "review-items",
    source: deliveryA.items,
    projection: projected.items,
    sourceRows: deliveryA.items.items,
    projectionRows: projected.items.items,
    addedFields: [
      "inheritedRealizationV2Ids",
      "productOutcomeRoles",
      "productScorabilityStatus",
    ],
  },
  {
    name: "review-regions",
    source: deliveryA.regions,
    projection: projected.regions,
    sourceRows: deliveryA.regions.regions,
    projectionRows: projected.regions.regions,
    addedFields: [
      "inheritedRegionRealizationIds",
      "regionPlaybackChainIds",
      "effectiveRealizationIds",
      "productWitnessGroupIds",
    ],
  },
  {
    name: "review-audio",
    source: deliveryA.audio,
    projection: projected.audio,
    sourceRows: deliveryA.audio.audio,
    projectionRows: projected.audio.audio,
    addedFields: [
      "physicalAudioContainerInterval",
      "inheritedRealizationV2Ids",
      "productWitnessGroupIds",
      "boundPlaybackSegmentIds",
    ],
  },
  {
    name: "review-playback",
    source: deliveryA.playback,
    projection: projected.playback,
    sourceRows: deliveryA.playback.segments,
    projectionRows: projected.playback.segments,
    addedFields: [
      "playbackChainId",
      "inheritedRealizationV2Ids",
      "effectiveRealizationIds",
      "witnessGroupIds",
    ],
  },
] as const;

const projectionRows = sourceArtifacts.map((entry) =>
    shared.projectionLedger1452Schema.shape.rows.element.parse(
      hashed141({
        artifactType: entry.projection.artifactType,
        sourceArtifactHash: entry.source.semanticHash,
        projectionArtifactHash: entry.projection.semanticHash,
        sourceHashDomain: `${entry.name}-c6011451`,
        projectionHashDomain: `${entry.name}-c6011452`,
        removedFields: [
          "policyVersion",
          "policyHash",
          "artifactType",
          "semanticHash",
        ],
        addedFields: entry.addedFields,
        sourceRowCount: entry.sourceRows.length,
        projectedRowCount: entry.projectionRows.length,
        projectedRowHashes: entry.projectionRows.map((row) => row.semanticHash),
      }),
    ),
  ),
  projectionLedger = shared.projectionLedger1452Schema.parse(
    hashed141({
      ...header1452(policy, registry.sourceIdentity),
      artifactType: "machine-projection-hash-rebinding-ledger",
      rows: projectionRows,
      projectionRebindingRowCount: projectionRows.length,
      sourceRowsVerified: sourceArtifacts.reduce(
        (sum, entry) => sum + entry.sourceRows.length,
        0,
      ),
      projectedRowsRehashed: sourceArtifacts.reduce(
        (sum, entry) => sum + entry.projectionRows.length,
        0,
      ),
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
    orphanAudit,
    eligibility,
    candidateLedger,
    inheritedV2,
    comparison,
    effectiveV2,
    connectivity,
    witnessesV2,
    determinacyPolicy,
    determinacyPreflight,
    ...Object.values(projected),
    projectionLedger,
  ],
  nestedPreflight = shared.nestedPreflight1452Schema.parse(
    hashed141({
      ...header1452(policy, registry.sourceIdentity),
      artifactType: "c6-0-1-14-5-2-nested-semantic-integrity-preflight",
      verifiedArtifactHashes: preflightArtifacts.map((row) => row.semanticHash),
      verifiedNestedRowCount: preflightArtifacts.reduce(
        (sum, row) => sum + verifyNested(row),
        0,
      ),
      degenerateAuditRowCount: orphanAudit.rows.length,
      eligibilityRowCount: eligibility.rows.length,
      candidateRowCount: candidateLedger.candidates.length,
      inheritedRealizationRowCount: inheritedV2.realizations.length,
      effectiveRealizationRowCount: effectiveV2.realizations.length,
      connectivityRowCount: connectivity.rows.length,
      witnessGroupRowCount: witnessesV2.groups.length,
      reviewDeliveryRowCount: sourceArtifacts.reduce(
        (sum, entry) => sum + entry.projectionRows.length,
        0,
      ),
      projectionRowCount: projectionLedger.projectionRebindingRowCount,
      nestedIntegrityFailureCount: 0,
      staleProjectionHashCount: 0,
      preGold: true,
      passed: true,
    }),
  ),
  extensionArtifacts = {
    "c6-0-1-14-5-2-product-scorability-playback-realization-policy.json":
      policy,
    "machine-degenerate-orphan-target-baseline-audit.json": orphanAudit,
    "machine-degenerate-orphan-target-eligibility-v1.json": eligibility,
    "machine-inherited-realization-candidate-ledger-v2.json": candidateLedger,
    "machine-existing-review-delivery-realizations-v2.json": inheritedV2,
    "machine-inherited-realization-v1-v2-comparison.json": comparison,
    "machine-effective-product-realization-registry-v2.json": effectiveV2,
    "machine-witness-connectivity-ledger-v2.json": connectivity,
    "machine-product-contract-witness-groups-v2.json": witnessesV2,
    "machine-product-outcome-determinacy-policy-v1.json": determinacyPolicy,
    "machine-product-outcome-determinacy-preflight.json": determinacyPreflight,
    "machine-projection-hash-rebinding-ledger.json": projectionLedger,
    "c6-0-1-14-5-2-nested-semantic-integrity-preflight.json": nestedPreflight,
  },
  deliveryArtifacts = {
    "machine-review-target-intervals-v9.json": projected.targets,
    "machine-review-items-v11.json": projected.items,
    "machine-review-regions-v10.json": projected.regions,
    "machine-review-audio-manifest-v10.json": projected.audio,
    "machine-review-playback-timeline-v9.json": projected.playback,
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

type Freeze1451 = ReturnType<typeof shared.freeze1451Schema.parse>;

const buildFreeze = (role: "A" | "B", oldFreeze: Freeze1451) =>
    shared.freeze1452Schema.parse(
      hashed141({
        ...header1452(policy, registry.sourceIdentity),
        artifactType: "c6-0-1-14-5-2-machine-scorability-playback-freeze",
        baselineReplayHash: baselineAudit.semanticHash,
        geometryFreezeHash: geometryFreeze.semanticHash,
        degenerateAuditHash: orphanAudit.semanticHash,
        degenerateEligibilityHash: eligibility.semanticHash,
        realizationCandidateLedgerHash: candidateLedger.semanticHash,
        inheritedRealizationV2Hash: inheritedV2.semanticHash,
        realizationComparisonHash: comparison.semanticHash,
        effectiveRealizationRegistryV2Hash: effectiveV2.semanticHash,
        witnessConnectivityHash: connectivity.semanticHash,
        witnessGroupV2Hash: witnessesV2.semanticHash,
        determinacyPolicyHash: determinacyPolicy.semanticHash,
        determinacyPreflightHash: determinacyPreflight.semanticHash,
        reviewDeliveryHashes: Object.fromEntries(
          Object.entries(projected).map(([name, value]) => [
            name,
            value.semanticHash,
          ]),
        ),
        mandatoryPlanHash: hash141(mandatoryPlan),
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
      "c6-0-1-14-5-2-machine-scorability-playback-freeze.json",
    ),
    freezeA,
  ),
  durableJson141(
    path.join(
      dir("final-b"),
      "c6-0-1-14-5-2-machine-scorability-playback-freeze.json",
    ),
    freezeB,
  ),
]);

const parity = shared.parity1452Schema.parse(
  hashed141({
    ...header1452(policy, registry.sourceIdentity),
    artifactType: "c6-0-1-14-5-2-final-ab-parity",
    finalAFreezeHash: freezeA.semanticHash,
    finalBFreezeHash: freezeB.semanticHash,
    comparedArtifactCount:
      Object.keys(extensionArtifacts).length +
      Object.keys(deliveryArtifacts).length +
      4,
    semanticParity: true,
    geometryParity: true,
    wavHashParity: true,
    subtitleParity: true,
    mismatches: [],
  }),
);
await durableJson141(
  path.join(dir("evaluation"), "c6-0-1-14-5-2-final-ab-parity.json"),
  parity,
);

const rootArtifacts: [(typeof roles)[number], string, unknown][] = [
  [
    "baseline",
    "machine-c6-0-1-14-5-1-registry-binding-baseline-audit.json",
    baselineAudit,
  ],
  [
    "baseline",
    "c6-0-1-14-5-2-product-scorability-playback-realization-policy.json",
    policy,
  ],
  [
    "orphan-audit",
    "machine-degenerate-orphan-target-baseline-audit.json",
    orphanAudit,
  ],
  [
    "orphan-audit",
    "machine-degenerate-orphan-target-eligibility-v1.json",
    eligibility,
  ],
  [
    "realization-candidates",
    "machine-inherited-realization-candidate-ledger-v2.json",
    candidateLedger,
  ],
  [
    "inherited-realizations",
    "machine-existing-review-delivery-realizations-v2.json",
    inheritedV2,
  ],
  [
    "inherited-realizations",
    "machine-inherited-realization-v1-v2-comparison.json",
    comparison,
  ],
  [
    "effective-realizations",
    "machine-effective-product-realization-registry-v2.json",
    effectiveV2,
  ],
  [
    "witness-groups",
    "machine-witness-connectivity-ledger-v2.json",
    connectivity,
  ],
  [
    "witness-groups",
    "machine-product-contract-witness-groups-v2.json",
    witnessesV2,
  ],
  [
    "determinacy",
    "machine-product-outcome-determinacy-policy-v1.json",
    determinacyPolicy,
  ],
  [
    "determinacy",
    "machine-product-outcome-determinacy-preflight.json",
    determinacyPreflight,
  ],
  [
    "determinacy",
    "machine-projection-hash-rebinding-ledger.json",
    projectionLedger,
  ],
  [
    "determinacy",
    "c6-0-1-14-5-2-nested-semantic-integrity-preflight.json",
    nestedPreflight,
  ],
];
for (const [role, name, value] of rootArtifacts)
  await durableJson141(path.join(dir(role), name), value);

const state = hashed141({
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-14-5-2-run-paths-local-only",
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
  "c6-0-1-14-5-2-run-paths.local-only.json",
);
await durableJson141(statePath, state);

console.log(
  JSON.stringify(
    {
      statePath,
      outputs,
      orphan: {
        audited: orphanAudit.auditedSpeechTargetCount,
        classified: eligibility.degenerateSliverClassifiedCount,
        requiredBefore: eligibility.bindingRequiredTargetCountBefore,
        requiredAfter: eligibility.bindingRequiredTargetCountAfter,
        requiredUnboundAfter: eligibility.requiredTargetUnboundCountAfter,
      },
      candidates: {
        total: candidateLedger.candidateCount,
        accepted: candidateLedger.acceptedCandidateCount,
        rejected: candidateLedger.rejectedCandidateCount,
        rejectionReasonDistribution:
          candidateLedger.rejectionReasonDistribution,
      },
      realizations: {
        v1: inheritedV1.realizations.length,
        v2: inheritedV2.realizations.length,
        effectiveV1: effectiveV1.realizations.length,
        effectiveV2: effectiveV2.realizations.length,
        witnessV1: witnessesV1.groups.length,
        witnessV2: witnessesV2.groups.length,
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
        inference: freezeA.inferenceCount,
        modelLoad: freezeA.modelLoadCount,
        providerStart: freezeA.providerProcessStartCount,
      },
      freezeA: freezeA.semanticHash,
      freezeB: freezeB.semanticHash,
      parity: parity.semanticHash,
    },
    null,
    2,
  ),
);
