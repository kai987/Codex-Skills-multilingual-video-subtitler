import { describe, expect, it } from "vitest";

import { subtitlePackageSchema, type SubtitleCue } from "@mvl/shared";
import {
  buildAndApplyJointBoundaryRefinement,
  buildAndApplyPartialBoundaryRefinement,
  C6016_BOUNDARY_PADDING_SECONDS,
  type BoundarySideEvidenceInput,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-28T00:00:00.000Z";

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
): SubtitleCue {
  return {
    id,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    text,
    textSource: "audio-asr",
    speaker: null,
    confidence: 0.8,
  };
}

function packageFixture(cues: readonly SubtitleCue[]) {
  return subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "fixture.mkv",
      container: "matroska",
      durationSeconds: 30,
    },
    identity: { title: "Fixture", season: null, episode: 1, year: 2026 },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      srt: "fixture.srt",
      vtt: "fixture.vtt",
      ass: "fixture.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues,
    warnings: [],
  });
}

function evidence(
  proposedTime: number | null,
  coverage = 0.9,
  side = "boundary",
): BoundarySideEvidenceInput {
  return {
    coverage,
    proposedTime,
    trustedTokenIds: proposedTime === null ? [] : [`token:${side}`],
    evidenceIds: proposedTime === null ? [] : [`evidence:${side}`],
  };
}

describe("C6.0.1.6 partial boundary refinement", () => {
  it("applies start-only, end-only, and both while ignoring a weak opposite boundary", () => {
    const source = packageFixture([
      cue("start-only", "一", 1, 3),
      cue("end-only", "二", 4, 6),
      cue("both", "三", 7, 9),
      cue("weak", "四", 10, 12),
    ]);
    const result = buildAndApplyPartialBoundaryRefinement({
      mode: "enforce",
      package: source,
      generatedAt: GENERATED_AT,
      evidence: [
        {
          cueId: "start-only",
          startEvidence: evidence(1.2, 0.9, "s1"),
          endEvidence: evidence(2.8, 0.3, "e1"),
        },
        {
          cueId: "end-only",
          startEvidence: evidence(4.2, 0.3, "s2"),
          endEvidence: evidence(5.8, 0.9, "e2"),
        },
        {
          cueId: "both",
          startEvidence: evidence(7.2, 0.9, "s3"),
          endEvidence: evidence(8.8, 0.9, "e3"),
        },
        {
          cueId: "weak",
          startEvidence: evidence(10.2, 0.2, "s4"),
          endEvidence: evidence(11.8, 0.2, "e4"),
        },
      ],
    });
    expect(result.artifact.summary).toMatchObject({
      startOnlyEligibleCount: 1,
      startOnlyAppliedCount: 1,
      endOnlyEligibleCount: 1,
      endOnlyAppliedCount: 1,
      bothEligibleCount: 1,
      bothAppliedCount: 1,
      appliedCount: 3,
    });
    const byId = new Map(result.package.cues.map((entry) => [entry.id, entry]));
    expect(byId.get("start-only")?.start).toBeCloseTo(
      1.2 - C6016_BOUNDARY_PADDING_SECONDS,
    );
    expect(byId.get("start-only")?.end).toBe(3);
    expect(byId.get("end-only")?.start).toBe(4);
    expect(byId.get("end-only")?.end).toBeCloseTo(
      5.8 + C6016_BOUNDARY_PADDING_SECONDS,
    );
    expect(byId.get("both")?.start).toBeCloseTo(7.12);
    expect(byId.get("both")?.end).toBeCloseTo(8.88);
    expect(byId.get("weak")).toMatchObject({ start: 10, end: 12 });
    expect(result.serialized.ass).toContain("Dialogue:");
  });

  it("rejects an overlap-increasing boundary even when token coverage is strong", () => {
    const source = packageFixture([
      cue("left", "左", 1, 3),
      cue("right", "右", 3.1, 5),
    ]);
    const result = buildAndApplyPartialBoundaryRefinement({
      mode: "enforce",
      package: source,
      generatedAt: GENERATED_AT,
      evidence: [
        {
          cueId: "left",
          startEvidence: evidence(null, 0),
          endEvidence: evidence(3.3, 0.95),
        },
      ],
    });
    expect(result.artifact.summary.appliedCount).toBe(0);
    expect(result.artifact.proposals[0]?.blockers).toContain(
      "next-overlap-would-increase",
    );
  });

  it("rechecks overlap safety while applying interacting partial proposals", () => {
    const source = packageFixture([
      cue("left", "左", 1, 3),
      cue("right", "右", 3.1, 5),
    ]);
    const result = buildAndApplyPartialBoundaryRefinement({
      mode: "enforce",
      package: source,
      generatedAt: GENERATED_AT,
      evidence: [
        {
          cueId: "left",
          startEvidence: evidence(null, 0),
          endEvidence: evidence(2.98, 0.95, "left-end"),
        },
        {
          cueId: "right",
          startEvidence: evidence(3.12, 0.95, "right-start"),
          endEvidence: evidence(null, 0),
        },
      ],
    });
    expect(result.artifact.summary.proposalCount).toBe(2);
    expect(result.artifact.summary.appliedCount).toBe(1);
    expect(result.artifact.proposals[1]?.blockers).toContain(
      "sequential-overlap-nondegradation-failed",
    );
  });
});

