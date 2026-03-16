# Packages - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `platform/packages/`  
> **Tech Stack:** TypeScript, Prisma, React

---

## 1. Executive Summary

The `packages/` directory contains shared libraries used across all apps and services in the monorepo. These packages provide database access, type definitions, configuration, and UI components.

---

## 2. Package Structure

```
packages/
├── config/          # Environment & app configuration
├── database/        # Prisma client & database utilities
├── shared-types/    # Shared TypeScript types
└── ui/              # Shared React UI components
```

---

## 3. Database Package

### 3.1 Overview

The database package provides Prisma client and database utilities. It is the single source of truth for database schema.

### 3.2 Package Configuration

```json
// packages/database/package.json
{
  "name": "@workspace/database",
  "version": "1.0.0",
  "private": true,
  "main": "src/client.ts",
  "scripts": {
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@prisma/client": "^5.10.0"
  },
  "devDependencies": {
    "prisma": "^5.10.0",
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
```

### 3.3 Prisma Client (src/client.ts)

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
```

### 3.4 Schema Overview (prisma/schema.prisma)

#### Enums

| Enum | Values |
|------|--------|
| PlanType | FREE, PRO, TEAM, ENTERPRISE |
| OAuthProvider | github, google, gitlab |
| OrgRole | owner, admin, developer, viewer |
| ProjectVisibility | private, public, org |
| ProjectRole | owner, editor, viewer |
| VmStatus | creating, active, hibernated, restoring, failed |
| DeployProvider | vercel, railway, aws, gcp, azure |
| DeployStatus | pending, building, deployed, failed |
| ExecutionStatus | running, success, error, timeout, killed |
| ConversationStatus | queued, pending, running, completed, failed, cancelled |
| ProjectStatus | pending, active, failed_creation, archived, deleted |
| MessageRole | user, assistant, system, tool |

#### Core Models

**User**
```prisma
model User {
  id               String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email            String    @unique @db.VarChar(255)
  username         String    @unique @db.VarChar(50)
  hashedPassword   String?   @map("hashed_password") @db.Text
  fullName         String?   @map("full_name") @db.VarChar(255)
  avatarUrl        String?   @map("avatar_url") @db.Text
  stripeCustomerId String?   @unique @map("stripe_customer_id") @db.VarChar(255)
  isVerified       Boolean   @default(false) @map("is_verified")
  isActive         Boolean   @default(true) @map("is_active")
  mfaEnabled       Boolean   @default(false) @map("mfa_enabled")
  lastActiveAt     DateTime? @map("last_active_at") @db.Timestamptz()
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  
  refreshTokens      RefreshToken[]
  oauthAccounts      OAuthAccount[]
  apiKeys            ApiKey[]
  settings           UserSettings?
  ownedOrgs          Organization[]
  projectMemberships ProjectCollaborator[]
  aiConversations    AiConversation[]
  codeExecutions     CodeExecution[]
  deployments        Deployment[]
  subscription       Subscription?
}
```

**Project**
```prisma
model Project {
  id           String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  ownerId      String            @map("owner_id") @db.Uuid
  orgId        String?           @map("org_id") @db.Uuid
  name         String            @db.VarChar(255)
  slug         String            @db.VarChar(100)
  description  String?           @db.Text
  template     String?           @db.VarChar(100)
  visibility   ProjectVisibility
  status       ProjectStatus     @default(pending)
  gitRepoUrl   String?           @map("git_repo_url") @db.Text
  framework    String?           @db.VarChar(100)
  createdAt    DateTime          @default(now()) @map("created_at") @db.Timestamptz()
  
  owner User          @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  branches        ProjectBranch[]
  files           ProjectFile[]
  collaborators   ProjectCollaborator[]
  secrets         ProjectSecret[]
  aiConversations AiConversation[]
  codeExecutions  CodeExecution[]
  deployments     Deployment[]
  
  @@unique([ownerId, slug])
  @@index([status])
}
```

**ProjectFile**
```prisma
model ProjectFile {
  id            String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  projectId     String        @map("project_id") @db.Uuid
  branchId      String        @map("branch_id") @db.Uuid
  parentId      String?       @map("parent_id") @db.Uuid
  path          String        @db.Text
  name          String        @db.VarChar(255)
  contentHash   String?       @map("content_hash") @db.VarChar(64)
  s3Key         String?       @map("s3_key") @db.Text
  inlineContent Bytes?        @map("inline_content")
  sizeBytes     Int?          @map("size_bytes")
  language      String?       @db.VarChar(50)
  isDirectory   Boolean       @default(false) @map("is_directory")
  
  branch      ProjectBranch @relation(fields: [branchId], references: [id], onDelete: Cascade)
  parent      ProjectFile?  @relation("DirectoryTree", fields: [parentId], references: [id])
  children    ProjectFile[] @relation("DirectoryTree")
  
  @@index([projectId])
  @@index([branchId])
}
```

### 3.5 Usage

```typescript
// In any service/app
import { prisma } from '@workspace/database';

// Query users
const users = await prisma.user.findMany();

// Create project
const project = await prisma.project.create({
  data: {
    name: 'My Project',
    slug: 'my-project',
    ownerId: userId,
    visibility: 'private',
  },
});
```

---

## 4. Config Package

### 4.1 Purpose

Centralized configuration management for environment variables and app settings.

### 4.2 Structure

```
packages/config/
├── src/
│   ├── index.ts          # Main exports
│   ├── env.ts            # Environment validation
│   └── constants.ts      # App constants
├── package.json
└── tsconfig.json
```

### 4.3 Implementation (src/env.ts)

```typescript
import { z } from 'zod';

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  
  // Redis
  REDIS_URL: z.string().url(),
  
  // Kafka
  KAFKA_BROKERS: z.string(),
  
  // Auth
  JWT_PRIVATE_KEY: z.string(),
  JWT_PUBLIC_KEY: z.string(),
  
  // API Keys
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8000),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
```

### 4.4 Constants (src/constants.ts)

```typescript
export const APP_NAME = 'AI-Native IDE';

