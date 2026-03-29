import { WebContainer, type FileSystemTree } from '@webcontainer/api';

export type RuntimeStatus =
  | 'idle'
  | 'booting'
  | 'mounted'
  | 'shell-ready'
  | 'installing'
  | 'running'
  | 'unsupported'
  | 'error';

export interface RuntimeSnapshot {
  status: RuntimeStatus;
  projectId: string | null;
  previewUrl: string;
  message: string | null;
}

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export interface ShellProcess {
  process: Awaited<ReturnType<WebContainer['spawn']>>;
  input: WritableStream<string>;
  output: ReadableStream<string>;
}

export interface MountedFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: MountedFileEntry[];
}

type RuntimeListener = (snapshot: RuntimeSnapshot) => void;

let containerInstance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;
let installPromise: Promise<void> | null = null;
let devServerPromise: Promise<void> | null = null;
let mountedProjectId: string | null = null;
let installedProjectId: string | null = null;
let devServerProjectId: string | null = null;
let listenersRegistered = false;
let devProcess: Awaited<ReturnType<WebContainer['spawn']>> | null = null;
let shellProcess: Awaited<ReturnType<WebContainer['spawn']>> | null = null;

const listeners = new Set<RuntimeListener>();

let runtimeSnapshot: RuntimeSnapshot = {
  status: 'idle',
  projectId: null,
  previewUrl: '',
  message: null,
};

function buildFileTreeFromMap(files: Record<string, string>): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const [rawPath, contents] of Object.entries(files)) {
    const normalizedPath = rawPath.replace(/^\//, '');
    if (!normalizedPath) {
      continue;
    }

    const isDirectory = normalizedPath.endsWith('/');
    const parts = normalizedPath.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let cursor: Record<string, any> = tree;

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;

      if (isLeaf) {
        if (isDirectory) {
          cursor[part] ||= { directory: {} };
        } else {
          cursor[part] = {
            file: { contents },
          };
        }
      } else {
        cursor[part] ||= { directory: {} };
        cursor = cursor[part].directory;
      }
    }
  }

  return tree;
}

function notifyRuntimeListeners(): void {
  for (const listener of listeners) {
    try {
      listener(runtimeSnapshot);
    } catch (error) {
      console.error('[WebContainer] Runtime listener failed:', error);
    }
  }
}

function setRuntimeSnapshot(patch: Partial<RuntimeSnapshot>): void {
  runtimeSnapshot = {
    ...runtimeSnapshot,
    ...patch,
  };
  notifyRuntimeListeners();
}

function getUnsupportedMessage(): string {
  return [
    'WebContainer is unavailable in this browser session.',
    'Check that cross-origin isolation is enabled, Service Workers are allowed, and third-party storage/cookie blockers are not preventing WebContainer domains from booting.',
  ].join(' ');
}

function ensureBrowserSupport(): void {
  if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
    const message = getUnsupportedMessage();
    setRuntimeSnapshot({
      status: 'unsupported',
      message,
      previewUrl: '',
    });
    throw new Error(message);
  }
}

function registerRuntimeListeners(container: WebContainer): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  container.on('server-ready', (_port, url) => {
    setRuntimeSnapshot({
      status: 'running',
      previewUrl: url,
      message: 'Development server is ready.',
    });
  });

  (container as any).on?.('preview-message', (event: unknown) => {
    if (typeof event === 'string') {
      setRuntimeSnapshot({ message: event });
      return;
    }

    if (event && typeof event === 'object') {
      const payload = event as { message?: string; type?: string };
      if (payload.message) {
        setRuntimeSnapshot({
          message: payload.message,
          status: payload.type === 'error' ? 'error' : runtimeSnapshot.status,
        });
      }
    }
  });

  (container as any).on?.('error', (error: unknown) => {
    const message = error instanceof Error ? error.message : 'WebContainer runtime error';
    setRuntimeSnapshot({
      status: 'error',
      message,
    });
  });
}

