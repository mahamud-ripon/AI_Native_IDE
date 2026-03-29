import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRemoteWorkspace } from './remote_workspace_fs.js';

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body)),
  } as unknown as Response;
}

describe('RemoteWorkspaceFS', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caches newly created files for immediate reads', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(404, { error: 'Not found' }))
      .mockResolvedValueOnce(mockResponse(201, {
        success: true,
        data: { id: 'file-1', path: 'Hero.jsx' },
      }));

    const workspace = createRemoteWorkspace({
      projectId: 'project-1',
      projectServiceUrl: 'http://project-service.test',
      internalApiKey: 'internal-key',
      userId: 'user-1',
    });

    await workspace.writeFile('Hero.jsx', 'export default function Hero() {}');
    const content = await workspace.readFile('Hero.jsx');

    expect(content).toBe('export default function Hero() {}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses cached file ids for subsequent writes', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(404, { error: 'Not found' }))
      .mockResolvedValueOnce(mockResponse(201, {
        success: true,
        data: { id: 'file-1', path: 'Hero.jsx' },
      }))
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { id: 'file-1' },
      }));

    const workspace = createRemoteWorkspace({
      projectId: 'project-1',
      projectServiceUrl: 'http://project-service.test',
      internalApiKey: 'internal-key',
      userId: 'user-1',
    });

    await workspace.writeFile('Hero.jsx', 'v1');
    await workspace.writeFile('Hero.jsx', 'v2');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'PUT' });
  });

  it('parses nested project-service envelopes when reading file content', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {
      success: true,
      data: {
        id: 'file-1',
        fileId: 'file-1',
        content: 'hello from project-service',
      },
    }));

    const workspace = createRemoteWorkspace({
      projectId: 'project-1',
      projectServiceUrl: 'http://project-service.test',
      internalApiKey: 'internal-key',
      userId: 'user-1',
    });

    await expect(workspace.readFile('Hero.jsx')).resolves.toBe('hello from project-service');
  });
});
