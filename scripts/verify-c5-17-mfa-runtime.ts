import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { InputError } from "@mvl/shared";
import { verifyMfaRuntimeCapability } from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    "runtime-manifest": { type: "string" },
  },
  strict: true,
});

if (values["runtime-manifest"] === undefined) {
  throw new InputError("verify:c5-17-mfa-runtime requires --runtime-manifest.");
}
const manifestPath = path.resolve(values["runtime-manifest"]);
const capability = verifyMfaRuntimeCapability(
  JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
);
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      backend: capability.backend,
      mfaVersion: capability.mfaVersion,
      runtimeIdentityHash: capability.runtimeIdentityHash,
      commandCapabilities: capability.commandCapabilities,
      acousticModel: capability.acousticModel,
      dictionaryModel: capability.dictionaryModel,
      g2pModel: capability.g2pModel,
      networkUsedDuringAlignment: capability.networkUsedDuringAlignment,
      shareable: capability.shareable,
    },
    null,
    2,
  )}\n`,
);
