import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  atomicWriteJson,
  blindOutputFreezeSchema,
  subtitlePackageSchema,
  type SubtitleCue,
} from "@mvl/shared";
import {
  buildAndApplySpanTextRepair,
  buildAsrCeilingEvaluationV2,
  buildEventFinalCueLineage,
  buildEventFinalTextSpanLineage,
  buildFreshCandidateComparison,
  buildMachineAcousticRiskVector,
  buildMachineFreshTargetedReAsr,
  buildMachineReAsrRiskV2,
  buildReAsrCausalEvaluation,
  c60SemanticHash,
  c60StableHash,
  freshCandidateInputs,
  machineQualitySemanticHash,
  planFreshTargetedReAsr,
  sha256BlindFile,
  type ExecutedFreshReAsrRequest,
} from "@mvl/video-subtitler";
import { afterEach, describe, expect, it } from "vitest";

import { freshWhisperResponse } from "../helpers/c6-0-1-7-fixtures.js";

const GENERATED_AT = "2026-08-29T12:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
): SubtitleCue {
  return {
    id,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    text,
    textSource: "audio-asr",
    speaker: null,
    confidence: 0.8,
  };
}

async function frozenFiles(
  root: string,
  current = root,
): Promise<{ relativePath: string; size: number; sha256: string }[]> {
  const files: { relativePath: string; size: number; sha256: string }[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await frozenFiles(root, absolute)));
    } else if (entry.isFile() && entry.name !== "blind-output-freeze.json") {
      const info = await stat(absolute);
      files.push({
        relativePath: path.relative(root, absolute).split(path.sep).join("/"),
        size: info.size,
        sha256: await sha256BlindFile(absolute),
      });
    }
  }
  return files.toSorted((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

describe("C6.0.1.7 Fresh Re-ASR and Gold-isolated ceiling E2E", () => {
  it("flows from machine-only risk through frozen Fresh evidence and post-freeze evaluation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c6017-e2e-"));
    temporaryDirectories.push(root);
    const subtitleDirectory = path.join(root, "subtitle-fixture");
    await mkdir(subtitleDirectory, { recursive: true });
    const sourcePath = path.join(root, "source-fixture.mkv");
    await writeFile(sourcePath, "immutable-source-media");
    const sourceHashBefore = await sha256BlindFile(sourcePath);

    const oldRisk = buildMachineAcousticRiskVector({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          candidateId: "candidate-original",
          requestEdgeRisk: "STRONG",
          ctcScore: 0.2,
          tokenCoverage: 0,
          tokenConflict: false,
          speechCoverage: 1,
          decoderAvailability: "available",
          averageLogProbability: -1.5,
          noSpeechProbability: 0.01,
          independentWindowDisagreement: "STRONG",
          repetitionRisk: 0,
          durationTextAnomaly: "NONE",
          pronunciationCoverage: 0.2,
          associationAmbiguity: "NONE",
          overlapRisk: "NONE",
        },
      ],
    });
    const risk = buildMachineReAsrRiskV2({
      mode: "enforce",
      riskVector: oldRisk.events,
      generatedAt: GENERATED_AT,
    });
    const plan = planFreshTargetedReAsr({
      risk,
      eventIntervals: new Map([["event-1", { start: 1, end: 3 }]]),
      sourceTotalSamples: 10 * 16_000,
      generationId: "e2e-fresh",
    });
    const executions: ExecutedFreshReAsrRequest[] = plan.flatMap((event) =>
      event.requests.map((request, index) => ({
        plan: request,
        extractionIdentity: machineQualitySemanticHash([request, "extraction"]),
        requestIdentity: machineQualitySemanticHash([request, "fresh-request"]),
        audioSha256: machineQualitySemanticHash([request, "audio"]),
        sampleCount:
          request.sourceGlobalSampleInterval.endSample -
          request.sourceGlobalSampleInterval.startSample,
        cacheHit: false,
        inferenceExecuted: true,
        modelLoadCount: index === 0 ? 1 : 0,
        processStartCount: index === 0 ? 1 : 0,
        transcriptionSeconds: 0.1,
        response: freshWhisperResponse("正しい文"),
      })),
    );
    const candidateId = `c6017-fresh-reasr:event-1:${machineQualitySemanticHash("正しい文").slice(0, 16)}`;
    const fresh = buildMachineFreshTargetedReAsr({
      mode: "enforce",
      generationKind: "FRESH_INFERENCE",
      sourceMediaSha256: sourceHashBefore,
      sourceTotalSamples: 10 * 16_000,
      plannedEvents: plan,
      executedRequests: executions,
      ctcEvidenceByCandidateId: new Map([
        [
          candidateId,
          {
            status: "SCORABLE",
            score: 0.9,
            evidenceId: "ctc:e2e",
            runtimeIdentityHash: HASH_A,
            modelSnapshotHash: HASH_B,
            edgePinned: false,
            pronunciationStatus: "PROJECTED",
            projectionTextHash: HASH_A,
            unresolvedUnits: [],
          },
        ],
      ]),
      runtime: {
        whisperCppVersion: "v1.9.3",
        runtimeBinarySha256: HASH_A,
        runtimePatchSha256: HASH_B,
        modelSha256: HASH_A,
        modelBasename: "fixture.bin",
        device: "cpu",
      },
      generatedAt: GENERATED_AT,
    });
    expect(fresh.candidates[0]?.evidenceComplete).toBe(true);

    const initialPackage = subtitlePackageSchema.parse({
      schemaVersion: "1.0.0",
      packageType: "multilingual-subtitle-package",
      status: "ready",
      sourceLanguage: "ja",
      detectedLanguages: ["ja"],
      source: {
        fileName: "source-fixture.mkv",
        container: "matroska",
        durationSeconds: 10,
      },
      identity: { title: "Fixture", season: null, episode: 1, year: 2026 },
      primarySubtitle: {
        language: "ja",
        sourceType: "transcription",
        validationStatus: "needs-review",
        streamIndex: null,
      },
      subtitleFiles: {
        ass: "fixture.ass",
        srt: "fixture.srt",
        vtt: "fixture.vtt",
      },
      referenceSubtitles: [],
      video: { sourcePath: null, subtitledPath: null },
      cues: [cue("cue-1", "誤り文", 1, 3)],
      warnings: [],
    });
    const cueLineage = buildEventFinalCueLineage({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          candidateIds: ["candidate-original"],
          canonicalCueIds: ["canonical-1"],
        },
      ],
      finalCueIds: ["cue-1"],
      edges: [
        {
          sourceIds: ["canonical-1"],
          targetIds: ["cue-1"],
          relationType: "FINAL_SURVIVAL",
          operationArtifact: "fixture-lineage.json",
          reason: "explicit fixture survival",
        },
      ],
      dropped: [],
    });
    const spanLineage = buildEventFinalTextSpanLineage({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      cueLineage,
      finalCues: initialPackage.cues,
      eventTextSources: [
        {
          eventId: "event-1",
          currentCandidateId: "candidate-original",
          sourceCandidates: [
            { candidateId: "candidate-original", text: "誤り文" },
          ],
        },
      ],
    });
    const comparison = buildFreshCandidateComparison({
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          originalCandidateId: "candidate-original",
          candidates: [
            {
              candidateId: "candidate-original",
              eventId: "event-1",
              origin: "ORIGINAL",
              text: "誤り文",
              ctcSupport: 0.2,
              averageLogProbability: -1.5,
              noSpeechProbability: 0.1,
              independentWindowSupport: 1,
              trustedTokenCoverage: 0,
              speechCompleteness: 1,
              requestEdgeRisk: "STRONG",
              pronunciationSupport: 0.2,
              repetitionRisk: 0,
              hallucinationRisk: 0.2,
              evidenceComplete: false,
            },
            ...freshCandidateInputs(fresh.candidates),
          ],
          spanLineageSafe: true,
          associationSafe: true,
          safetyGatePass: true,
          applyReplacement: true,
        },
      ],
    });
    const replacement = fresh.candidates[0];
    if (replacement === undefined) throw new Error("Fresh candidate missing.");
    const applied = buildAndApplySpanTextRepair({
      mode: "enforce",
      package: initialPackage,
      lineage: spanLineage,
      generatedAt: GENERATED_AT,
      selections: [
        {
          eventId: "event-1",
          replacementEventId: "event-1",
          replacementCandidateId: replacement.candidateId,
          replacementText: replacement.text,
          evidenceIds: [replacement.semanticHash],
          evidenceStronger: true,
          hallucinationNonIncreasePassed: true,
          timingCompatible: true,
          crossSpeakerJoinSafe: true,
        },
      ],
    });
    expect(comparison.events[0]?.replacementApplied).toBe(true);
    expect(applied.package.cues[0]?.text).toBe("正しい文");
    expect(applied.package.cues[0]?.start).toBe(1);
    expect(applied.package.cues[0]?.end).toBe(3);

    await Promise.all([
      atomicWriteJson(
        path.join(subtitleDirectory, "subtitle-package.json"),
        applied.package,
      ),
      atomicWriteJson(
        path.join(subtitleDirectory, "machine-reasr-risk-v2.json"),
        risk,
      ),
      atomicWriteJson(
        path.join(subtitleDirectory, "machine-fresh-targeted-reasr.json"),
        fresh,
      ),
      atomicWriteJson(
        path.join(subtitleDirectory, "machine-fresh-candidate-comparison.json"),
        comparison,
      ),
      writeFile(
        path.join(subtitleDirectory, "fixture.ass"),
        formatAss(applied.package.cues),
      ),
      writeFile(
        path.join(subtitleDirectory, "fixture.srt"),
        formatSrt(applied.package.cues),
      ),
      writeFile(
        path.join(subtitleDirectory, "fixture.vtt"),
        formatVtt(applied.package.cues),
      ),
    ]);
    const files = await frozenFiles(root);
    const freezeCore = {
      schemaVersion: "1.0.0" as const,
      artifactType: "blind-output-freeze" as const,
      freezeVersion: "c6.0.1-machine-output-freeze-v1" as const,
      generationRunId: "c6-0-1-7-e2e",
      generationCommit: "1".repeat(40),
      sourceVideoSha256: sourceHashBefore,
      machinePackageHash: await sha256BlindFile(
        path.join(subtitleDirectory, "subtitle-package.json"),
      ),
      canonicalTextHash: c60StableHash(
        applied.package.cues.map((entry) => ({
          id: entry.id,
          text: entry.text,
        })),
      ),
      canonicalTimingHash: c60StableHash(
        applied.package.cues.map((entry) => ({
          id: entry.id,
          start: entry.start,
          end: entry.end,
        })),
      ),
      presentationHash: c60StableHash({
        ass: await sha256BlindFile(path.join(subtitleDirectory, "fixture.ass")),
        srt: await sha256BlindFile(path.join(subtitleDirectory, "fixture.srt")),
        vtt: await sha256BlindFile(path.join(subtitleDirectory, "fixture.vtt")),
      }),
      assHash: await sha256BlindFile(
        path.join(subtitleDirectory, "fixture.ass"),
      ),
      srtHash: await sha256BlindFile(
        path.join(subtitleDirectory, "fixture.srt"),
      ),
      vttHash: await sha256BlindFile(
        path.join(subtitleDirectory, "fixture.vtt"),
      ),
      riskAssessmentHash: risk.semanticHash,
      machineEvidenceCoverageHash: spanLineage.semanticHash,
      shadowPolicyHash: comparison.semanticHash,
      shadowOutcome: "REVIEW_REQUIRED" as const,
      seriesMemoryHash: c60StableHash([]),
      provenanceHash: fresh.semanticHash,
      frozenFiles: files,
      frozenArtifactAggregateHash: c60StableHash(files),
      freezeTimestamp: GENERATED_AT,
    };
    const freeze = blindOutputFreezeSchema.parse({
      ...freezeCore,
      freezeSemanticHash: c60SemanticHash(freezeCore),
    });
    await atomicWriteJson(path.join(root, "blind-output-freeze.json"), freeze);
    const frozenBeforeGold = await readFile(
      path.join(root, "blind-output-freeze.json"),
      "utf8",
    );

    const causal = buildReAsrCausalEvaluation({
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          baselineDistance: 1,
          oldPoolBestDistance: 1,
          freshPoolBestDistance: 0,
          runtimeSelectedDistance: 0,
          freshWindowUnstable: false,
          replacementApplied: true,
          evidenceIds: ["post-freeze-gold-alignment"],
        },
      ],
    });
    const ceiling = buildAsrCeilingEvaluationV2({
      fresh,
      comparison,
      causal,
      generatedAt: GENERATED_AT,
    });
    expect(ceiling.summary).toMatchObject({
      testedSafeReplacement: 1,
      ceilingValidationPassed: true,
    });
    expect(
      await readFile(path.join(root, "blind-output-freeze.json"), "utf8"),
    ).toBe(frozenBeforeGold);
    expect(await sha256BlindFile(sourcePath)).toBe(sourceHashBefore);
  });
});
