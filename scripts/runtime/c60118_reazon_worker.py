"""Opt-in full-text evidence worker; frozen FP32/CPU/greedy decoding, no trimming."""
import argparse
import hashlib
import importlib.metadata
import json
import sys
import time
from pathlib import Path

from reazonspeech_k2_worker import (
    PAD_SECONDS, SAMPLE_RATE, EXPECTED_FILES, emit, peak_rss_bytes,
    read_wav, np, sherpa_onnx,
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-directory', required=True)
    args = parser.parse_args()
    files = {k: str(Path(args.model_directory) / v) for k, v in EXPECTED_FILES.items()}
    emit({'type': 'load-start', 'modelLoadAttempt': 1})
    started = time.monotonic()
    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        tokens=files['tokens'], encoder=files['encoder'], decoder=files['decoder'],
        joiner=files['joiner'], num_threads=1, sample_rate=SAMPLE_RATE,
        feature_dim=80, decoding_method='greedy_search', provider='cpu',
    )
    emit({'type': 'ready', 'modelLoadCount': 1, 'modelLoadSeconds': time.monotonic()-started,
          'python': sys.version, 'sherpa': importlib.metadata.version('sherpa-onnx'),
          'numpy': importlib.metadata.version('numpy'), 'device': 'cpu', 'threads': 1})
    for line in sys.stdin:
        message = json.loads(line)
        if message.get('type') == 'shutdown':
            return
        request_id = message['requestId']
        started = time.monotonic()
        forward = False
        try:
            if set(message) != {'type', 'requestId', 'audioPath', 'maximumPaddedSeconds'}:
                raise ValueError('unexpected-request-fields')
            if message['type'] != 'transcribe' or message['maximumPaddedSeconds'] != 32:
                raise ValueError('explicit-experiment-contract-required')
            waveform = read_wav(message['audioPath'])
            raw_seconds = len(waveform) / SAMPLE_RATE
            if raw_seconds > 30 or raw_seconds + 2*PAD_SECONDS > 32:
                raise ValueError('PROVIDER_DURATION_UNSUPPORTED')
            padded = np.pad(waveform, int(PAD_SECONDS*SAMPLE_RATE), mode='constant')
            # A newly created stream prevents state reuse between complete units.
            stream = recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, padded)
            emit({'type': 'forward-start', 'requestId': request_id,
                  'sampleCount': len(waveform), 'paddedSampleCount': len(padded),
                  'decodedFloat32Hash': hashlib.sha256(padded.astype('<f4').tobytes()).hexdigest()})
            forward = True
            recognizer.decode_stream(stream)
            result = stream.result
            # No strip, point filtering, zip truncation, or reconstruction from tokens.
            text = result.text
            if not isinstance(text, str):
                raise ValueError('RESPONSE_INCOMPLETE')
            tokens = list(result.tokens)
            timestamps = list(result.timestamps)
            emit({'type': 'result', 'requestId': request_id,
                  'status': 'SUCCESS_NONEMPTY' if text else 'SUCCESS_EMPTY',
                  'result': {'text': text, 'tokens': tokens, 'timestamps': timestamps},
                  'rawResponseComplete': True, 'acousticForwardAttempted': forward,
                  'rawSampleCount': len(waveform), 'paddedSampleCount': len(padded),
                  'wallSeconds': time.monotonic()-started, 'peakRssBytes': peak_rss_bytes()})
        except Exception as error:
            emit({'type': 'result', 'requestId': request_id, 'status': 'EXECUTION_FAILED',
                  'result': None, 'rawResponseComplete': False,
                  'acousticForwardAttempted': forward, 'error': str(error),
                  'wallSeconds': time.monotonic()-started})


if __name__ == '__main__':
    main()
