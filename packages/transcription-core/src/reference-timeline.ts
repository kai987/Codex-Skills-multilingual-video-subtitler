import {
  referenceTimelineArtifactSchema,
  referenceTranscriptionPlanArtifactSchema,
  type ReferenceAnchor,
  type ReferenceContentPolicy,
  type ReferenceCue,
  type ReferenceCueClassificationArtifact,
  type ReferenceTimelineArtifact,
  type ReferenceTimingMode,
  type ReferenceTranscriptionPlanArtifact,
  type ReferenceTranscriptionStrategy,
} from "@mvl/shared";

import type { AcousticSceneSegment } from "./types.js";

export const REFERENCE_TIMELINE_VERSION = "1.0.0";

function normalizedEffectText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function overlaps(
  left: { start: number; end: number },
  right: {
    start: number;
    end: number;
  },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function timelineKind(cue: ReferenceCue): ReferenceAnchor["kind"] | null {
  if (cue.kind === "dialogue") return "dialogue";
  if (cue.kind === "narration") return "narration";
  if (cue.kind === "lyrics-original") return "lyrics-original";
  if (cue.kind === "lyrics-translation") return "lyrics-translation";
  if (
    ["on-screen-text", "character-introduction", "credit"].includes(cue.kind)
  ) {
    return "visual-text";
  }
  return null;
}

function allowedByPolicy(
  kind: ReferenceAnchor["kind"],
  policy: ReferenceContentPolicy,
): boolean {
  if (policy === "all") return true;
  if (policy === "dialogue-only") {
    return kind === "dialogue" || kind === "narration";
  }
  return !["visual-text", "lyrics-translation"].includes(kind);
}

export function buildReferenceTimeline(input: {
  classification: ReferenceCueClassificationArtifact;
  timingMode: ReferenceTimingMode;
  contentPolicy: ReferenceContentPolicy;
  generatedAt?: string;
}): ReferenceTimelineArtifact {
  const cues = input.classification.cues;
  const consumed = new Set<string>();
  const anchors: ReferenceAnchor[] = [];
  const sourceCueToAnchor: Record<string, string> = {};
  let mergedEffectCueCount = 0;

  for (const cue of cues) {
    if (consumed.has(cue.id)) continue;
    const kind = timelineKind(cue);
    if (kind === null || !allowedByPolicy(kind, input.contentPolicy)) continue;
    const normalized = normalizedEffectText(cue.normalizedText);
    const chain = ["dialogue", "narration"].includes(kind)
      ? cues
          .filter(
            (candidate) =>
              !consumed.has(candidate.id) &&
              timelineKind(candidate) === kind &&
              normalizedEffectText(candidate.normalizedText) === normalized,
          )
          .toSorted(
            (left, right) =>
              left.interval.start - right.interval.start ||
              left.interval.end - right.interval.end,
          )
          .reduce<ReferenceCue[]>((selected, candidate) => {
            if (selected.length === 0) return [candidate];
            const previous = selected.at(-1);
            if (
              previous !== undefined &&
              candidate.interval.start - previous.interval.end <= 0.25
            ) {
              selected.push(candidate);
            }
            return selected;
          }, [])
      : [cue];
    const selected = chain.includes(cue) ? chain : [cue];
    for (const source of selected) consumed.add(source.id);
    if (selected.length > 1) mergedEffectCueCount += selected.length - 1;
    const anchorId = `reference-anchor-${String(anchors.length + 1).padStart(5, "0")}`;
    const anchor: ReferenceAnchor = {
      id: anchorId,
      interval: {
        start: Math.min(...selected.map((source) => source.interval.start)),
        end: Math.max(...selected.map((source) => source.interval.end)),
      },
      kind,
      sourceCueIds: selected.map((source) => source.id),
      referenceText: selected[0]?.normalizedText ?? cue.normalizedText,
      timingTrusted: selected.every(
        (source) => source.timingTrust !== "suspect",
      ),
      expectedSpeech: kind === "dialogue" || kind === "narration",
      expectedSinging: kind === "lyrics-original",
      overlappingAnchorIds: [],
      evidence: [
        `reference-kind:${kind}`,
        ...(selected.length > 1
          ? ["consecutive-identical-effect-cues-merged"]
          : []),
      ],
    };
    anchors.push(anchor);
    for (const source of selected) sourceCueToAnchor[source.id] = anchorId;
  }

  for (const anchor of anchors) {
    anchor.overlappingAnchorIds = anchors.flatMap((candidate) =>
      candidate.id !== anchor.id &&
      overlaps(candidate.interval, anchor.interval)
        ? [candidate.id]
        : [],
    );
  }

  const lyricsGroups = cues
    .filter((cue) => cue.kind === "lyrics-original")
    .map((original, index) => {
      const peers = cues.filter(
        (cue) =>
          Math.abs(cue.interval.start - original.interval.start) <= 0.03 &&
          Math.abs(cue.interval.end - original.interval.end) <= 0.03,
      );
      return {
        id: `reference-lyrics-group-${String(index + 1).padStart(4, "0")}`,
        interval: original.interval,
        originalCueIds: peers
          .filter((cue) => cue.kind === "lyrics-original")
          .map((cue) => cue.id),
        romanizationCueIds: peers
          .filter((cue) => cue.kind === "lyrics-romanization")
          .map((cue) => cue.id),
        translationCueIds: peers
          .filter((cue) => cue.kind === "lyrics-translation")
          .map((cue) => cue.id),
        selectedAnchorId: sourceCueToAnchor[original.id] ?? "",
      };
    })
    .filter((group) => group.selectedAnchorId !== "");

  return referenceTimelineArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    input: input.classification.input,
    normalizationVersion: REFERENCE_TIMELINE_VERSION,
    configuration: {
      timingMode: input.timingMode,
      contentPolicy: input.contentPolicy,
    },
    anchors,
    sourceCueToAnchor,
    lyricsGroups,
    summary: {
      rawCueCount: cues.length,
      mergedEffectCueCount,
      dialogueAnchorCount: anchors.filter(
        (anchor) => anchor.kind === "dialogue",
      ).length,
      narrationAnchorCount: anchors.filter(
        (anchor) => anchor.kind === "narration",
      ).length,
      lyricsGroupCount: lyricsGroups.length,
      lyricsOriginalCount: anchors.filter(
        (anchor) => anchor.kind === "lyrics-original",
      ).length,
      visualTextCount: cues.filter((cue) =>
        ["on-screen-text", "character-introduction", "credit"].includes(
          cue.kind,
        ),
      ).length,
      creditCount: cues.filter((cue) => cue.kind === "credit").length,
      translatorNoteCount: cues.filter((cue) => cue.kind === "translator-note")
        .length,
      unknownCount: cues.filter((cue) => cue.kind === "unknown").length,
    },
    fallback: null,
  });
}

