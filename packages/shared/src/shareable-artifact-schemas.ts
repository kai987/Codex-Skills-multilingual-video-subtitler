import { z } from "zod";

import { schemaVersionSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/])(?!\\\\).+/u, "Path must be relative.");

export const shareableArtifactManifestItemSchema = z
  .object({
    sourceArtifactName: z.string().min(1),
    sourceArtifactHash: hashSchema,
    shareablePath: relativePathSchema,
    shareableHash: hashSchema,
    schemaName: z.string().min(1),
    pathReplacementCount: z.number().int().nonnegative(),
    secretRedactionCount: z.number().int().nonnegative(),
    absolutePathLeakCount: z.number().int().nonnegative(),
    prohibitedSecretCount: z.number().int().nonnegative().default(0),
    validationPassed: z.boolean(),
  })
  .strict();

export const shareableArtifactManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("shareable-artifact-manifest"),
    policyVersion: z.enum([
      "c5.16.1-shareable-artifact-policy-v1",
      "c5.17-shareable-artifact-policy-v1",
      "c5.17.1-shareable-artifact-policy-v1",
      "c5.17.2-shareable-artifact-policy-v1",
      "c5.18-shareable-artifact-policy-v1",
      "c5.18.1-shareable-artifact-policy-v1",
    ]),
    generatedAt: z.iso.datetime(),
    taskIdentityHash: hashSchema,
    pathPolicy: z.literal("shareable-relative-only"),
    shareable: z.literal(true),
    items: z.array(shareableArtifactManifestItemSchema),
    summary: z
      .object({
        artifactCount: z.number().int().nonnegative(),
        validationPassedCount: z.number().int().nonnegative(),
        absolutePathLeakCount: z.number().int().nonnegative(),
        prohibitedSecretCount: z.number().int().nonnegative(),
        pathReplacementCount: z.number().int().nonnegative(),
        secretRedactionCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = {
      artifactCount: value.items.length,
      validationPassedCount: value.items.filter((item) => item.validationPassed)
        .length,
      absolutePathLeakCount: value.items.reduce(
        (sum, item) => sum + item.absolutePathLeakCount,
        0,
      ),
      prohibitedSecretCount: value.items.reduce(
        (sum, item) => sum + item.prohibitedSecretCount,
        0,
      ),
      pathReplacementCount: value.items.reduce(
        (sum, item) => sum + item.pathReplacementCount,
        0,
      ),
      secretRedactionCount: value.items.reduce(
        (sum, item) => sum + item.secretRedactionCount,
        0,
      ),
    };
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (value.summary[field as keyof typeof expected] !== expectedValue) {
        context.addIssue({
          code: "custom",
          path: ["summary", field],
          message: `Manifest summary ${field} does not match its items.`,
        });
      }
    }
  });

export const shareableExternalFileSchema = z
  .object({
    role: z.string().min(1),
    fileName: z.string().min(1),
    size: z.number().int().nonnegative(),
    mtimeMs: z.number().nonnegative(),
    sha256: hashSchema,
    path: z.null(),
  })
  .strict();

export const c5161ShareableExecutionSummarySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-16-1-shareable-execution-summary"),
    generatedAt: z.iso.datetime(),
    taskIdentityHash: hashSchema,
    pathPolicy: z.literal("shareable-relative-only"),
    shareable: z.literal(true),
    localOnlySource: z
      .object({
        fileName: z.string().min(1),
        sha256: hashSchema,
        path: z.null(),
      })
      .strict(),
    internalArtifacts: z.array(relativePathSchema),
    externalFiles: z.array(shareableExternalFileSchema),
    execution: z.record(z.string(), z.unknown()),
    outcome: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ShareableArtifactManifest = z.infer<
  typeof shareableArtifactManifestSchema
>;
export type C5161ShareableExecutionSummary = z.infer<
  typeof c5161ShareableExecutionSummarySchema
>;
