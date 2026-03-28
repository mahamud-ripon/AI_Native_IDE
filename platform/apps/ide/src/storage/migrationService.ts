/**
 * Migration Service - Handles data migration and backwards compatibility
 * Migrates existing projects to new storage system
 */

import { indexedDBClient, fileSystemDB, fs } from '@/storage';
import { syncQueue } from '@/storage/syncQueue';

interface MigrationResult {
  success: boolean;
  migratedProjects: number;
  errors: string[];
}

class MigrationService {
  private readonly MIGRATION_KEY = 'ide_storage_migrated_v1';

  // Check if migration is needed
  async needsMigration(): Promise<boolean> {
    const migrated = localStorage.getItem(this.MIGRATION_KEY);
    return !migrated;
  }

  // Run migration from old storage to IndexedDB
  async runMigration(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      migratedProjects: 0,
      errors: [],
    };

    try {
      // Initialize IndexedDB
      await indexedDBClient.init();

      // Migrate from localStorage if any old data exists
      await this.migrateFromLocalStorage(result);

      // Mark as migrated
      localStorage.setItem(this.MIGRATION_KEY, 'true');

      console.log('[Migration] Completed successfully:', result);
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : 'Migration failed');
      console.error('[Migration] Failed:', error);
    }

    return result;
  }

  // Migrate from legacy localStorage format
  private async migrateFromLocalStorage(result: MigrationResult): Promise<void> {
    // Check for old file tree in localStorage
    const oldFileTree = localStorage.getItem('ide_file_tree');
    const oldFileContents = localStorage.getItem('ide_file_contents');

    if (oldFileTree && oldFileContents) {
      try {
        const tree = JSON.parse(oldFileTree);
        const contents = JSON.parse(oldFileContents);

        // Create a browser project
        const projectId = `migrated-${Date.now()}`;
        await indexedDBClient.saveProject({
          id: projectId,
          name: 'Migrated Project',
          type: 'browser',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          syncStatus: 'synced',
        });

        // Migrate files
        for (const [path, content] of Object.entries(contents)) {
          if (typeof content === 'string') {
            await fs.writeFile(projectId, path, content);
          }
        }

        result.migratedProjects++;

        // Clean up old localStorage
        localStorage.removeItem('ide_file_tree');
        localStorage.removeItem('ide_file_contents');

        console.log('[Migration] Migrated project from localStorage:', projectId);
      } catch (error) {
        result.errors.push(`Failed to migrate localStorage: ${error}`);
      }
    }
  }

  // Export browser project to cloud
  async exportProjectToCloud(
    projectId: string,
    cloudProjectId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Update project to reference cloud
      const project = await indexedDBClient.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      await indexedDBClient.saveProject({
        ...project,
        cloudProjectId,
        type: 'cloud',
        syncStatus: 'synced',
        lastSyncedAt: Date.now(),
      });

      // Queue all files for sync
      const files = await fs.getAllFiles(projectId);
      for (const file of files) {
        if (file.syncStatus !== 'deleted') {
          await syncQueue.queueOperation(
            projectId,
            file.path.endsWith('/') ? 'create' : 'update',
            file.path,
            file.content
          );
        }
      }

      console.log('[Migration] Exported project to cloud:', projectId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
      };
    }
  }

  // Backup all browser projects
  async createBackup(): Promise<{ success: boolean; data?: string; error?: string }> {
    try {
      const projects = await indexedDBClient.getAll<{
        id: string;
        name: string;
        type: string;
        createdAt: number;
      }>('projects');

      const backup = {
        version: 1,
        timestamp: Date.now(),
        projects: [] as any[],
      };

      for (const project of projects) {
        const files = await fs.getAllFiles(project.id);
        backup.projects.push({
          ...project,
          files: files.map(f => ({
            path: f.path,
            content: f.content,
            modifiedAt: f.modifiedAt,
          })),
        });
      }

      const json = JSON.stringify(backup, null, 2);
      return { success: true, data: json };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Backup failed',
      };
    }
  }

  // Restore from backup
  async restoreBackup(backupJson: string): Promise<{ success: boolean; error?: string }> {
    try {
      const backup = JSON.parse(backupJson);

      if (backup.version !== 1) {
        return { success: false, error: 'Unsupported backup version' };
      }

      for (const project of backup.projects) {
        // Create project
        await indexedDBClient.saveProject({
          id: project.id,
          name: project.name,
          type: project.type as 'browser' | 'cloud',
          createdAt: project.createdAt,
          updatedAt: Date.now(),
          syncStatus: 'synced',
        });

        // Restore files
        for (const file of project.files) {
          await fs.writeFile(project.id, file.path, file.content);
        }
      }

      console.log('[Migration] Restored', backup.projects.length, 'projects from backup');
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Restore failed',
      };
    }
  }

  // Clear all IndexedDB data (for logout/reset)
  async clearAllData(): Promise<void> {
    try {
      await indexedDBClient.clear('projects');
      await indexedDBClient.clear('files');
      await indexedDBClient.clear('syncQueue');
      localStorage.removeItem(this.MIGRATION_KEY);
      console.log('[Migration] Cleared all IndexedDB data');
    } catch (error) {
      console.error('[Migration] Failed to clear data:', error);
    }
  }

  // Get migration status
  getMigrationStatus(): { isMigrated: boolean; version: number } {
    const migrated = localStorage.getItem(this.MIGRATION_KEY);
    return {
      isMigrated: !!migrated,
      version: migrated ? 1 : 0,
    };
  }
}

// Singleton instance
export const migrationService = new MigrationService();

export default migrationService;
