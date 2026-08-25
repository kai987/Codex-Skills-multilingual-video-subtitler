import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  forcedAlignmentAttemptSchema,
  forcedAlignmentCacheIdentitySchema,
  forcedAlignmentRuntimeCapabilitySchema,
  type CanonicalAlignmentCueInput,
  type EvidenceDpResult,
  type ForcedAlignmentAttempt,
  type ForcedAlignmentCueDecision,
  type ProcessRunner,
  type SubtitleCue,
} from "@mvl/shared";
import {
  type DEFAULT_FORCED_ALIGNMENT_CONFIGURATION,
  alignCanonicalReadingWithEvidence,
  applyCanonicalForcedAlignment,
  buildCanonicalAlignmentCue,
  buildForcedAlignmentCueDecision,
  detectDuplicateOccurrenceAssignments,
  evaluateAntiForcingGate,
  evaluateForcedAlignmentWindowStability,
  forcedAlignmentSha256,
  jointlyAssignForcedAlignmentComponent,
  katakanaToHiragana,
  normalizeCanonicalAlignmentText,
} from "@mvl/transcription-core";
import {
  ForcedAlignmentCache,
  PINNED_JAPANESE_G2P_MODEL,
  assertMfaNetworkPolicy,
  buildForcedAlignmentCacheKey,
  detectMfaEnvironmentManager,
  mfaCreateEnvironmentArguments,
  parseMfaAlignmentOutput,
  parseMfaVersion,
  probeMfaRuntimeCapability,
  selectMfaAlignOneCommand,
  verifyMfaRuntimeCapability,
} from "@mvl/video-subtitler";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

function cue(id: string, text: string, start = 10, end = 12): SubtitleCue {
  return {
    id,
    text,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    speaker: null,
    confidence: 1,
  };
}

function canonical(
  id = "cue-1",
  text = "おはよう",
  start = 10,
  end = 12,
): CanonicalAlignmentCueInput {
  return buildCanonicalAlignmentCue({
    cue: cue(id, text, start, end),
    componentId: "component-1",
  });
}

function alignmentAttempt(
  input: {
    id?: string;
    cueId?: string;
    windowType?: "narrow" | "expanded";
    windowStart?: number;
    windowEnd?: number;
    start?: number;
    end?: number;
    text?: string;
    wordCoverageRatio?: number;
    readingCoverageRatio?: number;
    phoneCoverageRatio?: number;
    oovCount?: number;
    silence?: [number, number][];
    pinnedStart?: boolean;
    pinnedEnd?: boolean;
    failed?: boolean;
    audioSha256?: string;
  } = {},
): ForcedAlignmentAttempt {
  const windowStart = input.windowStart ?? 9.5;
  const windowEnd = input.windowEnd ?? 12.5;
  const start = input.start ?? 10.1;
  const end = input.end ?? 11.9;
  const failed = input.failed ?? false;
  const text = input.text ?? "おはよう";
  const wordId = `word-${input.id ?? "narrow"}`;
  return forcedAlignmentAttemptSchema.parse({
    attemptId: input.id ?? "attempt-narrow",
    requestType: "canonical-forced-alignment",
    componentId: "component-1",
    cueId: input.cueId ?? "cue-1",
    windowType: input.windowType ?? "narrow",
    windowLocalInterval: {
      start: 0,
      end: windowEnd - windowStart,
      coordinateSystem: "component-audio-local",
    },
    windowMediaInterval: {
      start: windowStart,
      end: windowEnd,
      coordinateSystem: "original-media-global",
    },
    audioSha256: input.audioSha256 ?? HASH_A,
    audioDurationSeconds: windowEnd - windowStart,
    canonicalTextSha256: HASH_B,
    alignmentTextSha256: HASH_C,
    readingManifestSha256: HASH_D,
    runtimeIdentityHash: HASH_A,
    acousticModelHash: HASH_B,
    dictionaryModelHash: HASH_C,
    g2pModelHash: HASH_D,
    commandMode: "mock",
    outputFormat: "mock-json",
    parserVersion: "parser-v1",
    cacheHit: false,
    exitCode: failed ? 1 : 0,
    wallClockSeconds: failed ? 0 : 0.1,
    wordAlignments: failed
      ? []
      : [
          {
            alignmentId: wordId,
            label: text,
            expectedUnitIds: ["unit-1"],
            rawInterval: {
              start: start - windowStart,
              end: end - windowStart,
              coordinateSystem: "attempt-audio-local",
            },
            mappedInterval: {
              start,
              end,
              coordinateSystem: "original-media-global",
            },
            oov: false,
          },
        ],
    phoneAlignments: failed
      ? []
      : Array.from({ length: 6 }, (_, index) => {
          const phoneStart = start + (index * (end - start)) / 6;
          const phoneEnd = start + ((index + 1) * (end - start)) / 6;
          return {
            alignmentId: `phone-${input.id ?? "narrow"}-${String(index)}`,
            label: `p${String(index)}`,
            wordAlignmentId: wordId,
            rawInterval: {
              start: phoneStart - windowStart,
              end: phoneEnd - windowStart,
              coordinateSystem: "attempt-audio-local" as const,
            },
            mappedInterval: {
              start: phoneStart,
              end: phoneEnd,
              coordinateSystem: "original-media-global" as const,
            },
          };
        }),
    silenceIntervals: (input.silence ?? []).map(
      ([silenceStart, silenceEnd]) => ({
        start: silenceStart,
        end: silenceEnd,
        coordinateSystem: "original-media-global",
      }),
    ),
    utteranceInterval: failed
      ? null
      : { start, end, coordinateSystem: "original-media-global" },
    alignedWordCount: failed ? 0 : 1,
    expectedWordCount: 1,
    alignedPhoneCount: failed ? 0 : 6,
    oovCount: input.oovCount ?? 0,
    wordCoverageRatio: input.wordCoverageRatio ?? (failed ? 0 : 1),
    readingCoverageRatio: input.readingCoverageRatio ?? (failed ? 0 : 1),
    phoneCoverageRatio: input.phoneCoverageRatio ?? (failed ? 0 : 1),
    canonicalUnitCoverageRatio: input.wordCoverageRatio ?? (failed ? 0 : 1),
    alignedWordCoverageRatio: input.wordCoverageRatio ?? (failed ? 0 : 1),
    pronunciationUnitCoverageRatio:
      input.readingCoverageRatio ?? (failed ? 0 : 1),
    expectedPhoneCoverageRatio: input.phoneCoverageRatio ?? (failed ? 0 : 1),
    wordWithAnyPhoneRatio: failed ? 0 : 1,
    alignedPhonePlausibilityRatio: failed ? 0 : 1,
    expectedPhoneCount: failed ? 0 : 6,
    alignedExpectedPhoneCount: failed ? 0 : 6,
    unresolvedMappingCount: 0,
    ambiguousMappingCount: 0,
    boundaryStart: failed ? null : start,
    boundaryEnd: failed ? null : end,
    startPinnedToWindowEdge: input.pinnedStart ?? false,
    endPinnedToWindowEdge: input.pinnedEnd ?? false,
    alignmentSucceeded: !failed,
    failure: failed ? "ALIGNMENT_FAILED" : null,
    warnings: [],
  });
}

