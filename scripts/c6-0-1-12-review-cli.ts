import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  atomicWriteFile,
  atomicWriteJson,
  c60112ReviewPackageFreezeSchema,
  correctionDatasetSummarySchema,
  humanCorrectionRecordSchema,
  humanReviewManifestSchema,
  machineReviewAudioManifestSchema,
  reviewAuditRecordSchema,
  reviewSessionSchema,
  subtitlePackageSchema,
  type HumanCorrectionRecord,
  type C60112ReviewPackageFreeze,
  type ReviewAuditRecord,
  type ReviewDecisionType,
  type ReviewSession,
} from "@mvl/shared";
import {
  C60112_DECISION_TYPES,
  applyC60112ReviewDecisions,
  assertC60112FrozenWorkspaceData,
  assertC60112ReviewWorkspaceData,
  assertC60112SafeRelativePath,
  c60112CueHash,
  inspectReviewWav,
  machineQualitySemanticHash,
  materializeC60112ActiveCorrectionSnapshot,
  type C60112CandidateChoice,
  type C60112ReviewDecision,
  type C60112ReviewWorkspaceData,
  type C60112WorkspaceCandidate,
} from "@mvl/video-subtitler";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function option(
  values: Record<string, string | undefined>,
  name: string,
): string {
  const value = values[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing --${name}.`);
  }
  return path.resolve(value);
}

function optionalPath(
  values: Record<string, string | undefined>,
  name: string,
): string | null {
  const value = values[name];
  return value === undefined || value.trim() === ""
    ? null
    : path.resolve(value);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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

async function parsedJsonLines<T>(
  filePath: string,
  parse: (value: unknown) => T,
): Promise<T[]> {
  const lines = (await readFile(filePath, "utf8")).split(/\r?\n/u);
  return lines.flatMap((line, index) => {
    if (line.trim() === "") return [];
    try {
      return [parse(JSON.parse(line) as unknown)];
    } catch (error) {
      throw new Error(
        `Invalid JSONL record at ${filePath}:${String(index + 1)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });
}

function assertHash(value: string, label: string): void {
  if (!HASH_PATTERN.test(value)) throw new Error(`${label} is not SHA-256.`);
}

async function reviewData(
  filePath: string,
): Promise<C60112ReviewWorkspaceData> {
  const value = await json(filePath);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Review data must be an object.");
  }
  const data = value as C60112ReviewWorkspaceData;
  assertC60112ReviewWorkspaceData(data);
  assertHash(data.machineDraftHash, "review-data machineDraftHash");
  assertHash(
    data.reviewPackageSemanticHash,
    "review-data reviewPackageSemanticHash",
  );
  return data;
}

async function frozenReviewData(input: {
  reviewDataPath: string;
  freezePath: string;
}): Promise<{
  data: C60112ReviewWorkspaceData;
  freeze: C60112ReviewPackageFreeze;
  reviewDataFileHash: string;
}> {
  const [data, freezeValue, reviewDataFileHash] = await Promise.all([
    reviewData(input.reviewDataPath),
    json(input.freezePath),
    fileHash(input.reviewDataPath),
  ]);
  const freeze = c60112ReviewPackageFreezeSchema.parse(freezeValue);
  assertC60112FrozenWorkspaceData({ freeze, workspaceData: data });
  return { data, freeze, reviewDataFileHash };
}

async function reviewSession(filePath: string): Promise<ReviewSession> {
  return reviewSessionSchema.parse(await json(filePath));
}

async function correctionRecords(
  filePath: string,
): Promise<HumanCorrectionRecord[]> {
  const records = await parsedJsonLines(filePath, (value) =>
    humanCorrectionRecordSchema.parse(value),
  );
  const ids = new Set<string>();
  const decisionIds = new Set<string>();
  for (const record of records) {
    if (ids.has(record.recordId)) {
      throw new Error(`Duplicate correction record ID: ${record.recordId}`);
    }
    if (decisionIds.has(record.decisionId)) {
      throw new Error(`Duplicate correction decision ID: ${record.decisionId}`);
    }
    ids.add(record.recordId);
    decisionIds.add(record.decisionId);
  }
  return records;
}

async function auditRecords(filePath: string): Promise<ReviewAuditRecord[]> {
  return parsedJsonLines(filePath, (value) =>
    reviewAuditRecordSchema.parse(value),
  );
}

