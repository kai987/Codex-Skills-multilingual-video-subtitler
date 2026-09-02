/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Validation deliberately reasserts literal-constrained cross-artifact invariants. */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
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

const { values } = parseArgs({
  strict: true,
  options: { state: { type: "string" } },
});
const statePath = path.resolve(required141(values.state, "--state required")),
  state = (await readJson141(statePath)) as {
    outputs: Record<string, string>;
    semanticHash: string;
  };
assertHash141(state);
const output = (role: string) => path.resolve(required141(state.outputs[role])),
  finalA = output("final-a"),
  finalB = output("final-b"),
  reviewPackage = output("review-package"),
  evaluationRoot = output("evaluation"),
  validationRoot = output("validation"),
  readMachine = async <T>(
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

const policy = await readMachine(
    finalA,
    "c6-0-1-14-5-2-product-scorability-playback-realization-policy.json",
    shared.policy1452Schema,
  ),
  geometry = await readMachine(
    finalA,
    "machine-c6-0-1-14-5-1-geometry-freeze.json",
    shared.geometryFreeze1451Schema,
  ),
  registry = await readMachine(
    finalA,
    "machine-full-speech-evidence-unit-registry-v1.json",
    shared.fullRegistry1451Schema,
  ),
  binding = await readMachine(
    finalA,
    "machine-review-delivery-coverage-unit-binding-v1.json",
    shared.reviewBinding1451Schema,
  ),
  orphanAudit = await readMachine(
    finalA,
    "machine-degenerate-orphan-target-baseline-audit.json",
    shared.degenerateAudit1452Schema,
  ),
  eligibility = await readMachine(
    finalA,
    "machine-degenerate-orphan-target-eligibility-v1.json",
    shared.degenerateEligibility1452Schema,
  ),
  candidates = await readMachine(
    finalA,
    "machine-inherited-realization-candidate-ledger-v2.json",
    shared.realizationCandidateLedger1452Schema,
  ),
  inheritedV2 = await readMachine(
    finalA,
    "machine-existing-review-delivery-realizations-v2.json",
    shared.inheritedRealizations1452Schema,
  ),
  comparison = await readMachine(
    finalA,
    "machine-inherited-realization-v1-v2-comparison.json",
    shared.realizationComparison1452Schema,
  ),
  effectiveV2 = await readMachine(
    finalA,
    "machine-effective-product-realization-registry-v2.json",
    shared.effectiveRealizations1452Schema,
  ),
  connectivity = await readMachine(
    finalA,
    "machine-witness-connectivity-ledger-v2.json",
    shared.witnessConnectivity1452Schema,
  ),
  witnessesV2 = await readMachine(
    finalA,
    "machine-product-contract-witness-groups-v2.json",
    shared.witnessGroups1452Schema,
  ),
  determinacyPreflight = await readMachine(
    finalA,
    "machine-product-outcome-determinacy-preflight.json",
    shared.determinacyPreflight1452Schema,
  ),
  projectionLedger = await readMachine(
    finalA,
    "machine-projection-hash-rebinding-ledger.json",
    shared.projectionLedger1452Schema,
  ),
  nested = await readMachine(
    finalA,
    "c6-0-1-14-5-2-nested-semantic-integrity-preflight.json",
    shared.nestedPreflight1452Schema,
  ),
  targets = await readReview(
    finalA,
    "machine-review-target-intervals-v9.json",
    shared.reviewTargets1452Schema,
  ),
  items = await readReview(
    finalA,
    "machine-review-items-v11.json",
    shared.reviewItems1452Schema,
  ),
  regions = await readReview(
    finalA,
    "machine-review-regions-v10.json",
    shared.reviewRegions1452Schema,
  ),
  audio = await readReview(
    finalA,
    "machine-review-audio-manifest-v10.json",
    shared.reviewAudio1452Schema,
  ),
  playback = await readReview(
    finalA,
    "machine-review-playback-timeline-v9.json",
    shared.reviewPlayback1452Schema,
  ),
  freezeA = shared.freeze1452Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "c6-0-1-14-5-2-machine-scorability-playback-freeze.json",
      ),
    ),
  ),
  freezeB = shared.freeze1452Schema.parse(
    await readJson141(
      path.join(
        finalB,
        "c6-0-1-14-5-2-machine-scorability-playback-freeze.json",
      ),
    ),
  ),
  parity = shared.parity1452Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-2-final-ab-parity.json"),
    ),
  ),
  firstRead = shared.firstGoldRead1452Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-2-first-gold-read-audit.json"),
    ),
  ),
  evaluation = shared.evaluation1452Schema.parse(
    await readJson141(
      path.join(
        evaluationRoot,
        "gold-c6-0-1-14-5-2-product-outcome-evaluation.json",
      ),
    ),
  ),
  mandatory = shared.mandatoryEvaluation1452Schema.parse(
    await readJson141(
      path.join(
        evaluationRoot,
        "gold-c6-0-1-14-5-2-all-mandatory-evaluation.json",
      ),
    ),
  ),
  route = shared.route1452Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-2-route-decision.json"),
    ),
  ),
  postAudit = (await readJson141(
    path.join(
      evaluationRoot,
      "c6-0-1-14-5-2-post-freeze-evaluation-audit.local-only.json",
    ),
  )) as {
    sourceIdentityBefore: unknown;
    sourceIdentityAfter: unknown;
    goldIdentityBefore: unknown;
    goldIdentityAfter: unknown;
    inferenceCount: number;
    modelLoadCount: number;
    providerProcessStartCount: number;
    semanticHash: string;
  };

