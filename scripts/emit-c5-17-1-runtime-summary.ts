import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  c5171RuntimePreparationSummarySchema,
  forcedAlignmentRuntimeCapabilitySchema,
  sudachiRuntimeCapabilitySchema,
} from "@mvl/shared";

const { values } = parseArgs({
  options: {
    "mfa-runtime-manifest": { type: "string" },
    "sudachi-runtime-manifest": { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

if (
  values["mfa-runtime-manifest"] === undefined ||
  values["sudachi-runtime-manifest"] === undefined ||
  values.output === undefined
) {
  throw new InputError(
    "Usage: npm run emit:c5-17-1-runtime-summary -- --mfa-runtime-manifest <path> --sudachi-runtime-manifest <path> --output <json>",
  );
}

const mfa = forcedAlignmentRuntimeCapabilitySchema.parse(
  JSON.parse(
    await readFile(path.resolve(values["mfa-runtime-manifest"]), "utf8"),
  ) as unknown,
);
const sudachi = sudachiRuntimeCapabilitySchema.parse(
  JSON.parse(
    await readFile(path.resolve(values["sudachi-runtime-manifest"]), "utf8"),
  ) as unknown,
);
if (mfa.micromamba === undefined) {
  throw new InputError(
    "C5.17.1 runtime summary requires a pinned Micromamba identity.",
  );
}
const summary = c5171RuntimePreparationSummarySchema.parse({
  schemaVersion: "1.0.0",
  artifactType: "c5-17-1-runtime-preparation-summary",
  generatedAt: new Date().toISOString(),
  micromamba: mfa.micromamba,
  mfaRuntimeManifest: "mfa/runtime-manifest.json",
  mfaRuntimeIdentityHash: mfa.runtimeIdentityHash,
  mfaVersion: mfa.mfaVersion,
  environmentExplicitSpecSha256: mfa.environmentExplicitSpecSha256,
  sudachiRuntimeManifest: "sudachi/runtime-manifest.json",
  sudachiRuntimeIdentityHash: sudachi.runtimeIdentityHash,
  acousticModelIdentityHash: mfa.acousticModel.sha256,
  dictionaryModelIdentityHash: mfa.dictionaryModel.sha256,
  g2pModelIdentityHash: mfa.g2pModel.sha256,
  networkUsedDuringPreparation: true,
  offlineReplayRequired: true,
  shellProfileModified: false,
  systemPythonModified: false,
});
const output = path.resolve(values.output);
await atomicWriteJson(output, summary, { overwrite: true });
process.stdout.write(
  `${JSON.stringify({ ok: true, output, summary }, null, 2)}\n`,
);
