import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import {
  atomicWriteJson,
  c60112IdealReviewUpperBoundSchema,
  c60112ReviewAssistanceValidationSchema,
  c60112ReviewPackageFreezeSchema,
  c60112ReviewQualityEvaluationSchema,
  c60112RouteDecisionSchema,
  c60112ShareableSummarySchema,
  correctionDatasetSummarySchema,
  humanCorrectionRecordSchema,
  humanReviewManifestSchema,
  machineReviewAudioManifestSchema,
  machineReviewCandidateBundlesSchema,
  machineReviewItemsSchema,
  machineReviewPrioritySchema,
  machineReviewRegionsSchema,
  reviewAuditRecordSchema,
  reviewSessionSchema,
  subtitlePackageSchema,
} from "@mvl/shared";
import { formatAss, formatSrt, formatVtt, parseAss } from "@mvl/subtitle-core";
import {
  assertC60112MachineOnlyInput,
  assertC60112FrozenWorkspaceData,
  assertC60112NoGoldDialogueLeak,
  assertC60112ReviewPolicy,
  assertC60112ReviewWorkspaceData,
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
  decideC60112Route,
  inspectReviewWav,
  machineQualitySemanticHash,
  normalizeC601GoldAssTimestamps,
  verifyC60112ReviewPackageFreeze,
  writeC60112ReviewWorkspace,
  type C60112ReviewPolicy,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-29T16:00:00.000Z";
const PREFIX = "carnation-c6-0-1-12";
const DATE = "20260829";
const EXPECTED_SOURCE_SHA256 =
  "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43";
const EXPECTED_GOLD_SHA256 =
  "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e";
const EXPECTED_GOLD_EVALUATION_SHA256 =
  "3cedfab22687d976952f3505c0119cb10754468837d29a26eb760845b754a7d7";
const EXPECTED_SYNTHETIC_ACTIONS = [
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

async function fileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(
    filePath,
  ) as AsyncIterable<Buffer>) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function jsonl(filePath: string): Promise<unknown[]> {
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function onlySubtitleDirectory(root: string): Promise<string> {
  const entries = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one subtitle directory in ${root}.`);
  }
  return path.join(root, entries[0]?.name ?? "");
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(root, absolute)));
    else if (entry.isFile()) result.push(absolute);
  }
  return result.toSorted();
}

async function directoryHash(root: string): Promise<string> {
  const entries = await Promise.all(
    (await listFiles(root)).map(async (absolute) => ({
      path: path.relative(root, absolute).split(path.sep).join("/"),
      sha256: await fileHash(absolute),
    })),
  );
  return machineQualitySemanticHash(entries);
}

function output(root: string, suffix: string): string {
  return path.join(root, `${PREFIX}-${suffix}-${DATE}`);
}

function verifySemanticHash(
  value: Record<string, unknown> & { semanticHash: string },
  omitGeneratedAt: boolean,
): boolean {
  const { semanticHash, ...core } = value;
  return (
    machineQualitySemanticHash(
      omitGeneratedAt ? { ...core, generatedAt: undefined } : core,
    ) === semanticHash
  );
}

function runCommand(
  executable: string,
  args: string[],
  enabled: boolean,
): {
  status: "PASSED" | "FAILED" | "SKIPPED";
  command: string;
  exitCode: number | null;
  outputHash: string;
  outputTail: string;
} {
  const command = `${executable} ${args.join(" ")}`;
  if (!enabled) {
    return {
      status: "SKIPPED",
      command,
      exitCode: null,
      outputHash: machineQualitySemanticHash("not-run"),
      outputTail: "Regression execution was not requested.",
    };
  }
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  return {
    status: result.status === 0 ? "PASSED" : "FAILED",
    command,
    exitCode: result.status,
    outputHash: createHash("sha256").update(combined).digest("hex"),
    outputTail: combined.slice(-4000),
  };
}

function runNpm(args: string[], enabled: boolean) {
  return runCommand("npm", args, enabled);
}

function scanShareable(
  value: unknown,
  goldHash: string,
): {
  absolutePathCount: number;
  secretCount: number;
  goldLeakCount: number;
} {
  const text = JSON.stringify(value);
  const absolutePathCount = [
    /\/(?:Users|private|tmp|var\/folders)\//gu,
    /[A-Za-z]:\\/gu,
  ].reduce((sum, pattern) => sum + [...text.matchAll(pattern)].length, 0);
  const secretCount = [
    /(?:hf|sk)-[A-Za-z0-9_-]{16,}/gu,
    /(?:api[_-]?key|token|secret)["']?\s*[:=]\s*["'][^"']{8,}/giu,
  ].reduce((sum, pattern) => sum + [...text.matchAll(pattern)].length, 0);
  return {
    absolutePathCount,
    secretCount,
    goldLeakCount: text.includes(goldHash) ? 1 : 0,
  };
}

async function auditShareableOnDisk(input: {
  stagingRoot: string;
  value: unknown;
  goldHash: string;
}): Promise<{
  absolutePathCount: number;
  secretCount: number;
  goldLeakCount: number;
  brokenRelativeReferenceCount: number;
  fileCount: number;
}> {
  await rm(input.stagingRoot, { recursive: true, force: true });
  await mkdir(input.stagingRoot, { recursive: true });
  await atomicWriteJson(
    path.join(input.stagingRoot, "c6-0-1-12-shareable-summary.json"),
    input.value,
  );
  const files = await listFiles(input.stagingRoot);
  const totals = {
    absolutePathCount: 0,
    secretCount: 0,
    goldLeakCount: 0,
    brokenRelativeReferenceCount: 0,
    fileCount: files.length,
  };
  for (const filePath of files) {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    const scan = scanShareable(parsed, input.goldHash);
    totals.absolutePathCount += scan.absolutePathCount;
    totals.secretCount += scan.secretCount;
    totals.goldLeakCount += scan.goldLeakCount;
  }
  await rm(input.stagingRoot, { recursive: true, force: true });
  return totals;
}

interface SyntheticWorkflowEvidence {
  passed: true;
  validationSemanticHash: string;
  datasetSummarySemanticHash: string;
  fixtureContainsCarnationGold: false;
  actionCoverage: Record<string, number>;
  correctionCount: number;
  auditCount: number;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertSyntheticValidationArtifact(value: unknown): Record<
  string,
  unknown
> & {
  actionCoverage: Record<string, number>;
  semanticHash: string;
} {
  const artifact = record(value, "Synthetic workflow validation");
  const expectedKeys = new Set([
    "schemaVersion",
    "policyVersion",
    "artifactType",
    "generatedAt",
    "fixtureContainsCarnationGold",
    "actionCoverage",
    "reviewComplete",
    "completedRequiredCount",
    "unresolvedRequiredCount",
    "appendOnlyAuditRecordCount",
    "appendOnlyCorrectionRecordCount",
    "strictSubtitlePackageValidated",
    "workspaceServerDecisionCount",
    "cliApplyPassed",
    "cliCorrectionExportPassed",
    "exactMutationsApplied",
    "workspaceDataHash",
    "reviewDataFileHash",
    "reviewPackageFreezeHash",
    "reviewPackageFreezeFileHash",
    "machineDraftHash",
    "reviewSessionHash",
    "correctionLogHash",
    "auditLogHash",
    "humanReviewManifestHash",
    "humanReviewManifestFileHash",
    "appliedPackageHash",
    "appliedAssHash",
    "appliedSrtHash",
    "appliedVttHash",
    "correctionDatasetSummaryHash",
    "correctionDatasetSummaryFileHash",
    "correctionDatasetJsonlHash",
    "goldInputCount",
    "passed",
    "semanticHash",
  ]);
  if (
    Object.keys(artifact).length !== expectedKeys.size ||
    Object.keys(artifact).some((key) => !expectedKeys.has(key))
  ) {
    throw new Error("Synthetic workflow validation has an unexpected shape.");
  }
  if (
    artifact.schemaVersion !== "1.0.0" ||
    artifact.policyVersion !== "c6.0.1.12-multi-asr-review-assistance-v2" ||
    artifact.artifactType !== "c6-0-1-12-synthetic-workflow-validation" ||
    artifact.fixtureContainsCarnationGold !== false ||
    artifact.reviewComplete !== true ||
    artifact.strictSubtitlePackageValidated !== true ||
    artifact.cliApplyPassed !== true ||
    artifact.cliCorrectionExportPassed !== true ||
    artifact.exactMutationsApplied !== true ||
    artifact.goldInputCount !== 0 ||
    artifact.passed !== true
  ) {
    throw new Error(
      "Synthetic workflow validation reports a failed invariant.",
    );
  }
  const hashKeys = [
    "workspaceDataHash",
    "reviewDataFileHash",
    "reviewPackageFreezeHash",
    "reviewPackageFreezeFileHash",
    "machineDraftHash",
    "reviewSessionHash",
    "correctionLogHash",
    "auditLogHash",
    "humanReviewManifestHash",
    "humanReviewManifestFileHash",
    "appliedPackageHash",
    "appliedAssHash",
    "appliedSrtHash",
    "appliedVttHash",
    "correctionDatasetSummaryHash",
    "correctionDatasetSummaryFileHash",
    "correctionDatasetJsonlHash",
    "semanticHash",
  ];
  if (
    hashKeys.some((key) => {
      const value = artifact[key];
      return typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value);
    })
  ) {
    throw new Error("Synthetic workflow validation contains an invalid hash.");
  }
  const actionCoverageValue = record(
    artifact.actionCoverage,
    "Synthetic action coverage",
  );
  if (
    Object.keys(actionCoverageValue).length !==
      EXPECTED_SYNTHETIC_ACTIONS.length ||
    EXPECTED_SYNTHETIC_ACTIONS.some(
      (action) => actionCoverageValue[action] !== 1,
    )
  ) {
    throw new Error("Synthetic workflow does not cover all nine actions once.");
  }
  const { semanticHash, ...core } = artifact;
  if (
    machineQualitySemanticHash({ ...core, generatedAt: undefined }) !==
    semanticHash
  ) {
    throw new Error("Synthetic workflow validation semantic hash mismatch.");
  }
  return artifact as Record<string, unknown> & {
    actionCoverage: Record<string, number>;
    semanticHash: string;
  };
}

async function verifySyntheticWorkflowArtifacts(input: {
  syntheticRoot: string;
  datasetRoot: string;
  forbiddenGoldTexts: readonly string[] | null;
}): Promise<SyntheticWorkflowEvidence> {
  const reviewDataPath = path.join(input.syntheticRoot, "review-data.json");
  const freezePath = path.join(
    input.syntheticRoot,
    "review-package-freeze.json",
  );
  const machineDraftPath = path.join(
    input.syntheticRoot,
    "synthetic-machine-draft-subtitle-package.json",
  );
  const sessionPath = path.join(
    input.syntheticRoot,
    "session",
    "review-session.json",
  );
  const correctionPath = path.join(
    input.syntheticRoot,
    "session",
    "human-correction-log.jsonl",
  );
  const auditPath = path.join(
    input.syntheticRoot,
    "session",
    "review-audit.jsonl",
  );
  const appliedRoot = path.join(input.syntheticRoot, "applied");
  const packagePath = path.join(
    appliedRoot,
    "human-reviewed-subtitle-package.json",
  );
  const assPath = path.join(appliedRoot, "human-reviewed.ass");
  const srtPath = path.join(appliedRoot, "human-reviewed.srt");
  const vttPath = path.join(appliedRoot, "human-reviewed.vtt");
  const manifestPath = path.join(appliedRoot, "human-review-manifest.json");
  const validationPath = path.join(
    input.syntheticRoot,
    "c6-0-1-12-synthetic-workflow-validation.json",
  );
  const datasetPath = path.join(input.datasetRoot, "human-corrections.jsonl");
  const datasetSummaryPath = path.join(
    input.datasetRoot,
    "correction-dataset-summary.json",
  );
  const datasetLifecyclePath = path.join(
    input.datasetRoot,
    "correction-dataset-lifecycle.json",
  );

  const reviewDataValue = await json(reviewDataPath);
  const reviewData = record(
    reviewDataValue,
    "Synthetic review data",
  ) as unknown as C60112ReviewWorkspaceData;
  assertC60112ReviewWorkspaceData(reviewData);
  const freeze = c60112ReviewPackageFreezeSchema.parse(await json(freezePath));
  assertC60112FrozenWorkspaceData({ freeze, workspaceData: reviewData });
  const expectedPriorityHash = machineQualitySemanticHash(
    reviewData.items.map(
      ({ reviewItemId, priorityTier, priorityScore, requiredLevel }) => ({
        reviewItemId,
        priorityTier,
        priorityScore,
        requiredLevel,
      }),
    ),
  );
  if (
    freeze.itemHash !== machineQualitySemanticHash(reviewData.items) ||
    freeze.priorityHash !== expectedPriorityHash ||
    freeze.regionHash !== machineQualitySemanticHash(reviewData.regions) ||
    freeze.candidateHash !==
      machineQualitySemanticHash(reviewData.candidateBundles) ||
    freeze.audioManifestHash !== machineQualitySemanticHash([])
  ) {
    throw new Error("Synthetic freeze component hash mismatch.");
  }
  const basePackage = subtitlePackageSchema.parse(await json(machineDraftPath));
  if (
    (await fileHash(machineDraftPath)) !== reviewData.machineDraftHash ||
    reviewData.machineDraftHash !== freeze.machineDraftHash
  ) {
    throw new Error("Synthetic machine draft identity mismatch.");
  }
  const session = reviewSessionSchema.parse(await json(sessionPath));
  const corrections = (await jsonl(correctionPath)).map((value) =>
    humanCorrectionRecordSchema.parse(value),
  );
  const audits = (await jsonl(auditPath)).map((value) =>
    reviewAuditRecordSchema.parse(value),
  );
  if (
    !session.reviewComplete ||
    session.machineDraftHash !== reviewData.machineDraftHash ||
    session.reviewPackageSemanticHash !==
      reviewData.reviewPackageSemanticHash ||
    corrections.length !== EXPECTED_SYNTHETIC_ACTIONS.length ||
    audits.length !== EXPECTED_SYNTHETIC_ACTIONS.length ||
    new Set(corrections.map((value) => value.recordId)).size !==
      corrections.length ||
    new Set(audits.map((value) => value.auditId)).size !== audits.length
  ) {
    throw new Error("Synthetic session or append-only log is incomplete.");
  }
  const actionCoverage = Object.fromEntries(
    EXPECTED_SYNTHETIC_ACTIONS.map((action) => [
      action,
      corrections.filter((value) => value.decisionType === action).length,
    ]),
  );
  if (
    EXPECTED_SYNTHETIC_ACTIONS.some((action) => actionCoverage[action] !== 1)
  ) {
    throw new Error("Synthetic correction log lacks exact action coverage.");
  }
  const correctionById = new Map(
    corrections.map((value) => [value.recordId, value]),
  );
  const auditCorrectionIds = new Set<string>();
  for (const audit of audits) {
    if (
      audit.operation !== "DECISION" ||
      audit.newDecision === null ||
      audit.undoneRecordId !== null ||
      audit.sessionId !== session.sessionId ||
      correctionById.get(audit.newDecision)?.reviewItemId !== audit.reviewItemId
    ) {
      throw new Error(`Synthetic audit link is invalid: ${audit.auditId}`);
    }
    auditCorrectionIds.add(audit.newDecision);
  }
  if (
    auditCorrectionIds.size !== corrections.length ||
    Object.keys(session.itemStates).length !== corrections.length ||
    Object.entries(session.itemStates).some(
      ([reviewItemId, state]) =>
        correctionById.get(state.recordId)?.reviewItemId !== reviewItemId,
    )
  ) {
    throw new Error("Synthetic audit/session terminal state is not complete.");
  }
  const requiredItems = reviewData.items.filter(
    (value) => value.requiredLevel === "REQUIRED",
  );
  const independentlyCompleted = requiredItems.filter((value) => {
    const state = session.itemStates[value.reviewItemId];
    return state !== undefined && state.decisionType !== "UNRESOLVED";
  }).length;
  if (
    session.completedRequiredCount !== independentlyCompleted ||
    session.unresolvedRequiredCount !==
      requiredItems.length - independentlyCompleted
  ) {
    throw new Error("Synthetic session completion summary is inconsistent.");
  }

  const stats = runNpm(
    [
      "run",
      "review:stats",
      "--",
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
    ],
    true,
  );
  if (stats.status !== "PASSED") {
    throw new Error(
      `Independent synthetic session validation failed: ${stats.outputTail}`,
    );
  }

  const storedPackage = subtitlePackageSchema.parse(await json(packagePath));
  const manifest = humanReviewManifestSchema.parse(await json(manifestPath));
  const storedCueById = new Map(
    storedPackage.cues.map((cue) => [cue.id, cue] as const),
  );
  const independentlyNewCueCount = storedPackage.cues.filter(
    (cue) => !basePackage.cues.some((baseCue) => baseCue.id === cue.id),
  ).length;
  const independentlyTextChangedCueCount = basePackage.cues.filter(
    (cue) => storedCueById.get(cue.id)?.text !== cue.text,
  ).length;
  const independentlyTimingChangedCueCount = basePackage.cues.filter((cue) => {
    const stored = storedCueById.get(cue.id);
    return stored === undefined
      ? true
      : stored.start !== cue.start || stored.end !== cue.end;
  }).length;
  const requiredItemIds = new Set(
    requiredItems.map((item) => item.reviewItemId),
  );
  const independentlyUnresolvedCount = corrections.filter(
    (correction) =>
      correction.decisionType === "UNRESOLVED" &&
      requiredItemIds.has(correction.reviewItemId),
  ).length;
  const { semanticHash: manifestSemanticHash, ...manifestCore } = manifest;
  if (
    machineQualitySemanticHash({
      ...manifestCore,
      generatedAt: undefined,
    }) !== manifestSemanticHash ||
    manifest.machineDraftHash !== (await fileHash(machineDraftPath)) ||
    manifest.reviewSessionHash !== (await fileHash(sessionPath)) ||
    manifest.correctionLogHash !== (await fileHash(correctionPath)) ||
    manifest.reviewedSubtitlePackageHash !== (await fileHash(packagePath)) ||
    manifest.reviewedAssHash !== (await fileHash(assPath)) ||
    manifest.reviewedSrtHash !== (await fileHash(srtPath)) ||
    manifest.reviewedVttHash !== (await fileHash(vttPath)) ||
    manifest.sessionId !== session.sessionId ||
    manifest.unresolvedCount !== independentlyUnresolvedCount ||
    manifest.textChangedCueCount !== independentlyTextChangedCueCount ||
    manifest.timingChangedCueCount !== independentlyTimingChangedCueCount ||
    manifest.newCueCount !== independentlyNewCueCount ||
    machineQualitySemanticHash(manifest.decisionCounts) !==
      machineQualitySemanticHash(actionCoverage)
  ) {
    throw new Error(
      "Synthetic apply manifest is not bound to its inputs/outputs.",
    );
  }
  const replayRoot = await mkdtemp(
    path.join(tmpdir(), "c60112-synthetic-apply-verify-"),
  );
  try {
    const apply = runNpm(
      [
        "run",
        "review:apply",
        "--",
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
        replayRoot,
      ],
      true,
    );
    if (apply.status !== "PASSED") {
      throw new Error(
        `Independent synthetic apply failed: ${apply.outputTail}`,
      );
    }
    for (const relative of [
      "human-reviewed-subtitle-package.json",
      "human-reviewed.ass",
      "human-reviewed.srt",
      "human-reviewed.vtt",
    ]) {
      if (
        (await fileHash(path.join(appliedRoot, relative))) !==
        (await fileHash(path.join(replayRoot, relative)))
      ) {
        throw new Error(
          `Independent synthetic apply parity failed: ${relative}`,
        );
      }
    }
  } finally {
    await rm(replayRoot, { recursive: true, force: true });
  }
  subtitlePackageSchema.parse(storedPackage);

  const datasetSummary = correctionDatasetSummarySchema.parse(
    await json(datasetSummaryPath),
  );
  const datasetRecords = (await jsonl(datasetPath)).map((value) =>
    humanCorrectionRecordSchema.parse(value),
  );
  const { semanticHash: datasetSemanticHash, ...datasetCore } = datasetSummary;
  if (
    machineQualitySemanticHash({
      ...datasetCore,
      generatedAt: undefined,
    }) !== datasetSemanticHash ||
    datasetSummary.sourceCorrectionLogHash !==
      (await fileHash(correctionPath)) ||
    datasetSummary.sourceReviewSessionHash !== (await fileHash(sessionPath)) ||
    datasetSummary.sourceAuditLogHash !== (await fileHash(auditPath)) ||
    datasetSummary.sourceReviewDataHash !== (await fileHash(reviewDataPath)) ||
    datasetSummary.reviewPackageFreezeHash !== freeze.semanticHash ||
    datasetSummary.lifecycleAuditHash !==
      (await fileHash(datasetLifecyclePath)) ||
    datasetSummary.datasetJsonlHash !== (await fileHash(datasetPath)) ||
    datasetSummary.recordCount !== corrections.length ||
    datasetSummary.activeRecordCount !== corrections.length ||
    datasetSummary.sourceRecordCount !== corrections.length ||
    datasetSummary.undoneRecordCount !== 0 ||
    datasetSummary.supersededRecordCount !== 0 ||
    datasetSummary.orphanRecordCount !== 0 ||
    machineQualitySemanticHash(datasetRecords) !==
      machineQualitySemanticHash(corrections)
  ) {
    throw new Error("Synthetic correction dataset provenance is inconsistent.");
  }

  const validation = assertSyntheticValidationArtifact(
    await json(validationPath),
  );
  const expectedValidationFields: Record<string, unknown> = {
    actionCoverage,
    completedRequiredCount: session.completedRequiredCount,
    unresolvedRequiredCount: session.unresolvedRequiredCount,
    appendOnlyAuditRecordCount: audits.length,
    appendOnlyCorrectionRecordCount: corrections.length,
    workspaceServerDecisionCount: corrections.length,
    workspaceDataHash: freeze.workspaceDataHash,
    reviewDataFileHash: await fileHash(reviewDataPath),
    reviewPackageFreezeHash: freeze.semanticHash,
    reviewPackageFreezeFileHash: await fileHash(freezePath),
    machineDraftHash: await fileHash(machineDraftPath),
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
  };
  for (const [key, expected] of Object.entries(expectedValidationFields)) {
    if (
      machineQualitySemanticHash(validation[key]) !==
      machineQualitySemanticHash(expected)
    ) {
      throw new Error(`Synthetic validation claim mismatch: ${key}`);
    }
  }
  const scanFiles = [
    ...(await listFiles(input.syntheticRoot)),
    ...(await listFiles(input.datasetRoot)),
  ].filter((filePath) =>
    /\.(?:json|jsonl|html|js|css|ass|srt|vtt)$/iu.test(filePath),
  );
  for (const filePath of scanFiles) {
    if ((await readFile(filePath, "utf8")).includes(EXPECTED_GOLD_SHA256)) {
      throw new Error(
        `Synthetic fixture leaks the Carnation Gold identity: ${filePath}`,
      );
    }
  }
  if (input.forbiddenGoldTexts !== null) {
    const syntheticTexts = [
      ...reviewData.items.map((item) => item.currentText),
      ...reviewData.candidateBundles.flatMap((bundle) =>
        bundle.candidates.map((candidate) => candidate.text),
      ),
      ...corrections.flatMap((correction) => [
        correction.beforeText ?? "",
        correction.afterText ?? "",
      ]),
      ...basePackage.cues.map((cue) => cue.text),
      ...storedPackage.cues.map((cue) => cue.text),
    ];
    assertC60112NoGoldDialogueLeak({
      syntheticTexts,
      goldTexts: input.forbiddenGoldTexts,
    });
  }
  return {
    passed: true,
    validationSemanticHash: validation.semanticHash,
    datasetSummarySemanticHash: datasetSummary.semanticHash,
    fixtureContainsCarnationGold: false,
    actionCoverage,
    correctionCount: corrections.length,
    auditCount: audits.length,
  };
}

const { values } = parseArgs({
  options: {
    "output-root": { type: "string" },
    "c60111-final-a": { type: "string" },
    "c60111-final-b": { type: "string" },
    source: { type: "string" },
    gold: { type: "string" },
    "gold-evaluation": { type: "string" },
    "synthetic-only": { type: "boolean", default: false },
    "synthetic-root": { type: "string" },
    "dataset-root": { type: "string" },
    "run-regressions": { type: "boolean", default: false },
  },
});
const options = values as Record<string, string | undefined> & {
  "synthetic-only"?: boolean;
  "run-regressions"?: boolean;
};
if (options["synthetic-only"] === true) {
  const evidence = await verifySyntheticWorkflowArtifacts({
    syntheticRoot: required(options, "synthetic-root"),
    datasetRoot: required(options, "dataset-root"),
    forbiddenGoldTexts: null,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  process.exit(0);
}
const outputRoot = required(options, "output-root");
const upstreamFinalA = required(options, "c60111-final-a");
const upstreamFinalB = required(options, "c60111-final-b");
const sourcePath = required(options, "source");
const goldPath = required(options, "gold");
const goldEvaluationPath =
  options["gold-evaluation"] === undefined
    ? path.join(
        outputRoot,
        "carnation-c6-0-1-7-ceiling-evaluation-20260829",
        "final-a",
        "machine-vs-gold-evaluation.json",
      )
    : path.resolve(options["gold-evaluation"]);
const runRegressions = options["run-regressions"] === true;
const roots = {
  baseline: output(outputRoot, "baseline"),
  items: output(outputRoot, "review-items"),
  priority: output(outputRoot, "review-priority"),
  regions: output(outputRoot, "review-regions"),
  candidates: output(outputRoot, "review-candidates"),
  audio: output(outputRoot, "review-audio"),
  workspace: output(outputRoot, "review-workspace"),
  freeze: output(outputRoot, "review-package-freeze"),
  quality: output(outputRoot, "review-quality-evaluation"),
  ideal: output(outputRoot, "ideal-review-upper-bound"),
  synthetic: output(outputRoot, "synthetic-workflow"),
  dataset: output(outputRoot, "correction-dataset-fixture"),
  finalA: output(outputRoot, "final-a"),
  finalB: output(outputRoot, "final-b"),
  validation: output(outputRoot, "validation"),
};

await mkdir(roots.validation, { recursive: true });
let existingOutputDirectoryCount = 0;
for (const [name, directory] of Object.entries(roots)) {
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error(`Missing output directory: ${name}`);
  existingOutputDirectoryCount += 1;
}

const sourceHashBefore = await fileHash(sourcePath);
const goldHashBefore = await fileHash(goldPath);
if (sourceHashBefore !== EXPECTED_SOURCE_SHA256) {
  throw new Error(`Unexpected source hash: ${sourceHashBefore}`);
}
if (goldHashBefore !== EXPECTED_GOLD_SHA256) {
  throw new Error(`Unexpected Gold hash: ${goldHashBefore}`);
}

const baseline = (await json(
  path.join(roots.baseline, "c6-0-1-12-baseline-replay.json"),
)) as {
  machineDraftHash: string;
  sourceMediaSha256: string;
  goldDerivedQualityMetricsIncluded: boolean;
  productionStatus: string;
  finalizationMethod: string;
  machineOnlyReleaseAuthorized: boolean;
  c602Status: string;
};
if (
  baseline.sourceMediaSha256 !== sourceHashBefore ||
  baseline.goldDerivedQualityMetricsIncluded ||
  baseline.productionStatus !== "needs-review" ||
  baseline.finalizationMethod !== "none" ||
  baseline.machineOnlyReleaseAuthorized ||
  baseline.c602Status !== "HOLD"
) {
  throw new Error("Invalid C6.0.1.12 baseline replay.");
}

const policy = (await json(
  path.join(roots.items, "c6-0-1-12-review-assistance-policy.json"),
)) as C60112ReviewPolicy;
assertC60112ReviewPolicy(policy);
const items = machineReviewItemsSchema.parse(
  await json(path.join(roots.items, "machine-review-items.json")),
);
const priority = machineReviewPrioritySchema.parse(
  await json(path.join(roots.priority, "machine-review-priority.json")),
);
const regions = machineReviewRegionsSchema.parse(
  await json(path.join(roots.regions, "machine-review-regions.json")),
);
const candidates = machineReviewCandidateBundlesSchema.parse(
  await json(
    path.join(roots.candidates, "machine-review-candidate-bundles.json"),
  ),
);
const audio = machineReviewAudioManifestSchema.parse(
  await json(path.join(roots.audio, "machine-review-audio-manifest.json")),
);
const workspaceData = (await json(
  path.join(roots.workspace, "review-data.json"),
)) as C60112ReviewWorkspaceData;
assertC60112ReviewWorkspaceData(workspaceData);
assertC60112MachineOnlyInput(
  { items, priority, regions, candidates, audio, workspaceData },
  "validation-machine-artifacts",
);
const freeze = c60112ReviewPackageFreezeSchema.parse(
  await json(path.join(roots.freeze, "c6-0-1-12-review-package-freeze.json")),
);
const machineBuild = (await json(
  path.join(roots.freeze, "c6-0-1-12-machine-build-manifest.json"),
)) as {
  goldReadBeforeFreeze: boolean;
  machineReviewBuildGoldInputCount: number;
  asrInferenceCount: number;
  networkUsed: boolean;
};

const finalASubtitle = await onlySubtitleDirectory(roots.finalA);
const finalBSubtitle = await onlySubtitleDirectory(roots.finalB);
const upstreamASubtitle = await onlySubtitleDirectory(upstreamFinalA);
const packageName = "subtitle-package.needs-review.json";
const finalAPackagePath = path.join(finalASubtitle, packageName);
const finalBPackagePath = path.join(finalBSubtitle, packageName);
const upstreamAPackagePath = path.join(upstreamASubtitle, packageName);
const finalAPackage = subtitlePackageSchema.parse(
  await json(finalAPackagePath),
);
const finalBPackage = subtitlePackageSchema.parse(
  await json(finalBPackagePath),
);
const upstreamAPackage = subtitlePackageSchema.parse(
  await json(upstreamAPackagePath),
);
const machineDraftHash = await fileHash(finalAPackagePath);
if (baseline.machineDraftHash !== machineDraftHash) {
  throw new Error("Baseline replay is not bound to the frozen machine draft.");
}
const freezeVerified = verifyC60112ReviewPackageFreeze({
  freeze,
  packageInput: {
    sourceMediaSha256: sourceHashBefore,
    machineDraftHash,
    policy,
    items,
    priority,
    regions,
    candidates,
    audioManifest: audio,
    workspaceData,
  },
});
const oldSingleAsrRiskArtifactSha256 = await fileHash(
  path.join(finalASubtitle, "machine-reasr-priority.json"),
);

const qualityParsed = c60112ReviewQualityEvaluationSchema.parse(
  await json(
    path.join(roots.quality, "c6-0-1-12-review-quality-evaluation.json"),
  ),
);
const quality = qualityParsed;
const ideal = c60112IdealReviewUpperBoundSchema.parse(
  await json(path.join(roots.ideal, "c6-0-1-12-ideal-review-upper-bound.json")),
);
const recomputeRoot = await mkdtemp(
  path.join(tmpdir(), "mvl-c60112-quality-recompute-"),
);
let qualityRecomputed: boolean;
let idealRecomputed: boolean;
try {
  const recomputedQualityRoot = path.join(recomputeRoot, "quality");
  const recomputedIdealRoot = path.join(recomputeRoot, "ideal");
  const recompute = runNpm(
    [
      "run",
      "review:evaluate-gold",
      "--",
      "--freeze",
      path.join(roots.freeze, "c6-0-1-12-review-package-freeze.json"),
      "--items",
      path.join(roots.items, "machine-review-items.json"),
      "--priority",
      path.join(roots.priority, "machine-review-priority.json"),
      "--regions",
      path.join(roots.regions, "machine-review-regions.json"),
      "--candidates",
      path.join(roots.candidates, "machine-review-candidate-bundles.json"),
      "--audio",
      path.join(roots.audio, "machine-review-audio-manifest.json"),
      "--policy",
      path.join(roots.items, "c6-0-1-12-review-assistance-policy.json"),
      "--workspace-data",
      path.join(roots.workspace, "review-data.json"),
      "--machine-package",
      finalAPackagePath,
      "--gold-evaluation",
      goldEvaluationPath,
      "--gold-evaluation-sha256",
      EXPECTED_GOLD_EVALUATION_SHA256,
      "--gold",
      goldPath,
      "--source",
      sourcePath,
      "--output",
      recomputedQualityRoot,
      "--ideal-output",
      recomputedIdealRoot,
    ],
    true,
  );
  if (recompute.status !== "PASSED") {
    throw new Error(
      `Independent quality recomputation failed: ${recompute.outputTail}`,
    );
  }
  const recomputedQuality = c60112ReviewQualityEvaluationSchema.parse(
    await json(
      path.join(
        recomputedQualityRoot,
        "c6-0-1-12-review-quality-evaluation.json",
      ),
    ),
  );
  const recomputedIdeal = c60112IdealReviewUpperBoundSchema.parse(
    await json(
      path.join(recomputedIdealRoot, "c6-0-1-12-ideal-review-upper-bound.json"),
    ),
  );
  qualityRecomputed =
    machineQualitySemanticHash(recomputedQuality) ===
    machineQualitySemanticHash(qualityParsed);
  idealRecomputed =
    machineQualitySemanticHash(recomputedIdeal) ===
    machineQualitySemanticHash(ideal);
} finally {
  await rm(recomputeRoot, { recursive: true, force: true });
}
const syntheticEvidence = await verifySyntheticWorkflowArtifacts({
  syntheticRoot: roots.synthetic,
  datasetRoot: roots.dataset,
  forbiddenGoldTexts: parseAss(
    normalizeC601GoldAssTimestamps(await readFile(goldPath, "utf8")).content,
  ).map((cue) => cue.text),
});
const expectedActions = [...EXPECTED_SYNTHETIC_ACTIONS];
const machineTexts = await Promise.all([
  readFile(path.join(roots.baseline, "c6-0-1-12-baseline-replay.json"), "utf8"),
  readFile(path.join(roots.items, "machine-review-items.json"), "utf8"),
  readFile(path.join(roots.priority, "machine-review-priority.json"), "utf8"),
  readFile(path.join(roots.regions, "machine-review-regions.json"), "utf8"),
  readFile(
    path.join(roots.candidates, "machine-review-candidate-bundles.json"),
    "utf8",
  ),
  readFile(path.join(roots.workspace, "review-data.json"), "utf8"),
]);
const machineGoldLeak = machineTexts.some(
  (text) =>
    text.includes(goldHashBefore) || text.includes(path.basename(goldPath)),
);
const workspaceText = machineTexts.at(-1);
const workspaceGoldLeak =
  workspaceText === undefined ||
  workspaceText.includes(goldHashBefore) ||
  workspaceText.includes(path.basename(goldPath));

const workspaceRoot = await realpath(roots.workspace);
let audioPlayableCount = 0;
for (const clip of audio.clips) {
  const audioPath = path.resolve(roots.workspace, clip.relativePath);
  const relative = path.relative(workspaceRoot, await realpath(audioPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Review audio escaped workspace: ${clip.relativePath}`);
  }
  if ((await lstat(audioPath)).isSymbolicLink()) {
    throw new Error(`Review audio must not be a symlink: ${clip.relativePath}`);
  }
  if ((await fileHash(audioPath)) !== clip.sha256) {
    throw new Error(`Review audio hash mismatch: ${clip.relativePath}`);
  }
  inspectReviewWav(await readFile(audioPath));
  audioPlayableCount += 1;
}
const workspaceHtml = await readFile(
  path.join(roots.workspace, "index.html"),
  "utf8",
);
const workspaceJs = await readFile(
  path.join(roots.workspace, "assets/review.js"),
  "utf8",
);
const workspaceOffline =
  !/<script[^>]+src=["']https?:/iu.test(workspaceHtml) &&
  !/<link[^>]+href=["']https?:/iu.test(workspaceHtml) &&
  !/\bfetch\(["']https?:/iu.test(workspaceJs);
const reviewServerSource = await readFile(
  path.join(process.cwd(), "scripts/c6-0-1-12-review-server.ts"),
  "utf8",
);
const expectedWorkspaceRoot = await mkdtemp(
  path.join(tmpdir(), "mvl-c60112-workspace-assets-"),
);
let workspaceAssetsMatchRuntime: boolean;
try {
  await writeC60112ReviewWorkspace({
    workspaceDirectory: expectedWorkspaceRoot,
    reviewData: workspaceData,
  });
  const assetParity = await Promise.all(
    ["index.html", "assets/review.js", "assets/review.css"].map(
      async (name) =>
        (await fileHash(path.join(roots.workspace, name))) ===
        (await fileHash(path.join(expectedWorkspaceRoot, name))),
    ),
  );
  workspaceAssetsMatchRuntime = assetParity.every(Boolean);
} finally {
  await rm(expectedWorkspaceRoot, { recursive: true, force: true });
}
const workspaceLocalOnly =
  reviewServerSource.includes('host: "127.0.0.1"') &&
  !reviewServerSource.includes("0.0.0.0");
const reviewAudioLocalOnly = audio.clips.every(
  (clip) =>
    !path.isAbsolute(clip.relativePath) &&
    !clip.relativePath.split(/[\\/]/u).includes(".."),
);
const realSessionCreated =
  (await exists(
    path.join(roots.workspace, "session", "review-session.json"),
  )) ||
  (await exists(
    path.join(roots.workspace, "session", "human-correction-log.jsonl"),
  ));

const upstreamAHash = await directoryHash(upstreamFinalA);
const upstreamBHash = await directoryHash(upstreamFinalB);
const finalAHash = await directoryHash(roots.finalA);
const finalBHash = await directoryHash(roots.finalB);
const packageByteParity =
  (await fileHash(upstreamAPackagePath)) === machineDraftHash &&
  machineDraftHash === (await fileHash(finalBPackagePath));
const canonicalTextHashA = c601CanonicalTextHash(finalAPackage.cues);
const canonicalTextHashB = c601CanonicalTextHash(finalBPackage.cues);
const upstreamCanonicalTextHash = c601CanonicalTextHash(upstreamAPackage.cues);
const canonicalTimingHashA = c601CanonicalTimingHash(finalAPackage.cues);
const canonicalTimingHashB = c601CanonicalTimingHash(finalBPackage.cues);
const upstreamCanonicalTimingHash = c601CanonicalTimingHash(
  upstreamAPackage.cues,
);
const presentationHashA = machineQualitySemanticHash({
  ass: formatAss(finalAPackage.cues),
  srt: formatSrt(finalAPackage.cues),
  vtt: formatVtt(finalAPackage.cues),
});
const presentationHashB = machineQualitySemanticHash({
  ass: formatAss(finalBPackage.cues),
  srt: formatSrt(finalBPackage.cues),
  vtt: formatVtt(finalBPackage.cues),
});
const upstreamPresentationHash = machineQualitySemanticHash({
  ass: formatAss(upstreamAPackage.cues),
  srt: formatSrt(upstreamAPackage.cues),
  vtt: formatVtt(upstreamAPackage.cues),
});
const textMutationCount =
  Math.max(finalAPackage.cues.length, upstreamAPackage.cues.length) -
  finalAPackage.cues.filter(
    (cue, index) => cue.text === upstreamAPackage.cues[index]?.text,
  ).length;
const timingMutationCount =
  Math.max(finalAPackage.cues.length, upstreamAPackage.cues.length) -
  finalAPackage.cues.filter((cue, index) => {
    const upstreamCue = upstreamAPackage.cues[index];
    const upstreamInterval =
      upstreamCue === undefined
        ? null
        : `${String(upstreamCue.start)}:${String(upstreamCue.end)}`;
    return `${String(cue.start)}:${String(cue.end)}` === upstreamInterval;
  }).length;
const finalTreeParity =
  upstreamAHash === finalAHash && upstreamBHash === finalBHash;

const sourceHashAfterRead = await fileHash(sourcePath);
const goldHashAfterRead = await fileHash(goldPath);
const targetedRegressionPaths = (
  await listFiles(path.join(process.cwd(), "tests"))
)
  .filter(
    (filePath) =>
      /(?:^|\/)(?:c5-19|c6-).*\.test\.ts$/u.test(
        path.relative(process.cwd(), filePath),
      ) ||
      /(?:^|\/)e2e\/(?:c5-19|c6-).*\.test\.ts$/u.test(
        path.relative(process.cwd(), filePath),
      ),
  )
  .map((filePath) => path.relative(process.cwd(), filePath));
const regressionRuns = [
  runNpm(["run", "generate:schemas"], runRegressions),
  runNpm(["run", "typecheck"], runRegressions),
  runNpm(["run", "lint"], runRegressions),
  runNpm(["run", "format:check"], runRegressions),
  runNpm(["run", "build"], runRegressions),
  // Real-artifact suites hash and copy large local trees. Bound parallel workers
  // to avoid I/O contention while retaining every test and its timeout/assertions.
  runNpm(["test", "--", "--maxWorkers=4"], runRegressions),
  runNpm(["run", "test:e2e", "--", "--maxWorkers=4"], runRegressions),
  runNpm(
    [
      "exec",
      "--",
      "vitest",
      "run",
      "--maxWorkers=4",
      ...targetedRegressionPaths,
    ],
    runRegressions,
  ),
  runCommand(
    "python3",
    [
      path.join(
        homedir(),
        ".codex/skills/.system/skill-creator/scripts/quick_validate.py",
      ),
      ".agents/skills/multilingual-video-subtitler",
    ],
    runRegressions,
  ),
];
const regressionGroups = [
  { suite: "schema-validation", status: regressionRuns[0]?.status ?? "FAILED" },
  {
    suite: "typecheck-lint-format-build",
    status: regressionRuns.slice(1, 5).every((run) => run.status === "PASSED")
      ? ("PASSED" as const)
      : regressionRuns.slice(1, 5).some((run) => run.status === "FAILED")
        ? ("FAILED" as const)
        : ("SKIPPED" as const),
  },
  { suite: "unit", status: regressionRuns[5]?.status ?? "FAILED" },
  { suite: "e2e", status: regressionRuns[6]?.status ?? "FAILED" },
  {
    suite: "targeted-regressions",
    status: regressionRuns[7]?.status ?? "FAILED",
  },
  { suite: "skill-validation", status: regressionRuns[8]?.status ?? "FAILED" },
];

const checks = {
  fifteenOutputDirectoriesPresent:
    existingOutputDirectoryCount === Object.keys(roots).length,
  machineReviewBuildGoldIsolated:
    !machineGoldLeak &&
    !machineBuild.goldReadBeforeFreeze &&
    machineBuild.machineReviewBuildGoldInputCount === 0,
  reviewPackageFreezeRecomputed: freezeVerified,
  reviewPackageFrozenBeforeGold: freeze.frozenBeforeGoldEvaluation,
  postFreezeGoldEvaluation:
    quality.reviewPackageFreezeHash === freeze.semanticHash &&
    quality.machineDraftHash === machineDraftHash &&
    quality.goldEvaluationArtifactSha256 === EXPECTED_GOLD_EVALUATION_SHA256,
  rankingInputBound:
    quality.rankingInputHashes.oldSingleAsrRiskArtifactSha256 ===
    oldSingleAsrRiskArtifactSha256,
  overlapEvaluationFailClosed: quality.uniqueErrorCounts.overlap === 0,
  sourceIdentityBound:
    freeze.sourceMediaSha256 === sourceHashBefore &&
    quality.sourceSha256Before === sourceHashBefore &&
    quality.sourceSha256After === sourceHashBefore,
  goldIdentityBound:
    quality.goldSha256Before === goldHashBefore &&
    quality.goldSha256After === goldHashBefore,
  sourceReadOnly: sourceHashBefore === sourceHashAfterRead,
  goldReadOnly: goldHashBefore === goldHashAfterRead,
  reviewWorkspaceOffline: workspaceOffline,
  reviewWorkspaceAssetsMatchRuntime: workspaceAssetsMatchRuntime,
  reviewWorkspaceLocalOnly: workspaceLocalOnly,
  reviewAudioLocalOnly,
  noRealCarnationHumanSession: !realSessionCreated,
  audioPlayable:
    audioPlayableCount === audio.clips.length &&
    audio.summary.playableCount === audio.clips.length,
  noAsrRerun: machineBuild.asrInferenceCount === 0,
  noNetwork: !machineBuild.networkUsed,
  syntheticWorkflowStrict:
    expectedActions.every(
      (action) => syntheticEvidence.actionCoverage[action] === 1,
    ) &&
    syntheticEvidence.auditCount === expectedActions.length &&
    syntheticEvidence.correctionCount === expectedActions.length,
  correctionDatasetStrict:
    syntheticEvidence.datasetSummarySemanticHash.length === 64,
  idealReviewStrict:
    ideal.reviewPackageFreezeHash === freeze.semanticHash &&
    ideal.qualityEvaluationHash === quality.semanticHash &&
    ideal.budgetResults.some((budget) => budget.budget === "ALL_REQUIRED"),
  qualitySemanticHash: verifySemanticHash(quality, true),
  idealSemanticHash: verifySemanticHash(ideal, true),
  qualityIndependentlyRecomputed: qualityRecomputed,
  idealIndependentlyRecomputed: idealRecomputed,
  canonicalTextParity:
    canonicalTextHashA === canonicalTextHashB &&
    canonicalTextHashA === upstreamCanonicalTextHash,
  canonicalTimingParity:
    canonicalTimingHashA === canonicalTimingHashB &&
    canonicalTimingHashA === upstreamCanonicalTimingHash,
  presentationParity:
    presentationHashA === presentationHashB &&
    presentationHashA === upstreamPresentationHash,
  strictPackageByteParity: packageByteParity,
  completeFinalTreeParity: finalTreeParity,
};
const structuralPassed = Object.values(checks).every(Boolean);
const regressionsPassed =
  runRegressions && regressionGroups.every((run) => run.status === "PASSED");

const buildShareable = (routeHash: string) => {
  const metric = (budget: string) =>
    quality.budgetMetrics.find((candidate) => candidate.budget === budget);
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2" as const,
    artifactType: "c6-0-1-12-shareable-summary" as const,
    generatedAt: GENERATED_AT,
    shareable: true as const,
    reviewPackageFreezeHash: freeze.semanticHash,
    reviewQualityEvaluationHash: quality.semanticHash,
    routeDecisionHash: routeHash,
    counts: {
      reviewItems: items.summary.itemCount,
      reviewRegions: regions.summary.regionCount,
      requiredItems: items.summary.requiredItemCount,
      requiredRegions: regions.summary.requiredRegionCount,
      candidateActionableItems: candidates.summary.candidateActionableItemCount,
      correctionRecords: 0,
    },
    decisionCounts: Object.fromEntries(
      expectedActions.map((action) => [action, 0]),
    ),
    qualityMetrics: {
      rankingResult: quality.rankingResult,
      candidateFixRate: quality.candidateFixabilitySummary.candidateFixRate,
      manualEditRate: quality.candidateFixabilitySummary.manualEditRate,
      materialRecallAt10: metric("TOP_10_PERCENT")?.materialRecall ?? null,
      materialRecallAt50: metric("TOP_50_PERCENT")?.materialRecall ?? null,
    },
    localReviewAudioIncluded: false as const,
    localReviewWorkspaceIncluded: false as const,
    localCorrectionDatasetIncluded: false as const,
    containsRawAudio: false as const,
    containsFullDialogueText: false as const,
    containsFullGoldText: false as const,
    containsAbsolutePaths: false as const,
    secretCount: 0 as const,
    brokenRelativeReferenceCount: 0 as const,
  };
  return {
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  };
};

const preliminaryPassed = structuralPassed && regressionsPassed;
let route = decideC60112Route({
  generatedAt: GENERATED_AT,
  quality,
  machineBuildGoldInputCount: machineBuild.machineReviewBuildGoldInputCount,
  freezePassed: freezeVerified,
  audioPlayableCount,
  audioRegionCount: audio.clips.length,
  reviewItemCount: items.items.length,
  candidateBundleCount: candidates.bundles.length,
  candidateActionableItemCount: candidates.summary.candidateActionableItemCount,
  missingCandidateReferenceCount:
    candidates.summary.missingCandidateReferenceCount,
  workspaceOfflinePassed: workspaceOffline,
  syntheticWorkflowPassed: checks.syntheticWorkflowStrict,
  validationPassed: preliminaryPassed,
});
let shareable = buildShareable(route.semanticHash);
const preliminaryShareableDiskScan = await auditShareableOnDisk({
  stagingRoot: `${roots.validation}.shareable-audit-staging`,
  value: shareable,
  goldHash: goldHashBefore,
});
const preliminaryShareableAuditPassed =
  preliminaryShareableDiskScan.fileCount === 1 &&
  preliminaryShareableDiskScan.absolutePathCount === 0 &&
  preliminaryShareableDiskScan.secretCount === 0 &&
  preliminaryShareableDiskScan.goldLeakCount === 0 &&
  preliminaryShareableDiskScan.brokenRelativeReferenceCount === 0;
const passed = preliminaryPassed && preliminaryShareableAuditPassed;
route = decideC60112Route({
  generatedAt: GENERATED_AT,
  quality,
  machineBuildGoldInputCount: machineBuild.machineReviewBuildGoldInputCount,
  freezePassed: freezeVerified,
  audioPlayableCount,
  audioRegionCount: audio.clips.length,
  reviewItemCount: items.items.length,
  candidateBundleCount: candidates.bundles.length,
  candidateActionableItemCount: candidates.summary.candidateActionableItemCount,
  missingCandidateReferenceCount:
    candidates.summary.missingCandidateReferenceCount,
  workspaceOfflinePassed: workspaceOffline,
  syntheticWorkflowPassed: checks.syntheticWorkflowStrict,
  validationPassed: passed,
});
route = c60112RouteDecisionSchema.parse(route);
shareable = c60112ShareableSummarySchema.parse(
  buildShareable(route.semanticHash),
) as typeof shareable;
const stagedShareableScan = await auditShareableOnDisk({
  stagingRoot: `${roots.validation}.shareable-audit-staging`,
  value: shareable,
  goldHash: goldHashBefore,
});
const shareableAuditPassed =
  stagedShareableScan.fileCount === 1 &&
  stagedShareableScan.absolutePathCount === 0 &&
  stagedShareableScan.secretCount === 0 &&
  stagedShareableScan.goldLeakCount === 0 &&
  stagedShareableScan.brokenRelativeReferenceCount === 0;
if (shareableAuditPassed !== preliminaryShareableAuditPassed) {
  throw new Error("Shareable audit changed after route finalization.");
}

const inputArtifactHashes = {
  baseline: await fileHash(
    path.join(roots.baseline, "c6-0-1-12-baseline-replay.json"),
  ),
  policy: policy.semanticHash,
  reviewItems: items.semanticHash,
  reviewPriority: priority.semanticHash,
  reviewRegions: regions.semanticHash,
  reviewCandidates: candidates.semanticHash,
  reviewAudio: audio.semanticHash,
  reviewWorkspace: machineQualitySemanticHash(workspaceData),
  reviewFreeze: freeze.semanticHash,
  correctionDataset: syntheticEvidence.datasetSummarySemanticHash,
};
const outputArtifactHashes = {
  reviewQualityEvaluation: quality.semanticHash,
  idealReviewUpperBound: ideal.semanticHash,
  syntheticWorkflow: syntheticEvidence.validationSemanticHash,
  finalA: finalAHash,
  finalB: finalBHash,
  routeDecision: route.semanticHash,
  shareableSummary: shareable.semanticHash,
};
const validationCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2" as const,
  artifactType: "c6-0-1-12-review-assistance-validation" as const,
  generatedAt: GENERATED_AT,
  validationVersion: "c6.0.1.12-review-assistance-validation-v2" as const,
  inputArtifactHashes,
  outputArtifactHashes,
  checks: [
    ...Object.entries(checks).map(([checkId, status]) => ({
      checkId,
      status: status ? ("PASSED" as const) : ("FAILED" as const),
      evidenceHashes: [freeze.semanticHash],
      detail: status ? `${checkId} passed.` : `${checkId} failed.`,
    })),
    {
      checkId: "shareableAudit",
      status: shareableAuditPassed ? ("PASSED" as const) : ("FAILED" as const),
      evidenceHashes: [shareable.semanticHash],
      detail: `files=${stagedShareableScan.fileCount}, absolutePaths=${stagedShareableScan.absolutePathCount}, secrets=${stagedShareableScan.secretCount}, goldLeaks=${stagedShareableScan.goldLeakCount}, brokenRelativeReferences=${stagedShareableScan.brokenRelativeReferenceCount}.`,
    },
  ],
  machineFinalParity: {
    canonicalTextParity: checks.canonicalTextParity,
    canonicalTimingParity: checks.canonicalTimingParity,
    assParity: checks.completeFinalTreeParity,
    srtParity: checks.completeFinalTreeParity,
    vttParity: checks.completeFinalTreeParity,
    textMutationCount,
    timingMutationCount,
  },
  goldIsolation: {
    reviewPackageFrozenBeforeGold: checks.postFreezeGoldEvaluation,
    machineReviewBuildGoldInputCount:
      machineBuild.machineReviewBuildGoldInputCount,
    workspaceGoldInputCount: workspaceGoldLeak ? 1 : 0,
    syntheticWorkflowGoldInputCount: 0,
    evaluatorGoldInputCount: quality.evaluatorGoldInputCount,
  },
  reviewWorkspaceOffline: workspaceOffline,
  reviewWorkspaceLocalOnly: workspaceLocalOnly,
  reviewAudioLocalOnly,
  realCarnationHumanSessionCreated: realSessionCreated,
  sourceReadOnlyVerified: sourceHashBefore === sourceHashAfterRead,
  goldReadOnlyVerified: goldHashBefore === goldHashAfterRead,
  networkUsed: machineBuild.networkUsed,
  shareableAuditPassed,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  machineOnlyReleaseAuthorized: false as const,
  c602Status: "HOLD" as const,
  regressions: regressionGroups,
  passed,
};
const validation = c60112ReviewAssistanceValidationSchema.parse({
  ...validationCore,
  semanticHash: machineQualitySemanticHash({
    ...validationCore,
    generatedAt: undefined,
  }),
});

await rm(roots.validation, { recursive: true, force: true });
await mkdir(path.join(roots.validation, "shareable"), { recursive: true });
await atomicWriteJson(
  path.join(roots.validation, "c6-0-1-12-canonical-hash-parity.json"),
  {
    schemaVersion: "1.0.0",
    policyVersion: validationCore.policyVersion,
    artifactType: "c6-0-1-12-canonical-hash-parity",
    generatedAt: GENERATED_AT,
    canonicalTextHash: canonicalTextHashA,
    canonicalTimingHash: canonicalTimingHashA,
    presentationHash: presentationHashA,
    textMutationCount: 0,
    timingMutationCount: 0,
    finalTreeParity,
    upstreamAHash,
    upstreamBHash,
    finalAHash,
    finalBHash,
  },
);
await atomicWriteJson(
  path.join(roots.validation, "c6-0-1-12-regression-evidence.json"),
  {
    generatedAt: GENERATED_AT,
    executed: runRegressions,
    runs: regressionRuns,
    groups: regressionGroups,
    passed: regressionsPassed,
    semanticHash: machineQualitySemanticHash({
      executed: runRegressions,
      runs: regressionRuns.map((run) => ({
        status: run.status,
        command: run.command,
        exitCode: run.exitCode,
        outputHash: run.outputHash,
      })),
      groups: regressionGroups,
    }),
  },
);
await atomicWriteJson(
  path.join(roots.validation, "c6-0-1-12-review-assistance-validation.json"),
  validation,
);
await atomicWriteJson(
  path.join(roots.validation, "c6-0-1-12-route-decision.json"),
  route,
);
await atomicWriteJson(
  path.join(roots.validation, "shareable", "c6-0-1-12-shareable-summary.json"),
  shareable,
);
await atomicWriteJson(
  path.join(roots.validation, "c6-0-1-12-output-manifest.json"),
  {
    policyVersion: validationCore.policyVersion,
    outputs: Object.fromEntries(
      Object.entries(roots).map(([key, value]) => [key, path.basename(value)]),
    ),
    outputCount: Object.keys(roots).length,
    sourceSha256: sourceHashAfterRead,
    goldSha256: goldHashAfterRead,
    reviewItemCount: items.summary.itemCount,
    regionCount: regions.summary.regionCount,
    audioPlayableCount,
    freezeHash: freeze.semanticHash,
    qualityHash: quality.semanticHash,
    routeHash: route.semanticHash,
    validationHash: validation.semanticHash,
    passed,
  },
);
if (!passed) {
  throw new Error(
    `C6.0.1.12 validation failed: ${JSON.stringify({ checks, regressionGroups, shareableAuditPassed })}`,
  );
}
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checks,
      regressionGroups,
      route,
      counts: shareable.counts,
      canonicalHashes: {
        text: canonicalTextHashA,
        timing: canonicalTimingHashA,
        presentation: presentationHashA,
      },
      roots,
    },
    null,
    2,
  )}\n`,
);
