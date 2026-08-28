import { readFile } from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, blindOutputFreezeSchema } from "@mvl/shared";
import {
  createBlindOutputFreeze,
  finalizeC6018ShareableArtifacts,
} from "@mvl/video-subtitler";

const values = process.argv.slice(2);
const runIndex = values.indexOf("--run");
const stageIndex = values.indexOf("--stage");
const runValue = runIndex < 0 ? undefined : values[runIndex + 1];
const stageValue = stageIndex < 0 ? undefined : values[stageIndex + 1];
if (runValue === undefined || runValue === "")
  throw new Error("Missing --run.");
if (stageValue !== "final-a" && stageValue !== "final-b") {
  throw new Error("--stage must be final-a or final-b.");
}
const run = path.resolve(runValue);
const oldFreeze = blindOutputFreezeSchema.parse(
  JSON.parse(
    await readFile(path.join(run, "blind-output-freeze.json"), "utf8"),
  ) as unknown,
);
const shareable = await finalizeC6018ShareableArtifacts({
  taskRoot: run,
  stage: stageValue,
  originalFreshInferenceCount: 36,
});
if (!shareable.audit.validationPassed) {
  throw new Error("C6.0.1.8 shareable audit failed.");
}
const freeze = await createBlindOutputFreeze({
  taskDirectory: run,
  freezeTimestamp: oldFreeze.freezeTimestamp,
});
await atomicWriteJson(path.join(run, "blind-output-freeze.json"), freeze, {
  overwrite: true,
});
console.log(
  JSON.stringify(
    {
      run,
      stage: stageValue,
      artifactCount: shareable.manifest.summary.artifactCount,
      validationPassed: shareable.audit.validationPassed,
      absolutePathLeakCount: shareable.audit.absolutePathLeakCount,
      prohibitedSecretCount: shareable.audit.prohibitedSecretCount,
      brokenRelativeReferenceCount:
        shareable.audit.brokenRelativeReferenceCount,
      freezeHash: freeze.freezeSemanticHash,
    },
    null,
    2,
  ),
);
