import { createHash } from "node:crypto";

import {
  terminologyEvidenceArtifactSchema,
  type JapaneseTerminologyEntry,
  type SubtitleCue,
  type TerminologyEvidenceArtifact,
} from "@mvl/shared";

import {
  rankCandidatesWithSeriesMemory,
  type MemoryRankingPoolInput,
} from "./memory-ranking.js";
import type { SeriesLanguageMemory } from "@mvl/shared";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildTerminologyEvidence(input: {
  cues: readonly SubtitleCue[];
  entries?: readonly JapaneseTerminologyEntry[];
}): TerminologyEvidenceArtifact {
  const entries = [...(input.entries ?? [])];
  return terminologyEvidenceArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash({ cues: input.cues, entries }),
    configuration: { globalReplacementEnabled: false },
    entries,
    cueEvidence: input.cues.map((cue) => {
      const matched = entries.filter((entry) =>
        [entry.canonical, ...entry.variants, ...entry.readings].some((term) =>
          cue.text.normalize("NFKC").includes(term.normalize("NFKC")),
        ),
      );
      const canonicalMatches = matched.filter((entry) =>
        cue.text.normalize("NFKC").includes(entry.canonical.normalize("NFKC")),
      );
      return {
        cueId: cue.id,
        matchedCanonicalTerms: matched.map((entry) => entry.canonical),
        supportScore:
          matched.length === 0
            ? 0
            : Math.min(
                1,
                matched.reduce((sum, entry) => sum + entry.confidence, 0) /
                  matched.length,
              ),
        reasons:
          matched.length === 0
            ? ["no-verified-terminology-match"]
            : [
                "verified-terminology-match-used-as-ranking-evidence-only",
                canonicalMatches.length === matched.length
                  ? "canonical-form-match"
                  : "variant-or-reading-match-available-for-contextual-normalization",
              ],
      };
    }),
    fallback:
      entries.length === 0 ? "no-terminology-dictionary-provided" : null,
  });
}

/**
 * C5.19 integration point. Existing terminology evidence remains cue-local and
 * replacement-disabled; Series Memory is delegated to the same ranking path so
 * it cannot become an independent finalization authority.
 */
export function buildSeriesAwareTerminologyRanking(input: {
  pools: readonly MemoryRankingPoolInput[];
  memory: SeriesLanguageMemory;
  tieBreakMargin?: number;
  generatedAt?: string;
  evaluationMode?: "bootstrap" | "causal" | "frozen";
}) {
  return rankCandidatesWithSeriesMemory(input);
}
