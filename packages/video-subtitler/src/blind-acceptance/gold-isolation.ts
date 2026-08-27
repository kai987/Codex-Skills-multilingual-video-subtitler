import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  blindGenerationInputManifestSchema,
  blindProvenanceAuditSchema,
  InputError,
  subtitlePackageSchema,
  type BlindGenerationInputManifest,
  type BlindProvenanceAudit,
  type SubtitleCue,
} from "@mvl/shared";

import { c60SemanticHash, c60StableHash } from "../finalization-risk-policy.js";

const HUMAN_ARTIFACT_CLASSES = [
  "human-subtitle",
  "human-canonical",
  "human-timing",
  "human-memory",
  "human-alignment",
  "human-ctc",
  "human-correction-feedback",
  "human-authority",
  "human-protected-final",
] as const;

const FORBIDDEN_GENERATION_ARGUMENTS = [
  "--gold",
  "--human-reviewed-subtitle",
  "--reference-human-subtitle",
  "--human-review-resolutions",
  "--prior-human-review-resolutions",
  "--human-verified-sequence-evidence",
  "--series-memory",
] as const;

const FORBIDDEN_PROVENANCE_TERMS = [
  "human-reviewed",
  "human-confirmed",
  "human-authority",
  "correction-feedback",
  "protected-final",
  "gold",
] as const;

export interface BlindRuntimeInput {
  runtimeId: string;
  name: string;
  version: string;
  executablePath: string;
  device: string;
}

export interface BlindModelInput {
  modelName: string;
  modelPath: string;
}

export interface CreateBlindInputManifestInput {
  generatedAt: string;
  generationRunId?: string;
  sourceVideoPath: string;
  repositoryCommit: string;
  model: BlindModelInput;
  runtimes: readonly BlindRuntimeInput[];
  generationArguments: readonly string[];
  machineMemoryStoreId: string;
  importedMachineCaches?: readonly {
    path: string;
    artifactType: string;
    artifactHash: string;
  }[];
}

export interface ProvenanceGraphNodeInput {
  nodeId: string;
  artifactType: string;
  origin: "machine" | "generic-resource" | "human" | "unknown";
  authorityType: "none" | "machine" | "generic" | "human" | "unknown";
  artifactHash: string;
  parentNodeIds: readonly string[];
  humanDerived: boolean;
}

export interface ProvenanceGraphValidation {
  violations: string[];
  humanDerivedNodeIds: string[];
  unknownNodeIds: string[];
  knownHumanIdentityMatches: string[];
  passed: boolean;
}

export interface KnownHumanArtifactIdentities {
  exactHashes?: readonly string[];
  hashPrefixes?: readonly string[];
}

export async function sha256BlindFile(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return digest.digest("hex");
}

export function c601CanonicalTextHash(cues: readonly SubtitleCue[]): string {
  return c60StableHash(
    cues.map((cue) => ({ id: cue.id, text: cue.text, style: cue.style })),
  );
}

export function c601CanonicalTimingHash(cues: readonly SubtitleCue[]): string {
  return c60StableHash(
    cues.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end })),
  );
}

