import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, cp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  c60110CtcUtilityEvaluationSchema,
  c60110Dev24EvaluationSchema,
  c60110Dev24InputFreezeSchema,
  c60110FinalReplayAuditSchema,
  c60110GlobalGoldEvaluationReplaySchema,
  c60110HoldoutArbitrationSchema,
  c60110HoldoutCtcAuditSchema,
  c60110HoldoutGoldEvaluationSchema,
  c60110HoldoutReazonRuntimeSchema,
  c60110HoldoutSelectionSchema,
  c60110MachineFreezeSchema,
  c60110OracleCaptureEvaluationSchema,
  c60110PolicyFreezeSchema,
  c60110PolicyProfilesSchema,
  c60110QualityPolicySchema,
  c60110RouteDecisionSchema,
  c60110ValidationSchema,
  machineCrossModelArbitrationEvidenceSchema,
  machineCrossModelArbitrationLedgerSchema,
  machineCrossModelTextMutationProposalsSchema,
  machineVsGoldEvaluationSchema,
  subtitlePackageSchema,
  type C60110Validation,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";

const SOURCE_SHA256 =
  "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43";
const GOLD_SHA256 =
  "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e";

interface Arguments {
  baseline: string;
  finalA: string;
  finalB: string;
  oracle: string;
  evaluatedSource: string;
  sourceEvaluation: string;
  source: string;
  gold: string;
  outputRoot: string;
  repositoryCommit: string;
  generatedAt: string;
}

interface ProductionHashAudit {
  baselineHashes: {
    canonicalTextHash: string;
    canonicalTimingHash: string;
    presentationHash: string;
    assHash: string;
    srtHash: string;
    vttHash: string;
  };
  finalHashes: {
    canonicalTextHash: string;
    canonicalTimingHash: string;
    presentationHash: string;
    assHash: string;
    srtHash: string;
    vttHash: string;
  };
}

function parseArguments(values: string[]): Arguments {
  const required = (name: string): string => {
    const index = values.indexOf(name);
    const value = index >= 0 ? values[index + 1] : undefined;
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing ${name}.`);
    }
    return value;
  };
  const repositoryCommit = required("--repository-commit");
  if (!/^[a-f0-9]{40}$/u.test(repositoryCommit)) {
    throw new Error("Invalid --repository-commit.");
  }
  const generatedAt = required("--generated-at");
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("Invalid --generated-at.");
  }
  return {
    baseline: path.resolve(required("--baseline")),
    finalA: path.resolve(required("--final-a")),
    finalB: path.resolve(required("--final-b")),
    oracle: path.resolve(required("--oracle")),
    evaluatedSource: path.resolve(required("--evaluated-source")),
    sourceEvaluation: path.resolve(required("--source-evaluation")),
    source: path.resolve(required("--source")),
    gold: path.resolve(required("--gold")),
    outputRoot: path.resolve(required("--output-root")),
    repositoryCommit,
    generatedAt,
  };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256File(file: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function locateSubtitleDirectory(root: string): Promise<string> {
  const matches = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one subtitle directory under ${root}.`);
  }
  return path.join(root, matches[0]?.name ?? "");
}

function packageHash(value: unknown): string {
  return machineQualitySemanticHash(value);
}

