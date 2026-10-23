import { createHash } from "node:crypto";

import {
  lyricsTextValidityArtifactSchema,
  type LyricsTextValidityArtifact,
  type LyricsValidationMode,
  type SubtitleCue,
} from "@mvl/shared";
import { analyzeJapaneseText } from "@mvl/subtitle-core";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[♪\s、。，．,.!?！？…]/gu, "")
    .toLocaleLowerCase("ja");
}

function lyricSequences(
  cues: readonly SubtitleCue[],
  maximumAdjacentGapSeconds: number,
): SubtitleCue[][] {
  const music = cues
    .filter(
      (cue) =>
        cue.style === "music" ||
        cue.provenance?.sourceLayer === "lyrics-asr" ||
        cue.provenance?.sourceLayer === "reference-original-language",
    )
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  const sequences: SubtitleCue[][] = [];
  for (const cue of music) {
    const current = sequences.at(-1);
    const last = current?.at(-1);
    if (
      current === undefined ||
      last === undefined ||
      cue.start - last.end > maximumAdjacentGapSeconds
    ) {
      sequences.push([cue]);
    } else {
      current.push(cue);
    }
  }
  return sequences;
}

function boilerplateHallucination(text: string): boolean {
  return (
    /ご視聴(?:いただき)?ありがとうございました/u.test(text) ||
    /チャンネル登録(?:を)?お願いします/u.test(text) ||
    /字幕(?:を)?作成(?:した|している)者/u.test(text)
  );
}

function intervalsOverlap(
  left: Pick<SubtitleCue, "start" | "end">,
  right: Pick<SubtitleCue, "start" | "end">,
): boolean {
  return (
    Math.min(left.end, right.end) - Math.max(left.start, right.start) > 0.05
  );
}

export function validateLyricsText(input: {
  cues: readonly SubtitleCue[];
  mode?: LyricsValidationMode;
  maximumAdjacentGapSeconds?: number;
}): LyricsTextValidityArtifact {
  const mode = input.mode ?? "conservative";
  const maximumAdjacentGapSeconds = input.maximumAdjacentGapSeconds ?? 0.9;
  const sequences = lyricSequences(input.cues, maximumAdjacentGapSeconds).map(
    (cues, index) => {
      const combinedNormalizedText = normalize(
        cues.map((cue) => cue.text).join(""),
      );
      const referenceOriginal = cues.filter(
        (cue) =>
          cue.textSource === "reference-original-language" ||
          cue.provenance?.sourceLayer === "reference-original-language",
      );
      const lyricsAsr = cues.filter(
        (cue) => cue.provenance?.sourceLayer === "lyrics-asr",
      );
      const referenceOriginalConflict =
        referenceOriginal.length > 0 &&
        lyricsAsr.length > 0 &&
        referenceOriginal.some((referenceCue) =>
          lyricsAsr.some(
            (asrCue) =>
              intervalsOverlap(referenceCue, asrCue) &&
              normalize(referenceCue.text) !== normalize(asrCue.text),
          ),
        );
      const independentSupportCount = Math.max(
        0,
        ...cues.map((cue) => cue.provenance?.independentSupportCount ?? 0),
        new Set(cues.flatMap((cue) => cue.provenance?.sourceProfileIds ?? []))
          .size,
      );
      const finalAnalysis = analyzeJapaneseText(cues.at(-1)?.text ?? "");
      const hallucination =
        boilerplateHallucination(combinedNormalizedText) &&
        referenceOriginal.length === 0 &&
        independentSupportCount < (mode === "conservative" ? 2 : 1);
      const incomplete =
        !hallucination &&
        referenceOriginal.length === 0 &&
        (finalAnalysis.endsMidWord ||
          (/[欲行来見聞言思知分持待会生]$/u.test(combinedNormalizedText) &&
            combinedNormalizedText.length <= 16) ||
          (finalAnalysis.likelyIncompleteClause &&
            combinedNormalizedText.length <= 12));
      const validity = hallucination
        ? ("hallucination" as const)
        : referenceOriginalConflict
          ? ("unresolved" as const)
          : incomplete
            ? ("incomplete" as const)
            : ("valid" as const);
      const reasons = [
        `independent-support:${String(independentSupportCount)}`,
        referenceOriginal.length > 0
          ? "trusted-reference-original-present"
          : "no-trusted-reference-original",
      ];
      if (hallucination) reasons.push("cross-cue-platform-boilerplate-pattern");
      if (incomplete)
        reasons.push("lyrics-sequence-ends-with-incomplete-japanese");
      if (referenceOriginalConflict) {
        reasons.push("reference-original-conflicts-with-lyrics-asr");
      }
      return {
        id: `lyrics-sequence-${String(index + 1).padStart(4, "0")}`,
        interval: {
          start: cues[0]?.start ?? 0,
          end: cues.at(-1)?.end ?? 0.001,
        },
        cueIds: cues.map((cue) => cue.id),
        combinedNormalizedText,
        validity,
        independentSupportCount,
        referenceOriginalConflict,
        reasons,
      };
    },
  );
  return lyricsTextValidityArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash(input.cues),
    configuration: { mode, maximumAdjacentGapSeconds },
    sequences,
    fallback:
      sequences.length === 0 ? "no-music-cue-sequences-to-validate" : null,
  });
}
