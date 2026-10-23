import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  atomicWriteJson,
  blindOutputFreezeSchema,
  subtitlePackageSchema,
  type SubtitleCue,
} from "@mvl/shared";
import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  buildAcousticRiskVectorEntry,
  buildAndApplyJointBoundaryRefinement,
  buildAndApplyPartialBoundaryRefinement,
  buildAndApplySpanTextRepair,
  buildAsrCeilingEvaluation,
  buildEventFinalCueLineage,
  buildEventFinalTextSpanLineage,
  buildMachineAcousticRiskVector,
  buildMachineDecoderEvidence,
  buildMachineReAsrPriority,
  buildMachineRequestEdgeRisk,
  c60SemanticHash,
  c60StableHash,
  sha256BlindFile,
} from "@mvl/video-subtitler";
import { afterEach, describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-28T13:30:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
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

function packageFixture(cues: readonly SubtitleCue[]) {
  return subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "source-fixture.mkv",
      container: "matroska",
      durationSeconds: 30,
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
}

function boundary(time: number | null, side: string) {
  return {
    coverage: time === null ? 0 : 0.95,
    proposedTime: time,
    trustedTokenIds: time === null ? [] : [`token:${side}`],
    evidenceIds: time === null ? [] : [`evidence:${side}`],
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

describe("C6.0.1.6 acoustic risk, span repair, and boundary flow", () => {
  it("runs machine-only evidence through strict outputs, freeze, and post-freeze ceiling classification", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c6016-e2e-"));
    temporaryDirectories.push(root);
    const subtitleDirectory = path.join(root, "subtitle-fixture");
    await mkdir(subtitleDirectory, { recursive: true });
    const source = path.join(root, "source-fixture.mkv");
    await writeFile(source, "synthetic-source-media");
    const sourceHashBefore = await sha256BlindFile(source);

    const edge = buildMachineRequestEdgeRisk({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      candidates: [
        {
          eventId: "event-1",
          candidateId: "candidate-current",
          requestId: "request-1",
          requestInterval: { start: 0, end: 10 },
          candidateInterval: { start: 0.2, end: 2 },
          tokenEdgeContact: true,
        },
      ],
    });
    const decoder = buildMachineDecoderEvidence({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      candidates: [
        {
          eventId: "event-1",
          candidateId: "candidate-current",
          requestId: "request-1",
          candidateFamily: "PRIMARY",
          decoderProvider: "whisper.cpp-mvl",
          averageLogProbability: { value: -1.7 },
          noSpeechProbability: { value: 0.1 },
          tokenTimestampAvailable: { value: true },
          tokenCount: { value: 3 },
          provenance: {
            sourceArtifact: "isolated-cache/response.json",
            sourceRequestId: "request-1",
            providerResponseRetained: true,
            sourceGlobalVerified: true,
          },
        },
      ],
    });
    const riskInput = {
      eventId: "event-1",
      candidateId: "candidate-current",
      requestEdgeRisk: edge.candidates[0]?.edgeRisk ?? "UNKNOWN",
      ctcScore: 0.3,
      tokenCoverage: 0.4,
      speechCoverage: 0.8,
      decoderAvailability: "available" as const,
      averageLogProbability: -1.7,
      noSpeechProbability: 0.1,
      independentWindowDisagreement: "WEAK" as const,
      repetitionRisk: 0,
      durationTextAnomaly: "NONE" as const,
      pronunciationCoverage: 0.3,
      associationAmbiguity: "NONE" as const,
      overlapRisk: "NONE" as const,
    };
    expect(buildAcousticRiskVectorEntry(riskInput).recommendedAction).toBe(
      "RE_ASR",
    );
    const risk = buildMachineAcousticRiskVector({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      events: [riskInput],
    });
    const priority = buildMachineReAsrPriority({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      riskVector: risk.events,
    });
    expect(priority.events[0]?.budgetSelected).toBe(true);

    const initial = packageFixture([
      cue("cue-1", "前おはよう後", 1, 3),
      cue("cue-2", "次", 2.9, 5),
    ]);
    const cueLineage = buildEventFinalCueLineage({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          candidateIds: ["candidate-current"],
          canonicalCueIds: ["canonical-1"],
        },
      ],
      finalCueIds: ["cue-1", "cue-2"],
      edges: [
        {
          sourceIds: ["canonical-1"],
          targetIds: ["cue-1"],
          relationType: "FINAL_SURVIVAL",
          operationArtifact: "survival.json",
          reason: "persistent identity survived",
        },
      ],
      dropped: [],
    });
    const spans = buildEventFinalTextSpanLineage({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      cueLineage,
      finalCues: initial.cues,
      eventTextSources: [
        {
          eventId: "event-1",
          currentCandidateId: "candidate-current",
          sourceCandidates: [
            { candidateId: "candidate-current", text: "おはよう" },
          ],
        },
      ],
    });
    const repaired = buildAndApplySpanTextRepair({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      package: initial,
      lineage: spans,
      selections: [
        {
          eventId: "event-1",
          replacementEventId: "event-1",
          replacementCandidateId: "candidate-reasr",
          replacementText: "おはようございます",
          evidenceIds: [decoder.semanticHash, priority.semanticHash],
          evidenceStronger: true,
          hallucinationNonIncreasePassed: true,
          timingCompatible: true,
          crossSpeakerJoinSafe: true,
        },
      ],
    });
    const partial = buildAndApplyPartialBoundaryRefinement({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      package: repaired.package,
      evidence: [
        {
          cueId: "cue-1",
          startEvidence: boundary(1.1, "start"),
          endEvidence: boundary(null, "end"),
        },
      ],
    });
    const joint = buildAndApplyJointBoundaryRefinement({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      package: partial.package,
      pairs: [
        {
          leftCueId: "cue-1",
          rightCueId: "cue-2",
          leftEndEvidence: boundary(2.8, "left-end"),
          rightStartEvidence: boundary(3, "right-start"),
          vadPause: null,
          speechContinuous: false,
          acousticOverlapSupported: false,
          speakerOverlapSupported: false,
          accidentalOverlapSupported: true,
          rapidTurn: true,
          evidenceIds: ["localized-overlap:evidence"],
        },
      ],
    });
    expect(joint.artifact.summary.accidentalOverlapResolvedCount).toBe(1);
    expect(joint.package.cues[0]?.text).toBe("前おはようございます後");

    await Promise.all([
      atomicWriteJson(
        path.join(subtitleDirectory, "subtitle-package.json"),
        joint.package,
      ),
      writeFile(
        path.join(subtitleDirectory, "fixture.ass"),
        formatAss(joint.package.cues),
      ),
      writeFile(
        path.join(subtitleDirectory, "fixture.srt"),
        formatSrt(joint.package.cues),
      ),
      writeFile(
        path.join(subtitleDirectory, "fixture.vtt"),
        formatVtt(joint.package.cues),
      ),
      atomicWriteJson(
        path.join(subtitleDirectory, "machine-request-edge-risk.json"),
        edge,
      ),
      atomicWriteJson(
        path.join(subtitleDirectory, "machine-decoder-evidence.json"),
        decoder,
      ),
      atomicWriteJson(
        path.join(subtitleDirectory, "machine-acoustic-risk-vector.json"),
        risk,
      ),
      atomicWriteJson(
        path.join(subtitleDirectory, "machine-reasr-priority.json"),
        priority,
      ),
      atomicWriteJson(
        path.join(
          subtitleDirectory,
          "machine-event-final-text-span-lineage.json",
        ),
        spans,
      ),
      atomicWriteJson(
        path.join(subtitleDirectory, "machine-span-text-repair.json"),
        repaired.artifact,
      ),
      atomicWriteJson(
        path.join(subtitleDirectory, "machine-partial-boundary-proposals.json"),
        partial.artifact,
      ),
      atomicWriteJson(
        path.join(subtitleDirectory, "machine-joint-boundary-refinement.json"),
        joint.artifact,
      ),
    ]);
    const frozen = await frozenFiles(root);
    const freezeBase = {
      schemaVersion: "1.0.0" as const,
      artifactType: "blind-output-freeze" as const,
      freezeVersion: "c6.0.1-machine-output-freeze-v1" as const,
      generationRunId: "c6-0-1-6-e2e",
      generationCommit: "a".repeat(40),
      sourceVideoSha256: sourceHashBefore,
      machinePackageHash: await sha256BlindFile(
        path.join(subtitleDirectory, "subtitle-package.json"),
      ),
      canonicalTextHash: c60StableHash(
        joint.package.cues.map((entry) => ({ id: entry.id, text: entry.text })),
      ),
      canonicalTimingHash: c60StableHash(
        joint.package.cues.map((entry) => ({
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
      machineEvidenceCoverageHash: spans.semanticHash,
      shadowPolicyHash: priority.semanticHash,
      shadowOutcome: "REVIEW_REQUIRED" as const,
      seriesMemoryHash: c60StableHash([]),
      provenanceHash: edge.semanticHash,
      frozenFiles: frozen,
      frozenArtifactAggregateHash: c60StableHash(frozen),
      freezeTimestamp: GENERATED_AT,
    };
    const freeze = blindOutputFreezeSchema.parse({
      ...freezeBase,
      freezeSemanticHash: c60SemanticHash(freezeBase),
    });
    await atomicWriteJson(path.join(root, "blind-output-freeze.json"), freeze);
    const ceiling = buildAsrCeilingEvaluation({
      generatedAt: GENERATED_AT,
      errors: [
        {
          errorId: "gold-evaluation-only-error-1",
          cueId: "cue-1",
          machineCandidateIds: ["candidate-current", "candidate-reasr"],
          evidenceIds: [freeze.freezeSemanticHash],
          multipleWhisperWindowsEvaluated: true,
          candidateTextAgreement: "CONSISTENT",
        },
      ],
    });
    expect(ceiling.zone).toBe("evaluation-only-gold-isolated");
    expect(ceiling.runtimeGoldInputCount).toBe(0);
    expect(ceiling.summary.currentWhisperConsistentlyWrong).toBe(1);
    expect(await sha256BlindFile(source)).toBe(sourceHashBefore);
  });
});
