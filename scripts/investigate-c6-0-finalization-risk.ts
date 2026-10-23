import path from "node:path";

import {
  buildC60Investigation,
  validateC60InvestigationRun,
  writeC60Investigation,
} from "./c6-0-finalization-risk-lib.js";

function argument(name: string, required = false): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && (value === undefined || value.startsWith("--"))) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return value;
}

function requiredArgument(name: string): string {
  const value = argument(name, true);
  if (value === undefined)
    throw new Error(`Missing required argument ${name}.`);
  return value;
}

const taskRoot = path.resolve(requiredArgument("--task"));
const outputRoot = path.resolve(requiredArgument("--output"));
const repoRoot = path.resolve(argument("--repo-root") ?? process.cwd());
const causalTask = argument("--causal-task");
const frozenTask = argument("--frozen-task");
const runLabel = argument("--run-label") ?? path.basename(outputRoot);

const investigationOptions = {
  taskRoot,
  outputRoot,
  repoRoot,
  runLabel,
  ...(causalTask === undefined
    ? {}
    : { causalTaskRoot: path.resolve(causalTask) }),
  ...(frozenTask === undefined
    ? {}
    : { frozenTaskRoot: path.resolve(frozenTask) }),
};
const artifacts = await buildC60Investigation(investigationOptions);
await writeC60Investigation(investigationOptions, artifacts);
const validation = await validateC60InvestigationRun(outputRoot);

console.log(
  JSON.stringify(
    {
      outputRoot,
      artifactCount: validation.artifactCount,
      observedBlockerCodeCount:
        artifacts.summary.counts.observedBlockerCodeCount,
      rootRiskFamilyCount: artifacts.summary.counts.rootRiskFamilyCount,
      componentCount: artifacts.componentRisk.summary.componentCount,
      positiveCurrentOutputDefectComponentCount:
        artifacts.componentRisk.summary
          .positiveCurrentOutputDefectComponentCount,
      safeRepairMissingComponentCount:
        artifacts.componentRisk.summary.safeRepairMissingComponentCount,
      reviewItemCount: artifacts.summary.counts.remainingReviewItemCount,
      implementation: artifacts.summary.decision.implementation,
      defaultRelease: artifacts.summary.decision.defaultRelease,
      modelInferenceCount: artifacts.summary.execution.modelInferenceCount,
      networkUsed: artifacts.summary.execution.networkUsed,
    },
    null,
    2,
  ),
);
