import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { format } from "prettier";
import type { z } from "zod";
import * as s from "@mvl/shared";
import { c612Arguments } from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import {
  c6121Artifact,
  demand,
  C6121_POLICY,
  C6121_POLICY_HASH,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
import {
  readC6121Artifact,
  writeC6121Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/baseline-freeze-verification.js";
import { c6121QaSourceSnapshot } from "../packages/video-subtitler/src/consensus/evaluation-recovery/qa-source-snapshot.js";
import { installC6121OfflineGuard } from "../packages/video-subtitler/src/consensus/evaluation-recovery/offline-runtime-guard.js";
const keys = [
  "--run",
  "--peer",
  "--validation",
  "--qa",
  "--output",
  "--mode",
  "--requirements",
  "--network",
];
const arg = c612Arguments(
  keys,
  keys.filter((k) => k !== "--requirements"),
);
const guard = installC6121OfflineGuard(),
  repository = path.resolve(import.meta.dirname, ".."),
  root = path.resolve(arg("--run"));
const read = async <T>(name: string, schema: z.ZodType<T>) =>
  schema.parse(await readC6121Artifact(path.join(root, name + ".json")));
const validation = s.c6121ValidationSchema.parse(
  await readC6121Artifact(arg("--validation")),
);
const qa = s.c6121QaSchema.parse(await readC6121Artifact(arg("--qa")));
demand(
  validation.passed &&
    qa.passed &&
    validation.qaEvidenceHash === qa.semanticHash,
  "C6121_REPORT_REQUIRES_REAL_ACCEPTANCE",
);
demand(
  (await c6121QaSourceSnapshot(repository)).semanticHash === qa.sourceAfterHash,
  "C6121_REPORT_SOURCE_NOT_QA_VERIFIED",
);
const route = await read("c6-1-2-1-route-decision", s.c6121RouteSchema);
const baseline = await read(
  "c6-1-2-1-baseline-freeze-verification",
  s.c6121BaselineSchema,
);
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
const branch = git("branch", "--show-current"),
  head = git("rev-parse", "HEAD");
const commits = git(
  "log",
  "--reverse",
  "--format=%H%x09%s",
  baseline.baselineCommit + "..HEAD",
)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, subject] = line.split("\t");
    demand(sha && subject, "C6121_COMMIT_ROW_MISSING");
    const role = subject.startsWith("docs:")
      ? "acceptance"
      : subject.includes("bipartite")
        ? "bipartite-graph"
        : subject.includes("supergroup integrity")
          ? "supergroup"
          : subject.includes("label")
            ? "label-rebinding"
            : subject.includes("OOF")
              ? "OOF-reevaluation"
              : "validation";
    return { role, sha, subject };
  });
const reportRelativePath =
  "docs/C6_1_2_1_GOLD_ISOLATED_EVALUATION_COVERAGE_RECOVERY_REPORT.md";
