# 🔔 Notification Service — Push & Email Logic

> **Target:** `services/notification-service/`
> **Goal:** Reliable, asynchronous delivery of system alerts (e.g., "AI finished generating your project"), @mentions, and transactional emails.
> **Standard:** Retry queues. Idempotent delivery. WebSocket Multiplexer integration.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Real-Time Push (Redis Pub/Sub)
- **Constraint:** This service does NOT manage raw WebSocket connections directly. Doing so would break the core Gateway multiplexing architecture. Also, never make an HTTP request to the `api-gateway` just to reach the `websocket-gateway` internal service.
- **Elite Logic:**
  - When the `ai-service` finishes generating a project, it drops a Kafka message: `topic: notification.alert`.
  - The `notification-service` consumes this.
  - It saves the alert to the Postgres `notifications` table (for historical viewing).
  - **The Reconnection Guarantee:** It pushes the alert payload to a bounded Redis List `LPUSH inbox:{user_id} {payload}` (capping at 100 via `LTRIM`).
  - It then instantly publishes a JSON payload to the **Redis Pub/Sub channel** `notifications:{user_id}`.
  - The `websocket-gateway` emits the packet to the browser. If the user's internet drops and reconnects, the frontend MUST explicitly fetch the `inbox:{user_id}` via REST to pull alerts missed while the WebSocket was dead.

### 2. Transactional Email Queue (AWS SES) & Poison Pills
- **Constraint:** Sending emails is a blocking, error-prone HTTP call. If AWS SES is down, the user's "Invite Collaborator" REST API call cannot hang for 10 seconds and return a 500 error. Furthermore, a malformed JSON payload cannot block the entire queue infinitely.
- **Elite Logic:**
  - All email requests MUST be pushed to a BullMQ queue (`queue: email`).
  - Workers inside `background-worker` or the `notification-service` pop the job.
  - Implement a strict idempotency key: Don't send the "Welcome" email twice if the queue worker crashes halfway.
  - Required Templates: `Verify Email`, `Password Reset`, `Payment Failed`, `Project Invite`.
  - **Dead Letter Queue (Extreme Rule):** If an email fails to send 3 times (Exponential Backoff: +5s, +30s, +2m), the worker MUST `ACK` the bad message to unblock the main line, and forcefully publish the exact payload into the `email.send_invitation.DLQ` (Dead Letter Queue) Kafka topic. PagerDuty must alert DevOps to inspect the poisoned JSON manually.

### 3. In-App Notification Batching
- **Constraint:** If an AI agent edits 50 files, generating 50 individual "File Updated" push notifications will crash the user's browser with toast popups.
- **Elite Logic:**
  - Implement a **Debounce/Batching Aggregator**.
  - Delay non-critical notifications by 3000ms. If 50 similar events occur within that window, group them into a single payload: `AI Agent modified 50 files in /src/components`.
