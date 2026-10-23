#!/usr/bin/env python3
"""Deterministic full-source PCM/fingerprint search, with no speech model."""
import argparse
import hashlib
import json
import sys
import wave
import numpy as np
from scipy.signal import fftconvolve, resample_poly


def audio(path):
    with wave.open(path, "rb") as stream:
        if (stream.getframerate(), stream.getnchannels(), stream.getsampwidth()) != (16000, 1, 2):
            raise ValueError("EXTRACTION_CONFIG_UNRESOLVED")
        raw = stream.readframes(stream.getnframes())
    return np.frombuffer(raw, dtype="<i2"), raw


def unsuitable(clip, policy):
    values = clip.astype(np.float64) / 32768.0
    if len(values) < policy["minimumClipSeconds"] * 16000:
        return True
    if float(np.sqrt(np.mean(values * values))) < policy["minimumRms"]:
        return True
    centered = values - values.mean()
    power = np.abs(np.fft.rfft(centered * np.hanning(len(centered)))) ** 2
    if not power.sum() or float(power.max() / power.sum()) > policy["maximumSpectralPeakRatio"]:
        return True
    lag = float(np.dot(centered[1:], centered[:-1]) / max(1e-20, np.dot(centered, centered)))
    return abs(lag) > policy["maximumLagOneCorrelation"]


def ncc(source, clip):
    n = len(clip)
    centered = clip - clip.mean()
    norm = float(np.dot(centered, centered))
    numerator = fftconvolve(source, centered[::-1], mode="valid")
    sums = np.concatenate(([0.0], np.cumsum(source)))
    squares = np.concatenate(([0.0], np.cumsum(source * source)))
    variance = squares[n:] - squares[:-n] - (sums[n:] - sums[:-n]) ** 2 / n
    denominator = np.sqrt(np.maximum(variance * norm, 1e-20))
    return np.clip(numerator / denominator, -1, 1)


