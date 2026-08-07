import { createHash } from "node:crypto";

import {
  atomicHypothesisClustersArtifactSchema,
  cueCandidateEvidenceArtifactSchema,
  hypothesisClustersArtifactSchema,
  hypothesisResolutionArtifactSchema,
  topScoreResolutionArtifactSchema,
  topScoreWinnersArtifactSchema,
  type ArtifactHypothesisResolutionMode,
  type AtomicHypothesisCluster,
  type AtomicHypothesisClustersArtifact,
  type CandidateAtomizationArtifact,
  type CueCandidateEvidence,
  type CueCandidateEvidenceArtifact,
  type HypothesisClustersArtifact,
  type HypothesisResolutionArtifact,
  type ReferenceTimelineArtifact,
  type SemanticCandidateValidationArtifact,
  type SubtitleCue,
  type TerminologyEvidenceArtifact,
  type TopScoreResolutionArtifact,
  type TopScoreWinnersArtifact,
} from "@mvl/shared";
import { analyzeJapaneseText } from "@mvl/subtitle-core";

import { atomizeHypothesisCandidates } from "./candidate-atomization.js";

export interface CompetingHypothesisResolutionResult {
  cues: SubtitleCue[];
  candidateEvidence: CueCandidateEvidenceArtifact;
  clusters: HypothesisClustersArtifact;
  resolution: HypothesisResolutionArtifact;
  atomization: CandidateAtomizationArtifact;
  atomicClusters: AtomicHypothesisClustersArtifact;
  topScoreResolution: TopScoreResolutionArtifact;
  topScoreWinners: TopScoreWinnersArtifact;
}

const SCORE_GAP_REVIEW_THRESHOLD = 0.02;
const TIE_BREAK_ORDER = [
  "selectionScore",
  "totalScore",
  "independentSupportCount",
  "acousticSupport",
  "speechCoverage",
  "tokenTimingQuality",
  "japaneseTextCompleteness",
  "terminologySupport",
  "hallucinationRisk:ascending",
  "fragmentRisk:ascending",
  "repetitionRisk:ascending",
  "cueId:lexicographic",
] as const;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[♪\s、。，．,.!?！？…]/gu, "")
    .toLocaleLowerCase("ja");
}

function ngrams(value: string, size: 2 | 3): Set<string> {
  const characters = Array.from(normalizeText(value));
  if (characters.length <= size) return new Set([characters.join("")]);
  return new Set(
    characters
      .slice(0, characters.length - size + 1)
      .map((_, index) => characters.slice(index, index + size).join("")),
  );
}

function dice(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  const intersection = [...left].filter((entry) => right.has(entry)).length;
  return (2 * intersection) / Math.max(1, left.size + right.size);
}