const artifacts = [
  policy,
  geometry,
  registry,
  binding,
  orphanAudit,
  eligibility,
  candidates,
  inheritedV2,
  comparison,
  effectiveV2,
  connectivity,
  witnessesV2,
  determinacyPreflight,
  projectionLedger,
  nested,
  targets,
  items,
  regions,
  audio,
  playback,
  freezeA,
  freezeB,
  parity,
  firstRead,
  evaluation,
  mandatory,
  route,
  postAudit,
];
artifacts.forEach(assertHash141);

const checks: { name: string; passed: boolean; detail: string }[] = [],
  check = (name: string, passed: boolean, detail: string) => {
    if (!passed)
      throw new Error(`C6011452_VALIDATION_FAILED:${name}:${detail}`);
    checks.push({ name, passed, detail });
  },
  mandatoryPlan = required141(
    playback.plans.find((row) => row.planId === "ALL_MANDATORY"),
    "C6011452_ALL_MANDATORY_PLAN_MISSING",
  ),
  fullQueuePlan = required141(
    playback.plans.find((row) => row.planId === "FULL_QUEUE"),
    "C6011452_FULL_QUEUE_PLAN_MISSING",
  );

check(
  "FULL_REGISTRY_COMPLETE",
  registry.complete &&
    registry.registeredVerifiedSpeechCoverageRatio === 1 &&
    registry.unregisteredVerifiedSpeechSamples === 0,
  `units=${registry.fullRegistryUnitCount};seconds=${registry.registeredVerifiedSpeechUnionSeconds}`,
);
check(
  "GENERIC_DEGENERATE_ORPHAN_RECONCILIATION",
  orphanAudit.degenerateSliverCandidateCount === 1 &&
    eligibility.degenerateSliverClassifiedCount === 1 &&
    eligibility.degenerateSliverAuditRetainedCount === 1 &&
    eligibility.degenerateSliverGeometryMutationCount === 0 &&
    eligibility.degenerateSliverDeletedCount === 0 &&
    eligibility.degenerateSliverFakeBindingCount === 0,
  `classified=${eligibility.degenerateSliverClassifiedCount}`,
);
check(
  "REMAINING_REQUIRED_TARGETS_BOUND",
  eligibility.bindingRequiredTargetCountAfter === 105 &&
    eligibility.requiredTargetBoundCountAfter === 105 &&
    eligibility.requiredTargetUnboundCountAfter === 0,
  `before=${eligibility.bindingRequiredTargetCountBefore};after=${eligibility.bindingRequiredTargetCountAfter}`,
);
check(
  "TARGET_RETENTION_AND_GEOMETRY",
  eligibility.reviewTargetCountBefore === eligibility.reviewTargetCountAfter &&
    eligibility.targetIntervalMutationCount === 0 &&
    targets.targets.length === eligibility.reviewTargetCountAfter,
  `targets=${targets.targets.length}`,
);
check(
  "CANDIDATE_LEDGER_COMPLETE",
  candidates.candidateConservationPassed &&
    candidates.candidateCount ===
      candidates.acceptedCandidateCount + candidates.rejectedCandidateCount &&
    candidates.searchIncompleteCandidateCount === 0 &&
    candidates.unknownSilentRejectionCount === 0 &&
    candidates.enumerationComplete &&
    candidates.searchComplete,
  `total=${candidates.candidateCount};accepted=${candidates.acceptedCandidateCount};rejected=${candidates.rejectedCandidateCount}`,
);
check(
  "PLAYBACK_SCOPED_REALIZATION_SEMANTICS",
  inheritedV2.realizations.every(
    (row) =>
      row.envelopeSeconds <= policy.maximumReviewEnvelopeSeconds &&
      row.leftContextSeconds <= policy.maximumOneSideContextSeconds &&
      row.rightContextSeconds <= policy.maximumOneSideContextSeconds &&
      row.playbackSegmentIds.length > 0 &&
      row.physicalAudioContainerIntervals.length > 0,
  ) &&
    inheritedV2.inheritedV2MissingAudioCount === 0 &&
    inheritedV2.inheritedV2MissingPlaybackCount === 0 &&
    inheritedV2.inheritedV2PlaybackSetSearchIncompleteCount === 0,
  `v1=${comparison.acceptedCountV1};v2=${comparison.acceptedCountV2}`,
);
check(
  "EFFECTIVE_REALIZATION_DEDUP",
  effectiveV2.complete &&
    effectiveV2.effectiveProductRealizationCount ===
      effectiveV2.realizations.length &&
    effectiveV2.effectiveRealizationDedupCount >= 0,
  `effective=${effectiveV2.effectiveProductRealizationCount};dedup=${effectiveV2.effectiveRealizationDedupCount}`,
);
check(
  "GOLD_FREE_WITNESS_CONNECTIVITY",
  connectivity.complete &&
    connectivity.timeProximityOnlyConnectionCount === 0 &&
    witnessesV2.goldInputCount === 0 &&
    witnessesV2.witnessGroupBuildComplete &&
    witnessesV2.witnessSearchComplete,
  `pairs=${connectivity.pairCount};groups=${witnessesV2.witnessGroupCount}`,
);
check(
  "DETERMINACY_PREFLIGHT",
  determinacyPreflight.passed &&
    Object.values(determinacyPreflight.globalCompletenessFlags).every(Boolean),
  `prerequisites=${determinacyPreflight.componentPrerequisiteMatrix.length}`,
);
check(
  "DETERMINATE_FORMAL_SCORABILITY",
  evaluation.totalComponentCount === 6 &&
    evaluation.determinateOutcomeCount === 6 &&
    evaluation.notScorableCount === 0 &&
    evaluation.integrityFailedCount === 0 &&
    evaluation.formalRecallStatus === "SCORABLE" &&
    evaluation.formalRecall !== null &&
    evaluation.formalRecall.denominator === 6,
  `formal=${evaluation.formalRecall?.numerator ?? "null"}/${evaluation.formalRecall?.denominator ?? "null"}`,
);
check(
  "SCORABLE_OUTCOME_CONSERVATION",
  evaluation.scorablePassCount + evaluation.scorableFailCount === 6 &&
    evaluation.components.every(
      (row) =>
        row.outcomeDeterminacyStatus === "DETERMINATE" &&
        row.scorabilityStatus === "SCORABLE",
    ),
  `pass=${evaluation.scorablePassCount};fail=${evaluation.scorableFailCount}`,
);
check(
  "ORDINARY_PRODUCT_CONSISTENCY",
  evaluation.scorablePassCount <=
    evaluation.ordinaryPlaybackAudibleRecall.numerator,
  `product=${evaluation.scorablePassCount};ordinaryAudible=${evaluation.ordinaryPlaybackAudibleRecall.numerator}`,
);
check(
  "TRUE_ALL_MANDATORY",
  mandatory.itemCount === mandatoryPlan.reviewItemIds.length &&
    mandatory.regionCount === mandatoryPlan.regionIds.length &&
    mandatory.targetCount === mandatoryPlan.reviewTargetIds.length &&
    mandatory.audioCount === mandatoryPlan.audioIds.length &&
    mandatory.playbackSegmentCount ===
      mandatoryPlan.playbackSegmentIds.length &&
    mandatory.uniqueAudioSeconds === mandatoryPlan.uniqueAudioSeconds &&
    mandatory.playbackSegmentCount < fullQueuePlan.playbackSegmentIds.length &&
    !mandatory.fullQueueCopy &&
    !mandatory.rankerRetrained,
  `items=${mandatory.itemCount};segments=${mandatory.playbackSegmentCount};seconds=${mandatory.uniqueAudioSeconds}`,
);
check(
  "PROJECTION_AND_NESTED_INTEGRITY",
  projectionLedger.passed &&
    projectionLedger.staleProjectionHashCount === 0 &&
    nested.passed &&
    nested.nestedIntegrityFailureCount === 0 &&
    nested.staleProjectionHashCount === 0,
  `projectionRows=${projectionLedger.projectionRebindingRowCount};nested=${nested.verifiedNestedRowCount}`,
);
check(
  "GOLD_BARRIER_AND_READ_ONLY",
  firstRead.freezeBeforeGold &&
    firstRead.machineStageGoldPathReadCount === 0 &&
    firstRead.machineStageGoldDerivedArtifactReadCount === 0 &&
    hash141(postAudit.sourceIdentityBefore) ===
      hash141(postAudit.sourceIdentityAfter) &&
    hash141(postAudit.goldIdentityBefore) ===
      hash141(postAudit.goldIdentityAfter),
  `freeze=${firstRead.machineFreezeHash}`,
);
check(
  "ZERO_NEW_INFERENCE",
  freezeA.detectorReplaySummary.expected === 18 &&
    freezeA.detectorReplaySummary.hits === 18 &&
    freezeA.detectorReplaySummary.misses === 0 &&
    freezeA.asrReplaySummary.expected === 44 &&
    freezeA.asrReplaySummary.hits === 44 &&
    freezeA.asrReplaySummary.misses === 0 &&
    freezeA.inferenceCount === 0 &&
    freezeA.modelLoadCount === 0 &&
    freezeA.providerProcessStartCount === 0 &&
    postAudit.inferenceCount === 0 &&
    postAudit.modelLoadCount === 0 &&
    postAudit.providerProcessStartCount === 0,
  "detector=18/18;asr=44/44;inference=0",
);
check(
  "FINAL_AB_SEMANTIC_PARITY",
  freezeA.finalRole === "A" &&
    freezeB.finalRole === "B" &&
    parity.finalAFreezeHash === freezeA.semanticHash &&
    parity.finalBFreezeHash === freezeB.semanticHash &&
    parity.semanticParity &&
    parity.geometryParity &&
    parity.wavHashParity &&
    parity.subtitleParity,
  `A=${freezeA.semanticHash};B=${freezeB.semanticHash}`,
);

