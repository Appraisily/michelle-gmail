import { logger } from '../../../../utils/logger.js';

// Safely mask an API key for logging
export function maskApiKey(key) {
  if (!key) return 'undefined';
  if (key.length < 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// Format headers for safe logging
export function formatHeadersForLogging(headers) {
  const formatted = { ...headers };
  if (formatted['X-API-Key']) {
    formatted['X-API-Key'] = maskApiKey(formatted['X-API-Key']);
  }
  return formatted;
}

// Extract response headers into object
export function extractResponseHeaders(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}