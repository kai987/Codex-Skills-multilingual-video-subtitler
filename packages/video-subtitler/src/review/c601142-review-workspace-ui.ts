/** Additive evidence only. All writes still go through the unchanged C60112
 * transaction API; audio playback and editing-base copying never save. */
export function c601142WorkspaceJavascript(): string {
  return String.raw`
v14.budget='C601142_FINAL_FULL_QUEUE';
const ceiling142Data=()=>state.data?.detectorCeilingReviewV2;
const ceiling142OldRender=render;
render=function(){ceiling142OldRender();const data=ceiling142Data(),item=state.filtered[state.index];if(!data||!item)return;
document.title='C6.0.1.14.2 Safety Target & Detector Evidence Review';document.querySelector('header strong').textContent='C6.0.1.14.2 Safety Review';
byId('identity').textContent='C6.0.1.14.2 evidence · C6.0.1.12 transactions · fixed R3 · no automatic subtitle changes';
if(!byId('c601142-jump-safety')){const jump=button('Jump to safety evidence',()=>{v14.budget='C601142_FINAL_FULL_QUEUE';byId('v14-budget').value=v14.budget;byId('priority-filter').value='ALL';byId('type-filter').value='ALL';refreshFiltered();const ids=new Set(data.items.items.filter(i=>i.reviewLayer==='MISSING_SAFETY_RESERVE').map(i=>i.reviewItemId));state.index=Math.max(0,state.filtered.findIndex(i=>ids.has(i.reviewItemId)));render()});jump.id='c601142-jump-safety';document.querySelector('aside').append(jump)}
const card=document.createElement('section');card.className='card detector-ceiling-evidence-v2';card.append(text('h2','Clustered safety and detector evidence'),text('p','Speech presence, subthreshold scores and acoustic proxies are not verified transcript text. Energy alone is never speech. Copying or playing audio does not save a decision.','note'));
const detail=data.items.items.find(i=>i.reviewItemId===item.reviewItemId);if(detail)card.append(text('p',detail.reviewLayer+' · '+detail.evidenceStrata.join(' · '),'inventory-badges'));
const clusters=data.safety.targets.filter(c=>detail?.inventoryTargetIds.includes(c.targetId));
for(const cluster of clusters){const box=document.createElement('div');box.className='candidate';box.dataset.safetyClusterId=cluster.clusterId;
box.append(text('strong',cluster.selectionStage+' · '+cluster.evidenceStrata.join(' / ')),text('p','Atomic members '+cluster.memberCandidateIds.length+' · core union '+cluster.uncoveredSpeechSeconds.toFixed(3)+'s · independent families '+cluster.independentFamilyCount),
text('p','Core samples: '+cluster.targetCoreUnion.map(v=>v.startSample+' → '+v.endSample).join(' | '),'note'),text('p','Review envelope is context only; never a positive speech interval.','note'));
if(cluster.densityOverrideReason)box.append(text('p',cluster.densityOverrideReason,'note'));
const lexical=data.lexical.targets.find(t=>t.targetId===cluster.targetId);if(lexical){box.append(text('p',lexical.evidenceClass));for(const candidate of lexical.localizedTextCandidates){const row=document.createElement('div');row.className='candidate';row.append(text('strong',candidate.provider+' · '+candidate.source),text('p',candidate.text,'subtitle'),text('p',candidate.localizationStatus+' · '+candidate.sourceInterval.start.toFixed(3)+' → '+candidate.sourceInterval.end.toFixed(3),'note'));
if(item.suggestedActions.includes('ADD_NEW_CUE')||item.suggestedActions.includes('MANUAL_EDIT'))row.append(button('Copy candidate to editing base',()=>{const area=byId('manual-text');if(!area){showStatus('Select a human editing action first.',true);return}area.value=candidate.text;area.focus();showStatus('Candidate copied for human audio verification. No decision saved; canonical text and timing remain unchanged.')}));box.append(row)}}
card.append(box)}if(!clusters.length)card.append(text('p','Preserved baseline item. Its original review order and required level are unchanged.','note'));
card.append(text('p','Active safety clusters '+data.safety.targets.length+'/24 · core union '+data.safety.summary.targetUnionSeconds.toFixed(3)+'/60s · full queue '+(data.playback.fullQueueEpisodeRatio*100).toFixed(2)+'% · '+data.playback.burdenGate,'note'));byId('workspace').append(card)};
`;
}
