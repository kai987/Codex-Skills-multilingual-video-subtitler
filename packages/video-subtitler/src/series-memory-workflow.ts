import {
  c519CausalValidationSchema,
  type EpisodeIdentity,
  type CorrectionFeedback,
  type SeriesIdentity,
  type SeriesLanguageMemory,
  type SubtitleCanonicalAlignmentInput,
  type SubtitleCanonicalPronunciation,
  type SubtitleCue,
} from "@mvl/shared";
import {
  buildSeriesAwareTerminologyRanking,
  buildSeriesMemoryQualityAudit,
  buildSubtitleSeriesMemoryEvidence,
  emptySeriesLanguageMemory,
  extractEpisodeLanguageObservations,
  mergeSeriesLanguageMemory,
  projectSeriesMemoryPronunciations,
  promoteEpisodeLanguageObservations,
  runCausalMemoryReplay,
  stableMemoryHash,
  type MemoryRankingPoolInput,
} from "@mvl/transcription-core";

export function runSeriesMemoryWorkflow(input: {
  runKind: "bootstrap" | "causal" | "frozen";
  memoryMode?: "off" | "observe" | "learn";
  pronunciationProjectionEnabled?: boolean;
  cues: readonly SubtitleCue[];
  alignment: SubtitleCanonicalAlignmentInput;
  pronunciation: SubtitleCanonicalPronunciation;
  seriesIdentity: SeriesIdentity;
  episodeIdentity: EpisodeIdentity;
  sourceArtifactHashes: Record<string, string>;
  baseCueHash: string;
  rankingPools: readonly MemoryRankingPoolInput[];
  memoryInput?: SeriesLanguageMemory | null;
  generatedAt?: string;
  correctionFeedback?: CorrectionFeedback | null;
}) {
  const observations = extractEpisodeLanguageObservations({
    cues: input.cues,
    alignment: input.alignment,
    pronunciation: input.pronunciation,
    seriesIdentity: input.seriesIdentity,
    episodeIdentity: input.episodeIdentity,
    sourceArtifactHashes: input.sourceArtifactHashes,
    correctionFeedback: input.correctionFeedback ?? null,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  const empty = emptySeriesLanguageMemory(
    input.seriesIdentity,
    input.generatedAt,
  );
  const parent = input.runKind === "frozen" ? input.memoryInput : empty;
  if (input.runKind === "frozen" && parent === null) {
    throw new Error("Frozen Series Memory replay requires --memory-input.");
  }
  const delta = promoteEpisodeLanguageObservations({
    observations,
    parentMemory: parent ?? null,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  let memory: SeriesLanguageMemory;
  let causalValidation;
  let ranking;
  if (input.memoryMode === "off") {
    memory = empty;
    causalValidation = emptyCausalValidation({
      seriesKey: memory.seriesIdentity.seriesKey,
      cues: input.cues,
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
    ranking = buildSeriesAwareTerminologyRanking({
      pools: input.rankingPools,
      memory,
      evaluationMode: input.runKind,
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
  } else if (input.runKind === "causal") {
    const causal = runCausalMemoryReplay({
      cues: input.cues,
      observations,
      rankingPools: input.rankingPools,
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
    memory = causal.memory;
    causalValidation = causal.validation;
    ranking = causal.ranking;
  } else if (input.runKind === "frozen") {
    if (parent === null || parent === undefined) {
      throw new Error("Frozen memory is unavailable.");
    }
    memory = parent;
    causalValidation = emptyCausalValidation({
      seriesKey: memory.seriesIdentity.seriesKey,
      cues: input.cues,
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
    ranking = buildSeriesAwareTerminologyRanking({
      pools: input.rankingPools,
      memory,
      evaluationMode: "frozen",
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
  } else {
    memory = mergeSeriesLanguageMemory({
      memory: empty,
      delta,
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
    causalValidation = emptyCausalValidation({
      seriesKey: memory.seriesIdentity.seriesKey,
      cues: input.cues,
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
    ranking = buildSeriesAwareTerminologyRanking({
      pools: input.rankingPools,
      memory,
      evaluationMode: "bootstrap",
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
  }
  const evidence = buildSubtitleSeriesMemoryEvidence({
    cues: input.cues,
    memory,
    baseCueHash: input.baseCueHash,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  const pronunciationProjection = projectSeriesMemoryPronunciations({
    alignment: input.alignment,
    memory: input.pronunciationProjectionEnabled === false ? empty : memory,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  const qualityAudit = buildSeriesMemoryQualityAudit({
    memory,
    sampleSize: 30,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
  return {
    observations,
    delta,
    memory,
    evidence,
    ranking,
    pronunciationProjection,
    causalValidation,
    qualityAudit,
  };
}

function emptyCausalValidation(input: {
  seriesKey: string;
  cues: readonly SubtitleCue[];
  generatedAt?: string;
}) {
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "c5-19-causal-validation" as const,
    validationVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    seriesKey: input.seriesKey,
    cueOrder: [...input.cues]
      .toSorted(
        (left, right) =>
          left.start - right.start || left.id.localeCompare(right.id),
      )
      .map((cue) => cue.id),
    retrievalEvents: [],
    summary: {
      causalMemoryMatchCount: 0,
      futureCueMemoryLeakCount: 0 as const,
      sameCueMemoryLeakCount: 0 as const,
      crossSeriesMemoryLeakCount: 0 as const,
    },
  };
  return c519CausalValidationSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}
