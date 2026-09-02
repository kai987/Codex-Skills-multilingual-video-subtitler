/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Validation intentionally reasserts schema-constrained literals and cross-artifact runtime invariants. */
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
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
import { header1451 } from "../packages/video-subtitler/src/review/c6011451-policy.js";

const { values } = parseArgs({
  strict: true,
  options: { state: { type: "string" } },
});
const statePath = path.resolve(required141(values.state, "--state required")),
  state = (await readJson141(statePath)) as {
    baseStatePath: string;
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
    "c6-0-1-14-5-1-full-unit-registry-review-binding-policy.json",
    shared.policy1451Schema,
  ),
  baseline = await readMachine(
    finalA,
    "machine-c6-0-1-14-5-1-registry-binding-baseline-audit.json",
    shared.baselineAudit1451Schema,
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
  reconciliation = await readMachine(
    finalA,
    "machine-full-registry-source-reconciliation.json",
    shared.sourceReconciliation1451Schema,
  ),
  planning = await readMachine(
    finalA,
    "machine-uncovered-safety-unit-projection-v1.json",
    shared.planningProjection1451Schema,
  ),
  compatibility = await readMachine(
    finalA,
    "machine-coverage-unit-registry-compatibility-map-v1.json",
    shared.compatibilityMap1451Schema,
  ),
  binding = await readMachine(
    finalA,
    "machine-review-delivery-coverage-unit-binding-v1.json",
    shared.reviewBinding1451Schema,
  ),
  inherited = await readMachine(
    finalA,
    "machine-existing-review-delivery-realizations-v1.json",
    shared.inheritedRealizations1451Schema,
  ),
  effective = await readMachine(
    finalA,
    "machine-effective-product-realization-registry-v1.json",
    shared.effectiveRealizations1451Schema,
  ),
  witnesses = await readMachine(
    finalA,
    "machine-product-contract-witness-groups-v1.json",
    shared.witnessGroups1451Schema,
  ),
  ledger = await readMachine(
    finalA,
    "machine-projection-hash-rebinding-ledger-v1451.json",
    shared.projectionLedger1451Schema,
  ),
  preflight = await readMachine(
    finalA,
    "c6-0-1-14-5-1-nested-semantic-integrity-preflight.json",
    shared.nestedPreflight1451Schema,
  ),
  targets = await readReview(
    finalA,
    "machine-review-target-intervals-v8.json",
    shared.reviewTargets1451Schema,
  ),
  items = await readReview(
    finalA,
    "machine-review-items-v10.json",
    shared.reviewItems1451Schema,
  ),
  regions = await readReview(
    finalA,
    "machine-review-regions-v9.json",
    shared.reviewRegions1451Schema,
  ),
  audio = await readReview(
    finalA,
    "machine-review-audio-manifest-v9.json",
    shared.reviewAudio1451Schema,
  ),
  playback = await readReview(
    finalA,
    "machine-review-playback-timeline-v8.json",
    shared.reviewPlayback1451Schema,
  ),
  freezeA = shared.freeze1451Schema.parse(
    await readJson141(
      path.join(finalA, "c6-0-1-14-5-1-machine-registry-binding-freeze.json"),
    ),
  ),
  freezeB = shared.freeze1451Schema.parse(
    await readJson141(
      path.join(finalB, "c6-0-1-14-5-1-machine-registry-binding-freeze.json"),
    ),
  ),
  parity = shared.parity1451Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-1-final-ab-parity.json"),
    ),
  ),
  evaluation = shared.evaluation1451Schema.parse(
    await readJson141(
      path.join(
        evaluationRoot,
        "gold-c6-0-1-14-5-1-contract-re-evaluation.json",
      ),
    ),
  ),
  witnessEvaluation = shared.witnessEvaluation1451Schema.parse(
    await readJson141(
      path.join(
        evaluationRoot,
        "gold-c6-0-1-14-5-1-multi-unit-witness-evaluation.json",
      ),
    ),
  ),
  route = shared.route1451Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-1-route-decision.json"),
    ),
  ),
  firstRead = shared.firstGoldRead1451Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-5-1-first-gold-read-audit.json"),
    ),
  ),
  postAudit = (await readJson141(
    path.join(
      evaluationRoot,
      "c6-0-1-14-5-1-post-freeze-evaluation-audit.local-only.json",
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

[
  policy,
  baseline,
  geometry,
  registry,
  reconciliation,
  planning,
  compatibility,
  binding,
  inherited,
  effective,
  witnesses,
  ledger,
  preflight,
  targets,
  items,
  regions,
  audio,
  playback,
  freezeA,
  freezeB,
  parity,
  evaluation,
  witnessEvaluation,
  route,
  firstRead,
  postAudit,
].forEach(assertHash141);

const checks: { name: string; passed: boolean; details: string[] }[] = [];
const check = (name: string, passed: boolean, details: string[] = []) => {
  if (!passed) throw new Error(`C6011451_VALIDATION_FAILED:${name}`);
  checks.push({ name, passed, details });
};
const mandatoryPlan = required141(
  playback.plans.find((row) => row.planId === "ALL_MANDATORY"),
  "C6011451_ALL_MANDATORY_PLAN_MISSING",
);

check(
  "FULL_REGISTRY_COMPLETENESS",
  registry.registeredVerifiedSpeechCoverageRatio === 1 &&
    registry.unregisteredVerifiedSpeechSamples === 0 &&
    registry.registeredVerifiedSpeechUnionSamples ===
      registry.upstreamVerifiedSpeechUnionSamples &&
    reconciliation.unmappedVerifiedSpeechRowCount === 0,
  [
    `units=${registry.fullRegistryUnitCount}`,
    `samples=${registry.registeredVerifiedSpeechUnionSamples}`,
  ],
);
check(
  "PLANNING_AND_COMPATIBILITY_PARITY",
  planning.planningProjectionSemanticParity &&
    planning.plannerSelectedBundleParity &&
    planning.plannerSelectedChildParity &&
    planning.plannerSelectedRealizationParity &&
    planning.plannerObjectiveParity &&
    compatibility.unresolvedPlannerSelectedUnitMappings === 0,
  [`legacyUnits=${planning.planningUnitCount}`],
);
check(
  "REQUIRED_TARGET_BINDING_FAIL_CLOSED",
  binding.requiredTargetBoundCount + binding.requiredTargetUnboundCount ===
    binding.unitBindingRequiredTargetCount &&
    binding.productEligibleTargetUnitZeroOverlapCount === 0 &&
    binding.targetSourceIdentityMismatchCount === 0,
  [
    `required=${binding.unitBindingRequiredTargetCount}`,
    `bound=${binding.requiredTargetBoundCount}`,
    `unbound=${binding.requiredTargetUnboundCount}`,
  ],
);
check(
  "AUDIO_PLAYBACK_BINDING_INTEGRITY",
  binding.productEligibleAudioUnitZeroOverlapCount === 0 &&
    binding.productEligiblePlaybackUnitZeroOverlapCount === 0 &&
    binding.playbackWithoutAudioBindingCount === 0 &&
    binding.playbackWithoutTargetBindingCount === 0,
  [
    `audioPairs=${binding.audioUnitPairCount}`,
    `playbackPairs=${binding.playbackUnitPairCount}`,
  ],
);
check(
  "INHERITED_REALIZATION_INTEGRITY",
  inherited.inheritedRealizationUnitZeroOverlapCount === 0 &&
    inherited.inheritedRealizationMissingAudioCount === 0 &&
    inherited.inheritedRealizationMissingPlaybackCount === 0 &&
    inherited.inheritedRealizationSourceMismatchCount === 0,
  [`realizations=${inherited.realizations.length}`],
);
check(
  "EFFECTIVE_REALIZATION_AND_WITNESS_INTEGRITY",
  effective.effectiveProductRealizationCount ===
    effective.realizations.length &&
    witnesses.witnessSearchComplete &&
    witnesses.goldInputCount === 0 &&
    witnesses.groups.every((group) =>
      group.realizationIds.every((id) =>
        effective.realizations.some((row) => row.effectiveRealizationId === id),
      ),
    ),
  [
    `effective=${effective.effectiveProductRealizationCount}`,
    `witnessGroups=${witnesses.witnessGroupCount}`,
  ],
);
check(
  "PROJECTION_AND_NESTED_HASH_INTEGRITY",
  ledger.passed &&
    ledger.staleProjectionHashCount === 0 &&
    preflight.passed &&
    preflight.nestedIntegrityFailureCount === 0,
  [`projectedRows=${ledger.projectedRowCount}`],
);
check(
  "TRUE_ALL_MANDATORY",
  evaluation.allMandatory.itemCount === mandatoryPlan.reviewItemIds.length &&
    evaluation.allMandatory.regionCount === mandatoryPlan.regionIds.length &&
    evaluation.allMandatory.targetCount ===
      mandatoryPlan.reviewTargetIds.length &&
    evaluation.allMandatory.audioCount === mandatoryPlan.audioIds.length &&
    evaluation.allMandatory.playbackSegmentCount ===
      mandatoryPlan.playbackSegmentIds.length &&
    evaluation.allMandatory.uniqueAudioSeconds ===
      mandatoryPlan.uniqueAudioSeconds &&
    evaluation.allMandatory.itemCount < items.items.length &&
    evaluation.allMandatory.regionCount < regions.regions.length,
  [
    `items=${evaluation.allMandatory.itemCount}`,
    `regions=${evaluation.allMandatory.regionCount}`,
    `seconds=${evaluation.allMandatory.uniqueAudioSeconds}`,
  ],
);
check(
  "SCORABILITY_NULLABILITY",
  evaluation.totalComponentCount === 6 &&
    evaluation.scorableComponentCount + evaluation.unscorableComponentCount ===
      evaluation.totalComponentCount &&
    (evaluation.formalRecallStatus === "SCORABLE") ===
      (evaluation.formalRecall !== null) &&
    evaluation.formalRecallStatus === "NOT_SCORABLE" &&
    evaluation.formalRecall === null,
  [
    `scorable=${evaluation.scorableComponentCount}`,
    `unscorable=${evaluation.unscorableComponentCount}`,
  ],
);
check(
  "WITNESS_EVALUATION_BINDING",
  witnessEvaluation.machineFreezeHash === freezeA.semanticHash &&
    witnessEvaluation.witnessGroupHash === witnesses.semanticHash &&
    witnessEvaluation.components.map((row) => row.semanticHash).join("|") ===
      evaluation.components.map((row) => row.semanticHash).join("|"),
);
check(
  "ROUTE_PRIORITY",
  binding.requiredTargetUnboundCount > 0 &&
    route.route === "HOLD_FOR_REVIEW_DELIVERY_UNIT_BINDING_REPAIR" &&
    !route.machineOnlyReleaseAuthorized &&
    route.productionStatus === "needs-review" &&
    route.finalizationMethod === "none" &&
    route.c602Status === "HOLD",
  [`route=${route.route}`],
);
check(
  "REPLAY_ONLY_RUNTIME",
  freezeA.detectorReplaySummary.expected === 18 &&
    freezeA.detectorReplaySummary.hits === 18 &&
    freezeA.detectorReplaySummary.misses === 0 &&
    freezeA.asrReplaySummary.expected === 44 &&
    freezeA.asrReplaySummary.hits === 44 &&
    freezeA.asrReplaySummary.misses === 0 &&
    freezeA.inferenceCount === 0 &&
    freezeA.modelLoadCount === 0 &&
    freezeA.providerProcessStartCount === 0,
);
check(
  "GOLD_BARRIER_AND_READ_ONLY",
  firstRead.freezeBeforeGold &&
    firstRead.machineStageGoldPathReadCount === 0 &&
    firstRead.machineStageGoldDerivedArtifactReadCount === 0 &&
    hash141(postAudit.sourceIdentityBefore) ===
      hash141(postAudit.sourceIdentityAfter) &&
    hash141(postAudit.goldIdentityBefore) ===
      hash141(postAudit.goldIdentityAfter) &&
    postAudit.inferenceCount === 0 &&
    postAudit.modelLoadCount === 0 &&
    postAudit.providerProcessStartCount === 0,
);
check(
  "FREEZE_AND_FINAL_AB_PARITY",
  freezeA.finalRole === "A" &&
    freezeB.finalRole === "B" &&
    parity.finalAFreezeHash === freezeA.semanticHash &&
    parity.finalBFreezeHash === freezeB.semanticHash &&
    parity.semanticParity &&
    parity.geometryParity &&
    parity.wavHashParity &&
    parity.subtitleParity,
);
const reviewJavascriptPaths = [finalA, finalB, reviewPackage].map((root) =>
    path.join(root, "review-workspace", "assets", "review.js"),
  ),
  reviewJavascriptHashes = await Promise.all(
    reviewJavascriptPaths.map(fileHash141),
  ),
  reviewJavascriptSources = await Promise.all(
    reviewJavascriptPaths.map((file) => readFile(file, "utf8")),
  ),
  guardedReviewHydration =
    "]).then(([items,targets,safety,units])=>{c601145Data={items,targets,safety,units};if(state.data)render()}).catch(error=>showStatus(error.message,true));",
  legacyReviewHydration =
    "]).then(([items,targets,safety,units])=>{c601145Data={items,targets,safety,units};render()}).catch(error=>showStatus(error.message,true));";
check(
  "REVIEW_UI_HYDRATION_AND_AB_PARITY",
  new Set(reviewJavascriptHashes).size === 1 &&
    reviewJavascriptHashes[0] === freezeA.reviewJavascriptHash &&
    reviewJavascriptHashes[1] === freezeB.reviewJavascriptHash &&
    reviewJavascriptSources.every(
      (source) =>
        source.split(guardedReviewHydration).length - 1 === 1 &&
        !source.includes(legacyReviewHydration),
    ),
  [`reviewJavascript=${reviewJavascriptHashes[0]}`],
);
check(
  "GEOMETRY_PARITY",
  geometry.plannerGeometryParity &&
    geometry.targetIntervalParity &&
    geometry.regionIntervalParity &&
    geometry.audioByteParity &&
    geometry.playbackIntervalParity,
);

let verifiedWavCount = 0;
for (const root of [finalA, finalB])
  for (const row of audio.audio) {
    const file = path.join(root, "review-workspace", row.relativePath);
    if ((await fileHash141(file)) !== row.sha256)
      throw new Error(`C6011451_WAV_HASH_CHANGED:${row.audioId}`);
    verifiedWavCount++;
  }
check(
  "PHYSICAL_WAV_BYTES",
  verifiedWavCount === audio.audio.length * 2 &&
    audio.audio.every((row) => row.playable && row.hashVerified),
  [`verified=${verifiedWavCount}`],
);
for (const [relativePath, expected] of Object.entries(
  geometry.protectedSubtitleFileHashes,
))
  for (const root of [finalA, finalB])
    if ((await fileHash141(path.join(root, relativePath))) !== expected)
      throw new Error(`C6011451_SUBTITLE_CHANGED:${relativePath}`);
check(
  "SUBTITLE_TEXT_TIMING_PRESENTATION_PARITY",
  freezeA.canonicalTextHash === freezeB.canonicalTextHash &&
    freezeA.canonicalTimingHash === freezeB.canonicalTimingHash &&
    freezeA.presentationHash === freezeB.presentationHash,
  [
    `text=${freezeA.canonicalTextHash}`,
    `timing=${freezeA.canonicalTimingHash}`,
    `presentation=${freezeA.presentationHash}`,
  ],
);
check(
  "NO_RANKER_OR_RELEASE_EXPANSION",
  !policy.rankerRetrained &&
    !policy.machineOnlyReleaseAuthorized &&
    route.c602Status === "HOLD",
);

const shareableSummary = shared.shareableSummary1451Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-5-1-aggregate-shareable-summary",
    visibility: "SHAREABLE_AGGREGATE_ONLY",
    policyVersion: policy.policyVersion,
    policyHash: policy.semanticHash,
    fullRegistryUnitCount: registry.fullRegistryUnitCount,
    registeredVerifiedSpeechUnionSeconds:
      registry.registeredVerifiedSpeechUnionSeconds,
    registeredVerifiedSpeechCoverageRatio:
      registry.registeredVerifiedSpeechCoverageRatio,
    unregisteredVerifiedSpeechSamples:
      registry.unregisteredVerifiedSpeechSamples,
    planningUnitCount: planning.planningUnitCount,
    targetCount: targets.targets.length,
    requiredTargetCount: binding.unitBindingRequiredTargetCount,
    requiredTargetBoundCount: binding.requiredTargetBoundCount,
    requiredTargetUnboundCount: binding.requiredTargetUnboundCount,
    targetUnitPairCount: binding.targetUnitPairCount,
    audioUnitPairCount: binding.audioUnitPairCount,
    playbackUnitPairCount: binding.playbackUnitPairCount,
    inheritedRealizationCount: inherited.realizations.length,
    effectiveProductRealizationCount:
      effective.effectiveProductRealizationCount,
    witnessGroupCount: witnesses.witnessGroupCount,
    singleUnitWitnessCount: witnesses.singleUnitWitnessCandidateCount,
    multiUnitWitnessCount: witnesses.multiUnitWitnessCandidateCount,
    scorableComponentCount: evaluation.scorableComponentCount,
    scorablePassCount: evaluation.scorablePassCount,
    scorableFailCount: evaluation.scorableFailCount,
    unscorableComponentCount: evaluation.unscorableComponentCount,
    formalRecallStatus: evaluation.formalRecallStatus,
    formalRecall: evaluation.formalRecall,
    targetCoreRecall: evaluation.targetCoreRecall,
    ordinaryPhysicalAudioRecall: evaluation.ordinaryPhysicalAudioRecall,
    ordinaryPlaybackAudibleRecall: evaluation.ordinaryPlaybackAudibleRecall,
    hallucinationPlaybackAudibleRecall:
      evaluation.hallucinationPlaybackAudibleRecall,
    mandatory: {
      itemCount: evaluation.allMandatory.itemCount,
      regionCount: evaluation.allMandatory.regionCount,
      targetCount: evaluation.allMandatory.targetCount,
      audioCount: evaluation.allMandatory.audioCount,
      playbackSegmentCount: evaluation.allMandatory.playbackSegmentCount,
      uniqueAudioSeconds: evaluation.allMandatory.uniqueAudioSeconds,
      productScorability: evaluation.allMandatory.productScorability,
      productRecall: evaluation.allMandatory.productRecall,
    },
    machineFreezeHash: freezeA.semanticHash,
    evaluationHash: evaluation.semanticHash,
    routeHash: route.semanticHash,
    route: route.route,
    productionStatus: route.productionStatus,
    finalizationMethod: route.finalizationMethod,
    c602Status: route.c602Status,
  }),
);
const shareableText = JSON.stringify(shareableSummary);
const matchCount = (pattern: RegExp) =>
  shareableText.match(pattern)?.length ?? 0;
