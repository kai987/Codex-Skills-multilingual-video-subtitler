import { describe, expect, it } from "vitest";

import { subtitlePackageSchema, type SubtitleCue } from "@mvl/shared";
import {
  buildAndApplySpanTextRepair,
  buildEventFinalCueLineage,
  buildEventFinalTextSpanLineage,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-28T00:00:00.000Z";

function cue(id: string, text: string, start = 1, end = 3): SubtitleCue {
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

function exactCueLineage(finalCueId = "final-1") {
  return buildEventFinalCueLineage({
    mode: "enforce",
    generatedAt: GENERATED_AT,
    events: [
      {
        eventId: "event-1",
        candidateIds: ["candidate-1"],
        canonicalCueIds: ["canonical-1"],
      },
    ],
    finalCueIds: [finalCueId],
    edges: [
      {
        sourceIds: ["canonical-1"],
        targetIds: [finalCueId],
        relationType: "FINAL_SURVIVAL",
        operationArtifact: "final-survival.json",
        reason: "persistent identity survived",
      },
    ],
    dropped: [],
  });
}

describe("C6.0.1.6 event to final text span lineage", () => {
  it("maps exact, normalized exact, and Unicode-safe code-point spans", () => {
    const exact = buildEventFinalTextSpanLineage({
      mode: "enforce",
      cueLineage: exactCueLineage(),
      finalCues: [cue("final-1", "😀おはよう。")],
      eventTextSources: [
        {
          eventId: "event-1",
          currentCandidateId: "candidate-1",
          sourceCandidates: [{ candidateId: "candidate-1", text: "おはよう" }],
        },
      ],
      generatedAt: GENERATED_AT,
    });
    expect(exact.events[0]).toMatchObject({
      spanStart: 1,
      spanEnd: 5,
      spanText: "おはよう",
      lineageStatus: "EXACT",
      indexingPolicy: "unicode-code-point-half-open",
      modifiable: true,
    });

    const normalized = buildEventFinalTextSpanLineage({
      mode: "enforce",
      cueLineage: exactCueLineage(),
      finalCues: [cue("final-1", "お はよう！")],
      eventTextSources: [
        {
          eventId: "event-1",
          currentCandidateId: "candidate-1",
          sourceCandidates: [{ candidateId: "candidate-1", text: "おはよう" }],
        },
      ],
      generatedAt: GENERATED_AT,
    });
    expect(normalized.events[0]).toMatchObject({
      spanStart: 0,
      spanEnd: 5,
      spanText: "お はよう",
      lineageStatus: "NORMALIZED_EXACT",
      alignmentMethod: "PROVENANCE_NORMALIZATION_MAP",
    });
  });

  it("uses split and merge operation history rather than fuzzy matching", () => {
    const mergeLineage = buildEventFinalCueLineage({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-a",
          candidateIds: ["candidate-a"],
          canonicalCueIds: ["canonical-a"],
        },
        {
          eventId: "event-b",
          candidateIds: ["candidate-b"],
          canonicalCueIds: ["canonical-b"],
        },
      ],
      finalCueIds: ["final-merged"],
      edges: [
        {
          sourceIds: ["canonical-a", "canonical-b"],
          targetIds: ["merged"],
          relationType: "MERGE",
          operationArtifact: "merge.json",
          reason: "explicit merge",
        },
        {
          sourceIds: ["merged"],
          targetIds: ["final-merged"],
          relationType: "FINAL_SURVIVAL",
          operationArtifact: "survival.json",
          reason: "merged identity survived",
        },
      ],
      dropped: [],
    });
    const merged = buildEventFinalTextSpanLineage({
      mode: "enforce",
      cueLineage: mergeLineage,
      finalCues: [cue("final-merged", "前半後半")],
      eventTextSources: [
        {
          eventId: "event-a",
          currentCandidateId: "candidate-a",
          sourceCandidates: [{ candidateId: "candidate-a", text: "前半" }],
        },
        {
          eventId: "event-b",
          currentCandidateId: "candidate-b",
          sourceCandidates: [{ candidateId: "candidate-b", text: "後半" }],
        },
      ],
      generatedAt: GENERATED_AT,
    });
    expect(merged.summary.mergeDerivedSpanCount).toBe(2);
    expect(merged.summary.modifiableEventCount).toBe(2);
    expect(merged.events.map((event) => event.spanText)).toEqual([
      "前半",
      "後半",
    ]);
  });

  it("fails closed for repeated or absent spans and is order deterministic", () => {
    const repeated = buildEventFinalTextSpanLineage({
      mode: "enforce",
      cueLineage: exactCueLineage(),
      finalCues: [cue("final-1", "はい、はい")],
      eventTextSources: [
        {
          eventId: "event-1",
          currentCandidateId: "candidate-1",
          sourceCandidates: [{ candidateId: "candidate-1", text: "はい" }],
        },
      ],
      generatedAt: GENERATED_AT,
    });
    expect(repeated.events[0]).toMatchObject({
      lineageStatus: "AMBIGUOUS",
      modifiable: false,
      spanStart: null,
    });
    expect(repeated.events[0]?.blockers).toContain(
      "multiple-provenance-compatible-text-spans",
    );

    const absent = buildEventFinalTextSpanLineage({
      mode: "enforce",
      cueLineage: exactCueLineage(),
      finalCues: [cue("final-1", "こんばんは")],
      eventTextSources: [
        {
          eventId: "event-1",
          currentCandidateId: "candidate-1",
          sourceCandidates: [{ candidateId: "candidate-1", text: "おはよう" }],
        },
      ],
      generatedAt: GENERATED_AT,
    });
    expect(absent.events[0]?.lineageStatus).toBe("UNRESOLVED");
    expect(absent.identityPolicy).toContain("no-fuzzy");
  });
});

