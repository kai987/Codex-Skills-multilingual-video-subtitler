import type {
  AcousticSceneLabel,
  AcousticSceneSegment,
  AsrRoutingDecision,
  AsrRoutingPlanArtifact,
  AsrRoutingPlanEntry,
  AsrRoutingStrategy,
  SceneAnalysisMode,
  SceneAwareRefinementInterval,
  SceneRoutingMode,
} from "./types.js";

export const SCENE_ROUTING_VERSION = "scene-routing-v1";

function thresholdAdjustment(mode: SceneRoutingMode): number {
  if (mode === "balanced") return -0.1;
  if (mode === "aggressive") return -0.2;
  return 0;
}

function decision(
  strategy: AsrRoutingStrategy,
  reasons: string[],
): AsrRoutingDecision {
  switch (strategy) {
    case "vad-only":
      return {
        strategy,
        useVad: true,
        useExtraSensitiveVad: false,
        useNoVad: false,
        useLyricsMode: false,
        requireIndependentConsensus: false,
        requireLargeV3RefinementOnConflict: true,
        requireHumanReviewOnUnresolved: true,
        reasons,
      };
    case "extra-sensitive-vad":
      return {
        strategy,
        useVad: true,
        useExtraSensitiveVad: true,
        useNoVad: false,
        useLyricsMode: false,
        requireIndependentConsensus: true,
        requireLargeV3RefinementOnConflict: true,
        requireHumanReviewOnUnresolved: true,
        reasons,
      };
    case "vad-plus-no-vad":
      return {
        strategy,
        useVad: true,
        useExtraSensitiveVad: false,
        useNoVad: true,
        useLyricsMode: false,
        requireIndependentConsensus: true,
        requireLargeV3RefinementOnConflict: true,
        requireHumanReviewOnUnresolved: true,
        reasons,
      };
    case "lyrics-no-vad":
      return {
        strategy,
        useVad: true,
        useExtraSensitiveVad: false,
        useNoVad: false,
        useLyricsMode: true,
        requireIndependentConsensus: true,
        requireLargeV3RefinementOnConflict: false,
        requireHumanReviewOnUnresolved: true,
        reasons,
      };
    case "observe-only":
      return {
        strategy,
        useVad: true,
        useExtraSensitiveVad: false,
        useNoVad: false,
        useLyricsMode: false,
        requireIndependentConsensus: false,
        requireLargeV3RefinementOnConflict: false,
        requireHumanReviewOnUnresolved: false,
        reasons,
      };
    case "skip-dialogue-asr":
      return {
        strategy,
        useVad: false,
        useExtraSensitiveVad: false,
        useNoVad: false,
        useLyricsMode: false,
        requireIndependentConsensus: true,
        requireLargeV3RefinementOnConflict: false,
        requireHumanReviewOnUnresolved: true,
        reasons,
      };
    case "conservative-default":
      return {
        strategy,
        useVad: true,
        useExtraSensitiveVad: false,
        useNoVad: false,
        useLyricsMode: false,
        requireIndependentConsensus: true,
        requireLargeV3RefinementOnConflict: true,
        requireHumanReviewOnUnresolved: true,
        reasons,
      };
  }
}

