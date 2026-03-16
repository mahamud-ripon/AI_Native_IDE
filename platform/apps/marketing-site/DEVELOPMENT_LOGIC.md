# 🌐 Marketing Site — Development Logic & Architecture

> **Target:** `apps/marketing-site/` (Next.js 15 App Router)
> **Goal:** Public-facing landing page, SEO, and conversion funnel. Must look and feel like an elite, enterprise-grade AI company (e.g., Vercel, Stripe).

## 📁 Required File Structure (Developer must follow)
```text
app/
 ├── page.tsx                 # Main landing page
 ├── pricing/                 # Pricing and plans
 └── docs/                    # Public documentation
components/
 ├── hero/
 │    └── InteractiveHero.tsx # Hero section with D3 animations
 └── features/
      └── ArchVisualizer.tsx  # Interactive D3 visualization of the Hybrid Architecture
```

## 🧠 Core Logic Rules for Developer

### 1. Aesthetic & Performance
- **Constraint:** The site must load instantly while having complex animations.
- **Logic:**
  - Use Next.js Server Components (RSC) for all static text and SEO metadata.
  - Only use Client Components (`"use client"`) for interactive elements.
  - Rely on Tailwind CSS for layout. No large CSS-in-JS libraries that hurt initial load times.

### 2. High-End Data Visualization (D3.js)
- **Constraint:** SVG/CSS animations are not enough to explain complex AI and Cloud Architecture.
- **Logic:**
  - **Mandatory D3.js:** Use `d3` within React wrappers to build interactive flow diagrams explaining how the "AI Orchestrator" DAG builds an app, or how "WebContainers vs Firecracker VMs" save cost.
  - **Hero Section:** D3.js must be used to create a stunning, particle-driven or node-link graph animation in the background of the hero section that reacts to user scroll/mouse movements.
  - **Conversion Funnel:** Use D3.js in the pricing section to show an interactive ROI (Return on Investment) calculator graph (e.g., plotting traditional VM costs vs our Hybrid Model costs).

### 3. Analytics & SEO
- **Constraint:** Marketing needs robust data without compromising page speed.
- **Logic:** Load analytics scripts asynchronously. Ensure `sitemap.xml` and `robots.txt` are dynamically generated.
