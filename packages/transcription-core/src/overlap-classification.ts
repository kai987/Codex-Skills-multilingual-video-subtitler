import { createHash } from "node:crypto";

import {
  overlapDecisionSchema,
  type AssEventPresentationOverride,
  type OverlapDecision,
  type OverlapRelationship,
  type OverlapResolutionMode,
  type SubtitleCue,
  type TimingMutation,
  type VttCuePresentationSetting,
} from "@mvl/shared";

import { classifyJapaneseCueMerge } from "./text-integrity-repair.js";

export interface AssEventEvidence {
  cueId: string;
  layer: number;
  name: string | null;
  style: string;
}

export interface OverlapClassificationConfiguration {
  overlapResolution: OverlapResolutionMode;
  maximumRapidTurnOverlapSeconds: number;
  maximumRapidTurnOverlapRatio: number;
  maximumTimingAdjustmentSeconds: number;
  minimumPostRepairCueDurationSeconds: number;
}

export const DEFAULT_OVERLAP_CLASSIFICATION_CONFIGURATION: Readonly<OverlapClassificationConfiguration> =
  {
    overlapResolution: "conservative",
    maximumRapidTurnOverlapSeconds: 0.18,
    maximumRapidTurnOverlapRatio: 0.15,
    maximumTimingAdjustmentSeconds: 0.5,
    minimumPostRepairCueDurationSeconds: 0.25,
  };

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[♪\s、。，．,.!?！？…]/gu, "");
}

function bigrams(value: string): Set<string> {
  const characters = Array.from(value);
  if (characters.length < 2) return new Set(characters);
  return new Set(
    characters
      .slice(0, -1)
      .map((character, index) =>
        [character, characters[index + 1] ?? ""].join(""),
      ),
  );
}

export function overlapTextSimilarity(left: string, right: string): number {
  const a = normalized(left);
  const b = normalized(right);
  if (a === b) return 1;
  if (a === "" || b === "") return 0;
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  const common = [...leftPairs].filter((pair) => rightPairs.has(pair)).length;
  return (2 * common) / Math.max(1, leftPairs.size + rightPairs.size);
}

function textContainment(left: string, right: string): number {
  const a = normalized(left);
  const b = normalized(right);
  if (a === "" || b === "") return 0;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  return 0;
}

function overlapMetrics(
  left: SubtitleCue,
  right: SubtitleCue,
): {
  overlapSeconds: number;
  overlapRatio: number;
} {
  const overlapSeconds = Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  return {
    overlapSeconds,
    overlapRatio:
      overlapSeconds /
      Math.max(0.001, Math.min(left.end - left.start, right.end - right.start)),
  };
}

function sharedValues(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const values = new Set(right);
  return [...new Set(left.filter((value) => values.has(value)))].sort();
}

function presentationValue<T>(
  values: ReadonlyMap<string, T> | Readonly<Record<string, T>> | undefined,
  cueId: string,
): T | undefined {
  if (values === undefined) return undefined;
  const mapValues = values as ReadonlyMap<string, T>;
  if (typeof mapValues.get === "function") {
    return mapValues.get(cueId);
  }
  return (values as Readonly<Record<string, T>>)[cueId];
}

function repeatedCallStructure(value: string): boolean {
  const units = value.match(/[^!?！？]+[!?！？]+/gu) ?? [];
  if (units.length < 2) return false;
  const normalizedUnits = units.map((unit) => normalized(unit));
  return normalizedUnits.every((unit) => unit === normalizedUnits[0]);
}

function crowdOrChantScene(cue: SubtitleCue): boolean {
  return /crowd|chant|chorus|call/iu.test(cue.provenance?.sceneLabel ?? "");
}

export interface TrustedOverlapBoundary {
  boundary: number;
  boundarySource: "token" | "speech" | "vad" | "source";
  evidence: string[];
  leftAdjustmentSeconds: number;
  rightAdjustmentSeconds: number;
}