const absolutePathLeakCount = matchCount(
    /(?:file:\/\/|\/Users\/|\/home\/|[A-Za-z]:\\\\|\/private\/var\/|\/tmp\/)/gu,
  ),
  secretFindingCount = matchCount(
    /(?:sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/gu,
  ),
  rawAudioReferenceCount = matchCount(/(?:\.wav\b|\/audio\/)/giu),
  dialogueTextFindingCount = matchCount(/[\u3040-\u30ff\u3400-\u9fff]/gu),
  goldContentFindingCount = matchCount(
    /(?:goldText|goldTranscript|goldInterval|goldCue)/giu,
  ),
  credentialFindingCount = matchCount(
    /(?:password|passwd|authorization|bearer\s+[A-Za-z0-9._-]+)/giu,
  );
const shareableAudit = shared.shareableAudit1451Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-5-1-shareable-audit",
    visibility: "SHAREABLE_AUDIT",
    summaryHash: shareableSummary.semanticHash,
    pathPolicy: "NO_ABSOLUTE_OR_LOCAL_PATHS",
    aggregateOnly: true,
    absolutePathLeakCount,
    secretFindingCount,
    rawAudioReferenceCount,
    dialogueTextFindingCount,
    goldContentFindingCount,
    credentialFindingCount,
    passed:
      absolutePathLeakCount === 0 &&
      secretFindingCount === 0 &&
      rawAudioReferenceCount === 0 &&
      dialogueTextFindingCount === 0 &&
      goldContentFindingCount === 0 &&
      credentialFindingCount === 0,
  }),
);
check("SHAREABLE_AGGREGATE_ONLY", shareableAudit.passed, [
  `summary=${shareableSummary.semanticHash}`,
  `absolutePathLeaks=${shareableAudit.absolutePathLeakCount}`,
  `secrets=${shareableAudit.secretFindingCount}`,
  `rawAudio=${shareableAudit.rawAudioReferenceCount}`,
  `dialogueText=${shareableAudit.dialogueTextFindingCount}`,
  `goldContent=${shareableAudit.goldContentFindingCount}`,
  `credentials=${shareableAudit.credentialFindingCount}`,
]);
const shareableRoot = path.join(validationRoot, "shareable");
await mkdir(shareableRoot, { recursive: true });
await durableJson141(
  path.join(shareableRoot, "c6-0-1-14-5-1-aggregate-shareable-summary.json"),
  shareableSummary,
);
await durableJson141(
  path.join(shareableRoot, "c6-0-1-14-5-1-shareable-audit.json"),
  shareableAudit,
);

const validation = shared.validation1451Schema.parse(
  hashed141({
    ...header1451(policy, registry.sourceIdentity),
    artifactType: "c6-0-1-14-5-1-validation",
    checks,
    passedCount: checks.length,
    failedCount: 0,
    allPassed: true,
  }),
);
await durableJson141(
  path.join(validationRoot, "c6-0-1-14-5-1-validation.json"),
  validation,
);
console.log(
  JSON.stringify(
    {
      validationRoot,
      passed: validation.passedCount,
      failed: validation.failedCount,
      route: route.route,
      formalRecall: evaluation.formalRecall,
      scorable: evaluation.scorableComponentCount,
      unscorable: evaluation.unscorableComponentCount,
    },
    null,
    2,
  ),
);
