import { createHash } from "node:crypto";

import {
  candidateAtomizationArtifactSchema,
  type CandidateAtomizationArtifact,
  type ReferenceTimelineArtifact,
  type SubtitleCue,
} from "@mvl/shared";

export interface CandidateAtomizationResult {
  cues: SubtitleCue[];
  artifact: CandidateAtomizationArtifact;
  compoundCueIds: Set<string>;
}

export interface CandidateAtomizationOptions {
  maximumAtomicSpanSeconds?: number;
  maximumDialoguePauseSeconds?: number;
  referenceTimeline?: ReferenceTimelineArtifact | undefined;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[♪\s、。，．,.!?！？…]/gu, "");
}

function overlapSeconds(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function referenceAnchorsFor(
  cue: SubtitleCue,
  timeline: ReferenceTimelineArtifact | undefined,
) {
  if (timeline === undefined) return [];
  const ids = new Set(cue.provenance?.referenceAnchorIds ?? []);
  return timeline.anchors
    .filter(
      (anchor) =>
        (ids.size === 0 || ids.has(anchor.id)) &&
        overlapSeconds(cue, anchor.interval) > 0,
    )
    .toSorted(
      (left, right) =>
        left.interval.start - right.interval.start ||
        left.interval.end - right.interval.end,
    );
}

function semanticChunks(value: string): string[] {
  const normalizedText = value
    .replace(/^♪\s*|\s*♪$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const sentenceChunks = normalizedText
    .split(/(?<=[。！？!?…])|[\u3000]|\s{2,}/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (sentenceChunks.length > 1) return sentenceChunks;
  const phraseChunks = normalizedText
    .split(/\s+(?=[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return phraseChunks.length > 1 ? phraseChunks : [normalizedText];
}

function tokenGroups(
  cue: SubtitleCue,
  pauseSeconds: number,
): { text: string; start: number; end: number }[] {
  const tokens = (cue.timingEvidence?.tokens ?? [])
    .filter((token) => token.text.trim() !== "" && token.end > token.start)
    .toSorted((left, right) => left.start - right.start);
  const groups: (typeof tokens)[] = [];
  for (const token of tokens) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    if (
      current === undefined ||
      previous === undefined ||
      token.start - previous.end >= pauseSeconds
    ) {
      groups.push([token]);
    } else {
      current.push(token);
    }
  }
  return groups.flatMap((group) => {
    const first = group[0];
    const last = group.at(-1);
    const text = group
      .map((token) => token.text)
      .join("")
      .trim();
    return first === undefined || last === undefined || text === ""
      ? []
      : [{ text, start: first.start, end: last.end }];
  });
}

function alternativeAtoms(
  cue: SubtitleCue,
  allCues: readonly SubtitleCue[],
): { text: string; start: number; end: number; sourceId: string }[] {
  const source = normalized(cue.text);
  if (source.length < 12) return [];
  const alternatives = allCues
    .filter((candidate) => {
      if (candidate.id === cue.id) return false;
      const text = normalized(candidate.text);
      if (text.length < 4 || text.length >= source.length) return false;
      if (!source.includes(text)) return false;
      if (overlapSeconds(cue, candidate) <= 0) return false;
      return candidate.end - candidate.start <= 15;
    })
    .toSorted(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        right.text.length - left.text.length ||
        left.id.localeCompare(right.id),
    );
  const selected: SubtitleCue[] = [];
  for (const candidate of alternatives) {
    const duplicate = selected.some(
      (entry) => normalized(entry.text) === normalized(candidate.text),
    );
    const temporalConflict = selected.some(
      (entry) =>
        overlapSeconds(entry, candidate) /
          Math.max(
            0.001,
            Math.min(entry.end - entry.start, candidate.end - candidate.start),
          ) >
        0.75,
    );
    if (!duplicate && !temporalConflict) selected.push(candidate);
  }
  return selected.length < 2
    ? []
    : selected.map((candidate) => ({
        text: candidate.text,
        start: Math.max(cue.start, candidate.start),
        end: Math.min(cue.end, candidate.end),
        sourceId: candidate.id,
      }));
}

function materializeAtoms(
  cue: SubtitleCue,
  pieces: readonly { text: string; start: number; end: number }[],
): SubtitleCue[] {
  return pieces.flatMap((piece, index) => {
    if (piece.text.trim() === "" || piece.end <= piece.start) return [];
    const id = `${cue.id}::atom-${String(index + 1).padStart(2, "0")}`;
    const tokens = (cue.timingEvidence?.tokens ?? []).filter(
      (token) => token.start < piece.end && piece.start < token.end,
    );
    return [
      {
        ...cue,
        id,
        start: piece.start,
        end: piece.end,
        text: piece.text,
        provenance:
          cue.provenance === undefined
            ? undefined
            : {
                ...cue.provenance,
                sourceRequestIds: [
                  ...new Set([...cue.provenance.sourceRequestIds, cue.id]),
                ],
              },
        timingEvidence:
          cue.timingEvidence === undefined
            ? undefined
            : {
                ...cue.timingEvidence,
                speechStart: piece.start,
                speechEnd: piece.end,
                tokens,
                tokenTimestampsUsed: tokens.length > 0,
              },
        textAudit: {
          rawAsrText: cue.text,
          repairedText: piece.text,
          normalizedText: piece.text,
          winnerClusterIds: [],
          sourceWinnerCueIds: [cue.id],
          replacements: [],
          deduplicationActions: [],
          reviewRecommended: false,
          reviewReasons: [],
        },
      },
    ];
  });
}

export function atomizeHypothesisCandidates(
  inputCues: readonly SubtitleCue[],
  options: CandidateAtomizationOptions = {},
): CandidateAtomizationResult {
  const maximumAtomicSpanSeconds = options.maximumAtomicSpanSeconds ?? 15;
  const maximumDialoguePauseSeconds =
    options.maximumDialoguePauseSeconds ?? 0.35;
  const atoms: SubtitleCue[] = [];
  const entries: CandidateAtomizationArtifact["entries"] = [];
  const compoundCueIds = new Set<string>();
  for (const cue of inputCues) {
    const anchors = referenceAnchorsFor(cue, options.referenceTimeline);
    const duration = cue.end - cue.start;
    const needsAtomization =
      duration > maximumAtomicSpanSeconds ||
      anchors.length > 2 ||
      (cue.provenance?.referenceUnitIds.length ?? 0) > 2;
    if (!needsAtomization) {
      atoms.push(cue);
      entries.push({
        sourceCueId: cue.id,
        sourceInterval: { start: cue.start, end: cue.end },
        outputCueIds: [cue.id],
        decision: "preserved",
        boundarySources: ["none"],
        referenceAnchorIds: anchors.map((anchor) => anchor.id),
        reasons: ["candidate-within-atomic-utterance-limits"],
      });
      continue;
    }
    const tokens = tokenGroups(cue, maximumDialoguePauseSeconds);
    const alternatives = alternativeAtoms(cue, inputCues);
    const chunks = semanticChunks(cue.text);
    let pieces: { text: string; start: number; end: number }[] = [];
    let boundarySources: CandidateAtomizationArtifact["entries"][number]["boundarySources"] =
      [];
    if (tokens.length > 1) {
      pieces = tokens;
      boundarySources = ["token"];
    } else if (alternatives.length > 1) {
      pieces = alternatives;
      boundarySources = ["semantic", "recovery-unit"];
    } else if (anchors.length > 1 && chunks.length === anchors.length) {
      pieces = chunks.map((text, index) => ({
        text,
        start: Math.max(cue.start, anchors[index]?.interval.start ?? cue.start),
        end: Math.min(cue.end, anchors[index]?.interval.end ?? cue.end),
      }));
      boundarySources = ["reference-anchor", "semantic"];
    } else {
      const speech = (cue.timingEvidence?.speechIntervals ?? []).filter(
        (interval) => interval.end > interval.start,
      );
      if (speech.length > 1 && chunks.length === speech.length) {
        pieces = chunks.map((text, index) => ({
          text,
          start: Math.max(cue.start, speech[index]?.start ?? cue.start),
          end: Math.min(cue.end, speech[index]?.end ?? cue.end),
        }));
        boundarySources = ["speech-interval", "semantic"];
      }
    }
    const materialized = materializeAtoms(cue, pieces);
    if (materialized.length > 1) {
      atoms.push(...materialized);
      entries.push({
        sourceCueId: cue.id,
        sourceInterval: { start: cue.start, end: cue.end },
        outputCueIds: materialized.map((atom) => atom.id),
        decision: "split",
        boundarySources,
        referenceAnchorIds: anchors.map((anchor) => anchor.id),
        reasons: [
          "compound-candidate-split-with-non-proportional-evidence",
          ...boundarySources.map((source) => `boundary-source:${source}`),
        ],
      });
    } else {
      atoms.push(cue);
      compoundCueIds.add(cue.id);
      entries.push({
        sourceCueId: cue.id,
        sourceInterval: { start: cue.start, end: cue.end },
        outputCueIds: [cue.id],
        decision: "compound",
        boundarySources: ["none"],
        referenceAnchorIds: anchors.map((anchor) => anchor.id),
        reasons: [
          "compound-candidate-retained-without-character-ratio-splitting",
          "compound-candidate-must-not-bridge-atomic-clusters",
        ],
      });
    }
  }
  const artifact = candidateAtomizationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash(inputCues),
    configuration: {
      maximumAtomicSpanSeconds,
      maximumDialoguePauseSeconds,
      characterRatioSplittingAllowed: false,
    },
    sourceCandidateCount: inputCues.length,
    atomizedCandidateCount: atoms.length,
    entries,
    atoms,
    summary: {
      preservedCandidateCount: entries.filter(
        (entry) => entry.decision === "preserved",
      ).length,
      splitSourceCandidateCount: entries.filter(
        (entry) => entry.decision === "split",
      ).length,
      compoundCandidateCount: entries.filter(
        (entry) => entry.decision === "compound",
      ).length,
      characterRatioSplitCount: 0,
    },
    fallback: null,
  });
  return { cues: atoms, artifact, compoundCueIds };
}
