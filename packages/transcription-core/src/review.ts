import {
  finalReviewQueueSchema,
  transcriptionTimingFindingsSchema,
  type AdaptiveRefinementRecord,
  type AsrCacheManifestArtifact,
  type CoverageRecoveryPlanArtifact,
  type CoverageRecoveryResultsArtifact,
  type FinalSubtitleRepairArtifact,
  type FinalReviewQueue,
  type FinalSubtitleIntegrityArtifact,
  type JapaneseLexicalNormalizationArtifact,
  type ReferenceClassificationReviewArtifact,
  type ReferenceCueClassificationArtifact,
  type ReviewEvent,
  type ReviewEventCategory,
  type ReviewCategory,
  type SubtitleCue,
  type TranscriptionFinding,
  type TranscriptionQuality,
  type TranscriptionTimingFindings,
  type TextIntegrityRepairArtifact,
} from "@mvl/shared";

interface Interval {
  start: number;
  end: number;
}

interface TimingRepairRecord {
  cueId: string;
  before: Interval;
  after: Interval;
  method: string;
  reasons: string[];
}

interface PresentationTimingRecord {
  sourceCueId: string;
  originalInterval: Interval;
  outputIntervals: Interval[];
  splitCount: number;
  timingMethod: string;
  characterRatioFallback: boolean;
  reasons: string[];
}

export interface ReviewQueueBuildInput {
  historicalQuality: TranscriptionQuality;
  postPresentationQuality: TranscriptionQuality;
  finalCues: readonly SubtitleCue[];
  refinementRecord?: AdaptiveRefinementRecord | undefined;
  timingRepairs?: readonly TimingRepairRecord[] | undefined;
  presentationTiming?: readonly PresentationTimingRecord[] | undefined;
  speechIntervals?: readonly Interval[] | undefined;
  sceneBoundaries?: readonly number[] | undefined;
  recoveryUnits?:
    | readonly {
        parentReviewGroupId: string;
        interval: Interval;
      }[]
    | undefined;
  finalIntegrity?: FinalSubtitleIntegrityArtifact | undefined;
  textIntegrityRepair?: TextIntegrityRepairArtifact | undefined;
  subtitleIntegrityRepair?: FinalSubtitleRepairArtifact | undefined;
  coverageRecoveryPlan?: CoverageRecoveryPlanArtifact | undefined;
  coverageRecoveryResults?: CoverageRecoveryResultsArtifact | undefined;
  referenceClassificationReview?:
    ReferenceClassificationReviewArtifact | undefined;
  referenceClassification?: ReferenceCueClassificationArtifact | undefined;
  japaneseNormalization?: JapaneseLexicalNormalizationArtifact | undefined;
  asrCacheManifest?: AsrCacheManifestArtifact | undefined;
  reviewGroupGapSeconds?: number | undefined;
  generatedAt?: string | undefined;
}

export interface ReviewQueueBuildResult {
  findings: TranscriptionTimingFindings;
  queue: FinalReviewQueue;
}

function reviewEvidenceForGroup(
  group: FinalReviewQueue["groups"][number],
  input: ReviewQueueBuildInput,
): NonNullable<FinalReviewQueue["groups"][number]["evidence"]> | null {
  const textIntegrityRepair = (input.textIntegrityRepair?.repairs ?? [])
    .filter(
      (repair) =>
        overlaps(repair.beforeInterval, group.interval) ||
        overlaps(repair.afterInterval, group.interval),
    )
    .map((repair) => repair.id);
  const subtitleIntegrityRepair = (input.subtitleIntegrityRepair?.repairs ?? [])
    .filter(
      (repair) =>
        overlaps(repair.beforeInterval, group.interval) ||
        repair.afterIntervals.some((interval) =>
          overlaps(interval, group.interval),
        ),
    )
    .map((repair) => repair.id);
  const recoveryUnits = (input.coverageRecoveryPlan?.units ?? []).filter(
    (unit) => overlaps(unit.interval, group.interval),
  );
  const coverageRecovery = recoveryUnits.map((unit) => unit.id);
  const recoveryUnitIds = new Set(coverageRecovery);
  const targetedAsrAttempts = (input.coverageRecoveryResults?.results ?? [])
    .filter((result) => recoveryUnitIds.has(result.unitId))
    .flatMap((result) => result.requestIds);
  const targetedRequestIds = new Set(targetedAsrAttempts);
  const cacheHitType = [
    ...new Set(
      (input.asrCacheManifest?.entries ?? [])
        .filter((entry) => targetedRequestIds.has(entry.requestId))
        .map((entry) => entry.hitType),
    ),
  ];
  const normalizationCandidates = (input.japaneseNormalization?.cues ?? [])
    .filter(
      (cue) =>
        group.finalCueIds.includes(cue.cueId) ||
        group.finalCueIds.some((id) => id.startsWith(`${cue.cueId}-`)),
    )
    .map((cue) => cue.cueId);
  const reviewCueIds = new Set(
    (input.referenceClassificationReview?.entries ?? [])
      .filter((entry) => entry.reviewRequired)
      .map((entry) => entry.cueId),
  );
  const referenceClassification = (input.referenceClassification?.cues ?? [])
    .filter(
      (cue) =>
        reviewCueIds.has(cue.id) && overlaps(cue.interval, group.interval),
    )
    .map((cue) => cue.id);
  const evidence = {
    ...(textIntegrityRepair.length === 0 ? {} : { textIntegrityRepair }),
    ...(subtitleIntegrityRepair.length === 0
      ? {}
      : { subtitleIntegrityRepair }),
    ...(coverageRecovery.length === 0 ? {} : { coverageRecovery }),
    ...(targetedAsrAttempts.length === 0 ? {} : { targetedAsrAttempts }),
    ...(referenceClassification.length === 0
      ? {}
      : { referenceClassification }),
    ...(normalizationCandidates.length === 0
      ? {}
      : { normalizationCandidates }),
    ...(cacheHitType.length === 0 ? {} : { cacheHitType }),
  };
  return Object.keys(evidence).length === 0 ? null : evidence;
}

const NON_REVIEW_REFINEMENT_NOT_RUN_REASONS = new Set([
  "not-needed",
  "covered-by-neighbor",
  "covered-by-parent-refinement",
  "superseded",
  "duplicate-work",
  "timing-only-repair-sufficient",
]);

const MISSING_DIALOGUE_CODES = new Set([
  "vad-speech-empty-transcript",
  "speech-text-mismatch",
  "large-speech-text-mismatch",
  "unexplained-speech-gap",
  "empty-refinement",
]);

