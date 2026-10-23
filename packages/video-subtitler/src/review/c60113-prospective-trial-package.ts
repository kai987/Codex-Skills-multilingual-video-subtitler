import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  c60113TrialPackageManifestSchema,
  c60113BlankReviewSessionSchema,
  c60113DeploymentRankerSchema,
  c60113RegionFeaturesSchema,
  c60112ReviewPackageFreezeSchema,
  subtitlePackageSchema,
  type C60113RegionFeatures,
} from "@mvl/shared";
import {
  assertC60112ReviewWorkspaceData,
  assertC60112SafeRelativePath,
  writeC60112ReviewWorkspace,
  type C60112ReviewWorkspaceData,
} from "./c60112-review-workspace.js";
import { c60113WorkspaceHash } from "./c60113-review-workspace.js";
import { writeC60113PrivateJson } from "./c60113-prospective-trial.js";
import { selectC60113DeploymentRegions } from "./c60113-region-ranker-deployment.js";
import { assertC60112MachineOnlyInput } from "./c60112-policy.js";
import { assertC60112FrozenWorkspaceData } from "./review-package-freeze.js";

function assertTrialDeployment(input: {
  data: C60112ReviewWorkspaceData;
  machineBytes: Buffer;
  ranker: unknown;
  features: C60113RegionFeatures;
}) {
  const { data, machineBytes } = input;
  const machineHash = createHash("sha256").update(machineBytes).digest("hex");
  const machinePackage = subtitlePackageSchema.parse(
    JSON.parse(machineBytes.toString("utf8")),
  );
  assertC60112MachineOnlyInput({
    data,
    machinePackage,
    features: input.features,
  });
  if (machineHash !== data.machineDraftHash)
    throw new Error("TRIAL_MACHINE_PACKAGE_HASH_MISMATCH");
  if (!data.regionReviewV2) throw new Error("TRIAL_REQUIRES_WORKSPACE_V2");
  if (
    input.features.regions.length !== data.regions.length ||
    input.features.regions.some(
      (row) =>
        !data.regions.some(
          (region) =>
            region.regionId === row.regionId &&
            region.contextStart === row.contextInterval.start &&
            region.contextEnd === row.contextInterval.end &&
            JSON.stringify([...row.itemIds].sort()) ===
              JSON.stringify([...region.reviewItemIds].sort()),
        ),
    )
  )
    throw new Error("TRIAL_MACHINE_FEATURE_REGION_MISMATCH");
  for (const item of data.items)
    for (const cueId of item.finalCueIds) {
      const cue = machinePackage.cues.find((entry) => entry.id === cueId);
      if (
        !cue ||
        (item.finalCueIds.length === 1 &&
          (cue.text !== item.currentText ||
            cue.start !== item.currentStart ||
            cue.end !== item.currentEnd))
      )
        throw new Error("TRIAL_MACHINE_CUE_MISMATCH");
    }
  return data.regionReviewV2.plans.map((plan) => {
    const actual = selectC60113DeploymentRegions({
      deployment: input.ranker,
      features: input.features,
      budgetSeconds: plan.budgetSeconds,
      mandatoryOnly: plan.planId === "ALL_MANDATORY",
    });
    if (
      JSON.stringify(actual.regions.map((region) => region.regionId)) !==
        JSON.stringify(plan.regionIds) ||
      Math.abs(actual.uniqueUnionSeconds - plan.uniqueUnionSeconds) > 1e-7
    )
      throw new Error(`TRIAL_DEPLOYMENT_PLAN_MISMATCH:${plan.planId}`);
    return { planId: plan.planId, selectionHash: actual.semanticHash };
  });
}

