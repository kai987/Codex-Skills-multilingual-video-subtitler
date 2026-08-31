import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  humanCorrectionRecordSchema,
  reviewAuditRecordSchema,
  reviewSessionSchema,
  c60113CorrectionInstrumentationSchema,
  type C60113CorrectionInstrumentation,
  type C60113WorkspaceExtension,
  type C60114WorkspaceExtension,
  type C601141WorkspaceExtension,
  type Workspace142,
  type Workspace143,
} from "@mvl/shared";
import { assertC60113WorkspaceExtension } from "./c60113-review-workspace.js";
import { c60113WorkspaceJavascript } from "./c60113-review-workspace-ui.js";
import { assertC60114WorkspaceExtension } from "./c60114-review-workspace.js";
import { c60114WorkspaceJavascript } from "./c60114-review-workspace-ui.js";
import { assertInventoryWorkspace141 } from "./c601141-review-delivery.js";
import { c601141WorkspaceJavascript } from "./c601141-review-workspace-ui.js";
import { assertWorkspace142 } from "./c601142-review-delivery.js";
import { c601142WorkspaceJavascript } from "./c601142-review-workspace-ui.js";
import { assertWorkspace143 } from "./c601143-review-delivery.js";
import { c601143WorkspaceJavascript } from "./c601143-review-workspace-ui.js";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";

export const C60112_REVIEW_WORKSPACE_VERSION =
  "c6.0.1.12-review-workspace-v1" as const;

export const C60112_REVIEW_DECISION_TYPES = [
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

export type C60112ReviewDecisionType =
  (typeof C60112_REVIEW_DECISION_TYPES)[number];
export type C60112ReviewPriorityTier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type C60112ReviewRequiredLevel =
  "REQUIRED" | "RECOMMENDED" | "INFORMATIONAL";

export interface C60112WorkspaceCueContext {
  cueId: string;
  text: string;
  start: number;
  end: number;
}

export interface C60112WorkspaceReviewItem {
  reviewItemId: string;
  eventIds: string[];
  finalCueIds: string[];
  itemTypes: string[];
  sourceInterval: { start: number; end: number };
  coreInterval: { start: number; end: number };
  currentText: string;
  currentStart: number | null;
  currentEnd: number | null;
  candidateIds: string[];
  evidenceIds: string[];
  reviewReasons: string[];
  priorityTier: C60112ReviewPriorityTier;
  priorityScore: number;
  requiredLevel: C60112ReviewRequiredLevel;
  suggestedActions: C60112ReviewDecisionType[];
  regionId: string;
  previousCue: C60112WorkspaceCueContext | null;
  nextCue: C60112WorkspaceCueContext | null;
  semanticHash: string;
}

export interface C60112WorkspaceRegion {
  regionId: string;
  reviewItemIds: string[];
  contextStart: number;
  contextEnd: number;
  coreIntervals: { start: number; end: number }[];
  audioPath: string;
  audioSha256: string | null;
  /** Actual WAV extraction bounds; may include more context than the risk region. */
  audioSourceInterval?: { start: number; end: number };
}

export interface C60112WorkspaceCandidate {
  candidateId: string;
  labels: ("CURRENT" | "WHISPER" | "WHISPER_ALT" | "REAZON")[];
  text: string;
  evidenceBadges: string[];
  provenance: string[];
}

export interface C60112WorkspaceCandidateBundle {
  reviewItemId: string;
  candidates: C60112WorkspaceCandidate[];
}

export interface C60112ReviewWorkspaceData {
  schemaVersion: string;
  workspaceVersion: string;
  policyVersion: string;
  policyHash: string;
  reviewPackageSemanticHash: string;
  machineDraftHash: string;
  sourceMediaIdentity: Record<string, unknown>;
  machineDraftIdentity: Record<string, unknown>;
  items: C60112WorkspaceReviewItem[];
  regions: C60112WorkspaceRegion[];
  candidateBundles: C60112WorkspaceCandidateBundle[];
  regionReviewV2?: C60113WorkspaceExtension;
  sourceTargetReviewV3?: C60114WorkspaceExtension;
  speechInventoryReviewV1?: C601141WorkspaceExtension;
  detectorCeilingReviewV2?: Workspace142;
  monotonicSafetyReviewV3?: Workspace143;
}

export interface C60112ReviewDecisionRequest {
  decisionId: string;
  reviewItemId: string;
  decisionType: C60112ReviewDecisionType;
  selectedCandidateId: string | null;
  afterText: string | null;
  afterStart: number | null;
  afterEnd: number | null;
  reviewerNote: string | null;
  expectedReviewPackageSemanticHash: string;
  expectedMachineDraftHash: string;
  reviewInstrumentation?: C60113CorrectionInstrumentation | undefined;
}

interface C60112UndoRequest {
  undoId: string;
  expectedReviewPackageSemanticHash: string;
  expectedMachineDraftHash: string;
}

export interface C60112ReviewItemState {
  recordId: string;
  decisionId: string;
  decisionType: C60112ReviewDecisionType;
  selectedCandidateId: string | null;
  afterText: string | null;
  afterStart: number | null;
  afterEnd: number | null;
  reviewerNote: string | null;
  updatedAt: string;
}

export interface C60112ReviewSession {
  schemaVersion: "1.0.0";
  sessionId: string;
  sourceMediaIdentity: Record<string, unknown>;
  machineDraftIdentity: Record<string, unknown>;
  machineDraftHash: string;
  reviewPolicyVersion: string;
  reviewPackageSemanticHash: string;
  createdAt: string;
  updatedAt: string;
  itemStates: Record<string, C60112ReviewItemState>;
  regionStates: Record<
    string,
    {
      requiredItemCount: number;
      completedRequiredCount: number;
      unresolvedRequiredCount: number;
      complete: boolean;
    }
  >;
  completedRequiredCount: number;
  unresolvedRequiredCount: number;
  reviewComplete: boolean;
}

interface C60112CorrectionRecord {
  schemaVersion: "1.0.0";
  recordId: string;
  decisionId: string;
  sessionId: string;
  reviewItemId: string;
  regionId: string;
  eventIds: string[];
  cueIds: string[];
  sourceInterval: { start: number; end: number };
  machineDraftHash: string;
  evidenceSnapshotHash: string;
  candidateSetHash: string;
  decisionType: C60112ReviewDecisionType;
  selectedCandidateId: string | null;
  beforeText: string | null;
  afterText: string | null;
  beforeStart: number | null;
  beforeEnd: number | null;
  afterStart: number | null;
  afterEnd: number | null;
  itemTypes: string[];
  priorityAtDecision: {
    tier: C60112ReviewPriorityTier;
    score: number;
    requiredLevel: C60112ReviewRequiredLevel;
  };
  reviewerNote: string | null;
  createdAt: string;
  reviewInstrumentation?: C60113CorrectionInstrumentation | undefined;
}

interface C60112AuditRecord {
  schemaVersion: "1.0.0";
  auditId: string;
  operation: "DECISION" | "UNDO";
  timestamp: string;
  sessionId: string;
  reviewItemId: string;
  previousDecision: string | null;
  newDecision: string | null;
  undoneRecordId: string | null;
  beforeHash: string;
  afterHash: string;
}

interface WorkspacePaths {
  root: string;
  data: string;
  sessionDirectory: string;
  session: string;
  correctionLog: string;
  auditLog: string;
  pendingTransaction: string;
  mutationLock: string;
}

interface C60112PendingWorkspaceTransaction {
  schemaVersion: "1.0.0";
  transactionId: string;
  operation: "DECISION" | "UNDO";
  correction: C60112CorrectionRecord | null;
  audit: C60112AuditRecord;
  session: C60112ReviewSession;
}

class WorkspaceHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WorkspaceHttpError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function sha256Value(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function escapeC60112ReviewHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character] ?? character;
  });
}

function decodePathRepeatedly(value: string): string {
  let current = value;
  for (let index = 0; index < 3; index += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      throw new WorkspaceHttpError(
        400,
        "MALFORMED_PATH",
        "Malformed URL path.",
      );
    }
    if (decoded === current) return decoded;
    current = decoded;
  }
  return current;
}

export function assertC60112SafeRelativePath(
  value: string,
  label = "relative path",
): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    /^[a-z][a-z\d+.-]*:/iu.test(value)
  ) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  const decoded = decodePathRepeatedly(value);
  const segments = decoded.split("/");
  if (
    segments.some(
      (segment) => segment === ".." || segment === "." || segment.length === 0,
    )
  ) {
    throw new Error(`${label} must not traverse directories.`);
  }
  return segments.join("/");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function atomicWriteText(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (content.length > 0 && !content.endsWith("\n")) {
    throw new WorkspaceHttpError(
      500,
      "PERSISTENCE_LOG_TRUNCATED",
      `${path.basename(filePath)} ends with a partial JSON line.`,
    );
  }
  await atomicWriteText(filePath, `${content}${JSON.stringify(value)}\n`);
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return content
    .split(/\r?\n/gu)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function validateInterval(
  interval: { start: number; end: number },
  label: string,
): void {
  if (
    !Number.isFinite(interval.start) ||
    !Number.isFinite(interval.end) ||
    interval.start < 0 ||
    interval.end <= interval.start
  ) {
    throw new Error(`${label} must have finite non-negative start < end.`);
  }
}

function workspaceSourceDurationMs(data: C60112ReviewWorkspaceData): number {
  const explicitDurationMs = data.sourceMediaIdentity.sourceDurationMs;
  const durationSeconds = data.sourceMediaIdentity.durationSeconds;
  const durationMs =
    typeof explicitDurationMs === "number" &&
    Number.isFinite(explicitDurationMs)
      ? explicitDurationMs
      : typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
        ? durationSeconds * 1_000
        : Number.NaN;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error(
      "Review workspace source media identity requires a positive sourceDurationMs or durationSeconds.",
    );
  }
  return durationMs;
}

