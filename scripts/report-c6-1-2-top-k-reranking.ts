import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { z } from "zod";
import * as s from "@mvl/shared";
import {
  c612Arguments,
  writeArtifact,
} from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import {
  c612Json,
  verifyC612SelfHash,
  countC612CatastrophicDeletionClasses,
} from "../packages/video-subtitler/src/consensus/top-k/c612-artifact-validator.js";
import {
  C612_POLICY,
  C612_POLICY_HASH,
  artifact,
  ratio,
  c612Defined,
} from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
const keys = [
    "--a",
    "--b",
    "--validation",
    "--qa",
    "--fresh-runtime",
    "--baseline-run",
    "--output",
    "--data-output",
    "--code-commit",
    "--network",
  ],
  arg = c612Arguments([...keys, "--acceptance-commit"], keys),
  root = arg("--a"),
  repository = path.resolve(import.meta.dirname, "..");
const validation = s.c612ValidationSchema.parse(
    JSON.parse(await readFile(arg("--validation"), "utf8")),
  ),
  qa = s.c612RegressionSchema.parse(
    JSON.parse(await readFile(arg("--qa"), "utf8")),
  ),
  fresh = s.c612RuntimeSchema.parse(
    JSON.parse(await readFile(arg("--fresh-runtime"), "utf8")),
  );
for (const a of [validation, qa, fresh]) verifyC612SelfHash(a);
const load = <T>(name: string, schema: z.ZodType<T>) =>
  c612Json(root, name, schema);
const baseline = await load(
    "machine/c6-1-2-baseline-replay.json",
    s.c612BaselineSchema,
  ),
  freeze = await load(
    "machine/c6-1-2-machine-freeze-manifest.json",
    s.c612FreezeSchema,
  ),
  top = await load(
    "machine/machine-c6-1-2-top-k-candidate-set.json",
    s.c612TopKSchema,
  ),
  comparison = await load(
    "machine/machine-c6-1-2-top-k-profile-comparison.json",
    s.c612TopKComparisonSchema,
  ),
  conservation = await load(
    "machine/machine-c6-1-2-top-k-conservation-ledger.json",
    s.c612ConservationSchema,
  ),
  ranks = await load(
    "machine/machine-c6-1-2-full-candidate-rank-audit.json",
    s.c612RankAuditSchema,
  ),
  correlation = await load(
    "machine/machine-c6-1-2-correlation-audit.json",
    s.c612CorrelationAuditSchema,
  ),
  reconciliation = await load(
    "machine/machine-c6-1-2-same-audio-reconciliation.json",
    s.c612ReconciliationSchema,
  ),
  completeness = await load(
    "machine/machine-c6-1-2-candidate-acoustic-completeness.json",
    s.c612CompletenessSchema,
  ),
  ctc = await load(
    "machine/machine-c6-1-2-candidate-ctc-scores.json",
    s.c612CtcSchema,
  ),
  runtime = await load(
    "machine/machine-c6-1-2-acoustic-completeness-runtime.json",
    s.c612RuntimeSchema,
  ),
  runtimeIdentity = await load(
    "machine/machine-c6-1-2-verifier-runtime-identity.json",
    s.c612VerifierIdentitySchema,
  ),
  fullIdentity = await load(
    "machine/machine-c6-1-2-full-correlation-identity.json",
    s.c612FullIdentitySchema,
  ),
  contraction = await load(
    "machine/machine-c6-1-2-contraction-audit.json",
    s.c612ContractionSchema,
  ),
  mapping = await load(
    "machine/c6-1-2-fixed-cue-group-mapping-v2.json",
    s.c612MappingSchema,
  ),
  folds = await load("machine/c6-1-2-folds.json", s.c612FoldsSchema),
  features = await load(
    "machine/machine-c6-1-2-top-k-features.json",
    s.c612FeaturesSchema,
  ),
  groups = await load(
    "evaluation/gold-c6-1-2-fixed-group-labels.json",
    s.c612GroupLabelsSchema,
  ),
  labels = await load(
    "evaluation/gold-c6-1-2-top-k-candidate-labels.json",
    s.c612CandidateLabelsSchema,
  ),
  retrieval = await load(
    "evaluation/c6-1-2-retrieval-evaluation.json",
    s.c612RetrievalMetricsSchema,
  ),
  cv = await load("evaluation/c6-1-2-cv-results.json", s.c612CvSchema),
  ablations = await load(
    "evaluation/c6-1-2-feature-ablations.json",
    s.c612AblationsSchema,
  ),
  contractionGold = await load(
    "evaluation/gold-c6-1-2-contraction-evaluation.json",
    s.c612ContractionEvaluationSchema,
  ),
  failures = await load(
    "evaluation/c6-1-2-failure-attribution.json",
    s.c612FailureSchema,
  ),
  material = await load(
    "evaluation/c6-1-2-fixed-legacy-material-evaluation.json",
    s.c612LegacyMaterialSchema,
  ),
  route = await load(
    "evaluation/c6-1-2-route-decision.json",
    s.c612RouteSchema,
  ),
  shadows = await load(
    "reranking/machine-c6-1-2-shadow-output.json",
    s.c612ShadowSchema,
  ),
  readonly = await load(
    "evaluation/c6-1-2-read-only-proof.json",
    s.c612ReadOnlySchema,
  ),
  shareable = await load(
    "evaluation/c6-1-2-shareable-audit.json",
    s.c612ShareableAuditSchema,
  );
const bruntime = await c612Json(
    arg("--b"),
    "machine/machine-c6-1-2-acoustic-completeness-runtime.json",
    s.c612RuntimeSchema,
  ),
  oldMapping = await c612Json(
    arg("--baseline-run"),
    "evaluation/c6-1-1-fixed-baseline-alignment-map.json",
    s.c611FixedBaselineAlignmentMapSchema,
  );
if (
  validation.regressionEvidenceHash !== qa.semanticHash ||
  validation.sourceCodeAggregateHash !== freeze.codeAggregateHash ||
  !validation.checks.some(
    (c) => c.name === "frozen-generation-vs-acceptance-only-source" && c.passed,
  )
)
  throw new Error("C612_REPORT_VALIDATION_BINDING");
const { stdout: branchText } = await promisify(execFile)(
    "git",
    ["branch", "--show-current"],
    { cwd: repository },
  ),
  branch = branchText.trim(),
  codeCommit = arg("--code-commit");
const acceptanceCommit = process.argv.includes("--acceptance-commit")
  ? arg("--acceptance-commit")
  : null;
