# 📊 Admin Panel — D3.js Data Visualizations Logic

> **Target:** `apps/admin/src/components/visualizations/`
> **Goal:** Render live metrics of Firecracker VMs, memory utilization, and billing usage using hardware-accelerated SVG and Canvas elements.
> **Standard:** Native D3.js Integrations. No React Re-render loops. Smooth Sliding Windows.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. React vs D3 DOM Control
- **Constraint:** React and D3 both want to control the DOM. If React redraws an SVG that D3 is currently transitioning, the app will crash with an "Uncaught DOMException".
- **Elite Logic:**
  - Create a React component containing an empty SVG or div: `<svg ref={svgRef}></svg>`.
  - Run `useEffect` or `useLayoutEffect` to initialize the D3 graph, passing the `svgRef.current`.
  - D3 will append `<g>`, `<path>`, and `<circle>` elements. NEVER map over `<circle>` using React JSX `data.map()`. Let D3 handle the enter/update/exit lifecycles exclusively.

### 2. Canvas vs SVG Triggers
- **Constraint:** Rendering 10,000 active projects as connecting nodes will bring SVG rendering to 5 FPS.
- **Elite Logic:**
  - Use **D3 + SVG** for standard Bar Charts, Line Charts, and TreeMaps (e.g., Token Usage per Day).
  - Use **D3 + Canvas** for the Network Graph (showing which VMs are connected to which users). With Canvas, you draw pixels directly, bypassing the DOM entirely, allowing 50,000+ points to render at 60 FPS.

### 3. Graceful Memory Management
- **Constraint:** Real-time dashboards left open for days will cause browser tabs to consume 4GB+ of RAM.
- **Elite Logic:**
  - Clear the D3 intervals and WebSockets on component unmount: `return () => { clearInterval(timer); d3.select(svgRef.current).selectAll('*').remove(); }`.
  - Ensure data arrays have a firm `MAX_LENGTH`. Once `data.length > 1000`, use `data.shift()` to drop the oldest telemetry points.
