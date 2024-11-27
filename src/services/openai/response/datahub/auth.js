import { logger } from '../../../../utils/logger.js';
import { getSecrets } from '../../../../utils/secretManager.js';
import { maskApiKey } from './utils.js';

let apiKeyPromise = null;

// Lazy load API key only when needed
export async function getApiKey() {
  if (!apiKeyPromise) {
    apiKeyPromise = getSecrets().then(secrets => {
      if (!secrets.DATA_HUB_API_KEY) {
        throw new Error('DATA_HUB_API_KEY not found in secrets');
      }
      const key = secrets.DATA_HUB_API_KEY.trim(); // Ensure no whitespace
      logger.info('Retrieved API key from secrets', {
        keyLength: key.length,
        maskedKey: maskApiKey(key),
        timestamp: new Date().toISOString()
      });
      return key;
    });
  }
  return apiKeyPromise;
}

// Create headers with authentication
export async function createAuthHeaders() {
  const apiKey = await getApiKey();
  return {
    'X-API-Key': apiKey,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
}