export function assertC60112ReviewWorkspaceData(
  data: C60112ReviewWorkspaceData,
): void {
  assertC60113WorkspaceExtension(data);
  assertC60114WorkspaceExtension(data);
  assertInventoryWorkspace141(data);
  assertWorkspace142(data);
  assertWorkspace143(data);
  if (data.workspaceVersion !== C60112_REVIEW_WORKSPACE_VERSION) {
    throw new Error("Unsupported review workspace version.");
  }
  if (
    data.policyVersion.length === 0 ||
    data.policyHash.length === 0 ||
    data.reviewPackageSemanticHash.length === 0 ||
    data.machineDraftHash.length === 0
  ) {
    throw new Error("Review workspace identity is incomplete.");
  }
  const itemIds = new Set<string>();
  for (const item of data.items) {
    if (itemIds.has(item.reviewItemId)) {
      throw new Error(`Duplicate review item ${item.reviewItemId}.`);
    }
    itemIds.add(item.reviewItemId);
    if (new Set(item.finalCueIds).size !== item.finalCueIds.length) {
      throw new Error(`${item.reviewItemId} contains duplicate final cue IDs.`);
    }
    if (
      new Set(item.suggestedActions).size !== item.suggestedActions.length ||
      item.suggestedActions.some(
        (action) => !C60112_REVIEW_DECISION_TYPES.includes(action),
      )
    ) {
      throw new Error(`${item.reviewItemId} contains invalid review actions.`);
    }
    const allowedByCueCount =
      item.finalCueIds.length === 0
        ? new Set<C60112ReviewDecisionType>([
            "ADD_NEW_CUE",
            "MARK_FALSE_POSITIVE",
            "UNRESOLVED",
            "WAIVE_REVIEW",
          ])
        : item.finalCueIds.length === 1
          ? new Set<C60112ReviewDecisionType>([
              "KEEP_CURRENT",
              "USE_REAZON",
              "USE_WHISPER_ALTERNATE",
              "MANUAL_EDIT",
              "TIMING_EDIT",
              "UNRESOLVED",
              "WAIVE_REVIEW",
            ])
          : new Set<C60112ReviewDecisionType>([
              "KEEP_CURRENT",
              "UNRESOLVED",
              "WAIVE_REVIEW",
            ]);
    if (
      item.suggestedActions.some((action) => !allowedByCueCount.has(action))
    ) {
      throw new Error(
        `${item.reviewItemId} exposes an action that is unsafe for its cue count.`,
      );
    }
    validateInterval(
      item.sourceInterval,
      `${item.reviewItemId} sourceInterval`,
    );
    validateInterval(item.coreInterval, `${item.reviewItemId} coreInterval`);
    if (
      item.coreInterval.start < item.sourceInterval.start ||
      item.coreInterval.end > item.sourceInterval.end
    ) {
      throw new Error(
        `${item.reviewItemId} core interval is outside its source interval.`,
      );
    }
  }
  const regionIds = new Set<string>();
  for (const region of data.regions) {
    if (regionIds.has(region.regionId)) {
      throw new Error(`Duplicate review region ${region.regionId}.`);
    }
    regionIds.add(region.regionId);
    validateInterval(
      { start: region.contextStart, end: region.contextEnd },
      `${region.regionId} context interval`,
    );
    if (region.audioSourceInterval) {
      validateInterval(
        region.audioSourceInterval,
        `${region.regionId} audio source interval`,
      );
      if (
        region.audioSourceInterval.start > region.contextStart ||
        region.audioSourceInterval.end < region.contextEnd
      )
        throw new Error("REVIEW_AUDIO_DOES_NOT_COVER_REGION");
    }
    assertC60112SafeRelativePath(
      region.audioPath,
      `${region.regionId} audioPath`,
    );
    if (!region.audioPath.startsWith("audio/")) {
      throw new Error(`${region.regionId} audioPath must be inside audio/.`);
    }
    for (const reviewItemId of region.reviewItemIds) {
      if (!itemIds.has(reviewItemId)) {
        throw new Error(
          `${region.regionId} references unknown item ${reviewItemId}.`,
        );
      }
    }
  }
  for (const item of data.items) {
    if (
      !regionIds.has(item.regionId) &&
      !(
        item.regionId === "" &&
        data.sourceTargetReviewV3?.unresolvedItemIds.includes(item.reviewItemId)
      )
    ) {
      throw new Error(
        `${item.reviewItemId} references unknown region ${item.regionId}.`,
      );
    }
  }
  const bundleIds = new Set<string>();
  const globalCandidateIds = new Set<string>();
  const allowedLabels = new Set([
    "CURRENT",
    "WHISPER",
    "WHISPER_ALT",
    "REAZON",
  ]);
  for (const bundle of data.candidateBundles) {
    if (!itemIds.has(bundle.reviewItemId)) {
      throw new Error(
        `Candidate bundle references unknown item ${bundle.reviewItemId}.`,
      );
    }
    if (bundleIds.has(bundle.reviewItemId)) {
      throw new Error(`Duplicate candidate bundle ${bundle.reviewItemId}.`);
    }
    bundleIds.add(bundle.reviewItemId);
    const candidates = new Set<string>();
    for (const candidate of bundle.candidates) {
      if (candidates.has(candidate.candidateId)) {
        throw new Error(`Duplicate candidate ${candidate.candidateId}.`);
      }
      candidates.add(candidate.candidateId);
      if (globalCandidateIds.has(candidate.candidateId)) {
        throw new Error(
          `Candidate ${candidate.candidateId} is not scoped uniquely to one review item.`,
        );
      }
      globalCandidateIds.add(candidate.candidateId);
      if (
        candidate.labels.length === 0 ||
        new Set(candidate.labels).size !== candidate.labels.length ||
        candidate.labels.some((label) => !allowedLabels.has(label))
      ) {
        throw new Error(
          `Candidate ${candidate.candidateId} has invalid labels.`,
        );
      }
    }
    const item = data.items.find(
      (candidate) => candidate.reviewItemId === bundle.reviewItemId,
    );
    if (item === undefined) continue;
    const labels = new Set(
      bundle.candidates.flatMap((candidate) => candidate.labels),
    );
    if (item.suggestedActions.includes("USE_REAZON") && !labels.has("REAZON")) {
      throw new Error(
        `${item.reviewItemId} has no REAZON candidate for its action.`,
      );
    }
    if (
      item.suggestedActions.includes("USE_WHISPER_ALTERNATE") &&
      !labels.has("WHISPER_ALT")
    ) {
      throw new Error(
        `${item.reviewItemId} has no WHISPER_ALT candidate for its action.`,
      );
    }
  }
  for (const itemId of itemIds) {
    if (!bundleIds.has(itemId)) {
      throw new Error(`Review item ${itemId} has no candidate bundle.`);
    }
  }
}

function reviewWorkspaceHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>C6.0.1.12 Evidence-ranked Subtitle Review</title>
  <link rel="stylesheet" href="assets/review.css">
</head>
<body>
  <header>
    <div><strong>C6.0.1.12 Review Assistance</strong><span id="identity"></span></div>
    <div id="progress" aria-live="polite"></div>
    <div id="status" role="status" aria-live="polite">Loading local review package…</div>
  </header>
  <main>
    <aside>
      <label>Priority <select id="priority-filter"><option value="ALL">All</option><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label>
      <label>Type <select id="type-filter"><option value="ALL">All</option><option value="TEXT">Text</option><option value="TIMING">Timing</option><option value="MISSING">Missing</option><option value="HALLUCINATION">Hallucination</option><option value="OVERLAP">Overlap</option><option value="LOCALIZATION">Localization</option><option value="UNRESOLVED">Unresolved</option></select></label>
      <div id="queue" aria-label="Review queue"></div>
    </aside>
    <section id="workspace" aria-live="polite"></section>
  </main>
  <script type="module" src="assets/review.js"></script>
</body>
</html>
`;
}

function reviewWorkspaceCss(): string {
  return `:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0b0d10;color:#edf2f7}*{box-sizing:border-box}body{margin:0;background:#0b0d10}header{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:1fr auto;gap:.4rem 1rem;padding:.75rem 1rem;background:#11161df2;border-bottom:1px solid #334155}header span{display:block;color:#94a3b8;font-size:.75rem;margin-top:.2rem}#status{grid-column:1/-1;color:#cbd5e1;font-size:.85rem}#status.error{color:#fca5a5}main{display:grid;grid-template-columns:310px minmax(0,1fr);min-height:calc(100vh - 86px)}aside{border-right:1px solid #334155;padding:.8rem;overflow:auto;max-height:calc(100vh - 86px);position:sticky;top:86px}aside label{display:block;margin-bottom:.7rem;color:#cbd5e1}select,input,textarea{width:100%;border:1px solid #475569;background:#0f172a;color:#edf2f7;border-radius:7px;padding:.5rem}textarea{min-height:92px;resize:vertical}.queue-item{width:100%;text-align:left;margin:.25rem 0;padding:.65rem;border:1px solid #334155;background:#11161d;color:inherit;border-radius:8px}.queue-item.active{border-color:#38bdf8;background:#17233a}.queue-item.resolved{border-left:4px solid #22c55e}.queue-item.unresolved{border-left:4px solid #f59e0b}.priority{font-size:.72rem;font-weight:700;letter-spacing:.06em}.CRITICAL{color:#fca5a5}.HIGH{color:#fdba74}.MEDIUM{color:#fde68a}.LOW{color:#86efac}#workspace{padding:1rem;max-width:1100px;width:100%;margin:0 auto}.card{border:1px solid #334155;border-radius:12px;background:#11161d;padding:1rem;margin-bottom:1rem}.grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.label{font-size:.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em}.subtitle{font-size:1.12rem;white-space:pre-wrap;overflow-wrap:anywhere}.badges{display:flex;gap:.35rem;flex-wrap:wrap;margin:.5rem 0}.badge{font-size:.72rem;padding:.2rem .4rem;background:#1e293b;border-radius:999px}.candidate{border:1px solid #334155;border-radius:8px;padding:.7rem;margin:.5rem 0}.candidate.selected{border-color:#38bdf8}.candidate button{margin-top:.5rem}.actions,.audio-actions,.navigation{display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.65rem}button{border:1px solid #475569;background:#1e293b;color:inherit;border-radius:7px;padding:.5rem .7rem;cursor:pointer}button:hover,button:focus-visible{background:#334155}button.primary{border-color:#38bdf8}audio{width:100%;margin:.6rem 0}.timing{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}.context{white-space:pre-wrap;color:#cbd5e1}.note{color:#94a3b8;font-size:.82rem}.empty{color:#94a3b8;padding:1rem}@media(max-width:800px){main{grid-template-columns:1fr}aside{position:static;max-height:none;border-right:0;border-bottom:1px solid #334155}.grid{grid-template-columns:1fr}header{position:static}#workspace{padding:.6rem}}`;
}

