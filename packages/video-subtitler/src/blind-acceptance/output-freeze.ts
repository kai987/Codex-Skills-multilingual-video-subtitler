import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  blindGenerationInputManifestSchema,
  blindOutputFreezeSchema,
  blindProvenanceAuditSchema,
  dualBlindFreezeBarrierSchema,
  InputError,
  machineBaselineEvidenceCoverageSchema,
  machineShadowFinalizationPolicySchema,
  machineShadowFinalizationSchema,
  subtitlePackageSchema,
  zeroTouchBlindGenerationProofSchema,
  type BlindOutputFreeze,
  type DualBlindFreezeBarrier,
  type ZeroTouchBlindGenerationProof,
} from "@mvl/shared";

import { locateSubtitlePackage } from "../finalization-support.js";
import { c60SemanticHash, c60StableHash } from "../finalization-risk-policy.js";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
  sha256BlindFile,
} from "./gold-isolation.js";

const FREEZE_EXCLUSIONS = new Set([
  "blind-output-freeze.json",
  "zero-touch-blind-generation-proof.json",
  "zero-touch-blind-generation-proof.pre-gold.json",
]);

interface GenerationExecutionRecord {
  generationStartedAt: string;
  generationCompletedAt: string;
  exitCode: number;
}

function posixRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

async function listFrozenFiles(
  root: string,
  current = root,
): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.name === ".DS_Store") continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listFrozenFiles(root, absolute)));
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = posixRelative(root, absolute);
    if (FREEZE_EXCLUSIONS.has(relative)) continue;
    paths.push(absolute);
  }
  return paths;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function createBlindOutputFreeze(input: {
  taskDirectory: string;
  freezeTimestamp: string;
}): Promise<BlindOutputFreeze> {
  const taskDirectory = path.resolve(input.taskDirectory);
  const manifest = blindGenerationInputManifestSchema.parse(
    await readJson(
      path.join(taskDirectory, "blind-generation-input-manifest.json"),
    ),
  );
  const provenance = blindProvenanceAuditSchema.parse(
    await readJson(path.join(taskDirectory, "blind-provenance-audit.json")),
  );
  const evidence = machineBaselineEvidenceCoverageSchema.parse(
    await readJson(
      path.join(taskDirectory, "machine-baseline-evidence-coverage.json"),
    ),
  );
  const shadowPolicy = machineShadowFinalizationPolicySchema.parse(
    await readJson(
      path.join(taskDirectory, "machine-shadow-finalization-policy.json"),
    ),
  );
  const shadow = machineShadowFinalizationSchema.parse(
    await readJson(
      path.join(taskDirectory, "machine-shadow-finalization.json"),
    ),
  );
  const located = await locateSubtitlePackage(taskDirectory);
  const packageValue = subtitlePackageSchema.parse(
    await readJson(located.packagePath),
  );
  const resolveSubtitle = (relative: string | null, label: string): string => {
    if (relative === null) {
      throw new InputError(`Blind output is missing ${label}.`, {
        taskDirectory,
      });
    }
    return path.join(located.subtitleDirectory, relative);
  };
  const assPath = resolveSubtitle(packageValue.subtitleFiles.ass, "ASS output");
  const srtPath = resolveSubtitle(packageValue.subtitleFiles.srt, "SRT output");
  const vttPath = resolveSubtitle(packageValue.subtitleFiles.vtt, "VTT output");
  const finalizationPath = path.join(
    located.subtitleDirectory,
    "subtitle-finalization-report.json",
  );
  const memoryPath = path.join(taskDirectory, "machine-memory.json");
  const memoryValue = (await readJson(memoryPath)) as {
    entryCount?: unknown;
    humanDerived?: unknown;
    entries?: unknown;
  };
  const frozenFiles = await Promise.all(
    (await listFrozenFiles(taskDirectory)).map(async (filePath) => {
      const info = await stat(filePath);
      return {
        relativePath: posixRelative(taskDirectory, filePath),
        size: info.size,
        sha256: await sha256BlindFile(filePath),
      };
    }),
  );
  frozenFiles.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  const presentationHash = c60StableHash({
    ass: await sha256BlindFile(assPath),
    srt: await sha256BlindFile(srtPath),
    vtt: await sha256BlindFile(vttPath),
  });
  const aggregate = c60StableHash(frozenFiles);
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "blind-output-freeze" as const,
    freezeVersion: "c6.0.1-machine-output-freeze-v1" as const,
    generationRunId: manifest.generationRunId,
    generationCommit: manifest.repositoryCommit,
    sourceVideoSha256: manifest.sourceVideo.sha256,
    machinePackageHash: await sha256BlindFile(located.packagePath),
    canonicalTextHash: c601CanonicalTextHash(packageValue.cues),
    canonicalTimingHash: c601CanonicalTimingHash(packageValue.cues),
    presentationHash,
    assHash: await sha256BlindFile(assPath),
    srtHash: await sha256BlindFile(srtPath),
    vttHash: await sha256BlindFile(vttPath),
    riskAssessmentHash: await sha256BlindFile(finalizationPath),
    machineEvidenceCoverageHash: evidence.semanticHash,
    shadowPolicyHash: shadowPolicy.policyHash,
    shadowOutcome: shadow.shadowMachineOutcome,
    seriesMemoryHash: c60StableHash({
      entryCount: memoryValue.entryCount,
      humanDerived: memoryValue.humanDerived,
      entries: memoryValue.entries,
    }),
    provenanceHash: provenance.semanticHash,
    frozenFiles,
    frozenArtifactAggregateHash: aggregate,
    freezeTimestamp: input.freezeTimestamp,
  };
  return blindOutputFreezeSchema.parse({
    ...base,
    freezeSemanticHash: c60SemanticHash(base),
  });
}

