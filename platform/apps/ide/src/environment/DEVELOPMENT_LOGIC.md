# ☁️ IDE Frontend — Firecracker VM Environment Logic

> **Target:** `apps/ide/src/environment/`
> **Goal:** Manage the UI states for the user's underlying compute environment (Tier-2 Firecracker VMs). Show when the VM is sleeping to save money, waking up, or out of memory.
> **Standard:** Non-intrusive Alerts. Instant Wake commands.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Sleep / Hibernation Indicator
- **Constraint:** VMs go to sleep (Snapshot to disk) after 15 minutes of inactivity as per the `background-worker` rules. If a user returns and hits "Run API", they need to know why it takes 3 seconds to respond instead of 50ms.
- **Elite Logic:**
  - In the bottom right Footer (Status Bar), render a colored dot indicator alongside the text: `[🟢 Running]`, `[🟡 Waking (3s)]`, `[😴 Hibernating]`, or `[🔴 Crashed]`.
  - Poll the `execution-service` VM status endpoint every 30 seconds, OR rely on a WebSocket ping.

### 2. Manual Wake & Overrides
- **Constraint:** If a VM is hibernating, typing code should wake it up, but sometimes the user just wants to force a reboot.
- **Elite Logic:**
  - If the user clicks the Status Indicator, open a Radix UI Popover.
  - Provide explicit buttons: "Wake Environment", "Restart VM", or "Hard Reset (Wipes non-persistent data)".
  - When triggered, show a skeleton loader over the Terminal and Preview Iframe panes explicitly, since these components rely 100% on the VM being active. Do NOT block the text editor; they can keep writing code locally (Yjs handles it) while the VM reboots.

### 3. Resource Exhaustion Warnings
- **Constraint:** If the user creates an infinite loop in their code, the VM CPU hits 100% and crashes.
- **Elite Logic:**
  - If the `execution-service` WebSocket emits a `{ type: "resource_exhausted", message: "OOM Killed" }` event, trigger an un-missable Red Toast Header right at the top of the IDE.
  - Guide the user: "Your app ran out of memory. [Restart Server] or [Ask AI to find the Leak]".
