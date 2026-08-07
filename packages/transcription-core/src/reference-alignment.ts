import {
  referenceCueAlignmentArtifactSchema,
  type ReferenceAlignmentEntry,
  type ReferenceCueAlignmentArtifact,
  type ReferenceTimelineArtifact,
  type SubtitleCue,
} from "@mvl/shared";

export const REFERENCE_ALIGNMENT_VERSION = "1.0.0";

interface Interval {
  start: number;
  end: number;
}

function overlapSeconds(left: Interval, right: Interval): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function iou(left: Interval, right: Interval): number {
  const overlap = overlapSeconds(left, right);
  const union =
    Math.max(left.end, right.end) - Math.min(left.start, right.start);
  return union <= 0 ? 0 : overlap / union;
}

function unionInterval(intervals: readonly Interval[]): Interval {
  return {
    start: Math.min(...intervals.map((interval) => interval.start)),
    end: Math.max(...intervals.map((interval) => interval.end)),
  };
}

function connectedComponents(input: {
  referenceIds: readonly string[];
  generatedIds: readonly string[];
  edges: readonly { referenceId: string; generatedId: string }[];
}): { referenceIds: string[]; generatedIds: string[] }[] {
  const referenceToGenerated = new Map<string, Set<string>>();
  const generatedToReference = new Map<string, Set<string>>();
  for (const edge of input.edges) {
    referenceToGenerated.set(
      edge.referenceId,
      new Set([
        ...(referenceToGenerated.get(edge.referenceId) ?? []),
        edge.generatedId,
      ]),
    );
    generatedToReference.set(
      edge.generatedId,
      new Set([
        ...(generatedToReference.get(edge.generatedId) ?? []),
        edge.referenceId,
      ]),
    );
  }
  const seenReference = new Set<string>();
  const seenGenerated = new Set<string>();
  const components: { referenceIds: string[]; generatedIds: string[] }[] = [];
  for (const seed of input.referenceIds) {
    if (seenReference.has(seed) || !referenceToGenerated.has(seed)) continue;
    const referenceIds = new Set<string>();
    const generatedIds = new Set<string>();
    const queue: { kind: "reference" | "generated"; id: string }[] = [
      { kind: "reference", id: seed },
    ];
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      if (next.kind === "reference") {
        if (referenceIds.has(next.id)) continue;
        referenceIds.add(next.id);
        seenReference.add(next.id);
        for (const id of referenceToGenerated.get(next.id) ?? []) {
          queue.push({ kind: "generated", id });
        }
      } else {
        if (generatedIds.has(next.id)) continue;
        generatedIds.add(next.id);
        seenGenerated.add(next.id);
        for (const id of generatedToReference.get(next.id) ?? []) {
          queue.push({ kind: "reference", id });
        }
      }
    }
    components.push({
      referenceIds: [...referenceIds],
      generatedIds: [...generatedIds],
    });
  }
  for (const id of input.referenceIds) {
    if (!seenReference.has(id)) {
      components.push({ referenceIds: [id], generatedIds: [] });
    }
  }
  for (const id of input.generatedIds) {
    if (!seenGenerated.has(id)) {
      components.push({ referenceIds: [], generatedIds: [id] });
    }
  }
  return components;
}

