**AI-Native Cloud IDE Platform**

Bug Fix Reference for AI Assistants

Codebase Analysis Report --- March 2026

+-----------------+-----------------+-----------------+-----------------+
| **4**           | **5**           | **2**           | **14**          |
|                 |                 |                 |                 |
| **CRITICAL      | **HIGH          | **MEDIUM**      | **SERVICES      |
| BUGS**          | PRIORITY**      |                 | ANALYZED**      |
+-----------------+-----------------+-----------------+-----------------+

  -----------------------------------------------------------------------
  **HOW TO USE THIS DOCUMENT**

  This document is written specifically for an AI coding assistant (e.g.
  Claude, Cursor, Copilot) to use as task context when fixing the
  AI-Native IDE Platform codebase.

  Each bug entry contains: the exact file path, the root cause, the
  precise code fix, and the test to verify. Fix bugs in the priority
  order listed.

  All file paths are relative to: D:\\AI-Native-IDE\\platform\\

  Do not change any code outside the specified files for each bug. Each
  fix is surgical and isolated.
  -----------------------------------------------------------------------

**Master Issue Summary**

  ----------------------------------------------------------------------------------
  **\#**   **Severity**   **Issue**                          **File**
  -------- -------------- ---------------------------------- -----------------------
  **1**    **CRITICAL**   Inline file content never returned file.controller.ts
                          --- always empty string            

  **2**    **CRITICAL**   Dual-storage threshold not applied file.controller.ts
                          --- all files go to S3             

  **3**    **CRITICAL**   AgentState missing                 state_schema.py
                          code_execution_output field        

  **4**    **CRITICAL**   Invalid LLM model identifiers      graph_builder.py
                          break cost tracking                

  **5**    **HIGH**       Circuit breaker wraps no-op ---    circuit_breaker.ts
                          proxy never protected              

  **6**    **HIGH**       listProjects cursor pagination     project.controller.ts
                          broken on two-query merge          

  **7**    **HIGH**       Python AI agents service absent    docker-compose.yml
                          from docker-compose.yml            

  **8**    **HIGH**       requirements.txt missing critical  requirements.txt
                          Python dependencies                

  **9**    **HIGH**       React hook called inside non-hook  MonacoWrapper.tsx
                          callback (Rules of Hooks)          

  **10**   **MEDIUM**     syncFiles publishes non-standard   file.controller.ts
                          Kafka event envelope               

  **11**   **MEDIUM**     docker-compose uses PostgreSQL 15, docker-compose.yml
                          schema targets PG16                
  ----------------------------------------------------------------------------------

**SECTION 1 --- Critical Bugs**

These 4 bugs cause silent data loss or runtime crashes. Fix all of them
before running the platform.

**Bug #1 --- Inline File Content Never Returned**

  --------------- -------------------------------------------------------------
  **File**        services/project-service/src/controllers/file.controller.ts

  **Functions**   getFile and getFileContent

  **Severity**    **CRITICAL --- all small files return empty content**
  --------------- -------------------------------------------------------------

**Root Cause**

The Prisma schema implements a dual-storage strategy: files under 64 KB
are stored directly in PostgreSQL as inlineContent (BYTEA), while larger
files are stored in S3 with a s3Key reference. Both getFile and
getFileContent only check file.s3Key and completely ignore the
inlineContent field. Any file stored inline will always return an empty
string.

**Broken Code**

  -----------------------------------------------------------------------
  // Both functions have this same broken pattern:

  let content = \'\';

  if (file.s3Key) {

  const result = await storageService.downloadFile(file.s3Key);

  content = result.content;

  }

  // BUG: inlineContent is NEVER read --- inline files always return \'\'
  -----------------------------------------------------------------------

