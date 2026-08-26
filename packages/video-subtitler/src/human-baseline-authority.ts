import {
  humanBaselineAuthoritySchema,
  type HumanBaselineAuthority,
  type SourceFingerprint,
  type SubtitleCue,
  type SubtitleFinalizationReport,
  type SubtitleReviewPackage,
} from "@mvl/shared";

import type { LoadedHumanReviewedSubtitle } from "./finalization-support.js";
import { sha256Value } from "./finalization-support.js";
import { c60SemanticHash } from "./finalization-risk-policy.js";

export function canonicalTimingHash(cues: readonly SubtitleCue[]): string {
  return sha256Value(
    cues.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end })),
  );
}

export interface VerifyHumanBaselineAuthorityInput {
  generatedAt: string;
  humanBaseline: LoadedHumanReviewedSubtitle | null;
  humanSubtitleReadOnlyVerified: boolean;
  sourceFingerprint: SourceFingerprint;
  sourceVideoReadOnlyVerified: boolean;
  legacyReport: SubtitleFinalizationReport;
  reviewPackage: SubtitleReviewPackage;
  canonicalCues: readonly SubtitleCue[];
  expectedTimingHash: string;
}

export function verifyHumanBaselineAuthority(
  input: VerifyHumanBaselineAuthorityInput,
): HumanBaselineAuthority {
  const failures: string[] = [];
  const reportAuthority = input.legacyReport.humanReviewedBaseline;
  const currentCueHash = sha256Value(input.canonicalCues);
  const currentTimingHash = canonicalTimingHash(input.canonicalCues);

  if (input.humanBaseline === null) {
    failures.push("HUMAN_BASELINE_NOT_SUPPLIED");
  }
  if (reportAuthority === null) {
    failures.push("LEGACY_HUMAN_AUTHORITY_MISSING");
  }
  if (!input.humanSubtitleReadOnlyVerified) {
    failures.push("HUMAN_SUBTITLE_READ_ONLY_VERIFICATION_FAILED");
  }
  if (!input.sourceVideoReadOnlyVerified) {
    failures.push("SOURCE_VIDEO_READ_ONLY_VERIFICATION_FAILED");
  }
  if (
    input.sourceFingerprint.sha256 !== input.reviewPackage.sourceFingerprint.sha256 ||
    input.sourceFingerprint.size !== input.reviewPackage.sourceFingerprint.size ||
    input.sourceFingerprint.fileName !==
      input.reviewPackage.sourceFingerprint.fileName
  ) {
    failures.push("SOURCE_VIDEO_FINGERPRINT_MISMATCH");
  }
  if (
    input.humanBaseline !== null &&
    reportAuthority !== null &&
    (input.humanBaseline.sourceFileSha256 !==
      reportAuthority.sourceFileSha256 ||
      input.humanBaseline.sourceFileSize !== reportAuthority.sourceFileSize ||
      input.humanBaseline.sourceFileName !== reportAuthority.sourceFileName)
  ) {
    failures.push("HUMAN_SOURCE_IDENTITY_MISMATCH");
  }
  if (
    input.humanBaseline !== null &&
    (input.humanBaseline.cueHash !== currentCueHash ||
      input.humanBaseline.cues.length !== input.canonicalCues.length)
  ) {
    failures.push("HUMAN_CANONICAL_COVERAGE_MISMATCH");
  }
  if (
    currentCueHash !== input.legacyReport.outputCueHash ||
    currentCueHash !== input.legacyReport.baseCueHash ||
    currentCueHash !== input.reviewPackage.baseCueHash
  ) {
    failures.push("CANONICAL_CUE_HASH_MISMATCH");
  }
  if (currentTimingHash !== input.expectedTimingHash) {
    failures.push("CANONICAL_TIMING_HASH_MISMATCH");
  }
  if (
    reportAuthority !== null &&
    (reportAuthority.cueHash !== currentCueHash ||
      reportAuthority.cueCount !== input.canonicalCues.length ||
      !reportAuthority.sourceReadOnlyVerified)
  ) {
    failures.push("LEGACY_AUTHORITY_LINEAGE_MISMATCH");
  }

  const coverageVerified =
    input.humanBaseline !== null &&
    input.humanBaseline.cues.length === input.canonicalCues.length &&
    input.humanBaseline.cueHash === currentCueHash;
  const lineageVerified =
    reportAuthority !== null &&
    reportAuthority.cueHash === currentCueHash &&
    input.reviewPackage.baseCueHash === currentCueHash;
  const authorityVerified = failures.length === 0;
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "human-baseline-authority" as const,
    authorityVersion: "c6.0-human-baseline-authority-v1" as const,
    generatedAt: input.generatedAt,
    authorityType:
      input.humanBaseline === null
        ? ("none" as const)
        : ("user-confirmed-human-reviewed" as const),
    sourceFileName: input.humanBaseline?.sourceFileName ?? null,
    sourceFileSha256: input.humanBaseline?.sourceFileSha256 ?? null,
    sourceFileSize: input.humanBaseline?.sourceFileSize ?? null,
    sourceCueHash: input.humanBaseline?.cueHash ?? null,
    sourceTimingHash:
      input.humanBaseline === null
        ? null
        : canonicalTimingHash(input.humanBaseline.cues),
    sourceVideoFileName: input.sourceFingerprint.fileName,
    sourceVideoSha256: input.sourceFingerprint.sha256,
    sourceVideoSize: input.sourceFingerprint.size,
    cueCount: input.humanBaseline?.cues.length ?? 0,
    textAuthority: input.humanBaseline !== null,
    timingAuthority: input.humanBaseline !== null,
    readOnlyVerified: input.humanSubtitleReadOnlyVerified,
    sourceVideoReadOnlyVerified: input.sourceVideoReadOnlyVerified,
    coverageVerified,
    lineageVerified,
    authorityVerified,
    verificationFailures: failures.toSorted(),
  };
  return humanBaselineAuthoritySchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}
