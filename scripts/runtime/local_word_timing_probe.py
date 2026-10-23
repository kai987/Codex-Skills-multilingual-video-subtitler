"""Finite offline word-timing experiment on already frozen recovery crops.

No transcript prompts, subtitle writes, VAD, automatic retries or model downloads.
Raw word timing is diagnostic; it never independently authorizes cue mutations.
"""
import hashlib
import importlib.metadata
import json
import math
from numbers import Real
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import wave
from dataclasses import asdict

from ct2_timing_contract import inspect


def sha(path):
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf8"))


def save(path, value):
    with open(path, "x", encoding="utf8") as handle:
        json.dump(value, handle, ensure_ascii=False, allow_nan=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def identity(path):
    return {"path": str(Path(path).absolute()), "sha256": sha(path)}


def check_identities(items):
    for item in items:
        require(sha(item["path"]) == item["sha256"], "IDENTITY_CHANGED:" + item["path"])


def prepare(source, model, parent, ids):
    require(0 < len(ids) <= 2 and len(set(ids)) == len(ids), "MAX_TWO_UNIQUE_TARGETS")
    source, model = Path(source).resolve(), Path(model).resolve()
    old = read(source / "plan.json")
    selected = [next(p for p in old["probes"] if p["id"] == key) for key in ids]
    require(all(0 < p["frames"] <= 8 * 16000 for p in selected), "CROP_BUDGET")
    capability = inspect(model)
    require(capability["compatible"], "INCOMPATIBLE_WORD_TIMING_RUNTIME")
    source_audio = next(i for i in old["inputs"] if i["file"].endswith("/audio.wav"))
    require(sha(source_audio["file"]) == source_audio["sha256"], "SOURCE_AUDIO_CHANGED")
    for p in selected:
        require(p["id"].replace("-", "").isalnum(), "UNSAFE_TARGET_ID")
        crop = source / p["id"] / "input.wav"
        require(sha(crop) == p["wavHash"], "CROP_CHANGED")
        with wave.open(str(crop)) as wav, wave.open(source_audio["file"]) as full:
            require((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes())
                    == (1, 2, 16000, p["frames"]), "INVALID_CROP_PCM")
            require((full.getnchannels(), full.getsampwidth(), full.getframerate())
                    == (1, 2, 16000), "INVALID_SOURCE_PCM")
            require(abs((p["end"] - p["start"]) * 16000 - p["frames"]) < 0.01,
                    "WINDOW_FRAME_MISMATCH")
            full.setpos(round(p["start"] * 16000))
            require(full.readframes(p["frames"]) == wav.readframes(p["frames"]), "SOURCE_PCM_MISMATCH")
    Path(parent).mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="word-timing-", dir=parent)).resolve()
    targets = []
    for p in selected:
        (root / p["id"]).mkdir()
        shutil.copyfile(source / p["id"] / "input.wav", root / p["id"] / "input.wav")
        targets.append({k: p[k] for k in ("id", "start", "end", "targetStart", "targetEnd", "frames", "wavHash")})
    plan = {
        "version": "bounded-word-timing-probe-v1", "sourceRoot": str(source),
        "targets": targets, "model": str(model), "capability": capability,
        "budget": {"requests": len(targets), "audioSeconds": sum(p["frames"] for p in targets) / 16000,
                   "modelLoads": 1, "retries": 0, "timeoutSeconds": 180},
        "runtime": {"python": sys.version, "device": "cpu", "computeType": "float32", "threads": 4,
                    "versions": {k: importlib.metadata.version(k) for k in ("faster-whisper", "ctranslate2", "numpy")}},
        "decode": {"language": "ja", "task": "transcribe", "beam_size": 5, "best_of": 5,
                   "temperature": 0, "condition_on_previous_text": False, "initial_prompt": None,
                   "vad_filter": False, "word_timestamps": True},
        "bindings": [identity(source / "plan.json"), identity(source_audio["file"]),
                     identity(sys.executable), identity(__file__), identity(Path(__file__).with_name("ct2_timing_contract.py"))]
                    + [identity(f) for f in sorted(model.iterdir()) if f.is_file()],
        "referenceUsed": False, "labelsUsed": False, "subtitleMutationAuthorized": False,
    }
    save(root / "plan.json", plan)
    save(root / "plan-freeze.json", {"planHash": sha(root / "plan.json")})
    return str(root)


