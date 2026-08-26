import { z } from "zod";

import { humanActionSchema } from "./finalization-schemas.js";
import { schemaVersionSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const reviewActionHardeningModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);

export const reviewActionValidationErrorSchema = z
  .object({
    code: z.string().min(1),
    reviewId: z.string().min(1).nullable(),
    action: humanActionSchema.nullable(),
    field: z.string().min(1).nullable(),
    message: z.string().min(1),
  })
  .strict();

export const reviewActionValidationReportSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("review-action-validation-report"),
    validationVersion: z.literal("C5.18-PHASE0"),
    policyVersion: z.literal("c5.18-review-action-semantics-v1"),
    generatedAt: z.iso.datetime(),
    mode: reviewActionHardeningModeSchema,
    reviewPackageHash: hashSchema,
    reviewVersion: z.string().min(1),
    itemCount: z.number().int().nonnegative(),
    resolutionCount: z.number().int().nonnegative(),
    allowedActionValidationCount: z.number().int().nonnegative(),
    invalidActionCount: z.number().int().nonnegative(),
    quarantinedSavedActionCount: z.number().int().nonnegative(),
    shortcutBypassCount: z.number().int().nonnegative(),
    downloadBlockedCount: z.number().int().nonnegative(),
    preFixReproduction: z
      .object({
        invalidAcceptShortcutGeneratedCount: z.number().int().nonnegative(),
        invalidResolutionDownloadAllowedCount: z.number().int().nonnegative(),
        shortcutActionBypassedAllowedActionsCount: z
          .number()
          .int()
          .nonnegative(),
      })
      .strict(),
    errors: z.array(reviewActionValidationErrorSchema),
    summary: z
      .object({
        invalidAcceptShortcutGeneratedCount: z.literal(0),
        invalidResolutionDownloadAllowedCount: z.literal(0),
        shortcutActionBypassedAllowedActionsCount: z.literal(0),
        noCandidateShortcutResolutionDelta: z.literal(0),
        coreBrowserPolicyHash: hashSchema,
        validationPassed: z.boolean(),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

export type ReviewActionHardeningMode = z.infer<
  typeof reviewActionHardeningModeSchema
>;
export type ReviewActionValidationError = z.infer<
  typeof reviewActionValidationErrorSchema
>;
export type ReviewActionValidationReport = z.infer<
  typeof reviewActionValidationReportSchema
>;