function overlaps(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

function overlapSeconds(left: Interval, right: Interval): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function covers(container: Interval, subject: Interval): number {
  return (
    overlapSeconds(container, subject) /
    Math.max(0.001, subject.end - subject.start)
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function categoryForCode(code: string): ReviewCategory {
  const normalized = code.toUpperCase();
  if (
    normalized.includes("PRESENTATION") ||
    normalized.includes("SPLIT_BOUNDARY") ||
    normalized.includes("CHARACTER_RATIO")
  ) {
    return "presentation";
  }
  if (
    normalized.includes("TIMING") ||
    normalized.includes("TIMESTAMP") ||
    normalized.includes("BOUNDARY") ||
    normalized.includes("OVERMERGE") ||
    normalized.includes("OVERLAP") ||
    normalized.includes("DURATION") ||
    normalized.includes("SILENCE") ||
    normalized.includes("SPEECH_RATIO") ||
    normalized.includes("TEXT_DENSITY") ||
    normalized.includes("CHARACTERS-PER-SECOND") ||
    normalized.includes("CPS")
  ) {
    return "timing";
  }
  return "text";
}

function finalCueIdsFor(
  finding: Pick<TranscriptionFinding, "interval" | "cueIds">,
  finalCues: readonly SubtitleCue[],
): string[] {
  const explicit = finding.cueIds ?? [];
  const directlyMapped = finalCues.filter(
    (cue) =>
      explicit.includes(cue.id) ||
      explicit.some((id) => cue.id.startsWith(`${id}-`)),
  );
  const mapped =
    directlyMapped.length > 0
      ? directlyMapped
      : finalCues.filter((cue) => overlaps(cue, finding.interval));
  return unique(mapped.map((cue) => cue.id));
}

function postStatusByCue(
  quality: TranscriptionQuality,
): Map<string, TranscriptionQuality["segments"][number]> {
  return new Map(
    quality.segments.flatMap((segment) =>
      segment.cueId === null ? [] : [[segment.cueId, segment] as const],
    ),
  );
}

function finalCuesPassQa(
  cueIds: readonly string[],
  postByCue: ReadonlyMap<string, TranscriptionQuality["segments"][number]>,
): boolean {
  return (
    cueIds.length > 0 &&
    cueIds.every((cueId) => {
      const segment = postByCue.get(cueId);
      return (
        segment !== undefined &&
        ["accepted", "accepted-after-refinement"].includes(segment.status)
      );
    })
  );
}

function selectedHypothesis(
  record: AdaptiveRefinementRecord["replacements"][number],
): TranscriptionFinding["selectedHypothesis"] {
  const selected = record.decision.selected;
  if (
    selected === "baseline" ||
    selected === "refinement" ||
    selected === "vad" ||
    selected === "no-vad"
  ) {
    return selected;
  }
  return "unknown";
}

function acceptedRefinement(
  record: AdaptiveRefinementRecord["replacements"][number],
): boolean {
  return (
    ["accepted", "accepted-after-refinement"].includes(
      record.decision.status ?? "",
    ) &&
    record.decision.stableConsensus !== false &&
    record.refinement.quality?.hardReject !== true &&
    record.refinement.text.trim() !== "" &&
    record.timingRepair?.after !== null
  );
}

function structurallyCoveringRefinement(input: {
  finding: Pick<TranscriptionFinding, "interval">;
  refinementRecord?: AdaptiveRefinementRecord | undefined;
}): string | null {
  const match = (input.refinementRecord?.replacements ?? [])
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record }) => covers(record.interval, input.finding.interval) >= 0.9,
    )
    .filter(({ record }) => acceptedRefinement(record))
    .at(-1);
  return match === undefined
    ? null
    : `refinement-${String(match.index + 1).padStart(4, "0")}`;
}

export function isFindingCoveredByRefinement(input: {
  finding: Pick<TranscriptionFinding, "interval" | "category" | "cueIds">;
  refinementRecord?: AdaptiveRefinementRecord | undefined;
  finalCues: readonly SubtitleCue[];
  postPresentationQuality: TranscriptionQuality;
  minimumCoverage?: number | undefined;
}): {
  covered: boolean;
  refinementId: string | null;
  selectedHypothesis: TranscriptionFinding["selectedHypothesis"];
} {
  const postByCue = postStatusByCue(input.postPresentationQuality);
  const mappedCueIds = finalCueIdsFor(input.finding, input.finalCues);
  const records = input.refinementRecord?.replacements ?? [];
  const match = records
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record }) =>
        covers(record.interval, input.finding.interval) >=
        (input.minimumCoverage ?? 0.9),
    )
    .filter(({ record }) => acceptedRefinement(record))
    .filter(({ record }) => {
      if (input.finding.category !== "text") return true;
      return selectedHypothesis(record) === "refinement";
    })
    .filter(() => finalCuesPassQa(mappedCueIds, postByCue))
    .at(-1);
  return match === undefined
    ? { covered: false, refinementId: null, selectedHypothesis: "unknown" }
    : {
        covered: true,
        refinementId: `refinement-${String(match.index + 1).padStart(4, "0")}`,
        selectedHypothesis: selectedHypothesis(match.record),
      };
}

function makeHistoricalFindings(
  quality: TranscriptionQuality,
): TranscriptionFinding[] {
  let index = 0;
  return quality.segments.flatMap((segment) => {
    if (segment.reasons.length === 0) return [];
    const nonMetaReasons = segment.reasons.filter(
      (reason) => reason !== "automatic-refinement-not-run",
    );
    const primaryReason =
      nonMetaReasons.find((reason) => MISSING_DIALOGUE_CODES.has(reason)) ??
      nonMetaReasons.find((reason) => reason === "large-v3-conflict") ??
      nonMetaReasons[0] ??
      "automatic-refinement-not-run";
    const findings: TranscriptionFinding[] = [];
    index += 1;
    findings.push({
      id: `finding-${String(index).padStart(5, "0")}`,
      code: primaryReason,
      interval: segment.interval,
      sourceStage: "baseline-qa",
      status: "open",
      category: categoryForCode(primaryReason),
      ...(segment.cueId === null ? {} : { cueIds: [segment.cueId] }),
      reasons: unique(segment.reasons),
    });
    if (segment.reasons.includes("automatic-refinement-not-run")) {
      index += 1;
      findings.push({
        id: `finding-${String(index).padStart(5, "0")}`,
        code: "AUTOMATIC_REFINEMENT_NOT_RUN",
        interval: segment.interval,
        sourceStage: "baseline-qa",
        status: "open",
        category: categoryForCode(primaryReason),
        ...(segment.cueId === null ? {} : { cueIds: [segment.cueId] }),
        reasons: unique(segment.reasons),
      });
    }
    return findings;
  });
}

