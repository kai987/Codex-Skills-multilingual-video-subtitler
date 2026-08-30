import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as schemas from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";

/** User-requested report/checklist headings; data below is read only from artifacts. */
const REPORT_TITLES = [
  "Executive Conclusion",
  "Branch",
  "Baseline",
  "C6.1 Replay",
  "Product Route Preservation",
  "Research Scope",
  "Goals",
  "Non-goals",
  "Why Novel Paths Are Disabled",
  "Legacy Evaluation Coverage",
  "Fixed Alignment Design",
  "Baseline Mapping Freeze",
  "Mapping Status Counts",
  "Changed Group Count",
  "Fixed Mapped Changed Groups",
  "Ambiguous Groups",
  "Unmapped Groups",
  "Structure-incompatible Groups",
  "Fixed Evaluation Coverage",
  "Legacy vs Fixed Evaluation",
  "Candidate Universe Replay",
  "Existing-candidate Eligibility",
  "Proposal Generation",
  "Proposed Alternative Count",
  "Proposal Provider Distribution",
  "Proposal Role Distribution",
  "Legacy Candidate MBR Risk",
  "Provider-balanced MBR",
  "Hierarchical MBR",
  "Correlation Audit",
  "Correlation Group Count",
  "Singleton Group Count",
  "Singleton Rate",
  "Same-audio Split Groups",
  "Hierarchical Group Policy",
  "Current-preservation Contract",
  "Raw MBR Margin",
  "Hierarchical MBR Margin",
  "Runner-up Margin",
  "Length Ratio",
  "Contraction Risk",
  "Completeness Risk",
  "Request-edge Risk",
  "Hallucination Risk",
  "CTC Evidence",
  "Machine Feature Table",
  "Feature Count",
  "Gold-free Feature Audit",
  "Feature Freeze",
  "Gold Label Barrier",
  "SWITCH_IMPROVES Count",
  "SWITCH_REGRESSES Count",
  "SWITCH_NEUTRAL Count",
  "SWITCH_UNEVALUABLE Count",
  "Proposal Oracle Gain",
  "Best Existing Candidate Oracle Gain",
  "Proposal Oracle Coverage",
  "Fold Design",
  "Fold Freeze",
  "Leakage Audit",
  "S0 KEEP_ALL_CURRENT",
  "S1 Legacy Candidate MBR",
  "S2 Raw-margin Selective",
  "S3 Hierarchical Selective",
  "S4 Current-preservation",
  "S5 Deletion/Completeness-aware",
  "S6 Full Machine Evidence",
  "S7 Conservative Rule",
  "Best Active Profile",
  "Null Baseline",
  "OOF Selected Count",
  "OOF Correct Switches",
  "OOF Wrong Switches",
  "OOF Neutral Switches",
  "OOF Abstentions",
  "OOF Precision",
  "Precision Wilson Interval",
  "OOF Harm Rate",
  "OOF Selective Coverage",
  "OOF Exact Gain",
  "OOF Normalized Gain",
  "Proposal Oracle Capture",
  "Candidate Oracle Capture",
  "Fold 1 Result",
  "Fold 2 Result",
  "Fold 3 Result",
  "Fold 4 Result",
  "Fold 5 Result",
  "Negative-gain Fold Count",
  "Active-selection Fold Count",
  "OOF Shadow Cue Count",
  "OOF Exact CER",
  "OOF Normalized CER",
  "OOF Coverage",
  "OOF Missing",
  "OOF Hallucination",
  "OOF Material Errors",
  "OOF Severe Timing",
  "OOF Start MAE",
  "OOF End MAE",
  "OOF P95",
  "OOF IoU",
  "OOF Overlap",
  "Provider Switch Distribution",
  "Whisper Proposal Improvements",
  "Whisper Proposal Regressions",
  "Reazon Proposal Improvements",
  "Reazon Proposal Regressions",
  "Length Bias",
  "Improved Length Ratio",
  "Regressed Length Ratio",
  "Strong Contraction Count",
  "Strong Contraction Improvements",
  "Strong Contraction Regressions",
  "Catastrophic Deletion Regressions",
  "CTC Support Utility",
  "CTC Veto Utility",
  "Correlation-control Utility",
  "Hierarchical MBR Utility",
  "Proposal Generator Errors",
  "Gate Errors",
  "Provider Weight Errors",
  "Contraction Errors",
  "Edge/Completeness Errors",
  "Unknown Attribution",
  "Review Suggestion Sidecar",
  "Review Workspace Compatibility",
  "Novel Legal Path Application Count",
  "Expected Novel Application Count = 0",
  "Production Text Mutation",
  "Production Timing Mutation",
  "Production ASS Parity",
  "Production SRT Parity",
  "Production VTT Parity",
  "OOF Shadow ASS",
  "OOF Shadow SRT",
  "OOF Shadow VTT",
  "A/B Reproducibility",
  "Fixed Coverage Gate",
  "Strong Support Gate",
  "Promising Gate",
  "Route Decision",
  "Frozen Model Created?",
  "C6.1.2 Recommendation",
  "C6.0.2 Status",
  "Production Status",
  "Machine Release Authorized",
  "Runtime Gold Input",
  "Dataset Hardcoding",
  "Network",
  "Source Read-only",
  "Gold Read-only",
  "Shareable Audit",
  "C5.19 Regression",
  "C6 Investigation Regression",
  "C6 Protected Regression",
  "C6.0.1–C6.0.1.12 Regressions",
  "C6.1 Regression",
  "Unit Tests",
  "E2E Tests",
  "Targeted Tests",
  "Schema Count",
  "Skill Validation",
  "Skill2/3",
  "Remaining Risks",
  "Commits",
  "Remote HEAD",
  "Output Paths",
] as const;
const FINAL_TITLES = [
  "Branch",
  "Baseline",
  "Fixed Alignment Commit",
  "Hierarchical MBR Commit",
  "Preservation/Risk Commit",
  "Calibration Commit",
  "Shadow/Evaluation Commit",
  "Acceptance Commit",
  "Remote HEAD",
  "Policy Version",
  "Policy Hash",
  "C6.1 Replay Passed",
  "Baseline Machine Cue Count",
  "Canonical Event Count",
  "Multi-hypothesis Event Count",
  "Input Candidate Count",
  "Included Real ASR Candidate Count",
  "Whisper Candidate Count",
  "Reazon Candidate Count",
  "Legacy Event-level Evaluable Count",
  "Baseline Cue Group Count",
  "Changed Cue Group Count",
  "Fixed One-to-one Mappings",
  "Fixed One-to-many Mappings",
  "Fixed Many-to-one Mappings",
  "Fixed Many-to-many Mappings",
  "Ambiguous Mappings",
  "No Mappings",
  "Structure-incompatible Mappings",
  "Fixed Changed-group Evaluation Coverage",
  "Evaluation Coverage Gate Passed",
  "Legacy P6 Changed Events",
  "Fixed-evaluable P6 Changed Groups",
  "Fixed P6 Improved",
  "Fixed P6 Regressed",
  "Fixed P6 Neutral",
  "Fixed P6 Net Edit Gain",
  "Legacy Correlation Group Count",
  "Legacy Singleton Group Count",
  "Legacy Singleton Rate",
  "Hierarchical Correlation Group Count",
  "Hierarchical Singleton Count",
  "Same-audio Split Groups Reconciled",
  "Correlation Audit Passed",
  "Eligible Proposal Events",
  "Proposed Alternative Count",
  "Proposed Whisper Count",
  "Proposed Reazon Count",
  "Structurally Blocked Proposal Count",
  "Raw MBR Positive-margin Count",
  "Hierarchical MBR Positive-margin Count",
  "Strong Contraction Proposal Count",
  "Edge-truncation Proposal Count",
  "Incomplete-speech Proposal Count",
  "Feature Count",
  "Raw-text Feature Count",
  "Gold Feature Count",
  "Dataset-specific Feature Count",
  "Feature Freeze Before Gold",
  "SWITCH_IMPROVES Labels",
  "SWITCH_REGRESSES Labels",
  "SWITCH_NEUTRAL Labels",
  "SWITCH_UNEVALUABLE Labels",
  "Proposal Oracle Gain",
  "Best Existing Candidate Oracle Gain",
  "Proposal Oracle Capture Ceiling",
  "Fold Count",
  "Folds Frozen Before Labels",
  "Audio Leakage Count",
  "Event Leakage Count",
  "S0 Selected",
  "S0 Gain",
  "S1 Selected",
  "S1 Correct",
  "S1 Wrong",
  "S1 Gain",
  "S2 Selected",
  "S2 Correct",
  "S2 Wrong",
  "S2 Gain",
  "S3 Selected",
  "S3 Correct",
  "S3 Wrong",
  "S3 Gain",
  "S4 Selected",
  "S4 Correct",
  "S4 Wrong",
  "S4 Gain",
  "S5 Selected",
  "S5 Correct",
  "S5 Wrong",
  "S5 Gain",
  "S6 Selected",
  "S6 Correct",
  "S6 Wrong",
  "S6 Gain",
  "S7 Selected",
  "S7 Correct",
  "S7 Wrong",
  "S7 Gain",
  "Best Active Profile",
  "OOF Selected Count",
  "OOF Correct Switches",
  "OOF Wrong Switches",
  "OOF Neutral Switches",
  "OOF Abstentions",
  "OOF Precision",
  "OOF Wilson Lower",
  "OOF Wilson Upper",
  "OOF Harm Rate",
  "OOF Selective Coverage",
  "OOF Exact Edit Gain",
  "OOF Normalized Edit Gain",
  "Proposal Oracle Capture",
  "Candidate Oracle Capture",
  "Negative-gain Fold Count",
  "Catastrophic Deletion Regression Count",
  "OOF Exact CER",
  "OOF Normalized CER",
  "OOF Coverage",
  "OOF Missing",
  "OOF Hallucination",
  "OOF Material Errors",
  "OOF Severe Timing",
  "OOF Start MAE",
  "OOF End MAE",
  "OOF P95",
  "OOF IoU",
  "OOF Overlap",
  "Selected Whisper Count",
  "Selected Reazon Count",
  "Mean Improved Length Ratio",
  "Mean Regressed Length Ratio",
  "CTC Useful Support Count",
  "CTC Harmful Support Count",
  "Correlation-control Utility",
  "Proposal Generator Error Count",
  "Selection Gate Error Count",
  "Novel Legal Path Application Count",
  "Production Text Mutation",
  "Production Timing Mutation",
  "Production ASS/SRT/VTT Parity",
  "A/B Parity",
  "Strong Support Gate",
  "Promising Gate",
  "Route Decision",
  "C6.1.2 GO/HOLD",
  "C6.0.2 GO/HOLD",
  "Tests / Report / Output Paths",
  "Worktree Status",
] as const;

