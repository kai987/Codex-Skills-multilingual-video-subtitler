import importlib.util
import json
import pathlib
import struct
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "scripts/runtime/ct2_timing_contract.py"
SPEC = importlib.util.spec_from_file_location("contract", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def string(s):
    data = s.encode() + b"\0"
    return struct.pack("<H", len(data)) + data


def binary(version=6):
    variables = [("decoder/num_heads", 2, struct.pack("<h", 20)),
                 ("decoder/layer_0/test", 0, struct.pack("<f", 0)),
                 ("decoder/layer_1/test", 0, struct.pack("<f", 0))]
    data = struct.pack("<I", version) + string("WhisperSpec") + struct.pack("<II", 3, 3)
    for key, dtype, payload in variables:
        data += string(key) + struct.pack("<BBI", 0, dtype, len(payload)) + payload
    return data + struct.pack("<I", 0)


class ContractTests(unittest.TestCase):
    def inspect(self, heads, data=None):
        with tempfile.TemporaryDirectory() as directory:
            p = pathlib.Path(directory)
            (p / "config.json").write_text(json.dumps({"alignment_heads": heads}))
            (p / "model.bin").write_bytes(binary() if data is None else data)
            return MODULE.inspect(directory)

    def test_valid_indices_are_not_quality_acceptance(self):
        result = self.inspect([[0, 0], [1, 19]])
        self.assertTrue(result["compatible"])
        self.assertEqual(result["decoderLayers"], 2)
        self.assertEqual(result["modelLoads"], 0)
        self.assertFalse(result["timingQualityVerified"])

    def test_real_failure_shape_blocks(self):
        result = self.inspect([[7, 0], [25, 6]])
        self.assertFalse(result["compatible"])
        self.assertEqual(result["invalidAlignmentHeads"], [[7, 0], [25, 6]])

    def test_invalid_indices(self):
        for heads in ([[1, 20]], [[-1, 0]], [[0, -1]], [[True, 0]], [[0.1, 0]], [[0]], ["bad"]):
            with self.subTest(heads=heads):
                self.assertFalse(self.inspect(heads)["compatible"])

    def test_missing_heads(self):
        for heads in (None, [], "bad"):
            with self.assertRaises(ValueError):
                self.inspect(heads)

    def test_unknown_binary_version(self):
        with self.assertRaisesRegex(ValueError, "UNSUPPORTED_CT2_LAYOUT"):
            self.inspect([[0, 0]], binary(7))

    def test_truncated_binary(self):
        with self.assertRaisesRegex(ValueError, "TRUNCATED_CT2"):
            self.inspect([[0, 0]], binary()[:-7])

    def test_trailing_data(self):
        with self.assertRaisesRegex(ValueError, "TRAILING_CT2_DATA"):
            self.inspect([[0, 0]], binary() + b"bad")


if __name__ == "__main__":
    unittest.main()
