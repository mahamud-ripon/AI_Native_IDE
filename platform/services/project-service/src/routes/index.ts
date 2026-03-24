import { FastifyInstance } from 'fastify';
import { authMiddleware, mixedAuthMiddleware } from '../middleware';
import * as projectController from '../controllers/project.controller';
import * as fileController from '../controllers/file.controller';
import * as secretController from '../controllers/secret.controller';
import * as collaboratorController from '../controllers/collaborator.controller';
import * as templateController from '../controllers/template.controller';
import * as healthController from '../controllers/health.controller';

export async function routes(fastify: FastifyInstance): Promise<void> {
  // Health endpoints (no auth required)
  fastify.get('/health', healthController.healthCheck);
  fastify.get('/health/detailed', healthController.detailedHealthCheck);
  fastify.get('/health/circuit-breaker', healthController.circuitBreakerStatus);

  // Project routes
  fastify.post('/api/v1/projects', { preHandler: authMiddleware }, projectController.createProject);
  fastify.get('/api/v1/projects', { preHandler: authMiddleware }, projectController.listProjects);
  fastify.post('/api/v1/projects/import', { preHandler: authMiddleware }, projectController.importProject);
  fastify.get('/api/v1/projects/:id', { preHandler: authMiddleware }, projectController.getProject);
  fastify.put('/api/v1/projects/:id', { preHandler: authMiddleware }, projectController.updateProject);
  fastify.delete('/api/v1/projects/:id', { preHandler: authMiddleware }, projectController.deleteProject);

  // File routes
  fastify.get('/api/v1/projects/:id/tree', { preHandler: authMiddleware }, fileController.getFileTree);
  fastify.get('/api/v1/projects/:id/files/:fileId', { preHandler: authMiddleware }, fileController.getFile);
  fastify.get('/api/v1/projects/:id/files/content', { preHandler: authMiddleware }, fileController.getFileContent);
  fastify.post('/api/v1/projects/:id/files', { preHandler: authMiddleware }, fileController.createFile);
  fastify.put('/api/v1/projects/:id/files/:fileId', { preHandler: authMiddleware }, fileController.updateFile);
  fastify.delete('/api/v1/projects/:id/files/:fileId', { preHandler: authMiddleware }, fileController.deleteFile);
  fastify.put('/api/v1/projects/:id/files/:fileId/move', { preHandler: authMiddleware }, fileController.moveFile);
  
  fastify.post('/api/v1/projects/:id/files/sync', { preHandler: mixedAuthMiddleware }, fileController.syncFiles);

  // Secret routes
  fastify.get('/api/v1/projects/:id/secrets', { preHandler: authMiddleware }, secretController.listSecrets);
  fastify.post('/api/v1/projects/:id/secrets', { preHandler: authMiddleware }, secretController.createSecret);
  fastify.put('/api/v1/projects/:id/secrets/:secretId', { preHandler: authMiddleware }, secretController.updateSecret);
  fastify.delete('/api/v1/projects/:id/secrets/:secretId', { preHandler: authMiddleware }, secretController.deleteSecret);

  // Collaborator routes
  fastify.get('/api/v1/projects/:id/collaborators', { preHandler: authMiddleware }, collaboratorController.listCollaborators);
  fastify.post('/api/v1/projects/:id/collaborators', { preHandler: authMiddleware }, collaboratorController.inviteCollaborator);
  fastify.delete('/api/v1/projects/:id/collaborators/:userId', { preHandler: authMiddleware }, collaboratorController.removeCollaborator);
  fastify.put('/api/v1/projects/:id/collaborators/:userId/role', { preHandler: authMiddleware }, collaboratorController.updateCollaboratorRole);

  // Template routes
  fastify.get('/api/v1/templates', templateController.listTemplates);
  fastify.get('/api/v1/templates/:slug', templateController.getTemplate);
  fastify.post('/api/v1/templates', { preHandler: authMiddleware }, templateController.createTemplate);
  fastify.post('/api/v1/templates/:slug/use', templateController.useTemplate);
}
