import { logger } from '../../../utils/logger.js';
import { getSecrets } from '../../../utils/secretManager.js';

const DATA_HUB_API = 'https://data-hub-856401495068.us-central1.run.app';
let apiKey = null;

async function getApiKey() {
  if (!apiKey) {
    const secrets = await getSecrets();
    apiKey = secrets.DATA_HUB_API_KEY;
  }
  return apiKey;
}

export async function getAvailableEndpoints() {
  try {
    // Make unauthenticated request to fetch endpoints
    const response = await fetch(`${DATA_HUB_API}/api/endpoints`);
    if (!response.ok) {
      throw new Error(`Failed to fetch endpoints: ${response.status}`);
    }
    const data = await response.json();

    logger.info('Fetched Data Hub endpoints', {
      endpointCount: data.endpoints?.length,
      authentication: data.authentication?.type,
      rateLimiting: data.rateLimiting?.requestsPerWindow,
      timestamp: new Date().toISOString()
    });

    return data.endpoints || [];
  } catch (error) {
    logger.error('Failed to fetch endpoints:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return [];
  }
}

export async function queryDataHub(endpoint, method, params = null) {
  try {
    const key = await getApiKey();
    const url = new URL(`${DATA_HUB_API}${endpoint}`);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, value);
        }
      });
    }

    const headers = {
      'X-API-Key': key,
      'Content-Type': 'application/json'
    };

    logger.debug('Making DataHub request', {
      endpoint,
      method,
      hasParams: !!params,
      timestamp: new Date().toISOString()
    });

    const response = await fetch(url.toString(), { 
      method, 
      headers 
    });

    if (!response.ok) {
      throw new Error(`DataHub request failed: ${response.status}`);
    }

    const data = await response.json();
    
    logger.info('DataHub query successful', {
      endpoint,
      method,
      hasParams: !!params,
      dataSize: JSON.stringify(data).length,
      timestamp: new Date().toISOString()
    });

    return data;
  } catch (error) {
    logger.error('DataHub query failed:', {
      error: error.message,
      endpoint,
      method,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}