# IP-SAKTI — Web Application & Frontend Architecture Reference (`web.md`)

> **Project Reference Document**  
> Companion to `PROJECT.md`, `README.md`, and `IP-SAKTI Frontend and API Integration Brief.md`.  
> Built for the SIH (Smart India Hackathon) prototype of **IP-SAKTI — Citation-Grounded Legal AI**.

---

## 1. Executive Summary & Design Vision

IP-SAKTI is an evidence-first, citation-grounded Intellectual Property legal assistant for Indian statutory law. Unlike generic LLM chat interfaces that hallucinate legal advice, IP-SAKTI adheres to **"Grounded or Silent"**: every claim sentence must tie directly to verified statutory evidence, or the system abstains.

The web application reflects this philosophy visually through:
* **Structured, Boxed Wireframe Hierarchy**: As outlined in the reference design, the UI uses distinct modular containers (Header → Query Input → Answer Card → Sources & Evidence Viewer).
* **Refined Neutral Color Theme**: A sleek, focused dark neutral palette (matte charcoal, graphite, subtle slate borders, and crisp off-white typography) that commands legal authority and eliminates distractions.
* **First-Class Evidence Provenance**: Citations (`[1]`, `[2]`) are prominent interactive badges. Clicking or toggling `View Evidence ▼` reveals the underlying statutory chunk, locator, page, temporal status, and publisher evidence level.

---

## 2. Visual Layout & UI Structure (From User Wireframe)

```text
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                            IP-SAKTI                              │
│                Grounded Intellectual Property AI                 │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Ask your IP legal question                                      │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ How is an application for trademark registration filed?    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│                       [ Ask IP-SAKTI ]                           │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ANSWER                                                          │
│                                                                  │
│  An application for the registration of a trademark must be made │
│  in Form TM-A and signed by the applicant or his agent [1].      │
│                                                                  │
│  Confidence: Moderate                                            │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SOURCES                                                         │
│                                                                  │
│  [1] Trade Marks Rules, 2017                                     │
│      Rule 23 · Page 59 · CURRENT · Level B                       │
│      ▾ View Evidence                                             │
│      ┌────────────────────────────────────────────────────────┐  │
│      │ "An application for the registration of a trademark    │  │
│      │  shall be made in Form TM-A and signed by the          │  │
│      │  applicant or his agent."                              │  │
│      └────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Design System & Neutral Color Theme

The interface utilizes a tailored **neutral dark legal palette** designed for clarity and legibility during SIH live demonstrations.

### 3.1 Color Tokens
| Token | Hex | Usage |
|---|---|---|
| `--bg-app` | `#0f1115` | Deep matte charcoal application canvas |
| `--bg-card` | `#16191f` | Section container / card surface |
| `--bg-card-hover` | `#1c212a` | Card hover / active interactive state |
| `--border-subtle` | `#2a2f3b` | Structural borders, wireframe box outlines |
| `--border-focus` | `#4b5563` | Input focus outline and active accents |
| `--text-primary` | `#f3f4f6` | High-contrast headings and legal prose |
| `--text-secondary`| `#9ca3af` | Labels, locators, sub-headers, meta-info |
| `--text-muted` | `#6b7280` | Disclaimers, footer notes, disabled states |
| `--badge-citation`| `#243049` | Background for `[n]` citation markers |
| `--badge-text` | `#93c5fd` | Soft accent blue for citation markers |
| `--status-answer` | `#10b981` | Emerald badge for `ANSWERED` |
| `--status-abstain`| `#f59e0b` | Amber badge for `ABSTAINED` |
| `--status-error` | `#ef4444` | Red indicator for request validation failures |
| `--caution-bg` | `#261e12` | Muted warm banner for STALE / conflict cautions |
| `--caution-border`| `#b45309` | Caution border |

### 3.2 Typography & Aesthetics
* **Font Family**: Modern clean sans-serif (`Inter`, `system-ui`) for UI and legal prose, paired with crisp monospace (`JetBrains Mono`, `ui-monospace`) for citation markers, locators, and evidence chunks.
* **Layout Geometry**: Square to subtle 6px-rounded box contours reflecting technical and legal precision.
* **Micro-interactions**:
  * Smooth 150ms hover transitions on action buttons and collapsible headers.
  * Instant highlight link between in-text citation marker `[1]` and corresponding card in `SOURCES`.
  * Accordion transition for `View Evidence ▼`.

