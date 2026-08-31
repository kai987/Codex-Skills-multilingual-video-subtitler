import path from "node:path";
import { z } from "zod";
import { c601141MachineCodeSnapshotSchema } from "@mvl/shared";
import { machineCodeSnapshot141 } from "./c601141-code-freeze.js";
import {
  readJson141,
  fileHash141,
  safeRelative141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

// This exception is confined to validation tooling and the emitted policy
// schema. It never accepts changes to machine producers, Zod contracts,
// thresholds, runtime code, inputs, projections or evaluation matching rules.
const validationOnlyPaths = new Set([
  "scripts/generate-schemas.ts",
  "schemas/c6-0-1-14-1-policy.schema.json",
  "scripts/validate-c6-0-1-14-1-runs.ts",
  "scripts/lib/c601141-validation-remediation.ts",
  "tests/c6-0-1-14-1-acceptance.test.ts",
]);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const changedFile = z
  .object({
    relativePath: z.string(),
    beforeSha256: hash.nullable(),
    afterSha256: hash,
  })
  .strict();
export const schemaRemediationManifest141 = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-1-validation-only-schema-remediation"),
    visibility: z.literal("LOCAL_ONLY"),
    remediationKind: z.literal("EXPORTED_CLOSED_PROVIDER_TUPLE_BOUND_REPAIR"),
    recordedAt: z.iso.datetime(),
    frozenCodeSnapshotHash: hash,
    acceptanceCodeSnapshotHash: hash,
    beforePolicySchemaRelativePath: z.literal("before-policy.schema.json"),
    changedFiles: z.array(changedFile).min(1),
    machineRuntimeMutationCount: z.literal(0),
    machineArtifactMutationCount: z.literal(0),
    goldDrivenPolicyChangeCount: z.literal(0),
  })
  .strict();

export function assertValidationOnlyDelta141(
  before: { relativePath: string; sha256: string }[],
  after: { relativePath: string; sha256: string }[],
  expected: z.infer<typeof changedFile>[],
) {
  const a = new Map(before.map((v) => [v.relativePath, v.sha256])),
    b = new Map(after.map((v) => [v.relativePath, v.sha256]));
  const changes = [...new Set([...a.keys(), ...b.keys()])]
    .sort()
    .filter((file) => a.get(file) !== b.get(file))
    .map((file) => ({
      relativePath: file,
      beforeSha256: a.get(file) ?? null,
      afterSha256: required141(b.get(file)),
    }));
  if (
    !changes.length ||
    changes.some((v) => !validationOnlyPaths.has(v.relativePath)) ||
    hash141(changes) !==
      hash141(
        [...expected].sort((a, b) =>
          a.relativePath.localeCompare(b.relativePath),
        ),
      )
  )
    throw new Error(
      "C601141_POST_FREEZE_DELTA_IS_NOT_APPROVED_VALIDATION_ONLY",
    );
  return changes;
}

export async function verifyValidationOnlyRemediation141(
  root: string,
  snapshotPath: string,
  manifestPath: string,
) {
  const before = c601141MachineCodeSnapshotSchema.parse(
      await readJson141(snapshotPath),
    ),
    after = await machineCodeSnapshot141(root),
    manifest = schemaRemediationManifest141.parse(
      await readJson141(manifestPath),
    );
  if (
    manifest.frozenCodeSnapshotHash !== before.semanticHash ||
    manifest.acceptanceCodeSnapshotHash !== after.semanticHash
  )
    throw new Error("C601141_VALIDATION_REMEDIATION_SNAPSHOT_BINDING_FAILED");
  const changes = assertValidationOnlyDelta141(
    before.files,
    after.files,
    manifest.changedFiles,
  );
  const policyPath = "schemas/c6-0-1-14-1-policy.schema.json",
    originalPolicyPath = path.resolve(
      path.dirname(manifestPath),
      manifest.beforePolicySchemaRelativePath,
    );
  safeRelative141(path.dirname(manifestPath), originalPolicyPath);
  if (
    (await fileHash141(originalPolicyPath)) !==
    required141(before.files.find((v) => v.relativePath === policyPath)).sha256
  )
    throw new Error("C601141_ORIGINAL_POLICY_SCHEMA_HASH_MISMATCH");
  const original = await readJson141(originalPolicyPath),
    repaired = (await readJson141(path.join(root, policyPath))) as {
      properties: {
        asr: {
          properties: {
            providers: {
              prefixItems: unknown[];
              minItems?: number;
              maxItems?: number;
            };
          };
        };
      };
    };
  const tuple = repaired.properties.asr.properties.providers;
  if (
    tuple.prefixItems.length !== 2 ||
    tuple.minItems !== 2 ||
    tuple.maxItems !== 2
  )
    throw new Error("C601141_CLOSED_PROVIDER_TUPLE_BOUNDS_INVALID");
  delete tuple.minItems;
  delete tuple.maxItems;
  if (hash141(original) !== hash141(repaired))
    throw new Error(
      "C601141_POLICY_SCHEMA_REMEDIATION_CHANGED_OTHER_SEMANTICS",
    );
  return {
    frozenCodeSnapshotHash: before.semanticHash,
    acceptanceCodeSnapshotHash: after.semanticHash,
    manifestByteHash: await fileHash141(manifestPath),
    changedFiles: changes,
    unchangedFileCount:
      before.files.length -
      changes.filter((v) => v.beforeSha256 !== null).length,
    fullCodeByteParity: false,
    machineRuntimeByteParity: true,
    policyValueUnchanged: true,
    onlyAddedMissingClosedTupleBounds: true,
  };
}
