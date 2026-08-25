import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  forcedAlignmentRuntimeCapabilitySchema,
  sudachiRuntimeCapabilitySchema,
  type ProcessRunner,
  type SubtitleCue,
} from "@mvl/shared";
import {
  buildSubtitleCanonicalAlignmentInput,
  evaluateTwoSidedBoundaryAgreement,
} from "@mvl/transcription-core";
import {
  alignMfaWordsToCanonicalUnits,
  parseMfaAlignmentOutput,
  prepareCanonicalPronunciation,
  shareablePathLeakReasons,
  verifyMfaRuntimeCapability,
} from "@mvl/video-subtitler";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

const canonicalUnit = (id: string, surface: string, phones = ["a"]) => ({
  unitId: id,
  surface,
  normalizedSurface: surface,
  reading: surface,
  phones,
  punctuation: false,
  criticalOov: false,
});
const mfaWord = (id: string, label: string, phones = ["a"]) => ({
  alignmentId: id,
  label,
  phones,
  oov: false,
});

describe("C5.17.1 TextGrid lexical boundaries and coverage", () => {
  const unitA = canonicalUnit("unit-a", "あ", ["a"]);
  const units = [unitA, canonicalUnit("unit-i", "い", ["i"])];
  const value = {
    fileInterval: { label: "file", start: 0, end: 5 },
    tiers: {
      words: {
        entries: [
          { label: "sil", start: 0, end: 1 },
          { label: "あ", start: 1, end: 2 },
          { label: "い", start: 2.2, end: 3 },
          { label: "sp", start: 3, end: 5 },
        ],
      },
      phones: {
        entries: [
          { label: "sil", start: 0, end: 1 },
          { label: "a", start: 1, end: 2 },
          { label: "i", start: 2.2, end: 3 },
          { label: "sp", start: 3, end: 5 },
        ],
      },
    },
  };

  it("separates file interval from first/last lexical word boundaries", () => {
    const parsed = parseMfaAlignmentOutput({
      value,
      outputFormat: "long_textgrid",
      mediaOffsetSeconds: 100,
      canonicalUnits: units,
      expectedPhones: ["a", "i"],
    });
    expect(parsed.fileInterval).toMatchObject({ start: 100, end: 105 });
    expect(parsed.lexicalUtteranceInterval).toMatchObject({
      start: 101,
      end: 103,
    });
    expect(parsed.selectedBoundarySource).toBe("lexical-word-tier");
  });

  it("does not let the file interval become an edge-pinned lexical boundary", () => {
    const parsed = parseMfaAlignmentOutput({
      value,
      outputFormat: "long_textgrid",
      mediaOffsetSeconds: 0,
      canonicalUnits: units,
      expectedPhones: ["a", "i"],
    });
    expect(parsed.selectedUtteranceInterval).not.toEqual(parsed.fileInterval);
  });

  it("falls back to non-silence phones when the word tier is empty", () => {
    const parsed = parseMfaAlignmentOutput({
      value: {
        fileInterval: { start: 0, end: 3 },
        words: [],
        phones: [
          { label: "sil", start: 0, end: 0.5 },
          { label: "a", start: 0.5, end: 1.2 },
          { label: "sp", start: 1.2, end: 3 },
        ],
      },
      outputFormat: "json",
      mediaOffsetSeconds: 10,
      canonicalUnits: [unitA],
      expectedPhones: ["a"],
    });
    expect(parsed.selectedBoundarySource).toBe("phone-tier-fallback");
    expect(parsed.selectedUtteranceInterval).toMatchObject({
      start: 10.5,
      end: 11.2,
    });
  });

  it("fails closed when all observed intervals are silence", () => {
    expect(() =>
      parseMfaAlignmentOutput({
        value: {
          words: [{ label: "sil", start: 0, end: 1 }],
          phones: [{ label: "sp", start: 0, end: 1 }],
        },
        outputFormat: "json",
        mediaOffsetSeconds: 0,
        canonicalUnits: [unitA],
        expectedPhones: ["a"],
      }),
    ).toThrow(/NO_NON_SILENCE_ALIGNMENT_INTERVAL/u);
  });

  it("computes six independent complete coverage measures", () => {
    const parsed = parseMfaAlignmentOutput({
      value: {
        fileInterval: { label: "file", start: 0, end: 3 },
        tiers: {
          words: {
            entries: [
              { label: "あ", start: 1, end: 1.4 },
              { label: "い", start: 1.5, end: 1.9 },
            ],
          },
          phones: {
            entries: [
              { label: "a", start: 1, end: 1.4 },
              { label: "i", start: 1.5, end: 1.9 },
            ],
          },
        },
      },
      outputFormat: "json",
      mediaOffsetSeconds: 0,
      canonicalUnits: units,
      expectedPhones: ["a", "i"],
    });
    expect({
      canonical: parsed.canonicalUnitCoverageRatio,
      word: parsed.alignedWordCoverageRatio,
      pronunciation: parsed.pronunciationUnitCoverageRatio,
      phone: parsed.expectedPhoneCoverageRatio,
      wordPhone: parsed.wordWithAnyPhoneRatio,
      plausible: parsed.alignedPhonePlausibilityRatio,
    }).toEqual({
      canonical: 1,
      word: 1,
      pronunciation: 1,
      phone: 1,
      wordPhone: 1,
      plausible: 1,
    });
  });

  it("reports partial expected-phone coverage without copying word coverage", () => {
    const parsed = parseMfaAlignmentOutput({
      value,
      outputFormat: "json",
      mediaOffsetSeconds: 0,
      canonicalUnits: units,
      expectedPhones: ["a", "i", "u"],
    });
    expect(parsed.canonicalUnitCoverageRatio).toBe(1);
    expect(parsed.expectedPhoneCoverageRatio).toBeCloseTo(2 / 3);
  });

  it("keeps lexical timing but reports absent phone evidence", () => {
    const parsed = parseMfaAlignmentOutput({
      value: { words: [{ label: "あ", start: 1, end: 2 }] },
      outputFormat: "json",
      mediaOffsetSeconds: 0,
      canonicalUnits: [unitA],
      expectedPhones: ["a"],
    });
    expect(parsed.selectedBoundarySource).toBe("lexical-word-tier");
    expect(parsed.expectedPhoneCoverageRatio).toBe(0);
    expect(parsed.warnings).toContain("MFA_PHONE_TIER_UNAVAILABLE");
  });
});

