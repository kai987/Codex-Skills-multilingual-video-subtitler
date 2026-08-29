import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
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

import {
  humanCorrectionRecordSchema,
  reviewAuditRecordSchema,
  reviewSessionSchema,
} from "@mvl/shared";

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
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
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

export function assertC60112ReviewWorkspaceData(
  data: C60112ReviewWorkspaceData,
): void {
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
    if (!regionIds.has(item.regionId)) {
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
const priorityRank={CRITICAL:4,HIGH:3,MEDIUM:2,LOW:1};
const sessionState=id=>state.session?.itemStates?.[id]??null;
function showStatus(message,error=false){const node=byId('status');node.textContent=message;node.className=error?'error':''}
function bundleFor(id){return state.data.candidateBundles.find(bundle=>bundle.reviewItemId===id)??{reviewItemId:id,candidates:[]}}
function regionFor(id){return state.data.regions.find(region=>region.regionId===id)??null}
function typeMatches(item,filter){if(filter==='ALL')return true;if(filter==='UNRESOLVED')return sessionState(item.reviewItemId)?.decisionType==='UNRESOLVED'||sessionState(item.reviewItemId)===null;return item.itemTypes.some(type=>type.includes(filter))}
function refreshFiltered(){const priority=byId('priority-filter').value;const type=byId('type-filter').value;const activeId=state.filtered[state.index]?.reviewItemId;state.filtered=[...state.data.items].filter(item=>(priority==='ALL'||item.priorityTier===priority)&&typeMatches(item,type)).sort((left,right)=>priorityRank[right.priorityTier]-priorityRank[left.priorityTier]||left.sourceInterval.start-right.sourceInterval.start||left.reviewItemId.localeCompare(right.reviewItemId));state.index=Math.max(0,state.filtered.findIndex(item=>item.reviewItemId===activeId));if(state.index<0)state.index=0;render()}
function renderProgress(){const required=state.data.items.filter(item=>item.requiredLevel==='REQUIRED').length;const completed=state.session?.completedRequiredCount??0;const unresolved=state.session?.unresolvedRequiredCount??required;byId('progress').textContent='Required '+completed+' / '+required+' · unresolved '+unresolved}
function renderQueue(){const queue=byId('queue');queue.replaceChildren();state.filtered.forEach((item,index)=>{const itemState=sessionState(item.reviewItemId);const node=button('',()=>{state.index=index;render()},'queue-item'+(index===state.index?' active':'')+(itemState?(itemState.decisionType==='UNRESOLVED'?' unresolved':' resolved'):''));node.append(text('span',item.priorityTier,'priority '+item.priorityTier),text('div',item.currentText||'[missing speech]'),text('small',item.sourceInterval.start.toFixed(3)+' → '+item.sourceInterval.end.toFixed(3)));queue.append(node)});if(!state.filtered.length)queue.append(text('div','No items match the filters.','empty'))}
function addLabeled(container,label,node){const wrapper=document.createElement('label');wrapper.append(text('span',label,'label'),node);container.append(wrapper)}
function candidateView(item){const container=document.createElement('section');container.append(text('div','Alternative candidates','label'));const selected=state.selectedCandidate.get(item.reviewItemId)??sessionState(item.reviewItemId)?.selectedCandidateId??null;for(const candidate of bundleFor(item.reviewItemId).candidates){const card=document.createElement('div');card.className='candidate'+(candidate.candidateId===selected?' selected':'');card.append(text('strong',candidate.labels.join(' / ')),text('div',candidate.text,'subtitle'));const badges=document.createElement('div');badges.className='badges';candidate.evidenceBadges.forEach(value=>badges.append(text('span',value,'badge')));card.append(badges,button('Select candidate',()=>{state.selectedCandidate.set(item.reviewItemId,candidate.candidateId);render()}));container.append(card)}return container}
function audioView(item){const region=regionFor(item.regionId);const card=document.createElement('section');card.className='card';card.append(text('div','Review audio','label'));if(!region){card.append(text('p','Region audio metadata is unavailable.','empty'));return card}const audio=document.createElement('audio');audio.id='review-audio';audio.controls=true;audio.preload='metadata';if(/^audio\/[A-Za-z0-9._/-]+$/u.test(region.audioPath)&&!region.audioPath.includes('..'))audio.src=region.audioPath;else showStatus('Unsafe audio path rejected.',true);const core=item.coreInterval;const jump=()=>{audio.currentTime=Math.max(0,core.start-region.contextStart);audio.play().catch(error=>showStatus('Audio playback failed: '+error.message,true))};const replay=()=>{audio.currentTime=0;audio.play().catch(error=>showStatus('Audio playback failed: '+error.message,true))};const controls=document.createElement('div');controls.className='audio-actions';controls.append(button('Replay region',replay),button('Jump to core',jump));for(const speed of [.75,1,1.25])controls.append(button(speed.toFixed(2).replace(/0$/u,'')+'×',()=>{audio.playbackRate=speed}));card.append(audio,controls,text('p','Core '+core.start.toFixed(3)+' → '+core.end.toFixed(3)+' · region '+region.contextStart.toFixed(3)+' → '+region.contextEnd.toFixed(3),'note'));return card}
function currentDecisionPayload(item,decisionType,fields={}){return{decisionId:'decision-'+(globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),reviewItemId:item.reviewItemId,decisionType,selectedCandidateId:fields.selectedCandidateId??null,afterText:fields.afterText??null,afterStart:fields.afterStart??null,afterEnd:fields.afterEnd??null,reviewerNote:fields.reviewerNote??null,expectedReviewPackageSemanticHash:state.data.reviewPackageSemanticHash,expectedMachineDraftHash:state.data.machineDraftHash}}
async function postJson(url,body){const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-mvl-review-request':'c6-0-1-12'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error((result.code??'REQUEST_FAILED')+': '+(result.message??response.statusText));return result}
async function decide(item,decisionType,fields={}){try{const result=await postJson('/api/decision',currentDecisionPayload(item,decisionType,fields));state.session=result.session;showStatus('Autosaved '+decisionType+'.');render()}catch(error){showStatus(error.message,true)}}
function actionView(item,textArea,startInput,endInput,noteInput){const card=document.createElement('section');card.className='card';card.append(text('div','Human exception decision','label'));const actions=document.createElement('div');actions.className='actions';const available=type=>item.suggestedActions.includes(type);const add=(type,label,onClick,className)=>{if(available(type))actions.append(button(label,onClick,className))};const bundle=bundleFor(item.reviewItemId);const candidateFor=label=>{const selected=bundle.candidates.find(candidate=>candidate.candidateId===state.selectedCandidate.get(item.reviewItemId));return selected?.labels.includes(label)?selected:bundle.candidates.find(candidate=>candidate.labels.includes(label))};add('KEEP_CURRENT','1 Keep current',()=>decide(item,'KEEP_CURRENT'),'primary');add('USE_REAZON','2 Use Reazon',()=>{const candidate=candidateFor('REAZON');decide(item,'USE_REAZON',{selectedCandidateId:candidate?.candidateId??null})});add('USE_WHISPER_ALTERNATE','3 Use Whisper alternate',()=>{const candidate=candidateFor('WHISPER_ALT');decide(item,'USE_WHISPER_ALTERNATE',{selectedCandidateId:candidate?.candidateId??null})});add('MANUAL_EDIT','Manual text edit',()=>decide(item,'MANUAL_EDIT',{afterText:textArea.value}));add('TIMING_EDIT','Timing edit',()=>decide(item,'TIMING_EDIT',{afterStart:Number(startInput.value),afterEnd:Number(endInput.value)}));add('ADD_NEW_CUE','Add new cue',()=>decide(item,'ADD_NEW_CUE',{afterText:textArea.value,afterStart:Number(startInput.value),afterEnd:Number(endInput.value)}));add('MARK_FALSE_POSITIVE','Mark false positive',()=>decide(item,'MARK_FALSE_POSITIVE'));add('UNRESOLVED','U Unresolved',()=>decide(item,'UNRESOLVED',{reviewerNote:noteInput.value||null}));add('WAIVE_REVIEW','Waive review',()=>decide(item,'WAIVE_REVIEW',{reviewerNote:noteInput.value||null}));actions.append(button('Undo last decision',async()=>{try{const result=await postJson('/api/undo',{expectedReviewPackageSemanticHash:state.data.reviewPackageSemanticHash,expectedMachineDraftHash:state.data.machineDraftHash});state.session=result.session;showStatus('Last decision undone.');render()}catch(error){showStatus(error.message,true)}}));card.append(actions);return card}
function renderWorkspace(){const workspace=byId('workspace');workspace.replaceChildren();const item=state.filtered[state.index];if(!item){workspace.append(text('p','No review item selected.','empty'));return}const heading=document.createElement('section');heading.className='card';heading.append(text('div',item.priorityTier+' · '+item.requiredLevel,'priority '+item.priorityTier),text('h1',item.currentText||'Missing speech review'),text('p',item.reviewReasons.join(' · '),'context'));const badgeRow=document.createElement('div');badgeRow.className='badges';item.itemTypes.forEach(value=>badgeRow.append(text('span',value,'badge')));heading.append(badgeRow);const context=document.createElement('div');context.className='grid';const previous=document.createElement('div');previous.append(text('div','Previous cue','label'),text('div',item.previousCue?.text??'—','context'));const next=document.createElement('div');next.append(text('div','Next cue','label'),text('div',item.nextCue?.text??'—','context'));context.append(previous,next);heading.append(context);const edit=document.createElement('section');edit.className='card';const textArea=document.createElement('textarea');textArea.id='manual-text';textArea.value=item.currentText;addLabeled(edit,'Manual text / new cue text',textArea);const timing=document.createElement('div');timing.className='timing';const startInput=document.createElement('input');startInput.id='timing-start';startInput.type='number';startInput.step='.001';startInput.value=String(item.currentStart??item.coreInterval.start);const endInput=document.createElement('input');endInput.id='timing-end';endInput.type='number';endInput.step='.001';endInput.value=String(item.currentEnd??item.coreInterval.end);addLabeled(timing,'Start',startInput);addLabeled(timing,'End',endInput);const noteInput=document.createElement('input');noteInput.id='reviewer-note';noteInput.type='text';noteInput.placeholder='Required when waiving review';edit.append(timing);addLabeled(edit,'Reviewer note',noteInput);const navigation=document.createElement('div');navigation.className='navigation';navigation.append(button('K Previous',()=>move(-1)),button('J Next',()=>move(1)));workspace.append(heading,audioView(item),candidateView(item),edit,actionView(item,textArea,startInput,endInput,noteInput),navigation);const itemState=sessionState(item.reviewItemId);if(itemState)workspace.prepend(text('p','Saved decision: '+itemState.decisionType,'note'))}
function move(delta){if(!state.filtered.length)return;state.index=(state.index+delta+state.filtered.length)%state.filtered.length;render()}
function restoreSavedInputs(){const item=state.filtered[state.index];if(!item)return;const saved=sessionState(item.reviewItemId);const textArea=byId('manual-text');const startInput=byId('timing-start');const endInput=byId('timing-end');const noteInput=byId('reviewer-note');if(!saved){const selectedId=state.selectedCandidate.get(item.reviewItemId);const selected=bundleFor(item.reviewItemId).candidates.find(candidate=>candidate.candidateId===selectedId);if(textArea&&item.finalCueIds.length===0&&selected)textArea.value=selected.text;return}if(textArea)textArea.value=saved.afterText??'';if(startInput)startInput.value=saved.afterStart===null?'':String(saved.afterStart);if(endInput)endInput.value=saved.afterEnd===null?'':String(saved.afterEnd);if(noteInput)noteInput.value=saved.reviewerNote??''}
function render(){renderProgress();renderQueue();renderWorkspace();restoreSavedInputs()}
byId('priority-filter').addEventListener('change',refreshFiltered);byId('type-filter').addEventListener('change',refreshFiltered);
document.addEventListener('keydown',event=>{const editing=event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLSelectElement||event.target instanceof HTMLButtonElement;if(editing)return;const item=state.filtered[state.index];if(!item)return;const available=type=>item.suggestedActions.includes(type);if(event.key===' '){event.preventDefault();const audio=byId('review-audio');if(audio){if(audio.paused)audio.play().catch(error=>showStatus(error.message,true));else audio.pause()}}if(event.key.toLowerCase()==='j')move(1);if(event.key.toLowerCase()==='k')move(-1);if(event.key==='1'&&available('KEEP_CURRENT'))decide(item,'KEEP_CURRENT');if(event.key==='2'&&available('USE_REAZON')){const candidate=bundleFor(item.reviewItemId).candidates.find(value=>value.labels.includes('REAZON'));decide(item,'USE_REAZON',{selectedCandidateId:candidate?.candidateId??null})}if(event.key==='3'&&available('USE_WHISPER_ALTERNATE')){const candidate=bundleFor(item.reviewItemId).candidates.find(value=>value.labels.includes('WHISPER_ALT'));decide(item,'USE_WHISPER_ALTERNATE',{selectedCandidateId:candidate?.candidateId??null})}if(event.key.toLowerCase()==='e')byId('manual-text')?.focus();if(event.key.toLowerCase()==='t')byId('timing-start')?.focus();if(event.key.toLowerCase()==='u'&&available('UNRESOLVED'))decide(item,'UNRESOLVED')});
Promise.all([fetch('review-data.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('review-data.json unavailable');return response.json()}),fetch('/api/session',{cache:'no-store'}).then(response=>response.json())]).then(([data,sessionResult])=>{state.data=data;state.session=sessionResult.session??null;byId('identity').textContent=data.policyVersion+' · '+data.reviewPackageSemanticHash.slice(0,12);state.filtered=[...data.items];refreshFiltered();showStatus(state.session?'Review session resumed.':'No review session exists; the first explicit decision will create it.')}).catch(error=>showStatus(error.message,true));`;
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
    atomicWriteText(javascriptPath, reviewWorkspaceJavascript()),
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

async function loadSession(
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
  return value as unknown as C60112ReviewDecisionRequest;
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
        input.request.afterEnd <= input.request.afterStart
      ) {
        throw new WorkspaceHttpError(
          400,
          "INVALID_TIMING_EDIT",
          "Timing edit requires non-negative start < end.",
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
        input.request.afterEnd <= input.request.afterStart
      ) {
        throw new WorkspaceHttpError(
          400,
          "INVALID_NEW_CUE",
          "ADD_NEW_CUE requires text and valid timestamps.",
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

async function saveDecision(
  paths: WorkspacePaths,
  data: C60112ReviewWorkspaceData,
  request: C60112ReviewDecisionRequest,
): Promise<C60112ReviewSession> {
  let session = await loadSession(paths);
  assertSessionIdentity(
    data,
    session,
    request.expectedReviewPackageSemanticHash,
    request.expectedMachineDraftHash,
  );
  const now = new Date().toISOString();
  session ??= initialSession(data, now);
  const correction = correctionForDecision({ data, session, request, now });
  const corrections = (await readJsonLines<unknown>(paths.correctionLog)).map(
    (record) =>
      humanCorrectionRecordSchema.parse(record) as C60112CorrectionRecord,
  );
  const duplicate = corrections.find(
    (record) => record.recordId === correction.recordId,
  );
  if (duplicate !== undefined) {
    if (
      duplicate.reviewItemId !== correction.reviewItemId ||
      duplicate.decisionType !== correction.decisionType ||
      duplicate.selectedCandidateId !== correction.selectedCandidateId ||
      duplicate.afterText !== correction.afterText ||
      duplicate.afterStart !== correction.afterStart ||
      duplicate.afterEnd !== correction.afterEnd
    ) {
      throw new WorkspaceHttpError(
        409,
        "DECISION_ID_REUSE_MISMATCH",
        "The decision ID was already used with different content.",
      );
    }
    return session;
  }
  const previousState = session.itemStates[request.reviewItemId] ?? null;
  const nextState = stateFromCorrection(correction);
  const audit: C60112AuditRecord = {
    schemaVersion: "1.0.0",
    auditId: `audit-${randomUUID()}`,
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
  session.itemStates[request.reviewItemId] = nextState;
  session.updatedAt = now;
  refreshSessionSummary(data, session);
  reviewSessionSchema.parse(session);
  await appendJsonLine(paths.correctionLog, correction);
  await appendJsonLine(paths.auditLog, audit);
  await atomicWriteText(paths.session, `${JSON.stringify(session, null, 2)}\n`);
  return session;
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
  identity: {
    expectedReviewPackageSemanticHash: string;
    expectedMachineDraftHash: string;
  },
): Promise<C60112ReviewSession> {
  const session = await loadSession(paths);
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
    identity.expectedReviewPackageSemanticHash,
    identity.expectedMachineDraftHash,
  );
  const [audit, corrections] = await Promise.all([
    readJsonLines<unknown>(paths.auditLog).then((records) =>
      records.map((record) => reviewAuditRecordSchema.parse(record)),
    ),
    readJsonLines<unknown>(paths.correctionLog).then((records) =>
      records.map(
        (record) =>
          humanCorrectionRecordSchema.parse(record) as C60112CorrectionRecord,
      ),
    ),
  ]);
  const stack = activeDecisionStack(audit);
  const recordId = stack.at(-1);
  if (recordId === undefined) {
    throw new WorkspaceHttpError(
      409,
      "NOTHING_TO_UNDO",
      "No decision can be undone.",
    );
  }
  const currentCorrection = corrections.find(
    (record) => record.recordId === recordId,
  );
  const decisionAudit = [...audit]
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
      : corrections.find(
          (record) => record.recordId === decisionAudit.previousDecision,
        );
  const beforeState =
    session.itemStates[currentCorrection.reviewItemId] ?? null;
  if (previousCorrection === undefined) {
    Reflect.deleteProperty(session.itemStates, currentCorrection.reviewItemId);
  } else {
    session.itemStates[currentCorrection.reviewItemId] =
      stateFromCorrection(previousCorrection);
  }
  const afterState = session.itemStates[currentCorrection.reviewItemId] ?? null;
  const now = new Date().toISOString();
  const undoAudit: C60112AuditRecord = {
    schemaVersion: "1.0.0",
    auditId: `audit-${randomUUID()}`,
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
  session.updatedAt = now;
  refreshSessionSummary(data, session);
  reviewSessionSchema.parse(session);
  await appendJsonLine(paths.auditLog, undoAudit);
  await atomicWriteText(paths.session, `${JSON.stringify(session, null, 2)}\n`);
  return session;
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
      if (decodedPath === "/api/health" && request.method === "GET") {
        sendJson(response, 200, {
          ok: true,
          workspaceVersion: C60112_REVIEW_WORKSPACE_VERSION,
          reviewPackageSemanticHash: data.reviewPackageSemanticHash,
        });
        return;
      }
      if (decodedPath === "/api/session" && request.method === "GET") {
        const session = await loadSession(paths);
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
        ["/api/decision", "/api/undo"].includes(decodedPath) &&
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
        if (decodedPath === "/api/decision") {
          const decision = parseDecisionRequest(body);
          const session = await serializeMutation(() =>
            saveDecision(paths, data, decision),
          );
          sendJson(response, 200, { ok: true, session });
          return;
        }
        if (
          !isRecord(body) ||
          typeof body.expectedReviewPackageSemanticHash !== "string" ||
          typeof body.expectedMachineDraftHash !== "string"
        ) {
          throw new WorkspaceHttpError(
            400,
            "INVALID_UNDO",
            "Undo identity is invalid.",
          );
        }
        const session = await serializeMutation(() =>
          undoLastDecision(paths, data, {
            expectedReviewPackageSemanticHash:
              body.expectedReviewPackageSemanticHash as string,
            expectedMachineDraftHash: body.expectedMachineDraftHash as string,
          }),
        );
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