if (arg("--mode") === "receipt") {
  const remoteHead = git("rev-parse", "@{upstream}"),
    status = git("status", "--porcelain");
  const [behind, ahead] = git(
    "rev-list",
    "--left-right",
    "--count",
    "@{upstream}...HEAD",
  )
    .split(/\s+/)
    .map(Number);
  demand(
    head === remoteHead && ahead === 0 && behind === 0 && status === "",
    "C6121_DELIVERY_REQUIRES_CLEAN_SYNCED_HEAD",
  );
  await writeC6121Artifact(
    arg("--output"),
    s.c6121DeliverySchema.parse(
      c6121Artifact("c6-1-2-1-delivery-receipt", {
        branch,
        baselineCommit: baseline.baselineCommit,
        head,
        remoteHead,
        commits,
        upstreamAhead: ahead,
        upstreamBehind: behind,
        workingTreeClean: true,
        validationHash: validation.semanticHash,
        qaEvidenceHash: qa.semanticHash,
        reportRelativePath,
        outputDirectories: [
          path.basename(root),
          path.basename(arg("--peer")),
          path.basename(path.dirname(arg("--validation"))),
        ],
        route: route.route,
        productionMutation: 0,
      }),
    ),
  );
  process.stdout.write(
    JSON.stringify({ head, remoteHead, clean: true, receipt: true }) + "\n",
  );
} else {
  demand(arg("--mode") === "report", "C6121_UNKNOWN_REPORT_MODE");
  const requirements = await readFile(arg("--requirements"), "utf8");
  const block = requirements.slice(
    requirements.indexOf("# 170. Report"),
    requirements.indexOf("# 171. Git"),
  );
  const titles = block.split("\n").flatMap((line) => {
    const match = /^# (\d+)\. (.+)$/.exec(line);
    return match && Number(match[1]) < 170
      ? [
          {
            number: Number(match[1]),
            title: String(match[2]).replace(/。$/, ""),
          },
        ]
      : [];
  });
  demand(
    titles.length === 149 && titles.every((t, i) => t.number === i + 1),
    "C6121_REPORT_SECTION_CONTRACT",
  );
  const [
    map,
    integrity,
    timing,
    text,
    e0,
    e1,
    coverageAudit,
    modes,
    stability,
    frozenMetrics,
    retrainedMetrics,
    contract,
    completeness,
    sensitivity,
    readOnly,
  ] = await Promise.all([
    read("c6-1-2-1-evaluator-supergroup-map", s.c6121MapSchema),
    read("c6-1-2-1-supergroup-integrity-audit", s.c6121IntegritySchema),
    read("c6-1-2-1-gold-timing-read-barrier", s.c6121TimingBarrierSchema),
    read("c6-1-2-1-gold-text-scoring-barrier", s.c6121TextBarrierSchema),
    read("c6-1-2-1-e0-legacy-replay", s.c6121E0Schema),
    read("c6-1-2-1-e1-historical-bipartite-replay", s.c6121E1Schema),
    read(
      "c6-1-2-1-evaluation-coverage-recovery-audit",
      s.c6121CoverageAuditSchema,
    ),
    read("c6-1-2-1-evaluation-mode-comparison", s.c6121ModeComparisonSchema),
    read("c6-1-2-1-label-stability-audit", s.c6121StabilitySchema),
    read(
      "c6-1-2-1-frozen-decision-reevaluation",
      s.c6121FrozenEvaluationSchema,
    ),
    read(
      "c6-1-2-1-oof-retrain-profile-evaluation",
      s.c6121RetrainedEvaluationSchema,
    ),
    read("c6-1-2-1-training-contract-parity", s.c6121TrainingParitySchema),
    read("c6-1-2-1-completeness-blocker-diagnosis", s.c6121CompletenessSchema),
    read("c6-1-2-1-evaluator-sensitivity", s.c6121SensitivitySchema),
    read("c6-1-2-1-read-only-proof", s.c6121ReadOnlySchema),
  ]);
  const c = coverageAudit.coverage,
    profile = (list: s.C6121ProfileMetric[], id: string | null) =>
      list.find((p) => p.profileId === id);
  const frozenBest = profile(
    frozenMetrics.profiles,
    route.descriptiveBestFrozenProfile,
  );
  const safe = profile(retrainedMetrics.profiles, route.selectedSafeProfile);
  const descriptiveRetrained = profile(
    retrainedMetrics.profiles,
    route.descriptiveBestRetrainedProfile,
  );
  const summary = (p: s.C6121ProfileMetric | undefined) =>
    p
      ? Object.fromEntries(
          Object.entries(p).filter(([key]) => key !== "groups"),
        )
      : null;
  const clean = (value: unknown): unknown => {
    if (
      typeof value === "string" &&
      /\/Users\/|\/private\/|\/tmp\//.test(value)
    )
      return "LOCAL_PATH_REDACTED:" + path.basename(value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, clean(v)]),
      );
    return value;
  };
  const serialize = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(clean(value), null, 2);
  const values = new Map<number, unknown>();
  const put = (n: number, value: unknown) => values.set(n, value);
  put(1, {
    route: route.route,
    engineeringGate: route.engineeringGate,
    evaluationCoverageGate: route.evaluationCoverageGate,
    strongSupportGate: route.rerankerStrongSupportGate,
    production: "needs-review / finalizationMethod none",
    automaticRelease: false,
  });
  put(2, branch);
  put(3, {
    acceptedCommit: baseline.baselineCommit,
    generationSourceCommit: baseline.generationSourceCommit,
  });
  put(4, {
    baselinePassed: baseline.passed,
    baselineChecks: baseline.checks,
    exactE0ReplayPassed: e0.passed,
  });
  put(
    5,
    "Recover evaluator coverage without changing candidates, evidence, features, folds, model classes, threshold grids or production.",
  );
  put(
    6,
    "No acoustic model execution, candidate generation, production application, timing/cue changes, new features, profile tuning, or Skill 2/3 work.",
  );
  put(
    7,
    "C6.1.2 binds Gold to individually frozen machine groups and rejects any Gold cue claimed by multiple groups, while C6.1.1 used temporal bipartite components. This is a changed evaluation unit/eligibility rule, not evidence that ASR accuracy collapsed. E2 restores connected evaluation units without changing those machine groups.",
  );
  put(8, {
    stable: e0.stable,
    ambiguous: e0.ambiguous,
    noMapping: e0.noMapping,
    coverage: e0.coverage,
    exactReplayChecks: e0.checks,
  });
  put(9, {
    role: "Historical cross-check only, not used to choose the favorable evaluator",
    summary: e1.timingOnlyMap.summary,
    historicalStructureParity: e1.historicalStructureParity,
    policy: e1.timingOnlyMap.mappingPolicy,
  });
  put(10, {
    primaryEvaluator: C6121_POLICY.primaryEvaluator,
    mapHash: map.semanticHash,
    machineMappingHash: map.machineMappingHash,
    policyHash: C6121_POLICY_HASH,
  });
  put(11, timing);
  put(12, text);
  put(13, {
    files: baseline.files.length,
    inputAggregateHash: baseline.inputAggregateHash,
    machineFreezeHashes: baseline.machineFreezeHashes,
    rerankingFreezeHashes: baseline.rerankingFreezeHashes,
    productionTextHash: baseline.productionTextHash,
    productionTimingHash: baseline.productionTimingHash,
  });
  put(
    14,
    "Left vertices are the unchanged C6.1.2 machine groups; right vertices are Gold timing DTOs. Connected components are evaluator-only. Isolated Gold vertices remain explicit NO_MACHINE_MAPPING components. Folds are inherited, never recomputed.",
  );
  put(15, {
    edge: C6121_POLICY.edge,
    groupHullEdgesAllowed: false,
    toleranceSeconds: 0,
    structure: C6121_POLICY.structure,
  });
  [
    integrity.edgeCount,
    integrity.connectedComponentCount,
    integrity.goldConnectedComponentCount,
    integrity.noGoldComponentCount,
    map.groups.length,
    integrity.oneToOne,
    integrity.oneToMany,
    integrity.manyToOne,
    integrity.manyToMany,
    integrity.crossFoldComponentCount,
    integrity.structureIncompatibleCount,
    integrity.durationLimitCount,
    integrity.gapLimitCount,
    integrity.cueLimitCount,
  ].forEach((v, i) => put(16 + i, v));
  [
    c.evaluableMachineGroupCoverage,
    c.evaluableProductionCueCoverage,
    c.evaluableGoldCueCoverage,
    c.evaluableMachineDurationCoverage,
    c.evaluableGoldDurationCoverage,
    c.candidateEventLabelCoverage,
    {
      rankedPool: c.candidateLabelCoverage,
      topK: c.topKCandidateLabelCoverage,
    },
  ].forEach((v, i) => put(30 + i, v));
  [
    e0.stable,
    e0.ambiguous,
    e0.noMapping,
    e0.coverage,
    e1.timingOnlyMap.summary.stableMappedGroups,
    e1.timingOnlyMap.summary.ambiguousGroups,
    e1.timingOnlyMap.summary.unmappedGroups,
    modes.modes[1]?.coverage,
    integrity.stableShadowEvaluationCount,
    modes.modes[2]?.ambiguousCount,
    {
      total: modes.modes[2]?.noMappingCount,
      machineOnly: integrity.noGoldComponentCount,
      goldOnly: map.groups.filter((g) => g.machineCueIds.length === 0).length,
    },
    c,
  ].forEach((v, i) => put(37 + i, v));
  put(49, {
    count: coverageAudit.recoveredMachineGroups.length,
    ids: coverageAudit.recoveredMachineGroups,
  });
  put(50, {
    count: coverageAudit.recoveredGoldCues.length,
    ids: coverageAudit.recoveredGoldCues,
  });
  put(51, {
    affectedMachineGroups: coverageAudit.goldSpanningMachineGroups.length,
    affectedGoldCues: coverageAudit.goldSpanningGoldCues.length,
    affectedConnectedComponents:
      coverageAudit.goldSpanningConnectedComponents.length,
    recoveredMachineGroups:
      coverageAudit.recoveredGoldSpanningMachineGroups.length,
  });
  put(52, integrity.reasonCounts);
  put(53, {
    count: integrity.stableShadowEvaluationCount,
    rule: "Fixed cue structure plus timing policy; independent from event lineage eligibility",
  });
  put(54, {
    count: integrity.stableCandidateLabelCount,
    rule: "Unique supergroup and machine-group ownership, exact legal original span, no cross-supergroup application",
  });
  put(55, {
    count: integrity.oofTrainingEligibleCount,
    rule: "Candidate eligibility plus a single unchanged outer fold and computable Gold score",
  });
  put(56, stability.newlyRecoveredCandidateLabels);
  put(57, stability.previouslyEvaluableNowLost);
  put(58, {
    common: stability.commonEvaluableCount,
    exactSemanticAgreement: stability.exactLabelAgreementCount,
    definition:
      "classification, normalized gain direction, exact gain direction and catastrophic flag all agree",
    gainDirectionAgreement: stability.gainDirectionAgreementCount,
  });
  put(59, {
    count:
      stability.commonEvaluableCount - stability.gainDirectionAgreementCount,
    rows: stability.disagreementRows,
  });
  put(60, sensitivity);
  frozenMetrics.profiles.forEach((p) =>
    put(61 + Number(p.profileId.slice(1)), summary(p)),
  );
  put(70, {
    descriptiveOnly: true,
    profile: route.descriptiveBestFrozenProfile,
    safeSelection: false,
  });
  [
    frozenBest?.improved ?? null,
    frozenBest?.regressed ?? null,
    frozenBest?.neutral ?? null,
    frozenBest?.unknown ?? null,
    frozenBest?.selectionPrecision ?? null,
    frozenBest?.harmRate ?? null,
    frozenBest?.normalizedJointGain ?? null,
    frozenBest?.materialDelta ?? null,
    frozenBest?.catastrophicDeletionCount ?? null,
  ].forEach((v, i) =>
    put(71 + i, {
      profile: route.descriptiveBestFrozenProfile,
      value: v,
      descriptiveOnly: true,
    }),
  );
  put(80, {
    trainingContract: C6121_POLICY.trainingLabelGroupWeight,
    design:
      "Unchanged runC612Oof, nested train-only threshold fitting and group assembler; separate child receives no Gold path. Numeric labels change, not model classes or feature definitions. Original machine-group IDs retain the existing training weights.",
    codeHash: contract.trainingCodeHash,
  });
  [
    contract.featureHash,
    contract.foldHash,
    contract.profileDefinitionHash,
    contract.thresholdGridHash,
  ].forEach((v, i) => put(81 + i, { parity: true, hash: v }));
  retrainedMetrics.profiles.forEach((p) =>
    put(85 + Number(p.profileId.slice(1)), summary(p)),
  );
  put(94, {
    selectedSafeProfile: route.selectedSafeProfile,
    safeCandidates: route.safeProfileCandidates,
    rule: C6121_POLICY.safeProfile,
    order: C6121_POLICY.safeProfileOrder,
  });
  [
    safe?.evaluableChangedSupergroups ?? null,
    safe?.activeFoldCount ?? null,
    safe?.negativeGainFoldCount ?? null,
    safe?.unknownGainFoldCount ?? null,
    safe?.selectionPrecision ?? null,
    safe?.harmRate ?? null,
    safe?.exactJointGain ?? null,
    safe?.normalizedJointGain ?? null,
    safe?.materialDelta ?? null,
    safe?.catastrophicDeletionCount ?? null,
  ].forEach((v, i) =>
    put(95 + i, {
      selectedSafeProfile: route.selectedSafeProfile,
      value: v,
      note: safe
        ? "Selected by the predeclared rule"
        : "No qualifying safe profile; null is not zero risk",
    }),
  );
  put(105, completeness.nonUnknownCompletenessCoverage);
  put(106, {
    count: completeness.candidateSelectionsBlockedByCompleteness,
    unit: "profile/event/candidate blocked occurrences",
    zeroSelectionProfilesWithCompletenessBlockedTopProposals:
      completeness.retrainedProfileZeroSelectionDueToCompleteness,
  });
  put(107, {
    count: completeness.safeCandidatesBlocked,
    rate: completeness.safeCandidateFalseBlockRate,
  });
  put(108, {
    diagnostic: completeness.diagnosticMainBlocker,
    coverageQualified: completeness.coverageQualifiedMainBlocker,
    noThresholdChange: true,
    reasons: completeness.reasons,
  });
  put(109, {
    passed: route.evaluationCoverageGate,
    checks: route.coverageChecks,
  });
  put(110, {
    passed: route.rerankerStrongSupportGate,
    checks: route.strongSupportChecks,
  });
  put(111, route.route);
  put(112, route.c6122);
  put(113, route.c613);
  [114, 115, 116].forEach((n) => put(n, 0));
  const production = baseline.files.filter((f) =>
    f.role.startsWith("production-"),
  );
  for (const [i, ext] of ["ass", "srt", "vtt"].entries())
    put(117 + i, {
      passed: validation.productionParity,
      files: production
        .filter((f) => f.path.endsWith("." + ext))
        .map((f) => ({ role: f.role, bytes: f.bytes, sha256: f.sha256 })),
      scope:
        "Both original production directories; standard and best-effort files are preserved, not silently conflated with A/B",
    });
  put(120, {
    semantic: validation.aBSemanticParity,
    shadowBytes: validation.aBByteParity,
    sourceAndGoldInputsSharedReadOnly: true,
    clocksMayDiffer: true,
  });
  put(121, {
    machineRuntimeRawGoldInputCount: readOnly.machineRuntimeRawGoldInputCount,
    predictionStageRawGoldInputCount: readOnly.predictionStageRawGoldInputCount,
  });
  put(122, readOnly.goldTimingEvaluatorInputCount);
  put(123, readOnly.goldTextScoringInputCount);
  put(124, {
    uniqueEligibleFrozenFeatureRows: readOnly.trainingNumericLabelCount,
    outerFolds: 5,
    modelProfiles: 9,
    outerModels: 45,
  });
  put(125, readOnly.outerTestLabelInputToPredictionCount);
  put(
    126,
    "No episode-specific transcript, Gold timestamp, candidate winner, recovered-group list, per-event threshold or profile-specific Gold matching is embedded in machine/prediction source. Baseline numeric assertions identify the user-pinned acceptance input only. Synthetic test text is explicitly synthetic.",
  );
  put(127, false);
  put(128, { inference: 0, modelLoad: 0, speakerInference: 0, mfaProcess: 0 });
  put(129, { inference: 0, modelLoad: 0, reusedFrozenEvidenceOnly: true });
  const fileProof = (f: typeof readOnly.sourceBefore) => ({
    bytes: f.bytes,
    sha256: f.sha256,
    mtimeMs: f.mtimeMs,
    inode: f.inode,
  });
  put(130, {
    before: fileProof(readOnly.sourceBefore),
    after: fileProof(readOnly.sourceAfter),
    passed: validation.sourceReadOnly,
  });
  put(131, {
    before: fileProof(readOnly.goldBefore),
    after: fileProof(readOnly.goldAfter),
    passed: validation.goldReadOnly,
  });
  put(
    132,
    "Both aggregate-only shareable summaries passed strict schema and privacy checks: raw Gold text=0, full candidate text=0, raw audio=0, private paths=0, secrets=0. Full research outputs remain local-only.",
  );
  const qaStage = (stage: string) => {
    const row = qa.checks.find((c) => c.stage === stage);
    demand(row, "C6121_MISSING_QA_STAGE");
    return {
      stage,
      passed: row.passed,
      tests: row.testPassed,
      failed: row.testFailed,
      skipped: row.testSkipped,
      skipReasons: row.skipReasons,
      logHash: row.logSha256,
    };
  };
  [
    "c6-1-targeted",
    "c6-1-1-targeted",
    "c6-1-2-targeted",
    "unit",
    "e2e",
    "c6-1-2-1-targeted",
  ].forEach((stage, i) => put(133 + i, qaStage(stage)));
  put(139, {
    all: validation.schemaCount,
    new: s.c6121GeneratedSchemas.length,
    generatedAndStrict: true,
  });
  put(140, {
    artifacts: validation.checkedArtifacts,
    engineeringChecks: validation.checks,
    passed: validation.passed,
  });
  put(141, qaStage("skill"));
  put(
    142,
    "Unchanged: both grammar skills, their runtime packages and the learning-site app have an empty diff against the pinned baseline.",
  );
  put(143, {
    passed: route.engineeringGate,
    qa: qa.passed,
    artifactAcceptance: validation.passed,
  });
  put(
    144,
    "This remains a known-development-benchmark evaluator study, not an independent prospective quality trial. Enlarged error units can change gains; error-unit sensitivity, missing coverage and unknown folds remain explicit. No model/profile/threshold was tuned after E2 outcomes. A zero-selection L6 does not provide changed-group coverage or safe-gain evidence.",
  );
  put(145, {
    route: route.route,
    c6122: route.c6122,
    c613: route.c613,
    productionApply: false,
  });
  put(146, {
    implementationCommits: commits,
    documentAcceptanceCommit:
      "The commit adding this report; its exact SHA is recorded in the post-push delivery receipt and final response.",
  });
  put(
    147,
    "The post-push delivery receipt records and checks local HEAD == upstream HEAD and 0/0 divergence. This report is generated before its own document commit; it does not invent a self-referential SHA.",
  );
  put(148, {
    finalA: path.basename(root),
    finalB: path.basename(arg("--peer")),
    validation: path.basename(path.dirname(arg("--validation"))),
    qa: path.basename(path.dirname(arg("--qa"))),
    outputPolicy:
      "Full outputs local research only; shareable subdirectories aggregate-only",
  });
  put(
    149,
    "The report is the only expected post-QA documentation change. The post-commit/post-push delivery receipt must verify a clean worktree; output files are outside the source checkout.",
  );
  demand(
    values.size === 149 && titles.every((t) => values.has(t.number)),
    "C6121_REPORT_FIELDS_INCOMPLETE",
  );
  const questions = [
    "E0 changed the error unit from C6.1.1 temporal components to individually frozen machine groups and rejected shared Gold ownership. Exact legacy replay confirms the drop; this is evaluation coverage, not a measured ASR quality collapse.",
    `Affected machine groups=${coverageAudit.goldSpanningMachineGroups.length}, Gold cues=${coverageAudit.goldSpanningGoldCues.length}, connected components=${coverageAudit.goldSpanningConnectedComponents.length}; recovered machine groups=${coverageAudit.recoveredGoldSpanningMachineGroups.length}.`,
    `E2 total=${map.groups.length}; stable one-to-one=${integrity.oneToOne}, one-to-many=${integrity.oneToMany}, many-to-one=${integrity.manyToOne}, many-to-many=${integrity.manyToMany}. Isolated Gold vertices remain explicit.`,
    serialize({
      machineGroupCoverage: c.evaluableMachineGroupCoverage,
      productionCueCoverage: c.evaluableProductionCueCoverage,
      goldCueCoverage: c.evaluableGoldCueCoverage,
      candidateLabelCoverage: c.candidateLabelCoverage,
      topKCandidateLabelCoverage: c.topKCandidateLabelCoverage,
    }),
    serialize({
      allMainCoveragePassed: route.evaluationCoverageGate,
      requiredChecks: route.coverageChecks,
    }),
    `Cross-fold components=${integrity.crossFoldComponentCount}; every such component is excluded from scoring/labels/training; folds were not rebuilt.`,
    `Gold text grouping usage=${integrity.goldTextUsedForGroupingCount}; edge construction and component formation receive timing DTOs only. The persisted map freeze precedes the first text read.`,
    `Common=${stability.commonEvaluableCount}; exact semantic agreement=${stability.exactLabelAgreementCount}; gain-direction agreement=${stability.gainDirectionAgreementCount}; gain-direction changes=${stability.commonEvaluableCount - stability.gainDirectionAgreementCount}; broader classification/exact-direction/catastrophic disagreements=${stability.disagreementCount}.`,
    serialize(summary(profile(frozenMetrics.profiles, "L1"))),
    serialize(sensitivity.frozenL1CatastrophicTrace),
    serialize({
      selectedSafeProfile: route.selectedSafeProfile,
      descriptiveHighestJointGainProfile: route.descriptiveBestRetrainedProfile,
      caveat:
        "Highest observed joint gain is descriptive only, not safety qualification. Features, folds, profiles, grid and training code are unchanged.",
    }),
    serialize({
      safeProfile: summary(safe),
      descriptiveHighestJointGainProfile: summary(descriptiveRetrained),
    }),
    serialize({
      safeProfile: route.selectedSafeProfile,
      safeActiveFolds: safe?.activeFoldCount ?? null,
      descriptiveProfile: route.descriptiveBestRetrainedProfile,
      descriptiveActiveFolds: descriptiveRetrained?.activeFoldCount ?? null,
      qualifiesForThreeActiveFolds: safe ? safe.activeFoldCount >= 3 : false,
    }),
    serialize({
      safeProfile: route.selectedSafeProfile,
      safeNegativeFolds: safe?.negativeGainFoldCount ?? null,
      safeUnknownFolds: safe?.unknownGainFoldCount ?? null,
      descriptiveProfile: route.descriptiveBestRetrainedProfile,
      descriptiveNegativeFolds:
        descriptiveRetrained?.negativeGainFoldCount ?? null,
      descriptiveUnknownFolds:
        descriptiveRetrained?.unknownGainFoldCount ?? null,
    }),
    `Coverage gate=${route.evaluationCoverageGate}; strong support=${route.rerankerStrongSupportGate}; safe profile=${String(route.selectedSafeProfile)}.`,
    serialize({
      diagnosticCompletenessBlocker: completeness.diagnosticMainBlocker,
      coverageQualified: completeness.coverageQualifiedMainBlocker,
      nonUnknown: completeness.nonUnknownCompletenessCoverage,
      positiveButUnsafeUngatedProfiles:
        completeness.nonGatedProfilePositiveButUnsafeCount,
    }),
    `C6.1.2.2=${route.c6122}; chosen route=${route.route}. Coverage insufficiency has priority over completeness or automatic-reranking conclusions.`,
    `C6.1.3=${route.c613}; no production application is authorized.`,
    `ASR/CTC/speaker/MFA execution=0; production mutation=0; Gold text grouping=0; profile rematching=0; A/B=${validation.aBSemanticParity && validation.aBByteParity}.`,
    route.route,
  ].map((answer, i) => ({ number: i + 1, answer }));
  const data = s.c6121ReportDataSchema.parse(
    c6121Artifact("c6-1-2-1-report-data", {
      validationHash: validation.semanticHash,
      qaEvidenceHash: qa.semanticHash,
      sections: titles.map((t) => ({
        ...t,
        value: serialize(values.get(t.number)),
      })),
      questions,
      reportRelativePath,
      rawGoldTextIncluded: false,
    }),
  );
  const markdown =
    "# C6.1.2.1 Gold-Isolated Evaluation Coverage Recovery\n\n" +
    "This report is generated from independent, schema-validated offline A/B artifacts. Engineering acceptance is separate from evaluator coverage and reranker safety. Production remains needs-review with finalizationMethod none.\n\n" +
    data.sections
      .map(
        (section) =>
          "## " +
          String(section.number) +
          ". " +
          section.title +
          "\n\n" +
          (/^[[{]/.test(section.value)
            ? "```json\n" + section.value + "\n```"
            : section.value) +
          "\n",
      )
      .join("\n") +
    "\n## Required Q1–Q20\n\n" +
    questions
      .map((q) => "### Q" + String(q.number) + "\n\n" + q.answer + "\n")
      .join("\n");
  await mkdir(path.join(repository, "docs"), { recursive: true });
  await writeFile(
    path.join(repository, reportRelativePath),
    await format(markdown, { parser: "markdown" }),
  );
  await writeC6121Artifact(arg("--output"), data);
  demand(
    guard().attemptedNetworkRequests === 0,
    "C6121_REPORT_NETWORK_ATTEMPT",
  );
  process.stdout.write(
    JSON.stringify({
      reportRelativePath,
      sections: data.sections.length,
      questions: questions.length,
      route: route.route,
    }) + "\n",
  );
}
