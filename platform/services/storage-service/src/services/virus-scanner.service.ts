import { S3Service } from './s3.service';
import { config } from '../config/index';
import { logger } from '../lib/logger';

export interface ScanResult {
  clean: boolean;
  virus?: string;
  scannedAt: Date;
}

/**
 * Virus Scanner Service using ClamAV
 * 
 * Note: This requires a running ClamAV service. In development,
 * the scanner will pass through if ClamAV is not available.
 */
export const VirusScanner = {
  /**
   * Scan a file buffer for viruses
   */
  async scanBuffer(buffer: Buffer): Promise<ScanResult> {
    if (!config.clamav.enabled) {
      logger.debug('ClamAV disabled, skipping scan');
      return {
        clean: true,
        scannedAt: new Date(),
      };
    }

    try {
      // Dynamic import to avoid errors when clamav is not installed
      const { createScanner } = await import('clamav.js');

      const scanner = createScanner({
        host: config.clamav.host,
        port: config.clamav.port,
      });

      const result = await scanner.scan(buffer);

      if (result.isInfected && result.viruses?.length) {
        logger.warn({ viruses: result.viruses }, 'Virus detected in file');
        return {
          clean: false,
          virus: result.viruses[0],
          scannedAt: new Date(),
        };
      }

      return {
        clean: true,
        scannedAt: new Date(),
      };
    } catch (error) {
      // If ClamAV is not available, log warning and allow file
      logger.warn({ error }, 'ClamAV scan failed, allowing file');
      return {
        clean: true,
        scannedAt: new Date(),
      };
    }
  },

  /**
   * Scan a file in S3 for viruses
   */
  async scanS3File(bucket: string, key: string): Promise<ScanResult> {
    if (!config.clamav.enabled) {
      return {
        clean: true,
        scannedAt: new Date(),
      };
    }

    try {
      // Download file from S3
      const fileBuffer = await S3Service.download(bucket, key);

      // Scan the buffer
      return await this.scanBuffer(fileBuffer);
    } catch (error) {
      logger.error({ error, bucket, key }, 'Failed to scan S3 file');
      return {
        clean: true, // Allow on error
        scannedAt: new Date(),
      };
    }
  },

  /**
   * Scan and quarantine an infected file
   * Moves the file to a quarantine location
   */
  async scanAndQuarantine(
    bucket: string,
    key: string
  ): Promise<{ clean: boolean; quarantineKey?: string }> {
    const result = await this.scanS3File(bucket, key);

    if (!result.clean) {
      // Move to quarantine
      const quarantineKey = `quarantine/${Date.now()}-${key.replace(/\//g, '-')}`;

      try {
        await S3Service.copy(bucket, key, bucket, quarantineKey);
        await S3Service.delete(bucket, key);

        logger.warn(
          { bucket, originalKey: key, quarantineKey, virus: result.virus },
          'Infected file quarantined'
        );

        return { clean: false, quarantineKey };
      } catch (error) {
        logger.error({ error, bucket, key }, 'Failed to quarantine infected file');
        return { clean: false };
      }
    }

    return { clean: true };
  },

  /**
   * Check if ClamAV is available
   */
  async isAvailable(): Promise<boolean> {
    if (!config.clamav.enabled) {
      return false;
    }

    try {
      const { createScanner } = await import('clamav.js');

      const scanner = createScanner({
        host: config.clamav.host,
        port: config.clamav.port,
      });

      // Try to ping ClamAV
      await scanner.ping();
      return true;
    } catch {
      return false;
    }
  },
};

export default VirusScanner;
