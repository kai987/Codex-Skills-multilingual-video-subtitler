import { createHash } from "node:crypto";

import type { C60112ReviewQualityEvaluation } from "./c60112-review-quality-evaluator.js";

export type C60112ExitResult =
  | "REVIEW_ASSISTANCE_PRODUCT_READY_FOR_REAL_HUMAN_TRIAL"
  | "REVIEW_ASSISTANCE_ENGINEERING_READY_RANKING_WEAK"
  | "REVIEW_ASSISTANCE_DATA_GAPS"
  | "REVIEW_ASSISTANCE_NOT_READY";

export interface C60112RouteDecision {
  schemaVersion: "1.0.0";
  policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2";
  artifactType: "c6-0-1-12-route-decision";
  generatedAt: string;
  route: "HUMAN_ON_EXCEPTION";
  nextStage:
    | "REAL_HUMAN_TRIAL_ON_UNSEEN_EPISODE"
    | "IMPROVE_REVIEW_RANKING"
    | "REPAIR_DATA_GAPS";
  result: C60112ExitResult;
  engineeringComplete: boolean;
  rankingEffective: boolean;
  realHumanTrialAuthorized: boolean;
  workloadReductionClaimAllowed: boolean;
  automaticProviderSwitching: false;
  carnationHumanSessionCreated: false;
  productionStatus: "needs-review";
  finalizationMethod: "none";
  machineOnlyReleaseAuthorized: false;
  c602Status: "HOLD";
  reasons: string[];
  semanticHash: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function decideC60112Route(input: {
  generatedAt: string;
  quality: C60112ReviewQualityEvaluation;
  machineBuildGoldInputCount: number;
  freezePassed: boolean;
  audioPlayableCount: number;
  audioRegionCount: number;
  reviewItemCount: number;
  candidateBundleCount: number;
  candidateActionableItemCount: number;
  missingCandidateReferenceCount: number;
  workspaceOfflinePassed: boolean;
  syntheticWorkflowPassed: boolean;
  validationPassed: boolean;
}): C60112RouteDecision {
  const ranking = (
    id: C60112ReviewQualityEvaluation["rankingBaselines"][number]["baseline"],
  ) =>
    input.quality.rankingBaselines.find(
      (candidate) => candidate.baseline === id,
    );
  const top20 = (
    id: C60112ReviewQualityEvaluation["rankingBaselines"][number]["baseline"],
  ) =>
    ranking(id)?.budgetMetrics.find(
      (candidate) => candidate.budget === "TOP_20_PERCENT",
    );
  const r3Top20 = top20("R3_FULL_EVIDENCE_RANK");
  const r0Top20 = top20("R0_CHRONOLOGICAL");
  const r2Top20 = top20("R2_CROSS_MODEL_DISAGREEMENT_ONLY");
  const rankingEffective =
    input.quality.rankingResult === "REVIEW_PRIORITY_EFFECTIVE";
  const dataComplete =
    input.machineBuildGoldInputCount === 0 &&
    input.freezePassed &&
    input.audioRegionCount > 0 &&
    input.audioPlayableCount === input.audioRegionCount &&
    input.reviewItemCount > 0 &&
    input.candidateBundleCount === input.reviewItemCount &&
    input.candidateActionableItemCount > 0 &&
    input.missingCandidateReferenceCount === 0;
  const engineeringComplete =
    dataComplete &&
    input.workspaceOfflinePassed &&
    input.syntheticWorkflowPassed &&
    input.validationPassed;
  let result: C60112ExitResult;
  let nextStage: C60112RouteDecision["nextStage"];
  if (!dataComplete) {
    result = "REVIEW_ASSISTANCE_DATA_GAPS";
    nextStage = "REPAIR_DATA_GAPS";
  } else if (!engineeringComplete) {
    result = "REVIEW_ASSISTANCE_NOT_READY";
    nextStage = "REPAIR_DATA_GAPS";
  } else if (!rankingEffective) {
    result = "REVIEW_ASSISTANCE_ENGINEERING_READY_RANKING_WEAK";
    nextStage = "REAL_HUMAN_TRIAL_ON_UNSEEN_EPISODE";
  } else {
    result = "REVIEW_ASSISTANCE_PRODUCT_READY_FOR_REAL_HUMAN_TRIAL";
    nextStage = "REAL_HUMAN_TRIAL_ON_UNSEEN_EPISODE";
  }
  const reasons = [
    `machine-build-gold-input-count=${input.machineBuildGoldInputCount}`,
    `freeze-passed=${String(input.freezePassed)}`,
    `audio-playable=${input.audioPlayableCount}/${input.audioRegionCount}`,
    `candidate-bundles=${input.candidateBundleCount}/${input.reviewItemCount}`,
    `candidate-actionable-items=${input.candidateActionableItemCount}`,
    `missing-candidate-references=${input.missingCandidateReferenceCount}`,
    `workspace-offline-passed=${String(input.workspaceOfflinePassed)}`,
    `synthetic-workflow-passed=${String(input.syntheticWorkflowPassed)}`,
    `validation-passed=${String(input.validationPassed)}`,
    `r3-top20-residual=${String(r3Top20?.unreviewedResidualErrorRate ?? null)}`,
    `r0-top20-residual=${String(r0Top20?.unreviewedResidualErrorRate ?? null)}`,
    `r2-top20-residual=${String(r2Top20?.unreviewedResidualErrorRate ?? null)}`,
    `ranking-effective=${String(rankingEffective)}`,
    `workload-reduction-claim-allowed=${String(engineeringComplete && rankingEffective)}`,
  ];
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2" as const,
    artifactType: "c6-0-1-12-route-decision" as const,
    generatedAt: input.generatedAt,
    route: "HUMAN_ON_EXCEPTION" as const,
    nextStage,
    result,
    engineeringComplete,
    rankingEffective,
    realHumanTrialAuthorized: engineeringComplete,
    workloadReductionClaimAllowed: engineeringComplete && rankingEffective,
    automaticProviderSwitching: false as const,
    carnationHumanSessionCreated: false as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
    c602Status: "HOLD" as const,
    reasons,
  };
  return {
    ...core,
    semanticHash: hashValue({ ...core, generatedAt: undefined }),
  };
}
