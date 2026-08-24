import { createHash } from "node:crypto";

import {
  subtitlePresentationResolutionSchema,
  type AssEventPresentationOverride,
  type OverlapResolutionMode,
  type PresentationResolutionMode,
  type SubtitleCue,
  type SubtitlePresentationResolution,
} from "@mvl/shared";
import {
  resolveDisplayLayout,
  type AssEventOverride,
} from "@mvl/subtitle-core";

import {
  classifyOverlapComponents,
  DEFAULT_OVERLAP_CLASSIFICATION_CONFIGURATION,
  type AssEventEvidence,
  type OverlapClassificationConfiguration,
} from "./overlap-classification.js";
import { classifyAdjacentRepetitions } from "./repetition-classification.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

export function presentationResolutionHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");
}

export interface SubtitlePresentationResolutionResult {
  cues: SubtitleCue[];
  artifact: SubtitlePresentationResolution;
  displayTextByCueId: ReadonlyMap<string, string>;
  assEventOverridesByCueId: ReadonlyMap<string, AssEventOverride>;
  vttCueSettingsByCueId: ReadonlyMap<string, string>;
}

export interface BuildSubtitlePresentationResolutionInput {
  cues: readonly SubtitleCue[];
  baseCueHash: string;
  humanReviewedAuthority?: boolean;
  assEventEvidenceByCueId?:
    | ReadonlyMap<string, AssEventEvidence>
    | Readonly<Record<string, AssEventEvidence>>;
  presentationResolution?: PresentationResolutionMode;
  overlapResolution?: OverlapResolutionMode;
  maximumLines?: number;
  maximumCharactersPerLine?: number;
  overlapConfiguration?: Partial<OverlapClassificationConfiguration>;
  generatedAt?: string;
}

