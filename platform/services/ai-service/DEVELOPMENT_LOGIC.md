# 🧠 AI Service — Development Logic & Architecture

> **Target:** `services/ai-service/` (TypeScript / Fastify)
> **Boundary Note:** This service is STRICTLY an HTTP API router. It does NOT define the agent graph itself. It communicates with the Python `ai-agents` service via HTTP, providing LLM credentials, and streams the output via SSE.
> **Goal:** The REST/SSE wrapper for our LangGraph orchestration. Converts the internal state machine updates from `ai-agents` into real-time server-sent events for the frontend.
> **Standard:** Minimal latency. Perfect stream parsing. Strict rate limiting.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── controllers/
 │    └── ai_controller.ts         # Handles REST requests and SSE streaming
 ├── clients/
 │    └── ai_agents_client.ts      # HTTP wrapper to call the Python ai-agents service
 └── routes/
      └── api.ts                   # Fastify route definitions
```

## 🧠 Core Logic Rules for Developer

### 1. System Prompt & State Management (LangGraph)
- **Constraint:** Agents MUST NOT freely chat. They must output strict JSON matching `state_schema.py`.
- **Logic:**
  - Define a LangGraph `StateGraph`.
  - State object contains `{"prd": "", "schema": {}, "code_diffs": [], "errors": []}`.
  - The `PM Agent` populates `"prd"`. 
  - The `Backend` and `Frontend` agents read `"prd"` and `"schema"` and output to `"code_diffs"`.
  - If `Security Agent` detects vulnerabilities, it modifies `"errors"` and routes the DAG back to `Backend Agent` for a fix.

### 2. Cost Control, Context Pruning & LLM Routing (§3.5 System Design)
- **Constraint:** A single generation can cost 50+ LLM calls. Hard token caps are required. Injecting massive `package-lock.json` or binary files will instantly bankrupt the company via API billing.
- **Logic:**
  - **Tier 1 (Planning):** PM & Architect agents MUST use `Claude 3.5 Sonnet` or `GPT-4o` for high reasoning.
  - **Tier 2 (Coding):** Frontend/Backend MUST use `Claude 3.5 Haiku` or `Gemini 2.0 Flash` to save cost.
  - Implement Anthropic's **Prompt Caching** header for system prompts and context.
  - **Context Pruning (Extreme Rule):** The orchestrator MUST silently enforce an `.aiignore` file mapping. Never pass Minified JS, CSVs, or SVG data directly to the LLM. Use `tiktoken` to measure context size; if it exceeds `500,000` tokens, automatically summarize older conversations or truncate before execution.

### 2.5 Security: PII & Secret Leakage Prevention
- **Constraint:** If a user accidentally pastes their `AWS_SECRET_KEY` into the prompt or `.env` file, the AI-Service MUST NOT transmit it to OpenAI/Anthropic servers. Doing so violates SOC2.
- **Logic:**
  - Before invoking any `llm.invoke()` call, pass the prompt string through a Data Masking Middleware (Regex / Entropy Scanner).
  - Overtly recognize patterns for common secrets (`sk-live-`, `AKIA`, `xoxb-`).
  - Replace them with `<REDACTED_SECRET_1>`, keeping an ephemeral, in-memory Map tying the placeholder to the original string.
  - **The Re-Hydration Rule (Extreme Risk):** When the LLM streams the output `code_diff` back, the service MUST actively scan the stream and replace `<REDACTED_SECRET_1>` with the original string from the memory Map BEFORE passing the diff to the `file_modifier` tool or `websocket-gateway`. Otherwise, the AI will overwrite the user's `.env` with literally `<REDACTED_SECRET_1>`, permanently destroying their actual keys.

### 3. Server-Sent Events (SSE) Streaming
- **Constraint:** The user must see the exact thought process live (e.g., "Architect is designing database...").
- **Logic:**
  - Forward the SSE stream from `ai-agents` directly to the client. Keep connection open using Fastify.
  - Connect this to the `websocket-gateway`'s AI channel.

### 4. Fallback Mechanisms
- **Constraint:** If Claude goes down, the system cannot break.
- **Logic:** Wrap the LLM invoke inside a try/catch. On `503 Service Unavailable`, switch to `GPT-4o/Gemini`. Log the failover to the `audit_logs` table (PostgreSQL).

---

## ⚠️ ACTION ITEMS (Priority Order)

### Priority 1: Critical

#### 1.1 Add AI Provider Fallback (Section 4 Enhancement)
- **Current:** Basic try/catch fallback exists
- **Required:** Implement full multi-provider fallback with local Llama3 as last resort
- **File:** `src/llm_router/cost_optimizer.py`
- **Reference:** `@developer_guidelines.md` Section 2.1

#### 1.2 Add Circuit Breaker
- **Current:** No circuit breaker implemented
- **Required:** Add `opossum` to prevent cascading failures
- **File:** `src/clients/ai_agents_client.ts`
- **Reference:** `@developer_guidelines.md` Section 1.3

### Priority 2: High

#### 2.1 Context Pruning Enhancement
- **Current:** Basic token counting mentioned
- **Required:** Implement AST-based context pruning, enforce 500k token limit
- **File:** `src/orchestrator/dag_builder.py`
- **Reference:** `@developer_guidelines.md` Section 2.1

#### 2.2 OpenAPI Documentation
- **Current:** No visible API schema
- **Required:** Add response models and schema definitions to all endpoints
- **File:** `src/routes/api.ts`
- **Reference:** `@developer_guidelines.md` Section 3.1

---

*Last Updated: March 12, 2026 - Action items from analysis*
