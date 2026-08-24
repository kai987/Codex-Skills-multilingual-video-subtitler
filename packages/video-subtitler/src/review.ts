import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  atomicWriteFile,
  atomicWriteJson,
  correctionFeedbackSchema,
  humanReviewResolutionsSchema,
  subtitleReviewPackageSchema,
  type CorrectionFeedback,
  type CueDecision,
  type FinalizationCandidate,
  type FinalizationFinding,
  type HumanReviewResolution,
  type HumanReviewResolutions,
  type ProcessRunner,
  type SourceFingerprint,
  type SubtitleCue,
  type SubtitlePackage,
  type SubtitleReviewPackage,
} from "@mvl/shared";

import {
  isRecord,
  sha256Value,
  stableStringify,
} from "./finalization-support.js";

const HUMAN_ACTIONS = [
  "KEEP",
  "ACCEPT_SUGGESTION",
  "EDIT_TEXT",
  "REJECT_SUGGESTION",
  "SPLIT_CUE",
  "MERGE_CUES",
  "EDIT_TIMING",
  "DELETE_CUE",
  "MARK_UNRESOLVED",
] as const;

function contextCue(cue: SubtitleCue | undefined) {
  return cue === undefined
    ? null
    : { cueId: cue.id, text: cue.text, start: cue.start, end: cue.end };
}

function defaultMachineDecision(cue: SubtitleCue): CueDecision {
  return {
    decisionId: `decision-${sha256Value({ cueId: cue.id }).slice(0, 20)}`,
    targetCueIds: [cue.id],
    action: "KEEP",
    currentText: cue.text,
    proposedText: null,
    proposedCues: [],
    selectedCandidateId: null,
    alternativeCandidateIds: [],
    evidenceIds: [],
    blockers: ["HUMAN_MODE_REVIEW_REQUIRED"],
    automaticMutationEligible: false,
    requiresHumanReview: true,
    decisionReasons: ["HUMAN_MODE_REVIEW_REQUIRED"],
  };
}

export function reviewComponentUnionInterval(
  cues: readonly Pick<SubtitleCue, "start" | "end">[],
): { start: number; end: number } {
  if (cues.length === 0) {
    throw new InputError("A review component must contain at least one cue.");
  }
  return {
    start: Math.min(...cues.map((cue) => cue.start)),
    end: Math.max(...cues.map((cue) => cue.end)),
  };
}

/**
 * Keeps the complete component union and trims context only. If the union is
 * itself longer than the requested review limit, preserving evidence takes
 * precedence over the soft clip limit.
 */
export function reviewAudioBounds(input: {
  start: number;
  end: number;
  duration: number;
  contextSeconds: number;
  maximumSeconds: number;
}): { start: number; end: number } {
  const componentDuration = input.end - input.start;
  const maximumSeconds = Math.max(input.maximumSeconds, componentDuration);
  const availableContext = Math.max(0, maximumSeconds - componentDuration);
  const desiredBefore = Math.min(input.contextSeconds, input.start);
  const desiredAfter = Math.min(
    input.contextSeconds,
    Math.max(0, input.duration - input.end),
  );
  let before = Math.min(desiredBefore, availableContext / 2);
  let after = Math.min(desiredAfter, availableContext - before);
  const remaining = Math.max(0, availableContext - before - after);
  if (remaining > 0) {
    const moreBefore = Math.min(remaining, desiredBefore - before);
    before += moreBefore;
    after += Math.min(remaining - moreBefore, desiredAfter - after);
  }
  return {
    start: Math.max(0, input.start - before),
    end: Math.min(input.duration, input.end + after),
  };
}

