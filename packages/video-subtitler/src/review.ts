import { readFile } from "node:fs/promises";
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
  type HumanReviewResolutions,
  type ProcessRunner,
  type SourceFingerprint,
  type SubtitleCue,
  type SubtitleCanonicalForcedAlignment,
  type SubtitleOverlapAcousticResolution,
  type SubtitlePackage,
  type SubtitleReviewPackage,
} from "@mvl/shared";

import {
  isRecord,
  sha256Value,
  stableStringify,
} from "./finalization-support.js";
import { resolveReviewAudio } from "./review-audio.js";
import {
  REVIEW_ACTION_POLICY_HASH,
  REVIEW_ACTION_POLICY_VERSION,
  REVIEW_ACTION_REGISTRY,
  assertReviewActionPayload,
  bindReviewCandidates,
  candidateBindingDescriptors,
  portableValidateReviewAction,
} from "./review-action-validation.js";

export { reviewAudioBounds } from "./review-audio.js";

const HUMAN_ACTIONS = REVIEW_ACTION_REGISTRY.map((entry) => entry.action);

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
function reviewCss(): string {
  return `:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0b0d10;color:#edf2f7}*{box-sizing:border-box}body{margin:0;background:#0b0d10}header{position:sticky;top:0;background:#11161dcc;padding:.8rem 1rem;z-index:3;border-bottom:1px solid #334155;backdrop-filter:blur(12px);display:flex;align-items:center;gap:.55rem;flex-wrap:wrap}main{max-width:1180px;margin:auto;padding:1rem}.item{border:1px solid #334155;border-radius:14px;padding:1rem;margin:1rem 0;background:#11161d}.grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.label{font-size:.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}.text{white-space:pre-wrap;font-size:1.12rem}.blocker,.error{color:#fca5a5}.ok{color:#86efac}.warning{color:#fde68a}.actions,.play-actions{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.8rem}button{padding:.5rem .72rem;border-radius:8px;border:1px solid #475569;background:#1e293b;color:inherit;cursor:pointer}button:hover{background:#334155}audio{width:100%;margin:.7rem 0}.meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.45rem}.meta>div{padding:.55rem;background:#17202b;border-radius:8px;overflow-wrap:anywhere}.timeline{margin-top:1rem;border:1px solid #334155;border-radius:10px;padding:.75rem}.scope{margin:.8rem 0 .3rem;color:#cbd5e1;font-weight:650}.track{display:grid;grid-template-columns:190px 1fr;gap:.65rem;align-items:center;margin:.35rem 0}.track-label{font-size:.74rem;overflow-wrap:anywhere}.rail{height:22px;position:relative;background:#0f172a;border-radius:5px;overflow:hidden}.bar{position:absolute;top:3px;height:16px;min-width:2px;border-radius:4px;background:#38bdf8}.bar.component{background:#a78bfa}.bar.unusable{background:#64748b}.evidence-detail{font:12px ui-monospace,SFMono-Regular,monospace;color:#cbd5e1;white-space:pre-wrap;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}.disclaimer{border-left:3px solid #f59e0b;padding:.65rem;background:#2a2112}.statusline{font-size:.85rem;color:#cbd5e1}@media(max-width:760px){.grid,.meta{grid-template-columns:1fr}.track{grid-template-columns:1fr}main{padding:.5rem}.item{border-radius:0;margin:.5rem 0}}`;
}

