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


PARSER_VERSION = "c5-17-1-praatio-lexical-utterance-boundary-v1"


def interval_dict(entry: Any) -> dict[str, Any]:
    start, end, label = entry
    return {"start": float(start), "end": float(end), "label": str(label)}


def find_tier(grid: Any, candidates: tuple[str, ...]) -> Any | None:
    by_lower = {name.lower(): name for name in grid.tierNames}
    for candidate in candidates:
        actual = by_lower.get(candidate.lower())
        if actual is not None:
            return grid.getTier(actual)
    return None


def entries(tier: Any | None) -> list[dict[str, Any]]:
    if tier is None:
        return []
    return [interval_dict(entry) for entry in tier.entries]


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
    if words is None and phones is None:
        raise ValueError(
            "TextGrid exposes neither a word nor phone interval tier; "
            f"found {grid.tierNames}."
        )
    payload = {
        "parserVersion": PARSER_VERSION,
        "tierNames": list(grid.tierNames),
        "words": entries(words),
        "phones": entries(phones),
        "fileInterval": {
            "start": float(grid.minTimestamp),
            "end": float(grid.maxTimestamp),
            "label": "file",
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
