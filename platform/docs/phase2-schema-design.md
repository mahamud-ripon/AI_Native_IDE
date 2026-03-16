# Phase-2: Workflow Checkpoint Persistence - Schema Design

## Overview

This document defines the Prisma schema additions for workflow checkpoint persistence, enabling crash recovery and resume functionality for AI agent workflows.

---

## Enums

```prisma
enum WorkflowRunStatus {
  pending      // Created but not started
  running      // Currently executing
  paused       // User-initiated pause
  completed    // All steps finished successfully
  failed       // Workflow failed (non-recoverable)
  cancelled    // User cancelled
}

enum StepRunStatus {
  pending      // Queued for execution
  running      // Currently executing
  completed    // Finished successfully
  failed       // Step failed (may retry)
  skipped      // Skipped due to condition or idempotency
  cancelled    // Cancelled by user or system
}

enum CheckpointType {
  pre_step     // Before step execution
  post_step    // After step completion
  error        // On error (for debugging)
  manual       // User-initiated snapshot
}
```

---

## Core Models

### WorkflowRun

Represents one execution of a workflow (multi-agent orchestration).

```prisma
model WorkflowRun {
  id             String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  projectId      String             @map("project_id") @db.Uuid
  project        Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  // Workflow definition
  workflowName   String             @map("workflow_name") @db.VarChar(100)
  workflowVersion Int               @default(1) @map("workflow_version")
  
  // Execution state
  status         WorkflowRunStatus  @default(pending)
  currentStep    Int                @default(0) @map("current_step")
  totalSteps     Int                @default(0) @map("total_steps")
  
  // Context (agent memory, shared state)
  contextJson    Json?              @map("context_json")
  
  // Trigger info
  triggeredBy    String?            @map("triggered_by") @db.Uuid
  triggerType    String             @default("manual") @map("trigger_type") @db.VarChar(50)
  parentRunId    String?            @map("parent_run_id") @db.Uuid  // For nested workflows
  
  // Timing
  startedAt      DateTime?          @map("started_at") @db.Timestamptz()
  completedAt    DateTime?          @map("completed_at") @db.Timestamptz()
  createdAt      DateTime           @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt      DateTime           @updatedAt @map("updated_at") @db.Timestamptz()
  
  // Relations
  steps          StepRun[]
  checkpoints    Checkpoint[]
  
  // Metrics
  totalTokensIn  Int                @default(0) @map("total_tokens_in")
  totalTokensOut Int                @default(0) @map("total_tokens_out")
  totalCostUsd   Decimal?           @map("total_cost_usd") @db.Decimal(10, 6)
  
  // Error tracking
  errorMessage   String?            @map("error_message") @db.Text
  errorStep      Int?               @map("error_step")
  
  @@index([projectId])
  @@index([status])
  @@index([createdAt])
  @@map("workflow_runs")
}
```

### StepRun

Tracks individual step execution within a workflow.

```prisma
model StepRun {
  id             String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workflowRunId  String         @map("workflow_run_id") @db.Uuid
  workflowRun    WorkflowRun    @relation(fields: [workflowRunId], references: [id], onDelete: Cascade)
  
  // Step definition
  stepIndex      Int            @map("step_index")
  stepName       String         @map("step_name") @db.VarChar(100)
  agentName      String         @map("agent_name") @db.VarChar(50)
  
  // Execution state
  status         StepRunStatus  @default(pending)
  retryCount     Int            @default(0) @map("retry_count")
  maxRetries     Int            @default(3) @map("max_retries")
  
  // Input/Output (small data only - large outputs go to object storage)
  inputJson      Json?          @map("input_json")
  outputJson     Json?          @map("output_json")
  outputS3Key    String?        @map("output_s3_key") @db.Text  // For large outputs
  
  // Timing
  startedAt      DateTime?      @map("started_at") @db.Timestamptz()
  completedAt    DateTime?      @map("completed_at") @db.Timestamptz()
  durationMs     Int?           @map("duration_ms")
  
  // LLM metrics
  tokensIn       Int            @default(0) @map("tokens_in")
  tokensOut      Int            @default(0) @map("tokens_out")
  costUsd        Decimal?       @map("cost_usd") @db.Decimal(10, 6)
  provider       String?        @db.VarChar(50)
  model          String?        @db.VarChar(100)
  
  // Tracing
  requestId      String?        @map("request_id") @db.VarChar(100)  // LLM gateway request ID
  
  // Error handling
  errorMessage   String?        @map("error_message") @db.Text
  errorStack     String?        @map("error_stack") @db.Text
  
  createdAt      DateTime       @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt      DateTime       @updatedAt @map("updated_at") @db.Timestamptz()
  
  @@unique([workflowRunId, stepIndex])
  @@index([workflowRunId])
  @@index([status])
  @@index([agentName])
  @@map("step_runs")
}
```

### Checkpoint

Snapshot of workflow state for crash recovery.

