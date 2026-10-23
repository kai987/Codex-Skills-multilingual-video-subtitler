import path from "node:path";

import {
  compareC60InvestigationRuns,
  validateC60InvestigationRun,
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

const runA = path.resolve(requiredArgument("--run-a"));
const runBValue = argument("--run-b");
const runB = runBValue === undefined ? undefined : path.resolve(runBValue);
const validationA = await validateC60InvestigationRun(runA);
if (runB !== undefined) await compareC60InvestigationRuns(runA, runB);

console.log(
  JSON.stringify(
    {
      runA,
      runB: runB ?? null,
      artifactCountPerRun: validationA.artifactCount,
      semanticParityPassed: runB !== undefined,
      absolutePathLeakCount: validationA.absolutePathLeakCount,
      secretFindingCount: validationA.secretFindingCount,
      brokenRelativeReferenceCount: validationA.brokenRelativeReferenceCount,
    },
    null,
    2,
  ),
);
