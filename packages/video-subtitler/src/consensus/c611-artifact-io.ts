import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWriteJson,
  c611MachineFeatureFreezeSchema,
  c611GeneratedSchemas,
  c61ConsensusProfileFreezeSchema,
  c611BaselineSchema,
  c611PolicyFreezeSchema,
  c611CalibrationPolicySchema,
  c611CalibrationFoldsSchema,
  c611LegacyControlSchema,
  machineC611HierarchicalCorrelationGroupsSchema,
  machineC611CandidateCorrelationAuditSchema,
  machineExistingCandidateMbrRiskLedgerSchema,
  machineSelectiveExistingCandidateProposalsSchema,
  machineExistingCandidateCompletenessRiskSchema,
  machineSelectiveMbrFeaturesSchema,
  subtitlePackageSchema,
  type C611MachineFeatureFreeze,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { c61FileHash, c61Json, c61TreeFiles } from "./c61-artifact-io.js";
import { C611_POLICY_VERSION } from "./c611-policy.js";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../blind-acceptance/gold-isolation.js";

export const C611_REQUIRED_MACHINE_ARTIFACTS = [
  "c6-1-1-baseline",
  "machine-c6-1-1-hierarchical-correlation-groups",
  "machine-c6-1-1-candidate-correlation-audit",
  "machine-existing-candidate-mbr-risk-ledger",
  "machine-selective-existing-candidate-proposals",
  "machine-existing-candidate-completeness-risk",
  "machine-selective-mbr-features",
  "c6-1-1-calibration-folds",
  "c6-1-1-calibration-policy",
  "c6-1-1-policy-freeze",
  "c6-1-1-legacy-p6-control",
  "c6-1-consensus-profile-freeze",
] as const;
export const C611_REQUIRED_PREVIOUS_INPUTS = [
  "machine-multi-asr-hypothesis-universe.json",
  "machine-multi-asr-token-lattice.json",
  "c6-1-profile-selections.json",
  "c6-1-shadow-manifest.json",
  "subtitle-package.production.json",
  "c6-1-consensus-profile-freeze.json",
] as const;

function safeRelative(relative: string): void {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative
      .split(/[\\/]/u)
      .some((part) => part === ".." || part === "." || part === "")
  )
    throw new Error("C611_FREEZE_UNSAFE_RELATIVE_PATH");
}

/** Exactly the source/test tree used by source-mode acceptance and QA. Dependency
 * package metadata is frozen; this is not a hash of every installed library byte. */
export async function c611RequiredSourceFiles(
  repository: string,
): Promise<string[]> {
  async function files(directory: string): Promise<string[]> {
    const entries = await readdir(path.join(repository, directory), {
      withFileTypes: true,
    });
    const result: string[] = [];
    for (const entry of entries) {
      const relative = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("C611_SOURCE_SYMLINK_UNSUPPORTED");
      if (entry.isDirectory() && !["node_modules", "dist"].includes(entry.name))
        result.push(...(await files(relative)));
      else if (entry.isFile() && /\.(ts|json)$/u.test(entry.name))
        result.push(relative);
    }
    return result;
  }
  const result = [
    ...(await files("packages")),
    ...(await files("scripts")),
    ...(await files("tests")),
    "package.json",
    "package-lock.json",
    "tsconfig.base.json",
    "vitest.config.ts",
  ].sort();
  const required = [
    "packages/shared/src/index.ts",
    "packages/video-subtitler/src/consensus/c611-artifact-io.ts",
    "packages/video-subtitler/src/consensus/c611-evaluation-barrier.ts",
    "scripts/run-c6-1-1-selective-mbr.ts",
    "scripts/evaluate-c6-1-1-selective-mbr.ts",
  ];
  if (!required.every((file) => result.includes(file)))
    throw new Error("C611_REQUIRED_SOURCE_ENTRY_MISSING");
  return result;
}

