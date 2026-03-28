/**
 * Rollback Manager
 * 
 * Manages workspace snapshots for safe rollback operations.
 * Creates snapshots before applying patches and restores on failure.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as os from 'os';
import {
  SnapshotMetadata,
  SnapshotFileInfo,
  SnapshotStatus,
  RollbackResult,
  RollbackConfig,
  ROLLBACK_DEFAULTS,
  ROLLBACK_ERRORS,
  RollbackError,
} from './execution_types.js';
import { WorkspaceFS } from '../workspace/workspace_fs.js';

/**
 * Rollback Manager
 */
export class RollbackManager {
  private config: Required<RollbackConfig>;
  private snapshots: Map<string, SnapshotMetadata> = new Map();

  constructor(config?: Partial<RollbackConfig>) {
    this.config = { ...ROLLBACK_DEFAULTS, ...config } as Required<RollbackConfig>;
  }

  /**
   * Create a snapshot of the workspace
   */
  async createSnapshot(
    workspace: WorkspaceFS,
    taskId?: string,
    description?: string
  ): Promise<string> {
    const snapshotId = this.generateSnapshotId();
    const workspacePath = workspace.getConfig().rootPath;
    const snapshotPath = this.getSnapshotPath(workspacePath, snapshotId);

    // Create snapshot directory
    await fs.mkdir(snapshotPath, { recursive: true });

    // Update metadata
    const metadata: SnapshotMetadata = {
      id: snapshotId,
      workspaceId: workspacePath,
      taskId,
      status: 'creating',
      files: [],
      totalSizeBytes: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.retentionMs),
      description,
    };

    this.snapshots.set(snapshotId, metadata);

