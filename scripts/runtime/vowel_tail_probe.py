"""Offline PCM diagnostic only. No model, reference subtitle, or text decoder."""
import hashlib
import json
import math
import sys
import wave
from pathlib import Path

import numpy as np
from occurrence_tail import POLICY, pcm_candidates


def analyze(audio, rate, seed, source_start):
    if (rate != 16000 or audio.ndim != 1 or not np.isfinite(audio).all()
            or not all(math.isfinite(x) for x in [*seed, source_start])
            or not 0 <= seed[0] < seed[1] < len(audio) / rate
            or source_start < 0):
        raise ValueError("INVALID_PCM_OR_SEED")
    result = pcm_candidates(audio, rate, *seed, len(audio) / rate)
    result["sourceCandidates"] = [
        {**c, "sourceEnd": round(source_start + c["endSeconds"], 6)}
        for c in result["candidates"]
    ]
    end = result["selectedEndSeconds"]
    result["sourceSelectedEnd"] = None if end is None else round(source_start + end, 6)
    result["cellSourceStarts"] = [
        round(source_start + i * POLICY["pcmCellSeconds"], 6)
        for i in range(len(result["levelsDb"]))
    ]
    # Even a clean non-vocal oscillator can pass continuity: never call this speech.
    result["speechIdentityEstablished"] = False
    result["subtitleMutationAuthorized"] = False
    return result


def probe(plan):
    rows = []
    for window in plan["windows"]:
        wav = Path(window["wav"])
        if hashlib.sha256(wav.read_bytes()).hexdigest() != window["wavHash"]:
            raise ValueError("PCM_HASH_CHANGED")
        with wave.open(str(wav), "rb") as stream:
            if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate(),
                    stream.getnframes(), stream.getcomptype()) != (
                    1, 2, 16000, window["frames"], "NONE"):
                raise ValueError("PCM_CONTRACT_CHANGED")
            audio = np.frombuffer(stream.readframes(stream.getnframes()), dtype="<i2").astype(np.float64) / 32768
        rows.append({"id": window["id"], "sourceCrop": [window["start"], window["end"]],
                     "seed": window["seed"],
                     **analyze(audio, 16000, window["seed"], window["start"])})
    ends = [r["sourceSelectedEnd"] for r in rows]
    return {
        "policy": POLICY, "runtime": {"python": sys.version, "numpy": np.__version__},
        "windows": rows,
        "crossWindowEndDelta": abs(ends[0] - ends[1]) if all(e is not None for e in ends) else None,
        "newModelCalls": 0, "textMutations": 0, "timingMutations": 0,
        "speechIdentityEstablished": False, "subtitleMutationAuthorized": False,
        "qualityStatus": "needs-review", "finalizationMethod": "none",
    }


if __name__ == "__main__":
    print(json.dumps(probe(json.loads(Path(sys.argv[1]).read_text())), allow_nan=False))