async function sourceExecutionIdentity(repository: string) {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major) || major < 24)
    throw new Error("C611_NODE_24_OR_LATER_REQUIRED");
  const sharedSourceEntry = "packages/shared/src/index.ts" as const;
  const actual = await realpath(
    fileURLToPath(import.meta.resolve("@mvl/shared")),
  );
  const expected = await realpath(path.join(repository, sharedSourceEntry));
  if (actual !== expected)
    throw new Error("C611_SOURCE_EXECUTION_REQUIRED_USE_TSX_TSCONFIG");
  return {
    runtimeNodeVersion: process.versions.node,
    sharedSourceEntry,
    runtimeSourceExecutionVerified: true as const,
  };
}

/** Shared by pre/post QA and machine freeze: do not maintain a second glob. */
export async function c611SourceInventory(repository: string) {
  await sourceExecutionIdentity(repository);
  return Promise.all(
    (await c611RequiredSourceFiles(repository)).map(async (relativePath) => ({
      relativePath,
      size: (await stat(path.join(repository, relativePath))).size,
      sha256: await c61FileHash(path.join(repository, relativePath)),
    })),
  );
}

type Bindings = Pick<
  C611MachineFeatureFreeze,
  | "proposalHash"
  | "featureSchemaHash"
  | "featureTableHash"
  | "candidateUniverseHash"
  | "correlationPolicyHash"
  | "riskPolicyHash"
  | "foldHash"
  | "policyHash"
  | "baselineHash"
  | "inputHashes"
>;

