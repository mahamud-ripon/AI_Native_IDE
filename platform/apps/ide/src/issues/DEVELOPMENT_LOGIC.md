# 🚨 IDE Frontend — Code Issues & Problems Panel Logic

> **Target:** `apps/ide/src/issues/`
> **Goal:** Render a VS Code-style "Problems" panel at the bottom of the screen, mapping the `code_issues` parsed by the Language Server Protocol (LSP).
> **Standard:** Instantly interactive Linter diagnostics. Virtualized DOM. 

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. LSP Diagnostics Subscription
- **Constraint:** We cannot run `eslint` or `tsc` in the browser natively for heavy frameworks. The validation rules must come from the remote LSP.
- **Elite Logic:**
  - Hook into `monaco-languageclient`.
  - Listen for the `textDocument/publishDiagnostics` JSON-RPC method from the server.
  - Pipe these incoming errors (e.g., Error, Warning, Info) into a globally accessible Zustand store: `useIssuesStore`.

### 2. The Problems Panel Interaction
- **Constraint:** Clicking an error in the "Problems" panel at the bottom of the screen must instantly open the file and scroll the editor to the exact buggy line.
- **Elite Logic:**
  - Render the issues in an Accordion list grouped by filename using `@tanstack/react-virtual` if the project has 100+ TypeScript errors.
  - On click, execute `openEditorTab(fileId)`.
  - Use Monaco Editor's native API to jump exactly to the issue: `editor.revealLineInCenter(lineNumber)` and `editor.setPosition({ lineNumber, column })`.
  - Optionally, render a lightbulb icon (💡) next to the error that triggers the AI Agent to automatically submit an AST fix for the bug.
