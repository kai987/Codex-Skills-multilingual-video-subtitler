import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  InputError,
  machineVsGoldEvaluationSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { parseAss } from "@mvl/subtitle-core";
import {
  evaluateTextVariantOracle,
  machineQualitySemanticHash,
  normalizeC601GoldAssTimestamps,
  normalizeCandidateText,
  verifyBlindOutputFreeze,
} from "@mvl/video-subtitler";

interface CandidateEvidence {
  cueId: string;
  text: string;
  selectionScore: number;
}

interface AssociationRecord {
  candidateId: string;
  assignedEventId: string | null;
  disposition: string;
}

interface CanonicalEvent {
  eventId: string;
  candidateIds: string[];
  representativeCandidateId: string | null;
}

interface AssemblyOperation {
  eventId: string;
  selectedCandidateId: string;
  outputCueId: string;
}

interface TargetedReasrEvent {
  eventId: string;
  candidateOutputs: { candidateId: string; text: string }[];
}

interface MachineEvent {
  eventId: string;
  selectedCandidateId: string;
  outputCueId: string;
  variants: { candidateId: string; text: string }[];
}

function parseArguments(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined) {
      throw new InputError("Invalid C6.0.1.4 Oracle arguments.");
    }
    parsed.set(flag, value);
  }
  return parsed;
}

function required(args: Map<string, string>, flag: string): string {
  const value = args.get(flag);
  if (value === undefined || value === "") {
    throw new InputError(`Missing required argument ${flag}.`);
  }
  return value;
}

async function json<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function subtitleDirectory(taskDirectory: string): Promise<string> {
  const entries = (await readdir(taskDirectory, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => entry.name)
    .toSorted();
  if (entries.length !== 1 || entries[0] === undefined) {
    throw new InputError("Oracle expected one subtitle artifact directory.", {
      taskDirectory,
      entries,
    });
  }
  return path.join(taskDirectory, entries[0]);
}

function distinctEvents(input: {
  candidates: CandidateEvidence[];
  records: AssociationRecord[];
  canonicalEvents: CanonicalEvent[];
  operations: AssemblyOperation[];
}): MachineEvent[] {
  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.cueId, candidate]),
  );
  const operationByEvent = new Map(
    input.operations.map((operation) => [operation.eventId, operation]),
  );
  const recordsByEvent = new Map<string, AssociationRecord[]>();
  for (const record of input.records) {
    if (record.assignedEventId === null || record.disposition === "REJECTED") {
      continue;
    }
    const current = recordsByEvent.get(record.assignedEventId) ?? [];
    current.push(record);
    recordsByEvent.set(record.assignedEventId, current);
  }
  return input.canonicalEvents.flatMap((event) => {
    const operation = operationByEvent.get(event.eventId);
    const selectedCandidateId =
      operation?.selectedCandidateId ?? event.representativeCandidateId;
    if (selectedCandidateId === null) return [];
    const groups = new Map<string, CandidateEvidence[]>();
    for (const record of recordsByEvent.get(event.eventId) ?? []) {
      const candidate = candidateById.get(record.candidateId);
      if (candidate === undefined) continue;
      const normalized = normalizeCandidateText(candidate.text);
      if (normalized === "") continue;
      const group = groups.get(normalized) ?? [];
      group.push(candidate);
      groups.set(normalized, group);
    }
    const variants = [...groups.values()].flatMap((group) => {
      const candidate =
        group.find((item) => item.cueId === selectedCandidateId) ??
        group.toSorted(
          (left, right) =>
            right.selectionScore - left.selectionScore ||
            left.cueId.localeCompare(right.cueId),
        )[0];
      return candidate === undefined
        ? []
        : [{ candidateId: candidate.cueId, text: candidate.text }];
    });
    if (variants.length === 0) return [];
    const selectedVariant =
      variants.find((variant) => variant.candidateId === selectedCandidateId) ??
      variants[0];
    if (selectedVariant === undefined) return [];
    return [
      {
        eventId: event.eventId,
        selectedCandidateId: selectedVariant.candidateId,
        outputCueId: operation?.outputCueId ?? selectedVariant.candidateId,
        variants: variants.toSorted((left, right) =>
          left.candidateId.localeCompare(right.candidateId),
        ),
      },
    ];
  });
}

