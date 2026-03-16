import { kafkaService } from './kafka.service';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';

const logger = createLogger('git-clone-service');

class GitCloneService {
  /**
   * Initiate git clone operation via execution-service
   * Does NOT clone locally - sends request to execution-service
   */
  async importFromGit(
    projectId: string,
    gitRepoUrl: string,
    branch = 'main'
  ): Promise<void> {
    try {
      // Update project with git URL
      await prisma.project.update({
        where: { id: projectId },
        data: {
          gitRepoUrl,
          status: 'pending',
        },
      });

      // Send Kafka event to execution-service
      await kafkaService.publish('execution.git_clone', {
        action: 'git_clone',
        projectId,
        repo: gitRepoUrl,
        branch,
        timestamp: new Date().toISOString(),
      });

      logger.info('Git clone request sent to execution-service', {
        projectId,
        gitRepoUrl,
        branch,
      });
    } catch (error) {
      logger.error('Failed to initiate git clone', { projectId, gitRepoUrl, error });
      throw error;
    }
  }

  /**
   * Handle git clone completion event
   * Called when execution-service completes cloning
   */
  async handleCloneComplete(
    projectId: string,
    fileCount: number,
    branch: string
  ): Promise<void> {
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'active',
        },
      });

      logger.info('Git clone completed', { projectId, fileCount, branch });
    } catch (error) {
      logger.error('Failed to handle clone completion', { projectId, error });
    }
  }

  /**
   * Handle git clone failure event
   */
  async handleCloneFailed(projectId: string, error: string): Promise<void> {
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'failed_creation',
        },
      });

      logger.error('Git clone failed', { projectId, error });
    } catch (updateError) {
      logger.error('Failed to update project status after clone failure', {
        projectId,
        error: updateError,
      });
    }
  }
}

export const gitCloneService = new GitCloneService();
export default gitCloneService;