export async function createBlindGenerationInputManifest(
  input: CreateBlindInputManifestInput,
): Promise<BlindGenerationInputManifest> {
  const sourceInfo = await stat(input.sourceVideoPath);
  if (!sourceInfo.isFile()) {
    throw new InputError("Blind source video must be a regular file.", {
      path: input.sourceVideoPath,
    });
  }
  const modelInfo = await stat(input.model.modelPath);
  if (!modelInfo.isFile()) {
    throw new InputError("Blind generation model must be a regular file.", {
      path: input.model.modelPath,
    });
  }
  const generationRunId = input.generationRunId ?? `c601-blind-${randomUUID()}`;
  const memoryBase = {
    storeId: input.machineMemoryStoreId,
    entryCount: 0 as const,
    humanDerived: false as const,
  };
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "blind-generation-input-manifest" as const,
    manifestVersion: "c6.0.1-blind-generation-input-v1" as const,
    generatedAt: input.generatedAt,
    generationRunId,
    benchmarkStatus: "development-known-runtime-blind" as const,
    sourceVideo: {
      fileName: path.basename(input.sourceVideoPath),
      size: sourceInfo.size,
      sha256: await sha256BlindFile(input.sourceVideoPath),
    },
    repositoryCommit: input.repositoryCommit,
    allowedGenericResources: [
      "model-weights",
      "runtime-binaries",
      "tokenizers",
      "generic-dictionaries",
      "generic-language-resources",
    ],
    genericModelSnapshots: [
      {
        modelName: input.model.modelName,
        fileName: path.basename(input.model.modelPath),
        snapshotSha256: await sha256BlindFile(input.model.modelPath),
        size: modelInfo.size,
        genericResource: true as const,
      },
    ],
    runtimeIdentities: input.runtimes.map((runtime) => ({
      runtimeId: runtime.runtimeId,
      name: runtime.name,
      version: runtime.version,
      executableFileName: path.basename(runtime.executablePath),
      device: runtime.device,
      genericResource: true as const,
    })),
    machineMemoryInitialState: {
      ...memoryBase,
      storeHash: c60StableHash(memoryBase),
    },
    importedMediaCaches: (input.importedMachineCaches ?? []).map((cache) => ({
      path: path.resolve(cache.path),
      artifactType: cache.artifactType,
      provenance: "machine-only-verified" as const,
      artifactHash: cache.artifactHash,
    })),
    humanArtifacts: HUMAN_ARTIFACT_CLASSES.map((artifactClass) => ({
      artifactClass,
      used: false as const,
      inputCount: 0 as const,
    })),
    generationArguments: [...input.generationArguments],
    environmentSummary: {
      networkPolicy: "off" as const,
      networkUsed: false as const,
      onlineSubtitleSearchUsed: false as const,
      cloudProviderConfigured: false as const,
      guidanceMode: "reference-free" as const,
      mediaCacheMode:
        (input.importedMachineCaches ?? []).length === 0
          ? ("fresh-isolated" as const)
          : ("verified-machine-only" as const),
      machineMemoryMode: "fresh-empty" as const,
    },
  };
  const manifest = blindGenerationInputManifestSchema.parse({
    ...base,
    inputSemanticHash: c60SemanticHash(base),
  });
  assertGoldIsolatedGenerationInput(manifest);
  return manifest;
}

export function assertGoldIsolatedGenerationInput(
  manifest: BlindGenerationInputManifest,
): void {
  const untrusted = manifest as unknown as {
    generationArguments: string[];
    importedMediaCaches: {
      provenance?: unknown;
      artifactHash?: unknown;
    }[];
    machineMemoryInitialState: { entryCount: number; humanDerived: boolean };
    humanArtifacts: { used: boolean; inputCount: number }[];
    environmentSummary: {
      networkPolicy: string;
      onlineSubtitleSearchUsed: boolean;
    };
  };
  const violations: string[] = [];
  const loweredArguments = untrusted.generationArguments.map((argument) =>
    argument.toLowerCase(),
  );
  for (const forbidden of FORBIDDEN_GENERATION_ARGUMENTS) {
    if (
      loweredArguments.some(
        (argument) =>
          argument === forbidden || argument.startsWith(`${forbidden}=`),
      )
    ) {
      violations.push(`FORBIDDEN_GENERATION_ARGUMENT:${forbidden}`);
    }
  }
  const qualityModeIndex = loweredArguments.indexOf(
    "--machine-quality-recovery",
  );
  const qualityMode =
    qualityModeIndex < 0
      ? null
      : (loweredArguments[qualityModeIndex + 1] ?? null);
  const cacheArgumentPresent = loweredArguments.some(
    (argument) =>
      argument === "--asr-cache-import" ||
      argument.startsWith("--asr-cache-import="),
  );
  const verifiedMachineOnlyCache =
    untrusted.importedMediaCaches.length > 0 &&
    untrusted.importedMediaCaches.every(
      (cache) =>
        cache.provenance === "machine-only-verified" &&
        typeof cache.artifactHash === "string" &&
        /^[a-f0-9]{64}$/u.test(cache.artifactHash),
    );
  if (
    untrusted.importedMediaCaches.length > 0 &&
    (!verifiedMachineOnlyCache ||
      !["observe", "enforce"].includes(qualityMode ?? ""))
  ) {
    violations.push("UNVERIFIED_OR_DISALLOWED_MEDIA_CACHE_IMPORTED");
  }
  if (cacheArgumentPresent && !verifiedMachineOnlyCache) {
    violations.push("ASR_CACHE_ARGUMENT_WITHOUT_VERIFIED_MANIFEST_PROVENANCE");
  }
  if (untrusted.machineMemoryInitialState.entryCount !== 0) {
    violations.push("MACHINE_MEMORY_NOT_EMPTY");
  }
  if (untrusted.machineMemoryInitialState.humanDerived) {
    violations.push("HUMAN_DERIVED_MEMORY_LOADED");
  }
  if (
    untrusted.humanArtifacts.some(
      (artifact) => artifact.used || artifact.inputCount > 0,
    )
  ) {
    violations.push("HUMAN_ARTIFACT_INPUT_PRESENT");
  }
  if (untrusted.environmentSummary.networkPolicy !== "off") {
    violations.push("NETWORK_POLICY_NOT_OFF");
  }
  if (untrusted.environmentSummary.onlineSubtitleSearchUsed) {
    violations.push("ONLINE_SUBTITLE_SEARCH_ENABLED");
  }
  if (violations.length > 0) {
    throw new InputError("C6.0.1 Gold isolation guard rejected generation.", {
      violations,
    });
  }
}