function candidateBundleHash(
  data: C60112ReviewWorkspaceData,
  reviewItemId: string,
): string {
  const bundle = data.candidateBundles.find(
    (candidate) => candidate.reviewItemId === reviewItemId,
  );
  if (bundle === undefined) {
    throw new Error(`Missing candidate bundle for ${reviewItemId}.`);
  }
  return machineQualitySemanticHash(bundle);
}

interface AuditItemState {
  recordId: string;
  decisionId: string;
  decisionType: ReviewDecisionType;
  selectedCandidateId: string | null;
  afterText: string | null;
  afterStart: number | null;
  afterEnd: number | null;
  reviewerNote: string | null;
  updatedAt: string;
}

function itemStateFromCorrection(
  record: HumanCorrectionRecord,
): AuditItemState {
  return {
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
}

function verifyAuditChain(input: {
  session: ReviewSession;
  corrections: readonly HumanCorrectionRecord[];
  audit: readonly ReviewAuditRecord[];
}): void {
  const correctionById = new Map(
    input.corrections.map((record) => [record.recordId, record]),
  );
  const itemStates: Record<string, AuditItemState> = {};
  let previousTimestamp = "";
  for (const record of input.audit) {
    if (record.sessionId !== input.session.sessionId) {
      throw new Error(`Foreign audit session: ${record.auditId}`);
    }
    if (previousTimestamp !== "" && record.timestamp < previousTimestamp) {
      throw new Error(`Audit log is not timestamp ordered: ${record.auditId}`);
    }
    previousTimestamp = record.timestamp;
    const before = itemStates[record.reviewItemId] ?? null;
    if (record.beforeHash !== machineQualitySemanticHash(before)) {
      throw new Error(`Audit beforeHash mismatch: ${record.auditId}`);
    }
    if (record.operation === "DECISION") {
      if (record.newDecision === null || record.undoneRecordId !== null) {
        throw new Error(`Malformed DECISION audit record: ${record.auditId}`);
      }
      const correction = correctionById.get(record.newDecision);
      if (
        correction?.reviewItemId !== record.reviewItemId ||
        record.previousDecision !== (before?.recordId ?? null)
      ) {
        throw new Error(`Broken DECISION audit link: ${record.auditId}`);
      }
      itemStates[record.reviewItemId] = itemStateFromCorrection(correction);
    } else {
      const currentRecordId = before?.recordId ?? null;
      if (
        record.undoneRecordId === null ||
        record.previousDecision !== currentRecordId ||
        record.undoneRecordId !== currentRecordId
      ) {
        throw new Error(`Broken UNDO audit link: ${record.auditId}`);
      }
      if (record.newDecision === null) {
        Reflect.deleteProperty(itemStates, record.reviewItemId);
      } else {
        const previous = correctionById.get(record.newDecision);
        if (previous?.reviewItemId !== record.reviewItemId) {
          throw new Error(`Broken UNDO predecessor: ${record.auditId}`);
        }
        itemStates[record.reviewItemId] = itemStateFromCorrection(previous);
      }
    }
    const after = itemStates[record.reviewItemId] ?? null;
    if (record.afterHash !== machineQualitySemanticHash(after)) {
      throw new Error(`Audit afterHash mismatch: ${record.auditId}`);
    }
  }
  if (
    machineQualitySemanticHash(itemStates) !==
    machineQualitySemanticHash(input.session.itemStates)
  ) {
    throw new Error("Audit terminal state does not match review session.");
  }
}

function validateSessionIntegrity(input: {
  data: C60112ReviewWorkspaceData;
  session: ReviewSession;
  corrections: readonly HumanCorrectionRecord[];
  audit: readonly ReviewAuditRecord[];
  requireComplete: boolean;
}): HumanCorrectionRecord[] {
  if (
    input.session.machineDraftHash !== input.data.machineDraftHash ||
    input.session.reviewPackageSemanticHash !==
      input.data.reviewPackageSemanticHash ||
    input.session.reviewPolicyVersion !== input.data.policyVersion ||
    machineQualitySemanticHash(input.session.sourceMediaIdentity) !==
      machineQualitySemanticHash(input.data.sourceMediaIdentity) ||
    machineQualitySemanticHash(input.session.machineDraftIdentity) !==
      machineQualitySemanticHash(input.data.machineDraftIdentity)
  ) {
    throw new Error("REVIEW_SESSION_BASE_MISMATCH");
  }
  const requiredItems = input.data.items.filter(
    (item) => item.requiredLevel === "REQUIRED",
  );
  const isCompleted = (reviewItemId: string): boolean => {
    const state = input.session.itemStates[reviewItemId];
    return state !== undefined && state.decisionType !== "UNRESOLVED";
  };
  const completedRequiredCount = requiredItems.filter((item) =>
    isCompleted(item.reviewItemId),
  ).length;
  const unresolvedRequiredCount = requiredItems.length - completedRequiredCount;
  const regionStates = Object.fromEntries(
    input.data.regions.map((region) => {
      const regionRequired = requiredItems.filter((item) =>
        region.reviewItemIds.includes(item.reviewItemId),
      );
      const regionCompleted = regionRequired.filter((item) =>
        isCompleted(item.reviewItemId),
      ).length;
      return [
        region.regionId,
        {
          requiredItemCount: regionRequired.length,
          completedRequiredCount: regionCompleted,
          unresolvedRequiredCount: regionRequired.length - regionCompleted,
          complete: regionCompleted === regionRequired.length,
        },
      ];
    }),
  );
  if (
    input.session.completedRequiredCount !== completedRequiredCount ||
    input.session.unresolvedRequiredCount !== unresolvedRequiredCount ||
    input.session.reviewComplete !== (unresolvedRequiredCount === 0) ||
    machineQualitySemanticHash(input.session.regionStates) !==
      machineQualitySemanticHash(regionStates)
  ) {
    throw new Error("REVIEW_SESSION_COMPLETION_SUMMARY_MISMATCH");
  }
  if (input.requireComplete && unresolvedRequiredCount !== 0) {
    throw new Error("REVIEW_SESSION_INCOMPLETE");
  }
  const itemById = new Map(
    input.data.items.map((item) => [item.reviewItemId, item]),
  );
  const correctionById = new Map(
    input.corrections.map((record) => [record.recordId, record]),
  );
  for (const record of input.corrections) {
    const item = itemById.get(record.reviewItemId);
    if (item === undefined) {
      throw new Error(
        `Correction references an unknown review item: ${record.recordId}`,
      );
    }
    if (!item.suggestedActions.includes(record.decisionType)) {
      throw new Error(
        `ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM:${record.recordId}`,
      );
    }
    switch (record.decisionType) {
      case "KEEP_CURRENT":
        if (item.finalCueIds.length === 0) {
          throw new Error(
            `ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM:${record.recordId}`,
          );
        }
        break;
      case "MARK_FALSE_POSITIVE":
      case "ADD_NEW_CUE":
        if (item.finalCueIds.length !== 0) {
          throw new Error(
            `ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM:${record.recordId}`,
          );
        }
        break;
      case "USE_REAZON":
      case "USE_WHISPER_ALTERNATE":
      case "MANUAL_EDIT":
      case "TIMING_EDIT":
        if (item.finalCueIds.length !== 1) {
          throw new Error(`SINGLE_CUE_ACTION_REQUIRED:${record.recordId}`);
        }
        break;
      case "WAIVE_REVIEW":
        if ((record.reviewerNote?.trim() ?? "") === "") {
          throw new Error(`WAIVER_NOTE_REQUIRED:${record.recordId}`);
        }
        break;
      case "UNRESOLVED":
        break;
    }
    const bundle = input.data.candidateBundles.find(
      (candidate) => candidate.reviewItemId === record.reviewItemId,
    );
    if (bundle === undefined) {
      throw new Error(
        `Correction candidate bundle is missing: ${record.recordId}`,
      );
    }
    const selectedCandidate = bundle.candidates.find(
      (candidate) => candidate.candidateId === record.selectedCandidateId,
    );
    const requiredCandidateLabel =
      record.decisionType === "USE_REAZON"
        ? "REAZON"
        : record.decisionType === "USE_WHISPER_ALTERNATE"
          ? "WHISPER_ALT"
          : null;
    if (
      requiredCandidateLabel !== null &&
      (selectedCandidate === undefined ||
        !selectedCandidate.labels.includes(requiredCandidateLabel) ||
        selectedCandidate.text !== record.afterText)
    ) {
      throw new Error(
        `Correction candidate scope mismatch: ${record.recordId}`,
      );
    }
    if (
      requiredCandidateLabel === null &&
      record.selectedCandidateId !== null
    ) {
      throw new Error(`Unexpected selected candidate: ${record.recordId}`);
    }
    if (
      record.sessionId !== input.session.sessionId ||
      record.machineDraftHash !== input.data.machineDraftHash ||
      record.evidenceSnapshotHash !== item.semanticHash ||
      record.candidateSetHash !==
        candidateBundleHash(input.data, record.reviewItemId) ||
      machineQualitySemanticHash(record.cueIds) !==
        machineQualitySemanticHash(item.finalCueIds)
    ) {
      throw new Error(
        `Correction is not bound to the frozen review item: ${record.recordId}`,
      );
    }
  }
  const active = Object.entries(input.session.itemStates).map(
    ([reviewItemId, state]) => {
      const correction = correctionById.get(state.recordId);
      if (
        correction?.reviewItemId !== reviewItemId ||
        correction.decisionId !== state.decisionId ||
        machineQualitySemanticHash(state) !==
          machineQualitySemanticHash(itemStateFromCorrection(correction))
      ) {
        throw new Error(
          `Session item state is not backed by its correction: ${reviewItemId}`,
        );
      }
      return correction;
    },
  );
  verifyAuditChain(input);
  return active.toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.recordId.localeCompare(right.recordId),
  );
}

