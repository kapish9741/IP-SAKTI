# IP-SAKTI — SIH Metrics (Single Source of Truth)

Every number on this page was measured from this repository at
`corpus_version 0c94db57932c046d`, `chunking_version 65e4770bc530156b`,
3,073 chunks indexed, 111 benchmark questions. Nothing here is estimated.
Where a metric could not be measured reliably it says so.

**Read this first.** All retrieval numbers are **evidence recall on a
corpus-derived benchmark**. They are *not* answer accuracy and *not* legal
accuracy. The golden dataset is **0/111 human-verified**.

Regenerate everything with:

```bash
.venv/bin/python scripts/evaluation/benchmark_reranking.py \
    --candidate-mode expanded --reranker features --tag phase7-operative
.venv/bin/python -m pytest -q
```

---

## 1. Knowledge Base Scale

| Metric | Value |
|---|---:|
| Source documents (PDFs ingested) | **21** |
| Corpus documents (document IDs after chunking) | **22** |
| Total pages processed | **1,782** |
| Total corpus chunks | **3,073** |
| IP / legal domains covered | **11** |
| Evaluation questions | **111** |
| Indian questions | 97 |
| International questions | 14 |
| Conceptual questions | 93 |
| Identifier-based questions | 18 |
| Distinct target chunks in the benchmark | 112 |
| Distinct target documents in the benchmark | 22 |
| Human-verified golden labels | **0 / 111** |

21 PDFs → 22 corpus documents because the 635-page Drugs & Cosmetics
compendium is chunked as two instruments (Act 1940 and Rules 1945).

Domains: biodiversity/ABS 18, patents 16, trade marks 12, copyright 12,
geographical indications 11, plant varieties 11, drug regulation 10,
designs 9, international IP 9, food safety & Ayurveda 2, IP policy 1.

Source: `data/evaluation/golden_questions.jsonl`, `data/metadata/corpus_manifest.json`,
processed corpus chunk files.

---

## 2. Retrieval Performance

Benchmark of **111 questions**. Binary relevance: a question counts as a hit at
depth *k* if any expected chunk appears in the first *k* results.

### 2.1 Headline — final ranked retrieval

| Metric | Value | Count |
|---|---:|---:|
| Recall@1 | **80.2 %** | 89 / 111 |
| Recall@3 | 91.9 % | 102 / 111 |
| Recall@5 | **96.4 %** | 107 / 111 |
| Recall@10 | 97.3 % | 108 / 111 |
| MRR (depth 10) | **0.863** | — |
| nDCG@5 | 0.884 | — |
| Missed completely (not in the candidate pool) | **0** | 0 / 111 |
| Retrieved but ranked below #1 | 22 | 22 / 111 |

### 2.2 The three stages, kept separate

| Stage | R@1 | R@3 | R@5 | R@10 | R@20 | R@50 | MRR |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Candidate retrieval** (dense ∪ BM25+identifier, before reranking) | 0.7117 | 0.9279 | 0.9459 | 0.9640 | 0.9910 | **1.0000** | 0.8182 |
| **Reranked — previous baseline** | 0.7838 | 0.9099 | 0.9459 | 0.9730 | 0.9910 | 1.0000 | 0.8520 |
| **Reranked — current pipeline** | **0.8018** | 0.9189 | **0.9640** | 0.9730 | 0.9910 | 1.0000 | **0.8628** |

Counts (of 111) for the current pipeline: 89 @1 · 96 @2 · 102 @3 · 105 @4 ·
107 @5 · 108 @10 · **111 in the candidate pool**.

Candidate Recall@20 / @50 are read from the uncensored candidate pool recorded
in the benchmark artifact. Reranked Recall@20 is **not stored** by the official
benchmark (ranked lists are truncated at 10); it was measured at **0.9910** by
replaying the cached pools, and is footnoted rather than headlined.

### 2.3 By question family

| Segment | n | Recall@1 | Recall@5 | MRR |
|---|---:|---:|---:|---:|
| Conceptual | 93 | 0.7634 | 0.9570 | 0.8363 |
| Identifier | 18 | **1.0000** | **1.0000** | **1.0000** |
| Router family IDENTIFIER (explicit Section/Rule/Article in the query) | 17 | **1.0000** | 1.0000 | 1.0000 |

**Identifier-bearing queries are already perfect.** Any further "identifier
boost" has zero measurable headroom on this benchmark.

Source: `data/evaluation/results/reranking/features.summary.json` (baseline),
`data/evaluation/results/reranking/features.phase7-operative.summary.json` (current).

