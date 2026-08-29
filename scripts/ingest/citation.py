"""Deterministic, human-readable citation locators.

The locator — not a PDF page number — is the primary citation. Page numbers are
kept alongside as supporting metadata, because they identify a rendering of a
document rather than a place in the law.

Three grammars are in play, and each instrument is cited the way its own
community cites it:

* ``indian``  Patents Act, 1970 — Section 3(p) / Patents Rules, 2003 — Rule 13(2)
* ``dot``     TRIPS — Article 27.1 / Nagoya Protocol — Article 5.2
* ``paren``   CBD — Article 15(7)
"""
from __future__ import annotations

from typing import Any

LABEL_FOR_KEY = {
    "section": "Section",
    "rule": "Rule",
    "regulation": "Regulation",
    "article": "Article",
    "paragraph": "Paragraph",
}


def build_citation(
    short_title: str,
    locator: dict[str, Any],
    *,
    citation_style: str = "indian",
    unit_type: str = "provision",
    pages: list[int] | None = None,
) -> tuple[str, bool]:
    """Return ``(citation, locator_unavailable)``."""
    if unit_type in ("schedule", "form", "annexure"):
        label = _structural_label(locator, unit_type)
        if label:
            return f"{short_title} — {label}", False

    for key in ("section", "rule", "regulation", "article", "paragraph"):
        number = locator.get(key)
        if not number:
            continue
        tail = _tail(locator, key, citation_style)
        prefix = _structural_label(locator, unit_type)
        head = f"{prefix}, " if prefix and key != "paragraph" else ""
        return f"{short_title} — {head}{LABEL_FOR_KEY[key]} {number}{tail}", False

    label = _structural_label(locator, unit_type)
    if label:
        return f"{short_title} — {label}", False

    # A Chapter or Part heading is itself citable, even with no provision under it.
    for key, word in (("chapter", "Chapter"), ("part", "Part")):
        if locator.get(key):
            return f"{short_title} — {word} {locator[key]}", False

    page_note = f" (physical p. {pages[0]})" if pages else ""
    return f"{short_title} — unlocated text{page_note}", True


def _structural_label(locator: dict[str, Any], unit_type: str) -> str:
    if locator.get("form"):
        return f"Form {locator['form']}"
    if locator.get("schedule"):
        schedule = str(locator["schedule"]).title()
        return "Schedule" if schedule.upper() == "SCHEDULE" else f"{schedule} Schedule"
    if locator.get("annexure"):
        annexure = str(locator["annexure"])
        return annexure.title() if annexure.upper().startswith(("ANNEX", "APPENDIX")) else f"Annexure {annexure}"
    return ""


def _tail(locator: dict[str, Any], key: str, citation_style: str) -> str:
    if key == "article":
        paragraph = locator.get("paragraph")
        subparagraph = locator.get("subparagraph")
        tail = ""
        if paragraph:
            tail += f".{paragraph}" if citation_style == "dot" else f"({paragraph})"
        if subparagraph:
            tail += f"({subparagraph})"
        return tail
    tail = ""
    for sub_key in ("subsection", "sub_rule"):
        if locator.get(sub_key):
            tail += f"({locator[sub_key]})"
            break
    if locator.get("clause"):
        tail += f"({locator['clause']})"
    return tail
