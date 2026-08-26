import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  episodeIdentitySchema,
  type CorrectionFeedback,
  type SubtitleCanonicalAlignmentInput,
  type SubtitleCanonicalPronunciation,
  type SubtitleCtcAlignmentInput,
  type SubtitleCue,
} from "@mvl/shared";
import {
  assertSeriesMemoryCompatible,
  buildMemoryAssistedCtcTargetAudit,
  buildSeriesIdentity,
  buildSeriesMemoryQualityAudit,
  emptySeriesLanguageMemory,
  extractEpisodeLanguageObservations,
  mergeSeriesLanguageMemory,
  projectSeriesMemoryPronunciations,
  promoteEpisodeLanguageObservations,
  rankCandidatesWithSeriesMemory,
  runCausalMemoryReplay,
  stableMemoryHash,
  type MemoryRankingPoolInput,
} from "@mvl/transcription-core";
import {
  atomicWriteSeriesLanguageMemory,
  readSeriesLanguageMemory,
  withSeriesMemoryLock,
} from "@mvl/video-subtitler";

const HASH = "a".repeat(64);
const generatedAt = "2026-08-27T00:00:00.000Z";
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function cue(id: string, text: string, start: number): SubtitleCue {
  return { id, start, end: start + 2, text } as SubtitleCue;
}

function verifiedIdentity(title = "カーネーション 第1話") {
  return buildSeriesIdentity({
    title,
    year: 2011,
    season: 1,
    episode: 1,
    mediaType: "series",
    explicitSeriesVerification: true,
  });
}

function episode(seriesKey: string) {
  return episodeIdentitySchema.parse({
    episodeId: "episode-1",
    seriesKey,
    episodeNumber: 1,
    sourceFingerprintHash: HASH,
  });
}

function alignment(
  cues: readonly SubtitleCue[],
  morphemes: Readonly<Record<string, readonly Record<string, unknown>[]>> = {},
): SubtitleCanonicalAlignmentInput {
  return {
    baseCueHash: HASH,
    baseTimingHash: HASH,
    cues: cues.map((value) => ({
      cueId: value.id,
      canonicalText: value.text,
      morphemes: morphemes[value.id] ?? [],
    })),
  } as unknown as SubtitleCanonicalAlignmentInput;
}

function pronunciation(
  cues: readonly SubtitleCue[],
  wordUnits: Readonly<Record<string, readonly Record<string, unknown>[]>> = {},
): SubtitleCanonicalPronunciation {
  return {
    cues: cues.map((value) => ({
      cueId: value.id,
      wordUnits: wordUnits[value.id] ?? [],
    })),
  } as unknown as SubtitleCanonicalPronunciation;
}