describe("C6.0.1.6 span-level text repair", () => {
  function lineageFor(text: string) {
    return buildEventFinalTextSpanLineage({
      mode: "enforce",
      cueLineage: exactCueLineage(),
      finalCues: [cue("final-1", text)],
      eventTextSources: [
        {
          eventId: "event-1",
          currentCandidateId: "candidate-1",
          sourceCandidates: [{ candidateId: "candidate-1", text: "おはよう" }],
        },
      ],
      generatedAt: GENERATED_AT,
    });
  }

  it("replaces only the mapped middle span and changes ASS/SRT/VTT", () => {
    const sourcePackage = packageFixture([cue("final-1", "前おはよう後")]);
    const baselineAss = buildAndApplySpanTextRepair({
      mode: "off",
      package: sourcePackage,
      lineage: lineageFor("前おはよう後"),
      selections: [],
      generatedAt: GENERATED_AT,
    }).serialized.ass;
    const repaired = buildAndApplySpanTextRepair({
      mode: "enforce",
      package: sourcePackage,
      lineage: lineageFor("前おはよう後"),
      selections: [
        {
          eventId: "event-1",
          replacementCandidateId: "candidate-better",
          replacementText: "おはようございます",
          replacementEventId: "event-1",
          evidenceIds: ["decoder:better", "ctc:better"],
          evidenceStronger: true,
          hallucinationNonIncreasePassed: true,
          timingCompatible: true,
          crossSpeakerJoinSafe: true,
        },
      ],
      generatedAt: GENERATED_AT,
    });
    expect(repaired.package.cues[0]?.text).toBe("前おはようございます後");
    expect(repaired.artifact.summary).toMatchObject({
      proposalCount: 1,
      acceptedCount: 1,
      appliedCount: 1,
      changedFinalCueCount: 1,
    });
    expect(repaired.serialized.ass).not.toBe(baselineAss);
    expect(repaired.serialized.srt).toContain("前おはようございます後");
    expect(repaired.serialized.vtt).toContain("前おはようございます後");
  });

  it("rejects event mismatch, ambiguous spans, and unsafe punctuation", () => {
    const sourcePackage = packageFixture([cue("final-1", "おはよう。")]);
    const mismatched = buildAndApplySpanTextRepair({
      mode: "enforce",
      package: sourcePackage,
      lineage: lineageFor("おはよう。"),
      selections: [
        {
          eventId: "event-1",
          replacementCandidateId: "candidate-other",
          replacementText: "。こんばんは",
          replacementEventId: "event-other",
          evidenceIds: ["decoder:other"],
          evidenceStronger: true,
          hallucinationNonIncreasePassed: true,
          timingCompatible: true,
          crossSpeakerJoinSafe: true,
        },
      ],
      generatedAt: GENERATED_AT,
    });
    expect(mismatched.artifact.summary.appliedCount).toBe(0);
    expect(mismatched.artifact.proposals[0]?.rejectReasons).toEqual(
      expect.arrayContaining([
        "replacement-candidate-event-mismatch",
        "punctuation-boundary-unsafe",
      ]),
    );
    expect(mismatched.package.cues[0]?.text).toBe("おはよう。");
  });
});
