import { createHash } from "node:crypto";

import {
  coverageRecoveryPlanArtifactSchema,
  coverageRecoveryResultsArtifactSchema,
  type AnchorTextCoverageArtifact,
  type CoverageRecoveryMode,
  type CoverageRecoveryPlanArtifact,
  type CoverageRecoveryResultsArtifact,
  type FinalSubtitleIntegrityArtifact,
  type FinalTextIntegrityArtifact,
  type ReferenceTimelineArtifact,
  type SubtitleCue,
} from "@mvl/shared";

interface Interval {
  start: number;
  end: number;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function overlap(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

function clampWindow(input: {
  anchor: Interval;
  neighbors: readonly Interval[];
  durationSeconds: number;
  paddingSeconds: number;
  maximumWindowSeconds: number;
}): Interval {
  let start = Math.max(0, input.anchor.start - input.paddingSeconds);
  let end = Math.min(
    input.durationSeconds,
    input.anchor.end + input.paddingSeconds,
  );
  const previous = input.neighbors
    .filter((interval) => interval.end <= input.anchor.start)
    .toSorted((left, right) => right.end - left.end)[0];
  const next = input.neighbors
    .filter((interval) => interval.start >= input.anchor.end)
    .toSorted((left, right) => left.start - right.start)[0];
  if (previous !== undefined) start = Math.max(start, previous.end);
  if (next !== undefined) end = Math.min(end, next.start);
  if (end - start > input.maximumWindowSeconds) {
    const center = (input.anchor.start + input.anchor.end) / 2;
    start = Math.max(0, center - input.maximumWindowSeconds / 2);
    end = Math.min(input.durationSeconds, start + input.maximumWindowSeconds);
    start = Math.max(0, end - input.maximumWindowSeconds);
  }
  if (end <= start) {
    start = Math.max(0, input.anchor.start - 0.8);
    end = Math.min(input.durationSeconds, input.anchor.end + 0.8);
  }
  return { start, end };
}

function triggerCodesFor(input: {
  anchor: ReferenceTimelineArtifact["anchors"][number];
  coverage: AnchorTextCoverageArtifact["anchors"][number];
  textIntegrity?: FinalTextIntegrityArtifact;
  subtitleIntegrity?: FinalSubtitleIntegrityArtifact;
}): string[] {
  const codes: string[] = [];
  if (input.coverage.level === "uncovered") codes.push("ANCHOR_UNCOVERED");
  if (input.coverage.activeReview && !input.coverage.validTextCoverage) {
    codes.push("ACTIVE_REVIEW_WITHOUT_VALID_TEXT");
  }
  const textCodes =
    input.textIntegrity?.findings
      .filter(
        (finding) =>
          finding.referenceAnchorIds.includes(input.anchor.id) ||
          overlap(finding.interval, input.anchor.interval),
      )
      .map((finding) => finding.code) ?? [];
  const subtitleCodes =
    input.subtitleIntegrity?.findings
      .filter((finding) => overlap(finding.interval, input.anchor.interval))
      .map((finding) => finding.code) ?? [];
  codes.push(...textCodes, ...subtitleCodes);
  if (
    input.coverage.temporalCoverage &&
    !input.coverage.validTextCoverage &&
    codes.length === 0
  ) {
    codes.push("TEMPORAL_ONLY_COVERAGE");
  }
  if (
    input.coverage.validTextCoverage &&
    !input.coverage.verifiedTextCoverage &&
    codes.length === 0
  ) {
    codes.push("VERIFIED_COVERAGE_INSUFFICIENT");
  }
  return [...new Set(codes)];
}

export function buildCoverageRecoveryPlan(input: {
  timeline: ReferenceTimelineArtifact;
  coverage: AnchorTextCoverageArtifact;
  finalCues: readonly SubtitleCue[];
  textIntegrity?: FinalTextIntegrityArtifact;
  subtitleIntegrity?: FinalSubtitleIntegrityArtifact;
  mode?: CoverageRecoveryMode;
  round?: number;
  maximumRounds?: number;
  maximumWindowSeconds?: number;
  durationSeconds?: number;
}): CoverageRecoveryPlanArtifact {
  const mode = input.mode ?? "auto";
  const round = Math.min(2, Math.max(1, input.round ?? 1));
  const maximumRounds = Math.min(2, input.maximumRounds ?? 2);
  const maximumWindowSeconds = Math.min(20, input.maximumWindowSeconds ?? 12);
  const durationSeconds =
    input.durationSeconds ?? input.timeline.input.mediaDurationSeconds;
  const coverageByAnchor = new Map(
    input.coverage.anchors.map((entry) => [entry.anchorId, entry] as const),
  );
  const neighborIntervals = input.finalCues.map((cue) => ({
    start: cue.start,
    end: cue.end,
  }));
  const rawUnits: CoverageRecoveryPlanArtifact["units"] = [];
  for (const anchor of input.timeline.anchors) {
    if (!anchor.timingTrusted) continue;
    if (!anchor.expectedSpeech && !anchor.expectedSinging) continue;
    const coverage = coverageByAnchor.get(anchor.id);
    if (coverage === undefined) continue;
    const triggerCodes = triggerCodesFor({
      anchor,
      coverage,
      ...(input.textIntegrity === undefined
        ? {}
        : { textIntegrity: input.textIntegrity }),
      ...(input.subtitleIntegrity === undefined
        ? {}
        : { subtitleIntegrity: input.subtitleIntegrity }),
    });
    if (triggerCodes.length === 0) continue;
    const hardIntegrity = triggerCodes.some((code) =>
      [
        "FINAL_SINGLE_CHARACTER_FRAGMENT",
        "FINAL_EXTREME_SHORT_DURATION",
        "FINAL_INCOMPLETE_MORPHEME",
        "FINAL_TEXT_BOUNDARY_BREAK",
        "SUBTITLE_OVERLAP",
        "UNSUPPORTED_LONG_CUE",
      ].includes(code),
    );
    const priority = coverage.validTextCoverage
      ? ("P4" as const)
      : coverage.level === "uncovered" && coverage.generatedCueIds.length === 0
        ? ("P0" as const)
        : hardIntegrity
          ? ("P1" as const)
          : coverage.textValidity === "fragment" ||
              coverage.textValidity === "incomplete"
            ? ("P2" as const)
            : ("P3" as const);
    const paddingSeconds =
      anchor.kind === "narration" ? 1.75 : anchor.kind === "dialogue" ? 1 : 0.8;
    const interval = clampWindow({
      anchor: anchor.interval,
      neighbors: neighborIntervals,
      durationSeconds,
      paddingSeconds,
      maximumWindowSeconds,
    });
    const route =
      anchor.kind === "lyrics-original"
        ? ("lyrics-pipeline" as const)
        : priority === "P4" || (priority === "P3" && mode !== "deep")
          ? ("review-only" as const)
          : anchor.kind === "narration"
            ? ("narration-context" as const)
            : triggerCodes.includes("SUBTITLE_OVERLAP")
              ? ("no-vad-large-v3" as const)
              : triggerCodes.includes("FINAL_EXTREME_SHORT_DURATION")
                ? ("extra-sensitive-vad" as const)
                : priority === "P0" || priority === "P1"
                  ? ("vad-and-no-vad" as const)
                  : ("sensitive-vad" as const);
    const shouldRunAsr =
      mode !== "off" && route !== "lyrics-pipeline" && route !== "review-only";
    rawUnits.push({
      id: `coverage-recovery-r${String(round)}-raw-${String(rawUnits.length + 1).padStart(4, "0")}`,
      round,
      priority,
      interval,
      anchorIds: [anchor.id],
      sourceCueIds: coverage.generatedCueIds,
      triggerCodes,
      route,
      shouldRunAsr,
      evidence: [
        `anchor-kind:${anchor.kind}`,
        `coverage-level:${coverage.level}`,
        `valid-text:${String(coverage.validTextCoverage)}`,
        `verified-text:${String(coverage.verifiedTextCoverage)}`,
        `bounded-window-seconds:${(interval.end - interval.start).toFixed(3)}`,
      ],
    });
  }
  const automatic = rawUnits
    .filter((unit) => unit.shouldRunAsr)
    .toSorted((left, right) => left.interval.start - right.interval.start);
  const mergedAutomatic: CoverageRecoveryPlanArtifact["units"] = [];
  for (const unit of automatic) {
    const previous = mergedAutomatic.at(-1);
    if (previous === undefined) {
      mergedAutomatic.push({ ...unit });
      continue;
    }
    const canMerge =
      previous.route === unit.route &&
      unit.interval.start <= previous.interval.end + 0.5 &&
      Math.max(previous.interval.end, unit.interval.end) -
        Math.min(previous.interval.start, unit.interval.start) <=
        maximumWindowSeconds;
    if (!canMerge) {
      mergedAutomatic.push({ ...unit });
      continue;
    }
    previous.interval = {
      start: Math.min(previous.interval.start, unit.interval.start),
      end: Math.max(previous.interval.end, unit.interval.end),
    };
    previous.anchorIds = [
      ...new Set([...previous.anchorIds, ...unit.anchorIds]),
    ];
    previous.sourceCueIds = [
      ...new Set([...previous.sourceCueIds, ...unit.sourceCueIds]),
    ];
    previous.triggerCodes = [
      ...new Set([...previous.triggerCodes, ...unit.triggerCodes]),
    ];
    previous.evidence = [
      ...new Set([
        ...previous.evidence,
        ...unit.evidence,
        `coalesced-anchor-count:${String(previous.anchorIds.length)}`,
      ]),
    ];
  }
  const units = [
    ...mergedAutomatic,
    ...rawUnits.filter((unit) => !unit.shouldRunAsr),
  ]
    .toSorted(
      (left, right) =>
        left.interval.start - right.interval.start ||
        left.interval.end - right.interval.end,
    )
    .map((unit, index) => ({
      ...unit,
      id: `coverage-recovery-r${String(round)}-${String(index + 1).padStart(4, "0")}`,
    }));
  const priorityCounts = Object.fromEntries(
    (["P0", "P1", "P2", "P3", "P4"] as const).map((priority) => [
      priority,
      units.filter((unit) => unit.priority === priority).length,
    ]),
  );
  return coverageRecoveryPlanArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash({
      timeline: input.timeline,
      coverage: input.coverage,
      cues: input.finalCues,
      round,
    }),
    configuration: {
      mode,
      maximumRounds,
      maximumWindowSeconds,
      ordinaryReviewOnlyDoesNotTriggerAsr: true,
    },
    units,
    summary: {
      unitCount: units.length,
      automaticRequestCount: units.filter((unit) => unit.shouldRunAsr).length,
      reviewOnlyCount: units.filter((unit) => !unit.shouldRunAsr).length,
      priorityCounts,
    },
    fallback:
      mode === "off"
        ? "coverage-recovery-disabled-by-user"
        : units.length === 0
          ? "no-coverage-recovery-units"
          : null,
  });
}

