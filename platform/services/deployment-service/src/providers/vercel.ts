import { prisma } from '../lib/prisma.js';

const VERCEL_API = 'https://api.vercel.com';

interface DeployInput {
  projectId: string;       // platform project UUID
  projectName: string;     // used as Vercel project slug
  branch: string;
  commitSha: string;
  buildCommand?: string;
  outputDir?: string;
  nodeVersion?: string;
  envVars: Record<string, string>;
}

interface DeployResult {
  url: string;
  providerDeployId: string;
  status: 'pending' | 'building' | 'deployed' | 'failed';
}

async function vercelFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN environment variable is not set');

  const teamParam = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';

  const res = await fetch(`${VERCEL_API}${path}${teamParam}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vercel API error ${res.status}: ${body}`);
  }

  return res;
}

/**
 * Ensure a Vercel project exists for this platform project.
 * Creates it if it doesn't exist.
 */
async function ensureVercelProject(projectName: string, nodeVersion?: string): Promise<string> {
  // Try to get existing project
  try {
    const res = await vercelFetch(`/v9/projects/${encodeURIComponent(projectName)}`);
    const data = await res.json() as { id: string };
    return data.id;
  } catch {
    // Project doesn't exist, create it
  }

  const createRes = await vercelFetch('/v9/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: projectName,
      framework: 'vite',
      nodeVersion: nodeVersion ?? '20.x',
      buildCommand: null,     // use project-level default
      outputDirectory: null,  // use project-level default
    }),
  });

  const created = await createRes.json() as { id: string };
  return created.id;
}

/**
 * Set environment variables on a Vercel project.
 */
async function setVercelEnvVars(vercelProjectId: string, envVars: Record<string, string>, target: 'preview' | 'production'): Promise<void> {
  if (Object.keys(envVars).length === 0) return;

  const vars = Object.entries(envVars).map(([key, value]) => ({
    key,
    value,
    target: [target],
    type: 'encrypted',
  }));

  await vercelFetch(`/v9/projects/${vercelProjectId}/env`, {
    method: 'POST',
    body: JSON.stringify(vars),
  });
}

export const VercelProvider = {
  async deploy(input: DeployInput): Promise<DeployResult> {
    const vercelProjectId = await ensureVercelProject(input.projectName, input.nodeVersion);

    const target = 'preview'; // BuildOrchestrator.deployPreview calls this
    await setVercelEnvVars(vercelProjectId, input.envVars, target);

    // Get project files from platform storage for deployment
    // Vercel deployments require file contents to be POSTed directly
    const files = await getProjectFilesForDeployment(input.projectId);

    const deployRes = await vercelFetch('/v13/deployments', {
      method: 'POST',
      body: JSON.stringify({
        name: input.projectName,
        project: vercelProjectId,
        target,
        gitSource: input.commitSha
          ? { type: 'custom', ref: input.branch, sha: input.commitSha }
          : undefined,
        files,
        buildCommand: input.buildCommand,
        outputDirectory: input.outputDir,
        projectSettings: {
          nodeVersion: input.nodeVersion ?? '20.x',
        },
      }),
    });

    const deployment = await deployRes.json() as { url: string; id: string; state: string };

    return {
      url: `https://${deployment.url}`,
      providerDeployId: deployment.id,
      status: deployment.state === 'READY' ? 'deployed' : deployment.state === 'ERROR' ? 'failed' : deployment.state === 'BUILDING' ? 'building' : 'pending',
    };
  },

  /**
   * Get deployment status from Vercel.
   */
  async getStatus(deployId: string) {
    const res = await vercelFetch(`/v13/deployments/${deployId}`);
    const data = await res.json() as { state: string; url?: string };
    return {
      status: data.state as 'pending' | 'building' | 'deployed' | 'failed',
      url: data.url ? `https://${data.url}` : undefined,
    };
  },

  /**
   * Get deployment logs from Vercel.
   * Called by LogStreamer to stream build logs back to the IDE.
   */
  async *getLogs(providerDeployId: string): AsyncGenerator<string> {
    const res = await vercelFetch(`/v2/deployments/${providerDeployId}/events`);
    const data = await res.json() as Array<{ type: string; payload: { text?: string } }>;

    // Convert Vercel build events to log lines
    const events = data;

    for (const event of events) {
      if (event.type === 'stdout' || event.type === 'stderr') {
        yield event.payload.text ?? '';
      }
    }
  },

  /**
   * Rollback a Vercel deployment (cancel and redeploy previous).
   */
  async rollback(deployId: string): Promise<void> {
    await vercelFetch(`/v13/deployments/${deployId}/cancel`, { method: 'POST' });
  },

  /**
   * Delete a Vercel deployment.
   */
  async delete(deployId: string): Promise<void> {
    await vercelFetch(`/v13/deployments/${deployId}`, { method: 'DELETE' });
  },
};

/**
 * Fetch project files from the platform for deployment.
 * Returns Vercel's required format: [{ file: path, data: content }]
 */
async function getProjectFilesForDeployment(projectId: string): Promise<Array<{ file: string; data: string; encoding?: 'base64' }>> {
  const files = await prisma.projectFile.findMany({
    where: {
      projectId,
      isDirectory: false,
      deletedAt: null,
    },
    select: {
      path: true,
      inlineContent: true,
      s3Key: true,
    },
  });

  const result: Array<{ file: string; data: string; encoding?: 'base64' }> = [];

  for (const file of files) {
    let content: string;

    if (file.inlineContent) {
      content = file.inlineContent.toString('utf-8');
    } else if (file.s3Key) {
      // Download from S3
      const { storageService } = await import('../services/storage.service.js');
      const downloaded = await storageService.downloadFile(file.s3Key);
      content = downloaded.content;
    } else {
      continue; // Skip files with no content
    }

    result.push({ file: file.path, data: content });
  }

  return result;
}
