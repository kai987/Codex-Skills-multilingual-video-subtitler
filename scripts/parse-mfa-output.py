#!/usr/bin/env python3
"""Parse a long MFA TextGrid through the pinned praatio runtime.

The helper intentionally exposes a tiny normalized JSON contract. It does not
implement TextGrid parsing itself; praatio remains the sole parser.
"""

from __future__ import annotations

import json
import pathlib
import sys
from typing import Any

from praatio import textgrid


PARSER_VERSION = "c5-17-mfa-json-or-praatio-long-textgrid-v1"


def interval_dict(entry: Any) -> dict[str, Any]:
    start, end, label = entry
    return {"start": float(start), "end": float(end), "label": str(label)}


def find_tier(grid: Any, candidates: tuple[str, ...]) -> Any:
    by_lower = {name.lower(): name for name in grid.tierNames}
    for candidate in candidates:
        actual = by_lower.get(candidate.lower())
        if actual is not None:
            return grid.getTier(actual)
    raise ValueError(
        f"TextGrid is missing required tier; expected one of {candidates}, "
        f"found {grid.tierNames}."
    )


def main() -> None:
    if len(sys.argv) == 2:
        source = pathlib.Path(sys.argv[1])
    else:
        request = json.loads(sys.stdin.read())
        if not isinstance(request, dict) or not isinstance(request.get("path"), str):
            raise ValueError("Expected a JSON object containing path.")
        source = pathlib.Path(request["path"])
    grid = textgrid.openTextgrid(str(source), includeEmptyIntervals=True)
    words = find_tier(grid, ("words", "word"))
    phones = find_tier(grid, ("phones", "phone"))
    payload = {
        "parserVersion": PARSER_VERSION,
        "words": [interval_dict(entry) for entry in words.entries],
        "phones": [interval_dict(entry) for entry in phones.entries],
        "utterance": {
            "start": float(grid.minTimestamp),
            "end": float(grid.maxTimestamp),
            "label": "utterance",
        },
    }
    json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump(
            {"error": str(error), "errorType": type(error).__name__},
            sys.stderr,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        sys.stderr.write("\n")
        raise SystemExit(1) from error
