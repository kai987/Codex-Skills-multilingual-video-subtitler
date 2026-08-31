#!/usr/bin/env python3
"""Deterministic DSP and acoustic measurements only: no model import or network.

All outputs retain the exact 16 kHz sample count. Symmetric FIR group delay is
explicitly compensated by centered convolution; preemphasis retains sample i.
Measurements are acoustic proxies, not speech/lexical truth or LUFS readings.
"""
import argparse
import hashlib
import json
import os
import wave
from pathlib import Path

import numpy as np
from scipy import signal


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_pcm(filename):
    with wave.open(str(filename), "rb") as stream:
        if (stream.getframerate(), stream.getnchannels(), stream.getsampwidth()) != (16000, 1, 2):
            raise RuntimeError("C601142_DSP_INPUT_NOT_MONO_PCM16_16K")
        pcm = stream.readframes(stream.getnframes())
    return np.frombuffer(pcm, dtype="<i2").astype(np.float64) / 32768.0, digest(pcm)


def write_pcm(filename, values):
    pcm = np.rint(np.clip(values, -1, 32767 / 32768) * 32768).astype("<i2").tobytes()
    # Exclusive, fsynced output: do not replace a prior run or a frozen view.
    with open(filename, "xb") as handle:
        with wave.open(handle, "wb") as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(16000)
            stream.writeframes(pcm)
        handle.flush()
        os.fsync(handle.fileno())
    return digest(pcm)


RECIPES = {
    "DIALOGUE_COMPRESSED_MID_V2": {"firTaps": 257, "bandHz": [150, 4200], "preemphasis": 0.0, "preemphasisMode": "ZERO_PHASE_SYMMETRIC",
                                    "compressionThreshold": 0.06, "compressionRatio": 2.0, "peakNormalize": 0.85},
    "PREEMPHASIS_VOICE_BAND_V1": {"firTaps": 257, "bandHz": [100, 4800], "preemphasis": 0.9, "preemphasisMode": "ZERO_PHASE_SYMMETRIC",
                                  "compressionThreshold": 1.0, "compressionRatio": 1.0, "peakNormalize": 0.85},
}


def transform(values, recipe):
    taps = signal.firwin(recipe["firTaps"], recipe["bandHz"], pass_zero=False, fs=16000, window="hamming")
    # Odd symmetric taps -> exact integer group delay, removed by mode=same.
    output = signal.fftconvolve(values, taps, mode="same")
    if recipe["preemphasis"]:
        # Symmetric high-frequency emphasis, not a causal one-sample
        # differentiator: preserve the source grid and impulse peak exactly.
        p = recipe["preemphasis"]
        output = signal.fftconvolve(output, [-p / 2, 1.0, -p / 2], mode="same")
    threshold = recipe["compressionThreshold"]
    absolute = np.abs(output)
    output = np.sign(output) * np.where(absolute <= threshold, absolute,
                                        threshold * (absolute / threshold) ** (1 / recipe["compressionRatio"]))
    peak = float(np.max(np.abs(output)))
    if peak:
        output *= recipe["peakNormalize"] / peak
    if len(values) != len(output) or not np.isfinite(output).all():
        raise RuntimeError("C601142_DSP_TIMEBASE_OR_FINITE_FAILURE")
    return output


def spectral(values):
    if len(values) < 1024:
        values = np.pad(values, (0, 1024 - len(values)))
    windows = np.lib.stride_tricks.sliding_window_view(values, 1024)[::512]
    # Fixed deterministic stride for a long view. Local target measurements use
    # every frame; the full-view audit samples at most 4096 evenly spaced frames.
    if len(windows) > 4096:
        windows = windows[np.linspace(0, len(windows) - 1, 4096, dtype=int)]
    power = np.abs(np.fft.rfft(windows * np.hanning(1024), axis=1)) ** 2
    mean = np.mean(power, axis=0)
    frequencies = np.fft.rfftfreq(1024, 1 / 16000)
    total = float(np.sum(mean)) + 1e-30
    flatness = float(np.exp(np.mean(np.log(mean + 1e-30))) / (np.mean(mean) + 1e-30))
    return mean / total, frequencies, float(np.clip(flatness, 0, 1)), windows


