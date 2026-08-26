#!/usr/bin/env python3
"""Persistent, offline Japanese Wav2Vec2 CTC alignment worker for C5.18.1."""

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
import soundfile as sf
import torch
from transformers import AutoProcessor, Wav2Vec2ForCTC


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def fail(code: str, message: str, request_id: str | None = None) -> None:
    emit({"type": "error", "requestId": request_id, "code": code, "message": message[:800]})


def output_length(sample_count: int, kernels: list[int], strides: list[int]) -> int:
    count = sample_count
    for kernel, stride in zip(kernels, strides, strict=True):
        count = math.floor((count - kernel) / stride) + 1
        if count <= 0:
            return 0
    return count


def frame_geometry(kernels: list[int], strides: list[int]) -> tuple[int, int]:
    total_stride = 1
    receptive_field = 1
    for kernel, stride in zip(kernels, strides, strict=True):
        receptive_field += (kernel - 1) * total_stride
        total_stride *= stride
    return total_stride, receptive_field


def viterbi_align(log_probs: np.ndarray, target: list[int], blank_id: int) -> dict[str, Any]:
    """Deterministic float64 CTC Viterbi alignment; no torchaudio APIs."""
    if log_probs.ndim != 2 or log_probs.shape[0] == 0 or log_probs.shape[1] == 0:
        return {"status": "invalid-logits", "tokenSpans": [], "pathScore": None}
    if not np.isfinite(log_probs).all():
        return {"status": "invalid-logits", "tokenSpans": [], "pathScore": None}
    frames, vocabulary = log_probs.shape
    if not target or blank_id < 0 or blank_id >= vocabulary or any(t < 0 or t >= vocabulary for t in target):
        return {"status": "no-valid-path", "tokenSpans": [], "pathScore": None}
    minimum_frames = len(target) + sum(1 for index in range(1, len(target)) if target[index] == target[index - 1])
    if frames < minimum_frames:
        return {"status": "no-valid-path", "tokenSpans": [], "pathScore": None}

    labels: list[int] = []
    for token in target:
        labels.append(blank_id)
        labels.append(token)
    labels.append(blank_id)
    states = len(labels)
    previous = np.full(states, -np.inf, dtype=np.float64)
    back = np.full((frames, states), -1, dtype=np.int32)
    previous[0] = log_probs[0, blank_id]
    previous[1] = log_probs[0, target[0]]

    for frame in range(1, frames):
        current = np.full(states, -np.inf, dtype=np.float64)
        for state in range(states):
            candidates: list[tuple[float, int]] = [(float(previous[state]), state)]
            if state >= 1:
                candidates.append((float(previous[state - 1]), state - 1))
            if state >= 2 and state % 2 == 1 and labels[state] != labels[state - 2]:
                candidates.append((float(previous[state - 2]), state - 2))
            # Stable tie-break: stay, advance one, then skip, because candidates are appended in that order.
            best_score, best_state = max(candidates, key=lambda item: item[0])
            emission = float(log_probs[frame, labels[state]])
            if math.isfinite(best_score) and math.isfinite(emission):
                current[state] = best_score + emission
                back[frame, state] = best_state
        previous = current

    final_candidates = [(float(previous[states - 1]), states - 1), (float(previous[states - 2]), states - 2)]
    final_score, state = max(final_candidates, key=lambda item: item[0])
    if not math.isfinite(final_score):
        return {"status": "no-valid-path", "tokenSpans": [], "pathScore": None}
    state_path = [0] * frames
    for frame in range(frames - 1, -1, -1):
        state_path[frame] = state
        if frame > 0:
            state = int(back[frame, state])
            if state < 0:
                return {"status": "no-valid-path", "tokenSpans": [], "pathScore": None}

    spans: list[dict[str, Any]] = []
    for target_index, token_id in enumerate(target):
        token_state = target_index * 2 + 1
        token_frames = [frame for frame, value in enumerate(state_path) if value == token_state]
        if not token_frames:
            return {"status": "no-valid-path", "tokenSpans": [], "pathScore": None}
        token_log_probabilities = log_probs[token_frames, token_id]
        posterior = float(np.exp(token_log_probabilities).mean())
        spans.append(
            {
                "targetIndex": target_index,
                "tokenId": token_id,
                "startFrame": token_frames[0],
                "endFrameExclusive": token_frames[-1] + 1,
                "meanPosterior": posterior,
                "meanLogPosterior": float(token_log_probabilities.mean()),
                "minLogPosterior": float(token_log_probabilities.min()),
            }
        )
    return {
        "status": "success",
        "tokenSpans": spans,
        "pathScore": final_score,
        "normalizedPathLogScore": final_score / frames,
    }


