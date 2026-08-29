"""An interpretable reranker: named features, declared weights, no training.

Phase 6 §25 forbids learning anything from the 111 golden questions, and it is
right to — none of them has been verified by a human, so a weight fitted to them
would encode whatever the corpus-derived ground truth happens to get wrong and
then report that as a result. Every weight here was written down before the
benchmark was run, from figures Phase 5 already published, and none has been
adjusted since.

Three scores, kept apart on purpose (Phase 6 §6)
-----------------------------------------------

``relevance_score``   Does this passage answer the question? Built only from
                      query-to-text and query-to-locator evidence.
``authority_score``   How good is our evidence about the document — source
                      evidence level and temporal status. Never added to
                      relevance here.
``citability``        A boolean, copied from the chunk. Never scored at all.

The separation is the point. A citable Level A provision that does not address
the question is not a better answer than a stale Level C one that does; it is a
worse answer that we happen to have better paperwork for. Folding authority into
relevance makes those two indistinguishable in the score, and by the time a
number reaches a report there is no way to tell which one produced it.
:class:`AuthorityPolicyReranker` applies authority *afterwards*, as an explicit
tiebreak, so its effect can be measured rather than assumed (experiment F3).

Normalization (Phase 6 §7)
--------------------------

BM25 scores and cosine similarities share no scale, and this module never adds
them raw. Two normalisations were written down before any run, both bounded to
[0, 1] within the candidate pool:

``min_max``          ``(score - min) / (max - min)`` over the pool.
``rank_percentile``  ``1 - (rank - 1) / n_ranked_by_that_engine``.

The a-priori argument favoured rank percentile, on the grounds that min-max is
set by two order statistics and one of them is an outlier by construction: on an
identifier query the boosted lexical retriever adds a full best-BM25-score to one
chunk, so its maximum is roughly double the runner-up and everything else is
compressed into the bottom of the range.

**The measurement contradicted that argument, and the measurement wins** — §7
says to choose on empirical behaviour. Over the 111 questions, min-max scored
Recall@1 0.784 / MRR 0.852 against rank percentile's 0.712 / 0.814, and the
gain is on conceptual queries (0.753 against 0.656), which are 93 of the 111.

The reason is worth recording, because it says something about the corpus rather
than about the constant. Rank percentile discards the *size* of the gaps between
adjacent candidates, and inside a 50-deep pool those gaps are most of the signal:
BGE-M3's rank 1 and rank 12 differ by 0.22 in percentile, which at a weight of
0.60 is 0.13 — less than the 0.15 a rank-1 lexical hit contributes on its own. So
under rank percentile a single strong BM25 match outvotes eleven positions of
dense evidence. Min-max keeps the cosine margin, and a dense hit that is
genuinely far ahead of the pool stays ahead. The outlier concern was real but
lands on the *lexical* feature, which carries 0.15 of the weight, not on the
dense one that carries 0.60.

Two caveats, stated because this is the one empirical choice in the module:

* It is a single global choice between two options declared in advance — not a
  per-question adjustment, which §7 forbids and which nothing here does.
* It was made on a benchmark **no human has verified**. If the ground truth is
  wrong in a systematic way, so is this choice. `--normalization rank_percentile`
  remains available and its full results are kept alongside the primary run.

z-score was considered and not run: it is unbounded and assumes a roughly
symmetric spread, and BM25 over a 3,073-chunk corpus is heavily right-skewed, so
a candidate can be "above average" while ranked 30th.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from ai.reranking.base import Reranker, RerankedResult, order_by_score
from ai.retrieval.candidates import Candidate
from ai.retrieval.identifiers import (
    LOCATOR_FIELD,
    LocatorRef,
    match_documents,
    parse_identifiers,
)
from ai.retrieval.router import CONCEPTUAL, GENERAL, IDENTIFIER, classify
from ai.retrieval.tokenizer import tokenize

#: Feature names, in the order they are reported. `locator_referenced` carries
#: weight 0 in every family: it is the Phase 6 §10 diagnostic that distinguishes
#: "this chunk *is* section 3(p)" from "this chunk *mentions* section 3(p)", and
#: it is measured rather than acted on until there is evidence for a weight.
FEATURES = (
    "dense_percentile",
    "lexical_percentile",
    "locator_exactness",
    "locator_referenced",
    "document_match",
    "idf_coverage",
    "phrase_overlap",
)

#: Weights per query family, declared a priori from the Phase 5 family tables:
#: on identifier queries the boosted lexical retriever scored Recall@1 0.944
#: against BGE-M3's 0.611, and on conceptual queries 0.355 against 0.731. The
#: weights follow that split, coarsely. They are not fitted and are not tuned;
#: changing one is a change to the published configuration, not a knob.
WEIGHTS: dict[str, dict[str, float]] = {
    IDENTIFIER: {
        "locator_exactness": 0.50,
        "lexical_percentile": 0.25,
        "dense_percentile": 0.10,
        "document_match": 0.10,
        "phrase_overlap": 0.05,
        "idf_coverage": 0.0,
        "locator_referenced": 0.0,
    },
    CONCEPTUAL: {
        "dense_percentile": 0.60,
        "lexical_percentile": 0.15,
        "phrase_overlap": 0.10,
        "idf_coverage": 0.10,
        "locator_exactness": 0.025,
        "document_match": 0.025,
        "locator_referenced": 0.0,
    },
}
#: GENERAL routes exactly as CONCEPTUAL does, for the Phase 5 reason: both are
#: semantic-similarity problems and the split between them has no retrieval
#: consequence. Sharing the table makes that explicit rather than duplicating it.
WEIGHTS[GENERAL] = WEIGHTS[CONCEPTUAL]

#: Authority, kept out of the relevance score. Level A is a verified official
#: copy; C is the weakest evidence Phase 3 admits. STALE means Phase 3 found a
#: newer official version than the one in the corpus.
EVIDENCE_LEVEL_SCORE = {"A": 1.0, "B": 0.6, "C": 0.3}
TEMPORAL_SCORE = {"CURRENT": 1.0, "UNKNOWN": 0.5, "STALE": 0.4}
AUTHORITY_WEIGHTS = {"evidence_level": 0.6, "temporal": 0.4}

#: How far authority may move a candidate, in units of the base reranker's
#: min-max-normalised score. 0.05 means authority can only reorder candidates
#: the relevance model already considers within 5% of each other.
AUTHORITY_LAMBDA = 0.05


def _percentile(rank: int | None, total: int) -> float:
    """Rank percentile within the pool; 0.0 for a candidate the engine missed.

    An engine that did not return the chunk gets 0.0 rather than a small
    positive value, because "outside my depth" is a different statement from
    "ranked last", and only the first is what actually happened.
    """
    if rank is None or total <= 0:
        return 0.0
    return max(0.0, 1.0 - (rank - 1) / float(total))


def locator_scores(refs: Sequence[LocatorRef], locator: Mapping[str, Any],
                   text: str) -> tuple[float, float]:
    """``(exactness, referenced_only)`` for a candidate against a cited provision.

    *Exactness* reuses the Phase 4 scale, minus its document bonus, which is a
    separate feature here: 1.0 for the provision (and its named sub-unit if one
    was named), 0.6 for the whole provision when a sub-unit was named and the
    chunk is not split that finely, 0.3 for a *different* sub-unit of the same
    provision, 0.0 otherwise.

    *Referenced only* is 1.0 when the query's citation appears in the chunk's
    prose while the chunk's own locator is something else — "section 3" written
    inside section 64's text. Phase 6 §10 wants those separated from the
    provision itself, and the separation is made from the locator metadata,
    never from the fact that a number appears in the text.
    """
    best = 0.0
    for ref in refs:
        field, sub_fields = LOCATOR_FIELD.get(ref.kind, (None, ()))
        if field is None:
            continue
        value = locator.get(field)
        if value is None or str(value).strip().upper() != ref.number:
            continue
        if not ref.subdivisions:
            best = max(best, 1.0)
            continue
        subs = [str(locator[f]).strip().upper()
                for f in sub_fields if locator.get(f) is not None]
        if not subs:
            best = max(best, 0.6)
        elif subs[0] == ref.subdivisions[0]:
            best = max(best, 1.0)
        else:
            best = max(best, 0.3)

    referenced = 0.0
    if best == 0.0 and refs:
        lowered = text.lower()
        for ref in refs:
            pattern = rf"\b{re.escape(ref.kind)}s?\s*{re.escape(ref.number.lower())}\b"
            if re.search(pattern, lowered):
                referenced = 1.0
                break
    return best, referenced


def idf_coverage(query_tokens: Sequence[str], chunk_tokens: set[str],
                 idf: Mapping[str, float] | None) -> float:
    """Share of the query's *informative* mass that the chunk contains.

    Weighting by inverse document frequency is what removes the need for a
    hand-written stopword list: "the" and "of" occur in nearly every chunk, so
    their IDF is near zero and covering them earns nothing. A term the corpus
    uses twice carries almost the whole score. Without an IDF table the feature
    degrades to plain type coverage, which is the honest fallback rather than a
    silent zero.
    """
    distinct = list(dict.fromkeys(query_tokens))
    if not distinct:
        return 0.0
    if not idf:
        return sum(1.0 for t in distinct if t in chunk_tokens) / len(distinct)
    weights = {t: max(idf.get(t, 0.0), 0.0) for t in distinct}
    total = sum(weights.values())
    if total <= 0.0:
        return sum(1.0 for t in distinct if t in chunk_tokens) / len(distinct)
    return sum(w for t, w in weights.items() if t in chunk_tokens) / total


def phrase_overlap(query_tokens: Sequence[str], chunk_tokens: Sequence[str]) -> float:
    """Longest run of consecutive query tokens the chunk repeats verbatim.

    Reported as a fraction of the query's length, and 0.0 for runs shorter than
    two tokens — a single shared word is already counted by `idf_coverage`, and
    counting it twice would say a chunk shares a *phrase* with the query when it
    shares a word. This is the feature that separates a passage quoting the
    query's own statutory wording from one merely about the same topic.
    """
    if len(query_tokens) < 2 or not chunk_tokens:
        return 0.0
    positions: dict[str, list[int]] = {}
    for index, token in enumerate(chunk_tokens):
        positions.setdefault(token, []).append(index)
    best = 0
    for start in range(len(query_tokens)):
        for begin in positions.get(query_tokens[start], ()):
            length = 0
            while (start + length < len(query_tokens)
                   and begin + length < len(chunk_tokens)
                   and query_tokens[start + length] == chunk_tokens[begin + length]):
                length += 1
            best = max(best, length)
    return best / len(query_tokens) if best >= 2 else 0.0


def authority_score(candidate: Candidate) -> tuple[float, dict[str, float]]:
    """Evidence quality, on its own axis. Not relevance, and never added to it."""
    level = EVIDENCE_LEVEL_SCORE.get(
        str(candidate.metadata.get("source_evidence_level") or ""), 0.3)
    temporal = TEMPORAL_SCORE.get(
        str(candidate.metadata.get("temporal_status") or "UNKNOWN"), 0.5)
    score = (AUTHORITY_WEIGHTS["evidence_level"] * level
             + AUTHORITY_WEIGHTS["temporal"] * temporal)
    return score, {"evidence_level": level, "temporal": temporal}


@dataclass(frozen=True)
class Scored:
    """One candidate's full working, for reporting and for review tooling."""

    candidate: Candidate
    features: dict[str, float]
    relevance_score: float
    authority_score: float
    authority_features: dict[str, float]
    citable: bool