function similarity(left: string, right: string): number {
  return Math.max(
    dice(ngrams(left, 2), ngrams(right, 2)),
    dice(ngrams(left, 3), ngrams(right, 3)),
  );
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

function overlapRatio(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return (
    overlapSeconds(left, right) /
    Math.max(0.001, Math.min(left.end - left.start, right.end - right.start))
  );
}

function center(interval: { start: number; end: number }): number {
  return (interval.start + interval.end) / 2;
}

function provenanceArray(
  cue: SubtitleCue,
  field:
    | "sourceRequestIds"
    | "sourceProfileIds"
    | "referenceAnchorIds"
    | "referenceUnitIds",
): string[] {
  return cue.provenance?.[field] ?? [];
}

function intersection(left: readonly string[], right: readonly string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function acousticSupport(cue: SubtitleCue): number {
  const confidence = cue.confidence ?? 0.55;
  const noSpeechPenalty = cue.transcriptionMetrics?.noSpeechProbability ?? 0;
  const logProbability = cue.transcriptionMetrics?.averageLogProbability;
  const logProbabilityScore =
    logProbability === null || logProbability === undefined
      ? confidence
      : Math.max(0, Math.min(1, (logProbability + 2) / 2));
  return Math.max(
    0,
    Math.min(1, (confidence + logProbabilityScore) / 2 - noSpeechPenalty * 0.5),
  );
}

function speechCoverage(cue: SubtitleCue): number {
  const duration = Math.max(0.001, cue.end - cue.start);
  const intervals = cue.timingEvidence?.speechIntervals ?? [];
  if (intervals.length > 0) {
    const covered = intervals.reduce(
      (sum, interval) => sum + overlapSeconds(cue, interval),
      0,
    );
    return Math.min(1, covered / duration);
  }
  const start = cue.timingEvidence?.speechStart;
  const end = cue.timingEvidence?.speechEnd;
  if (
    start === null ||
    start === undefined ||
    end === null ||
    end === undefined
  ) {
    return cue.style === "music" ? 0.5 : 0.35;
  }
  return Math.min(1, overlapSeconds(cue, { start, end }) / duration);
}

function provenancePriority(cue: SubtitleCue): number {
  if (
    cue.textSource === "reference-original-language" ||
    cue.provenance?.sourceLayer === "reference-original-language"
  ) {
    return 1;
  }
  switch (cue.provenance?.sourceLayer) {
    case "large-v3-refinement":
      return 0.82;
    case "recovery":
      return 0.78;
    case "baseline-vad":
      return 0.68;
    case "scene-extra-sensitive-vad":
      return 0.65;
    case "no-vad":
      return 0.64;
    case "lyrics-asr":
      return 0.58;
    case "embedded":
    case "online":
      return 0.9;
    case undefined:
      return 0.5;
  }
}

function hardBlockReasons(cue: SubtitleCue): string[] {
  const text = normalizeText(cue.text);
  const analysis = analyzeJapaneseText(cue.text);
  const duration = cue.end - cue.start;
  const reasons: string[] = [];
  if (text === "") reasons.push("EMPTY_TEXT");
  if (
    !Number.isFinite(cue.start) ||
    !Number.isFinite(cue.end) ||
    cue.end <= cue.start
  ) {
    reasons.push("INVALID_TIME_INTERVAL");
  }
  if (
    cue.provenance?.sceneLabel === "non-speech" &&
    acousticSupport(cue) < 0.2 &&
    speechCoverage(cue) < 0.1
  ) {
    reasons.push("CONFIRMED_NON_SPEECH");
  }
  if (
    cue.style === "music" &&
    cue.provenance?.sourceLayer !== "reference-original-language" &&
    /(?:ご視聴.*ありがとう|チャンネル登録|字幕.*作成者)/u.test(text)
  ) {
    reasons.push("CONFIRMED_LYRICS_BOILERPLATE_HALLUCINATION");
  }
  if (
    analysis.singleCharacter &&
    analysis.standaloneInterjectionLikelihood < 0.75 &&
    duration < 0.4
  ) {
    reasons.push("UNREPAIRABLE_SINGLE_CHARACTER_FRAGMENT");
  }
  return reasons;
}

function evidenceForCue(input: {
  cue: SubtitleCue;
  terminology?: TerminologyEvidenceArtifact;
  semantic?: SemanticCandidateValidationArtifact;
}): CueCandidateEvidence {
  const cue = input.cue;
  const japanese = analyzeJapaneseText(cue.text);
  const acoustic = acousticSupport(cue);
  const independentSupport = cue.provenance?.independentSupportCount ?? 0;
  const profileConsensus = Math.min(
    1,
    Math.max(independentSupport, cue.provenance?.sourceProfileIds.length ?? 0) /
      2,
  );
  const speech = speechCoverage(cue);
  const tokenTiming =
    cue.timingEvidence?.tokenTimestampsUsed === true
      ? 1
      : cue.timingEvidence?.tokenTimestampsAvailable === true
        ? 0.65
        : 0.25;
  const japaneseCompleteness = Math.max(
    0,
    1 -
      (japanese.startsMidWord ? 0.35 : 0) -
      (japanese.endsMidWord ? 0.35 : 0) -
      (japanese.likelyIncompleteClause ? 0.2 : 0),
  );
  const terminology =
    input.terminology?.cueEvidence.find(
      (entry) => entry.cueId === cue.id || entry.cueId === sourceCueId(cue.id),
    )?.supportScore ?? 0;
  const semantic = input.semantic?.results.find(
    (entry) =>
      entry.candidateCueId === cue.id ||
      entry.candidateCueId === sourceCueId(cue.id),
  );
  const semanticScore = semantic?.semanticSimilarity ?? null;
  const repetitionRisk = /(.{2,})\1{2,}/u.test(normalizeText(cue.text))
    ? 0.9
    : 0.05;
  const hallucinationRisk = Math.min(
    1,
    (cue.transcriptionMetrics?.noSpeechProbability ?? 0) * 0.7 +
      repetitionRisk * 0.3,
  );
  const fragmentRisk = Math.min(
    1,
    (japanese.singleCharacter ? 0.5 : 0) +
      (japanese.startsMidWord ? 0.25 : 0) +
      (japanese.endsMidWord ? 0.25 : 0),
  );
  const totalScore = Math.max(
    0,
    Math.min(
      1,
      acoustic * 0.28 +
        profileConsensus * 0.13 +
        speech * 0.13 +
        tokenTiming * 0.09 +
        japaneseCompleteness * 0.17 +
        terminology * 0.05 +
        (semanticScore ?? 0.5) * 0.05 +
        (1 - repetitionRisk) * 0.04 +
        (1 - hallucinationRisk) * 0.03 +
        (1 - fragmentRisk) * 0.03,
    ),
  );
  const priority = provenancePriority(cue);
  const selectionScore =
    priority === 1
      ? Math.max(0.99, totalScore)
      : totalScore * 0.9 + priority * 0.1;
  const blocks = hardBlockReasons(cue);
  return {
    cueId: cue.id,
    interval: { start: cue.start, end: cue.end },
    text: cue.text,
    sourceCueIds: cue.provenance?.sourceRequestIds.length
      ? cue.provenance.sourceRequestIds
      : [cue.id],
    sourceRequestIds: provenanceArray(cue, "sourceRequestIds"),
    sourceProfileIds: provenanceArray(cue, "sourceProfileIds"),
    referenceAnchorIds: provenanceArray(cue, "referenceAnchorIds"),
    referenceUnitIds: provenanceArray(cue, "referenceUnitIds"),
    recoveryUnitId: cue.provenance?.recoveryUnitId ?? null,
    sceneId: cue.provenance?.sceneId ?? null,
    sceneLabel:
      cue.provenance?.sceneLabel === undefined
        ? null
        : (cue.provenance.sceneLabel as CueCandidateEvidence["sceneLabel"]),
    acousticSupport: acoustic,
    independentSupportCount: independentSupport,
    profileConsensus,
    speechCoverage: speech,
    tokenTimingQuality: tokenTiming,
    japaneseTextCompleteness: japaneseCompleteness,
    terminologySupport: terminology,
    referenceTimingSupport:
      (cue.provenance?.referenceAnchorIds.length ?? 0) > 0 ? 0.9 : 0,
    referenceSemanticSupport: semanticScore,
    repetitionRisk,
    hallucinationRisk,
    fragmentRisk,
    totalScore,
    selectionScore: Math.max(0, Math.min(1, selectionScore)),
    provenancePriority: priority,
    selectionEligible: blocks.length === 0,
    hardBlockReasons: blocks,
    reasons: [
      `acoustic-support:${acoustic.toFixed(3)}`,
      `japanese-completeness:${japaneseCompleteness.toFixed(3)}`,
      `independent-support:${String(independentSupport)}`,
      `provenance-priority:${priority.toFixed(3)}`,
    ],
  };
}

function alternativesCompatible(
  left: SubtitleCue,
  right: SubtitleCue,
): boolean {
  if ((left.style ?? "default") !== (right.style ?? "default")) return false;
  const leftDuration = left.end - left.start;
  const rightDuration = right.end - right.start;
  const nearSameBoundary =
    Math.abs(left.start - right.start) <= 0.9 &&
    Math.abs(left.end - right.end) <= 1.4;
  const significantOverlap = overlapRatio(left, right) >= 0.62;
  const centerCompatible =
    Math.abs(center(left) - center(right)) <=
    Math.max(1.4, Math.min(leftDuration, rightDuration) * 0.45);
  if (!nearSameBoundary && !(significantOverlap && centerCompatible))
    return false;
  if (Math.max(left.end, right.end) - Math.min(left.start, right.start) > 15) {
    return false;
  }
  const leftAnchors = provenanceArray(left, "referenceAnchorIds");
  const rightAnchors = provenanceArray(right, "referenceAnchorIds");
  if (
    leftAnchors.length > 0 &&
    rightAnchors.length > 0 &&
    intersection(leftAnchors, rightAnchors).length === 0
  ) {
    return false;
  }
  const leftLength = Math.max(1, normalizeText(left.text).length);
  const rightLength = Math.max(1, normalizeText(right.text).length);
  const lengthRatio =
    Math.min(leftLength, rightLength) / Math.max(leftLength, rightLength);
  return lengthRatio >= 0.34 || similarity(left.text, right.text) >= 0.55;
}

function temporalDistance(left: SubtitleCue, right: SubtitleCue): number {
  return (
    Math.abs(left.start - right.start) +
    Math.abs(left.end - right.end) +
    Math.abs(center(left) - center(right))
  );
}

function medoid(cues: readonly SubtitleCue[]): SubtitleCue {
  const result = [...cues].toSorted((left, right) => {
    const leftDistance = cues.reduce(
      (sum, cue) => sum + temporalDistance(left, cue),
      0,
    );
    const rightDistance = cues.reduce(
      (sum, cue) => sum + temporalDistance(right, cue),
      0,
    );
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  })[0];
  if (result === undefined) {
    throw new Error("Cannot choose a medoid from an empty cue collection");
  }
  return result;
}

function legacyCandidateIndexes(cues: readonly SubtitleCue[]): number[][] {
  const adjacency = cues.map(() => new Set<number>());
  for (let left = 0; left < cues.length; left += 1) {
    for (let right = left + 1; right < cues.length; right += 1) {
      const leftCue = cues[left];
      const rightCue = cues[right];
      if (leftCue === undefined || rightCue === undefined) continue;
      const near =
        Math.abs(leftCue.start - rightCue.start) <= 0.8 &&
        Math.abs(leftCue.end - rightCue.end) <= 1.2;
      const shared =
        intersection(
          provenanceArray(leftCue, "referenceAnchorIds"),
          provenanceArray(rightCue, "referenceAnchorIds"),
        ).length > 0 ||
        intersection(
          provenanceArray(leftCue, "referenceUnitIds"),
          provenanceArray(rightCue, "referenceUnitIds"),
        ).length > 0 ||
        (leftCue.provenance?.recoveryUnitId !== null &&
          leftCue.provenance?.recoveryUnitId !== undefined &&
          leftCue.provenance.recoveryUnitId ===
            rightCue.provenance?.recoveryUnitId);
      if (
        near ||
        (overlapRatio(leftCue, rightCue) >= 0.65 &&
          (shared || similarity(leftCue.text, rightCue.text) >= 0.35))
      ) {
        adjacency[left]?.add(right);
        adjacency[right]?.add(left);
      }
    }
  }
  const visited = new Set<number>();
  const output: number[][] = [];
  for (let index = 0; index < cues.length; index += 1) {
    if (visited.has(index)) continue;
    const stack = [index];
    const component: number[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      for (const neighbor of adjacency[current] ?? []) stack.push(neighbor);
    }
    output.push(component);
  }
  return output;
}

function sourceCueId(atomId: string): string {
  return atomId.replace(/::atom-\d+$/u, "");
}

export function buildAtomicHypothesisClusters(input: {
  cues: readonly SubtitleCue[];
  sourceCues?: readonly SubtitleCue[];
  compoundCueIds?: ReadonlySet<string>;
}): AtomicHypothesisClustersArtifact {
  const maximumAtomicSpanSeconds = 15;
  const ordinary = input.cues
    .filter((cue) => !input.compoundCueIds?.has(cue.id))
    .toSorted(
      (left, right) =>
        center(left) - center(right) ||
        left.start - right.start ||
        left.id.localeCompare(right.id),
    );
  const grouped: SubtitleCue[][] = [];
  for (const cue of ordinary) {
    const candidates = grouped
      .map((cluster, index) => {
        const representative = medoid(cluster);
        const compatibleMembers = cluster.filter((member) =>
          alternativesCompatible(member, cue),
        ).length;
        const majority = compatibleMembers / Math.max(1, cluster.length);
        const span =
          Math.max(cue.end, ...cluster.map((member) => member.end)) -
          Math.min(cue.start, ...cluster.map((member) => member.start));
        return {
          index,
          compatible:
            alternativesCompatible(representative, cue) &&
            majority >= 0.6 &&
            span <= maximumAtomicSpanSeconds,
          score:
            overlapRatio(representative, cue) * 2 -
            temporalDistance(representative, cue) * 0.05 +
            similarity(representative.text, cue.text) * 0.25,
        };
      })
      .filter((candidate) => candidate.compatible)
      .toSorted(
        (left, right) => right.score - left.score || left.index - right.index,
      );
    const target = candidates[0];
    if (target === undefined) grouped.push([cue]);
    else grouped[target.index]?.push(cue);
  }
  for (const cue of input.cues.filter((candidate) =>
    input.compoundCueIds?.has(candidate.id),
  )) {
    const target = grouped
      .map((cluster, index) => ({
        index,
        overlap: overlapSeconds(cue, {
          start: Math.min(...cluster.map((member) => member.start)),
          end: Math.max(...cluster.map((member) => member.end)),
        }),
      }))
      .filter((entry) => entry.overlap > 0)
      .toSorted(
        (left, right) =>
          right.overlap - left.overlap || left.index - right.index,
      )[0];
    if (target === undefined) grouped.push([cue]);
    else grouped[target.index]?.push(cue);
  }

  const sourceCues = input.sourceCues ?? input.cues;
  const legacy = legacyCandidateIndexes(sourceCues);
  const legacyIdBySource = new Map<string, string>();
  legacy.forEach((indexes, index) => {
    const id = `hypothesis-cluster-${String(index + 1).padStart(4, "0")}`;
    for (const sourceIndex of indexes) {
      const cue = sourceCues[sourceIndex];
      if (cue !== undefined) legacyIdBySource.set(cue.id, id);
    }
  });
  const clusters: AtomicHypothesisCluster[] = grouped
    .map((members, index) => {
      const representative = medoid(members);
      const anchors = [
        ...new Set(
          members.flatMap((cue) => provenanceArray(cue, "referenceAnchorIds")),
        ),
      ];
      const units = [
        ...new Set(
          members.flatMap((cue) => provenanceArray(cue, "referenceUnitIds")),
        ),
      ];
      const sourceLegacyClusterIds = [
        ...new Set(
          members.flatMap((cue) => {
            const legacyId = legacyIdBySource.get(sourceCueId(cue.id));
            return legacyId === undefined ? [] : [legacyId];
          }),
        ),
      ];
      const allNearDuplicate = members.every(
        (cue) =>
          cue.id === representative.id ||
          similarity(cue.text, representative.text) >= 0.72,
      );
      const clusterReason: AtomicHypothesisCluster["clusterReason"] =
        members.length === 1
          ? "singleton"
          : anchors.length > 0 && allNearDuplicate
            ? "mixed"
            : anchors.length > 0
              ? "reference-anchor"
              : allNearDuplicate
                ? "near-duplicate-text"
                : "temporal-medoid";
      return {
        id: `atomic-hypothesis-cluster-${String(index + 1).padStart(4, "0")}`,
        interval: {
          start: Math.min(...members.map((cue) => cue.start)),
          end: Math.max(...members.map((cue) => cue.end)),
        },
        candidateCueIds: members.map((cue) => cue.id).toSorted(),
        medoidCueId: representative.id,
        referenceAnchorIds: anchors,
        referenceUnitIds: units,
        sourceRequestIds: [
          ...new Set(
            members.flatMap((cue) => provenanceArray(cue, "sourceRequestIds")),
          ),
        ],
        clusterReason,
        sourceLegacyClusterIds,
        evidence: [
          `candidate-count:${String(members.length)}`,
          `medoid:${representative.id}`,
          "candidate-compatible-with-medoid",
          "majority-complete-linkage-constraint",
          "shared-reference-unit-alone-disabled",
        ],
      };
    })
    .toSorted(
      (left, right) =>
        left.interval.start - right.interval.start ||
        left.interval.end - right.interval.end ||
        left.id.localeCompare(right.id),
    )
    .map((cluster, index) => ({
      ...cluster,
      id: `atomic-hypothesis-cluster-${String(index + 1).padStart(4, "0")}`,
    }));
  const atomicIdsByLegacy = new Map<string, Set<string>>();
  for (const cluster of clusters) {
    for (const legacyId of cluster.sourceLegacyClusterIds) {
      const ids = atomicIdsByLegacy.get(legacyId) ?? new Set<string>();
      ids.add(cluster.id);
      atomicIdsByLegacy.set(legacyId, ids);
    }
  }
  return atomicHypothesisClustersArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash(input.cues),
    configuration: {
      method: "constrained-medoid",
      maximumBoundaryDistanceSeconds: 1.4,
      minimumTemporalOverlapRatio: 0.62,
      maximumAtomicSpanSeconds,
      majorityCompatibilityRatio: 0.6,
      sharedReferenceUnitAloneConnectsCandidates: false,
    },
    clusters,
    summary: {
      candidateCount: input.cues.length,
      atomicClusterCount: clusters.length,
      singletonClusterCount: clusters.filter(
        (cluster) => cluster.candidateCueIds.length === 1,
      ).length,
      splitLegacyClusterCount: [...atomicIdsByLegacy.values()].filter(
        (ids) => ids.size > 1,
      ).length,
    },
    fallback: null,
  });
}

