import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  finalizationCandidateSchema,
  languageTagSchema,
  subtitleCueSchema,
  subtitlePackageSchema,
  type FinalizationCandidate,
  type FinalizationFinding,
  type SubtitleCue,
  type SubtitlePackage,
} from "@mvl/shared";
import {
  calculateCandidateCoverage,
  normalizeFinalizationText,
} from "@mvl/transcription-core";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
  type ParsedCue,
} from "@mvl/subtitle-core";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function sha256Value(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export async function sha256LocalFile(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

export async function locateSubtitlePackage(taskDirectory: string): Promise<{
  taskDirectory: string;
  subtitleDirectory: string;
  packagePath: string;
}> {
  const resolvedTask = path.resolve(taskDirectory);
  const direct = path.join(resolvedTask, "subtitle-package.json");
  try {
    const directStat = await stat(direct);
    if (directStat.isFile()) {
      return {
        taskDirectory: path.dirname(resolvedTask),
        subtitleDirectory: resolvedTask,
        packagePath: direct,
      };
    }
  } catch {
    // Continue with the bounded child search.
  }
  const matches: string[] = [];
  const firstLevel = await readdir(resolvedTask, { withFileTypes: true });
  for (const entry of firstLevel) {
    if (!entry.isDirectory()) continue;
    const child = path.join(resolvedTask, entry.name, "subtitle-package.json");
    try {
      if ((await stat(child)).isFile()) matches.push(child);
    } catch {
      // A child without a package is not a match.
    }
  }
  if (matches.length !== 1) {
    throw new InputError(
      matches.length === 0
        ? `No subtitle-package.json was found directly below ${resolvedTask}.`
        : `Multiple subtitle-package.json files were found below ${resolvedTask}; pass the exact subtitle directory.`,
      { taskDirectory: resolvedTask, matches },
    );
  }
  const packagePath = matches[0];
  if (packagePath === undefined) throw new Error("Missing package match.");
  return {
    taskDirectory: resolvedTask,
    subtitleDirectory: path.dirname(packagePath),
    packagePath,
  };
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function projectCue(value: unknown, index: number): SubtitleCue {
  if (!isRecord(value)) {
    throw new InputError(`Cue ${index + 1} is not an object.`);
  }
  const text = stringValue(value.text).trim();
  const start = Math.max(0, finiteNumber(value.start));
  const end = finiteNumber(value.end, start + 0.001);
  const parsedLanguage = languageTagSchema.safeParse(value.language);
  const language = parsedLanguage.success ? parsedLanguage.data : "und";
  const rawLanguages = Array.isArray(value.languages) ? value.languages : [];
  const languages = rawLanguages
    .map((item) => languageTagSchema.safeParse(item))
    .filter((item) => item.success)
    .map((item) => item.data);
  const style = ["default", "thought", "music"].includes(
    stringValue(value.style),
  )
    ? (value.style as "default" | "thought" | "music")
    : undefined;
  const textSource = [
    "audio-asr",
    "reference-original-language",
    "embedded",
    "online",
  ].includes(stringValue(value.textSource))
    ? (value.textSource as
        "audio-asr" | "reference-original-language" | "embedded" | "online")
    : undefined;
  const confidence =
    value.confidence === null
      ? null
      : typeof value.confidence === "number" &&
          value.confidence >= 0 &&
          value.confidence <= 1
        ? value.confidence
        : null;
  return subtitleCueSchema.parse({
    id: stringValue(value.id, `cue-${String(index + 1).padStart(6, "0")}`),
    start,
    end,
    language,
    languages: languages.length > 0 ? languages : [language],
    text,
    ...(style === undefined ? {} : { style }),
    ...(textSource === undefined ? {} : { textSource }),
    speaker: nullableString(value.speaker),
    confidence,
  });
}

function packageStatus(cueCount: number): SubtitlePackage["status"] {
  return cueCount === 0 ? "no-text-subtitle" : "ready";
}

export function projectStrictSubtitlePackage(input: {
  rawPackage: unknown;
  cues?: readonly SubtitleCue[];
  validationStatus: "validated" | "needs-review" | "rejected";
  files: { srt: string; vtt: string; ass: string };
  subtitledPath?: string | null;
}): SubtitlePackage {
  if (!isRecord(input.rawPackage)) {
    throw new InputError("subtitle-package.json must contain an object.");
  }
  const rawCues = Array.isArray(input.rawPackage.cues)
    ? input.rawPackage.cues
    : [];
  const cues = input.cues ?? rawCues.map(projectCue);
  const source = isRecord(input.rawPackage.source)
    ? input.rawPackage.source
    : {};
  const identity = isRecord(input.rawPackage.identity)
    ? input.rawPackage.identity
    : {};
  const primary = isRecord(input.rawPackage.primarySubtitle)
    ? input.rawPackage.primarySubtitle
    : {};
  const sourceType = ["embedded", "online", "transcription"].includes(
    stringValue(primary.sourceType),
  )
    ? (primary.sourceType as "embedded" | "online" | "transcription")
    : "transcription";
  const primaryLanguage = languageTagSchema.safeParse(primary.language);
  const detectedLanguages = [
    ...new Set(
      cues.flatMap((cue) =>
        cue.language === "mixed" ? cue.languages : [cue.language],
      ),
    ),
  ];
  const sourceLanguage =
    detectedLanguages.length === 0
      ? "und"
      : detectedLanguages.length === 1
        ? (detectedLanguages[0] ?? "und")
        : "mixed";
  const rawWarnings = Array.isArray(input.rawPackage.warnings)
    ? input.rawPackage.warnings.filter(
        (warning): warning is string => typeof warning === "string",
      )
    : [];
  const streamIndex =
    typeof primary.streamIndex === "number" &&
    Number.isInteger(primary.streamIndex) &&
    primary.streamIndex >= 0
      ? primary.streamIndex
      : null;
  return subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: packageStatus(cues.length),
    sourceLanguage,
    detectedLanguages,
    source: {
      fileName: stringValue(source.fileName, "unknown-video"),
      container: nullableString(source.container),
      durationSeconds: Math.max(0, finiteNumber(source.durationSeconds)),
    },
    identity: {
      title: nullableString(identity.title),
      season:
        typeof identity.season === "number" && identity.season > 0
          ? Math.trunc(identity.season)
          : null,
      episode:
        typeof identity.episode === "number" && identity.episode > 0
          ? Math.trunc(identity.episode)
          : null,
      year:
        typeof identity.year === "number" &&
        identity.year >= 1888 &&
        identity.year <= 2200
          ? Math.trunc(identity.year)
          : null,
    },
    primarySubtitle:
      cues.length === 0
        ? null
        : {
            language: primaryLanguage.success
              ? primaryLanguage.data
              : sourceLanguage,
            sourceType,
            validationStatus: input.validationStatus,
            streamIndex,
          },
    subtitleFiles: {
      srt: `./${path.basename(input.files.srt)}`,
      vtt: `./${path.basename(input.files.vtt)}`,
      ass: `./${path.basename(input.files.ass)}`,
    },
    referenceSubtitles: [],
    video: {
      sourcePath: null,
      subtitledPath: input.subtitledPath ?? null,
    },
    cues,
    warnings: rawWarnings,
  });
}

async function findNamedFile(
  directory: string,
  fileName: string,
  maximumDepth = 2,
): Promise<string | null> {
  const visit = async (current: string, depth: number): Promise<string[]> => {
    const results: string[] = [];
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isFile() && entry.name === fileName) results.push(target);
      if (entry.isDirectory() && depth < maximumDepth) {
        results.push(...(await visit(target, depth + 1)));
      }
    }
    return results;
  };
  const matches = await visit(directory, 0);
  return matches.sort((left, right) => left.localeCompare(right))[0] ?? null;
}

