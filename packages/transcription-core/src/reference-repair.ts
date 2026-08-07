import {
  referenceOriginalLyricsResolutionArtifactSchema,
  type ReferenceOriginalLyricsResolutionArtifact,
  type ReferenceTimelineArtifact,
  type ReferenceTranscriptionPlanArtifact,
  type SubtitleCue,
} from "@mvl/shared";
import { createHash } from "node:crypto";

function normalizeLyrics(value: string): string {
  return value.normalize("NFKC").replace(/[♪\s、。，．,.!?！？…]/gu, "");
}

function equivalentLyrics(left: string, right: string): boolean {
  const normalizedLeft = normalizeLyrics(left);
  const normalizedRight = normalizeLyrics(right);
  return (
    normalizedLeft === normalizedRight ||
    (Math.min(normalizedLeft.length, normalizedRight.length) >= 6 &&
      (normalizedLeft.includes(normalizedRight) ||
        normalizedRight.includes(normalizedLeft)))
  );
}

export function materializeReferenceOriginalLyrics(input: {
  timeline: ReferenceTimelineArtifact;
  existingCues: readonly SubtitleCue[];
}): {
  cues: SubtitleCue[];
  addedCueIds: string[];
  replacedCueIds: string[];
  removedConflictingCueIds: string[];
  resolution: ReferenceOriginalLyricsResolutionArtifact;
} {
  const existingById = new Map(input.existingCues.map((cue) => [cue.id, cue]));
  const added: SubtitleCue[] = [];
  const replacedCueIds: string[] = [];
  const removedConflictingCueIds: string[] = [];
  const conflicts: ReferenceOriginalLyricsResolutionArtifact["conflicts"] = [];
  for (const [index, anchor] of input.timeline.anchors
    .filter((candidate) => candidate.kind === "lyrics-original")
    .entries()) {
    const overlapping = input.existingCues.filter(
      (cue) =>
        cue.style === "music" &&
        cue.start < anchor.interval.end &&
        anchor.interval.start < cue.end,
    );
    const equivalent = overlapping.find((cue) =>
      equivalentLyrics(cue.text, anchor.referenceText),
    );
    const id = `reference-original-lyrics-${String(index + 1).padStart(4, "0")}`;
    if (equivalent !== undefined && !anchor.timingTrusted) {
      conflicts.push({
        id: `reference-original-conflict-${String(index + 1).padStart(4, "0")}`,
        interval: anchor.interval,
        referenceAnchorIds: [anchor.id],
        referenceCueIds: anchor.sourceCueIds,
        conflictingAsrCueIds: overlapping
          .filter((cue) => cue.id !== equivalent.id)
          .map((cue) => cue.id),
        selectedCueIds: [equivalent.id],
        decision: "existing-equivalent-kept",
        reasons: ["existing-music-cue-equivalent-to-reference-original-text"],
      });
      continue;
    }
    if (!anchor.timingTrusted) {
      conflicts.push({
        id: `reference-original-conflict-${String(index + 1).padStart(4, "0")}`,
        interval: anchor.interval,
        referenceAnchorIds: [anchor.id],
        referenceCueIds: anchor.sourceCueIds,
        conflictingAsrCueIds: overlapping.map((cue) => cue.id),
        selectedCueIds: [],
        decision: "review-unresolved",
        reasons: [
          "reference-original-lyrics-timing-not-trusted",
          "existing-asr-preserved-pending-review",
        ],
      });
      continue;
    }
    for (const conflicting of overlapping) {
      existingById.delete(conflicting.id);
      if (!removedConflictingCueIds.includes(conflicting.id)) {
        removedConflictingCueIds.push(conflicting.id);
      }
    }
    const cue: SubtitleCue = {
      id,
      start: anchor.interval.start,
      end: anchor.interval.end,
      language: "ja",
      languages: ["ja"],
      text: `♪ ${anchor.referenceText.replace(/^♪\s*|\s*♪$/gu, "").trim()} ♪`,
      style: "music",
      speaker: null,
      confidence: 1,
      textSource: "reference-original-language",
      provenance: {
        sourceLayer: "reference-original-language",
        sourceRequestIds: [],
        sourceProfileIds: [],
        referenceAnchorIds: [anchor.id],
        referenceUnitIds: [],
        recoveryUnitId: null,
        sceneId: null,
        sceneLabel: null,
        independentSupportCount: 1,
        qualityScore: 1,
      },
      timingEvidence: {
        sourceTrusted: true,
        speechStart: anchor.interval.start,
        speechEnd: anchor.interval.end,
        tokenTimestampsAvailable: false,
        tokenTimestampsUsed: false,
        tokens: [],
        alignmentSource: "source",
        presentationTimingMethod: "preserved-source",
      },
    };
    added.push(cue);
    if (overlapping.length > 0) replacedCueIds.push(cue.id);
    conflicts.push({
      id: `reference-original-conflict-${String(index + 1).padStart(4, "0")}`,
      interval: anchor.interval,
      referenceAnchorIds: [anchor.id],
      referenceCueIds: anchor.sourceCueIds,
      conflictingAsrCueIds: overlapping.map((candidate) => candidate.id),
      selectedCueIds: [cue.id],
      decision: "reference-original-selected",
      reasons:
        overlapping.length === 0
          ? ["trusted-reference-original-materialized"]
          : equivalent !== undefined
            ? [
                "trusted-reference-original-materialized",
                "equivalent-asr-replaced-with-reference-provenance-and-timing",
                "overlapping-asr-cues-removed",
              ]
            : [
                "trusted-reference-original-outranks-conflicting-lyrics-asr",
                "conflicting-asr-cues-removed",
              ],
    });
  }
  const resolution = referenceOriginalLyricsResolutionArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: createHash("sha256")
      .update(
        JSON.stringify({ timeline: input.timeline, cues: input.existingCues }),
      )
      .digest("hex"),
    configuration: {
      trustedReferenceOriginalOutranksLyricsAsr: true,
      minimumClassifierConfidence: 1,
    },
    addedCueIds: added.map((cue) => cue.id),
    replacedCueIds,
    removedConflictingCueIds,
    conflicts,
    fallback: null,
  });
  return {
    cues: [...existingById.values(), ...added].toSorted(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.id.localeCompare(right.id),
    ),
    addedCueIds: added.map((cue) => cue.id),
    replacedCueIds,
    removedConflictingCueIds,
    resolution,
  };
}

