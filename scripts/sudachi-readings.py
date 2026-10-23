#!/usr/bin/env python3
"""Resolve a batch of Japanese readings with pinned Sudachi dependencies."""

from __future__ import annotations

import importlib.metadata
import json
import re
import sys
import unicodedata
from typing import Any

from sudachipy import Dictionary, SplitMode


HELPER_VERSION = "1.0.0"
SUDACHI_VERSION = "0.6.11"
DICTIONARY_VERSION = "20260428"
MAX_ITEMS = 10_000
MAX_TEXT_LENGTH = 100_000
KANJI_PATTERN = re.compile(r"[\u3400-\u9fff\u3005\u3006\u30f5\u30f6]")


def katakana_to_hiragana(value: str) -> str:
    result: list[str] = []
    for character in value:
        codepoint = ord(character)
        if 0x30A1 <= codepoint <= 0x30F6:
            result.append(chr(codepoint - 0x60))
        else:
            result.append(character)
    return "".join(result)


def validate_runtime_versions() -> None:
    actual_sudachi = importlib.metadata.version("SudachiPy")
    actual_dictionary = importlib.metadata.version("SudachiDict-core")
    if actual_sudachi != SUDACHI_VERSION or actual_dictionary != DICTIONARY_VERSION:
        raise RuntimeError(
            "Sudachi dependency version mismatch: "
            f"expected SudachiPy {SUDACHI_VERSION} and SudachiDict-core "
            f"{DICTIONARY_VERSION}, got {actual_sudachi} and {actual_dictionary}."
        )


def can_preserve_oov_literal(surface: str) -> bool:
    for character in surface:
        codepoint = ord(character)
        is_kana = (
            0x3040 <= codepoint <= 0x309F
            or 0x30A0 <= codepoint <= 0x30FF
            or character == "ー"
        )
        category = unicodedata.category(character)
        if (
            is_kana
            or character.isspace()
            or category.startswith("P")
            or category.startswith("S")
        ):
            continue
        return False
    return True


def parse_request() -> list[dict[str, str]]:
    value: Any = json.loads(sys.stdin.read())
    if not isinstance(value, dict) or not isinstance(value.get("items"), list):
        raise ValueError("Expected an object with an items array.")
    items = value["items"]
    if len(items) > MAX_ITEMS:
        raise ValueError(f"Reading batch exceeds {MAX_ITEMS} items.")

    parsed: list[dict[str, str]] = []
    identifiers: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Every reading item must be an object.")
        identifier = item.get("id")
        text = item.get("text")
        if not isinstance(identifier, str) or not identifier:
            raise ValueError("Every reading item requires a non-empty id.")
        if identifier in identifiers:
            raise ValueError(f"Duplicate reading item id: {identifier}")
        if not isinstance(text, str) or not text:
            raise ValueError("Every reading item requires non-empty text.")
        if len(text) > MAX_TEXT_LENGTH:
            raise ValueError(
                f"Reading item {identifier} exceeds {MAX_TEXT_LENGTH} characters."
            )
        identifiers.add(identifier)
        parsed.append({"id": identifier, "text": text})
    return parsed


def analyze_reading(
    tokenizer: Any, text: str
) -> tuple[str | None, list[str], list[dict[str, Any]]]:
    reading_parts: list[str] = []
    unresolved_oov: list[str] = []
    morphemes: list[dict[str, Any]] = []

    for morpheme in tokenizer.tokenize(text, SplitMode.C):
        surface = morpheme.surface()
        reading: str | None = None
        if morpheme.is_oov():
            if can_preserve_oov_literal(surface):
                # Kana, whitespace, punctuation, and symbols can be preserved
                # literally without inventing a pronunciation.
                reading = katakana_to_hiragana(surface)
                reading_parts.append(reading)
            else:
                unresolved_oov.append(surface)
        else:
            reading_form = morpheme.reading_form()
            if reading_form and reading_form != "*":
                reading = katakana_to_hiragana(reading_form)
                reading_parts.append(reading)
            elif KANJI_PATTERN.search(surface):
                unresolved_oov.append(surface)
            else:
                reading = katakana_to_hiragana(surface)
                reading_parts.append(reading)
        morphemes.append(
            {
                "surface": surface,
                "normalizedSurface": morpheme.normalized_form(),
                "dictionaryForm": morpheme.dictionary_form(),
                "reading": reading,
                "partOfSpeech": list(morpheme.part_of_speech()),
                "isOov": morpheme.is_oov(),
                "startCharacter": morpheme.begin(),
                "endCharacter": morpheme.end(),
            }
        )

    if unresolved_oov:
        return None, unresolved_oov, morphemes
    combined_reading = "".join(reading_parts)
    return (combined_reading if combined_reading else None), [], morphemes


def main() -> None:
    validate_runtime_versions()
    items = parse_request()
    tokenizer = Dictionary(dict="core").create()
    cached: dict[str, tuple[str | None, list[str], list[dict[str, Any]]]] = {}
    results: list[dict[str, Any]] = []

    for item in items:
        text = item["text"]
        if text not in cached:
            cached[text] = analyze_reading(tokenizer, text)
        reading, unresolved_oov, morphemes = cached[text]
        results.append(
            {
                "id": item["id"],
                "reading": reading,
                "unresolvedOov": unresolved_oov,
                "morphemes": morphemes,
            }
        )

    json.dump(
        {
            "engine": {
                "helperVersion": HELPER_VERSION,
                "sudachiPyVersion": SUDACHI_VERSION,
                "dictionaryVersion": DICTIONARY_VERSION,
                "dictionary": "core",
                "splitMode": "C",
                "outputScript": "hiragana",
            },
            "items": results,
        },
        sys.stdout,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump(
            {
                "error": str(error),
                "errorType": type(error).__name__,
            },
            sys.stderr,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        sys.stderr.write("\n")
        raise SystemExit(1) from error