/**
 * Selects a boundary only from localized timing evidence. There is
 * intentionally no midpoint fallback.
 */
export function selectTrustedOverlapBoundary(
  left: SubtitleCue,
  right: SubtitleCue,
  options: {
    maximumTimingAdjustmentSeconds?: number;
    minimumPostRepairCueDurationSeconds?: number;
  } = {},
): TrustedOverlapBoundary | null {
  const maximumTimingAdjustmentSeconds =
    options.maximumTimingAdjustmentSeconds ??
    DEFAULT_OVERLAP_CLASSIFICATION_CONFIGURATION.maximumTimingAdjustmentSeconds;
  const minimumPostRepairCueDurationSeconds =
    options.minimumPostRepairCueDurationSeconds ??
    DEFAULT_OVERLAP_CLASSIFICATION_CONFIGURATION.minimumPostRepairCueDurationSeconds;
  const tokenEnd = left.timingEvidence?.tokens.at(-1)?.end;
  const tokenStart = right.timingEvidence?.tokens[0]?.start;
  const speechEnd = left.timingEvidence?.speechEnd;
  const speechStart = right.timingEvidence?.speechStart;
  const candidates: {
    leftBoundary: number;
    rightBoundary: number;
    source: TrustedOverlapBoundary["boundarySource"];
  }[] = [
    ...(tokenEnd === undefined || tokenStart === undefined
      ? []
      : [
          {
            leftBoundary: tokenEnd,
            rightBoundary: tokenStart,
            source: "token" as const,
          },
        ]),
    ...(speechEnd === null ||
    speechEnd === undefined ||
    speechStart === null ||
    speechStart === undefined
      ? []
      : [
          {
            leftBoundary: speechEnd,
            rightBoundary: speechStart,
            source:
              left.timingEvidence?.alignmentSource === "vad" ||
              right.timingEvidence?.alignmentSource === "vad"
                ? ("vad" as const)
                : left.timingEvidence?.sourceTrusted === true &&
                    right.timingEvidence?.sourceTrusted === true
                  ? ("source" as const)
                  : ("speech" as const),
          },
        ]),
  ];
  for (const candidate of candidates) {
    if (candidate.rightBoundary < candidate.leftBoundary) continue;
    const boundary = (candidate.leftBoundary + candidate.rightBoundary) / 2;
    const leftAdjustmentSeconds = Math.max(0, left.end - boundary);
    const rightAdjustmentSeconds = Math.max(0, boundary - right.start);
    if (
      leftAdjustmentSeconds > maximumTimingAdjustmentSeconds ||
      rightAdjustmentSeconds > maximumTimingAdjustmentSeconds ||
      boundary - left.start < minimumPostRepairCueDurationSeconds ||
      right.end - boundary < minimumPostRepairCueDurationSeconds
    ) {
      continue;
    }
    return {
      boundary,
      boundarySource: candidate.source,
      evidence: [
        `${candidate.source}-left-boundary:${candidate.leftBoundary.toFixed(3)}`,
        `${candidate.source}-right-boundary:${candidate.rightBoundary.toFixed(3)}`,
        `selected-evidence-boundary:${boundary.toFixed(3)}`,
      ],
      leftAdjustmentSeconds,
      rightAdjustmentSeconds,
    };
  }
  return null;
}

interface PairClassification {
  relationship: OverlapRelationship;
  evidence: string[];
  overlapSeconds: number;
  overlapRatio: number;
  textSimilarity: number;
  textContainment: number;
  speakerEvidence: string[];
  styleEvidence: string[];
  layerEvidence: string[];
  sourceEvidence: string[];
  tokenBoundaryEvidence: string[];
  speechBoundaryEvidence: string[];
  sceneEvidence: string[];
  trustedBoundary: TrustedOverlapBoundary | null;
}