function reviewWorkspaceJavascript(): string {
  return String.raw`const state={data:null,session:null,filtered:[],index:0,selectedCandidate:new Map()};
const byId=id=>document.getElementById(id);
const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=String(value??'');if(className)node.className=className;return node};
const button=(label,onClick,className)=>{const node=text('button',label,className);node.type='button';node.addEventListener('click',onClick);return node};
const sessionState=id=>state.session?.itemStates?.[id]??null;
function showStatus(message,error=false){const node=byId('status');node.textContent=message;node.className=error?'error':''}
function bundleFor(id){return state.data.candidateBundles.find(bundle=>bundle.reviewItemId===id)??{reviewItemId:id,candidates:[]}}
function regionFor(id){return state.data.regions.find(region=>region.regionId===id)??null}
function typeMatches(item,filter){if(filter==='ALL')return true;if(filter==='UNRESOLVED')return sessionState(item.reviewItemId)?.decisionType==='UNRESOLVED'||sessionState(item.reviewItemId)===null;return item.itemTypes.some(type=>type.includes(filter))}
function refreshFiltered(){const priority=byId('priority-filter').value;const type=byId('type-filter').value;const activeId=state.filtered[state.index]?.reviewItemId;state.filtered=[...state.data.items].filter(item=>(priority==='ALL'||item.priorityTier===priority)&&typeMatches(item,type)).sort((left,right)=>right.priorityScore-left.priorityScore||left.sourceInterval.start-right.sourceInterval.start||left.reviewItemId.localeCompare(right.reviewItemId));state.index=Math.max(0,state.filtered.findIndex(item=>item.reviewItemId===activeId));if(state.index<0)state.index=0;render()}
function renderProgress(){const required=state.data.items.filter(item=>item.requiredLevel==='REQUIRED').length;const completed=state.session?.completedRequiredCount??0;const unresolved=state.session?.unresolvedRequiredCount??required;byId('progress').textContent='Required '+completed+' / '+required+' · unresolved '+unresolved}
function renderQueue(){const queue=byId('queue');queue.replaceChildren();state.filtered.forEach((item,index)=>{const itemState=sessionState(item.reviewItemId);const node=button('',()=>{state.index=index;render()},'queue-item'+(index===state.index?' active':'')+(itemState?(itemState.decisionType==='UNRESOLVED'?' unresolved':' resolved'):''));node.append(text('span',item.priorityTier,'priority '+item.priorityTier),text('div',item.currentText||'[missing speech]'),text('small',item.sourceInterval.start.toFixed(3)+' → '+item.sourceInterval.end.toFixed(3)));queue.append(node)});if(!state.filtered.length)queue.append(text('div','No items match the filters.','empty'))}
function addLabeled(container,label,node){const wrapper=document.createElement('label');wrapper.append(text('span',label,'label'),node);container.append(wrapper)}
function candidateView(item){const container=document.createElement('section');container.append(text('div','Alternative candidates','label'));const selected=state.selectedCandidate.get(item.reviewItemId)??sessionState(item.reviewItemId)?.selectedCandidateId??null;for(const candidate of bundleFor(item.reviewItemId).candidates){const card=document.createElement('div');card.className='candidate'+(candidate.candidateId===selected?' selected':'');card.append(text('strong',candidate.labels.join(' / ')),text('div',candidate.text,'subtitle'));const badges=document.createElement('div');badges.className='badges';candidate.evidenceBadges.forEach(value=>badges.append(text('span',value,'badge')));card.append(badges,button('Select candidate',()=>{state.selectedCandidate.set(item.reviewItemId,candidate.candidateId);render()}));container.append(card)}return container}
function audioView(item){const region=regionFor(item.regionId);const card=document.createElement('section');card.className='card';card.append(text('div','Review audio','label'));if(!region){card.append(text('p','Region audio metadata is unavailable.','empty'));return card}const audio=document.createElement('audio');audio.id='review-audio';audio.controls=true;audio.preload='metadata';if(/^audio\/[A-Za-z0-9._/-]+$/u.test(region.audioPath)&&!region.audioPath.includes('..'))audio.src=region.audioPath;else showStatus('Unsafe audio path rejected.',true);const core=item.coreInterval;const audioStart=region.audioSourceInterval?.start??region.contextStart;const jump=()=>{audio.currentTime=Math.max(0,core.start-audioStart);audio.play().catch(error=>showStatus('Audio playback failed: '+error.message,true))};const replay=()=>{audio.currentTime=0;audio.play().catch(error=>showStatus('Audio playback failed: '+error.message,true))};const controls=document.createElement('div');controls.className='audio-actions';controls.append(button('Replay region',replay),button('Jump to core',jump));for(const speed of [.75,1,1.25])controls.append(button(speed.toFixed(2).replace(/0$/u,'')+'×',()=>{audio.playbackRate=speed}));card.append(audio,controls,text('p','Core '+core.start.toFixed(3)+' → '+core.end.toFixed(3)+' · region '+region.contextStart.toFixed(3)+' → '+region.contextEnd.toFixed(3),'note'));return card}
function operationId(prefix){return prefix+'-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2))}
function currentDecisionPayload(item,decisionType,fields={}){return{decisionId:operationId('decision'),reviewItemId:item.reviewItemId,decisionType,selectedCandidateId:fields.selectedCandidateId??null,afterText:fields.afterText??null,afterStart:fields.afterStart??null,afterEnd:fields.afterEnd??null,reviewerNote:(fields.reviewerNote??byId('reviewer-note')?.value)||null,expectedReviewPackageSemanticHash:state.data.reviewPackageSemanticHash,expectedMachineDraftHash:state.data.machineDraftHash}}
async function postJson(url,body){const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-mvl-review-request':'c6-0-1-12'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error((result.code??'REQUEST_FAILED')+': '+(result.message??response.statusText));return result}
async function decide(item,decisionType,fields={}){try{const result=await postJson('/api/decision',currentDecisionPayload(item,decisionType,fields));state.session=result.session;showStatus('Autosaved '+decisionType+'.');render()}catch(error){showStatus(error.message,true)}}
function actionView(item,textArea,startInput,endInput,noteInput){const card=document.createElement('section');card.className='card';card.append(text('div','Human exception decision','label'));const actions=document.createElement('div');actions.className='actions';const available=type=>item.suggestedActions.includes(type);const add=(type,label,onClick,className)=>{if(available(type))actions.append(button(label,onClick,className))};const bundle=bundleFor(item.reviewItemId);const candidateFor=label=>{const selected=bundle.candidates.find(candidate=>candidate.candidateId===state.selectedCandidate.get(item.reviewItemId));return selected?.labels.includes(label)?selected:bundle.candidates.find(candidate=>candidate.labels.includes(label))};add('KEEP_CURRENT','1 Keep current',()=>decide(item,'KEEP_CURRENT'),'primary');add('USE_REAZON','2 Use Reazon',()=>{const candidate=candidateFor('REAZON');decide(item,'USE_REAZON',{selectedCandidateId:candidate?.candidateId??null})});add('USE_WHISPER_ALTERNATE','3 Use Whisper alternate',()=>{const candidate=candidateFor('WHISPER_ALT');decide(item,'USE_WHISPER_ALTERNATE',{selectedCandidateId:candidate?.candidateId??null})});add('MANUAL_EDIT','Manual text edit',()=>decide(item,'MANUAL_EDIT',{afterText:textArea.value}));add('TIMING_EDIT','Timing edit',()=>decide(item,'TIMING_EDIT',{afterStart:Number(startInput.value),afterEnd:Number(endInput.value)}));add('ADD_NEW_CUE','Add new cue',()=>decide(item,'ADD_NEW_CUE',{afterText:textArea.value,afterStart:Number(startInput.value),afterEnd:Number(endInput.value)}));add('MARK_FALSE_POSITIVE','Mark false positive',()=>decide(item,'MARK_FALSE_POSITIVE'));add('UNRESOLVED','U Unresolved',()=>decide(item,'UNRESOLVED',{reviewerNote:noteInput.value||null}));add('WAIVE_REVIEW','Waive review',()=>decide(item,'WAIVE_REVIEW',{reviewerNote:noteInput.value||null}));actions.append(button('Undo last decision',async()=>{try{const result=await postJson('/api/undo',{undoId:operationId('undo'),expectedReviewPackageSemanticHash:state.data.reviewPackageSemanticHash,expectedMachineDraftHash:state.data.machineDraftHash});state.session=result.session;showStatus('Last decision undone.');render()}catch(error){showStatus(error.message,true)}}));card.append(actions);return card}
function renderWorkspace(){const workspace=byId('workspace');workspace.replaceChildren();const item=state.filtered[state.index];if(!item){workspace.append(text('p','No review item selected.','empty'));return}const heading=document.createElement('section');heading.className='card';heading.append(text('div',item.priorityTier+' · '+item.requiredLevel,'priority '+item.priorityTier),text('h1',item.currentText||'Missing speech review'),text('p',item.reviewReasons.join(' · '),'context'));const badgeRow=document.createElement('div');badgeRow.className='badges';item.itemTypes.forEach(value=>badgeRow.append(text('span',value,'badge')));heading.append(badgeRow);const context=document.createElement('div');context.className='grid';const previous=document.createElement('div');previous.append(text('div','Previous cue','label'),text('div',item.previousCue?.text??'—','context'));const next=document.createElement('div');next.append(text('div','Next cue','label'),text('div',item.nextCue?.text??'—','context'));context.append(previous,next);heading.append(context);const edit=document.createElement('section');edit.className='card';const textArea=document.createElement('textarea');textArea.id='manual-text';textArea.value=item.currentText;addLabeled(edit,'Manual text / new cue text',textArea);const timing=document.createElement('div');timing.className='timing';const startInput=document.createElement('input');startInput.id='timing-start';startInput.type='number';startInput.step='.001';startInput.value=String(item.currentStart??item.coreInterval.start);const endInput=document.createElement('input');endInput.id='timing-end';endInput.type='number';endInput.step='.001';endInput.value=String(item.currentEnd??item.coreInterval.end);addLabeled(timing,'Start',startInput);addLabeled(timing,'End',endInput);const noteInput=document.createElement('input');noteInput.id='reviewer-note';noteInput.type='text';noteInput.placeholder='Required when waiving review';edit.append(timing);addLabeled(edit,'Reviewer note',noteInput);const navigation=document.createElement('div');navigation.className='navigation';navigation.append(button('K Previous',()=>move(-1)),button('J Next',()=>move(1)));workspace.append(heading,audioView(item),candidateView(item),edit,actionView(item,textArea,startInput,endInput,noteInput),navigation);const itemState=sessionState(item.reviewItemId);if(itemState)workspace.prepend(text('p','Saved decision: '+itemState.decisionType,'note'))}
function move(delta){if(!state.filtered.length)return;state.index=(state.index+delta+state.filtered.length)%state.filtered.length;render()}
function restoreSavedInputs(){const item=state.filtered[state.index];if(!item)return;const saved=sessionState(item.reviewItemId);const textArea=byId('manual-text');const startInput=byId('timing-start');const endInput=byId('timing-end');const noteInput=byId('reviewer-note');if(!saved){const selectedId=state.selectedCandidate.get(item.reviewItemId);const selected=bundleFor(item.reviewItemId).candidates.find(candidate=>candidate.candidateId===selectedId);if(textArea&&item.finalCueIds.length===0&&selected)textArea.value=selected.text;return}if(textArea)textArea.value=saved.afterText??'';if(startInput)startInput.value=saved.afterStart===null?'':String(saved.afterStart);if(endInput)endInput.value=saved.afterEnd===null?'':String(saved.afterEnd);if(noteInput)noteInput.value=saved.reviewerNote??''}
function render(){renderProgress();renderQueue();renderWorkspace();restoreSavedInputs()}
byId('priority-filter').addEventListener('change',refreshFiltered);byId('type-filter').addEventListener('change',refreshFiltered);
document.addEventListener('keydown',event=>{const editing=event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLSelectElement||event.target instanceof HTMLButtonElement;if(editing)return;const item=state.filtered[state.index];if(!item)return;const available=type=>item.suggestedActions.includes(type);if(event.key===' '){event.preventDefault();const audio=byId('review-audio');if(audio){if(audio.paused)audio.play().catch(error=>showStatus(error.message,true));else audio.pause()}}if(event.key.toLowerCase()==='j')move(1);if(event.key.toLowerCase()==='k')move(-1);if(event.key==='1'&&available('KEEP_CURRENT'))decide(item,'KEEP_CURRENT');if(event.key==='2'&&available('USE_REAZON')){const candidate=bundleFor(item.reviewItemId).candidates.find(value=>value.labels.includes('REAZON'));decide(item,'USE_REAZON',{selectedCandidateId:candidate?.candidateId??null})}if(event.key==='3'&&available('USE_WHISPER_ALTERNATE')){const candidate=bundleFor(item.reviewItemId).candidates.find(value=>value.labels.includes('WHISPER_ALT'));decide(item,'USE_WHISPER_ALTERNATE',{selectedCandidateId:candidate?.candidateId??null})}if(event.key.toLowerCase()==='e')byId('manual-text')?.focus();if(event.key.toLowerCase()==='t')byId('timing-start')?.focus();if(event.key.toLowerCase()==='u'&&available('UNRESOLVED'))decide(item,'UNRESOLVED')});
Promise.all([fetch('review-data.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('review-data.json unavailable');return response.json()}),fetch('/api/session',{cache:'no-store'}).then(response=>response.json())]).then(([data,sessionResult])=>{state.data=data;state.session=sessionResult.session??null;byId('identity').textContent=data.policyVersion+' · '+data.reviewPackageSemanticHash.slice(0,12);refreshFiltered();showStatus(state.session?'Review session resumed.':'No review session exists; the first explicit decision will create it.')}).catch(error=>showStatus(error.message,true));`;
}