/** Export trained parameters, never calibration labels, fold membership or dataset hashes. */
export function c60113DeploymentRanker(
  calibration: Record<string, unknown>,
): Record<string, unknown> {
  const pick = (value: Record<string, unknown>, names: string[]) =>
    Object.fromEntries(
      names
        .filter((name) => value[name] !== undefined)
        .map((name) => [name, value[name]]),
    );
  const result = pick(calibration, [
    "rankerType",
    "featureSchemaVersion",
    "featureNames",
    "rankingPolicy",
    "mandatoryPolicy",
    "burdenSelectionPolicy",
    "fixedReviewOverheadSeconds",
  ]);
  if (
    !["L2_LOGISTIC_REGRESSION", "REGION_RISK_DENSITY_V3"].includes(
      String(result.rankerType),
    )
  )
    throw new Error("UNSUPPORTED_DEPLOYMENT_RANKER");
  const model = calibration.model;
  if (model && typeof model === "object" && !Array.isArray(model)) {
    const m = model as Record<string, unknown>;
    const preprocessing = m.preprocessing as Record<string, unknown>;
    result.model = {
      ...pick(m, ["coefficients", "intercept"]),
      preprocessing: pick(preprocessing, [
        "featureNames",
        "medians",
        "means",
        "scales",
        "missingValueEncoding",
      ]),
    };
  } else result.model = null;
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(inspect);
    else if (value && typeof value === "object")
      for (const [key, entry] of Object.entries(value)) {
        if (
          /gold|dataset|foldsHash|fittedRegionIds|evaluationHash|oofHash/iu.test(
            key,
          )
        )
          throw new Error("DEPLOYMENT_RANKER_CALIBRATION_LEAK");
        inspect(entry);
      }
    else if (
      typeof value === "string" &&
      (/\/Users\/|file:\/\/|[A-Z]:\\/u.test(value) ||
        /gold|human-reviewed/iu.test(value))
    )
      throw new Error("DEPLOYMENT_RANKER_PRIVATE_VALUE");
  };
  inspect(result);
  const content = {
    schemaVersion: "1.0.0",
    deploymentVersion: "c6.0.1.13-region-ranker-deployment-v1",
    ...result,
  };
  return c60113DeploymentRankerSchema.parse({
    ...content,
    semanticHash: c60113WorkspaceHash(content),
  });
}

