import { prisma } from '../lib/prisma.js';

const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

interface DeployInput {
  projectId: string;
  projectName: string;
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

async function railwayMutation(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const token = process.env.RAILWAY_TOKEN;
  if (!token) throw new Error('RAILWAY_TOKEN not set');

  const res = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });

  const data: { data?: unknown; errors?: unknown[] } = await res.json() as { data?: unknown; errors?: unknown[] };
  if (data.errors?.length) throw new Error(`Railway API error: ${JSON.stringify(data.errors[0])}`);
  return data.data;
}

export const RailwayProvider = {
  async deploy(input: DeployInput): Promise<DeployResult> {
    // 1. Set environment variables if any
    if (Object.keys(input.envVars).length > 0) {
      const envVars = Object.entries(input.envVars).map(([name, value]) => ({
        name,
        value,
      }));

      await railwayMutation(`
        mutation ServiceVariableUpsert($input: ServiceVariableUpsertInput!) {
          serviceVariableUpsert(input: $input) {
            id
          }
        }
      `, {
        input: {
          serviceId: process.env.RAILWAY_SERVICE_ID,
          environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
          variables: envVars,
        },
      });
    }

    // 2. Trigger deployment via deploymentCreate mutation
    const deploymentData = await railwayMutation(`
      mutation DeploymentCreate($input: DeploymentCreateInput!) {
        deploymentCreate(input: $input) {
          id
          url
        }
      }
    `, {
      input: {
        serviceId: process.env.RAILWAY_SERVICE_ID,
        environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
      },
    }) as { deploymentCreate: { id: string; url: string } };

    return {
      url: deploymentData.deploymentCreate.url,
      providerDeployId: deploymentData.deploymentCreate.id,
      status: 'pending' as const, // Railway doesn't return status immediately
    };
  },

  /**
   * Get deployment logs from Railway.
   * Called by LogStreamer to stream build logs back to the IDE.
   */
  async *getLogs(providerDeployId: string): AsyncGenerator<string> {
    // Railway doesn't have a direct log streaming API, so we return minimal info
    yield 'Railway deployment in progress...';
  },

  /**
   * Get deployment status from Railway.
   */
  async getStatus(deployId: string) {
    const data = await railwayMutation(`
      query DeploymentGet($id: String!) {
        deployment(id: $id) {
          id
          status
          url
        }
      }
    `, { id: deployId }) as { deployment: { status: string; url: string } };

    const statusMap: Record<string, 'pending' | 'building' | 'deployed' | 'failed'> = {
      'DEPLOYING': 'building',
      'SUCCESS': 'deployed',
      'FAILED': 'failed',
      'PENDING': 'pending',
    };

    return {
      status: statusMap[data.deployment.status] ?? 'pending',
      url: data.deployment.url,
    };
  },

  /**
   * Rollback a Railway deployment.
   */
  async rollback(deployId: string): Promise<void> {
    await railwayMutation(`
      mutation DeploymentRollback($id: String!) {
        deploymentRollback(id: $id) {
          id
        }
      }
    `, { id: deployId });
  },

  /**
   * Delete a Railway deployment.
   */
  async delete(deployId: string): Promise<void> {
    await railwayMutation(`
      mutation DeploymentDelete($id: String!) {
        deploymentDelete(id: $id)
      }
    `, { id: deployId });
  },
};