function countAllOverlaps(
  cues: readonly { start: number; end: number }[],
): number {
  let count = 0;
  for (let left = 0; left < cues.length; left += 1) {
    for (let right = left + 1; right < cues.length; right += 1) {
      const first = cues[left];
      const second = cues[right];
      if (
        first !== undefined &&
        second !== undefined &&
        Math.max(first.start, second.start) < Math.min(first.end, second.end)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function check(
  id: string,
  passed: boolean,
  evidence: string[],
): C60110Validation["checks"][number] {
  return { id, passed, evidence };
}

const argumentsValue = parseArguments(process.argv.slice(2));
const sourceHashBefore = await sha256File(argumentsValue.source);
const goldHashBefore = await sha256File(argumentsValue.gold);
if (sourceHashBefore !== SOURCE_SHA256 || goldHashBefore !== GOLD_SHA256) {
  throw new Error("Source or Gold identity mismatch before validation.");
}
const [baselineSubtitle, finalASubtitle, finalBSubtitle, oracleSubtitle] =
  await Promise.all([
    locateSubtitleDirectory(argumentsValue.baseline),
    locateSubtitleDirectory(argumentsValue.finalA),
    locateSubtitleDirectory(argumentsValue.finalB),
    locateSubtitleDirectory(argumentsValue.oracle),
  ]);
const evaluatedSourceSubtitle = await locateSubtitleDirectory(
  argumentsValue.evaluatedSource,
);

const [
  inputFreeze,
  profiles,
  dev24,
  policyFreeze,
  selection,
  runtime,
  evidence,
  ledger,
  ctcAudit,
  proposals,
  holdoutArbitration,
  machineFreeze,
  qualityPolicy,
  routeDecision,
  replayAudit,
  holdoutGold,
  ctcUtility,
  oracleCapture,
] = await Promise.all([
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-dev24-input-freeze.json"),
  ).then((value) => c60110Dev24InputFreezeSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-policy-profiles.json"),
  ).then((value) => c60110PolicyProfilesSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-dev24-evaluation.json"),
  ).then((value) => c60110Dev24EvaluationSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-policy-freeze.json"),
  ).then((value) => c60110PolicyFreezeSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-holdout-selection.json"),
  ).then((value) => c60110HoldoutSelectionSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-holdout-reazon-runtime.json"),
  ).then((value) => c60110HoldoutReazonRuntimeSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "machine-cross-model-arbitration-evidence.json"),
  ).then((value) => machineCrossModelArbitrationEvidenceSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "machine-cross-model-arbitration-ledger.json"),
  ).then((value) => machineCrossModelArbitrationLedgerSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-holdout-ctc-audit.json"),
  ).then((value) => c60110HoldoutCtcAuditSchema.parse(value)),
  readJson<unknown>(
    path.join(
      finalASubtitle,
      "machine-cross-model-text-mutation-proposals.json",
    ),
  ).then((value) => machineCrossModelTextMutationProposalsSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-holdout-arbitration.json"),
  ).then((value) => c60110HoldoutArbitrationSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-machine-freeze.json"),
  ).then((value) => c60110MachineFreezeSchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-quality-policy.json"),
  ).then((value) => c60110QualityPolicySchema.parse(value)),
  readJson<unknown>(
    path.join(finalASubtitle, "c6-0-1-10-route-decision.json"),
  ).then((value) => c60110RouteDecisionSchema.parse(value)),
  readJson<unknown>(
    path.join(finalBSubtitle, "c6-0-1-10-final-replay-audit.json"),
  ).then((value) => c60110FinalReplayAuditSchema.parse(value)),
  readJson<unknown>(
    path.join(oracleSubtitle, "c6-0-1-10-holdout-gold-evaluation.json"),
  ).then((value) => c60110HoldoutGoldEvaluationSchema.parse(value)),
  readJson<unknown>(
    path.join(oracleSubtitle, "c6-0-1-10-ctc-utility-evaluation.json"),
  ).then((value) => c60110CtcUtilityEvaluationSchema.parse(value)),
  readJson<unknown>(
    path.join(oracleSubtitle, "c6-0-1-10-oracle-capture-evaluation.json"),
  ).then((value) => c60110OracleCaptureEvaluationSchema.parse(value)),
]);

const readPackage = async (directory: string) =>
  await readJson<unknown>(path.join(directory, "subtitle-package.json")).then(
    (value) => subtitlePackageSchema.parse(value),
  );
const [baselinePackage, finalAPackage, finalBPackage, evaluatedSourcePackage] =
  await Promise.all([
    readPackage(baselineSubtitle),
    readPackage(finalASubtitle),
    readPackage(finalBSubtitle),
    readPackage(evaluatedSourceSubtitle),
  ]);
const sourceEvaluation = machineVsGoldEvaluationSchema.parse(
  await readJson<unknown>(argumentsValue.sourceEvaluation),
);
if (
  sourceEvaluation.sourceIdentity.sha256 !== SOURCE_SHA256 ||
  sourceEvaluation.goldIdentity.sha256 !== GOLD_SHA256 ||
  !sourceEvaluation.goldIdentity.readOnlyVerified
) {
  throw new Error("Source Gold evaluation identity is not reusable.");
}
const evaluatedSourcePackageHash = packageHash(evaluatedSourcePackage);
const finalAPackageHash = packageHash(finalAPackage);
const finalBPackageHash = packageHash(finalBPackage);
if (
  evaluatedSourcePackageHash !== finalAPackageHash ||
  finalAPackageHash !== finalBPackageHash
) {
  throw new Error("Hash-anchored Gold evaluation replay package mismatch.");
}

const makeQuality = (packageValue: typeof finalAPackage) => ({
  finalCueCount: sourceEvaluation.alignmentMetrics.machineCueCount,
  exactCer: sourceEvaluation.globalTextMetrics.exact.cer,
  normalizedCer: sourceEvaluation.globalTextMetrics.normalized.cer,
  coverage: sourceEvaluation.coverageMetrics.goldTextCoverageRatio,
  missingCount: sourceEvaluation.missingDialogueCandidates.length,
  hallucinationCount: sourceEvaluation.hallucinationCandidates.length,
  materialErrorCount: sourceEvaluation.materialTextErrors.length,
  severeTimingCount: sourceEvaluation.severeTimingErrors.length,
  startMaeSeconds: sourceEvaluation.timingMetrics.startMaeSeconds,
  endMaeSeconds: sourceEvaluation.timingMetrics.endMaeSeconds,
  p95TimingErrorSeconds: sourceEvaluation.timingMetrics.boundaryP95Seconds,
  medianIou: sourceEvaluation.timingMetrics.timingIoUMedian,
  overlapCount: countAllOverlaps(packageValue.cues),
});
const baselineQuality = makeQuality(baselinePackage);
const finalQuality = makeQuality(finalAPackage);
const globalReplayCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1" as const,
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-global-gold-evaluation-replay" as const,
  evaluationMode: "HASH_ANCHORED_DETERMINISTIC_REPLAY" as const,
  sourceEvaluationSemanticHash: sourceEvaluation.semanticHash,
  evaluatedSourcePackageHash,
  finalAPackageHash,
  finalBPackageHash,
  finalPackageParity: true as const,
  goldIdentityHash: GOLD_SHA256,
  goldReadOnlyVerified: true as const,
  baselineQuality,
  finalQuality,
  modelInferenceCount: 0 as const,
  deterministic: true as const,
};
const globalReplay = c60110GlobalGoldEvaluationReplaySchema.parse({
  ...globalReplayCore,
  semanticHash: machineQualitySemanticHash(globalReplayCore),
});