type CorrectionLifecycleStatus = "ACTIVE" | "UNDONE" | "SUPERSEDED" | "ORPHAN";

interface CorrectionLifecycleRecord {
  recordId: string;
  decisionId: string;
  sessionId: string;
  reviewItemId: string;
  status: CorrectionLifecycleStatus;
  decisionAuditId: string | null;
  terminalAuditId: string | null;
}

function classifyCorrectionLifecycle(input: {
  session: ReviewSession;
  corrections: readonly HumanCorrectionRecord[];
  audit: readonly ReviewAuditRecord[];
}): CorrectionLifecycleRecord[] {
  const activeRecordIds = new Set(
    Object.values(input.session.itemStates).map((state) => state.recordId),
  );
  const decisionAuditByRecordId = new Map<string, string>();
  const undoAuditByRecordId = new Map<string, string>();
  for (const auditRecord of input.audit) {
    if (auditRecord.operation === "DECISION") {
      const correctionRecordId = auditRecord.newDecision;
      if (correctionRecordId === null) {
        throw new Error(`MALFORMED_DECISION_AUDIT:${auditRecord.auditId}`);
      }
      if (decisionAuditByRecordId.has(correctionRecordId)) {
        throw new Error(
          `DUPLICATE_CORRECTION_DECISION_AUDIT:${correctionRecordId}`,
        );
      }
      decisionAuditByRecordId.set(correctionRecordId, auditRecord.auditId);
    } else {
      const undoneRecordId = auditRecord.undoneRecordId;
      if (undoneRecordId === null) {
        throw new Error(`MALFORMED_UNDO_AUDIT:${auditRecord.auditId}`);
      }
      if (undoAuditByRecordId.has(undoneRecordId)) {
        throw new Error(`DUPLICATE_CORRECTION_UNDO:${undoneRecordId}`);
      }
      undoAuditByRecordId.set(undoneRecordId, auditRecord.auditId);
    }
  }
  return input.corrections.map((record) => {
    const decisionAuditId =
      decisionAuditByRecordId.get(record.recordId) ?? null;
    const terminalAuditId = undoAuditByRecordId.get(record.recordId) ?? null;
    const status: CorrectionLifecycleStatus = activeRecordIds.has(
      record.recordId,
    )
      ? "ACTIVE"
      : decisionAuditId === null
        ? "ORPHAN"
        : terminalAuditId !== null
          ? "UNDONE"
          : "SUPERSEDED";
    return {
      recordId: record.recordId,
      decisionId: record.decisionId,
      sessionId: record.sessionId,
      reviewItemId: record.reviewItemId,
      status,
      decisionAuditId,
      terminalAuditId,
    };
  });
}

