# 🤖 IDE Frontend — AI Chat & Agent Interaction Logic

> **Target:** `apps/ide/src/ai/`
> **Goal:** Render a ChatGPT-like or Cursor-like chat panel where users instruct the LangGraph agents. Render beautiful streaming Markdown, Code Diff blocks, and execution progress.
> **Standard:** Server-Sent Events (SSE). Markdown Streaming. Code syntax highlighting.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Unidirectional Steaming (SSE)
- **Constraint:** Fetching the AI response with a standard `.then(res => res.data)` will cause the user to stare at a loading spinner for 15 seconds while Claude 3.5 Sonnet generates a 200-line React component.
- **Elite Logic:**
  - Use Server-Sent Events (SSE) or a highly optimized WebSocket channel (`ai:{conversation_id}`).
  - As tokens arrive (`chunk.content`), append them to the local Zustand state.
  - The React UI must incrementally render the Markdown using `react-markdown`.

### 2. The Code Diff Visualizer
- **Constraint:** When the AI modifies an existing file, the user MUST be able to see exactly what changed before accepting it (like a Git diff).
- **Elite Logic:**
  - When the AI payload emits a `diff` block, intercept the custom markdown node.
  - Render a side-by-side or inline Diff viewer using `monaco-editor` diff mode or `react-diff-viewer`.
  - Provide absolute "Accept" and "Reject" floating buttons. Clicking "Accept" triggers a Yjs CRDT edit command to apply the code to the real document.

### 3. Smart Context Attachments (The '@' Feature)
- **Constraint:** The user needs to tell the AI "Look at @utils.ts and @types.ts". We cannot send the entire 10,000 file project to the LLM.
- **Elite Logic:**
  - Implement an interception overlay: when the user types `@` in the chat input, float a popover menu (like Slack mentions) querying the local `file-tree` Zustand store.
  - When the user selects a file, attach its explicit `file_id` to the prompt hidden metadata.
  - The `ai-service` will use these exact IDs to fetch the raw text from Postgres and inject ONLY those files into the LLM context window.