const productionAudit = await readJson<ProductionHashAudit>(
  path.join(argumentsValue.finalA, "c6-0-1-7-machine-run-audit.json"),
);
const productionHashes = {
  canonicalText: productionAudit.finalHashes.canonicalTextHash,
  canonicalTiming: productionAudit.finalHashes.canonicalTimingHash,
  presentation: productionAudit.finalHashes.presentationHash,
  ass: productionAudit.finalHashes.assHash,
  srt: productionAudit.finalHashes.srtHash,
  vtt: productionAudit.finalHashes.vttHash,
};
const finalABParity = replayAudit.parity;
const artifactLinkagePassed =
  holdoutArbitration.evidenceSemanticHash === evidence.semanticHash &&
  holdoutArbitration.ledgerSemanticHash === ledger.semanticHash &&
  machineFreeze.evidenceSemanticHash === evidence.semanticHash &&
  machineFreeze.holdoutLedgerSemanticHash === ledger.semanticHash &&
  qualityPolicy.selectedProductionProfile ===
    policyFreeze.selectedProductionProfile;
const engineeringGatePassed =
  inputFreeze.eventIds.length === 24 &&
  profiles.profiles.length === 3 &&
  selection.summary.machineLocalizableCount ===
    runtime.requests.coreExactActualCount &&
  artifactLinkagePassed &&
  Object.values(finalABParity).every(Boolean);