function pipeOutput(
  process: Awaited<ReturnType<WebContainer['spawn']>>,
  onOutput?: (data: string) => void,
): void {
  if (!onOutput) return;

  process.output.pipeTo(
    new WritableStream({
      write(chunk) {
        onOutput(chunk);
      },
    }),
  ).catch(() => {
    // A consumer may disconnect during teardown; ignore.
  });
}

function resetProcessesForProjectSwitch(projectId: string): void {
  if (mountedProjectId === null || mountedProjectId === projectId) return;

  if (devProcess) {
    try {
      devProcess.kill();
    } catch {
      // ignore
    }
    devProcess = null;
  }

  if (shellProcess) {
    try {
      shellProcess.kill();
    } catch {
      // ignore
    }
    shellProcess = null;
  }

  installPromise = null;
  devServerPromise = null;
  installedProjectId = null;
  devServerProjectId = null;

  setRuntimeSnapshot({
    status: 'idle',
    projectId: null,
    previewUrl: '',
    message: null,
  });
}

function getMountedProjectIdOrThrow(): string {
  if (!mountedProjectId) {
    throw new Error('Project files are not mounted in WebContainer yet.');
  }
  return mountedProjectId;
}

export function getRuntimeStatus(): RuntimeSnapshot {
  return runtimeSnapshot;
}

export function subscribeRuntimeStatus(listener: RuntimeListener): () => void {
  listeners.add(listener);
  listener(runtimeSnapshot);
  return () => listeners.delete(listener);
}

export async function bootContainer(): Promise<WebContainer> {
  return ensureRuntime();
}

export function getContainer(): WebContainer | null {
  return containerInstance;
}