describe("C6.0.1.6 joint boundary refinement", () => {
  const pairBase = {
    leftCueId: "left",
    rightCueId: "right",
    vadPause: null,
    speechContinuous: false,
    acousticOverlapSupported: false,
    speakerOverlapSupported: false,
    accidentalOverlapSupported: false,
    rapidTurn: false,
    evidenceIds: ["pair:evidence"],
  };

  it("resolves accidental overlap jointly using trusted token boundaries", () => {
    const source = packageFixture([
      cue("left", "左", 1, 3),
      cue("right", "右", 2.8, 5),
    ]);
    const result = buildAndApplyJointBoundaryRefinement({
      mode: "enforce",
      package: source,
      generatedAt: GENERATED_AT,
      pairs: [
        {
          ...pairBase,
          accidentalOverlapSupported: true,
          leftEndEvidence: evidence(2.7, 0.95, "left-end"),
          rightStartEvidence: evidence(2.9, 0.95, "right-start"),
        },
      ],
    });
    expect(result.artifact.pairs[0]).toMatchObject({
      overlapClass: "ACCIDENTAL_OVERLAP",
      outcome: "MOVE_BOTH",
      proposedBoundary: 2.8,
      applied: true,
    });
    expect(result.artifact.summary.accidentalOverlapResolvedCount).toBe(1);
    expect(result.package.cues[0]?.end).toBe(2.8);
    expect(result.package.cues[1]?.start).toBe(2.8);
  });

  it("preserves evidence-supported real overlap without forcing a cut", () => {
    const source = packageFixture([
      cue("left", "左", 1, 3),
      cue("right", "右", 2.8, 5),
    ]);
    const result = buildAndApplyJointBoundaryRefinement({
      mode: "enforce",
      package: source,
      generatedAt: GENERATED_AT,
      pairs: [
        {
          ...pairBase,
          accidentalOverlapSupported: true,
          acousticOverlapSupported: true,
          speakerOverlapSupported: true,
          speechContinuous: true,
          leftEndEvidence: evidence(2.7),
          rightStartEvidence: evidence(2.9),
        },
      ],
    });
    expect(result.artifact.pairs[0]).toMatchObject({
      overlapClass: "REAL_OVERLAP",
      outcome: "PRESERVE_OVERLAP",
      applied: false,
    });
    expect(result.artifact.summary.realOverlapPreservedCount).toBe(1);
    expect(result.package.cues[0]?.end).toBe(3);
    expect(result.package.cues[1]?.start).toBe(2.8);
  });

  it("uses a VAD pause for a rapid/overlap transition and fails closed on conflicting tokens", () => {
    const source = packageFixture([
      cue("left", "左", 1, 3),
      cue("right", "右", 2.8, 5),
    ]);
    const pause = buildAndApplyJointBoundaryRefinement({
      mode: "observe",
      package: source,
      generatedAt: GENERATED_AT,
      pairs: [
        {
          ...pairBase,
          accidentalOverlapSupported: true,
          vadPause: { start: 2.85, end: 2.95 },
          leftEndEvidence: evidence(null, 0),
          rightStartEvidence: evidence(null, 0),
        },
      ],
    });
    expect(pause.artifact.pairs[0]).toMatchObject({
      outcome: "MOVE_BOTH",
      accepted: true,
      applied: false,
    });
    expect(pause.artifact.pairs[0]?.proposedBoundary).toBeCloseTo(2.9);

    const conflict = buildAndApplyJointBoundaryRefinement({
      mode: "enforce",
      package: source,
      generatedAt: GENERATED_AT,
      pairs: [
        {
          ...pairBase,
          leftEndEvidence: evidence(3.1, 0.95),
          rightStartEvidence: evidence(2.7, 0.95),
        },
      ],
    });
    expect(conflict.artifact.pairs[0]).toMatchObject({
      outcome: "AMBIGUOUS",
      applied: false,
    });
  });

  it("keeps a safe non-overlap pair unchanged", () => {
    const source = packageFixture([
      cue("left", "左", 1, 2.8),
      cue("right", "右", 3, 5),
    ]);
    const result = buildAndApplyJointBoundaryRefinement({
      mode: "enforce",
      package: source,
      generatedAt: GENERATED_AT,
      pairs: [
        {
          ...pairBase,
          leftEndEvidence: evidence(2.7),
          rightStartEvidence: evidence(3.1),
        },
      ],
    });
    expect(result.artifact.pairs[0]).toMatchObject({
      overlapClass: "NO_OVERLAP",
      outcome: "KEEP_BOTH",
      applied: false,
    });
  });
});