function evidenceDp(
  canonicalCue: CanonicalAlignmentCueInput,
  start = 10.1,
  end = 11.9,
): EvidenceDpResult {
  const unit = canonicalCue.wordUnits.find((value) => !value.punctuation);
  if (unit === undefined) throw new Error("fixture has no lexical unit");
  return alignCanonicalReadingWithEvidence({
    cue: canonicalCue,
    evidenceUnits: [
      {
        evidenceId: `mapped-token-${canonicalCue.cueId}`,
        text: unit.surface,
        reading: unit.reading,
        interval: {
          start,
          end,
          coordinateSystem: "original-media-global",
        },
        source: "trusted-mapped-token",
        timingUsable: true,
      },
    ],
  });
}

function safeDecision(
  input: {
    canonicalCue?: CanonicalAlignmentCueInput;
    start?: number;
    end?: number;
    suffix?: string;
    configuration?: Partial<typeof DEFAULT_FORCED_ALIGNMENT_CONFIGURATION>;
  } = {},
): {
  decision: ForcedAlignmentCueDecision;
  attempts: ForcedAlignmentAttempt[];
} {
  const canonicalCue = input.canonicalCue ?? canonical();
  const start = input.start ?? canonicalCue.originalInterval.start + 0.1;
  const end = input.end ?? canonicalCue.originalInterval.end - 0.1;
  const suffix = input.suffix ?? canonicalCue.cueId;
  const narrow = alignmentAttempt({
    id: `attempt-narrow-${suffix}`,
    cueId: canonicalCue.cueId,
    start,
    end,
    text: canonicalCue.alignmentText,
  });
  const expanded = alignmentAttempt({
    id: `attempt-expanded-${suffix}`,
    cueId: canonicalCue.cueId,
    windowType: "expanded",
    windowStart: 9,
    windowEnd: 13,
    start,
    end,
    text: canonicalCue.alignmentText,
  });
  const dp = evidenceDp(canonicalCue, start, end);
  const decision = buildForcedAlignmentCueDecision({
    cue: canonicalCue,
    narrow,
    expanded,
    evidenceDp: dp,
    mappedTokenIntervals: [
      { evidenceId: `mapped-token-${canonicalCue.cueId}`, start, end },
    ],
    rawVadIntervals: [
      { evidenceId: `raw-vad-${canonicalCue.cueId}`, start, end },
    ],
    decodedSegmentIntervals: [
      { evidenceId: `decoded-${canonicalCue.cueId}`, start, end },
    ],
    configuration: input.configuration,
  });
  return { decision, attempts: [narrow, expanded] };
}

