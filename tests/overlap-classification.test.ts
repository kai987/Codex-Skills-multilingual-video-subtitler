import { describe, expect, it } from "vitest";

import type { SubtitleCue } from "@mvl/shared";
import {
  buildSubtitlePresentationResolution,
  classifyOverlapComponents,
  classifyOverlapRelationship,
  presentationResolutionHash,
  selectTrustedOverlapBoundary,
} from "@mvl/transcription-core";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
  presentationLexicalHash,
} from "@mvl/subtitle-core";

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
  options: {
    speaker?: string | null;
    requestIds?: string[];
    sceneLabel?: string | null;
    tokenStart?: number;
    tokenEnd?: number;
  } = {},
): SubtitleCue {
  const provenanceRequested =
    options.requestIds !== undefined || options.sceneLabel !== undefined;
  const timingRequested =
    options.tokenStart !== undefined && options.tokenEnd !== undefined;
  return {
    id,
    text,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    speaker: options.speaker ?? null,
    confidence: 1,
    ...(provenanceRequested
      ? {
          provenance: {
            sourceLayer: "baseline-vad" as const,
            sourceRequestIds: options.requestIds ?? [],
            sourceProfileIds: [],
            referenceAnchorIds: [],
            referenceUnitIds: [],
            recoveryUnitId: null,
            sceneId: null,
            sceneLabel: options.sceneLabel ?? null,
            independentSupportCount: new Set(options.requestIds ?? []).size,
            qualityScore: 1,
          },
        }
      : {}),
    ...(timingRequested
      ? {
          timingEvidence: {
            sourceTrusted: false,
            speechStart: options.tokenStart ?? start,
            speechEnd: options.tokenEnd ?? end,
            tokenTimestampsAvailable: true,
            tokenTimestampsUsed: true,
            tokens: [
              {
                text,
                start: options.tokenStart ?? start,
                end: options.tokenEnd ?? end,
              },
            ],
            alignmentSource: "token" as const,
            presentationTimingMethod: null,
          },
        }
      : {}),
  };
}