---

## 3. Top-5 → Top-1 Failure Cohort

Questions where the correct target is in the **Top 5 but not rank 1**.

| | Baseline | Current |
|---|---:|---:|
| Cohort size | 18 | **18** |
| % of the 111-question benchmark | 16.2 % | 16.2 % |
| % of all Top-5 successes | 17.1 % (of 105) | 16.8 % (of 107) |

Rank distribution of the correct target within the cohort:

| Rank | Baseline | Current |
|---|---:|---:|
| 2 | 9 | 7 |
| 3 | 5 | 6 |
| 4 | 3 | 3 |
| 5 | 1 | 2 |

### Measured failure types (baseline cohort, 18 questions)

| Failure type | Count | % of cohort | Example question IDs |
|---|---:|---:|---|
| Neighbouring provision, same instrument | 10 | 56 % | Q094, Q056, Q050, Q037, Q045 |
| Cross-instrument — Act ranked over its own Rules | 5 | 28 % | Q012, Q014, Q076, Q077, Q079 |
| Cross-instrument — genuine legal boundary | 1 | 6 % | Q040 (Copyright s.15 vs Designs Act s.4) |
| Heading / front-matter / preamble outranking a provision | 2 | 11 % | Q029, Q105 |
| Identifier resolution failure | **0** | 0 % | — |
| Candidate-generation failure | **0** | 0 % | — |
| Reranker near-tie (score gap < 0.02) | 2 | 11 % | Q088 (0.0018), Q029 (0.0043) |
| Chunk-granularity / label-granularity | 1 | 6 % | Q099 (two chunks share one locator string) |

The near-tie and granularity rows overlap the rows above; they are diagnostic
overlays, not a separate partition.

**The decisive statistic:** in **17 of 18** cohort failures the incorrect
rank-1 chunk was retrieved by **both** the dense and the lexical arm. The two
retrievers independently prefer the same wrong provision. This rules out hybrid
score miscalibration and points at semantic disambiguation between adjacent
legal provisions.

Four questions remain outside the Top 5 entirely: Q066 (pool rank 5), Q093
(32), Q098 (18), Q109 (14) — all ranking failures, none a retrieval failure.

---

## 4. Improvement Implemented

**Change:** a bounded, deterministic demotion of non-operative chunks
(`front_matter`, `heading`, `preamble`) read from the chunker's existing
`unit_type`, applied *after* the weighted sum so the declared feature weights
and the ordering among operative candidates are unchanged. It is a demotion,
never a filter — every chunk stays retrievable. `structural_penalty=0.0`
restores the previous behaviour exactly.

**Rationale, stated before the numbers:** a title page, a chapter heading and a
preamble carry no operative rule, so none can be the provision an answer must
cite. 0 of 111 golden targets is a non-operative chunk; 6 of 24 rank-1 failures
had one at rank 1.

| Variant | Recall@1 | Recall@5 | Recall@10 | MRR | vs baseline |
|---|---:|---:|---:|---:|---|
| Baseline (penalty 0.00) | 0.7838 | 0.9459 | 0.9730 | 0.8520 | — |
| penalty 0.15 | 0.8018 | 0.9550 | 0.9730 | 0.8618 | +1.8 / +0.9 pp |
| **penalty 0.25 — shipped** | **0.8018** | **0.9640** | **0.9730** | **0.8628** | **+1.8 / +1.8 pp, MRR +0.011** |
| penalty ≥ 0.50 (saturated) | 0.8108 | 0.9640 | 0.9730 | 0.8690 | rejected — see below |

4 questions improved (Q029, Q105 to rank 1; Q062, Q107 into the Top 5),
**0 worsened**, 107 unchanged. Reranking latency unchanged (17.46 → 17.60 ms
median). Candidate Recall@50 unchanged at 1.000.

**Why 0.50 was rejected despite scoring higher:** beyond 0.5 the penalty exceeds
the relevance range and becomes a categorical exclusion — a question genuinely
*about* a preamble could never surface one. 0.25 is the largest bounded nudge.

**Known regression, disclosed:** `document_recall@1` falls 0.9459 → 0.9369
(one question, Q109). Q109's old rank-1 was its own document's front matter —
right document, useless evidence. Its true target is outside the Top 5 both
before and after, so no usable evidence was lost.

**Known trade-off, disclosed:** reranking *lowers* Recall@3 relative to raw
candidate order (0.9279 → 0.9189). The reranker trades Recall@3 for Recall@1.
Do not present Recall@3.

