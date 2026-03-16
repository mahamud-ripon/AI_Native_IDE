import { describe, it, expect } from 'vitest';

describe('Query Builder', () => {
  describe('sanitizeQuery', () => {
    // Import the module to test the internal sanitizeQuery function indirectly
    it('should build safe code search query', async () => {
      const { QueryBuilder } = await import('../src/services/query-builder.service.js');

      const { indexName, body } = QueryBuilder.buildCodeSearchQuery(
        'project-123',
        'function test',
        { language: 'typescript' }
      );
      const b = body as Record<string, any>;

      expect(indexName).toBe('code_project_123');
      expect(b.query).toBeDefined();
      expect(b.query.bool.must).toHaveLength(3); // projectId, query, language
      expect(b.highlight).toBeDefined();
      expect(b.size).toBe(50);
      expect(b.timeout).toBe('5s');
    });

    it('should build file search query', async () => {
      const { QueryBuilder } = await import('../src/services/query-builder.service.js');

      const { indexName, body } = QueryBuilder.buildFileSearchQuery(
        'project-123',
        'index.ts'
      );
      const b = body as Record<string, any>;

      expect(indexName).toBe('code_project_123');
      expect(b.query.bool.must).toHaveLength(2);
      expect(b.query.bool.must[1].wildcard.filePath.value).toBe('*index.ts*');
    });

    it('should build project search query with filters', async () => {
      const { QueryBuilder } = await import('../src/services/query-builder.service.js');

      const { indexName, body } = QueryBuilder.buildProjectSearchQuery('react app', {
        template: 'react',
        language: 'typescript',
        sortBy: 'starCount',
      });
      const b = body as Record<string, any>;

      expect(indexName).toBe('projects_global');
      expect(b.query.bool.must).toHaveLength(4); // visibility, query, template, language
      expect(b.sort[0].starCount).toEqual({ order: 'desc' });
    });

    it('should only return public projects in project search', async () => {
      const { QueryBuilder } = await import('../src/services/query-builder.service.js');

      const { body } = QueryBuilder.buildProjectSearchQuery('test');
      const b = body as Record<string, any>;

      // First must clause should be visibility: public
      expect(b.query.bool.must[0]).toEqual({ term: { visibility: 'public' } });
    });

    it('should handle pagination token', async () => {
      const { QueryBuilder } = await import('../src/services/query-builder.service.js');

      const sortValues = [1.5, 'doc-123'];
      const pageToken = Buffer.from(JSON.stringify(sortValues)).toString('base64');

      const { body } = QueryBuilder.buildCodeSearchQuery(
        'project-123',
        'test',
        { pageToken }
      );
      const b = body as Record<string, any>;

      expect(b.search_after).toEqual(sortValues);
    });

    it('should ignore invalid pagination token', async () => {
      const { QueryBuilder } = await import('../src/services/query-builder.service.js');

      const { body } = QueryBuilder.buildCodeSearchQuery(
        'project-123',
        'test',
        { pageToken: 'invalid-token' }
      );
      const b = body as Record<string, any>;

      expect(b.search_after).toBeUndefined();
    });

    it('should sanitize special regex characters', async () => {
      const { QueryBuilder } = await import('../src/services/query-builder.service.js');

      // Query with special characters that could cause ReDoS
      const maliciousQuery = 'test+*?\\^$()[]{}|!';
      const { body } = QueryBuilder.buildCodeSearchQuery('project-123', maliciousQuery);
      const b = body as Record<string, any>;

      const multiMatch = b.query.bool.must[1].multi_match;
      // Special characters should be removed
      expect(multiMatch.query).not.toMatch(/[+\-*?\\^$(){}[\]|!]/);
    });

    it('should truncate long queries', async () => {
      const { QueryBuilder } = await import('../src/services/query-builder.service.js');

      // Create a very long query
      const longQuery = 'a'.repeat(500);
      const { body } = QueryBuilder.buildCodeSearchQuery('project-123', longQuery);
      const b = body as Record<string, any>;

      const multiMatch = b.query.bool.must[1].multi_match;
      expect(multiMatch.query.length).toBeLessThanOrEqual(200);
    });

    it('should handle empty query for project search', async () => {
      const { QueryBuilder } = await import('../src/services/query-builder.service.js');

      const { body } = QueryBuilder.buildProjectSearchQuery('');
      const b = body as Record<string, any>;

      // Should only have visibility filter (no query clause)
      expect(b.query.bool.must).toHaveLength(1);
    });
  });
});
