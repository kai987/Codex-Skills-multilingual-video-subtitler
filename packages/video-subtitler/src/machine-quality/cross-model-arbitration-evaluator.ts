import {
  c60110Dev24EvaluationSchema,
  c60110PolicyFreezeSchema,
  c60110PolicyVersion,
  type C60110Dev24Evaluation,
  type C60110PolicyFreeze,
  type C60110PolicyProfileName,
  type C60110PolicyProfiles,
  type GoldCrossModelComplementarityEvaluation,
  type GoldSecondAsrControlRegression,
  type MachineCrossModelArbitrationLedger,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface C60110ProfileEvaluationResult {
  profile: C60110PolicyProfileName;
  decisionLedgerSemanticHash: string;
  selectReazonCount: number;
  keepWhisperCount: number;
  abstainCount: number;
  blockedCount: number;
  evaluableSwitchCount: number;
  correctSwitchCount: number;
  wrongSwitchCount: number;
  neutralSwitchCount: number;
  baselineLocalError: number;
  arbitrationLocalError: number;
  realizedLocalGain: number;
  availableOracleGain: number;
  oracleCaptureRate: number | null;
  controlRegressionCount: number;
  avoidedBlindRegressionCount: number;
  productionEligible: boolean;
  semanticHash: string;
}

export function evaluateC60110Dev24Profile(input: {
  ledger: MachineCrossModelArbitrationLedger;
  complementarity: GoldCrossModelComplementarityEvaluation;
  controls: GoldSecondAsrControlRegression;
  availableOracleGain: number;
  productionEligible: boolean;
}): C60110ProfileEvaluationResult {
  const goldByEvent = new Map(
    input.complementarity.events.map(
      (event) => [event.eventId, event] as const,
    ),
  );
  let baselineLocalError = 0;
  let arbitrationLocalError = 0;
  let evaluableSwitchCount = 0;
  let correctSwitchCount = 0;
  let wrongSwitchCount = 0;
  let neutralSwitchCount = 0;
  for (const decision of input.ledger.events) {
    const gold = goldByEvent.get(decision.eventId);
    const baselineError = gold?.bestWhisperPoolError ?? gold?.whisperCoreError;
    if (
      gold === undefined ||
      baselineError === undefined ||
      baselineError === null ||
      gold.reazonCoreError === null
    ) {
      continue;
    }
    baselineLocalError += baselineError;
    if (decision.decision === "SELECT_REAZON") {
      evaluableSwitchCount += 1;
      arbitrationLocalError += gold.reazonCoreError;
      if (gold.reazonCoreError < baselineError) correctSwitchCount += 1;
      else if (gold.reazonCoreError > baselineError) wrongSwitchCount += 1;
      else neutralSwitchCount += 1;
    } else {
      arbitrationLocalError += baselineError;
    }
  }
  const controlByEvent = new Map(
    input.controls.events.map((event) => [event.eventId, event] as const),
  );
  const selectedControls = input.ledger.events.filter(
    (decision) =>
      decision.decision === "SELECT_REAZON" &&
      controlByEvent.has(decision.eventId),
  );
  const controlRegressionCount = selectedControls.filter(
    (decision) =>
      controlByEvent.get(decision.eventId)
        ?.blindlySelectingReazonWouldRegress === true,
  ).length;
  const avoidedBlindRegressionCount = input.controls.events.filter(
    (control) =>
      control.blindlySelectingReazonWouldRegress === true &&
      input.ledger.events.find(
        (decision) => decision.eventId === control.eventId,
      )?.decision !== "SELECT_REAZON",
  ).length;
  const realizedLocalGain = baselineLocalError - arbitrationLocalError;
  const raw = {
    profile: input.ledger.policyProfile,
    decisionLedgerSemanticHash: input.ledger.semanticHash,
    selectReazonCount: input.ledger.summary.selectReazonCount,
    keepWhisperCount: input.ledger.summary.keepWhisperCount,
    abstainCount: input.ledger.summary.abstainCount,
    blockedCount: input.ledger.summary.blockedCount,
    evaluableSwitchCount,
    correctSwitchCount,
    wrongSwitchCount,
    neutralSwitchCount,
    baselineLocalError,
    arbitrationLocalError,
    realizedLocalGain,
    availableOracleGain: input.availableOracleGain,
    oracleCaptureRate:
      input.availableOracleGain === 0
        ? null
        : realizedLocalGain / input.availableOracleGain,
    controlRegressionCount,
    avoidedBlindRegressionCount,
    productionEligible: input.productionEligible,
  };
  return { ...raw, semanticHash: machineQualitySemanticHash(raw) };
}

export function buildC60110Dev24Evaluation(input: {
  generatedAt: string;
  profiles: C60110PolicyProfiles;
  ledgers: readonly MachineCrossModelArbitrationLedger[];
  complementarity: GoldCrossModelComplementarityEvaluation;
  controls: GoldSecondAsrControlRegression;
  goldIdentityHash: string;
  availableOracleGain: number;
}): C60110Dev24Evaluation {
  const evaluations = input.profiles.profiles.map((profile) => {
    const ledger = input.ledgers.find(
      (value) => value.policyProfile === profile.profile,
    );
    if (ledger === undefined) throw new Error(`Missing ${profile.profile}.`);
    return evaluateC60110Dev24Profile({
      ledger,
      complementarity: input.complementarity,
      controls: input.controls,
      availableOracleGain: input.availableOracleGain,
      productionEligible: profile.productionEligible,
    });
  });
  const productionCandidates = evaluations.filter(
    (evaluation) =>
      evaluation.productionEligible &&
      evaluation.wrongSwitchCount === 0 &&
      evaluation.realizedLocalGain > 0,
  );
  const selected = (["CONSERVATIVE", "BALANCED"] as const)
    .map((profile) =>
      productionCandidates.find((value) => value.profile === profile),
    )
    .find((value) => value !== undefined);
  const selectedProductionProfile = selected?.profile ?? ("DISABLED" as const);
  const selectionResult =
    selected === undefined
      ? ("HOLD_ARBITRATION_NOT_SAFE" as const)
      : ("ARBITRATION_PROFILE_SELECTED" as const);
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60110PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-10-dev24-evaluation" as const,
    evaluationPhase: "post-decision-freeze-gold-isolated" as const,
    dev24EventCount: 24 as const,
    targetCount: 12 as const,
    controlCount: 12 as const,
    policyProfilesSemanticHash: input.profiles.semanticHash,
    machineDecisionFreezeHashes: Object.fromEntries(
      input.ledgers.map((ledger) => [
        ledger.policyProfile,
        ledger.semanticHash,
      ]),
    ) as Record<C60110PolicyProfileName, string>,
    goldIdentityHash: input.goldIdentityHash,
    goldTextIncluded: false as const,
    profiles: evaluations,
    selectedProductionProfile,
    selectionResult,
    selectionReasons:
      selected === undefined
        ? [
            "No production-eligible profile achieved both zero Gold-worsening switches and positive DEV24 local gain.",
            "Production arbitration enforcement is disabled rather than relaxing the generic safety rules.",
          ]
        : [
            `${selected.profile} is the most conservative profile with zero wrong switches and positive local gain.`,
          ],
    runtimeGoldInputCount: 0 as const,
  };
  return c60110Dev24EvaluationSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}

export function buildC60110PolicyFreeze(input: {
  generatedAt: string;
  profiles: C60110PolicyProfiles;
  dev24Evaluation: C60110Dev24Evaluation;
}): C60110PolicyFreeze {
  const selected = input.dev24Evaluation.selectedProductionProfile;
  const arbitrationPolicyHash = machineQualitySemanticHash({
    policyVersion: c60110PolicyVersion,
    selectedProductionProfile: selected,
    profile:
      selected === "DISABLED"
        ? null
        : input.profiles.profiles.find(
            (profile) => profile.profile === selected,
          ),
    enforcementEnabled: selected !== "DISABLED",
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60110PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-10-policy-freeze" as const,
    selectedProductionProfile: selected,
    enforcementEnabled: selected !== "DISABLED",
    arbitrationPolicyHash,
    policyProfilesSemanticHash: input.profiles.semanticHash,
    dev24EvaluationSemanticHash: input.dev24Evaluation.semanticHash,
    frozenBeforeHoldoutSelection: true as const,
    frozenBeforeHoldoutInference: true as const,
    frozenBeforeHoldoutGold: true as const,
    immutableRuleSet: true as const,
    runtimeGoldInputCount: 0 as const,
  };
  return c60110PolicyFreezeSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
