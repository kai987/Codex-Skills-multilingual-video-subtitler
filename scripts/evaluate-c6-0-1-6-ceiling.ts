import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  machineCandidatePoolC6015Schema,
  machineEventFinalTextSpanLineageSchema,
  machineReAsrPrioritySchema,
  machineRawAsrEventRecoverySchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { buildAsrCeilingEvaluation } from "@mvl/video-subtitler";

interface PostHocAttribution {
  entries: {
    defectId: string;
    alignmentIds: string[];
    eventIds: string[];
    category: string;
  }[];
}

interface OracleEvaluation {
  eventEntries: { eventId: string; oracleClass: string }[];
}

interface MachineEvaluation {
  alignments: {
    alignmentId: string;
    machineCueIndexes: number[];
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
    throw new Error("Expected exactly one subtitle directory.");
  }
  return path.join(run, entries[0].name);
}

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLocaleLowerCase("ja");
}

function editDistance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
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

function nearAgreement(
  texts: readonly string[],
): "CONSISTENT" | "MIXED" | "UNKNOWN" {
  const normalized = [...new Set(texts.map(normalize).filter(Boolean))];
  if (normalized.length < 2)
    return normalized.length === 1 ? "CONSISTENT" : "UNKNOWN";
  for (const [index, text] of normalized.entries()) {
    for (const other of normalized.slice(index + 1)) {
      const ratio =
        editDistance(text, other) / Math.max(text.length, other.length, 1);
      if (ratio > 0.25) return "MIXED";
    }
  }
  return "CONSISTENT";
}

const argv = process.argv.slice(2);
const run = path.resolve(argument(argv, "--run"));
const evaluationDirectory = path.resolve(argument(argv, "--evaluation"));
const output = path.resolve(argument(argv, "--output"));
const subtitle = await subtitleDirectory(run);

const [
  postHoc,
  oracle,
  machineEvaluation,
  packageArtifact,
  pool,
  lineage,
  priority,
  recovery,
] = await Promise.all([
  json<PostHocAttribution>(
    path.join(evaluationDirectory, "c6-0-1-5-post-hoc-error-attribution.json"),
  ),
  json<OracleEvaluation>(
    path.join(
      evaluationDirectory,
      "machine-c6-0-1-5-candidate-oracle-evaluation.json",
    ),
  ),
  json<MachineEvaluation>(
    path.join(evaluationDirectory, "machine-vs-gold-evaluation.json"),
  ),
  json<unknown>(path.join(subtitle, "subtitle-package.json")).then((value) =>
    subtitlePackageSchema.parse(value),
  ),
  json<unknown>(
    path.join(subtitle, "machine-candidate-pool-c6-0-1-5.json"),
  ).then((value) => machineCandidatePoolC6015Schema.parse(value)),
  json<unknown>(
    path.join(subtitle, "machine-event-final-text-span-lineage.json"),
  ).then((value) => machineEventFinalTextSpanLineageSchema.parse(value)),
  json<unknown>(path.join(subtitle, "machine-reasr-priority.json")).then(
    (value) => machineReAsrPrioritySchema.parse(value),
  ),
  json<unknown>(
    path.join(subtitle, "machine-raw-asr-event-recovery.json"),
  ).then((value) => machineRawAsrEventRecoverySchema.parse(value)),
]);

const oracleClass = new Map(
  oracle.eventEntries.map(
    (entry) => [entry.eventId, entry.oracleClass] as const,
  ),
);
const spanByEvent = new Map(
  lineage.events.map((span) => [span.eventId, span] as const),
);
const priorityByEvent = new Map(
  priority.events.map((event) => [event.eventId, event] as const),
);
const recoveryByEvent = new Map(
  recovery.events.map((event) => [event.eventId, event] as const),
);
const candidatesByEvent = new Map<
  string,
  { id: string; text: string; origin: string }[]
>();
for (const candidate of pool.candidates) {
  const candidates = candidatesByEvent.get(candidate.eventId) ?? [];
  candidates.push({
    id: candidate.candidateId,
    text: candidate.text,
    origin: candidate.origin,
  });
  candidatesByEvent.set(candidate.eventId, candidates);
}
const alignmentById = new Map(
  machineEvaluation.alignments.map(
    (alignment) => [alignment.alignmentId, alignment] as const,
  ),
);

const artifact = buildAsrCeilingEvaluation({
  errors: postHoc.entries.map((error) => {
    const eventIds = [...new Set(error.eventIds)];
    const candidates = eventIds.flatMap(
      (eventId) => candidatesByEvent.get(eventId) ?? [],
    );
    const spanBlocked = eventIds.some((eventId) => {
      const status = spanByEvent.get(eventId)?.lineageStatus;
      return status === "AMBIGUOUS" || status === "UNRESOLVED";
    });
    const selectorRecoverable = eventIds.some(
      (eventId) => oracleClass.get(eventId) === "SELECTOR_ERROR",
    );
    const poolInsufficient = eventIds.some(
      (eventId) => oracleClass.get(eventId) === "POOL_INSUFFICIENT",
    );
    const selectedForReAsr = eventIds.some(
      (eventId) => priorityByEvent.get(eventId)?.budgetSelected === true,
    );
    const reAsrReplayed = eventIds.some(
      (eventId) => recoveryByEvent.get(eventId) !== undefined,
    );
    const reAsrEligible = eventIds.some(
      (eventId) => priorityByEvent.get(eventId)?.recommendedAction === "RE_ASR",
    );
    const candidateAgreement = nearAgreement(
      candidates.map((entry) => entry.text),
    );
    const multipleWhisperWindowsEvaluated =
      candidates.length >= 2 || reAsrReplayed;
    const cueIndexes = error.alignmentIds.flatMap(
      (alignmentId) => alignmentById.get(alignmentId)?.machineCueIndexes ?? [],
    );
    const cueId =
      cueIndexes
        .map((index) => packageArtifact.cues[index]?.id)
        .find((value): value is string => value !== undefined) ?? null;
    const consistentlyWrong =
      poolInsufficient &&
      selectedForReAsr &&
      reAsrReplayed &&
      multipleWhisperWindowsEvaluated &&
      candidateAgreement === "CONSISTENT";
    return {
      errorId: error.defectId,
      cueId,
      machineCandidateIds: candidates.map((entry) => entry.id),
      evidenceIds: [
        ...error.alignmentIds.map((id) => `alignment:${id}`),
        ...eventIds.map((id) => `event:${id}`),
      ],
      associationRemaining: error.category === "ASSOCIATION_ERROR",
      spanLineageBlocked: !selectorRecoverable && spanBlocked,
      pipelineDecisionRecoverable: selectorRecoverable,
      existingVariantRecoverable: false,
      reAsrRecoverable:
        !consistentlyWrong &&
        error.category === "RAW_ASR_ORIGIN" &&
        reAsrEligible &&
        (!selectedForReAsr || !reAsrReplayed),
      multipleWhisperWindowsEvaluated,
      candidateTextAgreement: consistentlyWrong
        ? ("CONSISTENT" as const)
        : candidateAgreement,
    };
  }),
});

await atomicWriteJson(output, artifact);
console.log(JSON.stringify({ output, summary: artifact.summary }, null, 2));
