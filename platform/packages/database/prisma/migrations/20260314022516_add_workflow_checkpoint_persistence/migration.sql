-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "StepRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "CheckpointType" AS ENUM ('pre_step', 'post_step', 'error', 'manual');

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "workflow_name" VARCHAR(100) NOT NULL,
    "workflow_version" INTEGER NOT NULL DEFAULT 1,
    "workflow_definition_json" JSONB,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'pending',
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "total_steps" INTEGER NOT NULL DEFAULT 0,
    "resume_from_step" INTEGER,
    "context_json" JSONB,
    "triggered_by" UUID,
    "trigger_type" VARCHAR(50) NOT NULL DEFAULT 'manual',
    "parent_run_id" UUID,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "total_tokens_in" INTEGER NOT NULL DEFAULT 0,
    "total_tokens_out" INTEGER NOT NULL DEFAULT 0,
    "total_cost_usd" DECIMAL(10,6),
    "error_message" TEXT,
    "error_step" INTEGER,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflow_run_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_name" VARCHAR(100) NOT NULL,
    "agent_name" VARCHAR(50) NOT NULL,
    "status" "StepRunStatus" NOT NULL DEFAULT 'pending',
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "input_json" JSONB,
    "output_json" JSONB,
    "output_s3_key" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "duration_ms" INTEGER,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6),
    "provider" VARCHAR(50),
    "model" VARCHAR(100),
    "request_id" VARCHAR(100),
    "error_message" TEXT,
    "error_stack" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "step_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflow_run_id" UUID NOT NULL,
    "type" "CheckpointType" NOT NULL DEFAULT 'post_step',
    "step_index" INTEGER NOT NULL,
    "step_name" VARCHAR(100) NOT NULL,
    "state_json" JSONB NOT NULL,
    "state_s3_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_runs_project_id_idx" ON "workflow_runs"("project_id");

-- CreateIndex
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs"("status");

-- CreateIndex
CREATE INDEX "workflow_runs_created_at_idx" ON "workflow_runs"("created_at");

-- CreateIndex
CREATE INDEX "step_runs_workflow_run_id_idx" ON "step_runs"("workflow_run_id");

-- CreateIndex
CREATE INDEX "step_runs_status_idx" ON "step_runs"("status");

-- CreateIndex
CREATE INDEX "step_runs_agent_name_idx" ON "step_runs"("agent_name");

-- CreateIndex
CREATE INDEX "step_runs_request_id_idx" ON "step_runs"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "step_runs_workflow_run_id_step_index_key" ON "step_runs"("workflow_run_id", "step_index");

-- CreateIndex
CREATE INDEX "checkpoints_workflow_run_id_idx" ON "checkpoints"("workflow_run_id");

-- CreateIndex
CREATE INDEX "checkpoints_workflow_run_id_step_index_idx" ON "checkpoints"("workflow_run_id", "step_index");

-- CreateIndex
CREATE INDEX "checkpoints_workflow_run_id_created_at_idx" ON "checkpoints"("workflow_run_id", "created_at");

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_runs" ADD CONSTRAINT "step_runs_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