---

## 4. End-to-End System Architecture

```text
┌────────────────────────────────────────────────────────┐
│                   Web Frontend (UI)                    │
│   Question Input · Answer Display · Evidence Accordion │
└──────────────────────────┬─────────────────────────────┘
                           │ POST /api/ask { question }
                           ▼
┌────────────────────────────────────────────────────────┐
│               Flask API Service (Thin Layer)           │
│   routes/ask.py · Input Validation · CORS · /health    │
└──────────────────────────┬─────────────────────────────┘
                           │ normalized query
                           ▼
┌────────────────────────────────────────────────────────┐
│            IP-SAKTI Pipeline Orchestrator              │
│   Router → Candidate Retrieval → Reranking             │
│   → Evidence Policy → Answer Generation                │
│   → Citation Validation → Grounding Gate               │
└──────────────────────────┬─────────────────────────────┘
                           │ Answer Object (models.Answer)
                           ▼
┌────────────────────────────────────────────────────────┐
│          API Response Adapter (Normalizer)             │
│   Transforms raw internal Answer → Clean JSON Contract │
└──────────────────────────┬─────────────────────────────┘
                           │ Normalized JSON Response
                           ▼
┌────────────────────────────────────────────────────────┐
│             Frontend Visual State Render               │
│   [ANSWERED] or [ABSTAINED] or [ERROR]                 │
└────────────────────────────────────────────────────────┘
```

---

## 5. API Contracts & Normalized Schemas

### 5.1 Primary Endpoint: `POST /api/ask`
* **Request Body**:
  ```json
  {
    "question": "How is an application for trademark registration filed?"
  }
  ```

* **Validation Rules**:
  * Reject non-strings, blank queries, or inputs exceeding 1,000 characters.
  * Return `400 Bad Request` with `{ "success": false, "status": "invalid_request", "message": "Please provide a valid legal question." }`.

### 5.2 Success Response — `status: "answered"`
```json
{
  "success": true,
  "status": "answered",
  "question": "How is an application for trademark registration filed?",
  "answer": {
    "text": "An application for the registration of a trademark must be made in Form TM-A and signed by the applicant or his agent [1].",
    "confidence": "MODERATE"
  },
  "citations": [
    {
      "id": 1,
      "marker": "[1]",
      "document": "Trade Marks Rules, 2017",
      "locator": "Rule 23",
      "page": 59,
      "source_status": "CURRENT",
      "provenance_level": "B",
      "evidence_text": "An application for the registration of a trademark shall be made in Form TM-A and signed by the applicant or his agent."
    }
  ],
  "cautions": [],
  "meta": {
    "answer_status": "PUBLISHED",
    "provider": "extractive_mock",
    "fingerprint": "a4b1c8f902e3"
  }
}
```

### 5.3 Safe Abstention Response — `status: "abstained"`
```json
{
  "success": true,
  "status": "abstained",
  "question": "What is the penalty for unauthorized lunar mining under Indian patent law?",
  "answer": {
    "text": "I couldn't produce a sufficiently supported answer from the available legal evidence.",
    "confidence": null
  },
  "citations": [],
  "cautions": [
    "The available evidence was insufficient to publish a grounded answer."
  ],
  "meta": {
    "answer_status": "ABSTAINED",
    "abstention_reasons": [
      "no_relevant_evidence: no passage shared content terms with query"
    ]
  }
}
```

### 5.4 Caution Response (Stale Law / Divergent Versions)
When the evidence policy admits stale law or identifies conflicts:
```json
{
  "cautions": [
    "⚠ Source Notice: The cited source (Drugs and Cosmetics Rules, 1945) is marked STALE. Verify against current gazette notifications.",
    "Confidence reduced to LOW due to archival evidence vintage."
  ]
}
```

---

## 6. Frontend Core States & User Journey

