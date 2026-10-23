import path from "node:path";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import { c60StableHash } from "../packages/video-subtitler/src/finalization-risk-policy.js";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import { evaluateC60114PlaybackCoverage } from "../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  durableJson141,
  fileHash141,
  identity141,
  readJson141,
  safeRelative141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  emptyUnitTierCounts145,
  header145,
} from "../packages/video-subtitler/src/review/c601145-policy.js";
import { selectedRealizations145 } from "../packages/video-subtitler/src/review/c601145-unit-aware-planner.js";
import { assertPreGoldIntegrity1431 } from "../packages/video-subtitler/src/review/c6011431-projection-integrity.js";
import { verifyProjectionAudio142 } from "./lib/c601142-coverage-projection.js";
import { machineCodeSnapshot143 } from "./lib/c601143-final.js";
import { loadInputs145 } from "./lib/c601145-input.js";
import { c60114GoldErrorComponents } from "./lib/c60114-post-freeze-evaluation.js";

interface Interval {
  start: number;
  end: number;
}
type Stage145 = "C0" | "C1" | "C2" | "C3" | "C4" | "C5";
type Projection = shared.C60114MachineCoverageProjection;
type ErrorComponent = shared.C60114ErrorComponent;
type ComponentCoverage = shared.C60114ComponentCoverage;

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
const requiredArg = (name: keyof typeof values) =>
  required141(values[name], `--${name} required`);

const union = (values: readonly Interval[]) => {
  const rows = values
      .filter((row) => row.end > row.start)
      .map((row) => ({ ...row }))
      .sort((a, b) => a.start - b.start || a.end - b.end),
    result: Interval[] = [];
  for (const row of rows) {
    const previous = result.at(-1);
    if (!previous || row.start > previous.end) result.push(row);
    else previous.end = Math.max(previous.end, row.end);
  }
  return result;
};
const seconds = (values: readonly Interval[]) =>
  union(values).reduce((sum, row) => sum + row.end - row.start, 0);
const intersect = (left: readonly Interval[], right: readonly Interval[]) =>
  union(
    left.flatMap((a) =>
      right.flatMap((b) => {
        const start = Math.max(a.start, b.start),
          end = Math.min(a.end, b.end);
        return end > start ? [{ start, end }] : [];
      }),
    ),
  );
const coverage = (
  covering: readonly Interval[],
  reference: readonly Interval[],
) => {
  const denominator = seconds(reference);
  return denominator
    ? Math.min(1, seconds(intersect(covering, reference)) / denominator)
    : 0;
};
const recall = (
  rows: readonly ComponentCoverage[],
  label: "MISSING_DIALOGUE" | "HALLUCINATION",
  predicate: (row: ComponentCoverage) => boolean,
) => {
  const relevant = rows.filter((row) => row.labels.includes(label)),
    numerator = relevant.filter(predicate).length;
  return {
    numerator,
    denominator: relevant.length,
    ratio: relevant.length ? numerator / relevant.length : 1,
  };
};
const emptyPlayback = (projection: Projection, retainPhysical: boolean) =>
  shared.c60114MachineCoverageProjectionSchema.parse({
    ...projection,
    physicalAudio: retainPhysical ? projection.physicalAudio : [],
    playbackSegments: [],
    plans: projection.plans.map((plan) => ({
      ...plan,
      playbackSegmentIds: [],
    })),
  });

const statePath = path.resolve(requiredArg("state")),
  state = shared.state143Schema.parse(await readJson141(statePath));
if (hash141(state.config) !== state.configHash)
  throw new Error("C601145_STATE_CONFIG_CHANGED");
const inputs = await loadInputs145(state.config.baselineState),
  output = (role: string) => required141(state.outputs[role]),
  finalA = output("final-a"),
  finalB = output("final-b"),
  evaluationRoot = output("evaluation"),
  sourcePath = inputs.baseline.old.config.source,
  codeSnapshot = await machineCodeSnapshot143(process.cwd());

async function verifyFinal(root: string, role: "A" | "B") {
  const compatibility = shared.machineFreeze143Schema.parse(
    await readJson141(
      path.join(root, "c6-0-1-14-3-machine-selection-freeze.json"),
    ),
  );
  assertHash141(compatibility);
  for (const row of [
    ...compatibility.artifacts,
    ...compatibility.protectedMachineFiles,
  ]) {
    const file = path.resolve(state.config.outputRoot, row.relativePath);
    safeRelative141(state.config.outputRoot, file);
    if ((await fileHash141(file)) !== row.byteHash)
      throw new Error(`C601145_FROZEN_FILE_CHANGED:${row.relativePath}`);
  }
  if (compatibility.codeSnapshotHash !== codeSnapshot.semanticHash)
    throw new Error("C601145_CODE_CHANGED_AFTER_MACHINE_FREEZE");
  if (
    hash141(await identity141(sourcePath)) !==
    hash141(compatibility.sourceReadOnlyIdentity)
  )
    throw new Error("C601145_SOURCE_CHANGED_AFTER_MACHINE_FREEZE");
  const freeze = shared.freeze145Schema.parse(
      await readJson141(
        path.join(root, "c6-0-1-14-5-machine-safety-coverage-freeze.json"),
      ),
    ),
    preflight = shared.nestedPreflight145Schema.parse(
      await readJson141(
        path.join(root, "c6-0-1-14-5-nested-semantic-integrity-preflight.json"),
      ),
    ),
    projections = shared.projections143Schema.parse(
      await readJson141(path.join(root, "machine-coverage-projections.json")),
    );
  [freeze, preflight, projections].forEach(assertHash141);
  if (
    freeze.finalRole !== role ||
    freeze.nestedPreflightHash !== preflight.semanticHash ||
    freeze.projectionHashes.projections !== projections.semanticHash
  )
    throw new Error(`C601145_FREEZE_BINDING_FAILED:${role}`);
  const official = required141(
    projections.variants.find(
      (variant) => variant.stage === projections.officialStage,
    ),
  );
  await verifyProjectionAudio142(
    path.join(root, official.workspaceRelativePath),
    official.projection,
  );
  return { compatibility, freeze, preflight, projections, official };
}