export interface CoverageRecoveryExecutionResult {
  requestIds: string[];
  cacheHitCount: number;
  candidates: SubtitleCue[];
  acceptedCandidates: SubtitleCue[];
  reasons: string[];
}

export async function runCoverageRecoveryLoop(input: {
  initialCues: readonly SubtitleCue[];
  initialPlan: CoverageRecoveryPlanArtifact;
  execute: (
    unit: CoverageRecoveryPlanArtifact["units"][number],
  ) => Promise<CoverageRecoveryExecutionResult>;
  rerunCandidatePipeline: (
    currentCues: readonly SubtitleCue[],
    acceptedCandidates: readonly SubtitleCue[],
  ) => Promise<SubtitleCue[]> | SubtitleCue[];
  maximumRounds?: number;
  workerStartCount?: number;
  modelLoadCount?: number;
  fallbackProcessCount?: number;
}): Promise<{
  cues: SubtitleCue[];
  artifact: CoverageRecoveryResultsArtifact;
}> {
  const maximumRounds = Math.min(2, input.maximumRounds ?? 2);
  let cues = [...input.initialCues];
  const results: CoverageRecoveryResultsArtifact["results"] = [];
  let roundsCompleted = 0;
  let stopReason: CoverageRecoveryResultsArtifact["stopReason"] = "completed";
  for (let round = 1; round <= maximumRounds; round += 1) {
    const units = input.initialPlan.units.filter(
      (unit) => unit.round === round,
    );
    if (units.length === 0) {
      stopReason = round === 1 ? "no-recovery-units" : "completed";
      break;
    }
    roundsCompleted = round;
    const accepted: SubtitleCue[] = [];
    for (const unit of units) {
      if (!unit.shouldRunAsr) {
        results.push({
          unitId: unit.id,
          requestIds: [],
          cacheHitCount: 0,
          candidateCueIds: [],
          acceptedCueIds: [],
          decision: "review-only",
          reasons: ["planner-marked-review-only"],
        });
        continue;
      }
      const execution = await input.execute(unit);
      accepted.push(...execution.acceptedCandidates);
      results.push({
        unitId: unit.id,
        requestIds: execution.requestIds,
        cacheHitCount: execution.cacheHitCount,
        candidateCueIds: execution.candidates.map((cue) => cue.id),
        acceptedCueIds: execution.acceptedCandidates.map((cue) => cue.id),
        decision:
          execution.acceptedCandidates.length > 0 ? "accepted" : "rejected",
        reasons: execution.reasons,
      });
    }
    if (accepted.length === 0) {
      stopReason = "no-new-accepted-candidates";
      break;
    }
    cues = await input.rerunCandidatePipeline(cues, accepted);
    stopReason =
      round === maximumRounds ? "maximum-rounds-reached" : "completed";
  }
  const requestCount = results.reduce(
    (sum, result) => sum + result.requestIds.length,
    0,
  );
  const artifact = coverageRecoveryResultsArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    planInputHash: input.initialPlan.inputHash,
    roundsCompleted,
    results,
    summary: {
      requestCount,
      cacheHitCount: results.reduce(
        (sum, result) => sum + result.cacheHitCount,
        0,
      ),
      acceptedCandidateCount: results.reduce(
        (sum, result) => sum + result.acceptedCueIds.length,
        0,
      ),
      rejectedCandidateCount: results
        .filter((result) => result.decision === "rejected")
        .reduce((sum, result) => sum + result.candidateCueIds.length, 0),
      rejectedHallucinationCount: results.reduce(
        (sum, result) =>
          sum +
          result.reasons.filter((reason) =>
            reason.toLowerCase().includes("hallucination"),
          ).length,
        0,
      ),
      rejectedNoAudibleSpeechCount: results.reduce(
        (sum, result) =>
          sum +
          result.reasons.filter((reason) => reason.includes("no-audible"))
            .length,
        0,
      ),
      workerStartCount: input.workerStartCount ?? 0,
      modelLoadCount: input.modelLoadCount ?? 0,
      fallbackProcessCount: input.fallbackProcessCount ?? 0,
    },
    stopReason,
  });
  return { cues, artifact };
}
