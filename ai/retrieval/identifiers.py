"""Exact legal-identifier matching, as a scoring component rather than an engine.

When someone asks about "section 3(p) of the Patents Act", they have named the
answer. Lexical similarity is beside the point, and BM25 handles it badly: the
string `3(p)` almost never occurs in the text of section 3, which sets out "3."
as a heading and "(p)" as a clause thirty lines later. The citation lives in the
chunk's *locator*, which Phase 2 established and Phase 3 vouched for.

So identifier matching reads metadata, not text — and it stays a component. It
does not replace BM25 and it does not quietly merge into it; `bm25` and
`bm25_boost` are separate retrievers producing separate results files, so the
benchmark can say what the boost is worth instead of assuming it earns its keep.

The boost is scaled by the best BM25 score for the same query, so an exact
citation match can lift a provision from rank 400 to rank 1 — which is the whole
point — while a query naming no identifier is left exactly as BM25 ranked it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from ai.retrieval.base import (
    Chunk,
    Filters,
    RetrievalResult,
    Retriever,
    allowed_ids,
    result_from_chunk,
)
from ai.retrieval.bm25 import BM25Retriever

#: Weight on the boost, in units of "the best BM25 score for this query".
BOOST_WEIGHT = 1.0

#: What a named unit is called in the chunk locator, and which locator fields
#: hold its sub-units. A citation's parenthesised tail is matched against those.
LOCATOR_FIELD = {
    "section": ("section", ("subsection", "clause")),
    "rule": ("rule", ("sub_rule", "clause")),
    "article": ("article", ("paragraph", "clause")),
    "regulation": ("regulation", ("subsection", "clause")),
    "paragraph": ("paragraph", ("subparagraph", "clause")),
    "form": ("form", ()),
    "schedule": ("schedule", ()),
    "chapter": ("chapter", ()),
    "part": ("part", ()),
}

_NUMBER = r"\d+[A-Za-z]{0,5}(?:\.\d+)?"
_TAIL = r"(?:\s*\(\s*[0-9A-Za-z]{1,5}\s*\))*"

#: "sub-section (1) of section 39" and its cousins — the sub-unit is named first.
_INVERTED = re.compile(
    r"\bsub[\s\-]?(?:section|rule|regulation|paragraph)\s*\(\s*([0-9A-Za-z]{1,5})\s*\)"
    r"\s*(?:,\s*)?of\s+(section|rule|regulation|paragraph|article)\s*(" + _NUMBER + r")",
    re.IGNORECASE,
)

_DIRECT = re.compile(
    r"\b(sections?|sec\.|s\.|rules?|articles?|art\.|regulations?|reg\.|paragraphs?|para\.?"
    r"|forms?|schedules?|chapters?|parts?)\s*(" + _NUMBER + r")(" + _TAIL + r")",
    re.IGNORECASE,
)

_KIND_ALIASES = {
    "sections": "section", "section": "section", "sec.": "section", "s.": "section",
    "rules": "rule", "rule": "rule",
    "articles": "article", "article": "article", "art.": "article",
    "regulations": "regulation", "regulation": "regulation", "reg.": "regulation",
    "paragraphs": "paragraph", "paragraph": "paragraph", "para": "paragraph",
    "para.": "paragraph",
    "forms": "form", "form": "form",
    "schedules": "schedule", "schedule": "schedule",
    "chapters": "chapter", "chapter": "chapter",
    "parts": "part", "part": "part",
}

#: Names a reader actually uses that no rule could derive from the official
#: title. Everything else is generated from `short_title`; see `document_aliases`.
CURATED_ALIASES: dict[str, tuple[str, ...]] = {
    "WTO-TRIPS": ("trips", "trips agreement"),
    "UN-CBD-1992": ("cbd", "convention on biological diversity", "biodiversity convention"),
    "UN-NAGOYA-PROTOCOL-2010": ("nagoya protocol", "nagoya"),
    "IN-GI-ACT-1999": ("gi act", "geographical indications act", "gi registration act"),
    "IN-GI-RULES-2002": ("gi rules", "geographical indications rules"),
    "IN-BDA-2002-AMD-2023": ("biodiversity act", "biological diversity act", "bda"),
    "IN-BD-RULES-2024": ("biodiversity rules", "biological diversity rules"),
    "IN-ABS-REGULATIONS-2025": ("abs regulations", "access and benefit sharing regulations"),
    "IN-PPVFR-ACT-2001": ("ppvfr act", "ppv&fr act", "plant varieties act",
                          "protection of plant varieties act", "farmers rights act"),
    "IN-PPVFR-RULES-2003": ("ppvfr rules", "ppv&fr rules", "plant varieties rules"),
    "IN-DC-ACT-1940": ("drugs and cosmetics act", "d&c act"),
    "IN-DC-RULES-1945": ("drugs and cosmetics rules", "d&c rules"),
    "IN-TM-ACT-1999": ("trade marks act", "trademarks act", "trade mark act"),
    "IN-TM-RULES-2017": ("trade marks rules", "trademarks rules"),
    "IN-NATIONAL-IPR-POLICY-2016": ("national ipr policy", "ipr policy"),
    "IN-FSSAI-AYURVEDA-AAHARA-2022": ("ayurveda aahara regulations", "ayurveda aahara order"),
}


@dataclass(frozen=True)
class LocatorRef:
    """A provision named in a query: kind, number, and any parenthesised tail."""

    kind: str
    number: str
    subdivisions: tuple[str, ...] = ()


def _normalise_number(value: str) -> str:
    """`117a` and `117A` are the same section; the locator stores the upper form."""
    return value.strip().upper()


def parse_identifiers(query: str) -> list[LocatorRef]:
    """Every provision the query names, in the order it names them."""
    refs: list[LocatorRef] = []
    seen: set[tuple[str, str, tuple[str, ...]]] = set()

    def add(kind: str, number: str, subs: Iterable[str]) -> None:
        ref = LocatorRef(kind, _normalise_number(number),
                         tuple(_normalise_number(s) for s in subs))
        key = (ref.kind, ref.number, ref.subdivisions)
        if key not in seen:
            seen.add(key)
            refs.append(ref)

    consumed: list[tuple[int, int]] = []
    for match in _INVERTED.finditer(query):
        kind = _KIND_ALIASES[match.group(2).lower()]
        add(kind, match.group(3), [match.group(1)])
        consumed.append(match.span())

    for match in _DIRECT.finditer(query):
        if any(start <= match.start() < end for start, end in consumed):
            continue
        kind = _KIND_ALIASES.get(match.group(1).lower())
        if kind is None:
            continue
        number = match.group(2)
        subs = re.findall(r"\(\s*([0-9A-Za-z]{1,5})\s*\)", match.group(3) or "")
        # "Article 27.1" writes the paragraph after a dot rather than in brackets.
        if "." in number and kind == "article":
            head, _, tail = number.partition(".")
            add(kind, head, [tail, *subs])
        else:
            add(kind, number, subs)
    return refs


def document_aliases(chunks: Sequence[Chunk]) -> dict[str, tuple[str, ...]]:
    """Names each document answers to, derived from its short title plus curation."""
    aliases: dict[str, set[str]] = {}
    for chunk in chunks:
        if chunk.document_id in aliases:
            continue
        names: set[str] = set(CURATED_ALIASES.get(chunk.document_id, ()))
        short = (chunk.short_title or "").lower()
        short = re.sub(r"[^a-z0-9&\s]", " ", short)
        short = re.sub(r"\s+", " ", short).strip()
        if short:
            names.add(short)
            # The same instrument is cited with and without its year.
            without_year = re.sub(r"\s*\b(19|20)\d{2}\b", "", short).strip()
            if without_year and without_year != short:
                names.add(without_year)
        aliases[chunk.document_id] = tuple(sorted(n for n in names if len(n) >= 3))
    return aliases


def match_documents(query: str, aliases: dict[str, tuple[str, ...]]) -> set[str]:
    """Documents whose name the query states outright."""
    normalised = re.sub(r"[^a-z0-9&\s]", " ", query.lower())
    normalised = f" {re.sub(r'\\s+', ' ', normalised).strip()} "
    matched = set()
    for document_id, names in aliases.items():
        if any(f" {name} " in normalised for name in names):
            matched.add(document_id)
    return matched


def identifier_boost(chunk: Chunk, refs: Sequence[LocatorRef],
                     documents: set[str]) -> float:
    """How exactly this chunk answers to the citation in the query, in [0, 1.35].

    A named provision that matches on kind and number is worth 1.0; a query that
    also names a sub-unit gets 1.0 only when the chunk carries that sub-unit, and
    0.6 when the chunk is the whole provision (the sub-clause is inside it, which
    is usually right) — but only 0.3 when the chunk is a *different* sub-unit of
    the same provision, which usually is not. Naming the instrument is worth 0.35
    on its own: a weak prior over the right document, not a decision.
    """
    best = 0.0
    for ref in refs:
        field, sub_fields = LOCATOR_FIELD.get(ref.kind, (None, ()))
        if field is None:
            continue
        value = chunk.locator.get(field)
        if value is None or _normalise_number(str(value)) != ref.number:
            continue
        if not ref.subdivisions:
            best = max(best, 1.0)
            continue
        chunk_subs = [_normalise_number(str(chunk.locator[f]))
                      for f in sub_fields if chunk.locator.get(f) is not None]
        if not chunk_subs:
            best = max(best, 0.6)
        elif chunk_subs[0] == ref.subdivisions[0]:
            best = max(best, 1.0)
        else:
            best = max(best, 0.3)
    if chunk.document_id in documents:
        best += 0.35
    return best


class BM25IdentifierBoostRetriever(Retriever):
    """BM25, plus a deterministic bonus for chunks the query cites by name."""

    name = "bm25_boost"
    version = "0.1.0"

    def __init__(self, bm25: BM25Retriever | None = None, *, weight: float = BOOST_WEIGHT):
        self.bm25 = bm25 if bm25 is not None else BM25Retriever()
        self.weight = weight
        self.aliases = document_aliases(self.bm25.chunks)

    def rank(self, query: str, filters: Filters | None = None,
             top_k: int = 10) -> list[tuple[Chunk, float, float]]:
        scores = self.bm25.score_all(query)
        refs = parse_identifiers(query)
        documents = match_documents(query, self.aliases)
        boosts: dict[str, float] = {}
        if refs or documents:
            scale = max(scores.values(), default=0.0) or 1.0
            for chunk in self.bm25.chunks:
                boost = identifier_boost(chunk, refs, documents)
                if boost:
                    boosts[chunk.chunk_id] = boost
                    scores[chunk.chunk_id] = (scores.get(chunk.chunk_id, 0.0)
                                              + self.weight * boost * scale)
        permitted = allowed_ids(self.bm25.chunks, filters)
        if permitted is not None:
            scores = {cid: s for cid, s in scores.items() if cid in permitted}
        ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:top_k]
        return [(self.bm25.chunks[self.bm25.index[cid]], score, boosts.get(cid, 0.0))
                for cid, score in ordered]

    def search(self, query: str, filters: Filters | None = None,
               top_k: int = 10) -> list[RetrievalResult]:
        return [
            result_from_chunk(chunk, score=score, rank=rank,
                              extra={"identifier_boost": round(boost, 3)})
            for rank, (chunk, score, boost) in enumerate(self.rank(query, filters, top_k), 1)
        ]

    def config(self) -> dict[str, Any]:
        return {
            "retriever": self.name,
            "version": self.version,
            "base": self.bm25.config(),
            "boost_weight": self.weight,
            "boost_scale": "max BM25 score for the same query",
            "document_aliases": sum(len(v) for v in self.aliases.values()),
        }