export async function buildC60113ProspectiveTrialPackage(input: {
  workspaceDirectory: string;
  outputDirectory: string;
  frozenRanker: Record<string, unknown>;
  expectedWorkspaceDataHash: string;
  machinePackageFile: string;
  reviewPackageFreezeFile: string;
  regionFeatures: C60113RegionFeatures;
}): Promise<{
  workspaceDirectory: string;
  rankerHash: string;
  manifestHash: string;
}> {
  const source = await realpath(input.workspaceDirectory),
    destination = path.resolve(input.outputDirectory);
  const resolvedDestination = path.join(
    await realpath(path.dirname(destination)),
    path.basename(destination),
  );
  if (
    resolvedDestination === source ||
    resolvedDestination.startsWith(`${source}${path.sep}`)
  )
    throw new Error("TRIAL_PACKAGE_DESTINATION_MUST_BE_SEPARATE");
  const data = JSON.parse(
    await readFile(path.join(source, "review-data.json"), "utf8"),
  ) as C60112ReviewWorkspaceData;
  assertC60112ReviewWorkspaceData(data);
  if (
    !data.regionReviewV2 ||
    c60113WorkspaceHash(data) !== input.expectedWorkspaceDataHash
  )
    throw new Error("TRIAL_WORKSPACE_FREEZE_MISMATCH");
  const ranker = c60113DeploymentRanker(input.frozenRanker),
    rankerHash = String(ranker.semanticHash);
  const machineBytes = await readFile(input.machinePackageFile);
  const deploymentSelections = assertTrialDeployment({
    data,
    machineBytes,
    ranker,
    features: input.regionFeatures,
  });
  const compatibilityFreezeBytes = await readFile(
    input.reviewPackageFreezeFile,
  );
  const compatibilityFreeze = c60112ReviewPackageFreezeSchema.parse(
    JSON.parse(compatibilityFreezeBytes.toString("utf8")),
  );
  assertC60112FrozenWorkspaceData({
    freeze: compatibilityFreeze,
    workspaceData: data,
  });
  // A new package never inherits a review session, correction/audit log or trial history.
  await mkdir(destination, { recursive: false });
  const workspace = path.join(destination, "review-workspace");
  await writeC60112ReviewWorkspace({
    workspaceDirectory: workspace,
    reviewData: data,
  });
  const audio: { relativePath: string; sha256: string }[] = [];
  for (const region of data.regions) {
    assertC60112SafeRelativePath(region.audioPath, "trial audio");
    const from = await realpath(path.join(source, region.audioPath));
    if (
      !from.startsWith(`${source}${path.sep}audio${path.sep}`) ||
      !(await lstat(from)).isFile()
    )
      throw new Error("TRIAL_AUDIO_OUTSIDE_WORKSPACE");
    const bytes = await readFile(from),
      hash = createHash("sha256").update(bytes).digest("hex");
    if (region.audioSha256 !== hash)
      throw new Error("TRIAL_AUDIO_HASH_MISMATCH");
    const to = path.join(workspace, region.audioPath);
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, bytes, { flag: "wx", mode: 0o600 });
    audio.push({
      relativePath: `review-workspace/${region.audioPath}`,
      sha256: hash,
    });
  }
  await writeC60113PrivateJson(
    path.join(destination, "frozen-region-ranker.json"),
    ranker,
  );
  await writeFile(
    path.join(destination, "machine-subtitle-package.json"),
    machineBytes,
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(
    path.join(destination, "review-package-freeze.json"),
    compatibilityFreezeBytes,
    { flag: "wx", mode: 0o600 },
  );
  await writeC60113PrivateJson(
    path.join(destination, "machine-review-region-features.json"),
    input.regionFeatures,
  );
  const manifest = {
    schemaVersion: "1.0.0",
    packageVersion: "c6.0.1.13-prospective-package-v1",
    status: "AWAITING_ELIGIBILITY_DECLARATIONS",
    machineDraftHash: data.machineDraftHash,
    reviewPackageHash: data.reviewPackageSemanticHash,
    workspaceDataHash: input.expectedWorkspaceDataHash,
    workspaceExtensionHash: data.regionReviewV2.semanticHash,
    deploymentRankerHash: rankerHash,
    machinePackagePath: "machine-subtitle-package.json",
    reviewPackageFreezePath: "review-package-freeze.json",
    reviewPackageFreezeFileHash: createHash("sha256")
      .update(compatibilityFreezeBytes)
      .digest("hex"),
    machineFeaturesHash: input.regionFeatures.semanticHash,
    deploymentSelections,
    reviewWorkspacePath: "review-workspace",
    audio,
    inheritedSessionCount: 0,
    inheritedCorrectionCount: 0,
    inheritedPrivateEventCount: 0,
    realHumanSessionExecuted: false,
    humanReviewTimeMeasured: false,
  };
  const manifestHash = c60113WorkspaceHash(manifest);
  await writeC60113PrivateJson(
    path.join(destination, "trial-manifest.json"),
    c60113TrialPackageManifestSchema.parse({
      ...manifest,
      semanticHash: manifestHash,
    }),
  );
  await writeC60113PrivateJson(
    path.join(workspace, "session", "blank-review-session.json"),
    c60113BlankReviewSessionSchema.parse({
      schemaVersion: "1.0.0",
      status: "NOT_STARTED",
      reviewPackageHash: data.reviewPackageSemanticHash,
      machineDraftHash: data.machineDraftHash,
      decisionCount: 0,
      eventCount: 0,
      realHumanSessionExecuted: false,
    }),
  );
  const emptyLog = await open(
    path.join(workspace, "session", "review-trial-events.jsonl"),
    "wx",
    0o600,
  );
  await emptyLog.sync();
  await emptyLog.close();
  return { workspaceDirectory: workspace, rankerHash, manifestHash };
}