def search(views, clip, raw, policy):
    if unsuitable(clip, policy):
        return {"status": "SILENT_OR_REPETITIVE_CLIP", "matches": []}
    matches = []
    exclusion = round(policy["secondPeakExclusionSeconds"] * 16000)
    for view in views:
        # Exact PCM search is global, not constrained to an expected time.
        cursor = 0
        exact = []
        while len(exact) < 16:
            at = view["raw"].find(raw, cursor)
            if at < 0:
                break
            cursor = at + 2
            if at % 2 == 0:
                exact.append({"offset": at // 2, "score": 1.0, "residual": 0.0,
                              "viewId": view["viewId"], "exact": True})
        matches.extend(exact)
        if exact:
            continue
        if len(clip) > len(view["samples"]):
            continue
        coarse = resample_poly(clip.astype(np.float64), 1, 16)
        correlations = ncc(view["coarse"], coarse)
        offsets = []
        for _ in range(12):
            pos = int(np.argmax(correlations))
            if correlations[pos] <= 0:
                break
            offsets.append(pos * 16)
            radius = max(1, exclusion // 16)
            correlations[max(0, pos-radius):min(len(correlations), pos+radius+1)] = -1
        centered = clip.astype(np.float64) - float(clip.mean())
        clip_norm = float(np.linalg.norm(centered))
        for coarse_offset in offsets:
            best = None
            for offset in range(max(0, coarse_offset-32), min(len(view["samples"])-len(clip), coarse_offset+32)+1):
                local = view["samples"][offset:offset+len(clip)].astype(np.float64)
                local -= local.mean()
                norm = float(np.linalg.norm(local))
                score = float(np.dot(local, centered) / max(1e-20, norm*clip_norm))
                residual = float(np.sqrt(max(0.0, 2-2*score)))
                candidate = {"offset": offset, "score": min(1.0, max(-1.0, score)),
                             "residual": residual, "viewId": view["viewId"], "exact": False}
                if best is None or score > best["score"]:
                    best = candidate
            if best is not None:
                matches.append(best)
    matches.sort(key=lambda v: (-v["score"], v["offset"], v["viewId"]))
    if not matches:
        return {"status": "FINGERPRINT_LOW_SUPPORT", "matches": []}
    best = matches[0]
    # The same acoustic occurrence on another view is not a second locus.
    second = next((v for v in matches[1:] if abs(v["offset"]-best["offset"]) > exclusion), None)
    margin = best["score"] - (second["score"] if second else 0.0)
    if best["score"] < policy["minimumNormalizedCorrelation"] or best["residual"] > policy["maximumNormalizedResidual"]:
        status = "FINGERPRINT_LOW_SUPPORT"
    elif margin < policy["minimumScoreMargin"]:
        status = "FINGERPRINT_AMBIGUOUS"
    else:
        status = "LEGACY_EXACT_PCM_RECOVERED" if best["exact"] else "LEGACY_UNIQUE_FINGERPRINT_RECOVERED"
    return {"status": status, "matches": [best] + ([second] if second else []), "scoreMargin": margin}


def controls(policy):
    rng = np.random.default_rng(601141)
    signal = (rng.normal(size=64000) * 3500).astype("<i2")
    clip = signal[19680:27680].copy()
    def view(values):
        return {"viewId": "synthetic", "samples": values, "raw": values.tobytes(),
                "coarse": resample_poly(values.astype(np.float64), 1, 16)}
    exact = search([view(signal)], clip, clip.tobytes(), policy)
    duplicate = np.concatenate((signal, signal))
    ambiguous = search([view(duplicate)], clip, clip.tobytes(), policy)
    normalized = (signal.astype(np.float64) * 0.65).astype("<i2")
    gained = search([view(normalized)], clip, clip.tobytes(), policy)
    silent = search([view(signal)], np.zeros(8000, dtype="<i2"), bytes(16000), policy)
    tone = (np.sin(np.arange(8000) * 2*np.pi*440/16000)*10000).astype("<i2")
    repetitive = search([view(signal)], tone, tone.tobytes(), policy)
    statuses = {"exact": exact["status"], "duplicate": ambiguous["status"], "gain": gained["status"],
                "silent": silent["status"], "tone": repetitive["status"]}
    expected = {"exact": "LEGACY_EXACT_PCM_RECOVERED", "duplicate": "FINGERPRINT_AMBIGUOUS",
                "gain": "LEGACY_UNIQUE_FINGERPRINT_RECOVERED", "silent": "SILENT_OR_REPETITIVE_CLIP",
                "tone": "SILENT_OR_REPETITIVE_CLIP"}
    if statuses != expected or exact["matches"][0]["offset"] != 19680 or abs(gained["matches"][0]["offset"]-19680)>1:
        raise RuntimeError("FINGERPRINT_SYNTHETIC_CONTROLS_FAILED:"+json.dumps(statuses))
    return {"passed": True, "statuses": statuses, "exactOffsetErrorSamples": 0,
            "gainOffsetErrorSamples": gained["matches"][0]["offset"]-19680, "goldInputCount": 0}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    with open(args.input, encoding="utf-8") as stream:
        request = json.load(stream)
    policy = request["policy"]
    control = controls(policy)
    views = []
    for item in request.get("views", []):
        samples, raw = audio(item["audioPath"])
        if hashlib.sha256(raw).hexdigest() != item["pcmSha256"]:
            raise ValueError("FINGERPRINT_SOURCE_PCM_HASH_MISMATCH")
        views.append({**item, "samples": samples, "raw": raw,
                      "coarse": resample_poly(samples.astype(np.float64), 1, 16)})
    results = []
    for clip in request.get("clips", []):
        samples, raw = audio(clip["audioPath"])
        if hashlib.sha256(raw).hexdigest() != clip["pcmSha256"]:
            raise ValueError("FINGERPRINT_CLIP_PCM_HASH_MISMATCH")
        results.append({"clipId": clip["clipId"], **search(views, samples, raw, policy)})
    print(json.dumps({"controls": control, "results": results}, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
