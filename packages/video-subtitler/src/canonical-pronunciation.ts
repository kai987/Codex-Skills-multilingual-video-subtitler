import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  InputError,
  atomicWriteFile,
  atomicWriteJson,
  subtitleCanonicalPronunciationSchema,
  type CanonicalPronunciationUnit,
  type ForcedAlignmentRuntimeCapability,
  type ProcessRunner,
  type SubtitleCanonicalAlignmentInput,
  type SubtitleCanonicalPronunciation,
  type SudachiRuntimeCapability,
} from "@mvl/shared";
import { forcedAlignmentSha256 } from "@mvl/transcription-core";

export const CANONICAL_PRONUNCIATION_POLICY_VERSION =
  "c5.17.1-canonical-pronunciation-v1";
export const G2P_PREPARATION_POLICY_VERSION = "c5.17.1-mfa-g2p-preparation-v1";

interface DictionaryPronunciation {
  word: string;
  pronunciation: string;
  phones: string[];
}

interface G2pCacheEntry {
  reading: string;
  pronunciation: string;
  phones: string[];
}

interface G2pCache {
  cacheVersion: "C5.17.1";
  policyVersion: typeof G2P_PREPARATION_POLICY_VERSION;
  g2pModelHash: string;
  entries: Record<string, G2pCacheEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedKey(value: string): string {
  return value.normalize("NFKC").trim();
}

function parsePronunciationField(value: string): string[] {
  return value
    .trim()
    .split(/\s+/u)
    .map((phone) => phone.trim())
    .filter((phone) => phone !== "" && !/^\d+(?:\.\d+)?$/u.test(phone));
}

function parseDictionary(
  value: string,
): Map<string, DictionaryPronunciation[]> {
  const result = new Map<string, DictionaryPronunciation[]>();
  for (const line of value.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const fields = line.split("\t");
    const word = normalizedKey(fields[0] ?? "");
    const pronunciation = fields.at(-1)?.trim() ?? "";
    const phones = parsePronunciationField(pronunciation);
    if (word === "" || phones.length === 0) continue;
    const current = result.get(word) ?? [];
    if (!current.some((item) => item.pronunciation === pronunciation)) {
      current.push({ word, pronunciation, phones });
      result.set(word, current);
    }
  }
  return result;
}

function readingSource(
  value: SubtitleCanonicalAlignmentInput["cues"][number]["wordUnits"][number]["readingSource"],
): CanonicalPronunciationUnit["readingSource"] {
  if (value === "verified-terminology") return "terminology-confirmed";
  if (value === "sudachi-dictionary") return "sudachi-dictionary";
  if (value === "kana-literal") return "kana-literal";
  if (value === "official-mfa-g2p") return "mfa-g2p";
  return "unresolved";
}

function dictionaryMatch(
  dictionary: ReadonlyMap<string, readonly DictionaryPronunciation[]>,
  unit: SubtitleCanonicalAlignmentInput["cues"][number]["wordUnits"][number],
): DictionaryPronunciation | null {
  const candidates = [
    unit.surface,
    unit.normalizedSurface,
    ...(unit.reading === null ? [] : [unit.reading]),
  ];
  for (const candidate of candidates) {
    const match = dictionary.get(normalizedKey(candidate))?.[0];
    if (match !== undefined) return match;
  }
  return null;
}

async function loadG2pCache(input: {
  cachePath: string;
  g2pModelHash: string;
}): Promise<G2pCache> {
  try {
    const parsed = JSON.parse(
      await readFile(input.cachePath, "utf8"),
    ) as unknown;
    if (
      isRecord(parsed) &&
      parsed.cacheVersion === "C5.17.1" &&
      parsed.policyVersion === G2P_PREPARATION_POLICY_VERSION &&
      parsed.g2pModelHash === input.g2pModelHash &&
      isRecord(parsed.entries)
    ) {
      return parsed as unknown as G2pCache;
    }
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }
  return {
    cacheVersion: "C5.17.1",
    policyVersion: G2P_PREPARATION_POLICY_VERSION,
    g2pModelHash: input.g2pModelHash,
    entries: {},
  };
}

async function resolveG2pReadings(input: {
  readings: readonly string[];
  cacheDirectory: string;
  capability: ForcedAlignmentRuntimeCapability;
  mfaExecutable: string;
  g2pModelPath: string;
  runner: ProcessRunner;
}): Promise<{
  results: ReadonlyMap<string, G2pCacheEntry>;
  processCount: number;
  cacheHitCount: number;
}> {
  await mkdir(input.cacheDirectory, { recursive: true });
  const cachePath = path.join(input.cacheDirectory, "g2p-cache.json");
  const cache = await loadG2pCache({
    cachePath,
    g2pModelHash: input.capability.g2pModel.sha256,
  });
  const unique = [
    ...new Set(input.readings.map(normalizedKey).filter(Boolean)),
  ];
  const missing = unique.filter(
    (reading) => cache.entries[reading] === undefined,
  );
  let processCount = 0;
  if (missing.length > 0) {
    if (input.capability.commandCapabilities.g2pCommand !== "g2p") {
      throw new InputError(
        "C5.17.1 batch pronunciation preparation requires the probed MFA g2p command.",
      );
    }
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "mvl-c5-17-1-g2p-"),
    );
    try {
      const inputPath = path.join(temporaryDirectory, "readings.txt");
      const outputPath = path.join(temporaryDirectory, "pronunciations.dict");
      await atomicWriteFile(inputPath, `${missing.join("\n")}\n`, {
        overwrite: true,
      });
      const execution = await input.runner.run(
        input.mfaExecutable,
        [
          "g2p",
          inputPath,
          input.g2pModelPath,
          outputPath,
          "--num_jobs",
          "1",
          "--clean",
          "--overwrite",
          "--quiet",
          "--temporary_directory",
          path.join(temporaryDirectory, "mfa-temp"),
        ],
        {
          allowNonZero: true,
          timeoutMs: 180_000,
          environment: {
            ...process.env,
            CONDA_PREFIX: path.dirname(path.dirname(input.mfaExecutable)),
            MFA_ROOT_DIR: path.dirname(
              path.dirname(path.dirname(input.g2pModelPath)),
            ),
            PATH: `${path.dirname(input.mfaExecutable)}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );
      processCount += 1;
      if (execution.exitCode !== 0) {
        throw new InputError("Official MFA G2P execution failed.", {
          diagnostic: `${execution.stderr}\n${execution.stdout}`
            .trim()
            .slice(-2_000),
        });
      }
      const generated = parseDictionary(await readFile(outputPath, "utf8"));
      for (const reading of missing) {
        const resolved = generated.get(reading)?.[0];
        if (resolved !== undefined) {
          cache.entries[reading] = {
            reading,
            pronunciation: resolved.pronunciation,
            phones: resolved.phones,
          };
        }
      }
      await atomicWriteJson(cachePath, cache, { overwrite: true });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
  return {
    results: new Map(
      unique.flatMap((reading) => {
        const entry = cache.entries[reading];
        return entry === undefined ? [] : ([[reading, entry]] as const);
      }),
    ),
    processCount,
    cacheHitCount: unique.length - missing.length,
  };
}

export interface PrepareCanonicalPronunciationOptions {
  canonicalInput: SubtitleCanonicalAlignmentInput;
  mfaCapability: ForcedAlignmentRuntimeCapability;
  sudachiCapability: SudachiRuntimeCapability;
  dictionaryModelPath: string;
  g2pModelPath: string;
  mfaExecutable: string;
  runner: ProcessRunner;
  cacheDirectory: string;
  generatedAt?: string;
}

export async function prepareCanonicalPronunciation(
  options: PrepareCanonicalPronunciationOptions,
): Promise<{
  artifact: SubtitleCanonicalPronunciation;
  alignmentDictionary: string;
}> {
  const dictionary = parseDictionary(
    await readFile(options.dictionaryModelPath, "utf8"),
  );
  const unresolvedReadings = options.canonicalInput.cues.flatMap((cue) =>
    cue.wordUnits.flatMap((unit) => {
      if (unit.punctuation || dictionaryMatch(dictionary, unit) !== null)
        return [];
      return unit.reading === null ? [] : [unit.reading];
    }),
  );
  const g2p = await resolveG2pReadings({
    readings: unresolvedReadings,
    cacheDirectory: options.cacheDirectory,
    capability: options.mfaCapability,
    mfaExecutable: options.mfaExecutable,
    g2pModelPath: options.g2pModelPath,
    runner: options.runner,
  });
  const cues = options.canonicalInput.cues.map((cue) => {
    const lexical = cue.wordUnits.filter((unit) => !unit.punctuation);
    const wordUnits = cue.wordUnits.map((unit): CanonicalPronunciationUnit => {
      const sourceBefore = readingSource(unit.readingSource);
      if (unit.punctuation) {
        return {
          unitId: unit.unitId,
          cueId: cue.cueId,
          surface: unit.surface,
          normalizedSurface: unit.normalizedSurface,
          reading: unit.reading,
          readingSource: sourceBefore,
          pronunciation: null,
          phones: [],
          pronunciationSource: "unresolved",
          dictionaryLookupStatus: "not-attempted",
          g2pStatus: "not-attempted",
          modelIdentityHash: null,
          modelHash: null,
          isOov: false,
          isCriticalOov: false,
          punctuation: true,
          blockers: [],
        };
      }
      const dictionaryPronunciation = dictionaryMatch(dictionary, unit);
      if (dictionaryPronunciation !== null) {
        return {
          unitId: unit.unitId,
          cueId: cue.cueId,
          surface: unit.surface,
          normalizedSurface: unit.normalizedSurface,
          reading: unit.reading,
          readingSource:
            unit.reading === null ? "mfa-dictionary" : sourceBefore,
          pronunciation: dictionaryPronunciation.pronunciation,
          phones: dictionaryPronunciation.phones,
          pronunciationSource: "mfa-dictionary",
          dictionaryLookupStatus: "found",
          g2pStatus: "not-needed",
          modelIdentityHash: options.mfaCapability.runtimeIdentityHash,
          modelHash: options.mfaCapability.dictionaryModel.sha256,
          isOov: false,
          isCriticalOov: false,
          punctuation: false,
          blockers: [],
        };
      }
      const generated =
        unit.reading === null
          ? undefined
          : g2p.results.get(normalizedKey(unit.reading));
      if (generated !== undefined) {
        return {
          unitId: unit.unitId,
          cueId: cue.cueId,
          surface: unit.surface,
          normalizedSurface: unit.normalizedSurface,
          reading: unit.reading,
          readingSource: sourceBefore,
          pronunciation: generated.pronunciation,
          phones: generated.phones,
          pronunciationSource: "mfa-g2p",
          dictionaryLookupStatus: "not-found",
          g2pStatus: "resolved",
          modelIdentityHash: options.mfaCapability.runtimeIdentityHash,
          modelHash: options.mfaCapability.g2pModel.sha256,
          isOov: true,
          isCriticalOov: false,
          punctuation: false,
          blockers: [],
        };
      }
      return {
        unitId: unit.unitId,
        cueId: cue.cueId,
        surface: unit.surface,
        normalizedSurface: unit.normalizedSurface,
        reading: unit.reading,
        readingSource: sourceBefore,
        pronunciation: null,
        phones: [],
        pronunciationSource: "unresolved",
        dictionaryLookupStatus: "not-found",
        g2pStatus: unit.reading === null ? "not-attempted" : "unresolved",
        modelIdentityHash: null,
        modelHash: null,
        isOov: true,
        isCriticalOov: true,
        punctuation: false,
        blockers: ["CRITICAL_OOV_PHONE_UNRESOLVED"],
      };
    });
    const lexicalPronunciation = wordUnits.filter((unit) => !unit.punctuation);
    const ratio = (count: number) =>
      lexical.length === 0 ? 0 : count / lexical.length;
    const criticalOovBefore = lexical.filter((unit) => unit.criticalOov).length;
    const criticalOovAfter = lexicalPronunciation.filter(
      (unit) => unit.isCriticalOov,
    ).length;
    return {
      cueId: cue.cueId,
      componentId: cue.componentId,
      canonicalText: cue.canonicalText,
      canonicalTextSha256: cue.canonicalTextSha256,
      alignmentText: cue.alignmentText,
      alignmentTextSha256: cue.alignmentTextSha256,
      morphemeCount: cue.morphemes.length,
      wordUnits,
      readingUnits: lexicalPronunciation.flatMap((unit) =>
        unit.reading === null ? [] : [unit.reading],
      ),
      pronunciationUnits: lexicalPronunciation.flatMap((unit) =>
        unit.pronunciation === null ? [] : [unit.pronunciation],
      ),
      expectedPhones: lexicalPronunciation.flatMap((unit) => unit.phones),
      readingCoverageBeforeG2p: ratio(
        lexical.filter((unit) => unit.reading !== null).length,
      ),
      readingCoverageAfterG2p: ratio(
        lexicalPronunciation.filter((unit) => unit.reading !== null).length,
      ),
      pronunciationCoverageRatio: ratio(
        lexicalPronunciation.filter((unit) => unit.phones.length > 0).length,
      ),
      criticalOovBefore,
      criticalOovAfter,
      pronunciationEligibility:
        lexicalPronunciation.length > 0 && criticalOovAfter === 0,
      blockers: criticalOovAfter === 0 ? [] : ["CRITICAL_OOV_PHONE_UNRESOLVED"],
    };
  });
  const lexicalUnits = cues.flatMap((cue) =>
    cue.wordUnits.filter((unit) => !unit.punctuation),
  );
  const artifact = subtitleCanonicalPronunciationSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "subtitle-canonical-pronunciation",
    pronunciationVersion: "C5.17.1",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    baseCueHash: options.canonicalInput.baseCueHash,
    canonicalAlignmentInputHash: forcedAlignmentSha256({
      ...options.canonicalInput,
      generatedAt: null,
    }),
    sudachiRuntimeIdentityHash: options.sudachiCapability.runtimeIdentityHash,
    mfaRuntimeIdentityHash: options.mfaCapability.runtimeIdentityHash,
    g2pModelIdentityHash: options.mfaCapability.g2pModel.sha256,
    g2pCommand: options.mfaCapability.commandCapabilities.g2pCommand,
    pronunciationPolicyVersion: CANONICAL_PRONUNCIATION_POLICY_VERSION,
    canonicalTextMutationCount: 0,
    cues,
    summary: {
      cueCount: cues.length,
      unitCount: lexicalUnits.length,
      sudachiResolvedCount: lexicalUnits.filter(
        (unit) => unit.readingSource === "sudachi-dictionary",
      ).length,
      dictionaryResolvedCount: lexicalUnits.filter(
        (unit) => unit.pronunciationSource === "mfa-dictionary",
      ).length,
      g2pResolvedCount: lexicalUnits.filter(
        (unit) => unit.pronunciationSource === "mfa-g2p",
      ).length,
      kanaLiteralCount: lexicalUnits.filter(
        (unit) => unit.readingSource === "kana-literal",
      ).length,
      unresolvedCount: lexicalUnits.filter((unit) => unit.isCriticalOov).length,
      criticalOovBefore: cues.reduce(
        (sum, cue) => sum + cue.criticalOovBefore,
        0,
      ),
      criticalOovAfter: cues.reduce(
        (sum, cue) => sum + cue.criticalOovAfter,
        0,
      ),
      g2pProcessCount: g2p.processCount,
      g2pCacheHitCount: g2p.cacheHitCount,
      canonicalTextMutationCount: 0,
    },
  });
  const specialEntries = ["<cutoff>\tspn", "<unk>\tspn", "[laughter]\tspn"];
  const derivedEntries = artifact.cues.flatMap((cue) =>
    cue.wordUnits.flatMap((unit) =>
      unit.punctuation || unit.pronunciation === null
        ? []
        : [`${unit.surface}\t${unit.pronunciation}`],
    ),
  );
  return {
    artifact,
    alignmentDictionary: `${[
      ...specialEntries,
      ...new Set(derivedEntries),
    ].join("\n")}\n`,
  };
}
