import {
  c60113MissingSpeechEvidenceSchema,
  machineVadGlobalTimebaseSchema,
  type C60113EvidenceFamilyGraph,
  type C60113EvidenceObservation,
  type C60113Interval,
  type C60113MissingClassification,
  type C60113MissingGap,
  type C60113MissingSpeechEvidence,
  type C60113ReviewPolicy,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  assertC60112MachineOnlyInput,
  type C60112ReviewItem,
} from "./c60112-policy.js";
import { type C60112ReviewCandidateBundle } from "./review-candidate-bundle.js";
import {
  c60113ArtifactHeader,
  uniqueC60113,
  withC60113SemanticHash,
} from "./c60113-policy.js";
import {
  c60113CorrelationGroups,
  c60113IndependentEvidenceGroups,
  c60113IndependentFamilies,
  c60113Observation,
  c60113Record,
  c60113Records,
  type C60113RawArtifacts,
} from "./review-evidence-family-graph.js";
import {
  c60113IntervalOverlap,
  c60113UniqueAudioSeconds,
} from "./review-playback-timeline.js";

export interface C60113FinalCueInterval extends C60113Interval {
  id: string;
}
export interface C60113GapInput {
  gapId: string;
  sourceInterval: C60113Interval;
  itemIds: string[];
  legacySignal: boolean;
  validatedSourceGlobal: boolean;
  cueCoveredRatio: number;
}

function intersection(
  left: C60113Interval,
  right: C60113Interval,
): C60113Interval | null {
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return end > start ? { start, end } : null;
}