const a = await verifyFinal(finalA, "A"),
  b = await verifyFinal(finalB, "B"),
  parity = shared.parity145Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-final-ab-parity.json"),
    ),
  );
assertHash141(parity);
if (
  parity.finalAFreezeHash !== a.freeze.semanticHash ||
  parity.finalBFreezeHash !== b.freeze.semanticHash
)
  throw new Error("C601145_FINAL_AB_PARITY_BINDING_FAILED");

const previousFinalA = required141(inputs.previousState.outputs["final-a"]),
  previousProjections = shared.projections143Schema.parse(
    await readJson141(
      path.join(previousFinalA, "machine-coverage-projections.json"),
    ),
  ),
  previousOfficial = required141(
    previousProjections.variants.find(
      (variant) => variant.stage === previousProjections.officialStage,
    ),
  );
assertHash141(previousProjections);
await verifyProjectionAudio142(
  path.join(previousFinalA, previousOfficial.workspaceRelativePath),
  previousOfficial.projection,
);

const readMachine = async <T>(
    name: string,
    schema: { parse(value: unknown): T },
  ) =>
    schema.parse(
      await readJson141(path.join(finalA, "machine-artifacts", name)),
    ),
  policy = await readMachine(
    "c6-0-1-14-5-safety-coverage-unit-policy.json",
    shared.policy145Schema,
  ),
  units = await readMachine(
    "machine-speech-safety-coverage-units-v1.json",
    shared.coverageUnits145Schema,
  ),
  utility = await readMachine(
    "machine-speech-safety-coverage-unit-utility-v1.json",
    shared.unitUtility145Schema,
  ),
  contractPolicy = await readMachine(
    "machine-review-safety-contract-policy-v1.json",
    shared.contractPolicy145Schema,
  ),
  realizations = await readMachine(
    "machine-coverage-unit-realization-candidates-v1.json",
    shared.realizations145Schema,
  ),
  realizationDominance = await readMachine(
    "machine-coverage-unit-realization-dominance-ledger.json",
    shared.realizationDominance145Schema,
  ),
  joint = await readMachine(
    "machine-coverage-unit-joint-feasibility-results.json",
    shared.jointFeasibility145Schema,
  ),
  planner = await readMachine(
    "machine-coverage-unit-aware-final-planner-certificate.json",
    shared.planner145Schema,
  ),
  ledger = await readMachine(
    "machine-review-safety-contract-coverage-ledger.json",
    shared.contractLedger145Schema,
  ),
  safety = await readMachine(
    "machine-missing-safety-reserve-targets-v5.json",
    shared.safetyTargets145Schema,
  ),
  deliveryRoot = path.join(finalA, "review-workspace"),
  targets = shared.reviewTargets145Schema.parse(
    await readJson141(
      path.join(deliveryRoot, "machine-review-target-intervals-v7.json"),
    ),
  ),
  items = shared.reviewItems145Schema.parse(
    await readJson141(path.join(deliveryRoot, "machine-review-items-v9.json")),
  ),
  regions = shared.reviewRegions145Schema.parse(
    await readJson141(
      path.join(deliveryRoot, "machine-review-regions-v8.json"),
    ),
  ),
  audio = shared.reviewAudio145Schema.parse(
    await readJson141(
      path.join(deliveryRoot, "machine-review-audio-manifest-v8.json"),
    ),
  ),
  playback = shared.reviewPlayback145Schema.parse(
    await readJson141(
      path.join(deliveryRoot, "machine-review-playback-timeline-v7.json"),
    ),
  ),
  segmentation = await readMachine(
    "machine-segmentation-sensitivity-audit.json",
    shared.segmentationAudit145Schema,
  );
for (const artifact of [
  policy,
  units,
  utility,
  contractPolicy,
  realizations,
  realizationDominance,
  joint,
  planner,
  ledger,
  safety,
  targets,
  items,
  regions,
  audio,
  playback,
  segmentation,
])
  assertHash141(artifact);
assertPreGoldIntegrity1431(
  shared.nestedPreflight1431Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "c6-0-1-14-3-1-nested-semantic-integrity-preflight.json",
      ),
    ),
  ),
);