async function createReviewAudio(input: {
  reviewId: string;
  interval: { start: number; end: number };
  durationSeconds: number;
  subtitleDirectory: string;
  sourceVideoPath: string | null;
  runner: ProcessRunner;
  ffmpegPath: string;
  audioStreamIndex?: number;
  contextSeconds: number;
  maximumSeconds: number;
}): Promise<{
  path: string | null;
  error: string | null;
  requestedInterval: { start: number; end: number };
  extractedInterval: { start: number; end: number } | null;
  durationSeconds: number | null;
  sha256: string | null;
  fullyCoversComponent: boolean;
}> {
  const bounds = reviewAudioBounds({
    start: input.interval.start,
    end: input.interval.end,
    duration: input.durationSeconds,
    contextSeconds: input.contextSeconds,
    maximumSeconds: input.maximumSeconds,
  });
  if (input.sourceVideoPath === null) {
    return {
      path: null,
      error: "SOURCE_VIDEO_UNAVAILABLE",
      requestedInterval: bounds,
      extractedInterval: null,
      durationSeconds: null,
      sha256: null,
      fullyCoversComponent: false,
    };
  }
  const relative = path.posix.join(
    "..",
    "audio",
    "review",
    `${input.reviewId}.wav`,
  );
  const output = path.join(
    input.subtitleDirectory,
    "audio",
    "review",
    `${input.reviewId}.wav`,
  );
  try {
    await mkdir(path.dirname(output), { recursive: true });
    await input.runner.run(input.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      bounds.start.toFixed(3),
      "-i",
      input.sourceVideoPath,
      ...(input.audioStreamIndex === undefined
        ? []
        : ["-map", `0:${input.audioStreamIndex}`]),
      "-t",
      Math.max(0.001, bounds.end - bounds.start).toFixed(3),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      output,
    ]);
    const audioSha256 = createHash("sha256")
      .update(await readFile(output))
      .digest("hex");
    const fullyCoversComponent =
      bounds.start <= input.interval.start + 0.001 &&
      bounds.end >= input.interval.end - 0.001;
    return {
      path: relative,
      error: null,
      requestedInterval: bounds,
      extractedInterval: bounds,
      durationSeconds: bounds.end - bounds.start,
      sha256: audioSha256,
      fullyCoversComponent,
    };
  } catch (error) {
    return {
      path: null,
      error: error instanceof Error ? error.message : String(error),
      requestedInterval: bounds,
      extractedInterval: null,
      durationSeconds: null,
      sha256: null,
      fullyCoversComponent: false,
    };
  }
}

function reviewCss(): string {
  return `:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:#111;color:#eee}header{position:sticky;top:0;background:#181818;padding:1rem;z-index:2;border-bottom:1px solid #444}main{max-width:1100px;margin:auto;padding:1rem}.item{border:1px solid #444;border-radius:12px;padding:1rem;margin:1rem 0;background:#1b1b1b}.grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.label{font-size:.8rem;color:#aaa;text-transform:uppercase}.text{white-space:pre-wrap;font-size:1.15rem}.blocker{color:#ffb4a9}.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}button{padding:.55rem .8rem;border-radius:8px;border:1px solid #666;background:#292929;color:inherit;cursor:pointer}button:hover{background:#383838}.selected{outline:2px solid #7dd3fc}audio{width:100%;margin-top:.75rem}@media(max-width:700px){.grid{grid-template-columns:1fr}main{padding:.5rem}.item{border-radius:0;margin:.5rem 0}}`;
}