function makePostPresentationFindings(
  quality: TranscriptionQuality,
  startingIndex: number,
): TranscriptionFinding[] {
  let index = startingIndex;
  return quality.segments.flatMap((segment) => {
    if (
      ["accepted", "accepted-after-refinement"].includes(segment.status) ||
      segment.reasons.length === 0
    ) {
      return [];
    }
    const reasons = segment.reasons.filter(
      (reason) => reason !== "automatic-refinement-not-run",
    );
    const primaryReason = reasons[0];
    if (primaryReason === undefined) return [];
    index += 1;
    return [
      {
        id: `finding-${String(index).padStart(5, "0")}`,
        code: primaryReason,
        interval: segment.interval,
        sourceStage: "post-presentation-qa",
        status: "open",
        category: categoryForCode(primaryReason),
        ...(segment.cueId === null ? {} : { cueIds: [segment.cueId] }),
        reasons: unique(reasons),
      } satisfies TranscriptionFinding,
    ];
  });
}

function makePresentationFindings(
  records: readonly PresentationTimingRecord[],
  startingIndex: number,
): TranscriptionFinding[] {
  let index = startingIndex;
  return records.flatMap((record) => {
    const primaryReason = record.reasons[0];
    if (primaryReason === undefined) return [];
    index += 1;
    return [
      {
        id: `finding-${String(index).padStart(5, "0")}`,
        code: primaryReason,
        interval: {
          start: Math.min(
            record.originalInterval.start,
            ...record.outputIntervals.map((item) => item.start),
          ),
          end: Math.max(
            record.originalInterval.end,
            ...record.outputIntervals.map((item) => item.end),
          ),
        },
        sourceStage: "presentation",
        status: "open",
        category: "presentation",
        cueIds: [record.sourceCueId],
        reasons: unique(record.reasons),
      } satisfies TranscriptionFinding,
    ];
  });
}

function makeIntegrityFindings(
  integrity: FinalSubtitleIntegrityArtifact | undefined,
  startingIndex: number,
): TranscriptionFinding[] {
  if (integrity === undefined) return [];
  let index = startingIndex;
  return integrity.findings.map((finding) => {
    index += 1;
    const missingLyrics =
      finding.code === "MISSING_LYRICS" ||
      finding.code === "FINAL_LYRICS_INCOMPLETE_LINE" ||
      finding.code === "FINAL_LYRICS_HALLUCINATION";
    const sceneCoverage = finding.code.startsWith("SCENE_");
    return {
      id: `finding-${String(index).padStart(5, "0")}`,
      code: finding.code,
      interval: finding.interval,
      sourceStage: sceneCoverage
        ? ("scene-coverage-integrity" as const)
        : missingLyrics
          ? ("coverage-integrity" as const)
          : ("final-integrity-gate" as const),
      status: "needs-human-review" as const,
      category:
        finding.category === "timing"
          ? ("timing" as const)
          : finding.code === "PRESENTATION_DUPLICATE_LINE"
            ? ("presentation" as const)
            : ("text" as const),
      ...(finding.cueIds.length === 0 ? {} : { cueIds: finding.cueIds }),
      reasons: finding.reasons,
      integrityIssue: true,
      requiresAudioReview: true,
      ...(missingLyrics ? { missingLyrics: true } : {}),
      ...(finding.vocalRegionIds === undefined
        ? {}
        : { vocalRegionIds: finding.vocalRegionIds }),
      ...(finding.sceneIds === undefined ? {} : { sceneIds: finding.sceneIds }),
    };
  });
}

function makeAcceptedCueReviewFindings(
  cues: readonly SubtitleCue[],
  startingIndex: number,
): TranscriptionFinding[] {
  return cues.flatMap((cue, index) => {
    const audit = cue.textAudit;
    if (audit?.reviewRecommended !== true) return [];
    return [
      {
        id: `finding-${String(startingIndex + index + 1).padStart(5, "0")}`,
        code: "TOP_SCORE_WINNER_REVIEW_RECOMMENDED",
        interval: { start: cue.start, end: cue.end },
        sourceStage: "hypothesis-resolution" as const,
        status: "needs-human-review" as const,
        category: "text" as const,
        cueIds: [cue.id],
        missingDialogue: false,
        requiresAudioReview: true,
        reasons:
          audit.reviewReasons.length > 0
            ? audit.reviewReasons
            : ["accepted-top-score-winner-has-review-only-risk"],
        acceptedCueReview: {
          finalCueId: cue.id,
          finalText: cue.text,
          rawAsrText: audit.rawAsrText,
          repairedText: audit.repairedText,
          normalizedText: audit.normalizedText,
          winnerScore: audit.winnerScore ?? null,
          runnerUpCueId: audit.runnerUpCueId ?? null,
          runnerUpScore: audit.runnerUpScore ?? null,
          scoreGap: audit.scoreGap ?? null,
          replacementCount: audit.replacements.length,
          timingDonorCueId: audit.timingDonorCueId ?? null,
          deduplicationActions: audit.deduplicationActions,
          reviewReasons: audit.reviewReasons,
        },
      },
    ];
  });
}

function integrityConcernMatches(
  finding: TranscriptionFinding,
  integrityFinding: FinalSubtitleIntegrityArtifact["findings"][number],
): boolean {
  if (!overlaps(finding.interval, integrityFinding.interval)) return false;
  const historical = [finding.code, ...(finding.reasons ?? [])]
    .join(" ")
    .toUpperCase();
  if (integrityFinding.category === "repetition") {
    return /HALLUCINATION|REPEAT|REPETITION|DUPLICATE|LOOP/u.test(historical);
  }
  if (integrityFinding.code === "MISSING_LYRICS") {
    return /MISSING|EMPTY|SPEECH.GAP|TEXT.MISMATCH|UNEXPLAINED/u.test(
      historical,
    );
  }
  if (
    ["fragment", "text", "hypothesis", "lyrics", "semantic"].includes(
      integrityFinding.category,
    )
  ) {
    return /TEXT|HYPOTHESIS|FRAGMENT|MORPHEME|CLAUSE|LYRIC|SEMANTIC|HALLUCINATION|MISSING|EMPTY/u.test(
      historical,
    );
  }
  if (integrityFinding.category === "timing") {
    return /TIMING|TIMESTAMP|OVERLAP|DURATION|SPLIT|BOUNDARY/u.test(historical);
  }
  return false;
}