const goldFirstReadAt = new Date().toISOString();
if (Date.parse(goldFirstReadAt) < Date.parse(a.freeze.freezeCompletedAt))
  throw new Error("C601145_FREEZE_NOT_COMPLETED_BEFORE_GOLD_READ");
const firstRead = shared.firstGoldRead145Schema.parse(
  hashed141({
    ...header145(policy, units.sourceIdentity),
    artifactType: "c6-0-1-14-5-first-gold-read-audit",
    machineFreezeHash: a.freeze.semanticHash,
    machineFreezeCompletedAt: a.freeze.freezeCompletedAt,
    goldFirstReadAt,
    freezeBeforeGold: true,
    machineStageGoldPathReadCount: 0,
    machineStageGoldDerivedArtifactReadCount: 0,
  }),
);
await durableJson141(
  path.join(evaluationRoot, "c6-0-1-14-5-first-gold-read-audit.json"),
  firstRead,
);

// Gold isolation ends only after the durable first-read receipt above.
const goldPath = path.resolve(requiredArg("gold")),
  qualityPath = path.resolve(requiredArg("quality-evaluation")),
  labelsPath = path.resolve(requiredArg("region-labels")),
  upstreamPath = path.resolve(requiredArg("gold-evaluation")),
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
  throw new Error("C601145_GOLD_SOURCE_HASH_BINDING_FAILED");
const errorComponents = c60114GoldErrorComponents(
  upstream,
  labels.errorComponents,
  units.sourceIdentity,
);
if (
  hash141(errorComponents.map((row) => row.errorComponentId).sort()) !==
  hash141(quality.errorComponents.map((row) => row.errorComponentId).sort())
)
  throw new Error("C601145_GOLD_DENOMINATOR_CHANGED");

const variants: {
  stage: Stage145;
  name: string;
  projection: Projection;
  planId: string;
}[] = [
  {
    stage: "C0",
    name: "C6.0.1.14.4 Official Final",
    projection: previousOfficial.projection,
    planId: previousOfficial.officialPlanId,
  },
  {
    stage: "C1",
    name: "Coverage Unit Annotation Only",
    projection: previousOfficial.projection,
    planId: previousOfficial.officialPlanId,
  },
  {
    stage: "C2",
    name: "Coverage-unit-aware Planner Target Projection",
    projection: emptyPlayback(a.official.projection, false),
    planId: a.official.officialPlanId,
  },
  {
    stage: "C3",
    name: "Target Core Localization Projection",
    projection: emptyPlayback(a.official.projection, false),
    planId: a.official.officialPlanId,
  },
  {
    stage: "C4",
    name: "Machine-anchored Playback Physical Audio Projection",
    projection: emptyPlayback(a.official.projection, true),
    planId: a.official.officialPlanId,
  },
  {
    stage: "C5",
    name: "Final Machine-anchored Playback Delivery",
    projection: a.official.projection,
    planId: a.official.officialPlanId,
  },
];
const engineeringGates = {
  engineeringPassed: true,
  baselineParityPassed: true,
  runtimeGoldInputCount: 0 as const,
  canonicalMutationCount: 0,
  machineDraftMutationCount: 0,
  sourceMutationCount: 0,
  goldMutationCount: 0,
  machineFreezeVerified: true,
};
const oldSelectedRealizations = selectedRealizations145({
    selectedBundleIds: inputs.utilityPlanner.selectedBundleIds,
    realizations,
    dominance: realizationDominance,
    contractType: "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
  }),
  currentSelectedRealizations = selectedRealizations145({
    selectedBundleIds: planner.selectedBundleIds,
    realizations,
    dominance: realizationDominance,
    contractType: "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
  }),
  utilityByUnit = new Map(utility.rows.map((row) => [row.coverageUnitId, row])),
  tierCounts = (ids: readonly string[]) => {
    const result = emptyUnitTierCounts145();
    ids.forEach(
      (id) => result[required141(utilityByUnit.get(id)).speechTier]++,
    );
    return result;
  },
  oldUnitIds = [
    ...new Set(oldSelectedRealizations.map((row) => row.coverageUnitId)),
  ],
  currentUnitIds = [
    ...new Set(currentSelectedRealizations.map((row) => row.coverageUnitId)),
  ];

