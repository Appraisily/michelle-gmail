import { logger } from '../../utils/logger.js';
import { getSecrets } from '../../utils/secretManager.js';
import fetch from 'node-fetch';

const DATA_HUB_API = 'https://data-hub-856401495068.us-central1.run.app';
let endpointsCache = null;
let lastEndpointsFetch = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

    // /api/endpoints doesn't require authentication
    const response = await fetch(`${DATA_HUB_API}/api/endpoints`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch endpoints: ${response.status}`);
    }

    const endpoints = await response.json();
    endpointsCache = endpoints;
    lastEndpointsFetch = Date.now();

    return endpoints;
  } catch (error) {
    logger.error('Error fetching API endpoints:', error);
    throw error;
  }
}

async function makeRequest(path, method = 'GET', params = null, body = null) {
  try {
    const endpoints = await fetchEndpoints();

    // Validate endpoint exists
    const endpoint = endpoints.find(e => e.path === path && e.method === method);
    if (!endpoint) {
      throw new Error(`Invalid endpoint: ${method} ${path}`);
    }

    // Build URL with query parameters
    const url = new URL(`${DATA_HUB_API}/api${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value != null) url.searchParams.append(key, value);
      });
    }

    // All endpoints except /api/endpoints require API key
    const headers = {
      'Content-Type': 'application/json'
    };

    if (path !== '/endpoints') {
      const apiKey = await getApiKey();
      headers['X-API-Key'] = apiKey;
    }

    const options = {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) })
    };

    logger.info('Making Data Hub API request', {
      path,
      method,
      params: params ? JSON.stringify(params) : null,
      requiresAuth: path !== '/endpoints'
    });

    const response = await fetch(url.toString(), options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Data Hub API request failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  } catch (error) {
    logger.error('Data Hub API request failed:', {
      path,
      method,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

export const dataHubClient = {
  makeRequest,
  fetchEndpoints
};