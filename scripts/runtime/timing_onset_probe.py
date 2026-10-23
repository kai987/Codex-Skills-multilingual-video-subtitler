"""Bounded local CT2 Whisper word timestamps + Silero. No prompt, download or automatic retry."""
import contextlib
import hashlib
import importlib.metadata
import json
import os
import sys
import wave
from types import SimpleNamespace
from bounded_silero import register_backends
from c601141_speech_activity_worker import Silero
from ct2_timing_contract import inspect

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")


def save(p, v):
    with open(p, "x", encoding="utf8") as f:
        json.dump(v, f, ensure_ascii=False, allow_nan=False)
        f.flush()
        os.fsync(f.fileno())


def main():
    root = os.path.realpath(sys.argv[1])
    with open(root + "/plan.json", "rb") as f:
        data = f.read()
    with open(root + "/plan-freeze.json", encoding="utf8") as f:
        assert hashlib.sha256(data).hexdigest() == json.load(f)["planHash"]
    p = json.loads(data)
    contract = inspect(p["runtime"]["asrModel"])
    if not contract["compatible"]:
        raise ValueError("UNSUPPORTED_WORD_TIMING_ALIGNMENT_HEADS")
    targets = p["planned"]["targets"]
    assert 0 < len(targets) <= 4
    assert sum(t["endFrame"] - t["firstFrame"] for t in targets) * 2 <= 120 * 16000
    for t in targets:
        assert t["id"] == "cue-" + str(t["cueNumber"])
        assert 0 < t["endFrame"] - t["firstFrame"] <= 20 * 16000
        wav = root + "/" + t["id"] + "/input.wav"
        with open(wav, "rb") as f:
            assert hashlib.sha256(f.read()).hexdigest() == t["audioHash"]
        with wave.open(wav) as f:
            assert (f.getnchannels(), f.getsampwidth(), f.getframerate(), f.getnframes()) == (1, 2, 16000, t["endFrame"] - t["firstFrame"])
    # Exclusive worker reservation, as well as the caller's dispatch reservation.
    save(root + "/worker-reservation.json", {"asr": len(targets), "vad": len(targets), "retries": 0})
    from faster_whisper import WhisperModel
    model = WhisperModel(p["runtime"]["asrModel"], device="cpu", compute_type="float32", cpu_threads=4, num_workers=1, local_files_only=True)
    register_backends(p["runtime"]["vadLibrary"])
    vad = Silero(SimpleNamespace(model=p["runtime"]["vadModel"], library=p["runtime"]["vadLibrary"]))
    save(root + "/runtime.json", {"asrModelLoads": 1, "vadModelLoads": 1, "device": "cpu", "versions": {k: importlib.metadata.version(k) for k in ("faster-whisper", "ctranslate2", "numpy")}})
    try:
        for t in targets:
            directory = root + "/" + t["id"]
            wav = directory + "/input.wav"
            save(directory + "/reserved.json", {"asr": 1, "vad": 1})
            print(t["id"] + " ASR+VAD", flush=True)
            segments, info = model.transcribe(wav, language="ja", task="transcribe", beam_size=5, best_of=5, temperature=0, condition_on_previous_text=False, initial_prompt=None, vad_filter=False, word_timestamps=True)
            rows = []
            for s in segments:
                row = s._asdict()
                row["words"] = [w._asdict() for w in s.words or []]
                rows.append(row)
            save(directory + "/asr.json", {"segments": rows, "language": info.language, "duration": info.duration})
            with contextlib.redirect_stdout(sys.stderr):
                activity = vad.run({"audioPath": wav, "profile": p["vadProfile"]})
            save(directory + "/raw.json", {"id": t["id"], "frames": t["endFrame"] - t["firstFrame"], "segments": rows, "language": info.language, "vad": activity})
    finally:
        vad.close()


if __name__ == "__main__":
    main()
