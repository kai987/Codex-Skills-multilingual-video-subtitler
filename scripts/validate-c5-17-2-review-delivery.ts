import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  c5172ReviewDeliveryReplaySummarySchema,
} from "@mvl/shared";

const { values } = parseArgs({
  options: {
    first: { type: "string" },
    second: { type: "string" },
    left: { type: "string" },
    right: { type: "string" },
  },
  strict: true,
});

const first = values.first ?? values.left;
const second = values.second ?? values.right;
if (first === undefined || second === undefined) {
  throw new InputError(
    "Usage: npm run validate:c5-17-2-review-delivery -- --first <task-a> --second <task-b>",
  );
}

async function load(task: string) {
  return c5172ReviewDeliveryReplaySummarySchema.parse(
    JSON.parse(
      await readFile(
        path.join(task, "c5-17-2-review-delivery-replay-summary.json"),
        "utf8",
      ),
    ),
  );
}

const [left, right] = await Promise.all([load(first), load(second)]);
const comparisons = {
  reviewPackageSemanticIdentity:
    left.reviewPackageSemanticHash === right.reviewPackageSemanticHash,
  finalizationSemanticHash:
    left.finalizationSemanticHash === right.finalizationSemanticHash,
  evidenceReconciliationHash:
    left.evidenceReconciliationHash === right.evidenceReconciliationHash,
  deliveryIntegritySemanticHash:
    left.deliveryIntegritySemanticHash === right.deliveryIntegritySemanticHash,
  canonicalCueHash: left.canonicalCueHashAfter === right.canonicalCueHashAfter,
  canonicalTimingHash:
    left.canonicalTimingHashAfter === right.canonicalTimingHashAfter,
  presentationHash: left.presentationHashAfter === right.presentationHashAfter,
  reviewPageAssetsHash:
    left.reviewPageAssetsHash === right.reviewPageAssetsHash,
  reviewAudioHashesStable:
    JSON.stringify(left.reviewAudioHashes) ===
    JSON.stringify(right.reviewAudioHashes),
};
const passed = Object.values(comparisons).every(Boolean);
process.stdout.write(
  `${JSON.stringify({ ok: passed, comparisons }, null, 2)}\n`,
);
if (!passed) process.exitCode = 1;