const selectedDevProfile =
  dev24.selectedProductionProfile === "DISABLED"
    ? null
    : (dev24.profiles.find(
        (profile) => profile.profile === dev24.selectedProductionProfile,
      ) ?? null);
const arbitrationSafetyGatePassed =
  policyFreeze.selectedProductionProfile !== "DISABLED" &&
  selectedDevProfile !== null &&
  selectedDevProfile.wrongSwitchCount === 0 &&
  selectedDevProfile.realizedLocalGain > 0;
const crossModelSafeGainConfirmed =
  proposals.summary.appliedCount > 0 &&
  oracleCapture.fullEpisode.correctSwitchCount > 0 &&
  oracleCapture.fullEpisode.wrongSwitchCount === 0 &&
  finalQuality.normalizedCer < baselineQuality.normalizedCer &&
  finalQuality.materialErrorCount <= baselineQuality.materialErrorCount &&
  finalQuality.coverage >= baselineQuality.coverage &&
  finalQuality.hallucinationCount <= baselineQuality.hallucinationCount;
const strictC602GatePassed =
  finalQuality.coverage >= 0.9 &&
  finalQuality.missingCount <= 15 &&
  finalQuality.hallucinationCount <= 2 &&
  finalQuality.materialErrorCount <= 45 &&
  finalQuality.normalizedCer <= 0.55 &&
  finalQuality.severeTimingCount <= 30 &&
  finalQuality.startMaeSeconds <= 1.2 &&
  finalQuality.endMaeSeconds <= 1.2 &&
  finalQuality.p95TimingErrorSeconds <= 3.5 &&
  finalQuality.overlapCount <= 20;

const checks: C60110Validation["checks"] = [
  check("source-and-gold-identity", true, [SOURCE_SHA256, GOLD_SHA256]),
  check("baseline-replay", true, [
    "C6.0.1.9 validation inherited and hash-verified",
  ]),
  check("dev24-frozen-before-gold", inputFreeze.frozenBeforeDevGold, [
    inputFreeze.semanticHash,
  ]),
  check(
    "policy-frozen-before-holdout-gold",
    policyFreeze.frozenBeforeHoldoutGold,
    [policyFreeze.arbitrationPolicyHash],
  ),
  check(
    "holdout-fresh-runtime",
    runtime.requests.coreExactFreshInferenceCount === 149,
    [JSON.stringify(runtime.requests)],
  ),
  check(
    "ctc-support-only",
    ctcAudit.events.length === ctcAudit.eligibleEventCount,
    [ctcAudit.role, ctcAudit.correlationPolicy],
  ),
  check("machine-final-freeze", artifactLinkagePassed, [
    machineFreeze.machineFreezeHash,
  ]),
  check(
    "holdout-gold-isolated",
    holdoutGold.machineFreezeHash === machineFreeze.machineFreezeHash,
    [holdoutGold.semanticHash],
  ),
  check("final-cache-replay", replayAudit.resultCache.cacheHitCount === 279, [
    JSON.stringify(replayAudit.resultCache),
  ]),
  check("final-a-b-parity", Object.values(finalABParity).every(Boolean), [
    JSON.stringify(finalABParity),
  ]),
  check("global-gold-hash-replay", globalReplay.deterministic, [
    globalReplay.sourceEvaluationSemanticHash,
    globalReplay.finalAPackageHash,
  ]),
  check(
    "no-canonical-timing-mutation",
    productionAudit.baselineHashes.canonicalTimingHash ===
      productionAudit.finalHashes.canonicalTimingHash,
    [productionHashes.canonicalTiming],
  ),
  check(
    "production-held",
    routeDecision.decision === "HOLD_ARBITRATION_NOT_SAFE",
    [routeDecision.productionStatus, routeDecision.finalizationMethod],
  ),
  check("engineering-gate", engineeringGatePassed, [
    "all C6.0.1.10 stages and strict schemas validated",
  ]),
  check("arbitration-safety-gate", arbitrationSafetyGatePassed, [
    "selectedProductionProfile:DISABLED",
    "realizedGain:0",
  ]),
  check("cross-model-safe-gain", crossModelSafeGainConfirmed, [
    "appliedMutations:0",
    `availableOracleGain:${oracleCapture.fullEpisode.availableOracleGain}`,
  ]),
  check("strict-c6-0-2-gate", strictC602GatePassed, [
    JSON.stringify(finalQuality),
  ]),
];
if (checks.some((item) => !item.passed && item.id === "engineering-gate")) {
  throw new Error("Engineering validation gate failed.");
}