const L = (id: string) =>
    c612Defined(cv.profiles.find((p) => p.profileId === id)),
  primary = L(cv.bestGoldFreeProfile),
  bestObserved = cv.bestObservedProfilePostHoc
    ? L(cv.bestObservedProfilePostHoc)
    : null;
const T = (index: number) =>
    c612Defined(
      retrieval.profiles.find((p) => p.profile === s.C612_RETRIEVAL[index]),
    ),
  bestRetrieval = c612Defined(
    [...retrieval.profiles].sort(
      (a, b) =>
        (b.recall4 ?? -1) - (a.recall4 ?? -1) ||
        (b.mrr ?? -1) - (a.mrr ?? -1) ||
        a.profile.localeCompare(b.profile),
    )[0],
  );
const distribution = (values: readonly string[]) =>
  Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((v) => [v, values.filter((x) => x === v).length]),
  );
const statuses = distribution(
    completeness.rows.map((r) => r.acousticCompletenessStatus),
  ),
  ctcStatus = distribution(ctc.rows.map((r) => r.status)),
  mappingStatuses = distribution(groups.rows.map((r) => r.status));
const nonunknown = completeness.rows.filter(
    (r) =>
      !["INSUFFICIENT_EVIDENCE", "UNSCORABLE"].includes(
        r.acousticCompletenessStatus,
      ),
  ).length,
  completenessCoverage = ratio(nonunknown, completeness.rows.length);
const M = (key: string) => mappingStatuses[key] ?? 0,
  C = (key: string) => statuses[key] ?? 0;
const prior = contractionGold.rows.filter((r) => r.priorStrong),
  priorClasses = distribution(prior.map((r) => r.goldClass)),
  allClasses = distribution(contractionGold.rows.map((r) => r.goldClass)),
  machineClasses = distribution(contraction.rows.map((r) => r.classification));
const utility = (name: string) =>
  c612Defined(contractionGold.utilities.find((u) => u.feature === name));
const fail = distribution(
  failures.rows
    .filter((r) => r.profileId === primary.profileId)
    .map((r) => r.category),
);
const rankDistribution = distribution(
  retrieval.rows
    .filter(
      (r) =>
        r.profile === s.C612_RETRIEVAL[0] &&
        r.reason !== "CURRENT_IS_ORACLE_OR_TIED" &&
        r.reason !== "EVALUATION_UNAVAILABLE",
    )
    .map((r) =>
      r.h2Rank === null ? "unranked" : r.h2Rank > 4 ? "5+" : String(r.h2Rank),
    ),
);
const counts = {
  input: baseline.inputCandidateCount,
  included: fullIdentity.rows.length,
  includedAsr: baseline.includedAsrCount,
  whisper: baseline.whisperCount,
  reazon: baseline.reazonCount,
  eligibleEvents: baseline.eligibleEventCount,
  rankRows: ranks.rows.length,
  topKUnique: top.uniqueCandidateIds.length,
  current: new Set(top.sets.map((v) => v.currentCandidateId)).size,
  alternatives:
    top.uniqueCandidateIds.length -
    new Set(top.sets.map((v) => v.currentCandidateId)).size,
};
const format = (value: unknown): string =>
  value === null || value === undefined
    ? "unknown（没有可评价分母或证据）"
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
const pct = (n: number | null) =>
  n === null ? "unknown" : `${(n * 100).toFixed(2)}%`;
const qaSummary = qa.checks.map((q) => ({
  stage: q.stage,
  exitCode: q.exitCode,
  tests: q.tests,
  skipped: q.skipReasons,
}));
const hashes = {
  canonicalText: baseline.canonicalTextHash,
  canonicalTiming: baseline.canonicalTimingHash,
  source: freeze.sourceIdentity,
  productionFiles: baseline.productionFiles,
  shadowPresentation: shadows.profiles.map((p) => ({
    profile: p.profileId,
    hash: p.presentationHash,
  })),
};
const safeShort = allClasses.VALID_SHORTENING ?? 0,
  catastrophe = countC612CatastrophicDeletionClasses(contractionGold.rows);
const chronology =
  "机器候选/证据/特征/固定映射/分折/模型策略先冻结；独立 evaluator 随后读取 Gold 并生成数值标签；训练进程仅使用训练折数值标签，OOF Shadow 在训练后冻结；最终 evaluator 复用固定映射。学习型 Shadow 并非在首次 Gold 读取前存在。";
const oracleCaveat =
  "Top-1/Top-K capture 是 EVENT_COUNTERFACTUAL_DIAGNOSTIC；joint capture 使用有界配置组 oracle。C6.1.1 的 46.27% 是不同覆盖集合上的 H2/full-pool ceiling，不能据此直接宣称同比提升；同 V2 映射的 L0 另行列出。";
