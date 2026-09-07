#!/usr/bin/env python3
"""C6.0.1.16.4 conditional alignment only; no greedy/beam ASR decode.

Uses the installed pinned CTC runtime and existing deterministic Viterbi code.
One request is one complete stored machine transcript and one physical WAV.
No padding, resampling, retry, download, dynamic fallback or text correction.
"""
import hashlib
import importlib.metadata
import json
import os
import platform
import sys
import time

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
from ctc_worker import viterbi_align, output_length, frame_geometry
import numpy as np
import soundfile as sf
import torch
from transformers import AutoProcessor, Wav2Vec2ForCTC


def emit(v):
    print(json.dumps(v, ensure_ascii=False, separators=(",", ":")), flush=True)


def main():
    model_dir = sys.argv[1]
    torch.set_num_threads(8)
    emit({"type": "model-load-start", "device": "cpu", "modelLoadAttempt": 1})
    processor = AutoProcessor.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
    model = Wav2Vec2ForCTC.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
    model.eval().to("cpu")
    kernels, strides = list(model.config.conv_kernel), list(model.config.conv_stride)
    stride, receptive = frame_geometry(kernels, strides)
    tokenizer = processor.tokenizer
    emit({"type": "ready", "device": "cpu", "dtype": "float32", "python": platform.python_version(),
          "versions": {k: importlib.metadata.version(k) for k in ["torch", "transformers", "numpy", "soundfile"]},
          "modelLoadCount": 1, "convKernel": kernels, "convStride": strides,
          "strideSamples": stride, "receptiveFieldSamples": receptive, "threads": 8})
    for line in sys.stdin:
        request = json.loads(line)
        if request.get("type") == "shutdown":
            return
        rid, target = request["requestId"], request["targetText"]
        started = time.monotonic()
        forward = 0
        result = {"requestId": rid, "status": "FAILED", "targetText": target, "pieces": [], "reasons": []}
        try:
            with open(request["audioPath"], "rb") as f:
                if hashlib.sha256(f.read()).hexdigest() != request["audioHash"]:
                    raise ValueError("AUDIO_HASH_MISMATCH")
            audio, rate = sf.read(request["audioPath"], dtype="float32", always_2d=False)
            if rate != 16000 or audio.ndim != 1 or len(audio) != request["sampleCount"] or len(audio) > 30 * rate or not np.isfinite(audio).all():
                raise ValueError("PHYSICAL_WAV_MISMATCH")
            ids = list(tokenizer(target, add_special_tokens=False).input_ids)
            pieces = tokenizer.convert_ids_to_tokens(ids)
            if not ids or tokenizer.unk_token_id in ids or any(i in tokenizer.all_special_ids for i in ids) or "".join(pieces) != target:
                result.update(status="UNREPRESENTABLE", reasons=["COMPLETE_JAPANESE_TEXT_SYMBOL_MAPPING_UNAVAILABLE"])
            else:
                inputs = processor(audio, sampling_rate=rate, return_tensors="pt")
                emit({"type": "acoustic-forward-start", "requestId": rid, "audioSeconds": len(audio)/rate, "paddingSeconds": 0})
                forward = 1
                with torch.inference_mode():
                    logits = model(inputs.input_values).logits[0]
                    probs = torch.log_softmax(logits, -1).to("cpu", dtype=torch.float64).numpy()
                if probs.shape[0] != output_length(len(audio), kernels, strides):
                    raise ValueError("FRAME_GEOMETRY_MISMATCH")
                aligned = viterbi_align(probs, ids, int(model.config.pad_token_id))
                if aligned["status"] != "success":
                    result["reasons"] = ["NO_VALID_CTC_PATH"]
                else:
                    for s in aligned["tokenSpans"]:
                        # Receptive fields can overlap by 5ms. Use frame-cell edges
                        # (not receptive envelopes) consistently for disjoint symbol
                        # ownership; uncertainty is recorded in the ready geometry.
                        start = s["startFrame"] * stride / rate
                        end = s["endFrameExclusive"] * stride / rate
                        result["pieces"].append({"text": pieces[s["targetIndex"]], "tokenId": s["tokenId"],
                            "start": request["mediaGlobalStart"] + start, "end": request["mediaGlobalStart"] + end,
                            "startFrame": s["startFrame"], "endFrameExclusive": s["endFrameExclusive"]})
                    result["status"] = "SUCCESS"
                emit({"type": "alignment-diagnostic", "requestId": rid, "frames": int(probs.shape[0]),
                      "pathStatus": aligned["status"], "tokenSpans": aligned["tokenSpans"],
                      "normalizedPathLogScore": aligned.get("normalizedPathLogScore"),
                      "interpretation": "CONDITIONAL_TIMING_NOT_LEXICAL_VERIFICATION"})
        except Exception as e:
            result["reasons"] = [type(e).__name__ + ":" + str(e)[:500]]
        emit({"type": "result", "result": result, "acousticForwardCount": forward,
              "wallSeconds": time.monotonic()-started, "retryPerformed": False})


if __name__ == "__main__":
    main()