### State 1: Idle
* Display branding, the clean boxed query input, and quick-try sample question chips:
  * *"How is an application for trademark registration filed?"* (TM Rules 2017, Rule 23)
  * *"What is excluded from patentability under Section 3(p)?"* (Patents Act 1970, Section 3)
  * *"What approvals are required from the NBA for biological resource export?"* (BD Act 2002)

### State 2: Loading & Progress
* Button displays loading indicator: `Analyzing legal evidence...`
* Subtle animated pulse on the search box.
* Subtext indicates: *"Checking statutory corpus, verifying citations, and validating grounding..."*

### State 3: Answered
* Render `ANSWER` block with verified prose.
* In-text `[1]`, `[2]` citation markers are highlighted interactive tags.
* Render `Confidence: High | Moderate | Low`.
* Render `SOURCES` list with document title, locator, page, and `View Evidence ▼` collapsible drawer showing the raw excerpt.
* If cautions exist, render the amber `⚠ Notice` banner above sources.

### State 4: Abstained (Valid Safety State)
* Prominently display:
  > *"I couldn't produce a sufficiently supported answer from the available legal evidence."*
* Render a transparent explanation block: **"Why did IP-SAKTI abstain?"**
  * Explains that no statutory chunk in the corpus passed citation validation or grounding threshold.
  * This is highlighted as an anti-hallucination legal safety feature, not an error.

### State 5: System Disclaimer
* Persistent single-line footer disclaimer:
  > *"IP-SAKTI is an information and research tool grounded in published statutory texts. It does not provide legal advice."*

---

## 7. Project Implementation File Map

```text
IP-SAKTI/
├── web.md                                      # This reference document
├── IP-SAKTI Frontend and API Integration Brief.md # Original integration brief
│
├── backend/                                    # Flask API application
│   ├── app.py                                  # Flask entry point & CORS
│   ├── routes/
│   │   ├── ask.py                              # POST /api/ask & GET /health
│   │   └── debug.py                            # Optional dev inspection endpoint
│   ├── services/
│   │   └── pipeline_service.py                 # Thin wrapper calling ai/answering & ai/retrieval
│   └── schemas/
│       └── normalizer.py                       # models.Answer -> public normalized JSON adapter
│
└── frontend/                                   # Vite + React (or Vanilla Web Component) UI
    ├── index.html
    ├── src/
    │   ├── App.jsx                             # Main frame container
    │   ├── index.css                           # Neutral dark design system
    │   ├── components/
    │   │   ├── Header.jsx                      # IP-SAKTI title & subtitle
    │   │   ├── QuestionInput.jsx               # Query input & sample chips
    │   │   ├── AnswerCard.jsx                  # Answer prose & confidence
    │   │   ├── CautionBanner.jsx               # Stale / provenance cautions
    │   │   ├── SourcesList.jsx                 # Citations & Evidence viewer
    │   │   ├── AbstentionCard.jsx              # "Why abstained" explanation
    │   │   └── Disclaimer.jsx                  # Static system disclaimer
    │   └── services/
    │       └── api.js                          # Fetch wrapper for /api/ask
```

---

## 8. Verification & Demonstration Checklist (SIH Demo)

1. **Test 1: Standard Grounded Answer**
   * Query: *"How is an application for trademark registration filed?"*
   * Result: Answer generated, `[1]` citation rendered, `View Evidence ▼` expands Rule 23 of Trade Marks Rules 2017.
2. **Test 2: Multi-Domain Grounded Answer**
   * Query: *"What are the exclusions under Section 3(p) of the Patents Act?"*
   * Result: Grounded citation to Patents Act 1970, Section 3.
3. **Test 3: Provable Safe Abstention**
   * Query: Unrelated question or hallucination trap (e.g. *"What is the copyright term for martian rover photos under Indian law?"*).
   * Result: Immediate abstention, `insufficient_evidence: true`, reason explained.
4. **Test 4: Stale Evidence Caution**
   * Query: Question on Drugs & Cosmetics Rules 1945.
   * Result: Answer provided, caution badge indicating STALE status, confidence lowered to `LOW`.
