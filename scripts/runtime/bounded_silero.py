#!/usr/bin/env python3
"""Single local Silero pass; reuse the existing VAD-only C API adapter."""
import argparse
import contextlib
import importlib.metadata
import json
import os
import sys
from types import SimpleNamespace
from c601141_speech_activity_worker import Silero


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
        backend = Silero(SimpleNamespace(model=request["model"], library=request["library"]))
        try:
            print("BOUNDED_SILERO_MODEL_LOADED", file=sys.stderr, flush=True)
            result = backend.run(request)
        finally:
            backend.close()
    print(json.dumps({**result, "python": sys.version, "numpy": importlib.metadata.version("numpy"),
                      "modelLoadCount": 1, "inferencePasses": 1}, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
