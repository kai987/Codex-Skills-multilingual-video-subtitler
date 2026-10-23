import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  c6017QualityMetricsSchema,
  machineFreshCandidateComparisonSchema,
  machineFreshTargetedReAsrSchema,
  machineCandidatePoolC6015Schema,
  machineEventFinalTextSpanLineageSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import {
  buildAsrCeilingEvaluationV2,
  buildAssociationErrorTaxonomy,
  buildReAsrCausalEvaluation,
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-29T12:30:00.000Z";

interface QualityMetricsArtifact {
  candidate: {
    cueCount: number;
    exactCer: number;
    normalizedCer: number;
    goldCoverage: number;
    missingCount: number;
    hallucinationCount: number;
    materialErrorCount: number;
    severeTimingErrorCount: number;
    startMaeSeconds: number;
    endMaeSeconds: number;
    p95BoundaryErrorSeconds: number;
    medianTemporalIou: number;
    overlapPairCount: number;
    trustedMappedTokenCount: number;
    ambiguousTimeBaseTokenCount: number;
    rawAsrOriginErrorCount: number;
    associationErrorCount: number;
    eventFinalLineageCoverage: number;
    unsupportedMutationCount: number;
  };
}

interface MachineVsGoldEvaluation {
  semanticHash: string;
  alignments: {
    alignmentId: string;
    machineCueIndexes: number[];
    goldCueIndexes: number[];
    machineExcerpt: string;
    goldExcerpt: string;
    textSimilarity: number;
    classification: string;
  }[];
}

interface PostHocAttribution {
  entries: {
    defectId: string;
    alignmentIds: string[];
    eventIds: string[];
    category: string;
    machineFlagged: boolean;
  }[];
}

function argument(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index < 0 ? undefined : argv[index + 1];
  if (value === undefined || value === "") throw new Error(`Missing ${flag}.`);
  return value;
}

async function json<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function subtitleDirectory(run: string): Promise<string> {
  const entries = (await readdir(run, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (entries.length !== 1 || entries[0] === undefined) {
    throw new Error(`Expected exactly one subtitle directory in ${run}.`);
  }
  return path.join(run, entries[0].name);
}

function editDistance(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const previous = b.map((_, index) => index + 1);
  previous.unshift(0);
  for (const [leftIndex, leftValue] of a.entries()) {
    const current = [leftIndex + 1];
    for (const [rightIndex, rightValue] of b.entries()) {
      current.push(
        Math.min(
          (current[rightIndex] ?? 0) + 1,
          (previous[rightIndex + 1] ?? 0) + 1,
          (previous[rightIndex] ?? 0) + (leftValue === rightValue ? 0 : 1),
        ),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous.at(-1) ?? 0;
}

function normalizedDistance(left: string, right: string): number {
  const normalizedLeft = normalizeCandidateText(left);
  const normalizedRight = normalizeCandidateText(right);
  return (
    editDistance(normalizedLeft, normalizedRight) /
    Math.max(
      Array.from(normalizedLeft).length,
      Array.from(normalizedRight).length,
      1,
    )
  );
}

function minimumDistance(
  texts: readonly string[],
  gold: string,
): number | null {
  const values = texts
    .filter((text) => normalizeCandidateText(text) !== "")
    .map((text) => normalizedDistance(text, gold));
  return values.length === 0 ? null : Math.min(...values);
}

const argv = process.argv.slice(2);
const run = path.resolve(argument(argv, "--run"));
const freshGenerationRun = path.resolve(
  argument(argv, "--fresh-generation-run"),
);
const evaluationDirectory = path.resolve(argument(argv, "--evaluation"));
const outputDirectory = path.resolve(argument(argv, "--output"));
await mkdir(outputDirectory, { recursive: true });
const runSubtitle = await subtitleDirectory(run);
const freshSubtitle = await subtitleDirectory(freshGenerationRun);

const [
  packageValue,
  pool,
  lineage,
  comparison,
  officialFresh,
  machineEvaluation,
  postHoc,
  quality,
] = await Promise.all([
  json<unknown>(path.join(runSubtitle, "subtitle-package.json")).then((value) =>
    subtitlePackageSchema.parse(value),
  ),
  json<unknown>(
    path.join(runSubtitle, "machine-candidate-pool-c6-0-1-5.json"),
  ).then((value) => machineCandidatePoolC6015Schema.parse(value)),
  json<unknown>(
    path.join(runSubtitle, "machine-event-final-text-span-lineage.json"),
  ).then((value) => machineEventFinalTextSpanLineageSchema.parse(value)),
  json<unknown>(
    path.join(runSubtitle, "machine-fresh-candidate-comparison.json"),
  ).then((value) => machineFreshCandidateComparisonSchema.parse(value)),
  json<unknown>(
    path.join(freshSubtitle, "machine-fresh-targeted-reasr.json"),
  ).then((value) => machineFreshTargetedReAsrSchema.parse(value)),
  json<MachineVsGoldEvaluation>(
    path.join(evaluationDirectory, "machine-vs-gold-evaluation.json"),
  ),
  json<PostHocAttribution>(
    path.join(evaluationDirectory, "c6-0-1-5-post-hoc-error-attribution.json"),
  ),
  json<QualityMetricsArtifact>(
    path.join(evaluationDirectory, "c6-0-1-5-run-quality-metrics.json"),
  ),
]);

if (
  officialFresh.generationKind !== "FRESH_INFERENCE" ||
  officialFresh.summary.freshInferenceCount <= 0
) {
  throw new Error(
    "ASR ceiling evaluation requires the frozen official Fresh inference artifact.",
  );
}

const cueIndexById = new Map(
  packageValue.cues.map((cue, index) => [cue.id, index] as const),
);
const eventsByCue = new Map<string, string[]>();
for (const entry of lineage.events) {
  if (entry.finalCueId === null) continue;
  const values = eventsByCue.get(entry.finalCueId) ?? [];
  values.push(entry.eventId);
  eventsByCue.set(entry.finalCueId, values);
}
const lineageByEvent = new Map(
  lineage.events.map((entry) => [entry.eventId, entry] as const),
);
const poolEventById = new Map(
  pool.events.map((event) => [event.eventId, event] as const),
);
const candidatesByEvent = new Map<string, typeof pool.candidates>();
for (const candidate of pool.candidates) {
  const values = candidatesByEvent.get(candidate.eventId) ?? [];
  values.push(candidate);
  candidatesByEvent.set(candidate.eventId, values);
}
const freshByEvent = new Map<string, typeof officialFresh.candidates>();
for (const candidate of officialFresh.candidates) {
  const values = freshByEvent.get(candidate.eventId) ?? [];
  values.push(candidate);
  freshByEvent.set(candidate.eventId, values);
}
const comparisonByEvent = new Map(
  comparison.events.map((entry) => [entry.eventId, entry] as const),
);
const unstableEventIds = new Set(
  officialFresh.selectedEvents.flatMap((event) => {
    const family = officialFresh.requests.find(
      (request) => request.eventId === event.eventId,
    )?.requestFamilyId;
    return family !== undefined &&
      officialFresh.unstableWindowFamilies.includes(family)
      ? [event.eventId]
      : [];
  }),
);

function goldForEvent(eventId: string): {
  text: string;
  alignmentIds: string[];
} | null {
  const span = lineageByEvent.get(eventId);
  if (span?.finalCueId === null || span?.finalCueId === undefined) return null;
  if ((eventsByCue.get(span.finalCueId)?.length ?? 0) !== 1) return null;
  const cueIndex = cueIndexById.get(span.finalCueId);
  if (cueIndex === undefined) return null;
  const matches = machineEvaluation.alignments.filter((alignment) =>
    alignment.machineCueIndexes.includes(cueIndex),
  );
  if (matches.length !== 1 || matches[0] === undefined) return null;
  const text = matches[0].goldExcerpt;
  if (normalizeCandidateText(text) === "") return null;
  return { text, alignmentIds: [matches[0].alignmentId] };
}

const causalInputs = officialFresh.selectedEvents.map((selected) => {
  const poolEvent = poolEventById.get(selected.eventId);
  const oldCandidates = candidatesByEvent.get(selected.eventId) ?? [];
  const freshCandidates = freshByEvent.get(selected.eventId) ?? [];
  const gold = goldForEvent(selected.eventId);
  const baselineText =
    oldCandidates.find(
      (candidate) => candidate.variantId === poolEvent?.currentVariantId,
    )?.text ?? null;
  const span = lineageByEvent.get(selected.eventId);
  const finalCue =
    span?.finalCueId === null || span?.finalCueId === undefined
      ? undefined
      : packageValue.cues.find((cue) => cue.id === span.finalCueId);
  return {
    eventId: selected.eventId,
    baselineDistance:
      gold === null || baselineText === null
        ? null
        : normalizedDistance(baselineText, gold.text),
    oldPoolBestDistance:
      gold === null
        ? null
        : minimumDistance(
            oldCandidates.map((candidate) => candidate.text),
            gold.text,
          ),
    freshPoolBestDistance:
      gold === null
        ? null
        : minimumDistance(
            [
              ...oldCandidates.map((candidate) => candidate.text),
              ...freshCandidates.map((candidate) => candidate.text),
            ],
            gold.text,
          ),
    runtimeSelectedDistance:
      gold === null || finalCue === undefined
        ? null
        : normalizedDistance(finalCue.text, gold.text),
    freshWindowUnstable: unstableEventIds.has(selected.eventId),
    replacementApplied:
      comparisonByEvent.get(selected.eventId)?.replacementApplied ?? false,
    evidenceIds: [
      selected.semanticHash,
      ...(gold?.alignmentIds ?? []),
      ...(comparisonByEvent.get(selected.eventId) === undefined
        ? []
        : [comparisonByEvent.get(selected.eventId)?.semanticHash ?? ""]),
    ].filter((value) => value !== ""),
  };
});

const causal = buildReAsrCausalEvaluation({
  events: causalInputs,
  generatedAt: GENERATED_AT,
});
const ceiling = buildAsrCeilingEvaluationV2({
  fresh: officialFresh,
  comparison,
  causal,
  generatedAt: GENERATED_AT,
});

const alignmentsById = new Map(
  machineEvaluation.alignments.map((alignment) => [
    alignment.alignmentId,
    alignment,
  ]),
);
const associationErrors = postHoc.entries.filter(
  (entry) => entry.category === "ASSOCIATION_ERROR",
);
const taxonomyInputs = associationErrors.map((error) => {
  const finalCueIds = error.eventIds.flatMap((eventId) => {
    const finalCueId = lineageByEvent.get(eventId)?.finalCueId;
    return finalCueId === null || finalCueId === undefined ? [] : [finalCueId];
  });
  const spans = error.eventIds.flatMap((eventId) => {
    const span = lineageByEvent.get(eventId);
    return span === undefined ? [] : [span];
  });
  const alignmentMachineCueCount = new Set(
    error.alignmentIds.flatMap(
      (alignmentId) => alignmentsById.get(alignmentId)?.machineCueIndexes ?? [],
    ),
  ).size;
  return {
    errorId: error.defectId,
    eventIds: error.eventIds,
    finalCueIds,
    trueWrongUtteranceAssignment: false,
    segmentationAmbiguity:
      error.eventIds.length === 0 || finalCueIds.length === 0,
    eventBoundaryAmbiguity:
      alignmentMachineCueCount !== new Set(finalCueIds).size,
    spanLineageAmbiguity: spans.some(
      (span) =>
        span.lineageStatus === "AMBIGUOUS" ||
        span.lineageStatus === "UNRESOLVED" ||
        !span.modifiable,
    ),
    evidenceIds: [
      ...error.alignmentIds.map((id) => `alignment:${id}`),
      ...spans.map((span) => span.semanticHash),
    ],
  };
});
const associationTaxonomy = buildAssociationErrorTaxonomy({
  errors: taxonomyInputs,
  oldAssociationErrorCount: quality.candidate.associationErrorCount,
  generatedAt: GENERATED_AT,
});

const qualityMetrics = c6017QualityMetricsSchema.parse({
  ...quality.candidate,
  freshSelectedEventCount: officialFresh.summary.selectedEventCount,
  freshInferenceCount: officialFresh.summary.freshInferenceCount,
  freshCandidateCount: officialFresh.summary.freshCandidateCount,
  freshReplacementAppliedCount: comparison.summary.replacementAppliedCount,
});
const attributionEntries = postHoc.entries.map((entry) => ({
  defectId: entry.defectId,
  legacyCategory: entry.category,
  eventIds: entry.eventIds,
  alignmentIds: entry.alignmentIds,
  associationClassifications: associationTaxonomy.entries
    .filter((association) => association.errorId === entry.defectId)
    .map((association) => association.classification),
  ceilingClassifications: ceiling.perEventEntries
    .filter((ceilingEntry) => entry.eventIds.includes(ceilingEntry.eventId))
    .map((ceilingEntry) => ceilingEntry.classification),
}));
const attributionCore = {
  zone: "evaluation-only-gold-isolated-post-freeze",
  runtimeGoldInputCount: 0,
  sourceEvaluationSemanticHash: machineEvaluation.semanticHash,
  entries: attributionEntries,
  summary: {
    entryCount: attributionEntries.length,
    associationEntryCount: associationErrors.length,
    freshSelectedEntryCount: attributionEntries.filter(
      (entry) => entry.ceilingClassifications.length > 0,
    ).length,
  },
};
const attributionV2 = {
  schemaVersion: "1.0.0",
  generatedAt: GENERATED_AT,
  artifactType: "c6-0-1-7-post-hoc-error-attribution-v2",
  ...attributionCore,
  semanticHash: machineQualitySemanticHash(attributionCore),
};

await Promise.all([
  atomicWriteJson(
    path.join(outputDirectory, "machine-reasr-causal-evaluation.json"),
    causal,
  ),
  atomicWriteJson(
    path.join(outputDirectory, "machine-asr-ceiling-evaluation-v2.json"),
    ceiling,
  ),
  atomicWriteJson(
    path.join(outputDirectory, "machine-association-error-taxonomy.json"),
    associationTaxonomy,
  ),
  atomicWriteJson(
    path.join(outputDirectory, "c6-0-1-7-run-quality-metrics.json"),
    qualityMetrics,
  ),
  atomicWriteJson(
    path.join(outputDirectory, "c6-0-1-7-post-hoc-error-attribution-v2.json"),
    attributionV2,
  ),
]);

console.log(
  JSON.stringify(
    {
      outputDirectory,
      qualityMetrics,
      causal: causal.summary,
      ceiling: ceiling.summary,
      associationTaxonomy: associationTaxonomy.summary,
    },
    null,
    2,
  ),
);
