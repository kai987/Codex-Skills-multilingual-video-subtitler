"""Local-only bounded diagnostic comparison; no prompts or retries."""
import hashlib
import importlib.metadata
import json
import os
import sys
import time
import wave

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")


def save(path, value):
    with open(path, "x", encoding="utf8") as handle:
        json.dump(value, handle, ensure_ascii=False, allow_nan=False)
        handle.flush()
        os.fsync(handle.fileno())


def main():
    root = os.path.realpath(sys.argv[1])
    with open(os.path.join(root, "plan.json"), "rb") as handle:
        raw = handle.read()
    with open(os.path.join(root, "plan-freeze.json")) as handle:
        assert hashlib.sha256(raw).hexdigest() == json.load(handle)["sha256"]
    plan = json.loads(raw)
    rows = plan["windows"]
    assert 0 < len(rows) <= 3 and sum(r["samples"] for r in rows) <= 45 * 16000
    for row in rows:
        wav = os.path.join(root, row["id"], "input.wav")
        with open(wav, "rb") as handle:
            assert hashlib.sha256(handle.read()).hexdigest() == row["audioHash"]
        with wave.open(wav) as handle:
            assert (handle.getnchannels(), handle.getsampwidth(), handle.getframerate(), handle.getnframes()) == (1, 2, 16000, row["samples"])
        assert 0 < row["samples"] <= 15 * 16000
    # Reserve the entire model batch before loading; standalone invocation cannot silently retry.
    save(os.path.join(root, "kotoba-reserved.json"), {"at": time.time(), "requests": len(rows)})
    from faster_whisper import WhisperModel
    model = WhisperModel(plan["kotoba"], device="cpu", compute_type="float32", cpu_threads=4,
                         num_workers=1, local_files_only=True)
    save(os.path.join(root, "kotoba-runtime.json"), {"modelLoadCount": 1, "device": "cpu", "computeType": "float32",
         "versions": {k: importlib.metadata.version(k) for k in ("faster-whisper", "ctranslate2", "numpy", "av")}})
    for row in rows:
        print("KOTOBA " + row["id"], flush=True)
        started = time.monotonic()
        segments, info = model.transcribe(os.path.join(root, row["id"], "input.wav"), **plan["decode"])
        segments = [s._asdict() for s in segments]
        save(os.path.join(root, row["id"], "kotoba.json"), {"requestId": row["id"], "audioHash": row["audioHash"],
             "segments": segments, "language": info.language, "duration": info.duration, "wallSeconds": time.monotonic()-started})


if __name__ == "__main__":
    main()
