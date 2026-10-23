import { describe, expect, it } from "vitest";

import {
  humanCorrectionRecordSchema,
  subtitlePackageSchema,
  type SubtitleCue,
} from "@mvl/shared";
import {
  applyC60112ReviewDecisions,
  c60112CueHash,
  materializeC60112ActiveCorrectionSnapshot,
  type C60112ReviewDecision,
} from "@mvl/video-subtitler";

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
): SubtitleCue {
  return {
    id,
    text,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    speaker: null,
    confidence: 0.5,
  };
}

function fixture() {
  return subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: { fileName: "fixture.wav", container: "wav", durationSeconds: 20 },
    identity: { title: "Fixture", season: null, episode: null, year: 2026 },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: null,
    },
    subtitleFiles: {
      srt: "./fixture.srt",
      vtt: "./fixture.vtt",
      ass: "./fixture.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues: [cue("a", "古い文", 1, 2), cue("b", "次の文", 3, 4)],
    warnings: [],
  });
}

function decision(
  input: Partial<C60112ReviewDecision> & Pick<C60112ReviewDecision, "action">,
): C60112ReviewDecision {
  return {
    decisionId: `decision-${input.action}`,
    sessionId: "session",
    itemId: `item-${input.action}`,
    sequence: 1,
    decidedAt: "2026-08-29T00:00:00.000Z",
    targetCueIds: ["a"],
    selectedCandidateId: null,
    manualText: null,
    manualStart: null,
    manualEnd: null,
    newCue: null,
    note: null,
    ...input,
  };
}

