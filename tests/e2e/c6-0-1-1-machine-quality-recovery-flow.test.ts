import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  blindGenerationInputManifestSchema,
  blindOutputFreezeSchema,
  machineCoverageRecoverySchema,
  machineGenerationSurvivalFunnelSchema,
  machineQualityRecoveryPolicySchema,
  machineSpeechCoverageGapSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  c60SemanticHash,
  c60StableHash,
  createC601EvaluationPolicy,
  emitMachineQualityRunArtifacts,
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

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function listRelativeFiles(
  root: string,
  current = root,
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(root, absolute)));
    } else if (entry.isFile() && entry.name !== ".DS_Store") {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return files.toSorted();
}

describe("C6.0.1.1 machine quality recovery flow", () => {
  it("emits machine-only quality evidence, stays fail closed, and evaluates Gold only after freeze", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "mvl-c6011-quality-e2e-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const root = path.join(temporaryRoot, "run");
    await mkdir(root);
    const audioDirectory = path.join(root, "audio");
    const subtitleDirectory = path.join(root, "subtitle-fixture");
    await Promise.all([
      mkdir(audioDirectory, { recursive: true }),
      mkdir(subtitleDirectory, { recursive: true }),
    ]);

    const cues = [
      {
        id: "cue-1",
        start: 0,
        end: 1.5,
        language: "ja",
        languages: ["ja"],
        text: "おはよう。",
        speaker: null,
        confidence: 0.9,
      },
      {
        id: "cue-2",
        start: 3,
        end: 4.5,
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
    const manifest = blindGenerationInputManifestSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "blind-generation-input-manifest",
      manifestVersion: "c6.0.1-blind-generation-input-v1",
      generatedAt: "2026-08-27T00:00:00.000Z",
      generationRunId: "c6-0-1-1-quality-fixture",
      benchmarkStatus: "development-known-runtime-blind",
      sourceVideo: { fileName: "fixture.mkv", size: 1, sha256: hash("a") },
      repositoryCommit: "b".repeat(40),
      allowedGenericResources: ["model-weights"],
      genericModelSnapshots: [
        {
          modelName: "large-v3",
          fileName: "fixture.bin",
          snapshotSha256: hash("c"),
          size: 1,
          genericResource: true,
        },
      ],
      runtimeIdentities: [
        {
          runtimeId: "whisper-cpp-production",
          name: "whisper.cpp",
          version: "1.9.1",
          executableFileName: "whisper-cli",
          device: "cpu",
          genericResource: true,
        },
      ],
      machineMemoryInitialState: {
        storeId: "empty-quality-fixture",
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
        "fixture.mkv",
        "--machine-quality-recovery",
        "enforce",
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

    await Promise.all([
      writeJson(
        path.join(root, "blind-generation-input-manifest.json"),
        manifest,
      ),
      writeJson(path.join(root, "machine-memory.json"), {
        entryCount: 0,
        humanDerived: false,
      }),
      writeJson(path.join(audioDirectory, "raw-transcription.json"), {
        timestampStrategy: "segment",
        baselineCues: cues.map((cue) => ({
          ...cue,
          tokens: [{ text: cue.text, start: cue.start, end: cue.end }],
        })),
      }),
      writeJson(path.join(audioDirectory, "audio-manifest.json"), {
        chunks: [
          { id: "chunk-1", start: 0, end: 2.5 },
          { id: "chunk-2", start: 2.5, end: 5 },
        ],
      }),
      writeJson(
        path.join(subtitleDirectory, "subtitle-package.json"),
        subtitlePackage,
      ),
      writeJson(path.join(subtitleDirectory, "canonical-asr-segments.json"), {
        rawSegmentCount: 2,
        rawSegments: cues.map((cue, index) => ({
          id: `raw-${index + 1}`,
          start: cue.start,
          end: cue.end,
          text: cue.text,
          tokens: [{ text: cue.text, start: cue.start, end: cue.end }],
        })),
        utterances: cues.map((cue, index) => ({
          id: `canonical-${index + 1}`,
          start: cue.start,
          end: cue.end,
          text: cue.text,
          sourceSegmentIds: [`raw-${index + 1}`],
          qualityStatus: "accepted",
          qualityReasons: [],
        })),
      }),
      writeJson(path.join(subtitleDirectory, "cue-candidate-evidence.json"), {
        candidates: cues.map((cue) => ({
          cueId: cue.id,
          id: cue.id,
          start: cue.start,
          end: cue.end,
          text: cue.text,
          selectionEligible: true,
          hardBlockReasons: [],
        })),
      }),
      writeJson(path.join(subtitleDirectory, "hypothesis-clusters.json"), {
        clusters: cues.map((cue) => ({ id: `cluster-${cue.id}` })),
      }),
      writeJson(path.join(subtitleDirectory, "top-score-winners.json"), {
        winners: cues.map((cue) => ({
          ...cue,
          provenance: { sourceRequestIds: [`canonical-${cue.id.slice(-1)}`] },
        })),
      }),
      writeJson(path.join(subtitleDirectory, "winner-deduplication.json"), {
        outputWinnerCount: 2,
        records: [],
      }),
      writeJson(path.join(subtitleDirectory, "fragment-repair.json"), {
        outputWinnerCount: 2,
        repairs: [],
      }),
      writeJson(
        path.join(subtitleDirectory, "post-normalization-deduplication.json"),
        { outputWinnerCount: 2, records: [] },
      ),
      writeJson(path.join(subtitleDirectory, "cue-segmentation-plan.json"), {
        summary: { outputCueCount: 2 },
        entries: cues.map((cue) => ({
          outputCueIds: [cue.id],
          outputIntervals: [{ start: cue.start, end: cue.end }],
        })),
      }),
      writeJson(path.join(subtitleDirectory, "final-subtitle-integrity.json"), {
        candidateCueCount: 2,
        finalCueCount: 2,
        quarantinedCueIds: [],
        findings: [],
      }),
      writeJson(
        path.join(subtitleDirectory, "missing-dialogue-recovery.json"),
        {
          summary: {
            recoveryUnits: 1,
            recoveryAsrRequests: 1,
            recoveredUnits: 0,
            stillNeedsReviewUnits: 1,
            autoCreatedFinalCues: 0,
            cacheHits: 0,
          },
          units: [
            {
              id: "recovery-1",
              extractedInterval: { start: 1.5, end: 3 },
              attempts: [
                {
                  id: "attempt-1",
                  asrRequestId: "recovery-request-1",
                  prompt: { adjacentOriginalLanguageText: [] },
                },
              ],
            },
          ],
        },
      ),
      writeJson(
        path.join(subtitleDirectory, "whisper-execution-metrics.json"),
        {
          asrRequestCount: 3,
          cacheHitCount: 0,
          modelLoadCount: 3,
          requestedMode: "process",
          executionMode: "process",
          transcriptionSeconds: 5,
          fallbackProcessCount: 0,
          workerStartCount: 3,
          requests: [
            { requestId: "primary-1", mode: "process", cacheHit: false },
            { requestId: "primary-2", mode: "process", cacheHit: false },
            {
              requestId: "recovery-request-1",
              mode: "process",
              cacheHit: false,
            },
          ],
        },
      ),
      writeJson(path.join(subtitleDirectory, "media-profile.json"), {
        speechIntervals: [{ id: "speech-1", start: 0, end: 4.5 }],
      }),
      writeJson(path.join(subtitleDirectory, "device-profile.json"), {
        whisperCpp: { version: "whisper.cpp version: 1.9.1" },
        cpu: { model: "fixture-cpu" },
        models: [
          {
            id: "large-v3",
            modelFamily: "large-v3",
            modelHash: hash("c"),
          },
        ],
      }),
      writeJson(path.join(subtitleDirectory, "transcription-plan.json"), {
        baseline: { capabilityId: "large-v3" },
      }),
      writeFile(path.join(subtitleDirectory, "fixture.ass"), formatAss(cues)),
      writeFile(path.join(subtitleDirectory, "fixture.srt"), formatSrt(cues)),
      writeFile(path.join(subtitleDirectory, "fixture.vtt"), formatVtt(cues)),
    ]);

    const emitted = await emitMachineQualityRunArtifacts({
      outputDirectory: root,
      runId: manifest.generationRunId,
      repositoryCommit: manifest.repositoryCommit,
      sourceMediaSha256: manifest.sourceVideo.sha256,
      mode: "enforce",
      profile: "full",
      targetChunkSeconds: 30,
      vadEnabled: false,
      sceneRouting: "aggressive",
      whisperExecutablePath: null,
    });
    expect(emitted.artifactCount).toBe(12);

    const funnel = machineGenerationSurvivalFunnelSchema.parse(
      await readJson(
        path.join(subtitleDirectory, "machine-generation-survival-funnel.json"),
      ),
    );
    const gap = machineSpeechCoverageGapSchema.parse(
      await readJson(
        path.join(subtitleDirectory, "machine-speech-coverage-gap.json"),
      ),
    );
    const recovery = machineCoverageRecoverySchema.parse(
      await readJson(
        path.join(subtitleDirectory, "machine-coverage-recovery.json"),
      ),
    );
    const policy = machineQualityRecoveryPolicySchema.parse(
      await readJson(
        path.join(subtitleDirectory, "machine-quality-recovery-policy.json"),
      ),
    );
    expect(funnel.snapshots.map((snapshot) => snapshot.id)).toContain(
      "final-machine-cue",
    );
    expect(funnel.summary.finalCueCount).toBe(2);
    expect(gap.gaps).toHaveLength(1);
    expect(recovery.adjacentPromptPolicy).toBe("disabled-unverified-context");
    expect(recovery.unverifiedAdjacentPromptCount).toBe(0);
    expect(policy.productionStatus).toBe("needs-review");
    expect(policy.finalizationMethod).toBe("none");
    expect(policy.machineOnlyReleaseAuthorized).toBe(false);
    expect(policy.run.goldRuntimeInputCount).toBe(0);

    const evaluationPolicy = createC601EvaluationPolicy(
      "2026-08-27T00:10:00.000Z",
    );
    await writeJson(
      path.join(root, "blind-evaluation-policy.json"),
      evaluationPolicy,
    );
    const frozenRelativePaths = await listRelativeFiles(root);
    const frozenFiles = await Promise.all(
      frozenRelativePaths.map(async (relativePath) => {
        const filePath = path.join(root, relativePath);
        return {
          relativePath,
          size: (await stat(filePath)).size,
          sha256: await sha256BlindFile(filePath),
        };
      }),
    );
    frozenFiles.sort((left, right) =>
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
      canonicalTextHash: hash("1"),
      canonicalTimingHash: hash("2"),
      presentationHash: hash("3"),
      assHash: await sha256BlindFile(
        path.join(subtitleDirectory, "fixture.ass"),
      ),
      srtHash: await sha256BlindFile(
        path.join(subtitleDirectory, "fixture.srt"),
      ),
      vttHash: await sha256BlindFile(
        path.join(subtitleDirectory, "fixture.vtt"),
      ),
      riskAssessmentHash: hash("4"),
      machineEvidenceCoverageHash: hash("5"),
      shadowPolicyHash: hash("6"),
      shadowOutcome: "REVIEW_REQUIRED" as const,
      seriesMemoryHash: hash("7"),
      provenanceHash: hash("8"),
      frozenFiles,
      frozenArtifactAggregateHash: c60StableHash(frozenFiles),
      freezeTimestamp: "2026-08-27T00:20:00.000Z",
    };
    const freeze = blindOutputFreezeSchema.parse({
      ...freezeBase,
      freezeSemanticHash: c60SemanticHash(freezeBase),
    });
    await writeJson(path.join(root, "blind-output-freeze.json"), freeze);

    const goldPath = path.join(temporaryRoot, "synthetic-gold.ass");
    const gold = formatAss(cues);
    await writeFile(goldPath, gold);
    const result = await evaluateFrozenBlindRunAgainstGold({
      taskDirectory: root,
      goldPath,
      expectedGoldSize: Buffer.byteLength(gold),
      expectedGoldSha256: createHash("sha256").update(gold).digest("hex"),
      generatedAt: "2026-08-27T00:30:00.000Z",
      frozenBeforeGoldAt: freeze.freezeTimestamp,
    });
    expect(result.evaluation.globalTextMetrics.normalized.cer).toBe(0);
    expect(result.evaluation.modelInferenceCount).toBe(0);
    expect(result.evaluation.goldMutationCount).toBe(0);
    expect(result.evaluation.outputHashUnchangedAfterGold).toBe(true);
  });
});
