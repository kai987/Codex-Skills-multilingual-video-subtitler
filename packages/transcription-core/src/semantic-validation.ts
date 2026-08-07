import { createHash } from "node:crypto";

import {
  semanticCandidateValidationArtifactSchema,
  type ReferenceTimelineArtifact,
  type SemanticCandidateValidationArtifact,
  type SubtitleCue,
} from "@mvl/shared";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function numbers(value: string): string[] {
  return (
    value
      .normalize("NFKC")
      .match(/\d+(?:[.,]\d+)?/gu)
      ?.map((entry) => entry.replace(",", ".")) ?? []
  );
}

function japaneseNegative(value: string): boolean {
  return /(?:ない|なかった|ません|へん|ぬ|ず)/u.test(value);
}

function referenceNegative(value: string): boolean {
  return /\b(?:no|not|never|none|cannot|can't|didn't|doesn't|isn't|wasn't)\b/iu.test(
    value,
  );
}

function overlaps(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end;
}

export function validateSemanticCandidates(input: {
  cues: readonly SubtitleCue[];
  timeline?: ReferenceTimelineArtifact | undefined;
  mode?: "off" | "auto" | "on";
}): SemanticCandidateValidationArtifact {
  const mode = input.mode ?? "auto";
  if (mode === "off" || input.timeline === undefined) {
    return semanticCandidateValidationArtifactSchema.parse({
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      inputHash: hash(input.cues),
      configuration: { mode, onlineApiAllowed: false },
      method: "unavailable",
      results: [],
      fallback:
        mode === "off"
          ? "semantic-validation-disabled-by-user"
          : "no-reference-timeline-available",
    });
  }
  const results = input.cues.map((cue) => {
    const anchors =
      input.timeline?.anchors.filter((anchor) =>
        overlaps(cue, anchor.interval),
      ) ?? [];
    const referenceText = anchors
      .map((anchor) => anchor.referenceText)
      .join(" ");
    const cueNumbers = numbers(cue.text);
    const referenceNumbers = numbers(referenceText);
    const numberAgreement =
      cueNumbers.length === 0 && referenceNumbers.length === 0
        ? null
        : cueNumbers.length === referenceNumbers.length &&
          cueNumbers.every((number) => referenceNumbers.includes(number));
    const polarityConflict =
      referenceText !== "" &&
      japaneseNegative(cue.text) !== referenceNegative(referenceText);
    return {
      candidateCueId: cue.id,
      referenceAnchorIds: anchors.map((anchor) => anchor.id),
      semanticSimilarity: null,
      entityAgreement: null,
      numberAgreement,
      polarityConflict,
      relationConflict: false,
      evidence: [
        anchors.length === 0
          ? "no-temporally-overlapping-reference-anchor"
          : `temporal-reference-anchor-count:${String(anchors.length)}`,
        numberAgreement === null
          ? "number-agreement-not-applicable"
          : `number-agreement:${String(numberAgreement)}`,
        `polarity-conflict-heuristic:${String(polarityConflict)}`,
      ],
    };
  });
  return semanticCandidateValidationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash({ cues: input.cues, timeline: input.timeline }),
    configuration: { mode, onlineApiAllowed: false },
    method: "heuristic",
    results,
    fallback:
      "cross-language-model-unavailable; conservative-number-and-polarity-heuristics-only",
  });
}