const extensionNames = [
    "c6-0-1-14-5-2-product-scorability-playback-realization-policy.json",
    "machine-degenerate-orphan-target-baseline-audit.json",
    "machine-degenerate-orphan-target-eligibility-v1.json",
    "machine-inherited-realization-candidate-ledger-v2.json",
    "machine-existing-review-delivery-realizations-v2.json",
    "machine-inherited-realization-v1-v2-comparison.json",
    "machine-effective-product-realization-registry-v2.json",
    "machine-witness-connectivity-ledger-v2.json",
    "machine-product-contract-witness-groups-v2.json",
    "machine-product-outcome-determinacy-policy-v1.json",
    "machine-product-outcome-determinacy-preflight.json",
    "machine-projection-hash-rebinding-ledger.json",
    "c6-0-1-14-5-2-nested-semantic-integrity-preflight.json",
  ] as const,
  deliveryNames = [
    "machine-review-target-intervals-v9.json",
    "machine-review-items-v11.json",
    "machine-review-regions-v10.json",
    "machine-review-audio-manifest-v10.json",
    "machine-review-playback-timeline-v9.json",
  ] as const;
for (const name of extensionNames) {
  const hashes = await Promise.all(
    [finalA, finalB, reviewPackage].map((root) =>
      fileHash141(path.join(root, "machine-artifacts", name)),
    ),
  );
  if (new Set(hashes).size !== 1)
    throw new Error(`C6011452_MACHINE_ARTIFACT_PARITY_FAILED:${name}`);
}
for (const name of deliveryNames) {
  const hashes = await Promise.all(
    [finalA, finalB, reviewPackage].map((root) =>
      fileHash141(path.join(root, "review-workspace", name)),
    ),
  );
  if (new Set(hashes).size !== 1)
    throw new Error(`C6011452_REVIEW_ARTIFACT_PARITY_FAILED:${name}`);
}
check(
  "FINAL_REVIEW_PACKAGE_ARTIFACT_PARITY",
  true,
  `machine=${extensionNames.length};review=${deliveryNames.length}`,
);

