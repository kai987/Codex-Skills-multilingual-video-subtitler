"""Bounded, offline bridge to the existing CTC worker. No alignment changes."""
import hashlib
import io
import json
import os
import re
import sys
import time
import wave

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")


def save(filename, value):
    with open(filename, "x", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())


def main():
    root = os.path.realpath(sys.argv[1])
    with open(os.path.join(root, "plan.json"), encoding="utf-8") as handle:
        plan = json.load(handle)
    with open(os.path.join(root, "plan-freeze.json"), encoding="utf-8") as handle:
        frozen = json.load(handle)
    with open(os.path.join(root, "plan.json"), "rb") as handle:
        if hashlib.sha256(handle.read()).hexdigest() != frozen["planHash"]:
            raise ValueError("PLAN_CHANGED")
    rows = [r for r in plan["requests"] if r["backend"] == "ctc"]
    if len(rows) != 2 or len(plan["requests"]) != 6 or sum(r["frames"] for r in plan["requests"]) > 120 * 16000:
        raise ValueError("CTC_REQUEST_BUDGET")
    messages = []
    for row in rows:
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,140}", row["id"]) or not 0 < row["frames"] <= 30 * 16000:
            raise ValueError("INVALID_CTC_REQUEST")
        wav = os.path.join(root, row["id"], "input.wav")
        with open(wav, "rb") as handle:
            if hashlib.sha256(handle.read()).hexdigest() != row["wavHash"]:
                raise ValueError("AUDIO_HASH_CHANGED")
        with wave.open(wav) as handle:
            if (handle.getnchannels(), handle.getsampwidth(), handle.getframerate(), handle.getnframes()) != (1, 2, 16000, row["frames"]):
                raise ValueError("AUDIO_FRAME_CONTRACT")
        save(os.path.join(root, row["id"], "reserved.json"), {"request": row, "reservedAt": time.time()})
        messages.append(dict(type="align", requestId=row["id"], audioPath=wav,
                             audioFrameStart=0, audioFrameEnd=row["frames"], device="cpu",
                             alignmentAlgorithmVersion="mvl-ctc-viterbi-v1", targetText=row["targetText"],
                             mediaGlobalStart=row["start"]))
    import torch
    import ctc_worker
    torch.set_num_threads(4)
    emit = ctc_worker.emit
    ids = {r["id"] for r in rows}
    def capture(value):
        if value.get("type") in ("result", "error"):
            if value.get("requestId") not in ids:
                raise ValueError("UNBOUND_CTC_RESULT")
            save(os.path.join(root, value["requestId"], "raw.json"), value)
        emit(value)
    ctc_worker.emit = capture
    sys.stdin = io.StringIO("\n".join(json.dumps(m, ensure_ascii=False) for m in messages) + "\n")
    sys.argv = ["ctc_worker", "--model-directory", plan["ctc"]["model"], "--device", "cpu"]
    return ctc_worker.main()


if __name__ == "__main__":
    raise SystemExit(main())
