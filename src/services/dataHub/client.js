import fetch from 'node-fetch';
import { logger } from '../../utils/logger.js';
import { getSecrets } from '../../utils/secretManager.js';

const DATA_HUB_API = 'https://data-hub-856401495068.us-central1.run.app';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let endpointsCache = null;
let lastEndpointsFetch = null;
let apiKeyPromise = null;

// Lazy load API key only when needed
async function getApiKey() {
  if (!apiKeyPromise) {
    apiKeyPromise = getSecrets().then(secrets => {
      if (!secrets.DATA_HUB_API_KEY) {
        throw new Error('DATA_HUB_API_KEY not found');
      }
      return secrets.DATA_HUB_API_KEY;
    });
  }
  return apiKeyPromise;
}

async function fetchEndpoints() {
  try {
    // Use cache if available and not expired
    if (endpointsCache && lastEndpointsFetch && (Date.now() - lastEndpointsFetch < CACHE_TTL)) {
      logger.debug('Using cached endpoints data');
      return endpointsCache;
    }

    // /api/endpoints is unauthenticated
    const response = await fetch(`${DATA_HUB_API}/api/endpoints`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch endpoints: ${response.status}`);
    }

    const data = await response.json();
    
    // Cache the response
    endpointsCache = data;
    lastEndpointsFetch = Date.now();

    logger.info('Fetched Data Hub endpoints', {
      endpointCount: data.endpoints?.length,
      authentication: data.authentication?.type,
      rateLimiting: data.rateLimiting?.requestsPerWindow
    });

    return data;
  } catch (error) {
    logger.error('Error fetching API endpoints:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function makeRequest(endpoint, method = 'GET', params = null, body = null) {
  try {
    // Only get API key for authenticated endpoints
    const apiKey = endpoint !== '/api/endpoints' ? await getApiKey() : null;
    
    const headers = {
      'Content-Type': 'application/json',
      ...(apiKey && { 'X-API-Key': apiKey })
    };

    // Build URL with query parameters
    const url = new URL(`${DATA_HUB_API}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, value);
        }
      });
    }

    const options = {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) })
    };

    logger.debug('Making Data Hub API request', {
      endpoint,
      method,
      params,
      hasBody: !!body,
      isAuthenticated: !!apiKey
    });

    const response = await fetch(url.toString(), options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    logger.debug('Data Hub API response received', {
      endpoint,
      status: response.status,
      hasData: !!data
    });

    return data;
  } catch (error) {
    logger.error('Data Hub API request failed:', {
      error: error.message,
      endpoint,
      stack: error.stack
    });
    throw error;
  }
}

// Validate endpoint exists and check if it requires authentication
async function validateEndpoint(endpoint) {
  try {
    const apiInfo = await fetchEndpoints();
    const endpointData = apiInfo.endpoints?.find(e => e.path === endpoint);
    
    if (!endpointData) {
      throw new Error(`Unknown endpoint: ${endpoint}`);
    }

    return {
      requiresAuth: endpointData.authentication !== false,
      ...endpointData
    };
  } catch (error) {
    logger.error('Error validating endpoint:', {
      error: error.message,
      endpoint,
      stack: error.stack
    });
    throw error;
  }
}

export const dataHubClient = {
  fetchEndpoints,
  makeRequest,
  validateEndpoint
};