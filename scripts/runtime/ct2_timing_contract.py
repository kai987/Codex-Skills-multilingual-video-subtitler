"""Read CT2 v6 tensor metadata without importing or loading any model runtime.

Layout follows ctranslate2.specs.model_spec.ModelSpec._serialize. Unknown formats
fail closed. Passing this check establishes index validity, not timing quality.
"""
import json
import os
import re
import struct
import sys


def inspect(model_dir):
    with open(os.path.join(model_dir, "config.json"), encoding="utf8") as f:
        config = json.load(f)
    names = set()
    heads = None
    with open(os.path.join(model_dir, "model.bin"), "rb") as f:
        size = os.fstat(f.fileno()).st_size

        def read(n):
            data = f.read(n)
            if len(data) != n:
                raise ValueError("TRUNCATED_CT2_METADATA")
            return data

        def scalar(fmt):
            return struct.unpack("<" + fmt, read(struct.calcsize("<" + fmt)))[0]

        def string():
            length = scalar("H")
            if not 0 < length <= 8192:
                raise ValueError("INVALID_CT2_STRING")
            data = read(length)
            if data[-1] != 0:
                raise ValueError("INVALID_CT2_STRING")
            return data[:-1].decode("utf8")

        version, name, revision = scalar("I"), string(), scalar("I")
        if version != 6 or name != "WhisperSpec" or revision != 3:
            raise ValueError(f"UNSUPPORTED_CT2_LAYOUT:{version}:{name}:{revision}")
        count = scalar("I")
        if count > 100000:
            raise ValueError("INVALID_CT2_COUNT")
        for _ in range(count):
            key = string()
            if key in names:
                raise ValueError("DUPLICATE_CT2_VARIABLE")
            names.add(key)
            rank = scalar("B")
            if rank > 8:
                raise ValueError("INVALID_CT2_RANK")
            shape = [scalar("I") for _ in range(rank)]
            dtype, length = scalar("B"), scalar("I")
            if f.tell() + length > size:
                raise ValueError("TRUNCATED_CT2_TENSOR")
            if key == "decoder/num_heads":
                if dtype != 2 or length != 2 or shape not in ([], [1]):
                    raise ValueError("INVALID_CT2_HEAD_COUNT")
                heads = scalar("h")
            else:
                f.seek(length, 1)
        aliases = scalar("I")
        if aliases > 100000:
            raise ValueError("INVALID_CT2_ALIAS_COUNT")
        for _ in range(aliases):
            alias, target = string(), string()
            if alias in names or target not in names:
                raise ValueError("INVALID_CT2_ALIAS")
            names.add(alias)
        if f.tell() != size:
            raise ValueError("TRAILING_CT2_DATA")
    layers = sorted({int(m.group(1)) for n in names
                     if (m := re.match(r"decoder/layer_(\d+)/", n))})
    if not layers or layers != list(range(len(layers))) or not heads or heads < 1:
        raise ValueError("UNVERIFIABLE_CT2_DECODER")
    alignment = config.get("alignment_heads")
    invalid = []
    if not isinstance(alignment, list) or not alignment:
        raise ValueError("MISSING_ALIGNMENT_HEADS")
    for pair in alignment:
        if (not isinstance(pair, list) or len(pair) != 2
                or any(type(x) is not int for x in pair)
                or not 0 <= pair[0] < len(layers) or not 0 <= pair[1] < heads):
            invalid.append(pair)
    return {"binaryVersion": version, "modelType": name, "revision": revision,
            "decoderLayers": len(layers), "decoderHeads": heads,
            "alignmentHeads": alignment, "invalidAlignmentHeads": invalid,
            "compatible": not invalid, "modelLoads": 0, "inferenceCalls": 0,
            "timingQualityVerified": False}


if __name__ == "__main__":
    result = inspect(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["compatible"] else 2)