def features(values, center_side=None):
    rms = float(np.sqrt(np.mean(values * values))) if len(values) else 0.0
    frames = len(values) // 320
    envelope = np.sqrt(np.mean(values[:frames * 320].reshape(-1, 320) ** 2, axis=1)) if frames else np.array([rms])
    levels = 20 * np.log10(np.maximum(envelope, 1e-12))
    power, frequencies, flatness, windows = spectral(values)
    mod = np.abs(np.fft.rfft(envelope - np.mean(envelope))) ** 2
    mf = np.fft.rfftfreq(len(envelope), 0.02)
    modulation = float(np.sum(mod[(mf >= 2) & (mf <= 16)]) / (np.sum(mod[mf >= 0.5]) + 1e-30))
    autocorrelation = np.fft.irfft(np.abs(np.fft.rfft(windows, n=2048, axis=1)) ** 2, axis=1)[:, :1024]
    normalized = autocorrelation[:, 45:267] / np.maximum(autocorrelation[:, :1], 1e-30)
    lags = np.argmax(normalized, axis=1) + 45
    harmonic = np.max(normalized, axis=1)
    voiced = harmonic > 0.35
    continuity = float(np.mean(np.abs(np.diff(lags[voiced])) <= 0.15 * lags[voiced][:-1])) if np.count_nonzero(voiced) > 1 else 0.0
    onset = int(np.count_nonzero(np.diff(envelope) > max(rms * 0.5, 1e-5)))
    return {
        "rms": rms, "levelDbfsProxy": float(20 * np.log10(max(rms, 1e-12))),
        "dynamicRangeDb": float(max(0, np.quantile(levels, 0.95) - np.quantile(levels, 0.1))),
        "voiceBandRatio": float(np.sum(power[(frequencies >= 180) & (frequencies <= 4000)])),
        "lowBandRatio": float(np.sum(power[frequencies < 180])),
        "highBandRatio": float(np.sum(power[frequencies > 4000])), "spectralFlatness": flatness,
        "modulation2To16HzRatio": float(np.clip(modulation, 0, 1)),
        "harmonicityProxy": float(np.clip(np.mean(harmonic), 0, 1)),
        "pitchContinuityProxy": continuity, "onsetDensityPerSecond": onset / max(len(values) / 16000, 0.02),
        "centerSideEnergyRatio": center_side,
    }


