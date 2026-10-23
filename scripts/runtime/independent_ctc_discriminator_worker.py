#!/usr/bin/env python3
"""Offline JSONL candidate-conditioned CTC scorer for C6.0.1.11."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import sys
import time
from typing import Any

import numpy as np
import torch
from scipy.io import wavfile
from transformers import AutoModelForCTC, AutoProcessor


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def sha256_json(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unavailable"


def read_audio(path: str) -> np.ndarray:
    sample_rate, values = wavfile.read(path)
    if sample_rate != 16_000 or values.ndim != 1 or values.size == 0:
        raise ValueError("AUDIO_MUST_BE_NONEMPTY_MONO_16K")
    if np.issubdtype(values.dtype, np.integer):
        maximum = float(max(abs(np.iinfo(values.dtype).min), np.iinfo(values.dtype).max))
        audio = values.astype(np.float32) / maximum
    else:
        audio = values.astype(np.float32)
    if not np.isfinite(audio).all():
        raise ValueError("AUDIO_MUST_BE_FINITE")
    return audio


def representation_score(tokenizer: Any, representations: list[dict[str, Any]]) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    unknown_id = tokenizer.unk_token_id
    for order, representation in enumerate(representations):
        text = str(representation["text"])
        token_ids = [int(value) for value in tokenizer(text, add_special_tokens=False).input_ids]
        unknown_count = sum(1 for value in token_ids if unknown_id is not None and value == unknown_id)
        coverage = 0.0 if not token_ids else (len(token_ids) - unknown_count) / len(token_ids)
        candidates.append(
            {
                "representation": str(representation["type"]),
                "representationHash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "text": text,
                "tokenIds": token_ids,
                "encodedTokenCount": len(token_ids),
                "unknownTokenCount": unknown_count,
                "coverageRatio": coverage,
                "order": order,
            }
        )
    return max(
        candidates,
        key=lambda item: (
            float(item["coverageRatio"]),
            int(item["encodedTokenCount"]) > 0,
            -int(item["unknownTokenCount"]),
            -int(item["order"]),
        ),
    )


def score_target(
    log_probs: torch.Tensor,
    tokenizer: Any,
    representations: list[dict[str, Any]],
    blank_id: int,
    minimum_coverage: float,
) -> dict[str, Any]:
    selected = representation_score(tokenizer, representations)
    token_ids = selected.pop("tokenIds")
    selected.pop("text")
    selected.pop("order")
    frames = int(log_probs.shape[0])
    blockers: list[str] = []
    if not token_ids:
        blockers.append("EMPTY_TARGET")
    if float(selected["coverageRatio"]) < minimum_coverage:
        blockers.append("UNSCORABLE_LOW_COVERAGE")
    minimum_frames = len(token_ids) + sum(
        1 for index in range(1, len(token_ids)) if token_ids[index] == token_ids[index - 1]
    )
    if minimum_frames > frames:
        blockers.append("TARGET_LONGER_THAN_ACOUSTIC_PATH")
    raw_nll: float | None = None
    per_token: float | None = None
    if not blockers:
        targets = torch.tensor(token_ids, dtype=torch.long)
        loss = torch.nn.functional.ctc_loss(
            log_probs.unsqueeze(1),
            targets,
            torch.tensor([frames], dtype=torch.long),
            torch.tensor([len(token_ids)], dtype=torch.long),
            blank=blank_id,
            reduction="sum",
            zero_infinity=False,
        )
        raw_nll = float(loss.item())
        if not math.isfinite(raw_nll):
            blockers.append("NONFINITE_CTC_LOSS")
            raw_nll = None
        else:
            per_token = raw_nll / len(token_ids)
    return {
        **selected,
        "rawNll": raw_nll,
        "nllPerTargetToken": per_token,
        "acousticFrameCount": frames,
        "targetCoverage": float(selected["coverageRatio"]),
        "blockers": blockers,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-directory", required=True)
    parser.add_argument("--minimum-coverage", type=float, default=0.95)
    arguments = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    try:
        processor = AutoProcessor.from_pretrained(
            arguments.model_directory,
            local_files_only=True,
            trust_remote_code=False,
        )
        model = AutoModelForCTC.from_pretrained(
            arguments.model_directory,
            local_files_only=True,
            trust_remote_code=False,
        )
        model.to(device="cpu", dtype=torch.float32)
        model.eval()
        tokenizer = processor.tokenizer
        vocabulary = tokenizer.get_vocab()
        blank_id = model.config.pad_token_id
        if blank_id is None:
            blank_id = tokenizer.pad_token_id
        if blank_id is None:
            blank_id = 0
        emit(
            {
                "type": "ready",
                "pythonVersion": platform.python_version(),
                "versions": {
                    "torch": package_version("torch"),
                    "transformers": package_version("transformers"),
                    "scikitLearn": package_version("scikit-learn"),
                    "numpy": package_version("numpy"),
                    "scipy": package_version("scipy"),
                },
                "device": "cpu",
                "precision": "fp32",
                "sampleRate": 16000,
                "processorClass": processor.__class__.__name__,
                "modelClass": model.__class__.__name__,
                "tokenizerClass": tokenizer.__class__.__name__,
                "vocabularyHash": sha256_json(vocabulary),
                "vocabularySize": len(vocabulary),
                "blankTokenId": int(blank_id),
                "unknownTokenId": (
                    int(tokenizer.unk_token_id) if tokenizer.unk_token_id is not None else None
                ),
                "modelLoadCount": 1,
            }
        )
    except Exception as error:
        emit(
            {
                "type": "fatal",
                "code": "INDEPENDENT_CTC_RUNTIME_LOAD_FAILED",
                "message": f"{type(error).__name__}: {error}"[:1000],
            }
        )
        return 2

    for line in sys.stdin:
        request_id: str | None = None
        try:
            request = json.loads(line)
            request_id = str(request.get("requestId", ""))
            if request.get("type") == "shutdown":
                return 0
            if request.get("type") != "score-pair":
                raise ValueError("UNSUPPORTED_REQUEST_TYPE")
            started = time.monotonic()
            audio = read_audio(str(request["audioPath"]))
            values = processor(audio, sampling_rate=16_000, return_tensors="pt")
            with torch.inference_mode():
                logits = model(values.input_values.to(dtype=torch.float32)).logits[0]
                log_probs = torch.nn.functional.log_softmax(logits, dim=-1).to(
                    device="cpu", dtype=torch.float32
                )
            whisper = score_target(
                log_probs,
                tokenizer,
                list(request["whisperRepresentations"]),
                int(blank_id),
                arguments.minimum_coverage,
            )
            reazon = score_target(
                log_probs,
                tokenizer,
                list(request["reazonRepresentations"]),
                int(blank_id),
                arguments.minimum_coverage,
            )
            emit(
                {
                    "type": "score-result",
                    "requestId": request_id,
                    "audioSampleCount": int(audio.shape[0]),
                    "whisper": whisper,
                    "reazon": reazon,
                    "forwardPassCount": 1,
                    "wallClockSeconds": time.monotonic() - started,
                }
            )
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "requestId": request_id,
                    "code": "INDEPENDENT_CTC_SCORE_FAILED",
                    "message": f"{type(error).__name__}: {error}"[:1000],
                }
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