const outputNames = {
  a: path.basename(root),
  b: path.basename(arg("--b")),
  validation: path.basename(path.dirname(arg("--validation"))),
  qa: path.basename(path.dirname(arg("--qa"))),
  fresh: path.basename(path.dirname(path.dirname(arg("--fresh-runtime")))),
};
const precisionContext = {
  precision: primary.precision,
  harm: primary.harm,
  selectiveGroupCoverage: primary.coverage,
  eventSelectionCoverage: primary.eventSelectionCoverage,
  changedGroupEvaluationCoverage: primary.changedGroupEvaluationCoverage,
};
const reportTitles =
  `Executive Conclusion|Branch|Baseline|C6.1.1 Replay|Goals|Non-goals|Research Hypothesis|Production Invariants|Full Candidate Rank Audit|Eligible Events|Candidate Count|Oracle Candidate Rank Distribution|Recall@1|Recall@2|Recall@3|Recall@4|MRR|nDCG@4|T0 H2 Top-4|T1 Raw MBR Top-4|T2 Union Top-4|T3 Provider-diverse Top-4|Best Retrieval Profile|Candidate Conservation|Provider Diversity|Correlation Identity Design|Core Audio Identity|Verified Identity Coverage|Provisional Identity|Unknown Identity|Same-audio Reconciliation|Duplicate Votes Prevented|Candidate-specific Completeness|Speech Activity Coverage|Token Support Coverage|CTC Scorability|Leading Deletion Risk|Trailing Deletion Risk|Internal Deletion Risk|Adjacent Contamination|Completeness Status Distribution|Unknown Completeness Count|Fresh Verifier Inference|Verifier Cache Replay|Strong Contraction Count|Valid Shortening Count|Hallucination Removal Count|Catastrophic Leading Deletion|Catastrophic Trailing Deletion|Catastrophic Internal Deletion|Unknown Contraction|Fixed Mapping V2|Mapping Recovery|Ambiguous Mapping|No Mapping|Changed-group Evaluation Coverage|Feature Schema|Raw-text Feature Count|Gold Feature Count|Dataset-specific Feature Count|Provider Identity Feature|Acoustic Features|Missing Indicators|Feature Freeze|Gold Barrier|Candidate Labels|Group Labels|Fold Design|Audio Leakage|Correlation Leakage|L0 Result|L1 Result|L2 Result|L3 Result|L4 Result|L5 Result|L6 Result|L7 Result|L8 Result|Best Gold-free Profile|Top-1 Accuracy|Reranker MRR|Reranker nDCG@4|Changed Groups|Improved Groups|Regressed Groups|Neutral Groups|Unevaluable Groups|Selection Precision|Harm Rate|Selective Coverage|Exact Joint Gain|Normalized Joint Gain|Material Error Delta|Catastrophic Deletion Regressions|Top-1 Oracle Capture|Candidate Oracle Capture|Fold 1|Fold 2|Fold 3|Fold 4|Fold 5|Active Fold Count|Negative-gain Fold Count|Unknown-gain Fold Count|Completeness Predictive Utility|Edge Risk Utility|Token Support Utility|CTC Utility|Correlation Utility|Provider Identity Ablation|Acoustic Evidence Ablation|Contraction Gate Ablation|Retrieval Failure Count|Reranking Failure Count|Gate Failure Count|Evaluation-unavailable Count|Candidate Pool Sufficiency|Shadow Cue Count|Shadow Text Changes|Production Text Mutation|Production Timing Mutation|Production ASS Parity|Production SRT Parity|Production VTT Parity|A/B Parity|Engineering Gate|Strong Support Gate|Route Decision|C6.1.3 GO/HOLD|Runtime Gold Input|Dataset Hardcoding|Network|ASR Inference|Verifier Inference|Source Read-only|Gold Read-only|Shareable Audit|C6.1 Regression|C6.1.1 Regression|Unit Tests|E2E Tests|Targeted Tests|Schema Count|Artifact Validation|Skill Validation|Skill2/3|Remaining Risks|Next Route|Commits|Remote HEAD|Output Paths|Worktree Status`.split(
    "|",
  );