describe("C5.17 canonical transcript preparation", () => {
  it("keeps canonical text byte-for-byte while normalizing alignment text only", () => {
    const text = '{\\an8}アホか！\n<font color="red">調子</font>　乗んな！';
    const prepared = buildCanonicalAlignmentCue({
      cue: cue("cue-format", text),
      componentId: "component-format",
    });
    expect(prepared.canonicalText).toBe(text);
    expect(prepared.alignmentText).toBe("アホか ! 調子 乗んな !");
    expect(prepared.displayNewlinesRemoved).toBe(1);
    expect(prepared.styleMarkersRemoved).toBe(3);
  });

  it.each([
    ["カタカナ", "かたかな"],
    ["オハヨー", "おはよー"],
    ["ひらがな", "ひらがな"],
  ])(
    "normalizes katakana reading %s without altering its surface",
    (surface, reading) => {
      const prepared = canonical("cue-kana", surface);
      expect(prepared.canonicalText).toBe(surface);
      expect(prepared.normalizedReading).toBe(reading);
      expect(katakanaToHiragana(surface)).toBe(reading);
    },
  );

  it("uses verified terminology before Sudachi and preserves dialect surface", () => {
    const prepared = buildCanonicalAlignmentCue({
      cue: cue("cue-dialect", "さかわしい"),
      componentId: "component-dialect",
      sudachiMorphemes: [
        {
          surface: "さかわしい",
          normalizedSurface: "さかわしい",
          dictionaryForm: "さかわしい",
          reading: null,
          partOfSpeech: ["形容詞"],
          isOov: true,
          startCharacter: 0,
          endCharacter: 5,
        },
      ],
      terminology: [
        {
          surface: "さかわしい",
          reading: "サカワシイ",
          evidenceId: "terminology-human-1",
        },
      ],
    });
    expect(prepared.morphemes[0]).toMatchObject({
      dialectSurface: "さかわしい",
      reading: "さかわしい",
      readingSource: "verified-terminology",
    });
    expect(prepared.verifiedTerminologyMatches).toHaveLength(1);
  });

  it("uses a dictionary Kanji reading but never guesses an OOV Kanji reading", () => {
    const known = buildCanonicalAlignmentCue({
      cue: cue("cue-kanji", "水茄子"),
      componentId: "component-kanji",
      sudachiMorphemes: [
        {
          surface: "水茄子",
          normalizedSurface: "水茄子",
          dictionaryForm: "水茄子",
          reading: "ミズナス",
          partOfSpeech: ["名詞"],
          isOov: false,
          startCharacter: 0,
          endCharacter: 3,
        },
      ],
    });
    const unknown = buildCanonicalAlignmentCue({
      cue: cue("cue-oov", "糸子"),
      componentId: "component-oov",
      sudachiMorphemes: [
        {
          surface: "糸子",
          normalizedSurface: "糸子",
          dictionaryForm: "糸子",
          reading: "イトコ",
          partOfSpeech: ["名詞"],
          isOov: true,
          startCharacter: 0,
          endCharacter: 2,
        },
      ],
    });
    expect(known.normalizedReading).toBe("みずなす");
    expect(known.morphemes[0]?.readingSource).toBe("sudachi-dictionary");
    expect(unknown.normalizedReading).toBeNull();
    expect(unknown.unresolvedOov).toEqual(["糸子"]);
  });

  it("validates character offsets against alignment text", () => {
    expect(() =>
      buildCanonicalAlignmentCue({
        cue: cue("cue-offset", "水茄子"),
        componentId: "component-offset",
        sudachiMorphemes: [
          {
            surface: "水茄子",
            normalizedSurface: "水茄子",
            dictionaryForm: "水茄子",
            reading: "ミズナス",
            partOfSpeech: ["名詞"],
            isOov: false,
            startCharacter: 1,
            endCharacter: 3,
          },
        ],
      }),
    ).toThrow(/invalid Sudachi morpheme offsets/u);
  });

  it("keeps normalization and hashes deterministic", () => {
    expect(normalizeCanonicalAlignmentText("Ａ　Ｂ。\nＣ")).toEqual({
      alignmentText: "A B 。 C",
      displayNewlinesRemoved: 1,
      styleMarkersRemoved: 0,
    });
    expect(forcedAlignmentSha256({ b: 2, a: 1 })).toBe(
      forcedAlignmentSha256({ a: 1, b: 2 }),
    );
  });
});

describe("C5.17 Evidence-DP", () => {
  it("matches Kana and copies only trusted mapped-token boundaries", () => {
    const prepared = canonical();
    const result = evidenceDp(prepared, 10.2, 11.7);
    expect(result).toMatchObject({
      coverageRatio: 1,
      startBoundary: 10.2,
      endBoundary: 11.7,
      fabricatedBoundaryCount: 0,
      blockers: [],
    });
  });

  it("matches Kanji to Kana through reading equivalence", () => {
    const prepared = buildCanonicalAlignmentCue({
      cue: cue("cue-reading", "水茄子"),
      componentId: "component-1",
      sudachiMorphemes: [
        {
          surface: "水茄子",
          normalizedSurface: "水茄子",
          dictionaryForm: "水茄子",
          reading: "ミズナス",
          partOfSpeech: ["名詞"],
          isOov: false,
          startCharacter: 0,
          endCharacter: 3,
        },
      ],
    });
    const result = alignCanonicalReadingWithEvidence({
      cue: prepared,
      evidenceUnits: [
        {
          evidenceId: "mapped-token-reading",
          text: "みずなす",
          reading: "みずなす",
          interval: {
            start: 10.1,
            end: 11.2,
            coordinateSystem: "original-media-global",
          },
          source: "trusted-mapped-token",
          timingUsable: true,
        },
      ],
    });
    expect(result.coverageRatio).toBe(1);
    expect(result.readingScore).toBe(1);
  });

  it.each([
    { label: "missing word", evidence: [], expectedCoverage: 0 },
    {
      label: "extra ASR word",
      evidence: ["雑音", "おはよう"],
      expectedCoverage: 1,
    },
    {
      label: "partial mismatch",
      evidence: ["こんばんは"],
      expectedCoverage: 0,
    },
  ])(
    "handles $label without fabricated timing",
    ({ evidence, expectedCoverage }) => {
      const prepared = canonical();
      const result = alignCanonicalReadingWithEvidence({
        cue: prepared,
        evidenceUnits: evidence.map((text, index) => ({
          evidenceId: `mapped-${String(index)}`,
          text,
          reading: text,
          interval: {
            start: 10 + index,
            end: 10.5 + index,
            coordinateSystem: "original-media-global" as const,
          },
          source: "trusted-mapped-token" as const,
          timingUsable: true,
        })),
      });
      expect(result.coverageRatio).toBe(expectedCoverage);
      expect(result.fabricatedBoundaryCount).toBe(0);
      if (expectedCoverage === 0) {
        expect(result.startBoundary).toBeNull();
        expect(result.blockers).toContain("EVIDENCE_DP_LOW_COVERAGE");
      }
    },
  );

  it("does not use Raw VAD as lexical text or invent a proportional boundary", () => {
    const result = alignCanonicalReadingWithEvidence({
      cue: canonical(),
      evidenceUnits: [
        {
          evidenceId: "raw-vad-pause",
          text: "",
          reading: null,
          interval: {
            start: 10,
            end: 12,
            coordinateSystem: "original-media-global",
          },
          source: "raw-vad",
          timingUsable: true,
        },
      ],
    });
    expect(result).toMatchObject({
      coverageRatio: 0,
      startBoundary: null,
      endBoundary: null,
      fabricatedBoundaryCount: 0,
    });
  });

  it("is deterministic under identical ordered input", () => {
    const prepared = canonical();
    expect(evidenceDp(prepared)).toEqual(evidenceDp(prepared));
  });
});