export function alignReferenceTimeline(input: {
  timeline: ReferenceTimelineArtifact;
  generatedCues: readonly SubtitleCue[];
  generatedSubtitleSha256: string;
  speechIntervals?: readonly Interval[] | undefined;
  generatedAt?: string;
}): ReferenceCueAlignmentArtifact {
  const anchors = input.timeline.anchors.filter(
    (anchor) => anchor.expectedSpeech || anchor.expectedSinging,
  );
  const edges = anchors.flatMap((anchor) =>
    input.generatedCues.flatMap((cue) => {
      const overlap = overlapSeconds(anchor.interval, cue);
      const boundaryDistance = Math.max(
        Math.abs(anchor.interval.start - cue.start),
        Math.abs(anchor.interval.end - cue.end),
      );
      return overlap > 0 || boundaryDistance <= 0.6
        ? [{ referenceId: anchor.id, generatedId: cue.id }]
        : [];
    }),
  );
  const components = connectedComponents({
    referenceIds: anchors.map((anchor) => anchor.id),
    generatedIds: input.generatedCues.map((cue) => cue.id),
    edges,
  });
  const entries: ReferenceAlignmentEntry[] = components
    .map((component, index) => {
      const reference = anchors.filter((anchor) =>
        component.referenceIds.includes(anchor.id),
      );
      const generated = input.generatedCues.filter((cue) =>
        component.generatedIds.includes(cue.id),
      );
      const referenceInterval =
        reference.length === 0
          ? null
          : unionInterval(reference.map((anchor) => anchor.interval));
      const generatedInterval =
        generated.length === 0 ? null : unionInterval(generated);
      const interval = unionInterval([
        ...(referenceInterval === null ? [] : [referenceInterval]),
        ...(generatedInterval === null ? [] : [generatedInterval]),
      ]);
      const mapping =
        reference.length === 0
          ? ("unmatched-generated" as const)
          : generated.length === 0
            ? ("unmatched-reference" as const)
            : reference.length === 1 && generated.length === 1
              ? ("one-to-one" as const)
              : reference.length === 1
                ? ("one-to-many" as const)
                : generated.length === 1
                  ? ("many-to-one" as const)
                  : ("many-to-many" as const);
      const speechSupported =
        (input.speechIntervals ?? []).length === 0
          ? ("unavailable" as const)
          : (input.speechIntervals ?? []).some(
                (speech) => overlapSeconds(speech, interval) > 0,
              )
            ? ("supported" as const)
            : ("unsupported" as const);
      return {
        id: `reference-alignment-${String(index + 1).padStart(5, "0")}`,
        mapping,
        referenceAnchorIds: component.referenceIds,
        generatedCueIds: component.generatedIds,
        interval,
        temporalIou:
          referenceInterval === null || generatedInterval === null
            ? 0
            : iou(referenceInterval, generatedInterval),
        startErrorSeconds:
          referenceInterval === null || generatedInterval === null
            ? null
            : generatedInterval.start - referenceInterval.start,
        endErrorSeconds:
          referenceInterval === null || generatedInterval === null
            ? null
            : generatedInterval.end - referenceInterval.end,
        sceneAgreement: null,
        speechEvidence: speechSupported,
        semanticSimilarity: null,
        evidence: [
          "temporal-overlap-and-boundary-distance",
          "monotonic-bipartite-component",
          ...(speechSupported === "unavailable"
            ? ["speech-evidence-unavailable"]
            : [`speech-evidence:${speechSupported}`]),
          "cross-language-semantic-similarity-unavailable",
        ],
      };
    })
    .toSorted(
      (left, right) =>
        left.interval.start - right.interval.start ||
        left.interval.end - right.interval.end,
    )
    .map((entry, index) => ({
      ...entry,
      id: `reference-alignment-${String(index + 1).padStart(5, "0")}`,
    }));
  const mappings: ReferenceAlignmentEntry["mapping"][] = [
    "one-to-one",
    "one-to-many",
    "many-to-one",
    "many-to-many",
    "unmatched-reference",
    "unmatched-generated",
  ];
  return referenceCueAlignmentArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    referenceSha256: input.timeline.input.referenceSha256,
    generatedSubtitleSha256: input.generatedSubtitleSha256,
    algorithmVersion: REFERENCE_ALIGNMENT_VERSION,
    configuration: {
      boundaryToleranceSeconds: 0.6,
      semanticSimilarityMethod: "unavailable",
    },
    entries,
    summary: Object.fromEntries(
      mappings.map((mapping) => [
        mapping,
        entries.filter((entry) => entry.mapping === mapping).length,
      ]),
    ),
    fallback: null,
  });
}
