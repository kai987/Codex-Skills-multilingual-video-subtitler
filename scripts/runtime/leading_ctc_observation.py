"""One saved full-context forward. Observe argmax frames without changing the worker."""
import hashlib
import json
import os
import re
import sys
import time
import wave

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")

def digest(filename):
    with open(filename, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()

def save(filename, value):
    with open(filename, "x", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())

def main():
    root = os.path.realpath(sys.argv[1])
    with open(os.path.join(root, "plan-freeze.json"), encoding="utf-8") as handle:
        frozen = json.load(handle)
    if digest(os.path.join(root, "plan.json")) != frozen["planHash"]:
        raise ValueError("PLAN_CHANGED")
    with open(os.path.join(root, "plan.json"), encoding="utf-8") as handle:
        plan = json.load(handle)
    if plan["policy"] != {"maxRequests": 1, "maxWindowSeconds": 8, "maxSeconds": 8, "retries": 0, "subtitleMutationAuthorized": False}:
        raise ValueError("POLICY_CHANGED")
    for b in plan["bindings"]:
        if digest(b["file"]) != b["sha256"]:
            raise ValueError("BOUND_INPUT_CHANGED")
    row = plan["request"]
    if not re.fullmatch(r"[a-zA-Z0-9._-]+", row["id"]) or not 0 < row["frames"] <= 8 * 16000:
        raise ValueError("REQUEST_BUDGET")
    wav = os.path.join(root, "input.wav")
    if digest(wav) != row["wavHash"]:
        raise ValueError("AUDIO_CHANGED")
    with wave.open(wav) as handle:
        if (handle.getnchannels(), handle.getsampwidth(), handle.getframerate(), handle.getnframes()) != (1, 2, 16000, row["frames"]):
            raise ValueError("AUDIO_CONTRACT")
    save(os.path.join(root, "worker-reservation.json"), {"requests": 1, "frames": row["frames"], "planHash": frozen["planHash"]})
    import torch
    import ctc_worker
    torch.set_num_threads(4)
    original_collapse, original_emit = ctc_worker.collapse_greedy, ctc_worker.emit
    original_processor = ctc_worker.AutoProcessor
    class ObservedProcessor:
        @staticmethod
        def from_pretrained(*args, **kwargs):
            processor = original_processor.from_pretrained(*args, **kwargs)
            # Persist actual runtime-added special tokens as well as disk vocab.
            save(os.path.join(root, "runtime-vocabulary.json"), processor.tokenizer.get_vocab())
            return processor
    ctc_worker.AutoProcessor = ObservedProcessor
    captures = []
    def capture_greedy(ids, blank_id):
        collapsed = original_collapse(ids, blank_id)
        if captures:
            raise ValueError("ONE_FORWARD_ONLY")
        captures.append({"requestId": row["id"], "frameTokenIds": ids, "collapsedTokenIds": collapsed, "blankTokenId": blank_id})
        save(os.path.join(root, "greedy-frames.json"), captures[0])
        return collapsed
    def capture(value):
        kind = value.get("type")
        if kind in ("result", "error"):
            if value.get("requestId") != row["id"]:
                raise ValueError("UNBOUND_RESULT")
            save(os.path.join(root, "raw.json"), value)
        elif kind in ("ready", "fatal"):
            save(os.path.join(root, kind + ".json"), value)
        original_emit(value)
    def requests():
        request = dict(type="align", requestId=row["id"], audioPath=wav,
                       audioFrameStart=0, audioFrameEnd=row["frames"], device="cpu",
                       alignmentAlgorithmVersion="mvl-ctc-viterbi-v1", targetText=row["targetText"], mediaGlobalStart=row["start"])
        save(os.path.join(root, "dispatch.json"), {"request": request, "startedAt": time.time()})
        yield json.dumps(request, ensure_ascii=False) + "\n"
    ctc_worker.emit, ctc_worker.collapse_greedy = capture, capture_greedy
    sys.stdin = requests()
    sys.argv = ["ctc_worker", "--model-directory", plan["ctc"]["model"], "--device", "cpu"]
    return ctc_worker.main()

if __name__ == "__main__":
    raise SystemExit(main())