function workspacePaths(workspaceDirectory: string): WorkspacePaths {
  const root = path.resolve(workspaceDirectory);
  const sessionDirectory = path.join(root, "session");
  return {
    root,
    data: path.join(root, "review-data.json"),
    sessionDirectory,
    session: path.join(sessionDirectory, "review-session.json"),
    correctionLog: path.join(sessionDirectory, "human-correction-log.jsonl"),
    auditLog: path.join(sessionDirectory, "review-audit.jsonl"),
    pendingTransaction: path.join(
      sessionDirectory,
      "pending-workspace-transaction.json",
    ),
    mutationLock: path.join(sessionDirectory, "workspace-mutation.sqlite"),
  };
}

export async function writeC60112ReviewWorkspace(input: {
  workspaceDirectory: string;
  reviewData: C60112ReviewWorkspaceData;
}): Promise<{
  indexPath: string;
  dataPath: string;
  javascriptPath: string;
  cssPath: string;
  sessionDirectory: string;
}> {
  assertC60112ReviewWorkspaceData(input.reviewData);
  const paths = workspacePaths(input.workspaceDirectory);
  const indexPath = path.join(paths.root, "index.html");
  const javascriptPath = path.join(paths.root, "assets", "review.js");
  const cssPath = path.join(paths.root, "assets", "review.css");
  await mkdir(path.join(paths.root, "audio"), { recursive: true });
  await mkdir(paths.sessionDirectory, { recursive: true });
  await Promise.all([
    atomicWriteText(indexPath, reviewWorkspaceHtml()),
    atomicWriteText(
      javascriptPath,
      reviewWorkspaceJavascript() +
        (input.reviewData.sourceTargetReviewV3
          ? c60114WorkspaceJavascript()
          : input.reviewData.regionReviewV2
            ? c60113WorkspaceJavascript()
            : "") +
        (input.reviewData.speechInventoryReviewV1
          ? c601141WorkspaceJavascript()
          : "") +
        (input.reviewData.detectorCeilingReviewV2
          ? c601142WorkspaceJavascript()
          : "") +
        (input.reviewData.monotonicSafetyReviewV3
          ? c601143WorkspaceJavascript()
          : ""),
    ),
    atomicWriteText(cssPath, reviewWorkspaceCss()),
    atomicWriteText(
      paths.data,
      `${JSON.stringify(input.reviewData, null, 2)}\n`,
    ),
  ]);
  return {
    indexPath,
    dataPath: paths.data,
    javascriptPath,
    cssPath,
    sessionDirectory: paths.sessionDirectory,
  };
}

async function loadWorkspaceData(
  paths: WorkspacePaths,
): Promise<C60112ReviewWorkspaceData> {
  const data = JSON.parse(
    await readFile(paths.data, "utf8"),
  ) as C60112ReviewWorkspaceData;
  assertC60112ReviewWorkspaceData(data);
  return data;
}