describe("C5.17.1 sequence word-unit mapping", () => {
  it("maps an exact 1:1 occurrence", () => {
    const result = alignMfaWordsToCanonicalUnits({
      canonicalUnits: [canonicalUnit("u", "東京")],
      words: [mfaWord("w", "東京")],
    });
    expect(result.mappings[0]?.mappingType).toBe("MATCH_1_TO_1");
  });

  it("maps one canonical unit to multiple MFA words", () => {
    const result = alignMfaWordsToCanonicalUnits({
      canonicalUnits: [canonicalUnit("u", "東京")],
      words: [mfaWord("w1", "東"), mfaWord("w2", "京")],
    });
    expect(result.mappings[0]?.mappingType).toBe("MATCH_1_TO_MANY");
  });

  it("maps multiple canonical units to one MFA word", () => {
    const result = alignMfaWordsToCanonicalUnits({
      canonicalUnits: [canonicalUnit("u1", "東"), canonicalUnit("u2", "京")],
      words: [mfaWord("w", "東京")],
    });
    expect(result.mappings[0]?.mappingType).toBe("MATCH_MANY_TO_1");
  });

  it("keeps explicit unmatched units instead of index binding", () => {
    const result = alignMfaWordsToCanonicalUnits({
      canonicalUnits: [canonicalUnit("u1", "あ"), canonicalUnit("u2", "い")],
      words: [mfaWord("w1", "あ")],
    });
    expect(
      result.mappings.some(
        (item) => item.mappingType === "SKIP_CANONICAL_UNIT",
      ),
    ).toBe(true);
    expect(result.indexBasedMappingCount).toBe(0);
  });

  it("turns a low-score pair into an unresolved mapping", () => {
    const result = alignMfaWordsToCanonicalUnits({
      canonicalUnits: [canonicalUnit("u", "甲")],
      words: [mfaWord("w", "乙")],
    });
    expect(result.mappings[0]).toMatchObject({
      mappingType: "UNRESOLVED_MAPPING",
      blockers: ["WORD_UNIT_MAPPING_SCORE_LOW"],
    });
  });

  it("marks an ambiguous local choice as blocking", () => {
    const result = alignMfaWordsToCanonicalUnits({
      canonicalUnits: [canonicalUnit("u1", "甲", [])],
      words: [mfaWord("w1", "乙", []), mfaWord("w2", "丙", [])],
    });
    expect(result.ambiguousCount).toBe(1);
    expect(result.mappings[0]?.blockers).toContain(
      "WORD_UNIT_MAPPING_AMBIGUOUS",
    );
  });
});