export const API_VERSIONS = {
  v1: '/api/v1',
} as const;

export const DEFAULT_LIMITS = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxProjectSize: 100 * 1024 * 1024, // 100MB
  maxConcurrentBuilds: 3,
} as const;

export const VM_SPECS = {
  small: { cpu: 1, memory: '2Gi' },
  medium: { cpu: 2, memory: '4Gi' },
  large: { cpu: 4, memory: '8Gi' },
} as const;
```

---

## 5. Shared Types Package

### 5.1 Purpose

Shared TypeScript types used across all apps and services.

### 5.2 Structure

```
packages/shared-types/
├── src/
│   ├── index.ts          # Main exports
│   ├── api.ts            # API types
│   ├── user.ts           # User types
│   ├── project.ts        # Project types
│   └── ai.ts             # AI agent types
├── package.json
└── tsconfig.json
```

### 5.3 API Types (src/api.ts)

```typescript
export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListQueryParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}
```

### 5.4 User Types (src/user.ts)

```typescript
export interface User {
  id: string;
  email: string;
  username: string;
  fullName?: string;
  avatarUrl?: string;
  isVerified: boolean;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface UserSession {
  userId: string;
  sessionId: string;
  expiresAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
```

### 5.5 Project Types (src/project.ts)

```typescript
export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  visibility: 'private' | 'public' | 'org';
  framework?: string;
  language?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  name: string;
  isDirectory: boolean;
  language?: string;
  sizeBytes?: number;
}

export interface ProjectBranch {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  headCommitSha?: string;
}
```

### 5.6 AI Types (src/ai.ts)

```typescript
export interface AiConversation {
  id: string;
  projectId: string;
  messages: AiMessage[];
  createdAt: string;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
}

export interface AgentExecution {
  id: string;
  agentType: 'pm' | 'architect' | 'backend' | 'frontend' | 'devops' | 'qa' | 'security';
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  completedAt?: string;
}
```

---

## 6. UI Package

### 6.1 Purpose

Shared React UI components used across frontend applications.

### 6.2 Structure

```
packages/ui/
├── src/
│   ├── components/       # Reusable components
│   │   ├── Button/
│   │   ├── Input/
│   │   ├── Modal/
│   │   └── ...
│   ├── hooks/            # Shared hooks
│   ├── utils/            # Utility functions
│   ├── index.ts          # Main exports
│   └── theme.ts          # Theme configuration
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### 6.3 Package Configuration

```json
// packages/ui/package.json
{
  "name": "@workspace/ui",
  "version": "1.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./components": "./src/components/index.ts",
    "./hooks": "./src/hooks/index.ts"
  },
  "peerDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

### 6.4 Theme Configuration (src/theme.ts)

```typescript
import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#6366f1', // Indigo
    },
    secondary: {
      main: '#22d3ee', // Cyan
    },
    background: {
      default: '#0f172a', // Slate 900
      paper: '#1e293b',   // Slate 800
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", sans-serif',
    h1: { fontSize: '2.5rem', fontWeight: 700 },
    h2: { fontSize: '2rem', fontWeight: 600 },
    h3: { fontSize: '1.5rem', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8,
        },
      },
    },
  },
});
```

### 6.5 Component Example (src/components/Button.tsx)

```typescript
import React from 'react';
import { Button as MuiButton, ButtonProps as MuiButtonProps } from '@mui/material';

export interface ButtonProps extends MuiButtonProps {
  variant?: 'primary' | 'secondary' | 'outline';
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  children,
  ...props
}) => {
  const variantMap = {
    primary: 'contained',
    secondary: 'outlined',
    outline: 'text',
  };

  return (
    <MuiButton variant={variantMap[variant]} {...props}>
      {children}
    </MuiButton>
  );
};
```

### 6.6 Main Exports (src/index.ts)

```typescript
export * from './components/Button';
export * from './components/Input';
export * from './components/Modal';
export * from './theme';
```

---

## 7. Usage in Apps/Services

### 7.1 Adding Dependencies

```bash
# In any app/service
pnpm add @workspace/database @workspace/config @workspace/shared-types @workspace/ui
```

### 7.2 Importing

```typescript
// Using database
import { prisma } from '@workspace/database';

// Using config
import { env } from '@workspace/config';
import { APP_NAME } from '@workspace/config/constants';

// Using types
import type { Project, User } from '@workspace/shared-types';

// Using UI components
import { Button, Input } from '@workspace/ui';
```

---

## 8. Implementation Status

| Package | Status |
|---------|--------|
| database | ✅ Complete (Prisma schema) |
| config | ✅ Structure ready |
| shared-types | ✅ Structure ready |
| ui | ✅ Structure ready |

---

## 9. Key Implementation Notes

### 9.1 Database Package
- Single source of truth for schema
- Use UUIDs for all IDs
- Use Timestamptz for all timestamps
- Index frequently queried fields

### 9.2 Config Package
- Validate env vars at startup
- Use Zod for schema validation
- Export typed config

### 9.3 Shared Types
- Keep types in sync with Prisma schema
- Use strict typing
- Export from index.ts

### 9.4 UI Package
- Use Material UI as base
- Export components, hooks, utils
- Support dark/light themes
