#!/usr/bin/env python3
"""Persistent offline SpeechBrain SepFormer observe-only worker for C5.18.1."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import torch
from speechbrain.inference.separation import SepformerSeparation
from speechbrain.utils.fetching import FetchConfig, LocalStrategy


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def select_device(requested: str) -> tuple[str, dict[str, Any]]:
    mps_available = bool(torch.backends.mps.is_available())
    if requested == "cpu":
        return "cpu", {"applied": False, "from": None, "to": None, "reason": None}
    if requested == "mps":
        if not mps_available:
            raise RuntimeError("MPS_REQUESTED_BUT_UNAVAILABLE")
        return "mps", {"applied": False, "from": None, "to": None, "reason": None}
    if mps_available:
        return "mps", {"applied": False, "from": None, "to": None, "reason": None}
    return "cpu", {"applied": True, "from": "mps", "to": "cpu", "reason": "MPS_UNAVAILABLE"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-directory", required=True)
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="cpu")
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    try:
        device, fallback = select_device(args.device)
        model = SepformerSeparation.from_hparams(
            source=args.model_directory,
            savedir=args.model_directory,
            run_opts={"device": device},
            local_strategy=LocalStrategy.NO_LINK,
            fetch_config=FetchConfig(allow_network=False),
        )
        emit({
            "type": "ready",
            "deviceRequested": args.device,
            "deviceUsed": device,
            "fallback": fallback,
            "modelLoadCount": 1,
        })
    except Exception as error:
        emit({"type": "fatal", "code": "SEPARATION_RUNTIME_LOAD_FAILED", "message": f"{type(error).__name__}: {error}"[:800]})
        return 2

    for line in sys.stdin:
        try:
            request = json.loads(line)
        except Exception as error:
            emit({"type": "error", "requestId": None, "code": "INVALID_JSON", "message": str(error)[:800]})
            continue
        if request.get("type") == "shutdown":
            return 0
        request_id = str(request.get("requestId", ""))
        if request.get("type") != "separate":
            emit({"type": "error", "requestId": request_id, "code": "UNSUPPORTED_REQUEST", "message": "Only separate and shutdown are supported."})
            continue
        started = time.monotonic()
        try:
            audio_path = str(request["audioPath"])
            output_a = Path(str(request["outputA"]))
            output_b = Path(str(request["outputB"]))
            mixture, sample_rate = sf.read(audio_path, dtype="float32", always_2d=False)
            if sample_rate != 16_000 or mixture.ndim != 1 or len(mixture) == 0 or not np.isfinite(mixture).all():
                raise ValueError("SEPARATION_AUDIO_MUST_BE_FINITE_MONO_16K")
            estimate = model.separate_file(path=audio_path).detach().to("cpu", dtype=torch.float32).numpy()
            if estimate.ndim != 3 or estimate.shape[0] != 1 or estimate.shape[2] != 2:
                raise ValueError(f"UNEXPECTED_SEPARATION_SHAPE:{estimate.shape}")
            streams = estimate[0]
            if not np.isfinite(streams).all():
                raise ValueError("SEPARATION_OUTPUT_NONFINITE")
            output_a.parent.mkdir(parents=True, exist_ok=True)
            output_b.parent.mkdir(parents=True, exist_ok=True)
            sf.write(output_a, streams[:, 0], 16_000, subtype="PCM_16", format="WAV")
            sf.write(output_b, streams[:, 1], 16_000, subtype="PCM_16", format="WAV")
            emit({
                "type": "result",
                "requestId": request_id,
                "outputA": str(output_a),
                "outputB": str(output_b),
                "inputSampleCount": int(len(mixture)),
                "outputSampleCount": int(streams.shape[0]),
                "wallClockSeconds": time.monotonic() - started,
            })
        except Exception as error:
            emit({"type": "error", "requestId": request_id, "code": "SEPARATION_INFERENCE_FAILED", "message": f"{type(error).__name__}: {error}"[:800]})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
