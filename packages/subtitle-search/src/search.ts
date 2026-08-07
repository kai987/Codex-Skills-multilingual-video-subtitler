import type { Logger, MediaIdentity } from "@mvl/shared";

import { scoreSubtitleCandidate } from "./score.js";
import type {
  SubtitleScoreThresholds,
  SubtitleSearchAdapter,
  SubtitleSearchRun,
} from "./types.js";

export async function searchSubtitleSources(input: {
  identity: MediaIdentity;
  sources: readonly SubtitleSearchAdapter[];
  logger: Logger;
  thresholds?: SubtitleScoreThresholds;
}): Promise<SubtitleSearchRun> {
  if (input.identity.needsConfirmation) {
    return {
      performed: false,
      skippedReason: "media-identity-needs-confirmation",
      candidates: [],
      sourceErrors: [],
    };
  }
  if (input.sources.length === 0) {
    return {
      performed: false,
      skippedReason: "no-subtitle-search-adapters-configured",
      candidates: [],
      sourceErrors: [],
    };
  }
  const settled = await Promise.allSettled(
    input.sources.map(async (source) => ({
      source,
      candidates: await source.search({
        identity: input.identity,
        primaryLanguages: input.identity.primarySubtitleLanguages,
        referenceLanguages: input.identity.referenceSubtitleLanguages,
      }),
    })),
  );
  const candidates = [];
  const sourceErrors: SubtitleSearchRun["sourceErrors"] = [];
  for (const [index, result] of settled.entries()) {
    const source = input.sources[index];
    if (source === undefined) continue;
    if (result.status === "rejected") {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      sourceErrors.push({ sourceId: source.id, message });
      input.logger.log(
        "warning",
        "Subtitle search source failed; continuing with fallbacks.",
        {
          sourceId: source.id,
          message,
        },
      );
      continue;
    }
    for (const candidate of result.value.candidates) {
      candidates.push(
        scoreSubtitleCandidate({
          identity: input.identity,
          candidate,
          source: { id: source.id, displayName: source.displayName },
          ...(input.thresholds === undefined
            ? {}
            : { thresholds: input.thresholds }),
        }),
      );
    }
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.candidate.id.localeCompare(right.candidate.id),
  );
  let primarySelected = false;
  for (const candidate of candidates) {
    if (candidate.classification !== "primary") continue;
    if (!primarySelected) {
      primarySelected = true;
    } else {
      candidate.classification = "needs-review";
    }
  }
  return {
    performed: true,
    skippedReason: null,
    candidates,
    sourceErrors,
  };
}