function lifecycleCounts(
  records: readonly CorrectionLifecycleRecord[],
): Record<CorrectionLifecycleStatus, number> {
  return {
    ACTIVE: records.filter((record) => record.status === "ACTIVE").length,
    UNDONE: records.filter((record) => record.status === "UNDONE").length,
    SUPERSEDED: records.filter((record) => record.status === "SUPERSEDED")
      .length,
    ORPHAN: records.filter((record) => record.status === "ORPHAN").length,
  };
}

async function verifiedCorrectionState(input: {
  reviewDataPath: string;
  freezePath: string;
  sessionPath: string;
  correctionsPath: string;
  auditPath: string;
  requireComplete: boolean;
}): Promise<{
  data: C60112ReviewWorkspaceData;
  freeze: C60112ReviewPackageFreeze;
  session: ReviewSession;
  corrections: HumanCorrectionRecord[];
  activeCorrections: HumanCorrectionRecord[];
  audit: ReviewAuditRecord[];
  lifecycle: CorrectionLifecycleRecord[];
  reviewDataFileHash: string;
}> {
  const [{ data, freeze, reviewDataFileHash }, session, corrections, audit] =
    await Promise.all([
      frozenReviewData({
        reviewDataPath: input.reviewDataPath,
        freezePath: input.freezePath,
      }),
      reviewSession(input.sessionPath),
      correctionRecords(input.correctionsPath),
      auditRecords(input.auditPath),
    ]);
  const activeCorrections = validateSessionIntegrity({
    data,
    session,
    corrections,
    audit,
    requireComplete: input.requireComplete,
  });
  const lifecycle = classifyCorrectionLifecycle({
    session,
    corrections,
    audit,
  });
  const activeLifecycleIds = new Set(
    lifecycle
      .filter((record) => record.status === "ACTIVE")
      .map((record) => record.recordId),
  );
  if (
    activeLifecycleIds.size !== activeCorrections.length ||
    activeCorrections.some((record) => !activeLifecycleIds.has(record.recordId))
  ) {
    throw new Error("CORRECTION_LIFECYCLE_ACTIVE_STATE_MISMATCH");
  }
  return {
    data,
    freeze,
    session,
    corrections,
    activeCorrections,
    audit,
    lifecycle,
    reviewDataFileHash,
  };
}

