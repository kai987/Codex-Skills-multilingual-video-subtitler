import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  InputError,
  NodeProcessRunner,
  atomicWriteFile,
  atomicWriteJson,
  finalizationThresholdsSchema,
  subtitleFinalizationReportSchema,
  type CueDecision,
  type FinalizationCandidate,
  type FinalizationFinding,
  type FinalizationMethod,
  type FinalizationMode,
  type FinalizationStatus,
  type FinalizationThresholds,
  type Logger,
  type ProcessRunner,
  type SourceFingerprint,
  type SubtitleCue,
  type SubtitleFinalizationReport,
  type SubtitlePackage,
} from "@mvl/shared";
import {
  DEFAULT_FINALIZATION_THRESHOLDS,
  aggregateCueDecisions,
  applyAutomaticCueDecisions,
  normalizeFinalizationText,
  repairSafeExactDuplicateCues,
} from "@mvl/transcription-core";
import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";

import {
  evaluateFinalCueQuality,
  isRecord,
  loadHumanReviewedSubtitle,
  loadFinalizationCandidates,
  locateSubtitlePackage,
  projectStrictSubtitlePackage,
  sha256JsonFileValue,
  sha256LocalFile,
  sha256Value,
  verifyHumanReviewedSubtitleReadOnly,
} from "./finalization-support.js";
import {
  applyHumanReviewResolutions,
  loadHumanReviewResolutions,
  loadReviewPackage,
  prepareSubtitleReviewPackage,
} from "./review.js";
import { subtitleArtifactStem } from "./output-paths.js";
import { burnSubtitleIntoVideo } from "./burn.js";

export interface SubtitleFinalizationOptions {
  taskDirectory: string;
  mode?: FinalizationMode;
  resolutionsPath?: string;
  humanReviewedSubtitlePath?: string;
  sourceVideoPath?: string;
  prepareReview?: boolean;
  generateReviewAudio?: boolean;
  dryRun?: boolean;
  ffmpegPath?: string;
  runner?: ProcessRunner;
  logger?: Logger;
  thresholds?: Partial<FinalizationThresholds>;
}

export interface SubtitleFinalizationResult {
  dryRun: boolean;
  subtitleDirectory: string;
  report: SubtitleFinalizationReport;
  subtitlePackage: SubtitlePackage;
  outputPaths: {
    srt: string;
    vtt: string;
    ass: string;
    subtitlePackage: string;
    report: string;
    reviewPackage: string | null;
    reviewPage: string | null;
    correctionFeedback: string | null;
    humanReviewedBasePackage: string | null;
  };
}

function relativeFrom(directory: string, target: string): string {
  return path.relative(directory, target).split(path.sep).join("/");
}

