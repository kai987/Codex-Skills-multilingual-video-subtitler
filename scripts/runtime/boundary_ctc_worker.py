"""C6.0.1.16.4.1 alignment-only worker; three bounded tasks, no decoding."""
import hashlib
import importlib.metadata
import json
import os
import sys
import time
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
import numpy as np
import soundfile as sf
import torch
from transformers import AutoProcessor, Wav2Vec2ForCTC
from ctc_worker import viterbi_align, output_length, frame_geometry
from boundary_support import open_suffix, rms_transition


def emit(v):
    print(json.dumps(v, ensure_ascii=False, separators=(',', ':')), flush=True)


def main():
    model_dir, dest = sys.argv[1:3]
    torch.set_num_threads(8)
    emit({'type': 'model-load-start', 'device': 'cpu'})
    processor = AutoProcessor.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
    model = Wav2Vec2ForCTC.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False).eval().to('cpu')
    kernels, strides = list(model.config.conv_kernel), list(model.config.conv_stride)
    stride, receptive = frame_geometry(kernels, strides)
    tok = processor.tokenizer
    emit({'type': 'ready', 'modelLoadCount': 1, 'device': 'cpu', 'dtype': 'float32',
          'versions': {k: importlib.metadata.version(k) for k in ['torch', 'transformers', 'numpy', 'soundfile']}})
    for line in sys.stdin:
        r = json.loads(line)
        if r.get('type') == 'shutdown':
            return
        started = time.monotonic()
        result = {'requestId': r['requestId'], 'status': 'FAILED', 'reasons': []}
        try:
            with open(r['audioPath'], 'rb') as f:
                if hashlib.sha256(f.read()).hexdigest() != r['audioHash']:
                    raise ValueError('AUDIO_HASH_MISMATCH')
            audio, rate = sf.read(r['audioPath'], dtype='float32')
            if rate != 16000 or audio.ndim != 1 or len(audio) != r['sampleCount'] or len(audio) > 30*rate:
                raise ValueError('PHYSICAL_AUDIO_MISMATCH')
            ids = list(tok(r['targetText'], add_special_tokens=False).input_ids)
            pieces = tok.convert_ids_to_tokens(ids)
            if ''.join(pieces) != r['targetText'] or any(i in tok.all_special_ids for i in ids):
                raise ValueError('MAPPING_INCOMPLETE')
            if ids != [a['tokenId'] for a in r['anchors']]:
                raise ValueError('TOKENIZER_IDENTITY_MISMATCH')
            inputs = processor(audio, sampling_rate=rate, return_tensors='pt')
            emit({'type': 'acoustic-forward-start', 'requestId': r['requestId'], 'audioSeconds': len(audio)/rate})
            with torch.inference_mode():
                logits = model(inputs.input_values).logits[0]
                logp = torch.log_softmax(logits, -1).to('cpu', dtype=torch.float64).numpy()
            if len(logp) != output_length(len(audio), kernels, strides):
                raise ValueError('FRAME_GEOMETRY_MISMATCH')
            blank = int(model.config.pad_token_id)
            full = viterbi_align(logp, ids, blank)
            opened = open_suffix(logp, ids, blank, r['anchors'], r['prefixTokenCount'])
            fn = r['requestId']+'.frames.npz'
            with open(os.path.join(dest, fn), 'xb') as f:
                np.savez_compressed(f, logProbabilities=logp, targetIds=np.array(ids),
                                    paddingMask=np.ones(len(audio), dtype=np.uint8),
                                    selectedStatePath=np.array(opened['statePath'], dtype=np.int32))
                f.flush()
                os.fsync(f.fileno())
            with open(os.path.join(dest, fn), 'rb') as f:
                digest = hashlib.sha256(f.read()).hexdigest()
            transitions = []
            for t in r['targets']:
                spans = opened['tokenSpans']
                transitions.append({'cueId': t['cueId'], 'result': rms_transition(audio, rate,
                                    spans[t['lastTokenIndex']]['endFrameExclusive']*stride/rate)} if spans else
                                   {'cueId': t['cueId'], 'result': None})
            result.update(status='SUCCESS', targetText=r['targetText'], pieces=pieces,
                          frameEvidence={'file': fn, 'sha256': digest, 'dtype': 'float64', 'shape': list(logp.shape),
                                         'blankId': blank, 'targetIds': ids, 'sampleCount': len(audio),
                                         'paddingSamples': 0, 'paddingMaskMeaning': '1=real observed sample',
                                         'convKernel': kernels, 'convStride': strides, 'strideSamples': stride,
                                         'receptiveFieldSamples': receptive, 'frameCellSeconds': stride/rate,
                                         'vocabularyColumns': 'ALL', 'modelSnapshotHash': r['modelSnapshotHash'],
                                         'audioHash': r['audioHash'], 'targetHash': hashlib.sha256(r['targetText'].encode()).hexdigest()},
                          fullWindowAlignment=full, partialAlignment=opened, acousticTransitions=transitions,
                          transcriptStatus='PARTIAL_WINDOW_TRANSCRIPT_WITH_UNASSIGNED_SUFFIX',
                          suffixMeaning='NOT_ASSIGNED_CONTEXT_NOT_KNOWN_SILENCE', lexicalTruthValidated=False)
        except Exception as e:
            result['reasons'] = [type(e).__name__+':'+str(e)[:500]]
        emit({'type': 'result', 'result': result, 'wallSeconds': time.monotonic()-started})


if __name__ == '__main__':
    main()
