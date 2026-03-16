import { DeploymentProvider } from './provider_interface.js';
import { VercelProvider } from './vercel_provider.js';
import { DeployProvider } from '@workspace/database';

export function getProvider(type: DeployProvider): DeploymentProvider {
  switch (type) {
    case 'vercel':
      return new VercelProvider();
    case 'railway':
      throw new Error('Railway provider not implemented');
    case 'aws':
      throw new Error('AWS provider not implemented');
    case 'gcp':
      throw new Error('GCP provider not implemented');
    case 'azure':
      throw new Error('Azure provider not implemented');
    default:
      throw new Error(`Unknown provider: ${type}`);
  }
}
