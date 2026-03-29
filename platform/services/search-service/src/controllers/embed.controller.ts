import { FastifyRequest, FastifyReply } from 'fastify';
import { esClient, IndexManager } from '../services/elasticsearch.service.js';
import { logger } from '../lib/logger.js';

interface EmbedRequestBody {
  fileId: string;
  projectId: string;
  content: string;
  path: string;
  language?: string;
}

export async function upsertEmbedding(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as EmbedRequestBody;
  const { fileId, projectId, content, path, language } = body;

  if (!fileId || !projectId || !content || !path) {
    return reply.status(400).send({
      success: false,
      error: 'Missing required fields: fileId, projectId, content, path',
    });
  }

  try {
    const indexName = 'code_' + projectId.replace(/-/g, '_');

    await IndexManager.ensureCodeIndex(projectId);

    await esClient.index({
      index: indexName,
      id: fileId,
      body: {
        fileId,
        filePath: path,
        content,
        language: language || null,
        projectId,
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
        updatedAt: new Date().toISOString(),
      },
      refresh: 'wait_for',
    });

    logger.info({ fileId, projectId, path }, 'Embedding indexed');

    return reply.status(200).send({
      success: true,
      data: { fileId, indexName },
    });
  } catch (error: any) {
    logger.error({ error, fileId, projectId }, 'Failed to index embedding');
    return reply.status(500).send({
      success: false,
      error: error.message || 'Failed to index embedding',
    });
  }
}

export async function deleteEmbedding(request: FastifyRequest, reply: FastifyReply) {
  const params = request.params as { fileId: string };
  const { fileId } = params;

  if (!fileId) {
    return reply.status(400).send({
      success: false,
      error: 'Missing required parameter: fileId',
    });
  }

  try {
    // Search across all code indices to find and delete the document
    const searchResult = await esClient.search({
      index: 'code_*',
      body: {
        query: {
          term: { fileId },
        },
        _source: false,
        size: 1,
      },
    });

    const hits = searchResult.hits.hits;
    if (hits.length === 0) {
      return reply.status(404).send({
        success: true,
        message: 'Embedding not found, already deleted',
      });
    }

    const indexName = hits[0]._index;

    await esClient.delete({
      index: indexName,
      id: fileId,
      refresh: 'wait_for',
    });

    logger.info({ fileId, indexName }, 'Embedding deleted');

    return reply.status(200).send({
      success: true,
      data: { fileId },
    });
  } catch (error: any) {
    if (error.meta?.statusCode === 404) {
      return reply.status(200).send({
        success: true,
        message: 'Embedding not found, already deleted',
      });
    }

    logger.error({ error, fileId }, 'Failed to delete embedding');
    return reply.status(500).send({
      success: false,
      error: error.message || 'Failed to delete embedding',
    });
  }
}
