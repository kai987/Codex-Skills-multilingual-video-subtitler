import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  c6015QualityMetricsSchema,
  InputError,
  machineCandidatePoolC6015Schema,
  machineCanonicalMutationLedgerSchema,
  machineEventToFinalCueLineageSchema,
  machineEvidenceApplicationCoverageSchema,
  machineGlobalTokenTimelineV2Schema,
  machineSingleVariantAcousticAuditSchema,
  pathExists,
  subtitlePackageSchema,
  type C6015QualityMetrics,
  type MachineVsGoldEvaluation,
} from "@mvl/shared";
import { parseAss } from "@mvl/subtitle-core";
import {
  createZeroTouchBlindGenerationProof,
  evaluateFrozenBlindRunAgainstGold,
  evaluateTextVariantOracle,
  machineQualitySemanticHash,
  normalizeC601GoldAssTimestamps,
  verifyBlindOutputFreeze,
} from "@mvl/video-subtitler";

const POLICY_VERSION = "c6.0.1.5-evidence-to-canonical-raw-asr-recovery-v1";

function parseArguments(argv: readonly string[]): Map<string, string> {
  const allowed = new Set([
    "--run",
    "--gold",
    "--gold-size",
    "--gold-sha256",
    "--output",
  ]);
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !allowed.has(flag)) {
      throw new InputError("Invalid C6.0.1.5 Gold evaluation arguments.", {
        flag,
        allowed: [...allowed],
      });
    }
    result.set(flag, value);
  }
  return result;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined || value === "") {
    throw new InputError(`Missing required argument ${flag}.`);
  }
  return value;
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function onlySubtitleDirectory(taskDirectory: string): Promise<string> {
  const entries = (await readdir(taskDirectory, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => entry.name)
    .toSorted();
  if (entries.length !== 1 || entries[0] === undefined) {
    throw new InputError("Expected exactly one subtitle artifact directory.", {
      taskDirectory,
      entries,
    });
  }
  return path.join(taskDirectory, entries[0]);
}

function overlapCount(cues: readonly { start: number; end: number }[]): number {
  const ordered = cues.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let count = 0;
  for (const [index, cue] of ordered.entries()) {
    for (const other of ordered.slice(index + 1)) {
      if (other.start >= cue.end) break;
      if (other.start < cue.end && cue.start < other.end) count += 1;
    }
  }
  return count;
}

function qualityMetrics(input: {
  evaluation: MachineVsGoldEvaluation;
  cues: readonly { start: number; end: number }[];
  trustedMappedTokenCount: number;
  ambiguousTimeBaseTokenCount: number;
  rawAsrOriginErrorCount: number;
  associationErrorCount: number;
  eventFinalLineageCoverage: number;
  unsupportedMutationCount: number;
}): C6015QualityMetrics {
  return c6015QualityMetricsSchema.parse({
    cueCount: input.evaluation.alignmentMetrics.machineCueCount,
    exactCer: input.evaluation.globalTextMetrics.exact.cer,
    normalizedCer: input.evaluation.globalTextMetrics.normalized.cer,
    goldCoverage: input.evaluation.coverageMetrics.goldTextCoverageRatio,
    missingCount: input.evaluation.missingDialogueCandidates.length,
    hallucinationCount: input.evaluation.hallucinationCandidates.length,
    materialErrorCount: input.evaluation.materialTextErrors.length,
    severeTimingErrorCount: input.evaluation.severeTimingErrors.length,
    startMaeSeconds: input.evaluation.timingMetrics.startMaeSeconds,
    endMaeSeconds: input.evaluation.timingMetrics.endMaeSeconds,
    p95BoundaryErrorSeconds: input.evaluation.timingMetrics.boundaryP95Seconds,
    medianTemporalIou: input.evaluation.timingMetrics.timingIoUMedian,
    overlapPairCount: overlapCount(input.cues),
    trustedMappedTokenCount: input.trustedMappedTokenCount,
    ambiguousTimeBaseTokenCount: input.ambiguousTimeBaseTokenCount,
    rawAsrOriginErrorCount: input.rawAsrOriginErrorCount,
    associationErrorCount: input.associationErrorCount,
    eventFinalLineageCoverage: input.eventFinalLineageCoverage,
    unsupportedMutationCount: input.unsupportedMutationCount,
  });
}

const args = parseArguments(process.argv.slice(2));
const taskDirectory = path.resolve(required(args, "--run"));
const goldPath = path.resolve(required(args, "--gold"));
const outputDirectory = path.resolve(required(args, "--output"));
const expectedGoldSize = Number(required(args, "--gold-size"));
const expectedGoldSha256 = required(args, "--gold-sha256");
if (!Number.isSafeInteger(expectedGoldSize) || expectedGoldSize <= 0) {
  throw new InputError("--gold-size must be a positive safe integer.");
}
if (!/^[a-f0-9]{64}$/u.test(expectedGoldSha256)) {
  throw new InputError("--gold-sha256 must be a lowercase SHA-256.");
}
if (await pathExists(outputDirectory)) {
  throw new InputError("Evaluation output exists; overwrite is forbidden.", {
    outputDirectory,
  });
}
await mkdir(outputDirectory, { recursive: false });
const freeze = await verifyBlindOutputFreeze({ taskDirectory });
const subtitleDirectory = await onlySubtitleDirectory(taskDirectory);
const [
  packageArtifact,
  lineage,
  candidatePool,
  audit,
  coverage,
  ledger,
  timeline,
] = await Promise.all([
  json(path.join(subtitleDirectory, "subtitle-package.json")).then((value) =>
    subtitlePackageSchema.parse(value),
  ),
  json(
    path.join(subtitleDirectory, "machine-event-to-final-cue-lineage.json"),
  ).then((value) => machineEventToFinalCueLineageSchema.parse(value)),
  json(
    path.join(subtitleDirectory, "machine-candidate-pool-c6-0-1-5.json"),
  ).then((value) => machineCandidatePoolC6015Schema.parse(value)),
  json(
    path.join(subtitleDirectory, "machine-single-variant-acoustic-audit.json"),
  ).then((value) => machineSingleVariantAcousticAuditSchema.parse(value)),
  json(
    path.join(subtitleDirectory, "machine-evidence-application-coverage.json"),
  ).then((value) => machineEvidenceApplicationCoverageSchema.parse(value)),
  json(
    path.join(subtitleDirectory, "machine-canonical-mutation-ledger.json"),
  ).then((value) => machineCanonicalMutationLedgerSchema.parse(value)),
  json(
    path.join(subtitleDirectory, "machine-global-token-timeline-v2.json"),
  ).then((value) => machineGlobalTokenTimelineV2Schema.parse(value)),
]);

const frozenBeforeGoldAt = new Date().toISOString();
const preGoldProof = await createZeroTouchBlindGenerationProof({
  taskDirectory,
  phase: "pre-gold",
  barrierReachedAt: frozenBeforeGoldAt,
  goldFirstReadAt: null,
  outputHashAfterGold: null,
});
await atomicWriteJson(
  path.join(taskDirectory, "zero-touch-blind-generation-proof.pre-gold.json"),
  preGoldProof,
  { overwrite: true },
);
const result = await evaluateFrozenBlindRunAgainstGold({
  taskDirectory,
  goldPath,
  expectedGoldSize,
  expectedGoldSha256,
  generatedAt: new Date().toISOString(),
  frozenBeforeGoldAt,
});
const goldAfterEvaluation = await readFile(goldPath);
const goldAfterHash = createHash("sha256")
  .update(goldAfterEvaluation)
  .digest("hex");
if (
  goldAfterEvaluation.byteLength !== expectedGoldSize ||
  goldAfterHash !== expectedGoldSha256
) {
  throw new InputError("Gold changed during post-freeze evaluation.");
}
const goldCues = parseAss(
  normalizeC601GoldAssTimestamps(goldAfterEvaluation.toString("utf8")).content,
).map((cue, index) => ({
  cueId: `gold-${String(index + 1).padStart(4, "0")}`,
  text: cue.text,
}));
const cueIndexById = new Map(
  packageArtifact.cues.map((cue, index) => [cue.id, index] as const),
);
const lineageByEvent = new Map(
  lineage.events.map((event) => [event.eventId, event] as const),
);
const candidatesByEvent = new Map<string, typeof candidatePool.candidates>();
for (const candidate of candidatePool.candidates) {
  const candidates = candidatesByEvent.get(candidate.eventId) ?? [];
  candidates.push(candidate);
  candidatesByEvent.set(candidate.eventId, candidates);
}
const oracleInputs = candidatePool.events.map((event) => {
  const eventLineage = lineageByEvent.get(event.eventId);
  const cueIndexes = (eventLineage?.finalCueIds ?? []).flatMap((cueId) => {
    const index = cueIndexById.get(cueId);
    return index === undefined ? [] : [index];
  });
  const alignments = result.evaluation.alignments.filter((alignment) =>
    alignment.machineCueIndexes.some((index) => cueIndexes.includes(index)),
  );
  const unambiguous =
    eventLineage?.lineageStatus === "EXACT_ONE_TO_ONE" &&
    cueIndexes.length === 1 &&
    alignments.length === 1 &&
    alignments[0]?.classification === "matched";
  const matchedGoldCues = unambiguous
    ? (alignments[0]?.goldCueIndexes ?? []).flatMap((index) => {
        const cue = goldCues[index];
        return cue === undefined ? [] : [cue];
      })
    : [];
  return {
    eventId: event.eventId,
    selectedCandidateId: event.selectedVariantId,
    variants: (candidatesByEvent.get(event.eventId) ?? []).map((candidate) => ({
      candidateId: candidate.candidateId,
      text: candidate.text,
    })),
    matchedGoldCues,
    associationAmbiguous: !unambiguous,
  };
});
const oracle = evaluateTextVariantOracle({
  generatedAt: new Date().toISOString(),
  freezeVerifiedBeforeGold: true,
  machineFreezeHash: freeze.freezeSemanticHash,
  goldIdentityHash: expectedGoldSha256,
  events: oracleInputs,
});
const oracleClassByEvent = new Map(
  oracle.eventEntries.map((entry) => [entry.eventId, entry.oracleClass]),
);
const poolSizeByEvent = new Map(
  candidatePool.events.map((event) => [
    event.eventId,
    event.candidateIds.length,
  ]),
);
const eventIdsByCueIndex = new Map<number, string[]>();
for (const event of lineage.events) {
  for (const cueId of event.finalCueIds) {
    const cueIndex = cueIndexById.get(cueId);
    if (cueIndex === undefined) continue;
    const eventIds = eventIdsByCueIndex.get(cueIndex) ?? [];
    eventIds.push(event.eventId);
    eventIdsByCueIndex.set(cueIndex, eventIds);
  }
}
const auditByEvent = new Map(
  audit.events.map((event) => [event.eventId, event] as const),
);
const attributions = result.evaluation.materialTextErrors.map((defect) => {
  const alignmentIds = new Set(defect.alignmentIds);
  const eventIds = [
    ...new Set(
      result.evaluation.alignments
        .filter((alignment) => alignmentIds.has(alignment.alignmentId))
        .flatMap((alignment) =>
          alignment.machineCueIndexes.flatMap(
            (index) => eventIdsByCueIndex.get(index) ?? [],
          ),
        ),
    ),
  ].toSorted();
  const oracleClasses = eventIds.map((eventId) =>
    oracleClassByEvent.get(eventId),
  );
  const associationAmbiguous = eventIds.some((eventId) => {
    const status = lineageByEvent.get(eventId)?.lineageStatus;
    return status !== "EXACT_ONE_TO_ONE";
  });
  const category =
    eventIds.length === 0 || associationAmbiguous
      ? ("ASSOCIATION_ERROR" as const)
      : oracleClasses.includes("SELECTOR_ERROR")
        ? ("SELECTOR_ERROR" as const)
        : eventIds.every((eventId) => auditByEvent.has(eventId))
          ? ("RAW_ASR_ORIGIN" as const)
          : oracleClasses.includes("POOL_INSUFFICIENT") &&
              eventIds.some(
                (eventId) => (poolSizeByEvent.get(eventId) ?? 0) > 1,
              )
            ? ("POOL_INSUFFICIENT" as const)
            : ("UNKNOWN" as const);
  const machineFlagged = eventIds.some(
    (eventId) => auditByEvent.get(eventId)?.reAsrEligibility === true,
  );
  return {
    defectId: defect.defectId,
    alignmentIds: defect.alignmentIds,
    eventIds,
    category,
    machineFlagged,
  };
});
const rawOrigin = attributions.filter(
  (entry) => entry.category === "RAW_ASR_ORIGIN",
);
const associationErrors = attributions.filter(
  (entry) => entry.category === "ASSOCIATION_ERROR",
);
const rawOriginEventIds = new Set(rawOrigin.flatMap((entry) => entry.eventIds));
const flaggedEvents = new Set(
  audit.events
    .filter((event) => event.reAsrEligibility)
    .map((event) => event.eventId),
);
const truePositiveEvents = new Set(
  [...rawOriginEventIds].filter((eventId) => flaggedEvents.has(eventId)),
);
const falsePositiveWeakEvents = [...flaggedEvents].filter(
  (eventId) => !rawOriginEventIds.has(eventId),
).length;
const rawErrorDetection = {
  rawOriginErrorCount: rawOrigin.length,
  rawOriginFlaggedByMachine: rawOrigin.filter((entry) => entry.machineFlagged)
    .length,
  rawOriginMissedByMachine: rawOrigin.filter((entry) => !entry.machineFlagged)
    .length,
  machineFalsePositiveWeakEvents: falsePositiveWeakEvents,
  precision:
    flaggedEvents.size === 0
      ? rawOriginEventIds.size === 0
        ? 1
        : 0
      : truePositiveEvents.size / flaggedEvents.size,
  recall:
    rawOriginEventIds.size === 0
      ? 1
      : truePositiveEvents.size / rawOriginEventIds.size,
};
const metrics = qualityMetrics({
  evaluation: result.evaluation,
  cues: packageArtifact.cues,
  trustedMappedTokenCount: timeline.summary.trustedMappedTokenCount,
  ambiguousTimeBaseTokenCount: timeline.summary.ambiguousTimeBaseTokenCount,
  rawAsrOriginErrorCount: rawOrigin.length,
  associationErrorCount: associationErrors.length,
  eventFinalLineageCoverage: lineage.summary.lineageCoverageRatio,
  unsupportedMutationCount: ledger.summary.unsupportedMutationCount,
});
const rawMetrics =
  result.rawAsrEvaluation === null
    ? metrics
    : qualityMetrics({
        evaluation: result.rawAsrEvaluation,
        cues: [],
        trustedMappedTokenCount: 0,
        ambiguousTimeBaseTokenCount: 0,
        rawAsrOriginErrorCount:
          result.rawAsrEvaluation.materialTextErrors.length,
        associationErrorCount: 0,
        eventFinalLineageCoverage: lineage.summary.lineageCoverageRatio,
        unsupportedMutationCount: 0,
      });
const postHocCore = {
  evaluationPhase: "post-freeze-gold-isolated",
  runtimeGoldInputCount: 0,
  machineFreezeHash: freeze.freezeSemanticHash,
  goldIdentityHash: expectedGoldSha256,
  goldTextPersisted: false,
  entries: attributions,
  summary: {
    materialErrorCount: attributions.length,
    rawAsrOriginErrorCount: rawOrigin.length,
    associationErrorCount: associationErrors.length,
    selectorErrorCount: oracle.aggregateMetrics.selectorErrorCount,
    poolInsufficientCount: oracle.aggregateMetrics.poolInsufficientCount,
    unknownCount: attributions.filter((entry) => entry.category === "UNKNOWN")
      .length,
  },
  rawErrorDetection,
};
const runMetricsCore = {
  policyVersion: POLICY_VERSION,
  evaluationPhase: "post-freeze-gold-isolated",
  runtimeGoldInputCount: 0,
  machineFreezeHash: freeze.freezeSemanticHash,
  goldIdentityHash: expectedGoldSha256,
  goldReadOnlyVerified: true,
  outputHashUnchangedAfterGold: result.evaluation.outputHashUnchangedAfterGold,
  candidate: metrics,
  rawAsr: rawMetrics,
  rawErrorDetection,
  oracle: oracle.aggregateMetrics,
  evidenceApplication: coverage,
};
const postGoldProof = await createZeroTouchBlindGenerationProof({
  taskDirectory,
  phase: "post-gold",
  barrierReachedAt: frozenBeforeGoldAt,
  goldFirstReadAt: result.goldFirstReadAt,
  outputHashAfterGold: result.outputHashAfterGold,
});
await Promise.all([
  atomicWriteJson(
    path.join(outputDirectory, "machine-vs-gold-evaluation.json"),
    result.evaluation,
  ),
  ...(result.rawAsrEvaluation === null
    ? []
    : [
        atomicWriteJson(
          path.join(outputDirectory, "raw-asr-vs-gold-evaluation.json"),
          result.rawAsrEvaluation,
        ),
      ]),
  atomicWriteJson(
    path.join(
      outputDirectory,
      "machine-c6-0-1-5-candidate-oracle-evaluation.json",
    ),
    oracle,
  ),
  atomicWriteJson(
    path.join(outputDirectory, "c6-0-1-5-post-hoc-error-attribution.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-5-post-hoc-error-attribution",
      ...postHocCore,
      semanticHash: machineQualitySemanticHash(postHocCore),
    },
  ),
  atomicWriteJson(
    path.join(outputDirectory, "c6-0-1-5-run-quality-metrics.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-5-run-quality-metrics",
      generatedAt: new Date().toISOString(),
      ...runMetricsCore,
      semanticHash: machineQualitySemanticHash(runMetricsCore),
    },
  ),
  atomicWriteJson(
    path.join(outputDirectory, "zero-touch-blind-generation-proof.json"),
    postGoldProof,
  ),
  atomicWriteJson(path.join(outputDirectory, "gold-evaluator-replay.json"), {
    schemaVersion: "1.0.0",
    artifactType: "gold-evaluator-replay",
    modelInferenceCount: 0,
    initialSemanticHash: result.evaluation.semanticHash,
    replaySemanticHash: result.replaySemanticHash,
    deterministic: result.evaluation.semanticHash === result.replaySemanticHash,
  }),
]);
console.log(
  JSON.stringify(
    {
      outputDirectory,
      metrics,
      rawErrorDetection,
      oracle: oracle.aggregateMetrics,
      goldReadOnlyVerified: true,
      outputHashUnchangedAfterGold:
        result.evaluation.outputHashUnchangedAfterGold,
      runtimeGoldInputCount: 0,
    },
    null,
    2,
  ),
);
