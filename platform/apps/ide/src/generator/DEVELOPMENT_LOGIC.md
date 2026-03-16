# 🪄 IDE Frontend — App Generation (Prompt-to-App) Logic

> **Target:** `apps/ide/src/generator/`
> **Goal:** The crucial intermediary screen between typing "Build a blog" on the Dashboard and landing in a fully-coded IDE. The mesmerizing loading state that keeps the user engaged while LangGraph works on the backend.
> **Standard:** Cinematic Loading. SSE Progress Streaming. Confetti.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Blueprint Loading Screen
- **Constraint:** Generating an entire Next.js app with authentication and a database takes the AI 45-90 seconds. If the user stares at a spinner, they will close the tab thinking it's broken.
- **Elite Logic:**
  - Build a dynamic steppers UI: `[ ] Architect Planning -> [ ] Setting up DB -> [ ] Writing React Components -> [ ] Installing Dependencies`.
  - Connect via Server-Sent Events (SSE) to `/v1/ai/generate/:id`.
  - As the `ai-service` emits chunks (`{"step": 2, "agent": "frontend", "message": "Scaffolding Tailwind Navbar"}`), instantly update the UI step.

### 2. Live Task DAG Visualization
- **Constraint:** We want to show off the power of our Multi-Agent Orchestration Engine.
- **Elite Logic:**
  - Import the D3 DAG visualizer (`src/visualization`) early on this screen.
  - Show the LangGraph nodes spawning in real-time as the Architect Agent delegates tasks to the Backend and Frontend agents. Look at Vercel's v0.dev generation screen for inspiration.

### 3. Graceful Boot Handoff
- **Constraint:** When code generation finishes, jumping jarringly into the IDE code editor ruins the magic.
- **Elite Logic:**
  - When the final SSE event `"COMPLETE"` arrives, do not instantly `router.push()`.
  - Wait 1.5 seconds, play a success animation (e.g., Shadcn Framer Motion layout shift scaling the window into the IDE interface).
  - Pre-fetch the `project-service` file tree in the background during the animation to ensure the IDE loads the files instantly with zero skeleton loaders.