function overlapSeconds(
  left: { start: number; end: number },
  right: {
    start: number;
    end: number;
  },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function strategyFor(input: {
  anchors: readonly ReferenceAnchor[];
  scene?: AcousticSceneSegment | undefined;
}): ReferenceTranscriptionStrategy {
  if (input.anchors.every((anchor) => anchor.kind === "lyrics-original")) {
    return "reference-original-text";
  }
  if (input.anchors.some((anchor) => anchor.expectedSinging)) {
    return "reference-lyrics";
  }
  if (input.scene?.label === "clean-dialogue") return "reference-vad";
  if (input.scene?.label === "quiet-dialogue") {
    return "reference-extra-sensitive-vad";
  }
  return "reference-vad-plus-no-vad";
}

export function buildReferenceTranscriptionPlan(input: {
  timeline: ReferenceTimelineArtifact;
  scenes?: readonly AcousticSceneSegment[] | undefined;
  maximumUnitSeconds?: number;
  dialogueUnitMaxSeconds?: number;
  narrationUnitMaxSeconds?: number;
  lyricsUnitMaxSeconds?: number;
  denseAnchorLimit?: number;
  contextSeconds?: number;
  generatedAt?: string;
}): ReferenceTranscriptionPlanArtifact {
  const maximumUnitSecondsByContent = {
    dialogue: Math.min(30, input.dialogueUnitMaxSeconds ?? 10),
    narration: Math.min(30, input.narrationUnitMaxSeconds ?? 16),
    lyrics: Math.min(30, input.lyricsUnitMaxSeconds ?? 25),
  };
  const denseAnchorLimit = Math.max(1, Math.floor(input.denseAnchorLimit ?? 4));
  const maximumUnitSeconds = Math.min(
    30,
    input.maximumUnitSeconds ??
      Math.max(
        maximumUnitSecondsByContent.dialogue,
        maximumUnitSecondsByContent.narration,
        maximumUnitSecondsByContent.lyrics,
      ),
  );
  const contextSeconds = Math.min(2, input.contextSeconds ?? 1.5);
  const eligible = input.timeline.anchors
    .filter(
      (anchor) =>
        anchor.timingTrusted &&
        (anchor.expectedSpeech || anchor.expectedSinging) &&
        anchor.kind !== "lyrics-translation",
    )
    .toSorted(
      (left, right) =>
        left.interval.start - right.interval.start ||
        left.interval.end - right.interval.end,
    );
  const groups: ReferenceAnchor[][] = [];
  const maximumFor = (anchors: readonly ReferenceAnchor[]): number => {
    const first = anchors[0];
    const last = anchors.at(-1);
    if (first === undefined || last === undefined) return maximumUnitSeconds;
    if (anchors.some((anchor) => anchor.expectedSinging)) {
      return maximumUnitSecondsByContent.lyrics;
    }
    if (anchors.every((anchor) => anchor.kind === "narration")) {
      return maximumUnitSecondsByContent.narration;
    }
    return maximumUnitSecondsByContent.dialogue;
  };
  for (const anchor of eligible) {
    const group = groups.at(-1);
    const first = group?.[0];
    const previous = group?.at(-1);
    if (
      group !== undefined &&
      first !== undefined &&
      previous !== undefined &&
      anchor.interval.start - previous.interval.end <= 0.5 &&
      anchor.interval.end - first.interval.start <=
        Math.min(maximumUnitSeconds, maximumFor([...group, anchor])) &&
      group.length < denseAnchorLimit &&
      anchor.expectedSinging === first.expectedSinging
    ) {
      group.push(anchor);
    } else {
      groups.push([anchor]);
    }
  }
  const units = groups.map((anchors, index) => {
    const start = Math.min(...anchors.map((anchor) => anchor.interval.start));
    const end = Math.max(...anchors.map((anchor) => anchor.interval.end));
    const targetInterval = { start, end };
    const scene = (input.scenes ?? [])
      .filter(
        (candidate) => overlapSeconds(candidate.interval, targetInterval) > 0,
      )
      .toSorted(
        (left, right) =>
          overlapSeconds(right.interval, targetInterval) -
          overlapSeconds(left.interval, targetInterval),
      )[0];
    const strategy = strategyFor({ anchors, scene });
    const targetDurationSeconds = end - start;
    const anchorDensity =
      anchors.length / Math.max(0.001, targetDurationSeconds);
    const unitSizingPolicy =
      strategy === "reference-lyrics" || strategy === "reference-original-text"
        ? ("singing" as const)
        : scene?.label === "noisy-dialogue"
          ? ("noisy-dialogue" as const)
          : anchors.every((anchor) => anchor.kind === "narration")
            ? ("narration" as const)
            : anchors.length >= denseAnchorLimit || anchorDensity >= 0.8
              ? ("dense-dialogue" as const)
              : ("normal-dialogue" as const);
    return {
      id: `reference-unit-${String(index + 1).padStart(4, "0")}`,
      anchorIds: anchors.map((anchor) => anchor.id),
      targetInterval,
      extractionInterval: {
        start: Math.max(0, start - contextSeconds),
        end: Math.min(
          input.timeline.input.mediaDurationSeconds,
          end + contextSeconds,
        ),
      },
      expectedCueCount: anchors.length,
      unitSizingPolicy,
      anchorCount: anchors.length,
      anchorDensity,
      targetDurationSeconds,
      contextSeconds,
      ...(scene === undefined
        ? {}
        : { sceneId: scene.id, sceneLabel: scene.label }),
      strategy,
      reasons: [
        "trusted-reference-time-anchor",
        `strategy:${strategy}`,
        `content-aware-maximum-unit-seconds:${maximumFor(anchors).toFixed(3)}`,
        `unit-sizing-policy:${unitSizingPolicy}`,
        ...(scene === undefined
          ? ["scene-unavailable"]
          : [`scene:${scene.label}`]),
      ],
      referenceTextUsedAsTargetPrompt: false as const,
    };
  });
  return referenceTranscriptionPlanArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    input: input.timeline.input,
    guidanceMode: "reference-guided",
    configuration: {
      maximumUnitSeconds,
      contextSeconds,
      maximumUnitSecondsByContent,
      denseAnchorLimit,
    },
    maximumUnitSeconds,
    contextSeconds,
    units,
    referenceTextUsedAsTargetPrompt: false,
    fallback: null,
  });
}
