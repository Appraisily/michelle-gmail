import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { logger } from './logger.js';

const client = new SecretManagerServiceClient();

export async function getSecrets() {
  try {
    const secrets = {};
    const secretNames = [
      'GMAIL_CLIENT_ID',
      'GMAIL_CLIENT_SECRET',
      'GMAIL_REFRESH_TOKEN'
    ];

    for (const secretName of secretNames) {
      const [version] = await client.accessSecretVersion({
        name: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`
      });
      
      secrets[secretName] = version.payload.data.toString();
      logger.info(`Secret ${secretName} loaded successfully`);
    }

    return secrets;
  } catch (error) {
    logger.error('Error fetching secrets:', error);
    throw new Error(`Error fetching secrets: ${error.message}`);
  }
}