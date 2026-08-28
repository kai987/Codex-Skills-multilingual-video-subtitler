import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  blindGenerationInputManifestSchema,
  blindOutputFreezeSchema,
  decoderEvidenceSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import {
  applyCanonicalMutations,
  buildC6015CandidatePool,
  buildCanonicalMutationProposals,
  buildEvidenceApplicationCoverage,
  buildEventFinalCueLineage,
  buildRawAsrEventRecoveryArtifact,
  buildSingleVariantAcousticAudit,
  buildTrustedTokenTimingProposals,
  buildVariantEvidenceBundle,
  c60SemanticHash,
  c60StableHash,
  createC601EvaluationPolicy,
  evaluateFrozenBlindRunAgainstGold,
  planRawAsrEventRecovery,
  sha256BlindFile,
} from "@mvl/video-subtitler";
import { afterEach, describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-28T01:00:00.000Z";
const temporaryDirectories: string[] = [];

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

async function listFiles(root: string, current = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || entry.name === "blind-output-freeze.json")
      continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listFiles(root, absolute)));
    } else if (entry.isFile()) {
      output.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return output.toSorted();
}

function decoder(input?: { weak?: boolean }) {
  return decoderEvidenceSchema.parse({
    status: "available",
    averageLogProbability: input?.weak ? -1.5 : -0.2,
    noSpeechProbability: input?.weak ? 0.3 : 0.01,
    compressionRatio: 1.1,
    repetitionRatio: 0,
    tokenTimingQuality: input?.weak ? 0.3 : 0.9,
    textDensity: 2,
    edgePosition: "inside",
    fallbackLevel: 0,
    temperature: 0,
    requestDurationSeconds: 2,
    decoderEvidenceHash: createHash("sha256")
      .update(input?.weak ? "weak" : "strong")
      .digest("hex"),
    unavailableReasons: [],
  });
}

