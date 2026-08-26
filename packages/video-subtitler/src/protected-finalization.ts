import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteFile,
  atomicWriteJson,
  c60ProtectedFinalizationReplaySummarySchema,
  InputError,
  subtitleFinalizationReportSchema,
  subtitleLocalCtcBoundaryEvidenceSchema,
  subtitleLocalSpeakerEvidenceSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleReviewDeliveryIntegritySchema,
  subtitleReviewPackageSchema,
  type C60FinalizationPolicyMode,
  type Logger,
  type SourceFingerprint,
  type SubtitleCue,
  type SubtitleFinalizationReport,
  type SubtitlePackage,
} from "@mvl/shared";
import {
  parseAss,
  parseSrt,
  parseVtt,
  presentationLexicalText,
  type ParsedCue,
} from "@mvl/subtitle-core";

import {
  loadHumanReviewedSubtitle,
  locateSubtitlePackage,
  projectStrictSubtitlePackage,
  sha256LocalFile,
  sha256Value,
  verifyHumanReviewedSubtitleReadOnly,
} from "./finalization-support.js";
import {
  collectC60ObservedSignalCounts,
  evaluateProtectedFinalizationRisk,
} from "./finalization-risk-assessment.js";
import { evaluateFinalizationEvidenceFreshness } from "./finalization-evidence-freshness.js";
import {
  C60_PROTECTED_RISK_POLICY,
  c60SemanticHash,
  c60StableHash,
} from "./finalization-risk-policy.js";
import {
  canonicalTimingHash,
  verifyHumanBaselineAuthority,
} from "./human-baseline-authority.js";

export interface ProtectedFinalizationOptions {
  taskDirectory: string;
  mode: Exclude<C60FinalizationPolicyMode, "legacy">;
  generatedAt?: string;
  humanReviewedSubtitlePath?: string;
  sourceVideoPath?: string;
  dryRun?: boolean;
  logger?: Logger;
}

export interface ProtectedFinalizationOutputPaths {
  srt: string;
  vtt: string;
  ass: string;
  subtitlePackage: string;
  report: string;
  reviewPackage: string | null;
  reviewPage: string | null;
  correctionFeedback: string | null;
  presentationResolution: string;
  canonicalAlignmentInput: string | null;
  canonicalForcedAlignment: string | null;
  forcedAlignmentRuntimeCapability: string | null;
  forcedAlignmentCacheManifest: string | null;
  canonicalPronunciation: string | null;
  sudachiRuntimeCapability: string | null;
  humanReviewedBasePackage: string | null;
}

export interface ProtectedFinalizationResult {
  dryRun: boolean;
  subtitleDirectory: string;
  report: SubtitleFinalizationReport;
  subtitlePackage: SubtitlePackage;
  outputPaths: ProtectedFinalizationOutputPaths;
}

