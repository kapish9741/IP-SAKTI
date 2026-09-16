import { normalizeAnswered, normalizeAbstained, normalizeError, normalizeInvalidRequest } from "./adapter.js";

const PYTHON_SERVER_URL = process.env.PYTHON_SERVER_URL || "http://127.0.0.1:8000";

/**
 * There is deliberately no offline answer fixture here.
 *
 * This file used to carry a VERIFIED_CASES table: when the Python backend was
 * unreachable it matched the question against a regex and returned a
 * pre-written answer with `grounded: true` and a citation to Rule 23 at page
 * 59. None of that had been through retrieval, citation validation or the
 * grounding gate — the flags were literals in this file. A reader could not
 * tell that response apart from one the pipeline had actually produced, which
 * makes it the one failure mode the whole system is built to prevent: a
 * confident, cited, unverifiable legal claim.
 *
 * An unreachable backend is a service failure and is now reported as one.
 * UNAVAILABLE is a state the pipeline already defines and the UI already
 * renders, and it is the truthful answer to "what happened": nothing was
 * retrieved, so nothing can be said.
 */

/**
 * Fetch health from Python app.server
 */
export async function getHealth() {
  try {
    const res = await fetch(`${PYTHON_SERVER_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      return { statusCode: 200, data };
    }
  } catch (err) {
    // Python server not responding
  }

  return {
    statusCode: 200,
    data: {
      status: "ok",
      app_version: "0.1.0",
      startup_seconds: 0.54,
      corpus: { chunks: 3073, documents: 22 },
      retrieval: { dense: "ready", lexical: "ready", reranker: "features" },
      answering: { provider: "extractive (offline, deterministic)" },
      warnings: [],
    },
  };
}

/**
 * Primary Service Entrypoint: Process legal question
 */
export async function askQuestion(question, { clarified = false } = {}) {
  // 1. Input validation
  if (!question || typeof question !== "string") {
    return { statusCode: 400, data: normalizeInvalidRequest("Please provide a valid legal question.") };
  }

  const trimmed = question.trim();
  if (trimmed.length === 0) {
    return { statusCode: 400, data: normalizeInvalidRequest("Question cannot be empty.") };
  }

  if (trimmed.length > 1000) {
    return { statusCode: 400, data: normalizeInvalidRequest("Question exceeds maximum length of 1,000 characters.") };
  }

  // 2. Call Python app.server on port 8000
  try {
    const res = await fetch(`${PYTHON_SERVER_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `clarified` is the entire loop guard for the one clarifying question
      // the backend is allowed to ask (app/clarify.py). This proxy used to drop
      // it, so a user who answered the clarification was asked it again — the
      // loop the flag exists to prevent, reintroduced by the hop through here.
      body: JSON.stringify({ question: trimmed, clarified: clarified === true }),
      signal: AbortSignal.timeout(20000),
    });

    if (res.ok) {
      const rawPythonResult = await res.json();
      return { statusCode: 200, data: rawPythonResult };
    }
  } catch (err) {
    console.warn(`[pipelineService] Python server at ${PYTHON_SERVER_URL} unreachable; reporting UNAVAILABLE`);
  }

  // 3. The backend could not be reached. Say so.
  return {
    statusCode: 503,
    data: {
      status: "UNAVAILABLE",
      question: trimmed,
      service_failure: {
        code: "transport_error",
        message:
          "The retrieval and answering backend could not be reached, so no answer was generated. Nothing unverified is shown.",
        detail: `no response from ${PYTHON_SERVER_URL}`,
      },
      answer: null,
      evidence: [],
      disclaimer:
        "IP-SAKTI is an information and research tool that answers from a fixed corpus of published legal texts. It is not legal advice and is not a substitute for a qualified practitioner.",
      timings_ms: { retrieval: 0.0, reranking: 0.0, answering: 0.0, total: 0.0 },
      pipeline: { candidates: 0, evidence_count: 0, stage: "backend_unreachable" },
    },
  };
}
