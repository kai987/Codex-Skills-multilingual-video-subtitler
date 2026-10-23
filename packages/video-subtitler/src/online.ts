import path from "node:path";

import {
  atomicWriteFile,
  safeStem,
  subtitleSearchResultsSchema,
  type Logger,
  type MediaIdentity,
  type SubtitlePackage,
  type SubtitleSearchResults,
} from "@mvl/shared";
import {
  searchSubtitleSources,
  type ScoredSubtitleCandidate,
  type SubtitleScoreThresholds,
  type SubtitleSearchAdapter,
} from "@mvl/subtitle-search";
import {
  formatSrt,
  normalizeSubtitleCues,
  parseSubtitle,
} from "@mvl/subtitle-core";

function candidateRecord(
  scored: ScoredSubtitleCandidate,
  downloadedRelativePath: string | null,
): SubtitleSearchResults["candidates"][number] {
  const candidate = scored.candidate;
  return {
    id: candidate.id,
    source: scored.source,
    title: candidate.title,
    originalTitle: candidate.originalTitle ?? null,
    season: candidate.season ?? null,
    episode: candidate.episode ?? null,
    year: candidate.year ?? null,
    runtimeSeconds: candidate.runtimeSeconds ?? null,
    releaseSource: candidate.releaseSource ?? null,
    releaseGroup: candidate.releaseGroup ?? null,
    language: candidate.language,
    kind: candidate.kind,
    format: candidate.format,
    sourcePage: candidate.sourcePage ?? null,
    license: candidate.license ?? null,
    score: scored.score,
    scoreBreakdown: scored.scoreBreakdown,
    classification: scored.classification,
    integrity: scored.integrity,
    downloadedRelativePath,
  };
}

function candidateKey(scored: ScoredSubtitleCandidate): string {
  return `${scored.source.id}:${scored.candidate.id}`;
}

export async function processOnlineSubtitles(input: {
  identity: MediaIdentity;
  adapters: readonly SubtitleSearchAdapter[];
  thresholds?: SubtitleScoreThresholds;
  subtitleDirectory: string;
  overwrite: boolean;
  logger: Logger;
}): Promise<{
  record: SubtitleSearchResults;
  primary: {
    candidate: ScoredSubtitleCandidate;
    cues: ReturnType<typeof normalizeSubtitleCues>["cues"];
    validationStatus: "validated" | "needs-review";
  } | null;
  references: SubtitlePackage["referenceSubtitles"];
}> {
  const run = await searchSubtitleSources({
    identity: input.identity,
    sources: input.adapters,
    logger: input.logger,
    ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
  });
  const primary = run.candidates.find(
    (candidate) => candidate.classification === "primary",
  );
  const needsReview = run.candidates.find(
    (candidate) =>
      candidate.classification === "needs-review" &&
      candidate.integrity.valid &&
      candidate.candidate.kind === "original" &&
      input.identity.primarySubtitleLanguages.includes(
        candidate.candidate.language,
      ),
  );
  const selected = primary ?? needsReview;
  const persisted = new Map<string, string>();
  const parsed = new Map<string, ReturnType<typeof normalizeSubtitleCues>>();
  for (const scored of run.candidates) {
    if (!scored.integrity.valid || scored.classification === "rejected") {
      continue;
    }
    const normalized = normalizeSubtitleCues(
      parseSubtitle(scored.candidate.content, scored.candidate.format),
    );
    const fileName = `${safeStem(`${scored.source.id}-${scored.candidate.id}`)}.srt`;
    const outputPath = path.join(input.subtitleDirectory, "online", fileName);
    await atomicWriteFile(outputPath, formatSrt(normalized.cues), {
      overwrite: input.overwrite,
    });
    const relative = `./online/${fileName}`;
    persisted.set(candidateKey(scored), relative);
    parsed.set(candidateKey(scored), normalized);
  }
  const references = run.candidates
    .filter((candidate) => candidate.classification === "reference")
    .flatMap((candidate) => {
      const relative = persisted.get(candidateKey(candidate));
      return relative === undefined
        ? []
        : [
            {
              language: candidate.candidate.language,
              path: relative,
              matchScore: candidate.score,
            },
          ];
    });
  const record = subtitleSearchResultsSchema.parse({
    schemaVersion: "1.0.0",
    searchPerformed: run.performed,
    skippedReason: run.skippedReason,
    sourceErrors: run.sourceErrors,
    candidates: run.candidates.map((candidate) =>
      candidateRecord(
        candidate,
        persisted.get(candidateKey(candidate)) ?? null,
      ),
    ),
  });
  const primaryNormalized =
    selected === undefined ? undefined : parsed.get(candidateKey(selected));
  return {
    record,
    primary:
      selected === undefined || primaryNormalized === undefined
        ? null
        : {
            candidate: selected,
            cues: primaryNormalized.cues,
            validationStatus:
              selected.classification === "primary"
                ? "validated"
                : "needs-review",
          },
    references,
  };
}

export function skippedSearchRecord(reason: string): SubtitleSearchResults {
  return subtitleSearchResultsSchema.parse({
    schemaVersion: "1.0.0",
    searchPerformed: false,
    skippedReason: reason,
    sourceErrors: [],
    candidates: [],
  });
}
