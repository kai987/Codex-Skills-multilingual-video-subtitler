import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { c60113RegionFeaturesSchema } from "@mvl/shared";
import {
  assertC60112ReviewWorkspaceData,
  startC60112ReviewWorkspaceServer,
  type C60112ReviewWorkspaceData,
} from "../packages/video-subtitler/src/review/c60112-review-workspace.js";
import { c60113WorkspaceHash } from "../packages/video-subtitler/src/review/c60113-review-workspace.js";
import {
  initializeC60113Trial,
  readC60113Trial,
  recordC60113TrialEvent,
  exportC60113Trial,
} from "../packages/video-subtitler/src/review/c60113-prospective-trial.js";
import {
  buildC60113ProspectiveTrialPackage,
  c60113DeploymentRanker,
} from "../packages/video-subtitler/src/review/c60113-prospective-trial-package.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    workspace: { type: "string" },
    freeze: { type: "string" },
    ranker: { type: "string" },
    "machine-package": { type: "string" },
    "region-features": { type: "string" },
    "source-media": { type: "string" },
    output: { type: "string" },
    "gold-unavailable": { type: "boolean" },
    "previous-human-subtitle-unavailable": { type: "boolean" },
    "reviewer-prior-exposure": { type: "boolean" },
    "reviewer-unexposed": { type: "boolean" },
    synthetic: { type: "boolean" },
    port: { type: "string", default: "0" },
  },
});
const action = positionals[0];
if (!action || !values.workspace || !values.freeze)
  throw new Error(
    "Usage: review-trial-cli <init|start|pause|resume|complete|validate|export|serve|package> --workspace PATH --freeze JSON [--ranker JSON --output PATH]",
  );
const workspace = path.resolve(values.workspace);
const data = JSON.parse(
  await readFile(path.join(workspace, "review-data.json"), "utf8"),
) as C60112ReviewWorkspaceData;
assertC60112ReviewWorkspaceData(data);
const freeze = JSON.parse(
  await readFile(path.resolve(values.freeze), "utf8"),
) as Record<string, unknown>;
const { semanticHash, ...freezeContent } = freeze;
if (semanticHash !== c60113WorkspaceHash(freezeContent))
  throw new Error("TRIAL_FREEZE_SEMANTIC_HASH_MISMATCH");
const expected =
  freeze.workspaceDataHash ??
  freeze.workspaceHash ??
  (freeze.artifactHashes as Record<string, unknown> | undefined)?.workspace;
if (expected !== c60113WorkspaceHash(data))
  throw new Error("TRIAL_WORKSPACE_FREEZE_MISMATCH");
let result: unknown;
if (action === "package") {
  if (
    !values.ranker ||
    !values.output ||
    !values["machine-package"] ||
    !values["region-features"]
  )
    throw new Error(
      "TRIAL_PACKAGE_REQUIRES_RANKER_MACHINE_PACKAGE_FEATURES_AND_OUTPUT",
    );
  result = await buildC60113ProspectiveTrialPackage({
    workspaceDirectory: workspace,
    outputDirectory: path.resolve(values.output),
    frozenRanker: JSON.parse(await readFile(values.ranker, "utf8")) as Record<
      string,
      unknown
    >,
    expectedWorkspaceDataHash: expected,
    machinePackageFile: path.resolve(values["machine-package"]),
    reviewPackageFreezeFile: path.resolve(values.freeze),
    regionFeatures: c60113RegionFeaturesSchema.parse(
      JSON.parse(await readFile(values["region-features"], "utf8")),
    ),
  });
} else if (action === "init") {
  if (
    !values.ranker ||
    (!values["reviewer-unexposed"] && !values["reviewer-prior-exposure"])
  )
    throw new Error("TRIAL_EXPLICIT_EXPOSURE_DECLARATION_REQUIRED");
  const ranker = JSON.parse(await readFile(values.ranker, "utf8")) as Record<
    string,
    unknown
  >;
  let deployment: Record<string, unknown>;
  if (ranker.deploymentVersion === "c6.0.1.13-region-ranker-deployment-v1") {
    const { semanticHash: expectedRanker, ...content } = ranker;
    if (expectedRanker !== c60113WorkspaceHash(content))
      throw new Error("TRIAL_RANKER_HASH_MISMATCH");
    deployment = ranker;
  } else deployment = c60113DeploymentRanker(ranker);
  result = await initializeC60113Trial({
    workspaceDirectory: workspace,
    data,
    rankerHash: String(deployment.semanticHash),
    declarations: {
      goldUnavailable: values["gold-unavailable"] ?? false,
      previousHumanSubtitleUnavailable:
        values["previous-human-subtitle-unavailable"] ?? false,
      reviewerPriorExposure: values["reviewer-prior-exposure"] ?? false,
    },
    synthetic: values.synthetic ?? false,
    ...(values["source-media"] === undefined
      ? {}
      : { sourceMediaFile: path.resolve(values["source-media"]) }),
  });
} else if (action === "serve") {
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("INVALID_PORT");
  const server = await startC60112ReviewWorkspaceServer({
    workspaceDirectory: workspace,
    expectedWorkspaceDataHash: expected,
    port,
  });
  result = { url: server.url, network: false };
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      void server.close();
    });
} else {
  const trial = await readC60113Trial(workspace, data);
  if (!trial) throw new Error("TRIAL_NOT_INITIALIZED");
  if (action === "validate") result = { valid: true, ...trial };
  else if (action === "export") {
    if (!values.output) throw new Error("TRIAL_EXPORT_OUTPUT_REQUIRED");
    result = await exportC60113Trial(
      workspace,
      path.resolve(values.output),
      data,
    );
  } else {
    const eventTypes = {
      start: "TRIAL_STARTED",
      pause: "TRIAL_PAUSED",
      resume: "TRIAL_RESUMED",
      complete: "TRIAL_COMPLETED",
    } as const;
    if (!(action in eventTypes)) throw new Error("UNKNOWN_TRIAL_COMMAND");
    result = await recordC60113TrialEvent({
      workspaceDirectory: workspace,
      data,
      event: {
        eventId: randomUUID(),
        eventType: eventTypes[action as keyof typeof eventTypes],
        expectedReviewPackageHash: data.reviewPackageSemanticHash,
        expectedRankerHash: trial.manifest.rankerHash,
        visible: false,
        focused: false,
        interaction: true,
        audioPlaying: false,
        regionId: null,
        itemId: null,
        candidateId: null,
        sourceInterval: null,
        manualCharactersEntered: 0,
        decisionType: null,
      },
    });
  }
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