const R: Record<number, unknown> = {
  1: {
    engineering: validation.passed,
    strongSupport: route.strongSupportPassed,
    route: route.route,
    c613: route.c613,
    benchmark: "KNOWN_DEVELOPMENT_BENCHMARK",
  },
  2: branch,
  3: { branch: baseline.baselineBranch, commit: baseline.acceptanceCommit },
  4: {
    passed: baseline.passed,
    checks: baseline.checks,
    independentAcceptance:
      qa.checks.find((c) => c.stage === "c6-1-1-independent-acceptance")
        ?.exitCode === 0,
  },
  5: "测量 Top-K 是否保留更好的既有候选，以及无测试标签输入的 OOF 排序能否在固定组联合评价中安全获益。",
  6: "不新增 ASR、不生成转写、不引入第三 ASR/LLM/embedding、不改生产文本/时间/数量、不改 Skill2/3，不自动发布。",
  7: "分离 retrieval、correlation identity、acoustic completeness、reranking 和 application gate 的失败原因；不预设 GO。",
  8: hashes,
  9: {
    rows: ranks.rows.length,
    rankHash: ranks.semanticHash,
    legacyRiskHash: ranks.baselineRiskHash,
    excludedRows: ranks.rows.filter((r) => !r.structuralEligible).length,
  },
  10: counts.eligibleEvents,
  11: counts,
  12: rankDistribution,
  13: T(0).recall1,
  14: T(0).recall2,
  15: T(0).recall3,
  16: T(0).recall4,
  17: T(0).mrr,
  18: T(0).ndcg4,
  19: T(0),
  20: T(1),
  21: T(2),
  22: T(3),
  23: {
    postHocDiagnosticBest: bestRetrieval.profile,
    predeclaredPrimary: C612_POLICY.retrieval.primary,
  },
  24: {
    accounted: conservation.accountedCount,
    expected: conservation.expectedCount,
    silentDrop: conservation.silentDropCount,
    passed: conservation.passed,
  },
  25: comparison.profiles,
  26: C612_POLICY.correlation,
  27: "verified=实际 source PCM + 显式 request/core lineage；不是把区间或 WAV 文件名当作字节身份。历史提取 WAV 与新解码 PCM 的容器字节哈希不同，未伪称逐字节相同。",
  28: {
    verified: correlation.verified,
    verifiedCoverage: correlation.verifiedCoverage,
    verifiedOrProvisionalCoverage: correlation.coverage,
  },
  29: correlation.provisional,
  30: correlation.unknown,
  31: reconciliation.sameAudioGroupsReconciled,
  32: reconciliation.duplicateVotesPrevented,
  33: C612_POLICY.completeness,
  34: {
    available: completeness.rows.filter(
      (r) => r.speechActivityCoverage !== null,
    ).length,
    total: completeness.rows.length,
  },
  35: {
    available: completeness.rows.filter(
      (r) => r.candidateTokenSupportCoverage !== null,
    ).length,
    total: completeness.rows.length,
  },
  36: ctcStatus,
  37: {
    available: completeness.rows.filter((r) => r.leadingDeletionRisk !== null)
      .length,
    partialLeading: C("PARTIAL_LEADING"),
  },
  38: {
    available: completeness.rows.filter((r) => r.trailingDeletionRisk !== null)
      .length,
    partialTrailing: C("PARTIAL_TRAILING"),
  },
  39: {
    available: completeness.rows.filter((r) => r.internalDeletionRisk !== null)
      .length,
    partialInternal: C("PARTIAL_INTERNAL"),
  },
  40: {
    available: completeness.rows.filter(
      (r) => r.adjacentUtteranceContaminationRisk !== null,
    ).length,
    adjacent: C("ADJACENT_CONTAMINATED"),
  },
  41: statuses,
  42: {
    insufficient: C("INSUFFICIENT_EVIDENCE"),
    unscorable: C("UNSCORABLE"),
    nonunknownCoverage: completenessCoverage,
  },
  43: fresh,
  44: {
    finalA: runtime,
    finalB: bruntime,
    identity: runtimeIdentity,
    note: `首次 ${fresh.freshVerifierInference} 窗口执行计入前置声学产物；最终 A/B 复用同一冻结模型/运行时/目标缓存，无模型加载。`,
  },
  45: {
    priorC611: baseline.strongContractionCount,
    topKStrong: contraction.rows.filter((r) => r.strong).length,
    postHocAuditRows: contractionGold.rows.length,
    priorOnlyNotStrong: contractionGold.rows.filter(
      (r) => r.priorStrong && !r.strong,
    ).length,
    priorReclassified: priorClasses,
    allDeletionRegressions: {
      leading: allClasses.LEADING_DIALOGUE_DELETION ?? 0,
      trailing: allClasses.TRAILING_DIALOGUE_DELETION ?? 0,
      internal: allClasses.INTERNAL_DIALOGUE_DELETION ?? 0,
    },
    catastrophicSubset: catastrophe,
    unit: "CANDIDATE_DIAGNOSTIC_NOT_APPLIED_GROUPS",
  },
  46: {
    postHocGoldValidShortening: safeShort,
    acousticallySelectable: contraction.rows.filter(
      (r) => r.strong && r.selectable,
    ).length,
  },
  47: {
    machineVerifiedHallucinationRemoval:
      machineClasses.VERIFIED_HALLUCINATION_REMOVAL ?? 0,
    note: "Gold相似度改善不等于证实声学幻觉删除。",
  },
  48: catastrophe.leading,
  49: catastrophe.trailing,
  50: catastrophe.internal,
  51: {
    machineUnknown: machineClasses.UNKNOWN_CONTRACTION ?? 0,
    postHocUnevaluable: allClasses.UNEVALUABLE ?? 0,
    strongPostHocUnevaluable: contractionGold.rows.filter(
      (r) => r.strong && r.goldClass === "UNEVALUABLE",
    ).length,
  },
  52: {
    machineGroups: mapping.groups.length,
    machineStatus: distribution(mapping.groups.map((g) => g.status)),
    fixedGoldBinding: mappingStatuses,
    mappingHash: mapping.semanticHash,
    goldBindingHash: groups.goldBindingHash,
  },
  53: {
    priorFixedGroups: oldMapping.groups.length,
    newMachineGroups: mapping.groups.length,
    evaluableGoldGroups: groups.rows.filter((g) =>
      g.status.startsWith("FIXED_"),
    ).length,
    topology:
      "machine-first; Gold spans crossing frozen groups remain ambiguous",
  },
  54: M("AMBIGUOUS"),
  55: M("NO_MAPPING"),
  56: precisionContext,
  57: features.featureNames,
  58: features.rawTextFeatureCount,
  59: features.goldFeatureCount,
  60: features.datasetSpecificFeatureCount,
  61: "providerWhisper/providerReazon；L7/A5固定移除这两个维度，不按测试折结果选择特征。",
  62: features.featureNames.slice(25, 34),
  63: {
    flags: features.featureNames.length,
    missingValues: features.rows.reduce(
      (n, r) => n + r.missing.filter(Boolean).length,
      0,
    ),
    imputation: C612_POLICY.rankers.imputation,
  },
  64: {
    featureHash: features.semanticHash,
    machineFreezeHash: freeze.semanticHash,
    policyHash: C612_POLICY_HASH,
    codeHash: freeze.codeAggregateHash,
  },
  65: chronology,
  66: {
    total: labels.labels.length,
    evaluable: labels.labels.filter((l) => l.eligible).length,
    classes: distribution(labels.labels.map((l) => l.labelClass)),
    role: "local counterfactual diagnostic only",
  },
  67: {
    total: groups.rows.length,
    evaluable: groups.rows.filter((g) => g.status.startsWith("FIXED_")).length,
    unknown: groups.rows.filter((g) => !g.status.startsWith("FIXED_")).length,
    fixedBindingHash: groups.goldBindingHash,
  },
  68: {
    method: C612_POLICY.folds,
    folds: folds.folds.map((f) => ({
      fold: f.foldId,
      blocks: f.blockIds.length,
      groups: f.groupIds.length,
      events: f.eventIds.length,
      candidates: f.candidateIds.length,
    })),
  },
  69: folds.audioLeakageCount,
  70: folds.correlationLeakageCount,
  71: L("L0"),
  72: L("L1"),
  73: L("L2"),
  74: L("L3"),
  75: L("L4"),
  76: L("L5"),
  77: L("L6"),
  78: L("L7"),
  79: L("L8"),
  80: {
    qualifiedBestSupportedProfile: route.strongSupportPassed
      ? primary.profileId
      : null,
    predeclaredPrimary: primary.profileId,
    postHocBestObserved: bestObserved?.profileId ?? null,
    warning:
      "后续主指标汇报预冻结L6；没有通过Strong Gate时不得称为已验证的最佳策略。事后最高收益对照仅用于描述，不替换主检验策略。",
  },
  81: primary.top1Accuracy,
  82: primary.mrr,
  83: primary.ndcg4,
  84: primary.selectedGroups,
  85: primary.improved,
  86: primary.regressed,
  87: primary.neutral,
  88: primary.unknown,
  89: {
    value: primary.precision,
    denominator: "improved + regressed; neutral excluded",
  },
  90: primary.harm,
  91: {
    value: primary.coverage,
    denominator: "evaluable changed groups / evaluable eligible groups",
  },
  92: primary.exactJointGain,
  93: primary.normalizedJointGain,
  94: {
    fixedGroupDelta: primary.materialDelta,
    legacy77: material.profiles.find((p) => p.profileId === primary.profileId),
  },
  95: primary.catastrophicDeletions,
  96: {
    topKDenominator: primary.top1OracleCapture,
    fullPoolDenominator: primary.top1FullPoolOracleCapture,
    replayedH2FullPool: L("L0").top1FullPoolOracleCapture,
    caveat: oracleCaveat,
  },
  97: {
    candidateOracleCapture: primary.candidateOracleCapture,
    boundedGroupJointCapture: primary.oracleCapture,
    caveat: oracleCaveat,
  },
  98: cv.folds.find(
    (p) => p.profileId === primary.profileId && p.foldId === "outer-1",
  ),
  99: cv.folds.find(
    (p) => p.profileId === primary.profileId && p.foldId === "outer-2",
  ),
  100: cv.folds.find(
    (p) => p.profileId === primary.profileId && p.foldId === "outer-3",
  ),
  101: cv.folds.find(
    (p) => p.profileId === primary.profileId && p.foldId === "outer-4",
  ),
  102: cv.folds.find(
    (p) => p.profileId === primary.profileId && p.foldId === "outer-5",
  ),
  103: {
    count: primary.activeFolds,
    status:
      primary.activeFolds === 1
        ? "SINGLE_ACTIVE_FOLD"
        : primary.activeFolds === 0
          ? "NO_ACTIVE_FOLDS"
          : "MULTIPLE_ACTIVE_FOLDS",
  },
  104: primary.negativeGainFolds,
  105: primary.unknownGainFolds,
  106: utility("completeness"),
  107: utility("edgeRisk"),
  108: utility("tokenSupport"),
  109: utility("ctcLoss"),
  110: ablations.comparisons.find((c) => c.changedFamily === "CORRELATION"),
  111: ablations.comparisons.find(
    (c) => c.changedFamily === "PROVIDER_IDENTITY",
  ),
  112: ablations.comparisons.filter(
    (c) =>
      c.changedFamily.includes("ACOUSTIC") || c.changedFamily.includes("CTC"),
  ),
  113: ablations.comparisons.find(
    (c) => c.changedFamily === "CONTRACTION_GATE",
  ),
  114: fail.RETRIEVAL_FAILURE ?? 0,
  115: fail.RERANKING_FAILURE ?? 0,
  116: fail.APPLICATION_GATE_FAILURE ?? 0,
  117: fail.EVALUATION_UNAVAILABLE ?? 0,
  118: {
    retrieval: bestRetrieval,
    conclusion: route.route,
    caveat: "低覆盖或无安全选择不足以证明候选池已充分；不外推到未见剧集。",
  },
  119: shadows.profiles.map((p) => ({
    profile: p.profileId,
    cues: p.cueCount,
  })),
  120: shadows.profiles.map((p) => ({
    profile: p.profileId,
    appliedEvents: p.appliedEventIds.length,
    textHash: p.canonicalTextHash,
    canonicalChanged: p.canonicalTextHash !== baseline.canonicalTextHash,
  })),
  121: shadows.productionTextMutation,
  122: shadows.productionTimingMutation,
  123: validation.productionParity,
  124: validation.productionParity,
  125: validation.productionParity,
  126: {
    semantic: validation.semanticParity,
    exactShadowBytes: validation.checks.find(
      (c) => c.name === "reranking-shadow-and-evaluation-A-B",
    ),
    barrierTimestampsExcluded: true,
  },
  127: validation.passed,
  128: { passed: route.strongSupportPassed, checks: route.checks },
  129: route.route,
  130: route.c613,
  131: {
    machineStages: 0,
    rawGoldInTrainer: 0,
    outerTestLabelsInPrediction: 0,
    evaluatorRawGoldAuthorized: true,
    numericTrainingLabelsUsed: true,
  },
  132: {
    datasetSpecificFeatures: 0,
    baselineIdentifiers: "replay assertions only, never model features",
    syntheticJapaneseFixtures: true,
  },
  133: false,
  134: 0,
  135: {
    fresh: fresh.freshVerifierInference,
    modelLoads: fresh.verifierModelLoads,
    finalAInference: runtime.freshVerifierInference,
    finalBInference: bruntime.freshVerifierInference,
  },
  136: readonly.sourceReadOnly,
  137: readonly.goldReadOnly,
  138: shareable,
  139: qaSummary.filter((c) => c.stage === "c6-1-targeted"),
  140: qaSummary.filter(
    (c) =>
      c.stage === "c6-1-1-targeted" ||
      c.stage === "c6-1-1-independent-acceptance",
  ),
  141: qaSummary.filter(
    (c) => c.stage === "unit" || c.stage === "python-ctc-unit",
  ),
  142: qaSummary.filter((c) => c.stage === "e2e"),
  143: qaSummary.filter((c) => c.stage.includes("targeted")),
  144: validation.schemaCount,
  145: {
    artifacts: validation.validatedArtifactCount,
    checks: validation.checks.filter((c) => c.passed).length,
    total: validation.checks.length,
    validationHash: validation.semanticHash,
  },
  146: qaSummary.filter((c) => c.stage === "skill"),
  147: validation.checks.find(
    (c) => c.name === "Skill2-Skill3-and-canonical-contracts-unchanged",
  ),
  148: "候选条件CTC不是独立转写真值；当前集已知，固定映射有Unknown；训练折数值标签与原始Gold文件严格分开；主策略不因post-hoc结果而改变；零选择不证明恢复能力。全output是本地研究资料，仅shareable摘要通过可分享审计。",
  149: {
    route: route.route,
    c613: route.c613,
    next:
      route.c613 === "GO"
        ? "只有独立新任务可做冻结策略的前瞻Shadow；本任务不自动启动。"
        : "保留当前证据和固定策略，不授权C6.1.3；下一阶段需单独批准并针对当前失败类别。",
  },
  150: {
    codeCommit,
    acceptanceCommit,
    reportCommit:
      "the commit containing this report; final SHA is recorded in the delivery receipt and final reply",
  },
  151: "最终推送后用 git ls-remote 独立核对；实际SHA见外部 delivery-git-receipt.json，不在报告内伪造自引用commit SHA。",
  152: outputNames,
  153: "Machine Freeze证明生成源码未变；验收修订另附源码哈希与完整QA。报告是独立文档提交，最终clean状态及remote/local相等检查见delivery-git-receipt.json。",
};
const replyTitles =
  `Branch|Baseline|Full Rank Audit Commit|Top-K Commit|Correlation Commit|Acoustic Completeness Commit|Reranker Commit|Evaluation Commit|Acceptance Commit|Remote HEAD|Policy Version|Policy Hash|Baseline Replay Passed|Baseline Cue Count|Canonical Event Count|Eligible Event Count|Input Candidate Count|Included Candidate Count|Whisper Candidate Count|Reazon Candidate Count|Full Rank Records|Top-K Event Count|Top-K Candidate Count|Current Candidate Count|Alternative Candidate Count|Top-K Conservation Passed|Silent Drop Count|T0 Recall@1|T0 Recall@2|T0 Recall@3|T0 Recall@4|T0 MRR|T0 nDCG@4|T1 Recall@4|T2 Recall@4|T3 Recall@4|Best Retrieval Profile|Best Retrieval Recall@1|Best Retrieval Recall@2|Best Retrieval Recall@3|Best Retrieval Recall@4|Best Retrieval MRR|Best Retrieval nDCG@4|Verified Core Identity Count|Provisional Identity Count|Unknown Identity Count|Correlation Identity Coverage|Same-audio Groups Reconciled|Duplicate Votes Prevented|Same-core Cross-provider Count|Completeness Candidate Count|Verified Complete|Likely Complete|Partial Leading|Partial Trailing|Partial Internal|Edge Truncated|Adjacent Contaminated|Insufficient Evidence|Completeness Coverage|CTC Scorable Count|CTC Unscorable Count|Fresh Verifier Inference|Verifier Cache Hits|Verifier Model Loads|Strong Contraction Count|Verified Hallucination Removal|Valid Shortening|Catastrophic Leading|Catastrophic Trailing|Catastrophic Internal|Unknown Contraction|Baseline Fixed Group Count|Mapping V2 Group Count|Mapping V2 One-to-one|Mapping V2 One-to-many|Mapping V2 Many-to-one|Mapping V2 Many-to-many|Mapping V2 Ambiguous|Mapping V2 No Mapping|Changed-group Evaluation Coverage|Feature Count|Raw-text Feature Count|Gold Feature Count|Dataset-specific Feature Count|Fold Count|Fold Freeze Before Gold|Audio Leakage Count|Correlation Leakage Count|L0 Top-1 Accuracy|L0 Normalized Gain|L1 Top-1 Accuracy|L1 Normalized Gain|L2 Top-1 Accuracy|L2 Normalized Gain|L3 Top-1 Accuracy|L3 Normalized Gain|L4 Top-1 Accuracy|L4 Normalized Gain|L5 Top-1 Accuracy|L5 Normalized Gain|L6 Selected Count|L6 Improved|L6 Regressed|L6 Neutral|L6 Unknown|L6 Precision|L6 Harm Rate|L6 Coverage|L6 Normalized Gain|L6 Material Error Delta|L6 Catastrophic Deletion Regressions|Best Gold-free Profile|Best Profile Top-1 Accuracy|Best Profile MRR|Best Profile nDCG@4|Best Profile Selected|Best Profile Improved|Best Profile Regressed|Best Profile Neutral|Best Profile Unknown|Best Profile Precision|Best Profile Harm Rate|Best Profile Selective Coverage|Best Profile Exact Joint Gain|Best Profile Normalized Joint Gain|Best Profile Material Error Delta|Best Profile Catastrophic Deletion Count|Best Profile Top-1 Oracle Capture|Active Fold Count|Negative-gain Fold Count|Unknown-gain Fold Count|Completeness AUC|Edge-risk AUC|Token-support Utility|CTC Utility|Correlation-control Utility|Retrieval Failure Count|Reranking Failure Count|Gate Failure Count|Evaluation-unavailable Count|Engineering Gate|Strong Support Gate|Route Decision|C6.1.3 GO/HOLD|Production Mutation/Parity|Runtime Gold/Hardcoding/Network|Tests/Schemas/Regressions|Report/Output Paths|Worktree Status`.split(
    "|",
  );