class FeatureReranker(Reranker):
    """Weighted named features. Deterministic, explainable, and untrained."""

    name = "features"
    version = "0.1.0"

    def __init__(self, *, idf: Mapping[str, float] | None = None,
                 aliases: Mapping[str, Sequence[str]] | None = None,
                 weights: Mapping[str, Mapping[str, float]] | None = None,
                 normalization: str = "min_max"):
        if normalization not in ("rank_percentile", "min_max"):
            raise ValueError(f"unknown normalization: {normalization}")
        self.idf = dict(idf or {})
        self.aliases = dict(aliases or {})
        self.weights = {k: dict(v) for k, v in (weights or WEIGHTS).items()}
        self.normalization = normalization

    # ------------------------------------------------------------- scoring ---

    def _engine_features(self, candidates: Sequence[Candidate]) -> list[dict[str, float]]:
        """Normalised dense and lexical evidence for every candidate."""
        dense_ranked = sum(1 for c in candidates if c.dense_rank is not None)
        lexical_ranked = sum(1 for c in candidates if c.lexical_rank is not None)
        if self.normalization == "rank_percentile":
            return [{"dense_percentile": _percentile(c.dense_rank, dense_ranked),
                     "lexical_percentile": _percentile(c.lexical_rank, lexical_ranked)}
                    for c in candidates]

        def min_max(values: Sequence[float | None]) -> list[float]:
            present = [v for v in values if v is not None]
            if not present:
                return [0.0] * len(values)
            low, high = min(present), max(present)
            span = high - low
            return [0.0 if v is None else (1.0 if span <= 0 else (v - low) / span)
                    for v in values]

        dense = min_max([c.dense_score for c in candidates])
        lexical = min_max([c.lexical_score for c in candidates])
        return [{"dense_percentile": d, "lexical_percentile": l}
                for d, l in zip(dense, lexical)]

    def score(self, query: str, candidates: Sequence[Candidate]) -> list[Scored]:
        """Every candidate's features and the two scores, in candidate order."""
        decision = classify(query, self.aliases)
        family = decision.query_type
        weights = self.weights.get(family, self.weights[CONCEPTUAL])
        refs = parse_identifiers(query)
        documents = match_documents(query, self.aliases) if self.aliases else set()
        query_tokens = tokenize(query)
        engine = self._engine_features(candidates)

        scored: list[Scored] = []
        for candidate, engine_features in zip(candidates, engine):
            chunk_tokens = tokenize(candidate.text)
            locator = candidate.metadata.get("locator_fields") or {}
            exactness, referenced = locator_scores(refs, locator, candidate.text)
            features = {
                "dense_percentile": engine_features["dense_percentile"],
                "lexical_percentile": engine_features["lexical_percentile"],
                "locator_exactness": exactness,
                "locator_referenced": referenced,
                "document_match": 1.0 if candidate.document_id in documents else 0.0,
                "idf_coverage": idf_coverage(query_tokens, set(chunk_tokens), self.idf),
                "phrase_overlap": phrase_overlap(query_tokens, chunk_tokens),
            }
            relevance = sum(weights.get(name, 0.0) * value
                            for name, value in features.items())
            authority, authority_features = authority_score(candidate)
            scored.append(Scored(
                candidate=candidate,
                features=features,
                relevance_score=relevance,
                authority_score=authority,
                authority_features=authority_features,
                citable=candidate.citable,
            ))
        return scored

    def rerank(self, query: str, candidates: Sequence[Candidate],
               top_k: int = 10) -> list[RerankedResult]:
        scored = self.score(query, candidates)
        payload = [
            (item.candidate, item.relevance_score,
             {**item.features,
              "relevance_score": item.relevance_score,
              "authority_score": item.authority_score})
            for item in scored
        ]
        return order_by_score(payload, top_k)

    def config(self) -> dict[str, Any]:
        return {
            "reranker": self.name,
            "version": self.version,
            "trained": False,
            "features": list(FEATURES),
            "normalization": self.normalization,
            "normalization_rationale":
                "min-max within the candidate pool, selected over rank "
                "percentile on measured behaviour (Phase 6 section 7); BM25 and "
                "cosine scores are never added on a shared scale",
            "weights": {family: dict(table) for family, table in self.weights.items()},
            "weights_provenance":
                "declared a priori from the Phase 5 per-family Recall@1 tables; "
                "not fitted to the golden questions",
            "authority": {
                "kept_separate_from_relevance": True,
                "evidence_level_score": EVIDENCE_LEVEL_SCORE,
                "temporal_score": TEMPORAL_SCORE,
                "weights": AUTHORITY_WEIGHTS,
            },
            "citability": "reported, never scored",
            "query_family_classifier": "ai.retrieval.router.classify (deterministic)",
            "idf_terms": len(self.idf),
        }


