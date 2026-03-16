import { prisma } from '../lib/prisma.js';
import dns from 'dns/promises';

const VERIFY_INTERVAL = 60000; // 60 seconds
const MAX_VERIFY_TIME = 48 * 60 * 60 * 1000; // 48 hours

export const DomainVerifier = {
  async start(): Promise<void> {
    console.log('[DomainVerifier] Starting domain verification worker');

    setInterval(async () => {
      try {
        await this.verifyPendingDomains();
      } catch (error) {
        console.error('[DomainVerifier] Error:', error);
      }
    }, VERIFY_INTERVAL);
  },

  async verifyPendingDomains(): Promise<void> {
    const pendingDomains = await prisma.projectDomain.findMany({
      where: {
        dnsVerified: false,
        createdAt: {
          gt: new Date(Date.now() - MAX_VERIFY_TIME)
        }
      }
    });

    for (const domain of pendingDomains) {
      // Generate expected CNAME target
      const cnameTarget = `${domain.domainName.split('.')[0]}.platform-deploy.io`;
      await this.verifyDomain(domain.id, domain.domainName, cnameTarget);
    }
  },

  async verifyDomain(
    domainId: string,
    domainName: string,
    cnameTarget: string
  ): Promise<void> {
    try {
      const records = await dns.resolveCname(domainName);

      if (records.includes(cnameTarget)) {
        // DNS verified, provision SSL
        await this.provisionSSL(domainId, domainName);

        await prisma.projectDomain.update({
          where: { id: domainId },
          data: {
            dnsVerified: true,
            sslStatus: 'active'
          }
        });

        console.log(`[DomainVerifier] Domain ${domainName} verified`);
      }
    } catch (error) {
      // CNAME not found yet
      console.log(`[DomainVerifier] Domain ${domainName} not verified yet`);
    }
  },

  async provisionSSL(domainId: string, domainName: string): Promise<void> {
    // In production, integrate with Let's Encrypt or Cloudflare
    console.log(`[DomainVerifier] Provisioning SSL for ${domainName}`);
  }
};