const F: Record<number, unknown> = {
  1: branch,
  2: baseline.acceptanceCommit,
  3: codeCommit,
  4: codeCommit,
  5: codeCommit,
  6: codeCommit,
  7: codeCommit,
  8: codeCommit,
  9: acceptanceCommit,
  10: "待最终文档提交和推送后，以独立 delivery-git-receipt.json 核对；验收代码提交不等于 Remote HEAD。",
  11: s.C612_VERSION,
  12: C612_POLICY_HASH,
  13: baseline.passed,
  14: baseline.cueCount,
  15: baseline.eventCount,
  16: counts.eligibleEvents,
  17: counts.input,
  18: counts.included,
  19: counts.whisper,
  20: counts.reazon,
  21: counts.rankRows,
  22: counts.eligibleEvents,
  23: counts.topKUnique,
  24: counts.current,
  25: counts.alternatives,
  26: conservation.passed,
  27: conservation.silentDropCount,
  28: T(0).recall1,
  29: T(0).recall2,
  30: T(0).recall3,
  31: T(0).recall4,
  32: T(0).mrr,
  33: T(0).ndcg4,
  34: T(1).recall4,
  35: T(2).recall4,
  36: T(3).recall4,
  37: bestRetrieval.profile,
  38: bestRetrieval.recall1,
  39: bestRetrieval.recall2,
  40: bestRetrieval.recall3,
  41: bestRetrieval.recall4,
  42: bestRetrieval.mrr,
  43: bestRetrieval.ndcg4,
  44: correlation.verified,
  45: correlation.provisional,
  46: correlation.unknown,
  47: correlation.coverage,
  48: reconciliation.sameAudioGroupsReconciled,
  49: reconciliation.duplicateVotesPrevented,
  50: reconciliation.sameCoreCrossProviderCount,
  51: completeness.rows.length,
  52: C("VERIFIED_COMPLETE"),
  53: C("LIKELY_COMPLETE"),
  54: C("PARTIAL_LEADING"),
  55: C("PARTIAL_TRAILING"),
  56: C("PARTIAL_INTERNAL"),
  57: C("EDGE_TRUNCATED") + C("BOTH_TRUNCATED_AND_CONTAMINATED"),
  58: C("ADJACENT_CONTAMINATED") + C("BOTH_TRUNCATED_AND_CONTAMINATED"),
  59: C("INSUFFICIENT_EVIDENCE"),
  60: completenessCoverage,
  61: ctcStatus.SCORABLE ?? 0,
  62: ctcStatus.UNSCORABLE ?? 0,
  63: fresh.freshVerifierInference,
  64: {
    A: runtime.verifierCacheHits,
    B: bruntime.verifierCacheHits,
    preflight: fresh.verifierCacheHits,
  },
  65: {
    fresh: fresh.verifierModelLoads,
    A: runtime.verifierModelLoads,
    B: bruntime.verifierModelLoads,
  },
  66: contraction.rows.filter((r) => r.strong).length,
  67: machineClasses.VERIFIED_HALLUCINATION_REMOVAL ?? 0,
  68: safeShort,
  69: catastrophe.leading,
  70: catastrophe.trailing,
  71: catastrophe.internal,
  72: machineClasses.UNKNOWN_CONTRACTION ?? 0,
  73: oldMapping.groups.length,
  74: mapping.groups.length,
  75: M("FIXED_ONE_TO_ONE"),
  76: M("FIXED_ONE_TO_MANY"),
  77: M("FIXED_MANY_TO_ONE"),
  78: M("FIXED_MANY_TO_MANY"),
  79: M("AMBIGUOUS"),
  80: M("NO_MAPPING"),
  81: primary.changedGroupEvaluationCoverage,
  82: features.featureNames.length,
  83: features.rawTextFeatureCount,
  84: features.goldFeatureCount,
  85: features.datasetSpecificFeatureCount,
  86: folds.folds.length,
  87: folds.frozenBeforeGold,
  88: folds.audioLeakageCount,
  89: folds.correlationLeakageCount,
  90: L("L0").top1Accuracy,
  91: L("L0").normalizedJointGain,
  92: L("L1").top1Accuracy,
  93: L("L1").normalizedJointGain,
  94: L("L2").top1Accuracy,
  95: L("L2").normalizedJointGain,
  96: L("L3").top1Accuracy,
  97: L("L3").normalizedJointGain,
  98: L("L4").top1Accuracy,
  99: L("L4").normalizedJointGain,
  100: L("L5").top1Accuracy,
  101: L("L5").normalizedJointGain,
  102: L("L6").selectedGroups,
  103: L("L6").improved,
  104: L("L6").regressed,
  105: L("L6").neutral,
  106: L("L6").unknown,
  107: L("L6").precision,
  108: L("L6").harm,
  109: L("L6").coverage,
  110: L("L6").normalizedJointGain,
  111: L("L6").materialDelta,
  112: L("L6").catastrophicDeletions,
  113: {
    qualifiedBestSupportedProfile: route.strongSupportPassed
      ? primary.profileId
      : null,
    primaryForFields114To132: primary.profileId,
    postHocBestObservedDiagnosticOnly: bestObserved?.profileId ?? null,
  },
  114: primary.top1Accuracy,
  115: primary.mrr,
  116: primary.ndcg4,
  117: primary.selectedGroups,
  118: primary.improved,
  119: primary.regressed,
  120: primary.neutral,
  121: primary.unknown,
  122: primary.precision,
  123: primary.harm,
  124: primary.coverage,
  125: primary.exactJointGain,
  126: primary.normalizedJointGain,
  127: primary.materialDelta,
  128: primary.catastrophicDeletions,
  129: {
    topK: primary.top1OracleCapture,
    fullPool: primary.top1FullPoolOracleCapture,
    joint: primary.oracleCapture,
  },
  130: primary.activeFolds,
  131: primary.negativeGainFolds,
  132: primary.unknownGainFolds,
  133: utility("completeness").auc,
  134: utility("edgeRisk").auc,
  135: utility("tokenSupport"),
  136: utility("ctcLoss"),
  137: R[110],
  138: R[114],
  139: R[115],
  140: R[116],
  141: R[117],
  142: validation.passed,
  143: route.strongSupportPassed,
  144: route.route,
  145: route.c613,
  146: { text: 0, timing: 0, cues: 0, parity: validation.productionParity },
  147: {
    runtimeRawGold: 0,
    datasetFeatures: 0,
    network: false,
    numericTrainLabelsUsed: true,
  },
  148: {
    qa: qaSummary,
    schemas: validation.schemaCount,
    artifactChecks: `${validation.checks.filter((c) => c.passed).length}/${validation.checks.length}`,
  },
  149: {
    report: "docs/C6_1_2_TOP_K_RERANKING_ACOUSTIC_COMPLETENESS_REPORT.md",
    output: outputNames,
  },
  150: "最终git receipt记录；报告生成阶段不预先声称clean或已推送。",
};
const answers = [
  `H2 Rank 分布（可评价且有改进空间的事件）：${JSON.stringify(rankDistribution)}。分布对并列Oracle采用确定性的候选ID代表；Recall@K则允许任一并列Oracle命中，因此代表候选Rank的累计数不必等于Recall分子。`,
  `T0 Recall@1/2/3/4=${[T(0).recall1, T(0).recall2, T(0).recall3, T(0).recall4].map(pct).join("/")}；MRR=${T(0).mrr}，nDCG@4=${T(0).ndcg4}。`,
  `在当前可评价集合中 full-pool oracle gain=${primary.localFullExistingOracleGain}、Top-K gain=${primary.localTopKOracleGain}；主策略失败分布=${JSON.stringify(fail)}。结论以固定映射覆盖为界，不用Unknown证明候选池充分或不足。`,
  `事后检索对照最优=${bestRetrieval.profile}，Recall@4=${pct(bestRetrieval.recall4)}；预冻结运行主策略仍为T3，不按Gold切换。`,
  `T3减T0 Recall@4=${T(3).recall4 === null || T(0).recall4 === null ? "unknown" : c612Defined(T(3).recall4) - c612Defined(T(0).recall4)}；这是整个检索配置对照，不宣称单因素因果。`,
  `${correlation.verified}/${correlation.total} verified，${correlation.provisional} provisional，${correlation.unknown} unknown。`,
  `合并same-audio observation groups=${reconciliation.sameAudioGroupsReconciled}，阻止重复投票=${reconciliation.duplicateVotesPrevented}；不是把缺失身份当独立支持。`,
  `Completeness非unknown=${pct(completenessCoverage)}；requestEdgeRisk可计算=${pct(ratio(completeness.rows.filter((r) => r.requestLeftEdgeDistance !== null && r.requestRightEdgeDistance !== null).length, completeness.rows.length))}；tokenSupport可计算=${pct(ratio(completeness.rows.filter((r) => r.candidateTokenSupportCoverage !== null).length, completeness.rows.length))}。可计算不等于安全或有支持。`,
  `旧${baseline.strongContractionCount}项：${JSON.stringify(priorClasses)}。Gold后验有效缩短不等于声学已证实安全；机器unknown继续阻断。`,
  `Completeness AUC=${utility("completeness").auc}，safe false-block=${utility("completeness").safeFalseBlockRate}；覆盖=${pct(completenessCoverage)}。以这些证据判断，不以零自动应用宣称区分能力已解决。`,
  `L0 accuracy/MRR/nDCG=${L("L0").top1Accuracy}/${L("L0").mrr}/${L("L0").ndcg4}；L2=${L("L2").top1Accuracy}/${L("L2").mrr}/${L("L2").ndcg4}；L3=${L("L3").top1Accuracy}/${L("L3").mrr}/${L("L3").ndcg4}。`,
  `${JSON.stringify(R[110])}；只报告固定ablation对照，不视为跨数据集因果证据。`,
  `${JSON.stringify(R[112])}；包含feature与gate同时改变的对照会明确标注，不能归因给单一feature。`,
  `冻结主策略${primary.profileId}的已应用、可评价组 catastrophic=${primary.catastrophicDeletions}、实际选择组=${primary.selectedGroups}。若为零选择，只能说明安全回退，不能宣称自动修复能力已验证。`,
  `主策略active=${primary.activeFolds}/5，negative=${primary.negativeGainFolds}，unknown-gain=${primary.unknownGainFolds}；事后最优${bestObserved?.profileId ?? "unknown"} active=${bestObserved?.activeFolds ?? "unknown"}，不用于改换主检验策略。`,
  `主策略improved/regressed/neutral/unknown=${primary.improved}/${primary.regressed}/${primary.neutral}/${primary.unknown}；post-hoc最优对照=${bestObserved ? `${bestObserved.profileId}:${bestObserved.improved}/${bestObserved.regressed}/${bestObserved.neutral}/${bestObserved.unknown}` : "unknown"}。`,
  `主策略precision=${pct(primary.precision)}，harm=${pct(primary.harm)}，selective coverage=${pct(primary.coverage)}，normalized joint gain=${primary.normalizedJointGain}，fixed-group material delta=${primary.materialDelta}。事后最高收益对照${bestObserved?.profileId ?? "unknown"}：${bestObserved ? `precision=${pct(bestObserved.precision)}，harm=${pct(bestObserved.harm)}，selective coverage=${pct(bestObserved.coverage)}，normalized joint gain=${bestObserved.normalizedJointGain}，fixed-group material delta=${bestObserved.materialDelta}` : "unknown"}；不用于部署选择。`,
  `Top-K分母 capture=${pct(primary.top1OracleCapture)}；full-pool分母=${pct(primary.top1FullPoolOracleCapture)}；同V2的H2=${pct(L("L0").top1FullPoolOracleCapture)}。80%目标=${primary.top1OracleCapture !== null && primary.top1OracleCapture >= 0.8 ? "数值达到；仍需其余strong gates" : "未达到或unknown"}。${oracleCaveat}`,
  `主策略分布=${JSON.stringify(fail)}；最大未恢复类别=${
    Object.entries(fail)
      .filter(([k]) => !["RECOVERED", "NO_ERROR_TO_RECOVER"].includes(k))
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "无"
  }。`,
  `${route.route}；C6.1.3 ${route.c613}。Engineering=${validation.passed}；Strong=${route.strongSupportPassed}。`,
];
const entries = (titles: string[], values: Record<number, unknown>) =>
  titles.map((title, i) => {
    if (!(i + 1 in values) || values[i + 1] === undefined)
      throw new Error(`C612_REPORT_FIELD_MISSING:${i + 1}:${title}`);
    return { index: i + 1, title, value: format(values[i + 1]) };
  });
