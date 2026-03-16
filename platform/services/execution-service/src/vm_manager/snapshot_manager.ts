import { redis, RedisKeys } from '../lib/redis.js';
import { config } from '../config/index.js';

export const SnapshotManager = {
  async hibernateVM(vmId: string, projectId: string): Promise<void> {
    console.log(`[Snapshot] Hibernate VM ${vmId} for project ${projectId}`);

    // In production: firecracker --api-sock /tmp/firecracker.sock \
    //   --snapshot-load /path/to/snapshots --resume

    // Save state to Redis
    await redis.set(
      RedisKeys.vmState(vmId),
      JSON.stringify({
        projectId,
        hibernatedAt: Date.now(),
        status: 'hibernated'
      }),
      'EX', 86400 * 7 // 7 days max
    );

    // Publish event
    await redis.publish('vm.events', JSON.stringify({
      type: 'vm.hibernate',
      vmId,
      projectId
    }));
  },

  async restoreVM(vmId: string): Promise<boolean> {
    const state = await redis.get(RedisKeys.vmState(vmId));

    if (!state) {
      console.log(`[Snapshot] No snapshot found for VM ${vmId}`);
      return false;
    }

    const { projectId } = JSON.parse(state);
    console.log(`[Snapshot] Restore VM ${vmId} for project ${projectId}`);

    // In production: firecracker --api-sock /tmp/firecracker.sock \
    //   --snapshot-load /path/to/snapshots --resume

    await redis.del(RedisKeys.vmState(vmId));

    return true;
  },

  async cleanupStaleSnapshots(): Promise<void> {
    const keys = await redis.keys('vm:*:state');

    for (const key of keys) {
      const ttl = await redis.ttl(key);
      if (ttl <= 0) {
        await redis.del(key);
      }
    }
  }
};
