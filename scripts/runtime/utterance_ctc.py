"""Two timing-only requests through the existing offline CTC worker; no retries."""
import hashlib
import io
import json
import os
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
    for item in plan["bindings"]:
        if digest(item["file"]) != item["sha256"]:
            raise ValueError("BOUND_INPUT_CHANGED")
    rows = plan["association"]["requests"]
    if len(rows) != 2 or sum(r["frames"] for r in rows) > 12 * 16000:
        raise ValueError("CTC_REQUEST_BUDGET")
    if rows[0]["targetId"] != rows[1]["targetId"] or rows[0]["targetText"] != rows[1]["targetText"]:
        raise ValueError("CTC_TARGET_MISMATCH")
    messages = []
    for row in rows:
        wav = os.path.join(root, row["id"], "input.wav")
        if digest(wav) != row["wavHash"]:
            raise ValueError("AUDIO_CHANGED")
        with wave.open(wav) as handle:
            if (handle.getnchannels(), handle.getsampwidth(), handle.getframerate(), handle.getnframes()) != (1, 2, 16000, row["frames"]):
                raise ValueError("INVALID_AUDIO")
        save(os.path.join(root, row["id"], "reserved.json"), {"request": row, "time": time.time()})
        messages.append(dict(type="align", requestId=row["id"], audioPath=wav,
                             audioFrameStart=0, audioFrameEnd=row["frames"], device="cpu",
                             alignmentAlgorithmVersion="mvl-ctc-viterbi-v1", targetText=row["targetText"],
                             mediaGlobalStart=row["start"]))
    import torch
    import ctc_worker
    torch.set_num_threads(4)
    original_emit = ctc_worker.emit
    ids = {r["id"] for r in rows}

    def capture(value):
        kind = value.get("type")
        if kind in ("result", "error"):
            if value.get("requestId") not in ids:
                raise ValueError("UNBOUND_RESULT")
            save(os.path.join(root, value["requestId"], "raw.json"), value)
        elif kind in ("ready", "fatal"):
            save(os.path.join(root, kind + ".json"), value)
        original_emit(value)

    ctc_worker.emit = capture
    sys.stdin = io.StringIO("\n".join(json.dumps(m, ensure_ascii=False) for m in messages) + "\n")
    sys.argv = ["ctc_worker", "--model-directory", plan["ctc"]["model"], "--device", "cpu"]
    return ctc_worker.main()


if __name__ == "__main__":
    raise SystemExit(main())
