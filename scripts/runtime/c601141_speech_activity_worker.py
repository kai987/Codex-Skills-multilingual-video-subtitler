#!/usr/bin/env python3
"""Offline speech-only worker. One dispatch is one accounted detector run.

Silero uses the pinned whisper.cpp VAD-only C API, never whisper_init/full.
Pyannote exposes only anonymous speech unions; speaker labels and embeddings
are not emitted or persisted. There is no retry, device fallback, or download.
"""
import argparse
import contextlib
import ctypes
import importlib.metadata
import json
import os
import sys
import time
import wave


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def union(intervals):
    result = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if result and start <= result[-1][1]:
            result[-1][1] = max(result[-1][1], end)
        else:
            result.append([float(start), float(end)])
    return [{"start": a, "end": b} for a, b in result]


class VadContextParams(ctypes.Structure):
    _fields_ = [("n_threads", ctypes.c_int), ("use_gpu", ctypes.c_bool), ("gpu_device", ctypes.c_int)]


class VadParams(ctypes.Structure):
    _fields_ = [("threshold", ctypes.c_float), ("min_speech_duration_ms", ctypes.c_int),
                ("min_silence_duration_ms", ctypes.c_int), ("max_speech_duration_s", ctypes.c_float),
                ("speech_pad_ms", ctypes.c_int), ("samples_overlap", ctypes.c_float)]


class Silero:
    def __init__(self, args):
        import numpy as np
        self.np = np
        lib = ctypes.CDLL(args.library)
        signatures = {
            "whisper_vad_default_context_params": ([], VadContextParams),
            "whisper_vad_default_params": ([], VadParams),
            "whisper_vad_init_from_file_with_params": ([ctypes.c_char_p, VadContextParams], ctypes.c_void_p),
            "whisper_vad_detect_speech": ([ctypes.c_void_p, ctypes.POINTER(ctypes.c_float), ctypes.c_int], ctypes.c_bool),
            "whisper_vad_segments_from_probs": ([ctypes.c_void_p, VadParams], ctypes.c_void_p),
            "whisper_vad_segments_n_segments": ([ctypes.c_void_p], ctypes.c_int),
            "whisper_vad_segments_get_segment_t0": ([ctypes.c_void_p, ctypes.c_int], ctypes.c_float),
            "whisper_vad_segments_get_segment_t1": ([ctypes.c_void_p, ctypes.c_int], ctypes.c_float),
            "whisper_vad_n_probs": ([ctypes.c_void_p], ctypes.c_int),
            "whisper_vad_probs": ([ctypes.c_void_p], ctypes.POINTER(ctypes.c_float)),
            "whisper_vad_free_segments": ([ctypes.c_void_p], None),
            "whisper_vad_free": ([ctypes.c_void_p], None),
        }
        for name, (params, result) in signatures.items():
            function = getattr(lib, name)
            function.argtypes, function.restype = params, result
        params = lib.whisper_vad_default_context_params()
        params.n_threads, params.use_gpu, params.gpu_device = 4, False, 0
        self.context = lib.whisper_vad_init_from_file_with_params(args.model.encode(), params)
        if not self.context:
            raise RuntimeError("SILERO_MODEL_LOAD_FAILED")
        self.lib = lib

    def run(self, request):
        np, lib = self.np, self.lib
        with wave.open(request["audioPath"], "rb") as wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (16000, 1, 2):
                raise RuntimeError("SPEECH_INPUT_MUST_BE_MONO_PCM16_16K")
            samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
        # This API explicitly resets Silero LSTM state before every request.
        if not lib.whisper_vad_detect_speech(self.context, samples.ctypes.data_as(ctypes.POINTER(ctypes.c_float)), len(samples)):
            raise RuntimeError("SILERO_INFERENCE_FAILED")
        profile = request["profile"]
        params = lib.whisper_vad_default_params()
        params.threshold = profile["threshold"]
        params.min_speech_duration_ms = profile["minSpeechMs"]
        params.min_silence_duration_ms = profile["minSilenceMs"]
        params.max_speech_duration_s = profile["maxSpeechSeconds"]
        params.speech_pad_ms = profile["speechPadMs"]
        params.samples_overlap = profile["samplesOverlap"]
        segments = lib.whisper_vad_segments_from_probs(self.context, params)
        if not segments:
            raise RuntimeError("SILERO_SEGMENT_MATERIALIZATION_FAILED")
        try:
            intervals = [{"start": float(lib.whisper_vad_segments_get_segment_t0(segments, i)),
                          "end": float(lib.whisper_vad_segments_get_segment_t1(segments, i))}
                         for i in range(lib.whisper_vad_segments_n_segments(segments))]
        finally:
            lib.whisper_vad_free_segments(segments)
        count = lib.whisper_vad_n_probs(self.context)
        probabilities = np.ctypeslib.as_array(lib.whisper_vad_probs(self.context), shape=(count,)).tolist()
        return {"rawUnit": "CENTISECONDS", "rawIntervals": intervals, "exclusiveRawIntervals": [],
                "probabilities": probabilities, "inputFrames": len(samples), "sampleRate": 16000,
                "stateIsolation": "WHISPER_VAD_DETECT_SPEECH_RESETS_LSTM", "device": "cpu"}

    def close(self):
        self.lib.whisper_vad_free(self.context)