def validate(root, historical=False):
    require(sha(root / "plan.json") == read(root / "plan-freeze.json")["planHash"], "PLAN_CHANGED")
    plan = read(root / "plan.json")
    require(0 < len(plan["targets"]) <= 2, "TARGET_BUDGET")
    require(plan["budget"]["requests"] == len(plan["targets"]), "REQUEST_BUDGET")
    require(plan["budget"]["audioSeconds"] == sum(t["frames"] for t in plan["targets"]) / 16000 <= 16, "AUDIO_BUDGET")
    require(plan["budget"]["retries"] == 0 and plan["budget"]["modelLoads"] == 1, "LOAD_BUDGET")
    require(plan["decode"]["word_timestamps"] and not plan["decode"]["vad_filter"]
            and plan["decode"]["initial_prompt"] is None, "DECODE_CONTRACT")
    for binding in plan["bindings"]:
        if historical and Path(binding["path"]).resolve() == Path(__file__).resolve():
            require(sha(root / "execution-source-snapshot.py") == binding["sha256"], "EXECUTION_SOURCE_CHANGED")
        else:
            check_identities([binding])
    for t in plan["targets"]:
        require(sha(root / t["id"] / "input.wav") == t["wavHash"], "CROP_CHANGED")
    return plan


def audit(raw, target):
    duration = target["frames"] / 16000
    rows = []
    previous = -math.inf
    for segment_index, segment in enumerate(raw["segments"]):
        words = segment.get("words") or []
        matching_text = "".join(w["word"] for w in words).strip() == segment["text"].strip()
        for word_index, word in enumerate(words):
            start, end = word["start"], word["end"]
            issues = []
            valid_numbers = all(isinstance(x, Real) and not isinstance(x, bool)
                                and math.isfinite(x) for x in (start, end))
            if not valid_numbers or not 0 <= start < end <= duration:
                issues.append("INVALID_LOCAL_INTERVAL")
            if valid_numbers:
                if start < previous:
                    issues.append("NON_MONOTONIC_WORDS")
                previous = end
                if start < segment["start"] or end > segment["end"]:
                    issues.append("OUTSIDE_PARENT_SEGMENT")
                if start <= 0.03 or end >= duration - 0.03:
                    issues.append("CROP_EDGE_WORD")
            if not matching_text:
                issues.append("WORD_TEXT_ACCOUNTING_MISMATCH")
            rows.append({"segmentIndex": segment_index, "wordIndex": word_index, "raw": word,
                         "sourceStart": round(target["start"] + start, 6) if valid_numbers else None,
                         "sourceEnd": round(target["start"] + end, 6) if valid_numbers else None,
                         "issues": issues, "structurallyUsable": not issues,
                         "timingQualityVerified": False, "subtitleMutationAuthorized": False})
    return {"id": target["id"], "timebase": "original-audio-local-plus-extraction-offset",
            "words": rows, "missingWords": not rows, "status": "needs-review",
            "finalizationMethod": "none"}


def worker(root):
    plan = validate(root)
    # Exclusive reservation happens before importing/loading the model, and prevents reuse.
    save(root / "reservation.json", plan["budget"])
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
    from faster_whisper import WhisperModel
    started = time.monotonic()
    model = WhisperModel(plan["model"], device="cpu", compute_type="float32", cpu_threads=4,
                         num_workers=1, local_files_only=True)
    save(root / "runtime.json", {**plan["runtime"], "pid": os.getpid(), "modelLoads": 1,
                                "loadSeconds": time.monotonic() - started})
    for target in plan["targets"]:
        folder = root / target["id"]
        save(folder / "reserved.json", {"requests": 1, "retries": 0})
        print(target["id"] + " word-timing ASR", flush=True)
        start = time.monotonic()
        segments, info = model.transcribe(str(folder / "input.wav"), **plan["decode"])
        raw = {"segments": [asdict(s) for s in segments], "language": info.language,
               "duration": info.duration, "elapsedSeconds": time.monotonic() - start}
        save(folder / "raw.json", raw)
        save(folder / "word-audit.json", audit(raw, target))


def run(root):
    # Lock even failed/timed-out execution. Never repeat a native request implicitly.
    save(root / "launch.json", {"worker": str(Path(__file__).resolve()), "retries": 0})
    with open(root / "worker.log", "x") as log:
        try:
            child = subprocess.run([sys.executable, __file__, "_worker", str(root)], stdout=log,
                                   stderr=subprocess.STDOUT, timeout=180, check=False)
            result = {"returncode": child.returncode, "timeout": False}
        except subprocess.TimeoutExpired:
            result = {"returncode": None, "timeout": True}
    save(root / "exit.json", result)
    if result["returncode"] != 0:
        raise RuntimeError("WORKER_FAILED_NO_RETRY")
    files = [p for p in sorted(root.rglob("*")) if p.is_file()]
    save(root / "result-freeze.json", {"files": [{"path": str(p.relative_to(root)), "sha256": sha(p)} for p in files]})
    return verify(root)


