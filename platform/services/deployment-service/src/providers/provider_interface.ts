export interface DeployConfig {
  projectId: string;
  projectName: string;
  branch: string;
  commitSha: string;
  buildCommand?: string;
  outputDir?: string;
  nodeVersion?: string;
  envVars: Record<string, string>;
}

export interface DeployResult {
  providerDeployId: string;
  url: string;
  status: 'pending' | 'building' | 'deployed' | 'failed';
}

export interface DeployStatus {
  status: 'pending' | 'building' | 'deployed' | 'failed';
  url?: string;
  buildLog?: string;
}

export interface DeploymentProvider {
  deploy(config: DeployConfig): Promise<DeployResult>;
  getStatus(deployId: string): Promise<DeployStatus>;
  getLogs(deployId: string): AsyncIterable<string>;
  rollback(deployId: string): Promise<void>;
  delete(deployId: string): Promise<void>;
}
