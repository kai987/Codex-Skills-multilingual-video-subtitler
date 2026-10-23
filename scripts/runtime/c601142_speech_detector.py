#!/usr/bin/env python3
"""One frozen dispatch, no retries/fallback/downloads; anonymous score capture.

The Pyannote forward hook observes the existing inference result BEFORE the
hard powerset conversion. It never changes or calls the model a second time.
Only P(any speaker) survives; no speaker label or embedding is persisted.
"""
import argparse
import contextlib
import hashlib
import json
import math
import os
import sys
import time
import wave
from pathlib import Path
from types import SimpleNamespace

ACCOUNTING = {"modelLoadCount": 0, "inferenceStarted": False}


def durable_bytes(filename, value):
    with open(filename, "xb") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(str(Path(filename).parent), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return hashlib.sha256(value).hexdigest()


def binary_track(filename, values):
    # WebRTC runtime needs no numpy. Standard-library packing is sufficient.
    import struct
    data = struct.pack("<" + "f" * len(values), *values)
    return durable_bytes(filename, data)


def join_intervals(intervals, gap=0):
    joined = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if joined and start <= joined[-1][1] + gap:
            joined[-1][1] = max(end, joined[-1][1])
        else:
            joined.append([start, end])
    return joined


def webrtc_run(request):
    import webrtcvad
    with wave.open(request["audioPath"], "rb") as stream:
        if (stream.getframerate(), stream.getnchannels(), stream.getsampwidth()) != (16000, 1, 2):
            raise RuntimeError("WEBRTC_INVALID_PCM_FORMAT")
        frames = stream.getnframes()
        pcm = stream.readframes(frames)
    vad = webrtcvad.Vad(0)
    scores = []
    ACCOUNTING["inferenceStarted"] = True
    for at in range(0, frames, 320):
        block = pcm[2 * at:2 * (at + 320)].ljust(640, b"\0")
        scores.append(float(vad.is_speech(block, 16000)))
    # Never count merge-gap/padding as atomic detector-positive speech. The
    # padded intervals are a separate review/acquisition envelope.
    atomic = join_intervals([(i * 320, min(frames, (i + 1) * 320)) for i, s in enumerate(scores) if s == 1])
    merged = join_intervals(atomic, 2560)
    kept = [v for v in merged if sum(max(0, min(v[1], a[1]) - max(v[0], a[0])) for a in atomic) >= 1600]
    padded = join_intervals([(max(0, a - 640), min(frames, b + 640)) for a, b in kept])
    bounded = []
    for a, b in padded:
        while a < b:
            end = min(b, a + 12 * 16000)
            bounded.append({"start": a / 16000, "end": end / 16000})
            a = end
    return {"rawUnit": "SECONDS", "rawIntervals": bounded, "exclusiveRawIntervals": [],
            "inputFrames": frames, "sampleRate": 16000, "device": "cpu",
            "scores": scores, "frameHopSamples16k": 320, "frameWindowSamples16k": 320,
            "frameOffsetSamples16k": 0, "scoreKind": "BINARY_DECISION", "originalChunkScores": None,
            "scoreSource": "WEBRTC_GMM_VAD_BINARY_NOT_PROBABILITY", "modelLoadCount": 0}


def silero_run(request):
    from c601141_speech_activity_worker import Silero
    backend = Silero(SimpleNamespace(model=request["model"], library=request["library"]))
    ACCOUNTING["modelLoadCount"] = 1
    try:
        ACCOUNTING["inferenceStarted"] = True
        result = backend.run({"audioPath": request["audioPath"], "profile": request["profile"]})
        scores = result.pop("probabilities")
        if len(scores) != math.ceil(result["inputFrames"] / 512):
            raise RuntimeError("SILERO_SCORE_FRAME_GRID_MISMATCH")
        return {**result, "scores": scores, "frameHopSamples16k": 512, "frameWindowSamples16k": 512,
                "frameOffsetSamples16k": 0, "scoreKind": "PROBABILITY", "originalChunkScores": None,
                "scoreSource": "PINNED_WHISPER_VAD_PROBS_NO_RESET_REINTERPRETATION", "modelLoadCount": 1}
    finally:
        backend.close()


def pyannote_run(request):
    import numpy as np
    import soundfile as sf
    import torch
    from pyannote.audio import Pipeline
    torch.set_num_threads(4)
    pipeline = Pipeline.from_pretrained(request["model"])
    pipeline.to(torch.device("cpu"))
    ACCOUNTING["modelLoadCount"] = 1
    inference = pipeline._segmentation
    if not inference.model.specifications.powerset:
        raise RuntimeError("PYANNOTE_PINNED_POWERSET_CONTRACT_REQUIRED")
    empty_rows = torch.where(inference.conversion.mapping.sum(dim=1) == 0)[0]
    if len(empty_rows) != 1:
        raise RuntimeError("PYANNOTE_EMPTY_POWERSET_CLASS_AMBIGUOUS")
    empty_index = int(empty_rows[0])
    captured = []
    def capture(_module, _inputs, output):
        probabilities = output.detach().exp()
        if not torch.isfinite(probabilities).all() or not torch.allclose(probabilities.sum(dim=-1), torch.ones_like(probabilities[..., 0]), atol=1e-4):
            raise RuntimeError("PYANNOTE_RAW_POSTERIOR_NOT_NORMALIZED")
        captured.append((1 - probabilities[..., empty_index]).cpu().numpy())
        # Returning None preserves the ORIGINAL forward output for diarization.
        return None
    handle = inference.model.register_forward_hook(capture)
    values, rate = sf.read(request["audioPath"], dtype="float32", always_2d=False)
    if rate != 16000 or values.ndim != 1:
        raise RuntimeError("PYANNOTE_INVALID_PCM_FORMAT")
    try:
        ACCOUNTING["inferenceStarted"] = True
        with torch.inference_mode():
            result = pipeline({"waveform": torch.from_numpy(values).unsqueeze(0), "sample_rate": rate})
    finally:
        handle.remove()
    scores = np.concatenate(captured, axis=0)
    rf = inference.model.receptive_field
    def sample(seconds):
        value = seconds * 16000
        if abs(value - round(value)) > 1e-6:
            raise RuntimeError("PYANNOTE_NONINTEGER_RECEPTIVE_FIELD_TIMEBASE")
        return int(round(value))
    step, hop, window, offset = sample(inference.step), sample(rf.step), sample(rf.duration), sample(rf.start)
    # Preserve the original per-chunk anonymous posterior before any overlap
    # projection. The 10ms track is an explicitly derived audit view.
    chunk_name = "anonymous-chunk-posteriors.f32le"
    chunk_hash = durable_bytes(Path(request["scoreDirectory"]) / chunk_name, scores.astype("<f4").tobytes())
    count = math.ceil(len(values) / 160)
    totals, weights = np.zeros(count), np.zeros(count)
    for chunk_index, chunk in enumerate(scores):
        for frame_index, probability in enumerate(chunk):
            start = chunk_index * step + offset + frame_index * hop
            end = min(len(values), start + hop)
            start = max(0, start)
            if start >= end:
                continue
            for cell in range(start // 160, min(count, math.ceil(end / 160))):
                overlap = max(0, min(end, (cell + 1) * 160) - max(start, cell * 160))
                totals[cell] += float(probability) * overlap
                weights[cell] += overlap
    projected = np.divide(totals, weights, out=np.zeros_like(totals), where=weights > 0)
    def anonymous(annotation):
        if annotation is None:
            return []
        return [{"start": float(a), "end": float(b)} for a, b in join_intervals([(s.start, s.end) for s in annotation.get_timeline()])]
    standard = getattr(result, "speaker_diarization", result)
    exclusive = getattr(result, "exclusive_speaker_diarization", None)
    return {"rawUnit": "SECONDS", "rawIntervals": anonymous(standard), "exclusiveRawIntervals": anonymous(exclusive),
            "inputFrames": len(values), "sampleRate": rate, "device": "cpu", "scores": projected.tolist(),
            "frameHopSamples16k": 160, "frameWindowSamples16k": 160, "frameOffsetSamples16k": 0,
            "scoreKind": "PROBABILITY", "modelLoadCount": 1, "scoreSource": "PRE_CONVERSION_POWERSET_ANONYMOUS_PROBABILITY",
            "originalChunkScores": {"relativePath": chunk_name, "sha256": chunk_hash, "shape": list(scores.shape),
                "chunkStepSamples16k": step, "frameHopSamples16k": hop, "frameWindowSamples16k": window,
                "frameOffsetSamples16k": offset, "anonymousReduction": "ONE_MINUS_EMPTY_POWERSET_PROBABILITY",
                "aggregation": "MEAN_OVERLAP_CELL_PROJECTION_10MS"},
            "speakerIdentityPersisted": False, "embeddingPersisted": False, "extraModelForwardCount": 0}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text())
    if request.get("authorized") is not True or request.get("dispatchReserved") is not True:
        raise RuntimeError("C601142_FROZEN_AUTHORIZED_DISPATCH_REQUIRED")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_DATASETS_OFFLINE="1",
                      HF_HUB_DISABLE_TELEMETRY="1", PYANNOTE_METRICS_ENABLED="0")
    for key in list(os.environ):
        if any(v in key.upper() for v in ("TOKEN", "API_KEY", "SECRET")):
            os.environ.pop(key, None)
    started = time.perf_counter()
    # This durable receipt distinguishes a launched request from a result that
    # was actually persisted. The parent reserves the ticket before spawning.
    durable_bytes(Path(request["scoreDirectory"]) / "execution-started.json",
                  json.dumps({"runId": request["runId"], "dispatchReserved": True, "retryAllowed": False}).encode())
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = {"SILERO": silero_run, "PYANNOTE": pyannote_run, "WEBRTC": webrtc_run}[request["family"]](request)
        values = result.pop("scores")
        if any(not math.isfinite(v) or v < -1e-6 or v > 1 + 1e-6 for v in values):
            raise RuntimeError("C601142_SCORE_RANGE_INVALID")
        values = [min(1.0, max(0.0, float(v))) for v in values]
        score_hash = binary_track(Path(request["scoreDirectory"]) / "scores.f32le", values)
        result.update(scoreRelativePath="scores.f32le", scoreSha256=score_hash, scoreFrameCount=len(values))
        message = {"status": "SUCCESS", "runId": request["runId"], "result": result,
                   "inferenceConsumed": ACCOUNTING["inferenceStarted"], "modelLoadCount": ACCOUNTING["modelLoadCount"],
                   "wallClockSeconds": time.perf_counter() - started}
    except Exception as error:
        message = {"status": "FAILED", "runId": request["runId"], "result": None,
                   "inferenceConsumed": ACCOUNTING["inferenceStarted"], "modelLoadCount": ACCOUNTING["modelLoadCount"],
                   "errorCode": type(error).__name__ + ":" + str(error),
                   "wallClockSeconds": time.perf_counter() - started}
    # Recover a lost parent transport from this exact receipt, never rerun ASR.
    durable_bytes(Path(request["scoreDirectory"]) / "result-receipt.json",
                  json.dumps(message, ensure_ascii=False, allow_nan=False).encode())
    print(json.dumps(message, ensure_ascii=False, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
