import axios from 'axios';
import { config } from '../config/index.js';
import { prisma } from '../lib/prisma.js';
import { randomBytes } from 'crypto';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Secure temporary directory for env files
const SECURE_ENV_DIR = '/tmp/vm-envs';

export const VaultAgent = {
  async getSecret(path: string): Promise<string | null> {
    try {
      const response = await axios.get(
        `${config.vault.addr}/v1/secret/data/${path}`,
        {
          headers: {
            'X-Vault-Token': process.env.VAULT_TOKEN
          },
          timeout: 5000
        }
      );

      return response.data.data.data.value;
    } catch (error: any) {
      // SECURITY: Never log the secret path or value in production
      console.error(`[VaultAgent] Failed to fetch secret (redacted)`);
      return null;
    }
  },

  /**
   * Injects secrets into a secure environment file for the VM.
   * Returns the path to the env file (not the content) to prevent logging.
   * The caller is responsible for cleanup via cleanupEnvFile().
   */
  async injectSecretsAsEnvFile(projectId: string, vmId: string): Promise<string> {
    const secrets = await prisma.projectSecret.findMany({
      where: { projectId }
    });

    // Ensure secure directory exists
    if (!existsSync(SECURE_ENV_DIR)) {
      mkdirSync(SECURE_ENV_DIR, { recursive: true, mode: 0o700 });
    }

    // Generate unique filename with restricted permissions
    const envFileName = `.env-${vmId}-${randomBytes(8).toString('hex')}`;
    const envFilePath = join(SECURE_ENV_DIR, envFileName);

    // Build env content in memory (never log this)
    const envLines: string[] = [];
    
    for (const secret of secrets) {
      const value = await this.getSecret(secret.vaultReferenceId);
      if (value) {
        // Escape any newlines or special chars in the value
        const escapedValue = value.replace(/\n/g, '\\n').replace(/"/g, '\\"');
        envLines.push(`${secret.keyName}="${escapedValue}"`);
      }
    }

    // Write to file with restricted permissions (0600 = owner read/write only)
    writeFileSync(envFilePath, envLines.join('\n'), { mode: 0o600 });

    // SECURITY: Return the file path, NOT the content
    // This prevents accidental logging of secrets
    return envFilePath;
  },

  /**
   * Clean up the env file after VM terminates to prevent secret leakage
   */
  async cleanupEnvFile(envFilePath: string): Promise<void> {
    try {
      if (existsSync(envFilePath)) {
        // Overwrite with zeros before deletion for extra security
        const { writeFileSync } = await import('fs');
        writeFileSync(envFilePath, '\0'.repeat(1024));
        unlinkSync(envFilePath);
        console.log(`[VaultAgent] Cleaned up env file for VM`);
      }
    } catch (error) {
      console.error(`[VaultAgent] Failed to cleanup env file`);
    }
  }
};
