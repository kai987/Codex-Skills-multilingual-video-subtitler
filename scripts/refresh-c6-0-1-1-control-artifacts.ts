import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  blindGenerationInputManifestSchema,
  InputError,
} from "@mvl/shared";
import {
  auditBlindRunProvenance,
  buildMachineBaselineEvidenceCoverage,
  createBlindOutputFreeze,
  createMachineShadowPolicy,
  evaluateMachineShadowFinalization,
} from "@mvl/video-subtitler";

if (process.argv[2] !== "--output" || process.argv[3] === undefined) {
  throw new InputError("Usage: --output <machine-run-directory>.");
}
const outputPath = path.resolve(process.argv[3]);
const manifest = blindGenerationInputManifestSchema.parse(
  JSON.parse(
    await readFile(
      path.join(outputPath, "blind-generation-input-manifest.json"),
      "utf8",
    ),
  ) as unknown,
);
const generatedAt = new Date().toISOString();
const provenance = await auditBlindRunProvenance({
  taskDirectory: outputPath,
  generatedAt,
  manifest,
});
if (!provenance.passed) {
  throw new InputError("Refreshed blind provenance audit failed.", {
    violations: provenance.isolationViolations,
  });
}
await atomicWriteJson(
  path.join(outputPath, "blind-provenance-audit.json"),
  provenance,
  { overwrite: true },
);
const evidence = await buildMachineBaselineEvidenceCoverage({
  taskDirectory: outputPath,
  generatedAt,
  manifest,
});
const policy = createMachineShadowPolicy();
const shadow = evaluateMachineShadowFinalization({
  generatedAt,
  manifest,
  provenance,
  evidence,
  policy,
});
await Promise.all([
  atomicWriteJson(
    path.join(outputPath, "machine-baseline-evidence-coverage.json"),
    evidence,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(outputPath, "machine-shadow-finalization-policy.json"),
    policy,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(outputPath, "machine-shadow-finalization.json"),
    shadow,
    { overwrite: true },
  ),
]);
const freeze = await createBlindOutputFreeze({
  taskDirectory: outputPath,
  freezeTimestamp: new Date().toISOString(),
});
await atomicWriteJson(
  path.join(outputPath, "blind-output-freeze.json"),
  freeze,
  {
    overwrite: true,
  },
);
console.log(
  JSON.stringify(
    {
      outputPath,
      provenancePassed: provenance.passed,
      modelInferenceCount: evidence.modelExecutionCounts.modelInferenceCount,
      shadowMachineOutcome: shadow.shadowMachineOutcome,
      freezeSemanticHash: freeze.freezeSemanticHash,
    },
    null,
    2,
  ),
);
