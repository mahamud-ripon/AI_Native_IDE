import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { WebContainer } from '@webcontainer/api';

import { ensureContainer } from '../runtime/webcontainerManager';

/**
 * FileSystem adapter for isomorphic-git that uses WebContainer's fs.
 * This bridges git operations to the browser-based filesystem.
 */
function createWebContainerFsAdapter(container: WebContainer) {
  return {
    promises: {
      readFile: async (path: string, options?: { encoding?: string }) => {
        try {
          const encoding = options?.encoding || 'utf8';
          const content = await container.fs.readFile(path, encoding as 'utf8' | 'binary');
          return content;
        } catch (err) {
          throw new Error(`Failed to read ${path}: ${err}`);
        }
      },

      writeFile: async (path: string, content: string | Uint8Array, _options?: object) => {
        try {
          await container.fs.writeFile(path, content);
        } catch (err) {
          throw new Error(`Failed to write ${path}: ${err}`);
        }
      },

      mkdir: async (path: string, _options?: object) => {
        try {
          await container.fs.mkdir(path, { recursive: true });
        } catch (err) {
          // Directory might already exist, ignore
        }
      },

      readdir: async (path: string, _options?: object) => {
        try {
          const entries = await container.fs.readdir(path, { withFileTypes: true });
          return entries.map(e => e.name);
        } catch (err) {
          throw new Error(`Failed to readdir ${path}: ${err}`);
        }
      },

      stat: async (path: string) => {
        try {
          const entries = await container.fs.readdir(path.split('/').slice(0, -1).join('/') || '/', { withFileTypes: true });
          const name = path.split('/').pop() || '';
          const entry = entries.find(e => e.name === name);
          if (!entry) {
            throw new Error(`File not found: ${path}`);
          }
          return {
            isFile: () => entry.isFile(),
            isDirectory: () => entry.isDirectory(),
            size: 0,
            mode: 0o644,
            mtime: new Date(),
            ctime: new Date(),
          };
        } catch (err) {
          throw new Error(`Failed to stat ${path}: ${err}`);
        }
      },

      unlink: async (path: string) => {
        try {
          await container.fs.rm(path);
        } catch (err) {
          throw new Error(`Failed to unlink ${path}: ${err}`);
        }
      },

      rmdir: async (path: string) => {
        try {
          await container.fs.rm(path, { recursive: true });
        } catch (err) {
          throw new Error(`Failed to rmdir ${path}: ${err}`);
        }
      },

      lstat: async (path: string) => {
        const entries = await container.fs.readdir(path.split('/').slice(0, -1).join('/') || '/', { withFileTypes: true });
        const name = path.split('/').pop() || '';
        const entry = entries.find(e => e.name === name);
        if (!entry) {
          throw new Error(`File not found: ${path}`);
        }
        return {
          isFile: () => entry.isFile(),
          isDirectory: () => entry.isDirectory(),
          isSymbolicLink: () => false,
          size: 0,
          mode: 0o644,
        };
      },

      readlink: async (_path: string) => {
        throw new Error('Symlinks not supported in WebContainer');
      },

      symlink: async (_target: string, _path: string) => {
        throw new Error('Symlinks not supported in WebContainer');
      },

      chmod: async (_path: string, _mode: number) => {
        // WebContainer doesn't support chmod, ignore
      },
    },
  };
}

export interface GitCloneOptions {
  url: string;
  dir?: string;
  ref?: string;
  depth?: number;
  onProgress?: (event: { phase: string; loaded: number; total: number }) => void;
  onAuth?: () => { username: string; password: string } | Promise<{ username: string; password: string }>;
}

export interface GitCommitOptions {
  dir: string;
  message: string;
  author?: { name: string; email: string };
}

export interface GitPushOptions {
  dir: string;
  remote?: string;
  ref?: string;
  onAuth?: () => { username: string; password: string } | Promise<{ username: string; password: string }>;
}

export interface CommitInfo {
  oid: string;
  commit: {
    message: string;
    tree: string;
    parent: string[];
    author: { name: string; email: string; timestamp: number };
    committer: { name: string; email: string; timestamp: number };
  };
}

class GitService {
  private container: WebContainer | null = null;

  private async getFs() {
    if (!this.container) {
      this.container = await ensureContainer();
    }
    return createWebContainerFsAdapter(this.container);
  }

