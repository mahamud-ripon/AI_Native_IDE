# ⭐ IDE Frontend — AI Feedback & RLHF Logging

> **Target:** `apps/ide/src/feedback/`
> **Goal:** Gather Reinforcement Learning from Human Feedback (RLHF). Every time a user accepts, rejects, or rates an AI-generated code block, log it to the `ai_feedback` table.
> **Standard:** Ubiquitous Micro-Interactions. Data Density.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Micro-Interaction Injections
- **Constraint:** Users hate filling out long forms. Feedback must take exactly 1 click.
- **Elite Logic:**
  - Inject 2 tiny inline SVG buttons (👍 👎) directly underneath the `ai-chat` markdown code blocks AND inside the Monaco Diff viewer component.
  - If they click 👍, send a silent background request: `POST /v1/ai/feedback { message_id, rating: 5 }`.
  - If they click 👎, pop a tiny sub-menu asking "What was wrong? [ ] Hallucination [ ] Syntax Error [ ] Ignored Context."

### 2. Diff Analytics
- **Constraint:** We must learn *how* the AI failed.
- **Elite Logic:**
  - If the user clicks "Reject Code" inside the diff viewer, immediately send the `project_id`, the `rejected_diff_text`, and the `trigger_type` to the `ai_feedback` table to improve the next LangGraph prompt automatically.
