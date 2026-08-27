import { createHash } from "node:crypto";

import type { SubtitleCue } from "@mvl/shared";

export function stableMachineQualityJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableMachineQualityJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableMachineQualityJson(record[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function machineQualitySemanticHash(value: unknown): string {
  return createHash("sha256")
    .update(stableMachineQualityJson(value))
    .digest("hex");
}

export function normalizeCandidateText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\p{Z}\p{P}\p{S}\p{C}_]+/gu, "")
    .trim();
}

function bigrams(value: string): Set<string> {
  const characters = Array.from(value);
  if (characters.length < 2) return new Set(characters);
  return new Set(
    characters.slice(0, -1).map((character, index) => {
      const next = characters[index + 1] ?? "";
      return `${character}${next}`;
    }),
  );
}

export function candidateTextSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeCandidateText(left);
  const normalizedRight = normalizeCandidateText(right);
  if (normalizedLeft === normalizedRight) return normalizedLeft === "" ? 0 : 1;
  if (normalizedLeft === "" || normalizedRight === "") return 0;
  const leftBigrams = bigrams(normalizedLeft);
  const rightBigrams = bigrams(normalizedRight);
  const intersection = [...leftBigrams].filter((value) =>
    rightBigrams.has(value),
  ).length;
  return (2 * intersection) / (leftBigrams.size + rightBigrams.size);
}

export function overlapSeconds(
  left: Pick<SubtitleCue, "start" | "end">,
  right: Pick<SubtitleCue, "start" | "end">,
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

export function intervalIou(
  left: Pick<SubtitleCue, "start" | "end">,
  right: Pick<SubtitleCue, "start" | "end">,
): number {
  const overlap = overlapSeconds(left, right);
  if (overlap === 0) return 0;
  const union =
    Math.max(left.end, right.end) - Math.min(left.start, right.start);
  return union <= 0 ? 0 : overlap / union;
}

export function candidateCorrelationGroupIds(cue: SubtitleCue): string[] {
  const provenance = cue.provenance;
  const profiles = provenance?.sourceProfileIds.length
    ? provenance.sourceProfileIds
    : [provenance?.sourceLayer ?? "unknown-profile"];
  const recoveryScope =
    provenance?.recoveryUnitId ?? `time-${Math.floor(cue.start / 20)}`;
  return profiles.map((profile) => `profile:${profile}:scope:${recoveryScope}`);
}

export function candidateIndependentEvidenceGroupIds(
  cue: SubtitleCue,
): string[] {
  const provenance = cue.provenance;
  const profiles = provenance?.sourceProfileIds.length
    ? provenance.sourceProfileIds
    : [provenance?.sourceLayer ?? "unknown-profile"];
  return profiles.map((profile) => {
    const decoderFamily = profile.includes("no-vad")
      ? "no-vad"
      : profile.includes("vad")
        ? "vad"
        : profile;
    return `decoder-family:${decoderFamily}`;
  });
}

export function candidatesShareAcousticEvent(
  left: SubtitleCue,
  right: SubtitleCue,
): boolean {
  const similarity = candidateTextSimilarity(left.text, right.text);
  if (similarity < 0.82) return false;
  const overlap = overlapSeconds(left, right);
  if (overlap > 0) {
    const minimumDuration = Math.min(
      left.end - left.start,
      right.end - right.start,
    );
    return overlap / Math.max(0.001, minimumDuration) >= 0.35;
  }
  const gap = Math.max(left.start, right.start) - Math.min(left.end, right.end);
  return similarity >= 0.95 && gap <= 0.35;
}
