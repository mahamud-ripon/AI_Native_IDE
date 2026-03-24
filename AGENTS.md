# AI-Native IDE - Agent Coding Guide

## Project Overview

Cloud-based IDE monorepo: **pnpm + Turborepo + React/Vite + Fastify + Python LangGraph + PostgreSQL/Prisma**

```
platform/
├── apps/          # ide (React+Vite), admin (Next.js), marketing-site (Next.js)
├── packages/      # config, database (Prisma), shared-types, ui (Radix)
├── services/      # 14 microservices (Fastify, TypeScript)
└── ai-agents/     # Python LangGraph multi-agent engine
```

---

## Build/Lint/Test Commands

```bash
# Root (from platform/)
pnpm install / build / test / lint / lint:fix / typecheck / format / clean
pnpm db:generate / db:push / db:migrate
pnpm docker:build / docker:up / docker:dev

# Run single service test (Vitest)
cd platform/services/<service> && pnpm test -- --testPathPattern=<pattern>
pnpm test -- --testNamePattern="test name"

# Python AI agents (pytest)
cd platform/ai-agents
pytest tests/test_file.py        # specific file
pytest -k "test_name"            # pattern match
pytest --cov=src                 # coverage

# Dev mode
pnpm dev                                    # all services
cd platform/services/<service> && pnpm dev  # single service
cd platform/ai-agents && python -m uvicorn src.api.main:app --reload --port 9000
```

---

## Code Style

### TypeScript
- **Strict mode** enabled, ES2022 target, `bundler` module resolution
- No implicit `any` — use explicit types or `unknown`
- 2-space indent, single quotes, trailing commas, semicolons

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Components | PascalCase files | `UserProfile.tsx` |
| Utilities | kebab-case files | `format-date.ts` |
| Functions | camelCase | `getUserById()` |
| Classes/Interfaces | PascalCase | `UserService`, `ApiResponse` |
| Constants | UPPER_SNAKE | `MAX_RETRIES` |
| DB Tables | snake_case, plural | `project_files` |
| API Routes | `/api/v1/{resource}` | `/api/v1/projects/{id}` |

### Imports (group order)
1. External libraries (React, Fastify)
2. Internal packages (`@workspace/...`)
3. Relative imports (`./utils`, `../services/user`)

```typescript
import { useState } from 'react';
import { useAuthStore } from '@workspace/shared-types';
import { UserService } from '../services/user';
```

### React
- Functional components + hooks
- **Zustand** for state, **Tailwind CSS** with `clsx`/`tailwind-merge`
- **Radix UI** primitives for accessibility

### Error Handling

**Backend:**
```typescript
try { return await userService.getById(id); }
catch (error) {
  if (error instanceof NotFoundError) return reply.status(404).send({ error: 'Not found' });
  throw error;
}
```

**Frontend:**
```typescript
const [error, setError] = useState<Error | null>(null);
try { await fetchUser(id); }
catch (err) { setError(err instanceof Error ? err : new Error('Unknown error')); }
```

### API Response Envelope
```json
{ "success": true, "data": {...}, "error": null, "trace_id": "req-uuid" }
```

---

## Architecture Notes

- **Services**: HTTP via API Gateway, circuit breakers, JWT auth, user context via `X-User-Id`/`X-User-Role`/`X-User-Email`
- **Database**: Prisma ORM + PostgreSQL; schema in `platform/packages/database`; run `pnpm db:generate` after changes
- **Env vars**: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` required; `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY` for AI
- **AI agents**: LangGraph DAG, Pydantic models for inter-agent comms, `MAX_RETRIES=3` for feedback loops, cost_manager.py for LLM routing

---

## Quick Reference

**Adding a service**: Create `platform/services/<name>/` → add `package.json` → add to workspaces → add routes to API Gateway

**Adding an API endpoint**: Add route → document in `DEVELOPMENT_LOGIC.md` → add circuit breaker if external call

**Docs**: [Architecture Standards](./ARCHITECTURE_STANDARDS.md) • [API Design](./platform/docs/API_DESIGN.md) • [DB Schema](./platform/packages/database/)