class PyannoteSpeech:
    def __init__(self, args):
        import torch
        import soundfile as sf
        from pyannote.audio import Pipeline
        self.torch, self.sf = torch, sf
        torch.set_num_threads(4)
        # Explicit CPU is intentional: no second load hidden in device fallback.
        self.pipeline = Pipeline.from_pretrained(args.model)
        self.pipeline.to(torch.device("cpu"))

    def run(self, request):
        values, rate = self.sf.read(request["audioPath"], dtype="float32", always_2d=False)
        if rate != 16000 or values.ndim != 1:
            raise RuntimeError("SPEECH_INPUT_MUST_BE_MONO_16K")
        with self.torch.inference_mode():
            result = self.pipeline({"waveform": self.torch.from_numpy(values).unsqueeze(0), "sample_rate": rate})
        standard = getattr(result, "speaker_diarization", result)
        exclusive = getattr(result, "exclusive_speaker_diarization", None)
        def anonymous(annotation):
            if annotation is None:
                return []
            return union([(segment.start, segment.end) for segment in annotation.get_timeline()])
        return {"rawUnit": "SECONDS", "rawIntervals": anonymous(standard),
                "exclusiveRawIntervals": anonymous(exclusive), "inputFrames": len(values), "sampleRate": rate,
                "speakerIdentityPersisted": False, "embeddingPersisted": False,
                "standardExclusiveIndependentVotes": 1, "device": "cpu"}

    def close(self):
        del self.pipeline


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=["silero", "pyannote"], required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--library")
    args = parser.parse_args()
    for name in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACE_TOKEN", "OPENAI_API_KEY"):
        os.environ.pop(name, None)
    os.environ.update(HF_HUB_OFFLINE="1", HF_DATASETS_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                      HF_HUB_DISABLE_TELEMETRY="1", PYANNOTE_METRICS_ENABLED="0")
    with contextlib.redirect_stdout(sys.stderr):
        backend = Silero(args) if args.backend == "silero" else PyannoteSpeech(args)
    versions = {"python": sys.version.split()[0]}
    for name in (["numpy"] if args.backend == "silero" else ["pyannote.audio", "torch", "soundfile"]):
        versions[name] = importlib.metadata.version(name)
    emit({"type": "ready", "modelLoadCount": 1, "device": "cpu", "versions": versions})
    seen = set()
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        if request.get("type") == "shutdown":
            backend.close()
            return 0
        request_id = request["requestId"]
        if request_id in seen:
            raise RuntimeError("DUPLICATE_DISPATCH_RETRY_FORBIDDEN")
        seen.add(request_id)
        started = time.perf_counter()
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result = backend.run(request)
            emit({"type": "result", "requestId": request_id, "result": result,
                  "wallClockSeconds": time.perf_counter() - started, "inferenceConsumed": True})
        except Exception as error:
            emit({"type": "error", "requestId": request_id, "code": type(error).__name__,
                  "inferenceConsumed": True})
    backend.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