export function routeSceneToAsrStrategy(input: {
  label: AcousticSceneLabel;
  confidence: number;
  vocalProbability: number;
  sceneConfidenceThreshold?: number | undefined;
  routingMode?: SceneRoutingMode | undefined;
}): AsrRoutingDecision {
  const routingMode = input.routingMode ?? "conservative";
  const threshold = Math.max(
    0.45,
    (input.sceneConfidenceThreshold ?? 0.75) + thresholdAdjustment(routingMode),
  );
  const lowConfidence = input.confidence < threshold;
  if (lowConfidence) {
    const highVocalUnknown =
      input.label === "unknown" && input.vocalProbability >= 0.65;
    if (highVocalUnknown && routingMode !== "conservative") {
      return decision("vad-plus-no-vad", [
        "low-confidence-scene",
        "unknown-high-vocal-evidence",
        "conservative-dual-evidence",
      ]);
    }
    return decision("conservative-default", [
      "scene-confidence-below-routing-threshold",
      "retain-vad-baseline",
      "qa-may-still-add-no-vad",
    ]);
  }
  switch (input.label) {
    case "clean-dialogue":
      return decision("vad-only", [
        "high-confidence-clean-dialogue",
        "retain-existing-quality-escalation",
      ]);
    case "quiet-dialogue":
      return decision("extra-sensitive-vad", [
        "quiet-dialogue-recall-probe",
        "retain-vad-baseline",
      ]);
    case "noisy-dialogue":
      return decision("vad-plus-no-vad", [
        "noisy-dialogue-requires-dual-evidence",
        "independent-consensus-required",
        "large-v3-required-on-conflict",
      ]);
    case "singing":
      return decision("lyrics-no-vad", [
        "singing-uses-prompt-free-lyrics-path",
        "lyrics-candidates-are-not-dialogue-cues",
      ]);
    case "non-speech":
      return decision("observe-only", [
        "non-speech-skip-disabled-in-v1",
        "scene-label-cannot-delete-existing-vocal-evidence",
      ]);
    case "unknown":
      return input.vocalProbability >= 0.65 && routingMode !== "conservative"
        ? decision("vad-plus-no-vad", [
            "unknown-high-vocal-evidence",
            "conservative-dual-evidence",
          ])
        : decision("conservative-default", [
            "unknown-scene",
            "retain-vad-baseline",
          ]);
  }
}

export function buildAsrRoutingPlan(input: {
  scenes: readonly AcousticSceneSegment[];
  sceneAnalysisMode: SceneAnalysisMode;
  sceneRoutingMode: SceneRoutingMode;
  sceneConfidenceThreshold: number;
  generatedAt?: string | undefined;
}): AsrRoutingPlanArtifact {
  const entries: AsrRoutingPlanEntry[] = input.scenes.map((scene) => {
    const recommended = routeSceneToAsrStrategy({
      label: scene.label,
      confidence: scene.confidence,
      vocalProbability: scene.probabilities.vocal,
      sceneConfidenceThreshold: input.sceneConfidenceThreshold,
      routingMode: input.sceneRoutingMode,
    });
    const observeOnly = input.sceneAnalysisMode !== "route";
    const actualStrategy = observeOnly
      ? ("legacy-baseline" as const)
      : recommended.strategy === "skip-dialogue-asr"
        ? ("observe-only" as const)
        : recommended.strategy;
    return {
      sceneId: scene.id,
      interval: scene.interval,
      label: scene.label,
      confidence: scene.confidence,
      probabilities: scene.probabilities,
      recommendedStrategy: recommended.strategy,
      actualStrategy,
      observeOnly,
      decision: recommended,
      execution: {
        vadBaseline: true,
        extraSensitiveVad: false,
        noVad: false,
        lyricsMode: false,
        cacheHits: 0,
        asrRequestIds: [],
      },
      reasons: [
        ...recommended.reasons,
        ...(observeOnly
          ? ["observe-mode-does-not-change-asr-routing"]
          : ["additive-routing-only", "selective-skip-disabled"]),
      ],
    };
  });
  return {
    schemaVersion: "1.0.0",
    status: "completed",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sceneAnalysisMode: input.sceneAnalysisMode,
    sceneRoutingMode: input.sceneRoutingMode,
    additiveOnly: true,
    selectiveSkipEnabled: false,
    analysisVersion: SCENE_ROUTING_VERSION,
    failure: null,
    entries,
    summary: summarize(entries),
  };
}