---

## 5. Pipeline Architecture

| Stage | Technology / Method |
|---|---|
| API | Python stdlib `ThreadingHTTPServer` (`app/server.py`) — `POST /api/ask`, `GET /api/health` |
| Dense retrieval | `BAAI/bge-m3`, 1024-dim, normalized embeddings, 3,073 vectors, top-50 |
| Sparse retrieval | BM25 (k1 = 1.2, b = 0.75), 18,699-term vocabulary, top-50 |
| Identifier retrieval | `BM25IdentifierBoostRetriever` — deterministic Section/Rule/Article/Clause parsing + 70 document aliases, boost scaled to the query's max BM25 score |
| Candidate fusion | Union of dense and lexical lists, interleaved order, deduplicated by `chunk_id` (first appearance wins); ~77 candidates per query |
| Reranking | `FeatureReranker` — 7 declared, untrained features (dense/lexical percentile, locator exactness, locator referenced, document match, IDF coverage, phrase overlap), min-max normalised within the pool; authority on a separate axis (λ = 0.05); operative-text demotion 0.25 |
| Evidence selection | Top 5 passages (`app.pipeline.TOP_K = 5`) |
| Answer generation | Groq · `openai/gpt-oss-120b`, temperature 0, **no retry** |
| Citation validation | Deterministic validator (`ai/answering/citation_validator.py`) |
| Grounding | Deterministic grounding check (`ai/answering/grounding.py`) |
| Abstention | Deterministic policy (`ai/answering/policy.py`) |

Reranker weights were **declared a priori** from the Phase 5 per-family tables,
not fitted to the golden questions. Leakage audit: 111/111 clean.

---

## 6. Answer Safety

Measured on the demo rehearsal of record (`scripts/demo/verify.py`, 6 scenarios).

| Metric / Capability | Value |
|---|---|
| Live answers successfully published | **5** |
| Safe abstentions | 1 |
| Errors / provider failures | **0** |
| Grounding pass rate among published answers | 5 / 5 |
| Citation validation pass rate among published answers | 5 / 5 |
| Citations issued | 6 |
| Citation validation | enabled |
| Grounding validation | enabled |
| Safe abstention | enabled |
| Provider-unavailable state | enabled, distinct from abstention |
| Citations linked to source passages | enabled |
| Stale source warnings | enabled |
| Weak provenance (evidence level) warnings | enabled |

**Run-to-run variability, disclosed.** An earlier run of the same six scenarios
returned 3 answered / 3 abstained: two scenarios came back `provider_abstained`,
i.e. the model itself declined. The out-of-corpus question abstained in **every**
run with `no_relevant_evidence` + `no_citable_authority`. Answer-layer behaviour
is not deterministic even at temperature 0; retrieval is.

Offline citation-integrity suite (7 fixture questions, extractive provider —
**not comparable to the live path**): citation validity 0.80, unsupported claim
rate 0.00, source resolution 1.00.

---

## 7. Latency

Local retrieval and LLM generation are reported separately and never averaged
together.

### 7.1 Local retrieval and reranking — 111 questions, no LLM

| Stage | Median | Mean | p95 |
|---|---:|---:|---:|
| Candidate generation (dense + BM25 + fusion) | 32.9 ms | 37.1 ms | 45.8 ms |
| Reranking | 17.6 ms | 20.7 ms | 26.3 ms |
| **Retrieval + reranking total** | **51.5 ms** | 57.8 ms | 80.5 ms |

### 7.2 End-to-end HTTP — pooled warm demo requests (n = 16, 3 runs)

| Stage | Median | Mean | Max |
|---|---:|---:|---:|
| Retrieval | 291 ms | 361 ms | 982 ms |
| Reranking | 24.8 ms | 25.8 ms | 37.0 ms |
| Answer generation *(includes citation validation + grounding)* | 974 ms | 791 ms | 1,775 ms |
| **End-to-end total** | **1,317 ms** | 1,179 ms | 2,108 ms |
| End-to-end, published answers only (n = 10) | 1,764 ms | 1,719 ms | 2,108 ms |

### 7.3 Startup

| Metric | Value |
|---|---|
| Server startup | 11.8 s and 13.4 s (n = 2) |
| — of which BGE-M3 warm-up | 11.1 s and 12.7 s |
| First query after startup | **10.2 s** (9.5 s of it cold dense retrieval) |

**Warm the server with one throwaway question before the demo.** The cold first
request is excluded from every median above and disclosed here instead.

