# 🌟 Marketing Site — Next.js 15 & D3 Hero ROI Visuals

> **Target:** `apps/marketing-site/`
> **Goal:** High conversion B2B landing page. Must feel incredibly premium to convince Enterprise buyers.
> **Standard:** Perfect Core Web Vitals (Lighthouse 100). Elite interactive visual storytelling. SSR SEO.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. D3 Hero Physics & Interactivity (Wow Factor)
- **Constraint:** The `HeroSection` cannot be a static image or a plain CSS animation. We must prove we are a world-class AI system immediately.
- **Elite Logic:**
  - Use D3.js `d3-force` directed graph in the `ROIChart.tsx` or Hero canvas.
  - Simulate an AI neural network "building" an app physically. 
  - Create interactive repelling nodes (e.g., cursor hover pushes nodes away using `forceCollide`).
  - Render with `Canvas` instead of `SVG` if rendering more than 1000 particles to maintain 60FPS.

### 2. Next.js 15 Server-Side SEO (The ROI Calculator)
- **Constraint:** Googlebots do not execute complex state hooks efficiently. We need to rank #1 for "AI Native IDE".
- **Elite Logic:**
  - The main page must be a Server Component (`app/(marketing)/page.tsx`).
  - Push the *interactive* D3 component into a strict Client Component block: Use `'use client'` natively at the top of the file, wrapped in `next/dynamic` with `ssr: false` to prevent hydration mismatches on exact physics coordinates.
  - Output strict `generateMetadata()` tags: canonical URLs, OpenGraph images, Twitter cards, and structured JSON-LD (SoftwareApplication).

### 3. Edge Caching & Performance
- **Constraint:** Vercel/Cloudflare bandwidth is expensive. The marketing site will undergo high traffic spikes.
- **Elite Logic:**
  - Compile images to `.webp` or `.avif` formats.
  - Use `next/image` exclusively. Max width optimized.
  - Fetch real-time metrics (like "Built X apps today" from the API Gateway/Database) using Next.js `fetch('...', { next: { revalidate: 3600 } })` to cache the server response globally at the edge for 1 hour. Do NOT execute a database query on every page load.