function compareEvidence(
  left: CueCandidateEvidence,
  right: CueCandidateEvidence,
): number {
  const descending = (
    leftValue: number | undefined,
    rightValue: number | undefined,
  ) => (rightValue ?? 0) - (leftValue ?? 0);
  return (
    descending(left.selectionScore, right.selectionScore) ||
    descending(left.totalScore, right.totalScore) ||
    descending(left.independentSupportCount, right.independentSupportCount) ||
    descending(left.acousticSupport, right.acousticSupport) ||
    descending(left.speechCoverage, right.speechCoverage) ||
    descending(left.tokenTimingQuality, right.tokenTimingQuality) ||
    descending(left.japaneseTextCompleteness, right.japaneseTextCompleteness) ||
    descending(left.terminologySupport, right.terminologySupport) ||
    left.hallucinationRisk - right.hallucinationRisk ||
    left.fragmentRisk - right.fragmentRisk ||
    left.repetitionRisk - right.repetitionRisk ||
    left.cueId.localeCompare(right.cueId)
  );
}

export function buildCueCandidateEvidence(input: {
  cues: readonly SubtitleCue[];
  mode?: ArtifactHypothesisResolutionMode;
  terminology?: TerminologyEvidenceArtifact;
  semantic?: SemanticCandidateValidationArtifact;
}): CueCandidateEvidenceArtifact {
  return cueCandidateEvidenceArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash(input.cues),
    configuration: {
      mode: "top-score",
      runtimeMode: "top-score",
      scoreGapReviewThreshold: SCORE_GAP_REVIEW_THRESHOLD,
    },
    candidates: input.cues.map((cue) =>
      evidenceForCue({
        cue,
        ...(input.terminology === undefined
          ? {}
          : { terminology: input.terminology }),
        ...(input.semantic === undefined ? {} : { semantic: input.semantic }),
      }),
    ),
    fallback:
      input.mode === "conservative" || input.mode === "balanced"
        ? `deprecated-${input.mode}-mapped-to-top-score`
        : null,
  });
}

