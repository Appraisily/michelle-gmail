import { logger } from './logger.js';
import { secretsCache } from './secretsCache.js';

export async function getSecrets() {
  try {
    return await secretsCache.getAllSecrets();
  } catch (error) {
    logger.error('Error fetching secrets:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}