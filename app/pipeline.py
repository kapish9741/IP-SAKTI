"""The demo pipeline: built once, answered many times.

`QUESTION → CANDIDATES → RERANK → EVIDENCE → ANSWER → VALIDATED CITATIONS`,
which is the path `scripts/evaluation/phase73_five_questions.py` established.
Two deliberate differences from that script, both stated rather than buried:

* **The dense arm is enabled.** Phase 7.3 disabled it because that phase
  forbade loading a local model. The prototype has no such constraint, and
  lexical-only retrieval would demonstrate the system at Recall@1 0.451 instead
  of the routed 0.766 the project actually achieves.
* **The reranker is the deterministic feature reranker**, not the cross-encoder.
  `bge-reranker-v2-m3` scores higher (0.874 vs 0.784 Recall@1 on the unverified
  benchmark) but its latency was never measured — `docs/RERANKING_BENCHMARK.md`
  lists that as an unrun experiment — and an unmeasured per-query cost is not
  something to discover during a demo. Set `IPSAKTI_RERANKER=cross_encoder` to
  switch; nothing else changes.

The provider is chosen once, at startup, from the environment. That is a
configuration choice, not a fallback chain: a request that fails is an
abstention, and nothing here retries, regenerates or switches models.
"""
from __future__ import annotations

import os
import sys
import threading
import time
from typing import Any

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from ai.answering import (  # noqa: E402
    AnswerPolicy,
    ExtractiveMockProvider,
    GroundedAnswerEngine,
    SYSTEM_DISCLAIMER,
    as_evidence_set,
    render_answer,
)
from ai.answering.groq import GroqConfig, GroqProvider, load_env_file  # noqa: E402
from ai.retrieval.base import load_chunks  # noqa: E402
from ai.retrieval.bm25 import BM25Retriever  # noqa: E402
from ai.retrieval.candidates import CandidateGenerator  # noqa: E402
from ai.retrieval.identifiers import BM25IdentifierBoostRetriever  # noqa: E402
from ai.reranking.features import FeatureReranker  # noqa: E402

APP_VERSION = "0.1.0"

DENSE_DEPTH = 50
LEXICAL_DEPTH = 50
#: Passages handed to the answer provider. Five is what Phase 7.3 used and what
#: the 800-token completion budget was measured against.
TOP_K = 5

MAX_QUESTION_CHARS = 500

#: Provider failures that say nothing about the evidence. `ai/answering/groq.py`
#: turns every one of these into an abstention, which is the right behaviour —
#: no answer is published — but it is the wrong *explanation* to show a user.
#: "I could not support an answer from this evidence" and "the API refused the
#: request" are different claims, and a demo that renders a rate limit as a
#: safety decision is taking credit it has not earned. Reported apart; handled
#: identically. `empty_completion` is deliberately absent: a model that saw the
#: evidence and wrote nothing has made a judgement, not failed to be reached.
SERVICE_ERROR_CODES = frozenset({
    "rate_limited", "transport_error", "unauthorized", "forbidden",
    "server_error", "http_error", "missing_api_key", "malformed_response",
    "payload_audit_failed", "unexpected_error",
})

SERVICE_ERROR_MESSAGES = {
    "rate_limited": "The language provider is rate-limited right now (free-tier "
                    "per-minute cap). No answer was generated. This is a service "
                    "limit, not a finding about the evidence — wait a moment and ask again.",
    "missing_api_key": "No language-provider credential is configured, so no answer "
                       "was generated. Restart with --provider extractive to run "
                       "fully offline.",
    "unauthorized": "The language provider rejected the credential. No answer was generated.",
    "forbidden": "The language provider refused the request. No answer was generated.",
    "transport_error": "The language provider could not be reached. No answer was "
                       "generated. Check the network, or restart with "
                       "--provider extractive to run fully offline.",
}
DEFAULT_SERVICE_MESSAGE = ("The language provider did not complete the request, so "
                           "no answer was generated. Nothing unverified is shown.")


def _service_failure(answer) -> dict[str, Any] | None:
    """Distinguish 'the provider could not be reached' from 'the evidence
    did not support an answer'. Both publish nothing; only one is our claim."""
    if not answer.insufficient_evidence:
        return None
    diagnostics = answer.diagnostics.get("provider_diagnostics") or {}
    code = diagnostics.get("error")
    if code not in SERVICE_ERROR_CODES:
        return None
    return {"code": code,
            "message": SERVICE_ERROR_MESSAGES.get(code, DEFAULT_SERVICE_MESSAGE),
            "detail": str(diagnostics.get("detail") or "")[:400]}


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