    try {
      // List all files in workspace
      const files = await workspace.listFiles();

      // Copy each file to snapshot
      for (const file of files) {
        if (file.type === 'file') {
          try {
            const content = await workspace.readFile(file.path);
            const hash = this.hashContent(content);

            // Store file in snapshot
            const snapshotFilePath = path.join(snapshotPath, file.path);
            await fs.mkdir(path.dirname(snapshotFilePath), { recursive: true });
            await fs.writeFile(snapshotFilePath, content);

            // Record file info
            metadata.files.push({
              path: file.path,
              hash,
              sizeBytes: content.length,
              modifiedAt: new Date(),
            });

            metadata.totalSizeBytes += content.length;
          } catch {
            // Skip files that can't be read
          }
        }
      }

      // Save metadata
      await this.saveSnapshotMetadata(snapshotPath, metadata);

      // Update status
      metadata.status = 'ready';

      // Cleanup old snapshots
      await this.cleanupOldSnapshots(workspacePath);

      return snapshotId;
    } catch (error) {
      metadata.status = 'failed';
      this.snapshots.delete(snapshotId);

      // Remove failed snapshot directory
      try {
        await fs.rm(snapshotPath, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }

      throw new RollbackError(
        `Failed to create snapshot: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ROLLBACK_ERRORS.RESTORE_FAILED,
        snapshotId
      );
    }
  }

  /**
   * Restore workspace from snapshot
   */
  async restoreSnapshot(
    workspace: WorkspaceFS,
    snapshotId: string
  ): Promise<RollbackResult> {
    const startTime = Date.now();
    const workspacePath = workspace.getConfig().rootPath;
    const snapshotPath = this.getSnapshotPath(workspacePath, snapshotId);

    // Get metadata
    let metadata: SnapshotMetadata | undefined = this.snapshots.get(snapshotId);
    if (!metadata) {
      // Try to load from disk
      const loaded = await this.loadSnapshotMetadata(snapshotPath);
      if (loaded) {
        metadata = loaded;
        this.snapshots.set(snapshotId, metadata);
      }
    }

    if (!metadata) {
      throw new RollbackError(
        `Snapshot not found: ${snapshotId}`,
        ROLLBACK_ERRORS.SNAPSHOT_NOT_FOUND,
        snapshotId
      );
    }

    // Check expiration
    if (metadata.expiresAt && metadata.expiresAt < new Date()) {
      throw new RollbackError(
        `Snapshot expired: ${snapshotId}`,
        ROLLBACK_ERRORS.SNAPSHOT_EXPIRED,
        snapshotId
      );
    }

    // Update status
    metadata.status = 'restoring';

    const filesRestored: string[] = [];
    const filesFailed: string[] = [];

    try {
      // Restore each file from snapshot
      for (const fileInfo of metadata.files) {
        try {
          const snapshotFilePath = path.join(snapshotPath, fileInfo.path);
          const content = await fs.readFile(snapshotFilePath, 'utf-8');

          // Write back to workspace
          await workspace.writeFile(fileInfo.path, content);
          filesRestored.push(fileInfo.path);
        } catch {
          filesFailed.push(fileInfo.path);
        }
      }

      // Update status
      metadata.status = 'restored';

      return {
        snapshotId,
        success: filesFailed.length === 0,
        filesRestored: filesRestored.length,
        filesFailed,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      metadata.status = 'failed';

      return {
        snapshotId,
        success: false,
        filesRestored: filesRestored.length,
        filesFailed,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get snapshot metadata
   */
  getSnapshot(snapshotId: string): SnapshotMetadata | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * List snapshots for a workspace
   */
  async listSnapshots(workspacePath: string): Promise<SnapshotMetadata[]> {
    const snapshotsDir = this.getSnapshotsDir(workspacePath);

    try {
      const entries = await fs.readdir(snapshotsDir);
      const snapshots: SnapshotMetadata[] = [];

      for (const entry of entries) {
        const snapshotPath = path.join(snapshotsDir, entry);
        const metadata = await this.loadSnapshotMetadata(snapshotPath);
        if (metadata) {
          snapshots.push(metadata);
        }
      }

      return snapshots.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch {
      return [];
    }
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(workspacePath: string, snapshotId: string): Promise<boolean> {
    const snapshotPath = this.getSnapshotPath(workspacePath, snapshotId);

    try {
      await fs.rm(snapshotPath, { recursive: true });
      this.snapshots.delete(snapshotId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup expired snapshots
   */
  async cleanupExpiredSnapshots(workspacePath: string): Promise<number> {
    const snapshots = await this.listSnapshots(workspacePath);
    let deleted = 0;

    for (const snapshot of snapshots) {
      if (snapshot.expiresAt && snapshot.expiresAt < new Date()) {
        await this.deleteSnapshot(workspacePath, snapshot.id);
        deleted++;
      }
    }

    return deleted;
  }

  // Private methods

  /**
   * Get snapshots directory for workspace
   */
  private getSnapshotsDir(workspacePath: string): string {
    const wsHash = crypto.createHash('md5').update(workspacePath).digest('hex').slice(0, 8);
    return path.join(os.tmpdir(), this.config.snapshotDir, `ws_${wsHash}`);
  }

  /**
   * Get path for a specific snapshot
   */
  private getSnapshotPath(workspacePath: string, snapshotId: string): string {
    return path.join(this.getSnapshotsDir(workspacePath), snapshotId);
  }

  /**
   * Generate unique snapshot ID
   */
  private generateSnapshotId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`snapshot-${Date.now()}-${Math.random()}`);
    return `snap_${hash.digest('hex').slice(0, 12)}`;
  }

  /**
   * Hash content for integrity check
   */
  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Save snapshot metadata to disk
   */
  private async saveSnapshotMetadata(
    snapshotPath: string,
    metadata: SnapshotMetadata
  ): Promise<void> {
    const metadataPath = path.join(snapshotPath, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Load snapshot metadata from disk
   */
  private async loadSnapshotMetadata(snapshotPath: string): Promise<SnapshotMetadata | null> {
    try {
      const metadataPath = path.join(snapshotPath, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(content) as SnapshotMetadata;

      // Restore dates
      metadata.createdAt = new Date(metadata.createdAt);
      if (metadata.expiresAt) {
        metadata.expiresAt = new Date(metadata.expiresAt);
      }
      for (const file of metadata.files) {
        file.modifiedAt = new Date(file.modifiedAt);
      }

      return metadata;
    } catch {
      return null;
    }
  }

  /**
   * Cleanup old snapshots to maintain limit
   */
  private async cleanupOldSnapshots(workspacePath: string): Promise<void> {
    const snapshots = await this.listSnapshots(workspacePath);

    if (snapshots.length > this.config.maxSnapshots) {
      // Delete oldest snapshots
      const toDelete = snapshots.slice(this.config.maxSnapshots);
      for (const snapshot of toDelete) {
        await this.deleteSnapshot(workspacePath, snapshot.id);
      }
    }
  }
}

// Singleton instance
let defaultManager: RollbackManager | null = null;

/**
 * Get default rollback manager
 */
export function getRollbackManager(): RollbackManager {
  if (!defaultManager) {
    defaultManager = new RollbackManager();
  }
  return defaultManager;
}

/**
 * Create rollback manager
 */
export function createRollbackManager(config?: Partial<RollbackConfig>): RollbackManager {
  return new RollbackManager(config);
}

/**
 * Create snapshot helper
 */
export async function createSnapshot(
  workspace: WorkspaceFS,
  taskId?: string,
  description?: string
): Promise<string> {
  const manager = getRollbackManager();
  return manager.createSnapshot(workspace, taskId, description);
}

/**
 * Restore snapshot helper
 */
export async function restoreSnapshot(
  workspace: WorkspaceFS,
  snapshotId: string
): Promise<RollbackResult> {
  const manager = getRollbackManager();
  return manager.restoreSnapshot(workspace, snapshotId);
}
