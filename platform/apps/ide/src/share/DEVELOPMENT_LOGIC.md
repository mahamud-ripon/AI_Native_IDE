# 🤝 IDE Frontend — Collaboration & Share UI Logic

> **Target:** `apps/ide/src/share/`
> **Goal:** Facilitate inviting users (`invitations` table) to a project and rendering the "Online Users" avatar presence bar at the top of the IDE.
> **Standard:** Presigned Magic Links. Yjs Awareness bindings.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Share Modal & Role Based Access Flow
- **Constraint:** Users cannot easily memorize UUIDs to invite people. They need email or link sharing.
- **Elite Logic:**
  - Generating an invite MUST fire an API call `POST /v1/projects/:id/invitations`.
  - Allow the inviter to explicitly set a role: `viewer`, `developer`, `admin`.
  - Render a "Copy Magic Link" field. If the link is clicked by an unauthorized user, the API Gateway verifies the token embedded in the link before granting access to the WebSockets.

### 2. The Live Presence Bar (Avatars)
- **Constraint:** Users need to know exactly who is actively looking at their code right now to avoid stepping on toes.
- **Elite Logic:**
  - Subscribe to the `y-webrtc` or `y-websocket` awareness state (`yjsStore.ts`).
  - Listen specifically to the `awareness.on('change')` event listener.
  - Map the active `clientId`s to an array of user objects (fetching their profile pictures silently from the `users` table via cached React Query calls).
  - Render these avatars smoothly in the top-right corner of the IDE header. If an avatar goes idle for 5 minutes, dim their opacity to 50%.
