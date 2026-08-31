import {
  c60114CoverageLayerNames,
  c60114PlaybackCoverageInputSchema,
  c60114PlaybackCoverageEvaluationSchema,
  type C60114EvaluationInterval,
  type C60114PlaybackCoverageInput,
  type C60114CoverageLayer,
  type C60114ComponentCoverage,
  type C60114CoverageLayerName,
  type C60114BudgetCoverage,
  type C60114PlaybackCoverageEvaluation,
} from "@mvl/shared";
import { c60113HashPayload } from "./c60113-region-features.js";
import { buildC60114RouteDecision } from "./c60114-route-decision.js";

type Interval = C60114EvaluationInterval;
type Input = C60114PlaybackCoverageInput;
interface Row {
  id: string;
  intervals: Interval[];
}
const EPS = 1e-7;
const unique = (values: readonly string[]): string[] =>
  [...new Set(values)].sort();
const length = (values: readonly Interval[]): number =>
  values.reduce((sum, value) => sum + value.end - value.start, 0);

/** Exact set union: only overlap/touch may merge; disjoint errors never become an envelope. */
export function c60114UnionIntervals(values: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const value of [...values].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    if (
      !Number.isFinite(value.start) ||
      !Number.isFinite(value.end) ||
      value.start < 0 ||
      value.end <= value.start
    )
      throw new Error("INVALID_SOURCE_GLOBAL_INTERVAL");
    const previous = result.at(-1);
    if (previous && value.start <= previous.end)
      previous.end = Math.max(previous.end, value.end);
    else result.push({ ...value });
  }
  return result;
}

export function c60114IntersectIntervals(
  a: readonly Interval[],
  b: readonly Interval[],
): Interval[] {
  const result: Interval[] = [];
  for (const left of a)
    for (const right of b) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (end > start) result.push({ start, end });
    }
  return c60114UnionIntervals(result);
}

export function c60114CoverageLayer(
  errors: readonly Interval[],
  rows: readonly Row[],
  status?: "INTEGRITY_FAILED" | "GOLD_MAPPING_UNRESOLVED",
): C60114CoverageLayer {
  const errorUnion = c60114UnionIntervals(errors);
  const errorDurationSeconds = length(errorUnion);
  const overlapSeconds = status
    ? 0
    : length(
        c60114IntersectIntervals(
          errorUnion,
          rows.flatMap((row) => row.intervals),
        ),
      );
  const coverageRatio =
    errorDurationSeconds > 0
      ? Math.min(1, overlapSeconds / errorDurationSeconds)
      : 0;
  const any = overlapSeconds > 0;
  const majority = coverageRatio >= 0.5;
  const audible = coverageRatio >= 0.8;
  const full = coverageRatio >= 0.95;
  return {
    covered: audible,
    overlapSeconds,
    errorDurationSeconds,
    coverageRatio,
    coveringIds: status
      ? []
      : unique(
          rows
            .filter(
              (row) =>
                c60114IntersectIntervals(errorUnion, row.intervals).length > 0,
            )
            .map((row) => row.id),
        ),
    any,
    majority,
    audible,
    full,
    status:
      status ??
      (full
        ? "FULL"
        : audible
          ? "AUDIBLE"
          : majority
            ? "MAJORITY"
            : any
              ? "PARTIAL"
              : "NO_OVERLAP"),
  };
}

function lineage(
  errors: readonly Interval[],
  ids: string[],
): C60114CoverageLayer {
  return {
    ...c60114CoverageLayer(errors, []),
    covered: ids.length > 0,
    coveringIds: unique(ids),
    status: "NOT_A_PLAYBACK_RECALL_METRIC",
  };
}

function identityFailures(
  expected: Input["sourceIdentity"],
  actual: Input["sourceIdentity"],
  label: string,
): string[] {
  return (Object.keys(expected) as (keyof Input["sourceIdentity"])[])
    .filter((key) => expected[key] !== actual[key])
    .map((key) => `SOURCE_IDENTITY_MISMATCH:${label}:${key}`);
}

function duplicates(ids: string[], name: string): string[] {
  return unique(ids.filter((id, index) => ids.indexOf(id) !== index)).map(
    (id) => `DUPLICATE_${name}:${id}`,
  );
}

