import { parseArgs } from "node:util";

import { InputError } from "@mvl/shared";
import { auditC5161ShareableArtifacts } from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
  },
  strict: true,
});

if (values.input === undefined) {
  throw new InputError(
    "Usage: npm run audit:shareable-artifacts -- --input <task/shareable>",
  );
}

const result = await auditC5161ShareableArtifacts(values.input);
process.stdout.write(
  `${JSON.stringify({ ok: result.validationPassed, ...result }, null, 2)}\n`,
);
if (!result.validationPassed) process.exitCode = 1;
