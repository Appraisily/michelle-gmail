/**
 * Utility functions for consistent timestamp handling
 */

/**
 * Get current timestamp in ISO format
 * @returns {string} ISO timestamp
 */
export function getCurrentTimestamp() {
  return new Date().toISOString();
}

/**
 * Convert Unix timestamp to ISO string
 * @param {number} timestamp Unix timestamp in milliseconds
 * @returns {string} ISO timestamp
 */
export function unixToIso(timestamp) {
  return new Date(timestamp).toISOString();
}

/**
 * Convert ISO string to Unix timestamp
 * @param {string} isoString ISO timestamp string
 * @returns {number} Unix timestamp in milliseconds
 */
export function isoToUnix(isoString) {
  return new Date(isoString).getTime();
}

/**
 * Calculate time difference in milliseconds
 * @param {string|number} start Start time (ISO string or Unix timestamp)
 * @param {string|number} end End time (ISO string or Unix timestamp)
 * @returns {number} Time difference in milliseconds
 */
export function getTimeDifference(start, end) {
  const startTime = typeof start === 'string' ? isoToUnix(start) : start;
  const endTime = typeof end === 'string' ? isoToUnix(end) : end;
  return endTime - startTime;
}