const REPORT_NAME = "C6_1_1_FIXED_ALIGNMENT_SELECTIVE_EXISTING_MBR_REPORT.md";
const UNKNOWN = "UNKNOWN：未提供可验证证据；不据此宣称通过。";
const NOT_APPLICABLE =
  "NOT_APPLICABLE：没有符合条件的 Active Profile，不能用 S0 零选择冒充成功。";
interface Artifact {
  semanticHash: string;
}
type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("C611_REPORT_REQUIRED_VALUE_MISSING");
  return value;
}
interface ArtifactIdentity {
  name: string;
  relativePath: string;
  semanticHash: string;
  sha256: string;
}
async function readArtifact<T extends Artifact>(
  root: string,
  name: string,
  schema: z.ZodType<T>,
  identities: ArtifactIdentity[],
  optional = false,
): Promise<T | null> {
  for (const prefix of [
    "",
    "machine",
    "evaluation",
    "shadow",
    "validation",
    "shareable",
  ]) {
    const relativePath = path.join(prefix, `${name}.json`);
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(root, relativePath));
    } catch (error) {
      if (record(error).code === "ENOENT") continue;
      throw error;
    }
    const parsed = schema.parse(JSON.parse(bytes.toString("utf8")));
    const { semanticHash, ...body } = parsed;
    if (hash(body) !== semanticHash)
      throw new Error(`C611_REPORT_HASH_INVALID:${name}`);
    identities.push({
      name,
      relativePath,
      semanticHash,
      sha256: sha256(bytes),
    });
    return parsed;
  }
  if (optional) return null;
  throw new Error(`C611_REPORT_ARTIFACT_MISSING:${name}`);
}
async function loadRun(root: string) {
  const identities: ArtifactIdentity[] = [];
  const load = async <T extends Artifact>(name: string, schema: z.ZodType<T>) =>
    required(await readArtifact(root, name, schema, identities));
  const optional = <T extends Artifact>(name: string, schema: z.ZodType<T>) =>
    readArtifact(root, name, schema, identities, true);
  return {
    identities,
    baseline: await load("c6-1-1-baseline", schemas.c611BaselineSchema),
    freeze: await load(
      "c6-1-1-machine-feature-freeze",
      schemas.c611MachineFeatureFreezeSchema,
    ),
    policy: await load("c6-1-1-policy-freeze", schemas.c611PolicyFreezeSchema),
    calibrationPolicy: await load(
      "c6-1-1-calibration-policy",
      schemas.c611CalibrationPolicySchema,
    ),
    folds: await load(
      "c6-1-1-calibration-folds",
      schemas.c611CalibrationFoldsSchema,
    ),
    proposals: await load(
      "machine-selective-existing-candidate-proposals",
      schemas.machineSelectiveExistingCandidateProposalsSchema,
    ),
    features: await load(
      "machine-selective-mbr-features",
      schemas.machineSelectiveMbrFeaturesSchema,
    ),
    completeness: await load(
      "machine-existing-candidate-completeness-risk",
      schemas.machineExistingCandidateCompletenessRiskSchema,
    ),
    correlation: await load(
      "machine-c6-1-1-candidate-correlation-audit",
      schemas.machineC611CandidateCorrelationAuditSchema,
    ),
    correlationGroups: await load(
      "machine-c6-1-1-hierarchical-correlation-groups",
      schemas.machineC611HierarchicalCorrelationGroupsSchema,
    ),
    risks: await load(
      "machine-existing-candidate-mbr-risk-ledger",
      schemas.machineExistingCandidateMbrRiskLedgerSchema,
    ),
    legacy: await load(
      "c6-1-1-legacy-p6-control",
      schemas.c611LegacyControlSchema,
    ),
    map: await load(
      "c6-1-1-fixed-baseline-alignment-map",
      schemas.c611FixedBaselineAlignmentMapSchema,
    ),
    labels: await load(
      "gold-selective-existing-candidate-labels",
      schemas.c611ProposalLabelsSchema,
    ),
    legacyLabels: await load(
      "gold-legacy-p6-labels",
      schemas.c611ProposalLabelsSchema,
    ),
    oof: await load(
      "c6-1-1-out-of-fold-selective-decisions",
      schemas.c611OofDecisionsSchema,
    ),
    profiles: await load(
      "c6-1-1-selective-profile-results",
      schemas.c611SelectiveProfileResultsSchema,
    ),
    oracle: await load(
      "c6-1-1-grouped-existing-candidate-oracles",
      schemas.c611GroupedOracleSchema,
    ),
    manifest: await load(
      "c6-1-1-shadow-manifest",
      schemas.c611ShadowManifestSchema,
    ),
    route: await optional(
      "c6-1-1-route-decision",
      schemas.c611RouteDecisionSchema,
    ),
    future: await optional(
      "c6-1-1-selective-mbr-freeze",
      schemas.c611SelectiveMbrFreezeSchema,
    ),
    proof: await optional(
      "c6-1-1-read-only-proof",
      schemas.c611ReadOnlyProofSchema,
    ),
    attribution: await optional(
      "c6-1-1-selective-mbr-error-attribution",
      schemas.c611ErrorAttributionSchema,
    ),
    suggestions: await optional(
      "machine-c6-1-1-selective-mbr-review-suggestions",
      schemas.c611ReviewSuggestionsSchema,
    ),
    shareable: await optional(
      "c6-1-1-shareable-summary",
      schemas.c611ShareableSummarySchema,
    ),
  };
}
type RunData = Awaited<ReturnType<typeof loadRun>>;
type Profile = RunData["profiles"]["profiles"][number];
function histogram(values: readonly (string | null | undefined)[]) {
  const counts: Record<string, number> = {};
  for (const value of values)
    counts[value ?? "UNKNOWN"] = (counts[value ?? "UNKNOWN"] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}
function stats(values: readonly (number | null | undefined)[]) {
  const known = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  return {
    known: known.length,
    unknown: values.length - known.length,
    mean: known.length
      ? known.reduce((sum, value) => sum + value, 0) / known.length
      : null,
    minimum: known.length ? Math.min(...known) : null,
    maximum: known.length ? Math.max(...known) : null,
  };
}
function fraction(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : null;
}
function sanitize(value: unknown): unknown {
  if (typeof value === "string")
    return value
      .replace(
        /\/(?:Users|home|private|tmp|var)\/[^\n"<>]*/gu,
        "[LOCAL_PATH_REDACTED]",
      )
      .replace(/\b[A-Za-z]:\\[^\n"<>]*/gu, "[LOCAL_PATH_REDACTED]")
      .replace(/\b(?:sk-|hf_)[A-Za-z0-9_-]{16,}/gu, "[SECRET_REDACTED]");
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitize(item)]),
    );
  return value ?? null;
}
function json(value: unknown): string {
  return JSON.stringify(sanitize(value), null, 2);
}
function cell(value: unknown): string {
  const raw =
    typeof value === "string"
      ? value
      : value == null
        ? "UNKNOWN / NOT_APPLICABLE"
        : JSON.stringify(sanitize(value));
  return String(sanitize(raw)).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}
function block(value: unknown): string {
  return typeof value === "string"
    ? value
    : `\`\`\`json\n${json(value)}\n\`\`\``;
}
function table(headers: string[], rows: unknown[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}
function profileTable(profiles: Profile[]) {
  return table(
    [
      "Profile",
      "requested/applied",
      "correct/wrong/neutral",
      "precision",
      "harm",
      "fixed changed/mapped",
      "joint norm gain",
      "norm CER",
      "material",
      "negative/unknown active folds",
    ],
    profiles.map((p) => {
      const m = p.appliedMetrics,
        f = p.fixed.summary;
      return [
        p.profileId,
        `${p.requestedSelectionCount}/${p.appliedSelectionCount}`,
        `${m.correctSwitchCount}/${m.wrongSwitchCount}/${m.neutralSwitchCount}`,
        m.precision,
        m.harmRate,
        `${f.changedCueGroups}/${f.fixedMappedChangedGroupCount}`,
        f.normalizedGain,
        p.quality.shadowMetrics.normalizedCer,
        p.quality.shadowMetrics.materialErrors,
        `${p.foldJointGains.filter((fold) => fold.selectedCount > 0 && fold.normalizedGain !== null && fold.normalizedGain < 0).length}/${p.foldJointGains.filter((fold) => fold.selectedCount > 0 && fold.normalizedGain === null).length}`,
      ];
    }),
  );
}
function oracleCapture(
  data: RunData,
  profile: Profile | null,
  kind: "proposalOracle" | "bestExistingCandidateOracle",
) {
  if (!profile) return null;
  const exact = data.oracle.groups.filter(
    (group) => group[kind].status === "EXACT",
  );
  const denominator = exact.reduce(
    (sum, group) => sum + (group[kind].normalizedGain ?? 0),
    0,
  );
  const selectedGroups = profile.fixed.groups.filter((group) =>
    exact.some((entry) => entry.groupId === group.groupId),
  );
  const numerator = selectedGroups.reduce(
    (sum, group) => sum + (group.normalizedGain ?? 0),
    0,
  );
  return {
    numeratorUniqueGroupGain: numerator,
    denominatorExactOracleGain: denominator,
    rate: fraction(numerator, denominator),
    groupCount: exact.length,
    denominatorAuthority: "SAME_EXACT_ORACLE_FIXED_GROUPS_ONLY",
  };
}
function selectedProviders(data: RunData, profile: Profile | null) {
  if (!profile) return null;
  return histogram(
    data.oof.decisions
      .filter(
        (decision) =>
          decision.profileId === profile.profileId &&
          decision.decision === "SELECT_EXISTING_CANDIDATE" &&
          !profile.blockedRequestedEventIds.includes(decision.eventId),
      )
      .map(
        (decision) =>
          data.risks.rows.find(
            (risk) =>
              risk.eventId === decision.eventId &&
              risk.candidateId === decision.proposedCandidateId,
          )?.providerFamily,
      ),
  );
}
function regressionRows(regression: unknown): JsonRecord[] {
  return Array.isArray(record(regression).checks)
    ? (record(regression).checks as unknown[]).map((value) => {
        const row = record(value);
        return { ...row, ...record(row.tests), name: row.name ?? row.stage };
      })
    : [];
}
function regressionsMatching(regression: unknown, pattern: RegExp) {
  const rows = regressionRows(regression).filter((row) =>
    pattern.test(typeof row.name === "string" ? row.name : ""),
  );
  return rows.length
    ? rows.map(
        ({
          name,
          exitCode,
          passed,
          skipped,
          failed,
          durationMs,
          logSha256,
        }) => ({
          name,
          exitCode,
          passed,
          skipped,
          failed,
          durationMs,
          logSha256,
        }),
      )
    : UNKNOWN;
}

interface ReportContext {
  a: RunData;
  b: RunData;
  validation: z.infer<typeof schemas.c611ValidationSchema> | null;
  regression: unknown;
  gitReceipt: JsonRecord | null;
  paths: {
    a: string;
    b: string;
    validation: string;
    regression: string;
    output: string;
  };
}
/** Metrics only: neither this function nor the reader accepts a raw Gold path. */
export function buildC611AcceptanceReport(input: ReportContext): string {
  const d = input.a,
    profiles = [...d.profiles.profiles].sort((a, b) =>
      a.profileId.localeCompare(b.profileId),
    );
  if (profiles.map((p) => p.profileId).join(",") !== "S0,S1,S2,S3,S4,S5,S6,S7")
    throw new Error("C611_REPORT_PROFILE_SET_INVALID");
  for (const run of [input.a, input.b]) {
    const bindings = [
      [run.freeze.baselineHash, run.baseline.semanticHash],
      [run.freeze.proposalHash, run.proposals.semanticHash],
      [run.freeze.featureTableHash, run.features.semanticHash],
      [run.freeze.foldHash, run.folds.semanticHash],
      [run.freeze.policyHash, run.policy.semanticHash],
      [run.map.machineFreezeHash, run.freeze.semanticHash],
      [run.labels.fixedMapHash, run.map.semanticHash],
      [run.labels.proposalSetHash, run.proposals.semanticHash],
      [run.profiles.fixedMapHash, run.map.semanticHash],
      [run.profiles.machineFreezeHash, run.freeze.semanticHash],
      [run.profiles.oofHash, run.oof.semanticHash],
      [run.oracle.fixedMapHash, run.map.semanticHash],
    ];
    if (bindings.some(([observed, expected]) => observed !== expected))
      throw new Error("C611_REPORT_CROSS_ARTIFACT_BINDING_MISMATCH");
  }
  const p0 = required(profiles.find((profile) => profile.profileId === "S0"));
  const p1 = required(profiles.find((profile) => profile.profileId === "S1"));
  const chosenId = d.route?.selectedProfile ?? d.oof.bestActiveProfile;
  const best =
    profiles.find((profile) => profile.profileId === chosenId) ?? null;
  const active =
    best?.appliedMetrics.modelClass === "ACTIVE_SELECTIVE_MODEL" ? best : null;
  const main = active?.appliedMetrics,
    quality = active?.quality.shadowMetrics;
  const fixed = active?.fixed.summary;
  const validation = input.validation;
  const qa = regressionRows(input.regression);
  const qaPassed =
    qa.length > 0 &&
    qa.every((row) => row.exitCode === 0 && (row.failed ?? 0) === 0);
  const comparable = (run: RunData) =>
    run.identities.filter(
      (identity) => identity.name !== "c6-1-1-shareable-summary",
    );
  const parity = comparable(d).map((identity) => {
    const other = input.b.identities.find(
      (item) => item.name === identity.name,
    );
    return {
      artifact: identity.name,
      semanticParity: identity.semanticHash === other?.semanticHash,
      byteParity: identity.sha256 === other?.sha256,
      semanticHash: identity.semanticHash,
      sha256: identity.sha256,
    };
  });
  const abReadArtifactsPassed =
    parity.every((row) => row.semanticParity && row.byteParity) &&
    comparable(d).length === comparable(input.b).length;
  const sourceReadOnly = d.proof
    ? d.proof.sourceUnchanged &&
      hash(d.proof.sourceBefore) === hash(d.proof.sourceAfter)
    : null;
  const goldReadOnly = d.proof
    ? d.proof.goldUnchanged &&
      hash(d.proof.goldBefore) === hash(d.proof.goldAfter)
    : null;
  const timingParity = profiles.every(
    (profile) =>
      profile.canonicalTimingHash === d.baseline.canonicalTimingHash &&
      profile.fixed.invariance.timingParity,
  );
  const engineeringConfirmed =
    validation?.engineeringPassed === true &&
    validation.checks.every((check) => check.passed) &&
    validation.aBMachineParity &&
    validation.aBEvaluationParity &&
    validation.aBOutputParity &&
    d.route?.engineeringPassed === true &&
    sourceReadOnly === true &&
    goldReadOnly === true &&
    d.proof?.productionUnchanged === true &&
    timingParity &&
    qaPassed &&
    abReadArtifactsPassed;
  const counts = d.baseline.candidateCounts,
    map = d.map.summary;
  const proposed = d.proposals.records.filter(
    (proposal) => proposal.proposedCandidateId !== null,
  );
  const eligible = d.proposals.records.filter(
    (proposal) => proposal.eligibilityStatus === "ELIGIBLE",
  );
  const labelsById = new Map(
    d.labels.labels.map((label) => [label.proposalId, label]),
  );
  const providerCounts = histogram(
    eligible.map((proposal) => proposal.proposedProvider),
  );
  const roleCounts = histogram(
    eligible.map((proposal) => proposal.proposedRole),
  );
  const riskCount = (name: string) =>
    d.completeness.rows.filter((row) =>
      row.riskClasses.some((risk) => risk === name),
    ).length;
  const forOutcome = (outcome: string) =>
    d.completeness.rows.filter(
      (row) => labelsById.get(row.proposalId)?.outcome === outcome,
    );
  const improvedLengths = stats(
    forOutcome("SWITCH_IMPROVES").map((row) => row.characterLengthRatio),
  );
  const regressedLengths = stats(
    forOutcome("SWITCH_REGRESSES").map((row) => row.characterLengthRatio),
  );
  const providerOutcomes = ["WHISPER", "REAZON"].map((provider) => {
    const subset = eligible.filter(
      (proposal) => proposal.proposedProvider === provider,
    );
    return {
      provider,
      proposals: subset.length,
      outcomes: histogram(
        subset.map((proposal) => labelsById.get(proposal.proposalId)?.outcome),
      ),
    };
  });
  const strongContraction = d.completeness.rows.filter((row) =>
    row.riskClasses.includes("STRONG_CONTRACTION_RISK"),
  );
  const contractionOutcomes = histogram(
    strongContraction.map((row) => labelsById.get(row.proposalId)?.outcome),
  );
  const ctcCases = d.features.rows.map((feature) => ({
    direction: feature.values.ctcDirection,
    label: labelsById.get(feature.proposalId)?.outcome,
  }));
  const ctcCount = (direction: 1 | -1, outcome: string) =>
    ctcCases.filter(
      (row) =>
        row.direction !== null &&
        Math.sign(row.direction) === direction &&
        row.label === outcome,
    ).length;
  const ctc = {
    knownDirections: ctcCases.filter((row) => row.direction !== null).length,
    unknownDirections: ctcCases.filter((row) => row.direction === null).length,
    usefulSupport: ctcCount(1, "SWITCH_IMPROVES"),
    harmfulSupport: ctcCount(1, "SWITCH_REGRESSES"),
    usefulVeto: ctcCount(-1, "SWITCH_REGRESSES"),
    harmfulVeto: ctcCount(-1, "SWITCH_IMPROVES"),
    interpretation: "DIRECTION_VS_COUNTERFACTUAL_ASSOCIATION_NOT_CAUSAL_PROOF",
  };
  const proposalCapture = oracleCapture(d, active, "proposalOracle"),
    candidateCapture = oracleCapture(d, active, "bestExistingCandidateOracle");
  const commonOracleGroups = d.oracle.groups.filter(
    (group) =>
      group.proposalOracle.status === "EXACT" &&
      group.bestExistingCandidateOracle.status === "EXACT",
  );
  const commonProposalGain = commonOracleGroups.reduce(
    (sum, group) => sum + (group.proposalOracle.normalizedGain ?? 0),
    0,
  );
  const commonCandidateGain = commonOracleGroups.reduce(
    (sum, group) =>
      sum + (group.bestExistingCandidateOracle.normalizedGain ?? 0),
    0,
  );
  const proposalCeiling = {
    commonExactGroups: commonOracleGroups.length,
    proposalGain: commonProposalGain,
    candidateGain: commonCandidateGain,
    missedCandidateGain: commonCandidateGain - commonProposalGain,
    ratio: fraction(commonProposalGain, commonCandidateGain),
  };
  const selectedProviderCounts = selectedProviders(d, active),
    legacyProviderCounts = selectedProviders(d, p1);
  const negativeFolds = active?.foldJointGains.filter(
    (fold) =>
      fold.selectedCount > 0 &&
      fold.normalizedGain !== null &&
      fold.normalizedGain < 0,
  ).length;
  const activeFolds = active?.foldJointGains.filter(
    (fold) => fold.selectedCount > 0,
  ).length;
  const totalGroupCoverage = fraction(
    map.stableMappedGroups,
    map.totalCueGroups,
  );
  const gateProfile = d.route?.profiles.find(
    (profile) => profile.profileId === active?.profileId,
  );
  const diagnosticCases =
    d.attribution?.cases.filter(
      (item) => item.profileId === active?.profileId,
    ) ?? [];
  const errors = histogram(
    diagnosticCases.flatMap((item) => item.diagnosticErrorTypes),
  );
  const generatorErrors = d.labels.labels.filter(
    (label) => label.outcome === "SWITCH_REGRESSES",
  ).length;
  const gateErrors = main?.wrongSwitchCount;
  const allProfiles = profileTable(profiles);
  const legacyComparison = {
    oldUnit: "EVENT",
    old: d.baseline.legacyEventEvaluation,
    newUnit: "UNIQUE_FIXED_CUE_GROUP",
    newS1: p1.fixed.summary,
    warning: "EVENT与CUE_GROUP的分母不同，不能把计数差直接当作新增错误数。",
  };
  const foldTable = table(
    [
      "Fold",
      "Profile",
      "actual selected",
      "evaluable selected",
      "joint normalized gain",
    ],
    profiles.flatMap((profile) =>
      profile.foldJointGains.map((fold) => [
        fold.foldId,
        profile.profileId,
        fold.selectedCount,
        fold.evaluableSelectedCount,
        fold.normalizedGain,
      ]),
    ),
  );
  const readonly = {
    source: sourceReadOnly,
    gold: goldReadOnly,
    production: d.proof?.productionUnchanged ?? null,
    runtimeCode: d.proof?.runtimeCodeUnchanged ?? null,
    validatorRawSourceRechecked:
      validation?.validatorRawSourceRechecked ?? false,
    validatorRawGoldRechecked: validation?.validatorRawGoldRechecked ?? false,
    authority:
      "模型运行后记录的前后fingerprint与严格只读证明；报告不重新打开原音视频/Gold。",
  };
  const outputPaths = {
    finalA: path.basename(input.paths.a),
    finalB: path.basename(input.paths.b),
    machine: "<final-A-or-B>/machine/",
    evaluation: "<final-A-or-B>/evaluation/",
    shadow: "<final-A-or-B>/shadow/s0–s7/",
    validation: path.basename(input.paths.validation),
    regression: path.basename(input.paths.regression),
    report: `docs/${REPORT_NAME}`,
  };
  const git = input.gitReceipt ?? {};
  const commits = record(git.commits);
  const commit = (key: string) =>
    commits[key] ??
    "UNKNOWN：未提供对应Git交付回执；验收文档不自包含自身未来SHA。";
  const next = d.route?.nextRoute ?? UNKNOWN;
  const conclusion = `${engineeringConfirmed ? "工程验收证据通过" : "工程验收尚未获得完整通过证据"}；质量路由：${d.route?.outcome ?? "UNKNOWN"}。\n\n${active ? `报告中的 Active Profile 为 ${active.profileId}，来自已记录的 route/OOF 选择，不在报告阶段再次优化。` : NOT_APPLICABLE}\n\nC6.1.1 仅为已知开发基准的校准可行性研究，不是未见集验证。生产仍为 needs-review / finalizationMethod=none，machineOnlyReleaseAuthorized=false，C6.0.2 HOLD。`;
  const sections = new Map<number, unknown>();
  const set = (number: number, value: unknown) =>
    sections.set(number, value ?? UNKNOWN);
  set(1, conclusion);
  set(
    2,
    git.branch ??
      "codex/c6-1-1-fixed-alignment-selective-existing-mbr（请求分支；最终HEAD见Git回执）",
  );
  set(3, {
    acceptanceCommit: d.baseline.acceptanceCommit,
    baselineBranch: d.baseline.baselineBranch,
    baselineHash: d.baseline.semanticHash,
    baselineMetrics: d.baseline.baselineMetrics,
  });
  set(4, {
    passed: d.baseline.baselineReplayPassed,
    candidateCounts: counts,
    pairwiseCount: d.baseline.pairwiseCount,
    checks: d.baseline.checks,
  });
  set(
    5,
    "主产品继续 C6.0.1.12 Review Assistance；本次只生成既有候选的研究影子，不授予自动发布权限。",
  );
  set(
    6,
    "Gold前冻结机器候选、风险、特征、fold与policy；Gold仅进入固定配对评价和训练折校准。报告不访问原始Gold。",
  );
  set(
    7,
    "在固定组覆盖率充足的前提下，检验少量可解释既有候选切换是否获得正联合收益、低错误率且不降低全片质量。",
  );
  set(
    8,
    "不生成Novel token/span文本，不修改生产文本/时间，不新增ASR/CTC/pyannote，不进行未见集成功或C6.0.2发布声明。",
  );
  set(9, {
    existingCandidateOnly: d.policy.existingCandidateOnly,
    novelApplicationAllowed: d.policy.novelApplicationAllowed,
    currentIsProviderVote: d.policy.currentIsProviderVote,
    basis: "C6.1没有证明Novel路径改善，C6.1.1只校准整候选切换。",
  });
  set(10, {
    evaluableEvents: d.baseline.legacyEventEvaluation.evaluable,
    totalEvents: counts.canonicalEventCount,
    ratio: fraction(
      d.baseline.legacyEventEvaluation.evaluable,
      counts.canonicalEventCount ?? 0,
    ),
    unit: "EVENT",
  });
  set(11, d.map.mappingPolicy);
  set(12, {
    fixedMapHash: d.map.semanticHash,
    mappingSemanticHash: d.map.mappingSemanticHash,
    mappingPolicyHash: d.map.mappingPolicyHash,
    baselineCueHash: d.map.baselineCueHash,
    baselineTimingHash: d.map.baselineTimingHash,
  });
  set(13, map);
  set(
    14,
    profiles.map((p) => ({
      profile: p.profileId,
      changedGroups: p.fixed.summary.changedCueGroups,
    })),
  );
  set(
    15,
    profiles.map((p) => ({
      profile: p.profileId,
      fixedMappedChangedGroups: p.fixed.summary.fixedMappedChangedGroupCount,
    })),
  );
  set(16, {
    count: map.ambiguousGroups,
    groups: d.map.groups
      .filter((group) => group.mappingStatus === "AMBIGUOUS_BASELINE_MAPPING")
      .map((group) => ({
        groupId: group.groupId,
        reasons: group.ambiguityReasons,
      })),
  });
  set(17, {
    groups: map.unmappedGroups,
    unmappedGoldCueCount: map.unmappedGoldCueCount,
  });
  set(18, map.structureIncompatibleGroups);
  set(19, {
    totalFixedGroupCoverage: totalGroupCoverage,
    profiles: profiles.map((p) => ({
      profile: p.profileId,
      changedGroupCoverage: p.fixed.summary.changedGroupCoverage,
    })),
    warning:
      "总固定组覆盖率与Changed Group覆盖率分开报告；零changed分母为null。",
  });
  set(20, legacyComparison);
  set(21, { candidateUniverseHash: d.baseline.candidateUniverseHash, counts });
  set(22, histogram(d.proposals.records.map((p) => p.eligibilityStatus)));
  set(23, {
    primaryVariant: d.proposals.primaryVariant,
    policyHash: d.proposals.proposalPolicyHash,
    proposalHash: d.proposals.semanticHash,
    runtimeGoldInputCount: d.proposals.runtimeGoldInputCount,
    generator: "每event至多一项预先冻结H2 proposal；Gold不选择替代候选。",
  });
  set(24, { proposed: proposed.length, eligible: eligible.length });
  set(25, providerCounts);
  set(26, roleCounts);
  set(27, stats(d.risks.rows.map((row) => row.legacyRisk)));
  set(28, stats(d.risks.rows.map((row) => row.providerBalancedRisk)));
  set(29, stats(d.risks.rows.map((row) => row.hierarchicalRisk)));
  set(30, d.correlation);
  set(31, {
    legacyAsr: d.correlation.legacy.totalGroups,
    legacyIncludingCurrent: d.correlation.legacyAllIncludedGroupCount,
    hierarchical: d.correlation.hierarchical.totalGroups,
  });
  set(32, {
    legacyAsr: d.correlation.legacy.singletonGroups,
    legacyIncludingCurrent: d.correlation.legacyAllIncludedSingletonCount,
    hierarchical: d.correlation.hierarchical.singletonGroups,
  });
  set(33, {
    legacyAsr: d.correlation.legacy.singletonRate,
    legacyIncludingCurrent: d.correlation.legacyAllIncludedSingletonRate,
    hierarchical: d.correlation.hierarchical.singletonRate,
  });
  set(34, {
    reconciled: d.correlation.reconciledSameCoreSplitGroupCount,
    sameAudioDifferentRequest:
      d.correlation.legacy.sameAudioDifferentRequestGroups,
    unknownCoreIdentity: d.correlation.unknownCoreIdentityCount,
  });
  set(35, {
    correlationPolicyHash: d.correlationGroups.correlationPolicyHash,
    currentIndependentVoteCount:
      d.correlationGroups.currentIndependentVoteCount,
    rules:
      "provider→model/core→observation层级；未知core/decode/prompt保留unknown，不能伪造独立性。",
  });
  set(36, {
    policyHash: d.policy.machinePolicyHash,
    productionMutationAllowed: d.policy.productionMutationAllowed,
    rules:
      "KEEP_CURRENT是保留基线，不是第三个ASR provider票；结构/来源不能证明安全时保留或review。",
  });
  for (const [number, field] of [
    [37, "rawMbrMargin"],
    [38, "hierarchicalMbrMargin"],
    [39, "runnerUpMargin"],
  ] as const)
    set(number, {
      ...stats(d.proposals.records.map((p) => p[field])),
      positiveCount: d.proposals.records.filter((p) => (p[field] ?? 0) > 0)
        .length,
      interpretation: "MBR风险差，不是识别置信度。",
    });
  set(40, stats(d.completeness.rows.map((row) => row.characterLengthRatio)));
  set(41, histogram(d.completeness.rows.flatMap((row) => row.riskClasses)));
  set(
    42,
    histogram(d.completeness.rows.map((row) => row.speechCompletenessStatus)),
  );
  set(43, stats(d.completeness.rows.map((row) => row.requestEdgeRisk)));
  set(44, stats(d.completeness.rows.map((row) => row.hallucinationRisk)));
  set(45, ctc);
  set(46, {
    rows: d.features.rows.length,
    featureHash: d.features.semanticHash,
    names: d.features.featureNames,
  });
  set(47, d.features.featureNames.length);
  set(48, {
    rawTextFeatureCount: d.features.rawTextFeatureCount,
    goldFeatureCount: d.features.goldFeatureCount,
    datasetSpecificFeatureCount: d.features.datasetSpecificFeatureCount,
    runtimeGoldInputCount: d.features.runtimeGoldInputCount,
  });
  set(49, {
    frozenAt: d.freeze.frozenAt,
    featureSchemaHash: d.freeze.featureSchemaHash,
    featureTableHash: d.freeze.featureTableHash,
    sourceCodeAggregateHash: d.freeze.sourceCodeAggregateHash,
    runtimeNodeVersion: d.freeze.runtimeNodeVersion,
    sharedSourceEntry: d.freeze.sharedSourceEntry,
    runtimeSourceExecutionVerified: d.freeze.runtimeSourceExecutionVerified,
    machineAggregateHash: d.freeze.machineAggregateHash,
    freezeHash: d.freeze.semanticHash,
  });
  set(50, {
    machineFrozenAt: d.map.machineFrozenAt,
    goldFirstReadAt: d.map.goldFirstReadAt,
    ordered:
      Date.parse(d.map.goldFirstReadAt) >= Date.parse(d.map.machineFrozenAt),
    machineArtifactsFrozenBeforeGold: d.map.machineArtifactsFrozenBeforeGold,
  });
  [
    d.labels.summary.improved,
    d.labels.summary.regressed,
    d.labels.summary.neutral,
    d.labels.summary.unevaluable,
  ].forEach((value, index) => set(51 + index, value));
  set(55, d.oracle.summary.proposalOracle);
  set(56, d.oracle.summary.bestExistingCandidateOracle);
  set(57, proposalCeiling);
  set(58, {
    construction: d.calibrationPolicy.foldConstruction,
    adaptation: d.calibrationPolicy.foldAdaptation,
    groups: d.folds.groups.length,
    requestedFoldCount: d.folds.requestedFoldCount,
    foldCount: d.folds.foldCount,
    folds: d.folds.folds.map((fold) => ({
      foldId: fold.foldId,
      groups: fold.groupIds.length,
      events: fold.eventIds.length,
    })),
  });
  set(59, {
    hash: d.folds.semanticHash,
    frozenBeforeLabels: d.folds.frozenBeforeLabels,
    status: d.folds.status,
  });
  set(60, {
    audio: d.folds.audioLeakageCount,
    event: d.folds.eventLeakageCount,
    cue: d.folds.cueLeakageCount,
    fixedGroupCrossFoldCount: d.labels.summary.fixedGroupCrossFoldCount,
    trainTestIntersections: d.oof.calibrationAudits.reduce(
      (sum, audit) => sum + audit.trainTestIntersectionCount,
      0,
    ),
    testLabelInputToPredictionCount: d.oof.testLabelInputToPredictionCount,
    fullDataPredictionCount: d.oof.fullDataPredictionCount,
  });
  profiles.forEach((profile, index) =>
    set(61 + index, {
      requested: profile.requestedMetrics,
      actualApplied: profile.appliedMetrics,
      fixed: profile.fixed.summary,
      blockedRequestedEventIds: profile.blockedRequestedEventIds,
      authority:
        "precision按proposal案例；editgain只取fixed唯一组，不相加counterfactual收益。",
    }),
  );
  set(69, {
    recordedOofBestActiveProfile: d.oof.bestActiveProfile,
    routeSelectedProfile: d.route?.selectedProfile ?? null,
    reportActiveProfile: active?.profileId ?? null,
    routeConfirmedStrong: gateProfile?.strongPassed ?? null,
  });
  set(70, {
    profile: "S0",
    applied: p0.appliedMetrics.selectedCount,
    fixedGain: p0.fixed.summary.normalizedGain,
    classification: p0.appliedMetrics.modelClass,
    statement: "零选择/零错误只证明null基线，不是active成功。",
  });
  [
    main?.selectedCount,
    main?.correctSwitchCount,
    main?.wrongSwitchCount,
    main?.neutralSwitchCount,
    main?.abstainCount,
    main?.precision,
    main?.wilson,
    main?.harmRate,
    main?.selectiveCoverage,
    fixed?.exactGain,
    fixed?.normalizedGain,
    proposalCapture,
    candidateCapture,
  ].forEach((value, index) => set(71 + index, value ?? NOT_APPLICABLE));
  for (let i = 0; i < 5; i += 1) {
    const fold = d.folds.folds[i];
    set(
      84 + i,
      fold
        ? profiles.map((p) => ({
            profile: p.profileId,
            ...p.foldJointGains.find((f) => f.foldId === fold.foldId),
          }))
        : "NOT_APPLICABLE：冻结策略实际独立fold数不足5；不虚构额外fold。",
    );
  }
  set(89, negativeFolds ?? NOT_APPLICABLE);
  set(90, activeFolds ?? NOT_APPLICABLE);
  const qualityKeys = [
    "cueCount",
    "exactCer",
    "normalizedCer",
    "coverage",
    "missing",
    "hallucination",
    "materialErrors",
    "severeTiming",
    "startMae",
    "endMae",
    "boundaryP95",
    "medianIoU",
    "overlap",
  ] as const;
  qualityKeys.forEach((key, index) =>
    set(91 + index, {
      metric: key,
      selectedActive: quality?.[key] ?? null,
      profiles: profiles.map((p) => ({
        profile: p.profileId,
        value: p.quality.shadowMetrics[key],
        ...(key === "overlap"
          ? { allPairOverlap: p.quality.shadowAllPairOverlapCount }
          : {}),
      })),
      authority:
        index >= 7
          ? "旧全片匹配诊断；canonical timing完全不变，因此不是声学时间修复。"
          : "旧全片质量比较，仅作配套guard；fixed唯一组收益是主评价。",
    }),
  );
  set(104, { active: selectedProviderCounts, legacyS1: legacyProviderCounts });
  set(
    105,
    providerOutcomes.find((p) => p.provider === "WHISPER")?.outcomes
      .SWITCH_IMPROVES ?? 0,
  );
  set(
    106,
    providerOutcomes.find((p) => p.provider === "WHISPER")?.outcomes
      .SWITCH_REGRESSES ?? 0,
  );
  set(
    107,
    providerOutcomes.find((p) => p.provider === "REAZON")?.outcomes
      .SWITCH_IMPROVES ?? 0,
  );
  set(
    108,
    providerOutcomes.find((p) => p.provider === "REAZON")?.outcomes
      .SWITCH_REGRESSES ?? 0,
  );
  set(109, {
    improved: improvedLengths,
    regressed: regressedLengths,
    allProposals: stats(d.completeness.rows.map((r) => r.characterLengthRatio)),
    interpretation:
      "proposal层描述性相关；更短可能删幻觉，也可能删真对白，不据长度单独判好坏。",
  });
  set(110, improvedLengths);
  set(111, regressedLengths);
  set(112, strongContraction.length);
  set(113, contractionOutcomes.SWITCH_IMPROVES ?? 0);
  set(114, contractionOutcomes.SWITCH_REGRESSES ?? 0);
  set(115, main?.catastrophicDeletionRegressionCount ?? NOT_APPLICABLE);
  set(116, {
    useful: ctc.usefulSupport,
    harmful: ctc.harmfulSupport,
    interpretation: ctc.interpretation,
  });
  set(117, {
    useful: ctc.usefulVeto,
    harmful: ctc.harmfulVeto,
    interpretation: ctc.interpretation,
  });
  set(118, {
    correlationAudit: d.correlation.semanticHash,
    reconciledSameCoreSplitGroupCount:
      d.correlation.reconciledSameCoreSplitGroupCount,
    diagnosticCandidateAgreement: histogram(
      d.proposals.records.flatMap((p) =>
        p.diagnosticProposals.map(
          (v) =>
            `${v.variant}:${v.candidateId === p.proposedCandidateId ? "SAME_AS_H2" : "DIFFERENT_FROM_H2"}`,
        ),
      ),
    ),
    causalUtility:
      "UNKNOWN：没有将同候选、同Gate仅替换correlation一项的独立Gold对照，不能把总差异归因于单因素。",
  });
  set(119, {
    profiles: profiles
      .filter((p) => ["S1", "S2", "S3"].includes(p.profileId))
      .map((p) => ({
        profile: p.profileId,
        actualSelected: p.appliedMetrics.selectedCount,
        wrong: p.appliedMetrics.wrongSwitchCount,
        fixedGain: p.fixed.summary.normalizedGain,
      })),
    oracleCeiling: proposalCeiling,
    causalClaim: false,
  });
  set(120, {
    regressingFrozenProposals: generatorErrors,
    unit: "PROPOSAL_COUNTERFACTUAL",
    notUniqueCausalCount: true,
  });
  set(121, gateErrors ?? NOT_APPLICABLE);
  set(122, {
    providerOutcomes,
    causalProviderWeightErrorCount:
      "UNKNOWN：来源分布和回退相关不能证明provider权重是唯一原因。",
  });
  set(
    123,
    errors.WRONG_SWITCH_WITH_CONTRACTION ?? (d.attribution ? 0 : UNKNOWN),
  );
  set(
    124,
    d.attribution
      ? histogram(
          diagnosticCases.flatMap((item) =>
            item.diagnosticErrorTypes.filter((name) =>
              /EDGE|INCOMPLETE|DELETION/u.test(name),
            ),
          ),
        )
      : UNKNOWN,
  );
  set(125, {
    unavailableLabels: d.labels.summary.unevaluable,
    attributionAvailable: d.attribution !== null,
    limitations: d.attribution?.limitations ?? [UNKNOWN],
  });
  set(
    126,
    d.suggestions
      ? {
          artifact: d.suggestions.artifactType,
          semanticHash: d.suggestions.semanticHash,
          rowCount: d.suggestions.rows.length,
          profile: d.suggestions.profileId,
          usage: d.suggestions.usage,
          humanApprovalRequired: d.suggestions.humanApprovalRequired,
          scoreAuthority: d.suggestions.scoreAuthority,
        }
      : UNKNOWN,
  );
  set(127, {
    regression: regressionsMatching(input.regression, /targeted/u),
    requirement:
      "C6.0.1.12 Review build/serve/session/correction/human apply仍属独立回归；未逐子项记录时不能单靠targeted总数宣称每项覆盖。",
  });
  set(128, d.proposals.novelApplicationCount);
  set(129, {
    expected: 0,
    observed: d.proposals.novelApplicationCount,
    contract: "STRICT_SCHEMA_REQUIRES_ZERO_NOVEL_APPLICATIONS",
  });
  set(130, validation?.productionTextMutation ?? UNKNOWN);
  set(131, {
    productionTimingMutation: validation?.productionTimingMutation ?? null,
    allShadowTimingParity: timingParity,
    canonicalTimingHash: d.baseline.canonicalTimingHash,
  });
  for (const [number, extension] of [
    [132, ".ass"],
    [133, ".srt"],
    [134, ".vtt"],
  ] as const)
    set(number, {
      productionUnchanged: d.proof?.productionUnchanged ?? null,
      files: d.baseline.productionFiles
        .filter((file) => file.relativePath.endsWith(extension))
        .map(({ relativePath, sha256, size }) => ({
          relativePath,
          sha256,
          size,
        })),
    });
  for (const [number, extension] of [
    [135, ".ass"],
    [136, ".srt"],
    [137, ".vtt"],
  ] as const)
    set(
      number,
      d.manifest.profiles.map((p) => ({
        profile: p.profileId,
        files: p.files.filter((file) => file.relativePath.endsWith(extension)),
        role: "RESEARCH_SHADOW_ONLY",
      })),
    );
  set(138, {
    readArtifacts: parity,
    allReadArtifactSemanticAndByteParity: abReadArtifactsPassed,
    validatorMachine: validation?.aBMachineParity ?? null,
    validatorEvaluation: validation?.aBEvaluationParity ?? null,
    validatorOutput: validation?.aBOutputParity ?? null,
  });
  set(
    139,
    d.route?.profiles.map((p) => ({
      profile: p.profileId,
      coverage: p.fixedChangedGroupCoverage,
      strong: p.strongPassed,
      promising: p.promisingPassed,
    })) ?? UNKNOWN,
  );
  set(140, {
    strongProfiles: d.route?.strongProfiles ?? [],
    activeProfile: gateProfile ?? null,
    gate: d.policy.strongGate,
  });
  set(141, {
    promisingProfiles: d.route?.promisingProfiles ?? [],
    gate: d.policy.promisingGate,
  });
  set(142, d.route ?? UNKNOWN);
  set(
    143,
    d.future
      ? {
          status: d.future.status,
          created: d.future.frozenModelCreated,
          profileId: d.future.profileId,
          modelHash: d.future.modelHash,
          threshold: d.future.threshold,
          reason: d.future.reason,
          restriction: d.future.useRestriction,
          noOofMetricsRewritten: d.future.noOofMetricsRewritten,
        }
      : UNKNOWN,
  );
  set(144, next);
  set(145, "HOLD；无论研究工程验收或校准结果如何，C6.0.2未授权。");
  set(146, {
    productionStatus: d.baseline.productionStatus,
    finalizationMethod: d.baseline.finalizationMethod,
  });
  set(147, d.baseline.machineOnlyReleaseAuthorized);
  set(148, {
    machine: d.freeze.runtimeGoldInputCount,
    proposal: d.proposals.runtimeGoldInputCount,
    feature: d.features.runtimeGoldInputCount,
    postFreezeEvaluation: "Gold仅在固定评价/训练折校准可见，不是机器推理输入。",
  });
  set(149, {
    rawTextFeatureCount: d.features.rawTextFeatureCount,
    datasetSpecificFeatureCount: d.features.datasetSpecificFeatureCount,
    validatorChecks:
      validation?.checks.filter((check) =>
        /hardcod|Gold|gold|source-code/u.test(check.name),
      ) ?? [],
    limitation:
      "编译/运行扫描证据与字段计数分开；没有扫描记录不宣称仓库级零硬编码。",
  });
  set(150, {
    machineNetworkUsed: d.freeze.networkUsed,
    acceptanceProofNetworkUsed: d.proof?.networkUsed ?? null,
    freshAsrInferences: d.freeze.newAsrInferenceCount,
  });
  set(151, {
    sourceReadOnly,
    before: d.proof?.sourceBefore ?? null,
    after: d.proof?.sourceAfter ?? null,
    reportReopenedRawSource: false,
  });
  set(152, {
    goldReadOnly,
    before: d.proof?.goldBefore ?? null,
    after: d.proof?.goldAfter ?? null,
    reportReopenedRawGold: false,
  });
  set(153, {
    validatorChecks:
      validation?.checks.filter((check) =>
        /share|privacy|secret|path|sanitize/u.test(check.name),
      ) ?? [],
    reportPolicy:
      "仅指标/ID/hash/相对产物名；不输出Gold文本、候选文本、源音视频或私有绝对路径。没有外部shareable检查时不冒称全产物扫描通过。",
  });
  set(154, regressionsMatching(input.regression, /C5[.-]?19|targeted/iu));
  set(155, regressionsMatching(input.regression, /investigation|targeted/iu));
  set(156, regressionsMatching(input.regression, /protected|targeted/iu));
  set(157, regressionsMatching(input.regression, /targeted/iu));
  set(158, regressionsMatching(input.regression, /targeted/iu));
  set(159, regressionsMatching(input.regression, /unit|test-all/iu));
  set(160, regressionsMatching(input.regression, /e2e/iu));
  set(161, regressionsMatching(input.regression, /targeted/iu));
  set(162, {
    registeredC611Schemas: schemas.c611GeneratedSchemas.length,
    generatedSchemas: validation?.generatedSchemaCount ?? null,
    validatedInstances: validation?.schemaInstanceCount ?? null,
    generation: regressionsMatching(input.regression, /generate:schemas/iu),
  });
  set(163, regressionsMatching(input.regression, /skill/iu));
  set(
    164,
    git.skill23Unchanged ??
      "UNKNOWN：需Git交付范围审查回执确认；本次设计不修改Skill2/3。",
  );
  set(165, {
    benchmark: "已知开发基准，不是unseen验证",
    groupCoverage: totalGroupCoverage,
    crossFoldGroups: d.labels.summary.fixedGroupCrossFoldCount,
    oracleIncomplete: d.oracle.groups
      .filter(
        (g) =>
          g.proposalOracle.status !== "EXACT" ||
          g.bestExistingCandidateOracle.status !== "EXACT",
      )
      .map((g) => ({
        groupId: g.groupId,
        proposal: g.proposalOracle.status,
        existing: g.bestExistingCandidateOracle.status,
      })),
    activeWrong: main?.wrongSwitchCount ?? null,
    activeNeutral: main?.neutralSwitchCount ?? null,
    missingEvidence: !d.proof || !validation || !input.regression,
    timingClaimAllowed: false,
  });
  set(166, {
    sourceCommits: commits,
    acceptanceCommit:
      "文档无法自包含其未来提交SHA；最终回复/独立Git交付回执给出。",
  });
  set(167, git.remoteHead ?? UNKNOWN);
  set(168, outputPaths);
  const finalItems = new Map<number, unknown>();
  const put = (number: number, value: unknown) =>
    finalItems.set(number, value ?? NOT_APPLICABLE);
  put(1, sections.get(2));
  put(2, d.baseline.acceptanceCommit);
  [
    "fixedAlignment",
    "hierarchical",
    "preservation",
    "calibration",
    "shadow",
    "acceptance",
  ].forEach((key, index) => put(index + 3, commit(key)));
  put(9, git.remoteHead ?? UNKNOWN);
  put(10, d.policy.policyVersion);
  put(11, d.policy.semanticHash);
  put(12, d.baseline.baselineReplayPassed);
  put(13, d.baseline.baselineMetrics.cueCount);
  put(14, counts.canonicalEventCount);
  put(15, counts.multiHypothesisEventCount);
  put(16, counts.inputCandidateCount);
  put(17, counts.realAsrCandidateCount);
  put(18, counts.includedWhisperCount);
  put(19, counts.includedReazonCount);
  put(20, d.baseline.legacyEventEvaluation.evaluable);
  put(21, map.totalCueGroups);
  put(22, {
    legacyS1: p1.fixed.summary.changedCueGroups,
    active: fixed?.changedCueGroups ?? null,
  });
  [
    map.oneToOne,
    map.oneToMany,
    map.manyToOne,
    map.manyToMany,
    map.ambiguousGroups,
    map.unmappedGroups,
    map.structureIncompatibleGroups,
  ].forEach((value, index) => put(23 + index, value));
  put(30, {
    legacyS1: p1.fixed.summary.changedGroupCoverage,
    active: fixed?.changedGroupCoverage ?? null,
  });
  put(
    31,
    gateProfile
      ? (gateProfile.fixedChangedGroupCoverage ?? 0) >=
          d.policy.strongGate.minimumFixedCoverage
      : NOT_APPLICABLE,
  );
  put(32, d.baseline.legacyEventEvaluation.changed);
  put(33, p1.fixed.summary.fixedMappedChangedGroupCount);
  [
    p1.fixed.summary.improvedGroups,
    p1.fixed.summary.regressedGroups,
    p1.fixed.summary.neutralGroups,
    p1.fixed.summary.normalizedGain,
  ].forEach((value, index) => put(34 + index, value));
  put(38, sections.get(31));
  put(39, sections.get(32));
  put(40, sections.get(33));
  put(41, d.correlation.hierarchical.totalGroups);
  put(42, d.correlation.hierarchical.singletonGroups);
  put(43, d.correlation.reconciledSameCoreSplitGroupCount);
  put(44, {
    hashVerified: true,
    includedAsrAccounted:
      d.correlation.includedAsrCandidateCount === counts.realAsrCandidateCount,
    unknownCoreIdentity: d.correlation.unknownCoreIdentityCount,
  });
  put(45, eligible.length);
  put(46, proposed.length);
  put(47, providerCounts.WHISPER ?? 0);
  put(48, providerCounts.REAZON ?? 0);
  put(
    49,
    d.proposals.records.filter(
      (p) => p.eligibilityStatus === "BLOCKED_STRUCTURAL",
    ).length,
  );
  put(50, d.proposals.records.filter((p) => (p.rawMbrMargin ?? 0) > 0).length);
  put(
    51,
    d.proposals.records.filter((p) => (p.hierarchicalMbrMargin ?? 0) > 0)
      .length,
  );
  put(52, riskCount("STRONG_CONTRACTION_RISK"));
  put(53, riskCount("EDGE_TRUNCATION_RISK"));
  put(54, riskCount("INCOMPLETE_SPEECH_RISK"));
  put(55, d.features.featureNames.length);
  put(56, d.features.rawTextFeatureCount);
  put(57, d.features.goldFeatureCount);
  put(58, d.features.datasetSpecificFeatureCount);
  put(59, Date.parse(d.freeze.frozenAt) <= Date.parse(d.map.goldFirstReadAt));
  [
    d.labels.summary.improved,
    d.labels.summary.regressed,
    d.labels.summary.neutral,
    d.labels.summary.unevaluable,
  ].forEach((value, index) => put(60 + index, value));
  put(64, d.oracle.summary.proposalOracle);
  put(65, d.oracle.summary.bestExistingCandidateOracle);
  put(66, proposalCeiling);
  put(67, d.folds.foldCount);
  put(68, d.folds.frozenBeforeLabels);
  put(69, d.folds.audioLeakageCount);
  put(70, d.folds.eventLeakageCount);
  put(71, p0.appliedMetrics.selectedCount);
  put(72, p0.fixed.summary.normalizedGain);
  for (let index = 1; index <= 7; index += 1) {
    const p = required(profiles.find((item) => item.profileId === `S${index}`));
    [
      p.appliedMetrics.selectedCount,
      p.appliedMetrics.correctSwitchCount,
      p.appliedMetrics.wrongSwitchCount,
      p.fixed.summary.normalizedGain,
    ].forEach((value, offset) => put(73 + (index - 1) * 4 + offset, value));
  }
  put(101, active?.profileId ?? NOT_APPLICABLE);
  [
    main?.selectedCount,
    main?.correctSwitchCount,
    main?.wrongSwitchCount,
    main?.neutralSwitchCount,
    main?.abstainCount,
    main?.precision,
    main?.wilson.lower,
    main?.wilson.upper,
    main?.harmRate,
    main?.selectiveCoverage,
    fixed?.exactGain,
    fixed?.normalizedGain,
    proposalCapture,
    candidateCapture,
    negativeFolds,
    main?.catastrophicDeletionRegressionCount,
  ].forEach((value, index) => put(102 + index, value));
  [
    quality?.exactCer,
    quality?.normalizedCer,
    quality?.coverage,
    quality?.missing,
    quality?.hallucination,
    quality?.materialErrors,
    quality?.severeTiming,
    quality?.startMae,
    quality?.endMae,
    quality?.boundaryP95,
    quality?.medianIoU,
  ].forEach((value, index) => put(118 + index, value));
  put(
    129,
    active
      ? {
          adjacentPairLegacyMetric: quality?.overlap,
          allOverlapPairs: active.quality.shadowAllPairOverlapCount,
          timingUnchanged: true,
        }
      : NOT_APPLICABLE,
  );
  put(130, selectedProviderCounts?.WHISPER ?? (active ? 0 : null));
  put(131, selectedProviderCounts?.REAZON ?? (active ? 0 : null));
  put(132, improvedLengths.mean);
  put(133, regressedLengths.mean);
  put(134, ctc.usefulSupport);
  put(135, ctc.harmfulSupport);
  put(136, sections.get(118));
  put(137, generatorErrors);
  put(138, gateErrors);
  put(139, d.proposals.novelApplicationCount);
  put(140, validation?.productionTextMutation);
  put(141, validation?.productionTimingMutation);
  put(142, {
    proof: d.proof?.productionUnchanged ?? null,
    assFiles: d.baseline.productionFiles.filter((f) =>
      f.relativePath.endsWith(".ass"),
    ).length,
    srtFiles: d.baseline.productionFiles.filter((f) =>
      f.relativePath.endsWith(".srt"),
    ).length,
    vttFiles: d.baseline.productionFiles.filter((f) =>
      f.relativePath.endsWith(".vtt"),
    ).length,
  });
  put(143, {
    reportReadArtifacts: abReadArtifactsPassed,
    validationMachine: validation?.aBMachineParity ?? null,
    evaluation: validation?.aBEvaluationParity ?? null,
    output: validation?.aBOutputParity ?? null,
  });
  put(144, d.route?.strongProfiles ?? UNKNOWN);
  put(145, d.route?.promisingProfiles ?? UNKNOWN);
  put(146, d.route?.outcome ?? UNKNOWN);
  put(147, next);
  put(148, "HOLD");
  put(149, {
    checks: qa.map(({ name, exitCode, passed, skipped, failed }) => ({
      name,
      exitCode,
      passed,
      skipped,
      failed,
    })),
    paths: outputPaths,
  });
  put(
    150,
    git.worktreeClean ??
      "UNKNOWN：报告生成后尚需独立提交/推送/clean-worktree验收回执。",
  );
  const response = (value: unknown) => JSON.stringify(sanitize(value));
  const q: string[] = [
    `旧口径可评价 ${d.baseline.legacyEventEvaluation.evaluable}/${counts.canonicalEventCount} Events；新固定图稳定映射 ${map.stableMappedGroups}/${map.totalCueGroups} Groups。S1 Changed Group覆盖 ${response(p1.fixed.summary.changedGroupCoverage)}；Active覆盖 ${response(fixed?.changedGroupCoverage ?? null)}。Event与Group分母不相同，不能相减。`,
    `旧38只代表具备可用event→Gold匹配的子集，不代表其余无错误。本次P0建立一次mapping ${d.map.mappingSemanticHash}，全部profile复用，profileRematchingAllowed=${d.policy.profileRematchingAllowed}。本报告不为旧38伪造未保存的细分阻塞原因。`,
    `S1复现旧P6后的固定组结果：improved=${p1.fixed.summary.improvedGroups}，regressed=${p1.fixed.summary.regressedGroups}，neutral=${p1.fixed.summary.neutralGroups}，unevaluable=${p1.fixed.summary.unevaluableGroups}，normalized joint gain=${p1.fixed.summary.normalizedGain}。`,
    `旧8/6以Event为单位；新结果以上述固定Cue Group为单位。${p1.fixed.summary.regressedGroups > 0 ? "新评价仍明确揭示局部回退，不能用较低全片CER掩盖。" : "新固定组没有观测到回退不等于未覆盖部分无风险。"} 两种计数不宜直接解释为因果意义上的低估倍数。`,
    `S1实际应用Provider分布 ${response(legacyProviderCounts)}；H2 eligible proposal分布 ${response(providerCounts)}。选择占比与各provider错误分层是偏置诊断，不等同于证明某provider天然优越。`,
    `Legacy ASR-only groups=${d.correlation.legacy.totalGroups}, singleton=${d.correlation.legacy.singletonGroups}, rate=${d.correlation.legacy.singletonRate}；包括CURRENT的旧组数=${d.correlation.legacyAllIncludedGroupCount}, singleton rate=${d.correlation.legacyAllIncludedSingletonRate}。同core重合并=${d.correlation.reconciledSameCoreSplitGroupCount}；未知core=${d.correlation.unknownCoreIdentityCount}，不能补造。`,
    `H2 Proposal Oracle ${response(d.oracle.summary.proposalOracle)}；与best-existing共同精确组差额 ${response(proposalCeiling)}。S1/S2/S3的实际切换与收益见§119。没有同Gate仅换correlation的独立对照时，孤立的hierarchical因果增益为UNKNOWN。`,
    `改善proposal长度比 ${response(improvedLengths)}；回退proposal长度比 ${response(regressedLengths)}。强收缩结果 ${response(contractionOutcomes)}。描述缩短倾向，不把更短一概判错或判好。`,
    `S1–S4实际切换/错误/联合收益：${response(profiles.filter((p) => ["S1", "S2", "S3", "S4"].includes(p.profileId)).map((p) => ({ profile: p.profileId, selected: p.appliedSelectionCount, wrong: p.appliedMetrics.wrongSwitchCount, gain: p.fixed.summary.normalizedGain })))}。样本有限且多个策略因素不同，不作统计显著性或唯一因果声明。`,
    `S4–S6 catastrophic deletion：${response(profiles.filter((p) => ["S4", "S5", "S6"].includes(p.profileId)).map((p) => ({ profile: p.profileId, catastrophic: p.appliedMetrics.catastrophicDeletionRegressionCount, wrong: p.appliedMetrics.wrongSwitchCount })))}。计数来自预冻结删除风险+评价标签；不是人工证实全部删除内容为真实对白。`,
    `冻结Alternative=${proposed.length}，eligible=${eligible.length}；Gold后验improve/regress/neutral/unevaluable=${d.labels.summary.improved}/${d.labels.summary.regressed}/${d.labels.summary.neutral}/${d.labels.summary.unevaluable}。未知保持未知。`,
    `共同精确固定组上的Proposal与Best Existing Oracle：${response(proposalCeiling)}。Active capture：proposal=${response(proposalCapture)}，candidate=${response(candidateCapture)}。余量同时区分候选生成未覆盖和Gate未捕获；组搜索未知时不宣称完整上限。`,
    active
      ? `记录的最佳Active Profile=${active.profileId}，实际应用=${active.appliedSelectionCount}，请求=${active.requestedSelectionCount}，renderer blocked=${active.blockedRequestedEventIds.length}。`
      : NOT_APPLICABLE,
    active
      ? `correct/wrong/neutral=${main?.correctSwitchCount}/${main?.wrongSwitchCount}/${main?.neutralSwitchCount}，selected unevaluable=${main?.selectedUnevaluableCount}。`
      : NOT_APPLICABLE,
    active
      ? `precision=${main?.precision}，harm=${main?.harmRate}，selective coverage=${main?.selectiveCoverage}，联合normalized gain=${fixed?.normalizedGain}，Wilson=${response(main?.wilson)}。联合收益不是单proposal反事实收益之和。`
      : NOT_APPLICABLE,
    active
      ? `Active全片 material=${quality?.materialErrors}（P0=${d.baseline.baselineMetrics.materialErrors}）；hallucination=${quality?.hallucination}, missing=${quality?.missing}, coverage=${quality?.coverage}。实际gate检查=${response(gateProfile?.strongChecks.filter((check) => /material|hallucination|missing|coverage/iu.test(check.code)) ?? [])}。`
      : NOT_APPLICABLE,
    `CTC方向与proposal后验的关联：有效支持=${ctc.usefulSupport}、有效否决=${ctc.usefulVeto}、错误支持=${ctc.harmfulSupport}、错误否决=${ctc.harmfulVeto}。已知方向=${ctc.knownDirections}, unknown=${ctc.unknownDirections}。这四项不是CTC独立因果效应；S6/S5配对变化=${response(d.attribution?.ctcUtility ?? null)}。`,
    `结果=${d.route?.outcome ?? "UNKNOWN"}；Strong profiles=${response(d.route?.strongProfiles ?? [])}；完整工程证据确认=${engineeringConfirmed}。只有路由实际给出SUPPORTED才可用该结论。`,
    `失败/不足类别以真实route ${d.route?.outcome ?? "UNKNOWN"}及reasons ${response(d.route?.reasons ?? [])}为准。Proposal剩余上限见Q12；Gate错误与覆盖见Q14/Q15。不把selected=0包装为成功。`,
    `下一步明确选择：${next}。future model created=${d.future?.frozenModelCreated ?? "UNKNOWN"}；若只有review方向，候选仅作C6.0.1.12人工辅助。即使允许prospective shadow，也不是生产发布或C6.0.2 GO。`,
  ];
  if (
    sections.size !== REPORT_TITLES.length ||
    finalItems.size !== FINAL_TITLES.length ||
    q.length !== 20
  )
    throw new Error("C611_REPORT_COVERAGE_INCOMPLETE");
  const sectionMarkdown = REPORT_TITLES.map(
    (title, index) =>
      `## ${index + 1}. ${title}\n\n${block(required(sections.get(index + 1)))}`,
  ).join("\n\n");
  const finalTable = table(
    ["#", "最终交付字段", "结果 / 证据边界"],
    FINAL_TITLES.map((title, index) => [
      index + 1,
      title,
      required(finalItems.get(index + 1)),
    ]),
  );
  const questions = q
    .map((answer, index) => `### Q${index + 1}\n\n${answer}`)
    .join("\n\n");
  const document =
    [
      `# C6.1.1 Fixed-Alignment Selective Existing-Candidate MBR Acceptance Report`,
      `本报告仅读取指定A/B运行与验收产物；不打开原始Gold、源音视频，不重新训练、推理或改写机器输出。来源SHA及产物边界列于§138/151/152与附录。`,
      `关键口径：主收益=实际assembled shadow的唯一固定组联合编辑收益；precision/harm=proposal反事实案例计数。旧全片匹配时间指标仅作诊断。UNKNOWN/NOT_APPLICABLE说明缺失或不适用证据，不是通过。`,
      `## 总览\n\n${conclusion}\n\n${allProfiles}`,
      sectionMarkdown,
      `## 附录 A：最终回复 1–150 项完整清单\n\n${finalTable}`,
      `## 附录 B：Q1–Q20\n\n${questions}`,
      `## 附录 C：Fold 联合结果\n\n${foldTable}`,
      `## 附录 D：只读与可分享边界\n\n${block(readonly)}\n\n${block(d.shareable ?? "UNKNOWN：没有可分享摘要产物。")}`,
      `## 附录 E：报告来源身份\n\n${block({ aArtifacts: d.identities, bArtifacts: input.b.identities, validationHash: validation?.semanticHash ?? null, regressionHash: record(input.regression).semanticHash ?? null, reportGenerator: "scripts/report-c6-1-1-selective-mbr.ts", rawGoldReadByReport: false })}`,
    ].join("\n\n") + "\n";
  const clean = String(sanitize(document));
  if (
    /\/(?:Users|home|private|tmp)\//u.test(clean) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(clean)
  )
    throw new Error("C611_REPORT_PRIVACY_SCAN_FAILED");
  return clean;
}

const receiptSchema = z
  .object({
    branch: z.string().min(1).optional(),
    localHead: z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .optional(),
    remoteHead: z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .optional(),
    remoteVerified: z.boolean().optional(),
    worktreeClean: z.boolean().optional(),
    skill23Unchanged: z.boolean().optional(),
    observedAt: z.iso.datetime().optional(),
    commits: z
      .record(z.string(), z.string().regex(/^[a-f0-9]{40}$/u))
      .optional(),
  })
  .strict();
async function readOptionalJson(file: string): Promise<unknown> {
  if (!file) return null;
  return JSON.parse(await readFile(file, "utf8"));
}
/** In-memory schema-derived smoke test only; never saved as an acceptance run. */
function selfTestReport() {
  function seed(node: unknown): unknown {
    const spec = record(node);
    if ("const" in spec) return spec.const;
    if (Array.isArray(spec.enum)) return spec.enum[0];
    if (Array.isArray(spec.anyOf)) {
      return seed(
        spec.anyOf.find((option) => record(option).type === "null") ??
          spec.anyOf[0],
      );
    }
    if (spec.type === "null") return null;
    if (spec.type === "boolean") return false;
    if (spec.type === "number" || spec.type === "integer")
      return typeof spec.minimum === "number"
        ? spec.minimum
        : typeof spec.exclusiveMinimum === "number"
          ? spec.exclusiveMinimum + 1
          : 0;
    if (spec.type === "string") {
      if (spec.format === "date-time") return "2026-01-01T00:00:00.000Z";
      if (typeof spec.pattern === "string" && spec.pattern.includes("{64}"))
        return "a".repeat(64);
      if (typeof spec.pattern === "string" && spec.pattern.includes("{40}"))
        return "a".repeat(40);
      return "synthetic";
    }
    if (spec.type === "array")
      return Array.from(
        { length: typeof spec.minItems === "number" ? spec.minItems : 0 },
        () => seed(spec.items),
      );
    if (spec.type === "object")
      return Object.fromEntries(
        Object.entries(record(spec.properties)).map(([key, value]) => [
          key,
          seed(value),
        ]),
      );
    return null;
  }
  function synthetic<T>(schema: z.ZodType<T>, overrides: JsonRecord = {}): T {
    const generated = z.toJSONSchema(schema, {
      target: "draft-2020-12",
      unrepresentable: "any",
    });
    return schema.parse({ ...record(seed(generated)), ...overrides });
  }
  const profileSeed = record(
    seed(z.toJSONSchema(schemas.c611SelectiveProfileResultsSchema)),
  );
  const rows = required(
    Array.isArray(profileSeed.profiles) ? profileSeed.profiles : null,
  ).map((value, index) => ({ ...record(value), profileId: `S${index}` }));
  const run: RunData = {
    identities: [],
    baseline: synthetic(schemas.c611BaselineSchema),
    freeze: synthetic(schemas.c611MachineFeatureFreezeSchema, {
      runtimeNodeVersion: "v24.0.0",
    }),
    policy: synthetic(schemas.c611PolicyFreezeSchema),
    calibrationPolicy: synthetic(schemas.c611CalibrationPolicySchema),
    folds: synthetic(schemas.c611CalibrationFoldsSchema),
    proposals: synthetic(
      schemas.machineSelectiveExistingCandidateProposalsSchema,
    ),
    features: synthetic(schemas.machineSelectiveMbrFeaturesSchema, {
      featureNames: schemas.C611_FEATURE_NAMES,
    }),
    completeness: synthetic(
      schemas.machineExistingCandidateCompletenessRiskSchema,
    ),
    correlation: synthetic(schemas.machineC611CandidateCorrelationAuditSchema),
    correlationGroups: synthetic(
      schemas.machineC611HierarchicalCorrelationGroupsSchema,
    ),
    risks: synthetic(schemas.machineExistingCandidateMbrRiskLedgerSchema),
    legacy: synthetic(schemas.c611LegacyControlSchema),
    map: synthetic(schemas.c611FixedBaselineAlignmentMapSchema),
    labels: synthetic(schemas.c611ProposalLabelsSchema),
    legacyLabels: synthetic(schemas.c611ProposalLabelsSchema),
    oof: synthetic(schemas.c611OofDecisionsSchema),
    profiles: synthetic(schemas.c611SelectiveProfileResultsSchema, {
      profiles: rows,
    }),
    oracle: synthetic(schemas.c611GroupedOracleSchema),
    manifest: synthetic(schemas.c611ShadowManifestSchema),
    route: null,
    future: null,
    proof: null,
    attribution: null,
    suggestions: null,
    shareable: null,
  };
  const rendered = buildC611AcceptanceReport({
    a: run,
    b: structuredClone(run),
    validation: null,
    regression: null,
    gitReceipt: null,
    paths: {
      a: "synthetic-a",
      b: "synthetic-b",
      validation: "synthetic-validation",
      regression: "synthetic-regression.json",
      output: REPORT_NAME,
    },
  });
  if (
    (rendered.match(/^## \d+\. /gmu) ?? []).length !== 168 ||
    (rendered.match(/^### Q\d+$/gmu) ?? []).length !== 20 ||
    !rendered.includes("| 150 | Worktree Status |")
  )
    throw new Error("C611_REPORT_SYNTHETIC_COVERAGE_FAILED");
  if (
    !rendered.includes("NOT_APPLICABLE") ||
    !rendered.includes("UNKNOWN") ||
    rendered.includes("工程验收证据通过；")
  )
    throw new Error("C611_REPORT_SYNTHETIC_UNKNOWN_HANDLING_FAILED");
  console.log(
    JSON.stringify({
      syntheticReportSelfTest: "passed",
      sections: 168,
      finalFields: 150,
      questions: 20,
      artifactFilesWritten: 0,
      rawGoldRead: false,
    }),
  );
}
async function main() {
  const { values } = parseArgs({
    options: {
      a: { type: "string" },
      b: { type: "string" },
      validation: { type: "string" },
      regression: { type: "string" },
      output: { type: "string" },
      "git-receipt": { type: "string" },
      help: { type: "boolean" },
      "self-test": { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      `Usage: report-c6-1-1-selective-mbr --a <final-a> --b <final-b> --validation <validation-dir> --regression <regression-json> --output <docs/${REPORT_NAME}> [--git-receipt <json>]\nRead-only artifact reporting. No raw Gold/source, models, network, or production writes.`,
    );
    return;
  }
  if (values["self-test"]) {
    selfTestReport();
    return;
  }
  const aPath = path.resolve(required(values.a)),
    bPath = path.resolve(required(values.b));
  const validationPath = path.resolve(required(values.validation)),
    output = path.resolve(required(values.output));
  if (
    path.basename(output) !== REPORT_NAME ||
    [aPath, bPath, validationPath].some(
      (root) => output === root || output.startsWith(`${root}${path.sep}`),
    )
  )
    throw new Error("C611_REPORT_TARGET_MUST_NOT_MUTATE_INPUT_ARTIFACTS");
  const a = await loadRun(aPath),
    b = await loadRun(bPath);
  const validation = await readArtifact(
    validationPath,
    "c6-1-1-validation",
    schemas.c611ValidationSchema,
    [],
    true,
  );
  const regressionPath = required(values.regression);
  const regression = schemas.c611RegressionEvidenceSchema.parse(
    await readOptionalJson(regressionPath),
  );
  const { semanticHash: regressionHash, ...regressionBody } = regression;
  if (hash(regressionBody) !== regressionHash)
    throw new Error("C611_REPORT_REGRESSION_HASH_INVALID");
  if (regression.sourceCodeAggregateHash !== a.freeze.sourceCodeAggregateHash)
    throw new Error("C611_REPORT_REGRESSION_SOURCE_BINDING_MISMATCH");
  for (const check of regression.checks) {
    const relative = check.logRelativePath;
    if (path.isAbsolute(relative) || relative.split(/[\\/]/u).includes(".."))
      throw new Error("C611_REPORT_LOG_PATH_UNSAFE");
    if (
      sha256(
        await readFile(path.resolve(path.dirname(regressionPath), relative)),
      ) !== check.logSha256
    )
      throw new Error("C611_REPORT_REGRESSION_LOG_HASH_INVALID");
  }
  const rawReceipt = await readOptionalJson(values["git-receipt"] ?? "");
  const gitReceipt =
    rawReceipt === null ? null : receiptSchema.parse(rawReceipt);
  const markdown = buildC611AcceptanceReport({
    a,
    b,
    validation,
    regression,
    gitReceipt,
    paths: {
      a: aPath,
      b: bPath,
      validation: validationPath,
      regression: regressionPath,
      output,
    },
  });
  await schemas.atomicWriteFile(output, markdown, { overwrite: true });
  console.log(
    JSON.stringify({
      report: path.basename(output),
      sections: REPORT_TITLES.length,
      finalChecklistItems: FINAL_TITLES.length,
      questions: 20,
      bytes: Buffer.byteLength(markdown),
      reportSha256: sha256(Buffer.from(markdown)),
      rawGoldRead: false,
      sourceMediaRead: false,
    }),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
