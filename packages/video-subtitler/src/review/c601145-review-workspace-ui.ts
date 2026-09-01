/** Additive C6.0.1.14.5 evidence rendering. The existing C6.0.1.12
 * transaction, playback, and correction controls remain authoritative. */
export function c601145WorkspaceJavascript(): string {
  return String.raw`
let c601145Data=null;
const c601145Interval=(interval,rate)=>(interval.startSample/rate).toFixed(3)+' → '+(interval.endSample/rate).toFixed(3)+'s';
const c601145OldRender=render;
render=function(){c601145OldRender();const item=state.filtered[state.index];if(!item||!c601145Data)return;
const detail=c601145Data.items.items.find(row=>row.reviewItemId===item.reviewItemId);if(!detail||!detail.coverageUnitIds.length)return;
const unitIds=new Set(detail.coverageUnitIds),units=c601145Data.units.units.filter(row=>unitIds.has(row.coverageUnitId)),targets=c601145Data.targets.targets.filter(row=>row.parentReviewItemId===item.reviewItemId&&row.coverageUnitIds.some(id=>unitIds.has(id))),safety=c601145Data.safety.targets.filter(row=>row.coverageUnitIds.some(id=>unitIds.has(id))),rate=c601145Data.units.sourceIdentity.sampleRate;
const card=document.createElement('section');card.className='card coverage-unit-contract-v145';card.dataset.reviewItemId=item.reviewItemId;card.append(text('h2','C6.0.1.14.5 Coverage Unit Review Contract'),text('p','Machine evidence for human-on-exception review only. Canonical subtitle text and timing remain unchanged.','note'));
for(const unit of units){const box=document.createElement('section');box.className='candidate coverage-unit-core';box.dataset.coverageUnitId=unit.coverageUnitId;const unitTargets=targets.filter(row=>row.coverageUnitIds.includes(unit.coverageUnitId)),unitSafety=safety.filter(row=>row.coverageUnitIds.includes(unit.coverageUnitId)),anchors=unitSafety.flatMap(row=>row.atomicTargetCoreIntervals),envelopes=unitSafety.map(row=>row.reviewEnvelope),contracts=[...new Set(unitSafety.map(row=>row.contractType))],bundleIds=new Set(unitSafety.flatMap(row=>row.bundleIds)),bindings=state.data.monotonicSafetyReviewV3.lexicalBindings.entries.filter(row=>row.finalBundleIds.some(id=>bundleIds.has(id)));
box.append(text('h3','Coverage Unit Core'),text('p',unit.atomicNativeIntervals.map(interval=>c601145Interval(interval,rate)).join(' | ')),text('p','Core union '+unit.coreUnionSeconds.toFixed(3)+'s · '+unit.coverageUnitId,'note'));
box.append(text('div','Selected Machine Anchor','label'),text('p',anchors.length?anchors.map(interval=>c601145Interval(interval,rate)).join(' | '):'No selected anchor'));
box.append(text('div','Review Audio Envelope','label'),text('p',envelopes.length?envelopes.map(interval=>c601145Interval(interval,rate)).join(' | '):'No selected review envelope'));
box.append(text('div','Contract Type','label'),text('p',contracts.length?contracts.join(' / '):'No selected contract'));
box.append(text('div','Detector/Evidence Families','label'),text('p',unit.detectorFamilies.join(' / ')+' · '+unit.evidenceStrata.join(' / ')));
box.append(text('div','Existing Text Candidate','label'));
if(bindings.length){for(const binding of bindings)box.append(text('p',binding.candidate.text||'(empty)','subtitle'),text('p',binding.candidate.provider+' · '+binding.binding,'note'))}else box.append(text('p','None — audio-first review','note'));
if(item.suggestedActions.includes('ADD_NEW_CUE'))box.append(text('p','Available human action: ADD_NEW_CUE','note'));
box.append(text('p','Linked review targets '+unitTargets.length+' · Machine anchor overlap '+unitSafety.map(row=>row.machineAnchorOverlapSeconds.toFixed(3)+'s / '+(row.machineAnchorCoverageRatio*100).toFixed(1)+'%').join(' | '),'note'));
card.append(box)}
byId('workspace').append(card)};
Promise.all([
fetch('assets/c601145/machine-review-items-v9.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('machine-review-items-v9.json unavailable');return response.json()}),
fetch('assets/c601145/machine-review-target-intervals-v7.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('machine-review-target-intervals-v7.json unavailable');return response.json()}),
fetch('assets/c601145/machine-missing-safety-reserve-targets-v5.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('machine-missing-safety-reserve-targets-v5.json unavailable');return response.json()}),
fetch('assets/c601145/machine-speech-safety-coverage-units-v1.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('machine-speech-safety-coverage-units-v1.json unavailable');return response.json()})
]).then(([items,targets,safety,units])=>{c601145Data={items,targets,safety,units};render()}).catch(error=>showStatus(error.message,true));
`;
}