export async function validateC60113ProspectiveTrialPackage(directory: string) {
  const root = await realpath(directory);
  const manifest = c60113TrialPackageManifestSchema.parse(
    JSON.parse(await readFile(path.join(root, "trial-manifest.json"), "utf8")),
  );
  const { semanticHash, ...content } = manifest;
  if (c60113WorkspaceHash(content) !== semanticHash)
    throw new Error("TRIAL_PACKAGE_MANIFEST_HASH_MISMATCH");
  const workspaceDirectory = await realpath(
    path.join(root, manifest.reviewWorkspacePath),
  );
  if (workspaceDirectory !== path.join(root, "review-workspace"))
    throw new Error("TRIAL_WORKSPACE_SYMLINK_REJECTED");
  const loadPrivate = async (relative: string) => {
    const resolved = await realpath(path.join(root, relative));
    if (!resolved.startsWith(`${root}${path.sep}`))
      throw new Error("TRIAL_PACKAGE_REFERENCE_OUTSIDE_ROOT");
    return readFile(resolved);
  };
  const data = JSON.parse(
    (await loadPrivate("review-workspace/review-data.json")).toString("utf8"),
  ) as C60112ReviewWorkspaceData;
  assertC60112ReviewWorkspaceData(data);
  if (
    c60113WorkspaceHash(data) !== manifest.workspaceDataHash ||
    data.machineDraftHash !== manifest.machineDraftHash ||
    data.regionReviewV2?.semanticHash !== manifest.workspaceExtensionHash ||
    data.reviewPackageSemanticHash !== manifest.reviewPackageHash
  )
    throw new Error("TRIAL_WORKSPACE_FREEZE_MISMATCH");
  const ranker = c60113DeploymentRankerSchema.parse(
    JSON.parse(
      (await loadPrivate("frozen-region-ranker.json")).toString("utf8"),
    ),
  );
  const features = c60113RegionFeaturesSchema.parse(
    JSON.parse(
      (await loadPrivate("machine-review-region-features.json")).toString(
        "utf8",
      ),
    ),
  );
  if (
    ranker.semanticHash !== manifest.deploymentRankerHash ||
    features.semanticHash !== manifest.machineFeaturesHash
  )
    throw new Error("TRIAL_DEPLOYMENT_IDENTITY_MISMATCH");
  const selections = assertTrialDeployment({
    data,
    machineBytes: await loadPrivate(manifest.machinePackagePath),
    ranker,
    features,
  });
  const compatibilityFreezeBytes = await loadPrivate(
    manifest.reviewPackageFreezePath,
  );
  if (
    createHash("sha256").update(compatibilityFreezeBytes).digest("hex") !==
    manifest.reviewPackageFreezeFileHash
  )
    throw new Error("TRIAL_REVIEW_FREEZE_FILE_HASH_MISMATCH");
  assertC60112FrozenWorkspaceData({
    freeze: c60112ReviewPackageFreezeSchema.parse(
      JSON.parse(compatibilityFreezeBytes.toString("utf8")),
    ),
    workspaceData: data,
  });
  if (
    c60113WorkspaceHash(selections) !==
    c60113WorkspaceHash(manifest.deploymentSelections)
  )
    throw new Error("TRIAL_DEPLOYMENT_SELECTION_HASH_MISMATCH");
  if (manifest.audio.length !== data.regions.length)
    throw new Error("TRIAL_AUDIO_COVERAGE_MISMATCH");
  for (const audio of manifest.audio) {
    assertC60112SafeRelativePath(audio.relativePath, "trial audio");
    const region = data.regions.find(
      (region) => `review-workspace/${region.audioPath}` === audio.relativePath,
    );
    if (
      region?.audioSha256 !== audio.sha256 ||
      createHash("sha256")
        .update(await loadPrivate(audio.relativePath))
        .digest("hex") !== audio.sha256
    )
      throw new Error("TRIAL_AUDIO_HASH_MISMATCH");
  }
  return { manifest, data, ranker, features, workspaceDirectory };
}
