import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { logger } from './logger.js';

class SecretsCache {
  constructor() {
    this.client = new SecretManagerServiceClient();
    this.cache = new Map();
    this.TTL = 30 * 60 * 1000; // 30 minutes
  }

  async getSecret(name) {
    const cached = this.cache.get(name);
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return cached.value;
    }

    try {
      const [version] = await this.client.accessSecretVersion({
        name: `projects/${process.env.PROJECT_ID}/secrets/${name}/versions/latest`
      });

      const value = version.payload.data.toString();
      this.cache.set(name, {
        value,
        timestamp: Date.now()
      });

      logger.debug('Secret loaded and cached', { name });
      return value;
    } catch (error) {
      logger.error(`Error loading secret ${name}:`, {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async getAllSecrets() {
    const secrets = {};
    const requiredSecrets = [
      'GMAIL_CLIENT_ID',
      'GMAIL_CLIENT_SECRET',
      'GMAIL_REFRESH_TOKEN',
      'OPENAI_API_KEY',
      'MICHELLE_CHAT_LOG_SPREADSHEETID',
      'DATA_HUB_API_KEY',
      'DIRECT_API_KEY'  // Add the new secret for direct message endpoint
    ];

    for (const name of requiredSecrets) {
      try {
        secrets[name] = await this.getSecret(name);
      } catch (error) {
        logger.error(`Failed to load secret ${name}`, {
          error: error.message,
          stack: error.stack
        });
      }
    }

    const missingSecrets = requiredSecrets.filter(name => !secrets[name]);
    if (missingSecrets.length > 0) {
      throw new Error(`Missing required secrets: ${missingSecrets.join(', ')}`);
    }

    return secrets;
  }

  clearCache() {
    this.cache.clear();
    logger.info('Secrets cache cleared');
  }
}

export const secretsCache = new SecretsCache();