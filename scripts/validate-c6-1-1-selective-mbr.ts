import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { atomicWriteJson } from "@mvl/shared";
import { validateC611Artifacts } from "../packages/video-subtitler/src/consensus/selective-mbr-artifact-validator.js";

const { values } = parseArgs({
  options: {
    a: { type: "string" },
    b: { type: "string" },
    repository: { type: "string" },
    output: { type: "string" },
    network: { type: "string" },
    "regression-evidence": { type: "string" },
  },
});
function required(key: "a" | "b" | "repository" | "output"): string {
  const value = values[key];
  if (!value?.trim()) throw new Error(`Missing --${key}`);
  return path.resolve(value);
}
if (values.network !== "off")
  throw new Error("C611_VALIDATION_REQUIRES_NETWORK_OFF");
const a = required("a"),
  b = required("b"),
  repository = required("repository"),
  output = required("output");
for (const root of [a, b, repository]) {
  const relative = path.relative(root, output);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw new Error("C611_VALIDATION_OUTPUT_MUST_NOT_MUTATE_INPUT_ROOT");
}
// Exclusive output creation: a failed/previous acceptance is never overwritten.
await mkdir(output, { recursive: false });
const result = await validateC611Artifacts({
  a,
  b,
  repository,
  ...(values["regression-evidence"]
    ? { regressionEvidence: path.resolve(values["regression-evidence"]) }
    : {}),
  progress: (check) =>
    process.stdout.write(
      `${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.observed}\n`,
    ),
});
await atomicWriteJson(path.join(output, "c6-1-1-validation.json"), result);
process.stdout.write(
  `Engineering acceptance: ${result.engineeringPassed ? "PASSED" : "FAILED"}; quality gate: ${result.qualityGateStatus}\nRaw source/Gold reopened by validator: false/false. C6.0.2: HOLD.\n`,
);
if (!result.engineeringPassed) process.exitCode = 1;