export function classifyOverlapRelationship(
  left: SubtitleCue,
  right: SubtitleCue,
  options: {
    humanReviewedAuthority?: boolean;
    overlapResolution?: OverlapResolutionMode;
    assEventEvidenceByCueId?:
      | ReadonlyMap<string, AssEventEvidence>
      | Readonly<Record<string, AssEventEvidence>>;
    maximumRapidTurnOverlapSeconds?: number;
    maximumRapidTurnOverlapRatio?: number;
    maximumTimingAdjustmentSeconds?: number;
    minimumPostRepairCueDurationSeconds?: number;
  } = {},
): PairClassification {
  const metrics = overlapMetrics(left, right);
  const similarity = overlapTextSimilarity(left.text, right.text);
  const containment = textContainment(left.text, right.text);
  const leftEvent = presentationValue(options.assEventEvidenceByCueId, left.id);
  const rightEvent = presentationValue(
    options.assEventEvidenceByCueId,
    right.id,
  );
  const differentSpeakers =
    left.speaker !== null &&
    right.speaker !== null &&
    left.speaker !== right.speaker;
  const differentNames =
    leftEvent?.name !== null &&
    leftEvent?.name !== undefined &&
    rightEvent?.name !== null &&
    rightEvent?.name !== undefined &&
    leftEvent.name !== rightEvent.name;
  const differentLayers =
    leftEvent !== undefined &&
    rightEvent !== undefined &&
    leftEvent.layer !== rightEvent.layer;
  const speakerEvidence = [
    ...(differentSpeakers
      ? [`different-speakers:${left.speaker ?? ""}:${right.speaker ?? ""}`]
      : []),
    ...(differentNames
      ? [`different-ass-names:${leftEvent.name ?? ""}:${rightEvent.name ?? ""}`]
      : []),
  ];
  const styleEvidence =
    (left.style ?? "default") === (right.style ?? "default")
      ? [`same-style:${left.style ?? "default"}`]
      : [
          `different-styles:${left.style ?? "default"}:${right.style ?? "default"}`,
        ];
  const layerEvidence = [
    ...(leftEvent === undefined || rightEvent === undefined
      ? []
      : [
          differentLayers
            ? `different-ass-layers:${leftEvent.layer}:${rightEvent.layer}`
            : `same-ass-layer:${leftEvent.layer}`,
        ]),
  ];
  const sharedRequests = sharedValues(
    left.provenance?.sourceRequestIds ?? [],
    right.provenance?.sourceRequestIds ?? [],
  );
  const sharedAnchors = sharedValues(
    left.provenance?.referenceAnchorIds ?? [],
    right.provenance?.referenceAnchorIds ?? [],
  );
  const sameRecovery =
    left.provenance?.recoveryUnitId !== null &&
    left.provenance?.recoveryUnitId !== undefined &&
    left.provenance.recoveryUnitId === right.provenance?.recoveryUnitId;
  const sourceEvidence = [
    ...sharedRequests.map((value) => `shared-source-request:${value}`),
    ...sharedAnchors.map((value) => `shared-reference-anchor:${value}`),
    ...(sameRecovery
      ? [`shared-recovery-unit:${left.provenance?.recoveryUnitId ?? ""}`]
      : []),
  ];
  const trustedBoundary = selectTrustedOverlapBoundary(left, right, {
    ...(options.maximumTimingAdjustmentSeconds === undefined
      ? {}
      : {
          maximumTimingAdjustmentSeconds:
            options.maximumTimingAdjustmentSeconds,
        }),
    ...(options.minimumPostRepairCueDurationSeconds === undefined
      ? {}
      : {
          minimumPostRepairCueDurationSeconds:
            options.minimumPostRepairCueDurationSeconds,
        }),
  });
  const tokenBoundaryEvidence =
    trustedBoundary?.boundarySource === "token"
      ? [...trustedBoundary.evidence]
      : [];
  const speechBoundaryEvidence =
    trustedBoundary !== null && trustedBoundary.boundarySource !== "token"
      ? [...trustedBoundary.evidence]
      : [];
  const sceneEvidence = [
    ...(left.provenance?.sceneLabel == null
      ? []
      : [`left-scene:${left.provenance.sceneLabel}`]),
    ...(right.provenance?.sceneLabel == null
      ? []
      : [`right-scene:${right.provenance.sceneLabel}`]),
  ];
  const explicitAuthoritativeStructure =
    options.humanReviewedAuthority === true &&
    (differentLayers || differentNames || differentSpeakers);
  const sameSource =
    sharedRequests.length > 0 || sharedAnchors.length > 0 || sameRecovery;
  const sameBounds =
    Math.abs(left.start - right.start) <= 0.01 &&
    Math.abs(left.end - right.end) <= 0.01;
  let relationship: OverlapRelationship = "unresolved";
  const evidence = [
    `text-similarity:${similarity.toFixed(3)}`,
    `text-containment:${containment.toFixed(3)}`,
    `temporal-overlap-seconds:${metrics.overlapSeconds.toFixed(3)}`,
    `temporal-overlap-ratio:${metrics.overlapRatio.toFixed(3)}`,
    ...speakerEvidence,
    ...styleEvidence,
    ...layerEvidence,
    ...sourceEvidence,
    ...tokenBoundaryEvidence,
    ...speechBoundaryEvidence,
    ...sceneEvidence,
  ];
  if (
    normalized(left.text) === normalized(right.text) &&
    (sameBounds || metrics.overlapRatio >= 0.9 || sameSource)
  ) {
    relationship = "exact-duplicate";
  } else if (similarity >= 0.9 && metrics.overlapRatio >= 0.8) {
    relationship = "near-duplicate";
  } else if (similarity >= 0.72 && metrics.overlapRatio >= 0.65 && sameSource) {
    relationship = "same-utterance-alternative";
  } else {
    const merge = classifyJapaneseCueMerge(left, right);
    if (
      merge.relationship === "complementary-fragments" &&
      sameSource &&
      options.humanReviewedAuthority !== true
    ) {
      relationship = "complementary-fragments";
      evidence.push(...merge.evidence);
    } else if (
      repeatedCallStructure(left.text) !== repeatedCallStructure(right.text) &&
      (crowdOrChantScene(left) ||
        crowdOrChantScene(right) ||
        explicitAuthoritativeStructure)
    ) {
      relationship = "crowd-call-plus-dialogue";
    } else if (explicitAuthoritativeStructure) {
      relationship = "legal-authoritative-overlap";
    } else if (
      (differentSpeakers || differentNames) &&
      options.humanReviewedAuthority !== true
    ) {
      relationship = "true-simultaneous-speech";
    } else if (
      options.overlapResolution === "balanced" &&
      options.humanReviewedAuthority === true &&
      metrics.overlapSeconds <=
        (options.maximumRapidTurnOverlapSeconds ??
          DEFAULT_OVERLAP_CLASSIFICATION_CONFIGURATION.maximumRapidTurnOverlapSeconds) &&
      metrics.overlapRatio <=
        (options.maximumRapidTurnOverlapRatio ??
          DEFAULT_OVERLAP_CLASSIFICATION_CONFIGURATION.maximumRapidTurnOverlapRatio) &&
      similarity < 0.72
    ) {
      relationship = "rapid-turn-taking";
    } else if (trustedBoundary !== null && similarity < 0.72) {
      relationship = "different-dialogue-boundary-error";
    }
  }
  return {
    relationship,
    evidence,
    ...metrics,
    textSimilarity: similarity,
    textContainment: containment,
    speakerEvidence,
    styleEvidence,
    layerEvidence,
    sourceEvidence,
    tokenBoundaryEvidence,
    speechBoundaryEvidence,
    sceneEvidence,
    trustedBoundary,
  };
}