function finalizationArtifactStem(sourceFileName: string): string {
  const stem = subtitleArtifactStem(sourceFileName);
  let output = "";
  for (const character of stem) {
    if (Buffer.byteLength(output + character, "utf8") > 220) break;
    output += character;
  }
  return output;
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

async function existingFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function discoverSourceVideo(input: {
  explicitPath?: string;
  taskDirectory: string;
  subtitleDirectory: string;
}): Promise<string | null> {
  if (input.explicitPath !== undefined) {
    const explicit = path.resolve(input.explicitPath);
    if (!(await existingFile(explicit))) {
      throw new InputError(`Selected source video does not exist: ${explicit}`);
    }
    return explicit;
  }
  const candidates = [
    path.join(input.taskDirectory, "processing-manifest.json"),
    path.join(
      path.dirname(input.subtitleDirectory),
      "processing-manifest.json",
    ),
    path.join(input.subtitleDirectory, "processing-manifest.json"),
  ];
  for (const manifestPath of [...new Set(candidates)]) {
    if (!(await existingFile(manifestPath))) continue;
    try {
      const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      if (!isRecord(raw)) continue;
      for (const key of ["sourcePath", "workingMediaPath"] as const) {
        const value = raw[key];
        if (typeof value === "string" && (await existingFile(value))) {
          return path.resolve(value);
        }
      }
    } catch {
      // A stale manifest does not make artifact-only finalization impossible.
    }
  }
  return null;
}

async function sourceFingerprint(input: {
  sourceVideoPath: string | null;
  subtitlePackage: SubtitlePackage;
}): Promise<{
  fingerprint: SourceFingerprint;
  mtimeMs: number | null;
}> {
  if (input.sourceVideoPath === null) {
    const descriptor = {
      fileName: input.subtitlePackage.source.fileName,
      durationSeconds: input.subtitlePackage.source.durationSeconds,
      unavailable: true,
    };
    return {
      fingerprint: {
        fileName: input.subtitlePackage.source.fileName,
        size: 0,
        durationSeconds: input.subtitlePackage.source.durationSeconds,
        sha256: sha256Value(descriptor),
      },
      mtimeMs: null,
    };
  }
  const info = await stat(input.sourceVideoPath);
  return {
    fingerprint: {
      fileName: path.basename(input.sourceVideoPath),
      size: info.size,
      durationSeconds: input.subtitlePackage.source.durationSeconds,
      sha256: await sha256LocalFile(input.sourceVideoPath),
    },
    mtimeMs: info.mtimeMs,
  };
}

async function verifySourceReadOnly(input: {
  sourceVideoPath: string | null;
  before: SourceFingerprint;
  mtimeMs: number | null;
}): Promise<boolean> {
  if (input.sourceVideoPath === null || input.mtimeMs === null) return false;
  const after = await stat(input.sourceVideoPath);
  if (after.size !== input.before.size || after.mtimeMs !== input.mtimeMs) {
    return false;
  }
  return (await sha256LocalFile(input.sourceVideoPath)) === input.before.sha256;
}

function basePackageValidation(
  rawPackage: unknown,
): "validated" | "needs-review" | "rejected" | null {
  if (!isRecord(rawPackage) || !isRecord(rawPackage.primarySubtitle))
    return null;
  const value = rawPackage.primarySubtitle.validationStatus;
  return ["validated", "needs-review", "rejected"].includes(String(value))
    ? (value as "validated" | "needs-review" | "rejected")
    : null;
}

function decisionFindings(
  decisions: readonly CueDecision[],
): FinalizationFinding[] {
  return decisions
    .filter((decision) => decision.requiresHumanReview)
    .map((decision) =>
      finding(
        "UNRESOLVED_MANDATORY_REVIEW",
        decision.targetCueIds,
        `Decision ${decision.decisionId} is suggestion-only: ${decision.blockers.join(", ") || "insufficient evidence"}.`,
      ),
    );
}

function mergeIntegrityFindingsIntoDecisions(input: {
  decisions: readonly CueDecision[];
  findings: readonly FinalizationFinding[];
  cues: readonly SubtitleCue[];
}): CueDecision[] {
  const cueById = new Map(input.cues.map((cue) => [cue.id, cue]));
  const decisions = [...input.decisions];
  for (const findingItem of input.findings.filter(
    (item) => item.severity === "blocking" && item.cueIds.length > 0,
  )) {
    const targetCueIds = [
      ...new Set(findingItem.cueIds.filter((cueId) => cueById.has(cueId))),
    ].sort((left, right) => left.localeCompare(right));
    if (targetCueIds.length === 0) continue;
    const overlapping = decisions.filter((decision) =>
      decision.targetCueIds.some((cueId) => targetCueIds.includes(cueId)),
    );
    const mergedCueIds = [
      ...new Set([
        ...targetCueIds,
        ...overlapping.flatMap((decision) => decision.targetCueIds),
      ]),
    ].sort((left, right) => left.localeCompare(right));
    const primary = overlapping[0];
    const alternatives = [
      ...new Set(
        overlapping.flatMap((decision, index) => [
          ...decision.alternativeCandidateIds,
          ...(index === 0 || decision.selectedCandidateId === null
            ? []
            : [decision.selectedCandidateId]),
        ]),
      ),
    ].sort((left, right) => left.localeCompare(right));
    for (const decision of overlapping) {
      decisions.splice(decisions.indexOf(decision), 1);
    }
    decisions.push({
      decisionId: `decision-${sha256Value({ targetCueIds: mergedCueIds }).slice(0, 20)}`,
      targetCueIds: mergedCueIds,
      action:
        overlapping.length === 1 && primary !== undefined
          ? primary.action
          : "REVIEW_ONLY",
      currentText: mergedCueIds
        .map((cueId) => cueById.get(cueId)?.text ?? "")
        .filter(Boolean)
        .join("\n"),
      proposedText: primary?.proposedText ?? null,
      proposedCues: primary?.proposedCues ?? [],
      selectedCandidateId: primary?.selectedCandidateId ?? null,
      alternativeCandidateIds: alternatives,
      evidenceIds: [
        ...new Set([
          findingItem.findingId,
          ...overlapping.flatMap((decision) => decision.evidenceIds),
        ]),
      ].sort((left, right) => left.localeCompare(right)),
      blockers: [
        ...new Set([
          findingItem.code,
          ...overlapping.flatMap((decision) => decision.blockers),
        ]),
      ].sort((left, right) => left.localeCompare(right)),
      automaticMutationEligible:
        overlapping.length === 1 && primary?.automaticMutationEligible === true,
      requiresHumanReview: true,
      decisionReasons: [
        "FINAL_INTEGRITY_FINDING_REQUIRES_REVIEW",
        ...overlapping.flatMap((decision) => decision.decisionReasons),
      ],
    });
  }
  return decisions.sort((left, right) =>
    left.decisionId.localeCompare(right.decisionId),
  );
}

function addWholePackageReviewDecisions(input: {
  decisions: readonly CueDecision[];
  cues: readonly SubtitleCue[];
  reason: string;
}): CueDecision[] {
  const occupied = new Set(
    input.decisions.flatMap((decision) => decision.targetCueIds),
  );
  return [
    ...input.decisions,
    ...input.cues
      .filter((cue) => !occupied.has(cue.id))
      .map((cue): CueDecision => ({
        decisionId: `decision-${sha256Value({ cueId: cue.id, reason: input.reason }).slice(0, 20)}`,
        targetCueIds: [cue.id],
        action: "KEEP",
        currentText: cue.text,
        proposedText: null,
        proposedCues: [],
        selectedCandidateId: null,
        alternativeCandidateIds: [],
        evidenceIds: [],
        blockers: [input.reason],
        automaticMutationEligible: false,
        requiresHumanReview: true,
        decisionReasons: [input.reason],
      })),
  ].sort((left, right) => left.decisionId.localeCompare(right.decisionId));
}

function decisionCandidate(
  decision: CueDecision,
  candidates: readonly FinalizationCandidate[],
): FinalizationCandidate | undefined {
  return candidates.find(
    (candidate) => candidate.candidateId === decision.selectedCandidateId,
  );
}

function visibleMutationMetrics(input: {
  decisions: readonly CueDecision[];
  candidates: readonly FinalizationCandidate[];
}) {
  const automatic = input.decisions.filter(
    (decision) => decision.automaticMutationEligible,
  );
  const candidateFor = (decision: CueDecision) =>
    decisionCandidate(decision, input.candidates);
  return {
    broadWindowVisibleMutationCount: automatic.filter(
      (decision) =>
        candidateFor(decision)?.associationType === "BROAD_WINDOW_ASSOCIATION",
    ).length,
    ambiguousVisibleMutationCount: automatic.filter(
      (decision) =>
        candidateFor(decision)?.associationType === "AMBIGUOUS_ASSOCIATION",
    ).length,
    localIntervalMissingVisibleMutationCount: automatic.filter(
      (decision) => candidateFor(decision)?.localInterval === null,
    ).length,
    fullCueFragmentReplacementCount: automatic.filter((decision) => {
      const candidate = candidateFor(decision);
      return (
        candidate !== undefined &&
        (candidate.partialFragment ||
          (normalizeFinalizationText(decision.currentText).includes(
            normalizeFinalizationText(candidate.candidateText),
          ) &&
            normalizeFinalizationText(decision.currentText).length >
              normalizeFinalizationText(candidate.candidateText).length))
      );
    }).length,
  };
}

function changedCueRate(
  before: readonly SubtitleCue[],
  after: readonly SubtitleCue[],
  field: "text" | "timing",
): number {
  if (before.length === 0) return 0;
  const afterById = new Map(after.map((cue) => [cue.id, cue]));
  const changed = before.filter((cue) => {
    const next = afterById.get(cue.id);
    if (next === undefined) return true;
    return field === "text"
      ? next.text !== cue.text
      : next.start !== cue.start || next.end !== cue.end;
  }).length;
  return Math.min(1, changed / before.length);
}

function finalizationState(input: {
  passed: boolean;
  baseRejected: boolean;
  humanDecisionCount: number;
  automaticDecisionCount: number;
  humanReviewedBaseline: boolean;
}): { status: FinalizationStatus; method: FinalizationMethod } {
  if (input.baseRejected) return { status: "rejected", method: "none" };
  if (!input.passed) return { status: "needs-review", method: "none" };
  const hasHumanAuthority =
    input.humanDecisionCount > 0 || input.humanReviewedBaseline;
  if (hasHumanAuthority && input.automaticDecisionCount > 0) {
    return { status: "mixed-validated", method: "mixed" };
  }
  if (hasHumanAuthority) {
    return { status: "human-validated", method: "human" };
  }
  return { status: "auto-validated", method: "automatic" };
}

function applyRollbackToUnsafeOutput(input: {
  baseCues: readonly SubtitleCue[];
  candidates: readonly FinalizationCandidate[];
  decisions: readonly CueDecision[];
}): {
  cues: SubtitleCue[];
  decisions: CueDecision[];
  rollbackApplied: boolean;
} {
  const lexical = new Set([
    "REPLACE",
    "EXPAND",
    "SPLIT",
    "MERGE",
    "REDISTRIBUTE",
    "DELETE_HALLUCINATION",
  ]);
  const rollbackApplied = input.decisions.some(
    (decision) =>
      decision.automaticMutationEligible && lexical.has(decision.action),
  );
  if (!rollbackApplied) {
    const applied = applyAutomaticCueDecisions({
      cues: input.baseCues,
      candidates: input.candidates,
      decisions: input.decisions,
    });
    return {
      cues: applied.cues,
      decisions: [...input.decisions],
      rollbackApplied,
    };
  }
  const decisions = input.decisions.map((decision) =>
    decision.automaticMutationEligible && lexical.has(decision.action)
      ? {
          ...decision,
          action: "REVIEW_ONLY" as const,
          blockers: [
            ...new Set([...decision.blockers, "AUTO_MUTATION_ROLLED_BACK"]),
          ],
          automaticMutationEligible: false,
          requiresHumanReview: true,
          decisionReasons: [
            ...decision.decisionReasons,
            "AUTO_MUTATION_ROLLED_BACK_AFTER_FINAL_QUALITY_FAILURE",
          ],
        }
      : decision,
  );
  const applied = applyAutomaticCueDecisions({
    cues: input.baseCues,
    candidates: input.candidates,
    decisions,
  });
  return { cues: applied.cues, decisions, rollbackApplied };
}

export async function finalizeSubtitleTask(
  options: SubtitleFinalizationOptions,
): Promise<SubtitleFinalizationResult> {
  const mode = options.mode ?? "review-fallback";
  const runner = options.runner ?? new NodeProcessRunner();
  const located = await locateSubtitlePackage(options.taskDirectory);
  const rawPackage = JSON.parse(
    await readFile(located.packagePath, "utf8"),
  ) as unknown;
  const rawSourceFileName =
    isRecord(rawPackage) && isRecord(rawPackage.source)
      ? rawPackage.source.fileName
      : undefined;
  const baseStem = finalizationArtifactStem(
    typeof rawSourceFileName === "string" ? rawSourceFileName : "video",
  );
  const draftNames = {
    srt: path.join(located.subtitleDirectory, `${baseStem}.srt`),
    vtt: path.join(located.subtitleDirectory, `${baseStem}.vtt`),
    ass: path.join(located.subtitleDirectory, `${baseStem}.ass`),
  };
  const humanReviewedBaseline =
    options.humanReviewedSubtitlePath === undefined
      ? null
      : await loadHumanReviewedSubtitle(options.humanReviewedSubtitlePath);
  const humanReviewedBaseFiles =
    humanReviewedBaseline === null
      ? null
      : {
          srt: path.join(
            located.subtitleDirectory,
            `${baseStem}.human-reviewed-base.srt`,
          ),
          vtt: path.join(
            located.subtitleDirectory,
            `${baseStem}.human-reviewed-base.vtt`,
          ),
          ass: path.join(
            located.subtitleDirectory,
            `${baseStem}.human-reviewed-base.ass`,
          ),
        };
  const projectionRawPackage =
    humanReviewedBaseline === null || !isRecord(rawPackage)
      ? rawPackage
      : {
          ...rawPackage,
          warnings: [
            ...(Array.isArray(rawPackage.warnings)
              ? rawPackage.warnings.filter(
                  (warning): warning is string => typeof warning === "string",
                )
              : []),
            `Imported user-confirmed human-reviewed baseline ${humanReviewedBaseline.sourceFileName}.`,
            ...humanReviewedBaseline.warnings,
          ],
        };
  const projectedDraft = projectStrictSubtitlePackage({
    rawPackage: projectionRawPackage,
    ...(humanReviewedBaseline === null
      ? {}
      : { cues: humanReviewedBaseline.cues }),
    validationStatus:
      humanReviewedBaseline === null
        ? (basePackageValidation(rawPackage) ?? "needs-review")
        : "needs-review",
    files: humanReviewedBaseFiles ?? draftNames,
  });
  const machineCues = projectedDraft.cues;
  const humanReviewedBasePackagePath =
    humanReviewedBaseline === null
      ? null
      : path.join(
          located.subtitleDirectory,
          "subtitle-package.human-reviewed-base.json",
        );
  const effectiveBasePackagePath =
    humanReviewedBasePackagePath ?? located.packagePath;
  const baseSubtitlePackageHash =
    humanReviewedBaseline === null
      ? await sha256LocalFile(located.packagePath)
      : sha256JsonFileValue(projectedDraft);
  const baseCueHash = sha256Value(machineCues);
  const loadedCandidates =
    humanReviewedBaseline === null
      ? await loadFinalizationCandidates({
          subtitleDirectory: located.subtitleDirectory,
          cues: machineCues,
        })
      : { candidates: [], evidencePath: null };
  const sortedCandidates = [...loadedCandidates.candidates].sort(
    (left, right) => left.candidateId.localeCompare(right.candidateId),
  );
  const inputEvidenceHash =
    humanReviewedBaseline === null
      ? sha256Value(sortedCandidates)
      : sha256Value({
          humanReviewedBaseline: {
            sourceFileSha256: humanReviewedBaseline.sourceFileSha256,
            cueHash: humanReviewedBaseline.cueHash,
          },
          candidates: sortedCandidates,
        });
  const thresholds = finalizationThresholdsSchema.parse({
    ...DEFAULT_FINALIZATION_THRESHOLDS,
    ...options.thresholds,
  });
  const aggregated = aggregateCueDecisions({
    cues: machineCues,
    candidates: loadedCandidates.candidates,
    thresholds,
  });
  const excluded = new Set(
    aggregated.decisions.flatMap((decision) => decision.targetCueIds),
  );
  const duplicateRepair =
    humanReviewedBaseline === null
      ? repairSafeExactDuplicateCues({
          cues: machineCues,
          excludedCueIds: excluded,
        })
      : { cues: [...machineCues], decisions: [] };
  let decisions = [...aggregated.decisions, ...duplicateRepair.decisions].sort(
    (left, right) => left.decisionId.localeCompare(right.decisionId),
  );
  const automatic = applyAutomaticCueDecisions({
    cues: duplicateRepair.cues,
    candidates: aggregated.candidates,
    decisions,
  });
  let workingCues = automatic.cues;
  let humanDecisionCount = 0;
  let unresolvedHumanCount = 0;
  let correctionFeedback:
    ReturnType<typeof applyHumanReviewResolutions>["feedback"] | null = null;
  const sourceVideoPath = await discoverSourceVideo({
    ...(options.sourceVideoPath === undefined
      ? {}
      : { explicitPath: options.sourceVideoPath }),
    taskDirectory: located.taskDirectory,
    subtitleDirectory: located.subtitleDirectory,
  });
  const beforeSource = await sourceFingerprint({
    sourceVideoPath,
    subtitlePackage: projectedDraft,
  });
  if (options.resolutionsPath !== undefined) {
    const reviewPackage = await loadReviewPackage(located.subtitleDirectory);
    const resolutions = await loadHumanReviewResolutions(
      options.resolutionsPath,
    );
    const human = applyHumanReviewResolutions({
      cues: workingCues,
      subtitlePackage: projectedDraft,
      reviewPackage,
      resolutions,
      currentSourceFingerprint: beforeSource.fingerprint,
    });
    workingCues = human.cues;
    humanDecisionCount = human.humanDecisionCount;
    unresolvedHumanCount = human.unresolvedCount;
    correctionFeedback = human.feedback;
  }

  const baseValidation =
    humanReviewedBaseline === null
      ? basePackageValidation(rawPackage)
      : "validated";
  let findings: FinalizationFinding[] = [];
  if (humanReviewedBaseline !== null) {
    findings.push(
      finding(
        "HUMAN_REVIEWED_BASELINE_IMPORTED",
        [],
        `Imported ${humanReviewedBaseline.cues.length} user-confirmed human-reviewed cues; historical machine candidates and automatic duplicate repair were disabled.`,
        "warning",
      ),
    );
    if (humanReviewedBaseline.timestampNormalizationCount > 0) {
      findings.push(
        finding(
          "ASS_TIMESTAMP_DECIMAL_COMMA_NORMALIZED",
          [],
          `Normalized ${humanReviewedBaseline.timestampNormalizationCount} ASS timestamp decimal comma separator(s) in memory without modifying the source file.`,
          "warning",
        ),
      );
    }
  }
  if (sourceVideoPath === null) {
    findings.push(
      finding(
        "SOURCE_MEDIA_UNAVAILABLE_FOR_READ_ONLY_VERIFICATION",
        [],
        "Artifact-only finalization could not re-hash the source video.",
        "warning",
      ),
    );
  }
  if (options.resolutionsPath === undefined) {
    findings.push(...decisionFindings(decisions));
    if (baseValidation === "needs-review") {
      findings.push(
        finding(
          "BASE_PACKAGE_NEEDS_REVIEW",
          [],
          "The machine package has not been independently validated.",
        ),
      );
    }
    if (mode === "human") {
      findings.push(
        finding(
          "HUMAN_MODE_REVIEW_REQUIRED",
          [],
          "Human mode requires explicit resolutions before validation.",
        ),
      );
    }
  } else if (unresolvedHumanCount > 0) {
    findings.push(
      finding(
        "UNRESOLVED_HUMAN_REVIEW_ITEMS",
        [],
        `${unresolvedHumanCount} mandatory review items remain unresolved.`,
      ),
    );
  }
  let quality = evaluateFinalCueQuality({
    cues: workingCues,
    mediaDurationSeconds: projectedDraft.source.durationSeconds,
  });
  findings.push(...quality.findings);
  let rollbackApplied = false;
  if (
    options.resolutionsPath === undefined &&
    quality.findings.some((item) => item.severity === "blocking") &&
    automatic.mutationCount + duplicateRepair.decisions.length > 0
  ) {
    const rollback = applyRollbackToUnsafeOutput({
      baseCues: duplicateRepair.cues,
      candidates: aggregated.candidates,
      decisions,
    });
    workingCues = rollback.cues;
    decisions = rollback.decisions;
    rollbackApplied = rollback.rollbackApplied;
    findings = findings.filter(
      (item) =>
        !quality.findings.some(
          (qualityItem) => qualityItem.findingId === item.findingId,
        ),
    );
    quality = evaluateFinalCueQuality({
      cues: workingCues,
      mediaDurationSeconds: projectedDraft.source.durationSeconds,
    });
    findings.push(...quality.findings);
    if (rollbackApplied) {
      findings.push(
        finding(
          "AUTOMATIC_TEXT_MUTATIONS_ROLLED_BACK",
          [],
          "Lexical automatic mutations were rolled back after the final quality gate failed.",
        ),
      );
    }
  }
  const sourceReadOnlyVerified = await verifySourceReadOnly({
    sourceVideoPath,
    before: beforeSource.fingerprint,
    mtimeMs: beforeSource.mtimeMs,
  });
  if (sourceVideoPath !== null && !sourceReadOnlyVerified) {
    findings.push(
      finding(
        "SOURCE_MEDIA_CHANGED",
        [],
        "Source media size, mtime, or SHA-256 changed during finalization.",
      ),
    );
  }
  const humanReviewedSourceReadOnlyVerified =
    humanReviewedBaseline === null ||
    (await verifyHumanReviewedSubtitleReadOnly(humanReviewedBaseline));
  if (!humanReviewedSourceReadOnlyVerified) {
    findings.push(
      finding(
        "HUMAN_REVIEWED_SUBTITLE_CHANGED",
        [],
        "The human-reviewed subtitle changed during finalization.",
      ),
    );
  }
  decisions = mergeIntegrityFindingsIntoDecisions({
    decisions,
    findings: quality.findings,
    cues: workingCues,
  });
  if (
    options.resolutionsPath === undefined &&
    (mode === "human" ||
      (baseValidation === "needs-review" && decisions.length === 0))
  ) {
    decisions = addWholePackageReviewDecisions({
      decisions,
      cues: workingCues,
      reason:
        mode === "human"
          ? "HUMAN_MODE_REVIEW_REQUIRED"
          : "BASE_PACKAGE_NEEDS_REVIEW",
    });
  }
  const visible = visibleMutationMetrics({
    decisions,
    candidates: aggregated.candidates,
  });
  const automaticDecisionCount = decisions.filter(
    (decision) => decision.automaticMutationEligible,
  ).length;
  const suggestionOnlyCount = decisions.filter(
    (decision) => !decision.automaticMutationEligible,
  ).length;
  const unsafeAutomaticMutationCount =
    visible.broadWindowVisibleMutationCount +
    visible.ambiguousVisibleMutationCount +
    visible.localIntervalMissingVisibleMutationCount +
    visible.fullCueFragmentReplacementCount;
  if (unsafeAutomaticMutationCount > 0) {
    findings.push(
      finding(
        "UNSAFE_AUTOMATIC_MUTATION",
        [],
        `${unsafeAutomaticMutationCount} unsafe visible mutations escaped the safety gate.`,
      ),
    );
  }
  const blockingFindingCount = findings.filter(
    (item) => item.severity === "blocking",
  ).length;
  const qualityPassed =
    baseValidation !== "rejected" &&
    blockingFindingCount === 0 &&
    unresolvedHumanCount === 0 &&
    unsafeAutomaticMutationCount === 0 &&
    quality.finalIntegrityPassed &&
    quality.serializationRoundTripPassed &&
    quality.formatSemanticParityPassed;
  const state = finalizationState({
    passed: qualityPassed,
    baseRejected: baseValidation === "rejected",
    humanDecisionCount,
    automaticDecisionCount,
    humanReviewedBaseline: humanReviewedBaseline !== null,
  });
  const validated = [
    "auto-validated",
    "human-validated",
    "mixed-validated",
  ].includes(state.status);
  const suffix = validated ? "final" : "best-effort";
  const outputPaths = {
    srt: path.join(located.subtitleDirectory, `${baseStem}.${suffix}.srt`),
    vtt: path.join(located.subtitleDirectory, `${baseStem}.${suffix}.vtt`),
    ass: path.join(located.subtitleDirectory, `${baseStem}.${suffix}.ass`),
    subtitlePackage: path.join(
      located.subtitleDirectory,
      validated
        ? "subtitle-package.final.json"
        : "subtitle-package.needs-review.json",
    ),
    report: path.join(
      located.subtitleDirectory,
      "subtitle-finalization-report.json",
    ),
  };
  const finalPackage = projectStrictSubtitlePackage({
    rawPackage: projectionRawPackage,
    cues: workingCues,
    validationStatus:
      state.status === "rejected"
        ? "rejected"
        : validated
          ? "validated"
          : "needs-review",
    files: outputPaths,
  });
  const shouldPrepareReview =
    options.prepareReview === true ||
    mode === "human" ||
    (mode === "review-fallback" && !validated);
  let reviewPackagePath: string | null = null;
  let reviewPagePath: string | null = null;
  let reviewItemCount = 0;
  if (shouldPrepareReview && options.dryRun !== true) {
    const review = await prepareSubtitleReviewPackage({
      subtitleDirectory: located.subtitleDirectory,
      baseSubtitlePackagePath: effectiveBasePackagePath,
      baseSubtitlePackageHash,
      baseCueHash,
      inputEvidenceHash,
      sourceFingerprint: beforeSource.fingerprint,
      sourceVideoPath,
      subtitlePackage: projectedDraft,
      cues: workingCues,
      candidates: aggregated.candidates,
      decisions,
      findings,
      runner,
      ffmpegPath: options.ffmpegPath ?? "ffmpeg",
      generateAudio: options.generateReviewAudio ?? true,
      reviewAllCues:
        mode === "human" ||
        findings.some(
          (item) =>
            item.severity === "blocking" &&
            item.cueIds.length === 0 &&
            item.code !== "BASE_PACKAGE_NEEDS_REVIEW",
        ) ||
        decisions.every((decision) => !decision.requiresHumanReview),
    });
    reviewPackagePath = review.packagePath;
    reviewPagePath = review.pagePath;
    reviewItemCount = review.reviewPackage.summary.itemCount;
  }
  if (
    sourceVideoPath !== null &&
    !(await verifySourceReadOnly({
      sourceVideoPath,
      before: beforeSource.fingerprint,
      mtimeMs: beforeSource.mtimeMs,
    }))
  ) {
    throw new InputError(
      "Source media changed while review artifacts were being prepared; validated output was not written.",
    );
  }
  if (
    humanReviewedBaseline !== null &&
    !(await verifyHumanReviewedSubtitleReadOnly(humanReviewedBaseline))
  ) {
    throw new InputError(
      "The human-reviewed subtitle changed while review artifacts were being prepared; output was not written.",
    );
  }
  const correctionFeedbackPath =
    correctionFeedback === null
      ? null
      : path.join(located.subtitleDirectory, "correction-feedback.json");
  const outputHash = sha256Value({
    package: finalPackage,
    srt: quality.serialized.srt,
    vtt: quality.serialized.vtt,
    ass: quality.serialized.ass,
  });
  const machineCueCount = machineCues.length;
  const denominator = Math.max(1, machineCueCount);
  const blockingCueIds = new Set(
    findings
      .filter((item) => item.severity === "blocking")
      .flatMap((item) => item.cueIds),
  );
  const manualReviewCueIds = new Set(
    decisions
      .filter((decision) => decision.requiresHumanReview)
      .flatMap((decision) => decision.targetCueIds),
  );
  const hasGlobalBlockingFinding = findings.some(
    (item) => item.severity === "blocking" && item.cueIds.length === 0,
  );
  const errorTypes =
    correctionFeedback?.records.flatMap((record) => record.errorTypes) ?? [];
  const report = subtitleFinalizationReportSchema.parse({
    schemaVersion: "1.0.0",
    reportType: "subtitle-finalization-report",
    finalizationVersion: "1.1.0",
    generatedAt: new Date().toISOString(),
    mode,
    status: state.status,
    finalizationMethod: state.method,
    baseSubtitlePackageHash,
    baseCueHash,
    inputEvidenceHash,
    outputCueHash: sha256Value(workingCues),
    outputHash,
    humanReviewedBaseline:
      humanReviewedBaseline === null || humanReviewedBasePackagePath === null
        ? null
        : {
            authority: "user-confirmed-human-review",
            sourceFileName: humanReviewedBaseline.sourceFileName,
            sourceFileSha256: humanReviewedBaseline.sourceFileSha256,
            sourceFileSize: humanReviewedBaseline.sourceFileSize,
            format: humanReviewedBaseline.format,
            cueCount: humanReviewedBaseline.cues.length,
            cueHash: humanReviewedBaseline.cueHash,
            timestampNormalizationCount:
              humanReviewedBaseline.timestampNormalizationCount,
            effectivePackagePath: relativeFrom(
              located.subtitleDirectory,
              humanReviewedBasePackagePath,
            ),
            sourceReadOnlyVerified: humanReviewedSourceReadOnlyVerified,
          },
    thresholds,
    decisions,
    findings,
    metrics: {
      machineCueCount,
      automaticDecisionCount,
      safeAutomaticMutationCount: automaticDecisionCount,
      suggestionOnlyCount,
      blockingFindingCount,
      unresolvedCount: blockingFindingCount,
      reviewItemCount,
      humanDecisionCount,
      finalCueCount: workingCues.length,
      unsafeMutationCount: unsafeAutomaticMutationCount,
      multiDecisionConflictCount: decisions.filter((decision) =>
        decision.blockers.includes("MULTI_DECISION_CONFLICT"),
      ).length,
      substringReplacementViolationCount: decisions.filter(
        (decision) =>
          decision.automaticMutationEligible &&
          decision.blockers.includes("STRICT_SUBSTRING_REPLACEMENT_BLOCKED"),
      ).length,
      ...visible,
      formatParityErrorCount: quality.formatParityErrorCount,
      automaticCueRate: hasGlobalBlockingFinding
        ? 0
        : Math.max(0, 1 - manualReviewCueIds.size / denominator),
      manualReviewCueRate: Math.min(1, manualReviewCueIds.size / denominator),
      blockingCueRate: Math.min(1, blockingCueIds.size / denominator),
      characterCorrectionRate: changedCueRate(machineCues, workingCues, "text"),
      timingCorrectionRate: changedCueRate(machineCues, workingCues, "timing"),
      terminologyCorrectionRate:
        errorTypes.filter((code) => code === "DOMAIN_TERM_ERROR").length /
        denominator,
      dialectCorrectionRate:
        errorTypes.filter((code) => code === "DIALECT_ERROR").length /
        denominator,
      hallucinationRejectionCount:
        decisions.filter(
          (decision) => decision.action === "DELETE_HALLUCINATION",
        ).length + errorTypes.filter((code) => code === "HALLUCINATION").length,
    },
    qualityGate: {
      passed: qualityPassed,
      finalIntegrityPassed: quality.finalIntegrityPassed,
      serializationRoundTripPassed: quality.serializationRoundTripPassed,
      formatSemanticParityPassed: quality.formatSemanticParityPassed,
      rollbackApplied,
      sourceReadOnlyVerified,
      blockingCodes: findings
        .filter((item) => item.severity === "blocking")
        .map((item) => item.code),
      warningCodes: findings
        .filter((item) => item.severity === "warning")
        .map((item) => item.code),
    },
    outputPaths: {
      srt: relativeFrom(located.subtitleDirectory, outputPaths.srt),
      vtt: relativeFrom(located.subtitleDirectory, outputPaths.vtt),
      ass: relativeFrom(located.subtitleDirectory, outputPaths.ass),
      subtitlePackage: relativeFrom(
        located.subtitleDirectory,
        outputPaths.subtitlePackage,
      ),
      reviewPackage:
        reviewPackagePath === null
          ? null
          : relativeFrom(located.subtitleDirectory, reviewPackagePath),
      reviewPage:
        reviewPagePath === null
          ? null
          : relativeFrom(located.subtitleDirectory, reviewPagePath),
      correctionFeedback:
        correctionFeedbackPath === null
          ? null
          : relativeFrom(located.subtitleDirectory, correctionFeedbackPath),
      subtitledVideo: null,
    },
  });
  if (options.dryRun !== true) {
    await Promise.all([
      atomicWriteFile(outputPaths.srt, quality.serialized.srt, {
        overwrite: true,
      }),
      atomicWriteFile(outputPaths.vtt, quality.serialized.vtt, {
        overwrite: true,
      }),
      atomicWriteFile(outputPaths.ass, quality.serialized.ass, {
        overwrite: true,
      }),
      atomicWriteJson(outputPaths.subtitlePackage, finalPackage, {
        overwrite: true,
      }),
      atomicWriteJson(outputPaths.report, report, { overwrite: true }),
      ...(correctionFeedbackPath === null || correctionFeedback === null
        ? []
        : [
            atomicWriteJson(correctionFeedbackPath, correctionFeedback, {
              overwrite: true,
            }),
          ]),
      ...(humanReviewedBasePackagePath === null
        ? []
        : [
            atomicWriteJson(humanReviewedBasePackagePath, projectedDraft, {
              overwrite: true,
            }),
          ]),
      ...(humanReviewedBaseline === null || humanReviewedBaseFiles === null
        ? []
        : [
            atomicWriteFile(
              humanReviewedBaseFiles.srt,
              formatSrt(humanReviewedBaseline.cues),
              { overwrite: true },
            ),
            atomicWriteFile(
              humanReviewedBaseFiles.vtt,
              formatVtt(humanReviewedBaseline.cues),
              { overwrite: true },
            ),
            atomicWriteFile(
              humanReviewedBaseFiles.ass,
              formatAss(humanReviewedBaseline.cues),
              { overwrite: true },
            ),
          ]),
    ]);
  }
  options.logger?.log("info", "Subtitle finalization completed.", {
    status: report.status,
    finalizationMethod: report.finalizationMethod,
    blockingFindingCount: report.metrics.blockingFindingCount,
    reviewItemCount: report.metrics.reviewItemCount,
  });
  return {
    dryRun: options.dryRun ?? false,
    subtitleDirectory: located.subtitleDirectory,
    report,
    subtitlePackage: finalPackage,
    outputPaths: {
      ...outputPaths,
      reviewPackage: reviewPackagePath,
      reviewPage: reviewPagePath,
      correctionFeedback: correctionFeedbackPath,
      humanReviewedBasePackage: humanReviewedBasePackagePath,
    },
  };
}

export async function prepareSubtitleReview(
  options: Omit<SubtitleFinalizationOptions, "mode" | "prepareReview">,
): Promise<SubtitleFinalizationResult> {
  return await finalizeSubtitleTask({
    ...options,
    mode: "human",
    prepareReview: true,
  });
}

export async function burnValidatedFinalSubtitle(input: {
  result: SubtitleFinalizationResult;
  mediaPath: string;
  outputDirectory: string;
  runner?: ProcessRunner;
  logger: Logger;
  ffmpegPath?: string;
  fontDirectories?: readonly string[];
  overwrite?: boolean;
}): Promise<SubtitleFinalizationResult> {
  if (
    !input.result.report.qualityGate.passed ||
    !["auto-validated", "human-validated", "mixed-validated"].includes(
      input.result.report.status,
    ) ||
    input.result.subtitlePackage.primarySubtitle?.validationStatus !==
      "validated"
  ) {
    throw new InputError(
      "Burn-in requires an auto-, human-, or mixed-validated final subtitle.",
    );
  }
  const subtitledPath = await burnSubtitleIntoVideo({
    mediaPath: input.mediaPath,
    subtitlePath: input.result.outputPaths.ass,
    outputDirectory: input.outputDirectory,
    fontDirectories: input.fontDirectories ?? [
      "/System/Library/Fonts",
      "/Library/Fonts",
      path.join(homedir(), "Library/Fonts"),
    ],
    runner: input.runner ?? new NodeProcessRunner(),
    logger: input.logger,
    ffmpegPath: input.ffmpegPath ?? "ffmpeg",
    overwrite: input.overwrite ?? false,
  });
  const relativeVideo = relativeFrom(
    input.result.subtitleDirectory,
    subtitledPath,
  );
  const subtitlePackage = projectStrictSubtitlePackage({
    rawPackage: input.result.subtitlePackage,
    cues: input.result.subtitlePackage.cues,
    validationStatus: "validated",
    files: input.result.outputPaths,
    subtitledPath: relativeVideo,
  });
  const report = subtitleFinalizationReportSchema.parse({
    ...input.result.report,
    outputHash: sha256Value({
      previousOutputHash: input.result.report.outputHash,
      subtitlePackage,
    }),
    outputPaths: {
      ...input.result.report.outputPaths,
      subtitledVideo: relativeVideo,
    },
  });
  await Promise.all([
    atomicWriteJson(input.result.outputPaths.subtitlePackage, subtitlePackage, {
      overwrite: true,
    }),
    atomicWriteJson(input.result.outputPaths.report, report, {
      overwrite: true,
    }),
  ]);
  return {
    ...input.result,
    report,
    subtitlePackage,
  };
}
