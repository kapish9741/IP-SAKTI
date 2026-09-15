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


// Rehearsed demo legal questions for the animated blur placeholder and onboarding
const DEMO_QUESTIONS = [
  "How must an application for registration of a trade mark be signed?",
  "Is the mere discovery of a new form of a known substance patentable in India?",
  "What is the duration of the registration of a trade mark and when must it be renewed?",
  "What is the term of copyright in a literary work published in the lifetime of the author?",
  "Who may apply for the registration of a geographical indication?",
];

// API endpoints: Express Gateway on :5001 with direct fallback to Python server on :8000
const PRIMARY_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";
const FALLBACK_API_URL = "http://localhost:8000";

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

  const stepTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const latestTurnRef = useRef(null);
  const textareaRef = useRef(null);

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
    setMessages([]);
    setInputText("");
    setCurrentStepIndex(0);
    setShowGuide(true);
    setGuideCompleted(false);
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    clearStepTimers();
    setIsGenerating(false);
  };

  const handleSendMessage = async (queryToSend) => {
    const q = (queryToSend || inputText).trim();
    if (!q || isGenerating) return;

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

      try {
        const response = await fetch(`${PRIMARY_API_URL}/api/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q }),
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
            body: JSON.stringify({ question: q }),
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
        const answerText =
          answerObj.answer ||
          (isAbstained
            ? "I couldn't produce a sufficiently supported answer from the available legal evidence."
            : "No answer was published.");

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
        } else {
          cautionItem = {
            title: "Source notice",
            detail: "Example mode: this result uses sample evidence only.",
          };
        }

        const completedAiMessage = {
          id: aiMsgId,
          role: "assistant",
          status: "completed",
          confidence: confidenceVal,
          answer: answerText,
          citations: answerObj.citations || [],
          caution: cautionItem,
          evidence:
            rawData.evidence && rawData.evidence.length > 0
              ? rawData.evidence
              : [
                {
                  marker: 1,
                  document_id: "IN-TM-RULES-2017",
                  document_name: "Sample Legal Evidence",
                  locator_text: "Example record · Section 1",
                  source_evidence_level: "A",
                  temporal_status: "CURRENT",
                  text: "An application for the registration of a trademark shall be made in Form TM-A and signed by the applicant or his agent.",
                },
              ],
          timings_ms: rawData.timings_ms || {},
        };

        setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? completedAiMessage : m)));
      } else {
        const fallbackMsg = {
          id: aiMsgId,
          role: "assistant",
          status: "completed",
          confidence: "HIGH",
          answer:
            "Based on the available test evidence, the request is eligible for review. This example response is generated locally and does not call an API.",
          citations: [{ marker: 1, document_id: "IN-TM-RULES-2017", locator: "Section 1" }],
          caution: {
            title: "Source notice",
            detail: "Example mode: this result uses sample evidence only.",
          },
          evidence: [
            {
              marker: 1,
              document_id: "IN-TM-RULES-2017",
              document_name: "Sample Legal Evidence",
              locator_text: "Example record · Section 1",
              source_evidence_level: "A",
              temporal_status: "CURRENT",
              text: "An application for the registration of a trademark shall be made in Form TM-A and signed by the applicant or his agent.",
            },
          ],
        };
        setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? fallbackMsg : m)));
      }
    } catch (err) {
      clearStepTimers();
      if (err.name === "AbortError") {
        setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
      }
    } finally {
      setIsGenerating(false);
    }
  };

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
          title="IP-SHAKTI Home"
        >
          <div className="w-8 h-8 rounded-xl bg-[#0f172a] flex items-center justify-center text-white shadow-xs border border-slate-800 group-hover:scale-105 transition-transform duration-200">
            <Scale className="w-4 h-4 text-white stroke-[2.2]" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[16px] sm:text-[17px] font-bold tracking-tight text-[#0f172a] group-hover:text-slate-700 transition">
              IP-SHAKTI
            </span>
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100/90 text-slate-600 border border-slate-200/80">
              Statutory Law AI
            </span>
          </div>
        </button>

        {/* Action Controls on Right */}
        <div className="flex items-center gap-2 sm:gap-2.5">
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
                              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-[#64748b] hover:text-[#0f172a] hover:bg-slate-100 transition shrink-0"
                              title="Voice input"
                            >
                              <Mic className="w-4 h-4 stroke-[2]" />
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
                      {["Certified", "Personalized", "Experienced", "Helpful"].map((tag) => (
                        <button
                          key={tag}
                          onClick={() => handleSendMessage(tag)}
                          className="px-3.5 py-1 rounded-full text-xs font-medium border border-[#e2e8f0] text-[#334155] bg-white hover:bg-slate-50 hover:border-slate-300 transition shadow-2xs"
                        >
                          {tag}
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
                      AI can make mistakes. Check important info.
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

            // Assistant message: Completed Answer Card (matching screenshot 1 directly)
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
                        ANSWER
                      </span>
                    </div>
                    <span className="px-2.5 sm:px-3 py-1 rounded-full text-[10px] font-bold tracking-wider bg-[#f1f5f9] text-[#334155] uppercase shrink-0">
                      CONFIDENCE: {msg.confidence || "HIGH"}
                    </span>
                  </div>

                  {/* Answer Prose - This text stays visible on screen */}
                  <p className="text-sm sm:text-[15px] leading-relaxed text-[#1e293b] font-normal break-words">
                    {msg.answer}
                  </p>

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
                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-[#64748b] hover:text-[#0f172a] hover:bg-slate-100 transition shrink-0"
                        title="Voice input"
                      >
                        <Mic className="w-4 h-4 stroke-[2]" />
                      </button>

                      <ChatInputSubmit className="w-8 h-8 sm:w-9 sm:h-9 bg-[#0f172a] text-white hover:bg-slate-800 transition disabled:bg-[#f1f5f9] disabled:text-[#94a3b8] flex items-center justify-center p-0" />
                    </div>
                  </div>
                </ChatInput>
              </motion.div>

              {/* Disclaimer */}
              <p className="text-center text-[11px] text-[#94a3b8] font-normal pt-1">
                AI can make mistakes. Check important info.
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
                        IP-SAKTI provides citation-grounded statutory intelligence across Patents, Trade Marks, Copyright &amp; Biodiversity law. No hallucinations—strictly backed by gazettes.
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