function waterFixture() {
  const cues = [
    cue("water-1", "うまいわ この水茄子", 10),
    cue("water-2", "今日も水茄子を買うた", 20),
  ];
  const waterMorpheme = (startCharacter: number) => ({
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
  const seriesIdentity = verifiedIdentity();
  const observations = extractEpisodeLanguageObservations({
    cues,
    alignment: alignment(cues, {
      "water-1": [waterMorpheme(7)],
      "water-2": [waterMorpheme(3)],
    }),
    pronunciation: pronunciation(cues, {
      "water-1": [
        {
          surface: "水茄子",
          punctuation: false,
          phones: ["m", "i", "z", "u", "n", "a", "s", "u"],
        },
      ],
      "water-2": [
        {
          surface: "水茄子",
          punctuation: false,
          phones: ["m", "i", "z", "u", "n", "a", "s", "u"],
        },
      ],
    }),
    seriesIdentity,
    episodeIdentity: episode(seriesIdentity.seriesKey),
    sourceArtifactHashes: { canonical: HASH, pronunciation: "b".repeat(64) },
    generatedAt,
  });
  const delta = promoteEpisodeLanguageObservations({
    observations,
    generatedAt,
  });
  const memory = mergeSeriesLanguageMemory({
    memory: emptySeriesLanguageMemory(seriesIdentity, generatedAt),
    delta,
    generatedAt,
  });
  return { cues, observations, delta, memory };
}

describe("C5.19 Series identity", () => {
  it("excludes episode number from a deterministic Series key", () => {
    const first = buildSeriesIdentity({
      title: "カーネーション 第1話",
      year: 2011,
      season: 1,
      episode: 1,
    });
    const second = buildSeriesIdentity({
      title: "カーネーション 第2話",
      year: 2011,
      season: 1,
      episode: 2,
    });
    expect(first.seriesKey).toBe(second.seriesKey);
    expect(first.seriesKey).toBe(
      buildSeriesIdentity({
        title: "カーネーション 第1話",
        year: 2011,
        season: 1,
        episode: 1,
      }).seriesKey,
    );
  });

  it.each([
    [
      "season",
      { title: "作品", year: 2011, season: 1 },
      { title: "作品", year: 2011, season: 2 },
    ],
    [
      "year/remake",
      { title: "作品", year: 2011, season: 1 },
      { title: "作品", year: 2026, season: 1 },
    ],
    [
      "title",
      { title: "作品A", year: 2011, season: 1 },
      { title: "作品B", year: 2011, season: 1 },
    ],
  ])("separates %s identities", (_label, left, right) => {
    const a = buildSeriesIdentity({ ...left, episode: 1 });
    const b = buildSeriesIdentity({ ...right, episode: 1 });
    expect(a.seriesKey).not.toBe(b.seriesKey);
  });

  it("normalizes Unicode without changing display title", () => {
    const wide = buildSeriesIdentity({
      title: "ＡＢＣ 第１話",
      year: 2020,
      season: 1,
      episode: 1,
    });
    const narrow = buildSeriesIdentity({
      title: "ABC 第1話",
      year: 2020,
      season: 1,
      episode: 1,
    });
    expect(wide.seriesKey).toBe(narrow.seriesKey);
    expect(wide.title).toBe("ＡＢＣ 第１話");
  });

  it.each([
    [null, 2011, "insufficient", "episode"],
    ["作品", null, "provisional", "episode"],
  ] as const)(
    "fails closed for incomplete identity %#",
    (title, year, status, scope) => {
      const identity = buildSeriesIdentity({
        title,
        year,
        season: null,
        episode: 1,
      });
      expect(identity.identityStatus).toBe(status);
      expect(identity.memoryScope).toBe(scope);
    },
  );

  it("rejects cross-Series memory", () => {
    const { memory } = waterFixture();
    expect(() =>
      assertSeriesMemoryCompatible({
        identity: verifiedIdentity("別作品"),
        memory,
      }),
    ).toThrow(/mismatch/u);
  });
});

describe("C5.19 extraction, promotion, dialect, and corrections", () => {
  it("promotes repeated 水茄子 with reading and evidence lineage", () => {
    const { observations, memory } = waterFixture();
    const candidate = observations.termCandidates.find(
      (value) => value.canonicalSurface === "水茄子",
    );
    const entry = memory.entries.find(
      (value) => value.canonicalSurface === "水茄子",
    );
    expect(candidate?.occurrenceCount).toBe(2);
    expect(entry).toMatchObject({
      canonicalSurface: "水茄子",
      readingHiragana: "みずなす",
      trustLevel: "repeated-verified",
      acousticAliases: ["みずなす"],
    });
    expect(entry?.occurrenceIds).toHaveLength(2);
    expect(
      entry?.occurrenceIds.every((value) =>
        value.startsWith("memory-occurrence-"),
      ),
    ).toBe(true);
    expect(entry?.acousticAliasProvenance[0]).toMatchObject({
      verified: true,
      source: "mfa-dictionary-reading",
    });
  });

  it("filters common words and particles", () => {
    const cues = [cue("filter", "今日だけ", 1)];
    const identity = verifiedIdentity();
    const observations = extractEpisodeLanguageObservations({
      cues,
      alignment: alignment(cues, {
        filter: [
          {
            surface: "今日",
            normalizedSurface: "今日",
            dictionaryForm: "今日",
            reading: "きょう",
            readingSource: "sudachi-dictionary",
            dialectSurface: null,
            startCharacter: 0,
            endCharacter: 2,
            partOfSpeech: ["名詞"],
          },
          {
            surface: "だけ",
            normalizedSurface: "だけ",
            dictionaryForm: "だけ",
            reading: "だけ",
            readingSource: "sudachi-dictionary",
            dialectSurface: null,
            startCharacter: 2,
            endCharacter: 4,
            partOfSpeech: ["助詞"],
          },
        ],
      }),
      seriesIdentity: identity,
      episodeIdentity: episode(identity.seriesKey),
      sourceArtifactHashes: { canonical: HASH },
      generatedAt,
    });
    expect(observations.termCandidates).toHaveLength(0);
  });

  it.each(["あきまへん", "買うた", "へん", "せんと", "やろ"])(
    "preserves dialect surface %s without standardization",
    (surface) => {
      const cues = [cue(`dialect-${surface}`, surface, 1)];
      const identity = verifiedIdentity();
      const observations = extractEpisodeLanguageObservations({
        cues,
        seriesIdentity: identity,
        episodeIdentity: episode(identity.seriesKey),
        sourceArtifactHashes: { canonical: HASH },
        generatedAt,
      });
      const candidate = observations.dialectCandidates.find(
        (value) => value.canonicalSurface === surface,
      );
      expect(candidate?.dialectMetadata).toMatchObject({
        status: "verified",
        surfaceForm: surface,
        standardEquivalent: null,
        preserveSurface: true,
      });
    },
  );

  it("learns a minimal human correction pair once", () => {
    const cues = [cue("corrected", "糸子です", 5)];
    const identity = verifiedIdentity();
    const feedback = {
      records: [
        {
          feedbackId: "feedback-1",
          audioInterval: { start: 5, end: 7 },
          machineText: "系子です",
          correctedText: "糸子です",
          confirmedReading: "いとこ",
          errorTypes: ["KANJI_SELECTION_ERROR"],
          dialectHints: [],
        },
      ],
    } as unknown as CorrectionFeedback;
    const observations = extractEpisodeLanguageObservations({
      cues,
      correctionFeedback: feedback,
      seriesIdentity: identity,
      episodeIdentity: episode(identity.seriesKey),
      sourceArtifactHashes: { canonical: HASH, correction: "c".repeat(64) },
      generatedAt,
    });
    const correction = observations.correctionObservations[0];
    expect(correction).toMatchObject({
      canonicalSurface: "糸",
      observedWrongForms: ["系"],
      occurrenceCount: 1,
    });
    const memory = mergeSeriesLanguageMemory({
      delta: promoteEpisodeLanguageObservations({ observations, generatedAt }),
      generatedAt,
    });
    expect(
      memory.entries.find((value) => value.entryType === "correction-pair"),
    ).toMatchObject({
      trustLevel: "human-corrected",
      observedWrongForms: ["系"],
    });
  });
});

describe("C5.19 pronunciation projection and CTC target audit", () => {
  it("preserves Canonical while projecting both 水茄子 occurrences by exact span", () => {
    const { cues, memory } = waterFixture();
    const source = alignment(cues);
    const projection = projectSeriesMemoryPronunciations({
      alignment: source,
      memory,
      generatedAt,
    });
    const first = projection.cues.find((value) => value.cueId === "water-1");
    expect(first?.canonicalText).toBe("うまいわ この水茄子");
    expect(first?.projectedAlignmentText).toBe("うまいわ このみずなす");
    expect(first?.spans[0]).toMatchObject({
      originalStartChar: 7,
      originalEndChar: 10,
      canonicalSurface: "水茄子",
      projectedAlias: "みずなす",
    });
    expect(
      projection.summary.pronunciationProjectionCanonicalMutationCount,
    ).toBe(0);
  });

  it("maps repeated terms occurrence-safely and deterministically", () => {
    const { memory } = waterFixture();
    const cues = [cue("twice", "水茄子と水茄子", 1)];
    const first = projectSeriesMemoryPronunciations({
      alignment: alignment(cues),
      memory,
      generatedAt,
    });
    const second = projectSeriesMemoryPronunciations({
      alignment: alignment(cues),
      memory,
      generatedAt,
    });
    expect(first.cues[0]?.spans).toHaveLength(2);
    expect(first.semanticHash).toBe(second.semanticHash);
    expect(first.cues[0]?.projectedAlignmentText).toBe("みずなすとみずなす");
  });

  it("records the 14 to 16 encodability rescue without text mutation", () => {
    const { cues, memory } = waterFixture();
    const projection = projectSeriesMemoryPronunciations({
      alignment: alignment(cues),
      memory,
      generatedAt,
    });
    const ctcInput = {
      ctcRuntimeIdentityHash: "d".repeat(64),
      ctcModelSnapshotHash: "e".repeat(64),
      cues: [
        ...Array.from({ length: 14 }, (_value, index) => ({
          cueId: `ok-${String(index)}`,
          encoding: { targetEncodable: true, unknownTokenCount: 0 },
        })),
        ...cues.map((value) => ({
          cueId: value.id,
          encoding: { targetEncodable: false, unknownTokenCount: 1 },
        })),
      ],
    } as unknown as SubtitleCtcAlignmentInput;
    const projected = new Map(
      cues.map((value) => [
        value.id,
        {
          targetEncodable: true,
          unknownTokenCount: 0,
          normalizedText: "みずなす",
          tokenIds: [1],
          tokenPieces: ["みずなす"],
          specialTokenCount: 0,
          blockers: [],
        },
      ]),
    );
    const audit = buildMemoryAssistedCtcTargetAudit({
      ctcInput,
      projection,
      projectedEncodings: projected,
      generatedAt,
    });
    expect(audit.summary).toMatchObject({
      previousEncodableCueCount: 14,
      memoryAssistedEncodableCueCount: 16,
      previousUnencodableCueRescuedCount: 2,
      pronunciationProjectionCanonicalMutationCount: 0,
    });
  });
});

describe("C5.19 ranking safety", () => {
  const pools = (scores = [0.51, 0.5]): MemoryRankingPoolInput[] => [
    {
      cueId: "ranking-cue",
      cueStart: 15,
      expectedText: "水茄子",
      candidates: [
        {
          candidateId: "plain",
          text: "みずなす",
          associationClass: "EXACT_TARGET",
          baseScore: scores[0] ?? 0,
        },
        {
          candidateId: "canonical",
          text: "水茄子",
          associationClass: "EXACT_TARGET",
          baseScore: scores[1] ?? 0,
        },
      ],
    },
  ];

  it("uses memory only as a same-class close-score tie-break", () => {
    const { memory } = waterFixture();
    const ranked = rankCandidatesWithSeriesMemory({
      pools: pools(),
      memory,
      generatedAt,
      evaluationMode: "frozen",
    });
    expect(ranked.decisions[0]?.memoryAdjustedRanking[0]?.candidateId).toBe(
      "canonical",
    );
    expect(ranked.summary.memoryRankingChangedCount).toBe(1);
  });

  it("does not override a score gap above 0.05", () => {
    const { memory } = waterFixture();
    const ranked = rankCandidatesWithSeriesMemory({
      pools: pools([0.8, 0.5]),
      memory,
      generatedAt,
    });
    expect(ranked.decisions[0]?.memoryAdjustedRanking[0]?.candidateId).toBe(
      "plain",
    );
  });

  it("does not change acoustic association class or fabricate candidates", () => {
    const { memory } = waterFixture();
    const ranked = rankCandidatesWithSeriesMemory({
      pools: [
        {
          cueId: "acoustic",
          candidates: [
            {
              candidateId: "strong",
              text: "別候補",
              associationClass: "EXACT_TARGET",
              baseScore: 0.4,
            },
            {
              candidateId: "memory",
              text: "水茄子",
              associationClass: "BROAD_WINDOW",
              baseScore: 0.9,
            },
          ],
        },
      ],
      memory,
      generatedAt,
    });
    expect(ranked.decisions[0]?.memoryAdjustedRanking[0]?.candidateId).toBe(
      "strong",
    );
    expect(ranked.summary).toMatchObject({
      memoryFabricatedAutoCandidateCount: 0,
      memoryAcousticOverrideViolationCount: 0,
    });
  });

  it("cannot use a wrong form when the canonical candidate is absent", () => {
    const { memory } = waterFixture();
    const entry = memory.entries.find(
      (value) => value.canonicalSurface === "水茄子",
    );
    if (entry === undefined) throw new Error("Water entry missing.");
    const altered = {
      ...memory,
      entries: [{ ...entry, observedWrongForms: ["水なす"] }],
    };
    const ranked = rankCandidatesWithSeriesMemory({
      pools: [
        {
          cueId: "wrong-only",
          candidates: [
            {
              candidateId: "wrong",
              text: "水なす",
              associationClass: "EXACT_TARGET",
              baseScore: 0.5,
            },
          ],
        },
      ],
      memory: altered,
      generatedAt,
    });
    expect(ranked.decisions[0]?.memoryEvidence).toHaveLength(0);
  });
});

describe("C5.19 deterministic merge, causal replay, and quality", () => {
  it("is idempotent for the same Episode delta", () => {
    const { delta, memory } = waterFixture();
    const replayed = mergeSeriesLanguageMemory({ memory, delta, generatedAt });
    expect(replayed.memoryHash).toBe(memory.memoryHash);
    expect(replayed.entries.map((entry) => entry.occurrenceIds)).toEqual(
      memory.entries.map((entry) => entry.occurrenceIds),
    );
  });

  it("is independent of candidate order", () => {
    const { delta } = waterFixture();
    const forward = mergeSeriesLanguageMemory({ delta, generatedAt });
    const reverse = mergeSeriesLanguageMemory({
      delta: { ...delta, candidates: [...delta.candidates].reverse() },
      generatedAt,
    });
    expect(forward.memoryHash).toBe(reverse.memoryHash);
  });

  it("evaluates a Cue before learning that Cue and never leaks future evidence", () => {
    const { cues, observations, memory } = waterFixture();
    const causal = runCausalMemoryReplay({
      cues: [...cues].reverse(),
      observations,
      rankingPools: [
        {
          cueId: "water-1",
          cueStart: 10,
          candidates: [
            {
              candidateId: "water",
              text: "水茄子",
              associationClass: "EXACT_TARGET",
              baseScore: 0.5,
            },
          ],
        },
      ],
      generatedAt,
    });
    expect(causal.validation.retrievalEvents[0]?.matchedEntryIds).toHaveLength(
      0,
    );
    expect(
      causal.validation.retrievalEvents[1]?.matchedEntryIds.length,
    ).toBeGreaterThan(0);
    expect(causal.validation.summary).toMatchObject({
      futureCueMemoryLeakCount: 0,
      sameCueMemoryLeakCount: 0,
      crossSeriesMemoryLeakCount: 0,
    });
    expect(causal.memory.memoryHash).toBe(memory.memoryHash);
    expect(causal.ranking.decisions[0]?.memoryEvidence).toHaveLength(0);
  });

  it("produces stable hashes for shuffled cue input", () => {
    const fixture = waterFixture();
    const left = runCausalMemoryReplay({
      cues: fixture.cues,
      observations: fixture.observations,
      generatedAt,
    });
    const right = runCausalMemoryReplay({
      cues: [...fixture.cues].reverse(),
      observations: fixture.observations,
      generatedAt,
    });
    expect(left.memory.memoryHash).toBe(right.memory.memoryHash);
    expect(left.validation.semanticHash).toBe(right.validation.semanticHash);
  });

  it("keeps the quality sample free of common-word false positives", () => {
    const { memory } = waterFixture();
    const audit = buildSeriesMemoryQualityAudit({
      memory,
      sampleSize: 30,
      generatedAt,
    });
    expect(audit.likelyCommonWordCount).toBe(0);
    expect(audit.qualityPassed).toBe(true);
  });

  it("writes strict memory atomically and rejects a silent overwrite", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mvl-c519-store-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "series-language-memory.json");
    const { memory } = waterFixture();
    await atomicWriteSeriesLanguageMemory({ filePath, memory });
    expect((await readSeriesLanguageMemory(filePath)).memoryHash).toBe(
      memory.memoryHash,
    );
    await expect(
      atomicWriteSeriesLanguageMemory({ filePath, memory }),
    ).rejects.toThrow(/already exists/u);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      memoryHash: memory.memoryHash,
    });
  });

  it("times out rather than overwriting a held Series lock", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mvl-c519-lock-"));
    temporaryDirectories.push(directory);
    const memoryPath = path.join(directory, "memory.json");
    await withSeriesMemoryLock({
      memoryPath,
      action: async () => {
        await expect(
          withSeriesMemoryLock({
            memoryPath,
            timeoutMilliseconds: 30,
            action: () => Promise.resolve(undefined),
          }),
        ).rejects.toThrow(/timed out/u);
      },
    });
  });

  it("uses generatedAt-independent semantic identities", () => {
    expect(stableMemoryHash({ b: 2, a: 1 })).toBe(
      stableMemoryHash({ a: 1, b: 2 }),
    );
  });
});