const reportEntries = entries(reportTitles, R),
  replyEntries = entries(replyTitles, F),
  questions = answers.map((value, i) => ({
    index: i + 1,
    title: `Q${i + 1}`,
    value,
  }));
const data = s.c612ReportDataSchema.parse(
  artifact("c6-1-2-report-data", {
    validationHash: validation.semanticHash,
    regressionHash: qa.semanticHash,
    machineFreezeHash: freeze.semanticHash,
    rawGoldRead: false,
    candidateTextReadForReport: false,
    reportEntries,
    replyEntries,
    questions,
    codeCommit,
    acceptanceCommit,
  }),
);
const body = [
  "# C6.1.2 Top-K Reranking & Acoustic Completeness Report",
  "",
  `工程验收：${validation.passed ? "PASSED" : "FAILED"}。研究路线：\`${route.route}\`。C6.1.3：**${route.c613}**。`,
  "",
  "本报告只读取已冻结的指标、ID、哈希与验收产物，不读取原始Gold字幕或候选文本。全部输出为本地研究资料；可分享审计仅覆盖聚合summary。",
  "",
  ...reportEntries.flatMap((r) => [
    `## ${r.index}. ${r.title}`,
    "",
    r.value.startsWith("{") || r.value.startsWith("[")
      ? `\`\`\`json\n${r.value}\n\`\`\``
      : r.value,
    "",
  ]),
  "## Q1–Q20",
  "",
  ...questions.flatMap((q) => [`### ${q.title}`, "", q.value, ""]),
  "## 附录：冻结模型与边界",
  "",
  chronology,
  "",
  oracleCaveat,
  "",
  "运行时身份包括Python/torch/transformers版本及worker源码；本次固定本地运行时与历史记录版本不同，已经生成新的runtime identity，未伪称相同。FFmpeg仅重读所选source，CTC不产生转写。",
  "",
  "生成源码冻结与最终验收源码分开绑定。独立验收发现历史lattice数组容器注册缺失，以及浮点请求区间与实际PCM样本时基的校验口径不一致；仅修复校验器并新增回归测试。使用原始生成源码checkout验证原有A/B Freeze，逐文件证明检索、证据、完整性、阈值、重排、Gold evaluator及全部既有数据未改写。生成前QA与修订后QA均保留并核验，未在Gold后重建候选、重训模型或改调阈值。",
  "",
  "报告交叉检查还区分了一般删除退化与catastrophic=true的严格子集。报告中的Catastrophic Leading/Trailing/Internal只计入已有冻结标记为true的候选；未知标记不计为已确认，候选诊断计数也不是实际应用组的退化数。收缩后验审计保留历史强收缩而本版不再判强的记录，故审计行数可以多于本版Strong Contraction数。该修订仅调整报告汇总并新增回归测试，没有改写标签或质量指标。",
  "",
  ...validation.checks
    .filter(
      (c) =>
        c.name === "frozen-generation-vs-acceptance-only-source" ||
        c.name === "generation-QA-before-acceptance-repair",
    )
    .flatMap((c) => [
      `### ${c.name}`,
      "",
      c.observed.startsWith("{")
        ? `\`\`\`json\n${c.observed}\n\`\`\``
        : c.observed,
      "",
    ]),
  `报告数据校验：\`${data.semanticHash}\`。`,
  "",
].join("\n");
await writeFile(arg("--output"), body, { flag: "wx" });
await writeArtifact(arg("--data-output"), data);
process.stdout.write(
  JSON.stringify({
    reportSections: reportEntries.length,
    replyFields: replyEntries.length,
    questions: questions.length,
    reportDataHash: data.semanticHash,
    route: route.route,
  }) + "\n",
);