  /**
   * Clone a repository into the WebContainer filesystem.
   * Uses shallow clone by default for browser performance.
   */
  async clone(options: GitCloneOptions): Promise<string> {
    const fs = await this.getFs();
    const dir = options.dir || '/repo';

    await git.clone({
      fs,
      http,
      url: options.url,
      dir,
      ref: options.ref || 'main',
      depth: options.depth ?? 1,
      singleBranch: true, // Only clone the specified branch for performance
      onProgress: options.onProgress as any,
      onAuth: options.onAuth,
    });

    return dir;
  }

  /**
   * Initialize a new git repository.
   */
  async init(dir: string = '/'): Promise<void> {
    const fs = await this.getFs();
    await git.init({ fs, dir });
  }

  /**
   * Add files to the staging area.
   */
  async add(dir: string, filepath: string): Promise<void> {
    const fs = await this.getFs();
    await git.add({ fs, dir, filepath });
  }

  /**
   * Add all files to the staging area.
   */
  async addAll(dir: string): Promise<void> {
    const fs = await this.getFs();
    const status = await git.statusMatrix({ fs, dir });
    for (const row of status) {
      const filepath = row[0];
      const worktreeStatus = row[2];
      if (worktreeStatus === 2) {
        // Modified or added
        await git.add({ fs, dir, filepath });
      }
    }
  }

  /**
   * Commit staged changes.
   */
  async commit(options: GitCommitOptions): Promise<string> {
    const fs = await this.getFs();
    const sha = await git.commit({
      fs,
      dir: options.dir,
      message: options.message,
      author: options.author || {
        name: 'IDE User',
        email: 'user@ide.local',
      },
    });
    return sha;
  }

  /**
   * Push commits to remote.
   */
  async push(options: GitPushOptions): Promise<void> {
    const fs = await this.getFs();
    await git.push({
      fs,
      http,
      dir: options.dir,
      remote: options.remote || 'origin',
      ref: options.ref || 'main',
      onAuth: options.onAuth,
    });
  }

  /**
   * Pull changes from remote.
   */
  async pull(dir: string, options?: { ref?: string; onAuth?: GitPushOptions['onAuth'] }): Promise<void> {
    const fs = await this.getFs();
    await git.pull({
      fs,
      http,
      dir,
      ref: options?.ref || 'main',
      onAuth: options?.onAuth,
    });
  }

  /**
   * Get current status of the working directory.
   */
  async status(dir: string): Promise<string[][]> {
    const fs = await this.getFs();
    const matrix = await git.statusMatrix({ fs, dir });
    return matrix.map(row => [row[0], String(row[1]), String(row[2]), String(row[3] ?? 0)]);
  }

  /**
   * Get commit log.
   */
  async log(dir: string, options?: { depth?: number }): Promise<CommitInfo[]> {
    const fs = await this.getFs();
    const result = await git.log({
      fs,
      dir,
      depth: options?.depth ?? 10,
    });
    return result as CommitInfo[];
  }

  /**
   * Get current branch name.
   */
  async currentBranch(dir: string): Promise<string | undefined> {
    const fs = await this.getFs();
    const branch = await git.currentBranch({ fs, dir, fullname: false });
    return branch ?? undefined;
  }

  /**
   * List branches.
   */
  async listBranches(dir: string): Promise<string[]> {
    const fs = await this.getFs();
    return git.listBranches({ fs, dir });
  }

  /**
   * Checkout a branch.
   */
  async checkout(dir: string, ref: string): Promise<void> {
    const fs = await this.getFs();
    await git.checkout({ fs, dir, ref });
  }

  /**
   * Create a new branch.
   */
  async createBranch(dir: string, name: string): Promise<void> {
    const fs = await this.getFs();
    await git.branch({ fs, dir, ref: name });
  }

  /**
   * Get file content at a specific ref (e.g., HEAD).
   * Used for diff viewer to compare with working directory.
   */
  async show(dir: string, filepath: string, ref: string = 'HEAD'): Promise<string | null> {
    const fs = await this.getFs();
    try {
      // Resolve ref to get commit SHA
      const oid = await git.resolveRef({ fs, dir, ref });
      // Read the blob at that commit
      const blob = await git.readBlob({ fs, dir, oid, filepath });
      // Convert Uint8Array to string
      const decoder = new TextDecoder();
      return decoder.decode(blob.blob);
    } catch (err) {
      // File doesn't exist at this ref (e.g., new file)
      return null;
    }
  }

  /**
   * Read current file content from working directory.
   */
  async readFile(dir: string, filepath: string): Promise<string | null> {
    try {
      const container = await ensureContainer();
      const content = await container.fs.readFile(`${dir}/${filepath}`.replace(/\/+/g, '/'), 'utf8');
      return content;
    } catch (err) {
      return null;
    }
  }
}

export const gitService = new GitService();
