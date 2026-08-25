import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  subtitleOverlapAcousticResolutionSchema,
} from "@mvl/shared";
import { auditLegacyOverlapAttempt } from "@mvl/transcription-core";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    artifact: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

const inputValue = values.input ?? values.artifact;
if (inputValue === undefined) {
  throw new InputError(
    "Usage: npm run audit:c5-15-token-timestamps -- --input <subtitle-overlap-acoustic-resolution.json> [--output <audit.json>]",
  );
}
if (
  values.input !== undefined &&
  values.artifact !== undefined &&
  path.resolve(values.input) !== path.resolve(values.artifact)
) {
  throw new InputError(
    "--input and legacy --artifact must identify the same file.",
  );
}

const artifactPath = path.resolve(inputValue);
const artifact = subtitleOverlapAcousticResolutionSchema.parse(
  JSON.parse(await readFile(artifactPath, "utf8")) as unknown,
);
const componentById = new Map(
  artifact.components.map((component) => [component.componentId, component]),
);
const perAttempt = artifact.attempts.map((attempt) => {
  const component = componentById.get(attempt.componentId);
  return {
    attemptId: attempt.attemptId,
    profile: attempt.profile,
    ...auditLegacyOverlapAttempt(
      attempt,
      undefined,
      component?.extractionInterval,
    ),
  };
});
const summary = {
  segmentTokenGroupCount: perAttempt.reduce(
    (sum, value) => sum + value.segmentTokenGroupCount,
    0,
  ),
  containmentFailureCount50ms: perAttempt.reduce(
    (sum, value) => sum + value.containmentFailureCount50ms,
    0,
  ),
  containmentFailureCountTrustTolerance: perAttempt.reduce(
    (sum, value) => sum + value.containmentFailureCountTrustTolerance,
    0,
  ),
  zeroDurationTokenCount: perAttempt.reduce(
    (sum, value) => sum + value.zeroDurationTokenCount,
    0,
  ),
  boundaryClampedTokenCount: perAttempt.reduce(
    (sum, value) => sum + value.boundaryClampedTokenCount,
    0,
  ),
  maximumObservedDriftSeconds: Math.max(
    0,
    ...perAttempt.map((value) => value.maximumObservedDriftSeconds),
  ),
};
const result = {
  schemaVersion: "1.0.0",
  auditType: "C5.15 legacy token timestamp containment",
  sourceArtifact: path.basename(artifactPath),
  perAttempt,
  summary,
};

if (values.output !== undefined) {
  await atomicWriteJson(path.resolve(values.output), result, {
    overwrite: false,
  });
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