interface OverlapEdge {
  left: SubtitleCue;
  right: SubtitleCue;
  classification: PairClassification;
}

function componentRelationship(
  edges: readonly OverlapEdge[],
): OverlapRelationship {
  const values = edges.map((edge) => edge.classification.relationship);
  if (values.every((value) => value === values[0]))
    return values[0] ?? "unresolved";
  if (values.some((value) => value === "unresolved")) return "unresolved";
  const legal = new Set<OverlapRelationship>([
    "rapid-turn-taking",
    "true-simultaneous-speech",
    "crowd-call-plus-dialogue",
    "nested-background-speech",
    "legal-authoritative-overlap",
  ]);
  if (values.every((value) => legal.has(value))) {
    if (values.includes("crowd-call-plus-dialogue")) {
      return "crowd-call-plus-dialogue";
    }
    if (values.every((value) => value === "rapid-turn-taking")) {
      return "rapid-turn-taking";
    }
    return "legal-authoritative-overlap";
  }
  return "unresolved";
}

function actionForRelationship(relationship: OverlapRelationship): {
  recommendedAction: OverlapDecision["recommendedAction"];
  safeAutomaticAction: OverlapDecision["safeAutomaticAction"];
  blocking: boolean;
} {
  if (
    [
      "rapid-turn-taking",
      "true-simultaneous-speech",
      "crowd-call-plus-dialogue",
      "nested-background-speech",
      "legal-authoritative-overlap",
    ].includes(relationship)
  ) {
    return {
      recommendedAction: "preserve-overlap",
      safeAutomaticAction: "presentation-only",
      blocking: false,
    };
  }
  if (relationship === "exact-duplicate" || relationship === "near-duplicate") {
    return {
      recommendedAction: "delete-duplicate",
      safeAutomaticAction: "none",
      blocking: true,
    };
  }
  if (relationship === "same-utterance-alternative") {
    return {
      recommendedAction: "select-alternative",
      safeAutomaticAction: "none",
      blocking: true,
    };
  }
  if (relationship === "complementary-fragments") {
    return {
      recommendedAction: "merge-fragments",
      safeAutomaticAction: "none",
      blocking: true,
    };
  }
  if (relationship === "different-dialogue-boundary-error") {
    return {
      recommendedAction: "trim-boundary",
      safeAutomaticAction: "none",
      blocking: true,
    };
  }
  return {
    recommendedAction: "review",
    safeAutomaticAction: "none",
    blocking: true,
  };
}