/** Distinct family plus pairwise-disjoint root/correlation provenance, never profile count. */
function independentLexicalSources(rows: Input["lexicalEvidence"]): number {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.rootLineageIds.length === 0) continue;
    const key = row.providerFamily;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const byFamily = [...groups.values()];
  let best = 0;
  const visit = (index: number, used: Set<string>, total: number): void => {
    if (total + byFamily.length - index <= best) return;
    const family = byFamily[index];
    if (!family) {
      best = Math.max(best, total);
      return;
    }
    visit(index + 1, used, total);
    for (const row of family) {
      const keys = [
        ...row.rootLineageIds.map((root) => `root:${root}`),
        `correlation:${row.correlationGroup}`,
      ];
      if (keys.some((key) => used.has(key))) continue;
      visit(index + 1, new Set([...used, ...keys]), total + 1);
    }
  };
  visit(0, new Set(), 0);
  return best;
}

function evaluateComponent(
  input: Input,
  component: Input["errorComponents"][number],
  selected: {
    targetIds: Set<string>;
    itemIds: Set<string>;
    regionIds: Set<string>;
    targetRows: Row[];
    regionRows: Row[];
    audioRows: Row[];
    playbackRows: Row[];
    audibleRows: Row[];
  },
  integrityFailed: boolean,
): C60114ComponentCoverage {
  const errors = c60114UnionIntervals(component.errorIntervals);
  const invalid =
    component.mappingStatus !== "RESOLVED" || errors.length === 0
      ? "GOLD_MAPPING_UNRESOLVED"
      : integrityFailed
        ? "INTEGRITY_FAILED"
        : undefined;
  const spatial = (rows: Row[]) => c60114CoverageLayer(errors, rows, invalid);
  const localized = input.lexicalEvidence.filter(
    (row) =>
      row.reliableLocalizedLexical &&
      row.mappingStatus === "VERIFIED" &&
      row.sourceInterval !== null &&
      row.rootLineageIds.length > 0,
  );
  const lexicalSourceGroups = new Map<
    string,
    { representative: Input["lexicalEvidence"][number]; intervals: Interval[] }
  >();
  for (const row of localized) {
    const key = JSON.stringify([
      row.providerFamily,
      row.correlationGroup,
      unique(row.rootLineageIds),
    ]);
    const group = lexicalSourceGroups.get(key) ?? {
      representative: row,
      intervals: [],
    };
    if (row.sourceInterval) group.intervals.push(row.sourceInterval);
    lexicalSourceGroups.set(key, group);
  }
  const layers: C60114ComponentCoverage["layers"] = {
    itemLineage: lineage(
      errors,
      component.coveredItemIds.filter((id) => selected.itemIds.has(id)),
    ),
    regionMembership: lineage(
      errors,
      component.coveredRegionIds.filter((id) => selected.regionIds.has(id)),
    ),
    targetInterval: spatial(selected.targetRows),
    regionContext: spatial(selected.regionRows),
    physicalAudio: spatial(selected.audioRows),
    playbackSegments: spatial(selected.playbackRows),
    machineSpeech: spatial(
      input.speechIslands
        .filter(
          (row) => row.speechPositive && row.localizationStatus === "VERIFIED",
        )
        .map((row) => ({ id: row.islandId, intervals: [row.sourceInterval] })),
    ),
    localizedLexical: spatial(
      localized.map((row) => ({
        id: row.evidenceId,
        intervals: row.sourceInterval ? [row.sourceInterval] : [],
      })),
    ),
    orphan: spatial(
      input.orphans
        .filter(
          (row) => row.speechPositive && row.localizationStatus === "VERIFIED",
        )
        .map((row) => ({ id: row.orphanId, intervals: [row.sourceInterval] })),
    ),
    audibleReviewCoverage: spatial(selected.audibleRows),
  };
  const independentLocalizedLexicalSourceCount =
    invalid || errors.length === 0
      ? 0
      : Math.min(
          ...errors.map((error) =>
            independentLexicalSources(
              [...lexicalSourceGroups.values()]
                .filter(
                  (group) =>
                    c60114CoverageLayer(
                      [error],
                      [
                        {
                          id: group.representative.evidenceId,
                          intervals: group.intervals,
                        },
                      ],
                    ).audible,
                )
                .map((group) => group.representative),
            ),
          ),
        );
  const audible = layers.audibleReviewCoverage.audible;
  const findings: C60114ComponentCoverage["findings"] = [];
  if (layers.itemLineage.covered && !audible)
    findings.push("LINEAGE_ONLY_FALSE_COVERAGE");
  if (layers.regionMembership.covered && !audible)
    findings.push("REGION_MEMBERSHIP_WITHOUT_PLAYBACK_COVERAGE");
  if (
    (layers.targetInterval.any ||
      layers.regionContext.any ||
      layers.physicalAudio.any) &&
    !audible
  )
    findings.push("PLAYBACK_OMISSION");
  if (layers.targetInterval.any && !layers.physicalAudio.audible)
    findings.push("TARGET_WITHOUT_AUDIO");
  if (layers.physicalAudio.audible && !layers.playbackSegments.audible)
    findings.push("PLAYBACK_OMITS_TARGET");
  if (
    layers.physicalAudio.any &&
    !layers.targetInterval.any &&
    !layers.regionContext.any
  )
    findings.push("AUDIO_WITHOUT_BINDING");
  const diagnosisFlags: string[] = [];
  const speechPresent =
    layers.machineSpeech.any ||
    layers.orphan.any ||
    layers.localizedLexical.any;
  const targetPresent = layers.targetInterval.any || layers.regionContext.any;
  const isMissingDialogue = component.labels.includes("MISSING_DIALOGUE");
  const unverifiedHint = (input.lineageEvidence ?? []).some(
    (row) =>
      !row.status.startsWith("VERIFIED_") &&
      row.speechPositive &&
      row.claimedInterval &&
      c60114IntersectIntervals(errors, [row.claimedInterval]).length > 0,
  );
  if (invalid) diagnosisFlags.push("EVALUATION_INTEGRITY_FAILURE");
  if (isMissingDialogue && !speechPresent)
    diagnosisFlags.push(
      unverifiedHint
        ? "SOURCE_GLOBAL_LINEAGE_UNVERIFIED"
        : "MACHINE_SPEECH_DETECTION_MISS",
    );
  if (isMissingDialogue && speechPresent && !targetPresent)
    diagnosisFlags.push("MACHINE_REVIEW_LOCALIZATION_MISS");
  if (targetPresent && !audible)
    diagnosisFlags.push("MACHINE_REVIEW_AUDIO_OMISSION");
  if (
    isMissingDialogue &&
    audible &&
    (!layers.localizedLexical.audible ||
      independentLocalizedLexicalSourceCount < 1)
  )
    diagnosisFlags.push("LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE");
  if (audible) diagnosisFlags.push("FULLY_PLAYBACK_COVERED");
  let missingDiagnosis: C60114ComponentCoverage["missingDiagnosis"] = null;
  if (isMissingDialogue) {
    missingDiagnosis = (diagnosisFlags[0] ??
      "MACHINE_REVIEW_AUDIO_OMISSION") as C60114ComponentCoverage["missingDiagnosis"];
  }
  let hallucinationDiagnosis: C60114ComponentCoverage["hallucinationDiagnosis"] =
    null;
  if (component.labels.includes("HALLUCINATION")) {
    hallucinationDiagnosis = invalid
      ? "GOLD_MAPPING_UNRESOLVED"
      : audible && layers.targetInterval.audible
        ? "TARGET_AND_AUDIO_COVERED"
        : !audible && layers.targetInterval.any
          ? "REVIEW_AUDIO_OMISSION"
          : !audible && layers.itemLineage.covered
            ? "LINEAGE_ONLY"
            : !audible && layers.regionMembership.covered
              ? "REGION_MEMBERSHIP_ONLY"
              : !audible
                ? "REVIEW_AUDIO_OMISSION"
                : "DETECTOR_MISS";
  }
  return {
    errorComponentId: component.errorComponentId,
    labels: component.labels,
    errorIntervals: errors,
    layers,
    independentLocalizedLexicalSourceCount,
    missingDiagnosis,
    hallucinationDiagnosis,
    diagnosisFlags,
    findings,
  };
}

