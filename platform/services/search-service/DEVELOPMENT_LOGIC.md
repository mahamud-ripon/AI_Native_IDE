# 🔍 Search Service — Development Logic & Architecture

> **Target:** `services/search-service/` (TypeScript / Node.js)
> **Port:** `8008`
> **Goal:** Full-text code search within projects, file name search, and public project discovery. Powered by Elasticsearch.
> **Standard:** Sub-100ms search latency. Zero data leaks (User A must NEVER see User B's private code).

## 📁 Required File Structure (Developer must follow)
```text
src/
 ├── controllers/
 │    ├── code_search_controller.ts    # GET /search/code — Full-text code search within project
 │    ├── file_search_controller.ts    # GET /search/files — File name search
 │    └── project_discovery_controller.ts # GET /search/projects — Public project discovery
 ├── services/
 │    ├── elasticsearch_client.ts      # Singleton ES client with connection pooling
 │    ├── index_manager.ts            # Creates/updates ES indices with proper mappings
 │    └── query_builder.ts            # Builds ES queries with security filters
 ├── indexers/
 │    ├── file_indexer.ts             # Kafka consumer: indexes file content on file.modified
 │    ├── project_indexer.ts          # Kafka consumer: indexes project metadata on project.created
 │    └── bulk_reindexer.ts           # Full project reindex (used on import or recovery)
 ├── events/
 │    └── kafka_consumer.ts           # Listens to file.modified, file.deleted, project.created, project.deleted
 └── config/
      └── mappings/                   # Elasticsearch index mapping JSON files
           ├── code_index.json        # Mapping for code content (custom analyzers)
           └── project_index.json     # Mapping for project metadata
```

## 🧠 Core Engineering Rules for Developer (DO NOT DEVIATE)

### 1. Elasticsearch Index Strategy
- **Constraint:** Do NOT create one giant index for all projects. Index isolation prevents data leaks and improves performance.
- **Logic:**
  - **Code Index:** `code_{project_id}` — One index per project. Contains file contents, paths, and languages.
  - **Project Index:** `projects_global` — Single index for project metadata (name, description, template, owner). Only `visibility: public` projects are searchable here.
  - Use custom analyzers: `code_analyzer` (camelCase splitting, underscore tokenizing) for code search. Standard analyzer for project discovery.

### 2. Real-Time Indexing via Kafka Events
- **Constraint:** Search results must be fresh within 5 seconds of a file save. Do NOT rely on batch reindexing.
- **Logic:**
  - Subscribe to Kafka topics: `file.modified`, `file.deleted`, `project.created`, `project.deleted`.
  - On `file.modified`: Fetch the file content from `project-service` (or inline from the event payload), and upsert the document in `code_{project_id}`.
  - On `file.deleted`: Delete the document from the ES index.
  - On `project.deleted`: Delete the entire `code_{project_id}` index to free resources.

### 3. Security: Tenant Isolation (CRITICAL)
- **Constraint:** A search query from User A must NEVER return results from User B's private project. This is a SOC2 compliance requirement.
- **Logic:**
  - The `api-gateway` injects `X-User-Id` into every request.
  - Before executing any search, the `search-service` MUST verify that `X-User-Id` is either the `owner_id` or exists in `project_collaborators` for the target `project_id`.
  - For public project discovery (`GET /search/projects`), ONLY query documents where `visibility = 'public'`.
  - **NEVER** support cross-project code search for non-admin users.

### 4. Query Performance & Pagination (ReDoS Defense)
- **Constraint:** Users typing rapidly trigger a search on every keystroke. We cannot run expensive queries 10 times per second. A malicious wildcard `*.*.*` can cause a ReDoS attack crashing the ES node.
- **Logic:**
  - Frontend MUST implement debounce (300ms minimum).
  - **Query Builder Caps:** The `query_builder.ts` MUST explicitly strip Regex operations (`RegexpQuery`) from user input and restrict wildcards to a maximum of 2 characters.
  - Backend MUST use ES `search_after` for cursor-based pagination (NOT `from/size` offset which degrades at depth limit `max_result_window=10000`).
  - Set `timeout: "5s"` and `terminate_after: 10000` on all ES queries to forcefully truncate runaway searches on massive codebases.
  - Limit results to 50 per page maximum.

---

## 🚀 API Endpoints Contract (Must Implement Exactly)

### GET `/api/v1/search/code`
- **Query:** `?project_id=uuid&q=useState&language=typescript&page_token=...`
- **Action:** Search within `code_{project_id}` index. Highlight matching lines. Return file path, line number, and surrounding context (3 lines above/below).
- **Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "file_path": "src/hooks/useAuth.ts",
        "language": "typescript",
        "matches": [
          { "line_number": 12, "content": "const [user, setUser] = useState(null);", "highlight": "useState" }
        ]
      }
    ],
    "total_hits": 47,
    "next_page_token": "..."
  }
}
```

### GET `/api/v1/search/files`
- **Query:** `?project_id=uuid&q=page.tsx`
- **Action:** Fuzzy file name search across the project's file tree. Use ES `wildcard` or `match_phrase_prefix`.
- **Response:** List of matching file paths with their IDs.

### GET `/api/v1/search/projects`
- **Query:** `?q=ecommerce&template=nextjs&sort=popular`
- **Action:** Search `projects_global` index. Only return `visibility: public` projects. Sort by `last_opened_at` or `fork_count`.
- **Response:** List of project cards (name, description, owner, template, stars).
