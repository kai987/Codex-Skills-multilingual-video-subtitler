"""Offline fixed-evidence computation; no model/provider import, even for preflight."""
import hashlib
import json
import os
import sys
import wave
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'runtime'))
from occurrence_tail import POLICY, onset_paths, support, hypothesis, prior_dependence, pcm_candidates, pcm_prefix_integrity
from boundary_support import open_suffix


def audit(event,args):
    if event in ('subprocess.Popen','os.system','os.exec','os.posix_spawn','socket.__new__'):
        raise RuntimeError('ZERO_MODEL_EXECUTION_GUARD '+event)
    if event=='import' and args[0].split('.')[0] in ('torch','transformers','speechbrain','pyannote','onnxruntime'):
        raise RuntimeError('NEURAL_IMPORT_FORBIDDEN')
sys.addaudithook(audit)


def read(p):
    with open(p) as f:return json.load(f)


def digest(p):
    with open(p,'rb') as f:return hashlib.sha256(f.read()).hexdigest()


def write(root,name,v):
    with open(os.path.join(root,name),'x') as f:
        json.dump(v,f,ensure_ascii=False,allow_nan=False,separators=(',',':'));f.flush();os.fsync(f.fileno())


def main(root):
    plan=read(os.path.join(root,'plan.json'))
    if plan['protocol']!=POLICY:raise ValueError('PROTOCOL_MISMATCH')
    for p,h in plan['inputs'].items():
        if digest(os.path.join(root,p))!=h:raise ValueError('FROZEN_INPUT_MISMATCH')
    target=plan['target'];windows=[];rawpaths=[];dpcount=0;pcmcount=0;previous_pcm=None;previous_offset=None;previous_covered=None
    vocab=read(os.path.join(root,'inputs/vocab.json'))
    config=read(os.path.join(root,'inputs/config.json'))
    for req in plan['requests']:
        raw=read(os.path.join(root,req['rawFile']));meta=raw['frameEvidence']
        with wave.open(os.path.join(root,req['wavFile']),'rb') as w:
            rate=w.getframerate();count=w.getnframes()
            if rate!=req['sampleRate'] or count!=req['sampleCount'] or w.getnchannels()!=1 or w.getsampwidth()!=2:raise ValueError('PCM_IDENTITY_MISMATCH')
            pcm=np.frombuffer(w.readframes(count),dtype='<i2').astype(np.float64)/32768
        prefix_integrity=pcm_prefix_integrity(previous_pcm,pcm,previous_covered,previous_offset,req['window']['start']) if previous_pcm is not None else None
        with np.load(os.path.join(root,req['npzFile']),allow_pickle=False) as f:
            logp=f['logProbabilities'];ids=f['targetIds'].tolist()
            if logp.dtype!=np.float64 or not np.isfinite(logp).all() or list(logp.shape)!=meta['shape']:raise ValueError('FRAME_ARRAY_INVALID')
            if ids!=meta['targetIds'] or ids!=[a['tokenId'] for a in req['anchors']]:raise ValueError('TOKEN_MAPPING_MISMATCH')
            if f['paddingMask'].shape!=(count,) or not np.all(f['paddingMask']==1):raise ValueError('REAL_SAMPLE_MASK_INVALID')
            if f['selectedStatePath'].tolist()!=raw['partialAlignment']['statePath']:raise ValueError('OLD_PATH_ARRAY_MISMATCH')
        n=count;stride=1;receptive=1
        for k,s in zip(meta['convKernel'],meta['convStride']):
            n=(n-k)//s+1;receptive+=(k-1)*stride;stride*=s
        if n!=len(logp) or stride!=meta['strideSamples'] or receptive!=meta['receptiveFieldSamples']:raise ValueError('FRAME_GEOMETRY_MISMATCH')
        previous_pcm=pcm;previous_offset=req['window']['start'];previous_covered=(n-1)*stride+receptive
        dt=stride/rate;offset=req['window']['start'];prefix=req['prefixTokenCount']
        if dt!=meta['frameCellSeconds'] or abs(req['window']['end']-offset-count/rate)>1e-8:raise ValueError('TIMEBASE_INVALID')
        if ''.join(raw['pieces'])!=req['targetText'] or [vocab.get(piece) for piece in raw['pieces']]!=ids or meta['modelSnapshotHash']!=plan['modelSnapshotHash'] or meta['audioHash']!=req['audioHash']:raise ValueError('MODEL_AUDIO_TEXT_BINDING_INVALID')
        if meta['blankId']!=config['pad_token_id'] or meta['convKernel']!=config['conv_kernel'] or meta['convStride']!=config['conv_stride'] or logp.shape[1]!=config['vocab_size']:raise ValueError('MODEL_GEOMETRY_VOCAB_IDENTITY_INVALID')
        if not np.allclose(np.exp(logp).sum(axis=1),1,atol=2e-6):raise ValueError('NOT_LOG_PROBABILITIES')
        old=open_suffix(logp,ids,meta['blankId'],req['anchors'],prefix)
        if old!=raw['partialAlignment']:raise ValueError('OLD_ALGORITHM_REPLAY_MISMATCH')
        result=onset_paths(logp,ids,meta['blankId'],req['anchors'],prefix)
        dpcount+=result['dpOnsets']
        for row in result['paths']:row['support']=support(row,prefix,dt)
        center=(target['oldFirstTokenStart']-offset)/dt
        hypotheses={}
        for key,band in [('H_ORIGINAL',POLICY['originalBandSeconds']),('ORIGINAL_WIDE_SENSITIVITY',POLICY['wideBandSeconds'])]:
            hypotheses[key]=hypothesis(result['paths'],max(0,int(np.ceil(center-band/dt))),min(len(logp)-1,int(np.floor(center+band/dt))),prefix,dt)
        hi=hypotheses['H_ORIGINAL']['domainFrames'][1]
        hypotheses['H_DISPLACED']=hypothesis(result['paths'],hi+1,len(logp)-1,prefix,dt)
        hypotheses['NO_POSITION_PRIOR']=hypothesis(result['paths'],0,len(logp)-1,prefix,dt)
        original=hypotheses['H_ORIGINAL'];displaced=hypotheses['H_DISPLACED']
        dominated=prior_dependence(original,hypotheses['ORIGINAL_WIDE_SENSITIVITY'])
        # Supported later loci are barriers, not automatically selected ends.
        later=[r['onsetFrame']*dt for r in result['paths'] if r['onsetFrame']>hi and r['support']['supported']]
        for name,h in hypotheses.items():
            r=h['bestPath'];h['tail']=None
            if r:
                a=r['tokenSpans'][prefix]['startFrame']*dt;e=r['tokenSpans'][-1]['endFrameExclusive']*dt
                barriers=[req['window']['end']-offset,plan['protectedNextStart']-offset]
                barriers += [x for x in later if x>a+POLICY['onsetClusterGapSeconds']]
                h['tail']=pcm_candidates(pcm,rate,a,e,min(barriers));pcmcount+=1
                h['sourceOnset']=offset+a;h['sourceLabelEnd']=offset+e
                h['sourceEndCandidates']=[offset+c['endSeconds'] for c in h['tail']['candidates']]
            # Each exact-onset path and every completion score remains in the
            # separate path payload; summary holds the chosen full path too.
        windows.append({'windowId':req['windowId'],'sourceRange':req['window'],'frameShape':list(logp.shape),
                        'evidenceIntegrity':'PASSED','pcmPrefixIntegrity':prefix_integrity,'legacyPathParity':True,'searchStatus':result['status'],
                        'originalIdentityAnchor':'OLD_SOURCE_LINEAGE_UNCERTAIN_ONSET_NOT_END_TRUTH',
                        'priorDominated':dominated,'hypotheses':hypotheses,
                        'H_UNSUPPORTED':{'original':original['supportedPathCount']==0,'displaced':displaced['supportedPathCount']==0},
                        'legacyGlobalOnset':offset+old['tokenSpans'][prefix]['startFrame']*dt,
                        'oldNearBestOriginalRetained':any(abs(a['tokenSpans'][prefix]['startFrame']-center)*dt<=POLICY['originalBandSeconds'] for a in old['alternatives'])})
        rawpaths.append({'windowId':req['windowId'],**result})
    mainwindow=next(w for w in windows if w['windowId']=='W+4'); companion=next(w for w in windows if w['windowId']=='W+2')
    a=mainwindow['hypotheses']['H_ORIGINAL'];b=companion['hypotheses']['H_ORIGINAL'];reasons=[]
    path_exists=a['finitePathCount']>0
    supported=bool(a['supportedPathCount'] and b['supportedPathCount'])
    if not supported:reasons.append('ORIGINAL_SUPPORT_NOT_ESTABLISHED')
    if mainwindow['priorDominated'] or companion['priorDominated']:reasons.append('PRIOR_DOMINATED')
    if any(w['searchStatus']=='SEARCH_INCOMPLETE' for w in windows):reasons.append('SEARCH_INCOMPLETE')
    same=bool(a['bestPath'] and b['bestPath'] and abs(a['sourceOnset']-b['sourceOnset'])<=POLICY['stabilitySeconds'])
    if not same or len(a['supportedOnsetClusters'])>1 or len(b['supportedOnsetClusters'])>1:reasons.append('OCCURRENCE_UNRESOLVED')
    ea=a['tail']['selectedEndSeconds']+mainwindow['sourceRange']['start'] if a['tail'] and a['tail']['selectedEndSeconds'] is not None else None
    eb=b['tail']['selectedEndSeconds']+companion['sourceRange']['start'] if b['tail'] and b['tail']['selectedEndSeconds'] is not None else None
    tail_stable=ea is not None and eb is not None and abs(ea-eb)<=POLICY['stabilitySeconds']
    if not tail_stable:reasons.append('TAIL_BOUNDARY_CONTEXT_UNSTABLE' if ea is not None and eb is not None else 'TAIL_NOT_SEPARABLE_FROM_BACKGROUND_OR_NEXT_SPEECH')
    ranges=[x for w in [mainwindow,companion] for key in ['H_ORIGINAL','ORIGINAL_WIDE_SENSITIVITY'] for x in w['hypotheses'][key].get('sourceEndCandidates',[])]
    result={'version':POLICY['version'],'targetCueId':target['cueId'],'windows':windows,
            'mathematicalPathExists':path_exists,'originalSupportEstablished':supported,
            'occurrenceDistinguished':supported and same and 'PRIOR_DOMINATED' not in reasons and 'OCCURRENCE_UNRESOLVED' not in reasons,
            'tailIdentifiable':not reasons,'proposedEnd':ea if not reasons else None,
            'configuredStabilityTolerance':POLICY['stabilitySeconds'],
            'candidateEndRange':[min(ranges),max(ranges)] if ranges else None,'rangeMeaning':'OBSERVED_CANDIDATES_NOT_CONFIDENCE_INTERVAL',
            'reasons':reasons,'audioConfirmed':False,'listener':None,
            'status':'ORIGINAL_PATH_SUPPORTED_TAIL_IDENTIFIABLE' if not reasons else 'NOT_IDENTIFIABLE_BY_THIS_PROTOCOL_ON_FROZEN_EVIDENCE',
            'counts':{'newASRRequests':0,'newModelInference':0,'newAcousticForwards':0,'newModelLoads':0,'newProviderStarts':0,'newAudioWindows':0,'offlineExactOnsetDPs':dpcount,'legacyOfflineDPs':len(windows),'pcmFeatureComputations':pcmcount}}
    write(root,'occurrence-hypotheses.json',rawpaths);write(root,'tail-identifiability.json',result)
    print(json.dumps({'status':result['status'],'reasons':reasons,'counts':result['counts']}))


if __name__=='__main__':
    if sys.argv[1]=='--policy':print(json.dumps(POLICY))
    else:main(sys.argv[1])
