/** Review-only additive evidence. Copying a candidate never saves a decision. */
export function c601141WorkspaceJavascript(): string {
  return String.raw`
v14.budget='FULL_QUEUE_WITH_SAFETY_RESERVE';
const inventory141Data=()=>state.data?.speechInventoryReviewV1;
const inventory141OldRender=render;
render=function(){inventory141OldRender();const data=inventory141Data(),item=state.filtered[state.index];if(!data||!item)return;
document.title='C6.0.1.14.1 Speech Inventory Review';document.querySelector('header strong').textContent='C6.0.1.14.1 Speech Inventory';
byId('identity').textContent='C6.0.1.14.1 evidence · C6.0.1.12 transactions · frozen R3 + non-mandatory safety layer';
const detail=data.items.items.find(x=>x.reviewItemId===item.reviewItemId);const card=document.createElement('section');card.className='card inventory-evidence-v1';
card.append(text('h2','Multi-view speech inventory evidence'),text('p','Speech presence is not transcript truth. New targets are RECOMMENDED, never automatically REQUIRED. Playback or copying text does not save a review decision.','note'));
if(detail)card.append(text('p',detail.reviewLayer+' · '+detail.itemTypes.join(' · '),'inventory-badges'));
const targets=data.targets.targets.filter(x=>x.parentReviewItemId===item.reviewItemId);
for(const target of targets){const box=document.createElement('div');box.className='candidate';box.dataset.inventoryTargetId=target.reviewTargetId;
box.append(text('strong',target.targetSource),text('p','Native samples '+target.nativeInterval.startSample+' → '+target.nativeInterval.endSample),
text('p','Inventory: '+target.inventoryIntervalIds.join(', ')+' · Detector runs: '+target.detectorRunIds.length+' · Fingerprints: '+target.fingerprintEntryIds.length,'note'));
const entry=data.lexical.targets.find(x=>x.targetId===target.reviewTargetId);if(entry){box.append(text('p',entry.evidenceClass));for(const candidate of entry.localizedTextCandidates){
const row=document.createElement('div');row.className='candidate';row.append(text('p',candidate.text,'subtitle'),text('p',candidate.requestId,'note'));
if(item.suggestedActions.includes('ADD_NEW_CUE')||item.suggestedActions.includes('MANUAL_EDIT'))row.append(button('Copy localized candidate to editing base',()=>{const area=byId('manual-text');area.value=candidate.text;area.focus();showStatus('Candidate copied for human verification. No decision saved; canonical subtitles remain unchanged.')}));box.append(row)}}
card.append(box)}byId('workspace').append(card)};
`;
}