function intervalFrom(
  value: unknown,
  fallback: { start: number; end: number },
): { start: number; end: number } {
  if (!isRecord(value)) return fallback;
  const start = finiteNumber(value.start, fallback.start);
  const end = finiteNumber(value.end, fallback.end);
  return end > start && start >= 0 ? { start, end } : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function nullableRatio(value: unknown): number | null {
  return typeof value === "number" && value >= 0 && value <= 1 ? value : null;
}

function externalCandidate(
  value: unknown,
  cues: ReadonlyMap<string, SubtitleCue>,
  index: number,
): FinalizationCandidate | null {
  if (!isRecord(value)) return null;
  const targetCueIds = stringArray(value.targetCueIds);
  const finalCueId = nullableString(value.finalCueId);
  if (targetCueIds.length === 0 && finalCueId !== null) {
    targetCueIds.push(finalCueId);
  }
  const target = targetCueIds.map((cueId) => cues.get(cueId)).find(Boolean);
  if (target === undefined) return null;
  const candidateText = stringValue(
    value.candidateText,
    stringValue(value.suggestedText),
  ).trim();
  if (candidateText === "") return null;
  const rawAssociation = stringValue(
    value.associationType,
    stringValue(value.locusAssociation, "UNASSOCIATED"),
  );
  const associationType = [
    "EXACT_TARGET",
    "PROBABLE_TARGET",
    "BROAD_WINDOW_ASSOCIATION",
    "AMBIGUOUS_ASSOCIATION",
    "UNASSOCIATED",
  ].includes(rawAssociation)
    ? (rawAssociation as FinalizationCandidate["associationType"])
    : "UNASSOCIATED";
  const fallbackInterval = { start: target.start, end: target.end };
  const candidateInterval = intervalFrom(
    value.candidateInterval,
    intervalFrom(value.interval, fallbackInterval),
  );
  const localInterval = isRecord(value.localInterval)
    ? intervalFrom(value.localInterval, fallbackInterval)
    : null;
  const warnings = [
    ...stringArray(value.blockers),
    ...stringArray(value.warnings),
    ...stringArray(value.absoluteVetoes),
  ];
  const partialFragment =
    warnings.includes("PARTIAL_FRAGMENT") ||
    (normalizeFinalizationText(target.text).includes(
      normalizeFinalizationText(candidateText),
    ) &&
      normalizeFinalizationText(target.text).length >
        normalizeFinalizationText(candidateText).length);
  const directAcousticSupport =
    value.directAcousticSupport === true && localInterval !== null;
  const initialCoverage = calculateCandidateCoverage({
    currentText: target.text,
    candidateText,
    neighborCueIntrusionRatio:
      nullableRatio(value.neighborCueIntrusionRatio) ?? 0,
    localSpeechCoverageRatio:
      nullableRatio(value.localSpeechCoverageRatio) ??
      (directAcousticSupport ? 1 : 0),
  });
  return finalizationCandidateSchema.parse({
    candidateId: stringValue(
      value.candidateId,
      `external-candidate-${String(index + 1).padStart(6, "0")}`,
    ),
    targetCueIds,
    candidateText,
    candidateInterval,
    localInterval,
    associationType,
    associationScore: nullableRatio(value.associationScore),
    associationMargin: nullableRatio(
      value.associationMargin ?? value.candidateMargin,
    ),
    sourceEvidenceIds: [
      ...stringArray(value.sourceEvidenceIds),
      ...stringArray(value.evidenceIds),
    ],
    sourceRequestIds: stringArray(value.sourceRequestIds),
    sourceProfileIds: stringArray(value.sourceProfileIds),
    independentSupportCount: Math.max(
      0,
      Math.trunc(finiteNumber(value.independentSupportCount)),
    ),
    coverageMetrics: initialCoverage,
    directAcousticSupport,
    partialFragment,
    timingResolved:
      value.timingResolved === true ||
      (localInterval !== null && !warnings.includes("TIMING_UNRESOLVED")),
    languageIntegrityPassed: value.languageIntegrityPassed !== false,
    hallucinationQaPassed: value.hallucinationQaPassed !== false,
    repetitionQaPassed: value.repetitionQaPassed !== false,
    presentationQaPassed: value.presentationQaPassed !== false,
    requestedAction: "REPLACE",
    automaticMutationEligible: false,
    requiresHumanReview: value.requiresHumanReview !== false,
    blockers: warnings,
  });
}

export async function loadFinalizationCandidates(input: {
  subtitleDirectory: string;
  cues: readonly SubtitleCue[];
}): Promise<{
  candidates: FinalizationCandidate[];
  evidencePath: string | null;
}> {
  const cueById = new Map(input.cues.map((cue) => [cue.id, cue]));
  const genericPath = await findNamedFile(
    input.subtitleDirectory,
    "subtitle-finalization-candidates.json",
  );
  if (genericPath !== null) {
    const raw = JSON.parse(await readFile(genericPath, "utf8")) as unknown;
    const values = Array.isArray(raw)
      ? raw
      : isRecord(raw) && Array.isArray(raw.candidates)
        ? raw.candidates
        : [];
    return {
      candidates: values.map((value) =>
        finalizationCandidateSchema.parse(value),
      ),
      evidencePath: genericPath,
    };
  }
  const externalPath = await findNamedFile(
    input.subtitleDirectory,
    "existing-final-cue-contradiction-candidates.json",
    3,
  );
  if (externalPath === null) return { candidates: [], evidencePath: null };
  const raw = JSON.parse(await readFile(externalPath, "utf8")) as unknown;
  const values =
    isRecord(raw) && Array.isArray(raw.candidates) ? raw.candidates : [];
  return {
    candidates: values
      .map((value, index) => externalCandidate(value, cueById, index))
      .filter(
        (candidate): candidate is FinalizationCandidate => candidate !== null,
      ),
    evidencePath: externalPath,
  };
}

function parsedParity(
  source: readonly SubtitleCue[],
  parsed: readonly ParsedCue[],
  timingTolerance: number,
): boolean {
  if (source.length !== parsed.length) return false;
  return source.every((cue, index) => {
    const item = parsed[index];
    return (
      item !== undefined &&
      normalizeFinalizationText(item.text) ===
        normalizeFinalizationText(cue.text) &&
      Math.abs(item.start - cue.start) <= timingTolerance &&
      Math.abs(item.end - cue.end) <= timingTolerance
    );
  });
}

function finding(
  code: string,
  cueIds: readonly string[],
  message: string,
  severity: "blocking" | "warning" = "blocking",
): FinalizationFinding {
  return {
    findingId: `finding-${sha256Value({ code, cueIds, message }).slice(0, 20)}`,
    severity,
    code,
    cueIds: [...cueIds],
    message,
  };
}

export interface SerializedFinalSubtitles {
  srt: string;
  vtt: string;
  ass: string;
}

export interface FinalCueQualityResult {
  findings: FinalizationFinding[];
  finalIntegrityPassed: boolean;
  serializationRoundTripPassed: boolean;
  formatSemanticParityPassed: boolean;
  formatParityErrorCount: number;
  serialized: SerializedFinalSubtitles;
}

export function evaluateFinalCueQuality(input: {
  cues: readonly SubtitleCue[];
  mediaDurationSeconds: number;
}): FinalCueQualityResult {
  const findings: FinalizationFinding[] = [];
  for (const [index, cue] of input.cues.entries()) {
    if (cue.start < 0 || cue.end <= cue.start) {
      findings.push(
        finding("INVALID_CUE_TIMING", [cue.id], "Cue timing is invalid."),
      );
    }
    if (cue.end > input.mediaDurationSeconds + 0.01) {
      findings.push(
        finding(
          "CUE_OUTSIDE_MEDIA",
          [cue.id],
          "Cue extends beyond media duration.",
        ),
      );
    }
    const previous = input.cues[index - 1];
    if (previous !== undefined && cue.start < previous.start) {
      findings.push(
        finding(
          "TIME_REVERSED",
          [previous.id, cue.id],
          "Cue order is reversed.",
        ),
      );
    }
    if (previous !== undefined && cue.start < previous.end - 0.01) {
      findings.push(
        finding(
          "ILLEGAL_SUBTITLE_OVERLAP",
          [previous.id, cue.id],
          "Adjacent cues overlap.",
        ),
      );
    }
    const lines = cue.text.split("\n");
    if (lines.length > 2) {
      findings.push(
        finding(
          "FINAL_CUE_EXCEEDS_TWO_LINES",
          [cue.id],
          "Cue exceeds two lines.",
        ),
      );
    }
    if (lines.some((line) => Array.from(line).length > 16)) {
      findings.push(
        finding(
          "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
          [cue.id],
          "A rendered line exceeds 16 Unicode code points.",
        ),
      );
    }
    if (
      previous !== undefined &&
      normalizeFinalizationText(previous.text) ===
        normalizeFinalizationText(cue.text)
    ) {
      findings.push(
        finding(
          "UNRESOLVED_CROSS_CUE_REPETITION",
          [previous.id, cue.id],
          "Adjacent cues contain identical visible text.",
        ),
      );
    }
  }
  const serialized = {
    srt: formatSrt(input.cues),
    vtt: formatVtt(input.cues),
    ass: formatAss(input.cues),
  };
  let srt: ParsedCue[] = [];
  let vtt: ParsedCue[] = [];
  let ass: ParsedCue[] = [];
  let serializationRoundTripPassed = true;
  try {
    srt = parseSrt(serialized.srt);
    vtt = parseVtt(serialized.vtt);
    ass = parseAss(serialized.ass);
  } catch (error) {
    serializationRoundTripPassed = false;
    findings.push(
      finding(
        "SERIALIZATION_ROUND_TRIP_FAILED",
        [],
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
  const parity =
    serializationRoundTripPassed &&
    parsedParity(input.cues, srt, 0.001) &&
    parsedParity(input.cues, vtt, 0.001) &&
    parsedParity(input.cues, ass, 0.011) &&
    srt.length === vtt.length &&
    vtt.length === ass.length;
  if (!parity) {
    findings.push(
      finding(
        "FORMAT_SEMANTIC_PARITY_FAILED",
        [],
        "SRT, VTT, and ASS do not round-trip to the same cue semantics.",
      ),
    );
  }
  return {
    findings,
    finalIntegrityPassed: findings.every(
      (item) =>
        ![
          "INVALID_CUE_TIMING",
          "CUE_OUTSIDE_MEDIA",
          "TIME_REVERSED",
          "ILLEGAL_SUBTITLE_OVERLAP",
          "FINAL_CUE_EXCEEDS_TWO_LINES",
          "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
          "UNRESOLVED_CROSS_CUE_REPETITION",
        ].includes(item.code),
    ),
    serializationRoundTripPassed,
    formatSemanticParityPassed: parity,
    formatParityErrorCount: parity ? 0 : 1,
    serialized,
  };
}