function reviewJavascript(): string {
  return String.raw`const state={data:null,index:0,resolutions:new Map(),loop:false};
const q=(s,r=document)=>r.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function resolution(item,action){const base={resolutionId:'resolution-'+item.reviewId,reviewId:item.reviewId,action,selectedCandidateId:null,correctedText:null,start:null,end:null,splitParts:[],mergeCueIds:[],reviewerNotes:null,errorTypes:[],confirmedReading:null,terminologyHints:[],dialectHints:[]};if(action==='ACCEPT_SUGGESTION')base.selectedCandidateId=item.machineDecision.selectedCandidateId;if(action==='EDIT_TEXT'){const v=prompt('Corrected text',item.currentText);if(!v)return;base.correctedText=v}if(action==='EDIT_TIMING'){base.start=Number(prompt('Start',item.currentStart));base.end=Number(prompt('End',item.currentEnd))}if(action==='DELETE_CUE'){const n=prompt('Deletion reason (required)');if(!n)return;base.reviewerNotes=n}if(action==='SPLIT_CUE'){const raw=prompt('Parts as JSON [{"text":"...","start":0,"end":1}]');if(!raw)return;try{base.splitParts=JSON.parse(raw)}catch{return alert('Invalid JSON')}}if(action==='MERGE_CUES'){const ids=prompt('Adjacent cue IDs, comma separated',item.targetCueIds.join(','));const text=prompt('Merged text',item.currentText);if(!ids||!text)return;base.mergeCueIds=ids.split(',').map(x=>x.trim()).filter(Boolean);base.correctedText=text}state.resolutions.set(item.reviewId,base);render()}
function render(){const item=state.data.items[state.index];q('#position').textContent=(state.index+1)+' / '+state.data.items.length;if(!item){q('#items').innerHTML='<p>No review items.</p>';return}const suggestions=esc(JSON.stringify(item.candidateSuggestions.map(c=>({id:c.candidateId,coverage:c.coverageMetrics,evidence:c.sourceEvidenceIds})),null,2));const audio=item.audioClipPath?'<audio controls src="'+esc(item.audioClipPath)+'"></audio>':'<p>'+esc(item.audioError??'No audio')+'</p>';const union=item.componentUnionInterval??item.interval;const audioEvidence=item.audioRequestedInterval?'<p>Component union: '+union.start.toFixed(3)+' → '+union.end.toFixed(3)+' · Audio: '+item.audioRequestedInterval.start.toFixed(3)+' → '+item.audioRequestedInterval.end.toFixed(3)+' · Complete: '+String(item.audioFullyCoversComponent)+'</p>':'';const buttons=item.allowedHumanActions.map(a=>'<button data-action="'+a+'">'+a+'</button>').join('');q('#items').innerHTML='<article class="item"><div class="grid"><section><div class="label">Current subtitle</div><div class="text">'+esc(item.currentText)+'</div><p>'+union.start.toFixed(3)+' → '+union.end.toFixed(3)+'</p></section><section><div class="label">Machine recommendation</div><div class="text">'+esc(item.machineDecision.proposedText??'KEEP')+'</div><p>'+esc(item.candidateSuggestions[0]?.associationType??'none')+'</p></section><section><div class="label">Previous</div><div>'+esc(item.previousCue?.text??'—')+'</div><div class="label">Next</div><div>'+esc(item.nextCue?.text??'—')+'</div></section><section><div class="label">Coverage / evidence</div><pre>'+suggestions+'</pre></section></div><div class="label blocker">Blockers</div><div class="blocker">'+esc(item.blockers.join(', ')||'none')+'</div>'+audioEvidence+audio+'<div class="actions">'+buttons+'</div><p>Selected: '+esc(state.resolutions.get(item.reviewId)?.action??'none')+'</p></article>';document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>resolution(item,b.dataset.action));}
function move(delta){if(!state.data.items.length)return;state.index=(state.index+delta+state.data.items.length)%state.data.items.length;render()}
q('#previous').onclick=()=>move(-1);q('#next').onclick=()=>move(1);q('#download').onclick=()=>{const d=state.data;const body={schemaVersion:'1.0.0',resolutionType:'human-review-resolutions',reviewVersion:d.reviewVersion,sourceFingerprint:d.sourceFingerprint,baseSubtitlePackageHash:d.baseSubtitlePackageHash,baseCueHash:d.baseCueHash,inputEvidenceHash:d.inputEvidenceHash,resolutions:[...state.resolutions.values()].sort((a,b)=>a.reviewId.localeCompare(b.reviewId))};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)+'\\n'],{type:'application/json'}));a.download='human-review-resolutions.json';a.click();URL.revokeObjectURL(a.href)};
document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea'))return;if(e.key==='ArrowLeft')move(-1);if(e.key==='ArrowRight')move(1);const item=state.data.items[state.index];if(!item)return;if(e.key==='a')resolution(item,'ACCEPT_SUGGESTION');if(e.key==='k')resolution(item,'KEEP');if(e.key==='u')resolution(item,'MARK_UNRESOLVED');if(e.key===' '){e.preventDefault();const a=q('audio');if(a){if(a.paused)a.play();else a.pause()}}if(e.key==='l'){state.loop=!state.loop;const a=q('audio');if(a)a.loop=state.loop}});
fetch('./data/subtitle-review-package.json').then(r=>r.json()).then(d=>{state.data=d;render()}).catch(e=>q('#items').textContent=e.message);`;
}

function reviewHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Subtitle review</title><link rel="stylesheet" href="./assets/review.css"></head><body><header><strong>Subtitle review</strong> <span id="position"></span> <button id="previous">Previous</button> <button id="next">Next</button> <button id="download">Download resolutions</button><small> Keys: space play, l loop, ←/→ navigate, a accept, k keep, u unresolved</small></header><main id="items">Loading…</main><script type="module" src="./assets/review.js"></script></body></html>`;
}

export async function prepareSubtitleReviewPackage(input: {
  subtitleDirectory: string;
  baseSubtitlePackagePath: string;
  baseSubtitlePackageHash: string;
  baseCueHash: string;
  inputEvidenceHash: string;
  sourceFingerprint: SourceFingerprint;
  sourceVideoPath: string | null;
  subtitlePackage: SubtitlePackage;
  cues: readonly SubtitleCue[];
  candidates: readonly FinalizationCandidate[];
  decisions: readonly CueDecision[];
  findings: readonly FinalizationFinding[];
  runner: ProcessRunner;
  ffmpegPath: string;
  generateAudio: boolean;
  reviewAllCues: boolean;
  contextSeconds?: number;
  maximumClipSeconds?: number;
  audioStreamIndex?: number;
}): Promise<{
  reviewPackage: SubtitleReviewPackage;
  packagePath: string;
  pagePath: string;
}> {
  const decisions = [...input.decisions];
  const targeted = new Set(
    decisions.flatMap((decision) => decision.targetCueIds),
  );
  if (input.reviewAllCues) {
    for (const cue of input.cues) {
      if (!targeted.has(cue.id)) decisions.push(defaultMachineDecision(cue));
    }
  }
  const cueIndex = new Map(input.cues.map((cue, index) => [cue.id, index]));
  const reviewDecisions = decisions
    .filter((decision) => input.reviewAllCues || decision.requiresHumanReview)
    .sort(
      (left, right) =>
        (cueIndex.get(left.targetCueIds[0] ?? "") ?? Number.MAX_SAFE_INTEGER) -
        (cueIndex.get(right.targetCueIds[0] ?? "") ?? Number.MAX_SAFE_INTEGER),
    );
  const items: SubtitleReviewPackage["items"] = [];
  for (const decision of reviewDecisions) {
    const indexes = decision.targetCueIds
      .map((cueId) => cueIndex.get(cueId))
      .filter((index): index is number => index !== undefined)
      .sort((left, right) => left - right);
    const firstIndex = indexes[0];
    const lastIndex = indexes.at(-1);
    if (firstIndex === undefined || lastIndex === undefined) continue;
    const targets = indexes
      .map((index) => input.cues[index])
      .filter((cue): cue is SubtitleCue => cue !== undefined);
    const first = targets[0];
    const last = targets.at(-1);
    if (first === undefined || last === undefined) continue;
    const reviewId = `review-${sha256Value({
      decisionId: decision.decisionId,
      baseCueHash: input.baseCueHash,
    }).slice(0, 20)}`;
    const interval = reviewComponentUnionInterval(targets);
    const candidateSuggestions = input.candidates.filter((candidate) =>
      candidate.targetCueIds.some((cueId) =>
        decision.targetCueIds.includes(cueId),
      ),
    );
    const audio = input.generateAudio
      ? await createReviewAudio({
          reviewId,
          interval,
          durationSeconds: input.subtitlePackage.source.durationSeconds,
          subtitleDirectory: input.subtitleDirectory,
          sourceVideoPath: input.sourceVideoPath,
          runner: input.runner,
          ffmpegPath: input.ffmpegPath,
          ...(input.audioStreamIndex === undefined
            ? {}
            : { audioStreamIndex: input.audioStreamIndex }),
          contextSeconds: input.contextSeconds ?? 1.5,
          maximumSeconds: input.maximumClipSeconds ?? 30,
        })
      : {
          path: null,
          error: "AUDIO_GENERATION_NOT_REQUESTED",
          requestedInterval: reviewAudioBounds({
            start: interval.start,
            end: interval.end,
            duration: input.subtitlePackage.source.durationSeconds,
            contextSeconds: input.contextSeconds ?? 1.5,
            maximumSeconds: input.maximumClipSeconds ?? 30,
          }),
          extractedInterval: null,
          durationSeconds: null,
          sha256: null,
          fullyCoversComponent: false,
        };
    const relatedFindings = input.findings.filter((item) =>
      item.cueIds.some((cueId) => decision.targetCueIds.includes(cueId)),
    );
    items.push({
      reviewId,
      targetCueIds: decision.targetCueIds,
      interval,
      currentText: targets.map((cue) => cue.text).join("\n"),
      currentStart: interval.start,
      currentEnd: interval.end,
      currentStyle: first.style ?? "default",
      currentSpeaker: first.speaker,
      previousCue: contextCue(input.cues[firstIndex - 1]),
      nextCue: contextCue(input.cues[lastIndex + 1]),
      machineDecision: decision,
      candidateSuggestions,
      findingIds: relatedFindings.map((item) => item.findingId),
      blockers: [
        ...new Set([
          ...decision.blockers,
          ...relatedFindings.map((item) => item.code),
        ]),
      ].sort((left, right) => left.localeCompare(right)),
      allowedHumanActions:
        candidateSuggestions.length === 0
          ? HUMAN_ACTIONS.filter(
              (action) =>
                action !== "ACCEPT_SUGGESTION" &&
                action !== "REJECT_SUGGESTION",
            )
          : [...HUMAN_ACTIONS],
      audioClipPath: audio.path,
      audioError: audio.error,
      componentUnionInterval: interval,
      audioRequestedInterval: audio.requestedInterval,
      audioExtractedInterval: audio.extractedInterval,
      audioDurationSeconds: audio.durationSeconds,
      audioSha256: audio.sha256,
      audioContextSeconds: input.contextSeconds ?? 1.5,
      audioFullyCoversComponent: audio.fullyCoversComponent,
      requiresHumanReview: true,
    });
  }
  const reviewVersion = `review-v1-${sha256Value({
    baseSubtitlePackageHash: input.baseSubtitlePackageHash,
    baseCueHash: input.baseCueHash,
    inputEvidenceHash: input.inputEvidenceHash,
    items: items.map((item) => ({
      reviewId: item.reviewId,
      targetCueIds: item.targetCueIds,
      componentUnionInterval: item.componentUnionInterval ?? item.interval,
      audioRequestedInterval: item.audioRequestedInterval,
    })),
  }).slice(0, 24)}`;
  const reviewPackage = subtitleReviewPackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-review-package",
    reviewVersion,
    generatedAt: new Date().toISOString(),
    sourceFingerprint: input.sourceFingerprint,
    baseSubtitlePackagePath: `./${path.basename(input.baseSubtitlePackagePath)}`,
    baseSubtitlePackageHash: input.baseSubtitlePackageHash,
    baseCueHash: input.baseCueHash,
    inputEvidenceHash: input.inputEvidenceHash,
    items,
    summary: {
      itemCount: items.length,
      mandatoryItemCount: items.filter((item) => item.requiresHumanReview)
        .length,
      audioClipCount: items.filter((item) => item.audioClipPath !== null)
        .length,
      audioFailureCount: items.filter((item) => item.audioError !== null)
        .length,
      audioCoverageFailureCount: items.filter(
        (item) => !item.audioFullyCoversComponent,
      ).length,
    },
  });
  const packagePath = path.join(
    input.subtitleDirectory,
    "subtitle-review-package.json",
  );
  const reviewDirectory = path.join(input.subtitleDirectory, "review");
  const pagePath = path.join(reviewDirectory, "index.html");
  await Promise.all([
    atomicWriteJson(packagePath, reviewPackage, { overwrite: true }),
    atomicWriteJson(
      path.join(reviewDirectory, "data", "subtitle-review-package.json"),
      reviewPackage,
      { overwrite: true },
    ),
    atomicWriteFile(pagePath, reviewHtml(), { overwrite: true }),
    atomicWriteFile(
      path.join(reviewDirectory, "assets", "review.css"),
      reviewCss(),
      {
        overwrite: true,
      },
    ),
    atomicWriteFile(
      path.join(reviewDirectory, "assets", "review.js"),
      reviewJavascript(),
      { overwrite: true },
    ),
  ]);
  return { reviewPackage, packagePath, pagePath };
}

function equalFingerprint(
  left: SourceFingerprint,
  right: SourceFingerprint,
): boolean {
  return stableStringify(left) === stableStringify(right);
}

function validateResolutionPayload(
  resolution: HumanReviewResolution,
  reviewItem: SubtitleReviewPackage["items"][number],
): void {
  switch (resolution.action) {
    case "ACCEPT_SUGGESTION":
      if (
        resolution.selectedCandidateId === null ||
        !reviewItem.candidateSuggestions.some(
          (candidate) =>
            candidate.candidateId === resolution.selectedCandidateId,
        )
      ) {
        throw new InputError(
          `Resolution ${resolution.resolutionId} references an unknown candidate.`,
        );
      }
      break;
    case "EDIT_TEXT":
      if (
        resolution.correctedText === null ||
        resolution.correctedText.trim() === ""
      ) {
        throw new InputError(
          `Resolution ${resolution.resolutionId} requires correctedText.`,
        );
      }
      break;
    case "EDIT_TIMING":
      if (
        resolution.start === null ||
        resolution.end === null ||
        resolution.end <= resolution.start
      ) {
        throw new InputError(
          `Resolution ${resolution.resolutionId} has invalid timing.`,
        );
      }
      break;
    case "SPLIT_CUE":
      if (resolution.splitParts.length < 2) {
        throw new InputError(
          `Resolution ${resolution.resolutionId} requires at least two parts.`,
        );
      }
      for (const [index, part] of resolution.splitParts.entries()) {
        const previous = resolution.splitParts[index - 1];
        if (
          part.start < reviewItem.interval.start ||
          part.end > reviewItem.interval.end ||
          (previous !== undefined && part.start < previous.end)
        ) {
          throw new InputError(
            `Resolution ${resolution.resolutionId} split parts leave or overlap the review interval.`,
          );
        }
      }
      break;
    case "MERGE_CUES":
      if (
        resolution.mergeCueIds.length < 2 ||
        !reviewItem.targetCueIds.every((cueId) =>
          resolution.mergeCueIds.includes(cueId),
        ) ||
        resolution.correctedText === null ||
        resolution.correctedText.trim() === ""
      ) {
        throw new InputError(
          `Resolution ${resolution.resolutionId} requires adjacent mergeCueIds and correctedText.`,
        );
      }
      break;
    case "DELETE_CUE":
      if (resolution.reviewerNotes === null) {
        throw new InputError(
          `Resolution ${resolution.resolutionId} requires reviewerNotes.`,
        );
      }
      break;
    case "KEEP":
    case "REJECT_SUGGESTION":
    case "MARK_UNRESOLVED":
      break;
  }
}

function deterministicCueId(input: unknown): string {
  return `cue-human-${sha256Value(input).slice(0, 20)}`;
}

function cueFromPart(
  source: SubtitleCue,
  part: { text: string; start: number; end: number },
  identity: unknown,
): SubtitleCue {
  return {
    ...source,
    id: deterministicCueId(identity),
    text: part.text,
    start: part.start,
    end: part.end,
  };
}

export function applyHumanReviewResolutions(input: {
  cues: readonly SubtitleCue[];
  subtitlePackage: SubtitlePackage;
  reviewPackage: SubtitleReviewPackage;
  resolutions: HumanReviewResolutions;
  currentSourceFingerprint: SourceFingerprint;
}): {
  cues: SubtitleCue[];
  humanDecisionCount: number;
  unresolvedCount: number;
  feedback: CorrectionFeedback;
} {
  const review = input.reviewPackage;
  const resolutions = humanReviewResolutionsSchema.parse(input.resolutions);
  const stale =
    resolutions.reviewVersion !== review.reviewVersion ||
    resolutions.inputEvidenceHash !== review.inputEvidenceHash ||
    resolutions.baseSubtitlePackageHash !== review.baseSubtitlePackageHash ||
    resolutions.baseCueHash !== review.baseCueHash ||
    !equalFingerprint(
      resolutions.sourceFingerprint,
      review.sourceFingerprint,
    ) ||
    !equalFingerprint(input.currentSourceFingerprint, review.sourceFingerprint);
  if (stale) {
    throw new InputError(
      "Human review resolutions are stale or target different evidence.",
    );
  }
  const byReviewId = new Map(review.items.map((item) => [item.reviewId, item]));
  const seenReviewIds = new Set<string>();
  for (const resolution of resolutions.resolutions) {
    if (seenReviewIds.has(resolution.reviewId)) {
      throw new InputError(`Duplicate resolution for ${resolution.reviewId}.`);
    }
    seenReviewIds.add(resolution.reviewId);
    const item = byReviewId.get(resolution.reviewId);
    if (item === undefined) {
      throw new InputError(`Unknown reviewId ${resolution.reviewId}.`);
    }
    validateResolutionPayload(resolution, item);
  }
  const cueOrder = new Map(input.cues.map((cue, index) => [cue.id, index]));
  const consumedCueIds = new Set<string>();
  const cues = [...input.cues];
  const feedbackRecords: CorrectionFeedback["records"] = [];
  for (const resolution of [...resolutions.resolutions].sort(
    (left, right) =>
      (cueOrder.get(byReviewId.get(left.reviewId)?.targetCueIds[0] ?? "") ??
        Number.MAX_SAFE_INTEGER) -
      (cueOrder.get(byReviewId.get(right.reviewId)?.targetCueIds[0] ?? "") ??
        Number.MAX_SAFE_INTEGER),
  )) {
    const item = byReviewId.get(resolution.reviewId);
    if (item === undefined || resolution.action === "MARK_UNRESOLVED") continue;
    const claimedCueIds = [
      ...new Set([
        ...item.targetCueIds,
        ...(resolution.action === "MERGE_CUES" ? resolution.mergeCueIds : []),
      ]),
    ];
    if (claimedCueIds.some((cueId) => consumedCueIds.has(cueId))) {
      throw new InputError(
        `Resolution ${resolution.resolutionId} conflicts with another cue action.`,
      );
    }
    for (const cueId of claimedCueIds) consumedCueIds.add(cueId);
    const targetIndex = cues.findIndex(
      (cue) => cue.id === item.targetCueIds[0],
    );
    const target = cues[targetIndex];
    if (target === undefined) {
      throw new InputError(
        `Target cue for ${resolution.resolutionId} no longer exists.`,
      );
    }
    let correctedText = target.text;
    const before = { text: target.text, start: target.start, end: target.end };
    switch (resolution.action) {
      case "KEEP":
      case "REJECT_SUGGESTION":
        break;
      case "ACCEPT_SUGGESTION": {
        const candidate = item.candidateSuggestions.find(
          (value) => value.candidateId === resolution.selectedCandidateId,
        );
        if (candidate === undefined)
          throw new Error("Validated candidate disappeared.");
        correctedText = candidate.candidateText;
        cues[targetIndex] = { ...target, text: correctedText };
        break;
      }
      case "EDIT_TEXT":
        correctedText = resolution.correctedText ?? target.text;
        cues[targetIndex] = { ...target, text: correctedText };
        break;
      case "EDIT_TIMING":
        cues[targetIndex] = {
          ...target,
          start: resolution.start ?? target.start,
          end: resolution.end ?? target.end,
        };
        break;
      case "SPLIT_CUE": {
        const replacements = resolution.splitParts.map((part, index) =>
          cueFromPart(target, part, {
            baseCueHash: review.baseCueHash,
            reviewId: item.reviewId,
            action: resolution.action,
            index,
          }),
        );
        correctedText = replacements.map((cue) => cue.text).join("\n");
        cues.splice(targetIndex, 1, ...replacements);
        consumedCueIds.add(target.id);
        break;
      }
      case "MERGE_CUES": {
        const indexes = resolution.mergeCueIds
          .map((cueId) => cues.findIndex((cue) => cue.id === cueId))
          .sort((left, right) => left - right);
        if (
          indexes.some((index) => index < 0) ||
          indexes.some((index, offset) =>
            offset === 0 ? false : index !== (indexes[0] ?? 0) + offset,
          )
        ) {
          throw new InputError(
            `Resolution ${resolution.resolutionId} merge cues are not adjacent.`,
          );
        }
        const firstIndex = indexes[0];
        const lastIndex = indexes.at(-1);
        if (firstIndex === undefined || lastIndex === undefined) break;
        const mergeCues = cues.slice(firstIndex, lastIndex + 1);
        const first = mergeCues[0];
        const last = mergeCues.at(-1);
        if (first === undefined || last === undefined) break;
        correctedText = resolution.correctedText ?? first.text;
        const merged: SubtitleCue = {
          ...first,
          id: deterministicCueId({
            baseCueHash: review.baseCueHash,
            reviewId: item.reviewId,
            action: resolution.action,
            cueIds: mergeCues.map((cue) => cue.id),
          }),
          text: correctedText,
          start: Math.min(...mergeCues.map((cue) => cue.start)),
          end: Math.max(...mergeCues.map((cue) => cue.end)),
        };
        cues.splice(firstIndex, mergeCues.length, merged);
        for (const cue of mergeCues) consumedCueIds.add(cue.id);
        break;
      }
      case "DELETE_CUE":
        cues.splice(targetIndex, 1);
        correctedText = "";
        consumedCueIds.add(target.id);
        break;
    }
    const after = cues.find((cue) => cue.id === target.id);
    const timingChanged =
      after === undefined
        ? true
        : after.start !== before.start || after.end !== before.end;
    const changed =
      !["KEEP", "REJECT_SUGGESTION"].includes(resolution.action) &&
      (correctedText !== before.text ||
        timingChanged ||
        ["SPLIT_CUE", "MERGE_CUES", "DELETE_CUE"].includes(resolution.action));
    if (changed) {
      const selectedCandidate = item.candidateSuggestions.find(
        (candidate) => candidate.candidateId === resolution.selectedCandidateId,
      );
      feedbackRecords.push({
        feedbackId: `feedback-${sha256Value({
          source: review.sourceFingerprint.sha256,
          resolution,
        }).slice(0, 24)}`,
        mediaIdentity: input.subtitlePackage.identity,
        audioInterval: item.interval,
        sceneLabel: null,
        speaker: target.speaker,
        machineText: before.text,
        correctedText,
        machineDecision: item.machineDecision,
        selectedCandidate: selectedCandidate ?? null,
        alternativeCandidates: item.candidateSuggestions.filter(
          (candidate) =>
            candidate.candidateId !== selectedCandidate?.candidateId,
        ),
        errorTypes: resolution.errorTypes,
        confirmedReading: resolution.confirmedReading,
        terminologyHints: resolution.terminologyHints,
        dialectHints: resolution.dialectHints,
        sourceEvidenceIds: [
          ...new Set(
            item.candidateSuggestions.flatMap(
              (candidate) => candidate.sourceEvidenceIds,
            ),
          ),
        ].sort((left, right) => left.localeCompare(right)),
        reviewerNotes: resolution.reviewerNotes,
      });
    }
  }
  const unresolvedCount = review.items.filter((item) => {
    const resolution = resolutions.resolutions.find(
      (value) => value.reviewId === item.reviewId,
    );
    return resolution === undefined || resolution.action === "MARK_UNRESOLVED";
  }).length;
  return {
    cues,
    humanDecisionCount: resolutions.resolutions.length,
    unresolvedCount,
    feedback: correctionFeedbackSchema.parse({
      schemaVersion: "1.0.0",
      feedbackType: "subtitle-correction-feedback",
      sourceFingerprintHash: sha256Value(review.sourceFingerprint),
      records: feedbackRecords.sort((left, right) =>
        left.feedbackId.localeCompare(right.feedbackId),
      ),
    }),
  };
}

export async function loadReviewPackage(
  subtitleDirectory: string,
): Promise<SubtitleReviewPackage> {
  const value = JSON.parse(
    await readFile(
      path.join(subtitleDirectory, "subtitle-review-package.json"),
      "utf8",
    ),
  ) as unknown;
  return subtitleReviewPackageSchema.parse(value);
}

export async function loadHumanReviewResolutions(
  filePath: string,
): Promise<HumanReviewResolutions> {
  const value = JSON.parse(
    await readFile(path.resolve(filePath), "utf8"),
  ) as unknown;
  if (!isRecord(value))
    throw new InputError("Resolution file must contain an object.");
  return humanReviewResolutionsSchema.parse(value);
}
