import { describe, expect, it } from "vitest";

import {
  canonicalTimingHash,
  sha256Value,
  verifyHumanBaselineAuthority,
  type LoadedHumanReviewedSubtitle,
} from "@mvl/video-subtitler";
import type {
  SourceFingerprint,
  SubtitleCue,
  SubtitleFinalizationReport,
  SubtitleReviewPackage,
} from "@mvl/shared";

const cues: SubtitleCue[] = [
  {
    id: "cue-1",
    start: 1,
    end: 2,
    language: "ja",
    languages: ["ja"],
    text: "一",
    speaker: null,
    confidence: null,
  },
  {
    id: "cue-2",
    start: 2.1,
    end: 3,
    language: "ja",
    languages: ["ja"],
    text: "二",
    speaker: null,
    confidence: null,
  },
];
const cueHash = sha256Value(cues);
const timingHash = canonicalTimingHash(cues);
const source: SourceFingerprint = {
  fileName: "video.mkv",
  size: 100,
  durationSeconds: 10,
  sha256: "b".repeat(64),
};
const human = {
  sourcePath: "/tmp/reviewed.ass",
  sourceFileName: "reviewed.ass",
  sourceFileSha256: "a".repeat(64),
  sourceFileSize: 20,
  sourceMtimeMs: 1,
  format: "ass",
  timestampNormalizationCount: 0,
  cueHash,
  cues,
  assEventEvidence: [],
  warnings: [],
} satisfies LoadedHumanReviewedSubtitle;
const report = {
  baseCueHash: cueHash,
  outputCueHash: cueHash,
  humanReviewedBaseline: {
    sourceFileName: human.sourceFileName,
    sourceFileSha256: human.sourceFileSha256,
    sourceFileSize: human.sourceFileSize,
    cueHash,
    cueCount: cues.length,
    sourceReadOnlyVerified: true,
  },
} as unknown as SubtitleFinalizationReport;
const review = {
  baseCueHash: cueHash,
  sourceFingerprint: source,
} as unknown as SubtitleReviewPackage;

function verify(patch?: {
  humanBaseline?: LoadedHumanReviewedSubtitle | null;
  sourceFingerprint?: SourceFingerprint;
  expectedTimingHash?: string;
  humanReadOnly?: boolean;
}) {
  return verifyHumanBaselineAuthority({
    generatedAt: "2026-08-27T00:00:00.000Z",
    humanBaseline:
      patch !== undefined && "humanBaseline" in patch
        ? (patch.humanBaseline ?? null)
        : human,
    humanSubtitleReadOnlyVerified: patch?.humanReadOnly ?? true,
    sourceFingerprint: patch?.sourceFingerprint ?? source,
    sourceVideoReadOnlyVerified: true,
    legacyReport: report,
    reviewPackage: review,
    canonicalCues: cues,
    expectedTimingHash: patch?.expectedTimingHash ?? timingHash,
  });
}

describe("C6.0 human authority verification", () => {
  it("cryptographically binds source, cue coverage, timing, and lineage", () => {
    expect(verify()).toMatchObject({
      authorityVerified: true,
      coverageVerified: true,
      lineageVerified: true,
      textAuthority: true,
      timingAuthority: true,
    });
  });

  it("fails for missing, changed, incomplete, or read-only-invalid authority", () => {
    expect(verify({ humanBaseline: null }).authorityVerified).toBe(false);
    expect(
      verify({
        sourceFingerprint: { ...source, sha256: "c".repeat(64) },
      }).authorityVerified,
    ).toBe(false);
    expect(
      verify({
        humanBaseline: { ...human, cues: cues.slice(0, 1) },
      }).authorityVerified,
    ).toBe(false);
    expect(
      verify({ expectedTimingHash: "d".repeat(64) }).authorityVerified,
    ).toBe(false);
    expect(verify({ humanReadOnly: false }).authorityVerified).toBe(false);
  });
});