describe("C5.14 overlap relationship classification", () => {
  it("classifies exact duplicate overlap", () => {
    const result = classifyOverlapRelationship(
      cue("a", "同じ字幕", 1, 3),
      cue("b", "同じ字幕", 1, 3),
    );
    expect(result.relationship).toBe("exact-duplicate");
  });

  it("classifies near duplicate overlap", () => {
    const result = classifyOverlapRelationship(
      cue("a", "今日は本当にありがとうございます", 1, 3),
      cue("b", "今日は本当にありがとうございまし", 1, 3),
    );
    expect(result.relationship).toBe("near-duplicate");
  });

  it("classifies a same-request same-utterance alternative", () => {
    const result = classifyOverlapRelationship(
      cue("a", "お父ちゃんどこ行くんやろ", 1, 3, {
        requestIds: ["request"],
      }),
      cue("b", "お父ちゃんどこへ行くんやろ", 1.1, 3.1, {
        requestIds: ["request"],
      }),
    );
    expect(result.relationship).toBe("same-utterance-alternative");
  });

  it("classifies evidence-backed complementary fragments", () => {
    const result = classifyOverlapRelationship(
      cue("a", "食べ", 1, 2, {
        requestIds: ["request"],
        tokenStart: 1.1,
        tokenEnd: 1.5,
      }),
      cue("b", "ました。", 1.5, 2.5, {
        requestIds: ["request"],
        tokenStart: 1.5,
        tokenEnd: 2.4,
      }),
    );
    expect(result.relationship).toBe("complementary-fragments");
  });

  it("classifies only bounded authoritative handoff as rapid turn-taking", () => {
    const result = classifyOverlapRelationship(
      cue("a", "先に行くで", 1, 2),
      cue("b", "待って", 1.9, 3),
      {
        humanReviewedAuthority: true,
        overlapResolution: "balanced",
      },
    );
    expect(result.relationship).toBe("rapid-turn-taking");
  });

  it("uses distinct speakers as simultaneous-speech evidence for machine cues", () => {
    const result = classifyOverlapRelationship(
      cue("a", "右へ行く", 1, 3, { speaker: "A" }),
      cue("b", "左へ行く", 1.5, 2.5, { speaker: "B" }),
    );
    expect(result.relationship).toBe("true-simultaneous-speech");
  });

  it("classifies a generic repeated crowd call plus dialogue", () => {
    const result = classifyOverlapRelationship(
      cue("a", "ワッショイ!ワッショイ!", 1, 3, {
        sceneLabel: "crowd-chant",
      }),
      cue("b", "道を開けて", 1.5, 2.5, {
        sceneLabel: "crowd-chant",
      }),
    );
    expect(result.relationship).toBe("crowd-call-plus-dialogue");
  });

  it("requires trusted localized timing evidence for a boundary error", () => {
    const result = classifyOverlapRelationship(
      cue("a", "前の台詞", 1, 1.9, { tokenStart: 1.05, tokenEnd: 1.45 }),
      cue("b", "次の台詞", 1.4, 2.4, {
        tokenStart: 1.5,
        tokenEnd: 2.3,
      }),
    );
    expect(result.relationship).toBe("different-dialogue-boundary-error");
    expect(result.trustedBoundary?.boundarySource).toBe("token");
  });

  it("keeps an unsupported overlap unresolved", () => {
    const result = classifyOverlapRelationship(
      cue("a", "前の台詞", 1, 2),
      cue("b", "次の台詞", 1.4, 2.4),
      { humanReviewedAuthority: true },
    );
    expect(result.relationship).toBe("unresolved");
  });

  it("emits one decision for a three-cue connected component", () => {
    const result = classifyOverlapComponents({
      cues: [
        cue("a", "一つ目", 1, 3),
        cue("b", "二つ目", 2, 4),
        cue("c", "三つ目", 3.5, 5),
      ],
      humanReviewedAuthority: true,
    });
    expect(result.overlapPairCount).toBe(2);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.cueIds).toEqual(["a", "b", "c"]);
  });

  it("does not treat human authority alone as simultaneous-speech evidence", () => {
    const result = classifyOverlapRelationship(
      cue("a", "一つ目", 1, 3),
      cue("b", "二つ目", 1.5, 2.5),
      { humanReviewedAuthority: true, overlapResolution: "conservative" },
    );
    expect(result.relationship).toBe("unresolved");
  });

  it("has no midpoint fallback without token or speech evidence", () => {
    expect(
      selectTrustedOverlapBoundary(
        cue("a", "一つ目", 1, 3),
        cue("b", "二つ目", 2, 4),
      ),
    ).toBeNull();
  });

  it("applies an evidence-backed timing-only repair without changing text", () => {
    const source = [
      cue("a", "前の台詞", 1, 1.9, { tokenStart: 1.05, tokenEnd: 1.45 }),
      cue("b", "次の台詞", 1.4, 2.4, {
        tokenStart: 1.5,
        tokenEnd: 2.3,
      }),
    ];
    const result = classifyOverlapComponents({
      cues: source,
      applyTimingRepairs: true,
    });
    expect(result.decisions[0]).toMatchObject({
      relationship: "different-dialogue-boundary-error",
      safeAutomaticAction: "timing-only",
      blocking: false,
    });
    expect(result.cues.map((item) => item.text)).toEqual(
      source.map((item) => item.text),
    );
    expect(result.timingMutations.length).toBeGreaterThan(0);
    expect(result.cues[0]?.end).toBe(result.cues[1]?.start);
  });

  it("rejects timing repair beyond the centralized adjustment limit", () => {
    const boundary = selectTrustedOverlapBoundary(
      cue("a", "前", 1, 3, { tokenStart: 1.1, tokenEnd: 2.5 }),
      cue("b", "次", 1.2, 4, { tokenStart: 2.6, tokenEnd: 3.8 }),
      { maximumTimingAdjustmentSeconds: 0.5 },
    );
    expect(boundary).toBeNull();
  });

  it("uses explicit distinct ASS layers as legal authoritative structure", () => {
    const cues = [
      cue("a", "同時の一つ目", 1, 3),
      cue("b", "同時の二つ目", 1.5, 2.5),
    ];
    const result = classifyOverlapComponents({
      cues,
      humanReviewedAuthority: true,
      assEventEvidenceByCueId: new Map([
        ["a", { cueId: "a", layer: 0, name: null, style: "Default" }],
        ["b", { cueId: "b", layer: 1, name: null, style: "Default" }],
      ]),
    });
    expect(result.decisions[0]).toMatchObject({
      relationship: "legal-authoritative-overlap",
      blocking: false,
      safeAutomaticAction: "presentation-only",
    });
  });

  it("serializes legal overlap presentation overrides without extending v1 cues", () => {
    const cues = [
      cue("a", "同時の一つ目", 1, 3),
      cue("b", "同時の二つ目", 1.5, 2.5),
    ];
    const snapshot = structuredClone(cues);
    const resolution = buildSubtitlePresentationResolution({
      cues,
      baseCueHash: presentationResolutionHash(cues),
      humanReviewedAuthority: true,
      assEventEvidenceByCueId: new Map([
        ["a", { cueId: "a", layer: 0, name: null, style: "Default" }],
        ["b", { cueId: "b", layer: 1, name: null, style: "Default" }],
      ]),
    });
    const srt = parseSrt(
      formatSrt(resolution.cues, {
        displayTextByCueId: resolution.displayTextByCueId,
      }),
    );
    const vtt = parseVtt(
      formatVtt(resolution.cues, {
        displayTextByCueId: resolution.displayTextByCueId,
        cueSettingsByCueId: resolution.vttCueSettingsByCueId,
      }),
    );
    const assText = formatAss(resolution.cues, {
      displayTextByCueId: resolution.displayTextByCueId,
      eventOverridesByCueId: resolution.assEventOverridesByCueId,
    });
    const ass = parseAss(assText);
    expect(assText).toContain("Dialogue: 1,");
    expect(assText).toMatch(/\\an(?:2|8)/u);
    for (const parsed of [srt, vtt, ass]) {
      expect(parsed.map((item) => presentationLexicalHash(item.text))).toEqual(
        cues.map((item) => presentationLexicalHash(item.text)),
      );
    }
    expect(cues).toEqual(snapshot);
    expect(Object.keys(cues[0] ?? {})).not.toContain("assLayer");
    expect(Object.keys(cues[0] ?? {})).not.toContain("displayText");
  });
});