describe("C5.17.1 two-sided boundary agreement", () => {
  it.each([
    {
      label: "both sides close",
      interval: { evidenceId: "e", start: 10.05, end: 11.95 },
      startPositive: true,
      endPositive: true,
    },
    {
      label: "only start close",
      interval: { evidenceId: "e", start: 10.05, end: 20 },
      startPositive: true,
      endPositive: false,
    },
    {
      label: "only end close",
      interval: { evidenceId: "e", start: 2, end: 11.95 },
      startPositive: false,
      endPositive: true,
    },
  ])(
    "scores $label independently",
    ({ interval, startPositive, endPositive }) => {
      const result = evaluateTwoSidedBoundaryAgreement({
        boundary: { start: 10, end: 12 },
        intervals: [interval],
        toleranceSeconds: 0.35,
      });
      expect(result.startScore > 0).toBe(startPositive);
      expect(result.endScore > 0).toBe(endPositive);
      expect(result.fullScore).toBe(
        Math.min(result.startScore, result.endScore),
      );
    },
  );

  it("returns no side evidence when the boundary is unavailable", () => {
    expect(
      evaluateTwoSidedBoundaryAgreement({
        boundary: null,
        intervals: [{ evidenceId: "e", start: 1, end: 2 }],
      }),
    ).toMatchObject({ fullScore: 0, startEvidenceIds: [], endEvidenceIds: [] });
  });
});

function runtimeCapability() {
  const model = (
    modelType: "acoustic" | "dictionary" | "g2p",
    name: string,
    hash: string,
  ) => ({
    modelType,
    name,
    version: "3.0.0",
    fileBasename: modelType === "dictionary" ? `${name}.dict` : `${name}.zip`,
    size: 1,
    sha256: hash,
    license: "CC BY 4.0",
    citation: `Official ${name}`,
    metadataSha256: HASH_D,
    officialSource: "MontrealCorpusTools" as const,
    officialReleaseTag: `${modelType}-${name}-v3.0.0`,
    officialDownloadUrl:
      "https://api.github.com/repos/MontrealCorpusTools/mfa-models/releases/assets/1",
    inspectStatus: "verified" as const,
    inspectExitCode: 0,
    inspectDiagnostic: null,
    phoneset: [],
    silencePhones: [],
    tokenizerRequirements: [],
  });
  return forcedAlignmentRuntimeCapabilitySchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "forced-alignment-runtime-capability",
    runtimeVersion: "C5.17.1",
    generatedAt: "2026-08-26T00:00:00.000Z",
    backend: "mfa-japanese",
    mfaVersion: "3.4.2",
    pythonVersion: "3.11.16",
    kalpyVersion: "0.10.5",
    kaldiVersion: "5.5.1172",
    pyniniVersion: "2.1.7",
    sudachiVersion: "unavailable",
    praatioVersion: "6.2.2",
    commandCapabilities: {
      alignOneCommand: "align_one",
      outputFormats: ["long_textgrid"],
      selectedOutputFormat: "long_textgrid",
      jsonHasWordTier: false,
      jsonHasPhoneTier: false,
      g2pSupported: true,
      g2pCommand: "g2p",
      g2pHelpVerified: true,
      originalTextSupported: false,
      tokenizationMode: "sudachi",
      speakerAdaptationSkipped: true,
    },
    acousticModel: model("acoustic", "japanese_mfa", HASH_A),
    dictionaryModel: model("dictionary", "japanese_mfa", HASH_B),
    g2pModel: model("g2p", "japanese_katakana_mfa", HASH_C),
    environmentExplicitSpecSha256: HASH_D,
    runtimeIdentityHash: HASH_A,
    platform: "darwin",
    architecture: "arm64",
    networkUsedDuringPreparation: true,
    networkUsedDuringAlignment: false,
    shareable: true,
  });
}

function sudachiCapability() {
  return sudachiRuntimeCapabilitySchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "sudachi-runtime-capability",
    runtimeVersion: "C5.17.1",
    generatedAt: "2026-08-26T00:00:00.000Z",
    pythonVersion: "3.12.14",
    sudachiPyVersion: "0.6.11",
    sudachiDictionaryVersion: "20260428",
    dictionary: "core",
    splitMode: "C",
    requirementsSha256: HASH_A,
    helperSha256: HASH_B,
    executableBasename: "python",
    runtimeIdentityHash: HASH_C,
    offlineVerificationPassed: true,
    systemPythonModified: false,
    mfaRuntimeDependency: false,
    shareable: true,
  });
}

