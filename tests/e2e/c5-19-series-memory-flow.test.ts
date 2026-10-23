import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  episodeIdentitySchema,
  type SubtitleCanonicalAlignmentInput,
  type SubtitleCanonicalPronunciation,
  type SubtitleCue,
  type SubtitleReviewPackage,
} from "@mvl/shared";
import { buildSeriesIdentity, stableMemoryHash } from "@mvl/transcription-core";
import {
  runSeriesMemoryWorkflow,
  shareablePathLeakReasons,
  writeSubtitleReviewPage,
} from "@mvl/video-subtitler";

const HASH = "a".repeat(64);
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("C5.19 Series Memory end-to-end", () => {
  it("flows Canonical observations through memory, ranking, projection, Review UI, and shareable-safe sidecars", async () => {
    const cues = [
      { id: "cue-1", start: 1, end: 3, text: "この水茄子" },
      { id: "cue-2", start: 5, end: 7, text: "水茄子を買うた" },
    ] as SubtitleCue[];
    const seriesIdentity = buildSeriesIdentity({
      title: "カーネーション 第1話",
      year: 2011,
      season: 1,
      episode: 1,
      explicitSeriesVerification: true,
    });
    const episodeIdentity = episodeIdentitySchema.parse({
      episodeId: "episode-1",
      seriesKey: seriesIdentity.seriesKey,
      episodeNumber: 1,
      sourceFingerprintHash: HASH,
    });
    const morpheme = (startCharacter: number) => ({
      surface: "水茄子",
      normalizedSurface: "水茄子",
      dictionaryForm: "水茄子",
      reading: "みずなす",
      readingSource: "sudachi-dictionary",
      dialectSurface: null,
      startCharacter,
      endCharacter: startCharacter + 3,
      partOfSpeech: ["名詞", "普通名詞", "一般", "*", "*", "*"],
    });
    const alignment = {
      baseCueHash: HASH,
      baseTimingHash: "b".repeat(64),
      cues: [
        {
          cueId: "cue-1",
          canonicalText: cues[0]?.text,
          morphemes: [morpheme(2)],
        },
        {
          cueId: "cue-2",
          canonicalText: cues[1]?.text,
          morphemes: [morpheme(0)],
        },
      ],
    } as unknown as SubtitleCanonicalAlignmentInput;
    const pronunciation = {
      cues: cues.map((cue) => ({
        cueId: cue.id,
        wordUnits: [
          {
            surface: "水茄子",
            punctuation: false,
            phones: ["m", "i", "z", "u", "n", "a", "s", "u"],
          },
        ],
      })),
    } as unknown as SubtitleCanonicalPronunciation;
    const workflow = runSeriesMemoryWorkflow({
      runKind: "bootstrap",
      cues,
      alignment,
      pronunciation,
      seriesIdentity,
      episodeIdentity,
      sourceArtifactHashes: { canonical: HASH, pronunciation: "c".repeat(64) },
      baseCueHash: HASH,
      rankingPools: [
        {
          cueId: "cue-2",
          cueStart: 5,
          expectedText: "水茄子を買うた",
          candidates: [
            {
              candidateId: "kana",
              text: "みずなすを買うた",
              associationClass: "EXACT_TARGET",
              baseScore: 0.51,
            },
            {
              candidateId: "canonical",
              text: "水茄子を買うた",
              associationClass: "EXACT_TARGET",
              baseScore: 0.5,
            },
          ],
        },
      ],
      generatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(
      workflow.memory.entries.find(
        (entry) => entry.canonicalSurface === "水茄子",
      ),
    ).toMatchObject({
      readingHiragana: "みずなす",
    });
    expect(
      workflow.memory.entries.find(
        (entry) => entry.canonicalSurface === "水茄子",
      )?.occurrenceIds,
    ).toHaveLength(2);
    expect(workflow.ranking.summary).toMatchObject({
      memoryRankingChangedCount: 1,
      memoryRankingRegressionCount: 0,
      memoryFabricatedAutoCandidateCount: 0,
      memoryAcousticOverrideViolationCount: 0,
    });
    expect(
      workflow.pronunciationProjection.cues[0]?.projectedAlignmentText,
    ).toBe("このみずなす");
    expect(workflow.evidence.summary.canonicalTextMutationCount).toBe(0);

    const root = await mkdtemp(path.join(tmpdir(), "mvl-c519-e2e-"));
    roots.push(root);
    const reviewPackage = {
      reviewVersion: "review-c5-19-e2e",
      items: [
        {
          reviewId: "review-1",
          targetCueIds: ["cue-2"],
          interval: { start: 5, end: 7 },
          currentText: "水茄子を買うた",
          currentStart: 5,
          currentEnd: 7,
          candidateSuggestions: [],
          allowedHumanActions: ["KEEP", "MARK_UNRESOLVED"],
          blockers: [],
          audioClipPath: null,
        },
      ],
    } as unknown as SubtitleReviewPackage;
    await writeSubtitleReviewPage({
      subtitleDirectory: root,
      reviewPackage,
      seriesMemory: workflow.memory,
      seriesMemoryEvidence: workflow.evidence,
      memoryRanking: workflow.ranking,
      memoryProjection: workflow.pronunciationProjection,
    });
    const javascript = await readFile(
      path.join(root, "review", "assets", "review.js"),
      "utf8",
    );
    expect(javascript).toContain("Series Memory Evidence");
    expect(javascript).toContain("Memory is prior evidence only.");
    expect(javascript).toContain(
      "It does not independently prove the subtitle text.",
    );
    for (const name of [
      "series-language-memory.json",
      "subtitle-series-memory-evidence.json",
      "subtitle-memory-assisted-ranking.json",
      "subtitle-memory-pronunciation-projection.json",
    ]) {
      const file = await readFile(
        path.join(root, "review", "data", name),
        "utf8",
      );
      expect(shareablePathLeakReasons(file)).toEqual([]);
      expect(stableMemoryHash(JSON.parse(file))).toMatch(/^[a-f0-9]{64}$/u);
    }
  });
});
