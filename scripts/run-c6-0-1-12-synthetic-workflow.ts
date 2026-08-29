import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  atomicWriteFile,
  atomicWriteJson,
  correctionDatasetSummarySchema,
  humanCorrectionRecordSchema,
  reviewAuditRecordSchema,
  subtitlePackageSchema,
  type HumanCorrectionRecord,
  type ReviewAuditRecord,
  type SubtitleCue,
} from "@mvl/shared";
import {
  applyC60112ReviewDecisions,
  c60112CueHash,
  machineQualitySemanticHash,
  type C60112ReviewDecision,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-29T15:00:00.000Z";

function required(
  values: Record<string, string | undefined>,
  name: string,
): string {
  const value = values[name];
  if (value === undefined || value.trim() === "")
    throw new Error(`Missing --${name}.`);
  return path.resolve(value);
}

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
): SubtitleCue {
  return {
    id,
    text,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    speaker: null,
    confidence: 0.5,
    textSource: "audio-asr",
  };
}

async function fileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath) as AsyncIterable<Buffer>)
    hash.update(chunk);
  return hash.digest("hex");
}

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    "dataset-output": { type: "string" },
  },
});
const options = values as Record<string, string | undefined>;
const output = required(options, "output");
const datasetOutput = required(options, "dataset-output");
if (
  output === datasetOutput ||
  output === path.parse(output).root ||
  datasetOutput === path.parse(datasetOutput).root ||
  output === process.cwd() ||
  datasetOutput === process.cwd()
) {
  throw new Error("Synthetic outputs must be distinct, scoped directories.");
}
await rm(output, { recursive: true, force: true });
await rm(datasetOutput, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(datasetOutput, { recursive: true });

const cues = Array.from({ length: 8 }, (_, index) =>
  cue(
    `synthetic-cue-${String(index + 1).padStart(2, "0")}`,
    `機械文${index + 1}`,
    index * 2,
    index * 2 + 1.5,
  ),
);
const basePackage = subtitlePackageSchema.parse({
  schemaVersion: "1.0.0",
  packageType: "multilingual-subtitle-package",
  status: "ready",
  sourceLanguage: "ja",
  detectedLanguages: ["ja"],
  source: {
    fileName: "synthetic-review-fixture.wav",
    container: "wav",
    durationSeconds: 20,
  },
  identity: {
    title: "Synthetic review fixture",
    season: null,
    episode: null,
    year: 2026,
  },
  primarySubtitle: {
    language: "ja",
    sourceType: "transcription",
    validationStatus: "needs-review",
    streamIndex: null,
  },
  subtitleFiles: {
    srt: "./synthetic.srt",
    vtt: "./synthetic.vtt",
    ass: "./synthetic.ass",
  },
  referenceSubtitles: [],
  video: { sourcePath: null, subtitledPath: null },
  cues,
  warnings: [],
});
const machineDraftPath = path.join(
  output,
  "synthetic-machine-draft-subtitle-package.json",
);
await atomicWriteJson(machineDraftPath, basePackage);
const machineDraftHash = await fileHash(machineDraftPath);
const actions = [
  "KEEP_CURRENT",
  "USE_REAZON",
  "USE_WHISPER_ALTERNATE",
  "MANUAL_EDIT",
  "TIMING_EDIT",
  "ADD_NEW_CUE",
  "MARK_FALSE_POSITIVE",
  "UNRESOLVED",
  "WAIVE_REVIEW",
] as const;
const decisions: C60112ReviewDecision[] = actions.map((action, index) => ({
  decisionId: `synthetic-decision-${String(index + 1).padStart(2, "0")}`,
  sessionId: "synthetic-review-session",
  itemId: `synthetic-review-item-${String(index + 1).padStart(2, "0")}`,
  sequence: index + 1,
  decidedAt: GENERATED_AT,
  action,
  targetCueIds:
    action === "ADD_NEW_CUE" || action === "MARK_FALSE_POSITIVE"
      ? []
      : [`synthetic-cue-${String(Math.min(index + 1, 8)).padStart(2, "0")}`],
  selectedCandidateId:
    action === "USE_REAZON"
      ? "synthetic-reazon"
      : action === "USE_WHISPER_ALTERNATE"
        ? "synthetic-whisper-alt"
        : null,
  manualText: action === "MANUAL_EDIT" ? "手動修正文" : null,
  manualStart: action === "TIMING_EDIT" ? index * 2 + 0.1 : null,
  manualEnd: action === "TIMING_EDIT" ? index * 2 + 1.4 : null,
  newCue:
    action === "ADD_NEW_CUE"
      ? {
          id: "synthetic-new-cue",
          text: "追加された発話",
          start: 17,
          end: 18.5,
        }
      : null,
  note: action === "WAIVE_REVIEW" ? "Synthetic explicit waiver fixture." : null,
}));
const candidates = [
  {
    candidateId: "synthetic-reazon",
    provider: "REAZON" as const,
    text: "Reazon候補",
    start: null,
    end: null,
  },
  {
    candidateId: "synthetic-whisper-alt",
    provider: "WHISPER" as const,
    text: "Whisper代替候補",
    start: null,
    end: null,
  },
];
const applied = applyC60112ReviewDecisions({
  basePackage,
  expectedBaseCueHash: c60112CueHash(basePackage.cues),
  decisions,
  candidates,
});
if (applied.summary.rejectedDecisionCount !== 0) {
  throw new Error(
    `Synthetic decision rejection count: ${applied.summary.rejectedDecisionCount}`,
  );
}
subtitlePackageSchema.parse(applied.package);
const packagePath = path.join(
  output,
  "synthetic-reviewed-subtitle-package.json",
);
const assPath = path.join(output, "synthetic-reviewed.ass");
const srtPath = path.join(output, "synthetic-reviewed.srt");
const vttPath = path.join(output, "synthetic-reviewed.vtt");
await atomicWriteJson(packagePath, applied.package);
await atomicWriteFile(assPath, applied.ass);
await atomicWriteFile(srtPath, applied.srt);
await atomicWriteFile(vttPath, applied.vtt);
const correctionRecords: HumanCorrectionRecord[] = decisions.map(
  (decision, index) => {
    const targetCueId = decision.targetCueIds[0];
    const beforeCue = basePackage.cues.find((cue) => cue.id === targetCueId);
    const afterCue =
      decision.action === "ADD_NEW_CUE"
        ? applied.package.cues.find((cue) => cue.id === decision.newCue?.id)
        : applied.package.cues.find((cue) => cue.id === targetCueId);
    const sourceInterval =
      beforeCue === undefined
        ? decision.newCue === null
          ? { start: index * 2, end: index * 2 + 1.5 }
          : { start: decision.newCue.start, end: decision.newCue.end }
        : { start: beforeCue.start, end: beforeCue.end };
    return humanCorrectionRecordSchema.parse({
      schemaVersion: "1.0.0",
      recordId: `synthetic-correction-${String(index + 1).padStart(2, "0")}`,
      decisionId: decision.decisionId,
      sessionId: decision.sessionId,
      reviewItemId: decision.itemId,
      regionId: `synthetic-region-${String(index + 1).padStart(2, "0")}`,
      eventIds: [`synthetic-event-${String(index + 1).padStart(2, "0")}`],
      cueIds: decision.targetCueIds,
      sourceInterval,
      machineDraftHash,
      evidenceSnapshotHash: machineQualitySemanticHash({
        itemId: decision.itemId,
        sourceInterval,
      }),
      candidateSetHash: machineQualitySemanticHash({
        itemId: decision.itemId,
        candidates: candidates.map((candidate) => candidate.candidateId),
      }),
      decisionType: decision.action,
      selectedCandidateId: decision.selectedCandidateId,
      beforeText: beforeCue?.text ?? null,
      afterText:
        decision.action === "MARK_FALSE_POSITIVE"
          ? null
          : (afterCue?.text ?? null),
      beforeStart: beforeCue?.start ?? null,
      beforeEnd: beforeCue?.end ?? null,
      afterStart:
        decision.action === "MARK_FALSE_POSITIVE"
          ? null
          : (afterCue?.start ?? null),
      afterEnd:
        decision.action === "MARK_FALSE_POSITIVE"
          ? null
          : (afterCue?.end ?? null),
      itemTypes:
        decision.action === "ADD_NEW_CUE" ||
        decision.action === "MARK_FALSE_POSITIVE"
          ? ["MISSING_SPEECH_RISK"]
          : decision.action === "TIMING_EDIT"
            ? ["TIMING_BOUNDARY_RISK"]
            : ["TEXT_CROSS_MODEL_DISAGREEMENT"],
      priorityAtDecision: {
        tier: "HIGH",
        score: 75,
        requiredLevel: "REQUIRED",
      },
      reviewerNote: decision.note,
      createdAt: GENERATED_AT,
    });
  },
);
const auditRecords: ReviewAuditRecord[] = correctionRecords.map(
  (record, index) => {
    const state = {
      recordId: record.recordId,
      decisionId: record.decisionId,
      decisionType: record.decisionType,
      selectedCandidateId: record.selectedCandidateId,
      afterText: record.afterText,
      afterStart: record.afterStart,
      afterEnd: record.afterEnd,
      reviewerNote: record.reviewerNote,
      updatedAt: record.createdAt,
    };
    return reviewAuditRecordSchema.parse({
      schemaVersion: "1.0.0",
      auditId: `synthetic-audit-${String(index + 1).padStart(2, "0")}`,
      operation: "DECISION",
      timestamp: GENERATED_AT,
      sessionId: record.sessionId,
      reviewItemId: record.reviewItemId,
      previousDecision: null,
      newDecision: record.recordId,
      undoneRecordId: null,
      beforeHash: machineQualitySemanticHash(null),
      afterHash: machineQualitySemanticHash(state),
    });
  },
);
const auditPath = path.join(output, "review-audit.jsonl");
const correctionPath = path.join(output, "human-correction-log.jsonl");
await atomicWriteFile(
  auditPath,
  `${auditRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
);
await atomicWriteFile(
  correctionPath,
  `${correctionRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
);
const decisionCounts = Object.fromEntries(
  actions.map((action) => [
    action,
    decisions.filter((decision) => decision.action === action).length,
  ]),
);
const validation = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2",
  artifactType: "c6-0-1-12-synthetic-workflow-validation",
  generatedAt: GENERATED_AT,
  fixtureContainsCarnationGold: false,
  actionCoverage: decisionCounts,
  strictSubtitlePackageValidated: true,
  appendOnlyAuditRecordCount: auditRecords.length,
  appendOnlyCorrectionRecordCount: correctionRecords.length,
  rejectedDecisionCount: applied.summary.rejectedDecisionCount,
  passed: actions.every((action) => decisionCounts[action] === 1),
  semanticHash: machineQualitySemanticHash({
    decisionCounts,
    correctedCueHash: applied.summary.correctedCueHash,
  }),
};
await atomicWriteJson(
  path.join(output, "c6-0-1-12-synthetic-workflow-validation.json"),
  validation,
);

const datasetPath = path.join(
  datasetOutput,
  "synthetic-human-corrections.jsonl",
);
await atomicWriteFile(datasetPath, await readFile(correctionPath));
const datasetSummaryCore = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2",
  artifactType: "correction-dataset-summary",
  generatedAt: GENERATED_AT,
  locality: "LOCAL_ONLY",
  shareable: false,
  sourceCorrectionLogHash: await fileHash(correctionPath),
  datasetJsonlHash: await fileHash(datasetPath),
  recordCount: correctionRecords.length,
  uniqueSessionCount: 1,
  uniqueReviewItemCount: correctionRecords.length,
  decisionCounts,
  containsFullDialogueText: true,
  trainingPerformed: false,
};
const datasetSummary = correctionDatasetSummarySchema.parse({
  ...datasetSummaryCore,
  semanticHash: machineQualitySemanticHash({
    ...datasetSummaryCore,
    generatedAt: undefined,
  }),
});
await atomicWriteJson(
  path.join(datasetOutput, "correction-dataset-summary.json"),
  datasetSummary,
);
process.stdout.write(
  `${JSON.stringify({ ok: true, validation, summary: applied.summary, output, datasetOutput }, null, 2)}\n`,
);