function canonicalInput(text: string, reading: string) {
  const cue: SubtitleCue = {
    id: "cue-1",
    text,
    start: 1,
    end: 2,
    language: "ja",
    languages: ["ja"],
    speaker: null,
    confidence: 1,
  };
  return buildSubtitleCanonicalAlignmentInput({
    components: [{ componentId: "component-1", cues: [cue] }],
    baseCueHash: HASH_A,
    baseTimingHash: HASH_B,
    alignmentVersion: "C5.17.1",
    sudachiMorphemesByCueId: new Map([
      [
        cue.id,
        [
          {
            surface: text,
            normalizedSurface: text,
            dictionaryForm: text,
            reading,
            partOfSpeech: ["名詞"],
            isOov: true,
            startCharacter: 0,
            endCharacter: Array.from(text).length,
          },
        ],
      ],
    ]),
  });
}

describe("C5.17.1 pronunciation and shareable runtime semantics", () => {
  it("uses the MFA dictionary before G2P and preserves canonical text", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mvl-c5171-dict-"));
    temporaryDirectories.push(directory);
    const dictionary = path.join(directory, "ja.dict");
    await writeFile(dictionary, "ソーリャ\ts oː ɾʲ a\n", "utf8");
    let processCount = 0;
    const runner: ProcessRunner = {
      run() {
        processCount += 1;
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      },
    };
    const input = canonicalInput("ソーリャ", "そーりゃ");
    const result = await prepareCanonicalPronunciation({
      canonicalInput: input,
      mfaCapability: runtimeCapability(),
      sudachiCapability: sudachiCapability(),
      dictionaryModelPath: dictionary,
      g2pModelPath: path.join(directory, "g2p.zip"),
      mfaExecutable: "/fake/env/bin/mfa",
      runner,
      cacheDirectory: path.join(directory, "cache"),
    });
    expect(processCount).toBe(0);
    expect(result.artifact.cues[0]?.canonicalText).toBe("ソーリャ");
    expect(result.artifact.cues[0]?.wordUnits[0]).toMatchObject({
      pronunciationSource: "mfa-dictionary",
      phones: ["s", "oː", "ɾʲ", "a"],
    });
  });

  it("runs official MFA G2P once, then serves the same reading from cache", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mvl-c5171-g2p-"));
    temporaryDirectories.push(directory);
    const dictionary = path.join(directory, "ja.dict");
    await writeFile(dictionary, "既知\tk i tɕ i\n", "utf8");
    let processCount = 0;
    const runner: ProcessRunner = {
      async run(_executable, args) {
        processCount += 1;
        const inputPath = args[1];
        const output = args[3];
        if (inputPath === undefined || output === undefined) {
          throw new Error(
            "Mock MFA G2P runner did not receive input/output paths.",
          );
        }
        const inputReadings = await readFile(inputPath, "utf8");
        const entries = inputReadings
          .trim()
          .split(/\r?\n/u)
          .map((reading) => `${reading}\ts oː ɾʲ a`)
          .join("\n");
        await writeFile(output, `${entries}\n`, "utf8");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    const options = {
      canonicalInput: canonicalInput("ソーリャ", "そーりゃ"),
      mfaCapability: runtimeCapability(),
      sudachiCapability: sudachiCapability(),
      dictionaryModelPath: dictionary,
      g2pModelPath: path.join(directory, "g2p.zip"),
      mfaExecutable: "/fake/env/bin/mfa",
      runner,
      cacheDirectory: path.join(directory, "cache"),
    };
    const first = await prepareCanonicalPronunciation(options);
    const second = await prepareCanonicalPronunciation(options);
    expect(processCount).toBe(1);
    expect(first.artifact.summary.g2pProcessCount).toBe(1);
    expect(second.artifact.summary.g2pCacheHitCount).toBe(1);
    expect(second.artifact.cues[0]?.wordUnits[0]).toMatchObject({
      pronunciationSource: "mfa-g2p",
      isCriticalOov: false,
    });
  });

  it("does not mistake official HTTPS URLs for Windows absolute paths", () => {
    const capability = runtimeCapability();
    const officialDownloadUrl = capability.acousticModel.officialDownloadUrl;
    if (officialDownloadUrl === undefined) {
      throw new Error("Fixture must declare an official acoustic model URL.");
    }
    expect(shareablePathLeakReasons(officialDownloadUrl)).toEqual([]);
    expect(verifyMfaRuntimeCapability(capability)).toEqual(capability);
  });
});
