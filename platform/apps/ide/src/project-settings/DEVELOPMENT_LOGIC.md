# ⚙️ IDE Frontend — Project Settings Logic

> **Target:** `apps/ide/src/project-settings/`
> **Goal:** Manage configuration distinct to an individual project, bypassing the code editor. Think "Project Name, Production Domains, or Danger Zone (Delete)".
> **Standard:** Danger Zones. Custom Domain configurations.

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Custom Domains Mapping 
- **Constraint:** A user deploying their blog needs it to exist on `user.com`, not the default `project.platform.io`.
- **Elite Logic:**
  - When a user enters a custom domain in the UI input (`www.myblog.com`), format the request to `POST /v1/projects/:id/domains`.
  - The `project-service` registers the domain via the DNS provider (e.g., Cloudflare/Vercel API).
  - The API MUST return the required DNS `A` Record and `CNAME` values.
  - Render an elegant table visually explaining: `Please add these records to your GoDaddy DNS settings: Type: CNAME, Name: www, Value: cname.platform.io`.
  - Provide a shiny "Verify Domain Status" button that executes a quick DNS `nslookup` (via backend API).

### 2. The Danger Zone (Deletion)
- **Constraint:** If a user clicks "Delete Project" by mistake, months of coding or entire companies' codebases vanish. This cannot be a simple modal.
- **Elite Logic:**
  - Implement a dedicated "Danger Zone" block at the absolute bottom of the Project Settings tab.
  - When the "Delete" button is clicked, open a persistent Dialog Modal with a bright RED warning.
  - Force the user to explicitly type the full name of the project (e.g., `Type "my-awesome-startup" to confirm`).
  - Disable the final Submit button strictly until the input string `.trim() === project.name`.
  - Upon success, immediately re-route the user back to the `/dashboard`, clear the local active `Y.Doc` cache, and purge the Zustand `fileMap` instantly to prevent the IDE from looking for missing ghost API requests.
