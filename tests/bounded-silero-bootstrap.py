"""Backend registration and durable phase tests; no model or audio is opened."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

runtime = Path(__file__).resolve().parents[1] / "scripts" / "runtime"
sys.path.insert(0, str(runtime))
spec = importlib.util.spec_from_file_location("bounded_silero", runtime / "bounded_silero.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Bootstrap(unittest.TestCase):
    def test_registers_only_when_empty(self):
        lib = Mock()
        lib.ggml_backend_dev_count.side_effect = [0, 3]
        with patch.object(module.ctypes, "CDLL", return_value=lib):
            self.assertEqual(module.register_backends("synthetic"), 3)
        lib.ggml_backend_load_all.assert_called_once_with()

    def test_existing_backend_not_loaded_again(self):
        lib = Mock()
        lib.ggml_backend_dev_count.return_value = 1
        with patch.object(module.ctypes, "CDLL", return_value=lib):
            self.assertEqual(module.register_backends("synthetic"), 1)
        lib.ggml_backend_load_all.assert_not_called()

    def test_no_backend_fails_before_model(self):
        lib = Mock()
        lib.ggml_backend_dev_count.return_value = 0
        with patch.object(module.ctypes, "CDLL", return_value=lib):
            with self.assertRaisesRegex(RuntimeError, "NO_LOCAL_GGML_BACKEND"):
                module.register_backends("synthetic")

    def test_receipts_preserve_order(self):
        with tempfile.TemporaryDirectory() as root:
            receipt = Path(root) / "phases.jsonl"
            request = {"receiptPath": str(receipt)}
            module.receipt(request, "model-loaded")
            module.receipt(request, "inference-pass-reserved")
            self.assertEqual(receipt.read_text().splitlines(), [
                '{"phase": "model-loaded"}', '{"phase": "inference-pass-reserved"}',
            ])


if __name__ == "__main__":
    unittest.main()