export async function verifyBlindOutputFreeze(input: {
  taskDirectory: string;
  expected?: BlindOutputFreeze;
}): Promise<BlindOutputFreeze> {
  const taskDirectory = path.resolve(input.taskDirectory);
  const freeze =
    input.expected ??
    blindOutputFreezeSchema.parse(
      await readJson(path.join(taskDirectory, "blind-output-freeze.json")),
    );
  const { freezeSemanticHash, ...freezeBase } = freeze;
  if (c60SemanticHash(freezeBase) !== freezeSemanticHash) {
    throw new InputError("Blind output freeze semantic hash is invalid.", {
      taskDirectory,
    });
  }
  const currentFiles = (await listFrozenFiles(taskDirectory)).map((filePath) =>
    posixRelative(taskDirectory, filePath),
  );
  const expectedFiles = freeze.frozenFiles.map((file) => file.relativePath);
  if (
    c60StableHash(currentFiles.toSorted()) !==
    c60StableHash(expectedFiles.toSorted())
  ) {
    throw new InputError("Blind output file set changed after freeze.", {
      expectedFiles,
      currentFiles,
    });
  }
  const recomputed = [];
  for (const expected of freeze.frozenFiles) {
    const filePath = path.join(taskDirectory, expected.relativePath);
    const info = await stat(filePath);
    const sha256 = await sha256BlindFile(filePath);
    if (info.size !== expected.size || sha256 !== expected.sha256) {
      throw new InputError("Blind output changed after freeze.", {
        relativePath: expected.relativePath,
        expectedSize: expected.size,
        actualSize: info.size,
        expectedSha256: expected.sha256,
        actualSha256: sha256,
      });
    }
    recomputed.push({
      relativePath: expected.relativePath,
      size: info.size,
      sha256,
    });
  }
  if (c60StableHash(recomputed) !== freeze.frozenArtifactAggregateHash) {
    throw new InputError("Blind output aggregate hash changed after freeze.", {
      taskDirectory,
    });
  }
  return freeze;
}

function argumentValue(
  argumentsList: readonly string[],
  flag: string,
): string | null {
  const index = argumentsList.indexOf(flag);
  if (index < 0) return null;
  return argumentsList[index + 1] ?? null;
}

function comparableArguments(argumentsList: readonly string[]): string[] {
  const omittedValues = new Set(["--output", "--asr-cache-dir"]);
  const result: string[] = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const value = argumentsList[index];
    if (value === undefined) continue;
    if (omittedValues.has(value)) {
      index += 1;
      continue;
    }
    result.push(value);
  }
  return result;
}