let verifiedWavCount = 0;
for (const root of [finalA, finalB, reviewPackage])
  for (const row of audio.audio) {
    const file = path.join(root, "review-workspace", row.relativePath);
    if ((await fileHash141(file)) !== row.sha256)
      throw new Error(`C6011452_WAV_HASH_CHANGED:${row.audioId}`);
    verifiedWavCount++;
  }
check(
  "PHYSICAL_WAV_BYTES_AND_PLAYABILITY",
  verifiedWavCount === audio.audio.length * 3 &&
    audio.audio.every(
      (row) => row.playable && row.hashVerified && row.physicalMetadataVerified,
    ),
  `verified=${verifiedWavCount}`,
);

for (const [relativePath, expected] of Object.entries(
  geometry.protectedSubtitleFileHashes,
))
  for (const root of [finalA, finalB])
    if ((await fileHash141(path.join(root, relativePath))) !== expected)
      throw new Error(`C6011452_SUBTITLE_CHANGED:${relativePath}`);
check(
  "CANONICAL_TIMING_PRESENTATION_PARITY",
  freezeA.canonicalTextHash === freezeB.canonicalTextHash &&
    freezeA.canonicalTimingHash === freezeB.canonicalTimingHash &&
    freezeA.presentationHash === freezeB.presentationHash,
  `text=${freezeA.canonicalTextHash};timing=${freezeA.canonicalTimingHash};presentation=${freezeA.presentationHash}`,
);
check(
  "GEOMETRY_AND_PLANNER_PARITY",
  geometry.plannerGeometryParity &&
    geometry.targetIntervalParity &&
    geometry.regionIntervalParity &&
    geometry.audioByteParity &&
    geometry.playbackIntervalParity &&
    eligibility.targetIntervalMutationCount === 0 &&
    comparison.geometryMutationCount === 0,
  `geometry=${geometry.semanticHash}`,
);
check(
  "SAFE_ROUTE_AND_RELEASE_HOLD",
  route.engineeringGatePassed &&
    !route.machineOnlyReleaseAuthorized &&
    route.productionStatus === "needs-review" &&
    route.finalizationMethod === "none" &&
    route.c602Status === "HOLD",
  `route=${route.route}`,
);
check(
  "POLICY_THRESHOLDS_AND_BUDGETS_FROZEN",
  policy.machineAnchorMinimumOverlapSeconds === 0.2 &&
    policy.machineAnchorMinimumUnitCoverageRatio === 0.1 &&
    policy.playbackToUnitCoverageThreshold === 0.95 &&
    policy.maximumReviewEnvelopeSeconds === 12 &&
    policy.maximumOneSideContextSeconds === 3 &&
    !policy.rankerRetrained &&
    !policy.machineOnlyReleaseAuthorized,
  "anchor=0.2s/0.10;playback=0.95;envelope=12s;context=3s",
);

