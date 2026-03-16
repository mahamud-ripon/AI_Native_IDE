# 🔌 IDE Frontend — API Client & Global State Management

> **Target:** `apps/ide/src/api/` and `src/store/`
> **Goal:** Efficient data fetching, caching, and optimistic UI updates for the IDE. Centralized error handling and strictly typed Data Transfer Objects (DTO).
> **Standard:** `Zod` Type Safety. `React Query` (TanStack) Data Cache. `Zustand` Fast State.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Axios Interceptor & JWT Rotation
- **Constraint:** The IDE is a Long-Lived Single Page Application (SPA). A user might keep it open for 3 weeks. The 15-minute Access Token will expire, causing the API to reject all saves with `401 Unauthorized`.
- **Elite Logic:**
  - Implement a centralized `Axios` instance in `src/api/client.ts`. Do NOT use raw `fetch` for authenticated calls.
  - Attach a **Response Interceptor**.
  - If an API returns `401 Unauthorized`, intercept the error.
  - Pause all in-flight requests.
  - Send a silent background request to `/api/v1/auth/refresh` (cookie-based).
  - If successful, attach the new Access Token, resume the queue, and automatically retry the original failed requests. The user will never know an error occurred.

### 2. React Query Integration (The Server State)
- **Constraint:** Fetching the Project Details (`GET /projects/:id`) every time the user clicks a tab wastes bandwidth and increases server load.
- **Elite Logic:**
  - Use `@tanstack/react-query` exclusively for Server State (Data that lives remotely).
  - Define robust `queryKeys`: e.g., `["project", projectId, "details"]`.
  - Set specific `staleTime` values (e.g., Projects List: 5 minutes. Real-time VM Status: 0 seconds).
  - Wrap API calls in strongly typed hooks:
    ```typescript
    export const useProjectDetails = (id: string) => {
      return useQuery({
        queryKey: ["project", id],
        queryFn: () => axios.get<ProjectResponseDTO>(`/projects/${id}`).then(res => res.data)
      });
    }
    ```

### 3. Zustand (The Client State)
- **Constraint:** Putting UI State (e.g., "Is the Command Palette Open?") or high-frequency data (e.g., "Cursor X,Y position") into React Context will cause catastrophic re-renders across the entire IDE DOM tree.
- **Elite Logic:**
  - Use `Zustand` for UI and High-Frequency Client State.
  - Avoid creating one massive global store. Split it by domain: `useEditorStore` (active file, open tabs), `useTerminalStore` (split views), `useAIStore` (agent chat history).
  - Use Zustand's **Transient State Updates** (subscribing to state directly outside of React rendering loop) for extremely hot paths like live multiplayer cursor coordinates, bypassing React's render phase entirely to ensure 60FPS.

### 4. DTO Validation via Shared Types
- **Constraint:** If the Backend devs rename `createdAt` to `created_at`, the Next.js Frontend will display `undefined` or crash silently, causing hidden bugs.
- **Elite Logic:**
  - MUST import types directly from `@workspace/shared-types`.
  - Enforce strict typing on every `axios.get<StrictType>` call.
  - If the data structure dictates it, use `Zod.parse()` on the frontend payload return to catch Backend schema breaks instantly during development.