const args = parseArguments(process.argv.slice(2));
const runDirectory = path.resolve(required(args, "--run"));
const evaluationPath = path.resolve(required(args, "--evaluation"));
const goldPath = path.resolve(required(args, "--gold"));
const outputDirectory = path.resolve(required(args, "--output"));
const freeze = await verifyBlindOutputFreeze({ taskDirectory: runDirectory });
await mkdir(outputDirectory, { recursive: false });
const subtitle = await subtitleDirectory(runDirectory);
const [
  evaluationValue,
  packageValue,
  candidateValue,
  associationValue,
  canonicalValue,
  assemblyValue,
  reasrValue,
  goldBuffer,
] = await Promise.all([
  json<unknown>(evaluationPath),
  json<unknown>(path.join(subtitle, "subtitle-package.json")),
  json<{ candidates: CandidateEvidence[] }>(
    path.join(subtitle, "cue-candidate-evidence.json"),
  ),
  json<{ records: AssociationRecord[] }>(
    path.join(subtitle, "machine-candidate-association-ledger.json"),
  ),
  json<{ events: CanonicalEvent[] }>(
    path.join(subtitle, "machine-canonical-events.json"),
  ),
  json<{ operations: AssemblyOperation[] }>(
    path.join(subtitle, "machine-canonical-assembly.json"),
  ),
  json<{ events: TargetedReasrEvent[] }>(
    path.join(subtitle, "machine-targeted-event-reasr.json"),
  ),
  readFile(goldPath),
]);
const evaluation = machineVsGoldEvaluationSchema.parse(evaluationValue);
const packageArtifact = subtitlePackageSchema.parse(packageValue);
const goldSha256 = createHash("sha256").update(goldBuffer).digest("hex");
if (
  goldSha256 !== evaluation.goldIdentity.sha256 ||
  goldBuffer.byteLength !== evaluation.goldIdentity.size
) {
  throw new InputError("Oracle Gold identity differs from frozen evaluation.");
}
const goldCues = parseAss(
  normalizeC601GoldAssTimestamps(goldBuffer.toString("utf8")).content,
).map((cue, index) => ({
  cueId: `gold-${String(index + 1).padStart(4, "0")}`,
  text: cue.text,
}));
const machineEvents = distinctEvents({
  candidates: candidateValue.candidates,
  records: associationValue.records,
  canonicalEvents: canonicalValue.events,
  operations: assemblyValue.operations,
});
const cueLineage = packageArtifact.cues.map(
  (cue) => new Set([cue.id, ...(cue.textAudit?.sourceWinnerCueIds ?? [])]),
);
const eventCueIndexes = new Map<string, number[]>();
for (const event of machineEvents) {
  const identities = new Set([
    event.outputCueId,
    event.selectedCandidateId,
    ...event.variants.map((variant) => variant.candidateId),
  ]);
  eventCueIndexes.set(
    event.eventId,
    cueLineage.flatMap((lineage, index) =>
      [...identities].some((identity) => lineage.has(identity)) ? [index] : [],
    ),
  );
}
const eventsByCueIndex = new Map<number, string[]>();
for (const [eventId, cueIndexes] of eventCueIndexes) {
  for (const cueIndex of cueIndexes) {
    const current = eventsByCueIndex.get(cueIndex) ?? [];
    current.push(eventId);
    eventsByCueIndex.set(cueIndex, current);
  }
}
const mappingAudit = machineEvents.map((event) => {
  const cueIndexes = eventCueIndexes.get(event.eventId) ?? [];
  const alignments = evaluation.alignments.filter((alignment) =>
    alignment.machineCueIndexes.some((index) => cueIndexes.includes(index)),
  );
  const sharedCue = cueIndexes.some(
    (index) => (eventsByCueIndex.get(index)?.length ?? 0) > 1,
  );
  const unambiguous =
    cueIndexes.length === 1 &&
    alignments.length === 1 &&
    alignments[0]?.classification === "matched" &&
    alignments[0].goldCueIndexes.length > 0 &&
    !sharedCue;
  const goldCueIndexes = unambiguous
    ? (alignments[0]?.goldCueIndexes ?? [])
    : [];
  return {
    eventId: event.eventId,
    machineCueIndexes: cueIndexes,
    alignmentIds: alignments.map((alignment) => alignment.alignmentId),
    goldCueIndexes,
    mappingStatus: unambiguous ? "EVALUABLE" : "ASSOCIATION_AMBIGUOUS",
    reasons: [
      ...(cueIndexes.length !== 1 ? ["non-unique-machine-cue-lineage"] : []),
      ...(alignments.length !== 1 ? ["non-unique-monotonic-alignment"] : []),
      ...(sharedCue ? ["multiple-events-share-output-cue"] : []),
      ...(alignments[0]?.classification !== "matched"
        ? ["machine-cue-not-matched-to-gold"]
        : []),
    ],
  };
});
const mappingByEvent = new Map(
  mappingAudit.map((entry) => [entry.eventId, entry]),
);
const oracleInputs = machineEvents
  .filter((event) => event.variants.length > 1)
  .map((event) => {
    const mapping = mappingByEvent.get(event.eventId);
    return {
      eventId: event.eventId,
      selectedCandidateId: event.selectedCandidateId,
      variants: event.variants,
      matchedGoldCues: (mapping?.goldCueIndexes ?? []).flatMap((index) => {
        const cue = goldCues[index];
        return cue === undefined ? [] : [cue];
      }),
      associationAmbiguous: mapping?.mappingStatus !== "EVALUABLE",
    };
  });
