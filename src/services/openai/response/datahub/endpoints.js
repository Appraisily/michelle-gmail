import { logger } from '../../../../utils/logger.js';
import { DATA_HUB_API } from './config.js';

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