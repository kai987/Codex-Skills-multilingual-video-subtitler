import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  detectTextLanguage,
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
  type AssEventEvidence,
  type SubtitlePresentationResolutionResult,
} from "@mvl/transcription-core";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
  presentationLexicalText,
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

export function sha256JsonFileValue(value: unknown): string {
  return createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest("hex");
}

export async function sha256LocalFile(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

export interface LoadedHumanReviewedSubtitle {
  sourcePath: string;
  sourceFileName: string;
  sourceFileSha256: string;
  sourceFileSize: number;
  sourceMtimeMs: number;
  format: "ass";
  timestampNormalizationCount: number;
  cueHash: string;
  cues: SubtitleCue[];
  assEventEvidence: AssEventEvidence[];
  warnings: string[];
}

function normalizeAssTimestampDecimalCommas(content: string): {
  content: string;
  replacementCount: number;
} {
  let replacementCount = 0;
  const replace = (
    _match: string,
    prefix: string,
    fraction: string,
    delimiter: string,
  ): string => {
    replacementCount += 1;
    return `${prefix}.${fraction}${delimiter}`;
  };
  let normalized = content.replace(
    /^(\s*Dialogue:\s*[^,\r\n]*,\s*\d+:\d{2}:\d{2}),(\d{1,2})(,)/gimu,
    replace,
  );
  normalized = normalized.replace(
    /^(\s*Dialogue:\s*[^,\r\n]*,\s*\d+:\d{2}:\d{2}(?:\.\d{1,2})?\s*,\s*\d+:\d{2}:\d{2}),(\d{1,2})(,)/gimu,
    replace,
  );
  return { content: normalized, replacementCount };
}

function importedAssStyles(content: string): {
  styles: ("default" | "thought" | "music")[];
  events: Omit<AssEventEvidence, "cueId">[];
  unknownStyleCount: number;
} {
  let inEvents = false;
  let format: string[] = [];
  let unknownStyleCount = 0;
  const styles: ("default" | "thought" | "music")[] = [];
  const events: Omit<AssEventEvidence, "cueId">[] = [];
  for (const line of content
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inEvents = trimmed.toLowerCase() === "[events]";
      continue;
    }
    if (!inEvents || trimmed === "" || trimmed.startsWith(";")) continue;
    if (/^Format:/iu.test(trimmed)) {
      format = trimmed
        .slice(trimmed.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/iu.test(trimmed) || format.length === 0) continue;
    const payload = trimmed.slice(trimmed.indexOf(":") + 1).trimStart();
    const fields = payload.split(",");
    const values = [
      ...fields.slice(0, format.length - 1),
      fields.slice(format.length - 1).join(","),
    ];
    const styleIndex = format.indexOf("style");
    const styleName =
      styleIndex < 0 ? "default" : (values[styleIndex] ?? "default");
    const normalizedStyle = styleName.trim().toLowerCase();
    const layerIndex = format.indexOf("layer");
    const rawLayer = layerIndex < 0 ? "0" : (values[layerIndex] ?? "0");
    const parsedLayer = Number.parseInt(rawLayer.trim(), 10);
    const nameIndex = format.indexOf("name");
    const rawName = nameIndex < 0 ? "" : (values[nameIndex] ?? "");
    events.push({
      layer:
        Number.isInteger(parsedLayer) && parsedLayer >= 0 ? parsedLayer : 0,
      name: rawName.trim() === "" ? null : rawName.trim(),
      style: styleName.trim() === "" ? "Default" : styleName.trim(),
    });
    if (normalizedStyle === "music") {
      styles.push("music");
    } else if (normalizedStyle === "thought") {
      styles.push("thought");
    } else {
      styles.push("default");
      if (normalizedStyle !== "" && normalizedStyle !== "default") {
        unknownStyleCount += 1;
      }
    }
  }
  return { styles, events, unknownStyleCount };
}

export async function loadHumanReviewedSubtitle(
  filePath: string,
): Promise<LoadedHumanReviewedSubtitle> {
  const sourcePath = path.resolve(filePath);
  if (![".ass", ".ssa"].includes(path.extname(sourcePath).toLowerCase())) {
    throw new InputError(
      "A human-reviewed baseline must be an ASS or SSA subtitle file.",
      { path: sourcePath },
    );
  }
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile()) {
    throw new InputError(
      `Human-reviewed subtitle is not a regular file: ${sourcePath}`,
    );
  }
  const sourceBytes = await readFile(sourcePath);
  const sourceFileSha256 = createHash("sha256")
    .update(sourceBytes)
    .digest("hex");
  const normalized = normalizeAssTimestampDecimalCommas(
    sourceBytes.toString("utf8"),
  );
  const parsed = parseAss(normalized.content);
  const styleResult = importedAssStyles(normalized.content);
  if (styleResult.styles.length !== parsed.length) {
    throw new InputError(
      "Human-reviewed ASS style and dialogue counts do not match.",
      {
        cueCount: parsed.length,
        styleCount: styleResult.styles.length,
      },
    );
  }
  if (styleResult.events.length !== parsed.length) {
    throw new InputError(
      "Human-reviewed ASS event metadata and dialogue counts do not match.",
      {
        cueCount: parsed.length,
        eventCount: styleResult.events.length,
      },
    );
  }
  const cues = parsed.map((cue, index): SubtitleCue => {
    if (cue.end <= cue.start) {
      throw new InputError(
        `Human-reviewed cue at source line ${cue.sourceLine} has invalid timing.`,
      );
    }
    const detected = detectTextLanguage(cue.text);
    const style = styleResult.styles[index] ?? "default";
    return subtitleCueSchema.parse({
      id: `human-reviewed-${String(index + 1).padStart(4, "0")}-${sha256Value({
        index,
        start: cue.start,
        end: cue.end,
        text: cue.text,
        speaker: cue.speaker,
        style,
      }).slice(0, 12)}`,
      start: cue.start,
      end: cue.end,
      language: detected.language,
      languages: detected.languages,
      text: cue.text,
      style,
      speaker: cue.speaker,
      confidence: null,
    });
  });
  const warnings = [
    ...(normalized.replacementCount === 0
      ? []
      : [
          `Normalized ${normalized.replacementCount} ASS timestamp decimal comma separator(s) without modifying the source file.`,
        ]),
    ...(styleResult.unknownStyleCount === 0
      ? []
      : [
          `Mapped ${styleResult.unknownStyleCount} unknown ASS style(s) to default.`,
        ]),
  ];
  return {
    sourcePath,
    sourceFileName: path.basename(sourcePath),
    sourceFileSha256,
    sourceFileSize: sourceStat.size,
    sourceMtimeMs: sourceStat.mtimeMs,
    format: "ass",
    timestampNormalizationCount: normalized.replacementCount,
    cueHash: sha256Value(cues),
    cues,
    assEventEvidence: cues.map((cue, index) => ({
      cueId: cue.id,
      ...(styleResult.events[index] ?? {
        layer: 0,
        name: null,
        style: "Default",
      }),
    })),
    warnings,
  };
}