def collapse_greedy(ids: list[int], blank_id: int) -> list[int]:
    output: list[int] = []
    previous: int | None = None
    for token in ids:
        if token != blank_id and token != previous:
            output.append(token)
        previous = token
    return output


def edit_distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for left_index, left_character in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_character in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_character != right_character),
                )
            )
        previous = current
    return previous[-1]


def select_device(requested: str) -> tuple[str, dict[str, Any], bool]:
    mps_available = bool(torch.backends.mps.is_available())
    if requested == "cpu":
        return "cpu", {"applied": False, "from": None, "to": None, "reason": None}, mps_available
    if requested == "mps":
        if not mps_available:
            raise RuntimeError("MPS_REQUESTED_BUT_UNAVAILABLE")
        return "mps", {"applied": False, "from": None, "to": None, "reason": None}, mps_available
    if mps_available:
        return "mps", {"applied": False, "from": None, "to": None, "reason": None}, mps_available
    return "cpu", {"applied": True, "from": "mps", "to": "cpu", "reason": "MPS_UNAVAILABLE"}, mps_available


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-directory", required=True)
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="auto")
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

    try:
        device_used, fallback, mps_available = select_device(args.device)
        processor = AutoProcessor.from_pretrained(
            args.model_directory,
            local_files_only=True,
            trust_remote_code=False,
        )
        model = Wav2Vec2ForCTC.from_pretrained(
            args.model_directory,
            local_files_only=True,
            trust_remote_code=False,
        )
        model.eval()
        try:
            model.to(device_used)
        except Exception as error:
            if args.device != "auto" or device_used != "mps":
                raise
            device_used = "cpu"
            fallback = {
                "applied": True,
                "from": "mps",
                "to": "cpu",
                "reason": f"MPS_MODEL_LOAD_FAILED:{type(error).__name__}",
            }
            model.to("cpu")
        tokenizer = processor.tokenizer
        vocabulary = tokenizer.get_vocab()
        vocabulary_hash = hashlib.sha256(
            json.dumps(vocabulary, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        blank_id = model.config.pad_token_id
        if blank_id is None:
            blank_id = tokenizer.pad_token_id
        if blank_id is None:
            blank_id = 0
        kernels = [int(value) for value in model.config.conv_kernel]
        strides = [int(value) for value in model.config.conv_stride]
        total_stride, receptive_field = frame_geometry(kernels, strides)
        versions = {
            "python": platform.python_version(),
            "torch": importlib.metadata.version("torch"),
            "transformers": importlib.metadata.version("transformers"),
            "huggingface_hub": importlib.metadata.version("huggingface-hub"),
            "safetensors": importlib.metadata.version("safetensors"),
            "numpy": importlib.metadata.version("numpy"),
            "soundfile": importlib.metadata.version("soundfile"),
        }
        emit(
            {
                "type": "ready",
                "deviceRequested": args.device,
                "deviceUsed": device_used,
                "fallback": fallback,
                "mpsAvailable": mps_available,
                "modelLoadCount": 1,
                "versions": versions,
                "processorClass": processor.__class__.__name__,
                "modelClass": model.__class__.__name__,
                "tokenizerClass": tokenizer.__class__.__name__,
                "tokenizerVocabularyHash": vocabulary_hash,
                "tokenizerVocabularySize": len(vocabulary),
                "blankTokenId": int(blank_id),
                "padTokenId": int(tokenizer.pad_token_id if tokenizer.pad_token_id is not None else blank_id),
                "unknownTokenId": int(tokenizer.unk_token_id) if tokenizer.unk_token_id is not None else None,
                "convKernel": kernels,
                "convStride": strides,
                "totalStrideSamples": total_stride,
                "receptiveFieldSamples": receptive_field,
            }
        )
    except Exception as error:
        emit({"type": "fatal", "code": "CTC_RUNTIME_LOAD_FAILED", "message": f"{type(error).__name__}: {error}"[:800]})
        return 2

    for line in sys.stdin:
        try:
            request = json.loads(line)
        except Exception as error:
            fail("INVALID_JSON", str(error))
            continue
        if request.get("type") == "shutdown":
            return 0
        if request.get("type") != "align":
            fail("UNSUPPORTED_REQUEST", "Only align and shutdown are supported.", request.get("requestId"))
            continue
        request_id = str(request.get("requestId", ""))
        started = time.monotonic()
        try:
            audio, sample_rate = sf.read(str(request["audioPath"]), dtype="float32", always_2d=False)
            if sample_rate != 16_000 or audio.ndim != 1 or len(audio) == 0 or not np.isfinite(audio).all():
                raise ValueError("CTC_AUDIO_MUST_BE_FINITE_MONO_16K")
            if (
                int(request.get("audioFrameStart", -1)) != 0
                or int(request.get("audioFrameEnd", -1)) != len(audio)
                or str(request.get("device", "")) != device_used
                or str(request.get("alignmentAlgorithmVersion", "")) != "mvl-ctc-viterbi-v1"
            ):
                raise ValueError("CTC_WORKER_REQUEST_IDENTITY_MISMATCH")
            target_text = str(request["targetText"])
            encoded = tokenizer(target_text, add_special_tokens=False)
            token_ids = [int(value) for value in encoded.input_ids]
            expected_token_ids = request.get("targetTokenIds")
            if expected_token_ids is not None and [int(value) for value in expected_token_ids] != token_ids:
                raise ValueError("CTC_TARGET_TOKEN_IDS_MISMATCH")
            token_pieces = [str(value) for value in tokenizer.convert_ids_to_tokens(token_ids)]
            unknown_id = tokenizer.unk_token_id
            unknown_count = sum(1 for token in token_ids if unknown_id is not None and token == unknown_id)
            special_ids = set(int(value) for value in tokenizer.all_special_ids)
            special_count = sum(1 for token in token_ids if token in special_ids)
            target_encodable = bool(token_ids) and unknown_count == 0 and special_count == 0
            blockers: list[str] = []
            if not target_encodable:
                blockers.append("CTC_TARGET_UNREPRESENTABLE")
            target = {
                "targetText": target_text,
                "targetTextSha256": hashlib.sha256(target_text.encode("utf-8")).hexdigest(),
                "tokenIds": token_ids,
                "tokenPieces": token_pieces,
                "unknownTokenCount": unknown_count,
                "specialTokenCount": special_count,
                "targetEncodable": target_encodable,
                "blockers": blockers,
            }
            if not target_encodable:
                emit(
                    {
                        "type": "result",
                        "requestId": request_id,
                        "pathStatus": "target-unrepresentable",
                        "target": target,
                        "predictedFrameCount": 0,
                        "expectedFrameCount": output_length(len(audio), kernels, strides),
                        "frameCountVerified": False,
                        "tokenSpans": [],
                        "selectedBoundary": None,
                        "startPinnedToWindowEdge": False,
                        "endPinnedToWindowEdge": False,
                        "meanTokenPosterior": None,
                        "minimumTokenPosterior": None,
                        "alignedTokenMeanLogPosterior": None,
                        "alignedTokenMinLogPosterior": None,
                        "pathScore": None,
                        "normalizedPathLogScore": None,
                        "blankFrameRatio": None,
                        "targetSpanDurationSeconds": None,
                        "targetSpanToWindowRatio": None,
                        "greedyText": "",
                        "greedyTextMatchesTarget": False,
                        "greedyNormalizedSimilarity": 0.0,
                        "greedyEditRatio": 1.0,
                        "workerRequestVerified": True,
                        "wallClockSeconds": time.monotonic() - started,
                        "warnings": [],
                        "blockers": blockers,
                    }
                )
                continue

            inputs = processor(audio, sampling_rate=16_000, return_tensors="pt")
            input_values = inputs.input_values.to(device_used)
            with torch.inference_mode():
                logits = model(input_values).logits[0]
                log_probs = torch.log_softmax(logits, dim=-1).detach().to("cpu", dtype=torch.float64).numpy()
            predicted_frames = int(log_probs.shape[0])
            expected_frames = output_length(len(audio), kernels, strides)
            frame_verified = predicted_frames == expected_frames
            if not frame_verified:
                alignment = {
                    "status": "frame-mapping-invalid",
                    "tokenSpans": [],
                    "pathScore": None,
                    "normalizedPathLogScore": None,
                }
            else:
                alignment = viterbi_align(log_probs, token_ids, int(blank_id))
            greedy_ids = collapse_greedy(np.argmax(log_probs, axis=-1).astype(int).tolist(), int(blank_id))
            greedy_text = tokenizer.decode(greedy_ids, skip_special_tokens=True).replace(" ", "")
            greedy_distance = edit_distance(greedy_text, target_text)
            greedy_similarity = 1.0 - greedy_distance / max(len(greedy_text), len(target_text), 1)
            greedy_edit_ratio = greedy_distance / max(len(target_text), 1)
            spans = alignment["tokenSpans"]
            media_start = float(request["mediaGlobalStart"])
            for span in spans:
                start_sample = span["startFrame"] * total_stride
                last_frame = span["endFrameExclusive"] - 1
                end_sample = min(len(audio), last_frame * total_stride + receptive_field)
                span["token"] = token_pieces[span["targetIndex"]]
                span["startSecondsLocal"] = start_sample / 16_000
                span["endSecondsLocal"] = end_sample / 16_000
                span["startMediaGlobal"] = media_start + span["startSecondsLocal"]
                span["endMediaGlobal"] = media_start + span["endSecondsLocal"]
                first_end_sample = min(len(audio), start_sample + receptive_field)
                last_start_sample = last_frame * total_stride
                span["firstFrameIntervalLocal"] = {
                    "start": start_sample / 16_000,
                    "end": first_end_sample / 16_000,
                }
                span["lastFrameIntervalLocal"] = {
                    "start": last_start_sample / 16_000,
                    "end": end_sample / 16_000,
                }
                span["representativeStartMediaGlobal"] = span["startMediaGlobal"]
                span["representativeEndMediaGlobal"] = span["endMediaGlobal"]
            selected = None
            start_pinned = False
            end_pinned = False
            mean_posterior = None
            minimum_posterior = None
            aligned_mean_log_posterior = None
            aligned_min_log_posterior = None
            target_span_duration = None
            target_span_to_window_ratio = None
            if alignment["status"] == "success" and spans:
                selected = {"start": spans[0]["startMediaGlobal"], "end": spans[-1]["endMediaGlobal"]}
                start_pinned = spans[0]["startFrame"] <= 1
                end_pinned = spans[-1]["endFrameExclusive"] >= predicted_frames - 1
                mean_posterior = sum(float(span["meanPosterior"]) for span in spans) / len(spans)
                minimum_posterior = min(float(span["meanPosterior"]) for span in spans)
                aligned_mean_log_posterior = sum(float(span["meanLogPosterior"]) for span in spans) / len(spans)
                aligned_min_log_posterior = min(float(span["minLogPosterior"]) for span in spans)
                target_span_duration = selected["end"] - selected["start"]
                target_span_to_window_ratio = target_span_duration / (len(audio) / 16_000)
            greedy_frame_ids = np.argmax(log_probs, axis=-1).astype(int)
            blank_frame_ratio = float(np.mean(greedy_frame_ids == int(blank_id)))
            result_blockers = list(blockers)
            if alignment["status"] != "success":
                result_blockers.append(str(alignment["status"]).upper().replace("-", "_"))
            if start_pinned or end_pinned:
                result_blockers.append("CTC_ALIGNMENT_PINNED_TO_WINDOW_EDGE")
            emit(
                {
                    "type": "result",
                    "requestId": request_id,
                    "pathStatus": alignment["status"],
                    "target": target,
                    "predictedFrameCount": predicted_frames,
                    "expectedFrameCount": expected_frames,
                    "frameCountVerified": frame_verified,
                    "tokenSpans": spans,
                    "selectedBoundary": selected,
                    "startPinnedToWindowEdge": start_pinned,
                    "endPinnedToWindowEdge": end_pinned,
                    "meanTokenPosterior": mean_posterior,
                    "minimumTokenPosterior": minimum_posterior,
                    "alignedTokenMeanLogPosterior": aligned_mean_log_posterior,
                    "alignedTokenMinLogPosterior": aligned_min_log_posterior,
                    "pathScore": alignment.get("normalizedPathLogScore"),
                    "normalizedPathLogScore": alignment.get("normalizedPathLogScore"),
                    "blankFrameRatio": blank_frame_ratio,
                    "targetSpanDurationSeconds": target_span_duration,
                    "targetSpanToWindowRatio": target_span_to_window_ratio,
                    "greedyText": greedy_text,
                    "greedyTextMatchesTarget": greedy_text == target_text,
                    "greedyNormalizedSimilarity": greedy_similarity,
                    "greedyEditRatio": greedy_edit_ratio,
                    "workerRequestVerified": True,
                    "wallClockSeconds": time.monotonic() - started,
                    "warnings": [],
                    "blockers": sorted(set(result_blockers)),
                }
            )
        except Exception as error:
            fail("CTC_ALIGNMENT_FAILED", f"{type(error).__name__}: {error}", request_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
