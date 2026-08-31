import path from "node:path";
import {
  atomicWriteJson,
  c60114MachineFreezeSchema,
  type C60114Policy,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import { c60114ArtifactHeader } from "../../packages/video-subtitler/src/review/c60114-policy.js";
import {
  c60113ContainedFile,
  c60113FileHash,
  c60113FileIdentity,
  readC60113Json,
  assertC60113ReadOnlyIdentity,
  type C60113FileIdentity,
} from "./c60113-acceptance-io.js";

export async function freezeC60114Machine(input: {
  root: string;
  artifactPaths: string[];
  protectedPaths: string[];
  policy: C60114Policy;
  sourceIdentity: C60114SourceIdentity;
  sourcePath: string;
  sourceBefore: C60113FileIdentity;
  stage: string;
}) {
  const sourceAfter = await c60113FileIdentity(input.sourcePath);
  assertC60113ReadOnlyIdentity(input.sourceBefore, sourceAfter);
  const artifacts = [];
  for (const relativePath of [...new Set(input.artifactPaths)].sort()) {
    if (
      /(?:^|\/)(?:gold|evaluation|human-correction|session)(?:[./-]|$)/iu.test(
        relativePath,
      )
    )
      throw new Error("C60114_NON_MACHINE_FREEZE_INPUT");
    const file = await c60113ContainedFile(input.root, relativePath);
    const parsed = await readC60113Json(file);
    const declaredHash =
      parsed &&
      typeof parsed === "object" &&
      "semanticHash" in parsed &&
      typeof parsed.semanticHash === "string"
        ? parsed.semanticHash
        : null;
    artifacts.push({
      relativePath,
      byteHash: await c60113FileHash(file),
      semanticHash: declaredHash ?? machineQualitySemanticHash(parsed),
    });
  }
  const protectedMachineFiles = [];
  for (const relativePath of [...new Set(input.protectedPaths)].sort())
    protectedMachineFiles.push({
      relativePath,
      byteHash: await c60113FileHash(
        await c60113ContainedFile(input.root, relativePath),
      ),
    });
  const core = {
    ...c60114ArtifactHeader(input.policy, input.sourceIdentity),
    artifactType: "c6-0-1-14-machine-localization-freeze",
    freezeCompletedAt: new Date().toISOString(),
    stage: input.stage,
    artifacts,
    protectedMachineFiles,
    rankerRetrained: false,
    oofTrainingRun: false,
    goldReadCountBeforeFreeze: 0,
    sourceReadOnlyIdentity: sourceAfter,
    canonicalTextMutationCount: 0,
    canonicalTimingMutationCount: 0,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    c602Status: "HOLD",
  };
  const freeze = c60114MachineFreezeSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
  const file = path.join(
    input.root,
    "c6-0-1-14-machine-localization-freeze.json",
  );
  await atomicWriteJson(file, freeze);
  return { freeze, file };
}

export async function verifyC60114MachineFreeze(input: {
  root: string;
  sourcePath: string;
}) {
  const file = await c60113ContainedFile(
    input.root,
    "c6-0-1-14-machine-localization-freeze.json",
  );
  const freeze = c60114MachineFreezeSchema.parse(await readC60113Json(file));
  const { semanticHash, ...core } = freeze;
  if (machineQualitySemanticHash(core) !== semanticHash)
    throw new Error("C60114_MACHINE_FREEZE_HASH_MISMATCH");
  let verifiedArtifactCount = 0;
  for (const entry of [...freeze.artifacts, ...freeze.protectedMachineFiles]) {
    if (
      (await c60113FileHash(
        await c60113ContainedFile(input.root, entry.relativePath),
      )) !== entry.byteHash
    )
      throw new Error(`C60114_FROZEN_FILE_CHANGED:${entry.relativePath}`);
    verifiedArtifactCount++;
  }
  assertC60113ReadOnlyIdentity(
    freeze.sourceReadOnlyIdentity,
    await c60113FileIdentity(input.sourcePath),
  );
  return {
    freezeSha256: await c60113FileHash(file),
    verifiedArtifactCount,
    expectedArtifactCount:
      freeze.artifacts.length + freeze.protectedMachineFiles.length,
    allHashesMatch: true,
    sourceIdentityVerified: true,
    runtimeGoldInputCount: 0,
  };
}
