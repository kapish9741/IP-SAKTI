"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Clock,
  Shield,
  Search,
} from "lucide-react";

// Production (Vercel): NEXT_PUBLIC_API_URL="" → uses relative /api/... path → Next.js proxy → Render
// Local dev: falls back to Express gateway on :5001
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";


const SAMPLES = [
  "How must an application for registration of a trade mark be signed?",
  "Is the mere discovery of a new form of a known substance patentable in India?",
  "What is the duration of the registration of a trade mark and when must it be renewed?",
  "What is the term of copyright in a literary work published in the lifetime of the author?",
  "Who may apply for the registration of a geographical indication?",
  "What is the best pizza topping in Naples?",
];

const STEPS = [
  "Retrieving evidence",
  "Reranking",
  "Generating grounded answer",
  "Validating citations",
  "Checking grounding",
];

export default function Home() {
  const [question, setQuestion] = useState(SAMPLES[0]);
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [health, setHealth] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [expandedSources, setExpandedSources] = useState({});
  const [showUncitedCandidates, setShowUncitedCandidates] = useState(false);
  const [flashTarget, setFlashTarget] = useState(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(null);
  const [rateLimitQuery, setRateLimitQuery] = useState(null);

  const stepTimerRef = useRef(null);
  const rateLimitTimerRef = useRef(null);

  // Health only. Asking a question on mount spent a provider completion on
  // every page load and every refresh — before anyone had clicked anything —
  // which is a real cost against a free-tier per-minute cap and is not a
  // decision a page load should be making. The input is prefilled with
  // SAMPLES[0], so the first question is still one click away.
  useEffect(() => {
    fetchHealth();

    return () => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    };
  }, []);

  const fetchHealth = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch (err) {
      console.warn("Health check failed:", err);
    }
  };

  const startStepAnimation = () => {
    setActiveStep(0);
    let step = 0;
    if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    stepTimerRef.current = setInterval(() => {
      step = Math.min(step + 1, STEPS.length - 1);
      setActiveStep(step);
    }, 850);
  };

  const stopStepAnimation = () => {
    if (stepTimerRef.current) clearInterval(stepTimerRef.current);
  };

  // Counts down the provider's per-minute window and then stops. It does NOT
  // re-send: the backend issues one request per question and never retries, and
  // a UI that quietly fired a second one would both contradict that design and
  // spend more of the token budget that was just exhausted. Retrying is the
  // user's decision, taken with the button below.
  const startRateLimitCountdown = (q, seconds = 62) => {
    if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
    setRateLimitCountdown(seconds);
    setRateLimitQuery(q);
    let remaining = seconds;
    rateLimitTimerRef.current = setInterval(() => {
      remaining -= 1;
      setRateLimitCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(rateLimitTimerRef.current);
        setRateLimitCountdown(0);
      }
    }, 1000);
  };

  const cancelRateLimit = () => {
    if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
    setRateLimitCountdown(null);
    setRateLimitQuery(null);
  };

  // Phase E. `clarified` is the whole loop guard: the backend asks at most one
  // clarifying question, and only when the query names no regime, instrument or
  // provision. Whatever the user sends next goes through the full pipeline,
  // because this flag rides with it. A second clarification is therefore not
  // something the UI declines to show — it is something the backend never asks.
  const handleAsk = async (queryText, opts = {}) => {
    const q = (queryText !== undefined ? queryText : question).trim();
    if (!q) return;
    const clarified = opts.clarified === true;

    // Cancel any pending rate-limit retry
    cancelRateLimit();

    setLoading(true);
    setError(null);
    setResult(null);
    setExpandedSources({});
    setShowUncitedCandidates(false);
    startStepAnimation();

    try {
      const res = await fetch(`${API_BASE_URL}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, clarified }),
      });

      const data = await res.json();
      if (!res.ok && data.status === "invalid_request") {
        setError(data.message || "Invalid question.");
      } else {
        setResult(data);
        // If rate limited, auto-schedule retry
        if (data.status === "UNAVAILABLE" && data.service_failure?.code === "rate_limited") {
          startRateLimitCountdown(q);
        }
        // Default expand the first cited source if available
        if (data.evidence && data.evidence.length > 0) {
          const firstCited = data.evidence.find((e) => e.cited);
          if (firstCited) {
            setExpandedSources({ [firstCited.marker]: true });
          } else {
            setExpandedSources({});
          }
        }
      }
    } catch (err) {
      console.error("API call error:", err);
      setError("Could not reach the IP-SAKTI server. Is it running?");
    } finally {
      stopStepAnimation();
      setLoading(false);
    }
  };

  const handleCitationClick = (markerNum) => {
    const element = document.getElementById(`src-${markerNum}`);
    if (element) {
      // Auto expand evidence text
      setExpandedSources((prev) => ({ ...prev, [markerNum]: true }));
      // Scroll into view
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      // Trigger flash animation
      setFlashTarget(markerNum);
      setTimeout(() => setFlashTarget(null), 1500);
    }
  };

  const toggleSourceExpand = (markerNum) => {
    setExpandedSources((prev) => ({
      ...prev,
      [markerNum]: !prev[markerNum],
    }));
  };

  // Render prose with clickable [n] citation buttons
  const renderGroundedProse = (rawText) => {
    if (!rawText) return null;
    const parts = rawText.split(/(\[\d+\])/g);
    return parts.map((part, idx) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const markerNum = parseInt(match[1], 10);
        return (
          <button
            key={idx}
            type="button"
            onClick={() => handleCitationClick(markerNum)}
            className="inline-flex items-center justify-center font-mono font-bold text-xs bg-blue-950/80 text-blue-300 hover:bg-blue-900 border border-blue-600/40 px-1.5 py-0.2 mx-1 rounded-sm cursor-pointer transition-all hover:scale-105 active:scale-95"
            title={`Go to source [${markerNum}]`}
          >
            {match[1]}
          </button>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  // Calculate cited vs uncited evidence
  const evidenceList = result?.evidence || [];
  const citedEvidence = evidenceList.filter((e) => e.cited);
  const uncitedEvidence = evidenceList.filter((e) => !e.cited);

  const answerObj = result?.answer || {};
  // A greeting. Not an answer, not an abstention, not a clarification: the
  // corpus was never consulted, so none of those words describe what happened.
  // Decided deterministically in app/intent.py before retrieval runs.
  const isSocial = result?.status === "SOCIAL";
  const needsClarification = result?.status === "NEEDS_CLARIFICATION";
  // A clarification is not an abstention: nothing was retrieved and no evidence
  // was weighed, so it must not be rendered as "the evidence did not support an
  // answer" — and must not fall through to the ANSWERED branch either.
  const isAbstained =
    !needsClarification &&
    !isSocial &&
    (result?.status === "ABSTAINED" || answerObj?.insufficient_evidence);
  const isUnavailable = result?.status === "UNAVAILABLE";
  const clarification = result?.clarification;
  const confidence = answerObj?.confidence;
  // The two axes behind that one word, and the factors that set each. Without
  // these the badge said "LOW" and stopped, which was the whole complaint: on
  // the 60-question sample, 13 of the 15 LOW answers were LOW because every
  // instrument they cited has been amended since our consolidation — a fact
  // about the source, not about the answer, and one the reader can act on only
  // if they are told it. See ai/answering/confidence.py.
  const confidenceReport = answerObj?.confidence_report;
  const confidenceFactors = confidenceReport?.factors || [];

  const confColor =
    confidence === "HIGH"
      ? "text-emerald-400 border-emerald-800/60 bg-emerald-950/30"
      : confidence === "LOW"
      ? "text-amber-400 border-amber-800/60 bg-amber-950/30"
      : "text-blue-300 border-blue-800/60 bg-blue-950/30";

  // Extraction damage is reported per excerpt by ai/text_integrity.py. The
  // chunk-level verdict on e.text_integrity is deliberately not used here: a
  // chunk can be damaged three pages away from the sentence being shown, and
  // warning about text the reader cannot see is noise.
  const excerptDamaged = (e) =>
    e?.excerpt?.integrity?.status === "EXTRACTION_DAMAGED";

  // One line saying why this card is under the answer. Composed from fields the
  // backend already decided; it states nothing the pipeline did not determine.
  const sourceExplanation = (e) => {
    const parts = [];
    parts.push(
      e.cited
        ? "The answer cites this passage."
        : "Retrieved as context; the answer does not cite it."
    );
    if (e.excerpt?.strategy === "window") {
      parts.push(
        "No sentence boundary was available here, so a window around the best match is shown."
      );
    }
    if (e.temporal_status && e.temporal_status !== "CURRENT") {
      parts.push(
        "This instrument has been amended since the consolidation held here."
      );
    }
    return parts.join(" ");
  };

  const renderSourceCard = (e) => {
    const isExpanded = !!expandedSources[e.marker];
    const isFlashing = flashTarget === e.marker;
    const isStale = e.temporal_status !== "CURRENT";

    return (
      <div
        key={e.marker}
        id={`src-${e.marker}`}
        className={`p-4 sm:p-5 transition-all ${
          isFlashing ? "flash-target" : "bg-[#0f1218] hover:bg-[#12161f]"
        }`}
      >
        <div className="flex items-start gap-3.5">
          {/* Marker Box */}
          <div
            className={`w-6 h-6 flex-shrink-0 flex items-center justify-center font-mono text-xs font-bold rounded-none ${
              e.cited
                ? "bg-blue-600 text-white"
                : "bg-zinc-700 text-zinc-300"
            }`}
          >
            {e.marker}
          </div>

          <div className="flex-grow space-y-2">
            {/* Document & Locator */}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-semibold text-sm sm:text-base text-prose">
                {e.document_name}
              </div>
              <div className="text-xs font-mono text-subtext">
                {e.locator_text || e.citation}
                {e.heading ? ` — ${e.heading}` : ""}
              </div>
            </div>

            {/* Meta Badges */}
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono uppercase">
              <span
                className={`px-1.5 py-0.5 border ${
                  e.cited
                    ? "text-emerald-400 border-emerald-800/60 bg-emerald-950/20"
                    : "text-zinc-400 border-zinc-700 bg-zinc-800/40"
                }`}
              >
                {e.cited ? "Cited" : "Retrieved"}
              </span>

              <span
                className={`px-1.5 py-0.5 border ${
                  isStale
                    ? "text-amber-400 border-amber-800/60 bg-amber-950/20"
                    : "text-emerald-400 border-emerald-800/60 bg-emerald-950/20"
                }`}
              >
                {e.temporal_status}
              </span>

              <span className="px-1.5 py-0.5 border border-wireframe text-zinc-400 bg-zinc-900">
                Provenance {e.source_evidence_level}
              </span>

              <span
                className={`px-1.5 py-0.5 border ${
                  e.citable
                    ? "border-wireframe text-zinc-300"
                    : "border-amber-800/60 text-amber-400"
                }`}
              >
                {e.citable ? "Citable" : "Not citable"}
              </span>

              {e.physical_pages && e.physical_pages.length > 0 && (
                <span className="px-1.5 py-0.5 border border-wireframe text-zinc-400">
                  p. {e.physical_pages[0]}
                  {e.physical_pages.length > 1
                    ? `–${e.physical_pages[e.physical_pages.length - 1]}`
                    : ""}
                </span>
              )}
            </div>

            {/*
              Phase F. What used to be here was a button revealing the whole
              chunk — two to three printed pages of statute, which is grounded
              and unreadable. The excerpt the backend selected is now shown by
              default, and the full passage stays one click away for anyone
              checking it in context.

              The excerpt is a verbatim substring of e.text, chosen in
              ai/answering/excerpt.py. Nothing here reformats it: no
              truncation, no ellipsis, no case folding. A "window" strategy
              means the passage had no sentence boundaries to cut on, and the
              label says so rather than implying a sentence was quoted.
            */}
            {e.excerpt?.text && (
              <div className="pt-1">
                <div className="text-[10px] font-mono uppercase tracking-wide text-zinc-500 mb-1">
                  {excerptDamaged(e)
                    ? "Source text extraction issue"
                    : e.excerpt.strategy === "window"
                    ? "Evidence window"
                    : "Exact relevant passage"}
                </div>

                {/*
                  Roughly one chunk in fifteen of this corpus did not survive
                  PDF extraction: the Drugs and Cosmetics PDF positions every
                  glyph separately, so "true copy" arrives as "t ru e c o p y",
                  and the scanned Patents Rules forms OCR their dotted fill
                  lines into "eee eee ee". ai/text_integrity.py detects that and
                  deliberately does not repair it — guessing at what a statute
                  says, inside quotation marks, is the one thing this interface
                  must never do. So the passage is still shown verbatim, and the
                  banner says the spacing is the extractor's and not the Act's.
                */}
                {excerptDamaged(e) && (
                  <div className="mb-1.5 px-2 py-1.5 border border-amber-800/60 bg-amber-950/20 text-[11px] text-amber-300 leading-relaxed">
                    This passage did not extract cleanly from the source PDF —
                    words are split or spaced wrongly. The text below is shown
                    exactly as extracted and has not been corrected or
                    reconstructed. Check the official document before relying on
                    the wording.
                  </div>
                )}

                <blockquote
                  className={`border-l-2 pl-3 py-1 bg-[#0b0e13] font-mono text-xs leading-relaxed whitespace-pre-wrap overflow-x-auto ${
                    excerptDamaged(e)
                      ? "border-amber-700/70 text-zinc-400"
                      : "border-blue-700/70 text-zinc-200"
                  }`}
                >
                  {e.excerpt.text}
                </blockquote>

                {/* Why this passage is here, in one line. */}
                <div className="mt-1 text-[11px] text-subtext leading-relaxed">
                  {sourceExplanation(e)}
                </div>
              </div>
            )}

            {/* Full passage, on request */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => toggleSourceExpand(e.marker)}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors py-1 cursor-pointer font-semibold"
              >
                <span>
                  {isExpanded ? "▾ Hide full passage" : "▸ View full passage"}
                  {e.excerpt?.truncated ? "" : ""}
                </span>
              </button>

              {isExpanded && (
                <div className="mt-2 p-3 bg-[#080a0d] border border-wireframe font-mono text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap selection:bg-zinc-800 overflow-x-auto">
                  {e.text}
                  <div className="mt-2 text-[11px] text-zinc-500 border-t border-zinc-800/80 pt-1.5">
                    chunk <code>{e.chunk_id}</code>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-canvas text-prose flex flex-col justify-between">
      {/* 1. Header Box */}
      <header className="border-b border-wireframe bg-card">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-prose font-mono">
              IP<span className="text-blue-500">-</span>SAKTI
            </h1>
            <span className="text-xs sm:text-sm text-subtext font-sans">
              Grounded Intellectual Property legal assistant
            </span>
          </div>

          {/* Health Status Dot */}
          <div className="flex items-center gap-2 text-xs font-mono text-muted">
            <span
              className={`w-2 h-2 rounded-full ${
                health?.status === "ok" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" : "bg-zinc-600"
              }`}
            />
            <span>
              {health?.corpus?.chunks
                ? `${health.corpus.chunks} chunks · ${health.corpus.documents} documents · ${health.answering?.provider || "ready"}`
                : "connecting..."}
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6 flex-grow">
        {/* Lede Note */}
        <p className="text-xs sm:text-sm text-subtext leading-relaxed border-l-2 border-wireframe-bright pl-3">
          Evidence-first. IP-SAKTI retrieves provisions from a fixed corpus of Indian IP statutes, rules and
          treaties, and{" "}
          <strong className="text-prose font-semibold">
            publishes an answer only if it survives citation and grounding validation
          </strong>{" "}
          against that evidence. When it cannot, it abstains instead of guessing.
        </p>

        {/* 2. Question Form Box */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk(question);
          }}
          className="wireframe-box p-5 space-y-4 rounded-none"
        >
          <label htmlFor="question-input" className="block text-xs font-mono uppercase tracking-wider text-prose font-semibold">
            Ask an intellectual-property legal question
          </label>

          <textarea
            id="question-input"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAsk(question);
              }
            }}
            placeholder="e.g. How must an application for registration of a trade mark be signed?"
            disabled={loading}
            className="w-full bg-[#0a0c10] border border-wireframe rounded-none px-3.5 py-2.5 text-sm text-prose placeholder:text-muted focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-sans resize-vertical"
          />

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="px-6 py-2 bg-[#1c2436] hover:bg-[#25314a] text-prose font-mono text-xs uppercase tracking-wider border border-wireframe-bright hover:border-blue-500/80 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              Ask IP-SAKTI
            </button>

            <span className="text-[11px] font-mono text-muted">
              Patents · Trade marks · Copyright · Designs · GI · Biodiversity
            </span>
          </div>
        </form>

        {/* 3. Try One Sample Chips */}
        <div className="space-y-2">
          <div className="text-[11px] font-mono text-muted uppercase tracking-wider font-semibold">
            Try one
          </div>
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setQuestion(s);
                  handleAsk(s);
                }}
                disabled={loading}
                className="text-xs font-sans px-3 py-1.5 bg-[#141720] hover:bg-[#1c212e] text-subtext hover:text-prose border border-wireframe/80 rounded-none transition-colors text-left"
                title={s}
              >
                {s.length > 64 ? s.slice(0, 62) + "…" : s}
              </button>
            ))}
          </div>
        </div>

        {/* 4. Multi-Step Loading Bar */}
        {loading && (
          <div className="wireframe-box p-5 space-y-3">
            <div className="h-[3px] w-full bg-wireframe overflow-hidden">
              <div className="h-full w-[35%] bg-blue-500 animate-slide-bar" />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {STEPS.map((stepName, sIdx) => {
                const isCurrent = activeStep === sIdx;
                const isDone = activeStep > sIdx;
                return (
                  <span
                    key={sIdx}
                    className={`text-xs font-mono px-2.5 py-1 border transition-all ${
                      isCurrent
                        ? "bg-blue-950/60 border-blue-500 text-blue-300 font-semibold"
                        : isDone
                        ? "bg-[#141822] border-wireframe text-zinc-400"
                        : "bg-transparent border-transparent text-zinc-600"
                    }`}
                  >
                    {stepName}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Error Notification */}
        {error && (
          <div className="p-4 bg-red-950/40 border border-red-900/80 text-red-300 text-xs font-mono">
            {error}
          </div>
        )}

        {/* 5. Result States */}
        {result && (
          <div className="space-y-6">
            {/* A0. SOCIAL — a greeting, answered as one and labelled as one. */}
            {isSocial && (
              <div className="border border-wireframe bg-card p-5 sm:p-6">
                <div className="text-[10px] font-mono uppercase tracking-wide text-subtext mb-2">
                  Conversational reply — no legal retrieval performed
                </div>
                <p className="text-prose leading-relaxed">{result.rendered}</p>
                <p className="mt-3 text-xs text-subtext leading-relaxed">
                  Nothing was retrieved and no source was consulted, so this
                  carries no citation and no confidence rating. Ask an
                  intellectual-property or regulatory-law question and the full
                  pipeline runs.
                </p>
              </div>
            )}

            {/* A. UNAVAILABLE State */}
            {isUnavailable && (
              <section className="wireframe-box rounded-none">
                <div className="border-b border-wireframe px-4 py-2.5 bg-[#141822] text-xs font-mono uppercase tracking-wider text-muted font-semibold flex items-center justify-between">
                  <span>Answer unavailable</span>
                  <span className="text-[10px] px-2 py-0.5 border border-red-900/50 bg-red-950/30 text-red-400">
                    {result?.service_failure?.code || "ERROR"}
                  </span>
                </div>
                <div className="p-5 space-y-4">
                  {result?.service_failure?.code === "rate_limited" ? (
                    <div className="p-4 bg-amber-950/25 border border-amber-800/50 text-amber-200 text-xs space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="text-2xl mt-0.5">⏱</div>
                        <div className="space-y-1">
                          <div className="font-semibold text-amber-300 text-sm">Groq free-tier rate limit hit</div>
                          <p className="text-amber-200/80 leading-relaxed">
                            The model allows ~8,000 tokens per minute. Nothing was retried automatically — one
                            question is one request. Wait for the window to reset, then retry.
                          </p>
                        </div>
                      </div>
                      {rateLimitCountdown !== null && (
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex-1 h-1.5 bg-amber-950/60 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500/70 rounded-full transition-all duration-1000"
                              style={{ width: `${((62 - rateLimitCountdown) / 62) * 100}%` }}
                            />
                          </div>
                          <span className="font-mono text-amber-300 text-sm tabular-nums min-w-[3rem] text-right">
                            {rateLimitCountdown}s
                          </span>
                          <button
                            type="button"
                            onClick={() => { cancelRateLimit(); handleAsk(rateLimitQuery); }}
                            className="text-[11px] px-3 py-1 border border-amber-700/60 text-amber-300 hover:bg-amber-900/30 transition-colors"
                          >
                            Retry now
                          </button>
                          <button
                            type="button"
                            onClick={cancelRateLimit}
                            className="text-[11px] px-3 py-1 border border-zinc-700 text-zinc-400 hover:bg-zinc-800/40 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-3.5 bg-red-950/30 border border-red-900/60 text-red-300 text-xs space-y-1">
                      <div className="font-semibold">The answer provider did not respond.</div>
                      <div className="font-mono text-[11px] opacity-80">
                        provider error: <code>{result?.service_failure?.code || "unknown"}</code>
                      </div>
                      {result?.service_failure?.detail && (
                        // The backend already records what actually failed — a
                        // timeout, DNS, a refused connection. Showing it turns
                        // an unreproducible venue failure into a diagnosis.
                        <div className="font-mono text-[11px] opacity-60 break-words">
                          {result.service_failure.detail}
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-subtext leading-relaxed">
                    The evidence below <strong>was</strong> retrieved and ranked — only answer generation failed.
                    This is a service limit, not a judgement about the sources.
                  </p>
                </div>
              </section>
            )}

            {/* B. ABSTAINED State */}
            {isAbstained && !isUnavailable && (
              <section className="wireframe-box rounded-none">
                <div className="border-b border-wireframe px-4 py-2.5 bg-[#171412] text-xs font-mono uppercase tracking-wider text-amber-400 font-semibold flex items-center justify-between">
                  <span>Safe abstention</span>
                  <span className="text-[10px] px-2 py-0.5 border border-amber-800/60 bg-amber-950/30">
                    ABSTAINED
                  </span>
                </div>
                <div className="p-5 space-y-4">
                  <div className="text-sm sm:text-base text-prose leading-relaxed">
                    {answerObj.answer ||
                      "I couldn't produce a sufficiently supported answer from the available legal evidence."}
                  </div>

                  <div className="p-3.5 bg-amber-950/30 border border-amber-900/60 text-amber-200/90 text-xs space-y-2">
                    <div>
                      <strong className="text-amber-400">No answer was published.</strong> The system found evidence
                      but it did not survive validation, so nothing is shown rather than something unverified.
                    </div>
                    {answerObj.insufficient_evidence_reasons &&
                      answerObj.insufficient_evidence_reasons.length > 0 && (
                        <ul className="list-disc pl-5 space-y-1 font-mono text-[11px] text-amber-300">
                          {answerObj.insufficient_evidence_reasons.map((f, fIdx) => (
                            <li key={fIdx}>
                              <code className="text-amber-200 bg-black/40 px-1 py-0.5">{f.code}</code> — {f.detail}
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>

                  {/*
                    Phase E, second stage. This sits beside the abstention and
                    changes nothing about it: the status above still reads
                    ABSTAINED and the reasons are still the pipeline's own. It
                    offers a next question rather than telling the user to
                    rephrase, and the retry carries clarified:true so this is
                    the last time it can appear.
                  */}
                  {clarification && (
                    <div className="p-3.5 border border-wireframe bg-[#0b0e13] text-xs space-y-2">
                      <div className="text-zinc-300">{clarification.question}</div>
                      <button
                        type="button"
                        onClick={() => handleAsk(question, { clarified: true })}
                        className="font-mono text-blue-400 hover:text-blue-300 cursor-pointer"
                      >
                        ▸ Yes — search again on that reading
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* B2. NEEDS_CLARIFICATION — one question, then never again */}
            {needsClarification && clarification && (
              <section className="border border-wireframe bg-card">
                <div className="px-5 py-3 border-b border-wireframe flex items-center justify-between">
                  <h2 className="text-xs font-mono uppercase tracking-wider text-subtext">
                    One quick question
                  </h2>
                  <span className="px-2 py-0.5 text-[10px] font-mono uppercase border border-blue-800/60 text-blue-300 bg-blue-950/20">
                    NEEDS CLARIFICATION
                  </span>
                </div>
                <div className="p-5 space-y-4">
                  <div className="text-sm sm:text-base text-prose leading-relaxed">
                    {clarification.question}
                  </div>
                  <div className="text-xs text-subtext font-mono">
                    {clarification.reason}
                  </div>
                  {clarification.options?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {clarification.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            const refined = `${question.trim()} (${option})`;
                            setQuestion(refined);
                            handleAsk(refined, { clarified: true });
                          }}
                          className="px-2.5 py-1 text-xs font-mono border border-wireframe text-zinc-300 hover:border-blue-700 hover:text-blue-300 transition-colors cursor-pointer"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleAsk(question, { clarified: true })}
                    className="text-xs font-mono text-blue-400 hover:text-blue-300 cursor-pointer"
                  >
                    ▸ Search anyway with what I typed
                  </button>
                </div>
              </section>
            )}

            {/* C. ANSWERED State */}
            {!isAbstained && !isUnavailable && !needsClarification && !isSocial && (
              <section className="wireframe-box rounded-none">
                <div className="border-b border-wireframe px-4 py-2.5 bg-[#141822] text-xs font-mono uppercase tracking-wider text-muted font-semibold flex items-center justify-between">
                  <span>Answer</span>
                  <span className="text-[10px] px-2 py-0.5 border border-emerald-800/60 text-emerald-400 bg-emerald-950/30">
                    ANSWERED
                  </span>
                </div>

                <div className="p-5 space-y-4">
                  {/* Prose with in-text citation markers */}
                  <div className="text-base sm:text-[17px] leading-relaxed font-sans text-prose">
                    {renderGroundedProse(answerObj.answer)}
                  </div>

                  {/* Badges line */}
                  <div className="flex flex-wrap gap-2 pt-1 font-mono text-xs">
                    {confidence && (
                      <span className={`px-2 py-1 border ${confColor}`}>
                        Confidence: {confidence}
                      </span>
                    )}
                    {confidenceReport?.source_confidence && (
                      <span className="px-2 py-1 border border-wireframe text-zinc-400 bg-zinc-900">
                        Sources: {confidenceReport.source_confidence} · Support:{" "}
                        {confidenceReport.support_confidence}
                      </span>
                    )}
                    <span className="px-2 py-1 border border-emerald-800/60 text-emerald-400 bg-emerald-950/20">
                      Grounded — every sentence cites evidence
                    </span>
                    <span className="px-2 py-1 border border-emerald-800/60 text-emerald-400 bg-emerald-950/20">
                      Citations validated ({answerObj.citations?.length || 0})
                    </span>
                  </div>

                  {/*
                    Why the badge says what it says. A bare "LOW" is the thing
                    users complained about, and it is not fixable by changing
                    the level: on the measured sample the commonest reason for
                    LOW is that every cited instrument has been amended since
                    the consolidation in this corpus, which is true, is worth
                    knowing, and is invisible in one word.
                  */}
                  {confidenceFactors.length > 0 && (
                    <div className="border border-wireframe bg-[#0b0e13] px-3.5 py-2.5 space-y-1">
                      <div className="text-[10px] font-mono uppercase tracking-wide text-subtext">
                        Why this confidence
                      </div>
                      <ul className="space-y-1">
                        {confidenceFactors.map((f) => (
                          <li
                            key={`${f.axis}-${f.code}`}
                            className="text-xs text-zinc-400 leading-relaxed flex gap-2"
                          >
                            <span
                              className={`font-mono text-[10px] uppercase shrink-0 pt-0.5 ${
                                f.caps_at === "HIGH"
                                  ? "text-emerald-500"
                                  : f.caps_at === "LOW"
                                  ? "text-amber-500"
                                  : "text-blue-400"
                              }`}
                            >
                              {f.axis}
                            </span>
                            <span>{f.detail}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Conflicting Evidence Alert */}
                  {answerObj.conflict_detected && (
                    <div className="p-3.5 bg-amber-950/30 border border-amber-800/60 text-amber-300 text-xs space-y-1">
                      <strong>Conflicting evidence.</strong> These sources were flagged as conflicting or
                      indistinguishable. IP-SAKTI reports the disagreement and does not decide between them:{" "}
                      <span className="font-mono text-[11px]">
                        {(answerObj.conflict_chunks || []).join(", ")}
                      </span>
                    </div>
                  )}

                  {/* Caution Alert */}
                  {answerObj.cautions && answerObj.cautions.length > 0 && (
                    <div className="p-3.5 bg-amber-950/30 border border-amber-800/60 text-amber-200 text-xs space-y-1">
                      <strong className="text-amber-400 font-mono uppercase">Caution</strong>
                      <ul className="list-disc pl-5 space-y-1">
                        {answerObj.cautions.map((c, cIdx) => (
                          <li key={cIdx}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* 6. SOURCES Section (when authoritative sources are cited) */}
            {citedEvidence.length > 0 && (
              <section className="wireframe-box rounded-none">
                <div className="border-b border-wireframe px-4 py-2.5 bg-[#141822] text-xs font-mono uppercase tracking-wider text-muted font-semibold flex items-center justify-between">
                  <span>Sources</span>
                  <span className="text-[11px] font-mono text-zinc-400 lowercase">
                    {citedEvidence.length} cited
                    {uncitedEvidence.length > 0 ? ` · ${uncitedEvidence.length} additional retrieved` : ""}
                  </span>
                </div>

                <div className="divide-y divide-wireframe">
                  {citedEvidence.map((e) => renderSourceCard(e))}
                </div>

                {/* Additional retrieved but uncited evidence in an optional drawer */}
                {uncitedEvidence.length > 0 && (
                  <div className="border-t border-wireframe bg-[#11141c]">
                    <div className="px-4 py-2.5 flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-400">
                        {uncitedEvidence.length} candidate{uncitedEvidence.length > 1 ? "s" : ""} retrieved but not cited
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowUncitedCandidates(!showUncitedCandidates)}
                        className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer text-[11px]"
                      >
                        {showUncitedCandidates ? "▾ Hide uncited candidates" : "▸ Show uncited candidates"}
                      </button>
                    </div>
                    {showUncitedCandidates && (
                      <div className="divide-y divide-wireframe border-t border-wireframe">
                        {uncitedEvidence.map((e) => renderSourceCard(e))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* When 0 sources were cited (Abstained / No authoritative evidence) */}
            {citedEvidence.length === 0 && evidenceList.length > 0 && (
              <section className="wireframe-box rounded-none p-4 bg-[#141822] text-xs font-mono">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-zinc-600"></span>
                    <span className="text-zinc-400">0 authoritative sources cited for this query</span>
                  </div>
                  {uncitedEvidence.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowUncitedCandidates(!showUncitedCandidates)}
                      className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer text-[11px]"
                    >
                      {showUncitedCandidates
                        ? `▾ Hide ${uncitedEvidence.length} retrieved candidate passages (off-topic)`
                        : `▸ Inspect ${uncitedEvidence.length} retrieved candidate passages (off-topic)`}
                    </button>
                  )}
                </div>

                {showUncitedCandidates && uncitedEvidence.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-wireframe space-y-2">
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      The lexical search engine fetched these passages based on token matches, but the safety policy rejected all of them because they share no relevant content terms with the query:
                    </p>
                    <div className="divide-y divide-wireframe border border-wireframe">
                      {uncitedEvidence.map((e) => renderSourceCard(e))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </main>

      {/* 7. Footer: Disclaimer & Pipeline Timings */}
      <footer className="border-t border-wireframe bg-card/60 mt-10 py-6 px-4 text-center text-xs font-mono text-muted space-y-2">
        <div className="max-w-3xl mx-auto space-y-2">
          <p className="text-zinc-400 text-[11.5px] leading-relaxed">
            {result?.disclaimer ||
              "IP-SAKTI is an information and research tool that answers from a fixed corpus of published legal texts. It is not legal advice and is not a substitute for a qualified practitioner."}
          </p>

          {result?.timings_ms && (
            <div className="text-[11px] text-zinc-500 font-mono">
              retrieval {result.timings_ms.retrieval}ms · rerank {result.timings_ms.reranking}ms · answer{" "}
              {result.timings_ms.answering}ms · total {result.timings_ms.total}ms —{" "}
              {result.pipeline?.candidates} candidates → {result.pipeline?.evidence_count} evidence passages ·{" "}
              {result.pipeline?.reranker} · {result.pipeline?.provider}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