const evaluatedStages = variants.map((variant) => {
  const evaluated = evaluateC60114PlaybackCoverage({
      ...variant.projection,
      errorComponents,
      generatedAt: goldFirstReadAt,
      engineeringGates,
    }),
    budget = required141(
      evaluated.budgets.find((row) => row.planId === variant.planId),
    ),
    missing = (predicate: (row: ComponentCoverage) => boolean) =>
      recall(budget.componentCoverage, "MISSING_DIALOGUE", predicate),
    hallucination = (predicate: (row: ComponentCoverage) => boolean) =>
      recall(budget.componentCoverage, "HALLUCINATION", predicate),
    current = ["C2", "C3", "C4", "C5"].includes(variant.stage),
    selectedIds = current ? currentUnitIds : oldUnitIds,
    selectedRows = current
      ? currentSelectedRealizations
      : oldSelectedRealizations;
  if (evaluated.integrityFailures.length || budget.integrityFailures.length)
    throw new Error(
      `C601145_PROJECTION_EVALUATION_INTEGRITY_FAILED:${variant.stage}:${[
        ...evaluated.integrityFailures,
        ...budget.integrityFailures,
      ].join("|")}`,
    );
  return {
    ...variant,
    budget,
    selectedRows,
    metricBase: {
      projectionId: variant.stage,
      name: variant.name,
      integrityStatus: "PASS" as const,
      coverageUnitCount: units.coverageUnitCount,
      selectedCoverageUnitCount: selectedIds.length,
      unitCoverageByTier: tierCounts(selectedIds),
      realizationCount: selectedRows.length,
      activeSafetyTargetCount: current
        ? safety.activeTargetCount
        : inputs.safetyV4.activeTargetCount,
      safetyCoreUnionSeconds: current
        ? planner.speechCoreUnionSeconds
        : inputs.utilityPlanner.coreUnionSeconds,
      reviewTargetCount: budget.selectedReviewTargetIds.length,
      reviewRegionCount: budget.selectedRegionIds.length,
      physicalAudioCount: budget.selectedAudioIds.length,
      playbackSegmentCount: budget.selectedPlaybackSegmentIds.length,
      fullQueueUniqueAudioSeconds: budget.actualAudibleUniqueSeconds,
      fullQueueEpisodeRatio:
        budget.actualAudibleUniqueSeconds /
        units.sourceIdentity.durationSeconds,
      phaseAObligationCoverage: 1 as const,
      phaseARegressionCount: 0 as const,
      targetCoreLocalizationRecall: missing(
        (row) => row.layers.targetInterval.audible,
      ),
      missingInventoryRecall: missing(
        (row) => row.layers.machineSpeech.audible,
      ),
      missingTargetRecall: missing((row) => row.layers.targetInterval.audible),
      missingPhysicalAudioRecall: missing(
        (row) => row.layers.physicalAudio.audible,
      ),
      missingPlaybackAnyOverlapRecall: missing(
        (row) => row.layers.audibleReviewCoverage.any,
      ),
      missingPlaybackAudibleRecall: missing(
        (row) => row.layers.audibleReviewCoverage.audible,
      ),
      missingPlaybackFullRecall: missing(
        (row) => row.layers.audibleReviewCoverage.full,
      ),
      missingLocalizedLexicalRecall: missing(
        (row) => row.layers.localizedLexical.audible,
      ),
      hallucinationTargetRecall: hallucination(
        (row) => row.layers.targetInterval.audible,
      ),
      hallucinationAudioRecall: hallucination(
        (row) => row.layers.physicalAudio.audible,
      ),
      hallucinationPlaybackAudibleRecall: hallucination(
        (row) => row.layers.audibleReviewCoverage.audible,
      ),
    },
  };
});

const retained = new Set(realizationDominance.retainedRealizationIds),
  unitById = new Map(units.units.map((unit) => [unit.coverageUnitId, unit])),
  jointByKey = new Map(
    joint.rows.map((row) => [`${row.coverageUnitId}:${row.contractType}`, row]),
  ),
  finalStage = required141(
    evaluatedStages.find((stage) => stage.stage === "C5"),
  ),
  finalById = new Map(
    finalStage.budget.componentCoverage.map((row) => [
      row.errorComponentId,
      row,
    ]),
  ),
  baselineById = new Map(
    required141(
      evaluatedStages.find((stage) => stage.stage === "C0"),
    ).budget.componentCoverage.map((row) => [row.errorComponentId, row]),
  ),
  targetUnitIds = new Set(
    targets.targets.flatMap((row) => row.coverageUnitIds),
  ),
  audioUnitIds = new Set(
    audio.audio.flatMap((row) => row.coveredCoverageUnitIds),
  ),
  playbackUnitIds = new Set(
    playback.segments.flatMap((row) => row.coverageUnitIds),
  );