/** A self-consistent file list alone is not a complete machine acceptance. */
export async function requireC611CompleteMachine(
  root: string,
  bindings: Bindings,
): Promise<void> {
  const names = (await c61TreeFiles(root))
    .filter((f) => f.relativePath !== "c6-1-1-machine-feature-freeze.json")
    .map((f) => f.relativePath)
    .sort();
  const expected = [
    ...C611_REQUIRED_MACHINE_ARTIFACTS.map((name) => `${name}.json`),
    "subtitle-package.production.json",
  ].sort();
  if (hash(names) !== hash(expected))
    throw new Error("C611_INCOMPLETE_OR_UNEXPECTED_MACHINE_ARTIFACTS");
  if (
    !C611_REQUIRED_PREVIOUS_INPUTS.every((name) =>
      /^[a-f0-9]{64}$/u.test(bindings.inputHashes[`c61/${name}`] ?? ""),
    )
  )
    throw new Error("C611_REQUIRED_PREVIOUS_INPUT_BINDING_MISSING");
  const parsed: Record<string, unknown> = {};
  for (const name of C611_REQUIRED_MACHINE_ARTIFACTS) {
    const schema =
      name === "c6-1-consensus-profile-freeze"
        ? c61ConsensusProfileFreezeSchema
        : c611GeneratedSchemas.find(([key]) => key === name)?.[1];
    if (!schema) throw new Error("C611_REQUIRED_MACHINE_SCHEMA_MISSING");
    const value = schema.parse(await c61Json(path.join(root, `${name}.json`)));
    const { semanticHash, ...body } = value;
    if (hash(body) !== semanticHash)
      throw new Error(`C611_ARTIFACT_SEMANTIC_HASH_INVALID:${name}`);
    parsed[name] = value;
  }
  const baseline = c611BaselineSchema.parse(parsed["c6-1-1-baseline"]);
  const groups = machineC611HierarchicalCorrelationGroupsSchema.parse(
    parsed["machine-c6-1-1-hierarchical-correlation-groups"],
  );
  const audit = machineC611CandidateCorrelationAuditSchema.parse(
    parsed["machine-c6-1-1-candidate-correlation-audit"],
  );
  const risk = machineExistingCandidateMbrRiskLedgerSchema.parse(
    parsed["machine-existing-candidate-mbr-risk-ledger"],
  );
  const proposals = machineSelectiveExistingCandidateProposalsSchema.parse(
    parsed["machine-selective-existing-candidate-proposals"],
  );
  const complete = machineExistingCandidateCompletenessRiskSchema.parse(
    parsed["machine-existing-candidate-completeness-risk"],
  );
  const features = machineSelectiveMbrFeaturesSchema.parse(
    parsed["machine-selective-mbr-features"],
  );
  const folds = c611CalibrationFoldsSchema.parse(
    parsed["c6-1-1-calibration-folds"],
  );
  const calibration = c611CalibrationPolicySchema.parse(
    parsed["c6-1-1-calibration-policy"],
  );
  const policy = c611PolicyFreezeSchema.parse(parsed["c6-1-1-policy-freeze"]);
  const legacy = c611LegacyControlSchema.parse(
    parsed["c6-1-1-legacy-p6-control"],
  );
  const production = subtitlePackageSchema.parse(
    await c61Json(path.join(root, "subtitle-package.production.json")),
  );
  const checks = [
    baseline.baselineReplayPassed &&
      baseline.checks.length > 0 &&
      baseline.checks.every((c) => c.passed),
    baseline.semanticHash === bindings.baselineHash,
    proposals.semanticHash === bindings.proposalHash,
    features.semanticHash === bindings.featureTableHash,
    features.featureSchemaHash === bindings.featureSchemaHash,
    groups.correlationPolicyHash === bindings.correlationPolicyHash,
    risk.riskPolicyHash === bindings.riskPolicyHash,
    folds.semanticHash === bindings.foldHash,
    policy.semanticHash === bindings.policyHash,
    [
      baseline.candidateUniverseHash,
      groups.candidateUniverseHash,
      risk.candidateUniverseHash,
      proposals.candidateUniverseHash,
    ].every((v) => v === bindings.candidateUniverseHash),
    [
      audit.correlationGroupsHash,
      risk.correlationGroupsHash,
      proposals.correlationGroupsHash,
    ].every((v) => v === groups.semanticHash),
    proposals.riskLedgerHash === risk.semanticHash,
    complete.proposalHash === proposals.semanticHash,
    features.proposalHash === proposals.semanticHash,
    features.completenessHash === complete.semanticHash,
    folds.policyHash === calibration.semanticHash,
    policy.calibrationPolicyHash === hash(calibration),
    baseline.canonicalTextHash === c601CanonicalTextHash(production.cues),
    baseline.canonicalTimingHash === c601CanonicalTimingHash(production.cues),
    legacy.originalCanonicalTextHash === legacy.reproducedCanonicalTextHash,
    Object.entries(baseline.inputHashes).every(
      ([key, value]) => bindings.inputHashes[key] === value,
    ),
  ];
  const definitions = Object.fromEntries(
    Object.entries(policy.policyDefinitions).map(([key, value]) => [
      key,
      JSON.parse(value) as unknown,
    ]),
  );
  checks.push(
    hash(definitions.fixedAlignment) === policy.fixedAlignmentPolicyHash,
    hash(definitions.machine) === policy.machinePolicyHash,
    hash(definitions.calibration) === policy.calibrationPolicyHash,
    hash(definitions.oracle) === policy.oraclePolicyHash,
  );
  if (checks.some((value) => !value))
    throw new Error("C611_MACHINE_CROSS_BINDING_MISMATCH");
  const ids = proposals.records
    .map((p) => `${p.eventId}:${p.proposalId}`)
    .sort();
  if (ids.length === 0 || new Set(ids).size !== ids.length)
    throw new Error("C611_EMPTY_OR_DUPLICATE_PROPOSALS");
  for (const rows of [features.rows, complete.rows, folds.units])
    if (
      hash(rows.map((r) => `${r.eventId}:${r.proposalId}`).sort()) !== hash(ids)
    )
      throw new Error("C611_MACHINE_PROPOSAL_SET_MISMATCH");
}

