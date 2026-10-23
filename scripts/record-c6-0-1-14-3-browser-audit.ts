import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { browserAudit143Schema } from "@mvl/shared";
import {
  durableJson141,
  fileHash141,
  readJson141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import { required141 } from "../packages/video-subtitler/src/review/c601141-policy.js";

export const browserCheckIds143 = [
  "PAGE_IDENTITY",
  "MEANINGFUL_CONTENT",
  "NO_FRAMEWORK_OVERLAY",
  "CONSOLE_HEALTH",
  "BUNDLE_SUMMARY_RENDERED",
  "CHILD_PROVENANCE_RENDERED",
  "OBLIGATION_GAPS_RENDERED",
  "FROZEN_CANDIDATE_COPY_RENDERED",
  "AUDIO_CONTROL_RESPONDS",
  "READ_ONLY_STATE_PRESERVED",
  "NO_SAVE_OR_CANONICAL_INSERT_CONTROL",
  "RESPONSIVE_LAYOUT",
] as const;

const observationsSchema = z
  .object({
    checkedAt: z.iso.datetime(),
    checks: z
      .array(
        z
          .object({
            id: z.enum(browserCheckIds143),
            passed: z.boolean(),
            detail: z.string(),
          })
          .strict(),
      )
      .length(browserCheckIds143.length),
    consoleErrorCount: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.checks.map((c) => c.id)).size === browserCheckIds143.length,
    "Every browser check must be recorded exactly once",
  );

const { values } = parseArgs({
  strict: true,
  options: {
    workspace: { type: "string" },
    observations: { type: "string" },
    output: { type: "string" },
  },
});
const arg = (key: "workspace" | "observations" | "output") =>
  path.resolve(required141(values[key], `--${key} required`));
const workspace = arg("workspace"),
  observations = observationsSchema.parse(
    await readJson141(arg("observations")),
  );
const data = path.join(workspace, "review-data.json"),
  javascript = path.join(workspace, "assets/review.js");
const artifact = browserAudit143Schema.parse({
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-14-3-browser-read-only-acceptance",
  visibility: "LOCAL_ONLY",
  checkedAt: observations.checkedAt,
  workspaceDataByteHash: await fileHash141(data),
  workspaceJavascriptByteHash: await fileHash141(javascript),
  checks: observations.checks,
  consoleErrorCount: observations.consoleErrorCount,
  sessionBefore: null,
  sessionAfter: null,
  savedHumanDecisionCount: 0,
  humanTrialStarted: false,
  passed:
    observations.consoleErrorCount === 0 &&
    observations.checks.every((c) => c.passed),
});
await durableJson141(arg("output"), artifact);
console.log(
  JSON.stringify(
    {
      passed: artifact.passed,
      checkCount: artifact.checks.length,
      consoleErrorCount: artifact.consoleErrorCount,
    },
    null,
    2,
  ),
);