describe("C6.0.1.5 evidence-to-canonical machine flow", () => {
  it("recovers a weak event, mutates strict outputs, freezes them, and reads Gold only post-freeze", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mvl-c6015-e2e-"));
    temporaryDirectories.push(root);
    const runDirectory = path.join(root, "machine-run");
    const subtitleDirectory = path.join(runDirectory, "subtitle-fixture");
    await mkdir(subtitleDirectory, { recursive: true });
    const sourcePath = path.join(root, "source-fixture.mkv");
    await writeFile(sourcePath, "synthetic-source-media");
    const sourceInfo = await stat(sourcePath);
    const sourceSha256 = await sha256BlindFile(sourcePath);

    const cues = [
      {
        id: "cue-1",
        start: 10,
        end: 12,
        language: "ja" as const,
        languages: ["ja" as const],
        text: "おはよ",
        textSource: "audio-asr" as const,
        speaker: null,
        confidence: 0.6,
      },
    ];
    const lineage = buildEventFinalCueLineage({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          candidateIds: ["candidate-current"],
          canonicalCueIds: ["canonical-1"],
        },
      ],
      finalCueIds: ["cue-1"],
      edges: [
        {
          sourceIds: ["canonical-1"],
          targetIds: ["assembled-1"],
          relationType: "CANONICAL_ASSEMBLY",
          operationArtifact: "machine-canonical-event.json",
          reason: "canonical event assembled by persistent id",
        },
        {
          sourceIds: ["assembled-1"],
          targetIds: ["cue-1"],
          relationType: "FINAL_SURVIVAL",
          operationArtifact: "machine-generation-survival-funnel.json",
          reason: "assembled event survived to final package",
        },
      ],
      dropped: [],
    });

    const initialEvidence = buildVariantEvidenceBundle({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      variants: [
        {
          variantId: "candidate-current",
          eventId: "event-1",
          candidateId: "candidate-current",
          text: "おはよ",
          interval: { start: 10.1, end: 11.9 },
          eventInterval: { start: 10, end: 12 },
          requestIds: ["request-current"],
          sourceWindowIds: ["source-window-current"],
          independentSupportGroups: ["whisper-window-current"],
          correlatedSupportGroups: [],
          speechCoverage: 0.9,
          reAsrOrigin: {
            isReAsr: false,
            requestFamilyIds: [],
            sourceGlobalVerified: true,
            promptIsolated: true,
          },
          decoderEvidence: decoder({ weak: true }),
        },
      ],
      tokens: [],
      ctcEvidence: [
        {
          variantId: "candidate-current",
          evidenceId: "ctc-current",
          score: 0.2,
          edgePinned: false,
        },
      ],
    });
    const audit = buildSingleVariantAcousticAudit({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      singleVariantIds: ["candidate-current"],
      variantEvidence: initialEvidence,
    });
    expect(audit.events[0]?.reAsrEligibility).toBe(true);
    const recoveryPlan = planRawAsrEventRecovery({
      audit,
      eventIntervals: new Map([["event-1", { start: 10, end: 12 }]]),
      sourceTotalSamples: 16_000 * 30,
    });
    expect(
      recoveryPlan.events[0]?.requests.every(
        (request) => (request as { prompt: unknown }).prompt === null,
      ),
    ).toBe(true);
    const recoveredVariantId = "c6015-raw-reasr:event-1:recovered";
    const recovery = buildRawAsrEventRecoveryArtifact({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      audit,
      plan: recoveryPlan.events,
      executed: [
        {
          eventId: "event-1",
          requestIds:
            recoveryPlan.events[0]?.requests.map(
              (request) => request.requestId,
            ) ?? [],
          requestFamilyIds: ["c6015-raw-asr-family:event-1"],
          sourceGlobalVerified: true,
          requestsExecuted: 3,
          cacheHitCount: 0,
          inferenceCount: 3,
          modelLoadCount: 1,
          newCandidateIds: [recoveredVariantId],
          evaluatedCandidateIds: ["candidate-current", recoveredVariantId],
          selectedCandidateId: recoveredVariantId,
        },
      ],
      multiVariantTriggeredCount: 0,
      workerStartCount: 1,
      improvedPoolRuntimeProxyCount: 1,
      replacedByReAsrCount: 1,
    });

    const refreshedEvidence = buildVariantEvidenceBundle({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      variants: [
        {
          variantId: "candidate-current",
          eventId: "event-1",
          candidateId: "candidate-current",
          text: "おはよ",
          interval: { start: 10.1, end: 11.9 },
          eventInterval: { start: 10, end: 12 },
          requestIds: ["request-current"],
          sourceWindowIds: ["source-window-current"],
          independentSupportGroups: ["whisper-window-current"],
          correlatedSupportGroups: [],
          speechCoverage: 0.9,
          reAsrOrigin: {
            isReAsr: false,
            requestFamilyIds: [],
            sourceGlobalVerified: true,
            promptIsolated: true,
          },
          decoderEvidence: decoder({ weak: true }),
        },
        {
          variantId: recoveredVariantId,
          eventId: "event-1",
          candidateId: recoveredVariantId,
          text: "おはよう",
          interval: { start: 10.2, end: 11.7 },
          eventInterval: { start: 10, end: 12 },
          requestIds:
            recoveryPlan.events[0]?.requests.map(
              (request) => request.requestId,
            ) ?? [],
          sourceWindowIds: ["source-global-recovery-window"],
          independentSupportGroups: ["whisper-recovery", "ctc-recovery"],
          correlatedSupportGroups: [],
          speechCoverage: 0.95,
          reAsrOrigin: {
            isReAsr: true,
            requestFamilyIds: ["c6015-raw-asr-family:event-1"],
            sourceGlobalVerified: true,
            promptIsolated: true,
          },
          decoderEvidence: decoder(),
        },
      ],
      tokens: [
        {
          tokenId: "mapped-token-recovered",
          variantId: recoveredVariantId,
          text: "おはよう",
          lexical: true,
          trusted: true,
        },
      ],
      ctcEvidence: [
        {
          variantId: "candidate-current",
          evidenceId: "ctc-current",
          score: 0.2,
          edgePinned: false,
        },
        {
          variantId: recoveredVariantId,
          evidenceId: "ctc-recovered",
          score: 0.9,
          edgePinned: false,
        },
      ],
    });
    const timing = buildTrustedTokenTimingProposals({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      cues,
      lineage,
      variantEvidence: refreshedEvidence,
      selectedVariantByEvent: new Map([["event-1", recoveredVariantId]]),
      tokens: [
        {
          tokenId: "mapped-token-recovered",
          variantId: recoveredVariantId,
          trusted: true,
          lexical: true,
          sourceGlobalInterval: { start: 10.2, end: 11.7 },
        },
      ],
      timingEligibleCueIds: new Set(["cue-1"]),
    });
    const proposals = buildCanonicalMutationProposals({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      cues,
      lineage,
      variantEvidence: refreshedEvidence,
      selections: [
        {
          eventId: "event-1",
          currentVariantId: "candidate-current",
          selectedVariantId: recoveredVariantId,
        },
      ],
      candidateTexts: [
        {
          variantId: "candidate-current",
          text: "おはよ",
          hallucinationRisk: 0.4,
        },
        {
          variantId: recoveredVariantId,
          text: "おはよう",
          hallucinationRisk: 0.05,
        },
      ],
      timing,
    });
    const candidatePool = buildC6015CandidatePool({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      selectedByEvent: new Map([["event-1", recoveredVariantId]]),
      evidence: refreshedEvidence,
      proposals,
      events: [
        {
          eventId: "event-1",
          currentVariantId: "candidate-current",
          variants: [
            {
              variantId: "candidate-current",
              eventId: "event-1",
              text: "おはよ",
              interval: { start: 10.1, end: 11.9 },
              eventInterval: { start: 10, end: 12 },
              requestIds: ["request-current"],
              sourceWindowIds: ["source-window-current"],
              independentSupportGroups: ["whisper-window-current"],
              correlatedSupportGroups: [],
              reAsrOrigin: {
                isReAsr: false,
                sourceGlobalVerified: true,
                promptIsolated: true,
              },
            },
            {
              variantId: recoveredVariantId,
              eventId: "event-1",
              text: "おはよう",
              interval: { start: 10.2, end: 11.7 },
              eventInterval: { start: 10, end: 12 },
              requestIds:
                recoveryPlan.events[0]?.requests.map(
                  (request) => request.requestId,
                ) ?? [],
              sourceWindowIds: ["source-global-recovery-window"],
              independentSupportGroups: ["whisper-recovery", "ctc-recovery"],
              correlatedSupportGroups: [],
              reAsrOrigin: {
                isReAsr: true,
                sourceGlobalVerified: true,
                promptIsolated: true,
              },
            },
          ],
        },
      ],
    });
    const originalPackage = subtitlePackageSchema.parse({
      schemaVersion: "1.0.0",
      packageType: "multilingual-subtitle-package",
      status: "ready",
      sourceLanguage: "ja",
      detectedLanguages: ["ja"],
      source: {
        fileName: path.basename(sourcePath),
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
    const applied = applyCanonicalMutations({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      package: originalPackage,
      proposals,
      lineage,
    });
    const coverage = buildEvidenceApplicationCoverage({
      trustedTokenCount: 1,
      timingEligibleCueCount: 1,
      ctcEvidenceCount: 2,
      variantDecisionCount: 1,
      lineage,
      variants: refreshedEvidence,
      timing,
      recovery,
      proposals,
      ledger: applied.ledger,
      generatedAt: GENERATED_AT,
    });

    expect(applied.package.cues[0]).toMatchObject({
      text: "おはよう",
      start: 10.16,
      end: 11.78,
    });
    expect(applied.ledger.summary).toMatchObject({
      textMutationAppliedCount: 1,
      timingMutationAppliedCount: 1,
      unsupportedMutationCount: 0,
    });
    expect(coverage).toMatchObject({
      reAsrCandidateCount: 1,
      reAsrCandidateEvaluatedCount: 1,
      reAsrCandidateSelectedCount: 1,
      engineeringGatePassed: true,
    });
    expect(candidatePool.summary).toMatchObject({
      c6015RawReAsrCandidateCount: 1,
      selectedRawReAsrCandidateCount: 1,
      selectionChangedEventCount: 1,
      freeRewriteCount: 0,
      candidateTextPromptLeakCount: 0,
    });
    expect(
      candidatePool.candidates.find(
        (candidate) => candidate.variantId === recoveredVariantId,
      ),
    ).toMatchObject({
      text: "おはよう",
      origin: "c6.0.1.5-raw-reasr",
      selected: true,
      evidenceCompleteness: "COMPLETE",
    });

    const manifest = blindGenerationInputManifestSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "blind-generation-input-manifest",
      manifestVersion: "c6.0.1-blind-generation-input-v1",
      generatedAt: GENERATED_AT,
      generationRunId: "c6-0-1-5-e2e",
      benchmarkStatus: "development-known-runtime-blind",
      sourceVideo: {
        fileName: path.basename(sourcePath),
        size: sourceInfo.size,
        sha256: sourceSha256,
      },
      repositoryCommit: "b".repeat(40),
      allowedGenericResources: ["model-weights"],
      genericModelSnapshots: [
        {
          modelName: "fixture-model",
          fileName: "fixture.bin",
          snapshotSha256: "c".repeat(64),
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
        storeId: "empty-c6015-e2e",
        entryCount: 0,
        storeHash: "d".repeat(64),
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
      ].map((artifactClass) => ({
        artifactClass,
        used: false,
        inputCount: 0,
      })),
      generationArguments: [
        "--input",
        "source-fixture.mkv",
        "--machine-quality-recovery",
        "enforce",
        "--single-variant-audit",
        "enforce",
        "--raw-asr-recovery",
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
      inputSemanticHash: "e".repeat(64),
    });
    const policy = createC601EvaluationPolicy(GENERATED_AT);
    await Promise.all([
      writeJson(
        path.join(runDirectory, "blind-generation-input-manifest.json"),
        manifest,
      ),
      writeJson(
        path.join(runDirectory, "blind-evaluation-policy.json"),
        policy,
      ),
      writeJson(
        path.join(runDirectory, "machine-event-to-final-cue-lineage.json"),
        lineage,
      ),
      writeJson(
        path.join(runDirectory, "machine-variant-evidence-bundle.json"),
        refreshedEvidence,
      ),
      writeJson(
        path.join(runDirectory, "machine-candidate-pool-c6-0-1-5.json"),
        candidatePool,
      ),
      writeJson(
        path.join(runDirectory, "machine-single-variant-acoustic-audit.json"),
        audit,
      ),
      writeJson(
        path.join(runDirectory, "machine-raw-asr-event-recovery.json"),
        recovery,
      ),
      writeJson(
        path.join(runDirectory, "machine-trusted-token-timing-proposals.json"),
        timing,
      ),
      writeJson(
        path.join(runDirectory, "machine-canonical-mutation-proposals.json"),
        proposals,
      ),
      writeJson(
        path.join(runDirectory, "machine-canonical-mutation-ledger.json"),
        applied.ledger,
      ),
      writeJson(
        path.join(runDirectory, "machine-evidence-application-coverage.json"),
        coverage,
      ),
      writeJson(
        path.join(subtitleDirectory, "subtitle-package.json"),
        applied.package,
      ),
      writeFile(
        path.join(subtitleDirectory, "fixture.srt"),
        applied.serialized.srt,
      ),
      writeFile(
        path.join(subtitleDirectory, "fixture.vtt"),
        applied.serialized.vtt,
      ),
      writeFile(
        path.join(subtitleDirectory, "fixture.ass"),
        applied.serialized.ass,
      ),
    ]);

    const frozenFiles = await Promise.all(
      (await listFiles(runDirectory)).map(async (relativePath) => {
        const absolute = path.join(runDirectory, relativePath);
        const info = await stat(absolute);
        return {
          relativePath,
          size: info.size,
          sha256: await sha256BlindFile(absolute),
        };
      }),
    );
    const freezeBase = {
      schemaVersion: "1.0.0" as const,
      artifactType: "blind-output-freeze" as const,
      freezeVersion: "c6.0.1-machine-output-freeze-v1" as const,
      generationRunId: manifest.generationRunId,
      generationCommit: manifest.repositoryCommit,
      sourceVideoSha256: sourceSha256,
      machinePackageHash: await sha256BlindFile(
        path.join(subtitleDirectory, "subtitle-package.json"),
      ),
      canonicalTextHash: applied.ledger.finalHashes.canonicalTextHash,
      canonicalTimingHash: applied.ledger.finalHashes.canonicalTimingHash,
      presentationHash: applied.ledger.finalHashes.presentationHash,
      assHash: await sha256BlindFile(
        path.join(subtitleDirectory, "fixture.ass"),
      ),
      srtHash: await sha256BlindFile(
        path.join(subtitleDirectory, "fixture.srt"),
      ),
      vttHash: await sha256BlindFile(
        path.join(subtitleDirectory, "fixture.vtt"),
      ),
      riskAssessmentHash: "f".repeat(64),
      machineEvidenceCoverageHash: coverage.semanticHash,
      shadowPolicyHash: "1".repeat(64),
      shadowOutcome: "REVIEW_REQUIRED" as const,
      seriesMemoryHash: "2".repeat(64),
      provenanceHash: "3".repeat(64),
      frozenFiles,
      frozenArtifactAggregateHash: c60StableHash(frozenFiles),
      freezeTimestamp: "2026-08-28T01:10:00.000Z",
    };
    const freeze = blindOutputFreezeSchema.parse({
      ...freezeBase,
      freezeSemanticHash: c60SemanticHash(freezeBase),
    });
    await writeJson(
      path.join(runDirectory, "blind-output-freeze.json"),
      freeze,
    );

    // Gold is intentionally created only after the machine artifacts and
    // their complete file-set freeze have been persisted.
    const goldPath = path.join(root, "gold.ass");
    await writeFile(goldPath, applied.serialized.ass);
    const goldInfo = await stat(goldPath);
    const goldSha256 = await sha256BlindFile(goldPath);
    const evaluation = await evaluateFrozenBlindRunAgainstGold({
      taskDirectory: runDirectory,
      goldPath,
      expectedGoldSize: goldInfo.size,
      expectedGoldSha256: goldSha256,
      generatedAt: "2026-08-28T01:20:00.000Z",
      frozenBeforeGoldAt: "2026-08-28T01:10:00.000Z",
    });
    expect(evaluation.evaluation.globalTextMetrics.normalized.cer).toBe(0);
    expect(evaluation.evaluation.modelInferenceCount).toBe(0);
    expect(evaluation.evaluation.goldMutationCount).toBe(0);
    expect(evaluation.evaluation.outputHashUnchangedAfterGold).toBe(true);
    expect(evaluation.replaySemanticHash).toBe(
      evaluation.evaluation.semanticHash,
    );
  });
});
