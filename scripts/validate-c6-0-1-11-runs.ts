import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  c60111CalibrationFoldsSchema,
  c60111DataQualityAuditSchema,
  c60111FeatureAblationReportSchema,
  c60111RouteDecisionSchema,
  c60111SelectiveDiscriminatorFreezeSchema,
  c60111ValidationSchema,
  goldCrossModelCalibrationLabelsSchema,
  machineCrossModelCalibrationCorpusSchema,
  machineCrossModelDiscriminatorFeaturesSchema,
  machineIndependentAcousticDiscriminatorSchema,
  machineIndependentVerifierRuntimeSchema,
  machinePairedWhisperEvidenceSchema,
} from "@mvl/shared";

function argumentValue(list: readonly string[], flag: string): string {
  const index = list.indexOf(flag);
  const value = index < 0 ? undefined : list[index + 1];
  if (value === undefined || value === "") throw new Error(`Missing ${flag}.`);
  return path.resolve(value);
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

async function subtitleDirectory(root: string): Promise<string> {
  const names = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (names.length !== 1)
    throw new Error(`Expected one subtitle directory in ${root}.`);
  return path.join(root, names[0]?.name ?? "");
}

async function subtitleHashes(root: string): Promise<Record<string, string>> {
  const subtitle = await subtitleDirectory(root);
  const names = (await readdir(subtitle)).filter((name) =>
    /\.(?:ass|srt|vtt)$/u.test(name),
  );
  const hashes: Record<string, string> = {};
  for (const name of names)
    hashes[name] = await sha256File(path.join(subtitle, name));
  return hashes;
}

const list = process.argv.slice(2);
const roots = {
  corpus: argumentValue(list, "--corpus"),
  paired: argumentValue(list, "--paired"),
  runtime: argumentValue(list, "--runtime"),
  independent: argumentValue(list, "--independent"),
  features: argumentValue(list, "--features"),
  labels: argumentValue(list, "--labels"),
  folds: argumentValue(list, "--folds"),
  ablation: argumentValue(list, "--ablation"),
  freeze: argumentValue(list, "--freeze"),
  route: argumentValue(list, "--route"),
  validation: argumentValue(list, "--validation"),
  baseline: argumentValue(list, "--baseline"),
  finalA: argumentValue(list, "--final-a"),
  finalB: argumentValue(list, "--final-b"),
};

const corpus = machineCrossModelCalibrationCorpusSchema.parse(
  await json(
    path.join(roots.corpus, "machine-cross-model-calibration-corpus.json"),
  ),
);
const pairedFresh = machinePairedWhisperEvidenceSchema.parse(
  await json(path.join(roots.paired, "machine-paired-whisper-evidence.json")),
);
const pairedReplay = machinePairedWhisperEvidenceSchema.parse(
  await json(
    path.join(
      roots.paired,
      "machine-paired-whisper-evidence.cache-replay.json",
    ),
  ),
);
const runtimeFresh = machineIndependentVerifierRuntimeSchema.parse(
  await json(
    path.join(roots.runtime, "machine-independent-verifier-runtime.json"),
  ),
);
const runtimeReplay = machineIndependentVerifierRuntimeSchema.parse(
  await json(
    path.join(
      roots.runtime,
      "machine-independent-verifier-runtime.cache-replay.json",
    ),
  ),
);
const independentFresh = machineIndependentAcousticDiscriminatorSchema.parse(
  await json(
    path.join(
      roots.independent,
      "machine-independent-acoustic-discriminator.json",
    ),
  ),
);
const independentReplay = machineIndependentAcousticDiscriminatorSchema.parse(
  await json(
    path.join(
      roots.independent,
      "machine-independent-acoustic-discriminator.cache-replay.json",
    ),
  ),
);
const features = machineCrossModelDiscriminatorFeaturesSchema.parse(
  await json(
    path.join(
      roots.features,
      "machine-cross-model-discriminator-features.json",
    ),
  ),
);
const labels = goldCrossModelCalibrationLabelsSchema.parse(
  await json(
    path.join(roots.labels, "gold-cross-model-calibration-labels.json"),
  ),
);
const folds = c60111CalibrationFoldsSchema.parse(
  await json(path.join(roots.folds, "c6-0-1-11-calibration-folds.json")),
);
const dataQuality = c60111DataQualityAuditSchema.parse(
  await json(path.join(roots.folds, "c6-0-1-11-data-quality-audit.json")),
);
const ablation = c60111FeatureAblationReportSchema.parse(
  await json(
    path.join(roots.ablation, "c6-0-1-11-feature-ablation-report.json"),
  ),
);
const freeze = c60111SelectiveDiscriminatorFreezeSchema.parse(
  await json(
    path.join(roots.freeze, "c6-0-1-11-selective-discriminator-freeze.json"),
  ),
);
const route = c60111RouteDecisionSchema.parse(
  await json(path.join(roots.route, "c6-0-1-11-route-decision.json")),
);
const validation = c60111ValidationSchema.parse(
  await json(path.join(roots.validation, "c6-0-1-11-validation.json")),
);

const baselineHashes = await subtitleHashes(roots.baseline);
const finalAHashes = await subtitleHashes(roots.finalA);
const finalBHashes = await subtitleHashes(roots.finalB);
const assertions: Record<string, boolean> = {
  corpusComplete: corpus.summary.eventCount > 0,
  pairedFreshComplete:
    pairedFresh.requests.coreExactFreshInferenceCount ===
      corpus.summary.eventCount &&
    pairedFresh.requests.coreContextFreshInferenceCount ===
      corpus.summary.eventCount,
  pairedReplayComplete:
    pairedReplay.requests.coreExactCacheReplayCount ===
      corpus.summary.eventCount &&
    pairedReplay.requests.coreContextCacheReplayCount ===
      corpus.summary.eventCount,
  pairedCoverage: pairedFresh.summary.coverage >= 0.9,
  verifierFreshComplete:
    runtimeFresh.requests.freshInferenceCount === corpus.summary.eventCount,
  verifierReplayComplete:
    runtimeReplay.requests.cacheHitCount === corpus.summary.eventCount &&
    runtimeReplay.requests.freshInferenceCount === 0 &&
    runtimeReplay.requests.modelLoadCount === 0,
  independentParity:
    JSON.stringify(independentFresh.events) ===
    JSON.stringify(independentReplay.events),
  featuresFrozenBeforeGold: features.featuresFrozenBeforeGold,
  labelsBoundToFeatureFreeze:
    labels.featureFreezeSemanticHash === features.semanticHash,
  foldsBeforeLabels: folds.constructedBeforeLabels,
  noRandomSplit: !folds.randomSplitUsed,
  dataQuality: dataQuality.passed,
  ablationComplete: ablation.variants.length === 6,
  productionDisabled: true,
  productionNeedsReview: true,
  noMachineRelease: !route.machineOnlyReleaseAuthorized,
  c602Hold: true,
  freezeNeverEnforced: !freeze.productionEnforcementEnabled,
  finalAParity: JSON.stringify(baselineHashes) === JSON.stringify(finalAHashes),
  finalBParity: JSON.stringify(baselineHashes) === JSON.stringify(finalBHashes),
  validationPassed: validation.passed,
};
const failed = Object.entries(assertions).filter(([, passed]) => !passed);
if (failed.length > 0) {
  throw new Error(
    `C6.0.1.11 validation failed: ${failed.map(([name]) => name).join(", ")}`,
  );
}
console.log(
  JSON.stringify(
    {
      passed: true,
      assertionCount: Object.keys(assertions).length,
      corpus: corpus.summary,
      paired: pairedFresh.summary,
      independent: independentFresh.summary,
      labels: labels.summary,
      bestModelId: ablation.bestModelId,
      route: route.decision,
      freezeCreated: freeze.created,
    },
    null,
    2,
  ),
);