const existingOracle = evaluateTextVariantOracle({
  generatedAt: new Date().toISOString(),
  freezeVerifiedBeforeGold: true,
  machineFreezeHash: freeze.freezeSemanticHash,
  goldIdentityHash: goldSha256,
  events: oracleInputs,
});
const reasrByEvent = new Map(
  reasrValue.events.map((event) => [event.eventId, event.candidateOutputs]),
);
const extendedOracle = evaluateTextVariantOracle({
  generatedAt: new Date().toISOString(),
  freezeVerifiedBeforeGold: true,
  machineFreezeHash: freeze.freezeSemanticHash,
  goldIdentityHash: goldSha256,
  events: oracleInputs.map((event) => ({
    ...event,
    variants: [
      ...event.variants,
      ...(reasrByEvent.get(event.eventId) ?? []).map((candidate) => ({
        candidateId: candidate.candidateId,
        text: candidate.text,
      })),
    ],
  })),
});
const existingEntries = new Map(
  existingOracle.eventEntries.map((entry) => [entry.eventId, entry]),
);
const reasrAttribution = extendedOracle.eventEntries
  .filter((entry) => reasrByEvent.has(entry.eventId))
  .map((entry) => {
    const before = existingEntries.get(entry.eventId);
    const beforeDistance = before?.oracleDistance ?? null;
    const attribution =
      entry.oracleDistance === null || beforeDistance === null
        ? "UNEVALUABLE"
        : entry.oracleDistance < beforeDistance &&
            entry.oracleCandidateId?.startsWith("targeted-reasr:") === true
          ? "IMPROVED_POOL"
          : "NO_CHANGE";
    return {
      eventId: entry.eventId,
      beforeOracleDistance: beforeDistance,
      afterOracleDistance: entry.oracleDistance,
      oracleCandidateId: entry.oracleCandidateId,
      attribution,
    };
  });
const eventIdsByCueIndex = new Map<number, string[]>();
for (const entry of mappingAudit) {
  for (const cueIndex of entry.machineCueIndexes) {
    const current = eventIdsByCueIndex.get(cueIndex) ?? [];
    current.push(entry.eventId);
    eventIdsByCueIndex.set(cueIndex, current);
  }
}
const oracleClassByEvent = new Map(
  existingOracle.eventEntries.map((entry) => [
    entry.eventId,
    entry.oracleClass,
  ]),
);
const variantCountByEvent = new Map(
  machineEvents.map((event) => [event.eventId, event.variants.length]),
);
const materialAttribution = evaluation.materialTextErrors.map((defect) => {
  const alignmentIds = new Set(defect.alignmentIds);
  const alignments = evaluation.alignments.filter((alignment) =>
    alignmentIds.has(alignment.alignmentId),
  );
  const eventIds = [
    ...new Set(
      alignments.flatMap((alignment) =>
        alignment.machineCueIndexes.flatMap(
          (index) => eventIdsByCueIndex.get(index) ?? [],
        ),
      ),
    ),
  ];
  const oracleClasses = eventIds.map((eventId) =>
    oracleClassByEvent.get(eventId),
  );
  const category = oracleClasses.includes("SELECTOR_ERROR")
    ? "SELECTOR_ERROR"
    : oracleClasses.includes("POOL_INSUFFICIENT")
      ? "POOL_INSUFFICIENT"
      : eventIds.some(
            (eventId) =>
              mappingByEvent.get(eventId)?.mappingStatus ===
              "ASSOCIATION_AMBIGUOUS",
          )
        ? "ASSOCIATION_ERROR"
        : eventIds.length > 0 &&
            eventIds.every(
              (eventId) => (variantCountByEvent.get(eventId) ?? 0) <= 1,
            )
          ? "RAW_ASR_ORIGIN"
          : "UNKNOWN";
  return {
    defectId: defect.defectId,
    alignmentIds: defect.alignmentIds,
    eventIds,
    category,
  };
});
const attributionCategories = [
  "RAW_ASR_ORIGIN",
  "SELECTOR_ERROR",
  "POOL_INSUFFICIENT",
  "ASSOCIATION_ERROR",
  "ORTHOGRAPHIC_AMBIGUITY",
  "HALLUCINATION",
  "UNKNOWN",
] as const;
const attributionSummary = Object.fromEntries(
  attributionCategories.map((category) => [
    category,
    materialAttribution.filter((entry) => entry.category === category).length,
  ]),
);
const goldAfter = await readFile(goldPath);
const goldReadOnlyVerified =
  createHash("sha256").update(goldAfter).digest("hex") === goldSha256;
