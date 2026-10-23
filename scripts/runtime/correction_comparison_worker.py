"""Offline bounded comparison, not a production subtitle selector."""
import hashlib
import importlib.metadata
import io
import json
import os
import sys
import time
import wave

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")


def save(p, value):
    with open(p, "x", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())


def emit(v):
    print(json.dumps(v, ensure_ascii=False), flush=True)


def main():
    plan_path, mode = sys.argv[1:3]
    with open(plan_path, encoding="utf-8") as f:
        plan = json.load(f)
    root = os.path.dirname(plan_path)
    rows = [r for r in plan["requests"] if r["mode"] == mode]
    if mode not in ("kotoba", "ctc") or len(rows) != (6 if mode == "kotoba" else 2):
        raise ValueError("BOUNDED_REQUEST_SET")
    for r in rows:
        with open(r["audioPath"], "rb") as f:
            assert hashlib.sha256(f.read()).hexdigest() == r["wavHash"], "AUDIO_CHANGED"
        with wave.open(r["audioPath"]) as w:
            assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 16000, r["samples"])
        assert 0 < r["samples"] <= 30 * 16000
    if mode == "ctc":
        import torch
        import ctc_worker
        torch.set_num_threads(4)
        messages = []
        for r in rows:
            messages.append(dict(type="align", requestId=r["id"], audioPath=r["audioPath"],
                                 audioFrameStart=0, audioFrameEnd=r["samples"], device="cpu",
                                 alignmentAlgorithmVersion="mvl-ctc-viterbi-v1", targetText=r["targetText"],
                                 mediaGlobalStart=r["start"]))
        by_id = {r["id"]: r for r in rows}
        original_emit = ctc_worker.emit
        def capture(v):
            if v.get("type") in ("result", "error"):
                rid = v.get("requestId")
                if rid not in by_id:
                    raise ValueError("UNBOUND_RESULT")
                save(os.path.join(root, rid, "raw.json"), v)
            original_emit(v)
        ctc_worker.emit = capture
        # No retry: reservations persist even if loading or inference fails.
        for r in rows:
            save(os.path.join(root, r["id"], "reserved.json"), {"request": r, "reservedAt": time.time()})
        sys.stdin = io.StringIO("\n".join(json.dumps(v, ensure_ascii=False) for v in messages) + "\n")
        sys.argv = ["ctc_worker", "--model-directory", plan["models"][mode]["path"], "--device", "cpu"]
        raise SystemExit(ctc_worker.main())
    from faster_whisper import WhisperModel
    emit({"type": "load-start", "mode": mode})
    model = WhisperModel(plan["models"][mode]["path"], device="cpu", compute_type="float32",
                         cpu_threads=4, num_workers=1, local_files_only=True)
    emit({"type": "ready", "modelLoadCount": 1, "device": "cpu", "computeType": "float32",
          "versions": {k: importlib.metadata.version(k) for k in ("faster-whisper", "ctranslate2", "numpy", "av")}})
    for r in rows:
        save(os.path.join(root, r["id"], "reserved.json"), {"request": r, "reservedAt": time.time()})
        emit({"type": "inference-start", "requestId": r["id"]})
        started = time.monotonic()
        segments, info = model.transcribe(r["audioPath"], **plan["kotobaDecode"])
        result = {"requestId": r["id"], "segments": [s._asdict() for s in segments],
                  "language": info.language, "duration": info.duration, "wallSeconds": time.monotonic()-started}
        save(os.path.join(root, r["id"], "raw.json"), result)
        emit({"type": "completed", "requestId": r["id"], "wallSeconds": result["wallSeconds"]})


if __name__ == "__main__":
    main()