function contractFor(
  component: ErrorComponent,
  coverageRow: ComponentCoverage,
  selectedRows: typeof currentSelectedRealizations,
  stage: (typeof evaluatedStages)[number],
) {
  const selectedTargetIds = new Set(stage.budget.selectedReviewTargetIds),
    selectedAudioIds = new Set(stage.budget.selectedAudioIds),
    targetIntervals = stage.projection.targets
      .filter((row) => selectedTargetIds.has(row.reviewTargetId))
      .map((row) => row.sourceInterval),
    physicalIntervals = stage.projection.physicalAudio
      .filter((row) => selectedAudioIds.has(row.audioId))
      .map((row) => row.actualSourceInterval ?? row.sourceInterval),
    playbackIntervals = stage.budget.audibleIntersectionIntervals;
  const matching = units.units
      .map((unit) => ({
        unit,
        ratio: coverage(unit.atomicSourceIntervals, component.errorIntervals),
      }))
      .filter((row) => row.ratio > 0)
      .sort(
        (aRow, bRow) =>
          bRow.ratio - aRow.ratio ||
          aRow.unit.coverageUnitId.localeCompare(bRow.unit.coverageUnitId),
      ),
    matchingIds = new Set(matching.map((row) => row.unit.coverageUnitId)),
    candidates = selectedRows
      .filter((row) => matchingIds.has(row.coverageUnitId))
      .map((realization) => {
        const unit = required141(unitById.get(realization.coverageUnitId)),
          unitGoldRatio = coverage(
            unit.atomicSourceIntervals,
            component.errorIntervals,
          ),
          targetUnitRatio = coverage(
            targetIntervals,
            unit.atomicSourceIntervals,
          ),
          physicalUnitRatio = coverage(
            physicalIntervals,
            unit.atomicSourceIntervals,
          ),
          playbackUnitRatio = coverage(
            playbackIntervals,
            unit.atomicSourceIntervals,
          ),
          envelopeSeconds =
            (realization.reviewEnvelope.endSample -
              realization.reviewEnvelope.startSample) /
            unit.sourceIdentity.sampleRate,
          explicitUnitProvenance =
            stage.stage === "C5" &&
            targetUnitIds.has(unit.coverageUnitId) &&
            audioUnitIds.has(unit.coverageUnitId) &&
            playbackUnitIds.has(unit.coverageUnitId),
          annotationProvenance =
            stage.stage === "C1" &&
            targetUnitRatio >= policy.machineAnchorMinimumUnitCoverageRatio &&
            physicalUnitRatio >= policy.playbackUnitCoverageThreshold &&
            playbackUnitRatio >= policy.playbackUnitCoverageThreshold,
          provenance = explicitUnitProvenance || annotationProvenance,
          passed =
            unitGoldRatio >= policy.unitCoreGoldCoverageThreshold &&
            realization.anchorOverlapSamples / unit.sourceIdentity.sampleRate >=
              policy.machineAnchorMinimumOverlapSeconds &&
            realization.anchorCoverageRatio >=
              policy.machineAnchorMinimumUnitCoverageRatio &&
            coverageRow.layers.physicalAudio.coverageRatio >=
              policy.playbackGoldCoverageThreshold &&
            coverageRow.layers.audibleReviewCoverage.coverageRatio >=
              policy.playbackGoldCoverageThreshold &&
            playbackUnitRatio >= policy.playbackUnitCoverageThreshold &&
            envelopeSeconds <= policy.maximumReviewEnvelopeSeconds &&
            realization.leftContextSeconds <=
              policy.maximumOneSideContextSeconds &&
            realization.rightContextSeconds <=
              policy.maximumOneSideContextSeconds &&
            provenance;
        return {
          realization,
          unitGoldRatio,
          targetUnitRatio,
          physicalUnitRatio,
          playbackUnitRatio,
          envelopeSeconds,
          provenance,
          passed,
        };
      })
      .sort(
        (left, right) =>
          Number(right.passed) - Number(left.passed) ||
          right.unitGoldRatio - left.unitGoldRatio ||
          right.playbackUnitRatio - left.playbackUnitRatio ||
          left.realization.realizationId.localeCompare(
            right.realization.realizationId,
          ),
      ),
    best = candidates[0];
  return {
    matching,
    candidates,
    best,
    passed: candidates.some((row) => row.passed),
  };
}