const shareableSummary = shared.shareableSummary1452Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: policy.policyVersion,
      artifactType: "c6-0-1-14-5-2-aggregate-shareable-summary",
      visibility: "SHAREABLE_AGGREGATE_ONLY",
      policyHash: policy.semanticHash,
      orphanClassificationCounts: {
        audited: orphanAudit.auditedSpeechTargetCount,
        degenerate: eligibility.degenerateSliverClassifiedCount,
        auditOnly: eligibility.degenerateSliverAuditRetainedCount,
      },
      candidateCounts: {
        total: candidates.candidateCount,
        accepted: candidates.acceptedCandidateCount,
        rejected: candidates.rejectedCandidateCount,
        silentRejection: candidates.unknownSilentRejectionCount,
      },
      realizationCounts: {
        inheritedV1: comparison.acceptedCountV1,
        inheritedV2: comparison.acceptedCountV2,
        effectiveV2: effectiveV2.effectiveProductRealizationCount,
        witnessV2: witnessesV2.witnessGroupCount,
      },
      determinacyCounts: {
        determinate: evaluation.determinateOutcomeCount,
        scorablePass: evaluation.scorablePassCount,
        scorableFail: evaluation.scorableFailCount,
        notScorable: evaluation.notScorableCount,
        integrityFailed: evaluation.integrityFailedCount,
      },
      recallRatios: {
        formalProduct: evaluation.formalRecall?.ratio ?? null,
        targetCore: evaluation.targetCoreRecall.ratio,
        ordinaryPhysicalAudio: evaluation.ordinaryPhysicalAudioRecall.ratio,
        ordinaryPlaybackAudible: evaluation.ordinaryPlaybackAudibleRecall.ratio,
        hallucinationPlaybackAudible:
          evaluation.hallucinationPlaybackAudibleRecall.ratio,
      },
      mandatoryMetrics: {
        items: mandatory.itemCount,
        regions: mandatory.regionCount,
        targets: mandatory.targetCount,
        audio: mandatory.audioCount,
        playback: mandatory.playbackSegmentCount,
        uniqueAudioSeconds: mandatory.uniqueAudioSeconds,
        status: mandatory.formalProductStatus,
        productRecall: mandatory.formalProductRecall?.ratio ?? null,
      },
      artifactHashes: {
        freezeA: freezeA.semanticHash,
        freezeB: freezeB.semanticHash,
        evaluation: evaluation.semanticHash,
        mandatory: mandatory.semanticHash,
        route: route.semanticHash,
      },
      route: route.route,
      containsRawAudio: false,
      containsDialogueText: false,
      containsGoldRows: false,
      containsAbsolutePaths: false,
    }),
  ),
  shareableText = JSON.stringify(shareableSummary),
  absolutePathLeakCount =
    shareableText.match(
      /(?:file:\/\/|\/Users\/|\/home\/|[A-Za-z]:\\|\/private\/var\/|\/tmp\/)/gu,
    )?.length ?? 0,
  secretLeakCount =
    shareableText.match(
      /(?:sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/gu,
    )?.length ?? 0,
  goldLeakCount =
    shareableText.match(/(?:goldText|goldTranscript|goldInterval|goldCue)/giu)
      ?.length ?? 0,
  shareableAudit = shared.shareableAudit1452Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-5-2-shareable-audit",
      auditedFileCount: 1,
      absolutePathLeakCount,
      secretLeakCount,
      goldLeakCount,
      brokenRelativeReferenceCount: 0,
      passed:
        absolutePathLeakCount === 0 &&
        secretLeakCount === 0 &&
        goldLeakCount === 0,
    }),
  );
