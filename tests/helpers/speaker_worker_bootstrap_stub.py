"""Check the real speaker bootstrap without importing third-party runtimes."""

import importlib.abc
import importlib.util
import json
import os
from pathlib import Path
import sys


class BootstrapBoundaryReached(RuntimeError):
    """Stop successfully before the first third-party module is imported."""


NATIVE_ROOTS = {
    "numpy",
    "soundfile",
    "torch",
    "pyannote",
    "matplotlib",
    "lightning",
    "torchmetrics",
}
attempted_imports = []


class DenyNativeImports(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        root = fullname.split(".", 1)[0]
        if root not in NATIVE_ROOTS:
            return None
        attempted_imports.append(fullname)
        assert fullname == "numpy", "bootstrap must stop at its first native import"
        for key in (
            "MPL_IGNORE_SYSTEM_FONTS",
            "HF_HUB_OFFLINE",
            "TRANSFORMERS_OFFLINE",
            "HF_HUB_DISABLE_TELEMETRY",
        ):
            assert os.environ.get(key) == "1", key + " was not forced before import"
        for key in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"):
            assert key not in os.environ, key + " was not stripped before import"
        raise BootstrapBoundaryReached("third-party import deliberately denied")


initial_state = sys.argv[1]
assert initial_state in {"unset", "0"}, "expected one explicit environment scenario"
if initial_state == "unset":
    assert "MPL_IGNORE_SYSTEM_FONTS" not in os.environ
else:
    assert os.environ.get("MPL_IGNORE_SYSTEM_FONTS") == "0"

assert not any(name.split(".", 1)[0] in NATIVE_ROOTS for name in sys.modules)
sys.dont_write_bytecode = True
sys.meta_path.insert(0, DenyNativeImports())
worker_path = (
    Path(__file__).resolve().parents[2] / "scripts" / "runtime" / "speaker_worker.py"
)
spec = importlib.util.spec_from_file_location("tested_speaker_worker", worker_path)
assert spec is not None and spec.loader is not None
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
assert attempted_imports == [], "importing the worker must not start native runtimes"
sys.argv = [
    str(worker_path), "--model-directory", "/neutral-not-a-model", "--device", "auto"
]

try:
    worker.main()
except BootstrapBoundaryReached:
    pass
else:
    raise AssertionError("speaker bootstrap did not reach its first import boundary")

assert attempted_imports == ["numpy"]
assert not any(name.split(".", 1)[0] in NATIVE_ROOTS for name in sys.modules)
print(json.dumps({
    "initialSystemFontsSetting": initial_state,
    "systemFontsIgnoredBeforeImport": True,
    "offlineEnvironmentVerified": True,
    "tokenEnvironmentStripped": True,
    "firstThirdPartyImportDenied": "numpy",
    "thirdPartyModulesLoaded": 0,
    "realModelLoads": 0,
    "realAcousticForwards": 0,
}))
