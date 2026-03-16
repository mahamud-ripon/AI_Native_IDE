import { prisma } from '../lib/prisma.js';
import { getProvider } from '../providers/index.js';
import { KafkaPublisher } from '../events/kafka_publisher.js';
import { LogStreamer } from './log_streamer.js';
import { EnvInjector } from './env_injector.js';
import { DeployProvider, DeployEnv, TriggerType } from '@workspace/database';

export const BuildOrchestrator = {
  async deployPreview(
    projectId: string,
    userId: string,
    branch: string
  ): Promise<{ deploymentId: string; wsChannel: string }> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error('Project not found');

    // Create deployment record
    const deployment = await prisma.deployment.create({
      data: {
        projectId,
        userId,
        branchName: branch,
        triggerType: 'git_push' as TriggerType,
        provider: 'vercel',
        environment: 'preview' as DeployEnv,
        status: 'pending'
      }
    });

    // Get environment variables from Vault
    const envVars = await EnvInjector.getProjectSecrets(projectId);

    // Get provider and deploy
    const provider = getProvider('vercel');

    try {
      const result = await provider.deploy({
        projectId,
        projectName: project.slug,
        branch,
        commitSha: '',
        envVars
      });

      // Update deployment with result
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'building',
          url: result.url
        }
      });

      // Start log streaming
      LogStreamer.startStreaming(deployment.id, result.providerDeployId, provider);

      // Publish event
      await KafkaPublisher.publish('deployment.started', {
        deploymentId: deployment.id,
        projectId,
        environment: 'preview'
      });

      return {
        deploymentId: deployment.id,
        wsChannel: `deploy:${deployment.id}`
      };
    } catch (error: any) {
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: 'failed' }
      });

      await KafkaPublisher.publish('deployment.failed', {
        deploymentId: deployment.id,
        projectId,
        error: error.message
      });

      throw error;
    }
  },

  async deployProduction(
    projectId: string,
    userId: string,
    branch: string,
    provider: DeployProvider,
    buildCommand?: string,
    outputDir?: string,
    nodeVersion?: string
  ): Promise<{ deploymentId: string; wsChannel: string }> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error('Project not found');

    // Check user has Pro plan
    const subscription = await prisma.subscription.findFirst({
      where: { userId, plan: { in: ['PRO', 'TEAM', 'ENTERPRISE'] } }
    });

    if (!subscription) {
      throw new Error('Pro plan required for production deployment');
    }

    // Create deployment record
    const deployment = await prisma.deployment.create({
      data: {
        projectId,
        userId,
        branchName: branch,
        triggerType: 'manual_run' as TriggerType,
        provider,
        environment: 'production' as DeployEnv,
        status: 'pending',
        buildCommand,
        outputDir,
        nodeVersion
      }
    });

    // Get environment variables from Vault
    const envVars = await EnvInjector.getProjectSecrets(projectId);

    // Get provider and deploy
    const deployProvider = getProvider(provider);

    try {
      const result = await deployProvider.deploy({
        projectId,
        projectName: project.slug,
        branch,
        commitSha: '',
        buildCommand,
        outputDir,
        nodeVersion,
        envVars
      });

      // Update deployment
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'building',
          url: result.url,
          envSnapshot: Object.keys(envVars).reduce((acc, key) => {
            acc[key] = '[REDACTED]';
            return acc;
          }, {} as Record<string, string>)
        }
      });

      // Start log streaming
      LogStreamer.startStreaming(deployment.id, result.providerDeployId, deployProvider);

      // Publish event
      await KafkaPublisher.publish('deployment.started', {
        deploymentId: deployment.id,
        projectId,
        environment: 'production'
      });

      return {
        deploymentId: deployment.id,
        wsChannel: `deploy:${deployment.id}`
      };
    } catch (error: any) {
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: 'failed' }
      });

      await KafkaPublisher.publish('deployment.failed', {
        deploymentId: deployment.id,
        projectId,
        error: error.message
      });

      throw error;
    }
  },

  async rollback(deploymentId: string, userId: string): Promise<{ newDeploymentId: string }> {
    const oldDeployment = await prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true }
    });

    if (!oldDeployment) throw new Error('Deployment not found');

    // Create new deployment based on old config
    const newDeployment = await prisma.deployment.create({
      data: {
        projectId: oldDeployment.projectId,
        userId,
        branchName: oldDeployment.branchName,
        triggerType: 'manual_run' as TriggerType,
        provider: oldDeployment.provider!,
        environment: oldDeployment.environment,
        status: 'pending',
        buildCommand: oldDeployment.buildCommand,
        outputDir: oldDeployment.outputDir,
        nodeVersion: oldDeployment.nodeVersion,
        commitSha: oldDeployment.commitSha,
        rollbackFromId: deploymentId
      }
    });

    // Trigger deployment with old commit
    const provider = getProvider(oldDeployment.provider!);
    const envVars = await EnvInjector.getProjectSecrets(oldDeployment.projectId);

    try {
      const result = await provider.deploy({
        projectId: oldDeployment.projectId,
        projectName: oldDeployment.project.slug,
        branch: oldDeployment.branchName,
        commitSha: oldDeployment.commitSha || '',
        buildCommand: oldDeployment.buildCommand || undefined,
        outputDir: oldDeployment.outputDir || undefined,
        envVars
      });

      await prisma.deployment.update({
        where: { id: newDeployment.id },
        data: {
          status: 'building',
          url: result.url
        }
      });

      LogStreamer.startStreaming(newDeployment.id, result.providerDeployId, provider);

      return { newDeploymentId: newDeployment.id };
    } catch (error: any) {
      await prisma.deployment.update({
        where: { id: newDeployment.id },
        data: { status: 'failed' }
      });
      throw error;
    }
  }
};