export function validateBlindProvenanceGraph(
  nodes: readonly ProvenanceGraphNodeInput[],
  knownHumanIdentities: KnownHumanArtifactIdentities = {},
): ProvenanceGraphValidation {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const humanDerivedNodeIds = nodes
    .filter(
      (node) =>
        node.humanDerived ||
        node.origin === "human" ||
        node.authorityType === "human" ||
        FORBIDDEN_PROVENANCE_TERMS.some((term) =>
          node.artifactType.toLowerCase().includes(term),
        ),
    )
    .map((node) => node.nodeId);
  const unknownNodeIds = nodes
    .filter(
      (node) => node.origin === "unknown" || node.authorityType === "unknown",
    )
    .map((node) => node.nodeId);
  const knownHumanIdentityMatches = nodes
    .filter(
      (node) =>
        (knownHumanIdentities.exactHashes ?? []).includes(node.artifactHash) ||
        (knownHumanIdentities.hashPrefixes ?? []).some((prefix) =>
          node.artifactHash.startsWith(prefix),
        ),
    )
    .map((node) => node.nodeId);
  const violations: string[] = [];
  const tainted = new Set(humanDerivedNodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (tainted.has(node.nodeId)) continue;
      if (node.parentNodeIds.some((parent) => tainted.has(parent))) {
        tainted.add(node.nodeId);
        changed = true;
      }
    }
  }
  for (const nodeId of tainted) {
    violations.push(`HUMAN_DERIVED_LINEAGE:${nodeId}`);
  }
  for (const nodeId of unknownNodeIds) {
    violations.push(`UNKNOWN_PROVENANCE:${nodeId}`);
  }
  for (const node of nodes) {
    for (const parent of node.parentNodeIds) {
      if (!byId.has(parent))
        violations.push(`MISSING_PARENT:${node.nodeId}:${parent}`);
    }
  }
  return {
    violations: [...new Set(violations)].toSorted(),
    humanDerivedNodeIds: [...new Set(humanDerivedNodeIds)].toSorted(),
    unknownNodeIds: [...new Set(unknownNodeIds)].toSorted(),
    knownHumanIdentityMatches: [
      ...new Set(knownHumanIdentityMatches),
    ].toSorted(),
    passed: violations.length === 0,
  };
}

async function locateSubtitleDirectory(taskDirectory: string): Promise<string> {
  const entries = await readdir(taskDirectory, { withFileTypes: true });
  const candidates = entries
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => path.join(taskDirectory, entry.name));
  for (const candidate of candidates) {
    try {
      await stat(path.join(candidate, "subtitle-package.json"));
      return candidate;
    } catch {
      // Continue to the next collision-safe subtitle directory.
    }
  }
  throw new InputError("Blind run does not contain subtitle-package.json.", {
    taskDirectory,
  });
}

const LINEAGE_ARTIFACTS = [
  ["subtitle-package", "subtitle-package.json"],
  ["processing-manifest", "processing-manifest.json"],
  ["asr", "audio/raw-transcription.json"],
  ["vad", "acoustic-scenes.json"],
  ["mapped-tokens", "subtitle-timestamp-evidence-integrity.json"],
  ["mfa", "subtitle-canonical-forced-alignment.json"],
  ["ctc", "subtitle-local-ctc-boundary-evidence.json"],
  ["speaker", "subtitle-local-speaker-evidence.json"],
  ["separation", "subtitle-local-separated-stream-evidence.json"],
  ["presentation", "presentation-constraint-integrity.json"],
  ["finalization-risk", "subtitle-finalization-report.json"],
] as const;

