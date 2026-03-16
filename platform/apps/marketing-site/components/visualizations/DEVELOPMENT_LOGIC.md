# 🌟 Marketing Site — WebGL & D3 Visualizations

> **Target:** `apps/marketing-site/components/visualizations/`
> **Goal:** Create a breathtaking visual identity. Show, don't tell. Illustrate the AI Neural Network orchestrating a software project in real-time.
> **Standard:** 60 FPS strict. React Three Fiber / D3 Canvas. Hardware acceleration.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Avoid DOM Traps (Canvas over SVG)
- **Constraint:** The Hero section must display moving particles representing lines of code and AI nodes processing them. 5,000 `<circle>` SVGs will limit scrolling fluidity to 10 FPS on low-end laptops.
- **Elite Logic:**
  - Use `D3 Canvas` or `Three.js` (react-three-fiber).
  - Calculate physics (`d3.forceSimulation`) in a Web Worker if possible, passing coordinates back to the main thread via standard Float32Arrays.
  - Paint everything on a single `<canvas>` element using the raw `CanvasRenderingContext2D`.

### 2. Scroll-Bound Physics (GSAP Integration)
- **Constraint:** Randomly floating particles look cheap and like a template. Premium feel requires physics tied to user action.
- **Elite Logic:**
  - Use `GSAP ScrollTrigger` or Framer Motion's `useScroll`.
  - Bind the camera angle or the gravity coefficient of the `d3-force` simulation to the viewport scroll percentage.
  - When the user scrolls down, the "AI Nodes" pull apart and dive down into the specific feature cards physically.

### 3. Battery and Performance Mitigation
- **Constraint:** Heavy WebGL algorithms running infinitely in the background destroy user battery life, leading to the Chrome "High Power Usage" warning.
- **Elite Logic:**
  - Implement an `IntersectionObserver`.
  - When the Hero section scrolls completely out of view, you MUST pause the `requestAnimationFrame` loop.
  - Resume it instantly when it re-enters the viewport. Never execute physics calculations for pixels the user cannot currently see.
