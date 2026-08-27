import {
  c6012PolicyVersion,
  machineOverlapEventClassificationSchema,
  type CandidateConsensusMode,
  type MachineOverlapEventClassification,
  type SubtitleCue,
} from "@mvl/shared";

import {
  candidateTextSimilarity,
  intervalIou,
  machineQualitySemanticHash,
  overlapSeconds,
} from "./evidence-correlation.js";

export function classifyOverlapEvents(input: {
  cues: readonly SubtitleCue[];
  mode: CandidateConsensusMode;
  generatedAt?: string;
}): MachineOverlapEventClassification {
  const sorted = input.cues.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const pairs = sorted.flatMap((left, leftIndex) =>
    sorted.slice(leftIndex + 1).flatMap((right) => {
      if (right.start >= left.end) return [];
      const overlap = overlapSeconds(left, right);
      if (overlap <= 0) return [];
      const similarity = candidateTextSimilarity(left.text, right.text);
      const iou = intervalIou(left, right);
      const sameEvent = similarity >= 0.92 && iou >= 0.5;
      const boundaryCollision = !sameEvent && overlap <= 0.3;
      const concurrent =
        !sameEvent &&
        !boundaryCollision &&
        left.speaker !== null &&
        right.speaker !== null &&
        left.speaker !== right.speaker;
      const classification = sameEvent
        ? ("DUPLICATE_EVENT_OVERLAP" as const)
        : boundaryCollision
          ? ("RAPID_TURN_PADDING" as const)
          : concurrent
            ? ("POSSIBLE_MULTI_SPEAKER" as const)
            : ("UNKNOWN_OVERLAP" as const);
      return [
        {
          pairId: `overlap-pair-${String(leftIndex + 1).padStart(5, "0")}-${right.id}`,
          leftCueId: left.id,
          rightCueId: right.id,
          interval: { start: right.start, end: Math.min(left.end, right.end) },
          overlapSeconds: overlap,
          classification,
          confidence: sameEvent
            ? 0.95
            : boundaryCollision
              ? 0.8
              : concurrent
                ? 0.85
                : 0.4,
          automaticallyResolved: false,
          reasons: sameEvent
            ? [
                "high-text-similarity",
                "high-temporal-iou",
                "candidate-collapse-occurs-upstream",
              ]
            : boundaryCollision
              ? [
                  "short-boundary-overlap",
                  "timing-change-requires-trusted-evidence",
                ]
              : concurrent
                ? [
                    "distinct-speaker-labels",
                    "subtitle-overlap-preserved-for-review",
                  ]
                : ["insufficient-localized-evidence", "preserved-for-review"],
        },
      ];
    }),
  );
  return machineOverlapEventClassificationSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6012PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-overlap-event-classification",
    mode: input.mode,
    pairs,
    summary: {
      overlapPairCount: pairs.length,
      duplicatePairCount: pairs.filter(
        (pair) => pair.classification === "DUPLICATE_EVENT_OVERLAP",
      ).length,
      boundaryCollisionCount: pairs.filter(
        (pair) => pair.classification === "RAPID_TURN_PADDING",
      ).length,
      concurrentSpeechCount: pairs.filter(
        (pair) => pair.classification === "POSSIBLE_MULTI_SPEAKER",
      ).length,
      unknownCount: pairs.filter(
        (pair) => pair.classification === "UNKNOWN_OVERLAP",
      ).length,
      automaticallyResolvedCount: 0,
    },
    semanticHash: machineQualitySemanticHash(pairs),
  });
}
