import type { WebContainer } from '@webcontainer/api';

export type FileWatchEvent = {
  type: 'create' | 'update' | 'delete';
  path: string;
  entryType: 'file' | 'directory';
  timestamp: number;
};

export type FileWatchCallback = (event: FileWatchEvent) => void;

/**
 * Workspace file watcher that detects WebContainer FS changes
 * and notifies subscribers (Monaco models, file tree, etc.)
 */
class FileWatcher {
  private container: WebContainer | null = null;
  private subscribers = new Set<FileWatchCallback>();
  private knownFiles = new Map<string, string>(); // path -> content hash or directory marker
  private watchInterval: ReturnType<typeof setInterval> | null = null;
  private watchPaths: string[] = [];

  /**
   * Initialize the watcher with a WebContainer instance.
   */
  async init(container: WebContainer): Promise<void> {
    this.container = container;
    // Initial scan
    await this.scanDirectory('.');
    // Start polling for changes (WebContainer doesn't have native watch)
    this.startPolling();
  }

  /**
   * Subscribe to file change events.
   */
  subscribe(callback: FileWatchCallback): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Add a path to watch.
   */
  watch(path: string): void {
    if (!this.watchPaths.includes(path)) {
      this.watchPaths.push(path);
    }
  }

  /**
   * Remove a path from watching.
   */
  unwatch(path: string): void {
    this.watchPaths = this.watchPaths.filter(p => p !== path);
  }

  /**
   * Stop watching and cleanup.
   */
  destroy(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    this.subscribers.clear();
    this.knownFiles.clear();
    this.container = null;
  }

  /**
   * Simple hash function for content change detection.
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  /**
   * Scan a directory recursively and build initial state.
   */
  private async scanDirectory(dir: string): Promise<void> {
    if (!this.container) return;

    try {
      const entries = await this.container.fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = this.normalizePath(dir, entry.name);
        
        if (entry.isDirectory()) {
          this.knownFiles.set(fullPath, '__dir__');
          await this.scanDirectory(fullPath);
        } else if (entry.isFile()) {
          // Hash content for change detection
          const content = await this.container.fs.readFile(fullPath, 'utf8');
          const hash = this.hashContent(typeof content === 'string' ? content : new TextDecoder().decode(content as Uint8Array));
          this.knownFiles.set(fullPath, hash);
        }
      }
    } catch (err) {
      // Directory might not exist yet
    }
  }

  /**
   * Start polling for file changes.
   * WebContainer doesn't support native fs.watch, so we poll.
   */
  private startPolling(): void {
    // Poll every 500ms for changes
    this.watchInterval = setInterval(() => this.poll(), 500);
  }

  /**
   * Poll for file system changes.
   */
  private async poll(): Promise<void> {
    if (!this.container) return;

    const currentFiles = new Map<string, string>();
    
    // Scan watched paths
    for (const watchPath of this.watchPaths.length > 0 ? this.watchPaths : ['.']) {
      await this.collectFiles(watchPath, currentFiles);
    }

    // Detect changes
    for (const [path, hash] of currentFiles) {
      const oldHash = this.knownFiles.get(path);
      
      if (oldHash === undefined) {
        // New file
        this.notify({
          type: 'create',
          path,
          entryType: hash === '__dir__' ? 'directory' : 'file',
          timestamp: Date.now(),
        });
      } else if (oldHash !== hash) {
        // Modified file
        this.notify({
          type: 'update',
          path,
          entryType: hash === '__dir__' ? 'directory' : 'file',
          timestamp: Date.now(),
        });
      }
    }

    // Detect deletions
    for (const [path, oldHash] of this.knownFiles) {
      if (!currentFiles.has(path)) {
        this.notify({
          type: 'delete',
          path,
          entryType: oldHash === '__dir__' ? 'directory' : 'file',
          timestamp: Date.now(),
        });
      }
    }

    // Update known state
    this.knownFiles = currentFiles;
  }

  /**
   * Collect files from a directory into the map.
   */
  private async collectFiles(dir: string, map: Map<string, string>): Promise<void> {
    if (!this.container) return;

    try {
      const entries = await this.container.fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = this.normalizePath(dir, entry.name);
        
        if (entry.isDirectory()) {
          map.set(fullPath, '__dir__');
          await this.collectFiles(fullPath, map);
        } else if (entry.isFile()) {
          // Hash content for change detection
          const content = await this.container.fs.readFile(fullPath, 'utf8');
          const hash = this.hashContent(typeof content === 'string' ? content : new TextDecoder().decode(content as Uint8Array));
          map.set(fullPath, hash);
        }
      }
    } catch (err) {
      // Directory might not exist
    }
  }

  /**
   * Notify all subscribers of a change event.
   */
  private notify(event: FileWatchEvent): void {
    for (const callback of this.subscribers) {
      try {
        callback(event);
      } catch (err) {
        console.error('[FileWatcher] Callback error:', err);
      }
    }
  }

  private normalizePath(dir: string, name: string): string {
    const base = dir === '.' || dir === '/' ? '' : dir.replace(/^\//, '');
    return base ? `${base}/${name}` : name;
  }
}

export const fileWatcher = new FileWatcher();