export async function verifyHumanReviewedSubtitleReadOnly(
  input: LoadedHumanReviewedSubtitle,
): Promise<boolean> {
  const current = await stat(input.sourcePath);
  return (
    current.isFile() &&
    current.size === input.sourceFileSize &&
    current.mtimeMs === input.sourceMtimeMs &&
    (await sha256LocalFile(input.sourcePath)) === input.sourceFileSha256
  );
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

function parsedCanonicalParity(
  source: readonly SubtitleCue[],
  parsed: readonly ParsedCue[],
  timingTolerance: number,
): boolean {
  if (source.length !== parsed.length) return false;
  return source.every((cue, index) => {
    const item = parsed[index];
    return (
      item !== undefined &&
      presentationLexicalText(item.text) ===
        presentationLexicalText(cue.text) &&
      Math.abs(item.start - cue.start) <= timingTolerance &&
      Math.abs(item.end - cue.end) <= timingTolerance
    );
  });
}

function normalizedDisplayText(value: string): string {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function parsedPresentationParity(
  source: readonly SubtitleCue[],
  parsed: readonly ParsedCue[],
  displayTextByCueId: ReadonlyMap<string, string>,
  timingTolerance: number,
): boolean {
  if (source.length !== parsed.length) return false;
  return source.every((cue, index) => {
    const item = parsed[index];
    const expected = displayTextByCueId.get(cue.id) ?? cue.text;
    return (
      item !== undefined &&
      normalizedDisplayText(item.text) === normalizedDisplayText(expected) &&
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
  canonicalParityPassed: boolean;
  presentationParityPassed: boolean;
  formatParityErrorCount: number;
  serialized: SerializedFinalSubtitles;
}

export function evaluateFinalCueQuality(input: {
  cues: readonly SubtitleCue[];
  mediaDurationSeconds: number;
  presentation?: SubtitlePresentationResolutionResult;
  presentationResolutionMode?: "off" | "observe" | "enforce";
}): FinalCueQualityResult {
  const findings: FinalizationFinding[] = [];
  const presentationResolutionMode = input.presentationResolutionMode ?? "off";
  const enforced =
    presentationResolutionMode === "enforce" &&
    input.presentation !== undefined;
  const layoutByCueId = new Map(
    input.presentation?.artifact.layoutDecisions.map((decision) => [
      decision.cueId,
      decision,
    ]) ?? [],
  );
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
    const lines = cue.text.split("\n");
    const layoutDecision = layoutByCueId.get(cue.id);
    const layoutAutoResolved =
      enforced &&
      layoutDecision !== undefined &&
      layoutDecision.resolved &&
      !layoutDecision.blocking &&
      layoutDecision.canonicalLexicalHash === layoutDecision.displayLexicalHash;
    if (lines.length > 2 && !layoutAutoResolved) {
      findings.push(
        finding(
          "FINAL_CUE_EXCEEDS_TWO_LINES",
          [cue.id],
          "Cue exceeds two lines.",
        ),
      );
    }
    if (
      lines.some((line) => Array.from(line).length > 16) &&
      !layoutAutoResolved
    ) {
      findings.push(
        finding(
          "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
          [cue.id],
          "A rendered line exceeds 16 Unicode code points.",
        ),
      );
    }
    if (
      layoutAutoResolved &&
      (lines.length > 2 || lines.some((line) => Array.from(line).length > 16))
    ) {
      findings.push(
        finding(
          "PRESENTATION_LINE_LAYOUT_AUTO_RESOLVED",
          [cue.id],
          "A display-only line layout satisfies the two-line capacity without changing canonical text or timing.",
          "warning",
        ),
      );
    }
  }
  if (
    input.presentation === undefined ||
    presentationResolutionMode === "off"
  ) {
    for (let index = 1; index < input.cues.length; index += 1) {
      const previous = input.cues[index - 1];
      const cue = input.cues[index];
      if (previous === undefined || cue === undefined) continue;
      if (cue.start < previous.end - 0.01) {
        findings.push(
          finding(
            "ILLEGAL_SUBTITLE_OVERLAP",
            [previous.id, cue.id],
            "Adjacent cues overlap.",
          ),
        );
      }
      if (
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
  } else {
    for (const decision of input.presentation.artifact.repetitionDecisions) {
      if (enforced && !decision.blocking) {
        findings.push(
          finding(
            "INTENTIONAL_REPETITION_CLASSIFIED",
            decision.cueIds,
            `Adjacent identical text was classified as ${decision.relationship} and both utterances were preserved.`,
            "warning",
          ),
        );
      } else {
        findings.push(
          finding(
            "UNRESOLVED_CROSS_CUE_REPETITION",
            decision.cueIds,
            `Adjacent identical text remains ${decision.relationship}.`,
          ),
        );
      }
    }
    for (const decision of input.presentation.artifact.overlapDecisions) {
      if (enforced && !decision.blocking) {
        findings.push(
          finding(
            decision.safeAutomaticAction === "timing-only"
              ? "TRUSTED_TIMING_ONLY_OVERLAP_REPAIR"
              : "LEGAL_SUBTITLE_OVERLAP_CLASSIFIED",
            decision.cueIds,
            `Overlap component was resolved as ${decision.relationship}.`,
            "warning",
          ),
        );
      } else {
        findings.push(
          finding(
            "ILLEGAL_SUBTITLE_OVERLAP",
            decision.cueIds,
            `Overlap component remains ${decision.relationship}; no unsupported timing or deletion action was applied.`,
          ),
        );
      }
    }
    if (
      enforced &&
      input.presentation.artifact.summary.srtOverlapRenderingMayVary
    ) {
      findings.push(
        finding(
          "SRT_OVERLAP_RENDERING_MAY_VARY",
          [],
          "Legal overlapping cues are preserved in SRT; simultaneous rendering depends on the player.",
          "warning",
        ),
      );
    }
  }
  const serialized = {
    srt: formatSrt(input.cues, {
      ...(input.presentation === undefined
        ? {}
        : { displayTextByCueId: input.presentation.displayTextByCueId }),
    }),
    vtt: formatVtt(input.cues, {
      ...(input.presentation === undefined
        ? {}
        : {
            displayTextByCueId: input.presentation.displayTextByCueId,
            cueSettingsByCueId: input.presentation.vttCueSettingsByCueId,
          }),
    }),
    ass: formatAss(input.cues, {
      ...(input.presentation === undefined
        ? {}
        : {
            displayTextByCueId: input.presentation.displayTextByCueId,
            eventOverridesByCueId: input.presentation.assEventOverridesByCueId,
          }),
    }),
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
  const canonicalParity =
    serializationRoundTripPassed &&
    parsedCanonicalParity(input.cues, srt, 0.001) &&
    parsedCanonicalParity(input.cues, vtt, 0.001) &&
    parsedCanonicalParity(input.cues, ass, 0.011) &&
    srt.length === vtt.length &&
    vtt.length === ass.length;
  const displayTextByCueId =
    input.presentation?.displayTextByCueId ?? new Map<string, string>();
  const presentationParity =
    serializationRoundTripPassed &&
    parsedPresentationParity(input.cues, srt, displayTextByCueId, 0.001) &&
    parsedPresentationParity(input.cues, vtt, displayTextByCueId, 0.001) &&
    parsedPresentationParity(input.cues, ass, displayTextByCueId, 0.011);
  const parity = canonicalParity && presentationParity;
  if (!canonicalParity) {
    findings.push(
      finding(
        "FORMAT_CANONICAL_PARITY_FAILED",
        [],
        "SRT, VTT, and ASS do not round-trip to the canonical cue semantics after display-only whitespace and markup are removed.",
      ),
    );
  }
  if (!presentationParity) {
    findings.push(
      finding(
        "FORMAT_PRESENTATION_PARITY_FAILED",
        [],
        "SRT, VTT, and ASS do not round-trip to the selected display text.",
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
    canonicalParityPassed: canonicalParity,
    presentationParityPassed: presentationParity,
    formatParityErrorCount:
      Number(!canonicalParity) + Number(!presentationParity),
    serialized,
  };
}
