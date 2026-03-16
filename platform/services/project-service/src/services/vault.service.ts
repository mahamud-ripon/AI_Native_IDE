import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { createLogger } from '../lib/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('vault-service');

export interface VaultSecret {
  keyName: string;
  vaultReferenceId: string;
  environment: string;
}

class VaultService {
  private client: AxiosInstance | null = null;
  private enabled: boolean;

  constructor() {
    this.enabled = config.vault.enabled;
    
    if (this.enabled) {
      this.client = axios.create({
        baseURL: config.vault.addr,
        headers: {
          'X-Vault-Token': config.vault.token,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      logger.info('Vault service initialized', { addr: config.vault.addr });
    } else {
      logger.warn('Vault service disabled - using mock implementation');
    }
  }

  /**
   * Store a secret in Vault
   * Returns a reference ID that can be stored in the database
   */
  async storeSecret(
    projectId: string,
    keyName: string,
    value: string,
    environment: string
  ): Promise<string> {
    const vaultPath = `projects/${projectId}/${environment}/${keyName}`;
    const vaultReferenceId = uuidv4();

    if (!this.enabled || !this.client) {
      // Mock implementation for development
      logger.warn('Vault disabled - mocking secret storage', { projectId, keyName, environment });
      return vaultReferenceId;
    }

    try {
      await this.client.post(`/v1/secret/data/${vaultPath}`, {
        data: {
          value,
          keyName,
          projectId,
          environment,
          referenceId: vaultReferenceId,
          createdAt: new Date().toISOString(),
        },
      });

      logger.info('Secret stored in Vault', {
        projectId,
        keyName,
        environment,
        referenceId: vaultReferenceId,
      });

      return vaultReferenceId;
    } catch (error) {
      logger.error('Failed to store secret in Vault', {
        projectId,
        keyName,
        environment,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to store secret in Vault');
    }
  }

  /**
   * Retrieve a secret from Vault
   * This should only be called by execution-service, not exposed via API
   */
  async getSecret(vaultReferenceId: string): Promise<string | null> {
    if (!this.enabled || !this.client) {
      logger.warn('Vault disabled - cannot retrieve secret', { vaultReferenceId });
      return null;
    }

    try {
      // Search for the secret by reference ID
      // In production, you'd have a more efficient lookup
      const response = await this.client.get(`/v1/secret/metadata/projects?list=true`);
      
      if (response.data.data?.keys) {
        for (const projectKey of response.data.data.keys) {
          const secretResponse = await this.client.get(`/v1/secret/data/${projectKey}`);
          if (secretResponse.data?.data?.data?.referenceId === vaultReferenceId) {
            return secretResponse.data.data.data.value;
          }
        }
      }

      return null;
    } catch (error) {
      logger.error('Failed to retrieve secret from Vault', {
        vaultReferenceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Delete a secret from Vault
   */
  async deleteSecret(projectId: string, keyName: string, environment: string): Promise<void> {
    const vaultPath = `projects/${projectId}/${environment}/${keyName}`;

    if (!this.enabled || !this.client) {
      logger.warn('Vault disabled - mocking secret deletion', { projectId, keyName, environment });
      return;
    }

    try {
      await this.client.delete(`/v1/secret/data/${vaultPath}`);
      logger.info('Secret deleted from Vault', { projectId, keyName, environment });
    } catch (error) {
      logger.error('Failed to delete secret from Vault', {
        projectId,
        keyName,
        environment,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to delete secret from Vault');
    }
  }

  /**
   * List all secret keys for a project (without values)
   */
  async listSecretKeys(projectId: string, environment?: string): Promise<string[]> {
    if (!this.enabled || !this.client) {
      logger.warn('Vault disabled - cannot list secrets', { projectId });
      return [];
    }

    try {
      const basePath = environment 
        ? `projects/${projectId}/${environment}`
        : `projects/${projectId}`;
      
      const response = await this.client.get(`/v1/secret/metadata/${basePath}?list=true`);
      
      return response.data.data?.keys || [];
    } catch (error) {
      logger.error('Failed to list secrets from Vault', {
        projectId,
        environment,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Health check for Vault connection
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    if (!this.enabled) {
      return { healthy: true, message: 'Vault disabled (mock mode)' };
    }

    if (!this.client) {
      return { healthy: false, message: 'Vault client not initialized' };
    }

    try {
      const response = await this.client.get('/v1/sys/health');
      return { healthy: true, message: 'Vault connection healthy' };
    } catch (error) {
      return { 
        healthy: false, 
        message: `Vault connection failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }
}

export const vaultService = new VaultService();
export default vaultService;
