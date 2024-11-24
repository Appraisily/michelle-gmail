import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { logger } from './logger.js';

const client = new SecretManagerServiceClient();

export async function getSecrets() {
  try {
    const secrets = {};
    const secretNames = [
      'GMAIL_CLIENT_ID',
      'GMAIL_CLIENT_SECRET',
      'GMAIL_REFRESH_TOKEN',
      'OPENAI_API_KEY',
      'MICHELLE_CHAT_LOG_SPREADSHEETID',
      'SHARED_SECRET'  // Added SHARED_SECRET to the list
    ];

    for (const secretName of secretNames) {
      try {
        const [version] = await client.accessSecretVersion({
          name: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`
        });
        
        secrets[secretName] = version.payload.data.toString();
        logger.info(`Secret ${secretName} loaded successfully`);
      } catch (error) {
        logger.error(`Error loading secret ${secretName}:`, {
          error: error.message,
          stack: error.stack
        });
        // Don't throw here, continue loading other secrets
      }
    }

    // Verify we have all required secrets
    const requiredSecrets = [
      'GMAIL_CLIENT_ID',
      'GMAIL_CLIENT_SECRET',
      'GMAIL_REFRESH_TOKEN',
      'OPENAI_API_KEY',
      'MICHELLE_CHAT_LOG_SPREADSHEETID',
      'SHARED_SECRET'
    ];

    const missingSecrets = requiredSecrets.filter(name => !secrets[name]);
    if (missingSecrets.length > 0) {
      throw new Error(`Missing required secrets: ${missingSecrets.join(', ')}`);
    }

    return secrets;
  } catch (error) {
    logger.error('Error fetching secrets:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}