class AuthorityPolicyReranker(Reranker):
    """Experiment F3: a relevance reranker, then authority as an explicit tiebreak.

    The base reranker's scores are min-max normalised within the pool and
    authority is added at weight ``lambda``. With ``lambda = 0.05`` authority can
    only reorder candidates whose normalised relevance already sits within 5% of
    each other — so the policy is a tiebreak by construction, not a re-ranking
    wearing a tiebreak's name. That bound is the reason the number is worth
    reporting: if F3 moves the metrics much, it moved them among candidates the
    relevance model could not separate.

    Citability is deliberately not part of the policy. Promoting citable chunks
    would make a passage look more relevant for a reason that has nothing to do
    with what it says (Phase 6 §6); demoting non-citable ones would hide
    statutory text from search, which Phase 3 already decided against. The flag
    is carried through for the answer layer to enforce.
    """

    version = "0.1.0"

    def __init__(self, base: Reranker, *, weight: float = AUTHORITY_LAMBDA):
        self.base = base
        self.weight = weight
        self.name = f"{base.name}+authority"

    def rerank(self, query: str, candidates: Sequence[Candidate],
               top_k: int = 10) -> list[RerankedResult]:
        # The base scores the whole pool: a tiebreak applied to a truncated list
        # could not promote anything from below the cut, which would make the
        # policy's effect depend on top_k.
        base = self.base.rerank(query, candidates, top_k=len(candidates))
        scores = [r.rerank_score for r in base]
        low, high = (min(scores), max(scores)) if scores else (0.0, 0.0)
        span = high - low

        payload = []
        for result in base:
            normalised = 1.0 if span <= 0 else (result.rerank_score - low) / span
            authority, authority_features = authority_score(result.candidate)
            payload.append((
                result.candidate,
                normalised + self.weight * authority,
                {**result.components,
                 "base_score": result.rerank_score,
                 "base_score_normalised": normalised,
                 "authority_score": authority,
                 **{f"authority_{k}": v for k, v in authority_features.items()}},
            ))
        return order_by_score(payload, top_k)

    def config(self) -> dict[str, Any]:
        return {
            "reranker": self.name,
            "version": self.version,
            "policy": "min-max normalise the base score within the pool, then "
                      "add lambda * authority_score",
            "lambda": self.weight,
            "guarantee": f"authority can only reorder candidates within "
                         f"{self.weight:.0%} of each other on the base scale",
            "authority": {
                "evidence_level_score": EVIDENCE_LEVEL_SCORE,
                "temporal_score": TEMPORAL_SCORE,
                "weights": AUTHORITY_WEIGHTS,
            },
            "citability_in_policy": False,
            "base": self.base.config(),
        }
