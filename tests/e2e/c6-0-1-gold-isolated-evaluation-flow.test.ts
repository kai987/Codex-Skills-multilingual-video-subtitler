import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  blindGenerationInputManifestSchema,
  blindOutputFreezeSchema,
  dualBlindFreezeBarrierSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { formatAss } from "@mvl/subtitle-core";
import {
  c60StableHash,
  c60SemanticHash,
  createC601EvaluationPolicy,
  evaluateDualBlindRunsAgainstGold,
  evaluateFrozenBlindRunAgainstGold,
  sha256BlindFile,
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createRun(root: string, label: "A" | "B") {
  const subtitleDirectory = path.join(root, "subtitle-fixture");
  await mkdir(subtitleDirectory, { recursive: true });
  const manifest = blindGenerationInputManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "blind-generation-input-manifest",
    manifestVersion: "c6.0.1-blind-generation-input-v1",
    generatedAt: "2026-08-27T00:00:00.000Z",
    generationRunId: `blind-${label}`,
    benchmarkStatus: "development-known-runtime-blind",
    sourceVideo: { fileName: "fixture.mkv", size: 1, sha256: hash("a") },
    repositoryCommit: "b".repeat(40),
    allowedGenericResources: ["model-weights"],
    genericModelSnapshots: [
      {
        modelName: "fixture-model",
        fileName: "fixture.bin",
        snapshotSha256: hash("c"),
        size: 1,
        genericResource: true,
      },
    ],
    runtimeIdentities: [
      {
        runtimeId: "fixture-runtime",
        name: "fixture",
        version: "1",
        executableFileName: "fixture",
        device: "cpu",
        genericResource: true,
      },
    ],
    machineMemoryInitialState: {
      storeId: `empty-${label}`,
      entryCount: 0,
      storeHash: hash(label === "A" ? "d" : "e"),
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
      "fixture.mkv",
      "--asr-cache-dir",
      `cache-${label}`,
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
    inputSemanticHash: hash(label === "A" ? "f" : "1"),
  });
  const cues = [
    {
      id: "cue-1",
      start: 1,
      end: 2,
      language: "ja",
      languages: ["ja"],
      text: "おはよう。",
      speaker: null,
      confidence: 0.9,
    },
    {
      id: "cue-2",
      start: 3,
      end: 4,
      language: "ja",
      languages: ["ja"],
      text: "行きましょう。",
      speaker: null,
      confidence: 0.9,
    },
  ];
  const subtitlePackage = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "fixture.mkv",
      container: "matroska",
      durationSeconds: 5,
    },
    identity: { title: "Fixture", season: null, episode: 1, year: 2026 },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      srt: "fixture.srt",
      vtt: "fixture.vtt",
      ass: "fixture.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues,
    warnings: [],
  });
  const policy = createC601EvaluationPolicy("2026-08-27T00:00:00.000Z");
  await Promise.all([
    writeJson(
      path.join(root, "blind-generation-input-manifest.json"),
      manifest,
    ),
    writeJson(path.join(root, "blind-evaluation-policy.json"), policy),
    writeJson(
      path.join(subtitleDirectory, "subtitle-package.json"),
      subtitlePackage,
    ),
  ]);
  const files = await Promise.all(
    [
      "blind-evaluation-policy.json",
      "blind-generation-input-manifest.json",
      "subtitle-fixture/subtitle-package.json",
    ].map(async (relativePath) => {
      const filePath = path.join(root, relativePath);
      return {
        relativePath,
        size: (await stat(filePath)).size,
        sha256: await sha256BlindFile(filePath),
      };
    }),
  );
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  const freezeBase = {
    schemaVersion: "1.0.0" as const,
    artifactType: "blind-output-freeze" as const,
    freezeVersion: "c6.0.1-machine-output-freeze-v1" as const,
    generationRunId: manifest.generationRunId,
    generationCommit: manifest.repositoryCommit,
    sourceVideoSha256: manifest.sourceVideo.sha256,
    machinePackageHash: await sha256BlindFile(
      path.join(subtitleDirectory, "subtitle-package.json"),
    ),
    canonicalTextHash: hash("2"),
    canonicalTimingHash: hash("3"),
    presentationHash: hash("4"),
    assHash: hash("5"),
    srtHash: hash("6"),
    vttHash: hash("7"),
    riskAssessmentHash: hash("8"),
    machineEvidenceCoverageHash: hash("9"),
    shadowPolicyHash: hash("a"),
    shadowOutcome: "REVIEW_REQUIRED" as const,
    seriesMemoryHash: hash("b"),
    provenanceHash: hash("c"),
    frozenFiles: files,
    frozenArtifactAggregateHash: c60StableHash(files),
    freezeTimestamp: "2026-08-27T00:10:00.000Z",
  };
  const freeze = blindOutputFreezeSchema.parse({
    ...freezeBase,
    freezeSemanticHash: c60SemanticHash(freezeBase),
  });
  await writeJson(path.join(root, "blind-output-freeze.json"), freeze);
  return { manifest, freeze, cues };
}

