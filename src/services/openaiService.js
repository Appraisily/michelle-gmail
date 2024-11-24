// Previous imports remain the same...

async function makeApiRequest(endpoint, method = 'GET', body = null) {
  try {
    // Ensure we have the shared secret before making the request
    const secret = await ensureSharedSecret();

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `SharedSecret ${secret}` // Changed to match expected format
    };

    const options = {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) })
    };

    logger.info(`Making API request to ${endpoint}`, { 
      method,
      headers: {
        ...headers,
        'Authorization': '[REDACTED]'
      }
    });

    const response = await fetch(`${APPRAISERS_API}/api${endpoint}`, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  } catch (error) {
    logger.error('API request failed:', {
      endpoint,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Rest of the file remains the same...