describe("C5.17 MFA parser and window stability", () => {
  const parsedFixture = {
    tiers: {
      words: {
        entries: [
          { label: "sil", start: 0, end: 0.1 },
          { label: "おはよう", start: 0.1, end: 0.9 },
        ],
      },
      phones: {
        entries: [
          { label: "o", start: 0.1, end: 0.4 },
          { label: "h", start: 0.4, end: 0.9 },
        ],
      },
    },
  };
  const parserUnits = [
    {
      unitId: "unit-1",
      surface: "おはよう",
      normalizedSurface: "おはよう",
      reading: "おはよう",
      phones: ["o", "h"],
      punctuation: false,
      criticalOov: false,
    },
  ];

  it.each(["json", "long_textgrid", "mock-json"] as const)(
    "parses %s word/phone tiers and preserves local/global coordinates",
    (outputFormat) => {
      const parsed = parseMfaAlignmentOutput({
        value: parsedFixture,
        outputFormat,
        mediaOffsetSeconds: 100,
        canonicalUnits: parserUnits,
        expectedPhones: ["o", "h"],
      });
      expect(parsed.wordAlignments[0]).toMatchObject({
        label: "おはよう",
        rawInterval: { start: 0.1, end: 0.9 },
        mappedInterval: { start: 100.1, end: 100.9 },
      });
      expect(parsed.phoneAlignments).toHaveLength(2);
      expect(parsed.silenceIntervals[0]).toMatchObject({
        start: 100,
        end: 100.1,
      });
    },
  );

  it("marks explicit OOV words", () => {
    const fixture = structuredClone(parsedFixture);
    const oovEntry = fixture.tiers.words.entries[1];
    if (oovEntry === undefined) throw new Error("Missing OOV fixture entry.");
    oovEntry.label = "<unk>";
    expect(
      parseMfaAlignmentOutput({
        value: fixture,
        outputFormat: "json",
        mediaOffsetSeconds: 0,
        canonicalUnits: parserUnits,
        expectedPhones: ["o", "h"],
      }).wordAlignments[0]?.oov,
    ).toBe(true);
  });

  it("keeps lexical timing when the phone tier is unavailable", () => {
    const parsed = parseMfaAlignmentOutput({
      value: { words: [{ label: "おはよう", start: 0, end: 1 }] },
      outputFormat: "json",
      mediaOffsetSeconds: 0,
      canonicalUnits: parserUnits,
      expectedPhones: ["o", "h"],
    });
    expect(parsed.selectedBoundarySource).toBe("lexical-word-tier");
    expect(parsed.expectedPhoneCoverageRatio).toBe(0);
    expect(parsed.warnings).toContain("MFA_PHONE_TIER_UNAVAILABLE");
  });

  it.each([
    { label: "empty tiers", value: { words: [], phones: [] } },
    {
      label: "reversed time",
      value: {
        words: [{ label: "x", start: 1, end: 0 }],
        phones: [{ label: "x", start: 0, end: 1 }],
      },
    },
    {
      label: "non-finite time",
      value: {
        words: [{ label: "x", start: Number.NaN, end: 1 }],
        phones: [{ label: "x", start: 0, end: 1 }],
      },
    },
  ])("fails closed for $label", ({ value }) => {
    expect(() =>
      parseMfaAlignmentOutput({
        value,
        outputFormat: "json",
        mediaOffsetSeconds: 0,
        canonicalUnits: parserUnits,
        expectedPhones: ["o", "h"],
      }),
    ).toThrow();
  });

  it("rejects an unsupported runtime output format", () => {
    expect(() =>
      parseMfaAlignmentOutput({
        value: parsedFixture,
        outputFormat: "csv" as "json",
        mediaOffsetSeconds: 0,
        canonicalUnits: parserUnits,
        expectedPhones: ["o", "h"],
      }),
    ).toThrow(/Unsupported MFA output format/u);
  });

  it.each([
    { difference: 0, stable: true },
    { difference: 0.05, stable: true },
    { difference: 0.2, stable: true },
    { difference: 0.201, stable: false },
  ])(
    "evaluates a $difference second narrow/expanded difference",
    ({ difference, stable }) => {
      const narrow = alignmentAttempt();
      const expanded = alignmentAttempt({
        id: "attempt-expanded",
        windowType: "expanded",
        windowStart: 9,
        windowEnd: 13,
        start: 10.1 + difference,
        end: 11.9 + difference,
      });
      expect(
        evaluateForcedAlignmentWindowStability({ narrow, expanded }).stable,
      ).toBe(stable);
    },
  );

  it.each([
    {
      narrow: alignmentAttempt(),
      expanded: null,
      status: "single-window",
      blocker: "ALIGNMENT_SINGLE_WINDOW_ONLY",
    },
    {
      narrow: null,
      expanded: alignmentAttempt({ windowType: "expanded" }),
      status: "single-window",
      blocker: "ALIGNMENT_SINGLE_WINDOW_ONLY",
    },
    {
      narrow: null,
      expanded: null,
      status: "unavailable",
      blocker: "ALIGNMENT_WINDOW_PAIR_UNAVAILABLE",
    },
  ])(
    "classifies incomplete window pair %#",
    ({ narrow, expanded, status, blocker }) => {
      expect(
        evaluateForcedAlignmentWindowStability({ narrow, expanded }),
      ).toMatchObject({
        status,
        stable: false,
        blockers: [blocker],
      });
    },
  );
});