export function assertFindingClosureMatchesFinalOutput(input: {
  findings: readonly TranscriptionFinding[];
  finalIntegrity?: FinalSubtitleIntegrityArtifact | undefined;
  startingIndex?: number | undefined;
}): {
  findings: TranscriptionFinding[];
  consistencyFindings: TranscriptionFinding[];
} {
  if (input.finalIntegrity === undefined) {
    return { findings: [...input.findings], consistencyFindings: [] };
  }
  const closed = new Set<TranscriptionFinding["status"]>([
    "resolved",
    "repaired",
    "superseded",
    "informational",
  ]);
  let index = input.startingIndex ?? input.findings.length;
  const consistencyFindings: TranscriptionFinding[] = [];
  const findings = input.findings.map((finding) => {
    if (!closed.has(finding.status)) return finding;
    const matching = input.finalIntegrity?.findings.find(
      (candidate) =>
        candidate.severity === "hard" &&
        integrityConcernMatches(finding, candidate),
    );
    if (matching === undefined) return finding;
    index += 1;
    consistencyFindings.push({
      id: `finding-${String(index).padStart(5, "0")}`,
      code: "FINDING_CLOSED_BUT_PRESENT_IN_FINAL_OUTPUT",
      interval: {
        start: Math.min(finding.interval.start, matching.interval.start),
        end: Math.max(finding.interval.end, matching.interval.end),
      },
      sourceStage: "final-integrity-gate",
      status: "needs-human-review",
      category:
        matching.category === "timing"
          ? "timing"
          : matching.code === "PRESENTATION_DUPLICATE_LINE"
            ? "presentation"
            : "text",
      ...(matching.cueIds.length === 0 ? {} : { cueIds: matching.cueIds }),
      reasons: [
        "finding-was-closed-before-final-output-validation",
        matching.code,
        finding.code,
      ],
      integrityIssue: true,
      requiresAudioReview: true,
      ...([
        "MISSING_LYRICS",
        "FINAL_LYRICS_INCOMPLETE_LINE",
        "FINAL_LYRICS_HALLUCINATION",
      ].includes(matching.code)
        ? {
            missingLyrics: true,
            vocalRegionIds: matching.vocalRegionIds ?? [],
          }
        : {}),
    });
    const { resolvedBy: _resolvedBy, ...reopened } = finding;
    void _resolvedBy;
    return {
      ...reopened,
      status: "needs-human-review" as const,
      reasons: unique([
        ...(finding.reasons ?? []),
        "FINDING_CLOSED_BUT_PRESENT_IN_FINAL_OUTPUT",
        matching.code,
      ]),
      integrityIssue: true,
      requiresAudioReview: true,
    };
  });
  return { findings, consistencyFindings };
}

function hasSuccessfulTimingRepair(
  finding: TranscriptionFinding,
  repairs: readonly TimingRepairRecord[],
): boolean {
  return repairs.some(
    (repair) =>
      (finding.cueIds?.includes(repair.cueId) === true ||
        overlaps(repair.before, finding.interval)) &&
      repair.after.end > repair.after.start &&
      repair.reasons.length === 0 &&
      repair.method !== "none",
  );
}

function hasSpeechEvidence(
  interval: Interval,
  speechIntervals: readonly Interval[],
): boolean {
  const duration = Math.max(0.001, interval.end - interval.start);
  const covered = speechIntervals.reduce(
    (total, speech) => total + overlapSeconds(interval, speech),
    0,
  );
  return Math.min(duration, covered) / duration >= 0.2;
}

function finalCueCoverageRatio(input: {
  interval: Interval;
  finalCues: readonly SubtitleCue[];
  speechIntervals: readonly Interval[];
}): number {
  const speech = input.speechIntervals.flatMap((interval) => {
    const start = Math.max(interval.start, input.interval.start);
    const end = Math.min(interval.end, input.interval.end);
    return end > start ? [{ start, end }] : [];
  });
  const denominator =
    speech.length === 0
      ? input.interval.end - input.interval.start
      : unionDuration(speech);
  if (denominator <= 0) return 1;
  const covered = input.finalCues.flatMap((cue) => {
    const start = Math.max(cue.start, input.interval.start);
    const end = Math.min(cue.end, input.interval.end);
    return end > start ? [{ start, end }] : [];
  });
  return Math.min(1, unionDuration(covered) / denominator);
}

function rejectedHypothesisFinding(input: {
  finding: TranscriptionFinding;
  refinementRecord?: AdaptiveRefinementRecord | undefined;
}): {
  rejected: boolean;
  selected: TranscriptionFinding["selectedHypothesis"];
  hypothesis: TranscriptionFinding["rejectedHypothesis"];
} {
  const code = input.finding.code.toUpperCase();
  const hypothesis = code.startsWith("NO_VAD_")
    ? ("no-vad" as const)
    : code.startsWith("VAD_") && !code.startsWith("VAD_NO_VAD_")
      ? ("vad" as const)
      : undefined;
  if (hypothesis === undefined) {
    return { rejected: false, selected: "unknown", hypothesis: undefined };
  }
  const selected = (input.refinementRecord?.replacements ?? [])
    .filter((record) => overlaps(record.interval, input.finding.interval))
    .map(selectedHypothesis)
    .find((candidate) => candidate !== "unknown");
  return {
    rejected:
      (selected === "vad" || selected === "no-vad") && selected !== hypothesis,
    selected: selected ?? "unknown",
    hypothesis,
  };
}

