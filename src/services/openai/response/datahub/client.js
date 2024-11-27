import { logger } from '../../../../utils/logger.js';
import { DATA_HUB_API } from './config.js';
import { createAuthHeaders } from './auth.js';
import { formatHeadersForLogging, extractResponseHeaders } from './utils.js';

export async function queryDataHub(endpoint, method, params = null) {
  try {
    // Get authenticated headers
    const headers = await createAuthHeaders();
    
    // Build URL with query parameters
    const url = new URL(`${DATA_HUB_API}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, value.toString());
        }
      });
    }

    // Enhanced request logging
    logger.info('DataHub request details', {
      url: url.toString(),
      method,
      headers: formatHeadersForLogging(headers),
      hasParams: !!params,
      params: params || {},
      timestamp: new Date().toISOString()
    });

    // Make request with explicit options
    const options = { 
      method, 
      headers,
      // Ensure proper handling of credentials and CORS
      credentials: 'same-origin',
      mode: 'cors'
    };

    const response = await fetch(url.toString(), options);

    // Enhanced response logging
    const responseHeaders = extractResponseHeaders(response);
    logger.info('DataHub response details', {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      hasAuthHeader: !!responseHeaders['www-authenticate'],
      timestamp: new Date().toISOString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('DataHub request failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        endpoint,
        requestHeaders: formatHeadersForLogging(headers),
        responseHeaders,
        url: url.toString(),
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