import path from "node:path";
import { parseArgs } from "node:util";

import { InputError } from "@mvl/shared";
import {
  auditC5161ShareableArtifacts,
  auditReviewDeliveryIntegrity,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: { task: { type: "string" } },
  strict: true,
});

if (values.task === undefined) {
  throw new InputError(
    "Usage: npm run audit:review-delivery-integrity -- --task <C5.17.2 task>",
  );
}

const delivery = await auditReviewDeliveryIntegrity(values.task);
const shareable = await auditC5161ShareableArtifacts(
  path.resolve(values.task, "shareable"),
);
const passed = delivery.passed && shareable.validationPassed;
process.stdout.write(
  `${JSON.stringify({ ok: passed, delivery, shareable }, null, 2)}\n`,
);
if (!passed) process.exitCode = 1;
