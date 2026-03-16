import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';

export const FileSync = {
  async start(): Promise<void> {
    console.log('[FileSync] Starting file sync worker');

    // Subscribe to file change events
    const subscriber = redis.duplicate();
    await subscriber.subscribe('file.modified');

    subscriber.on('message', async (channel, message) => {
      if (channel === 'file.modified') {
        const payload = JSON.parse(message);
        await this.syncFile(payload);
      }
    });
  },

  async syncFile(payload: { projectId: string; fileId: string; content: string }): Promise<void> {
    console.log(`[FileSync] Syncing file ${payload.fileId} for project ${payload.projectId}`);

    // In production, this would write to the VM's mounted volume via virtio-fs
    // For now, just log the sync
    const vmKey = `vm:project:${payload.projectId}:active`;
    const vmId = await redis.get(vmKey);

    if (vmId) {
      // Write file to VM
      console.log(`[FileSync] Would write to VM ${vmId}: ${payload.fileId}`);
    }
  }
};