def correlation(a, b):
    if len(a) != len(b):
        return 0.0
    stride = max(1, len(a) // 100000)
    x, y = a[::stride], b[::stride]
    return float(np.clip(np.dot(x, y) / (np.linalg.norm(x) * np.linalg.norm(y) + 1e-30), -1, 1))


def audit_view(values, parent, parent_features, center_side):
    value_features = features(values, center_side)
    corr = correlation(values, parent)
    # Audit shifts are physical 16 kHz samples, even when correlation is sampled.
    shifts = []
    for lag in range(-16, 17):
        x, y = (values[-lag:], parent[:lag]) if lag < 0 else (values[:-lag], parent[lag:]) if lag else (values, parent)
        shifts.append((correlation(x, y), lag))
    best, lag = max(shifts, key=lambda value: (value[0], -abs(value[1])))
    spectrum, _, _, _ = spectral(values)
    parent_spectrum, _, _, _ = spectral(parent)
    shape_difference = float(np.sum(np.abs(spectrum - parent_spectrum)))
    amplitude_only = abs(corr) >= 0.99999 and shape_difference <= 0.001 and abs(value_features["dynamicRangeDb"] - parent_features["dynamicRangeDb"]) <= 0.05
    return {"parentCorrelation": corr, "maximumCrossCorrelation": best,
            "maximumCrossCorrelationLagSamples16k": lag, "spectralShapeDifference": shape_difference,
            "features": value_features, "amplitudeOnlyNoOp": bool(amplitude_only)}


def synthetic_controls(native_rate):
    locations = [4096, 16000, 28000]
    impulse = np.zeros(32000)
    impulse[locations] = [0.25, 0.5, 0.75]
    rows = []
    for role, recipe in RECIPES.items():
        transformed = transform(impulse, recipe)
        delays = [int(np.argmax(np.abs(transformed[at - 64:at + 65]))) - 64 for at in locations]
        native_delays = [int(round(delay * native_rate / 16000)) for delay in delays]
        if len(transformed) != len(impulse) or any(abs(d) > 1 for d in native_delays):
            raise RuntimeError("C601142_DSP_SYNTHETIC_TIMEBASE_REJECTED")
        rows.append({"role": role, "inputFrames": len(impulse), "outputFrames": len(transformed),
                     "impulseOffsets16k": locations, "measuredDelayNativeSamples": native_delays,
                     "firGroupDelaySamples16k": (recipe["firTaps"] - 1) // 2,
                     "firCompensatedSamples16k": (recipe["firTaps"] - 1) // 2,
                     "controlPcmHash": digest(transformed.astype("<f8").tobytes()), "passed": True})
    return rows


def run_views(request):
    views = request["views"]
    parent_row = next(v for v in views if v["role"] == "CENTER_OR_MID")
    parent, parent_hash = read_pcm(parent_row["path"])
    left_row = next((v for v in views if v["role"] == "LEFT"), None)
    right_row = next((v for v in views if v["role"] == "RIGHT"), None)
    center_side = None
    if left_row and right_row:
        left, _ = read_pcm(left_row["path"])
        right, _ = read_pcm(right_row["path"])
        side = (left - right) * 0.5
        center_side = float(np.mean(parent ** 2) / max(np.mean(side ** 2), 1e-20))
    parent_features = features(parent, center_side)
    controls = synthetic_controls(request["nativeSampleRate"])
    old_audit = []
    for row in views:
        values, pcm_hash = read_pcm(row["path"])
        if pcm_hash != row["pcmSha256"]:
            raise RuntimeError("C601142_BASELINE_PCM_CHANGED")
        old_audit.append({"viewId": row["viewId"], "role": row["role"], "pcmSha256": pcm_hash,
                          "parentPcmSha256": parent_hash, "frameCount": len(values),
                          "durationDeltaSamples": len(values) - len(parent), **audit_view(values, parent, parent_features, center_side)})
    output = Path(request["outputDirectory"])
    output.mkdir(parents=True, exist_ok=True)
    generated = []
    for role, recipe in RECIPES.items():
        values = transform(parent, recipe)
        relative = role.lower().replace("_", "-") + ".wav"
        pcm_hash = write_pcm(output / relative, values)
        actual, _ = read_pcm(output / relative)
        generated.append({"role": role, "relativePath": relative, "recipe": recipe,
                          "audioSha256": digest((output / relative).read_bytes()), "pcmSha256": pcm_hash,
                          "parentPcmSha256": parent_hash, "parentViewId": parent_row["viewId"],
                          "frameCount": len(actual), "durationDeltaSamples": len(actual) - len(parent),
                          **audit_view(actual, parent, parent_features, center_side)})
    return {"controls": controls, "oldAudit": old_audit, "generated": generated,
            "modelInferenceCount": 0, "networkUsed": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--mode", choices=["views", "features"], required=True)
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text())
    if args.mode == "views":
        result = run_views(request)
    else:
        values, pcm_hash = read_pcm(request["audioPath"])
        rows = []
        for row in request["intervals"]:
            start, end = row["startSample16k"], row["endSample16k"]
            if not 0 <= start < end <= len(values):
                raise RuntimeError("C601142_ACOUSTIC_INTERVAL_OUTSIDE_SOURCE")
            rows.append({"id": row["id"], "features": features(values[start:end])})
        result = {"pcmSha256": pcm_hash, "rows": rows, "modelInferenceCount": 0}
    print(json.dumps(result, allow_nan=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