export async function verifyC611MachineFreeze(
  root: string,
  repository: string,
): Promise<C611MachineFeatureFreeze> {
  const freeze = c611MachineFeatureFreezeSchema.parse(
    await c61Json(path.join(root, "c6-1-1-machine-feature-freeze.json")),
  );
  const { semanticHash, ...body } = freeze;
  if (
    hash(body) !== semanticHash ||
    hash(freeze.machineFiles) !== freeze.machineAggregateHash ||
    hash(freeze.sourceCodeFiles) !== freeze.sourceCodeAggregateHash
  )
    throw new Error("C611_FREEZE_HASH_INVALID");
  const files = (await c61TreeFiles(root)).filter(
    (f) => f.relativePath !== "c6-1-1-machine-feature-freeze.json",
  );
  if (hash(files) !== freeze.machineAggregateHash)
    throw new Error("C611_FROZEN_MACHINE_FILES_CHANGED");
  await requireC611CompleteMachine(root, freeze);
  const runtime = await sourceExecutionIdentity(repository);
  if (runtime.runtimeNodeVersion !== freeze.runtimeNodeVersion)
    throw new Error("C611_FROZEN_RUNTIME_CHANGED");
  const requiredSourceFiles = await c611RequiredSourceFiles(repository);
  if (
    hash(freeze.sourceCodeFiles.map((f) => f.relativePath).sort()) !==
    hash(requiredSourceFiles)
  )
    throw new Error("C611_SOURCE_INVENTORY_CHANGED_OR_INCOMPLETE");
  for (const file of freeze.sourceCodeFiles) {
    safeRelative(file.relativePath);
    if (
      (await c61FileHash(path.join(repository, file.relativePath))) !==
        file.sha256 ||
      (await stat(path.join(repository, file.relativePath))).size !== file.size
    )
      throw new Error(`C611_FROZEN_SOURCE_CHANGED:${file.relativePath}`);
  }
  return freeze;
}

export async function freezeC611MachinePair(input: {
  a: string;
  b: string;
  repository: string;
  sourceFiles: string[];
  bindings: Bindings;
}): Promise<C611MachineFeatureFreeze> {
  const machineFiles = await c61TreeFiles(input.a),
    other = await c61TreeFiles(input.b);
  if (hash(machineFiles) !== hash(other))
    throw new Error("C611_PRE_GOLD_MACHINE_AB_MISMATCH");
  await requireC611CompleteMachine(input.a, input.bindings);
  await requireC611CompleteMachine(input.b, input.bindings);
  const requiredSourceFiles = await c611RequiredSourceFiles(input.repository);
  input.sourceFiles.forEach(safeRelative);
  if (hash([...input.sourceFiles].sort()) !== hash(requiredSourceFiles))
    throw new Error("C611_REQUIRED_SOURCE_FILES_INCOMPLETE");
  const runtime = await sourceExecutionIdentity(input.repository);
  const sourceCodeFiles = await c611SourceInventory(input.repository);
  const body = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C611_POLICY_VERSION,
    artifactType: "c6-1-1-machine-feature-freeze" as const,
    frozenAt: new Date().toISOString(),
    ...runtime,
    ...input.bindings,
    machineFiles,
    machineAggregateHash: hash(machineFiles),
    sourceCodeFiles,
    sourceCodeAggregateHash: hash(sourceCodeFiles),
    frozenBeforeGold: true as const,
    aBMachineParity: true as const,
    runtimeGoldInputCount: 0 as const,
    newAsrInferenceCount: 0 as const,
    networkUsed: false as const,
  };
  const freeze = c611MachineFeatureFreezeSchema.parse({
    ...body,
    semanticHash: hash(body),
  });
  for (const root of [input.a, input.b])
    await atomicWriteJson(
      path.join(root, "c6-1-1-machine-feature-freeze.json"),
      freeze,
    );
  await verifyC611MachineFreeze(input.a, input.repository);
  await verifyC611MachineFreeze(input.b, input.repository);
  return freeze;
}
