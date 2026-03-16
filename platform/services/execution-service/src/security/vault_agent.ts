import axios from 'axios';
import { config } from '../config/index.js';
import { prisma } from '../lib/prisma.js';

export const VaultAgent = {
  async getSecret(path: string): Promise<string | null> {
    try {
      const response = await axios.get(
        `${config.vault.addr}/v1/secret/data/${path}`,
        {
          headers: {
            'X-Vault-Token': process.env.VAULT_TOKEN
          }
        }
      );

      return response.data.data.data.value;
    } catch (error) {
      console.error(`[VaultAgent] Failed to fetch secret ${path}:`, error);
      return null;
    }
  },

  async injectSecretsAsEnvFile(projectId: string, vmId: string): Promise<string> {
    const secrets = await prisma.projectSecret.findMany({
      where: { projectId }
    });

    let envContent = '';

    for (const secret of secrets) {
      const value = await this.getSecret(secret.vaultReferenceId);
      if (value) {
        envContent += `${secret.keyName}=${value}\n`;
      }
    }

    // In production, write to virtio-fs mounted directory
    return envContent;
  }
};