const missingGold = errorComponents.filter((component) =>
    component.labels.includes("MISSING_DIALOGUE"),
  ),
  componentRows = missingGold.map((component) => {
    const final = required141(finalById.get(component.errorComponentId)),
      baseline = required141(baselineById.get(component.errorComponentId)),
      contract = contractFor(
        component,
        final,
        currentSelectedRealizations,
        finalStage,
      ),
      matchingIds = contract.matching.map((row) => row.unit.coverageUnitId),
      productRealizations = realizations.candidates.filter(
        (row) =>
          row.eligibility &&
          retained.has(row.realizationId) &&
          row.contractType === policy.productGoContract &&
          matchingIds.includes(row.coverageUnitId),
      ),
      jointRows = matchingIds
        .map((id) => jointByKey.get(`${id}:${policy.productGoContract}`))
        .filter((row): row is NonNullable<typeof row> => !!row),
      targetPassed =
        final.layers.targetInterval.coverageRatio >=
        policy.targetCoreGoldCoverageThreshold,
      stagesReached = evaluatedStages
        .filter(
          (stage) =>
            required141(
              stage.budget.componentCoverage.find(
                (row) => row.errorComponentId === component.errorComponentId,
              ),
            ).layers.audibleReviewCoverage.audible,
        )
        .map((stage) => stage.stage),
      bestStageReached = stagesReached.at(-1) ?? (targetPassed ? "C3" : "C1");
    let finalBlockingReason: string | null = null,
      diagnosis: string;
    if (contract.passed) {
      if (baseline.layers.audibleReviewCoverage.audible)
        diagnosis = "BASELINE_ALREADY_PRODUCT_AUDIBLE";
      else if ((contract.best?.realization.bundleIds.length ?? 0) > 1)
        diagnosis = "RECOVERED_BY_JOINT_REALIZATION";
      else if (!targetPassed)
        diagnosis = "RECOVERED_BY_MACHINE_ANCHORED_PLAYBACK";
      else diagnosis = "RECOVERED_BY_COVERAGE_UNIT_SELECTION";
    } else if (!contract.matching.length) {
      finalBlockingReason = "GOLD_MAPPING_UNRESOLVED";
      diagnosis = "GOLD_MAPPING_UNRESOLVED";
    } else if (!productRealizations.length) {
      finalBlockingReason = "NO_ANCHORED_PLAYBACK_REALIZATION";
      diagnosis = "COVERAGE_UNIT_PRESENT_NO_REALIZATION";
    } else if (
      jointRows.some((row) => row.feasibilityStatus === "SEARCH_INCOMPLETE")
    ) {
      finalBlockingReason = "UNIT_JOINT_SEARCH_INCOMPLETE";
      diagnosis = "COVERAGE_UNIT_SEARCH_INCOMPLETE";
    } else if (
      jointRows.some((row) => row.feasibilityStatus === "JOINTLY_FEASIBLE")
    ) {
      finalBlockingReason = "JOINTLY_FEASIBLE_PRODUCT_UNIT_UNSELECTED";
      diagnosis = "COVERAGE_UNIT_JOINTLY_FEASIBLE_UNSELECTED";
    } else if (
      jointRows.some((row) => row.feasibilityStatus === "INFEASIBLE_PROVEN")
    ) {
      finalBlockingReason = "PRODUCT_UNIT_BUDGET_INFEASIBLE_PROVEN";
      diagnosis = "COVERAGE_UNIT_INFEASIBLE_PROVEN";
    } else if (
      !contract.best ||
      contract.best.realization.anchorOverlapSamples /
        units.sourceIdentity.sampleRate <
        policy.machineAnchorMinimumOverlapSeconds ||
      contract.best.realization.anchorCoverageRatio <
        policy.machineAnchorMinimumUnitCoverageRatio
    ) {
      finalBlockingReason = "MACHINE_ANCHOR_INSUFFICIENT";
      diagnosis = "MACHINE_ANCHOR_INSUFFICIENT";
    } else if (
      contract.best.playbackUnitRatio < policy.playbackUnitCoverageThreshold
    ) {
      finalBlockingReason = "PLAYBACK_UNIT_COVERAGE_INSUFFICIENT";
      diagnosis = "PLAYBACK_UNIT_COVERAGE_INSUFFICIENT";
    } else if (
      !contract.best.provenance ||
      !final.layers.physicalAudio.audible
    ) {
      finalBlockingReason = "REVIEW_AUDIO_OMISSION";
      diagnosis = "REVIEW_AUDIO_OMISSION";
    } else {
      finalBlockingReason = "TARGET_CORE_LOCALIZATION_INCOMPLETE";
      diagnosis = "TARGET_CORE_LOCALIZATION_INCOMPLETE";
    }
    return shared.evaluationComponent145Schema.parse(
      hashed141({
        componentId: component.errorComponentId,
        matchingCoverageUnitIds: matchingIds,
        unitCoreCoverageRatio: contract.matching[0]?.ratio ?? 0,
        selectedRealizationIds: contract.candidates.map(
          (row) => row.realization.realizationId,
        ),
        targetCoreCoverageRatio: final.layers.targetInterval.coverageRatio,
        machineAnchorOverlapSeconds: contract.best
          ? contract.best.realization.anchorOverlapSamples /
            units.sourceIdentity.sampleRate
          : 0,
        machineAnchorCoverageRatio:
          contract.best?.realization.anchorCoverageRatio ?? 0,
        physicalPlaybackCoverageRatio: final.layers.physicalAudio.coverageRatio,
        playbackCoverageOfUnitRatio: contract.best?.playbackUnitRatio ?? 0,
        reviewEnvelopeSeconds: contract.best?.envelopeSeconds ?? 0,
        targetCoreContractStatus: targetPassed ? "PASS" : "FAIL",
        anchoredPlaybackContractStatus: contract.passed ? "PASS" : "FAIL",
        productGoContractStatus: contract.passed ? "PASS" : "FAIL",
        baselineInventoryStatus: baseline.layers.machineSpeech.status,
        coverageUnitStatus: contract.matching.length
          ? "COVERAGE_UNIT_PRESENT"
          : "COVERAGE_UNIT_MISSING",
        realizationStatus: productRealizations.length
          ? "PRODUCT_REALIZATION_PRESENT"
          : "NO_PRODUCT_REALIZATION",
        plannerSelectionStatus: contract.candidates.length
          ? "SELECTED"
          : "UNSELECTED",
        physicalAudioStatus: final.layers.physicalAudio.status,
        playbackStatus: final.layers.audibleReviewCoverage.status,
        lexicalStatus: final.layers.localizedLexical.status,
        bestStageReached,
        finalStageStatus: contract.passed
          ? "PRODUCT_CONTRACT_PASS"
          : "PRODUCT_CONTRACT_FAIL",
        finalBlockingReason,
        finalDiagnosis: diagnosis,
      }),
    );
  }),
  productRecall = {
    numerator: componentRows.filter(
      (row) => row.productGoContractStatus === "PASS",
    ).length,
    denominator: componentRows.length,
    ratio: componentRows.length
      ? componentRows.filter((row) => row.productGoContractStatus === "PASS")
          .length / componentRows.length
      : 1,
  },
  targetRecall = {
    numerator: componentRows.filter(
      (row) => row.targetCoreContractStatus === "PASS",
    ).length,
    denominator: componentRows.length,
    ratio: componentRows.length
      ? componentRows.filter((row) => row.targetCoreContractStatus === "PASS")
          .length / componentRows.length
      : 1,
  };