function summarize(
  entries: readonly AsrRoutingPlanEntry[],
): AsrRoutingPlanArtifact["summary"] {
  return {
    sceneCount: entries.length,
    proactiveNoVadScenes: entries.filter(
      (entry) =>
        !entry.observeOnly && entry.actualStrategy === "vad-plus-no-vad",
    ).length,
    proactiveExtraSensitiveVadScenes: entries.filter(
      (entry) =>
        !entry.observeOnly && entry.actualStrategy === "extra-sensitive-vad",
    ).length,
    proactiveLyricsScenes: entries.filter(
      (entry) => !entry.observeOnly && entry.actualStrategy === "lyrics-no-vad",
    ).length,
    noVadRequests: entries.reduce(
      (total, entry) =>
        total +
        entry.execution.asrRequestIds.filter((id) => id.includes(":no-vad:"))
          .length,
      0,
    ),
    extraSensitiveVadRequests: entries.reduce(
      (total, entry) =>
        total +
        entry.execution.asrRequestIds.filter((id) =>
          id.includes(":extra-sensitive-vad:"),
        ).length,
      0,
    ),
    lyricsRequests: entries.reduce(
      (total, entry) =>
        total +
        entry.execution.asrRequestIds.filter((id) => id.includes(":lyrics:"))
          .length,
      0,
    ),
    cacheHits: entries.reduce(
      (total, entry) => total + entry.execution.cacheHits,
      0,
    ),
  };
}

export function recordAsrRoutingExecution(input: {
  plan: AsrRoutingPlanArtifact;
  sceneId: string;
  profile: "no-vad" | "extra-sensitive-vad" | "lyrics";
  requestIds: readonly string[];
  cacheHits: number;
}): AsrRoutingPlanArtifact {
  const entries = input.plan.entries.map((entry) =>
    entry.sceneId !== input.sceneId
      ? entry
      : {
          ...entry,
          execution: {
            ...entry.execution,
            extraSensitiveVad:
              entry.execution.extraSensitiveVad ||
              input.profile === "extra-sensitive-vad",
            noVad: entry.execution.noVad || input.profile === "no-vad",
            lyricsMode:
              entry.execution.lyricsMode || input.profile === "lyrics",
            cacheHits: entry.execution.cacheHits + input.cacheHits,
            asrRequestIds: [
              ...new Set([
                ...entry.execution.asrRequestIds,
                ...input.requestIds,
              ]),
            ],
          },
        },
  );
  return {
    ...input.plan,
    entries,
    summary: summarize(entries),
  };
}

export function buildSceneRoutedIntervals(input: {
  plan: AsrRoutingPlanArtifact;
  profile: "no-vad" | "extra-sensitive-vad";
  mediaDurationSeconds: number;
  contextSeconds: number;
  maximumSeconds: number;
}): SceneAwareRefinementInterval[] {
  const maximum = Math.min(45, Math.max(1, input.maximumSeconds));
  const matching = input.plan.entries.filter((entry) => {
    if (entry.observeOnly) return false;
    return input.profile === "no-vad"
      ? entry.actualStrategy === "vad-plus-no-vad"
      : entry.actualStrategy === "extra-sensitive-vad";
  });
  const intervals: SceneAwareRefinementInterval[] = [];
  for (const entry of matching) {
    let start = entry.interval.start;
    while (start < entry.interval.end) {
      const end = Math.min(entry.interval.end, start + maximum);
      const duration = end - start;
      const available = Math.max(0, maximum - duration);
      const before = Math.min(input.contextSeconds, available / 2, start);
      let expandedStart = start - before;
      let expandedEnd = Math.min(
        input.mediaDurationSeconds,
        end + Math.min(input.contextSeconds, available - before),
      );
      if (expandedEnd - expandedStart > maximum) {
        expandedEnd = expandedStart + maximum;
      }
      if (expandedEnd < end) {
        expandedEnd = end;
        expandedStart = Math.max(0, end - maximum);
      }
      intervals.push({
        interval: { start, end },
        expandedInterval: { start: expandedStart, end: expandedEnd },
        sceneId: entry.sceneId,
        sceneLabel: entry.label,
        sceneConfidence: entry.confidence,
        sceneProbabilities: entry.probabilities,
        sceneRoutingReasons: entry.reasons,
      });
      start = end;
    }
  }
  return intervals;
}