function resolveHistoricalFinding(input: {
  finding: TranscriptionFinding;
  finalCues: readonly SubtitleCue[];
  postPresentationQuality: TranscriptionQuality;
  refinementRecord?: AdaptiveRefinementRecord | undefined;
  timingRepairs: readonly TimingRepairRecord[];
  speechIntervals: readonly Interval[];
}): TranscriptionFinding {
  const cueIds = finalCueIdsFor(input.finding, input.finalCues);
  const postByCue = postStatusByCue(input.postPresentationQuality);
  const finalPass = finalCuesPassQa(cueIds, postByCue);
  const coverage = isFindingCoveredByRefinement({
    finding: input.finding,
    refinementRecord: input.refinementRecord,
    finalCues: input.finalCues,
    postPresentationQuality: input.postPresentationQuality,
  });
  const rejected = rejectedHypothesisFinding({
    finding: input.finding,
    refinementRecord: input.refinementRecord,
  });
  const base = {
    ...input.finding,
    ...(cueIds.length === 0 ? {} : { replacedByCueIds: cueIds }),
    ...(coverage.selectedHypothesis === "unknown"
      ? {}
      : { selectedHypothesis: coverage.selectedHypothesis }),
  };
  const missingDialogueConcern = [
    input.finding.code,
    ...(input.finding.reasons ?? []),
  ].some(
    (reason) =>
      MISSING_DIALOGUE_CODES.has(reason) ||
      /MISSING.DIALOGUE|SPEECH.GAP|SPEECH.TEXT.MISMATCH|EMPTY.REFINEMENT/iu.test(
        reason,
      ),
  );
  if (
    missingDialogueConcern &&
    hasSpeechEvidence(input.finding.interval, input.speechIntervals) &&
    finalCueCoverageRatio({
      interval: input.finding.interval,
      finalCues: input.finalCues,
      speechIntervals: input.speechIntervals,
    }) < 0.5
  ) {
    const { resolvedBy: _resolvedBy, ...unresolved } = base;
    void _resolvedBy;
    return {
      ...unresolved,
      status: "needs-human-review",
      missingDialogue: true,
      requiresAudioReview: true,
      reasons: unique([
        ...(input.finding.reasons ?? []),
        "insufficient-final-cue-coverage",
      ]),
    };
  }

  if (rejected.rejected) {
    return {
      ...base,
      status: "informational",
      selectedHypothesis: rejected.selected,
      ...(rejected.hypothesis === undefined
        ? {}
        : { rejectedHypothesis: rejected.hypothesis }),
      resolvedBy: {
        stage: "refinement",
        operation: "rejected-hypothesis-not-projected",
        artifact: "transcription-refinement.json",
      },
    };
  }

  if (input.finding.code === "AUTOMATIC_REFINEMENT_NOT_RUN") {
    if (coverage.covered && coverage.refinementId !== null) {
      return {
        ...base,
        status: "superseded",
        refinementNotRunReason: "covered-by-parent-refinement",
        coveredByRefinementId: coverage.refinementId,
        refinementIds: [coverage.refinementId],
        resolvedBy: {
          stage: "refinement",
          operation: "covered-by-parent-refinement",
          artifact: "transcription-refinement.json",
        },
      };
    }
    if (finalPass) {
      return {
        ...base,
        status: "resolved",
        refinementNotRunReason: "not-needed",
        resolvedBy: {
          stage: "post-presentation-qa",
          operation: "final-cue-passed",
          artifact: "transcription-quality-post-presentation.json",
        },
      };
    }
    if (
      input.finding.category !== "text" &&
      hasSuccessfulTimingRepair(input.finding, input.timingRepairs)
    ) {
      return {
        ...base,
        status: "repaired",
        refinementNotRunReason: "timing-only-repair-sufficient",
        resolvedBy: {
          stage: "timing-repair",
          operation: "timing-only-repair",
          artifact: "transcription-timing-repairs.json",
        },
      };
    }
    if (
      cueIds.length === 0 &&
      hasSpeechEvidence(input.finding.interval, input.speechIntervals)
    ) {
      return {
        ...base,
        status: "needs-human-review",
        refinementNotRunReason: "missing-acoustic-evidence",
        missingDialogue: true,
        requiresAudioReview: true,
      };
    }
    const explicitFailureReason = (
      [
        "budget-limit",
        "missing-acoustic-evidence",
        "missing-model-capability",
        "execution-failed",
      ] as const
    ).find((reason) => input.finding.reasons?.includes(reason));
    const missingCapability = input.finding.reasons?.includes(
      "refinement-disabled-or-unavailable",
    );
    const failureReason =
      explicitFailureReason ??
      (missingCapability ? "missing-model-capability" : "duplicate-work");
    return {
      ...base,
      status:
        cueIds.length > 0 &&
        !NON_REVIEW_REFINEMENT_NOT_RUN_REASONS.has(failureReason)
          ? "needs-human-review"
          : "informational",
      refinementNotRunReason: failureReason,
    };
  }

  if (coverage.covered && coverage.refinementId !== null) {
    const supersededByReplacement =
      input.finding.category === "timing" &&
      /OVERMERGE|SPLIT/iu.test(input.finding.code);
    return {
      ...base,
      status: supersededByReplacement ? "superseded" : "resolved",
      refinementIds: [coverage.refinementId],
      resolvedBy: {
        stage: "refinement",
        operation: supersededByReplacement
          ? "split-realign-and-replace"
          : "selected-refinement-passed-final-qa",
        artifact: "transcription-refinement.json",
      },
    };
  }

  const structuralRefinementId = structurallyCoveringRefinement({
    finding: input.finding,
    refinementRecord: input.refinementRecord,
  });
  if (
    structuralRefinementId !== null &&
    cueIds.length > 0 &&
    /OVERMERGE|SPLIT/iu.test(input.finding.code)
  ) {
    return {
      ...base,
      status: "superseded",
      refinementIds: [structuralRefinementId],
      resolvedBy: {
        stage: "refinement",
        operation: "split-and-replace",
        artifact: "transcription-refinement.json",
      },
    };
  }

  if (
    input.finding.category !== "text" &&
    hasSuccessfulTimingRepair(input.finding, input.timingRepairs) &&
    finalPass
  ) {
    return {
      ...base,
      status: "repaired",
      resolvedBy: {
        stage: "timing-repair",
        operation: "final-cue-realigned",
        artifact: "transcription-timing-repairs.json",
      },
    };
  }

  const matchingPostReasons = cueIds.flatMap(
    (cueId) => postByCue.get(cueId)?.reasons ?? [],
  );
  if (cueIds.length > 0 && matchingPostReasons.includes(input.finding.code)) {
    return {
      ...base,
      status: "superseded",
      resolvedBy: {
        stage: "post-presentation-qa",
        operation: "projected-as-final-state-finding",
        artifact: "transcription-quality-post-presentation.json",
      },
    };
  }

  if (
    cueIds.length > 0 &&
    input.finding.category !== "text" &&
    !matchingPostReasons.includes(input.finding.code)
  ) {
    return {
      ...base,
      status: "resolved",
      resolvedBy: {
        stage: "post-presentation-qa",
        operation: "historical-timing-code-not-present-on-final-cue",
        artifact: "transcription-quality-post-presentation.json",
      },
    };
  }

  if (finalPass) {
    return {
      ...base,
      status: "resolved",
      resolvedBy: {
        stage: "post-presentation-qa",
        operation: "final-cue-passed",
        artifact: "transcription-quality-post-presentation.json",
      },
    };
  }

  const missingDialogue =
    cueIds.length === 0 &&
    ((input.finding.reasons ?? []).some((reason) =>
      MISSING_DIALOGUE_CODES.has(reason),
    ) ||
      hasSpeechEvidence(input.finding.interval, input.speechIntervals));
  return {
    ...base,
    status:
      cueIds.length > 0 || missingDialogue
        ? "needs-human-review"
        : "informational",
    ...(missingDialogue ? { missingDialogue: true } : {}),
    ...(missingDialogue ? { requiresAudioReview: true } : {}),
  };
}

function resolvePostFinding(input: {
  finding: TranscriptionFinding;
  finalCues: readonly SubtitleCue[];
  speechIntervals: readonly Interval[];
}): TranscriptionFinding {
  const cueIds = finalCueIdsFor(input.finding, input.finalCues);
  if (cueIds.length === 0) {
    const missingDialogue = hasSpeechEvidence(
      input.finding.interval,
      input.speechIntervals,
    );
    return {
      ...input.finding,
      status: missingDialogue ? "needs-human-review" : "informational",
      ...(missingDialogue
        ? { missingDialogue: true, requiresAudioReview: true }
        : {}),
    };
  }
  return {
    ...input.finding,
    status: "needs-human-review",
    replacedByCueIds: cueIds,
  };
}