class Pipeline:
    """Everything loaded once, guarded by one lock.

    The lock serialises `answer()`. A demo has one user, the dense retriever
    keeps a mutable query cache, and torch is not obliged to enjoy concurrent
    calls — so the cheapest correct thing is to answer one question at a time.
    """

    def __init__(self, *, use_dense: bool = True, reranker: str = "features",
                 provider: str = "auto", log=print):
        self._lock = threading.Lock()
        self.log = log
        self.warnings: list[str] = []
        started = time.perf_counter()

        load_env_file()

        self.chunks = load_chunks()
        log(f"  corpus              {len(self.chunks)} chunks")

        bm25 = BM25Retriever(self.chunks)
        self.lexical = BM25IdentifierBoostRetriever(bm25)
        log(f"  lexical index       ready ({self.lexical.name})")

        self.dense = None
        self.dense_status = "disabled"
        if use_dense:
            self.dense, self.dense_status = self._build_dense()

        self.generator = CandidateGenerator(
            dense=self.dense or _NoDense(), lexical=self.lexical,
            mode="expanded", order="interleaved",
            dense_depth=DENSE_DEPTH, lexical_depth=LEXICAL_DEPTH,
            aliases=self.lexical.aliases)

        self.reranker = self._build_reranker(reranker, bm25)
        log(f"  reranker            {self.reranker.name}")

        self.policy = AnswerPolicy()
        self.provider_name, self.provider = self._build_provider(provider)
        self.engine = GroundedAnswerEngine(provider=self.provider, policy=self.policy)
        log(f"  answer provider     {self.provider_name}")

        self.startup_seconds = round(time.perf_counter() - started, 2)

    # -- construction ---------------------------------------------------------

    @staticmethod
    def _prefer_cached_model() -> None:
        """Never let a hub lookup stand between the demo and a cached model.

        `SentenceTransformer` contacts huggingface.co on load to check for a
        newer revision. On a good network that costs a second; on a conference
        network it can hang, and the model is already on disk. So when the
        snapshot is present, the hub is pinned offline. When it is not, the
        variable is left alone and the normal download path still works.
        `HF_HUB_OFFLINE` set by the caller always wins.
        """
        cached = os.path.expanduser("~/.cache/huggingface/hub/models--BAAI--bge-m3")
        if os.path.isdir(cached):
            os.environ.setdefault("HF_HUB_OFFLINE", "1")

    def _build_dense(self):
        """Load BGE-M3, or degrade to lexical-only and say so.

        A missing model or a cold embedding cache must not take the demo down
        with it. Retrieval quality drops and `/api/health` reports it; the
        answer path is unaffected, because nothing downstream of retrieval
        knows which engines produced the candidates.
        """
        try:
            self._prefer_cached_model()
            from ai.retrieval.dense import DenseRetriever

            t = time.perf_counter()
            dense = DenseRetriever(self.chunks)
            self.log(f"  dense index         {dense.embeddings.shape[0]} vectors "
                     f"({time.perf_counter() - t:.1f}s)")
            t = time.perf_counter()
            dense.embed_query("warm up the encoder so the first user does not")
            self.log(f"  BGE-M3 warm         {time.perf_counter() - t:.1f}s")
            return dense, "ready"
        except Exception as exc:  # noqa: BLE001 - degrade, never crash
            message = (f"dense retrieval unavailable ({type(exc).__name__}: {exc}); "
                       f"running lexical-only, which lowers retrieval quality")
            self.warnings.append(message)
            self.log(f"  dense index         UNAVAILABLE — {exc}")
            return None, "unavailable"

    def _build_reranker(self, choice: str, bm25):
        if choice == "cross_encoder":
            try:
                from ai.reranking.cross_encoder import CrossEncoderReranker

                return CrossEncoderReranker()
            except Exception as exc:  # noqa: BLE001
                self.warnings.append(
                    f"cross-encoder reranker unavailable ({exc}); using features")
        return FeatureReranker(idf=bm25.idf, aliases=self.lexical.aliases)

    def _build_provider(self, choice: str):
        """`auto` means Groq when a key exists, the offline provider otherwise.

        The extractive provider is not a degraded Groq. It is the project's
        default provider: deterministic, offline, quotes the corpus verbatim,
        and subject to exactly the same citation and grounding gates. It is what
        makes the demo survive a dead venue network.
        """
        if choice == "extractive":
            return "extractive (offline, deterministic)", ExtractiveMockProvider(
                max_sentences=self.policy.max_citations)
        if not os.environ.get("GROQ_API_KEY"):
            if choice == "groq":
                self.warnings.append(
                    "GROQ_API_KEY is not set; using the offline extractive provider")
            return "extractive (offline, deterministic)", ExtractiveMockProvider(
                max_sentences=self.policy.max_citations)
        config = GroqConfig.from_environment()
        return f"groq · {config.model}", GroqProvider(config=config)

    # -- the request path -----------------------------------------------------

    def answer(self, question: str) -> dict[str, Any]:
        """One question, one answer-generation call, no retries."""
        question = (question or "").strip()
        if not question:
            raise ValueError("Ask a question first.")
        if len(question) > MAX_QUESTION_CHARS:
            raise ValueError(
                f"Question is too long ({len(question)} characters; "
                f"the limit is {MAX_QUESTION_CHARS}).")

        with self._lock:
            t0 = time.perf_counter()
            pool = self.generator.generate(question)
            t1 = time.perf_counter()
            reranked = self.reranker.rerank(question, pool.candidates, TOP_K)
            evidence = as_evidence_set([r.to_retrieval_result() for r in reranked])
            t2 = time.perf_counter()
            answer = self.engine.answer(question, evidence)
            t3 = time.perf_counter()

        cited = {c.chunk_id for c in answer.citations}
        service_failure = _service_failure(answer)
        if service_failure:
            status = "UNAVAILABLE"
        elif answer.insufficient_evidence:
            status = "ABSTAINED"
        else:
            status = "ANSWERED"
        return {
            "question": question,
            "status": status,
            "service_failure": service_failure,
            "answer": answer.to_dict(),
            "rendered": render_answer(answer, show_confidence=True),
            "disclaimer": SYSTEM_DISCLAIMER,
            "evidence": [
                dict(item.to_dict(),
                     text=item.text,
                     locator_text=item.locator_text,
                     heading=item.heading,
                     unit_type=item.unit_type,
                     domain=item.domain,
                     source_status=item.source_status,
                     official_source_url=item.official_source_url,
                     retrieval_score=item.retrieval_score,
                     cited=item.chunk_id in cited)
                for item in evidence],
            "timings_ms": {
                "retrieval": round((t1 - t0) * 1000, 1),
                "reranking": round((t2 - t1) * 1000, 1),
                "answering": round((t3 - t2) * 1000, 1),
                "total": round((t3 - t0) * 1000, 1),
            },
            "pipeline": {
                "candidates": len(pool.candidates),
                "evidence_count": len(evidence),
                "retrievers": "dense(BGE-M3) + BM25+identifier-boost"
                              if self.dense else "BM25+identifier-boost (lexical only)",
                "reranker": self.reranker.name,
                "provider": self.provider_name,
            },
        }

    # -- health ---------------------------------------------------------------

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "app_version": APP_VERSION,
            "startup_seconds": self.startup_seconds,
            "corpus": {"chunks": len(self.chunks),
                       "documents": len({c.document_id for c in self.chunks})},
            "retrieval": {"dense": self.dense_status,
                          "lexical": "ready",
                          "reranker": self.reranker.name},
            "answering": {"provider": self.provider_name,
                          "versions": self.engine.config()},
            "warnings": self.warnings,
        }


class _NoDense:
    """Stands in for the dense arm when it could not be loaded.

    Named for what it is. `CandidateGenerator` merges whatever each engine
    returns, so one contributing engine makes the round-robin the identity
    function over the lexical ranking — the same mechanism Phase 7.3 used.
    """

    name = "dense_unavailable"
    version = "0.0.0"

    def search(self, query, filters=None, top_k=10):
        return []

    def config(self):
        return {"retriever": self.name, "disabled_reason": "model unavailable"}


def build(log=print) -> Pipeline:
    return Pipeline(
        use_dense=_flag("IPSAKTI_DENSE", True),
        reranker=os.environ.get("IPSAKTI_RERANKER", "features"),
        provider=os.environ.get("IPSAKTI_PROVIDER", "auto"),
        log=log)
