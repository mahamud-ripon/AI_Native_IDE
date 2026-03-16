# 🛡️ Admin Panel — Real-Time Usage Dashboard (D3 Data Vis)

> **Target:** `apps/admin/src/components/visualizations/UsageDashboard.tsx`
> **Goal:** Render a massive volume of live internal metrics (e.g., Active Firecracker VMs, Token Burndown rates, API Error rates).
> **Standard:** Mandated high-performance real-time D3.js SVG rendering. Max frames per second. No React component overload.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. High-Volume D3 SVGs vs React VDOM
- **Constraint:** The Admin dashboard will receive 100 WebSocket telemetry events per second. React rendering a `<LineChart>` component with `setState` every 10ms will freeze the entire DOM.
- **Elite Logic:**
  - Create the root node in React: `<svg ref={svgRef}></svg>`.
  - Pass the raw `metricsArray` to a custom D3 render function.
  - Implement the **Path Sliding Window** algorithm in D3: 
    Instead of redrawing the entire line every millisecond, set a `clip-path` and translate the `.line` elements using `transform` to shift the SVG smoothly left by 1 pixel (equivalent to the time delta).
    ```javascript
    path.attr("transform", null)
      .transition()
      .duration(tickDuration)
      .ease(d3.easeLinear)
      .attr("transform", "translate(" + x(-1) + ",0)");
    ```

### 2. Time-Series Aggregation (Memory Leak Protection)
- **Constraint:** If an individual admin tab is left open all day, an array pushing new CPU ticks every second will hit 86,400 objects, crashing Chrome.
- **Elite Logic:**
  - Use a maximum window size constraint: `const MAX_TICKS = 600`.
  - Use a circular buffer or explicitly slice the front of the array natively: `data.shift()`.
  - If zoomed out to "Weekly" view, do NOT query the `billing-service/api/current` for all raw ticks. Rely entirely on the pre-aggregated `usage_daily` table.

### 3. Drill-Down Hierarchy Visualization
- **Constraint:** Admins must be able to explore "which agent is eating our GPT-4o budget".
- **Elite Logic:**
  - Build a D3 TreeMap or Sunburst diagram.
  - The API payload will provide a nested hierarchy: `Total Org UUID` ➔ `User UUID` ➔ `Project ID` ➔ `Agent Name` ➔ `Tokens`.
  - The D3 TreeMap must compute the nested data (`d3.hierarchy(data).sum(d => d.value)`).
  - Apply smooth click zoom transitions so clicking a single User elegantly expands their projects into the viewport.
