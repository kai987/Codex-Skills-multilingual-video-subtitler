#!/usr/bin/env python3
"""Single local Silero pass; reuse the existing VAD-only C API adapter."""
import argparse
import contextlib
import ctypes
import importlib.metadata
import json
import os
import sys
from types import SimpleNamespace
from c601141_speech_activity_worker import Silero


def register_backends(library):
    """Register local dynamic GGML backends; no model is loaded here."""
    lib = ctypes.CDLL(library)
    lib.ggml_backend_dev_count.restype = ctypes.c_size_t
    if lib.ggml_backend_dev_count() == 0:
        lib.ggml_backend_load_all.argtypes = []
        lib.ggml_backend_load_all.restype = None
        lib.ggml_backend_load_all()
    count = lib.ggml_backend_dev_count()
    if count == 0:
        raise RuntimeError("NO_LOCAL_GGML_BACKEND")
    return count


def receipt(request, phase):
    """Fsync markers distinguish startup failure from an actual inference pass."""
    with open(request["receiptPath"], "a", encoding="utf8") as stream:
        stream.write(json.dumps({"phase": phase}) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    with open(args.request, encoding="utf8") as stream:
        request = json.load(stream)
    if request["authorized"] is not True or request["dispatchReserved"] is not True:
        raise RuntimeError("FROZEN_DISPATCH_REQUIRED")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    with contextlib.redirect_stdout(sys.stderr):
        receipt(request, "backend-registration-started")
        device_count = register_backends(request["library"])
        receipt(request, "model-initialization-started")
        backend = Silero(SimpleNamespace(model=request["model"], library=request["library"]))
        try:
            receipt(request, "model-loaded")
            print("BOUNDED_SILERO_MODEL_LOADED", file=sys.stderr, flush=True)
            receipt(request, "inference-pass-reserved")
            result = backend.run(request)
            receipt(request, "inference-pass-completed")
        finally:
            backend.close()
    print(json.dumps({**result, "python": sys.version, "numpy": importlib.metadata.version("numpy"),
                      "backendDeviceCount": device_count,
                      "modelLoadCount": 1, "inferencePasses": 1}, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
