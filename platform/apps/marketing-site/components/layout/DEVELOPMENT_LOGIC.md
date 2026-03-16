# 📐 Marketing Site — Layout & Global Container Logic

> **Target:** `apps/marketing-site/components/layout/`
> **Goal:** Build the global wrappers for the public-facing pages (Navbar, Footer, Section Wrappers).
> **Standard:** Pixel-perfect responsive styling. Zero hydration mismatch (FOUC). Intersection Observers for entry animations.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Full-Viewport Hero Trap (`100vh`)
- **Constraint:** Using `h-screen` (which resolves to `100vh`) in Tailwind breaks on mobile Safari and Chrome Android because of the hidden bottom URL bar, causing the "Start Coding" CTA button to fall below the visible fold.
- **Elite Logic:**
  - Never use `100vh`.
  - Use Tailwind's new Dynamic Viewport units: `h-[100dvh]` (Dynamic Viewport Height).
  - This mathematically recalculates the browser height instantly when the user touches the screen and the URL bar retracts, ensuring the content is always perfectly framed.

### 2. Enter viewport triggers (Framer Motion)
- **Constraint:** If all 6 feature sections animate the moment the page loads (even if they are 3 scrolls down), when the user finally scrolls there, they see nothing moving.
- **Elite Logic:**
  - Wrap sections in `framer-motion`'s `<motion.div>`.
  - Configure strictly with `whileInView={{ opacity: 1, y: 0 }}`.
  - Set `viewport={{ once: true, margin: "-100px" }}` so the animation triggers right *before* the pixel edge hits the screen.
  - Doing this guarantees that as the user scrolls, they think the platform is actively reacting to them natively.

### 3. Glassmorphism Navigation Syncing
- **Constraint:** A sticky Navbar with a transparent background looks broken when scrolling over white text elements.
- **Elite Logic:**
  - The `Navbar` MUST observe scroll position locally (e.g., `useScroll()` hook).
  - If `scrollY > 50px`, inject Tailwind's native `backdrop-blur-md bg-black/60 border-b border-white/10`.
  - Else, remain purely `bg-transparent`. This provides the elite "Apple-like" premium feel upon scrolling down from the dark Hero section.
