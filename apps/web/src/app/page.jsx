"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Shield,
  AlertTriangle,
  FileText,
  Square,
  Volume2,
  Check,
  Loader2,
  Mic,
  MoreHorizontal,
  RefreshCw,
  Edit2,
  Navigation,
  Trash2,
  Compass,
  BookOpen,
  Sparkles,
  X,
  Scale,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Stepper, { Step } from "../components/Stepper/Stepper";
import {
  ChatInput,
  ChatInputTextArea,
  ChatInputSubmit,
} from "../components/ui/chat-input";
import { LANGUAGES, languageByCode } from "../lib/languages.mjs";
import { collectProtectedTerms } from "../lib/translation-client.mjs";
import {
  selectPreferredVoice,
  voicesForLocale,
} from "../lib/voice-selection.mjs";


// Rehearsed demo legal questions for the animated blur placeholder and onboarding
const DEMO_QUESTIONS = [
  "How must an application for registration of a trade mark be signed?",
  "Is the mere discovery of a new form of a known substance patentable in India?",
  "What is the duration of the registration of a trade mark and when must it be renewed?",
  "What is the term of copyright in a literary work published in the lifetime of the author?",
  "Who may apply for the registration of a geographical indication?",
];
const SAMPLES = DEMO_QUESTIONS;

// API endpoints: Express Gateway on :5001 with direct fallback to Python server on :8000
const PRIMARY_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";
const FALLBACK_API_URL = "http://localhost:8000";
const TRANSLATION_FALLBACK =
  "Translation is unavailable right now. You can continue in English.";
const LEGAL_DISCLAIMER =
  "IP-SAKTI is an information and research tool that answers from a fixed corpus of published legal texts. It is not legal advice and is not a substitute for a qualified practitioner.";

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

const ANALYSIS_STEPS = [
  "Query processing",
  "Evidence retrieval",
  "Reranking sources",
  "Selecting evidence",
  "Generating grounded answer",
  "Validating citations",
];