export async function auditBlindRunProvenance(input: {
  taskDirectory: string;
  generatedAt: string;
  manifest: BlindGenerationInputManifest;
}): Promise<BlindProvenanceAudit> {
  const subtitleDirectory = await locateSubtitleDirectory(input.taskDirectory);
  const packagePath = path.join(subtitleDirectory, "subtitle-package.json");
  subtitlePackageSchema.parse(JSON.parse(await readFile(packagePath, "utf8")));
  const sourceNode = {
    nodeId: "source-video",
    artifactType: "source-video",
    origin: "machine" as const,
    authorityType: "none" as const,
    relativePath: null,
    artifactHash: input.manifest.sourceVideo.sha256,
    parentNodeIds: [] as string[],
    humanDerived: false,
    mediaSpecific: true,
  };
  const modelNodes = input.manifest.genericModelSnapshots.map(
    (model, index) => ({
      nodeId: `generic-model-${index + 1}`,
      artifactType: "generic-model-snapshot",
      origin: "generic-resource" as const,
      authorityType: "generic" as const,
      relativePath: null,
      artifactHash: model.snapshotSha256,
      parentNodeIds: [] as string[],
      humanDerived: false,
      mediaSpecific: false,
    }),
  );
  const cacheNodes = input.manifest.importedMediaCaches.map((cache, index) => ({
    nodeId: `machine-cache-${index + 1}`,
    artifactType: cache.artifactType,
    origin: "machine" as const,
    authorityType: "machine" as const,
    relativePath: null,
    artifactHash: cache.artifactHash,
    parentNodeIds: ["source-video", ...modelNodes.map((node) => node.nodeId)],
    humanDerived: false,
    mediaSpecific: true,
  }));
  const nodes: {
    nodeId: string;
    artifactType: string;
    origin: "machine" | "generic-resource";
    authorityType: "none" | "machine" | "generic";
    relativePath: string | null;
    artifactHash: string;
    parentNodeIds: string[];
    humanDerived: boolean;
    mediaSpecific: boolean;
  }[] = [sourceNode, ...modelNodes, ...cacheNodes];
  const genericParents = modelNodes.map((node) => node.nodeId);
  for (const [artifactType, relativeCandidate] of LINEAGE_ARTIFACTS) {
    const candidate = relativeCandidate.startsWith("audio/")
      ? path.join(input.taskDirectory, relativeCandidate)
      : path.join(subtitleDirectory, relativeCandidate);
    let artifactHash: string;
    let relativePath: string | null;
    try {
      const info = await stat(candidate);
      if (!info.isFile()) throw new Error("not-file");
      artifactHash = await sha256BlindFile(candidate);
      relativePath = path
        .relative(input.taskDirectory, candidate)
        .split(path.sep)
        .join("/");
    } catch {
      artifactHash = c60StableHash({ artifactType, status: "absent" });
      relativePath = null;
    }
    nodes.push({
      nodeId: `machine-${artifactType}`,
      artifactType,
      origin: "machine" as const,
      authorityType: "machine" as const,
      relativePath,
      artifactHash,
      parentNodeIds: [
        sourceNode.nodeId,
        ...genericParents,
        ...(artifactType === "asr"
          ? cacheNodes.map((node) => node.nodeId)
          : []),
      ],
      humanDerived: false,
      mediaSpecific: true,
    });
  }
  const memoryPath = path.join(input.taskDirectory, "machine-memory.json");
  nodes.push({
    nodeId: "machine-memory",
    artifactType: "machine-only-series-memory",
    origin: "machine" as const,
    authorityType: "machine" as const,
    relativePath: "machine-memory.json",
    artifactHash: await sha256BlindFile(memoryPath),
    parentNodeIds: [sourceNode.nodeId],
    humanDerived: false,
    mediaSpecific: true,
  });
  const validation = validateBlindProvenanceGraph(nodes);
  const serializableNodes = nodes.map((node) => ({
    nodeId: node.nodeId,
    artifactType: node.artifactType,
    origin: node.origin,
    authorityType: node.authorityType,
    relativePath: node.relativePath,
    artifactHash: node.artifactHash,
    parentNodeIds: node.parentNodeIds,
    humanDerived: false as const,
    mediaSpecific: node.mediaSpecific,
  }));
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "blind-provenance-audit" as const,
    auditVersion: "c6.0.1-blind-provenance-v1" as const,
    generatedAt: input.generatedAt,
    generationRunId: input.manifest.generationRunId,
    inputManifestHash: input.manifest.inputSemanticHash,
    nodes: serializableNodes,
    lineageRoots: [sourceNode.nodeId, ...genericParents],
    knownHumanIdentityMatches: validation.knownHumanIdentityMatches,
    summary: {
      nodeCount: serializableNodes.length,
      machineNodeCount: serializableNodes.filter(
        (node) => node.origin === "machine",
      ).length,
      genericNodeCount: serializableNodes.filter(
        (node) => node.origin === "generic-resource",
      ).length,
      humanDerivedNodeCount: 0 as const,
      unknownProvenanceNodeCount: 0 as const,
    },
    isolationViolations: validation.violations,
    passed: validation.passed,
  };
  return blindProvenanceAuditSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}
