import { describe, expect, it } from "vitest";

import type { SubtitleCue } from "@mvl/shared";
import {
  buildSubtitlePresentationResolution,
  presentationResolutionHash,
} from "@mvl/transcription-core";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
  presentationLexicalHash,
  resolveDisplayLayout,
  visibleDisplayCharacters,
} from "@mvl/subtitle-core";

const REAL_LONG_TEXTS = [
  "♪ 私が今本当に欲しいものなど ♪",
  "断じりは岸和田の年に一度のお祭りで",
  "その日はみんな朝から 大忙しです。",
  "なんも手使へんよって 来てしもたんやし",
  "だよ!泰蔵ちゃん あんじょう出て行ったけ?",
  "今年初めて 大屋根で大工方をやります",
  "来た お母ちゃん だんじりや来てね",
  "あ あ あ あ あ 来た!どうでしょう?",
  "ソーリャ!ソーリャ!ソーリャ!ソーリャ!",
  "ソーリャ!ソーリャ!ソーリャ!ソーリャ!",
  "ソーリャ!ソーリャ!ソーリャ!ソーリャ!",
  "あほか!女は大工当たりなんかされるか!",
  "女の子やからって 乗らせてもらえませんでした",
  "気ぃつけて 気ぃつけて 気ぃつけてー",
  "おおきに　お手をかけました おおきに",
  "あんたに うちがおんぶされんとあかんねん",
  "お父ちゃんはいつもの呉服屋に戻ります",
  "お婆ちゃんもごちそうをこさえません",
  "こんなとこ ちょろっと開けてんのは",
  "え その足か その足か お前 こら\nしばいたろか こら 待て来れ！",
  "このカエルいじめたら うちが承知せえへんで",
] as const;

function cue(
  text: string,
  index = 0,
  style?: SubtitleCue["style"],
): SubtitleCue {
  return {
    id: `cue-${index}`,
    start: 1 + index * 3,
    end: 3 + index * 3,
    language: "ja",
    languages: ["ja"],
    text,
    ...(style === undefined ? {} : { style }),
    speaker: null,
    confidence: 1,
  };
}

describe("C5.14 display-only layout", () => {
  it.each(REAL_LONG_TEXTS)(
    "resolves the real long-line fixture without canonical mutation: %s",
    (text) => {
      const source = cue(text, 0, text.includes("♪") ? "music" : undefined);
      const snapshot = structuredClone(source);
      const decision = resolveDisplayLayout(source);

      expect(decision.resolved).toBe(true);
      expect(decision.blocking).toBe(false);
      expect(decision.canonicalLexicalHash).toBe(decision.displayLexicalHash);
      expect(decision.displayText.split("\n")).toHaveLength(2);
      expect(
        decision.displayText
          .split("\n")
          .every((line) => visibleDisplayCharacters(line).length <= 16),
      ).toBe(true);
      expect(source).toEqual(snapshot);
      expect(source.start).toBe(snapshot.start);
      expect(source.end).toBe(snapshot.end);
      expect(presentationLexicalHash(decision.displayText)).toBe(
        presentationLexicalHash(text),
      );
      expect(decision.displayText).not.toMatch(
        /\n[ゃゅょぁぃぅぇぉっゎヵヶャュョァィゥェォッヮー、。，．!?！？）】」』]/u,
      );
    },
  );

  it("keeps music markers exactly once and uses a music-aware method", () => {
    const decision = resolveDisplayLayout(
      cue("♪ 私が今本当に欲しいものなど ♪", 0, "music"),
    );
    expect(decision.method).toBe("music-decoration-aware-line-break");
    expect(decision.displayText.match(/♪/gu)).toHaveLength(2);
    expect(
      decision.displayText
        .split("\n")
        .every((line) => line.replaceAll(" ", "") !== "♪"),
    ).toBe(true);
  });

  it("prefers the more balanced of multiple explicit whitespace boundaries", () => {
    const raw = "来た お母ちゃん だんじりや来てね";
    const decision = resolveDisplayLayout(cue(raw));
    expect(decision.displayText).toBe("来た お母ちゃん\nだんじりや来てね");
  });

  it("breaks a repeated chant at a complete repeated unit", () => {
    const decision = resolveDisplayLayout(
      cue("ソーリャ!ソーリャ!ソーリャ!ソーリャ!"),
    );
    expect(decision.method).toBe("chant-unit-line-break");
    expect(decision.displayText).toBe("ソーリャ!ソーリャ!\nソーリャ!ソーリャ!");
  });

  it("preserves an already legal two-line layout", () => {
    const source = cue("すでに安全な\n二行です");
    const decision = resolveDisplayLayout(source);
    expect(decision.method).toBe("preserved-existing-layout");
    expect(decision.changed).toBe(false);
    expect(decision.displayText).toBe(source.text);
  });

  it("leaves over-capacity text unresolved without a cue or timing split", () => {
    const source = cue("あ".repeat(33));
    const result = buildSubtitlePresentationResolution({
      cues: [source],
      baseCueHash: presentationResolutionHash([source]),
    });
    expect(result.cues).toEqual([source]);
    expect(result.artifact.layoutDecisions[0]).toMatchObject({
      method: "unresolved",
      blocking: true,
      resolved: false,
    });
    expect(result.artifact.summary.presentationCreatedTemporalCueCount).toBe(0);
    expect(result.artifact.summary.canonicalTimingMutationCount).toBe(0);
  });

  it("round-trips display text while retaining canonical semantics in every format", () => {
    const source = cue("女の子やからって 乗らせてもらえませんでした");
    const resolution = buildSubtitlePresentationResolution({
      cues: [source],
      baseCueHash: presentationResolutionHash([source]),
    });
    const options = { displayTextByCueId: resolution.displayTextByCueId };
    const parsed = [
      parseSrt(formatSrt(resolution.cues, options)),
      parseVtt(formatVtt(resolution.cues, options)),
      parseAss(formatAss(resolution.cues, options)),
    ];
    for (const cues of parsed) {
      expect(cues[0]?.text).toBe(resolution.displayTextByCueId.get(source.id));
      expect(presentationLexicalHash(cues[0]?.text ?? "")).toBe(
        presentationLexicalHash(source.text),
      );
      expect(cues[0]?.start).toBe(source.start);
      expect(cues[0]?.end).toBeCloseTo(source.end, 2);
    }
    expect(resolution.cues[0]?.text).toBe(source.text);
  });
});
