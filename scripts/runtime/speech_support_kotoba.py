"""Bounded offline candidate batch; no prompts, fallback, or retries."""
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
    with open(os.path.join(root, "asr-plan.json"), "rb") as handle:
        raw = handle.read()
    with open(os.path.join(root, "asr-plan-freeze.json"), encoding="utf8") as handle:
        assert hashlib.sha256(raw).hexdigest() == json.load(handle)["sha256"], "PLAN_CHANGED"
    plan = json.loads(raw)
    rows = plan["probes"]
    assert 0 < len(rows) <= 4 and sum(r["frames"] for r in rows) <= 32 * 16000
    for row in rows:
        wav = os.path.join(root, row["id"], "input.wav")
        assert 0 < row["frames"] <= 8 * 16000
        with open(wav, "rb") as handle:
            assert hashlib.sha256(handle.read()).hexdigest() == row["wavHash"]
        with wave.open(wav) as handle:
            assert (handle.getnchannels(), handle.getsampwidth(), handle.getframerate(), handle.getnframes()) == (1, 2, 16000, row["frames"])
    from faster_whisper import WhisperModel
    model = WhisperModel(plan["model"], device="cpu", compute_type="float32", cpu_threads=4,
                         num_workers=1, local_files_only=True)
    save(os.path.join(root, "kotoba-runtime.json"), {"modelLoadCount": 1, "device": "cpu",
         "versions": {k: importlib.metadata.version(k) for k in ("faster-whisper", "ctranslate2", "numpy", "av")}})
    for row in rows:
        directory = os.path.join(root, row["id"])
        save(os.path.join(directory, "kotoba-reserved.json"), {"at": time.time(), "wavHash": row["wavHash"]})
        print("KOTOBA " + row["id"], flush=True)
        segments, info = model.transcribe(os.path.join(directory, "input.wav"), language="ja", task="transcribe",
            beam_size=5, best_of=5, temperature=0, condition_on_previous_text=False,
            initial_prompt=None, vad_filter=False, word_timestamps=False)
        save(os.path.join(directory, "kotoba-raw.json"), {"segments": [s._asdict() for s in segments],
             "language": info.language, "duration": info.duration})


if __name__ == "__main__":
    main()
