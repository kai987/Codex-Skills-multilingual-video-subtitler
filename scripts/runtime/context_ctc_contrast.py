"""Bounded contrast on existing full-window ASR hypotheses; no retries/ASR."""
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
    for b in plan["bindings"]:
        if digest(b["file"]) != b["sha256"]:
            raise ValueError("BOUND_INPUT_CHANGED")
    rows = plan["requests"]
    if not 0 < len(rows) <= 4 or sum(r["frames"] for r in rows) > 24 * 16000:
        raise ValueError("BUDGET")
    messages = []
    for r in rows:
        if not re.fullmatch(r"[a-zA-Z0-9._-]+", r["id"]) or not 0 < r["frames"] <= 8 * 16000:
            raise ValueError("REQUEST_BUDGET")
        wav = os.path.join(root, r["id"], "input.wav")
        if digest(wav) != r["wavHash"]:
            raise ValueError("AUDIO_CHANGED")
        with wave.open(wav) as handle:
            if (handle.getnchannels(), handle.getsampwidth(), handle.getframerate(), handle.getnframes()) != (1, 2, 16000, r["frames"]):
                raise ValueError("AUDIO_CONTRACT")
        messages.append(dict(type="align", requestId=r["id"], audioPath=wav,
                             audioFrameStart=0, audioFrameEnd=r["frames"], device="cpu",
                             alignmentAlgorithmVersion="mvl-ctc-viterbi-v1", targetText=r["targetText"],
                             mediaGlobalStart=r["start"]))
    # Exclusive durable guard precedes imports/model load, even for direct invocation.
    save(os.path.join(root, "worker-reservation.json"), {"requests":len(rows), "frames":sum(r["frames"] for r in rows), "planHash":frozen["planHash"]})
    import torch
    import ctc_worker
    torch.set_num_threads(4)
    emit = ctc_worker.emit
    ids = {r["id"] for r in rows}
    def capture(value):
        kind = value.get("type")
        if kind in ("result", "error"):
            if value.get("requestId") not in ids:
                raise ValueError("UNBOUND_RESULT")
            save(os.path.join(root, value["requestId"], "raw.json"), value)
        elif kind in ("ready", "fatal"):
            save(os.path.join(root, kind + ".json"), value)
        emit(value)
    def requests():
        for m in messages:
            save(os.path.join(root, m["requestId"], "dispatch.json"), {"request":m,"startedAt":time.time()})
            yield json.dumps(m, ensure_ascii=False) + "\n"
    ctc_worker.emit = capture
    sys.stdin = requests()
    sys.argv = ["ctc_worker", "--model-directory", plan["ctc"]["model"], "--device", "cpu"]
    return ctc_worker.main()

if __name__ == "__main__":
    raise SystemExit(main())
