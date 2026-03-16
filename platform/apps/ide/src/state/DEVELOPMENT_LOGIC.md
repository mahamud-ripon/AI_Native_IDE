# 🧊 IDE Frontend — State Management (CRDT & Zustand)

> **Target:** `apps/ide/src/state/`
> **Goal:** High-performance, memory-safe data management. Avoid React Context re-render cascades. Coordinate the Yjs shared documents.
> **Standard:** Zustand slices. Singleton Y.Doc pools. Transient updates.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. State Segregation (React vs Yjs)
- **Constraint:** A common mistake is storing the `Y.Doc` or `Awareness` objects inside a React `useState`. Every time a collaborator moves their mouse, the entire IDE component tree re-renders, causing horrific lag.
- **Elite Logic:**
  - **Shared State:** Code text, file structure, and cursor positions live purely in `Yjs`. React components only *subscribe* to changes they care about via `useEffect`.
  - **Local Client State:** Which tab is currently active, is the dark mode toggled, or is the terminal split-view open? This lives strictly in `Zustand`.

### 2. The Singleton Y.Doc Pool
- **Constraint:** Opening 10 files in the IDE should not spawn 10 WebSocket connections to the Collab Service.
- **Elite Logic:**
  - Define a global `yjsStore.ts` using Zustand.
  - Export a `Map<string, Y.Doc>` to pool active documents.
  - Utilize a single central `Y.WebsocketProvider` to connect multiplexed channels to the Gateway, instead of instantiating new WebSocket frames per file.
  - Track `reference counts`. If a file tab is closed, check if it's the last reference. If yes, safely `yDoc.destroy()` to prevent memory leaks.

### 3. Transient State Subscriptions
- **Constraint:** Rapidly changing local values (like dragging a panel resizer) will block the React event loop if managed through standard hooks.
- **Elite Logic:**
  - Use Zustand's `.subscribe()` method inside a `useLayoutEffect` to manually mutate specific DOM styles or references directly.
  - Example: `useUIStore.subscribe((state) => (panelRef.current.style.width = state.panelWidth + 'px'))`. This updates the screen instantly, completely bypassing React's render reconciler.
