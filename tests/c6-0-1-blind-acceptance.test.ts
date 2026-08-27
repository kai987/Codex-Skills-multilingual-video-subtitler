import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  blindGenerationInputManifestSchema,
  blindOutputFreezeSchema,
  machineShadowFinalizationPolicySchema,
} from "@mvl/shared";
import {
  assertGoldIsolatedGenerationInput,
  c60SemanticHash,
  c60StableHash,
  createC601EvaluationPolicy,
  createMachineShadowPolicy,
  sha256BlindFile,
  validateBlindProvenanceGraph,
  verifyBlindOutputFreeze,
} from "@mvl/video-subtitler";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const hash = (character: string): string => character.repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function validManifest() {
  return blindGenerationInputManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "blind-generation-input-manifest",
    manifestVersion: "c6.0.1-blind-generation-input-v1",
    generatedAt: "2026-08-27T00:00:00.000Z",
    generationRunId: "blind-a",
    benchmarkStatus: "development-known-runtime-blind",
    sourceVideo: { fileName: "source.mkv", size: 10, sha256: hash("a") },
    repositoryCommit: "b".repeat(40),
    allowedGenericResources: ["model-weights"],
    genericModelSnapshots: [
      {
        modelName: "large-v3",
        fileName: "ggml-large-v3.bin",
        snapshotSha256: hash("c"),
        size: 20,
        genericResource: true,
      },
    ],
    runtimeIdentities: [
      {
        runtimeId: "whisper",
        name: "whisper.cpp",
        version: "1.0.0",
        executableFileName: "whisper-cli",
        device: "cpu",
        genericResource: true,
      },
    ],
    machineMemoryInitialState: {
      storeId: "empty-a",
      entryCount: 0,
      storeHash: hash("d"),
      humanDerived: false,
    },
    importedMediaCaches: [],
    humanArtifacts: [
      "human-subtitle",
      "human-canonical",
      "human-timing",
      "human-memory",
      "human-alignment",
      "human-ctc",
      "human-correction-feedback",
      "human-authority",
      "human-protected-final",
    ].map((artifactClass) => ({ artifactClass, used: false, inputCount: 0 })),
    generationArguments: [
      "--input",
      "source.mkv",
      "--guidance-mode",
      "reference-free",
    ],
    environmentSummary: {
      networkPolicy: "off",
      networkUsed: false,
      onlineSubtitleSearchUsed: false,
      cloudProviderConfigured: false,
      guidanceMode: "reference-free",
      mediaCacheMode: "fresh-isolated",
      machineMemoryMode: "fresh-empty",
    },
    inputSemanticHash: hash("e"),
  });
}

