"""Explicit bounded diagnostic worker; no production registration or defaults."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

from reazonspeech_k2_worker import (
    PAD_SECONDS, SAMPLE_RATE, EXPECTED_FILES, emit, peak_rss_bytes,
    read_wav, np, sherpa_onnx,
)
from sherpa_onnx.lib import _sherpa_onnx as native


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-directory', required=True)
    parser.add_argument('--native-sha256', required=True)
    parser.add_argument('--experiment-id', required=True)
    parser.add_argument('--arm', choices=['B', 'T'], required=True)
    parser.add_argument('--trace-directory', required=True)
    parser.add_argument('--preflight', action='store_true')
    args = parser.parse_args()
    module_path = Path(native.__file__).resolve()
    actual_hash = hashlib.sha256(module_path.read_bytes()).hexdigest()
    if actual_hash != args.native_sha256:
        raise ValueError('LOADED_NATIVE_IDENTITY_MISMATCH')
    if not hasattr(native, 'c601182_probe_identity'):
        raise ValueError('NATIVE_PROBE_UNAVAILABLE')
    build_id = native.c601182_probe_identity()
    if build_id != 'c601182-native-probe-v1-1cb484af':
        raise ValueError('NATIVE_PROBE_IDENTITY_MISMATCH')
    identity = {'type': 'native-identity', 'module': str(module_path),
                'sha256': actual_hash, 'buildId': build_id, 'pid': os.getpid(),
                'python': sys.version, 'numpy': np.__version__}
    emit(identity)
    if args.preflight:
        # Native buffer/schema exercise only; no recognizer or audio/feature API.
        binding = {'experimentId': 'neutral-preflight', 'arm': args.arm,
                   'requestId': 'neutral', 'unitId': 'neutral', 'streamId': 'neutral',
                   'modelInstanceId': 'none', 'inputHash': '0' * 64}
        native.c601182_trace_begin(json.dumps(binding),
                                   str(Path(args.trace_directory) / 'neutral.json'))
        native.c601182_trace_end(False)
        emit({'type': 'preflight-passed', 'modelLoads': 0, 'inference': 0})
        return
    files = {k: str(Path(args.model_directory) / v) for k, v in EXPECTED_FILES.items()}
    emit({'type': 'load-start', 'modelLoadAttempt': 1})
    started = time.monotonic()
    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        tokens=files['tokens'], encoder=files['encoder'], decoder=files['decoder'],
        joiner=files['joiner'], num_threads=1, sample_rate=SAMPLE_RATE,
        feature_dim=80, decoding_method='greedy_search', provider='cpu',
    )
    emit({'type': 'ready', 'modelLoadCount': 1,
          'modelLoadSeconds': time.monotonic()-started, 'device': 'cpu', 'threads': 1})
    stream_number = 0
    for line in sys.stdin:
        message = json.loads(line)
        if message.get('type') == 'shutdown':
            return
        request_id = message['requestId']
        if not request_id.startswith('unit-') or not request_id.replace('-', '').isalnum():
            raise ValueError('UNSAFE_REQUEST_ID')
        started = time.monotonic()
        forward = False
        try:
            if set(message) != {'type', 'requestId', 'audioPath', 'maximumPaddedSeconds'}:
                raise ValueError('unexpected-request-fields')
            if message['type'] != 'transcribe' or message['maximumPaddedSeconds'] != 32:
                raise ValueError('explicit-experiment-contract-required')
            waveform = read_wav(message['audioPath'])
            if len(waveform)/SAMPLE_RATE > 30 or len(waveform)/SAMPLE_RATE+2*PAD_SECONDS > 32:
                raise ValueError('PROVIDER_DURATION_UNSUPPORTED')
            padded = np.pad(waveform, int(PAD_SECONDS*SAMPLE_RATE), mode='constant')
            input_hash = hashlib.sha256(padded.astype('<f4').tobytes()).hexdigest()
            stream = recognizer.create_stream()
            stream_number += 1
            if args.arm == 'T':
                binding = {'experimentId': args.experiment_id, 'arm': args.arm,
                           'requestId': request_id, 'unitId': request_id,
                           'streamId': str(stream_number),
                           'modelInstanceId': str(os.getpid()) + '-1', 'inputHash': input_hash}
                trace_file = Path(args.trace_directory) / (request_id + '.json')
                if trace_file.exists():
                    raise ValueError('TRACE_ALREADY_EXISTS')
                native.c601182_trace_begin(json.dumps(binding), str(trace_file))
            emit({'type': 'accept-start', 'requestId': request_id,
                  'paddedSampleCount': len(padded), 'decodedFloat32Hash': input_hash})
            stream.accept_waveform(SAMPLE_RATE, padded)
            emit({'type': 'forward-start', 'requestId': request_id,
                  'sampleCount': len(waveform), 'paddedSampleCount': len(padded),
                  'decodedFloat32Hash': input_hash})
            forward = True
            recognizer.decode_stream(stream)
            result = stream.result
            text = result.text
            if not isinstance(text, str):
                raise ValueError('RESPONSE_INCOMPLETE')
            emit({'type': 'result', 'requestId': request_id,
                  'status': 'SUCCESS_NONEMPTY' if text else 'SUCCESS_EMPTY',
                  'result': {'text': text, 'tokens': list(result.tokens),
                             'timestamps': list(result.timestamps)},
                  'rawResponseComplete': True, 'acousticForwardAttempted': forward,
                  'rawSampleCount': len(waveform), 'paddedSampleCount': len(padded),
                  'wallSeconds': time.monotonic()-started, 'peakRssBytes': peak_rss_bytes()})
        except Exception as error:
            if args.arm == 'T':
                native.c601182_trace_end(False)
            emit({'type': 'result', 'requestId': request_id, 'status': 'EXECUTION_FAILED',
                  'result': None, 'rawResponseComplete': False,
                  'acousticForwardAttempted': forward, 'error': str(error)})


if __name__ == '__main__':
    main()
