import {
  discoveredSpeechAnchorsArtifactSchema,
  type DiscoveredSpeechAnchor,
  type DiscoveredSpeechAnchorsArtifact,
  type SubtitleCue,
} from "@mvl/shared";

import type { AcousticSceneSegment, TranscriptionInterval } from "./types.js";

export const DISCOVERED_SPEECH_ANCHOR_VERSION = "1.0.0";

type AnchorSource = DiscoveredSpeechAnchor["sources"][number];

interface Candidate {
  interval: TranscriptionInterval;
  source: AnchorSource;
  speechProbability: number;
  vocalProbability: number;
  expectedContent: DiscoveredSpeechAnchor["expectedContent"];
  evidence: string[];
}

function overlapSeconds(
  left: TranscriptionInterval,
  right: TranscriptionInterval,
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function candidatesFromScenes(
  scenes: readonly AcousticSceneSegment[],
): Candidate[] {
  return scenes.flatMap((scene): Candidate[] => {
    if (scene.label === "non-speech") return [];
    if (scene.label === "singing") {
      return [
        {
          interval: scene.interval,
          source: "scene-analysis" as const,
          speechProbability: scene.probabilities.speech,
          vocalProbability: Math.max(
            scene.probabilities.vocal,
            scene.probabilities.music,
          ),
          expectedContent: "singing" as const,
          evidence: [
            `scene:${scene.label}`,
            `scene-confidence:${scene.confidence.toFixed(3)}`,
          ],
        },
      ];
    }
    if (
      ["clean-dialogue", "quiet-dialogue", "noisy-dialogue"].includes(
        scene.label,
      )
    ) {
      return [
        {
          interval: scene.interval,
          source: "scene-analysis" as const,
          speechProbability: Math.max(
            scene.probabilities.speech,
            scene.confidence,
          ),
          vocalProbability: scene.probabilities.vocal,
          expectedContent: "dialogue" as const,
          evidence: [
            `scene:${scene.label}`,
            `scene-confidence:${scene.confidence.toFixed(3)}`,
          ],
        },
      ];
    }
    return [];
  });
}

export function discoverSpeechAnchors(input: {
  sourceAudioSha256: string;
  speechIntervals: readonly TranscriptionInterval[];
  acousticScenes?: readonly AcousticSceneSegment[] | undefined;
  baselineCues?: readonly SubtitleCue[] | undefined;
  noVadCues?: readonly SubtitleCue[] | undefined;
  extraSensitiveCues?: readonly SubtitleCue[] | undefined;
  lyricsRegions?: readonly { interval: TranscriptionInterval }[] | undefined;
  generatedAt?: string;
}): DiscoveredSpeechAnchorsArtifact {
  const candidates: Candidate[] = [
    ...input.speechIntervals.map((interval): Candidate => ({
      interval,
      source: "vad",
      speechProbability: 0.82,
      vocalProbability: 0.35,
      expectedContent: "dialogue",
      evidence: ["ordinary-vad-speech-island"],
    })),
    ...candidatesFromScenes(input.acousticScenes ?? []),
    ...(input.extraSensitiveCues ?? []).map((cue): Candidate => ({
      interval: { start: cue.start, end: cue.end },
      source: "extra-sensitive-vad",
      speechProbability: 0.85,
      vocalProbability: 0.4,
      expectedContent: "dialogue",
      evidence: ["extra-sensitive-vad-produced-text"],
    })),
    ...(input.noVadCues ?? []).map((cue): Candidate => ({
      interval: { start: cue.start, end: cue.end },
      source: "no-vad-probe",
      speechProbability: cue.confidence ?? 0.55,
      vocalProbability: 0.45,
      expectedContent: "uncertain",
      evidence: ["no-vad-probe-produced-canonical-cue"],
    })),
    ...(input.baselineCues ?? []).flatMap((cue): Candidate[] => [
      {
        interval: { start: cue.start, end: cue.end },
        source:
          cue.timingEvidence?.tokenTimestampsUsed === true
            ? "token-timestamps"
            : "vad",
        speechProbability: Math.max(0.65, cue.confidence ?? 0.65),
        vocalProbability: cue.style === "music" ? 0.9 : 0.35,
        expectedContent: cue.style === "music" ? "singing" : "dialogue",
        evidence: [
          cue.timingEvidence?.tokenTimestampsUsed === true
            ? "token-timestamps-produced-text"
            : "baseline-asr-produced-text",
        ],
      },
    ]),
    ...(input.lyricsRegions ?? []).map((region): Candidate => ({
      interval: region.interval,
      source: "lyrics-detector",
      speechProbability: 0.35,
      vocalProbability: 0.9,
      expectedContent: "singing",
      evidence: ["lyrics-detector-vocal-region"],
    })),
  ].filter((candidate) => candidate.interval.end > candidate.interval.start);
  const sorted = candidates.toSorted(
    (left, right) =>
      left.interval.start - right.interval.start ||
      left.interval.end - right.interval.end,
  );
  const clusters: Candidate[][] = [];
  for (const candidate of sorted) {
    const cluster = clusters.at(-1);
    if (cluster === undefined) {
      clusters.push([candidate]);
      continue;
    }
    const clusterEnd = Math.max(...cluster.map((item) => item.interval.end));
    const sameContent =
      cluster.some(
        (item) => item.expectedContent === candidate.expectedContent,
      ) || candidate.expectedContent === "uncertain";
    if (
      sameContent &&
      candidate.interval.start <= clusterEnd + 0.15 &&
      candidate.interval.end -
        Math.min(...cluster.map((item) => item.interval.start)) <=
        30
    ) {
      cluster.push(candidate);
    } else {
      clusters.push([candidate]);
    }
  }
  const anchors = clusters.map((cluster, index): DiscoveredSpeechAnchor => {
    const sources = [...new Set(cluster.map((candidate) => candidate.source))];
    const singingVotes = cluster.filter(
      (candidate) => candidate.expectedContent === "singing",
    ).length;
    const dialogueVotes = cluster.filter(
      (candidate) => candidate.expectedContent === "dialogue",
    ).length;
    const expectedContent =
      singingVotes > dialogueVotes
        ? ("singing" as const)
        : dialogueVotes > 0
          ? ("dialogue" as const)
          : ("uncertain" as const);
    const independentSources = sources.length;
    const confidence = Math.min(
      0.99,
      Math.max(
        ...cluster.map((candidate) =>
          expectedContent === "singing"
            ? candidate.vocalProbability
            : candidate.speechProbability,
        ),
      ) + Math.min(0.2, Math.max(0, independentSources - 1) * 0.08),
    );
    return {
      id: `discovered-speech-anchor-${String(index + 1).padStart(5, "0")}`,
      interval: {
        start: Math.min(
          ...cluster.map((candidate) => candidate.interval.start),
        ),
        end: Math.max(...cluster.map((candidate) => candidate.interval.end)),
      },
      sources,
      speechProbability: Math.min(
        1,
        Math.max(...cluster.map((candidate) => candidate.speechProbability)),
      ),
      vocalProbability: Math.min(
        1,
        Math.max(...cluster.map((candidate) => candidate.vocalProbability)),
      ),
      expectedContent,
      confidence,
      evidence: [
        ...new Set(cluster.flatMap((candidate) => candidate.evidence)),
        `independent-source-count:${independentSources}`,
      ],
    };
  });
  return discoveredSpeechAnchorsArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceAudioSha256: input.sourceAudioSha256,
    discoveryVersion: DISCOVERED_SPEECH_ANCHOR_VERSION,
    configuration: {
      highConfidenceThreshold: 0.75,
    },
    anchors,
    summary: {
      total: anchors.length,
      dialogue: anchors.filter(
        (anchor) => anchor.expectedContent === "dialogue",
      ).length,
      singing: anchors.filter((anchor) => anchor.expectedContent === "singing")
        .length,
      uncertain: anchors.filter(
        (anchor) => anchor.expectedContent === "uncertain",
      ).length,
      highConfidence: anchors.filter((anchor) => anchor.confidence >= 0.75)
        .length,
    },
    fallback: null,
  });
}

export function uncoveredDiscoveredAnchorRequirements(input: {
  artifact: DiscoveredSpeechAnchorsArtifact;
  reliableCues: readonly SubtitleCue[];
}): {
  id: string;
  interval: TranscriptionInterval;
  reasons: string[];
  expectedContent: "dialogue" | "singing";
}[] {
  return input.artifact.anchors.flatMap((anchor) => {
    if (
      anchor.confidence < 0.75 ||
      anchor.expectedContent === "uncertain" ||
      input.reliableCues.some((cue) => overlapSeconds(anchor.interval, cue) > 0)
    ) {
      return [];
    }
    return [
      {
        id: anchor.id,
        interval: anchor.interval,
        reasons: [
          "high-confidence-discovered-anchor-without-reliable-cue",
          ...anchor.evidence,
        ],
        expectedContent: anchor.expectedContent,
      },
    ];
  });
}
