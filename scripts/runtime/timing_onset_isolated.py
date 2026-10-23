"""ASR and VAD execute in distinct fresh subprocesses. No mixed native runtimes."""
import hashlib
import importlib.metadata
import json
import os
import subprocess
import sys
import wave
from dataclasses import asdict


def save(path, value):
    with open(path, "x", encoding="utf8") as f:
        json.dump(value, f, ensure_ascii=False, allow_nan=False)
        f.flush()
        os.fsync(f.fileno())


def main():
    root = os.path.realpath(sys.argv[1])
    stage = sys.argv[2] if len(sys.argv) == 3 else None
    with open(root + "/plan.json", "rb") as f:
        data = f.read()
    with open(root + "/plan-freeze.json", encoding="utf8") as f:
        assert hashlib.sha256(data).hexdigest() == json.load(f)["planHash"]
    p = json.loads(data)
    reuse = {r["id"]: r for r in p["interrupted"]["reuse"]}
    targets = p["planned"]["targets"]
    assert 0 < len(targets) <= 4
    assert sum(t["endFrame"] - t["firstFrame"] for t in targets) * 2 <= 120 * 16000
    fresh = [t for t in targets if t["id"] not in reuse]
    assert fresh
    for t in targets:
        assert t["id"] == "cue-" + str(t["cueNumber"])
        wav = root + "/" + t["id"] + "/input.wav"
        with open(wav, "rb") as f:
            assert hashlib.sha256(f.read()).hexdigest() == t["audioHash"]
        with wave.open(wav) as f:
            assert (f.getnchannels(), f.getsampwidth(), f.getframerate(), f.getnframes()) == (1, 2, 16000, t["endFrame"] - t["firstFrame"])
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
    if stage == "asr":
        from ct2_timing_contract import inspect
        assert inspect(p["runtime"]["asrModel"])["compatible"]
        from faster_whisper import WhisperModel
        model = WhisperModel(p["runtime"]["asrModel"], device="cpu", compute_type="float32", cpu_threads=4, num_workers=1, local_files_only=True)
        save(root + "/asr-runtime.json", {"pid": os.getpid(), "modelLoads": 1, "versions": {k: importlib.metadata.version(k) for k in ("faster-whisper", "ctranslate2", "numpy")}})
        for t in fresh:
            d = root + "/" + t["id"]
            save(d + "/reserved.json", {"asr": 1, "vad": 1})
            print(t["id"] + " ASR", flush=True)
            segments, info = model.transcribe(d + "/input.wav", language="ja", task="transcribe", beam_size=5, best_of=5, temperature=0, condition_on_previous_text=False, initial_prompt=None, vad_filter=False, word_timestamps=True)
            save(d + "/asr.json", {"segments": [asdict(s) for s in segments], "language": info.language, "duration": info.duration})
    elif stage == "vad":
        from types import SimpleNamespace
        from bounded_silero import register_backends
        from c601141_speech_activity_worker import Silero
        register_backends(p["runtime"]["vadLibrary"])
        vad = Silero(SimpleNamespace(model=p["runtime"]["vadModel"], library=p["runtime"]["vadLibrary"]))
        save(root + "/vad-runtime.json", {"pid": os.getpid(), "modelLoads": 1})
        try:
            for t in fresh:
                d = root + "/" + t["id"]
                print(t["id"] + " VAD", flush=True)
                save(d + "/vad-reserved.json", {"vad": 1})
                save(d + "/vad.json", vad.run({"audioPath": d + "/input.wav", "profile": p["vadProfile"]}))
        finally:
            vad.close()
    elif stage is None:
        save(root + "/worker-reservation.json", {"asr": len(fresh), "vad": len(fresh), "retries": 0})
        for mode in ("asr", "vad"):
            child = subprocess.run([sys.executable, __file__, root, mode], check=False)
            save(root + "/" + mode + "-exit.json", {"returncode": child.returncode})
            if child.returncode != 0:
                raise RuntimeError(mode + "_FAILED_NO_RETRY")
        for t in targets:
            d = root + "/" + t["id"]
            if t["id"] in reuse:
                save(d + "/reserved.json", {"asr": 0, "vad": 0})
                with open(d + "/asr.json", "rb") as f:
                    assert hashlib.sha256(f.read()).hexdigest() == reuse[t["id"]]["sha256"]
            with open(d + "/asr.json", encoding="utf8") as f:
                asr = json.load(f)
            vad = None
            if t["id"] not in reuse:
                with open(d + "/vad.json", encoding="utf8") as f:
                    vad = json.load(f)
            save(d + "/raw.json", {"id": t["id"], "frames": t["endFrame"] - t["firstFrame"], "segments": asr["segments"], "language": asr["language"], "vad": vad})
        with open(root + "/asr-runtime.json") as f:
            asr = json.load(f)
        with open(root + "/vad-runtime.json") as f:
            vad = json.load(f)
        assert asr["pid"] != vad["pid"]
        save(root + "/runtime.json", {"asrModelLoads": 1, "vadModelLoads": 1, "device": "cpu", "processIsolation": True, "asrPid": asr["pid"], "vadPid": vad["pid"], "versions": asr["versions"]})
    else:
        raise ValueError("UNKNOWN_STAGE")


if __name__ == "__main__":
    main()
