import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import {
  atomicWriteJson,
  c60112ReviewPackageFreezeSchema,
  correctionDatasetSummarySchema,
  humanCorrectionRecordSchema,
  humanReviewManifestSchema,
  reviewAuditRecordSchema,
  reviewSessionSchema,
  subtitlePackageSchema,
  type ReviewDecisionType,
  type SubtitleCue,
} from "@mvl/shared";
import {
  C60112_REVIEW_WORKSPACE_VERSION,
  machineQualitySemanticHash,
  startC60112FrozenReviewWorkspaceServer,
  writeC60112ReviewWorkspace,
  type C60112ReviewDecisionRequest,
  type C60112ReviewWorkspaceData,
  type C60112WorkspaceReviewItem,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-29T15:00:00.000Z";
const POLICY_VERSION = "c6.0.1.12-multi-asr-review-assistance-v2" as const;
const ACTIONS = [
  "KEEP_CURRENT",
  "USE_REAZON",
  "USE_WHISPER_ALTERNATE",
  "MANUAL_EDIT",
  "TIMING_EDIT",
  "ADD_NEW_CUE",
  "MARK_FALSE_POSITIVE",
  "UNRESOLVED",
  "WAIVE_REVIEW",
] as const satisfies readonly ReviewDecisionType[];

function required(
  values: Record<string, string | undefined>,
  name: string,
): string {
  const value = values[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing --${name}.`);
  }
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
  for await (const chunk of createReadStream(
    filePath,
  ) as AsyncIterable<Buffer>) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function runReviewCommand(command: string, args: readonly string[]): void {
  const result = spawnSync("npm", ["run", command, "--", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${String(result.status)}): ${`${result.stdout}\n${result.stderr}`.slice(-8000)}`,
    );
  }
}

