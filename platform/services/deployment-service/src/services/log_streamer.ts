import { redis } from '../lib/redis.js';
import { DeploymentProvider } from '../providers/provider_interface.js';
import { prisma } from '../lib/prisma.js';

const SECRET_PATTERNS: RegExp[] = [];

export const LogStreamer = {
  async startStreaming(
    deploymentId: string,
    providerDeployId: string,
    provider: DeploymentProvider
  ): Promise<void> {
    console.log(`[LogStreamer] Starting stream for deployment ${deploymentId}`);

    const logBuffer: string[] = [];

    try {
      for await (const logChunk of provider.getLogs(providerDeployId)) {
        // Scrub secrets
        const scrubbedLog = this.scrubSecrets(logChunk);

        // Publish to Redis Pub/Sub
        await redis.publish(
          `deploy:${deploymentId}`,
          JSON.stringify({ type: 'log', content: scrubbedLog })
        );

        // Buffer for S3 upload
        logBuffer.push(scrubbedLog);
      }

      // Upload to S3 upon completion
      const s3Key = `deployments/${deploymentId}/build-${Date.now()}.log`;
      // await s3Client.putObject(...);

      // Update deployment with S3 key
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: { buildLogS3Key: s3Key }
      });

      // Publish completion
      await redis.publish(
        `deploy:${deploymentId}`,
        JSON.stringify({ type: 'complete' })
      );
    } catch (error: any) {
      await redis.publish(
        `deploy:${deploymentId}`,
        JSON.stringify({ type: 'error', error: error.message })
      );
    }
  },

  scrubSecrets(log: string): string {
    let scrubbed = log;

    // Replace known secret patterns
    for (const pattern of SECRET_PATTERNS) {
      scrubbed = scrubbed.replace(pattern, '[REDACTED_BY_PLATFORM]');
    }

    // Replace generic patterns
    scrubbed = scrubbed.replace(/(api_key|token|secret|password|jwt)["']?\s*[:=]\s*["']?([^"'\s]+)["']?/gi,
      '$1=[REDACTED_BY_PLATFORM]');

    return scrubbed;
  },

  addSecretPattern(pattern: string): void {
    SECRET_PATTERNS.push(new RegExp(pattern, 'gi'));
  }
};
