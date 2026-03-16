import { prisma } from '../lib/prisma.js';
import axios from 'axios';
import { config } from '../config/index.js';

export const EnvInjector = {
  async getProjectSecrets(projectId: string): Promise<Record<string, string>> {
    const secrets = await prisma.projectSecret.findMany({
      where: { projectId }
    });

    const envVars: Record<string, string> = {};

    for (const secret of secrets) {
      if (secret.vaultReferenceId) {
        // Fetch from Vault
        try {
          const response = await axios.get(
            `${config.vault.addr}/v1/secret/data/${secret.vaultReferenceId}`,
            {
              headers: {
                'X-Vault-Token': config.vault.token
              }
            }
          );
          envVars[secret.keyName] = response.data.data.data.value;
        } catch (error) {
          console.error(`[EnvInjector] Failed to fetch secret ${secret.keyName}:`, error);
        }
      }
    }

    return envVars;
  }
};