async function jsonLines(filePath: string): Promise<unknown[]> {
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function item(input: {
  index: number;
  cueId: string | null;
  text: string;
  action: ReviewDecisionType;
  itemTypes: string[];
  requiredLevel?: "REQUIRED" | "RECOMMENDED";
  candidateIds?: string[];
}): C60112WorkspaceReviewItem {
  const start = (input.index - 1) * 2;
  const reviewItemId = `synthetic-review-item-${String(input.index).padStart(2, "0")}`;
  const core = { start, end: start + 1.5 };
  const value = {
    reviewItemId,
    eventIds: [`synthetic-event-${String(input.index).padStart(2, "0")}`],
    finalCueIds: input.cueId === null ? [] : [input.cueId],
    itemTypes: input.itemTypes,
    sourceInterval: core,
    coreInterval: core,
    currentText: input.text,
    currentStart: input.cueId === null ? null : start,
    currentEnd: input.cueId === null ? null : start + 1.5,
    candidateIds: input.candidateIds ?? [],
    evidenceIds: [`synthetic-evidence-${String(input.index).padStart(2, "0")}`],
    reviewReasons: ["Synthetic action coverage fixture"],
    priorityTier: "HIGH" as const,
    priorityScore: 75,
    requiredLevel: input.requiredLevel ?? "REQUIRED",
    suggestedActions: [input.action],
    regionId: `synthetic-region-${String(input.index).padStart(2, "0")}`,
    previousCue: null,
    nextCue: null,
    semanticHash: "",
  };
  return { ...value, semanticHash: machineQualitySemanticHash(value) };
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

const cues = Array.from({ length: 7 }, (_, index) =>
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
const sourceMediaSha256 = machineQualitySemanticHash(
  "synthetic-review-fixture.wav",
);
const policyHash = machineQualitySemanticHash({
  policyVersion: POLICY_VERSION,
});
const reviewPackageSemanticHash = machineQualitySemanticHash({
  machineDraftHash,
  policyHash,
  fixture: "nine-action-workspace",
});

const items: C60112WorkspaceReviewItem[] = [
  item({
    index: 1,
    cueId: "synthetic-cue-01",
    text: "機械文1",
    action: "KEEP_CURRENT",
    itemTypes: ["GENERAL_UNCERTAINTY"],
  }),
  item({
    index: 2,
    cueId: "synthetic-cue-02",
    text: "機械文2",
    action: "USE_REAZON",
    itemTypes: ["TEXT_CROSS_MODEL_DISAGREEMENT"],
    candidateIds: ["synthetic-item-02-reazon"],
  }),
  item({
    index: 3,
    cueId: "synthetic-cue-03",
    text: "機械文3",
    action: "USE_WHISPER_ALTERNATE",
    itemTypes: ["TEXT_WHISPER_INSTABILITY"],
    candidateIds: ["synthetic-item-03-whisper-alt"],
  }),
  item({
    index: 4,
    cueId: "synthetic-cue-04",
    text: "機械文4",
    action: "MANUAL_EDIT",
    itemTypes: ["TEXT_LOW_ACOUSTIC_SUPPORT"],
  }),
  item({
    index: 5,
    cueId: "synthetic-cue-05",
    text: "機械文5",
    action: "TIMING_EDIT",
    itemTypes: ["TIMING_BOUNDARY_RISK"],
  }),
  item({
    index: 6,
    cueId: null,
    text: "",
    action: "ADD_NEW_CUE",
    itemTypes: ["MISSING_SPEECH_RISK"],
  }),
  item({
    index: 7,
    cueId: null,
    text: "",
    action: "MARK_FALSE_POSITIVE",
    itemTypes: ["MISSING_SPEECH_RISK"],
  }),
  item({
    index: 8,
    cueId: "synthetic-cue-06",
    text: "機械文6",
    action: "UNRESOLVED",
    itemTypes: ["EVIDENCE_CONFLICT"],
    requiredLevel: "RECOMMENDED",
  }),
  item({
    index: 9,
    cueId: "synthetic-cue-07",
    text: "機械文7",
    action: "WAIVE_REVIEW",
    itemTypes: ["GENERAL_UNCERTAINTY"],
  }),
];

const reviewData: C60112ReviewWorkspaceData = {
  schemaVersion: "1.0.0",
  workspaceVersion: C60112_REVIEW_WORKSPACE_VERSION,
  policyVersion: POLICY_VERSION,
  policyHash,
  reviewPackageSemanticHash,
  machineDraftHash,
  sourceMediaIdentity: {
    fileName: "synthetic-review-fixture.wav",
    sourceMediaSha256,
    durationSeconds: 20,
  },
  machineDraftIdentity: {
    machineDraftHash,
    packageType: basePackage.packageType,
  },
  items,
  regions: items.map((reviewItem) => ({
    regionId: reviewItem.regionId,
    reviewItemIds: [reviewItem.reviewItemId],
    contextStart: reviewItem.sourceInterval.start,
    contextEnd: reviewItem.sourceInterval.end,
    coreIntervals: [reviewItem.coreInterval],
    audioPath: `audio/${reviewItem.regionId}.wav`,
    audioSha256: null,
  })),
  candidateBundles: items.map((reviewItem) => ({
    reviewItemId: reviewItem.reviewItemId,
    candidates:
      reviewItem.reviewItemId === "synthetic-review-item-02"
        ? [
            {
              candidateId: "synthetic-item-02-reazon",
              labels: ["REAZON"],
              text: "Reazon候補",
              evidenceBadges: ["ACOUSTIC_FAVORED"],
              provenance: ["synthetic-reazon"],
            },
          ]
        : reviewItem.reviewItemId === "synthetic-review-item-03"
          ? [
              {
                candidateId: "synthetic-item-03-whisper-alt",
                labels: ["WHISPER_ALT"],
                text: "Whisper代替候補",
                evidenceBadges: ["STABLE"],
                provenance: ["synthetic-whisper-alternate"],
              },
            ]
          : [],
  })),
};
await writeC60112ReviewWorkspace({ workspaceDirectory: output, reviewData });

const freezeCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: POLICY_VERSION,
  artifactType: "c6-0-1-12-review-package-freeze" as const,
  frozenAt: GENERATED_AT,
  sourceMediaSha256,
  machineDraftHash,
  itemHash: machineQualitySemanticHash(items),
  priorityHash: machineQualitySemanticHash(
    items.map(
      ({ reviewItemId, priorityTier, priorityScore, requiredLevel }) => ({
        reviewItemId,
        priorityTier,
        priorityScore,
        requiredLevel,
      }),
    ),
  ),
  regionHash: machineQualitySemanticHash(reviewData.regions),
  candidateHash: machineQualitySemanticHash(reviewData.candidateBundles),
  audioManifestHash: machineQualitySemanticHash([]),
  workspaceDataHash: machineQualitySemanticHash(reviewData),
  policyHash,
  aggregateHash: "",
  runtimeGoldInputCount: 0 as const,
  goldAccessBeforeFreezeCount: 0 as const,
  frozenBeforeGoldEvaluation: true as const,
};
freezeCore.aggregateHash = machineQualitySemanticHash({
  sourceMediaSha256: freezeCore.sourceMediaSha256,
  machineDraftHash: freezeCore.machineDraftHash,
  itemHash: freezeCore.itemHash,
  priorityHash: freezeCore.priorityHash,
  regionHash: freezeCore.regionHash,
  candidateHash: freezeCore.candidateHash,
  audioManifestHash: freezeCore.audioManifestHash,
  workspaceDataHash: freezeCore.workspaceDataHash,
  policyHash: freezeCore.policyHash,
});
const freeze = c60112ReviewPackageFreezeSchema.parse({
  ...freezeCore,
  semanticHash: machineQualitySemanticHash(freezeCore),
});
const freezePath = path.join(output, "review-package-freeze.json");
await atomicWriteJson(freezePath, freeze);

const decisions: C60112ReviewDecisionRequest[] = ACTIONS.map(
  (decisionType, index) => {
    const reviewItem = items[index];
    if (reviewItem === undefined)
      throw new Error("Synthetic action/item mismatch.");
    return {
      decisionId: `synthetic-decision-${String(index + 1).padStart(2, "0")}`,
      reviewItemId: reviewItem.reviewItemId,
      decisionType,
      selectedCandidateId:
        decisionType === "USE_REAZON"
          ? "synthetic-item-02-reazon"
          : decisionType === "USE_WHISPER_ALTERNATE"
            ? "synthetic-item-03-whisper-alt"
            : null,
      afterText:
        decisionType === "MANUAL_EDIT"
          ? "手動修正文"
          : decisionType === "ADD_NEW_CUE"
            ? "追加された発話"
            : null,
      afterStart:
        decisionType === "TIMING_EDIT"
          ? 8.1
          : decisionType === "ADD_NEW_CUE"
            ? 10.1
            : null,
      afterEnd:
        decisionType === "TIMING_EDIT"
          ? 9.4
          : decisionType === "ADD_NEW_CUE"
            ? 11.4
            : null,
      reviewerNote:
        decisionType === "WAIVE_REVIEW"
          ? "Synthetic explicit waiver fixture."
          : decisionType === "UNRESOLVED"
            ? "Synthetic recommended item left unresolved."
            : null,
      expectedReviewPackageSemanticHash: reviewPackageSemanticHash,
      expectedMachineDraftHash: machineDraftHash,
    };
  },
);

const server = await startC60112FrozenReviewWorkspaceServer({
  workspaceDirectory: output,
  freeze,
  host: "127.0.0.1",
  port: 0,
});
try {
  for (const decision of decisions) {
    const response = await fetch(new URL("api/decision", server.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mvl-review-request": "c6-0-1-12",
      },
      body: JSON.stringify(decision),
    });
    const responseBody = (await response.json()) as {
      ok?: boolean;
      message?: string;
    };
    if (!response.ok || responseBody.ok !== true) {
      throw new Error(
        `Synthetic workspace decision failed (${String(response.status)}): ${responseBody.message ?? "unknown error"}`,
      );
    }
  }
} finally {
  await server.close();
}

const sessionPath = path.join(output, "session", "review-session.json");
const correctionPath = path.join(
  output,
  "session",
  "human-correction-log.jsonl",
);
const auditPath = path.join(output, "session", "review-audit.jsonl");
const reviewDataPath = path.join(output, "review-data.json");
const session = reviewSessionSchema.parse(
  JSON.parse(await readFile(sessionPath, "utf8")) as unknown,
);
const corrections = (await jsonLines(correctionPath)).map((record) =>
  humanCorrectionRecordSchema.parse(record),
);
const audits = (await jsonLines(auditPath)).map((record) =>
  reviewAuditRecordSchema.parse(record),
);
if (
  !session.reviewComplete ||
  corrections.length !== ACTIONS.length ||
  audits.length !== ACTIONS.length
) {
  throw new Error(
    "Synthetic workspace did not persist a complete nine-action session.",
  );
}

const appliedOutput = path.join(output, "applied");
runReviewCommand("review:apply", [
  "--base-package",
  machineDraftPath,
  "--freeze",
  freezePath,
  "--session",
  sessionPath,
  "--corrections",
  correctionPath,
  "--audit",
  auditPath,
  "--review-data",
  reviewDataPath,
  "--output",
  appliedOutput,
]);
runReviewCommand("review:export-corrections", [
  "--freeze",
  freezePath,
  "--review-data",
  reviewDataPath,
  "--session",
  sessionPath,
  "--corrections",
  correctionPath,
  "--audit",
  auditPath,
  "--output",
  datasetOutput,
]);

const packagePath = path.join(
  appliedOutput,
  "human-reviewed-subtitle-package.json",
);
const assPath = path.join(appliedOutput, "human-reviewed.ass");
const srtPath = path.join(appliedOutput, "human-reviewed.srt");
const vttPath = path.join(appliedOutput, "human-reviewed.vtt");
const manifestPath = path.join(appliedOutput, "human-review-manifest.json");
const appliedPackage = subtitlePackageSchema.parse(
  JSON.parse(await readFile(packagePath, "utf8")) as unknown,
);
const manifest = humanReviewManifestSchema.parse(
  JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
);
const datasetPath = path.join(datasetOutput, "human-corrections.jsonl");
const datasetSummaryPath = path.join(
  datasetOutput,
  "correction-dataset-summary.json",
);
const datasetSummary = correctionDatasetSummarySchema.parse(
  JSON.parse(await readFile(datasetSummaryPath, "utf8")) as unknown,
);
const actionCoverage = Object.fromEntries(
  ACTIONS.map((action) => [
    action,
    corrections.filter((record) => record.decisionType === action).length,
  ]),
) as Record<ReviewDecisionType, number>;
const exactMutationsApplied =
  appliedPackage.cues.find((candidate) => candidate.id === "synthetic-cue-02")
    ?.text === "Reazon候補" &&
  appliedPackage.cues.find((candidate) => candidate.id === "synthetic-cue-03")
    ?.text === "Whisper代替候補" &&
  appliedPackage.cues.find((candidate) => candidate.id === "synthetic-cue-04")
    ?.text === "手動修正文" &&
  appliedPackage.cues.find((candidate) => candidate.id === "synthetic-cue-05")
    ?.start === 8.1 &&
  appliedPackage.cues.find((candidate) => candidate.id === "synthetic-cue-05")
    ?.end === 9.4 &&
  appliedPackage.cues.some(
    (candidate) =>
      candidate.text === "追加された発話" &&
      candidate.start === 10.1 &&
      candidate.end === 11.4,
  );
if (!exactMutationsApplied)
  throw new Error(
    "Synthetic CLI apply did not materialize the expected edits.",
  );

const validationCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: POLICY_VERSION,
  artifactType: "c6-0-1-12-synthetic-workflow-validation" as const,
  generatedAt: GENERATED_AT,
  fixtureContainsCarnationGold: false as const,
  actionCoverage,
  reviewComplete: session.reviewComplete,
  completedRequiredCount: session.completedRequiredCount,
  unresolvedRequiredCount: session.unresolvedRequiredCount,
  appendOnlyAuditRecordCount: audits.length,
  appendOnlyCorrectionRecordCount: corrections.length,
  strictSubtitlePackageValidated: true as const,
  workspaceServerDecisionCount: decisions.length,
  cliApplyPassed: true as const,
  cliCorrectionExportPassed: true as const,
  exactMutationsApplied,
  workspaceDataHash: freeze.workspaceDataHash,
  reviewDataFileHash: await fileHash(reviewDataPath),
  reviewPackageFreezeHash: freeze.semanticHash,
  reviewPackageFreezeFileHash: await fileHash(freezePath),
  machineDraftHash,
  reviewSessionHash: await fileHash(sessionPath),
  correctionLogHash: await fileHash(correctionPath),
  auditLogHash: await fileHash(auditPath),
  humanReviewManifestHash: manifest.semanticHash,
  humanReviewManifestFileHash: await fileHash(manifestPath),
  appliedPackageHash: await fileHash(packagePath),
  appliedAssHash: await fileHash(assPath),
  appliedSrtHash: await fileHash(srtPath),
  appliedVttHash: await fileHash(vttPath),
  correctionDatasetSummaryHash: datasetSummary.semanticHash,
  correctionDatasetSummaryFileHash: await fileHash(datasetSummaryPath),
  correctionDatasetJsonlHash: await fileHash(datasetPath),
  goldInputCount: 0 as const,
  passed:
    ACTIONS.every((action) => actionCoverage[action] === 1) &&
    datasetSummary.recordCount === ACTIONS.length,
};
const validation = {
  ...validationCore,
  semanticHash: machineQualitySemanticHash({
    ...validationCore,
    generatedAt: undefined,
  }),
};
await atomicWriteJson(
  path.join(output, "c6-0-1-12-synthetic-workflow-validation.json"),
  validation,
);
process.stdout.write(
  `${JSON.stringify({ ok: true, output, datasetOutput, validation }, null, 2)}\n`,
);
