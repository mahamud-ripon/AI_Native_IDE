# 🗂️ IDE Frontend — User Workspace Dashboard Logic

> **Target:** `apps/ide/src/workspace/`
> **Goal:** The landing page for the user after they log in (e.g., `/dashboard`). Handles the list of projects, creating new projects, and checking their `subscriptions` (Free/Pro/Enterprise) billing status.
> **Standard:** Next.js Routing. Strict Caching. Empty States.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Unified Grid Rendering & Optimistic UI
- **Constraint:** Creating a new project should feel instant, even if the backend takes 2 seconds to initialize the Git repo and DB records.
- **Elite Logic:**
  - Upon clicking "New Project", instantly append a temporary "Skeleton" project to the grid in the UI.
  - Call the API `POST /v1/projects`.
  - On success, replace the Skeleton with the actual Project Box and navigate to `/editor/[id]`. On failure, remove the skeleton and show an error toast.

### 2. Subscription SSOT (Single Source of Truth)
- **Constraint:** As defined in our core ERD, the subscription `plan` lives strictly in the `subscriptions` table.
- **Elite Logic:**
  - The Workspace Dashboard must fetch the user's active limits: `GET /v1/billing/limits`.
  - Render a "Quota Ring" (e.g., Progress Circle: 80% free AI tokens used).
  - If the quota hits 100%, grey out the "New AI Project" button and show an upgrade prompt. Do NOT let the user click the button only to get a 403 error seconds later.

### 3. Infinite Scrolling for Projects Grid
- **Constraint:** Power users will have hundreds of projects. Rendering them all at once delays page load.
- **Elite Logic:**
  - Implement intersection observer-based infinite scrolling on the grid container.
  - Integrate using TanStack Query's `useInfiniteQuery`. Fetch page 1 (first 20 projects). When the scrolling intersects the invisible bottom observer, fetch page 2, and seamlessly append.
