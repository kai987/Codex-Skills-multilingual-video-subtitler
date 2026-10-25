#!/usr/bin/env python3
"""Offline JSONL worker for pyannote Community-1 local diarization."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import math
import os
import sys
import time
from typing import Any


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def package_version(name: str) -> str:
    return importlib.metadata.version(name)


def turns(annotation: Any) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []
    for segment, _, label in annotation.itertracks(yield_label=True):
        start = float(segment.start)
        end = float(segment.end)
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            raise RuntimeError("NON_FINITE_OR_INVALID_DIARIZATION_TURN")
        values.append({"speaker": str(label), "start": start, "end": end})
    values.sort(key=lambda value: (value["start"], value["end"], value["speaker"]))
    return values


def modules_on_device(pipeline: Any, expected: str) -> bool:
    """Verify every materialized torch parameter/buffer after Pipeline.to."""
    observed = 0
    pending: list[tuple[Any, int]] = [(pipeline, 0)]
    seen: set[int] = set()
    while pending:
        value, depth = pending.pop()
        identity = id(value)
        if identity in seen:
            continue
        seen.add(identity)
        if not hasattr(value, "parameters") or not hasattr(value, "buffers"):
            if depth >= 3:
                continue
            if isinstance(value, dict):
                pending.extend((child, depth + 1) for child in value.values())
            elif isinstance(value, (list, tuple, set)):
                pending.extend((child, depth + 1) for child in value)
            elif hasattr(value, "__dict__"):
                pending.extend((child, depth + 1) for child in vars(value).values())
        else:
            for tensor in list(value.parameters()) + list(value.buffers()):
                observed += 1
                if tensor.device.type != expected:
                    return False
    return observed > 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-directory", required=True)
    parser.add_argument("--device", choices=["auto", "mps", "cpu"], default="auto")
    args = parser.parse_args()

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    # This inference-only worker does not render text. Avoid macOS system font
    # discovery in matplotlib (imported by torchmetrics) when its profiler
    # returns no font records; bundled matplotlib fonts remain available.
    os.environ["MPL_IGNORE_SYSTEM_FONTS"] = "1"
    os.environ.pop("HF_TOKEN", None)
    os.environ.pop("HUGGING_FACE_HUB_TOKEN", None)

    import numpy as np
    import soundfile as sf
    import torch
    from pyannote.audio import Pipeline

    mps_available = bool(
        hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
    )
    requested = args.device
    selected = "mps" if requested in {"auto", "mps"} and mps_available else "cpu"
    if requested == "mps" and not mps_available:
        raise RuntimeError("MPS_REQUESTED_BUT_UNAVAILABLE")

    fallback: dict[str, Any] = {
        "applied": False,
        "from": None,
        "to": None,
        "reason": None,
    }
    try:
        pipeline = Pipeline.from_pretrained(args.model_directory)
        pipeline.to(torch.device(selected))
    except Exception as error:
        if requested != "auto" or selected != "mps":
            raise
        selected = "cpu"
        fallback = {
            "applied": True,
            "from": "mps",
            "to": "cpu",
            "reason": type(error).__name__,
        }
        pipeline = Pipeline.from_pretrained(args.model_directory)
        pipeline.to(torch.device("cpu"))

    all_pipeline_modules_on_device = modules_on_device(pipeline, selected)
    if not all_pipeline_modules_on_device:
        if requested == "auto" and selected == "mps":
            selected = "cpu"
            fallback = {
                "applied": True,
                "from": "mps",
                "to": "cpu",
                "reason": "PIPELINE_DEVICE_VERIFICATION_FAILED",
            }
            pipeline = Pipeline.from_pretrained(args.model_directory)
            pipeline.to(torch.device("cpu"))
            all_pipeline_modules_on_device = modules_on_device(pipeline, "cpu")
        else:
            raise RuntimeError("PIPELINE_DEVICE_VERIFICATION_FAILED")

    emit(
        {
            "type": "ready",
            "deviceRequested": requested,
            "deviceUsed": selected,
            "fallback": fallback,
            "mpsAvailable": mps_available,
            "allPipelineModulesOnDevice": all_pipeline_modules_on_device,
            "modelLoadCount": 1,
            "versions": {
                "python": sys.version.split()[0],
                "pyannote.audio": package_version("pyannote.audio"),
                "torch": package_version("torch"),
                "torchaudio": package_version("torchaudio"),
                "huggingface_hub": package_version("huggingface-hub"),
                "numpy": package_version("numpy"),
                "scipy": package_version("scipy"),
                "soundfile": package_version("soundfile"),
            },
        }
    )

    for raw_line in sys.stdin:
        if not raw_line.strip():
            continue
        request = json.loads(raw_line)
        if request.get("type") == "shutdown":
            emit({"type": "shutdown-complete"})
            return 0
        request_id = str(request["requestId"])
        try:
            samples, sample_rate = sf.read(
                str(request["audioPath"]), dtype="float32", always_2d=False
            )
            if sample_rate != 16000:
                raise RuntimeError("SPEAKER_INPUT_SAMPLE_RATE_MUST_BE_16000")
            if samples.ndim != 1:
                raise RuntimeError("SPEAKER_INPUT_MUST_BE_MONO")
            waveform = torch.from_numpy(np.asarray(samples)).unsqueeze(0)
            started = time.perf_counter()
            output = pipeline(
                {"waveform": waveform, "sample_rate": sample_rate},
                min_speakers=int(request["minSpeakers"]),
                max_speakers=int(request["maxSpeakers"]),
            )
            standard = getattr(output, "speaker_diarization", output)
            exclusive = getattr(output, "exclusive_speaker_diarization", None)
            if exclusive is None:
                raise RuntimeError("EXCLUSIVE_SPEAKER_DIARIZATION_UNAVAILABLE")
            standard_turns = turns(standard)
            exclusive_turns = turns(exclusive)
            emit(
                {
                    "type": "result",
                    "requestId": request_id,
                    "standardTurns": standard_turns,
                    "exclusiveTurns": exclusive_turns,
                    "wallClockSeconds": time.perf_counter() - started,
                    "confidenceStatus": "unavailable",
                    "warnings": [],
                }
            )
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "requestId": request_id,
                    "code": type(error).__name__,
                    "message": str(error)[:500],
                }
            )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        emit(
            {
                "type": "fatal",
                "code": type(error).__name__,
                "message": str(error)[:500],
            }
        )
        raise