export async function createDualBlindFreezeBarrier(input: {
  acceptanceId: string;
  createdAt: string;
  runAPath: string;
  runBPath: string;
}): Promise<DualBlindFreezeBarrier> {
  const runAPath = path.resolve(input.runAPath);
  const runBPath = path.resolve(input.runBPath);
  if (runAPath === runBPath) {
    throw new InputError("Blind A and B must use distinct output directories.");
  }
  const [freezeA, freezeB, manifestA, manifestB] = await Promise.all([
    verifyBlindOutputFreeze({ taskDirectory: runAPath }),
    verifyBlindOutputFreeze({ taskDirectory: runBPath }),
    readJson(path.join(runAPath, "blind-generation-input-manifest.json")).then(
      (value) => blindGenerationInputManifestSchema.parse(value),
    ),
    readJson(path.join(runBPath, "blind-generation-input-manifest.json")).then(
      (value) => blindGenerationInputManifestSchema.parse(value),
    ),
  ]);
  const runtimeIdentityParity =
    c60StableHash(manifestA.runtimeIdentities) ===
      c60StableHash(manifestB.runtimeIdentities) &&
    c60StableHash(manifestA.genericModelSnapshots) ===
      c60StableHash(manifestB.genericModelSnapshots);
  const configurationParity =
    c60StableHash(comparableArguments(manifestA.generationArguments)) ===
    c60StableHash(comparableArguments(manifestB.generationArguments));
  const cacheA = argumentValue(
    manifestA.generationArguments,
    "--asr-cache-dir",
  );
  const cacheB = argumentValue(
    manifestB.generationArguments,
    "--asr-cache-dir",
  );
  const distinctMediaCaches =
    cacheA !== null && cacheB !== null && cacheA !== cacheB;
  const distinctMachineMemoryStores =
    manifestA.machineMemoryInitialState.storeId !==
    manifestB.machineMemoryInitialState.storeId;
  if (
    !runtimeIdentityParity ||
    !configurationParity ||
    !distinctMediaCaches ||
    !distinctMachineMemoryStores ||
    manifestA.sourceVideo.sha256 !== manifestB.sourceVideo.sha256 ||
    manifestA.repositoryCommit !== manifestB.repositoryCommit
  ) {
    throw new InputError("Dual blind freeze barrier validation failed.", {
      runtimeIdentityParity,
      configurationParity,
      distinctMediaCaches,
      distinctMachineMemoryStores,
    });
  }
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "dual-blind-freeze-barrier" as const,
    barrierVersion: "c6.0.1-dual-freeze-barrier-v1" as const,
    acceptanceId: input.acceptanceId,
    createdAt: input.createdAt,
    runAPath,
    runBPath,
    runAFreezeHash: freezeA.freezeSemanticHash,
    runBFreezeHash: freezeB.freezeSemanticHash,
    runAInputHash: manifestA.inputSemanticHash,
    runBInputHash: manifestB.inputSemanticHash,
    runtimeIdentityParity,
    configurationParity,
    distinctOutputDirectories: true,
    distinctMediaCaches,
    distinctMachineMemoryStores,
    bothFrozenBeforeGold: true,
    goldReadAuthorized: true,
  };
  return dualBlindFreezeBarrierSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}

export async function createZeroTouchBlindGenerationProof(input: {
  taskDirectory: string;
  phase: "pre-gold" | "post-gold";
  barrierReachedAt: string;
  goldFirstReadAt: string | null;
  outputHashAfterGold: string | null;
}): Promise<ZeroTouchBlindGenerationProof> {
  const taskDirectory = path.resolve(input.taskDirectory);
  const manifest = blindGenerationInputManifestSchema.parse(
    await readJson(
      path.join(taskDirectory, "blind-generation-input-manifest.json"),
    ),
  );
  const freeze = await verifyBlindOutputFreeze({ taskDirectory });
  const execution = (await readJson(
    path.join(taskDirectory, "blind-generation-execution.json"),
  )) as GenerationExecutionRecord;
  const postGold = input.phase === "post-gold";
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "zero-touch-blind-generation-proof" as const,
    proofVersion: "c6.0.1-zero-touch-blind-generation-proof-v1" as const,
    phase: input.phase,
    benchmarkStatus: "development-known-runtime-blind" as const,
    generationRunId: manifest.generationRunId,
    sourceVideoIdentity: manifest.sourceVideo,
    repositoryCommit: manifest.repositoryCommit,
    generationStartedAt: execution.generationStartedAt,
    generationCompletedAt: execution.generationCompletedAt,
    goldBarrierReachedAt: input.barrierReachedAt,
    machineOutputFrozenAt: freeze.freezeTimestamp,
    goldFirstReadAt: input.goldFirstReadAt,
    humanSubtitleAvailableDuringGeneration: false,
    humanSubtitleReadDuringGeneration: false as const,
    humanDerivedCanonicalLoaded: false as const,
    humanDerivedTimingLoaded: false as const,
    humanDerivedMemoryLoaded: false as const,
    humanDerivedAlignmentLoaded: false as const,
    humanDerivedCtcLoaded: false as const,
    humanCorrectionFeedbackLoaded: false as const,
    humanAuthorityLoaded: false as const,
    humanProtectedFinalLoaded: false as const,
    priorMediaSpecificCacheImported: false as const,
    onlineSubtitleSearchUsed: false as const,
    networkUsed: false as const,
    machineMemoryStartedEmpty: true as const,
    machineMemoryInitialEntryCount: 0 as const,
    sameCueMemoryLeakCount: 0 as const,
    futureCueMemoryLeakCount: 0 as const,
    goldLoadedAfterOutputFrozen: postGold,
    outputHashBeforeGold: freeze.frozenArtifactAggregateHash,
    outputHashAfterGold: input.outputHashAfterGold,
    outputHashUnchangedAfterGold:
      !postGold ||
      input.outputHashAfterGold === freeze.frozenArtifactAggregateHash,
    isolationViolations: [],
    proofPassed:
      execution.exitCode === 0 &&
      (!postGold ||
        input.outputHashAfterGold === freeze.frozenArtifactAggregateHash),
  };
  return zeroTouchBlindGenerationProofSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}