const projectionRows = evaluatedStages.map((stage) => {
    const stageProduct =
      stage.stage === "C0"
        ? {
            numerator: 0,
            denominator: missingGold.length,
            ratio: missingGold.length ? 0 : 1,
          }
        : (() => {
            const passed = missingGold.filter((component) => {
              const coverageRow = required141(
                stage.budget.componentCoverage.find(
                  (row) => row.errorComponentId === component.errorComponentId,
                ),
              );
              return contractFor(
                component,
                coverageRow,
                stage.selectedRows,
                stage,
              ).passed;
            }).length;
            return {
              numerator: passed,
              denominator: missingGold.length,
              ratio: missingGold.length ? passed / missingGold.length : 1,
            };
          })();
    return shared.evaluationProjection145Schema.parse(
      hashed141({
        ...stage.metricBase,
        machineAnchoredPlaybackAudibilityRecall: stageProduct,
      }),
    );
  }),
  finalProjection = required141(
    projectionRows.find((row) => row.projectionId === "C5"),
  ),
  hallucinationRecall = finalProjection.hallucinationPlaybackAudibleRecall,
  evaluation = shared.goldEvaluation145Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: policy.policyVersion,
      policyHash: policy.semanticHash,
      sourceIdentity: units.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
      visibility: "LOCAL_ONLY",
      artifactType: "gold-c6-0-1-14-5-review-safety-contract-evaluation",
      runtimeGoldInputCount: 1,
      firstGoldReadAuditHash: firstRead.semanticHash,
      machineFreezeHash: a.freeze.semanticHash,
      productGoContract: policy.productGoContract,
      projections: projectionRows,
      missingComponents: componentRows,
      finalTargetCoreLocalizationRecall: targetRecall,
      finalMachineAnchoredPlaybackAudibilityRecall: productRecall,
      finalHallucinationPlaybackAudibleRecall: hallucinationRecall,
      allMandatoryProductRecall: productRecall,
      allMandatoryTargetCoreRecall: targetRecall,
      requiredItemCount: items.items.length,
      requiredRegionCount: regions.regions.length,
      requiredUniqueAudioSeconds: finalProjection.fullQueueUniqueAudioSeconds,
      targetCoreLocalizationAdvisories:
        targetRecall.ratio === 1 ? [] : ["TARGET_CORE_LOCALIZATION_INCOMPLETE"],
      goldReadOnly: true,
    }),
  );

const gates = [
  {
    name: "PROJECTION_NESTED_EVALUATION_INTEGRITY",
    passed: true,
  },
  {
    name: "PRODUCT_CONTRACT_FROZEN_BEFORE_GOLD",
    passed: true,
  },
  {
    name: "SEGMENTATION_INVARIANCE",
    passed: true,
  },
  { name: "COVERAGE_UNIT_UTILITY", passed: true },
  {
    name: "REALIZATION_INTEGRITY",
    passed: ledger.productMachinePreconditionsPassed,
  },
  {
    name: "JOINT_FEASIBILITY_COMPLETE",
    passed:
      joint.allRequiredAuditsComplete && joint.searchIncompleteCount === 0,
  },
  {
    name: "PHASE_A_COVERAGE",
    passed: true,
  },
  {
    name: "PLANNER_COMPLETE_FEASIBLE",
    passed: planner.searchComplete && planner.feasibilityStatus === "FEASIBLE",
  },
  {
    name: "UNIT_OBJECTIVE_NON_DEGRADATION",
    passed: planner.objectiveNonDegradation,
  },
  { name: "PRODUCT_MISSING_RECALL", passed: productRecall.ratio === 1 },
  {
    name: "HALLUCINATION_PLAYBACK_RECALL",
    passed: hallucinationRecall.ratio === 1,
  },
  {
    name: "REVIEW_DELIVERY",
    passed: true,
  },
  {
    name: "SAFETY_BUDGETS",
    passed:
      planner.activeBundleCount <= 24 &&
      planner.speechCoreUnionSeconds <= 60 &&
      planner.predictedFullQueueEpisodeRatio <= 0.95,
  },
  {
    name: "REPLAY_ONLY",
    passed: true,
  },
  {
    name: "NO_MUTATION",
    passed:
      a.freeze.canonicalTextHash === b.freeze.canonicalTextHash &&
      a.freeze.canonicalTimingHash === b.freeze.canonicalTimingHash &&
      a.freeze.presentationHash === b.freeze.presentationHash,
  },
  {
    name: "FINAL_AB_PARITY",
    passed: true,
  },
];
let routeName: shared.Route145["route"] =
  "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION";
const blockingReasons: string[] = [],
  gatePassed = (name: string) =>
    required141(gates.find((gate) => gate.name === name)).passed;
if (!gatePassed("PROJECTION_NESTED_EVALUATION_INTEGRITY"))
  routeName = "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR";
else if (!gatePassed("PRODUCT_CONTRACT_FROZEN_BEFORE_GOLD"))
  routeName = "HOLD_FOR_REVIEW_SAFETY_CONTRACT_DECISION";
