#!/usr/bin/env python3
"""Persistent offline ReazonSpeech K2 FP32 worker for C6.0.1.9."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import resource
import sys
import time
import wave

import numpy as np
import sherpa_onnx


PAD_SECONDS = 0.9
SAMPLE_RATE = 16_000
EXPECTED_FILES = {
    "encoder": "encoder-epoch-99-avg-1.onnx",
    "decoder": "decoder-epoch-99-avg-1.onnx",
    "joiner": "joiner-epoch-99-avg-1.onnx",
    "tokens": "tokens.txt",
}


def emit(value: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def peak_rss_bytes() -> int:
    # macOS reports ru_maxrss in bytes.
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)


def read_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as stream:
        if stream.getnchannels() != 1:
            raise ValueError("audio-must-be-mono")
        if stream.getframerate() != SAMPLE_RATE:
            raise ValueError("audio-must-be-16khz")
        if stream.getsampwidth() != 2:
            raise ValueError("audio-must-be-s16le")
        frames = stream.readframes(stream.getnframes())
    return np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-directory", required=True)
    parser.add_argument("--threads", type=int, default=1)
    arguments = parser.parse_args()
    model_directory = Path(arguments.model_directory).resolve()
    files = {key: model_directory / value for key, value in EXPECTED_FILES.items()}
    for file in files.values():
        if not file.is_file():
            emit({"type": "fatal", "code": "MODEL_FILE_MISSING", "message": file.name})
            return 2

    load_started = time.monotonic()
    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        tokens=str(files["tokens"]),
        encoder=str(files["encoder"]),
        decoder=str(files["decoder"]),
        joiner=str(files["joiner"]),
        num_threads=arguments.threads,
        sample_rate=SAMPLE_RATE,
        feature_dim=80,
        decoding_method="greedy_search",
        provider="cpu",
    )
    load_seconds = time.monotonic() - load_started
    emit(
        {
            "type": "ready",
            "providerId": "reazonspeech-k2-v2",
            "adapterType": "DIRECT_SHERPA_ONNX_OFFICIAL_REAZON_FP32",
            "pythonVersion": platform.python_version(),
            "sherpaOnnxVersion": importlib.metadata.version("sherpa-onnx"),
            "modelLoadSeconds": load_seconds,
            "modelLoadCount": 1,
            "processStartCount": 1,
            "peakRssBytes": peak_rss_bytes(),
        }
    )

    for line in sys.stdin:
        try:
            message = json.loads(line)
            if message.get("type") == "shutdown":
                return 0
            if message.get("type") != "transcribe":
                continue
            request_id = str(message.get("requestId", ""))
            started = time.monotonic()
            warnings: list[str] = []
            try:
                waveform = read_wav(str(message["audioPath"]))
                raw_seconds = waveform.shape[0] / SAMPLE_RATE
                maximum = float(message.get("maximumPaddedSeconds", 30.0))
                if raw_seconds + 2 * PAD_SECONDS > maximum + 1e-6:
                    raise OverflowError("padded-audio-exceeds-provider-limit")
                padded = np.pad(
                    waveform,
                    pad_width=int(PAD_SECONDS * SAMPLE_RATE),
                    mode="constant",
                )
                stream = recognizer.create_stream()
                stream.accept_waveform(SAMPLE_RATE, padded)
                recognizer.decode_stream(stream)
                result = stream.result
                text = str(result.text or "").strip()
                points = [
                    {"token": str(token), "paddedAudioSeconds": float(timestamp)}
                    for token, timestamp in zip(result.tokens, result.timestamps)
                ]
                status = "SUCCESS" if text else "EMPTY_OUTPUT"
                emit(
                    {
                        "type": "result",
                        "requestId": request_id,
                        "status": status,
                        "text": text,
                        "tokenPoints": points,
                        "wallClockSeconds": time.monotonic() - started,
                        "warnings": warnings,
                        "peakRssBytes": peak_rss_bytes(),
                    }
                )
            except OverflowError as error:
                emit(
                    {
                        "type": "result",
                        "requestId": request_id,
                        "status": "UNSUPPORTED_DURATION",
                        "text": "",
                        "tokenPoints": [],
                        "wallClockSeconds": time.monotonic() - started,
                        "warnings": [str(error)],
                        "peakRssBytes": peak_rss_bytes(),
                    }
                )
            except (ValueError, wave.Error) as error:
                emit(
                    {
                        "type": "result",
                        "requestId": request_id,
                        "status": "INVALID_AUDIO",
                        "text": "",
                        "tokenPoints": [],
                        "wallClockSeconds": time.monotonic() - started,
                        "warnings": [str(error)],
                        "peakRssBytes": peak_rss_bytes(),
                    }
                )
            except Exception as error:  # fail closed per-request, keep worker alive
                emit(
                    {
                        "type": "result",
                        "requestId": request_id,
                        "status": "MODEL_FAILURE",
                        "text": "",
                        "tokenPoints": [],
                        "wallClockSeconds": time.monotonic() - started,
                        "warnings": [f"{type(error).__name__}:{error}"[:500]],
                        "peakRssBytes": peak_rss_bytes(),
                    }
                )
        except Exception as error:
            emit(
                {
                    "type": "fatal",
                    "code": "INVALID_WORKER_REQUEST",
                    "message": f"{type(error).__name__}:{error}"[:500],
                }
            )
            return 3
    return 0


if __name__ == "__main__":
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    raise SystemExit(main())