describe("C6.0.1.12 correction workflow", () => {
  it("applies candidate, manual, timing and new-cue decisions to a strict package", () => {
    const basePackage = fixture();
    const result = applyC60112ReviewDecisions({
      basePackage,
      expectedBaseCueHash: c60112CueHash(basePackage.cues),
      candidates: [
        {
          candidateId: "reazon",
          provider: "REAZON",
          text: "候補文",
          start: null,
          end: null,
        },
      ],
      decisions: [
        decision({
          action: "USE_REAZON",
          selectedCandidateId: "reazon",
          sequence: 1,
        }),
        decision({
          action: "MANUAL_EDIT",
          targetCueIds: ["b"],
          manualText: "手動文",
          sequence: 2,
        }),
        decision({
          action: "TIMING_EDIT",
          targetCueIds: ["b"],
          manualStart: 3.1,
          manualEnd: 4.2,
          sequence: 3,
        }),
        decision({
          action: "ADD_NEW_CUE",
          targetCueIds: [],
          newCue: { id: "added", text: "追加文", start: 5, end: 6 },
          sequence: 4,
        }),
      ],
    });
    expect(result.summary).toMatchObject({
      decisionCount: 4,
      mutatedDecisionCount: 4,
      rejectedDecisionCount: 0,
      addedCueCount: 1,
    });
    expect(result.package.cues.map((item) => item.text)).toEqual([
      "候補文",
      "手動文",
      "追加文",
    ]);
    expect(result.package.cues[1]).toMatchObject({ start: 3.1, end: 4.2 });
    expect(() => subtitlePackageSchema.parse(result.package)).not.toThrow();
  });

  it("records false positives without deleting a canonical cue and requires waiver notes", () => {
    const basePackage = fixture();
    const result = applyC60112ReviewDecisions({
      basePackage,
      expectedBaseCueHash: c60112CueHash(basePackage.cues),
      candidates: [],
      decisions: [
        decision({ action: "MARK_FALSE_POSITIVE", sequence: 1 }),
        decision({ action: "WAIVE_REVIEW", sequence: 2 }),
      ],
    });
    expect(result.package.cues).toHaveLength(2);
    expect(result.summary).toMatchObject({
      recordedOnlyDecisionCount: 1,
      rejectedDecisionCount: 1,
      deletedCueCount: 0,
    });
  });

  it("fails closed when the machine-draft cue hash is stale", () => {
    expect(() =>
      applyC60112ReviewDecisions({
        basePackage: fixture(),
        expectedBaseCueHash: "0".repeat(64),
        decisions: [],
        candidates: [],
      }),
    ).toThrow(/STALE_BASE_CUE_HASH/u);
  });

  it("rejects every multi-cue text or timing mutation but records non-mutating review decisions", () => {
    const basePackage = fixture();
    const result = applyC60112ReviewDecisions({
      basePackage,
      expectedBaseCueHash: c60112CueHash(basePackage.cues),
      candidates: [
        {
          candidateId: "multi-provider",
          provider: "WHISPER",
          providers: ["WHISPER", "REAZON"],
          text: "候補文",
          start: null,
          end: null,
        },
      ],
      decisions: [
        decision({
          action: "USE_REAZON",
          targetCueIds: ["a", "b"],
          selectedCandidateId: "multi-provider",
          sequence: 1,
        }),
        decision({
          action: "MANUAL_EDIT",
          targetCueIds: ["a", "b"],
          manualText: "危険な一括置換",
          sequence: 2,
        }),
        decision({
          action: "TIMING_EDIT",
          targetCueIds: ["a", "b"],
          manualStart: 1,
          manualEnd: 4,
          sequence: 3,
        }),
        decision({
          action: "KEEP_CURRENT",
          targetCueIds: ["a", "b"],
          sequence: 4,
        }),
      ],
    });

    expect(result.package.cues).toEqual(basePackage.cues);
    expect(result.applied.map((item) => [item.outcome, item.reason])).toEqual([
      ["REJECTED", "single-cue-target-required"],
      ["REJECTED", "single-cue-target-required"],
      ["REJECTED", "single-cue-target-required"],
      ["RECORDED_ONLY", "keep_current-recorded-without-canonical-mutation"],
    ]);
  });

  it("re-sorts a valid single-cue timing edit and rejects duplicate cue structure", () => {
    const basePackage = fixture();
    const result = applyC60112ReviewDecisions({
      basePackage,
      expectedBaseCueHash: c60112CueHash(basePackage.cues),
      candidates: [],
      decisions: [
        decision({
          action: "TIMING_EDIT",
          targetCueIds: ["b"],
          manualStart: 0.1,
          manualEnd: 0.8,
        }),
      ],
    });
    expect(result.package.cues.map((item) => item.id)).toEqual(["b", "a"]);

    const invalid = fixture();
    const duplicate = invalid.cues[1];
    if (duplicate === undefined) throw new Error("Fixture cue is missing.");
    invalid.cues[1] = { ...duplicate, id: "a" };
    expect(() =>
      applyC60112ReviewDecisions({
        basePackage: invalid,
        expectedBaseCueHash: c60112CueHash(invalid.cues),
        candidates: [],
        decisions: [],
      }),
    ).toThrow(/DUPLICATE_CUE_ID/u);
  });

  it.each([
    ["text then timing", "TIMING_EDIT"],
    ["timing then text", "MANUAL_EDIT"],
  ] as const)(
    "materializes the complete active snapshot after %s",
    (_label, decisionType) => {
      const basePackage = fixture();
      const record = humanCorrectionRecordSchema.parse({
        schemaVersion: "1.0.0",
        recordId: `correction-${decisionType.toLowerCase()}`,
        decisionId: `decision-${decisionType.toLowerCase()}`,
        sessionId: "session-cumulative",
        reviewItemId: "item-a",
        regionId: "region-a",
        eventIds: ["event-a"],
        cueIds: ["a"],
        sourceInterval: { start: 1, end: 2.2 },
        machineDraftHash: "a".repeat(64),
        evidenceSnapshotHash: "b".repeat(64),
        candidateSetHash: "c".repeat(64),
        decisionType,
        selectedCandidateId: null,
        beforeText: decisionType === "TIMING_EDIT" ? "手動文" : "古い文",
        afterText: "手動文",
        beforeStart: decisionType === "TIMING_EDIT" ? 1 : 1.2,
        beforeEnd: decisionType === "TIMING_EDIT" ? 2 : 2.2,
        afterStart: 1.2,
        afterEnd: 2.2,
        itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT", "TIMING_BOUNDARY_RISK"],
        priorityAtDecision: {
          tier: "HIGH",
          score: 75,
          requiredLevel: "REQUIRED",
        },
        reviewerNote: null,
        createdAt: "2026-08-29T00:00:00.000Z",
      });
      const decisions = materializeC60112ActiveCorrectionSnapshot({
        record,
        basePackage,
      }).map((item, index) => ({ ...item, sequence: index + 1 }));
      const result = applyC60112ReviewDecisions({
        basePackage,
        expectedBaseCueHash: c60112CueHash(basePackage.cues),
        candidates: [],
        decisions,
      });

      expect(decisions.map((item) => item.action)).toEqual([
        "MANUAL_EDIT",
        "TIMING_EDIT",
      ]);
      expect(result.summary.rejectedDecisionCount).toBe(0);
      expect(result.package.cues.find((item) => item.id === "a")).toMatchObject(
        {
          text: "手動文",
          start: 1.2,
          end: 2.2,
        },
      );
    },
  );
});
