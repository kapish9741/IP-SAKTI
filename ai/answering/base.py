"""The answer engine: evidence in, validated answer out.

Phase 7 §1 and §2. The engine orchestrates and decides nothing about relevance
itself — policy assesses, a provider writes, the validator admits or refuses,
the grounding check measures. What the engine owns is the order those happen in
and the single rule that binds them: **an answer is published only if every gate
passed.**

**The engine cannot retrieve.** :meth:`AnswerEngine.answer` takes a query and
evidence, and there is no retriever, index or corpus path anywhere in this
module. That is Phase 7 §2's separation expressed as a missing dependency rather
than a convention, and it is what makes the whole layer testable from seven JSON
fixtures with no model in the process.

**The engine cannot see labels.** It receives a query string and retrieval
results. There is no parameter through which an expected chunk id, a golden
answer or a benchmark label could arrive — the same structural argument Phase 6
§9 made about the reranker, for the same reason.

The failure path is the interesting one. Every gate that fails produces an
abstention carrying the structured reasons, not a best-effort answer with the
bad part removed. Phase 7 §14: the gap is never filled with model knowledge, and
it is never filled by relaxing a rule that just refused something.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Sequence

from ai.answering.citation_validator import ValidationOutcome, validate_citations
from ai.answering.grounding import (
    GroundingReport,
    check_grounding,
    normalise_markers,
)
from ai.answering.models import (
    ANSWERING_VERSION,
    CURRENT,
    HIGH,
    LOW,
    MODERATE,
    NONE,
    STALE,
    Answer,
    EvidenceSet,
    Failure,
)
from ai.answering.policy import (
    AnswerPolicy,
    PolicyReport,
    apply_policy,
    citation_cautions,
)
from ai.answering.providers import (
    AnswerProvider,
    ExtractiveMockProvider,
    ProviderDraft,
    build_request,
)
from ai.answering.render import INSUFFICIENT_EVIDENCE_MESSAGE


class AnswerEngine(ABC):
    """Turns a query and ordered evidence into a validated answer object."""

    name: str = "answer_engine"
    version: str = ANSWERING_VERSION

    @abstractmethod
    def answer(self, query: str, evidence: Any) -> Answer:
        """Answer `query` from `evidence` alone."""

    def config(self) -> dict[str, Any]:
        return {"engine": self.name, "version": self.version}


def as_evidence_set(evidence: Any) -> EvidenceSet:
    """Accept an `EvidenceSet` or any sequence of Phase 4 retrieval results.

    A Phase 6 `RerankedResult` arrives through `to_retrieval_result()`, which is
    the published bridge between the two layers; this function is where that
    lands, so no caller has to remember it.
    """
    if isinstance(evidence, EvidenceSet):
        return evidence
    return EvidenceSet.from_results(list(evidence or ()))


class GroundedAnswerEngine(AnswerEngine):
    """Policy → provider → citation validation → grounding → answer.

    Provider-agnostic by construction: the only thing it knows about its
    provider is that `generate(request)` returns prose. Swapping the
    deterministic provider for a model changes nothing else in the pipeline, and
    the model's output is validated exactly as the mock's is.
    """

    name = "grounded"
    version = ANSWERING_VERSION

    def __init__(self, provider: AnswerProvider | None = None,
                 policy: AnswerPolicy | None = None):
        self.policy = policy or AnswerPolicy()
        self.provider = provider or ExtractiveMockProvider(
            max_sentences=self.policy.max_citations)

    # -- the pipeline ---------------------------------------------------------

    def answer(self, query: str, evidence: Any) -> Answer:
        evidence_set = as_evidence_set(evidence)
        fingerprint = evidence_set.fingerprint
        report = apply_policy(query, evidence_set, self.policy)

        if report.insufficient:
            return self._abstain(report, fingerprint, report.insufficient_reasons)

        request = build_request(query, evidence_set, self.policy, report)
        draft = self.provider.generate(request)
        # One canonical text from here down. A provider may spell a marker as
        # 【1】 — one did, in Phase 7.3 Q001 — and normalising it inside the
        # checks alone would validate one string and publish a different one.
        # `draft.text` stays untouched so the diagnostics record what was
        # actually written; `text` is what the pipeline judges and shows.
        raw = draft.text or ""
        text = normalise_markers(raw)

        if not text.strip():
            return self._abstain(report, fingerprint, report.insufficient_reasons + (
                Failure(code="provider_abstained",
                        detail="the provider produced no answer from the supplied "
                               "evidence"),), provider=draft.provider, draft=draft)

        validation = validate_citations(text, evidence_set, self.policy,
                                        expected_fingerprint=fingerprint)
        if not validation.ok:
            return self._abstain(report, fingerprint, report.insufficient_reasons + (
                Failure(code="citation_validation_failed",
                        detail=f"{len(validation.failures)} citation rule(s) failed; "
                               f"the answer was not published"),),
                validation=validation, provider=draft.provider, draft=draft)

        grounding = check_grounding(text, evidence_set)
        if self.policy.require_full_grounding and not grounding.grounded:
            return self._abstain(report, fingerprint, report.insufficient_reasons + (
                Failure(code="ungrounded_answer",
                        detail=f"{len(grounding.unsupported_claims)} claim(s) in the "
                               f"answer carry no citation"),),
                validation=validation, grounding=grounding,
                provider=draft.provider, draft=draft)

        # Policy's cautions are about the evidence that was supplied; these are
        # about the sources the answer actually cites, and they can only be
        # written now that the citations exist. Phase 7.8.
        cautions = list(report.cautions) + list(citation_cautions(validation.citations))
        if grounding.weakly_grounded:
            cautions.append(
                f"{len(grounding.weakly_grounded)} sentence(s) cite a source that "
                f"shares little wording with them; check the source text.")

        return Answer(
            answer=text.strip(),
            citations=validation.citations,
            confidence=self._confidence(report, validation, grounding),
            grounded=grounding.grounded,
            insufficient_evidence=False,
            conflict_detected=bool(report.conflicts),
            conflict_chunks=report.conflict_chunks,
            cautions=tuple(cautions),
            unsupported_claims=grounding.unsupported_claims,
            uncited_evidence=grounding.uncited_evidence,
            evidence_fingerprint=fingerprint,
            provider=draft.provider,
            policy=self.policy.to_dict(),
            diagnostics={"policy_report": report.to_dict(),
                         "validation": validation.to_dict(),
                         "grounding": grounding.to_dict(),
                         "provider_config": self.provider.config(),
                         "provider_diagnostics": dict(draft.diagnostics),
                         "marker_normalisation_applied": text != raw},
        )

    # -- abstention and confidence -------------------------------------------

    def _abstain(self, report: PolicyReport, fingerprint: str,
                 reasons: Sequence[Failure],
                 validation: ValidationOutcome | None = None,
                 grounding: GroundingReport | None = None,
                 provider: str = "",
                 draft: ProviderDraft | None = None) -> Answer:
        """Say so, and say why. Never fill the gap (Phase 7 §14)."""
        diagnostics: dict[str, Any] = {"policy_report": report.to_dict()}
        if validation is not None:
            diagnostics["validation"] = validation.to_dict()
        if grounding is not None:
            diagnostics["grounding"] = grounding.to_dict()
        if draft is not None:
            # Without this the answered path recorded `provider_diagnostics` and
            # the abstention path did not, so a provider failure arrived as the
            # bare word `provider_abstained` and its actual cause — `unauthorized`
            # against `rate_limited` against `empty_completion`, three unrelated
            # problems with three unrelated fixes — was discarded here. An
            # abstention is the case where the cause matters most. The provider
            # has already scrubbed its credential out of these strings.
            diagnostics["provider_diagnostics"] = dict(draft.diagnostics)
            if draft.text.strip():
                # The text that was refused, kept where it can be read and
                # nowhere it can be shown: `answer` stays the refusal message and
                # the renderer never touches this key. Discarding it made the
                # engine unauditable in exactly the case worth auditing — a
                # rejected draft is the only evidence of *how* a model failed,
                # and "2 claims carry no citation" without the claims is a
                # verdict with the reasoning torn off.
                diagnostics["rejected_draft"] = draft.text.strip()

        # Validation detail lives in `validation_failures` and the gate that
        # tripped lives in `insufficient_evidence_reasons`. Merging them would
        # print every failure twice and make the two fields' meanings unstable.
        return Answer(
            answer=INSUFFICIENT_EVIDENCE_MESSAGE,
            citations=(),
            confidence=NONE,
            grounded=False,
            insufficient_evidence=True,
            insufficient_evidence_reasons=tuple(reasons),
            conflict_detected=bool(report.conflicts),
            conflict_chunks=report.conflict_chunks,
            cautions=report.cautions,
            validation_failures=validation.failures if validation else (),
            evidence_fingerprint=fingerprint,
            provider=provider or self.provider.name,
            policy=self.policy.to_dict(),
            diagnostics=diagnostics,
        )

    def _confidence(self, report: PolicyReport, validation: ValidationOutcome,
                    grounding: GroundingReport) -> str:
        """An ordinal read of the evidence behind a published answer.

        Deliberately not a number. Nothing in this pipeline estimates the
        probability that an answer is legally correct, and a decimal would be
        read as though something did. What this ranks is the provenance of the
        sources the answer actually cites — level, currency, and whether they
        agree — which is a different and much smaller claim.
        """
        citations = validation.citations
        if not citations or not grounding.grounded:
            return LOW
        levels = {c.source_evidence_level for c in citations}
        statuses = {c.temporal_status for c in citations}

        if report.conflicts:
            return LOW
        if statuses == {STALE} or levels & {"C", "D"}:
            return LOW
        if levels == {"A"} and statuses == {CURRENT} and not grounding.weakly_grounded:
            return HIGH
        return MODERATE

    def config(self) -> dict[str, Any]:
        return {"engine": self.name, "version": self.version,
                "provider": self.provider.config(),
                "policy": self.policy.to_dict(),
                "retrieval_performed_here": False}