function resolvePresentationFinding(input: {
  finding: TranscriptionFinding;
  finalCues: readonly SubtitleCue[];
  postPresentationQuality: TranscriptionQuality;
}): TranscriptionFinding {
  const cueIds = finalCueIdsFor(input.finding, input.finalCues);
  if (cueIds.length === 0) {
    return { ...input.finding, status: "informational" };
  }
  const postByCue = postStatusByCue(input.postPresentationQuality);
  const postReasons = cueIds.flatMap(
    (cueId) => postByCue.get(cueId)?.reasons ?? [],
  );
  const projectedToPostFinding = postReasons.includes(input.finding.code);
  const requiresReview =
    !projectedToPostFinding && !finalCuesPassQa(cueIds, postByCue);
  return {
    ...input.finding,
    status: projectedToPostFinding
      ? "superseded"
      : requiresReview
        ? "needs-human-review"
        : "resolved",
    replacedByCueIds: cueIds,
    ...(requiresReview
      ? {}
      : {
          resolvedBy: {
            stage: "post-presentation-qa",
            operation: projectedToPostFinding
              ? "projected-as-final-state-finding"
              : "final-presentation-cues-passed",
            artifact: "transcription-quality-post-presentation.json",
          },
        }),
  };
}

function linkSupersedingFindings(
  findings: readonly TranscriptionFinding[],
): TranscriptionFinding[] {
  const finalStage = findings.filter(
    (finding) => finding.sourceStage === "post-presentation-qa",
  );
  return findings.map((finding) => {
    if (
      finding.status !== "superseded" ||
      finding.resolvedBy?.operation !== "projected-as-final-state-finding"
    ) {
      return finding;
    }
    const supersedingIds = finalStage
      .filter(
        (candidate) =>
          overlaps(candidate.interval, finding.interval) &&
          (candidate.code === finding.code ||
            candidate.category === finding.category),
      )
      .map((candidate) => candidate.id);
    return supersedingIds.length === 0
      ? finding
      : { ...finding, supersededByFindingIds: unique(supersedingIds) };
  });
}

function categoryForGroup(
  findings: readonly TranscriptionFinding[],
): ReviewCategory {
  const categories = new Set(findings.map((finding) => finding.category));
  if (categories.size === 1) return findings[0]?.category ?? "mixed";
  return "mixed";
}

function speechIslandIndex(
  interval: Interval,
  speechIntervals: readonly Interval[],
): number | null {
  const index = speechIntervals.findIndex((speech) =>
    overlaps(speech, interval),
  );
  return index < 0 ? null : index;
}

function speechIslandIdsFor(
  interval: Interval,
  speechIntervals: readonly Interval[],
): string[] {
  return speechIntervals.flatMap((speech, index) =>
    overlaps(speech, interval)
      ? [`speech-island-${String(index + 1).padStart(4, "0")}`]
      : [],
  );
}

function sceneBoundaryBetween(
  left: Interval,
  right: Interval,
  boundaries: readonly number[],
): boolean {
  return boundaries.some(
    (boundary) => boundary > left.end && boundary < right.start,
  );
}

export function groupAdjacentReviewFindings(input: {
  findings: readonly TranscriptionFinding[];
  finalCues: readonly SubtitleCue[];
  speechIntervals?: readonly Interval[] | undefined;
  sceneBoundaries?: readonly number[] | undefined;
  gapSeconds?: number | undefined;
}): FinalReviewQueue["groups"] {
  const gapSeconds = input.gapSeconds ?? 0.75;
  const speechIntervals = input.speechIntervals ?? [];
  const sceneBoundaries = input.sceneBoundaries ?? [];
  const pending = input.findings
    .filter((finding) => finding.status === "needs-human-review")
    .map((finding) => ({
      finding,
      cueIds: finalCueIdsFor(finding, input.finalCues),
    }))
    .filter(
      ({ finding, cueIds }) =>
        cueIds.length > 0 ||
        finding.missingDialogue === true ||
        finding.missingLyrics === true ||
        finding.requiresAudioReview === true,
    )
    .toSorted(
      (left, right) =>
        left.finding.interval.start - right.finding.interval.start ||
        left.finding.interval.end - right.finding.interval.end,
    );
  const grouped: (typeof pending)[] = [];
  for (const item of pending) {
    const current = grouped.at(-1);
    if (current === undefined) {
      grouped.push([item]);
      continue;
    }
    const currentInterval = {
      start: Math.min(...current.map(({ finding }) => finding.interval.start)),
      end: Math.max(...current.map(({ finding }) => finding.interval.end)),
    };
    const currentCueIds = new Set(current.flatMap(({ cueIds }) => cueIds));
    const sharedCue = item.cueIds.some((cueId) => currentCueIds.has(cueId));
    const overlapping = item.finding.interval.start <= currentInterval.end;
    const sameMissingDialogueRegion =
      item.finding.missingDialogue === true &&
      current.some(({ finding }) => finding.missingDialogue === true);
    const onlyTimingLike = [...current, item].every(({ finding }) =>
      ["timing", "presentation"].includes(finding.category),
    );
    const sameRefinement = item.finding.refinementIds?.some((id) =>
      current.some(({ finding }) => finding.refinementIds?.includes(id)),
    );
    const currentIsland = speechIslandIndex(currentInterval, speechIntervals);
    const itemIsland = speechIslandIndex(
      item.finding.interval,
      speechIntervals,
    );
    const sameIsland =
      currentIsland !== null &&
      itemIsland !== null &&
      currentIsland === itemIsland;
    const adjacent =
      onlyTimingLike &&
      item.finding.interval.start - currentInterval.end <= gapSeconds &&
      (sharedCue || sameRefinement === true || sameIsland);
    const blockedByScene = sceneBoundaryBetween(
      currentInterval,
      item.finding.interval,
      sceneBoundaries,
    );
    if (
      !blockedByScene &&
      ((overlapping && (sharedCue || sameMissingDialogueRegion)) || adjacent)
    ) {
      current.push(item);
    } else {
      grouped.push([item]);
    }
  }
  return grouped.map((items, index) => {
    const findings = items.map(({ finding }) => finding);
    const finalCueIds = unique(items.flatMap(({ cueIds }) => cueIds));
    const missingDialogue = findings.some(
      (finding) => finding.missingDialogue === true,
    );
    const missingLyrics = findings.some(
      (finding) => finding.missingLyrics === true,
    );
    const integrityIssue = findings.some(
      (finding) => finding.integrityIssue === true,
    );
    const interval = {
      start: Math.min(...findings.map((finding) => finding.interval.start)),
      end: Math.max(...findings.map((finding) => finding.interval.end)),
    };
    const refinementIds = unique(
      findings.flatMap((finding) => finding.refinementIds ?? []),
    );
    const speechIslandIds = speechIslandIdsFor(interval, speechIntervals);
    const vocalRegionIds = unique(
      findings.flatMap((finding) => finding.vocalRegionIds ?? []),
    );
    const sceneIds = unique(
      findings.flatMap((finding) => finding.sceneIds ?? []),
    );
    return {
      id: `review-group-${String(index + 1).padStart(4, "0")}`,
      category: categoryForGroup(findings),
      interval,
      finalCueIds,
      findingIds: findings.map((finding) => finding.id),
      reasons: unique(
        findings.flatMap((finding) => [
          finding.code,
          ...(finding.reasons ?? []),
        ]),
      ),
      ...(missingDialogue
        ? { missingDialogue: true, needsAudioTranscription: true }
        : {}),
      ...(missingLyrics
        ? { missingLyrics: true, needsAudioTranscription: true }
        : {}),
      ...(integrityIssue ? { integrityIssue: true } : {}),
      ...(speechIslandIds.length === 0 ? {} : { speechIslandIds }),
      ...(refinementIds.length === 0 ? {} : { refinementIds }),
      ...(sceneIds.length === 0 ? {} : { sceneIds }),
      ...(vocalRegionIds.length === 0 ? {} : { vocalRegionIds }),
    };
  });
}