async function loadSessionSnapshot(
  paths: WorkspacePaths,
): Promise<C60112ReviewSession | null> {
  try {
    return reviewSessionSchema.parse(
      JSON.parse(await readFile(paths.session, "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertSessionIdentity(
  data: C60112ReviewWorkspaceData,
  session: C60112ReviewSession | null,
  expectedReviewPackageSemanticHash: string,
  expectedMachineDraftHash: string,
): void {
  const mismatch =
    expectedReviewPackageSemanticHash !== data.reviewPackageSemanticHash ||
    expectedMachineDraftHash !== data.machineDraftHash ||
    (session !== null &&
      (session.reviewPackageSemanticHash !== data.reviewPackageSemanticHash ||
        session.machineDraftHash !== data.machineDraftHash));
  if (mismatch) {
    throw new WorkspaceHttpError(
      409,
      "REVIEW_SESSION_BASE_MISMATCH",
      "The machine draft or frozen review package changed.",
    );
  }
}

function initialSession(
  data: C60112ReviewWorkspaceData,
  now: string,
): C60112ReviewSession {
  return {
    schemaVersion: "1.0.0",
    sessionId: `review-session-${randomUUID()}`,
    sourceMediaIdentity: data.sourceMediaIdentity,
    machineDraftIdentity: data.machineDraftIdentity,
    machineDraftHash: data.machineDraftHash,
    reviewPolicyVersion: data.policyVersion,
    reviewPackageSemanticHash: data.reviewPackageSemanticHash,
    createdAt: now,
    updatedAt: now,
    itemStates: {},
    regionStates: {},
    completedRequiredCount: 0,
    unresolvedRequiredCount: data.items.filter(
      (item) => item.requiredLevel === "REQUIRED",
    ).length,
    reviewComplete: false,
  };
}

function refreshSessionSummary(
  data: C60112ReviewWorkspaceData,
  session: C60112ReviewSession,
): void {
  const requiredItems = data.items.filter(
    (item) => item.requiredLevel === "REQUIRED",
  );
  const completed = requiredItems.filter((item) => {
    const itemState = session.itemStates[item.reviewItemId];
    return itemState !== undefined && itemState.decisionType !== "UNRESOLVED";
  });
  session.completedRequiredCount = completed.length;
  session.unresolvedRequiredCount = requiredItems.length - completed.length;
  session.reviewComplete = session.unresolvedRequiredCount === 0;
  session.regionStates = Object.fromEntries(
    data.regions.map((region) => {
      const regionRequired = requiredItems.filter((item) =>
        region.reviewItemIds.includes(item.reviewItemId),
      );
      const regionCompleted = regionRequired.filter((item) => {
        const itemState = session.itemStates[item.reviewItemId];
        return (
          itemState !== undefined && itemState.decisionType !== "UNRESOLVED"
        );
      }).length;
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
}

function parseDecisionRequest(value: unknown): C60112ReviewDecisionRequest {
  if (!isRecord(value)) {
    throw new WorkspaceHttpError(
      400,
      "INVALID_DECISION",
      "Decision must be an object.",
    );
  }
  const allowedKeys = new Set([
    "decisionId",
    "reviewItemId",
    "decisionType",
    "selectedCandidateId",
    "afterText",
    "afterStart",
    "afterEnd",
    "reviewerNote",
    "expectedReviewPackageSemanticHash",
    "expectedMachineDraftHash",
    "reviewInstrumentation",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new WorkspaceHttpError(
      400,
      "UNKNOWN_DECISION_FIELD",
      "Decision contains an unknown field.",
    );
  }
  const decisionType = value.decisionType;
  const nullableString = (item: unknown): item is string | null =>
    item === null || typeof item === "string";
  const nullableNumber = (item: unknown): item is number | null =>
    item === null || (typeof item === "number" && Number.isFinite(item));
  if (
    typeof value.decisionId !== "string" ||
    value.decisionId.length === 0 ||
    typeof value.reviewItemId !== "string" ||
    value.reviewItemId.length === 0 ||
    typeof decisionType !== "string" ||
    !C60112_REVIEW_DECISION_TYPES.includes(
      decisionType as C60112ReviewDecisionType,
    ) ||
    !nullableString(value.selectedCandidateId) ||
    !nullableString(value.afterText) ||
    !nullableNumber(value.afterStart) ||
    !nullableNumber(value.afterEnd) ||
    !nullableString(value.reviewerNote) ||
    typeof value.expectedReviewPackageSemanticHash !== "string" ||
    typeof value.expectedMachineDraftHash !== "string"
  ) {
    throw new WorkspaceHttpError(
      400,
      "INVALID_DECISION",
      "Decision fields do not match the local review contract.",
    );
  }
  if (value.reviewInstrumentation !== undefined)
    c60113CorrectionInstrumentationSchema.parse(value.reviewInstrumentation);
  return value as unknown as C60112ReviewDecisionRequest;
}

function parseUndoRequest(value: unknown): C60112UndoRequest {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "undoId",
          "expectedReviewPackageSemanticHash",
          "expectedMachineDraftHash",
        ].includes(key),
    ) ||
    typeof value.undoId !== "string" ||
    value.undoId.length === 0 ||
    typeof value.expectedReviewPackageSemanticHash !== "string" ||
    typeof value.expectedMachineDraftHash !== "string"
  ) {
    throw new WorkspaceHttpError(
      400,
      "INVALID_UNDO",
      "Undo requires an idempotency ID and valid workspace identity.",
    );
  }
  return value as unknown as C60112UndoRequest;
}

function correctionForDecision(input: {
  data: C60112ReviewWorkspaceData;
  session: C60112ReviewSession;
  request: C60112ReviewDecisionRequest;
  now: string;
}): C60112CorrectionRecord {
  const item = input.data.items.find(
    (candidate) => candidate.reviewItemId === input.request.reviewItemId,
  );
  if (item === undefined) {
    throw new WorkspaceHttpError(
      404,
      "REVIEW_ITEM_NOT_FOUND",
      "Review item not found.",
    );
  }
  if (!item.suggestedActions.includes(input.request.decisionType)) {
    throw new WorkspaceHttpError(
      400,
      "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM",
      "The requested decision is not available for this review item.",
    );
  }
  const bundle = input.data.candidateBundles.find(
    (candidate) => candidate.reviewItemId === item.reviewItemId,
  ) ?? { reviewItemId: item.reviewItemId, candidates: [] };
  const selectedCandidate = bundle.candidates.find(
    (candidate) => candidate.candidateId === input.request.selectedCandidateId,
  );
  const instrumentation = input.request.reviewInstrumentation;
  if (instrumentation !== undefined) {
    const region = input.data.regionReviewV2?.regions.find(
      (entry) => entry.regionId === item.regionId,
    );
    const budget = input.data.regionReviewV2?.plans.find(
      (entry) => entry.planId === instrumentation.reviewBudget,
    );
    const expectedRank = (budget?.regionIds.indexOf(item.regionId) ?? -1) + 1;
    if (
      !region ||
      instrumentation.regionRank !== expectedRank ||
      (instrumentation.initialEditingCandidateId !== null &&
        !bundle.candidates.some(
          (candidate) =>
            candidate.candidateId === instrumentation.initialEditingCandidateId,
        ))
    )
      throw new WorkspaceHttpError(
        400,
        "REVIEW_INSTRUMENTATION_SCOPE_MISMATCH",
        "Instrumentation must reference this frozen region and item candidate.",
      );
  }
  const machineText = item.finalCueIds.length === 0 ? null : item.currentText;
  const previousState = input.session.itemStates[item.reviewItemId];
  const beforeText =
    previousState === undefined ? machineText : previousState.afterText;
  const beforeStart =
    previousState === undefined ? item.currentStart : previousState.afterStart;
  const beforeEnd =
    previousState === undefined ? item.currentEnd : previousState.afterEnd;
  let afterText = beforeText;
  let afterStart = beforeStart;
  let afterEnd = beforeEnd;
  let selectedCandidateId: string | null = null;
  const requireCandidate = (label: "REAZON" | "WHISPER_ALT"): void => {
    if (!selectedCandidate?.labels.includes(label)) {
      throw new WorkspaceHttpError(
        400,
        "CANDIDATE_SCOPE_MISMATCH",
        `${label} decision requires a candidate from this review item.`,
      );
    }
    selectedCandidateId = selectedCandidate.candidateId;
    afterText = selectedCandidate.text;
  };
  if (
    !["KEEP_CURRENT", "UNRESOLVED", "WAIVE_REVIEW"].includes(
      input.request.decisionType,
    ) &&
    input.request.decisionType !== "ADD_NEW_CUE" &&
    input.request.decisionType !== "MARK_FALSE_POSITIVE" &&
    item.finalCueIds.length !== 1
  ) {
    throw new WorkspaceHttpError(
      400,
      "SINGLE_CUE_ACTION_REQUIRED",
      "Text and timing mutations require exactly one explicit final cue.",
    );
  }
  switch (input.request.decisionType) {
    case "KEEP_CURRENT":
      if (item.finalCueIds.length === 0) {
        throw new WorkspaceHttpError(
          400,
          "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM",
          "A missing-speech item has no current cue to keep.",
        );
      }
      afterText = machineText;
      afterStart = item.currentStart;
      afterEnd = item.currentEnd;
      break;
    case "USE_REAZON":
      requireCandidate("REAZON");
      break;
    case "USE_WHISPER_ALTERNATE":
      requireCandidate("WHISPER_ALT");
      break;
    case "MANUAL_EDIT":
      if (
        input.request.afterText === null ||
        input.request.afterText.trim().length === 0
      ) {
        throw new WorkspaceHttpError(
          400,
          "MANUAL_TEXT_REQUIRED",
          "Manual edit requires non-empty text.",
        );
      }
      afterText = input.request.afterText;
      break;
    case "TIMING_EDIT":
      if (
        input.request.afterStart === null ||
        input.request.afterEnd === null ||
        input.request.afterStart < 0 ||
        input.request.afterEnd <= input.request.afterStart ||
        input.request.afterEnd * 1_000 > workspaceSourceDurationMs(input.data)
      ) {
        throw new WorkspaceHttpError(
          400,
          "INVALID_TIMING_EDIT",
          "Timing edit requires non-negative start < end within sourceDurationMs.",
        );
      }
      afterStart = input.request.afterStart;
      afterEnd = input.request.afterEnd;
      break;
    case "ADD_NEW_CUE":
      if (item.finalCueIds.length !== 0) {
        throw new WorkspaceHttpError(
          400,
          "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM",
          "ADD_NEW_CUE is only valid for an item without a final cue.",
        );
      }
      if (
        input.request.afterText === null ||
        input.request.afterText.trim().length === 0 ||
        input.request.afterStart === null ||
        input.request.afterEnd === null ||
        input.request.afterStart < 0 ||
        input.request.afterEnd <= input.request.afterStart ||
        input.request.afterEnd * 1_000 > workspaceSourceDurationMs(input.data)
      ) {
        throw new WorkspaceHttpError(
          400,
          "INVALID_NEW_CUE",
          "ADD_NEW_CUE requires text and timestamps within sourceDurationMs.",
        );
      }
      afterText = input.request.afterText;
      afterStart = input.request.afterStart;
      afterEnd = input.request.afterEnd;
      break;
    case "MARK_FALSE_POSITIVE":
      if (item.finalCueIds.length !== 0) {
        throw new WorkspaceHttpError(
          400,
          "ACTION_NOT_AVAILABLE_FOR_REVIEW_ITEM",
          "MARK_FALSE_POSITIVE is only valid for a missing-speech item.",
        );
      }
      afterText = null;
      afterStart = null;
      afterEnd = null;
      break;
    case "UNRESOLVED":
      break;
    case "WAIVE_REVIEW":
      if (
        input.request.reviewerNote?.trim().length === 0 ||
        input.request.reviewerNote === null
      ) {
        throw new WorkspaceHttpError(
          400,
          "WAIVER_NOTE_REQUIRED",
          "WAIVE_REVIEW requires a reviewer note.",
        );
      }
      break;
  }
  return humanCorrectionRecordSchema.parse({
    schemaVersion: "1.0.0",
    recordId: `correction-${sha256Value({
      sessionId: input.session.sessionId,
      decisionId: input.request.decisionId,
    }).slice(0, 24)}`,
    decisionId: input.request.decisionId,
    sessionId: input.session.sessionId,
    reviewItemId: item.reviewItemId,
    regionId: item.regionId,
    eventIds: item.eventIds,
    cueIds: item.finalCueIds,
    sourceInterval: item.sourceInterval,
    machineDraftHash: input.data.machineDraftHash,
    evidenceSnapshotHash: item.semanticHash || sha256Value(item),
    candidateSetHash: sha256Value(bundle),
    ...(input.request.reviewInstrumentation === undefined
      ? {}
      : { reviewInstrumentation: input.request.reviewInstrumentation }),
    decisionType: input.request.decisionType,
    selectedCandidateId,
    beforeText,
    afterText,
    beforeStart,
    beforeEnd,
    afterStart,
    afterEnd,
    itemTypes: item.itemTypes,
    priorityAtDecision: {
      tier: item.priorityTier,
      score: item.priorityScore,
      requiredLevel: item.requiredLevel,
    },
    reviewerNote: input.request.reviewerNote,
    createdAt: input.now,
  });
}

function stateFromCorrection(
  record: C60112CorrectionRecord,
): C60112ReviewItemState {
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

function decisionAuditId(sessionId: string, recordId: string): string {
  return `audit-decision-${sha256Value({ sessionId, recordId }).slice(0, 24)}`;
}

function undoAuditId(sessionId: string, undoId: string): string {
  return `audit-undo-${sha256Value({ sessionId, undoId }).slice(0, 24)}`;
}

function cloneSession(session: C60112ReviewSession): C60112ReviewSession {
  return reviewSessionSchema.parse(JSON.parse(JSON.stringify(session)));
}

function historyFailure(message: string): WorkspaceHttpError {
  return new WorkspaceHttpError(500, "AUDIT_CHAIN_BROKEN", message);
}

function assertRecoveredIntervalWithinSourceDuration(input: {
  data: C60112ReviewWorkspaceData;
  start: number | null;
  end: number | null;
  label: string;
}): void {
  if (input.start === null && input.end === null) return;
  if (
    input.start === null ||
    input.end === null ||
    !Number.isFinite(input.start) ||
    !Number.isFinite(input.end) ||
    input.start < 0 ||
    input.end <= input.start ||
    input.end * 1_000 > workspaceSourceDurationMs(input.data)
  ) {
    throw historyFailure(`${input.label} has timing outside sourceDurationMs.`);
  }
}

function assertRecoveredCorrectionTiming(
  data: C60112ReviewWorkspaceData,
  correction: C60112CorrectionRecord,
): void {
  assertRecoveredIntervalWithinSourceDuration({
    data,
    start: correction.beforeStart,
    end: correction.beforeEnd,
    label: `Correction ${correction.recordId} before state`,
  });
  assertRecoveredIntervalWithinSourceDuration({
    data,
    start: correction.afterStart,
    end: correction.afterEnd,
    label: `Correction ${correction.recordId} after state`,
  });
}

function assertRecoveredSessionTiming(
  data: C60112ReviewWorkspaceData,
  session: C60112ReviewSession,
): void {
  for (const [reviewItemId, state] of Object.entries(session.itemStates)) {
    assertRecoveredIntervalWithinSourceDuration({
      data,
      start: state.afterStart,
      end: state.afterEnd,
      label: `Session item ${reviewItemId}`,
    });
  }
}

async function acquireWorkspaceMutationLock(paths: WorkspacePaths): Promise<{
  release: () => Promise<void>;
}> {
  const root = await lstat(paths.root);
  if (root.isSymbolicLink() || !root.isDirectory()) {
    throw new WorkspaceHttpError(
      403,
      "WORKSPACE_ROOT_SYMLINK_REJECTED",
      "The review workspace must be a local directory, not a symbolic link.",
    );
  }
  await mkdir(paths.sessionDirectory, { recursive: true });
  const session = await lstat(paths.sessionDirectory);
  const rootReal = await realpath(paths.root);
  if (
    session.isSymbolicLink() ||
    !session.isDirectory() ||
    (await realpath(paths.sessionDirectory)) !== path.join(rootReal, "session")
  ) {
    throw new WorkspaceHttpError(
      403,
      "WORKSPACE_SESSION_SYMLINK_REJECTED",
      "Review session state must remain inside the workspace.",
    );
  }
  // Append-only journals and the SQLite mutex must never follow a substituted
  // local link. This guard covers both legacy state and additive trial files.
  for (const entry of await readdir(paths.sessionDirectory)) {
    let metadata;
    try {
      metadata = await lstat(path.join(paths.sessionDirectory, entry));
    } catch (error) {
      // An active holder may finish an atomic snapshot rename while this
      // process is waiting to acquire the mutex. Removed temp files are safe.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      throw new WorkspaceHttpError(
        403,
        "WORKSPACE_SESSION_FILE_SYMLINK_REJECTED",
        "Symbolic links are not accepted as review session state.",
      );
    }
  }
  const deadline = Date.now() + 10_000;
  // SQLite owns the cross-process lock in the OS, so SIGKILL releases it. A
  // persistent PID file cannot provide this property without unsafe stale-lock
  // deletion races. No review data is stored in this mutex database.
  const file = await open(paths.mutationLock, "a", 0o600);
  await file.close();
  const database = new DatabaseSync(paths.mutationLock);
  try {
    for (;;) {
      try {
        database.exec("BEGIN EXCLUSIVE");
        return {
          release: () => {
            try {
              database.exec("ROLLBACK");
            } finally {
              database.close();
            }
            return Promise.resolve();
          },
        };
      } catch (error) {
        const sqliteError = error as { errcode?: number };
        if (sqliteError.errcode !== 5 && sqliteError.errcode !== 6) throw error;
        if (Date.now() >= deadline) {
          throw new WorkspaceHttpError(
            503,
            "WORKSPACE_MUTATION_LOCK_TIMEOUT",
            "Another process is updating this review workspace.",
          );
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }
  } catch (error) {
    database.close();
    throw error;
  }
}

async function withWorkspaceMutationLock<T>(
  paths: WorkspacePaths,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireWorkspaceMutationLock(paths);
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}

/** Shared OS-released mutex for extension state; callers must not nest it. */
export async function withC60112WorkspaceMutationLock<T>(
  workspaceDirectory: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withWorkspaceMutationLock(
    workspacePaths(workspaceDirectory),
    operation,
  );
}

function uniqueHistoryRecords<T>(input: {
  records: T[];
  identity: (record: T) => string;
  label: string;
}): T[] {
  const unique = new Map<string, T>();
  for (const record of input.records) {
    const identity = input.identity(record);
    const existing = unique.get(identity);
    if (
      existing !== undefined &&
      sha256Value(existing) !== sha256Value(record)
    ) {
      throw historyFailure(
        `${input.label} ${identity} has conflicting append-only records.`,
      );
    }
    unique.set(identity, existing ?? record);
  }
  return [...unique.values()];
}

async function readWorkspaceHistory(
  paths: WorkspacePaths,
  data: C60112ReviewWorkspaceData,
): Promise<{
  corrections: C60112CorrectionRecord[];
  audits: C60112AuditRecord[];
}> {
  const [rawCorrections, rawAudits] = await Promise.all([
    readJsonLines<unknown>(paths.correctionLog),
    readJsonLines<unknown>(paths.auditLog),
  ]);
  const corrections = uniqueHistoryRecords({
    records: rawCorrections.map((record) =>
      humanCorrectionRecordSchema.parse(record),
    ),
    identity: (record) => record.recordId,
    label: "Correction",
  });
  corrections.forEach((correction) =>
    assertRecoveredCorrectionTiming(data, correction),
  );
  return {
    corrections,
    audits: uniqueHistoryRecords({
      records: rawAudits.map((record) => reviewAuditRecordSchema.parse(record)),
      identity: (record) => record.auditId,
      label: "Audit",
    }),
  };
}

function parsePendingTransaction(
  value: unknown,
): C60112PendingWorkspaceTransaction {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "1.0.0" ||
    typeof value.transactionId !== "string" ||
    value.transactionId.length === 0 ||
    (value.operation !== "DECISION" && value.operation !== "UNDO")
  ) {
    throw historyFailure("Pending workspace transaction is malformed.");
  }
  const audit = reviewAuditRecordSchema.parse(value.audit);
  const correction =
    value.correction === null
      ? null
      : humanCorrectionRecordSchema.parse(value.correction);
  const session = reviewSessionSchema.parse(value.session);
  const transaction: C60112PendingWorkspaceTransaction = {
    schemaVersion: "1.0.0",
    transactionId: value.transactionId,
    operation: value.operation,
    correction,
    audit,
    session,
  };
  if (
    transaction.transactionId !== transaction.audit.auditId ||
    transaction.operation !== transaction.audit.operation ||
    transaction.session.sessionId !== transaction.audit.sessionId ||
    (transaction.operation === "DECISION" &&
      transaction.audit.newDecision !== transaction.correction?.recordId) ||
    (transaction.operation === "UNDO" && transaction.correction !== null)
  ) {
    throw historyFailure("Pending workspace transaction identity is invalid.");
  }
  return transaction;
}

async function loadPendingTransaction(
  paths: WorkspacePaths,
): Promise<C60112PendingWorkspaceTransaction | null> {
  try {
    return parsePendingTransaction(
      JSON.parse(await readFile(paths.pendingTransaction, "utf8")) as unknown,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function ensureCorrectionLogged(
  paths: WorkspacePaths,
  correction: C60112CorrectionRecord,
): Promise<void> {
  const existing = (await readJsonLines<unknown>(paths.correctionLog))
    .map(
      (record) =>
        humanCorrectionRecordSchema.parse(record) as C60112CorrectionRecord,
    )
    .find((record) => record.recordId === correction.recordId);
  if (existing !== undefined) {
    if (sha256Value(existing) !== sha256Value(correction)) {
      throw historyFailure(
        `Correction ${correction.recordId} conflicts with its transaction.`,
      );
    }
    return;
  }
  await appendJsonLine(paths.correctionLog, correction);
}

async function ensureAuditLogged(
  paths: WorkspacePaths,
  audit: C60112AuditRecord,
): Promise<void> {
  const existing = (await readJsonLines<unknown>(paths.auditLog))
    .map((record) => reviewAuditRecordSchema.parse(record))
    .find((record) => record.auditId === audit.auditId);
  if (existing !== undefined) {
    if (sha256Value(existing) !== sha256Value(audit)) {
      throw historyFailure(
        `Audit ${audit.auditId} conflicts with its transaction.`,
      );
    }
    return;
  }
  await appendJsonLine(paths.auditLog, audit);
}

async function applyPendingTransaction(
  paths: WorkspacePaths,
  transaction: C60112PendingWorkspaceTransaction,
  data: C60112ReviewWorkspaceData,
): Promise<void> {
  if (transaction.correction !== null) {
    assertRecoveredCorrectionTiming(data, transaction.correction);
  }
  assertRecoveredSessionTiming(data, transaction.session);
  if (transaction.correction !== null) {
    await ensureCorrectionLogged(paths, transaction.correction);
  }
  await ensureAuditLogged(paths, transaction.audit);
  await atomicWriteText(
    paths.session,
    `${JSON.stringify(transaction.session, null, 2)}\n`,
  );
  await rm(paths.pendingTransaction, { force: true });
}

async function persistTransaction(
  paths: WorkspacePaths,
  transaction: C60112PendingWorkspaceTransaction,
  data: C60112ReviewWorkspaceData,
): Promise<void> {
  if (transaction.correction !== null) {
    assertRecoveredCorrectionTiming(data, transaction.correction);
  }
  assertRecoveredSessionTiming(data, transaction.session);
  await atomicWriteText(
    paths.pendingTransaction,
    `${JSON.stringify(transaction, null, 2)}\n`,
  );
  await applyPendingTransaction(paths, transaction, data);
}

async function recoverPendingTransaction(
  paths: WorkspacePaths,
  data: C60112ReviewWorkspaceData,
): Promise<void> {
  const pending = await loadPendingTransaction(paths);
  if (pending !== null) await applyPendingTransaction(paths, pending, data);
}

function itemBeforeState(
  data: C60112ReviewWorkspaceData,
  session: C60112ReviewSession,
  reviewItemId: string,
): {
  text: string | null;
  start: number | null;
  end: number | null;
  state: C60112ReviewItemState | null;
} {
  const item = data.items.find(
    (candidate) => candidate.reviewItemId === reviewItemId,
  );
  if (item === undefined) {
    throw historyFailure(`History references unknown item ${reviewItemId}.`);
  }
  const state = session.itemStates[reviewItemId] ?? null;
  return {
    text:
      state?.afterText ??
      (state === null && item.finalCueIds.length > 0 ? item.currentText : null),
    start: state?.afterStart ?? (state === null ? item.currentStart : null),
    end: state?.afterEnd ?? (state === null ? item.currentEnd : null),
    state,
  };
}

function assertCorrectionStartsAtSessionState(
  data: C60112ReviewWorkspaceData,
  session: C60112ReviewSession,
  correction: C60112CorrectionRecord,
): void {
  const before = itemBeforeState(data, session, correction.reviewItemId);
  if (
    correction.sessionId !== session.sessionId ||
    correction.machineDraftHash !== data.machineDraftHash ||
    correction.beforeText !== before.text ||
    correction.beforeStart !== before.start ||
    correction.beforeEnd !== before.end
  ) {
    throw historyFailure(
      `Correction ${correction.recordId} does not continue the saved item state.`,
    );
  }
}

function initialSessionForHistory(input: {
  data: C60112ReviewWorkspaceData;
  snapshot: C60112ReviewSession | null;
  corrections: C60112CorrectionRecord[];
  audits: C60112AuditRecord[];
}): C60112ReviewSession | null {
  const firstAudit = input.audits[0];
  const sessionId = input.snapshot?.sessionId ?? firstAudit?.sessionId;
  if (sessionId === undefined) return null;
  const createdAt =
    input.snapshot?.createdAt ??
    firstAudit?.timestamp ??
    new Date().toISOString();
  const session = initialSession(input.data, createdAt);
  session.sessionId = sessionId;
  return session;
}

function applyAuditHistory(input: {
  data: C60112ReviewWorkspaceData;
  session: C60112ReviewSession;
  corrections: C60112CorrectionRecord[];
  audits: C60112AuditRecord[];
}): C60112ReviewSession {
  const session = input.session;
  const correctionsById = new Map(
    input.corrections.map((record) => [record.recordId, record]),
  );
  for (const audit of input.audits) {
    if (audit.sessionId !== session.sessionId) {
      throw historyFailure(
        `Audit ${audit.auditId} belongs to another session.`,
      );
    }
    const beforeState = session.itemStates[audit.reviewItemId] ?? null;
    if (audit.beforeHash !== sha256Value(beforeState)) {
      throw historyFailure(`Audit ${audit.auditId} has an invalid beforeHash.`);
    }
    let afterState: C60112ReviewItemState | null;
    if (audit.operation === "DECISION") {
      if (
        audit.newDecision === null ||
        audit.undoneRecordId !== null ||
        audit.previousDecision !== (beforeState?.recordId ?? null)
      ) {
        throw historyFailure(
          `Decision audit ${audit.auditId} is discontinuous.`,
        );
      }
      const correction = correctionsById.get(audit.newDecision);
      if (correction?.reviewItemId !== audit.reviewItemId) {
        throw historyFailure(
          `Decision audit ${audit.auditId} has no matching correction.`,
        );
      }
      assertCorrectionStartsAtSessionState(input.data, session, correction);
      afterState = stateFromCorrection(correction);
    } else {
      if (
        audit.undoneRecordId === null ||
        audit.previousDecision !== audit.undoneRecordId ||
        beforeState?.recordId !== audit.undoneRecordId
      ) {
        throw historyFailure(`Undo audit ${audit.auditId} is discontinuous.`);
      }
      const previousCorrection =
        audit.newDecision === null
          ? undefined
          : correctionsById.get(audit.newDecision);
      if (
        (audit.newDecision !== null && previousCorrection === undefined) ||
        (previousCorrection !== undefined &&
          previousCorrection.reviewItemId !== audit.reviewItemId)
      ) {
        throw historyFailure(
          `Undo audit ${audit.auditId} restores a missing or unrelated correction.`,
        );
      }
      afterState =
        previousCorrection === undefined
          ? null
          : stateFromCorrection(previousCorrection);
    }
    if (audit.afterHash !== sha256Value(afterState)) {
      throw historyFailure(`Audit ${audit.auditId} has an invalid afterHash.`);
    }
    if (afterState === null) {
      Reflect.deleteProperty(session.itemStates, audit.reviewItemId);
    } else {
      session.itemStates[audit.reviewItemId] = afterState;
    }
    session.updatedAt = audit.timestamp;
  }
  refreshSessionSummary(input.data, session);
  return reviewSessionSchema.parse(session);
}

async function loadConsistentWorkspaceState(
  paths: WorkspacePaths,
  data: C60112ReviewWorkspaceData,
): Promise<{
  session: C60112ReviewSession | null;
  corrections: C60112CorrectionRecord[];
  audits: C60112AuditRecord[];
}> {
  await recoverPendingTransaction(paths, data);
  const [snapshot, history] = await Promise.all([
    loadSessionSnapshot(paths),
    readWorkspaceHistory(paths, data),
  ]);
  if (snapshot !== null) assertRecoveredSessionTiming(data, snapshot);
  assertSessionIdentity(
    data,
    snapshot,
    data.reviewPackageSemanticHash,
    data.machineDraftHash,
  );
  let session = initialSessionForHistory({
    data,
    snapshot,
    corrections: history.corrections,
    audits: history.audits,
  });
  if (session !== null) {
    session = applyAuditHistory({
      data,
      session,
      corrections: history.corrections,
      audits: history.audits,
    });
  }

  if (
    session !== null &&
    (snapshot === null || sha256Value(snapshot) !== sha256Value(session))
  ) {
    await atomicWriteText(
      paths.session,
      `${JSON.stringify(session, null, 2)}\n`,
    );
  }
  return { session, ...history };
}

function assertDecisionRetryMatchesCorrection(
  request: C60112ReviewDecisionRequest,
  correction: C60112CorrectionRecord,
): void {
  let matches =
    request.reviewItemId === correction.reviewItemId &&
    request.decisionType === correction.decisionType &&
    request.reviewerNote === correction.reviewerNote &&
    sha256Value(request.reviewInstrumentation ?? null) ===
      sha256Value(correction.reviewInstrumentation ?? null);
  switch (request.decisionType) {
    case "USE_REAZON":
    case "USE_WHISPER_ALTERNATE":
      matches &&=
        request.selectedCandidateId === correction.selectedCandidateId &&
        request.afterText === null &&
        request.afterStart === null &&
        request.afterEnd === null;
      break;
    case "MANUAL_EDIT":
      matches &&=
        request.selectedCandidateId === null &&
        request.afterText === correction.afterText &&
        request.afterStart === null &&
        request.afterEnd === null;
      break;
    case "TIMING_EDIT":
      matches &&=
        request.selectedCandidateId === null &&
        request.afterText === null &&
        request.afterStart === correction.afterStart &&
        request.afterEnd === correction.afterEnd;
      break;
    case "ADD_NEW_CUE":
      matches &&=
        request.selectedCandidateId === null &&
        request.afterText === correction.afterText &&
        request.afterStart === correction.afterStart &&
        request.afterEnd === correction.afterEnd;
      break;
    default:
      matches &&=
        request.selectedCandidateId === null &&
        request.afterText === null &&
        request.afterStart === null &&
        request.afterEnd === null;
      break;
  }
  if (!matches) {
    throw new WorkspaceHttpError(
      409,
      "DECISION_ID_REUSE_MISMATCH",
      "The decision ID was already used with different content.",
    );
  }
}

function pendingOrphanCorrection(input: {
  corrections: C60112CorrectionRecord[];
  audits: C60112AuditRecord[];
}): C60112CorrectionRecord | undefined {
  const committedCorrectionIds = new Set(
    input.audits
      .filter((audit) => audit.operation === "DECISION")
      .flatMap((audit) =>
        audit.newDecision === null ? [] : [audit.newDecision],
      ),
  );
  return input.corrections.find(
    (record) => !committedCorrectionIds.has(record.recordId),
  );
}

function rejectPendingOrphanCorrection(workspace: {
  corrections: C60112CorrectionRecord[];
  audits: C60112AuditRecord[];
}): void {
  const orphan = pendingOrphanCorrection(workspace);
  if (orphan !== undefined) {
    throw new WorkspaceHttpError(
      409,
      "PENDING_DECISION_RECOVERY_REQUIRED",
      `Pending correction ${orphan.decisionId} must be retried with the same decision ID.`,
    );
  }
}

async function saveDecision(
  paths: WorkspacePaths,
  data: C60112ReviewWorkspaceData,
  request: C60112ReviewDecisionRequest,
): Promise<C60112ReviewSession> {
  const workspace = await loadConsistentWorkspaceState(paths, data);
  let session = workspace.session;
  assertSessionIdentity(
    data,
    session,
    request.expectedReviewPackageSemanticHash,
    request.expectedMachineDraftHash,
  );
  const duplicate = workspace.corrections.find(
    (record) => record.decisionId === request.decisionId,
  );
  if (duplicate !== undefined) {
    assertDecisionRetryMatchesCorrection(request, duplicate);
    const committedAudit = workspace.audits.find(
      (audit) =>
        audit.operation === "DECISION" &&
        audit.newDecision === duplicate.recordId,
    );
    if (committedAudit !== undefined) {
      if (session === null) {
        throw historyFailure(
          `Decision ${request.decisionId} has no recoverable session.`,
        );
      }
      return session;
    }
    if (session === null) {
      session = initialSession(data, duplicate.createdAt);
      session.sessionId = duplicate.sessionId;
    }
    assertCorrectionStartsAtSessionState(data, session, duplicate);
    const previousState = session.itemStates[duplicate.reviewItemId] ?? null;
    const nextState = stateFromCorrection(duplicate);
    const recoveredAudit: C60112AuditRecord = {
      schemaVersion: "1.0.0",
      auditId: decisionAuditId(session.sessionId, duplicate.recordId),
      operation: "DECISION",
      timestamp: duplicate.createdAt,
      sessionId: session.sessionId,
      reviewItemId: duplicate.reviewItemId,
      previousDecision: previousState?.recordId ?? null,
      newDecision: duplicate.recordId,
      undoneRecordId: null,
      beforeHash: sha256Value(previousState),
      afterHash: sha256Value(nextState),
    };
    reviewAuditRecordSchema.parse(recoveredAudit);
    const recoveredSession = cloneSession(session);
    recoveredSession.itemStates[duplicate.reviewItemId] = nextState;
    recoveredSession.updatedAt = duplicate.createdAt;
    refreshSessionSummary(data, recoveredSession);
    reviewSessionSchema.parse(recoveredSession);
    await persistTransaction(
      paths,
      {
        schemaVersion: "1.0.0",
        transactionId: recoveredAudit.auditId,
        operation: "DECISION",
        correction: duplicate,
        audit: recoveredAudit,
        session: recoveredSession,
      },
      data,
    );
    return recoveredSession;
  }
  rejectPendingOrphanCorrection(workspace);
  const now = new Date().toISOString();
  session ??= initialSession(data, now);
  const correction = correctionForDecision({ data, session, request, now });
  const previousState = session.itemStates[request.reviewItemId] ?? null;
  const nextState = stateFromCorrection(correction);
  const audit: C60112AuditRecord = {
    schemaVersion: "1.0.0",
    auditId: decisionAuditId(session.sessionId, correction.recordId),
    operation: "DECISION",
    timestamp: now,
    sessionId: session.sessionId,
    reviewItemId: request.reviewItemId,
    previousDecision: previousState?.recordId ?? null,
    newDecision: correction.recordId,
    undoneRecordId: null,
    beforeHash: sha256Value(previousState),
    afterHash: sha256Value(nextState),
  };
  reviewAuditRecordSchema.parse(audit);
  const nextSession = cloneSession(session);
  nextSession.itemStates[request.reviewItemId] = nextState;
  nextSession.updatedAt = now;
  refreshSessionSummary(data, nextSession);
  reviewSessionSchema.parse(nextSession);
  await persistTransaction(
    paths,
    {
      schemaVersion: "1.0.0",
      transactionId: audit.auditId,
      operation: "DECISION",
      correction,
      audit,
      session: nextSession,
    },
    data,
  );
  return nextSession;
}

function activeDecisionStack(audit: C60112AuditRecord[]): string[] {
  const stack: string[] = [];
  for (const record of audit) {
    if (record.operation === "DECISION" && record.newDecision !== null) {
      stack.push(record.newDecision);
    } else if (record.operation === "UNDO" && record.undoneRecordId !== null) {
      const index = stack.lastIndexOf(record.undoneRecordId);
      if (index >= 0) stack.splice(index, 1);
    }
  }
  return stack;
}

async function undoLastDecision(
  paths: WorkspacePaths,
  data: C60112ReviewWorkspaceData,
  request: C60112UndoRequest,
): Promise<C60112ReviewSession> {
  const workspace = await loadConsistentWorkspaceState(paths, data);
  const session = workspace.session;
  if (session === null) {
    throw new WorkspaceHttpError(
      409,
      "REVIEW_SESSION_NOT_STARTED",
      "No review session exists.",
    );
  }
  assertSessionIdentity(
    data,
    session,
    request.expectedReviewPackageSemanticHash,
    request.expectedMachineDraftHash,
  );
  rejectPendingOrphanCorrection(workspace);
  const auditId = undoAuditId(session.sessionId, request.undoId);
  const duplicateUndo = workspace.audits.find(
    (record) => record.auditId === auditId,
  );
  if (duplicateUndo !== undefined) {
    if (
      duplicateUndo.operation !== "UNDO" ||
      duplicateUndo.sessionId !== session.sessionId
    ) {
      throw new WorkspaceHttpError(
        409,
        "UNDO_ID_REUSE_MISMATCH",
        "The undo ID was already used with different content.",
      );
    }
    return session;
  }
  const stack = activeDecisionStack(workspace.audits);
  const recordId = stack.at(-1);
  if (recordId === undefined) {
    throw new WorkspaceHttpError(
      409,
      "NOTHING_TO_UNDO",
      "No decision can be undone.",
    );
  }
  const currentCorrection = workspace.corrections.find(
    (record) => record.recordId === recordId,
  );
  const decisionAudit = [...workspace.audits]
    .reverse()
    .find(
      (record) =>
        record.operation === "DECISION" && record.newDecision === recordId,
    );
  if (currentCorrection === undefined || decisionAudit === undefined) {
    throw new WorkspaceHttpError(
      500,
      "AUDIT_CHAIN_BROKEN",
      "The append-only review audit cannot reconstruct the last decision.",
    );
  }
  const previousCorrection =
    decisionAudit.previousDecision === null
      ? undefined
      : workspace.corrections.find(
          (record) => record.recordId === decisionAudit.previousDecision,
        );
  const beforeState =
    session.itemStates[currentCorrection.reviewItemId] ?? null;
  if (beforeState?.recordId !== recordId) {
    throw historyFailure(
      `Undo target ${recordId} is not the active item decision.`,
    );
  }
  const nextSession = cloneSession(session);
  if (previousCorrection === undefined) {
    Reflect.deleteProperty(
      nextSession.itemStates,
      currentCorrection.reviewItemId,
    );
  } else {
    nextSession.itemStates[currentCorrection.reviewItemId] =
      stateFromCorrection(previousCorrection);
  }
  const afterState =
    nextSession.itemStates[currentCorrection.reviewItemId] ?? null;
  const now = new Date().toISOString();
  const undoAudit: C60112AuditRecord = {
    schemaVersion: "1.0.0",
    auditId,
    operation: "UNDO",
    timestamp: now,
    sessionId: session.sessionId,
    reviewItemId: currentCorrection.reviewItemId,
    previousDecision: recordId,
    newDecision: previousCorrection?.recordId ?? null,
    undoneRecordId: recordId,
    beforeHash: sha256Value(beforeState),
    afterHash: sha256Value(afterState),
  };
  reviewAuditRecordSchema.parse(undoAudit);
  nextSession.updatedAt = now;
  refreshSessionSummary(data, nextSession);
  reviewSessionSchema.parse(nextSession);
  await persistTransaction(
    paths,
    {
      schemaVersion: "1.0.0",
      transactionId: undoAudit.auditId,
      operation: "UNDO",
      correction: null,
      audit: undoAudit,
      session: nextSession,
    },
    data,
  );
  return nextSession;
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(`${JSON.stringify(value)}\n`);
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new WorkspaceHttpError(
      415,
      "JSON_CONTENT_TYPE_REQUIRED",
      "Mutation endpoints require application/json.",
    );
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 256 * 1024) {
      throw new WorkspaceHttpError(
        413,
        "REQUEST_TOO_LARGE",
        "Request body is too large.",
      );
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new WorkspaceHttpError(
      400,
      "INVALID_JSON",
      "Request body is not valid JSON.",
    );
  }
}

function mimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".wav": "audio/wav",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    }[extension] ?? "application/octet-stream"
  );
}

async function resolveStaticFile(
  rootReal: string,
  rawPath: string,
): Promise<string> {
  if (rawPath.startsWith("//")) {
    throw new WorkspaceHttpError(
      403,
      "PATH_TRAVERSAL_REJECTED",
      "Unsafe path rejected.",
    );
  }
  const decoded = decodePathRepeatedly(rawPath);
  if (decoded.includes("\0") || decoded.includes("\\")) {
    throw new WorkspaceHttpError(
      403,
      "PATH_TRAVERSAL_REJECTED",
      "Unsafe path rejected.",
    );
  }
  const segments = decoded.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new WorkspaceHttpError(
      403,
      "PATH_TRAVERSAL_REJECTED",
      "Unsafe path rejected.",
    );
  }
  const topLevelSegment = (segments[0] ?? "").toLocaleLowerCase("en-US");
  if (["api", "session"].includes(topLevelSegment)) {
    throw new WorkspaceHttpError(
      403,
      "PRIVATE_PATH_REJECTED",
      "Private path rejected.",
    );
  }
  const rootFile = segments.length === 1 ? topLevelSegment : "";
  if (
    segments.length > 0 &&
    !["index.html", "review-data.json"].includes(rootFile) &&
    !["assets", "audio"].includes(topLevelSegment)
  ) {
    throw new WorkspaceHttpError(
      403,
      "NON_PUBLIC_PATH_REJECTED",
      "Only frozen review assets and review audio are public.",
    );
  }
  const relative =
    segments.length === 0 ? "index.html" : segments.join(path.sep);
  let current = rootReal;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let entry;
    try {
      entry = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new WorkspaceHttpError(
          404,
          "NOT_FOUND",
          "Local asset not found.",
        );
      }
      throw error;
    }
    if (entry.isSymbolicLink()) {
      throw new WorkspaceHttpError(
        403,
        "SYMLINK_REJECTED",
        "Symbolic links are not served.",
      );
    }
  }
  if (!isInside(rootReal, current)) {
    throw new WorkspaceHttpError(
      403,
      "PATH_TRAVERSAL_REJECTED",
      "Unsafe path rejected.",
    );
  }
  const resolved = await realpath(current);
  if (!isInside(rootReal, resolved)) {
    throw new WorkspaceHttpError(
      403,
      "PATH_TRAVERSAL_REJECTED",
      "Unsafe path rejected.",
    );
  }
  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new WorkspaceHttpError(404, "NOT_FOUND", "Local asset not found.");
  }
  return resolved;
}

async function serveStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  rootReal: string,
  rawPath: string,
): Promise<void> {
  const filePath = await resolveStaticFile(rootReal, rawPath);
  const info = await stat(filePath);
  securityHeaders(response);
  response.setHeader("Content-Type", mimeType(filePath));
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader(
    "Cache-Control",
    filePath.endsWith("review-data.json") ? "no-store" : "no-cache",
  );
  const range = request.headers.range;
  if (range !== undefined) {
    const match = /^bytes=(\d+)-(\d*)$/u.exec(range);
    if (match === null) {
      response.statusCode = 416;
      response.setHeader("Content-Range", `bytes */${String(info.size)}`);
      response.end();
      return;
    }
    const start = Number(match[1]);
    const end = match[2] === "" ? info.size - 1 : Number(match[2]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      end >= info.size
    ) {
      response.statusCode = 416;
      response.setHeader("Content-Range", `bytes */${String(info.size)}`);
      response.end();
      return;
    }
    response.statusCode = 206;
    response.setHeader("Content-Length", String(end - start + 1));
    response.setHeader(
      "Content-Range",
      `bytes ${String(start)}-${String(end)}/${String(info.size)}`,
    );
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }
  response.statusCode = 200;
  response.setHeader("Content-Length", String(info.size));
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function rawRequestPath(request: IncomingMessage): string {
  const value = request.url ?? "/";
  return value.split("?", 1)[0] ?? "/";
}

export async function startC60112ReviewWorkspaceServer(input: {
  workspaceDirectory: string;
  host?: string;
  port?: number;
  expectedWorkspaceDataHash?: string;
}): Promise<{
  host: "127.0.0.1";
  port: number;
  url: string;
  close: () => Promise<void>;
}> {
  const host = input.host ?? "127.0.0.1";
  if (host !== "127.0.0.1") {
    throw new Error("C6.0.1.12 review server only binds to 127.0.0.1.");
  }
  const paths = workspacePaths(input.workspaceDirectory);
  const rootReal = await realpath(paths.root);
  const data = await loadWorkspaceData(paths);
  if (
    input.expectedWorkspaceDataHash !== undefined &&
    machineQualitySemanticHash(data) !== input.expectedWorkspaceDataHash
  ) {
    throw new Error("REVIEW_WORKSPACE_DATA_FREEZE_HASH_MISMATCH");
  }
  // Serve the startup-validated snapshot instead of rereading review-data.json
  // on each request. This keeps the UI and mutation API on the same frozen
  // object even if the workspace file is edited while the server is running.
  const frozenReviewDataPayload = Buffer.from(
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8",
  );
  let allowedHost = "";
  let mutationQueue: Promise<unknown> = Promise.resolve();
  const serializeMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const server = createServer((request, response) => {
    void (async () => {
      const hostHeader = request.headers.host ?? "";
      if (hostHeader !== allowedHost) {
        throw new WorkspaceHttpError(
          403,
          "HOST_REJECTED",
          "Host header rejected.",
        );
      }
      const rawPath = rawRequestPath(request);
      const decodedPath = decodePathRepeatedly(rawPath);
      if (
        decodedPath === "/review-data.json" &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader(
          "Content-Length",
          String(frozenReviewDataPayload.length),
        );
        if (request.method === "HEAD") response.end();
        else response.end(frozenReviewDataPayload);
        return;
      }
      if (decodedPath === "/api/health" && request.method === "GET") {
        sendJson(response, 200, {
          ok: true,
          workspaceVersion: C60112_REVIEW_WORKSPACE_VERSION,
          reviewPackageSemanticHash: data.reviewPackageSemanticHash,
        });
        return;
      }
      if (decodedPath === "/api/session" && request.method === "GET") {
        const { session } = await serializeMutation(() =>
          withWorkspaceMutationLock(paths, () =>
            loadConsistentWorkspaceState(paths, data),
          ),
        );
        if (
          session !== null &&
          (session.reviewPackageSemanticHash !==
            data.reviewPackageSemanticHash ||
            session.machineDraftHash !== data.machineDraftHash)
        ) {
          throw new WorkspaceHttpError(
            409,
            "REVIEW_SESSION_BASE_MISMATCH",
            "Saved review session targets a different frozen package.",
          );
        }
        sendJson(response, 200, {
          status: session === null ? "not-started" : "active",
          session,
        });
        return;
      }
      if (
        data.regionReviewV2 &&
        request.method === "GET" &&
        ["/api/trial", "/api/playback"].includes(decodedPath)
      ) {
        const extension = await import("./c60113-prospective-trial.js");
        sendJson(
          response,
          200,
          decodedPath === "/api/trial"
            ? { trial: await extension.readC60113Trial(paths.root, data) }
            : await extension.c60113PlaybackState(paths.root, data),
        );
        return;
      }
      if (
        [
          "/api/decision",
          "/api/undo",
          ...(data.regionReviewV2 ? ["/api/trial/event", "/api/playback"] : []),
        ].includes(decodedPath) &&
        request.method === "POST"
      ) {
        if (request.headers["x-mvl-review-request"] !== "c6-0-1-12") {
          throw new WorkspaceHttpError(
            403,
            "MUTATION_HEADER_REQUIRED",
            "Local mutation header is required.",
          );
        }
        const origin = request.headers.origin;
        if (origin !== undefined && origin !== `http://${allowedHost}`) {
          throw new WorkspaceHttpError(
            403,
            "ORIGIN_REJECTED",
            "Origin rejected.",
          );
        }
        const body = await readRequestJson(request);
        if (
          decodedPath === "/api/trial/event" ||
          decodedPath === "/api/playback"
        ) {
          const extension = await import("./c60113-prospective-trial.js");
          if (decodedPath === "/api/trial/event") {
            if (
              !isRecord(body) ||
              ["DECISION_COMMITTED", "DECISION_UNDONE"].includes(
                String(body.eventType),
              )
            )
              throw new WorkspaceHttpError(
                400,
                "SERVER_DECISION_EVENT_ONLY",
                "Decision events are emitted from committed correction history only.",
              );
            const { c60113TrialEventInputSchema } = await import("@mvl/shared");
            const event = c60113TrialEventInputSchema.parse(body);
            if (
              (event.itemId &&
                !data.items.some((i) => i.reviewItemId === event.itemId)) ||
              (event.regionId &&
                !data.regions.some((r) => r.regionId === event.regionId)) ||
              (event.candidateId &&
                !data.candidateBundles.some(
                  (b) =>
                    b.reviewItemId === event.itemId &&
                    b.candidates.some(
                      (c) => c.candidateId === event.candidateId,
                    ),
                ))
            )
              throw new WorkspaceHttpError(
                400,
                "TRIAL_REFERENCE_MISMATCH",
                "Unknown trial item, region, or candidate.",
              );
            sendJson(response, 200, {
              state: await extension.recordC60113TrialEvent({
                workspaceDirectory: paths.root,
                event,
                data,
              }),
            });
          } else {
            if (
              !isRecord(body) ||
              Object.keys(body).some(
                (k) =>
                  !["intervals", "playbackSeconds", "playbackCount"].includes(
                    k,
                  ),
              ) ||
              !Array.isArray(body.intervals)
            )
              throw new WorkspaceHttpError(
                400,
                "INVALID_PLAYBACK_SAMPLE",
                "Invalid playback sample.",
              );
            sendJson(
              response,
              200,
              await extension.c60113PlaybackState(
                paths.root,
                data,
                body as unknown as {
                  intervals: { start: number; end: number }[];
                  playbackSeconds: number;
                  playbackCount: number;
                },
              ),
            );
          }
          return;
        }
        if (decodedPath === "/api/decision") {
          const decision = parseDecisionRequest(body);
          const session = await serializeMutation(async () => {
            const saved = await withWorkspaceMutationLock(paths, () =>
              saveDecision(paths, data, decision),
            );
            if (data.regionReviewV2)
              await recordCommittedC60113TrialDecision(
                paths,
                data,
                decision.decisionId,
                decision.reviewItemId,
                decision.decisionType,
                false,
              );
            return saved;
          });
          sendJson(response, 200, { ok: true, session });
          return;
        }
        const undo = parseUndoRequest(body);
        const session = await serializeMutation(async () => {
          const saved = await withWorkspaceMutationLock(paths, () =>
            undoLastDecision(paths, data, undo),
          );
          if (data.regionReviewV2) {
            const history = await readWorkspaceHistory(paths, data);
            const audit = history.audits.find(
              (a) => a.auditId === undoAuditId(saved.sessionId, undo.undoId),
            );
            if (audit)
              await recordCommittedC60113TrialDecision(
                paths,
                data,
                undo.undoId,
                audit.reviewItemId,
                null,
                true,
              );
          }
          return saved;
        });
        sendJson(response, 200, { ok: true, session });
        return;
      }
      if (decodedPath.startsWith("/api/")) {
        throw new WorkspaceHttpError(
          404,
          "API_NOT_FOUND",
          "API endpoint not found.",
        );
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new WorkspaceHttpError(
          405,
          "METHOD_NOT_ALLOWED",
          "Method not allowed.",
        );
      }
      await serveStaticFile(request, response, rootReal, rawPath);
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      if (error instanceof WorkspaceHttpError) {
        sendJson(response, error.status, {
          ok: false,
          code: error.code,
          message: error.message,
        });
        return;
      }
      sendJson(response, 500, {
        ok: false,
        code: "REVIEW_SERVER_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Unknown review server error.",
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Review server did not receive a TCP address.");
  }
  const port = address.port;
  allowedHost = `${host}:${port}`;
  return {
    host,
    port,
    url: `http://${allowedHost}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}

async function recordCommittedC60113TrialDecision(
  paths: WorkspacePaths,
  data: C60112ReviewWorkspaceData,
  operationId: string,
  itemId: string,
  decisionType: C60112ReviewDecisionType | null,
  undo: boolean,
): Promise<void> {
  const extension = await import("./c60113-prospective-trial.js");
  const trial = await extension.readC60113Trial(paths.root, data);
  if (trial?.state.status !== "ACTIVE") return;
  const item = data.items.find((i) => i.reviewItemId === itemId);
  await extension.recordC60113TrialEvent({
    workspaceDirectory: paths.root,
    data,
    event: {
      eventId: `committed-${operationId}`,
      eventType: undo ? "DECISION_UNDONE" : "DECISION_COMMITTED",
      expectedReviewPackageHash: data.reviewPackageSemanticHash,
      expectedRankerHash: trial.manifest.rankerHash,
      visible: false,
      focused: false,
      interaction: true,
      audioPlaying: false,
      regionId: item?.regionId ?? null,
      itemId,
      candidateId: null,
      sourceInterval: null,
      manualCharactersEntered: 0,
      decisionType,
    },
  });
}