interface LoadedProtectedInputs {
  report: SubtitleFinalizationReport;
  subtitlePackage: SubtitlePackage;
  reviewPackage: ReturnType<typeof subtitleReviewPackageSchema.parse>;
  presentation: ReturnType<typeof subtitlePresentationResolutionSchema.parse>;
  reviewDelivery: ReturnType<
    typeof subtitleReviewDeliveryIntegritySchema.parse
  >;
  speaker: ReturnType<typeof subtitleLocalSpeakerEvidenceSchema.parse>;
  ctc: ReturnType<typeof subtitleLocalCtcBoundaryEvidenceSchema.parse>;
  paths: {
    report: string;
    package: string;
    reviewPackage: string;
    presentation: string;
    reviewDelivery: string;
    srt: string;
    vtt: string;
    ass: string;
  };
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function resolveArtifact(
  subtitleDirectory: string,
  relativePath: string | null | undefined,
  fallback: string,
): string {
  return path.join(subtitleDirectory, relativePath ?? fallback);
}

async function loadProtectedInputs(taskDirectory: string): Promise<{
  located: Awaited<ReturnType<typeof locateSubtitlePackage>>;
  inputs: LoadedProtectedInputs;
}> {
  const located = await locateSubtitlePackage(taskDirectory);
  const reportPath = path.join(
    located.subtitleDirectory,
    "subtitle-finalization-report.json",
  );
  const report = subtitleFinalizationReportSchema.parse(
    await readJson(reportPath),
  );
  const packagePath = resolveArtifact(
    located.subtitleDirectory,
    report.outputPaths.subtitlePackage,
    "subtitle-package.needs-review.json",
  );
  const reviewPackagePath = resolveArtifact(
    located.subtitleDirectory,
    report.outputPaths.reviewPackage,
    "subtitle-review-package.json",
  );
  const presentationPath = resolveArtifact(
    located.subtitleDirectory,
    report.outputPaths.presentationResolution,
    "subtitle-presentation-resolution.json",
  );
  const reviewDeliveryPath = resolveArtifact(
    located.subtitleDirectory,
    report.outputPaths.reviewDeliveryIntegrity,
    "subtitle-review-delivery-integrity.json",
  );
  const speakerPath = resolveArtifact(
    located.subtitleDirectory,
    report.outputPaths.localSpeakerEvidence,
    "subtitle-local-speaker-evidence.json",
  );
  const ctcPath = resolveArtifact(
    located.subtitleDirectory,
    report.outputPaths.localCtcBoundaryEvidence,
    "subtitle-local-ctc-boundary-evidence.json",
  );
  return {
    located,
    inputs: {
      report,
      subtitlePackage: subtitlePackageSchema.parse(await readJson(packagePath)),
      reviewPackage: subtitleReviewPackageSchema.parse(
        await readJson(reviewPackagePath),
      ),
      presentation: subtitlePresentationResolutionSchema.parse(
        await readJson(presentationPath),
      ),
      reviewDelivery: subtitleReviewDeliveryIntegritySchema.parse(
        await readJson(reviewDeliveryPath),
      ),
      speaker: subtitleLocalSpeakerEvidenceSchema.parse(
        await readJson(speakerPath),
      ),
      ctc: subtitleLocalCtcBoundaryEvidenceSchema.parse(
        await readJson(ctcPath),
      ),
      paths: {
        report: reportPath,
        package: packagePath,
        reviewPackage: reviewPackagePath,
        presentation: presentationPath,
        reviewDelivery: reviewDeliveryPath,
        srt: resolveArtifact(
          located.subtitleDirectory,
          report.outputPaths.srt,
          "subtitle.best-effort.srt",
        ),
        vtt: resolveArtifact(
          located.subtitleDirectory,
          report.outputPaths.vtt,
          "subtitle.best-effort.vtt",
        ),
        ass: resolveArtifact(
          located.subtitleDirectory,
          report.outputPaths.ass,
          "subtitle.best-effort.ass",
        ),
      },
    },
  };
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

function parsedCanonicalParity(
  cues: readonly SubtitleCue[],
  parsed: readonly ParsedCue[],
  tolerance: number,
): boolean {
  return (
    cues.length === parsed.length &&
    cues.every((cue, index) => {
      const candidate = parsed[index];
      return (
        candidate !== undefined &&
        presentationLexicalText(candidate.text) ===
          presentationLexicalText(cue.text) &&
        Math.abs(candidate.start - cue.start) <= tolerance &&
        Math.abs(candidate.end - cue.end) <= tolerance
      );
    })
  );
}

function parsedPresentationParity(
  cues: readonly SubtitleCue[],
  parsed: readonly ParsedCue[],
  displayText: ReadonlyMap<string, string>,
  tolerance: number,
): boolean {
  return (
    cues.length === parsed.length &&
    cues.every((cue, index) => {
      const candidate = parsed[index];
      return (
        candidate !== undefined &&
        normalizedDisplayText(candidate.text) ===
          normalizedDisplayText(displayText.get(cue.id) ?? cue.text) &&
        Math.abs(candidate.start - cue.start) <= tolerance &&
        Math.abs(candidate.end - cue.end) <= tolerance
      );
    })
  );
}

async function validateSerializedOutputs(input: {
  cues: readonly SubtitleCue[];
  presentation: LoadedProtectedInputs["presentation"];
  srtPath: string;
  vttPath: string;
  assPath: string;
}): Promise<{
  contents: { srt: string; vtt: string; ass: string };
  serializationRoundTripPassed: boolean;
  canonicalParityPassed: boolean;
  presentationParityPassed: boolean;
}> {
  const contents = {
    srt: await readFile(input.srtPath, "utf8"),
    vtt: await readFile(input.vttPath, "utf8"),
    ass: await readFile(input.assPath, "utf8"),
  };
  try {
    const srt = parseSrt(contents.srt);
    const vtt = parseVtt(contents.vtt);
    const ass = parseAss(contents.ass);
    const displayText = new Map(
      input.presentation.layoutDecisions.map((decision) => [
        decision.cueId,
        decision.displayText,
      ]),
    );
    return {
      contents,
      serializationRoundTripPassed: true,
      canonicalParityPassed:
        parsedCanonicalParity(input.cues, srt, 0.001) &&
        parsedCanonicalParity(input.cues, vtt, 0.001) &&
        parsedCanonicalParity(input.cues, ass, 0.011),
      presentationParityPassed:
        parsedPresentationParity(input.cues, srt, displayText, 0.001) &&
        parsedPresentationParity(input.cues, vtt, displayText, 0.001) &&
        parsedPresentationParity(input.cues, ass, displayText, 0.011),
    };
  } catch {
    return {
      contents,
      serializationRoundTripPassed: false,
      canonicalParityPassed: false,
      presentationParityPassed: false,
    };
  }
}

async function currentSourceFingerprint(input: {
  sourceVideoPath?: string;
  expected: SourceFingerprint;
}): Promise<{ fingerprint: SourceFingerprint; readOnlyVerified: boolean }> {
  if (input.sourceVideoPath === undefined) {
    return { fingerprint: input.expected, readOnlyVerified: false };
  }
  const sourcePath = path.resolve(input.sourceVideoPath);
  const before = await stat(sourcePath);
  if (!before.isFile()) {
    throw new InputError(`Source video is not a regular file: ${sourcePath}`);
  }
  const sha256 = await sha256LocalFile(sourcePath);
  const after = await stat(sourcePath);
  return {
    fingerprint: {
      fileName: path.basename(sourcePath),
      size: before.size,
      durationSeconds: input.expected.durationSeconds,
      sha256,
    },
    readOnlyVerified:
      before.size === after.size && before.mtimeMs === after.mtimeMs,
  };
}

function countCanonicalTextMutations(inputs: LoadedProtectedInputs): number {
  return Math.max(
    inputs.presentation.summary.canonicalTextMutationCount,
    inputs.speaker.summary.canonicalTextMutationCount,
    inputs.ctc.summary.canonicalTextMutationCount,
    inputs.report.metrics.memoryCanonicalTextMutationCount,
    inputs.report.metrics.pronunciationProjectionCanonicalMutationCount,
  );
}

function countCanonicalTimingMutations(inputs: LoadedProtectedInputs): number {
  return Math.max(
    inputs.presentation.summary.canonicalTimingMutationCount,
    inputs.speaker.summary.timingMutationCount,
    inputs.ctc.summary.timingMutationCueCount,
    inputs.report.metrics.memoryTimingMutationCount,
    inputs.report.metrics.memoryAssistedCtcTimingMutationCount,
  );
}

function finalName(filePath: string): string {
  const name = path.basename(filePath);
  if (name.includes(".best-effort.")) {
    return name.replace(".best-effort.", ".final.");
  }
  return name.replace(/\.(srt|vtt|ass)$/u, ".final.$1");
}

function resultOutputPaths(input: {
  subtitleDirectory: string;
  report: SubtitleFinalizationReport;
  packagePath: string;
}): ProtectedFinalizationOutputPaths {
  const output = input.report.outputPaths;
  const absolute = (value: string | null): string | null =>
    value === null ? null : path.join(input.subtitleDirectory, value);
  return {
    srt: path.join(input.subtitleDirectory, output.srt),
    vtt: path.join(input.subtitleDirectory, output.vtt),
    ass: path.join(input.subtitleDirectory, output.ass),
    subtitlePackage: input.packagePath,
    report: path.join(
      input.subtitleDirectory,
      "subtitle-finalization-report.json",
    ),
    reviewPackage: absolute(output.reviewPackage),
    reviewPage: absolute(output.reviewPage),
    correctionFeedback: absolute(output.correctionFeedback),
    presentationResolution:
      absolute(output.presentationResolution) ??
      path.join(
        input.subtitleDirectory,
        "subtitle-presentation-resolution.json",
      ),
    canonicalAlignmentInput: absolute(output.canonicalAlignmentInput),
    canonicalForcedAlignment: absolute(output.canonicalForcedAlignment),
    forcedAlignmentRuntimeCapability: absolute(
      output.forcedAlignmentRuntimeCapability,
    ),
    forcedAlignmentCacheManifest: absolute(output.forcedAlignmentCacheManifest),
    canonicalPronunciation: absolute(output.canonicalPronunciation),
    sudachiRuntimeCapability: absolute(output.sudachiRuntimeCapability),
    humanReviewedBasePackage:
      input.report.humanReviewedBaseline === null
        ? null
        : path.join(
            input.subtitleDirectory,
            input.report.humanReviewedBaseline.effectivePackagePath,
          ),
  };
}

function protectedSummaryHtml(input: {
  mode: Exclude<C60FinalizationPolicyMode, "legacy">;
  authorityVerified: boolean;
  protectedOutcome: string;
  effectiveStatus: string;
  effectiveMethod: string;
  legacyBlockers: number;
  reviewItems: number;
  mandatory: number;
  advisory: number;
  preservationSupported: number;
  speakerResolved: number;
  overlapResolved: number;
}): string {
  const rows = [
    ["Policy mode", input.mode],
    ["Human authority verified", String(input.authorityVerified)],
    ["Protected outcome", input.protectedOutcome],
    ["Effective status", input.effectiveStatus],
    ["Finalization method", input.effectiveMethod],
    ["Legacy blocking findings retained", String(input.legacyBlockers)],
    ["Review artifacts retained", String(input.reviewItems)],
    ["Effective mandatory review", String(input.mandatory)],
    ["Effective advisory review", String(input.advisory)],
    ["Preservation-supported review", String(input.preservationSupported)],
    ["Speaker relationship resolved components", String(input.speakerResolved)],
    ["Subtitle overlap resolved components", String(input.overlapResolved)],
  ];
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>C6.0 protected finalization</title><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#17202a}table{border-collapse:collapse;width:100%}th,td{padding:10px;border:1px solid #ccd1d1;text-align:left}th{width:42%;background:#f4f6f7}.notice{padding:14px;background:#fff8e1;border-left:4px solid #d4a017}</style></head><body><h1>C6.0 protected finalization</h1><p class="notice">Machine-only blind acceptance is not authorized. Existing Review artifacts remain available even when a verified human baseline is safely preserved.</p><table><tbody>${rows.map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`).join("")}</tbody></table></body></html>\n`;
}

export async function finalizeProtectedExistingTask(
  options: ProtectedFinalizationOptions,
): Promise<ProtectedFinalizationResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const { located, inputs } = await loadProtectedInputs(options.taskDirectory);
  const canonicalCueHash = sha256Value(inputs.subtitlePackage.cues);
  const timingHash = canonicalTimingHash(inputs.subtitlePackage.cues);
  const serialized = await validateSerializedOutputs({
    cues: inputs.subtitlePackage.cues,
    presentation: inputs.presentation,
    srtPath: inputs.paths.srt,
    vttPath: inputs.paths.vtt,
    assPath: inputs.paths.ass,
  });
  const humanBaseline =
    options.humanReviewedSubtitlePath === undefined
      ? null
      : await loadHumanReviewedSubtitle(options.humanReviewedSubtitlePath);
  const humanReadOnly =
    humanBaseline !== null &&
    (await verifyHumanReviewedSubtitleReadOnly(humanBaseline));
  const source = await currentSourceFingerprint({
    ...(options.sourceVideoPath === undefined
      ? {}
      : { sourceVideoPath: options.sourceVideoPath }),
    expected: inputs.reviewPackage.sourceFingerprint,
  });
  const authority = verifyHumanBaselineAuthority({
    generatedAt,
    humanBaseline,
    humanSubtitleReadOnlyVerified: humanReadOnly,
    sourceFingerprint: source.fingerprint,
    sourceVideoReadOnlyVerified: source.readOnlyVerified,
    legacyReport: inputs.report,
    reviewPackage: inputs.reviewPackage,
    canonicalCues: inputs.subtitlePackage.cues,
    expectedTimingHash: inputs.ctc.baseTimingHash,
  });
  const freshness = await evaluateFinalizationEvidenceFreshness({
    generatedAt,
    taskRoot: located.taskDirectory,
    subtitleDirectory: located.subtitleDirectory,
    policyHash: C60_PROTECTED_RISK_POLICY.policyHash,
    baseCueHash: canonicalCueHash,
    baseTimingHash: timingHash,
    reviewPackage: inputs.reviewPackage,
  });
  const canonicalTextMutationCount = countCanonicalTextMutations(inputs);
  const canonicalTimingMutationCount = countCanonicalTimingMutations(inputs);
  const presentationIntegrityPassed =
    inputs.presentation.baseCueHash === canonicalCueHash &&
    inputs.presentation.canonicalCueHash === canonicalCueHash &&
    inputs.presentation.summary.canonicalTextMutationCount === 0 &&
    inputs.presentation.summary.canonicalTimingMutationCount === 0 &&
    inputs.report.qualityGate.presentationParityPassed;
  const reviewDeliveryIntegrityPassed =
    inputs.reviewDelivery.baseCueHash === canonicalCueHash &&
    inputs.reviewDelivery.baseTimingHash === timingHash &&
    inputs.reviewDelivery.summary.reviewDeliveryIntegrityPassed &&
    inputs.reviewDelivery.summary.failedItemCount === 0 &&
    inputs.reviewDelivery.summary.reviewAudioPlayableCount ===
      inputs.reviewDelivery.summary.itemCount;
  const additionalSignals = [
    ...(!serialized.serializationRoundTripPassed
      ? ["SERIALIZATION_ROUND_TRIP_FAILED"]
      : []),
    ...(!serialized.canonicalParityPassed
      ? ["FORMAT_CANONICAL_PARITY_FAILED"]
      : []),
    ...(!serialized.presentationParityPassed || !presentationIntegrityPassed
      ? ["FORMAT_PRESENTATION_PARITY_FAILED"]
      : []),
    ...(!reviewDeliveryIntegrityPassed
      ? ["REVIEW_DELIVERY_INTEGRITY_FAILED"]
      : []),
    ...(!source.readOnlyVerified ? ["SOURCE_MEDIA_CHANGED"] : []),
    ...(!authority.authorityVerified
      ? ["HUMAN_BASELINE_AUTHORITY_FAILED"]
      : []),
    ...(canonicalTextMutationCount > 0 || canonicalTimingMutationCount > 0
      ? ["UNSAFE_AUTOMATIC_MUTATION"]
      : []),
  ];
  const observed = await collectC60ObservedSignalCounts(
    located.subtitleDirectory,
  );
  const { riskAssessment, reviewDisposition } =
    evaluateProtectedFinalizationRisk({
      generatedAt,
      mode: options.mode,
      taskName: path.basename(located.subtitleDirectory),
      sourceFileName: source.fingerprint.fileName,
      sourceFileSha256: source.fingerprint.sha256,
      sourceFileSize: source.fingerprint.size,
      canonicalCueHashBefore: canonicalCueHash,
      canonicalCueHashAfter: canonicalCueHash,
      canonicalTimingHashBefore: timingHash,
      canonicalTimingHashAfter: timingHash,
      presentationHash: inputs.presentation.presentationCueHash,
      legacyReport: inputs.report,
      reviewPackage: inputs.reviewPackage,
      authority,
      freshness,
      observedSignalCounts: observed,
      additionalSignals,
      speakerArtifact: inputs.speaker,
      ctcArtifact: inputs.ctc,
      canonicalTextMutationCount,
      canonicalTimingMutationCount,
      serializationRoundTripPassed: serialized.serializationRoundTripPassed,
      formatSemanticParityPassed:
        serialized.canonicalParityPassed && serialized.presentationParityPassed,
      presentationIntegrityPassed,
      reviewDeliveryIntegrityPassed,
    });
  const enforceApplied =
    options.mode === "protected-enforce" &&
    riskAssessment.baselinePreservation.applied &&
    ["FINAL_SAFE", "FINAL_SAFE_WITH_ADVISORIES"].includes(
      riskAssessment.protectedOutcome,
    );
  const finalPaths = {
    srt: path.join(located.subtitleDirectory, finalName(inputs.paths.srt)),
    vtt: path.join(located.subtitleDirectory, finalName(inputs.paths.vtt)),
    ass: path.join(located.subtitleDirectory, finalName(inputs.paths.ass)),
    package: path.join(
      located.subtitleDirectory,
      "subtitle-package.final.json",
    ),
  };
  const finalPackage = enforceApplied
    ? projectStrictSubtitlePackage({
        rawPackage: inputs.subtitlePackage,
        cues: inputs.subtitlePackage.cues,
        validationStatus: "validated",
        files: finalPaths,
      })
    : inputs.subtitlePackage;
  const effectiveReport = enforceApplied
    ? subtitleFinalizationReportSchema.parse({
        ...inputs.report,
        finalizationVersion: "C6.0-protected-human-preservation-v1",
        generatedAt,
        status: "human-validated",
        finalizationMethod: "human",
        outputCueHash: canonicalCueHash,
        outputHash: c60StableHash({
          previousOutputHash: inputs.report.outputHash,
          finalPackage,
          srt: serialized.contents.srt,
          vtt: serialized.contents.vtt,
          ass: serialized.contents.ass,
          riskAssessmentHash: riskAssessment.semanticHash,
        }),
        qualityGate: {
          ...inputs.report.qualityGate,
          passed: true,
          finalIntegrityPassed: true,
          serializationRoundTripPassed: serialized.serializationRoundTripPassed,
          formatSemanticParityPassed:
            serialized.canonicalParityPassed &&
            serialized.presentationParityPassed,
          canonicalParityPassed: serialized.canonicalParityPassed,
          presentationParityPassed:
            serialized.presentationParityPassed && presentationIntegrityPassed,
          reviewDeliveryIntegrityPassed,
          sourceReadOnlyVerified: source.readOnlyVerified,
          blockingCodes: [],
          warningCodes: [
            ...new Set([
              ...inputs.report.qualityGate.warningCodes,
              "C6_0_VERIFIED_HUMAN_BASELINE_PRESERVED",
              ...(reviewDisposition.summary.effectiveAdvisoryReviewCount > 0
                ? ["C6_0_REVIEW_ADVISORIES_RETAINED"]
                : []),
            ]),
          ],
        },
        outputPaths: {
          ...inputs.report.outputPaths,
          srt: path.basename(finalPaths.srt),
          vtt: path.basename(finalPaths.vtt),
          ass: path.basename(finalPaths.ass),
          subtitlePackage: path.basename(finalPaths.package),
        },
      })
    : inputs.report;
  const sidecars = {
    policy: path.join(
      located.subtitleDirectory,
      "c6-0-protected-risk-policy.json",
    ),
    authority: path.join(
      located.subtitleDirectory,
      "human-baseline-authority.json",
    ),
    freshness: path.join(
      located.subtitleDirectory,
      "subtitle-finalization-evidence-freshness.json",
    ),
    preservation: path.join(
      located.subtitleDirectory,
      "subtitle-baseline-preservation-assessment.json",
    ),
    risk: path.join(
      located.subtitleDirectory,
      "subtitle-finalization-risk-assessment.json",
    ),
    review: path.join(
      located.subtitleDirectory,
      "subtitle-review-effective-disposition.json",
    ),
    replay: path.join(
      located.taskDirectory,
      "c6-0-protected-finalization-replay-summary.json",
    ),
    html: path.join(
      located.subtitleDirectory,
      "c6-0-protected-finalization-summary.html",
    ),
  };
  const outputFiles = [
    ...Object.values(sidecars).map((filePath) =>
      path.relative(located.taskDirectory, filePath).split(path.sep).join("/"),
    ),
    ...(enforceApplied
      ? [
          finalPaths.srt,
          finalPaths.vtt,
          finalPaths.ass,
          finalPaths.package,
        ].map((filePath) =>
          path
            .relative(located.taskDirectory, filePath)
            .split(path.sep)
            .join("/"),
        )
      : []),
  ].toSorted();
  const replayBase = {
    schemaVersion: "1.0.0" as const,
    artifactType: "c6-0-protected-finalization-replay-summary" as const,
    runId: `c6-run-${c60StableHash({ generatedAt, mode: options.mode }).slice(0, 20)}`,
    generatedAt,
    mode: options.mode,
    sourceTask: path.basename(located.subtitleDirectory),
    authorityType: authority.authorityType,
    authorityVerified: authority.authorityVerified,
    riskPolicyHash: C60_PROTECTED_RISK_POLICY.policyHash,
    freshnessHash: freshness.semanticHash,
    rootRiskHash: c60StableHash(riskAssessment.rootRisks),
    riskAssessmentHash: riskAssessment.semanticHash,
    reviewDispositionHash: reviewDisposition.semanticHash,
    legacyStatus: inputs.report.status,
    protectedOutcome: riskAssessment.protectedOutcome,
    effectiveStatus: effectiveReport.status,
    effectiveFinalizationMethod: effectiveReport.finalizationMethod,
    legacyBlockingFindingCount: inputs.report.metrics.blockingFindingCount,
    effectiveFinalBlockerCount:
      riskAssessment.summary.effectiveProtectedFinalBlockerCount,
    advisoryCount: riskAssessment.summary.effectiveAdvisoryReviewCount,
    canonicalCueHashBefore: canonicalCueHash,
    canonicalCueHashAfter: sha256Value(finalPackage.cues),
    canonicalTimingHashBefore: timingHash,
    canonicalTimingHashAfter: canonicalTimingHash(finalPackage.cues),
    presentationHash: inputs.presentation.presentationCueHash,
    outputFiles,
    strictFinalPackageExists: enforceApplied,
    reviewDeliveryIntegrityPassed,
    reviewAudioPlayableCount:
      inputs.reviewDelivery.summary.reviewAudioPlayableCount,
    reviewAudioItemCount: inputs.reviewDelivery.summary.itemCount,
    modelExecutionCounts: {
      whisper: 0 as const,
      mfa: 0 as const,
      speaker: 0 as const,
      ctc: 0 as const,
      separation: 0 as const,
      openai: 0 as const,
      onlineSubtitleSearch: 0 as const,
      wholeMediaAsr: 0 as const,
      modelInferenceCount: 0 as const,
      modelLoadCount: 0 as const,
    },
    networkUsed: false as const,
  };
  const replay = c60ProtectedFinalizationReplaySummarySchema.parse({
    ...replayBase,
    semanticHash: c60SemanticHash(replayBase),
  });
  const html = protectedSummaryHtml({
    mode: options.mode,
    authorityVerified: authority.authorityVerified,
    protectedOutcome: riskAssessment.protectedOutcome,
    effectiveStatus: effectiveReport.status,
    effectiveMethod: effectiveReport.finalizationMethod,
    legacyBlockers: inputs.report.metrics.blockingFindingCount,
    reviewItems: inputs.reviewPackage.items.length,
    mandatory: reviewDisposition.summary.effectiveMandatoryReviewCount,
    advisory: reviewDisposition.summary.effectiveAdvisoryReviewCount,
    preservationSupported:
      reviewDisposition.summary.preservationSupportedReviewCount,
    speakerResolved:
      riskAssessment.summary.speakerRelationshipResolvedComponentCount,
    overlapResolved:
      riskAssessment.summary.subtitleOverlapResolvedComponentCount,
  });
  if (options.dryRun !== true) {
    await Promise.all([
      atomicWriteJson(sidecars.policy, C60_PROTECTED_RISK_POLICY, {
        overwrite: true,
      }),
      atomicWriteJson(sidecars.authority, authority, { overwrite: true }),
      atomicWriteJson(sidecars.freshness, freshness, { overwrite: true }),
      atomicWriteJson(
        sidecars.preservation,
        riskAssessment.baselinePreservation,
        {
          overwrite: true,
        },
      ),
      atomicWriteJson(sidecars.risk, riskAssessment, { overwrite: true }),
      atomicWriteJson(sidecars.review, reviewDisposition, { overwrite: true }),
      atomicWriteJson(sidecars.replay, replay, { overwrite: true }),
      atomicWriteFile(sidecars.html, html, { overwrite: true }),
      ...(enforceApplied
        ? [
            atomicWriteFile(finalPaths.srt, serialized.contents.srt, {
              overwrite: true,
            }),
            atomicWriteFile(finalPaths.vtt, serialized.contents.vtt, {
              overwrite: true,
            }),
            atomicWriteFile(finalPaths.ass, serialized.contents.ass, {
              overwrite: true,
            }),
            atomicWriteJson(finalPaths.package, finalPackage, {
              overwrite: true,
            }),
            atomicWriteJson(inputs.paths.report, effectiveReport, {
              overwrite: true,
            }),
          ]
        : []),
    ]);
  }
  options.logger?.log("info", "C6.0 protected finalization evaluated.", {
    mode: options.mode,
    authorityVerified: authority.authorityVerified,
    protectedOutcome: riskAssessment.protectedOutcome,
    finalStatus: effectiveReport.status,
    finalizationMethod: effectiveReport.finalizationMethod,
    legacyBlockingFindingCount: inputs.report.metrics.blockingFindingCount,
    effectiveMandatoryReviewCount:
      reviewDisposition.summary.effectiveMandatoryReviewCount,
    strictFinalPackageExists: enforceApplied,
  });
  const effectivePackagePath = enforceApplied
    ? finalPaths.package
    : inputs.paths.package;
  return {
    dryRun: options.dryRun ?? false,
    subtitleDirectory: located.subtitleDirectory,
    report: effectiveReport,
    subtitlePackage: finalPackage,
    outputPaths: resultOutputPaths({
      subtitleDirectory: located.subtitleDirectory,
      report: effectiveReport,
      packagePath: effectivePackagePath,
    }),
  };
}