def verify(root):
    plan = validate(root)
    for item in read(root / "result-freeze.json")["files"]:
        relative = Path(item["path"])
        require(not relative.is_absolute() and ".." not in relative.parts, "UNSAFE_MANIFEST_PATH")
        require(sha(root / relative) == item["sha256"], "RESULT_CHANGED")
    for target in plan["targets"]:
        folder = root / target["id"]
        require(audit(read(folder / "raw.json"), target) == read(folder / "word-audit.json"), "AUDIT_REPLAY_MISMATCH")
    return {"integrity": "passed", "recordedRequests": len(plan["targets"]),
            "recordedAudioSeconds": plan["budget"]["audioSeconds"], "recordedModelLoads": 1,
            "verificationInference": 0, "subtitleMutations": 0, "root": str(root)}


def verify_saved_execution(root):
    plan = validate(root, historical=True)
    for item in read(root / "result-freeze.json")["files"]:
        relative = Path(item["path"])
        require(not relative.is_absolute() and ".." not in relative.parts, "UNSAFE_MANIFEST_PATH")
        require(sha(root / relative) == item["sha256"], "RESULT_CHANGED")
    require(read(root / "exit.json") == {"returncode": 0, "timeout": False}, "NATIVE_EXECUTION_FAILED")
    require(read(root / "reservation.json") == plan["budget"], "RESERVATION_MISMATCH")
    require(read(root / "runtime.json")["modelLoads"] == 1, "LOAD_COUNT_MISMATCH")
    for target in plan["targets"]:
        require(read(root / target["id"] / "reserved.json") == {"requests": 1, "retries": 0}, "REQUEST_COUNT_MISMATCH")
    return plan


def recover_audit(root):
    """Recover analysis only; preserve the failed original audits and execution."""
    plan = verify_saved_execution(root)
    out = Path(tempfile.mkdtemp(prefix="audit-recovery-", dir=root.parent))
    corrected = [audit(read(root / t["id"] / "raw.json"), t) for t in plan["targets"]]
    save(out / "word-audits.json", corrected)
    save(out / "provenance.json", {
        "sourceRoot": str(root), "sourceFreeze": identity(root / "result-freeze.json"),
        "analysisSource": identity(__file__), "executionSource": identity(root / "execution-source-snapshot.py"),
        "reason": "Python exact-type check rejected numpy floating timestamps before JSON serialization",
        "originalAuditPreserved": True, "newInference": 0, "newModelLoads": 0,
        "subtitleMutations": 0, "status": "needs-review", "finalizationMethod": "none",
    })
    save(out / "freeze.json", {"files": [identity(out / name) for name in ("word-audits.json", "provenance.json")]})
    return verify_audit(out)


def verify_audit(out):
    check_identities(read(out / "freeze.json")["files"])
    provenance = read(out / "provenance.json")
    check_identities([provenance[k] for k in ("sourceFreeze", "analysisSource", "executionSource")])
    root = Path(provenance["sourceRoot"])
    plan = verify_saved_execution(root)
    require([audit(read(root / t["id"] / "raw.json"), t) for t in plan["targets"]]
            == read(out / "word-audits.json"), "CORRECTED_AUDIT_REPLAY_MISMATCH")
    return {"integrity": "passed", "recordedRequests": len(plan["targets"]),
            "recordedModelLoads": 1, "newInference": 0, "subtitleMutations": 0,
            "correctedAuditRoot": str(out), "originalExecutionRoot": str(root)}


if __name__ == "__main__":
    command = sys.argv[1]
    if command == "prepare":
        result = prepare(*sys.argv[2:5], sys.argv[5:])
    elif command in ("run", "verify", "_worker", "recover-audit", "verify-audit"):
        result = {"run": run, "verify": verify, "_worker": worker,
                  "recover-audit": recover_audit, "verify-audit": verify_audit}[command](Path(sys.argv[2]).resolve())
    else:
        raise ValueError("UNKNOWN_COMMAND")
    print(json.dumps(result, ensure_ascii=False))
