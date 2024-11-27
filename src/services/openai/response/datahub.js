import { logger } from '../../../utils/logger.js';
import { getSecrets } from '../../../utils/secretManager.js';

const DATA_HUB_API = 'https://data-hub-856401495068.us-central1.run.app';
let apiKeyPromise = null;

// Lazy load API key only when needed
async function getApiKey() {
  if (!apiKeyPromise) {
    apiKeyPromise = getSecrets().then(secrets => {
      if (!secrets.DATA_HUB_API_KEY) {
        throw new Error('DATA_HUB_API_KEY not found in secrets');
      }
      return secrets.DATA_HUB_API_KEY.trim(); // Ensure no whitespace
    });
  }
  return apiKeyPromise;
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
    // Get API key first
    const apiKey = await getApiKey();
    
    // Build URL with query parameters
    const url = new URL(`${DATA_HUB_API}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, value.toString());
        }
      });
    }

    // Prepare request options with explicit headers
    const options = {
      method,
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    logger.debug('Making DataHub request', {
      url: url.toString(),
      method,
      hasParams: !!params,
      hasApiKey: !!apiKey,
      headers: Object.keys(options.headers),
      timestamp: new Date().toISOString()
    });

    // Make request
    const response = await fetch(url.toString(), options);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('DataHub request failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        endpoint,
        timestamp: new Date().toISOString()
      });
      throw new Error(`DataHub request failed: ${response.status} - ${errorText}`);
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
      params,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}