### 7.4 Not measured

| Metric | Status |
|---|---|
| Dense retrieval latency alone | **NOT MEASURED** — not separately instrumented |
| BM25 latency alone (in the live API) | **NOT MEASURED** |
| Fusion / merge latency | **NOT MEASURED** |
| Query validation latency | **NOT MEASURED** |
| Citation validation latency alone | **NOT MEASURED** — runs inside the answering bucket |
| Grounding validation latency alone | **NOT MEASURED** — runs inside the answering bucket |

The live pipeline emits exactly four timing buckets: `retrieval`, `reranking`,
`answering`, `total`.

---

## 8. Demo Coverage

Validated scenarios in `scripts/demo/verify.py`:

| # | Scenario | Domain | Result |
|---|---|---|---|
| 1 | Signing an application for registration | Trade Marks | ANSWERED |
| 2 | Patentability of a new form of a known substance | Patents | ANSWERED |
| 3 | Duration and renewal of registration | Trade Marks | ANSWERED |
| 4 | Term of copyright in a literary work | Copyright | ANSWERED |
| 5 | Who may apply for registration | Geographical Indications | ANSWERED |
| 6 | Out-of-domain question | — | **ABSTAINED** (safe) |

**5 answered · 1 abstained · 0 errors** — measured, most recent complete run.
See §6 for run-to-run variability.

---

## 9. What We Can Safely Claim

- Evaluated on **111 benchmark questions** across **11 IP and legal domains**.
- Corpus of **3,073 chunks** from **21 source documents / 1,782 pages** covering
  **22 legal instruments**.
- Hybrid legal retrieval combining **dense (BGE-M3)**, **sparse (BM25)** and
  **identifier-aware** signals, followed by a deterministic reranking stage.
- **Recall@1 = 80.2 %** and **Recall@5 = 96.4 %** on the current retrieval benchmark.
- Retrieves the correct evidence in the Top 5 for **107 of 111** benchmark questions.
- The correct evidence reaches the candidate pool for **111 of 111** questions —
  **candidate recall is 100 %**.
- **100 % Recall@1 on identifier-based questions** (18 / 18).
- **Citation validation and grounding checks run before any answer is published.**
- **Safe abstention** when evidence is insufficient — the out-of-corpus question
  abstained in every rehearsal run.
- Source-level **provenance, temporal status and evidence-level indicators**, with
  stale-source and weak-provenance cautions surfaced to the user.
- Retrieval + reranking in **~52 ms**; end-to-end median **~1.3 s**.
- End-to-end **API-ready architecture** with a documented response contract and
  a distinct `UNAVAILABLE` state for provider failures.
- **706 automated tests passing.**

## 10. What We Must Not Claim

- ❌ "Human-verified legal accuracy" — the golden dataset is **0/111** human-verified.
- ❌ "Production ready" — this is a prototype.
- ❌ "100 % correct" or "100 % accurate answers".
- ❌ Legal advice, or fitness for legal decision-making.
- ❌ Calling Recall "accuracy". Recall@1 is not accuracy.
- ❌ Answer accuracy, legal correctness, or any measure of whether the generated
  text is legally right — **that has not been measured**.
- ❌ Recall@3 as a strength (reranking lowers it relative to raw candidate order).
- ❌ Any latency average that mixes local retrieval with LLM generation, or that
  includes the cold first request.
- ❌ Any number not present on this page.

---

## 11. Verdict

| Field | Value |
|---|---|
| Recall@1 | 80.2 % (89/111) |
| Recall@5 | 96.4 % (107/111) |
| Recall@1 → Recall@5 gap | 16.2 pp (18 questions) |
| Is the correct evidence already retrieved? | **YES** — 111/111 in the candidate pool |
| Retrieval problem or ranking problem? | **RANKING** — 0 candidate-generation failures |
| Primary cause of the gap | Neighbouring provisions of the same instrument (10/18) and Act-vs-Rules confusion (5/18); in 17/18 cases both retrievers agree on the wrong provision |
| Improvement implemented | Bounded operative-text demotion (0.25) |
| Result | Recall@1 0.7838 → **0.8018**, Recall@5 0.9459 → **0.9640**, MRR 0.8520 → **0.8628**, 4 improved / 0 worsened |
| Risk | Low — deterministic, reversible (`structural_penalty=0.0`), no latency cost, 706 tests green |
| Prototype status | **READY WITH LIMITATION** — ground truth is not human-verified and answer correctness is unmeasured |