export function prepareC60113MissingEvidence(input: {
  items: readonly C60112ReviewItem[];
  candidateBundles: readonly C60112ReviewCandidateBundle[];
  finalCues: readonly C60113FinalCueInterval[];
  rawArtifacts: C60113RawArtifacts;
  sourceDurationSeconds: number;
  expectedSourceMediaSha256?: string;
  policy: C60113ReviewPolicy;
}): { gaps: C60113GapInput[]; observations: C60113EvidenceObservation[] } {
  assertC60112MachineOnlyInput({
    items: input.items,
    candidates: input.candidateBundles,
    cues: input.finalCues,
  });
  const gaps: C60113GapInput[] = [];
  const observations: C60113EvidenceObservation[] = [];
  const legacyItems = input.items.filter((item) =>
    item.itemTypes.includes("MISSING_SPEECH_RISK"),
  );
  const vadParsed = machineVadGlobalTimebaseSchema.safeParse(
    input.rawArtifacts.vadTimebase,
  );
  if (
    vadParsed.success &&
    vadParsed.data.sourceIdentity.sourceMediaSha256 !==
      input.expectedSourceMediaSha256
  ) {
    throw new Error("C60113_VAD_SOURCE_MEDIA_IDENTITY_MISMATCH");
  }
  const verifiedVad =
    vadParsed.success &&
    Math.abs(
      vadParsed.data.sourceIdentity.sourceTotalSamples /
        vadParsed.data.sourceIdentity.sourceSampleRate -
        input.sourceDurationSeconds,
    ) <= 0.001 &&
    vadParsed.data.sourceIdentity.sourceReadOnlyVerified
      ? vadParsed.data.vadSegments
          .filter(
            (segment) =>
              segment.mappingStatus === "VERIFIED" &&
              segment.sourceMediaSha256 === input.expectedSourceMediaSha256,
          )
          .map((segment) => ({
            id: segment.vadSegmentId,
            root: segment.requestId,
            hash: segment.timebaseSemanticHash,
            start:
              segment.sourceGlobalStartSample /
              vadParsed.data.sourceIdentity.sourceSampleRate,
            end:
              segment.sourceGlobalEndSample /
              vadParsed.data.sourceIdentity.sourceSampleRate,
          }))
          .filter(
            (segment) =>
              segment.start >= 0 &&
              segment.end > segment.start &&
              segment.end <= input.sourceDurationSeconds,
          )
      : [];
  const rawGaps = c60113Records(input.rawArtifacts.speechCoverage, "gaps");
  const pushGap = (
    gapId: string,
    interval: C60113Interval,
    itemIds: string[],
    legacySignal: boolean,
  ) => {
    if (
      !Number.isFinite(interval.start) ||
      !Number.isFinite(interval.end) ||
      interval.start < 0 ||
      interval.end <= interval.start ||
      interval.end > input.sourceDurationSeconds
    ) {
      throw new Error(`C60113_INVALID_GAP_TIMEBASE:${gapId}`);
    }
    const covering = input.finalCues
      .map((cue) => intersection(cue, interval))
      .filter((value): value is C60113Interval => value !== null);
    const cueCoveredRatio = Math.min(
      1,
      c60113UniqueAudioSeconds(covering) / (interval.end - interval.start),
    );
    const vad = verifiedVad.filter(
      (segment) => c60113IntervalOverlap(segment, interval) > 0,
    );
    const validatedSourceGlobal = vad.length > 0;
    gaps.push({
      gapId,
      sourceInterval: interval,
      itemIds: uniqueC60113(itemIds),
      legacySignal,
      validatedSourceGlobal,
      cueCoveredRatio,
    });
    for (const segment of vad) {
      const observedInterval = intersection(segment, interval);
      if (observedInterval === null) continue;
      observations.push(
        c60113Observation({
          evidenceId: `${gapId}:vad:${segment.id}`,
          rootLineageIds: [segment.root],
          family: "SPEECH_ACTIVITY",
          provider: "silero-vad",
          correlationGroup: `${gapId}:speech-vad`,
          itemIds,
          gapIds: [gapId],
          sourceInterval: observedInterval,
          positiveRisk: false,
          evidenceAbsence: false,
          contradiction: false,
          strength: 0.6,
          validatedSourceGlobal: true,
          detailCode: "VERIFIED_MAPPED_RAW_VAD_ACTIVITY",
        }),
      );
    }
    const coverageRoot = `canonical-cue-coverage:${machineQualitySemanticHash(input.finalCues)}`;
    observations.push(
      c60113Observation({
        evidenceId: `${gapId}:cue-coverage`,
        rootLineageIds: [coverageRoot],
        family: "CUE_COVERAGE",
        provider: "canonical-cue-timing",
        correlationGroup: `${gapId}:cue-coverage`,
        itemIds,
        gapIds: [gapId],
        sourceInterval: interval,
        positiveRisk: false,
        evidenceAbsence: false,
        contradiction:
          cueCoveredRatio >
          input.policy.missingSpeech.maximumCoveredRatioForMissing,
        // Coverage absence describes the gap; it is not an independent dialogue vote.
        strength:
          cueCoveredRatio >
          input.policy.missingSpeech.maximumCoveredRatioForMissing
            ? 1
            : 0,
        validatedSourceGlobal: true,
        detailCode:
          cueCoveredRatio >
          input.policy.missingSpeech.maximumCoveredRatioForMissing
            ? "EXISTING_CANONICAL_CUE_COVERS_GAP"
            : "CANONICAL_TIMING_GAP_ONLY",
      }),
    );
    if (!validatedSourceGlobal) {
      observations.push(
        c60113Observation({
          evidenceId: `${gapId}:unverified-legacy-activity`,
          rootLineageIds: [`legacy-speech-coverage:${gapId}`],
          family: "SPEECH_ACTIVITY",
          provider: "legacy-speech-coverage",
          correlationGroup: `${gapId}:speech-vad`,
          itemIds,
          gapIds: [gapId],
          sourceInterval: interval,
          positiveRisk: false,
          evidenceAbsence: true,
          contradiction: false,
          strength: 0,
          validatedSourceGlobal: false,
          detailCode: "LEGACY_GAP_LACKS_VERIFIED_SOURCE_GLOBAL_ACTIVITY",
        }),
      );
    }
    const bundles = input.candidateBundles.filter((bundle) =>
      itemIds.includes(bundle.reviewItemId),
    );
    const seenLexical = new Set<string>();
    for (const bundle of bundles) {
      for (const candidate of bundle.displayCandidates) {
        if (
          !candidate.displayText.trim() ||
          candidate.evidenceBadges.includes("HALLUCINATION_RISK")
        )
          continue;
        for (const provenance of candidate.provenance) {
          if (
            provenance.label === "CURRENT" ||
            provenance.sourceInterval === null ||
            seenLexical.has(provenance.candidateId)
          )
            continue;
          const overlap = c60113IntervalOverlap(
            provenance.sourceInterval,
            interval,
          );
          const candidateDuration =
            provenance.sourceInterval.end - provenance.sourceInterval.start;
          // Long extraction-window text is not localized lexical proof of a tiny gap.
          if (
            overlap / candidateDuration <
              input.policy.missingSpeech.lexicalMinimumIntervalCoverage ||
            overlap / (interval.end - interval.start) <
              input.policy.missingSpeech.lexicalMinimumIntervalCoverage
          )
            continue;
          if (!provenance.evidenceBadges.includes("LOCALIZATION_SAFE"))
            continue;
          seenLexical.add(provenance.candidateId);
          const provider =
            provenance.label === "REAZON" ? "reazon-data-family" : "whisper";
          const roots =
            provenance.provenanceIds.length > 0
              ? provenance.provenanceIds
              : provenance.evidenceIds;
          observations.push(
            c60113Observation({
              evidenceId: `${gapId}:lexical:${provenance.candidateId}`,
              rootLineageIds:
                roots.length > 0 ? roots : [provenance.candidateId],
              family: "ASR_LEXICAL_CONTENT",
              provider,
              correlationGroup: `${gapId}:${provider}`,
              itemIds,
              gapIds: [gapId],
              sourceInterval: provenance.sourceInterval,
              positiveRisk: true,
              evidenceAbsence: false,
              contradiction: false,
              strength: 0.65,
              validatedSourceGlobal: true,
              detailCode: "LOCALIZED_NONEMPTY_MACHINE_LEXICAL_CANDIDATE",
            }),
          );
        }
      }
    }
    const previous = input.finalCues
      .filter((cue) => cue.end <= interval.start)
      .toSorted((a, b) => b.end - a.end)[0];
    const next = input.finalCues
      .filter((cue) => cue.start >= interval.end)
      .toSorted((a, b) => a.start - b.start)[0];
    if (
      previous !== undefined &&
      next !== undefined &&
      interval.start - previous.end <= 0.75 &&
      next.start - interval.end <= 0.75 &&
      interval.end - interval.start <= 3
    ) {
      observations.push(
        c60113Observation({
          evidenceId: `${gapId}:neighbor-continuity`,
          rootLineageIds: [coverageRoot],
          family: "NEIGHBOR_CONTINUITY",
          provider: "canonical-neighbor-timing",
          correlationGroup: `${gapId}:cue-coverage`,
          itemIds,
          gapIds: [gapId],
          sourceInterval: interval,
          positiveRisk: false,
          evidenceAbsence: false,
          contradiction: false,
          strength: 0.4,
          validatedSourceGlobal: true,
          detailCode: "BOUNDED_GAP_BETWEEN_NEARBY_CANONICAL_CUES",
        }),
      );
    }
    for (const scene of c60113Records(
      input.rawArtifacts.acousticScenes,
      "scenes",
    )) {
      const sceneInterval = c60113Record(scene.interval);
      if (
        typeof sceneInterval.start !== "number" ||
        typeof sceneInterval.end !== "number"
      )
        continue;
      const overlap = c60113IntervalOverlap(
        { start: sceneInterval.start, end: sceneInterval.end },
        interval,
      );
      const confidence =
        typeof scene.confidence === "number" ? scene.confidence : 0;
      if (
        overlap / (interval.end - interval.start) < 0.5 ||
        confidence < input.policy.missingSpeech.strongContradictionThreshold ||
        (scene.label !== "singing" && scene.label !== "non-speech")
      )
        continue;
      observations.push(
        c60113Observation({
          evidenceId: `${gapId}:scene:${String(scene.id)}`,
          rootLineageIds: [`acoustic-scene:${String(scene.id)}`],
          family: "MUSIC_LYRICS_CONTRADICTION",
          provider: "acoustic-scene-analysis",
          correlationGroup: `${gapId}:acoustic-scene`,
          itemIds,
          gapIds: [gapId],
          sourceInterval: interval,
          positiveRisk: false,
          evidenceAbsence: false,
          contradiction: true,
          strength: confidence,
          validatedSourceGlobal: true,
          detailCode:
            scene.label === "singing"
              ? "STRONG_SINGING_SCENE_CONTRADICTION"
              : "STRONG_NON_SPEECH_SCENE_CONTRADICTION",
        }),
      );
    }
  };
  for (const raw of rawGaps) {
    if (
      typeof raw.id !== "string" ||
      typeof raw.start !== "number" ||
      typeof raw.end !== "number"
    )
      throw new Error("C60113_MALFORMED_LEGACY_SPEECH_GAP");
    const interval = { start: raw.start, end: raw.end };
    const members = legacyItems.filter(
      (item) => c60113IntervalOverlap(item.sourceInterval, interval) > 0.25,
    );
    pushGap(
      raw.id,
      interval,
      members.map((item) => item.reviewItemId),
      true,
    );
  }
  for (const item of legacyItems) {
    if (gaps.some((gap) => gap.itemIds.includes(item.reviewItemId))) continue;
    pushGap(
      `legacy-gap:${item.reviewItemId}`,
      item.coreInterval,
      [item.reviewItemId],
      true,
    );
  }
  return { gaps, observations };
}