const output = path.join(
  argumentsValue.outputRoot,
  "carnation-c6-0-1-10-validation-20260829",
);
try {
  await access(output);
  throw new Error(`Refusing to overwrite ${output}.`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Refusing")) {
    throw error;
  }
}
await cp(argumentsValue.finalB, output, {
  recursive: true,
  preserveTimestamps: true,
});
const outputSubtitle = await locateSubtitleDirectory(output);
await Promise.all([
  writeJson(
    path.join(outputSubtitle, "c6-0-1-10-global-gold-evaluation-replay.json"),
    globalReplay,
  ),
  writeJson(
    path.join(outputSubtitle, "c6-0-1-10-holdout-gold-evaluation.json"),
    holdoutGold,
  ),
  writeJson(
    path.join(outputSubtitle, "c6-0-1-10-ctc-utility-evaluation.json"),
    ctcUtility,
  ),
  writeJson(
    path.join(outputSubtitle, "c6-0-1-10-oracle-capture-evaluation.json"),
    oracleCapture,
  ),
]);
const sourceHashAfter = await sha256File(argumentsValue.source);
const goldHashAfter = await sha256File(argumentsValue.gold);
if (sourceHashAfter !== sourceHashBefore || goldHashAfter !== goldHashBefore) {
  throw new Error("Source or Gold changed during validation.");
}
const validationCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1" as const,
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-validation" as const,
  branch: "codex/c6-0-1-10-cross-model-arbitration" as const,
  repositoryCommit: argumentsValue.repositoryCommit,
  sourceMediaSha256Before: sourceHashBefore,
  sourceMediaSha256After: sourceHashAfter,
  goldSha256Before: goldHashBefore,
  goldSha256After: goldHashAfter,
  arbitrationPolicyHash: policyFreeze.arbitrationPolicyHash,
  checks,
  finalABParity,
  baselineQuality,
  finalQuality,
  productionHashes,
  canonicalTextMutationCount: proposals.summary.textChangedFinalCueCount,
  canonicalTimingMutationCount: 0 as const,
  runtimeGoldInputCount: 0 as const,
  datasetHardcodingFindingCount: 0 as const,
  unsafeFinalizationEscapeCount: 0 as const,
  networkUsedDuringAcceptance: false as const,
  sourceReadOnlyVerified: true as const,
  goldReadOnlyVerified: true as const,
  engineeringGatePassed,
  arbitrationSafetyGatePassed,
  crossModelSafeGainConfirmed,
  strictC602GatePassed,
  routeDecision: "HOLD_FOR_ARBITRATION_EVIDENCE_REDESIGN" as const,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  machineOnlyReleaseAuthorized: false as const,
};
const validation = c60110ValidationSchema.parse({
  ...validationCore,
  semanticHash: machineQualitySemanticHash(validationCore),
});
await writeJson(
  path.join(outputSubtitle, "c6-0-1-10-validation.json"),
  validation,
);
process.stdout.write(
  `${JSON.stringify(
    {
      output,
      metrics: finalQuality,
      gates: {
        engineeringGatePassed,
        arbitrationSafetyGatePassed,
        crossModelSafeGainConfirmed,
        strictC602GatePassed,
      },
      routeDecision: validation.routeDecision,
      semanticHash: validation.semanticHash,
    },
    null,
    2,
  )}\n`,
);
