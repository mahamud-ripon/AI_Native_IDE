# 🧠 AI-Agents (LangGraph) — Development Logic & Architecture

> **Target:** `ai-agents/` (Python, LangGraph, Pydantic)
> **Boundary Note:** This directory is a PURE Python package. It contains only graph logic and tools. It does **not** handle HTTP requests. The `services/ai-service/` imports this package to expose it via REST/SSE APIs.
> **Goal:** The "Brain" of the IDE. A Multi-Agent Orchestration Engine that parses natural language, plans the architecture, and writes/tests the code through 8 specialized agents.
> **Standard:** Deterministic state tracking. Aggressive cost minimization. Zero infinite loops.

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── orchestrator/                 
 │    ├── graph_builder.py         # Defines the LangGraph DAG (Nodes & Edges)
 │    └── state_schema.py          # Strict Pydantic models for passing data between agents
 ├── agents/                       # The 8 Specialized Agents
 │    ├── pm_agent.py              # Outputs structured PRDs
 │    ├── architect_agent.py       # Outputs System Design & ADRs
 │    ├── backend_agent.py         # Generates API + DB schema
 │    ├── frontend_agent.py        # Generates React UI
 │    ├── devops_agent.py          # Generates Dockerfiles & K8s
 │    ├── qa_agent.py              # Generates and runs tests
 │    └── security_agent.py        # Scans for vulnerabilities
 ├── tools/                        
 │    ├── file_modifier.py         # Connects via Gateway to edit actual project files
 │    └── bash_executor.py         # Connects to Execution Service to run commands on VM
 └── routing/
      └── cost_manager.py          # Dynamic LLM routing (Sonnet vs Haiku vs Llama3)
```

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The State Passing Protocol (No Free Chatting)
- **Constraint:** AI Agents (like ChatGPT) naturally want to output conversational text. If the `PM Agent` sends unstructured text to the `Backend Agent`, the backend agent will hallucinate.
- **Logic:**
  - Agents DO NOT chat with each other using raw strings.
  - All inter-agent communication must pass through the Global State Graph defined in `state_schema.py` (using Pydantic `BaseModel`).
  - *Example:* The Architect Agent MUST return a JSON object: `{ "tech_stack": ["node", "postgres"], "db_schema": "...", "files_to_create": ["src/index.js"] }`.
  - The LangGraph Orchestrator validates this Pydantic schema before allowing the DAG to proceed to the Backend Agent.

### 2. The Task DAG (Directed Acyclic Graph) & Execution
- **Constraint:** Agents must not step on each other's toes. The UI cannot be built before the API schema exists.
- **Logic:**
  - Implement LangGraph workflow exactly as follows:
    1. **Pre-Graph Classifier (Jailbreak Defense):** A lightweight LLM call or heuristic classifier MUST scan the user's prompt *before* graph entry. If it detects "Read .env", "Exfiltrate", or system prompt override attempts, the graph ABORTS instantly.
    2. **Sequential Phase:** `PM Agent` ➔ `Architect Agent`
    3. **Parallel Phase:** The Orchestrator splits execution to `Backend Agent` AND `Frontend Agent` AND `DevOps Agent` concurrently (saves time).
    4. **Gatekeeper Phase:** The code flows to the `QA Agent` and `Security Agent`. 
    5. **Feedback Loop:** If QA fails (e.g., tests don't pass), the graph loops back to the offending agent (Frontend/Backend) to fix it.
  - **MAX_RETRIES Constraint:** Set a strict hard-coded loop limit (e.g., `max_iterations=3`) on the QA/Security feedback loop to prevent infinite token burn. If it fails 3 times, halt and ask the human user for help.

### 3. Aggressive Cost Control (The Routing Table)
- **Constraint:** Writing a full app takes 20-50 LLM calls. Using GPT-4o for every single minor tweak will bankrupt the company.
- **Logic:**
  - Every agent MUST call the `cost_manager.py` to get its LLM instance.
  - Implement the routing table strictly:
    - **Tier 1 (Frontier - Claude 3.5 Sonnet / GPT-4o):** Used ONLY for complex reasoning (PM Agent, Architect Agent).
    - **Tier 2 (Fast/Cheap - Claude 3.5 Haiku / Gemini Flash):** Used for bulk code generation and straightforward React components (Frontend Agent, Backend Agent).
    - **Tier 3 (Local/OSS - Llama-3 70B via Groq):** Used for simple linting fixes, typos, or syntax checks.

### 4. Context Pruning (RAG vs Full Context)
- **Constraint:** Sending a 50,000-line codebase to an LLM every time costs too much money and causes the LLM to "forget" instructions in the middle.
- **Logic:**
  - Use **Prompt Caching** APIs (Anthropic/OpenAI) extensively to cache the system instructions and the PRD.
  - Do NOT send the entire file tree to the Frontend Agent just to edit a button.
  - Use the `Project Service`'s AST (Abstract Syntax Tree) to extract only the relevant React component and its immediate dependencies. Send only those chunks.

### 5. Deterministic Tool Calling
- **Constraint:** The AI cannot just say "I edited the file". It actually has to edit the real file on the disk or in the DB.
- **Logic:**
  - Agents must use LangChain `bind_tools()`.
  - When the Backend Agent decides to create `server.js`, it triggers the `file_modifier.py` tool.
  - **Dual-Write Data Destruction Protection:** The `file_modifier` tool MUST NEVER execute an HTTP `PUT` directly to `project-service` if the file is currently active. The tool MUST act as a virtual user, opening a WebSocket to `websocket-gateway`, applying the diff to the `Y.Doc` (CRDT), and disconnecting. If it overwrites the Postgres DB directly, the `collab-service` will blindly overwrite the AI's changes 5 minutes later when it flushes its stale memory string to DB.
  - The AI MUST wait for a `200 OK` (or WS ACK) response from the tool before continuing its thought process.

---

## ⚠️ ACTION ITEMS (Priority Order)

### Priority 1: Critical

#### 1.1 Implement Full Cost Routing Table
- **Current:** Basic tier mention exists
- **Required:** Implement full routing with Tier 1/2/3 with explicit model selection
- **File:** `src/routing/cost_manager.py`
- **Reference:** `@developer_guidelines.md` Section 2.1

#### 1.2 Add Local Llama3 as Fallback
- **Current:** No local model fallback
- **Required:** Add Groq-hosted Llama3 for Tier 3 operations
- **File:** `src/routing/cost_manager.py`
- **Reference:** `@developer_guidelines.md` Section 2.1

### Priority 2: High

#### 2.1 Context Pruning Implementation
- **Current:** Basic prompt caching mentioned
- **Required:** Implement AST-based context pruning, enforce 500k token limit
- **File:** `src/orchestrator/graph_builder.py`
- **Reference:** `@developer_guidelines.md` Section 2.1

#### 2.2 MAX_RETRIES Enforcement
- **Current:** Mentioned but not enforced
- **Required:** Implement hard-coded `max_iterations=3` in QA/Security loop
- **File:** `src/orchestrator/graph_builder.py`
- **Reference:** `@analysis_report.md` Section 1.4

---

*Last Updated: March 12, 2026 - Action items from analysis*
