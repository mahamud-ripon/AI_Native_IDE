import { createHash, randomBytes } from 'crypto';

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function generateToken(length = 32): string {
  return randomBytes(length).toString('hex');
}

export function generateSlug(name: string): string {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const uniqueSuffix = randomBytes(4).toString('hex');
  return `${baseSlug}-${uniqueSuffix}`;
}
