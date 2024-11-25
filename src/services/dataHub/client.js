import { logger } from '../../utils/logger.js';
import { getSecrets } from '../../utils/secretManager.js';

const DATA_HUB_API = 'https://data-hub-856401495068.us-central1.run.app';

async function getApiKey() {
  const secrets = await getSecrets();
  if (!secrets.DATA_HUB_API_KEY) {
    throw new Error('DATA_HUB_API_KEY not found');
  }
  return secrets.DATA_HUB_API_KEY;
}

async function makeRequest(endpoint, params = {}) {
  try {
    const apiKey = await getApiKey();
    const headers = {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    };

    // Build query string from params
    const queryParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) queryParams.append(key, value);
    });
    
    const url = `${DATA_HUB_API}/api${endpoint}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    logger.info('Making Data Hub API request', { 
      endpoint,
      params: JSON.stringify(params)
    });

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Data Hub API request failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  } catch (error) {
    logger.error('Data Hub API request failed:', {
      endpoint,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

export const dataHubClient = {
  getPendingAppraisals: (params = {}) => 
    makeRequest('/appraisals/pending', params),
  
  getCompletedAppraisals: (params = {}) => 
    makeRequest('/appraisals/completed', params),
    
  getSales: (params = {}) =>
    makeRequest('/sales', params)
};