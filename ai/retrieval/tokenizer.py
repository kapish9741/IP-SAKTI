"""Tokenization for statutory text, where the identifiers *are* the content.

A general-purpose tokenizer is actively harmful here. Split on punctuation and
`3(p)` becomes `3` and `p`; stem, and `31bis` becomes `31bi`; case-fold naively
and `PPV&FR` becomes two tokens. Each of those destroys the one string that
distinguishes the right provision from ninety near-identical neighbours.

So identifiers are matched *first*, as whole tokens, before anything general
applies. Nothing is stemmed. The only normalisation is case folding, which is
safe because legal identifiers are not case-distinguished — `31bis` and `31BIS`
are the same article — and it lets a lowercase query find `TRIPS`.

One asymmetry is worth stating plainly: a query saying "section 3(p)" produces
the token `3(p)`, but the *text* of section 3 rarely contains that string — it
reads "3." on one line and "(p)" on another. Matching a citation to a provision
is therefore a metadata problem, not a lexical one, and it is handled by
`identifiers.py` against the chunk's locator. This module only has to avoid
mangling the identifier on the way in.
"""
from __future__ import annotations

import re

#: Ordered alternation. Earlier branches win, so composite identifiers are
#: consumed whole before the generic word and number branches can split them.
TOKEN_PATTERN = re.compile(
    r"""
      (?P<paren>\d+[a-z]{0,4}(?:\([0-9a-z]{1,4}\))+)   # 3(p), 15(7), 28(9), 36a(1)
    | (?P<dotted>\d+(?:\.\d+)+)                        # 27.1, 4.16.13
    | (?P<latin>\d+(?:bis|ter|quater|quinquies|sexies))  # 31bis, 6ter
    | (?P<suffixed>\d+[a-z]{1,4})                      # 117a, 33eeb, 52a
    | (?P<ampersand>[a-z]+(?:&[a-z]+)+)                # ppv&fr, r&d
    | (?P<word>[a-z]+)
    | (?P<number>\d+)
    """,
    re.VERBOSE,
)

#: The leading number of a composite identifier is emitted alongside it, so a
#: query for `3(p)` still matches text that only ever writes the bare `3.`.
_LEADING_NUMBER = re.compile(r"^\d+")


def _fold(text: str) -> str:
    """Lowercase and neutralise the punctuation that PDF text layers scatter about.

    Hyphens and the various Unicode dashes are split points: the corpus writes
    "sub-section", "sub -section" and "sub section" in the same document, and
    splitting makes all three agree. Curly apostrophes are dropped rather than
    split, so "farmers’" and "farmers" share a token.
    """
    text = text.lower()
    text = text.replace("’", "").replace("‘", "").replace("'", "")
    return re.sub(r"[‐-―−_/\\]+", " ", text)


def tokenize(text: str) -> list[str]:
    """Tokens for indexing or querying, in order of appearance."""
    tokens: list[str] = []
    for match in TOKEN_PATTERN.finditer(_fold(text)):
        token = match.group(0)
        tokens.append(token)
        if match.lastgroup in ("paren", "dotted", "latin", "suffixed"):
            head = _LEADING_NUMBER.match(token)
            if head and head.group(0) != token:
                tokens.append(head.group(0))
    return tokens
