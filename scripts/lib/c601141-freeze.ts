import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  c601141MachineFreezeSchema,
  type C601141Policy,
  type C60114SourceIdentity,
  type C601141MachineFreeze,
} from "@mvl/shared";
import {
  fileHash141,
  readJson141,
  durableJson141,
  identity141,
  safeRelative141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hashed141,
  header141,
  assertHash141,
  hash141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

export async function files141(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.name === ".DS_Store") continue;
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("C601141_MACHINE_ARTIFACT_SYMLINK_FORBIDDEN");
    if (entry.isDirectory()) result.push(...(await files141(file)));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

export async function freeze141(input: {
  root: string;
  file: string;
  policy: C601141Policy;
  source: C60114SourceIdentity;
  sourcePath: string;
  sourceBefore: C601141MachineFreeze["sourceReadOnlyIdentity"];
  artifactFiles: string[];
  protectedFiles: string[];
  canonicalTextHash: string;
  canonicalTimingHash: string;
  presentationHash: string;
  stage: C601141MachineFreeze["stage"];
  acquisitionSummary?: C601141MachineFreeze["acquisitionSummary"];
}) {
  const sourceAfter = await identity141(input.sourcePath);
  if (hash141(sourceAfter) !== hash141(input.sourceBefore))
    throw new Error("C601141_SOURCE_READ_ONLY_IDENTITY_CHANGED");
  const artifacts = [];
  for (const file of [...new Set(input.artifactFiles)].sort()) {
    const relativePath = safeRelative141(input.root, file);
    if (
      /(?:^|\/)(?:gold|evaluation|human-correction|session)(?:[./-]|$)/iu.test(
        relativePath,
      )
    )
      throw new Error("C601141_FREEZE_NON_MACHINE_INPUT");
    let semanticHash: string | null = null;
    if (file.endsWith(".json")) {
      const value = await readJson141(file);
      semanticHash =
        value &&
        typeof value === "object" &&
        "semanticHash" in value &&
        typeof value.semanticHash === "string"
          ? value.semanticHash
          : hash141(value);
    }
    artifacts.push({
      relativePath,
      byteHash: await fileHash141(file),
      semanticHash,
    });
  }
  const protectedMachineFiles = [];
  for (const file of [...new Set(input.protectedFiles)].sort())
    protectedMachineFiles.push({
      relativePath: safeRelative141(input.root, file),
      byteHash: await fileHash141(file),
    });
  const freeze = c601141MachineFreezeSchema.parse(
    hashed141({
      ...header141(input.policy, input.source),
      artifactType: "c6-0-1-14-1-machine-speech-inventory-freeze",
      stage: input.stage,
      freezeCompletedAt: new Date().toISOString(),
      artifacts,
      protectedMachineFiles,
      sourceReadOnlyIdentity: sourceAfter,
      canonicalTextHash: input.canonicalTextHash,
      canonicalTimingHash: input.canonicalTimingHash,
      presentationHash: input.presentationHash,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      presentationMutationCount: 0,
      goldReadCountBeforeFreeze: 0,
      rankerRetrained: false,
      oofTrainingRun: false,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
      ...(input.acquisitionSummary
        ? { acquisitionSummary: input.acquisitionSummary }
        : {}),
    }),
  );
  await durableJson141(input.file, freeze);
  return freeze;
}
export async function verifyFreeze141(
  root: string,
  file: string,
  sourcePath?: string,
) {
  const freeze = c601141MachineFreezeSchema.parse(await readJson141(file));
  assertHash141(freeze);
  for (const entry of [...freeze.artifacts, ...freeze.protectedMachineFiles]) {
    const absolute = path.resolve(root, entry.relativePath);
    safeRelative141(root, absolute);
    if ((await fileHash141(absolute)) !== entry.byteHash)
      throw new Error(`C601141_FROZEN_ARTIFACT_CHANGED:${entry.relativePath}`);
  }
  if (
    sourcePath &&
    hash141(await identity141(sourcePath)) !==
      hash141(freeze.sourceReadOnlyIdentity)
  )
    throw new Error("C601141_SOURCE_CHANGED_AFTER_FREEZE");
  return freeze;
}
