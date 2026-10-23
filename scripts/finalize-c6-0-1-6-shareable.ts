import { readFile } from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, blindOutputFreezeSchema } from "@mvl/shared";
import {
  createBlindOutputFreeze,
  finalizeC6016ShareableArtifacts,
} from "@mvl/video-subtitler";

const argv = process.argv.slice(2);
const index = argv.indexOf("--run");
const runValue = index < 0 ? undefined : argv[index + 1];
if (runValue === undefined || runValue === "")
  throw new Error("Missing --run.");
const run = path.resolve(runValue);
const oldFreeze = blindOutputFreezeSchema.parse(
  JSON.parse(
    await readFile(path.join(run, "blind-output-freeze.json"), "utf8"),
  ) as unknown,
);
const shareable = await finalizeC6016ShareableArtifacts({ taskRoot: run });
if (!shareable.audit.validationPassed) {
  throw new Error("C6.0.1.6 shareable audit failed.");
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