function hardenedReviewJavascript(timelineEnabled: boolean): string {
  return String.raw`const timelineEnabled=${String(timelineEnabled)};
const REVIEW_ACTION_REGISTRY=${JSON.stringify(REVIEW_ACTION_REGISTRY)};
const validateReviewActionPayload=${portableValidateReviewAction.toString()};
const state={data:null,index:0,resolutions:new Map(),quarantinedLocalResolutions:[],validationEvents:[],downloadBlockedCount:0,loop:false,loopStart:null,stopAt:null};
const q=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function baseResolution(item,action){return{resolutionId:'resolution-'+item.reviewId,reviewId:item.reviewId,action,selectedCandidateId:null,selectedCandidateEvidenceHash:null,correctedText:null,start:null,end:null,splitParts:[],mergeCueIds:[],reviewerNotes:null,errorTypes:[],confirmedReading:null,terminologyHints:[],dialectHints:[]}}
function bindingFor(item,candidateId){return(item.candidateActionBindings??[]).find(binding=>binding.candidateId===candidateId&&binding.reviewId===item.reviewId&&binding.status==='active')??null}
function showValidation(errors,source){const safe=errors.map(error=>({at:new Date().toISOString(),source,code:error.code,reviewId:error.reviewId,action:error.action,field:error.field,message:error.message}));state.validationEvents.push(...safe);const last=safe[0];const el=q('#validation-status');if(el){el.textContent=last?last.code+' · '+(last.reviewId??'unknown')+' · '+(last.field??'payload'):'Validation passed.';el.className=last?'error':'ok'}}
function buildResolution(item,action){const base=baseResolution(item,action);if(action==='ACCEPT_SUGGESTION'){base.selectedCandidateId=item.machineDecision.selectedCandidateId;const binding=bindingFor(item,base.selectedCandidateId);base.selectedCandidateEvidenceHash=binding?.candidateEvidenceHash??null}if(action==='REJECT_SUGGESTION'){const chosen=prompt('Candidate ID to reject',item.machineDecision.selectedCandidateId??'');if(chosen===null)return null;base.selectedCandidateId=chosen.trim()||null;const binding=bindingFor(item,base.selectedCandidateId);base.selectedCandidateEvidenceHash=binding?.candidateEvidenceHash??null}if(action==='EDIT_TEXT'){const value=prompt('Corrected text',item.currentText);if(value===null)return null;base.correctedText=value}if(action==='EDIT_TIMING'){const start=prompt('Start',item.currentStart);const end=prompt('End',item.currentEnd);if(start===null||end===null)return null;base.start=Number(start);base.end=Number(end)}if(action==='DELETE_CUE'){const notes=prompt('Deletion reason (required)');if(notes===null)return null;base.reviewerNotes=notes}if(action==='SPLIT_CUE'){const raw=prompt('Parts as JSON [{"text":"...","start":0,"end":1}]');if(raw===null)return null;try{base.splitParts=JSON.parse(raw)}catch{showValidation([{code:'REVIEW_ACTION_SCHEMA_INVALID',reviewId:item.reviewId,action,field:'splitParts',message:'Invalid JSON.'}],'input');return null}}if(action==='MERGE_CUES'){const ids=prompt('Adjacent component cue IDs, comma separated',item.targetCueIds.join(','));const text=prompt('Merged text',item.currentText);if(ids===null||text===null)return null;base.mergeCueIds=ids.split(',').map(value=>value.trim()).filter(Boolean);base.correctedText=text}return base}
function validateForItem(item,resolution){return validateReviewActionPayload(REVIEW_ACTION_REGISTRY,item,resolution,state.data.reviewVersion)}
function storageKey(){return'mvl-review-resolutions:'+state.data.reviewVersion}
function saveValidatedState(){const errors=[];for(const resolution of state.resolutions.values()){const item=state.data.items.find(value=>value.reviewId===resolution.reviewId);if(!item){errors.push({code:'UNKNOWN_REVIEW_ITEM',reviewId:resolution.reviewId,action:resolution.action,field:'reviewId',message:'Unknown review item.'});continue}const validation=validateForItem(item,resolution);if(!validation.valid)errors.push(...validation.errors)}if(errors.length){showValidation(errors,'autosave');return false}localStorage.setItem(storageKey(),JSON.stringify([...state.resolutions.values()]));return true}
function commitResolution(item,resolution,source){const validation=validateForItem(item,resolution);if(!validation.valid){showValidation(validation.errors,source);return false}state.resolutions.set(item.reviewId,resolution);if(!saveValidatedState()){state.resolutions.delete(item.reviewId);return false}showValidation([],source);render();return true}
function executeAction(item,action,source){const resolution=buildResolution(item,action);if(resolution===null)return false;return commitResolution(item,resolution,source)}
function restoreSavedState(){const raw=localStorage.getItem(storageKey());if(raw===null)return;let saved;try{saved=JSON.parse(raw)}catch{saved=[];showValidation([{code:'INVALID_SAVED_REVIEW_ACTION',reviewId:null,action:null,field:'localStorage',message:'Saved review state is not valid JSON.'}],'localStorage')}if(!Array.isArray(saved))saved=[];for(const resolution of saved){const item=state.data.items.find(value=>value.reviewId===resolution?.reviewId);const validation=item?validateForItem(item,resolution):{valid:false,errors:[{code:'UNKNOWN_REVIEW_ITEM',reviewId:resolution?.reviewId??null,action:resolution?.action??null,field:'reviewId',message:'Saved resolution targets an unknown item.'}]};if(validation.valid){state.resolutions.set(item.reviewId,resolution)}else{state.quarantinedLocalResolutions.push(resolution);showValidation(validation.errors.map(error=>({...error,code:'INVALID_SAVED_REVIEW_ACTION'})),'localStorage')}}saveValidatedState()}
function packageIdentityValid(value){return value&&value.reviewVersion===state.data.reviewVersion&&value.baseSubtitlePackageHash===state.data.baseSubtitlePackageHash&&value.baseCueHash===state.data.baseCueHash&&value.inputEvidenceHash===state.data.inputEvidenceHash}
function importResolutions(value){if(!packageIdentityValid(value)||!Array.isArray(value.resolutions)){showValidation([{code:'IMPORTED_REVIEW_PACKAGE_STALE',reviewId:null,action:null,field:'reviewVersion',message:'Imported resolutions do not match this review package.'}],'import');return}for(const resolution of value.resolutions){const item=state.data.items.find(entry=>entry.reviewId===resolution?.reviewId);const validation=item?validateForItem(item,resolution):{valid:false,errors:[{code:'UNKNOWN_REVIEW_ITEM',reviewId:resolution?.reviewId??null,action:resolution?.action??null,field:'reviewId',message:'Imported resolution targets an unknown item.'}]};if(validation.valid)state.resolutions.set(item.reviewId,resolution);else{state.quarantinedLocalResolutions.push(resolution);showValidation(validation.errors,'import')}}saveValidatedState();render()}
function preflight(){const errors=[];for(const resolution of state.resolutions.values()){const item=state.data.items.find(value=>value.reviewId===resolution.reviewId);if(!item){errors.push({code:'UNKNOWN_REVIEW_ITEM',reviewId:resolution.reviewId,action:resolution.action,field:'reviewId',message:'Unknown review item.'});continue}const validation=validateForItem(item,resolution);if(!validation.valid)errors.push(...validation.errors)}return{valid:errors.length===0,errors}}
function previewResolution(item){const resolution=state.resolutions.get(item.reviewId);if(!resolution){showValidation([{code:'NO_RESOLUTION_TO_PREVIEW',reviewId:item.reviewId,action:null,field:'resolution',message:'Choose an action before previewing.'}],'preview');return}const validation=validateForItem(item,resolution);if(!validation.valid){showValidation(validation.errors,'preview');return}q('#resolution-preview').textContent=JSON.stringify(resolution,null,2)}
function bulkApply(action){const pending=state.data.items.filter(item=>!state.resolutions.has(item.reviewId));const prepared=pending.map(item=>({item,resolution:baseResolution(item,action)}));const errors=prepared.flatMap(({item,resolution})=>validateForItem(item,resolution).errors);if(errors.length){showValidation(errors,'bulk');return}for(const{item,resolution}of prepared)state.resolutions.set(item.reviewId,resolution);saveValidatedState();render()}
function localTime(media,item){return Math.max(0,media-(item.audioExtractedInterval?.start??0))}
function playRange(item,start,end){const audio=q('#review-audio');if(!audio){showAudioError('audio file is not available');return}state.loopStart=localTime(start,item);state.stopAt=localTime(end,item);audio.currentTime=state.loopStart;audio.play().catch(error=>showAudioError(error.message))}
function showAudioError(message){const element=q('#audio-error');if(element){element.textContent='AUDIO_PLAYBACK_ERROR: '+message;element.className='error'}}
function trackHtml(item,e,component){const names={'source-cue-prior':'Human Original Timing','mfa-narrow':'MFA Narrow','mfa-expanded':'MFA Expanded','forced-alignment-selected':'Forced Alignment Selected','evidence-dp':'Evidence-DP','trusted-mapped-token':'Mapped Token','trusted-no-vad-token':'Mapped Token (no-VAD)','decoded-segment':'Decoded Segment','raw-vad':'Raw VAD','pause':'Pause','component-union':'Component Union','audio-extraction-window':'Audio Extraction Window'};const window=item.audioExtractedInterval??item.audioRequestedInterval??item.interval;const span=Math.max(.001,window.end-window.start);const left=Math.max(0,Math.min(100,100*(e.interval.start-window.start)/span));const width=Math.max(.2,Math.min(100-left,100*(e.interval.end-e.interval.start)/span));const cls=(component?' component':'')+(e.timingUsable?'':' unusable');const label=(names[e.sourceType]??e.sourceType)+' · '+e.scope;const detail=e.interval.start.toFixed(3)+' → '+e.interval.end.toFixed(3)+' | trust '+String(e.trustScore??'n/a')+' | '+e.evidenceId+(e.blockers?.length?' | '+e.blockers.join(', '):'');return '<div class="track"><button class="track-label" data-evidence-start="'+e.interval.start+'" data-evidence-end="'+e.interval.end+'">'+esc(label)+'</button><div><div class="rail"><span class="bar'+cls+'" style="left:'+left+'%;width:'+width+'%"></span></div><div class="evidence-detail">'+esc(detail)+'</div></div></div>'}
function shortcutHints(item){return REVIEW_ACTION_REGISTRY.filter(entry=>entry.shortcut&&item.allowedHumanActions.includes(entry.action)).map(entry=>entry.shortcut.toUpperCase()+' '+entry.label).join(', ')}
function render(){const item=state.data.items[state.index];q('#position').textContent=(state.index+1)+' / '+state.data.items.length;if(!item){q('#items').innerHTML='<p>No review items.</p>';return}q('#shortcut-hints').textContent=shortcutHints(item);q('#quarantine-status').textContent=state.quarantinedLocalResolutions.length?'Quarantined saved actions: '+state.quarantinedLocalResolutions.length:'';const suggestions=esc(JSON.stringify(item.candidateSuggestions.map(candidate=>({id:candidate.candidateId,coverage:candidate.coverageMetrics,evidence:candidate.sourceEvidenceIds})),null,2));const union=item.componentUnionInterval??item.interval;const cueEvidence=item.boundaryEvidence??[];const componentEvidence=[...(item.componentRawVadIntervals??[]),...(item.componentDecodedSegments??[]),...(item.componentMappedTokenEvidence??[]),...(item.componentPauseEvidence??[])].filter(evidence=>evidence.scope!=='cue');const packageTracks=[{sourceType:'component-union',scope:'component',interval:union,timingUsable:true,trustScore:1,evidenceId:'review-package:component-union',blockers:[]},...(item.audioExtractedInterval?[{sourceType:'audio-extraction-window',scope:'component',interval:item.audioExtractedInterval,timingUsable:item.audioValidationStatus==='validated',trustScore:null,evidenceId:'review-package:audio-extraction-window',blockers:item.audioError?[item.audioError]:[]}]:[])];const unresolved=item.unresolvedEvidenceReferences??[];const timeline=timelineEnabled?'<section class="timeline"><div class="scope">Cue-specific evidence tracks</div>'+cueEvidence.map(evidence=>trackHtml(item,evidence,false)).join('')+'<div class="scope">Component acoustic tracks</div>'+packageTracks.concat(componentEvidence).map(evidence=>trackHtml(item,evidence,true)).join('')+(unresolved.length?'<p class="error">EVIDENCE_REFERENCE_UNRESOLVED: '+esc(unresolved.join(', '))+'</p>':'')+'</section>':'';const forced=item.forcedAlignmentEvidence?'<section class="forced"><div class="label">Forced-alignment decision context</div><pre>'+esc(JSON.stringify(item.forcedAlignmentEvidence,null,2))+'</pre></section>':'';const audio=item.audioClipPath?'<audio id="review-audio" controls preload="metadata" src="'+esc(item.audioClipPath)+'"></audio>':'';const cueLoops=(item.forcedAlignmentEvidence?.cues??[]).map(cue=>'<button data-loop-start="'+cue.originalTiming.start+'" data-loop-end="'+cue.originalTiming.end+'">Loop cue '+esc(cue.cueId)+'</button>').join('');const audioActions='<div class="play-actions"><button data-loop-start="'+union.start+'" data-loop-end="'+union.end+'">Loop component</button>'+cueLoops+'</div>';const buttons=item.allowedHumanActions.map(action=>'<button data-action="'+action+'">'+esc(REVIEW_ACTION_REGISTRY.find(entry=>entry.action===action)?.label??action)+'</button>').join('');const meta='<div class="meta"><div><span class="label">Audio source</span><br>'+esc(item.audioSource)+'</div><div><span class="label">Validation</span><br>'+esc(item.audioValidationStatus)+'</div><div><span class="label">SHA-256</span><br>'+esc(item.audioSha256??'none')+'</div><div><span class="label">Coverage</span><br>'+esc(String(item.audioFullyCoversComponent))+'</div><div><span class="label">Mapped token</span><br>'+cueEvidence.filter(evidence=>evidence.sourceType==='trusted-mapped-token'||evidence.sourceType==='trusted-no-vad-token').length+'</div><div><span class="label">Raw VAD islands</span><br>'+(item.componentRawVadIntervals??[]).length+'</div><div><span class="label">Decoded segments</span><br>'+(item.componentDecodedSegments??[]).length+'</div><div><span class="label">Evidence status</span><br>'+esc(item.evidenceSourceResolutionStatus)+'</div></div>';q('#items').innerHTML='<article class="item"><div class="grid"><section><div class="label">Current subtitle / human timing</div><div class="text">'+esc(item.currentText)+'</div><p>'+union.start.toFixed(3)+' → '+union.end.toFixed(3)+'</p></section><section><div class="label">Machine recommendation</div><div class="text">'+esc(item.machineDecision.proposedText??'KEEP')+'</div><p>'+esc(item.candidateSuggestions[0]?.associationType??'none')+'</p></section><section><div class="label">Previous</div><div>'+esc(item.previousCue?.text??'—')+'</div><div class="label">Next</div><div>'+esc(item.nextCue?.text??'—')+'</div></section><section><div class="label">Candidate evidence</div><pre>'+suggestions+'</pre></section></div><div class="disclaimer">MFA boundaries are machine evidence, not confirmed ground truth.<br>Mapped Token and Raw VAD are timing evidence only and do not identify the speaker.<br>Component-level Raw VAD intervals do not prove which cue or speaker produced the speech.</div>'+meta+'<div id="audio-error" class="statusline">'+esc(item.audioError??'Audio metadata and coverage validated.')+'</div>'+audio+audioActions+timeline+forced+'<div class="label blocker">Review blockers</div><div class="blocker">'+esc(item.blockers.join(', ')||'none')+'</div><div class="actions">'+buttons+'<button id="preview-resolution">Preview resolution</button></div><p>Selected: '+esc(state.resolutions.get(item.reviewId)?.action??'none')+'</p><pre id="resolution-preview"></pre></article>';document.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>executeAction(item,button.dataset.action,'button'));q('#preview-resolution').onclick=()=>previewResolution(item);document.querySelectorAll('[data-loop-start]').forEach(button=>button.onclick=()=>playRange(item,Number(button.dataset.loopStart),Number(button.dataset.loopEnd)));document.querySelectorAll('[data-evidence-start]').forEach(button=>button.onclick=()=>playRange(item,Number(button.dataset.evidenceStart),Number(button.dataset.evidenceEnd)));const audioElement=q('#review-audio');if(audioElement){audioElement.addEventListener('error',()=>showAudioError('file missing, unreadable, or unsupported'));audioElement.addEventListener('timeupdate',()=>{if(state.stopAt!==null&&audioElement.currentTime>=state.stopAt){if(state.loop){audioElement.currentTime=state.loopStart??0;audioElement.play().catch(error=>showAudioError(error.message))}else{audioElement.pause();state.loopStart=null;state.stopAt=null}}})}}
function move(delta){if(!state.data.items.length)return;state.index=(state.index+delta+state.data.items.length)%state.data.items.length;state.loopStart=null;state.stopAt=null;render()}
function download(){const check=preflight();if(!check.valid){state.downloadBlockedCount+=1;showValidation(check.errors,'download-preflight');const first=check.errors[0];const index=state.data.items.findIndex(item=>item.reviewId===first?.reviewId);if(index>=0){state.index=index;render();q('#items').scrollIntoView({behavior:'smooth',block:'start'})}return}const data=state.data;const body={schemaVersion:'1.0.0',resolutionType:'human-review-resolutions',reviewVersion:data.reviewVersion,sourceFingerprint:data.sourceFingerprint,baseSubtitlePackageHash:data.baseSubtitlePackageHash,baseCueHash:data.baseCueHash,inputEvidenceHash:data.inputEvidenceHash,resolutions:[...state.resolutions.values()].sort((left,right)=>left.reviewId.localeCompare(right.reviewId))};const anchor=document.createElement('a');anchor.href=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)+'\n'],{type:'application/json'}));anchor.download='human-review-resolutions.json';anchor.click();URL.revokeObjectURL(anchor.href)}
q('#previous').onclick=()=>move(-1);q('#next').onclick=()=>move(1);q('#download').onclick=download;q('#bulk-keep').onclick=()=>bulkApply('KEEP');q('#import-resolutions').onchange=event=>{const file=event.target.files?.[0];if(!file)return;file.text().then(text=>{try{importResolutions(JSON.parse(text))}catch(error){showValidation([{code:'IMPORTED_REVIEW_JSON_INVALID',reviewId:null,action:null,field:'file',message:error.message}],'import')}})};
document.addEventListener('keydown',event=>{if(event.target.matches('input,textarea'))return;if(event.key==='ArrowLeft')move(-1);if(event.key==='ArrowRight')move(1);const item=state.data.items[state.index];if(!item)return;const entry=REVIEW_ACTION_REGISTRY.find(value=>value.shortcut===event.key.toLowerCase());if(entry)executeAction(item,entry.action,'keyboard');if(event.key===' '){event.preventDefault();const audio=q('#review-audio');if(audio){if(audio.paused)audio.play();else audio.pause()}}if(event.key.toLowerCase()==='l'){state.loop=!state.loop;q('#loop-status').textContent=state.loop?'loop on':'loop off'}});
fetch('./data/subtitle-review-package.json').then(response=>response.json()).then(data=>{state.data=data;restoreSavedState();render()}).catch(error=>q('#items').textContent=error.message);`;
}

function reviewHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Subtitle evidence review</title><link rel="stylesheet" href="./assets/review.css"></head><body><header><strong>Subtitle evidence review</strong><span id="position"></span><button id="previous">Previous</button><button id="next">Next</button><button id="bulk-keep">Keep all unreviewed</button><label>Import resolutions <input id="import-resolutions" type="file" accept="application/json"></label><button id="download">Download resolutions</button><small>Keys: space play, L loop, ←/→ navigate · <span id="shortcut-hints"></span> · <span id="loop-status">loop off</span></small><span id="validation-status" class="statusline"></span><span id="quarantine-status" class="warning"></span></header><main id="items">Loading…</main><script type="module" src="./assets/review.js"></script></body></html>`;
}

export async function writeSubtitleReviewPage(input: {
  subtitleDirectory: string;
  reviewPackage: SubtitleReviewPackage;
  timelineEnabled?: boolean;
}): Promise<string> {
  const reviewDirectory = path.join(input.subtitleDirectory, "review");
  const pagePath = path.join(reviewDirectory, "index.html");
  await Promise.all([
    atomicWriteJson(
      path.join(reviewDirectory, "data", "subtitle-review-package.json"),
      input.reviewPackage,
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
      hardenedReviewJavascript(input.timelineEnabled ?? true),
      {
        overwrite: true,
      },
    ),
  ]);
  return pagePath;
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
  forcedAlignment?: SubtitleCanonicalForcedAlignment;
  overlapAcoustic?: SubtitleOverlapAcousticResolution;
  sourceSubtitleDirectory?: string;
  reviewAudioMode?: "auto" | "generate" | "reuse-only" | "off";
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
  const forcedAttemptById = new Map(
    input.forcedAlignment?.attempts.map((attempt) => [
      attempt.attemptId,
      attempt,
    ]) ?? [],
  );
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
    const relatedFindings = input.findings.filter((item) =>
      item.cueIds.some((cueId) => decision.targetCueIds.includes(cueId)),
    );
    const forcedAlignment = input.forcedAlignment;
    const forcedComponent = forcedAlignment?.components.find((component) =>
      component.cueIds.some((cueId) => decision.targetCueIds.includes(cueId)),
    );
    const overlapComponent = input.overlapAcoustic?.components.find(
      (component) =>
        component.cueIds.some((cueId) => decision.targetCueIds.includes(cueId)),
    );
    const componentId =
      forcedComponent?.componentId ??
      overlapComponent?.componentId ??
      `review-component-${reviewId}`;
    const audio = await resolveReviewAudio({
      mode: input.reviewAudioMode ?? (input.generateAudio ? "auto" : "off"),
      reviewId,
      componentId,
      componentUnionInterval: interval,
      mediaDurationSeconds: input.subtitlePackage.source.durationSeconds,
      targetSubtitleDirectory: input.subtitleDirectory,
      ...(input.sourceSubtitleDirectory === undefined
        ? {}
        : { sourceSubtitleDirectory: input.sourceSubtitleDirectory }),
      sourceVideoPath: input.sourceVideoPath,
      ...(input.overlapAcoustic === undefined
        ? {}
        : { overlapArtifact: input.overlapAcoustic }),
      runner: input.runner,
      ffmpegPath: input.ffmpegPath,
      ...(input.audioStreamIndex === undefined
        ? {}
        : { audioStreamIndex: input.audioStreamIndex }),
      contextSeconds: input.contextSeconds ?? 1.5,
      maximumSeconds: input.maximumClipSeconds ?? 30,
    });
    const forcedAlignmentEvidence =
      forcedComponent === undefined || forcedAlignment === undefined
        ? undefined
        : {
            disclaimer:
              "MFA boundaries are machine evidence, not confirmed ground truth." as const,
            componentId: forcedComponent.componentId,
            cues: forcedComponent.cueAlignments.map((alignment) => {
              const canonical = forcedAlignment.cueAlignments.find(
                (item) => item.cueId === alignment.cueId,
              );
              if (canonical === undefined) {
                throw new InputError(
                  `Missing forced-alignment cue ${alignment.cueId}.`,
                );
              }
              const original = forcedAlignment.components
                .flatMap((component) => component.proposedMutations)
                .find((mutation) => mutation.cueId === alignment.cueId);
              const narrow =
                alignment.narrowAttemptId === null
                  ? undefined
                  : forcedAttemptById.get(alignment.narrowAttemptId);
              const expanded =
                alignment.expandedAttemptId === null
                  ? undefined
                  : forcedAttemptById.get(alignment.expandedAttemptId);
              const boundary = (attempt: typeof narrow) =>
                attempt?.boundaryStart === null ||
                attempt?.boundaryStart === undefined ||
                attempt.boundaryEnd === null
                  ? null
                  : {
                      start: attempt.boundaryStart,
                      end: attempt.boundaryEnd,
                    };
              const targetCue = input.cues.find(
                (cue) => cue.id === alignment.cueId,
              );
              return {
                cueId: alignment.cueId,
                canonicalText: alignment.canonicalText,
                alignmentText: alignment.alignmentText,
                normalizedReading: alignment.normalizedReading,
                unresolvedOov: alignment.unresolvedOov,
                originalTiming:
                  original === undefined
                    ? {
                        start: targetCue?.start ?? 0,
                        end: targetCue?.end ?? 0.001,
                      }
                    : {
                        start: original.beforeStart,
                        end: original.beforeEnd,
                      },
                suggestedTiming: alignment.selectedBoundary,
                mfaNarrowBoundary: boundary(narrow),
                mfaExpandedBoundary: boundary(expanded),
                evidenceDpBoundary:
                  canonical.evidenceDp.startBoundary === null ||
                  canonical.evidenceDp.endBoundary === null
                    ? null
                    : {
                        start: canonical.evidenceDp.startBoundary,
                        end: canonical.evidenceDp.endBoundary,
                      },
                mappedTokenBoundary: null,
                rawVadBoundary: null,
                windowStabilityScore:
                  alignment.antiForcingMetrics.windowStabilityScore,
                wordCoverageRatio:
                  alignment.antiForcingMetrics.wordCoverageRatio,
                phoneCoverageRatio:
                  alignment.antiForcingMetrics.phoneCoverageRatio,
                readingCoverageRatio:
                  alignment.antiForcingMetrics.readingCoverageRatio,
                antiForcingBlockers: alignment.blockers,
              };
            }),
            bestHypothesis: forcedComponent.bestHypothesis.relationship,
            runnerUpHypothesis: forcedComponent.runnerUpHypothesis.relationship,
            decisionMargin: forcedComponent.decisionMargin,
            duplicateOccurrenceConflictCount:
              forcedComponent.duplicateOccurrenceConflicts.length,
            blocking: forcedComponent.blocking,
          };
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
      candidateActionBindings: [],
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
      audioSource: audio.source,
      audioValidationStatus: audio.validationStatus,
      audioSourceArtifact: audio.sourceArtifact,
      audioSourceAudioPath: audio.sourceAudioPath,
      audioSourceComponentId: audio.sourceComponentId,
      audioSourceEvidenceLineageIds: audio.sourceEvidenceLineageIds,
      audioHandoffMethod: audio.handoffMethod,
      componentUnionInterval: interval,
      audioRequestedInterval: audio.requestedInterval,
      audioExtractedInterval: audio.extractedInterval,
      audioDurationSeconds: audio.durationSeconds,
      audioActualDurationSeconds: audio.actualDurationSeconds,
      audioSampleRate: audio.sampleRate,
      audioChannelCount: audio.channelCount,
      audioBitsPerSample: audio.bitsPerSample,
      audioFrameCount: audio.frameCount,
      audioInspectionMethod: audio.inspectionMethod,
      audioSha256: audio.sha256,
      audioContextSeconds: input.contextSeconds ?? 1.5,
      audioContextBeforeSeconds: audio.contextBeforeSeconds,
      audioContextAfterSeconds: audio.contextAfterSeconds,
      audioFullyCoversComponent: audio.fullyCoversComponent,
      boundaryEvidence: [],
      componentRawVadIntervals: [],
      componentDecodedSegments: [],
      componentMappedTokenEvidence: [],
      componentPauseEvidence: [],
      evidenceReconciliationHash: null,
      evidenceSourceResolutionStatus: "legacy",
      unresolvedEvidenceReferences: [],
      ...(forcedAlignmentEvidence === undefined
        ? {}
        : { forcedAlignmentEvidence }),
      requiresHumanReview: true,
    });
  }
  const bindingDescriptors = candidateBindingDescriptors({
    items,
    inputEvidenceHash: input.inputEvidenceHash,
  });
  const reviewVersion = `review-v3-${sha256Value({
    baseSubtitlePackageHash: input.baseSubtitlePackageHash,
    baseCueHash: input.baseCueHash,
    inputEvidenceHash: input.inputEvidenceHash,
    reviewActionPolicyVersion: REVIEW_ACTION_POLICY_VERSION,
    reviewActionPolicyHash: REVIEW_ACTION_POLICY_HASH,
    candidateBindingDescriptors: bindingDescriptors,
    items: items.map((item) => ({
      reviewId: item.reviewId,
      targetCueIds: item.targetCueIds,
      componentUnionInterval: item.componentUnionInterval ?? item.interval,
      audioRequestedInterval: item.audioRequestedInterval,
      audioClipPath: item.audioClipPath,
      audioSha256: item.audioSha256,
      audioSource: item.audioSource,
      audioExtractedInterval: item.audioExtractedInterval,
      audioFullyCoversComponent: item.audioFullyCoversComponent,
      audioValidationStatus: item.audioValidationStatus,
      forcedAlignmentEvidence: item.forcedAlignmentEvidence ?? null,
    })),
  }).slice(0, 24)}`;
  const boundItems = bindReviewCandidates({
    items,
    inputEvidenceHash: input.inputEvidenceHash,
    reviewVersion,
  });
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
    reviewActionPolicyVersion: REVIEW_ACTION_POLICY_VERSION,
    items: boundItems,
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
      audioPhysicalFileCount: items.filter(
        (item) => item.audioValidationStatus === "validated",
      ).length,
      audioReferencedCount: items.filter((item) => item.audioClipPath !== null)
        .length,
      audioPlayableCount: items.filter(
        (item) =>
          item.audioClipPath !== null &&
          item.audioValidationStatus === "validated" &&
          item.audioFullyCoversComponent,
      ).length,
      audioReusedExistingCount: items.filter((item) =>
        [
          "reused-existing-review-audio",
          "inherited-verified-review-audio",
        ].includes(item.audioSource),
      ).length,
      audioReusedOverlapCount: items.filter(
        (item) => item.audioSource === "reused-overlap-audio",
      ).length,
      audioGeneratedCount: items.filter(
        (item) => item.audioSource === "generated-from-source-video",
      ).length,
      audioHashMismatchCount: items.filter(
        (item) => item.audioValidationStatus === "hash-mismatch",
      ).length,
      audioMetadataFailureCount: items.filter((item) =>
        ["invalid-wav"].includes(item.audioValidationStatus),
      ).length,
    },
  });
  const packagePath = path.join(
    input.subtitleDirectory,
    "subtitle-review-package.json",
  );
  await atomicWriteJson(packagePath, reviewPackage, { overwrite: true });
  const pagePath = await writeSubtitleReviewPage({
    subtitleDirectory: input.subtitleDirectory,
    reviewPackage,
  });
  return { reviewPackage, packagePath, pagePath };
}

function equalFingerprint(
  left: SourceFingerprint,
  right: SourceFingerprint,
): boolean {
  return stableStringify(left) === stableStringify(right);
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
    assertReviewActionPayload({
      item,
      resolution,
      reviewVersion: review.reviewVersion,
    });
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
