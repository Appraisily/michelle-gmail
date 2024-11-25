import fetch from 'node-fetch';
import { logger } from '../../utils/logger.js';
import { getSecrets } from '../../utils/secretManager.js';

const DATA_HUB_API = 'https://data-hub-856401495068.us-central1.run.app';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let endpointsCache = null;
let lastEndpointsFetch = null;

async function getApiKey() {
  const secrets = await getSecrets();
  if (!secrets.DATA_HUB_API_KEY) {
    throw new Error('DATA_HUB_API_KEY not found');
  }
  return secrets.DATA_HUB_API_KEY;
}

async function fetchEndpoints() {
  try {
    // Use cache if available and not expired
    if (endpointsCache && lastEndpointsFetch && (Date.now() - lastEndpointsFetch < CACHE_TTL)) {
      return endpointsCache;
    }

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
    logger.error('Error fetching API endpoints:', error);
    throw error;
  }
}

async function makeRequest(endpoint, method = 'GET', params = null, body = null) {
  try {
    const apiKey = await getApiKey();
    
    const headers = {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
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

    logger.info('Making Data Hub API request', {
      endpoint,
      method,
      params,
      hasBody: !!body
    });

    const response = await fetch(url.toString(), options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('Data Hub API request failed:', error);
    throw error;
  }
}

export const dataHubClient = {
  fetchEndpoints,
  makeRequest
};