export function buildSubtitlePresentationResolution(
  input: BuildSubtitlePresentationResolutionInput,
): SubtitlePresentationResolutionResult {
  const presentationResolution = input.presentationResolution ?? "enforce";
  const overlapResolution = input.overlapResolution ?? "conservative";
  const maximumLines = input.maximumLines ?? 2;
  const maximumCharactersPerLine = input.maximumCharactersPerLine ?? 16;
  const overlapConfiguration: OverlapClassificationConfiguration = {
    ...DEFAULT_OVERLAP_CLASSIFICATION_CONFIGURATION,
    ...input.overlapConfiguration,
    overlapResolution,
  };
  const overlap = classifyOverlapComponents({
    cues: input.cues,
    humanReviewedAuthority: input.humanReviewedAuthority ?? false,
    ...(input.assEventEvidenceByCueId === undefined
      ? {}
      : { assEventEvidenceByCueId: input.assEventEvidenceByCueId }),
    configuration: overlapConfiguration,
    applyTimingRepairs: presentationResolution === "enforce",
  });
  const cues = overlap.cues;
  const layoutDecisions = cues.map((cue) =>
    resolveDisplayLayout(cue, {
      maximumLines,
      maximumCharactersPerLine,
    }),
  );
  const repetitionDecisions = classifyAdjacentRepetitions({
    cues,
    humanReviewedAuthority: input.humanReviewedAuthority ?? false,
  });
  const displayTextByCueId = new Map<string, string>();
  const assEventOverridesByCueId = new Map<string, AssEventOverride>();
  const vttCueSettingsByCueId = new Map<string, string>();
  if (presentationResolution === "enforce") {
    for (const decision of layoutDecisions) {
      if (decision.resolved && !decision.blocking) {
        displayTextByCueId.set(decision.cueId, decision.displayText);
      }
    }
    for (const decision of overlap.decisions.filter(
      (value) => !value.blocking,
    )) {
      for (const event of decision.assEventOverrides) {
        assEventOverridesByCueId.set(event.cueId, {
          layer: event.layer,
          ...(event.alignment === null ? {} : { alignment: event.alignment }),
          ...(event.marginLeft === null
            ? {}
            : { marginLeft: event.marginLeft }),
          ...(event.marginRight === null
            ? {}
            : { marginRight: event.marginRight }),
          ...(event.marginVertical === null
            ? {}
            : { marginVertical: event.marginVertical }),
          ...(event.position === null ? {} : { position: event.position }),
        });
      }
      for (const setting of decision.vttCueSettings) {
        vttCueSettingsByCueId.set(setting.cueId, setting.settings);
      }
    }
  }
  const canonicalCueHash = presentationResolutionHash(cues);
  const serializedAssOverrides: AssEventPresentationOverride[] =
    presentationResolution === "enforce"
      ? overlap.decisions.flatMap((decision) => decision.assEventOverrides)
      : [];
  const serializedVttSettings =
    presentationResolution === "enforce"
      ? overlap.decisions.flatMap((decision) => decision.vttCueSettings)
      : [];
  const presentationCueHash = presentationResolutionHash({
    cues: cues.map((cue) => ({
      id: cue.id,
      start: cue.start,
      end: cue.end,
      canonicalText: cue.text,
      displayText: displayTextByCueId.get(cue.id) ?? cue.text,
    })),
    assEventOverrides: serializedAssOverrides,
    vttCueSettings: serializedVttSettings,
  });
  const originalById = new Map(input.cues.map((cue) => [cue.id, cue]));
  const canonicalTextMutationCount = cues.filter(
    (cue) => originalById.get(cue.id)?.text !== cue.text,
  ).length;
  const canonicalTimingMutationCount = cues.filter((cue) => {
    const before = originalById.get(cue.id);
    return before?.start !== cue.start || before.end !== cue.end;
  }).length;
  const artifact = subtitlePresentationResolutionSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "subtitle-presentation-resolution",
    resolutionVersion: "C5.14",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    baseCueHash: input.baseCueHash,
    canonicalCueHash,
    presentationCueHash,
    configuration: {
      presentationResolution,
      overlapResolution,
      maximumLines,
      maximumCharactersPerLine,
      maximumRapidTurnOverlapSeconds:
        overlapConfiguration.maximumRapidTurnOverlapSeconds,
      maximumRapidTurnOverlapRatio:
        overlapConfiguration.maximumRapidTurnOverlapRatio,
      maximumTimingAdjustmentSeconds:
        overlapConfiguration.maximumTimingAdjustmentSeconds,
      minimumPostRepairCueDurationSeconds:
        overlapConfiguration.minimumPostRepairCueDurationSeconds,
    },
    layoutDecisions,
    repetitionDecisions,
    overlapDecisions: overlap.decisions,
    summary: {
      canonicalCueCount: cues.length,
      presentationCueCount: cues.length,
      layoutDecisionCount: layoutDecisions.length,
      layoutChangedCount: layoutDecisions.filter((decision) => decision.changed)
        .length,
      layoutResolvedCount: layoutDecisions.filter(
        (decision) =>
          decision.changed && decision.resolved && !decision.blocking,
      ).length,
      layoutBlockingCount: layoutDecisions.filter(
        (decision) => decision.blocking,
      ).length,
      repetitionDecisionCount: repetitionDecisions.length,
      repetitionResolvedCount: repetitionDecisions.filter(
        (decision) => !decision.blocking,
      ).length,
      repetitionBlockingCount: repetitionDecisions.filter(
        (decision) => decision.blocking,
      ).length,
      overlapPairCount: overlap.overlapPairCount,
      overlapComponentCount: overlap.decisions.length,
      overlapResolvedCount: overlap.decisions.filter(
        (decision) => !decision.blocking,
      ).length,
      overlapBlockingCount: overlap.decisions.filter(
        (decision) => decision.blocking,
      ).length,
      timingMutationCount: overlap.timingMutations.length,
      canonicalTextMutationCount,
      canonicalTimingMutationCount,
      displayLexicalMismatchCount: layoutDecisions.filter(
        (decision) =>
          decision.canonicalLexicalHash !== decision.displayLexicalHash,
      ).length,
      presentationCreatedTemporalCueCount: Math.max(
        0,
        cues.length - input.cues.length,
      ),
      reviewGroupCount:
        layoutDecisions.filter((decision) => decision.blocking).length +
        repetitionDecisions.filter((decision) => decision.blocking).length +
        overlap.decisions.filter((decision) => decision.blocking).length,
      srtOverlapRenderingMayVary: overlap.decisions.some(
        (decision) => !decision.blocking && decision.overlapPairs.length > 0,
      ),
    },
  });
  return {
    cues,
    artifact,
    displayTextByCueId,
    assEventOverridesByCueId,
    vttCueSettingsByCueId,
  };
}