export function resolveCompetingHypotheses(input: {
  cues: readonly SubtitleCue[];
  evidenceCues?: readonly SubtitleCue[];
  mode?: ArtifactHypothesisResolutionMode;
  terminology?: TerminologyEvidenceArtifact;
  semantic?: SemanticCandidateValidationArtifact;
  referenceTimeline?: ReferenceTimelineArtifact;
  precomputedEvidence?: CueCandidateEvidenceArtifact;
}): CompetingHypothesisResolutionResult {
  // `cues` is the current final-candidate set and must never disappear merely
  // because callers supplied a broader (or disjoint) evidence set. Evidence
  // wins on duplicate IDs because it normally carries richer ASR metadata.
  const sourceEvidenceCues = [
    ...new Map(
      [...input.cues, ...(input.evidenceCues ?? [])].map((cue) => [
        cue.id,
        cue,
      ]),
    ).values(),
  ];
  const atomized = atomizeHypothesisCandidates(sourceEvidenceCues, {
    ...(input.referenceTimeline === undefined
      ? {}
      : { referenceTimeline: input.referenceTimeline }),
  });
  const computedEvidence = buildCueCandidateEvidence({
    cues: atomized.cues,
    mode: input.mode ?? "top-score",
    ...(input.terminology === undefined
      ? {}
      : { terminology: input.terminology }),
    ...(input.semantic === undefined ? {} : { semantic: input.semantic }),
  });
  const atomById = new Map(atomized.cues.map((cue) => [cue.id, cue]));
  const precomputedById = new Map(
    (input.precomputedEvidence?.candidates ?? []).map((candidate) => [
      candidate.cueId,
      candidate,
    ]),
  );
  const candidateEvidence =
    input.precomputedEvidence === undefined
      ? computedEvidence
      : cueCandidateEvidenceArtifactSchema.parse({
          ...computedEvidence,
          inputHash: hash({
            atomizedCues: atomized.cues,
            precomputedInputHash: input.precomputedEvidence.inputHash,
          }),
          candidates: computedEvidence.candidates.map((computed) => {
            const cached = precomputedById.get(computed.cueId);
            const cue = atomById.get(computed.cueId);
            if (cached === undefined || cue === undefined) return computed;
            const priority = provenancePriority(cue);
            const blocks = hardBlockReasons(cue);
            return {
              ...cached,
              independentSupportCount:
                cue.provenance?.independentSupportCount ??
                cached.independentSupportCount ??
                Math.round(cached.profileConsensus * 2),
              selectionScore:
                priority === 1
                  ? Math.max(0.99, cached.totalScore)
                  : Math.min(1, cached.totalScore * 0.9 + priority * 0.1),
              provenancePriority: priority,
              selectionEligible: blocks.length === 0,
              hardBlockReasons: blocks,
              reasons: [
                ...cached.reasons,
                "cached-candidate-evidence-replayed",
                `provenance-priority:${priority.toFixed(3)}`,
              ],
            };
          }),
          fallback:
            "precomputed-candidate-evidence-replayed-with-top-score-policy",
        });
  const evidenceById = new Map(
    candidateEvidence.candidates.map((candidate) => [
      candidate.cueId,
      candidate,
    ]),
  );
  const cueById = new Map(atomized.cues.map((cue) => [cue.id, cue]));
  const atomicClusters = buildAtomicHypothesisClusters({
    cues: atomized.cues,
    sourceCues: sourceEvidenceCues,
    compoundCueIds: atomized.compoundCueIds,
  });
  const records: TopScoreResolutionArtifact["resolutions"] = [];
  const winners: SubtitleCue[] = [];
  for (const cluster of atomicClusters.clusters) {
    const ranked = cluster.candidateCueIds
      .map((id) => evidenceById.get(id))
      .filter(
        (candidate): candidate is CueCandidateEvidence =>
          candidate !== undefined,
      )
      .filter((candidate) => candidate.selectionEligible !== false)
      .toSorted(compareEvidence);
    const winner = ranked[0];
    const runnerUp = ranked[1];
    const allCandidates = cluster.candidateCueIds
      .map((id) => evidenceById.get(id))
      .filter(
        (candidate): candidate is CueCandidateEvidence =>
          candidate !== undefined,
      );
    const blockReasons = [
      ...new Set(
        allCandidates.flatMap((candidate) => candidate.hardBlockReasons ?? []),
      ),
    ];
    const scoreGap =
      winner === undefined || runnerUp === undefined
        ? null
        : Math.max(
            0,
            (winner.selectionScore ?? winner.totalScore) -
              (runnerUp.selectionScore ?? runnerUp.totalScore),
          );
    const reviewReasons: string[] = [];
    if (scoreGap !== null && scoreGap < SCORE_GAP_REVIEW_THRESHOLD) {
      reviewReasons.push("TOP_SCORE_GAP_BELOW_REVIEW_THRESHOLD");
    }
    if (winner !== undefined && winner.profileConsensus < 1) {
      reviewReasons.push("SINGLE_PROFILE_OR_LIMITED_INDEPENDENT_SUPPORT");
    }
    if (input.semantic?.method === "unavailable") {
      reviewReasons.push("SEMANTIC_VALIDATOR_UNAVAILABLE");
    }
    const tieBreakApplied =
      winner !== undefined &&
      runnerUp !== undefined &&
      Math.abs(
        (winner.selectionScore ?? winner.totalScore) -
          (runnerUp.selectionScore ?? runnerUp.totalScore),
      ) < 1e-12;
    const record = {
      clusterId: cluster.id,
      candidateCueIds: cluster.candidateCueIds,
      winnerCueId: winner?.cueId ?? null,
      winnerScore: winner?.selectionScore ?? winner?.totalScore ?? null,
      runnerUpCueId: runnerUp?.cueId ?? null,
      runnerUpScore: runnerUp?.selectionScore ?? runnerUp?.totalScore ?? null,
      scoreGap,
      rejectedCueIds: allCandidates
        .filter((candidate) => candidate.cueId !== winner?.cueId)
        .map((candidate) => candidate.cueId),
      hardBlockReasons: winner === undefined ? blockReasons : [],
      reviewRecommended: winner !== undefined && reviewReasons.length > 0,
      reviewReasons,
      tieBreakApplied,
      tieBreakReasons: tieBreakApplied
        ? ["selection-score-tie-resolved-by-deterministic-tie-break-order"]
        : [],
    } satisfies TopScoreResolutionArtifact["resolutions"][number];
    records.push(record);
    if (winner !== undefined) {
      const cue = cueById.get(winner.cueId);
      if (cue !== undefined) {
        winners.push({
          ...cue,
          textAudit: {
            rawAsrText: cue.textAudit?.rawAsrText ?? cue.text,
            repairedText: cue.textAudit?.repairedText ?? cue.text,
            normalizedText: cue.textAudit?.normalizedText ?? cue.text,
            winnerClusterIds: [cluster.id],
            sourceWinnerCueIds: [winner.cueId],
            winnerScore: record.winnerScore,
            runnerUpCueId: record.runnerUpCueId,
            runnerUpScore: record.runnerUpScore,
            scoreGap,
            replacements: cue.textAudit?.replacements ?? [],
            deduplicationActions: cue.textAudit?.deduplicationActions ?? [],
            reviewRecommended: record.reviewRecommended,
            reviewReasons,
          },
        });
      }
    }
  }
  const sortedWinners = winners.toSorted(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.id.localeCompare(right.id),
  );
  const topScoreResolution = topScoreResolutionArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash({
      clusters: atomicClusters.clusters,
      candidates: candidateEvidence.candidates,
      mode: "top-score",
      scoreGapReviewThreshold: SCORE_GAP_REVIEW_THRESHOLD,
    }),
    configuration: {
      mode: "top-score",
      scoreGapReviewThreshold: SCORE_GAP_REVIEW_THRESHOLD,
      deterministicTieBreakOrder: [...TIE_BREAK_ORDER],
    },
    resolutions: records,
    summary: {
      atomicClusterCount: records.length,
      winnerCount: records.filter((record) => record.winnerCueId !== null)
        .length,
      noWinnerCount: records.filter((record) => record.winnerCueId === null)
        .length,
      lowScoreGapWinnerCount: records.filter(
        (record) =>
          record.scoreGap !== null &&
          record.scoreGap < SCORE_GAP_REVIEW_THRESHOLD,
      ).length,
      reviewRecommendedWinnerCount: records.filter(
        (record) => record.reviewRecommended,
      ).length,
    },
    fallback:
      input.mode === "conservative" || input.mode === "balanced"
        ? `deprecated-${input.mode}-mapped-to-top-score`
        : null,
  });
  const topScoreWinners = topScoreWinnersArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash({
      resolutions: topScoreResolution.resolutions,
      winners: sortedWinners.map((cue) => cue.id),
    }),
    winnerCount: sortedWinners.length,
    winners: sortedWinners,
    records,
  });
  const clusters = hypothesisClustersArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: atomicClusters.generatedAt,
    inputHash: atomicClusters.inputHash,
    configuration: {
      maximumBoundaryDistanceSeconds: 1.4,
      minimumNearDuplicateSimilarity: 0.72,
      clusteringMethod: "constrained-medoid",
      maximumAtomicSpanSeconds: 15,
    },
    clusters: atomicClusters.clusters.map((cluster) => ({
      id: cluster.id,
      interval: cluster.interval,
      candidateCueIds: cluster.candidateCueIds,
      referenceAnchorIds: cluster.referenceAnchorIds,
      sourceRequestIds: cluster.sourceRequestIds,
      clusterReason:
        cluster.clusterReason === "singleton" ||
        cluster.clusterReason === "temporal-medoid"
          ? "temporal-overlap"
          : cluster.clusterReason === "reference-anchor"
            ? "same-reference-unit"
            : cluster.clusterReason,
      evidence: cluster.evidence,
      atomic: true,
      medoidCueId: cluster.medoidCueId,
      sourceLegacyClusterIds: cluster.sourceLegacyClusterIds,
    })),
    fallback: null,
  });
  const resolution = hypothesisResolutionArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: topScoreResolution.generatedAt,
    inputHash: topScoreResolution.inputHash,
    configuration: {
      mode: "top-score",
      runtimeMode: "top-score",
      selectionMargin: null,
      scoreGapReviewThreshold: SCORE_GAP_REVIEW_THRESHOLD,
    },
    resolutions: records.map((record) => ({
      clusterId: record.clusterId,
      candidateCueIds: record.candidateCueIds,
      selectedCueIds: record.winnerCueId === null ? [] : [record.winnerCueId],
      rejectedCueIds: record.rejectedCueIds,
      decision:
        record.winnerCueId === null ? "review-unresolved" : "accept-one",
      winningMargin: record.scoreGap,
      winnerCueId: record.winnerCueId,
      winnerScore: record.winnerScore,
      runnerUpCueId: record.runnerUpCueId,
      runnerUpScore: record.runnerUpScore,
      scoreGap: record.scoreGap,
      reviewRecommended: record.reviewRecommended,
      reviewReasons: record.reviewReasons,
      tieBreakApplied: record.tieBreakApplied,
      tieBreakReasons: record.tieBreakReasons,
      reasons:
        record.winnerCueId === null
          ? ["all-candidates-hit-hard-block"]
          : [
              "top-score-winner-selected-for-atomic-cluster",
              ...(winners.find((cue) => cue.id === record.winnerCueId)
                ?.provenance?.sourceLayer === "reference-original-language"
                ? ["trusted-reference-original-language-outranks-lyrics-asr"]
                : []),
              ...(record.reviewRecommended
                ? ["score-or-evidence-risk-retained-as-review-only"]
                : []),
            ],
    })),
    unresolvedIntervals: records.flatMap((record) => {
      if (record.winnerCueId !== null) return [];
      const cluster = atomicClusters.clusters.find(
        (candidate) => candidate.id === record.clusterId,
      );
      return cluster === undefined
        ? []
        : [
            {
              ...cluster.interval,
              clusterId: cluster.id,
              candidateCueIds: cluster.candidateCueIds,
              reasons: record.hardBlockReasons.length
                ? record.hardBlockReasons
                : ["no-selection-eligible-candidate"],
            },
          ];
    }),
    fallback: topScoreResolution.fallback,
  });
  return {
    cues: sortedWinners,
    candidateEvidence,
    clusters,
    resolution,
    atomization: atomized.artifact,
    atomicClusters,
    topScoreResolution,
    topScoreWinners,
  };
}
