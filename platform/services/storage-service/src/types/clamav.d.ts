declare module 'clamav.js' {
  export interface ClamAVScanner {
    scan(buffer: Buffer): Promise<{ isInfected: boolean; viruses?: string[] }>;
    ping(): Promise<void>;
  }

  export interface ClamAVOptions {
    host?: string;
    port?: number;
  }

  export function createScanner(options: ClamAVOptions): ClamAVScanner;
}