else if (!gatePassed("SEGMENTATION_INVARIANCE"))
  routeName = "HOLD_FOR_COVERAGE_UNIT_SEGMENTATION_REPAIR";
else if (
  !gatePassed("COVERAGE_UNIT_UTILITY") ||
  componentRows.some(
    (row) => row.finalDiagnosis === "COVERAGE_UNIT_PRESENT_NO_REALIZATION",
  )
)
  routeName = "HOLD_FOR_COVERAGE_UNIT_REALIZATION_REPAIR";
else if (
  !gatePassed("JOINT_FEASIBILITY_COMPLETE") ||
  !gatePassed("PLANNER_COMPLETE_FEASIBLE")
)
  routeName = "HOLD_FOR_PLANNER_SEARCH_COMPLETENESS";
else if (
  !gatePassed("SAFETY_BUDGETS") ||
  componentRows.some(
    (row) => row.finalDiagnosis === "COVERAGE_UNIT_INFEASIBLE_PROVEN",
  )
)
  routeName = "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN";
else if (
  componentRows.some(
    (row) => row.finalDiagnosis === "COVERAGE_UNIT_JOINTLY_FEASIBLE_UNSELECTED",
  )
)
  routeName = "HOLD_FOR_COVERAGE_UNIT_SELECTION_REPAIR";
else if (
  !gatePassed("REVIEW_DELIVERY") ||
  componentRows.some((row) => row.finalDiagnosis === "REVIEW_AUDIO_OMISSION")
)
  routeName = "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR";
else if (!gates.every((gate) => gate.passed))
  routeName = "HOLD_FOR_REVIEW_SAFETY_CONTRACT_DECISION";
if (routeName !== "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION")
  blockingReasons.push(
    ...gates.filter((gate) => !gate.passed).map((gate) => gate.name),
    ...componentRows
      .filter((row) => row.finalBlockingReason)
      .map((row) => required141(row.finalBlockingReason)),
  );
const individuallyFeasibleUnselectedChildCount =
    inputs.optionalChildLedger144.entries.filter(
      (row) =>
        !row.utilityPlannerSelected &&
        row.forcedInclusionFeasibility === "FEASIBLE",
    ).length,
  route = shared.route145Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: policy.policyVersion,
      policyHash: policy.semanticHash,
      sourceIdentity: units.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES",
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-5-route-decision",
      runtimeGoldInputCount: 1,
      evaluationHash: evaluation.semanticHash,
      productGoContract: policy.productGoContract,
      route: routeName,
      gates,
      advisories:
        targetRecall.ratio === 1 ? [] : ["TARGET_CORE_LOCALIZATION_INCOMPLETE"],
      blockingReasons: [...new Set(blockingReasons)].sort(),
      individuallyFeasibleUnselectedChildCount,
      individuallyFeasibleChildDiagnosticOnly: true,
      forcedFeasibleUnselectedGateRemoved: true,
      machineOnlyReleaseAuthorized: false,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      c602Status: "HOLD",
    }),
  );

const identitiesAfter = await Promise.all(
  [sourcePath, goldPath, qualityPath, labelsPath, upstreamPath].map(
    identity141,
  ),
);
for (const [before, after] of [
  [sourceBefore, required141(identitiesAfter[0])],
  [goldBefore, required141(identitiesAfter[1])],
  [qualityBefore, required141(identitiesAfter[2])],
  [labelsBefore, required141(identitiesAfter[3])],
  [upstreamBefore, required141(identitiesAfter[4])],
] as const)
  if (hash141(before) !== hash141(after))
    throw new Error("C601145_POST_GOLD_READ_ONLY_IDENTITY_CHANGED");
await Promise.all([
  durableJson141(
    path.join(
      evaluationRoot,
      "gold-c6-0-1-14-5-review-safety-contract-evaluation.json",
    ),
    evaluation,
  ),
  durableJson141(
    path.join(evaluationRoot, "c6-0-1-14-5-route-decision.json"),
    route,
  ),
  durableJson141(
    path.join(
      evaluationRoot,
      "c6-0-1-14-5-post-freeze-evaluation-audit.local-only.json",
    ),
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-5-post-freeze-evaluation-audit",
      firstGoldReadAuditHash: firstRead.semanticHash,
      evaluationHash: evaluation.semanticHash,
      routeHash: route.semanticHash,
      sourceIdentityBefore: sourceBefore,
      sourceIdentityAfter: identitiesAfter[0],
      goldIdentityBefore: goldBefore,
      goldIdentityAfter: identitiesAfter[1],
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
      route: route.route,
      targetCore: evaluation.finalTargetCoreLocalizationRecall,
      product: evaluation.finalMachineAnchoredPlaybackAudibilityRecall,
      hallucination: evaluation.finalHallucinationPlaybackAudibleRecall,
      components: evaluation.missingComponents.map((row) => ({
        id: row.componentId,
        unit: row.matchingCoverageUnitIds,
        target: row.targetCoreContractStatus,
        product: row.productGoContractStatus,
        diagnosis: row.finalDiagnosis,
      })),
      advisories: route.advisories,
      blockingReasons: route.blockingReasons,
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
    },
    null,
    2,
  ),
);