export function legalOverlapPresentationOverrides(
  cues: readonly SubtitleCue[],
): {
  ass: AssEventPresentationOverride[];
  vtt: VttCuePresentationSetting[];
} {
  return {
    ass: cues.map((cue, index) => ({
      cueId: cue.id,
      layer: index,
      alignment: index % 2 === 0 ? 8 : 2,
      marginLeft: null,
      marginRight: null,
      marginVertical: index % 2 === 0 ? 70 : 40,
      position: null,
    })),
    vtt: cues.map((cue, index) => ({
      cueId: cue.id,
      settings:
        index % 2 === 0
          ? "line:10% position:50% align:center"
          : "line:90% position:50% align:center",
    })),
  };
}

export function classifyOverlapComponents(input: {
  cues: readonly SubtitleCue[];
  humanReviewedAuthority?: boolean;
  assEventEvidenceByCueId?:
    | ReadonlyMap<string, AssEventEvidence>
    | Readonly<Record<string, AssEventEvidence>>;
  configuration?: Partial<OverlapClassificationConfiguration>;
  applyTimingRepairs?: boolean;
}): {
  cues: SubtitleCue[];
  decisions: OverlapDecision[];
  overlapPairCount: number;
  timingMutations: TimingMutation[];
} {
  const configuration: OverlapClassificationConfiguration = {
    ...DEFAULT_OVERLAP_CLASSIFICATION_CONFIGURATION,
    ...input.configuration,
  };
  let cues = [...input.cues].toSorted(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.id.localeCompare(right.id),
  );
  const edges: OverlapEdge[] = [];
  // The final quality gate emits one overlap finding for each adjacent pair.
  // Those findings are the graph edges; connected components then merge a
  // three-cue chain into one decision instead of producing two conflicting
  // review actions for its two existing findings.
  for (let index = 1; index < cues.length; index += 1) {
    const left = cues[index - 1];
    const right = cues[index];
    if (
      left === undefined ||
      right === undefined ||
      right.start >= left.end - 0.01
    ) {
      continue;
    }
    edges.push({
      left,
      right,
      classification: classifyOverlapRelationship(left, right, {
        humanReviewedAuthority: input.humanReviewedAuthority ?? false,
        overlapResolution: configuration.overlapResolution,
        ...(input.assEventEvidenceByCueId === undefined
          ? {}
          : { assEventEvidenceByCueId: input.assEventEvidenceByCueId }),
        maximumRapidTurnOverlapSeconds:
          configuration.maximumRapidTurnOverlapSeconds,
        maximumRapidTurnOverlapRatio:
          configuration.maximumRapidTurnOverlapRatio,
        maximumTimingAdjustmentSeconds:
          configuration.maximumTimingAdjustmentSeconds,
        minimumPostRepairCueDurationSeconds:
          configuration.minimumPostRepairCueDurationSeconds,
      }),
    });
  }
  const parent = new Map<string, string>();
  const findRoot = (cueId: string): string => {
    const current = parent.get(cueId);
    if (current === undefined) {
      parent.set(cueId, cueId);
      return cueId;
    }
    if (current === cueId) return cueId;
    const root = findRoot(current);
    parent.set(cueId, root);
    return root;
  };
  const union = (leftCueId: string, rightCueId: string): void => {
    const leftRoot = findRoot(leftCueId);
    const rightRoot = findRoot(rightCueId);
    if (leftRoot === rightRoot) return;
    const [first, second] = [leftRoot, rightRoot].toSorted();
    if (first !== undefined && second !== undefined) parent.set(second, first);
  };
  for (const edge of edges) union(edge.left.id, edge.right.id);
  const componentsByRoot = new Map<string, OverlapEdge[]>();
  for (const edge of edges) {
    const root = findRoot(edge.left.id);
    const component = componentsByRoot.get(root) ?? [];
    component.push(edge);
    componentsByRoot.set(root, component);
  }
  const components = [...componentsByRoot.values()];
  const decisions: OverlapDecision[] = [];
  const timingMutations: TimingMutation[] = [];
  for (const component of components) {
    const componentCues = [
      ...new Map(
        component
          .flatMap((edge) => [edge.left, edge.right])
          .map((cue) => [cue.id, cue]),
      ).values(),
    ].toSorted(
      (left, right) =>
        left.start - right.start || left.id.localeCompare(right.id),
    );
    let relationship = componentRelationship(component);
    let action = actionForRelationship(relationship);
    let mutations: TimingMutation[] = [];
    if (
      relationship === "different-dialogue-boundary-error" &&
      component.length === 1 &&
      input.applyTimingRepairs === true
    ) {
      const edge = component[0];
      const boundary = edge?.classification.trustedBoundary;
      if (edge !== undefined && boundary !== null && boundary !== undefined) {
        const leftBefore = { start: edge.left.start, end: edge.left.end };
        const rightBefore = { start: edge.right.start, end: edge.right.end };
        const repairedLeft = { ...edge.left, end: boundary.boundary };
        const repairedRight = { ...edge.right, start: boundary.boundary };
        cues = cues.map((cue) =>
          cue.id === repairedLeft.id
            ? repairedLeft
            : cue.id === repairedRight.id
              ? repairedRight
              : cue,
        );
        mutations = [
          {
            cueId: repairedLeft.id,
            before: leftBefore,
            after: { start: repairedLeft.start, end: repairedLeft.end },
            boundarySource: boundary.boundarySource,
          },
          {
            cueId: repairedRight.id,
            before: rightBefore,
            after: { start: repairedRight.start, end: repairedRight.end },
            boundarySource: boundary.boundarySource,
          },
        ].filter(
          (mutation) =>
            mutation.before.start !== mutation.after.start ||
            mutation.before.end !== mutation.after.end,
        );
        timingMutations.push(...mutations);
        action = {
          recommendedAction: "trim-boundary",
          safeAutomaticAction: "timing-only",
          blocking: false,
        };
      } else {
        relationship = "unresolved";
        action = actionForRelationship(relationship);
      }
    }
    const presentationOverrides =
      !action.blocking &&
      [
        "rapid-turn-taking",
        "true-simultaneous-speech",
        "crowd-call-plus-dialogue",
        "nested-background-speech",
        "legal-authoritative-overlap",
      ].includes(relationship)
        ? legalOverlapPresentationOverrides(componentCues)
        : { ass: [], vtt: [] };
    const overlapPairs = component.map((edge) => ({
      leftCueId: edge.left.id,
      rightCueId: edge.right.id,
      overlapSeconds: edge.classification.overlapSeconds,
      overlapRatio: edge.classification.overlapRatio,
      textSimilarity: edge.classification.textSimilarity,
      textContainment: edge.classification.textContainment,
    }));
    decisions.push(
      overlapDecisionSchema.parse({
        decisionId: `overlap-${hash({ cueIds: componentCues.map((cue) => cue.id) }).slice(0, 20)}`,
        cueIds: componentCues.map((cue) => cue.id),
        relationship,
        interval: {
          start: Math.min(...componentCues.map((cue) => cue.start)),
          end: Math.max(...componentCues.map((cue) => cue.end)),
        },
        overlapPairs,
        overlapSeconds: overlapPairs.reduce(
          (sum, pair) => sum + pair.overlapSeconds,
          0,
        ),
        overlapRatio: Math.max(
          ...overlapPairs.map((pair) => pair.overlapRatio),
        ),
        textSimilarity: Math.max(
          ...overlapPairs.map((pair) => pair.textSimilarity),
        ),
        textContainment: Math.max(
          ...overlapPairs.map((pair) => pair.textContainment),
        ),
        speakerEvidence: [
          ...new Set(
            component.flatMap((edge) => edge.classification.speakerEvidence),
          ),
        ].sort(),
        styleEvidence: [
          ...new Set(
            component.flatMap((edge) => edge.classification.styleEvidence),
          ),
        ].sort(),
        layerEvidence: [
          ...new Set(
            component.flatMap((edge) => edge.classification.layerEvidence),
          ),
        ].sort(),
        sourceEvidence: [
          ...new Set(
            component.flatMap((edge) => edge.classification.sourceEvidence),
          ),
        ].sort(),
        tokenBoundaryEvidence: [
          ...new Set(
            component.flatMap(
              (edge) => edge.classification.tokenBoundaryEvidence,
            ),
          ),
        ].sort(),
        speechBoundaryEvidence: [
          ...new Set(
            component.flatMap(
              (edge) => edge.classification.speechBoundaryEvidence,
            ),
          ),
        ].sort(),
        sceneEvidence: [
          ...new Set(
            component.flatMap((edge) => edge.classification.sceneEvidence),
          ),
        ].sort(),
        humanReviewedAuthority: input.humanReviewedAuthority ?? false,
        ...action,
        timingMutations: mutations,
        assEventOverrides: presentationOverrides.ass,
        vttCueSettings: presentationOverrides.vtt,
        reasons: [
          ...new Set([
            ...component.flatMap((edge) => edge.classification.evidence),
            ...(action.blocking
              ? ["overlap-component-needs-human-review"]
              : ["overlap-component-safely-classified"]),
            ...(mutations.length === 0
              ? ["no-timing-mutation-applied"]
              : ["trusted-evidence-timing-only-repair"]),
          ]),
        ],
        blocking: action.blocking,
      }),
    );
  }
  return { cues, decisions, overlapPairCount: edges.length, timingMutations };
}