export function reconcileC60113MissingGap(input: {
  gap: C60113GapInput;
  observations: readonly C60113EvidenceObservation[];
  policy: C60113ReviewPolicy;
}): C60113MissingGap {
  const evidence = input.observations.filter((entry) =>
    entry.gapIds.includes(input.gap.gapId),
  );
  const supported = evidence.filter(
    (entry) =>
      !entry.evidenceAbsence &&
      !entry.contradiction &&
      entry.strength > 0 &&
      entry.validatedSourceGlobal,
  );
  const observed = supported.filter(
    (entry) => entry.family === "SPEECH_ACTIVITY",
  );
  const lexical = supported.filter(
    (entry) => entry.family === "ASR_LEXICAL_CONTENT",
  );
  const contradiction = evidence.filter(
    (entry) =>
      entry.contradiction &&
      entry.strength >= input.policy.missingSpeech.strongContradictionThreshold,
  );
  const independent = c60113IndependentFamilies(supported);
  const independentGroups = c60113IndependentEvidenceGroups(supported);
  const observedIds = new Set(observed.map((entry) => entry.evidenceId));
  const lexicalIds = new Set(lexical.map((entry) => entry.evidenceId));
  const requiredIndependentTriple = independentGroups.some(
    (activityGroup) =>
      activityGroup.evidenceIds.some((id) => observedIds.has(id)) &&
      independentGroups.some(
        (lexicalGroup) =>
          lexicalGroup.groupId !== activityGroup.groupId &&
          lexicalGroup.evidenceIds.some((id) => lexicalIds.has(id)) &&
          independentGroups.some(
            (supportGroup) =>
              supportGroup.groupId !== activityGroup.groupId &&
              supportGroup.groupId !== lexicalGroup.groupId &&
              supportGroup.families.some(
                (family) =>
                  family !== "SPEECH_ACTIVITY" &&
                  family !== "ASR_LEXICAL_CONTENT",
              ),
          ),
      ),
  );
  const hasObserved = input.gap.validatedSourceGlobal && observed.length > 0;
  const allActivity = c60113UniqueAudioSeconds(
    observed
      .map((entry) => entry.sourceInterval)
      .filter((value): value is C60113Interval => value !== null),
  );
  const activityRatio =
    allActivity /
    (input.gap.sourceInterval.end - input.gap.sourceInterval.start);
  let classification: C60113MissingClassification = hasObserved
    ? "SPEECH_GAP_OBSERVED"
    : "MISSING_DIALOGUE_UNRESOLVED";
  const reasons: string[] = [];
  if (input.gap.legacySignal)
    reasons.push(
      "LEGACY_MISSING_SIGNAL_DEFAULT_MAPPED_TO_OBSERVED_BEFORE_RECONCILIATION",
    );
  if (
    contradiction.length > 0 ||
    input.gap.cueCoveredRatio >
      input.policy.missingSpeech.maximumCoveredRatioForMissing
  ) {
    classification = "MISSING_DIALOGUE_CONTRADICTED";
    reasons.push("STRONG_CONTRADICTION_OR_EXISTING_CUE_COVERAGE");
  } else if (
    hasObserved &&
    lexical.length > 0 &&
    requiredIndependentTriple &&
    independent.length >=
      input.policy.missingSpeech.minimumIndependentStrongFamilies &&
    activityRatio >= 0.5
  ) {
    classification = "MISSING_DIALOGUE_STRONG";
    reasons.push(
      "VALIDATED_UNCOVERED_ACTIVITY_LEXICAL_AND_INDEPENDENT_SUPPORT",
    );
  } else if (hasObserved && independent.length >= 2) {
    classification = "MISSING_DIALOGUE_POSSIBLE";
    reasons.push("OBSERVED_GAP_WITH_ADDITIONAL_INDEPENDENT_FAMILY");
  } else if (hasObserved) reasons.push("ACTIVITY_GAP_IS_NOT_DIALOGUE_PROOF");
  else
    reasons.push(
      "LEGACY_SIGNAL_ONLY_VERIFIED_SOURCE_GLOBAL_ACTIVITY_UNAVAILABLE",
    );
  if (lexical.length === 0)
    reasons.push("LOCALIZED_LEXICAL_SUPPORT_UNAVAILABLE");
  else if (!requiredIndependentTriple)
    reasons.push("INDEPENDENT_ACTIVITY_LEXICAL_SUPPORT_TRIPLE_UNAVAILABLE");
  if (
    independent.length <
    input.policy.missingSpeech.minimumIndependentStrongFamilies
  )
    reasons.push("INSUFFICIENT_INDEPENDENT_FAMILIES_FOR_STRONG");
  return withC60113SemanticHash({
    ...input.gap,
    legacyMappedClassification: input.gap.legacySignal
      ? ("SPEECH_GAP_OBSERVED" as const)
      : null,
    observedSpeechEvidence: observed
      .map((entry) => entry.evidenceId)
      .toSorted(),
    lexicalEvidence: lexical.map((entry) => entry.evidenceId).toSorted(),
    cueCoverageEvidence: evidence
      .filter((entry) => entry.family === "CUE_COVERAGE")
      .map((entry) => entry.evidenceId)
      .toSorted(),
    neighboringEvidence: evidence
      .filter((entry) => entry.family === "NEIGHBOR_CONTINUITY")
      .map((entry) => entry.evidenceId)
      .toSorted(),
    speakerEvidence: evidence
      .filter((entry) => entry.family === "SPEAKER_ACTIVITY")
      .map((entry) => entry.evidenceId)
      .toSorted(),
    contradictionEvidence: contradiction
      .map((entry) => entry.evidenceId)
      .toSorted(),
    evidenceFamilies: [
      ...new Set(evidence.map((entry) => entry.family)),
    ].toSorted(),
    independentFamilyCount: independent.length,
    correlatedEvidenceGroups: c60113CorrelationGroups(evidence),
    classification,
    reviewLevel:
      classification === "MISSING_DIALOGUE_STRONG"
        ? ("REQUIRED" as const)
        : classification === "MISSING_DIALOGUE_POSSIBLE"
          ? ("RECOMMENDED" as const)
          : ("INFORMATIONAL" as const),
    reasons,
  });
}

