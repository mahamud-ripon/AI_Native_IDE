import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '../config/index.js';

const execAsync = promisify(exec);

export const TapManager = {
  async createTapDevice(tapName: string, vmIp: string): Promise<void> {
    try {
      // Create TAP device
      await execAsync(`ip tuntap add mode tap name ${tapName}`);
      await execAsync(`ip link set ${tapName} up`);

      // Set up routing
      await execAsync(`ip addr add ${vmIp}/24 dev ${tapName}`);

      // Apply rate limiting (tc)
      await execAsync(
        `tc qdisc add dev ${tapName} root tbf rate ${config.network.rateLimitMbps}mbit burst 1540 latency 50ms`
      );

      console.log(`[TapManager] Created TAP ${tapName} at ${vmIp}`);
    } catch (error) {
      console.error(`[TapManager] Failed to create TAP ${tapName}:`, error);
    }
  },

  async deleteTapDevice(tapName: string): Promise<void> {
    try {
      await execAsync(`ip link set ${tapName} down`);
      await execAsync(`ip tuntap del mode tap name ${tapName}`);
      console.log(`[TapManager] Deleted TAP ${tapName}`);
    } catch (error) {
      console.error(`[TapManager] Failed to delete TAP ${tapName}:`, error);
    }
  },

  async blockMetadataEndpoint(tapName: string): Promise<void> {
    // Block AWS IMDS
    await execAsync(
      `iptables -A OUTPUT -d 169.254.169.254 -o ${tapName} -j DROP`
    );
    console.log(`[TapManager] Blocked metadata endpoint on ${tapName}`);
  },

  async blockInternalNetwork(tapName: string): Promise<void> {
    // Block Kubernetes internal network
    await execAsync(
      `iptables -A OUTPUT -d 10.96.0.0/12 -o ${tapName} -j DROP`
    );
    console.log(`[TapManager] Blocked internal network on ${tapName}`);
  }
};