describe("C6.0.1 blind isolation", () => {
  it("rejects a forbidden Gold argument before generation", () => {
    const manifest = validManifest();
    const malicious = structuredClone(manifest);
    malicious.generationArguments.push("--gold", "/tmp/gold.ass");
    expect(() => assertGoldIsolatedGenerationInput(malicious)).toThrow(
      /Gold isolation guard rejected/u,
    );
  });

  it("allows only explicitly verified machine-only caches for C6.0.1.1 development runs", () => {
    const manifest = structuredClone(validManifest());
    manifest.generationArguments.push(
      "--machine-quality-recovery",
      "observe",
      "--asr-cache-import",
      "/machine/cache",
    );
    manifest.importedMediaCaches.push({
      path: "/machine/cache",
      artifactType: "portable-asr-cache-v2",
      provenance: "machine-only-verified",
      artifactHash: hash("9"),
    });
    manifest.environmentSummary.mediaCacheMode = "verified-machine-only";
    expect(() => assertGoldIsolatedGenerationInput(manifest)).not.toThrow();

    const unverified = structuredClone(manifest) as unknown as {
      importedMediaCaches: { provenance: string }[];
    };
    if (unverified.importedMediaCaches[0] !== undefined) {
      unverified.importedMediaCaches[0].provenance = "unknown";
    }
    expect(() =>
      assertGoldIsolatedGenerationInput(
        unverified as unknown as typeof manifest,
      ),
    ).toThrow(/Gold isolation guard rejected/u);
  });

  it("detects direct and transitive human provenance while allowing generic resources", () => {
    const result = validateBlindProvenanceGraph([
      {
        nodeId: "model",
        artifactType: "generic-model",
        origin: "generic-resource",
        authorityType: "generic",
        artifactHash: hash("1"),
        parentNodeIds: [],
        humanDerived: false,
      },
      {
        nodeId: "human",
        artifactType: "human-subtitle",
        origin: "human",
        authorityType: "human",
        artifactHash: hash("2"),
        parentNodeIds: [],
        humanDerived: true,
      },
      {
        nodeId: "derived",
        artifactType: "candidate-cache",
        origin: "machine",
        authorityType: "machine",
        artifactHash: hash("3"),
        parentNodeIds: ["human", "model"],
        humanDerived: false,
      },
    ]);
    expect(result.passed).toBe(false);
    expect(result.violations).toContain("HUMAN_DERIVED_LINEAGE:human");
    expect(result.violations).toContain("HUMAN_DERIVED_LINEAGE:derived");
    expect(result.violations).not.toContain("HUMAN_DERIVED_LINEAGE:model");
  });

  it("accepts evaluator-supplied human identities without embedding dataset hashes in runtime code", () => {
    const result = validateBlindProvenanceGraph(
      [
        {
          nodeId: "candidate-cache",
          artifactType: "candidate-cache",
          origin: "machine",
          authorityType: "machine",
          artifactHash: hash("4"),
          parentNodeIds: [],
          humanDerived: false,
        },
      ],
      { exactHashes: [hash("4")] },
    );

    expect(result.knownHumanIdentityMatches).toEqual(["candidate-cache"]);
  });

  it("freezes policy semantics before Gold and keeps machine release closed", () => {
    const policy = createMachineShadowPolicy();
    expect(machineShadowFinalizationPolicySchema.parse(policy)).toMatchObject({
      policyVersion: "c6.0.1-machine-shadow-finalization-v1",
      machineOnlyReleaseAuthorized: false,
      unknownSignalsFailClosed: true,
      productionStatusUnaffected: true,
    });
    const left = createC601EvaluationPolicy("2026-08-27T00:00:00.000Z");
    const right = createC601EvaluationPolicy("2026-08-27T01:00:00.000Z");
    expect(left.policyHash).toBe(right.policyHash);
    expect(left.normalization.dialectStandardization).toBe(false);
  });

  it("rejects post-freeze file tampering", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c601-freeze-"));
    temporaryDirectories.push(root);
    const dataPath = path.join(root, "machine.json");
    await writeFile(dataPath, '{"value":1}\n');
    const size = (await readFile(dataPath)).byteLength;
    const file = {
      relativePath: "machine.json",
      size,
      sha256: await sha256BlindFile(dataPath),
    };
    const base = {
      schemaVersion: "1.0.0" as const,
      artifactType: "blind-output-freeze" as const,
      freezeVersion: "c6.0.1-machine-output-freeze-v1" as const,
      generationRunId: "blind-a",
      generationCommit: "b".repeat(40),
      sourceVideoSha256: hash("a"),
      machinePackageHash: hash("b"),
      canonicalTextHash: hash("c"),
      canonicalTimingHash: hash("d"),
      presentationHash: hash("e"),
      assHash: hash("f"),
      srtHash: hash("1"),
      vttHash: hash("2"),
      riskAssessmentHash: hash("3"),
      machineEvidenceCoverageHash: hash("4"),
      shadowPolicyHash: hash("5"),
      shadowOutcome: "REVIEW_REQUIRED" as const,
      seriesMemoryHash: hash("6"),
      provenanceHash: hash("7"),
      frozenFiles: [file],
      frozenArtifactAggregateHash: c60StableHash([file]),
      freezeTimestamp: "2026-08-27T00:00:00.000Z",
    };
    const freeze = blindOutputFreezeSchema.parse({
      ...base,
      freezeSemanticHash: c60SemanticHash(base),
    });
    await writeFile(
      path.join(root, "blind-output-freeze.json"),
      `${JSON.stringify(freeze, null, 2)}\n`,
    );
    await expect(
      verifyBlindOutputFreeze({ taskDirectory: root }),
    ).resolves.toBeDefined();
    await writeFile(dataPath, '{"value":2}\n');
    await expect(
      verifyBlindOutputFreeze({ taskDirectory: root }),
    ).rejects.toThrow(/changed after freeze/u);
  });

  it("uses strict schemas for the blind input contract", () => {
    expect(() =>
      blindGenerationInputManifestSchema.parse({
        ...validManifest(),
        unreviewedExtension: true,
      }),
    ).toThrow();
  });
});