function reviewEventCategory(
  group: FinalReviewQueue["groups"][number],
): ReviewEventCategory {
  if (group.missingDialogue === true) return "missing-dialogue";
  if (group.missingLyrics === true) return "missing-lyrics";
  const reasons = group.reasons.join(" ").toUpperCase();
  if (
    /HALLUCINATION|REPEATED[-_ ]PHRASE|EXACT_SENTENCE_LOOP|LONG_PHRASE_LOOP|EXTREME_REPETITION/u.test(
      reasons,
    )
  ) {
    return "hallucination";
  }
  if (group.category === "timing" || group.category === "presentation") {
    return "timing";
  }
  if (group.category === "mixed") return "mixed";
  return "low-confidence-text";
}

function splitPlayableInterval(
  interval: Interval,
  maximumSeconds = 30,
): Interval[] {
  const output: Interval[] = [];
  for (
    let start = interval.start;
    start < interval.end;
    start += maximumSeconds
  ) {
    output.push({
      start,
      end: Math.min(interval.end, start + maximumSeconds),
    });
  }
  return output;
}

function eventUserAction(
  category: ReviewEventCategory,
): ReviewEvent["userAction"] {
  if (category === "missing-dialogue") return "listen-and-transcribe";
  if (category === "missing-lyrics") {
    return "listen-and-transcribe-lyrics";
  }
  if (category === "timing") return "verify-timing";
  if (category === "mixed") return "verify-text-and-timing";
  return "verify-text";
}

function unionDuration(intervals: readonly Interval[]): number {
  const merged: Interval[] = [];
  for (const interval of intervals.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  )) {
    const previous = merged.at(-1);
    if (previous !== undefined && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  );
}

export function buildReviewEvents(input: {
  groups: readonly FinalReviewQueue["groups"][number][];
  findings: readonly TranscriptionFinding[];
  speechIntervals?: readonly Interval[] | undefined;
  sceneBoundaries?: readonly number[] | undefined;
  recoveryUnits?:
    | readonly {
        parentReviewGroupId: string;
        interval: Interval;
      }[]
    | undefined;
  gapSeconds?: number | undefined;
}): {
  events: ReviewEvent[];
  reviewAudioDurationSeconds: number;
  maximumReviewEventSpanSeconds: number;
  maximumPlayableSubIntervalSeconds: number;
} {
  const speechIntervals = input.speechIntervals ?? [];
  const sceneBoundaries = input.sceneBoundaries ?? [];
  const gapSeconds = input.gapSeconds ?? 0.75;
  const candidates = input.groups
    .map((group) => ({
      group,
      category: reviewEventCategory(group),
    }))
    .toSorted(
      (left, right) =>
        left.group.interval.start - right.group.interval.start ||
        left.group.interval.end - right.group.interval.end,
    );
  const eventGroups: (typeof candidates)[] = [];
  for (const candidate of candidates) {
    const current = eventGroups.at(-1);
    if (current === undefined) {
      eventGroups.push([candidate]);
      continue;
    }
    const first = current[0];
    const previous = current.at(-1);
    if (first === undefined || previous === undefined) {
      eventGroups.push([candidate]);
      continue;
    }
    const currentInterval = {
      start: first.group.interval.start,
      end: Math.max(...current.map((item) => item.group.interval.end)),
    };
    const candidateIslands = new Set(candidate.group.speechIslandIds ?? []);
    const sameIsland =
      candidateIslands.size > 0 &&
      current.some((item) =>
        (item.group.speechIslandIds ?? []).some((id) =>
          candidateIslands.has(id),
        ),
      );
    const sameRefinement =
      (candidate.group.refinementIds ?? []).length > 0 &&
      current.some((item) =>
        (item.group.refinementIds ?? []).some((id) =>
          candidate.group.refinementIds?.includes(id),
        ),
      );
    const continuous =
      candidate.group.interval.start - previous.group.interval.end <=
      gapSeconds;
    const mergeHallucination =
      candidate.category === "hallucination" &&
      first.category === "hallucination" &&
      continuous &&
      (sameIsland || sameRefinement || speechIntervals.length === 0) &&
      candidate.group.interval.end - currentInterval.start <= 30 &&
      !sceneBoundaryBetween(
        currentInterval,
        candidate.group.interval,
        sceneBoundaries,
      );
    if (mergeHallucination) current.push(candidate);
    else eventGroups.push([candidate]);
  }
  const events = eventGroups.map((items, index) => {
    const groups = items.map((item) => item.group);
    const category =
      new Set(items.map((item) => item.category)).size === 1
        ? (items[0]?.category ?? "mixed")
        : ("mixed" as const);
    const interval = {
      start: Math.min(...groups.map((group) => group.interval.start)),
      end: Math.max(...groups.map((group) => group.interval.end)),
    };
    const recoverySubIntervals = groups.flatMap((group) =>
      (input.recoveryUnits ?? [])
        .filter((unit) => overlaps(unit.interval, group.interval))
        .map((unit) => unit.interval),
    );
    const subIntervals =
      recoverySubIntervals.length > 0
        ? recoverySubIntervals
        : groups.flatMap((group) => splitPlayableInterval(group.interval));
    return {
      id: `review-event-${String(index + 1).padStart(4, "0")}`,
      category,
      interval,
      reviewGroupIds: groups.map((group) => group.id),
      findingIds: unique(groups.flatMap((group) => group.findingIds)),
      finalCueIds: unique(groups.flatMap((group) => group.finalCueIds)),
      speechIslandIds: unique(
        groups.flatMap((group) => group.speechIslandIds ?? []),
      ),
      refinementIds: unique(
        groups.flatMap((group) => group.refinementIds ?? []),
      ),
      sceneIds: unique(groups.flatMap((group) => group.sceneIds ?? [])),
      subIntervals,
      userAction: eventUserAction(category),
    } satisfies ReviewEvent;
  });
  const playable = events.flatMap((event) => event.subIntervals);
  return {
    events,
    reviewAudioDurationSeconds: unionDuration(playable),
    maximumReviewEventSpanSeconds: Math.max(
      0,
      ...events.map((event) => event.interval.end - event.interval.start),
    ),
    maximumPlayableSubIntervalSeconds: Math.max(
      0,
      ...playable.map((interval) => interval.end - interval.start),
    ),
  };
}

