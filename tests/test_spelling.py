"""Issue 3: typo tolerance that cannot damage legal terminology or identifiers.

The vocabulary under test is the real corpus, because the module's entire
correctness argument rests on the corpus being its dictionary. A fixture
vocabulary would test the arithmetic and none of the claims.
"""
from __future__ import annotations

import pytest

from ai.retrieval.base import load_chunks
from app.spelling import (
    MIN_TARGET_FREQUENCY_FOR_DISTANCE,
    MIN_WORD_LENGTH,
    CorpusSpelling,
    skeleton,
)


@pytest.fixture(scope="module")
def speller() -> CorpusSpelling:
    return CorpusSpelling(chunk.text for chunk in load_chunks())


#: The misspellings named in the brief, plus the families they stand for.
TYPOS = [
    ("trademrk", "trademark"), ("tradmark", "trademark"),
    ("trade markk", "trade mark"), ("patant", "patent"),
    ("copywrite", "copyright"), ("copywright", "copyright"),
    ("geographcal", "geographical"), ("registraton", "registration"),
    ("applcation", "application"), ("infrigement", "infringement"),
    ("oppositon", "opposition"), ("specfication", "specification"),
    ("certifcate", "certificate"), ("biodiversty", "biodiversity"),
    ("inventon", "invention"), ("desgin", "design"),
    ("complaince", "compliance"), ("paetnt", "patent"),
]

#: Words from other subjects entirely. None of these is a misspelling of
#: anything, and correcting one would put a word the user never typed into the
#: audit trail — and, worse, into retrieval.
OUT_OF_DOMAIN = ["pizza", "topping", "toppings", "naples", "mala", "fides",
                 "football", "cricket", "sushi", "ferrari", "bitcoin",
                 "restaurant", "weather", "recipe", "guitar", "volcano",
                 "lasagna", "espresso", "tsunami", "karaoke", "burrito"]


@pytest.mark.parametrize("typed,expected", TYPOS)
def test_a_misspelling_of_a_corpus_word_is_repaired(speller, typed, expected):
    assert speller.correct(typed).corrected == expected


@pytest.mark.parametrize("word", OUT_OF_DOMAIN)
def test_a_word_from_another_subject_is_left_exactly_as_typed(speller, word):
    correction = speller.correct(word)
    assert correction.corrected == word, (
        f"{word!r} was rewritten to {correction.corrected!r}; it is not a "
        f"misspelling of anything in this corpus")
    assert not correction.applied


def test_the_whole_off_topic_question_survives_untouched(speller):
    question = "What is the best pizza topping in Naples?"
    assert speller.correct(question).corrected == question


@pytest.mark.parametrize("query", [
    "section 85B",
    "Section 85B of the Trade Marks Act",
    "section 3(p)",
    "rule 31bis",
    "Article 6ter of the Paris Convention",
    "Form 24A",
    "What does section 25(2) provide?",
])
def test_identifiers_are_never_rewritten(speller, query):
    assert speller.correct(query).corrected == query


def test_a_word_the_corpus_uses_is_never_corrected(speller):
    """The protection for legal terminology, stated as the rule that provides it."""
    for word in ("bis", "ter", "licence", "licensing", "proprietor", "opposition",
                 "assignee", "prescribed", "aforesaid", "hereinafter", "novelty"):
        if word in speller.vocabulary:
            assert speller.correct(word).corrected == word


def test_short_words_are_out_of_scope(speller):
    for word in ("abc", "xyz", "qqq"):
        assert len(word) < MIN_WORD_LENGTH
        assert speller.correct(word).corrected == word


def test_the_original_query_is_kept_for_audit(speller):
    correction = speller.correct("How do I register a tradmark?")
    assert correction.original == "How do I register a tradmark?"
    assert correction.corrected == "How do I register a trademark?"
    assert correction.applied
    payload = correction.to_dict()
    assert payload["original_query"] == correction.original
    assert payload["search_query"] == correction.corrected
    assert payload["replacements"] == [
        {"from": "tradmark", "to": "trademark", "rule": "skeleton_distance_1",
         "document_frequency": payload["replacements"][0]["document_frequency"]}]


def test_case_is_preserved_through_a_correction(speller):
    assert speller.correct("Tradmark").corrected == "Trademark"
    assert speller.correct("TRADMARK").corrected == "TRADEMARK"
    assert speller.correct("tradmark").corrected == "trademark"


def test_a_distance_correction_must_point_at_a_common_word(speller):
    """The constant that separates a typo from a foreign word, tested as such."""
    for word in OUT_OF_DOMAIN:
        replacement = speller._correct_word(word)
        assert replacement is None or (
            replacement.document_frequency >= MIN_TARGET_FREQUENCY_FOR_DISTANCE)


def test_skeleton_folds_only_spellings_that_sound_alike():
    assert skeleton("copywrite") == skeleton("copyright")
    assert skeleton("markk") == skeleton("mark")
    assert skeleton("phase") == skeleton("fase")
    # And does not fold words that merely look similar.
    assert skeleton("grant") != skeleton("grand")
    assert skeleton("patent") != skeleton("patient")
    assert skeleton("licence") != skeleton("licensee")


def test_correction_is_idempotent(speller):
    once = speller.correct("How do I register a tradmark?").corrected
    assert speller.correct(once).corrected == once


def test_an_empty_query_is_handled(speller):
    assert speller.correct("").corrected == ""
    assert speller.correct(None).corrected == ""
