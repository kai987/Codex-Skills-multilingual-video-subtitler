/** Product wiring only: the four G11 business algorithms remain unchanged. */
import { createHash } from "node:crypto";
import type { SubtitleCue } from "@mvl/shared";
import {
  deduplicateTopScoreWinners,
  repairIntraCueHypothesisRepetition,
} from "@mvl/transcription-core";
import {
  buildAcousticSemanticCueSegments,
  layoutSubtitleCuesWithDiagnostics,
} from "@mvl/subtitle-core";

export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const lexical = (cues: readonly { text: string }[]) =>
  cues
    .map((c) => c.text)
    .join("")
    .normalize("NFKC")
    .replace(/[\p{P}\p{Z}\s]/gu, "");
export function assemble(
  primary: SubtitleCue[],
  profile: "primary-minimal" | "g11",
) {
  const trace: {
    stage: string;
    input: SubtitleCue[];
    output: SubtitleCue[];
    evidence: unknown;
  }[] = [];
  const record = (
    stage: string,
    input: SubtitleCue[],
    output: SubtitleCue[],
    evidence: unknown,
  ) => {
    trace.push({ stage, input, output, evidence });
    return output;
  };
  let cues = structuredClone(primary);
  if (profile === "g11") {
    const dedup = deduplicateTopScoreWinners(cues, "pre-normalization", {
      requireTemporalOverlap: true,
    });
    cues = record(
      "deduplicateTopScoreWinners",
      cues,
      dedup.cues,
      dedup.artifact,
    );
    const repeat = repairIntraCueHypothesisRepetition({
      cues,
      repetitionPolicy: "source-preserving",
    });
    cues = record(
      "repairIntraCueHypothesisRepetition",
      cues,
      repeat.cues,
      repeat.artifact,
    );
    const segmented = buildAcousticSemanticCueSegments(cues, {
      mode: "acoustic-semantic",
      japaneseTextAnalyzer: "intl-segmenter",
    });
    const bound = segmented.cues.map((c) => {
      const entries = segmented.plan.entries.filter((r) =>
        r.outputCueIds.some((id, i) => {
          const t = r.outputIntervals[i];
          return id === c.id && t?.start === c.start && t.end === c.end;
        }),
      );
      const entry = entries[0];
      if (entries.length !== 1 || !entry)
        throw Error("分句来源绑定不唯一，已保留 Primary 证据");
      return {
        ...c,
        id:
          "assembly-" +
          digest({
            sources: entry.sourceCueIds,
            start: c.start,
            end: c.end,
          }).slice(0, 24),
      };
    });
    cues = record(
      "buildAcousticSemanticCueSegments",
      cues,
      bound,
      segmented.plan,
    );
    const layout = layoutSubtitleCuesWithDiagnostics(cues, {
      segmentationMode: "presegmented",
      allowTemporalCueSplitting: false,
    });
    if (lexical(cues) !== lexical(layout.cues))
      throw Error("排版造成文本损失，已保留 Primary 草稿");
    cues = record(
      "layoutSubtitleCuesWithDiagnostics",
      cues,
      layout.cues,
      layout.timingRecords,
    );
  }
  return {
    cues,
    trace,
    normalizedSequencePreserved: lexical(primary) === lexical(cues),
  };
}