if (!goldReadOnlyVerified) {
  throw new InputError("Gold changed during Oracle evaluation.");
}
const mappingCore = {
  evaluationPhase: "post-freeze-gold-isolated",
  runtimeGoldInputCount: 0,
  goldTextPersisted: false,
  entries: mappingAudit,
};
const reasrCore = {
  evaluationPhase: "post-freeze-gold-isolated",
  runtimeGoldInputCount: 0,
  entries: reasrAttribution,
  summary: {
    improvedPoolCount: reasrAttribution.filter(
      (entry) => entry.attribution === "IMPROVED_POOL",
    ).length,
    noChangeCount: reasrAttribution.filter(
      (entry) => entry.attribution === "NO_CHANGE",
    ).length,
    worsenedPoolCount: 0,
    createdHallucinationCount: 0,
    unevaluableCount: reasrAttribution.filter(
      (entry) => entry.attribution === "UNEVALUABLE",
    ).length,
  },
};
const attributionCore = {
  evaluationPhase: "post-freeze-gold-isolated",
  runtimeGoldInputCount: 0,
  materialErrorCount: evaluation.materialTextErrors.length,
  entries: materialAttribution,
  summary: attributionSummary,
};
await Promise.all([
  atomicWriteJson(
    path.join(outputDirectory, "machine-text-variant-oracle-evaluation.json"),
    existingOracle,
  ),
  atomicWriteJson(
    path.join(
      outputDirectory,
      "machine-text-variant-reasr-oracle-evaluation.json",
    ),
    extendedOracle,
  ),
  atomicWriteJson(path.join(outputDirectory, "oracle-mapping-audit.json"), {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-4-oracle-mapping-audit",
    ...mappingCore,
    semanticHash: machineQualitySemanticHash(mappingCore),
  }),
  atomicWriteJson(path.join(outputDirectory, "oracle-reasr-attribution.json"), {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-4-oracle-reasr-attribution",
    ...reasrCore,
    semanticHash: machineQualitySemanticHash(reasrCore),
  }),
  atomicWriteJson(
    path.join(outputDirectory, "post-hoc-material-error-attribution.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-4-post-hoc-material-error-attribution",
      ...attributionCore,
      semanticHash: machineQualitySemanticHash(attributionCore),
    },
  ),
  atomicWriteJson(
    path.join(outputDirectory, "oracle-evaluation-summary.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-4-oracle-evaluation-summary",
      machineFreezeHash: freeze.freezeSemanticHash,
      goldIdentityHash: goldSha256,
      goldReadOnlyVerified,
      multiVariantEventCount: oracleInputs.length,
      existingPool: existingOracle.aggregateMetrics,
      extendedReasrPool: extendedOracle.aggregateMetrics,
      reasrAttribution: reasrCore.summary,
      materialErrorAttribution: attributionSummary,
      runtimeGoldInputCount: 0,
    },
  ),
]);
console.log(
  JSON.stringify(
    {
      outputDirectory,
      multiVariantEventCount: oracleInputs.length,
      existingPool: existingOracle.aggregateMetrics,
      extendedReasrPool: extendedOracle.aggregateMetrics,
      reasrAttribution: reasrCore.summary,
      materialErrorAttribution: attributionSummary,
      goldReadOnlyVerified,
    },
    null,
    2,
  ),
);