describe("C6.0.1 Gold-isolated evaluation flow", () => {
  it("evaluates two frozen runs without model inference or output mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c601-e2e-"));
    temporaryDirectories.push(root);
    const runAPath = path.join(root, "run-a");
    const runBPath = path.join(root, "run-b");
    await Promise.all([mkdir(runAPath), mkdir(runBPath)]);
    const [runA, runB] = await Promise.all([
      createRun(runAPath, "A"),
      createRun(runBPath, "B"),
    ]);
    const barrierBase = {
      schemaVersion: "1.0.0" as const,
      artifactType: "dual-blind-freeze-barrier" as const,
      barrierVersion: "c6.0.1-dual-freeze-barrier-v1" as const,
      acceptanceId: "fixture-acceptance",
      createdAt: "2026-08-27T00:20:00.000Z",
      runAPath,
      runBPath,
      runAFreezeHash: runA.freeze.freezeSemanticHash,
      runBFreezeHash: runB.freeze.freezeSemanticHash,
      runAInputHash: runA.manifest.inputSemanticHash,
      runBInputHash: runB.manifest.inputSemanticHash,
      runtimeIdentityParity: true,
      configurationParity: true,
      distinctOutputDirectories: true,
      distinctMediaCaches: true,
      distinctMachineMemoryStores: true,
      bothFrozenBeforeGold: true,
      goldReadAuthorized: true,
    };
    const barrier = dualBlindFreezeBarrierSchema.parse({
      ...barrierBase,
      semanticHash: c60SemanticHash(barrierBase),
    });
    const barrierPath = path.join(root, "barrier.json");
    await writeJson(barrierPath, barrier);
    const goldPath = path.join(root, "synthetic-gold.ass");
    const gold = formatAss(runA.cues).replace(
      /^(Dialogue:\s*[^,]+,\s*\d+:\d{2}:\d{2})\.(\d{2}),/mu,
      "$1,$2,",
    );
    await writeFile(goldPath, gold);
    const goldBuffer = Buffer.from(gold);
    const result = await evaluateDualBlindRunsAgainstGold({
      barrierPath,
      goldPath,
      expectedGoldSize: goldBuffer.byteLength,
      expectedGoldSha256: createHash("sha256").update(goldBuffer).digest("hex"),
      generatedAt: "2026-08-27T00:30:00.000Z",
    });
    expect(result.runA.globalTextMetrics.normalized.cer).toBe(0);
    expect(result.runB.globalTextMetrics.normalized.cer).toBe(0);
    expect(result.runA.modelInferenceCount).toBe(0);
    expect(result.runA.goldIdentity.timestampNormalizationCount).toBe(1);
    expect(result.runA.outputHashUnchangedAfterGold).toBe(true);
    expect(result.runA.goldMutationCount).toBe(0);
    expect(result.replaySemanticHashes.runA).toBe(result.runA.semanticHash);
    expect(result.replaySemanticHashes.runB).toBe(result.runB.semanticHash);
  });

  it("evaluates a frozen development ablation without relaxing final A/B rules", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c6011-e2e-"));
    temporaryDirectories.push(root);
    const runPath = path.join(root, "coverage-ablation");
    await mkdir(runPath);
    const run = await createRun(runPath, "A");
    const goldPath = path.join(root, "synthetic-gold.ass");
    const gold = formatAss(run.cues);
    await writeFile(goldPath, gold);
    const goldBuffer = Buffer.from(gold);
    const result = await evaluateFrozenBlindRunAgainstGold({
      taskDirectory: runPath,
      goldPath,
      expectedGoldSize: goldBuffer.byteLength,
      expectedGoldSha256: createHash("sha256").update(goldBuffer).digest("hex"),
      generatedAt: "2026-08-27T00:30:00.000Z",
      frozenBeforeGoldAt: "2026-08-27T00:20:00.000Z",
    });
    expect(result.evaluation.globalTextMetrics.normalized.cer).toBe(0);
    expect(result.evaluation.modelInferenceCount).toBe(0);
    expect(result.evaluation.outputHashUnchangedAfterGold).toBe(true);
    expect(result.replaySemanticHash).toBe(result.evaluation.semanticHash);
  });
});
