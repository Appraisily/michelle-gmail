// Update the fetchEndpoints function to better handle the response structure
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
    
    // Extract endpoints array and API info
    const { endpoints = [], authentication, rateLimiting } = data;
    
    if (!Array.isArray(endpoints)) {
      throw new Error('Invalid endpoints format: expected array');
    }

    // Cache both endpoints and API info
    endpointsCache = {
      endpoints,
      authentication,
      rateLimiting
    };
    
    lastEndpointsFetch = Date.now();

    logger.info('Fetched Data Hub endpoints', {
      count: endpoints.length,
      paths: endpoints.map(e => e.path),
      authType: authentication?.type,
      rateLimit: rateLimiting?.requestsPerWindow
    });

    return endpointsCache;
  } catch (error) {
    logger.error('Error fetching API endpoints:', {
      error: error.message,
      stack: error.stack
    });
    // Return empty structure instead of throwing
    return {
      endpoints: [],
      authentication: null,
      rateLimiting: null
    };
  }
}