**Fix --- Replace the content-read block in BOTH functions**

  -----------------------------------------------------------------------
  // Replace the broken block above with this in getFile AND
  getFileContent:

  let content = \'\';

  if (file.inlineContent) {

  // Inline storage path --- decode BYTEA buffer to UTF-8 string

  content = file.inlineContent.toString(\'utf-8\');

  } else if (file.s3Key) {

  // S3 storage path --- download from object storage

  const result = await storageService.downloadFile(file.s3Key);

  content = result.content;

  }

  // Files with neither field are directories --- content stays \'\'
  -----------------------------------------------------------------------

**Verification**

-   Create a file with content under 64 KB (e.g. 10 lines of code)

-   Call GET /api/v1/projects/:id/files/:fileId --- response
    data.content must NOT be empty

-   Confirm s3Key is null and inlineContent is set in the DB row via
    Prisma Studio

**Bug #2 --- Dual-Storage Threshold Never Applied**

  --------------- -------------------------------------------------------------
  **File**        services/project-service/src/controllers/file.controller.ts

  **Functions**   createFile and syncFiles

  **Severity**    **CRITICAL --- violates architecture standard, wastes S3
                  costs**
  --------------- -------------------------------------------------------------

**Root Cause**

ARCHITECTURE_STANDARDS.md defines the 64 KB threshold: files ≤ 64 KB
must be stored inline in PostgreSQL (inlineContent BYTEA column), files
\> 64 KB go to S3. Neither createFile nor syncFiles implement this check
--- both unconditionally call storageService.uploadFile(), sending every
file to S3 regardless of size.

**Fix --- Add threshold logic in createFile**

Find the upload block in createFile (after the \"Check if file already
exists\" block) and replace it:

  -----------------------------------------------------------------------
  // BEFORE (broken --- always uploads to S3):

  if (!data.isDirectory && data.content) {

  const uploadResult = await storageService.uploadFile(id, data.path,
  data.content);

  s3Key = uploadResult.s3Key;

  contentHash = uploadResult.contentHash;

  sizeBytes = uploadResult.sizeBytes;

  }
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  // AFTER (correct --- applies 64 KB threshold):

  const INLINE_THRESHOLD = 64 \* 1024; // 64 KB

  if (!data.isDirectory && data.content) {

  const contentBuffer = Buffer.from(data.content, \'utf-8\');

  sizeBytes = contentBuffer.length;

  contentHash = hashContent(data.content);

  if (sizeBytes \<= INLINE_THRESHOLD) {

  // Small file --- store inline in PostgreSQL

  inlineContent = contentBuffer;

  s3Key = null;

  } else {

  // Large file --- upload to S3

  const uploadResult = await storageService.uploadFile(id, data.path,
  data.content);

  s3Key = uploadResult.s3Key;

  contentHash = uploadResult.contentHash;

  sizeBytes = uploadResult.sizeBytes;

  }

  }
  -----------------------------------------------------------------------

**Fix --- Add threshold logic in syncFiles**

Inside the for (const file of data.files) loop in syncFiles, replace
const uploadResult = await storageService.uploadFile(\...) with the same
threshold logic, storing the result in either inlineContent or s3Key as
appropriate. Then pass both values to prisma.projectFile.create/update.

**Prisma field to add on create**

  -----------------------------------------------------------------------
  // In prisma.projectFile.create({ data: { \... } }):

  // Add these two fields alongside s3Key and contentHash:

  inlineContent: inlineContent ?? undefined, // Buffer or undefined

  s3Key: s3Key ?? null,
  -----------------------------------------------------------------------

**Verification**

-   Create a file with content \< 64 KB --- confirm DB row has
    inline_content set and s3_key is NULL

-   Create a file with content \> 64 KB --- confirm DB row has s3_key
    set and inline_content is NULL

**Bug #3 --- AgentState Missing code_execution_output Field**

  -------------- ---------------------------------------------------------
  **File**       ai-agents/src/orchestrator/state_schema.py

  **Class**      AgentState

  **Severity**   **CRITICAL --- code execution results silently lost by
                 LangGraph**
  -------------- ---------------------------------------------------------

**Root Cause**

The \_run_code_execution method in graph_builder.py returns
{\"code_execution_output\": {\...}} but the Pydantic AgentState model
has no code_execution_output field. LangGraph merges node return values
into the state by field name --- unknown fields are silently discarded.
The execution result (which files were created, which patches were
applied) is never stored and can never be read by downstream steps or
callers.

**Fix --- Add missing field to AgentState**

In state_schema.py, find the AgentState class and add the following
field after security_output:

  -----------------------------------------------------------------------
  class AgentState(BaseModel):

  user_prompt: str

  project_id: str

  pm_output: Optional\[PMOutput\] = None

  architect_output: Optional\[ArchitectOutput\] = None

  backend_output: Optional\[CodeOutput\] = None

  frontend_output: Optional\[CodeOutput\] = None

  devops_output: Optional\[CodeOutput\] = None

  qa_output: Optional\[QAOutput\] = None

  security_output: Optional\[SecurityOutput\] = None

  \# ADD THIS LINE --- was missing, causing silent data loss:

  code_execution_output: Optional\[Dict\[str, Any\]\] = None

  iteration: Annotated\[int, operator.add\] = 0

  max_iterations: int = 3

  errors: Annotated\[List\[str\], operator.add\] =
  Field(default_factory=list)

  cost_sofar: float = 0.0
  -----------------------------------------------------------------------

**Required import (if not already present)**

  -----------------------------------------------------------------------
  from typing import Annotated, Any, Dict, List, Literal, Optional

  \# Dict and Any are needed for Optional\[Dict\[str, Any\]\]
  -----------------------------------------------------------------------

**Verification**

-   Run the pipeline with a simple prompt and a real project_id

-   After completion, inspect the returned AgentState ---
    state.code_execution_output must not be None

-   It should contain {\"success\": True, \"files_created\": \[\...\],
    \...}

**Bug #4 --- Invalid LLM Model Identifiers**

  -------------- ---------------------------------------------------------
  **File**       ai-agents/src/orchestrator/graph_builder.py

  **Severity**   **CRITICAL --- wrong model strings, breaks cost tracking
                 & LLM routing**
  -------------- ---------------------------------------------------------

**Root Cause**

Multiple calls to self.cost_aggregator.record_cost(\...) across all
agent runner methods use \"claude-3-sonnet\" and \"claude-3-opus\" as
the model argument. These are not valid Anthropic API model identifiers
--- all models require a version date suffix. The cost aggregator and
any pricing lookup will receive unknown model strings, producing None or
0.0 for all cost calculations. If these strings are ever forwarded to
the actual API client they will return a 404 error.

**Fix --- Replace all occurrences of invalid model strings**

Perform a search-and-replace across graph_builder.py for all
occurrences:

  ------------------------ --------- ------------------------------------------
  **FIND (wrong)**         **=\>**   **REPLACE WITH (correct)**

  \"claude-3-opus\"        =\>       \"claude-3-opus-20240229\"

  \"claude-3-sonnet\"      =\>       \"claude-3-5-sonnet-20241022\"
  ------------------------ --------- ------------------------------------------

Better long-term approach --- move model strings to environment
variables or a config file so they can be updated without code changes:

  -----------------------------------------------------------------------
  import os

  \# At the top of graph_builder.py, define model constants:

  MODEL_OPUS = os.getenv(\'LLM_MODEL_OPUS\', \'claude-3-opus-20240229\')

  MODEL_SONNET = os.getenv(\'LLM_MODEL_SONNET\',
  \'claude-3-5-sonnet-20241022\')

  \# Then replace all hardcoded strings with these constants.
  -----------------------------------------------------------------------

**SECTION 2 --- High Priority Bugs**

These bugs cause incorrect runtime behavior --- the platform runs but
specific features are broken or insecure.

**Bug #5 --- Circuit Breaker Wraps a No-Op**

  ------------- ---------------------------------------------------------
  **File**      services/api-gateway/src/proxy/circuit_breaker.ts

  ------------- ---------------------------------------------------------

**Root Cause**

The wrapWithCircuitBreaker function creates a CircuitBreaker around an
empty async () =\> {} no-op, then tries to replace breaker.fire directly
by mutating the opossum internals. This is not how opossum works ---
fire is not a replaceable property. The circuit breaker always fires the
original no-op and never the actual proxy function. As a result, the
circuit breaker never observes real failures and provides zero
protection.

**Fix --- Refactor circuit_breaker.ts**

Replace the wrapWithCircuitBreaker and getCircuitBreaker functions with
this corrected approach:

  -----------------------------------------------------------------------
  import CircuitBreaker from \'opossum\';

  // Map: serviceName -\> CircuitBreaker wrapping the real proxy fn

  const circuitBreakers = new Map\<string, CircuitBreaker\<any\>\>();

  /\*\*

  \* Create (or get) a circuit breaker that wraps a real async function.

  \* The function passed here is what gets protected.

  \*/

  export function createServiceBreaker\<T extends (\...args: any\[\]) =\>
  Promise\<any\>\>(

  serviceName: string,

  fn: T,

  options?: Partial\<CircuitBreakerOptions\>

  ): CircuitBreaker\<T\> {

  if (circuitBreakers.has(serviceName)) {

  return circuitBreakers.get(serviceName)!;

  }

  // CORRECT: pass the real function to the constructor

  const breaker = new CircuitBreaker(fn, {

  \...defaultOptions,

  \...options,

  name: serviceName,

  });

  breaker.on(\'open\', () =\> console.error(\`\[CB\] \${serviceName}
  OPEN\`));

  breaker.on(\'halfOpen\', () =\> console.warn(\`\[CB\] \${serviceName}
  HALF-OPEN\`));

  breaker.on(\'close\', () =\> console.info(\`\[CB\] \${serviceName}
  CLOSED\`));

  circuitBreakers.set(serviceName, breaker);

  return breaker;

  }
  -----------------------------------------------------------------------

**Fix --- Update proxy_router.ts to use the breaker correctly**

  -----------------------------------------------------------------------
  // In the route registration loop in proxy_router.ts:

  preHandler: async (request, reply) =\> {

  // Create the actual proxy call as the protected function

  const proxyFn = async () =\> {

  // forward request to upstream --- handled by \@fastify/http-proxy

  };

  const breaker = createServiceBreaker(route.serviceName, proxyFn);

  if (breaker.opened) {

  return reply.status(503).send({

  success: false,

  error: \`Service \${route.serviceName} is unavailable\`,

  code: \'SERVICE_UNAVAILABLE\'

  });

  }

  },
  -----------------------------------------------------------------------

**Bug #6 --- listProjects Cursor Pagination Broken**

  -------------- ----------------------------------------------------------------
  **File**       services/project-service/src/controllers/project.controller.ts

  **Function**   listProjects
  -------------- ----------------------------------------------------------------

**Root Cause**

The function runs two separate Prisma queries: one for owned projects
(with cursor support) and one for collaborated projects (with no cursor
at all). It then merges the two result sets in memory and slices them.
This completely breaks cursor-based pagination --- the second page will
not be consistent, as the cursor only positions the first query.
Collaborated projects are always fetched from the beginning, causing
duplicates and omissions across pages.

**Fix --- Use a single unified Prisma query**

  -----------------------------------------------------------------------
  // Replace the two-query approach with a single query using OR:

  const projects = await prisma.project.findMany({

  where: {

  deletedAt: null,

  OR: \[

  { ownerId: userId }, // user owns it

  {

  collaborators: {

  some: { userId }, // user is a collaborator

  },

  },

  \],

  \...(visibility && { visibility }),

  \...(status && { status }),

  },

  take: limit + 1,

  \...(cursor && { cursor: { id: cursor }, skip: 1 }),

  orderBy: { updatedAt: \'desc\' },

  include: {

  owner: { select: { id: true, username: true } },

  \_count: { select: { files: true, collaborators: true } },

  },

  });

  const hasMore = projects.length \> limit;

  const page_data = hasMore ? projects.slice(0, -1) : projects;

  const nextCursor = hasMore ? page_data\[page_data.length - 1\]?.id :
  undefined;
  -----------------------------------------------------------------------

**Bug #7 --- Python AI Agents Missing from docker-compose.yml**

  ------------- ---------------------------------------------------------
  **File**      docker-compose.yml

  ------------- ---------------------------------------------------------

**Root Cause**

The API gateway proxy router routes /api/v1/agents/\* to
http://ai-native-python-agents:9000, but no such service exists in
docker-compose.yml. Running the full stack with docker compose up will
leave all AI agent endpoints returning 503.

**Fix --- Add service block to docker-compose.yml**

Add the following service definition inside the services: block of
docker-compose.yml, after the ai-service block:

  -------------------------------------------------------------------------------------------------------------------------
  python-agents:

  build:

  context: ./ai-agents

  dockerfile: Dockerfile.dev

  container_name: ai-native-python-agents

  restart: unless-stopped

  ports:

  \- \'9000:9000\'

  environment:

  PYTHONUNBUFFERED: \'1\'

  PORT: 9000

  DATABASE_URL:
  postgres://\${POSTGRES_USER:-ainative}:\${POSTGRES_PASSWORD:-ainative_pass}@postgres:5432/\${POSTGRES_DB:-ainative_ide}

  REDIS_URL: redis://redis:6379

  KAFKA_BROKERS: kafka:29092

  ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}

  OPENAI_API_KEY: \${OPENAI_API_KEY:-}

  PROJECT_SERVICE_URL: http://ai-native-project-service:8003

  STORAGE_SERVICE_URL: http://ai-native-storage-service:8009

  depends_on:

  postgres:

  condition: service_healthy

  redis:

  condition: service_healthy

  kafka:

  condition: service_started

  volumes:

  \- ./ai-agents:/app

  command: uvicorn src.api.main:app \--host 0.0.0.0 \--port 9000 \--reload
  -------------------------------------------------------------------------------------------------------------------------

**Bug #8 --- requirements.txt Missing Critical Dependencies**

  ------------- ---------------------------------------------------------
  **File**      ai-agents/requirements.txt

  ------------- ---------------------------------------------------------

**Root Cause**

The current requirements.txt only declares 8 packages. It is missing the
Anthropic SDK, OpenAI SDK, Redis client, Kafka client, S3 client
(boto3), and database drivers. The agents will crash on first import of
any tool that uses these libraries.

**Fix --- Replace requirements.txt with the complete version**

  -----------------------------------------------------------------------
  \# Core LangGraph & LLM

  langgraph\>=0.2.0

  langchain-core\>=0.3.0

  langchain-anthropic\>=0.3.0

  langchain-openai\>=0.2.0

  anthropic\>=0.40.0

  openai\>=1.50.0

  \# API & Validation

  pydantic\>=2.0.0

  httpx\>=0.27.0

  fastapi\>=0.115.0

  uvicorn\[standard\]\>=0.30.0

  \# Infrastructure clients

  redis\>=5.0.0

  aiokafka\>=0.11.0

  boto3\>=1.34.0

  \# Database

  asyncpg\>=0.29.0

  sqlalchemy\[asyncio\]\>=2.0.0

  \# Utilities

  python-dotenv\>=1.0.0

  structlog\>=24.0.0

  \# Testing

  pytest\>=7.4.0

  pytest-asyncio\>=0.23.0

  pytest-cov\>=4.1.0
  -----------------------------------------------------------------------

**Bug #9 --- React Hook Called Inside Non-Hook Callback**

  -------------- ---------------------------------------------------------
  **File**       apps/ide/src/editor/MonacoWrapper.tsx

  **Function**   setupRemoteCursorDecorations
  -------------- ---------------------------------------------------------

**Root Cause**

The function setupRemoteCursorDecorations is a regular function (not a
hook) called inside the handleMount callback (which is itself inside
useCallback). Inside this function, useYjsStore.subscribe() is called.
React Rules of Hooks prohibit calling hooks (or their equivalents)
anywhere except directly inside a component or another hook. This will
cause ESLint rules-of-hooks errors and may break with React Strict Mode
or future concurrent features.

**Fix --- Move the subscription to a proper useEffect**

Remove setupRemoteCursorDecorations entirely. Add a new useEffect in the
component body that handles cursor decorations when remoteCursors or the
editor changes:

  -----------------------------------------------------------------------
  // ADD this useEffect in the MonacoWrapper component body

  // (after the existing useEffects, before the return statement):

  useEffect(() =\> {

  const editor = editorRef.current;

  const monaco = monacoRef.current;

  if (!editor \|\| !monaco) return;

  let decorationIds: string\[\] = \[\];

  const newDecorations = remoteCursors.map((cursor) =\> ({

  range: new monaco.Range(

  cursor.position.line, cursor.position.column,

  cursor.position.line, cursor.position.column + 1

  ),

  options: {

  isWholeLine: false,

  className: \'remote-cursor\',

  inlineClassName: \'remote-cursor-inline\',

  hoverMessage: { value: cursor.user.name },

  overviewRuler: {

  color: cursor.user.color,

  position: monaco.editor.OverviewRulerLane.Center,

  },

  },

  }));

  decorationIds = editor.deltaDecorations(decorationIds, newDecorations);

  return () =\> {

  editor.deltaDecorations(decorationIds, \[\]);

  };

  }, \[remoteCursors\]); // re-run whenever remote cursors change

  // REMOVE the call to setupRemoteCursorDecorations(monaco, editor)

  // from inside handleMount
  -----------------------------------------------------------------------

**SECTION 3 --- Medium Priority Issues**

**Issue #10 --- syncFiles Uses Non-Standard Kafka Envelope**

  ------------- -------------------------------------------------------------
  **File**      services/project-service/src/controllers/file.controller.ts

  ------------- -------------------------------------------------------------

**Root Cause**

The syncFiles function publishes to a non-standard topic
(\"project.files.events\") using a non-standard payload shape. It wraps
the event type (\"file.created\") inside the payload as a field, rather
than using the canonical KafkaEventEnvelope defined in
KAFKA_EVENT_CONTRACTS.md. Other Kafka consumers in the system expect the
standard envelope with top-level event_id, event_type, source_service,
trace_id, and version fields.

**Fix --- Standardize the Kafka publish call**

  -----------------------------------------------------------------------
  // Replace this (broken --- non-standard topic and envelope):

  await kafkaService.publish(\'project.files.events\', {

  event: existingFile ? \'file.modified\' : \'file.created\',

  projectId: id,

  fileId: fileRecord.id,

  filePath: file.path,

  userId,

  traceId,

  timestamp: Date.now()

  });

  // With this (correct --- standard topic and KafkaEventEnvelope):

  const eventType = existingFile ? \'file.modified\' : \'file.created\';

  await kafkaService.publish(eventType, {

  event_id: crypto.randomUUID(),

  event_type: eventType,

  timestamp: new Date().toISOString(),

  source_service: \'project-service\',

  trace_id: traceId,

  version: \'1.0\',

  payload: {

  project_id: id,

  file_id: fileRecord.id,

  file_path: file.path,

  user_id: userId,

  }

  });
  -----------------------------------------------------------------------

**Issue #11 --- docker-compose Uses PostgreSQL 15 (Should Be 16)**

  ------------- ---------------------------------------------------------
  **File**      docker-compose.yml and docker-compose.dev.yml

  ------------- ---------------------------------------------------------

**Fix**

Find the postgres image line in both compose files and update the tag:

  -----------------------------------------------------------------------
  \# FIND:

  image: pgvector/pgvector:pg15

  \# REPLACE WITH:

  image: pgvector/pgvector:pg16
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  **IMPORTANT: DATA MIGRATION WARNING**

  If you have an existing postgres_data Docker volume created with pg15,
  you MUST delete it before starting with pg16. PostgreSQL data
  directories are not cross-version compatible.

  Run: docker compose down -v (this destroys all local data)

  Then: docker compose up -d

  Then re-run: pnpm docker:db-init
  -----------------------------------------------------------------------

**SECTION 4 --- Fix Verification Checklist**

After applying all fixes, run through this checklist to confirm
correctness.

  -------- ------------------ ------------------------------------ -----------
  **\#**   **What to do**     **Expected result**                  **Bugs
                                                                   fixed**

  **1**    Create file \<     DB: inline_content set, s3_key =     **#1 #2**
           64KB via API       NULL; GET returns content            

  **2**    Create file \>     DB: s3_key set, inline_content =     **#1 #2**
           64KB via API       NULL; GET returns content            

  **3**    Run AI pipeline    state.code_execution_output is not   **#3**
           end-to-end         None, files written to project       

  **4**    Inspect            Model strings show versioned IDs     **#4**
           cost_aggregator    like claude-3-5-sonnet-20241022      
           logs                                                    

  **5**    Stop               503 returned immediately, not after  **#5**
           project-service,   timeout                              
           hit                                                     
           /api/v1/projects                                        

  **6**    GET                Page 2 has no overlap with page 1    **#6**
           /api/v1/projects   for user with 20+ projects           
           with cursor                                             
           parameter                                               

  **7**    docker compose up  python-agents container starts on    **#7 #8**
           \--build           port 9000                            

  **8**    Open IDE, edit a   Both cursors visible, no React hook  **#9**
           file with another  warnings in console                  
           browser tab                                             

  **9**    Check Kafka        Events consumed with event_id,       **#10**
           consumer logs      event_type, trace_id at top level    
           after syncFiles                                         

  **10**   docker compose up  PostgreSQL 16.x starts, db init      **#11**
           with pg16 image    succeeds                             
  -------- ------------------ ------------------------------------ -----------

**Files and Areas NOT to Modify**

  -----------------------------------------------------------------------
  **IMPORTANT FOR AI ASSISTANTS**

  The following files and areas are correct and should not be modified
  while applying the bug fixes in this document. They are listed here to
  prevent over-engineering or accidental breakage.
  -----------------------------------------------------------------------

  -------------------------------------------------- ----------------------------------------
  **File / Area**                                    **Reason it is correct**

  packages/database/prisma/schema.prisma             The full schema with all 28 tables is
                                                     correct. Both inlineContent and s3Key
                                                     fields exist as designed.

  services/api-gateway/src/middleware/edge_auth.ts   JWT auth middleware, header spoofing
                                                     defense, and RS256 verification are all
                                                     implemented correctly.

  ai-agents/src/orchestrator/state_schema.py (other  Only code_execution_output is missing.
  fields)                                            All other AgentState fields, CodeResult,
                                                     PatchOperation, and output models are
                                                     correct.

  ai-agents/src/orchestrator/graph_builder.py (DAG   The LangGraph node wiring, parallel
  logic)                                             executor, human-in-the-loop, and QA
                                                     retry loop logic are all correct. Only
                                                     model strings need changing.

  services/project-service/src/routes/index.ts       All route definitions and preHandler
                                                     auth hooks are correct.

  apps/ide/src/editor/MonacoWrapper.tsx (everything  Monaco binding, Yjs integration,
  except setupRemoteCursorDecorations)               awareness protocol, and cursor tracking
                                                     are all correct. Only the one
                                                     subscription call needs moving.

  docker-compose.yml (everything except postgres     All service definitions, health checks,
  image tag)                                         env vars, and volume mounts are correct.
                                                     Only the postgres image tag and the
                                                     missing python-agents service need to be
                                                     changed.
  -------------------------------------------------- ----------------------------------------

Document generated by automated codebase analysis of D:\\AI-Native-IDE •
**March 2026**
