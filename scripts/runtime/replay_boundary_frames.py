"""Validate complete frame persistence without model construction or inference."""
import hashlib
import json
import os
import sys
import numpy as np
import soundfile as sf
from boundary_support import open_suffix, rms_transition

root=sys.argv[1]
with open(os.path.join(root,'boundary-plan.json')) as f:
    plan=json.load(f)
count=0
for r in plan['requests']:
    with open(os.path.join(root,'boundary-evidence',r['requestId']+'.json')) as f:
        result=json.load(f)
    if result['status']!='SUCCESS':
        continue
    frame=result['frameEvidence']
    p=os.path.join(root,'boundary-evidence',frame['file'])
    with open(p,'rb') as f:
        assert hashlib.sha256(f.read()).hexdigest()==frame['sha256']
    with np.load(p,allow_pickle=False) as data:
        assert list(data['logProbabilities'].shape)==frame['shape']
        assert data['paddingMask'].sum()==r['sampleCount']
        replay=open_suffix(data['logProbabilities'],frame['targetIds'],frame['blankId'],r['anchors'],r['prefixTokenCount'])
        assert replay==result['partialAlignment']
    audio,rate=sf.read(r['audioPath'],dtype='float32')
    for t in r['targets']:
        s=replay['tokenSpans'][t['lastTokenIndex']]
        recalculated=rms_transition(audio,rate,s['endFrameExclusive']*frame['frameCellSeconds'])
        assert recalculated==next(x['result'] for x in result['acousticTransitions'] if x['cueId']==t['cueId'])
    count+=1
print(json.dumps({'frameEvidenceReplayPassed':count,'modelLoads':0,'inference':0}))
