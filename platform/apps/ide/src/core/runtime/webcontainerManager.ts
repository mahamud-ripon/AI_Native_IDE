import { WebContainer, type FileSystemTree } from '@webcontainer/api';

import { workspaceService } from '../../workspace/workspaceService';

let bootPromise: Promise<WebContainer> | null = null;
let installing = false;
let devProcess: Awaited<ReturnType<WebContainer['spawn']>> | null = null;
let shellProcess: Awaited<ReturnType<WebContainer['spawn']>> | null = null;

function buildFileTreeFromMap(files: Record<string, string>): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const [path, contents] of Object.entries(files)) {
    const parts = path.replace(/^\//, '').split('/');
    let cursor: any = tree;

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;

      if (isLeaf) {
        cursor[part] = {
          file: { contents }
        };
      } else {
        cursor[part] ||= { directory: {} };
        cursor = cursor[part].directory;
      }
    }
  }

  return tree;
}

export async function bootContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = WebContainer.boot();
  }
  return bootPromise;
}

export function getContainer(): WebContainer {
  if (!bootPromise) {
    throw new Error('WebContainer not booted. Call ensureContainer() first.');
  }
  // Note: This throws if the promise hasn't resolved yet.
  // Use ensureContainer() for async access.
  throw new Error('WebContainer not ready. Use ensureContainer() for async access.');
}

export function ensureContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = WebContainer.boot().catch((err) => {
      bootPromise = null;
      throw err;
    });
  }
  return bootPromise;
}

export function isContainerBooted(): boolean {
  return bootPromise !== null;
}

export async function mountDemoProject(projectId: string): Promise<void> {
  const wc = await ensureContainer();
  const snapshot = await workspaceService.getSnapshot(projectId);
  const tree = buildFileTreeFromMap(snapshot);
  await wc.mount(tree);
}

export async function ensureDependenciesInstalled(onOutput?: (data: string) => void): Promise<void> {
  if (installing) return;
  installing = true;

  try {
    const wc = await ensureContainer();
    const install = await wc.spawn('npm', ['install']);

    install.output.pipeTo(
      new WritableStream({
        write(chunk) {
          onOutput?.(chunk);
        }
      })
    );

    const exitCode = await install.exit;
    if (exitCode !== 0) {
      throw new Error(`npm install failed (exit ${exitCode})`);
    }
  } finally {
    installing = false;
  }
}

export async function startDevServer(onOutput?: (data: string) => void): Promise<void> {
  const wc = await ensureContainer();

  if (devProcess) {
    try {
      devProcess.kill();
    } catch {
      // ignore
    }
    devProcess = null;
  }

  devProcess = await wc.spawn('npm', ['run', 'dev']);

  devProcess.output.pipeTo(
    new WritableStream({
      write(chunk) {
        onOutput?.(chunk);
      }
    })
  );
}

export interface ShellProcess {
  process: Awaited<ReturnType<WebContainer['spawn']>>;
  input: WritableStream<string>;
  output: ReadableStream<string>;
}

export async function spawnShell(): Promise<ShellProcess> {
  const wc = await ensureContainer();

  if (shellProcess) {
    try {
      shellProcess.kill();
    } catch {
      // ignore
    }
    shellProcess = null;
  }

  shellProcess = await wc.spawn('jsh', [], {
    terminal: {
      cols: 80,
      rows: 24
    }
  });

  return {
    process: shellProcess!,
    input: shellProcess!.input,
    output: shellProcess!.output
  };
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
}
