import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Prewarmer } from '../vm_manager/prewarmer.js';
import { TerminalPTY } from '../streams/terminal_pty.js';
import { SnapshotManager } from '../vm_manager/snapshot_manager.js';
import { VaultAgent } from '../security/vault_agent.js';
import { KafkaPublisher } from '../events/kafka_publisher.js';
import { prisma } from '../lib/prisma.js';
import { redis, RedisKeys } from '../lib/redis.js';
import { z } from 'zod';

const RunSchema = z.object({
  projectId: z.string().uuid(),
  command: z.string().min(1),
  env: z.record(z.string()).optional()
});

const InstallSchema = z.object({
  projectId: z.string().uuid(),
  packageManager: z.enum(['npm', 'pip', 'cargo', 'go']),
  packages: z.array(z.string()).min(1)
});

export const ExecutionController = {
  // POST /api/v1/exec/run
  async runCode(request: Request, reply: Response) {
    try {
      const data = RunSchema.parse(request.body);
      const userId = (request as any).user.id;

      // Verify user has execute permission
      const collaborator = await prisma.projectCollaborator.findFirst({
        where: {
          projectId: data.projectId,
          userId: userId as string,
          role: { in: ['owner', 'editor'] }
        }
      });

      if (!collaborator) {
        return reply.status(403).send({ error: 'Execute permission denied' });
      }

      // Get VM from pool
      const vmId = await Prewarmer.acquireVM();

      if (!vmId) {
        return reply.status(503).send({ error: 'No VMs available' });
      }

      // Inject secrets
      const envContent = await VaultAgent.injectSecretsAsEnvFile(data.projectId, vmId);

      // Create execution record
      const execution = await prisma.codeExecution.create({
        data: {
          projectId: data.projectId,
          userId: userId as string,
          vmId,
          command: data.command,
          status: 'running'
        }
      });

      // Track active VM
      await redis.set(RedisKeys.vmProject(data.projectId), vmId, 'EX', 3600);

      // Store session for WebSocket
      await redis.set(RedisKeys.session(execution.id), JSON.stringify({
        vmId,
        command: data.command
      }), 'EX', 3600);

      // Publish started event
      await KafkaPublisher.publish('execution.started', {
        executionId: execution.id,
        projectId: data.projectId,
        vmId
      });

      return reply.send({
        success: true,
        session_id: execution.id,
        status: 'running'
      });
    } catch (error: any) {
      console.error('[Execution] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  },

  // POST /api/v1/exec/install
  async installPackages(request: Request, reply: Response) {
    try {
      const data = InstallSchema.parse(request.body);
      const userId = (request as any).user.id;

      const jobId = uuidv4();

      // Build install command
      let command: string;
      switch (data.packageManager) {
        case 'npm':
          command = `npm install ${data.packages.join(' ')}`;
          break;
        case 'pip':
          command = `pip install ${data.packages.join(' ')}`;
          break;
        case 'cargo':
          command = `cargo add ${data.packages.join(' ')}`;
          break;
        case 'go':
          command = `go get ${data.packages.join(' ')}`;
          break;
      }

      // Queue the job (in production, use a job queue)
      await redis.lpush('install:queue', JSON.stringify({
        jobId,
        projectId: data.projectId,
        command
      }));

      return reply.status(202).send({
        success: true,
        job_id: jobId
      });
    } catch (error: any) {
      console.error('[Install] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  },

  // GET /api/v1/exec/history/:project_id
  async getHistory(request: Request, reply: Response) {
    try {
      const { project_id } = request.params;
      const { limit = '20', cursor } = request.query;
      const userId = (request as any).user.id;

      const executions = await prisma.codeExecution.findMany({
        where: { projectId: project_id as string },
        take: parseInt(limit as string, 10) + 1,
        cursor: cursor ? { id: cursor as string } : undefined,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          command: true,
          status: true,
          exitCode: true,
          durationMs: true,
          createdAt: true
        }
      });

      let nextCursor: string | undefined;
      if (executions.length > parseInt(limit as string, 10)) {
        const next = executions.pop();
        nextCursor = next?.id;
      }

      return reply.send({
        success: true,
        data: executions,
        nextCursor
      });
    } catch (error: any) {
      console.error('[History] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  },

  // POST /api/v1/exec/terminate/:session_id
  async terminate(request: Request, reply: Response) {
    try {
      const { session_id } = request.params;

      await TerminalPTY.closeSession(session_id as string);

      // Update execution record
      await prisma.codeExecution.update({
        where: { id: session_id as string },
        data: { status: 'killed' }
      });

      return reply.send({ success: true });
    } catch (error: any) {
      console.error('[Terminate] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  },

  // POST /api/v1/exec/hibernate/:project_id
  async hibernate(request: Request, reply: Response) {
    try {
      const { project_id } = request.params;

      const vmId = await redis.get(RedisKeys.vmProject(project_id as string));

      if (!vmId) {
        return reply.status(404).send({ error: 'No active VM for project' });
      }

      await SnapshotManager.hibernateVM(vmId, project_id as string);
      await Prewarmer.releaseVM(vmId);
      await redis.del(RedisKeys.vmProject(project_id as string));

      return reply.send({ success: true, message: 'VM hibernated' });
    } catch (error: any) {
      console.error('[Hibernate] Error:', error);
      return reply.status(500).send({ error: error.message });
    }
  }
};
