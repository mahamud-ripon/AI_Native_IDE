# 🌿 IDE Frontend — Git Version Control UI Logic

> **Target:** `apps/ide/src/git/`
> **Goal:** Provide a seamless Visual Studio Code style Source Control UI. Allow users to stage (`git add`), commit (`git commit`), and view line-by-line diffs without opening a terminal.
> **Standard:** Remote Git Proxying. Optimized Diff calculations.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. The Remote Git Proxy
- **Constraint:** The browser cannot run `git`. All Git commands must execute on the `project-service` or `execution-service` where the physical files live.
- **Elite Logic:**
  - Create internal API hooks: `useGitStatus()`, `useGitCommit()`, `useGitPush()`.
  - Fetch the parsed status (staged, modified, untracked) from the backend.
  - Render these in categorized accordion lists.

### 2. Instant Diff Viewing
- **Constraint:** Clicking on a modified file in the Git Panel must instantly show what changed vs the `HEAD` commit.
- **Elite Logic:**
  - Fetch the raw text of the `HEAD` version and the `WorkingDirectory` version.
  - Mount a `MonacoEditor` in `diff` mode.
  - Do NOT allow the user to type inside the left (HEAD) panel. It must be strictly `readOnly`. The right panel can be editable.

### 3. Branch Switching & Auto-Saving
- **Constraint:** If a user clicks "Checkout branch 'feature-ui'", the entire file tree might change. Unsaved changes in the current tab could be lost or cause painful merge conflicts.
- **Elite Logic:**
  - Before executing the `git checkout` API call, force a sync of all `Y.Doc` local awareness changes to Postgres.
  - Warn the user if they have active uncommitted files that would be overwritten using a strict Radix UI Dialog.
