import { z } from "zod";
import { c611IoHeader } from "./c6-1-1-io-schemas.js";

export const C611_REGRESSION_STAGES = [
  "generate:schemas",
  "typecheck",
  "lint",
  "format:check",
  "build",
  "unit",
  "e2e",
  "targeted",
  "skill",
] as const;
const count = z.number().int().nonnegative();
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const c611RegressionEvidenceSchema = z
  .object({
    ...c611IoHeader,
    artifactType: z.literal("c6-1-1-regression-evidence"),
    sourceCodeAggregateHash: sha,
    checks: z
      .array(
        z
          .object({
            stage: z.enum(C611_REGRESSION_STAGES),
            command: z.string().min(1),
            exitCode: z.number().int(),
            durationMs: z.number().nonnegative(),
            logRelativePath: z.string().min(1),
            logSha256: sha,
            tests: z
              .object({ passed: count, failed: count, skipped: count })
              .strict()
              .nullable(),
            skipReasons: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .length(C611_REGRESSION_STAGES.length),
    freshModelInferenceAllowed: z.literal(false),
    sourceUnchangedDuringChecks: z.literal(true),
  })
  .strict();
export type C611RegressionEvidence = z.infer<
  typeof c611RegressionEvidenceSchema
>;
