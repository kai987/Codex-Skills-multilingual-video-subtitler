import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  c61GeneratedSchemas,
  c61MachineFreezeSchema,
  c61ShadowManifestSchema,
  c61ConsensusProfileFreezeSchema,
  c61ConsensusSafetySchema,
  c61ProfileSelectionsSchema,
  machineMultiAsrTokenLatticeSchema,
  type C61FileIdentity,
  type C61MachineFreeze,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { auditC61Consensus } from "./consensus-safety-audit.js";

const requiredMachineArtifacts = [
  "machine-multi-asr-hypothesis-universe",
  "machine-multi-asr-text-representations",
  "machine-multi-asr-pairwise-alignments",
  "machine-multi-asr-multiple-alignments",
  "machine-multi-asr-token-lattice",
  "machine-multi-asr-confusion-network",
  "machine-multi-asr-span-consensus",
  "machine-multi-asr-rover-consensus",
  "machine-multi-asr-mbr-consensus",
  "machine-multi-asr-consensus-path-provenance",
  "machine-multi-asr-consensus-safety-audit",
  "c6-1-consensus-profile-freeze",
  "c6-1-profile-selections",
  "c6-1-shadow-manifest",
  "c6-1-baseline",
] as const;

async function requireC61CompleteMachine(
  root: string,
  policyHash: string,
): Promise<void> {
  for (const name of requiredMachineArtifacts) {
    const registry = c61GeneratedSchemas.find(([key]) => key === name);
    if (!registry) throw new Error("C61_MISSING_MACHINE_SCHEMA");
    const value = registry[1].parse(
      await c61Json(path.join(root, `${name}.json`)),
    );
    const { semanticHash, ...body } = value;
    if (hash(body) !== semanticHash)
      throw new Error(`C61_ARTIFACT_SEMANTIC_HASH_INVALID:${name}`);
  }
  const profiles = c61ConsensusProfileFreezeSchema.parse(
    await c61Json(path.join(root, "c6-1-consensus-profile-freeze.json")),
  );
  if (profiles.semanticHash !== policyHash)
    throw new Error("C61_POLICY_FREEZE_BINDING_MISMATCH");
  const manifest = c61ShadowManifestSchema.parse(
    await c61Json(path.join(root, "c6-1-shadow-manifest.json")),
  );
  for (const profile of profiles.profiles) {
    const shadow = manifest.profiles.find(
      (p) => p.profileId === profile.profileId,
    );
    if (
      !shadow ||
      shadow.files.length < 4 ||
      ![".ass", ".srt", ".vtt", ".json"].every((ext) =>
        shadow.files.some((f) => f.relativePath.endsWith(ext)),
      )
    )
      throw new Error("C61_INCOMPLETE_PROFILE_SHADOW");
    for (const file of shadow.files)
      if (
        (await stat(path.join(root, file.relativePath))).size !== file.size ||
        (await c61FileHash(path.join(root, file.relativePath))) !== file.sha256
      )
        throw new Error("C61_SHADOW_MANIFEST_FILE_MISMATCH");
  }
  const selection = c61ProfileSelectionsSchema.parse(
    await c61Json(path.join(root, "c6-1-profile-selections.json")),
  );
  const lattice = machineMultiAsrTokenLatticeSchema.parse(
    await c61Json(path.join(root, "machine-multi-asr-token-lattice.json")),
  );
  const safety = c61ConsensusSafetySchema.parse(
    await c61Json(
      path.join(root, "machine-multi-asr-consensus-safety-audit.json"),
    ),
  );
  const recomputed = auditC61Consensus({
    paths: selection.paths,
    lattices: lattice.lattices,
    productionTextMutation: 0,
    productionTimingMutation: 0,
    runtimeGoldInputCount: 0,
  });
  if (
    !recomputed.safety.engineeringPassed ||
    recomputed.safety.semanticHash !== safety.semanticHash
  )
    throw new Error("C61_SAFETY_RECOMPUTATION_FAILED");
}

export async function c61FileHash(file: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file))
    digest.update(chunk as Buffer);
  return digest.digest("hex");
}
export async function c61Json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}
export async function c61Fingerprint(file: string) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error("C61_EXPECTED_REGULAR_FILE");
  return {
    size: info.size,
    mtimeMs: info.mtimeMs,
    sha256: await c61FileHash(file),
  };
}
export async function c61TreeFiles(
  root: string,
  prefix = "",
): Promise<C61FileIdentity[]> {
  const entries = await readdir(path.join(root, prefix), {
    withFileTypes: true,
  });
  const files: C61FileIdentity[] = [];
  for (const entry of entries.toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isSymbolicLink())
      throw new Error("C61_ARTIFACT_SYMLINK_REJECTED");
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await c61TreeFiles(root, relativePath)));
    else if (entry.isFile())
      files.push({
        relativePath,
        sha256: await c61FileHash(path.join(root, relativePath)),
        size: (await stat(path.join(root, relativePath))).size,
      });
  }
  return files;
}
export async function verifyC61MachineFreeze(
  root: string,
): Promise<C61MachineFreeze> {
  const freeze = c61MachineFreezeSchema.parse(
    await c61Json(path.join(root, "c6-1-machine-freeze.json")),
  );
  const { semanticHash, ...body } = freeze;
  if (
    hash(body) !== semanticHash ||
    hash(freeze.machineFiles) !== freeze.machineAggregateHash
  )
    throw new Error("C61_FREEZE_HASH_MISMATCH");
  await requireC61CompleteMachine(root, freeze.policyHash);
  const actual = (await c61TreeFiles(root)).filter(
    (f) => f.relativePath !== "c6-1-machine-freeze.json",
  );
  if (hash(actual) !== freeze.machineAggregateHash)
    throw new Error("C61_FROZEN_MACHINE_FILES_CHANGED");
  return freeze;
}
export async function freezeC61MachinePair(input: {
  a: string;
  b: string;
  policyHash: string;
  inputHashes: Record<string, string>;
  productionFiles: C61FileIdentity[];
}): Promise<C61MachineFreeze> {
  await requireC61CompleteMachine(input.a, input.policyHash);
  await requireC61CompleteMachine(input.b, input.policyHash);
  const first = await c61TreeFiles(input.a);
  const second = await c61TreeFiles(input.b);
  if (hash(first) !== hash(second))
    throw new Error("C61_MACHINE_AB_BYTE_PARITY_FAILED");
  const body = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.1-consensus-investigation-v1" as const,
    artifactType: "c6-1-machine-freeze" as const,
    frozenAt: new Date().toISOString(),
    policyHash: input.policyHash,
    inputHashes: input.inputHashes,
    machineFiles: first,
    machineAggregateHash: hash(first),
    productionFiles: input.productionFiles,
    runtimeGoldInputCount: 0 as const,
    newAsrInferenceCount: 0 as const,
    networkUsed: false as const,
    benchmarkStatus: "KNOWN_DEVELOPMENT_BENCHMARK" as const,
  };
  const freeze = c61MachineFreezeSchema.parse({
    ...body,
    semanticHash: hash(body),
  });
  await atomicWriteJson(path.join(input.a, "c6-1-machine-freeze.json"), freeze);
  await atomicWriteJson(path.join(input.b, "c6-1-machine-freeze.json"), freeze);
  await verifyC61MachineFreeze(input.a);
  await verifyC61MachineFreeze(input.b);
  return freeze;
}
