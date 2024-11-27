import { logger } from '../../../utils/logger.js';

const INITIAL_DELAY = 1000; // 1 second
const MAX_DELAY = 30000; // 30 seconds
const MAX_RETRIES = 5;
const JITTER_FACTOR = 0.2; // 20% random jitter

export class ReconnectionManager {
  constructor() {
    this.retryAttempts = new Map(); // clientId -> attempt count
    this.lastAttempts = new Map(); // clientId -> timestamp
  }

  /**
   * Calculate next retry delay with exponential backoff
   * @param {number} attempt Current attempt number
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(attempt) {
    // Calculate base delay: 1s, 2s, 4s, 8s, 16s...
    const baseDelay = Math.min(
      INITIAL_DELAY * Math.pow(2, attempt),
      MAX_DELAY
    );

    // Add random jitter to prevent thundering herd
    const jitter = baseDelay * JITTER_FACTOR * Math.random();
    return baseDelay + jitter;
  }

  /**
   * Check if client can attempt reconnection
   * @param {string} clientId Client identifier
   * @returns {Object} Reconnection status and delay
   */
  canReconnect(clientId) {
    const attempts = this.retryAttempts.get(clientId) || 0;
    const lastAttempt = this.lastAttempts.get(clientId) || 0;
    const now = Date.now();

    // If max retries reached, prevent reconnection
    if (attempts >= MAX_RETRIES) {
      logger.warn('Max reconnection attempts reached', {
        clientId,
        attempts,
        timestamp: new Date().toISOString()
      });
      return {
        allowed: false,
        reason: 'MAX_RETRIES_EXCEEDED'
      };
    }

    // Calculate required delay for this attempt
    const requiredDelay = this.calculateDelay(attempts);
    const timeElapsed = now - lastAttempt;

    // If not enough time has passed, prevent immediate reconnection
    if (lastAttempt > 0 && timeElapsed < requiredDelay) {
      return {
        allowed: false,
        reason: 'TOO_SOON',
        waitTime: requiredDelay - timeElapsed
      };
    }

    return {
      allowed: true,
      delay: requiredDelay
    };
  }

  /**
   * Record reconnection attempt
   * @param {string} clientId Client identifier
   */
  recordAttempt(clientId) {
    const attempts = (this.retryAttempts.get(clientId) || 0) + 1;
    this.retryAttempts.set(clientId, attempts);
    this.lastAttempts.set(clientId, Date.now());

    logger.info('Reconnection attempt recorded', {
      clientId,
      attemptNumber: attempts,
      delay: this.calculateDelay(attempts - 1),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Reset reconnection state for client
   * @param {string} clientId Client identifier
   */
  resetState(clientId) {
    this.retryAttempts.delete(clientId);
    this.lastAttempts.delete(clientId);

    logger.debug('Reconnection state reset', {
      clientId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Clean up old reconnection states
   * @param {number} maxAge Maximum age in milliseconds
   */
  cleanup(maxAge = 1800000) { // Default 30 minutes
    const now = Date.now();
    for (const [clientId, lastAttempt] of this.lastAttempts.entries()) {
      if (now - lastAttempt > maxAge) {
        this.resetState(clientId);
      }
    }
  }
}

export const reconnectionManager = new ReconnectionManager();