function candidateProviders(
  candidate: C60112WorkspaceCandidate,
): readonly ("CURRENT_FINAL" | "WHISPER" | "REAZON" | "INDEPENDENT")[] {
  return [
    ...new Set(
      candidate.labels.map((label) => {
        if (label === "CURRENT") return "CURRENT_FINAL" as const;
        if (label === "REAZON") return "REAZON" as const;
        return "WHISPER" as const;
      }),
    ),
  ];
}

function candidateChoices(
  data: C60112ReviewWorkspaceData,
): C60112CandidateChoice[] {
  return data.candidateBundles.flatMap((bundle) =>
    bundle.candidates.map((candidate) => {
      const providers = candidateProviders(candidate);
      const provider = providers[0] ?? "INDEPENDENT";
      return {
        candidateId: candidate.candidateId,
        provider,
        providers,
        text: candidate.text,
        start: null,
        end: null,
      };
    }),
  );
}

function decisionCounts(
  records: readonly HumanCorrectionRecord[],
): Record<ReviewDecisionType, number> {
  return Object.fromEntries(
    C60112_DECISION_TYPES.map((decisionType) => [
      decisionType,
      records.filter((record) => record.decisionType === decisionType).length,
    ]),
  ) as Record<ReviewDecisionType, number>;
}

function commandArguments(list: readonly string[]): {
  command: string;
  values: Record<string, string | undefined>;
} {
  const command = list[0];
  if (command === undefined) {
    throw new Error(
      "Expected one of: validate, apply, export-corrections, stats.",
    );
  }
  const { values } = parseArgs({
    args: list.slice(1),
    options: {
      workspace: { type: "string" },
      freeze: { type: "string" },
      "base-package": { type: "string" },
      session: { type: "string" },
      corrections: { type: "string" },
      audit: { type: "string" },
      "review-data": { type: "string" },
      output: { type: "string" },
      "audio-manifest": { type: "string" },
    },
  });
  return { command, values: values };
}

const parsed = commandArguments(process.argv.slice(2));

