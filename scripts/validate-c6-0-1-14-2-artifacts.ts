import path from "node:path";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import type { z } from "zod";
import { files141 } from "./lib/c601141-freeze.js";
import {
  readJson141,
  durableJson141,
  safeRelative141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
const { values } = parseArgs({
  strict: true,
  options: { state: { type: "string" }, output: { type: "string" } },
});
const state = shared.state142Schema.parse(
    await readJson141(required141(values.state)),
  ),
  output = path.resolve(required141(values.output));
const schemas: Record<string, z.ZodType> = {
  ...shared.c601142SelectionSchemas,
  ...shared.c601142AcousticSchemas,
  ...shared.c601142ReviewSchemas,
  ...shared.c601142AcceptanceSchemas,
  ...shared.c601142LocalSchemas,
};
const aliases: Record<string, string> = {
  "c6-0-1-14-2-policy.json": "c6-0-1-14-2-policy",
  "c6-0-1-14-2-run-paths.local-only.json": "c6-0-1-14-2-run-paths",
  "detector-execution.local-only.json": "c6-0-1-14-2-detector-execution",
  "request.local-only.json": "c6-0-1-14-2-detector-request",
  "result-receipt.json": "c6-0-1-14-2-detector-result-receipt",
  "cache-binding.json": "c6-0-1-14-2-detector-cache-binding",
  "execution-started.json": "c6-0-1-14-2-detector-execution-started",
  "transport-receipt.local-only.json": "c6-0-1-14-2-detector-transport",
  "dsp-request.local-only.json": "c6-0-1-14-2-dsp-request",
  "dsp-measurements.local-only.json": "c6-0-1-14-2-dsp-measurements",
  "acoustic-features-request.local-only.json":
    "c6-0-1-14-2-acoustic-features-request",
  "c601142-review-delivery-selection.json": "c6-0-1-14-2-delivery-selection",
  "machine-code-snapshot.json": "c6-0-1-14-2-machine-code-snapshot",
  "machine-coverage-projections.json":
    "c6-0-1-14-2-machine-coverage-projections",
};
const compiled = new Map<string, ReturnType<typeof shared.compileJsonSchema>>(),
  results: z.infer<typeof shared.artifactPreflight142Schema>["results"] = [];
const validate = async (
  file: string,
  schemaId: string,
  value: unknown,
  suffix = "",
) => {
  const parsed = required141(schemas[schemaId]).safeParse(value);
  let validator = compiled.get(schemaId);
  if (!validator) {
    validator = shared.compileJsonSchema(
      (await readJson141(
        path.join("schemas", `${schemaId}.schema.json`),
      )) as object,
    );
    compiled.set(schemaId, validator);
  }
  const json = validator(value);
  results.push({
    relativePath: safeRelative141(state.config.outputRoot, file) + suffix,
    schemaId,
    valid: parsed.success && json,
    errorCount:
      (parsed.success ? 0 : parsed.error.issues.length) +
      (json ? 0 : (validator.errors?.length ?? 1)),
  });
  if (!parsed.success || !json)
    console.error(
      JSON.stringify({
        file: safeRelative141(state.config.outputRoot, file),
        schemaId,
        zod: parsed.success ? [] : parsed.error.issues,
        json: validator.errors,
      }),
    );
};
for (const [role, directory] of Object.entries(state.outputs)) {
  if (["evaluation", "validation"].includes(role)) continue;
  for (const file of (await files141(directory)).filter((f) =>
    f.endsWith(".json"),
  )) {
    const value = await readJson141(file),
      object =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
    let schemaId =
      typeof object?.artifactType === "string"
        ? object.artifactType
        : aliases[path.basename(file)];
    if (!schemaId && object?.clusterTargetId && object.requestIdentityHash)
      schemaId = "c6-0-1-14-2-asr-request-result";
    if (!schemaId && object?.jobHash && object.scoreTrack !== undefined)
      schemaId = "c6-0-1-14-2-detector-run";
    if (
      !schemaId &&
      object?.rawOutput !== undefined &&
      object.decoder &&
      object.wallClockSeconds !== undefined
    )
      schemaId = "c6-0-1-14-2-asr-raw-result";
    if (schemaId && schemas[schemaId]) await validate(file, schemaId, value);
    if (object?.detectorCeilingReviewV2)
      await validate(
        file,
        "c6-0-1-14-2-workspace-extension",
        object.detectorCeilingReviewV2,
        "#detectorCeilingReviewV2",
      );
  }
}
const artifact = shared.artifactPreflight142Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-2-machine-artifact-preflight",
    visibility: "LOCAL_ONLY",
    checkedAt: new Date().toISOString(),
    results,
    passed: results.length > 0 && results.every((r) => r.valid),
    goldReadCount: 0,
    inferenceCount: 0,
  }),
);
await durableJson141(output, artifact);
console.log(
  JSON.stringify({
    passed: artifact.passed,
    instances: results.length,
    schemas: new Set(results.map((r) => r.schemaId)).size,
    goldReadCount: 0,
    inferenceCount: 0,
  }),
);
if (!artifact.passed) process.exitCode = 1;