export function referenceRecoveryRequirements(
  plan: ReferenceTranscriptionPlanArtifact,
): {
  id: string;
  interval: { start: number; end: number };
  reasons: string[];
  expectedContent: "dialogue" | "singing";
  maximumUnitSeconds: number;
  preferredContextSeconds: number;
  referenceAnchorIds: string[];
  referenceUnitId: string;
  expectedCueCount: number;
}[] {
  return plan.units.flatMap((unit) =>
    unit.strategy === "reference-original-text"
      ? []
      : [
          {
            id: unit.id,
            interval: unit.targetInterval,
            reasons: [
              "reference-guided-anchor-requires-final-cue-or-active-review",
              ...unit.reasons,
            ],
            expectedContent:
              unit.strategy === "reference-lyrics"
                ? ("singing" as const)
                : ("dialogue" as const),
            maximumUnitSeconds:
              unit.unitSizingPolicy === "narration"
                ? plan.configuration.maximumUnitSecondsByContent.narration
                : unit.unitSizingPolicy === "singing"
                  ? plan.configuration.maximumUnitSecondsByContent.lyrics
                  : plan.configuration.maximumUnitSecondsByContent.dialogue,
            preferredContextSeconds: unit.contextSeconds,
            referenceAnchorIds: [...unit.anchorIds],
            referenceUnitId: unit.id,
            expectedCueCount: unit.expectedCueCount,
          },
        ],
  );
}