export function buildFinalReviewQueue(
  input: ReviewQueueBuildInput,
): ReviewQueueBuildResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const historical = makeHistoricalFindings(input.historicalQuality);
  const post = makePostPresentationFindings(
    input.postPresentationQuality,
    historical.length,
  );
  const presentation = makePresentationFindings(
    input.presentationTiming ?? [],
    historical.length + post.length,
  );
  const integrity = makeIntegrityFindings(
    input.finalIntegrity,
    historical.length + post.length + presentation.length,
  );
  const acceptedCueReviews = makeAcceptedCueReviewFindings(
    input.finalCues,
    historical.length + post.length + presentation.length + integrity.length,
  );
  const resolvedHistorical = historical.map((finding) =>
    resolveHistoricalFinding({
      finding,
      finalCues: input.finalCues,
      postPresentationQuality: input.postPresentationQuality,
      refinementRecord: input.refinementRecord,
      timingRepairs: input.timingRepairs ?? [],
      speechIntervals: input.speechIntervals ?? [],
    }),
  );
  const resolvedPost = post.map((finding) =>
    resolvePostFinding({
      finding,
      finalCues: input.finalCues,
      speechIntervals: input.speechIntervals ?? [],
    }),
  );
  const resolvedPresentation = presentation.map((finding) =>
    resolvePresentationFinding({
      finding,
      finalCues: input.finalCues,
      postPresentationQuality: input.postPresentationQuality,
    }),
  );
  const closure = assertFindingClosureMatchesFinalOutput({
    findings: [...resolvedHistorical, ...resolvedPost, ...resolvedPresentation],
    finalIntegrity: input.finalIntegrity,
    startingIndex:
      historical.length +
      post.length +
      presentation.length +
      integrity.length +
      acceptedCueReviews.length,
  });
  const allFindings = linkSupersedingFindings([
    ...closure.findings,
    ...integrity,
    ...acceptedCueReviews,
    ...closure.consistencyFindings,
  ]);
  const finalFindings = allFindings.filter(
    (finding) => finding.status === "needs-human-review",
  );
  const baseGroups = groupAdjacentReviewFindings({
    findings: finalFindings,
    finalCues: input.finalCues,
    speechIntervals: input.speechIntervals,
    sceneBoundaries: input.sceneBoundaries,
    gapSeconds: input.reviewGroupGapSeconds ?? 0.75,
  });
  const groups = baseGroups.map((group) => {
    const accepted = finalFindings
      .filter(
        (finding) =>
          group.findingIds.includes(finding.id) &&
          finding.acceptedCueReview !== undefined,
      )
      .flatMap((finding) =>
        finding.acceptedCueReview === undefined
          ? []
          : [finding.acceptedCueReview],
      );
    const evidence = reviewEvidenceForGroup(group, input);
    return {
      ...group,
      ...(accepted.length === 0 ? {} : { acceptedCueReviews: accepted }),
      ...(evidence === null ? {} : { evidence }),
    };
  });
  const reviewEvents = buildReviewEvents({
    groups,
    findings: finalFindings,
    speechIntervals: input.speechIntervals,
    sceneBoundaries: input.sceneBoundaries,
    recoveryUnits: input.recoveryUnits,
    gapSeconds: input.reviewGroupGapSeconds ?? 0.75,
  });
  const count = (status: TranscriptionFinding["status"]): number =>
    allFindings.filter((finding) => finding.status === status).length;
  const findings = transcriptionTimingFindingsSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt,
    allFindings,
    finalFindings,
    diagnostics: {
      total: allFindings.length,
      repaired: count("repaired"),
      resolved: count("resolved"),
      superseded: count("superseded"),
      informational: count("informational"),
      open: count("open"),
      needsHumanReview: count("needs-human-review"),
    },
  });
  const categoryCount = (category: ReviewCategory): number =>
    finalFindings.filter((finding) => finding.category === category).length;
  const groupCategoryCount = (category: ReviewCategory): number =>
    groups.filter((group) => group.category === category).length;
  const queue = finalReviewQueueSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt,
    reviewGroupGapSeconds: input.reviewGroupGapSeconds ?? 0.75,
    diagnosticFindingCount: allFindings.length,
    openFindingCount: count("open"),
    humanReviewFindingCount: finalFindings.length,
    uniqueReviewGroupCount: groups.length,
    acceptedButReviewRecommendedCount: new Set(
      acceptedCueReviews.flatMap((finding) => finding.cueIds ?? []),
    ).size,
    trueMissingDialogueGroupCount: groups.filter(
      (group) => group.missingDialogue === true,
    ).length,
    reviewSummary: {
      textFindings: categoryCount("text"),
      timingFindings: categoryCount("timing"),
      presentationFindings: categoryCount("presentation"),
      mixedFindings: categoryCount("mixed"),
      textGroups: groupCategoryCount("text"),
      timingGroups: groupCategoryCount("timing"),
      presentationGroups: groupCategoryCount("presentation"),
      mixedGroups: groupCategoryCount("mixed"),
      uniqueReviewGroups: groups.length,
    },
    groups,
    reviewEventCount: reviewEvents.events.length,
    reviewAudioDurationSeconds: reviewEvents.reviewAudioDurationSeconds,
    maximumReviewEventSpanSeconds: reviewEvents.maximumReviewEventSpanSeconds,
    maximumPlayableSubIntervalSeconds:
      reviewEvents.maximumPlayableSubIntervalSeconds,
    events: reviewEvents.events,
  });
  return { findings, queue };
}

export function refinementNotRunReasonCreatesReview(reason: string): boolean {
  return !NON_REVIEW_REFINEMENT_NOT_RUN_REASONS.has(reason);
}
