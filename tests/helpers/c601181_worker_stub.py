"""Neutral project-worker control-flow test. No native ASR imports or execution."""
import importlib.abc
import importlib.util
import importlib.metadata
import io
import json
from pathlib import Path
import struct
import sys
import types


class DenyNative(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'sherpa_onnx', 'onnxruntime', 'numpy', 'torch', 'onnx'}:
            raise AssertionError('native import forbidden in stub test: ' + fullname)


class Samples(list):
    def astype(self, dtype):
        assert dtype == '<f4'
        return self

    def tobytes(self):
        return b''.join(struct.pack('<f', s) for s in self)


events = []
streams = []
texts = ['  neutral\nrepeat repeat  ', '🙂 Unicode  ']


class Stream:
    def accept_waveform(self, sample_rate, samples):
        assert sample_rate == 16000
        assert len(samples) == 28805
        assert samples[14400:14405] == [-1, -0.5, 0, 0.5, 32767 / 32768]
        assert not any(samples[:14400]) and not any(samples[-14400:])
        self.samples = samples


class FakeRecognizer:
    def create_stream(self):
        s = Stream()
        streams.append(s)
        return s

    def decode_stream(self, stream):
        assert streams[-1] is stream
        index = len(streams) - 1
        # Intentionally unequal arrays, zero/long-gap points: text must survive.
        stream.result = types.SimpleNamespace(text=texts[index % 2], tokens=['neutral'], timestamps=[0, 9])


def fake_factory(**kwargs):
    assert kwargs['feature_dim'] == 80 and kwargs['num_threads'] == 1
    assert kwargs['decoding_method'] == 'greedy_search'
    return FakeRecognizer()


parent = types.ModuleType('reazonspeech_k2_worker')
parent.PAD_SECONDS = 0.9
parent.SAMPLE_RATE = 16000
parent.EXPECTED_FILES = dict(encoder='e', decoder='d', joiner='j', tokens='t')
parent.emit = events.append
parent.peak_rss_bytes = lambda: 0
parent.read_wav = lambda p: Samples([-1, -0.5, 0, 0.5, 32767 / 32768])
parent.np = types.SimpleNamespace(pad=lambda s, n, mode: Samples([0] * n + s + [0] * n))
parent.sherpa_onnx = types.SimpleNamespace(OfflineRecognizer=types.SimpleNamespace(from_transducer=fake_factory))
sys.meta_path.insert(0, DenyNative())
sys.modules['reazonspeech_k2_worker'] = parent
worker_path = Path(__file__).resolve().parents[2] / 'scripts/runtime/c60118_reazon_worker.py'
spec = importlib.util.spec_from_file_location('tested_project_worker', worker_path)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
importlib.metadata.version = lambda name: 'neutral-stub-not-installed-runtime'
sys.argv = ['neutral-test', '--model-directory', '/neutral-not-a-model']
sys.stdin = io.StringIO('\n'.join(json.dumps(dict(type='transcribe', requestId=f'unit-neutral-{i}', audioPath='neutral.wav', maximumPaddedSeconds=32)) for i in range(12)))
worker.main()
responses = [e for e in events if e['type'] == 'result']
assert len(streams) == len({id(s) for s in streams}) == len(responses) == 12
for i, response in enumerate(responses):
    assert response['requestId'] == f'unit-neutral-{i}'
    assert response['result']['text'] == texts[i % 2]
    assert len(response['result']['timestamps']) == 2
    assert len(response['result']['tokens']) == 1
print(json.dumps(dict(stubStreams=12, losslessResponses=12, nativeAcousticValidation=False,
                      realProviderStarts=0, realModelLoads=0, realAcousticForwards=0)))