function normalizeRuntimePath(path: string): string {
  return path.replace(/^\//, '') || '.';
}

async function readDirectoryTree(
  container: WebContainer,
  dirPath = '.',
  parentPath = '',
): Promise<MountedFileEntry[]> {
  const entries = await container.fs.readdir(dirPath, { withFileTypes: true });
  const result: MountedFileEntry[] = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: currentPath,
        type: 'directory',
        children: await readDirectoryTree(container, currentPath, currentPath),
      });
    } else {
      result.push({
        name: entry.name,
        path: currentPath,
        type: 'file',
      });
    }
  }

  return result.sort((a, b) => {
    if (a.type === 'directory' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

export function isContainerBooted(): boolean {
  return containerInstance !== null;
}

export async function ensureRuntime(): Promise<WebContainer> {
  ensureBrowserSupport();

  if (containerInstance) {
    return containerInstance;
  }

  if (!bootPromise) {
    setRuntimeSnapshot({
      status: 'booting',
      message: 'Booting WebContainer...',
    });

    bootPromise = WebContainer.boot({ workdirName: 'project' })
      .then((container) => {
        containerInstance = container;
        registerRuntimeListeners(container);
        setRuntimeSnapshot({
          status: mountedProjectId ? 'mounted' : 'idle',
          message: mountedProjectId ? 'Project mounted in WebContainer.' : 'WebContainer ready.',
        });
        return container;
      })
      .catch((error) => {
        containerInstance = null;
        bootPromise = null;
        setRuntimeSnapshot({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to boot WebContainer.',
        });
        throw error;
      });
  }

  return bootPromise;
}

export function ensureContainer(): Promise<WebContainer> {
  return ensureRuntime();
}

export async function mountDemoProject(projectId: string): Promise<void> {
  await ensureProjectMounted(projectId);
}

export async function mountProject(projectId: string): Promise<void> {
  await ensureProjectMounted(projectId);
}

export async function ensureProjectMounted(projectId: string): Promise<WebContainer> {
  const container = await ensureRuntime();

  if (mountedProjectId === projectId) {
    if (runtimeSnapshot.status === 'idle' || runtimeSnapshot.status === 'booting') {
      setRuntimeSnapshot({
        status: 'mounted',
        projectId,
        message: 'Project files mounted in WebContainer.',
      });
    }
    return container;
  }

  resetProcessesForProjectSwitch(projectId);

  const { workspaceService } = await import('../../workspace/workspaceService');
  const snapshot = await workspaceService.getSnapshot(projectId);
  const tree = buildFileTreeFromMap(snapshot);

  await container.mount(tree);

  mountedProjectId = projectId;
  setRuntimeSnapshot({
    status: 'mounted',
    projectId,
    previewUrl: '',
    message: 'Project files mounted in WebContainer.',
  });

  return container;
}

export async function listMountedDirectory(projectId: string): Promise<MountedFileEntry[]> {
  const container = await ensureProjectMounted(projectId);
  return readDirectoryTree(container);
}

export async function readMountedFile(projectId: string, path: string): Promise<string> {
  const container = await ensureProjectMounted(projectId);
  const content = await container.fs.readFile(normalizeRuntimePath(path), 'utf-8');
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

export async function ensureDependenciesInstalled(
  projectIdOrOutput?: string | ((data: string) => void),
  maybeOnOutput?: (data: string) => void,
): Promise<void> {
  const projectId = typeof projectIdOrOutput === 'string'
    ? projectIdOrOutput
    : getMountedProjectIdOrThrow();
  const onOutput = typeof projectIdOrOutput === 'function' ? projectIdOrOutput : maybeOnOutput;

  await ensureProjectMounted(projectId);

  if (installedProjectId === projectId) {
    return;
  }

  if (!installPromise) {
    installPromise = (async () => {
      setRuntimeSnapshot({
        status: 'installing',
        projectId,
        message: 'Installing project dependencies...',
      });

      const container = await ensureRuntime();
      const install = await container.spawn('npm', ['install']);
      pipeOutput(install, onOutput);

      const exitCode = await install.exit;
      if (exitCode !== 0) {
        throw new Error(`npm install failed (exit ${exitCode})`);
      }

      installedProjectId = projectId;
      setRuntimeSnapshot({
        status: 'mounted',
        projectId,
        message: 'Dependencies installed.',
      });
    })()
      .catch((error) => {
        setRuntimeSnapshot({
          status: 'error',
          projectId,
          message: error instanceof Error ? error.message : 'Failed to install dependencies.',
        });
        throw error;
      })
      .finally(() => {
        installPromise = null;
      });
  }

  return installPromise;
}

export async function startPreviewServer(
  projectIdOrOutput?: string | ((data: string) => void),
  maybeOnOutput?: (data: string) => void,
  options?: { forceRestart?: boolean },
): Promise<void> {
  const projectId = typeof projectIdOrOutput === 'string'
    ? projectIdOrOutput
    : getMountedProjectIdOrThrow();
  const onOutput = typeof projectIdOrOutput === 'function' ? projectIdOrOutput : maybeOnOutput;

  await ensureProjectMounted(projectId);
  await ensureDependenciesInstalled(projectId, onOutput);

  const shouldRestart = Boolean(options?.forceRestart);
  if (devServerProjectId === projectId && devProcess && !shouldRestart) {
    return;
  }

  if (devServerPromise) {
    await devServerPromise;
    if (devServerProjectId === projectId && devProcess && !shouldRestart) {
      return;
    }
  }

  devServerPromise = (async () => {
    if (devProcess) {
      try {
        devProcess.kill();
      } catch {
        // ignore
      }
      devProcess = null;
    }

    const container = await ensureRuntime();
    setRuntimeSnapshot({
      status: 'mounted',
      projectId,
      message: 'Starting development server...',
      previewUrl: '',
    });

    devProcess = await container.spawn('npm', ['run', 'dev']);
    devServerProjectId = projectId;
    pipeOutput(devProcess, onOutput);

    devProcess.exit.then((exitCode) => {
      if (exitCode !== 0) {
        setRuntimeSnapshot({
          status: 'error',
          projectId,
          message: `Dev server exited unexpectedly (exit ${exitCode}).`,
        });
      } else if (runtimeSnapshot.projectId === projectId && runtimeSnapshot.status !== 'running') {
        setRuntimeSnapshot({
          status: 'mounted',
          projectId,
          message: 'Dev server stopped.',
          previewUrl: '',
        });
      }
    }).catch(() => {
      // Ignore exit promise errors during teardown.
    });
  })()
    .finally(() => {
      devServerPromise = null;
    });

  return devServerPromise;
}

export async function restartPreviewServer(
  projectId: string,
  onOutput?: (data: string) => void,
): Promise<void> {
  return startPreviewServer(projectId, onOutput, { forceRestart: true });
}

export async function startDevServer(
  projectIdOrOutput?: string | ((data: string) => void),
  maybeOnOutput?: (data: string) => void,
): Promise<void> {
  return startPreviewServer(projectIdOrOutput as string | ((data: string) => void), maybeOnOutput);
}

export async function spawnTerminalShell(
  dimensions: TerminalDimensions = { cols: 80, rows: 24 },
): Promise<ShellProcess> {
  const container = await ensureRuntime();
  getMountedProjectIdOrThrow();

  if (shellProcess) {
    try {
      shellProcess.kill();
    } catch {
      // ignore
    }
    shellProcess = null;
  }

  shellProcess = await container.spawn('jsh', [], {
    env: { PS1: '~/project\n❯ ' },
    terminal: {
      cols: dimensions.cols,
      rows: dimensions.rows,
    },
  });

  setRuntimeSnapshot({
    status: 'shell-ready',
    projectId: mountedProjectId,
    message: 'Interactive shell connected.',
  });

  return {
    process: shellProcess,
    input: shellProcess.input,
    output: shellProcess.output,
  };
}

export async function spawnShell(
  dimensions: TerminalDimensions = { cols: 80, rows: 24 },
): Promise<ShellProcess> {
  return spawnTerminalShell(dimensions);
}

export function killShell(): void {
  if (shellProcess) {
    try {
      shellProcess.kill();
    } catch {
      // ignore
    }
    shellProcess = null;
  }

  if (runtimeSnapshot.status === 'shell-ready') {
    setRuntimeSnapshot({
      status: mountedProjectId ? 'mounted' : 'idle',
      message: mountedProjectId ? 'Project files mounted in WebContainer.' : null,
    });
  }
}

export async function writeFile(path: string, content: string): Promise<void> {
  const container = await ensureRuntime();

  const wcPath = path.startsWith('/') ? path.slice(1) : path;
  const dir = wcPath.includes('/') ? wcPath.substring(0, wcPath.lastIndexOf('/')) : '';
  if (dir) {
    await container.fs.mkdir(dir, { recursive: true }).catch(() => {
      // Directory may already exist.
    });
  }

  await container.fs.writeFile(wcPath, content, 'utf-8');
}

export async function writeMountedFile(projectId: string, path: string, content: string): Promise<void> {
  const container = await ensureProjectMounted(projectId);

  const wcPath = normalizeRuntimePath(path);
  const dir = wcPath.includes('/') ? wcPath.substring(0, wcPath.lastIndexOf('/')) : '';
  if (dir) {
    await container.fs.mkdir(dir, { recursive: true }).catch(() => {
      // Directory may already exist.
    });
  }

  await container.fs.writeFile(wcPath, content, 'utf-8');
}

export async function deleteMountedPath(projectId: string, path: string): Promise<void> {
  const container = await ensureProjectMounted(projectId);
  const wcPath = normalizeRuntimePath(path).replace(/\/+$/, '');

  try {
    await container.fs.rm(wcPath, { recursive: true });
  } catch {
    // Ignore already-deleted paths.
  }
}

export async function writeBatch(
  files: Record<string, string>,
): Promise<Array<{ path: string; success: boolean; error?: string }>> {
  const results = await Promise.allSettled(
    Object.entries(files).map(async ([path, content]) => {
      await writeFile(path, content);
      return path;
    }),
  );

  return results.map((result, index) => {
    const path = Object.keys(files)[index];
    if (result.status === 'fulfilled') {
      return { path, success: true };
    }
    return {
      path,
      success: false,
      error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
    };
  });
}