// Isolated source evidence item with its own independent expansion state
function SourceItem({ src, index }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const marker = src.marker || index + 1;

  return (
    <div className="border border-[#e2e8f0] rounded-xl p-3 sm:p-4 bg-white transition">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2 sm:gap-2.5 min-w-0">
          <span className="text-xs font-bold text-[#334155] mt-0.5 shrink-0">
            [{marker}]
          </span>
          <div className="space-y-1 min-w-0">
            <h4 className="text-xs font-semibold text-[#0f172a] leading-tight break-words">
              {src.document_name || src.document_id}
            </h4>
            <p className="text-[11px] text-[#64748b] break-words">
              {src.locator_text || "Example record · Section 1"}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#ecfdf5] text-[#047857] border border-[#a7f3d0] uppercase">
                VERIFIED
              </span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#f1f5f9] text-[#475569] uppercase">
                PROVENANCE {src.source_evidence_level || "A"}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-1 text-[11px] font-medium text-[#64748b] hover:text-[#0f172a] shrink-0 pt-0.5"
        >
          <span>{isExpanded ? "Hide evidence" : "View evidence"}</span>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-[#f1f5f9] text-xs text-gray-700 bg-gray-50 p-3 rounded-lg font-mono leading-relaxed max-h-60 overflow-y-auto">
          <p className="whitespace-pre-wrap break-words">{src.text}</p>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [optionsDropdownOpen, setOptionsDropdownOpen] = useState(false);

  // Active chat messages - Clean initial state with no old mock messages
  const [messages, setMessages] = useState([]);

  const [inputText, setInputText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [showGuide, setShowGuide] = useState(true);
  const [guideCompleted, setGuideCompleted] = useState(false);
  const [placeholderQuestionIndex, setPlaceholderQuestionIndex] = useState(0);
  const [selectedLanguageCode, setSelectedLanguageCode] = useState("en");
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isSpeakingMessageId, setIsSpeakingMessageId] = useState(null);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [translationNotice, setTranslationNotice] = useState("");
  const [health, setHealth] = useState(null);

  const stepTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const latestTurnRef = useRef(null);
  const textareaRef = useRef(null);
  const recognitionRef = useRef(null);

  const selectedLanguage = languageByCode(selectedLanguageCode);
  const matchingVoices = voicesForLocale(
    availableVoices,
    selectedLanguage.speechLocale,
  );

  useEffect(() => {
    fetchHealth();
    const synth = window.speechSynthesis;
    setSpeechSupported(
      "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
    );
    const loadVoices = () => setAvailableVoices(synth?.getVoices() || []);
    loadVoices();
    synth?.addEventListener?.("voiceschanged", loadVoices);
    return () => {
      synth?.removeEventListener?.("voiceschanged", loadVoices);
      synth?.cancel();
    };
  }, []);

  async function fetchHealth() {
    for (const apiUrl of [PRIMARY_API_URL, FALLBACK_API_URL]) {
      try {
        const response = await fetch(`${apiUrl}/api/health`);
        if (response.ok) {
          setHealth(await response.json());
          return;
        }
      } catch {
        // Try the direct Python service when the local gateway is unavailable.
      }
    }
    setHealth(null);
  }

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
      if (finalText.trim()) setInputText(finalText.trim());
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

  // Cycle through demo questions one-by-one when textarea is empty
  useEffect(() => {
    if (inputText.trim()) return; // Pause cycling while user is actively typing
    const interval = setInterval(() => {
      setPlaceholderQuestionIndex((prev) => (prev + 1) % DEMO_QUESTIONS.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [inputText]);

  // Auto-fill active placeholder question on Tab key or placeholder click
  const applyPlaceholderText = () => {
    if (!inputText) {
      const activeQuestion = DEMO_QUESTIONS[placeholderQuestionIndex];
      if (activeQuestion) {
        setInputText(activeQuestion);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            try {
              textareaRef.current.setSelectionRange(activeQuestion.length, activeQuestion.length);
            } catch (err) {}
          }
        }, 0);
      }
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === "Tab" && !inputText) {
      e.preventDefault();
      applyPlaceholderText();
    }
  };

  // Global Tab key listener to autocomplete active question when on empty home state
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === "Tab" && !inputText && messages.length === 0 && !showGuide) {
        e.preventDefault();
        applyPlaceholderText();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [inputText, messages.length, showGuide, placeholderQuestionIndex]);

  // Keep the active question and AI answer text visible on screen (laptop & mobile)
  useEffect(() => {
    if (latestTurnRef.current) {
      latestTurnRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [messages.length, isGenerating]);

  const clearStepTimers = () => {
    if (Array.isArray(stepTimerRef.current)) {
      stepTimerRef.current.forEach(clearTimeout);
      stepTimerRef.current = [];
    } else if (stepTimerRef.current) {
      clearInterval(stepTimerRef.current);
      stepTimerRef.current = null;
    }
  };

  const handleStartNewChat = () => {
    stopGeneration();
    recognitionRef.current?.abort();
    window.speechSynthesis?.cancel();
    setMessages([]);
    setInputText("");
    setCurrentStepIndex(0);
    setShowGuide(true);
    setGuideCompleted(false);
    setIsListening(false);
    setIsSpeakingMessageId(null);
    setInterimTranscript("");
    setTranslationNotice("");
    setVoiceMessage("");
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    clearStepTimers();
    setIsGenerating(false);
  };

  const toggleListening = () => {
    const recognition = recognitionRef.current;
    if (!recognition || isGenerating) return;
    setVoiceMessage("");
    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }

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

  const toggleSpeech = (message) => {
    if (!speechSupported || !message?.answer) return;
    if (isSpeakingMessageId === message.id) {
      window.speechSynthesis.cancel();
      setIsSpeakingMessageId(null);
      return;
    }

    const answerLanguage = languageByCode(message.displayLanguageCode || "en");
    const preferredVoiceURI =
      answerLanguage.code === selectedLanguage.code ? selectedVoiceURI : "";
    const voice = selectPreferredVoice(
      availableVoices,
      answerLanguage.speechLocale,
      preferredVoiceURI,
    );
    const utterance = new SpeechSynthesisUtterance(message.answer);
    utterance.lang = voice?.lang || answerLanguage.speechLocale;
    if (voice) utterance.voice = voice;
    utterance.onend = () => setIsSpeakingMessageId(null);
    utterance.onerror = () => {
      setIsSpeakingMessageId(null);
      setVoiceMessage("Audio playback is unavailable in this browser.");
    };
    window.speechSynthesis.cancel();
    setIsSpeakingMessageId(message.id);
    window.speechSynthesis.speak(utterance);
  };

  const handleSendMessage = async (queryToSend) => {
    const q = (queryToSend || inputText).trim();
    if (!q || isGenerating) return;
    const requestLanguage = DEMO_QUESTIONS.includes(q)
      ? LANGUAGES[0]
      : selectedLanguage;

    setInputText("");
    const userMsgId = `user-${Date.now()}`;
    const aiMsgId = `ai-${Date.now()}`;

    const userMessage = {
      id: userMsgId,
      role: "user",
      content: q,
    };

    const aiPlaceholder = {
      id: aiMsgId,
      role: "assistant",
      status: "loading",
      step: 0,
    };

    setMessages((prev) => [...prev, userMessage, aiPlaceholder]);

    setIsGenerating(true);
    setCurrentStepIndex(0);
    setTranslationNotice("");

    // Realistic pipeline durations: each step spins only once!
    // Step 0: Query processing (~300ms)
    // Step 1: Evidence retrieval (~800ms)
    // Step 2: Reranking sources (~600ms)
    // Step 3: Selecting evidence (~450ms)
    // Step 4: Generating grounded answer (~1200ms)
    // Step 5: Validating citations (stays active until backend response completes, never loops)
    clearStepTimers();
    const stepDelays = [300, 800, 600, 450, 1200];
    const timeouts = [];
    let accumulated = 0;

    stepDelays.forEach((delay, idx) => {
      accumulated += delay;
      const t = setTimeout(() => {
        setCurrentStepIndex(idx + 1);
      }, accumulated);
      timeouts.push(t);
    });

    stepTimerRef.current = timeouts;

    abortControllerRef.current = new AbortController();

    try {
      let rawData = null;
      let englishQuery = q;

      if (requestLanguage.code !== "en") {
        try {
          englishQuery = await translateText({
            text: q,
            sourceLanguage: requestLanguage.code,
            targetLanguage: "en",
          });
        } catch (translationError) {
          clearStepTimers();
          setTranslationNotice(
            translationError.message || TRANSLATION_FALLBACK,
          );
          setMessages((prev) =>
            prev.map((message) =>
              message.id === aiMsgId
                ? {
                    ...message,
                    status: "error",
                    error:
                      "Translation could not start this request. Please continue in English.",
                  }
                : message,
            ),
          );
          return;
        }
      }

      try {
        const response = await fetch(`${PRIMARY_API_URL}/api/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: englishQuery }),
          signal: abortControllerRef.current.signal,
        });
        if (response.ok) {
          rawData = await response.json();
        }
      } catch (err) {
        try {
          const responseFb = await fetch(`${FALLBACK_API_URL}/api/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: englishQuery }),
            signal: abortControllerRef.current.signal,
          });
          if (responseFb.ok) {
            rawData = await responseFb.json();
          }
        } catch (innerErr) {
          console.warn("API call failed", innerErr);
        }
      }

      // Stop intermediate timers and briefly show all steps verified
      clearStepTimers();
      setCurrentStepIndex(ANALYSIS_STEPS.length);
      await new Promise((resolve) => setTimeout(resolve, 350));

      if (rawData) {
        const answerObj = rawData.answer || {};
        const isAbstained = rawData.status === "ABSTAINED";
        const originalAnswerText =
          answerObj.answer ||
          (isAbstained
            ? "I couldn't produce a sufficiently supported answer from the available legal evidence."
            : "No answer was published.");
        let answerText = originalAnswerText;
        let displayLanguageCode = "en";

        if (
          rawData.status === "ANSWERED" &&
          requestLanguage.code !== "en" &&
          answerObj.answer
        ) {
          try {
            answerText = await translateText({
              text: originalAnswerText,
              sourceLanguage: "en",
              targetLanguage: requestLanguage.code,
              protectedTerms: collectProtectedTerms(rawData),
            });
            displayLanguageCode = requestLanguage.code;
          } catch (translationError) {
            setTranslationNotice(
              translationError.message || TRANSLATION_FALLBACK,
            );
          }
        }

        const confidenceVal = answerObj.confidence || (isAbstained ? "NONE" : "HIGH");

        let cautionItem = null;
        if (answerObj.cautions && answerObj.cautions.length > 0) {
          cautionItem = {
            title: "Source notice",
            detail: answerObj.cautions[0],
          };
        } else if (isAbstained && answerObj.insufficient_evidence_reasons?.length > 0) {
          cautionItem = {
            title: "Source notice",
            detail: answerObj.insufficient_evidence_reasons[0].detail || answerObj.insufficient_evidence_reasons[0].code,
          };
        }

        const completedAiMessage = {
          id: aiMsgId,
          role: "assistant",
          status: "completed",
          confidence: confidenceVal,
          answer: answerText,
          displayLanguageCode,
          jurisdiction: rawData.jurisdiction ?? answerObj.jurisdiction,
          disclaimer: rawData.disclaimer,
          citations: answerObj.citations || [],
          caution: cautionItem,
          evidence: rawData.evidence || [],
          timings_ms: rawData.timings_ms || {},
        };

        setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? completedAiMessage : m)));
      } else {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === aiMsgId
              ? {
                  ...message,
                  status: "error",
                  error:
                    "IP-SAKTI could not complete that request. Check that the RAG service is running and try again.",
                }
              : message,
          ),
        );
      }
    } catch (err) {
      clearStepTimers();
      if (err.name === "AbortError") {
        setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
      } else {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === aiMsgId
              ? {
                  ...message,
                  status: "error",
                  error:
                    "IP-SAKTI could not complete that request. Check that the RAG service is running and try again.",
                }
              : message,
          ),
        );
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const setQuestion = setInputText;
  const handleAsk = handleSendMessage;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white text-[#0f172a]">
      {/* ─── TOP NAVIGATION BAR ───────────────────────────────────────────── */}
      <header className="h-14 flex items-center justify-between px-3 sm:px-6 bg-white z-10 shrink-0">
        {/* Model Selector Pill on Left */}
        {/* Brand Logo & Name */}
        <button
          type="button"
          onClick={handleStartNewChat}
          className="flex items-center gap-2.5 text-left group focus:outline-none"
          title="IP-SAKTI Home"
        >
          <div className="w-8 h-8 rounded-xl bg-[#0f172a] flex items-center justify-center text-white shadow-xs border border-slate-800 group-hover:scale-105 transition-transform duration-200">
            <Scale className="w-4 h-4 text-white stroke-[2.2]" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[16px] sm:text-[17px] font-bold tracking-tight text-[#0f172a] group-hover:text-slate-700 transition">
              IP-SAKTI
            </span>
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100/90 text-slate-600 border border-slate-200/80">
              Statutory Law AI
            </span>
          </div>
        </button>

        {/* Action Controls on Right */}
          <div className="flex items-center gap-2 sm:gap-2.5">
          <span
            className="hidden items-center gap-1.5 text-[10px] font-medium text-slate-500 md:flex"
            title={health?.status === "ok" ? "RAG service ready" : "RAG service unavailable"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                health?.status === "ok" ? "bg-emerald-500" : "bg-slate-300"
              }`}
            />
            {health?.status === "ok" ? "RAG ready" : "Connecting"}
          </span>
          <button
            type="button"
            onClick={() => {
              setShowGuide(true);
              setGuideCompleted(false);
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#e2e8f0] text-xs font-medium text-[#334155] hover:text-[#0f172a] hover:bg-gray-50 transition"
            title="Open interactive walkthrough guide"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Guide</span>
          </button>

          <button
            onClick={handleStartNewChat}
            className="flex items-center gap-1 px-3 py-1 rounded-full border border-[#e2e8f0] text-xs font-medium text-[#334155] hover:text-[#0f172a] hover:bg-gray-50 transition"
            title="Start new chat"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>

          <div className="relative">
            <button
              onClick={() => setOptionsDropdownOpen(!optionsDropdownOpen)}
              className="w-8 h-8 rounded-full border border-[#e2e8f0] flex items-center justify-center text-[#64748b] hover:text-[#0f172a] hover:bg-gray-50 transition"
              title="More options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {optionsDropdownOpen && (
              <div className="absolute top-full right-0 mt-1.5 w-44 bg-white border border-[#e2e8f0] rounded-xl shadow-lg p-1.5 z-30">
                <button
                  onClick={() => {
                    handleStartNewChat();
                    setOptionsDropdownOpen(false);
                  }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear conversation</span>
                </button>
              </div>
            )}
          </div>

          <div
            className="w-8 h-8 rounded-full bg-[#0f172a] text-white font-bold text-xs flex items-center justify-center shadow-xs shrink-0"
            title="John Doe"
          >
            JD
          </div>
        </div>
      </header>

      <section className="border-y border-slate-200/80 bg-slate-50/70 px-3 py-2.5 sm:px-6">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-2.5 lg:flex-row lg:items-center">
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <span className="shrink-0">Language</span>
              <select
                value={selectedLanguageCode}
                onChange={(event) => {
                  recognitionRef.current?.abort();
                  window.speechSynthesis?.cancel();
                  setIsListening(false);
                  setIsSpeakingMessageId(null);
                  setSelectedLanguageCode(event.target.value);
                  setSelectedVoiceURI("");
                  setVoiceMessage("");
                  setTranslationNotice("");
                }}
                disabled={isGenerating}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-slate-400 disabled:opacity-50"
                aria-label="Answer language"
              >
                {LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label} · {language.nativeLabel}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <span className="shrink-0">Voice</span>
              <select
                value={selectedVoiceURI}
                onChange={(event) => setSelectedVoiceURI(event.target.value)}
                disabled={
                  isGenerating || !speechSupported || matchingVoices.length === 0
                }
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-slate-400 disabled:opacity-50"
                aria-label="Voice persona"
              >
                {matchingVoices.length === 0 ? (
                  <option value="">
                    Browser default for {selectedLanguage.label}
                  </option>
                ) : (
                  matchingVoices.map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} · {voice.lang}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>

          <p className="text-[10px] leading-relaxed text-slate-500 lg:max-w-sm">
            Demo multilingual layer: Google Cloud Translation + browser voice.
            Bhashini integration will be enabled after API approval.
          </p>
        </div>

        <div
          className={`mx-auto mt-2 max-w-[1040px] rounded-lg border px-2.5 py-1.5 text-[11px] ${
            voiceMessage || translationNotice
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : isListening
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-500"
          }`}
          aria-live="polite"
        >
          {translationNotice ||
            voiceMessage ||
            interimTranscript ||
            (isListening
              ? `Listening in ${selectedLanguage.label}…`
              : recognitionSupported
                ? "Live speech transcript appears here and remains editable in the question box."
                : "Voice input is not supported in this browser. Type your question below.")}
        </div>
      </section>

      {/* ─── CHAT CANVAS / MESSAGES ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-8 md:px-12 py-3 sm:py-4 space-y-5 sm:space-y-6 scroll-smooth scroll-pt-3 sm:scroll-pt-4">
        <div className="max-w-[1040px] mx-auto space-y-5 sm:space-y-6">

          {/* Empty State when no messages - Centered Hero like Perplexity */}
          <AnimatePresence mode="wait">
            {messages.length === 0 && !isGenerating && (
              <motion.div
                key="hero-empty-state"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                className="flex flex-col items-center justify-center min-h-[68vh] sm:min-h-[72vh] text-center px-2 py-4"
              >
                <div className="w-full max-w-[760px] space-y-6">
                  {/* Hero Title and Subtitle */}
                  <motion.div
                    exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                    transition={{ duration: 0.25 }}
                    className="space-y-2"
                  >
                    <span className="text-xs font-semibold uppercase tracking-widest text-[#64748b]">
                      Search &amp; Inquire
                    </span>
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#0f172a] tracking-tight">
                      What do you want to know?
                    </h1>
                    <p className="text-xs sm:text-sm text-[#64748b] max-w-lg mx-auto">
                      Indian statutory intelligence across Patents, Trade Marks, Copyright &amp; Biodiversity law.
                    </p>
                  </motion.div>

                  {/* Centered Perplexity-style Input Box */}
                  <div className="text-left w-full relative">
                    {/* Soft blur div behind chat card */}
                    <div className="absolute -inset-1 rounded-[28px] bg-slate-100/70 backdrop-blur-md -z-10 pointer-events-none" />

                    <motion.div
                      layoutId="unified-chat-card"
                      transition={{ type: "spring", stiffness: 280, damping: 28 }}
                      className="w-full"
                    >
                      <ChatInput
                        variant="unstyled"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onSubmit={() => handleSendMessage()}
                        loading={isGenerating}
                        onStop={stopGeneration}
                        className="relative border border-[#e2e8f0] bg-white/95 backdrop-blur-md rounded-[24px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-within:border-slate-400 focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.1)] transition-all p-3.5 sm:p-5 flex flex-col items-stretch"
                      >
                        <div className="relative w-full">
                          <ChatInputTextArea
                            ref={textareaRef}
                            rows={2}
                            placeholder=""
                            onKeyDown={handleInputKeyDown}
                            className="w-full bg-transparent resize-none border-none outline-none text-sm sm:text-[16px] text-[#0f172a] leading-relaxed relative z-10 p-0 shadow-none focus-visible:ring-0"
                          />

                          {/* Animated Blur Text Placeholder Overlay */}
                          {!inputText && (
                            <div
                              onClick={applyPlaceholderText}
                              className="absolute inset-0 cursor-text z-0 flex items-start select-none overflow-hidden pr-4"
                            >
                              <AnimatePresence mode="wait">
                                <motion.div
                                  key={placeholderQuestionIndex}
                                  initial={{ opacity: 0, filter: "blur(8px)", y: 4 }}
                                  animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                                  exit={{ opacity: 0, filter: "blur(8px)", y: -4 }}
                                  transition={{ duration: 0.45, ease: "easeInOut" }}
                                  className="text-sm sm:text-[16px] text-[#94a3b8] leading-relaxed flex flex-wrap items-center gap-x-1"
                                >
                                  {DEMO_QUESTIONS[placeholderQuestionIndex].split(" ").map((word, wIdx) => (
                                    <motion.span
                                      key={`${placeholderQuestionIndex}-${wIdx}`}
                                      initial={{ opacity: 0, filter: "blur(6px)" }}
                                      animate={{ opacity: 1, filter: "blur(0px)" }}
                                      transition={{
                                        duration: 0.25,
                                        delay: wIdx * 0.03,
                                        ease: "easeOut",
                                      }}
                                      className="inline-block"
                                    >
                                      {word}
                                    </motion.span>
                                  ))}
                                  <span className="inline-flex items-center text-[10px] font-mono font-medium text-[#64748b] bg-slate-100/90 border border-slate-200/90 rounded px-1.5 py-0.5 ml-1 self-center shadow-2xs">
                                    Tab ⇥
                                  </span>
                                </motion.div>
                              </AnimatePresence>
                            </div>
                          )}
                        </div>

                        {/* Bottom toolbar inside input card */}
                        <div className="flex items-center justify-between w-full pt-2 border-t border-slate-100 mt-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="w-8 h-8 rounded-full flex items-center justify-center text-[#64748b] hover:text-[#0f172a] hover:bg-slate-100 transition"
                              title="Attach file"
                            >
                              <Plus className="w-4 h-4 stroke-[2]" />
                            </button>

                            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100/80 text-[11px] font-medium text-[#334155]">
                              <span>⚖️ Indian Statutory Law</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={toggleListening}
                              disabled={!recognitionSupported || isGenerating}
                              aria-pressed={isListening}
                              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition shrink-0 disabled:opacity-40 ${
                                isListening
                                  ? "bg-red-50 text-red-600"
                                  : "text-[#64748b] hover:text-[#0f172a] hover:bg-slate-100"
                              }`}
                              title={isListening ? "Stop voice input" : "Start voice input"}
                            >
                              {isListening ? (
                                <Square className="w-3.5 h-3.5 stroke-[2]" />
                              ) : (
                                <Mic className="w-4 h-4 stroke-[2]" />
                              )}
                            </button>

                            <ChatInputSubmit className="w-8 h-8 sm:w-9 sm:h-9 bg-[#0f172a] text-white hover:bg-slate-800 transition disabled:bg-[#f1f5f9] disabled:text-[#94a3b8] flex items-center justify-center p-0" />
                          </div>
                        </div>
                      </ChatInput>
                    </motion.div>

                    {/* Suggestion Chips underneath centered input */}
                    <motion.div
                      exit={{ opacity: 0, y: 12, transition: { duration: 0.2 } }}
                      className="flex flex-wrap items-center justify-center gap-2 pt-4"
                    >
                      {SAMPLES.map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            setQuestion(s);
                            handleAsk(s);
                          }}
                          className="px-3.5 py-1 rounded-full text-xs font-medium border border-[#e2e8f0] text-[#334155] bg-white hover:bg-slate-50 hover:border-slate-300 transition shadow-2xs"
                        >
                          {s.length > 44 ? `${s.slice(0, 42)}…` : s}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setShowGuide(true);
                          setGuideCompleted(false);
                        }}
                        className="px-3.5 py-1 rounded-full text-xs font-medium border border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-50 transition flex items-center gap-1.5"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>Onboarding Guide</span>
                      </button>
                    </motion.div>

                    {/* Subtle disclaimer */}
                    <p className="text-center text-[11px] text-[#94a3b8] font-normal pt-4">
                      {LEGAL_DISCLAIMER}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Active Conversation Messages */}
          {messages.map((msg, idx) => {
            const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");

            // User message turn (right side bubble with JD avatar matching screenshot)
            if (msg.role === "user") {
              const isLatestUser = idx === lastUserIndex;
              return (
                <div
                  key={msg.id}
                  ref={isLatestUser ? latestTurnRef : null}
                  className="flex items-start justify-end gap-2.5 sm:gap-3 group pt-1 scroll-mt-3 sm:scroll-mt-4"
                >
                  <div className="flex flex-col items-end max-w-[86%] sm:max-w-lg">
                    <div className="bg-[#18181b] text-white rounded-2xl px-4 sm:px-5 py-2.5 text-sm shadow-xs font-normal break-words leading-relaxed">
                      {msg.content}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-[#94a3b8]">
                      <button
                        onClick={() => setInputText(msg.content)}
                        className="flex items-center gap-1 hover:text-gray-600"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleSendMessage(msg.content)}
                        className="flex items-center gap-1 hover:text-gray-600"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Resend</span>
                      </button>
                    </div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-[#0f172a] text-white font-bold text-xs flex items-center justify-center shrink-0">
                    JD
                  </div>
                </div>
              );
            }

            // Assistant message: Step loader state (Image 2)
            if (msg.status === "loading") {
              return (
                <div key={msg.id} className="flex items-start gap-3 pt-2">
                  <div className="w-8 h-8 rounded-full bg-[#0f172a] text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    AI
                  </div>
                  <div className="flex-1 max-w-[1080px] bg-white border border-[#e2e8f0] rounded-2xl p-5 shadow-xs">
                    {/* Top Bar */}
                    <div className="flex items-center justify-between pb-3">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-500 dot-1" />
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-500 dot-2" />
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-500 dot-3" />
                        </span>
                        <span className="text-xs font-medium text-[#334155]">
                          {currentStepIndex >= ANALYSIS_STEPS.length
                            ? "Evidence verified · Finalizing answer..."
                            : "IP-SAKTI is analyzing the legal evidence..."}
                        </span>
                      </div>
                      {currentStepIndex < ANALYSIS_STEPS.length && (
                        <button
                          onClick={stopGeneration}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#e2e8f0] text-xs text-[#475569] hover:bg-gray-50 transition"
                        >
                          <Square className="w-3 h-3" />
                          <span>Pause</span>
                        </button>
                      )}
                    </div>

                    {/* Inner Box: EVIDENCE-FIRST ANALYSIS */}
                    <div className="border border-[#e2e8f0] rounded-xl p-4 bg-white">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
                          EVIDENCE-FIRST ANALYSIS
                        </span>
                        <span className="text-xs text-[#94a3b8]">
                          Working securely
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {ANALYSIS_STEPS.map((stepText, idx) => {
                          const isDone = idx < currentStepIndex;
                          const isCurrent = idx === currentStepIndex;

                          return (
                            <div
                              key={stepText}
                              className="flex items-center gap-2.5 text-xs"
                            >
                              {isDone ? (
                                <Check className="w-4 h-4 text-emerald-500 stroke-[2.5]" />
                              ) : isCurrent ? (
                                <Loader2 className="w-4 h-4 text-gray-900 animate-spin stroke-[2]" />
                              ) : (
                                <div className="w-4 h-4 rounded-full border border-gray-300" />
                              )}
                              <span
                                className={`${isDone
                                  ? "text-gray-700"
                                  : isCurrent
                                    ? "text-gray-900 font-medium"
                                    : "text-gray-400"
                                  }`}
                              >
                                {stepText}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            if (msg.status === "error") {
              return (
                <div key={msg.id} className="flex items-start gap-3 pt-2">
                  <div className="w-8 h-8 rounded-full bg-[#0f172a] text-white font-bold text-xs flex items-center justify-center shrink-0">
                    AI
                  </div>
                  <div
                    role="alert"
                    className="flex-1 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
                  >
                    {msg.error}
                  </div>
                </div>
              );
            }

            // Assistant message: Completed Answer Card (matching screenshot 1 directly)
            const answerLanguage = languageByCode(
              msg.displayLanguageCode || "en",
            );
            return (
              <div
                key={msg.id}
                className="flex items-start gap-2.5 sm:gap-3 pt-2 scroll-mt-3 sm:scroll-mt-4"
              >
                <div className="w-8 h-8 rounded-full bg-[#0f172a] text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  AI
                </div>
                <div className="flex-1 min-w-0 max-w-[1080px] bg-white border border-[#e2e8f0] rounded-2xl p-4 sm:p-6 shadow-xs space-y-3.5 sm:space-y-4">
                  {/* Header: ANSWER & CONFIDENCE */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[#64748b]">
                      <Shield className="w-4 h-4 text-[#64748b] shrink-0" />
                      <span className="text-[11px] font-bold tracking-wider uppercase">
                        ANSWER · {answerLanguage.label}
                      </span>
                    </div>
                    {msg.confidence && (
                      <span className="px-2.5 sm:px-3 py-1 rounded-full text-[10px] font-bold tracking-wider bg-[#f1f5f9] text-[#334155] uppercase shrink-0">
                        CONFIDENCE: {msg.confidence}
                      </span>
                    )}
                  </div>

                  {/* Answer Prose - This text stays visible on screen */}
                  <p className="text-sm sm:text-[15px] leading-relaxed text-[#1e293b] font-normal break-words">
                    {msg.answer}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      {msg.jurisdiction !== undefined &&
                        msg.jurisdiction !== null && (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                            Jurisdiction: {String(msg.jurisdiction)}
                          </span>
                        )}
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                        Grounded · {msg.citations?.length || 0} citations validated
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleSpeech(msg)}
                      disabled={!speechSupported}
                      aria-pressed={isSpeakingMessageId === msg.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                    >
                      {isSpeakingMessageId === msg.id ? (
                        <Square className="h-3.5 w-3.5" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                      {isSpeakingMessageId === msg.id
                        ? "Stop audio"
                        : `Listen to answer · ${answerLanguage.label}`}
                    </button>
                  </div>

                  {/* Source Notice Banner */}
                  {msg.caution && (
                    <div className="bg-[#fffbeb] border border-[#fef3c7] rounded-xl p-3 sm:p-3.5 flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-[#d97706] shrink-0 mt-0.5" />
                      <div className="text-xs text-[#92400e] space-y-0.5">
                        <div className="font-semibold">
                          {msg.caution.title}
                        </div>
                        <div className="opacity-95">{msg.caution.detail}</div>
                      </div>
                    </div>
                  )}

                  {/* SOURCES section - Flows naturally below */}
                  {msg.evidence && msg.evidence.length > 0 && (
                    <div className="pt-2 border-t border-[#f1f5f9] space-y-2">
                      <div className="flex items-center gap-1.5 text-[#64748b]">
                        <FileText className="w-4 h-4" />
                        <span className="text-[11px] font-bold tracking-wider uppercase">
                          SOURCES
                        </span>
                      </div>

                      <div className="space-y-2">
                        {msg.evidence.map((src, sIdx) => (
                          <SourceItem
                            key={src.chunk_id || `${msg.id}-src-${sIdx}`}
                            src={src}
                            index={sIdx}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
                    {msg.disclaimer || LEGAL_DISCLAIMER}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── BOTTOM FLOATING INPUT DOCK (ONLY ON ACTIVE CHAT) ─────────────── */}
      <AnimatePresence>
        {(messages.length > 0 || isGenerating) && (
          <motion.div
            key="bottom-floating-dock"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.25 }}
            className="relative px-3 sm:px-6 py-2.5 sm:py-4 shrink-0"
          >
            {/* Frosted blur backdrop div behind chat input dock */}
            <div className="absolute inset-0 bg-white/70 backdrop-blur-xl border-t border-slate-200/50 -z-10 pointer-events-none" />

            <div className="max-w-[760px] mx-auto space-y-2 relative">
              {/* Soft blur glow div behind chat card */}
              <div className="absolute -inset-0.5 rounded-[26px] bg-slate-200/40 backdrop-blur-md -z-10 pointer-events-none" />

              {/* Rounded Input Container matching Hero layout */}
              <motion.div
                layoutId="unified-chat-card"
                transition={{ type: "spring", stiffness: 280, damping: 28 }}
                className="w-full"
              >
                <ChatInput
                  variant="unstyled"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onSubmit={() => handleSendMessage()}
                  loading={isGenerating}
                  onStop={stopGeneration}
                  className="relative border border-[#e2e8f0] bg-white/90 backdrop-blur-md rounded-[24px] shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-within:border-slate-400 focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.08)] transition-all p-3 sm:p-4 flex flex-col items-stretch"
                >
                  <div className="relative w-full">
                    <ChatInputTextArea
                      ref={textareaRef}
                      rows={2}
                      placeholder=""
                      onKeyDown={handleInputKeyDown}
                      className="w-full bg-transparent resize-none border-none outline-none text-sm sm:text-[15px] text-[#0f172a] leading-relaxed relative z-10 p-0 shadow-none focus-visible:ring-0"
                    />

                    {/* Animated Blur Text Placeholder Overlay (One-by-One Questions) */}
                    {!inputText && (
                      <div
                        onClick={applyPlaceholderText}
                        className="absolute inset-0 cursor-text z-0 flex items-start select-none overflow-hidden pr-4"
                      >
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={placeholderQuestionIndex}
                            initial={{ opacity: 0, filter: "blur(8px)", y: 4 }}
                            animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                            exit={{ opacity: 0, filter: "blur(8px)", y: -4 }}
                            transition={{ duration: 0.45, ease: "easeInOut" }}
                            className="text-sm sm:text-[15px] text-[#94a3b8] leading-relaxed flex flex-wrap items-center gap-x-1"
                          >
                            {DEMO_QUESTIONS[placeholderQuestionIndex].split(" ").map((word, wIdx) => (
                              <motion.span
                                key={`${placeholderQuestionIndex}-${wIdx}`}
                                initial={{ opacity: 0, filter: "blur(6px)" }}
                                animate={{ opacity: 1, filter: "blur(0px)" }}
                                transition={{
                                  duration: 0.25,
                                  delay: wIdx * 0.03,
                                  ease: "easeOut",
                                }}
                                className="inline-block"
                              >
                                {word}
                              </motion.span>
                            ))}
                            <span className="inline-flex items-center text-[10px] font-mono font-medium text-[#64748b] bg-slate-100/90 border border-slate-200/90 rounded px-1.5 py-0.5 ml-1 self-center shadow-2xs">
                              Tab ⇥
                            </span>
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between w-full pt-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[#64748b] hover:text-[#0f172a] hover:bg-slate-100 transition"
                        title="Attach file"
                      >
                        <Plus className="w-4 h-4 stroke-[2]" />
                      </button>

                      <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100/80 text-[11px] font-medium text-[#334155]">
                        <span>⚖️ Indian Statutory Law</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleListening}
                        disabled={!recognitionSupported || isGenerating}
                        aria-pressed={isListening}
                        className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition shrink-0 disabled:opacity-40 ${
                          isListening
                            ? "bg-red-50 text-red-600"
                            : "text-[#64748b] hover:text-[#0f172a] hover:bg-slate-100"
                        }`}
                        title={isListening ? "Stop voice input" : "Start voice input"}
                      >
                        {isListening ? (
                          <Square className="w-3.5 h-3.5 stroke-[2]" />
                        ) : (
                          <Mic className="w-4 h-4 stroke-[2]" />
                        )}
                      </button>

                      <ChatInputSubmit className="w-8 h-8 sm:w-9 sm:h-9 bg-[#0f172a] text-white hover:bg-slate-800 transition disabled:bg-[#f1f5f9] disabled:text-[#94a3b8] flex items-center justify-center p-0" />
                    </div>
                  </div>
                </ChatInput>
              </motion.div>

              {/* Disclaimer */}
              <p className="text-center text-[11px] text-[#94a3b8] font-normal pt-1">
                {LEGAL_DISCLAIMER}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── INTERACTIVE STEPPER POPUP MODAL (WITH SKIP OPTION) ──────────── */}
      <AnimatePresence>
        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowGuide(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            />

            {/* Modal Dialog Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-[#e2e8f0] z-10 overflow-hidden my-auto"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#f1f5f9] bg-white">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold">
                    ⚖️
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#0f172a] leading-none">
                      IP-SAKTI Quick Guide
                    </h3>
                    <p className="text-[11px] text-[#64748b] mt-0.5">
                      Citation-grounded statutory AI assistant
                    </p>
                  </div>
                </div>

                {/* Header Skip & Close actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowGuide(false);
                      setGuideCompleted(true);
                    }}
                    className="text-xs text-[#64748b] hover:text-[#0f172a] px-2.5 py-1 rounded-full border border-transparent hover:border-[#e2e8f0] hover:bg-slate-50 transition"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGuide(false)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[#64748b] hover:text-[#0f172a] hover:bg-slate-100 transition"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Stepper Component inside Modal */}
              <div className="p-2 sm:p-4">
                <Stepper
                  initialStep={1}
                  showSkipButton={true}
                  skipButtonText="Skip intro"
                  onSkip={() => {
                    setShowGuide(false);
                    setGuideCompleted(true);
                  }}
                  onFinalStepCompleted={() => {
                    setShowGuide(false);
                    setGuideCompleted(true);
                  }}
                  backButtonText="Previous"
                  nextButtonText="Continue"
                  stepCircleContainerClassName="!border-none !shadow-none !max-w-none"
                >
                  {/* Step 1: Overview & Grounding */}
                  <Step>
                    <div className="space-y-2.5">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                        ⚖️ Statutory AI
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-[#0f172a] tracking-tight">
                        Search Indian Statutory Law
                      </h2>
                      <p className="text-xs text-[#475569] leading-relaxed">
                        IP-SAKTI provides citation-grounded statutory intelligence across Patents, Trade Marks, Copyright &amp; Biodiversity law. Answers are published only after citation and grounding checks against the configured corpus.
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                        <div className="p-2.5 rounded-xl border border-[#e2e8f0] bg-slate-50/60">
                          <span className="font-bold text-[#0f172a] block text-[11px]">📜 4 Official Acts</span>
                          <span className="text-[10px] text-[#64748b]">Patents, Trade Marks, Copyright &amp; Biodiversity.</span>
                        </div>
                        <div className="p-2.5 rounded-xl border border-[#e2e8f0] bg-slate-50/60">
                          <span className="font-bold text-[#0f172a] block text-[11px]">🛡️ Verified or Silent</span>
                          <span className="text-[10px] text-[#64748b]">Requires statutory evidence or abstains safely.</span>
                        </div>
                      </div>
                    </div>
                  </Step>

                  {/* Step 2: Citations & Quick Start */}
                  <Step>
                    <div className="space-y-2.5">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[11px] font-semibold text-blue-700 uppercase tracking-wider">
                        🔍 Auditable Evidence
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-[#0f172a] tracking-tight">
                        Inspect Citations &amp; Try A Query
                      </h2>
                      <p className="text-xs text-[#475569] leading-relaxed">
                        Every answer links directly to official rules and gazette text. Pick a query to start:
                      </p>
                      <div className="space-y-1.5 pt-0.5">
                        {DEMO_QUESTIONS.slice(0, 3).map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => {
                              setInputText(q);
                              setShowGuide(false);
                              setGuideCompleted(true);
                              handleSendMessage(q);
                            }}
                            className="w-full text-left p-2 rounded-xl border border-[#e2e8f0] bg-white hover:bg-slate-50 hover:border-slate-300 transition text-xs text-[#0f172a] flex items-center justify-between group shadow-2xs"
                          >
                            <span className="font-medium truncate pr-2 text-[11px]">{q}</span>
                            <span className="text-[10px] text-blue-600 font-semibold group-hover:translate-x-0.5 transition-transform shrink-0">
                              Ask ➔
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </Step>
                </Stepper>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