describe("C5.17 Anti-Forcing, occurrence, and timing gates", () => {
  function gate(
    input: {
      narrow?: ForcedAlignmentAttempt | null;
      expanded?: ForcedAlignmentAttempt | null;
      mapped?: { evidenceId: string; start: number; end: number }[];
      vad?: { evidenceId: string; start: number; end: number }[];
      neighbors?: { start: number; end: number }[];
      canonicalCue?: CanonicalAlignmentCueInput;
    } = {},
  ) {
    const prepared = input.canonicalCue ?? canonical();
    const narrow =
      input.narrow === undefined ? alignmentAttempt() : input.narrow;
    const expanded =
      input.expanded === undefined
        ? alignmentAttempt({
            id: "attempt-expanded",
            windowType: "expanded",
            windowStart: 9,
            windowEnd: 13,
          })
        : input.expanded;
    return evaluateAntiForcingGate({
      cue: prepared,
      narrow,
      expanded,
      evidenceDp: evidenceDp(prepared),
      mappedTokenIntervals: input.mapped ?? [
        { evidenceId: "mapped-token-1", start: 10.1, end: 11.9 },
      ],
      rawVadIntervals: input.vad ?? [
        { evidenceId: "raw-vad-1", start: 10.1, end: 11.9 },
      ],
      decodedSegmentIntervals: [
        { evidenceId: "decoded-1", start: 10.1, end: 11.9 },
      ],
      neighborIntervals: input.neighbors,
    });
  }

  it("passes a complete, stable, independently supported alignment", () => {
    expect(gate()).toMatchObject({ passed: true, blockers: [] });
  });

  it.each([
    {
      label: "one-word-only coverage",
      narrow: alignmentAttempt({ wordCoverageRatio: 0.4 }),
      expanded: alignmentAttempt({
        id: "attempt-expanded",
        windowType: "expanded",
        wordCoverageRatio: 0.4,
      }),
      blocker: "FORCED_ALIGNMENT_WORD_COVERAGE_LOW",
    },
    {
      label: "low reading coverage",
      narrow: alignmentAttempt({ readingCoverageRatio: 0.5 }),
      expanded: alignmentAttempt({
        id: "attempt-expanded",
        windowType: "expanded",
        readingCoverageRatio: 0.5,
      }),
      blocker: "FORCED_ALIGNMENT_READING_COVERAGE_LOW",
    },
    {
      label: "edge pinning",
      narrow: alignmentAttempt({ pinnedStart: true }),
      expanded: alignmentAttempt({
        id: "attempt-expanded",
        windowType: "expanded",
      }),
      blocker: "ALIGNMENT_PINNED_TO_WINDOW_EDGE",
    },
    {
      label: "silence intrusion",
      narrow: alignmentAttempt({ silence: [[10.1, 11.7]] }),
      expanded: alignmentAttempt({
        id: "attempt-expanded",
        windowType: "expanded",
        silence: [[10.1, 11.7]],
      }),
      blocker: "FORCED_ALIGNMENT_SILENCE_INTRUSION",
    },
  ])("blocks $label", ({ narrow, expanded, blocker }) => {
    const result = gate({ narrow, expanded });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain(blocker);
  });

  it("blocks a critical OOV even when MFA returns intervals", () => {
    const oov = buildCanonicalAlignmentCue({
      cue: cue("cue-oov-gate", "糸子"),
      componentId: "component-1",
    });
    expect(gate({ canonicalCue: oov }).blockers).toContain(
      "CRITICAL_OOV_READING_UNRESOLVED",
    );
  });

  it.each([
    {
      label: "mapped-token conflict",
      mapped: [{ evidenceId: "mapped-token-far", start: 20, end: 21 }],
      vad: undefined,
      blocker: "MFA_SIDE_SPECIFIC_EXTERNAL_BOUNDARY_SUPPORT_MISSING",
    },
    {
      label: "Raw VAD conflict",
      mapped: undefined,
      vad: [{ evidenceId: "raw-vad-far", start: 20, end: 21 }],
      blocker: "MFA_SIDE_SPECIFIC_EXTERNAL_BOUNDARY_SUPPORT_MISSING",
    },
  ])("blocks $label", ({ mapped, vad, blocker }) => {
    const result = gate({
      ...(mapped === undefined ? {} : { mapped }),
      ...(vad === undefined ? {} : { vad }),
    });
    expect(result.blockers).toContain(blocker);
  });

  it("blocks intrusion from a cue outside the component", () => {
    expect(gate({ neighbors: [{ start: 10, end: 12 }] }).blockers).toContain(
      "NEIGHBOR_CUE_INTRUSION",
    );
  });

  it("detects two identical cues assigned to one occurrence", () => {
    const left = safeDecision();
    const right = safeDecision({
      canonicalCue: canonical("cue-2", "おはよう", 10, 12),
      suffix: "cue-2",
    });
    const forcedRight = {
      ...right.decision,
      acousticOccurrenceId: left.decision.acousticOccurrenceId,
    };
    expect(
      detectDuplicateOccurrenceAssignments({
        cueAlignments: [left.decision, forcedRight],
        attempts: [...left.attempts, ...right.attempts],
      }),
    ).toHaveLength(1);
  });

  it("allows identical text at two separable ordered occurrences", () => {
    const left = safeDecision({
      canonicalCue: canonical("cue-1", "おはよう", 10, 11),
      start: 10.05,
      end: 10.9,
    });
    const right = safeDecision({
      canonicalCue: canonical("cue-2", "おはよう", 11.2, 12.2),
      start: 11.25,
      end: 12.1,
      suffix: "cue-2",
    });
    expect(
      detectDuplicateOccurrenceAssignments({
        cueAlignments: [left.decision, right.decision],
        attempts: [...left.attempts, ...right.attempts],
      }),
    ).toEqual([]);
  });

  it("jointly resolves and atomically applies two safe timing-only mutations", () => {
    const cue1 = canonical("cue-1", "おはよう", 10, 11);
    const cue2 = canonical("cue-2", "ありがとう", 11.2, 12.2);
    const left = safeDecision({ canonicalCue: cue1, start: 10.05, end: 10.9 });
    const right = safeDecision({
      canonicalCue: cue2,
      start: 11.25,
      end: 12.1,
      suffix: "cue-2",
    });
    const component = jointlyAssignForcedAlignmentComponent({
      componentId: "component-1",
      componentInterval: { start: 9.5, end: 12.5 },
      canonicalCues: [cue1, cue2],
      cueAlignments: [left.decision, right.decision],
      attempts: [...left.attempts, ...right.attempts],
      mode: "enforce",
    });
    expect(component).toMatchObject({
      resolved: true,
      atomicApplicationPassed: true,
      scoreCalibrationStatus: "uncalibrated-heuristic",
    });
    expect(component.appliedMutations).toHaveLength(2);
    expect(
      component.counterfactualHypotheses.find(
        (item) => item.relationship === "nested-background-foreground",
      ),
    ).toMatchObject({
      speakerEvidenceRequired: true,
      speakerEvidenceAvailable: false,
    });
    const originalCues = [
      cue("cue-1", "おはよう", 10, 11),
      cue("cue-2", "ありがとう", 11.2, 12.2),
    ];
    const applied = applyCanonicalForcedAlignment({
      cues: originalCues,
      components: [component],
      mode: "enforce",
    });
    expect(applied.cues.map((item) => item.text)).toEqual(
      originalCues.map((item) => item.text),
    );
    expect(applied.appliedMutations).toHaveLength(2);
  });

  it.each([
    {
      label: "observe mode",
      mode: "observe" as const,
      expected: "FORCED_ALIGNMENT_OBSERVE_ONLY",
    },
    {
      label: "same occurrence",
      mode: "enforce" as const,
      expected: "DUPLICATE_ACOUSTIC_OCCURRENCE_ASSIGNMENT",
    },
  ])("keeps a component unresolved for $label", ({ mode, expected }) => {
    const cue1 = canonical("cue-1", "おはよう", 10, 11);
    const cue2 = canonical("cue-2", "おはよう", 11.2, 12.2);
    const left = safeDecision({ canonicalCue: cue1, start: 10.05, end: 10.9 });
    const right = safeDecision({
      canonicalCue: cue2,
      start: mode === "observe" ? 11.25 : 10.05,
      end: mode === "observe" ? 12.1 : 10.9,
      suffix: "cue-2",
    });
    const decisions =
      mode === "observe"
        ? [left.decision, right.decision]
        : [
            left.decision,
            {
              ...right.decision,
              acousticOccurrenceId: left.decision.acousticOccurrenceId,
            },
          ];
    const component = jointlyAssignForcedAlignmentComponent({
      componentId: "component-1",
      componentInterval: { start: 9.5, end: 12.5 },
      canonicalCues: [cue1, cue2],
      cueAlignments: decisions,
      attempts: [...left.attempts, ...right.attempts],
      mode,
    });
    expect(component.resolved).toBe(false);
    expect(component.appliedMutations).toEqual([]);
    expect(component.blockers).toContain(expected);
  });

  it("rolls back the entire component when one cue exceeds the 0.50s timing limit", () => {
    const cue1 = canonical("cue-1", "おはよう", 10, 11);
    const cue2 = canonical("cue-2", "ありがとう", 12, 13);
    const left = safeDecision({ canonicalCue: cue1, start: 10.05, end: 10.9 });
    const right = safeDecision({
      canonicalCue: cue2,
      start: 11.2,
      end: 12.3,
      suffix: "cue-2",
    });
    const component = jointlyAssignForcedAlignmentComponent({
      componentId: "component-1",
      componentInterval: { start: 9, end: 14 },
      canonicalCues: [cue1, cue2],
      cueAlignments: [left.decision, right.decision],
      attempts: [...left.attempts, ...right.attempts],
      mode: "enforce",
    });
    expect(component.resolved).toBe(false);
    expect(component.blockers).toContain("COMPONENT_TIMING_GATE_INCOMPLETE");
    expect(component.appliedMutations).toEqual([]);
  });

  it("rejects a proposed change that creates a new overlap", () => {
    const cue1 = canonical("cue-1", "おはよう", 10, 11);
    const cue2 = canonical("cue-2", "ありがとう", 11.1, 12.1);
    const left = safeDecision({ canonicalCue: cue1, start: 10.1, end: 11.3 });
    const right = safeDecision({
      canonicalCue: cue2,
      start: 11.2,
      end: 12,
      suffix: "cue-2",
    });
    const component = jointlyAssignForcedAlignmentComponent({
      componentId: "component-1",
      componentInterval: { start: 9.5, end: 12.5 },
      canonicalCues: [cue1, cue2],
      cueAlignments: [left.decision, right.decision],
      attempts: [...left.attempts, ...right.attempts],
      mode: "enforce",
    });
    expect(component.resolved).toBe(false);
    expect(component.blockers).toContain(
      "MUTATION_CREATES_NEW_ILLEGAL_OVERLAP",
    );
  });
});