export function buildC60113MissingSpeechEvidence(input: {
  gaps: readonly C60113GapInput[];
  evidenceFamilies: C60113EvidenceFamilyGraph;
  legacyMissingItemCount: number;
  policy: C60113ReviewPolicy;
}): C60113MissingSpeechEvidence {
  const gaps = input.gaps
    .map((gap) =>
      reconcileC60113MissingGap({
        gap,
        observations: input.evidenceFamilies.evidence,
        policy: input.policy,
      }),
    )
    .toSorted(
      (a, b) =>
        a.sourceInterval.start - b.sourceInterval.start ||
        a.gapId.localeCompare(b.gapId),
    );
  return c60113MissingSpeechEvidenceSchema.parse(
    withC60113SemanticHash({
      ...c60113ArtifactHeader(input.policy),
      artifactType: "c6-0-1-13-machine-missing-speech-evidence-v2",
      gaps,
      summary: {
        gapCount: gaps.length,
        legacyMissingItemCount: input.legacyMissingItemCount,
        observedCount: gaps.filter(
          (gap) => gap.classification === "SPEECH_GAP_OBSERVED",
        ).length,
        possibleCount: gaps.filter(
          (gap) => gap.classification === "MISSING_DIALOGUE_POSSIBLE",
        ).length,
        strongCount: gaps.filter(
          (gap) => gap.classification === "MISSING_DIALOGUE_STRONG",
        ).length,
        contradictedCount: gaps.filter(
          (gap) => gap.classification === "MISSING_DIALOGUE_CONTRADICTED",
        ).length,
        unresolvedCount: gaps.filter(
          (gap) => gap.classification === "MISSING_DIALOGUE_UNRESOLVED",
        ).length,
        independentFamilyMean:
          gaps.length === 0
            ? 0
            : gaps.reduce((sum, gap) => sum + gap.independentFamilyCount, 0) /
              gaps.length,
        correlatedEvidenceDeduplicatedCount: gaps.reduce(
          (sum, gap) =>
            sum +
            gap.correlatedEvidenceGroups.reduce(
              (groupSum, group) => groupSum + group.evidenceIds.length - 1,
              0,
            ),
          0,
        ),
      },
    }),
  );
}