if (parsed.command === "validate") {
  const workspace = option(parsed.values, "workspace");
  const freezePath = option(parsed.values, "freeze");
  const { data, freeze } = await frozenReviewData({
    reviewDataPath: path.join(workspace, "review-data.json"),
    freezePath,
  });
  const requiredFiles = [
    "index.html",
    "assets/review.js",
    "assets/review.css",
    "review-data.json",
  ];
  for (const relative of requiredFiles) {
    const info = await stat(path.join(workspace, relative));
    if (!info.isFile() || info.size === 0) {
      throw new Error(`Invalid workspace file: ${relative}`);
    }
  }
  const audioManifestPath = option(parsed.values, "audio-manifest");
  const manifest = machineReviewAudioManifestSchema.parse(
    await json(audioManifestPath),
  );
  const regionById = new Map(
    data.regions.map((region) => [region.regionId, region]),
  );
  for (const clip of manifest.clips) {
    const safeRelativePath = assertC60112SafeRelativePath(
      clip.relativePath,
      `${clip.regionId} audio path`,
    );
    const region = regionById.get(clip.regionId);
    if (region === undefined) {
      throw new Error(
        `Audio manifest references unknown region ${clip.regionId}.`,
      );
    }
    if (
      region.audioPath !== safeRelativePath ||
      (region.audioSha256 !== null && region.audioSha256 !== clip.sha256)
    ) {
      throw new Error(
        `Audio manifest is not bound to region ${clip.regionId}.`,
      );
    }
    const audioPath = path.join(workspace, safeRelativePath);
    if ((await fileHash(audioPath)) !== clip.sha256) {
      throw new Error(`Audio hash mismatch: ${clip.relativePath}`);
    }
    inspectReviewWav(await readFile(audioPath));
  }
  if (manifest.clips.length !== data.regions.length) {
    throw new Error("Audio manifest does not cover every review region.");
  }
  const sessionPath =
    optionalPath(parsed.values, "session") ??
    path.join(workspace, "session", "review-session.json");
  const correctionsPath =
    optionalPath(parsed.values, "corrections") ??
    path.join(workspace, "session", "human-correction-log.jsonl");
  const auditPath =
    optionalPath(parsed.values, "audit") ??
    path.join(workspace, "session", "review-audit.jsonl");
  let sessionStatus = "not-started";
  if (await exists(sessionPath)) {
    if (!(await exists(correctionsPath)) || !(await exists(auditPath))) {
      throw new Error(
        "Started review session is missing its append-only logs.",
      );
    }
    const session = await reviewSession(sessionPath);
    const corrections = await correctionRecords(correctionsPath);
    const audit = await auditRecords(auditPath);
    validateSessionIntegrity({
      data,
      session,
      corrections,
      audit,
      requireComplete: false,
    });
    sessionStatus = session.reviewComplete ? "complete" : "active";
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, workspace, freezeSemanticHash: freeze.semanticHash, workspaceDataHash: freeze.workspaceDataHash, machineDraftHash: data.machineDraftHash, fileCount: requiredFiles.length, audioPlayableCount: manifest.clips.length, sessionStatus }, null, 2)}\n`,
  );
} else if (parsed.command === "apply") {
  const basePackagePath = option(parsed.values, "base-package");
  const freezePath = option(parsed.values, "freeze");
  const sessionPath = option(parsed.values, "session");
  const correctionsPath = option(parsed.values, "corrections");
  const reviewDataPath = option(parsed.values, "review-data");
  const output = option(parsed.values, "output");
  const auditPath =
    optionalPath(parsed.values, "audit") ??
    path.join(path.dirname(correctionsPath), "review-audit.jsonl");
  if (!(await exists(auditPath))) throw new Error("REVIEW_AUDIT_LOG_REQUIRED");
  const basePackage = subtitlePackageSchema.parse(await json(basePackagePath));
  const state = await verifiedCorrectionState({
    reviewDataPath,
    freezePath,
    sessionPath,
    correctionsPath,
    auditPath,
    requireComplete: true,
  });
  const { data, session, activeCorrections } = state;
  const baseFileHash = await fileHash(basePackagePath);
  if (
    session.machineDraftHash !== baseFileHash ||
    data.machineDraftHash !== baseFileHash
  ) {
    throw new Error("STALE_BASE_MACHINE_DRAFT_HASH");
  }
  const decisions: C60112ReviewDecision[] = activeCorrections
    .flatMap((record) =>
      materializeC60112ActiveCorrectionSnapshot({ record, basePackage }),
    )
    .map((decision, index) => ({ ...decision, sequence: index + 1 }));
  const result = applyC60112ReviewDecisions({
    basePackage,
    expectedBaseCueHash: c60112CueHash(basePackage.cues),
    decisions,
    candidates: candidateChoices(data),
  });
  if (result.summary.rejectedDecisionCount > 0) {
    throw new Error("REVIEW_DECISION_APPLY_REJECTED");
  }
  await mkdir(output, { recursive: true });
  const packagePath = path.join(output, "human-reviewed-subtitle-package.json");
  const assPath = path.join(output, "human-reviewed.ass");
  const srtPath = path.join(output, "human-reviewed.srt");
  const vttPath = path.join(output, "human-reviewed.vtt");
  await atomicWriteJson(packagePath, result.package);
  await atomicWriteFile(assPath, result.ass);
  await atomicWriteFile(srtPath, result.srt);
  await atomicWriteFile(vttPath, result.vtt);
  const baseCueById = new Map(basePackage.cues.map((cue) => [cue.id, cue]));
  const textChangedCueCount = result.package.cues.filter((cue) => {
    const base = baseCueById.get(cue.id);
    return base !== undefined && base.text !== cue.text;
  }).length;
  const timingChangedCueCount = result.package.cues.filter((cue) => {
    const base = baseCueById.get(cue.id);
    return (
      base !== undefined && (base.start !== cue.start || base.end !== cue.end)
    );
  }).length;
  const newCueCount = result.package.cues.filter(
    (cue) => !baseCueById.has(cue.id),
  ).length;
  const manifestCore = {
    schemaVersion: "1.0.0" as const,
    policyVersion: session.reviewPolicyVersion,
    artifactType: "human-review-manifest" as const,
    generatedAt: new Date().toISOString(),
    sessionId: session.sessionId,
    machineDraftHash: baseFileHash,
    reviewSessionHash: await fileHash(sessionPath),
    correctionLogHash: await fileHash(correctionsPath),
    reviewedSubtitlePackageHash: await fileHash(packagePath),
    reviewedAssHash: await fileHash(assPath),
    reviewedSrtHash: await fileHash(srtPath),
    reviewedVttHash: await fileHash(vttPath),
    textChangedCueCount,
    timingChangedCueCount,
    newCueCount,
    decisionCounts: decisionCounts(activeCorrections),
    unresolvedCount: session.unresolvedRequiredCount,
    strictSubtitlePackageValidated: true as const,
    machineOnlyReleaseAuthorized: false as const,
  };
  const manifest = humanReviewManifestSchema.parse({
    ...manifestCore,
    semanticHash: machineQualitySemanticHash({
      ...manifestCore,
      generatedAt: undefined,
    }),
  });
  await atomicWriteJson(
    path.join(output, "human-review-manifest.json"),
    manifest,
  );
  process.stdout.write(
    `${JSON.stringify({ ok: true, output, summary: result.summary }, null, 2)}\n`,
  );
} else if (parsed.command === "export-corrections") {
  const freezePath = option(parsed.values, "freeze");
  const reviewDataPath = option(parsed.values, "review-data");
  const sessionPath = option(parsed.values, "session");
  const correctionsPath = option(parsed.values, "corrections");
  const auditPath = option(parsed.values, "audit");
  const requestedOutput = option(parsed.values, "output");
  const state = await verifiedCorrectionState({
    reviewDataPath,
    freezePath,
    sessionPath,
    correctionsPath,
    auditPath,
    requireComplete: false,
  });
  const records = state.activeCorrections;
  const outputIsJsonl =
    path.extname(requestedOutput).toLowerCase() === ".jsonl";
  const datasetPath = outputIsJsonl
    ? requestedOutput
    : path.join(requestedOutput, "human-corrections.jsonl");
  const summaryPath = path.join(
    outputIsJsonl ? path.dirname(requestedOutput) : requestedOutput,
    "correction-dataset-summary.json",
  );
  const lifecyclePath = path.join(
    outputIsJsonl ? path.dirname(requestedOutput) : requestedOutput,
    "correction-dataset-lifecycle.json",
  );
  await mkdir(path.dirname(datasetPath), { recursive: true });
  await atomicWriteFile(
    datasetPath,
    records.length === 0
      ? ""
      : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  const generatedAt = new Date().toISOString();
  const [sourceCorrectionLogHash, sourceReviewSessionHash, sourceAuditLogHash] =
    await Promise.all([
      fileHash(correctionsPath),
      fileHash(sessionPath),
      fileHash(auditPath),
    ]);
  const datasetJsonlHash = await fileHash(datasetPath);
  const counts = lifecycleCounts(state.lifecycle);
  const lifecycleCore = {
    schemaVersion: "1.0.0" as const,
    artifactType: "correction-dataset-lifecycle" as const,
    generatedAt,
    reviewPackageFreezeHash: state.freeze.semanticHash,
    frozenWorkspaceDataHash: state.freeze.workspaceDataHash,
    sourceCorrectionLogHash,
    sourceReviewSessionHash,
    sourceAuditLogHash,
    sourceReviewDataHash: state.reviewDataFileHash,
    datasetJsonlHash,
    sourceRecordCount: state.corrections.length,
    activeRecordCount: counts.ACTIVE,
    undoneRecordCount: counts.UNDONE,
    supersededRecordCount: counts.SUPERSEDED,
    orphanRecordCount: counts.ORPHAN,
    exportedStatuses: ["ACTIVE"] as const,
    records: state.lifecycle,
  };
  const lifecycleAudit = {
    ...lifecycleCore,
    semanticHash: machineQualitySemanticHash({
      ...lifecycleCore,
      generatedAt: undefined,
    }),
  };
  await atomicWriteJson(lifecyclePath, lifecycleAudit);
  const lifecycleAuditHash = await fileHash(lifecyclePath);
  const summaryCore = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2" as const,
    artifactType: "correction-dataset-summary" as const,
    generatedAt,
    locality: "LOCAL_ONLY" as const,
    shareable: false as const,
    sourceCorrectionLogHash,
    sourceReviewSessionHash,
    sourceAuditLogHash,
    sourceReviewDataHash: state.reviewDataFileHash,
    reviewPackageFreezeHash: state.freeze.semanticHash,
    lifecycleAuditHash,
    datasetJsonlHash,
    sourceRecordCount: state.corrections.length,
    activeRecordCount: counts.ACTIVE,
    undoneRecordCount: counts.UNDONE,
    supersededRecordCount: counts.SUPERSEDED,
    orphanRecordCount: counts.ORPHAN,
    recordCount: records.length,
    uniqueSessionCount: new Set(records.map((record) => record.sessionId)).size,
    uniqueReviewItemCount: new Set(records.map((record) => record.reviewItemId))
      .size,
    decisionCounts: decisionCounts(records),
    containsFullDialogueText: true as const,
    trainingPerformed: false as const,
  };
  const summary = correctionDatasetSummarySchema.parse({
    ...summaryCore,
    semanticHash: machineQualitySemanticHash({
      ...summaryCore,
      generatedAt: undefined,
    }),
  });
  await atomicWriteJson(summaryPath, summary);
  process.stdout.write(
    `${JSON.stringify({ ok: true, output: datasetPath, summaryPath, lifecyclePath, recordCount: records.length, lifecycleCounts: counts, sha256: summary.datasetJsonlHash }, null, 2)}\n`,
  );
} else if (parsed.command === "stats") {
  const freezePath = option(parsed.values, "freeze");
  const reviewDataPath = option(parsed.values, "review-data");
  const sessionPath = option(parsed.values, "session");
  const correctionsPath = option(parsed.values, "corrections");
  const auditPath = option(parsed.values, "audit");
  const state = await verifiedCorrectionState({
    reviewDataPath,
    freezePath,
    sessionPath,
    correctionsPath,
    auditPath,
    requireComplete: false,
  });
  const records = state.activeCorrections;
  const counts = lifecycleCounts(state.lifecycle);
  process.stdout.write(
    `${JSON.stringify({ recordCount: records.length, sourceRecordCount: state.corrections.length, activeRecordCount: counts.ACTIVE, undoneRecordCount: counts.UNDONE, supersededRecordCount: counts.SUPERSEDED, orphanRecordCount: counts.ORPHAN, uniqueSessionCount: new Set(records.map((record) => record.sessionId)).size, uniqueReviewItemCount: new Set(records.map((record) => record.reviewItemId)).size, decisionCounts: decisionCounts(records), sourceCorrectionLogHash: await fileHash(correctionsPath), sourceReviewSessionHash: await fileHash(sessionPath), sourceAuditLogHash: await fileHash(auditPath), sourceReviewDataHash: state.reviewDataFileHash, reviewPackageFreezeHash: state.freeze.semanticHash }, null, 2)}\n`,
  );
} else {
  throw new Error(`Unknown review command: ${parsed.command}`);
}
