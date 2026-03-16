# ⚡ IDE Client — WebContainers Exec Logic (Tier 1)

> **Target:** `apps/ide/src/webcontainers/`
> **Goal:** Run Node.js entirely inside the browser using WASM (WebContainers) for Free Tier users. Save 100% of Cloud compute costs for simple JS/TS projects.
> **Standard:** Complete OS emulation. Secure IFrame interception. Zero server bills.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Boot Sequence & OS Emulation
- **Constraint:** Node.js cannot run natively in Chrome API.
- **Elite Logic:**
  - Import `@webcontainer/api`.
  - On IDE mount (if user is Free Tier and project is Node.js), call `WebContainer.boot()`.
  - **Important:** This boot process must happen asynchronously in the background while the UI loads. Do not block the React render cycle.
  - Show a skeleton loader in the Terminal window until `boot()` resolves.

### 2. VFS (Virtual File System) Synchronization
- **Constraint:** The true files live in the PostgreSQL database (`project-service`), but WebContainers needs them in its local memory.
- **Elite Logic:**
  - Fetch the `GET /api/v1/projects/:id/tree`.
  - Recursively parse the nested JSON and construct a `FileSystemTree` object.
  - Call `webcontainerInstance.mount(tree)`.
  - **Two-way Sync:** If the AI Agent or Collab Service updates a file (`yText` change), you MUST write that change to WebContainers via `webcontainerInstance.fs.writeFile('/path', newText)`. If you skip this, `npm run dev` will execute stale code.

### 3. IFrame Preview Network Interception
- **Constraint:** When `npm run dev` starts in WebContainers, it does not open a real `localhost:3000` port on the user's Wi-Fi card. It's virtual.
- **Elite Logic:**
  - Listen to the `server-ready` event from WebContainer.
  - Extract the virtual URL (`https://1234-abcd.local.webcontainer.io`).
  - Inject this URL into the `<iframe src={url}>` in the Preview pane (`src/preview/`).
  - Secure the iframe using `sandbox="allow-same-origin allow-scripts allow-forms allow-popups"`.

### 4. XTerm.js Terminal PTY Binding
- **Constraint:** The user must be able to type standard bash commands like `ls` and `npm install`.
- **Elite Logic:**
  - Spawn a JSH (JavaScript Shell) process: `const shellProcess = await webcontainerInstance.spawn('jsh');`
  - Pipe the JSH output to XTerm.js:
    ```typescript
    shellProcess.output.pipeTo(
      new WritableStream({ write(data) { xterm.write(data); } })
    );
    ```
  - Pipe XTerm.js input back to JSH:
    ```typescript
    xterm.onData((data) => {
      inputWriter.write(data);
    });
    ```