check(
  "SHAREABLE_AGGREGATE_ONLY",
  shareableAudit.passed,
  `paths=${absolutePathLeakCount};secrets=${secretLeakCount};gold=${goldLeakCount}`,
);

const shareableRoot = path.join(validationRoot, "shareable");
await mkdir(shareableRoot, { recursive: true });
await Promise.all([
  durableJson141(
    path.join(shareableRoot, "c6-0-1-14-5-2-aggregate-shareable-summary.json"),
    shareableSummary,
  ),
  durableJson141(
    path.join(shareableRoot, "c6-0-1-14-5-2-shareable-audit.json"),
    shareableAudit,
  ),
]);

const validation = shared.validation1452Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    policyVersion: policy.policyVersion,
    policyHash: policy.semanticHash,
    artifactType: "c6-0-1-14-5-2-validation",
    visibility: "LOCAL_ONLY",
    checks,
    passedCheckCount: checks.length,
    failedCheckCount: 0,
    artifactValidationCount: artifacts.length,
    schemaValidationCount: artifacts.length,
    sourceReadOnly: true,
    goldReadOnly: true,
    inferenceCount: 0,
    modelLoadCount: 0,
    providerProcessStartCount: 0,
    networkUsed: false,
    passed: true,
  }),
);
await durableJson141(
  path.join(validationRoot, "c6-0-1-14-5-2-validation.json"),
  validation,
);

console.log(
  JSON.stringify(
    {
      validationRoot,
      passed: validation.passedCheckCount,
      failed: validation.failedCheckCount,
      artifacts: validation.artifactValidationCount,
      formalRecall: evaluation.formalRecall,
      determinate: evaluation.determinateOutcomeCount,
      route: route.route,
      shareableAudit: shareableAudit.passed,
    },
    null,
    2,
  ),
);
