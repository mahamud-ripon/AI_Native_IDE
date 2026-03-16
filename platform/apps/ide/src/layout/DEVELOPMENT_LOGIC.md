# 📐 IDE Frontend — Layout & Command Palette Logic

> **Target:** `apps/ide/src/layout/`
> **Goal:** Create a VS Code style layout with resizable split-panes (Sidebar, Editor, Terminal, AI Panel) and a highly performant global Command Palette (`Ctrl+P` / `Cmd+P`).
> **Standard:** `react-resizable-panels`. Zero unhandled global shortcuts. Accessible Modal APIs.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Resizable Panes Integration
- **Constraint:** Using native HTML drag events or `mousedown`/`mousemove` to resize panels often results in stuttering, selecting surrounding text by mistake, or iframe (Preview) mouse capturing bugs.
- **Elite Logic:**
  - Use `react-resizable-panels` (built on top of standard Radix primitives by react-day-picker author).
  - IMPORTANT: If a user resizes a panel over the `src/preview` iframe, the iframe will swallow the `mousemove` events, and the drag will break.
  - Fix: When `onDragging` is true on the resizer, inject `pointer-events: none` directly into the Iframe or lay an invisible `div` absolute over the whole screen to catch the mouse during the drag.

### 2. The Global Command Palette (Cmd+P)
- **Constraint:** Having 50 components all attaching their own `window.addEventListener('keydown', ...)` creates horrific memory leaks and conflicting hotkeys.
- **Elite Logic:**
  - Implement a single, unified Hotkey/Command Manager using `cmdk` (Command K).
  - Bind it to the global layout level.
  - Centralize all commands into an array of objects: `{ id: 'toggle-ai', shortcut: ['Cmd', 'J'], action: () => useUIStore.getState().togglePanel('ai') }`.
  - When the user types "Format" in the Command Palette, instantly filter and render the options. Execute the action directly from the palette registry.

### 3. File Search (Cmd+P / Ctrl+P)
- **Constraint:** Typing a filename needs to instantly search the 10,000 files in the AST/PostgreSQL database without waiting for 500ms API debounces.
- **Elite Logic:**
  - The `fileMap` string list is already fetched on load and sits in Zustand (`src/file-tree` logic).
  - Use a highly optimized fuzzy search library like `fuzzysort` in the browser.
  - As the user types "ind" in the Command Palette, `fuzzysort` instantly ranks `index.ts` and `src/components/index.tsx` within 5ms.
  - On Enter, call the Zustand store action to dispatch the `openEditorTab(fileId)` event.
