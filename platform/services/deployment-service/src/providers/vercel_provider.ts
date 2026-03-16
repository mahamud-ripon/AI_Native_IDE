import axios from 'axios';
import { DeploymentProvider, DeployConfig, DeployResult, DeployStatus } from './provider_interface.js';
import { config } from '../config/index.js';

export class VercelProvider implements DeploymentProvider {
  private baseUrl = 'https://api.vercel.com';
  private headers = {
    'Authorization': `Bearer ${config.providers.vercel.token}`,
    'Content-Type': 'application/json'
  };

  async deploy(config: DeployConfig): Promise<DeployResult> {
    // Create project if not exists
    const projectResponse = await axios.post(
      `${this.baseUrl}/v6/projects`,
      {
        name: config.projectName,
        framework: 'nextjs'
      },
      { headers: this.headers }
    ).catch(() => ({ data: null }));

    // Create deployment
    const deployment = await axios.post(
      `${this.baseUrl}/v6/deployments`,
      {
        name: config.projectName,
        files: [
          {
            file: 'config.json',
            data: JSON.stringify({
              buildCommand: config.buildCommand || 'npm run build',
              outputDir: config.outputDir || '.next',
              nodeVersion: config.nodeVersion || '18'
            })
          }
        ],
        env: Object.entries(config.envVars).map(([key, value]) => ({
          key,
          value,
          type: 'encrypted'
        })),
        git: {
          repo: config.projectName,
          branch: config.branch,
          commitSha: config.commitSha
        }
      },
      { headers: this.headers }
    );

    return {
      providerDeployId: deployment.data.uid,
      url: deployment.data.url,
      status: 'building'
    };
  }

  async getStatus(deployId: string): Promise<DeployStatus> {
    const response = await axios.get(
      `${this.baseUrl}/v6/deployments/${deployId}`,
      { headers: this.headers }
    );

    const state = response.data.state;
    let status: DeployStatus['status'] = 'building';

    if (state === 'READY') status = 'deployed';
    else if (state === 'ERROR' || state === 'FAILED') status = 'failed';
    else if (state === 'BUILDING') status = 'building';
    else if (state === 'QUEUED') status = 'pending';

    return {
      status,
      url: response.data.url,
      buildLog: response.data.builds?.[0]?.logs?.join('\n')
    };
  }

  async *getLogs(deployId: string): AsyncIterable<string> {
    const response = await axios.get(
      `${this.baseUrl}/v2/deployments/${deployId}/events`,
      {
        headers: this.headers,
        responseType: 'stream'
      }
    );

    // Simple streaming implementation
    const stream = response.data;
    let buffer = '';

    for await (const chunk of stream) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) yield line;
      }
    }

    if (buffer.trim()) yield buffer;
  }

  async rollback(deployId: string): Promise<void> {
    await axios.post(
      `${this.baseUrl}/v6/deployments/${deployId}/rollback`,
      {},
      { headers: this.headers }
    );
  }

  async delete(deployId: string): Promise<void> {
    await axios.delete(
      `${this.baseUrl}/v6/deployments/${deployId}`,
      { headers: this.headers }
    );
  }
}
