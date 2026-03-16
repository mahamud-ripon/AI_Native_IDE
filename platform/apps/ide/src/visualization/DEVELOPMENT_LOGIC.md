# 📈 IDE Frontend — D3.js DAG Visualization (AI Agent Graph)

> **Target:** `apps/ide/src/visualization/`
> **Goal:** Render a visual representation of the Multi-Agent Orchestration (LangGraph). Show the user exactly which AI Agent is actively typing, planning, or failing.
> **Standard:** SVG/Canvas D3.js. High Framerate. Interactive Nodes.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Abstracting D3 from React Lifecycle
- **Constraint:** React's virtual DOM cannot efficiently compute the complex physics of D3 (`d3-force`) or hierarchical trees (`d3-hierarchy`).
- **Elite Logic:**
  - Provide a single `div` to D3 via `ref`: `<div id="dag-container" ref={containerRef} />`.
  - Listen for the LangGraph Server-Sent Events (SSE) arriving from the `api-gateway` / `ai-service`.
  - Parse the incoming JSON event: `{ agent: "Backend", status: "running" }`.
  - Programmatically update the D3 array `data`, and call your custom `.update()` D3 lifecycle function.

### 2. Enter -> Update -> Exit Morphology
- **Constraint:** Wiping the entire SVG on every event to redraw it causes visual flashing and destroys the premium native feel of the app.
- **Elite Logic:**
  - Standardize the D3 pipeline.
  - `.enter()`: Apply an `opacity: 0 -> 1` and `transform: scale(0 -> 1)` transition to smoothly pop new agent nodes into the graph.
  - `.update()`: If an agent finishes, transition its stroke color from `orange` (thinking) to `green` (complete) using `d3.transition().duration(400)`.
  - `.exit()`: Gracefully shrink out nodes if the context graph resets.

### 3. Zoom Pan Optimization
- **Constraint:** Complex PRD executions will spawn 15-20 nodes. They will not fit in the default sidebar.
- **Elite Logic:**
  - Implement `d3.zoom()`.
  - Target an inner `<g>` group within the SVG, NOT the root SVG itself, to apply the geometric transform matrix.
  - Attach double-click `<g>` event listeners to "Focus/Reset" the view perfectly to the bounding box of the selected node.