function summarize(
  rows: C60114ComponentCoverage[],
  label: "MISSING_DIALOGUE" | "HALLUCINATION",
  layer: C60114CoverageLayerName,
) {
  const relevant = rows.filter((row) => row.labels.includes(label));
  const coveredErrorComponentIds = relevant
    .filter((row) => row.layers[layer].covered)
    .map((row) => row.errorComponentId)
    .sort();
  return {
    total: relevant.length,
    covered: coveredErrorComponentIds.length,
    recall: relevant.length
      ? coveredErrorComponentIds.length / relevant.length
      : 1,
    coveredErrorComponentIds,
  };
}

/** No filesystem, Gold loading, model calls, selection fitting, canonical mutation or inferred playback. */
export function evaluateC60114PlaybackCoverage(
  rawInput: Input,
): C60114PlaybackCoverageEvaluation {
  const input = c60114PlaybackCoverageInputSchema.parse(rawInput);
  const failures: string[] = [];
  for (const [name, values] of [
    [
      "ERROR_COMPONENT",
      input.errorComponents.map((row) => row.errorComponentId),
    ],
    ["ITEM", input.items.map((row) => row.reviewItemId)],
    ["TARGET", input.targets.map((row) => row.reviewTargetId)],
    ["REGION", input.regions.map((row) => row.regionId)],
    ["AUDIO", input.physicalAudio.map((row) => row.audioId)],
    [
      "PLAYBACK_SEGMENT",
      input.playbackSegments.map((row) => row.playbackSegmentId),
    ],
    ["PLAN", input.plans.map((row) => row.planId)],
    ["SPEECH_ISLAND", input.speechIslands.map((row) => row.islandId)],
    ["LEXICAL_EVIDENCE", input.lexicalEvidence.map((row) => row.evidenceId)],
    ["ORPHAN", input.orphans.map((row) => row.orphanId)],
  ] as [string, string[]][])
    failures.push(...duplicates(values, name));
  if (failures.some((value) => value.startsWith("DUPLICATE_ERROR_COMPONENT")))
    throw new Error(failures.join(";"));
  const withinSource = (value: Interval, label: string): void => {
    if (value.end > input.sourceIdentity.durationSeconds + EPS)
      failures.push(`SOURCE_COORDINATE_OUT_OF_BOUNDS:${label}`);
  };
  for (const [name, rows] of [
    ["items", input.items],
    ["errorComponents", input.errorComponents],
    ["targets", input.targets],
    ["regions", input.regions],
    ["physicalAudio", input.physicalAudio],
    ["playbackSegments", input.playbackSegments],
    ["speechIslands", input.speechIslands],
    ["lexicalEvidence", input.lexicalEvidence],
    ["orphans", input.orphans],
    ["lineageEvidence", input.lineageEvidence ?? []],
  ] as [string, { sourceIdentity: Input["sourceIdentity"] }[]][]) {
    rows.forEach((row, index) =>
      failures.push(
        ...identityFailures(
          input.sourceIdentity,
          row.sourceIdentity,
          `${name}:${index}`,
        ),
      ),
    );
  }
  input.targets.forEach((row) =>
    withinSource(row.sourceInterval, row.reviewTargetId),
  );
  input.regions.forEach((row) =>
    [...row.sourceIntervals, ...row.contextIntervals].forEach((value) =>
      withinSource(value, row.regionId),
    ),
  );
  input.speechIslands.forEach((row) =>
    withinSource(row.sourceInterval, row.islandId),
  );
  input.orphans.forEach((row) =>
    withinSource(row.sourceInterval, row.orphanId),
  );
  input.lexicalEvidence.forEach((row) => {
    if (row.sourceInterval) withinSource(row.sourceInterval, row.evidenceId);
  });
  input.errorComponents.forEach((row) => {
    row.errorIntervals.forEach((value) =>
      withinSource(value, row.errorComponentId),
    );
    if (row.mappingStatus !== "RESOLVED" || row.errorIntervals.length === 0)
      failures.push(`GOLD_MAPPING_UNRESOLVED:${row.errorComponentId}`);
  });
  const audioById = new Map(
    input.physicalAudio.map((row) => [row.audioId, row]),
  );
  const validAudio = new Set<string>();
  for (const row of input.physicalAudio) {
    const previous = failures.length;
    withinSource(row.sourceInterval, row.audioId);
    if (row.sourceMediaSha256 !== input.sourceIdentity.sourceMediaSha256)
      failures.push(`AUDIO_SOURCE_HASH_MISMATCH:${row.audioId}`);
    if (
      (row.actualSourceInterval &&
        JSON.stringify(row.actualSourceInterval) !==
          JSON.stringify(row.sourceInterval)) ||
      (row.requestedSourceInterval &&
        JSON.stringify(row.requestedSourceInterval) !==
          JSON.stringify(row.requestedInterval))
    )
      failures.push(`AUDIO_INTERVAL_ALIAS_MISMATCH:${row.audioId}`);
    if (row.semanticHash !== c60113HashPayload(row))
      failures.push(`AUDIO_METADATA_HASH_MISMATCH:${row.audioId}`);
    if (
      Math.abs(row.actualDuration - row.frameCount / row.sampleRate) >
      1 / row.sampleRate + EPS
    )
      failures.push(`AUDIO_FRAME_DURATION_MISMATCH:${row.audioId}`);
    if (
      Math.abs(
        row.sourceInterval.end - row.sourceInterval.start - row.actualDuration,
      ) >
      1 / row.sampleRate + EPS
    )
      failures.push(`AUDIO_SOURCE_DURATION_MISMATCH:${row.audioId}`);
    if (!row.playable)
      failures.push(`PHYSICAL_AUDIO_NOT_PLAYABLE:${row.audioId}`);
    if (!row.hashVerified || !row.physicalMetadataVerified)
      failures.push(`PHYSICAL_AUDIO_NOT_VERIFIED:${row.audioId}`);
    if (failures.length === previous) validAudio.add(row.audioId);
  }
  const segmentById = new Map(
    input.playbackSegments.map((row) => [row.playbackSegmentId, row]),
  );
  const validSegments = new Set<string>();
  for (const row of input.playbackSegments) {
    const previous = failures.length;
    withinSource(row.sourceInterval, row.playbackSegmentId);
    if (row.semanticHash !== c60113HashPayload(row))
      failures.push(`PLAYBACK_METADATA_HASH_MISMATCH:${row.playbackSegmentId}`);
    const audio = audioById.get(row.audioId);
    if (!audio)
      failures.push(
        `PLAYBACK_PHYSICAL_AUDIO_MISSING:${row.playbackSegmentId}:${row.audioId}`,
      );
    else if (
      row.audioLocalInterval.end > audio.actualDuration + EPS ||
      Math.abs(
        row.sourceInterval.start -
          audio.sourceInterval.start -
          row.audioLocalInterval.start,
      ) >
        1 / audio.sampleRate + EPS ||
      Math.abs(
        row.sourceInterval.end -
          audio.sourceInterval.start -
          row.audioLocalInterval.end,
      ) >
        1 / audio.sampleRate + EPS
    )
      failures.push(
        `PLAYBACK_SOURCE_LOCAL_COORDINATE_MISMATCH:${row.playbackSegmentId}`,
      );
    if (failures.length === previous) validSegments.add(row.playbackSegmentId);
  }
  const itemById = new Map(input.items.map((row) => [row.reviewItemId, row]));
  const targetById = new Map(
    input.targets.map((row) => [row.reviewTargetId, row]),
  );
  const regionById = new Map(input.regions.map((row) => [row.regionId, row]));
  const budgets: C60114BudgetCoverage[] = input.plans.map((plan) => {
    const planFailures = [
      ...duplicates(plan.regionIds, "PLAN_REGION"),
      ...duplicates(plan.reviewTargetIds, "PLAN_TARGET"),
      ...duplicates(plan.playbackSegmentIds, "PLAN_SEGMENT"),
    ];
    for (const id of plan.regionIds)
      if (!regionById.has(id)) planFailures.push(`PLAN_REGION_NOT_FOUND:${id}`);
    for (const id of plan.reviewTargetIds)
      if (!targetById.has(id)) planFailures.push(`PLAN_TARGET_NOT_FOUND:${id}`);
    for (const id of plan.playbackSegmentIds)
      if (!segmentById.has(id))
        planFailures.push(`PLAN_PLAYBACK_SEGMENT_NOT_FOUND:${id}`);
    const regions = input.regions.filter((row) =>
      plan.regionIds.includes(row.regionId),
    );
    const targets = input.targets.filter((row) =>
      plan.reviewTargetIds.includes(row.reviewTargetId),
    );
    const segments = input.playbackSegments.filter((row) =>
      plan.playbackSegmentIds.includes(row.playbackSegmentId),
    );
    const itemIds = new Set(
      [
        ...regions.flatMap((row) => row.reviewItemIds),
        ...targets.flatMap((row) =>
          row.parentReviewItemId ? [row.parentReviewItemId] : [],
        ),
      ].filter((id) => itemById.has(id)),
    );
    const audios = input.physicalAudio.filter(
      (row) =>
        row.regionIds.some((id) => plan.regionIds.includes(id)) ||
        row.coveredReviewTargetIds.some((id) =>
          plan.reviewTargetIds.includes(id),
        ) ||
        segments.some((segment) => segment.audioId === row.audioId),
    );
    const audioRows = audios
      .filter((row) => validAudio.has(row.audioId))
      .map((row) => ({ id: row.audioId, intervals: [row.sourceInterval] }));
    const playbackRows = segments
      .filter((row) => validSegments.has(row.playbackSegmentId))
      .map((row) => ({
        id: row.playbackSegmentId,
        intervals: [row.sourceInterval],
      }));
    const audibleRows = segments
      .filter(
        (row) =>
          validSegments.has(row.playbackSegmentId) &&
          validAudio.has(row.audioId),
      )
      .map((row) => ({
        id: row.playbackSegmentId,
        intervals: c60114IntersectIntervals(
          [row.sourceInterval],
          audioRows
            .filter((audio) => audio.id === row.audioId)
            .flatMap((audio) => audio.intervals),
        ),
      }));
    const audibleIntersectionIntervals = c60114UnionIntervals(
      audibleRows.flatMap((row) => row.intervals),
    );
    const actualAudibleUniqueSeconds = length(audibleIntersectionIntervals);
    if (
      plan.budgetSeconds !== null &&
      actualAudibleUniqueSeconds > plan.budgetSeconds + EPS
    )
      planFailures.push("ACTUAL_PLAYBACK_EXCEEDS_FROZEN_BUDGET");
    const allFailures = unique([...failures, ...planFailures]);
    const componentCoverage = input.errorComponents.map((component) =>
      evaluateComponent(
        input,
        component,
        {
          targetIds: new Set(plan.reviewTargetIds),
          itemIds,
          regionIds: new Set(plan.regionIds),
          targetRows: targets.map((row) => ({
            id: row.reviewTargetId,
            intervals: [row.sourceInterval],
          })),
          regionRows: regions.map((row) => ({
            id: row.regionId,
            intervals: row.contextIntervals,
          })),
          audioRows,
          playbackRows,
          audibleRows,
        },
        allFailures.length > 0,
      ),
    );
    const layered = (label: "MISSING_DIALOGUE" | "HALLUCINATION") =>
      Object.fromEntries(
        c60114CoverageLayerNames.map((name) => [
          name,
          summarize(componentCoverage, label, name),
        ]),
      ) as C60114BudgetCoverage["missingRecall"];
    return {
      planId: plan.planId,
      budgetSeconds: plan.budgetSeconds,
      selectedRegionIds: plan.regionIds,
      selectedReviewTargetIds: plan.reviewTargetIds,
      selectedPlaybackSegmentIds: plan.playbackSegmentIds,
      selectedAudioIds: audios.map((row) => row.audioId),
      exactPlaybackSegments: segments,
      playableSourceIntervals: c60114UnionIntervals(
        audioRows.flatMap((row) => row.intervals),
      ),
      selectedPlaybackIntervals: c60114UnionIntervals(
        playbackRows.flatMap((row) => row.intervals),
      ),
      audibleIntersectionIntervals,
      actualAudibleUniqueSeconds,
      missingRecall: layered("MISSING_DIALOGUE"),
      hallucinationRecall: layered("HALLUCINATION"),
      officialMissingRecall: summarize(
        componentCoverage,
        "MISSING_DIALOGUE",
        "audibleReviewCoverage",
      ),
      officialHallucinationRecall: summarize(
        componentCoverage,
        "HALLUCINATION",
        "audibleReviewCoverage",
      ),
      componentCoverage,
      integrityFailures: allFailures,
    };
  });
  const requiredPlans = [10, 20, 30, 40, 50]
    .map((n) => `UNIQUE_AUDIO_${n}_PERCENT`)
    .concat(["ALL_MANDATORY", "FULL_QUEUE"]);
  for (const id of requiredPlans)
    if (!budgets.some((row) => row.planId === id))
      failures.push(`REQUIRED_FROZEN_PLAN_MISSING:${id}`);
  const gates = input.engineeringGates;
  const engineeringPassed = !(
    !gates.engineeringPassed ||
    !gates.baselineParityPassed ||
    !gates.machineFreezeVerified ||
    gates.runtimeGoldInputCount !== 0 ||
    gates.canonicalMutationCount !== 0 ||
    gates.machineDraftMutationCount !== 0 ||
    gates.sourceMutationCount !== 0 ||
    gates.goldMutationCount !== 0
  );
  const integrityFailures = unique([
    ...failures,
    ...budgets.flatMap((row) => row.integrityFailures),
  ]);
  const fullQueue = budgets.find((row) => row.planId === "FULL_QUEUE");
  const requiredTargetAudioGatePassed = input.targets
    .filter((row) => row.audioRequired ?? row.mandatoryForAudio)
    .every((target) => {
      // A clip's coveredReviewTargetIds declares full-target delivery, whereas
      // deduplicated playback may use sample-equivalent overlapping clips from
      // another region for only part of that target. Verify these two proofs
      // separately; do not require every atomic segment's clip to own the whole
      // target. Neither proof depends on any Gold interval or label.
      const physicalCoverage = c60114CoverageLayer(
        [target.sourceInterval],
        input.physicalAudio
          .filter(
            (audio) =>
              validAudio.has(audio.audioId) &&
              audio.coveredReviewTargetIds.includes(target.reviewTargetId),
          )
          .map((audio) => ({
            id: audio.audioId,
            intervals: [audio.sourceInterval],
          })),
      );
      const boundSegments = (fullQueue?.exactPlaybackSegments ?? []).filter(
        (segment) => segment.reviewTargetIds.includes(target.reviewTargetId),
      );
      const playbackCoverage = c60114CoverageLayer(
        [target.sourceInterval],
        boundSegments.flatMap((segment) => {
          const audio = audioById.get(segment.audioId);
          return audio &&
            validAudio.has(audio.audioId) &&
            validSegments.has(segment.playbackSegmentId)
            ? [
                {
                  id: segment.playbackSegmentId,
                  intervals: c60114IntersectIntervals(
                    [segment.sourceInterval],
                    [audio.sourceInterval],
                  ),
                },
              ]
            : [];
        }),
      );
      // Required machine targets need complete delivery, not the separate 0.8
      // post-freeze Gold audible-recall threshold. Existing numerical tolerance
      // matches the delivery graph's full-target checks.
      return (
        physicalCoverage.coverageRatio >= 1 - EPS &&
        playbackCoverage.coverageRatio >= 1 - EPS
      );
    });
  const routeDecision = buildC60114RouteDecision({
    coverageInput: input,
    fullQueue,
    integrityFailures,
    engineeringPassed,
    requiredTargetAudioGatePassed,
  });
  const route = routeDecision.primaryDecision;
  const routeReasons = unique(
    routeDecision.blockers.flatMap((row) => [row.diagnosis, ...row.reasons]),
  );
  if (!routeReasons.length)
    routeReasons.push(
      "FULL_QUEUE_AND_REQUIRED_TARGET_AUDIO_PASSED_RANKER_RECALIBRATION_ONLY_NO_RELEASE",
    );
  const value = {
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.14-playback-grounded-coverage-v1",
    artifactType: "c6-0-1-14-playback-grounded-coverage-evaluation",
    generatedAt: input.generatedAt,
    sourceIdentity: input.sourceIdentity,
    thresholds: {
      any: 0,
      anyComparison: "STRICTLY_GREATER_THAN",
      majority: 0.5,
      audible: 0.8,
      full: 0.95,
    },
    officialRecallMetric:
      "PHYSICAL_PLAYABLE_AUDIO_INTERSECT_ACTUAL_PLAYBACK_AUDIBLE_0_8",
    lineageMetricStatus: "NOT_A_PLAYBACK_RECALL_METRIC",
    errorIntervalPolicy:
      "UNION_OF_ATOMIC_ALIGNMENT_INTERVALS_NEVER_OUTER_ENVELOPE",
    budgets,
    integrityFailures,
    route,
    routeReasons,
    routeDecision,
    engineeringGates: gates,
    rankerTrainingPerformed: false,
    c602Status: "HOLD",
    realHumanTrialExecuted: false,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
  };
  return c60114PlaybackCoverageEvaluationSchema.parse({
    ...value,
    semanticHash: c60113HashPayload(value),
  });
}
