#!/usr/bin/env python3
"""Extract and anonymize filtered Tatoeba sentences beyond the v9 base corpus."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

PROJECT_ROOT = Path(__file__).resolve().parents[2]
GRAMMAR_STEG_ROOT = PROJECT_ROOT.parent / "grammar_steg"
GRAMMAR_STEG_SOURCE = GRAMMAR_STEG_ROOT / "src"
GRAMMAR_STEG_SCRIPTS = GRAMMAR_STEG_ROOT / "scripts"
BASE_CORPUS_PATH = PROJECT_ROOT / "public/data/corpora/v9/sentences.json"
ARCHIVE_PATH = PROJECT_ROOT / "research/v11/cache/rus_sentences.tsv.bz2"
OUTPUT_PATH = PROJECT_ROOT / "research/v11/cache/tatoeba-tail.json"
BASE_CORPUS_SIZE = 2**20
NAME_REPLACEMENT_SEED = 20260318

sys.path.insert(0, str(GRAMMAR_STEG_SOURCE))

from grammar_steg.name_replacement import NameReplacer  # noqa: E402
from grammar_steg.sentence_normalize import (  # noqa: E402
    clean_sentence_surface,
    normalize_sentence_key,
)


def load_prepare_corpus_v8_module() -> ModuleType:
    """Load the sibling corpus-filtering script as a module."""
    script_path = GRAMMAR_STEG_SCRIPTS / "prepare_corpus_v8.py"
    module_spec = importlib.util.spec_from_file_location(
        "v11_prepare_corpus_v8",
        script_path,
    )
    assert module_spec is not None, (
        f"expected module spec for {script_path}, got {module_spec}"
    )
    assert module_spec.loader is not None, (
        f"expected module loader for {script_path}, got {module_spec.loader}"
    )
    module = importlib.util.module_from_spec(module_spec)
    sys.modules[module_spec.name] = module
    module_spec.loader.exec_module(module)
    return module


def load_base_normalized_keys() -> set[str]:
    """Load normalized keys already used by v9."""
    payload = json.loads(BASE_CORPUS_PATH.read_text(encoding="utf-8"))
    sentences = payload["sentences"]
    assert isinstance(sentences, list), (
        f"expected base sentences list, got {type(sentences)!r}"
    )
    assert len(sentences) == BASE_CORPUS_SIZE, (
        f"expected {BASE_CORPUS_SIZE} base sentences, got {len(sentences)}"
    )
    return {normalize_sentence_key(str(sentence)) for sentence in sentences}


def extract_anonymized_tail() -> list[str]:
    """Return unique anonymized filtered sentences after the first 2^20."""
    assert ARCHIVE_PATH.exists(), f"expected cached archive at {ARCHIVE_PATH}"
    prepare_module = load_prepare_corpus_v8_module()
    filtered_sentences = prepare_module.read_tatoeba_sentences(ARCHIVE_PATH)
    assert len(filtered_sentences) > BASE_CORPUS_SIZE, (
        f"expected more than {BASE_CORPUS_SIZE} filtered sentences, "
        f"got {len(filtered_sentences)}"
    )
    seen_normalized_keys = load_base_normalized_keys()
    name_replacer = NameReplacer(NAME_REPLACEMENT_SEED)
    anonymized_tail: list[str] = []
    for sentence_index in range(BASE_CORPUS_SIZE, len(filtered_sentences)):
        source_sentence = filtered_sentences[sentence_index]
        anonymized_sentence = clean_sentence_surface(
            name_replacer.replace_in_sentence(source_sentence, sentence_index)
        )
        assert anonymized_sentence, (
            f"expected non-empty anonymized sentence at index {sentence_index}, "
            f"got {anonymized_sentence!r}"
        )
        normalized_key = normalize_sentence_key(anonymized_sentence)
        if normalized_key in seen_normalized_keys:
            continue
        seen_normalized_keys.add(normalized_key)
        anonymized_tail.append(anonymized_sentence)
    return anonymized_tail


def main() -> None:
    """Extract the tail and save it as reproducible research cache."""
    anonymized_tail = extract_anonymized_tail()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "source_archive": str(ARCHIVE_PATH.relative_to(PROJECT_ROOT)),
                "base_corpus_size": BASE_CORPUS_SIZE,
                "name_replacement_seed": NAME_REPLACEMENT_SEED,
                "sentence_count": len(anonymized_tail),
                "sentences": anonymized_tail,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        f"Wrote {len(anonymized_tail)} anonymized tail sentences to {OUTPUT_PATH}"
    )


if __name__ == "__main__":
    main()
