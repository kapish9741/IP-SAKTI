"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  PlusIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  StopIcon,
  SpeakerLoudIcon,
  CheckIcon,
  UpdateIcon,
  DotsHorizontalIcon,
  ReloadIcon,
  Pencil1Icon,
  TrashIcon,
  GlobeIcon,
  BookmarkIcon,
  MagnifyingGlassIcon,
  Cross2Icon,
} from "@radix-ui/react-icons";
import {
  Loader2,
  Shield as ShieldIcon,
  Mic as MicrophoneIcon,
  Scale as BalanceIcon,
  Paperclip as PaperclipIcon,
  Lightbulb as LightbulbIcon,
  Search as SearchIcon,
  Zap as ZapIcon,
  Menu,
  Plus,
  Trash2,
  PanelLeft,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Stepper, { Step } from "../components/Stepper/Stepper";
import {
  ChatInput,
  ChatInputTextArea,
  ChatInputSubmit,
} from "../components/ui/chat-input";
import { Sidebar } from "../components/Sidebar";
import { BackgroundGradientAnimation } from "../components/ui/background-gradient-animation";
import { getUIText } from "../lib/i18n";
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

// API endpoints
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
    <div className="border border-[#e8edf3] rounded-2xl p-3 sm:p-4 bg-white/80 backdrop-blur-sm transition hover:border-slate-300">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 sm:gap-2.5 min-w-0">
          <span className="text-[11px] sm:text-xs font-bold text-[#334155] mt-0.5 shrink-0">
            [{marker}]
          </span>
          <div className="space-y-1 min-w-0">
            <h4 className="text-xs font-semibold text-[#0f172a] leading-tight break-words">
              {src.document_name || src.document_id}
            </h4>
            <p className="text-[10px] sm:text-[11px] text-[#64748b] break-words">
              {src.locator_text || "Example record · Section 1"}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#ecfdf5] text-[#047857] border border-[#a7f3d0] uppercase tracking-wide">
                Verified
              </span>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#f8fafc] text-[#475569] border border-[#e2e8f0] uppercase tracking-wide">
                Level {src.source_evidence_level || "A"}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-1 text-[11px] font-medium text-[#64748b] hover:text-[#0f172a] shrink-0 pt-0.5 transition"
        >
          <span>{isExpanded ? "Hide" : "View"}</span>
          {isExpanded ? (
            <ChevronUpIcon className="w-3.5 h-3.5" />
          ) : (
            <ChevronDownIcon className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-[#f1f5f9] text-xs text-gray-700 bg-gray-50/80 p-3 rounded-xl font-mono leading-relaxed max-h-60 overflow-y-auto">
          <p className="whitespace-pre-wrap break-words">{src.text}</p>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSidebarOpen(window.innerWidth >= 1024);
    }
  }, []);
  const [activeNavItem, setActiveNavItem] = useState("chat");
  const [chatSessions, setChatSessions] = useState([
    {
      id: "session-init-1",
      title: "Patentability of New Forms",
      messages: [],
      timestamp: Date.now() - 3600000,
    },
  ]);
  const [activeSessionId, setActiveSessionId] = useState(null);

  // Active chat messages
  const [messages, setMessages] = useState([]);

  const [inputText, setInputText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
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

  const uiText = getUIText(selectedLanguageCode);
  const selectedLanguage = languageByCode(selectedLanguageCode);
  const matchingVoices = voicesForLocale(
    availableVoices,
    selectedLanguage.speechLocale,
  );
  const activeQuestions = uiText.demoQuestions || DEMO_QUESTIONS;

  // Requirement 1: 1 second delay for Guide popup on startup
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowGuide(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Persist chat sessions in localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ipsakti_chat_sessions");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setChatSessions(parsed);
        }
      }
    } catch { }
  }, []);

  useEffect(() => {
    try {
      if (chatSessions && chatSessions.length > 0) {
        localStorage.setItem("ipsakti_chat_sessions", JSON.stringify(chatSessions));
      }
    } catch { }
  }, [chatSessions]);

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
        // Fallback
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
    if (inputText.trim()) return;
    const interval = setInterval(() => {
      setPlaceholderQuestionIndex(
        (prev) => (prev + 1) % (activeQuestions.length || 1),
      );
    }, 4500);
    return () => clearInterval(interval);
  }, [inputText, activeQuestions.length]);

  // Auto-fill active placeholder question on Tab key or placeholder click
  const applyPlaceholderText = () => {
    if (!inputText) {
      const activeQuestion = activeQuestions[placeholderQuestionIndex];
      if (activeQuestion) {
        setInputText(activeQuestion);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            try {
              textareaRef.current.setSelectionRange(
                activeQuestion.length,
                activeQuestion.length,
              );
            } catch (err) { }
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

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === "Tab" && !inputText && messages.length === 0 && !showGuide) {
        e.preventDefault();
        applyPlaceholderText();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [inputText, messages.length, showGuide, placeholderQuestionIndex, activeQuestions]);

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
    setActiveSessionId(null);
    setIsListening(false);
    setIsSpeakingMessageId(null);
    setInterimTranscript("");
    setTranslationNotice("");
    setVoiceMessage("");
  };

  const handleSelectSession = (sessionId) => {
    const session = chatSessions.find((s) => s.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setMessages(session.messages || []);
    setInputText("");
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const handleDeleteSession = (sessionId) => {
    setChatSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      handleStartNewChat();
    }
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

    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      currentSessionId = `session-${Date.now()}`;
      setActiveSessionId(currentSessionId);
      const newSession = {
        id: currentSessionId,
        title: q.slice(0, 32).trim() + (q.length > 32 ? "..." : ""),
        messages: [],
        timestamp: Date.now(),
      };
      setChatSessions((prev) => [newSession, ...prev]);

      // Call backend Groq AI to generate concise 3-5 word chat title
      fetch("/api/chat-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.title) {
            setChatSessions((prev) =>
              prev.map((s) =>
                s.id === currentSessionId ? { ...s, title: data.title } : s,
              ),
            );
          }
        })
        .catch(() => { });
    }

    const requestLanguage = selectedLanguage;

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
    setChatSessions((prev) =>
      prev.map((s) =>
        s.id === currentSessionId
          ? { ...s, messages: [...(s.messages || []), userMessage] }
          : s,
      ),
    );

    setIsGenerating(true);
    setCurrentStepIndex(0);
    setTranslationNotice("");

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
          (rawData.status === "ANSWERED" || rawData.status === "ABSTAINED") &&
          requestLanguage.code !== "en" &&
          originalAnswerText
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

        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? completedAiMessage : m)),
        );
        setChatSessions((prev) =>
          prev.map((s) =>
            s.id === currentSessionId
              ? {
                ...s,
                messages: (s.messages || []).map((m) =>
                  m.id === aiMsgId ? completedAiMessage : m,
                ),
              }
              : s,
          ),
        );
      } else {
        const errorMsg = {
          id: aiMsgId,
          role: "assistant",
          status: "error",
          error:
            "IP-SAKTI could not complete that request. Check that the RAG service is running and try again.",
        };
        setMessages((prev) =>
          prev.map((message) => (message.id === aiMsgId ? errorMsg : message)),
        );
        setChatSessions((prev) =>
          prev.map((s) =>
            s.id === currentSessionId
              ? {
                ...s,
                messages: (s.messages || []).map((m) =>
                  m.id === aiMsgId ? errorMsg : m,
                ),
              }
              : s,
          ),
        );
      }
    } catch (err) {
      clearStepTimers();
      if (err.name === "AbortError") {
        setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
        setChatSessions((prev) =>
          prev.map((s) =>
            s.id === currentSessionId
              ? {
                ...s,
                messages: (s.messages || []).filter((m) => m.id !== aiMsgId),
              }
              : s,
          ),
        );
      } else {
        const errorMsg = {
          id: aiMsgId,
          role: "assistant",
          status: "error",
          error:
            "IP-SAKTI could not complete that request. Check that the RAG service is running and try again.",
        };
        setMessages((prev) =>
          prev.map((message) => (message.id === aiMsgId ? errorMsg : message)),
        );
        setChatSessions((prev) =>
          prev.map((s) =>
            s.id === currentSessionId
              ? {
                ...s,
                messages: (s.messages || []).map((m) =>
                  m.id === aiMsgId ? errorMsg : m,
                ),
              }
              : s,
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
    <div className="flex h-screen h-[100dvh] w-screen overflow-hidden text-[#0f172a] relative bg-[#f8faf9]">
      {/* ─── SHADCN.IO ANIMATED GREEN GRADIENT BACKGROUND (BRIGHT LOBES) ── */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-30">
        <BackgroundGradientAnimation
          gradientBackgroundStart="rgb(255, 255, 255)"
          gradientBackgroundEnd="rgb(240, 253, 245)"
          firstColor="34, 197, 94"
          secondColor="16, 185, 129"
          thirdColor="74, 222, 128"
          fourthColor="52, 211, 153"
          fifthColor="20, 184, 166"
          pointerColor="34, 197, 94"
          size="90%"
        />
      </div>

      {/* ─── LEFT SIDEBAR (LIGHT THEME & CHAT HISTORY) ───────────────── */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        uiText={uiText}
        activeItem={activeNavItem}
        onSelectItem={(id) => {
          setActiveNavItem(id);
          if (typeof window !== "undefined" && window.innerWidth < 1024) {
            setSidebarOpen(false);
          }
        }}
        onOpenTutorial={() => {
          setShowGuide(true);
          if (typeof window !== "undefined" && window.innerWidth < 1024) {
            setSidebarOpen(false);
          }
        }}
        chatSessions={chatSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleStartNewChat}
        onDeleteSession={handleDeleteSession}
      />

      {/* ─── MAIN CHAT WORKSPACE ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-full min-w-0 relative z-10 overflow-hidden">
        {/* Smooth Animated Sidebar Toggle Button (ChatGPT style) */}
        <AnimatePresence>
          {!sidebarOpen && (
            <motion.button
              key="sidebar-toggle-open-btn"
              initial={{ opacity: 0, scale: 0.85, x: -8 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.85, x: -8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="absolute top-3.5 left-3.5 sm:top-4 sm:left-4 z-40 p-2 rounded-xl glass-pill text-slate-600 hover:text-slate-900 hover:bg-white/80 transition-all duration-200 flex items-center justify-center shadow-xs group cursor-pointer active:scale-95"
              title="Open sidebar"
              aria-label="Open sidebar"
            >
              <PanelLeft className="w-5 h-5 text-slate-600 group-hover:text-slate-900 transition-transform duration-200 group-hover:scale-105" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Voice/Translation Status Notice Banner */}
        {(voiceMessage || translationNotice || interimTranscript || isListening) && (
          <div className="px-3 pt-2 shrink-0">
            <div
              className={`mx-auto max-w-[960px] rounded-xl border px-3 py-1.5 text-[11px] ${voiceMessage || translationNotice
                ? "border-amber-200 bg-amber-50/90 text-amber-800"
                : isListening
                  ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
                  : "border-slate-200 bg-white/80 text-slate-500"
                }`}
              aria-live="polite"
            >
              {translationNotice ||
                voiceMessage ||
                interimTranscript ||
                (isListening ? `Listening in ${selectedLanguage.label}…` : "")}
            </div>
          </div>
        )}

        {/* ─── MAIN CHAT CANVAS ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-2.5 sm:px-8 md:px-12 py-4 sm:py-6 space-y-4 sm:space-y-6 scroll-smooth scroll-pt-4 sm:scroll-pt-6 hero-gradient-bg flex flex-col">
          <div className="max-w-[760px] mx-auto space-y-4 sm:space-y-6 w-full flex-1 flex flex-col justify-center">

            {/* ─── HERO EMPTY STATE ─────────────────────────────────────────── */}
            <AnimatePresence mode="wait">
              {messages.length === 0 && !isGenerating && (
                <motion.div
                  key="hero-empty-state"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.2 } }}
                  className="flex flex-col items-center justify-center flex-1 my-auto min-h-[calc(100dvh-56px-2rem)] sm:min-h-[calc(100dvh-64px-3rem)] text-center px-3 sm:px-2 py-4 sm:py-6"
                >
                  <div className="w-full max-w-[720px] space-y-6 sm:space-y-7">

                    {/* Headline */}
                    <motion.div
                      exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                      transition={{ duration: 0.25 }}
                      className="space-y-2 sm:space-y-3"
                    >
                      <h1 className="text-[26px] leading-[1.15] sm:text-4xl md:text-5xl font-normal text-slate-700 tracking-tight">
                        {uiText.namaste},{" "}<span className="font-bold text-[#0f172a]">{uiText.readyToNavigate}</span>
                      </h1>
                      <h2 className="text-[26px] leading-[1.15] sm:text-4xl md:text-5xl font-bold text-[#0f172a] tracking-tight">
                        {uiText.indianIpStatutoryLaw}
                      </h2>
                      <p className="text-[12px] sm:text-sm text-slate-600 max-w-md mx-auto pt-1.5 font-normal px-1">
                        {uiText.statutoryIntelligenceDesc}
                      </p>
                    </motion.div>

                    {/* Main Floating Glass Input Card */}
                    <div className="text-left w-full relative">
                      <motion.div
                        layoutId="unified-chat-card"
                        transition={{ type: "spring", stiffness: 280, damping: 28 }}
                        className="w-full relative z-10"
                      >
                        <ChatInput
                          variant="unstyled"
                          value={inputText}
                          onChange={(e) => setInputText(e.target.value)}
                          onSubmit={() => handleSendMessage()}
                          loading={isGenerating}
                          onStop={stopGeneration}
                          className="glass-card-30 p-3.5 sm:p-5 flex flex-col items-stretch transition-all"
                        >
                          {/* Input Area */}
                          <div className="relative w-full px-0.5 min-h-[48px] sm:min-h-[56px]">
                            <ChatInputTextArea
                              ref={textareaRef}
                              rows={2}
                              placeholder=""
                              onKeyDown={handleInputKeyDown}
                              className="w-full bg-transparent resize-none border-none outline-none text-xs sm:text-base text-[#0f172a] leading-relaxed relative z-10 p-0 shadow-none focus-visible:ring-0"
                            />

                            {/* Animated Blur Text Placeholder Overlay */}
                            {!inputText && (
                              <div
                                className="pointer-events-none absolute inset-0 flex items-start select-none overflow-hidden pr-2 sm:pr-4"
                              >
                                <AnimatePresence mode="wait">
                                  <motion.div
                                    key={placeholderQuestionIndex}
                                    initial={{ opacity: 0, filter: "blur(8px)", y: 4 }}
                                    animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                                    exit={{ opacity: 0, filter: "blur(8px)", y: -4 }}
                                    transition={{ duration: 0.45, ease: "easeInOut" }}
                                    className="text-xs sm:text-sm text-slate-400 leading-normal sm:leading-relaxed flex flex-wrap items-center gap-x-1"
                                  >
                                    <ZapIcon className="w-3.5 h-3.5 text-emerald-500 inline mr-0.5 shrink-0" />
                                    {(activeQuestions[placeholderQuestionIndex % activeQuestions.length] || DEMO_QUESTIONS[0]).split(" ").map((word, wIdx) => (
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
                                    <span className="hidden sm:inline-flex items-center text-[10px] font-mono font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 ml-1.5 self-center shadow-2xs">
                                      Tab ⇥
                                    </span>
                                  </motion.div>
                                </AnimatePresence>
                              </div>
                            )}
                          </div>

                          {/* Bottom Toolbar inside Card */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 sm:pt-3 border-t border-slate-100/90 mt-2">
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              {/* Language Select Option */}
                              <div className="flex items-center gap-1.5 px-2.5 py-1 sm:py-1.5 rounded-full bg-slate-100/90 border border-slate-200/70 text-[11px] sm:text-xs text-slate-700 hover:bg-slate-100 transition shadow-2xs">
                                <GlobeIcon className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span className="text-slate-500 font-normal hidden sm:inline">Language:</span>
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
                                  className="bg-transparent border-none outline-none font-medium text-slate-800 cursor-pointer text-[11px] sm:text-xs focus:ring-0 pr-1 py-0.5"
                                  aria-label="Select Language"
                                >
                                  {LANGUAGES.map((language) => (
                                    <option key={language.code} value={language.code} className="text-slate-800 bg-white">
                                      {language.label} · {language.nativeLabel}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* Voice Select Option */}
                              <div className="flex items-center gap-1.5 px-2.5 py-1 sm:py-1.5 rounded-full bg-slate-100/90 border border-slate-200/70 text-[11px] sm:text-xs text-slate-700 hover:bg-slate-100 transition shadow-2xs">
                                <SpeakerLoudIcon className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span className="text-slate-500 font-normal hidden sm:inline">Voice:</span>
                                <select
                                  value={selectedVoiceURI}
                                  onChange={(event) => setSelectedVoiceURI(event.target.value)}
                                  disabled={isGenerating || !speechSupported || matchingVoices.length === 0}
                                  className="bg-transparent border-none outline-none font-medium text-slate-800 cursor-pointer text-[11px] sm:text-xs focus:ring-0 max-w-[130px] sm:max-w-[170px] truncate pr-1 py-0.5 disabled:opacity-50"
                                  aria-label="Select Voice"
                                >
                                  {matchingVoices.length === 0 ? (
                                    <option value="" className="text-slate-800 bg-white">
                                      Default Voice
                                    </option>
                                  ) : (
                                    <>
                                      <option value="" className="text-slate-800 bg-white">
                                        Default ({selectedLanguage.label})
                                      </option>
                                      {matchingVoices.map((voice) => (
                                        <option key={voice.voiceURI} value={voice.voiceURI} className="text-slate-800 bg-white">
                                          {voice.name}
                                        </option>
                                      ))}
                                    </>
                                  )}
                                </select>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={toggleListening}
                                disabled={!recognitionSupported || isGenerating}
                                aria-pressed={isListening}
                                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition shrink-0 disabled:opacity-40 shadow-2xs ${isListening
                                  ? "bg-red-500 text-white"
                                  : "bg-emerald-600/90 hover:bg-emerald-600 text-white"
                                  }`}
                                title={isListening ? "Stop voice input" : "Start voice input"}
                              >
                                {isListening ? (
                                  <StopIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                ) : (
                                  <MicrophoneIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                )}
                              </button>

                              <ChatInputSubmit className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:bg-slate-200 disabled:text-slate-400 flex items-center justify-center p-0 shadow-sm" />
                            </div>
                          </div>
                        </ChatInput>
                      </motion.div>

                      {/* Legal Question Chips Below Card */}
                      <motion.div
                        exit={{ opacity: 0, y: 12, transition: { duration: 0.2 } }}
                        className="pt-3 sm:pt-5 px-0 space-y-3 sm:space-y-3.5"
                      >
                        {/* Most Popular Questions Pill */}
                        <div className="flex items-center justify-center">
                          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-[30px] glass-pill shadow-xs">
                            <span className="text-[11px] sm:text-xs font-semibold text-slate-700 tracking-tight">
                              {uiText.suggestedInquiries}
                            </span>
                          </div>
                        </div>

                        {/* Mobile: full-width stacked list */}
                        <div className="flex flex-col gap-2 sm:hidden">
                          {activeQuestions.slice(0, 4).map((s) => (
                            <button
                              key={s}
                              onClick={() => {
                                setInputText(s);
                                handleSendMessage(s);
                              }}
                              className="w-full text-left flex items-center gap-2.5 px-4 py-3 rounded-[24px] text-[12px] font-medium text-slate-700 glass-pill active:scale-[0.98] transition-all shadow-xs leading-snug"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-px" />
                              {s}
                            </button>
                          ))}
                        </div>
                        {/* Desktop: horizontal wrap pills */}
                        <div className="hidden sm:flex flex-wrap items-center justify-center gap-2">
                          {activeQuestions.slice(0, 4).map((s) => (
                            <button
                              key={s}
                              onClick={() => {
                                setInputText(s);
                                handleSendMessage(s);
                              }}
                              className="px-4 py-1.5 rounded-[30px] text-xs font-medium text-slate-700 glass-pill transition shadow-xs max-w-[92vw] truncate"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ─── ACTIVE MESSAGES LIST ─────────────────────────────────────── */}
            {messages.map((msg, idx) => {
              const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");

              if (msg.role === "user") {
                const isLatestUser = idx === lastUserIndex;
                return (
                  <div
                    key={msg.id}
                    ref={isLatestUser ? latestTurnRef : null}
                    className="flex items-start justify-end gap-2 sm:gap-3 group pt-1 scroll-mt-4"
                  >
                    <div className="flex flex-col items-end max-w-[90%] sm:max-w-lg">
                      <div className="bg-[#0b0f19] text-white rounded-2xl sm:rounded-3xl px-3.5 sm:px-5 py-2.5 sm:py-3 text-xs sm:text-sm shadow-sm font-normal break-words leading-relaxed">
                        {msg.content}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
                        <button
                          onClick={() => setInputText(msg.content)}
                          className="flex items-center gap-1 hover:text-slate-600 transition"
                        >
                          <Pencil1Icon className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => handleSendMessage(msg.content)}
                          className="flex items-center gap-1 hover:text-slate-600 transition"
                        >
                          <ReloadIcon className="w-3 h-3" />
                          <span>Resend</span>
                        </button>
                      </div>
                    </div>
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-tr from-emerald-600 to-green-600 text-white font-semibold text-xs flex items-center justify-center shrink-0 shadow-2xs">
                      S
                    </div>
                  </div>
                );
              }

              if (msg.status === "loading") {
                return (
                  <div key={msg.id} className="flex items-start gap-2.5 sm:gap-3 pt-2">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border border-slate-200/80 p-0.5 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs overflow-hidden">
                      <img src="/ipsakti_logo.png" alt="IP SAKTI Sahayak" className="w-full h-full object-contain" />
                    </div>
                    <div className="flex-1 max-w-[1080px] bg-white/95 border border-slate-200/80 rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 shadow-sm">
                      <div className="flex items-center justify-between pb-3">
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dot-1" />
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dot-2" />
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dot-3" />
                          </span>
                          <span className="text-[11px] sm:text-xs font-medium text-slate-600">
                            {currentStepIndex >= ANALYSIS_STEPS.length
                              ? "Evidence verified · Finalizing answer..."
                              : "Analyzing legal evidence..."}
                          </span>
                        </div>
                        {currentStepIndex < ANALYSIS_STEPS.length && (
                          <button
                            onClick={stopGeneration}
                            className="flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full border border-slate-200 text-[11px] text-slate-500 hover:bg-slate-50 transition"
                          >
                            <StopIcon className="w-3 h-3" />
                            <span>Stop</span>
                          </button>
                        )}
                      </div>

                      <div className="border border-slate-100 rounded-2xl p-3 sm:p-4 bg-slate-50/50">
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-[9px] sm:text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                            Evidence Analysis
                          </span>
                          <span className="text-[9px] sm:text-[10px] text-slate-400">
                            Secure
                          </span>
                        </div>

                        <div className="space-y-2">
                          {ANALYSIS_STEPS.map((stepText, idx) => {
                            const isDone = idx < currentStepIndex;
                            const isCurrent = idx === currentStepIndex;

                            return (
                              <div
                                key={stepText}
                                className="flex items-center gap-2 text-xs"
                              >
                                {isDone ? (
                                  <CheckIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                ) : isCurrent ? (
                                  <Loader2 className="w-3.5 h-3.5 text-emerald-600 animate-spin shrink-0" />
                                ) : (
                                  <div className="w-3.5 h-3.5 rounded-full border border-slate-200 shrink-0" />
                                )}
                                <span
                                  className={`${isDone
                                    ? "text-slate-500"
                                    : isCurrent
                                      ? "text-slate-800 font-medium"
                                      : "text-slate-300"
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
                  <div key={msg.id} className="flex items-start gap-2.5 sm:gap-3 pt-2">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border border-slate-200/80 p-0.5 flex items-center justify-center shrink-0 shadow-2xs overflow-hidden">
                      <img src="/ipsakti_logo.png" alt="IP SAKTI Sahayak" className="w-full h-full object-contain" />
                    </div>
                    <div
                      role="alert"
                      className="flex-1 rounded-2xl border border-red-100 bg-red-50/80 p-3.5 sm:p-4 text-xs sm:text-sm text-red-700"
                    >
                      {msg.error}
                    </div>
                  </div>
                );
              }

              const answerLanguage = languageByCode(
                msg.displayLanguageCode || "en",
              );
              return (
                <div
                  key={msg.id}
                  className="flex items-start gap-2.5 sm:gap-3 pt-2 scroll-mt-4"
                >
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border border-slate-200/80 p-0.5 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs overflow-hidden">
                    <img src="/ipsakti_logo.png" alt="IP SAKTI Sahayak" className="w-full h-full object-contain" />
                  </div>
                  <div className="flex-1 min-w-0 max-w-[1080px] bg-white/95 border border-slate-200/80 rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 shadow-sm space-y-3.5 sm:space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <ShieldIcon className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="text-[9px] sm:text-[10px] font-semibold tracking-widest uppercase">
                          Answer · {answerLanguage.label}
                        </span>
                      </div>
                      {msg.confidence && (
                        <span className="px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold tracking-wide bg-slate-100 text-slate-600 border border-slate-200/60 uppercase shrink-0">
                          {msg.confidence}
                        </span>
                      )}
                    </div>

                    <p className="text-xs sm:text-[15px] leading-relaxed text-slate-800 font-normal break-words">
                      {msg.answer}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 sm:pt-3">
                      <div className="flex flex-wrap gap-1.5 text-[9px] sm:text-[10px] font-medium text-slate-500">
                        {msg.jurisdiction !== undefined &&
                          msg.jurisdiction !== null && (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 sm:py-1">
                              {String(msg.jurisdiction)}
                            </span>
                          )}
                        <span className="rounded-full border border-emerald-200/60 bg-emerald-50/80 px-2.5 py-0.5 sm:py-1 text-emerald-700">
                          {msg.citations?.length || 0} citations validated
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSpeech(msg)}
                        disabled={!speechSupported}
                        aria-pressed={isSpeakingMessageId === msg.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                      >
                        {isSpeakingMessageId === msg.id ? (
                          <StopIcon className="h-3.5 w-3.5" />
                        ) : (
                          <SpeakerLoudIcon className="h-3.5 w-3.5 text-emerald-600" />
                        )}
                        {isSpeakingMessageId === msg.id
                          ? "Stop audio"
                          : `Listen · ${answerLanguage.label}`}
                      </button>
                    </div>

                    {msg.caution && (
                      <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 sm:p-3.5 flex items-start gap-2.5">
                        <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-800 space-y-0.5">
                          <div className="font-semibold">
                            {msg.caution.title}
                          </div>
                          <div className="opacity-90">{msg.caution.detail}</div>
                        </div>
                      </div>
                    )}

                    {msg.evidence && msg.evidence.length > 0 && (
                      <div className="pt-2 border-t border-slate-100 space-y-2">
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <FileTextIcon className="w-3.5 h-3.5" />
                          <span className="text-[9px] sm:text-[10px] font-semibold tracking-widest uppercase">
                            Sources
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

                    <p className="border-t border-slate-100 pt-2.5 sm:pt-3 text-[10px] sm:text-[11px] leading-relaxed text-slate-400">
                      {msg.disclaimer || LEGAL_DISCLAIMER}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── BOTTOM FLOATING INPUT DOCK ──────────────────────────────────── */}
        <AnimatePresence>
          {(messages.length > 0 || isGenerating) && (
            <motion.div
              key="bottom-floating-dock"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.25 }}
              className="relative px-3 sm:px-8 py-2.5 sm:py-3 shrink-0 z-20 bg-transparent"
            >
              <div className="max-w-[760px] mx-auto space-y-2 relative">
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
                    className="glass-card-30 p-3 sm:p-4 flex flex-col items-stretch"
                  >
                    <div className="relative w-full">
                      <ChatInputTextArea
                        ref={textareaRef}
                        rows={2}
                        placeholder=""
                        onKeyDown={handleInputKeyDown}
                        className="w-full bg-transparent resize-none border-none outline-none text-xs sm:text-base text-slate-800 leading-relaxed relative z-10 p-0 shadow-none focus-visible:ring-0"
                      />

                      {!inputText && (
                        <div
                          className="pointer-events-none absolute inset-0 flex items-start select-none overflow-hidden pr-2 sm:pr-4"
                        >
                          <AnimatePresence mode="wait">
                            <motion.div
                              key={placeholderQuestionIndex}
                              initial={{ opacity: 0, filter: "blur(8px)", y: 4 }}
                              animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                              exit={{ opacity: 0, filter: "blur(8px)", y: -4 }}
                              transition={{ duration: 0.45, ease: "easeInOut" }}
                              className="text-xs sm:text-sm text-slate-400 leading-normal sm:leading-relaxed flex flex-wrap items-center gap-x-1"
                            >
                              {(activeQuestions[placeholderQuestionIndex % activeQuestions.length] || DEMO_QUESTIONS[0]).split(" ").map((word, wIdx) => (
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
                              <span className="hidden sm:inline-flex items-center text-[10px] font-mono font-medium text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 ml-1 self-center">
                                Tab ⇥
                              </span>
                            </motion.div>
                          </AnimatePresence>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between w-full pt-2 sm:pt-2.5 border-t border-slate-100 mt-2 gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <div className="flex items-center gap-1 px-2 py-0.5 sm:py-1 rounded-full bg-slate-100/90 border border-slate-200/70 text-[11px] text-slate-700">
                          <GlobeIcon className="w-3 h-3 text-emerald-600 shrink-0" />
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
                            className="bg-transparent border-none outline-none font-medium text-slate-800 cursor-pointer text-[11px] focus:ring-0 pr-1 py-0"
                            aria-label="Select Language"
                          >
                            {LANGUAGES.map((language) => (
                              <option key={language.code} value={language.code} className="text-slate-800 bg-white">
                                {language.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center gap-1 px-2 py-0.5 sm:py-1 rounded-full bg-slate-100/90 border border-slate-200/70 text-[11px] text-slate-700">
                          <SpeakerLoudIcon className="w-3 h-3 text-emerald-600 shrink-0" />
                          <select
                            value={selectedVoiceURI}
                            onChange={(event) => setSelectedVoiceURI(event.target.value)}
                            disabled={isGenerating || !speechSupported || matchingVoices.length === 0}
                            className="bg-transparent border-none outline-none font-medium text-slate-800 cursor-pointer text-[11px] focus:ring-0 max-w-[110px] sm:max-w-[140px] truncate pr-1 py-0 disabled:opacity-50"
                            aria-label="Select Voice"
                          >
                            {matchingVoices.length === 0 ? (
                              <option value="" className="text-slate-800 bg-white">
                                Default Voice
                              </option>
                            ) : (
                              <>
                                <option value="" className="text-slate-800 bg-white">
                                  Default
                                </option>
                                {matchingVoices.map((voice) => (
                                  <option key={voice.voiceURI} value={voice.voiceURI} className="text-slate-800 bg-white">
                                    {voice.name}
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <button
                          type="button"
                          onClick={toggleListening}
                          disabled={!recognitionSupported || isGenerating}
                          aria-pressed={isListening}
                          className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition shrink-0 disabled:opacity-40 ${isListening
                            ? "bg-red-500 text-white"
                            : "text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-transparent"
                            }`}
                          title={isListening ? "Stop voice input" : "Start voice input"}
                        >
                          {isListening ? (
                            <StopIcon className="w-3.5 h-3.5" />
                          ) : (
                            <MicrophoneIcon className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <ChatInputSubmit className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:bg-slate-100 disabled:text-slate-300 flex items-center justify-center p-0 shadow-2xs" />
                      </div>
                    </div>
                  </ChatInput>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── INTERACTIVE STEPPER POPUP MODAL ─────────────────────────────── */}
        <AnimatePresence>
          {showGuide && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowGuide(false)}
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
              />

              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="relative w-full max-w-2xl bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 z-10 overflow-hidden my-auto"
              >
                <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 bg-white">
                  <div className="flex items-center gap-2.5">
                    <div>
                      <h3 className="text-xs sm:text-sm font-semibold text-slate-900 leading-none">
                        {uiText.tutorialTitle}
                      </h3>
                      <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">
                        {uiText.tutorialSubtitle}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowGuide(false);
                        setGuideCompleted(true);
                      }}
                      className="text-xs text-slate-400 hover:text-slate-700 px-2.5 py-1 rounded-full border border-transparent hover:border-slate-200 hover:bg-slate-50 transition"
                    >
                      {uiText.skipIntro || "Skip"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowGuide(false)}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                      title="Close"
                    >
                      <Cross2Icon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="p-2 sm:p-4">
                  <Stepper
                    initialStep={1}
                    showSkipButton={true}
                    skipButtonText={uiText.skipIntro}
                    onSkip={() => {
                      setShowGuide(false);
                      setGuideCompleted(true);
                    }}
                    onFinalStepCompleted={() => {
                      setShowGuide(false);
                      setGuideCompleted(true);
                    }}
                    backButtonText={uiText.previous}
                    nextButtonText={uiText.continue}
                    stepCircleContainerClassName="!border-none !shadow-none !max-w-none"
                  >
                    <Step>
                      <div className="space-y-3">
                        <h2 className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
                          Search Indian Statutory Law
                        </h2>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          IP-SAKTI provides citation-grounded statutory intelligence across Patents, Trade Marks, Copyright &amp; Biodiversity law. Answers are published only after citation and grounding checks against the configured corpus.
                        </p>
                        <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                          <div className="p-3 rounded-2xl border border-slate-200/80 bg-slate-50/60">
                            <div className="flex items-center gap-1.5 mb-1">
                              <BookmarkIcon className="w-3 h-3 text-emerald-600" />
                              <span className="font-semibold text-slate-800 text-[11px]">4 Official Acts</span>
                            </div>
                            <span className="text-[10px] text-slate-400">Patents, Trade Marks, Copyright &amp; Biodiversity.</span>
                          </div>
                          <div className="p-3 rounded-2xl border border-slate-200/80 bg-slate-50/60">
                            <div className="flex items-center gap-1.5 mb-1">
                              <ShieldIcon className="w-3 h-3 text-emerald-600" />
                              <span className="font-semibold text-slate-800 text-[11px]">Verified or Silent</span>
                            </div>
                            <span className="text-[10px] text-slate-400">Requires statutory evidence or abstains safely.</span>
                          </div>
                        </div>
                      </div>
                    </Step>

                    <Step>
                      <div className="space-y-3">
                        <h2 className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
                          Inspect Citations &amp; Try A Query
                        </h2>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Every answer links directly to official rules and gazette text. Pick a query to start:
                        </p>
                        <div className="space-y-1.5 pt-0.5">
                          {activeQuestions.slice(0, 3).map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => {
                                setInputText(q);
                                setShowGuide(false);
                                setGuideCompleted(true);
                                handleSendMessage(q);
                              }}
                              className="w-full text-left p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-emerald-50/50 hover:border-emerald-200 transition text-xs text-slate-800 flex items-center justify-between group"
                            >
                              <span className="font-medium truncate pr-2 text-[11px]">{q}</span>
                              <span className="text-[10px] text-emerald-600 font-semibold group-hover:translate-x-0.5 transition-all shrink-0">
                                Ask →
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
    </div>
  );
}