```prisma
model Checkpoint {
  id             String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workflowRunId  String          @map("workflow_run_id") @db.Uuid
  workflowRun    WorkflowRun     @relation(fields: [workflowRunId], references: [id], onDelete: Cascade)
  
  // Checkpoint metadata
  type           CheckpointType  @default(post_step)
  stepIndex      Int             @map("step_index")
  stepName       String          @map("step_name") @db.VarChar(100)
  
  // State snapshot
  stateJson      Json            @map("state_json")  // Agent memory, context, variables
  
  // Optional: Large state stored externally
  stateS3Key     String?         @map("state_s3_key") @db.Text
  
  createdAt      DateTime        @default(now()) @map("created_at") @db.Timestamptz()
  
  @@index([workflowRunId])
  @@index([workflowRunId, stepIndex])
  @@map("checkpoints")
}
```

---

## StateJson Structure

The `stateJson` field in Checkpoint stores:

```typescript
interface WorkflowState {
  // Agent memory per agent
  agentMemory: Record<string, {
    messages: Array<{ role: string; content: string }>;
    variables: Record<string, unknown>;
    lastOutput?: string;
  }>;
  
  // Shared workflow context
  context: {
    projectId: string;
    userId: string;
    conversationId?: string;
    variables: Record<string, unknown>;
  };
  
  // Execution progress
  progress: {
    completedSteps: number[];
    failedSteps: number[];
    skippedSteps: number[];
    currentStep: number;
  };
  
  // Timestamps
  timestamp: string;
}
```

---

## Resume Algorithm

```
1. Find latest Checkpoint for WorkflowRun
2. Load stateJson into memory
3. Determine resume point:
   - If checkpoint type = pre_step: resume from that step
   - If checkpoint type = post_step: resume from next step
4. Check idempotency:
   - If step already completed (in progress.completedSteps): skip
5. Continue execution from resume point
```

---

## Kafka Events

New event types for workflow observability:

| Topic | Description |
|-------|-------------|
| `workflow.run.started` | Workflow execution started |
| `workflow.step.started` | Step execution started |
| `workflow.step.completed` | Step finished successfully |
| `workflow.step.failed` | Step failed |
| `workflow.run.completed` | All steps finished |
| `workflow.run.failed` | Workflow failed (non-recoverable) |
| `workflow.checkpoint.created` | Checkpoint saved |

### Event Payload Structure

```typescript
interface WorkflowEvent {
  eventId: string;
  timestamp: string;
  
  // Workflow context
  workflowRunId: string;
  workflowName: string;
  projectId: string;
  
  // Step context (for step events)
  stepRunId?: string;
  stepIndex?: number;
  stepName?: string;
  agentName?: string;
  
  // Metrics
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationMs?: number;
  
  // Status
  status: string;
  errorMessage?: string;
}
```

---

## Database Transactions

### Atomic Step Completion

```typescript
// Must be atomic
await prisma.$transaction([
  // 1. Update StepRun
  prisma.stepRun.update({
    where: { id: stepId },
    data: {
      status: 'completed',
      outputJson,
      completedAt: new Date(),
      tokensIn,
      tokensOut,
      costUsd,
    }
  }),
  
  // 2. Create Checkpoint
  prisma.checkpoint.create({
    data: {
      workflowRunId,
      type: 'post_step',
      stepIndex,
      stepName,
      stateJson,
    }
  }),
  
  // 3. Update WorkflowRun progress
  prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: {
      currentStep: stepIndex + 1,
      totalTokensIn: { increment: tokensIn },
      totalTokensOut: { increment: tokensOut },
    }
  })
]);
```

---

## Large Output Handling

For outputs > 64KB:

1. Store in S3/Object Storage
2. Save `outputS3Key` in StepRun
3. Keep summary in `outputJson`

```typescript
interface LargeOutputRef {
  s3Key: string;
  sizeBytes: number;
  mimeType: string;
  summary: string;  // Brief description
}
```

---

## Relations to Existing Models

### Project (existing)

Add relation:
```prisma
model Project {
  // ... existing fields
  workflowRuns  WorkflowRun[]
}
```

### AiConversation (existing)

Add optional link:
```prisma
model AiConversation {
  // ... existing fields
  workflowRunId  String?        @map("workflow_run_id") @db.Uuid
  workflowRun    WorkflowRun?   @relation(fields: [workflowRunId], references: [id])
}
```

---

## Indexes Summary

| Model | Indexes |
|-------|---------|
| WorkflowRun | projectId, status, createdAt |
| StepRun | workflowRunId, status, agentName, unique(workflowRunId, stepIndex) |
| Checkpoint | workflowRunId, (workflowRunId, stepIndex) |

---

## Questions for Review

1. **Retention Policy**: Should we auto-delete checkpoints after N days?
2. **Max Checkpoints**: Limit checkpoints per workflow to prevent storage bloat?
3. **State Versioning**: Handle schema migrations for stateJson?
4. **Nested Workflows**: Is parentRunId needed for sub-workflow support?

---

## Implementation Order

1. Add enums to schema
2. Add WorkflowRun, StepRun, Checkpoint models
3. Add relations to Project, AiConversation
4. Run migration
5. Implement workflow engine
6. Implement resume logic
7. Add Kafka events