describe("C5.17 runtime and independent cache contracts", () => {
  const model = (
    modelType: "acoustic" | "dictionary" | "g2p",
    name: string,
  ) => ({
    modelType,
    name,
    version: "3.0.0",
    fileBasename: `${name}.zip`,
    size: 123,
    sha256:
      modelType === "acoustic"
        ? HASH_A
        : modelType === "dictionary"
          ? HASH_B
          : HASH_C,
    license: "CC BY 4.0",
    citation: `Official ${name} citation`,
    metadataSha256: HASH_D,
    officialSource: "MontrealCorpusTools" as const,
  });

  function capability() {
    return forcedAlignmentRuntimeCapabilitySchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "forced-alignment-runtime-capability",
      runtimeVersion: "C5.17",
      generatedAt: "2026-08-26T00:00:00.000Z",
      backend: "mfa-japanese",
      mfaVersion: "3.4.2",
      pythonVersion: "3.11.9",
      kalpyVersion: "0.8.2",
      kaldiVersion: "5.5",
      pyniniVersion: "2.1.6",
      sudachiVersion: "0.6.11",
      praatioVersion: "6.2.0",
      commandCapabilities: {
        alignOneCommand: "align_one",
        outputFormats: ["json", "long_textgrid"],
        selectedOutputFormat: "long_textgrid",
        jsonHasWordTier: false,
        jsonHasPhoneTier: false,
        g2pSupported: true,
        originalTextSupported: true,
        tokenizationMode: "sudachi",
        speakerAdaptationSkipped: true,
      },
      acousticModel: model("acoustic", "japanese_mfa"),
      dictionaryModel: model("dictionary", "japanese_mfa"),
      g2pModel: model("g2p", PINNED_JAPANESE_G2P_MODEL),
      environmentExplicitSpecSha256: HASH_A,
      runtimeIdentityHash: HASH_D,
      platform: "darwin",
      architecture: "arm64",
      networkUsedDuringPreparation: true,
      networkUsedDuringAlignment: false,
      shareable: true,
    });
  }

  it.each([
    ["MFA version 3.4.2", "3.4.2"],
    ["Montreal Forced Aligner v3.4.2", "3.4.2"],
  ])("parses %s", (output, expected) => {
    expect(parseMfaVersion(output)).toBe(expected);
  });

  it("rejects the wrong MFA version and unknown 4.x manifests", () => {
    expect(() => parseMfaVersion("not a version")).toThrow();
    expect(() =>
      verifyMfaRuntimeCapability({ ...capability(), mfaVersion: "4.0.0" }),
    ).toThrow();
  });

  it("detects the real legacy single-file command from capability output", () => {
    expect(
      selectMfaAlignOneCommand({
        alignOneHelp: {
          exitCode: 0,
          output: "mfa align_one SOUND_FILE TEXT_FILE --g2p_model_path",
        },
        alignOneLegacyHelp: { exitCode: 2, output: "unknown command" },
      }),
    ).toBe("align_one");
    expect(
      selectMfaAlignOneCommand({
        alignOneHelp: { exitCode: 2, output: "unknown" },
        alignOneLegacyHelp: {
          exitCode: 0,
          output: "mfa align_one_legacy audio.wav transcript.txt",
        },
      }),
    ).toBe("align_one_legacy");
  });

  it("keeps normal replay offline and requires explicit network flags", () => {
    expect(() =>
      assertMfaNetworkPolicy({
        operation: "normal-replay",
        createRuntime: true,
        fetchModels: false,
      }),
    ).toThrow(/offline/u);
    expect(() =>
      assertMfaNetworkPolicy({
        operation: "fetch-models",
        createRuntime: false,
        fetchModels: false,
      }),
    ).toThrow(/--fetch-mfa-models/u);
    expect(() =>
      assertMfaNetworkPolicy({
        operation: "fetch-models",
        createRuntime: false,
        fetchModels: true,
      }),
    ).not.toThrow();
  });

  it("constructs only a pinned isolated conda-forge environment", () => {
    const args = mfaCreateEnvironmentArguments({
      manager: "micromamba",
      environmentDirectory: "/isolated/mfa/env",
    });
    expect(args).toContain("montreal-forced-aligner=3.4.2");
    expect(args).toContain("--strict-channel-priority");
    expect(args).not.toContain("latest");
  });

  it("detects environment managers in micromamba, mamba, conda order", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mvl-c5-17-manager-"));
    try {
      for (const name of ["conda", "mamba", "micromamba"]) {
        const executable = path.join(directory, name);
        await writeFile(executable, "#!/bin/sh\nexit 0\n", "utf8");
        await chmod(executable, 0o755);
      }
      expect(
        await detectMfaEnvironmentManager({ environmentPath: directory }),
      ).toMatchObject({ manager: "micromamba" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("probes command/model identity and hashes raw explicit spec bytes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mvl-c5-17-probe-"));
    try {
      const specPath = path.join(directory, "explicit.txt");
      const spec = "@EXPLICIT\nhttps://conda.example/mfa-3.4.2.conda#abc\n";
      await writeFile(specPath, spec, "utf8");
      const paths = {
        acoustic: path.join(directory, "japanese_mfa.zip"),
        dictionary: path.join(directory, "japanese_mfa.dict"),
        g2p: path.join(directory, "japanese_katakana_mfa.zip"),
      };
      await Promise.all(
        Object.values(paths).map((file) => writeFile(file, "model")),
      );
      const runner: ProcessRunner = {
        async run(_executable, args) {
          await Promise.resolve();
          if (args[0] === "version") {
            return { stdout: "MFA version 3.4.2", stderr: "", exitCode: 0 };
          }
          if (args[0] === "align_one") {
            return {
              stdout:
                "mfa align_one SOUND_FILE TEXT_FILE --g2p_model_path --include_original_text --no_tokenization --output_format json long_textgrid",
              stderr: "",
              exitCode: 0,
            };
          }
          if (args[0] === "align_one_legacy") {
            return { stdout: "unknown", stderr: "", exitCode: 2 };
          }
          if (args[0] === "g2p") {
            return {
              stdout: "mfa g2p INPUT_PATH G2P_MODEL_PATH OUTPUT_PATH",
              stderr: "",
              exitCode: 0,
            };
          }
          if (args[0] === "g2p_one") {
            return { stdout: "unknown", stderr: "", exitCode: 2 };
          }
          if (args[0] === "-c") {
            return {
              stdout: JSON.stringify({
                pythonVersion: "3.11.9",
                kalpyVersion: "0.8.2",
                kaldiVersion: "5.5",
                pyniniVersion: "2.1.6",
                sudachiVersion: "0.6.11",
                praatioVersion: "6.2.0",
              }),
              stderr: "",
              exitCode: 0,
            };
          }
          if (args[0] === "model" && args[1] === "inspect") {
            return {
              stdout: `${args[3]} version 3.0.0 license CC BY 4.0 citation official`,
              stderr: "",
              exitCode: 0,
            };
          }
          if (args[0] === "model" && args[1] === "list") {
            return {
              stdout: `${args[2]} japanese_mfa japanese_katakana_mfa`,
              stderr: "",
              exitCode: 0,
            };
          }
          throw new Error(`Unexpected probe command: ${args.join(" ")}`);
        },
      };
      const probed = await probeMfaRuntimeCapability({
        runner,
        mfaExecutable: "mfa",
        pythonExecutable: "python",
        explicitSpecPath: specPath,
        acousticModel: {
          name: "japanese_mfa",
          version: "3.0.0",
          filePath: paths.acoustic,
          license: "CC BY 4.0",
          citation: "Official acoustic citation",
        },
        dictionaryModel: {
          name: "japanese_mfa",
          version: "3.0.0",
          filePath: paths.dictionary,
          license: "CC BY 4.0",
          citation: "Official dictionary citation",
        },
        g2pModel: {
          name: PINNED_JAPANESE_G2P_MODEL,
          version: "3.0.0",
          filePath: paths.g2p,
          license: "CC BY 4.0",
          citation: "Official G2P citation",
        },
        officialRegistry: {
          acoustic: [
            "japanese_mfa",
            "acoustic-japanese_mfa-v3.0.0",
            "v3.0.0",
            "https://api.github.com/repos/MontrealCorpusTools/mfa-models/releases/assets/1",
            "japanese_mfa.zip",
            1,
          ],
          dictionary: [
            "japanese_mfa",
            "dictionary-japanese_mfa-v3.0.0",
            "v3.0.0",
            "https://api.github.com/repos/MontrealCorpusTools/mfa-models/releases/assets/2",
            "japanese_mfa.dict",
            1,
          ],
          g2p: [
            "japanese_katakana_mfa",
            "g2p-japanese_katakana_mfa-v3.0.0",
            "v3.0.0",
            "https://api.github.com/repos/MontrealCorpusTools/mfa-models/releases/assets/3",
            "japanese_katakana_mfa.zip",
            1,
          ],
        },
        networkUsedDuringPreparation: true,
      });
      expect(probed.environmentExplicitSpecSha256).toBe(
        createHash("sha256").update(spec).digest("hex"),
      );
      expect(probed.commandCapabilities).toMatchObject({
        alignOneCommand: "align_one",
        selectedOutputFormat: "long_textgrid",
        speakerAdaptationSkipped: true,
      });
      expect(probed.g2pModel.name).toBe("japanese_katakana_mfa");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  const identity = forcedAlignmentCacheIdentitySchema.parse({
    requestType: "canonical-forced-alignment",
    audioSha256: HASH_A,
    windowMediaInterval: { start: 10, end: 12 },
    windowAudioInterval: { start: 0, end: 2 },
    canonicalTextSha256: HASH_B,
    alignmentTextSha256: HASH_C,
    readingManifestSha256: HASH_D,
    backend: "hybrid",
    runtimeIdentityHash: HASH_A,
    environmentExplicitSpecSha256: HASH_B,
    acousticModelSha256: HASH_A,
    dictionaryModelSha256: HASH_B,
    g2pModelSha256: HASH_C,
    commandMode: "align_one",
    mfaConfigurationHash: HASH_D,
    outputParserVersion: "parser-v1",
    antiForcePolicyVersion: "anti-v1",
    jointAssignmentPolicyVersion: "joint-v1",
  });

  it.each([
    "audioSha256",
    "canonicalTextSha256",
    "readingManifestSha256",
    "runtimeIdentityHash",
    "acousticModelSha256",
    "g2pModelSha256",
    "outputParserVersion",
    "antiForcePolicyVersion",
  ] as const)("includes %s in the forced-alignment cache key", (field) => {
    const current = identity[field];
    const changed = {
      ...identity,
      [field]:
        field.endsWith("Sha256") || field.endsWith("Hash")
          ? current === HASH_D
            ? HASH_A
            : HASH_D
          : "changed-v2",
    };
    expect(buildForcedAlignmentCacheKey(changed)).not.toBe(
      buildForcedAlignmentCacheKey(identity),
    );
  });

  it("does not admit output/task/temp directories into the cache identity", () => {
    expect(Object.keys(identity)).not.toEqual(
      expect.arrayContaining([
        "outputDirectory",
        "taskDirectory",
        "temporaryDirectory",
      ]),
    );
  });

  it("returns a cache hit without running an MFA executor", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mvl-c5-17-cache-"));
    try {
      const writer = new ForcedAlignmentCache({
        root: directory,
        mode: "read-write",
      });
      const attempt = alignmentAttempt();
      await writer.put({ identity, attempt });
      const reader = new ForcedAlignmentCache({
        root: directory,
        mode: "read",
      });
      const hit = await reader.get({
        identity,
        attemptId: attempt.attemptId,
        cueId: attempt.cueId,
        componentId: attempt.componentId,
        windowType: attempt.windowType,
      });
      expect(hit).toMatchObject({ cacheHit: true, wallClockSeconds: 0 });
      expect(reader.manifest({ mfaProcessCount: 0 }).summary).toMatchObject({
        hitCount: 1,
        mfaProcessCount: 0,
        legacyAsrCacheHitCount: 0,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
