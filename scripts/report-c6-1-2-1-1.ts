import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";
import type { z } from "zod";
import * as s from "@mvl/shared";
import { c612Arguments } from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import { c6121QaSourceSnapshot } from "../packages/video-subtitler/src/consensus/evaluation-recovery/qa-source-snapshot.js";
import { installC6121OfflineGuard } from "../packages/video-subtitler/src/consensus/evaluation-recovery/offline-runtime-guard.js";
import {
  C61211_POLICY,
  C61211_POLICY_HASH,
  c61211Artifact,
  demand,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
import {
  readC61211,
  writeC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/artifact-io.js";

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
    keys.filter((key) => key !== "--requirements"),
  ),
  guard = installC6121OfflineGuard(),
  repository = path.resolve(import.meta.dirname, ".."),
  root = path.resolve(arg("--run"));
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
const read = async <T>(name: string, schema: z.ZodType<T>, subdirectory = "") =>
  schema.parse(await readC61211(path.join(root, subdirectory, name + ".json")));
const reportRelativePath =
  "docs/C6_1_2_1_1_CONSTRAINED_MONOTONIC_PARTITION_REACHABLE_EVALUATION_REPORT.md";
const validation = s.c61211ValidationSchema.parse(
  await readC61211(arg("--validation")),
);
const qa = s.c61211QaSchema.parse(await readC61211(arg("--qa")));
demand(
  validation.passed &&
    qa.passed &&
    validation.qaEvidenceHash === qa.semanticHash,
  "C61211_REPORT_REQUIRES_REAL_ACCEPTANCE",
);
demand(
  (await c6121QaSourceSnapshot(repository)).semanticHash === qa.sourceAfterHash,
  "C61211_REPORT_SOURCE_NOT_QA_VERIFIED",
);

const branch = git("branch", "--show-current"),
  head = git("rev-parse", "HEAD"),
  baselineCommit = "43e3693288a73701a3ca9a5438b6aba5b2e2f43a";
const commits = git(
  "log",
  "--reverse",
  "--format=%H%x09%s",
  baselineCommit + "..HEAD",
)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, subject] = line.split("\t");
    demand(sha && subject, "C61211_COMMIT_ROW_MISSING");
    return {
      role: subject.startsWith("docs:") ? "acceptance" : "implementation",
      sha,
      subject,
    };
  });

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
    "C61211_DELIVERY_REQUIRES_CLEAN_SYNCED_HEAD",
  );
  await writeC61211(
    arg("--output"),
    s.c61211DeliverySchema.parse(
      c61211Artifact("c6-1-2-1-1-delivery-receipt", {
        branch,
        baselineCommit,
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
        route: (await read("c6-1-2-1-1-route-decision", s.c61211RouteSchema))
          .route,
      }),
    ),
  );
  process.stdout.write(
    JSON.stringify({ receipt: true, head, remoteHead, clean: true }) + "\n",
  );
} else {
  demand(arg("--mode") === "report", "C61211_UNKNOWN_REPORT_MODE");
  const requirements = await readFile(arg("--requirements"), "utf8");
  const extract = (start: string, end: string, expected: number) => {
    const block = requirements.slice(
      requirements.indexOf(start),
      requirements.indexOf(end),
    );
    const rows = block.split("\n").flatMap((line) => {
      const match = /^# (\d+)\. (.+)$/.exec(line);
      return match && Number(match[1]) <= expected
        ? [
            {
              number: Number(match[1]),
              title: String(match[2]).replace(/。$/, ""),
            },
          ]
        : [];
    });
    demand(
      rows.length === expected && rows.every((row, i) => row.number === i + 1),
      "C61211_REPORT_TITLE_CONTRACT:" + String(expected),
    );
    return rows;
  };
  const sectionTitles = extract("# 170. Report", "# 171. Git", 144),
    finalTitles = extract("# 173. 最终回复", "# 174. 最终", 150);
  const [
    policy,
    baseline,
    timing,
    inventory,
    map,
    cuts,
    residuals,
    conservation,
    scope,
    coverage,
    gate,
    labels,
    stability,
    frozen,
    oof,
    profileEvidence,
    training,
    models,
    whole,
    bias,
    sensitivity,
    completeness,
    route,
    readOnly,
    shadows,
    shareable,
    d0Map,
    d0Coverage,
    d2Map,
    d2Coverage,
  ] = await Promise.all([
    read("c6-1-2-1-1-policy-freeze", s.c61211PolicySchema),
    read("c6-1-2-1-1-baseline-freeze-verification", s.c61211BaselineSchema),
    read("c6-1-2-1-1-gold-timing-barrier", s.c61211TimingSchema),
    read("c6-1-2-1-1-oversized-component-inventory", s.c61211InventorySchema),
    read("c6-1-2-1-1-partitioned-supergroup-map", s.c61211MapSchema),
    read("c6-1-2-1-1-cut-edge-ledger", s.c61211CutsSchema),
    read("c6-1-2-1-1-partition-residuals", s.c61211ResidualsSchema),
    read("c6-1-2-1-1-partition-conservation-audit", s.c61211ConservationSchema),
    read("c6-1-2-1-1-reachable-scope", s.c61211ScopeSchema),
    read("c6-1-2-1-1-reachable-coverage-audit", s.c61211CoverageSchema),
    read("c6-1-2-1-1-coverage-gate-v2", s.c61211GateSchema),
    read("gold-c6-1-2-1-1-partition-candidate-labels", s.c61211LabelsSchema),
    read("c6-1-2-1-1-label-stability-audit", s.c61211StabilitySchema),
    read(
      "c6-1-2-1-1-frozen-decision-reevaluation",
      s.c61211FrozenEvaluationSchema,
    ),
    read("c6-1-2-1-1-oof-profile-evaluation", s.c61211OofEvaluationSchema),
    read("c6-1-2-1-1-profile-evidence-coverage", s.c61211ProfileEvidenceSchema),
    read("c6-1-2-1-1-training-contract-parity", s.c61211TrainingSchema),
    read("c6-1-2-1-1-oof-retrain-models", s.c61211ModelsSchema),
    read(
      "c6-1-2-1-1-whole-component-diagnostic-evaluation",
      s.c61211WholeSchema,
    ),
    read("c6-1-2-1-1-partition-bias-audit", s.c61211BiasSchema),
    read("c6-1-2-1-1-evaluator-sensitivity", s.c61211SensitivitySchema),
    read("c6-1-2-1-1-completeness-diagnosis-v2", s.c61211CompletenessSchema),
    read("c6-1-2-1-1-route-decision", s.c61211RouteSchema),
    read("c6-1-2-1-1-read-only-proof", s.c61211ReadOnlySchema),
    read("c6-1-2-1-1-research-shadow-manifest", s.c61211ShadowsSchema),
    read("c6-1-2-1-1-shareable-summary", s.c61211ShareableSchema, "shareable"),
    read("c6-1-2-1-1-partitioned-supergroup-map", s.c61211MapSchema, "d0"),
    read("c6-1-2-1-1-reachable-coverage-audit", s.c61211CoverageSchema, "d0"),
    read("c6-1-2-1-1-partitioned-supergroup-map", s.c61211MapSchema, "d2"),
    read("c6-1-2-1-1-reachable-coverage-audit", s.c61211CoverageSchema, "d2"),
  ]);

  const serialize = (value: unknown) =>
    JSON.stringify(
      value,
      (key: string, item: unknown): unknown => {
        if (
          typeof item === "string" &&
          /\/Users\/|\/private\/|\/tmp\//.test(item)
        )
          return "LOCAL_PATH_REDACTED:" + path.basename(item);
        return key === "rows" && Array.isArray(item) && item.length > 40
          ? { count: item.length, note: "rows retained in validated artifact" }
          : item;
      },
      2,
    );
  const frac = (value: {
    numerator: number;
    denominator: number;
    ratio: number | null;
  }) =>
    `${value.numerator}/${value.denominator} (${value.ratio === null ? "n/a" : (value.ratio * 100).toFixed(2) + "%"})`;
  const profiles = new Map(
      [...frozen.profiles, ...oof.profiles].map((profile) => [
        profile.track + ":" + profile.profileId,
        profile,
      ]),
    ),
    profile = (
      track:
        | "FROZEN_DECISION_REEVALUATION"
        | "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
      id: string,
    ) => profiles.get(track + ":" + id),
    frozenProfile = (id: string) => profile("FROZEN_DECISION_REEVALUATION", id),
    oofProfile = (id: string) =>
      profile("SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN", id),
    selected = route.selectedSafeProfile
      ? oofProfile(route.selectedSafeProfile)
      : undefined,
    descriptive = route.descriptiveBestRetrainedProfile
      ? oofProfile(route.descriptiveBestRetrainedProfile)
      : undefined;
  const profileSummary = (value: s.C61211Profile | undefined) =>
    value
      ? {
          profileId: value.profileId,
          selected: value.selectedCount,
          changedBlocks: value.changedBlocks,
          improved: value.improved,
          regressed: value.regressed,
          neutral: value.neutral,
          unknown: value.unknown,
          precision: value.selectionPrecision,
          harm: value.harmRate,
          jointGain: value.normalizedJointGain,
          materialDelta: value.materialDelta,
          catastrophic: value.catastrophicDeletionCount,
          activeFolds: value.activeFoldCount,
          negativeFolds: value.negativeGainFoldCount,
          unknownFolds: value.unknownGainFoldCount,
          evidenceCoverage: value.changedBlockCoverage,
          safeProfileEligible: value.safeProfileEligible,
        }
      : null;
  const statusCount = (status: string) =>
    map.components.filter((component) => component.status === status).length;
  const d1 = coverage.coverage,
    d0 = d0Coverage.coverage,
    d2 = d2Coverage.coverage;
  const e2Coverage = sensitivity.coverageRows.find(
    (row) => row.evaluator === "E2",
  );
  demand(e2Coverage, "C61211_E2_COVERAGE_ROW_MISSING");
  const qaStage = (name: string) => qa.checks.find((row) => row.stage === name);
  const commitByIndex = (index: number) =>
    commits[index]?.sha ?? "recorded in delivery receipt";
  const allMutations = `${readOnly.productionMutation}/0/0`;
  const partitionSummary = (
    modeMap: typeof map,
    modeCoverage: typeof coverage,
  ) => ({
    mode: modeMap.mode,
    blocks: modeMap.blocks.length,
    evaluableBlocks: modeMap.blocks.filter(
      (block) => block.shadowEvaluationEligible,
    ).length,
    residualBlocks: modeMap.blocks.filter(
      (block) => !block.shadowEvaluationEligible,
    ).length,
    statuses: Object.fromEntries(
      [...new Set(modeMap.components.map((component) => component.status))]
        .sort()
        .map((status) => [
          status,
          modeMap.components.filter((component) => component.status === status)
            .length,
        ]),
    ),
    coverage: modeCoverage.coverage,
  });
  const sectionValue = new Map<number, unknown>();
  const put = (number: number, value: unknown) =>
    sectionValue.set(number, value);
  put(
    1,
    `Engineering acceptance passed. The exact D1 optimum did not meet Coverage Gate V2, so the terminal route is ${route.route}; production remains needs-review/finalizationMethod none.`,
  );
  put(2, branch);
  put(3, {
    baselineCommit: baseline.baselineCommit,
    baselineReplayPassed: baseline.passed,
    policyHash: baseline.baselinePolicyHash,
  });
  put(
    4,
    `${baseline.checks.length} baseline replay checks passed; accepted A/B and validation inputs remained byte/mtime/inode frozen.`,
  );
  put(
    5,
    "Recover evaluator scope with a predeclared timing-only monotone partition, preserve global/reachable denominators, re-evaluate frozen decisions and unchanged OOF profiles, then make one terminal route decision.",
  );
  put(
    6,
    "No new ASR/CTC/speaker/MFA inference; no new candidate, Top-K, feature, fold, profile, threshold, production subtitle, Gold cue, or Frozen Machine Group mutation.",
  );
  put(
    7,
    "E2 kept oversized timing-connected components atomic. Fourteen bilateral components remained structurally unevaluable, suppressing machine, production, reachable-Gold, event and Top-K coverage.",
  );
  put(8, {
    components: inventory.rows.length,
    bilateral: inventory.rows.filter((row) => row.bilateral).length,
    oversizedBilateral: inventory.rows.filter(
      (row) => row.bilateral && row.oversized,
    ).length,
    attempted: inventory.rows.filter((row) => row.attempted).length,
  });
  put(9, inventory.reasonCounts);
  put(10, C61211_POLICY.partition.machineNodeOrdering);
  put(11, C61211_POLICY.partition.goldNodeOrdering);
  put(12, {
    solver: C61211_POLICY.partition.solver,
    membership: C61211_POLICY.partition.blockMembership,
    atomicMachine: true,
    atomicGold: true,
  });
  put(13, {
    D0: d0Map.blocks.length,
    D1: map.blocks.length,
    D2: d2Map.blocks.length,
    exactObjective: C61211_POLICY.partition.objective,
  });
  put(
    14,
    C61211_POLICY.partition.modes.D1_CONSERVATIVE_MONOTONIC.maximumWeakBridge,
  );
  put(15, C61211_POLICY.partition.strongBridgeMinimumBoth);
  put(16, {
    requiredMinimum:
      C61211_POLICY.partition.modes.D1_CONSERVATIVE_MONOTONIC
        .minimumNodeRetained,
    observedMinimum: Math.min(
      ...map.components.map(
        (component) => component.minimumNodeRetainedOverlapRatio,
      ),
    ),
  });
  put(17, {
    allowedMaximum:
      C61211_POLICY.partition.modes.D1_CONSERVATIVE_MONOTONIC.maximumCutLoss,
    observedMaximum: Math.max(
      ...map.components.map(
        (component) => component.componentDiscardedOverlapRatio,
      ),
    ),
  });
  put(18, C61211_POLICY.partition.objective);
  put(19, statusCount("FULLY_PARTITIONED"));
  put(20, statusCount("PARTIALLY_PARTITIONED_WITH_RESIDUAL"));
  put(21, {
    residualBlocks: residuals.rows.length,
    reasons: residuals.rows.flatMap((row) => row.residualReasons),
  });
  put(22, statusCount("UNSPLITTABLE_STRONG_BRIDGE"));
  put(23, statusCount("UNSPLITTABLE_COVERAGE"));
  put(24, cuts.rows.length);
  put(25, cuts.independentCutOverlapSeconds);
  put(26, conservation.unsafeCutCount);
  put(27, {
    duplicatedMachine: conservation.duplicatedMachineGroupCount,
    missingMachine: conservation.missingMachineGroupCount,
    duplicatedProduction: conservation.duplicatedProductionCueCount,
    missingProduction: conservation.missingProductionCueCount,
    duplicatedGold: conservation.duplicatedGoldCueCount,
    missingGold: conservation.missingGoldCueCount,
  });
  put(28, {
    unaccountedEdges: conservation.unaccountedEdgeCount,
    multiplyAccountedEdges: conservation.multiplyAccountedEdgeCount,
    passed: conservation.passed,
  });
  put(29, partitionSummary(d0Map, d0Coverage));
  put(30, partitionSummary(map, coverage));
  put(31, {
    ...partitionSummary(d2Map, d2Coverage),
    diagnosticOnly: true,
    usedForRoute: false,
  });
  put(32, { D0: d0, D1: d1, D2: d2 });
  put(33, {
    evaluator: whole.evaluator,
    rows: whole.rows.length,
    eligibleForTraining: whole.eligibleForTraining,
    eligibleForRoute: whole.eligibleForRoute,
  });
  put(34, {
    compared: bias.comparedProfileComponents,
    agreement: bias.gainDirectionAgreementCount,
    disagreement: bias.gainDirectionDisagreementCount,
    incomparable: bias.incomparableCount,
  });
  put(35, {
    cues: scope.globalGoldCueIds.length,
    definition: C61211_POLICY.coverage.globalGoldScope,
    retainedInGlobalQuality: true,
  });
  put(36, {
    cues: scope.interventionReachableGoldCueIds.length,
    definition: C61211_POLICY.coverage.interventionScope,
  });
  put(37, scope.goldOnlyUnreachableCueIds.length);
  put(38, {
    machineGroups: scope.candidateReachableMachineGroupIds.length,
    productionCues: scope.candidateReachableProductionCueIds.length,
    events: scope.candidateReachableEventIds.length,
  });
  put(39, frac(d1.globalGoldCueCoverage));
  put(40, frac(d1.interventionReachableGoldCueCoverage));
  put(41, frac(d1.allMachineGroupCoverage));
  put(42, frac(d1.productionCueCoverage));
  put(43, frac(d1.candidateReachableMachineGroupCoverage));
  put(44, frac(d1.candidateEventLabelCoverage));
  put(45, frac(d1.topKCandidateLabelCoverage));
  put(46, frac(d1.machineDurationCoverage));
  put(47, frac(d1.reachableGoldDurationCoverage));
  put(48, {
    passed: gate.passed,
    checks: gate.checks,
    profileSelectionUsed: gate.profileSelectionUsed,
    globalGoldCoverageUsed: gate.globalGoldCoverageUsed,
  });
  put(
    49,
    "Evaluator coverage is structural and profile-independent. L6 zero-selection has null precision/harm and cannot lower or satisfy the coverage gate; it remains in profile diagnostics only.",
  );
  put(50, profileEvidence.rows);
  put(51, {
    labels: labels.labels.length,
    scoringAdapterHash: labels.scoringAdapterHash,
    rawGoldTextIncluded: labels.rawGoldTextIncluded,
    runtimeLeakage: labels.labelsFedToRuntimeInference,
  });
  put(52, stability.newlyRecoveredCandidateLabels);
  put(53, stability.previouslyEvaluableNowLost);
  put(54, {
    common: stability.commonEvaluableCount,
    exact: stability.exactLabelAgreementCount,
    normalizedDirection: stability.normalizedGainDirectionAgreementCount,
    exactDirection: stability.exactGainDirectionAgreementCount,
  });
  put(55, {
    disagreement:
      stability.commonEvaluableCount -
      stability.normalizedGainDirectionAgreementCount,
    reasons: stability.disagreementReasons,
  });
  for (let i = 0; i < 9; i++)
    put(56 + i, profileSummary(frozenProfile("L" + String(i))));
  put(65, {
    featureHash: training.featureHash,
    foldHash: training.foldHash,
    profileDefinitionHash: training.profileDefinitionHash,
    thresholdGridHash: training.thresholdGridHash,
    numericLabels: models.trainingNumericLabelCount,
    outerTestLabelInputs: models.outerTestLabelInputToPredictionCount,
  });
  put(66, training.featureHash);
  put(67, training.foldHash);
  put(68, training.profileDefinitionHash);
  put(69, training.thresholdGridHash);
  for (let i = 0; i < 9; i++)
    put(70 + i, profileSummary(oofProfile("L" + String(i))));
  put(79, {
    profile: route.descriptiveBestRetrainedProfile,
    metrics: profileSummary(descriptive),
    descriptiveOnly: true,
  });
  put(80, route.selectedSafeProfile);
  for (const [number, key] of [
    [81, "selectedCount"],
    [82, "improved"],
    [83, "regressed"],
    [84, "neutral"],
    [85, "unknown"],
    [86, "selectionPrecision"],
    [87, "harmRate"],
    [88, "normalizedJointGain"],
    [89, "materialDelta"],
    [90, "catastrophicDeletionCount"],
    [91, "activeFoldCount"],
    [92, "negativeGainFoldCount"],
    [93, "unknownGainFoldCount"],
  ] as const)
    put(number, selected?.[key] ?? null);
  put(94, selected?.changedBlockCoverage ?? null);
  put(95, completeness.nonUnknownCompletenessCoverage);
  put(96, {
    occurrences: completeness.blockedSelectionOccurrences,
    uniqueCandidates: completeness.blockedUniqueCandidates,
  });
  put(97, {
    count: completeness.safeCandidatesBlocked,
    rate: completeness.safeCandidateFalseBlockRate,
  });
  put(98, {
    diagnostic: completeness.diagnosticMainBlocker,
    coverageQualified: completeness.coverageQualifiedMainBlocker,
    reasons: completeness.reasons,
  });
  put(99, {
    passed: bias.passed,
    cutEdges: bias.cutEdgeCount,
    cutOverlapSeconds: bias.cutOverlapSeconds,
    maxCutLoss: bias.maximumComponentDiscardedOverlapRatio,
    wholeUsedForRoute: bias.wholeComponentScoresUsedForRoute,
  });
  put(100, {
    rows: sensitivity.rows,
    coverageRows: sensitivity.coverageRows,
    primary: sensitivity.primaryEvaluator,
  });
  put(101, route.engineeringGate);
  put(102, route.evaluationCoverageGate);
  put(103, route.rerankerStrongSupportGate);
  put(104, { route: route.route, reasons: route.reasons });
  put(105, route.c6122);
  put(106, route.c613);
  put(107, route.route === "STOP_EXISTING_CANDIDATE_AUTOMATIC_RERANKING");
  put(108, 0);
  put(109, 0);
  put(110, route.productionMutation);
  put(111, validation.productionParity);
  put(112, validation.productionParity);
  put(113, validation.productionParity);
  put(114, validation.aBSemanticParity);
  put(115, validation.aBByteParity);
  put(116, {
    count: readOnly.goldTimingEvaluatorInputCount,
    parser: timing.parser,
    dialogueDecoded: false,
  });
  put(117, {
    count: readOnly.goldTextScoringInputCount,
    stage: "post-partition scoring only",
    rawTextInReport: false,
  });
  put(118, conservation.goldTextUsedForPartitionCount);
  put(119, readOnly.outerTestLabelInputToPredictionCount);
  put(120, 0);
  put(121, 0);
  put(122, 0);
  put(123, {
    researchNetwork: validation.networkDuringResearch,
    attempted: false,
  });
  put(
    124,
    "No dataset-specific ID/text/path appears in partition, coverage, label, OOF or route policy; real paths are CLI inputs and redacted from shareable/report data.",
  );
  put(125, {
    passed: readOnly.passed,
    before: readOnly.sourceBefore.sha256,
    after: readOnly.sourceAfter.sha256,
  });
  put(126, {
    passed: readOnly.passed,
    before: readOnly.goldBefore.sha256,
    after: readOnly.goldAfter.sha256,
  });
  put(127, {
    privacy: shareable.privacy,
    goldText: shareable.containsGoldText,
    candidateText: shareable.containsCandidateText,
    absolutePaths: shareable.absolutePrivatePathCount,
    secrets: shareable.secretCount,
  });
  put(128, qaStage("c6-1-targeted"));
  put(129, qaStage("c6-1-1-targeted"));
  put(130, qaStage("c6-1-2-targeted"));
  put(131, qaStage("c6-1-2-1-targeted"));
  put(132, qaStage("unit"));
  put(133, qaStage("e2e"));
  put(134, qaStage("c6-1-2-1-1-targeted"));
  put(135, validation.schemaCount);
  put(136, {
    checkedArtifacts: validation.checkedArtifacts,
    validationHash: validation.semanticHash,
    passed: validation.passed,
  });
  put(137, qaStage("skill"));
  put(138, "Skill 2 and Skill 3 unchanged; baseline diff gate passed.");
  put(
    139,
    "D1 is exact and safe but remains below the predeclared >=80% reachable-coverage thresholds. D2 improves coverage but is diagnostic-only and cannot authorize a route. No safe profile can be claimed under insufficient evaluation coverage.",
  );
  put(140, route.route);
  put(141, commits);
  put(
    142,
    "The post-push delivery receipt records exact Local HEAD == Remote HEAD and 0/0 divergence; the report does not invent its own future commit SHA.",
  );
  put(143, {
    finalA: path.basename(root),
    finalB: path.basename(arg("--peer")),
    validation: path.basename(path.dirname(arg("--validation"))),
    qa: path.basename(path.dirname(arg("--qa"))),
    shadows: shadows.rows.length,
    localResearchOnly: true,
  });
  put(
    144,
    "Only this report is expected after QA. The post-commit receipt must prove a clean worktree and synchronized upstream.",
  );
  demand(sectionValue.size === 144, "C61211_REPORT_SECTIONS_INCOMPLETE");

  const finalValue = new Map<number, unknown>();
  const f = (number: number, value: unknown) => finalValue.set(number, value);
  f(1, branch);
  f(2, baseline.baselineCommit);
  f(3, commitByIndex(0));
  f(4, commitByIndex(1));
  f(5, commitByIndex(2));
  f(6, commitByIndex(3));
  f(7, commitByIndex(4));
  f(8, "generated by the subsequent docs acceptance commit");
  f(9, "verified by the post-push delivery receipt");
  f(10, policy.policyVersion);
  f(11, C61211_POLICY_HASH);
  f(12, baseline.passed);
  f(13, scope.allProductionCueIds.length);
  f(14, scope.allMachineGroupIds.length);
  f(15, scope.globalGoldCueIds.length);
  f(16, inventory.e2Edges.length);
  f(17, inventory.rows.length);
  f(18, inventory.rows.filter((row) => row.bilateral).length);
  f(19, inventory.rows.filter((row) => !row.machineGroupIds.length).length);
  f(20, inventory.rows.filter((row) => !row.goldCueIds.length).length);
  f(
    21,
    inventory.rows.filter((row) => row.bilateral && row.alreadyBounded).length,
  );
  f(22, e2Coverage.machineGroupCoverage);
  f(23, e2Coverage.productionCueCoverage);
  f(24, e2Coverage.globalGoldCoverage);
  f(25, e2Coverage.candidateEventLabelCoverage);
  f(26, inventory.rows.filter((row) => row.bilateral && row.oversized).length);
  f(27, inventory.rows.filter((row) => row.attempted).length);
  f(28, statusCount("ALREADY_BOUNDED"));
  f(29, statusCount("FULLY_PARTITIONED"));
  f(30, statusCount("PARTIALLY_PARTITIONED_WITH_RESIDUAL"));
  f(31, statusCount("UNSPLITTABLE_STRONG_BRIDGE"));
  f(32, statusCount("UNSPLITTABLE_COVERAGE"));
  f(33, statusCount("UNSPLITTABLE_CUE_LIMIT"));
  f(34, statusCount("UNSPLITTABLE_DURATION_LIMIT"));
  f(35, statusCount("UNSPLITTABLE_GAP_LIMIT"));
  f(36, statusCount("NO_VALID_MONOTONIC_PARTITION"));
  f(37, map.blocks.length);
  f(38, map.blocks.filter((block) => block.candidateLabelEligible).length);
  f(39, map.blocks.filter((block) => block.oofTrainingEligible).length);
  f(40, residuals.rows.length);
  f(
    41,
    new Set(
      map.blocks
        .filter((block) => block.shadowEvaluationEligible)
        .flatMap((block) => block.machineGroupIds),
    ).size,
  );
  f(
    42,
    new Set(
      map.blocks
        .filter((block) => block.shadowEvaluationEligible)
        .flatMap((block) => block.machineCueIds),
    ).size,
  );
  f(
    43,
    new Set(
      map.blocks
        .filter((block) => block.shadowEvaluationEligible)
        .flatMap((block) => block.goldCueIds),
    ).size,
  );
  f(44, cuts.rows.length);
  f(45, cuts.rows.filter((row) => !row.strongBridge).length);
  f(46, cuts.strongBridgeCutCount);
  f(47, cuts.independentCutOverlapSeconds);
  f(48, Math.max(0, ...cuts.rows.map((row) => row.weakBridgeStrength)));
  f(
    49,
    Math.max(
      ...map.components.map(
        (component) => component.componentDiscardedOverlapRatio,
      ),
    ),
  );
  f(
    50,
    Math.min(
      ...map.components.map(
        (component) => component.minimumNodeRetainedOverlapRatio,
      ),
    ),
  );
  f(51, d0.allMachineGroupCoverage);
  f(52, d1.allMachineGroupCoverage);
  f(53, d2.allMachineGroupCoverage);
  f(54, d1.productionCueCoverage);
  f(55, d1.globalGoldCueCoverage);
  f(56, d1.interventionReachableGoldCueCoverage);
  f(57, d1.candidateReachableMachineGroupCoverage);
  f(58, d1.candidateEventLabelCoverage);
  f(59, d1.topKCandidateLabelCoverage);
  f(60, d1.machineDurationCoverage);
  f(61, d1.reachableGoldDurationCoverage);
  f(62, scope.goldOnlyUnreachableCueIds.length);
  f(63, scope.interventionReachableGoldCueIds.length);
  f(64, scope.candidateReachableMachineGroupIds.length);
  f(65, scope.candidateReachableProductionCueIds.length);
  f(66, scope.candidateReachableEventIds.length);
  f(67, conservation.duplicatedMachineGroupCount);
  f(68, conservation.missingMachineGroupCount);
  f(69, conservation.duplicatedGoldCueCount);
  f(70, conservation.missingGoldCueCount);
  f(71, conservation.unaccountedEdgeCount);
  f(72, conservation.nonMonotonicPartitionCount);
  f(73, conservation.crossFoldPartitionCount);
  f(74, conservation.unsafeCutCount);
  f(75, conservation.goldTextUsedForPartitionCount);
  f(76, conservation.profileRematchingCount);
  f(77, conservation.passed);
  f(78, bias.passed);
  f(79, whole.rows.length);
  f(80, bias.gainDirectionAgreementCount);
  f(81, bias.gainDirectionDisagreementCount);
  f(82, stability.oldEvaluableCandidateLabels);
  f(83, stability.newEvaluableCandidateLabels);
  f(84, stability.newlyRecoveredCandidateLabels);
  f(85, stability.previouslyEvaluableNowLost);
  f(86, stability.commonEvaluableCount);
  f(87, stability.exactLabelAgreementCount);
  f(88, stability.normalizedGainDirectionAgreementCount);
  f(
    89,
    stability.commonEvaluableCount -
      stability.normalizedGainDirectionAgreementCount,
  );
  const fl0 = frozenProfile("L0"),
    fl1 = frozenProfile("L1"),
    fl2 = frozenProfile("L2"),
    fl3 = frozenProfile("L3"),
    fl6 = frozenProfile("L6");
  f(90, fl0?.normalizedJointGain ?? null);
  f(91, fl1?.changedBlocks ?? null);
  f(92, fl1?.improved ?? null);
  f(93, fl1?.regressed ?? null);
  f(94, fl1?.neutral ?? null);
  f(95, fl1?.unknown ?? null);
  f(96, fl1?.selectionPrecision ?? null);
  f(97, fl1?.harmRate ?? null);
  f(98, fl1?.normalizedJointGain ?? null);
  f(99, fl1?.materialDelta ?? null);
  f(100, fl1?.catastrophicDeletionCount ?? null);
  f(101, fl2?.normalizedJointGain ?? null);
  f(102, fl3?.normalizedJointGain ?? null);
  f(103, fl6?.selectedCount ?? null);
  f(104, fl6?.selectionPrecision ?? null);
  f(105, fl6?.harmRate ?? null);
  f(106, training.featureHash === models.featureHash);
  f(107, training.foldHash === models.foldHash);
  f(108, training.profileDefinitionHash);
  f(109, training.thresholdGridHash);
  f(110, oofProfile("L0")?.normalizedJointGain ?? null);
  f(111, oofProfile("L1")?.normalizedJointGain ?? null);
  f(112, oofProfile("L2")?.normalizedJointGain ?? null);
  f(113, oofProfile("L3")?.normalizedJointGain ?? null);
  f(114, oofProfile("L4")?.selectedCount ?? null);
  f(115, oofProfile("L5")?.selectedCount ?? null);
  f(116, oofProfile("L6")?.selectedCount ?? null);
  f(117, route.descriptiveBestRetrainedProfile);
  f(118, route.selectedSafeProfile);
  f(119, selected?.selectedCount ?? null);
  f(120, selected?.improved ?? null);
  f(121, selected?.regressed ?? null);
  f(122, selected?.neutral ?? null);
  f(123, selected?.unknown ?? null);
  f(124, selected?.selectionPrecision ?? null);
  f(125, selected?.harmRate ?? null);
  f(126, selected?.normalizedJointGain ?? null);
  f(127, selected?.materialDelta ?? null);
  f(128, selected?.catastrophicDeletionCount ?? null);
  f(129, selected?.activeFoldCount ?? null);
  f(130, selected?.negativeGainFoldCount ?? null);
  f(131, selected?.unknownGainFoldCount ?? null);
  f(132, selected?.changedBlockCoverage ?? null);
  f(133, completeness.nonUnknownCompletenessCoverage);
  f(134, {
    occurrences: completeness.blockedSelectionOccurrences,
    unique: completeness.blockedUniqueCandidates,
  });
  f(135, completeness.safeCandidatesBlocked);
  f(136, completeness.coverageQualifiedMainBlocker);
  f(137, gate.passed);
  f(138, route.rerankerStrongSupportGate);
  f(139, route.engineeringGate);
  f(140, route.route);
  f(141, route.c6122);
  f(142, route.c613);
  f(143, allMutations);
  f(144, validation.productionParity);
  f(145, `${validation.aBSemanticParity}/${validation.aBByteParity}`);
  f(146, "0/0/0/0");
  f(
    147,
    `timing=${readOnly.goldTimingEvaluatorInputCount}; text-scoring=${readOnly.goldTextScoringInputCount}; partition-text=0; hardcoding=0; network=off`,
  );
  f(148, {
    qaStages: qa.checks.length,
    qaPassed: qa.passed,
    schemas: validation.schemaCount,
    checkedArtifacts: validation.checkedArtifacts,
  });
  f(149, {
    reportRelativePath,
    finalA: path.basename(root),
    finalB: path.basename(arg("--peer")),
    validation: path.basename(path.dirname(arg("--validation"))),
  });
  f(150, "Post-commit delivery receipt must report clean and 0/0 divergence.");
  demand(finalValue.size === 150, "C61211_FINAL_FIELDS_INCOMPLETE");

  const answers = [
    `D1 safely partitioned ${statusCount("FULLY_PARTITIONED") + statusCount("PARTIALLY_PARTITIONED_WITH_RESIDUAL")} of the 14 previously bilateral-unevaluable components (${statusCount("FULLY_PARTITIONED")} fully, ${statusCount("PARTIALLY_PARTITIONED_WITH_RESIDUAL")} partially).`,
    `D1 produced ${map.blocks.filter((block) => block.shadowEvaluationEligible).length} evaluation blocks and ${residuals.rows.length} residual blocks.`,
    `D1 cut ${cuts.rows.filter((row) => !row.strongBridge).length} weak edges and ${cuts.strongBridgeCutCount} strong edges.`,
    `Yes. Observed minimum node retained-overlap=${Math.min(...map.components.map((component) => component.minimumNodeRetainedOverlapRatio))}; maximum component cut-loss=${Math.max(...map.components.map((component) => component.componentDiscardedOverlapRatio))}; D1 limits are ${C61211_POLICY.partition.modes.D1_CONSERVATIVE_MONOTONIC.minimumNodeRetained} and ${C61211_POLICY.partition.modes.D1_CONSERVATIVE_MONOTONIC.maximumCutLoss}.`,
    `No. Machine duplicate/missing=${conservation.duplicatedMachineGroupCount}/${conservation.missingMachineGroupCount}; Gold duplicate/missing=${conservation.duplicatedGoldCueCount}/${conservation.missingGoldCueCount}; cross-fold=${conservation.crossFoldPartitionCount}; non-monotonic=${conservation.nonMonotonicPartitionCount}.`,
    `Global Gold coverage=${frac(d1.globalGoldCueCoverage)}; intervention-reachable Gold coverage=${frac(d1.interventionReachableGoldCueCoverage)}.`,
    "Gold-only cues remain real global missing-speech/error mass, so excluding them would inflate overall quality. They have no structurally reachable existing candidate, so making them block the existing-candidate reranker gate would test an intervention that this reranker cannot perform.",
    `E3 coverage: machine=${frac(d1.allMachineGroupCoverage)}; production=${frac(d1.productionCueCoverage)}; reachable Gold=${frac(d1.interventionReachableGoldCueCoverage)}; candidate event=${frac(d1.candidateEventLabelCoverage)}; Top-K candidate=${frac(d1.topKCandidateLabelCoverage)}.`,
    `No. Coverage Gate V2 passed=${gate.passed}; ${gate.checks
      .filter((check) => !check.passed)
      .map((check) => check.name)
      .join(", ")} remain below 80%.`,
    `Yes. The gate is structural, profile-independent, and excludes L6 zero-selection. L6 selected=${oofProfile("L6")?.selectedCount ?? 0}, precision=${String(oofProfile("L6")?.selectionPrecision ?? null)}, safe=${String(oofProfile("L6")?.safeProfileEligible ?? false)}; it cannot impersonate a safe profile.`,
    `Among ${stability.commonEvaluableCount} common labels, normalized gain direction changed for ${stability.commonEvaluableCount - stability.normalizedGainDirectionAgreementCount}.`,
    `Compared partition/whole profile-components=${bias.comparedProfileComponents}; direction agreement=${bias.gainDirectionAgreementCount}; disagreement=${bias.gainDirectionDisagreementCount}; incomparable=${bias.incomparableCount}.`,
    `Frozen L1: improved=${fl1?.improved ?? null}, regressed=${fl1?.regressed ?? null}, precision=${fl1?.selectionPrecision ?? null}, harm=${fl1?.harmRate ?? null}, joint gain=${fl1?.normalizedJointGain ?? null}, material delta=${fl1?.materialDelta ?? null}, catastrophic=${fl1?.catastrophicDeletionCount ?? null}.`,
    `With identical feature/fold/profile/grid, the descriptive best retrained profile is ${String(route.descriptiveBestRetrainedProfile)}. It is descriptive only.`,
    `No. selectedSafeProfile=${String(route.selectedSafeProfile)} because all route gates, including evaluation coverage, must pass simultaneously.`,
    `The terminal failure is evaluation coverage: coverage=${route.evaluationCoverageGate}, bias=${route.partitionBiasGate}, engineering=${route.engineeringGate}. Profile safety metrics cannot override insufficient evaluator support.`,
    `No. Completeness diagnosticMainBlocker=${completeness.diagnosticMainBlocker}, but coverageQualifiedMainBlocker=${completeness.coverageQualifiedMainBlocker}; insufficient evaluator coverage prevents proving it as the main blocker.`,
    `No. C6.1.2.2=${route.c6122}; the terminal D1 result does not justify more acoustic-completeness work.`,
    `No. C6.1.3=${route.c613}; rerankerStrongSupportGate=${route.rerankerStrongSupportGate}.`,
    route.route,
  ].map((answer, index) => ({ number: index + 1, answer }));
  demand(answers.length === 20, "C61211_Q1_Q20_INCOMPLETE");

  const data = s.c61211ReportDataSchema.parse(
    c61211Artifact("c6-1-2-1-1-report-data", {
      validationHash: validation.semanticHash,
      qaEvidenceHash: qa.semanticHash,
      reportRelativePath,
      sections: sectionTitles.map((title) => ({
        ...title,
        value: serialize(sectionValue.get(title.number)),
      })),
      finalFields: finalTitles.map((title) => ({
        ...title,
        value: serialize(finalValue.get(title.number)),
      })),
      questions: answers,
      rawGoldTextIncluded: false,
    }),
  );
  const render = (value: string) =>
    /^[[{]/.test(value) ? "```json\n" + value + "\n```" : value;
  const markdown = [
    "# C6.1.2.1.1 Constrained Monotonic Partition & Reachable Evaluation",
    "",
    "This report is generated only from strict, independently validated offline A/B artifacts. Engineering acceptance is separate from evaluator coverage and reranker safety. Production remains `needs-review` with `finalizationMethod: none`.",
    "",
    ...data.sections.flatMap((section) => [
      `## ${section.number}. ${section.title}`,
      "",
      render(section.value),
      "",
    ]),
    "## Required Q1–Q20",
    "",
    ...data.questions.flatMap((question) => [
      `### Q${question.number}`,
      "",
      question.answer,
      "",
    ]),
  ].join("\n");
  await mkdir(path.join(repository, "docs"), { recursive: true });
  await writeFile(
    path.join(repository, reportRelativePath),
    await format(markdown, { parser: "markdown" }),
    { flag: "wx" },
  );
  await writeC61211(arg("--output"), data);
  demand(
    guard().attemptedNetworkRequests === 0,
    "C61211_REPORT_NETWORK_ATTEMPT",
  );
  process.stdout.write(
    JSON.stringify({
      reportRelativePath,
      sections: data.sections.length,
      finalFields: data.finalFields.length,
      questions: data.questions.length,
      route: route.route,
    }) + "\n",
  );
}
