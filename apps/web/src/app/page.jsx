"use client";

import React, { useState, useEffect, useRef } from "react";
import { Mic, Square, Volume2 } from "lucide-react";

import { LANGUAGES, languageByCode } from "../lib/languages.mjs";
import { collectProtectedTerms } from "../lib/translation-client.mjs";
import {
  selectPreferredVoice,
  voicesForLocale,
} from "../lib/voice-selection.mjs";

// Production (Vercel): NEXT_PUBLIC_API_URL="" → uses relative /api/... path → Next.js proxy → Render
// Local dev: falls back to Express gateway on :5001
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";
const TRANSLATION_FALLBACK =
  "Translation is unavailable right now. You can continue in English.";

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

async function translateText({
  text,
  sourceLanguage,
  targetLanguage,
  protectedTerms = [],
}) {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      sourceLanguage,
      targetLanguage,
      protectedTerms,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.translatedText !== "string") {
    throw new Error(data.message || TRANSLATION_FALLBACK);
  }
  return data.translatedText;
}

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
  const [selectedLanguageCode, setSelectedLanguageCode] = useState("en");
  const [displayAnswer, setDisplayAnswer] = useState("");
  const [translationNotice, setTranslationNotice] = useState(null);
  const [translationStage, setTranslationStage] = useState("");
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [displayLanguageCode, setDisplayLanguageCode] = useState("en");

  const stepTimerRef = useRef(null);
  const rateLimitTimerRef = useRef(null);
  const recognitionRef = useRef(null);

  const selectedLanguage = languageByCode(selectedLanguageCode);
  const displayLanguage = languageByCode(displayLanguageCode);
  const matchingVoices = voicesForLocale(
    availableVoices,
    selectedLanguage.speechLocale,
  );

  // Health only. Asking a question on mount spent a provider completion on
  // every page load and every refresh — before anyone had clicked anything —
  // which is a real cost against a free-tier per-minute cap and is not a
  // decision a page load should be making. The input is prefilled with
  // SAMPLES[0], so the first question is still one click away.
  useEffect(() => {
    fetchHealth();
    setSpeechSupported(
      "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
    );
    const synth = window.speechSynthesis;
    const loadVoices = () => setAvailableVoices(synth?.getVoices() || []);
    loadVoices();
    synth?.addEventListener?.("voiceschanged", loadVoices);

    return () => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
      if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
      synth?.removeEventListener?.("voiceschanged", loadVoices);
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    const preferredVoice = selectPreferredVoice(
      availableVoices,
      selectedLanguage.speechLocale,
      selectedVoiceURI,
    );
    setSelectedVoiceURI(preferredVoice?.voiceURI || "");
  }, [availableVoices, selectedLanguage.speechLocale, selectedVoiceURI]);

  useEffect(() => {
    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setRecognitionSupported(false);
      recognitionRef.current = null;
      return undefined;
    }

    setRecognitionSupported(true);
    const recognition = new Recognition();
    recognition.lang = selectedLanguage.speechLocale;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || "";
        if (event.results[index].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (finalText.trim()) setQuestion(finalText.trim());
      setInterimTranscript(interimText.trim());
    };
    recognition.onerror = (event) => {
      setIsListening(false);
      setInterimTranscript("");
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceMessage(
          "Microphone access was denied. Allow access in your browser or type your question.",
        );
      } else if (event.error !== "aborted") {
        setVoiceMessage(
          "Voice input stopped. You can try again or type your question.",
        );
      }
    };
    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
    };
    recognitionRef.current = recognition;

    return () => {
      recognition.onend = null;
      recognition.abort();
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
  }, [selectedLanguage.speechLocale]);

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

  const toggleListening = () => {
    const recognition = recognitionRef.current;
    if (!recognition || loading) return;
    setVoiceMessage("");
    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }

    setQuestion("");
    setInterimTranscript("");
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setVoiceMessage(
        "Voice input is already active. Stop it before starting again.",
      );
    }
  };

  const toggleSpeech = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const text = displayAnswer || result?.answer?.answer;
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = selectPreferredVoice(
      availableVoices,
      displayLanguage.speechLocale,
      displayLanguage.code === selectedLanguage.code ? selectedVoiceURI : "",
    );
    utterance.lang = voice?.lang || displayLanguage.speechLocale;
    if (voice) utterance.voice = voice;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => {
      setIsSpeaking(false);
      setVoiceMessage("Audio playback is unavailable in this browser.");
    };
    setIsSpeaking(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleAsk = async (queryText) => {
    const q = (queryText !== undefined ? queryText : question).trim();
    if (!q) return;
    const requestLanguage =
      queryText !== undefined && SAMPLES.includes(queryText)
        ? LANGUAGES[0]
        : selectedLanguage;

    // Cancel any pending rate-limit retry
    cancelRateLimit();

    setLoading(true);
    setError(null);
    setResult(null);
    setDisplayAnswer("");
    setDisplayLanguageCode("en");
    setTranslationNotice(null);
    setTranslationStage("");
    setExpandedSources({});
    setShowUncitedCandidates(false);
    startStepAnimation();

    try {
      let englishQuestion = q;
      if (requestLanguage.code !== "en") {
        setTranslationStage("Translating question to English");
        try {
          englishQuestion = await translateText({
            text: q,
            sourceLanguage: requestLanguage.code,
            targetLanguage: "en",
          });
        } catch (translationError) {
          setTranslationNotice(
            translationError.message || TRANSLATION_FALLBACK,
          );
          setSelectedLanguageCode("en");
          return;
        }
      }

      setTranslationStage("");
      const res = await fetch(`${API_BASE_URL}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: englishQuestion }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok && (data.status === "invalid_request" || data.status === "INVALID_REQUEST")) {
        setError(data.message || data.error?.message || "Invalid question.");
      } else if (!res.ok && data.status !== "UNAVAILABLE") {
        throw new Error(data.error?.message || data.error || "RAG request failed.");
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

        const originalAnswer = data?.answer?.answer;
        if (
          data.status === "ANSWERED" &&
          requestLanguage.code !== "en" &&
          originalAnswer
        ) {
          setTranslationStage(`Translating answer to ${requestLanguage.label}`);
          try {
            const translatedAnswer = await translateText({
              text: originalAnswer,
              sourceLanguage: "en",
              targetLanguage: requestLanguage.code,
              protectedTerms: collectProtectedTerms(data),
            });
            setDisplayAnswer(translatedAnswer);
            setDisplayLanguageCode(requestLanguage.code);
          } catch (translationError) {
            setDisplayAnswer(originalAnswer);
            setDisplayLanguageCode("en");
            setTranslationNotice(
              translationError.message || TRANSLATION_FALLBACK,
            );
          }
        } else {
          setDisplayAnswer(originalAnswer || "");
          setDisplayLanguageCode("en");
        }
      }
    } catch (err) {
      console.error("API call error:", err);
      setError(
        "IP-SAKTI could not complete that request. Check that the RAG service is running and try again.",
      );
    } finally {
      setTranslationStage("");
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
  const isAbstained = result?.status === "ABSTAINED" || answerObj?.insufficient_evidence;
  const isUnavailable = result?.status === "UNAVAILABLE";
  const confidence = answerObj?.confidence;
  const jurisdiction = result?.jurisdiction ?? answerObj?.jurisdiction;

  const confColor =
    confidence === "HIGH"
      ? "text-emerald-400 border-emerald-800/60 bg-emerald-950/30"
      : confidence === "LOW"
      ? "text-amber-400 border-amber-800/60 bg-amber-950/30"
      : "text-blue-300 border-blue-800/60 bg-blue-950/30";

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

            {/* Collapsible Evidence Accordion */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => toggleSourceExpand(e.marker)}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors py-1 cursor-pointer font-semibold"
              >
                <span>{isExpanded ? "▾ Hide evidence text" : "▸ View evidence text"}</span>
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

        {/* 2. Voice-first question box */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk(question);
          }}
          className="wireframe-box p-4 sm:p-6 space-y-5 rounded-md"
        >
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="grid flex-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="language-select"
                  className="block text-[11px] font-mono uppercase tracking-wider text-subtext"
                >
                  Answer language
                </label>
                <select
                  id="language-select"
                  value={selectedLanguageCode}
                  onChange={(event) => {
                    if (isListening) recognitionRef.current?.stop();
                    window.speechSynthesis?.cancel();
                    setIsSpeaking(false);
                    setSelectedLanguageCode(event.target.value);
                    setSelectedVoiceURI("");
                    setTranslationNotice(null);
                    setVoiceMessage("");
                  }}
                  disabled={loading}
                  className="w-full bg-[#0b0e14] border border-wireframe rounded px-3 py-2.5 text-sm text-prose focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  {LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label} · {language.nativeLabel}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="voice-select"
                  className="block text-[11px] font-mono uppercase tracking-wider text-subtext"
                >
                  Voice persona
                </label>
                <select
                  id="voice-select"
                  value={selectedVoiceURI}
                  onChange={(event) => setSelectedVoiceURI(event.target.value)}
                  disabled={loading || !speechSupported || matchingVoices.length === 0}
                  className="w-full bg-[#0b0e14] border border-wireframe rounded px-3 py-2.5 text-sm text-prose focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {matchingVoices.length === 0 ? (
                    <option value="">Browser default for {selectedLanguage.label}</option>
                  ) : (
                    matchingVoices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} · {voice.lang}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={toggleListening}
              disabled={!recognitionSupported || loading}
              aria-pressed={isListening}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-45 ${
                isListening
                  ? "bg-red-950/50 text-red-200 border border-red-700/70"
                  : "bg-blue-600 text-white hover:bg-blue-500 border border-blue-500"
              }`}
            >
              {isListening ? <Square size={16} /> : <Mic size={17} />}
              {isListening ? "Stop listening" : "Speak question"}
            </button>
          </div>

          <div
            aria-live="polite"
            className={`min-h-12 rounded border px-3 py-2.5 text-sm ${
              isListening
                ? "border-blue-700/70 bg-blue-950/20 text-blue-100"
                : "border-wireframe bg-[#0b0e14] text-subtext"
            }`}
          >
            {interimTranscript ||
              (isListening
                ? `Listening in ${selectedLanguage.label}…`
                : recognitionSupported
                ? "Live speech transcript will appear here. You can edit it below."
                : "Voice input is not supported in this browser. Type your question below.")}
          </div>

          {voiceMessage && (
            <div
              role="status"
              className="rounded border border-amber-800/60 bg-amber-950/25 px-3 py-2.5 text-xs text-amber-200"
            >
              {voiceMessage}
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor="question-input"
              className="block text-[11px] font-mono uppercase tracking-wider text-subtext"
            >
              Edit your question
            </label>

            <textarea
              id="question-input"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAsk(question);
                }
              }}
              placeholder="Speak or type an intellectual-property question"
              disabled={loading}
              className="w-full bg-[#0a0c10] border border-wireframe rounded px-3.5 py-3 text-sm text-prose placeholder:text-muted focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-sans resize-y"
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-[11px] leading-relaxed text-muted">
              Demo multilingual layer: Google Cloud Translation + browser voice. Bhashini integration will be enabled after API approval.
            </span>
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="w-full sm:w-auto shrink-0 rounded bg-blue-600 hover:bg-blue-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? "Working…" : "Ask IP-SAKTI"}
            </button>
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
                  setSelectedLanguageCode("en");
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

            {translationStage ? (
              <div className="text-xs font-mono text-blue-300" aria-live="polite">
                {translationStage}…
              </div>
            ) : (
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
            )}
          </div>
        )}

        {translationNotice && (
          <div
            role="status"
            className="rounded border border-amber-800/60 bg-amber-950/25 px-4 py-3 text-sm text-amber-100"
          >
            {translationNotice}
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
                </div>
              </section>
            )}

            {/* C. ANSWERED State */}
            {!isAbstained && !isUnavailable && (
              <section className="wireframe-box rounded-none">
                <div className="border-b border-wireframe px-4 py-2.5 bg-[#141822] text-xs font-mono uppercase tracking-wider text-muted font-semibold flex items-center justify-between">
                  <span>Answer · {displayLanguage.label}</span>
                  <span className="text-[10px] px-2 py-0.5 border border-emerald-800/60 text-emerald-400 bg-emerald-950/30">
                    ANSWERED
                  </span>
                </div>

                <div className="p-5 space-y-4">
                  {/* Prose with in-text citation markers */}
                  <div className="text-base sm:text-[17px] leading-relaxed font-sans text-prose">
                    {renderGroundedProse(displayAnswer || answerObj.answer)}
                  </div>

                  <div className="flex flex-col gap-3 border-t border-wireframe/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap gap-2 font-mono text-xs">
                      {confidence && (
                        <span className={`px-2 py-1 border ${confColor}`}>
                          Confidence: {confidence}
                        </span>
                      )}
                      {jurisdiction !== undefined && jurisdiction !== null && (
                        <span className="px-2 py-1 border border-wireframe text-zinc-300">
                          Jurisdiction: {String(jurisdiction)}
                        </span>
                      )}
                      <span className="px-2 py-1 text-emerald-400">
                        Grounded · {answerObj.citations?.length || 0} citations validated
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={toggleSpeech}
                      disabled={!speechSupported}
                      aria-pressed={isSpeaking}
                      className="inline-flex items-center justify-center gap-2 rounded border border-wireframe-bright px-3 py-2 text-xs font-semibold text-prose transition-colors hover:border-blue-500 hover:text-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {isSpeaking ? <Square size={14} /> : <Volume2 size={15} />}
                      {isSpeaking
                        ? "Stop audio"
                        : `Listen to answer · ${displayLanguage.label}`}
                    </button>
                  </div>

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
