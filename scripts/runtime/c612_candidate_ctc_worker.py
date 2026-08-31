#!/usr/bin/env python3
"""Bounded offline target scoring. No decoder, language model or transcript generation.

One encoder pass per core PCM, then CTC loss and Viterbi target occupancy for the
frozen existing targets. Occupancy is conditional evidence, not recognition truth.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

from independent_ctc_discriminator_worker import (  # noqa: E402
    AutoModelForCTC, AutoProcessor, emit, package_version, read_audio,
    representation_score, score_target, torch, np,
)


def target_occupancy(log_probs, token_ids, blank, seconds):
    """Exact CTC target-constrained Viterbi; emits indexes, never token strings."""
    frames = int(log_probs.shape[0])
    if not token_ids or frames < len(token_ids):
        return []
    states = [blank]
    for token in token_ids:
        states.extend([token, blank])
    values = log_probs.numpy()
    count = len(states)
    previous = np.full(count, -np.inf, dtype=np.float64)
    previous[0] = values[0, blank]
    previous[1] = values[0, states[1]]
    back = np.zeros((frames, count), dtype=np.int32)
    for frame in range(1, frames):
        current = np.full(count, -np.inf, dtype=np.float64)
        for state, token in enumerate(states):
            choices = [(previous[state], state)]
            if state > 0:
                choices.append((previous[state - 1], state - 1))
            if state > 1 and token != blank and token != states[state - 2]:
                choices.append((previous[state - 2], state - 2))
            best, parent = max(choices, key=lambda x: (x[0], -x[1]))
            current[state] = best + float(values[frame, token])
            back[frame, state] = parent
        previous = current
    state = max([count - 1, count - 2], key=lambda s: (previous[s], -s))
    if not np.isfinite(previous[state]):
        return []
    occupancy = [[] for _ in token_ids]
    for frame in range(frames - 1, -1, -1):
        if state % 2:
            occupancy[(state - 1) // 2].append(frame)
        state = int(back[frame, state])
    result = []
    for index, spans in enumerate(occupancy):
        if spans:
            # Conservative mean acoustic token posterior, not forced-path certainty.
            posterior = float(np.exp(values[spans, token_ids[index]]).mean())
            result.append({"index": index, "start": min(spans) / frames * seconds,
                           "end": (max(spans) + 1) / frames * seconds,
                           "posterior": min(1.0, max(0.0, posterior))})
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-directory", required=True)
    args = parser.parse_args()
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    processor = AutoProcessor.from_pretrained(args.model_directory, local_files_only=True, trust_remote_code=False)
    model = AutoModelForCTC.from_pretrained(args.model_directory, local_files_only=True, trust_remote_code=False)
    model.to(device="cpu", dtype=torch.float32).eval()
    blank = model.config.pad_token_id
    if blank is None:
        raise ValueError("CTC_BLANK_ID_REQUIRED")
    emit({"type": "ready", "python": platform.python_version(),
          "torch": package_version("torch"), "transformers": package_version("transformers"),
          "numpy": package_version("numpy"), "scipy": package_version("scipy"),
          "device": "cpu", "precision": "fp32", "threads": 1, "modelLoads": 1})
    for line in sys.stdin:
        request = json.loads(line)
        if request.get("type") == "shutdown":
            return 0
        if set(request) != {"type", "requestId", "audioPath", "targets"} or request["type"] != "score-existing":
            raise ValueError("C612_UNSUPPORTED_REQUEST")
        targets = request["targets"]
        if not targets or len(targets) > 12:
            raise ValueError("C612_TARGET_BUDGET")
        audio = read_audio(request["audioPath"])
        if len(audio) > 30 * 16000:
            raise ValueError("C612_WINDOW_BUDGET")
        values = processor(audio, sampling_rate=16000, return_tensors="pt")
        with torch.inference_mode():
            logits = model(values.input_values.to(dtype=torch.float32)).logits[0]
            log_probs = torch.nn.functional.log_softmax(logits, dim=-1).to(device="cpu", dtype=torch.float32)
        rows = []
        for target in targets:
            representations = target["representations"]
            selected = representation_score(processor.tokenizer, representations)
            result = score_target(log_probs, processor.tokenizer, representations, int(blank), 0.95)
            tokens = target_occupancy(log_probs, selected["tokenIds"], int(blank), len(audio) / 16000) if not result["blockers"] else []
            rows.append({"candidateId": target["candidateId"], **result, "supportedTokens": tokens})
        emit({"type": "scores", "requestId": request["requestId"], "forwardPasses": 1, "rows": rows})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
